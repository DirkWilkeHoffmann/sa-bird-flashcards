# Friend quizzes (Dev, 21 Nov 2026)

Agreed with Dirk on 21 Nov 2026. Built on Dev first; look back at it together before it goes to main.

## What it's for
A friendly round between people who know each other, not a ranking. Nothing is public: no leaderboard,
no daily record, no running wins and losses. The only scores kept are the rounds you played.

## How it works
- **Quizzes happen in the app; friends are added with an invite link** (changed 24 Nov 2026, replacing
  typed friend codes, which were guessable and clashed between people with the same name). The Friends
  screen has "Invite a friend": the phone's share sheet opens (WhatsApp, messages…) with a link like
  `…/?add=<32 random characters>`. Whoever opens it signs in with Google if needed, sees "Sam K. invited
  you to be friends. Add Sam K.?", and one tap makes you friends both ways. Each player has one reusable
  link (fine for a group chat); "Make a new invite link" kills the old one and keeps existing friends.
  People see your Google first name and surname initial ("Sam K."), which you can change. The link
  survives the Google sign-in (kept on the phone).
- **Opening the link makes you friends** (24 Nov 2026, replacing a short-lived copy-and-paste way for
  iPhones that was hard to explain). Tapping an invite link adds the friend straight away, once signed in,
  and the quiz page says "You and Sam K. are now friends". In a phone's browser it adds "Now open SA Birds
  from your Home Screen to play together": iPhones open every link in Safari, never in the Home Screen app,
  and the two don't share sign-in, but the friendship is on the server, so the app has it. (So on an iPhone
  the person signs in with Google once in Safari too.) Android: an app installed with Chrome opens the link
  itself. The note has an Undo, since there is no "Add?" question: a link someone else sends you
  to can't leave you friends with them by accident.
- **Quizzes need a Google sign-in** (that's who you are to your friends).
- **A round:** pick an area and a level (Beginner, Easy, Medium or Hard, the same groups the app works out
  for each area), invite 1–9 friends. The app draws **10 birds**; everyone gets the same 10, in the same
  order, starting on the same photo. You can still swipe through all the bird's photos, like when learning.
- **Each bird:** 1 minute to type its name. The check is forgiving: capitals, hyphens, spaces and small
  typos don't matter; Afrikaans names, scientific names and a few common old names count. A typo that
  is closer to another bird's name doesn't. No hints. Time out = missed.
- **Score:** right answers out of 10; a draw goes to the faster total time.
- **A round is open for 24 hours.** Anyone can decline. The maker plays whenever they like. After 24 hours
  it closes and whoever hasn't played shows as "didn't play".
- **Results:** only once you've played yourself (no previews of the birds). Then everyone's scores so far,
  and for each bird who named it. Past rounds stay in a history list.
- **Notifications:** "Dirk invited you to a quiz" and "Everyone's played: see the results", as web push
  (Android Chrome; iPhone once SA Birds is on the Home Screen, iOS 16.4+). Players who don't allow
  notifications see a dot on the quiz button.
- **Doesn't change learning progress.** A quiz is separate from the Dirk Progression.
- Needs signal. Cheat-proofing is light on purpose: these are rounds between friends.

## Approaches considered
- **Share links to play** (WhatsApp): simplest, no accounts. Dirk wanted the quizzes themselves inside the app; links are only for adding friends.
- **Live head-to-head** (both playing at once): exciting, but both must be online together and it needs a
  live connection between phones. Not now.
- **In-app friends and rounds that anyone plays within 24 hours** (picked): fits the app as built (static
  site + Supabase), works across time zones and busy days, and grows into groups later.

## How it's built
- Tables `quiz_players`, `quiz_friends`, `quiz_rounds`, `quiz_entries`, `push_subscriptions` (row-level
  security on, no direct access): everything goes through `quiz_*` functions that use the signed-in user
  (`supabase/migrations/20261123_friend_quizzes.sql`, `20261124_friend_links.sql`). Rounds carry `env`, so Dev rounds stay on Dev.
- Edge Function `quiz-push` sends the notifications (VAPID keys in table `push_config`, service role only).
- `quiz.js` (screens, play, the forgiving name check), `sw.js` (shows notifications, opens the round).

## Later
- Groups (a club makes a group with a join code; quizzes go to the group).
- Rematch button; native notifications once there's a store app.

## After the first tester (24 Nov 2026)
- **Photos in a quiz work as when studying:** swipe, dots under the photo, arrows on a computer, pinch or
  double-tap to zoom (the study card's zoom, `enableZoom` in app.js, now works on the quiz photos too).
  Tapping the photo no longer jumps to the next one (it clashed with double-tap).
- **Your played quizzes stay at the top** while friends still have to play ("Waiting for Sam K." with
  "Scores so far"), then with "Everyone's played" and an orange **See results**. Once you've looked at the
  results (remembered on the phone), or a day after the quiz closes, it moves to "Your quizzes".
- **A friend's quiz is clearly the thing to tap:** the card says "Sam K. sent you a quiz · 10 birds · Kruger
  National Park · Easy" with **Play Sam's quiz**; while it waits, New quiz is a plain button (orange the rest
  of the time). Tapping a quiz notification opens that quiz with what it is and one Play button.
- **The quiz page and Friends screen look like iOS Settings** (24 Nov 2026, with the Apple design skill):
  labelled groups of rows with thin inset lines, instead of cards, slabs and loose links. To play: "Quiz
  from Sam K. / Kruger National Park · Easy" with an App Store style Play capsule and the time left under
  it; tapping the row opens the quiz's page (Play, No thanks). Results: waiting ones show "Waiting for Anni
  R." and the time left with ›, finished ones a Results capsule. Then New quiz, a Friends group (your
  friends ›, Invite a friend), notifications, and Past quizzes folded into one row. The
  Friends screen: your friends (✕ to remove), Invite a friend, and You (name friends see, new invite link).

## Quiz stickers (Dev, 25 Nov 2026)
- Three stickers you can only earn in quizzes with friends, never drawn as a day's sticker: **finish your
  first quiz**, **finish 10 quizzes**, **win 50 quizzes**. A win is a finished quiz where at least one
  friend played too and nobody did better (more Right, or as many in less time: the results' order).
- Each arrives the big way once, with a sky-blue glow ("You finished your first quiz!"), when the quizzes
  load (after finishing one, opening the app or the quiz page); never in the middle of playing. Two at once
  follow each other. The album has a "From quizzes with friends" row: earned ones in colour, the rest as a
  shape with how to earn it and how far along ("4 of 50").
- Kept online with the account, per build like the quizzes (table `quiz_awards`, function `quiz_awards`,
  `supabase/migrations/20261125_quiz_stickers.sql`), so they follow you to another phone and are shown
  only once. Players who'd already finished quizzes get theirs the next time the quizzes load.
- The birds: tier `quiz` in `data/stickers.json` (folder `4 Quiz` in the sticker source), and which one
  is earned how in `QUIZ_STICKERS` (stickers.js); swapping a bird needs no database change.
