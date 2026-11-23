/* Now, and More — app logic
   Certainty: the clock. Uncertainty: everything below it. */
"use strict";

/* ================= Config ================= */
/* Gossip feed endpoint. Leave "" to disable the gossip category entirely.
   Can also be set at runtime via window.NOW_AND_MORE_CONFIG = { gossipApi: "..." }.
   Expected JSON: { title, source, link, publishedAt, lang } — a single headline,
   an array of such objects, or { items: [...] }. Headlines only; content is
   never invented locally. */
const GOSSIP_API = "https://now-and-more.orangely.workers.dev/gossip";
const GOSSIP_CACHE_MS = 10 * 60 * 1000;
const GOSSIP_TIMEOUT_MS = 3000;
let gossipCache = [];
let gossipFetchedAt = 0;

function gossipEndpoint() {
  try {
    if (typeof window !== "undefined" && window.NOW_AND_MORE_CONFIG && window.NOW_AND_MORE_CONFIG.gossipApi) {
      return window.NOW_AND_MORE_CONFIG.gossipApi;
    }
  } catch (e) { /* ignore */ }
  return GOSSIP_API;
}

async function refreshGossip() {
  const url = gossipEndpoint();
  if (!url) return;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GOSSIP_TIMEOUT_MS);
  try {
    const fetchUrl = url + (url.includes("?") ? "&" : "?") + "lang=" + lang;
    const res = await fetch(fetchUrl, { signal: ctl.signal });
    if (!res.ok) return;
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : [data]);
    const items = raw.filter((i) => i && i.title && i.link);
    if (items.length) {
      gossipCache = items;
      gossipFetchedAt = Date.now();
    }
  } catch (e) { /* feed unavailable: gossip category stays excluded */ }
  finally { clearTimeout(timer); }
}

/* ================= State ================= */
const LS_LANG = "nam-lang";
const LS_STYLE = "nam-clock-style";
const LS_SIGN = "nam-sign";
const LS_THEME = "nam-theme";
const THEMES = ["auto", "light", "dark"];
const CLOCK_STYLES = ["paper", "minimal", "analog", "flip", "vertical"];

let lang = localStorage.getItem(LS_LANG);
if (!lang) {
  lang = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}
let clockStyle = localStorage.getItem(LS_STYLE) || "paper";
if (!CLOCK_STYLES.includes(clockStyle)) clockStyle = "paper";

/* Theme: "auto" follows prefers-color-scheme; "light"/"dark" force a
   palette via data-theme on <html> (also set pre-paint by the inline
   script in index.html). */
let theme = localStorage.getItem(LS_THEME) || "auto";
if (!THEMES.includes(theme)) theme = "auto";

/* User's zodiac sign ("" = random). Set via the sign selector; the daily
   horoscope uses it 70% of the time when set. */
let userSign = localStorage.getItem(LS_SIGN) || "";
if (userSign && !SIGNS.some((sg) => sg.key === userSign)) userSign = "";

let encounter = 0;
let lastCategory = null;
let currentSelection = null; // { cat, ...payload } — re-renderable on language switch
let lastDrawAt = Date.now();
let lastSecond = -1;

const $ = (id) => document.getElementById(id);
const t = () => I18N[lang];
const pad = (n) => String(n).padStart(2, "0");
const randInt = (max) => Math.floor(Math.random() * max);
const pick = (arr) => arr[randInt(arr.length)];

/* ================= No-repeat decks （去重） ================= */
/* Every enumerated pool is drawn as a shuffle-bag: the pool is shuffled,
   drawn without replacement, and reshuffled only when the bag is empty —
   so within a category nothing repeats until the whole pool has been
   shown once. The first draw of a fresh bag never equals the last draw
   of the previous bag (pool size > 1). The weighted category choice is
   untouched; decks govern only which item inside the category appears.
   Decks persist in localStorage under one versioned key, so a reload
   resumes mid-bag instead of re-showing recent cards. Each deck records
   its pool size and is rebuilt (alone) when its pool has grown or shrunk
   since — pools here are expanded often, and a stale index must never
   surface. Deck keys are per language where the pool is (poem:zh vs
   poem:en, quotes:zh vs quotes:en); bilingual single pools (thought,
   science…) share one deck because both languages render the same item. */
const LS_DECKS = "nam-decks-v1";
const deckStore = loadDeckStore();

function loadDeckStore() {
  const fresh = { v: 1, d: {}, g: {}, fp: [] };
  try {
    const raw = localStorage.getItem(LS_DECKS);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || typeof s.d !== "object" || s.d === null) return fresh;
    if (typeof s.g !== "object" || s.g === null) s.g = {};
    if (!Array.isArray(s.fp)) s.fp = [];
    return s;
  } catch (e) { return fresh; }
}
function saveDeckStore() {
  try {
    localStorage.setItem(LS_DECKS, JSON.stringify(deckStore));
  } catch (e) { /* storage unavailable (private mode): decks live in memory only */ }
}
function shuffledIndices(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function deckValid(d, n) {
  if (!d || d.n !== n || !Array.isArray(d.r)) return false;
  const seen = new Set();
  for (const i of d.r) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
    seen.add(i);
  }
  return d.l === null || d.l === undefined ||
    (Number.isInteger(d.l) && d.l >= 0 && d.l < n);
}
/* Draw the next index from deck `key` for a pool of size n. The bag is
   the array r, drawn from its end; l is the most recent draw. */
function deckDraw(key, n) {
  if (n <= 0) return -1;
  let d = deckStore.d[key];
  if (!deckValid(d, n)) {
    const lastOk = d && Number.isInteger(d.l) && d.l >= 0 && d.l < n ? d.l : null;
    d = { n, r: shuffledIndices(n), l: lastOk };
    deckStore.d[key] = d;
  }
  if (d.r.length === 0) {
    d.r = shuffledIndices(n);
    // Seam rule: the first draw of the new bag (the last slot, which
    // pop() takes) must differ from the previous bag's final draw.
    if (n > 1 && d.l !== null && d.l !== undefined && d.r[d.r.length - 1] === d.l) {
      [d.r[0], d.r[d.r.length - 1]] = [d.r[d.r.length - 1], d.r[0]];
    }
  }
  const idx = d.r.pop();
  d.l = idx;
  saveDeckStore();
  return idx;
}

/* Gossip has no fixed pool: headlines arrive from the feed and change
   over time. Dedupe by headline — the stable identity — kept per
   language and pruned to the current list on every draw, so brand-new
   headlines are drawable at once and vanished ones are forgotten. When
   everything current has been seen, a new cycle starts with the
   previous cycle's last headline held back for one draw, so it cannot
   repeat back-to-back (list size > 1). */
function drawGossipItem() {
  let g = deckStore.g[lang];
  if (!g || !Array.isArray(g.seen)) {
    g = { seen: [], last: null };
    deckStore.g[lang] = g;
  }
  const alive = new Set(gossipCache.map((i) => i.title));
  g.seen = g.seen.filter((title) => alive.has(title));
  let unseen = gossipCache.filter((i) => !g.seen.includes(i.title));
  if (!unseen.length) {
    g.seen = gossipCache.length > 1 && g.last && alive.has(g.last) ? [g.last] : [];
    unseen = gossipCache.filter((i) => !g.seen.includes(i.title));
    if (!unseen.length) unseen = gossipCache.slice(); // a one-headline list
  }
  const item = unseen[randInt(unseen.length)];
  g.seen.push(item.title);
  if (g.seen.length > 500) g.seen = g.seen.slice(-500);
  g.last = item.title;
  saveDeckStore();
  return item;
}

/* Chance values are generated, not enumerated, so they cannot be decked;
   instead a bounded recent-history of value fingerprints (persisted with
   the decks) rejects an exact repeat within the last few chance draws. */
function chanceFingerprint(kind, value) {
  return kind + ":" + (value && typeof value === "object" ? JSON.stringify(value) : String(value));
}
function rollChanceValue(kind) {
  if (kind === "integer") return randInt(1000000);
  if (kind === "dice") return [1 + randInt(6), 1 + randInt(6)];
  if (kind === "coins") return Array.from({ length: 8 }, () => Math.random() < 0.5);
  if (kind === "card") {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    return { rank: pick(ranks), suit: pick(["S", "H", "D", "C"]) };
  }
  // color
  return "#" + Array.from({ length: 3 }, () => pad(randInt(256).toString(16)).toUpperCase()).join("");
}

/* ================= Solar calculation (compact, after SunCalc) ================= */
const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

function toDays(date) { return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000; }
function fromJulian(j) { return new Date((j + 0.5 - J1970) * DAY_MS); }
function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(m) {
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + c + RAD * 102.9372 + Math.PI;
}
function declination(l) { return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l)); }
function siderealTime(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }
function solarTransitJ(ds, m, l) { return J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l); }

/* Returns { sunrise: Date|null, sunset: Date|null, dayMinutes, polar: null|'day'|'night' } */
function sunTimes(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const jNoon = solarTransitJ(ds, m, l);
  const h0 = RAD * -0.833;
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1) return { sunrise: null, sunset: null, dayMinutes: 0, polar: "night" };
  if (cosH < -1) return { sunrise: null, sunset: null, dayMinutes: 1440, polar: "day" };
  const w = Math.acos(cosH);
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const jSet = solarTransitJ(a, m, l);
  const jRise = jNoon - (jSet - jNoon);
  const sunrise = fromJulian(jRise);
  const sunset = fromJulian(jSet);
  return {
    sunrise,
    sunset,
    dayMinutes: Math.round((sunset - sunrise) / 60000),
    polar: null,
  };
}

/* ================= Moon phase ================= */
const MOON_GLYPHS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
function moonPhase(date) {
  const synodic = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14) / DAY_MS;
  const days = date.valueOf() / DAY_MS - knownNewMoon;
  const age = ((days % synodic) + synodic) % synodic;
  const illum = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100);
  const idx = Math.floor(((age / synodic) * 8 + 0.5)) % 8;
  return { age: Math.floor(age), illum, idx, glyph: MOON_GLYPHS[idx] };
}

/* ================= Formatting helpers ================= */
function timeInZone(date, tz) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}
function hmInZone(date, tz) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return lang === "zh" ? `${h} 小时 ${m} 分` : `${h}h ${m}m`;
}

/* ================= Almanac (zh only, computed per day) ================= */
const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";

/* Julian Day Number of the local calendar date (integer, day starts at noon
   in JDN convention; the standard civil formula below is what perpetual
   calendars use, and its day-ganzhi offset +49 is anchored on two famous
   dates: 1949-10-01 = 甲子日 and 2000-01-07 = 甲子日). */
function julianDayNumber(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 +
    Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}
