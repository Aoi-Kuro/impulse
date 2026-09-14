// ─── Settings ────────────────────────────────────────────────────────────
// Phase 0 built: a versioned, device-local (localStorage only — no
// cross-device sync, by design) settings schema + migration; the settings
// panel shell (gear button -> full-screen panel, same open/close fade
// pattern as #manualScreen — see js/manual.js); and grouped tabs (Display /
// Notifications / Study / Sync & Storage).
//
// Phase 1: six Display-tab visual-decluttering toggles — floating avatar,
// floating splashes, Manual button, theme-selector button, daylight
// switch, floating Forum button. Framed as "Show X" and on by default
// (matching each element's actual default-visible behavior), rather than
// "Hide X" off by default — same end state, but a switch that's ON when
// something is showing reads more naturally than one that's OFF for the
// same thing. Each just flips a class on <html> (applyDisplaySettings
// below); the actual hide/show is plain CSS in css/settings.css, so
// nothing here has to know where those elements live in the DOM. See the
// anti-flicker inline script in index.html's <head> for why <html> and not
// <body> — it has to apply these before <body> exists at all, so a user
// who's turned something off never sees it flash on for a frame first.
//
// Also fixed: a race condition where tapping the gear then the site logo
// (or vice versa) within the ~280ms open/close fade window could leave the
// panel stuck open with the landing page hidden underneath, or briefly
// render both at once — see settingsIsOpen/settingsAnimTimer below.
//
// Later phases just add entries to SETTINGS_DEFAULTS and a row to the
// relevant renderSettings*Tab() function below — no changes to the
// storage/migration/panel plumbing itself should ever be needed again.

const SETTINGS_STORAGE_KEY = 'flux_settings';
const SETTINGS_SCHEMA_VERSION = 1;

// Every real setting gets registered here as {tab: {key: defaultValue}}.
// Display's six default to true ("shown") since that's every element's
// actual out-of-the-box behavior; new settings elsewhere still default to
// today's unchanged behavior per the Phase 0 planning decision.
const SETTINGS_DEFAULTS = {
  display: {
    showAvatar:      true,
    showSplashes:    true,
    showManualBtn:   true,
    showThemeBtn:    true,
    showDaylightBtn: true,
    followDeviceTheme: false,
    showForumFab:    true,
    hideFieldLinesByDefault: false,
    showTopBarTip:   true,
  },
  notifications: {
    hideUpdateReminder: false,
    forceRefreshOutsideQuiz: false,
    hideThemeNudge: false,
    hideBugReportReminder: false,
    goSilent: false,
    goSilentAutoOff24h: false,
    // Timestamp (ms) of when goSilent was last turned on — null while it's
    // off. Drives the 24h auto-off check in applyNotificationSettings();
    // stored (not just held in memory) so the 24h window survives a reload
    // instead of quietly resetting every visit.
    goSilentEnabledAt: null,
  },
  study: {
    showLiveTimer: true,
    reduceMotion: false,
    resetFilterOnLoad: false,
    autoStopAt50Min: false,
    fullscreenRandomN: true,
    hideFullscreenReminder: false,
    hideTopicWhileActive: false,
    selectLatestQuizByDefault: false,
    cumulativeDefaultOn: false,
    lockSolveAllOrder: false,
    // 'ordered' | 'unordered' — sub of lockSolveAllOrder, which order gets
    // used automatically once the order-picker modal is skipped.
    solveAllLockedOrder: 'ordered',
    revealWrongInstantly: false,
    // The left/right progress rail shown beside Solve-All on wide screens
    // (js/solve-all-nav.js). On by default — it's been the only behavior
    // until now, so this just makes it optional going forward.
    showSolveAllNavRail: true,
    // The floating solved-count badge, bottom-right, during Solve-All
    // (#stickyScore). Was always on; now optional, still on by default.
    showStickyScore: true,
  },
  offline: {
    // ms epoch when the current "Go offline" 24h window expires — null
    // while offline mode is off. See js/offline-mode.js, which owns
    // everything else about this feature (the download, the IndexedDB
    // mirror sw.js reads, the tab's own rendering); this file only needs
    // to know the key exists so getSetting/setSetting/migrateSettings work
    // the same way for it as for every other setting.
    until: null,
  },
};

let settingsCache = null;

// Loads once per page life, merges saved data over SETTINGS_DEFAULTS (see
// migrateSettings), and caches the result — every getSetting/setSetting
// call after the first reuses this instead of re-parsing localStorage.
function loadSettings() {
  if (settingsCache) return settingsCache;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
  } catch (e) {
    raw = null; // corrupted/foreign value — fall back to defaults rather than throw
  }
  settingsCache = migrateSettings(raw);
  return settingsCache;
}

// Merges whatever was actually saved (possibly from an older
// schemaVersion, possibly missing keys added since) on top of
// SETTINGS_DEFAULTS. A brand-new key added in a future phase just shows up
// with its default the first time an old save is loaded — no explicit
// per-version migration steps needed as long as every setting has a
// sensible default here. schemaVersion is still stamped and kept for the
// day a change genuinely isn't additive (e.g. a renamed/restructured key)
// and needs a real one-off transform.
function migrateSettings(raw) {
  const merged = { schemaVersion: SETTINGS_SCHEMA_VERSION };
  for (const tab of Object.keys(SETTINGS_DEFAULTS)) {
    const savedTab = (raw && typeof raw[tab] === 'object' && raw[tab]) ? raw[tab] : {};
    merged[tab] = { ...SETTINGS_DEFAULTS[tab], ...savedTab };
  }
  return merged;
}

function saveSettings() {
  if (!settingsCache) return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsCache));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function getSetting(tab, key) {
  const s = loadSettings();
  return s[tab] ? s[tab][key] : undefined;
}

function setSetting(tab, key, value) {
  const s = loadSettings();
  if (!s[tab]) s[tab] = {};
  s[tab][key] = value;
  saveSettings();
}

// ── Screen state ────────────────────────────────────────────────────────
let settingsActiveTab = 'display';

// Reachable from the same fixed top-right icon strip as the manual button,
// so it can be opened from mid-quiz/mid-stats/mid-forum too — not just the
// landing screen. Keeps its own copy of the host list (same convention as
// MANUAL_HOSTS in js/manual.js and FORUM_FAB_HOSTS in js/forum.js) rather
// than sharing one, so this module doesn't depend on load order relative
// to theirs.
const SETTINGS_HOSTS = [
  {
    id: 'appPage',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
    scrollY: 0,
  },
  {
    id: 'statsScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
    scrollY: 0,
  },
  {
    id: 'reviewScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
    scrollY: 0,
  },
  {
    id: 'forumScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
    scrollY: 0,
  },
  {
    id: 'manualScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
    scrollY: 0,
  },
  {
    id: 'choicePage',
    isVisible: el => !el.classList.contains('hidden'),
    hide:      el => el.classList.add('hidden'),
    show:      el => el.classList.remove('hidden', 'fading-out'),
    scrollY: 0,
  },
];

let settingsHostId = null;

// Mirrors FORUM_FAB_HOSTS' own host.scrollY (js/forum.js) — see the same
// comment on manualLandingScrollY (js/manual.js). Landing isn't in
// SETTINGS_HOSTS (it's the fallback, not a host entry), so its own return
// offset needs its own variable rather than living on a host object.
let settingsLandingScrollY = 0;

