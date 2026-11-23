/* Now, and More — service worker.
   Keeps the app shell available offline. Deliberately small and defensive:
   every cache write is guarded, and a failure here must never break the page. */
"use strict";

var CACHE_NAME = "nam-v2";
var GOSSIP_ORIGIN = "https://now-and-more.orangely.workers.dev";

var APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/data.js",
  "/js/app.js",
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
   cross-origin response (Google Fonts serves those to the SW). */
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

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      cachePut(request, response);
      return response;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

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

  /* Same-origin statics and the Worker's PNG assets: cache-first. */
  if (url.origin === self.location.origin || url.origin === GOSSIP_ORIGIN) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Everything else cross-origin (Google Fonts CSS/files): cache-first,
     opaque responses included. */
  event.respondWith(cacheFirst(request));
});
