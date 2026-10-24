// ─── Settings sync ───────────────────────────────────────────────────────────
// Cross-device sync for Settings (js/settings.js) and the color theme
// (js/themes.js), through the sync-settings Edge Function and the
// settings_sync table (superbase/migrations/011_settings_sync.sql). Same
// device_id -> identity resolution as js/attempts-sync.js, so it only runs
// once a nickname is claimed, and only while Settings > Sync & Storage >
// "Sync settings on this device" is on.
//
// How it merges: every synced setting keeps, next to its value, WHEN it was
// last changed and by WHICH device. Merging is per setting — the newer
// change wins, a tie goes to the higher device id (so every device picks
// the same winner). The server does the merge (merge_settings_sync), so two
// devices pushing at once can't overwrite each other.
//
// Change detection is a diff, not a hook per writer: SETTINGS_SYNC_CODES
// below lists how to read each synced value, the last value seen is kept in
// the meta record, and settingsSyncNoteLocalChanges() stamps whatever
// differs. setSetting(), applyColorTheme(…, true) and toggleTheme() call it;
// so does page load, which also catches a change made where nothing calls it
// (offline.html's day/night switch, a Reset all). Values written by a merge
// update the meta record first, so they never read as local changes.
//
// Settings that were never stamped (everything, on the first load after
// this shipped): a default value counts as time 0, any other value as time
// 1. So the first sync keeps a device's non-default choice over another
// device's untouched default, while any real change made since beats both.
//
// Keeping requests down — these are the only times a request is made:
//   - a burst of changes: one push, SETTINGS_SYNC_DEBOUNCE_MS after the
//     last change (sent straight away if the tab is hidden first);
//   - page load: one cheap check (known_rev — the reply is { unchanged }
//     when nothing changed), skipped if another tab of this browser
//     checked within SETTINGS_SYNC_FRESH_MS;
//   - another device changed something: its Realtime ping carries the new
//     rev, so a tab that's already caught up (another tab of this browser
//     fetched it — the meta record is shared through localStorage) asks
//     nothing, a hidden tab waits until it is shown, and visible tabs
//     claim the fetch through SETTINGS_SYNC_BUSY_MS so only one asks;
//   - the fallback check, "poll.settings" in site-version.json (15 min),
//     shared by all tabs of the browser, and only while one is visible.
// A push that changes nothing on the server doesn't bump rev, so it pings
// nobody. No nickname, sync off, "sync_paused" or offline mode: nothing.
//
// Two tabs of the same browser share localStorage: a merge or a change in
// one tab reaches the others through the 'storage' event on the meta
// record, with no request at all.

const SETTINGS_SYNC_META_KEY = STORAGE_PREFIX + '-settings-sync';
const SETTINGS_SYNC_DEBOUNCE_MS = 3000;
const SETTINGS_SYNC_FRESH_MS = 30 * 1000;
const SETTINGS_SYNC_BUSY_MS = 10 * 1000;

// Stay on each device: they describe the device (screen size, battery,
// system theme), or a moment on it (Go silent), not a preference. The
// whole offline tab (offline.until, syncSettings itself) stays too.
const SETTINGS_SYNC_LOCAL_ONLY = [
  'display.followDeviceTheme',
  'display.figureScale',
  'display.reduceMotionBatteryOn',
  'display.reduceMotionBatteryPct',
  'notifications.goSilent',
  'notifications.goSilentAutoOff24h',
  'notifications.goSilentEnabledAt',
  'study.showSolveAllNavRail',
];

