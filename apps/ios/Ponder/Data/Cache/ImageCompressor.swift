import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ImageCompressor {
    /// Android `prepareUploadAsset` parity: max edge 2560, quality ~0.82, prefer **WebP**.
    /// GIF is left untouched (same as Android compressible-type list).
    static func compressIfNeeded(
        _ data: Data,
        maxEdge: CGFloat = 2560,
        quality: CGFloat = 0.82
    ) -> (data: Data, mimeType: String, filename: String) {
        // Android skips GIF / non-raster; keep animated GIFs intact.
        if isGif(data) {
            return (data, "image/gif", "image.gif")
        }

        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            return (data, "application/octet-stream", "upload.bin")
        }

        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let longest = max(width, height)
        let scale = longest > maxEdge ? maxEdge / longest : 1
        let targetSize = CGSize(
            width: max(1, floor(width * scale)),
            height: max(1, floor(height * scale))
        )

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        // PremultipliedLast works for WebP/JPEG encode; drop alpha into white-ish premultiply.
        guard let context = CGContext(
            data: nil,
            width: Int(targetSize.width),
            height: Int(targetSize.height),
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return encodeJPEGFallback(cgImage: cgImage, quality: quality)
                ?? (data, "image/jpeg", "image.jpg")
        }
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(origin: .zero, size: targetSize))
        guard let scaled = context.makeImage() else {
            return encodeJPEGFallback(cgImage: cgImage, quality: quality)
                ?? (data, "image/jpeg", "image.jpg")
        }

        // Prefer WebP (smaller than JPEG at similar quality — Android default).
        if let webp = encode(cgImage: scaled, type: .webP, quality: quality) {
            return (webp, "image/webp", "image.webp")
        }
        // Fallback if WebP destination is unavailable on this OS build.
        if let jpeg = encode(cgImage: scaled, type: .jpeg, quality: quality) {
            return (jpeg, "image/jpeg", "image.jpg")
        }
        return (data, "image/jpeg", "image.jpg")
    }

    private static func encode(cgImage: CGImage, type: UTType, quality: CGFloat) -> Data? {
        let mutable = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(
            mutable,
            type.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }
        CGImageDestinationAddImage(
            dest,
            cgImage,
            [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        )
        guard CGImageDestinationFinalize(dest), mutable.length > 0 else {
            return nil
        }
        return mutable as Data
    }

    private static func encodeJPEGFallback(cgImage: CGImage, quality: CGFloat) -> (data: Data, mimeType: String, filename: String)? {
        guard let jpeg = encode(cgImage: cgImage, type: .jpeg, quality: quality) else { return nil }
        return (jpeg, "image/jpeg", "image.jpg")
    }

    private static func isGif(_ data: Data) -> Bool {
        data.starts(with: [0x47, 0x49, 0x46, 0x38]) // GIF8
    }
}
