// ── Lockdown mode (Safe Exam Browser) ───────────────────────────────────────
// An optional way to take a random quiz: starting one offers Ordinary or
// Lockdown (Settings > Study remembers the answer), and Lockdown opens this
// site inside Safe Exam Browser (SEB), which fills the screen and blocks other
// apps and sites until the student exits. Ordinary is untouched.
//
// This file is what every visitor needs: the choice, and collecting attempts.
// What only matters inside SEB is in js/lockdown-session.js and
// js/calculator.js, loaded from here when this page finds itself in SEB.
// Loaded in <head>, right after course-config.js, so html.lockdown is set
// before the page paints and css/lockdown-session.css can hide the rest of the site.
//
// Config files: seb/<hostname>.seb, made by tools/seb/make_config.py. A host
// needs one here AND in that script's HOSTS, or the choice is skipped (draft
// deploys have their own host, so it never shows there).
//
// Saving attempts: SEB is a separate browser with no identity of its own, so
// the attempt travels through a drop-off (superbase/edge-functions/
// lockdown-dropoff.ts). The normal browser makes a random ticket and puts it in
// the SEB link, SEB leaves each finished attempt under that ticket, and the
// normal browser collects them into its own Stats, from where the usual sync
// takes them. SEB itself never learns who the student is. A database trigger
// pings the ticket's Realtime channel the moment an attempt lands (migration
// 018), so that happens at once; polling is only the fallback.
//
// No database, no lockdown: an attempt that can't reach the drop-off is lost
// when SEB closes. openLockdownView() asks /db-status (js/db-status.js) before
// opening SEB, and SEB's own Start button goes away if it finds the same.
//
// This only shapes the page, it is not a security check: the keys SEB offers
// are never verified, and grading stays in the browser, as in normal mode.

const LOCKDOWN_HOSTS = ['phys161.netlify.app', 'phys162.netlify.app', 'localhost'];
const LOCKDOWN_DROPOFF_URL = `${SUPABASE_URL}/functions/v1/lockdown-dropoff`;

// Normal browser: tickets it is still waiting on, as [{ id, createdAt }].
// Kept longer than the server keeps a row (RETENTION_HOURS, 7 days from saving,
// in lockdown-dropoff.ts). The ticket's age counts from starting lockdown, so
// a shorter life could drop it while its attempt is still waiting there.
const LOCKDOWN_TICKETS_KEY = `${STORAGE_PREFIX}_lockdown_tickets`;
const LOCKDOWN_TICKET_TTL_MS = 8 * 24 * 60 * 60 * 1000;
const LOCKDOWN_MAX_TICKETS = 10;
// How often a ticket may be asked about. A ticket lives for days, so these keep
// it from costing a request every time someone switches tabs.
//  Waiting: an attempt could land soon. Until SEB says it opened that means the
//  first minutes only, as a student who never had SEB would otherwise count.
//  Settled: everything else, which is read now and then until it expires.
const LOCKDOWN_WAITING_NOT_OPENED_MS = 15 * 60 * 1000;
const LOCKDOWN_WAITING_OPENED_MS = 3 * 60 * 60 * 1000;
const LOCKDOWN_WAITING_GAP_MS = 55 * 1000;
const LOCKDOWN_SETTLED_GAP_MS = 30 * 60 * 1000;
// Fallback for a missed ping, for waiting tickets with no live channel. A
// return from SEB may fire no focus event (on Windows it runs on its own
// desktop), so that can't be relied on either.
const LOCKDOWN_POLL_MS = 60 * 1000;

// Only SEB loads these: everyone else never downloads them. Parser-inserted, so
// they hold the first paint and run before the page's other scripts. The list
// keeps this exact form for minify.py, which swaps it for one bundle of each.
const LOCKDOWN_SESSION_FILES = ["css/lockdown-session.css", "css/calculator.css", "js/lockdown-session.js", "js/calculator.js"];

// True inside SEB. SafeExamBrowser is its JavaScript API; the user agent is the
// fallback in case the API isn't injected yet when this runs.
function isLockdownSession() {
  return typeof window.SafeExamBrowser !== 'undefined' || /\bSEB\//.test(navigator.userAgent);
}

