# Dirk Progression: coding spec

*29 Oct 2026.* How [dirk-progression-spec.md](dirk-progression-spec.md) is built, with Dirk's answers
to its questions (recorded there next to each question). Where a question had no answer, the
suggested answer was taken. Every number below is a constant at the top of `learn.js`, so it can be
tuned without touching the rules.

## Files

| File | What it does |
|---|---|
| `learn.js` | All the progression rules. No page or storage code, so Node can run it (`node scripts/test-learn.mjs`). |
| `app.js` | Calls `learn.js` after each answer and to pick each bird; area selector; photos only; hints. |
| `progress.js` | Progress screen (Mastered / Learning / To be seen, by group and family) and syncing. |
| `data/spread.json` | How many map cells each bird is found in (for "widespread"). Built by `scripts/build_spread.py`. |
| `supabase/migrations/20261029_learner_profiles.sql` | The table and two functions that sync weights, pool and area to the account. |

## 1. Weights (per bird, photos only)

| Constant | Value | From |
|---|---|---|
| Starting weight | −2 | Q1 |
| Floor (MAX LOW) | −5 | notes |
| Mastered | weight ≥ 4 | Q7 |
| MAX | 7, never higher | Q8 |

| Answer | Weight change |
|---|---|
| Correct | +1; **+1.5** if momentum is high, **+2** if perfect (the momentum before this answer) | Q5 |
| Wrong ("Missed it") | −1 |
| Correct with a hint (no mistake anywhere in the hint) | +0 |
| Wrong with a hint (any mistake in the hint, Q32) | −0.5 |

- **Known birds move fast (Q6):** 3 correct answers in a row without a hint take the bird straight to
  4 (mastered), if it isn't there already. A bird can be mastered on the day it's first shown.
- The "★ Mastered" badge shows when a bird reaches 4 from below.
- Each bird also has: `seen` (shown at least once), `added` (in the player's pool), `run` (correct
  in a row), `t` (last shown), `u` (last changed, for syncing).

## 2. Momentum M

- Points per answer: correct +2, wrong −2, hint correct +1, hint wrong −1. **N = 10** (Q2).
- **Session** = the app opened after 30+ minutes away (Q3). M is worked out from this session's
  answers only. It starts at **+5** (Dirk) and the starting value fades out as answers fill the
  window: `M = sum(last k answers) + 5 × (10 − k) / 10`, for k < 10 answers.
- Doing well: M ≥ 8. High: M ≥ 14. Perfect: M = 20 (Q4).
- Average momentum = the mean of M after each of the last 100 answers (Q12). Kept across sessions.

## 3. The pool, L and mastered birds

- **Area pool** = birds in the selected area with `added` set.
- **L (learning group)** = area pool birds with weight < 4 (seen, or added and not yet seen) (Q11, Q13).
- **Mastered** = weight 4 to 6: shown now and then (Q20).
- **Resting** = weight 7: not shown at all (Q10).
- **Daily rest (Q9, Q10):** once a day (first open), every resting bird has a **10%** chance of dropping
  to 6, so it can be shown again. Days away count: the chance is `1 − 0.9^days` (at most 30 days).
  Birds below 7 never drop.
- **Target size of L (Q12, raised 30 Oct):** average momentum < 8 → 15; 8 to 14 → 25; ≥ 14 → 40.
  Never below 8 or above 50.

## 4. Adding new birds (Q14–Q17)

- **First time in an area with nothing in the pool:** add the area's 20 commonest Beginner birds.
- **After each answer**, new birds are added when L is below its target **and** one of:
  - momentum is doing well (M ≥ 8);
  - L has shrunk over the last 20 answers (birds were mastered);
  - L is below 8 (keep the game going).
- **How many (30 Oct):** always 2–5 at once, never one at a time. By momentum: perfect 5, high 4,
  doing well 3, otherwise 2. If L is further below its target than that, as many as it's short,
  up to 5.
- **Which:** the area's groups in order, Beginner → Easy → Medium → Hard. Within the current group,
  the not-yet-added birds are sorted commonest first, and the new ones are picked **at random from
  the first 2 × X** of them (commonest-ish, not a fixed order). When a group runs out, the next one
  starts.
- New birds show the NEW tag when first seen and are mixed into L like any other bird (no run of
  new birds in a row).
- A toast says "5 new birds added" (with "Sign in to keep them" when signed out).

## 5. Choosing the next bird (Q18–Q21)

Deterministic rules, with the last choice made at random (Q21).

