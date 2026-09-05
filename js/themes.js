/* ═══════════════════════════════════════════════════════════════════
   themes.js  ·  Color theme system
   Presets live as CSS blocks in style.css (body[data-theme="x"]).
   This file: preset metadata for the picker UI, the custom-theme
   builder (auto-derives surface/border/muted/accent-dim from bg+text),
   and the one-time "try another theme" nudge banner.
   ─────────────────────────────────────────────────────────────────── */

const THEME_KEY  = STORAGE_PREFIX + '-color-theme';
const CUSTOM_KEY = STORAGE_PREFIX + '-custom-theme';
const NUDGE_KEY  = STORAGE_PREFIX + '-theme-nudge-shown';
const CUSTOM_VARS = ['--bg','--surface','--border','--text','--muted','--accent','--accent-dim','--accent2','--accent2-rgb','--accent-rgb','--svg-blue','--svg-red','--radius-mult','--sans','--mono'];

// Curated font pairings offered in the custom-theme builder. Each pairs a
// body/UI font with a mono font used for labels, inputs, and numbers —
// picking one swaps both consistently rather than mixing an unrelated pair.
const FONT_OPTIONS = [
  { id:'plex',      name:'Plex',      sans:"'IBM Plex Sans', sans-serif", mono:"'IBM Plex Mono', monospace" },
  { id:'grotesk',   name:'Grotesk',   sans:"'Space Grotesk', sans-serif", mono:"'Space Mono', monospace" },
  { id:'quicksand', name:'Quicksand', sans:"'Quicksand', sans-serif",     mono:"'Space Mono', monospace" },
  { id:'mono',      name:'All-mono',  sans:"'Space Mono', monospace",     mono:"'Space Mono', monospace" },
];
function fontOptionById(id){ return FONT_OPTIONS.find(f => f.id === id) || FONT_OPTIONS[0]; }

const THEMES = [
  { id:'default', name:'Default', night:{bg:'#0d1117',accent:'#79AFFF',accent2:'#FF8A98'}, day:{bg:'#ffffff',accent:'#2C6DD5',accent2:'#C73A4A'} },
  { id:'nord',    name:'Nord',    night:{bg:'#2E3440',accent:'#88C0D0',accent2:'#B48EAD'}, day:{bg:'#ECEFF4',accent:'#4C7EA8',accent2:'#8067A8'} },
  { id:'sakura',  name:'Sakura',  night:{bg:'#241A20',accent:'#FF7AA8',accent2:'#8FD6A8'}, day:{bg:'#FFF5F7',accent:'#E8558A',accent2:'#4FAE7A'} },
  { id:'cyber',   name:'Cyber',   night:{bg:'#05060A',accent:'#00F0FF',accent2:'#FF2FD0'}, day:{bg:'#F2F4FB',accent:'#7A00E0',accent2:'#D6009C'} },
  { id:'forest',  name:'Forest',  night:{bg:'#141A13',accent:'#4F9D7A',accent2:'#D98A3D'}, day:{bg:'#F5F2E8',accent:'#3F7D55',accent2:'#B5651D'} },
  { id:'solar',   name:'Solar',   night:{bg:'#002B36',accent:'#2AA1D6',accent2:'#D98032'}, day:{bg:'#FDF6E3',accent:'#1B7BAB',accent2:'#B85C1E'} },
];

