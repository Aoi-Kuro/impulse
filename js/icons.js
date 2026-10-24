// ─── Icon style: Modern (emoji) or Classic (drawn) ──────────────────────────
// Settings > Display > Icons (display.iconStyle, js/settings.js). Modern is
// the emoji the interface is written with; Classic (the default) swaps each
// of them for a single-colour line icon from ICON_PATHS below, drawn in the
// text colour around it.
//
// How: in Classic, every interface emoji in a text node is wrapped in
// <span class="ic" data-ic="name">emoji</span>, and ICON_CSS below turns
// that span into the icon (the emoji stays inside, clipped, so textContent
// and screen readers are unchanged). A MutationObserver wraps whatever is
// added or rewritten later (cards, labels set with textContent, the
// manual). <option> can't hold a span, so its emoji is taken out of the
// label instead and put back when switching to Modern.
//
// Loaded as the first thing in <body> on the site and in the editor
// (editor/index.html), before any of it is parsed: the observer then sees
// every node the parser adds, so nothing paints as an emoji first. Its CSS
// is injected from here so both pages get the same. Not on offline.html.
//
// Left alone: user content (forum messages and names, problem and solution
// text), maths, figures, form fields, code, and anything in .ic-keep (the
// setting's own example emoji).

(function () {
  // 24×24, stroked with currentColor (fill="currentColor" marks the solid
  // dots). One style for all: 1.8 stroke, round caps and joins.
  const ICON_PATHS = {
    gear: '<path d="M10.08 4.85L10.33 2.55L13.67 2.55L13.92 4.85L15.70 5.59L17.51 4.14L19.86 6.49L18.41 8.30L19.15 10.08L21.45 10.33L21.45 13.67L19.15 13.92L18.41 15.70L19.86 17.51L17.51 19.86L15.70 18.41L13.92 19.15L13.67 21.45L10.33 21.45L10.08 19.15L8.30 18.41L6.49 19.86L4.14 17.51L5.59 15.70L4.85 13.92L2.55 13.67L2.55 10.33L4.85 10.08L5.59 8.30L4.14 6.49L6.49 4.14L8.30 5.59Z"/><circle cx="12" cy="12" r="3"/>',
    manual: '<path d="M2.5 5.5C5 4.5 8.5 4.6 12 6.6c3.5-2 7-2.1 9.5-1.1V19c-2.5-1-6-.9-9.5 1.1C8.5 18.1 5 18 2.5 19Z"/><path d="M12 6.6v13.5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.2" cy="7.8" r="1.2" fill="currentColor" stroke="none"/>',
    moon: '<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M18.6 12h3M16.67 16.67l2.12 2.12M12 18.6v3M7.33 16.67l-2.12 2.12M5.4 12h-3M7.33 7.33 5.21 5.21M12 5.4v-3M16.67 7.33l2.12-2.12"/>',
    book: '<path d="M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Zm0 0A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    bolt: '<path d="M13 2.5 4.5 13.5h7l-1 8 8.5-11h-7l1-8Z"/>',
    note: '<path d="M13 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L13 13.8l-3.8 1 1-3.8Z"/>',
    books: '<path d="M3 4h4v16H3ZM9 4h4v16H9Z"/><path d="m14.8 5.1 3.9-1 3.8 15.5-3.9 1Z"/>',
    chart: '<path d="M3.5 20.5h17"/><path d="M6 13h3v7.5H6ZM10.5 8h3v12.5h-3ZM15 4h3v16.5h-3Z"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1 1 21 11.5Z"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    clipboard: '<path d="M9 4.5H7a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2"/><path d="M9 3h6v3H9ZM9 11h6M9 15h6"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5 7 21h10l1-14.5M10 10.5v6.5M14 10.5v6.5"/>',
    repeat: '<path d="m17 2.5 3 3-3 3"/><path d="M4 11V9.5a4 4 0 0 1 4-4h12"/><path d="m7 21.5-3-3 3-3"/><path d="M20 13v1.5a4 4 0 0 1-4 4H4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6a6.5 6.5 0 0 1 3.5 5.9"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 5.6 5.6"/>',
    bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7.5 2.5 7.5h-17S6 15 6 9.5Z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>',
    'bell-off': '<path d="M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7.5 2.5 7.5h-17S6 15 6 9.5Z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0M3 3l18 18"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/>',
    pin: '<path d="M9 3h6l-.8 6.2L17 12v2H7v-2l2.8-2.8Z"/><path d="M12 14v7.5"/>',
    download: '<path d="M12 3v10M8 9.2l4 4 4-4"/><path d="M3 14.5h5l1.5 2.5h5l1.5-2.5h5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
    warning: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none"/>',
    check: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="m8 12.3 2.8 2.8L16.2 9.6"/>',
    down: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    up: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    rocket: '<path d="M12.5 15.5 8.5 11.5C10.4 6.3 14.6 3.2 20.8 3.2c0 6.2-3.1 10.4-8.3 12.3Z"/><path d="M8.5 11.5H4.8l2.6-3.6h4.1M12.5 15.5v3.7l3.6-2.6v-4.1"/><circle cx="15.6" cy="8.4" r="1.6"/><path d="M6.4 15.6c-1.6.5-2.6 2.6-2.6 4.6 2 0 4.1-1 4.6-2.6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.8v5.7"/><circle cx="12" cy="7.6" r="1.05" fill="currentColor" stroke="none"/>',
    scale: '<path d="M12 3.5v17M7.5 20.5h9M4.5 7h15M12 3.5 9.5 7M12 3.5 14.5 7"/><path d="m4.5 7-2.6 6.3M4.5 7l2.6 6.3M1.9 13.3a2.6 2.6 0 0 0 5.2 0ZM19.5 7l-2.6 6.3M19.5 7l2.6 6.3M16.9 13.3a2.6 2.6 0 0 0 5.2 0Z"/>',
    link: '<path d="M10 14a4.3 4.3 0 0 0 6.1 0l3.2-3.2a4.3 4.3 0 0 0-6.1-6.1L12 5.9"/><path d="M14 10a4.3 4.3 0 0 0-6.1 0l-3.2 3.2a4.3 4.3 0 0 0 6.1 6.1l1.2-1.2"/>',
    bug: '<path d="M8 10a4 4 0 0 1 8 0v4.5a4 4 0 0 1-8 0Z"/><path d="M9.2 7.2 7 5M14.8 7.2 17 5M12 10v8.5M3.5 12.5H8M16 12.5h4.5M4.5 19l3.6-2M19.5 19l-3.6-2M4.5 6.5l3.6 2.2M19.5 6.5l-3.6 2.2"/>',
    fullscreen: '<path d="M3.5 8.5v-5h5M15.5 3.5h5v5M20.5 15.5v5h-5M8.5 20.5h-5v-5"/>',
    sliders: '<path d="M5 21v-6.5M5 10.5V3M12 21v-8.5M12 8.5V3M19 21v-4.5M19 12.5V3M2.5 14.5h5M9.5 8.5h5M16.5 16.5h5"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    // Editor manual sections (editor/manual.json).
    ruler: '<path d="M3.5 20.5V3.5l17 17Z"/><path d="M7.5 16.5v-5l5 5ZM3.5 8h2M3.5 12h2"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3.5 17.5 5-5 4 4 2.5-2.5 5.5 5.5"/>',
    pen: '<path d="M3.5 20.5h17"/><path d="M15 4.5 18.5 8 8.5 18H5v-3.5Z"/>',
    save: '<path d="M5 3.5h11.5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7.5 3.5v5h8v-5M7 20.5V14h10v6.5"/>',
    toolbox: '<rect x="2.5" y="8" width="19" height="12" rx="1.5"/><path d="M9 8V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V8M2.5 13h19M8 11.5v3M16 11.5v3"/>',
  };

  // Emoji → icon. Variation selectors (U+FE0E/FE0F) after any of these are
  // matched too and stay inside the span.
  const EMOJI_ICON = {
    '⚙': 'gear', '📖': 'manual', '🎨': 'palette', '🌙': 'moon', '☀': 'sun',
    '📘': 'book', '🎯': 'target', '⚡': 'bolt', '📝': 'note', '📚': 'books',
    '📊': 'chart', '💬': 'chat', '👁': 'eye', '📋': 'clipboard', '🗑': 'trash',
    '🔁': 'repeat', '👥': 'users', '🔍': 'search', '🔔': 'bell', '🔕': 'bell-off',
    '🚫': 'block', '🌐': 'globe', '📌': 'pin', '📥': 'download', '⚠': 'warning',
    '✅': 'check', '⬇': 'down', '⬆': 'up', '🚀': 'rocket', 'ℹ': 'info',
    '⚖': 'scale', '🔗': 'link', '🐛': 'bug', '⛶': 'fullscreen', '🎛': 'sliders',
    '⏸': 'pause', '📐': 'ruler', '🖼': 'image', '✍': 'pen', '💾': 'save',
    '🧰': 'toolbox', '❌': 'close',
  };

  const EMOJI_RE = new RegExp('(' + Object.keys(EMOJI_ICON).join('|') + ')[\\uFE0E\\uFE0F]?', 'gu');
  const SKIP = '.ic, .ic-keep, .forum-message-body, .forum-message-author, .forum-reply-quote, .problem-text, ' +
               '.sol-line, mjx-container, svg, input, textarea, script, style, code, pre, [contenteditable]';

  // The span becomes a box the size of the text, painted in the text colour
  // through the icon's SVG as a mask; the emoji stays inside, pushed out of
  // view, so it still reads aloud. Top-bar icons: a button's (or the
  // Editorial link's) default colour is the browser's, and emoji there draw
  // larger than their font, so match both; the clickable ones also turn the
  // accent colour on hover, next to their grow (css/style.css).
  const ICON_CSS = `
html.icons-classic .ic,
.ic.ic-always {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.18em;
  overflow: hidden;
  white-space: nowrap;
  text-indent: 3em;
  background-color: currentColor;
  -webkit-mask: var(--ic) center / 100% 100% no-repeat;
  mask: var(--ic) center / 100% 100% no-repeat;
}
html.icons-classic .palette-icon-btn,
html.icons-classic .editor-quick-link,
html.icons-classic .theme-icon { color: var(--text); transition: opacity 0.15s, transform 0.15s, color 0.15s; }
html.icons-classic .palette-icon-btn:hover,
html.icons-classic .editor-quick-link:hover,
html.icons-classic .theme-icon:hover { color: var(--accent); }
html.icons-classic .palette-icon-btn .ic,
html.icons-classic .theme-icon .ic { width: 1.35em; height: 1.35em; vertical-align: -0.3em; }
html.icons-classic .editor-quick-link .ic { width: 1.15em; height: 1.15em; vertical-align: 0; }
`;

  // That CSS plus every icon's mask, in one stylesheet.
  const style = document.createElement('style');
  style.id = 'iconStyleMasks';
  style.textContent = ICON_CSS + Object.keys(ICON_PATHS).map(name => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" ' +
                'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATHS[name] + '</svg>';
    return `.ic[data-ic="${name}"]{--ic:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  }).join('\n');
  document.head.appendChild(style);

  function wrapText(node) {
    const text = node.data;
    EMOJI_RE.lastIndex = 0;
    if (!EMOJI_RE.test(text)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    if (parent.tagName === 'OPTION') {
      parent.setAttribute('data-ic-label', parent.text);
      parent.text = parent.text.replace(EMOJI_RE, '').trim();
      return;
    }
    const frag = document.createDocumentFragment();
    let last = 0;
    EMOJI_RE.lastIndex = 0;
    for (const m of text.matchAll(EMOJI_RE)) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'ic';
      span.dataset.ic = EMOJI_ICON[m[1]];
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }

  function wrapIn(root) {
    if (root.nodeType === Node.TEXT_NODE) { wrapText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.closest(SKIP)) return;
    const texts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === Node.ELEMENT_NODE
        ? (n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
        : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(wrapText); // after the walk: wrapping replaces nodes under it
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') wrapIn(r.target);
      else r.addedNodes.forEach(wrapIn);
    }
  });

  let classic = false;

  // Anything but 'modern' (unset included) is Classic, the default.
  function setIconStyle(value) {
    const on = value !== 'modern';
    if (on === classic) return;
    classic = on;
    document.documentElement.classList.toggle('icons-classic', on);
    if (on) {
      wrapIn(document.body);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      observer.disconnect();
      // Spans can stay (they're plain inline text without the class);
      // option labels get their emoji back.
      document.querySelectorAll('option[data-ic-label]').forEach(o => {
        o.text = o.getAttribute('data-ic-label');
        o.removeAttribute('data-ic-label');
      });
    }
  }
  window.setIconStyle = setIconStyle;

  // Same localStorage read as index.html's anti-flicker script.
  try {
    const raw = JSON.parse(localStorage.getItem('flux_settings') || 'null');
    setIconStyle(raw && raw.display && raw.display.iconStyle);
  } catch (e) {}
})();