// The look travels in the link too, because SEB can't see this browser's
// storage: base64url, so it stays one plain value inside the SEB link.
function lockdownThemeParam() {
  try {
    const color = getColorTheme();
    const look = {
      color,
      mode: document.body.classList.contains('light') ? 'light' : 'dark',
      font: getSetting('display', 'uiFont'),
    };
    if (color === 'custom') look.custom = getCustomDraft();
    return btoa(JSON.stringify(look)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) { return ''; } // no theme is better than no lockdown
}

if (isLockdownSession()) {
  document.documentElement.classList.add('lockdown');
  LOCKDOWN_SESSION_FILES.forEach((file) => {
    document.write(file.endsWith('.css')
      ? `<link rel="stylesheet" href="${file}">`
      : `<script src="${file}"><\/script>`);
  });
}

async function lockdownDropoffCall(body) {
  const res = await fetch(LOCKDOWN_DROPOFF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'dropoff_failed');
  return data;
}

// ── Normal browser: the choice, and collecting what SEB left ────────────────

function loadLockdownTickets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCKDOWN_TICKETS_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t && Date.now() - t.createdAt < LOCKDOWN_TICKET_TTL_MS);
  } catch (e) { return []; }
}

function saveLockdownTickets(tickets) {
  try { localStorage.setItem(LOCKDOWN_TICKETS_KEY, JSON.stringify(tickets)); } catch (e) { /* private mode / quota */ }
}

// seb:// and sebs:// tell SEB to fetch the config over http and https. SEB
// passes on only what follows a SECOND "?", appending it to the start URL
// (startURLAppendQueryParameter in the config).
function lockdownConfigLink(ticket) {
  const scheme = location.protocol === 'https:' ? 'sebs' : 'seb';
  return `${scheme}://${location.host}/seb/${location.hostname}.seb??ticket=${ticket}&theme=${lockdownThemeParam()}`;
}

// SEB has no Android, ChromeOS or Linux version.
function lockdownUnsupportedDevice() {
  return /Android|CrOS|Linux/i.test(navigator.userAgent);
}

function lockdownAvailable() {
  return !isLockdownSession() && LOCKDOWN_HOSTS.includes(location.hostname)
    && !lockdownUnsupportedDevice() && navigator.onLine;
}

function setChoiceView(view) {
  document.getElementById('choicePage').dataset.view = view;
}

function showChoiceView(view) {
  setChoiceView(view);
  const page = document.getElementById('choicePage');
  if (page.classList.contains('hidden')) fadeInScreen(page, 380);
}

// Called by startSelected() (js/quiz-engine.js) once the main screen is gone.
function openQuizStart() {
  const saved = getSetting('study', 'quizStartMode');
  if (!lockdownAvailable() || saved === 'ordinary') {
    startRandomQuiz();
  } else if (saved === 'lockdown') {
    openLockdownView();
  } else {
    document.getElementById('quizStartRemember').checked = false;
    showChoiceView('start');
  }
}

function chooseQuizStart(choice) {
  if (document.getElementById('quizStartRemember').checked) {
    setSetting('study', 'quizStartMode', choice);
  }
  if (choice === 'lockdown') {
    openLockdownView();
  } else {
    fadeOutScreen(document.getElementById('choicePage'), 280, startRandomQuiz);
  }
}

// A page can't ask whether an app is installed, and watching it lose focus
// doesn't help: Windows' "Get an app to open this link" popup takes the focus
// just as SEB does. So the link is simply followed, and the help waits long
// enough for SEB to start, with a link for people who know they don't have it.
// The only proof SEB opened is SEB itself: this site, loaded inside it, says so
// on the ticket's channel, and the page then goes back to the main screen
// (onLockdownOpened).
const LOCKDOWN_HELP_DELAY_MS = 10 * 1000;
const LOCKDOWN_DB_CHECK_MS = 3000;    // past this, go on: the check itself is what's slow
let _lockdownHelpTimer = 0;

