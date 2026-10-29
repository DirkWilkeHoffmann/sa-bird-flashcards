# Adaptive learning: proposed strategy to trial

*Draft 29 Oct 2026. The main focus before more features.* Explained with diagrams and simulated
numbers on the "How SA Birds Teaches" page (section 9 onwards). Builds on
`SA Birds · Progression Spec v2` (per-bird states, review ladder, batches of 5) and the review of it.

## Goal

Every player learns at their own pace. The next bird depends on how the last few answers went:
- **Struggling:** more birds they already know, so it gets easier and they get wins again.
- **Doing well:** more new birds and the birds they find hardest, so it stays a challenge.

That makes a feedback loop that keeps each player near **80–85% right**, the rate at which people
learn fastest (Wilson et al. 2019), whether they're a beginner or an expert.

## 1. Bird pools (what can be shown)

All pools are limited to the current settings: Place ∩ Levels ∩ birds unlocked for this player.

| Pool | Birds in it | Typical chance of a Right |
|---|---|---|
| **Known** | Learned or Mastered, review not due yet | ~95% |
| **Due** | Learned or Mastered, review due today | ~80% |
| **Learning** | Being learned, fewer than 2 misses in their last 5 answers | ~70% |
| **Tricky** | Being learned, 2 or more misses in their last 5 | ~45% |
| **New** | Unlocked, never shown | ~10% (novice) to ~90% (expert) |

## 2. Player modes: a three-state loop

The player is always in one of three modes. The mode is updated after every answer and sets
the mix of pools for the next card.

**Momentum** is a running score of recent answers:
`m ← 0.75 × m + 0.25 × x`, where x = 1 for Right, 0.5 for Right after a hint, and 0 for Wrong.
It starts at 0.8, and about the last 6–8 answers carry most of the weight.

| Mode | Enter when | Leave when |
|---|---|---|
| **Steady** (start) | 3 Right in a row while in Recover, or a miss while in Stretch | see the other rows |
| **Stretch** | 5 Right in a row, or m ≥ 0.85, while Steady | any Wrong, or m < 0.75 → Steady |
| **Recover** | 2 Wrong in a row, or m < 0.60, from any mode | 3 Right in a row → Steady |

Two different thresholds for entering and leaving a mode keep the player from flicking between
modes on every answer.

**Mix of pools per mode** (when a pool is empty, its share goes to the others in proportion):

| Mode | Known | Due | Learning | Tricky | New |
|---|---|---|---|---|---|
| Recover | 60% | 10% | 25% | 5% | 0% |
| Steady | 15% | 25% | 40% | 10% | 10% |
| Stretch | 5% | 20% | 25% | 25% | 25% |

**Expected accuracy per mode** = Σ share × chance of a Right. For a novice (New ≈ 10%):

| Mode | Novice | Expert (New ≈ 90%) |
|---|---|---|
| Recover | 0.6·0.95 + 0.1·0.8 + 0.25·0.7 + 0.05·0.45 = **85%** | 89% |
| Steady | 0.14 + 0.20 + 0.28 + 0.045 + 0.01 = **68%** | 76% |
| Stretch | 0.05 + 0.16 + 0.175 + 0.11 + 0.025 = **52%** | 72% |

So a struggling novice gets an easy run (85%), recovers, and then spends most time in Steady.
An expert lives in Stretch.

