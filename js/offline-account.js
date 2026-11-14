// ─── Accounts made while the database is offline ─────────────────────────────
// With the database off (js/db-status.js), claim-nickname can't run, so a new
// device would have no way in. Instead it checks the nickname it wants
// against nickname-hashes.json, which minify.py builds from the database at
// every deploy (superbase/migrations/019_nickname_hashes.sql): 20-bit hashes
// only, so the file can't be read back into names. If the name reads as free,
// the account is made here and now, with a PIN made here too, and kept in this
// browser as a "pending" account until the database is back. Then it is
// claimed for real (claim-nickname's offline_created mode), and the attempts
// that waited on this device (synced:false, js/attempts-sync.js, which syncs
// by device) go up under it.
//
// Two ways it can go wrong, both caught when the database is back:
//   - the name was taken after the last build, or by another offline account
//     that synced first: the claim answers 'taken', and Quizzes and Solve
//     them all stay closed behind the rename window (openOfflineRenameModal)
//     until a free name is chosen. Nothing is lost meanwhile.
//   - the database stays off: a pending account works for a week from when
//     it was made (server time, from Netlify's Date header, not the device
//     clock), then the same two modes are closed behind a window asking the
//     person to message the admin (openOfflineExpiredModal).
//
// A pending account can't post in the forum or enter lockdown: both need a
// real account on the server. It lives only in this browser, so clearing site
// data before it syncs loses it (the PIN window says so).

const PENDING_ACCOUNT_KEY = STORAGE_PREFIX + '_pending_account';
const SERVER_TIME_KEY = STORAGE_PREFIX + '_server_time';
const NICKNAME_HASHES_URL = 'nickname-hashes.json';
const NICKNAME_HASH_BITS = 20;
const PENDING_ACCOUNT_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_SYNC_RETRY_MS = 5 * 60 * 1000;
const NICKNAME_HASHES_FRESH_MS = 10 * 60 * 1000;

// ── The pending account ─────────────────────────────────────────────────────
// { nickname, pin, createdAt (server ms), conflict? } where conflict is the
// claim-nickname error that stopped it syncing: 'taken', 'flagged_nickname',
// 'invalid_nickname' or 'device_linked'.
function getPendingAccount() {
  try {
    const a = JSON.parse(localStorage.getItem(PENDING_ACCOUNT_KEY) || 'null');
    if (a && typeof a.nickname === 'string' && /^\d{5}$/.test(a.pin) && typeof a.createdAt === 'number') return a;
  } catch (_) { /* unreadable: treated as none */ }
  return null;
}

function savePendingAccount(account) {
  try { localStorage.setItem(PENDING_ACCOUNT_KEY, JSON.stringify(account)); } catch (_) { /* private mode / quota */ }
  _pendingAccountChanged();
}

// Called by saveForumIdentity (js/forum.js): any real account on this device
// replaces the pending one, whose waiting attempts then sync to it.
function clearPendingAccount() {
  if (localStorage.getItem(PENDING_ACCOUNT_KEY) === null) return;
  try { localStorage.removeItem(PENDING_ACCOUNT_KEY); } catch (_) {}
  _pendingAccountChanged();
}

function pendingAccountName() {
  const a = getPendingAccount();
  return a ? a.nickname : '';
}

function _pendingAccountChanged() {
  if (typeof refreshForumIdentityUI === 'function') refreshForumIdentityUI();
  document.dispatchEvent(new Event('pending-account-changed'));
}

// ── Server time ────────────────────────────────────────────────────────────
// The week is counted on Netlify's clock: every same-origin response carries
// a Date header. The device clock only fills in between two such answers,
// and setting it back can't go below the last one seen.
function _noteServerTime(res) {
  const server = Date.parse(res && res.headers ? res.headers.get('Date') : '');
  if (!Number.isFinite(server)) return;
  try { localStorage.setItem(SERVER_TIME_KEY, JSON.stringify({ server, local: Date.now() })); } catch (_) {}
}

function serverNow() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SERVER_TIME_KEY) || 'null'); } catch (_) {}
  const now = Date.now();
  if (!s || !Number.isFinite(s.server) || !Number.isFinite(s.local)) return now;
  return Math.max(s.server + (now - s.local), s.server);
}

// ── nickname-hashes.json ────────────────────────────────────────────────────
// Trusted only if it was built for this course and this course's database:
// a file from another course (a build from the wrong folder, say) would say
// every name is free, so it is ignored instead.
let _nicknameHashes = null;     // { salt, set, at }

function _projectRef() {
  try { return new URL(SUPABASE_URL).hostname.split('.')[0]; } catch (_) { return ''; }
}