// The card is reset here, not on leaving, so it doesn't collapse while fading.
// Enter lockdown comes back through here, so the wait starts over.
async function openLockdownView() {
  const card = document.getElementById('lockdownCard');
  const page = document.getElementById('choicePage');
  card.classList.remove('help', 'db-blocked', 'pending-blocked');
  document.getElementById('lockdownStatus').textContent = 'Opening Safe Exam Browser…';
  showChoiceView('lockdown');
  await Promise.race([
    checkDbStatus({ force: true }),
    new Promise((resolve) => setTimeout(resolve, LOCKDOWN_DB_CHECK_MS)),
  ]);
  if (page.classList.contains('hidden') || page.dataset.view !== 'lockdown') return;  // closed meanwhile
  // Any problem, not only a confirmed one: this is the one thing that can't
  // take the chance.
  if (dbProblemText()) {
    card.classList.add('db-blocked');
    document.getElementById('lockdownStatus').textContent = 'Lockdown is unavailable';
    return;
  }
  // An account made offline (js/offline-account.js) has nowhere on the server
  // for the attempt to land until it is registered.
  if (typeof getPendingAccount === 'function' && getPendingAccount() && !getForumNickname()) {
    await syncPendingAccount();
    if (page.classList.contains('hidden') || page.dataset.view !== 'lockdown') return;
    if (getPendingAccount() && !getForumNickname()) {
      card.classList.add('db-blocked', 'pending-blocked');
      document.getElementById('lockdownStatus').textContent = 'Lockdown is unavailable';
      return;
    }
  }
  enterLockdown();
}

function takeOrdinaryQuizInstead() {
  fadeOutScreen(document.getElementById('choicePage'), 280, startRandomQuiz);
}

function enterLockdown() {
  const ticket = crypto.randomUUID();
  rememberLockdownTicket(ticket);
  const link = document.createElement('a');
  link.href = lockdownConfigLink(ticket);
  link.click();
  clearTimeout(_lockdownHelpTimer);
  _lockdownHelpTimer = setTimeout(showLockdownHelp, LOCKDOWN_HELP_DELAY_MS);
}

function showLockdownHelp() {
  clearTimeout(_lockdownHelpTimer);
  document.getElementById('lockdownCard').classList.add('help');
  document.getElementById('lockdownStatus').textContent = "Didn't open?";
}

function backFromLockdown() {
  clearTimeout(_lockdownHelpTimer);
  closeSolveAllModal();
}

function onLockdownOpened() {
  const page = document.getElementById('choicePage');
  if (!page.classList.contains('hidden') && page.dataset.view === 'lockdown') backFromLockdown();
}

// The ticket is remembered only once it's actually used.
function rememberLockdownTicket(ticket) {
  const tickets = loadLockdownTickets();
  if (!tickets.some(t => t.id === ticket)) tickets.push({ id: ticket, createdAt: Date.now() });
  saveLockdownTickets(tickets.slice(-LOCKDOWN_MAX_TICKETS));
  startLockdownPolling();
  watchLockdownTickets();
}

let _lockdownCollecting = false;
const _lockdownCollectQueue = new Set(); // tickets pinged during a collection
let _lockdownPoll = null;
const _lockdownChannels = new Map(); // ticket id -> Realtime channel

// Writes to the stored list, not a copy: a collection awaits the network, and
// a ticket added meanwhile must not be overwritten.
function updateLockdownTicket(id, fields) {
  saveLockdownTickets(loadLockdownTickets().map(t => (t.id === id ? { ...t, ...fields } : t)));
}

function lockdownTicketWaiting(ticket) {
  if (ticket.collected) return false;
  const limit = ticket.opened ? LOCKDOWN_WAITING_OPENED_MS : LOCKDOWN_WAITING_NOT_OPENED_MS;
  return Date.now() - ticket.createdAt < limit;
}

function lockdownTicketDue(ticket) {
  const gap = lockdownTicketWaiting(ticket) ? LOCKDOWN_WAITING_GAP_MS : LOCKDOWN_SETTLED_GAP_MS;
  return Date.now() - (ticket.checkedAt || 0) >= gap;
}

function lockdownChannelLive(id) {
  const channel = _lockdownChannels.get(id);
  return !!channel && channel.state === 'joined';
}

// A ping means an attempt is there now, so it skips the gaps. One arriving
// mid-collection may be for an attempt that collection already missed.
function requestLockdownCollect(id) {
  if (_lockdownCollecting) _lockdownCollectQueue.add(id);
  else collectLockdownAttempts(t => t.id === id);
}

function noteLockdownOpened(id) {
  updateLockdownTicket(id, { opened: true });
  startLockdownPolling();
  onLockdownOpened();
}

