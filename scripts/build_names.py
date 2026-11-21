#!/usr/bin/env python3
"""Give every bird in data/species.json its English name from the IOC World Bird List.

Run after build_data.py (which also calls this itself):  python3 scripts/build_names.py
iNaturalist's English names are a mix of old Roberts names (Spotted Dikkop, Cape Turtle Dove) and
American eBird/Clements names (Pied Cuckoo, Gray Kestrel); South African birders use the IOC names.
Birds are matched on their scientific name. Where the IOC name differs from iNaturalist's by more
than spelling ("Fish-Eagle" vs "Fish Eagle", "Gray" vs "Grey"), iNaturalist's name is kept in "was",
which the app shows as "Formerly …" and accepts as an answer in quizzes.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "species.json"
IOC_VERSION = "15.2"
IOC_URL = f"https://www.worldbirdnames.org/IOC_Names_File_Plus-{IOC_VERSION}.xlsx"
CACHE = ROOT / "scripts" / ".cache" / f"ioc-{IOC_VERSION}.xlsx"
UA = "sa-bird-flashcards/0.4 (https://github.com/DirkWilkeHoffmann/sa-bird-flashcards)"
# iNaturalist scientific name -> IOC scientific name, where the two lists spell or place a bird differently.
SAME_BIRD = {
    "Grus carunculatus": "Grus carunculata",
    "Grus paradiseus": "Grus paradisea",
}
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def xlsx_rows(path):
    """Rows of the first sheet as {column letter: text}, with no extra libraries."""
    z = zipfile.ZipFile(path)
    shared = [("".join(t.text or "" for t in si.iter(f"{NS}t")))
              for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si")]
    sheet = sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))[0]
    for row in ET.fromstring(z.read(sheet)).iter(f"{NS}row"):
        out = {}
        for c in row.findall(f"{NS}c"):
            v = c.find(f"{NS}v")
            if c.get("t") == "s" and v is not None:
                text = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in c.iter(f"{NS}t"))
            else:
                text = v.text if v is not None else ""
            out[re.match(r"[A-Z]+", c.get("r")).group()] = text
        yield out


def ioc_names():
    """{scientific name: IOC English name} for every species in the IOC list."""
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading IOC {IOC_VERSION} names")
        req = urllib.request.Request(IOC_URL, headers={"User-Agent": UA})
        CACHE.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    rows = xlsx_rows(CACHE)
    header = next(rows)
    rank, english, sci = (next(k for k, v in header.items() if v == want)
                          for want in ("Rank", "English name", "Scientific Name"))
    return {r[sci].strip(): r[english].strip() for r in rows if r.get(rank) == "Species"}


def plain(name):
    """A name without the differences that are only spelling."""
    return re.sub(r"[^a-z]", "", name.lower().replace("gray", "grey").replace("colored", "coloured"))


def apply(species, ioc):
    """Set each bird's IOC name; return the birds the IOC list doesn't have."""
    missing = []
    for s in species:
        old = s.get("was") or s["name"]  # iNaturalist's name, also when this runs a second time
        sci = SAME_BIRD.get(s["sci"], s["sci"])
        if sci not in ioc:
            missing.append(s)
            s["name"] = old
            s.pop("was", None)
            continue
        s["name"] = ioc[sci]
        if plain(old) != plain(s["name"]):
            s["was"] = old
        else:
            s.pop("was", None)
    return missing


def main():
    species = json.loads(DATA.read_text())
    before = {s["id"]: s["name"] for s in species}
    missing = apply(species, ioc_names())
    DATA.write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")))
    renamed = [s for s in species if before[s["id"]] != s["name"]]
    print(f"IOC {IOC_VERSION}: {len(renamed)} names changed, "
          f"{sum('was' in s for s in species)} birds have a former name")
    for s in renamed:
        print(f"  {before[s['id']]} -> {s['name']}")
    if missing:
        print("Not in the IOC list (kept iNaturalist's name; add them to SAME_BIRD):")
        for s in missing:
            print(f"  {s['name']} ({s['sci']})")
        sys.exit(1)


if __name__ == "__main__":
    main()
