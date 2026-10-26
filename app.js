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
const icon = (name, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// The Dev build is published at …/dev/ on the same site as the main app. It keeps its own
// saved data (progress, settings, downloads) so testing never touches the real app.
const IS_DEV = location.pathname.includes("/dev/");
const storeKey = (key) => (IS_DEV ? key.replace(/^sabirds\./, "sabirds-dev.") : key);

let species = [];
let stats = load(STATS_KEY, {});   // { [speciesId]: { right, wrong, hint, streak, seen, updated } }
// First-time default: photo cards of the Beginner birds in South Africa.
let settings = { mode: "photo", levels: ["beginner"], countries: ["ZA"], area: "", near: null, ...load(SETTINGS_KEY, {}) };
// The short-lived "Learning path" level became how every level works.
if (settings.levels.includes("path")) settings.levels = ["beginner"];
// Names: English with the Afrikaans name under it, or the other way round.
const NAMES_KEY = "sabirds.names.v1";
let afFirst = load(NAMES_KEY, "en") === "af";
const nameOf = (s) => (afFirst && s.af) || s.name;
const otherNameOf = (s) => (afFirst ? (s.af ? s.name : "") : s.af || "");
function setAltName(el, s) {
  el.textContent = otherNameOf(s);
  el.lang = afFirst ? "en" : "af";
  el.hidden = !el.textContent;
}
// The answer screen's two names, with a small "?" after the Afrikaans one to suggest a better name.
function showNames(s) {
  $("name").textContent = nameOf(s);
  $("name").lang = afFirst && s.af ? "af" : "en";
  setAltName($("altName"), s);
  if (!s.af) return;
  const q = document.createElement("button");
  q.type = "button";
  q.className = "name-q";
  q.textContent = "?";
  q.setAttribute("aria-label", "Is this Afrikaans name wrong?");
  q.addEventListener("click", () => openNameSheet(s));
  (afFirst ? $("name") : $("altName")).append(q);
}
let lastGrowth = { added: 0 };  // what the last answer unlocked
const PRAISE = ["Well done!", "You're doing great!", "Nice work!", "Keep it up!"];
let areas = { areas: [], birds: {} };  // named birding areas and their bird lists
let areaSets = {};                      // area id -> Set of bird ids
let nearSet = null;                     // bird ids recorded near settings.near
let queue = [];                     // upcoming cards, prefetched
let card = null;                    // { s, kind, photos, callIndex }
let session = { right: 0, seen: 0 };
let hiddenPhotos = new Set(load(HIDDEN_KEY, []));  // photos reported as bad (e.g. a dead bird)
const SEEN_KEY = "sabirds.seenBirds.v1";
let seenBirds = new Set(load(SEEN_KEY, []));      // birds already shown on this phone (for the NEW tag)
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

// Within the chosen levels, only the birds unlocked so far (see "Progression" below).
function levelOk(s) {
  return progressive() ? pathIds().has(s.id) : levelMatch(s);
}

// The chosen levels themselves, before progression.
function levelMatch(s) {
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
    const list = ranked.filter(placeOk).slice(0, BEGINNER_COUNT).map((x) => x.id);
    beginnerCache = { key, ranked, list, ids: new Set(list) };
  }
  return beginnerCache.ids;
}

// Progression: whatever levels are chosen, you start with the 20 most common of those birds
// in the chosen place, and each next batch is bigger (5, 10, 15, 20, ...), commonest first, so
// with all levels it runs Beginner -> Easy -> Medium -> Hard. The next batch joins once 40% of
// the birds in play are mastered (right 3 times in a row). When every bird of the chosen levels
// is in play, the next level up is ticked automatically. Each choice of levels keeps its own
// progress, and it only ever grows.
const PATH_KEY = "sabirds.progression.v1";
const PATH_FIRST = 20, PATH_STEP = 5, PATH_MASTERED_SHARE = 0.4;
const LEVEL_STEPS = ["beginner", "easy", "medium", "hard"];
const LEVEL_ORDER = { easy: 1, medium: 2, hard: 3 };
const pathSizes = load(PATH_KEY, {});   // { "beginner+easy": 27, "all": 62, ... }
// Ticking every level is the same as ticking none: all birds, one shared progress.
const pathChoice = () => (settings.levels.length >= 4 ? "all" : [...settings.levels].sort().join("+") || "all");
const pathSizeOf = () => Math.max(pathSizes[pathChoice()] ?? 0, PATH_FIRST);

// A family chosen from the progress screen is a small fixed set, studied all at once.
const progressive = () => !settings.family;
const mastered = (id) => (stats[id]?.streak || 0) >= MASTERED_STREAK;

// The level after the highest one chosen (none when all levels, or Hard, are chosen).
function nextLevel() {
  if (!settings.levels.length) return null;
  const top = Math.max(...settings.levels.map((l) => LEVEL_STEPS.indexOf(l)));
  const up = LEVEL_STEPS[top + 1];
  return up && !settings.levels.includes(up) ? up : null;
}

// The chosen birds in order: this place's Beginner birds first, then Easy, Medium and Hard,
// commonest first within each.
let pathCache = { key: null, list: [] };
function pathList() {
  beginnerIds();
  const key = beginnerCache.key + pathChoice();
  if (pathCache.key !== key) {
    const first = beginnerCache.ids;
    const rank = new Map(beginnerCache.ranked.map((x, i) => [x.id, i]));
    const list = beginnerCache.ranked.filter((x) => placeOk(x) && levelMatch(x))
      .sort((a, b) => (first.has(b.id) - first.has(a.id)) || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
        || (rank.get(a.id) - rank.get(b.id)));
    pathCache = { key, list: list.map((x) => x.id) };
  }
  return pathCache.list;
}

// Where each batch starts and ends: 20, then +5, +10, +15, ...
function pathBatch(size) {
  let start = 0, end = PATH_FIRST, step = PATH_STEP;
  while (end < size) { start = end; end += step; step += PATH_STEP; }
  return { start, end, next: end + step };
}

const pathIds = () => new Set(pathList().slice(0, pathSizeOf()));

