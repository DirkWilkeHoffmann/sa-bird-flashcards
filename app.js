"use strict";

const STATS_KEY = "sabirds.stats.v1";
const MODE_KEY = "sabirds.mode";
const $ = (id) => document.getElementById(id);

let species = [];
let stats = load(STATS_KEY, {});   // { [speciesId]: { right, wrong, hint } }
let mode = load(MODE_KEY, "mixed"); // "mixed" | "photo" | "call"
let current = null;
let kind = "photo";                 // what the current card shows
let photoIndex = 0;
let callIndex = 0;
let session = { right: 0, seen: 0 };

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Birds you've missed come up more often; birds you know well come up less.
function weight(s) {
  const st = stats[s.id];
  if (!st) return 2;
  return Math.max(0.3, 1 + st.wrong * 2 + (st.hint || 0) - st.right * 0.5);
}

function pool() {
  return mode === "call" ? species.filter((s) => s.calls.length) : species;
}

function pickSpecies() {
  const list = pool();
  const weights = list.map((s) => (current && s.id === current.id ? 0 : weight(s)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

// Three look-alikes: same genus first, then family, then order, then anything.
function similar(target) {
  const picked = [];
  const tiers = [
    (s) => s.genus === target.genus,
    (s) => s.family === target.family,
    (s) => s.order === target.order,
    () => true,
  ];
  for (const inTier of tiers) {
    const options = shuffle(species.filter((s) => s !== target && !picked.includes(s) && inTier(s)));
    picked.push(...options.slice(0, 3 - picked.length));
    if (picked.length === 3) break;
  }
  return picked;
}

function showPhoto() {
  const photo = current.photos[photoIndex];
  $("sound").hidden = true;
  $("loading").hidden = false;
  $("photo").style.visibility = "hidden";
  $("photo").src = photo.url;
  $("credit").textContent = photo.attr;
  $("other").textContent = "Another photo";
  $("other").hidden = current.photos.length < 2;
}

function showCall() {
  const call = current.calls[callIndex];
  stopAudio();
  $("photo").removeAttribute("src");
  $("photo").style.visibility = "hidden";
  $("loading").hidden = true;
  $("sound").hidden = false;
  $("soundType").textContent = call.type;
  $("credit").textContent = call.attr;
  $("other").textContent = "Another recording";
  $("other").hidden = current.calls.length < 2;
  $("audio").src = call.url;
}

function playCall(index) {
  const audio = $("audio");
  const url = current.calls[index].url;
  if (audio.getAttribute("src") !== url) audio.src = url;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stopAudio() {
  const audio = $("audio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function setPanels({ ask = false, grade = false, after = false, answer = false, choices = false }) {
  $("ask").hidden = !ask;
  $("grade").hidden = !grade;
  $("after").hidden = !after;
  $("answer").hidden = !answer;
  $("choices").hidden = !choices;
}

function nextCard() {
  stopAudio();
  current = pickSpecies();
  const canCall = current.calls.length > 0;
  kind = mode === "photo" || !canCall ? "photo"
    : mode === "call" ? "call"
    : Math.random() < 0.5 ? "call" : "photo";
  photoIndex = Math.floor(Math.random() * current.photos.length);
  callIndex = Math.floor(Math.random() * current.calls.length);
  kind === "call" ? showCall() : showPhoto();
  setPanels({ ask: true });
  // Warm the cache for a likely next image.
  const peek = species[Math.floor(Math.random() * species.length)];
  new Image().src = peek.photos[0].url;
}

function showAnswer() {
  $("name").textContent = current.name;
  $("sci").textContent = current.sci;
  $("family").textContent = current.familyName
    ? `${current.familyName} (${current.family})`
    : current.family || "";
  // Learn both ways: call cards reveal a photo, and every answer offers the call.
  $("hearCall").hidden = current.calls.length === 0;
  if (kind === "call") showPhoto();
}

function reveal() {
  showAnswer();
  setPanels({ grade: true, answer: true });
}

function hint() {
  const box = $("choices");
  box.replaceChildren();
  for (const s of shuffle([current, ...similar(current)])) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.name;
    b.addEventListener("click", () => choose(b, s));
    box.append(b);
  }
  setPanels({ choices: true });
}

function choose(button, chosen) {
  const correct = chosen === current;
  for (const b of $("choices").children) {
    b.disabled = true;
    if (b.textContent === current.name) b.classList.add("correct");
  }
  if (!correct) button.classList.add("wrong");
  record(correct ? "hint" : "wrong");
  showAnswer();
  setPanels({ after: true, answer: true, choices: true });
}

function record(result) {
  const st = stats[current.id] || { right: 0, wrong: 0, hint: 0 };
  st[result] = (st[result] || 0) + 1;
  stats[current.id] = st;
  save(STATS_KEY, stats);
  session.seen++;
  if (result === "right") session.right++;
  $("score").textContent = `${session.right} / ${session.seen}`;
}

function setMode(m) {
  mode = m;
  save(MODE_KEY, m);
  for (const b of $("modes").children) b.setAttribute("aria-checked", String(b.dataset.mode === m));
}

$("photo").addEventListener("load", () => {
  $("loading").hidden = true;
  $("photo").style.visibility = "visible";
});
$("photo").addEventListener("error", () => {
  if (!$("photo").getAttribute("src")) return;
  $("loading").textContent = "Photo failed to load — tap Another photo";
});
$("audio").addEventListener("play", () => { $("play").classList.add("playing"); $("play").textContent = "❚❚"; });
$("audio").addEventListener("pause", () => { $("play").classList.remove("playing"); $("play").textContent = "▶"; });
$("play").addEventListener("click", () => playCall(callIndex));
$("hearCall").addEventListener("click", () => playCall(callIndex));
$("other").addEventListener("click", () => {
  if (!$("sound").hidden) {
    callIndex = (callIndex + 1) % current.calls.length;
    showCall();
  } else {
    photoIndex = (photoIndex + 1) % current.photos.length;
    showPhoto();
  }
});
$("reveal").addEventListener("click", reveal);
$("hint").addEventListener("click", hint);
$("gotIt").addEventListener("click", () => { record("right"); nextCard(); });
$("missed").addEventListener("click", () => { record("wrong"); nextCard(); });
$("next").addEventListener("click", nextCard);
$("modes").addEventListener("click", (e) => {
  const m = e.target.dataset?.mode;
  if (m && m !== mode) { setMode(m); nextCard(); }
});

setMode(mode);
Promise.all([
  fetch("data/species.json").then((r) => r.json()),
  fetch("data/calls.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
])
  .then(([data, calls]) => {
    species = data.map((s) => ({ ...s, calls: calls[s.id] || [] }));
    nextCard();
  })
  .catch(() => {
    $("loading").textContent = "Could not load bird data. Check your connection.";
  });
