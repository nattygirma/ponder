import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { SAFE_DOM_WEBVIEW_PROPS } from "../lib/mobile-dom";
import type { MobileRenderedWebPage } from "../lib/mobile-web-clip";

type MobileWebClipCaptureProps = {
  onCaptured: (page: MobileRenderedWebPage) => void;
  onFailed: (message: string) => void;
  url: string;
};

type CaptureMessage =
  | {
      contentHtml: string;
      finalUrl: string;
      status: "captured";
      title: string;
    }
  | {
      message: string;
      status: "failed";
    };

const CAPTURE_SCRIPT = `
  (function () {
    var attempts = 0;
    var completed = false;

    function post(payload) {
      if (completed) return;
      completed = true;
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    function text(selector) {
      var element = document.querySelector(selector);
      return element && element.textContent ? element.textContent.trim() : "";
    }

    function capture() {
      var content = document.getElementById("js_content")
        || document.querySelector("article")
        || document.querySelector("main");
      var contentText = content && content.textContent ? content.textContent.trim() : "";

      if (content && contentText) {
        var titleMeta = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
        post({
          status: "captured",
          title: (titleMeta && titleMeta.getAttribute("content"))
            || text("#activity-name")
            || text(".rich_media_title")
            || document.title
            || "",
          contentHtml: content.innerHTML,
          finalUrl: window.location.href
        });
        return;
      }

      var errorText = text(".weui-msg__title") || text(".weui-msg__desc");
      if (errorText) {
        post({ status: "failed", message: errorText });
        return;
      }

      attempts += 1;
      if (attempts >= 50) {
        post({ status: "failed", message: "The page finished loading, but there was no article text to clip." });
        return;
      }
      window.setTimeout(capture, 250);
    }

    capture();
  })();
  true;
`;

export default function MobileWebClipCapture({
  onCaptured,
  onFailed,
  url,
}: MobileWebClipCaptureProps) {
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    const timeout = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onFailed("The WeChat article took too long to load.");
      }
    }, 20_000);
    return () => clearTimeout(timeout);
  }, [onFailed, url]);

  const fail = (message: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onFailed(message);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    if (completedRef.current) return;
    try {
      const message = JSON.parse(event.nativeEvent.data) as CaptureMessage;
      if (message.status === "captured" && message.contentHtml.trim()) {
        completedRef.current = true;
        onCaptured({
          contentHtml: message.contentHtml,
          finalUrl: message.finalUrl,
          title: message.title,
        });
        return;
      }
      fail(message.status === "failed" ? message.message : "No article text was found to clip.");
    } catch {
      fail("Could not read the WeChat article text.");
    }
  };

  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        {...SAFE_DOM_WEBVIEW_PROPS}
        domStorageEnabled
        injectedJavaScript={CAPTURE_SCRIPT}
        javaScriptEnabled
        mixedContentMode="compatibility"
        onError={(event) => fail(event.nativeEvent.description || "Could not load the WeChat article.")}
        onHttpError={(event) => fail(`The WeChat article request failed (HTTP ${event.nativeEvent.statusCode}).`)}
        onMessage={handleMessage}
        originWhitelist={["https://*", "http://*"]}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled
        source={{ uri: url }}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    height: 2,
    left: 0,
    opacity: 0.01,
    overflow: "hidden",
    position: "absolute",
    top: 0,
    width: 2,
  },
  webView: {
    height: 2,
    width: 2,
  },
});
