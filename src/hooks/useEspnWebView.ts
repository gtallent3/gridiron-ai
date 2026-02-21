import { useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

interface EspnCredentials {
  swid: string;
  espn_s2: string;
  leagueId?: string;
}

interface UseEspnWebViewOptions {
  onCredentials: (creds: EspnCredentials) => void;
  onError?: (msg: string) => void;
  onClose?: () => void;
}

/**
 * Injected JavaScript: renders a fixed green button at the bottom of every
 * ESPN page.  On tap it extracts the leagueId from the URL, sends it to
 * the native layer, then closes the WebView.  The native layer reads the
 * HttpOnly cookies (SWID, espn_s2) via getCookies() on close.
 */
const INJECTED_BUTTON_JS = `
(function() {
  if (document.getElementById('__gridirongm_btn')) return;

  var btn = document.createElement('div');
  btn.id = '__gridirongm_btn';
  btn.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
    'z-index:2147483647;background:#16a34a;color:#fff;padding:14px 28px;' +
    'border-radius:9999px;font-size:16px;font-weight:700;font-family:system-ui,sans-serif;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;text-align:center;' +
    'user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;';
  btn.textContent = '\\u2705 Extract Cookies for Gridiron GM';

  btn.addEventListener('click', function() {
    try {
      var leagueId = '';
      var match = window.location.href.match(/leagueId[=/](\\d+)/);
      if (match) leagueId = match[1];

      if (!leagueId) {
        var proceed = confirm(
          'League ID not found in the current URL.\\n\\n' +
          'Navigate to your league page first for auto-detection, ' +
          'or tap OK to continue without it (you can enter it manually).'
        );
        if (!proceed) return;
      }

      // Send leagueId to native, then close the WebView.
      // Native will read the HttpOnly cookies on close.
      try {
        window.mobileApp.postMessage({
          type: 'extract_cookies',
          leagueId: leagueId
        });
      } catch(ignored) {}

      btn.textContent = '\\u2705 Sent! Returning to app...';
      btn.style.background = '#166534';
      btn.style.pointerEvents = 'none';

      // Close WebView after brief visual confirmation
      setTimeout(function() {
        try { window.mobileApp.close(); } catch(ignored) {}
      }, 800);
    } catch (e) {
      alert('Error: ' + e);
    }
  });

  document.body.appendChild(btn);
})();
`;

export function useEspnWebView({ onCredentials, onError, onClose }: UseEspnWebViewOptions) {
  const openRef = useRef(false);

  const openEspnWebView = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      onError?.("WebView is only available in the native app.");
      return;
    }

    if (openRef.current) return;
    openRef.current = true;

    try {
      const { InAppBrowser } = await import("@capgo/inappbrowser");

      // Track the leagueId extracted by the injected JS
      let extractedLeagueId = "";
      // Track whether we already delivered credentials (to avoid double-fire)
      let delivered = false;

      // Track the latest URL so we can parse leagueId as a fallback
      let latestUrl = "";

      // Inject the green button on every page load
      const pageLoadHandle = await InAppBrowser.addListener(
        "browserPageLoaded",
        () => {
          InAppBrowser.executeScript({ code: INJECTED_BUTTON_JS }).catch(() => {});
        }
      );

      // Track URL changes so we have the leagueId even if postMessage fails
      const urlChangeHandle = await InAppBrowser.addListener(
        "urlChangeEvent",
        (event: { url: string }) => {
          latestUrl = event.url || "";
        }
      );

      // If postMessage works, capture the leagueId early
      const messageHandle = await InAppBrowser.addListener(
        "messageFromWebview",
        (event: any) => {
          // Data may be under event.detail or directly on event
          const data = event?.detail || event;
          if (data?.type === "extract_cookies") {
            extractedLeagueId = data.leagueId || "";
          }
        }
      );

      // The main extraction happens on close — read HttpOnly cookies natively
      const closeHandle = await InAppBrowser.addListener(
        "closeEvent",
        (event: { url?: string }) => {
          const closeUrl = event?.url || latestUrl;

          // Parse leagueId: prefer what JS sent, fall back to URL
          let leagueId = extractedLeagueId;
          if (!leagueId && closeUrl) {
            const match = closeUrl.match(/leagueId[=/](\d+)/);
            if (match) leagueId = match[1];
          }

          // Read HttpOnly cookies from native cookie store
          readCookiesAndDeliver(leagueId);
        }
      );

      async function readCookiesAndDeliver(leagueId: string) {
        cleanup();

        if (delivered) return;

        try {
          // Try espn.com first, then fantasy.espn.com as fallback
          let cookies = await InAppBrowser.getCookies({
            url: "https://www.espn.com",
            includeHttpOnly: true,
          });

          let swid = cookies["SWID"] || "";
          let espn_s2 = cookies["espn_s2"] || "";

          // Fallback: try fantasy subdomain
          if (!swid || !espn_s2) {
            cookies = await InAppBrowser.getCookies({
              url: "https://fantasy.espn.com",
              includeHttpOnly: true,
            });
            swid = swid || cookies["SWID"] || "";
            espn_s2 = espn_s2 || cookies["espn_s2"] || "";
          }

          if (swid && espn_s2) {
            delivered = true;
            onCredentials({ swid, espn_s2, leagueId: leagueId || undefined });
          } else {
            // No cookies found — user probably wasn't logged in
            onClose?.();
            onError?.("Could not find ESPN session cookies. Make sure you are logged into ESPN before tapping the extract button.");
          }
        } catch (err: any) {
          onClose?.();
          onError?.(err?.message || "Failed to read cookies");
        }
      }

      const cleanup = () => {
        openRef.current = false;
        pageLoadHandle.remove();
        urlChangeHandle.remove();
        messageHandle.remove();
        closeHandle.remove();
      };

      await InAppBrowser.openWebView({
        url: "https://www.espn.com/fantasy/football/",
        title: "ESPN Login",
        toolbarType: "navigation" as any,
        backgroundColor: "black" as any,
        isPresentAfterPageLoad: false,
      });
    } catch (err: any) {
      openRef.current = false;
      onError?.(err?.message || "Failed to open WebView");
    }
  }, [onCredentials, onError, onClose]);

  return { openEspnWebView };
}
