// Service worker: keeps the app and every bird photo you've seen on the phone.
// App files: network first (so updates arrive), falling back to the cache offline.
// Photos: cache first, so a photo is only ever downloaded once.
// Offline downloads (offline.js) live in their own cache, which is never trimmed.
const APP_CACHE = "sabirds-app-v9";
const PHOTO_CACHE = "sabirds-photos-v1";
const WIKI_CACHE = "sabirds-wiki-v1";
const MAX_PHOTOS = 1500;
let puts = 0;
const APP_FILES = [
  "./", "index.html", "styles.css", "app.js", "progress.js", "offline.js", "auth.js", "vendor/supabase-2.45.4.js", "manifest.webmanifest",
  "data/species.json", "data/calls.json", "data/map.json", "data/similar.json", "data/areas.json", "data/near.json", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith("sabirds-app-") && k !== APP_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimPhotos(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(k);
}

async function photo(request) {
  const saved = await caches.match(request.url);  // offline downloads or earlier views
  if (saved) return saved;
  const cache = await caches.open(PHOTO_CACHE);
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone()).then(() => { if (++puts % 50 === 0) trimPhotos(cache); });
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
  if (url.hostname === "inaturalist-open-data.s3.amazonaws.com" || url.hostname === "static.inaturalist.org") {
    e.respondWith(photo(e.request));
  } else if (url.origin === self.location.origin && url.pathname.includes("/offline/call-")) {
    e.respondWith(call(e.request));
  } else if (url.hostname === "en.wikipedia.org") {
    e.respondWith(cacheFirst(WIKI_CACHE, e.request));
  } else if (url.origin === self.location.origin) {
    e.respondWith(appFile(e.request));
  }
});
