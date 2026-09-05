// ── Class Forum (read-only feed, full-screen) ────────────────────────────────
// This file only READS from forum_messages via the public publishable key,
// which RLS restricts to SELECT-only. Posting goes through a Supabase Edge
// Function that runs OpenAI moderation before any row is inserted — this
// file never calls .insert() directly.

const FORUM_PAGE_SIZE       = 25;
// Kept equal to FORUM_PROBLEM_COUNTS_POLL_MS (defined further down, next to
// the per-problem buttons it refreshes) on purpose: the corner FAB shows the
// same badge as the main-screen launch button, and both are visible at the
// same time as the per-problem "sa-forum-badge-i"/"rq-forum-badge-i" buttons
// during solve-all/Random 6, so they need to visibly tick over together
// rather than one looking stuck.
const FORUM_POLL_INTERVAL_MS = 5000;
const FORUM_LAST_SEEN_KEY   = STORAGE_PREFIX + '_forum_last_seen_id';

// How often to check for brand-new messages while the forum screen itself is
// open and being read. Separate from FORUM_POLL_INTERVAL_MS above, which is
// the much slower "unread badge on the main screen" poll and is paused the
// whole time this one is running (see startForumLivePolling/stopForumPolling
// call sites in openForumScreen/closeForumScreen).
const FORUM_LIVE_POLL_MS = 3000;

// Sentinel device_id the Gemini bot's own inserts use (post-message.ts,
// GEMINI_BOT_DEVICE_ID) — kept in sync manually with that file. This is what
// the "official Gemini" avatar keys off (see renderForumMessage), NOT
// author_name, because author_name is just free text anyone typing "Gemini"
// as their display name could also produce. The Edge Function refuses to let
// a human-submitted post use this exact device_id, which is what actually
// makes that distinction trustworthy rather than cosmetic.
const FORUM_GEMINI_BOT_DEVICE_ID = '00000000-0000-4000-8000-000000000001';

// Mirrors post-message.ts's LATEX_ASSIST_RE exactly (kept in sync manually,
// same relationship as FORUM_GEMINI_BOT_DEVICE_ID above) — used purely to
// detect &content&/&&content&& shorthand client-side so an optimistically-
// rendered message (see submitForumMessage) can grey those spans out as
// "pending LaTeX conversion" instead of showing the raw shorthand while the
// real conversion happens server-side. &&...&& (display) is matched before
// lone &...& (inline) so a display block can't be misread as two inlines.
const FORUM_LATEX_ASSIST_RE = /&&([\s\S]+?)&&|&([^&\n]+?)&/g;
// Same pattern without the /g flag, used only for the cheap "does this text
// contain any shorthand at all" boolean check — a global regex's .test()
// mutates lastIndex across calls, which would be a footgun for a boolean
// helper other code calls freely.
const FORUM_LATEX_ASSIST_TEST_RE = /&&([\s\S]+?)&&|&([^&\n]+?)&/;

function forumHasLatexShorthand(text) {
  return FORUM_LATEX_ASSIST_TEST_RE.test(text || '');
}

// ── Posting bans (escalating from red-flagged/deleted messages) ────────────
// See superbase/edge-functions/flag-message.ts (issues the ban) and
// check-ban.ts / post-message.ts's 403 (report it back to this device).
let forumBanUntilMs = 0;
let forumBanCountdownTimer = null;

function forumBanRemainingText(untilMs) {
  let diff = Math.max(0, untilMs - Date.now());
  const h = Math.floor(diff / 3600000); diff -= h * 3600000;
  const m = Math.floor(diff / 60000);   diff -= m * 60000;
  const s = Math.floor(diff / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function setForumComposerDisabled(disabled) {
  const sendBtn = document.getElementById('forumSendBtn');
  const eqBtn = document.getElementById('forumEqBtn');
  const bodyInput = document.getElementById('forumBodyInput');
  if (sendBtn) sendBtn.disabled = disabled;
  if (eqBtn) eqBtn.disabled = disabled;
  if (bodyInput) bodyInput.disabled = disabled;
}

// Pass null/falsy to clear the ban UI (also self-clears once the countdown
// hits zero, without needing another server round-trip).
function applyForumBanUI(bannedUntilIso) {
  const banner = document.getElementById('forumBanBanner');
  const remainingEl = document.getElementById('forumBanRemaining');
  if (!banner || !remainingEl) return;

  if (forumBanCountdownTimer) { clearInterval(forumBanCountdownTimer); forumBanCountdownTimer = null; }

  if (!bannedUntilIso) {
    forumBanUntilMs = 0;
    banner.style.display = 'none';
    setForumComposerDisabled(false);
    return;
  }

  forumBanUntilMs = new Date(bannedUntilIso).getTime();
  banner.style.display = 'flex';
  setForumComposerDisabled(true);

  const tick = () => {
    if (Date.now() >= forumBanUntilMs) { applyForumBanUI(null); return; }
    remainingEl.textContent = forumBanRemainingText(forumBanUntilMs);
  };
  tick();
  forumBanCountdownTimer = setInterval(tick, 1000);
}

// Best-effort: lets the banner appear as soon as the forum is opened (and
// keeps refreshing via forumLiveTick) rather than only reactively, after an
// attempted post gets rejected.
async function checkForumBanStatus() {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ device_id: getForumDeviceId() }),
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) applyForumBanUI(data.banned_until || null);
  } catch (err) {
    console.warn('Forum: ban status check failed', err);
  }
}

// Quiz number → problem_key prefix, matching the same "qN_ProblemId" scheme
// quiz-engine.js already uses for its math cache keys (see mathCacheKeyFor).
const FORUM_FILTERS = ['all', 'global', 'q1', 'q2', 'q3', 'q4'];

// Fixed hue palette for author-name colors. A name's color is picked by
// hashing its text into this list, so it's deterministic (the same name is
// always the same color) while still looking arbitrarily assigned.
const FORUM_NAME_HUES = [4, 28, 48, 92, 152, 190, 218, 262, 300, 330];

// Matches an "@name" token inside a message body — same "whitespace-delimited
// word starting with @" shape the mention-autocomplete (below) already
// assumes when inserting one, so anything the composer can produce is
// recognized here. Deliberately permissive about what counts as a name
// (letters/digits/._-) rather than validating against known authors, since
// this forum has no accounts — someone can still @-mention a name that never
// posted, or one that's since changed, and it'll render as a mention chip
// either way; the profile popup just reports "no messages found" for those.
const FORUM_MENTION_RE = /@([\p{L}\p{N}._-]+)/gu;

let forumClient        = null;
let forumScreenOpen    = false;
let forumFilter        = 'all';
// Sub-filter within a selected quiz (forumFilter === 'q1'..'q4' only) —
// '' means "every thread in this quiz" (the old q1..q4 behavior), 'general'
// narrows to just that quiz's general thread, and any other value is a
// specific problem id. Meaningless (and always reset to '') for the
// 'all'/'global' top-level filters — see updateForumFilterProblemSelect().
let forumFilterProblemId = '';
let forumOldestLoadedId = null; // cursor: fetch rows with id < this to go older
let forumNoMoreOlder    = false;
let forumLoadingMore    = false;
let forumPollTimer      = null;
let forumLiveTimer      = null; // separate interval that runs only while the forum screen is open (see FORUM_LIVE_POLL_MS)
// ── Search (forumSearchActive true means the message list below the search
// bar shows fetchForumSearchResults() output instead of the current
// forumFilter's normal feed — see toggleForumSearch()/runForumSearch() ──
let forumSearchActive     = false;
let forumSearchDebounce   = null;
const FORUM_SEARCH_DEBOUNCE_MS = 350;
const FORUM_SEARCH_LIMIT = 50;
let forumReplyTarget = null; // {id, author, snippet, scope, problem_key} or null
let forumPendingNewCount = 0;   // messages already inserted above the fold while the reader was scrolled down, shown via the "new messages" pill

// In-memory cache of each filter's first page, so reopening the forum (or
// switching back to a filter you already viewed) paints instantly instead of
// flashing "Loading messages…" — then a fresh fetch runs underneath and
// replaces it if anything changed. Resets on a full page reload; this is
// only about avoiding a redundant refetch within the same visit, not
// long-term persistence. LaTeX is deliberately NOT cached here — it's always
// re-typeset from scratch by renderMathIn() each time a message is rendered.
const forumMessageCache = {};

// The cache (and the "recently active authors" pool below) is keyed per
// combination of top-level filter + sub-filter, so narrowing q1 down to one
// problem doesn't paint stale "whole quiz" results before the real fetch
// resolves, and switching back to "All of Quiz 1" doesn't paint a stale
// single-problem page either. Only q1..q4 ever have a meaningful sub-filter.
function forumCacheKey() {
  return forumFilterProblemId ? `${forumFilter}::${forumFilterProblemId}` : forumFilter;
}

// ── Composer state ──────────────────────────────────────────────────────────
// The scope selector always resets to "Global" every time the forum screen is
// opened (per design decision — a previously-picked quiz/problem scope should
// never silently carry over to the next visit).
const FORUM_DEVICE_ID_KEY = STORAGE_PREFIX + '_forum_device_id';
const FORUM_NAME_KEY      = STORAGE_PREFIX + '_forum_display_name';
const FORUM_NICKNAME_KEY  = STORAGE_PREFIX + '_forum_nickname'; // set only once a nickname is claimed
const FORUM_PIN_KEY       = STORAGE_PREFIX + '_forum_pin';       // the 5-digit PIN for that nickname
const FORUM_MAX_NAME_LEN  = 40;
const FORUM_MAX_BODY_LEN  = 1000;

let forumComposerQuiz      = 'global'; // 'global' | 'q1'..'q4'
let forumComposerProblemId = '';       // '' = quiz-general, else a problem id like "P18"

// State for the edit-message modal (openForumEditMessageModal below) — kept
// entirely separate from forumComposerQuiz/forumComposerProblemId above so
// editing an old message's topic can never bleed into whatever scope is
// currently selected for a brand-new post in the composer.
let forumEditMessageId  = null;
let forumEditOrigBody   = '';
let forumEditQuiz       = 'global';
let forumEditProblemId  = '';

function getForumClient() {
  if (forumClient) return forumClient;

  if (typeof supabase === 'undefined' || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error('Forum: Supabase client library or config not loaded.');
    return null;
  }
  forumClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return forumClient;
}

// ── Local "last seen" tracking (drives the unread badge) ────────────────────
function getForumLastSeenId() {
  const raw = localStorage.getItem(FORUM_LAST_SEEN_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}
function setForumLastSeenId(id) {
  localStorage.setItem(FORUM_LAST_SEEN_KEY, String(id));
}

// Updates BOTH badge pairs at once (main-screen launch button + the
// floating button — see forum-fab-wrap in index.html) since they always
// track the same underlying unread state; there's no separate "last seen"
// per entry point. `mentioned` drives the small "@" pill shown alongside
// the numeric count (not instead of it) when one of the unread messages
// tags the viewer's own current identity — see forumUnreadMentionsOwnName()
// in pollForumUnread().
function setForumUnreadBadge(count, mentioned) {
  ['forumUnreadBadge', 'forumFabUnreadBadge'].forEach((id) => {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (!count || count <= 0) {
      badge.style.display = 'none';
      badge.textContent = '';
      return;
    }
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'flex';
  });

  ['forumUnreadAtBadge', 'forumFabUnreadAtBadge'].forEach((id) => {
    const atBadge = document.getElementById(id);
    if (!atBadge) return;
    atBadge.classList.toggle('visible', !!mentioned);
  });
}

// ── Name → color, problem_key → tag ──────────────────────────────────────────
function forumColorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = FORUM_NAME_HUES[hash % FORUM_NAME_HUES.length];
  return `hsl(${hue} 65% 55%)`;
}

// Snaps an arbitrary hue to the nearest one in FORUM_NAME_HUES — the same
// vetted set forumColorForName() already picks from. Saturation/lightness
// (the two properties that actually govern contrast against the page
// background) stay locked at the same 65%/55% every name color already
// uses; only the hue moves, so this can never land on something unreadable
// the way trusting DiceBear's raw color as-is could.
function forumNearestSafeHue(hue) {
  let best = FORUM_NAME_HUES[0];
  let bestDist = 360;
  for (const h of FORUM_NAME_HUES) {
    // Circular distance — hue is a position on a 360° wheel, so 350 and 10
    // are only 20° apart, not 340°.
    const dist = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
    if (dist < bestDist) { bestDist = dist; best = h; }
  }
  return best;
}

// Pulls a representative hue out of a poster's stored DiceBear identicon
// SVG, so their name color visually echoes their avatar instead of being
// picked from an unrelated hash of their name. Reads every fill="#..." in
// the markup, skips near-white/near-black/gray ones (background/outline
// cells, not the pattern's actual accent color — and greys have no
// meaningful hue to contribute anyway), and averages the rest. Identicons
// normally repeat one accent color across several cells, so this is
// usually just that color's hue.
function forumHueFromAvatarSvg(svgMarkup) {
  const hexes = svgMarkup.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || !hexes.length) return null;
  let sumSin = 0, sumCos = 0, count = 0;
  for (const hex of hexes) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    if (delta < 0.08 || lightness < 0.12 || lightness > 0.92) continue;
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
    // Averaging hues directly breaks near the 0°/360° wrap (350° and 10°
    // would naively average to 180°, the opposite color), so average their
    // positions on the unit circle instead and convert back at the end.
    sumSin += Math.sin(hue * Math.PI / 180);
    sumCos += Math.cos(hue * Math.PI / 180);
    count++;
  }
  if (!count) return null;
  let avgHue = Math.atan2(sumSin, sumCos) * 180 / Math.PI;
  if (avgHue < 0) avgHue += 360;
  return avgHue;
}

// What renderForumMessage actually calls for the author name color: Gemini
// (identified by device_id, see FORUM_GEMINI_BOT_DEVICE_ID — not by
// author_name, since that's just free text anyone typing "Gemini" could
// match) always gets the theme's own near-black/near-white text color
// instead of a hash/avatar color, so it reads as a neutral system voice
// rather than looking like "just another colorful username" next to
// everyone else's posts. Otherwise prefers the poster's own avatar color
// (snapped to the safe palette) when they have a stored avatar, falling
// back to the old name-hash color for posters without one yet (unclaimed,
// or claimed before avatars shipped).
function forumColorForMessage(msg) {
  if (msg.device_id === FORUM_GEMINI_BOT_DEVICE_ID) return 'var(--text)';
  if (msg.avatar_svg) {
    const rawHue = forumHueFromAvatarSvg(msg.avatar_svg);
    if (rawHue !== null) return `hsl(${forumNearestSafeHue(rawHue)} 65% 55%)`;
  }
  return forumColorForName(msg.author_name);
}

// problem_key follows the "qN_ProblemId" scheme (see quiz-engine.js's
// mathCacheKeyFor) — e.g. "q2_P18" renders as the "Q2—P18" tag, colored
// with that quiz's existing chart color (--q1.."--q4", defined in stats.css).
function forumTagInfo(scope, problemKey) {
  if (scope !== 'problem' || !problemKey) return { label: 'Global', color: null };
  const m = /^q(\d+)_(.+)$/i.exec(problemKey);
  if (!m) return { label: problemKey, color: null };
  const quizNum = m[1];
  const probId  = m[2].toUpperCase();
  return { label: `Q${quizNum}—${probId}`, color: `var(--q${quizNum})` };
}

// ── Composer: identity helpers ───────────────────────────────────────────────
function getForumDeviceId() {
  let id = localStorage.getItem(FORUM_DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(FORUM_DEVICE_ID_KEY, id);
  }
  return id;
}

// device_id is shown to every reader of the forum (it rides along on every
// message via forum_messages_public), so it can never be trusted as proof
// of "this is my device" on its own — see migration
// 001_device_secrets.sql. This secret is the actual proof: generated once,
// right alongside device_id, and never sent anywhere except in this
// device's own requests. The server registers whatever secret it sees the
// very first time a device_id shows up (trust-on-first-use) and checks
// against that same value on every later request for that device_id — so
// this only needs to be generated once, exactly like device_id itself, not
// re-issued or rotated by any explicit "register" call.
const FORUM_DEVICE_SECRET_KEY = STORAGE_PREFIX + '_forum_device_secret';
function getForumDeviceSecret() {
  let secret = localStorage.getItem(FORUM_DEVICE_SECRET_KEY);
  if (!secret) {
    // 32 random bytes as hex (64 chars) — comfortably within the
    // server-side 16-200 char bound and unguessable regardless of how
    // public device_id itself is.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(FORUM_DEVICE_SECRET_KEY, secret);
  }
  return secret;
}
function getForumSavedName() {
  return localStorage.getItem(FORUM_NAME_KEY) || '';
}
function saveForumName(name) {
  localStorage.setItem(FORUM_NAME_KEY, name);
}

// Nickname claim state — separate from the free-text name above. Once a
// device has claimed a nickname, the composer's name field is replaced by a
// constant "nickname: X" bar (see refreshForumIdentityUI) and every message
// posts under that name, enforced server-side in post-message (a claim is
// meaningless if the client-sent author_name could just be overridden).
function getForumNickname() {
  return localStorage.getItem(FORUM_NICKNAME_KEY) || '';
}
function getForumPin() {
  return localStorage.getItem(FORUM_PIN_KEY) || '';
}
function saveForumIdentity(nickname, pin) {
  localStorage.setItem(FORUM_NICKNAME_KEY, nickname);
  if (pin) localStorage.setItem(FORUM_PIN_KEY, pin);
}
function clearForumIdentity() {
  localStorage.removeItem(FORUM_NICKNAME_KEY);
  localStorage.removeItem(FORUM_PIN_KEY);
}
// The name to actually post under — claimed nickname takes priority over
// the free-text field. This is a courtesy default; post-message still
// re-derives and enforces the real value server-side from device_id.
function getForumIdentityName() {
  return getForumNickname() || getForumSavedName();
}

