const CACHE_NAME = "jagdtrainer-cache";
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

// Install: cache base assets (first run)
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    // Do not skipWaiting here; keep normal lifecycle.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

// Message API from the app:
// - SKIP_WAITING: activate waiting SW (if there is one)
// - REFRESH_CACHE: forcibly refetch and overwrite cached assets (works even if sw.js didn't change)
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "REFRESH_CACHE") {
    const ts = data.ts || Date.now();
    const reply = (ok, detail="") => {
      try { event.ports?.[0]?.postMessage({ ok, detail }); } catch {}
    };

    event.waitUntil((async () => {
      try{
        const cache = await caches.open(CACHE_NAME);

        // Fetch fresh copies and overwrite canonical cache keys
        for (const url of ASSETS){
          const freshUrl = url + (url.includes("?") ? "&" : "?") + "cb=" + ts;
          const res = await fetch(freshUrl, { cache: "no-store" });
          if (res && res.ok){
            await cache.put(url, res.clone());
          } else {
            throw new Error(`Fetch failed: ${url}`);
          }
        }
        reply(true, "Cache aktualisiert");
      } catch (e){
        reply(false, String(e?.message || e));
      }
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // For navigations, always serve cached index first (offline), but update in background when online.
    if (req.mode === "navigate") {
      const cached = await cache.match("./index.html", { ignoreSearch: true });
      if (cached) return cached;
    }

    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  })());
});
