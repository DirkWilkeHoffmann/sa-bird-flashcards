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
- Stuck? Tap **Hint**: first guess what kind of bird it is (Lapwing, Weaver…), then which one.
- After each bird you get its level, the countries it's seen in, a short description,
  a range map of Southern Africa, records by month and the photo/recording credits.
- Tap the **⚙ bar** at the top to choose Mixed / Photos / Calls, Easy / Medium / Hard
  and which countries to study.
- **Skip** a bird by swiping the card up (or the Skip button); it isn't scored.
- While guessing with a hint you can **hear the call** or **see the range map** first.
- Level **Beginner** = the 50 most-recorded birds in the place chosen under Where.
- Missed birds, and birds you needed a hint for (a hint always counts as a miss), come back more often.
- Photos you've seen are stored on the phone, so they load instantly next time.
- **Easily confused with** on the info screen: birds people really mix up (from iNaturalist
  identifications), close relatives that share the range, and your own mix-ups. Tap one to
  compare the two side by side. The hints use the same look-alikes.
- **Where** in ⚙ settings: 35 named areas (Cape Town, Kruger, Okavango, Etosha…) or
  **Near me** (birds recorded within about 50 km of you).
- **⚑** on a photo hides it (e.g. a dead bird) on all your devices and emails the owner the photo
  with Keep / Remove buttons (`review.html`). Removed photos disappear for everyone.
- **📊 Progress** (tap the score): each bird is New, Learning or Mastered (right 3 times in a
  row without a hint), by level and by family. Tap a family to study only those birds.
- **Offline**: ⚙ → *Download this set for offline use* saves the chosen study set (1, 3 or all
  photos per bird, optionally a call, range data and Wikipedia text). Without signal the app shows
  only downloaded birds. Delete downloads from the same screen.
- **Sign in with Google** (📊 screen): progress is saved to your account and follows you to any
  device you sign in on. Without an account, a private sync code (same screen) does the same job.

## Data

`scripts/build_data.py` builds `data/species.json` from [iNaturalist](https://www.inaturalist.org):
wild, research-grade records in South Africa, Namibia, Botswana, Zimbabwe, Lesotho, Eswatini
and Mozambique south of the Zambezi.

- Vagrants (fewer than 5 records) and escaped cage birds are left out.
- Levels: the 150 most-recorded birds are Easy, the next 300 Medium, the rest Hard.
- Photos are the best-voted Creative Commons photos taken in the region.

`scripts/build_calls.py` builds `data/calls.json` from [xeno-canto](https://xeno-canto.org)
(quality A/B, preferring Southern African recordings and MP3 files). Calls stream from xeno-canto.

`scripts/build_similar.py` builds `data/similar.json` (look-alikes) and
`scripts/build_areas.py` builds `data/areas.json` and `data/near.json` (named areas, near me).

Photos prefer observations marked "alive" and skip anything marked dead or showing only a
feather, track, bone or nest (`python3 scripts/build_data.py --photos-only` refreshes them).

Flagged photos go to the `photo-review` Edge Function (`supabase/functions/photo-review`),
which stores them in `photo_reviews` and emails the owner through Resend (secret `RESEND_API_KEY`).

Google sign-in uses Supabase Auth (`auth.js`, library pinned in `vendor/`); table `accounts`
links each account to its sync code (row-level security: own row only).

Progress sync uses a Supabase project (tables `progress`, `mixups`, `hidden_photos`, reachable
only through the `sync_pull` / `sync_push` functions; sync codes are stored as SHA-256 hashes).

`scripts/build_info.py` builds `data/info/` (description, range-map cells, records by month)
and `data/map.json` (country outlines).

To rebuild:

    python3 scripts/build_data.py
    XC_API_KEY=your-key python3 scripts/build_calls.py --missing-only
    python3 scripts/build_info.py
    python3 scripts/build_similar.py
    python3 scripts/build_areas.py

## Roadmap

- [x] Sprint 1 — photo flashcards, full species list, installable on iPhone
- [x] Sprint 2 — bird calls from xeno-canto, multiple-choice hints of similar birds
- [x] Sprint 3 — regional photos, carousel and zoom, levels and countries, info screen, photo caching
- [x] Sprint A/B/C — no dead birds, easily confused with, areas and near me, progress and sync
- [x] Offline mode — download a study set and use it without signal
- [x] Flag emails with keep/remove, Google sign-in
