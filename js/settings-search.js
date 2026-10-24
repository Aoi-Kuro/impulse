// ── Settings search ──────────────────────────────────────────────────────────
// The Search tab (last in SETTINGS_TABS, js/settings.js): a search box, and
// under it the matching settings as their real rows — the same markup, the
// same switches and handlers as on their own tab, so flipping one here is
// exactly flipping it there.
//
// How it works: every other tab is rendered off-screen into a scratch
// <div> on each search, and each setting is picked out of it by its
// data-row-key (plus the Go offline panel and the Backup section). Nothing
// here has to be kept in sync by hand when a tab changes: a new row with a
// data-row-key is searchable by its title and description straight away.
// SETTINGS_SEARCH_KEYWORDS below just makes it easier to find.
//
// A row and its sub-row (e.g. Go silent + Turn off automatically after 24
// hours) are shown together whichever of the two matched, since the sub
// makes no sense on its own.
//
// Matching, per word typed (see settingsSearchScore):
//   - exact word, then same word with a different ending ("animations" /
//     "animated" / "animation"), then the start of a word ("anim" while
//     still typing), then one typo (two for long words);
//   - weighted by where it matched: title > keywords > tab/section > description;
//   - a setting has to match every word to be a full match; if nothing
//     does, the settings matching the most words are offered instead;
//   - the whole query found as a phrase in the title or a keyword ranks
//     it higher still.

