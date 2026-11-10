import Foundation

extension URL {
    /// Strip trailing slashes for stable instance keys / API base URLs.
    var ponderNormalizedBase: URL {
        var absolute = absoluteString
        while absolute.hasSuffix("/") {
            absolute.removeLast()
        }
        return URL(string: absolute) ?? self
    }
}

enum PonderPublicDemo {
    static let instanceURLString = "https://appkeep.io"
}

enum PonderURLNormalizer {
    static func normalizeInstanceURL(_ raw: String) throws -> URL {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw PonderURLError.empty
        }
        if !trimmed.contains("://") {
            trimmed = "https://\(trimmed)"
        }
        guard var components = URLComponents(string: trimmed), let host = components.host, !host.isEmpty else {
            throw PonderURLError.invalid
        }
        if host.lowercased() == "demo" {
            components.scheme = "https"
            components.host = "appkeep.io"
        }
        components.fragment = nil
        components.query = nil
        guard let url = components.url else {
            throw PonderURLError.invalid
        }
        return url.ponderNormalizedBase
    }
}

enum PonderURLError: LocalizedError {
    case empty
    case invalid

    var errorDescription: String? {
        switch self {
        case .empty:
            return "Instance URL is required."
        case .invalid:
            return "Instance URL is invalid."
        }
    }
}