// Thin wrapper around the claim-nickname Edge Function, shared by the
// auto-claim-on-send path and all three identity modals below.
async function callForumClaimNickname(nickname, pin) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-nickname`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ device_id: getForumDeviceId(), device_secret: getForumDeviceSecret(), nickname, pin: pin || undefined }),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Renders the composer's identity area: either the free-text "Your name"
// input (unclaimed) or the static "nickname: X" bar with PIN/Change/Exit
// (claimed). Called on load and any time claim/rename/drop succeeds.
function refreshForumIdentityUI() {
  const unclaimedEl = document.getElementById('forumIdentityUnclaimed');
  const claimedEl   = document.getElementById('forumIdentityClaimed');
  const nicknameEl  = document.getElementById('forumIdentityNicknameText');
  const avatarEl    = document.getElementById('forumIdentityAvatar');
  const nickname    = getForumNickname();

  if (nickname) {
    if (unclaimedEl) unclaimedEl.style.display = 'none';
    if (claimedEl)   claimedEl.style.display = '';
    if (nicknameEl)  nicknameEl.textContent = nickname;
    // Same cache-first/DiceBear-fallback avatar used in the Stats panel and
    // on the landing screen (js/stats.js) — just painted at composer-bar
    // size here instead of duplicating that lookup chain.
    if (avatarEl && typeof loadSfpAvatar === 'function') loadSfpAvatar(nickname, avatarEl);
  } else {
    if (unclaimedEl) unclaimedEl.style.display = '';
    if (claimedEl)   claimedEl.style.display = 'none';
    prefillForumComposerName();
  }

  // Keep the Stats screen's own identity row (avatar/name + its PIN/Change/
  // Exit buttons, js/stats.js) in sync too — it now offers the same Exit
  // action this composer bar does, so an exit triggered from either place
  // needs to clear both, not just leave the other showing a stale identity.
  if (typeof renderSfpIdentity === 'function') renderSfpIdentity(nickname);
  renderLandingIdentity(nickname);
}

// Signed-in identity avatar, tilted in the open space left of the landing
// box (index.html, #landingIdentityBtn), mirroring the splash badge's
// height on the opposite side — static identicon, tap opens Stats. Hidden
// entirely until a nickname is claimed. Reuses loadSfpAvatar (js/stats.js)
// since it's already generic over which element the avatar gets painted
// into; no need for a second copy of the cache/DiceBear/initials fallback
// chain.
function renderLandingIdentity(nickname) {
  const btn      = document.getElementById('landingIdentityBtn');
  const avatarEl = document.getElementById('landingIdentityAvatar');
  if (!btn || !avatarEl) return;
  // Don't stomp the "Maxwell's Demon" easter egg (js/splash.js) if some
  // unrelated identity refresh — a background poll, a claim success
  // elsewhere — happens to fire while it's showing. It restores the real
  // state itself the moment demon mode actually ends (tap, or the next
  // splash change).
  if (typeof isLandingDemonActive === 'function' && isLandingDemonActive()) return;

  if (!nickname) {
    btn.style.display = 'none';
    avatarEl.innerHTML = '';
    return;
  }
  btn.style.display = '';
  btn.title = `${nickname} · Open stats`;
  if (typeof loadSfpAvatar === 'function') loadSfpAvatar(nickname, avatarEl);
}

// ── Composer: scope selectors ────────────────────────────────────────────────
// Quiz options are built from QUIZZES (course/quizzes/quizzes.js) so a new quiz added
// there shows up here automatically without touching this file. selectId
// defaults to the composer's own select but the edit-message modal below
// reuses this same function for its own (separate) quiz select.
function populateForumComposerQuizSelect(selectId = 'forumScopeQuizSelect') {
  const sel = document.getElementById(selectId);
  if (!sel || typeof QUIZZES === 'undefined') return;
  sel.innerHTML = '<option value="global">🌐 Global</option>';
  QUIZZES.forEach((quiz, idx) => {
    if (!quiz.enabled) return;
    const opt = document.createElement('option');
    opt.value = `q${idx + 1}`;
    opt.textContent = `Quiz ${idx + 1} — ${quiz.name}`;
    sel.appendChild(opt);
  });
}

// Problem dropdown for a chosen quiz. First option is "General discussion"
// (no specific problem) — see buildForumScopePayload() for how that's
// encoded. selectId defaults to the composer's own select, same reasoning
// as populateForumComposerQuizSelect above.
function populateForumComposerProblemSelect(quizValue, selectId = 'forumScopeProblemSelect') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const quizNum = quizValue.replace('q', '');
  const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[parseInt(quizNum, 10) - 1] : null;

  sel.innerHTML = '';
  const generalOpt = document.createElement('option');
  generalOpt.value = '';
  generalOpt.textContent = `General discussion (Quiz ${quizNum})`;
  sel.appendChild(generalOpt);

  if (quiz && Array.isArray(quiz.problems)) {
    quiz.problems.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.id;
      sel.appendChild(opt);
    });
  }
}

function onForumScopeQuizChange() {
  const sel     = document.getElementById('forumScopeQuizSelect');
  const probSel = document.getElementById('forumScopeProblemSelect');
  if (!sel || !probSel) return;

  forumComposerQuiz = sel.value;
  forumComposerProblemId = '';

  if (forumComposerQuiz === 'global') {
    probSel.style.display = 'none';
    probSel.innerHTML = '';
  } else {
    populateForumComposerProblemSelect(forumComposerQuiz);
    probSel.style.display = '';
  }
}

function onForumScopeProblemChange() {
  const probSel = document.getElementById('forumScopeProblemSelect');
  if (probSel) forumComposerProblemId = probSel.value;
}

// Resets the scope selector back to Global — called every time the forum
// screen opens, so a scope picked in a previous visit never carries over.
function resetForumComposerScope() {
  const sel     = document.getElementById('forumScopeQuizSelect');
  const probSel = document.getElementById('forumScopeProblemSelect');
  forumComposerQuiz = 'global';
  forumComposerProblemId = '';
  if (sel) sel.value = 'global';
  if (probSel) { probSel.style.display = 'none'; probSel.innerHTML = ''; }
}

function prefillForumComposerName() {
  const nameInput = document.getElementById('forumNameInput');
  if (nameInput) nameInput.value = getForumSavedName();
}

// Turns the current scope selection into the {scope, problem_key} shape the
// Edge Function expects. Picking a quiz with no specific problem selected
// posts to a per-quiz "general" thread using problem_key "qN_general" — this
// still matches the "qN_%" pattern the filter chips already search on, so it
// shows up under that quiz's chip without needing schema or filter changes.
function buildForumScopePayload() {
  if (forumComposerQuiz === 'global') return { scope: 'global', problem_key: null };
  const quizNum = forumComposerQuiz.replace('q', '');
  const problemKey = forumComposerProblemId
    ? `q${quizNum}_${forumComposerProblemId}`
    : `q${quizNum}_general`;
  return { scope: 'problem', problem_key: problemKey };
}

// ── Composer: submit ─────────────────────────────────────────────────────────
// If this device already has a claimed nickname, that's used automatically
// (the free-text name field is hidden in that state — see
// refreshForumIdentityUI). Otherwise the typed name is auto-claimed for this
// device on first send: if it's free, it becomes this device's nickname
// (a one-time PIN modal follows); if it's already claimed by someone else,
// sending is paused and a PIN-verification modal opens instead — see
// openForumClaimModal('verify').
// A quoted message that's just one $$...$$ display equation renders full-
// width/centered inside the small quote strip/banner, which looks bulky —
// collapse it to inline $...$ there (display-vs-inline is a rendering
// choice, not a content one, so this only affects the snippet text, never
// what's actually stored/posted).
function collapseDisplayMath(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => `$${inner.trim()}$`);
}

const FORUM_REPLY_SNIPPET_LIMIT = 80;

function forumReplyQuoteSnippet(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  // Whole message is one display block — collapse outright, no length cap
  // needed since it's already just the one equation.
  const whole = /^\$\$([\s\S]+)\$\$$/.exec(trimmed);
  if (whole) return `$${whole[1].trim()}$`;

  if (trimmed.length <= FORUM_REPLY_SNIPPET_LIMIT) return collapseDisplayMath(trimmed);

  // A plain 80-char cut can land in the middle of a $$...$$/$...$ span,
  // which can't render at all (unmatched delimiter) — push the cutoff out
  // to the end of whichever span it would otherwise slice through. Once
  // collapsed to inline right after, that's no longer the bulky result it
  // would have been at full display size, so extending past 80 chars for
  // this case specifically is worth it over showing a broken fragment.
  const spanRe = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;
  let end = FORUM_REPLY_SNIPPET_LIMIT;
  let m;
  while ((m = spanRe.exec(trimmed)) !== null) {
    if (m.index >= FORUM_REPLY_SNIPPET_LIMIT) break;
    if (m.index + m[0].length > FORUM_REPLY_SNIPPET_LIMIT) end = m.index + m[0].length;
  }

  const cut = collapseDisplayMath(trimmed.slice(0, end));
  return end < trimmed.length ? cut + '…' : cut;
}

function startForumReply(msg) {
  forumReplyTarget = { id: msg.id, author: msg.author_name, snippet: forumReplyQuoteSnippet(msg.body), scope: msg.scope, problem_key: msg.problem_key };
  const banner = document.getElementById('forumReplyBanner');
  const text = document.getElementById('forumReplyBannerText');
  if (text) { text.textContent = `↩ Replying to ${msg.author_name}: "${forumReplyTarget.snippet}"`; renderMathIn(text); }
  if (banner) banner.style.display = 'flex';

  // Locks the composer's own scope selectors to the parent's — same fields
  // onForumScopeQuizChange()/onForumScopeProblemChange() maintain, set
  // directly here since there's no screen navigation involved, just a
  // scope change within the already-open forum.
  const sel = document.getElementById('forumScopeQuizSelect');
  const probSel = document.getElementById('forumScopeProblemSelect');
  const parsed = msg.scope === 'problem' && msg.problem_key ? /^q(\d+)_(.+)$/.exec(msg.problem_key) : null;
  forumComposerQuiz = parsed ? 'q' + parsed[1] : 'global';
  forumComposerProblemId = parsed && parsed[2] !== 'general' ? parsed[2] : '';
  if (sel) sel.value = forumComposerQuiz;
  if (forumComposerQuiz === 'global') {
    if (probSel) { probSel.style.display = 'none'; probSel.innerHTML = ''; }
  } else {
    populateForumComposerProblemSelect(forumComposerQuiz);
    if (probSel) { probSel.style.display = ''; probSel.value = forumComposerProblemId; }
  }

  document.getElementById('forumBodyInput')?.focus();
}

function cancelForumReply() {
  forumReplyTarget = null;
  const banner = document.getElementById('forumReplyBanner');
  if (banner) banner.style.display = 'none';
}

function highlightForumRow(row) {
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('forum-message-highlight');
  setTimeout(() => row.classList.remove('forum-message-highlight'), 2000);
}

// Jumps to a message: scrolls+highlights it if already loaded, otherwise
// switches to the 'all' filter anchored right at that message's id (it's
// always the first row of that query) and loads it, then highlights it.
async function jumpForumToMessage(id) {
  const list = document.getElementById('forumMessageList');
  const existing = list && list.querySelector(`[data-msg-id="${id}"]`);
  if (existing) { highlightForumRow(existing); return; }

  if (forumSearchActive) exitForumSearch();
  forumFilter = 'all';
  forumFilterProblemId = '';
  document.querySelectorAll('#forumFilters .sf-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
  updateForumFilterProblemSelect();

  const client = getForumClient();
  if (!client || !list) return;
  const { data, error } = await client
    .from('forum_messages_public')
    .select('id, created_at, author_name, device_id, identity_id, body, scope, problem_key, flag_status, flag_reason, edited_at, avatar_svg, reply_to_id, reply_to_author_name, reply_to_body, reply_to_flag_status')
    .lte('id', id)
    .order('id', { ascending: false })
    .limit(FORUM_PAGE_SIZE);
  if (error || !data || data.length === 0) { setForumStatus("Couldn't find that message."); return; }

  renderForumMessageList(list, forumVisibleData(data));
  forumOldestLoadedId = data[data.length - 1].id;
  forumNoMoreOlder = data.length < FORUM_PAGE_SIZE;
  const loadMoreBtn = document.getElementById('forumLoadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.style.display = forumNoMoreOlder ? 'none' : 'block';

  const row = list.querySelector(`[data-msg-id="${id}"]`);
  if (row) highlightForumRow(row);
}

// ── Composer: optimistic send ────────────────────────────────────────────
// submitForumMessage() below renders the message into the feed the instant
// Send is tapped — before the claim check, moderation, or LaTeX-assist
// conversion have even run — so it reads as "already posted", not
// "sending". forumRevertOptimisticSend() tears the placeholder back out
// and puts the typed text back in the composer if the server ultimately
// rejects it (moderation, a ban, a network hiccup, a LaTeX-assist
// failure) — same end state as if Send had never been tapped.
// forumResolveOptimisticSend() swaps the placeholder for the real row once
// the server confirms it, in place, so nothing else in the list re-renders
// or flashes.
let forumOptimisticSeq = 0;
function forumNextOptimisticId() {
  return `pending-${Date.now()}-${++forumOptimisticSeq}`;
}

// Only fills in the fields renderForumMessage() actually reads — everything
// left unset (flag_status, edited_at, ...) reads the same as "not
// flagged"/"not edited" everywhere those are checked.
function forumBuildOptimisticMessage(tempId, { name, body, scope, problem_key, replySnapshot }) {
  return {
    id: tempId,
    created_at: new Date().toISOString(),
    author_name: name,
    device_id: getForumDeviceId(),
    body,
    scope,
    problem_key,
    avatar_svg: getCachedAvatarSvg(name) || '',
    reply_to_id: replySnapshot ? replySnapshot.id : null,
    reply_to_author_name: replySnapshot ? replySnapshot.author : null,
    reply_to_body: replySnapshot ? replySnapshot.snippet : null,
    reply_to_flag_status: null,
  };
}

// Drops in a status placeholder ('Loading…'/'Nothing's there…', see
// setForumStatus) instead of real rows — clear it out first so the
// optimistic row has an actual list to land in.
function forumInsertOptimisticRow(row) {
  const list = document.getElementById('forumMessageList');
  if (!list) return;
  if (list.querySelector('.forum-status')) list.innerHTML = '';
  list.insertBefore(row, list.firstChild);
}

function forumRevertOptimisticSend(tempId, originalBody) {
  const list = document.getElementById('forumMessageList');
  const row = list && list.querySelector(`[data-msg-id="${tempId}"]`);
  if (row) row.remove();
  const bodyInput = document.getElementById('forumBodyInput');
  if (bodyInput) {
    bodyInput.value = originalBody;
    rebuildForumBodyMirror();
  }
}

// Swaps the placeholder row for the real thing, built only from what
// post-message.ts's response actually returns (id, created_at,
// author_name, body, scope, problem_key) plus what the client already
// knows on its own — this device is the poster, its cached avatar (if
// any) for whatever name the server settled on, and — for a reply — the
// parent it was answering (captured client-side before the send, since
// the response doesn't echo it back).
function forumResolveOptimisticSend(tempId, serverMessage, replySnapshot) {
  const finalMsg = {
    ...serverMessage,
    device_id: getForumDeviceId(),
    avatar_svg: getCachedAvatarSvg(serverMessage.author_name) || '',
    flag_status: null,
    flag_reason: null,
    edited_at: null,
    reply_to_id: replySnapshot ? replySnapshot.id : null,
    reply_to_author_name: replySnapshot ? replySnapshot.author : null,
    reply_to_body: replySnapshot ? replySnapshot.snippet : null,
    reply_to_flag_status: null,
  };

  const list = document.getElementById('forumMessageList');
  if (list) {
    const pendingRow  = list.querySelector(`[data-msg-id="${tempId}"]`);
    const alreadyLive = list.querySelector(`[data-msg-id="${finalMsg.id}"]`);
    if (alreadyLive) {
      // A live-poll tick (forumLiveTick) already fetched and rendered this
      // message while we were still waiting on our own response — just
      // drop the placeholder, there's nothing left to insert.
      if (pendingRow) pendingRow.remove();
    } else if (pendingRow) {
      pendingRow.replaceWith(renderForumMessage(finalMsg));
    }
  }

  // Keep the cache in step so the next live-poll tick or filter switch
  // recognizes this id as already known instead of treating it as fresh
  // and inserting it a second time (see forumLiveTick's freshMsgs filter).
  const cacheKey = forumCacheKey();
  const cache = forumMessageCache[cacheKey];
  if (cache && !cache.some(m => String(m.id) === String(finalMsg.id))) {
    cache.unshift(finalMsg);
  }
}

async function submitForumMessage(opts = {}) {
  const nameInput = document.getElementById('forumNameInput');
  const bodyInput = document.getElementById('forumBodyInput');
  const sendBtn   = document.getElementById('forumSendBtn');
  const retryBtn  = document.getElementById('forumRetryLatexBtn');
  const forceBtn  = document.getElementById('forumForceSendBtn');
  const statusEl  = document.getElementById('forumComposerStatus');
  if (!bodyInput || !sendBtn || !statusEl) return;

  if (forumBanUntilMs && Date.now() < forumBanUntilMs) {
    statusEl.textContent = `You're banned from posting. Time left: ${forumBanRemainingText(forumBanUntilMs)}`;
    statusEl.classList.add('forum-composer-status-error');
    return;
  }

  // Shows the ↻/"Post as is" pair in place of the plain Send button, or
  // switches back — see the latex_assist_failed branch below for when this
  // actually gets triggered.
  function setLatexAssistFailedUI(failed) {
    sendBtn.style.display = failed ? 'none' : '';
    if (retryBtn) retryBtn.style.display = failed ? '' : 'none';
    if (forceBtn) forceBtn.style.display = failed ? '' : 'none';
  }

  const claimedNickname = getForumNickname();
  const name = claimedNickname || (nameInput ? nameInput.value.trim() : '');
  const body = bodyInput.value.trim();

  statusEl.textContent = '';
  statusEl.classList.remove('forum-composer-status-error');

  if (!name) {
    statusEl.textContent = 'Enter a name first.';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }
  if (name.length > FORUM_MAX_NAME_LEN) {
    statusEl.textContent = `Name must be under ${FORUM_MAX_NAME_LEN} characters.`;
    statusEl.classList.add('forum-composer-status-error');
    return;
  }
  if (!claimedNickname && !/^[\p{L}\p{N}._-]+$/u.test(name)) {
    statusEl.textContent = 'Name can only use letters, numbers, dots, underscores, or hyphens (no spaces).';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }
  if (!body) {
    statusEl.textContent = 'Write a message first.';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }
  if (body.length > FORUM_MAX_BODY_LEN) {
    statusEl.textContent = `Message must be under ${FORUM_MAX_BODY_LEN} characters.`;
    statusEl.classList.add('forum-composer-status-error');
    return;
  }

  const { scope, problem_key } = buildForumScopePayload();

  // Switch the visible feed to match where this message is headed *before*
  // showing it optimistically, so the placeholder lands in the feed the
  // person is actually looking at. A no-op (skips the reload) in the
  // common case of posting under whatever you're already viewing.
  const filterKeyBefore = forumFilter + '|' + forumFilterProblemId;
  syncForumFilterFromComposerScope();
  if (filterKeyBefore !== (forumFilter + '|' + forumFilterProblemId)) {
    await loadForumInitial();
  }

  // Snapshot everything the placeholder (and, on success, the final row)
  // needs, before the composer gets cleared below.
  const tempId = forumNextOptimisticId();
  const replySnapshot = forumReplyTarget
    ? { id: forumReplyTarget.id, author: forumReplyTarget.author, snippet: forumReplyTarget.snippet }
    : null;

  forumInsertOptimisticRow(renderForumMessage(
    forumBuildOptimisticMessage(tempId, { name, body, scope, problem_key, replySnapshot }),
    { pending: true }
  ));
  bodyInput.value = '';
  rebuildForumBodyMirror();

  // First message under a not-yet-claimed name: try to claim it before
  // actually posting. Skipped entirely once a device has a nickname, since
  // there's nothing left to claim.
  if (!claimedNickname) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Checking name…';
    try {
      const { ok, data } = await callForumClaimNickname(name);
      if (ok && data && data.ok) {
        // 'unchanged'/'renamed' shouldn't happen from this path (device had
        // no nickname), but handled defensively; 'created' is the normal case.
        saveForumIdentity(data.nickname, data.pin || null);
        refreshForumIdentityUI();
        if (data.created) {
          // Show the PIN after the message itself goes out, so posting
          // isn't held up by the person reading/dismissing the modal.
          forumPendingPinToShow = data.pin;
        }
      } else if (data && data.error === 'taken') {
        forumRevertOptimisticSend(tempId, body);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        openForumClaimModal('verify', name, () => submitForumMessage());
        return;
      } else {
        // Unexpected error while claiming — don't block posting over it,
        // just send as an ordinary (unclaimed) free-text name this once.
        console.warn('Forum: claim check failed, sending as free text', data);
      }
    } catch (err) {
      console.warn('Forum: claim check network error, sending as free text', err);
    }
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  if (retryBtn) { retryBtn.disabled = true; }
  if (forceBtn) { forceBtn.disabled = true; forceBtn.textContent = 'Sending…'; }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/post-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        author_name: getForumIdentityName() || name,
        device_id: getForumDeviceId(),
        device_secret: getForumDeviceSecret(),
        body,
        scope,
        problem_key,
        force_latex: !!opts.forceLatex,
        reply_to_id: replySnapshot ? replySnapshot.id : null,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.ok === false) {
      forumRevertOptimisticSend(tempId, body);
      if (data && data.code === 'latex_assist_failed') {
        statusEl.textContent = 'Couldn\'t convert your LaTeX shorthand — try again, or post as-is.';
        statusEl.classList.add('forum-composer-status-error');
        setLatexAssistFailedUI(true);
      } else if (data && data.code === 'banned') {
        applyForumBanUI(data.banned_until);
        statusEl.textContent = `You're banned from posting. Time left: ${forumBanRemainingText(new Date(data.banned_until).getTime())}`;
        statusEl.classList.add('forum-composer-status-error');
      } else {
        statusEl.textContent = (data && data.error) || "Couldn't send — try again.";
        statusEl.classList.add('forum-composer-status-error');
      }
      return;
    }

    setLatexAssistFailedUI(false);
    cancelForumReply();

    if (!getForumNickname()) saveForumName(name);
    statusEl.textContent = 'Sent.';

    // Swap the placeholder for the real row, in place — see
    // forumResolveOptimisticSend for why this doesn't touch anything else
    // in the list — and re-sync "last seen" so this message you just
    // posted (and are looking at) doesn't get counted as unread if you
    // head back to the main screen a moment later.
    forumResolveOptimisticSend(tempId, data.message, replySnapshot);
    markForumAsRead();

    // Gemini's reply (if this message tagged it) is generated by the Edge
    // Function as a background task *after* this response already came back
    // — see post-message.ts — so it won't be in the feed yet. No special
    // handling needed here: the general live-poll (startForumLivePolling,
    // running the whole time the forum screen is open) checks for new
    // messages every few seconds regardless of cause, so it picks up
    // Gemini's reply the same way it picks up anyone else's new post.

    // If this send just claimed a brand-new nickname, show the one-time PIN
    // now that the message itself is safely out.
    if (forumPendingPinToShow) {
      const pinToShow = forumPendingPinToShow;
      forumPendingPinToShow = null;
      openForumPinModal(pinToShow, { justClaimed: true });
    }
  } catch (err) {
    console.error('Forum post error:', err);
    forumRevertOptimisticSend(tempId, body);
    statusEl.textContent = "Couldn't reach the forum, check your connection.";
    statusEl.classList.add('forum-composer-status-error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    if (retryBtn) { retryBtn.disabled = false; retryBtn.textContent = '↻'; }
    if (forceBtn) { forceBtn.disabled = false; forceBtn.textContent = 'Post as is'; }
  }
}
let forumPendingPinToShow = null;