// What people might type when looking for each setting, by data-row-key:
// other words for the same thing, what they want to happen ("turn off",
// "hide"), and the problem they're trying to fix ("too small", "battery").
// The setting's own title, description, tab and section are searched too,
// so they aren't repeated here.
const SETTINGS_SEARCH_KEYWORDS = {
  // ── Display · Icons
  iconStyle: 'icons, icon style, emoji, emojis, symbols, pictograms, drawn icons, line icons, outline icons, flat icons, monochrome icons, colorful icons, colourful icons, glyphs, classic, modern, look, appearance',

  // ── Display · Main screen
  showAvatar: 'avatar, profile picture, profile pic, pfp, photo, identity, nickname, username, user icon, account, my name, signed in, circle, face, hide avatar, remove avatar, turn off avatar',
  showSplashes: 'splash, splashes, splash text, yellow text, minecraft, funny text, jokes, tagline, slogan, quote, rotating text, bouncing text, floating text, badge, title text, distracting text, hide splash, remove splash',
  showManualBtn: 'manual, user manual, help, guide, instructions, tutorial, how to use, documentation, docs, faq, book, book icon, top bar button, toolbar, header icons, hide manual, remove manual button',
  showThemeBtn: 'theme, themes, theme picker, theme selector, color theme, colour theme, colors, colours, palette, paint, skin, appearance, customize colors, accent color, top bar button, toolbar, header icons, hide theme button',
  showDaylightBtn: 'dark mode, light mode, night mode, day mode, daylight, sun, moon, brightness, black background, white background, dark theme, light theme, toggle, switch, eye strain, top bar button, toolbar, header icons',
  followDeviceTheme: 'system theme, device theme, auto dark mode, automatic dark mode, os theme, phone settings, computer settings, follow system, match system, dark mode automatically, light mode automatically, night automatically, sunset, schedule, auto light, auto dark',

  // ── Display · Animations and figures
  reduceMotion: 'reduce motion, animations, animation, motion, turn off animations, disable animations, stop animations, no animations, remove animations, transitions, effects, fancy effects, smooth, instant, fast, faster, speed up, performance, lag, laggy, slow, slow phone, battery, power saving, motion sickness, dizzy, nausea, accessibility, distracting, calm, moving, movement, stop moving, things moving, phone dies, battery drain, drains battery, overheating, hot phone',
  reduceMotionBattery: 'battery, low battery, battery saver, battery saving, power saving, save battery, low power mode, energy, charge, charging, percent, automatic, auto reduce motion, animations battery, phone dying, phone dies, dies fast, battery drain, drains battery',
  figureScale: 'figure size, figures, images, pictures, diagrams, drawings, illustrations, graphs, zoom, zoom in, zoom out, scale, bigger, larger, smaller, enlarge, magnify, shrink, too small, too big, cant see, can not see, hard to see, readability, resize, size, percent',
  figAnimSpeed: 'animation speed, speed, playback speed, play speed, faster, slower, slow motion, fast forward, tempo, rate, 1x, 2x, multiplier, animated figures, figure animation',
  figAnimRepeatOneShot: 'repeat, replay, loop, looping, again, keep playing, one shot, play once, auto replay, repeat animation, continuous, animated figures, falling mug',
  figAnimLoopOnce: 'loop, looped, looping, play once, stop after one, single cycle, one cycle, endless, infinite, forever, keep spinning, stop repeating, repeating animations, spinning shell, auto stop, animated figures',
  hideFigAnimControls: 'play button, pause button, speed chip, controls, animation controls, player controls, buttons under figure, hide play button, remove buttons, still image, static figure, clean figures, figure buttons, animated figures',
  showLogoTumble: 'logo, cube, logo animation, spin, spinning, tumble, flip, rotate, rotation, jump, bounce, intro animation, home animation, main menu animation, welcome animation, loading animation, ready, startup, stop logo, turn off logo',
  hideFieldLinesByDefault: 'field lines, electric field, magnetic field, lines, background animation, background effect, moving lines, flow lines, particles, physics lines, changelog, whats new, updates list, version history, release notes',

  // ── Display · Extra
  showForumFab: 'forum, forum button, chat, chat button, comments, discussion, discuss, questions, ask, ask a question, community, messages, floating button, bubble, corner button, fab, hide forum, remove forum button',
  showTopBarTip: 'running line, tips, tip, hints, ticker, marquee, scrolling text, top bar text, header text, rotating text, one liner, news line, did you know, top line, hide tips, remove tips',

  // ── Notifications
  hideUpdateReminder: 'update, updates, new version, update banner, reload banner, refresh banner, version available, upgrade, update reminder, update notification, popup, pop up, nag, annoying banner, outdated, old version',
  forceRefreshOutsideQuiz: 'auto update, automatic update, auto reload, auto refresh, silent update, update automatically, reload automatically, refresh page, latest version, background update, stay updated, always up to date',
  hideThemeNudge: 'theme reminder, try new theme, theme banner, theme suggestion, theme popup, theme notification, new theme, nudge, recommend theme, recommendation, ads, promo, annoying banner',
  hideBugReportReminder: 'bug, bugs, bug report, report bug, report problem, report issue, telegram, feedback, error report, issue, contact, banner, reminder, popup, annoying banner',
  goSilent: 'silent, go silent, mute, quiet, do not disturb, dnd, focus, focus mode, notifications, notification, badges, red dots, dots, counters, numbers, banners, push notifications, alerts, sounds, disable notifications, turn off notifications, stop notifications, no notifications, hide everything, distractions, exam mode, study mode',
  goSilentAutoOff24h: '24 hours, 24h, one day, a day, tomorrow, timer, auto off, automatically off, temporary, temporarily, expire, unmute later, turn back on, schedule',

  // ── Study
  redrawnFigures: 'redrawn figures, original images, original pictures, scanned, scans, textbook images, book images, figure colors, figure colours, theme colored figures, dark mode figures, vector, svg, crisp, sharp, blurry images, old figures, figure style, drawings',
  showLiveTimer: 'timer, clock, stopwatch, time, elapsed time, live timer, how long, time spent, floating clock, timing, hide timer, remove timer, stress, pressure',
  resetFilterOnLoad: 'filter, filters, topic filter, number filter, type filter, reset filter, clear filter, forget filter, default filter, remember filter, saved filter, all problems, everything, page load, refresh, reload, topics',
  autoStopAt50Min: '50 minutes, fifty minutes, 50 min, time limit, exam time, auto submit, automatic submit, auto stop, timeout, deadline, end quiz, finish automatically, exam simulation, real exam, timed',
  fullscreenRandomN: 'full screen, fullscreen, immersive, focus, exam mode, hide browser, distraction free, maximize, maximise, kiosk, random n, random 6, big screen',
  hideFullscreenReminder: 'fullscreen hint, full screen reminder, full screen message, hint, tip, popup, toast, 10 seconds, esc, escape, how to exit full screen, banner, hide reminder',
  selectLatestQuizByDefault: 'latest quiz, newest quiz, last quiz, recent quiz, current quiz, default quiz, quiz 1, first quiz, start page, selected quiz, preselect, automatically select, newest set, latest set',
  cumulativeDefaultOn: 'cumulative, cumulative quiz, all quizzes, previous quizzes, review all, mixed, combined, single set, default mode, everything so far, final exam, midterm, comprehensive',
  hideTopicWhileActive: 'topic, topics, topic label, hide topic, chapter, category, subject, hint, spoiler, spoilers, give away, blind, exam conditions, label, tag, hide hint',
  lockSolveAllOrder: 'order, lock order, order picker, skip picker, skip question, problems order, question order, solve all, entire set, sequence, fixed order, remember order, dont ask, always same order, picker',
  solveAllOrder: 'ordered, shuffled, shuffle, random order, randomize, randomise, randomize problems, shuffle problems, shuffle questions, problems, questions, in order, sequential, numbered order, mix, mixed, scramble, entire set, solve all, order',
  showSolveAllNavRail: 'progress rail, line progress, progress line, progress bar, sidebar, side bar, scroll indicator, scrollbar, navigation, ticks, you are here, minimap, entire set, solve all, wide screen, desktop',
  showStickyScore: 'progress window, score, solved count, counter, badge, floating score, progress badge, how many solved, tally, corner, entire set, solve all, hide score, remove score',
  revealWrongInstantly: 'wrong answer, correct answer, show answer, reveal answer, see correct answer, instant feedback, immediate feedback, right away, mistakes, solution, answer key, skip step, check answer, feedback',

  // ── Sync & Storage
  syncSettings: 'sync, synchronize, synchronise, syncing, cloud, devices, other devices, phone and laptop, computer, account, nickname, same settings everywhere, transfer settings, online backup, multi device, share settings, signed in, server',
  goOffline: 'offline, go offline, offline mode, no internet, no wifi, no connection, without internet, airplane mode, flight, plane, travel, trip, download, download everything, save for later, data saving, mobile data, subway, metro, no signal, 24 hours, back online',
  resetSettingsBtn: 'reset settings, default settings, defaults, restore defaults, factory reset, start over, undo all, clear settings, back to default, original settings, fix settings, broken settings',
  resetCacheBtn: 'cache, clear cache, reset cache, history, attempt history, attempts, progress, delete progress, erase, wipe, start fresh, local data, storage, clear data, entire set progress, delete history, reset stats',
  resetMathCacheBtn: 'latex, math, maths, equations, formulas, formulae, mathjax, math rendering, broken math, equations not showing, symbols broken, weird equations, looks weird, looks wrong, math looks wrong, prerendered, cache, rerender, fix math',
  reinstallSwBtn: 'service worker, reinstall, site, website, app, broken, not loading, stuck, site stuck, frozen, old version, wont update, fix app, troubleshoot, debug, glitch, white screen, blank page, refresh app, pwa, repair, cache problems',
  backup: 'backup, back up, export, import, save settings, restore settings, file, json, download settings, upload settings, transfer, move to new device, copy settings, keep settings, new phone, new laptop, migrate',
};

