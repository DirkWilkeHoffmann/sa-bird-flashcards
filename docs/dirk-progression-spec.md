# Dirk Progression spec

*29 Oct 2026. Written up from Dirk's handwritten notes ("SA Bird progression", 5 pages).* This
replaces every earlier progression idea, which is now in [archive/](archive/roadmap-progression-oct-2026.md).

The ideas below are Dirk's, unchanged. Where the notes give a number "for example", it's marked
*(example)*. Anything the notes leave open is **not** filled in here; it's a question in
[Questions and answers](#questions-and-answers) at the end, each with a suggested answer for Dirk
to accept or replace. The original notes are transcribed in the [appendix](#appendix-the-notes-transcribed)
so the write-up can be checked against them.

**The idea in one paragraph:** a deterministic system, like a Markov chain. Every bird has a
**weight** that says how well the player knows it. The player has a **momentum** score from their
last N answers. The next bird depends only on these: a player doing well gets a bird they're
learning or struggling with; a player not doing well gets a bird they know well. The player's
**pool** of birds comes from their **area** and grows as they master birds; the **learning group
L** stays about the same size while the group of **mastered birds** keeps growing. Players don't
choose levels any more.

---

## 1. Birds: difficulty groups (background)

- Every bird has a difficulty group: **Beginner, Easy, Medium, Hard**.
- The group is calculated from:
  - how common the bird is;
  - how widespread the bird is;
  - how easy it is to confuse the bird.

## 2. The area

- The player has one selected area. It's either:
  - a country: South Africa, Botswana, Namibia … (all the countries), **or**
  - a localised area, e.g. Cape Town or Kruger.
- Only **one** can be selected at any time. The area selector in the settings needs rewriting for this.

## 3. No more levels to choose

- Players can no longer select difficulty levels themselves.
- From now on the birds shown are purely progression, based on the player's learning and their
  area selection.

## 4. Each bird's weight

A number that shows how well a bird is known.

- **Negative** = not known well. **Positive** = known.
- Every bird starts at **−3** (page 1) / **−2** (page 4). See [Q1](#q1-starting-weight).
- After each answer a value is added to or taken from that bird's weight:

| Answer | Change to the bird's weight |
|---|---|
| Correct | +1 |
| Wrong | −1 |
| Wrong with a hint | −0.5 |
| Correct with a hint | +0 |

- **Momentum bonus:** a high momentum score also adds **+1.5** to the bird weight, so strong players
  move much faster, and **+2** if momentum is perfect.
- **Floor:** a bird that keeps being got wrong can't go below **MAX LOW = −5** *(example)*.
- **Mastered:** once a bird's weight is above **+4** *(example)*, it's mastered and the
  "Mastered" notification is shown.
- **Maximum and daily decay:** mastered birds are shown now and again to bring their weight up to a
  **MAX weighting**. The weight decreases by 1 randomly every day, so birds get moved back into the
  learning pool.
- Every bird also has a **Seen** or **Unseen** tag.

## 5. Momentum (M)

- Calculated from the last **N** birds seen. Mostly correct → momentum is high; low → lots were wrong.

| Answer | Momentum |
|---|---|
| Correct | +2 |
| Wrong | −2 |
| Correct with a hint | +1 |
| Wrong with a hint | −1 |

- **New session:** momentum is set to a default value, and the player's bird pool and weights are
  loaded.

## 6. The player's pool of birds

The pool is the birds the next bird can be chosen from. It's determined by:
- the selected area;
- what the player has seen before, and the learning pool.

**How the pool is built**
- All birds start with their starting weight and a Seen / Unseen tag.
- A player starts with a selected area. If no birds have been seen, the **first 20 easy birds** are
  added to the pool.
- When the player has mastered **some %** of birds **and** momentum is high, **X** new birds are added
  to the pool with an easy tag.
- Some parameters (momentum, % mastered, pool size, learning rate, etc.) make up an **Add New Rate**
  that decides when to add new birds. How well the player does on this Add New Rate decides how many
  new birds are added.
- New birds progress through Beginner → Easy → Medium → Hard.

**The learning group L and the mastered birds**
- The number of birds being learned stays relatively constant at some number **L**.
- The group of mastered birds grows and grows.
- Mastered birds are thrown in every now and again to get their weight up to the MAX weighting. The
  weight decreases by 1 randomly every day, so they get moved back into the learning pool.
- The size of L stays relatively fixed, based on the player's **average momentum**.

## 7. Choosing the next bird

```
New session?
    → set momentum to its default value
    → load the bird pool and weights

1. Look at momentum. Is the player doing well?
     Yes → show a bird they are learning, or a bird they are struggling with
           (one whose weight is very low)
     No  → show a bird they have a high weight for

Also: add birds back that were got wrong recently, so the memory is consolidated quickly.
```

## 8. When the area changes, the pool changes

- Some birds in the new area will be mastered already.
- L (the learning group) will be smaller. Start with these, and add new birds (progressing through
  Beginner → Easy → Medium → Hard) as the player's momentum changes.

## Words used

| Word | Means |
|---|---|
| Weight | One number per bird: how well it's known. Negative = not well, positive = known. |
| Momentum (M) | The player's score over their last N answers. |
| Pool | The birds the next bird can be chosen from: the area, what's been seen, the learning pool. |
| L, learning group | The birds being learned; its size stays about the same. |
| Mastered birds | Birds whose weight is above +4 *(example)*. This group keeps growing. |
| MAX LOW | The lowest a weight can go: −5 *(example)*. |
| MAX weighting | The highest a weight is brought to by showing mastered birds now and again. |
| Add New Rate | The parameters that decide when, and how many, new birds join the pool. |
| Seen / Unseen | Whether the player has seen the bird. |

---

## Questions and answers

Where the notes leave a gap, or where I wasn't sure what they mean. Each has a suggested answer
that fits the rest of the spec. **Answered by Dirk on 29 Oct 2026**; where there was no answer, the
suggested answer was taken. How each answer is built: [dirk-progression-coding-spec.md](dirk-progression-coding-spec.md).

### The numbers

#### Q1. Starting weight
Page 1 says every bird starts at −3; page 4 says −2. Which?
> **Suggested:** −2 (the later page, and the one in the pool section).
> **Dirk:** (No answer: suggested answer taken.)

#### Q2. How many answers does momentum look at (N)?
> **Suggested:** N = 10. Then M runs from −20 (all wrong) to +20 (all right).
> **Dirk:** (No answer: suggested answer taken.)

#### Q3. What is the default momentum at the start of a session, and what counts as a session?
If M is the sum of the last N answers, a new session either starts with an empty window or with the
last session's answers. "Default value" suggests an empty window with a fixed starting score.
> **Suggested:** a session starts when the app is opened after 30+ minutes away. M starts at +10
> ("doing fine") and is then worked out from this session's answers only, filling up to N.
> **Dirk:** Maybe starting at +5

#### Q4. What momentum counts as "doing well", "high" and "perfect"?
Three thresholds are used: "doing well?" for choosing the next bird, "high" for adding new birds and
for the +1.5 bonus, and "perfect" for the +2 bonus.
> **Suggested (with N = 10):** doing well = M ≥ +8 (about 7 of 10 right). High = M ≥ +14 (about 9 of
> 10, or 8 with hints). Perfect = +20 (the last 10 all right without a hint).
> **Dirk:** Yes this looks good, I like it

#### Q5. How does the momentum bonus combine with the answer?
"A high momentum score should also +1.5 to the bird weight." Does a correct answer then give
+1 + 1.5 = **+2.5** (and +1 + 2 = **+3** when perfect)? Does the bonus also apply to a wrong answer
or a hinted answer, or only to a correct one?
> **Suggested:** only to a correct answer without a hint: +2.5 when momentum is high, +3 when perfect.
> **Dirk:** no, I think when momentum is high +1.5 and Perfect +2, i think only correct answers, this is a feature for people who are really really good at birding

#### Q6. Is a strong player meant to master a bird this fast?
With a start of −2 and mastered "above +4", these are the Rights in a row needed:

| Player | Each Right adds | Weight after each Right | Mastered after |
|---|---|---|---|
| Normal | +1 | −1, 0, 1, 2, 3, 4, **5** | 7 Rights |
| High momentum | +2.5 | 0.5, 3, **5.5** | 3 Rights |
| Perfect momentum | +3 | 1, 4, **7** | 3 Rights (2 if "above" means "at or above") |
| A bird stuck at MAX LOW −5, normal | +1 | … | 10 Rights |

These can happen within one session, a few cards apart.
> **Suggested:** keep the numbers, but a bird can only be mastered on a day after it was first seen,
> so "mastered" always means "still known the next day". If you'd rather keep it purely by weight,
> say so.
> **Dirk:** No I think a bird can be mastered any time, can be on same day as its shown. I think something I didn't consider is overall momentum, I think three or 4 or 5 correct in a row automatically moves it to +4 = mastered. Or something like that. Let's think about this. becuase a user doesn't need to see a bird so many times if they obviously already know what it is.

#### Q7. Is "above +4" strictly above (more than 4) or 4 and up?
> **Suggested:** 4 and up (≥ +4). Easier to explain: "reach 4 to master a bird".
> **Dirk:** Perfect

#### Q8. What is the MAX weighting?
Mastered birds are shown "to get weighting to a MAX weighting". Is MAX the same as the mastered
threshold (+4), or higher? Is it a cap that a weight can never go above?
> **Suggested:** MAX = +7, and weights never go above it. A bird at +7 takes 3 or more days of decay
> before it drops back below +4 into L.
> **Dirk:** Perfect

### Daily decay and L

#### Q9. What does "decreases by 1 randomly every day" mean exactly?
Three possible readings:
1. Every mastered bird loses 1 each day.
2. Each day, some mastered birds chosen at random lose 1.
3. Each bird loses a random amount each day.
And does it also apply to birds that aren't mastered?
> **Suggested:** reading 2, mastered birds only: each day, each mastered bird has a 1 in 3 chance of
> losing 1. That spreads the returns out so they don't all come back on the same day.
> **Dirk:** No, at random, some mastered birds loose one point to be brought back in to circulation. Btw I don't mean mastered birds, I mean birds with a max score of +7, once they are at +6 do not decrease again, but if they are less than 7 then they are eligable to be shown to the user again.

#### Q10. Days the app isn't opened
If a player is away for 2 weeks, does the decay add up for every missed day? With reading 1 above,
every mastered bird would drop 14 points and the whole mastered group would be back in L at once.
> **Suggested:** decay is worked out for the days missed, but at most 1 per bird per day the app is
> opened; birds never drop more than 3 in one go.
> **Dirk:** No, I dont think this is what I had in mind, a bird with a wieght above or = 4 is mastered and is not shown at all if it is at Max weight of 7. That is why at some % chance every day, all birds at Weight 7 have a chanse of going down to 6 to be eligable for showing up again.

#### Q11. How does decay fit with keeping L about the same size?
As the mastered group grows, decay sends more birds back into L every day. With 300 mastered birds,
the suggested decay above (with MAX at +7, Q8) returns roughly 20–30 a day. If L is meant to stay at, say, 15, it could be
filled by returning birds alone, and new birds would stop being added.
> **Suggested:** returning birds count toward L, and new birds are only added when L is below its
> target. Players who play more get more new birds; players who play less mostly practise returning
> birds. Is that what you want, or should new birds always keep coming at some rate?
> **Dirk:** The Learning pool of size L should only be counted by birds that are seen and below a weight of 4. thus a bird of weight 6 has a low chance of being seen again, but if momentum is low then it has a high chanse of being shown.

#### Q12. What decides the size of L?
"Relatively fixed, based on the player's average momentum." Average over what (this session, the
last 7 days, all time)? Which momentum gives which L? Is there a smallest and largest L?
> **Suggested:** average M over the last 100 answers. L = 10 when the average is low, 15 normally,
> 25 when it's high. Never fewer than 5 or more than 30.
> **Dirk:** That sounds like a perfect place to start!

#### Q13. Which birds are "in L"?
Is L every bird in the pool whose weight is below the mastered threshold? Are unseen birds in the
pool part of L before they've been shown?
> **Suggested:** L = every bird in the pool that isn't mastered, seen or not.
> **Dirk:** so all birds that are seen and are in the correct area and have a weight below 4 are in the pool, when the add new birds functions is triggered then all those beirds are added in to the Pool of size L

### Adding new birds

#### Q14. "The first 20 easy birds": Easy group, or the easiest birds?
The groups are Beginner → Easy → Medium → Hard, and new birds progress through them in that order.
Should a new player start with 20 **Beginner** birds of their area, or literally 20 from the **Easy**
group? And "in order of" what: commonest first?
> **Suggested:** the 20 commonest Beginner birds in the area.
> **Dirk:** Yes first 20 from begginner from that area

#### Q15. What is the "easy tag" on new birds?
"X new birds are added to the pool with an easy tag." Is this a tag shown to the player (like the
NEW tag today), or the difficulty group?
> **Suggested:** it means the new birds are the next easiest ones not yet in the pool, and they show
> the NEW tag the first time they're seen.
> **Dirk:** no I did not mean that, when the new birds add function is triggered then randomly select X more birds from the current set (Beginner → Easy → Medium → Hard) untill the set is done and then start adding at random from the next set. They appear as new, when new birds are added they do not all have to be shown in a row, can be dispersed in to L as normal according to momentum.

#### Q16. The Add New Rate: what's the rule?
The notes name the inputs (momentum, % mastered, pool size, learning rate, etc.) but not how they
combine, what "some %" is, or what X is. What is "learning rate" here?
> **Suggested first version, to tune later:**
> - Add new birds when **L is below its target (Q12)** and momentum is high (Q4) and at least 60% of
>   the pool is mastered.
> - X = how far L is below its target, at most 5 at a time.
> - Learning rate = birds mastered per day over the last 7 days. Leave it out of the first version
>   and log it, so it can be added once there's data.
> **Dirk:** I dont think 60%, I think its a little high, I think better to focous on size of L to make sure it does not drop too low so that the game stays engaging. I think we can ignore learning rate, just a combineation of size of L and how that size has changed along with Momentum.

#### Q17. Order of new birds within a difficulty group
> **Suggested:** commonest first in the selected area.
> **Dirk:** Not a bad idea, I like it.

### Choosing the next bird

#### Q18. Which exact bird? (deterministic)
"A bird they are learning, or one whose weight is very low" can be many birds. To be deterministic,
the rule has to pick one.
> **Suggested:**
> - Doing well → the bird in L with the **lowest weight**.
> - Not doing well → the bird in L with the **highest weight**, or a mastered bird (Q20).
> - Ties → the one shown longest ago, then the commoner bird.
> - Never the same bird twice in a row; never a bird shown in the last 3 cards unless it's a
>   "got wrong recently" bird coming back (Q19).
> **Dirk:** This looks really good. I remember us discussing an idea where a bird you got wrong once is shown again in 3-5 birds, if wrong again then in 5-10 cards … on and on. I do also want some randomness in the selection, I dont want it to be purely deterministic, for example is Momentum is high then show a bird in the L pool in the bottom 20% of weights, then taking this idea on if Momentus is in the 20-40% range then select from the 20-40% range in the lowest weights pool etc etc, Adding new birds as L drops as discussed before.

#### Q19. "Add birds back that were got wrong recently": how soon?
> **Suggested:** a bird got wrong comes back after 3 other cards, once. If it's wrong again, again
> after 3.
> **Dirk:** I think also a little more randomly, I dont want it to be purely deterministic, I also dont want a user to be bombarded with birds they keep getting wrong. so maybe a wrong bird comes back between 3-5 and if wrong again between 5-8 or somethng like that. and then back to momentus with the weightings

#### Q20. When are mastered birds shown?
"Thrown in every now and again." Is that a fixed share (e.g. 1 card in 10), only when the player
is not doing well, or only when they've dropped back into L through decay?
> **Suggested:** 1 card in 10 is a mastered bird (lowest weight first), plus the "not doing well"
> rule can pick mastered birds.
> **Dirk:** I think all birds that are in the Mastered range (weight <4 - 7) should have a small chance to be shown depending on the Momentum, if momentum is low it should have a higher chance of showing a mastered bird.

#### Q21. "Deterministic" and "Markov chain"
A Markov chain usually means the next step is chosen at random with fixed chances that depend only
on the current state. "Deterministic" means the same state always gives the same next bird. Which
one do you mean, or both (fixed rules, no randomness, next bird depends only on the current state)?
The daily decay is described as random, so is randomness OK there but not in choosing the next bird?
> **Suggested:** choosing the next bird is fully deterministic (Q18); only the daily decay is random.
> **Dirk:** No it should be deterministic with a randomness added in to keep the game feeling fresh. So a deterministic start but the last selection is done at random.

#### Q22. Is the margin note on page 2 placed right?
The notes say "Show a bird they are learning or whose weighting is very low", with a note inserted:
"or a bird they are struggling with (low weight)". I read it as: doing well → a bird being learned,
or one with a very low weight (one they're struggling with). Correct?
> **Dirk:** I am not sure, I think ignore this

### Area and pool

#### Q23. Area options
The area is one country or one localised area. What about **Near me**, which is in the app today?
Is there an "all countries" option? And the family filter (studying one family)?
> **Suggested:** keep Near me as a localised area; add "All countries"; drop the family filter for
> now.
> **Dirk:** Lets leave out the families for now, I do want to add that but I want to do it at a later stage. Keep near me for sure and how it gets the persons location, to select areas I want it to be very obvious what areas are selected. I want it to be quite selective, I dont want it to have them selecting a bunch of areas, just one area. the Areas should be, everywhere, all of the countries, and then specific regions similar to how it is now and with the where I am location. I want it to be obvous what area is selected, it should be shown on the home page when looking at the cards, above the photos.

#### Q24. Difficulty groups: new calculation or today's?
Today: Beginner = the 50 most-recorded birds in the chosen place; Easy = the 150 most-recorded
overall, Medium the next 300, the rest Hard. The spec adds "how widespread" and "how easy to
confuse". Are the groups calculated once for all of southern Africa, or for each area (a common
Cape Town bird may be rare in Kruger)? How are the three factors combined?
> **Suggested:** groups worked out for each area: a score from records in that area (common),
> the share of the region's map cells it's found in (widespread), and how many lookalikes it has in
> `data/similar.json` (confusable). Beginner = the 50 best scores in the area, then Easy, Medium,
> Hard in proportions like today's.
> **Dirk:** It would be great if you could re cacluate the Begginner set (as the first w% of all the birds of that area, Easy as x%, ….) Would be amazing if you could recalculate that for all areas, although it will be a lot of data it would make the app amazing!

#### Q25. Changing area: what are "these"?
"L will be smaller. Start with these and add new birds." Does "these" mean the birds already in L
that are found in the new area? Do mastered birds from the old area stay mastered (weights are per
bird, not per area)? When switching back, is the old area's pool still there?
> **Suggested:** weights belong to the bird, so mastered stays mastered everywhere. The new pool =
> every seen bird found in the new area. L starts with the unmastered ones; new birds are added from
> the new area's Beginner birds onward. Switching back works the same way, so nothing is lost.
> **Dirk:** Yes that is exactally right.

### Things the notes don't cover

#### Q26. Photos and calls: one weight per bird, or two?
Knowing a bird by sight doesn't mean knowing its call.
> **Suggested:** one weight for now (as the notes describe), with photo or call chosen as today.
> **Dirk:** No, calls are weighted uniquely to the birds. They are not weighted the same, I actually think we are going to keep calls as a later feature, for now take them away and keep only the photos section. we can add calls back another time when we know how to handle them.

#### Q27. What happens to players' current progress?
Today each bird has right / wrong counts and a streak, and "mastered" = 3 right in a row.
> **Suggested:** mastered today → weight +4 (mastered). Seen but not mastered → −2 + right − wrong,
> between −5 and +3. Never seen → unseen, −2.
> **Dirk:** Perfect, this is a good plan

#### Q28. What is saved to the account?
The settings bug (roadmap) is that settings and unlocked birds stay on the phone.
> **Suggested:** sync each bird's weight and Seen tag, the selected area, and the pool. Momentum
> isn't synced (it starts fresh each session anyway).
> **Dirk:** I think that is good yes.

#### Q29. What does the player see?
Should the weight, momentum or L be visible anywhere (progress screen, top bar), or only "Mastered"
notifications and counts?
> **Suggested:** players see Mastered / Learning / Unseen counts for their area and the "Mastered"
> notification. Weights and momentum stay hidden.
> **Dirk:** Nothing should be visible except for the mastered, learning and to be seen, like it is now and then all the families below, but on Dev i want to see all of this information. it can be sown below the area line on the home screen and in the stats page.

#### Q30. Streaks, daily goals, sign-in reminders
These were in the archived plan, not in your notes. Are they out, or for later?
> **Suggested:** later, after the progression works. The sign-in reminders already on Dev stay, but
> the "new birds unlocked" one fires when new birds are added to the pool.
> **Dirk:** (No answer: suggested answer taken.)

#### Q31. When there's nothing to show
If every bird in the area is in the pool and mastered, and none have decayed, what comes next?
> **Suggested:** mastered birds, lowest weight first, with a "You know every bird here!" message
> once.
> **Dirk:** Perfect

#### Q32. What counts as "wrong with a hint" in the app?
Today the Hint asks "What kind of bird?" then "Which one?". Any hint counts as a miss.
> **Suggested:** correct with a hint = the right bird picked at "Which one?". Wrong with a hint = a
> wrong pick there. "Got it" / "Missed it" without a hint stay as correct / wrong.
> **Dirk:** when you take a hint and make any mistake it is a wrong hint.

#### Q33. "Seeing this bird too often?" (hide for a day)
> **Suggested:** keep it; hidden birds are skipped by the next-bird rule for a day.
> **Dirk:** Yes keep it for now, if it is not needed we can get rid of it

---

## Appendix: the notes transcribed

As written, in page order. ~~Struck out~~ text was crossed out in the notes.

**Page 1. ① Show next bird function**
~~① Calculate user momentum~~
Features
1. Pool of birds that the next bird can be selected from
   - Determined by the selected area
   - What the user has seen before and the learning pool.
2. Momentum indicator – M
   - Calculated by looking at the last N birds seen, if mostly correct then momentum is high, and if
     low then lots were wrong.
   - correct +2
   - wrong −2
   - hint + correct +1
   - hint wrong −1
3. Every bird's learning weight
   - Some number that shows how well a bird is known
   - e.g. if a weighting is negative it is not known well, if positive, then known
   - calculated by ~~looking at past N viewings~~ adding or minusing a value to this individual
     weighting, e.g. +1 for correct, −1 for wrong, −0.5 wrong hint, +0 for correct hint
     (Each bird starts at −3).

**Page 2. ② How to choose next bird.**
function:
New session? – Momentum is set to default value. – Load bird viewing pool and weights.
① Look at momentum – Player doing well?
Yes: Show a bird they are learning or whose weighting is very low.
*(Margin note, marked for insertion: "or a bird they are struggling with low weight.")*
No: Show a bird they have a high weighting of.
*[Bird weights]* also adding birds back that have gotten wrong recently to reconcile memory
quickly, if constantly getting wrong don't let weight go below MAX LOW = −5 for example.
*[Bird weights]* Once a bird's weighting is above e.g. +4 it is mastered and the notification is shown.
~~Once a bir…~~ ~~Next – How~~

**Page 3. ③ What is the user Pool of Birds? [Background]**
1. All birds have a difficulty group being – Beginner – Easy – Medium – Hard.
   This is calculated by – how common is the bird? – how widespread is the bird? – how easy is it
   to confuse this bird?
2. The user has a selected area e.g. South Africa, Bots, Nam…. etc all countries OR a localised
   area e.g. Cape Town or Kruger. But only one can be selected at any time so this will need to be
   rewritten on the selector in settings.
3. There are no more difficulty levels that a user can select themselves any more.
   – From now on it is purely progression based from user learning and area selection.

**Page 4. ④ How the Pool is calculated.**
- All birds start with a −2 weighting and a Seen or Unseen tag.
- A user starts with a selected area. If no birds are seen, add the first 20 easy birds to the Pool.
- When a user has mastered some % of birds and momentum is high then X new birds are added to the
  Pool with an easy tag.
- Some parameters (Momentum, % Mastered, Pool size, learning rate etc) = Add New Rate. Decide to add
  new birds. The performance of this Add New Rate determines how many new birds to add.
- I would like the Learning Size of birds to stay relatively constant at some number L where the
  size of "Mastered birds" grows and grows, and some are thrown in every now and again to get
  weighting to a MAX weighting (which decreases by 1 randomly every day to get moved back in to the
  Learning Pool). But the size of L keeps relatively fixed based on the user's average Momentum.

**Page 5. ⑤ When an Area changes ∴ Pool changes**
- Some birds in the new area will be mastered already
- L (learning group) will be smaller. Start with these and add new birds (obviously progressing
  through Beginner → Easy → Med → Hard) as the user's momentum changes.
- A high momentum score should also +1.5 to the bird weight to allow strong players to move much
  faster and +2 if momentum is perfect.