// ── Composer: nickname claim / restore / create modal ────────────────────────
// mode 'create':  no nickname claimed on this device yet and nothing to
//                 restore — used by the quiz-start identity gate
//                 (js/quiz-engine.js) and available to the composer too.
//                 Nickname field starts empty/editable, PIN field is
//                 hidden entirely (a brand-new claim doesn't need one —
//                 the server generates it). Falls through to 'verify'
//                 in-place if the name turns out to already be taken.
// mode 'restore': person explicitly says they already own a nickname
//                 (typically on a new device) — both fields editable.
// mode 'verify':  a 'create' attempt (or the composer's own auto-claim)
//                 hit a name already taken by someone else — nickname is
//                 locked to what they typed, only the PIN is needed.
// mode 'rename':  used by the Forum & Site stats panel's pencil/edit button
//                 (js/stats.js openSfpNicknameEditor) when this device
//                 already has a claimed nickname — both fields editable,
//                 prefilled with the current name, PIN still required (see
//                 the mode's own comment below for why).
//
// onSuccess (optional) runs once a nickname is confirmed claimed/restored,
// instead of the modal hardcoding what "resuming" means — the composer
// passes () => submitForumMessage() to finish a send that was waiting on a
// name, the quiz-start gate passes () => actually starting the quiz. If
// omitted, closing the modal is the only effect (e.g. the "Already claimed
// a nickname on another device?" link, which isn't resuming anything).
// ── Composer: "Getting Started!" screen ──────────────────────────────────────
// Shown once before openForumClaimModal('create', ...) — see startSelected()
// in js/quiz-engine.js, the only caller. Purely informational (what a
// nickname is/why it's needed, an FAQ) so a person doesn't hit a bare
// "enter a nickname" field with zero context the very first time they open
// the app. gettingStartedOnNext holds what to do once they tap Start here —
// same handoff pattern as forumClaimModalOnSuccess above.
let gettingStartedOnNext = null;

function openGettingStartedModal(onNext) {
  gettingStartedOnNext = onNext || null;
  document.getElementById('gettingStartedModalBackdrop')?.classList.add('visible');
}

function closeGettingStartedModal() {
  document.getElementById('gettingStartedModalBackdrop')?.classList.remove('visible');
  gettingStartedOnNext = null;
}

function proceedFromGettingStarted() {
  const onNext = gettingStartedOnNext;
  gettingStartedOnNext = null;
  document.getElementById('gettingStartedModalBackdrop')?.classList.remove('visible');
  if (onNext) onNext();
}

// Simple single-open accordion for the FAQ list — expanding one item
// collapses whichever else was open, so the modal doesn't grow to fill the
// screen with every answer visible at once.
function toggleGsFaq(btn) {
  const item = btn.closest('.gs-faq-item');
  if (!item) return;
  const wasOpen = item.classList.contains('open');
  item.parentElement.querySelectorAll('.gs-faq-item.open').forEach(el => el.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

let forumClaimModalMode = 'restore';
let forumClaimModalOnSuccess = null;

function openForumClaimModal(mode, prefillNickname, onSuccess) {
  forumClaimModalMode = mode;
  forumClaimModalOnSuccess = onSuccess || null;
  const backdrop  = document.getElementById('forumClaimModalBackdrop');
  const title     = document.getElementById('forumClaimModalTitle');
  const desc      = document.getElementById('forumClaimModalDesc');
  const nickInput = document.getElementById('forumClaimNicknameInput');
  const pinRow    = document.getElementById('forumClaimPinRow');
  const pinInput  = document.getElementById('forumClaimPinInput');
  const statusEl  = document.getElementById('forumClaimModalStatus');
  const restoreLink = document.getElementById('forumClaimModalRestoreLink');
  if (!backdrop) return;

  if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('forum-composer-status-error'); }
  if (pinInput) pinInput.value = '';
  if (restoreLink) restoreLink.style.display = mode === 'create' ? '' : 'none';

  if (mode === 'create') {
    if (title) title.textContent = 'Choose a name';
    if (desc) desc.textContent = 'This is how attempts and forum posts are labeled, and lets your stats sync to your other devices.';
    if (nickInput) { nickInput.value = ''; nickInput.disabled = false; }
    if (pinRow) pinRow.style.display = 'none';
  } else if (mode === 'verify') {
    if (title) title.textContent = 'That name is taken';
    if (desc) desc.textContent = `"${prefillNickname}" is already claimed. Enter its PIN to use it here, or cancel and pick a different name.`;
    if (nickInput) { nickInput.value = prefillNickname || ''; nickInput.disabled = true; }
    if (pinRow) pinRow.style.display = '';
  } else if (mode === 'rename') {
    // Renaming your own already-linked identity — server-side this is
    // claim-nickname.ts's Case 3 (RENAME), which still requires the
    // identity's PIN even though this device already owns it (same
    // anti-tampering reasoning as verify/restore below): being logged in
    // on this device isn't by itself proof you're the one who should be
    // allowed to change the name everyone else's past messages show too.
    if (title) title.textContent = 'Rename';
    if (desc) desc.textContent = 'Enter a new name and your PIN to confirm.';
    if (nickInput) { nickInput.value = prefillNickname || ''; nickInput.disabled = false; }
    if (pinRow) pinRow.style.display = '';
  } else {
    if (title) title.textContent = 'Restore your nickname';
    if (desc) desc.textContent = 'Enter the nickname and the 5-digit PIN you saved when you first claimed it.';
    // Prefill with whatever the person already typed elsewhere (the main
    // composer's name field, or the create-modal's nickname field when this
    // is reached via its own restore link below) so they don't have to type
    // the same name twice.
    if (nickInput) { nickInput.value = prefillNickname || ''; nickInput.disabled = false; }
    if (pinRow) pinRow.style.display = '';
  }

  backdrop.classList.add('visible');
  setTimeout(() => (mode !== 'create' ? pinInput : nickInput)?.focus(), 50);
}

function closeForumClaimModal() {
  document.getElementById('forumClaimModalBackdrop')?.classList.remove('visible');
  forumClaimModalOnSuccess = null;
}

async function submitForumClaimModal() {
  const nickInput = document.getElementById('forumClaimNicknameInput');
  const pinInput  = document.getElementById('forumClaimPinInput');
  const statusEl  = document.getElementById('forumClaimModalStatus');
  if (!nickInput || !pinInput || !statusEl) return;

  const isCreate = forumClaimModalMode === 'create';
  const nickname = nickInput.value.trim();
  const pin = isCreate ? '' : pinInput.value.trim();

  statusEl.textContent = '';
  statusEl.classList.remove('forum-composer-status-error');

  if (!nickname) {
    statusEl.textContent = 'Enter a name.';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }
  if (!isCreate && !/^\d{5}$/.test(pin)) {
    statusEl.textContent = 'PIN must be exactly 5 digits.';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }

  statusEl.textContent = 'Checking…';

  try {
    const { data } = await callForumClaimNickname(nickname, isCreate ? undefined : pin);
    if (data && data.ok) {
      // data.pin only comes back on a brand-new claim (isCreate, or a
      // 'create' that happened to land on 'verify' — either way the server
      // tells us via data.created, not the mode) — for 'restore'/'verify'
      // the PIN was already typed in, use that instead since the server
      // doesn't echo it back on those paths.
      saveForumIdentity(data.nickname, data.created ? (data.pin || null) : pin);
      refreshForumIdentityUI();
      const onSuccess = forumClaimModalOnSuccess;
      closeForumClaimModal();
      if (data.created && data.pin) {
        // Show the PIN once, right now — it's the only time the server
        // ever hands it back. If onSuccess needs to happen too (e.g.
        // resuming a quiz start or a forum send), run it after the PIN
        // modal is dismissed rather than racing it on screen at once.
        openForumPinModal(data.pin, { andThen: onSuccess });
      } else if (onSuccess) {
        onSuccess();
      }
    } else if (data && data.error === 'taken') {
      // A 'create' attempt landing on an already-claimed name — fall
      // through into 'verify' in place (same modal, same onSuccess),
      // exactly like the composer's own auto-claim-on-send does.
      openForumClaimModal('verify', nickname, forumClaimModalOnSuccess);
    } else if (data && data.error === 'wrong_pin') {
      statusEl.textContent = 'Incorrect PIN.';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'locked') {
      statusEl.textContent = 'Too many wrong attempts — try again in a bit.';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'invalid_nickname') {
      statusEl.textContent = 'Names can only use letters, numbers, and . _ - (no spaces).';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'flagged_nickname') {
      statusEl.textContent = "That name isn't allowed — try something else.";
      statusEl.classList.add('forum-composer-status-error');
    } else {
      statusEl.textContent = "Couldn't verify — try again.";
      statusEl.classList.add('forum-composer-status-error');
    }
  } catch (err) {
    console.error('Forum claim error:', err);
    statusEl.textContent = "Couldn't reach the forum, check your connection.";
    statusEl.classList.add('forum-composer-status-error');
  }
}

// ── Composer: show-PIN modal ─────────────────────────────────────────────────
// With no argument, shows the PIN already saved locally (the "PIN" button on
// the claimed-identity bar). Passed a PIN directly right after a fresh claim
// (see submitForumMessage / submitForumClaimModal), since that's the one and
// only time the server hands it back — it can't be retrieved from the server
// again after this. opts.andThen (optional) runs once the person dismisses
// this modal — used to resume whatever was waiting on a name (a forum send,
// or the quiz-start gate) without racing it against the PIN still being on
// screen for them to actually read and save.
let forumPinModalAndThen = null;

function openForumPinModal(pinOverride, opts) {
  const backdrop = document.getElementById('forumPinModalBackdrop');
  const display   = document.getElementById('forumPinModalDisplay');
  if (!backdrop) return;
  const pin = pinOverride || getForumPin();
  if (display) display.textContent = pin || '—';
  forumPinModalAndThen = (opts && opts.andThen) || null;
  backdrop.classList.add('visible');
}
function closeForumPinModal() {
  document.getElementById('forumPinModalBackdrop')?.classList.remove('visible');
  const andThen = forumPinModalAndThen;
  forumPinModalAndThen = null;
  if (andThen) andThen();
}

// ── Composer: change-nickname modal ──────────────────────────────────────────
function openForumChangeNicknameModal() {
  const backdrop  = document.getElementById('forumChangeNicknameModalBackdrop');
  const input     = document.getElementById('forumChangeNicknameInput');
  const statusEl  = document.getElementById('forumChangeNicknameStatus');
  if (!backdrop) return;
  if (input) input.value = '';
  if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('forum-composer-status-error'); }
  backdrop.classList.add('visible');
  setTimeout(() => input?.focus(), 50);
}
function closeForumChangeNicknameModal() {
  document.getElementById('forumChangeNicknameModalBackdrop')?.classList.remove('visible');
}
async function submitForumChangeNickname() {
  const input    = document.getElementById('forumChangeNicknameInput');
  const statusEl = document.getElementById('forumChangeNicknameStatus');
  if (!input || !statusEl) return;

  const newNickname = input.value.trim();
  statusEl.textContent = '';
  statusEl.classList.remove('forum-composer-status-error');

  if (!newNickname) {
    statusEl.textContent = 'Enter a new nickname.';
    statusEl.classList.add('forum-composer-status-error');
    return;
  }

  statusEl.textContent = 'Saving…';
  try {
    const { data } = await callForumClaimNickname(newNickname, getForumPin());
    if (data && data.ok) {
      saveForumIdentity(data.nickname, getForumPin());
      refreshForumIdentityUI();
      closeForumChangeNicknameModal();
      // Every message this identity ever posted just changed author_name
      // (and got a re-seeded avatar_svg) server-side — forumLiveTick's next
      // tick would eventually pick that up (see the check added there), but
      // that's up to FORUM_LIVE_POLL_MS away and only runs at all while the
      // forum screen is open. Force it now instead of leaving your own just-
      // renamed messages showing the old name/avatar until that tick fires.
      if (forumScreenOpen) loadForumInitial();
    } else if (data && data.error === 'taken') {
      statusEl.textContent = 'That nickname is already taken.';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'wrong_pin') {
      // Shouldn't normally happen (PIN is read from local storage), but
      // could mean local storage got out of sync with the server.
      statusEl.textContent = "Your saved PIN doesn't match — try dropping and re-claiming instead.";
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'locked') {
      statusEl.textContent = 'Too many attempts — try again in a bit.';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'invalid_nickname') {
      statusEl.textContent = 'Nicknames can only use letters, numbers, and . _ - (no spaces).';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'flagged_nickname') {
      statusEl.textContent = "That nickname isn't allowed — try something else.";
      statusEl.classList.add('forum-composer-status-error');
    } else {
      statusEl.textContent = "Couldn't save — try again.";
      statusEl.classList.add('forum-composer-status-error');
    }
  } catch (err) {
    console.error('Forum rename error:', err);
    statusEl.textContent = "Couldn't reach the forum, check your connection.";
    statusEl.classList.add('forum-composer-status-error');
  }
}

