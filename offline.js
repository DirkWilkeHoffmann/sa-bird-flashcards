"use strict";
// Offline mode: download the current study set (photos, a call, range data and
// Wikipedia text per bird) into a cache the service worker serves from. With no
// signal, only downloaded birds and photos are shown.

const OFFLINE_CACHE = "sabirds-offline-v1";
const OFFLINE_KEY = "sabirds.offline.v1";
const PHOTO_KB = 100, THUMB_KB = 5, CALL_KB = 550, TEXT_KB = 6; // measured averages
const PARALLEL = 4;
const SHELL = ["./", "index.html", "styles.css", "app.js", "progress.js", "offline.js", "manifest.webmanifest",
  "data/species.json", "data/calls.json", "data/map.json", "data/similar.json", "data/areas.json", "data/near.json",
  "icons/icon-192.png", "icons/apple-touch-icon.png"];

let offlineMeta = load(OFFLINE_KEY, {});  // { [speciesId]: { photos: [photoId], call: url | null } }
let downloadSet = [];
let cancelled = false;

const isOffline = () => !navigator.onLine;
// Downloaded calls are stored under a local address the service worker can serve offline.
const localCallUrl = (url) => new URL(`offline/call-${url.split("/").filter(Boolean).at(-2)}.mp3`, location.href).href;
const fmtMB = (kb) => (kb >= 1024 ? `${(kb / 1024).toFixed(kb >= 10240 ? 0 : 1)} MB` : `${Math.round(kb)} KB`);

// What a card may show right now: everything online, only downloaded media offline.
function offlineView(s) {
  const meta = offlineMeta[s.id];
  if (!isOffline() || !meta) return null;
  const photos = s.photos.filter((p) => meta.photos.includes(p.id));
  return { photos: photos.length ? photos : s.photos.slice(0, 1),
           calls: meta.call ? s.calls.filter((c) => c.url === meta.call).map((c) => ({ ...c, url: localCallUrl(c.url) })) : [] };
}

function offlineAvailable(s) {
  return !isOffline() || Boolean(offlineMeta[s.id]);
}

/* ---------- Download screen ---------- */

function photosPerBird() {
  const v = document.querySelector('#offline input[name="photosPer"]:checked')?.value || "3";
  return v === "all" ? Infinity : Number(v);
}

function estimate() {
  const per = photosPerBird();
  const calls = $("offlineCalls").checked;
  let kb = 0;
  for (const s of downloadSet) {
    kb += Math.min(per, s.photos.length) * PHOTO_KB + THUMB_KB + TEXT_KB + (calls && s.calls.length ? CALL_KB : 0);
  }
  return kb;
}

function updateEstimate() {
  $("offlineEstimate").textContent = `${downloadSet.length} birds · about ${fmtMB(estimate())}`;
}

async function showStorage() {
  const n = Object.keys(offlineMeta).length;
  let used = "";
  try {
    const { usage, quota } = await navigator.storage.estimate();
    used = ` Using ${fmtMB(usage / 1024)} of ${fmtMB(quota / 1024)} available.`;
  } catch { /* not supported */ }
  $("offlineStored").textContent = n ? `${n} birds are downloaded on this phone.${used}` : `Nothing downloaded yet.${used}`;
  $("offlineDelete").hidden = !n;
}

function openOffline(list) {
  downloadSet = list;
  $("offlineSet").textContent = summary();
  $("offlineProgress").hidden = true;
  $("offlineStart").hidden = false;
  $("offlineCancel").hidden = true;
  $("offlineStatus").textContent = isOffline() ? "You're offline — connect to download." : "";
  updateEstimate();
  showStorage();
  $("offline").showModal();
}

async function cacheUrl(cache, url, key = url) {
  if (await cache.match(key)) return true;
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) return false;
  await cache.put(key, r);
  return true;
}

async function runQueue(tasks, onDone) {
  let next = 0;
  async function worker() {
    while (next < tasks.length && !cancelled) {
      const task = tasks[next++];
      try { await task(); } catch { /* skip this file, keep going */ }
      onDone();
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

async function startDownload() {
  if (isOffline()) { $("offlineStatus").textContent = "You're offline — connect to download."; return; }
  cancelled = false;
  try { await navigator.storage.persist(); } catch { /* best effort */ }
  const cache = await caches.open(OFFLINE_CACHE);
  const per = photosPerBird();
  const withCalls = $("offlineCalls").checked;

  const tasks = SHELL.map((url) => () => cacheUrl(cache, url));
  const plan = new Map();
  for (const s of downloadSet) {
    const photos = s.photos.slice(0, per);
    const call = withCalls && s.calls[0] ? s.calls[0].url : null;
    const entry = { photos: [], call: null };
    plan.set(s.id, entry);
    for (const p of photos) {
      tasks.push(async () => { if (await cacheUrl(cache, photoUrl(p, "medium"))) entry.photos.push(p.id); });
    }
    tasks.push(() => cacheUrl(cache, photoUrl(s.photos[0], "square")));
    tasks.push(() => cacheUrl(cache, `data/info/${s.id}.json`));
    if (call) tasks.push(async () => { if (await cacheUrl(cache, call, localCallUrl(call))) entry.call = call; });
  }
  // Wikipedia text goes through the service worker's own cache, one bird at a time.
  const wikiTasks = downloadSet.map((s) => () => loadWiki(s));

  let done = 0;
  const total = tasks.length + wikiTasks.length;
  const tick = () => {
    done++;
    $("offlineBar").style.width = `${(done / total) * 100}%`;
    $("offlineStatus").textContent = `Downloading… ${Math.round((done / total) * 100)}%`;
  };
  $("offlineProgress").hidden = false;
  $("offlineStart").hidden = true;
  $("offlineCancel").hidden = false;

  const wiki = (async () => {
    for (const t of wikiTasks) {
      if (cancelled) break;
      try { await t(); } catch { /* text is optional */ }
      tick();
    }
  })();
  await runQueue(tasks, tick);
  await wiki;

  // Remember what this phone now has (merging with earlier downloads).
  for (const [id, p] of plan) {
    if (!p.photos.length) continue;  // nothing usable arrived for this bird
    const old = offlineMeta[id];
    offlineMeta[id] = { photos: [...new Set([...(old?.photos || []), ...p.photos])], call: p.call || old?.call || null };
  }
  save(OFFLINE_KEY, offlineMeta);
  $("offlineCancel").hidden = true;
  $("offlineStart").hidden = false;
  $("offlineStatus").textContent = cancelled ? "Stopped. What was downloaded so far is kept." : "Done — this set works without signal.";
  showStorage();
}

async function deleteOffline() {
  if (!confirm("Delete all downloaded birds from this phone?")) return;
  await caches.delete(OFFLINE_CACHE);
  offlineMeta = {};
  save(OFFLINE_KEY, offlineMeta);
  $("offlineStatus").textContent = "Offline data deleted.";
  showStorage();
}

$("offlineOpen").addEventListener("click", () => {
  // Use the set as currently chosen in the settings sheet.
  const prev = settings;
  settings = readSettings();
  const list = species.filter(inSet);
  settings = prev;
  $("settings").close();
  openOffline(list.length ? list : species);
});
$("offline").addEventListener("change", updateEstimate);
$("offlineStart").addEventListener("click", startDownload);
$("offlineCancel").addEventListener("click", () => { cancelled = true; });
$("offlineDelete").addEventListener("click", deleteOffline);
window.addEventListener("online", () => { queue = []; });
window.addEventListener("offline", () => { queue = []; });
