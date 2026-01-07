const CACHE_NAME = "jagdtrainer-cache-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

const INDEX_URL = new URL("./index.html", self.registration.scope).toString();
const CORE_FILES = ["/index.html","/styles.css","/app.js","/db.js","/manifest.webmanifest"];

function stripSearch(req){
  const url = new URL(req.url);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isCoreAsset(url){
  return CORE_FILES.some(p => url.pathname.endsWith(p));
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Add assets one by one so a missing icon doesn't break the whole install
    await Promise.allSettled(ASSETS.map(async (asset) => {
      try { await cache.add(asset); } catch {}
    }));
    // updates should wait; we trigger skipWaiting via the Update-Button in der App
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1) Navigations: network-first (so new index.html kommt rein), fallback cache
    if (req.mode === "navigate") {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          await cache.put(INDEX_URL, fresh.clone());
          return fresh;
        }
      } catch {}
      const cached = await cache.match(INDEX_URL);
      if (cached) return cached;
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }

    // 2) Core Assets: network-first, cache fallback (macht Updates viel zuverlässiger)
    if (isCoreAsset(url)) {
      const key = stripSearch(req);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          await cache.put(key, fresh.clone());
          return fresh;
        }
      } catch {}
      const cached = await cache.match(key);
      if (cached) return cached;
      // fallback: try any cached variant ignoring search
      const cached2 = await cache.match(req, { ignoreSearch: true });
      if (cached2) return cached2;
      return fetch(req);
    }

    // 3) Everything else: cache-first
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) cache.put(stripSearch(req), res.clone());
    return res;
  })());
});
