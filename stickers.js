"use strict";
// Stickers: a reward past the daily goal. A day with STICKER_GOAL Right answers (more than the
// daily goal's 10) earns one sticker, drawn at random from 50 of Southern Africa's finest birds in
// three tiers: Common, Rare and Legendary. It's kept on that day (days[key].k = the bird's id), so
// it covers that day on the streak calendar and follows the account with the days (streak.js).
// Uncollected stickers come first; once all 50 are in, repeats are possible.
// Stickers: huashu-bird-sticker by Huashu, CC BY 4.0 (stickers/CREDITS.md).

const STICKER_GOAL = 25;
const STICKER_ODDS = [["legendary", 0.05], ["rare", 0.25], ["common", 0.70]];
const TIER_NAMES = { common: "Common", rare: "Rare", legendary: "Legendary" };
const TIER_ORDER = ["legendary", "rare", "common"];

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

function rollTier() {
  let x = Math.random();
  for (const [tier, p] of STICKER_ODDS) { if (x < p) return tier; x -= p; }
  return "common";
}

// A tier by the odds, then a sticker not collected yet from it. When that tier is complete, the
// next tier down (then up) is tried, so a Legendary roll never turns into nothing.
function drawSticker() {
  if (!stickerSet.length) return null;
  const got = collectedStickers();
  const tier = rollTier();
  const i = TIER_ORDER.indexOf(tier);
  const order = [tier, ...TIER_ORDER.slice(i + 1), ...TIER_ORDER.slice(0, i).reverse()];
  const pick = (list) => list[Math.floor(Math.random() * list.length)].id;
  for (const t of order) {
    const left = stickerSet.filter((x) => x.tier === t && !got.has(x.id));
    if (left.length) return pick(left);
  }
  return pick(stickerSet.filter((x) => x.tier === tier));
}

// After each answer (from record in app.js). Returns the sticker earned with this answer, if any.
function earnSticker() {
  const d = days[dayKey()];
  if (!d || d.k || d.r < STICKER_GOAL || !stickerSet.length) return null;
  const fresh = !collectedStickers().size;
  d.k = drawSticker();
  if (!d.k) return null;
  saveDays();
  logEvent("sticker", d.k, { tier: stickerOf(d.k)?.tier, first: fresh });
  return d.k;
}

/* ---------- Showing a sticker: earned just now, or tapped on the calendar or album ---------- */

function showSticker(id, { earned = false, day = null } = {}) {
  const st = stickerOf(id);
  if (!st) return;
  const pop = $("stickerPop");
  const got = collectedStickers();
  const repeat = earned && [...Object.values(days)].filter((d) => d.k === st.id).length > 1;
  pop.className = `sticker-pop ${st.tier}`;
  $("stickerPopKicker").textContent = earned
    ? (repeat ? "Today's sticker: another for the collection" : "You earned today's sticker!")
    : day ? new Date(`${day}T12:00`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }) : "";
  $("stickerPopTier").textContent = TIER_NAMES[st.tier];
  $("stickerPopTitle").textContent = stickerName(st.id);
  $("stickerPopNote").textContent = `${got.size} of ${stickerSet.length} collected`
    + (earned && got.size === 1 ? `. Get ${STICKER_GOAL} Right answers in a day to earn another.` : "");
  const img = $("stickerPopImg");
  img.src = stickerUrl(st.id);
  img.alt = stickerName(st.id);
  if (!pop.open) pop.showModal();
  pop.querySelector("button[type=submit]").blur();
  const big = earned && st.tier !== "common";
  if (earned) haptic(st.tier === "legendary" ? [20, 50, 20, 50, 20, 50, 60] : st.tier === "rare" ? [15, 50, 15, 50, 40] : [12, 50, 25]);
  animate("stickerPop", { s: earned ? 0.2 : 0.85, r: earned ? -28 : 0, o: 0 }, { s: 1, r: 0, o: 1 }, {
    damping: earned ? 0.5 : 0.8, response: big ? 0.6 : 0.45,
    onUpdate: ({ s, r, o }) => {
      img.style.transform = `scale(${s}) rotate(${r}deg)`;
      img.style.opacity = String(Math.max(0, Math.min(1, o)));
    },
  });
}

