/* Now, and More — service worker.
   Keeps the app shell available offline. Deliberately small and defensive:
   every cache write is guarded, and a failure here must never break the page. */
"use strict";

var CACHE_NAME = "nam-v32";
var GOSSIP_ORIGIN = "https://now-and-more.orangely.workers.dev";

var APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css?v=32",
  "/js/data.js?v=32",
  "/js/dedup.js?v=32",
  "/gossip-service/news-id.js?v=32",
  "/js/gossip.js?v=32",
  "/js/sky-engine-adapter.js?v=32",
  "/js/app.js?v=32",
  "/vendor/sky-engine/0.2.0/sky-engine.mjs",
  "/vendor/sky-engine/0.2.0/stars.json",
  "/vendor/sky-engine/0.2.0/manifest.json",
  "/vendor/sky-engine/0.2.0/moon-lroc.jpg",
  "/privacy.html",
  "/about.html",
  "/library.html",
  "/favicon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function () {
        /* precache failed (e.g. offline during install): carry on regardless */
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            return key === CACHE_NAME ? undefined : caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
      .catch(function () {})
  );
});

/* Cache a response only when it is usable: a real success, or an opaque
   cross-origin response. */
function cachePut(request, response) {
  try {
    if (!response || !(response.ok || response.type === "opaque")) {
      return Promise.resolve();
    }
    var copy = response.clone();
    return caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.put(request, copy);
      })
      .catch(function () {});
  } catch (e) {
    return Promise.resolve();
  }
}

function networkFirst(request, fallbackUrl) {
  return fetch(request)
    .then(function (response) {
      cachePut(request, response);
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (fallbackUrl) return caches.match(fallbackUrl);
        throw new Error("offline and not cached");
      });
    });
}

function cacheFirst(request, cacheKey) {
  var key = cacheKey || request;
  return caches.match(key).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      cachePut(key, response);
      return response;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  // The v2 news client deliberately uses no-store, including configured
  // endpoint origins and paths. Let the browser fetch directly; the client
  // and Worker already enforce freshness and bounded stale fallback.
  if (request.cache === "no-store") return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  /* Page navigations: fresh HTML when online, shell from cache when not. */
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  /* Trending headlines: network-first so they stay fresh, with the last
     good response as the offline fallback. */
  if (url.origin === GOSSIP_ORIGIN && url.pathname.indexOf("/gossip") === 0) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* Special-date paintings: cache-first at runtime. They are fetched
     only on their own date, so they are deliberately NOT in the
     precache shell above — the shell stays small, and a painting the
     visitor has seen remains available offline afterwards. */
  if (url.origin === self.location.origin && url.pathname.indexOf("/assets/special-dates/") === 0) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Self-hosted fonts: cache-first at runtime. The unicode-range slice
     set is far too large to precache; the browser fetches only the
     slices a page actually renders, and each fetched slice stays
     available offline afterwards. */
  if (url.origin === self.location.origin && url.pathname.indexOf("/assets/fonts/") === 0) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Retry URLs bypass a document's failed module map entry, but reference
     the same immutable, version-pinned bytes. Reuse the canonical cache
     entry offline and store recovered responses under that one key. */
  if (url.origin === self.location.origin &&
      /^\/vendor\/sky-engine\/[^/]+\/sky-engine\.mjs$/.test(url.pathname) &&
      /^\?retry=[1-3]$/.test(url.search)) {
    event.respondWith(cacheFirst(request, url.origin + url.pathname));
    return;
  }

  /* Same-origin statics and the Worker's PNG assets: cache-first. */
  if (url.origin === self.location.origin || url.origin === GOSSIP_ORIGIN) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Anything else cross-origin: cache-first, opaque responses included.
     (The site makes no third-party requests of its own; this is only a
     defensive fallback.) */
  event.respondWith(cacheFirst(request));
});
