import Foundation
import WebKit

/// In-memory blob map so WKWebView can load authenticated images via a custom scheme
/// without embedding multi-megabyte data: URLs into evaluateJavaScript strings.
actor ResourceBlobStore {
    static let shared = ResourceBlobStore()

    private var blobs: [String: (data: Data, mimeType: String)] = [:]

    func put(id: String, data: Data, mimeType: String) {
        blobs[id] = (data, mimeType)
    }

    func get(id: String) -> (data: Data, mimeType: String)? {
        blobs[id]
    }

    func remove(id: String) {
        blobs[id] = nil
    }
}

/// Serves `ponder-res://local/<resourceId>` image bytes into the TipTap WKWebView.
final class PonderResourceSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    static let scheme = "ponder-res"

    /// Build a short local URL for a cached resource id.
    static func localURL(for resourceId: String) -> String {
        let encoded = resourceId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? resourceId
        return "\(scheme)://local/\(encoded)"
    }

    static func resourceId(from url: URL) -> String? {
        guard url.scheme == scheme else { return nil }
        // ponder-res://local/<id>
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !path.isEmpty else { return nil }
        return path.removingPercentEncoding ?? path
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let id = Self.resourceId(from: url)
        else {
            urlSchemeTask.didFailWithError(
                NSError(domain: "PonderResource", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid resource URL"])
            )
            return
        }

        Task {
            guard let entry = await ResourceBlobStore.shared.get(id: id) else {
                urlSchemeTask.didFailWithError(
                    NSError(domain: "PonderResource", code: 404, userInfo: [NSLocalizedDescriptionKey: "Resource not cached"])
                )
                return
            }
            // HTTPURLResponse is more reliable for <img> loads than plain URLResponse
            // (especially for non-bitmap types served through a custom scheme).
            let headers: [String: String] = [
                "Content-Type": entry.mimeType,
                "Content-Length": String(entry.data.count),
                "Access-Control-Allow-Origin": "*",
            ]
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            ) else {
                urlSchemeTask.didFailWithError(
                    NSError(domain: "PonderResource", code: 500, userInfo: [NSLocalizedDescriptionKey: "Bad response"])
                )
                return
            }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(entry.data)
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No long-running network task to cancel; blobs are already in memory.
    }
}