function ganzhiFromIndex(idx) {
  const i = ((idx % 60) + 60) % 60;
  return GAN[i % 10] + ZHI[i % 12];
}
function dayGanzhi(date) { return ganzhiFromIndex(julianDayNumber(date) + 49); }
function yearGanzhi(date) {
  let lunarYear = date.getFullYear();
  try {
    const parts = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { year: "numeric" }).formatToParts(date);
    const yp = parts.find((x) => x.type === "year");
    const n = yp ? parseInt(yp.value, 10) : NaN;
    if (!Number.isNaN(n)) lunarYear = n;
  } catch (e) { /* fall back to Gregorian year */ }
  return ganzhiFromIndex(lunarYear - 4);
}
/* Deterministic per-day pseudo-random pick: the same calendar day always
   yields the same 宜/忌. Certainty hiding inside the chance pool. */
function seededDailyPick(pool, count, seed, exclude) {
  let s = (seed % 2147483647) + 1;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const avail = pool.filter((x) => !exclude || !exclude.includes(x));
  const copy = avail.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
/* 彭祖百忌： classic lookup by day stem / day branch (traditional text). */
const PENGZU_BY_STEM = {
  "甲": "甲不开仓，财物耗散", "乙": "乙不栽植，千株不长", "丙": "丙不修灶，必见灾殃",
  "丁": "丁不剃头，头必生疮", "戊": "戊不受田，田主不祥", "己": "己不破券，二比并亡",
  "庚": "庚不经络，织机虚张", "辛": "辛不合酱，主人不尝", "壬": "壬不汲水，更难提防",
  "癸": "癸不词讼，理弱敌强",
};
const PENGZU_BY_BRANCH = {
  "子": "子不问卜，自惹祸殃", "丑": "丑不冠带，主不还乡", "寅": "寅不祭祀，神鬼不尝",
  "卯": "卯不穿井，水泉不香", "辰": "辰不哭泣，必主重丧", "巳": "巳不远行，财物伏藏",
  "午": "午不苫盖，屋主更张", "未": "未不服药，毒气入肠", "申": "申不安床，鬼祟入房",
  "酉": "酉不会客，醉坐颠狂", "戌": "戌不吃犬，作怪上床", "亥": "亥不嫁娶，不利新郎",
};
const ZHI_ANIMAL = "鼠牛虎兔龙蛇马羊猴鸡狗猪";
const ZHI_DIRECTION = {
  "子": "北", "丑": "东北", "寅": "东北", "卯": "东", "辰": "东南", "巳": "东南",
  "午": "南", "未": "西南", "申": "西南", "酉": "西", "戌": "西北", "亥": "西北",
};
/* 十二建除 in order, index 0 = 建 (day branch == month branch). */
const JIANCHU = ["建", "除", "满", "平", "定", "执", "破", "危", "成", "收", "开", "闭"];
/* Solar terms by 15° step of the Sun's apparent ecliptic longitude, index 0 = 0° (春分). */
const SOLAR_TERMS = ["春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰"];
/* 吉神/凶神： simplified day-seeded picks in the same spirit as traditional
   almanacs; glosses are our own one-liners. Not the full traditional algorithm. */
const JISHEN = [
  { name: "天德", gloss: "主福德庇佑" }, { name: "月德", gloss: "主和顺吉祥" },
  { name: "天恩", gloss: "主恩泽施予" }, { name: "三合", gloss: "主和合顺遂" },
  { name: "天喜", gloss: "主喜庆临门" }, { name: "母仓", gloss: "主积蓄丰盈" },
  { name: "时德", gloss: "主当日得时" }, { name: "青龙", gloss: "主吉庆祥瑞" },
  { name: "益后", gloss: "主利在长远" }, { name: "民日", gloss: "主安民宜事" },
];
const XIONGSHEN = [
  { name: "天刑", gloss: "主刑伤是非" }, { name: "朱雀", gloss: "主口舌争端" },
  { name: "白虎", gloss: "主损伤血光" }, { name: "天牢", gloss: "主束缚困顿" },
  { name: "玄武", gloss: "主盗失暗昧" }, { name: "勾陈", gloss: "主牵连迟滞" },
  { name: "大煞", gloss: "主诸事不利" }, { name: "往亡", gloss: "主出行不利" },
  { name: "天火", gloss: "主火患之忧" }, { name: "四击", gloss: "主冲犯不利" },
];

function lunarMonthNumber(date) {
  try {
    const parts = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "numeric" }).formatToParts(date);
    const mp = parts.find((x) => x.type === "month");
    const n = mp ? parseInt(mp.value, 10) : NaN;
    if (!Number.isNaN(n)) return n;
  } catch (e) { /* fall through to name parsing */ }
  try {
    // Some environments return the month name instead of a number.
    const label = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "long" }).format(date);
    const key = label.replace("闰", "").replace("月", "");
    const names = { "正": 1, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "冬": 11, "十二": 12, "腊": 12 };
    return key in names ? names[key] : null;
  } catch (e) { return null; }
}
function currentSolarTerm(date) {
  const lon = eclipticLongitude(solarMeanAnomaly(toDays(date)));
  const deg = ((lon / RAD) % 360 + 360) % 360;
  return SOLAR_TERMS[Math.floor(deg / 15) % 24];
}

function computeAlmanac(date) {
  const jdn = julianDayNumber(date);
  let lunarLabel = "";
  try {
    lunarLabel = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "long", day: "numeric" }).format(date);
  } catch (e) { lunarLabel = ""; }
  const yiCount = 4 + (jdn % 3);        // 4–6
  const jiCount = 3 + ((jdn >> 2) % 3); // 3–5
  const yi = seededDailyPick(ALMANAC_YI, yiCount, jdn * 2 + 1, null);
  const ji = seededDailyPick(ALMANAC_JI, jiCount, jdn * 2 + 2, yi);
  const gz = dayGanzhi(date);
  const stem = gz[0], branch = gz[1];
  const branchIdx = ZHI.indexOf(branch);
  const conflictBranch = ZHI[(branchIdx + 6) % 12];
  // 十二建除： month branch = lunar month mapped 正月建寅； null when lunar month unknown.
  let jianchu = null;
  const lm = lunarMonthNumber(date);
  if (lm !== null && branchIdx >= 0) {
    const monthBranchIdx = (lm + 1) % 12;
    jianchu = JIANCHU[((branchIdx - monthBranchIdx) % 12 + 12) % 12];
  }
  const jiShenObjs = seededDailyPick(JISHEN.map((g) => g.name), 3, jdn * 2 + 3, null)
    .map((n) => JISHEN.find((g) => g.name === n));
  const xiongShenObjs = seededDailyPick(XIONGSHEN.map((g) => g.name), 2, jdn * 2 + 4, null)
    .map((n) => XIONGSHEN.find((g) => g.name === n));
  return {
    lunarLabel,
    yearGanzhi: yearGanzhi(date),
    dayGanzhi: gz,
    yi,
    ji,
    solarTerm: currentSolarTerm(date),
    jianchu,
    chongSha: `冲${ZHI_ANIMAL[(branchIdx + 6) % 12]}煞${ZHI_DIRECTION[conflictBranch]}`,
    pengzu: [PENGZU_BY_STEM[stem], PENGZU_BY_BRANCH[branch]],
    jiShen: jiShenObjs,
    xiongShen: xiongShenObjs,
  };
}

/* ================= Astrology (astro) ================= */
/* Self-contained on purpose: everything below depends only on the data.js
   pools and on Math/Date, never on the DOM, so it can be exercised in Node.
   Two kinds of content live here:
   - 星位 star positions: REAL astronomy, computed live from JPL Keplerian
     elements (approximate, sign-level accuracy).
   - 每日运势 daily horoscope: pure entertainment, but deterministic — a
     date+sign seed, so the same sign sees the same fortune all day,
     exactly like the almanac. */

/* Deterministic PRNG (mulberry32) for date-seeded picks. */
function seededRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Approximate ephemeris (JPL Keplerian elements, valid 1800–2050) ----
   Each row: a (AU), a-rate, e, e-rate, I (deg), I-rate, L (deg), L-rate,
   long. perihelion (deg), its rate, long. node (deg), its rate.
   Rates are per Julian century from J2000. */
const KEPLER_ELEMENTS = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
};
const norm360 = (deg) => ((deg % 360) + 360) % 360;
const norm180 = (deg) => norm360(deg + 180) - 180;

function julianCenturies(date) {
  const jd = date.valueOf() / DAY_MS + 2440587.5; // Unix epoch = JD 2440587.5
  return (jd - 2451545.0) / 36525;
}

/* Heliocentric ecliptic rectangular coordinates (AU) via Kepler's equation. */
function helioRect(body, date) {
  const el = KEPLER_ELEMENTS[body];
  const T = julianCenturies(date);
  const a = el[0] + el[1] * T;
  const e = el[2] + el[3] * T;
  const I = (el[4] + el[5] * T) * RAD;
  const L = el[6] + el[7] * T;
  const peri = el[8] + el[9] * T;
  const node = el[10] + el[11] * T;
  const w = (peri - node) * RAD;            // argument of perihelion
  const Om = node * RAD;                    // longitude of ascending node
  const M = norm360(L - peri) * RAD;        // mean anomaly
  // Solve Kepler's equation E - e*sinE = M (Newton iterations).
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  const u = w + nu; // argument of latitude
  return {
    x: r * (Math.cos(Om) * Math.cos(u) - Math.sin(Om) * Math.sin(u) * Math.cos(I)),
    y: r * (Math.sin(Om) * Math.cos(u) + Math.cos(Om) * Math.sin(u) * Math.cos(I)),
    z: r * (Math.sin(u) * Math.sin(I)),
  };
}

function sunLongitude(date) {
  const e = helioRect("earth", date);
  return norm360(Math.atan2(-e.y, -e.x) / RAD);
}
function planetLongitude(body, date) {
  const p = helioRect(body, date);
  const e = helioRect("earth", date);
  return norm360(Math.atan2(p.y - e.y, p.x - e.x) / RAD);
}
/* Simplified lunar longitude: mean longitude plus the main perturbation
   terms (evection, variation, equation of centre...). ~1° accuracy. */
function moonLongitude(date) {
  const T = julianCenturies(date);
  const Lp = norm360(218.3164477 + 481267.88123421 * T); // mean longitude
  const D = norm360(297.8501921 + 445267.1114034 * T);   // mean elongation
  const Ms = norm360(357.5291092 + 35999.0502909 * T);   // Sun mean anomaly
  const Mm = norm360(134.9633964 + 477198.8675055 * T);  // Moon mean anomaly
  const F = norm360(93.2720950 + 483202.0175233 * T);    // argument of latitude
  const s = (deg) => Math.sin(deg * RAD);
  const lon = Lp
    + 6.289 * s(Mm)
    + 1.274 * s(2 * D - Mm)
    + 0.658 * s(2 * D)
    + 0.214 * s(2 * Mm)
    - 0.186 * s(Ms)
    - 0.114 * s(2 * F);
  return norm360(lon);
}

function signIndexFromLongitude(lon) { return Math.floor(norm360(lon) / 30) % 12; }

