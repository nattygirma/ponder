import Foundation
import GRDB

final class SyncOutboxRepository: @unchecked Sendable {
    private let dbQueue: DatabaseQueue

    init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    static func createQueueId(memoId: String) -> String { "memo.create:\(memoId)" }
    static func updateQueueId(memoId: String) -> String { "memo.update:\(memoId)" }

    func enqueueCreate(scope: String, payload: MemoCreatePayload) throws {
        let now = PonderDate.nowString()
        let id = Self.createQueueId(memoId: payload.memoId)
        let payloadJSON = try String(data: PonderJSON.encoder.encode(payload), encoding: .utf8) ?? "{}"
        try dbQueue.write { db in
            let existingVersion = try Int.fetchOne(
                db,
                sql: "SELECT version FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, id]
            ) ?? 0
            let createdAt = try String.fetchOne(
                db,
                sql: "SELECT created_at FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, id]
            ) ?? now
            try db.execute(
                sql: """
                INSERT OR REPLACE INTO mobile_sync_outbox
                  (scope, id, kind, memo_id, status, payload_json, attempt_count, last_error,
                   next_attempt_at, created_at, updated_at, version)
                VALUES (?, ?, ?, ?, 'pending', ?, 0, NULL, NULL, ?, ?, ?)
                """,
                arguments: [scope, id, OutboxKind.memoCreate.rawValue, payload.memoId, payloadJSON, createdAt, now, existingVersion + 1]
            )
        }
    }

    func enqueueUpdate(scope: String, payload: MemoUpdatePayload) throws {
        let now = PonderDate.nowString()
        let createId = Self.createQueueId(memoId: payload.memoId)
        let updateId = Self.updateQueueId(memoId: payload.memoId)
        let updateJSON = try String(data: PonderJSON.encoder.encode(payload), encoding: .utf8) ?? "{}"

        try dbQueue.write { db in
            // Create-absorbs-update: fold into pending create if present.
            if let createRow = try Row.fetchOne(
                db,
                sql: "SELECT * FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, createId]
            ) {
                var createPayload = try PonderJSON.decoder.decode(
                    MemoCreatePayload.self,
                    from: Data((createRow["payload_json"] as String).utf8)
                )
                createPayload.title = payload.title
                createPayload.contentMarkdown = payload.contentMarkdown
                if let contentJson = payload.contentJson {
                    createPayload.contentJson = contentJson
                }
                createPayload.notebookId = payload.notebookId
                createPayload.tags = payload.tags
                let json = try String(data: PonderJSON.encoder.encode(createPayload), encoding: .utf8) ?? "{}"
                let version: Int = createRow["version"]
                try db.execute(
                    sql: """
                    UPDATE mobile_sync_outbox
                    SET status = 'pending', payload_json = ?, last_error = NULL, next_attempt_at = NULL,
                        updated_at = ?, version = ?
                    WHERE scope = ? AND id = ?
                    """,
                    arguments: [json, now, version + 1, scope, createId]
                )
                return
            }

            // Never enqueue a bare update for offline `local:` ids — server has no such memo.
            // Without a pending create this would loop as "Memo not found".
            if payload.memoId.hasPrefix("local:") {
                let createPayload = MemoCreatePayload(
                    memoId: payload.memoId,
                    title: payload.title,
                    contentMarkdown: payload.contentMarkdown,
                    contentJson: payload.contentJson,
                    notebookId: payload.notebookId,
                    tags: payload.tags,
                    createdAt: now
                )
                let json = try String(data: PonderJSON.encoder.encode(createPayload), encoding: .utf8) ?? "{}"
                let existingVersion = try Int.fetchOne(
                    db,
                    sql: "SELECT version FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                    arguments: [scope, createId]
                ) ?? 0
                try db.execute(
                    sql: """
                    INSERT OR REPLACE INTO mobile_sync_outbox
                      (scope, id, kind, memo_id, status, payload_json, attempt_count, last_error,
                       next_attempt_at, created_at, updated_at, version)
                    VALUES (?, ?, ?, ?, 'pending', ?, 0, NULL, NULL, ?, ?, ?)
                    """,
                    arguments: [
                        scope, createId, OutboxKind.memoCreate.rawValue, payload.memoId, json,
                        now, now, existingVersion + 1,
                    ]
                )
                return
            }

            let existingVersion = try Int.fetchOne(
                db,
                sql: "SELECT version FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, updateId]
            ) ?? 0
            let createdAt = try String.fetchOne(
                db,
                sql: "SELECT created_at FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, updateId]
            ) ?? now
            let attemptCount = try Int.fetchOne(
                db,
                sql: "SELECT attempt_count FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, updateId]
            ) ?? 0
            try db.execute(
                sql: """
                INSERT OR REPLACE INTO mobile_sync_outbox
                  (scope, id, kind, memo_id, status, payload_json, attempt_count, last_error,
                   next_attempt_at, created_at, updated_at, version)
                VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?, ?)
                """,
                arguments: [
                    scope, updateId, OutboxKind.memoUpdate.rawValue, payload.memoId, updateJSON,
                    attemptCount, createdAt, now, existingVersion + 1,
                ]
            )
        }
    }

