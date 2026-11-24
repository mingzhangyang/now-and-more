"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("js/app.js");
const core = read("js/dedup.js");
const data = read("js/data.js");
const api = new Function(core + "\nreturn NAM_DEDUP;")();
const ids = n => Array.from({length:n}, (_,i) => "id:" + i);
const key = "nam-decks-v2";
const store = (seed) => {
  const m = new Map(seed ? [[seed.v === 1 ? "nam-decks-v1" : key, JSON.stringify(seed)]] : []);
  return { writes: 0, getItem(k) { return m.get(k) ?? null; },
    setItem(k, v) { this.writes++; m.set(k, v); } };
};
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
}

test("800 complete fixed-pool cycles, including normal bag seams", () => {
  for (const n of [1, 2, 3, 5, 10, 50, 100, 366]) {
    const state = api.createDeckState(store(), seeded(n));
    let last = -1;
    for (let cycle = 0; cycle < 100; cycle++) {
      const bag = Array.from({ length: n }, () => state.transact(() => state.draw("pool", ids(n))));
      assert.equal(new Set(bag).size, n);
      assert.ok(bag.every((i) => i >= 0 && i < n));
      if (n > 1) assert.notEqual(bag[0], last);
      last = bag[n - 1];
    }
  }
});

test("commit after render, rollback on failure, reload resumes bag", () => {
  const storage = store();
  let state = api.createDeckState(storage, seeded(42));
  const seen = Array.from({ length: 7 }, () => state.transact(() => state.draw("pool", ids(20))));
  const before = storage.getItem(key);
  const count = storage.writes;
  assert.throws(() => state.transact(() => {
    state.draw("pool", ids(20));
    state.state.g.zh = { seen: ["unrendered"] };
    assert.equal(storage.getItem(key), before);
    throw Error("render failed");
  }), /render failed/);
  assert.equal(storage.writes, count);
  assert.equal(JSON.stringify(state.state), before);
  assert.throws(() => state.draw("pool", ids(20)), /transaction/);
  state = api.createDeckState(storage, seeded(7));
  const remaining = Array.from({ length: 13 }, () => state.transact(() => state.draw("pool", ids(20))));
  assert.equal(new Set([...seen, ...remaining]).size, 20);
});

test("old store format, corrupted index bag, resize seam and storage denial", () => {
  const storage = store({ v: 1, d: { p: { n: 4, r: [1, 1, 99], l: 2 } }, g: {}, fp: [] });
  const state = api.createDeckState(storage, () => 0.999, {legacyIds:{p:ids(4)}});
  assert.notEqual(state.transact(() => state.draw("p", ids(3))), 2);
  const blocked = api.createDeckState({ getItem() { throw Error(); }, setItem() { throw Error(); } }, () => 0.999);
  assert.equal(blocked.transact(() => blocked.draw("p", ids(3))), 2);
  assert.equal(blocked.transact(() => blocked.draw("p", ids(3))), 1);
});

test("100,000 weighted draws never repeat if alternatives exist", () => {
  const random = seeded(1729);
  const weights = [{ key: "a", weight: 20 }, { key: "b", weight: 9 }, { key: "c", weight: 1 }];
  let last = null;
  for (let i = 0; i < 100000; i++) {
    const chosen = api.weightedCategory(weights, last, random);
    assert.notEqual(chosen, last);
    last = chosen;
  }
  assert.equal(api.weightedCategory(weights, "a", () => 0), "b");
  assert.equal(api.weightedCategory(weights, "a", () => 0.999), "c");
  assert.equal(api.weightedCategory([{ key: "a", weight: 1 }], "a"), "a");
});

test("gate rejects overlapping requests and releases after errors", () => {
  const queue = [];
  const gate = api.createDrawGate((fn) => queue.push(fn));
  let draws = 0;
  assert.equal(gate.request(() => { draws++; }), true);
  assert.equal(gate.request(() => { draws++; }), false);
  assert.equal(gate.request(() => { draws++; }), false);
  assert.equal(draws, 0);
  queue.shift()();
  assert.equal(draws, 1);
  assert.equal(gate.request(() => { throw Error("render failed"); }), true);
  assert.throws(() => queue.shift()(), /render failed/);
  assert.equal(gate.pending, false);
});

