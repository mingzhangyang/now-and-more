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

test("card labels 十二建除 as 建除 and shows the 黄道黑道 值神 beside it", () => {
  const { api, surface } = harness();
  const s = surface();
  api.renderSelection({ cat: "almanac", data: api.computeAlmanac(new Date(2026, 10, 24, 12)) }, s);
  assert.ok(s.body.innerHTML.includes("建除 <b>平</b>"), "2026-11-24 壬寅 in 亥月 is 平");
  assert.ok(s.body.innerHTML.includes("值神 <b>天牢</b>（黑道）"), "亥月: 青龙 on 午, so 寅 is 天牢");
  assert.ok(s.meta.textContent.endsWith("丙午年 己亥月"), s.meta.textContent);
});

test("彭祖百忌 is the classic stem/branch lookup", () => {
  const { api } = harness();
  assert.deepEqual(api.computeAlmanac(new Date(2026, 10, 24, 12)).pengzu, ["壬不汲水，更难提防", "寅不祭祀，神鬼不尝"]);
});

test("nothing in the almanac is random: no seeded pick left, Math.random never read", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  for (const f of ["js/app.js", "js/data.js", "js/almanac-rules.js"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/seededDailyPick|ALMANAC_YI|ALMANAC_JI/.test(src), `${f} still has the seeded 宜忌`);
  }
  const rules = fs.readFileSync(path.join(root, "js/almanac-rules.js"), "utf8");
  assert.ok(!/Math\.random/.test(rules));
  const { api } = harness();
  const real = Math.random;
  Math.random = () => { throw new Error("the almanac read Math.random"); };
  try {
    const d = new Date(2026, 10, 24, 12);
    assert.deepEqual(api.computeAlmanac(d).yiJi, api.computeAlmanac(new Date(d)).yiJi);
  } finally { Math.random = real; }
});

test("宜/忌 are disjoint lists of the 用事 vocabulary, in its order, each traced to a source", () => {
  const { api } = harness();
  const V = api.NAM_ALMANAC.YONGSHI.map((y) => y.name);
  assert.ok(V.length >= 30 && V.length <= 40, `vocabulary of ${V.length}`);
  assert.equal(new Set(V).size, V.length);
  for (const y of api.NAM_ALMANAC.YONGSHI) assert.ok(y.gloss.length > 0 && y.gloss.length <= 8, y.name);
  const known = new Set([...api.NAM_ALMANAC.JI_NAMES, ...api.NAM_ALMANAC.XIONG_NAMES, ..."建除满平定执破危成收开闭".split("").map((c) => c + "日")]);
  let allJiDays = 0;
  for (let i = 0; i < 2 * 365; i++) {
    const a = api.computeAlmanac(new Date(2026, 0, 1 + i, 12));
    const yj = a.yiJi;
    const label = `${a.dayGanzhi} ${a.jieMonth.branch}月 ${a.jianchu}`;
    assert.deepEqual(a.yi, yj.yi);
    for (const list of [a.yi, a.ji]) {
      const idx = list.map((n) => V.indexOf(n));
      assert.ok(idx.every((k) => k >= 0), label);
      assert.deepEqual(idx, [...idx].sort((x, y) => x - y), `${label}: vocabulary order`);
    }
    assert.ok(!a.yi.some((n) => a.ji.includes(n)), `${label}: an item in both lists`);
    // Each graded god's 「從X論」 points at a god that really sits on the day.
    for (const [g, v] of Object.entries(yj.graded)) assert.ok(v !== "J?", `${label}: ${g} defers to an absent god`);
    if (yj.allJi) {
      allJiDays++;
      assert.deepEqual(a.yi, []);
      assert.deepEqual(a.ji, V);
      assert.equal(yj.level.code, "X");
      continue;
    }
    const byName = new Map(yj.trace.map((t) => [t.name, t]));
    for (const n of a.yi) {
      const t = byName.get(n);
      assert.equal(t.result, "宜");
      assert.ok(t.yi.length > 0, `${label}: 宜 ${n} without a source`);
    }
    for (const n of a.ji) {
      const t = byName.get(n);
      assert.equal(t.result, "忌");
      assert.ok(t.ji.length > 0, `${label}: 忌 ${n} without a source`);
    }
    for (const t of yj.trace) for (const src of [...t.yi, ...t.ji]) {
      assert.ok(known.has(src) || api.NAM_ALMANAC.YIJI_SOURCES.includes(src), `${label}: unknown source ${src}`);
    }
  }
  assert.ok(allJiDays > 20 && allJiDays < 150, `${allJiDays} 诸事皆忌 days in two years`);
});

