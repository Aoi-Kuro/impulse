"""
minify.py  ·  Builds a minified copy of the site as a zip for Netlify.

    python minify.py                 -> ../<folder>-netlify.zip (next to this project folder)
    python minify.py path/to/out.zip -> that file instead
    python minify.py --deploy        -> deploys the build to Netlify instead of zipping it

--deploy uses the Netlify CLI (Node.js, then `npm install -g netlify-cli`,
`netlify login`, and once in this folder `netlify link` to pick the site).
It is the only way that also deploys netlify/edge-functions/ — the shared
solution links (/s/<key>) and their previews: a zip uploaded by hand
deploys the static files only. The edge function is given this course's
Supabase project and names from js/course-config.js, for the course set by
<head data-course> in index.html.

Never writes into this project folder: the copy is built in a temporary
folder and only the finished zip is written, outside the project unless a
path inside it is given.

What it does
  - copies the site, leaving out what isn't part of the website:
    .git, superbase/ (edge functions + SQL, deployed to Supabase instead),
    netlify/ (Netlify edge functions, deployed beside the site by --deploy),
    vendor-src/ (sources the vendor/ builds are made from),
    tools/ (the generator behind course/figures/: tools/figures),
    README.md, *.zip and this script itself
  - minifies our own .js and .css with esbuild: whitespace, syntax and the
    names of LOCAL variables only. Top-level names are never renamed — the
    pages share globals across <script> files, inline onclick="…" calls
    them, and the editor reads Quiz_N_Problems by name
  - minifies inline <script>/<style> inside the .html pages, drops HTML
    comments, trims indentation (<pre>/<textarea> contents untouched)
  - compacts .json / .webmanifest
  - vendor/ is copied as-is (already minified upstream)

Checks before zipping (the build fails instead of shipping a broken site)
  - every minified script, including inline ones, still parses
  - every top-level name of the originals is still present
  - every JSON file holds the same data
  - site-version.json: only known keys and sane values (js/site-config.js),
    "version" matching CURRENT_VERSION and the changelog, "min_version" not
    above "version". What the file will make open tabs do, compared with the
    last commit (reloads, slower polling, Realtime off, sync paused, cache
    refills), is listed at the end of the build.

esbuild is downloaded once from the npm registry into a cache folder in
your user profile (not this project); nothing else needs installing.
"""
import hashlib, io, json, os, platform, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request, zipfile

ESBUILD_VERSION = '0.28.2'

SRC = os.path.dirname(os.path.abspath(__file__))
SELF = os.path.basename(__file__)
SKIP_DIRS = {'.git', 'superbase', 'netlify', '.netlify', 'vendor-src', 'tools', '.claude', '.vscode', 'node_modules', '__pycache__'}
SKIP_ROOT_FILES = {'README.md', SELF}
SKIP_EXT = {'.zip', '.py'}
MINIFY_EXT = {'.js', '.css', '.html', '.json', '.webmanifest'}