const _SS_HEX = /^#[0-9a-f]{6}$/i;
function _ssValidPalette(v) {
  return !!v && typeof v === 'object' && ['bg', 'text', 'accent', 'accent2'].every(k => _SS_HEX.test(v[k]));
}
function _ssSetCustom(part, v) {
  const draft = getCustomDraft();
  draft[part] = v;
  saveCustomDraft(draft);
}
function _ssApplyCustom() {
  if (getColorTheme() === 'custom') applyCustomForCurrentMode();
}
function _ssFollowsDevice() {
  return typeof getSetting === 'function' && getSetting('display', 'followDeviceTheme') === true;
}
function _ssMode() {
  return localStorage.getItem(STORAGE_PREFIX + '-theme') === 'light' ? 'light' : 'dark';
}
// Same steps as toggleTheme() (js/quiz-engine.js), towards a given mode.
function _ssApplyMode() {
  const isLight = _ssMode() === 'light';
  if (document.body.classList.contains('light') === isLight) return;
  if (window.themeFadeTick) themeFadeTick();
  document.body.classList.toggle('light', isLight);
  const track = document.getElementById('themeTrack');
  if (track) track.classList.toggle('on', isLight);
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  if (window.__updateOnColorVars) window.__updateOnColorVars();
  if (window.__onModeChanged) window.__onModeChanged();
}

// code -> { get(), def, valid(v), write(v), apply() }. write() only stores;
// apply() makes the page show what's stored (also run for other tabs'
// changes). Settings codes apply together (_ssApplySettings).
// `ignored` (theme.mode while following the device theme): neither sent nor
// taken — the device decides that one itself.
const SETTINGS_SYNC_CODES = (() => {
  const codes = {};
  for (const tab of Object.keys(SETTINGS_DEFAULTS)) {
    if (tab === 'offline') continue;
    for (const key of Object.keys(SETTINGS_DEFAULTS[tab])) {
      const code = tab + '.' + key;
      if (SETTINGS_SYNC_LOCAL_ONLY.includes(code)) continue;
      const def = SETTINGS_DEFAULTS[tab][key];
      codes[code] = {
        get: () => getSetting(tab, key),
        def,
        valid: v => (def === null ? (v === null || typeof v === 'number') : typeof v === typeof def),
        write: v => { settingsCache = null; const s = loadSettings(); s[tab][key] = v; saveSettings(); },
        settings: true,
      };
    }
  }
  codes['theme.color'] = {
    get: () => getColorTheme(),
    def: 'default',
    valid: v => v === 'custom' || THEMES.some(t => t.id === v),
    write: v => localStorage.setItem(THEME_KEY, v),
    apply: () => applyColorTheme(getColorTheme(), false),
  };
  codes['theme.mode'] = {
    get: _ssMode,
    def: 'dark',
    valid: v => v === 'light' || v === 'dark',
    write: v => localStorage.setItem(STORAGE_PREFIX + '-theme', v),
    apply: _ssApplyMode,
    ignored: _ssFollowsDevice,
  };
  // The saved custom theme in four parts: each mode's four colors travel
  // together (mixing one device's background with another's text could be
  // unreadable), roundness and font on their own. Only "Save & apply" in the
  // builder changes these; an edit open in the builder isn't touched.
  const customDef = defaultCustomDraft();
  ['night', 'day'].forEach(part => {
    codes['customTheme.' + part] = {
      get: () => getCustomDraft()[part],
      def: customDef[part],
      valid: _ssValidPalette,
      write: v => _ssSetCustom(part, { bg: v.bg, text: v.text, accent: v.accent, accent2: v.accent2 }),
      apply: _ssApplyCustom,
    };
  });
  codes['customTheme.radius'] = {
    get: () => getCustomDraft().radius,
    def: customDef.radius,
    valid: v => typeof v === 'number' && v > 0 && v <= 3, // the builder's slider: 0.15-1.8
    write: v => _ssSetCustom('radius', v),
    apply: _ssApplyCustom,
  };
  codes['customTheme.font'] = {
    get: () => getCustomDraft().font,
    def: customDef.font,
    valid: v => FONT_OPTIONS.some(f => f.id === v),
    write: v => _ssSetCustom('font', v),
    apply: _ssApplyCustom,
  };
  return codes;
})();

