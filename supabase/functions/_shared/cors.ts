// Shared CORS configuration for all Edge Functions
// Only allow requests from known origins

const ALLOWED_ORIGINS = [
  "https://gridiron-gm.com",
  "https://www.gridiron-gm.com",
  "capacitor://localhost",   // iOS Capacitor
  "http://localhost",        // Android Capacitor
  "http://localhost:8080",   // Local dev server
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