/* Placements for the seven bodies. Retrograde (planets only) is decided by
   comparing today's geocentric longitude with the one 5 days later:
   decreasing longitude = apparent retrograde motion. */
function planetPositions(date) {
  const later = new Date(date.valueOf() + 5 * DAY_MS);
  const out = [];
  const sunLon = sunLongitude(date);
  out.push({ key: "sun", lon: sunLon, signIdx: signIndexFromLongitude(sunLon), retrograde: false });
  const moonLon = moonLongitude(date);
  out.push({ key: "moon", lon: moonLon, signIdx: signIndexFromLongitude(moonLon), retrograde: false });
  for (const body of ["mercury", "venus", "mars", "jupiter", "saturn"]) {
    const lon = planetLongitude(body, date);
    const lon2 = planetLongitude(body, later);
    out.push({
      key: body,
      lon,
      signIdx: signIndexFromLongitude(lon),
      retrograde: norm180(lon2 - lon) < 0,
    });
  }
  return out;
}

/* Daily horoscope for one sign on one (local) calendar day. Returns pool
   indices, not text, so a language switch re-renders the same fortune in
   the other language. Same inputs → same output, all day long. */
function makeHoroscope(date, signIdx) {
  const seed = (date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()) * 16 + signIdx;
  const rng = seededRng(seed);
  return {
    signIdx,
    stars: 1 + Math.floor(rng() * 5),
    openIdx: Math.floor(rng() * HORO_OPENINGS_ZH.length),
    adviceIdx: Math.floor(rng() * HORO_ADVICE_ZH.length),
    luckyNumber: 1 + Math.floor(rng() * 99),
    colorIdx: Math.floor(rng() * LUCKY_COLORS.length),
    dirIdx: Math.floor(rng() * LUCKY_DIRECTIONS.length),
    itemIdx: Math.floor(rng() * LUCKY_ITEMS.length),
  };
}
/* ================= End astrology ================= */

/* ================= Special days: dressing + micro-animation ================= */
/* The calendar dresses the page on days that mean something — solar
   terms, lunar festivals, meteor-shower peaks, and the user's own days.
   Restraint is the brand: ordinary days keep the vermillion accent and
   only breathe a seasonal tint into the background glow. Everything is
   evaluated on load and re-evaluated whenever the local date or hour
   rolls over, so a page left open flips itself at midnight. */
const SOLAR_TERMS_EN = ["Chunfen", "Qingming", "Guyu", "Lixia", "Xiaoman", "Mangzhong", "Xiazhi", "Xiaoshu", "Dashu", "Liqiu", "Chushu", "Bailu", "Qiufen", "Hanlu", "Shuangjiang", "Lidong", "Xiaoxue", "Daxue", "Dongzhi", "Xiaohan", "Dahan", "Lichun", "Yushui", "Jingzhe"];
/* Annual meteor-shower peaks (month, day) — standard IMO calendar values. */
const METEOR_SHOWERS = [[1, 3], [4, 22], [8, 12], [10, 21], [11, 17], [12, 13]];
const TERM_ANIM = { "立春": "petals", "立秋": "leaves", "大雪": "snow", "小寒": "snow", "大寒": "snow" };
const FESTIVALS = {
  chuxi:     { key: "chuxi",     zh: "除夕",   en: "Chinese New Year's Eve",  dress: "redgold", anim: null },
  chunjie:   { key: "chunjie",   zh: "春节",   en: "Chinese New Year",        dress: "redgold", anim: null },
  yuanxiao:  { key: "yuanxiao",  zh: "元宵节", en: "Lantern Festival",        dress: "redgold", anim: null },
  qingming:  { key: "qingming",  zh: "清明",   en: "Qingming Festival",       dress: "green",   anim: "petals" },
  duanwu:    { key: "duanwu",    zh: "端午",   en: "Dragon Boat Festival",    dress: "green",   anim: null },
  qixi:      { key: "qixi",      zh: "七夕",   en: "Qixi Festival",           dress: "warm",    anim: null },
  zhongqiu:  { key: "zhongqiu",  zh: "中秋",   en: "Mid-Autumn Festival",     dress: "moon",    anim: null },
  chongyang: { key: "chongyang", zh: "重阳",   en: "Double Ninth Festival",   dress: "amber",   anim: "leaves" },
  dongzhi:   { key: "dongzhi",   zh: "冬至",   en: "Dongzhi, the Winter Solstice", dress: null, anim: "snow" },
  yuandan:   { key: "yuandan",   zh: "元旦",   en: "New Year's Day",          dress: "redgold", anim: null },
};

/* Lunar (month, day, leap?) via the same Intl chinese calendar the
   almanac uses. Leap is read off the long month name （闰六月）. */
function lunarParts(date) {
  try {
    const parts = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "numeric", day: "numeric" }).formatToParts(date);
    const mp = parts.find((x) => x.type === "month");
    const dp = parts.find((x) => x.type === "day");
    const month = mp ? parseInt(mp.value, 10) : NaN;
    const day = dp ? parseInt(dp.value, 10) : NaN;
    if (Number.isNaN(month) || Number.isNaN(day)) return null;
    const long = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "long" }).format(date);
    return { month, day, leap: long.includes("闰") };
  } catch (e) { return null; }
}
function sunLongitudeDeg(date) {
  const lon = eclipticLongitude(solarMeanAnomaly(toDays(date)));
  return ((lon / RAD) % 360 + 360) % 360;
}
function seasonOf(date) {
  const deg = sunLongitudeDeg(date);
  if (deg >= 315 || deg < 45) return "spring";
  if (deg < 135) return "summer";
  if (deg < 225) return "autumn";
  return "winter";
}
/* A solar-term day is the local calendar day on which the Sun crosses
   into a new 15° sector: the term at today's midnight differs from the
   term at tomorrow's midnight, and the new one begins today. */
function solarTermDay(date) {
  const t0 = currentSolarTerm(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
  const t1 = currentSolarTerm(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
  return t0 !== t1 ? t1 : null;
}
function lunarFestivalOn(date) {
  const lp = lunarParts(date);
  if (!lp) return null;
  if (!lp.leap) {
    if (lp.month === 1 && lp.day === 1) return FESTIVALS.chunjie;
    if (lp.month === 1 && lp.day === 15) return FESTIVALS.yuanxiao;
    if (lp.month === 5 && lp.day === 5) return FESTIVALS.duanwu;
    if (lp.month === 7 && lp.day === 7) return FESTIVALS.qixi;
    if (lp.month === 8 && lp.day === 15) return FESTIVALS.zhongqiu;
    if (lp.month === 9 && lp.day === 9) return FESTIVALS.chongyang;
  }
  if (lp.month === 12) {
    // 除夕： the last day of the lunar year — tomorrow is 正月初一.
    const tm = lunarParts(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
    if (tm && tm.month === 1 && tm.day === 1 && !tm.leap) return FESTIVALS.chuxi;
  }
  return null;
}

/* ---------- My days （我的日子） ----------
   User-defined personal days (birthdays, anniversaries), recurring
   yearly by month/day only. Stored strictly locally under their own
   versioned key and never sent anywhere. A day may be defined on the
   solar or the lunar calendar; lunar days are matched through the same
   solar→lunar conversion the almanac uses (leap months don't host
   festivals or birthdays here — the regular month wins). */
const LS_MYDAYS = "nam-my-days";
const MYDAY_EFFECTS = ["dress", "petals", "meteors", "snow"];
let myDays = loadMyDays();
function loadMyDays() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_MYDAYS) || "null");
    const arr = s && s.v === 1 && Array.isArray(s.days) ? s.days : (Array.isArray(s) ? s : []);
    return arr
      .filter((d) => d && typeof d.name === "string" && d.name.trim() &&
        (d.cal === "lunar" || d.cal === "solar") &&
        Number.isInteger(d.month) && d.month >= 1 && d.month <= 12 &&
        Number.isInteger(d.day) && d.day >= 1 && d.day <= 31)
      .map((d) => ({
        name: d.name,
        cal: d.cal,
        month: d.month,
        day: d.day,
        effect: MYDAY_EFFECTS.includes(d.effect) ? d.effect : "dress",
      }));
  } catch (e) { return []; }
}
function saveMyDays() {
  try {
    localStorage.setItem(LS_MYDAYS, JSON.stringify({ v: 1, days: myDays }));
  } catch (e) { /* storage unavailable: days live in memory only */ }
}
function matchPersonalDay(date) {
  let lp = null;
  for (const d of myDays) {
    if (d.cal === "solar") {
      if (date.getMonth() + 1 === d.month && date.getDate() === d.day) return d;
    } else {
      if (!lp) lp = lunarParts(date);
      if (lp && !lp.leap && lp.month === d.month && lp.day === d.day) return d;
    }
  }
  return null;
}

/* Precedence: a personal day outranks a festival, which outranks a bare
   solar-term day — for the note, the dressing and the animation alike.
   A dressing-only personal day also silences a shower that night: it is
   their day, kept calm the way they chose. */
function computeSpecialDay(date) {
  const season = seasonOf(date);
  const termDay = solarTermDay(date);
  let festival = lunarFestivalOn(date);
  if (!festival && termDay === "清明") festival = FESTIVALS.qingming;
  if (!festival && termDay === "冬至") festival = FESTIVALS.dongzhi;
  if (!festival && date.getMonth() === 0 && date.getDate() === 1) festival = FESTIVALS.yuandan;
  const personal = matchPersonalDay(date);
  const hour = date.getHours();
  const showerTonight = METEOR_SHOWERS.some(([m, d]) => date.getMonth() + 1 === m && date.getDate() === d) &&
    (hour >= 19 || hour < 5);
  let note = null, dress = null, anim = null;
  if (personal) {
    note = { zh: `今日「${personal.name}」`, en: `Today: ${personal.name}` };
    dress = "warm";
    if (personal.effect !== "dress") anim = personal.effect;
  } else if (festival) {
    note = { zh: `今日${festival.zh}`, en: `${festival.en} today` };
    dress = festival.dress;
    anim = festival.anim;
  } else if (termDay) {
    note = { zh: `今日${termDay}`, en: `${SOLAR_TERMS_EN[SOLAR_TERMS.indexOf(termDay)]} today` };
    anim = TERM_ANIM[termDay] || null;
  }
  if (!anim && showerTonight && !personal) anim = "meteors";
  return { season, termDay, festival, personal, showerTonight, note, dress, anim };
}

let currentSpecial = null;
let specialStamp = "";
const fxDebug = {
  season: null, termDay: null, festival: null, personal: null,
  note: null, dress: null, animMode: null, particleCount: 0, fxEnabled: true,
};
try { window.__namFxState = fxDebug; } catch (e) { /* non-browser context */ }