// ── Logical open/closed state + in-flight-animation guard ─────────────────
// The panel's own `visible` CSS class only gets added/removed inside the
// 280ms setTimeout below (to match the fade animation), so checking that
// class to decide "is it open" is unreliable for the first ~280ms after
// either action — a fast second tap (gear then logo, or vice versa) landed
// in that window read the *stale* class, and worse, the first action's
// delayed callback had no idea a second action had countermanded it, so it
// ran anyway once its timer fired — sometimes leaving the panel stuck
// visible with the landing page hidden, sometimes both rendered at once
// (#settingsScreen sits later in the DOM than #landingScreen, so "both
// visible" shows the panel appended below the main page).
// `settingsIsOpen` is the authoritative state, set the instant open/close
// is *decided* rather than when its animation finishes, and
// `settingsAnimTimer` lets each call cancel whatever the other one still
// had pending before scheduling its own.
let settingsIsOpen = false;
let settingsAnimTimer = null;

function isSettingsScreenOpen() {
  return settingsIsOpen;
}

function toggleSettingsScreen() {
  if (settingsIsOpen) {
    closeSettingsScreen();
  } else {
    openSettingsScreen();
  }
}

function openSettingsScreen(initialTab = 'display', focusRowKey = null) {
  const landing  = document.getElementById('landingScreen');
  const settings = document.getElementById('settingsScreen');
  if (!landing || !settings || settingsIsOpen) return;
  settingsIsOpen = true;
  const requestedTab = ['display', 'notifications', 'study', 'offline'].includes(initialTab) ? initialTab : 'display';
  // #saNavRail/#stickyScore are position:fixed and independent of whichever
  // screen is showing, so they render on top of #settingsScreen unless we
  // hide them explicitly — see the html.settings-screen-open rule in
  // css/settings.css. Toggled immediately (not inside the fade timeout
  // below) so there's no frame where they're still visible over the
  // incoming panel.
  document.documentElement.classList.add('settings-screen-open');
  if (settingsAnimTimer) { clearTimeout(settingsAnimTimer); settingsAnimTimer = null; }

  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  const landingShowing = !landing.classList.contains('hidden');
  const hostEntry = landingShowing ? null : SETTINGS_HOSTS.find(h => {
    const el = document.getElementById(h.id);
    return el && h.isVisible(el);
  });
  const hostEl = hostEntry ? document.getElementById(hostEntry.id) : landing;
  settingsHostId = hostEntry ? hostEntry.id : null;

  // Capture wherever the host page is currently scrolled to before hiding
  // it, then start the Settings screen itself at the top — same convention
  // as FORUM_FAB_HOSTS (js/forum.js) and the attempt-review sub-screen
  // (js/stats.js), just applied to Settings too.
  const scrollY = typeof captureScreenScroll === 'function' ? captureScreenScroll() : (window.scrollY || 0);
  if (hostEntry) hostEntry.scrollY = scrollY; else settingsLandingScrollY = scrollY;

  // Defensive: strip any 'fading-out' a just-cancelled close attempt might
  // have left on the panel itself before this open's own animation starts.
  settings.classList.remove('fading-out');
  hostEl.classList.add('fading-out');
  settingsAnimTimer = setTimeout(() => {
    settingsAnimTimer = null;
    if (hostEntry) {
      hostEntry.hide(hostEl);
    } else {
      hostEl.classList.add('hidden');
      hostEl.classList.remove('fading-out');
    }
    settings.classList.add('visible');
    if (typeof scrollScreenToTop === 'function') scrollScreenToTop();
    else window.scrollTo(0, 0);
    // Normal opens still land on Display. Deep links (such as the
    // full-screen reminder) can request a specific tab without changing
    // that default for the gear button.
    settingsActiveTab = requestedTab;
    renderSettingsScreen();
    if (focusRowKey) _scrollSettingsRowIntoView(focusRowKey);
  }, 280);
}

function _scrollSettingsRowIntoView(rowKey) {
  if (!rowKey) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-row-key="${rowKey}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  });
}

// Used by the Random N full-screen hint: the whole banner is a shortcut
// straight to the relevant Study setting, including when Settings is
// already open on a different tab.
function openSettingsStudySection(rowKey = 'fullscreenRandomN') {
  if (settingsIsOpen) {
    settingsActiveTab = 'study';
    renderSettingsScreen();
    _scrollSettingsRowIntoView(rowKey);
    return;
  }
  openSettingsScreen('study', rowKey);
}

// `forceLanding` is true only when goToMainMenu() (quiz-engine.js) closes
// Settings via the site logo/main-menu action — same convention as
// closeManualScreen/closeForumScreen's own forceLanding param.
function closeSettingsScreen(forceLanding) {
  const landing  = document.getElementById('landingScreen');
  const settings = document.getElementById('settingsScreen');
  if (!landing || !settings || !settingsIsOpen) return;
  settingsIsOpen = false;
  // Counterpart to the class added in openSettingsScreen — see that
  // comment. Removed up front, same reasoning: no stale hidden frame once
  // Settings starts closing.
  document.documentElement.classList.remove('settings-screen-open');
  if (settingsAnimTimer) { clearTimeout(settingsAnimTimer); settingsAnimTimer = null; }

  settings.classList.add('fading-out');
  settingsAnimTimer = setTimeout(() => {
    settingsAnimTimer = null;
    settings.classList.remove('visible', 'fading-out');

    const hostId = settingsHostId;
    settingsHostId = null;

    // Defensive: if open() had already started fading its host out before
    // this close cancelled it, that host never got to finish (or undo)
    // that fade — clear it here so it can never get stuck mid-transition.
    landing.classList.remove('fading-out');
    if (hostId) {
      const strandedHostEl = document.getElementById(hostId);
      if (strandedHostEl) strandedHostEl.classList.remove('fading-out');
    }

    if (forceLanding && typeof exitAppOrChoiceToLanding === 'function') {
      exitAppOrChoiceToLanding();
      if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
      return;
    }

    if (hostId) {
      const host = SETTINGS_HOSTS.find(h => h.id === hostId);
      const hostEl = host && document.getElementById(hostId);
      if (host && hostEl) {
        host.show(hostEl);
        if (typeof restoreScreenScroll === 'function') restoreScreenScroll(host.scrollY);
        else window.scrollTo(0, host.scrollY || 0);
        return;
      }
    }

    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
    if (typeof restoreScreenScroll === 'function') restoreScreenScroll(settingsLandingScrollY);
    else window.scrollTo(0, settingsLandingScrollY || 0);
  }, 280);
}

// ── Reset all settings button ── same tap-to-arm confirmation pattern as
// the Study filter's "↺ Reset" button (js/quiz-engine.js's
// handleResetClick/_armResetConfirm/_disarmResetConfirm): first tap arms
// it (label swaps to "Sure?", a red ring traces out of the border over
// RESET_CONFIRM_MS as a visual countdown), a second tap while armed
// commits, and letting the ring finish on its own just disarms back to
// normal. Kept as its own independent copy of that logic (own armed flag/
// timer) rather than sharing quiz-engine.js's — that one lives on a
// completely different screen, and reusing the same module-level flag
// would let arming one button silently steal/desync the other's in the
// (admittedly rare) case both ever ended up mid-confirmation at once.
const SETTINGS_RESET_CONFIRM_MS = 3000;
let _settingsResetConfirmArmed = false;
let _settingsResetConfirmTimer = null;