// Stays on a ticket after its first attempt, unlike polling: the student may
// still be in SEB taking another quiz. supabase-js loads late, so the callers
// include the poll tick, which picks this up once it's there.
function watchLockdownTickets() {
  if (isLockdownSession() || typeof supabase === 'undefined' || siteOff('realtime')) return;
  const client = getForumClient();
  if (!client) return;
  const young = new Set(loadLockdownTickets()
    .filter(t => Date.now() - t.createdAt < LOCKDOWN_WAITING_OPENED_MS)
    .map(t => t.id));
  _lockdownChannels.forEach((channel, id) => {
    if (young.has(id)) return;
    client.removeChannel(channel);
    _lockdownChannels.delete(id);
  });
  young.forEach((id) => {
    if (_lockdownChannels.has(id)) return;
    const channel = client.channel('lockdown:' + id)
      .on('broadcast', { event: 'changed' }, () => requestLockdownCollect(id))
      .on('broadcast', { event: 'opened' }, () => noteLockdownOpened(id));
    _lockdownChannels.set(id, channel);
    // Catches an attempt that landed before this channel was listening.
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') collectLockdownAttempts(t => t.id === id && lockdownTicketDue(t));
    });
  });
}

function lockdownStillWaiting() {
  return loadLockdownTickets().some(lockdownTicketWaiting);
}

function startLockdownPolling() {
  if (_lockdownPoll || !lockdownStillWaiting()) return;
  _lockdownPoll = setInterval(() => {
    if (lockdownStillWaiting()) {
      watchLockdownTickets();
      collectLockdownAttempts(t => lockdownTicketWaiting(t) && !lockdownChannelLive(t.id) && lockdownTicketDue(t));
    } else {
      clearInterval(_lockdownPoll);
      _lockdownPoll = null;
    }
  }, LOCKDOWN_POLL_MS);
}

async function collectLockdownAttempts(wanted = lockdownTicketDue) {
  if (isLockdownSession() || _lockdownCollecting) return;
  const all = loadLockdownTickets();
  saveLockdownTickets(all); // drops the expired ones
  const tickets = all.filter(wanted);
  if (tickets.length === 0) return;

  _lockdownCollecting = true;
  let added = false;
  try {
    for (const ticket of tickets) {
      updateLockdownTicket(ticket.id, { checkedAt: Date.now() });
      const { attempts } = await lockdownDropoffCall({ action: 'get', ticket: ticket.id });
      if (!attempts || attempts.length === 0) continue;
      const stats = loadStats();
      const known = new Set(stats.map(a => a.hash));
      attempts.forEach(a => {
        if (known.has(a.attempt_hash)) return;
        stats.push({
          hash: a.attempt_hash,
          quizNum: a.quiz_num,
          mode: a.mode,
          date: a.attempted_at,
          duration: a.duration_seconds,
          score: a.score,
          maxScore: a.max_score,
          answers: a.answers,
          locked: true,
          synced: false,
        });
        added = true;
      });
      // Saved before clearing: if clearing fails, the next read finds the
      // same attempts and the hash check above skips them.
      saveStats(stats);
      updateLockdownTicket(ticket.id, { collected: true, opened: true });
      await lockdownDropoffCall({
        action: 'clear',
        ticket: ticket.id,
        attempt_hashes: attempts.map(a => a.attempt_hash),
      });
    }
  } catch (e) {
    console.warn('Lockdown attempts not collected yet:', e);
  }
  _lockdownCollecting = false;
  if (added) {
    onLockdownOpened(); // an attempt proves SEB opened, if that message was missed
    if (typeof renderStats === 'function') renderStats();
    if (typeof syncAttempts === 'function') syncAttempts();
    if (typeof onAttemptRecorded === 'function') onAttemptRecorded();
  }
  if (_lockdownCollectQueue.size) {
    const pinged = new Set(_lockdownCollectQueue);
    _lockdownCollectQueue.clear();
    collectLockdownAttempts(t => pinged.has(t.id));
  }
}

// The student comes back to this tab after SEB closes, or opens the site anew.
window.addEventListener('load', () => {
  collectLockdownAttempts();
  if (!isLockdownSession()) startLockdownPolling();
  watchLockdownTickets();
});
window.addEventListener('focus', () => collectLockdownAttempts());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) collectLockdownAttempts();
});