function applySpecialDay() {
  const now = new Date();
  currentSpecial = computeSpecialDay(now);
  specialStamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}:${now.getHours()}`;
  document.body.dataset.season = currentSpecial.season;
  if (currentSpecial.dress) document.body.dataset.special = currentSpecial.dress;
  else delete document.body.dataset.special;
  fxDebug.season = currentSpecial.season;
  fxDebug.termDay = currentSpecial.termDay;
  fxDebug.festival = currentSpecial.festival ? currentSpecial.festival.key : null;
  fxDebug.personal = currentSpecial.personal ? currentSpecial.personal.name : null;
  fxDebug.note = currentSpecial.note ? currentSpecial.note[lang] : null;
  fxDebug.dress = currentSpecial.dress;
  syncFxEngine();
  renderDateLine(now);
}

/* ---------- Micro-animation engine ----------
   One fixed canvas, one rAF loop, slow and faint. Falling particles
   (snow / petals / leaves) share one drift system parameterized by
   size, speed and paint; meteors are lone streaks on a slow timer. */
const LS_FX = "nam-effects";
let fxEnabled = localStorage.getItem(LS_FX) !== "off";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let fxMode = null;
let fxParts = [];
let fxStreaks = [];
let fxNextStreakAt = 0;
let fxRafId = null;
let fxLastTs = 0;

const FALL_CONF = {
  snow:   { count: 70, vyMin: 13, vyMax: 32, sizeMin: 1.1, sizeMax: 2.7 },
  petals: { count: 24, vyMin: 10, vyMax: 22, sizeMin: 5.0, sizeMax: 9.0 },
  leaves: { count: 20, vyMin: 12, vyMax: 26, sizeMin: 5.0, sizeMax: 9.0 },
};
function fxIsDark() {
  const dt = document.documentElement.dataset.theme;
  if (dt === "dark") return true;
  if (dt === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function fxAllowed() { return fxEnabled && !reducedMotionQuery.matches; }
function desiredFxMode() { return fxAllowed() && currentSpecial ? currentSpecial.anim : null; }

function fxResize() {
  const c = $("fx-canvas");
  if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(window.innerWidth * dpr);
  c.height = Math.round(window.innerHeight * dpr);
  c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}
function fxSpawnFalling(mode) {
  const conf = FALL_CONF[mode];
  const area = window.innerWidth * window.innerHeight;
  const n = Math.max(8, Math.round(conf.count * Math.min(1.6, Math.max(0.4, area / (1280 * 800)))));
  fxParts = Array.from({ length: n }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    s: conf.sizeMin + Math.random() * (conf.sizeMax - conf.sizeMin),
    vy: conf.vyMin + Math.random() * (conf.vyMax - conf.vyMin),
    ph: Math.random() * Math.PI * 2,
    sway: 8 + Math.random() * 18,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.7,
    a: 0.4 + Math.random() * 0.4,
  }));
}
function fxClear() {
  const c = $("fx-canvas");
  if (c) c.getContext("2d").clearRect(0, 0, window.innerWidth, window.innerHeight);
}
function fxStartLoop() {
  if (fxRafId == null) {
    fxLastTs = performance.now();
    fxRafId = requestAnimationFrame(fxFrame);
  }
}
function fxStopLoop() {
  if (fxRafId != null) {
    cancelAnimationFrame(fxRafId);
    fxRafId = null;
  }
}
function syncFxEngine() {
  const want = desiredFxMode();
  if (want !== fxMode) {
    fxMode = want;
    fxParts = [];
    fxStreaks = [];
    if (fxMode && FALL_CONF[fxMode]) fxSpawnFalling(fxMode);
    if (fxMode === "meteors") fxNextStreakAt = performance.now() + 1200 + Math.random() * 3000;
  }
  fxDebug.animMode = fxMode;
  fxDebug.fxEnabled = fxEnabled;
  if (fxMode && !document.hidden) fxStartLoop();
  else fxStopLoop();
  if (!fxMode) {
    fxDebug.particleCount = 0;
    fxClear();
  }
}
function fxFrame(ts) {
  fxRafId = null;
  if (!fxMode || document.hidden) return;
  const dt = Math.min(0.05, Math.max(0.001, (ts - fxLastTs) / 1000));
  fxLastTs = ts;
  fxDraw(ts, dt);
  fxRafId = requestAnimationFrame(fxFrame);
}
function fxDraw(ts, dt) {
  const c = $("fx-canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  const W = window.innerWidth, H = window.innerHeight;
  const dark = fxIsDark();
  ctx.clearRect(0, 0, W, H);

  if (fxMode === "meteors") {
    if (ts >= fxNextStreakAt) {
      const ang = (205 + Math.random() * 35) * RAD; // down-left, steep-ish
      const speed = 520 + Math.random() * 320;
      fxStreaks.push({
        x: W * (0.25 + Math.random() * 0.7),
        y: H * Math.random() * 0.3,
        vx: Math.cos(ang) * speed,
        vy: -Math.sin(ang) * speed,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.4,
        len: 90 + Math.random() * 70,
      });
      fxNextStreakAt = ts + 6000 + Math.random() * 8000; // one streak every ~6–14 s
    }
    const rgb = dark ? "255, 250, 235" : "150, 128, 84";
    fxStreaks = fxStreaks.filter((s) => s.life < s.maxLife);
    for (const s of fxStreaks) {
      s.life += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = Math.sin(Math.PI * Math.min(1, s.life / s.maxLife));
      const mag = Math.hypot(s.vx, s.vy) || 1;
      const tx = s.x - (s.vx / mag) * s.len;
      const ty = s.y - (s.vy / mag) * s.len;
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, `rgba(${rgb}, ${(0.75 * fade).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    fxDebug.particleCount = fxStreaks.length;
    return;
  }

  if (!FALL_CONF[fxMode]) return;
  for (const p of fxParts) {
    p.y += p.vy * dt;
    p.x += Math.sin(ts / 1400 + p.ph) * p.sway * dt;
    p.rot += p.vr * dt;
    if (p.y > H + 14) { p.y = -14; p.x = Math.random() * W; }
    if (p.x > W + 20) p.x = -20;
    if (p.x < -20) p.x = W + 20;
    if (fxMode === "snow") {
      ctx.fillStyle = dark ? `rgba(255, 255, 255, ${p.a.toFixed(3)})` : `rgba(128, 152, 188, ${p.a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = fxMode === "petals"
        ? `rgba(243, 183, 196, ${p.a.toFixed(3)})`
        : `rgba(204, 140, 60, ${p.a.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  fxDebug.particleCount = fxParts.length;
}
function setFxEnabled(on) {
  if (fxEnabled === on) { syncFxEngine(); return; }
  fxEnabled = on;
  try { localStorage.setItem(LS_FX, on ? "on" : "off"); } catch (e) { /* ignore */ }
  $("fx-on").classList.toggle("active", on);
  $("fx-off").classList.toggle("active", !on);
  syncFxEngine();
}
$("fx-on").addEventListener("click", () => setFxEnabled(true));
$("fx-off").addEventListener("click", () => setFxEnabled(false));
if (typeof reducedMotionQuery.addEventListener === "function") {
  reducedMotionQuery.addEventListener("change", syncFxEngine);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) fxStopLoop();
  else syncFxEngine();
});
window.addEventListener("resize", fxResize);

/* ---------- My days: settings UI ---------- */
let myDayCal = "solar";
function myDayMaxDay() {
  if (myDayCal === "lunar") return 30;
  const m = parseInt($("myday-month").value, 10) || 1;
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] || 31;
}
function rebuildMyDayDays() {
  const sel = $("myday-day");
  if (!sel) return;
  const prev = parseInt(sel.value, 10) || 1;
  const max = myDayMaxDay();
  sel.innerHTML = "";
  for (let d = 1; d <= max; d++) {
    const o = document.createElement("option");
    o.value = String(d);
    o.textContent = String(d);
    sel.appendChild(o);
  }
  sel.value = String(Math.min(prev, max));
}
function refreshMyDayEffectOptions() {
  const sel = $("myday-effect");
  if (!sel) return;
  const prev = sel.value || "dress";
  sel.innerHTML = "";
  for (const fx of MYDAY_EFFECTS) {
    const o = document.createElement("option");
    o.value = fx;
    o.textContent = t().myDays.fx[fx];
    sel.appendChild(o);
  }
  sel.value = MYDAY_EFFECTS.includes(prev) ? prev : "dress";
}
function renderMyDaysList() {
  const wrap = $("my-days-list");
  if (!wrap) return;
  const md = t().myDays;
  wrap.innerHTML = "";
  myDays.forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "my-day-item";
    const label = document.createElement("span");
    label.textContent = `${d.name} · ${md.when(d.cal, d.month, d.day)} · ${md.fx[d.effect]}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "my-day-del";
    del.textContent = "×";
    del.dataset.idx = String(idx);
    del.setAttribute("aria-label", md.deleteLabel);
    row.appendChild(label);
    row.appendChild(del);
    wrap.appendChild(row);
  });
}
function buildMyDaysForm() {
  const monthSel = $("myday-month");
  if (!monthSel) return;
  monthSel.innerHTML = "";
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement("option");
    o.value = String(m);
    o.textContent = String(m);
    monthSel.appendChild(o);
  }
  rebuildMyDayDays();
  refreshMyDayEffectOptions();
  renderMyDaysList();
  const setCal = (cal) => {
    myDayCal = cal;
    $("myday-cal-solar").classList.toggle("active", cal === "solar");
    $("myday-cal-lunar").classList.toggle("active", cal === "lunar");
    rebuildMyDayDays();
  };
  $("myday-cal-solar").addEventListener("click", () => setCal("solar"));
  $("myday-cal-lunar").addEventListener("click", () => setCal("lunar"));
  setCal("solar");
  monthSel.addEventListener("change", rebuildMyDayDays);
  $("myday-add").addEventListener("click", () => {
    const name = $("myday-name").value.trim();
    if (!name) return; // empty name: rejected quietly
    const entry = {
      name,
      cal: myDayCal,
      month: parseInt(monthSel.value, 10) || 1,
      day: parseInt($("myday-day").value, 10) || 1,
      effect: $("myday-effect").value || "dress",
    };
    // Exact duplicates (same name + calendar + month/day) are dropped.
    const dup = myDays.some((d) => d.name === entry.name && d.cal === entry.cal &&
      d.month === entry.month && d.day === entry.day);
    if (!dup) {
      myDays.push(entry);
      saveMyDays();
      renderMyDaysList();
      applySpecialDay();
    }
    $("myday-name").value = "";
  });
  $("my-days-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".my-day-del");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= myDays.length) return;
    myDays.splice(idx, 1);
    saveMyDays();
    renderMyDaysList();
    applySpecialDay();
  });
}

/* ================= Card selection & rendering ================= */
/* Categories available in the current language. almanac + classics are
   zh-only; proverbs + word are en-only; gossip joins only when its feed
   has actually delivered headlines. */
function availableCategories() {
  const base = lang === "zh"
    ? ["world", "poem", "history", "thought", "science", "quotes", "classics", "almanac", "astro", "chance", "memory"]
    : ["world", "poem", "history", "thought", "science", "quotes", "proverbs", "word", "astro", "chance", "memory"];
  const list = CATEGORY_WEIGHTS.filter((c) => base.includes(c.key));
  if (gossipCache.length) {
    const g = CATEGORY_WEIGHTS.find((c) => c.key === "gossip");
    if (g) list.push(g);
  }
  return list;
}

function weightedCategory() {
  const avail = availableCategories();
  const total = avail.reduce((s, c) => s + c.weight, 0); // normalized by available sum
  for (let attempt = 0; attempt < 4; attempt++) {
    let r = Math.random() * total;
    let chosen = avail[0].key;
    for (const c of avail) {
      if (r < c.weight) { chosen = c.key; break; }
      r -= c.weight;
    }
    if (chosen !== lastCategory || attempt === 3) return chosen;
  }
  return "world";
}

function makeSelection(cat) {
  switch (cat) {
    case "world": {
      // The moon is one extra "place" in the world pool (slot == CITIES.length).
      const slot = deckDraw("world", CITIES.length + 1);
      if (slot === CITIES.length) return { cat, moon: true };
      return { cat, city: CITIES[slot] };
    }
    case "poem":
      return {
        cat,
        poemZh: POEMS_ZH[deckDraw("poem:zh", POEMS_ZH.length)],
        poemEn: POEMS_EN[deckDraw("poem:en", POEMS_EN.length)],
      };
    case "history": {
      const now = new Date();
      const key = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      // Today's entry is date-determined (the certainty side of the site);
      // the deck governs only the random-day fallback pool.
      if (HISTORY[key]) return { cat, key, entry: HISTORY[key], today: true };
      const keys = Object.keys(HISTORY);
      const rk = keys[deckDraw("history", keys.length)];
      return { cat, key: rk, entry: HISTORY[rk], today: false };
    }
    case "thought":
      return { cat, item: THOUGHTS[deckDraw("thought", THOUGHTS.length)] };
    case "science":
      return { cat, item: SCIENCE[deckDraw("science", SCIENCE.length)] };
    case "quotes":
      return {
        cat,
        quoteZh: QUOTES_ZH[deckDraw("quotes:zh", QUOTES_ZH.length)],
        quoteEn: QUOTES_EN[deckDraw("quotes:en", QUOTES_EN.length)],
      };
    case "classics":
      return { cat, item: CLASSICS[deckDraw("classics", CLASSICS.length)] };
    case "almanac":
      return { cat, data: computeAlmanac(new Date()) };
    case "astro": {
      const subtype = ["horoscope", "positions", "profile"][deckDraw("astro:sub", 3)];
      if (subtype === "horoscope") {
        let signIdx = -1;
        if (userSign && Math.random() < 0.7) {
          signIdx = SIGNS.findIndex((sg) => sg.key === userSign);
        }
        // The user's own sign (above) is a deliberate feature and stays
        // random-access; every other horoscope sign comes from the deck.
        if (signIdx < 0) signIdx = deckDraw("astro:horo", SIGNS.length);
        return { cat, subtype, horo: makeHoroscope(new Date(), signIdx) };
      }
      // Positions are computed from the date — one card per day by
      // construction; the subtype deck above spaces their appearances.
      if (subtype === "positions") return { cat, subtype, positions: planetPositions(new Date()) };
      return { cat, subtype, signIdx: deckDraw("astro:prof", SIGNS.length) };
    }
    case "proverbs":
      return { cat, item: PROVERBS[deckDraw("proverbs", PROVERBS.length)] };
    case "word":
      return { cat, item: WORDS[deckDraw("word", WORDS.length)] };
    case "gossip":
      return { cat, item: drawGossipItem() };
    case "memory":
      return { cat, item: MEMORY_PROMPTS[deckDraw("memory", MEMORY_PROMPTS.length)] };
    case "chance": {
      const kinds = ["integer", "dice", "coins", "card", "color"];
      const kind = kinds[deckDraw("chance:kind", kinds.length)];
      let value = rollChanceValue(kind);
      for (let attempt = 0; attempt < 3 && deckStore.fp.includes(chanceFingerprint(kind, value)); attempt++) {
        value = rollChanceValue(kind);
      }
      deckStore.fp.push(chanceFingerprint(kind, value));
      if (deckStore.fp.length > 16) deckStore.fp = deckStore.fp.slice(-16);
      saveDeckStore();
      return { cat, kind, value };
    }
    default:
      return { cat: "thought", item: THOUGHTS[deckDraw("thought", THOUGHTS.length)] };
  }
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderSelection(sel) {
  const s = t();
  let meta = "";
  let body = "";
  const now = new Date();

  if (sel.cat === "world") {
    if (sel.moon) {
      const mp = moonPhase(now);
      meta = s.world.moonTitle;
      body = `<span class="moon-glyph">${mp.glyph}</span><span class="big">${s.world.phases[mp.idx]}</span>` +
        `<div class="fact-row"><span>${s.world.moonIllum(mp.illum)}</span><span>${s.world.moonAge(mp.age)}</span></div>`;
    } else {
      const city = sel.city;
      const name = lang === "zh" ? city.zh : city.en;
      const st = sunTimes(now, city.lat, city.lon);
      meta = `${name} · ${s.world.localTime} ${timeInZone(now, city.tz)}`;
      let facts;
      if (st.polar === "day") facts = `<span><b>${s.world.polarDay}</b></span>`;
      else if (st.polar === "night") facts = `<span><b>${s.world.polarNight}</b></span>`;
      else facts =
        `<span>${s.world.sunrise} <b>${hmInZone(st.sunrise, city.tz)}</b></span>` +
        `<span>${s.world.sunset} <b>${hmInZone(st.sunset, city.tz)}</b></span>` +
        `<span>${s.world.dayLength} <b>${formatDuration(st.dayMinutes)}</b></span>`;
      body = `<span class="big">${name}</span><div class="fact-row">${facts}</div>`;
    }
  }

  if (sel.cat === "poem") {
    const p = lang === "zh" ? sel.poemZh : sel.poemEn;
    meta = p.title;
    body = `<span class="poem-title">${p.title}</span><span class="poem-author">${p.author}</span><br>` +
      p.lines.map((ln) => `<span class="poem-line">${ln}</span>`).join("");
  }

  if (sel.cat === "history") {
    meta = sel.today ? s.history.onThisDay(sel.entry.year) : `${s.history.randomDay} · ${sel.key}`;
    body = `<span class="big">${sel.entry.year}</span><br>${lang === "zh" ? sel.entry.zh : sel.entry.en}`;
  }

  if (sel.cat === "thought" || sel.cat === "memory" || sel.cat === "science") {
    body = lang === "zh" ? sel.item.zh : sel.item.en;
  }

  if (sel.cat === "quotes") {
    const q = lang === "zh" ? sel.quoteZh : sel.quoteEn;
    body = `<span class="poem-line">${q.text}</span><span class="poem-author">— ${q.author}</span>`;
  }

  if (sel.cat === "classics") {
    body = `<span class="poem-line">${sel.item.text}</span><span class="poem-author">${sel.item.source}</span>`;
  }

  if (sel.cat === "proverbs") {
    body = `<span class="poem-line">${sel.item.text}</span><div class="sub">${sel.item.meaning}</div>`;
  }

  if (sel.cat === "word") {
    meta = sel.item.pos;
    body = `<span class="big">${sel.item.word}</span><div class="sub">${sel.item.def}</div>` +
      `<div class="fact-row"><span>“${sel.item.example}”</span></div>`;
  }

  if (sel.cat === "almanac") {
    const a = sel.data;
    const alm = s.almanac;
    meta = a.lunarLabel ? `农历${a.lunarLabel} · ${a.yearGanzhi}年` : `${a.yearGanzhi}年`;
    const bits = [`节气 <b>${a.solarTerm}</b>`];
    if (a.jianchu) bits.push(`值神 <b>${a.jianchu}</b>`);
    bits.push(`<b>${a.chongSha}</b>`);
    body = `<span class="big">${a.dayGanzhi}日</span>` +
      `<div class="fact-row">${bits.map((b) => `<span>${b}</span>`).join("")}</div>` +
      `<div class="fact-row"><span><b>${alm.yi}</b> ${a.yi.join(" · ")}</span></div>` +
      `<div class="fact-row"><span><b>${alm.ji}</b> ${a.ji.join(" · ")}</span></div>` +
      `<div class="fact-row"><span><b>吉神</b> ${a.jiShen.map((g) => `${g.name}（${g.gloss}）`).join(" · ")}</span></div>` +
      `<div class="fact-row"><span><b>凶神</b> ${a.xiongShen.map((g) => `${g.name}（${g.gloss}）`).join(" · ")}</span></div>` +
      `<div class="fact-row"><span><b>彭祖百忌</b> ${a.pengzu[0]}；${a.pengzu[1]}</span></div>` +
      `<div class="sub">${alm.footnote}</div>`;
  }

  if (sel.cat === "astro") {
    const A = s.astro;
    const signName = (sg) => (lang === "zh" ? sg.zh : sg.en);
    if (sel.subtype === "horoscope") {
      const h = sel.horo;
      const sg = SIGNS[h.signIdx];
      const openings = lang === "zh" ? HORO_OPENINGS_ZH : HORO_OPENINGS_EN;
      const advices = lang === "zh" ? HORO_ADVICE_ZH : HORO_ADVICE_EN;
      const color = LUCKY_COLORS[h.colorIdx];
      const dir = LUCKY_DIRECTIONS[h.dirIdx];
      const item = LUCKY_ITEMS[h.itemIdx];
      meta = `${A.daily} · ${sg.symbol} ${signName(sg)}`;
      body = `<span class="big">${sg.symbol} ${signName(sg)}</span>` +
        `<div class="fact-row"><span>${A.overall} <b class="astro-stars">${"★".repeat(h.stars)}${"☆".repeat(5 - h.stars)}</b></span></div>` +
        `<span class="poem-line">${openings[h.openIdx % openings.length]}</span>` +
        `<span class="poem-line">${advices[h.adviceIdx % advices.length]}</span>` +
        `<div class="fact-row"><span>${A.luckyNumber} <b>${h.luckyNumber}</b></span>` +
        `<span>${A.luckyColor}<span class="swatch-sm" style="background:${color.hex}"></span><b>${lang === "zh" ? color.zh : color.en}</b></span>` +
        `<span>${A.luckyDirection} <b>${lang === "zh" ? dir.zh : dir.en}</b></span>` +
        `<span>${A.luckyItem} <b>${lang === "zh" ? item.zh : item.en}</b></span></div>` +
        `<div class="sub">${A.footnote}</div>`;
    } else if (sel.subtype === "positions") {
      meta = A.positions;
      const spans = sel.positions.map((p) => {
        const sg = SIGNS[p.signIdx];
        const retro = p.retrograde ? ` <b>· ${A.retrograde}</b>` : "";
        return `<span>${A.bodies[p.key]} <b>${sg.symbol} ${signName(sg)}</b>${retro}</span>`;
      });
      body = `<div class="fact-row">${spans.join("")}</div>` +
        `<div class="sub">${A.positionsNote} · ${A.footnote}</div>`;
    } else {
      const sg = SIGNS[sel.signIdx];
      meta = `${A.profile} · ${lang === "zh" ? sg.rangeZh : sg.rangeEn}`;
      body = `<span class="big">${sg.symbol} ${signName(sg)}</span>` +
        `<div class="fact-row"><span>${A.element} <b>${A.elements[sg.element]}</b></span>` +
        `<span>${A.rulingPlanet} <b>${lang === "zh" ? sg.planetZh : sg.planetEn}</b></span></div>` +
        `<span class="poem-line">${(lang === "zh" ? sg.traitsZh : sg.traitsEn).join(" · ")}</span>` +
        `<span class="poem-line">${lang === "zh" ? sg.descZh : sg.descEn}</span>` +
        `<div class="sub">${A.footnote}</div>`;
    }
  }

  if (sel.cat === "gossip") {
    const g = sel.item;
    let when = "";
    if (g.publishedAt) {
      const d = new Date(g.publishedAt);
      if (!Number.isNaN(d.valueOf())) {
        when = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
      }
    }
    meta = [g.source, when].filter(Boolean).map(esc).join(" · ");
    body = `<a class="gossip-link" href="${esc(g.link)}" target="_blank" rel="noopener">${esc(g.title)}</a>`;
  }

  if (sel.cat === "chance") {
    const c = s.chance;
    if (sel.kind === "integer") {
      meta = c.integer;
      body = `<span class="big">${sel.value.toLocaleString("en-US")}</span><div class="sub">${lang === "zh" ? "它这辈子只以这种方式出现一次。" : "It will only ever appear exactly like this once."}</div>`;
    } else if (sel.kind === "dice") {
      const glyphs = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      meta = c.dice;
      body = `<span class="big">${glyphs[sel.value[0]]} ${glyphs[sel.value[1]]}</span><div class="sub">${sel.value[0]} + ${sel.value[1]} = ${sel.value[0] + sel.value[1]}</div>`;
    } else if (sel.kind === "coins") {
      meta = c.coins;
      body = `<span class="big">${sel.value.map((h) => (h ? c.heads : c.tails)).join(" · ")}</span>` +
        `<div class="sub">${lang === "zh" ? `${sel.value.filter(Boolean).length} 正 ${sel.value.filter((x) => !x).length} 反` : `${sel.value.filter(Boolean).length} heads, ${sel.value.filter((x) => !x).length} tails`}</div>`;
    } else if (sel.kind === "card") {
      const red = sel.value.suit === "H" || sel.value.suit === "D";
      meta = c.card;
      body = `<span class="big" style="color:${red ? "var(--accent)" : "inherit"}">${sel.value.rank}</span>` +
        `<div class="sub">${c.suits[sel.value.suit]}</div>`;
    } else if (sel.kind === "color") {
      meta = c.color;
      body = `<span class="swatch" style="background:${sel.value}"></span><span class="big">${sel.value}</span>`;
    }
  }

  $("card-category").textContent = s.categories[sel.cat];
  $("card-meta").textContent = meta;
  $("card-body").innerHTML = body;
}

function drawCard() {
  if (gossipEndpoint() && Date.now() - gossipFetchedAt >= GOSSIP_CACHE_MS) refreshGossip();
  const cat = weightedCategory();
  lastCategory = cat;
  currentSelection = makeSelection(cat);
  encounter += 1;
  lastDrawAt = Date.now();
  const card = $("card");
  card.classList.add("leaving");
  setTimeout(() => {
    renderSelection(currentSelection);
    $("encounter").textContent = t().encounter(encounter);
    card.classList.remove("leaving");
  }, 180);
}

/* ================= Clock engine ================= */
function buildAnalogTicks() {
  const g = $("dial-ticks");
  let html = "";
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180;
    const isHour = i % 5 === 0;
    const r1 = isHour ? 84 : 89;
    const x1 = 100 + r1 * Math.sin(a), y1 = 100 - r1 * Math.cos(a);
    const x2 = 100 + 93 * Math.sin(a), y2 = 100 - 93 * Math.cos(a);
    html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="dial-tick${isHour ? " hour" : ""}"/>`;
  }
  g.innerHTML = html;
}