function handleSettingsResetClick() {
  const btn = document.getElementById('settingsResetAllBtn');
  if (!btn) return;
  if (_settingsResetConfirmArmed) {
    _disarmSettingsResetConfirm(btn);
    doResetAllSettings();
    return;
  }
  _armSettingsResetConfirm(btn);
}

function _armSettingsResetConfirm(btn) {
  _settingsResetConfirmArmed = true;
  btn.classList.add('confirming');
  btn.title = 'Tap again to confirm reset';
  const label = btn.querySelector('.filter-reset-label');
  if (label) label.textContent = 'Sure?';

  // Same live-measured ring sizing as _armResetConfirm (js/quiz-engine.js)
  // — traces the button's own current border box rather than a hardcoded
  // size, so it still lines up correctly if this button's own CSS ever
  // changes.
  const ring = btn.querySelector('.reset-confirm-ring');
  const rect = ring && ring.querySelector('rect');
  if (ring && rect) {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    const strokeW = 1.5;
    const inset = strokeW / 2;
    const radius = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0;
    ring.setAttribute('viewBox', `0 0 ${w} ${h}`);
    rect.setAttribute('x', inset);
    rect.setAttribute('y', inset);
    rect.setAttribute('width', Math.max(0, w - inset * 2));
    rect.setAttribute('height', Math.max(0, h - inset * 2));
    rect.setAttribute('rx', Math.max(0, radius - inset));
    const len = rect.getTotalLength();
    rect.style.transition = 'none';
    rect.style.strokeDasharray = len;
    rect.style.strokeDashoffset = 0;
    void rect.getBoundingClientRect(); // force reflow before transitioning
    rect.style.transition = `stroke-dashoffset ${SETTINGS_RESET_CONFIRM_MS}ms linear`;
    requestAnimationFrame(() => { rect.style.strokeDashoffset = len; });
  }

  clearTimeout(_settingsResetConfirmTimer);
  _settingsResetConfirmTimer = setTimeout(() => _disarmSettingsResetConfirm(btn), SETTINGS_RESET_CONFIRM_MS);
}

function _disarmSettingsResetConfirm(btn) {
  _settingsResetConfirmArmed = false;
  clearTimeout(_settingsResetConfirmTimer);
  _settingsResetConfirmTimer = null;
  btn.classList.remove('confirming');
  btn.title = 'Reset all settings to defaults';
  const label = btn.querySelector('.filter-reset-label');
  if (label) label.textContent = '↺ Reset all';
}

// Wipes the whole settings store (every tab, every toggle) back to
// SETTINGS_DEFAULTS and reloads. A full reload — rather than re-rendering
// in place the way doResetFilterPreferences() does — is deliberate here:
// several of these settings only ever get applied once, at boot, before
// this very script even runs (index.html's anti-flicker inline script,
// changelog.js's field-lines default, etc.), so there's no single
// in-place code path that could reliably re-apply every one of them
// consistently. A reload re-runs that whole boot sequence for free.
function doResetAllSettings() {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  location.reload(true);
}

// ── Export / Import settings backup ─────────────────────────────────────
// Lets the whole settings store move to another device/browser, or be
// restored after a reinstall or a cleared site data. Exported as flat
// "tab.key" codes (e.g. "display.showAvatar") rather than the nested
// {tab:{key}} shape settingsCache actually uses — that flat code is each
// setting's stable identity in a backup file, independent of which tab it
// happens to live under in SETTINGS_DEFAULTS today. That's what makes an
// old backup safe to import after later phases change things:
//  - a setting added since the backup was made simply isn't in the file,
//    so it's left alone (same per-key merge migrateSettings() already does
//    for a freshly-loaded old save — importing doesn't wipe the store, it
//    only overwrites the keys actually present in the file);
//  - a setting removed since the backup was made has no matching code
//    anymore, so it's silently skipped rather than resurrected;
//  - a setting that moves to a different tab in a future phase still
//    matches by its code as long as the code itself (tab.key at the time
//    it was first introduced) isn't reused for something else — same
//    convention as never reassigning an old localStorage key to a new
//    meaning.
// Only a setting's key itself getting renamed breaks the match — no worse
// than what a rename would already do to migrateSettings().
const SETTINGS_BACKUP_APP_ID = 'flux-settings-backup';

// Tabs deliberately left out of every export/import: not real portable
// preferences, just runtime state tied to *this* device's own cache/
// download, which a backup file can't carry along with the number.
// offline.until says whether sw.js should currently be treating the
// offline-mode file cache as present — importing that timestamp from
// another device (or an old backup on this one) without the matching
// download actually existing risks the app believing it's offline-ready,
// and sw.js blocking every request, when nothing was actually fetched.
const SETTINGS_BACKUP_EXCLUDED_TABS = ['offline'];

function _settingsBackupValidCodes() {
  const codes = {};
  for (const tab of Object.keys(SETTINGS_DEFAULTS)) {
    if (SETTINGS_BACKUP_EXCLUDED_TABS.indexOf(tab) !== -1) continue;
    for (const key of Object.keys(SETTINGS_DEFAULTS[tab])) codes[tab + '.' + key] = true;
  }
  return codes;
}

function buildSettingsBackupPayload() {
  const s = loadSettings();
  const flat = {};
  for (const code of Object.keys(_settingsBackupValidCodes())) {
    const dot = code.indexOf('.');
    const tab = code.slice(0, dot), key = code.slice(dot + 1);
    flat[code] = s[tab] ? s[tab][key] : SETTINGS_DEFAULTS[tab][key];
  }
  return {
    app: SETTINGS_BACKUP_APP_ID,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: flat,
  };
}

function exportSettingsBackup() {
  try {
    const payload = buildSettingsBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flux-settings-backup-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Settings export failed:', e);
    alert("Sorry \u2014 that export didn't work. Please try again.");
  }
}

function triggerImportSettingsBackup() {
  const input = document.getElementById('settingsImportFileInput');
  if (input) input.click();
}

// Validates and previews the whole import (which codes match, which are
// unrecognized) before writing anything, so a cancelled confirm() below
// leaves settingsCache/localStorage completely untouched — the write only
// happens after the person confirms.
function handleSettingsImportFileSelected(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = ''; // reset so re-picking the same file still fires 'change' next time
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert("That file isn't a valid settings backup (couldn't be read as JSON).");
      return;
    }
    if (!data || typeof data.settings !== 'object' || !data.settings) {
      alert("That file isn't a valid settings backup.");
      return;
    }

    const validCodes = _settingsBackupValidCodes();
    const toApply = [];
    let skipped = 0;
    for (const code of Object.keys(data.settings)) {
      if (!validCodes[code]) { skipped++; continue; }
      const dot = code.indexOf('.');
      toApply.push([code.slice(0, dot), code.slice(dot + 1), data.settings[code]]);
    }

    if (toApply.length === 0) {
      alert("That backup didn't contain any settings this version recognizes.");
      return;
    }

    const skippedNote = skipped ? ` (${skipped} unrecognized entr${skipped === 1 ? 'y' : 'ies'} skipped)` : '';
    const ok = confirm(`Import ${toApply.length} setting${toApply.length === 1 ? '' : 's'}${skippedNote}? This overwrites your current settings and reloads the page.`);
    if (!ok) return;

    toApply.forEach(([tab, key, value]) => setSetting(tab, key, value));
    // Same full-reload approach as doResetAllSettings() above, and for the
    // same reason: several settings only ever get applied once at boot
    // (index.html's anti-flicker inline script, changelog.js's field-lines
    // default, etc.), so a reload is the one path that's guaranteed to
    // re-apply every imported value consistently, not just the ones this
    // file happens to also re-apply live.
    location.reload();
  };
  reader.onerror = () => {
    alert("Sorry \u2014 that file couldn't be read. Please try again.");
  };
  reader.readAsText(file);
}