// ── Meta record (shared by every tab of this browser) ────────────────────
//   v      code -> JSON of the value last seen
//   t      code -> [time, device id] of the change that value came from
//   dirty  code -> 1 for changes not yet confirmed by the server
//   rev    server revision last merged here
//   offset server clock minus this device's clock, ms
//   at     when any tab last heard back from the server
//   busy   until when a tab is fetching (see SETTINGS_SYNC_BUSY_MS)
//   idn    { id, nick } — identity_id the server last named, for Realtime
// Always read fresh: another tab may have written it since.
function _ssReadMeta() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(SETTINGS_SYNC_META_KEY) || 'null'); } catch (e) { m = null; }
  if (!m || typeof m !== 'object') m = {};
  m.v = m.v || {}; m.t = m.t || {}; m.dirty = m.dirty || {};
  m.rev = Number(m.rev) || 0; m.offset = Number(m.offset) || 0; m.at = Number(m.at) || 0;
  return m;
}
function _ssWriteMeta(m) {
  try { localStorage.setItem(SETTINGS_SYNC_META_KEY, JSON.stringify(m)); } catch (e) { /* private mode: this page only */ }
}
function _ssOwnDeviceId() {
  return (typeof getForumDeviceId === 'function') ? getForumDeviceId() : '';
}

let _ssApplyingRemote = false;

// Stamps every synced value that differs from the one last seen. A code
// seen for the first time (first load after this shipped, or a setting
// added later) isn't a change: it gets time 0 at its default, 1 otherwise
// — see the header.
function settingsSyncNoteLocalChanges() {
  if (_ssApplyingRemote) return;
  // Re-read settings from localStorage: this tab's cache can predate
  // another tab's change, and comparing that against the shared record
  // would stamp the old value as a fresh change.
  settingsCache = null;
  const m = _ssReadMeta();
  const now = Date.now() + m.offset;
  const own = _ssOwnDeviceId();
  let wrote = false, changed = false;
  for (const code of Object.keys(SETTINGS_SYNC_CODES)) {
    const c = SETTINGS_SYNC_CODES[code];
    const cur = JSON.stringify(c.get());
    if (cur === undefined || cur === m.v[code]) continue;
    const first = !(code in m.v);
    m.v[code] = cur;
    wrote = true;
    if (c.ignored && c.ignored()) continue;
    if (first) {
      if (cur === JSON.stringify(c.def)) { m.t[code] = [0, '']; continue; }
      m.t[code] = [1, own];
    } else {
      m.t[code] = [now, own];
    }
    m.dirty[code] = 1;
    changed = true;
  }
  if (!wrote) return;
  _ssWriteMeta(m);
  if (changed) _ssSchedulePush();
}

// ── Applying the server's copy ────────────────────────────────────────────
function _ssApplySettings() {
  settingsCache = null; // re-read from localStorage: another tab may have written it
  if (typeof applyDisplaySettings === 'function') applyDisplaySettings();
  if (typeof applyNotificationSettings === 'function') applyNotificationSettings();
  if (typeof applyStudySettings === 'function') applyStudySettings();
}

// Makes the page show the stored values of `codes` — after a merge here,
// or another tab's change.
function _ssApplyToPage(codes) {
  if (!codes.length) return;
  if (codes.some(code => SETTINGS_SYNC_CODES[code].settings)) _ssApplySettings();
  const done = new Set();
  codes.forEach(code => {
    const apply = SETTINGS_SYNC_CODES[code].apply;
    if (apply && !done.has(apply)) { done.add(apply); apply(); }
  });
  if (typeof renderThemeGrid === 'function') renderThemeGrid();
  if (typeof isSettingsScreenOpen === 'function' && isSettingsScreenOpen()) renderSettingsBody();
}

// Takes each server entry that beats the local one. An entry this device
// wrote itself is always taken as stored (the server may have clamped its
// time), unless it has changed again here since.
function _ssMergeServer(m, data) {
  const own = _ssOwnDeviceId();
  const changed = [];
  _ssApplyingRemote = true;
  try {
    for (const code of Object.keys(data || {})) {
      const c = SETTINGS_SYNC_CODES[code];
      const e = data[code];
      if (!c || !e || typeof e.t !== 'number' || (c.ignored && c.ignored())) continue;
      const local = m.t[code] || [0, ''];
      const d = String(e.d || '');
      const newer = e.t > local[0] || (e.t === local[0] && d > String(local[1] || ''));
      const ownEcho = own && d === own && !m.dirty[code];
      if (!newer && !ownEcho) continue;
      m.t[code] = [e.t, d];
      delete m.dirty[code];
      if (!c.valid(e.v)) continue; // from a newer build, say: keep ours
      const json = JSON.stringify(e.v);
      if (json === JSON.stringify(c.get())) { m.v[code] = json; continue; }
      c.write(e.v);
      m.v[code] = JSON.stringify(c.get());
      changed.push(code);
    }
  } finally {
    _ssApplyingRemote = false;
  }
  return changed;
}