function setFlip(id, value) {
  const el = $(id);
  if (el.textContent !== value) {
    el.textContent = value;
    el.classList.remove("tick");
    void el.offsetWidth; // restart animation
    el.classList.add("tick");
  }
}

function renderDateLine(now) {
  // Special days (festival / term / a personal day) add their note here;
  // the keepsake reads this element, so the note is frozen into it too.
  const note = currentSpecial && currentSpecial.note
    ? (lang === "zh" ? currentSpecial.note.zh : currentSpecial.note.en)
    : "";
  if (lang === "zh") {
    const dateStr = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
    let lunar = "";
    try {
      lunar = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "long", day: "numeric" }).format(now);
    } catch (e) { lunar = ""; }
    let text = lunar ? `${dateStr} · 农历${lunar}` : dateStr;
    if (note) text += ` · ${note}`;
    $("date-line").textContent = text;
  } else {
    let text = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
    if (note) text += ` · ${note}`;
    $("date-line").textContent = text;
  }
}

function tick() {
  const now = new Date();
  // Special-day state rolls over with the local date (and hour, for the
  // meteor night window) even when the page is left open across midnight.
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}:${now.getHours()}`;
  if (stamp !== specialStamp) applySpecialDay();
  const sec = now.getSeconds();
  if (sec === lastSecond) return;
  lastSecond = sec;

  const h = pad(now.getHours()), m = pad(now.getMinutes()), s = pad(sec);

  // digital (paper / minimal)
  $("dig-h").textContent = h;
  $("dig-m").textContent = m;
  $("dig-s").textContent = s;

  // analog
  const secDeg = sec * 6;
  const minDeg = now.getMinutes() * 6 + sec * 0.1;
  const hourDeg = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
  $("hand-second").setAttribute("transform", `rotate(${secDeg} 100 100)`);
  $("hand-minute").setAttribute("transform", `rotate(${minDeg} 100 100)`);
  $("hand-hour").setAttribute("transform", `rotate(${hourDeg} 100 100)`);
  $("ro-h").textContent = h;
  $("ro-m").textContent = m;
  $("ro-s").textContent = s;

  // flip
  setFlip("flip-h", h);
  setFlip("flip-m", m);
  setFlip("flip-s", s);

  // vertical
  if (lang === "zh") {
    $("vertical-time").className = "vertical-time";
    $("vertical-time").innerHTML =
      `${h} 时 ${m} 分 <span class="v-sec">${s} 秒</span>`;
  } else {
    $("vertical-time").className = "vertical-stack";
    $("vertical-time").innerHTML = `<span>${h}</span><span>${m}</span><span style="color:var(--accent)">${s}</span>`;
  }

  renderDateLine(now);

  // minute progress
  $("minute-progress").style.width = `${((sec + now.getMilliseconds() / 1000) / 60) * 100}%`;

  // second-layer randomness
  $("second-random").textContent = `# ${randInt(1000000).toLocaleString("en-US")}`;
  const glow = $("glow");
  const gx = Math.round(Math.random() * 60 - 20);
  const gy = Math.round(Math.random() * 40 - 15);
  glow.style.transform = `translate(${gx}vw, ${gy}vh)`;
  glow.style.opacity = (0.55 + Math.random() * 0.45).toFixed(2);

  // auto-rotate every 60 seconds
  if (Date.now() - lastDrawAt >= 60000) drawCard();
}

