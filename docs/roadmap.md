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
12. **Name and logo.** In progress (see below).

## Name and logo (in progress)
- **Current:** "SA Birds" (home screen) / "SA Bird Flashcards" (full name). Icon: dark green
  square with an orange sun and a bird silhouette. Dev and Tips use the same icon with a
  red/blue band.
- **Places a new name or logo has to change:**
  - `index.html` (title, `apple-mobile-web-app-title`)
  - `manifest.webmanifest` (`name`, `short_name`)
  - the header text
  - `privacy.html`
  - the Google sign-in screen (Google Cloud → Branding → App name)
  - icons: `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`, plus the
    Dev/Tips versions
  - the publishing workflow's renaming step, which matches on the current names