// ── Composer: exit-this-device modal ─────────────────────────────────────────
// Only unlinks THIS device from the nickname — the nickname stays claimed,
// your PIN keeps working, and any other device already linked to it
// (phone/tablet/PC) is completely unaffected. No PIN needed to confirm,
// since exiting can only ever affect the device asking for it, same as
// signing out doesn't need your password on top of already being logged
// in. Coming back later is just the "Already claimed a nickname on another
// device?" flow with the nickname + PIN again — so the confirmation copy
// reminds the person to have their PIN handy before they exit, since
// that's the only way back in.
function openForumExitDeviceModal() {
  const backdrop = document.getElementById('forumExitDeviceModalBackdrop');
  const nameEl   = document.getElementById('forumExitDeviceName');
  const statusEl = document.getElementById('forumExitDeviceStatus');
  if (!backdrop) return;
  if (nameEl) nameEl.textContent = `"${getForumNickname()}"`;
  if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('forum-composer-status-error'); }
  backdrop.classList.add('visible');
}
function closeForumExitDeviceModal() {
  document.getElementById('forumExitDeviceModalBackdrop')?.classList.remove('visible');
}
async function submitForumExitDevice() {
  const statusEl = document.getElementById('forumExitDeviceStatus');
  if (!statusEl) return;

  statusEl.textContent = 'Exiting…';
  statusEl.classList.remove('forum-composer-status-error');
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/drop-nickname`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ device_id: getForumDeviceId(), device_secret: getForumDeviceSecret(), action: 'exit' }),
    });
    const data = await res.json().catch(() => null);

    if (data && data.ok) {
      const oldNickname = getForumNickname();
      clearForumIdentity();
      saveForumName(oldNickname); // land back in the free-text field, still editable
      // The exited nickname's synced quiz/solve-all data belongs to it, not
      // this device — leaving it in local cache would show a "signed out"
      // device that's still displaying someone's full attempt log.
      if (typeof clearLocalAttemptsCache === 'function') clearLocalAttemptsCache();
      if (typeof clearLocalSolveAllProgress === 'function') clearLocalSolveAllProgress();
      refreshForumIdentityUI();
      closeForumExitDeviceModal();
    } else if (data && data.error === 'not_found') {
      // Already unlinked (e.g. exited from another tab) — treat as success.
      clearForumIdentity();
      if (typeof clearLocalAttemptsCache === 'function') clearLocalAttemptsCache();
      if (typeof clearLocalSolveAllProgress === 'function') clearLocalSolveAllProgress();
      refreshForumIdentityUI();
      closeForumExitDeviceModal();
    } else {
      statusEl.textContent = "Couldn't exit — try again.";
      statusEl.classList.add('forum-composer-status-error');
    }
  } catch (err) {
    console.error('Forum exit-device error:', err);
    statusEl.textContent = "Couldn't reach the forum, check your connection.";
    statusEl.classList.add('forum-composer-status-error');
  }
}

// ── Composer: edit-message modal ─────────────────────────────────────────────
// Opened from the ✎ button on a message (renderForumMessage above), which
// only ever shows for this device's own, non-deleted messages — so no
// ownership check is needed client-side, though edit-message.ts still
// re-checks device_id server-side regardless (never trust the client for
// something a person could otherwise use to edit someone else's post).
function openForumEditMessageModal(msg) {
  const backdrop  = document.getElementById('forumEditMessageModalBackdrop');
  const bodyInput = document.getElementById('forumEditBodyInput');
  const statusEl  = document.getElementById('forumEditMessageStatus');
  const quizSel   = document.getElementById('forumEditQuizSelect');
  const probSel   = document.getElementById('forumEditProblemSelect');
  if (!backdrop || !bodyInput || !quizSel || !probSel) return;

  forumEditMessageId = msg.id;
  forumEditOrigBody  = msg.body;

  if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('forum-composer-status-error'); }
  bodyInput.value = msg.body;

  // Parse the message's current scope/problem_key back into quiz+problem
  // values, same shape buildForumScopePayload() produces the other way —
  // see forumTagInfo() above for the same "qN_..." pattern parsed for
  // display.
  if (msg.scope === 'problem' && msg.problem_key) {
    const m = /^q(\d+)_(.+)$/i.exec(msg.problem_key);
    forumEditQuiz      = m ? `q${m[1]}` : 'global';
    forumEditProblemId = (m && m[2].toLowerCase() !== 'general') ? m[2] : '';
  } else {
    forumEditQuiz      = 'global';
    forumEditProblemId = '';
  }

  populateForumComposerQuizSelect('forumEditQuizSelect');
  quizSel.value = forumEditQuiz;
  if (forumEditQuiz === 'global') {
    probSel.style.display = 'none';
    probSel.innerHTML = '';
  } else {
    populateForumComposerProblemSelect(forumEditQuiz, 'forumEditProblemSelect');
    probSel.value = forumEditProblemId;
    probSel.style.display = '';
  }

  backdrop.classList.add('visible');
  setTimeout(() => bodyInput.focus(), 50);
}
function closeForumEditMessageModal() {
  document.getElementById('forumEditMessageModalBackdrop')?.classList.remove('visible');
  forumEditMessageId = null;
}
function onForumEditQuizChange() {
  const quizSel = document.getElementById('forumEditQuizSelect');
  const probSel = document.getElementById('forumEditProblemSelect');
  if (!quizSel || !probSel) return;

  forumEditQuiz = quizSel.value;
  forumEditProblemId = '';

  if (forumEditQuiz === 'global') {
    probSel.style.display = 'none';
    probSel.innerHTML = '';
  } else {
    populateForumComposerProblemSelect(forumEditQuiz, 'forumEditProblemSelect');
    probSel.style.display = '';
  }
}
function onForumEditProblemChange() {
  const probSel = document.getElementById('forumEditProblemSelect');
  if (probSel) forumEditProblemId = probSel.value;
}

async function submitForumEditMessage() {
  const bodyInput = document.getElementById('forumEditBodyInput');
  const statusEl  = document.getElementById('forumEditMessageStatus');
  if (!bodyInput || !statusEl || forumEditMessageId == null) return;

  const newBody = bodyInput.value.trim();
  statusEl.textContent = '';
  statusEl.classList.remove('forum-composer-status-error');

  if (!newBody) {
    statusEl.textContent = "Message can't be empty.";
    statusEl.classList.add('forum-composer-status-error');
    return;
  }

  // Only send the pieces that actually changed — a topic-only edit
  // shouldn't send `body` at all (see edit-message.ts: sending `body`
  // always re-runs moderation, even if it happens to equal the old text).
  const payload = { device_id: getForumDeviceId(), device_secret: getForumDeviceSecret(), message_id: forumEditMessageId };
  if (newBody !== forumEditOrigBody) payload.body = newBody;
  if (forumEditQuiz === 'global') {
    payload.scope = 'global';
    payload.problem_key = null;
  } else {
    const quizNum = forumEditQuiz.replace('q', '');
    payload.scope = 'problem';
    payload.problem_key = forumEditProblemId ? `q${quizNum}_${forumEditProblemId}` : `q${quizNum}_general`;
  }

  statusEl.textContent = 'Saving…';
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/edit-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (data && data.ok) {
      closeForumEditMessageModal();
      loadForumInitial(); // picks up the new body/scope/flag_status right away
    } else if (data && data.error === 'flagged_body') {
      statusEl.textContent = "That wording isn't allowed — try rephrasing.";
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'deleted') {
      statusEl.textContent = 'This message was removed and can no longer be edited.';
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'not_your_message') {
      statusEl.textContent = "This message isn't yours to edit.";
      statusEl.classList.add('forum-composer-status-error');
    } else if (data && data.error === 'not_found') {
      statusEl.textContent = "Couldn't find this message anymore.";
      statusEl.classList.add('forum-composer-status-error');
    } else {
      statusEl.textContent = "Couldn't save — try again.";
      statusEl.classList.add('forum-composer-status-error');
    }
  } catch (err) {
    console.error('Forum edit-message error:', err);
    statusEl.textContent = "Couldn't reach the forum, check your connection.";
    statusEl.classList.add('forum-composer-status-error');
  }
}

// ── Composer: insert-equation modal ──────────────────────────────────────────
// The textarea already supports typing $...$ / \(...\) directly (rendered
// once the message posts — see renderForumMessage). This modal is just a
// helper for building that LaTeX without having to remember the delimiters:
// type raw code up top, see it typeset live at the bottom, then it gets
// wrapped in $...$ (or $$...$$ for "own line") and dropped into the message
// box at wherever the cursor was.
let forumEqCaretPos      = null;
let forumEqPreviewTimer  = null;

function openForumEquationModal() {
  const backdrop = document.getElementById('forumEqModalBackdrop');
  const bodyInput = document.getElementById('forumBodyInput');
  const eqInput   = document.getElementById('forumEqInput');
  const toggle    = document.getElementById('forumEqDisplayToggle');
  const preview   = document.getElementById('forumEqPreview');
  if (!backdrop) return;

  // Remember where in the message box to insert the result later.
  forumEqCaretPos = bodyInput ? bodyInput.selectionStart : null;

  if (eqInput) eqInput.value = '';
  if (toggle) toggle.checked = false;
  if (preview) preview.textContent = '—';

  backdrop.classList.add('visible');
  if (eqInput) setTimeout(() => eqInput.focus(), 50);
}

function closeForumEquationModal() {
  const backdrop = document.getElementById('forumEqModalBackdrop');
  if (backdrop) backdrop.classList.remove('visible');
  clearTimeout(forumEqPreviewTimer);
}

// Debounced so rapid typing doesn't trigger a MathJax pass every keystroke.
function updateForumEquationPreview() {
  clearTimeout(forumEqPreviewTimer);
  forumEqPreviewTimer = setTimeout(renderForumEquationPreviewNow, 150);
}

function renderForumEquationPreviewNow() {
  const eqInput = document.getElementById('forumEqInput');
  const toggle  = document.getElementById('forumEqDisplayToggle');
  const preview = document.getElementById('forumEqPreview');
  if (!eqInput || !preview) return;

  const code = eqInput.value.trim();
  if (!code) {
    preview.textContent = '—';
    return;
  }
  const isDisplay = !!(toggle && toggle.checked);
  preview.textContent = isDisplay ? `$$${code}$$` : `$${code}$`;
  renderMathIn(preview);
}

function insertForumEquation() {
  const eqInput   = document.getElementById('forumEqInput');
  const toggle    = document.getElementById('forumEqDisplayToggle');
  const bodyInput = document.getElementById('forumBodyInput');
  if (!eqInput || !bodyInput) return;

  const code = eqInput.value.trim();
  if (!code) { closeForumEquationModal(); return; }

  const wrapped = toggle && toggle.checked ? `$$${code}$$` : `$${code}$`;
  const pos     = forumEqCaretPos != null ? forumEqCaretPos : bodyInput.value.length;
  const before  = bodyInput.value.slice(0, pos);
  const after   = bodyInput.value.slice(pos);

  bodyInput.value = before + wrapped + after;
  rebuildForumBodyMirror();
  closeForumEquationModal();

  bodyInput.focus();
  const newPos = pos + wrapped.length;
  bodyInput.setSelectionRange(newPos, newPos);
}

// ── Composer: quick-insert grid inside the equation modal ───────────────────
// "Calculator button" shortcuts for common LaTeX — each inserts a template
// into #forumEqInput at the caret and, where the template has a literal "x"
// placeholder, selects it immediately so typing overwrites it in place
// (same convenience pattern graphing-calculator apps use for function keys).
const FORUM_EQ_QUICK_INSERTS = [
  // ── Functions (argument-taking or operator symbols) ──
  { label: '\\sin(x)',     insert: '\\sin{\\left(x\\right)}' },
  { label: '\\cos(x)',     insert: '\\cos{\\left(x\\right)}' },
  { label: '\\tan(x)',     insert: '\\tan{\\left(x\\right)}' },
  { label: '\\cot(x)',     insert: '\\cot{\\left(x\\right)}' },
  { label: '\\arcsin(x)',  insert: '\\arcsin{\\left(x\\right)}' },
  { label: '\\frac{a}{b}', insert: '\\frac{x}{y}' },
  { label: 'e^{x}',        insert: '\\exp{\\left(x\\right)}' },
  { label: '\\sqrt{x}',    insert: '\\sqrt{x}' },
  { label: '\\cdot',       insert: '\\cdot ' },
  { label: '\\times',      insert: '\\times ' },
  { label: '\\int',        insert: '\\int_{a}^{b} {x} \\mathrm{d}{x}' },
  { label: '\\sum',        insert: '\\sum_{i=1}^{n} {x}' },
  { label: '\\log(x)',     insert: '\\log{\\left(x\\right)}' },
  // ── Greek letters (plain symbols, no argument) ──
  { label: '\\pi',           insert: '\\pi ' },
  { label: '\\phi',          insert: '\\phi ' },
  { label: '\\theta',        insert: '\\theta ' },
  { label: '\\varepsilon',   insert: '\\varepsilon ' },
  { label: '\\tau',          insert: '\\tau ' },
  { label: '\\delta',        insert: '\\delta ' },
  { label: '\\rho',          insert: '\\rho ' },
];

// Only devices with an actual mouse-like hover+precise pointer get the
// native `title` tooltip on these buttons. On touch/mobile, Chrome/Safari's
// built-in title tooltip renders as a full-width bar pinned to the top of
// the viewport on tap-and-hold — jarring and disconnected from the button
// itself — so we skip setting `title` there entirely rather than fight the
// browser's own accessibility tooltip placement. Evaluated once since a
// device's pointer type doesn't change mid-session.
const FORUM_EQ_SUPPORTS_HOVER_TITLE =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// `label` is a short representative LaTeX snippet for the button face —
// deliberately not always the same as `insert` (e.g. \int's button just
// shows "∫" typeset, not the full bounds-and-dx template it inserts).
// Built once and typeset with a single MathJax.typesetPromise over the
// whole grid, rather than one call per button.
function renderForumEqQuickGrid() {
  const grid = document.getElementById('forumEqQuickGrid');
  if (!grid) return;
  grid.innerHTML = '';
  FORUM_EQ_QUICK_INSERTS.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'forum-eq-quick-btn';
    if (FORUM_EQ_SUPPORTS_HOVER_TITLE) btn.title = item.insert.trim();
    btn.textContent = `$${item.label}$`;
    btn.addEventListener('click', () => insertForumEqSnippet(item.insert));
    grid.appendChild(btn);
  });
  renderMathIn(grid);
}

function insertForumEqSnippet(snippetText) {
  const eqInput = document.getElementById('forumEqInput');
  if (!eqInput) return;

  const start  = eqInput.selectionStart ?? eqInput.value.length;
  const end    = eqInput.selectionEnd ?? start;
  const before = eqInput.value.slice(0, start);
  const after  = eqInput.value.slice(end);

  eqInput.value = before + snippetText + after;

  // Select the first "x" placeholder in what we just inserted so typing
  // replaces it immediately; templates with no "x" (·, ×) just place the
  // caret after the insert instead.
  const placeholderIdx = snippetText.indexOf('x');
  let selStart, selEnd;
  if (placeholderIdx !== -1) {
    selStart = start + placeholderIdx;
    selEnd   = selStart + 1;
  } else {
    selStart = selEnd = start + snippetText.length;
  }

  eqInput.focus();
  eqInput.setSelectionRange(selStart, selEnd);
  updateForumEquationPreview();
}

// ── Composer: hover preview for $...$ / $$...$$ typed directly ─────────────
// The textarea itself stays a plain, fully-functional <textarea> — typing,
// selection, and clicking are never intercepted. An invisible "mirror" div
// sits on top (same font/padding/scroll position, pointer-events:none) purely
// so mousemove positions can be hit-tested against it; this code does its own
// rect-based hit-testing rather than relying on the mirror to receive events.
// Because it's a <div> standing in for a <textarea>'s wrapping, this is an
// approximation — line-wrap edges may be off by a few pixels in some browsers.
let forumBodyRegions     = [];   // [{start, end, code, display}] for the current textarea value
let forumHoverRegionIdx  = null; // index into forumBodyRegions currently shown (via hover OR auto-flash)
let forumRealMouseOverIdx = null; // index the mouse is *actually* sitting over right now, updated on every
                                   // mousemove independent of anything else — this is what the auto-flash
                                   // timeout checks before hiding, so it never yanks the preview away while
                                   // someone is genuinely hovering it.
let forumAutoPreviewTimer = null;

function escapeHtmlForForumMirror(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Finds already-closed, non-overlapping $$...$$ and $...$ pairs. $$ is
// matched first so "$$x$$" isn't mistaken for a pair of "$...$" matches.
function parseForumEquationRegions(text) {
  const regions = [];
  const claimed = [];

  const displayRe = /\$\$([^$]+?)\$\$/g;
  let m;
  while ((m = displayRe.exec(text))) {
    regions.push({ start: m.index, end: m.index + m[0].length, code: m[1].trim(), display: true });
    claimed.push([m.index, m.index + m[0].length]);
  }

  const inlineRe = /\$([^$\n]+?)\$/g;
  while ((m = inlineRe.exec(text))) {
    const start = m.index, end = m.index + m[0].length;
    if (!claimed.some(([cs, ce]) => start < ce && end > cs)) {
      regions.push({ start, end, code: m[1].trim(), display: false });
    }
  }

  regions.sort((a, b) => a.start - b.start);
  return regions;
}

function rebuildForumBodyMirror() {
  const bodyInput = document.getElementById('forumBodyInput');
  const mirror    = document.getElementById('forumBodyMirror');
  if (!bodyInput || !mirror) return;

  const text = bodyInput.value;
  forumBodyRegions = parseForumEquationRegions(text);
  hideForumEqHoverPreview();

  let html = '';
  let cursor = 0;
  forumBodyRegions.forEach((region, idx) => {
    html += escapeHtmlForForumMirror(text.slice(cursor, region.start));
    html += `<span class="forum-eq-region" data-region-idx="${idx}">${escapeHtmlForForumMirror(text.slice(region.start, region.end))}</span>`;
    cursor = region.end;
  });
  html += escapeHtmlForForumMirror(text.slice(cursor));
  mirror.innerHTML = html;
}

// Rendered fresh every time it's shown (no caching) — same as everywhere
// else LaTeX shows up in the forum.
function showForumEqHoverPreview(region, clientX, clientY) {
  const preview = document.getElementById('forumEqHoverPreview');
  if (!preview) return;

  preview.textContent = region.display ? `$$${region.code}$$` : `$${region.code}$`;
  renderMathIn(preview);
  preview.classList.add('visible');

  requestAnimationFrame(() => {
    const rect = preview.getBoundingClientRect();
    let left = clientX - rect.width / 2;
    let top  = clientY - rect.height - 14;
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    if (top < 8) top = clientY + 18;
    preview.style.left = `${left}px`;
    preview.style.top  = `${top}px`;
  });
}

function hideForumEqHoverPreview() {
  const preview = document.getElementById('forumEqHoverPreview');
  if (preview) preview.classList.remove('visible');
  forumHoverRegionIdx = null;
}

function onForumBodyMouseMove(e) {
  const mirror    = document.getElementById('forumBodyMirror');
  const bodyInput = document.getElementById('forumBodyInput');
  if (!mirror || !bodyInput || forumBodyRegions.length === 0) return;

  let hit = null;
  const spans = mirror.querySelectorAll('.forum-eq-region');
  for (const span of spans) {
    for (const r of span.getClientRects()) {
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        hit = parseInt(span.dataset.regionIdx, 10);
        break;
      }
    }
    if (hit !== null) break;
  }

  if (hit !== null) {
    bodyInput.style.cursor = 'help';
    forumRealMouseOverIdx = hit;
    if (hit !== forumHoverRegionIdx) {
      forumHoverRegionIdx = hit;
      showForumEqHoverPreview(forumBodyRegions[hit], e.clientX, e.clientY);
    }
  } else {
    bodyInput.style.cursor = '';
    forumRealMouseOverIdx = null;
    if (forumHoverRegionIdx !== null) hideForumEqHoverPreview();
  }
}

// Discoverability aid: the hover-preview feature is easy to never stumble
// onto by accident, so every time an edit leaves the caret inside a
// completed $...$/$$...$$ region, flash that region's preview for 2 seconds
// even without the mouse touching it — same preview, just triggered by
// typing instead of hovering. If the mouse genuinely is hovering the region
// when the 2s is up, this defers to that instead of hiding it out from
// under someone actively looking at it.
function maybeAutoShowForumEqPreview() {
  const mirror = document.getElementById('forumBodyMirror');
  const bodyInput = document.getElementById('forumBodyInput');
  if (!mirror || !bodyInput || forumBodyRegions.length === 0) return;

  const caret = bodyInput.selectionStart;
  const idx = forumBodyRegions.findIndex(r => caret >= r.start && caret <= r.end);
  if (idx === -1) return;

  const span = mirror.querySelector(`.forum-eq-region[data-region-idx="${idx}"]`);
  if (!span) return;
  const rect = span.getBoundingClientRect();

  forumHoverRegionIdx = idx;
  showForumEqHoverPreview(forumBodyRegions[idx], rect.left + rect.width / 2, rect.top);

  clearTimeout(forumAutoPreviewTimer);
  forumAutoPreviewTimer = setTimeout(() => {
    if (forumRealMouseOverIdx !== idx) hideForumEqHoverPreview();
  }, 2000);
}

// ── Composer: @mention autocomplete ─────────────────────────────────────────
// Typing "@" opens a small suggestion list: "gemini" is always offered
// (pinned first, so it's reachable even in a brand-new thread with no other
// authors yet), plus the display names of people who've recently posted in
// the currently-viewed filter (most-recent-post first, de-duplicated,
// case-insensitively). Tab accepts the highlighted suggestion and completes
// it in full — that's the main ask (e.g. typing "@ge" + Tab fills in
// "@gemini "). Up/Down move the highlight, Enter also accepts, Escape or
// clicking/typing outside the @word closes it without inserting anything.
let forumMentionStart     = null; // index of "@" in the textarea value, or null when no mention is being typed
let forumMentionMatches   = [];
let forumMentionActiveIdx = 0;

// Recently-active authors in the filter currently being viewed, most recent
// first. Deliberately reuses forumMessageCache rather than a separate fetch
// — it's already the right "recently seen in this thread" data, and staying
// in sync with it for free means no extra network calls just for this.
function forumRecentMentionNames() {
  const seen = new Set();
  const names = [];
  const pool = forumMessageCache[forumCacheKey()] || [];
  for (const msg of pool) {
    if (msg.device_id === FORUM_GEMINI_BOT_DEVICE_ID) continue; // gemini is already offered, pinned first
    const key = msg.author_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(msg.author_name);
    if (names.length >= 8) break; // plenty for a short dropdown
  }
  return names;
}

// Re-evaluates whether the caret is currently inside an "@word" and, if so,
// (re)computes the match list. Called on every keystroke/caret move in the
// body textarea, same as the hover-preview's rebuild.
function updateForumMentionState() {
  const bodyInput = document.getElementById('forumBodyInput');
  if (!bodyInput) return;

  const caret = bodyInput.selectionStart;
  const text  = bodyInput.value;

  // Walk back from the caret to the start of the current whitespace-
  // delimited word. If that word starts with "@", the caret is mid-mention.
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const word = text.slice(start, caret);

  if (!word.startsWith('@') || word.length === 0) {
    closeForumMentionSuggest();
    return;
  }

  const query = word.slice(1).toLowerCase();
  const candidates = ['gemini', ...forumRecentMentionNames()];
  const seenNames = new Set();
  const matches = candidates.filter(name => {
    const key = name.toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return key.startsWith(query);
  }).slice(0, 6);

  if (matches.length === 0) {
    closeForumMentionSuggest();
    return;
  }

  forumMentionStart = start;
  forumMentionMatches = matches;
  forumMentionActiveIdx = 0;
  renderForumMentionSuggest();
}

function renderForumMentionSuggest() {
  const panel = document.getElementById('forumMentionSuggest');
  if (!panel) return;
  panel.innerHTML = '';
  forumMentionMatches.forEach((name, idx) => {
    const item = document.createElement('div');
    item.className = 'forum-mention-item' + (idx === forumMentionActiveIdx ? ' active' : '');
    item.textContent = '@' + name;
    // mousedown (not click) + preventDefault so the textarea never loses
    // focus/blurs before the selection is applied.
    item.addEventListener('mousedown', (e) => { e.preventDefault(); acceptForumMention(idx); });
    panel.appendChild(item);
  });
  panel.style.display = 'block';
}

function closeForumMentionSuggest() {
  forumMentionStart = null;
  forumMentionMatches = [];
  forumMentionActiveIdx = 0;
  const panel = document.getElementById('forumMentionSuggest');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
}

// Replaces the in-progress "@partial" word with the full "@name " and moves
// the caret just past it.
function acceptForumMention(idx) {
  const bodyInput = document.getElementById('forumBodyInput');
  if (!bodyInput || forumMentionStart === null || !forumMentionMatches[idx]) return;

  const name   = forumMentionMatches[idx];
  const caret  = bodyInput.selectionStart;
  const before = bodyInput.value.slice(0, forumMentionStart);
  const after  = bodyInput.value.slice(caret);
  const inserted = '@' + name + ' ';

  bodyInput.value = before + inserted + after;
  const newPos = before.length + inserted.length;
  bodyInput.focus();
  bodyInput.setSelectionRange(newPos, newPos);

  closeForumMentionSuggest();
  rebuildForumBodyMirror();
}

function onForumBodyKeydown(e) {
  if (forumMentionStart === null) return; // suggestions aren't open — don't intercept anything
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault();
    acceptForumMention(forumMentionActiveIdx);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    forumMentionActiveIdx = (forumMentionActiveIdx + 1) % forumMentionMatches.length;
    renderForumMentionSuggest();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    forumMentionActiveIdx = (forumMentionActiveIdx - 1 + forumMentionMatches.length) % forumMentionMatches.length;
    renderForumMentionSuggest();
  } else if (e.key === 'Escape') {
    closeForumMentionSuggest();
  }
}

function initForumBodyHoverPreview() {
  const bodyInput = document.getElementById('forumBodyInput');
  const mirror    = document.getElementById('forumBodyMirror');
  if (!bodyInput || !mirror) return;

  bodyInput.addEventListener('input', () => {
    rebuildForumBodyMirror();
    maybeAutoShowForumEqPreview();
    updateForumMentionState();
  });
  bodyInput.addEventListener('keydown', onForumBodyKeydown);
  bodyInput.addEventListener('scroll', () => { mirror.scrollTop = bodyInput.scrollTop; });
  bodyInput.addEventListener('mousemove', onForumBodyMouseMove);
  bodyInput.addEventListener('mouseleave', () => {
    bodyInput.style.cursor = '';
    forumRealMouseOverIdx = null;
    hideForumEqHoverPreview();
  });

  rebuildForumBodyMirror();
}

// ── Fetching ──────────────────────────────────────────────────────────────
// One page of the current filter's feed, newest-first.
// beforeId: when set, fetch messages older than this id ("load more" cursor).
async function fetchForumMessages(beforeId = null) {
  const client = getForumClient();
  if (!client) return { data: [], error: 'Forum is not configured.' };

  // forum_messages_public (sql/identities_schema.sql) resolves author_name
  // live from the poster's current claimed nickname, instead of the frozen
  // text stored on forum_messages at post time — so a rename shows up on
  // every past message immediately, with no bulk update needed.
  let query = client
    .from('forum_messages_public')
    .select('id, created_at, author_name, device_id, identity_id, body, scope, problem_key, flag_status, flag_reason, edited_at, avatar_svg, reply_to_id, reply_to_author_name, reply_to_body, reply_to_flag_status')
    .order('id', { ascending: false })
    .limit(FORUM_PAGE_SIZE);

  if (forumFilter === 'global') {
    query = query.eq('scope', 'global');
  } else if (forumFilter !== 'all') {
    query = query.eq('scope', 'problem');
    if (forumFilterProblemId === 'general') {
      query = query.eq('problem_key', `${forumFilter}_general`);
    } else if (forumFilterProblemId) {
      query = query.eq('problem_key', `${forumFilter}_${forumFilterProblemId}`);
    } else {
      query = query.like('problem_key', `${forumFilter}_%`);
    }
  }

  if (beforeId !== null) query = query.lt('id', beforeId);

  const { data, error } = await query;
  if (error) console.error('Forum fetch error:', error);
  return { data: data || [], error };
}

// Escapes Postgres ILIKE's own wildcard chars (% _) and its escape char (\)
// itself, so a literal "%" or "_" typed into the search box is matched as
// a literal character instead of being treated as a wildcard by the DB.
function escapeForumSearchTerm(term) {
  return term.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

// Unlike fetchForumMessages(), deliberately ignores forumFilter/
// forumFilterProblemId entirely — searches body text across every scope and
// every problem_key, per the ask ("no matter the filter"). Capped at
// FORUM_SEARCH_LIMIT with no "load more" — a simple result set, not another
// paginated feed.
async function fetchForumSearchResults(term) {
  const client = getForumClient();
  if (!client) return { data: [], error: 'Forum is not configured.' };

  const { data, error } = await client
    .from('forum_messages_public')
    .select('id, created_at, author_name, device_id, identity_id, body, scope, problem_key, flag_status, flag_reason, edited_at, avatar_svg, reply_to_id, reply_to_author_name, reply_to_body, reply_to_flag_status')
    .ilike('body', `%${escapeForumSearchTerm(term)}%`)
    .order('id', { ascending: false })
    .limit(FORUM_SEARCH_LIMIT);

  if (error) console.error('Forum search error:', error);
  return { data: data || [], error };
}

function formatForumTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

// Same as formatForumTime, but pads a single-digit hour with one extra
// leading space ("9:56" -> " 9:56") so the string is the same character
// count as a two-digit-hour one ("10:56"). Used only for the meta row's
// right-flushed timestamp, where the date sits directly against the
// flag/edit icon in a monospace font and needs to keep a stable width —
// everywhere else (tooltips, the mention-profile table) uses the
// unpadded formatForumTime.
function formatForumTimeAligned(iso) {
  return formatForumTime(iso).replace(/, (\d):/, ',  $1:');
}

// ── Mention profile popup ────────────────────────────────────────────────────
// Tapping an "@name" chip (see renderForumMessageBody) shows name, first-
// message date, and total message count for that name. Backed by a single
// Postgres RPC, `get_author_stats` (see sql/get_author_stats.sql — run once
// in the Supabase SQL Editor, not something that needs the Edge Functions
// dashboard). It's a plain SQL function, not SECURITY DEFINER, so it still
// runs under the same public SELECT RLS policy forum_messages already has
// (FORUM_PROJECT_NOTES.md §2) — no secret key or server-side trust needed,
// same as the two-query version this replaced, just one round trip instead
// of two.
//
// Caveat, since there are no accounts: this looks up author_name as free
// text (case-insensitively, via `ilike` inside the function), so it can only
// report on however that name has been typed by whoever posted under it — a
// name reused by two different people looks like one person here, same
// tradeoff the rest of the forum already accepts for identity.
// Tapping an "@name" chip (see renderForumMessageBody) shows their avatar,
// first-message date, last-message date, and total message count. Backed
// by a single Postgres RPC, `get_author_stats` (see the migration file
// referenced in superbase/migrations/ — run once in the Supabase SQL
// Editor, not something that needs the Edge Functions dashboard). It's a
// plain SQL function, not SECURITY DEFINER, so it still runs under the
// same public SELECT RLS policy forum_messages already has
// (FORUM_PROJECT_NOTES.md §2) — no secret key or server-side trust needed.
//
// Caveat, since there are no accounts: this looks up author_name as free
// text (case-insensitively, via `ilike` inside the function), so it can only
// report on however that name has been typed by whoever posted under it — a
// name reused by two different people looks like one person here, same
// tradeoff the rest of the forum already accepts for identity.
function openForumMentionProfile(name) {
  const backdrop = document.getElementById('forumMentionModalBackdrop');
  const nameEl   = document.getElementById('forumMentionModalName');
  const bodyEl   = document.getElementById('forumMentionModalBody');
  const avatarEl = document.getElementById('forumMentionModalAvatar');
  if (!backdrop || !nameEl || !bodyEl || !avatarEl) return;

  nameEl.textContent = '@' + name;
  bodyEl.textContent = 'Loading…';
  avatarEl.textContent = '';
  backdrop.classList.add('visible');
  loadForumMentionProfile(name, bodyEl, avatarEl);
}

function closeForumMentionProfile() {
  document.getElementById('forumMentionModalBackdrop')?.classList.remove('visible');
}

async function loadForumMentionProfile(name, bodyEl, avatarEl) {
  // Gemini is the bot sentinel, not a real poster (see FORUM_GEMINI_BOT_DEVICE_ID)
  // — always gets its own avatar and blurb rather than the generic
  // avatar/no-messages fallbacks below, but still runs the same
  // get_author_stats lookup as everyone else so its total message count
  // shows up too.
  const isGemini = name.toLowerCase() === 'gemini';
  if (isGemini) avatarEl.appendChild(forumGeminiAvatarEl());

  const client = getForumClient();
  if (!client) { bodyEl.textContent = "Couldn't load — try again."; return; }

  try {
    const { data, error } = await client.rpc('get_author_stats', { p_author_name: name });
    if (error) throw error;

    // The function always returns exactly one row (an aggregate over zero or
    // more matches), so "no messages" shows up as total_messages = 0 with a
    // null first_message_at, not as an empty result set.
    const row   = data && data[0];
    const count = row ? Number(row.total_messages) : 0;

    if (isGemini) {
      bodyEl.textContent = '';
      bodyEl.appendChild(document.createTextNode("Gemini is the forum's bot helper — tag it in any thread to get a reply."));
      bodyEl.appendChild(document.createElement('br'));
      bodyEl.appendChild(document.createTextNode(`Total messages: ${count}`));
      return;
    }

    if (count === 0) {
      bodyEl.textContent = `No messages found from "${name}".`;
      avatarEl.appendChild(await forumResolveAvatarEl(name));
      return;
    }

    if (row.avatar_svg) {
      avatarEl.appendChild(forumUserAvatarEl(row.avatar_svg, name));
      setCachedAvatarSvg(name, row.avatar_svg);
    } else {
      avatarEl.appendChild(await forumResolveAvatarEl(name));
    }

    const firstDate = row.first_message_at ? formatForumTime(row.first_message_at) : '—';
    const lastDate  = row.last_message_at  ? formatForumTime(row.last_message_at)  : '—';

    bodyEl.textContent = '';
    const lines = [`First message: ${firstDate}`, `Last message: ${lastDate}`, `Total messages: ${count}`];
    lines.forEach((line, i) => {
      if (i > 0) bodyEl.appendChild(document.createElement('br'));
      bodyEl.appendChild(document.createTextNode(line));
    });
  } catch (e) {
    console.error('Forum mention profile lookup error:', e);
    // For Gemini, the blurb alone is still useful even if the count fails
    // to load — don't replace it with a generic error.
    if (isGemini) {
      bodyEl.textContent = "Gemini is the forum's bot helper — tag it in any thread to get a reply.";
    } else {
      bodyEl.textContent = "Couldn't load — try again.";
      avatarEl.appendChild(await forumResolveAvatarEl(name));
    }
  }
}

// ── Local avatar cache ────────────────────────────────────────────────────────
// get_author_stats can fail to load on a bad connection, and the fallback
// used to always be the plain colored-initial avatar (forumInitialsAvatarEl)
// even for someone whose real identicon was successfully fetched moments
// earlier. Caching the last-fetched SVG per nickname means a flaky
// connection shows "your actual identicon, possibly a little stale" instead
// of "not your identicon at all". Keyed by nickname (lowercased) —
// specifically so a rename can't get stuck showing the old identicon: the
// new name has no cache entry of its own yet, so it correctly falls through
// to the initials fallback until the new name's own fetch succeeds at least
// once, rather than reusing whatever was cached under the old name.
//
// Only ever consulted on an actual fetch FAILURE (network error, no client),
// never when the server successfully confirms "this identity has no
// avatar_svg" (unclaimed, or claimed before avatars existed) — that's a
// real "no avatar" state, not a connectivity problem, and showing a stale
// cached image there would be actively misleading rather than helpful.
const FORUM_AVATAR_CACHE_KEY = STORAGE_PREFIX + '_forum_avatar_cache';
const FORUM_AVATAR_CACHE_MAX_ENTRIES = 50; // small cap so a long session browsing many profiles can't grow this unbounded

function _loadAvatarCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FORUM_AVATAR_CACHE_KEY));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) { return {}; }
}

function getCachedAvatarSvg(nickname) {
  const entry = _loadAvatarCache()[nickname.toLowerCase()];
  return entry ? entry.svg : null;
}

function setCachedAvatarSvg(nickname, svg) {
  const cache = _loadAvatarCache();
  cache[nickname.toLowerCase()] = { svg, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > FORUM_AVATAR_CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].at - cache[b].at);
    delete cache[keys[0]]; // evict the single oldest entry — good enough for a soft cap, no need for a full LRU
  }
  try { localStorage.setItem(FORUM_AVATAR_CACHE_KEY, JSON.stringify(cache)); }
  catch (e) { /* storage full/unavailable — this cache is purely best-effort, safe to skip */ }
}

// Wraps forumInitialsAvatarEl: checks the local avatar cache first, so a
// name that had its real identicon rendered earlier in this session (or a
// past one) never falls back to the plain letter square as long as
// *something* real is on hand — even if the current lookup says "no
// avatar_svg" (e.g. a stale/incorrect result, a transient server hiccup
// that isn't a hard fetch failure, or a name-matching edge case upstream).
// Only reaches for the bare initials when there is truly nothing cached
// under this name yet.
//
// Kept as the instant, synchronous piece of the chain — see
// forumResolveAvatarEl below for the full cache → live DiceBear fetch →
// initials sequence; this one is what that function falls back to
// immediately while a fetch is still in flight, and what callers use
// directly if they need something on-screen with no await at all.
function forumAvatarOrCachedInitialsEl(name) {
  const cached = getCachedAvatarSvg(name);
  return cached ? forumUserAvatarEl(cached, name) : forumInitialsAvatarEl(name);
}

// ── Client-side DiceBear fallback ────────────────────────────────────────────
// claim-nickname.ts already fetches and stores a DiceBear identicon at
// claim/rename time (see DICEBEAR_IDENTICON_URL there), so almost every
// message ships with a ready-made avatar_svg straight from the database.
// The only time this ever fires is the leftover case where that server-side
// fetch failed right when someone claimed/renamed (DiceBear down or
// rate-limited at that moment) — this is a same-URL, client-side retry of
// that one missed fetch, not a general-purpose avatar source.
const FORUM_DICEBEAR_IDENTICON_URL = 'https://api.dicebear.com/10.x/identicon/svg?seed=';

async function fetchForumIdenticonSvg(seed) {
  try {
    const res = await fetch(FORUM_DICEBEAR_IDENTICON_URL + encodeURIComponent(seed));
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null; // offline/network error — treat exactly like a non-OK response
  }
}

// Coalesces concurrent lookups for the same name — e.g. several messages
// from the same never-avatar'd poster all rendering at once — into a single
// live DiceBear request instead of firing one per row.
const _forumAvatarFetchInFlight = new Map();

// Full fallback chain for "the database has no avatar_svg for this name":
//   1. local cache — a real identicon already seen this session/browser
//   2. (the database itself — already checked by the caller before this
//      function is ever reached; see the call sites below)
//   3. a direct client-side DiceBear request (same URL/seed the server
//      uses), covering the case where the *server-side* fetch failed
//   4. the plain colored-initial square — only once 1–3 all miss
// Any successful hit at step 1 or 3 is written into the local cache so
// later lookups for this name (any tab, this browser) skip straight to
// step 1 from then on.
async function forumResolveAvatarEl(name) {
  const cached = getCachedAvatarSvg(name);
  if (cached) return forumUserAvatarEl(cached, name);

  const key = name.toLowerCase();
  let pending = _forumAvatarFetchInFlight.get(key);
  if (!pending) {
    pending = fetchForumIdenticonSvg(name);
    pending.finally(() => _forumAvatarFetchInFlight.delete(key));
    _forumAvatarFetchInFlight.set(key, pending);
  }
  const svg = await pending;
  if (svg) {
    setCachedAvatarSvg(name, svg);
    return forumUserAvatarEl(svg, name);
  }
  return forumInitialsAvatarEl(name);
}

// Fallback for the profile popup's avatar when the person has no stored
// DiceBear identicon (never claimed a nickname, or claimed before avatars
// shipped) — a plain colored square with their first letter, using the same
// name-hash color every unclaimed author's name text already uses
// (forumColorForName), so the fallback still visually ties back to them.
function forumInitialsAvatarEl(name) {
  const wrap = document.createElement('div');
  wrap.className = 'forum-message-avatar forum-message-avatar-user forum-message-avatar-initials';
  wrap.style.background = forumColorForName(name);
  wrap.textContent = (name.trim()[0] || '?').toUpperCase();
  return wrap;
}

// Names of forum "bot" authors whose messages get a defensive markdown
// cleanup pass (see stripMarkdownArtifacts) before display. This is a
// backstop, not the primary fix — Gemini is instructed server-side not to
// use markdown at all, since this forum only renders LaTeX math, nothing
// else. LLMs don't follow formatting instructions with 100% reliability, so
// this catches any stray **bold**/# header/backtick syntax that slips
// through and would otherwise show up as literal asterisks/hashes.
const FORUM_BOT_AUTHORS = ['Gemini'];

function stripMarkdownArtifacts(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold**
    .replace(/__(.+?)__/g, '$1')          // __bold__
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2') // *italic* (not part of **)
    .replace(/`([^`]+)`/g, '$1')          // `code`
    .replace(/^#{1,6}\s+/gm, '');         // # headers
}

// The official Gemini logo (images/gemini-logo.svg — the real icon file,
// not a redrawn approximation), so the official bot's own posts are
// distinguishable at a glance from someone who merely typed "Gemini" as
// their display name.
//
// Referenced via <img src="...">, NOT inlined, unlike the rest of this
// file's avatar helpers — this particular file is a ~530KB Illustrator
// export with several embedded raster layers (that's what gives it its
// rich gradient look; a flat CSS/SVG gradient can't reproduce it). Inlining
// something that size into every message row's markup would mean
// re-parsing it once per visible message; as an <img> it's fetched and
// decoded once by the browser and then just reused from cache for every
// other avatar on the page, no matter how many messages are showing.
function forumGeminiAvatarEl() {
  const wrap = document.createElement('div');
  wrap.className = 'forum-message-avatar';
  wrap.title = 'Gemini — official bot reply';
  const img = document.createElement('img');
  img.className = 'gemini-mark';
  img.src = 'images/gemini-logo.svg';
  img.alt = 'Gemini';
  wrap.appendChild(img);
  return wrap;
}

// Per-user identicon avatar (Case B from the avatar discussion): the raw
// DiceBear SVG stored on the poster's identities row at claim/rename time
// (claim-nickname.ts) and surfaced on each message via avatar_svg on
// forum_messages_public. Inserted with innerHTML — safe here because this
// string never comes from arbitrary user input, only from our own Edge
// Function's fetch to DiceBear (unlike forumGeminiAvatarEl above, which
// points an <img> at a static file rather than inlining markup, since that
// file is far too large to duplicate into every message row).
function forumUserAvatarEl(svgMarkup, name) {
  const wrap = document.createElement('div');
  wrap.className = 'forum-message-avatar forum-message-avatar-user';
  wrap.title = name;
  wrap.innerHTML = svgMarkup;
  return wrap;
}

// Rows with neither a bot avatar nor a stored identicon (name claimed
// before this feature shipped, or DiceBear was unreachable at claim time)
// get an invisible same-size stand-in instead of no avatar at all, so
// every message's author/body starts at the same left edge regardless of
// which case applies — visibility:hidden keeps the layout space without
// showing anything (see .forum-message-avatar-spacer in forum.css).
function forumAvatarSpacerEl() {
  const spacer = document.createElement('div');
  spacer.className = 'forum-message-avatar forum-message-avatar-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

// Invisible same-size stand-in for the ✎ edit button, used only for your
// own message once it's been 'deleted' — at that point it's not flaggable
// (self-flagging doesn't exist) and not editable (removed messages stay
// removed), so neither icon applies, but the date still needs to land in
// the same spot as every other human row's. Same technique as
// forumAvatarSpacerEl() above.
function forumEditBtnSpacerEl() {
  const spacer = document.createElement('span');
  spacer.className = 'forum-edit-btn forum-edit-btn-spacer';
  spacer.textContent = '✎';
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

// Fills `bodyEl` with `text`, one child block per real line (split on
// literal newlines the composer's textarea can produce — previously these
// collapsed into a single flowed line since nothing preserved them; each
// line is now its own block so "highlight this line" is a real, well-defined
// thing rather than the whole message). Within each line, any "@name" token
// is split out into a tappable chip. Still never uses innerHTML on anything
// derived from the message body — every piece (plain text and each
// mention's "@name" label alike) goes in via textContent on its own text
// node / span, so nothing a user types can be interpreted as markup.
// renderMathIn() runs after this, same as before, and only ever typesets
// $...$/\(...\) it finds inside existing text nodes, so splitting the body
// across multiple line/mention nodes here doesn't interfere with it.
//
// Only the line(s) that mention the *viewer's own* current display identity
// (getForumIdentityName() — the claimed nickname if this device has one,
// else the saved free-text name, same priority post-message enforces
// server-side) get the highlighted background — a message tagging someone
// else doesn't light up for everyone reading it, just the person actually
// tagged. Deliberately NOT getForumSavedName() alone: that field is only
// ever written on an unclaimed device's first send and is never updated by
// claiming, renaming, or dropping a nickname, so matching against it directly
// would keep highlighting an old identity forever after a rename/drop. If
// this browser/device has neither a nickname nor a saved name yet, nothing
// highlights (there's nothing to match against).
// bodyEl -> the taggedChipsByLine array last used to render it, so a
// window resize (which can reflow where a paragraph wraps) can redraw the
// highlight overlay(s) at their new position instead of leaving them
// stranded from a stale layout.
const forumMentionHighlightData = new WeakMap();
let forumMentionResizeObserver = null;

function ensureForumMentionResizeObserver() {
  if (forumMentionResizeObserver) return forumMentionResizeObserver;
  forumMentionResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const bodyEl = entry.target;
      const data = forumMentionHighlightData.get(bodyEl);
      if (data) positionForumMentionHighlights(bodyEl, data);
    });
  });
  return forumMentionResizeObserver;
}

