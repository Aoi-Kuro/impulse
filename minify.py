"""
minify.py  ·  Builds a minified copy of the site as a zip for Netlify.

    python minify.py                 -> ../<folder>-netlify.zip (next to this project folder)
    python minify.py path/to/out.zip -> that file instead

Never writes into this project folder: the copy is built in a temporary
folder and only the finished zip is written, outside the project unless a
path inside it is given.

What it does
  - copies the site, leaving out what isn't part of the website:
    .git, superbase/ (edge functions + SQL, deployed to Supabase instead),
    vendor-src/ (sources the vendor/ builds are made from),
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

esbuild is downloaded once from the npm registry into a cache folder in
your user profile (not this project); nothing else needs installing.
"""
import hashlib, io, json, os, platform, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request, zipfile

ESBUILD_VERSION = '0.28.2'

SRC = os.path.dirname(os.path.abspath(__file__))
SELF = os.path.basename(__file__)
SKIP_DIRS = {'.git', 'superbase', 'vendor-src', '.claude', '.vscode', 'node_modules', '__pycache__'}
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


# ── build ───────────────────────────────────────────────────────────────
def main():
    global ESBUILD
    project = os.path.basename(SRC.rstrip(os.sep))
    zip_path = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(os.path.dirname(SRC), f'{project}-netlify.zip')
    ESBUILD = esbuild_path()

    stage = tempfile.mkdtemp(prefix='minify-')
    out = os.path.join(stage, 'site')
    stats = {k: [0, 0, 0] for k in ('js', 'css', 'html', 'json', 'copied')}
    problems = []
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

        if problems:
            print('Build stopped, nothing was zipped:')
            for p in problems:
                print('  -', p)
            sys.exit(1)

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

    for k, (n, b, a) in stats.items():
        if n:
            print(f'  {k:7s} {n:4d} files  {b / 1024:9.1f} KB -> {a / 1024:9.1f} KB')
    for rel, refs in bundles:
        print(f'  bundle  {rel}  <- {len(refs)} files')
    print(f'All checks passed. {count} files -> {zip_path} ({os.path.getsize(zip_path) / 1024 / 1024:.2f} MB)')


if __name__ == '__main__':
    main()
