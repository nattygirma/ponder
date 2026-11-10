import Foundation

actor OutboxFlusher {
    private let outbox: SyncOutboxRepository
    private let mirror: LocalMirrorRepository
    private let client: APIClient

    init(outbox: SyncOutboxRepository, mirror: LocalMirrorRepository, client: APIClient) {
        self.outbox = outbox
        self.mirror = mirror
        self.client = client
    }

    func flush(scope: String, force: Bool = false) async throws -> SyncRunResult {
        if force {
            try outbox.armImmediateRetry(scope: scope)
        }
        var result = SyncRunResult()
        let items = try outbox.flushableItems(scope: scope)
        for item in items {
            result.attempted += 1
            let marked = try outbox.markSyncing(scope: scope, id: item.id, expectedVersion: item.version)
            guard marked else { continue }

            do {
                let memo = try await syncItem(scope: scope, item: item)
                let removed = try outbox.remove(scope: scope, id: item.id, expectedVersion: item.version)
                if removed {
                    if item.kind == .memoCreate, item.memoId.hasPrefix("local:") {
                        try mirror.replaceLocalMemoId(scope: scope, temporaryId: item.memoId, memo: memo)
                    } else if item.kind == .memoUpdate, item.memoId != memo.id {
                        // Local-only / never-cloud id remapped onto a new server row.
                        try mirror.replaceLocalMemoId(scope: scope, temporaryId: item.memoId, memo: memo)
                    } else {
                        try mirror.upsertMemo(scope: scope, memo: memo)
                    }
                } else if item.kind == .memoCreate {
                    let promoted = try outbox.promoteCreateToUpdate(
                        scope: scope,
                        createId: item.id,
                        expectedVersion: item.version,
                        memo: memo
                    )
                    if promoted {
                        try mirror.replaceLocalMemoId(scope: scope, temporaryId: item.memoId, memo: memo)
                    } else {
                        // User cancelled while in flight — soft-delete remote orphan.
                        try? await client.deleteMemo(id: memo.id, permanent: false)
                    }
                } else {
                    try outbox.rebaseUpdate(scope: scope, id: item.id, syncedVersion: item.version, memo: memo)
                    try mirror.upsertMemo(scope: scope, memo: memo)
                }
                result.synced += 1
            } catch {
                let apiError = error as? APIError
                let isConflict = apiError?.isRevisionConflict == true
                let status: OutboxStatus = isConflict ? .conflict : .error
                let attempts = item.attemptCount + 1
                try outbox.updateStatus(
                    scope: scope,
                    id: item.id,
                    expectedVersion: item.version,
                    status: status,
                    attemptCount: attempts,
                    lastError: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription,
                    nextAttemptAt: isConflict ? nil : SyncRetry.nextAttemptAt(attemptCount: attempts)
                )
                if isConflict {
                    result.conflicted += 1
                } else {
                    result.failed += 1
                }
            }
        }
        return result
    }

    private func syncItem(scope: String, item: OutboxItem) async throws -> MemoDetail {
        switch item.kind {
        case .memoCreate:
            let payload = try item.createPayload()
            var memo = try await client.createMemo(
                notebookId: payload.notebookId,
                title: payload.title,
                contentMarkdown: payload.contentMarkdown,
                tags: payload.tags,
                createdAt: payload.createdAt,
                updatedAt: item.updatedAt
            )
            // Create API builds contentJson from markdown only — image width is lost.
            // Keep local TipTap JSON (with width) on the mirror for detail/edit display.
            if let local = Self.parseContentJson(payload.contentJson) {
                memo.contentJson = local
            }
            return memo
        case .memoUpdate:
            let payload = try item.updatePayload()
            return try await applyMemoUpdate(scope: scope, memoId: item.memoId, payload: payload, allowRebase: true)
        }
    }

    /// Push a memo update.
    ///
    /// Production-safe recovery:
    /// - Stale base → rebase once onto live edit-session tip (local body wins).
    /// - `local:` id → create (never existed on server).
    /// - True memo 404 **only if** the payload is clearly a never-synced local draft
    ///   (`contentHash` still `local:`-shaped, or id is `local:`). Real cloud memos
    ///   that 404 (deleted on formal / other device) are **not** recreated.
    private func applyMemoUpdate(
        scope: String,
        memoId: String,
        payload: MemoUpdatePayload,
        allowRebase: Bool
    ) async throws -> MemoDetail {
        if memoId.hasPrefix("local:") {
            return try await recreateMemoFromUpdate(payload: payload)
        }

        let editSession: MemoEditSession
        do {
            editSession = try await client.createMemoEditSession(memoId: memoId)
        } catch {
            if shouldRecreateMissingMemo(scope: scope, memoId: memoId, payload: payload, error: error) {
                #if DEBUG
                NSLog("OutboxFlusher: local-only memo %@ missing on server — create", memoId)
                #endif
                return try await recreateMemoFromUpdate(payload: payload)
            }
            throw error
        }

        let baseMatches = editSession.baseRevision == payload.expectedRevision
            && editSession.baseContentHash == payload.expectedContentHash

        do {
            if !baseMatches {
                if allowRebase {
                    #if DEBUG
                    NSLog(
                        "OutboxFlusher: rebasing update memo=%@ localRev=%d serverRev=%d",
                        memoId,
                        payload.expectedRevision,
                        editSession.baseRevision
                    )
                    #endif
                    return try await client.updateMemo(
                        id: memoId,
                        expectedRevision: editSession.baseRevision,
                        expectedContentHash: editSession.baseContentHash,
                        editSessionId: editSession.id,
                        notebookId: payload.notebookId,
                        title: payload.title,
                        isPinned: nil,
                        contentMarkdown: payload.contentMarkdown,
                        contentJson: Self.parseContentJson(payload.contentJson),
                        tags: payload.tags
                    )
                }
                throw APIError(
                    status: 409,
                    code: "revision_conflict",
                    message: "Note changed before the offline draft could sync."
                )
            }

            return try await client.updateMemo(
                id: memoId,
                expectedRevision: payload.expectedRevision,
                expectedContentHash: payload.expectedContentHash,
                editSessionId: editSession.id,
                notebookId: payload.notebookId,
                title: payload.title,
                isPinned: nil,
                contentMarkdown: payload.contentMarkdown,
                contentJson: Self.parseContentJson(payload.contentJson),
                tags: payload.tags
            )
        } catch {
            if shouldRecreateMissingMemo(scope: scope, memoId: memoId, payload: payload, error: error) {
                return try await recreateMemoFromUpdate(payload: payload)
            }
            throw error
        }
    }

    /// Only recover when the queue item is a **never-cloud** local draft.
    /// Do not recreate a real server memo that 404s (deleted on formal / other device).
    private func shouldRecreateMissingMemo(
        scope: String,
        memoId: String,
        payload: MemoUpdatePayload,
        error: Error
    ) -> Bool {
        guard (error as? APIError)?.isMemoNotFound == true else { return false }
        if memoId.hasPrefix("local:") { return true }
        if payload.expectedContentHash.hasPrefix("local:") { return true }
        // Mirror still holds a local: contentHash for this id → never fully synced.
        if let row = try? mirror.resolveMemo(scope: scope, id: memoId),
           row.contentHash.hasPrefix("local:") {
            return true
        }
        // Production-safe default: surface the error; do not mint a duplicate cloud memo.
        return false
    }

    private func recreateMemoFromUpdate(payload: MemoUpdatePayload) async throws -> MemoDetail {
        var memo = try await client.createMemo(
            notebookId: payload.notebookId,
            title: payload.title,
            contentMarkdown: payload.contentMarkdown,
            tags: payload.tags
        )
        // Create API only accepts markdown (drops image width). Prefer local TipTap JSON
        // for the mirror so detail/edit still show the size the user set until a later
        // contentJson update lands on the server.
        if let local = Self.parseContentJson(payload.contentJson) {
            memo.contentJson = local
        }
        return memo
    }

    private static func parseContentJson(_ raw: String?) -> JSONValue? {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return try? JSONValue.parse(raw)
    }
}
