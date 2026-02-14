import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, title, body, data } = await req.json();
    if (!userId || !title || !body) {
      throw new Error("userId, title, and body are required");
    }

    // Check user's notification preferences
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // Get active device tokens
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token, platform")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!tokens?.length) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "no_active_tokens" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sent = 0;

    // Send via FCM (supports both Android and iOS via APNs bridge)
    if (fcmServerKey) {
      for (const { token } of tokens) {
        try {
          const resp = await fetch("https://fcm.googleapis.com/fcm/send", {
            method: "POST",
            headers: {
              "Authorization": `key=${fcmServerKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: token,
              notification: { title, body },
              data: data || {},
            }),
          });

          if (resp.ok) {
            sent++;
          } else {
            const errText = await resp.text();
            console.error(`FCM send failed for token ${token.substring(0, 10)}...: ${errText}`);

            // Deactivate invalid tokens
            if (resp.status === 404 || errText.includes("NotRegistered")) {
              await supabase
                .from("device_tokens")
                .update({ is_active: false })
                .eq("token", token);
            }
          }
        } catch (err) {
          console.error("FCM send error:", err);
        }
      }
    } else {
      console.warn("FCM_SERVER_KEY not configured — notifications not sent");
    }

    return new Response(
      JSON.stringify({ success: true, sent, total_tokens: tokens.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
