// ── Persistent MathJax render cache (IndexedDB) ──
// Typesetting is the expensive part of opening Solve-All, not building the
// cards. Once a problem's LaTeX has been typeset, we cache the resulting
// HTML for its .problem-text — keyed by a hash of the problem's own source
// text — plus a snapshot of MathJax's generated CHTML stylesheet (the CSS
// rules for the specific glyphs used). A later visit can then drop the
// already-typeset HTML straight into the DOM and skip MathJax entirely for
// that card. If a problem's text is ever edited, its hash changes, the
// cache misses automatically, and it re-renders + re-caches — no manual
// invalidation needed.
//
// Bump MATH_CACHE_SCHEMA if the card markup or render pipeline changes in
// a way that would make old cached HTML stale/incompatible.

const MATH_CACHE_DB = 'mathRenderCache';
const MATH_CACHE_DB_VERSION = 1;
// bumped: persistMathCacheStyles used to overwrite the stored CHTML
// stylesheet with whatever MathJax had generated *this session* — on a
// visit where most cards were already cache-hits, that "current session"
// stylesheet could be smaller than what earlier cached HTML actually
// needs, silently dropping glyph/spacing rules for cards that weren't
// re-typeset this time. Bumping the schema clears out any style snapshots
// that already got truncated this way; persistMathCacheStyles below now
// merges instead of overwriting, so it shouldn't happen again going
// forward.
const MATH_CACHE_SCHEMA = 3;

let _mathCacheDB = null;
let _mathCacheMap = new Map();   // problemId -> { hash, html }
let _mathCacheStyles = '';       // last known CHTML stylesheet snapshot
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

function _openMathCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MATH_CACHE_DB, MATH_CACHE_DB_VERSION);
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

function _injectCachedStyles(cssText) {
  let el = document.getElementById('mjx-cache-preload-styles');
  if (!el) {
    el = document.createElement('style');
    el.id = 'mjx-cache-preload-styles';
    document.head.appendChild(el);
  }
  el.textContent = cssText;
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
      if (schema !== MATH_CACHE_SCHEMA) {
        // Render pipeline changed since this cache was written — old
        // entries could be stale/incompatible, so start fresh.
        await _mathCacheClearAll();
        await _mathCachePut('meta', 'schemaVersion', MATH_CACHE_SCHEMA);
        return;
      }
      const styles = await _mathCacheGet('meta', 'styles');
      if (styles) {
        _mathCacheStyles = styles;
        _injectCachedStyles(styles);
      }
      const all = await _mathCacheGetAll('cards');
      for (const [id, entry] of all) _mathCacheMap.set(id, entry);
    } catch (err) {
      console.error('Math cache init error:', err);
    }
  })();
  return _mathCacheReady;
}

// Returns the cached, already-typeset HTML for a problem's math-bearing
// text if its content hasn't changed since it was cached, else null.
function getCachedMathHTML(problemId, sourceText) {
  const entry = _mathCacheMap.get(problemId);
  if (!entry) return null;
  return entry.hash === _mathCacheHash(sourceText) ? entry.html : null;
}

function mathCacheHashOf(sourceText) {
  return _mathCacheHash(sourceText);
}

// Queues a newly-typeset card's HTML for persistence. Fire-and-forget —
// callers don't need to await this.
function storeCachedMathHTML(problemId, hash, html) {
  _mathCacheMap.set(problemId, { hash, html });
  if (!_mathCacheDB) return;
  _mathCachePut('cards', problemId, { hash, html }).catch(err =>
    console.error('Math cache write error:', err));
}

// Removes a single card's cached HTML (in-memory and persisted), so the
// next render treats it as a cache miss and re-typesets it from scratch.
// Used by the manual "Rerender Equations" action — a lighter-weight
// escape hatch than clearing the whole render cache.
function deleteCachedMathHTML(problemId) {
  _mathCacheMap.delete(problemId);
  if (!_mathCacheDB) return;
  const tx = _mathCacheDB.transaction('cards', 'readwrite');
  tx.objectStore('cards').delete(problemId);
  tx.onerror = () => console.error('Math cache delete error:', tx.error);
}

// Unions the CSS rules from two MathJax CHTML stylesheets, keyed by
// selector. Rules from `newCss` win on a selector collision (e.g. a glyph
// definition that legitimately changed), but any selector that only
// exists in `oldCss` is preserved — this is what stops the persisted
// snapshot from shrinking over time (see MATH_CACHE_SCHEMA comment above).
// MathJax's CHTML output is flat (no nested/@ rules to worry about), so a
// simple "selector { ... }" tokenizer is enough here.
function _mergeCssRules(oldCss, newCss) {
  if (!oldCss) return newCss || '';
  if (!newCss) return oldCss;
  const rules = new Map();
  const ruleRe = /[^{}]+\{[^{}]*\}/g;
  const ingest = css => {
    const matches = css.match(ruleRe);
    if (!matches) return;
    for (const rule of matches) {
      const selector = rule.slice(0, rule.indexOf('{')).trim();
      rules.set(selector, rule);
    }
  };
  ingest(oldCss);
  ingest(newCss);
  return Array.from(rules.values()).join('\n');
}

// Call once after a batch of new typesetting finishes, so a later visit
// (even after a reload) has the CSS rules the newly-cached HTML needs —
// merged with whatever earlier visits already contributed, rather than
// replacing it (see _mergeCssRules).
function persistMathCacheStyles() {
  const styleEl = document.getElementById('MJX-CHTML-styles');
  if (!styleEl || !_mathCacheDB) return;
  const css = styleEl.textContent;
  if (!css) return;
  const merged = _mergeCssRules(_mathCacheStyles, css);
  if (merged === _mathCacheStyles) return;
  _mathCacheStyles = merged;
  _injectCachedStyles(merged);
  _mathCachePut('meta', 'styles', merged).catch(err =>
    console.error('Math cache style write error:', err));
}

// Kick off loading in the background as soon as the page loads, so by the
// time the person actually opens Solve-All, IndexedDB has usually already
// responded.
initMathCache();
