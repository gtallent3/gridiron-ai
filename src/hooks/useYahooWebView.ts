import { useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

const REDIRECT_HOST = "https://gridiron-gm.com/connect-league";

interface UseYahooWebViewOptions {
  onCode: (code: string, state: string | null) => void;
  onError?: (msg: string) => void;
  onClose?: () => void;
}

export function useYahooWebView({ onCode, onError, onClose }: UseYahooWebViewOptions) {
  const openRef = useRef(false);

  const openYahooOAuth = useCallback(async (authUrl: string) => {
    if (!Capacitor.isNativePlatform()) {
      onError?.("WebView is only available in the native app.");
      return;
    }

    if (openRef.current) return;
    openRef.current = true;

    try {
      const { InAppBrowser } = await import("@capgo/inappbrowser");

      let delivered = false;

      const urlChangeHandle = await InAppBrowser.addListener(
        "urlChangeEvent",
        async (event: { url: string }) => {
          const url = event.url || "";
          if (!url.startsWith(REDIRECT_HOST)) return;
          if (delivered) return;
          delivered = true;

          const params = new URL(url).searchParams;
          const code = params.get("code");
          const state = params.get("state");

          cleanup();
          try {
            await InAppBrowser.close();
          } catch (_) {}

          if (code) {
            onCode(code, state);
          } else {
            onError?.("Yahoo did not return an authorization code.");
          }
        }
      );

      const closeHandle = await InAppBrowser.addListener(
        "closeEvent",
        () => {
          cleanup();
          if (!delivered) {
            onClose?.();
          }
        }
      );

      const cleanup = () => {
        openRef.current = false;
        urlChangeHandle.remove();
        closeHandle.remove();
      };

      await InAppBrowser.openWebView({
        url: authUrl,
        title: "Yahoo Login",
        toolbarType: "navigation",
        backgroundColor: "black",
        isPresentAfterPageLoad: false,
      });
    } catch (err: any) {
      openRef.current = false;
      onError?.(err?.message || "Failed to open WebView");
    }
  }, [onCode, onError, onClose]);

  return { openYahooOAuth };
}
