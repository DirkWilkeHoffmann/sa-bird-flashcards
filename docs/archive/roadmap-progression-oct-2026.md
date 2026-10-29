# Archived: progression ideas before the Dirk Progression spec

*Archived 29 Oct 2026.* These ideas were replaced by [dirk-progression-spec.md](../dirk-progression-spec.md).
Kept for reference only; don't build from them.

Also archived here: [plan-adaptive-learning.md](plan-adaptive-learning.md) and
[report-adaptive-learning.md](report-adaptive-learning.md). Not in the repo: *SA Birds · Progression Spec v2*,
the "How SA Birds Teaches" page, the "SA Birds Progression Review" page and the
"SA Birds Adaptive Learning" review page.

## From the roadmap (as it was on 29 Oct 2026)

## Main focus: adaptive learning progression
Every player should learn at their own pace. No other features until this is right; no code
changes until Dirk gives the go-ahead.

**Documents**
- *SA Birds · Progression Spec v2* (Dirk, 26 Oct): per-bird states, review ladder, batches of 5.
- Review of that spec (chat, 27 Oct): the Hint mismatch, cards running out on day 1, small piles,
  fast-track limits, the "Learned" stage, photo vs call states.
- [plan-adaptive-learning.md](plan-adaptive-learning.md): the proposed strategy to trial, covering
  - Recover / Steady / Stretch modes driven by recent answers;
  - a mix of pools for each mode;
  - a daily goal of 10 Right answers and a streak;
  - simulation results.
- "How SA Birds Teaches" page: diagrams, formulas, worked examples and a 90-player simulation.

**Parts, in build order** (each is checked on Dev before the next):
1. **Bird states and data:** Locked → Unseen → Learning → Learned → Mastered per bird, synced to the
   account together with the study settings (fixes the settings bug below). Today's mastered birds
   become Learned and due straight away.
2. **Answer logging:** mode, pool, momentum, state before, time to Reveal. Plus a learning dashboard
   (accuracy by mode, first-review recall, new birds per day, goal reached, streaks).
3. **Grading:** Right / assisted (correct after Hint, half a point) / Wrong, lapses.
4. **Review ladder:** 1, 3, 7, 14, 30, 60, 120 days. Mastered = still known on 2 later days.
5. **Adaptive next bird:** Recover / Steady / Stretch, the pool mixes, unlocking that depends on the
   mode, and never running out of cards.
6. **Settings changes:** pool = Place ∩ Levels ∩ unlocked birds. Known birds stay when area or levels
   change; a named area ignores the country ticks; unticked levels stay off.
7. **Daily goal and streak:** "7 / 10 today", a streak with a rest day per 7, daily and weekly summaries,
   and "Sign in to keep your streak".
8. **Celebrations and progress screen:** "✓ Learned" during a session, "★ Still remembered!" on a later
   day, and three groups (Learning, Learned, Mastered).
9. **Trial:** a beta switch for testers first, then cohorts of new players compared over 2 weeks.
   Tune one group of settings at a time.

**Decisions still open** (see the plan and the review): counting a hinted Right as half a point;
a fast-track daily limit; separate photo and call states; showing the mode to players or not;
what counts toward the daily goal; streak freezes.

### Open questions on the old progression

3. **Batch size later on.** Batches grow by 5 each time (20, 25, 35, 50, 70, 95, …), so deep into
   Medium/Hard they reach 60–85 birds at once. Consider capping a batch at ~25–30.
4. **Unticking an auto-added level.** At the moment the next answer that passes the 40% mark ticks it
   again. The alternative is to keep it off once the player turns it off.
5. **Studying a family.** It shows the whole family at once (no gradual growth). Should it grow
   like the levels?

### Reviewed 26 Oct 2026 (progression and area items)

- **Areas outside SA with "South Africa" ticked** hide the birds not also found in SA
  (e.g. Etosha 266 of 278, Victoria Falls & Hwange 319 of 333). Fix if needed: a named area
  ignores the country ticks.
- **Switching area keeps the number of birds in play** (e.g. 95 in Gauteng gives 95 in Cape Town
  at once). Option: progress per area too.
- **Batch size later on** (item 3) and **unticking an auto-added level** (item 4): unchanged.