/* ================= i18n & style switching ================= */
function applyTheme() {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $("theme-auto").classList.toggle("active", theme === "auto");
  $("theme-light").classList.toggle("active", theme === "light");
  $("theme-dark").classList.toggle("active", theme === "dark");
}

function setTheme(next) {
  if (next === theme) return;
  theme = next;
  localStorage.setItem(LS_THEME, theme);
  applyTheme();
}

function applyStaticStrings() {
  const s = t();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";
  $("brand-title").textContent = s.title;
  $("brand-subtitle").textContent = s.subtitle;
  $("tagline").textContent = s.tagline;
  $("draw-btn").textContent = s.drawNext;
  $("capture-btn").textContent = s.capture;
  $("capture-title").textContent = s.captureTitle;
  $("capture-download").textContent = s.captureDownload;
  $("capture-share").textContent = s.captureShare;
  $("capture-close-btn").textContent = s.captureClose;
  $("hint").textContent = s.hint;
  $("settings-btn").setAttribute("aria-label", s.settings);
  $("settings-panel").setAttribute("aria-label", s.settings);
  $("lang-label").textContent = s.languageLabel;
  $("lang-zh").classList.toggle("active", lang === "zh");
  $("lang-en").classList.toggle("active", lang === "en");
  $("theme-label").textContent = s.themeLabel;
  $("theme-auto").textContent = s.themeAuto;
  $("theme-light").textContent = s.themeLight;
  $("theme-dark").textContent = s.themeDark;
  applyTheme();
  $("style-label").textContent = s.clockStyles.label;
  $("ambient-label").textContent = s.ambientLabel;
  $("ambient-btn").textContent = s.ambientEnter;
  $("ambient-hint").textContent = s.ambientHint;
  $("fx-label").textContent = s.effectsLabel;
  $("fx-on").textContent = s.effectsOn;
  $("fx-off").textContent = s.effectsOff;
  $("fx-on").classList.toggle("active", fxEnabled);
  $("fx-off").classList.toggle("active", !fxEnabled);
  $("mydays-label").textContent = s.myDays.label;
  $("myday-name").placeholder = s.myDays.namePlaceholder;
  $("myday-cal-solar").textContent = s.myDays.solar;
  $("myday-cal-lunar").textContent = s.myDays.lunar;
  $("myday-add").textContent = s.myDays.add;
  refreshMyDayEffectOptions();
  renderMyDaysList();
  $("encounter").textContent = encounter > 0 ? s.encounter(encounter) : "";
  document.querySelectorAll(".style-chip").forEach((chip) => {
    chip.textContent = s.clockStyles[chip.dataset.style];
  });
  refreshSignOptions();
  if (currentSelection) {
    // Language-specific categories (classics/almanac vs proverbs/word) may not
    // exist in the new language: draw a fresh card instead of rendering them.
    if (availableCategories().some((c) => c.key === currentSelection.cat)) renderSelection(currentSelection);
    else { drawCard(); return; }
  }
  lastSecond = -1; // force a clock repaint in the new language
  tick();
}

/* Zodiac sign selector: a static row inside the settings panel.
   Persisted like language/style. */