// The stage the path has reached: the level of the newest bird in it.
function pathStage(size = pathSizeOf()) {
  const list = pathList();
  const id = list[Math.min(size, list.length) - 1];
  if (beginnerCache.ids.has(id)) return "beginner";
  return species.find((x) => x.id === id)?.level || "beginner";
}

// Grow the set as far as the player has earned: after an answer one step at a time ({ once }),
// otherwise (starting up, a new place or levels) catching up in one go. Only answers move up a
// level ({ levelUp }), so unticking a level in the settings isn't undone straight away.
// Returns { added, stage, levelUp, levelAdded }.
function growPath({ once = false, levelUp = false } = {}) {
  if (!progressive() || !species.length) return { added: 0 };
  const stageBefore = pathStage();
  let added = 0, levelAdded = null;
  for (;;) {
    const list = pathList(), size = pathSizeOf();
    const inPlay = list.slice(0, size);
    if (inPlay.filter(mastered).length < Math.ceil(inPlay.length * PATH_MASTERED_SHARE)) break;
    if (size < list.length) {
      const { end, next } = pathBatch(size);
      const grown = Math.min(list.length, size === end ? next : end);
      added += grown - size;
      pathSizes[pathChoice()] = grown;
      if (once) break;
      continue;
    }
    // Every bird of these levels is in play: tick the next level, keeping the progress made.
    const up = levelUp && !levelAdded && nextLevel();
    if (!up) break;
    settings = { ...settings, levels: [...settings.levels, up] };
    save(SETTINGS_KEY, settings);
    levelAdded = up;
    pathSizes[pathChoice()] = Math.max(pathSizes[pathChoice()] ?? 0, size);
  }
  if (!added && !levelAdded) return { added: 0 };
  save(PATH_KEY, pathSizes);
  $("filterSummary").textContent = summary();
  const stage = levelAdded || pathStage();
  return { added, stage, levelAdded, levelUp: Boolean(levelAdded) || stage !== stageBefore };
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
  // With more than one level, say which level the new birds have reached.
  if (progressive() && species.length && settings.levels.length !== 1 && pathSizeOf() < pathList().length) {
    parts.push(`now ${LEVEL_NAMES[pathStage()]}`);
  }
  if (settings.area === "near") parts.push("Near me");
  else if (settings.area) parts.push(areas.areas.find((a) => a.id === settings.area)?.name || "");
  if (settings.countries.length) {
    parts.push(settings.countries.length === 1 ? COUNTRY_NAMES[settings.countries[0]] : settings.countries.join(", "));
  }
  parts.push({ mixed: "Mixed", photo: "Photos", call: "Calls" }[settings.mode]);
  return parts.join(" · ");
}

/* ---------- Choosing cards ---------- */

// How the next bird is chosen:
//  1. Right after new birds join, up to 4 of them come first, so you meet them straight away.
//  2. Otherwise 90% of cards are birds you're still learning (or haven't seen), 10% birds you've
//     mastered. Within that group, birds are drawn by weight (see weight()), so ones you miss
//     come up more often.
//  3. Birds seen in the last few cards are skipped, so none comes back too soon, and birds
//     you've hidden for a while ("Seeing this bird too often?") are left out.
const MASTERED_SHARE = 0.1;
const RECENT_MAX = 8;              // never repeat a bird within this many cards (half the set if smaller)
const INTRO_COUNT = 4;             // new birds shown in a row when a batch joins
const SNOOZE_KEY = "sabirds.snoozed.v1";
const SNOOZE_MS = 24 * 60 * 60 * 1000;
let recentIds = [];                // birds shown lately, newest last
let introIds = [];                 // just-added birds to show next
let snoozed = load(SNOOZE_KEY, {}); // { [speciesId]: hidden until (ms) }

const isSnoozed = (id) => (snoozed[id] || 0) > Date.now();

// A bird's weight: new birds 2; otherwise 1, plus 2 per wrong answer and 1 per hint, minus 0.5
// per right answer (a full 1 once the bird is mastered, so mastered birds fade out), at least 0.3.
function weight(s) {
  const st = stats[s.id];
  if (!st) return 2;
  const perRight = mastered(s.id) ? 1 : 0.5;
  return Math.max(0.3, 1 + (st.wrong || 0) * 2 + (st.hint || 0) - (st.right || 0) * perRight);
}