async function loadNicknameHashes({ fresh = false } = {}) {
  if (!fresh && _nicknameHashes && Date.now() - _nicknameHashes.at < NICKNAME_HASHES_FRESH_MS) return _nicknameHashes;
  try {
    const res = await fetch(NICKNAME_HASHES_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    _noteServerTime(res);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.course !== ACTIVE_COURSE || data.projectRef !== _projectRef()
        || data.bits !== NICKNAME_HASH_BITS || typeof data.salt !== 'string' || !data.salt
        || !Array.isArray(data.hashes)) {
      console.warn('nickname-hashes.json is not for this course or database: offline sign-up is off.');
      return null;
    }
    _nicknameHashes = { salt: data.salt, set: new Set(data.hashes), at: Date.now() };
    return _nicknameHashes;
  } catch (_) {
    return null;
  }
}

// The same 20 bits nickname_hashes() takes in SQL: byte 0, byte 1 and the
// high half of byte 2 of sha256("salt:nickname_lower").
async function nicknameHashBits(salt, key) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + key)));
  return (digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4);
}

async function nicknameLooksTaken(name, hashes) {
  return hashes.set.has(await nicknameHashBits(hashes.salt, nicknameKey(name)));
}

function _randomPin() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(10000 + (n[0] % 90000));
}

// The words for a name the rules or the list turned down, shared by the
// offline sign-up (js/forum.js) and the rename window below.
function nicknameProblemText(problem, name) {
  if (problem === 'invalid_nickname') return 'Names need 2 to 40 letters, numbers, or . _ - (no spaces).';
  if (problem === 'flagged_nickname') return "That name isn't allowed. Try something else.";
  if (problem === 'taken_offline') return `"${name}" is already taken. Pick another name, or if it's yours, wait until the database is back and log in.`;
  if (problem === 'taken') return `"${name}" is already taken. Pick another name.`;
  return '';
}

// Makes the pending account. Returns { ok: true, pin } or { ok: false, text }.
async function createPendingAccount(rawName) {
  const name = normalizeNickname(rawName);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, text: nicknameProblemText(problem, name) };
  const hashes = await loadNicknameHashes({ fresh: true });
  if (!hashes) return { ok: false, text: "Couldn't check the name right now. Try again in a bit." };
  if (await nicknameLooksTaken(name, hashes)) return { ok: false, text: nicknameProblemText('taken_offline', name) };
  const pin = _randomPin();
  savePendingAccount({ nickname: name, pin, createdAt: serverNow() });
  return { ok: true, pin };
}

// ── Sync ────────────────────────────────────────────────────────────────────
let _pendingSync = null;

// Resolves to 'synced', 'conflict', 'retry' or 'none'. Safe to call often:
// it does nothing while the database is offline or a call is under way.
function syncPendingAccount() {
  if (_pendingSync) return _pendingSync;
  const account = getPendingAccount();
  if (!account || account.conflict || getForumNickname()) return Promise.resolve('none');
  if (dbOffline() || navigator.onLine === false) return Promise.resolve('retry');
  _pendingSync = _claimPending(account, account.nickname)
    .finally(() => { _pendingSync = null; });
  return _pendingSync;
}

