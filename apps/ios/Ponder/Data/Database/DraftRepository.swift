import Foundation
import GRDB

final class DraftRepository: @unchecked Sendable {
    private let dbQueue: DatabaseQueue

    init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    static func memoKey(_ memoId: String) -> String { "memo:\(memoId)" }
    static let newKey = "new"

    func read(scope: String, key: String) throws -> MemoDraft? {
        try dbQueue.read { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT * FROM mobile_drafts WHERE scope = ? AND draft_key = ?",
                arguments: [scope, key]
            ) else { return nil }
            return MemoDraft(
                draftKey: row["draft_key"],
                title: row["title"],
                contentMarkdown: row["content_markdown"],
                contentJson: row["content_json"],
                notebookId: row["notebook_id"],
                tagsText: row["tags_text"],
                expectedRevision: row["expected_revision"],
                updatedAt: row["updated_at"]
            )
        }
    }

    func write(scope: String, draft: MemoDraft) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                INSERT OR REPLACE INTO mobile_drafts
                  (scope, draft_key, title, content_markdown, content_json, notebook_id, tags_text, expected_revision, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    scope,
                    draft.draftKey,
                    draft.title,
                    draft.contentMarkdown,
                    draft.contentJson,
                    draft.notebookId,
                    draft.tagsText,
                    draft.expectedRevision,
                    draft.updatedAt,
                ]
            )
        }
    }

    func clear(scope: String, key: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "DELETE FROM mobile_drafts WHERE scope = ? AND draft_key = ?",
                arguments: [scope, key]
            )
        }
    }
}
