#!/usr/bin/env python3
"""Builds web/index.html (the app the phone loads) from src/app.html + src/platform.js."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / 'src/app.html').read_text()
platform = (root / 'src/platform.js').read_text()
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
(root / 'web').mkdir(exist_ok=True)
(root / 'web/index.html').write_text(out)