# ── esbuild ─────────────────────────────────────────────────────────────
def esbuild_path():
    system, machine = platform.system().lower(), platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'x64'
    plat = {'windows': 'win32', 'darwin': 'darwin', 'linux': 'linux'}.get(system)
    if not plat:
        sys.exit(f'Unsupported system for esbuild: {system}')
    exe = 'esbuild.exe' if plat == 'win32' else 'esbuild'
    cache_root = os.environ.get('LOCALAPPDATA') or os.path.join(os.path.expanduser('~'), '.cache')
    cache = os.path.join(cache_root, 'impulse-minify', f'esbuild-{ESBUILD_VERSION}-{plat}-{arch}')
    path = os.path.join(cache, exe)
    if os.path.exists(path):
        return path
    pkg = f'{plat}-{arch}'
    url = f'https://registry.npmjs.org/@esbuild/{pkg}/-/{pkg}-{ESBUILD_VERSION}.tgz'
    print(f'Downloading esbuild {ESBUILD_VERSION} ({pkg}) once...')
    data = urllib.request.urlopen(url, timeout=60).read()
    inner = 'package/esbuild.exe' if plat == 'win32' else 'package/bin/esbuild'
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        member = tar.getmember(inner)
        os.makedirs(cache, exist_ok=True)
        with tar.extractfile(member) as src, open(path, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    os.chmod(path, 0o755)
    return path


ESBUILD = None

def esbuild(code, loader, minify=True):
    args = [ESBUILD, f'--loader={loader}', '--charset=utf8', '--log-level=error']
    if minify:
        args += ['--minify', '--tree-shaking=false', '--legal-comments=none']
    r = subprocess.run(args, input=code.encode('utf-8'), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode('utf-8', 'replace'))
    return r.stdout.decode('utf-8')


# ── HTML ────────────────────────────────────────────────────────────────
# Comments and protected elements in ONE scan, so a "<script>" mentioned
# inside a comment is never mistaken for a real one (and vice versa).
PROTECT = re.compile(r'<!--(?!\[if).*?-->|(<(script|style|pre|textarea)\b[^>]*>)(.*?)(</\2\s*>)', re.S | re.I)

def squeeze(chunk):
    chunk = re.sub(r'<!--(?!\[if).*?-->', '', chunk, flags=re.S)
    return '\n'.join(l.strip() for l in chunk.split('\n') if l.strip())

def is_js_script(open_tag):
    typ = re.search(r'type\s*=\s*["\']([^"\']+)', open_tag, re.I)
    return not typ or typ.group(1).lower() in ('text/javascript', 'application/javascript')

def minify_html(html):
    out, last = [], 0
    for m in PROTECT.finditer(html):
        out.append(squeeze(html[last:m.start()]))
        last = m.end()
        if m.group(1) is None:              # a comment: dropped
            continue
        open_tag, tag, body, close_tag = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag == 'script' and 'src=' not in open_tag.lower() and body.strip():
            if is_js_script(open_tag):
                body = esbuild(body, 'js').strip()
            elif re.search(r'type\s*=\s*["\'][^"\']*json', open_tag, re.I):
                body = json.dumps(json.loads(body), ensure_ascii=False, separators=(',', ':'))
        elif tag == 'style' and body.strip():
            body = esbuild(body, 'css').strip()
        out.append(squeeze(open_tag) + body + close_tag)      # pre/textarea bodies untouched
    out.append(squeeze(html[last:]))
    return ''.join(out)


# ── bundles ─────────────────────────────────────────────────────────────
# Every <script src>/<link rel=stylesheet> is a request, and Netlify bills
# each one — including the empty 304 a browser gets back on every visit for
# every unchanged file. So in the pages below, each run of adjacent local
# scripts (and stylesheets) becomes one file, named by its content hash and
# served with a one-year immutable cache (_headers): a visit re-checks only
# index.html, and a deploy changes the names in it.
#
# A JS bundle is NOT the files glued together. Glued, they would share one
# script: every file's function declarations hoisted to the top of it, a
# `typeof laterFile_fn === 'function'` guard suddenly true (or a TDZ
# ReferenceError on a later file's const), and one file's top-level error
# stopping every file after it. Instead the bundle holds each file as a
# string and runs it as its own inline <script>, in order, synchronously —
# exactly the separate classic scripts the page had. `//# sourceURL` keeps
# each file's own name in DevTools and error stacks.
#
# Only the pages listed here are bundled, each with its own bundles (the
# site and the editor load different files). The original files stay in the
# build too: offline.html, sw.js's precache list and the editor's
# loadQuiz() fetch some of them by name.
BUNDLE_PAGES = {'index.html': 'site', 'editor/index.html': 'editor'}
# vendor/mathjax and vendor/tikzjax locate their own files from their script
# URL, so they keep it.
NO_BUNDLE = ('vendor/mathjax/', 'vendor/tikzjax/')

SCRIPT_RUN = re.compile(r'(?:<script src="[^"]+"></script>\s*){2,}')
STYLE_RUN = re.compile(r'(?:<link rel="stylesheet" href="[^"]+">\s*){2,}')
# The tier-2 loader's list in index.html: an array of only quoted paths.
LIST_LITERAL = re.compile(r'\[\s*"[^"\]]+\.js"(?:\s*,\s*"[^"\]]+")+\s*\]')

def _local(page_rel, ref):
    """Site-relative path of a same-origin ref, or None (CDN, data:, ...)."""
    if re.match(r'^(?:[a-z]+:)?//', ref, re.I) or ref.startswith('data:'):
        return None
    ref = ref.split('?')[0].split('#')[0]
    if ref.startswith('/'):
        return ref[1:]
    return os.path.normpath(os.path.join(os.path.dirname(page_rel), ref)).replace(os.sep, '/')

def _bundleable(path, ext):
    return path and path.endswith(ext) and not path.startswith(NO_BUNDLE)

def _split(page_rel, refs, ext):
    """Consecutive bundleable refs as groups; anything else ends a group."""
    groups, cur = [], []
    for ref in refs:
        if _bundleable(_local(page_rel, ref), ext):
            cur.append(ref)
        else:
            if cur: groups.append(cur)
            groups.append(ref)
            cur = []
    if cur: groups.append(cur)
    return groups

def _write_bundle(out, name, ext, text):
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()[:12]
    rel = f'{ext}/bundle/{name}.{digest}.{ext}'
    dst = os.path.join(out, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    return rel

def _js_bundle(out, page_rel, refs, problems):
    parts = []
    for ref in refs:
        path = _local(page_rel, ref)
        code = open(os.path.join(out, path), encoding='utf-8').read()
        code = re.sub(r'^//# sourceMappingURL=.*$', '', code, flags=re.M)
        parts.append(json.dumps(code + f'\n//# sourceURL=/{path}\n', ensure_ascii=False))
    return ('(function(){var d=document,s=d.currentScript,p=s?s.parentNode:d.head,n=s?s.nextSibling:null,f=['
            + ','.join(parts)
            + '];for(var i=0;i<f.length;i++){var e=d.createElement("script");e.text=f[i];p.insertBefore(e,n);p.removeChild(e)}})();\n')

def _css_bundle(out, page_rel, refs, problems):
    parts = []
    for ref in refs:
        path = _local(page_rel, ref)
        css = open(os.path.join(out, path), encoding='utf-8').read()
        # Moved into css/bundle/, a relative url() would point elsewhere, and
        # an @import/@charset is only valid at the top of a stylesheet.
        for m in re.finditer(r'url\(\s*["\']?([^"\')]+)', css):
            if not re.match(r'^(?:data:|[a-z]+:|//|/|#)', m.group(1), re.I):
                problems.append(f'{path}: relative url({m.group(1)}) cannot be bundled')
        if re.search(r'@import|@charset', css, re.I):
            problems.append(f'{path}: @import/@charset cannot be bundled')
        parts.append(css)
    return '\n'.join(parts) + '\n'

def bundle_page(out, page_rel, name, problems):
    path = os.path.join(out, page_rel)
    html = open(path, encoding='utf-8').read()
    root = '/' if page_rel != 'index.html' else ''      # the editor uses absolute paths
    made = []
    counter = [0]

    def emit(kind, refs):
        counter[0] += 1
        if kind == 'js':
            rel = _write_bundle(out, f'{name}-{counter[0]}', 'js', _js_bundle(out, page_rel, refs, problems))
        else:
            rel = _write_bundle(out, f'{name}-{counter[0]}', 'css', _css_bundle(out, page_rel, refs, problems))
        made.append((rel, refs))
        return root + rel

    def scripts(m):
        refs = re.findall(r'<script src="([^"]+)"></script>', m.group(0))
        tags = []
        for g in _split(page_rel, refs, '.js'):
            srcs = [emit('js', g)] if isinstance(g, list) and len(g) > 1 else (g if isinstance(g, list) else [g])
            tags += [f'<script src="{s}"></script>' for s in srcs]
        return '\n'.join(tags) + '\n'

    def styles(m):
        refs = re.findall(r'<link rel="stylesheet" href="([^"]+)">', m.group(0))
        tags = []
        for g in _split(page_rel, refs, '.css'):
            hrefs = [emit('css', g)] if isinstance(g, list) and len(g) > 1 else (g if isinstance(g, list) else [g])
            tags += [f'<link rel="stylesheet" href="{h}">' for h in hrefs]
        return '\n'.join(tags) + '\n'

    def loader_list(m):
        refs = json.loads(m.group(0))
        items = []
        for g in _split(page_rel, refs, '.js'):
            items += [emit('js', g)] if isinstance(g, list) and len(g) > 1 else (g if isinstance(g, list) else [g])
        return json.dumps(items)

    def inline_scripts(m):
        return m.group(1) + LIST_LITERAL.sub(loader_list, m.group(2)) + m.group(3)

    html = SCRIPT_RUN.sub(scripts, html)
    html = STYLE_RUN.sub(styles, html)
    html = re.sub(r'(<script>)(.*?)(</script>)', inline_scripts, html, flags=re.S)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(html)
    for rel, refs in made:
        if rel.endswith('.js'):
            try:
                esbuild(open(os.path.join(out, rel), encoding='utf-8').read(), 'js', minify=False)
            except RuntimeError as e:
                problems.append(f'{rel}: bundle does not parse: {e.strip()}')
    check_html(page_rel, html, problems)
    return made


# ── checks ──────────────────────────────────────────────────────────────
TOP_LEVEL = re.compile(r'^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))', re.M)

def check_js(rel, original, minified, problems):
    try:
        esbuild(minified, 'js', minify=False)              # parse check
    except RuntimeError as e:
        problems.append(f'{rel}: minified code does not parse: {e.strip()}')
        return
    for m in TOP_LEVEL.finditer(original):
        name = m.group(1) or m.group(2)
        if not re.search(r'(^|[^\w$])' + re.escape(name) + r'([^\w$]|$)', minified):
            problems.append(f'{rel}: top-level name "{name}" is missing after minifying')

def check_html(rel, minified, problems):
    for i, m in enumerate(re.finditer(r'<script\b([^>]*)>(.*?)</script>', minified, re.S | re.I), 1):
        if 'src=' in m.group(1).lower() or not m.group(2).strip() or not is_js_script(m.group(1)):
            continue
        try:
            esbuild(m.group(2), 'js', minify=False)
        except RuntimeError as e:
            problems.append(f'{rel}: inline script #{i} does not parse: {e.strip()}')


# ── site-version.json ───────────────────────────────────────────────────
# Every open tab reads this file every few minutes, and besides the version
# it can carry settings that act on all of them at once (js/site-config.js
# describes each key). A typo there reaches everyone within minutes, so the
# build checks it and lists what it will do. The poll limits and the "off"
# names are read from js/site-config.js itself, so the two can't drift apart.
MANIFEST = 'site-version.json'
MANIFEST_KEYS = {'version', 'editor', 'min_version', 'poll', 'off', 'sync_paused', 'purge_id'}
VERSION_RE = re.compile(r'^\d+(?:\.\d+)*$')
OFF_EFFECT = {
    'realtime': 'Realtime is OFF: no live connections, every tab relies on its poll intervals.',
    'forum_posting': 'The forum is READ-ONLY: new messages, replies and edits are refused.',
}

def _vcmp(a, b):
    pa, pb = [int(x) for x in a.split('.')], [int(x) for x in b.split('.')]
    n = max(len(pa), len(pb))
    pa, pb = pa + [0] * (n - len(pa)), pb + [0] * (n - len(pb))
    return (pa > pb) - (pa < pb)

def _read(rel):
    return open(os.path.join(SRC, rel), encoding='utf-8').read()

def _site_config_tables():
    """SITE_POLL as {name: (default, min, max, label)} and SITE_OFF_NAMES."""
    js = _read('js/site-config.js')
    body = re.search(r'const SITE_POLL = \{(.*?)\n\};', js, re.S).group(1)
    poll = {}
    for m in re.finditer(r'^\s*(\w+):\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\],\s*//\s*(.*)$', body, re.M):
        label = re.sub(r'\s*\(js/[^)]*\)\s*$', '', m.group(5)).strip()
        label = label[:1].upper() + label[1:]
        poll[m.group(1)] = (int(m.group(2)), int(m.group(3)), int(m.group(4)), label)
    off = re.findall(r"'([^']+)'", re.search(r'const SITE_OFF_NAMES = \[(.*?)\];', js).group(1))
    return poll, off

def _committed_manifest():
    try:
        r = subprocess.run(['git', 'show', f'HEAD:{MANIFEST}'], cwd=SRC, capture_output=True, timeout=10)
        return json.loads(r.stdout.decode('utf-8')) if r.returncode == 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None

def _version_ok(v):
    return isinstance(v, str) and bool(VERSION_RE.match(v))

def check_manifest(problems):
    """Checks site-version.json; returns lines saying what it makes open tabs do."""
    def bad(msg):
        problems.append(f'{MANIFEST}: {msg}')
    try:
        data = json.loads(_read(MANIFEST))
    except (OSError, ValueError) as e:
        bad(f'cannot be read: {e}')
        return []
    if not isinstance(data, dict):
        bad('must be one JSON object')
        return []
    poll_table, off_names = _site_config_tables()
    if 'update' not in poll_table or not off_names:
        bad('could not read SITE_POLL / SITE_OFF_NAMES from js/site-config.js to check against')
        return []
    prev = _committed_manifest()
    old = prev if isinstance(prev, dict) else {}
    actions = []

    for key in sorted(set(data) - MANIFEST_KEYS):
        bad(f'unknown key "{key}" (a typo? tabs would ignore it). Known: {", ".join(sorted(MANIFEST_KEYS))}')

    # version: must match the page's CURRENT_VERSION and the changelog, or
    # every tab sees an update it can never reach.
    version = data.get('version')
    if not _version_ok(version):
        bad(f'"version" must look like "12.5.1", got {version!r}')
        version = None
    else:
        m = re.search(r"const CURRENT_VERSION = '([^']+)'", _read('js/quiz-engine.js'))
        if not m or m.group(1) != version:
            bad(f'"version" is {version} but CURRENT_VERSION in js/quiz-engine.js is {m.group(1) if m else "missing"}: '
                'tabs would be told to update to a version the page never reports')
        m = re.search(r'const CHANGELOG = \[\s*\{\s*version:\s*"([^"]+)"', _read('js/data/changelog.js'))
        if not m or m.group(1) != version:
            bad(f'"version" is {version} but the newest entry in js/data/changelog.js is {m.group(1) if m else "missing"}')
        prev_v = old.get('version')
        if _version_ok(prev_v) and prev_v != version:
            if _vcmp(version, prev_v) < 0:
                actions.append(f'Version goes DOWN, {prev_v} -> {version}: open tabs on {prev_v} are told to "update" to the older one.')
            else:
                actions.append(f'New version {version} (was {prev_v}): open tabs show the update banner and reload by themselves after 48 h.')

    editor = data.get('editor')
    if editor is not None and not _version_ok(editor):
        bad(f'"editor" must look like "1.0.1", got {editor!r}')
    elif editor is not None and _version_ok(old.get('editor')) and old.get('editor') != editor:
        actions.append(f'Editor version {old.get("editor")} -> {editor} (students are not asked to reload).')

    update_s = poll_table['update'][0]
    if isinstance(data.get('poll'), dict) and isinstance(data['poll'].get('update'), (int, float)):
        update_s = data['poll']['update']

    if data.get('min_version', '') != '':               # "" is the placeholder: no minimum
        mv = data['min_version']
        if not _version_ok(mv):
            bad(f'"min_version" must look like "12.4.6", got {mv!r} (tabs would ignore it)')
        elif version and _vcmp(mv, version) > 0:
            bad(f'"min_version" {mv} is above "version" {version}: every tab would reload trying to reach a version '
                'that is not deployed (once a day each, the reload guard stops more)')
        else:
            same = ' (unchanged)' if old.get('min_version') == mv else ''
            actions.append(f'Tabs below {mv} reload within one update check (~{update_s / 60:.0f} min) instead of after 48 h; '
                           f'a timed quiz first, unless it has run 3 h{same}.')

    if 'poll' in data:
        poll = data['poll']
        if not isinstance(poll, dict):
            bad('"poll" must be an object like {"attempts": 120}')
            poll = {}
        effective = {}
        for name, value in poll.items():
            if name not in poll_table:
                bad(f'"poll.{name}" is not a known interval. Known: {", ".join(poll_table)}')
                continue
            default, lo, hi, label = poll_table[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                bad(f'"poll.{name}" must be a number of seconds, got {value!r}')
                continue
            if value <= 0:
                bad(f'"poll.{name}" is {value}: tabs ignore zero or less and keep the default {default} s; '
                    'remove the key instead')
                continue
            if not lo <= value <= hi:
                bad(f'"poll.{name}" is {value} s, outside {lo}-{hi} s (tabs would clamp it to {min(hi, max(lo, value))} s)')
                continue
            effective[name] = value
            if value != default:
                actions.append(f'{label}: every {value:g} s instead of {default} s '
                               f'(~{3600 / value:.1f} instead of {3600 / default:.1f} an hour per open tab).')
        fq = effective.get('forum_quiet', poll_table['forum_quiet'][0])
        fn = effective.get('forum', poll_table['forum'][0])
        if fq < fn:
            actions.append(f'Note: the quiet forum check ({fq:g} s) is MORE frequent than the normal one ({fn:g} s), '
                           'so quiet mode saves nothing.')

    if 'off' in data:
        off = data['off']
        if not isinstance(off, list) or not all(isinstance(x, str) for x in off):
            bad('"off" must be a list like ["realtime"]')
        else:
            for name in off:
                if name not in off_names:
                    bad(f'"off" has unknown "{name}". Known: {", ".join(off_names)}')
                else:
                    actions.append(OFF_EFFECT.get(name, f'"{name}" is turned off.'))

    if 'sync_paused' in data:
        if not isinstance(data['sync_paused'], bool):
            bad(f'"sync_paused" must be true or false, got {data["sync_paused"]!r}')
        elif data['sync_paused']:
            actions.append('Sync is PAUSED: attempts and Solve-All progress stay in each browser until you remove it.')

    if data.get('purge_id', '') != '':                  # "" is the placeholder: no refill
        pid = data['purge_id']
        if not isinstance(pid, str) or not pid.strip() or len(pid.strip()) > 100:
            bad(f'"purge_id" must be a short string (or "" for none), got {pid!r}')
        elif old.get('purge_id') != pid:
            actions.append(f'New purge_id "{pid}": every browser refills its offline cache once (a few MB each).')

    if prev is None:
        actions.append(f'(Could not read {MANIFEST} from the last commit, so nothing is compared with it.)')
    return actions


# ── build ───────────────────────────────────────────────────────────────
# ── Netlify edge functions (--deploy) ───────────────────────────────────
EDGE_SRC = os.path.join('netlify', 'edge-functions')
EDGE_COURSE_SLOT = 'JSON.parse("null")'   # in netlify/edge-functions/share.ts


def _course_block(config, course):
    """The `<course>: { … }` entry of COURSES in js/course-config.js."""
    m = re.search(r'^  ' + re.escape(course) + r': \{\n(.*?)^  \},$', config, re.S | re.M)
    return m.group(1) if m else None


def edge_course(problems):
    """What share.ts needs about this course, from js/course-config.js."""
    head = re.search(r'<head\b[^>]*\bdata-course="([^"]+)"', _read('index.html'))
    course = head.group(1).lower() if head else None
    block = course and _course_block(_read('js/course-config.js'), course)
    if not block:
        problems.append(f'netlify edge function: no "{course}" course in js/course-config.js (index.html <head data-course>)')
        return None
    def field(name):
        m = re.search(r'\b' + name + r":\s*(['\"])(.*?)\1,", block)
        return m.group(2) if m else None
    values = {k: field(k) for k in ('url', 'publishableKey', 'appName', 'ogDescription')}
    missing = [k for k, v in values.items() if not v]
    if missing:
        problems.append(f'netlify edge function: {course} in js/course-config.js has no {", ".join(missing)}')
        return None
    return {
        'supabaseUrl': values['url'].rstrip('/'),
        'publishableKey': values['publishableKey'],
        'shareTitle': f"{values['appName']} Practice App",   # SHARE_TITLE in course-config.js
        'description': values['ogDescription'].replace("\\'", "'"),
    }


def stage_edge_functions(stage, problems):
    """Copies netlify/edge-functions/ next to the built site, with this
    course's values filled into share.ts."""
    course = edge_course(problems)
    if not course:
        return
    for f in sorted(os.listdir(os.path.join(SRC, EDGE_SRC))):
        text = _read(os.path.join(EDGE_SRC, f))
        if f == 'share.ts':
            if text.count(EDGE_COURSE_SLOT) != 1:
                problems.append(f'{EDGE_SRC}/share.ts: expected exactly one {EDGE_COURSE_SLOT} to fill in')
                continue
            text = text.replace(EDGE_COURSE_SLOT, 'JSON.parse(' + json.dumps(json.dumps(course, ensure_ascii=False)) + ')')
        dst = os.path.join(stage, EDGE_SRC, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)


def netlify_site_id():
    """The site `netlify link` tied this folder to (or NETLIFY_SITE_ID)."""
    if os.environ.get('NETLIFY_SITE_ID'):
        return os.environ['NETLIFY_SITE_ID']
    try:
        with open(os.path.join(SRC, '.netlify', 'state.json'), encoding='utf-8') as fh:
            return json.load(fh).get('siteId')
    except (OSError, ValueError):
        return None


def deploy(stage):
    """Deploys stage/site plus stage/netlify/edge-functions to production."""
    cli = shutil.which('netlify')
    site = netlify_site_id()
    if not cli or not site:
        print('Built, but not deployed:')
        if not cli:
            print('  - the Netlify CLI is not installed: install Node.js, then run  npm install -g netlify-cli  and  netlify login')
        if not site:
            print(f'  - this folder is not linked to a Netlify site: run  netlify link  in {SRC}')
        sys.exit(1)
    print(f'Deploying to Netlify site {site} …')
    # From the stage folder, so the CLI finds netlify/edge-functions there.
    result = subprocess.run([cli, 'deploy', '--prod', '--dir', 'site', '--site', site], cwd=stage)
    if result.returncode != 0:
        print('Netlify deploy failed (see above). Nothing on the live site changed.')
        sys.exit(result.returncode)


def main():
    global ESBUILD
    project = os.path.basename(SRC.rstrip(os.sep))
    args = sys.argv[1:]
    deploying = '--deploy' in args
    args = [a for a in args if a != '--deploy']
    zip_path = os.path.abspath(args[0]) if args else os.path.join(os.path.dirname(SRC), f'{project}-netlify.zip')
    ESBUILD = esbuild_path()

    stage = tempfile.mkdtemp(prefix='minify-')
    out = os.path.join(stage, 'site')
    stats = {k: [0, 0, 0] for k in ('js', 'css', 'html', 'json', 'copied')}
    problems = []
    manifest_actions = check_manifest(problems)
    try:
        for root, dirs, files in os.walk(SRC):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            rel_root = os.path.relpath(root, SRC)
            in_vendor = rel_root == 'vendor' or rel_root.startswith('vendor' + os.sep)
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if (rel_root == '.' and f in SKIP_ROOT_FILES) or ext in SKIP_EXT:
                    continue
                src = os.path.join(root, f)
                rel = os.path.normpath(os.path.join(rel_root, f))
                rel_web = rel.replace(os.sep, '/')
                dst = os.path.join(out, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                before = os.path.getsize(src)
                kind = 'copied'
                if not in_vendor and ext in MINIFY_EXT:
                    text = open(src, encoding='utf-8').read()
                    if ext == '.js':
                        mini, kind = esbuild(text, 'js'), 'js'
                        check_js(rel_web, text, mini, problems)
                    elif ext == '.css':
                        mini, kind = esbuild(text, 'css'), 'css'
                    elif ext == '.html':
                        mini, kind = minify_html(text), 'html'
                        check_html(rel_web, mini, problems)
                    else:
                        data = json.loads(text)
                        mini, kind = json.dumps(data, ensure_ascii=False, separators=(',', ':')), 'json'
                        if json.loads(mini) != data:
                            problems.append(f'{rel_web}: JSON data changed')
                    with open(dst, 'w', encoding='utf-8', newline='\n') as fh:
                        fh.write(mini)
                else:
                    shutil.copy2(src, dst)
                s = stats[kind]; s[0] += 1; s[1] += before; s[2] += os.path.getsize(dst)

        bundles = []
        if not problems:
            for page_rel, name in BUNDLE_PAGES.items():
                if os.path.exists(os.path.join(out, page_rel)):
                    bundles += bundle_page(out, page_rel, name, problems)
        if deploying and not problems:
            stage_edge_functions(stage, problems)

        if problems:
            print('Build stopped, nothing was ' + ('deployed:' if deploying else 'zipped:'))
            for p in problems:
                print('  -', p)
            sys.exit(1)

        if deploying:
            report(stats, bundles, manifest_actions)
            deploy(stage)
            print('All checks passed. Deployed.')
            return

        tmp_zip = os.path.join(stage, 'site.zip')
        count = 0
        with zipfile.ZipFile(tmp_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for root, _, files in os.walk(out):
                for f in sorted(files):
                    p = os.path.join(root, f)
                    z.write(p, os.path.relpath(p, out).replace(os.sep, '/'))
                    count += 1
        os.makedirs(os.path.dirname(zip_path), exist_ok=True)
        shutil.move(tmp_zip, zip_path)
    finally:
        shutil.rmtree(stage, ignore_errors=True)

    report(stats, bundles, manifest_actions)
    print(f'All checks passed. {count} files -> {zip_path} ({os.path.getsize(zip_path) / 1024 / 1024:.2f} MB)')


def report(stats, bundles, manifest_actions):
    for k, (n, b, a) in stats.items():
        if n:
            print(f'  {k:7s} {n:4d} files  {b / 1024:9.1f} KB -> {a / 1024:9.1f} KB')
    for rel, refs in bundles:
        print(f'  bundle  {rel}  <- {len(refs)} files')
    print(f'{MANIFEST}, once deployed (compared with the last commit):')
    for line in manifest_actions or ['Nothing unusual: no new version, no settings that change what open tabs do.']:
        print('  *', line)


if __name__ == '__main__':
    main()
