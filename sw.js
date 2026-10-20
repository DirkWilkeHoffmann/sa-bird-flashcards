// Service worker: keeps the app and every bird photo you've seen on the phone.
// App files: network first (so updates arrive), falling back to the cache offline.
// Photos: cache first, so a photo is only ever downloaded once.
const APP_CACHE = "sabirds-app-v3";
const PHOTO_CACHE = "sabirds-photos-v1";
const MAX_PHOTOS = 1500;
let puts = 0;
const APP_FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "data/species.json", "data/calls.json", "icons/icon-192.png",
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
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone()).then(() => { if (++puts % 50 === 0) trimPhotos(cache); });
  }
  return response;
}

async function appFile(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "inaturalist-open-data.s3.amazonaws.com" || url.hostname === "static.inaturalist.org") {
    e.respondWith(photo(e.request));
  } else if (url.origin === self.location.origin) {
    e.respondWith(appFile(e.request));
  }
  // Everything else (bird calls from xeno-canto) streams straight from the network.
});
