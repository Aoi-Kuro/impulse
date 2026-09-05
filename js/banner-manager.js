// ─── Banner priority manager ────────────────────────────────────────────────
// Makes sure only one of the bottom notification banners (update / bug-report
// aka "Telegram" / theme-nudge) is visible at a time.
//
// Priority rules:
//   1. "update"  always wins — if it needs to show, it preempts whatever
//      banner is currently on screen (that banner is paused, not lost — it
//      resumes as soon as the update banner is dismissed).
//   2. All other banners ("bug", "theme", ...) share the next tier: whichever
//      one asks to show *first* gets shown first; any later request just
//      waits in line until the current one is dismissed.
//
// Usage:
//   BannerManager.register(id, showFn, hideFn);  // once, at setup
//   BannerManager.request(id);                   // "I'd like to show now"
//   BannerManager.release(id);                   // "I'm done / dismissed"
window.BannerManager = (function () {
  const PREEMPT = 'update'; // the only id that jumps the queue

  let activeId = null;
  const waiting = [];       // ids waiting their turn, in arrival order
  const showers = {};
  const hiders = {};

  function register(id, showFn, hideFn) {
    showers[id] = showFn;
    hiders[id] = hideFn;
  }

  function request(id) {
    if (activeId === id) return; // already showing, nothing to do

    if (id === PREEMPT && activeId) {
      // Bump whatever's showing back to the front of the line, then take over.
      const hider = hiders[activeId];
      if (hider) hider();
      if (!waiting.includes(activeId)) waiting.unshift(activeId);
      activeId = null;
    }

    if (activeId === null) {
      activeId = id;
      const shower = showers[id];
      if (shower) shower();
    } else if (!waiting.includes(id)) {
      waiting.push(id);
    }
  }

  function release(id) {
    if (activeId !== id) return;
    activeId = null;
    const next = waiting.shift();
    if (next) request(next);
  }

  return { register, request, release };
})();
