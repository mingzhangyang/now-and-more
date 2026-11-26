"use strict";
/* 宜忌 agreement with the independent reference (cnlunar 0.2.5, via
   tests/fixtures/almanac-golden.json), restricted to our 用事 vocabulary.
   The recorded baseline (docs/almanac-yiji-baseline.json) is a floor for
   precision/recall and a ceiling for contradictions: a rule change may
   improve any figure but must not make one worse. Exact agreement is not
   the goal — cnlunar reads 《协纪辨方书》 differently in places, documented
   in docs/almanac-rules.md §5. After an intentional rule change, refresh the
   baseline with `node scripts/almanac-yiji-agreement.cjs --write` and update
   the doc. The reference is in Beijing time: pin the zone before any Date. */
process.env.TZ = "Asia/Shanghai";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fixture = require("./fixtures/almanac-golden.json");
const baseline = require("../docs/almanac-yiji-baseline.json");
const { evaluate, CN_TO_OURS } = require(path.join(__dirname, "..", "scripts", "almanac-yiji-agreement.cjs"));
const { harness } = require("./almanac-harness.cjs");

const { api } = harness();
const { summary } = evaluate(fixture, api);
const slack = 1e-4; // one unit in the last stored digit

test("the fixture records cnlunar's 宜/忌 and 等第 for every day", () => {
  for (const k of ["yi", "ji", "level"]) assert.ok(fixture.fields.includes(k), k);
  assert.equal(summary.days, 1461);
  const vocab = new Set(api.NAM_ALMANAC.YONGSHI.map((y) => y.name));
  // The mapping lands only on our vocabulary and covers all of it.
  for (const v of Object.values(CN_TO_OURS)) assert.ok(vocab.has(v), v);
  assert.deepEqual(new Set(Object.values(CN_TO_OURS)), vocab);
});

test("宜/忌 precision and recall do not fall below the recorded baseline", () => {
  for (const side of ["yi", "ji"]) for (const k of ["precision", "recall", "dayPrecision", "dayRecall"]) {
    assert.ok(summary[side][k] >= baseline[side][k] - slack, `${side} ${k}: ${summary[side][k]} < ${baseline[side][k]}`);
  }
});

test("hard contradictions (ours 宜 where cnlunar 忌, or vice versa) do not rise above the baseline", () => {
  assert.ok(summary.contradictions <= baseline.contradictions, `${summary.contradictions} > ${baseline.contradictions}`);
  assert.ok(summary.contradictionRate <= baseline.contradictionRate + slack);
  assert.ok(summary.contradictionDays <= baseline.contradictionDays);
  // Our 诸事皆忌 days cover cnlunar's except where the book lifts them (天赦 on 月厌建会).
  assert.ok(summary.allJiDays.refOnly <= baseline.allJiDays.refOnly);
});

test("no single 用事 regresses: per-item contradictions stay at or below the baseline", () => {
  for (const [n, p] of Object.entries(summary.perItem)) {
    assert.ok(p.contradictions <= baseline.perItem[n].contradictions, `${n}: ${p.contradictions} > ${baseline.perItem[n].contradictions}`);
  }
});