function drawByWeight(list) {
  const weights = list.map(weight);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function pickSpecies(exclude) {
  while (introIds.length) {
    const id = introIds.shift();
    const s = species.find((x) => x.id === id);
    if (s && inSet(s) && !exclude.has(s.id) && !isSnoozed(s.id)) return s;
  }
  const inPool = pool();
  const allowed = inPool.filter((s) => !exclude.has(s.id) && !isSnoozed(s.id));
  const usable = allowed.length ? allowed : inPool.filter((s) => !exclude.has(s.id));
  const from0 = usable.length ? usable : inPool;
  const recent = new Set(recentIds.slice(-Math.min(RECENT_MAX, Math.floor(from0.length / 2))));
  const fresh = from0.filter((s) => !recent.has(s.id));
  const from = fresh.length ? fresh : from0;
  const masteredBirds = from.filter((s) => mastered(s.id));
  const learning = from.filter((s) => !mastered(s.id));
  const group = masteredBirds.length && (!learning.length || Math.random() < MASTERED_SHARE) ? masteredBirds : learning;
  return drawByWeight(group);
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
  warmPhotos(photos.slice(0, 1));
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

// Hidden at once, with Undo; the report (email to the owner) goes out when the Undo toast goes away.
function hidePhoto() {
  const p = card.photos[slideIndex];
  if (!p || card.photos.length < 2) return;
  const c = card, s = card.s;
  const at = { s: s.photos.indexOf(p), card: c.photos.indexOf(p) };
  hiddenPhotos.add(p.id);
  save(HIDDEN_KEY, [...hiddenPhotos]);
  s.photos = s.photos.filter((x) => x.id !== p.id);
  c.photos = c.photos.filter((x) => x.id !== p.id);
  showSlides(Math.min(slideIndex, c.photos.length - 1));
  showToast("Photo hidden", {
    undo: () => {
      hiddenPhotos.delete(p.id);
      save(HIDDEN_KEY, [...hiddenPhotos]);
      s.photos.splice(at.s, 0, p);
      if (card === c) {
        c.photos.splice(at.card, 0, p);
        showSlides(at.card);
      }
    },
    commit: () => { noteHidden(p.id, s.id); reportPhoto(p, s); logEvent("flag_photo", s.id); },
  });
}

function showSlides(at) {
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
      notePhotoKept(p);
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
  // Load every photo of this bird now, so swiping through them never waits.
  photos.forEach((p, i) => loadSlide(i));
}

// Fetch photos into the phone's photo store ahead of time, a few at once.
const warmed = new Set();
function warmPhotos(photos, size = "medium") {
  for (const p of photos) {
    const url = photoUrl(p, size);
    if (warmed.has(url)) continue;
    warmed.add(url);
    const img = new Image();
    if (size === "medium") img.onload = () => notePhotoKept(p);
    img.src = url;
  }
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
  if (card.photos[i + 1]) warmPhotos([card.photos[i + 1]], "large");  // the sharp version of the next photo too
  const img = carousel.children[i]?.querySelector("img");
  if (img?.complete && img.naturalWidth) upgrade(img, card.photos[i]);
}

carousel.addEventListener("scroll", () => {
  const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
  if (i !== slideIndex) { resetZoom(); onSlide(i); }
}, { passive: true });

const zoom = { scale: 1, x: 0, y: 0, img: null, start: null, lastTap: 0, track: null };
const MAX_ZOOM = 5;

function applyZoom() {
  if (zoom.img) zoom.img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  carousel.classList.toggle("zoomed", zoom.scale > 1.01 || Boolean(zoom.start?.dist));
}

// Where the photo may sit at a given zoom: edges stay on screen; smaller than the frame = centred.
function zoomBounds(scale) {
  const w = carousel.clientWidth, h = carousel.clientHeight;
  const bx = w - w * scale, by = h - h * scale;
  return scale >= 1 ? { minX: bx, maxX: 0, minY: by, maxY: 0 } : { minX: bx / 2, maxX: bx / 2, minY: by / 2, maxY: by / 2 };
}

// While a finger is down, going past an edge or past full zoom stretches instead of stopping.
function softZoom() {
  const b = zoomBounds(zoom.scale);
  zoom.x = soften(zoom.x, b.minX, b.maxX, carousel.clientWidth);
  zoom.y = soften(zoom.y, b.minY, b.maxY, carousel.clientHeight);
}

// Fingers up: spring back inside the limits, carrying a pan's momentum.
function settleZoom(velocity = { x: 0, y: 0 }) {
  const w = carousel.clientWidth, h = carousel.clientHeight;
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
  const k = scale / zoom.scale;
  let x = w / 2 - (w / 2 - zoom.x) * k + project(velocity.x);
  let y = h / 2 - (h / 2 - zoom.y) * k + project(velocity.y);
  const b = zoomBounds(scale);
  x = Math.min(b.maxX, Math.max(b.minX, x));
  y = Math.min(b.maxY, Math.max(b.minY, y));
  animateZoom({ scale, x, y }, velocity);
}

function animateZoom(to, velocity = {}) {
  const img = zoom.img;
  animate("zoom", { scale: zoom.scale, x: zoom.x, y: zoom.y }, to, {
    velocity, response: 0.4,
    onUpdate: (v) => { if (zoom.img === img) { Object.assign(zoom, v); applyZoom(); } },
    onDone: () => { if (zoom.img === img && zoom.scale <= 1.01) { resetZoom(); zoom.img = img; } },
  });
}

function resetZoom() {
  stopAnim("zoom");
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
  stopAnim("zoom");  // catch a settling photo mid-flight
  const ts = [...e.touches].map(point);
  if (ts.length === 2) {
    const mid = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
    zoom.start = { dist: Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y), mid,
                   scale: zoom.scale, x: zoom.x, y: zoom.y };
    carousel.classList.add("zoomed");
  } else if (ts.length === 1) {
    const now = Date.now();
    if (now - zoom.lastTap < 300) {           // double-tap zooms in on that spot, or back out
      if (zoom.scale > 1.01) animateZoom({ scale: 1, x: 0, y: 0 });
      else {
        const b = zoomBounds(2.5);
        animateZoom({ scale: 2.5,
                      x: Math.min(b.maxX, Math.max(b.minX, ts[0].x - ts[0].x * 2.5)),
                      y: Math.min(b.maxY, Math.max(b.minY, ts[0].y - ts[0].y * 2.5)) });
      }
      carousel.classList.add("zoomed");
      zoom.lastTap = 0;
      zoom.start = null;
      e.preventDefault();
      return;
    }
    zoom.lastTap = now;
    zoom.start = { pan: ts[0], x: zoom.x, y: zoom.y };
    zoom.track = tracker();
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
    const raw = st.scale * dist / st.dist;
    zoom.scale = raw > MAX_ZOOM ? MAX_ZOOM + rubberband(raw - MAX_ZOOM, 2)
      : raw < 1 ? 1 - rubberband(1 - raw, 0.6) : raw;
    const k = zoom.scale / st.scale;
    zoom.x = mid.x - (st.mid.x - st.x) * k;
    zoom.y = mid.y - (st.mid.y - st.y) * k;
    softZoom();
    applyZoom();
  } else if (ts.length === 1 && zoom.scale > 1.01 && zoom.start.pan) {
    e.preventDefault();
    zoom.x = zoom.start.x + ts[0].x - zoom.start.pan.x;
    zoom.y = zoom.start.y + ts[0].y - zoom.start.pan.y;
    softZoom();
    zoom.track?.add(zoom.x, zoom.y);
    applyZoom();
  }
}, { passive: false });

carousel.addEventListener("touchend", (e) => {
  if (e.touches.length === 1 && (zoom.scale > 1.01 || zoom.start?.dist)) {
    zoom.start = { pan: point(e.touches[0]), x: zoom.x, y: zoom.y };
    zoom.track = tracker();
  } else if (!e.touches.length) {
    const wasPan = zoom.start?.pan;
    zoom.start = null;
    if (!zoom.img) return;
    if (zoom.scale > 1.01 || zoom.scale < 0.99 || zoom.x || zoom.y) settleZoom(wasPan && zoom.track ? zoom.track.velocity() : undefined);
    else resetZoom();
  }
});