// opts.latexPending: true only for the optimistic row an unconfirmed send
// renders (see submitForumMessage) — splits out &...&/&&...&& shorthand
// spans into a greyed-out placeholder instead of showing the raw shorthand,
// since it hasn't gone through the server's LaTeX-assist conversion yet.
// Never true for a message that actually came back from the server: by
// then body is already the converted (or, on force_latex, deliberately
// literal) text, so there's nothing left to grey out.
function renderForumMessageBody(bodyEl, text, opts = {}) {
  bodyEl.textContent = '';
  const ownName = getForumIdentityName().trim().toLowerCase();
  const lines = text.split(/\r\n|\r|\n/);
  const taggedChipsByLine = [];

  lines.forEach((line) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'forum-message-line';
    const taggedChips = opts.latexPending
      ? renderForumLineWithLatexPending(lineEl, line, ownName)
      : renderForumLineWithMentions(lineEl, line, ownName);
    bodyEl.appendChild(lineEl);
    if (taggedChips.length) taggedChipsByLine.push({ lineEl, taggedChips });
  });

  if (taggedChipsByLine.length) {
    forumMentionHighlightData.set(bodyEl, taggedChipsByLine);
    ensureForumMentionResizeObserver().observe(bodyEl);
    // Wait a frame so the browser has actually wrapped the text before we
    // measure where it wrapped — doing this synchronously would read
    // pre-layout geometry.
    requestAnimationFrame(() => positionForumMentionHighlights(bodyEl, taggedChipsByLine));
  }
}

// Draws a full-width highlight bar (see .forum-message-mention-highlight)
// behind each distinct visual row that contains one of the viewer's own
// "@name" mention chips. A logical line (one entry in taggedChipsByLine)
// can wrap into several visual rows once the browser lays it out, so this
// uses Range.getClientRects() on the whole line — which returns one rect
// per wrapped row — and picks out the row(s) whose vertical span actually
// contains a tagged chip, rather than highlighting every row the line
// occupies.
function positionForumMentionHighlights(bodyEl, taggedChipsByLine) {
  // Clear stale overlays before laying out fresh ones (re-renders, resizes).
  bodyEl.querySelectorAll(':scope > .forum-message-mention-highlight').forEach((el) => el.remove());

  const bodyRect = bodyEl.getBoundingClientRect();
  const seenRows = new Set(); // dedupes when 2+ mentions land on the same visual row

  taggedChipsByLine.forEach(({ lineEl, taggedChips }) => {
    const range = document.createRange();
    range.selectNodeContents(lineEl);
    const rowRects = Array.from(range.getClientRects());
    if (!rowRects.length) return;

    taggedChips.forEach((chip) => {
      const chipRect = chip.getBoundingClientRect();
      const chipMid = chipRect.top + chipRect.height / 2;
      const rowRect = rowRects.find((r) => chipMid >= r.top && chipMid <= r.bottom) || rowRects[0];

      const top = Math.round(rowRect.top - bodyRect.top);
      const height = Math.round(rowRect.height);
      const key = top + ':' + height;
      if (seenRows.has(key)) return;
      seenRows.add(key);

      const overlay = document.createElement('div');
      overlay.className = 'forum-message-mention-highlight';
      overlay.style.top = top + 'px';
      overlay.style.height = height + 'px';
      bodyEl.appendChild(overlay);
    });
  });
}

