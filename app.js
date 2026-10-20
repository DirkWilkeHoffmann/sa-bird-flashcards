"use strict";

const STATS_KEY = "sabirds.stats.v1";
const $ = (id) => document.getElementById(id);

let species = [];
let stats = loadStats();      // { [speciesId]: { right, wrong } }
let current = null;
let photoIndex = 0;
let session = { right: 0, seen: 0 };

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }
  catch { return {}; }
}

function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* private mode */ }
}

// Birds you've missed come up more often; birds you know well come up less.
function weight(s) {
  const st = stats[s.id];
  if (!st) return 2;
  return Math.max(0.3, 1 + st.wrong * 2 - st.right * 0.5);
}

function pickSpecies() {
  const weights = species.map((s) => (current && s.id === current.id ? 0 : weight(s)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < species.length; i++) {
    r -= weights[i];
    if (r <= 0) return species[i];
  }
  return species[species.length - 1];
}

function showPhoto() {
  const photo = current.photos[photoIndex];
  $("loading").hidden = false;
  $("photo").style.visibility = "hidden";
  $("photo").src = photo.url;
  $("credit").textContent = photo.attr;
  $("otherPhoto").disabled = current.photos.length < 2;
}

function nextCard() {
  current = pickSpecies();
  photoIndex = Math.floor(Math.random() * current.photos.length);
  showPhoto();
  $("answer").hidden = true;
  $("grade").hidden = true;
  $("ask").hidden = false;
  // Warm the cache for a likely next image.
  const peek = species[Math.floor(Math.random() * species.length)];
  new Image().src = peek.photos[0].url;
}

function reveal() {
  $("name").textContent = current.name;
  $("sci").textContent = current.sci;
  $("family").textContent = current.familyName
    ? `${current.familyName} (${current.family})`
    : current.family || "";
  $("answer").hidden = false;
  $("ask").hidden = true;
  $("grade").hidden = false;
}

function grade(correct) {
  const st = stats[current.id] || { right: 0, wrong: 0 };
  correct ? st.right++ : st.wrong++;
  stats[current.id] = st;
  saveStats();
  session.seen++;
  if (correct) session.right++;
  $("score").textContent = `${session.right} / ${session.seen}`;
  nextCard();
}

$("photo").addEventListener("load", () => {
  $("loading").hidden = true;
  $("photo").style.visibility = "visible";
});
$("photo").addEventListener("error", () => {
  $("loading").textContent = "Photo failed to load — tap Another photo";
});
$("otherPhoto").addEventListener("click", () => {
  photoIndex = (photoIndex + 1) % current.photos.length;
  showPhoto();
});
$("reveal").addEventListener("click", reveal);
$("gotIt").addEventListener("click", () => grade(true));
$("missed").addEventListener("click", () => grade(false));

fetch("data/species.json")
  .then((r) => r.json())
  .then((data) => {
    species = data;
    nextCard();
  })
  .catch(() => {
    $("loading").textContent = "Could not load bird data. Check your connection.";
  });