// Words that say nothing about which setting is meant ("how do I turn off
// the …"). Dropped from the query before matching.
const SETTINGS_SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'in', 'at', 'by', 'my', 'i', 'me', 'im',
  'how', 'do', 'does', 'did', 'can', 'could', 'where', 'what', 'which', 'is',
  'are', 'it', 'its', 'this', 'that', 'please', 'want', 'wanna', 'need', 'with',
  'and', 'or', 'be', 'get', 'setting', 'settings', 'option', 'options', 'change',
  'make', 'way', 'there', 'some', 'any', 'so', 'just', 'thing', 'u', 'you',
]);

const SETTINGS_SEARCH_MAX_RESULTS = 8;
let settingsSearchQuery = '';

// ── Text helpers ──
function settingsSearchNormalize(s) {
  return String(s || '')
    .replace(/\$[^$]*\$/g, ' latex ')               // $\mathrm{La\TeX}$ in a title
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')                       // can't -> cant
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function settingsSearchWords(s) {
  const n = settingsSearchNormalize(s);
  return n ? n.split(' ') : [];
}
// Light stemmer: enough to make animation/animations/animated/animating,
// notify/notification(s), shuffle/shuffled meet on a common start.
function settingsSearchStem(w) {
  if (w.length <= 4) return w.replace(/s$/, '');
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'ions', 'ion', 'ied', 'ies', 'ed', 'es', 'ly', 's', 'e', 'y']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
  }
  return w;
}
// Damerau-Levenshtein distance, giving up once it's past `max`.
function settingsSearchEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// How well one typed word matches one word of a setting, 0..1. `fuzzy`
// is off for words that exist somewhere in the settings as typed: "clock"
// is a real word here, so it shouldn't also count as a typo of "lock".
function settingsSearchWordMatch(q, w, fuzzy) {
  if (q === w) return 1;
  const qs = settingsSearchStem(q), ws = settingsSearchStem(w);
  if (qs === ws) return 0.9;
  if (qs.length >= 4 && ws.length >= 4 && (ws.startsWith(qs) || qs.startsWith(ws))) return 0.85;
  if (w.startsWith(q)) return q.length >= 3 ? 0.8 : (q.length === 2 ? 0.5 : 0.3);
  if (fuzzy && q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    // Typo in a whole word, or in a word still being typed.
    if (settingsSearchEditDistance(q, w, max) <= max) return 0.6;
    if (w.length > q.length && settingsSearchEditDistance(q, w.slice(0, q.length), 1) <= 1) return 0.4;
  }
  return 0;
}