// Renders one line's worth of text into `container`, splitting out "@name"
// mention chips. Returns the array of chip elements whose name matches
// `ownNameLower` (already lowercased; empty string never matches) — empty
// array if none — so the caller can measure exactly which visual row(s)
// those specific chips land on (see positionForumMentionHighlights).
function renderForumLineWithMentions(container, text, ownNameLower) {
  FORUM_MENTION_RE.lastIndex = 0;
  let lastIndex = 0;
  let match;
  const taggedChips = [];

  while ((match = FORUM_MENTION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const name = match[1];
    const chip = document.createElement('span');
    chip.className = 'forum-mention-chip';
    chip.textContent = '@' + name;
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.addEventListener('click', () => openForumMentionProfile(name));
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openForumMentionProfile(name); }
    });
    container.appendChild(chip);
    if (ownNameLower && name.toLowerCase() === ownNameLower) taggedChips.push(chip);
    lastIndex = FORUM_MENTION_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return taggedChips;
}

// Same job as renderForumLineWithMentions above, but for the optimistic
// pre-confirmation row only (see renderForumMessageBody's latexPending
// branch): first splits the line on FORUM_LATEX_ASSIST_RE, rendering each
// matched &...&/&&...&& span as a greyed "pending LaTeX conversion"
// placeholder, and delegates every plain segment in between to the ordinary
// mention renderer so @mentions still work while a message is in flight.
function renderForumLineWithLatexPending(container, text, ownNameLower) {
  FORUM_LATEX_ASSIST_RE.lastIndex = 0;
  let lastIndex = 0;
  let match;
  const taggedChips = [];

  while ((match = FORUM_LATEX_ASSIST_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      taggedChips.push(...renderForumLineWithMentions(container, segment, ownNameLower));
    }
    const pending = document.createElement('span');
    pending.className = 'forum-latex-pending';
    pending.textContent = 'pending LaTeX conversion';
    pending.title = 'Converting your LaTeX shorthand…';
    container.appendChild(pending);
    lastIndex = FORUM_LATEX_ASSIST_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    taggedChips.push(...renderForumLineWithMentions(container, text.slice(lastIndex), ownNameLower));
  }
  return taggedChips;
}

// Messages are plain text — always rendered via textContent (per mention
// chip / text node, see renderForumMessageBody above), never innerHTML, so
// nothing a user types can be interpreted as markup. renderMathIn() (see
// math-render.js) runs after that and only ever typesets $...$/\(...\) it
// finds inside existing text nodes — it can't turn stray HTML into markup,
// so this doesn't reopen the injection risk textContent avoids.
// ── Flagging ─────────────────────────────────────────────────────────────────
// A message can only ever be flagged once, by anyone — the server-side
// atomic claim in flag-message.ts is what actually enforces that; disabling
// the button here is just so the same person doesn't fire off duplicate
// requests while the first one is in flight.
async function flagForumMessage(messageId, btnEl) {
  if (!btnEl || btnEl.disabled) return;
  btnEl.disabled = true;
  const originalTitle = btnEl.title;
  btnEl.title = 'Flagging…';

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/flag-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ message_id: messageId, device_id: getForumDeviceId(), device_secret: getForumDeviceSecret() }),
    });
    const data = await res.json().catch(() => null);

    if (data && data.ok && data.result === 'kept') {
      btnEl.classList.add('forum-flag-btn-kept');
      btnEl.title = 'Reviewed — kept';
      return;
    }
    if (data && data.ok && data.result === 'deleted') {
      // The deleted-state rendering (italic notice, red flag button) lives
      // in renderForumMessage/renderForumMessageList — refreshing the feed
      // is simpler and less error-prone than duplicating that logic here.
      loadForumInitial();
      return;
    }
    if (data && data.error === 'rate_limited') {
      btnEl.title = "You've flagged too many messages this hour — try later.";
      btnEl.disabled = false;
      return;
    }

    // 'already_reviewed' (someone else flagged it a moment ago, or it's
    // mid-review right now) or any other unexpected error — resync with
    // the server's actual current state rather than leaving a stale button.
    loadForumInitial();
  } catch (err) {
    console.error('Forum flag error:', err);
    btnEl.title = originalTitle;
    btnEl.disabled = false;
  }
}

// opts.pending: true only for the optimistic row submitForumMessage() shows
// the instant Send is tapped, before the server has confirmed anything —
// see the big comment block in submitForumMessage for the full flow. A
// pending row gets no edit/flag/reply icon (none of those make sense
// against a message that doesn't have a real id yet) and, if its body
// contains &...&/&&...&& LaTeX shorthand, greys that span out instead of
// showing the raw shorthand (see renderForumMessageBody's latexPending
// branch) — everything else renders exactly like a normal confirmed row,
// on purpose, so it reads as "already posted" rather than "sending".
function renderForumMessage(msg, opts = {}) {
  const row = document.createElement('div');
  row.className = 'forum-message';
  // Tagged so renderForumMessageList() can recognize and reuse this exact
  // node on a later refresh instead of tearing it down and re-typesetting it
  // (see renderForumMessageList for why that matters).
  row.dataset.msgId         = String(msg.id);
  row.dataset.msgBody       = msg.body;
  // Included in the reuse-check in renderForumMessageList below — a flag
  // tap changes flag_status/flag_reason but never touches body, so without
  // this the row-reuse optimization would keep showing the pre-flag state
  // forever on every viewer's screen except the one that tapped it.
  row.dataset.msgFlagStatus = msg.flag_status || '';
  row.dataset.msgFlagReason = msg.flag_reason || '';
  row.dataset.msgEditedAt   = msg.edited_at || '';
  // Included in the reuse-check in renderForumMessageList below — a rename
  // (claim-nickname.ts) changes author_name and re-seeds avatar_svg on
  // every message the identity ever posted (via forum_messages_public's
  // join, no bulk update needed there), but never touches body/flag/
  // edited_at — so without these two, an already-rendered row would keep
  // showing the poster's old name/avatar forever after they renamed.
  row.dataset.msgAuthorName = msg.author_name;
  row.dataset.msgAvatarSvg  = msg.avatar_svg || '';

  // Only the sentinel device_id the Edge Function itself inserts under gets
  // the avatar — see FORUM_GEMINI_BOT_DEVICE_ID above for why author_name
  // alone isn't trustworthy for this.
  const isGeminiBot = msg.device_id === FORUM_GEMINI_BOT_DEVICE_ID;
  if (isGeminiBot) {
    row.classList.add('forum-message-bot');
    row.appendChild(forumGeminiAvatarEl());
  } else if (msg.avatar_svg) {
    row.appendChild(forumUserAvatarEl(msg.avatar_svg, msg.author_name));
  } else {
    // Reserves the same width the avatar would take, so this row's text
    // lines up with avatar rows instead of sitting further left.
    row.appendChild(forumAvatarSpacerEl());
  }

  const content = document.createElement('div');
  content.className = 'forum-message-content';

  const meta = document.createElement('div');
  meta.className = 'forum-message-meta';

  // Tapping the author's name here opens the same profile popup as tapping
  // an "@name" mention chip elsewhere in the thread (openForumMentionProfile,
  // see renderForumLineWithMentions) — same lookup, same modal, just a
  // second way to reach it.
  const author = document.createElement('span');
  author.className = 'forum-message-author';
  author.textContent = msg.author_name;
  author.style.color = forumColorForMessage(msg);
  author.setAttribute('role', 'button');
  author.setAttribute('tabindex', '0');
  author.title = `View @${msg.author_name}'s profile`;
  author.addEventListener('click', () => openForumMentionProfile(msg.author_name));
  author.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openForumMentionProfile(msg.author_name); }
  });

  const tagInfo = forumTagInfo(msg.scope, msg.problem_key);
  const tag = document.createElement('span');
  tag.className = 'forum-message-tag';
  tag.textContent = tagInfo.label;
  if (tagInfo.color) tag.style.setProperty('--tag-color', tagInfo.color);

  // Always created, whether or not this message was actually edited — kept
  // in the DOM either way (just visibility:hidden when it wasn't) so it
  // reserves the same width on every row. That's what keeps the date after
  // it landing at the same x position across the whole list instead of
  // sliding left/right depending on which rows happen to carry the tag.
  const edited = document.createElement('span');
  edited.className = 'forum-message-edited';
  edited.textContent = '(ed.)';
  if (msg.edited_at) {
    edited.title = `Edited ${formatForumTime(msg.edited_at)}`;
  } else {
    edited.classList.add('forum-message-edited-hidden');
    edited.setAttribute('aria-hidden', 'true');
  }

  const time = document.createElement('span');
  time.className = 'forum-message-time';
  time.textContent = formatForumTimeAligned(msg.created_at);

  meta.appendChild(author);
  meta.appendChild(tag);
  meta.appendChild(edited);

  // Right-flushed icon+date group: the icon (if any) sits with no gap
  // directly before the date, and the date is always the last thing in
  // the row. Exactly one icon is ever shown per human row — flag on
  // someone else's message, edit on your own — never both, so there's no
  // longer a case where a message shows two icons or none:
  //  - Someone else's message: the flag button, same as before, real for
  //    every flag_status (including 'deleted', where it doubles as a
  //    disabled red status indicator rather than an action).
  //  - Your own message (device_id match): the edit button instead of
  //    flag — self-flagging is gone entirely — but only while the
  //    message isn't 'deleted' (a removed message stays removed and
  //    can't be edited). When it *is* your own deleted message, neither
  //    icon applies, so a same-size spacer (forumEditBtnSpacerEl) keeps
  //    the date lined up with every other human row's.
  //  - Gemini's own messages: just the date, no icon and no spacer —
  //    Gemini is already visually distinct (avatar, font), so its date
  //    doesn't need to hold that column alignment.
  const tsGroup = document.createElement('span');
  tsGroup.className = 'forum-message-timestamp-group';

  if (!isGeminiBot && !opts.pending) {
    // Same device always counts, but ONLY for a message that has no owning
    // identity at all (identity_id null — an anonymous/free-text post from
    // before this device_id ever claimed a nickname). For an identity-
    // backed message, device_id is permanent and never rotates (not even
    // on Exit), so a literal match here would keep lighting up the edit
    // button on every message this physical device ever posted under any
    // identity it has SINCE dropped — exactly the live-join bug
    // 004_fix_author_identity_resolution.sql already fixed for author
    // display, and the one edit-message.ts's own ownership check was fixed
    // for server-side (see migration 013). Instead, an identity-backed
    // message is "own" iff this device currently has THAT SAME identity
    // claimed — checked by nickname here since that's all the client has,
    // but author_name is itself resolved from the identity's live nickname
    // (see the view in 004), so this can't drift the way a stale device_id
    // match could.
    const claimedNickname = getForumNickname();
    const isOwn = msg.identity_id
      ? (!!claimedNickname && msg.author_name.toLowerCase() === claimedNickname.toLowerCase())
      : msg.device_id === getForumDeviceId();
    if (isOwn) {
      if (msg.flag_status !== 'deleted') {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'forum-edit-btn';
        editBtn.textContent = '✎';
        editBtn.title = 'Edit this message';
        editBtn.setAttribute('aria-label', 'Edit this message');
        editBtn.addEventListener('click', () => openForumEditMessageModal(msg));
        tsGroup.appendChild(editBtn);
      } else {
        tsGroup.appendChild(forumEditBtnSpacerEl());
      }
    } else {
      const flagBtn = document.createElement('button');
      flagBtn.type = 'button';
      flagBtn.className = 'forum-flag-btn';
      flagBtn.textContent = '⚑ ';
      flagBtn.setAttribute('aria-label', 'Flag this message for review');
      if (msg.flag_status === 'kept') {
        flagBtn.classList.add('forum-flag-btn-kept');
        flagBtn.disabled = true;
        flagBtn.title = 'Reviewed — kept';
      } else if (msg.flag_status === 'reviewing') {
        flagBtn.classList.add('forum-flag-btn-reviewing');
        flagBtn.disabled = true;
        flagBtn.title = 'Being reviewed…';
      } else if (msg.flag_status === 'deleted') {
        flagBtn.classList.add('forum-flag-btn-deleted');
        flagBtn.disabled = true;
        flagBtn.title = 'Removed by auto-moderation';
      } else {
        flagBtn.title = 'Flag for review';
        flagBtn.addEventListener('click', () => flagForumMessage(msg.id, flagBtn));
      }
      tsGroup.appendChild(flagBtn);
    }
  }

  if (msg.flag_status !== 'deleted' && !opts.pending) {
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'forum-reply-btn';
    replyBtn.textContent = '↩';
    replyBtn.title = 'Reply';
    replyBtn.setAttribute('aria-label', 'Reply to this message');
    replyBtn.addEventListener('click', () => startForumReply(msg));
    tsGroup.appendChild(replyBtn);
  }
  tsGroup.appendChild(time);
  meta.appendChild(tsGroup);

  const body = document.createElement('div');
  body.className = 'forum-message-body';
  if (msg.flag_status === 'deleted') {
    // Soft delete only — the real text is still sitting in forum_messages
    // (see sql/forum_flags.sql), just never rendered here. Not passed
    // through renderForumMessageBody/renderMathIn at all, so the original
    // content never touches the DOM even hidden — inspecting the page
    // shows only this notice.
    body.classList.add('forum-message-deleted-notice');
    body.textContent = msg.flag_reason
      ? `This message was removed by auto-moderation after being flagged. Reason: ${msg.flag_reason}.`
      : 'This message was removed by auto-moderation after being flagged.';
  } else {
    const bodyText = FORUM_BOT_AUTHORS.includes(msg.author_name)
      ? stripMarkdownArtifacts(msg.body)
      : msg.body;
    // Highlights only the specific line(s) mentioning the viewer's own name
    // (see renderForumMessageBody) — not the whole message bubble, and not
    // for mentions of anyone else.
    renderForumMessageBody(body, bodyText, {
      latexPending: !!opts.pending && forumHasLatexShorthand(bodyText),
    });
  }

  content.appendChild(meta);
  if (msg.reply_to_id) {
    const quote = document.createElement('div');
    quote.className = 'forum-reply-quote';
    quote.textContent = msg.reply_to_flag_status === 'deleted'
      ? '↩ [message removed]'
      : `↩ ${msg.reply_to_author_name}: ${forumReplyQuoteSnippet(msg.reply_to_body)}`;
    quote.addEventListener('click', () => jumpForumToMessage(msg.reply_to_id));
    content.appendChild(quote);
    renderMathIn(quote);
  }
  content.appendChild(body);
  row.appendChild(content);
  if (msg.flag_status !== 'deleted') renderMathIn(body);

  // Fade/slide-in instead of the row just snapping into place — applies to
  // every freshly-created row (initial load, "load older", and live-poll
  // arrivals alike), not just live ones, since none of those had any
  // transition before. The class is stripped once the animation finishes so
  // later DOM reinsertion of this same reused node (renderForumMessageList
  // replaces list.innerHTML on every refresh) never risks replaying it.
  row.classList.add('forum-message-enter');
  row.addEventListener('animationend', () => row.classList.remove('forum-message-enter'), { once: true });

  return row;
}

// Rebuilds `list`'s message rows for `data`, reusing already-rendered DOM
// nodes for messages that haven't changed instead of wiping the whole list
// and recreating every row from scratch.
//
// Why this matters: loadForumInitial() re-fetches and rebuilds the full
// visible page every time it runs — right after you send a message, and on
// every polling refresh — so without this, *every* message on screen
// (including ones typeset ages ago) would get torn down and rebuilt via
// textContent + renderMathIn(), which is async. That produced a visible
// flash of raw "$...$" text across the whole thread each time, right before
// MathJax caught up and re-typeset it. Reusing untouched rows means only
// genuinely new or edited messages ever go through that render step.
function renderForumMessageList(list, data) {
  const existing = new Map();
  Array.from(list.children).forEach(child => {
    if (child.dataset && child.dataset.msgId) existing.set(child.dataset.msgId, child);
  });

  const frag = document.createDocumentFragment();
  data.forEach(msg => {
    const id = String(msg.id);
    const prior = existing.get(id);
    // Body check catches the (unlikely) case a message got edited server-side
    // between refreshes — falls through to a fresh render+typeset for it.
    // flag_status/flag_reason are checked too: a flag tap changes those
    // without ever touching body, and this is the only place that decides
    // whether an already-rendered row gets reused as-is or rebuilt — so
    // without this check, a message flagged after it was first drawn would
    // keep showing its pre-flag state indefinitely on everyone else's screen.
    // author_name/avatar_svg are checked for the same reason, on the same
    // principle — a rename changes those two without touching body/flag/
    // edited_at at all (see the dataset comment in renderForumMessage).
    const unchanged = prior
      && prior.dataset.msgBody === msg.body
      && prior.dataset.msgFlagStatus === (msg.flag_status || '')
      && prior.dataset.msgFlagReason === (msg.flag_reason || '')
      && prior.dataset.msgEditedAt === (msg.edited_at || '')
      && prior.dataset.msgAuthorName === msg.author_name
      && prior.dataset.msgAvatarSvg === (msg.avatar_svg || '');
    frag.appendChild(unchanged ? prior : renderForumMessage(msg));
  });

  list.innerHTML = '';
  list.appendChild(frag);
}

function setForumStatus(text, isError = false) {
  const list = document.getElementById('forumMessageList');
  if (!list) return;
  list.innerHTML = '';
  const status = document.createElement('div');
  status.className = 'forum-status' + (isError ? ' forum-status-error' : '');
  status.textContent = text;
  list.appendChild(status);
}

async function loadForumInitial() {
  const list        = document.getElementById('forumMessageList');
  const loadMoreBtn = document.getElementById('forumLoadMoreBtn');
  if (!list) return;

  forumOldestLoadedId = null;
  forumNoMoreOlder    = false;

  // Paint the cached page immediately if we have one, instead of a loading
  // flash — this gets replaced below once the fresh fetch resolves.
  const cacheKey = forumCacheKey();
  const cached = forumMessageCache[cacheKey];
  if (cached && cached.length > 0) {
    renderForumMessageList(list, forumVisibleData(cached));
    forumOldestLoadedId = cached[cached.length - 1].id;
    forumNoMoreOlder    = cached.length < FORUM_PAGE_SIZE;
    if (loadMoreBtn) loadMoreBtn.style.display = forumNoMoreOlder ? 'none' : 'block';
  } else {
    setForumStatus('Loading messages…');
  }

  const { data, error } = await fetchForumMessages();

  if (error) {
    // Only clobber the view with an error if we had nothing cached to show.
    if (!cached || cached.length === 0) {
      setForumStatus("Couldn't load the forum right now — try again in a bit.", true);
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    }
    return;
  }

  if (data.length === 0) {
    forumMessageCache[cacheKey] = [];
    if (!cached || cached.length === 0) {
      setForumStatus('Nothing\'s there. Be the first one: nothing ventured, nothing gained! Mention @gemini if you need help!');
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    }
    return;
  }

  forumMessageCache[cacheKey] = data;

  // Still shown pinned above (see renderForumPinnedBanner) → left out here
  // so it isn't rendered twice; forumOldestLoadedId/forumNoMoreOlder below
  // still use the real, unfiltered page, since pagination has to follow the
  // actual rows in the DB regardless of what's currently pinned.
  const visible = forumVisibleData(data);
  if (visible.length === 0) {
    setForumStatus('Nothing else here yet — check the pinned message above, or be the first to reply! Mention @gemini if you need help!');
  } else {
    renderForumMessageList(list, visible);
  }

  forumOldestLoadedId = data[data.length - 1].id;
  forumNoMoreOlder = data.length < FORUM_PAGE_SIZE;
  if (loadMoreBtn) loadMoreBtn.style.display = forumNoMoreOlder ? 'none' : 'block';

  // A short first page might not even fill the viewport, so there'd be no
  // scrollbar for the reader to reach the bottom of — check right away
  // rather than leaving them stuck behind a manual button forever.
  onForumListScroll();
}

async function loadForumOlder() {
  if (forumSearchActive || forumLoadingMore || forumNoMoreOlder || forumOldestLoadedId === null) return;
  forumLoadingMore = true;

  const list        = document.getElementById('forumMessageList');
  const loadMoreBtn = document.getElementById('forumLoadMoreBtn');
  if (loadMoreBtn) { loadMoreBtn.disabled = true; loadMoreBtn.textContent = 'Loading…'; }

  const { data, error } = await fetchForumMessages(forumOldestLoadedId);

  if (!error && data.length > 0) {
    forumVisibleData(data).forEach(msg => list.appendChild(renderForumMessage(msg)));
    forumOldestLoadedId = data[data.length - 1].id;
  }
  forumNoMoreOlder = !!error || data.length < FORUM_PAGE_SIZE;

  if (loadMoreBtn) {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Load older messages';
    loadMoreBtn.style.display = forumNoMoreOlder ? 'none' : 'block';
  }
  forumLoadingMore = false;

  // Same reasoning as in loadForumInitial: if the page still isn't tall
  // enough to scroll after this page landed, keep pulling in older
  // messages rather than stranding the reader behind the button.
  onForumListScroll();
}