// Exercise the actual app selection/draw functions with a deterministic
// scheduler and tiny DOM/storage adapters. The browser is not mocked by
// replacing selection logic. Extract named sections to avoid clock/Canvas
// startup side effects; syntax-check the full script separately in CI.
function harness() {
  const source = core + "\n" + data + "\n" + `
    let lang = "zh", currentSelection = null, lastCategory = null, encounter = 0, lastDrawAt = 0;
    let notesList = [], userSign = "";
    let note = null, postcard = null, delivered = false, gifted = false, failRender = false;
    const gossipCandidates = () => [];
    const gossipEndpoint = () => "";
    const refreshGossip = () => {};
    const randInt = n => Math.floor(Math.random() * n);
    const pick = arr => arr[randInt(arr.length)];
    const pad = n => String(n).padStart(2, "0");
    const deckState = NAM_DEDUP.createDeckState(storage, Math.random);
    const deckDraw = key => deckState.draw(key, NAM_DECK_IDS[key]);
    const notesCurrent = () => true;
    const todaysDatedNoteSelection = () => delivered ? null : note;
    const todaysPostcardSelection = () => postcard;
    const postcardGifted = () => gifted;
    const markNoteDelivered = () => { delivered = true; };
    const markPostcardGifted = () => { gifted = true; };
    const showGiftNotice = () => {};
    const dismissGiftNotice = () => {};
    const t = () => ({ encounter: n => String(n) });
    const el = { classList: { add(){}, remove(){} }, textContent: "" };
    const $ = () => el;
    const renderSelection = sel => { if (failRender) throw Error("render failed"); rendered.push(sel); };
  ` + section("function postcardDayKey(", "/* Today's postcard") +
    section("function availableCategories()", "function esc(str)") +
    section("const POSTCARD_POOL_CHANCE", "/* ================= Clock engine") + `
    return {
      state: deckState, drawCard, makeSelection, selectionForLanguage,
      ready: () => { drawsReady = true; },
      setLang: v => { lang = v; },
      fail: v => { failRender = v; },
      setGifts: (n, p) => { note = n; postcard = p; },
      get current() { return currentSelection; }, get count() { return encounter; },
      get delivered() { return delivered; }, get gifted() { return gifted; },
      select: cat => deckState.transact(() => {
        const sel = makeSelection(cat); renderSelection(sel); return sel;
      }),
      translate: sel => deckState.transact(() => {
        const next = selectionForLanguage(sel); renderSelection(next); return next;
      })
    };
  `;
  const storage = store(), queue = [], rendered = [];
  const math = Object.create(Math); math.random = () => 0;
  const h = new Function("storage", "rendered", "setTimeout", "Math", source)(storage, rendered, fn => queue.push(fn), math);
  return { h, storage, queue, rendered };
}

test("actual poem/quote selection consumes only shown language and caches variants", () => {
  const { h } = harness();
  let p = h.select("poem");
  assert.ok(p.poemZh);
  assert.equal(h.state.state.d["poem:en"], undefined);
  h.setLang("en");
  p = h.translate(p);
  const en = p.poemEn;
  assert.ok(en);
  const remaining = h.state.state.d["poem:en"].r.length;
  h.setLang("zh"); p = h.translate(p);
  h.setLang("en"); p = h.translate(p);
  assert.equal(p.poemEn, en);
  assert.equal(h.state.state.d["poem:en"].r.length, remaining);
  const q = h.select("quotes");
  assert.ok(q.quoteEn);
  assert.equal(h.state.state.d["quotes:zh"], undefined);
  h.setLang("zh");
  assert.ok(h.translate(q).quoteZh);
});

test("actual draw waits for startup, then one accepted render/commit per transition", () => {
  const { h, queue, storage, rendered } = harness();
  assert.equal(h.drawCard(), false);
  h.ready();
  assert.equal(h.drawCard(), true);
  assert.equal(h.drawCard(), false);
  assert.equal(h.drawCard(), false);
  assert.equal(storage.writes, 0);
  assert.equal(h.current, null);
  queue.shift()();
  assert.equal(h.count, 1);
  assert.equal(rendered.length, 1);
  assert.equal(storage.writes, 1);
  assert.equal(h.current, rendered[0]);
  const before = storage.getItem(key);
  h.fail(true);
  h.drawCard();
  assert.throws(() => queue.shift()(), /render failed/);
  assert.equal(storage.getItem(key), before);
  assert.equal(h.count, 1);
  h.fail(false);
  assert.equal(h.drawCard(), true);
  queue.shift()();
  assert.equal(h.count, 2);
  assert.notEqual(rendered[0].cat, rendered[1].cat);
});

test("dated note then postcard, no gift receipt before successful render", () => {
  const { h, queue, rendered } = harness();
  h.setGifts({ cat: "mine", note: { id: 1 }, gifted: true }, { cat: "postcard", key: "test" });
  h.ready();
  h.drawCard();
  assert.equal(h.delivered, false);
  h.fail(true);
  assert.throws(() => queue.shift()(), /render failed/);
  assert.equal(h.delivered, false);
  h.fail(false);
  h.drawCard(); queue.shift()();
  assert.equal(h.delivered, true);
  assert.equal(h.gifted, false);
  h.drawCard(); queue.shift()();
  assert.equal(h.gifted, true);
  assert.deepEqual(rendered.map(s => s.cat), ["mine", "postcard"]);
  h.drawCard(); queue.shift()();
  assert.notEqual(rendered[2].cat, "postcard");
});