    /// Clear backoff so error/conflict items retry immediately (Android force flush).
    func armImmediateRetry(scope: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                UPDATE mobile_sync_outbox
                SET status = CASE WHEN status IN ('error', 'conflict', 'syncing') THEN 'pending' ELSE status END,
                    next_attempt_at = NULL,
                    last_error = CASE WHEN status IN ('error', 'conflict') THEN last_error ELSE last_error END,
                    updated_at = ?
                WHERE scope = ?
                  AND status IN ('pending', 'error', 'syncing', 'conflict')
                """,
                arguments: [PonderDate.nowString(), scope]
            )
        }
    }

    func cancelMemo(scope: String, memoId: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM mobile_sync_outbox WHERE scope = ? AND memo_id = ?", arguments: [scope, memoId])
        }
    }

    func listItems(scope: String) throws -> [OutboxItem] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT * FROM mobile_sync_outbox WHERE scope = ? ORDER BY updated_at DESC",
                arguments: [scope]
            )
            return rows.compactMap { Self.item(from: $0) }
        }
    }

    func flushableItems(scope: String, now: Date = Date()) throws -> [OutboxItem] {
        let nowString = ISO8601DateFormatter.ponder.string(from: now)
        return try dbQueue.read { db in
            // Include `conflict` so a rebase retry can clear stale-base conflicts
            // (expectedRevision lag after a successful prior sync).
            let rows = try Row.fetchAll(
                db,
                sql: """
                SELECT * FROM mobile_sync_outbox
                WHERE scope = ?
                  AND status IN ('pending', 'error', 'syncing', 'conflict')
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                ORDER BY created_at ASC
                """,
                arguments: [scope, nowString]
            )
            return rows.compactMap { Self.item(from: $0) }
        }
    }

    func markSyncing(scope: String, id: String, expectedVersion: Int) throws -> Bool {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                UPDATE mobile_sync_outbox
                SET status = 'syncing', updated_at = ?
                WHERE scope = ? AND id = ? AND version = ?
                """,
                arguments: [PonderDate.nowString(), scope, id, expectedVersion]
            )
            return db.changesCount > 0
        }
    }

    func remove(scope: String, id: String, expectedVersion: Int?) throws -> Bool {
        try dbQueue.write { db in
            if let expectedVersion {
                try db.execute(
                    sql: "DELETE FROM mobile_sync_outbox WHERE scope = ? AND id = ? AND version = ?",
                    arguments: [scope, id, expectedVersion]
                )
            } else {
                try db.execute(
                    sql: "DELETE FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                    arguments: [scope, id]
                )
            }
            return db.changesCount > 0
        }
    }

    func updateStatus(
        scope: String,
        id: String,
        expectedVersion: Int,
        status: OutboxStatus,
        attemptCount: Int,
        lastError: String?,
        nextAttemptAt: String?
    ) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                UPDATE mobile_sync_outbox
                SET status = ?, attempt_count = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
                WHERE scope = ? AND id = ? AND version = ?
                """,
                arguments: [
                    status.rawValue, attemptCount, lastError, nextAttemptAt, PonderDate.nowString(),
                    scope, id, expectedVersion,
                ]
            )
        }
    }

    func promoteCreateToUpdate(scope: String, createId: String, expectedVersion: Int, memo: MemoDetail) throws -> Bool {
        // If create row still exists at same version, remove it (caller remaps id).
        // If version advanced (user edited during sync), convert remaining create payload to update.
        try dbQueue.write { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT * FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, createId]
            ) else { return false }

            let version: Int = row["version"]
            if version == expectedVersion {
                try db.execute(sql: "DELETE FROM mobile_sync_outbox WHERE scope = ? AND id = ?", arguments: [scope, createId])
                return true
            }
            // Rebase: convert create → update with new revision base
            guard let createPayload = try? PonderJSON.decoder.decode(
                MemoCreatePayload.self,
                from: Data((row["payload_json"] as String).utf8)
            ) else { return false }
            let update = MemoUpdatePayload(
                memoId: memo.id,
                expectedRevision: memo.revision,
                expectedContentHash: memo.contentHash,
                title: createPayload.title,
                contentMarkdown: createPayload.contentMarkdown,
                contentJson: createPayload.contentJson,
                notebookId: createPayload.notebookId,
                tags: createPayload.tags
            )
            let json = try String(data: PonderJSON.encoder.encode(update), encoding: .utf8) ?? "{}"
            let updateId = Self.updateQueueId(memoId: memo.id)
            let now = PonderDate.nowString()
            try db.execute(sql: "DELETE FROM mobile_sync_outbox WHERE scope = ? AND id = ?", arguments: [scope, createId])
            try db.execute(
                sql: """
                INSERT OR REPLACE INTO mobile_sync_outbox
                  (scope, id, kind, memo_id, status, payload_json, attempt_count, last_error,
                   next_attempt_at, created_at, updated_at, version)
                VALUES (?, ?, 'memo.update', ?, 'pending', ?, 0, NULL, NULL, ?, ?, 1)
                """,
                arguments: [scope, updateId, memo.id, json, now, now]
            )
            return true
        }
    }

    func rebaseUpdate(scope: String, id: String, syncedVersion: Int, memo: MemoDetail) throws {
        try dbQueue.write { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT * FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, id]
            ) else { return }
            let version: Int = row["version"]
            guard version > syncedVersion, row["kind"] as String == OutboxKind.memoUpdate.rawValue else { return }
            var payload = try PonderJSON.decoder.decode(
                MemoUpdatePayload.self,
                from: Data((row["payload_json"] as String).utf8)
            )
            payload.expectedRevision = memo.revision
            payload.expectedContentHash = memo.contentHash
            let json = try String(data: PonderJSON.encoder.encode(payload), encoding: .utf8) ?? "{}"
            try db.execute(
                sql: """
                UPDATE mobile_sync_outbox
                SET payload_json = ?, status = 'pending', last_error = NULL, next_attempt_at = NULL, updated_at = ?
                WHERE scope = ? AND id = ?
                """,
                arguments: [json, PonderDate.nowString(), scope, id]
            )
        }
    }

    func pendingCreate(scope: String, memoId: String) throws -> OutboxItem? {
        try dbQueue.read { db in
            let id = Self.createQueueId(memoId: memoId)
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT * FROM mobile_sync_outbox WHERE scope = ? AND id = ?",
                arguments: [scope, id]
            ) else { return nil }
            return Self.item(from: row)
        }
    }

    private static func item(from row: Row) -> OutboxItem? {
        guard
            let kind = OutboxKind(rawValue: row["kind"]),
            let status = OutboxStatus(rawValue: row["status"])
        else { return nil }
        return OutboxItem(
            id: row["id"],
            kind: kind,
            memoId: row["memo_id"],
            status: status,
            payloadJSON: row["payload_json"],
            attemptCount: row["attempt_count"],
            lastError: row["last_error"],
            nextAttemptAt: row["next_attempt_at"],
            createdAt: row["created_at"],
            updatedAt: row["updated_at"],
            version: row["version"]
        )
    }
}

enum SyncRetry {
    static func nextAttemptAt(attemptCount: Int, from date: Date = Date()) -> String {
        // Exponential-ish backoff: 2^min(attempt,6) seconds
        let seconds = pow(2.0, Double(min(attemptCount, 6)))
        let at = date.addingTimeInterval(seconds)
        return ISO8601DateFormatter.ponder.string(from: at)
    }
}
