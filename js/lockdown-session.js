// ── Lockdown session ────────────────────────────────────────────────────────
// Everything that only runs inside Safe Exam Browser: the look brought over in
// the link, leaving attempts at the drop-off, and exiting. js/lockdown.js loads
// this, with the calculator, only when it finds itself in SEB. See its header.

// SEB: the ticket from the link, kept for reloads.
const LOCKDOWN_SESSION_TICKET_KEY = `${STORAGE_PREFIX}_lockdown_ticket`;

// Runs before themes.js and quiz-engine.js read these keys, so the first paint
// already has the right look. SEB's storage keeps it through reloads.
function applyLockdownLinkTheme() {
  const param = new URLSearchParams(location.search).get('theme');
  if (!param) return;
  try {
    const look = JSON.parse(atob(param.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof look.color === 'string') localStorage.setItem(`${STORAGE_PREFIX}-color-theme`, look.color);
    if (look.mode === 'light' || look.mode === 'dark') localStorage.setItem(`${STORAGE_PREFIX}-theme`, look.mode);
    if (look.custom) localStorage.setItem(`${STORAGE_PREFIX}-custom-theme`, JSON.stringify(look.custom));
    if (typeof look.font === 'string') {
      localStorage.setItem('flux_settings', JSON.stringify({ display: { uiFont: look.font } }));
      window.applyUiFont(look.font);
    }
  } catch (e) { /* a broken value just means the default look */ }
}

// js/manual.js passes its pages through this. The manual is only reachable by
// the ⓘ beside an answer box, so it keeps that one page: with the others gone
// from the data, no link or Next button can lead to them.
function lockdownManualSections(sections) {
  return sections
    .map(section => ({ ...section, subsections: section.subsections.filter(page => page.id === 'quizzes-scoring') }))
    .filter(section => section.subsections.length);
}

function lockdownSessionTicket() {
  try { return sessionStorage.getItem(LOCKDOWN_SESSION_TICKET_KEY); } catch (e) { return null; }
}

function readLockdownLinkTicket() {
  const url = new URL(location.href);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return;
  try { sessionStorage.setItem(LOCKDOWN_SESSION_TICKET_KEY, ticket); } catch (e) { /* no storage: nothing to keep it in */ }
  url.searchParams.delete('ticket');
  url.searchParams.delete('theme');
  history.replaceState(null, '', url);
  announceLockdownOpened(ticket);
}

// Tells the normal browser SEB really opened (see LOCKDOWN_HELP_DELAY_MS).
// Only the first load has a ticket in the address, so a reload stays quiet.
// supabase-js loads late, hence the retries.
function announceLockdownOpened(ticket, tries = 20) {
  if (typeof supabase === 'undefined' || typeof getForumClient !== 'function') {
    if (tries > 0) setTimeout(() => announceLockdownOpened(ticket, tries - 1), 500);
    return;
  }
  const client = getForumClient();
  const channel = client.channel('lockdown:' + ticket);
  channel.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') return;
    await channel.send({ type: 'broadcast', event: 'opened', payload: {} });
    client.removeChannel(channel);
  });
}

function setLockdownSaveNote(text) {
  const note = document.getElementById('lockdownSaveNote');
  if (note) note.textContent = text;
}

let _lockdownSaving = Promise.resolve();

// Called by recordAttemptFromQuiz() in js/stats.js with the stored attempt.
function dropOffLockdownAttempt(entry) {
  const ticket = lockdownSessionTicket();
  if (!ticket) {
    setLockdownSaveNote("This attempt can't be saved. Start lockdown from the site's button to save attempts.");
    return;
  }
  const attempt = {
    attempt_hash: entry.hash,
    quiz_num: entry.quizNum,
    mode: entry.mode,
    duration_seconds: entry.duration || 0,
    score: entry.score,
    max_score: entry.maxScore,
    answers: entry.answers,
    attempted_at: entry.date,
  };
  setLockdownSaveNote('Saving your attempt…');
  _lockdownSaving = _lockdownSaving.then(async () => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        await lockdownDropoffCall({ action: 'put', ticket, attempt });
        setLockdownSaveNote('Saved. It will appear in your Stats back in your normal browser.');
        return;
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setLockdownSaveNote("Couldn't save this attempt. Check your connection.");
  });
}

// SEB closes itself when the page navigates to the config's quitURL, so wait
// for any attempt still on its way out.
async function exitLockdown() {
  await _lockdownSaving;
  location.href = '/seb/quit.html';
}

// The top bar's exit: reachable mid-quiz, so it asks before dropping an attempt.
function requestExitLockdown() {
  confirmLeaveRandomQuiz(exitLockdown);
}

document.addEventListener('DOMContentLoaded', () => {
  readLockdownLinkTicket();
  const sub = document.querySelector('.landing-sub');
  if (sub) sub.textContent = '🔒 Lockdown mode: choose a set and hit start';
});

applyLockdownLinkTheme();
