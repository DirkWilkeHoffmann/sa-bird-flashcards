# sa-bird-flashcards

Flashcards for learning the birds of the Southern African subregion (South Africa,
Namibia, Botswana, Zimbabwe, Lesotho, Eswatini and southern Mozambique).

It is a Progressive Web App: no App Store needed.

## Install on iPhone

1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the new "SA Birds" icon — it runs full-screen like an app.

## How it works

- A random bird photo or call appears. Swipe sideways through all its photos; pinch or double-tap to zoom.
- Think of the name, then tap **Reveal** and mark yourself **Got it** or **Missed it**.
- Stuck? Tap **Hint** for four look-alike birds (same genus, then family) and pick one.
- After each bird you get its level, the countries it's seen in, a short description,
  a range map of Southern Africa, records by month and the photo/recording credits.
- Tap the **⚙ bar** at the top to choose Mixed / Photos / Calls, Easy / Medium / Hard
  and which countries to study.
- Missed birds, and birds you needed a hint for, come back more often.
- Photos you've seen are stored on the phone, so they load instantly next time.

## Data

`scripts/build_data.py` builds `data/species.json` from [iNaturalist](https://www.inaturalist.org):
wild, research-grade records in South Africa, Namibia, Botswana, Zimbabwe, Lesotho, Eswatini
and Mozambique south of the Zambezi.

- Vagrants (fewer than 5 records) and escaped cage birds are left out.
- Levels: the 150 most-recorded birds are Easy, the next 300 Medium, the rest Hard.
- Photos are the best-voted Creative Commons photos taken in the region.

`scripts/build_calls.py` builds `data/calls.json` from [xeno-canto](https://xeno-canto.org)
(quality A/B, preferring Southern African recordings and MP3 files). Calls stream from xeno-canto.

`scripts/build_info.py` builds `data/info/` (description, range-map cells, records by month)
and `data/map.json` (country outlines).

To rebuild:

    python3 scripts/build_data.py
    XC_API_KEY=your-key python3 scripts/build_calls.py --missing-only
    python3 scripts/build_info.py

## Roadmap

- [x] Sprint 1 — photo flashcards, full species list, installable on iPhone
- [x] Sprint 2 — bird calls from xeno-canto, multiple-choice hints of similar birds
- [x] Sprint 3 — regional photos, carousel and zoom, levels and countries, info screen, photo caching
- [ ] Next — progress screen, full offline mode
