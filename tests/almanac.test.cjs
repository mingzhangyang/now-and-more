"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("js/app.js");
const data = read("js/data.js");

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
}

/* Real solar-term + almanac + render code from app.js, driven through
   a hand-passed surface. Only the boundaries are stubbed: the clock
   language state, the envelope gate (almanac is never a picture card)
   and the full-text door. Dates are built in LOCAL time, matching how
   the app itself reasons about days. */
function harness() {
  function makeEl() {
    return {
      hidden: true, textContent: "", innerHTML: "", dataset: {},
      classList: {
        _s: new Set(),
        add(...cs) { cs.forEach((c) => this._s.add(c)); },
        remove(...cs) { cs.forEach((c) => this._s.delete(c)); },
        toggle(c, f) {
          if (f === undefined) f = !this._s.has(c);
          if (f) this._s.add(c); else this._s.delete(c);
          return f;
        },
        contains(c) { return this._s.has(c); },
      },
      append() {},
    };
  }
  const documentStub = {
    addEventListener() {},
    createElement: () => makeEl(),
    createTextNode: (text) => ({ textContent: text }),
  };
  const enLine = app.match(/const SOLAR_TERMS_EN = \[.*\];/);
  assert.ok(enLine, "SOLAR_TERMS_EN literal");
  const source = data + "\n" + `
    let lang = "zh", currentSelection = null, liveWorldTime = null;
    let skyVisualGen = 0;
    const DAY_MS = 86400000;
    const RAD = Math.PI / 180;
    const pad = (n) => String(n).padStart(2, "0");
    const t = () => I18N[lang];
    const stageShowsEnvelope = () => false;
    const fullTextOf = () => "";
    ${enLine[0]}
  ` +
    section("/* ================= Precise solar terms", "/* ================= Almanac") +
    section("/* ================= Almanac", "/* ================= Astrology") +
    section("function esc(str)", "/* Dated note first") + `
    return { solarTermInfo, computeAlmanac, renderSelection };
  `;
  const api = new Function("document", source)(documentStub);
  const surface = () => {
    const s = {
      stage: true,
      card: makeEl(), cat: makeEl(), meta: makeEl(), body: makeEl(),
      foot: null, fullBtn: null,
    };
    return s;
  };
  return { api, surface };
}

test("solarTermInfo: an ordinary day reports the term in force as current", () => {
  const { api } = harness();
  // 2026-11-24 (local): 小雪 fell on Nov 22, 大雪 follows on Dec 7.
  const info = api.solarTermInfo(new Date(2026, 10, 24, 12, 0));
  assert.equal(info.today, null);
  assert.equal(info.current.name, "小雪");
  assert.equal(info.next.name, "大雪");
});

test("solarTermInfo: on a term day, current is that day's term", () => {
  const { api } = harness();
  // 大雪 2026: Dec 7 in Shanghai, Dec 6 in New York — ask the solver
  // which local day it claims, then check that day against itself.
  const probe = api.solarTermInfo(new Date(2026, 11, 6, 12, 0));
  const day = probe.today || probe.next;
  assert.equal(day.name, "大雪");
  const onDay = api.solarTermInfo(new Date(day.instant.getFullYear(), day.instant.getMonth(), day.instant.getDate(), 12, 0));
  assert.equal(onDay.today.name, "大雪");
  assert.equal(onDay.current.name, "大雪");
});

test("almanac card on an ordinary day names only the current term — no future date", () => {
  const { api, surface } = harness();
  const date = new Date(2026, 10, 24, 12, 0); // 2026-11-24 local
  const sel = { cat: "almanac", data: api.computeAlmanac(date) };
  const s = surface();
  api.renderSelection(sel, s);
  const body = s.body.innerHTML;
  assert.ok(body.includes("节气 <b>小雪</b>"), "current term named");
  assert.ok(!body.includes("大雪"), "next term never appears");
  assert.ok(!body.includes("交节"), "no crossing time on an ordinary day");
  assert.ok(!/12月\d+日/.test(body), "no future December date anywhere on the card");
});

test("almanac card on a term day still gives the exact crossing time", () => {
  const { api, surface } = harness();
  const probe = api.solarTermInfo(new Date(2026, 11, 6, 12, 0));
  const instant = (probe.today || probe.next).instant;
  const date = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate(), 12, 0);
  const sel = { cat: "almanac", data: api.computeAlmanac(date) };
  const s = surface();
  api.renderSelection(sel, s);
  const body = s.body.innerHTML;
  assert.ok(body.includes("节气 <b>大雪</b>"), "the day's term named");
  assert.ok(body.includes("今日交节"), "crossing announced as today's");
});