// ── Rendering (called from renderSettingsOfflineTab() in js/offline-mode.js,
// appended after its own Cache & storage section — see that file — so this
// is always the very last section of the Settings screen.) ──
function renderSettingsBackupSection() {
  return `
    <div class="settings-backup-section">
      <div class="settings-offline-heading">Backup</div>
      <div class="settings-offline-desc">Save every setting on this device to a file, or restore one saved earlier \u2014 including on another device, or after clearing site data. A setting added since an old backup was made just keeps its default; one removed since is skipped.</div>
      <div class="settings-backup-btn-row">
        <button type="button" class="settings-offline-btn settings-offline-btn-secondary" onclick="exportSettingsBackup()" title="Download all settings as a file">
          <span class="settings-offline-btn-label">\u2B07\uFE0F Export settings</span>
        </button>
        <button type="button" class="settings-offline-btn settings-offline-btn-secondary" onclick="triggerImportSettingsBackup()" title="Restore settings from a file">
          <span class="settings-offline-btn-label">\u2B06\uFE0F Import settings</span>
        </button>
      </div>
      <input type="file" id="settingsImportFileInput" accept="application/json,.json" style="display:none" onchange="handleSettingsImportFileSelected(event)">
    </div>
  `;
}

const SETTINGS_TABS = [
  { id: 'display',       label: 'Display' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'study',         label: 'Study' },
  { id: 'offline',       label: 'Sync & Storage' },
];

function switchSettingsTab(tabId) {
  settingsActiveTab = tabId;
  renderSettingsScreen();
}

function renderSettingsScreen() {
  renderSettingsTabs();
  renderSettingsBody();
}

function renderSettingsTabs() {
  const nav = document.getElementById('settingsTabs');
  if (!nav) return;
  nav.innerHTML = SETTINGS_TABS.map(t => `
    <button class="settings-tab-btn${t.id === settingsActiveTab ? ' active' : ''}"
            onclick="switchSettingsTab('${t.id}')">${t.label}</button>
  `).join('');
}

// One row-renderer per tab. Display has the five Phase 1 toggles; the rest
// still render their empty-state note. Later phases replace a tab's body
// here with its real rows — the surrounding panel/tabs/storage layer
// doesn't change.
function renderSettingsBody() {
  const body = document.getElementById('settingsBody');
  if (!body) return;

  if (settingsActiveTab === 'display') {
    body.innerHTML = renderSettingsDisplayTab();
  } else if (settingsActiveTab === 'notifications') {
    body.innerHTML = renderSettingsNotificationsTab();
  } else if (settingsActiveTab === 'study') {
    body.innerHTML = renderSettingsStudyTab();
  } else if (settingsActiveTab === 'offline') {
    body.innerHTML = renderSettingsOfflineTab(); // js/offline-mode.js
    // The "Reset prerendered LaTeX equations" button's own label has a
    // literal $\mathrm{La\TeX}$ snippet in it (see renderCacheStorageSection
    // in js/offline-mode.js) — needs an explicit typeset pass same as any
    // other dynamically-inserted math, since MathJax only ever looks at
    // elements it's told to.
    if (typeof renderMathIn === 'function') renderMathIn(body);
  }
}

// One row per Display toggle: {key in SETTINGS_DEFAULTS.display, title, desc}.
// Checked = shown (default); unchecked = hidden. The one exception is
// followDeviceTheme (`sub`, grouped under showDaylightBtn — see
// renderSettingsDisplayTab): checked means "on" rather than "shown". While
// it's on, showDaylightBtn's own row renders forced-off and disabled (its
// stored value is untouched, just not in effect) and applyDisplaySettings()
// keeps the actual button hidden in the top icon strip regardless of that
// stored value.
const DISPLAY_TOGGLES = [
  {
    key: 'showAvatar',
    title: 'Show floating avatar',
    desc: 'Shows the signed-in identity avatar on the main page.',
  },
  {
    key: 'showSplashes',
    title: 'Show floating splashes',
    desc: 'Shows the Minecraft-style splash text badge on the main page.',
  },
  {
    key: 'showManualBtn',
    title: 'Show manual button',
    desc: 'Shows the 📖 manual button in the top icon strip.',
  },
  {
    key: 'showThemeBtn',
    title: 'Show theme selector button',
    desc: 'Shows the 🎨 color-theme button in the top icon strip.',
  },
  {
    key: 'showDaylightBtn',
    title: 'Show daylight switch button',
    desc: 'Shows the light/dark mode toggle in the top icon strip.',
  },
  {
    key: 'followDeviceTheme',
    title: 'Follow device theme',
    desc: 'Match light/dark mode to your device automatically.',
    sub: 'showDaylightBtn', // rendered indented, directly under the row for the key above
  },
  {
    key: 'showForumFab',
    title: 'Show floating forum button',
    desc: 'Shows the floating 💬 forum button that follows you mid-quiz, in Stats, and elsewhere off the main page.',
  },
  {
    key: 'showTopBarTip',
    title: 'Show running line',
    desc: 'Shows the rotating one-line tip that occasionally appears in the top bar once it\u2019s scrolled.',
  },
  {
    key: 'hideFieldLinesByDefault',
    title: 'Hide field lines by default',
    desc: 'Hides field lines animation that appear upon changelog opening.',
  },
];

// Toggles that have a `sub` entry pointing at them get rendered as one
// visually-grouped unit with that sub-row (see renderSettingsDisplayTab) —
// currently just showDaylightBtn/followDeviceTheme.
function renderSettingsDisplayTab() {
  const followDevice = getSetting('display', 'followDeviceTheme') === true;

  function renderRow(t, opts) {
    opts = opts || {};
    const blocked = !!opts.blocked;
    const storedOn = getSetting('display', t.key) !== false;
    // Blocked rows render forced-off, not whatever the user last stored —
    // that stored value is exactly what comes back once unblocked, so it's
    // never overwritten just because it's temporarily moot.
    const on = blocked ? false : storedOn;
    // followDeviceTheme also has to (re)sync the actual light/dark mode
    // and its matchMedia listener the moment it's flipped, not just the
    // hide/show class applyDisplaySettings() handles for every other row.
    // hideFieldLinesByDefault is intentionally NOT special-cased here
    // (unlike followDeviceTheme above): it only ever writes the persisted
    // default via the generic branch below, with no call into
    // setFieldLinesEnabled — see js/changelog.js's toggleFieldLines() for
    // the session-only counterpart this no longer syncs with.
    const onchange = t.key === 'followDeviceTheme'
      ? `setSetting('display', '${t.key}', this.checked); applyFollowDeviceTheme(); applyDisplaySettings(); syncShowDaylightBtnBlock(this.checked);`
      : `setSetting('display', '${t.key}', this.checked); applyDisplaySettings();`;
    return `
      <div class="settings-row${opts.sub ? ' settings-row-sub' : ''}${blocked ? ' settings-row-blocked' : ''}" data-row-key="${t.key}">
        <div class="settings-row-label">
          <div class="settings-row-title">${t.title}</div>
          <div class="settings-row-desc">${t.desc}</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''}
                 onchange="${onchange}">
          <span class="settings-switch-track"></span>
        </label>
      </div>
    `;
  }

  const html = [];
  for (const t of DISPLAY_TOGGLES) {
    if (t.sub) continue; // rendered inline below, as part of its parent's group
    const subToggle = DISPLAY_TOGGLES.find(s => s.sub === t.key);
    if (!subToggle) { html.push(renderRow(t)); continue; }
    html.push(`
      <div class="settings-group">
        ${renderRow(t, { blocked: t.key === 'showDaylightBtn' && followDevice })}
        ${renderRow(subToggle, { sub: true })}
      </div>
    `);
  }
  return html.join('');
}

