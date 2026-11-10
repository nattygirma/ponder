import XCTest
@testable import Ponder

final class SyncProtocolTests: XCTestCase {
    func testBootstrapDecodesLegacyAndMetadataFreeContinuation() throws {
        let legacy = try PonderJSON.decoder.decode(MobileSyncBootstrapPage.self, from: Data("""
        {"notebooks":[],"memos":[],"snapshotCursor":42,"syncIdentity":"workspace","totalCount":200,"nextAfterId":"memo_1"}
        """.utf8))
        XCTAssertEqual(legacy.totalCount, 200)
        let continuation = try PonderJSON.decoder.decode(MobileSyncBootstrapPage.self, from: Data("""
        {"notebooks":[],"memos":[],"snapshotCursor":42,"syncIdentity":"workspace","nextAfterId":null}
        """.utf8))
        XCTAssertNil(continuation.totalCount)
        XCTAssertEqual(continuation.snapshotCursor, legacy.snapshotCursor)
        XCTAssertEqual(continuation.syncIdentity, legacy.syncIdentity)
    }

    func testCursorRewound() {
        XCTAssertTrue(SyncProtocol.hasCursorRewound(localCursor: 10, serverCursor: 3))
        XCTAssertFalse(SyncProtocol.hasCursorRewound(localCursor: 10, serverCursor: 10))
        XCTAssertFalse(SyncProtocol.hasCursorRewound(localCursor: 10, serverCursor: nil))
    }

    func testIdentityChanged() {
        XCTAssertTrue(SyncProtocol.hasIdentityChanged(localIdentity: "a", serverIdentity: "b"))
        XCTAssertFalse(SyncProtocol.hasIdentityChanged(localIdentity: "a", serverIdentity: "a"))
        XCTAssertFalse(SyncProtocol.hasIdentityChanged(localIdentity: "a", serverIdentity: nil))
    }

    func testMetadataInitialized() {
        XCTAssertTrue(SyncProtocol.isMetadataInitialized(cursorValue: "0", identityValue: "id"))
        XCTAssertFalse(SyncProtocol.isMetadataInitialized(cursorValue: nil, identityValue: "id"))
        XCTAssertFalse(SyncProtocol.isMetadataInitialized(cursorValue: "x", identityValue: "id"))
    }

    func testBootstrapBatches() {
        let batches = SyncProtocol.splitBootstrapWriteBatches(Array(0 ..< 5), batchSize: 2)
        XCTAssertEqual(batches.count, 3)
        XCTAssertEqual(batches[0], [0, 1])
        XCTAssertEqual(batches[2], [4])
    }

    func testDataScope() throws {
        let url = try PonderURLNormalizer.normalizeInstanceURL("https://appkeep.io/")
        XCTAssertEqual(
            SyncProtocol.createDataScope(baseURL: url, userId: "u1"),
            "https://appkeep.io|u1"
        )
    }
}
