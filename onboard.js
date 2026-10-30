"use strict";
// First-time walkthrough (docs/plan-first-time-walkthrough.md). On a phone's browser it starts by
// showing how to add the app to the home screen (that's where people play daily); the home-screen
// app is a fresh start (on iPhone it doesn't share the browser's saved data), so the rest happens
// there: how well the player knows birds, which birds they want to learn, and Google sign-in.
// Their answer sets the start of the Dirk Progression (Learn.setup): the first session's momentum,
// the size of L and its birds. Signing in leaves the app for Google, so the answers are saved and
// the walkthrough finishes when the app opens again; an account with progress wins ("Welcome back!").

const ONBOARD_KEY = "sabirds.onboard.v1";
const LEVEL_OPTIONS = [
  ["start", "Just starting", "I know a few, like a pigeon or a Hadeda"],
  ["some", "Some", "I know my garden birds"],
  ["most", "Most common birds", "I can name most birds I see"],
  ["expert", "Experienced birder", "I know the hard ones too"],
];
let onboard = load(ONBOARD_KEY, null);  // { level, step, browser, done }

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isPhone = isIOS || /Android/i.test(navigator.userAgent);

// Android (Chrome) offers its own install prompt; keep it for the install step's button.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener("appinstalled", () => { logEvent("installed"); if (onboard?.step === "install") showStep("installed"); });

function saveOnboard() {
  save(ONBOARD_KEY, onboard);
}

// In a phone's browser: welcome, then how to install. On the home screen (or a computer, or after
// "Continue in the browser"): welcome, level, area, sign-in (when signed out).
function steps() {
  if (isPhone && !standalone() && !onboard.inBrowser) return ["welcome", "install"];
  return ["welcome", "level", "area", ...(signedOut() ? ["signin"] : [])];
}

// Called once the birds have loaded. New players get the walkthrough; someone back from Google
// sign-in gets it finished.
function startWalkthrough(newPlayer) {
  if (onboard?.done) return;
  if (onboard?.step === "signin") { finishAfterSignIn(); return; }
  if (!newPlayer) return;
  showWalkthrough();
}

