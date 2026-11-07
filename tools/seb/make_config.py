"""
make_config.py  ·  Writes the Safe Exam Browser configs for lockdown mode.

    python tools/seb/make_config.py

Writes seb/<host>.seb for every host in HOSTS; js/lockdown.js links to them.
A host added here must also go in LOCKDOWN_HOSTS there.

A .seb file is gzip("plnd" + gzip(plist XML)), the unencrypted format from
https://safeexambrowser.org/developer/seb-file-format.html
Settings left out keep SEB's defaults, which include its kiosk mode and the
refusal to run in a virtual machine.
"""

import gzip
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HOSTS = {
    'phys161.netlify.app': 'https://phys161.netlify.app',
    'phys162.netlify.app': 'https://phys162.netlify.app',
    # python -m http.server 8000 (opened with a seb:// link)
    'localhost': 'http://localhost:8000',
}


def settings(host, origin):
    return {
        'startURL': f'{origin}/',
        # Adds what follows a second "?" in the seb link to startURL: the
        # drop-off ticket from js/lockdown.js.
        'startURLAppendQueryParameter': True,
        # Navigating here closes SEB (exitLockdown() in js/lockdown.js).
        'quitURL': f'{origin}/seb/quit.html',
        'quitURLConfirm': False,
        # 1 = full screen. No taskbar either: the site has its own clock and
        # battery, and SEB then keeps no strip of the screen for itself.
        'browserViewMode': 1,
        'showTaskBar': False,
        # No quit password. With no taskbar there's no quit button, so leaving is
        # Exit lockdown on the site, or Ctrl+Q if the site itself won't load.
        'allowQuit': True,
        # 3 = prefer the modern web view, which has the JavaScript API that
        # js/lockdown.js looks for.
        'browserWindowWebView': 3,
        'sendBrowserExamKey': False,
        # Pages may only open on this site. The content filter stays off: the
        # site loads fonts and data from other hosts, and on macOS and iOS it
        # would force the older web view.
        'URLFilterEnable': True,
        'URLFilterEnableContentFilter': False,
        'URLFilterRules': [
            {'action': 1, 'active': True, 'expression': host, 'regex': False},
        ],
        'allowDownloads': False,
        'allowSpellCheck': False,
        'enableZoomPage': True,
    }


def encode(config):
    xml = plistlib.dumps(config, sort_keys=True)
    # mtime=0 keeps the output identical between runs, so an unchanged config
    # never shows up as a diff.
    return gzip.compress(b'plnd' + gzip.compress(xml, mtime=0), mtime=0)


def decode(data):
    outer = gzip.decompress(data)
    if outer[:4] != b'plnd':
        raise ValueError('missing plnd prefix')
    return plistlib.loads(gzip.decompress(outer[4:]))


def main():
    out_dir = ROOT / 'seb'
    out_dir.mkdir(exist_ok=True)
    for host, origin in HOSTS.items():
        config = settings(host, origin)
        data = encode(config)
        if decode(data) != config:
            raise SystemExit(f'{host}: the file does not read back as written')
        path = out_dir / f'{host}.seb'
        path.write_bytes(data)
        print(f'{path.relative_to(ROOT)}  ({len(data)} bytes)  {config["startURL"]}')


if __name__ == '__main__':
    main()
