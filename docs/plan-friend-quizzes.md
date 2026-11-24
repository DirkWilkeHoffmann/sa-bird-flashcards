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
- **iPhone: copy and paste the invite** (24 Nov 2026). iPhones open every link in Safari, never in the
  Home Screen app, and the two share no saved data or sign-in, so the link can't go straight to the app.
  They do share the clipboard: in Safari the link shows "Copy invite" and three steps (copy, open SA Birds
  from the Home Screen, tap 👥 then Paste invite), with no sign-in in Safari. In the app, "Got an invite
  from a friend? Paste invite" (quiz page and Friends screen) reads the link from the clipboard (iPhone
  shows its Paste bubble), or asks for it, then shows "Add Sam K.?". "Or add your friend here in Safari"
  keeps the old way. Android needs none of this: an app installed with Chrome opens the link itself.
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
