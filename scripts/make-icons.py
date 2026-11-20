#!/usr/bin/env python3
"""Builds CAELIX icon assets from assets/source/caelix-icon-original.webp.
Crops the rounded-square artwork (no redraw, no regeneration), gives it a transparent
squircle mask, and exports the PNG sizes, .icns and window icon."""
import os, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/caelix-icon-original.webp')
OUT = os.path.join(ROOT, 'assets/icons')
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(int)
H, W, _ = a.shape
# Artwork geometry (measured from the source image): a squircle, exponent ~3.9.
BX0, BY0, BX1, BY1, N = 180.0, 66.0, 972.0, 859.0, 3.9
side = int(round(max(BX1 - BX0, BY1 - BY0)))
cxm, cym = (BX0 + BX1) / 2, (BY0 + BY1) / 2
left, top = int(round(cxm - side / 2)), int(round(cym - side / 2))
art = im.crop((left, top, left + side, top + side)).convert('RGBA')
SS = 4
yy, xx = np.mgrid[0:side * SS, 0:side * SS]
u = np.abs((xx + 0.5) / SS - side / 2) / (side / 2 - 0.5)
v = np.abs((yy + 0.5) / SS - side / 2) / (side / 2 - 0.5)
hi = ((u ** N + v ** N) <= 1.0).astype('uint8') * 255
m = Image.fromarray(hi).resize((side, side), Image.LANCZOS)
art.putalpha(m)

CANVAS, ART = 1024, 824   # macOS icon grid: artwork 824 px inside 1024 px canvas
art_big = art.resize((ART, ART), Image.LANCZOS)
master = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
# soft shadow under the artwork
sh = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
sh_alpha = Image.new('L', (CANVAS, CANVAS), 0)
sh_alpha.paste(art_big.getchannel('A').point(lambda v: int(v * 0.35)), ((CANVAS - ART) // 2, (CANVAS - ART) // 2 + 14))
sh_alpha = sh_alpha.filter(ImageFilter.GaussianBlur(14))
sh.putalpha(sh_alpha)
master.alpha_composite(sh)
master.alpha_composite(art_big, ((CANVAS - ART) // 2, (CANVAS - ART) // 2))
master.save(os.path.join(OUT, 'icon-1024.png'))

for s in (16, 32, 48, 64, 128, 256, 512):
    master.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'icon-{s}.png'))
master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))  # Electron window icon

iconset = os.path.join(OUT, 'CAELIX.iconset')
os.makedirs(iconset, exist_ok=True)
for s in (16, 32, 128, 256, 512):
    master.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
    master.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
subprocess.check_call(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(OUT, 'icon.icns')])
# ICO for completeness (Windows/Linux builds later)
master.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('ok', sorted(os.listdir(OUT)))