**Unlocking new birds depends on the mode** (replacing the spec's 80% accuracy gate):
- Recover: no new birds, unless there is nothing else to practise.
- Steady: add 5 when the pile (New + Learning + Tricky) is 5 or fewer.
- Stretch: add 5 when the pile is 8 or fewer.
- Always: at most 20 new birds a day (first-sight Right birds don't count), and none while 40+
  reviews are overdue.

**Inside a pool**, birds are still drawn by weight, and the same exclusions apply:
- Learning and Tricky: 1 + 2 per Wrong − 0.5 per Right over the last 5 answers, at least 0.3.
- Due: 1 + days overdue ÷ interval.
- In Recover, Known picks the birds furthest up the review ladder (the safest wins).
- Birds hidden for a day are left out, and a bird is never shown within 8 cards of itself (or half
  the pool when the pool is smaller).

## 3. Daily goal and streak

- **Daily goal: 10 Right answers** (unassisted). A small ring in the top bar fills up: "7 / 10 today".
- **Reaching it:** a celebration, "Daily goal done! 🔥 5-day streak", then play continues as normal.
- **Streak** = days in a row with the goal reached, by the player's local calendar.
- **Rest day:** one missed day in any 7 is forgiven automatically, so a streak doesn't die over one
  busy day. Streak anxiety and losing a long streak are common reasons people stop.
- **Opening the app:** "Yesterday you learned 6 new birds and mastered 2. Today: 0 / 10."
- **End of a session or day:** "Today: 14 right · 3 new birds learned · 1 mastered."
- **Weekly line (Mondays):** "Last week: 38 birds learned, 5-day streak."
- **Sign-in reminders use it:** "Sign in to keep your 5-day streak."
- **Synced to the account** with the settings (see the roadmap bug on settings not following the
  account).
- **Dashboard:** streak lengths, the share of active players reaching the goal each day, and
  day 1 / 7 / 30 return.

## 4. What the simulation says (14 days, 30 players of each type)

| Player | Rules | Day 14: birds unlocked | Known reliably | Right that day |
|---|---|---|---|---|
| Novice | Today | 112 | 26 | 49% |
| | Spec v2 | 59 | 27 | 67% |
| | **Adaptive** | 40 | 27 | **77%** |
| Casual | Today | 149 | 91 | 65% |
| | Spec v2 | 99 | 69 | 71% |
| | **Adaptive** | 77 | 61 | **80%** |
| Expert | Today | 242 | 198 | 79% |
| | Spec v2 | 178 | 167 | 86% |
| | **Adaptive** | 159 | 151 | **90%** |

- **The feedback loop works:** accuracy settles at 77–90% for every type of player, inside or near
  the 80–85% target. Today's rules let it drift down (novices end at 49%).
- **Time in each mode:** novices spend about 30% of their cards in Recover, casual birders 20%,
  experts never. Experts are in Stretch 80% of the time.
- **The cost is speed:** adaptive spends more cards on reviews and easy wins, so casual birders and
  experts meet fewer new birds in 14 days.
- **What doesn't help experts:** batches of 10 instead of 5, or 40% New in Stretch, changed almost
  nothing. A daily cap of 40 gave +6 birds.
- **What limits them:** cards spent on reviews. That's deliberate, because the spaced reviews are
  what make birds stick for months, which a 14-day simulation can't fully show.
- The learner model is made up (see the page), so these are comparisons, not predictions.

## 5. How to trial it

1. Build it on Dev behind a **"Try the new learning mode (beta)"** switch in the study set, so
   testers can compare.
2. Log, with each answer: the mode, the pool the card came from, momentum, the bird's state before
   the answer, and the time to Reveal.
3. **Dashboard:** time in each mode, accuracy by mode, new birds per active day, first-review
   recall, goal reached, streaks.
4. **Cohorts:** new players from a given date get adaptive by default. Compare 2-week cohorts
   before and after (100–200 players is too few for a true A/B split).
5. **Tune one group at a time,** at least 2 weeks each: the mode thresholds, then the mixes, then
   the daily cap.

## 6. Open questions

- Should the player see their mode ("On a roll! Harder birds coming")? Or should it stay invisible
  so it just feels right?
- What counts toward the daily goal: Right answers only, or any 10 cards?
- Is a rest day per 7 enough, or should players be able to "freeze" a streak, like Duolingo?
- In Stretch, should New birds come from the next level up when the current levels run out, or only
  once that level is ticked automatically?