/* ---------- Call buttons ---------- */
// Every call button shows what its recording is doing: idle, loading, playing (moving bars and
// how far through it is), paused, finished or unavailable. Only one recording plays at a time.
const CALL_TEXT = {
  long: { idle: "Hear call", loading: "Loading call…", playing: "Pause", paused: "Resume", ended: "Play again", failed: "Call unavailable" },
  short: { idle: "Call", loading: "Loading…", playing: "Pause", paused: "Resume", ended: "Again", failed: "Unavailable" },
  round: { idle: "Play call", loading: "Loading call", playing: "Pause call", paused: "Resume call", ended: "Play call again", failed: "Call unavailable" },
};
const callButtons = new Map();  // audio element -> its buttons

function callState(audio) {
  if (audio.dataset.failed) return "failed";
  if (!audio.paused) return audio.dataset.live ? "playing" : "loading";
  if (audio.ended) return "ended";
  return audio.currentTime > 0 ? "paused" : "idle";
}

function drawCallButton(b, state) {
  const kind = b.dataset.kind;
  const mark = state === "loading" ? '<span class="spin" aria-hidden="true"></span>'
    : state === "failed" ? "" : icon(state === "playing" ? "pause" : "play");
  const bars = state === "playing" && kind !== "round"
    ? '<span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>' : "";
  b.innerHTML = kind === "round" ? mark : `${mark}<span>${CALL_TEXT[kind][state]}</span>${bars}`;
  if (kind === "round") b.setAttribute("aria-label", CALL_TEXT.round[state]);
  b.dataset.state = state;
}