// ── Search ────────────────────────────────────────────────────────────────
// Opens/closes the search bar. Doesn't itself start a search — typing does,
// via onForumSearchInput() below — so tapping 🔍 with nothing typed yet
// just reveals an empty input, same feed still showing underneath.
function toggleForumSearch() {
  const bar = document.getElementById('forumSearchBar');
  const btn = document.getElementById('forumSearchToggleBtn');
  const input = document.getElementById('forumSearchInput');
  if (!bar || !btn || !input) return;

  const opening = bar.style.display === 'none';
  if (opening) {
    bar.style.display = 'flex';
    btn.classList.add('active');
    input.focus();
  } else {
    exitForumSearch();
  }
}

function onForumSearchInput() {
  const input = document.getElementById('forumSearchInput');
  if (!input) return;
  clearTimeout(forumSearchDebounce);
  forumSearchDebounce = setTimeout(() => runForumSearch(input.value.trim()), FORUM_SEARCH_DEBOUNCE_MS);
}

// term === '': back to the normal forumFilter-driven feed (same as closing
// search entirely, minus actually hiding the bar — lets someone clear the
// box without losing their place in the search UI).
async function runForumSearch(term) {
  if (!term) {
    forumSearchActive = false;
    hideForumNewMsgsPill();
    loadForumInitial();
    return;
  }

  forumSearchActive = true;
  // A stale "new messages" pill or "load older" button referring to the
  // filtered feed underneath would be misleading once search results are
  // what's actually on screen.
  hideForumNewMsgsPill();
  const loadMoreBtn = document.getElementById('forumLoadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.style.display = 'none';

  setForumStatus('Searching…');
  const { data, error } = await fetchForumSearchResults(term);

  // The debounce means an older, slower search could resolve after a newer
  // one if results come back out of order — bail if the box no longer
  // holds the term this particular call was for.
  const input = document.getElementById('forumSearchInput');
  if (!input || input.value.trim() !== term) return;

  if (error) {
    setForumStatus("Couldn't search right now — try again in a bit.", true);
    return;
  }
  if (data.length === 0) {
    setForumStatus(`No messages match "${term}".`);
    return;
  }

  const list = document.getElementById('forumMessageList');
  if (list) renderForumMessageList(list, data);
}

// Closes the search bar and returns to the normal forumFilter-driven feed.
// Called by the bar's own ✕, by toggleForumSearch() when closing, and by
// closeForumScreen() so reopening the forum later never resumes mid-search.
function exitForumSearch(opts = {}) {
  const bar = document.getElementById('forumSearchBar');
  const btn = document.getElementById('forumSearchToggleBtn');
  const input = document.getElementById('forumSearchInput');
  if (bar) bar.style.display = 'none';
  if (btn) btn.classList.remove('active');
  if (input) input.value = '';
  clearTimeout(forumSearchDebounce);

  const wasActive = forumSearchActive;
  forumSearchActive = false;
  // closeForumScreen() passes silent:true — the screen's being hidden
  // anyway, so there's no visible list to restore right now, and
  // loadForumInitial() will run naturally the next time it's opened.
  if (wasActive && !opts.silent) loadForumInitial();
}

// ── Pinned welcome message ───────────────────────────────────────────────────
// One hardcoded message, referenced only by its row id, shown pinned at the
// very top of the forum screen (see #forumPinnedWrap in index.html) — above
// the composer/filters/list — on every entry point (landing's own Forum
// button, the FAB, a per-problem forum button) and every filter, since it's
// meant to be unmissable for a brand-new member no matter where they land.
// It's a perfectly ordinary 'global'-scope row in forum_messages otherwise;
// nothing server-side marks it as special, so if this ever needs to point at
// a different message instead, updating this one id is the whole change.
//
// FORUM_PINNED_MESSAGE_ID itself now comes from js/course-config.js
// (COURSES.<course>.pinnedMessageId) — each course's Supabase project has
// its own forum with its own welcome post at a different row id, so this
// can no longer be a single constant shared across courses.
const FORUM_PIN_DISMISSED_KEY  = STORAGE_PREFIX + '_forum_pin_dismissed';
const FORUM_PIN_FIRST_SEEN_KEY = STORAGE_PREFIX + '_forum_pin_first_seen';
const FORUM_PIN_HOURS_MS       = 24 * 60 * 60 * 1000;

// Fetched once per page load and cached here — the banner gets re-rendered
// on every forum open (openForumScreen/openForumFromFab) but there's no
// need to re-fetch the same row from Supabase each time.
let forumPinnedMessage = null;

// True once either the ✕ was tapped, or FORUM_PIN_HOURS_MS have passed since
// this device first actually saw the banner rendered — from that point on,
// the message is just an ordinary row in the normal chronological list
// again (see forumVisibleData below), same as everyone else's.
function isForumPinDismissed() {
  if (localStorage.getItem(FORUM_PIN_DISMISSED_KEY) === 'true') return true;

  const firstSeenRaw = localStorage.getItem(FORUM_PIN_FIRST_SEEN_KEY);
  if (!firstSeenRaw) return false;
  const firstSeen = parseInt(firstSeenRaw, 10);
  if (!Number.isFinite(firstSeen)) return false;

  if (Date.now() - firstSeen > FORUM_PIN_HOURS_MS) {
    // Persist the expiry itself rather than re-comparing timestamps forever
    // — keeps this a one-way trip regardless of clock skew afterwards.
    localStorage.setItem(FORUM_PIN_DISMISSED_KEY, 'true');
    return true;
  }
  return false;
}

// Bound to the banner's own ✕ (see renderForumPinnedBanner).
function dismissForumPin() {
  localStorage.setItem(FORUM_PIN_DISMISSED_KEY, 'true');
  renderForumPinnedBanner();
  // The currently-loaded list was built with this message skipped (see
  // forumVisibleData) — reload so it reappears in its ordinary spot if
  // it's part of whatever filter is currently selected.
  loadForumInitial();
}

// forum_messages_public (not the base table) so a nickname change or a flag
// on this row shows up the same way it would for any other message.
async function fetchForumPinnedMessage() {
  const client = getForumClient();
  if (!client) return null;
  const { data, error } = await client
    .from('forum_messages_public')
    .select('id, created_at, author_name, device_id, identity_id, body, scope, problem_key, flag_status, flag_reason, edited_at, avatar_svg, reply_to_id, reply_to_author_name, reply_to_body, reply_to_flag_status')
    .eq('id', FORUM_PINNED_MESSAGE_ID)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// Filters the pinned message out of an ordinary fetched page while it's
// still shown pinned, so it never renders twice (once up top, once in its
// natural chronological spot) — only actually removes anything for the
// 'all'/'global' filters, since fetchForumMessages() already excludes
// global-scope rows from every quiz/problem filter server-side.
function forumVisibleData(data) {
  if (isForumPinDismissed()) return data;
  return data.filter(m => m.id !== FORUM_PINNED_MESSAGE_ID);
}

// (Re)paints #forumPinnedWrap. Safe to call every time the forum opens —
// no-ops instantly once dismissed/expired, and reuses the cached row rather
// than re-fetching on repeat opens within the same page load.
async function renderForumPinnedBanner() {
  const wrap = document.getElementById('forumPinnedWrap');
  if (!wrap) return;

  if (isForumPinDismissed()) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  if (!forumPinnedMessage) forumPinnedMessage = await fetchForumPinnedMessage();
  if (!forumPinnedMessage) { wrap.style.display = 'none'; return; }

  // First time this device has actually had the banner rendered — starts
  // the 24h countdown from here, not from whenever the row was posted.
  if (!localStorage.getItem(FORUM_PIN_FIRST_SEEN_KEY)) {
    localStorage.setItem(FORUM_PIN_FIRST_SEEN_KEY, String(Date.now()));
  }

  const header = document.createElement('div');
  header.className = 'forum-pinned-header';
  const label = document.createElement('span');
  label.className = 'forum-pinned-label';
  label.textContent = '📌 Pinned';
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'forum-pinned-dismiss-btn';
  dismissBtn.title = 'Dismiss pinned message';
  dismissBtn.setAttribute('aria-label', 'Dismiss pinned message');
  dismissBtn.textContent = '✕';
  dismissBtn.addEventListener('click', dismissForumPin);
  header.appendChild(label);
  header.appendChild(dismissBtn);

  // Reuses the exact same row renderer as the ordinary list (avatar, LaTeX,
  // mentions, flag button and all) so it's visually just a normal message
  // sitting in a pinned frame, not a separate one-off rendering path to
  // keep in sync. It never carries the enter-animation, since it's already
  // there the instant the forum opens rather than sliding in.
  const row = renderForumMessage(forumPinnedMessage);
  row.classList.remove('forum-message-enter');

  wrap.innerHTML = '';
  wrap.appendChild(header);
  wrap.appendChild(row);
  wrap.style.display = '';
}

// ── Filter chips ──────────────────────────────────────────────────────────
function setForumFilter(filter) {
  if (!FORUM_FILTERS.includes(filter) || filter === forumFilter) return;
  forumFilter = filter;
  forumFilterProblemId = ''; // reset sub-filter every time the top-level chip changes
  forumPendingNewCount = 0;
  hideForumNewMsgsPill();

  const container = document.getElementById('forumFilters');
  if (container) {
    container.querySelectorAll('.sf-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });
  }
  updateForumFilterProblemSelect();
  syncForumComposerScopeFromFilter();
  loadForumInitial();
}

// Sub-filter select: only meaningful (and only shown) once one specific quiz
// chip (q1..q4) is active — for "All"/"Global" it's hidden entirely rather
// than just disabled, so it doesn't take up space when it wouldn't do
// anything. First option narrows to nothing extra ("All of Quiz N", the
// plain q1..q4 behavior), second is that quiz's general thread, and the
// rest are its individual problems — same source (QUIZZES) and shape as the
// composer's own quiz/problem selects above.
function updateForumFilterProblemSelect() {
  const sel = document.getElementById('forumFilterProblemSelect');
  if (!sel) return;

  const isQuizFilter = /^q\d+$/.test(forumFilter);
  if (!isQuizFilter) {
    sel.style.display = 'none';
    sel.innerHTML = '';
    return;
  }

  const quizNum = forumFilter.replace('q', '');
  const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[parseInt(quizNum, 10) - 1] : null;

  // Match this quiz's chip color (--q1.. --q4, same as the inline
  // --chip-color on the buttons in index.html) so the select reads as that
  // chip's own sub-option rather than a differently-themed form control.
  sel.style.setProperty('--chip-color', `var(--q${quizNum})`);

  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All';
  sel.appendChild(allOpt);

  const generalOpt = document.createElement('option');
  generalOpt.value = 'general';
  generalOpt.textContent = 'General';
  sel.appendChild(generalOpt);

  if (quiz && Array.isArray(quiz.problems)) {
    quiz.problems.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.id;
      sel.appendChild(opt);
    });
  }

  sel.value = forumFilterProblemId;
  sel.style.display = '';
}

// Mirrors the current SHOW filter (forumFilter + forumFilterProblemId) onto
// the composer's own scope selectors, one-directional: this is called from
// setForumFilter() and onForumFilterProblemChange() (the SHOW filter's own
// handlers) so changing what you're VIEWING updates what you'd post under.
// It is deliberately never called from onForumScopeQuizChange/
// onForumScopeProblemChange (the composer's own handlers just above) —
// changing what you're POSTING under never touches the SHOW filter.
//
// Mapping: "All" or "Global" (no specific quiz filtered) both post
// globally, since neither corresponds to any one quiz to post under. A
// quiz filter with no sub-filter chosen ("All of Quiz N") or with
// "General" chosen both post to that quiz's general thread — "All of
// Quiz N" has no single-problem equivalent to post under, so it falls
// back to the same general thread "General" already means. A quiz filter
// with one specific problem chosen posts to that exact problem.
function syncForumComposerScopeFromFilter() {
  const quizSel = document.getElementById('forumScopeQuizSelect');
  const probSel = document.getElementById('forumScopeProblemSelect');
  if (!quizSel || !probSel) return;

  const isQuizFilter = /^q\d+$/.test(forumFilter);

  if (!isQuizFilter) {
    forumComposerQuiz = 'global';
    forumComposerProblemId = '';
    quizSel.value = 'global';
    probSel.style.display = 'none';
    probSel.innerHTML = '';
    return;
  }

  forumComposerQuiz = forumFilter;
  forumComposerProblemId = (forumFilterProblemId && forumFilterProblemId !== 'general') ? forumFilterProblemId : '';

  quizSel.value = forumFilter;
  populateForumComposerProblemSelect(forumFilter);
  probSel.value = forumComposerProblemId;
  probSel.style.display = '';
}

// The reverse direction from syncForumComposerScopeFromFilter() above —
// mirrors the composer's scope onto the SHOW filter instead. Deliberately
// NOT called from onForumScopeQuizChange/onForumScopeProblemChange (picking
// a different quiz/problem to post under shouldn't change what you're
// viewing on its own); only called from submitForumMessage() right after a
// send succeeds, so the feed you're looking at lines up with wherever you
// just posted. Mirrors the same mapping as the other direction: Global
// scope -> the 'global' chip; a quiz with no specific problem -> that
// quiz's 'general' sub-filter; a quiz with one specific problem -> that
// exact problem.
function syncForumFilterFromComposerScope() {
  const newFilter = forumComposerQuiz === 'global' ? 'global' : forumComposerQuiz;
  const newSubFilter = forumComposerQuiz === 'global' ? '' : (forumComposerProblemId || 'general');
  if (newFilter === forumFilter && newSubFilter === forumFilterProblemId) return;

  forumFilter = newFilter;
  forumFilterProblemId = newSubFilter;
  forumPendingNewCount = 0;
  hideForumNewMsgsPill();

  const container = document.getElementById('forumFilters');
  if (container) {
    container.querySelectorAll('.sf-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === newFilter);
    });
  }
  updateForumFilterProblemSelect();
}

function onForumFilterProblemChange() {
  const sel = document.getElementById('forumFilterProblemSelect');
  if (!sel) return;
  forumFilterProblemId = sel.value;
  syncForumComposerScopeFromFilter();
  loadForumInitial();
}

// ── Per-problem forum button (solve-all mode) ───────────────────────────────
// One request for every problem's count instead of one query per card: pulls
// every problem-scope message's id+problem_key and groups client-side. Cheap
// (two small columns) and scales with message volume, not problem count.
async function forumCountsByProblemKey() {
  const counts = new Map();
  const client = getForumClient();
  if (!client) return counts;
  const { data, error } = await client
    .from('forum_messages_public')
    .select('id, problem_key, body, reply_to_author_name')
    .eq('scope', 'problem');
  if (error || !data) return counts;
  const lastSeenId = getForumLastSeenId();
  const ownNameLower = getForumIdentityName().trim().toLowerCase();
  data.forEach(({ id, problem_key, body, reply_to_author_name }) => {
    if (!problem_key) return;
    const entry = counts.get(problem_key) || { total: 0, unread: 0, mentioned: false };
    entry.total++;
    if (id > lastSeenId) {
      entry.unread++;
      if (forumBodyMentionsName(body, ownNameLower) || (reply_to_author_name || '').toLowerCase() === ownNameLower) entry.mentioned = true;
    }
    counts.set(problem_key, entry);
  });
  return counts;
}

// Paints each solve-all card's forum button from the map above. Unread wins:
// shows just the unread count, badge colored like the rest of the app's
// unread indicators; otherwise shows the thread's total (0 if empty), muted.
// Refreshes solve-all's per-problem buttons every 5s while that mode is
// open (started/stopped from quiz-engine.js's _startSolveAllCore/
// exitSolveAll) — a separate timer from FORUM_POLL_INTERVAL_MS (which drives
// the main/FAB unread badge), but kept at the same cadence so the two badge
// styles visibly refresh together instead of the FAB looking stuck.
const FORUM_PROBLEM_COUNTS_POLL_MS = 5000;
let forumProblemCountsPollTimer = null;

function startForumProblemCountsPolling() {
  if (forumProblemCountsPollTimer) return;
  forumCountsByProblemKey().then(applyForumProblemCounts);
  forumProblemCountsPollTimer = setInterval(() => {
    forumCountsByProblemKey().then(applyForumProblemCounts);
  }, FORUM_PROBLEM_COUNTS_POLL_MS);
}
function stopForumProblemCountsPolling() {
  if (forumProblemCountsPollTimer) { clearInterval(forumProblemCountsPollTimer); forumProblemCountsPollTimer = null; }
}

// Shared painter for both solve-all's "sa-forum-" cards and plain Random 6's
// "rq-forum-" cards — same badge/total/@ markup, just a different id prefix
// and source array, so one pass covers whichever of the two is currently
// rendered (harmless no-op on the one that isn't: the elements just won't
// exist and forEach bails per-card via the null check).
function paintForumProblemButtons(list, prefix, counts) {
  if (!list) return;
  list.forEach((p, i) => {
    const totalEl = document.getElementById(prefix + 'total-' + i);
    const badgeEl = document.getElementById(prefix + 'badge-' + i);
    const atEl    = document.getElementById(prefix + 'at-' + i);
    if (!totalEl || !badgeEl || !atEl) return;
    const fullKey = 'q' + (p._quizNum || selectedQuizNum) + '_' + p.id;
    const c = counts.get(fullKey) || { total: 0, unread: 0, mentioned: false };
    if (c.unread > 0) {
      totalEl.textContent = '';
      badgeEl.textContent = c.unread > 9 ? '9+' : String(c.unread);
      badgeEl.style.display = 'flex';
      atEl.style.display = c.mentioned ? 'flex' : 'none';
    } else {
      totalEl.textContent = String(c.total);
      badgeEl.style.display = 'none';
      atEl.style.display = 'none';
    }
  });
}

function applyForumProblemCounts(counts) {
  paintForumProblemButtons(typeof solveAllProblems !== 'undefined' ? solveAllProblems : null, 'sa-forum-', counts);
  paintForumProblemButtons(typeof quiz !== 'undefined' ? quiz : null, 'rq-forum-', counts);
  paintForumProblemButtons(typeof _reviewProblemsForCounts !== 'undefined' ? _reviewProblemsForCounts : null, 'rv-forum-', counts);
}

// Set only for the duration of a forum visit opened via a per-problem
// button (openForumForProblem) — lets closeForumScreen() know to undo the
// space-saving layout below on the way out, same pattern as forumFabHostId.
let forumProblemOnlyMode = false;

// Hides the scope-picker row and the SHOW filter bar (redundant once both
// are already locked to one problem) to free up vertical space for the
// thread itself; shows/hides the collapsed problem-context panel to match.
function setForumProblemOnlyMode(on) {
  forumProblemOnlyMode = on;
  const scopeRow = document.getElementById('forumComposerScopeRow');
  const filters  = document.getElementById('forumFilters');
  const ctx      = document.getElementById('forumProblemContext');
  if (scopeRow) scopeRow.style.display = on ? 'none' : '';
  if (filters)  filters.style.display  = on ? 'none' : '';
  if (ctx)      ctx.style.display      = on ? '' : 'none';
}

// Looks up the problem's own text from QUIZZES (same data solve-all cards
// already use) and (re)collapses the context panel to it.
function showForumProblemContext(quizNum, problemId) {
  const toggle = document.getElementById('forumProblemContextToggle');
  const body   = document.getElementById('forumProblemContextBody');
  if (!toggle || !body) return;
  const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[quizNum - 1] : null;
  const problem = quiz && Array.isArray(quiz.problems) ? quiz.problems.find(pr => pr.id === problemId) : null;
  body.innerHTML = problem ? problem.text : '';
  body.dataset.problemId = problemId;
  body.style.display = '';
  toggle.textContent = '▾ Hide ' + problemId;
  toggle.dataset.expanded = 'true';
  if (typeof renderMathIn === 'function') renderMathIn(body);
}

function toggleForumProblemContext() {
  const toggle = document.getElementById('forumProblemContextToggle');
  const body   = document.getElementById('forumProblemContextBody');
  if (!toggle || !body) return;
  const wasExpanded = toggle.dataset.expanded === 'true';
  body.style.display = wasExpanded ? 'none' : '';
  toggle.dataset.expanded = wasExpanded ? 'false' : 'true';
  toggle.textContent = (wasExpanded ? '▸ Show ' : '▾ Hide ') + (body.dataset.problemId || 'problem');
  if (!wasExpanded && typeof renderMathIn === 'function') renderMathIn(body);
}

