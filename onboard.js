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
// Skip, once, means never again (also no more "add to home screen" reminders in the browser).
const SKIPPED_KEY = "sabirds.onboardSkipped.v1";
let reminder = false;  // showing only the "add to home screen" step to someone who's already playing

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// Which phone and browser, from the user agent, for the right "add to home screen" steps.
// Dev can try another with ?browser=ios-chrome, android-samsung, ios-inapp, … in the address.
function browserInfo() {
  const forced = IS_DEV && new URLSearchParams(location.search).get("browser");
  if (forced) { const [os, browser, version] = forced.split("-"); return { os, browser, version: Number(version) || 26 }; }
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios"
    : /Android/i.test(ua) ? "android" : "other";
  // Browsers inside other apps (Instagram, Facebook, the Google app, Android web views) can't add
  // to the home screen: the player has to open the page in their real browser first.
  if (/FBAN|FBAV|Instagram|LinkedInApp|Snapchat|TikTok|musical_ly|Twitter|Line\/|GSA\//.test(ua) || (os === "android" && /; wv\)/.test(ua))) {
    return { os, browser: "inapp" };
  }
  const browser = os === "ios"
    ? (/CriOS/.test(ua) ? "chrome" : /FxiOS/.test(ua) ? "firefox" : /EdgiOS/.test(ua) ? "edge" : "safari")
    : /SamsungBrowser/.test(ua) ? "samsung" : /Firefox/.test(ua) ? "firefox" : /EdgA/.test(ua) ? "edge" : "chrome";
  // Safari's version (Version/26.0): from 26 the Share button sits in a menu and Add to Home Screen
  // is under View More in the share sheet.
  const version = Number(ua.match(/Version\/(\d+)/)?.[1]) || 0;
  return { os, browser, version };
}
const device = browserInfo();
const isIOS = device.os === "ios";
const isPhone = device.os !== "other";

// Android (Chrome) offers its own install prompt; keep it for the install step's button.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener("appinstalled", () => { logEvent("installed"); if (onboard?.step === "install" || reminder) showStep("installed"); });

function saveOnboard() {
  save(ONBOARD_KEY, onboard);
}

// In a phone's browser: a friendly welcome, what the app is, then how to add it to the home screen.
// On the home screen (or after "Continue in the browser"): level, area, sign-in (when signed out),
// since the welcome was in the browser. On a computer: all of it apart from the install.
const BROWSER_STEPS = ["welcome", "about", "install"];
function steps() {
  if (reminder || (onboard.forceBrowser && !onboard.inBrowser)) return BROWSER_STEPS;
  const browser = isPhone && !standalone() && !onboard.inBrowser && !onboard.forceHome;
  if (browser) return BROWSER_STEPS;
  const ask = ["level", "area", ...(signedOut() ? ["signin"] : [])];
  return isPhone || onboard.inBrowser || onboard.forceHome ? ask : ["welcome", "about", ...ask];
}

// Called once the birds have loaded. New players get the walkthrough; someone back from Google
// sign-in gets it finished.
function startWalkthrough(newPlayer) {
  if (onboard?.step === "signin" && !onboard.done) { finishAfterSignIn(); return; }
  // On the home screen, someone who only got as far as "add to home screen" in the browser (Android
  // shares the browser's data) still has the questions to answer, unless they've answered birds since.
  const homeNext = standalone() && onboard?.step && !Object.keys(stats).length;
  if (!onboard?.done && (newPlayer || homeNext)) { showWalkthrough(); return; }
  remindToInstall();
}

// A phone's browser isn't where the app is meant to be played: every time it's opened there (or
// come back to after 30+ minutes), the welcome and "add to home screen" pages come up again, unless
// the player once tapped Skip.
function remindToInstall() {
  if (!isPhone || standalone() || load(SKIPPED_KEY, false) || !$("onboard").hidden) return;
  reminder = true;
  $("onboard").hidden = false;
  document.body.classList.add("onboarding");
  logEvent("install_reminder", null, { device: `${device.os}-${device.browser}` });
  showStep(BROWSER_STEPS[0]);
}
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000 && species.length) remindToInstall();
});