// Best match of a typed word against a list of words.
function settingsSearchBest(q, words, fuzzy) {
  let best = 0;
  for (const w of words) {
    const m = settingsSearchWordMatch(q, w, fuzzy);
    if (m > best) { best = m; if (best === 1) break; }
  }
  return best;
}

const SETTINGS_SEARCH_WEIGHTS = { title: 10, keywords: 7, place: 3, action: 3, desc: 2 };

// What people say they want to do with a switch. Every setting with a
// switch or a choice matches these (weakly), so "hide the logo animation"
// or "stop update popup" find "Logo animation" and "Hide update reminder"
// even though the word itself isn't in either.
const SETTINGS_SEARCH_ACTION_WORDS = ['show', 'hide', 'turn', 'on', 'off', 'enable', 'disable',
  'remove', 'stop', 'start', 'toggle', 'activate', 'deactivate', 'switch', 'get', 'rid', 'no', 'dont', 'always', 'never'];

// Scores one setting against the typed words: the summed score, and how
// many of the words it matched at all.
function settingsSearchScore(entry, qWords, qPhrase, vocab) {
  let score = 0, matched = 0;
  for (const q of qWords) {
    let best = 0;
    const fuzzy = !vocab.has(q);
    for (const field of ['title', 'keywords', 'place', 'action', 'desc']) {
      const m = settingsSearchBest(q, entry.words[field], fuzzy) * SETTINGS_SEARCH_WEIGHTS[field];
      if (m > best) best = m;
    }
    if (best > 0) { matched++; score += best; }
  }
  // The query as a whole phrase: in the title, or as one of the keyword phrases.
  if (qWords.length > 1 && qPhrase) {
    if (entry.phrases.title.includes(qPhrase)) score += 12;
    else if (entry.phrases.keywords.some(k => k.includes(qPhrase))) score += 8;
  }
  return { score, matched };
}

// ── Collecting the settings ──
const SETTINGS_SEARCH_TAB_RENDERERS = {
  display:       () => renderSettingsDisplayTab(),
  notifications: () => renderSettingsNotificationsTab(),
  study:         () => renderSettingsStudyTab(),
  offline:       () => (typeof renderSettingsOfflineTab === 'function' ? renderSettingsOfflineTab() : ''),
};

