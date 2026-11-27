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
  assert.equal(JSON.stringify({ v: state.state.v, d: state.state.d, g: state.state.g, fp: state.state.fp }), before);
  assert.deepEqual(state.state.historyDaily, []);
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
function harness(storage = store()) {
  const source = core + "\n" + data + "\n" + `
    let lang = "zh", currentSelection = null, lastCategory = null, encounter = 0, lastDrawAt = 0;
    let notesList = [], userSign = "", ambientOn = false;
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
    const isPictureCard = sel => !!sel && (sel.cat === "postcard" || sel.cat === "sky");
    const stageShowsEnvelope = sel => isPictureCard(sel) && !ambientOn;
    const deliverPostcardGift = sel => { if (sel && sel.cat === "postcard" && sel.gifted) markPostcardGifted(sel.giftStamp); };
    const showGiftNotice = () => {};
    const dismissGiftNotice = () => {};
    const t = () => ({ encounter: n => String(n) });
    const el = { classList: { add(){}, remove(){} }, textContent: "" };
    const $ = () => el;
    const renderSelection = sel => { if (failRender) throw Error("render failed"); rendered.push(sel); };
  ` + section("function postcardDayKey(", "/* Today's postcard") +
    section("function availableCategories(", "function esc(str)") +
    section("const POSTCARD_POOL_CHANCE", "/* ================= Clock engine") + `
    return {
      state: deckState, drawCard, makeSelection, selectionForLanguage, availableCategories, canRepaintSelection,
      ready: () => { drawsReady = true; },
      setModal: open => { activeModal = open ? {} : null; if (open) modalEpoch++; },
      setLang: v => { lang = v; },
      fail: v => { failRender = v; },
      setGifts: (n, p) => { note = n; postcard = p; },
      openPicture: () => deliverPostcardGift(currentSelection),
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
  const queue = [], rendered = [];
  let random = 0, now = new Date(2026, 10, 25, 12).getTime();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const math = Object.create(Math); math.random = () => random;
  const h = new Function("storage", "rendered", "setTimeout", "Math", "Date", source)(storage, rendered, fn => queue.push(fn), math, FakeDate);
  return { h, storage, queue, rendered, setRandom: value => { random = value; }, setNow: date => { now = date.getTime(); } };
}

test("history is capped at three actual draws per local day, including reload and language changes", () => {
  const first = harness();
  const { h, queue, setRandom, storage } = first;
  const day = "20261125";
  h.ready();
  const draw = random => { setRandom(random); assert.equal(h.drawCard(), true); queue.shift()(); return h.current; };
  const firstCard = draw(0.29);
  assert.equal(firstCard.cat, "history");
  assert.equal(draw(0).cat, "world");
  const second = draw(0.2);
  assert.equal(second.cat, "history");
  assert.equal(draw(0).cat, "world");
  const third = draw(0.2);
  assert.equal(third.cat, "history");
  // Each history encounter of the day shows a different event for the
  // date; once the date's events are spent, the random-day deck takes over.
  assert.equal(firstCard.today, true);
  assert.equal(second.today, true);
  assert.notEqual(firstCard.entry, second.entry);
  assert.equal(third.today, false);
  assert.notEqual(third.key, "11-25");
  assert.equal(h.state.historyAvailable(day), false);
  const before = storage.getItem(key);
  h.setLang("en");
  assert.equal(h.canRepaintSelection(third), true);
  assert.equal(h.translate(third), third);
  assert.equal(storage.getItem(key), before);
  assert.ok(!h.availableCategories().some(c => c.key === "history"));
  assert.notEqual(draw(0).cat, "history");
  assert.notEqual(draw(0.2).cat, "history");

  const reloaded = harness(storage);
  reloaded.h.setLang("en");
  assert.ok(!reloaded.h.availableCategories().some(c => c.key === "history"));
  // Direct/stale selection is guarded too; it selects a different category.
  assert.notEqual(reloaded.h.select("history").cat, "history");
  reloaded.setNow(new Date(2026, 10, 26, 0, 0, 0));
  assert.ok(reloaded.h.availableCategories().some(c => c.key === "history"));
  const next = reloaded.h.select("history");
  assert.equal(next.cat, "history");
  assert.equal(next.key, "11-26");
  assert.equal(reloaded.h.state.historyAvailable("20261126"), true);
  // Travelling back across a date boundary must not reopen yesterday's budget.
  reloaded.setNow(new Date(2026, 10, 25, 23, 59, 59));
  assert.ok(!reloaded.h.availableCategories().some(c => c.key === "history"));
});

test("failed history render rolls back its slot, and old or malformed counts are safe", () => {
  const { h, storage } = harness(store({v:2,d:{},g:{},fp:[]}));
  const day = "20261125";
  assert.equal(h.select("history").cat, "history");
  assert.equal(h.select("history").cat, "history");
  const before = storage.getItem(key);
  const beforeHistory = storage.getItem(api.HISTORY_KEY);
  h.fail(true);
  assert.throws(() => h.select("history"), /render failed/);
  assert.equal(storage.getItem(key), before);
  assert.equal(storage.getItem(api.HISTORY_KEY), beforeHistory);
  assert.equal(h.state.historyAvailable(day), true);
  h.fail(false);
  assert.equal(h.select("history").cat, "history");
  assert.equal(h.state.historyAvailable(day), false);
  const corrupt = api.createDeckState(store({v:2,d:{},g:{},fp:[],historyDaily:[
    {day, count: 99}, {day, count: 1}, {day:"invalid",count:3}, {day:"20261126",count:-1}
  ]}));
  assert.equal(corrupt.historyAvailable(day), false);
  assert.equal(corrupt.historyAvailable("20261126"), true);
  assert.throws(() => corrupt.recordHistory(day), /transaction/);
  for (let i = 1; i <= 20; i++) {
    const stamp = "202612" + String(i).padStart(2, "0");
    assert.equal(corrupt.transact(() => corrupt.recordHistory(stamp)), true);
  }
  assert.ok(corrupt.state.historyDaily.length <= 8);
});

test("shared-lock tabs cannot spend more than three history slots combined", async () => {
  const storage = store();
  let tail = Promise.resolve();
  const locks = { request(name, options, work) {
    assert.equal(name, "nam-decks-v2-write");
    assert.equal(options.mode, "exclusive");
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  } };
  const a = api.createDeckState(storage, Math.random, { locks });
  const b = api.createDeckState(storage, Math.random, { locks });
  const day = "20261125";
  const results = await Promise.all(Array.from({length:20}, (_, i) => {
    const tab = i % 2 ? a : b;
    return tab.withLock(() => tab.transact(() => tab.recordHistory(day)));
  }));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(api.createDeckState(storage).historyAvailable(day), false);
});

// Deployed v40 rebuilds {v,d,g,fp} and drops every other field on nam-decks-v2.
function rewriteLikeV40(storage, mutate) {
  const parsed = JSON.parse(storage.getItem(key));
  const legacy = {
    v: 2,
    d: parsed && parsed.d && typeof parsed.d === "object" ? parsed.d : {},
    g: parsed && parsed.g && typeof parsed.g === "object" ? parsed.g : {},
    fp: parsed && Array.isArray(parsed.fp) ? parsed.fp : [],
  };
  if (mutate) mutate(legacy);
  storage.setItem(key, JSON.stringify(legacy));
}

test("a v40 writer cannot erase the daily history budget", () => {
  const day = "20261125";
  const storage = store();
  const writer = api.createDeckState(storage, () => 0);
  assert.ok(writer.transact(() => writer.draw("pool", ids(4))) >= 0);
  for (let i = 0; i < 3; i++) assert.equal(writer.transact(() => writer.recordHistory(day)), true);
  assert.equal(writer.historyAvailable(day), false);
  const isolated = storage.getItem(api.HISTORY_KEY);
  assert.match(isolated, /20261125/);
  assert.equal(JSON.parse(storage.getItem(key)).historyDaily, undefined);
  const seen = JSON.parse(storage.getItem(key)).d.pool.s.slice();
  assert.equal(seen.length, 1);
  rewriteLikeV40(storage, (legacy) => {
    legacy.d.pool.s.push("id:legacy");
  });
  assert.equal(storage.getItem(api.HISTORY_KEY), isolated);
  writer.sync();
  assert.equal(writer.historyAvailable(day), false);
  assert.ok(writer.state.d.pool.s.includes(seen[0]));
  assert.ok(writer.state.d.pool.s.includes("id:legacy"));
  const reader = api.createDeckState(storage);
  assert.equal(reader.historyAvailable(day), false);
  assert.equal(reader.transact(() => reader.recordHistory(day)), false);
  assert.deepEqual(reader.state.d.pool.s, writer.state.d.pool.s);

  // A pre-fix snapshot kept the budget only inside nam-decks-v2.
  // The copy out runs under the lock, after a fresh read — not from passive sync.
  const embedded = store({ v: 2, d: { pool: { s: ["id:0"], r: ["id:1"], l: "id:0" } }, g: {}, fp: [], historyDaily: [
    { day, count: 3 }, { day: "20261124", count: 1 },
  ] });
  const migrated = api.createDeckState(embedded);
  assert.equal(migrated.historyAvailable(day), false);
  assert.equal(embedded.getItem(api.HISTORY_KEY), null);
  migrated.withLock(() => {});
  assert.match(embedded.getItem(api.HISTORY_KEY), /20261125/);
  rewriteLikeV40(embedded);
  migrated.sync();
  assert.equal(migrated.historyAvailable(day), false);
  assert.equal(migrated.historyAvailable("20261124"), true);
  const afterWipe = api.createDeckState(embedded);
  assert.equal(afterWipe.historyAvailable(day), false);
  assert.equal(afterWipe.transact(() => afterWipe.recordHistory(day)), false);
});

test("passive history sync does not clobber a locked spend", () => {
  const dayA = "20261125";
  const dayB = "20261126";
  // Day B, then back to day A: recordHistory persists [B, A]. Sorting that
  // snapshot yields [A, B]. Publishing the sorted copy is what races a draw.
  const snapshot = JSON.stringify([{ day: dayB, count: 1 }, { day: dayA, count: 1 }]);
  const memory = new Map([
    [key, JSON.stringify({ v: 2, d: {}, g: {}, fp: [] })],
    [api.HISTORY_KEY, snapshot],
  ]);
  let armed = false;
  let spentDuringStaleWrite = false;
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem(k, v) {
      if (armed && k === api.HISTORY_KEY && !spentDuringStaleWrite) {
        spentDuringStaleWrite = true;
        memory.set(api.HISTORY_KEY, snapshot);
        active.sync();
        active.transact(() => active.recordHistory(dayA));
      }
      memory.set(k, String(v));
    },
  };
  const active = api.createDeckState(storage);
  const passive = api.createDeckState(storage);
  // Force a real reread. The history bytes stay the pre-spend snapshot.
  memory.set(key, JSON.stringify({ v: 2, d: {}, g: {}, fp: ["reread"] }));
  memory.set(api.HISTORY_KEY, snapshot);
  armed = true;
  passive.sync();
  armed = false;
  assert.equal(spentDuringStaleWrite, false);
  assert.equal(JSON.parse(memory.get(api.HISTORY_KEY)).find((entry) => entry.day === dayA).count, 1);
  active.sync();
  assert.equal(active.transact(() => active.recordHistory(dayA)), true);
  assert.equal(JSON.parse(memory.get(api.HISTORY_KEY)).find((entry) => entry.day === dayA).count, 2);
  passive.sync();
  assert.equal(JSON.parse(memory.get(api.HISTORY_KEY)).find((entry) => entry.day === dayA).count, 2);
  assert.equal(passive.state.historyDaily.find((entry) => entry.day === dayA).count, 2);
});

test("ambient shortcut stays outside an open modal", () => {
  const entry = section("function enterAmbient()", "function exitAmbient()");
  assert.match(entry, /if \(ambientOn \|\| activeModal\) return;/);
  assert.doesNotMatch(entry, /closeImageModal/);
  const keys = section('/* ================= Ambient mode ================= */', "/* ================= Keepsake capture");
  assert.match(keys, /if \(activeModal\) return;\n  if \(e\.key === "Escape" && ambientOn\)/);
  assert.match(app, /e\.key === NAM_DEDUP\.KEY \|\| e\.key === NAM_DEDUP\.HISTORY_KEY \|\| e\.key === null/);
});

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

test("modal isolation cancels a queued draw and blocks draws until closed", () => {
  const { h, queue, storage, rendered } = harness();
  h.ready();
  assert.equal(h.drawCard(), true);
  h.setModal(true);
  assert.equal(h.drawCard(), false);
  queue.shift()();
  assert.equal(h.count, 0);
  assert.equal(rendered.length, 0);
  assert.equal(storage.writes, 0);
  assert.equal(h.drawCard(), false);
  h.setModal(false);
  assert.equal(h.drawCard(), true);
  // Even opening and closing before the scheduled callback invalidates it.
  h.setModal(true);
  h.setModal(false);
  queue.shift()();
  assert.equal(h.count, 0);
  assert.equal(storage.writes, 0);
  assert.equal(h.drawCard(), true);
  queue.shift()();
  assert.equal(h.count, 1);
  assert.equal(rendered.length, 1);
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
  // The postcard renders as an envelope outside ambient mode: the gift
  // receipt is written only when the picture is opened, not on render.
  assert.equal(h.gifted, false);
  h.openPicture();
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
    let failRender = false, ambientOn = false;
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
    return { drawCard, fail: v => { failRender = v; },
      openPicture: sel => deliverPostcardGift(sel) };
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

test("midnight postcard receipt belongs to the opened day; next day's postcard is still gifted", () => {
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
  // Envelope semantics: rendering the envelope writes no receipt —
  // the gift is delivered when the picture is opened, and the receipt
  // belongs to the day the envelope was rendered for.
  assert.equal(storage.getItem("nam-postcard-20261231"), null);
  assert.equal(storage.getItem("nam-postcard-20270101"), null);
  h.openPicture(rendered[0]);
  assert.equal(storage.getItem("nam-postcard-20261231"), "1");
  assert.equal(storage.getItem("nam-postcard-20270101"), null);
  draw();
  assert.equal(rendered[1].key, "newyear");
  assert.equal(rendered[1].gifted, true);
  assert.equal(storage.getItem("nam-postcard-20270101"), null);
  h.openPicture(rendered[1]);
  assert.equal(storage.getItem("nam-postcard-20270101"), "1");
  draw();
  assert.equal(rendered[2].cat, "world");
});

test("HTML load order and offline precache match the release version", () => {
  const sw = read("sw.js");
  const version = /var CACHE_NAME = "nam-v(\d+)";/.exec(sw);
  assert.ok(version, "service worker cache version");
  const stamp = version[1];
  const shell = /var APP_SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(shell, "offline shell");
  const cached = new Set([...shell[1].matchAll(/"([^"\n]+)"/g)].map(m => m[1]));
  const scripts = [
    "js/data.js", "js/dedup.js", "gossip-service/news-id.js",
    "js/gossip.js", "js/sky-engine-adapter.js", "js/horoscope-advice.js", "js/astro.js", "js/almanac-rules.js", "js/lunar.js", "js/app.js",
  ];
  const html = read("index.html");
  let previous = -1;
  for (const script of scripts) {
    const index = html.indexOf('src="' + script + "?v=" + stamp + '"');
    assert.ok(index > previous, script + " must load in order");
    previous = index;
  }
  for (const page of ["index.html", "about.html", "privacy.html", "library.html"]) {
    const refs = [...read(page).matchAll(/(?:src|href)="([^"?]+)\?v=(\d+)"/g)];
    assert.ok(refs.length, page + ": versioned assets");
    for (const [, asset, v] of refs) {
      assert.equal(v, stamp, page + ": " + asset);
      // Fonts remain runtime-cached by design.
      if (asset !== "assets/fonts/fonts.css") {
        assert.ok(cached.has("/" + asset + "?v=" + v), asset + " missing from offline shell");
      }
    }
  }
  for (const url of cached) {
    const v = /\?v=(\d+)$/.exec(url);
    if (v) assert.equal(v[1], stamp, url);
  }
  for (const asset of ["sky-engine.mjs", "stars.json", "moon-lroc.jpg"]) {
    assert.ok(cached.has("/vendor/sky-engine/0.2.0/" + asset));
  }
});
