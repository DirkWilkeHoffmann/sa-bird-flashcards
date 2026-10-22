"use strict";

const STATS_KEY = "sabirds.stats.v1";
const SETTINGS_KEY = "sabirds.settings.v1";
const HIDDEN_KEY = "sabirds.hiddenPhotos.v1";
const COUNTRY_NAMES = {
  ZA: "South Africa", NA: "Namibia", BW: "Botswana", ZW: "Zimbabwe",
  MZ: "Mozambique", LS: "Lesotho", SZ: "Eswatini",
};
const LEVEL_NAMES = { beginner: "Beginner", easy: "Easy", medium: "Medium", hard: "Hard" };
const BEGINNER_COUNT = 50;  // Beginner = the 50 most-recorded birds in the chosen place
const PREFETCH = 3;
const $ = (id) => document.getElementById(id);
// The Dev build is published at …/dev/ on the same site as the main app. It keeps its own
// saved data (progress, settings, downloads) so testing never touches the real app.
const IS_DEV = location.pathname.includes("/dev/");
const storeKey = (key) => (IS_DEV ? key.replace(/^sabirds\./, "sabirds-dev.") : key);

let species = [];
let stats = load(STATS_KEY, {});   // { [speciesId]: { right, wrong, hint, streak, seen, updated } }
let settings = { mode: "mixed", levels: [], countries: [], area: "", near: null, ...load(SETTINGS_KEY, {}) };
let areas = { areas: [], birds: {} };  // named birding areas and their bird lists
let areaSets = {};                      // area id -> Set of bird ids
let nearSet = null;                     // bird ids recorded near settings.near
let queue = [];                     // upcoming cards, prefetched
let card = null;                    // { s, kind, photos, callIndex }
let session = { right: 0, seen: 0 };
let hiddenPhotos = new Set(load(HIDDEN_KEY, []));  // photos reported as bad (e.g. a dead bird)
// The owner's final say on flagged photos (from the review emails), kept for offline use.
let photoDecisions = load("sabirds.photoDecisions.v1", { removed: [], kept: [] });

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(storeKey(key))) ?? fallback; }
  catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(storeKey(key), JSON.stringify(value)); } catch { /* private mode */ }
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const photoUrl = (p, size) => `${p.base}/${size}.${p.ext}`;

/* ---------- Study set ---------- */

function inSet(s) {
  return placeOk(s) && levelOk(s);
}

function levelOk(s) {
  if (!settings.levels.length) return true;
  if (settings.levels.includes(s.level)) return true;
  return settings.levels.includes("beginner") && beginnerIds().has(s.id);
}

// The most-recorded birds for the chosen place: a named area uses its own record counts,
// anywhere else (near me, countries, everywhere) uses records across the whole region.
let beginnerCache = { key: null, ids: new Set() };
function beginnerIds() {
  const key = JSON.stringify([settings.area, settings.near, settings.countries, settings.mode, settings.family, species.length]);
  if (beginnerCache.key !== key) {
    const byId = new Map(species.map((x) => [x.id, x]));
    const ranked = settings.area && settings.area !== "near" && areas.birds[settings.area]
      ? areas.birds[settings.area].map((id) => byId.get(id)).filter(Boolean)
      : [...species].sort((x, y) => y.obs - x.obs);
    beginnerCache = { key, ids: new Set(ranked.filter(placeOk).slice(0, BEGINNER_COUNT).map((x) => x.id)) };
  }
  return beginnerCache.ids;
}

// Every filter except the level.
function placeOk(s) {
  if (settings.countries.length && !s.countries.some((c) => settings.countries.includes(c))) return false;
  if (settings.mode === "call" && !s.calls.length) return false;
  if (typeof offlineAvailable === "function" && !offlineAvailable(s)) return false;
  if (settings.family && s.family !== settings.family) return false;
  if (settings.area === "near" && nearSet && !nearSet.has(s.id)) return false;
  if (settings.area && settings.area !== "near" && areaSets[settings.area] && !areaSets[settings.area].has(s.id)) return false;
  return true;
}

function pool() {
  const list = species.filter(inSet);
  return list.length ? list : species;
}

function summary() {
  const parts = [];
  if (settings.family) parts.push(species.find((s) => s.family === settings.family)?.familyName || settings.family);
  parts.push(settings.levels.length ? settings.levels.map((l) => LEVEL_NAMES[l]).join("+") : "All levels");
  if (settings.area === "near") parts.push("Near me");
  else if (settings.area) parts.push(areas.areas.find((a) => a.id === settings.area)?.name || "");
  if (settings.countries.length) parts.push(settings.countries.join(", "));
  parts.push({ mixed: "Mixed", photo: "Photos", call: "Calls" }[settings.mode]);
  return parts.join(" · ");
}

/* ---------- Choosing cards ---------- */

// Birds you've missed come up more often; birds you know well come up less.
function weight(s) {
  const st = stats[s.id];
  if (!st) return 2;
  return Math.max(0.3, 1 + st.wrong * 2 + (st.hint || 0) - st.right * 0.5);
}