$("stickerPop").addEventListener("click", (e) => { if (e.target === $("stickerPop")) $("stickerPop").close(); });

/* ---------- The album: every sticker, collected in colour and the rest as shadows ---------- */

function stickerAlbumButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sticker-album-btn";
  const n = collectedStickers().size;
  b.innerHTML = `<span>Stickers</span><b>${n} of ${stickerSet.length || 50}</b><span aria-hidden="true">›</span>`;
  b.addEventListener("click", openAlbum);
  return b;
}

function openAlbum() {
  renderAlbum();
  openSheet($("stickerAlbum"));
}

function renderAlbum() {
  const body = $("stickerAlbumBody");
  body.replaceChildren();
  const got = collectedStickers();
  const intro = document.createElement("p");
  intro.className = "note";
  intro.textContent = `Get ${STICKER_GOAL} Right answers in a day and you earn a sticker, one a day. `
    + "Most are Common, some are Rare and a few are Legendary. Tap a sticker on the calendar to see it again.";
  body.append(intro);
  for (const tier of TIER_ORDER) {
    const list = stickerSet.filter((x) => x.tier === tier);
    const have = list.filter((x) => got.has(x.id)).length;
    const h = document.createElement("p");
    h.className = `prog-h album-h ${tier}`;
    h.innerHTML = `<span class="sp-tier">${TIER_NAMES[tier]}</span> ${have} of ${list.length}`;
    const grid = document.createElement("div");
    grid.className = "album-grid";
    for (const st of list) {
      const has = got.has(st.id);
      const cell = document.createElement(has ? "button" : "div");
      cell.className = `album-cell ${tier}${has ? "" : " missing"}`;
      const img = new Image();
      img.src = stickerUrl(st.id);
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      const name = document.createElement("small");
      name.textContent = has ? stickerName(st.id) : "?";
      cell.append(img, name);
      if (has) {
        cell.type = "button";
        cell.setAttribute("aria-label", `${stickerName(st.id)}, ${TIER_NAMES[tier]}`);
        cell.addEventListener("click", () => showSticker(st.id, { day: got.get(st.id) }));
      } else {
        cell.setAttribute("aria-label", `${TIER_NAMES[tier]} sticker, not collected yet`);
      }
      grid.append(cell);
    }
    body.append(h, grid);
  }
  const credit = document.createElement("p");
  credit.className = "note album-credit";
  credit.innerHTML = 'Bird stickers: <a href="https://github.com/alchaincyf/huashu-bird-sticker" target="_blank" rel="noopener">huashu-bird-sticker</a> by Huashu, '
    + '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
  body.append(credit);
}

/* ---------- Dev build: earn one now, or start the collection over ---------- */

if (IS_DEV) {
  $("devSticker").hidden = false;
  $("devStickerClear").hidden = false;
  // Today's sticker if today has none yet, otherwise the latest earlier day without one, so a
  // tester can fill a week of the calendar.
  $("devSticker").addEventListener("click", async () => {
    await stickersLoaded;
    let date = new Date();
    for (let i = 0; i < 400 && days[dayKey(date)]?.k; i++) date = addDays(date, -1);
    const k = dayKey(date);
    const d = days[k] || (days[k] = { a: 0, r: 0, m: 0 });
    d.k = drawSticker();
    saveDays();
    if ($("progress").open) renderProgress();
    showSticker(d.k, { earned: true });
  });
  $("devStickerClear").addEventListener("click", () => {
    for (const d of Object.values(days)) delete d.k;
    saveDays();
    if ($("progress").open) renderProgress();
    showToast("Stickers cleared on this phone (another phone's may come back with the next sync)");
  });
}
