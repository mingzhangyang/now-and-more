"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const moduleURL = "https://test.invalid/vendor/sky-engine/0.2.0/sky-engine.mjs";
const observer = {lat: 39, lon: -77, tz: "UTC", when: new Date()};

function adapter() {
  const calls = [];
  const moduleMap = new Map();
  let fail = true;
  let sceneFail = false;
  const sdk = {
    starCatalogLoaded: () => true,
    createSkyScene: async () => {
      if (sceneFail) throw new Error("catalog unavailable");
      return {ok: true};
    },
  };
  const source = read("js/sky-engine-adapter.js");
  assert.ok(source.includes("import(url.href)"));
  const context = {window: {}, document: {baseURI: "https://test.invalid/"}, URL, Date,
    importFixture: (url) => {
      calls.push(url);
      // Model a browser's sticky per-document success/failure module map.
      if (!moduleMap.has(url)) moduleMap.set(url, fail ? Promise.reject(new Error("offline")) : Promise.resolve(sdk));
      return moduleMap.get(url);
    },
  };
  vm.runInNewContext(source.replace("import(url.href)", "importFixture(url.href)"), context);
  return {api: context.window.NAM_SKY, calls, online: () => {fail = false;}, setSceneFail: (v) => {sceneFail = v;}};
}

test("failed module import advances the pinned URL; success survives resets", async () => {
  const {api, calls, online, setSceneFail} = adapter();
  const first = api.sceneFor(observer);
  assert.equal(api.sceneFor(observer), first);
  await assert.rejects(first, /offline/);
  assert.deepEqual(calls, [moduleURL]);
  online();
  api.reset();
  assert.equal((await api.sceneFor(observer)).ok, true);
  assert.deepEqual(calls, [moduleURL, moduleURL + "?retry=1"]);
  api.reset();
  setSceneFail(true);
  await assert.rejects(api.sceneFor(observer), /catalog unavailable/);
  setSceneFail(false);
  api.reset();
  assert.equal((await api.sceneFor(observer)).ok, true);
  assert.equal(api.needsReload(), false);
  assert.deepEqual(calls, [moduleURL, moduleURL + "?retry=1"]);
});

test("module retry budget is bounded and reset cannot revive a failed URL", async () => {
  const {api, calls} = adapter();
  for (let i = 0; i < 4; i++) {
    assert.equal(api.needsReload(), false);
    await assert.rejects(api.sceneFor(observer), /offline/);
    api.reset();
  }
  assert.equal(api.needsReload(), true);
  await assert.rejects(api.sceneFor(observer), /retry limit/);
  assert.deepEqual(calls, [moduleURL, ...[1, 2, 3].map((i) => moduleURL + "?retry=" + i)]);
});

test("card Enter shortcut belongs only to the card, not nested controls", () => {
  const app = read("js/app.js");
  const start = app.indexOf('$("draw-btn").addEventListener("click", drawCard);');
  const end = app.indexOf('document.addEventListener("keydown",', start);
  assert.ok(start >= 0 && end > start);
  const handlers = {};
  const card = {addEventListener: (type, fn) => {handlers[type] = fn;}};
  let draws = 0;
  vm.runInNewContext(app.slice(start, end), {$: (id) => id === "card" ? card : {addEventListener() {}}, drawCard: () => {draws++;}});
  handlers.keydown({key: "Enter", target: {}, currentTarget: card});
  handlers.keydown({key: "Enter", target: {}, currentTarget: card});
  assert.equal(draws, 0);
  handlers.keydown({key: "Enter", target: card, currentTarget: card});
  assert.equal(draws, 1);
});

test("service worker serves retry aliases from canonical cache and writes recovery there", async () => {
  const handlers = {};
  const entries = new Map();
  const network = [];
  let online = false;
  const response = {ok: true, type: "basic", clone() {return this;}};
  const key = (request) => typeof request === "string" ? request : request.url;
  vm.runInNewContext(read("sw.js"), {
    self: {location: {origin: "https://test.invalid"}, addEventListener: (name, fn) => {handlers[name] = fn;}}, URL,
    caches: {match: async (request) => entries.get(key(request)), open: async () => ({put: async (request, value) => {entries.set(key(request), value);}})},
    fetch: async (request) => {network.push(request.url); if (!online) throw new Error("offline"); return response;},
  });
  function request(url) {
    let result;
    handlers.fetch({request: {method: "GET", url, mode: "cors", cache: "default"}, respondWith: (p) => {result = p;}});
    assert.ok(result);
    return result;
  }
  entries.set(moduleURL, response);
  assert.equal(await request(moduleURL + "?retry=1"), response);
  assert.deepEqual(network, []);
  entries.delete(moduleURL);
  online = true;
  assert.equal(await request(moduleURL + "?retry=2"), response);
  assert.deepEqual(network, [moduleURL + "?retry=2"]);
  assert.equal(entries.get(moduleURL), response);
  assert.equal(entries.has(moduleURL + "?retry=2"), false);
});
