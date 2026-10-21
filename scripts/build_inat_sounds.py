#!/usr/bin/env python3
"""Add iNaturalist sound recordings to data/calls.json as a second source of calls,
so birds still have calls when xeno-canto is unavailable.

Takes up to SOUNDS_PER_SPECIES Creative Commons recordings from research-grade
observations inside the region (best voted first). Existing xeno-canto entries are kept.

Run after build_calls.py:  python3 scripts/build_inat_sounds.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import COUNTRIES, LICENSES, get  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
SOUNDS_PER_SPECIES = 3
PLAYABLE = {"audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"}


def credit(attribution, license_code):
    m = re.match(r"\(c\)\s*([^,]+)", attribution or "")
    name = m.group(1).strip() if m else "Unknown"
    return f"{name}, iNaturalist ({(license_code or 'cc').upper().replace('CC-', 'CC ')})"


def main():
    species = json.loads((DATA / "species.json").read_text())
    calls = json.loads((DATA / "calls.json").read_text())
    places = ",".join(str(c["place_id"]) for c in COUNTRIES.values())
    added = 0
    for n, s in enumerate(species, 1):
        d = get("observations", taxon_id=s["id"], place_id=places, quality_grade="research", sounds="true",
                sound_license=LICENSES, order_by="votes", per_page=20)
        sounds = []
        for o in d["results"]:
            for snd in o.get("sounds", []):
                if snd.get("license_code") and snd.get("file_url") and snd.get("file_content_type") in PLAYABLE:
                    sounds.append({"url": snd["file_url"], "type": "Sound", "src": "inat",
                                   "attr": credit(snd.get("attribution"), snd.get("license_code")),
                                   "cnt": (o.get("place_guess") or "")[:40]})
                    break  # one recording per observation, for variety
            if len(sounds) == SOUNDS_PER_SPECIES:
                break
        key = str(s["id"])
        existing = [c for c in calls.get(key, []) if c.get("src") != "inat"]
        if sounds:
            calls[key] = existing + sounds
            added += 1
        elif existing:
            calls[key] = existing
        if n % 100 == 0:
            print(f"{n}/{len(species)}, {added} with iNaturalist sounds")
    (DATA / "calls.json").write_text(json.dumps(calls, ensure_ascii=False, separators=(",", ":")))
    have_any = sum(1 for s in species if calls.get(str(s["id"])))
    print(f"iNaturalist sounds for {added} birds; {have_any} of {len(species)} birds now have at least one call")


if __name__ == "__main__":
    main()
