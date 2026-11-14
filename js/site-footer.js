// ─── Site footer ──────────────────────────────────────────────────────────────
// A quiet line at the very bottom of the long screens: the site's logo and
// name, then Report a bug (Telegram), Settings, Manual and GitHub, each with a
// small line icon. Placed once at load, at the end of:
//   #appPage        Random N and Solve them all (both live in it)
//   Stats           after .stats-wrap
//   Solution        after .solution-wrap
//   Forum           the end of the message list, shown only once nothing older
//                   is left to load ("Load older messages" hidden)
//   Settings        after .settings-wrap, without its own Settings link, set
//                   off from the settings above by a horizontal rule
//   Manual          after .manual-wrap, without its own Manual link
// Like other sites' footers it is the very last thing on the page: nothing
// below it, and on Stats, Solution, Settings and Manual it sits at the
// window's bottom edge even when the screen's content is short.
// Never inside Safe Exam Browser (html.lockdown, js/lockdown.js), where its
// links lead nowhere. The name and the repository come from
// js/course-config.js (APP_NAME, GITHUB_REPO), so each course shows its own.
(function () {
  const BUG_REPORT_URL = 'https://t.me/Aoi_Kuro';
  const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICONS = {
    bug: `<svg ${SVG}><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 6l-1.5-2M15 6l1.5-2M4 13h3M17 13h3M4.5 18.5 7.5 17M19.5 18.5 16.5 17M4.5 8.5 7.5 10M19.5 8.5 16.5 10"/></svg>`,
    settings: `<svg ${SVG}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>`,
    manual: `<svg ${SVG}><path d="M2 5.5C4 4.5 7.5 4 10 5.5V20c-2.5-1.5-6-1-8 0z"/><path d="M22 5.5C20 4.5 16.5 4 14 5.5V20c2.5-1.5 6-1 8 0z"/></svg>`,
    github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
  };

  // without: 'settings' or 'manual', the screen the footer is on.
  function build(without) {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    const name = typeof APP_NAME === 'string' ? APP_NAME : '';
    const repo = typeof GITHUB_REPO === 'string' ? GITHUB_REPO : '';
    const parts = [
      `<span class="site-footer-brand"><img class="site-footer-logo" src="favicon/favicon.svg" alt="" width="18" height="18">© 2026 ${name}</span>`,
      `<a class="site-footer-link" href="${BUG_REPORT_URL}" target="_blank" rel="noopener">${ICONS.bug}Report a bug</a>`,
    ];
    if (without !== 'settings') {
      parts.push(`<button type="button" class="site-footer-link" onclick="window.toggleSettingsScreen&&toggleSettingsScreen()">${ICONS.settings}Settings</button>`);
    }
    if (without !== 'manual') {
      parts.push(`<button type="button" class="site-footer-link" onclick="window.toggleManualScreen&&toggleManualScreen()">${ICONS.manual}Manual</button>`);
    }
    if (repo) {
      parts.push(`<a class="site-footer-link" href="https://github.com/${repo}" target="_blank" rel="noopener">${ICONS.github}GitHub</a>`);
    }
    footer.innerHTML = parts.join('');
    return footer;
  }

  function place() {
    // #appPage holds its content directly: the footer goes at its end.
    const app = document.getElementById('appPage');
    if (app) { app.appendChild(build()); app.classList.add('has-site-footer'); }

    // The other screens hold one wrap: the footer goes right after it, as
    // the screen's last child, so the screen (a column filling the window,
    // css/style.css) can push it to the very bottom.
    const after = (screenId, without) => {
      const screen = document.getElementById(screenId);
      const wrap = screen && screen.firstElementChild;
      if (!wrap) return null;
      wrap.after(build(without));
      wrap.classList.add('site-footer-above');
      screen.classList.add('has-site-footer', 'site-footer-screen');
      return wrap;
    };
    after('statsScreen');
    after('solutionScreen');
    after('manualScreen', 'manual');
    // Settings alone gets a rule above the footer, inside its column, so the
    // tools read apart from the last group of settings.
    const settings = after('settingsScreen', 'settings');
    if (settings) settings.insertAdjacentHTML('beforeend', '<hr class="site-footer-rule">');

    // The forum's end: only once "Load older messages" is hidden.
    const list = document.getElementById('forumMessageList');
    const more = document.getElementById('forumLoadMoreBtn');
    if (list && more) {
      const f = build();
      f.classList.add('site-footer-forum');
      list.after(f);
      const sync = () => { f.hidden = more.style.display !== 'none' || !list.children.length; };
      sync();
      new MutationObserver(sync).observe(more, { attributes: true, attributeFilter: ['style'] });
      new MutationObserver(sync).observe(list, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();
})();
