#!/usr/bin/env node
"use strict";
/* Agreement of the almanac's 宜/忌 (NAM_ALMANAC.yiJi) with cnlunar's
   goodThing/badThing, as recorded in tests/fixtures/almanac-golden.json
   (every day of 2025–2028, Beijing time; see scripts/almanac-golden.py).

   cnlunar reads 《协纪辨方书》 its own way and writes 用事 in its own mixed
   vocabulary, so the comparison is restricted to OUR vocabulary: each
   cnlunar word is mapped onto one of our 用事 (CN_TO_OURS) or ignored.
   cnlunar's 「诸事不宜」 (its 诸事皆忌 days) counts as 忌 for every 用事.

     node scripts/almanac-yiji-agreement.cjs           # print the report
     node scripts/almanac-yiji-agreement.cjs --write   # also refresh the baseline
                                                       # docs/almanac-yiji-baseline.json

   tests/almanac-yiji.test.cjs fails if the contradiction count rises or a
   precision/recall figure falls below that baseline. Refresh it only after
   an intentional rule change, and update docs/almanac-rules.md §5 with it. */
process.env.TZ = "Asia/Shanghai"; // before any Date is built: the reference is in Beijing time

const fs = require("node:fs");
const path = require("node:path");
const { harness } = require(path.join(__dirname, "..", "tests", "almanac-harness.cjs"));

const BASELINE = path.join(__dirname, "..", "docs", "almanac-yiji-baseline.json");

/* cnlunar word → our 用事. Words not listed (御用 items such as 颁诏 覃恩
   上册, and 进人口 冠带 经络 酝酿 修仓库 筑堤防 补垣 … that our vocabulary
   leaves out, plus cnlunar's non-book additions 入宅 开张 诉讼) are ignored. */
const CN_TO_OURS = {
  祭祀: "祭祀", 祈福: "祈福", 求嗣: "求嗣", 宴会: "会亲友", 会亲友: "会亲友", 入学: "入学",
  出行: "出行", 上官: "赴任", 赴任: "赴任", 纳采: "纳采", 嫁娶: "嫁娶", 搬移: "移徙", 移徙: "移徙",
  安床: "安床", 解除: "解除", 沐浴: "沐浴", 剃头: "剃头", 整容: "剃头", 求医疗病: "求医疗病",
  裁制: "裁衣", 裁衣: "裁衣", 修造: "修造动土", 动土: "修造动土", 竖柱上梁: "竖柱上梁",
  开市: "开市", 立券交易: "立券交易", 立券: "立券交易", 纳财: "纳财", 开仓: "开仓",
  开渠: "开渠穿井", 穿井: "开渠穿井", 扫舍宇: "扫舍宇", 修饰垣墙: "修饰垣墙", 平治道涂: "平治道涂",
  破屋坏垣: "破屋坏垣", 伐木: "伐木", 捕捉: "捕捉", 畋猎: "畋猎", 栽种: "栽种", 牧养: "牧养",
  纳畜: "纳畜", 破土: "破土", 安葬: "安葬", 启攒: "启攒",
};

const ratio = (a, b) => (b ? Math.round((a / b) * 1e4) / 1e4 : null);

