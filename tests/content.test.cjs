"use strict";
// Content-pool integrity: permanent ids, well-formed entries, and the
// extra On This Day events that HISTORY_MORE adds per date.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source + "\n;this.__data = { POEMS_EN, POEMS_ZH, HISTORY, HISTORY_MORE };", context);
const { POEMS_EN, POEMS_ZH, HISTORY, HISTORY_MORE } = context.__data;

test("English poems carry permanent sequential ids and short excerpts", () => {
  POEMS_EN.forEach((poem, i) => {
    assert.equal(poem.id, `poem:en:${String(i + 1).padStart(3, "0")}`);
    assert.ok(poem.title && poem.author, poem.id);
    assert.ok(Array.isArray(poem.lines) && poem.lines.length >= 1, poem.id);
    // The keepsake canvas holds about five lines under the title.
    assert.ok(poem.lines.length <= 5, `${poem.id} has ${poem.lines.length} lines`);
    assert.ok(poem.lines.every(line => typeof line === "string" && line.trim() === line && line.length > 0), poem.id);
  });
  assert.equal(new Set(POEMS_EN.map(p => p.title)).size, POEMS_EN.length);
  assert.ok(POEMS_ZH.length > 0);
});

test("HISTORY_MORE adds well-formed events to real dates without duplicating HISTORY", () => {
  const days = Object.keys(HISTORY_MORE);
  assert.ok(days.length > 0);
  const ids = new Set();
  for (const day of days) {
    assert.ok(Object.prototype.hasOwnProperty.call(HISTORY, day), `${day} is not a HISTORY date`);
    HISTORY_MORE[day].forEach((entry, i) => {
      assert.equal(entry.id, `history:${day}:${i + 2}`);
      assert.ok(!ids.has(entry.id), entry.id);
      ids.add(entry.id);
      assert.ok(Number.isInteger(entry.year), entry.id);
      assert.ok(typeof entry.zh === "string" && entry.zh.length > 0, entry.id);
      assert.ok(typeof entry.en === "string" && entry.en.length > 0, entry.id);
      assert.ok(!/"/.test(entry.zh), `${entry.id} zh uses 「」 for quotes`);
      assert.ok(!(entry.year === HISTORY[day].year && entry.en === HISTORY[day].en), `${entry.id} repeats HISTORY`);
    });
  }
});