// `browser`: Dev only, show the phone-browser version (install step) even on the home screen.
function showWalkthrough({ browser = false } = {}) {
  onboard = { level: "start", step: "welcome", forceBrowser: browser };
  saveOnboard();
  $("onboard").hidden = false;
  document.body.classList.add("onboarding");
  showStep("welcome");
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

const STEP_VIEWS = {};
function showStep(name) {
  onboard.step = name;
  saveOnboard();
  const list = onboard.forceBrowser && !onboard.inBrowser ? ["welcome", "install"] : steps();
  const at = list.indexOf(name);
  const body = $("onbBody"), actions = $("onbActions");
  body.replaceChildren();
  actions.replaceChildren();
  $("onbDots").innerHTML = at < 0 ? "" : list.map((_, i) => `<i class="${i === at ? "on" : ""}"></i>`).join("");
  $("onbSkip").hidden = name === "signin" || name === "installed";
  const next = () => showStep(list[at + 1]);
  STEP_VIEWS[name](body, actions, next, list);
  body.scrollTop = 0;
}

STEP_VIEWS.welcome = (body, actions, next, list) => {
  const installing = list[1] === "install";
  body.append(el("p", "onb-emoji", "🐦"), el("h1", "", installing ? "Learn the birds of Southern Africa" : "Welcome to SA Birds"),
    el("p", "onb-lead", installing
      ? "See a photo, name the bird, and the app learns what you know. A few minutes a day is all it takes."
      : "See a photo, name the bird, and the app learns what you know. Three quick questions and you're birding."));
  actions.append(action(installing ? "Get started" : "Start", "primary", next));
};

// How to add the app to the home screen: iPhone (Safari's Share menu) or Android (the browser's own
// prompt, or its menu). The home-screen app then starts the walkthrough's questions.
STEP_VIEWS.install = (body, actions) => {
  body.append(el("p", "onb-emoji", "📲"), el("h1", "", "Add SA Birds to your home screen"),
    el("p", "onb-lead", "It opens full screen like an app, works offline, and it's one tap away for your daily birds."));
  const how = el("ol", "onb-howto");
  const stepLine = (iconName, html) => {
    const li = el("li");
    li.innerHTML = `${iconName ? icon(iconName) : ""}<span>${html}</span>`;
    how.append(li);
  };
  if (isIOS || !isPhone) {
    stepLine("more", "Tap <b>•••</b> or the <b>Share</b> button in Safari's bar");
    stepLine("share", "Tap <b>Share</b>, then scroll to <b>Add to Home Screen</b>");
    stepLine("add-square", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen");
    body.append(how, el("p", "note", "No Share button? Open this page in Safari first."));
  } else if (installPrompt) {
    actions.append(action("Add to Home Screen", "primary", async () => {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      if (choice?.outcome === "accepted") showStep("installed");
    }));
  } else {
    stepLine("more", "Tap the <b>⋮</b> menu at the top of the browser");
    stepLine("add-square", "Tap <b>Add to Home screen</b> or <b>Install app</b>");
    stepLine("", "Open <b>SA Birds</b> from your home screen");
    body.append(how);
  }
  actions.append(action("Continue in the browser instead", "ghost", () => {
    onboard.inBrowser = true;
    onboard.forceBrowser = false;
    showStep("level");
  }));
};

STEP_VIEWS.installed = (body) => {
  body.append(el("p", "onb-emoji", "✅"), el("h1", "", "Now open SA Birds from your home screen"),
    el("p", "onb-lead", "You can close this browser tab. We'll finish setting up there."));
};

STEP_VIEWS.level = (body, actions, next) => {
  body.append(el("h1", "", "How well do you know birds?"),
    el("p", "onb-lead", "Be honest — the app adjusts as you play."));
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
  actions.append(action("Next", "primary", next));
};

// How many birds an area has (without changing the study set).
function birdsIn(area) {
  const prev = settings;
  settings = { ...settings, area, family: "" };
  const n = areaInfo().ids.length;
  settings = prev;
  return n;
}

// Which birds to learn: the ones around you (location), or the ones of an area you pick.
STEP_VIEWS.area = (body, actions, next) => {
  body.append(el("h1", "", "Which birds do you want to learn?"),
    el("p", "onb-lead", "Start with the birds where you are, or pick a place you bird or are travelling to. "
      + "You'll begin with its most common birds, and you can change it any time in settings."));
  const list = el("div", "onb-options");
  const here = el("button", "onb-option");
  here.type = "button";
  here.append(el("b", "", "📍 Birds around me"), el("span", "", `Use my location: birds recorded within about ${NEAR_KM} km`));
  const pick = el("div", "onb-option onb-pick");
  const pickTitle = el("label", "", "🗺️ A place I choose");
  const select = el("select", "select");
  select.id = "onbArea";
  pickTitle.htmlFor = "onbArea";
  // The same list as the settings, without Near me (it's the first choice).
  for (const node of $("areaSelect").children) {
    if (node.value !== "near") select.append(node.cloneNode(true));
  }
  select.value = settings.area === "near" ? "c:ZA" : settings.area;
  pick.append(pickTitle, el("span", "", "Everywhere, a country, or a region like Kruger or Cape Town"), select);
  list.append(here, pick);
  const status = el("p", "onb-count");
  body.append(list, status);

  const mark = () => {
    here.setAttribute("aria-pressed", String(settings.area === "near"));
    pick.setAttribute("aria-pressed", String(settings.area !== "near"));
    status.textContent = `${areaName()}: ${birdsIn(settings.area)} birds to learn`;
  };
  here.addEventListener("click", async () => {
    status.textContent = "Finding your location…";
    try {
      const pos = await locate();
      nearSet = await computeNear(pos);
      settings = { ...settings, area: "near", near: pos, family: "" };
      mark();
    } catch {
      status.textContent = "Couldn't get your location. Allow location for this app, or pick a place below.";
    }
  });
  const choose = () => { settings = { ...settings, area: select.value, near: null, family: "" }; mark(); };
  select.addEventListener("change", choose);
  pick.addEventListener("click", (e) => { if (e.target !== select && settings.area === "near") choose(); });
  if (settings.area === "near" && !settings.near) settings = { ...settings, area: "c:ZA" };
  mark();
  actions.append(action("Next", "primary", () => {
    settings = { ...settings, u: new Date().toISOString() };
    save(SETTINGS_KEY, settings);
    // Already signed in (or sign-in isn't available): nothing to ask, start straight away.
    if (!signedOut()) { startPlaying({ signedIn: Boolean(account) }); return; }
    next();
  }));
};

STEP_VIEWS.signin = (body, actions) => {
  body.append(el("p", "onb-emoji", "☁️"), el("h1", "", "Save your progress"),
    el("p", "onb-lead", "Sign in with Google to keep what you learn safe and use it on any phone."));
  const google = action("", "google", () => {
    onboard.step = "signin";
    saveOnboard();
    signInFrom("onboard");
  });
  google.innerHTML = '<span aria-hidden="true">G</span> Sign in with Google';
  actions.append(google, action("Not now", "ghost", () => startPlaying({ signedIn: false })));
};

// The player's start: their level's birds in the chosen area, then the first card.
function startPlaying({ signedIn = false, skipped = false } = {}) {
  learn = Learn.blank();
  Learn.touch(learn, Date.now());
  const ids = Learn.setup(learn, onboard.level, areaInfo().groups);
  saveLearn();
  const level = onboard.level;
  onboard = { level, done: true };
  saveOnboard();
  logEvent("onboard", null, { level: skipped ? "skipped" : level, area: settings.area, signedIn,
    app: standalone() ? "home screen" : "browser" });
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
  if (!account) { showStep("signin"); return; }  // sign-in was cancelled
  await sleep(1500);  // linkAccount may switch this phone to the account's sync code
  await syncNow();
  const returning = Object.values(learn.birds).some((b) => b.seen);
  if (!returning) { startPlaying({ signedIn: true }); return; }
  const level = onboard.level;
  onboard = { level, done: true };
  saveOnboard();
  logEvent("onboard", null, { level, area: settings.area, signedIn: true, returning: true });
  hideWalkthrough();
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
  showToast("Welcome back! Your progress is here.");
}

// Skipping = today's defaults: Just starting, in the area shown (South Africa unless changed).
$("onbSkip").addEventListener("click", () => {
  onboard.level = "start";
  if (settings.area === "near" && !settings.near) settings = { ...settings, area: "c:ZA" };
  settings = { ...settings, u: new Date().toISOString() };
  save(SETTINGS_KEY, settings);
  startPlaying({ skipped: true });
});

// Dev: run the walkthrough on command (as it is here, or as a phone's browser would show it).
if (IS_DEV) {
  $("devTour").hidden = false;
  $("devTour").addEventListener("click", () => showWalkthrough());
  $("devTourBrowser").hidden = false;
  $("devTourBrowser").addEventListener("click", () => showWalkthrough({ browser: true }));
}
