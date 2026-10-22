"""Build data/tips.json: how to tell lookalike birds apart.

Two kinds of tips per pair (key "smallerId-largerId"):
  tips  field marks (size, bill, eye, plumage, call, habitat), drafted by hand/AI and
        reviewed in the app before they count as checked
  auto  range and season differences, worked out here from each bird's records
        (data/info/<id>.json: map cells and records per month)

Usage: python3 scripts/build_tips.py data/tips-drafts.json
Each draft file is {"<key>": {"tips": [...], "confidence": "high|medium|low"}}.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

WINTER = [4, 5, 6, 7]          # May–Aug (0-based months)
MIN_RECORDS = 40               # need this many records before saying anything about season
SUMMER_SHARE = 0.08            # under 8% of records in May–Aug = summer visitor
MIN_CELLS = 8                  # need this many map cells before comparing ranges
RARELY_MEET = 0.2              # under 20% of the smaller range shared = they rarely meet


def info(sid):
    try:
        return json.loads((DATA / "info" / f"{sid}.json").read_text())
    except FileNotFoundError:
        return None


def season_tip(a, b, ia, ib):
    def summer(i):
        m = i and i.get("months")
        if not m or sum(m) < MIN_RECORDS:
            return None
        return sum(m[k] for k in WINTER) / sum(m) < SUMMER_SHARE
    sa, sb = summer(ia), summer(ib)
    if sa is None or sb is None or sa == sb:
        return None
    visitor, resident = (a, b) if sa else (b, a)
    return f"Season: {visitor} is a summer visitor (mostly Oct–Mar); {resident} is here all year."


def range_tip(a, b, ia, ib):
    if not ia or not ib:
        return None
    ca = {(c[0], c[1]) for c in ia.get("cells", [])}
    cb = {(c[0], c[1]) for c in ib.get("cells", [])}
    if len(ca) < MIN_CELLS or len(cb) < MIN_CELLS:
        return None
    shared = len(ca & cb) / min(len(ca), len(cb))
    if shared >= RARELY_MEET:
        return None
    mid = lambda cells: (sum(c[0] for c in cells) / len(cells), sum(c[1] for c in cells) / len(cells))
    (la, ga), (lb, gb) = mid(ca), mid(cb)
    if abs(ga - gb) >= abs(la - lb):
        da, db = ("west", "east") if ga < gb else ("east", "west")
    else:  # southern hemisphere: a smaller (more negative) latitude is further south
        da, db = ("south", "north") if la < lb else ("north", "south")
    return f"Range: they rarely meet. {a} is mostly further {da}, {b} further {db} (see the range maps)."


def main(paths):
    species = {s["id"]: s for s in json.loads((DATA / "species.json").read_text())}
    drafts = {}
    for p in paths:
        drafts.update(json.loads(Path(p).read_text()))
    out = {}
    for key, d in sorted(drafts.items()):
        a_id, b_id = map(int, key.split("-"))
        a, b = species[a_id], species[b_id]
        ia, ib = info(a_id), info(b_id)
        auto = [t for t in (range_tip(a["name"], b["name"], ia, ib), season_tip(a["name"], b["name"], ia, ib)) if t]
        out[key] = {"tips": d.get("tips", []), "auto": auto, "confidence": d.get("confidence", "medium")}
    (DATA / "tips.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    n_auto = sum(1 for v in out.values() if v["auto"])
    print(f"{len(out)} pairs, {sum(len(v['tips']) for v in out.values())} field-mark tips, "
          f"{n_auto} pairs with range/season tips")


if __name__ == "__main__":
    main(sys.argv[1:])
