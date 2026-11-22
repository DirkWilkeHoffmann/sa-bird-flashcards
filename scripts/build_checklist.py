#!/usr/bin/env python3
"""Build data/checklist.json from BirdLife South Africa's "Checklist of Birds in South Africa" PDF.

Run:  python3 scripts/build_checklist.py path/to/BLSA-Checklist-2026-v3.pdf   (needs pdftotext)
For each bird: the names BLSA gives ("Cape Turtle (Ring-necked) Dove" gives both names), the
scientific name, BLSA's codes (red data, V = vagrant, I = introduced, E/NE = endemic),
"pei" for the birds only on the Prince Edward Islands, and the bird's iNaturalist taxon id.
build_data.py adds every checklist bird to the app; build_areas.py uses "pei" for that area.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import get  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = DATA / "checklist.json"
EDITION = "BirdLife South Africa Checklist of Birds in South Africa 2026"
PEI_HEADING = "PRINCE EDWARD ISLANDS"
ENTRY = re.compile(r"^(?P<eng>.+?) (?P<sci>[A-Z][a-z]+ [a-z][a-z-]+)(?: \((?P<codes>[^)]*)\))?$")
# Entries the bracket rule below would read wrongly: raw entry -> its names.
NAMES_BY_HAND = {
    "Warbler, Broad-tailed (Fan-tailed Grassbird)": ["Broad-tailed Warbler", "Fan-tailed Grassbird"],
}
# BLSA's spelling of a scientific name -> iNaturalist's, where they differ only in spelling.
SCI_FIX = {"Hydropogne caspia": "Hydroprogne caspia", "Oceaniates pincoyae": "Oceanites pincoyae",
           "Cercopis rufula": "Cecropis rufula",
           "Larus canus": "Chroicocephalus ridibundus"}  # BLSA prints Black-headed Gull with Common Gull's name


def alternatives(text):
    """'Cape Turtle (Ring-necked)' -> ['Cape Turtle', 'Ring-necked']; 'African (Holub's) Golden' ->
    ["African Golden", "Holub's Golden"]; '(American) Purple' -> ['American Purple', 'Purple']."""
    m = re.fullmatch(r"(.*?)\s*\(([^)]*)\)\s*(.*)", text)
    if not m:
        return [text]
    before, inside, after = m.groups()
    if not before:
        return [f"{inside} {after}", after]
    if not after:
        return [before, inside]
    return [f"{before} {after}", f"{inside} {after}"]


def names_of(raw):
    if raw in NAMES_BY_HAND:
        return NAMES_BY_HAND[raw]
    if ", " not in raw:
        return alternatives(raw)  # one-word names: Bokmakierie, Osprey, Whinchat
    group, mod = raw.split(", ", 1)
    names = [f"{m} {g}" for m in alternatives(mod) for g in alternatives(group)]
    return list(dict.fromkeys(n.strip() for n in names))


def parse(text):
    birds, pei_col = [], None
    for line in text.splitlines():
        if "Compiled by" in line:
            break  # the list ends here; the back page has credits and adverts
        line = line.replace("\t", "    ")
        for m in re.finditer(r"\S+(?: \S+)*", line):  # chunks split by 2+ spaces
            chunk, col = m.group(), m.start()
            if chunk.startswith(PEI_HEADING):
                pei_col = col
                continue
            if chunk == "NOTES":
                pei_col = None
            e = ENTRY.match(chunk)
            if not e:
                continue
            raw = re.sub(r"(?<=\w)- (?=[A-Za-z])", "-", e["eng"].replace("’", "'"))  # "Hawk- Eagle"
            codes = [c.strip() for c in (e["codes"] or "").split(",") if c.strip()]
            birds.append({"names": names_of(raw), "sci": SCI_FIX.get(e["sci"], e["sci"]), "codes": codes,
                          "pei": pei_col is not None and col >= pei_col - 2})
    return birds


def inat_id(sci, known):
    """iNaturalist taxon id for a scientific name: the app's own bird first, then a search
    (an exact species match, else a synonym iNaturalist files under another name)."""
    if sci in known:
        return known[sci], sci
    d = get("taxa", q=sci, is_active="true", per_page=10)
    for t in d["results"]:
        if t["name"] == sci and t["rank"] in ("species", "subspecies"):
            return t["id"], t["name"]
    for t in d["results"]:
        if t.get("matched_term") == sci and t["rank"] in ("species", "subspecies") and t["iconic_taxon_name"] == "Aves":
            return t["id"], t["name"]
    return None, None


def main():
    pdf = sys.argv[1]
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    birds = parse(text)
    species = json.loads((DATA / "species.json").read_text())
    known = {s["sci"]: s["id"] for s in species}
    import build_names
    known.update({ioc: known[ours] for ours, ioc in build_names.SAME_BIRD.items() if ours in known})
    old = {b["sci"]: b for b in json.loads(OUT.read_text())["birds"]} if OUT.exists() else {}
    for b in birds:
        if b["sci"] in old and old[b["sci"]].get("inat"):
            b["inat"], b["inatSci"] = old[b["sci"]]["inat"], old[b["sci"]].get("inatSci", b["sci"])
        else:
            b["inat"], b["inatSci"] = inat_id(b["sci"], known)
    OUT.write_text(json.dumps({"source": EDITION, "birds": birds}, ensure_ascii=False, indent=1))
    print(f"{len(birds)} birds ({sum(b['pei'] for b in birds)} only on the Prince Edward Islands)")
    for b in birds:
        if not b["inat"]:
            print(f"  not found on iNaturalist: {b['names'][0]} ({b['sci']})")


if __name__ == "__main__":
    main()
