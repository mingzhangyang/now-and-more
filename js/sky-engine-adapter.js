/* Now, and More — Sky Engine adapter (M4).
   Loads the pinned, same-origin Sky Engine SDK and its matching catalog.
   The site owns time, place, disclosure and which signature asterism to
   draw. The SDK owns positions and the illustration. A failed load is
   reported to the caller; this file does not keep a second sky engine. */
"use strict";

(function () {
  var VERSION = "0.1.0";
  var SOURCE_COMMIT = "6bd1b60f3ee63e357eb685175db8a8d99207fa32";
  var RELEASE_TAG = "sky-engine-v0.1.0";
  var BASE = "vendor/sky-engine/0.1.0/";
  var SCENE_LIMIT = 6;

  var enginePromise = null;
  var catalogJson = null;
  var catalogFlight = null;
  var scenes = new Map();

  function asset(name) {
    return new URL(BASE + name, document.baseURI).href;
  }

  function reset() {
    enginePromise = null;
    catalogJson = null;
    catalogFlight = null;
    scenes.clear();
  }

  function loadEngine() {
    if (!enginePromise) {
      var url = asset("sky-engine.mjs");
      enginePromise = import(url).catch(function (err) {
        enginePromise = null;
        throw err;
      });
    }
    return enginePromise;
  }

  /* One catalog flight for every caller. The SDK bounds each caller; this
     fetch is not tied to one caller's abort, so a timeout does not throw
     away a download another card still needs. A failed flight is cleared
     and the next call tries again. */
  function loadCatalog() {
    if (catalogJson) return Promise.resolve(catalogJson);
    if (catalogFlight) return catalogFlight;
    catalogFlight = fetch(asset("stars.json"))
      .then(function (res) {
        if (!res.ok) throw new Error("Star catalog unavailable (" + res.status + ")");
        return res.json();
      })
      .then(function (json) {
        catalogJson = json;
        catalogFlight = null;
        return json;
      })
      .catch(function (err) {
        catalogFlight = null;
        throw err;
      });
    return catalogFlight;
  }

  function sceneKey(obs) {
    var when = obs.when instanceof Date ? obs.when.getTime() : Number(obs.when);
    return [
      Number(obs.lat).toFixed(4),
      Number(obs.lon).toFixed(4),
      String(obs.tz || ""),
      String(Math.floor(when / 60000)),
    ].join("|");
  }

  function sceneFor(obs) {
    if (!obs || typeof obs.lat !== "number" || typeof obs.lon !== "number" || !obs.tz || !obs.when) {
      return Promise.reject(new Error("Sky observer is incomplete."));
    }
    var key = sceneKey(obs);
    var hit = scenes.get(key);
    if (hit) return hit;
    var pending = loadEngine().then(function (engine) {
      return engine.createSkyScene({
        latitude: obs.lat,
        longitude: obs.lon,
        timezone: obs.tz,
        elevation: 0,
        locationName: obs.name || "",
        instant: obs.when instanceof Date ? obs.when : new Date(obs.when),
        weather: "clear",
        skyBrightness: "dark",
        /* Product view when no signature asterism is framed. Not the
           engine's automatic postcard framing. */
        view: { heading: obs.lat >= 0 ? 180 : 0, altitude: 30, fov: 66 },
        aspect: 1,
        layers: { stars: true, lines: false, labels: false },
        loadCatalog: engine.starCatalogLoaded()
          ? undefined
          : function () {
            return loadCatalog().then(function (json) { return engine.decodeStarColumns(json); });
          },
      });
    }).catch(function (err) {
      scenes.delete(key);
      throw err;
    });
    scenes.set(key, pending);
    while (scenes.size > SCENE_LIMIT) {
      var oldest = scenes.keys().next().value;
      if (oldest === key) break;
      scenes.delete(oldest);
    }
    return pending;
  }

  function aimedScene(scene, sig) {
    if (!sig) return scene;
    var alt = sig.alt - 15;
    if (alt < 12) alt = 12;
    if (alt > 52) alt = 52;
    return Object.assign({}, scene, {
      view: { heading: sig.az, altitude: alt, fov: 66 },
    });
  }

  /* Paint one whole canvas. `sig` is a product asterism ({ lines, az, alt })
     or null. Null keeps the scene view and draws no constellation lines.
     An empty pattern list suppresses the engine's built-in patterns. */
  function paintIllustration(canvas, scene, sig, signal) {
    return loadEngine().then(function (engine) {
      var options = sig
        ? {
          composition: { pattern: "signature" },
          patterns: [{ id: "signature", lines: sig.lines }],
          layers: { stars: true, lines: true, labels: false },
        }
        : {
          composition: "current",
          patterns: [],
          layers: { stars: true, lines: false, labels: false },
        };
      options.landscape = "ridge";
      options.milkyWay = true;
      options.paintFinish = true;
      if (signal) options.signal = signal;
      return engine.renderIllustration(canvas, aimedScene(scene, sig), options);
    });
  }

  function warm() {
    return loadEngine().then(function () { return loadCatalog(); }).then(function () { return true; });
  }

  window.NAM_SKY = {
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    releaseTag: RELEASE_TAG,
    sceneFor: sceneFor,
    paintIllustration: paintIllustration,
    warm: warm,
    reset: reset,
  };
})();