function pickSpecies(exclude) {
  const list = pool().filter((s) => !exclude.has(s.id));
  const from = list.length ? list : pool();
  const weights = from.map(weight);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < from.length; i++) {
    r -= weights[i];
    if (r <= 0) return from[i];
  }
  return from[from.length - 1];
}

function makeCard(exclude) {
  const s = pickSpecies(exclude);
  // Offline, a card only uses the photos and call that were downloaded.
  const view = typeof offlineView === "function" ? offlineView(s) : null;
  const allPhotos = view ? view.photos : s.photos;
  // While xeno-canto is failing, only recordings from other sources (iNaturalist) are used.
  const allCalls = view ? view.calls : s.calls;
  const working = xenoFailing() ? allCalls.filter((c) => !isXeno(c)) : allCalls;
  const calls = working.length ? working : allCalls;
  const canCall = working.length > 0;
  const kind = settings.mode === "photo" || !canCall ? "photo"
    : settings.mode === "call" ? "call"
    : Math.random() < 0.5 ? "call" : "photo";
  // Start the carousel at a random photo so repeats look different.
  const start = Math.floor(Math.random() * allPhotos.length);
  const photos = [...allPhotos.slice(start), ...allPhotos.slice(0, start)];
  const c = { s, kind, photos, calls, callIndex: Math.floor(Math.random() * Math.max(1, calls.length)) };
  // Warm the cache: first photo and info of each upcoming card.
  new Image().src = photoUrl(photos[0], "medium");
  loadInfo(s);
  loadWiki(s);
  return c;
}

function fillQueue() {
  while (queue.length < PREFETCH) {
    const exclude = new Set([card?.s.id, ...queue.map((c) => c.s.id)]);
    queue.push(makeCard(exclude));
  }
}

