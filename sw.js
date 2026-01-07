// Jagdtrainer Service Worker
// Ziel: Updates zuverlässig (iOS PWA), trotzdem offline nutzbar.

const CACHE_NAME = "jagdtrainer-cache-v6";
const CORE_ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

const scopeUrl = () => self.registration?.scope || self.location.origin + "/";

function abs(path){
  return new URL(path, scopeUrl()).toString();
}

async function precache(){
  const cache = await caches.open(CACHE_NAME);

  // Fetch with cache-bypass to avoid iOS serving stale files from HTTP cache
  await Promise.all(CORE_ASSETS.map(async (p) => {
    try{
      const req = new Request(abs(p), { cache: "reload" });
      const res = await fetch(req);
      if (res && res.ok){
        await cache.put(abs(p), res.clone());
      }
    } catch(_e){
      // don't fail install if one asset can't be fetched
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precache();
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

// Allow app to activate update immediately
self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isCoreRequest(url){
  const pathname = url.pathname;
  // Match both direct files and GitHub pages paths ending with the file name
  return CORE_ASSETS.some(p => pathname.endsWith(p.replace("./","/")));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Navigations: network-first index.html (best for updates)
    if (req.mode === "navigate"){
      try{
        const fresh = await fetch(req);
        if (fresh && fresh.ok){
          await cache.put(abs("./index.html"), fresh.clone());
          return fresh;
        }
      } catch(_e){}
      const cached = await cache.match(abs("./index.html"));
      if (cached) return cached;
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }

    // Core files: network-first to pick up updates quickly
    if (isCoreRequest(url)){
      try{
        const fresh = await fetch(req);
        if (fresh && fresh.ok){
          // store under canonical URL (no query) to avoid cache bloat
          const canonical = new URL(url.toString());
          canonical.search = "";
          await cache.put(canonical.toString(), fresh.clone());
          return fresh;
        }
      } catch(_e){}
      const canonical = new URL(url.toString()); canonical.search="";
      const cached = await cache.match(canonical.toString());
      if (cached) return cached;
      // fallback: try any cached variant ignoring search
      const any = await cache.match(req, { ignoreSearch: true });
      if (any) return any;
      return fetch(req); // last resort
    }

    // Other assets: cache-first
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try{
      const res = await fetch(req);
      if (res && res.ok) await cache.put(req, res.clone());
      return res;
    } catch(_e){
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
