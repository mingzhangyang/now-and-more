"use strict";
/* Shared harness for the almanac tests: evaluates the REAL solar-term,
   almanac and render code sections of js/app.js (plus js/data.js and
   the whole of js/almanac-rules.js, loaded before app.js as in the page) in a
   sandbox function, stubbing only the boundaries — the clock language
   state, the envelope gate (almanac is never a picture card) and the
   full-text door. Dates are built in LOCAL time by the callers,
   matching how the app itself reasons about days; a test that needs a
   fixed zone must set process.env.TZ before it builds any Date. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/* `opts.Intl` replaces the global Intl inside the sandbox: the almanac
   and the special days must not depend on Intl's chinese calendar. */
function harness(opts = {}) {
  const app = read("js/app.js");
  const data = read("js/data.js");
  const rules = read("js/almanac-rules.js");
  const lunar = read("js/lunar.js");
  function section(start, end) {
    const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return app.slice(a, b);
  }
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
  const source = data + "\n" + rules + "\n" + lunar + "\n" + `
    let lang = "zh", currentSelection = null, liveWorldTime = null;
    let skyVisualGen = 0;
    let myDays = [];
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
    section("function esc(str)", "/* Dated note first") +
    // Lunar festivals and "my days" read the same lunar calendar.
    section("const FESTIVALS = {", "/* ---------- My days") +
    section("function matchPersonalDay(date)", "/* Precedence:") +
    section("function lunarLabelOf(date)", "/* Which postcard") + `
    return {
      solarTermInfo, computeAlmanac, renderSelection,
      jieMonthInfo, jieMonthGanzhi, lichunYearGanzhi, yearGanzhi, dayGanzhi,
      jianchuOf, shaDirectionOf, ZHI, NAM_ALMANAC, tuWangYongShi, almanacRuleContext, almanacFullText, almanacFullDoc, almanacReadingHtml,
      NAM_LUNAR, LUNAR, lunarDate, deltaTSeconds, civilDeltaTSeconds, solarTermInstantsForYear,
      lunarFestivalOn, matchPersonalDay, lunarLabelOf, setMyDays: (days) => { myDays = days; },
      pentadInfo, PENTADS, setLang: (v) => { lang = v; },
    };
  `;
  const api = new Function("document", "Intl", source)(documentStub, opts.Intl || Intl);
  const surface = () => ({
    stage: true,
    card: makeEl(), cat: makeEl(), meta: makeEl(), body: makeEl(),
    foot: null, fullBtn: null,
  });
  return { api, surface };
}

module.exports = { harness };