function renderCall(audio) {
  const state = callState(audio);
  const buttons = callButtons.get(audio) || new Set();
  for (const b of buttons) {
    if (!b.isConnected) { if (b.dataset.shown) buttons.delete(b); continue; }  // gone from the page
    b.dataset.shown = "1";
    if (b.dataset.state !== state) drawCallButton(b, state);
  }
  showCallProgress(audio);
  // While playing, move the progress every frame (one loop per recording).
  if (state === "playing" && !audio.dataset.ticking) {
    audio.dataset.ticking = "1";
    const tick = () => {
      if (callState(audio) !== "playing") { delete audio.dataset.ticking; return; }
      showCallProgress(audio);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function showCallProgress(audio) {
  const state = callState(audio);
  const p = state === "idle" || state === "ended" || !audio.duration ? 0 : Math.min(1, audio.currentTime / audio.duration);
  for (const b of callButtons.get(audio) || []) b.style.setProperty("--p", p.toFixed(4));
}

function bindCall(audio, button, kind) {
  button.classList.add("call-btn");
  button.dataset.kind = kind;
  delete button.dataset.state;
  if (!callButtons.has(audio)) {
    callButtons.set(audio, new Set());
    const update = (e) => {
      if (e.type === "playing") audio.dataset.live = "1";
      if (["waiting", "pause", "emptied", "loadstart"].includes(e.type)) delete audio.dataset.live;
      if (e.type === "emptied") delete audio.dataset.failed;
      if (e.type === "play") pauseOtherCalls(audio);
      // Compare's recordings have no fallback; the main player tries the next recording (onCallError).
      if (e.type === "error" && audio.getAttribute("src") && audio !== $("audio")) audio.dataset.failed = "1";
      renderCall(audio);
    };
    for (const type of ["play", "playing", "waiting", "pause", "ended", "emptied", "loadstart", "error"]) {
      audio.addEventListener(type, update);
    }
  }
  callButtons.get(audio).add(button);
  drawCallButton(button, callState(audio));  // may not be on the page yet
  renderCall(audio);
}

function pauseOtherCalls(playing) {
  for (const a of callButtons.keys()) {
    if (a === playing) continue;
    a.pause();
    if (!a.isConnected) callButtons.delete(a);  // a Compare recording no longer on screen
  }
}

// Leaving the app pauses the call; its button says Resume on return.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) for (const a of callButtons.keys()) a.pause();
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
  logEvent("call_failed", card.s.id);
  $("soundType").textContent = "None of this bird's recordings will load right now (the sound libraries may be down). Tap Reveal to see the answer.";
  $("audio").dataset.failed = "1";
  renderCall($("audio"));
}

function playCall() {
  const audio = $("audio");
  if (audio.dataset.failed) return;
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

// Skip a bird without scoring it: drag the photo up and let go (or flick it), or tap Skip.
// The card follows the finger; Undo brings the same bird back down from where it went.
let skipped = null;
let toastTimer = null;
let toastActions = null;  // { undo, commit } for the toast on screen
const cardPos = { x: 0, y: 0, r: 0, s: 1, o: 1 };

function placeCard(v = cardPos) {
  Object.assign(cardPos, v);
  const m = $("media");
  m.style.transform = cardPos.x || cardPos.y || cardPos.r || cardPos.s !== 1
    ? `translate(${cardPos.x}px, ${cardPos.y}px) rotate(${cardPos.r}deg) scale(${cardPos.s})` : "";
  m.style.opacity = cardPos.o === 1 ? "" : String(cardPos.o);
}

// How far up the card must go to leave the screen.
const offTop = () => -($("media").getBoundingClientRect().bottom + 40);

function flyAway(velocity = { x: 0, y: -1600 }) {
  logEvent("skip", card.s.id);
  skipped = card;
  const r = cardPos.x / 40;
  const gone = offTop() + 40;  // the card's bottom edge has left the screen
  let arrived = false;
  const next = () => {
    if (arrived) return;
    arrived = true;
    stopAnim("card");
    nextCard();
    showToast("Bird skipped", { undo: undoSkip });
    riseIn();
  };
  animate("card", { ...cardPos }, { x: cardPos.x + project(velocity.x) / 4, y: offTop(), r: r * 2, s: 1, o: 1 }, {
    velocity: { x: velocity.x, y: velocity.y }, response: 0.3,
    onUpdate: (v) => { placeCard(v); if (v.y <= gone) next(); },
    onDone: next,
  });
}

function skipCard() {
  if ($("ask").hidden || anims.has("card")) return;
  flyAway();
}

function showToast(text, actions = {}) {
  hideToast();  // a toast already showing is settled first
  toastActions = actions;
  $("toastText").textContent = text;
  $("undoBtn").hidden = !actions.undo;
  $("toastAction").hidden = !actions.action;
  if (actions.action) $("toastAction").textContent = actions.action.label;
  const t = $("toast");
  t.hidden = false;
  animate("toast", { y: 24, o: 0 }, { y: 0, o: 1 }, {
    response: 0.35,
    onUpdate: ({ y, o }) => { t.style.transform = `translate(-50%, ${y}px)`; t.style.opacity = String(o); },
  });
  toastTimer = setTimeout(hideToast, actions.ms || 5000);
}

// Hiding the toast without Undo makes its action final.
function hideToast() {
  clearTimeout(toastTimer);
  stopAnim("toast");
  $("toast").hidden = true;
  const a = toastActions;
  toastActions = null;
  a?.commit?.();
}

$("undoBtn").addEventListener("click", () => {
  const a = toastActions;
  toastActions = null;
  hideToast();
  a?.undo?.();
});
$("toastAction").addEventListener("click", () => {
  const a = toastActions;
  hideToast();
  a?.action?.run();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hideToast(); });

function undoSkip() {
  if (skipped) logEvent("undo_skip", skipped.s.id);
  if (!skipped) return;
  const back = { ...skipped, tried: undefined, wantPlay: false };
  queue.unshift(back, card);  // the skipped bird again, then the one that replaced it
  skipped = null;
  stopAnim("card");
  nextCard();
  placeCard({ x: 0, y: offTop(), r: 0, s: 1, o: 1 });
  animate("card", { ...cardPos }, { y: 0 }, { damping: 0.85, response: 0.4, onUpdate: placeCard });
}

let swipe = null;
$("media").addEventListener("touchstart", (e) => {
  swipe = null;
  if (e.touches.length !== 1 || zoom.scale > 1.01 || $("ask").hidden || anims.has("card")) return;
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, active: false, track: tracker() };
}, { passive: true });
$("media").addEventListener("touchmove", (e) => {
  if (!swipe) return;
  if (e.touches.length !== 1 || zoom.start?.dist) { if (swipe.active) settleCard(); swipe = null; return; }
  const t = e.touches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (!(dy < 0 && Math.abs(dy) > Math.abs(dx))) { swipe = null; return; }  // sideways = next photo
    swipe.active = true;
    swipe.x = t.clientX;
    swipe.y = t.clientY;
    return;
  }
  e.preventDefault();
  const x = t.clientX - swipe.x, y = t.clientY - swipe.y;
  swipe.track.add(x, y);
  placeCard({ x, y: y < 0 ? y : rubberband(y, $("media").clientHeight), r: x / 40, s: 1, o: 1 });
}, { passive: false });

function settleCard(velocity = { x: 0, y: 0 }) {
  animate("card", { ...cardPos }, { x: 0, y: 0, r: 0 }, { velocity, damping: 0.8, response: 0.35, onUpdate: placeCard });
}

function endSwipe() {
  if (!swipe?.active) { swipe = null; return; }
  const v = swipe.track.velocity();
  swipe = null;
  const h = $("media").clientHeight;
  if (cardPos.y + project(v.y) < -h * 0.5 && v.y < 100) flyAway(v);
  else settleCard(v);
}
$("media").addEventListener("touchend", endSwipe);
$("media").addEventListener("touchcancel", () => { if (swipe?.active) settleCard(); swipe = null; });

/* ---------- Feedback ---------- */

// A badge that pops onto the photo: "✓" for a right answer, a star when a bird becomes mastered.
function popBadge(html, cls) {
  const b = $("badge");
  b.innerHTML = html;
  b.className = `badge ${cls}`;
  b.hidden = false;
  animate("badge", { s: 0.5, o: 0 }, { s: 1, o: 1 }, {
    damping: 0.6, response: 0.35,
    onUpdate: ({ s, o }) => { b.style.transform = `translate(-50%, -50%) scale(${s})`; b.style.opacity = String(Math.min(1, o)); },
  });
}

function hideBadge() {
  stopAnim("badge");
  $("badge").hidden = true;
}

// Got it / Missed it: a moment of feedback, then the next bird rises in.
let grading = false;
function grade(result) {
  if (grading) return;
  const before = status(card.s.id);
  record(result);
  const mastered = result === "right" && before !== "mastered" && status(card.s.id) === "mastered";
  pulseScore(result === "right");
  const levelUp = lastGrowth.levelUp ? lastGrowth.stage : null;
  if (levelUp) {
    haptic([12, 60, 12, 60, 12]);
    popBadge(`⬆<small>${LEVEL_NAMES[levelUp]} birds ${lastGrowth.levelAdded ? "added" : "unlocked"}!</small>`, "star level-up");
    if (!lastGrowth.levelAdded) hideToast();  // keep the "now ticked too" explanation
  } else if (result === "right") {
    haptic(mastered ? [12, 60, 12] : 10);
    popBadge(mastered ? `★<small>Mastered</small>` : "✓", mastered ? "star" : "good");
  } else {
    haptic(10);
  }
  grading = true;
  $("grade").querySelectorAll("button").forEach((x) => { x.disabled = true; });
  setTimeout(() => {
    grading = false;
    $("grade").querySelectorAll("button").forEach((x) => { x.disabled = false; });
    nextCard();
    riseIn();
  }, levelUp ? 1800 : result === "right" ? (mastered ? 1000 : 520) : 120);
}

// The next bird comes up gently from behind.
function riseIn() {
  placeCard({ x: 0, y: 0, r: 0, s: 0.94, o: 0 });
  animate("card", { ...cardPos }, { s: 1, o: 1 }, { response: 0.35, onUpdate: placeCard });
}

function pulseScore(good) {
  const el = $("score");
  el.classList.remove("good", "bad");
  void el.offsetWidth;  // restart the colour flash
  el.classList.add(good ? "good" : "bad");
  animate("score", { s: 1.25 }, { s: 1 }, {
    damping: 0.5, response: 0.3,
    onUpdate: ({ s }) => { el.style.transform = s === 1 ? "" : `scale(${s})`; },
  });
}

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
  recentIds = [...recentIds.filter((id) => id !== card.s.id), card.s.id].slice(-RECENT_MAX * 2);
  // A bird never shown before gets a NEW tag (decided once per card, so Undo keeps it).
  card.isNew ??= !stats[card.s.id] && !seenBirds.has(card.s.id);
  seenBirds.add(card.s.id);
  save(SEEN_KEY, [...seenBirds]);
  $("newTag").hidden = !card.isNew;
  fillQueue();
  // Once this bird's photos have had a head start, fetch all of the next bird's too.
  const upcoming = queue[0];
  setTimeout(() => warmPhotos(upcoming.photos), 1500);
  stopAnim("reveal");
  stopAnim("card");
  hideBadge();
  document.body.classList.remove("titled");
  $("card").classList.remove("more-below");
  placeCard({ x: 0, y: 0, r: 0, s: 1, o: 1 });
  $("card").classList.remove("revealed");
  // The photo goes back to the top of the card for the next bird.
  if ($("media").parentElement !== $("card")) $("card").prepend($("media"));
  $("media").style.height = "";
  $("media").style.flexBasis = "";
  $("info").style.removeProperty("--rise");
  $("info").style.removeProperty("--fade");
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
  showNames(s);
  $("sci").textContent = s.sci;
  $("family").textContent = s.familyName ? `${s.familyName} (${s.family})` : s.family || "";
  const tags = [`<span class="level-${s.level}">${LEVEL_NAMES[s.level]}</span>`,
    ...s.countries.map((c) => `<span>${COUNTRY_NAMES[c]}</span>`)];
  $("tags").innerHTML = tags.join("");
  $("hearCall").hidden = card.calls.length === 0;
  $("details").replaceChildren();
  // How the guess went, as a banner above the name.
  const res = $("result");
  res.hidden = !result;
  if (result) {
    res.className = `result ${result.ok ? "good" : "bad"}`;
    res.textContent = result.message
      || (result.ok ? "✓ Correct!" : `✗ You picked ${result.picked}`);
  }
  if (window.renderDetails) window.renderDetails(s, $("details"));
  $("snooze").disabled = false;
  $("snooze").innerHTML = "Seeing this bird too often? <b>Hide it for a day</b>";
  const photoCredits = [...new Set(s.photos.map((p) => credit(p.attr)))].join("; ");
  const call = card.calls[card.callIndex];
  $("credits").textContent = `Photos via iNaturalist: ${photoCredits}.`
    + (call ? ` Recording: ${call.attr}.` : "");
  // Learn both ways: call cards now show the photos.
  $("sound").hidden = true;
  resetZoom();
  const media = $("media"), info = $("info"), cardEl = $("card");
  const wasRevealed = cardEl.classList.contains("revealed");
  const from = media.getBoundingClientRect().height;
  const to = Math.round(cardEl.clientHeight * 0.38);
  cardEl.classList.add("revealed");
  info.hidden = false;
  // The photo becomes the top of the scrolling answer, so it scrolls away with the text using
  // the phone's own scrolling (nothing changes size while you scroll).
  if (media.parentElement !== info) info.prepend(media);
  media.style.height = `${to}px`;
  info.scrollTop = 0; // only works once visible: always open at the name
  $("barTitle").textContent = nameOf(s);
  recentre();
  if (wasRevealed) return;
  // The photo shrinks smoothly to make room, and the answer rises in below it.
  animate("reveal", { h: from, y: 40, o: 0 }, { h: to, y: 0, o: 1 }, {
    response: 0.45,
    onUpdate: ({ h, y, o }) => {
      media.style.height = `${h}px`;
      info.style.setProperty("--rise", `${y}px`);
      info.style.setProperty("--fade", String(o));
    },
    onDone: () => { info.style.removeProperty("--rise"); info.style.removeProperty("--fade"); recentre(); scrollEdges(); },
  });
}

