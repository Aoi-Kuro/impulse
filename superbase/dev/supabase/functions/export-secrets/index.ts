// TEMPORARY — returns EVERY environment variable the project's Edge
// Functions see: all secrets set in the dashboard (PIN_PEPPER,
// DEVICE_SECRET_PEPPER, ...) plus the ones Supabase adds itself
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, ...).
//
// For recovering secrets whose values were never written down (the
// dashboard shows only a digest). Deploy to the OLD project, call it once,
// then delete the function and the EXPORT_TOKEN secret. Kept in
// superbase/dev/ so it is never deployed with the real functions.
//
// Answers 404 unless ?token= matches the EXPORT_TOKEN secret (min. 20 chars).

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve((req) => {
  const expected = Deno.env.get("EXPORT_TOKEN");
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!expected || expected.length < 20 || !timingSafeEqual(token, expected)) {
    return new Response("Not found", { status: 404 });
  }
  const env = Deno.env.toObject();
  delete env.EXPORT_TOKEN;
  const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  return new Response(JSON.stringify(sorted, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