let signSelectEl = null;
let signLabelEl = null;
function refreshSignOptions() {
  if (!signSelectEl) return;
  const A = t().astro;
  signLabelEl.textContent = A.selectLabel;
  signSelectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = A.auto;
  signSelectEl.appendChild(opt0);
  for (const sg of SIGNS) {
    const o = document.createElement("option");
    o.value = sg.key;
    o.textContent = `${sg.symbol} ${lang === "zh" ? sg.zh : sg.en}`;
    signSelectEl.appendChild(o);
  }
  signSelectEl.value = userSign;
}
function buildSignSelector() {
  signSelectEl = $("sign-select");
  signLabelEl = $("sign-label");
  if (!signSelectEl) return;
  signSelectEl.addEventListener("change", () => {
    userSign = signSelectEl.value;
    if (userSign) localStorage.setItem(LS_SIGN, userSign);
    else localStorage.removeItem(LS_SIGN);
  });
  refreshSignOptions();
}

function buildStyleChips() {
  const wrap = $("style-chips");
  wrap.innerHTML = "";
  for (const st of CLOCK_STYLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "style-chip" + (st === clockStyle ? " active" : "");
    b.dataset.style = st;
    b.textContent = t().clockStyles[st];
    b.addEventListener("click", () => setClockStyle(st));
    wrap.appendChild(b);
  }
}

function setClockStyle(st) {
  clockStyle = st;
  localStorage.setItem(LS_STYLE, st);
  document.body.dataset.clockStyle = st;
  $("clock-digital").hidden = !(st === "paper" || st === "minimal");
  $("clock-analog").hidden = st !== "analog";
  $("clock-flip").hidden = st !== "flip";
  $("clock-vertical").hidden = st !== "vertical";
  document.querySelectorAll(".style-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.style === st);
  });
  lastSecond = -1;
  tick();
}

/* ================= Events & init ================= */
$("draw-btn").addEventListener("click", drawCard);
$("card").addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // let gossip links open normally
  drawCard();
});
$("card").addEventListener("keydown", (e) => {
  if (e.key === "Enter") drawCard();
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && e.target === document.body) {
    e.preventDefault();
    drawCard();
  }
});
function setLang(next) {
  if (next === lang) return;
  lang = next;
  localStorage.setItem(LS_LANG, lang);
  gossipCache = [];
  gossipFetchedAt = 0;
  refreshGossip();
  applyStaticStrings();
}
$("lang-zh").addEventListener("click", () => setLang("zh"));
$("lang-en").addEventListener("click", () => setLang("en"));
$("theme-auto").addEventListener("click", () => setTheme("auto"));
$("theme-light").addEventListener("click", () => setTheme("light"));
$("theme-dark").addEventListener("click", () => setTheme("dark"));

/* Settings panel: toggled by the one quiet button in the top bar; closes on
   outside click and on Esc (which returns focus to the button). */
const settingsBtn = $("settings-btn");
const settingsPanel = $("settings-panel");
function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", String(open));
}
settingsBtn.addEventListener("click", () => {
  setSettingsOpen(settingsPanel.hidden);
});
document.addEventListener("click", (e) => {
  if (!settingsPanel.hidden && !e.target.closest(".settings")) setSettingsOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsPanel.hidden) {
    setSettingsOpen(false);
    settingsBtn.focus();
  }
});

/* ================= Ambient mode ================= */
/* A session-only viewing mode for leaving the page on a desk screen:
   chrome disappears, the clock breathes larger, the card stays. Nothing
   is persisted; a reload always lands back in the normal page. Entering
   also asks for fullscreen and a screen wake lock, both best-effort. */
let ambientOn = false;
let ambientHadFullscreen = false;
let wakeLock = null;
let cursorHideTimer = null;
let hintHideTimer = null;

function pokeAmbientUi() {
  if (!ambientOn) return;
  document.body.classList.remove("cursor-hidden");
  const hint = $("ambient-hint");
  hint.classList.add("show");
  hint.setAttribute("aria-hidden", "false");
  clearTimeout(cursorHideTimer);
  clearTimeout(hintHideTimer);
  cursorHideTimer = setTimeout(() => {
    document.body.classList.add("cursor-hidden");
  }, 3000);
  hintHideTimer = setTimeout(() => {
    hint.classList.remove("show");
    hint.setAttribute("aria-hidden", "true");
  }, 2600);
}

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) { /* denied or unsupported: ambient still works */ }
}

function enterAmbient() {
  if (ambientOn) return;
  ambientOn = true;
  document.body.classList.add("ambient");
  setSettingsOpen(false);
  try {
    const p = document.documentElement.requestFullscreen
      ? document.documentElement.requestFullscreen()
      : null;
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) { /* fullscreen is a bonus, never a requirement */ }
  acquireWakeLock();
  pokeAmbientUi();
}

function exitAmbient() {
  if (!ambientOn) return;
  ambientOn = false;
  ambientHadFullscreen = false;
  document.body.classList.remove("ambient", "cursor-hidden");
  const hint = $("ambient-hint");
  hint.classList.remove("show");
  hint.setAttribute("aria-hidden", "true");
  clearTimeout(cursorHideTimer);
  clearTimeout(hintHideTimer);
  try {
    if (document.fullscreenElement) document.exitFullscreen();
  } catch (e) { /* ignore */ }
  if (wakeLock) {
    try {
      const p = wakeLock.release();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) { /* ignore */ }
    wakeLock = null;
  }
}

$("ambient-btn").addEventListener("click", enterAmbient);
$("ambient-hint").addEventListener("click", exitAmbient);
document.addEventListener("mousemove", pokeAmbientUi);
document.addEventListener("touchstart", pokeAmbientUi, { passive: true });
document.addEventListener("fullscreenchange", () => {
  if (!ambientOn) return;
  if (document.fullscreenElement) ambientHadFullscreen = true;
  else if (ambientHadFullscreen) exitAmbient(); // Esc left fullscreen: leave ambient too
});
document.addEventListener("visibilitychange", () => {
  if (ambientOn && document.visibilityState === "visible") acquireWakeLock();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ambientOn) {
    exitAmbient();
    return;
  }
  /* "f" toggles ambient — only with the settings panel closed and never
     while the user is typing or has a form control focused. */
  if (
    (e.key === "f" || e.key === "F") &&
    !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey &&
    settingsPanel.hidden &&
    !(e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]"))
  ) {
    if (ambientOn) exitAmbient();
    else enterAmbient();
  }
});

/* ================= Keepsake capture （留影） ================= */
/* Freeze the current moment — the exact time plus the card on stage —
   into a 1080×1350 PNG in the OG-image design language, ready to share.
   Pure Canvas 2D: no dependencies, no backend. The capture button lives
   in .controls, so ambient mode hides it like the other controls. */
const KEEP_W = 1080;
const KEEP_H = 1350;

function capturePalette() {
  // Read from <body>, not <html>: special-day dressing overrides the
  // palette variables on body, and the keepsake must wear them too.
  const cs = getComputedStyle(document.body);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    bg: get("--bg"),
    bgSoft: get("--bg-soft"),
    ink: get("--ink"),
    inkSoft: get("--ink-soft"),
    accent: get("--accent"),
    cardBg: get("--card-bg"),
    cardBorder: get("--card-border"),
    glow: get("--glow-color"),
    serif: get("--serif"),
    sans: get("--sans"),
  };
}

/* Flatten the rendered card body into text blocks for the canvas. Walking
   the DOM (instead of re-deriving from the selection) keeps every
   category — poems, almanac, astro, chance… — faithful to what is on
   stage right now. Block kinds mirror the on-page typography. */
function extractCardBlocks() {
  const root = $("card-body");
  const blocks = [];
  let line = null;
  const ensureLine = () => {
    if (!line) line = { text: "", big: false, title: false };
    return line;
  };
  const flush = () => {
    if (line) {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ text, kind: line.big ? "big" : line.title ? "title" : "normal" });
    }
    line = null;
  };
  function walk(node, flags) {
    if (node.nodeType === 3) {
      const L = ensureLine();
      L.text += node.textContent;
      if (flags.big) L.big = true;
      if (flags.title) L.title = true;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const cls = el.classList;
    if (el.tagName === "BR") { flush(); return; }
    if (cls.contains("swatch-sm")) return; // colour dot: its name is in the text
    if (cls.contains("swatch")) {
      flush();
      const bg = el.style.backgroundColor || el.style.background;
      if (bg) blocks.push({ type: "swatch", color: bg });
      return;
    }
    if (cls.contains("fact-row")) {
      flush();
      const parts = [];
      el.querySelectorAll(":scope > span").forEach((sp) => {
        const tx = sp.textContent.replace(/\s+/g, " ").trim();
        if (tx) parts.push(tx);
      });
      if (parts.length) blocks.push({ text: parts.join("  ·  "), kind: "fact" });
      return;
    }
    if (cls.contains("sub") || cls.contains("poem-line")) {
      flush();
      const tx = el.textContent.replace(/\s+/g, " ").trim();
      if (tx) blocks.push({ text: tx, kind: cls.contains("sub") ? "sub" : "normal" });
      return;
    }
    if (cls.contains("poem-author")) {
      const tx = el.textContent.replace(/\s+/g, " ").trim();
      if (!tx) return;
      if (line && line.text.trim()) line.text += "  " + tx; // beside the poem title
      else { flush(); blocks.push({ text: tx, kind: "author" }); }
      return;
    }
    const f2 = {
      big: flags.big || cls.contains("big"),
      title: flags.title || cls.contains("poem-title"),
    };
    for (const c of el.childNodes) walk(c, f2);
    if (cls.contains("moon-glyph")) ensureLine().text += " ";
  }
  for (const c of root.childNodes) walk(c, {});
  flush();
  return blocks;
}

/* Greedy wrapping on top of measureText: breaks after spaces and around
   CJK characters (per-character), words stay whole where they fit, and
   explicit \n always breaks. A single over-wide token is hard-broken. */
function isCjkChar(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0x20000 && cp <= 0x2FA1F) ||
    "，。、；：？！·…—「」『』（）《》〈〉【】％".includes(ch);
}
function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (!para) { out.push(""); continue; }
    const chars = Array.from(para);
    let start = 0;
    while (start < chars.length) {
      while (start < chars.length && chars[start] === " ") start++;
      if (start >= chars.length) break;
      let end = start;
      let lastBreak = -1;
      while (end < chars.length) {
        const seg = chars.slice(start, end + 1).join("");
        if (end > start && ctx.measureText(seg).width > maxWidth) break;
        const ch = chars[end];
        const next = chars[end + 1];
        if (ch === " " || isCjkChar(ch) || (next && isCjkChar(next))) lastBreak = end + 1;
        end++;
      }
      if (end >= chars.length) {
        out.push(chars.slice(start).join("").replace(/\s+$/, ""));
        start = chars.length;
      } else {
        let cut = lastBreak > start ? lastBreak : end;
        // Kinsoku-lite: closing punctuation may not start a line — pull
        // one character down with it instead of orphaning it there.
        const NO_LINE_START = "，。、；：？！）】》」』…·";
        while (cut > start + 1 && cut < chars.length && NO_LINE_START.includes(chars[cut])) cut--;
        out.push(chars.slice(start, cut).join("").replace(/\s+$/, ""));
        start = cut;
      }
    }
  }
  return out;
}

