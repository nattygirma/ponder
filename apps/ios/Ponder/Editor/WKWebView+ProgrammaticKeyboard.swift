import ObjectiveC
import UIKit
import WebKit

/// WKWebView defaults to "keyboard only after a user tap".
/// Programmatic TipTap/ProseMirror `focus()` then draws a caret but **never** raises the IME —
/// the same issue React Native WebView solves with `keyboardDisplayRequiresUserAction={false}`.
///
/// We install a one-time method override on the internal WK content view so
/// `_elementDidFocus:…userIsInteracting:…` always reports `userIsInteracting = true`.
/// This matches RNCWebViewImpl's well-known approach (iOS 13+ selector).
enum WKWebViewProgrammaticKeyboard {
    private static var installedClassName: String?
    private static var pending = false

    /// Call once the web view has a content subview (after first layout / load).
    static func allowProgrammaticKeyboard(on webView: WKWebView) {
        if installedClassName != nil { return }
        if pending { return }

        guard let contentView = contentView(in: webView) else {
            pending = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                pending = false
                allowProgrammaticKeyboard(on: webView)
            }
            return
        }

        let cls: AnyClass = type(of: contentView)
        let className = NSStringFromClass(cls)
        if installedClassName == className { return }

        // iOS 13+ (still used on current SDKs by react-native-webview).
        let selector = sel_getUid(
            "_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:"
        )
        guard let method = class_getInstanceMethod(cls, selector) else {
            #if DEBUG
            NSLog("WKWebViewProgrammaticKeyboard: selector missing on \(className)")
            #endif
            return
        }

        let original = method_getImplementation(method)
        typealias OriginalFn = @convention(c) (
            AnyObject, Selector, UnsafeRawPointer?, Bool, Bool, Bool, AnyObject?
        ) -> Void

        let block: @convention(block) (
            AnyObject, UnsafeRawPointer?, Bool, Bool, Bool, AnyObject?
        ) -> Void = { me, arg0, _, arg2, arg3, arg4 in
            let fn = unsafeBitCast(original, to: OriginalFn.self)
            // Force userIsInteracting = true so the software keyboard is allowed.
            fn(me, selector, arg0, true, arg2, arg3, arg4)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
        installedClassName = className
        #if DEBUG
        NSLog("WKWebViewProgrammaticKeyboard: installed on \(className)")
        #endif
    }

    /// Prefer the internal content view as first responder (WKWebView itself often refuses).
    @discardableResult
    static func becomeFirstResponder(for webView: WKWebView) -> Bool {
        allowProgrammaticKeyboard(on: webView)
        if let content = contentView(in: webView), content.becomeFirstResponder() {
            return true
        }
        return webView.becomeFirstResponder()
    }

    private static func contentView(in webView: WKWebView) -> UIView? {
        webView.scrollView.subviews.first { view in
            NSStringFromClass(type(of: view)).hasPrefix("WK")
        }
    }
}
