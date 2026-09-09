// ─── Settings ────────────────────────────────────────────────────────────
// Phase 0 built: a versioned, device-local (localStorage only — no
// cross-device sync, by design) settings schema + migration; the settings
// panel shell (gear button -> full-screen panel, same open/close fade
// pattern as #manualScreen — see js/manual.js); and grouped tabs (Display /
// Notifications / Study / Offline & Sync).
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
  },
  notifications: {},
  study: {},
  offline: {},
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
  },
  {
    id: 'statsScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'reviewScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'forumScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'manualScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'choicePage',
    isVisible: el => !el.classList.contains('hidden'),
    hide:      el => el.classList.add('hidden'),
    show:      el => el.classList.remove('hidden', 'fading-out'),
  },
];

let settingsHostId = null;

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

function openSettingsScreen() {
  const landing  = document.getElementById('landingScreen');
  const settings = document.getElementById('settingsScreen');
  if (!landing || !settings || settingsIsOpen) return;
  settingsIsOpen = true;
  if (settingsAnimTimer) { clearTimeout(settingsAnimTimer); settingsAnimTimer = null; }

  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  const landingShowing = !landing.classList.contains('hidden');
  const hostEntry = landingShowing ? null : SETTINGS_HOSTS.find(h => {
    const el = document.getElementById(h.id);
    return el && h.isVisible(el);
  });
  const hostEl = hostEntry ? document.getElementById(hostEntry.id) : landing;
  settingsHostId = hostEntry ? hostEntry.id : null;

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
    // Fresh open every time: always land back on the Display tab, same
    // "reset filters on open" convention as openManualScreen/
    // openStatsScreen rather than carrying over the last-viewed tab.
    settingsActiveTab = 'display';
    renderSettingsScreen();
  }, 280);
}

// `forceLanding` is true only when goToMainMenu() (quiz-engine.js) closes
// Settings via the site logo/main-menu action — same convention as
// closeManualScreen/closeForumScreen's own forceLanding param.
function closeSettingsScreen(forceLanding) {
  const landing  = document.getElementById('landingScreen');
  const settings = document.getElementById('settingsScreen');
  if (!landing || !settings || !settingsIsOpen) return;
  settingsIsOpen = false;
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
      if (host && hostEl) { host.show(hostEl); return; }
    }

    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
  }, 280);
}

// ── Tabs ────────────────────────────────────────────────────────────────
const SETTINGS_TABS = [
  { id: 'display',       label: 'Display' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'study',         label: 'Study' },
  { id: 'offline',       label: 'Offline & Sync' },
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
    body.innerHTML = `<div class="settings-empty-note">Nothing here yet: mute controls (update/theme/bug-report reminders, "go silent", and per-type forum notification muting) land in a later phase.</div>`;
  } else if (settingsActiveTab === 'study') {
    body.innerHTML = `<div class="settings-empty-note">Nothing here yet: reduce motion, LaTeX re-render on Enter, Random N loader/filter behavior, Solve-Them-All order lock, and answer-reveal mode land in a later phase.</div>`;
  } else if (settingsActiveTab === 'offline') {
    body.innerHTML = `<div class="settings-empty-note">Nothing here yet: Prepare/Go offline lands in a later phase.</div>`;
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
    desc: 'Match light/dark mode to your device automatically. While this is on, the daylight switch above stays hidden — there\u2019s nothing to flip by hand.',
    sub: 'showDaylightBtn', // rendered indented, directly under the row for the key above
  },
  {
    key: 'showForumFab',
    title: 'Show floating forum button',
    desc: 'Shows the floating 💬 forum button that follows you mid-quiz, in Stats, and elsewhere off the main page.',
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
    const onchange = t.key === 'followDeviceTheme'
      ? `setSetting('display', '${t.key}', this.checked); applyFollowDeviceTheme(); applyDisplaySettings(); renderSettingsBody();`
      : `setSetting('display', '${t.key}', this.checked); applyDisplaySettings();`;
    return `
      <div class="settings-row${opts.sub ? ' settings-row-sub' : ''}${blocked ? ' settings-row-blocked' : ''}">
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
