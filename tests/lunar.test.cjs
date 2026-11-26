"use strict";
/* The site's own lunar calendar (js/lunar.js + the solar terms and ΔT of
   js/app.js), checked against two independent references:
   · tests/fixtures/new-moons-horizons.json — every new moon 1950–2100 by
     JPL Horizons (DE441), scripts/new-moon-reference.cjs;
   · tests/fixtures/lunar-months.json — the first day of every lunar
     month 1950 … 2100-02-08 by cnlunar's table, scripts/lunar-golden.py
     (daily values for 2025–2028 are checked in almanac-golden.test.cjs).
   The reference calendar is in Beijing time, so the zone is pinned
   before any Date is built (each test file runs in its own process). The
   time-zone convention itself is checked in almanac.test.cjs, which runs
   in whatever zone the machine has. Rules and sources:
   docs/almanac-rules.md §1a. */
process.env.TZ = "Asia/Shanghai";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness } = require("./almanac-harness.cjs");

const { api } = harness();
const { NAM_LUNAR, LUNAR } = api;
const DAY = 86400000;
const iso = (dn) => new Date(dn * DAY).toISOString().slice(0, 10);
const dayNumber = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const at = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };

test("Meeus example 49.a: the new moon of 1977 February is JDE 2443192.65118", () => {
  assert.ok(Math.abs(NAM_LUNAR.newMoonJDE(-283) - 2443192.65118) < 1e-5);
});

test("every new moon 1950–2100 is within 18 s (TT) of JPL Horizons; mean |error| under 4 s", () => {
  const fx = require("./fixtures/new-moons-horizons.json");
  assert.equal(fx.rows.length, 1868);
  const err = fx.rows.map(([k, jde]) => (NAM_LUNAR.newMoonJDE(k) - jde) * 86400);
  const worst = Math.max(...err.map(Math.abs));
  const mean = err.reduce((s, e) => s + Math.abs(e), 0) / err.length;
  assert.ok(worst < 18, `max |error| ${worst.toFixed(1)} s`);
  assert.ok(mean < 4, `mean |error| ${mean.toFixed(2)} s`);
});

test("first quarters, full moons and last quarters (every 6th lunation) are within 18 s of JPL Horizons", () => {
  const fx = require("./fixtures/new-moons-horizons.json");
  assert.equal(fx.phases.length, 3 * 312);
  for (const q of [1, 2, 3]) {
    const err = fx.phases.filter((r) => r[1] === q).map(([k, , jde]) => Math.abs(NAM_LUNAR.phaseJDE(k, q) - jde) * 86400);
    assert.ok(Math.max(...err) < 18, `${NAM_LUNAR.PHASE_NAMES[q]} max ${Math.max(...err).toFixed(1)} s`);
    assert.ok(err.reduce((s, e) => s + e, 0) / err.length < 5, NAM_LUNAR.PHASE_NAMES[q]);
  }
  // Meeus example 49.b: the last quarter of 2044 January is JDE 2467636.49186.
  assert.ok(Math.abs(NAM_LUNAR.phaseJDE(544, 3) - 2467636.49186) < 1e-5);
});

test("TT − UTC model: observed ΔT before 1972, the leap-second table after, 69.184 s from 2017 on", () => {
  const dt = api.civilDeltaTSeconds;
  assert.equal(dt(1950), 29.07);
  assert.equal(dt(1970), 40.18);
  assert.ok(Math.abs(dt(1972) - 42.184) < 1e-9);  // TAI − UTC = 10 s
  assert.ok(Math.abs(dt(2000) - 64.184) < 1e-9);  // 32 s
  assert.ok(Math.abs(dt(2016.9) - 68.184) < 1e-9);
  for (const y of [2017, 2026, 2057, 2100]) assert.ok(Math.abs(dt(y) - 69.184) < 1e-9, String(y));
  for (let y = 1900; y < 2150; y += 0.25) assert.ok(Math.abs(dt(y + 0.25) - dt(y)) <= 1.0001, `jump near ${y}`);
  // The sky/horoscope ΔT (pinned elsewhere) stays within 0.4 s of it in 2000–2030.
  for (let y = 2000; y <= 2030; y++) assert.ok(Math.abs(api.deltaTSeconds(y) - dt(y)) < 1.1, String(y));
});

