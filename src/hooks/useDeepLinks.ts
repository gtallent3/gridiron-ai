import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

export interface EspnDeepLinkData {
  swid: string;
  espn_s2: string;
  leagueId?: string;
}

type EspnDeepLinkListener = (data: EspnDeepLinkData) => void;

// Simple event bus so EspnCookieExtractor can subscribe when its dialog is open
const listeners = new Set<EspnDeepLinkListener>();

export function onEspnDeepLink(cb: EspnDeepLinkListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function parseEspnDeepLink(url: string): EspnDeepLinkData | null {
  try {
    // URL format: gridirongm://espn-login?swid=XXX&espn_s2=YYY&leagueId=ZZZ
    const parsed = new URL(url);
    if (parsed.hostname !== "espn-login" && parsed.pathname !== "//espn-login") {
      return null;
    }
    const swid = decodeURIComponent(parsed.searchParams.get("swid") || "");
    const espn_s2 = decodeURIComponent(parsed.searchParams.get("espn_s2") || "");
    if (!swid || !espn_s2) return null;
    const leagueId = parsed.searchParams.get("leagueId") || undefined;
    return { swid, espn_s2, leagueId };
  } catch {
    return null;
  }
}

export function useDeepLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    import("@capacitor/app").then(({ App }) => {
      const handle = App.addListener("appUrlOpen", (event: { url: string }) => {
        const data = parseEspnDeepLink(event.url);
        if (!data) return;

        if (listeners.size > 0) {
          // EspnCookieExtractor dialog is open — deliver directly
          listeners.forEach((cb) => cb(data));
        } else {
          // No active listener — navigate to connect-league with credentials
          navigate("/connect-league", {
            state: { espnCredentials: data },
          });
        }
      });

      cleanup = () => {
        handle.then((h) => h.remove());
      };
    }).catch(() => {
      // @capacitor/app not available — skip silently
    });

    return () => cleanup?.();
  }, [navigate]);
}
