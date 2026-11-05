"use strict";
// Stickers: a reward past the daily goal. A day with STICKER_GOAL Right answers (more than the
// daily goal's 10) earns one sticker, drawn at random from Southern Africa's finest birds in three
// tiers (data/stickers.json): Common, the familiar favourites; Rare, the special ones you hope to
// see; and Legendary, rarities of a lifetime. Any bird can be drawn, met in the cards or not. It's
// kept on that day (days[key].k = the bird's id), so it covers that day on the streak calendar and
// follows the account with the days (streak.js). A sticker is never given twice; once all are
// in, there are no more to earn. The tiers are never named to the player: they show as a soft outline
// (grey, yellowish, purplish), in how much an uncollected sticker gives away, and in how big the
// reveal is.
// Stickers: huashu-bird-sticker by Huashu, CC BY 4.0 (stickers/CREDITS.md).

const STICKER_GOAL = 25;
const STICKER_ODDS = [["legendary", 0.05], ["rare", 0.25], ["common", 0.70]];
const TIER_NAMES = { common: "Common", rare: "Rare", legendary: "Legendary" };  // screen readers only
const TIER_ORDER = ["legendary", "rare", "common"];  // for falling back when a tier is complete
const ALBUM_ORDER = ["common", "rare", "legendary"];

let stickerSet = [];  // [{ id, tier }]
const stickersLoaded = fetch("data/stickers.json").then((r) => (r.ok ? r.json() : []))
  .then((list) => {
    stickerSet = list;
    if ($("progress").open) renderProgress();
  })
  .catch(() => {});

const stickerUrl = (id) => `stickers/${id}.webp`;
const stickerOf = (id) => stickerSet.find((x) => x.id === Number(id)) || null;
const stickerName = (id) => { const s = speciesById.get(Number(id)); return s ? nameOf(s) : "A bird"; };

// Each collected sticker and the first day it was earned.
function collectedStickers() {
  const got = new Map();
  for (const k of Object.keys(days).sort()) {
    const id = days[k].k;
    if (id && stickerOf(id) && !got.has(id)) got.set(id, k);
  }
  return got;
}

// Starter odds make a first Legendary easy: they hold until the collection has STARTER_UNTIL
// (1 Legendary and 3 Rares), then the usual odds take over.
const STARTER_ODDS = [["legendary", 0.20], ["rare", 0.40], ["common", 0.40]];
const STARTER_UNTIL = { legendary: 1, rare: 3 };

function stickerOdds(got = collectedStickers()) {
  const n = { legendary: 0, rare: 0, common: 0 };
  for (const id of got.keys()) n[stickerOf(id).tier]++;
  const starter = Object.entries(STARTER_UNTIL).some(([tier, need]) => n[tier] < need);
  return starter ? STARTER_ODDS : STICKER_ODDS;
}

function rollTier(odds) {
  let x = Math.random();
  for (const [tier, p] of odds) { if (x < p) return tier; x -= p; }
  return "common";
}

// A tier by the odds, then a sticker not collected yet from it. A sticker is never given twice:
// when the rolled tier is complete, the next tier down (then up) is tried, and with every
// sticker collected there is nothing left to give (null).
function drawSticker() {
  if (!stickerSet.length) return null;
  const got = collectedStickers();
  const tier = rollTier(stickerOdds(got));
  const i = TIER_ORDER.indexOf(tier);
  const order = [tier, ...TIER_ORDER.slice(i + 1), ...TIER_ORDER.slice(0, i).reverse()];
  const pick = (list) => list[Math.floor(Math.random() * list.length)].id;
  for (const t of order) {
    const left = stickerSet.filter((x) => x.tier === t && !got.has(x.id));
    if (left.length) return pick(left);
  }
  return null;
}

// After each answer (from record in app.js). Returns the sticker earned with this answer, if any.
function earnSticker() {
  const d = days[dayKey()];
  if (!d || d.k || d.r < STICKER_GOAL || !stickerSet.length) return null;
  const fresh = !collectedStickers().size;
  const id = drawSticker();
  if (!id) return null;  // the whole collection is in
  d.k = id;
  saveDays();
  logEvent("sticker", d.k, { tier: stickerOf(d.k)?.tier, first: fresh });
  return d.k;
}

/* ---------- Showing a sticker: earned just now, or tapped on the calendar or album ---------- */

// How each tier arrives when earned: a Common pops in, a Rare spins in with a glow and sparkles,
// a Legendary spins in twice, with a flash, rays and a bigger burst.
const REVEAL = {
  common: { from: { s: 0.2, r: -28 }, damping: 0.5, response: 0.45, name: 150, sparks: 0, buzz: [12, 50, 25] },
  rare: { from: { s: 0.05, r: -380 }, damping: 0.55, response: 0.75, name: 550, sparks: 10, buzz: [15, 50, 15, 50, 40] },
  legendary: { from: { s: 0, r: -740 }, damping: 0.5, response: 1.05, name: 1000, sparks: 22, flash: true,
               buzz: [20, 50, 20, 50, 20, 50, 80] },
};