test("labels: 初一…初十 十一…二十 廿一…廿九 三十, months 正月…十一月 腊月, 闰 prefix", () => {
  const days = Array.from({ length: 30 }, (_, i) => NAM_LUNAR.dayName(i + 1)).join(" ");
  assert.equal(days, "初一 初二 初三 初四 初五 初六 初七 初八 初九 初十 十一 十二 十三 十四 十五 十六 十七 十八 十九 二十 " +
    "廿一 廿二 廿三 廿四 廿五 廿六 廿七 廿八 廿九 三十");
  assert.equal(NAM_LUNAR.label({ month: 10, day: 18, leap: false }), "十月十八");
  assert.equal(NAM_LUNAR.label({ month: 6, day: 3, leap: true }), "闰六月初三");
  assert.equal(NAM_LUNAR.label({ month: 12, day: 29, leap: false }), "腊月廿九");
  assert.equal(NAM_LUNAR.label({ month: 11, day: 1, leap: false }), "十一月初一");
  assert.equal(api.lunarDate(at("2026-11-26")).label, "十月十八");
  assert.equal(api.lunarDate(at("2025-07-27")).label, "闰六月初三");
  assert.equal(api.lunarDate(at("2026-02-16")).label, "腊月廿九");
});

/* New moons whose Beijing-time instant lies within 2 minutes of midnight
   (1950–2100). There the month's first day hangs on the last seconds of
   the ephemeris and on how civil time will track TT; see
   docs/almanac-rules.md §1a. Times are ours (Meeus + TT − UTC); "true"
   adds the Horizons correction from new-moons-horizons.json. */
const NEAR_MIDNIGHT = {
  "2057-09-29": "00:00:37 (true 00:00:44) — cnlunar's table: 09-28",
  "2089-09-04": "23:59:25 (true 23:59:24) — cnlunar agrees",
  "2097-08-08": "00:01:47 (true 00:01:48) — cnlunar's table: 08-07",
};
/* The only days on which cnlunar's table and our calendar differ, 1950 …
   2100-02-08. Both are the near-midnight new moons above: our civil time
   is UTC with TT − UTC held at 69.184 s (no further leap seconds, as JPL
   Horizons also assumes), which puts the conjunction just after Beijing
   midnight; a table computed with a growing UT1 forecast of ΔT (~+100 s
   by 2057) puts it just before. Each is a single day: the month before
   gets a 30th day instead of the next month starting early. */
const REFERENCE_DISPUTES = {
  "2057-09-28": { ours: "八月三十", reference: [2057, 9, false] },
  "2097-08-07": { ours: "六月三十", reference: [2097, 7, false] },
};

test("month starts and leap months 1950 … 2100-02-08 equal cnlunar's table (two documented disputes)", () => {
  const fx = require("./fixtures/lunar-months.json");
  const [lo, hi] = fx.range;
  const ours = [];
  for (let y = 1949; y <= 2100; y++) {
    for (const m of LUNAR.monthsOfYear(y)) if (m.start >= lo && m.start <= hi) ours.push([m.start, y, m.month, m.leap]);
  }
  assert.equal(fx.starts.length, 1856);
  const disputed = Object.keys(REFERENCE_DISPUTES);
  const shifted = (d) => iso(dayNumber(d) + 1);
  assert.deepEqual(ours.filter(([d]) => disputed.map(shifted).includes(d)).map((r) => r[0]), disputed.map(shifted));
  const expected = fx.starts.map((r) => (disputed.includes(r[0]) ? [shifted(r[0]), ...r.slice(1)] : r));
  assert.deepEqual(ours, expected);
  for (const [d, { ours: label, reference }] of Object.entries(REFERENCE_DISPUTES)) {
    assert.equal(api.lunarDate(at(d)).label, label, d);
    assert.deepEqual(fx.starts.find((r) => r[0] === d).slice(1), reference, d);
  }
  // …which pins every day: spot-check that day numbers inside months follow.
  for (const [d, y, m, leap] of fx.starts.filter((_, i) => i % 97 === 0)) {
    const l = LUNAR.fromDayNumber(dayNumber(d) + 13);
    assert.deepEqual([l.year, l.month, l.leap, l.day], [y, m, leap, 14], d);
  }
});

test("every month has 29 or 30 days, every lunar year 12 or 13 months with at most one 闰", () => {
  for (let y = 1950; y <= 2100; y++) {
    const ms = LUNAR.monthsOfYear(y);
    assert.ok(ms.length === 12 || ms.length === 13, `${y}: ${ms.length}`);
    assert.equal(ms.filter((m) => m.leap).length, ms.length - 12, String(y));
    assert.equal(ms[0].month, 1);
    for (const m of ms) assert.ok(m.days === 29 || m.days === 30);
  }
});

