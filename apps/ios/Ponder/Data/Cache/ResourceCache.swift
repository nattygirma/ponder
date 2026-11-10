import Foundation
import CryptoKit

actor ResourceCache {
    private let directory: URL
    private let maxBytes: Int64 = 200 * 1024 * 1024

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        directory = base.appendingPathComponent("resource-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func fileURL(for resourceId: String) -> URL {
        let safe = resourceId.replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent(safe)
    }

    func dataURL(for resourceId: String, data: Data, mimeType: String) throws -> String {
        let url = fileURL(for: resourceId)
        try data.write(to: url, options: .atomic)
        let base64 = data.base64EncodedString()
        return "data:\(mimeType);base64,\(base64)"
    }

    func cachedData(for resourceId: String) -> Data? {
        let url = fileURL(for: resourceId)
        return try? Data(contentsOf: url)
    }

    static func resourceId(from source: String) -> String? {
        // /api/v1/resources/:id or .../blob
        guard let url = URL(string: source, relativeTo: URL(string: "https://placeholder.local")) else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        if let idx = parts.firstIndex(of: "resources"), idx + 1 < parts.count {
            return parts[idx + 1]
        }
        return nil
    }

    /// Match Android `normalizeProtectedResourcePath` — ensure blob route.
    static func normalizeProtectedResourcePath(_ source: String, baseURL: URL?) -> String {
        var path = source
        if let base = baseURL?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
           path.hasPrefix(base + "/")
        {
            path = String(path.dropFirst(base.count))
        }
        if path.hasPrefix("http://") || path.hasPrefix("https://"),
           let url = URL(string: path)
        {
            path = url.path
        }
        guard path.hasPrefix("/api/v1/resources/") else { return path }
        if path.range(of: #"/blob(?:$|[?#])"#, options: .regularExpression) != nil {
            return path
        }
        if let match = path.range(of: #"^/api/v1/resources/[^/?#]+"#, options: .regularExpression) {
            return String(path[match]) + "/blob"
        }
        return path
    }

    static func isProtectedResourceSource(_ source: String, baseURL: URL?) -> Bool {
        // Match Android / editor JS: any path that points at the protected resources API.
        if source.hasPrefix("/api/v1/resources/") { return true }
        if source.contains("/api/v1/resources/") { return true }
        if let base = baseURL?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
           source.hasPrefix(base + "/api/v1/resources/")
        {
            return true
        }
        return false
    }
}
