# sa-bird-flashcards

Flashcards for learning the birds of the Southern African subregion (South Africa,
Namibia, Botswana, Zimbabwe, Lesotho, Eswatini and southern Mozambique).

It is a Progressive Web App: no App Store needed.

## Install on iPhone

1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the new "SA Birds" icon — it runs full-screen like an app.

## How it works

- A random bird photo appears. Think of the name, then tap **Reveal**.
- Mark yourself **Got it** or **Missed it**. Missed birds come back more often.
- **Another photo** shows a different picture of the same bird.

## Data

`data/species.json` is built by `scripts/build_data.py` from
[iNaturalist](https://www.inaturalist.org) research-grade observations
(species seen at least twice in the region) and Creative Commons licensed photos.
Each photo shows its photographer and licence.

To rebuild: `python3 scripts/build_data.py`

## Roadmap

- [x] Sprint 1 — photo flashcards, full species list, installable on iPhone
- [ ] Sprint 2 — bird calls from [xeno-canto](https://xeno-canto.org), multiple-choice hints of similar birds
- [ ] Sprint 3 — offline support, progress stats
