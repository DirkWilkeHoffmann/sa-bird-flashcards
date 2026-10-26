# SA Birds roadmap

*Last updated: 22 October 2026.* Live app: <https://dirkwilkehoffmann.github.io/sa-bird-flashcards/>
(main). Test builds: `/dev/` (dev branch) and `/tips/` (tips branch).

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
  2. Merge `tips` into `dev`. It was branched before the progression change, so the old
     "Learning path" chip disappears in the merge.
  3. Test on Dev, then merge to main.
- **Later:**
  - Tips for the remaining ~900 Medium/Hard pairs.
  - A "Hear the difference" button that plays both calls.
  - Right after a mix-up, show the tip for that exact pair.
  - A "Suggest a tip" option for players.

### 2. Study a level or family from the progress screen (removed for now)
- Tapping a row used to switch the study set. It was taken out because it made the app harder to
  navigate ([later.md](later.md)).
- If it returns: a clearly separate "Practise these" action that is easy to leave.

## Open questions on recent work
3. **Batch size later on.** Batches grow by 5 each time (20, 25, 35, 50, 70, 95, …), so deep into
   Medium/Hard they reach 60–85 birds at once. Consider capping a batch at ~25–30.
4. **Unticking an auto-added level.** At the moment the next answer that passes the 40% mark ticks it
   again. The alternative is to keep it off once the player turns it off.
5. **Studying a family.** It shows the whole family at once (no gradual growth). Should it grow
   like the levels?
6. **Small display glitch.** The thin line above the Got it / Next buttons, and the bird's name in the
   header, are set when you scroll. If the text finishes loading after you've scrolled to the end,
   the line can stay until you scroll again. Fix: also update when the content finishes loading.

7. **Afrikaans names (on Dev).** 840 of 852 birds have one (mostly from Afrikaans Wikipedia).
   Still missing: 12 rare Hard birds (Sooty Gull, Black Skimmer, Saunders's Tern, Upland Sandpiper,
   Upcher's Warbler, Red-throated Rock Martin, Red-tailed Shrike, White Wagtail, Rufous-tailed
   Scrub-Robin, Angola Cave-Chat, Wood Warbler, Lesser Whitethroat). The "Which Weaver?" hint step
   stays in English, because Afrikaans names don't share a group word.

### Reviewed 26 Oct 2026, kept as they are for now
Full write-up: the "SA Birds Progression Review" page (flow charts of every rule).
- **Areas outside SA with "South Africa" ticked** hide the birds not also found in SA
  (e.g. Etosha 266 of 278, Victoria Falls & Hwange 319 of 333). Fix if needed: a named area
  ignores the country ticks.
- **Switching area keeps the number of birds in play** (e.g. 95 in Gauteng gives 95 in Cape Town
  at once). Option: progress per area too.
- **Batch size later on** (item 3) and **unticking an auto-added level** (item 4): unchanged.
- **Usage-count clean-up:** events grow ~5 MB a day at ~250 active players, and the free
  database holds 500 MB. Add a nightly job keeping 90 days before about 3 months after launch.

## Checks only Dirk can do
7. **Dark mode status bar.** Do the clock and battery look right in dark mode on the iPhone?
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
