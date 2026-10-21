#!/usr/bin/env python3
"""Build data/similar.json: for each bird, the birds it is most easily confused with.

1. Real mix-ups: species iNaturalist users in Southern Africa actually misidentified it as
   (kept if it happened at least 3 times and is a related bird, or 10+ times).
2. Topped up with close relatives (same genus, or same kind of bird by name) whose ranges overlap.

Run after build_data.py and build_info.py:  python3 scripts/build_similar.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import COUNTRIES, get  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
MAX_SIMILAR = 4
MIN_MIXUPS, MIN_MIXUPS_UNRELATED = 3, 10


def kind(name):
    last = name.split()[-1]
    tail = last.split("-")[-1]
    return tail if tail[:1].isupper() else last


def main():
    species = json.loads((DATA / "species.json").read_text())
    by_id = {s["id"]: s for s in species}
    cells = {}
    for s in species:
        f = DATA / "info" / f"{s['id']}.json"
        cells[s["id"]] = {(c[0], c[1]) for c in json.loads(f.read_text())["cells"]} if f.exists() else set()
    places = ",".join(str(c["place_id"]) for c in COUNTRIES.values())

    similar = {}
    for n, s in enumerate(species, 1):
        picks = []
        for r in get("identifications/similar_species", taxon_id=s["id"], place_id=places)["results"]:
            other = by_id.get(r["taxon"]["id"])
            if not other or other is s:
                continue
            related = other["order"] == s["order"]
            if r["count"] >= (MIN_MIXUPS if related else MIN_MIXUPS_UNRELATED):
                picks.append([other["id"], "mixup"])
            if len(picks) == MAX_SIMILAR:
                break
        if len(picks) < 3:
            # Close relatives that share the range, the most often seen first.
            chosen = {p[0] for p in picks}
            relatives = [o for o in species if o is not s and o["id"] not in chosen
                         and (o["genus"] == s["genus"] or kind(o["name"]) == kind(s["name"]))
                         and cells[o["id"]] & cells[s["id"]]]
            relatives.sort(key=lambda o: -len(cells[o["id"]] & cells[s["id"]]))
            picks += [[o["id"], "relative"] for o in relatives[:3 - len(picks)]]
        similar[str(s["id"])] = picks
        if n % 100 == 0:
            print(f"{n}/{len(species)}")
    (DATA / "similar.json").write_text(json.dumps(similar, separators=(",", ":")))
    print(f"wrote similar.json; {sum(1 for v in similar.values() if v)} of {len(species)} birds have look-alikes")


if __name__ == "__main__":
    main()
