// ── Persistent MathJax render cache (IndexedDB) ──
// Typesetting is the expensive part of opening Solve-All, not building the
// cards. Once a problem's LaTeX has been typeset, we cache the resulting
// HTML for its .problem-text, alongside the specific CSS rules that HTML
// actually needs (the glyph definitions MathJax's CHTML output generates
// dynamically) — keyed by a hash of the problem's own source text. A later
// visit can then drop the already-typeset HTML straight into the DOM,
// along with its own CSS, and skip MathJax entirely for that card.
//
// Each cache entry is a fully self-contained {hash, html, css} bundle,
// captured together in one atomic step at typeset time (see
// extractCssForHtml + storeCachedMathHTML). There is deliberately no
// separate, shared, cross-session stylesheet accumulator: an earlier
// design kept one, merging each session's fresh CSS into a single
// growing blob, and repeatedly proved fragile — timing gaps around when
// it got persisted, and no way for it to self-correct or even get reset
// by "Rerender Equations" if a merge ever went wrong. Bundling CSS with
// its own HTML removes that whole class of bug: if a card's HTML is
// correct, its CSS is provably correct too, because nothing else can
// have touched either one independently.
//
// If a problem's text is ever edited, its hash changes, the cache misses
// automatically, and it re-renders + re-caches (new HTML, new CSS,
// together) — no manual invalidation needed.
//
// Cache keys are scoped per-quiz by the caller (see mathCacheKeyFor in
// quiz-engine.js) since problem ids like "P1" repeat across quizzes —
// this file just stores whatever key it's given.
//
// Bump MATH_CACHE_SCHEMA if the card markup or render pipeline changes in
// a way that would make old cached HTML stale/incompatible.

const MATH_CACHE_DB = 'mathRenderCache';
// bumped to 5: old entries were {hash, html} pairs with no css field, and
// CSS used to live in a separate, shared, accumulated 'meta'/'styles'
// blob (see file header above for why that was replaced). Old entries
// are a different, incompatible shape — clear them out so nothing old
// gets restored without the CSS it needs.
// bumped to 7: entries written before this version could end up with
// incomplete or empty css — extractCssForHtml ran immediately after a
// batch's own typesetPromise resolved, before MathJax's dynamic
// stylesheet had necessarily caught up with what that batch just added.
// cacheTypesetBatch/renderMathInBatches now sequence a frame tick first,
// plus a final catch-up pass (finalizeFreshMathCache) after the whole
// render finishes, to close that gap. This bump clears out anything
// written before the fix so it gets rebuilt correctly.
// bumped to 8: extraction was reading the MathJax stylesheet element's
// .textContent, which — confirmed via instrumented logging across a
// full 150-card render — stays frozen at whatever it was when the
// element was first created. MathJax updates the live CSSOM directly
// (sheet.insertRule or equivalent), which repaints correctly on screen
// but never touches .textContent, so extraction was silently reading
// stale, near-empty content for the entire session, every session, no
// matter how the timing/schema/write-path fixes before this one
// changed. Fixed by reading styleEl.sheet.cssRules directly instead
// (see _glyphRulesFromStyleSheet). This bump clears out everything
// written under the broken versions.
// bumped to 10: extractCssForHtml only ever captured glyph rules (any
// rule whose selector contains a "mjx-c<hex>" class token, via
// MJX_GLYPH_CLASS_RE / _glyphKeyFromClassTokens) — it never looked at
// *structural* CHTML rules whose selector has no glyph-class token at
// all, e.g. "mjx-texatom { display: inline-block; text-align: left; }".
// That rule is what boxes/centers an accent's base under a stacked
// accent (\vec, \hat, etc.); confirmed via direct comparison against a
// live #MJX-CHTML-styles capture that it's present in the live sheet
// but absent from every cache-restored card's injected styles. Missing
// it doesn't corrupt any single glyph's own metrics (which is why the
// earlier per-glyph checks all came back clean) — instead the browser
// falls back to default (non-stacked) box sizing for mjx-mover/mjx-base,
// which is exactly the "arrow position fine, base glyph pushed right
// into an oversized box" symptom seen only on cache-restore. Fixed by
// also capturing every non-glyph structural rule from the live
// stylesheet into each card's cached css (see
// _structuralRulesFromStyleSheet). This bump clears out every entry
// cached before this fix so they all get rebuilt with the missing rule.
const MATH_CACHE_SCHEMA = 10;