// Once the name has scrolled away, it appears small in the header (like iOS titles do), and the
// see-through toolbar gets its edge line only while there is more text underneath it.
$("info").addEventListener("scroll", () => {
  if ($("card").classList.contains("revealed")) scrollEdges();
}, { passive: true });

function scrollEdges() {
  const info = $("info");
  const revealed = $("card").classList.contains("revealed");
  const titled = revealed && $("name").getBoundingClientRect().bottom < info.getBoundingClientRect().top + 4;
  document.body.classList.toggle("titled", titled);
  $("card").classList.toggle("more-below", revealed && info.scrollHeight - info.scrollTop - info.clientHeight > 2);
}

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
    b.innerHTML = label;
    b.addEventListener("click", onClick);
    row.append(b);
    return b;
  };
  if (card.kind === "photo" && card.calls.length) bindCall($("audio"), add("", playCall), "long");
  if (card.kind === "call" && !$("sound").hidden) add(`${icon("camera")} Show photo`, (e) => { $("sound").hidden = true; e.currentTarget.remove(); });
  add(`${icon("map")} Show range`, showRangeHint);
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
  openSheet($("rangeHint"));
}

// Step 1: guess the kind of bird until right. Distractors get harder: same family, same order, anything.
function hint() {
  logEvent("hint", card.s.id);
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
    if (k !== kind) { b.classList.add("wrong"); b.disabled = true; shake(b); haptic(10); return; }
    b.classList.add("correct");
    haptic(10);
    for (const other of $("choices").querySelectorAll("button")) other.disabled = true;
    setTimeout(() => whichOne(kind), 600);
  });
}

// Step 2: which bird of that kind. Fill up with look-alikes if the kind has fewer than four birds.
function whichOne(kind) {
  const same = shuffle(species.filter((s) => s !== card.s && kindOf(s) === kind)).slice(0, 3);
  if (!same.length) { choose(card.s, "✓ Correct!"); return; }
  const fill = similar(card.s).filter((s) => !same.includes(s)).slice(0, 3 - same.length);
  choiceButtons(`Which ${kind}?`, shuffle([card.s, ...same, ...fill]), nameOf, (s, b) => {
    // Show at once whether the pick was right, then the answer.
    const ok = s === card.s;
    b.classList.add(ok ? "correct" : "wrong");
    if (!ok) {
      shake(b);
      [...$("choices").querySelectorAll("button")].find((x) => x.textContent === nameOf(card.s))?.classList.add("correct");
    }
    haptic(10);
    for (const other of $("choices").querySelectorAll("button")) other.disabled = true;
    setTimeout(() => choose(s), ok ? 450 : 900);
  });
}

