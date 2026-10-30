# First-time walkthrough: draft

*30 Oct 2026. Built on Dev as drafted (`onboard.js`, `Learn.setup` in `learn.js`); the questions at
the end were left at the answers shown here.* A very short start for a new
player: how well they know birds, where they bird, and signing in. Their answer sets the starting
momentum, the size of the learning group L and which birds are in it.

## Who sees it

- Only a **new player**: nothing learned on this phone and no account progress.
- Never someone who already has progress (their first load after the update moves their progress
  over, as now).
- If someone signs in during the walkthrough and their account already has progress, the account
  wins and the experience answer is ignored ("Welcome back!").
- **Dev only:** a "Show the walkthrough again" button in the Dev stats, for testing.

## Reworked 30 Oct (after Dirk tried it on his phone)

- **Phone browser → home screen first.** In Safari or Chrome on a phone the walkthrough is only:
  welcome, then how to add the app to the home screen (iPhone: ••• / Share → Add to Home Screen;
  Android: the install button, or ⋮ → Add to Home screen). The questions happen in the home-screen
  app, which on iPhone starts with its own, empty storage anyway. "Continue in the browser instead"
  keeps going in the browser.
- **Area step:** "Which birds do you want to learn?" with two choices: 📍 Birds around me (location)
  or a place you choose (the area list), and how many birds that is.
- **Dev:** buttons under the Dev line run the walkthrough, as on the home screen or as in a browser.

## Reworked again 30 Oct

- **Phone browser: three pages**, every time it's opened there until the player taps Skip once:
  1. a friendly welcome ("Hello, and welcome to SA Birds!");
  2. what SA Birds is and how it works (photo → name, it learns what you know, common birds first,
     your area, calls);
  3. add to the home screen.
- **Home-screen app:** straight into the questions (how well you know birds, which birds, sign in),
  with "Welcome! Let's set up your birds" on the first one. This also happens on Android, where the
  home-screen app shares the browser's data, as long as no birds were answered in the browser.
- **Dev:** "▶ Walkthrough as on the home screen" and "▶ Walkthrough as in a phone's browser".

The screens below are the first version; steps 2–4 are the same apart from the area step's text.

## The screens

Three or four full-screen steps over the app, each with one choice and a big button. A small
"Skip" at the top on every step (skipping = today's defaults: Just starting, South Africa).
A row of dots shows how far along you are.

**1. Welcome**
> 🐦 **Learn the birds of Southern Africa**
> See a photo, name the bird, and the app learns what you know.
> **[Start]**

**2. How well do you know birds?**
> ○ **Just starting** — I know a few, like a pigeon or a Hadeda
> ○ **Some** — I know my garden birds
> ○ **Most common birds** — I can name most birds I see
> ○ **Experienced birder** — I know the hard ones too
> **[Next]**

**3. Where do you bird?**
> **[📍 Near me]** (asks for location; if refused, stays on this step)
> **[Choose an area]** (the same list as in settings: Everywhere, countries, regions)
> Shows: "Kruger National Park · 477 birds"
> **[Next]**

**4. Save your progress**
> Sign in with Google to keep your progress and use it on any phone.
> **[G Sign in with Google]**
> Not now
>
> (Signing in leaves the app for Google and comes back; the app then finishes the walkthrough.)

Then the first card, with a short toast: "Here are your first 20 birds. Good luck!"

## What each answer sets

The Dirk Progression rules stay the same; only the starting point changes.

| | Just starting | Some | Most common birds | Experienced |
|---|---|---|---|---|
| **Starting momentum** (first session) | +5 | +8 | +12 | +16 |
| **Average momentum seeded as** | 5 | 10 | 12 | 16 |
| → **L target** (from the average) | 15 | 25 | 25 | 40 |
| **Birds in L at the start** | 15 commonest Beginner | 25 commonest Beginner | 25 Beginner + 15 Easy | 15 Beginner + 15 Easy + 10 Medium |
| **Their starting weight** | −2 | −2 | −1 | 0 |
| **Right answers to master one** (3 in a row also masters) | 3 | 3 | 3 | 2–3 |

- Momentum and the average are what the rules already use, so after a few answers the player's own
  results take over: a "Experienced" player who misses a lot drops to the lower bands within about
  10 answers, and their L target follows their real average after about 100 answers.
- A higher start weight means birds they really know are mastered sooner (0 → +1.5 → +3 → mastered
  on the third right, or straight away by the 3-in-a-row rule).
- Birds come from the chosen area's own groups, commonest first, as now.

## What's logged

`onboard` with the experience level, area, whether they signed in, and whether they skipped. The
admin page can then show how many players pick each level and how often they sign in at step 4.

## Questions for Dirk

1. **Starting momentum:** only for the first session (as above), or for every session from then on
   (instead of the +5 default)?
2. **Starting weights:** should more experienced players' birds start higher (−1 / 0, as above), or
   should every bird start at −2 and only the size of L and the momentum change?
3. **The numbers in the table:** a good start, or different sizes of L per level?
4. **Experienced birders:** start with Medium birds in L (as above), or only Beginner and Easy and
   let them climb?
5. **Changing their answer later:** a "How well do you know birds?" choice in the settings, or only
   at the start?
6. **Wording:** happy with the four options and the screen texts?