// In-place counterpart to a full renderSettingsBody() for followDeviceTheme
// -> showDaylightBtn: a full re-render would rebuild followDeviceTheme's
// own switch too, mid-flip — the new checkbox node is created already
// sitting in its final checked position, so its on/off slide never gets a
// frame to animate from and just snaps instead. This only patches the
// OTHER row (showDaylightBtn), leaving the switch that was actually
// clicked untouched so its own CSS transition plays normally. Mirrors the
// `blocked` forced-off logic in renderRow above: while Follow device theme
// is on, the row renders dimmed/disabled and its switch shows off,
// regardless of showDaylightBtn's own stored value.
function syncShowDaylightBtnBlock(followDeviceOn) {
  const row = document.querySelector('[data-row-key="showDaylightBtn"]');
  if (!row) return;
  row.classList.toggle('settings-row-blocked', followDeviceOn);
  const input = row.querySelector('input[type="checkbox"]');
  if (!input) return;
  input.disabled = followDeviceOn;
  input.checked = followDeviceOn ? false : (getSetting('display', 'showDaylightBtn') !== false);
}

// Notifications tab: two independent single toggles (theme nudge, bug
// report) plus two parent+sub groups. Unlike the Display tab's groups
// above, the blocking direction here runs the other way — each sub only
// does anything while its OWN parent is ON, so the sub is what renders
// blocked/disabled, not the parent:
//   - hideUpdateReminder -> forceRefreshOutsideQuiz (sub blocked unless the
//     reminder is actually hidden — the sub has nothing to override
//     otherwise)
//   - goSilent -> goSilentAutoOff24h (sub blocked unless Go silent is
//     actually on — nothing to auto-turn-off otherwise)
// All six default OFF, unlike Display's default-on toggles, since every
// one of these is an opt-in suppression of today's normal behavior.
function renderSettingsNotificationsTab() {
  function renderRow(key, title, desc, opts) {
    opts = opts || {};
    const blocked = !!opts.blocked;
    const on = getSetting('notifications', key) === true;
    // goSilent also has to stamp/clear goSilentEnabledAt (the 24h auto-off
    // window's start time) the moment it's flipped, not just the hide
    // classes applyNotificationSettings() handles for every other row.
    // Only hideUpdateReminder and goSilent have a sub-row to unblock, so
    // only those two call syncNotificationSubBlock — the rest have nothing
    // else on the page depending on them and don't need any DOM sync
    // beyond their own switch, which the browser already handles on its
    // own via the input's :checked CSS transition (see
    // syncShowDaylightBtnBlock's comment, above renderSettingsDisplayTab,
    // for why calling a full re-render here — as this used to — would kill
    // that transition for every one of these six switches).
    const onchange = key === 'goSilent'
      ? `setSetting('notifications', 'goSilent', this.checked); setSetting('notifications', 'goSilentEnabledAt', this.checked ? Date.now() : null); applyNotificationSettings(); syncNotificationSubBlock('goSilent', this.checked);`
      : (key === 'hideUpdateReminder'
          ? `setSetting('notifications', '${key}', this.checked); applyNotificationSettings(); syncNotificationSubBlock('hideUpdateReminder', this.checked);`
          : `setSetting('notifications', '${key}', this.checked); applyNotificationSettings();`);
    return `
      <div class="settings-row${opts.sub ? ' settings-row-sub' : ''}${blocked ? ' settings-row-blocked' : ''}" data-row-key="${key}">
        <div class="settings-row-label">
          <div class="settings-row-title">${title}</div>
          <div class="settings-row-desc">${desc}</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''}
                 onchange="${onchange}">
          <span class="settings-switch-track"></span>
        </label>
      </div>
    `;
  }

  const hideUpdate = getSetting('notifications', 'hideUpdateReminder') === true;
  const goSilentOn = getSetting('notifications', 'goSilent') === true;

  return `
    <div class="settings-group">
      ${renderRow('hideUpdateReminder', 'Hide update reminder', 'Hides the "new version available" banner.')}
      ${renderRow('forceRefreshOutsideQuiz', 'Update anyway outside quiz mode', 'While the reminder above is hidden, silently reloads the page the instant you\u2019re not in the middle of a timed Random-quiz attempt.', { sub: true, blocked: !hideUpdate })}
    </div>
    ${renderRow('hideThemeNudge', 'Hide try new theme reminder', 'Hides the occasional "trying the X theme" banner.')}
    ${renderRow('hideBugReportReminder', 'Hide bug report reminder', 'Hides the "Report on Telegram" banner.')}
    <div class="settings-group">
      ${renderRow('goSilent', 'Go silent', 'Hides every notification badge (problem buttons, the forum button) and every banner above, and mutes forum push notifications while it\u2019s on.')}
      ${renderRow('goSilentAutoOff24h', 'Turn off automatically after 24 hours', 'Turns Go silent back off on its own a day after you enable it.', { sub: true, blocked: !goSilentOn })}
    </div>
  `;
}

// In-place counterpart to a full renderSettingsBody() for the two
// Notifications parent/sub pairs — see syncShowDaylightBtnBlock's comment
// (Display tab, above) for why re-rendering the whole tab here would kill
// the parent switch's own on/off animation. Both subs here are only ever
// blocked by "parent is off" (unlike showDaylightBtn, which also gets
// forced to a different on/off value), so this only needs to touch the
// dimmed look and the disabled state.
const NOTIFICATION_SUB_ROW_KEYS = {
  hideUpdateReminder: 'forceRefreshOutsideQuiz',
  goSilent: 'goSilentAutoOff24h',
};
function syncNotificationSubBlock(parentKey, parentOn) {
  const subKey = NOTIFICATION_SUB_ROW_KEYS[parentKey];
  const row = subKey && document.querySelector(`[data-row-key="${subKey}"]`);
  if (!row) return;
  row.classList.toggle('settings-row-blocked', !parentOn);
  const input = row.querySelector('input[type="checkbox"]');
  if (input) input.disabled = !parentOn;
}

