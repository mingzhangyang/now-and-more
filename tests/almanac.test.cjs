"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./almanac-harness.cjs");

/* These tests run in whatever zone the machine has (CI and dev boxes
   differ): every assertion is phrased so it holds in any TZ. The
   Beijing-dated golden checks live in almanac-golden.test.cjs. */

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

test("year label is the lunar year: 乙巳 until 2026's Spring Festival, then 丙午", () => {
  const { api } = harness();
  // Mid-January and mid-February are far from any boundary in every TZ.
  assert.equal(api.computeAlmanac(new Date(2026, 0, 1, 12)).yearGanzhi, "乙巳");
  assert.equal(api.computeAlmanac(new Date(2026, 1, 10, 12)).yearGanzhi, "乙巳");
  assert.equal(api.computeAlmanac(new Date(2026, 1, 20, 12)).yearGanzhi, "丙午");
  // The 立春-based year (not shown) turns at 立春, before the lunar year.
  assert.equal(api.computeAlmanac(new Date(2026, 1, 10, 12)).lichunYearGanzhi, "丙午");
});

test("yearGanzhi survives engines without relatedYear, and without Intl's chinese calendar", () => {
  const fakeIntl = (parts) => ({ DateTimeFormat: function () { return { formatToParts: () => parts, format: () => "" }; } });
  const d = new Date(2026, 0, 15, 12);
  const named = harness({ Intl: fakeIntl([{ type: "yearName", value: "乙巳" }]) }).api;
  assert.equal(named.yearGanzhi(d), "乙巳");
  const plain = harness({ Intl: fakeIntl([{ type: "year", value: "2025" }]) }).api;
  assert.equal(plain.yearGanzhi(d), "乙巳");
  const cyclic = harness({ Intl: fakeIntl([{ type: "year", value: "42" }]) }).api; // 42nd of 60 = 乙巳
  assert.equal(cyclic.yearGanzhi(d), "乙巳");
  const broken = { DateTimeFormat: function () { throw new RangeError("no chinese calendar"); } };
  const none = harness({ Intl: broken }).api;
  // Falls back to the 立春 year: right before 立春, and right after 春节.
  assert.equal(none.yearGanzhi(new Date(2026, 0, 15, 12)), "乙巳");
  assert.equal(none.yearGanzhi(new Date(2026, 2, 1, 12)), "丙午");
  assert.equal(none.computeAlmanac(new Date(2026, 2, 1, 12)).lunarLabel, "");
});

test("节月 turns exactly on the local 交节 day of each 节 (and agrees with 今日交节)", () => {
  const { api } = harness();
  const JIE = ["立春", "惊蛰", "清明", "立夏", "芒种", "小暑", "立秋", "白露", "寒露", "立冬", "大雪", "小寒"];
  let prev = api.jieMonthInfo(new Date(2024, 11, 31, 12));
  let turns = 0;
  for (let i = 0; i < 4 * 366; i++) {
    const day = new Date(2025, 0, 1 + i, 12);
    if (day.getFullYear() > 2028) break;
    const jm = api.jieMonthInfo(day);
    const ti = api.solarTermInfo(day);
    const crossesJie = !!(ti.today && JIE.includes(ti.today.name));
    assert.equal(jm.today, crossesJie, day.toDateString());
    if (crossesJie) {
      turns++;
      assert.equal(jm.termName, ti.today.name);
      assert.equal(jm.branchIdx, (prev.branchIdx + 1) % 12, `month advances on ${day.toDateString()}`);
      assert.equal(JIE.indexOf(jm.termName), jm.monthIdx);
    } else {
      assert.equal(jm.branchIdx, prev.branchIdx, `no change on ${day.toDateString()}`);
    }
    prev = jm;
  }
  assert.equal(turns, 48);
});

test("建除 advances daily and repeats on every 交节 day, in any time zone", () => {
  const { api } = harness();
  const ORDER = "建除满平定执破危成收开闭";
  let prev = api.computeAlmanac(new Date(2024, 11, 31, 12)).jianchu;
  for (let i = 0; i < 365 * 2; i++) {
    const day = new Date(2026, 0, 1 + i, 12);
    const cur = api.computeAlmanac(day).jianchu;
    const turned = api.jieMonthInfo(day).today;
    if (i > 0) {
      const step = (ORDER.indexOf(cur) - ORDER.indexOf(prev) + 12) % 12;
      assert.equal(step, turned ? 0 : 1, day.toDateString());
    }
    prev = cur;
  }
});

test("煞方 follows the 三合 group of the day branch, not the clash direction", () => {
  const { api } = harness();
  const expected = { 子: "南", 辰: "南", 申: "南", 巳: "东", 酉: "东", 丑: "东", 寅: "北", 午: "北", 戌: "北", 亥: "西", 卯: "西", 未: "西" };
  for (const [b, dir] of Object.entries(expected)) assert.equal(api.shaDirectionOf(api.ZHI.indexOf(b)), dir, b);
  // 2026-11-24 is 壬寅 by local calendar date in every zone.
  const a = api.computeAlmanac(new Date(2026, 10, 24, 12));
  assert.equal(a.dayGanzhi, "壬寅");
  assert.equal(a.chongSha, "冲猴煞北");
  assert.equal(a.chong, "猴");
  assert.equal(a.sha, "北");
});

test("card labels 十二建除 as 建除 — 值神 is reserved for the 黄道黑道 gods", () => {
  const { api, surface } = harness();
  const s = surface();
  api.renderSelection({ cat: "almanac", data: api.computeAlmanac(new Date(2026, 10, 24, 12)) }, s);
  assert.ok(s.body.innerHTML.includes("建除 <b>平</b>"), "2026-11-24 壬寅 in 亥月 is 平");
  assert.ok(!s.body.innerHTML.includes("值神"));
});

test("宜忌 / 吉神凶神 / 彭祖 picks are unchanged by the M1 refactor", () => {
  const { api } = harness();
  const a = api.computeAlmanac(new Date(2026, 10, 24, 12));
  assert.deepEqual(a.yi, ["结网", "祭祀", "出行", "交易", "牧养"]);
  assert.deepEqual(a.ji, ["开池", "开市", "词讼"]);
  assert.deepEqual(a.jiShen.map((g) => g.name), ["天德", "天喜", "时德"]);
  assert.deepEqual(a.xiongShen.map((g) => g.name), ["勾陈", "往亡"]);
  assert.deepEqual(a.pengzu, ["壬不汲水，更难提防", "寅不祭祀，神鬼不尝"]);
  const b = api.computeAlmanac(new Date(2027, 0, 31, 12));
  assert.deepEqual(b.yi, ["安机械", "挂匾", "纳采", "领证"]);
  assert.deepEqual(b.xiongShen.map((g) => g.name), ["天刑", "朱雀"]);
});
