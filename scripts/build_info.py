#!/usr/bin/env python3
"""Build the info shown after guessing a bird:
  data/info/<id>.json  short description, range-map cells and month-by-month records
  data/map.json        country outlines for drawing the range map

Run after build_data.py:  python3 scripts/build_info.py [--missing-only]
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.inaturalist.org/v1"
DATA = Path(__file__).resolve().parent.parent / "data"
PLACES = {"ZA": 6986, "NA": 7140, "BW": 7105, "ZW": 7146, "LS": 8489, "SZ": 7143, "MZ": 7134}
BOUNDS = {"west": 11.5, "east": 41, "south": -35, "north": -15.5}  # the map window
GRID_TILES = ["4/8/8", "4/9/8", "4/8/9", "4/9/9"]  # web-map tiles covering Southern Africa, ~0.6 degree cells


def get(path, **params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "sa-bird-flashcards/0.3"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            time.sleep(1)
            return data
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500 and e.code != 429:
                raise
            print(f"  retry {attempt + 1} for {path}: {e}")
            time.sleep(2 ** (attempt + 1))
        except Exception as e:
            print(f"  retry {attempt + 1} for {path}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def simplify(ring, tolerance=0.08):
    """Drop points closer than `tolerance` degrees to the last kept one (small map, small file)."""
    out = [ring[0]]
    for p in ring[1:]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= tolerance:
            out.append(p)
    return [[round(x, 2), round(y, 2)] for x, y in out] if len(out) > 3 else []


def build_map():
    countries = {}
    for code, pid in PLACES.items():
        g = get(f"places/{pid}")["results"][0]["geometry_geojson"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        countries[code] = [r for r in (simplify(poly[0]) for poly in polys) if r]
    (DATA / "map.json").write_text(json.dumps({"bounds": BOUNDS, "countries": countries}, separators=(",", ":")))
    print("wrote map.json")


def plain(summary):
    text = re.sub(r"<[^>]+>", "", summary or "")
    return html.unescape(text).strip()


def info_for(s):
    t = get(f"taxa/{s['id']}")["results"][0]
    cells = []
    b = BOUNDS
    points = []
    for tile in GRID_TILES:
        points += get(f"grid/{tile}.grid.json", taxon_id=s["id"], quality_grade="research").get("data", {}).values()
    for d in points:
        lat, lng = d["latitude"], d["longitude"]
        if b["south"] <= lat <= b["north"] and b["west"] <= lng <= b["east"]:
            n = d.get("cellCount", 1)
            cells.append([round(lat, 1), round(lng, 1), 1 if n < 5 else 2 if n < 50 else 3])
    hist = get("observations/histogram", taxon_id=s["id"], place_id=",".join(map(str, PLACES.values())),
               quality_grade="research", interval="month_of_year", date_field="observed")
    months = [hist["results"]["month_of_year"].get(str(m), 0) for m in range(1, 13)]
    return {
        "summary": plain(t.get("wikipedia_summary")),
        "wiki": t.get("wikipedia_url"),
        "cells": cells,
        "months": months,
    }


def main():
    out = DATA / "info"
    out.mkdir(exist_ok=True)
    if not (DATA / "map.json").exists() or "--missing-only" not in sys.argv:
        build_map()
    species = json.loads((DATA / "species.json").read_text())
    for n, s in enumerate(species, 1):
        f = out / f"{s['id']}.json"
        if "--missing-only" in sys.argv and f.exists():
            continue
        f.write_text(json.dumps(info_for(s), ensure_ascii=False, separators=(",", ":")))
        if n % 50 == 0:
            print(f"{n}/{len(species)}")
    keep = {f"{s['id']}.json" for s in species}
    for f in out.glob("*.json"):
        if f.name not in keep:
            f.unlink()
    print(f"wrote info for {len(species)} species")


if __name__ == "__main__":
    main()
