#!/usr/bin/env python3
"""Build data/spread.json: how many map cells (~0.6 degree squares) each bird is recorded in.
The app uses it for "how widespread is the bird" when it works out each area's difficulty groups.

Run after build_data.py (it reads data/near.json):  python3 scripts/build_spread.py
"""
import json
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def main():
    near = json.loads((DATA / "near.json").read_text())
    counts = Counter(i for ids in near["cells"].values() for i in ids)
    spread = {str(near["ids"][i]): n for i, n in counts.items()}
    (DATA / "spread.json").write_text(json.dumps(spread, separators=(",", ":")))
    print(f"wrote spread for {len(spread)} birds")


if __name__ == "__main__":
    main()