// Study tab: a general row (Reduce motion), then two visibly-labeled
// sections — Random Quiz and Solve Them All — since most of these settings
// only make sense for one mode or the other. Parent+sub groups here follow
// the Notifications tab's "sub blocked unless parent is on" shape
// (fullscreenRandomN -> its reminder preference, and lockSolveAllOrder ->
// its ordered/shuffled choice), while the remaining rows are standalone toggles.
function renderSettingsStudyTab() {
  const showLiveTimerOn = getSetting('study', 'showLiveTimer') !== false;
  const lockOrderOn     = getSetting('study', 'lockSolveAllOrder') === true;
  const lockedOrder     = getSetting('study', 'solveAllLockedOrder') === 'unordered' ? 'unordered' : 'ordered';
  const navRailOn       = getSetting('study', 'showSolveAllNavRail') !== false;

  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Reduce motion</div>
        <div class="settings-row-desc">Cuts every animation/transition site-wide down to effectively instant. Might be helpful for power-saving.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'reduceMotion') === true ? 'checked' : ''}
               onchange="setSetting('study', 'reduceMotion', this.checked); applyStudySettings();">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-section-header">Random Quiz</div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Show live timer</div>
        <div class="settings-row-desc">Shows a floating clock, bottom-right, counting up while you take a Random 6 or cumulative quiz.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${showLiveTimerOn ? 'checked' : ''}
               onchange="setSetting('study', 'showLiveTimer', this.checked); if (typeof setLiveQuizTimerDisplayEnabled === 'function') setLiveQuizTimerDisplayEnabled(this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Reset filter on page load</div>
        <div class="settings-row-desc">Clears any saved topic/number/type filter back to "everything" the moment the page loads, instead of remembering what you last had set.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'resetFilterOnLoad') === true ? 'checked' : ''}
               onchange="setSetting('study', 'resetFilterOnLoad', this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Automatically stop after 50 minutes</div>
        <div class="settings-row-desc">Submits the attempt on its own if 50 minutes pass without you finishing.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'autoStopAt50Min') === true ? 'checked' : ''}
               onchange="setSetting('study', 'autoStopAt50Min', this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-row" data-row-key="fullscreenRandomN">
        <div class="settings-row-label">
          <div class="settings-row-title">Full screen for Random N</div>
          <div class="settings-row-desc">Enters full screen the moment a Random N attempt starts, and leaves it again the instant your score is revealed.</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" ${getSetting('study', 'fullscreenRandomN') === true ? 'checked' : ''}
                 onchange="setSetting('study', 'fullscreenRandomN', this.checked); syncFullscreenHintSubBlock(this.checked); if (typeof syncFullscreenHintPreference === 'function') syncFullscreenHintPreference();">
          <span class="settings-switch-track"></span>
        </label>
      </div>
      <div class="settings-row settings-row-sub${getSetting('study', 'fullscreenRandomN') === true ? '' : ' settings-row-blocked'}" data-row-key="hideFullscreenReminder">
        <div class="settings-row-label">
          <div class="settings-row-title">Don’t show full-screen reminder</div>
          <div class="settings-row-desc">Hides the 10-second hint that appears at the bottom when a Random N quiz enters full screen.</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" ${getSetting('study', 'hideFullscreenReminder') === true ? 'checked' : ''} ${getSetting('study', 'fullscreenRandomN') === true ? '' : 'disabled'}
                 onchange="setSetting('study', 'hideFullscreenReminder', this.checked); if (typeof syncFullscreenHintPreference === 'function') syncFullscreenHintPreference();">
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Select latest quiz by default</div>
        <div class="settings-row-desc">Landing on the main page selects the newest available quiz instead of always Quiz #1. Applies from your next page load.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'selectLatestQuizByDefault') === true ? 'checked' : ''}
               onchange="setSetting('study', 'selectLatestQuizByDefault', this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Select cumulative by default</div>
        <div class="settings-row-desc">Selecting quiz #2 or later starts with the Cumulative switch already on, instead of Single quiz. Applies from your next page load.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'cumulativeDefaultOn') === true ? 'checked' : ''}
               onchange="setSetting('study', 'cumulativeDefaultOn', this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Hide topic while active</div>
        <div class="settings-row-desc">Hides each problem's topic label (top-right of the card) while the attempt is in progress. Comes back once your score is revealed.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'hideTopicWhileActive') === true ? 'checked' : ''}
               onchange="setSetting('study', 'hideTopicWhileActive', this.checked); applyStudySettings();">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-section-header">Solve Them All</div>

    <div class="settings-group">
      <div class="settings-row" data-row-key="lockSolveAllOrder">
        <div class="settings-row-label">
          <div class="settings-row-title">Lock order</div>
          <div class="settings-row-desc">Skips the order picker: jumps straight into the order chosen below.</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" ${lockOrderOn ? 'checked' : ''}
                 onchange="setSetting('study', 'lockSolveAllOrder', this.checked); syncSolveAllOrderBlock(this.checked);">
          <span class="settings-switch-track"></span>
        </label>
      </div>
      <div class="settings-row settings-row-sub${lockOrderOn ? '' : ' settings-row-blocked'}" data-row-key="solveAllOrder">
        <div class="settings-row-label">
          <div class="settings-row-title">Order</div>
          <div class="settings-row-desc">Which order gets used automatically once the picker above is skipped.</div>
        </div>
        <div class="settings-choice-group">
          <button type="button" class="settings-choice-btn${lockedOrder === 'ordered' ? ' active' : ''}" ${lockOrderOn ? '' : 'disabled'} data-order="ordered"
                  onclick="setSetting('study', 'solveAllLockedOrder', 'ordered'); syncSolveAllOrderActive('ordered');">Ordered</button>
          <button type="button" class="settings-choice-btn${lockedOrder === 'unordered' ? ' active' : ''}" ${lockOrderOn ? '' : 'disabled'} data-order="unordered"
                  onclick="setSetting('study', 'solveAllLockedOrder', 'unordered'); syncSolveAllOrderActive('unordered');">Shuffled</button>
        </div>
      </div>
    </div>

    <div class="settings-row" data-row-key="showSolveAllNavRail">
      <div class="settings-row-label">
        <div class="settings-row-title">Line progress</div>
        <div class="settings-row-desc">Shows the progress rail beside Solve Them All on wide screens — problem ticks, a "you are here" segment, and a pointer that tracks scroll.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${navRailOn ? 'checked' : ''}
               onchange="setSetting('study', 'showSolveAllNavRail', this.checked); applyStudySettings();">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Show progress window</div>
        <div class="settings-row-desc">The floating solved-count badge, bottom-right, while Solve Them All is open.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'showStickyScore') !== false ? 'checked' : ''}
               onchange="setSetting('study', 'showStickyScore', this.checked); applyStudySettings();">
        <span class="settings-switch-track"></span>
      </label>
    </div>

    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Reveal wrong answer instantly</div>
        <div class="settings-row-desc">Skips the "See correct answer" step. A wrong answer (not partial credit) shows the correct one right away.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${getSetting('study', 'revealWrongInstantly') === true ? 'checked' : ''}
               onchange="setSetting('study', 'revealWrongInstantly', this.checked);">
        <span class="settings-switch-track"></span>
      </label>
    </div>
  `;
}

// In-place counterpart to a full renderSettingsBody() for Lock order ->
// Order — see syncShowDaylightBtnBlock's comment (Display tab, above
// renderSettingsDisplayTab) for why re-rendering the whole tab on every
// flip would kill Lock order's own switch animation. The Order sub-row
// only ever gets blocked/unblocked here, never forced to a different
// choice, so this just toggles the dimmed look and the two buttons'
// disabled state.
function syncFullscreenHintSubBlock(fullscreenOn) {
  const row = document.querySelector('[data-row-key="hideFullscreenReminder"]');
  if (!row) return;
  row.classList.toggle('settings-row-blocked', !fullscreenOn);
  const input = row.querySelector('input[type="checkbox"]');
  if (input) input.disabled = !fullscreenOn;
}

function syncSolveAllOrderBlock(lockOrderOn) {
  const row = document.querySelector('[data-row-key="solveAllOrder"]');
  if (!row) return;
  row.classList.toggle('settings-row-blocked', !lockOrderOn);
  row.querySelectorAll('.settings-choice-btn').forEach(btn => { btn.disabled = !lockOrderOn; });
}

// In-place counterpart to a full renderSettingsBody() for the
// Ordered/Shuffled choice buttons themselves — same reasoning as
// syncSolveAllOrderBlock above, just for the .active highlight instead of
// the blocked state.
function syncSolveAllOrderActive(order) {
  const row = document.querySelector('[data-row-key="solveAllOrder"]');
  if (!row) return;
  row.querySelectorAll('.settings-choice-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.order === order);
  });
}

// Applies the Study-tab settings that need an <html> class (reduce motion,
// hide-topic-while-active, the Solve-All nav rail's show/hide, the sticky
// score badge's show/hide) — same mechanism as applyDisplaySettings/
// applyNotificationSettings above. Called once at load and again from each
// relevant row's onchange.
function applyStudySettings() {
  document.documentElement.classList.toggle('settings-reduce-motion', getSetting('study', 'reduceMotion') === true);
  document.documentElement.classList.toggle('settings-hide-topic-while-active', getSetting('study', 'hideTopicWhileActive') === true);
  document.documentElement.classList.toggle('settings-hide-sa-nav-rail', getSetting('study', 'showSolveAllNavRail') === false);
  document.documentElement.classList.toggle('settings-hide-sticky-score', getSetting('study', 'showStickyScore') === false);
}

// Settings > Study > "Reset filter on page load" — clears every quiz's
// saved topic/number/type filter (and filter-mode) back to defaults.
// Called once at load, before the person has any real chance to have
// opened a quiz yet — see the "own copy, read early" reasoning on
// _readStudySettingRaw (js/quiz-engine.js) for why this can't just wait
// for initTopics() to run instead: that only runs once a mode is actually
// selected, by which point the filter's already been read and rendered
// with whatever was there before this clears it.
function maybeResetProblemPoolFilters() {
  if (getSetting('study', 'resetFilterOnLoad') !== true) return;
  if (typeof QUIZZES === 'undefined' || typeof STORAGE_PREFIX === 'undefined') return;
  QUIZZES.forEach((_, idx) => {
    const n = idx + 1;
    localStorage.removeItem(STORAGE_PREFIX + '_topics_q' + n);
    localStorage.removeItem(STORAGE_PREFIX + '_typefilter_q' + n);
    localStorage.removeItem(STORAGE_PREFIX + '_numfilter_q' + n);
    localStorage.removeItem(STORAGE_PREFIX + '_filtermode_q' + n);
  });
}

// Maps each Display toggle's key to the <html> class that hides its
// target element(s) when the toggle is OFF — the actual hide/show rules
// live in css/settings.css as `html.<class> <selector> { display: none; }`,
// so this function never needs to know where those elements actually live
// in the DOM. Named for what the class *does* (hide), even though the
// toggle it's driven by is framed the opposite way ("show", on by
// default) — keeps this in sync with the class names css/settings.css
// actually matches on.
const DISPLAY_TOGGLE_HIDE_CLASSES = {
  showAvatar:      'settings-hide-avatar',
  showSplashes:    'settings-hide-splashes',
  showManualBtn:   'settings-hide-manual-btn',
  showThemeBtn:    'settings-hide-theme-btn',
  showDaylightBtn: 'settings-hide-daylight-btn',
  showForumFab:    'settings-hide-forum-fab',
  showTopBarTip:   'settings-hide-top-bar-tip',
};

// Applies every current Display setting to <html>'s classList (not
// <body> — see the header comment on why). Called once at load (bottom of
// this file) so a live-toggled change since the anti-flicker script last
// ran is reconciled, and again from each toggle's onchange above.
function applyDisplaySettings() {
  for (const key of Object.keys(DISPLAY_TOGGLE_HIDE_CLASSES)) {
    const cls = DISPLAY_TOGGLE_HIDE_CLASSES[key];
    let shown = getSetting('display', key) !== false;
    // followDeviceTheme overrides showDaylightBtn's own value: once mode is
    // following the device automatically, the manual switch has nothing
    // left to do, so it stays blocked from showing regardless of whether
    // showDaylightBtn itself is still checked.
    if (key === 'showDaylightBtn' && getSetting('display', 'followDeviceTheme') === true) {
      shown = false;
    }
    document.documentElement.classList.toggle(cls, !shown);
  }
}

// ── Notifications ───────────────────────────────────────────────────────
// Banner-hide classes: one per banner, each driven by "its own hide
// setting OR Go silent" — Go silent is a blanket override on top of the
// three individual reminders, not a separate fourth hide mechanism.
const NOTIF_BANNER_HIDE_CLASSES = {
  hideUpdateReminder:     'settings-hide-update-banner',
  hideThemeNudge:         'settings-hide-theme-banner',
  hideBugReportReminder:  'settings-hide-bug-banner',
};

// IndexedDB mirror of the effective Go-silent state, so sw.js's 'push'
// handler can read it: that handler is a true service-worker-only event
// (fires even with the site fully closed, no tab/page context at all — see
// sw.js's own comment), and localStorage — where every other setting
// lives — simply isn't reachable from a service worker. IndexedDB is the
// one storage both sides can actually get to. Same DB name/store/key must
// stay in sync with sw.js's own copy of this.
const NOTIF_MUTE_DB_NAME = 'flux-notif-mute';
const NOTIF_MUTE_STORE = 'flags';
function writeNotifMuteFlag(muted) {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open(NOTIF_MUTE_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(NOTIF_MUTE_STORE); };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(NOTIF_MUTE_STORE, 'readwrite');
        tx.objectStore(NOTIF_MUTE_STORE).put(!!muted, 'muted');
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch (e) { db.close(); }
    };
    // req.onerror: IndexedDB unavailable/blocked — push notifications (if
    // any are even subscribed) just show as normal; nothing further to do.
  } catch (e) { /* ignore */ }
}

// Applies every current Notifications setting: banner-hide classes on
// <html> (same mechanism as applyDisplaySettings — see css/settings.css),
// the badge-hide class for Go silent, and the IndexedDB mirror push
// notifications read. Called once at load (bottom of this file) and again
// from every row's onchange above. Also where the 24h auto-off actually
// gets enforced — checked every time this runs, which includes the
// periodic recheck scheduleGoSilentAutoOffCheck() sets up below, so it
// still fires even if the tab's been left open past the 24h mark without
// a reload.
function applyNotificationSettings() {
  // ── 24h auto-off ──
  const goSilentOn = getSetting('notifications', 'goSilent') === true;
  const autoOffOn  = getSetting('notifications', 'goSilentAutoOff24h') === true;
  const enabledAt  = getSetting('notifications', 'goSilentEnabledAt');
  if (goSilentOn && autoOffOn && enabledAt && (Date.now() - enabledAt >= 24 * 60 * 60 * 1000)) {
    setSetting('notifications', 'goSilent', false);
    setSetting('notifications', 'goSilentEnabledAt', null);
  }
  const effectiveSilent = getSetting('notifications', 'goSilent') === true; // re-read: may have just been auto-cleared above

  // ── Per-banner hide classes (own setting OR Go silent) ──
  for (const key of Object.keys(NOTIF_BANNER_HIDE_CLASSES)) {
    const cls = NOTIF_BANNER_HIDE_CLASSES[key];
    const hide = getSetting('notifications', key) === true || effectiveSilent;
    document.documentElement.classList.toggle(cls, hide);
  }

  // ── Badges (problem buttons + forum button) — Go silent only ──
  document.documentElement.classList.toggle('settings-silent-badges', effectiveSilent);
  document.documentElement.classList.toggle('settings-hide-fullscreen-hint', effectiveSilent);
  if (typeof syncFullscreenHintPreference === 'function') syncFullscreenHintPreference();

  // ── Push notifications mirror ──
  writeNotifMuteFlag(effectiveSilent);
}

// Catches the 24h auto-off boundary even if the tab is simply left open
// (not reloaded) past it — applyNotificationSettings() re-checks this
// every time it runs, this just makes sure it keeps running periodically
// rather than only on the next settings change. Same interval as the
// version-update poll; no need for anything finer-grained than that.
setInterval(() => { if (typeof applyNotificationSettings === 'function') applyNotificationSettings(); }, 5 * 60 * 1000);

// ── Follow device theme ─────────────────────────────────────────────────
// Day/night mode (body.light + localStorage[STORAGE_PREFIX + '-theme'] —
// see toggleTheme()/the restore IIFE in js/quiz-engine.js, which has
// already run by the time this tier-2 file loads) normally only changes
// via the manual daylight switch. When followDeviceTheme is on, this
// takes over instead: mode tracks matchMedia('(prefers-color-scheme:
// dark)') live, and the manual switch is hidden by applyDisplaySettings()
// above since there's nothing left for it to do. Turning this back off
// just stops syncing — whatever mode the system last set stays as the new
// manual preference, so flipping it off never causes its own extra flip.
//
// Only settings.js (not quiz-engine.js) owns this: it's tier-2, so a
// device-following user can see one brief flash of their *last manually
// saved* mode before this runs and corrects it to the system's current
// mode — same latency every other Display toggle already accepts (see
// index.html's anti-flicker script) for not being in the tier-1 path.
const DEVICE_THEME_QUERY = (typeof window.matchMedia === 'function')
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;
let _deviceThemeListening = false;

function setModeFromSystem() {
  const isLight = !!(DEVICE_THEME_QUERY && !DEVICE_THEME_QUERY.matches);
  // Skip entirely if the site is already showing what the device wants —
  // without this, turning the setting on (or every page load) always ran
  // the fade tick and re-applied every hook below even when dark-to-dark
  // or light-to-light, causing a visible flicker for no actual change.
  if (document.body.classList.contains('light') === isLight) return;
  if (window.themeFadeTick) themeFadeTick();
  document.body.classList.toggle('light', isLight);
  const track = document.getElementById('themeTrack');
  if (track) track.classList.toggle('on', isLight);
  localStorage.setItem(STORAGE_PREFIX + '-theme', isLight ? 'light' : 'dark');
  // Same post-flip hooks toggleTheme() itself calls, so custom-theme mode
  // colors and on-color contrast stay in sync either way.
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  if (window.__updateOnColorVars) window.__updateOnColorVars();
  if (window.__onModeChanged) window.__onModeChanged();
}

function onDeviceThemeChange() {
  if (getSetting('display', 'followDeviceTheme') === true) setModeFromSystem();
}

function applyFollowDeviceTheme() {
  if (!DEVICE_THEME_QUERY) return; // no matchMedia support — setting is inert, button just stays hidden per its own value
  const on = getSetting('display', 'followDeviceTheme') === true;
  if (on && !_deviceThemeListening) {
    if (DEVICE_THEME_QUERY.addEventListener) DEVICE_THEME_QUERY.addEventListener('change', onDeviceThemeChange);
    else DEVICE_THEME_QUERY.addListener(onDeviceThemeChange); // Safari < 14
    _deviceThemeListening = true;
  } else if (!on && _deviceThemeListening) {
    if (DEVICE_THEME_QUERY.removeEventListener) DEVICE_THEME_QUERY.removeEventListener('change', onDeviceThemeChange);
    else DEVICE_THEME_QUERY.removeListener(onDeviceThemeChange);
    _deviceThemeListening = false;
  }
  if (on) setModeFromSystem();
}

// Runs immediately at load, not just when the panel is opened, so a live
// toggle change made during this same page life (or a schema addition
// this version introduced) is reflected right away. The very first paint
// is already covered by index.html's own anti-flicker inline script — this
// is the settings.js-side reconciliation pass, safe to run redundantly
// against it. settings.js is loaded via the tier-2 sequential loader (see
// index.html) after the body's own markup has already been parsed, so
// document.documentElement and every target element already exist by the
// time this line runs. applyFollowDeviceTheme() runs first since it may
// itself set STORAGE_PREFIX + '-theme' anew — applyDisplaySettings() reads
// followDeviceTheme's already-current value either way, so order between
// the two doesn't actually matter for the hide/show class itself.
applyFollowDeviceTheme();
applyDisplaySettings();
// changelog.js loads before this file in the tier-2 sequence (see index.html's
// loader list) and defaults fieldLinesEnabled to true since it has no way to
// read a persisted setting yet at that point — apply the "hide by default"
// starting state here, the one time it actually applies: this file loading
// is the start of the session, exactly what the setting controls. Nothing
// after this point keeps the two in sync on purpose — see
// hideFieldLinesByDefault above and toggleFieldLines() in changelog.js.
// No flash-of-wrong-state risk the way theme/display toggles have: field
// lines only ever become visible once the person opens the changelog
// panel, a later action that's already well past this point.
if (typeof setFieldLinesEnabled === 'function') setFieldLinesEnabled(getSetting('display', 'hideFieldLinesByDefault') !== true);

// Notifications: applies banner-hide classes, the badge-hide class, the
// 24h Go-silent auto-off check, and mirrors the effective mute state into
// IndexedDB for sw.js's push handler — all on this same "start of session"
// pass, same reasoning as the two calls above.
applyNotificationSettings();

// Study: reduce-motion + hide-topic-while-active <html> classes, and the
// one-time "clear every quiz's saved filter" pass — same "start of
// session" timing as everything above. selectLatestQuizByDefault/
// cumulativeDefaultOn/lockSolveAllOrder/autoStopAt50Min/fullscreenRandomN/
// revealWrongInstantly all read getSetting() directly at the point they're
// needed instead (quiz-engine.js), so nothing else needs applying here.
applyStudySettings();
maybeResetProblemPoolFilters();