// ── Requests ──────────────────────────────────────────────────────────────
let _ssPushTimer = null;
let _ssInFlight = false;
let _ssAgain = false;
let _ssLastFailed = false;
let _ssPingRev = 0; // newest rev a ping announced while this tab was hidden

function settingsSyncEnabled() {
  return typeof getSetting === 'function' && getSetting('offline', 'syncSettings') !== false;
}
function _ssCanSync() {
  if (!settingsSyncEnabled()) return false;
  if (typeof getForumNickname !== 'function' || !getForumNickname()) return false;
  if (typeof getForumDeviceId !== 'function') return false; // forum.js not loaded (offline page)
  if (siteSyncPaused()) return false;
  if (typeof isOfflineModeActive === 'function' && isOfflineModeActive()) return false;
  return true;
}

function _ssSchedulePush() {
  clearTimeout(_ssPushTimer);
  _ssPushTimer = setTimeout(() => { _ssPushTimer = null; syncSettingsNow(); }, SETTINGS_SYNC_DEBOUNCE_MS);
}

// One round trip: sends what's dirty (if anything) and gets back what other
// devices changed. `opts.keepalive` for the send on hide; `opts.claim` for
// fetches several tabs might want at once (pings): skipped while another
// tab holds the claim.
async function syncSettingsNow(opts) {
  opts = opts || {};
  if (!_ssCanSync()) { _ssRenderStatus(); return; }
  if (_ssInFlight) { _ssAgain = true; return; }

  let m = _ssReadMeta();
  const dirtyCodes = Object.keys(m.dirty).filter(code => SETTINGS_SYNC_CODES[code] && m.v[code] !== undefined);
  if (opts.claim && !dirtyCodes.length) {
    if (m.busy && m.busy > Date.now()) return;
    m.busy = Date.now() + SETTINGS_SYNC_BUSY_MS;
    _ssWriteMeta(m);
  }
  const changes = {};
  const sent = {};
  dirtyCodes.forEach(code => {
    changes[code] = { v: JSON.parse(m.v[code]), t: m.t[code][0] };
    sent[code] = m.t[code][0];
  });

  _ssInFlight = true;
  clearTimeout(_ssPushTimer);
  _ssPushTimer = null;
  const sentAt = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        device_id: getForumDeviceId(),
        device_secret: getForumDeviceSecret(),
        device_token: getDeviceToken() || undefined,
        identity_token: getIdentityToken() || undefined,
        changes: dirtyCodes.length ? changes : undefined,
        // Only for the nickname that rev came from: another identity's row
        // can sit at the same number, and would then read as "unchanged".
        known_rev: (m.idn && m.idn.nick === getForumNickname()) ? m.rev : undefined,
      }),
      keepalive: !!opts.keepalive,
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => null);
    applyDeviceToken(json);
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || ('HTTP ' + res.status));

    m = _ssReadMeta(); // another tab may have written it meanwhile
    if (typeof json.server_now === 'number') m.offset = Math.round(json.server_now - (sentAt + Date.now()) / 2);
    m.at = Date.now();
    m.busy = 0;
    const own = _ssOwnDeviceId();
    Object.keys(sent).forEach(code => {
      if (m.t[code] && m.t[code][0] === sent[code]) { delete m.dirty[code]; m.t[code][1] = own; }
    });
    let changed = [];
    if (!json.unchanged) changed = _ssMergeServer(m, json.data);
    m.rev = Number(json.rev) || 0;
    if (json.identity_id) m.idn = { id: json.identity_id, nick: getForumNickname() };
    _ssWriteMeta(m);
    _ssLastFailed = false;
    _ssApplyToPage(changed);
    if (json.identity_id) _ensureSettingsRealtime(json.identity_id);
  } catch (e) {
    console.error('Settings sync error:', e);
    _ssLastFailed = true;
    const mm = _ssReadMeta();
    if (mm.busy) { mm.busy = 0; _ssWriteMeta(mm); }
  } finally {
    _ssInFlight = false;
    _ssRenderStatus();
  }
  if (_ssAgain) { _ssAgain = false; syncSettingsNow(); }
}

