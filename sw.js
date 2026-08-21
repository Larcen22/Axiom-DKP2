/**
 * sw.js — offline support for the Axiom DKP dashboard.
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons): precached at install time.
 *  - Navigations: network-first so fresh deploys win; cached index.html as the
 *    offline fallback.
 *  - Everything else (data JSON/CSV, static assets, and the cross-origin
 *    PapaParse CDN script — opaque responses are cacheable): stale-while-revalidate.
 *    Offline → last known good data; online → fresh copy in the background.
 */
const CACHE = "axiom-dkp-v1";

const SHELL = [
  "/", "/index.html", "/style.css", "/manifest.webmanifest",
  "/icon-192.png", "/icon-512.png",
  "/css/variables/variables.css",
  "/css/base/base.css",
  "/css/layout/layout.css",
  "/css/components/loading.css",
  "/css/components/cards.css",
  "/css/components/inputs.css",
  "/css/components/tables.css",
  "/css/components/pagination.css",
  "/css/views/app-views.css",
  "/js/data.js",
  "/js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navigations: network-first, cached shell as offline fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/index.html", copy));
        return res;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets, data files, and CDN scripts: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok || res.type === "opaque") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
