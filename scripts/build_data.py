#!/usr/bin/env python3
"""Build data/species.json: the bird species of the Southern African subregion,
with Creative Commons photos taken in the region, taxonomy, the countries each
bird is regularly seen in, and a difficulty level.

Run from the repo root:  python3 scripts/build_data.py
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.inaturalist.org/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "species.json"

# Southern African subregion. Mozambique only south of the Zambezi (bounding box).
COUNTRIES = {
    "ZA": {"place_id": 6986},
    "NA": {"place_id": 7140},
    "BW": {"place_id": 7105},
    "ZW": {"place_id": 7146},
    "LS": {"place_id": 8489},
    "SZ": {"place_id": 7143},
    "MZ": {"place_id": 7134, "nelat": -16, "nelng": 41, "swlat": -27, "swlng": 30},
}
MIN_OBSERVATIONS = 5        # fewer records than this = vagrant, left out
MIN_IN_COUNTRY = 2          # records needed for a bird to count as "seen in" a country
ESTABLISHED_INTRODUCED = 100  # introduced birds with this many records count as established
EASY, MEDIUM = 150, 300     # most-recorded 150 = easy, next 300 = medium, rest = hard
PHOTOS_PER_SPECIES = 8
# Corrections the data can't make by itself.
ALWAYS_INCLUDE = {3017}    # Rock Pigeon: established, but most records are marked "domestic"
ALWAYS_EXCLUDE = {14110, 20504, 1204}  # Zebra Finch, Emu, Indian Peafowl: escaped or kept birds
LICENSES = "cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd"


def get(path, **params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "sa-bird-flashcards/0.2"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            time.sleep(1)  # stay well inside iNaturalist's rate limit
            return data
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500 and e.code != 429:
                raise  # a bad request will not succeed on retry
            print(f"  retry {attempt + 1} for {path}: {e}")
            time.sleep(2 ** (attempt + 1))
        except Exception as e:
            print(f"  retry {attempt + 1} for {path}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def species_counts(**query):
    """Return {taxon_id: research-grade wild observation count} for bird species."""
    counts, page = {}, 1
    while True:
        d = get("observations/species_counts", taxon_id=3, quality_grade="research", captive="false",
                rank="species", per_page=500, page=page, **query)
        for r in d["results"]:
            counts[r["taxon"]["id"]] = r["count"]
        if page * 500 >= d["total_results"]:
            return counts
        page += 1


def ancestor(t, rank):
    return next((a for a in t.get("ancestors", []) if a["rank"] == rank), None)


def english_name(t):
    """iNaturalist sometimes prefers an Afrikaans name for SA; make sure it is English."""
    english = [n["name"] for n in t.get("names", []) if (n.get("lexicon") or "").lower() == "english"]
    preferred = t.get("preferred_common_name")
    if preferred and (not english or preferred in english):
        return preferred
    return english[0] if english else t["name"]


def regional_photos(taxon_id):
    """Best-voted licensed photos from observations inside the region, one per observation."""
    photos = []
    for code in ("ZA", "NA,BW,ZW,LS,SZ,MZ"):
        places = ",".join(str(COUNTRIES[c]["place_id"]) for c in code.split(","))
        d = get("observations", taxon_id=taxon_id, place_id=places, quality_grade="research",
                photos="true", photo_license=LICENSES, order_by="votes", per_page=30)
        for o in d["results"]:
            p = next((p for p in o["photos"] if p.get("license_code")), None)
            if p and p["id"] not in {x["id"] for x in photos}:
                base, ext = p["url"].rsplit("/", 1)[0], p["url"].rsplit(".", 1)[-1]
                photos.append({"id": p["id"], "base": base, "ext": ext, "attr": p["attribution"]})
            if len(photos) == PHOTOS_PER_SPECIES:
                return photos
        if len(photos) >= PHOTOS_PER_SPECIES // 2:
            break
    return photos


def main():
    per_country = {}
    for code, q in COUNTRIES.items():
        per_country[code] = species_counts(**q)
        print(f"{code}: {len(per_country[code])} species")
    totals = {}
    for counts in per_country.values():
        for tid, c in counts.items():
            totals[tid] = totals.get(tid, 0) + c

    introduced = {}
    for code, q in COUNTRIES.items():
        for tid, c in species_counts(introduced="true", **q).items():
            introduced[tid] = introduced.get(tid, 0) + c
    # Escapee = mostly introduced records and never became established.
    escapees = {tid for tid, c in introduced.items()
                if c >= 0.5 * totals.get(tid, 0) and totals.get(tid, 0) < ESTABLISHED_INTRODUCED}

    for tid in ALWAYS_INCLUDE:  # count every record, domestic or not, so it ranks fairly
        for code, q in COUNTRIES.items():
            per_country[code][tid] = get("observations", taxon_id=tid, quality_grade="research",
                                         per_page=0, **q)["total_results"]
        totals[tid] = sum(per_country[c][tid] for c in COUNTRIES)
    ids = [tid for tid, c in totals.items()
           if (c >= MIN_OBSERVATIONS and tid not in escapees and tid not in ALWAYS_EXCLUDE) or tid in ALWAYS_INCLUDE]
    print(f"{len(totals)} species recorded; {len(escapees)} escapees and "
          f"{sum(1 for c in totals.values() if c < MIN_OBSERVATIONS)} vagrants removed; {len(ids)} kept")

    ranked = sorted(ids, key=lambda tid: -totals[tid])
    level = {tid: ("easy" if i < EASY else "medium" if i < EASY + MEDIUM else "hard")
             for i, tid in enumerate(ranked)}

    taxa = {}
    for i in range(0, len(ids), 30):
        batch = ids[i:i + 30]
        d = get(f"taxa/{','.join(map(str, batch))}", locale="en", preferred_place_id=6986, all_names="true")
        for t in d["results"]:
            taxa[t["id"]] = t

    species = []
    for n, tid in enumerate(ids, 1):
        t = taxa[tid]
        if n % 50 == 0:
            print(f"photos {n}/{len(ids)}")
        photos = regional_photos(tid)
        if not photos:
            print(f"  no regional photos: {english_name(t)}")
            continue
        fam, order, genus = ancestor(t, "family"), ancestor(t, "order"), ancestor(t, "genus")
        species.append({
            "id": tid,
            "name": english_name(t),
            "sci": t["name"],
            "genus": genus["name"] if genus else None,
            "family": fam["name"] if fam else None,
            "familyName": fam.get("preferred_common_name") if fam else None,
            "order": order["name"] if order else None,
            "obs": totals[tid],
            "level": level[tid],
            "countries": [c for c in COUNTRIES if per_country[c].get(tid, 0) >= MIN_IN_COUNTRY],
            "wiki": t.get("wikipedia_url"),
            "photos": photos,
        })

    species.sort(key=lambda s: (s["order"] or "", s["family"] or "", s["sci"]))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(species)} species to {OUT}")


if __name__ == "__main__":
    main()