// Dev only: `browser` shows the phone-browser pages, `home` the home-screen ones, wherever it runs.
function showWalkthrough({ browser = false, home = false } = {}) {
  reminder = false;
  onboard = { level: "start", forceBrowser: browser, forceHome: home };
  $("onboard").hidden = false;
  document.body.classList.add("onboarding");
  showStep(steps()[0]);
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
  if (!reminder) {
    onboard.step = name;
    saveOnboard();
  }
  const list = steps();
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

STEP_VIEWS.welcome = (body, actions, next) => {
  body.append(el("p", "onb-emoji", "👋"), el("h1", "", "Hello, and welcome to SA Birds!"),
    el("p", "onb-lead", "We're so glad you're here. Whether you can't tell a sparrow from a starling yet or "
      + "you've been birding for years, this is a fun, easy way to get to know the birds around you."));
  actions.append(action("Hi! Show me around", "primary", next));
};

// What the app is and how it works.
const ABOUT = [
  ["📷", "<b>See a photo, name the bird.</b> Pick the right name from a few choices, or ask for a hint."],
  ["🧠", "<b>It learns what you know.</b> Birds you get wrong come back soon; the ones you know show up now and then."],
  ["🌱", "<b>Start with the common ones.</b> New birds are added as you get better, a few at a time."],
  ["📍", "<b>Your birds, your area.</b> Learn the birds around you, or anywhere in Southern Africa."],
  ["🔊", "<b>Hear their calls.</b> After each answer you can listen to the bird and read about it."],
];
STEP_VIEWS.about = (body, actions, next) => {
  body.append(el("h1", "", "What is SA Birds?"),
    el("p", "onb-lead", "A flashcard game with real photos of over 850 Southern African birds. A few minutes a day is all it takes."));
  const list = el("ul", "onb-about");
  for (const [emoji, html] of ABOUT) {
    const li = el("li");
    li.innerHTML = `<span aria-hidden="true">${emoji}</span><span>${html}</span>`;
    list.append(li);
  }
  body.append(list);
  actions.append(action("Next", "primary", next));
};

// How to add the app to the home screen, for this phone and browser. Each step is [icon, text].
const INSTALL_STEPS = {
  // Safari 26 (iOS 26): the menu button in the address bar (≡, or ••• next to it), Share, then
  // View More at the bottom of the share sheet, where Add to Home Screen is.
  "ios-safari": [["menu", "Tap <b>≡</b> in the address bar at the bottom (or <b>•••</b> next to it)"],
    ["share", "Tap <b>Share</b>"],
    ["view-more", "At the bottom, tap <b>View More</b>, then <b>Add to Home Screen</b>"],
    ["add-square", "Keep <b>Open as Web App</b> on, tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  // Safari 18 and older: the Share button is in the toolbar; Add to Home Screen is in the list.
  "ios-safari-old": [["share", "Tap the <b>Share</b> button in Safari's toolbar"],
    ["add-square", "Scroll down and tap <b>Add to Home Screen</b>"],
    ["", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  "ios-chrome": [["share", "Tap the <b>Share</b> button at the top right, next to the address"],
    ["view-more", "Scroll down, tap <b>View More</b>, then <b>Add to Home Screen</b>"],
    ["add-square", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  "ios-firefox": [["more", "Tap the <b>☰</b> menu at the bottom right"],
    ["share", "Tap <b>Share</b>, then <b>Add to Home Screen</b> (under <b>View More</b> if you don't see it)"],
    ["add-square", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  "ios-edge": [["more", "Tap the <b>•••</b> menu at the bottom"],
    ["share", "Tap <b>Share</b>, then <b>Add to Home Screen</b> (under <b>View More</b> if you don't see it)"],
    ["add-square", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  "android-chrome": [["more", "Tap the <b>⋮</b> menu at the top right"],
    ["add-square", "Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>"],
    ["", "Open <b>SA Birds</b> from your home screen"]],
  "android-samsung": [["more", "Tap the <b>☰</b> menu at the bottom right"],
    ["add-square", "Tap <b>Add page to</b>, then <b>Home screen</b>"],
    ["", "Tap <b>Add</b>, then open <b>SA Birds</b> from your home screen"]],
  "android-firefox": [["more", "Tap the <b>⋮</b> menu"],
    ["add-square", "Tap <b>Add app to Home screen</b> (or <b>Install</b>)"],
    ["", "Open <b>SA Birds</b> from your home screen"]],
  "android-edge": [["more", "Tap the <b>•••</b> menu at the bottom"],
    ["add-square", "Tap <b>Add to phone</b>, then <b>Install</b>"],
    ["", "Open <b>SA Birds</b> from your home screen"]],
};
// Inside another app (Instagram, Facebook, …): first open the page in the phone's own browser.
const OPEN_IN_BROWSER = {
  ios: [["more", "Tap <b>•••</b> or the <b>Share</b> button in this app's browser"],
    ["share", "Tap <b>Open in Safari</b> (or Open in browser)"],
    ["", "Then follow the steps there to add SA Birds to your home screen"]],
  android: [["more", "Tap the <b>⋮</b> menu in this app's browser"],
    ["share", "Tap <b>Open in Chrome</b> (or Open in browser)"],
    ["", "Then follow the steps there to add SA Birds to your home screen"]],
};

STEP_VIEWS.install = (body, actions) => {
  const inApp = device.browser === "inapp";
  body.append(el("p", "onb-emoji", "📲"), el("h1", "", inApp ? "Open SA Birds in your browser" : "Add SA Birds to your home screen"),
    el("p", "onb-lead", inApp
      ? "This page is open inside another app, which can't add it to your home screen."
      : "It opens full screen like an app, works offline, and it's one tap away for your daily birds."));
  const how = el("ol", "onb-howto");
  const key = device.browser === "safari" && device.version && device.version < 26 ? "ios-safari-old" : `${device.os}-${device.browser}`;
  const list = inApp ? OPEN_IN_BROWSER[isIOS ? "ios" : "android"]
    : INSTALL_STEPS[key] || INSTALL_STEPS[isIOS || !isPhone ? "ios-safari" : "android-chrome"];
  for (const [iconName, html] of list) {
    const li = el("li");
    li.innerHTML = `${iconName ? icon(iconName) : ""}<span>${html}</span>`;
    how.append(li);
  }
  // Android Chrome (and Edge, Samsung) can show their own install prompt: one tap instead.
  if (installPrompt && !inApp) {
    actions.append(action("Add to Home Screen", "primary", async () => {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      if (choice?.outcome === "accepted") showStep("installed");
    }));
    body.append(el("p", "note", "Or add it yourself:"));
  }
  body.append(how);
  if (isIOS && device.browser !== "safari" && !inApp) {
    body.append(el("p", "note", "Not seeing Add to Home Screen? Open this page in Safari and add it from there."));
  }
  actions.append(action("Continue in the browser instead", "ghost", () => {
    if (reminder) { reminder = false; hideWalkthrough(); return; }
    onboard.inBrowser = true;
    onboard.forceBrowser = false;
    showStep("level");
  }));
};

STEP_VIEWS.installed = (body) => {
  body.append(el("p", "onb-emoji", "✅"), el("h1", "", "Now open SA Birds from your home screen"),
    el("p", "onb-lead", "You can close this browser tab. We'll finish setting up there."));
};

STEP_VIEWS.level = (body, actions, next, steps) => {
  // On the home screen this is the first page: say hello and what's coming.
  if (steps[0] === "level") body.append(el("p", "onb-label", "Welcome! Let's set up your birds"));
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
  const ids = Learn.setup(learn, onboard.level, areaInfo().groups, Date.now());
  saveLearn();
  const level = onboard.level;
  onboard = { level, done: true };
  saveOnboard();
  logEvent("onboard", null, { level: skipped ? "skipped" : level, area: settings.area, signedIn,
    app: standalone() ? "home screen" : "browser", device: `${device.os}-${device.browser}` });
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
  save(SKIPPED_KEY, true);
  if (reminder) {
    reminder = false;
    logEvent("install_reminder", null, { skipped: true });
    hideWalkthrough();
    return;
  }
  onboard.level = "start";
  if (settings.area === "near" && !settings.near) settings = { ...settings, area: "c:ZA" };
  settings = { ...settings, u: new Date().toISOString() };
  save(SETTINGS_KEY, settings);
  startPlaying({ skipped: true });
});

// Dev: run the walkthrough on command (as it is here, or as a phone's browser would show it).
if (IS_DEV) {
  $("devTour").hidden = false;
  $("devTour").addEventListener("click", () => showWalkthrough({ home: true }));
  $("devTourBrowser").hidden = false;
  $("devTourBrowser").addEventListener("click", () => showWalkthrough({ browser: true }));
}