function sparkle(stage, n, color, at) {
  setTimeout(() => {
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "sp-spark";
      s.style.setProperty("--a", `${(360 / n) * i + Math.random() * 14}deg`);
      s.style.setProperty("--d", `${95 + Math.random() * 45}px`);
      s.style.setProperty("--t", `${0.75 + Math.random() * 0.4}s`);
      s.style.setProperty("--spark", color);
      if (i % 3 === 0) { s.style.width = s.style.height = "6px"; }
      stage.append(s);
      setTimeout(() => s.remove(), 1400);
    }
  }, at);
}

function showSticker(id, { earned = false, day = null } = {}) {
  const st = stickerOf(id);
  if (!st) return;
  const pop = $("stickerPop");
  pop.className = `sticker-pop ${st.tier}`;
  pop.dataset.id = String(st.id);
  prepareShare(st.id);
  $("stickerPopKicker").textContent = earned
    ? "Well done! You earned a sticker today."
    : day ? new Date(`${day}T12:00`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }) : "";
  const title = $("stickerPopTitle");
  title.textContent = stickerName(st.id);
  const img = $("stickerPopImg");
  img.src = stickerUrl(st.id);
  img.alt = stickerName(st.id);
  img.setAttribute("aria-description", TIER_NAMES[st.tier]);
  pop.querySelectorAll(".sp-spark, .sp-flash").forEach((x) => x.remove());
  if (!pop.open) pop.showModal();
  pop.querySelector("button[type=submit]").blur();

  stopAnim("stickerPopSpin");
  if (!earned || reducedMotion()) {
    title.classList.remove("waiting");
    animate("stickerPop", { s: 0.85, o: 0 }, { s: 1, o: 1 }, {
      damping: 0.8, response: 0.4,
      onUpdate: ({ s, o }) => { img.style.transform = `scale(${s})`; img.style.opacity = String(Math.max(0, Math.min(1, o))); },
    });
    if (earned) haptic(REVEAL[st.tier].buzz);
    return;
  }
  const r = REVEAL[st.tier];
  haptic(r.buzz);
  title.classList.add("waiting");
  setTimeout(() => title.classList.remove("waiting"), r.name);
  if (r.flash) {
    const f = document.createElement("div");
    f.className = "sp-flash";
    pop.append(f);
    setTimeout(() => f.remove(), 1200);
  }
  if (r.sparks) {
    const color = getComputedStyle(pop).getPropertyValue(st.tier === "legendary" ? "--tier-legend" : "--tier-rare").trim();
    sparkle($("stickerPopStage"), r.sparks, color, r.name * 0.55);
  }
  // The spin settles smoothly (no swinging past upright); the size has the bounce.
  const now = { s: r.from.s, rot: r.from.r };
  const draw = () => { img.style.transform = `scale(${now.s}) rotate(${now.rot}deg)`; };
  img.style.opacity = "0";
  animate("stickerPopSpin", { rot: r.from.r }, { rot: 0 }, {
    damping: 1, response: r.response * 0.8,
    onUpdate: ({ rot }) => { now.rot = rot; draw(); },
  });
  animate("stickerPop", { s: r.from.s, o: 0 }, { s: 1, o: 1 }, {
    damping: r.damping, response: r.response,
    onUpdate: ({ s, o }) => { now.s = s; draw(); img.style.opacity = String(Math.max(0, Math.min(1, o * 1.5))); },
  });
}

$("stickerPop").addEventListener("click", (e) => { if (e.target === $("stickerPop")) $("stickerPop").close(); });

/* ---------- Sharing a sticker to WhatsApp or any messenger ---------- */
// The share image is 512x512 with a see-through background (stickers/share/), the size WhatsApp
// uses for stickers. iPhones get a PNG, which their messengers handle better than WebP. Phones
// only allow sharing straight after a tap, so the file is fetched when the sticker is shown and
// handed over the moment Share is tapped. Without a share sheet (most computers), it downloads.

let shareReady = null;  // { id, file } once fetched

const onIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

async function asPng(blob) {
  const img = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

async function prepareShare(id) {
  shareReady = null;
  try {
    const res = await fetch(`stickers/share/${id}.webp`);
    if (!res.ok) throw new Error(res.status);
    let blob = await res.blob();
    let ext = "webp";
    if (onIOS()) { blob = await asPng(blob); ext = "png"; }
    const file = new File([blob], `${stickerName(id)}.${ext}`, { type: blob.type || `image/${ext}` });
    if ($("stickerPop").dataset.id === String(id)) shareReady = { id, file };
  } catch { /* offline and never fetched: Share says so */ }
}

async function shareSticker() {
  const id = Number($("stickerPop").dataset.id);
  const ready = shareReady?.id === id ? shareReady : null;
  if (!ready) { showToast("The sticker isn't ready to share yet. Try again in a moment."); prepareShare(id); return; }
  const data = { files: [ready.file] };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      logEvent("sticker_share", id);
    } catch (e) {
      if (e.name !== "AbortError") showToast("Couldn't share the sticker");
    }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(ready.file);
  a.download = ready.file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  logEvent("sticker_share", id, { download: true });
}

