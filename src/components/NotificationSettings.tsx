import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface Preferences {
  trade_proposals: boolean;
  waiver_deadlines: boolean;
  game_day_lineup: boolean;
  weekly_recap: boolean;
}

const DEFAULT_PREFS: Preferences = {
  trade_proposals: true,
  waiver_deadlines: true,
  game_day_lineup: true,
  weekly_recap: true,
};

export function NotificationSettings() {
  const { permissionStatus, requestPermission, isNative } = usePushNotifications();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        setPrefs({
          trade_proposals: data.trade_proposals ?? true,
          waiver_deadlines: data.waiver_deadlines ?? true,
          game_day_lineup: data.game_day_lineup ?? true,
          weekly_recap: data.weekly_recap ?? true,
        });
      }
    } catch (err) {
      console.error("Failed to fetch notification preferences:", err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async (newPrefs: Preferences) => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await supabase.from("notification_preferences").upsert({
        user_id: session.user.id,
        ...newPrefs,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to save notification preferences:", err);
    } finally {
      setSaving(false);
    }
  };

  const togglePref = (key: keyof Preferences) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);
    savePreferences(newPrefs);
  };

  const prefItems: { key: keyof Preferences; label: string; description: string }[] = [
    { key: "trade_proposals", label: "Trade Proposals", description: "Get notified about new trade offers" },
    { key: "waiver_deadlines", label: "Waiver Deadlines", description: "Reminders before waiver wire closes" },
    { key: "game_day_lineup", label: "Game Day Lineup", description: "Lineup reminders before kickoff" },
    { key: "weekly_recap", label: "Weekly Recap", description: "Summary of your team's performance" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isNative && (
          <p className="text-sm text-muted-foreground">
            Push notifications are available on the iOS and Android app. Download the app to enable notifications.
          </p>
        )}

        {isNative && permissionStatus !== "granted" && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
            <div className="flex items-center gap-2">
              <BellOff className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Notifications are not enabled</span>
            </div>
            <Button size="sm" onClick={requestPermission}>
              Enable
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {prefItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Switch
                  checked={prefs[item.key]}
                  onCheckedChange={() => togglePref(item.key)}
                  disabled={saving}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