// Renders every tab off-screen and returns one entry per setting:
// { key, el (what to show: the row, or its group), tab, words, phrases }.
function collectSettingsSearchEntries() {
  const entries = [];
  for (const tab of SETTINGS_TABS) {
    const render = SETTINGS_SEARCH_TAB_RENDERERS[tab.id];
    if (!render) continue;
    const scratch = document.createElement('div');
    scratch.innerHTML = render();
    for (const node of scratch.querySelectorAll('[data-row-key]')) {
      const key = node.dataset.rowKey;
      const isRow = node.classList.contains('settings-row');
      // A row with a sub-row (or the sub-row itself): show the pair.
      const group = isRow && node.parentElement && node.parentElement.classList.contains('settings-group') &&
        node.parentElement.querySelector('.settings-row-sub') ? node.parentElement : null;
      const titleEl = node.querySelector('.settings-row-title, .settings-offline-heading');
      const descEl  = node.querySelector('.settings-row-desc, .settings-offline-desc');
      const title = titleEl ? titleEl.textContent : key;
      const desc  = descEl ? descEl.textContent : '';
      const section = settingsSearchSectionOf(group || node, scratch);
      const keywords = (SETTINGS_SEARCH_KEYWORDS[key] || '').split(',').map(settingsSearchNormalize).filter(Boolean);
      const place = [tab.label, section].filter(Boolean).join(' ');
      entries.push({
        key,
        el: group || node,
        tab: tab.id,
        path: section ? `${tab.label} · ${section}` : tab.label,
        words: {
          title: settingsSearchWords(title),
          keywords: [...new Set(keywords.join(' ').split(' ').filter(Boolean))],
          place: settingsSearchWords(place),
          desc: settingsSearchWords(desc),
          action: node.querySelector('input[type="checkbox"], .settings-choice-btn') ? SETTINGS_SEARCH_ACTION_WORDS : [],
        },
        phrases: { title: settingsSearchNormalize(title), keywords },
      });
    }
  }
  return entries;
}

// The heading a setting sits under on its tab: the nearest earlier
// .settings-section-header, or the Cache & storage heading for its rows.
function settingsSearchSectionOf(el, root) {
  // Go offline and Backup are headed sections of their own.
  if (el.matches('.settings-offline-panel, .settings-backup-section')) return '';
  const cache = el.closest('.settings-cache-section');
  if (cache) {
    const h = cache.querySelector('.settings-offline-heading');
    return h ? h.textContent.trim() : '';
  }
  let top = el;
  while (top.parentElement && top.parentElement !== root) top = top.parentElement;
  for (let s = top.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.classList.contains('settings-section-header')) return s.textContent.trim();
  }
  return '';
}

// Ranked results for a query: { full: [...entries], partial: bool }.
function searchSettings(query) {
  const qWords = settingsSearchWords(query).filter(w => !SETTINGS_SEARCH_STOPWORDS.has(w));
  if (!qWords.length) return { results: [], partial: false, empty: true };
  const qPhrase = qWords.join(' ');
  const entries = collectSettingsSearchEntries();
  const vocab = new Set();
  for (const e of entries) for (const f in e.words) for (const w of e.words[f]) vocab.add(w);
  const scored = entries
    .map(e => Object.assign(e, settingsSearchScore(e, qWords, qPhrase, vocab)))
    .filter(e => e.matched > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score);

  let results = scored.filter(e => e.matched === qWords.length);
  let partial = false;
  if (!results.length && qWords.length > 1) {
    // Nothing matches every word: offer what matches the most of them.
    const most = scored.length ? scored[0].matched : 0;
    results = scored.filter(e => e.matched === most && most >= Math.ceil(qWords.length / 2));
    partial = results.length > 0;
  }
  // Drop matches far weaker than the best one (a word only in a long
  // description, a typo, a first letter), unless they're all there is.
  const top = results.length ? results[0].score / results[0].matched : 0;
  results = results.filter(e => e.score / e.matched >= top * 0.45);

  // One result per element (a row and its sub-row share their group).
  const seen = new Set();
  results = results.filter(e => (seen.has(e.el) ? false : (seen.add(e.el), true)));
  return { results: results.slice(0, SETTINGS_SEARCH_MAX_RESULTS), partial, empty: false };
}

