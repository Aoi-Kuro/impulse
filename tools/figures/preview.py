"""Before/after review page for one quiz's redrawn figures.

    python tools/figures/preview.py 2   -> tools/figures/preview/q2/index.html

Shows each original problem image next to its redraw, with a switcher for
every site theme in light and dark. Not part of the site (preview/ is
git-ignored, tools/ is left out of the build by minify.py).
"""
import os, shutil, sys, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
quiz = sys.argv[1] if len(sys.argv) > 1 else '1'
mod = importlib.import_module(f'quiz{quiz}')
OUT = os.path.join(HERE, 'preview', f'q{quiz}')
IMG_SRC = os.path.join(HERE, '..', '..', 'course', 'images', f'quiz_{quiz}')
os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)

# Site theme tokens (css/style.css): bg, surface, border, text, muted, svg-blue, svg-red, svg-gold(=--partial)
THEMES = {
    'default': {'dark': ('#0d1117', '#161b22', '#21262d', '#e6edf3', '#7d8590', '#79AFFF', '#FF8A98', '#d29922'),
                'light': ('#ffffff', '#f2f2f2', '#d0d7de', '#1f2328', '#656d76', '#2C6DD5', '#C73A4A', '#9a6700')},
    'nord': {'dark': ('#2E3440', '#3B4252', '#434C5E', '#ECEFF4', '#8391A6', '#88C0D0', '#B48EAD', '#EBCB8B'),
             'light': ('#ECEFF4', '#E5E9F0', '#D8DEE9', '#2E3440', '#4C566A', '#4C7EA8', '#8067A8', '#B5892E')},
    'sakura': {'dark': ('#241A20', '#34222A', '#4A2F3A', '#F7E9EE', '#B98FA0', '#FF7AA8', '#8FD6A8', '#F0C987'),
               'light': ('#FFF5F7', '#FFE9EF', '#FFD3DE', '#4A2530', '#A97C8C', '#E8558A', '#4FAE7A', '#C89A3F')},
    'cyber': {'dark': ('#05060A', '#0D0F1A', '#1C2438', '#D8F8FF', '#6E7A95', '#00F0FF', '#FF2FD0', '#FFCF3D'),
              'light': ('#F2F4FB', '#E6E9F7', '#C7CDF0', '#0A0C14', '#5B6480', '#7A00E0', '#D6009C', '#B57E00')},
    'forest': {'dark': ('#141A13', '#1E281C', '#2C3A28', '#E4ECDF', '#8BA585', '#4F9D7A', '#D98A3D', '#D9B23D'),
               'light': ('#F5F2E8', '#ECE5D3', '#D8CDB0', '#2B2517', '#7C7256', '#3F7D55', '#B5651D', '#A9821E')},
    'solar': {'dark': ('#002B36', '#073642', '#0F4A58', '#F0ECD7', '#6F8A8C', '#2AA1D6', '#D98032', '#D9A02A'),
              'light': ('#FDF6E3', '#EEE8D5', '#D9CFA8', '#43403A', '#93866F', '#1B7BAB', '#B85C1E', '#A87A1E')},
}
NAMES = ('--bg', '--surface', '--border', '--text', '--muted', '--svg-blue', '--svg-red', '--svg-gold')


def tokens(vals, scheme):
    # --svg-dark: always-dark fill (tyres) — the text colour in light mode, the page background in dark mode
    dark = vals[3] if scheme == 'light' else vals[0]
    return '; '.join(f'{k}: {v}' for k, v in zip(NAMES, vals)) + f'; --svg-dark: {dark}; color-scheme: {scheme}'


theme_css = []
for tid, modes in THEMES.items():
    for mode, vals in modes.items():
        theme_css.append(f'body[data-site="{tid}"][data-eff="{mode}"] {{ {tokens(vals, mode)} }}')

rows = []
for num, fn, caption, count in mod.FIGURES:
    src = f'{IMG_SRC}/unnamed.webp' if num == 0 else f'{IMG_SRC}/unnamed({num}).webp'
    rel = f'img/q{quiz}-{num:02d}.webp'
    shutil.copyfile(src, os.path.join(OUT, rel))
    g = fn()
    name = 'unnamed.webp' if num == 0 else f'unnamed({num}).webp'
    probs = f'{count} problem' + ('' if count == 1 else 's')
    rows.append(f'''
    <article class="row" id="f{num}">
      <header class="row-head">
        <span class="file">{name}</span>
        <h2>{caption}</h2>
        <span class="uses">{probs}</span>
      </header>
      <div class="pair">
        <figure class="panel before"><figcaption>Before · WebP</figcaption>
          <div class="stage paper"><img src="{rel}" alt="Original figure: {caption}" loading="lazy"></div></figure>
        <figure class="panel after"><figcaption>After · SVG</figcaption>
          <div class="stage" style="--fig-w:{g.w}px">{g.svg()}</div></figure>
      </div>
    </article>''')