function choose(chosen, message) {
  const ok = chosen === card.s;
  record("wrong", ok ? null : chosen); // any answer that needed a hint counts as a miss
  showInfo({ ok, picked: nameOf(chosen), message });
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
  logEvent("answer", card.s.id, { r: result, kind: card.kind, ...(picked ? { hint: true } : {}) });
  markDirty(card.s.id);
  session.seen++;
  if (result === "right") session.right++;
  $("score").textContent = `${session.right} / ${session.seen}`;
  const before = pathIds();
  lastGrowth = growPath({ once: true, levelUp: true });
  if (lastGrowth.added || lastGrowth.levelAdded) {
    introIds = shuffle([...pathIds()].filter((id) => !before.has(id))).slice(0, INTRO_COUNT);
  }
  if (lastGrowth.added) logEvent("batch", null, { n: lastGrowth.added, size: pathSizeOf() });
  if (lastGrowth.levelUp) logEvent("level_up", null, { level: lastGrowth.stage, auto: Boolean(lastGrowth.levelAdded) });
  // While signed out, each win also offers to sign in, so the new birds aren't lost.
  const keep = signedOut() ? { action: { label: "Sign in", run: () => signInFrom("batch") }, ms: 7000 } : {};
  if (lastGrowth.levelAdded) {
    showToast(`You're doing great! ${LEVEL_NAMES[lastGrowth.levelAdded]} birds are now in your set too`, keep);
    queue = [];
  } else if (lastGrowth.added) {
    showToast(signedOut() ? `${lastGrowth.added} new birds unlocked! Sign in to keep them`
      : `${lastGrowth.added} new birds added — ${PRAISE[Math.floor(Math.random() * PRAISE.length)]}`, keep);
    queue = [];  // let the new birds come up soon
  } else {
    nudgeSignIn();
  }
}

// Reminders to sign in, so progress isn't lost: once after the first 10 answers on this phone,
// with every batch of new birds (above), and once a day when the app is opened.
const NUDGE_KEY = "sabirds.signInNudged.v1";
const DAILY_NUDGE_KEY = "sabirds.signInDaily.v1";
const signedOut = () => typeof authClient !== "undefined" && Boolean(authClient) && !account;
const answerCount = () => Object.values(stats).reduce((n, st) => n + (st.right || 0) + (st.wrong || 0), 0);

function signInFrom(from) {
  save("sabirds.signInFrom.v1", from);  // which reminder worked, for the dashboard
  signIn();
}

function nudgeSignIn() {
  if (!signedOut() || load(NUDGE_KEY, false) || answerCount() < 10) return;
  save(NUDGE_KEY, true);
  save(DAILY_NUDGE_KEY, new Date().toDateString());  // that's today's reminder
  showToast("Sign in to keep your progress safe", { action: { label: "Sign in", run: () => signInFrom("first") }, ms: 8000 });
}

function dailySignInNudge() {
  if (!signedOut() || answerCount() < 10) return;  // brand-new players get the 10-answer one first
  const today = new Date().toDateString();
  if (load(DAILY_NUDGE_KEY, "") === today) return;
  save(DAILY_NUDGE_KEY, today);
  const n = Object.keys(stats).filter(mastered).length;
  showToast(n ? `Welcome back! Sign in to save your ${n} mastered bird${n === 1 ? "" : "s"}`
    : "Welcome back! Sign in to keep your progress safe",
  { action: { label: "Sign in", run: () => signInFrom("daily") }, ms: 8000 });
}
// Coming back to the app (it often resumes rather than restarts) counts as opening it.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") setTimeout(dailySignInNudge, 1500);
});

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
    if (i === new Date().getMonth()) { col.className = "now"; col.title = "This month"; }
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
    b.querySelector("span").textContent = nameOf(other);
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

// A bird's photos side by side: swipe through them, or tap for the next one.
function comparePhotos(s) {
  const wrap = document.createElement("div");
  wrap.className = "cmp-photos";
  const strip = document.createElement("div");
  strip.className = "cmp-strip";
  s.photos.forEach((p, i) => {
    const img = document.createElement("img");
    img.alt = `${nameOf(s)}, photo ${i + 1}`;
    img.draggable = false;
    if (i > 0) img.loading = "lazy";
    img.src = photoUrl(p, "medium");
    strip.append(img);
  });
  const count = document.createElement("span");
  count.className = "cmp-count";
  const at = () => Math.round(strip.scrollLeft / (strip.clientWidth || 1));
  const show = () => { count.textContent = `${at() + 1} / ${s.photos.length}`; };
  strip.addEventListener("scroll", show, { passive: true });
  strip.addEventListener("click", () => {
    const next = (at() + 1) % s.photos.length;
    strip.scrollTo({ left: next * strip.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  });
  count.hidden = s.photos.length < 2;
  show();
  wrap.append(strip, count);
  return wrap;
}

function compareColumn(s) {
  const col = document.createElement("div");
  col.className = "col";
  const photos = comparePhotos(s);
  const name = document.createElement("h3");
  name.textContent = nameOf(s);
  const alt = document.createElement("p");
  alt.className = "alt-name";
  setAltName(alt, s);
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
  col.append(photos, name, alt, sci);
  if (s.calls.length) {
    const audio = new Audio();
    audio.preload = "none";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn ghost small";
    play.addEventListener("click", () => {
      if (audio.dataset.failed) return;
      if (!audio.getAttribute("src")) audio.src = s.calls[0].url;
      audio.paused ? audio.play().catch(() => {}) : audio.pause();
    });
    col.append(audio, play);
    bindCall(audio, play, "short");
  }
  // Where each bird has been recorded, side by side with the other's.
  const range = document.createElement("div");
  range.className = "cmp-range";
  Promise.all([loadInfo(s), loadMap()]).then(([info, map]) => {
    if (info && map && info.cells.length) range.append(rangeMap(map, info.cells));
    else range.textContent = "No range data";
  });
  col.append(range, text);
  return col;
}

function openCompare(a, b) {
  logEvent("compare", a.id, { with: b.id });
  $("audio").pause();
  const body = $("compareBody");
  stopCompareCalls();
  body.replaceChildren(compareColumn(a), compareColumn(b));
  openSheet($("compare"));
}

// Compare's recordings stop when it closes or shows another pair, and are forgotten.
function stopCompareCalls() {
  for (const a of $("compareBody").querySelectorAll("audio")) {
    a.pause();
    a.removeAttribute("src");
    a.load();
    callButtons.delete(a);
  }
}
$("compare").addEventListener("close", stopCompareCalls);

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
  sel.innerHTML = `<option value="">Anywhere</option><option value="near">Near me (within ${NEAR_KM} km)</option>`;
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
    if (el.name === "names") el.checked = el.value === (afFirst ? "af" : "en");
  }
  $("areaSelect").value = settings.area || "";
  pendingNear = settings.near;
  $("familyFilter").hidden = !settings.family;
  $("familyOnly").checked = true;
  $("familyName").textContent = species.find((s) => s.family === settings.family)?.familyName || settings.family || "";
  updateCount();
  openSheet($("settings"));
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
  const path = progressive() ? pathList().length : 0;
  settings = prev;
  $("setCount").textContent = !n ? "No birds match — showing all birds"
    : path && n < path ? `${n} of ${path} birds unlocked so far` : `${n} birds in this set`;
}