let _mathCacheDB = null;
let _mathCacheMap = new Map();   // problemId -> { hash, html, css }
let _mathCacheReady = null;

function _mathCacheHash(str) {
  // djb2 — fast, good-enough distribution for change detection.
  // Not security-sensitive: worst case a hash collision just means a
  // stale render slips through, which MathJax's own typesetting would
  // visually reveal, and it's astronomically unlikely for this use case.
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// Deliberately opens with no explicit version number. We track our own
// logical schema by hand (MATH_CACHE_SCHEMA, a plain value checked in
// initMathCache below) instead of leaning on IndexedDB's own built-in
// version-bump mechanism — the two aren't the same thing, and pinning a
// hardcoded version number here caused a real outage: if this database
// was ever opened at a higher version by anything, anywhere, in this
// browser's history (including just testing an earlier build), every
// future indexedDB.open() call with a *lower* hardcoded number throws a
// VersionError, unconditionally, forever — which silently breaks every
// read and write with no visible symptom beyond "the cache never seems
// to work." Not specifying a version sidesteps that whole class of bug:
// this just opens whatever's already there (or creates it fresh at
// version 1 the very first time), and onupgradeneeded below creates the
// object stores if they're missing regardless of version number.
function _openMathCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MATH_CACHE_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function _mathCacheGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = _mathCacheDB.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function _mathCachePut(store, key, value) {
  return new Promise((resolve, reject) => {
    const tx = _mathCacheDB.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function _mathCacheGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = _mathCacheDB.transaction(store, 'readonly');
    const results = [];
    const req = tx.objectStore(store).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push([cursor.key, cursor.value]);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function _mathCacheClearAll() {
  return new Promise((resolve, reject) => {
    const tx = _mathCacheDB.transaction(['cards', 'meta'], 'readwrite');
    tx.objectStore('cards').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Loads everything into memory once so buildSolveAllCards can check the
// cache synchronously per-card instead of awaiting IndexedDB per problem.
// Safe to call repeatedly — returns the same in-flight/resolved promise.
function initMathCache() {
  if (_mathCacheReady) return _mathCacheReady;
  _mathCacheReady = (async () => {
    if (!window.indexedDB) return;
    try {
      _mathCacheDB = await _openMathCacheDB();
      const schema = await _mathCacheGet('meta', 'schemaVersion');
      console.log(`[mathcache:init] stored schemaVersion=${schema}, code expects ${MATH_CACHE_SCHEMA}`);
      if (schema !== MATH_CACHE_SCHEMA) {
        // Render pipeline changed since this cache was written — old
        // entries could be stale/incompatible, so start fresh.
        console.log('[mathcache:init] schema mismatch — clearing cache');
        await _mathCacheClearAll();
        await _mathCachePut('meta', 'schemaVersion', MATH_CACHE_SCHEMA);
        return;
      }
      const all = await _mathCacheGetAll('cards');
      for (const [id, entry] of all) _mathCacheMap.set(id, entry);
      console.log(`[mathcache:init] loaded ${all.length} cards from IndexedDB into memory`);
    } catch (err) {
      console.error('Math cache init error:', err);
    }
  })();
  return _mathCacheReady;
}

// Returns the cached {html, css} bundle for a problem if its source text
// hasn't changed since it was cached, else null. html is the already-
// typeset markup to drop straight into the DOM; css is the specific
// glyph rules that markup needs (see extractCssForHtml) — the caller is
// responsible for actually injecting css somewhere before/as the html is
// shown (see injectRestoredStyles below).
function getCachedMathHTML(problemId, sourceText) {
  const entry = _mathCacheMap.get(problemId);
  if (!entry) return null;
  return entry.hash === _mathCacheHash(sourceText) ? entry : null;
}

function mathCacheHashOf(sourceText) {
  return _mathCacheHash(sourceText);
}

// Matches the dynamic per-glyph classes MathJax's CHTML output assigns
// (".mjx-c<hex codepoint>", optionally with a font-variant suffix like
// "-B") — content-addressed by character + font, not by typesetting
// order, so the same class always means the same glyph everywhere. These
// are the only classes that live in the *dynamic* #MJX-CHTML-styles
// stylesheet MathJax generates per-document rather than the static
// vendor CSS, so they're the only ones a cached card needs its own copy
// of.
const MJX_GLYPH_CLASS_RE = /mjx-c[0-9A-Fa-f]+(?:-[A-Za-z0-9]+)?/g;

// Matches a *literal* ".class" token in a selector, ignoring any leading
// bare tag name (which never has its own leading dot) — e.g.
// "mjx-c.mjx-c20D7.STX-B" -> ["mjx-c20D7", "STX-B"], ".mjx-c33" ->
// ["mjx-c33"]. Call once per individual selector, not on a whole
// comma-grouped selectorText.
const CLASS_TOKEN_RE = /\.([A-Za-z0-9_-]+)/g;
function _classTokensOf(selector) {
  return [...selector.matchAll(CLASS_TOKEN_RE)].map(m => m[1]);
}

// The real cache key for one glyph: its FULL class list (hex code plus
// any font-variant class like "STX-B"), sorted so token order in
// markup vs. selectors never matters — e.g. "STX-B mjx-c20D7". Plain
// "mjx-c20D7" and bold "mjx-c20D7 STX-B" get DIFFERENT keys on
// purpose: they're different rules with different padding (confirmed:
// 0.843em vs 0.778em for the vec-arrow accent), and collapsing them to
// one key — which happened when the key was just the bare mjx-c<hex>
// token — let whichever variant's rule was enumerated first in
// cssRules order silently win the slot for BOTH weights, corrupting
// the accent's position for every usage that needed the other one.
function _glyphKeyFromClassTokens(tokens) {
  return tokens
    .filter(t => /^mjx-c[0-9A-Fa-f]/i.test(t) || /^STX-/.test(t))
    .sort()
    .join(' ');
}

// Parses a CSS text blob using the browser's own CSS parser (via a
// detached <style> element's .sheet.cssRules) rather than a hand-rolled
// regex tokenizer. An earlier version of this file used a regex, and it
// broke silently against real MathJax output it wasn't written to
// handle: MathJax emits some glyph rules as plain class selectors
// (".mjx-c73") but others as compound element+class selectors
// ("mjx-c.mjx-c69", for context-specific spacing) — the regex only ever
// looked up the plain form, and mis-tokenized around the mixed selector
// styles badly enough to miss everything in that section, with no error,
// just silently-empty extraction. Real CSS can have plenty of shapes a
// hand-written pattern won't anticipate; the browser's parser always
// gets it right, so use that instead.
//
// Returns a Map of glyph class name (no leading dot, e.g. "mjx-c2212")
// -> that rule's cssText, built by scanning each rule's *selector* for
// glyph-class tokens — so both plain and compound selector forms are
// found the same way, with no special-casing needed for either shape.
// Builds a class -> cssText lookup from a *live* CSSStyleSheet's own
// .cssRules (the browser's already-parsed, currently-in-effect rule
// list) — not from re-parsing any string of CSS text. This distinction
// matters: MathJax updates its dynamic stylesheet by mutating the
// CSSOM directly (sheet.insertRule, presumably, or an equivalent DOM
// replacement that isn't a textContent rewrite), which repaints the
// page correctly but does NOT update the <style> element's .textContent
// — that stays frozen at whatever was there when the element was first
// created. Reading .textContent (an earlier version of this function
// did, via a detached-element reparse) was therefore reading stale,
// frozen content the entire time real testing was done: confirmed by
// instrumented logging showing the "live" stylesheet stuck at the exact
// same char count and rule count across an entire 150-card render, while
// the math was visibly rendering fine on screen — proof the CSSOM had
// moved on even though .textContent hadn't. Reading sheet.cssRules
// directly sidesteps the whole problem, since it's always current.
function _glyphRulesFromStyleSheet(sheet) {
  const map = new Map();
  if (!sheet || !sheet.cssRules) return map;
  for (const rule of sheet.cssRules) {
    if (!rule.selectorText) continue; // skip anything that isn't a plain style rule
    for (const selector of rule.selectorText.split(',')) {
      const tokens = _classTokensOf(selector);
      if (!tokens.some(t => /^mjx-c[0-9A-Fa-f]/i.test(t))) continue; // not a glyph rule
      const key = _glyphKeyFromClassTokens(tokens);
      if (!map.has(key)) map.set(key, rule.cssText);
    }
  }
  return map;
}

// Companion to _glyphRulesFromStyleSheet: everything in the *dynamic*
// CHTML stylesheet that ISN'T a per-glyph rule — layout/structural
// rules like "mjx-texatom { display: inline-block; text-align: left; }"
// that box and center stacked constructs (accents, fractions, etc.).
// Unlike glyph rules, these aren't content-addressed by codepoint — the
// small, fixed set of them applies globally to every card that uses the
// relevant construct — so this returns a flat deduped array of cssText
// rather than a keyed map, and every card's cache entry gets the same
// full set rather than trying to figure out which subset a given card
// needs. That's deliberately generous (a few dozen bytes of redundant
// CSS per cache entry) in exchange for never silently missing one of
// these the way the glyph-only scan missed mjx-texatom.
function _structuralRulesFromStyleSheet(sheet) {
  const rulesOut = [];
  if (!sheet || !sheet.cssRules) return rulesOut;
  for (const rule of sheet.cssRules) {
    if (!rule.selectorText) continue;
    const isGlyphRule = rule.selectorText
      .split(',')
      .some(selector => _classTokensOf(selector).some(t => /^mjx-c[0-9A-Fa-f]/i.test(t)));
    if (isGlyphRule) continue;
    rulesOut.push(rule.cssText);
  }
  return rulesOut;
}

// Used only for our own already-flat, self-authored CSS text (see
// injectRestoredStyles) — not for reading MathJax's live stylesheet,
// which must go through _glyphRulesFromStyleSheet above instead. Parses
// via a detached <style> element's CSSOM, same underlying mechanism,
// just applied to a string we constructed ourselves rather than reading
// someone else's live, mutating sheet.
function _glyphRulesFromCssText(cssText) {
  if (!cssText) return new Map();
  const el = document.createElement('style');
  el.textContent = cssText;
  document.head.appendChild(el); // must be attached for .sheet to populate
  try {
    return _glyphRulesFromStyleSheet(el.sheet);
  } catch (err) {
    console.error('CSS rule parse error:', err);
    return new Map();
  } finally {
    el.remove();
  }
}

// Extracts just the CSS rules a specific card's freshly-typeset HTML
// actually depends on, out of MathJax's current session-wide dynamic
// stylesheet, as one self-contained string — call this right after
// typesetting a card, before its HTML is handed to storeCachedMathHTML,
// so both travel together into the same cache entry.
function extractCssForHtml(html) {
  const styleEl = document.getElementById('MJX-CHTML-styles');
  if (!styleEl) return '';
  const classAttrRe = /class="([^"]*mjx-c[0-9A-Fa-f]+[^"]*)"/g;
  // Read the live CSSOM (sheet.cssRules), not styleEl.textContent — see
  // _glyphRulesFromStyleSheet's comment for why textContent is stale.
  const rules = _glyphRulesFromStyleSheet(styleEl.sheet);
  const parts = [];
  const seen = new Set();
  let m;
  while ((m = classAttrRe.exec(html))) {
    const key = _glyphKeyFromClassTokens(m[1].split(/\s+/));
    if (seen.has(key)) continue;
    seen.add(key);
    const rule = rules.get(key);
    if (rule) parts.push(rule);
  }
  if (seen.size === 0) return ''; // genuinely no glyphs to cover — not an error
  // Always fold in the current structural rules too (mjx-texatom and
  // friends — see _structuralRulesFromStyleSheet) — small, fixed,
  // global set, so there's no per-card matching to do; just append
  // whatever's live right now. Kept in the same returned string as the
  // glyph parts so the {html, css} bundle really is self-contained.
  const structural = _structuralRulesFromStyleSheet(styleEl.sheet);
  return parts.concat(structural).join('\n');
}

// Injects the union of several cards' own stored css snippets as one
// <style> tag, so every currently-restored (cache-hit) card has the
// glyph rules it needs before/as it's shown. This is recomputed fresh
// from whatever's actually being displayed each time it's called — not
// persisted anywhere separately — so it can never drift out of sync with
// the cards it's serving: there's nothing to keep in sync, it's derived
// directly from them every time. Dedup is by exact rule text (via the
// same CSS parser as above) rather than by selector, since several
// cards sharing a glyph will have stored the identical rule text
// verbatim — no need to reason about selector forms again here.
function injectRestoredStyles(cssSnippets) {
  const combined = cssSnippets.filter(Boolean).join('\n');
  const parts = [];
  if (combined) {
    const el = document.createElement('style');
    el.textContent = combined;
    document.head.appendChild(el);
    try {
      const sheet = el.sheet;
      if (sheet && sheet.cssRules) {
        const seen = new Set();
        for (const rule of sheet.cssRules) {
          if (seen.has(rule.cssText)) continue;
          seen.add(rule.cssText);
          parts.push(rule.cssText);
        }
      }
    } catch (err) {
      console.error('CSS rule parse error:', err);
    } finally {
      el.remove();
    }
  }
  let target = document.getElementById('mjx-cache-preload-styles');
  if (!target) {
    target = document.createElement('style');
    target.id = 'mjx-cache-preload-styles';
    document.head.appendChild(target);
  }
  target.textContent = parts.join('\n');
}

// Queues a newly-typeset card's HTML + the CSS it needs as one atomic
// bundle. Returns the IndexedDB write's own promise (rather than firing
// and forgetting it) so callers that need it durably committed — not
// just handed to IndexedDB — can await it: without that, a reload
// landing between "this call returned" and "the transaction actually
// committed" can silently lose a card that visually already looked
// cached. See cacheTypesetBatch in quiz-engine.js.
function storeCachedMathHTML(problemId, hash, html, css) {
  _mathCacheMap.set(problemId, { hash, html, css });
  if (!_mathCacheDB) return Promise.resolve();
  return _mathCachePut('cards', problemId, { hash, html, css }).catch(err =>
    console.error('Math cache write error:', err));
}

// Removes a single card's cached HTML+CSS (in-memory and persisted), so
// the next render treats it as a cache miss and re-typesets it from
// scratch. Used by the manual "Rerender Equations" action — a lighter-
// weight escape hatch than clearing the whole render cache.
function deleteCachedMathHTML(problemId) {
  _mathCacheMap.delete(problemId);
  if (!_mathCacheDB) return;
  const tx = _mathCacheDB.transaction('cards', 'readwrite');
  tx.objectStore('cards').delete(problemId);
  tx.onerror = () => console.error('Math cache delete error:', tx.error);
}

// Kick off loading in the background as soon as the page loads, so by the
// time the person actually opens Solve-All, IndexedDB has usually already
// responded.
initMathCache();