d_dark, d_light = THEMES['default']['dark'], THEMES['default']['light']
html = f'''<title>Quiz {quiz} Figure Rebuild</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans:wght@400;500;600&family=STIX+Two+Text:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>
  /* Layout: one column of figure rows, each a before/after pair; a sticky bar
     switches the site theme so every figure is seen in its real colours.
     Tokens are the practice site's own theme variables (css/style.css). */
  :root {{ {tokens(d_light, 'light')}; --sans: 'IBM Plex Sans', system-ui, sans-serif; --mono: 'IBM Plex Mono', ui-monospace, monospace; }}
  @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ {tokens(d_dark, 'dark')} }} }}
  :root[data-theme="dark"] {{ {tokens(d_dark, 'dark')} }}
  {chr(10).join(theme_css)}

  * {{ box-sizing: border-box; }}
  body {{ background: var(--bg); color: var(--text); font: 15px/1.5 var(--sans);
         padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
         padding-block: 0 48px; transition: background .2s, color .2s; }}
  body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }}
  .wrap {{ max-width: 1040px; margin: 0 auto; }}
  .intro {{ padding-block: 28px 8px; display: grid; gap: 6px; }}
  .intro h1 {{ margin: 0; font-size: 1.6rem; font-weight: 600; text-wrap: balance; }}
  .intro p {{ margin: 0; color: var(--muted); max-width: 64ch; }}

  .bar {{ position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg);
          border-bottom: 1px solid var(--border); padding-block: 10px; display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }}
  .group {{ display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }}
  .group > span {{ font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }}
  .bar button {{ font: 500 .85rem var(--sans); color: var(--text); background: var(--surface); border: 1px solid var(--border);
                border-radius: 999px; padding: 4px 12px; cursor: pointer; }}
  .bar button[aria-pressed="true"] {{ background: var(--text); color: var(--bg); border-color: var(--text); }}
  .bar button:focus-visible {{ outline: 2px solid var(--svg-blue); outline-offset: 2px; }}
  .key {{ display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .85rem; color: var(--muted); }}
  .key i {{ display: inline-block; width: 18px; height: 4px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }}

  .row {{ padding-block: 26px; border-bottom: 1px solid var(--border); display: grid; gap: 12px; }}
  .row-head {{ display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }}
  .row-head h2 {{ margin: 0; font-size: 1.05rem; font-weight: 600; flex: 1 1 260px; min-width: 0; }}
  .file {{ font: .8rem var(--mono); color: var(--muted); }}
  .uses {{ font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }}
  .pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
  .pair.three {{ grid-template-columns: repeat(3, 1fr); }}
  @media (max-width: 680px) {{ .pair, .pair.three {{ grid-template-columns: 1fr; }} }}
  .panel {{ margin: 0; min-width: 0; display: grid; gap: 6px; align-content: start; }}
  .panel figcaption {{ font-size: .72rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }}
  .stage {{ background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px;
           display: flex; justify-content: center; align-items: center; min-height: 160px; }}
  .stage.paper img {{ max-width: min(100%, 350px); max-height: 380px; width: auto; height: auto; display: block; }}
  .stage svg {{ width: 100%; max-width: min(var(--fig-w), 440px); max-height: 380px; height: auto; display: block;
               color: var(--text); --svg-fill-white: var(--surface); }}
  .stage svg text {{ font-family: 'STIX Two Text', 'Times New Roman', serif; }}
  @media (prefers-reduced-motion: reduce) {{ body {{ transition: none; }} }}
</style>

<div class="wrap">
  <section class="intro">
    <h1>Quiz {quiz} figures, redrawn</h1>
    <p>Each problem image next to its vector replacement. The redraws use the site’s theme colours, so switch themes below to see them change. The originals stay as they are today.</p>
  </section>
  <nav class="bar" aria-label="Preview theme">
    <div class="group" id="siteThemes"><span>Theme</span></div>
    <div class="group" id="modes"><span>Mode</span></div>
    <div class="key">
      <span><i style="background: var(--text)"></i>Ink</span>
      <span><i style="background: var(--svg-blue)"></i>Accent: vectors, velocity</span>
      <span><i style="background: var(--svg-red)"></i>Accent 2: forces</span>
      <span><i style="background: linear-gradient(90deg, var(--svg-blue) 50%, var(--svg-red) 50%); opacity: .5"></i>Objects: a tint of either accent</span>
    </div>
  </nav>
  {''.join(rows)}
</div>

<script>
  const SITES = {list(THEMES)};
  const MODES = ['auto', 'light', 'dark'];
  const state = {{ site: 'default', mode: 'auto' }};
  try {{ Object.assign(state, JSON.parse(localStorage.getItem('figPreviewTheme') || '{{}}')); }} catch (e) {{}}
  const mq = matchMedia('(prefers-color-scheme: dark)');
  function effMode() {{
    if (state.mode !== 'auto') return state.mode;
    const t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return mq.matches ? 'dark' : 'light';
  }}
  function apply() {{
    document.body.dataset.site = state.site;
    document.body.dataset.eff = effMode();
    document.querySelectorAll('[data-site-btn]').forEach(b => b.setAttribute('aria-pressed', b.dataset.siteBtn === state.site));
    document.querySelectorAll('[data-mode-btn]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeBtn === state.mode));
    try {{ localStorage.setItem('figPreviewTheme', JSON.stringify(state)); }} catch (e) {{}}
  }}
  function addButtons(id, list, attr, key) {{
    const box = document.getElementById(id);
    for (const v of list) {{
      const b = document.createElement('button');
      b.type = 'button'; b.dataset[attr] = v; b.textContent = v[0].toUpperCase() + v.slice(1);
      b.addEventListener('click', () => {{ state[key] = v; apply(); }});
      box.appendChild(b);
    }}
  }}
  addButtons('siteThemes', SITES, 'siteBtn', 'site');
  addButtons('modes', MODES, 'modeBtn', 'mode');
  mq.addEventListener('change', apply);
  new MutationObserver(apply).observe(document.documentElement, {{ attributes: true, attributeFilter: ['data-theme'] }});
  apply();
</script>
'''
with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as fh:
    fh.write(html)
print('wrote', os.path.join(OUT, 'index.html'), len(html) // 1024, 'KB')
