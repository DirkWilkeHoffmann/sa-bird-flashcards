# sa-bird-flashcards

Flashcards for learning the birds of the Southern African subregion (South Africa,
Namibia, Botswana, Zimbabwe, Lesotho, Eswatini and southern Mozambique).

It is a Progressive Web App: no App Store needed.

## Install on iPhone

1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the new "SA Birds" icon — it runs full-screen like an app.

## How it works

- A random bird photo or call appears (switch between **Mixed**, **Photos** and **Calls** at the top).
- Think of the name, then tap **Reveal** and mark yourself **Got it** or **Missed it**.
- Stuck? Tap **Hint** for four look-alike birds (same genus, then family) and pick one.
- Missed birds, and birds you needed a hint for, come back more often.
- **Another photo / Another recording** shows a different example of the same bird.

## Data

`data/species.json` is built by `scripts/build_data.py` from
[iNaturalist](https://www.inaturalist.org) research-grade observations
(species seen at least twice in the region) and Creative Commons licensed photos.

`data/calls.json` is built by `scripts/build_calls.py` from
[xeno-canto](https://xeno-canto.org) recordings (quality A/B, preferring
Southern African recordings and compressed MP3 files). Calls stream from xeno-canto.

Every photo and recording shows its author and licence.

To rebuild:

    python3 scripts/build_data.py
    XC_API_KEY=your-key python3 scripts/build_calls.py   # add --missing-only to retry gaps

## Roadmap

- [x] Sprint 1 — photo flashcards, full species list, installable on iPhone
- [x] Sprint 2 — bird calls from xeno-canto, multiple-choice hints of similar birds
- [ ] Sprint 3 — offline support, progress stats
