#!/usr/bin/env python3
"""Build data/calls.json: bird call recordings from xeno-canto for every species
in data/species.json.

Needs a free xeno-canto API key (https://xeno-canto.org, account page):
    XC_API_KEY=your-key python3 scripts/build_calls.py
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://xeno-canto.org/api/3/recordings"
DATA = Path(__file__).resolve().parent.parent / "data"
CALLS_PER_SPECIES = 4
MAX_SECONDS = 90
MAX_WAV_SECONDS = 20  # uncompressed WAVs are ~200 KB/s, only short ones are OK on mobile
REGION = {"South Africa", "Namibia", "Botswana", "Zimbabwe", "Lesotho", "Eswatini", "Swaziland", "Mozambique"}


def search(query, key):
    url = f"{API}?{urllib.parse.urlencode({'query': query, 'key': key, 'per_page': 200})}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.load(r)
            time.sleep(0.5)
            return data.get("recordings", [])
        except Exception as e:
            print(f"  retry {attempt + 1} for {query}: {e}")
            time.sleep(2 ** (attempt + 1))
    return []


def seconds(length):
    parts = [int(p) for p in length.split(":") if p.isdigit()]
    total = 0
    for p in parts:
        total = total * 60 + p
    return total


def short_license(url):
    m = re.search(r"licenses/([a-z-]+)/", url or "")
    return f"CC {m.group(1).upper()}" if m else "CC"


def sound_type(raw):
    raw = raw.lower()
    if "song" in raw and "call" in raw:
        return "Song & call"
    if "song" in raw:
        return "Song"
    if "alarm" in raw:
        return "Alarm call"
    if "flight" in raw:
        return "Flight call"
    if "call" in raw:
        return "Call"
    return "Sound"


def pick(recordings):
    """Choose the best few recordings: regional, compressed, short, good quality."""
    usable = []
    for r in recordings:
        secs = seconds(r.get("length") or "0")
        is_mp3 = (r.get("file-name") or "").lower().endswith(".mp3")
        if not r.get("file") or secs == 0 or secs > MAX_SECONDS:
            continue
        if not is_mp3 and secs > MAX_WAV_SECONDS:
            continue
        noisy = any(w in (r.get("type") or "").lower() for w in ("people", "aircraft", "traffic", "background"))
        score = (r.get("cnt") in REGION) * 4 + is_mp3 * 2 + (r.get("q") == "A") + (secs <= 40) - noisy * 3
        r["type"] = sound_type(r.get("type") or "")
        usable.append((score, r))
    usable.sort(key=lambda x: -x[0])

    chosen, types = [], set()
    # First pass: one of each sound type (song, call, ...), so cards vary.
    for _, r in usable:
        t = r.get("type", "")
        if t not in types:
            types.add(t)
            chosen.append(r)
        if len(chosen) == CALLS_PER_SPECIES:
            break
    for _, r in usable:
        if len(chosen) == CALLS_PER_SPECIES:
            break
        if r not in chosen:
            chosen.append(r)
    return [{
        "url": r["file"],
        "type": r.get("type", ""),
        "attr": f"{r.get('rec', 'Unknown')}, xeno-canto XC{r['id']} ({short_license(r.get('lic'))})",
        "cnt": r.get("cnt", ""),
    } for r in chosen]


def main():
    key = os.environ.get("XC_API_KEY")
    if not key:
        sys.exit("Set XC_API_KEY to your xeno-canto API key.")
    species = json.loads((DATA / "species.json").read_text())
    calls, missing = {}, []
    for i, s in enumerate(species, 1):
        recs = search(f'sp:"{s["sci"]}" q:">C"', key) or search(f'en:"{s["name"]}" q:">C"', key)
        chosen = pick(recs)
        if chosen:
            calls[str(s["id"])] = chosen
        else:
            missing.append(s["name"])
        if i % 50 == 0:
            print(f"{i}/{len(species)} species, {len(calls)} with calls")
    (DATA / "calls.json").write_text(json.dumps(calls, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote calls for {len(calls)} of {len(species)} species")
    print(f"no usable recordings for {len(missing)}: {', '.join(missing)}")


if __name__ == "__main__":
    main()