async function _claimPending(account, nickname) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-nickname`, {
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
        nickname,
        pin: account.pin,
        offline_created: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    applyDeviceToken(data);
    if (data && data.ok) {
      _finishPendingAccount(data.nickname, account.pin);
      return 'synced';
    }
    const error = data && data.error;
    if (['taken', 'flagged_nickname', 'invalid_nickname', 'device_linked'].includes(error)) {
      // Kept under the name it had: the rename window offers that name's
      // owner a log-in, and the person sees what was turned down.
      const now = getPendingAccount();
      if (now) savePendingAccount({ ...now, conflict: error });
      return 'conflict';
    }
    return 'retry';
  } catch (err) {
    console.error('Pending account sync error:', err);
    return 'retry';
  }
}

function _finishPendingAccount(nickname, pin) {
  saveForumIdentity(nickname, pin);     // clears the pending account too
  refreshForumIdentityUI();
  if (typeof syncAttempts === 'function') syncAttempts();
  if (typeof reconnectAllLiveSync === 'function') reconnectAllLiveSync();
}

// When the database comes back, on reconnecting, and every few minutes as a
// fallback: each is a no-op without a pending account.
document.addEventListener('db-status-changed', () => { if (!dbOffline()) syncPendingAccount(); });
window.addEventListener('online', () => syncPendingAccount());
setInterval(() => { if (!document.hidden && getPendingAccount()) syncPendingAccount(); }, PENDING_SYNC_RETRY_MS);
window.addEventListener('storage', (e) => { if (e.key === PENDING_ACCOUNT_KEY) _pendingAccountChanged(); });
if (getPendingAccount()) setTimeout(syncPendingAccount, 0);

// ── Is the database there, right now? ───────────────────────────────────────
// Signing up and logging in can't go by the saved /db-status answer (up to
// "poll.db_status" old) or wait the minute js/db-status.js takes to confirm
// "down": a new visitor during an outage would see "Couldn't reach the forum"
// until the next scheduled check. So these ask /db-status now, and treat
// "down" as unavailable at once: an account made offline just syncs later.
async function dbUnavailableNow() {
  await checkDbStatus({ force: true });
  return dbProblemText() !== null;
}

// ── The gate in front of Quizzes and Solve them all ─────────────────────────
// startSelected (js/quiz-engine.js) calls this when the device has no real
// account. `next` starts the quiz. Also used by the Stats entry points with
// { quiz: false }, where a pending account is simply let through.
async function offlineAccountGate(next, { quiz = true } = {}) {
  if (getPendingAccount()) {
    if (!quiz) return next();
    // A slow network mustn't hold the Start button: past 4 s the quiz goes
    // ahead and the sync finishes in the background.
    const result = await Promise.race([
      syncPendingAccount(),
      new Promise((resolve) => setTimeout(() => resolve('retry'), 4000)),
    ]);
    if (result === 'synced' || getForumNickname()) return next();
    const account = getPendingAccount();
    if (!account) return openGettingStartedModal(next);
    if (account.conflict) return openOfflineRenameModal({ onDone: next });
    await loadNicknameHashes({ fresh: true });          // a fresh Date header
    if (serverNow() - account.createdAt > PENDING_ACCOUNT_MAX_MS) return openOfflineExpiredModal();
    return next();
  }
  if (!(await dbUnavailableNow())) return openGettingStartedModal(next);
  // Offline with no usable list (an older build, or the file is for another
  // course): no name can be checked, so the gate stands aside as before and
  // attempts wait on the device until a name exists.
  if (!(await loadNicknameHashes())) return next();
  openGettingStartedModal(next, { offline: true });
}

// ── Rename window ───────────────────────────────────────────────────────────
// Two uses. After a failed sync (account.conflict set) it can't be skipped:
// Back closes it, but the quiz doesn't start. From Stats → Change nickname
// before the account has synced, it's an ordinary rename of the pending name.
let _offlineRenameOnDone = null;

// Text with the nickname set apart in bold: parts are strings, or { name }.
function _setAcctText(el, parts) {
  el.replaceChildren(...parts.map((p) => (typeof p === 'string' ? p
    : Object.assign(document.createElement('span'), { className: 'acct-name', textContent: p.name }))));
}

function openOfflineRenameModal({ onDone = null } = {}) {
  const account = getPendingAccount();
  const backdrop = document.getElementById('offlineRenameModalBackdrop');
  if (!account || !backdrop) return;
  _offlineRenameOnDone = onDone;
  const title = document.getElementById('offlineRenameTitle');
  const desc = document.getElementById('offlineRenameDesc');
  const field = document.getElementById('offlineRenameField');
  const input = document.getElementById('offlineRenameInput');
  const mine = document.getElementById('offlineRenameMineBtn');
  const status = document.getElementById('offlineRenameStatus');
  const save = document.getElementById('offlineRenameSave');
  const name = { name: account.nickname };
  const linked = account.conflict === 'device_linked';

  status.textContent = '';
  status.classList.remove('forum-composer-status-error');
  input.value = '';
  field.style.display = linked ? 'none' : '';
  mine.style.display = account.conflict === 'taken' ? '' : 'none';
  save.textContent = linked ? 'Log in' : 'Save';

  if (account.conflict === 'taken') {
    title.textContent = 'Choose a new nickname';
    _setAcctText(desc, [name, ' was registered by someone else while the database was offline. Pick a new name to keep using quizzes. Your attempts and PIN stay the same.']);
  } else if (account.conflict === 'flagged_nickname' || account.conflict === 'invalid_nickname') {
    title.textContent = 'Choose a new nickname';
    _setAcctText(desc, [name, " isn't allowed. Pick a new name to keep using quizzes. Your attempts and PIN stay the same."]);
  } else if (linked) {
    title.textContent = 'Log in to continue';
    _setAcctText(desc, ['This browser is still linked to an account made earlier. Log in to it, and the attempts made offline will go there.']);
  } else {
    title.textContent = 'Change nickname';
    _setAcctText(desc, ['Your account ', name, " isn't registered yet. The new name is checked the same way and registers once the database is back."]);
  }
  backdrop.classList.add('visible');
  if (!linked) setTimeout(() => input.focus(), 50);
}

function closeOfflineRenameModal() {
  document.getElementById('offlineRenameModalBackdrop')?.classList.remove('visible');
  _offlineRenameOnDone = null;
}

async function submitOfflineRename() {
  const account = getPendingAccount();
  const input = document.getElementById('offlineRenameInput');
  const status = document.getElementById('offlineRenameStatus');
  if (!account || !input || !status) return;
  if (account.conflict === 'device_linked') return offlineRenameLogIn();
  const name = normalizeNickname(input.value);
  const fail = (text) => { status.textContent = text; status.classList.add('forum-composer-status-error'); };
  status.classList.remove('forum-composer-status-error');
  if (!name) return fail('Enter a name.');
  const problem = nicknameProblem(name);
  if (problem) return fail(nicknameProblemText(problem, name));
  status.textContent = 'Checking…';

  let done = false;
  if (dbOffline()) {
    // Still offline: the same check as signing up, and it syncs later.
    const hashes = await loadNicknameHashes({ fresh: true });
    if (!hashes) return fail("Couldn't check the name right now. Try again in a bit.");
    if (await nicknameLooksTaken(name, hashes)) return fail(nicknameProblemText('taken_offline', name));
    savePendingAccount({ nickname: name, pin: account.pin, createdAt: account.createdAt });
    done = true;
  } else {
    // The database is on: claim it straight away.
    const result = await _claimPending(account, name);
    if (result === 'synced') done = true;
    else if (result === 'conflict') {
      const error = (getPendingAccount() || {}).conflict;
      // Back to the name it had: the turned-down one was only a try here.
      const now = getPendingAccount();
      if (now) savePendingAccount({ ...now, nickname: account.nickname, conflict: account.conflict });
      return fail(error === 'taken' ? nicknameProblemText('taken', name) : nicknameProblemText(error, name) || "Couldn't save. Try again.");
    } else return fail(await dbFailureText("Couldn't save. Check your connection and try again."));
  }
  if (!done) return;
  const onDone = _offlineRenameOnDone;
  closeOfflineRenameModal();
  if (onDone) onDone();
}

// "It's mine": the name belongs to an account this person already has. A
// log-in there replaces the pending account (saveForumIdentity), and the
// attempts made offline sync to that account.
function offlineRenameLogIn() {
  const account = getPendingAccount();
  if (!account) return;
  const onDone = _offlineRenameOnDone;
  closeOfflineRenameModal();
  const back = () => openOfflineRenameModal({ onDone });
  if (account.conflict === 'device_linked') openForumClaimModal('restore', '', onDone, back);
  else openForumClaimModal('verify', account.nickname, onDone, back);
}

// ── A week without the database ────────────────────────────────────────────
function offlineAdminMessage(account) {
  const code = typeof COURSE_CODE_DISPLAY === 'string' ? COURSE_CODE_DISPLAY : 'course';
  return `Hi! The ${code} practice app database seems to have been down for over a week. `
    + `My account "${account.nickname}" was made while it was offline and can't sync. `
    + 'Could you start the database, please?';
}