// ── Realtime wake-up ──────────────────────────────────────────────────────
// Same pattern as js/attempts-sync.js: migration 011's trigger pings
// 'settings:<identity_id>' with { rev, device_id } whenever the row really
// changed. Own echoes and revs already merged here (by any tab) cost nothing.
let _ssRealtimeChannel = null;
let _ssRealtimeIdentity = null;
let _ssRealtimeEverConnected = false;
let _ssPingTimer = null;

function _onSettingsBroadcast(msg) {
  const p = (msg && msg.payload) || {};
  const own = _ssOwnDeviceId();
  if (p.device_id && own && p.device_id === own) return;
  const rev = Number(p.rev) || 0;
  if (rev && rev <= _ssReadMeta().rev) return;
  if (document.hidden) { _ssPingRev = Math.max(_ssPingRev, rev || Infinity); return; }
  // Spread out visible tabs a little, so the first one's claim is seen by the rest.
  clearTimeout(_ssPingTimer);
  _ssPingTimer = setTimeout(() => {
    if (rev && rev <= _ssReadMeta().rev) return;
    syncSettingsNow({ claim: true });
  }, 300 + Math.random() * 1200);
}

function _ensureSettingsRealtime(identityId) {
  if (siteOff('realtime') || !settingsSyncEnabled()) return;
  if (!identityId || identityId === _ssRealtimeIdentity) return;
  _teardownSettingsRealtime();
  const client = (typeof getForumClient === 'function') ? getForumClient() : null;
  if (!client) return;
  _ssRealtimeIdentity = identityId;
  const channel = client
    .channel('settings:' + identityId)
    .on('broadcast', { event: 'changed' }, _onSettingsBroadcast);
  _ssRealtimeChannel = channel;
  channel.subscribe((status) => {
    if (channel !== _ssRealtimeChannel) return;
    if (status === 'SUBSCRIBED') {
      // Back after a drop: something may have changed meanwhile.
      if (_ssRealtimeEverConnected && !document.hidden) syncSettingsNow({ claim: true });
      _ssRealtimeEverConnected = true;
    }
  });
}

function _teardownSettingsRealtime() {
  if (_ssRealtimeChannel) {
    const client = (typeof getForumClient === 'function') ? getForumClient() : null;
    if (client) client.removeChannel(_ssRealtimeChannel);
  }
  _ssRealtimeChannel = null;
  _ssRealtimeIdentity = null;
  _ssRealtimeEverConnected = false;
}

// ── Settings > Sync & Storage: the switch ─────────────────────────────────
function setSettingsSyncEnabled(on) {
  setSetting('offline', 'syncSettings', on);
  if (on) {
    syncSettingsNow();
  } else {
    clearTimeout(_ssPushTimer);
    _ssPushTimer = null;
    _teardownSettingsRealtime();
  }
  _ssRenderStatus();
}

function _ssStatusText() {
  if (!settingsSyncEnabled()) return 'Off. Changes made here are kept and sent once it is turned back on.';
  if (typeof getForumNickname !== 'function' || !getForumNickname()) return 'Claim a nickname in the forum to sync.';
  if (siteSyncPaused()) return 'Sync is paused for now. Your settings are saved on this device.';
  if (typeof isOfflineModeActive === 'function' && isOfflineModeActive()) return 'Offline mode is on. Settings sync once it ends.';
  if (_ssLastFailed) return 'Couldn’t sync — will retry automatically.';
  const m = _ssReadMeta();
  if (Object.keys(m.dirty).length) return 'Waiting to sync…';
  return m.at ? 'Synced.' : 'Not synced yet.';
}

function _ssRenderStatus() {
  const el = document.getElementById('settingsSyncStatus');
  if (el) el.textContent = _ssStatusText();
}

