const test = require("node:test");
const assert = require("node:assert/strict");
const { watchUpdates } = require("../js/pwa-update.js");

const flush = () => new Promise(resolve => setImmediate(resolve));
function worker(state) {
  const w = new EventTarget();
  w.state = state;
  w.messages = [];
  w.postMessage = message => w.messages.push(message);
  w.move = state => { w.state = state; w.dispatchEvent(new Event("statechange")); };
  return w;
}
async function fixture({ controlled = true, waiting = null, installing = null, reject = false } = {}) {
  const sw = new EventTarget(), win = new EventTarget(), doc = new EventTarget();
  const registration = new EventTarget();
  let reloads = 0, checks = 0, retry, interval;
  registration.waiting = waiting;
  registration.installing = installing;
  registration.update = async () => { checks++; };
  sw.controller = controlled ? worker("activated") : null;
  sw.register = async (url, options) => {
    assert.equal(url, "/sw.js");
    assert.equal(options.updateViaCache, "none");
    if (reject) throw Error("blocked");
    return registration;
  };
  win.location = { reload() { reloads++; } };
  win.setTimeout = fn => { retry = fn; return 1; };
  win.clearTimeout = () => { retry = null; };
  win.setInterval = fn => { interval = fn; };
  doc.readyState = "complete";
  doc.visibilityState = "visible";
  let state = { ready: false };
  const controls = watchUpdates(sw, { window: win, document: doc }, next => { state = next; });
  await flush();
  return {
    sw, win, doc, registration, controls,
    get state() { return state; }, get reloads() { return reloads; }, get checks() { return checks; },
    expire() { retry(); }, poll() { interval(); },
    activate(w) { w.move("activating"); sw.controller = w; sw.dispatchEvent(new Event("controllerchange")); w.move("activated"); },
    discover(w) { registration.installing = w; registration.dispatchEvent(new Event("updatefound")); },
  };
}