// ── The tab ──
// Called from renderSettingsBody() (js/settings.js). The search box is
// built once and kept across re-renders, so typing (focus, caret) is never
// interrupted when something else re-renders the body (e.g. Go offline's
// progress from a search result).
function renderSettingsSearchTab(body) {
  let input = body.querySelector('#settingsSearchInput');
  if (!input) {
    body.innerHTML = `
      <div class="settings-search-bar">
        <svg class="settings-search-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path d="M7 2.75a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 1 0 0-8.5M10.2 10.2 13.5 13.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <input type="search" id="settingsSearchInput" class="settings-search-input" placeholder="Search settings" aria-label="Search settings"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        <button type="button" class="settings-search-clear" id="settingsSearchClear" title="Clear" aria-label="Clear search" hidden>❌</button>
      </div>
      <div class="settings-search-results" id="settingsSearchResults" aria-live="polite"></div>
    `;
    input = body.querySelector('#settingsSearchInput');
    // Our own ✕ instead of the browser's, so it follows the icon style
    // (❌ in Modern, a drawn ✕ in Classic — js/icons.js).
    const clear = body.querySelector('#settingsSearchClear');
    const setQuery = (q) => {
      settingsSearchQuery = q;
      clear.hidden = !q;
      renderSettingsSearchResults();
    };
    input.value = settingsSearchQuery;
    clear.hidden = !settingsSearchQuery;
    input.addEventListener('input', () => setQuery(input.value));
    clear.addEventListener('click', () => {
      input.value = '';
      setQuery('');
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        setQuery('');
      } else if (e.key === 'Enter') {
        input.blur(); // closes the phone keyboard so the results are visible
      }
    });
    requestAnimationFrame(() => { input.focus(); });
  }
  renderSettingsSearchResults();
}

function renderSettingsSearchResults() {
  const box = document.getElementById('settingsSearchResults');
  if (!box) return;
  const { results, partial, empty } = searchSettings(settingsSearchQuery);
  box.textContent = '';
  if (empty) {
    box.innerHTML = '<div class="settings-search-note">Type what you want to change, like <em>dark mode</em>, <em>figure size</em> or <em>turn off notifications</em>.</div>';
    return;
  }
  if (!results.length) {
    const note = document.createElement('div');
    note.className = 'settings-search-note';
    note.textContent = `No settings match “${settingsSearchQuery.trim()}”. Try another word for it.`;
    box.append(note);
    return;
  }
  if (partial) {
    const note = document.createElement('div');
    note.className = 'settings-search-note';
    note.textContent = 'No exact match. Closest settings:';
    box.append(note);
  }
  for (const r of results) {
    const item = document.createElement('div');
    item.className = 'settings-search-result';
    const path = document.createElement('button');
    path.type = 'button';
    path.className = 'settings-search-path';
    path.title = 'Open on its own tab';
    path.textContent = r.path + ' ›';
    path.addEventListener('click', () => openSettingFromSearch(r.tab, r.key));
    item.append(path, r.el);
    box.append(item);
  }
  if (typeof renderMathIn === 'function') renderMathIn(box);
}

// The 🔍 next to Settings' ✕: opens the Search tab, or puts the cursor back
// in the box if it's already open.
function openSettingsSearch() {
  if (settingsActiveTab !== 'search') { switchSettingsTab('search'); return; }
  const input = document.getElementById('settingsSearchInput');
  if (input) input.focus();
}

// "Display · Animations and figures ›" above a result: opens that tab and
// briefly highlights the setting there.
function openSettingFromSearch(tabId, rowKey) {
  switchSettingsTab(tabId);
  requestAnimationFrame(() => {
    const row = document.querySelector(`#settingsBody [data-row-key="${rowKey}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
    row.classList.remove('settings-row-flash');
    void row.offsetWidth;
    row.classList.add('settings-row-flash');
    setTimeout(() => row.classList.remove('settings-row-flash'), 1600);
  });
}
