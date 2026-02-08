// Shared CORS configuration for all Edge Functions
// Only allow requests from known origins

const ALLOWED_ORIGINS = [
  "https://gridiron-gm.com",
  "https://www.gridiron-gm.com",
  "https://gridiron-ai.lovable.app",
  "capacitor://localhost",   // iOS Capacitor
  "http://localhost",        // Android Capacitor
  "http://localhost:8080",   // Local dev server
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  // Also allow Lovable preview origins (wildcard match)
  const isLovablePreview = origin.endsWith(".lovable.app");
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) || isLovablePreview ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
