# SA Birds roadmap

*Last updated: 30 October 2026.* Live app: <https://dirkwilkehoffmann.github.io/sa-bird-flashcards/>
(main). Test builds: `/dev/` (dev branch) and `/tips/` (tips branch).

## Done on Dev, waiting to go to main
**Dirk Progression: closed 30 Oct 2026.** Dirk is happy with it; no more progression work planned.
- Spec: [dirk-progression-spec.md](dirk-progression-spec.md) (Dirk's notes and his answers) and
  [dirk-progression-coding-spec.md](dirk-progression-coding-spec.md) (how it's built). Earlier ideas
  are in [archive/](archive/roadmap-progression-oct-2026.md).
- What's in it: per-bird weights and momentum (`learn.js`, checked by `node scripts/test-learn.mjs`);
  one area at a time shown above the photos; Beginner → Easy → Medium → Hard worked out per area;
  new birds 2–5 at a time; learning group 15 / 25 / 40; photos only while guessing (calls still on
  the answer screen); Dev shows the numbers.
- Weights, pool and area sync to the account (`supabase/migrations/20261029_learner_profiles.sql`,
  applied 29 Oct).

**Sign-in reminders** with each new batch ("5 new birds added! Sign in to keep them") and once a day
on opening ("Welcome back! Sign in to save your 8 mastered birds"). Sign-ins record which reminder
led to them.

**To do: merge `dev` into `main`** once Dirk has finished testing. All database changes are
applied (`20261029_learner_profiles.sql`, `20261030_admin_dirk_progression.sql`, both 30 Oct).

Also on Dev (30 Oct): the admin page reads the new events (hint answers, new birds, mastered,
area, family, bird lists); English/Afrikaans order and birds hidden for a day sync to the account;
the edge line above Got it / Next updates when the answer's text finishes loading.

## Pinned features

### 1. How to tell lookalikes apart (built, waiting for review)
- **Where:** `tips` branch, published at `/tips/`. Plan: [plan-lookalike-tips.md](plan-lookalike-tips.md).
- **What's there:**
  - 709 Beginner/Easy lookalike pairs with 2,261 drafted field-mark tips.
  - Automatic range and season tips for 96 pairs.
  - Shown under "Easily confused with" and in Compare.
  - Tips are marked **Draft** until checked. Holders of the review key get ✓ / ✗ buttons; decisions
    are stored in Supabase (`tip_reviews`), and tips marked wrong are hidden from players.
- **To go live:**
  1. Dirk reviews the tips with the private review link (kept out of this file). Start with the
     5 low-confidence pairs:
     - Tawny-flanked vs Red-winged Prinia
     - Angola Cave-Chat vs Familiar Chat
     - Southern Double-collared vs Eastern Miombo Sunbird
     - Speckle-throated vs Cardinal Woodpecker
     - Large vs Red-throated Rock Martin

     Then the 129 medium-confidence pairs (mostly raptors and pipits).
  2. Merge `tips` into `dev`. It was branched before both progression changes, so expect conflicts
     in `app.js`, `index.html` and `styles.css`: keep Dev's versions (one area, no levels) and only
     bring over the tips.
  3. Test on Dev, then merge to main.
- **Later:**
  - Tips for the remaining ~900 Medium/Hard pairs.
  - A "Hear the difference" button that plays both calls.
  - Right after a mix-up, show the tip for that exact pair.
  - A "Suggest a tip" option for players.

### 2. See the list of mastered birds (built on Dev, 30 Oct)
On the progress screen (📊), tapping **Mastered**, **Learning** or **To be seen** opens the area's
birds in three sections (Mastered, then Learning, then To be seen), sorted by family with a small
heading per family, and scrolled to the section tapped. Below them, **Other areas** lists the
birds that don't live in this area, in the same three sections. Tapping a group or family row opens
the same list for just those birds (a family also lists its birds from other areas). Tapping a bird
opens it on its own, like one side of Compare. Mastered includes every bird at weight 4–7. Every
sheet keeps its title and ✕ at the top; dragging the title bar down closes it.

### 3. Study one family (built on Dev, 30 Oct)
**Study only these birds** at the top of a family's list studies that
family across **all areas**: all its birds join the pool at once and are the learning group; the
weights, momentum and picking work as normal. The line above the photos shows "Cuckoos · all
areas". *Stop: back to …* (on the list or the progress screen) goes back to the area; in ⚙ (area
only, no family list) a note says which family is being studied, and picking an area or *go back to
the area* stops it.
- When every bird in the area or family is mastered: "Well done! All birds in this section are
  mastered. Select a new area or family in settings", with a Settings button (also for areas).

### 4. First-time walkthrough (built on Dev, reworked 30 Oct)
- **In a phone's browser:** welcome, then **Add SA Birds to your home screen**: step-by-step for
  iPhone Safari (••• / Share → Add to Home Screen), Android's own install button when Chrome offers
  it, or its ⋮ menu otherwise. "Continue in the browser instead" carries on there.
- **On the home screen** (or a computer): welcome, how well you know birds, **Which birds do you want
  to learn?** (📍 Birds around me, or a place you choose), then Google sign-in. On iPhone the
  home-screen app doesn't share the browser's data, so this is where a new player really starts;
  signing in brings back progress made anywhere else.
- The level sets the first session's momentum, the L target and the first birds (`onboard.js`,
  `Learn.setup`); plan: [plan-first-time-walkthrough.md](plan-first-time-walkthrough.md).
