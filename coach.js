"use strict";
// Tips on the first card, after the walkthrough: what to do with a card (look, hint or reveal, then
// mark yourself honestly) and what the momentum bird is. Shown once, as small speech bubbles next
// to the thing they explain.
//
// The player can do anything meanwhile (skip or swipe the card away, take a hint, reveal straight
// away, open a sheet), so the tips follow what's on screen rather than which button was tapped:
// the card's panels (#ask, #grade, #after, #choices) are watched and the right tip is picked for
// whichever one is showing.

const COACH_KEY = "sabirds.coach.v1";
const COACH = {
  look: ["media", "What's this bird? Have a good look. Swipe for more photos."],
  hint: ["hint", "Not sure? Tap Hint to pick from a few names."],
  reveal: ["reveal", "Think you know it? Say it in your head, then tap Reveal to check."],
  grade: ["grade", "Be honest: Got it or Missed it. That decides which birds you see and when they come back."],
  momentum: ["score", "This is your momentum bird. It fills up as you get birds right, and the fuller it is, the faster new birds are added."],
};
const INTRO = ["look", "hint", "reveal"];

// null = not running. intro: which of INTRO is next; answered: the player has answered a card
// (revealed, or finished a hint); gradeSeen: the Got it / Missed it tip has been shown or dismissed.
let coach = null;
let coachStep = null;  // the bubble showing now

function startCoach({ force = false } = {}) {
  if (!force && load(COACH_KEY, false)) return;
  coach = { intro: 0, answered: false, gradeSeen: false };
  syncCoach();
}

function finishCoach() {
  coach = null;
  hideCoach();
  save(COACH_KEY, true);
}

// Which tip fits what's on screen now.
function syncCoach() {
  if (!coach) return;
  const showing = (id) => !$(id).hidden;
  // The walkthrough or the home-screen pages are on top: wait for them.
  if (showing("onboard")) { hideCoach(); return; }
  let want = null;
  if (showing("grade")) {
    coach.answered = true;
    if (!coach.gradeSeen) want = "grade";
  } else if (showing("choices") || showing("after")) {
    coach.answered = true;  // a hint: nothing to point at until the next card
  } else if (showing("ask")) {
    want = coach.answered ? "momentum" : INTRO[coach.intro] || null;
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
  if (step === "momentum") { finishCoach(); return; }
  if (INTRO.includes(step)) coach.intro = INTRO.indexOf(step) + 1;
  if (step === "grade") coach.gradeSeen = true;
  syncCoach();
});

// Watch the card's panels and the walkthrough; a new card (skip, swipe) moves things, so place again.
const coachWatch = new MutationObserver(() => setTimeout(syncCoach, 0));
for (const id of ["ask", "grade", "after", "choices", "onboard"]) {
  coachWatch.observe($(id), { attributes: true, attributeFilter: ["hidden"] });
}
coachWatch.observe($("carousel"), { childList: true });
// Once marked (Got it / Missed it), the grade tip is done with.
for (const id of ["gotIt", "missed"]) $(id).addEventListener("click", () => { if (coach) coach.gradeSeen = true; });

// Closed the app halfway through the tips (or before the first card loaded)? Carry on next time,
// as long as they've only just started playing.
if (load(ONBOARD_KEY, null)?.done && !load(COACH_KEY, false) && Object.keys(stats).length < 10) {
  setTimeout(() => startCoach(), 1500);
}

if (IS_DEV) {
  $("devCoach").hidden = false;
  $("devCoach").addEventListener("click", () => startCoach({ force: true }));
}