test("宜忌 invariants that follow from the book in any time zone", () => {
  const { api } = harness();
  const LIJUE_OK = new Set(["祭祀", "解除", "沐浴", "剃头", "扫舍宇", "修饰垣墙", "平治道涂", "破屋坏垣", "伐木"]);
  const PO_OK = new Set(["祭祀", "入学", "解除", "沐浴", "求医疗病", "扫舍宇", "平治道涂", "破屋坏垣", "捕捉", "畋猎"]);
  let li = 0, po = 0;
  for (let i = 0; i < 2 * 365; i++) {
    const a = api.computeAlmanac(new Date(2026, 0, 1 + i, 12));
    const xs = new Set(a.xiongShen.map((g) => g.name));
    const label = `${a.dayGanzhi} ${a.jieMonth.branch}月 ${a.jianchu}`;
    // 四離 四絶: 「止不忌祭祀解除沐浴……伐木，餘事皆忌；與徳合赦願併猶忌」.
    if (xs.has("四离") || xs.has("四绝")) {
      li++;
      assert.ok(a.yi.every((n) => LIJUE_OK.has(n)), `${label}: ${a.yi}`);
      if (!a.yiJi.allJi) assert.ok(a.yiJi.trace.length && api.NAM_ALMANAC.YONGSHI.every((y) => LIJUE_OK.has(y.name) || a.ji.includes(y.name)), label);
    }
    // 月破: 德 cannot lift it, so only the few 「不忌」 用事 can be 宜.
    if (xs.has("月破")) { po++; assert.ok(a.yi.every((n) => PO_OK.has(n)), `${label}: ${a.yi}`); }
    // 往亡, 归忌: 猶忌 whatever 吉神 sit on the day.
    if (xs.has("往亡")) for (const n of ["出行", "嫁娶", "移徙"]) assert.ok(a.ji.includes(n), `${label} 往亡 ${n}`);
    if (xs.has("归忌")) assert.ok(a.ji.includes("移徙"), `${label} 归忌`);
    // 亥日不嫁娶, 寅日不祭祀 (百忌日), unless the whole day is 诸事皆忌 anyway.
    if (a.dayGanzhi[1] === "亥") assert.ok(a.ji.includes("嫁娶"), label);
    if (a.dayGanzhi[1] === "寅") assert.ok(a.ji.includes("祭祀") && !a.yi.includes("祈福"), label);
  }
  assert.ok(li >= 16 && po >= 55, `${li} 四离/四绝 days, ${po} 月破 days`);
});