$("stickerShare").addEventListener("click", shareSticker);

/* ---------- The album: Common, then Rare, then Legendary ---------- */

function stickerAlbumButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sticker-album-btn";
  const n = collectedStickers().size;
  b.innerHTML = `<span>Stickers</span><b>${n} of ${stickerSet.length || 122}</b><span aria-hidden="true">›</span>`;
  b.addEventListener("click", openAlbum);
  return b;
}

function openAlbum() {
  renderAlbum();
  openSheet($("stickerAlbum"));
}

// Collected stickers are in colour with their name. Not collected: a Common shows its shape and
// name, a Rare only a question mark, and a Legendary a blur you can't make out.
function renderAlbum() {
  const body = $("stickerAlbumBody");
  body.replaceChildren();
  const got = collectedStickers();
  const count = document.createElement("p");
  count.className = "album-count";
  count.textContent = `${got.size} of ${stickerSet.length} collected`;
  const intro = document.createElement("p");
  intro.className = "note";
  intro.textContent = `Get ${STICKER_GOAL} Right answers in a day and you earn a sticker, one a day. Some are harder to find than others.`;
  body.append(count, intro);
  for (const tier of ALBUM_ORDER) {
    const grid = document.createElement("div");
    grid.className = "album-grid";
    for (const st of stickerSet.filter((x) => x.tier === tier)) {
      const has = got.has(st.id);
      const cell = document.createElement(has ? "button" : "div");
      cell.className = `album-cell ${tier}${has ? "" : " missing"}`;
      const name = document.createElement("small");
      if (has || tier !== "rare") {
        const img = new Image();
        img.src = stickerUrl(st.id);
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        cell.append(img);
      } else {
        const q = document.createElement("span");
        q.className = "q";
        q.textContent = "?";
        q.setAttribute("aria-hidden", "true");
        cell.append(q);
      }
      name.textContent = has || tier === "common" ? stickerName(st.id) : tier === "legendary" ? "?" : "";
      cell.append(name);
      if (has) {
        cell.type = "button";
        cell.setAttribute("aria-label", `${stickerName(st.id)}, ${TIER_NAMES[tier]}`);
        cell.addEventListener("click", () => showSticker(st.id, { day: got.get(st.id) }));
      } else {
        cell.setAttribute("aria-label", tier === "common" ? `${stickerName(st.id)}, not collected yet`
          : `${TIER_NAMES[tier]} sticker, not collected yet`);
      }
      grid.append(cell);
    }
    body.append(grid);
  }
  const credit = document.createElement("p");
  credit.className = "note album-credit";
  credit.innerHTML = 'Bird stickers: <a href="https://github.com/alchaincyf/huashu-bird-sticker" target="_blank" rel="noopener">huashu-bird-sticker</a> by Huashu, '
    + '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
  body.append(credit);
}

/* ---------- Dev build: earn one now (any tier, or a chosen one), or start over ---------- */

if (IS_DEV) {
  $("devSticker").hidden = false;
  $("devStickerClear").hidden = false;
  // Today's sticker if today has none yet, otherwise the latest earlier day without one, so a
  // tester can fill a week of the calendar. The Rare and Legendary buttons show those reveals.
  const earnNow = async (tier) => {
    await stickersLoaded;
    let date = new Date();
    for (let i = 0; i < 400 && days[dayKey(date)]?.k; i++) date = addDays(date, -1);
    const k = dayKey(date);
    const d = days[k] || (days[k] = { a: 0, r: 0, m: 0 });
    let id;
    if (tier) {
      const got = collectedStickers();
      const left = stickerSet.filter((x) => x.tier === tier && !got.has(x.id));
      id = left.length ? left[Math.floor(Math.random() * left.length)].id : null;
    } else {
      id = drawSticker();
    }
    if (!id) { showToast(tier ? `Every ${TIER_NAMES[tier]} sticker is collected` : "Every sticker is collected"); return; }
    d.k = id;
    saveDays();
    if ($("progress").open) renderProgress();
    showSticker(d.k, { earned: true });
  };
  $("devSticker").addEventListener("click", () => earnNow(null));
  $("devStickerRare").addEventListener("click", () => earnNow("rare"));
  $("devStickerLegend").addEventListener("click", () => earnNow("legendary"));
  $("devStickerRare").hidden = false;
  $("devStickerLegend").hidden = false;
  $("devStickerClear").addEventListener("click", () => {
    for (const d of Object.values(days)) delete d.k;
    saveDays();
    if ($("progress").open) renderProgress();
    showToast("Stickers cleared on this phone (another phone's may come back with the next sync)");
  });
}
