#!/usr/bin/env python3
"""Build data/wiki/<id>.json: the useful parts of each bird's English Wikipedia article
(intro, description, distribution and habitat, behaviour, diet, breeding, voice).

Run after build_data.py:  python3 scripts/build_wiki.py [--missing-only]
Text is from Wikipedia under CC BY-SA 4.0; the app links back to each article.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://en.wikipedia.org/w/api.php"
DATA = Path(__file__).resolve().parent.parent / "data"
UA = "sa-bird-flashcards/0.4 (https://github.com/DirkWilkeHoffmann/sa-bird-flashcards)"
INTRO_CHARS, SECTION_CHARS = 700, 900
# Our heading -> words that identify the matching Wikipedia section
SECTIONS = [
    ("Description", ("description", "identification", "appearance", "plumage")),
    ("Distribution & habitat", ("distribution", "habitat", "range")),
    ("Behaviour", ("behaviour", "behavior", "ecology")),
    ("Diet", ("diet", "feeding", "food")),
    ("Breeding", ("breeding", "nesting", "reproduction")),
    ("Voice", ("voice", "call", "vocal")),
]


def article(title):
    params = {"action": "query", "format": "json", "redirects": 1, "prop": "extracts",
              "explaintext": 1, "exsectionformat": "wiki", "titles": title}
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}", headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                pages = json.load(r)["query"]["pages"]
            time.sleep(2)  # Wikipedia rate-limits shared connections; go gently
            page = next(iter(pages.values()))
            return (page["title"], page.get("extract", "")) if "missing" not in page else (None, "")
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 0) or 10 * 2 ** attempt
            print(f"  retry {attempt + 1} for {title} in {wait}s: {e}")
            time.sleep(wait)
        except Exception as e:
            print(f"  retry {attempt + 1} for {title}: {e}")
            time.sleep(10 * 2 ** attempt)
    raise RuntimeError(f"Wikipedia kept refusing {title}; rerun later with --missing-only")


def trim(text, limit):
    """Cut at the last full sentence before `limit` characters."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > limit // 3 else cut.rsplit(" ", 1)[0] + "…"


def split_sections(extract):
    """Return (intro, [(heading, text)]) using the top-level '== Heading ==' markers."""
    parts = re.split(r"\n==\s*([^=\n]+?)\s*==\n", "\n" + extract)
    intro = parts[0]
    sections = []
    for heading, body in zip(parts[1::2], parts[2::2]):
        body = re.sub(r"\n=+\s*[^=\n]+?\s*=+\n", "\n", body)  # drop sub-headings, keep their text
        sections.append((heading, body))
    return intro, sections


def wiki_for(s):
    title = urllib.parse.unquote((s.get("wiki") or "").rsplit("/wiki/", 1)[-1]).replace("_", " ")
    found, text = article(title) if title else (None, "")
    if not text:
        found, text = article(s["name"])
    if not text:
        return None
    intro, sections = split_sections(text)
    out, used = [], set()
    for ours, words in SECTIONS:
        for heading, body in sections:
            h = heading.lower()
            if heading not in used and any(w in h for w in words) and body.strip():
                out.append({"h": ours, "text": trim(body, SECTION_CHARS)})
                used.add(heading)
                break
    return {
        "title": found,
        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(found.replace(" ", "_")),
        "intro": trim(intro, INTRO_CHARS),
        "sections": out,
    }


def main():
    out = DATA / "wiki"
    out.mkdir(exist_ok=True)
    species = json.loads((DATA / "species.json").read_text())
    missing = []
    for n, s in enumerate(species, 1):
        f = out / f"{s['id']}.json"
        if "--missing-only" in sys.argv and f.exists():
            continue
        w = wiki_for(s)
        if w:
            f.write_text(json.dumps(w, ensure_ascii=False, separators=(",", ":")))
        else:
            missing.append(s["name"])
        if n % 100 == 0:
            print(f"{n}/{len(species)}")
    print(f"no Wikipedia article for {len(missing)}: {', '.join(missing)}")


if __name__ == "__main__":
    main()