1. **Retry:** a bird answered wrong (or wrong with a hint) comes back after **3–5** other cards
   (random). Wrong again → after **5–8** cards. After that it goes back to the normal rules. A right
   answer clears it. At most one retry per card.
2. **Mastered bird?** With a chance that depends on momentum (Q20), show a mastered bird (weight 4–6),
   lower weights more likely (chance ∝ 7 − weight):

   | Momentum band | M | Chance of a mastered bird | L band picked from |
   |---|---|---|---|
   | 1 | ≥ 14 | 5% | lowest 0–20% of weights |
   | 2 | 8 to < 14 | 10% | 20–40% |
   | 3 | 2 to < 8 | 15% | 40–60% |
   | 4 | −4 to < 2 | 25% | 60–80% |
   | 5 | < −4 | 35% | highest 80–100% |

3. **Otherwise from L:** sort L by weight (lowest first; ties: shown longest ago, then commoner),
   take the band for the momentum (table), and pick one **at random** from it (Q18).
4. **Never** the same bird twice in a row, and never one from the last 3 cards (except a retry).
   Birds hidden for a day (Q33) are skipped. If the band is empty after that, the nearest bands are
   used, then all of L.
5. **Nothing in L or mastered:** add new birds if the area has any left; otherwise show resting
   birds at random, with "You know every bird here!" once per area (Q31).

## 6. Area (Q23–Q25)

- One choice in the settings: **Everywhere**, **Near me** (location, as today), one **country**, or
  one **region** (today's areas). No levels, no "Seen in" ticks, no family filter, no card type.
- The area is shown above the photos on the home screen (📍 line).
- **Difficulty groups are worked out for every area in the app** from three things, as percentiles
  within that area:
  - common: rank by records in that area (regions), or by records across the region (Everywhere,
    countries, Near me);
  - widespread: number of map cells the bird is found in (`data/spread.json`);
  - confusable: number of known mix-ups in `data/similar.json` (fewer = easier).

  `score = 0.6 × common + 0.25 × widespread + 0.15 × not-confusable` for Everywhere and countries.
  For a region or Near me, widespread across southern Africa says little (a Cape Sugarbird is
  everywhere in Cape Town), so there `score = 0.85 × common + 0.15 × not-confusable`. Sorted by score: Beginner =
  first 15% (at least 20 birds), Easy = next 20%, Medium = next 30%, Hard = the rest.
- **Changing area:** weights belong to the bird, so mastered stays mastered everywhere. The new
  pool = birds already added that are found in the new area; new birds come from the new area's
  groups. Switching back loses nothing.

**Studying one family (added 30 Oct):** chosen from a family's bird list or the settings. It covers
the family in **all areas**: all its birds are added to the pool at once, so they're L; everything
else (weights, momentum, picks, retries) works as normal. When every bird in the area or family is
mastered (L empty, nothing left to add), a notification says "Well done! All birds in this section
are mastered. Select a new area or family in settings", with a Settings button. It shows again if
something there needs learning and then gets mastered again.

## 7. Photos only while guessing (Q26)

Cards are always photos: no call cards, no card-type setting, no "listen" hint while guessing.
The answer screen still has **Hear call** and the recording credit, and offline downloads can
still include a call. Calls come back to the guessing later, with their own weights.

## 8. Moving today's progress (Q27)

Once, on first load: mastered today (3 right in a row) → 4; answered but not mastered →
`−2 + right − wrong`, kept between −5 and 3; seen without answers → −2. All of these are `added`
and `seen`. Everything else is unseen at −2.

## 9. Syncing (Q28)

- Saved on the phone (`sabirds.learn.v1`) and to the account through `profile_pull` /
  `profile_push`: every bird's weight, seen, added, run and last-changed time, plus the area.
  Newest change wins, per bird and for the area. Momentum isn't synced.
- The table and functions are in `supabase/migrations/20261029_learner_profiles.sql` (applied
  29 Oct 2026). If the calls fail (offline), everything stays on the phone and syncs later.
- The old progress sync (right / wrong counts, mix-ups, hidden photos) carries on as before.

## 10. What players see (Q29, Q30)

- Progress screen: Mastered / Learning / To be seen for the current area, then by group and by
  family.
- **Dev only:** a line under the area line (M, band, L / target, mastered, resting, the last pick's
  reason) and a "Dev: learning state" section on the progress screen with every number and the
  pool's birds with their weights.
- Streaks and daily goals: later. The sign-in reminders stay; the batch one fires when new birds are
  added.

## 11. Events logged

`answer` now also carries the weight after, M before, and why the bird was picked (`retry`,
`mastered`, `band1`–`band5`, `rest`). New: `added` (n, group) and `mastered`.
