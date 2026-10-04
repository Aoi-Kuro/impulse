/* ═══════════════════════════════════════════════════════════════════
   editor-access.js  ·  Hidden way into the solutions editor (/editor)
   ───────────────────────────────────────────────────────────────────
   The editor is deliberately not linked anywhere on the site: it is for
   the two people who write solutions, and a visible link would only
   draw students to a key prompt they can do nothing with. The access
   key is what actually protects it (see solutions-admin.ts) — this is
   just about not advertising the door.

   Press and hold the site logo for 2 seconds and a small panel offers
   to open /editor. A normal click/tap still goes to the main menu, and
   nothing at all is shown or stored until the hold completes.

   Deliberately NOT a tap counter: tap-five-times is easy to hit by
   accident on a logo people already click to get home.

   Once someone has signed in to the editor in this browser, the door no
   longer needs hiding from them: a 📘 link sits next to the logo. "Signed
   in" = the editor's key is in localStorage, which editor.js only writes
   after the server accepted it and removes on sign-out or rejection. The
   key itself is never read here, only whether it exists.
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const HOLD_MS = 2000;
  const EDITOR_URL = '/editor/';

  const logo = document.getElementById('siteLogoLink');
  if (!logo) return;

  // ── Quick link for signed-in editors ──────────────────────────────────
  const KEY_STORAGE = STORAGE_PREFIX + '-editor-key';   // same as editor/editor.js
  function hasEditorKey() {
    try { return /^\S{32}$/.test(localStorage.getItem(KEY_STORAGE) || ''); } catch (e) { return false; }
  }
  function syncQuickLink() {
    let a = document.getElementById('editorQuickLink');
    if (!hasEditorKey()) { if (a) a.remove(); return; }
    if (a) return;
    // A real link, so ctrl/middle-click and long-press "open in new tab" work.
    a = document.createElement('a');
    a.id = 'editorQuickLink';
    a.className = 'editor-quick-link';
    a.href = EDITOR_URL;
    a.title = 'Editorial';
    a.setAttribute('aria-label', 'Open Editorial');
    a.textContent = '📘';
    logo.insertAdjacentElement('afterend', a);
  }
  syncQuickLink();
  // Signing in or out in the editor tab updates this page too.
  window.addEventListener('storage', (e) => { if (e.key === KEY_STORAGE || e.key === null) syncQuickLink(); });

  let timer = null;
  let holding = false;
  let fired = false;       // blocks the click that follows a completed hold

  function showPrompt() {
    if (document.getElementById('editorAccessPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'editorAccessPanel';
    panel.className = 'editor-access-panel';

    const title = document.createElement('div');
    title.className = 'editor-access-title';
    title.textContent = '📘 Editorial';

    const sub = document.createElement('div');
    sub.className = 'editor-access-sub';
    sub.textContent = 'Needs an access key.';

    const row = document.createElement('div');
    row.className = 'editor-access-row';

    const open = document.createElement('button');
    open.className = 'editor-access-btn primary';
    open.textContent = 'Open';
    open.addEventListener('click', () => { window.location.href = EDITOR_URL; });

    // No Cancel: a tap anywhere outside the panel already closes it.
    const newTab = document.createElement('button');
    newTab.className = 'editor-access-btn';
    newTab.textContent = 'Open in new tab';
    newTab.addEventListener('click', () => {
      window.open(EDITOR_URL, '_blank', 'noopener');
      hidePrompt();
    });

    row.append(open, newTab);
    panel.append(title, sub, row);
    document.body.appendChild(panel);

    requestAnimationFrame(() => panel.classList.add('visible'));
    setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  }

  function onOutside(e) {
    const panel = document.getElementById('editorAccessPanel');
    if (panel && !panel.contains(e.target)) hidePrompt();
  }

  function hidePrompt() {
    document.removeEventListener('pointerdown', onOutside);
    const panel = document.getElementById('editorAccessPanel');
    if (!panel) return;
    panel.classList.remove('visible');
    setTimeout(() => panel.remove(), 180);
  }

  function startHold(e) {
    // Left mouse button / touch / pen only — a right-click shouldn't arm it.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelHold();
    holding = true;
    fired = false;
    logo.classList.add('holding');
    timer = setTimeout(() => {
      timer = null;
      holding = false;
      fired = true;
      logo.classList.remove('holding');
      // A short buzz on phones, so it is obvious the hold registered.
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      showPrompt();
    }, HOLD_MS);
  }

  function cancelHold() {
    if (timer) { clearTimeout(timer); timer = null; }
    holding = false;
    logo.classList.remove('holding');
  }

  logo.addEventListener('pointerdown', startHold);
  logo.addEventListener('pointerup', cancelHold);
  logo.addEventListener('pointercancel', cancelHold);
  logo.addEventListener('pointerleave', cancelHold);

  // Suppress the navigation that the completed hold's pointerup would
  // otherwise trigger (the logo's own onclick goes to the main menu).
  logo.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, true);

  // Holding on a link/image otherwise pops the browser's own "save image"
  // or drag behaviour over the top of the panel.
  logo.addEventListener('contextmenu', (e) => { if (holding || fired) e.preventDefault(); });
  logo.addEventListener('dragstart', (e) => e.preventDefault());
})();