// Called from renderSettingsOfflineTab() (js/offline-mode.js), first on the tab.
function renderSettingsSyncSection() {
  const on = settingsSyncEnabled();
  return `
    <div class="settings-section-header">Settings sync</div>
    <div class="settings-row" data-row-key="syncSettings">
      <div class="settings-row-label">
        <div class="settings-row-title">Sync settings on this device</div>
        <div class="settings-row-desc">Keeps settings and your color theme the same on every device signed in with your nickname. The newest change wins. Figure size, battery saving, Go silent, the Entire Set progress rail and Follow device theme stay per device.</div>
        <div class="settings-row-desc settings-sync-status" id="settingsSyncStatus">${_ssStatusText()}</div>
      </div>
      <label class="settings-switch">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="setSettingsSyncEnabled(this.checked)">
        <span class="settings-switch-track"></span>
      </label>
    </div>
  `;
}

// ── Triggers ──────────────────────────────────────────────────────────────
// Hidden with changes still waiting: send them now, the tab may never come back.
function _ssFlushOnHide() {
  if (!_ssPushTimer) return;
  syncSettingsNow({ keepalive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { _ssFlushOnHide(); return; }
  const m = _ssReadMeta();
  if (_ssPingRev && _ssPingRev > m.rev) { _ssPingRev = 0; syncSettingsNow({ claim: true }); return; }
  _ssPingRev = 0;
  if (Date.now() - m.at >= sitePollMs('settings')) syncSettingsNow({ claim: true });
});
window.addEventListener('pagehide', _ssFlushOnHide);

// Another tab changed or merged something: show it here too.
window.addEventListener('storage', (e) => {
  if (e.key !== SETTINGS_SYNC_META_KEY || !e.newValue) return;
  let before = {}, after = {};
  try { before = (JSON.parse(e.oldValue || 'null') || {}).v || {}; after = (JSON.parse(e.newValue) || {}).v || {}; } catch (err) { return; }
  // A code missing from `before` was only just recorded (first load), not changed.
  _ssApplyToPage(Object.keys(after).filter(code => SETTINGS_SYNC_CODES[code] && code in before && after[code] !== before[code]));
  _ssRenderStatus();
});

document.addEventListener('site-config-changed', (e) => {
  const { before, after } = e.detail;
  if (after.off.includes('realtime')) _teardownSettingsRealtime();
  if (before.sync_paused && !after.sync_paused && !document.hidden) syncSettingsNow();
  _ssRenderStatus();
});

// Fallback check, shared by every tab of this browser through meta.at.
startSitePoll('settings', () => {
  if (document.hidden) return;
  if (!sitePollDue('settings', _ssReadMeta().at)) return;
  syncSettingsNow({ claim: true });
});

// ── Start ─────────────────────────────────────────────────────────────────
// Stamps anything that changed since the last page (or seeds the record on
// the first load; a change found here schedules its own push), then checks
// in — unless another tab just did, in which case only the Realtime channel
// is opened, from the identity it saw. Changes another tab is still waiting
// to push are left to that tab; only if they're still unsent a little later
// (that tab closed before its send got out) does this one send them.
(function startSettingsSync() {
  settingsSyncNoteLocalChanges();
  const m = _ssReadMeta();
  const nick = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  const fresh = Date.now() - m.at < SETTINGS_SYNC_FRESH_MS && m.idn && m.idn.nick === nick;
  if (!fresh || !_ssCanSync()) { syncSettingsNow(); return; }
  _ensureSettingsRealtime(m.idn.id);
  // Only the changes pending right now: ones made later belong to the tab
  // that made them, which is already waiting to push them.
  const pending = Object.keys(m.dirty).map(code => code + '@' + (m.t[code] || [0])[0]);
  if (pending.length && !_ssPushTimer) {
    setTimeout(() => {
      const later = _ssReadMeta();
      if (!_ssPushTimer && pending.some(p => { const code = p.slice(0, p.lastIndexOf('@')); return later.dirty[code] && p === code + '@' + (later.t[code] || [0])[0]; })) syncSettingsNow();
    }, SETTINGS_SYNC_BUSY_MS);
  }
})();