test("card shows the first 宜/忌 in vocabulary order, 「等N事」 for the rest, and 诸事皆忌 days plainly", () => {
  const { api, surface } = harness();
  let long = null, allJi = null;
  for (let i = 0; i < 400 && !(long && allJi); i++) {
    const a = api.computeAlmanac(new Date(2026, 0, 1 + i, 12));
    if (!long && a.yi.length > 8) long = a;
    if (!allJi && a.yiJi.allJi) allJi = a;
  }
  let s = surface();
  api.renderSelection({ cat: "almanac", data: long }, s);
  const row = s.body.innerHTML.match(/<b>宜<\/b> (.*?)<\/span><\/div>/)[1];
  const shown = [...row.matchAll(/<span title="[^"]+">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(shown, long.yi.slice(0, 8));
  assert.ok(row.includes(`等${long.yi.length}事`), row);
  assert.ok(!s.body.innerHTML.includes("趣味"));
  assert.ok(s.body.innerHTML.includes("协纪辨方书"), "footnote names the source");
  s = surface();
  api.renderSelection({ cat: "almanac", data: allJi }, s);
  assert.ok(s.body.innerHTML.includes("<b>宜</b> 诸事不宜"));
  assert.ok(s.body.innerHTML.includes("<b>忌</b> 诸事皆忌"));
  // The 全文 reading gives every 宜/忌 with its sources.
  const full = api.almanacFullText(long);
  for (const n of long.yi) assert.ok(new RegExp(`宜 ${n}（[^）]+）← `).test(full), n);
  for (const n of long.ji) assert.ok(full.includes(`忌 ${n} ← `), n);
  assert.ok(full.includes("等第："));
  assert.ok(!full.includes("趣味"));
  assert.ok(api.almanacFullText(allJi).includes("诸事皆忌"));
});

test("黄道黑道: 青龙 placement by month branch, six 黄道 gods, order by day branch", () => {
  const { api } = harness();
  const Z = api.ZHI;
  const qinglong = { 寅: "子", 申: "子", 卯: "寅", 酉: "寅", 辰: "辰", 戌: "辰", 巳: "午", 亥: "午", 子: "申", 午: "申", 丑: "戌", 未: "戌" };
  const ORDER = ["青龙", "明堂", "天刑", "朱雀", "金匮", "天德", "白虎", "玉堂", "天牢", "玄武", "司命", "勾陈"];
  for (const [mb, day] of Object.entries(qinglong)) {
    for (let k = 0; k < 12; k++) {
      const g = api.NAM_ALMANAC.zhiShenOf((Z.indexOf(day) + k) % 12, Z.indexOf(mb));
      assert.equal(g.name, ORDER[k], `${mb}月 ${Z[(Z.indexOf(day) + k) % 12]}日`);
      assert.equal(g.huangdao, [0, 1, 4, 5, 7, 10].includes(k));
    }
  }
});

test("值神 steps +1 a day and −1 on each 交节 day, in any time zone", () => {
  const { api } = harness();
  const ORDER = api.NAM_ALMANAC.ZHISHEN;
  let prev = api.computeAlmanac(new Date(2025, 11, 31, 12)).zhiShen.name;
  for (let i = 0; i < 365 * 2; i++) {
    const day = new Date(2026, 0, 1 + i, 12);
    const cur = api.computeAlmanac(day).zhiShen.name;
    const step = (ORDER.indexOf(cur) - ORDER.indexOf(prev) + 12) % 12;
    assert.equal(step, api.jieMonthInfo(day).today ? 11 : 1, day.toDateString());
    prev = cur;
  }
});

test("四离 / 四绝 fall on the local day before 分至 / 四立; 土王用事 is the 18 days before 四立", () => {
  const { api } = harness();
  const LI = ["春分", "夏至", "秋分", "冬至"], JUE = ["立春", "立夏", "立秋", "立冬"];
  let tuWangRun = 0;
  for (let i = 0; i < 366 * 2; i++) {
    const day = new Date(2026, 0, 1 + i, 12);
    const next = api.solarTermInfo(new Date(2026, 0, 2 + i, 12)).today;
    const names = api.computeAlmanac(day).xiongShen.map((g) => g.name);
    assert.equal(names.includes("四离"), !!(next && LI.includes(next.name)), day.toDateString());
    assert.equal(names.includes("四绝"), !!(next && JUE.includes(next.name)), day.toDateString());
    const tw = api.tuWangYongShi(day);
    if (tw) tuWangRun++;
    if (next && JUE.includes(next.name)) {
      assert.equal(tw, true, "the eve of a 四立 is inside 土王用事");
      assert.equal(tuWangRun, 18, `18 days of 土王用事 before ${next.name}`);
    }
    if (!tw) tuWangRun = 0;
  }
});

test("吉神/凶神 are rule-derived {name, gloss} lists with no duplicated 值神", () => {
  const { api } = harness();
  const JI = new Set(api.NAM_ALMANAC.JI_NAMES), XIONG = new Set(api.NAM_ALMANAC.XIONG_NAMES);
  // Only 天德 shares a name with a 值神 — the month table's 天德, a different god from 黄道 天德.
  const shared = api.NAM_ALMANAC.ZHISHEN.filter((n) => JI.has(n) || XIONG.has(n));
  assert.deepEqual(shared, ["天德"]);
  for (let i = 0; i < 120; i++) {
    const a = api.computeAlmanac(new Date(2026, 0, 1 + i * 3, 12));
    for (const g of [...a.jiShen, ...a.xiongShen]) {
      assert.deepEqual(Object.keys(g), ["name", "gloss"]);
      assert.ok(g.gloss.length > 0 && g.gloss.length <= 16, g.name);
    }
    assert.ok(a.jiShen.every((g) => JI.has(g.name)) && a.xiongShen.every((g) => XIONG.has(g.name)));
    // 月破 and 大耗 share the 破日; 生气 is the 开日; 死神 the 平日.
    const has = (n) => [...a.jiShen, ...a.xiongShen].some((g) => g.name === n);
    assert.equal(has("月破"), a.jianchu === "破");
    assert.equal(has("大耗"), a.jianchu === "破");
    assert.equal(has("生气"), a.jianchu === "开");
    assert.equal(has("死神"), a.jianchu === "平");
  }
});

test("card lists god names only (gloss on hover); the 全文 reading gives every gloss", () => {
  const { api, surface } = harness();
  const a = api.computeAlmanac(new Date(2026, 10, 24, 12));
  const s = surface();
  api.renderSelection({ cat: "almanac", data: a }, s);
  const body = s.body.innerHTML;
  for (const g of [...a.jiShen, ...a.xiongShen]) {
    assert.ok(body.includes(`<span title="${g.gloss}">${g.name}</span>`), g.name);
    assert.ok(!body.includes(`${g.name}（`), `${g.name} has no inline gloss`);
  }
  const full = api.almanacFullText(a);
  assert.ok(full.includes("值神 天牢（黑道）"));
  assert.ok(full.includes("丙午年 己亥月 壬寅日"));
  for (const g of [...a.jiShen, ...a.xiongShen]) assert.ok(full.includes(`${g.name}：${g.gloss}`), g.name);
});
