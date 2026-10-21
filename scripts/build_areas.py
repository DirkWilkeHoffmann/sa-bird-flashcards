#!/usr/bin/env python3
"""Build data/areas.json: well-known regions and birding areas, each with the birds
recorded there (wild, research-grade, at least MIN_RECORDS records inside the area box).

Run after build_data.py:  python3 scripts/build_areas.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import get  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
MIN_RECORDS = 2

# (id, name, country, (south, west, north, east))
AREAS = [
    ("cape-town", "Cape Town & Peninsula", "ZA", (-34.40, 18.30, -33.70, 18.95)),
    ("west-coast", "West Coast", "ZA", (-33.40, 17.80, -32.00, 18.60)),
    ("winelands-overberg", "Winelands & Overberg", "ZA", (-34.85, 18.85, -33.60, 20.60)),
    ("garden-route", "Garden Route", "ZA", (-34.20, 21.80, -33.70, 23.80)),
    ("little-karoo", "Little Karoo", "ZA", (-33.80, 20.60, -33.20, 23.00)),
    ("great-karoo", "Great Karoo", "ZA", (-33.20, 20.50, -31.00, 25.00)),
    ("namaqualand", "Namaqualand", "ZA", (-31.50, 17.00, -29.00, 19.00)),
    ("ec-coast", "Eastern Cape coast (Gqeberha–East London)", "ZA", (-34.10, 25.30, -32.60, 28.50)),
    ("wild-coast", "Wild Coast", "ZA", (-32.60, 28.00, -30.80, 30.20)),
    ("durban", "Durban & KZN coast", "ZA", (-30.80, 30.10, -29.00, 31.40)),
    ("zululand", "Zululand & iSimangaliso", "ZA", (-28.90, 31.20, -26.85, 32.95)),
    ("kzn-midlands", "KZN Midlands", "ZA", (-29.90, 29.60, -29.00, 30.60)),
    ("drakensberg", "Drakensberg", "ZA", (-29.90, 28.70, -28.50, 29.80)),
    ("free-state", "Free State", "ZA", (-30.50, 24.50, -27.00, 29.50)),
    ("gauteng", "Gauteng (Johannesburg & Pretoria)", "ZA", (-26.60, 27.60, -25.40, 28.60)),
    ("magaliesberg", "Magaliesberg & Pilanesberg", "ZA", (-25.90, 26.80, -25.10, 27.90)),
    ("kruger", "Kruger National Park", "ZA", (-25.55, 30.90, -22.30, 32.05)),
    ("lowveld", "Lowveld & Mpumalanga escarpment", "ZA", (-25.60, 30.00, -24.00, 31.00)),
    ("limpopo", "Limpopo (Polokwane & Magoebaskloof)", "ZA", (-24.20, 28.80, -22.80, 30.60)),
    ("kgalagadi", "Kgalagadi & Kalahari", "ZA", (-27.00, 19.80, -24.00, 22.00)),
    ("upington", "Upington & Augrabies", "ZA", (-29.20, 19.80, -28.00, 22.50)),
    ("windhoek", "Windhoek & central Namibia", "NA", (-23.00, 16.50, -22.00, 17.70)),
    ("etosha", "Etosha", "NA", (-19.50, 14.30, -18.40, 17.20)),
    ("namib-coast", "Walvis Bay & Swakopmund", "NA", (-23.20, 14.30, -22.40, 14.80)),
    ("zambezi-region", "Zambezi Region (Caprivi)", "NA", (-18.50, 21.00, -17.40, 25.30)),
    ("okavango", "Okavango Delta", "BW", (-20.40, 22.00, -18.50, 23.90)),
    ("chobe", "Chobe", "BW", (-18.80, 24.00, -17.70, 25.30)),
    ("central-kalahari", "Central Kalahari", "BW", (-23.00, 23.00, -21.00, 25.50)),
    ("vic-falls-hwange", "Victoria Falls & Hwange", "ZW", (-19.60, 25.70, -17.80, 27.00)),
    ("harare", "Harare", "ZW", (-18.10, 30.80, -17.60, 31.30)),
    ("eastern-highlands", "Eastern Highlands", "ZW", (-20.40, 32.40, -18.20, 33.10)),
    ("matobo", "Bulawayo & Matobo", "ZW", (-20.80, 28.20, -20.00, 28.90)),
    ("maputo", "Maputo & southern Mozambique", "MZ", (-26.90, 32.20, -25.50, 33.10)),
    ("inhambane", "Inhambane coast", "MZ", (-24.50, 34.50, -21.50, 35.60)),
    ("gorongosa", "Gorongosa", "MZ", (-19.20, 34.00, -18.40, 34.80)),
]


def main():
    ids = {s["id"] for s in json.loads((DATA / "species.json").read_text())}
    areas, birds = [], {}
    for area_id, name, country, (south, west, north, east) in AREAS:
        found, page = [], 1
        while True:
            d = get("observations/species_counts", taxon_id=3, quality_grade="research", captive="false",
                    rank="species", swlat=south, swlng=west, nelat=north, nelng=east, per_page=500, page=page)
            found += [r["taxon"]["id"] for r in d["results"] if r["count"] >= MIN_RECORDS and r["taxon"]["id"] in ids]
            if page * 500 >= d["total_results"]:
                break
            page += 1
        areas.append({"id": area_id, "name": name, "country": country,
                      "center": [round((south + north) / 2, 2), round((west + east) / 2, 2)]})
        birds[area_id] = sorted(found)
        print(f"{name}: {len(found)} birds")
    (DATA / "areas.json").write_text(json.dumps({"areas": areas, "birds": birds}, separators=(",", ":")))
    print(f"wrote {len(areas)} areas")


if __name__ == "__main__":
    main()