$("countryChips").innerHTML = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => `<label><input type="checkbox" name="country" value="${code}"> ${name}</label>`)
  .join("");
$("settings").addEventListener("change", (e) => {
  if (e.target.name !== "names") { updateCount(); return; }
  // Takes effect straight away, without changing the study set or the card.
  afFirst = e.target.value === "af";
  save(NAMES_KEY, afFirst ? "af" : "en");
  logEvent("names", null, { first: afFirst ? "af" : "en" });
  if (card && $("card").classList.contains("revealed")) {
    showNames(card.s);
    $("barTitle").textContent = nameOf(card.s);
  }
});
let nearPending = null;  // location lookup still running when the sheet closes

$("settings").addEventListener("close", async () => {
  if (nearPending) await nearPending.catch(() => {});
  const next = readSettings();
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  if (next.area === "near" && !next.near) next.area = "";  // location was refused
  settings = next;
  save(SETTINGS_KEY, settings);
  growPath();  // a new place has its own most-common birds; catch up on those you know
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
});
/* ---------- Suggest a better Afrikaans name ---------- */

let nameFor = null;
function openNameSheet(s) {
  nameFor = s;
  $("nameNow").textContent = s.af;
  $("nameBird").textContent = s.name;
  $("nameSuggest").value = "";
  $("nameNote").value = "";
  $("nameSend").disabled = true;
  openSheet($("nameSheet"));
}
$("nameSheet").addEventListener("input", () => {
  $("nameSend").disabled = !$("nameSuggest").value.trim() && !$("nameNote").value.trim();
});
$("nameSuggest").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();  // Enter sends instead of closing the sheet
  if (!$("nameSend").disabled) $("nameSend").click();
});
$("nameSend").addEventListener("click", () => {
  reportName(nameFor, $("nameSuggest").value.trim(), $("nameNote").value.trim());
  logEvent("name_report", nameFor.id);
  haptic(10);
  closeSheet($("nameSheet"));
  showToast("Thanks! We'll take a look.");
});

$("openSettings").addEventListener("click", openSettings);
$("setLine").addEventListener("click", openSettings);

/* ---------- Wiring ---------- */

$("audio").addEventListener("error", () => {
  if ($("audio").getAttribute("src")) onCallError();
});
bindCall($("audio"), $("play"), "round");
bindCall($("audio"), $("hearCall"), "long");
$("play").addEventListener("click", playCall);
$("hearCall").addEventListener("click", playCall);
$("otherCall").addEventListener("click", () => {
  card.callIndex = (card.callIndex + 1) % card.calls.length;
  showCall();
});
$("reveal").addEventListener("click", reveal);
$("hint").addEventListener("click", hint);
$("gotIt").addEventListener("click", () => grade("right"));
$("missed").addEventListener("click", () => grade("wrong"));
$("next").addEventListener("click", nextCard);
$("skip").addEventListener("click", skipCard);
for (const id of ["reveal", "hint"]) $(id).addEventListener("click", hideToast);
$("flag").addEventListener("click", hidePhoto);

// "Seeing this bird too often?": keep it out of the cards for a day (with Undo).
$("snooze").addEventListener("click", () => {
  const s = card.s;
  snoozed = Object.fromEntries(Object.entries(snoozed).filter(([, until]) => until > Date.now()));
  snoozed[s.id] = Date.now() + SNOOZE_MS;
  logEvent("snooze", s.id);
  save(SNOOZE_KEY, snoozed);
  queue = queue.filter((c) => c.s.id !== s.id);
  $("snooze").disabled = true;
  $("snooze").textContent = `${nameOf(s)} is hidden until tomorrow`;
  showToast(`${nameOf(s)} hidden for a day`, {
    undo: () => {
      delete snoozed[s.id];
      save(SNOOZE_KEY, snoozed);
      if (card.s === s) {
        $("snooze").disabled = false;
        $("snooze").innerHTML = "Seeing this bird too often? <b>Hide it for a day</b>";
      }
    },
  });
});

// Keep the page itself from zooming or rubber-banding; only the carousel,
// the info panel and the settings sheet may move.
// iOS only shows :active (pressed) styles when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
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
    growPath();
    $("filterSummary").textContent = summary();
    nextCard();
    logEvent("open", null, { levels: settings.levels.join("+") || "all", mode: settings.mode, offline: !navigator.onLine });
    startSync();
  })
  .catch(() => {
    $("carousel").textContent = "Could not load bird data. Check your connection.";
  });
