"use strict";
// First-time walkthrough (docs/plan-first-time-walkthrough.md): a new player says how well they
// know birds, picks where they bird and can sign in with Google. Their answer sets the start of the
// Dirk Progression (Learn.setup): the first session's momentum, the size of L and its birds.
// Signing in leaves the app for Google, so the answers are saved and the walkthrough finishes when
// the app opens again; an account that already has progress wins ("Welcome back!").

const ONBOARD_KEY = "sabirds.onboard.v1";
const LEVEL_OPTIONS = [
  ["start", "Just starting", "I know a few, like a pigeon or a Hadeda"],
  ["some", "Some", "I know my garden birds"],
  ["most", "Most common birds", "I can name most birds I see"],
  ["expert", "Experienced birder", "I know the hard ones too"],
];
let onboard = load(ONBOARD_KEY, null);  // { level, step, done }

function saveOnboard() {
  save(ONBOARD_KEY, onboard);
}

// Called once the birds have loaded. New players get the walkthrough; someone back from Google
// sign-in gets it finished.
function startWalkthrough(newPlayer) {
  if (onboard?.done) return;
  if (onboard?.step === "signin") { finishAfterSignIn(); return; }
  if (!newPlayer) return;
  showWalkthrough();
}

function showWalkthrough() {
  onboard = { level: "start", step: 0 };
  saveOnboard();
  $("onboard").hidden = false;
  document.body.classList.add("onboarding");
  showStep(0);
}

function hideWalkthrough() {
  $("onboard").hidden = true;
  document.body.classList.remove("onboarding");
}

// Helpers for the step being drawn.
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function action(label, cls, onClick) {
  const b = el("button", `btn ${cls}`, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const STEPS = 4;
function showStep(step) {
  onboard.step = step;
  saveOnboard();
  const body = $("onbBody"), actions = $("onbActions");
  body.replaceChildren();
  actions.replaceChildren();
  $("onbDots").innerHTML = Array.from({ length: STEPS }, (_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("");
  $("onbSkip").hidden = step === STEPS - 1;
  [welcomeStep, levelStep, areaStep, signInStep][step](body, actions);
  $("onbBody").scrollTop = 0;
}

function welcomeStep(body, actions) {
  body.append(el("p", "onb-emoji", "🐦"), el("h1", "", "Learn the birds of Southern Africa"),
    el("p", "onb-lead", "See a photo, name the bird, and the app learns what you know."));
  actions.append(action("Start", "primary", () => showStep(1)));
}

function levelStep(body, actions) {
  body.append(el("h1", "", "How well do you know birds?"));
  const list = el("div", "onb-options");
  for (const [value, title, sub] of LEVEL_OPTIONS) {
    const b = el("button", "onb-option");
    b.type = "button";
    b.setAttribute("aria-pressed", String(onboard.level === value));
    b.append(el("b", "", title), el("span", "", sub));
    b.addEventListener("click", () => {
      onboard.level = value;
      saveOnboard();
      list.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    list.append(b);
  }
  body.append(list);
  actions.append(action("Next", "primary", () => showStep(2)));
}

// How many birds an area has (without changing the study set).
function birdsIn(area) {
  const prev = settings;
  settings = { ...settings, area, family: "" };
  const n = areaInfo().ids.length;
  settings = prev;
  return n;
}

function areaStep(body, actions) {
  body.append(el("h1", "", "Where do you bird?"));
  const near = action("📍 Near me", "ghost onb-near", async () => {
    count.textContent = "Finding your location…";
    try {
      const pos = await locate();
      nearSet = await computeNear(pos);
      settings = { ...settings, area: "near", near: pos, family: "" };
      select.value = "";
      show();
    } catch {
      count.textContent = "Couldn't get your location. Choose an area instead.";
    }
  });
  const label = el("label", "onb-label", "Or choose an area");
  const select = el("select", "select");
  select.id = "onbArea";
  label.htmlFor = "onbArea";
  // The same list as the settings, without Near me (it has its own button).
  for (const node of $("areaSelect").children) {
    if (node.value !== "near") select.append(node.cloneNode(true));
  }
  if (settings.area !== "near") select.value = settings.area;
  select.addEventListener("change", () => {
    settings = { ...settings, area: select.value, near: null, family: "" };
    show();
  });
  const count = el("p", "onb-count");
  const show = () => { count.textContent = `${areaName()} · ${birdsIn(settings.area)} birds`; };
  show();
  body.append(near, label, select, count);
  actions.append(action("Next", "primary", () => {
    settings = { ...settings, u: new Date().toISOString() };
    save(SETTINGS_KEY, settings);
    // Already signed in (or sign-in isn't available): nothing to ask, start straight away.
    if (!signedOut()) { startPlaying({ signedIn: Boolean(account) }); return; }
    showStep(3);
  }));
}

function signInStep(body, actions) {
  body.append(el("p", "onb-emoji", "☁️"), el("h1", "", "Save your progress"),
    el("p", "onb-lead", "Sign in with Google to keep your progress and use it on any phone."));
  const google = action("", "google", () => {
    onboard.step = "signin";
    saveOnboard();
    signInFrom("onboard");
  });
  google.innerHTML = '<span aria-hidden="true">G</span> Sign in with Google';
  actions.append(google, action("Not now", "ghost", () => startPlaying({ signedIn: false })));
}

// The player's start: their level's birds in the chosen area, then the first card.
function startPlaying({ signedIn = false, skipped = false } = {}) {
  learn = Learn.blank();
  Learn.touch(learn, Date.now());
  const ids = Learn.setup(learn, onboard.level, areaInfo().groups);
  saveLearn();
  onboard = { level: onboard.level, done: true };
  saveOnboard();
  logEvent("onboard", null, { level: skipped ? "skipped" : onboard.level, area: settings.area, signedIn });
  hideWalkthrough();
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
  showToast(`Here are your first ${ids.length} birds. Good luck!`);
}

// Back from Google: wait for the account to link and sync. An account with progress keeps it.
async function finishAfterSignIn() {
  $("onboard").hidden = false;
  document.body.classList.add("onboarding");
  $("onbDots").innerHTML = "";
  $("onbSkip").hidden = true;
  $("onbBody").replaceChildren(el("p", "onb-emoji", "☁️"), el("h1", "", "Signing you in…"));
  $("onbActions").replaceChildren();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !account; i++) await sleep(250);
  if (!account) { showStep(3); return; }  // sign-in was cancelled
  await sleep(1500);  // linkAccount may switch this phone to the account's sync code
  await syncNow();
  const returning = Object.values(learn.birds).some((b) => b.seen);
  if (!returning) { startPlaying({ signedIn: true }); return; }
  onboard = { level: onboard.level, done: true };
  saveOnboard();
  logEvent("onboard", null, { level: onboard.level, area: settings.area, signedIn: true, returning: true });
  hideWalkthrough();
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
  showToast("Welcome back! Your progress is here.");
}

// Skipping = today's defaults: Just starting, in the area shown (South Africa unless changed).
$("onbSkip").addEventListener("click", () => {
  onboard.level = "start";
  settings = { ...settings, u: new Date().toISOString() };
  save(SETTINGS_KEY, settings);
  startPlaying({ skipped: true });
});
