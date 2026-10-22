// Service worker: keeps the app and every bird photo you've seen on the phone.
// App files: network first (so updates arrive), falling back to the cache offline.
// Photos: cache first, and kept for good, so a photo is only ever downloaded once.
// Offline downloads (offline.js) live in their own cache, which is never trimmed.
// The Dev build (…/dev/) shares this site with the main app, so its caches get their own names.
const PREFIX = self.registration.scope.includes("/dev/") ? "sabirds-dev-" : "sabirds-";
const APP_CACHE = `${PREFIX}app-v17`;
const PHOTO_CACHE = `${PREFIX}photos-v1`;
const WIKI_CACHE = `${PREFIX}wiki-v1`;
const INFO_CACHE = `${PREFIX}info-v1`;  // each bird's range/months file, kept across app updates
const APP_FILES = [
  "./", "index.html", "styles.css", "motion.js", "app.js", "progress.js", "offline.js", "auth.js", "vendor/supabase-2.45.4.js", "manifest.webmanifest",
  "data/species.json", "data/calls.json", "data/map.json", "data/similar.json", "data/areas.json", "data/near.json", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(`${PREFIX}app-`) && k !== APP_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Photos are fetched with CORS (iNaturalist allows it), so the phone stores them at their real
// size; "opaque" copies would each count as several MB against the storage allowance.
async function photo(request) {
  const saved = await caches.match(request.url);  // offline downloads or earlier views
  if (saved) return saved;
  const cache = await caches.open(PHOTO_CACHE);
  let response;
  try { response = await fetch(request.url, { mode: "cors", credentials: "omit" }); }
  catch { response = await fetch(request); }
  if (response.ok) cache.put(request.url, response.clone());
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

async function appFile(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || Response.error();
  }
}

// Bird info files: fresh when online, kept (unlike app files) when the app updates.
async function infoFile(request) {
  const cache = await caches.open(INFO_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || Response.error();
  }
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
