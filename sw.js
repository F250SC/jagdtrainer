const CACHE_NAME = "jagdtrainer-cache-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./cards_sg1.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    // Let updates wait until next navigation (safer for iOS)
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
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Network-first for navigations (helps updates), fallback to cache for offline
    if (req.mode === "navigate") {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put("./index.html", fresh.clone());
          return fresh;
        }
      } catch {}
      const cached = await cache.match("./index.html", { ignoreSearch: true });
      if (cached) return cached;
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }

    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});
