/* Now, and More — app logic
   Certainty: the clock. Uncertainty: everything below it. */
"use strict";

/* ================= State ================= */
const LS_LANG = "nam-lang";
const LS_STYLE = "nam-clock-style";
const CLOCK_STYLES = ["paper", "minimal", "analog", "flip", "vertical"];

let lang = localStorage.getItem(LS_LANG);
if (!lang) {
  lang = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}
let clockStyle = localStorage.getItem(LS_STYLE) || "paper";
if (!CLOCK_STYLES.includes(clockStyle)) clockStyle = "paper";

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

/* ================= Card selection & rendering ================= */
function weightedCategory() {
  const total = CATEGORY_WEIGHTS.reduce((s, c) => s + c.weight, 0);
  for (let attempt = 0; attempt < 4; attempt++) {
    let r = Math.random() * total;
    let chosen = CATEGORY_WEIGHTS[0].key;
    for (const c of CATEGORY_WEIGHTS) {
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
      // The moon is one extra "place" in the world pool.
      const slot = randInt(CITIES.length + 1);
      if (slot === CITIES.length) return { cat, moon: true };
      return { cat, city: CITIES[slot] };
    }
    case "poem":
      return { cat, poemZh: pick(POEMS_ZH), poemEn: pick(POEMS_EN) };
    case "history": {
      const now = new Date();
      const key = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      if (HISTORY[key]) return { cat, key, entry: HISTORY[key], today: true };
      const keys = Object.keys(HISTORY);
      const rk = pick(keys);
      return { cat, key: rk, entry: HISTORY[rk], today: false };
    }
    case "thought":
      return { cat, item: pick(THOUGHTS) };
    case "memory":
      return { cat, item: pick(MEMORY_PROMPTS) };
    case "chance": {
      const kinds = ["integer", "dice", "coins", "card", "color"];
      const kind = pick(kinds);
      const sel = { cat, kind };
      if (kind === "integer") sel.value = randInt(1000000);
      if (kind === "dice") sel.value = [1 + randInt(6), 1 + randInt(6)];
      if (kind === "coins") sel.value = Array.from({ length: 8 }, () => Math.random() < 0.5);
      if (kind === "card") {
        const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
        sel.value = { rank: pick(ranks), suit: pick(["S", "H", "D", "C"]) };
      }
      if (kind === "color") {
        sel.value = "#" + Array.from({ length: 3 }, () => pad(randInt(256).toString(16)).toUpperCase()).join("");
      }
      return sel;
    }
    default:
      return { cat: "thought", item: pick(THOUGHTS) };
  }
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

  if (sel.cat === "thought" || sel.cat === "memory") {
    body = lang === "zh" ? sel.item.zh : sel.item.en;
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
  if (lang === "zh") {
    const dateStr = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
    let lunar = "";
    try {
      lunar = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", { month: "long", day: "numeric" }).format(now);
    } catch (e) { lunar = ""; }
    $("date-line").textContent = lunar ? `${dateStr} · 农历${lunar}` : dateStr;
  } else {
    $("date-line").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  }
}

function tick() {
  const now = new Date();
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
  $("analog-readout").textContent = `${h}:${m}:${s}`;

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
function applyStaticStrings() {
  const s = t();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";
  $("brand-title").textContent = s.title;
  $("brand-subtitle").textContent = s.subtitle;
  $("tagline").textContent = s.tagline;
  $("draw-btn").textContent = s.drawNext;
  $("hint").textContent = s.hint;
  $("lang-toggle").textContent = s.langToggle;
  $("style-label").textContent = s.clockStyles.label;
  $("encounter").textContent = encounter > 0 ? s.encounter(encounter) : "";
  document.querySelectorAll(".style-chip").forEach((chip) => {
    chip.textContent = s.clockStyles[chip.dataset.style];
  });
  if (currentSelection) renderSelection(currentSelection);
  lastSecond = -1; // force a clock repaint in the new language
  tick();
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
$("card").addEventListener("click", drawCard);
$("card").addEventListener("keydown", (e) => {
  if (e.key === "Enter") drawCard();
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && e.target === document.body) {
    e.preventDefault();
    drawCard();
  }
});
$("lang-toggle").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  localStorage.setItem(LS_LANG, lang);
  applyStaticStrings();
});

buildAnalogTicks();
buildStyleChips();
setClockStyle(clockStyle);
applyStaticStrings();
drawCard();
setInterval(tick, 200);
tick();
