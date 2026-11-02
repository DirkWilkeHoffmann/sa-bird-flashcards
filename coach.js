"use strict";
// Tips on the first card, after the walkthrough: what to do with a card (look, hint or reveal, then
// mark yourself honestly) and what the momentum bird is. Shown once, as small speech bubbles next
// to the thing they explain.
//
// The player can do anything meanwhile (skip or swipe the card away, take a hint, reveal straight
// away, open a sheet), so the tips are a checklist: each one waits until the thing it explains is
// on screen (the card's panels #ask, #grade, #after, #choices are watched), and the tips only end
// once all five have been shown. Where they've got to is saved, so closing the app doesn't lose it.

const COACH_KEY = "sabirds.coach.v1";
const COACH = {
  look: ["media", "What's this bird? Have a good look. Swipe for more photos."],
  hint: ["hint", "Not sure? Tap Hint to pick from a few names."],
  reveal: ["reveal", "Think you know it? Say it in your head, then tap Reveal to check."],
  grade: ["grade", "Be honest: Got it or Missed it. That decides which birds you see and when they come back."],
  momentum: ["score", "This is your momentum bird. It fills up as you get birds right, and the fuller it is, the faster new birds are added."],
};
const ORDER = ["look", "hint", "reveal", "grade", "momentum"];
const COACH_DONE_KEY = "sabirds.coachDone.v1";

// null = not running; otherwise { done: { look: true, … }, answered } (answered: a card has been
// answered, so the momentum bird has something to show).
let coach = null;
let coachStep = null;  // the bubble showing now

// Seen-or-not is kept per phone (COACH_KEY) and per Google account (in the account's own details,
// TIPS_META): a new phone, or a new account on a phone that has seen them, gets the tips again.
const TIPS_META = IS_DEV ? "sabirds_dev_tips" : "sabirds_tips";
function coachNeeded() {
  if (!load(COACH_KEY, false)) return true;
  return Boolean(account && !account.user_metadata?.[TIPS_META]);
}

// Once the walkthrough is done (or was done before) and nothing else is on top.
function maybeStartCoach() {
  if (coach || !load(ONBOARD_KEY, null)?.done || !coachNeeded()) return;
  startCoach();
}

function startCoach({ fresh = false } = {}) {
  const saved = fresh ? {} : load(COACH_DONE_KEY, {});
  coach = { done: saved.done || {}, answered: Boolean(saved.answered) };
  syncCoach();
}

function tipDone(step) {
  if (!coach || coach.done[step]) return;
  coach.done[step] = true;
  save(COACH_DONE_KEY, coach);
  if (ORDER.every((x) => coach.done[x])) finishCoach();
}

function finishCoach() {
  coach = null;
  hideCoach();
  save(COACH_KEY, true);
  save(COACH_DONE_KEY, {});
  markTipsSeen();
}

// Tell the account too (retried on the next sign-in or app open if offline now).
function markTipsSeen() {
  if (!account || account.user_metadata?.[TIPS_META] || !authClient) return;
  authClient.auth.updateUser({ data: { [TIPS_META]: new Date().toISOString() } })
    .then(({ data }) => { if (data?.user) account = data.user; })
    .catch(() => {});
}

// Which tip fits what's on screen now: the first one not yet shown whose button is showing.
function syncCoach() {
  if (!coach) return;
  const showing = (id) => !$(id).hidden;
  // The walkthrough or the home-screen pages are on top: wait for them.
  if (showing("onboard")) { hideCoach(); return; }
  if (showing("grade") || showing("after")) coach.answered = true;
  const todo = (x) => !coach.done[x];
  let want = null;
  if (showing("grade")) want = todo("grade") ? "grade" : null;
  else if (showing("ask")) {
    want = ["look", "hint", "reveal"].find(todo) || null;
    if (!want && coach.answered && todo("momentum")) want = "momentum";
  }
  if (want === coachStep) { placeCoach(); return; }
  hideCoach();
  if (want) showCoach(want);
}

function showCoach(step) {
  coachStep = step;
  const [anchorId, text] = COACH[step];
  const bubble = $("coach");
  $("coachText").textContent = text;
  $("coachNext").textContent = step === "reveal" || step === "grade" || step === "momentum" ? "Got it" : "Next";
  bubble.hidden = false;
  $(anchorId).classList.add("coach-target");
  placeCoach();
  animate("coach", { o: 0, y: 6 }, { o: 1, y: 0 }, {
    response: 0.3,
    onUpdate: ({ o, y }) => { bubble.style.opacity = String(o); bubble.style.translate = `0 ${y}px`; },
  });
}

function hideCoach() {
  coachStep = null;
  $("coach").hidden = true;
  document.querySelectorAll(".coach-target").forEach((x) => x.classList.remove("coach-target"));
}

// Above the thing it explains when there's room, otherwise below; the arrow points at its middle.
// The photo is big, so that tip sits inside its lower part.
function placeCoach() {
  if (!coachStep || $("coach").hidden) return;
  const target = $(COACH[coachStep][0]).getBoundingClientRect();
  const bubble = $("coach");
  const w = Math.min(320, innerWidth - 32);
  bubble.style.width = `${w}px`;
  const left = Math.max(16, Math.min(innerWidth - w - 16, target.left + target.width / 2 - w / 2));
  bubble.style.left = `${left}px`;
  const h = bubble.offsetHeight;
  const inside = coachStep === "look", below = coachStep === "momentum";
  const top = inside ? target.bottom - h - 24 : below ? target.bottom + 12 : target.top - h - 12;
  bubble.style.top = `${Math.max(12, Math.min(innerHeight - h - 12, top))}px`;
  bubble.classList.toggle("below", below);
  bubble.classList.toggle("no-arrow", inside);
  bubble.style.setProperty("--arrow", `${target.left + target.width / 2 - left}px`);
}
addEventListener("resize", placeCoach);
addEventListener("scroll", placeCoach, { passive: true });
$("card").addEventListener("scroll", placeCoach, { passive: true, capture: true });

$("coachNext").addEventListener("click", () => {
  if (!coach) return;
  const step = coachStep;
  hideCoach();
  tipDone(step);
  syncCoach();
});

// Watch the card's panels and the walkthrough; a new card (skip, swipe) moves things, so place again.
const coachWatch = new MutationObserver(() => setTimeout(syncCoach, 0));
for (const id of ["ask", "grade", "after", "choices", "onboard"]) {
  coachWatch.observe($(id), { attributes: true, attributeFilter: ["hidden"] });
}
coachWatch.observe($("carousel"), { childList: true });
// A tip is ticked off when its bubble is closed, or when the player taps what it points at while
// it's showing (the "have a good look" tip counts as read once they tap Hint or Reveal under it).
// A tip they went ahead without (say Reveal while the Hint tip was up) shows on a later card.
const readByTap = { hint: ["hint", "look"], reveal: ["reveal", "look"], gotIt: ["grade"], missed: ["grade"] };
for (const [id, steps] of Object.entries(readByTap)) {
  $(id).addEventListener("click", () => { if (steps.includes(coachStep)) tipDone(coachStep); });
}

// A phone that has seen the tips, signed in to an account that has too (from another phone):
// nothing to do. Seen on this phone but not by this account: the tips play (maybeStartCoach). Seen
// by the account but the phone's own flag got lost: nothing to do either way.

if (IS_DEV) {
  $("devCoach").hidden = false;
  $("devCoach").addEventListener("click", () => startCoach({ fresh: true }));
}
