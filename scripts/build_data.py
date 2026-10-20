#!/usr/bin/env python3
"""Build data/species.json: the bird species of the Southern African subregion,
with Creative Commons photos and taxonomy from iNaturalist.

Run from the repo root:  python3 scripts/build_data.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.inaturalist.org/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "species.json"

# Southern African subregion: SA, Namibia, Botswana, Zimbabwe, Lesotho, Eswatini,
# plus Mozambique south of the Zambezi (approximated with a bounding box).
REGION_QUERIES = [
    {"place_id": "6986,7140,7105,7146,8489,7143"},
    {"place_id": "7134", "nelat": -16, "nelng": 41, "swlat": -27, "swlng": 30},
]
MIN_OBSERVATIONS = 2  # drops one-off vagrant records
PHOTOS_PER_SPECIES = 6
CC_LICENSES = {"cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa", "cc-by-nd", "cc-by-nc-nd"}


def get(path, **params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "sa-bird-flashcards/0.1"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            time.sleep(1)  # stay well inside iNaturalist's rate limit
            return data
        except Exception as e:
            print(f"  retry {attempt + 1} for {path}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def region_species():
    """Return {taxon_id: observation_count} for research-grade bird species."""
    counts = {}
    for q in REGION_QUERIES:
        page = 1
        while True:
            d = get("observations/species_counts", taxon_id=3, quality_grade="research",
                    rank="species", per_page=500, page=page, **q)
            for r in d["results"]:
                tid = r["taxon"]["id"]
                counts[tid] = counts.get(tid, 0) + r["count"]
            if page * 500 >= d["total_results"]:
                break
            page += 1
    return counts


def ancestor(t, rank):
    for a in t.get("ancestors", []):
        if a["rank"] == rank:
            return a
    return None


def main():
    counts = region_species()
    ids = [tid for tid, c in counts.items() if c >= MIN_OBSERVATIONS]
    print(f"{len(counts)} species found, {len(ids)} with >= {MIN_OBSERVATIONS} observations")

    species = []
    for i in range(0, len(ids), 30):
        batch = ids[i:i + 30]
        print(f"taxa {i + 1}-{i + len(batch)} of {len(ids)}")
        d = get(f"taxa/{','.join(map(str, batch))}", locale="en", preferred_place_id=6986)
        for t in d["results"]:
            photos = [
                {"url": p["photo"]["medium_url"].replace("/medium.", "/large."),
                 "attr": p["photo"]["attribution"]}
                for p in t.get("taxon_photos", [])
                if p["photo"].get("license_code") in CC_LICENSES
            ][:PHOTOS_PER_SPECIES]
            fam, order, genus = ancestor(t, "family"), ancestor(t, "order"), ancestor(t, "genus")
            species.append({
                "id": t["id"],
                "name": t.get("preferred_common_name") or t["name"],
                "sci": t["name"],
                "genus": genus["name"] if genus else None,
                "family": fam["name"] if fam else None,
                "familyName": (fam.get("preferred_common_name") if fam else None),
                "order": order["name"] if order else None,
                "obs": counts[t["id"]],
                "photos": photos,
            })

    no_photo = [s["name"] for s in species if not s["photos"]]
    species = [s for s in species if s["photos"]]
    species.sort(key=lambda s: (s["order"] or "", s["family"] or "", s["sci"]))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(species)} species to {OUT}")
    print(f"skipped {len(no_photo)} without CC photos: {', '.join(no_photo) or '-'}")


if __name__ == "__main__":
    main()
