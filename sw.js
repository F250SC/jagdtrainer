const CACHE_NAME = "jagdtrainer-cache-v6";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./cards_sg2.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

// Install: precache shell (do NOT skipWaiting automatically; we do it via the app's update button)
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
  })());
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Allow the app to trigger immediate activation
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch: cache-first for assets, network fallback; for navigation, serve cached index.html offline
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Navigation requests -> try network, fallback to cached index.html
    const accept = req.headers.get("accept") || "";
    const isNav = req.mode === "navigate" || accept.includes("text/html");

    if (isNav) {
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put("./index.html", res.clone());
        return res;
      } catch (_) {
        const cached = await cache.match("./index.html", { ignoreSearch: true });
        if (cached) return cached;
        return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    }

    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      // last resort: return cached shell if someone requests "./"
      const fallback = await cache.match("./", { ignoreSearch: true });
      if (fallback) return fallback;
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
