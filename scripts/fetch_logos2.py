#!/usr/bin/env python3
"""Fetch ngnmarket icons for tickers in /tmp/feed-tickers.txt not yet checked,
validate (HTTP 200 + image magic), convert to PNG, update assets/logos.js."""
import os, sys, json, subprocess
from PIL import Image

OUTDIR = os.path.expanduser('~/workspace/nairaview/assets/logos')
os.makedirs(OUTDIR, exist_ok=True)

checked = set()
with open('/tmp/iconcheck.txt') as f:
    for line in f:
        p = line.split()
        if p:
            checked.add(p[0])

with open('/tmp/feed-tickers.txt') as f:
    tickers = [t.strip() for t in f if t.strip() and t.strip() not in checked]

print(f'{len(tickers)} tickers to check', flush=True)
new_lines = []
for t in tickers:
    url = f'https://ngnmarket.com/icons/companies/{t}.ico'
    p = subprocess.run(['curl', '-s', '--max-time', '20', '-L', '-w', '\n%{http_code}',
                        '-o', '/tmp/logo_dl.bin', url], capture_output=True, text=True)
    code = p.stdout.strip().split('\n')[-1]
    try:
        size = os.path.getsize('/tmp/logo_dl.bin')
    except OSError:
        size = 0
    new_lines.append(f'{t} {code} {size}')
    if code != '200' or size <= 500:
        print(f'{t}: no icon ({code}, {size}b)')
        continue
    with open('/tmp/logo_dl.bin', 'rb') as fh:
        magic = fh.read(4)
    if magic not in (b'\x00\x00\x01\x00', b'\x89PNG'):
        print(f'{t}: not an image ({magic!r})')
        continue
    try:
        im = Image.open('/tmp/logo_dl.bin')
        if getattr(im, 'n_frames', 1) > 1:
            best, bestpx = 0, 0
            for i in range(im.n_frames):
                im.seek(i)
                px = im.size[0] * im.size[1]
                if px > bestpx:
                    best, bestpx = i, px
            im.seek(best)
        im = im.convert('RGBA')
        if max(im.size) > 256:
            im.thumbnail((256, 256), Image.LANCZOS)
        out = os.path.join(OUTDIR, f'{t}.png')
        im.save(out, 'PNG')
        print(f'{t}: ok ({os.path.getsize(out)}b png)', flush=True)
    except Exception as e:
        print(f'{t}: convert failed: {e}')

with open('/tmp/iconcheck.txt', 'a') as f:
    f.write('\n'.join(new_lines) + '\n')

# rebuild manifest from what is actually on disk
manifest = {fn[:-4]: True for fn in sorted(os.listdir(OUTDIR)) if fn.endswith('.png')}
js = '// Auto-generated — tickers with a self-hosted logo.\n'
js += 'window.NV_LOGOS = ' + json.dumps(manifest, sort_keys=True) + ';\n'
with open(os.path.expanduser('~/workspace/nairaview/assets/logos.js'), 'w') as f:
    f.write(js)
print(f'\nmanifest: {len(manifest)} logos')