- **Dev:** "▶ Walkthrough" and "▶ Walkthrough as in a phone's browser" under the Dev line.

## Open questions on recent work
7. **Afrikaans names (live).** 840 of 852 birds have one (mostly from Afrikaans Wikipedia).
   Still missing: 12 rare Hard birds (Sooty Gull, Black Skimmer, Saunders's Tern, Upland Sandpiper,
   Upcher's Warbler, Red-throated Rock Martin, Red-tailed Shrike, White Wagtail, Rufous-tailed
   Scrub-Robin, Angola Cave-Chat, Wood Warbler, Lesser Whitethroat). The "Which Weaver?" hint step
   stays in English, because Afrikaans names don't share a group word.

### Reviewed 26 Oct 2026, kept as they are for now
Full write-up: the "SA Birds Progression Review" page (flow charts of every rule).
- **Usage-count clean-up:** events grow ~5 MB a day at ~250 active players, and the free
  database holds 500 MB. Add a nightly job keeping 90 days before about 3 months after launch.

## Checks only Dirk can do
8. **Supabase redirect for Dev.** Is `https://dirkwilkehoffmann.github.io/sa-bird-flashcards/dev/`
   in Supabase → Authentication → URL Configuration → Redirect URLs? (Needed for Google sign-in
   on Dev.)

## Bigger next steps
9. **App Store.**
   - Wrap the web app as a native app (e.g. Capacitor), which needs a $99/year Apple Developer
     account and Apple review.
   - Apple rejects apps that are "just a website", so offline mode, haptics and sign-in help.
   - Needs: app name, icon set, screenshots, privacy policy (done: `privacy.html`), support email.
10. **Tester feedback.** Collect and plan the next sprint from it.
11. **Smaller ideas:**
    - Calls for birds that are only available offline because their photos were kept.
    - A higher daily limit than 20 flag emails if testers flag a lot.
12. **Name and logo.** Done for now: name kept, Hoopoe logo (see below).

## Name and logo
- **Name:** stays "SA Birds" (home screen) / "SA Bird Flashcards" (full name).
- **Logo:** African Hoopoe (crest of black-tipped feathers, barred wings, curved bill), large, on a white
  background (mockup B, chosen for standing out on home screens). Source: `icons/logo.svg`. The PNGs are rendered from it, and Dev/Tips get a
  red/blue band. The Tips icons still need updating on the `tips` branch.
- **iPhones keep the old home-screen icon:** remove the app from the home screen and add it again
  to see the new one. The icon links carry `?v=3` so new installs get it straight away.
- If the name ever changes, update:
  - `index.html` (title, `apple-mobile-web-app-title`) and the header text
  - `manifest.webmanifest`
  - `privacy.html`
  - Google Cloud → Branding → App name
  - the publishing workflow's renaming step
