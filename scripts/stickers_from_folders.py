# Run from the repo root: python3 scripts/stickers_from_folders.py (needs cwebp: brew install webp)
# Rebuilds data/stickers.json, the app's sticker images and rarity.csv from the by-rarity folders.
import json, os, subprocess, csv, sys
root = '/Users/dwhoffmann/Developer/sa-bird-stickers/by-rarity'
sp = json.load(open('data/species.json')); by = {s['name']: s for s in sp}
tiers = {'1 Legendary': 'legendary', '2 Rare': 'rare', '3 Common': 'common'}
out, rows, seen = [], [], {}
for folder, tier in tiers.items():
    for f in sorted(os.listdir(f'{root}/{folder}')):
        if not f.endswith('.webp'): continue
        n = f[:-5]
        if n not in by: sys.exit(f'Not an SA Bird name: {folder}/{f}')
        if n in seen: sys.exit(f'{n} is in both {seen[n]} and {folder}')
        seen[n] = folder; s = by[n]
        out.append({'id': s['id'], 'tier': tier})
        rows.append({'tier': tier.title(), 'english_name': n, 'scientific_name': s['sci'], 'sa_bird_id': s['id']})
        dst = f"stickers/{s['id']}.webp"
        subprocess.run(['cwebp', '-quiet', '-q', '82', '-alpha_q', '90', '-resize', '400', '0', f'{root}/{folder}/{f}', '-o', dst], check=True)
keep = {f"{x['id']}.webp" for x in out}
gone = [f for f in os.listdir('stickers') if f.endswith('.webp') and f not in keep]
for f in gone: os.remove(f'stickers/{f}')
json.dump(out, open('data/stickers.json', 'w'), separators=(',', ':'))
with open(f'{root}/rarity.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
from collections import Counter
print(len(out), dict(Counter(x['tier'] for x in out)), 'removed images:', len(gone))
