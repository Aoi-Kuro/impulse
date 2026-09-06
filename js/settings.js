// ─── Settings ────────────────────────────────────────────────────────────
// Phase 0: infrastructure only. This module owns:
//   1. A versioned, device-local (localStorage only — no cross-device sync,
//      by design) settings schema + migration so future settings can be
//      added without ever wiping or crashing on an older saved copy.
//   2. The settings panel shell: gear button -> full-screen panel, same
//      open/close fade pattern as #manualScreen (see js/manual.js).
//   3. Grouped tabs (Display / Notifications / Study / Offline & Sync) with
//      one dummy "wiring test" toggle in Display, proving the whole loop
//      (click -> save -> reload -> persists) before any real setting is
//      built on top of it.
//
// Later phases just add entries to SETTINGS_DEFAULTS and a row to the
// relevant renderSettings*Tab() function below — no changes to the
// storage/migration/panel plumbing itself should ever be needed again.

const SETTINGS_STORAGE_KEY = 'flux_settings';
const SETTINGS_SCHEMA_VERSION = 1;

// Every real setting gets registered here as {tab: {key: defaultValue}}.
// All new toggles default to their current (off/unchanged) behavior per
// the Phase 0 planning decision — nothing changes for anyone until they
// opt in.
const SETTINGS_DEFAULTS = {
  display: {
    // Phase 0 wiring-test only — delete this key once Phase 1 adds the
    // first real Display setting (hideAvatar, hideSplashes, ...).
    _wiringTest: false,
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

function toggleSettingsScreen() {
  const settings = document.getElementById('settingsScreen');
  if (settings && settings.classList.contains('visible')) {
    closeSettingsScreen();
  } else {
    openSettingsScreen();
  }
}

function openSettingsScreen() {
  const landing  = document.getElementById('landingScreen');
  const settings = document.getElementById('settingsScreen');
  if (!landing || !settings) return;

  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  const landingShowing = !landing.classList.contains('hidden');
  const hostEntry = landingShowing ? null : SETTINGS_HOSTS.find(h => {
    const el = document.getElementById(h.id);
    return el && h.isVisible(el);
  });
  const hostEl = hostEntry ? document.getElementById(hostEntry.id) : landing;
  settingsHostId = hostEntry ? hostEntry.id : null;

  hostEl.classList.add('fading-out');
  setTimeout(() => {
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
  if (!landing || !settings) return;

  settings.classList.add('fading-out');
  setTimeout(() => {
    settings.classList.remove('visible', 'fading-out');

    const hostId = settingsHostId;
    settingsHostId = null;

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

// One row-renderer per tab. Phase 0 only Display has anything in it (the
// wiring-test toggle); the rest render their empty-state note. Later
// phases replace a tab's body here with its real rows — the surrounding
// panel/tabs/storage layer doesn't change.
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

function renderSettingsDisplayTab() {
  const wiringTestOn = !!getSetting('display', '_wiringTest');
  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-title">Wiring test toggle</div>
        <div class="settings-row-desc">Temporary; proves save/reload persistence works end-to-end. Removed once the first real Display setting lands.</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${wiringTestOn ? 'checked' : ''}
               onchange="setSetting('display', '_wiringTest', this.checked); renderSettingsDisplayTabInPlace();">
        <span class="settings-switch-track"></span>
      </label>
    </div>
  `;
}

// Re-renders just the Display tab's body after the wiring-test toggle
// fires, so the row's own onchange handler (which just ran) doesn't get
// torn out from under itself by a full renderSettingsBody() call.
function renderSettingsDisplayTabInPlace() {
  const body = document.getElementById('settingsBody');
  if (body && settingsActiveTab === 'display') body.innerHTML = renderSettingsDisplayTab();
}