/* ── color math ── */
function t_hex2rgb(hex){ hex=(hex||'').replace('#',''); if(hex.length===3) hex=hex.split('').map(c=>c+c).join(''); const n=parseInt(hex,16)||0; return [(n>>16)&255,(n>>8)&255,n&255]; }
function t_rgb2hex([r,g,b]){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function t_mix(hexA,hexB,amt){ const a=t_hex2rgb(hexA), b=t_hex2rgb(hexB); return t_rgb2hex([a[0]+(b[0]-a[0])*amt, a[1]+(b[1]-a[1])*amt, a[2]+(b[2]-a[2])*amt]); }

/** Derive surface/border/muted/accent-dim from bg+text — works for both
    day and night since it blends toward text (whichever direction that is). */
function deriveTheme(bg, text, accent, accent2){
  return {
    bg, text, accent, accent2,
    surface: t_mix(bg, text, 0.06),
    border:  t_mix(bg, text, 0.16),
    muted:   t_mix(bg, text, 0.5),
    accentDim: t_mix(bg, accent, 0.18),
  };
}

/* ── state ── */
function getColorTheme(){ return localStorage.getItem(THEME_KEY) || 'default'; }
function defaultCustomDraft(){
  return {
    night:{ bg:'#0d1117', text:'#e6edf3', accent:'#58a6ff', accent2:'#ff8a98' },
    day:  { bg:'#ffffff', text:'#1f2328', accent:'#0969da', accent2:'#c73a4a' },
    // Roundness/font are a single global "personality" choice, not
    // per-mode like colors — matches how the built-in presets work.
    radius: 1,
    font: 'plex',
  };
}
function getCustomDraft(){ try{ return {...defaultCustomDraft(), ...JSON.parse(localStorage.getItem(CUSTOM_KEY))}; }catch(e){ return defaultCustomDraft(); } }
function saveCustomDraft(d){ localStorage.setItem(CUSTOM_KEY, JSON.stringify(d)); }

function clearCustomVars(){ CUSTOM_VARS.forEach(v=>document.body.style.removeProperty(v)); }

function applyCustomForCurrentMode(){
  const isLight = document.body.classList.contains('light');
  const draft = getCustomDraft();
  const d = draft[isLight ? 'day':'night'];
  const der = deriveTheme(d.bg, d.text, d.accent, d.accent2);
  const fo = fontOptionById(draft.font);
  const s = document.body.style;
  s.setProperty('--bg', der.bg); s.setProperty('--surface', der.surface); s.setProperty('--border', der.border);
  s.setProperty('--text', der.text); s.setProperty('--muted', der.muted);
  s.setProperty('--accent', der.accent); s.setProperty('--accent-dim', der.accentDim);
  s.setProperty('--accent2', der.accent2); s.setProperty('--accent2-rgb', t_hex2rgb(der.accent2).join(','));
  s.setProperty('--accent-rgb', t_hex2rgb(der.accent).join(','));
  s.setProperty('--svg-blue', der.accent); s.setProperty('--svg-red', der.accent2);
  s.setProperty('--radius-mult', String(draft.radius || 1));
  s.setProperty('--sans', fo.sans); s.setProperty('--mono', fo.mono);
  if (typeof updateOnColorVars === 'function') updateOnColorVars();
}
window.__applyCustomOnModeChange = function(){ if (getColorTheme()==='custom') applyCustomForCurrentMode(); };

let _fadeTimer = null;
function themeFadeTick(){
  document.body.classList.add('theme-swap');
  clearTimeout(_fadeTimer);
  _fadeTimer = setTimeout(()=>document.body.classList.remove('theme-swap'), 180);
}

/* ── Auto-contrast for text sitting on solid theme-colored fills ──
   Preset themes hand-pick --chrome-dark for the accent button text, but
   the custom theme builder lets people choose literally any accent
   color, and a couple of spots (the check-answer button, the new
   correct/partial/wrong score boxes) need to stay readable no matter
   what. Rather than hard-code a text color per theme, read the *live*
   computed fill color and pick black or white by perceived brightness
   (YIQ) — recomputed every time a theme or day/night mode change could
   have altered the underlying color. */
function _onColorFor(varName){
  const [r,g,b] = cssVarRgb(varName, document.body);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#0d1117' : '#ffffff';
}
function updateOnColorVars(){
  const s = document.body.style;
  s.setProperty('--on-accent',  _onColorFor('--accent'));
  s.setProperty('--on-correct', _onColorFor('--correct'));
  s.setProperty('--on-partial', _onColorFor('--partial'));
  s.setProperty('--on-wrong',   _onColorFor('--wrong'));
}
window.__updateOnColorVars = updateOnColorVars;

function applyColorTheme(id, persist, skipFade){
  if (!skipFade) themeFadeTick();
  if (id === 'custom') {
    document.body.removeAttribute('data-theme');
    applyCustomForCurrentMode();
  } else {
    clearCustomVars();
    if (id === 'default') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', id);
  }
  if (persist) localStorage.setItem(THEME_KEY, id);
  updateOnColorVars();
}

// Restore saved color theme immediately (avoid flash of default)
applyColorTheme(getColorTheme(), false, true);

/* ── palette panel ── */
function renderThemeGrid(){
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  const cur = getColorTheme();
  const custom = getCustomDraft(); // last *saved* custom theme, not any in-progress edit
  const customSwatch = `
    <button class="theme-swatch ${cur==='custom'?'active':''}" onclick="selectTheme('custom')" title="Custom">
      <span class="ts-split">
        <span class="ts-half" style="background:${custom.night.bg}"><i style="background:${custom.night.accent}"></i><i style="background:${custom.night.accent2}"></i></span>
        <span class="ts-half" style="background:${custom.day.bg}"><i style="background:${custom.day.accent}"></i><i style="background:${custom.day.accent2}"></i></span>
      </span>
      <span class="ts-name">Custom</span>
    </button>`;
  grid.innerHTML = THEMES.map(t => `
    <button class="theme-swatch ${cur===t.id?'active':''}" onclick="selectTheme('${t.id}')" title="${t.name}">
      <span class="ts-split">
        <span class="ts-half" style="background:${t.night.bg}"><i style="background:${t.night.accent}"></i><i style="background:${t.night.accent2}"></i></span>
        <span class="ts-half" style="background:${t.day.bg}"><i style="background:${t.day.accent}"></i><i style="background:${t.day.accent2}"></i></span>
      </span>
      <span class="ts-name">${t.name}</span>
    </button>`).join('') + customSwatch;
}
function selectTheme(id){ applyColorTheme(id, true); renderThemeGrid(); closeThemePanel(); }

function toggleThemePanel(e){
  if (e) e.stopPropagation();
  const panel = document.getElementById('themePanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderThemeGrid();
}
function closeThemePanel(){ document.getElementById('themePanel').classList.remove('open'); }
document.addEventListener('click', (e)=>{
  const panel = document.getElementById('themePanel');
  if (panel && panel.classList.contains('open') && !panel.contains(e.target) && e.target.id !== 'paletteBtn') closeThemePanel();
});

/* ── custom theme modal ──
   Editing here works on an in-memory draft only — it never touches the
   live page (whatever theme is currently active stays active) and never
   persists until "Save & apply" is pressed. That's what makes the custom
   builder independent: you can freely try colors/roundness/font without
   disturbing your actual selected theme, and only commit when you're
   happy with the result. The little preview box shows the draft live via
   its own scoped CSS vars, so you still see what you're building. */
let _ctmDraft = null;
let _ctmMode  = 'night'; // which mode tab is currently being edited in the modal

function populateCustomInputs(){
  document.querySelectorAll('.ctm-tab').forEach(b=>b.classList.toggle('active', b.dataset.mode===_ctmMode));
  const d = _ctmDraft[_ctmMode];
  document.getElementById('ctm-bg').value = d.bg;
  document.getElementById('ctm-text').value = d.text;
  document.getElementById('ctm-accent').value = d.accent;
  document.getElementById('ctm-accent2').value = d.accent2;
  document.getElementById('ctm-radius').value = _ctmDraft.radius;
  document.getElementById('ctm-font').value = _ctmDraft.font;
  updateCtmPreview();
}
function openCustomThemeModal(){
  closeThemePanel();
  _ctmDraft = JSON.parse(JSON.stringify(getCustomDraft())); // clone: edits are local to this session
  _ctmMode = document.body.classList.contains('light') ? 'day' : 'night';
  populateCustomInputs();
  document.getElementById('customThemeOverlay').classList.add('open');
}
function closeCustomThemeModal(){
  document.getElementById('customThemeOverlay').classList.remove('open');
  _ctmDraft = null;
  renderThemeGrid();
}
function ctmTabClick(mode){
  // Just switches which mode's colors the modal is editing — does NOT
  // flip the actual site's day/night mode, unlike before.
  _ctmMode = mode;
  populateCustomInputs();
}
function updateCustomField(field, value){
  _ctmDraft[_ctmMode][field] = value;
  updateCtmPreview();
}
function updateCustomRadius(value){
  _ctmDraft.radius = parseFloat(value);
  updateCtmPreview();
}
function updateCustomFont(value){
  _ctmDraft.font = value;
  updateCtmPreview();
}
function updateCtmPreview(){
  const el = document.getElementById('ctm-preview');
  if (!el || !_ctmDraft) return;
  const d  = _ctmDraft[_ctmMode];
  const fo = fontOptionById(_ctmDraft.font);
  const s = el.style;
  s.setProperty('--pr-bg', d.bg);
  s.setProperty('--pr-text', d.text);
  s.setProperty('--pr-accent', d.accent);
  s.setProperty('--pr-accent2', d.accent2);
  s.setProperty('--pr-radius', _ctmDraft.radius);
  s.setProperty('--pr-sans', fo.sans);
  s.setProperty('--pr-mono', fo.mono);
}
function saveCustomTheme(){
  if (!_ctmDraft) return;
  saveCustomDraft(_ctmDraft);
  applyColorTheme('custom', true); // now, and only now, does it become the live theme
  closeCustomThemeModal();
}

/* ── theme nudge banner (~15 min after page load, at most once/day) ── */
const NUDGE_INTERVAL = 24 * 60 * 60 * 1000; // 1 day
let _nudgePrevTheme = null;

// The actual reveal is deferred to BannerManager so it only happens once
// nothing higher-priority (update) or earlier-in-line (bug/telegram) is showing.
BannerManager.register('theme',
  () => { // show
    const cur = getColorTheme();
    const pool = THEMES.filter(t => t.id !== 'default' && t.id !== cur);
    const pick = (pool.length ? pool : THEMES)[Math.floor(Math.random() * (pool.length || THEMES.length))];
    _nudgePrevTheme = cur;
    applyColorTheme(pick.id, false);
    document.getElementById('theme-nudge-name').textContent = pick.name;
    document.getElementById('theme-nudge-banner').classList.add('visible');
  },
  () => { // hide (preempted by a higher-priority banner)
    document.getElementById('theme-nudge-banner').classList.remove('visible');
    applyColorTheme(_nudgePrevTheme || 'default', false);
  }
);

function scheduleThemeNudge(){
  const last = +localStorage.getItem(NUDGE_KEY) || 0;
  if (Date.now() - last < NUDGE_INTERVAL) return;
  setTimeout(triggerThemeNudge, 15 * 60 * 1000);
}
function triggerThemeNudge(){
  const last = +localStorage.getItem(NUDGE_KEY) || 0;
  if (Date.now() - last < NUDGE_INTERVAL) return;
  BannerManager.request('theme');
}
function dismissThemeNudge(){
  localStorage.setItem(NUDGE_KEY, String(Date.now()));
  document.getElementById('theme-nudge-banner').classList.remove('visible');
  applyColorTheme(_nudgePrevTheme || 'default', false);
  BannerManager.release('theme');
}

window.addEventListener('DOMContentLoaded', () => {
  renderThemeGrid();
  scheduleThemeNudge();
});