test("worked leap months: 2023 闰二月, 2025 闰六月, 2028 闰五月, 2033 闰十一月 (the 「2033 problem」)", () => {
  const leapOf = (y) => LUNAR.monthsOfYear(y).find((m) => m.leap);
  assert.deepEqual([leapOf(2023).month, leapOf(2023).start], [2, "2023-03-22"]);
  assert.deepEqual([leapOf(2025).month, leapOf(2025).start], [6, "2025-07-25"]);
  assert.deepEqual([leapOf(2028).month, leapOf(2028).start], [5, "2028-06-23"]);
  // 2033: 13 months between the 冬至 months, and 闰十一月 (not 闰七月) is the first without a 中气.
  assert.deepEqual([leapOf(2033).month, leapOf(2033).start], [11, "2033-12-22"]);
  assert.equal(leapOf(2026), undefined);
});

test("new moons within 2 minutes of Beijing midnight, 1950–2100, are exactly the documented ones", () => {
  const near = [];
  for (let k = LUNAR.lunationContaining(dayNumber("1950-01-01")); k <= LUNAR.lunationContaining(dayNumber("2100-12-31")); k++) {
    const ms = LUNAR.newMoonMs(k) + 8 * 3600000;
    const into = ((ms % DAY) + DAY) % DAY;
    if (Math.min(into, DAY - into) < 120000) near.push(iso(Math.floor(ms / DAY)));
  }
  assert.deepEqual(near, Object.keys(NEAR_MIDNIGHT));
});

test("2027-02-06 (new moon 23:56 Beijing time) is 正月初一 of 丁未 and 春节; 02-05 is 除夕", () => {
  const ms = LUNAR.newMoonMs(LUNAR.lunationContaining(dayNumber("2027-02-06")));
  assert.equal(new Date(ms + 8 * 3600000).toISOString().slice(0, 16), "2027-02-06T23:56");
  const l = api.lunarDate(at("2027-02-06"));
  assert.deepEqual([l.year, l.month, l.day, l.leap, l.yearGanzhi, l.label], [2027, 1, 1, false, "丁未", "正月初一"]);
  assert.equal(api.computeAlmanac(at("2027-02-06")).yearGanzhi, "丁未");
  assert.equal(api.lunarFestivalOn(at("2027-02-06")).key, "chunjie");
  assert.equal(api.lunarFestivalOn(at("2027-02-05")).key, "chuxi");
  assert.equal(api.lunarDate(at("2027-02-05")).label, "腊月廿九"); // a 29-day 腊月: 除夕 on 廿九
  assert.equal(api.lunarFestivalOn(at("2027-02-20")).key, "yuanxiao");
  assert.equal(api.lunarFestivalOn(at("2027-02-07")), null);
});

test("leap months host no festivals or lunar birthdays: the regular month wins", () => {
  // 2025: 六月 from 06-25, 闰六月 from 07-25. 2028: 五月 from 05-24, 闰五月 from 06-23.
  api.setMyDays([{ name: "生日", cal: "lunar", month: 6, day: 3, effect: "dress" }]);
  assert.equal(api.matchPersonalDay(at("2025-06-27")).name, "生日"); // 六月初三
  assert.equal(api.matchPersonalDay(at("2025-07-27")), null);       // 闰六月初三
  api.setMyDays([]);
  assert.equal(api.lunarFestivalOn(at("2028-05-28")).key, "duanwu"); // 五月初五
  assert.equal(api.lunarDate(at("2028-06-27")).label, "闰五月初五");
  assert.equal(api.lunarFestivalOn(at("2028-06-27")), null);
});

test("no Intl chinese calendar anywhere in the site", () => {
  const root = path.join(__dirname, "..");
  const files = ["sw.js", "index.html", "about.html", "library.html", "privacy.html",
    ...fs.readdirSync(path.join(root, "js")).map((f) => "js/" + f)];
  for (const f of files) {
    assert.ok(!/ca-chinese|calendar:\s*["']chinese/.test(fs.readFileSync(path.join(root, f), "utf8")), f);
  }
});

test("a year of lookups stays fast (months are computed once per 岁 and cached)", () => {
  const t0 = Date.now();
  for (let i = 0; i < 366 * 3; i++) api.lunarDate(new Date(2030, 0, 1 + i, 12));
  assert.ok(Date.now() - t0 < 1500);
});
