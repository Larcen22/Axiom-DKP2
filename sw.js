/**
 * sw.js — offline support for the Axiom DKP dashboard.
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons): NETWORK-FIRST, with `{ cache: "no-cache" }`
 *    so revalidation actually reaches the origin (GitHub Pages CDN caching can
 *    otherwise serve stale JS even to a "network" fetch; revalidate-304 keeps it
 *    cheap). The offline cache is the fallback and self-heals: every online hit
 *    re-stores the fresh copy. A plain reload after deploy picks up new code —
 *    no hard refresh needed.
 *  - Navigations: network-first, cached index.html as the offline fallback.
 *  - Same-origin data files (JSON/CSV) + other static assets: NETWORK-FIRST,
 *    cached copy as the offline fallback — an online load always gets the
 *    current export, never a stale one. Every response is tagged
 *    X-Data-Freshness: fresh|stale so the app can show officers which state
 *    they're viewing (footer indicator + offline banner).
 *  - Cross-origin scripts (PapaParse CDN; opaque responses): stale-while-revalidate.
 *
 * GitHub Pages notes:
 *  - Shell matching is by file name (last path segment), so it works whether the
 *    site is served at a custom-domain root (CNAME) or under /<repo>/.
 *  - sw.js registration uses "/sw.js" in app.js, which resolves only at the site
 *    root; on a subpath the registration silently fails and the app still works
 *    online without offline support.
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

// File names that get network-first treatment. Matched by last path segment so the
// same rules apply at a site root (https://domain/js/app.js) and under /<repo>/.
const SHELL_NAMES = new Set(
  SHELL.filter((p) => p !== "/" && !/index\.html$/.test(p))
    .map((p) => p.split("/").filter(Boolean).pop())
);

function isShellAsset(url) {
  const path = url.pathname;
  if (/(^|\/)index\.html$/.test(path)) return true;
  const file = path.split("/").filter(Boolean).pop() || "";
  return SHELL_NAMES.has(file);
}

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

// Tag a response with its freshness so the app can display it. Headers are
// rebuilt, dropping any tag baked in at store time — a copy served from cache
// is stale NOW, whatever it was when cached.
function tagResponse(res, tag) {
  const h = new Headers(res.headers);
  h.set("X-Data-Freshness", tag);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navigations: network-first, cached shell as offline fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        // Only cache OK navigations — a 404 page for an unknown path must never
        // overwrite the good cached index (it would poison offline fallbacks).
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
        }
        return res;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Shell assets: network-first so fresh deploys land on the next ordinary reload.
  if (isShellAsset(url)) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }
        // Non-OK network response: prefer the last good cached copy.
        return caches.match(req).then((cached) => cached || res);
      }).catch(() => caches.match(req).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Same-origin static/data files: network-first so an online load always gets
  // the current export (no stale window after a deploy); cached copy is the
  // offline fallback. Responses are tagged fresh|stale for the UI.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)); // store untagged; re-tag on serve
          return tagResponse(res, "fresh");
        }
        // Non-OK network response: prefer the last good cached copy (stale), else pass through.
        return caches.match(req).then((cached) => (cached ? tagResponse(cached, "stale") : res));
      }).catch(() =>
        // Offline: serve the last known-good copy, tagged stale so the UI can say so.
        caches.match(req).then((cached) => (cached ? tagResponse(cached, "stale") : Response.error()))
      )
    );
    return;
  }

  // Cross-origin scripts (PapaParse CDN): stale-while-revalidate — opaque responses.
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
        .catch(() => null);
      // No cache + failed network: a proper error response instead of undefined
      // (respondWith(undefined) would throw and surface as a generic net error).
      return cached || network || Response.error();
    })
  );
});
