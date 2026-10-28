// Netlify Edge Function: /s/<problem_key> — a shared solution link.
//
// The Share button on a solution copies https://<site>/s/q3_P148i. Link
// previews (Telegram, WhatsApp, Discord, iMessage, X, …) are made by
// crawlers that read the page's <meta> tags and never run JavaScript, so
// this answers with a tiny page carrying that solution's own tags: its
// title, its description and the picture the editor drew when it was
// published (migration 012, editor/share-card.js). The same page sends a
// person on to /?solution=q3_P148i straight away, where the site opens it.
//
// A crawler never runs the redirect script, so it stays on these tags; a
// meta refresh is deliberately not used, as some crawlers follow it to the
// plain site page and preview that instead.
//
// No picture yet, unpublished, or the database unreachable: the site's own
// preview, and the link still opens the solution (or the site, which then
// says the solution is not published).
//
// Visitors who have the site installed never reach this: sw.js redirects
// /s/ links itself.
//
// Deployed with the site by `python minify.py --deploy` (Netlify CLI), which
// fills COURSE in from js/course-config.js for the course in index.html's
// <head data-course>. A zip uploaded by hand doesn't deploy edge functions.

interface Course {
  supabaseUrl: string;
  publishableKey: string;
  shareTitle: string;   // "Impulse Practice App"
  description: string;  // the site's own og:description
}
// minify.py --deploy replaces the "null" string with this course's values.
const COURSE: Course | null = JSON.parse("null");

const KEY_RE = /^q[1-9][0-9]?_[A-Za-z][A-Za-z0-9_-]{0,30}$/; // as solutions-admin's PROBLEM_KEY_RE

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Share { image?: string; title?: string; description?: string }

// The published row's share card, or null. Never throws, and gives up
// after 3 s: a slow database must not hold a crawler (or a person) up.
async function shareOf(key: string): Promise<Share | null> {
  if (!COURSE) return null;
  try {
    const res = await fetch(
      `${COURSE.supabaseUrl}/rest/v1/problem_solutions?select=share&problem_key=eq.${key}&status=eq.published&limit=1`,
      {
        headers: { apikey: COURSE.publishableKey, Authorization: `Bearer ${COURSE.publishableKey}` },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return (rows && rows[0] && rows[0].share) || null;
  } catch {
    return null;
  }
}

export default async (request: Request) => {
  const url = new URL(request.url);
  let key = "";
  try { key = decodeURIComponent(url.pathname.slice("/s/".length).replace(/\/+$/, "")); } catch { /* bad escape */ }
  if (!KEY_RE.test(key)) return Response.redirect(new URL("/", url).href, 302);

  const target = new URL(`/?solution=${encodeURIComponent(key)}`, url).href;
  const share = await shareOf(key);
  const title = share?.title || COURSE?.shareTitle || "";
  const description = share?.description || COURSE?.description || "";
  const image = share?.image && COURSE
    ? `${COURSE.supabaseUrl}/storage/v1/object/public/share-cards/${encodeURIComponent(share.image)}`
    : new URL("/course/preview.png", url).href;
  const size = share?.image
    ? `<meta property="og:image:width" content="1280"><meta property="og:image:height" content="720">` + // IMAGE_W in editor/share-card.js
      `<meta property="og:image:type" content="image/jpeg">`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(COURSE?.shareTitle || "")}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta property="og:image" content="${esc(image)}">${size}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")})</script>
</head><body><p><a href="${esc(target)}">Open the solution</a></p></body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      // Netlify's CDN keeps each link's page for 5 minutes, so a link that
      // is passed around runs this (and asks the database) once per 5
      // minutes, not once per crawler and click. A new picture shows up in
      // fresh previews within that time.
      "netlify-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
};

export const config = { path: "/s/*", cache: "manual" };