function openOfflineExpiredModal() {
  const account = getPendingAccount();
  const backdrop = document.getElementById('offlineExpiredModalBackdrop');
  if (!account || !backdrop) return;
  const made = new Date(account.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  _setAcctText(document.getElementById('offlineExpiredDesc'),
    ['Your account ', { name: account.nickname }, ` was made on ${made} while the database was offline, and it has been off for more than a week since.`]);
  document.getElementById('offlineExpiredMessage').textContent = offlineAdminMessage(account);
  document.getElementById('offlineExpiredStatus').textContent = '';
  const tg = document.getElementById('offlineExpiredTelegram');
  if (tg) tg.href = DB_ADMIN_LINK;
  backdrop.classList.add('visible');
}

function closeOfflineExpiredModal() {
  document.getElementById('offlineExpiredModalBackdrop')?.classList.remove('visible');
}

async function copyOfflineAdminMessage() {
  const account = getPendingAccount();
  const status = document.getElementById('offlineExpiredStatus');
  if (!account || !status) return;
  try {
    await navigator.clipboard.writeText(offlineAdminMessage(account));
    status.textContent = 'Copied. Paste it into the chat with the admin.';
  } catch (_) {
    // No clipboard (plain http, or refused): select the text instead.
    const box = document.getElementById('offlineExpiredMessage');
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    status.textContent = 'Selected. Copy it and paste it into the chat with the admin.';
  }
}
