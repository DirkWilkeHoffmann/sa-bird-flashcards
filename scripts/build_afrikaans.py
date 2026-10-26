#!/usr/bin/env python3
"""Add each bird's Afrikaans name to data/species.json (field "af").

Run after build_data.py:  python3 scripts/build_afrikaans.py
Sources, in order of preference:
  1. the title of the bird's Afrikaans Wikipedia article (usually the current Roberts name),
  2. iNaturalist's Afrikaans common names (the first one listed),
  3. a short hand-made list for birds neither source names.
Names are written in sentence case, as Afrikaans bird names are ("Kaapse wewer").
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "species.json"
UA = "sa-bird-flashcards/0.4 (https://github.com/DirkWilkeHoffmann/sa-bird-flashcards)"
# Birds with no Afrikaans name on either site (scientific name -> Roberts name).
MANUAL = {
    "Buteo auguralis": "Rooinekjakkalsvoël",
    "Pernis ptilorhynchus": "Oosterse wespedief",
    "Anarhynchus atrifrons": "Mongoolse strandkiewiet",
    "Leucophaeus atricilla": "Lagmeeu",
    "Calidris acuminata": "Spitsstertstrandloper",
    "Guttera edouardi": "Kuifkoptarentaal",
    "Zapornia parva": "Kleinriethaan",
    "Crithagra totta": "Kaapse pietjiekanarie",
    "Turdoides melanops": "Swartwangkatlagter",
    "Telophorus viridis": "Konkoit",
    "Saxicola rubetra": "Europese bontrokkie",
    "Tychaedon quadrivirgata": "Baardwipstert",
    "Tychaedon signata": "Bruinwipstert",
    "Salpornis salvadori": "Boomkruiper",
    "Ardea brachyrhyncha": "Geelbekwitreier",
    "Butorides atricapilla": "Groenrugreier",
    "Calonectris borealis": "Geelbekpylstormvoël",
    "Phalacrocorax carbo": "Witborsduiker",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(20 * (attempt + 1))  # Wikipedia rate-limits shared connections
        except urllib.error.URLError:
            time.sleep(10 * (attempt + 1))
    sys.exit(f"Gave up on {url}")


def inat_names(ids):
    """iNaturalist taxon id -> its valid Afrikaans names, in iNaturalist's order."""
    out = {}
    for i in range(0, len(ids), 30):
        chunk = ids[i:i + 30]
        url = f"https://api.inaturalist.org/v1/taxa/{','.join(map(str, chunk))}?all_names=true&per_page=30"
        for t in get(url)["results"]:
            names = [n for n in t.get("names", [])
                     if (n.get("lexicon") or "").lower() == "afrikaans" and n.get("is_valid") is not False]
            out[t["id"]] = [n["name"] for n in sorted(names, key=lambda n: n.get("position", 0))]
        time.sleep(1.2)
    return out


def wiki_titles(sci_names):
    """Scientific name -> title of the Afrikaans Wikipedia article linked from English Wikipedia."""
    out = {}
    for i in range(0, len(sci_names), 50):
        chunk = sci_names[i:i + 50]
        params = {"action": "query", "format": "json", "redirects": 1, "prop": "langlinks",
                  "lllang": "af", "lllimit": "max", "titles": "|".join(chunk)}
        q = get(f"https://en.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}")["query"]
        back = {}
        for r in q.get("normalized", []) + q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for page in q["pages"].values():
            for link in page.get("langlinks", []):
                out[back.get(page["title"], page["title"])] = link["*"]
        print(f"  Wikipedia: {i + len(chunk)} of {len(sci_names)}", flush=True)
        time.sleep(5)
    return out


def tidy(name):
    name = re.sub(r"\s*\(.*?\)", "", name).strip()   # "Kelkiewyn (voël)" -> "Kelkiewyn"
    words = name.split(" ")
    return " ".join([words[0][:1].upper() + words[0][1:]] + [w.lower() for w in words[1:]])


def main():
    species = json.loads(DATA.read_text())
    inat = inat_names([s["id"] for s in species])
    wiki = wiki_titles([s["sci"] for s in species])
    counts = {"wikipedia": 0, "inaturalist": 0, "manual": 0, "none": 0}
    for s in species:
        if s["sci"] in wiki:
            name, src = wiki[s["sci"]], "wikipedia"
        elif inat.get(s["id"]):
            name, src = inat[s["id"]][0], "inaturalist"
        elif s["sci"] in MANUAL:
            name, src = MANUAL[s["sci"]], "manual"
        else:
            name, src = None, "none"
        counts[src] += 1
        if name:
            s["af"] = tidy(name)
        else:
            s.pop("af", None)
    DATA.write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")))
    print(counts)
    print("Still without an Afrikaans name:", ", ".join(s["name"] for s in species if "af" not in s))


if __name__ == "__main__":
    main()
