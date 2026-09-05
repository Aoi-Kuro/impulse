/* ═══════════════════════════════════════════════════════════════════
   push-notifications.js  ·  Forum @mention push notifications
   Requests Notification permission, subscribes this browser via the Web
   Push API (through sw.js's own 'push' handler — see that file), and
   saves/removes the subscription server-side via save-push-subscription.ts.
   The actual send happens in post-message.ts whenever a message @mentions
   a claimed nickname or replies directly to one — this file only owns the
   permission/subscribe UI and reacting to a notification once tapped.
   ─────────────────────────────────────────────────────────────────── */

// PUSH_VAPID_PUBLIC_KEY now comes from js/course-config.js (course-specific —
// each Supabase project has its own VAPID keypair, see that file's comment).

function pushUrlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushNotificationsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Three states the toggle button can be in: 'unsubscribed' (default,
// permission not yet asked or granted-but-not-subscribed), 'subscribed',
// 'blocked' (user explicitly denied — browsers give no way to re-prompt,
// only their own site-settings UI can undo that).
async function getPushUIState() {
  if (!pushNotificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  } catch (e) {
    return 'unsubscribed';
  }
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'unsubscribed';

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushUrlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-push-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      action: 'subscribe',
      device_id: getForumDeviceId(),
      device_secret: (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null,
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    console.error('Push subscribe save failed:', data && data.error);
    return 'unsubscribed';
  }
  return 'subscribed';
}

async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'unsubscribed';
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (e) { console.warn('Push unsubscribe (browser side) failed:', e); }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/save-push-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ action: 'unsubscribe', device_id: getForumDeviceId(), device_secret: (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null, endpoint }),
    });
  } catch (e) { console.warn('Push unsubscribe (server side) failed:', e); }
  return 'unsubscribed';
}

// ── Pre-permission explanation modal ─────────────────────────────────────
// Shown before the real browser prompt so the person knows what they're
// agreeing to first. Only makes sense when Notification.permission is still
// 'default' (never asked) — if it's already 'granted' we skip straight to
// subscribeToPush() with no dialog at all, and 'denied' is the separate
// 'blocked' state the toggle button already handles on its own.
function openPushPermissionModal() {
  document.getElementById('pushPermissionModalBackdrop')?.classList.add('visible');
}

function closePushPermissionModal() {
  document.getElementById('pushPermissionModalBackdrop')?.classList.remove('visible');
}

async function onPushPermissionModalAllow() {
  const allowBtn = document.getElementById('pushPermissionAllowBtn');
  if (allowBtn) allowBtn.disabled = true;

  const next = await subscribeToPush();

  if (allowBtn) allowBtn.disabled = false;
  closePushPermissionModal();
  renderPushToggleBtn(next);

  if (next === 'blocked') {
    setForumStatus("Notifications were blocked. You can allow them again from your browser's site settings for this page.");
  }
}

// ── Toggle button (forum header) ────────────────────────────────────────
function renderPushToggleBtn(state) {
  const btn = document.getElementById('forumPushToggleBtn');
  if (!btn) return;
  if (state === 'unsupported') { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.classList.toggle('active', state === 'subscribed');
  btn.classList.toggle('blocked', state === 'blocked');
  // Deliberately NOT disabled when blocked — a disabled <button> eats taps
  // with zero feedback, and blocked used to render the exact same 🔕 as the
  // plain off state, so a blocked bell looked identical to a working one
  // and tapping it silently did nothing. Now it gets its own icon/color
  // (see .forum-push-toggle-btn.blocked in forum.css) and stays tappable
  // so onPushToggleBtnClick can explain what happened.
  btn.disabled = false;
  if (state === 'subscribed') { btn.textContent = '🔔'; btn.title = 'Notifications on — tap to turn off'; }
  else if (state === 'blocked') { btn.textContent = '🚫'; btn.title = 'Notifications blocked — tap for how to turn them back on'; }
  else { btn.textContent = '🔕'; btn.title = 'Get notified when someone tags you, even with the site closed'; }
}

async function refreshPushToggleBtn() {
  renderPushToggleBtn(await getPushUIState());
}

async function onPushToggleBtnClick() {
  const btn = document.getElementById('forumPushToggleBtn');
  const current = await getPushUIState();
  if (current === 'unsupported') return;

  if (current === 'blocked') {
    setForumStatus("Notifications are blocked for this site. Allow them again from your browser's site settings to turn this back on.");
    return;
  }

  // Turning notifications off never needs the browser prompt, so it skips
  // our explanation modal entirely.
  if (current === 'subscribed') {
    if (btn) { btn.disabled = true; }
    const next = await unsubscribeFromPush();
    if (btn) { btn.disabled = false; }
    renderPushToggleBtn(next);
    return;
  }

  // Permission was never asked yet — show our own explanation first.
  // Tapping "Allow" there is what actually calls subscribeToPush() and
  // triggers the real browser prompt. If permission is already 'granted'
  // (e.g. subscription just got dropped), there's nothing left to explain,
  // so subscribe straight away with no dialog.
  if (Notification.permission === 'default') {
    openPushPermissionModal();
    return;
  }

  if (btn) { btn.disabled = true; }
  const next = await subscribeToPush();
  if (btn) { btn.disabled = false; }
  renderPushToggleBtn(next);

  if (next === 'blocked') {
    setForumStatus("Notifications were blocked. You can allow them again from your browser's site settings for this page.");
  }
}

// ── Opening the right thread from a tapped notification ─────────────────
// problem_key is "q{quizNum}_{problemId}" (see parseProblemKey in
// post-message.ts) or null for a global-scope mention.
function openForumFromPushData(data) {
  if (!data) return;
  const m = data.problem_key ? /^q(\d+)_(.+)$/.exec(data.problem_key) : null;
  if (m) openForumForProblem(m[1], m[2]);
  else openForumScreen();
}

// Case 1: a tab was already open when the notification was tapped — sw.js's
// notificationclick handler focuses it and posts this message instead of
// reloading.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'forum-mention-click') {
      openForumFromPushData(event.data);
    }
  });
}

// Case 2: nothing was open, so sw.js opened a fresh tab with the details
// folded into the URL instead. Read them back out once, then clean the URL
// so a later refresh/share doesn't re-trigger this.
(function handlePushOpenFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('openForum') !== '1') return;
  const data = { scope: params.get('scope'), problem_key: params.get('problem_key') };
  window.addEventListener('load', () => openForumFromPushData(data));
  const cleanUrl = window.location.pathname + window.location.hash;
  history.replaceState({}, '', cleanUrl);
})();

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('forumPushToggleBtn');
  if (btn) btn.addEventListener('click', onPushToggleBtnClick);
  refreshPushToggleBtn();
});
