#!/usr/bin/env python3
"""Draws the Afterglow app icon (1024x1024) into the asset catalog."""
import pathlib
from PIL import Image, ImageDraw, ImageFilter
S = 1024
out = pathlib.Path(__file__).resolve().parent.parent / 'ios/Assets.xcassets/AppIcon.appiconset/icon-1024.png'
img = Image.new('RGB', (S, S), (0, 0, 0))
d = ImageDraw.Draw(img)
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(14 + 10 * t), int(16 + 8 * t), int(30 + 22 * t)))
glow = Image.new('L', (S, S), 0)
ImageDraw.Draw(glow).ellipse((190, 170, 834, 794), fill=150)
glow = glow.filter(ImageFilter.GaussianBlur(110))
img = Image.composite(Image.new('RGB', (S, S), (40, 90, 200)), img, glow)
d = ImageDraw.Draw(img)
blue = (58, 130, 247)
d.rounded_rectangle((212, 250, 812, 700), radius=150, fill=blue)
d.polygon([(330, 660), (300, 820), (470, 690)], fill=blue)
cx, top, bot = 512, 368, 600
d.polygon([(cx, top + 30), (cx - 190, top), (cx - 190, bot - 20), (cx, bot)], fill=(255, 255, 255))
d.polygon([(cx, top + 30), (cx + 190, top), (cx + 190, bot - 20), (cx, bot)], fill=(232, 240, 255))
d.line([(cx, top + 30), (cx, bot)], fill=blue, width=10)
for i in range(4):
    y = top + 70 + i * 38
    d.line([(cx - 160, y - 12), (cx - 35, y + 8)], fill=(150, 180, 235), width=12)
    d.line([(cx + 35, y + 8), (cx + 160, y - 12)], fill=(150, 180, 235), width=12)
img.save(out)
print('icon written', out)
