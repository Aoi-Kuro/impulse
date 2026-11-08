// Netlify Edge Function: /db-status — is the course database on?
//
// Answers { "state": "up" | "paused" | "down" }. js/db-status.js asks only
// after a request to Supabase has failed, so a healthy site never calls this.
//
// This has to run on a server. A paused Supabase project has no DNS record at
// all: its hostname stops existing, so nothing answers and the 540 "project
// paused" status in Supabase's docs never arrives. A browser sees that as
// "Failed to fetch", exactly like a dead network, and scripts can't look at
// DNS. Measured 2026-11-07 on a paused project: NXDOMAIN from Cloudflare's own
// nameservers, for A and AAAA alike. A deleted project looks the same, and
// the site would say "paused" for that too.
//
// So "paused" is only ever said on proof: a 540, or DNS saying the name does
// not exist. A timeout, a 5xx, or a resolver that can't be reached is "down".
//
// The answer doesn't depend on who asks, so Netlify's CDN keeps it for 60 s:
// however many tabs ask, the database is probed about once a minute.
//
// Deployed with the site by `python minify.py --deploy`, which fills COURSE
// in from js/course-config.js, as for share.ts.

interface Course {
  supabaseUrl: string;
  publishableKey: string;
}
// minify.py --deploy replaces the "null" string with this course's values.
const COURSE: Course | null = JSON.parse("null");

type State = "up" | "paused" | "down";

const RESOLVERS = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"];
const DNS_NOERROR = 0;
const DNS_NXDOMAIN = 3;

// True only when a resolver says the name doesn't exist. Both resolvers
// unreachable is not proof of anything, so that's false.
async function hostnameMissing(hostname: string): Promise<boolean> {
  for (const resolver of RESOLVERS) {
    try {
      const res = await fetch(`${resolver}?name=${hostname}&type=A`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(2000),
      });
      const { Status } = await res.json();
      if (Status === DNS_NXDOMAIN) return true;
      if (Status === DNS_NOERROR) return false;
    } catch { /* try the next one */ }
  }
  return false;
}

// One row of a table the site reads anyway, so this goes through the gateway,
// PostgREST and Postgres. Any answer under 500 means the database replied (a
// 404 is a course without that table yet), except 402, Supabase's "project
// restricted".
async function databaseState(course: Course): Promise<State> {
  try {
    const res = await fetch(`${course.supabaseUrl}/rest/v1/problem_solutions?select=id&limit=1`, {
      headers: { apikey: course.publishableKey, Authorization: `Bearer ${course.publishableKey}` },
      signal: AbortSignal.timeout(4000),
    });
    await res.body?.cancel();
    if (res.status === 540) return "paused";
    return res.status < 500 && res.status !== 402 ? "up" : "down";
  } catch {
    return (await hostnameMissing(new URL(course.supabaseUrl).hostname)) ? "paused" : "down";
  }
}

export default async () => {
  // Not filled in: js/db-status.js reads anything else as "nothing to report".
  const state = COURSE ? await databaseState(COURSE) : "unknown";
  return new Response(JSON.stringify({ state }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, s-maxage=60",
    },
  });
};

export const config = { path: "/db-status", cache: "manual" };
