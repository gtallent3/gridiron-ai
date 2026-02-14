import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Dynamically import PushNotifications only on native platforms
let PushNotifications: any = null;

export function usePushNotifications() {
  const [permissionStatus, setPermissionStatus] = useState<"prompt" | "granted" | "denied" | "unknown">("unknown");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Lazy load the plugin
    import("@capacitor/push-notifications").then((mod) => {
      PushNotifications = mod.PushNotifications;
      checkPermission();
      registerListeners();
    }).catch(() => {
      // Plugin not installed — skip silently
    });
  }, []);

  const checkPermission = async () => {
    if (!PushNotifications) return;
    try {
      const result = await PushNotifications.checkPermissions();
      setPermissionStatus(result.receive);
    } catch {
      setPermissionStatus("unknown");
    }
  };

  const requestPermission = async () => {
    if (!PushNotifications) return false;
    try {
      const result = await PushNotifications.requestPermissions();
      setPermissionStatus(result.receive);
      if (result.receive === "granted") {
        await PushNotifications.register();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const registerListeners = () => {
    if (!PushNotifications) return;

    PushNotifications.addListener("registration", async (tokenData: { value: string }) => {
      setToken(tokenData.value);
      await storeToken(tokenData.value);
    });

    PushNotifications.addListener("registrationError", (error: any) => {
      console.error("Push registration error:", error);
    });

    PushNotifications.addListener("pushNotificationReceived", (notification: any) => {
      console.log("Push received:", notification);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action: any) => {
      console.log("Push action:", action);
    });
  };

  const storeToken = async (deviceToken: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const platform = Capacitor.getPlatform(); // 'ios' | 'android'
      await supabase.from("device_tokens").upsert(
        {
          user_id: session.user.id,
          platform,
          token: deviceToken,
          is_active: true,
        },
        { onConflict: "user_id,token" }
      );
    } catch (err) {
      console.error("Failed to store device token:", err);
    }
  };

  return {
    permissionStatus,
    token,
    requestPermission,
    isNative: Capacitor.isNativePlatform(),
  };
}
