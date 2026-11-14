// Netlify Edge Function: /solutions-copy — the solutions, while the database is off.
//
// Holds every published solution as of the last deploy: `python minify.py
// --deploy` reads them from this course's database (the columns Go offline
// downloads, without each figure's TikZ source, which the page never draws
// from), compresses them with brotli and fills COPY in below. So the copy is
// never a file of the site: nothing can download it except through here.
//
// It is handed out only while this function's own check finds the database
// off: databaseState() from db-status.ts, the same test /db-status answers
// with. While the database is up the answer is a plain 404, whoever asks and
// whatever they send, so the copy can't be read then. The page
// (js/solutions.js) asks only when its indicator already says the database is
// offline, and only once a solution is wanted.
//
// The body goes out still compressed, as "content-encoding: br": the browser
// unpacks it and this function never does. Every browser takes brotli over
// HTTPS; a client that doesn't say so gets 406 rather than bytes it can't read.
// Nothing here is cached by Netlify or the browser (no-store), so each answer
// follows the database's state at that moment.

import { COURSE, databaseState } from "./db-status.ts";

interface Copy {
  course: string;
  projectRef: string;
  builtAt: string;   // ISO time the rows were read
  count: number;     // rows in the copy
  br: string;        // base64 of the brotli-compressed JSON { course, projectRef, builtAt, rows }
}
// minify.py --deploy replaces this null with the copy. Left null (a plain
// checkout, or a deploy that couldn't get one): always 404.
// (The cast keeps TypeScript from reading the unfilled null as "never".)
const COPY = (null /* <solutions-copy> */) as Copy | null;

let body: Uint8Array<ArrayBuffer> | null = null;   // decoded once per instance
function copyBytes(copy: Copy): Uint8Array<ArrayBuffer> {
  if (!body) {
    const bin = atob(copy.br);
    body = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) body[i] = bin.charCodeAt(i);
  }
  return body;
}

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export default async (request: Request) => {
  if (request.method !== "GET") return answer(405, "Method not allowed");
  if (!COPY || !COURSE) return answer(404, "Not found");
  if ((await databaseState(COURSE)) === "up") return answer(404, "Not found");
  if (!/\bbr\b/.test(request.headers.get("accept-encoding") || "")) return answer(406, "Needs brotli (accept-encoding: br)");
  return new Response(copyBytes(COPY), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "br",
      "cache-control": "no-store",
      "netlify-cdn-cache-control": "no-store",
      "vary": "accept-encoding",
      "x-copy-built-at": COPY.builtAt,
    },
  });
};

export const config = { path: "/solutions-copy" };
