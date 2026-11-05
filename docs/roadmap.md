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

**Fixed on Dev (2 Nov): signing in could wipe an account's progress.** The walkthrough marks a
new phone's start as a "reset". If that player tapped Not now and signed in later, the newer reset
beat the account and the phone's few birds replaced the account's (Dirk's Dev account went from its
full record to 45 birds on 30 Oct). Now joining an account (sign-in or another phone's sync code)
combines both, keeping the further-along copy of each bird, and the phone's walkthrough start never
goes to the account. Any bird the account has right/wrong answers for but the progression lost is
rebuilt on the next sync, which restores wiped accounts. Main never had this code.

**Ready for 500+ players (2 Nov):**
- **Sync** at most once a minute while playing, straight away on leaving the app, and on return
  after 2 minutes, instead of after every answer. Keeps Supabase's data downloads within the free
  5 GB a month (would have been ~10 GB with 500 players).
- **Walkthrough:** only real Chrome counts as Chrome on Android (Opera, Xiaomi, Huawei, Brave… get
  Open in Chrome); WhatsApp/Gmail built-in browser hints on iPhone and Android; Google sign-in
  inside in-app browsers explains to open Chrome or Safari (Google blocks it there).
- **Usage-event clean-up (applied 2 Nov):** `supabase/migrations/20261102_events_cleanup.sql` runs
  nightly at 01:17 UTC, keeps 100 days of usage events and folds older ones into daily totals
  (`events_daily`). The dashboard's 90-day view is unaffected.
- Capacity checked: database 14 MB of 500 MB, ~1 KB per player's progression record, sign-ins and
  Google OAuth have no limit that 500 players reach. No backups on the free plan (Dirk: stay free
  for now).

**Also on Dev (2 Nov):**
- **Daily goal and streak** (`streak.js`): 10 Right answers a day (no hint), a celebration when it's
  reached, and a streak that starts again after a missed day. The progress screen opens with the
  streak and this week, Monday to Sunday (goal days filled, played days ringed, ★ with the number of
  birds mastered); arrows or a sideways swipe go back a week. Kept deliberately simple and encouraging. Days sync with the
  learner profile.
- **Faster first photo:** a blurred small preview at once; the photo on screen loads first, the
  rest after; the call list no longer delays the first card. Slow mobile: ~3–4 s instead of 3–8 s.
- **Android icon:** a maskable version, so the Hoopoe fills the round icon.
- **Android install goes through Chrome:** in the walkthrough, every Android browser except Chrome
  (Samsung Internet, Firefox, Edge, WhatsApp/Facebook in-app) shows "Open in Chrome" first (an
  intent link), then Chrome's steps. Tested with a friend's phone: Chrome is the easiest way.
- **Usage events:** the database list now accepts the progression, bird-list and walkthrough events
  (`supabase/migrations/20261102_log_events_allow_list.sql`). They were being dropped before, so the
  admin page had nothing for them until now. **Every new `logEvent` type must be added there.**

## Tester feedback from the release (5 Nov 2026), to implement on Dev
Ten comments so far, mostly positive (photos showing habitat praised; a birding group in Groot Brak
uses it with beginners and old hands). Main points, most-asked first:

1. **Hear the call before the reveal** (asked by 3, Dirk agrees). A ▶ call button on the guessing
   screen, not only on the answer screen. Calls were taken out of the guessing on purpose (see
   progression), so make it an optional button that doesn't count as a hint.
2. **Wrong calls** (2 testers). Reported: Red-eyed Dove, Black-headed Oriole, Cape Wagtail. Check
   these in `data/calls.json`, and add a "flag this call" option (like the photo flags) so players
   can report others.
3. **Call-first mode.** A mode where the call plays first and you guess, then see the photo.
   Builds on 1.
4. **Practise lookalikes, not just repeats.** After a mistake, bring in the birds it's confused
   with (the "Easily confused with" pairs) and birds from the same family, so the player learns to
   tell them apart. Fits the weights in `learn.js`.
5. **Bigger photos in Common mix-ups.** The other birds' pictures are too small on a phone; tap to
   enlarge, or show them full width.
6. **Filter by habitat**, like the area filter (e.g. water birds, forest, grassland).
7. **Search for a bird** by name (English and Afrikaans) to look up its info straight away.
8. **"Birds near me" didn't work** for one tester (had to pick South Africa). Find out why:
   location permission denied, slow GPS or an in-app browser; show a clear message and fall back to
   choosing an area.
9. **Play Store** (asked once). Same wrapping work as the App Store (Bigger next steps 9); Google's
   is $25 once and a Trusted Web Activity is enough.

Question to answer, not build: *are the photos open-source from the internet?* (Peter Thorpe)
They are Creative Commons-licensed photos from iNaturalist research-grade records, credited to
each photographer; calls are from xeno-canto.

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
- **Every time the app is opened in a phone's browser** (or come back to after 30+ minutes), the
  "add to home screen" step shows again, for new and existing players. "Continue in the browser
  instead" closes it for now; **Skip** (once, on any step) means never again.
- **On the home screen** (or a computer): welcome, how well you know birds, **Which birds do you want
  to learn?** (📍 Birds around me, or a place you choose), then Google sign-in. On iPhone the
  home-screen app doesn't share the browser's data, so this is where a new player really starts;
  signing in brings back progress made anywhere else.
- The level sets the first session's momentum, the L target and the first birds (`onboard.js`,
  `Learn.setup`); plan: [plan-first-time-walkthrough.md](plan-first-time-walkthrough.md).
- **Per phone and browser:** the install steps match iPhone Safari, Chrome, Firefox and Edge, and
  Android Chrome, Samsung Internet, Firefox and Edge. Inside another app's browser (Instagram,
  Facebook, the Google app, WhatsApp on Android) it first says how to open the page in the real
  browser. The `onboard` event records which one.
- **Dev:** "▶ Walkthrough" and "▶ Walkthrough as in a phone's browser" under the Dev line; add
  `?browser=ios-chrome` (or android-samsung, ios-inapp, …) to the Dev address to see another set.

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
10. **Tester feedback.** First round collected (5 Nov), see "Tester feedback from the release" above.
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