// Real receipt, date selection, deck transaction and draw functions; only
// the calendar lookup, render, storage and scheduler are test adapters.
function midnightGiftHarness(notesList, postcards) {
  const storage = store(), queue = [], rendered = [];
  let now = new Date(2026, 11, 31, 23, 59, 59, 999).getTime();
  const tomorrow = new Date(2027, 0, 1, 0, 0, 0, 1).getTime();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const source = core + "\n" + `
    let currentSelection = null, lastCategory = null, encounter = 0, lastDrawAt = 0;
    let failRender = false;
    const pad = n => String(n).padStart(2, "0");
    const appStorage = localStorage;
    const notesCurrent = () => true;
    const deckState = NAM_DEDUP.createDeckState(appStorage);
    const gossipEndpoint = () => "";
    const postcardForDate = date => postcards[noteDayStr(date)] || null;
    const weightedCategory = () => "world";
    const makeSelection = cat => ({ cat });
    const t = () => ({ encounter: n => String(n) });
    const el = { classList: { add(){}, remove(){} }, textContent: "" };
    const $ = () => el;
    const showGiftNotice = () => {};
    const dismissGiftNotice = () => {};
    const renderSelection = sel => {
      if (failRender) throw Error("render failed");
      rendered.push(sel);
      crossMidnight();
    };
  ` + section("function postcardDayKey(", "/* The meta line") +
    section("function noteDayStr(", "function noteDateParts(") +
    section("function noteGiftKey(", "/* ---------- Source context") +
    section("const POSTCARD_POOL_CHANCE", "/* ================= Clock engine") + `
    drawsReady = true;
    return { drawCard, fail: v => { failRender = v; } };
  `;
  const h = new Function("localStorage", "rendered", "setTimeout", "Date", "notesList", "postcards", "crossMidnight", source)(
    storage, rendered, fn => queue.push(fn), FakeDate, notesList, postcards, () => { now = tomorrow; });
  const draw = () => { assert.equal(h.drawCard(), true); queue.shift()(); };
  return { h, storage, draw, rendered };
}

test("midnight note receipt belongs to rendered day; next day's note is still delivered", () => {
  const { h, storage, draw, rendered } = midnightGiftHarness([
    { id: 31, date: "2026-12-31" }, { id: 1, date: "2027-01-01" },
  ], {});
  h.fail(true);
  assert.throws(draw, /render failed/);
  assert.equal(storage.getItem("nam-note-20261231"), null);
  assert.equal(storage.getItem("nam-note-20270101"), null);
  h.fail(false);
  draw();
  assert.equal(rendered[0].note.id, 31);
  assert.equal(storage.getItem("nam-note-20261231"), "31");
  assert.equal(storage.getItem("nam-note-20270101"), null);
  draw();
  assert.equal(rendered[1].note.id, 1);
  assert.equal(storage.getItem("nam-note-20270101"), "1");
  draw();
  assert.equal(rendered[2].cat, "world");
});

test("midnight postcard receipt belongs to rendered day; next day's postcard is still gifted", () => {
  const { h, storage, draw, rendered } = midnightGiftHarness([], {
    "2026-12-31": { key: "newyearseve" }, "2027-01-01": { key: "newyear" },
  });
  h.fail(true);
  assert.throws(draw, /render failed/);
  assert.equal(storage.getItem("nam-postcard-20261231"), null);
  assert.equal(storage.getItem("nam-postcard-20270101"), null);
  h.fail(false);
  draw();
  assert.equal(rendered[0].key, "newyearseve");
  assert.equal(storage.getItem("nam-postcard-20261231"), "1");
  assert.equal(storage.getItem("nam-postcard-20270101"), null);
  draw();
  assert.equal(rendered[1].key, "newyear");
  assert.equal(rendered[1].gifted, true);
  assert.equal(storage.getItem("nam-postcard-20270101"), "1");
  draw();
  assert.equal(rendered[2].cat, "world");
});

test("HTML load order and offline precache match the new module", () => {
  const html = read("index.html"), sw = read("sw.js");
  assert.ok(html.indexOf("js/dedup.js?v=27") > html.indexOf("js/data.js?v=27"));
  assert.ok(html.indexOf("js/app.js?v=27") > html.indexOf("js/dedup.js?v=27"));
  assert.ok(sw.includes('"/js/dedup.js?v=27"'));
  assert.ok(html.indexOf("gossip-service/news-id.js?v=27") > html.indexOf("js/dedup.js?v=27"));
  assert.ok(html.indexOf("js/gossip.js?v=27") > html.indexOf("gossip-service/news-id.js?v=27"));
  assert.ok(html.indexOf("js/app.js?v=27") > html.indexOf("js/gossip.js?v=27"));
  assert.ok(sw.includes('"/gossip-service/news-id.js?v=27"'));
  assert.ok(sw.includes('"/js/gossip.js?v=27"'));
  assert.ok(sw.includes('"/js/app.js?v=27"'));
  assert.ok(sw.includes('"nam-v27"'));
});
