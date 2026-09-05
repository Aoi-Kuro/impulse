// ── LaTeX rendering (MathJax, STIX Two font) ──
// Problem `text` fields can contain inline math delimited by $...$ or \( \),
// and display math delimited by $$...$$ or \[ \]. Call renderMathIn(el)
// after any dynamic innerHTML update that may contain problem text
// (quiz cards, solve-all cards, mistakes cards, etc.)
function renderMathIn(el) {
  if (!el) return Promise.resolve();
  if (window.MathJax && window.MathJax.typesetPromise) {
    return MathJax.typesetPromise([el]).catch(err => console.error("MathJax render error:", err));
  }
  // MathJax's own script tag is `defer`, so plain (non-defer) scripts that
  // run at load time can call in here before typesetPromise exists yet —
  // wait for startup instead of silently skipping the typeset forever.
  if (window.MathJaxReady) {
    return window.MathJaxReady.then(() =>
      MathJax.typesetPromise([el]).catch(err => console.error("MathJax render error:", err))
    );
  }
  return Promise.resolve();
}

function nextFrame() {
  return new Promise(res => requestAnimationFrame(res));
}

// Typesets `container`'s children in small batches, yielding a frame
// between each batch. A single MathJax.typesetPromise([container]) call
// on a big batch runs mostly synchronously for its whole duration and
// starves the frame budget — the loading animation "runs" in CSS but
// never actually gets repainted until typesetting finishes. Chunking it
// gives the browser a repaint opportunity every BATCH_SIZE cards.
//
// Children already carrying the 'mj-cached' class are skipped — their
// math was restored verbatim from the persistent render cache (see
// math-cache.js) and doesn't need MathJax at all. `onBatch(batch)`, if
// given, is called after each batch actually gets typeset, so a caller
// (e.g. solve-all) can capture the fresh output into that cache.
async function renderMathInBatches(container, batchSize = 6, onBatch) {
  if (!container) return;
  if (!window.MathJax || !window.MathJax.typesetPromise) {
    if (window.MathJaxReady) await window.MathJaxReady;
    else return;
  }
  const cards = Array.from(container.children).filter(el => !el.classList.contains('mj-cached'));
  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    await MathJax.typesetPromise(batch).catch(err => console.error("MathJax render error:", err));
    if (onBatch) onBatch(batch);
    await nextFrame();
  }
}

// ── Full-screen loading transition (e.g. solve-all mode) ──
// Building + typesetting a large batch of problems is heavy work that
// would otherwise freeze mid-transition with whatever half-built content
// is on screen, AND freeze the loading animation itself — a long
// synchronous block starves the browser's repaint budget regardless of
// what's covering the screen. `runWithLoadingScreen` shows the overlay
// (with a double rAF so it actually paints before anything blocks), then
// runs `buildFn` — which should build in chunks and yield a frame between
// them (see buildSolveAllCards) — followed by chunked MathJax typesetting.
// Only once both finish does the electron "collide" with the proton
// (a short one-off animation) before the overlay fades out.
//
// MIN_VISIBLE guarantees the collision sequence always gets to play out
// fully, so even a near-instant render looks like an intentional quick
// animation rather than a flash.
const MATH_LOADING_MIN_VISIBLE = 320; // ms
const MATH_LOADING_COLLIDE_MS  = 420; // ms — must match the CSS collision animation length
const MATH_LOADING_FADE_MS     = 260; // ms — must match the CSS .leaving transition length

function runWithLoadingScreen(screenEl, contentEl, buildFn, onMathBatch) {
  if (contentEl) contentEl.style.opacity = '0';
  if (screenEl) {
    screenEl.classList.remove('colliding', 'leaving');
    screenEl.classList.add('active');
  }
  const shownAt = performance.now();

  return new Promise(resolve => {
    // Double rAF: the first rAF is still in the same paint cycle as the
    // class change above on some browsers, so we wait one more frame to
    // guarantee the overlay is actually on screen before blocking.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Promise.resolve(buildFn())
        .then(() => renderMathInBatches(contentEl, 6, onMathBatch))
        .then(finish, err => {
          console.error("Loading screen build/render error:", err);
          finish();
        });

      function finish() {
        const remaining = Math.max(0, MATH_LOADING_MIN_VISIBLE - (performance.now() - shownAt));
        setTimeout(() => {
          if (!screenEl) {
            if (contentEl) contentEl.style.opacity = '1';
            resolve();
            return;
          }
          screenEl.classList.add('colliding');
          setTimeout(() => {
            screenEl.classList.add('leaving');
            if (contentEl) {
              contentEl.style.transition = 'opacity .25s ease';
              contentEl.style.opacity = '1';
            }
            setTimeout(() => {
              screenEl.classList.remove('active', 'colliding', 'leaving');
              if (contentEl) contentEl.style.transition = '';
              resolve();
            }, MATH_LOADING_FADE_MS);
          }, MATH_LOADING_COLLIDE_MS);
        }, remaining);
      }
    }));
  });
}
