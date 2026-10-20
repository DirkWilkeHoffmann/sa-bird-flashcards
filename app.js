"use strict";

const STATS_KEY = "sabirds.stats.v1";
const SETTINGS_KEY = "sabirds.settings.v1";
const COUNTRY_NAMES = {
  ZA: "South Africa", NA: "Namibia", BW: "Botswana", ZW: "Zimbabwe",
  MZ: "Mozambique", LS: "Lesotho", SZ: "Eswatini",
};
const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };
const PREFETCH = 3;
const $ = (id) => document.getElementById(id);

let species = [];
let stats = load(STATS_KEY, {});   // { [speciesId]: { right, wrong, hint } }
let settings = { mode: "mixed", levels: [], countries: [], ...load(SETTINGS_KEY, {}) };
let queue = [];                     // upcoming cards, prefetched
let card = null;                    // { s, kind, photos, callIndex }
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

const photoUrl = (p, size) => `${p.base}/${size}.${p.ext}`;

/* ---------- Study set ---------- */

function inSet(s) {
  if (settings.levels.length && !settings.levels.includes(s.level)) return false;
  if (settings.countries.length && !s.countries.some((c) => settings.countries.includes(c))) return false;
  if (settings.mode === "call" && !s.calls.length) return false;
  return true;
}

function pool() {
  const list = species.filter(inSet);
  return list.length ? list : species;
}

function summary() {
  const parts = [];
  parts.push(settings.levels.length ? settings.levels.map((l) => LEVEL_NAMES[l]).join("+") : "All levels");
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
  const canCall = s.calls.length > 0;
  const kind = settings.mode === "photo" || !canCall ? "photo"
    : settings.mode === "call" ? "call"
    : Math.random() < 0.5 ? "call" : "photo";
  // Start the carousel at a random photo so repeats look different.
  const start = Math.floor(Math.random() * s.photos.length);
  const photos = [...s.photos.slice(start), ...s.photos.slice(0, start)];
  const c = { s, kind, photos, callIndex: Math.floor(Math.random() * Math.max(1, s.calls.length)) };
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
  const call = card.s.calls[card.callIndex];
  stopAudio();
  $("sound").hidden = false;
  $("soundType").textContent = call.type;
  $("otherCall").hidden = card.s.calls.length < 2;
  $("audio").src = call.url;
}

function playCall() {
  const audio = $("audio");
  const url = card.s.calls[card.callIndex].url;
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

/* ---------- Card flow ---------- */

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
  fillQueue();
  $("card").classList.remove("revealed");
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
  $("hearCall").hidden = s.calls.length === 0;
  $("details").replaceChildren();
  if (result) {
    const p = document.createElement("p");
    p.className = `result ${result.ok ? "good" : "bad"}`;
    p.textContent = result.message
      || (result.ok ? "✓ Right pick — but a hint counts as a miss" : `✗ You picked ${result.picked}`);
    $("details").append(p);
  }
  if (window.renderDetails) window.renderDetails(s, $("details"));
  const photoCredits = [...new Set(s.photos.map((p) => credit(p.attr)))].join("; ");
  const call = s.calls[card.callIndex];
  $("credits").textContent = `Photos via iNaturalist: ${photoCredits}.`
    + (call ? ` Recording: ${call.attr}.` : "");
  // Learn both ways: call cards now show the photos.
  $("sound").hidden = true;
  resetZoom();
  $("card").classList.add("revealed");
  $("info").hidden = false;
  recentre();
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
  box.append(p);
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label(o);
    b.addEventListener("click", () => onPick(o, b));
    box.append(b);
  }
  setPanels({ choices: true });
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
  if (!same.length) { choose(card.s, `✓ It's the only ${kind} — but a hint counts as a miss`); return; }
  const fill = similar(card.s).filter((s) => !same.includes(s)).slice(0, 3 - same.length);
  choiceButtons(`Which ${kind}?`, shuffle([card.s, ...same, ...fill]), (s) => s.name, (s) => choose(s));
}

function choose(chosen, message) {
  const ok = chosen === card.s;
  record("wrong"); // any answer that needed a hint counts as a miss
  showInfo({ ok, picked: chosen.name, message });
  setPanels({ after: true });
}

function record(result) {
  const st = stats[card.s.id] || { right: 0, wrong: 0, hint: 0 };
  st[result] = (st[result] || 0) + 1;
  stats[card.s.id] = st;
  save(STATS_KEY, stats);
  session.seen++;
  if (result === "right") session.right++;
  $("score").textContent = `${session.right} / ${session.seen}`;
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

function loadWiki(s) {
  if (!wikiCache.has(s.id)) {
    wikiCache.set(s.id, fetch(`data/wiki/${s.id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return wikiCache.get(s.id);
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

/* ---------- Settings sheet ---------- */

function openSettings() {
  const form = $("settings").querySelector("form");
  for (const el of form.elements) {
    if (el.name === "mode") el.checked = el.value === settings.mode;
    if (el.name === "level") el.checked = settings.levels.includes(el.value);
    if (el.name === "country") el.checked = settings.countries.includes(el.value);
  }
  updateCount();
  $("settings").showModal();
}

function readSettings() {
  const form = $("settings").querySelector("form");
  const values = (name) => [...form.elements].filter((el) => el.name === name && el.checked).map((el) => el.value);
  return { mode: values("mode")[0] || "mixed", levels: values("level"), countries: values("country") };
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
$("settings").addEventListener("close", () => {
  const next = readSettings();
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  save(SETTINGS_KEY, settings);
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
});
$("openSettings").addEventListener("click", openSettings);

/* ---------- Wiring ---------- */

$("audio").addEventListener("play", () => {
  $("play").classList.add("playing");
  $("play").textContent = "❚❚";
  $("hearCall").textContent = "❚❚ Pause call";
});
$("audio").addEventListener("pause", () => {
  $("play").classList.remove("playing");
  $("play").textContent = "▶";
  $("hearCall").textContent = "▶ Hear call";
});
$("play").addEventListener("click", playCall);
$("hearCall").addEventListener("click", playCall);
$("otherCall").addEventListener("click", () => {
  card.callIndex = (card.callIndex + 1) % card.s.calls.length;
  showCall();
});
$("reveal").addEventListener("click", reveal);
$("hint").addEventListener("click", hint);
$("gotIt").addEventListener("click", () => { record("right"); nextCard(); });
$("missed").addEventListener("click", () => { record("wrong"); nextCard(); });
$("next").addEventListener("click", nextCard);

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
])
  .then(([data, calls]) => {
    species = data.map((s) => ({ ...s, calls: calls[s.id] || [] }));
    nextCard();
  })
  .catch(() => {
    $("carousel").textContent = "Could not load bird data. Check your connection.";
  });