// Three look-alikes: known mix-ups first, then same genus, family, order, anything.
function similar(target) {
  const picked = shuffle(target.similar.map((x) => x.s)).slice(0, 3);
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

/* ---------- Reporting bad photos ---------- */

function hidePhoto() {
  const p = card.photos[slideIndex];
  if (!p || card.photos.length < 2) return;
  if (!confirm("Hide this photo? It won't be shown again.")) return;
  hiddenPhotos.add(p.id);
  save(HIDDEN_KEY, [...hiddenPhotos]);
  noteHidden(p.id, card.s.id);
  reportPhoto(p, card.s);
  card.s.photos = card.s.photos.filter((x) => x.id !== p.id);
  card.photos = card.photos.filter((x) => x.id !== p.id);
  const at = Math.min(slideIndex, card.photos.length - 1);
  buildCarousel(card.photos);
  carousel.scrollLeft = at * carousel.clientWidth;
  onSlide(at);
}

/* ---------- Photo carousel with pinch zoom ---------- */

const carousel = $("carousel");
let slideIndex = 0;

function buildCarousel(photos) {
  carousel.replaceChildren();
  $("dots").replaceChildren();
  photos.forEach((p, i) => {
    const slide = document.createElement("div");
    slide.className = "slide";
    const img = document.createElement("img");
    img.alt = "Bird photo";
    img.draggable = false;
    img.dataset.i = i;
    const spin = document.createElement("span");
    spin.className = "spinner";
    spin.textContent = "Loading…";
    img.addEventListener("load", () => {
      spin.hidden = true;
      if (Number(img.dataset.i) === slideIndex) upgrade(img, p);
    });
    slide.append(spin, img);
    carousel.append(slide);
    $("dots").append(document.createElement("span"));
  });
  carousel.scrollLeft = 0;
  slideIndex = 0;
  $("dots").hidden = photos.length < 2;
  $("flag").hidden = photos.length < 2;
  onSlide(0);
}

function loadSlide(i) {
  const img = carousel.children[i]?.querySelector("img");
  if (img && !img.getAttribute("src")) img.src = photoUrl(card.photos[i], "medium");
}

// Show the small photo fast, then swap in the sharp one once it has arrived.
function upgrade(img, p) {
  if (img.dataset.large) return;
  img.dataset.large = "1";
  const big = new Image();
  big.onload = () => { img.src = big.src; };
  big.src = photoUrl(p, "large");
}

function onSlide(i) {
  slideIndex = i;
  [...$("dots").children].forEach((d, j) => d.classList.toggle("on", j === i));
  loadSlide(i);
  loadSlide(i + 1);
  loadSlide(i - 1);
  const img = carousel.children[i]?.querySelector("img");
  if (img?.complete && img.naturalWidth) upgrade(img, card.photos[i]);
}

carousel.addEventListener("scroll", () => {
  const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
  if (i !== slideIndex) { resetZoom(); onSlide(i); }
}, { passive: true });

const zoom = { scale: 1, x: 0, y: 0, img: null, start: null, lastTap: 0 };

function applyZoom() {
  if (zoom.img) zoom.img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  carousel.classList.toggle("zoomed", zoom.scale > 1.01);
}

function clampZoom() {
  const w = carousel.clientWidth, h = carousel.clientHeight;
  zoom.x = Math.min(0, Math.max(w - w * zoom.scale, zoom.x));
  zoom.y = Math.min(0, Math.max(h - h * zoom.scale, zoom.y));
}

function resetZoom() {
  if (zoom.img) zoom.img.style.transform = "";
  Object.assign(zoom, { scale: 1, x: 0, y: 0, img: null, start: null });
  carousel.classList.remove("zoomed");
}

function point(t) {
  const r = carousel.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

carousel.addEventListener("touchstart", (e) => {
  const img = carousel.children[slideIndex]?.querySelector("img");
  if (!img) return;
  if (zoom.img !== img) { resetZoom(); zoom.img = img; }
  const ts = [...e.touches].map(point);
  if (ts.length === 2) {
    const mid = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
    zoom.start = { dist: Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y), mid,
                   scale: zoom.scale, x: zoom.x, y: zoom.y };
    carousel.classList.add("zoomed");
  } else if (ts.length === 1) {
    const now = Date.now();
    if (now - zoom.lastTap < 300) {           // double-tap toggles zoom
      if (zoom.scale > 1.01) { resetZoom(); zoom.img = img; }
      else {
        zoom.scale = 2.5;
        zoom.x = ts[0].x - ts[0].x * 2.5;
        zoom.y = ts[0].y - ts[0].y * 2.5;
        clampZoom();
      }
      applyZoom();
      zoom.lastTap = 0;
      e.preventDefault();
      return;
    }
    zoom.lastTap = now;
    zoom.start = { pan: ts[0], x: zoom.x, y: zoom.y };
  }
}, { passive: false });

carousel.addEventListener("touchmove", (e) => {
  if (!zoom.start) return;
  const ts = [...e.touches].map(point);
  if (ts.length === 2 && zoom.start.dist) {
    e.preventDefault();
    const dist = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
    const mid = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
    const st = zoom.start;
    zoom.scale = Math.min(5, Math.max(1, st.scale * dist / st.dist));
    const k = zoom.scale / st.scale;
    zoom.x = mid.x - (st.mid.x - st.x) * k;
    zoom.y = mid.y - (st.mid.y - st.y) * k;
    clampZoom();
    applyZoom();
  } else if (ts.length === 1 && zoom.scale > 1.01 && zoom.start.pan) {
    e.preventDefault();
    zoom.x = zoom.start.x + ts[0].x - zoom.start.pan.x;
    zoom.y = zoom.start.y + ts[0].y - zoom.start.pan.y;
    clampZoom();
    applyZoom();
  }
}, { passive: false });

carousel.addEventListener("touchend", (e) => {
  if (e.touches.length === 1 && zoom.scale > 1.01) {
    zoom.start = { pan: point(e.touches[0]), x: zoom.x, y: zoom.y };
  } else if (!e.touches.length) {
    zoom.start = null;
    if (zoom.scale <= 1.01) resetZoom();
  }
});

/* ---------- Calls ---------- */

function showCall() {
  const call = card.calls[card.callIndex];
  stopAudio();
  $("sound").hidden = false;
  $("soundType").textContent = call.type;
  $("otherCall").hidden = card.calls.length < 2;
  $("audio").src = call.url;
}

// Calls come from xeno-canto and iNaturalist. When a recording won't load (e.g. xeno-canto
// is down), the next one is tried automatically, and xeno-canto is avoided for a while.
const XENO_RETRY_MS = 30 * 60 * 1000;
const XENO_KEY = "sabirds.xenoFailedAt.v1";
let xenoFailedAt = load(XENO_KEY, 0);
const isXeno = (c) => c.url.includes("xeno-canto.org");
const xenoFailing = () => Date.now() - xenoFailedAt < XENO_RETRY_MS;

// Try the next recording of this bird, preferring other sources than the one that failed.
function nextWorkingCall() {
  card.tried ??= new Set();
  card.tried.add(card.callIndex);
  const order = card.calls.map((c, i) => i).filter((i) => !card.tried.has(i));
  order.sort((x, y) => isXeno(card.calls[x]) - isXeno(card.calls[y]));
  return order.length ? order[0] : -1;
}

function onCallError() {
  const failed = card.calls[card.callIndex];
  if (failed && isXeno(failed) && navigator.onLine) {
    xenoFailedAt = Date.now();
    save(XENO_KEY, xenoFailedAt);
  }
  const next = nextWorkingCall();
  if (next < 0) { callFailed(); return; }
  card.callIndex = next;
  const audio = $("audio");
  $("soundType").textContent = card.calls[next].type;
  audio.src = card.calls[next].url;
  if (card.wantPlay) audio.play().catch(() => {});
}

function callFailed() {
  $("soundType").textContent = "None of this bird's recordings will load right now (the sound libraries may be down). Tap Reveal to see the answer.";
  $("hearCall").textContent = "Call unavailable right now";
  $("play").classList.remove("playing");
  $("play").textContent = "▶";
}

function playCall() {
  const audio = $("audio");
  const url = card.calls[card.callIndex].url;
  if (audio.getAttribute("src") !== url) audio.src = url;
  card.wantPlay = audio.paused;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stopAudio() {
  const audio = $("audio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/* ---------- Card flow ---------- */

// Skip a bird without scoring it: swipe the card up, or tap Skip.
let skipped = null;
let toastTimer = null;

function skipCard() {
  const media = $("media");
  skipped = card;
  media.classList.add("fly-up");
  setTimeout(() => {
    nextCard();
    media.classList.remove("fly-up");
    showToast();
  }, 220);
}

// "Bird skipped · Undo" for a few seconds (without naming the bird).
function showToast() {
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  $("toast").hidden = true;
  clearTimeout(toastTimer);
}

function undoSkip() {
  if (!skipped) return;
  const back = { ...skipped, tried: undefined, wantPlay: false };
  queue.unshift(back, card);  // the skipped bird again, then the one that replaced it
  skipped = null;
  hideToast();
  nextCard();
}

let swipe = null;
$("media").addEventListener("touchstart", (e) => {
  swipe = e.touches.length === 1 && zoom.scale <= 1.01 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
$("media").addEventListener("touchend", (e) => {
  if (!swipe || e.touches.length) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  swipe = null;
  if (dy < -70 && Math.abs(dx) < Math.abs(dy) / 2) skipCard();
}, { passive: true });

function setPanels({ ask = false, grade = false, after = false, choices = false }) {
  $("ask").hidden = !ask;
  $("grade").hidden = !grade;
  $("after").hidden = !after;
  $("choices").hidden = !choices;
}

function nextCard() {
  stopAudio();
  resetZoom();
  fillQueue();
  card = queue.shift();
  card.calls ??= card.s.calls;
  fillQueue();
  $("card").classList.remove("revealed");
  $("media").style.flexBasis = "";
  $("info").hidden = true;
  $("info").scrollTop = 0;
  buildCarousel(card.photos);
  $("sound").hidden = true;
  if (card.kind === "call") showCall();
  setPanels({ ask: true });
}

function credit(attr) {
  // "(c) Jane Doe, some rights reserved (CC BY-NC), uploaded by ..." -> "Jane Doe (CC BY-NC)"
  const m = attr.match(/^\(c\)\s*([^,]+).*?\(([^)]+)\)/i);
  return m ? `${m[1].trim()} (${m[2]})` : attr;
}

function showInfo(result) {
  const s = card.s;
  $("name").textContent = s.name;
  $("sci").textContent = s.sci;
  $("family").textContent = s.familyName ? `${s.familyName} (${s.family})` : s.family || "";
  const tags = [`<span class="level-${s.level}">${LEVEL_NAMES[s.level]}</span>`,
    ...s.countries.map((c) => `<span>${COUNTRY_NAMES[c]}</span>`)];
  $("tags").innerHTML = tags.join("");
  $("hearCall").hidden = card.calls.length === 0;
  $("details").replaceChildren();
  if (result) {
    const p = document.createElement("p");
    p.className = `result ${result.ok ? "good" : "bad"}`;
    p.textContent = result.message
      || (result.ok ? "✓ Correct!" : `✗ You picked ${result.picked}`);
    $("details").append(p);
  }
  if (window.renderDetails) window.renderDetails(s, $("details"));
  const photoCredits = [...new Set(s.photos.map((p) => credit(p.attr)))].join("; ");
  const call = card.calls[card.callIndex];
  $("credits").textContent = `Photos via iNaturalist: ${photoCredits}.`
    + (call ? ` Recording: ${call.attr}.` : "");
  // Learn both ways: call cards now show the photos.
  $("sound").hidden = true;
  resetZoom();
  $("card").classList.add("revealed");
  $("info").hidden = false;
  $("info").scrollTop = 0; // only works once visible: always open at the name
  $("media").style.flexBasis = "";
  recentre();
}

// Scrolling the info panel shrinks the photo, so the text and map get the whole screen.
$("info").addEventListener("scroll", () => {
  if (!$("card").classList.contains("revealed")) return;
  const full = $("card").clientHeight * 0.38;
  $("media").style.flexBasis = `${Math.max(0, full - $("info").scrollTop)}px`;
}, { passive: true });

// The photo area changes size on reveal and on rotation; keep the current photo in view.
function recentre() {
  requestAnimationFrame(() => { carousel.scrollLeft = slideIndex * carousel.clientWidth; });
}
window.addEventListener("resize", () => { resetZoom(); recentre(); });

function reveal() {
  showInfo();
  setPanels({ grade: true });
}

// "What kind of bird": the last word of the English name, so Blacksmith Lapwing -> Lapwing.
// Capitalised compounds use their last part (Fish-Eagle -> Eagle); Bee-eater, White-eye stay whole.
const KIND_ALIASES = {
  "Sugar-bird": "Sugarbird", "Rock-jumper": "Rockjumper", "Widow-bird": "Widowbird",
  Loerie: "Turaco", Lourie: "Turaco", Dikkop: "Thick-knee", Neddicky: "Cisticola", Bokmakierie: "Bushshrike",
  Mallard: "Duck", Shoveler: "Duck", Pochard: "Duck", Shelduck: "Duck", Stonechat: "Chat", Whinchat: "Chat",
  Chaffinch: "Finch", Quailfinch: "Finch", Vleiloerie: "Coucal", Rockjumper: "Rockjumper",
};

function kindOf(s) {
  const last = s.name.split(" ").pop();
  if (KIND_ALIASES[last]) return KIND_ALIASES[last];
  const tail = last.split("-").pop();
  return /^[A-Z]/.test(tail) ? tail : last;
}

function choiceButtons(prompt, options, label, onPick) {
  const box = $("choices");
  box.replaceChildren();
  const p = document.createElement("p");
  p.className = "prompt";
  p.textContent = prompt;
  box.append(hintTools(), p);
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label(o);
    b.addEventListener("click", () => onPick(o, b));
    box.append(b);
  }
  setPanels({ choices: true });
}

// Extra clues while guessing: the call (on photo cards), a photo (on call cards) and the range.
function hintTools() {
  const row = document.createElement("div");
  row.className = "hint-tools";
  const add = (label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    row.append(b);
  };
  if (card.kind === "photo" && card.calls.length) add("▶ Hear call", playCall);
  if (card.kind === "call" && !$("sound").hidden) add("📷 Show photo", (e) => { $("sound").hidden = true; e.target.remove(); });
  add("🗺 Show range", showRangeHint);
  return row;
}

async function showRangeHint() {
  const [info, map] = await Promise.all([loadInfo(card.s), loadMap()]);
  const body = $("rangeHintBody");
  body.replaceChildren();
  if (info && map && info.cells.length) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "Where this bird has been recorded — brighter means more records.";
    body.append(rangeMap(map, info.cells), note);
    if (info.months.some(Boolean)) body.append(monthChart(info.months));
  } else {
    body.textContent = "No range data for this bird (offline?).";
  }
  $("rangeHint").showModal();
}

// Step 1: guess the kind of bird until right. Distractors get harder: same family, same order, anything.
function hint() {
  const kind = kindOf(card.s);
  const others = [];
  const tiers = [(s) => s.family === card.s.family, (s) => s.order === card.s.order, () => true];
  for (const inTier of tiers) {
    const kinds = shuffle([...new Set(species.filter(inTier).map(kindOf))])
      .filter((k) => k !== kind && !others.includes(k));
    if (kinds.length) others.push(kinds[0]);
  }
  while (others.length < 3) {
    const k = kindOf(species[Math.floor(Math.random() * species.length)]);
    if (k !== kind && !others.includes(k)) others.push(k);
  }
  choiceButtons("What kind of bird is it?", shuffle([kind, ...others]), (k) => k, (k, b) => {
    if (k !== kind) { b.classList.add("wrong"); b.disabled = true; return; }
    b.classList.add("correct");
    for (const other of $("choices").querySelectorAll("button")) other.disabled = true;
    setTimeout(() => whichOne(kind), 600);
  });
}

// Step 2: which bird of that kind. Fill up with look-alikes if the kind has fewer than four birds.
function whichOne(kind) {
  const same = shuffle(species.filter((s) => s !== card.s && kindOf(s) === kind)).slice(0, 3);
  if (!same.length) { choose(card.s, "✓ Correct!"); return; }
  const fill = similar(card.s).filter((s) => !same.includes(s)).slice(0, 3 - same.length);
  choiceButtons(`Which ${kind}?`, shuffle([card.s, ...same, ...fill]), (s) => s.name, (s) => choose(s));
}

function choose(chosen, message) {
  const ok = chosen === card.s;
  record("wrong", ok ? null : chosen); // any answer that needed a hint counts as a miss
  showInfo({ ok, picked: chosen.name, message });
  setPanels({ after: true });
}

// Mastered = right MASTERED_STREAK times in a row without a hint (see progress.js).
function record(result, picked) {
  const st = stats[card.s.id] || { right: 0, wrong: 0, hint: 0, streak: 0 };
  st[result] = (st[result] || 0) + 1;
  st.streak = result === "right" ? (st.streak || 0) + 1 : 0;
  st.seen = st.updated = new Date().toISOString();
  stats[card.s.id] = st;
  save(STATS_KEY, stats);
  if (picked) noteMixup(card.s.id, picked.id);
  markDirty(card.s.id);
  session.seen++;
  if (result === "right") session.right++;
  $("score").textContent = `${session.right} / ${session.seen} 📊`;
}

/* ---------- Info: description, range map, months ---------- */

const infoCache = new Map();
let mapData = null;

function loadInfo(s) {
  if (!infoCache.has(s.id)) {
    infoCache.set(s.id, fetch(`data/info/${s.id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return infoCache.get(s.id);
}

function loadMap() {
  mapData ??= fetch("data/map.json").then((r) => r.json()).catch(() => null);
  return mapData;
}

const SVG = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function rangeMap(map, cells) {
  const { west, east, south, north } = map.bounds;
  const k = Math.cos((25 * Math.PI) / 180); // squash longitude so the region keeps its shape
  const px = (lng) => (lng - west) * k * 10;
  const py = (lat) => (north - lat) * 10;
  const svg = svgEl("svg", { viewBox: `0 0 ${px(east)} ${py(south)}`, class: "range", role: "img",
                              "aria-label": "Range map: shaded where the bird has been recorded" });
  for (const rings of Object.values(map.countries)) {
    for (const ring of rings) {
      const d = ring.map(([lng, lat], i) => `${i ? "L" : "M"}${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join("") + "Z";
      svg.append(svgEl("path", { d, class: "land" }));
    }
  }
  const size = 6.2; // ~0.6 degree cells
  for (const [lat, lng, level] of cells) {
    svg.append(svgEl("rect", { x: px(lng) - size * k / 2, y: py(lat) - size / 2, width: size * k, height: size,
                               class: `cell c${level}` }));
  }
  return svg;
}

function monthChart(months) {
  const max = Math.max(...months, 1);
  const wrap = document.createElement("div");
  wrap.className = "months";
  "JFMAMJJASOND".split("").forEach((m, i) => {
    const col = document.createElement("div");
    col.innerHTML = `<span style="height:${Math.max(3, (months[i] / max) * 100)}%"></span><b>${m}</b>`;
    wrap.append(col);
  });
  return wrap;
}

function section(title, ...children) {
  const h = document.createElement("h3");
  h.textContent = title;
  return [h, ...children];
}

const wikiCache = new Map();

// The phone asks Wikipedia directly (the service worker keeps each answer).
function loadWiki(s) {
  if (!wikiCache.has(s.id)) wikiCache.set(s.id, liveWiki(s).catch(() => null));
  return wikiCache.get(s.id);
}

const WIKI_SECTIONS = [
  ["Description", ["description", "identification", "appearance", "plumage"]],
  ["Distribution & habitat", ["distribution", "habitat", "range"]],
  ["Behaviour", ["behaviour", "behavior", "ecology"]],
  ["Diet", ["diet", "feeding", "food"]],
  ["Breeding", ["breeding", "nesting", "reproduction"]],
  ["Voice", ["voice", "call", "vocal"]],
];

// Cut at the last full sentence before `limit` characters.
function trimText(text, limit) {
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > limit / 3 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

async function wikiExtract(title) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1", prop: "extracts",
    explaintext: "1", exsectionformat: "wiki", titles: title, origin: "*",
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  const page = (await r.json()).query?.pages?.[0];
  return page && !page.missing && page.extract ? page : null;
}

async function liveWiki(s) {
  const title = decodeURIComponent((s.wiki || "").split("/wiki/").pop() || "").replace(/_/g, " ");
  const page = (title && await wikiExtract(title)) || await wikiExtract(s.name);
  if (!page) return null;
  const parts = ("\n" + page.extract).split(/\n==\s*([^=\n]+?)\s*==\n/);
  const found = [];
  for (let i = 1; i < parts.length; i += 2) {
    found.push([parts[i], parts[i + 1].replace(/\n=+\s*[^=\n]+?\s*=+\n/g, "\n")]);
  }
  const used = new Set();
  const sections = [];
  for (const [ours, words] of WIKI_SECTIONS) {
    const hit = found.find(([h, body]) => !used.has(h) && body.trim() && words.some((w) => h.toLowerCase().includes(w)));
    if (hit) { used.add(hit[0]); sections.push({ h: ours, text: trimText(hit[1], 900) }); }
  }
  return {
    title: page.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    intro: trimText(parts[0], 700),
    sections,
  };
}

const para = (text) => {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
};

window.renderDetails = async (s, el) => {
  const [info, wiki, map] = await Promise.all([loadInfo(s), loadWiki(s), loadMap()]);
  if (card?.s !== s) return;
  const wikiSection = (h) => wiki?.sections.find((x) => x.h === h);
  const about = wiki?.intro || info?.summary;
  if (about) el.append(...section("About", para(about)));
  if (wikiSection("Description")) el.append(...section("Description", para(wikiSection("Description").text)));
  if (s.similar.length || Object.keys(mixups[s.id] || {}).length) {
    el.append(...section("Easily confused with", ...lookalikes(s)));
  }
  if (map && info?.cells.length) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "Shaded where it has been recorded — brighter means more records.";
    el.append(...section("Range in Southern Africa", rangeMap(map, info.cells), note));
  }
  if (wikiSection("Distribution & habitat")) {
    el.append(...section("Distribution & habitat", para(wikiSection("Distribution & habitat").text)));
  }
  if (info?.months.some(Boolean)) el.append(...section("Records by month", monthChart(info.months)));
  for (const h of ["Behaviour", "Diet", "Breeding", "Voice"]) {
    if (wikiSection(h)) el.append(...section(h, para(wikiSection(h).text)));
  }
  const url = wiki?.url || info?.wiki;
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Read more on Wikipedia →";
    a.className = "wiki";
    el.append(a);
  }
  if (wiki) $("credits").textContent += " Text: Wikipedia (CC BY-SA 4.0).";
};

/* ---------- Easily confused with ---------- */

function lookalikes(s) {
  const grid = document.createElement("div");
  grid.className = "lookalikes";
  // Birds you picked by mistake for this one come first, then the known look-alikes.
  const mine = Object.entries((typeof mixups !== "undefined" && mixups[s.id]) || {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ s: species.find((x) => x.id === Number(id)), why: "mine", n }))
    .filter((x) => x.s);
  const list = [...mine, ...s.similar.filter((x) => !mine.some((m) => m.s === x.s))];
  for (const { s: other, why, n } of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<img alt="" loading="lazy"><span></span><small></small>`;
    b.querySelector("img").src = photoUrl(other.photos[0], "square");
    b.querySelector("span").textContent = other.name;
    b.querySelector("small").textContent = why === "mine" ? `You mixed these up ${n}×`
      : why === "mixup" ? "Often mixed up" : "Close relative";
    b.addEventListener("click", () => openCompare(s, other));
    grid.append(b);
  }
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "Tap one to compare side by side.";
  return [grid, note];
}

function compareColumn(s) {
  const col = document.createElement("div");
  col.className = "col";
  let i = 0;
  const img = document.createElement("img");
  img.alt = s.name;
  img.src = photoUrl(s.photos[0], "medium");
  img.addEventListener("click", () => { i = (i + 1) % s.photos.length; img.src = photoUrl(s.photos[i], "medium"); });
  const name = document.createElement("h3");
  name.textContent = s.name;
  const sci = document.createElement("p");
  sci.className = "sci";
  sci.textContent = s.sci;
  const text = document.createElement("p");
  text.className = "desc";
  text.textContent = "…";
  loadWiki(s).then((w) => {
    const d = w?.sections.find((x) => x.h === "Description")?.text || w?.intro || "";
    text.textContent = trimText(d, 420);
  });
  col.append(img, name, sci);
  if (s.calls.length) {
    const audio = new Audio();
    audio.preload = "none";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn ghost small";
    play.textContent = "▶ Call";
    play.addEventListener("click", () => {
      document.querySelectorAll("#compare audio, audio").forEach((a) => a !== audio && a.pause());
      if (!audio.src) audio.src = s.calls[0].url;
      audio.paused ? audio.play().catch(() => {}) : audio.pause();
    });
    audio.addEventListener("play", () => { play.textContent = "❚❚ Pause"; });
    audio.addEventListener("pause", () => { play.textContent = "▶ Call"; });
    col.append(audio, play);
  }
  col.append(text);
  return col;
}

function openCompare(a, b) {
  $("audio").pause();
  const body = $("compareBody");
  body.replaceChildren(compareColumn(a), compareColumn(b));
  $("compare").showModal();
}

$("compare").addEventListener("close", () => $("compare").querySelectorAll("audio").forEach((a) => a.pause()));

/* ---------- Where: named areas and near me ---------- */

const NEAR_KM = 50;
let nearData = null;

function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Birds whose range cells (~0.6 degree squares) lie within NEAR_KM of the point.
async function computeNear(near) {
  nearData ??= fetch("data/near.json").then((r) => r.json());
  const { ids, cells } = await nearData;
  const found = new Set();
  for (const [key, list] of Object.entries(cells)) {
    const [lat, lng] = key.split(",").map(Number);
    if (km(near.lat, near.lng, lat, lng) <= NEAR_KM + 35) list.forEach((i) => found.add(ids[i]));
  }
  return found;
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("no geolocation")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
    );
  });
}

function fillAreaSelect() {
  const sel = $("areaSelect");
  sel.innerHTML = `<option value="">Anywhere</option><option value="near">📍 Near me (within ${NEAR_KM} km)</option>`;
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
    const list = areas.areas.filter((a) => a.country === code);
    if (!list.length) continue;
    const group = document.createElement("optgroup");
    group.label = name;
    for (const a of list) group.append(new Option(`${a.name} (${areas.birds[a.id].length})`, a.id));
    sel.append(group);
  }
}

$("areaSelect").addEventListener("change", async () => {
  if ($("areaSelect").value !== "near") return;
  $("setCount").textContent = "Finding your location…";
  nearPending = (async () => {
    pendingNear = await locate();
    nearSet = await computeNear(pendingNear);
  })();
  try {
    await nearPending;
  } catch {
    pendingNear = null;
    $("areaSelect").value = settings.area === "near" ? "near" : settings.area;
    alert("Couldn't get your location. Allow location access for this app in Settings → Privacy → Location Services → Safari Websites.");
  }
  nearPending = null;
  updateCount();
});

let pendingNear = null;

/* ---------- Settings sheet ---------- */

function openSettings() {
  const form = $("settings").querySelector("form");
  for (const el of form.elements) {
    if (el.name === "mode") el.checked = el.value === settings.mode;
    if (el.name === "level") el.checked = settings.levels.includes(el.value);
    if (el.name === "country") el.checked = settings.countries.includes(el.value);
  }
  $("areaSelect").value = settings.area || "";
  pendingNear = settings.near;
  $("familyFilter").hidden = !settings.family;
  $("familyOnly").checked = true;
  $("familyName").textContent = species.find((s) => s.family === settings.family)?.familyName || settings.family || "";
  updateCount();
  $("settings").showModal();
}

function readSettings() {
  const form = $("settings").querySelector("form");
  const values = (name) => [...form.elements].filter((el) => el.name === name && el.checked).map((el) => el.value);
  const area = $("areaSelect").value;
  return { mode: values("mode")[0] || "mixed", levels: values("level"), countries: values("country"),
           area, near: area === "near" ? pendingNear : null,
           family: $("familyOnly")?.checked ? settings.family : "" };
}

function updateCount() {
  const prev = settings;
  settings = readSettings();
  const n = species.filter(inSet).length;
  settings = prev;
  $("setCount").textContent = n ? `${n} birds in this set` : "No birds match — showing all birds";
}

$("countryChips").innerHTML = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => `<label><input type="checkbox" name="country" value="${code}"> ${name}</label>`)
  .join("");
$("settings").addEventListener("change", updateCount);
let nearPending = null;  // location lookup still running when the sheet closes

$("settings").addEventListener("close", async () => {
  if (nearPending) await nearPending.catch(() => {});
  const next = readSettings();
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  if (next.area === "near" && !next.near) next.area = "";  // location was refused
  settings = next;
  save(SETTINGS_KEY, settings);
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
});
$("openSettings").addEventListener("click", openSettings);

/* ---------- Wiring ---------- */

$("audio").addEventListener("error", () => {
  if ($("audio").getAttribute("src")) onCallError();
});
$("audio").addEventListener("play", () => {
  $("play").classList.add("playing");
  $("play").textContent = "❚❚";
  $("hearCall").textContent = "❚❚ Pause call";
});
$("audio").addEventListener("pause", () => {
  $("play").classList.remove("playing");
  $("play").textContent = "▶";
  if (!$("audio").error) $("hearCall").textContent = "▶ Hear call";
});
$("play").addEventListener("click", playCall);
$("hearCall").addEventListener("click", playCall);
$("otherCall").addEventListener("click", () => {
  card.callIndex = (card.callIndex + 1) % card.calls.length;
  showCall();
});
$("reveal").addEventListener("click", reveal);
$("hint").addEventListener("click", hint);
$("gotIt").addEventListener("click", () => { record("right"); nextCard(); });
$("missed").addEventListener("click", () => { record("wrong"); nextCard(); });
$("next").addEventListener("click", nextCard);
$("skip").addEventListener("click", skipCard);
$("undoSkip").addEventListener("click", undoSkip);
for (const id of ["reveal", "hint"]) $(id).addEventListener("click", hideToast);
$("flag").addEventListener("click", hidePhoto);

// Keep the page itself from zooming or rubber-banding; only the carousel,
// the info panel and the settings sheet may move.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => {
  if (!e.target.closest(".carousel, .info, .sheet")) e.preventDefault();
}, { passive: false });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

$("filterSummary").textContent = summary();
Promise.all([
  fetch("data/species.json").then((r) => r.json()),
  fetch("data/calls.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch("data/similar.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch("data/areas.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
])
  .then(async ([data, calls, similarData, areaData]) => {
    if (areaData) {
      areas = areaData;
      areaSets = Object.fromEntries(Object.entries(areas.birds).map(([id, list]) => [id, new Set(list)]));
    }
    if (settings.area === "near" && settings.near) nearSet = await computeNear(settings.near).catch(() => null);
    fillAreaSelect();
    species = data.map((s) => {
      const removed = new Set(photoDecisions.removed);
      const kept = new Set(photoDecisions.kept);
      const photos = s.photos.filter((p) => removed.has(p.id) ? false : kept.has(p.id) || !hiddenPhotos.has(p.id));
      return { ...s, photos: photos.length ? photos : s.photos, calls: calls[s.id] || [] };
    });
    const byId = new Map(species.map((s) => [s.id, s]));
    for (const s of species) {
      s.similar = (similarData[s.id] || [])
        .filter(([id]) => byId.has(id))
        .map(([id, why]) => ({ s: byId.get(id), why }));
    }
    $("filterSummary").textContent = summary();
    nextCard();
    startSync();
  })
  .catch(() => {
    $("carousel").textContent = "Could not load bird data. Check your connection.";
  });
