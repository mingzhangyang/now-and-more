"use strict";
/* 七十二候: each pentad spans 5° of the Sun's apparent longitude, solved by
   the same solver as the solar terms. Phrased to hold in any time zone. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./almanac-harness.cjs");

test("PENTADS holds 72 entries indexed by 5° from 春分", () => {
  const { api } = harness();
  assert.equal(api.PENTADS.length, 72);
  api.PENTADS.forEach((p, i) => {
    assert.equal(p.id, `pentad:${String(i * 5).padStart(3, "0")}`);
    assert.ok(p.zh && p.en && p.noteZh && p.noteEn, p.id);
  });
  assert.equal(api.PENTADS[0].zh, "玄鸟至");   // 春分初候
  assert.equal(api.PENTADS[63].zh, "东风解冻"); // 立春初候, 315°
  assert.equal(api.PENTADS[54].zh, "蚯蚓结");   // 冬至初候, 270°
});

test("each solar term opens its first pentad at the term's own instant", () => {
  const { api } = harness();
  for (const term of api.solarTermInstantsForYear(2026)) {
    const info = api.pentadInfo(new Date(term.instant.getTime() + 60000));
    assert.equal(info.idx, term.angle / 5, `angle ${term.angle}`);
    assert.ok(Math.abs(info.start - term.instant) < 1000, `start of ${term.angle}°`);
    // Just before the crossing, the previous term's third pentad is in force.
    const before = api.pentadInfo(new Date(term.instant.getTime() - 60000));
    assert.equal(before.idx, (term.angle / 5 + 71) % 72);
  }
});

test("pentads tile the year in order, each about five days long", () => {
  const { api } = harness();
  let t = new Date(2026, 0, 1, 12);
  let prev = api.pentadInfo(t);
  const seen = new Set([prev.idx]);
  for (let day = 1; day <= 366; day++) {
    t = new Date(2026, 0, 1 + day, 12);
    const info = api.pentadInfo(t);
    assert.ok(info.start <= t && t < info.next, `day ${day} inside its pentad`);
    const len = (info.next - info.start) / 86400000;
    assert.ok(len > 4.8 && len < 5.4, `pentad ${info.idx} lasts ${len.toFixed(2)} days`);
    if (info.idx !== prev.idx) {
      assert.equal(info.idx, prev.nextIdx, "no pentad skipped");
      assert.ok(Math.abs(info.start - prev.next) < 1000, "pentads meet end to end");
    }
    seen.add(info.idx);
    prev = info;
  }
  assert.equal(seen.size, 72);
});

test("the card names the pentad, its term and the next pentad, in either language", () => {
  const { api, surface } = harness();
  const sel = { cat: "pentad", info: api.pentadInfo(new Date(2026, 10, 28, 12)) };
  let s = surface();
  api.renderSelection(sel, s);
  assert.equal(s.meta.textContent, "小雪 · 二候");
  assert.ok(s.body.innerHTML.includes("天气上升地气下降"));
  assert.ok(s.body.innerHTML.includes("下一候 <b>闭塞而成冬</b>"));
  api.setLang("en");
  s = surface();
  api.renderSelection(sel, s);
  assert.equal(s.meta.textContent, "Xiaoxue · second pentad");
  assert.ok(s.body.innerHTML.includes("All closes and winter sets in"));
});