test("first install is silent and does not reload", async () => {
  const w = worker("installing"), f = await fixture({ controlled: false, installing: w });
  w.move("installed"); f.activate(w);
  assert.equal(f.state.ready, false);
  assert.equal(f.reloads, 0);
});
test("an already waiting worker prompts; only user confirmation activates and reloads once", async () => {
  const w = worker("installed"), f = await fixture({ waiting: w });
  assert.equal(f.state.ready, true);
  assert.deepEqual(w.messages, []);
  f.controls.apply(); f.controls.apply();
  assert.deepEqual(w.messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(f.state.applying, true);
  assert.equal(f.reloads, 0);
  f.activate(w); f.sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(f.reloads, 1);
});
test("track an installing worker found before registration resolves; Later is per version", async () => {
  const w = worker("installing"), f = await fixture({ installing: w });
  assert.equal(f.state.ready, false);
  w.move("installed"); assert.equal(f.state.ready, true);
  f.controls.later(); assert.equal(f.state.ready, false);
  assert.deepEqual(w.messages, []);
  const next = worker("installing"); f.discover(next); next.move("installed");
  assert.equal(f.state.ready, true);
});
test("another window activating does not reload; explicit update reloads the controlled page", async () => {
  const w = worker("installed"), f = await fixture({ waiting: w });
  f.activate(w); assert.equal(f.reloads, 0);
  f.controls.apply(); assert.equal(f.reloads, 1);
  assert.deepEqual(w.messages, []);
});
test("recheck on foreground, online, pageshow and interval, not while hidden", async () => {
  const f = await fixture(); assert.equal(f.checks, 1);
  f.doc.visibilityState = "hidden"; f.poll(); await flush(); assert.equal(f.checks, 1);
  f.doc.visibilityState = "visible"; f.doc.dispatchEvent(new Event("visibilitychange")); await flush();
  f.win.dispatchEvent(new Event("online")); await flush();
  f.win.dispatchEvent(new Event("pageshow")); await flush();
  f.poll(); await flush(); assert.equal(f.checks, 5);
});
test("activation timeout is retryable; no premature reload", async () => {
  const w = worker("installed"), f = await fixture({ waiting: w });
  f.controls.apply(); f.expire();
  assert.equal(f.state.applying, false); assert.equal(f.state.failed, true); assert.equal(f.reloads, 0);
  f.controls.apply(); f.activate(w); assert.equal(f.reloads, 1);
});
test("a redundant worker is no longer offered; a replacement can be offered", async () => {
  const w = worker("installed"), f = await fixture({ waiting: w });
  f.controls.apply(); w.move("redundant");
  assert.equal(f.state.ready, false); assert.equal(f.state.applying, false);
  const next = worker("installing"); f.discover(next); next.move("installed");
  assert.equal(f.state.ready, true);
});
test("registration failure does not prevent normal page use", async () => {
  const f = await fixture({ reject: true });
  assert.equal(f.state.ready, false); assert.equal(f.reloads, 0);
});

// Execute the actual Service Worker, not a reimplementation of its lifecycle.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const cacheVersion = Number(read("sw.js").match(/nam-v(\d+)/)[1]);
const cacheName = version => `nam-v${version}`;
function workerFixture({ failInstall = false } = {}) {
  const handlers = {}, deleted = [], matched = [];
  let skips = 0, claims = 0, precache;
  const hit = { shell: "active" };
  vm.runInNewContext(read("sw.js"), {
    self: {
      location: { origin: "https://test.invalid" },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() { skips++; },
      clients: { async claim() { claims++; } },
    },
    Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } },
    URL,
    caches: {
      async open(name) {
        return {
          async addAll(requests) { precache = requests; if (failInstall) throw Error("offline"); },
          async match(key) { matched.push([name, key]); return hit; },
        };
      },
      async keys() { return [cacheName(cacheVersion - 2), cacheName(cacheVersion - 1),
        cacheName(cacheVersion), cacheName(cacheVersion + 1), "unrelated"]; },
      async delete(key) { deleted.push(key); },
    },
    fetch() { throw Error("network should not serve a newer shell"); },
  });
  function dispatch(name, props = {}) {
    let promise;
    handlers[name]({ ...props, waitUntil(p) { promise = p; }, respondWith(p) { promise = p; } });
    return promise;
  }
  return {
    dispatch, deleted, matched, hit,
    get skips() { return skips; }, get claims() { return claims; }, get precache() { return precache; },
  };
}
test("worker waits for explicit activation, rejects failed precache, and bypasses HTTP cache", async () => {
  const f = workerFixture();
  await f.dispatch("install");
  assert.equal(f.skips, 0);
  assert.ok(f.precache.every(request => request.cache === "reload"));
  assert.ok(f.precache.some(request => request.url === "/js/pwa-update.js?v=" + cacheVersion));
  assert.ok(f.precache.some(request => request.url === "/css/pwa-update.css?v=" + cacheVersion));
  await f.dispatch("message", { data: { type: "OTHER" } });
  assert.equal(f.skips, 0);
  await f.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(f.skips, 1);
  await assert.rejects(workerFixture({ failInstall: true }).dispatch("install"), /offline/);
});
test("activation deletes only older app caches and claims clients", async () => {
  const f = workerFixture();
  await f.dispatch("activate");
  assert.deepEqual(f.deleted, [cacheName(cacheVersion - 2), cacheName(cacheVersion - 1)]);
  assert.equal(f.claims, 1);
});
test("navigation to a known shell stays on the controlling worker's cached version", async () => {
  const f = workerFixture();
  const result = await f.dispatch("fetch", {
    request: { method: "GET", cache: "default", mode: "navigate", url: "https://test.invalid/library?note=1" },
  });
  assert.equal(result, f.hit);
  assert.deepEqual(f.matched, [[cacheName(cacheVersion), "/library.html"]]);
});
test("all pages load one shared updater and use the current cache version", () => {
  const source = read("sw.js");
  const version = source.match(/nam-v(\d+)/)[1];
  for (const page of ["index.html", "library.html", "about.html", "privacy.html"]) {
    const html = read(page);
    assert.equal(html.split("js/pwa-update.js?v=" + version).length, 2, page);
    assert.ok(html.includes("css/pwa-update.css?v=" + version), page);
    for (const stamp of html.matchAll(/\?v=(\d+)/g)) assert.equal(stamp[1], version, page);
  }
  assert.ok(!read("js/app.js").includes('serviceWorker.register("/sw.js")'));
});
