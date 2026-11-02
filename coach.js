"use strict";
// Tips on the first card, after the walkthrough: what to do with a card (look, hint or reveal, then
// mark yourself honestly) and what the momentum bird is. Shown once, as small speech bubbles next
// to the thing they explain; any tap on the card's own buttons moves the tips along.

const COACH_KEY = "sabirds.coach.v1";
const COACH = {
  look: ["media", "What's this bird? Have a good look. Swipe for more photos."],
  hint: ["hint", "Not sure? Tap Hint to pick from a few names."],
  reveal: ["reveal", "Think you know it? Say it in your head, then tap Reveal to check."],
  grade: ["grade", "Be honest: Got it or Missed it. That decides which birds you see and when they come back."],
  momentum: ["score", "This is your momentum bird. It fills up as you get birds right, and the fuller it is, the faster new birds are added."],
};
let coachStep = null;  // the bubble showing now, or "waitGrade" / "waitNext" between bubbles

function startCoach({ force = false } = {}) {
  if (!force && load(COACH_KEY, false)) return;
  showCoach("look");
}

function showCoach(step) {
  coachStep = step;
  const [anchorId, text] = COACH[step];
  const bubble = $("coach");
  $("coachText").textContent = text;
  $("coachNext").textContent = step === "reveal" || step === "momentum" ? "Got it" : "Next";
  bubble.hidden = false;
  document.querySelectorAll(".coach-target").forEach((x) => x.classList.remove("coach-target"));
  $(anchorId).classList.add("coach-target");
  placeCoach();
  animate("coach", { o: 0, y: 6 }, { o: 1, y: 0 }, {
    response: 0.3,
    onUpdate: ({ o, y }) => { bubble.style.opacity = String(o); bubble.style.translate = `0 ${y}px`; },
  });
}

function hideCoach() {
  $("coach").hidden = true;
  document.querySelectorAll(".coach-target").forEach((x) => x.classList.remove("coach-target"));
}

// Above the thing it explains when there's room, otherwise below; the arrow points at its middle.
function placeCoach() {
  if (!coachStep || $("coach").hidden) return;
  const target = $(COACH[coachStep][0]).getBoundingClientRect();
  const bubble = $("coach");
  const w = Math.min(320, innerWidth - 32);
  bubble.style.width = `${w}px`;
  const left = Math.max(16, Math.min(innerWidth - w - 16, target.left + target.width / 2 - w / 2));
  bubble.style.left = `${left}px`;
  const h = bubble.offsetHeight;
  // The photo is big: point at its lower part from inside it.
  const below = coachStep === "momentum" || coachStep === "look";
  const top = coachStep === "look" ? target.bottom - h - 24
    : below ? target.bottom + 12 : target.top - h - 12;
  bubble.style.top = `${Math.max(12, top)}px`;
  bubble.classList.toggle("below", below && coachStep !== "look");
  bubble.style.setProperty("--arrow", `${target.left + target.width / 2 - left}px`);
  bubble.classList.toggle("no-arrow", coachStep === "look");
}
addEventListener("resize", placeCoach);

function nextCoach() {
  const step = coachStep;
  hideCoach();
  if (step === "look") showCoach("hint");
  else if (step === "hint") showCoach("reveal");
  else if (step === "reveal") coachStep = "waitGrade";
  else if (step === "grade") coachStep = "waitNext";
  else finishCoach();
}
$("coachNext").addEventListener("click", nextCoach);

function finishCoach() {
  coachStep = null;
  hideCoach();
  save(COACH_KEY, true);
}

// The card's own buttons move the tips along: Reveal → the Got it / Missed it tip; marking yourself
// (or Next bird after a hint) → the momentum bird.
$("reveal").addEventListener("click", () => {
  if (!coachStep) return;
  hideCoach();
  setTimeout(() => { if (!$("grade").hidden) showCoach("grade"); }, 350);
});
$("hint").addEventListener("click", () => { if (coachStep) { hideCoach(); coachStep = "waitNext"; } });
for (const id of ["gotIt", "missed", "next"]) {
  $(id).addEventListener("click", () => {
    if (!coachStep) return;
    hideCoach();
    setTimeout(() => showCoach("momentum"), 1200);
  });
}

if (IS_DEV) {
  $("devCoach").hidden = false;
  $("devCoach").addEventListener("click", () => startCoach({ force: true }));
}