function evaluate(fixture, api) {
  if (!api) api = harness().api;
  const vocab = api.NAM_ALMANAC.YONGSHI.map((y) => y.name);
  const F = fixture.fields;
  const col = (r, k) => r[F.indexOf(k)];
  const mapWords = (s) => {
    const words = s ? s.split(" ") : [];
    if (words.includes("诸事不宜")) return { all: true, set: new Set() };
    return { all: false, set: new Set(words.map((w) => CN_TO_OURS[w]).filter(Boolean)) };
  };
  const per = Object.fromEntries(vocab.map((n) => [n, { yi: { tp: 0, ours: 0, ref: 0 }, ji: { tp: 0, ours: 0, ref: 0 }, contradictions: 0 }]));
  const tot = { yi: { tp: 0, ours: 0, ref: 0 }, ji: { tp: 0, ours: 0, ref: 0 } };
  const dayP = { yi: [], ji: [] }, dayR = { yi: [], ji: [] };
  let contradictions = 0, contradictionDays = 0, ourItems = 0;
  const causes = {};
  const allJi = { both: 0, oursOnly: 0, refOnly: 0 };
  const examples = [];
  for (const r of fixture.rows) {
    const [y, m, d] = r[0].split("-").map(Number);
    const a = api.computeAlmanac(new Date(y, m - 1, d, 12));
    const refYi = mapWords(col(r, "yi")), refJi = mapWords(col(r, "ji"));
    const ref = { yi: refYi.all ? new Set() : refYi.set, ji: refJi.all ? new Set(vocab) : refJi.set };
    const ours = { yi: new Set(a.yi), ji: new Set(a.ji) };
    const refAll = refJi.all;
    if (a.yiJi.allJi && refAll) allJi.both++; else if (a.yiJi.allJi) allJi.oursOnly++; else if (refAll) allJi.refOnly++;
    ourItems += ours.yi.size + ours.ji.size;
    for (const k of ["yi", "ji"]) {
      let tp = 0;
      for (const n of ours[k]) if (ref[k].has(n)) { tp++; per[n][k].tp++; }
      for (const n of ours[k]) per[n][k].ours++;
      for (const n of ref[k]) per[n][k].ref++;
      tot[k].tp += tp; tot[k].ours += ours[k].size; tot[k].ref += ref[k].size;
      if (ours[k].size) dayP[k].push(tp / ours[k].size);
      if (ref[k].size) dayR[k].push(tp / ref[k].size);
    }
    let dayC = 0;
    const trace = new Map(a.yiJi.trace.map((t) => [t.name, t]));
    for (const [mine, theirs, side] of [["yi", "ji", "ours 宜, ref 忌"], ["ji", "yi", "ours 忌, ref 宜"]]) {
      for (const n of ours[mine]) {
        if (!ref[theirs].has(n)) continue;
        dayC++; per[n].contradictions++;
        const t = trace.get(n);
        const src = mine === "yi" ? t.yi.join("·") : t.ji.join("·");
        const key = `${side}: ${n} ← ${src}`;
        causes[key] = (causes[key] || 0) + 1;
        if (examples.length < 400) examples.push(`${r[0]} ${col(r, "month")}月 ${col(r, "day")} ${col(r, "jianchu")} ${side} ${n} ← ${src}`);
      }
    }
    contradictions += dayC;
    if (dayC) contradictionDays++;
  }
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1e4) / 1e4 : null);
  const summary = {
    days: fixture.rows.length,
    vocabulary: vocab.length,
    yi: { precision: ratio(tot.yi.tp, tot.yi.ours), recall: ratio(tot.yi.tp, tot.yi.ref), dayPrecision: mean(dayP.yi), dayRecall: mean(dayR.yi), ours: tot.yi.ours, ref: tot.yi.ref },
    ji: { precision: ratio(tot.ji.tp, tot.ji.ours), recall: ratio(tot.ji.tp, tot.ji.ref), dayPrecision: mean(dayP.ji), dayRecall: mean(dayR.ji), ours: tot.ji.ours, ref: tot.ji.ref },
    contradictions,
    contradictionRate: ratio(contradictions, ourItems),
    contradictionDays,
    allJiDays: allJi,
    perItem: Object.fromEntries(Object.entries(per).map(([n, p]) => [n, {
      yiPrecision: ratio(p.yi.tp, p.yi.ours), yiRecall: ratio(p.yi.tp, p.yi.ref),
      jiPrecision: ratio(p.ji.tp, p.ji.ours), jiRecall: ratio(p.ji.tp, p.ji.ref),
      contradictions: p.contradictions,
    }])),
  };
  const topCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]);
  return { summary, topCauses, examples };
}

if (require.main === module) {
  const fixture = require(path.join(__dirname, "..", "tests", "fixtures", "almanac-golden.json"));
  const { summary, topCauses, examples } = evaluate(fixture);
  const { perItem, ...head } = summary;
  console.log(JSON.stringify(head, null, 2));
  console.log("\nper 用事 (宜 P/R · 忌 P/R · contradictions):");
  for (const [n, p] of Object.entries(perItem)) {
    console.log(`  ${n.padEnd(5, "　")} 宜 ${p.yiPrecision ?? "—"} / ${p.yiRecall ?? "—"} · 忌 ${p.jiPrecision ?? "—"} / ${p.jiRecall ?? "—"} · ${p.contradictions}`);
  }
  console.log("\ntop contradiction causes:");
  for (const [k, v] of topCauses.slice(0, Number(process.env.TOP || 30))) console.log(`  ${v}\t${k}`);
  if (process.env.EXAMPLES) for (const e of examples.filter((x) => x.includes(process.env.EXAMPLES)).slice(0, 40)) console.log("  " + e);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(BASELINE, JSON.stringify(summary, null, 2) + "\n");
    console.log("\nwrote " + path.relative(process.cwd(), BASELINE));
  }
}

module.exports = { evaluate, CN_TO_OURS };
