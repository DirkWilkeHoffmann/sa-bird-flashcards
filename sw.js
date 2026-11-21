// Service worker: keeps the app and every bird photo you've seen on the phone.
// App files: from the phone first (so the app opens at once); a new release downloads in the background.
// Photos: cache first, so a photo you see again doesn't download again; the most recent few thousand are kept.
// Offline downloads (offline.js) live in their own cache, which is never trimmed.
// The Dev build (…/dev/) shares this site with the main app, so its caches get their own names.
const PREFIX = self.registration.scope.includes("/dev/") ? "sabirds-dev-" : "sabirds-";
const APP_CACHE = `${PREFIX}app-v94`;
const WIKI_CACHE = `${PREFIX}wiki-v1`;
const INFO_CACHE = `${PREFIX}info-v1`;  // each bird's range/months file, kept across app updates
const APP_FILES = [
  "./", "index.html", "styles.css", "motion.js", "learn.js", "app.js", "progress.js", "offline.js", "auth.js", "onboard.js", "coach.js", "streak.js", "stickers.js", "quiz.js", "vendor/supabase-2.45.4.js", "manifest.webmanifest",
  "data/species.json", "data/calls.json", "data/map.json", "data/similar.json", "data/areas.json", "data/near.json", "data/spread.json", "data/stickers.json", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE)
    .then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: "no-cache" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(`${PREFIX}app-`) && k !== APP_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
  caches.delete(`${PREFIX}photos-v1`).catch(() => {});  // the old keep-everything photo store (see below); not waited for
});

// Photos seen while studying are kept, but not forever: they go into numbered stores of up to
// PHOTOS_PER_STORE photos. When the newest is full a new one starts and the one before it is
// dropped, so at most about 2 × PHOTOS_PER_STORE photos are kept, and nothing ever has to list
// them all. (Until Nov 2026 every photo was kept for good, in one store that grew to many
// thousands; listing it at each start held up the first photo for up to half a minute on iPhones.)
// Only the photo sizes the card shows are kept; the small blurred preview isn't.
// Offline downloads (offline.js) are in their own store and never dropped.
const PHOTO_PREFIX = `${PREFIX}photos-g`;   // offline.js uses the same names
const PHOTO_META = `${PREFIX}photo-meta`;   // which store is newest and how full it is
const PHOTOS_PER_STORE = 1000;
let photoStore = null;  // { n: number of the newest store, count: photos put in it }

async function newestPhotoStore() {
  if (!photoStore) {
    const meta = await caches.open(PHOTO_META).then((c) => c.match("store")).then((r) => r?.json()).catch(() => null);
    photoStore = meta && Number.isInteger(meta.n) ? meta : { n: 1, count: 0 };
    dropOldPhotos();
  }
  if (photoStore.count >= PHOTOS_PER_STORE) {
    photoStore = { n: photoStore.n + 1, count: 0 };
    dropOldPhotos();
  }
  photoStore.count++;
  // Saved with every photo: iPhones stop this worker often, and a count that fell behind would let
  // the newest store grow past its limit.
  caches.open(PHOTO_META).then((c) => c.put("store", new Response(JSON.stringify(photoStore)))).catch(() => {});
  return caches.open(`${PHOTO_PREFIX}${photoStore.n}`);
}

// Drops every photo store older than the one before the newest, and the old store that kept every
// photo for good. Not waited for: deleting a big store can take a while, and photos keep working.
function dropOldPhotos() {
  const keep = new Set([`${PHOTO_PREFIX}${photoStore.n}`, `${PHOTO_PREFIX}${photoStore.n - 1}`]);
  caches.keys().then((keys) => Promise.all(keys
    .filter((k) => (k.startsWith(PHOTO_PREFIX) && !keep.has(k)) || k === `${PREFIX}photos-v1`)
    .map((k) => caches.delete(k)))).catch(() => {});
}

// Photos are fetched with CORS (iNaturalist allows it), so the phone stores them at their real
// size; "opaque" copies would each count as several MB against the storage allowance.
async function photo(request) {
  const saved = await caches.match(request.url);  // offline downloads or earlier views
  if (saved) return saved;
  let response;
  try { response = await fetch(request.url, { mode: "cors", credentials: "omit" }); }
  catch { response = await fetch(request); }
  if (response.ok && !request.url.includes("/small.")) {
    const copy = response.clone();
    newestPhotoStore().then((c) => c.put(request.url, copy)).catch(() => {});
  }
  return response;
}

// Wikipedia text: fetched once per bird, then read from the phone.
async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// App files: straight from the phone, so the app opens without waiting for the server (on a weak
// signal that wait was several seconds, every time). Updates still arrive: each release changes
// APP_CACHE above, so the browser finds a new sw.js when the app opens, downloads the new files
// in the background (install, below) and the next open uses them.
async function appFile(request) {
  const cache = await caches.open(APP_CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) return saved;
  return fromServer(cache, request, { cache: "no-cache" });
}

// Ask the server, keep a good answer, and if the server fails (no signal, or an error such as
// GitHub's occasional 503 while the site is publishing) use any copy already on the phone instead.
async function fromServer(cache, request, options) {
  let response;
  try { response = await fetch(request, options); }
  catch { return (await caches.match(request, { ignoreSearch: true })) || Response.error(); }
  if (response.ok) { cache.put(request, response.clone()); return response; }
  return (await caches.match(request, { ignoreSearch: true })) || response;
}

// Bird info files: fresh when online, kept (unlike app files) when the app updates.
async function infoFile(request) {
  return fromServer(await caches.open(INFO_CACHE), request);
}

// Downloaded calls: iPhones ask for audio in byte ranges, so answer with the requested slice.
async function call(request) {
  const saved = await caches.match(request.url);
  if (!saved) return Response.error();
  const range = request.headers.get("range");
  if (!range) return saved;
  const buf = await saved.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": saved.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // The dashboard and photo review aren't part of the app: always fresh from the server, never kept
  // (kept, a dashboard update didn't show until the next app release).
  if (url.origin === self.location.origin && /\/(admin|review)\.html$/.test(url.pathname)) return;
  if ((url.hostname === "inaturalist-open-data.s3.amazonaws.com" || url.hostname === "static.inaturalist.org")
      && url.pathname.includes("/photos/")) {
    e.respondWith(photo(e.request));
  } else if (url.origin === self.location.origin && url.pathname.includes("/offline/call-")) {
    e.respondWith(call(e.request));
  } else if (url.hostname === "en.wikipedia.org") {
    e.respondWith(cacheFirst(WIKI_CACHE, e.request));
  } else if (url.origin === self.location.origin && url.pathname.includes("/data/info/")) {
    e.respondWith(infoFile(e.request));
  } else if (url.origin === self.location.origin) {
    e.respondWith(appFile(e.request));
  }
});

// Quiz notifications (quiz.js subscribes; the quiz-push Edge Function sends them).
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "SA Birds", {
    body: m.body || "", icon: "icons/icon-192.png", tag: m.tag || undefined, data: { round: m.round || null },
  }));
});

// Tapping one opens the app (or the open window) on that round.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const round = e.notification.data?.round || "";
  const url = new URL(round ? `./?quiz=${round}` : "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((w) => w.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ quiz: round }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
