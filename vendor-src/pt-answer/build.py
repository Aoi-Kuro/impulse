"""
build.py  ·  Builds vendor/pt-answer/pt-answer.min.js from src/ (see README.md).

    python vendor-src/pt-answer/build.py

Bundles src/index.ts into one minified script that defines the global
PTAnswer, and copies LICENSE next to it. Uses the esbuild that minify.py
downloads (once, into your user profile); nothing else needs installing.
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'vendor', 'pt-answer')

sys.path.insert(0, ROOT)
sys.dont_write_bytecode = True  # no __pycache__ in the project for minify.py
from minify import esbuild_path  # noqa: E402

# The license notice travels with the file. Object.hasOwn is from 2022
# browsers; the fallback keeps the engine working on older phones.
BANNER = (
    '/*! pt-answer: answer checking from pt-nu-phys161 (github.com/omgaXD/pt-nu-phys161), '
    'MIT License, Copyright (c) 2026 omga, see LICENSE. Parser and unit table rewritten for impulse. */\n'
    'Object.hasOwn||(Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k)});'
)


def main():
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, 'pt-answer.min.js')
    subprocess.run([
        esbuild_path(), 'src/index.ts',
        '--bundle', '--format=iife', '--global-name=PTAnswer',
        '--target=es2018', '--minify', '--legal-comments=none',
        '--alias:@pt/core=./src/core/index.ts',
        '--banner:js=' + BANNER,
        '--outfile=' + out, '--log-level=warning',
    ], cwd=HERE, check=True)
    shutil.copyfile(os.path.join(HERE, 'LICENSE'), os.path.join(OUT, 'LICENSE'))
    print(f'{os.path.relpath(out, ROOT)}: {os.path.getsize(out) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