// Opens the forum landed directly on one problem's thread — both the quiz
// chip and its problem sub-filter switch to it, same end state as picking
// them by hand. Reuses openForumFromFab()'s own open/animate/host-detect
// logic rather than duplicating it; the extra timeout just applies the
// filter after that flow's own reset-to-"All" settles.
function openForumForProblem(quizNum, problemId) {
  openForumFromFab();
  setTimeout(() => {
    forumFilter = 'q' + quizNum;
    forumFilterProblemId = problemId;
    const container = document.getElementById('forumFilters');
    if (container) {
      container.querySelectorAll('.sf-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === forumFilter);
      });
    }
    updateForumFilterProblemSelect();
    syncForumComposerScopeFromFilter();
    loadForumInitial();
    showForumProblemContext(quizNum, problemId);
    setForumProblemOnlyMode(true);
  }, 290);
}

// ── Unread badge + polling ───────────────────────────────────────────────────
// Marks everything currently in the table as "seen" — called when the forum
// screen is opened, independent of whatever filter happens to be selected,
// since the badge tracks unread across the whole forum, not just one filter.
async function markForumAsRead() {
  const client = getForumClient();
  if (!client) return;
  const { data, error } = await client
    .from('forum_messages')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (!error && data && data.length > 0) setForumLastSeenId(data[0].id);
  setForumUnreadBadge(0);
}

// Cap on how many unread rows are pulled just to check for an own-name
// mention. The numeric badge itself only ever displays up to "9+" anyway
// (setForumUnreadBadge), so anything past this cap can't change what's
// shown for the count — it could only miss a mention buried deep in a large
// backlog, which is an acceptable tradeoff for not fetching an unbounded
// number of message bodies on every poll.
const FORUM_UNREAD_MENTION_SCAN_LIMIT = 100;

// True if `body` contains an "@name" mention matching `ownNameLower`
// (already lowercased). Shares the exact same mention shape
// (FORUM_MENTION_RE) as the composer/renderer use, so this only counts as
// "tagged" what would actually render as a tappable @mention chip.
function forumBodyMentionsName(body, ownNameLower) {
  if (!ownNameLower) return false;
  FORUM_MENTION_RE.lastIndex = 0;
  let match;
  while ((match = FORUM_MENTION_RE.exec(body)) !== null) {
    if (match[1].toLowerCase() === ownNameLower) return true;
  }
  return false;
}

async function pollForumUnread() {
  if (forumScreenOpen) return; // badge is irrelevant while already looking at the forum
  const client = getForumClient();
  if (!client) return;

  const lastSeenId = getForumLastSeenId();
  const ownNameLower = getForumIdentityName().trim().toLowerCase();

  // Pulls the actual rows (not just a count) so a mention can be detected —
  // see FORUM_UNREAD_MENTION_SCAN_LIMIT above for why this is capped rather
  // than an exact unbounded count like the old head-count-only query.
  const { data, error } = await client
    .from('forum_messages_public')
    .select('id, body, reply_to_author_name')
    .gt('id', lastSeenId)
    .order('id', { ascending: false })
    .limit(FORUM_UNREAD_MENTION_SCAN_LIMIT);

  if (error) { console.error('Forum unread poll error:', error); return; }

  const count = data ? data.length : 0;
  const mentioned = ownNameLower && data
    ? data.some(msg => forumBodyMentionsName(msg.body, ownNameLower) || (msg.reply_to_author_name || '').toLowerCase() === ownNameLower)
    : false;
  setForumUnreadBadge(count, mentioned);
}

function startForumPolling() {
  if (forumPollTimer) return;
  pollForumUnread(); // check immediately, don't wait a full interval
  forumPollTimer = setInterval(pollForumUnread, FORUM_POLL_INTERVAL_MS);
}
function stopForumPolling() {
  if (forumPollTimer) { clearInterval(forumPollTimer); forumPollTimer = null; }
}

// ── Live updates while the forum screen is open ──────────────────────────────
// The list shows newest-first (top of #forumMessageList), so a genuinely new
// message needs to appear at the TOP, not the bottom. That has different
// scroll implications than a bottom-anchored chat: someone sitting at the
// top of the page (window.scrollY ~0, i.e. already reading the newest stuff)
// can just have new rows prepended — the same instinctive "feed grew"
// behavior tabs like Twitter use. Someone scrolled down into older messages
// would have everything shifted underneath them if we prepended silently, so
// instead we insert the rows (keeping the DOM/cache correct) but hold their
// visual scroll position steady via a document-scrollHeight-delta
// adjustment, and surface a small dismissible pill (#forumNewMsgsPill) they
// can tap to jump back to the top and see what arrived — never auto-
// scrolling them there. (The page itself scrolls now, not an inner
// .forum-list scroll container — see the history note atop forum.css.)
function startForumLivePolling() {
  if (forumLiveTimer) return;
  forumLiveTimer = setInterval(forumLiveTick, FORUM_LIVE_POLL_MS);
}
function stopForumLivePolling() {
  if (forumLiveTimer) { clearInterval(forumLiveTimer); forumLiveTimer = null; }
  forumPendingNewCount = 0;
  hideForumNewMsgsPill();
}

async function forumLiveTick() {
  if (!forumScreenOpen || forumLoadingMore || forumSearchActive) return;

  checkForumBanStatus(); // fire-and-forget, keeps the ban banner/countdown fresh

  const { data, error } = await fetchForumMessages(); // first page of the currently-active filter
  if (error || !data || data.length === 0) return;

  const cacheKey = forumCacheKey();
  const priorCache = forumMessageCache[cacheKey] || [];
  const cachedTop = priorCache[0];
  const knownTopId = cachedTop ? cachedTop.id : 0;

  // Newest-first from the server; keep only rows we haven't shown yet, then
  // re-sort newest-first so they're inserted above the fold in the right
  // order (oldest-of-the-new-batch ends up directly above the old top row).
  const freshMsgs = data.filter(m => m.id > knownTopId).sort((a, b) => b.id - a.id);

  // Separately: rows already on screen whose flag_status/flag_reason/body
  // changed since the last tick — most importantly a flag going
  // null → 'reviewing' → 'kept'/'deleted'. Previously this tick only ever
  // looked at brand-new ids and returned early when there weren't any, so an
  // in-place status change on an already-visible message sat stale until
  // some unrelated full reload (switching filters, reopening the forum)
  // happened to repaint it. Comparing against the PRIOR cache (what we last
  // knew) rather than `data` (what just arrived) is what surfaces that
  // transition live, on the very next tick after it happens server-side.
  const priorById = new Map(priorCache.map(m => [m.id, m]));
  const changedMsgs = data.filter(m => {
    const prior = priorById.get(m.id);
    if (!prior) return false; // brand new — handled by freshMsgs above
    return prior.body !== m.body
      || (prior.flag_status || '') !== (m.flag_status || '')
      || (prior.flag_reason || '') !== (m.flag_reason || '')
      // A rename (claim-nickname.ts) changes author_name and re-seeds
      // avatar_svg on every message that identity ever posted, without
      // touching body/flag_status/flag_reason at all — needs its own check
      // here for the same reason the render-side reuse check needs one (see
      // renderForumMessageList), or a renamed poster's older messages would
      // sit showing their old name/avatar on everyone else's screen until
      // some unrelated change happened to repaint them.
      || prior.author_name !== m.author_name
      || (prior.avatar_svg || '') !== (m.avatar_svg || '');
  });

  forumMessageCache[cacheKey] = data;

  if (freshMsgs.length === 0 && changedMsgs.length === 0) return;

  const list = document.getElementById('forumMessageList');
  if (!list || !list.firstChild || !list.firstChild.dataset || !list.firstChild.dataset.msgId) {
    // Nothing sensible to update in place (empty state, error state, etc.) —
    // just let the next full reload (filter switch, reopen) pick this up.
    return;
  }

  // Swap in updated rows for anything that changed, in place, before
  // touching scroll position for any newly-arrived messages below.
  changedMsgs.forEach(msg => {
    const row = list.querySelector(`[data-msg-id="${msg.id}"]`);
    if (row) row.replaceWith(renderForumMessage(msg));
  });

  if (freshMsgs.length === 0) return;

  const nearTop = window.scrollY < 40;
  const prevScrollHeight = document.documentElement.scrollHeight;
  const prevScrollY      = window.scrollY;

  const frag = document.createDocumentFragment();
  freshMsgs.forEach(msg => frag.appendChild(renderForumMessage(msg)));
  list.insertBefore(frag, list.firstChild);

  if (nearTop) {
    window.scrollTo(0, 0); // pin to the very top as new rows keep landing there
  } else {
    // Keep whatever the reader was looking at in the same visual spot. The
    // page (not the list) is what scrolls now, so measure against the whole
    // document's height instead of the old list.scrollTop/scrollHeight.
    window.scrollTo(0, prevScrollY + (document.documentElement.scrollHeight - prevScrollHeight));
    forumPendingNewCount += freshMsgs.length;
    showForumNewMsgsPill();
  }
}

function showForumNewMsgsPill() {
  const pill = document.getElementById('forumNewMsgsPill');
  if (!pill) return;
  pill.textContent = forumPendingNewCount === 1
    ? '▲ 1 new message'
    : `▲ ${forumPendingNewCount} new messages`;
  pill.style.display = 'block';
}

function hideForumNewMsgsPill() {
  const pill = document.getElementById('forumNewMsgsPill');
  if (pill) pill.style.display = 'none';
}

function scrollForumToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  forumPendingNewCount = 0;
  hideForumNewMsgsPill();
}

// How close to the bottom of the page (in px) before older messages start
// loading automatically. Non-zero so the fetch kicks off a bit before the
// user actually hits the bottom — by the time they get there, the next
// page is already rendered instead of them seeing a blank gap first.
const FORUM_INFINITE_SCROLL_THRESHOLD_PX = 600;

// If the reader scrolls back to the top on their own (rather than tapping
// the pill), the pill no longer means anything — clear it the same way.
// Also drives infinite scroll: once the reader nears the bottom of the
// page, load the next page of older messages automatically instead of
// requiring a tap on "Load older messages" (loadForumOlder() already
// no-ops on its own while a fetch is in flight, once everything's loaded,
// or while search results are showing, so it's safe to call on every
// qualifying scroll tick without extra guards here).
function onForumListScroll() {
  if (!forumScreenOpen) return; // the listener below is on window, so guard against firing while browsing the quiz
  if (window.scrollY < 40 && forumPendingNewCount > 0) {
    forumPendingNewCount = 0;
    hideForumNewMsgsPill();
  }

  const distanceToBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  if (distanceToBottom < FORUM_INFINITE_SCROLL_THRESHOLD_PX) {
    loadForumOlder();
  }
}

// Polling only makes sense while the person is actually looking at the main
// screen with the tab in focus — not mid-quiz, and not in a backgrounded
// tab. Rather than thread start/stop calls through every screen-transition
// function elsewhere in the app, watch #landingScreen's own visibility
// (via its "hidden" class) plus the page's visibility state, and let those
// two signals drive polling on their own.
function initForumPollingWatcher() {
  const landing = document.getElementById('landingScreen');
  const wrap    = document.getElementById('forumFabWrap');
  if (!landing) return;

  const sync = () => {
    const onMainScreen = !landing.classList.contains('hidden');
    // forum-fab-visible is kept accurate by syncForumFabVisibility (below)
    // for every other screen the FAB can appear on, so piggyback on it
    // instead of re-deriving "is the FAB up" from scratch here.
    const fabVisible = wrap && wrap.classList.contains('forum-fab-visible');
    if ((onMainScreen || fabVisible) && !forumScreenOpen && !document.hidden) startForumPolling();
    else stopForumPolling();
  };

  new MutationObserver(sync).observe(landing, { attributes: true, attributeFilter: ['class'] });
  if (wrap) new MutationObserver(sync).observe(wrap, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  sync();
}

// ── Screen open / close (mirrors openStatsScreen/closeStatsScreen) ──────────
function openForumScreen() {
  const landing = document.getElementById('landingScreen');
  const forum   = document.getElementById('forumScreen');
  if (!landing || !forum) return;

  stopForumPolling();
  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  landing.classList.add('fading-out');
  setTimeout(() => {
    landing.classList.add('hidden');
    landing.classList.remove('fading-out');
    forum.classList.add('visible');
    forumScreenOpen = true;
    // Opened from the main-page button (as opposed to the side FAB, which
    // keeps whatever filter was last active) — always land on "All" in both
    // the SHOW filter and its problem sub-filter, regardless of what was
    // selected on a previous visit.
    forumFilter = 'all';
    forumFilterProblemId = '';
    const filterContainer = document.getElementById('forumFilters');
    if (filterContainer) {
      filterContainer.querySelectorAll('.sf-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === 'all');
      });
    }
    updateForumFilterProblemSelect();
    resetForumComposerScope();
    refreshForumIdentityUI();
    renderForumPinnedBanner();
    checkForumBanStatus();
    loadForumInitial();
    markForumAsRead();
    startForumLivePolling();
  }, 280);
}

// ── Floating button: open the forum from any screen ──────────────────────────
// The main-screen "💬 Forum" button (openForumScreen, above) only ever has
// to hide the landing screen — it's never reachable from anywhere else. The
// floating button (forum-fab-wrap in index.html) is visible on other
// screens too (see syncForumFabVisibility below), so opening the forum from
// there also needs to hide *that* screen, and closing needs to bring back
// the right one rather than always landing on the landing screen.
//
// Each entry mirrors the exact show/hide convention that screen's own code
// (quiz-engine.js / stats.js) already uses — reusing the real signal rather
// than inventing a second one that could drift out of sync with it.
const FORUM_FAB_HOSTS = [
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
    id: 'choicePage',
    isVisible: el => !el.classList.contains('hidden'),
    hide:      el => el.classList.add('hidden'),
    show:      el => el.classList.remove('hidden', 'fading-out'),
    scrollY: 0,
  },
];

// Set for the duration of a FAB-opened forum visit to whichever host above
// was actually showing at that moment — null whenever the forum was opened
// the ordinary way, from the landing screen's own button. closeForumScreen()
// reads this to know whether to restore that screen or fall back to landing.
let forumFabHostId = null;

// Bound to the FAB's own onclick (index.html) instead of openForumFromFab()
// directly. Now that the FAB stays visible for the whole time the forum is
// open on top of one of FORUM_FAB_HOSTS (see keepFabWhileInForum in
// syncForumFabVisibility), tapping it a second time needs to close the
// forum rather than trying to open it again. openForumForProblem() still
// calls openForumFromFab() directly (not this), since switching a
// per-problem button while the forum is already open should jump that
// thread, not toggle it closed.
function toggleForumFab() {
  const forum = document.getElementById('forumScreen');
  if (forum && forum.classList.contains('visible')) {
    closeForumScreen(false);
    return;
  }
  openForumFromFab();
}

function openForumFromFab() {
  const forum = document.getElementById('forumScreen');
  if (!forum) return;

  const host = FORUM_FAB_HOSTS.find((h) => {
    const el = document.getElementById(h.id);
    return el && h.isVisible(el);
  });

  // Shouldn't normally happen — the FAB hides itself on the landing screen
  // and on a plain Random 6 quiz, see syncForumFabVisibility — but fall back
  // to the ordinary landing-based open rather than doing nothing.
  if (!host) { openForumScreen(); return; }

  const hostEl = document.getElementById(host.id);
  host.scrollY = typeof captureScreenScroll === 'function' ? captureScreenScroll() : (window.scrollY || 0);

  stopForumPolling();
  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  hostEl.classList.add('fading-out');
  setTimeout(() => {
    host.hide(hostEl);
    forumFabHostId = host.id;
    forum.classList.add('visible');
    forumScreenOpen = true;
    if (typeof scrollScreenToTop === 'function') scrollScreenToTop();
    else window.scrollTo(0, 0);
    resetForumComposerScope();
    refreshForumIdentityUI();
    renderForumPinnedBanner();
    checkForumBanStatus();
    loadForumInitial();
    markForumAsRead();
    startForumLivePolling();
  }, 280);
}

// `forceLanding` is true only when goToMainMenu() (quiz-engine.js) closes the
// forum via the site logo/main-menu action — that's a distinct, more
// explicit "take me all the way home" than the forum's own ✕ Close button,
// which instead returns to wherever the forum was actually opened from.
function closeForumScreen(forceLanding) {
  const landing = document.getElementById('landingScreen');
  const forum   = document.getElementById('forumScreen');
  if (!landing || !forum) return;

  stopForumLivePolling();
  if (forumProblemOnlyMode) setForumProblemOnlyMode(false);
  exitForumSearch({ silent: true });

  // Polling is paused the whole time the forum screen is open, so anything
  // that showed up while you were on it — including a message you just sent
  // yourself — wouldn't otherwise get swept into "last seen" until this.
  markForumAsRead();

  forum.classList.add('fading-out');
  setTimeout(() => {
    forum.classList.remove('visible', 'fading-out');
    forumScreenOpen = false;
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);

    const hostId = forumFabHostId;
    forumFabHostId = null;

    if (forceLanding && typeof exitAppOrChoiceToLanding === 'function') {
      // Also unwinds solve-all/mistakes state the same way leaving that
      // screen normally does — not just "hide forum, show landing" — see
      // exitAppOrChoiceToLanding() in quiz-engine.js.
      exitAppOrChoiceToLanding();
      return;
    }

    if (hostId) {
      const host = FORUM_FAB_HOSTS.find(h => h.id === hostId);
      const hostEl = host && document.getElementById(hostId);
      if (host && hostEl) {
        host.show(hostEl);
        if (typeof restoreScreenScroll === 'function') restoreScreenScroll(host.scrollY);
        else window.scrollTo(0, host.scrollY || 0);
      }
      return;
    }

    // Original behavior: opened from the landing screen's own Forum button.
    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
  }, 280);
}

// ── Floating button visibility ────────────────────────────────────────────
// Visible on any screen except the landing screen (which already has the
// big "💬 Forum" button) and a plain "Random 6" quiz still in progress
// (appPage visible, neither solve-all nor mistakes mode active, and not yet
// checked) — per Ansar's call. Once that attempt is checked, it's no
// longer "plain" (there's a result to discuss) and the FAB reappears, same
// as every other screen — see the `checked` check below and its call sites
// in quiz-engine.js's checkAll()/newQuiz().
// Driven by MutationObservers on each relevant screen's class attribute,
// same pattern as initForumPollingWatcher above, rather than hooking into
// every screen-transition function elsewhere in the app.
function syncForumFabVisibility() {
  const wrap = document.getElementById('forumFabWrap');
  if (!wrap) return;

  const landing  = document.getElementById('landingScreen');
  const forum    = document.getElementById('forumScreen');
  const appPage  = document.getElementById('appPage');
  const solveAll = document.getElementById('solveAllMode');
  const mistakes = document.getElementById('mistakesMode');
  if (!landing || !appPage) return;

  const onLanding = !landing.classList.contains('hidden');
  const inForum   = forum && forum.classList.contains('visible');
  // `checked` (quiz-engine.js) flips true once "Check answers" runs on a
  // plain Random 6 attempt — at that point there's a result to discuss, so
  // this no longer counts as "plain" and the FAB (plus each card's own
  // per-problem "Discuss" button, revealed the same moment in checkAll())
  // should show. Still hidden for the entire rest of the attempt, i.e.
  // while actually answering. checkAll()/newQuiz() call this function
  // directly since flipping `checked` alone is not a class mutation and
  // wouldn't otherwise trigger a re-sync.
  const inPlainRandom6 =
    appPage.classList.contains('visible') &&
    !(solveAll && solveAll.classList.contains('active')) &&
    !(mistakes && mistakes.classList.contains('active')) &&
    !(typeof checked !== 'undefined' && checked);

  // Once the forum was reached via the FAB (or a per-problem forum button,
  // which reuses the same open path) from solve-all/mistakes/stats/choice,
  // forumFabHostId is set — keep the FAB showing instead of hiding it, so
  // it's still there to tap closed (see toggleForumFab). Opened the
  // "ordinary" way instead, from the landing screen's own Forum button,
  // forumFabHostId stays null and the FAB is hidden exactly like before.
  const keepFabWhileInForum = inForum && !!forumFabHostId;

  wrap.classList.toggle('forum-fab-visible', keepFabWhileInForum || (!onLanding && !inForum && !inPlainRandom6));
}

function initForumFabWatcher() {
  const watchIds = ['landingScreen', 'forumScreen', 'appPage', 'solveAllMode', 'mistakesMode', 'statsScreen', 'reviewScreen', 'choicePage'];
  watchIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(syncForumFabVisibility).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  syncForumFabVisibility();
}

populateForumComposerQuizSelect();
renderForumEqQuickGrid();
initForumBodyHoverPreview();
initForumPollingWatcher();
initForumFabWatcher();
renderLandingIdentity(getForumNickname());

(function initForumListScrollWatcher() {
  window.addEventListener('scroll', onForumListScroll);
})();