const KEEP_KINDS = {
  big:    { weight: 900, size: 62, lh: 1.45, color: "ink" },
  title:  { weight: 900, size: 46, lh: 1.40, color: "ink" },
  normal: { weight: 400, size: 40, lh: 1.72, color: "ink" },
  fact:   { weight: 400, size: 31, lh: 1.60, color: "inkSoft" },
  sub:    { weight: 400, size: 30, lh: 1.60, color: "inkSoft" },
  author: { weight: 400, size: 32, lh: 1.50, color: "inkSoft" },
};
function keepFont(pal, spec, scale) {
  return `${spec.weight} ${Math.max(10, Math.round(spec.size * scale))}px ${pal.serif}`;
}

/* Lay the body blocks out within maxHeight, shrinking via the caller's
   scale steps first; if it still overflows, lines are dropped and the
   last surviving line gains an ellipsis. */
function layoutKeepsakeBody(ctx, blocks, pal, maxWidth, scale, maxHeight) {
  const items = [];
  let y = 0;
  let truncated = false;
  const gap = Math.round(12 * scale);
  outer:
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (bi > 0) y += gap;
    if (b.type === "swatch") {
      const size = Math.round(72 * scale);
      if (y + size > maxHeight) { truncated = true; break; }
      items.push({ type: "swatch", color: b.color, yOff: y, size });
      y += size + Math.round(10 * scale);
      continue;
    }
    const spec = KEEP_KINDS[b.kind] || KEEP_KINDS.normal;
    const font = keepFont(pal, spec, scale);
    ctx.font = font;
    const size = Math.max(10, Math.round(spec.size * scale));
    const lineH = Math.round(spec.size * scale * spec.lh);
    for (const ln of wrapText(ctx, b.text, maxWidth)) {
      if (y + lineH > maxHeight) { truncated = true; break outer; }
      items.push({ type: "text", text: ln, font, color: spec.color, yOff: y, lineH, size });
      y += lineH;
    }
  }
  if (truncated) {
    while (items.length && items[items.length - 1].type !== "text") items.pop();
    const last = items[items.length - 1];
    if (last) {
      ctx.font = last.font;
      let txt = last.text;
      while (txt.length && ctx.measureText(txt + "…").width > maxWidth) txt = txt.slice(0, -1);
      last.text = txt + "…";
    }
  }
  return { items, height: y, truncated };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function setLetterSpacing(ctx, v) {
  try { ctx.letterSpacing = v; } catch (e) { /* older engines: no spacing, still fine */ }
}

function renderKeepsakeCanvas(snap, pal) {
  const cv = document.createElement("canvas");
  cv.width = KEEP_W;
  cv.height = KEEP_H;
  const ctx = cv.getContext("2d");
  const cx = KEEP_W / 2;

  // paper + a whisper of the drifting glow, frozen in one corner
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, KEEP_W, KEEP_H);
  const glow = ctx.createRadialGradient(KEEP_W * 0.86, 110, 0, KEEP_W * 0.86, 110, 720);
  glow.addColorStop(0, pal.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, KEEP_W, KEEP_H);

  // hairline frame
  ctx.strokeStyle = pal.cardBorder;
  ctx.lineWidth = 2;
  ctx.strokeRect(46, 46, KEEP_W - 92, KEEP_H - 92);

  // seal
  const sealSize = 96;
  ctx.save();
  ctx.translate(cx, 108 + sealSize / 2);
  ctx.rotate((-3 * Math.PI) / 180);
  roundRectPath(ctx, -sealSize / 2, -sealSize / 2, sealSize, sealSize, 13);
  ctx.fillStyle = pal.accent;
  ctx.fill();
  ctx.fillStyle = "#fff8ee";
  ctx.font = `900 54px ${pal.serif}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("时", 0, 5);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // brand line
  ctx.fillStyle = pal.ink;
  ctx.font = `600 34px ${pal.serif}`;
  setLetterSpacing(ctx, "6px");
  ctx.fillText(snap.brand, cx, 272);
  setLetterSpacing(ctx, "0px");

  // date line (same text as on the page)
  ctx.fillStyle = pal.inkSoft;
  ctx.font = `400 29px ${pal.serif}`;
  ctx.fillText(snap.dateLine, cx, 330);

  // the frozen time — always serif, auto-fitted to the frame
  let tSize = 215;
  ctx.font = `900 ${tSize}px ${pal.serif}`;
  while (ctx.measureText(snap.time).width > 900 && tSize > 80) {
    tSize -= 8;
    ctx.font = `900 ${tSize}px ${pal.serif}`;
  }
  ctx.fillStyle = pal.ink;
  ctx.fillText(snap.time, cx, 568);

  // cinnabar rule
  ctx.fillStyle = pal.accent;
  ctx.fillRect(cx - 60, 608, 120, 5);

  // card panel: header (category, meta) then the body blocks
  const panelX = 90;
  const panelW = KEEP_W - 180;
  const panelTop = 652;
  const panelBottomMax = 1204;
  const textX = panelX + 58;
  const textW = panelW - 116;

  const catBaseline = panelTop + 84;
  const metaBaseline = catBaseline + 50;
  const bodyTop = (snap.meta ? metaBaseline : catBaseline) + 48;
  const availBodyH = panelBottomMax - bodyTop - 46;

  let layout = null;
  for (const scale of [1, 0.92, 0.85, 0.78, 0.72]) {
    layout = layoutKeepsakeBody(ctx, snap.blocks, pal, textW, scale, availBodyH);
    if (!layout.truncated) break;
  }
  const panelBottom = Math.min(
    panelBottomMax,
    Math.max(bodyTop + layout.height + 48, panelTop + 360)
  );

  roundRectPath(ctx, panelX, panelTop, panelW, panelBottom - panelTop, 18);
  ctx.fillStyle = pal.cardBg;
  ctx.fill();
  ctx.strokeStyle = pal.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = pal.accent;
  ctx.font = `600 30px ${pal.serif}`;
  setLetterSpacing(ctx, "8px");
  ctx.fillText(snap.category, textX, catBaseline);
  setLetterSpacing(ctx, "0px");
  if (snap.meta) {
    ctx.fillStyle = pal.inkSoft;
    ctx.font = `400 28px ${pal.serif}`;
    ctx.fillText(snap.meta, textX, metaBaseline);
  }

  for (const it of layout.items) {
    if (it.type === "swatch") {
      roundRectPath(ctx, textX, bodyTop + it.yOff, it.size, it.size, 12);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.strokeStyle = pal.cardBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.font = it.font;
      ctx.fillStyle = pal[it.color];
      ctx.fillText(it.text, textX, bodyTop + it.yOff + (it.lineH - it.size) / 2 + it.size * 0.8);
    }
  }

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = pal.inkSoft;
  ctx.font = `300 26px ${pal.sans}`;
  setLetterSpacing(ctx, "3px");
  ctx.fillText(snap.footer, cx, 1280);
  setLetterSpacing(ctx, "0px");

  return cv;
}

async function ensureCaptureFonts() {
  try {
    const loads = [
      document.fonts.load("900 100px \"Noto Serif SC\""),
      document.fonts.load("600 30px \"Noto Serif SC\""),
      document.fonts.load("400 40px \"Noto Serif SC\""),
      document.fonts.load("300 26px \"Noto Sans SC\""),
    ];
    await Promise.race([
      Promise.all(loads).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* fall back to whatever fonts are available */ }
}

let captureUrl = null;
let captureFile = null;

function showCapture(blob, frozen) {
  if (captureUrl) URL.revokeObjectURL(captureUrl);
  captureUrl = URL.createObjectURL(blob);
  const fname = `now-and-more-${frozen.getFullYear()}${pad(frozen.getMonth() + 1)}${pad(frozen.getDate())}` +
    `-${pad(frozen.getHours())}${pad(frozen.getMinutes())}${pad(frozen.getSeconds())}.png`;
  $("capture-img").src = captureUrl;
  const dl = $("capture-download");
  dl.href = captureUrl;
  dl.setAttribute("download", fname);
  try {
    captureFile = new File([blob], fname, { type: "image/png" });
  } catch (e) { captureFile = null; }
  const canShare = !!(captureFile && navigator.canShare && navigator.canShare({ files: [captureFile] }));
  $("capture-share").hidden = !canShare;
  $("capture-overlay").hidden = false;
  $("capture-close-btn").focus();
}

function closeCapture() {
  if ($("capture-overlay").hidden) return;
  $("capture-overlay").hidden = true;
  if (captureUrl) {
    URL.revokeObjectURL(captureUrl);
    captureUrl = null;
  }
  captureFile = null;
  $("capture-btn").focus();
}

async function captureKeepsake() {
  const btn = $("capture-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const frozen = new Date();
    const s = t();
    const enc = encounter > 0 ? s.encounter(encounter) : "";
    const snap = {
      time: `${pad(frozen.getHours())}:${pad(frozen.getMinutes())}:${pad(frozen.getSeconds())}`,
      dateLine: $("date-line").textContent,
      category: $("card-category").textContent,
      meta: $("card-meta").textContent,
      blocks: extractCardBlocks(),
      brand: lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有",
      footer: enc ? `${enc} · now.orangely.xyz` : "now.orangely.xyz",
    };
    const pal = capturePalette();
    await ensureCaptureFonts();
    const cv = renderKeepsakeCanvas(snap, pal);
    const blob = await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
    if (blob) showCapture(blob, frozen);
  } catch (e) { /* capture is a keepsake, never a page-breaker */ }
  finally { btn.disabled = false; }
}

$("capture-btn").addEventListener("click", captureKeepsake);
$("capture-close-btn").addEventListener("click", closeCapture);
$("capture-overlay").addEventListener("click", (e) => {
  if (e.target === $("capture-overlay")) closeCapture();
});
$("capture-share").addEventListener("click", async () => {
  if (!captureFile) return;
  try {
    await navigator.share({ files: [captureFile], title: document.title });
  } catch (e) { /* user cancelled or share failed: the download still works */ }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("capture-overlay").hidden) closeCapture();
});

/* ================= Init ================= */
buildAnalogTicks();
buildStyleChips();
buildSignSelector();
buildMyDaysForm();
fxResize();
setClockStyle(clockStyle);
applyStaticStrings();
applySpecialDay();
refreshGossip();
drawCard();
setInterval(tick, 200);
tick();

/* Offline shell: register the service worker after load; any failure is
   silent — the site must work exactly the same without it. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    try {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } catch (e) { /* ignore */ }
  });
}
