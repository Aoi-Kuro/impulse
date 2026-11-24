// ─── Deleting an account ────────────────────────────────────────────────────
// Stats → ⚙︎ → Delete account. Talks to the account-delete Edge Function
// (superbase/edge-functions/account-delete.ts); what the database keeps and
// removes is described at the top of superbase/migrations/020_account_deletion.sql.
//
// Three windows, all in index.html:
//   #accountDeleteModalBackdrop   asking for deletion: what happens, a copy
//                                 of the data to download, then nickname +
//                                 PIN to confirm, then the date it happens.
//   #accountPendingModalBackdrop  an account waiting to be deleted: shown on
//                                 the account's other devices (asked by the
//                                 server, see accountDeletionCheck) and when
//                                 someone logs in to it (claim-nickname's
//                                 'pending_deletion'). Cancel with the PIN,
//                                 or sign out.
//   #accountDeletedModalBackdrop  the account was deleted while this device
//                                 was away; its copy here has been removed.
//
// The device that asks wipes its own copy at once. Other devices learn
// about it when their attempt sync gets "no_identity" back
// (js/attempts-sync.js calls accountDeletionCheck), which a realtime ping
// from the database triggers straight away on devices that are open.

const ACCOUNT_DELETE_DAYS = 30;

async function callAccountDelete(action, extra) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/account-delete`, {
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
      action,
      ...(extra || {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => null);
  if (typeof applyDeviceToken === 'function') applyDeviceToken(data);
  return { ok: res.ok, status: res.status, data };
}

function accountDateText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// "Windows | Edge", shown to the account's other devices so the owner can
// tell whether it was them.
function accountDeviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' | ') || 'another device';
}

function accountPinErrorText(data) {
  if (!data) return "Couldn't reach the server. Check your connection and try again.";
  switch (data.error) {
    case 'wrong_pin': return 'Incorrect PIN.';
    case 'invalid_pin_format': return 'The PIN is 5 digits.';
    case 'locked': return 'Too many wrong PINs. Try again in 15 minutes.';
    case 'nickname_mismatch': return "That isn't your nickname. Type it exactly as it's shown.";
    case 'no_identity': return 'This device is no longer signed in to the account.';
    case 'not_found': return 'No account with that name.';
    case 'not_pending': return 'This account is no longer waiting to be deleted.';
    default: return "Something went wrong. Try again.";
  }
}

function accountSetStatus(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('forum-composer-status-error', !!isError);
}

// Everything the account left on this device: who it is, its attempts,
// Entire Set progress and settings. The device itself (its id and secret)
// stays, so it keeps working without an account. Ends with a reload, the
// same way resetting all settings does (js/settings.js).
function accountWipeLocal() {
  if (typeof clearForumIdentity === 'function') clearForumIdentity();
  if (typeof clearIdentityToken === 'function') clearIdentityToken();
  if (typeof clearLocalAttemptsCache === 'function') clearLocalAttemptsCache();
  if (typeof clearLocalSolveAllProgress === 'function') clearLocalSolveAllProgress();
  ['_forum_display_name', '_forum_avatar_cache', '_forum_pin_dismissed', '_forum_pin_first_seen']
    .forEach(k => { try { localStorage.removeItem(STORAGE_PREFIX + k); } catch (e) {} });
  try {
    const keep = typeof loadSettings === 'function' ? loadSettings().offline : null;
    if (typeof settingsCache !== 'undefined') settingsCache = null;
    if (keep) localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, offline: keep }));
    else localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(STORAGE_PREFIX + '-theme');
  } catch (e) {}
}

// ── Download a copy ─────────────────────────────────────────────────────────
function accountSaveJson(obj, nickname) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${(typeof BRAND_NAME === 'string' && BRAND_NAME) || 'account'}-${nickname || 'data'}-${day}.json`.replace(/[^\w.-]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function accountDownloadData() {
  const pinInput = document.getElementById('accountExportPinInput');
  const pinRow = document.getElementById('accountExportPinRow');
  const typed = pinInput && pinRow && pinRow.style.display !== 'none' ? pinInput.value.trim() : '';
  const pin = typed || getForumPin();
  if (!pin) {
    if (pinRow) pinRow.style.display = '';
    accountSetStatus('accountExportStatus', 'Type your PIN to download your data.', true);
    pinInput?.focus();
    return;
  }
  accountSetStatus('accountExportStatus', 'Preparing your data…');
  try {
    const { data } = await callAccountDelete('export', { pin });
    if (data && data.ok && data.data) {
      accountSaveJson(data.data, getForumNickname());
      accountSetStatus('accountExportStatus', 'Downloaded.');
      return;
    }
    if (data && (data.error === 'wrong_pin' || data.error === 'invalid_pin_format') && pinRow) {
      pinRow.style.display = '';
    }
    accountSetStatus('accountExportStatus', accountPinErrorText(data), true);
  } catch (err) {
    console.error('Account export error:', err);
    accountSetStatus('accountExportStatus', typeof dbFailureText === 'function'
      ? await dbFailureText("Couldn't reach the server. Check your connection.")
      : "Couldn't reach the server. Check your connection.", true);
  }
}

// ── Asking for deletion ─────────────────────────────────────────────────────
function accountDeleteShowStep(step) {
  ['intro', 'confirm', 'done'].forEach(s => {
    const el = document.getElementById('accountDeleteStep-' + s);
    if (el) el.style.display = s === step ? '' : 'none';
  });
}

function openAccountDeleteModal() {
  const nickname = getForumNickname();
  if (!nickname) return;
  const backdrop = document.getElementById('accountDeleteModalBackdrop');
  if (!backdrop) return;
  document.querySelectorAll('.account-delete-name').forEach(el => { el.textContent = nickname; });
  const days = document.getElementById('accountDeleteDays');
  if (days) days.textContent = String(ACCOUNT_DELETE_DAYS);
  ['accountExportPinInput', 'accountDeleteNicknameInput', 'accountDeletePinInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pinRow = document.getElementById('accountExportPinRow');
  if (pinRow) pinRow.style.display = 'none';
  accountSetStatus('accountExportStatus', '');
  accountSetStatus('accountDeleteStatus', '');
  accountDeleteShowStep('intro');
  backdrop.classList.add('visible');
}

function closeAccountDeleteModal() {
  const backdrop = document.getElementById('accountDeleteModalBackdrop');
  if (!backdrop) return;
  const done = document.getElementById('accountDeleteStep-done');
  backdrop.classList.remove('visible');
  // After a deletion the page starts over without the account.
  if (done && done.style.display !== 'none') location.reload();
}

function accountDeleteContinue() {
  accountDeleteShowStep('confirm');
  document.getElementById('accountDeleteNicknameInput')?.focus();
}

async function submitAccountDelete() {
  const nickname = (document.getElementById('accountDeleteNicknameInput')?.value || '').trim();
  const pin = (document.getElementById('accountDeletePinInput')?.value || '').trim();
  if (!nickname) return accountSetStatus('accountDeleteStatus', 'Type your nickname.', true);
  if (!/^\d{5}$/.test(pin)) return accountSetStatus('accountDeleteStatus', 'Type your 5-digit PIN.', true);
  if (typeof nicknameKey === 'function' && nicknameKey(nickname) !== nicknameKey(getForumNickname())) {
    return accountSetStatus('accountDeleteStatus', accountPinErrorText({ error: 'nickname_mismatch' }), true);
  }

  const btn = document.getElementById('accountDeleteSubmit');
  if (btn) btn.disabled = true;
  accountSetStatus('accountDeleteStatus', 'Deleting…');
  try {
    const { data } = await callAccountDelete('request', { nickname, pin, from: accountDeviceLabel() });
    if (data && data.ok) {
      const when = document.getElementById('accountDeleteWhen');
      if (when) when.textContent = accountDateText(data.purge_after);
      accountWipeLocal();
      accountDeleteShowStep('done');
      return;
    }
    accountSetStatus('accountDeleteStatus', accountPinErrorText(data), true);
  } catch (err) {
    console.error('Account delete error:', err);
    accountSetStatus('accountDeleteStatus', typeof dbFailureText === 'function'
      ? await dbFailureText("Couldn't reach the server. Check your connection.")
      : "Couldn't reach the server. Check your connection.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── An account waiting to be deleted ────────────────────────────────────────
// opts.mode: 'device'  this device was signed in to it (status 'pending');
//            'login'   someone just logged in to it (claim-nickname), with
//                      opts.pin already checked by the server.
let _accountPending = null;

function openAccountPendingModal(info, opts) {
  const backdrop = document.getElementById('accountPendingModalBackdrop');
  if (!backdrop) return;
  _accountPending = { ...info, mode: (opts && opts.mode) || 'device', pin: (opts && opts.pin) || '', onDone: opts && opts.onDone };

  const nameEl = document.getElementById('accountPendingName');
  if (nameEl) nameEl.textContent = info.nickname || getForumNickname() || '';
  const askedEl = document.getElementById('accountPendingAsked');
  if (askedEl) {
    const from = info.asked_here ? 'this device' : (info.requested_from || 'another device');
    const on = accountDateText(info.requested_at);
    askedEl.textContent = on ? `${from}, on ${on}` : from;
  }
  const purgeEl = document.getElementById('accountPendingPurge');
  if (purgeEl) purgeEl.textContent = accountDateText(info.purge_after) || `in ${ACCOUNT_DELETE_DAYS} days`;

  const loginMode = _accountPending.mode === 'login';
  const pin = _accountPending.pin || (!loginMode ? getForumPin() : '');
  const pinRow = document.getElementById('accountPendingPinRow');
  const pinInput = document.getElementById('accountPendingPinInput');
  if (pinInput) pinInput.value = '';
  if (pinRow) pinRow.style.display = pin ? 'none' : '';
  const outBtn = document.getElementById('accountPendingSignOut');
  if (outBtn) outBtn.textContent = loginMode ? 'Close' : 'Sign out';
  const outText = document.getElementById('accountPendingSignOutText');
  if (outText) outText.style.display = loginMode ? 'none' : '';
  accountSetStatus('accountPendingStatus', '');
  backdrop.classList.add('visible');
}

function closeAccountPendingModal() {
  document.getElementById('accountPendingModalBackdrop')?.classList.remove('visible');
  _accountPending = null;
}

async function accountPendingCancel() {
  const p = _accountPending;
  if (!p) return;
  const pinRow = document.getElementById('accountPendingPinRow');
  const typed = pinRow && pinRow.style.display !== 'none'
    ? (document.getElementById('accountPendingPinInput')?.value || '').trim() : '';
  const pin = typed || p.pin || (p.mode !== 'login' ? getForumPin() : '');
  if (!/^\d{5}$/.test(pin)) {
    if (pinRow) pinRow.style.display = '';
    return accountSetStatus('accountPendingStatus', 'Type your 5-digit PIN.', true);
  }
  accountSetStatus('accountPendingStatus', 'Cancelling…');
  try {
    const { data } = await callAccountDelete('cancel', { nickname: p.nickname || getForumNickname(), pin });
    if (data && data.ok) {
      saveForumIdentity(data.nickname, pin, { sameAccount: data.nickname === getForumNickname() });
      if (typeof refreshForumIdentityUI === 'function') refreshForumIdentityUI();
      const onDone = p.onDone;
      closeAccountPendingModal();
      if (typeof syncAttempts === 'function') syncAttempts();
      if (onDone) onDone();
      return;
    }
    if (data && (data.error === 'wrong_pin' || data.error === 'invalid_pin_format') && pinRow) pinRow.style.display = '';
    accountSetStatus('accountPendingStatus', accountPinErrorText(data), true);
  } catch (err) {
    console.error('Account cancel error:', err);
    accountSetStatus('accountPendingStatus', "Couldn't reach the server. Check your connection.", true);
  }
}

async function accountPendingSignOut() {
  const p = _accountPending;
  if (!p) return;
  if (p.mode === 'login') return closeAccountPendingModal();
  accountSetStatus('accountPendingStatus', 'Signing out…');
  try {
    const { data } = await callAccountDelete('sign_out');
    if (!data || !data.ok) {
      accountSetStatus('accountPendingStatus', accountPinErrorText(data), true);
      return;
    }
  } catch (err) {
    console.error('Account sign-out error:', err);
    accountSetStatus('accountPendingStatus', "Couldn't reach the server. Check your connection.", true);
    return;
  }
  accountWipeLocal();
  location.reload();
}

// ── Deleted while this device was away ──────────────────────────────────────
function openAccountDeletedModal(nickname) {
  const backdrop = document.getElementById('accountDeletedModalBackdrop');
  if (!backdrop) return;
  const nameEl = document.getElementById('accountDeletedName');
  if (nameEl) nameEl.textContent = nickname || 'Your account';
  backdrop.classList.add('visible');
}
function closeAccountDeletedModal() {
  document.getElementById('accountDeletedModalBackdrop')?.classList.remove('visible');
  location.reload();
}

// ── Asking the server ───────────────────────────────────────────────────────
// Called when this device thinks it's signed in but the server says it
// isn't (js/attempts-sync.js on "no_identity"). At most once a minute.
let _accountCheckAt = 0;
let _accountChecking = false;

async function accountDeletionCheck() {
  if (_accountChecking || Date.now() - _accountCheckAt < 60000) return;
  if (!getForumNickname()) return;
  if (typeof isLockdownSession === 'function' && isLockdownSession()) return;
  _accountChecking = true;
  _accountCheckAt = Date.now();
  try {
    const { data } = await callAccountDelete('status');
    if (!data || !data.ok) return;
    if (data.state === 'pending') {
      openAccountPendingModal(data, { mode: 'device' });
    } else if (data.state === 'deleted') {
      const nickname = getForumNickname();
      accountWipeLocal();
      openAccountDeletedModal(nickname);
    }
  } catch (err) {
    console.error('Account status check error:', err);
  } finally {
    _accountChecking = false;
  }
}
