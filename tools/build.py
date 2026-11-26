#!/usr/bin/env python3
"""Builds the app from src/.
  python3 tools/build.py             -> web/index.html  (the phone app: app + on-device platform layer)
  python3 tools/build.py --artifact  -> web/artifact.html (the version that runs inside Claude)
src/app.html is a small template; lines like `//@include core.js` pull in the other src files."""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
def expand(text):
    return re.sub(r'^[ \t]*(?://|/\*)@include ([\w.\-]+)(?:\*/)?[ \t]*$', lambda m: (src / m.group(1)).read_text().rstrip('\n'), text, flags=re.M)
app = expand((src / 'app.html').read_text())
(root / 'web').mkdir(exist_ok=True)
if '--artifact' in sys.argv:
    (root / 'web/artifact.html').write_text(app)
    sys.exit(0)
platform = (src / 'platform.js').read_text()
title = re.search(r'<title>.*?</title>', app, re.S).group(0)
app = app.replace(title, '', 1)
reset = (":root{color-scheme:dark;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
         "html,body{height:100%}body{margin:0;font:14px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;"
         "-webkit-text-size-adjust:100%;overscroll-behavior:none}img{max-width:100%}[hidden]{display:none!important}"
         "*{-webkit-tap-highlight-color:transparent}")
out = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">'
       '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#000000">'
       + title + '<style>' + reset + '</style><script>' + platform + '</script></head><body>' + app + '</body></html>\n')
(root / 'web/index.html').write_text(out)
