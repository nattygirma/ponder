import Foundation

enum DeviceId {
    /// Stable per-install device id sent with login (`deviceId`), matching RN `ponder.mobile.device-id`.
    static func getOrCreate() throws -> String {
        if let existing = try KeychainStore.string(forKey: KeychainStore.Key.deviceId), !existing.isEmpty {
            return existing
        }
        let id = "mobile-\(UUID().uuidString.lowercased())"
        try KeychainStore.setString(id, forKey: KeychainStore.Key.deviceId)
        return id
    }
}
