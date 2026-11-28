/* Now, and More — app logic
   Certainty: the clock. Uncertainty: everything below it. */
"use strict";

const appStorage = NAM_DEDUP.safeStorage(() => window.localStorage);

/* ================= Config ================= */
/* The Worker serves a language-specific candidate list. The cache and
   in-flight requests are isolated by language, so a late reply cannot
   replace another language's news. Empty config disables the category. */
const GOSSIP_API = "https://now-and-more.orangely.workers.dev/gossip";
const gossipClient = NAM_GOSSIP.createClient();

function gossipEndpoint() {
  try {
    const config = window.NOW_AND_MORE_CONFIG;
    if (config && typeof config.gossipApi === "string") return config.gossipApi;
  } catch (e) { /* ignore */ }
  return GOSSIP_API;
}

function refreshGossip() {
  const requestLang = lang;
  const endpoint = gossipEndpoint();
  // Persist legacy conversion even when the pool is empty or cooling down.
  // Refresh observations enrich seen identities but never consume a draw.
  return Promise.resolve()
    .then(() => deckState.updateGossip(requestLang, raw => NAM_GOSSIP.reconcile([], raw)))
    .then(() => gossipClient.refresh(requestLang, endpoint))
    .then(async items => {
      // Recheck the endpoint inside the serialized maintenance operation.
      await deckState.updateGossip(requestLang, raw =>
        endpoint === gossipEndpoint() ? NAM_GOSSIP.reconcile(items, raw) : raw);
      return items;
    }).catch(() => []);
}

/* ================= State ================= */
const LS_LANG = "nam-lang";
const LS_STYLE = "nam-clock-style";
const LS_SIGN = "nam-sign";
const LS_THEME = "nam-theme";
const THEMES = ["auto", "light", "dark"];
const CLOCK_STYLES = ["paper", "minimal", "analog", "flip", "vertical"];

let lang = appStorage.getItem(LS_LANG);
if (lang !== "zh" && lang !== "en") {
  lang = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}
let clockStyle = appStorage.getItem(LS_STYLE) || "paper";
if (!CLOCK_STYLES.includes(clockStyle)) clockStyle = "paper";

/* Theme: "auto" follows prefers-color-scheme; "light"/"dark" force a
   palette via data-theme on <html> (also set pre-paint by the inline
   script in index.html). */
let theme = appStorage.getItem(LS_THEME) || "auto";
if (!THEMES.includes(theme)) theme = "auto";

/* User's zodiac sign ("" = random). Set via the sign selector; the daily
   horoscope uses it 70% of the time when set. */
let userSign = appStorage.getItem(LS_SIGN) || "";
if (userSign && !SIGNS.some((sg) => sg.key === userSign)) userSign = "";

let encounter = 0;
let lastCategory = null;
let currentSelection = null; // { cat, ...payload } — re-renderable on language switch
let liveWorldTime = null; // { tz, el } while a world-city card is on stage — its local time ticks
let lastDrawAt = Date.now();
let lastSecond = -1;

const $ = (id) => document.getElementById(id);
const t = () => I18N[lang];
const pad = (n) => String(n).padStart(2, "0");
const randInt = (max) => Math.floor(Math.random() * max);
const pick = (arr) => arr[randInt(arr.length)];

/* ================= No-repeat decks （去重） ================= */
/* Enumerated pools use shuffle bags. The state is published only after
   the selected card renders; a reload resumes the last committed bag. */
const sharedLocks = NAM_DEDUP.browserLocks();
const deckState = NAM_DEDUP.createDeckState(appStorage, () => Math.random(), {
  legacyIds: NAM_LEGACY_DECK_IDS, locks: sharedLocks,
});
// Copy a budget an older build left inside nam-decks-v2. Passive sync
// must not do this write; the shared lock rereads both keys first.
const historyMigration = deckState.withLock(() => {});
if (historyMigration && typeof historyMigration.then === "function") historyMigration.catch(() => {});
const deckDraw = key => deckState.draw(key, NAM_DECK_IDS[key]);

/* Dynamic news is eligible only if unseen or cooled down. Keep history
   in D1's render transaction: no fetch or failed render consumes news. */
function gossipCandidates() {
  return NAM_GOSSIP.eligible(gossipClient.items(lang, gossipEndpoint()), deckState.state.g[lang]);
}
function drawGossipItem() {
  const candidates = gossipCandidates();
  if (!candidates.length) return null;
  const item = pick(candidates);
  deckState.state.g[lang] = NAM_GOSSIP.record(deckState.state.g[lang], item);
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

// Use the existing synchronous approximate illumination calculation.
// At >= 98% (roughly three days around full moon), give the moon
// four tickets and each other form one; otherwise keep equal odds.
function chooseSkyForm(date, random = Math.random) {
  const forms = moonPhase(date).illum >= 98
    ? ["chart", "illustration", "moon", "moon", "moon", "moon"]
    : ["chart", "illustration", "moon"];
  return forms[Math.floor(random() * forms.length)];
}

/* ================= Night sky （星空） =================
   Positions and the watercolour illustration come from the pinned
   Sky Engine SDK (vendor/sky-engine/0.2.0, see docs/sky-engine.md).
   This file keeps the product rules: which evening to show, where the
   observer is, the approximation label, and which of NAM's own
   asterisms is tonight's highlight. The circular chart and the moon
   portrait are the SDK's own pictures of that same scene. The almanac
   and sunrise math above stay as they are. */
const SKY_SIG_MONTHS = {
  dipper: [2, 3, 4], cassiopeia: [8, 9, 10, 11, 0], orion: [10, 11, 0, 1, 2],
  triangle: [5, 6, 7, 8, 9], scorpius: [4, 5, 6, 7], crux: [1, 2, 3, 4, 5],
};
const SKY_PHASE_INDEX = {
  new: 0, "waxing-crescent": 1, "first-quarter": 2, "waxing-gibbous": 3,
  full: 4, "waning-gibbous": 5, "last-quarter": 6, "waning-crescent": 7,
};
const SKY_SYNODIC = 29.530588853;

function skyLocalTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch (e) { return "UTC"; }
}
function skyMonthInZone(date, tz) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(date)) - 1;
  } catch (e) { return date.getMonth(); }
}
function skyLocation() {
  const tz = skyLocalTz();
  const city = CITIES.find((c) => c.tz === tz);
  if (city) return { lat: city.lat, lon: city.lon, tz };
  // No matching city: the zone's longitude from its UTC offset and a
  // mid-northern latitude. The chart card still says 按时区粗算.
  return { lat: 35, lon: -new Date().getTimezoneOffset() / 4, tz };
}
function skyInstant(now) {
  const t = new Date(now);
  t.setHours(21, 0, 0, 0);
  return now.getTime() >= t.getTime() ? now : t;
}
function skyZoneOffsetMs(tz, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}
/* Tonight's 21:00 in an IANA zone (or `now`, once it has passed there). */
function skyInstantInZone(now, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  let guess = Date.UTC(+p.year, +p.month - 1, +p.day, 21, 0, 0);
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(+p.year, +p.month - 1, +p.day, 21, 0, 0) - skyZoneOffsetMs(tz, guess);
  }
  return now.getTime() >= guess ? now : new Date(guess);
}

/* Illustration viewpoint, chosen once per draw:
   1. The visitor's sky, if geolocation was already granted this session.
   2. Otherwise a city drawn from the 42, at that city's own 21:00.
   The request is lazy, never blocks the card, and never sends the
   position anywhere. A fix that arrives after this draw applies next time. */
const SKY_GEO_KEY = "nam-sky-geo";
let skyGeoState = null;
function skyStoredPosition() {
  try {
    const raw = sessionStorage.getItem(SKY_GEO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.lat === "number" && typeof p.lon === "number") return p;
  } catch (e) { /* storage unavailable */ }
  return null;
}
function skyRequestPosition() {
  if (skyGeoState) return;
  if (!("geolocation" in navigator)) { skyGeoState = { status: "unsupported" }; return; }
  skyGeoState = { status: "pending" };
  try {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        skyGeoState = { status: "granted", lat: p.lat, lon: p.lon };
        try { sessionStorage.setItem(SKY_GEO_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
      },
      () => { skyGeoState = { status: "denied" }; },
      { timeout: 10000, maximumAge: 600000 }
    );
  } catch (e) { skyGeoState = { status: "denied" }; }
}
function skyNearestCity(lat, lon) {
  let city = null, km = Infinity;
  for (const c of CITIES) {
    const dLat = (c.lat - lat) * RAD, dLon = (c.lon - lon) * RAD;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * RAD) * Math.cos(c.lat * RAD) * Math.sin(dLon / 2) ** 2;
    const d = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (d < km) { km = d; city = c; }
  }
  return { city, km };
}
function illustrationPlace(now) {
  const granted = skyGeoState && skyGeoState.status === "granted"
    ? skyGeoState : skyStoredPosition();
  if (granted) {
    const near = skyNearestCity(granted.lat, granted.lon);
    return {
      lat: granted.lat, lon: granted.lon, when: skyInstant(now),
      city: near.km <= 150 ? near.city : null, here: true,
    };
  }
  skyRequestPosition();
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  return {
    lat: city.lat, lon: city.lon, when: skyInstantInZone(now, city.tz),
    city, here: false,
  };
}
function skyPlaceName(place) {
  if (place && place.city) return lang === "zh" ? place.city.zh : place.city.en;
  return t().sky.hereLabel;
}
function skyObserverFor(now, place) {
  if (place) {
    const tz = place.here ? skyLocalTz() : (place.city ? place.city.tz : skyLocalTz());
    return {
      lat: place.lat, lon: place.lon, tz, when: place.when,
      name: place.city ? place.city.en : "",
    };
  }
  const loc = skyLocation();
  return { lat: loc.lat, lon: loc.lon, tz: loc.tz, when: skyInstant(now), name: "" };
}

/* Tonight's highlight: in-season first, then the highest cluster that
   is mostly above the horizon. Directions are averaged as vectors so a
   pattern that crosses north (azimuth 0/360) does not flip to the south. */
function chooseSignature(starsById, when, tz) {
  const month = skyMonthInZone(when, tz);
  let sig = null;
  for (const key of Object.keys(SKY_PATTERNS)) {
    const lines = SKY_PATTERNS[key].lines;
    const members = [...new Set(lines.flat())];
    const placed = [];
    for (const id of members) {
      const star = starsById.get(id);
      if (star) placed.push(star);
    }
    const up = placed.filter((s) => s.altitude > 0);
    if (up.length < Math.ceil(members.length * 0.6)) continue;
    let x = 0, y = 0, z = 0, cAlt = 0;
    for (const s of up) {
      const a = s.altitude * RAD, az = s.azimuth * RAD;
      x += Math.cos(a) * Math.sin(az);
      y += Math.sin(a);
      z += -Math.cos(a) * Math.cos(az);
      cAlt += s.altitude;
    }
    cAlt /= up.length;
    if (cAlt < 8 || Math.hypot(x, y, z) < 1e-6) continue;
    const score = (SKY_SIG_MONTHS[key].includes(month) ? 1000 : 0) + cAlt;
    if (!sig || score > sig.score) {
      const az = norm360(Math.atan2(x, -z) / RAD);
      sig = {
        key, score, az, alt: cAlt, lines,
        dir: Math.round(az / 45) % 8,
      };
    }
  }
  return sig;
}
function skySummary(scene, observer) {
  const sky = scene.sky;
  const byId = new Map(sky.stars.map((s) => [s.id, s]));
  const sig = chooseSignature(byId, observer.when, observer.tz);
  const moon = sky.moon;
  return {
    sig,
    moon: {
      alt: moon.altitude, az: moon.azimuth,
      illum: Math.round(moon.illumination * 100),
      idx: SKY_PHASE_INDEX[moon.phase] ?? 0,
      waxing: moon.waxing,
      age: Math.max(0, Math.round((moon.phaseAngle / 360) * SKY_SYNODIC)),
    },
  };
}

let skyVisualGen = 0;
function skyFactsInner(sel) {
  const K = t().sky;
  if (sel.skyError) return { error: true, html: esc(K.error) };
  const sc = sel.summary;
  if (!sc) return { error: false, html: esc(K.loading) };
  if (sc.sig) {
    return {
      error: false,
      look: K.lookFor(K.asterisms[sc.sig.key].name, K.dirs[sc.sig.dir]),
      line: K.asterisms[sc.sig.key].line,
    };
  }
  return { error: false, look: K.fallback, line: "" };
}
function skyRetryButtonHtml() {
  const label = NAM_SKY.needsReload() ? t().sky.reload : t().sky.retry;
  return `<button type="button" class="sky-retry">${esc(label)}</button>`;
}
function skyMoonFactsHtml(sel) {
  if (sel.skyError) {
    return `<span>${esc(t().sky.error)}</span><span>${skyRetryButtonHtml()}</span>`;
  }
  if (!sel.summary) return `<span>${esc(t().sky.loading)}</span>`;
  const W = t().world;
  const moon = sel.summary.moon;
  return `<span>${esc(W.moonIllum(moon.illum))}</span><span>${esc(W.moonAge(moon.age))}</span>`;
}
function skyChartFactsHtml(sel) {
  const bits = skyFactsInner(sel);
  if (bits.error) {
    return `<span>${bits.html}</span><span>${skyRetryButtonHtml()}</span>`;
  }
  if (!sel.summary) return `<span>${bits.html}</span>`;
  return (bits.look ? `<span>${esc(bits.look)}</span>` : "") +
    (bits.line ? `<span>${esc(bits.line)}</span>` : "");
}
function skyArtFactsHtml(sel) {
  const bits = skyFactsInner(sel);
  if (bits.error) {
    return `<p class="sa-line">${bits.html}</p><p class="sa-line">${skyRetryButtonHtml()}</p>`;
  }
  if (!sel.summary) return `<p class="sa-line">${bits.html}</p>`;
  return `<p class="sa-line">${esc(bits.look)}</p>` +
    (bits.line ? `<p class="sa-line">${esc(bits.line)}</p>` : "");
}
function bindSkyRetry(sel) {
  const surface = sel._surface || stageSurface();
  const btn = surface.body.querySelector(".sky-retry");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (surface.stage ? currentSelection !== sel : imageModalSel !== sel) return;
    if (NAM_SKY.needsReload()) {
      window.location.reload();
      return;
    }
    NAM_SKY.reset();
    sel.ready = NAM_SKY.sceneFor(sel.observer);
    sel.scene = null;
    sel.summary = null;
    sel.skyError = null;
    if (surface.stage) updateSkyCopy(sel);
    scheduleSkyVisual(sel, surface);
  });
}
function updateSkyCopy(sel) {
  const surface = sel._surface || stageSurface();
  if (String(sel._skyGen || "") !== String(surface.card.dataset.skyGen || "")) return;
  if (sel.form === "illustration") {
    const text = surface.body.querySelector(".sa-text");
    const head = text && text.querySelector(".sa-head");
    if (!text || !head) return;
    [...text.children].forEach((el) => { if (el !== head) el.remove(); });
    const external = surface.body.querySelector(":scope > .skyart-status");
    if (external) external.remove();
    // .skyart clips overflow, and the retry control is a fixed height
    // while the paper strip scales with the card. Keep a failed
    // illustration's retry outside that strip on every surface — the
    // lightbox and the stage, including ambient mode.
    if (sel.skyError) {
      surface.body.insertAdjacentHTML("beforeend",
        `<div class="fact-row skyart-status"><span>${esc(t().sky.error)}</span><span>${skyRetryButtonHtml()}</span></div>`);
    } else {
      head.insertAdjacentHTML("afterend", skyArtFactsHtml(sel));
    }
  } else if (sel.form === "chart") {
    const row = surface.body.querySelector(".fact-row");
    if (row) row.innerHTML = skyChartFactsHtml(sel);
  } else if (sel.form === "moon") {
    const row = surface.body.querySelector(".fact-row");
    if (row) row.innerHTML = skyMoonFactsHtml(sel);
    const big = surface.body.querySelector(".big");
    if (big) big.textContent = sel.summary ? t().world.phases[sel.summary.moon.idx] : t().sky.loading;
  }
  bindSkyRetry(sel);
}
/* Start a scene during the draw, but never await it under the deck lock.
   A later card increments the generation and aborts the canvas paint.
   The paint is scoped to ONE surface (the stage, or the picture modal):
   the generation stamp lives on that surface's card element and the
   canvas is looked up inside that surface's body, so a stage repaint
   can never write into the modal's canvas, nor the other way round. */
function scheduleSkyVisual(sel, surface) {
  surface = surface || stageSurface();
  sel._surface = surface;
  const gen = ++skyVisualGen;
  sel._skyGen = gen;
  if (sel._abort) sel._abort.abort();
  const ctrl = new AbortController();
  sel._abort = ctrl;
  surface.card.dataset.skyGen = String(gen);
  sel.skyError = null;
  if (!surface.stage) {
    clearModalPicture();
    showModalStatus(sel, false);
  }
  const current = () => gen === skyVisualGen && !ctrl.signal.aborted &&
    surface.card.dataset.skyGen === String(gen);
  const job = Promise.resolve(sel.ready || (sel.ready = NAM_SKY.sceneFor(sel.observer)))
    .then(async (scene) => {
      if (!current()) return false;
      sel.scene = scene;
      sel.summary = skySummary(scene, sel.observer);
      if (surface.stage) updateSkyCopy(sel);
      // Independent modal canvases prevent a superseded render from
      // modifying the current image after retry or close.
      const cv = surface.stage ? surface.body.querySelector("canvas.sky-canvas") :
        document.createElement("canvas");
      if (!cv || !current()) return false;
      if (!surface.stage) {
        cv.width = KEEP_W;
        cv.height = sel.form === "illustration" ? SKY_KEEP_ART_H : KEEP_W;
      }
      if (sel.form === "chart") {
        await NAM_SKY.paintChart(cv, scene, lang === "zh" ? "zh-Hans" : "en");
      } else if (sel.form === "moon") {
        await NAM_SKY.paintMoon(cv, scene, ctrl.signal);
      } else {
        await NAM_SKY.paintIllustration(cv, scene, sel.summary.sig, ctrl.signal);
      }
      if (!current()) return false;
      if (!surface.stage) {
        await ensureCaptureFonts();
        if (!current()) return false;
        const serif = capturePalette().serif;
        const picture = sel.form === "illustration"
          ? await renderSkyArtKeepsake(sel, serif, cv)
          : renderAstronomyPicture(sel, cv, serif);
        if (!current() || !await publishModalPicture(sel, gen, picture, modalPictureDescription(sel))) return false;
      }
      sel._paintedGen = gen;
      return true;
    })
    .catch((err) => {
      if (!current()) return false;
      sel.skyError = err;
      sel.summary = null;
      if (surface.stage) updateSkyCopy(sel);
      else showModalStatus(sel, true);
      return false;
    });
  sel.painted = job;
  return job;
}
/* ================= End night sky ================= */


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

/* ================= Precise solar terms （节气交节时刻） =================
   A solar term is an instant, not a date: the moment the Sun's APPARENT
   ecliptic longitude crosses a multiple of 15°. The SunCalc-grade
   longitude used for sunrise/sunset above can misplace a crossing by
   hours (it put the 2026 winter solstice on the wrong day), so terms get
   their own ephemeris: Meeus (Astronomical Algorithms, ch. 25) Keplerian
   core + the 19 largest non-Keplerian VSOP87D perturbation terms for
   longitude (App. III) + the matching R series (for aberration) + the
   four largest nutation terms (ch. 22). Crossings are solved in TT by
   Newton iteration and converted to UTC with a ΔT model. Verified
   against the Hong Kong Observatory's published tables: all 24 terms of
   2026 within 1.3 minutes (mean |dev| ≈ 0.52), and the 2025/2027
   solstices & equinoxes within ~1.1 minutes. */
/* [A, B, C] triples: A·cos(B + C·τ), A in 1e-8 rad (longitude) or 1e-8 AU
   (distance), τ in Julian millennia of TT from J2000. */
const TERM_VSOP_L0 = [
  [3497, 2.7441, 5753.3849], [3418, 2.8289, 3.5231], [3136, 3.6277, 77713.7715],
  [2676, 4.4181, 7860.4194], [2343, 6.1352, 3930.2097], [1324, 0.7425, 11506.7698],
  [1273, 2.0371, 529.6910], [1199, 1.1096, 1577.3435], [990, 5.233, 5884.927],
  [902, 2.045, 26.298], [857, 3.508, 398.149], [780, 1.179, 5223.694],
  [753, 2.533, 5507.553], [492, 4.205, 775.523], [357, 2.920, 0.067],
  [317, 5.849, 11790.629], [284, 1.899, 796.298], [271, 0.315, 10977.079],
  [243, 0.345, 5486.778],
];
const TERM_VSOP_R0 = [
  [3084, 5.1985, 77713.7715], [1628, 1.1739, 5753.3849], [1576, 2.8469, 7860.4194],
  [925, 5.453, 11506.770], [542, 4.564, 3930.210], [472, 3.661, 5884.927],
  [346, 0.964, 5507.553], [329, 5.900, 5223.694], [307, 0.299, 5573.143],
];
const ARCSEC_RAD = Math.PI / (180 * 3600);

/* ΔT = TT − UT, in seconds, for the sky and horoscope positions
   (sunApparentLongitudeDeg): a quadratic through the IERS-observed values
   for 2000/2010/2020 (63.83 / 66.07 / 69.36 s), nearly level since. It is
   pinned by the horoscope regression tests and differs from
   civilDeltaTSeconds by under 0.4 s in 2000–2030. Calendar instants
   (solar terms, new moons) use civilDeltaTSeconds instead. */
function deltaTSeconds(yearFloat) {
  if (yearFloat <= 2020) {
    const u = (yearFloat - 2010) / 10;
    return 66.07 + 2.76 * u + 0.53 * u * u;
  }
  return 69.36 + 0.03 * (yearFloat - 2020);
}

/* TT − UTC (civil time), in seconds: what turns an ephemeris instant (TT)
   into the clock time on which calendar days are decided. Civil time is
   UTC (Beijing time = UTC+8, GB/T 33661-2017), so:
   · from 1972 it is exactly 32.184 s + TAI−UTC (the leap-second table,
     IERS Bulletin C; 69.184 s since 2017-01-01). No leap second has been
     added since, and the 27th CGPM (2022, Resolution 4) decided to stop
     them by 2035, so 69.184 s is held for the future: future civil time
     is UTC as it now runs, the convention JPL Horizons also uses.
   · before 1972 UTC followed UT, so it is ΔT = TT − UT: observed values
     every five years 1900–1970 (Espenak & Meeus, "Polynomial expressions
     for Delta T", NASA 2006), interpolated linearly, joined to 1972.
   Earth's rotation (UT1) will drift from that UTC by a minute or two by
   2100; that drift matters for sunrise, not for which civil day holds a
   new moon or a solar term. Used for the solar terms and the lunar
   calendar's new moons (js/lunar.js); see docs/almanac-rules.md §1a. */
const DELTA_T_TABLE = [
  -2.79, 3.86, 10.46, 17.20, 21.16, 23.62, 24.02, 23.93, 24.33, 26.77, // 1900 … 1945
  29.07, 31.07, 33.15, 35.73, 40.18,                                   // 1950 … 1970
];
// Decimal years at which TAI − UTC stepped to 11, 12, … 37 s (10 s on 1972-01-01).
const LEAP_SECOND_YEARS = [
  1972.5, 1973, 1974, 1975, 1976, 1977, 1978, 1979, 1980, 1981.5, 1982.5, 1983.5, 1985.5,
  1988, 1990, 1991, 1992.5, 1993.5, 1994.5, 1996, 1997.5, 1999, 2006, 2009, 2012.5, 2015.5, 2017,
];
function civilDeltaTSeconds(yearFloat) {
  if (yearFloat >= 1972) {
    let leap = 10;
    for (const y of LEAP_SECOND_YEARS) if (yearFloat >= y) leap++;
    return 32.184 + leap;
  }
  if (yearFloat >= 1970) return 40.18 + (42.184 - 40.18) * (yearFloat - 1970) / 2;
  if (yearFloat <= 1900) return DELTA_T_TABLE[0];
  const x = (yearFloat - 1900) / 5, i = Math.floor(x);
  return DELTA_T_TABLE[i] + (DELTA_T_TABLE[i + 1] - DELTA_T_TABLE[i]) * (x - i);
}

/* Apparent ecliptic longitude of the Sun (degrees, 0..360) at a UTC
   instant (a JS Date). Includes aberration and nutation in longitude. */
function sunApparentLongitudeDeg(date) {
  const jdUT = date.valueOf() / DAY_MS + 2440587.5;
  return sunApparentLongitudeTT(jdUT + deltaTSeconds(1970 + (jdUT - 2440587.5) / 365.25) / 86400);
}
/* The same at a civil (UTC) instant, with the calendar's TT − UTC. */
function sunCivilLongitudeDeg(date) {
  const jdUT = date.valueOf() / DAY_MS + 2440587.5;
  return sunApparentLongitudeTT(jdUT + civilDeltaTSeconds(1970 + (jdUT - 2440587.5) / 365.25) / 86400);
}
/* …and at a Julian Ephemeris Day (TT). */
function sunApparentLongitudeTT(jdTT) {
  const T = (jdTT - 2451545) / 36525; // Julian centuries of TT from J2000
  const tau = T / 10;                 // Julian millennia
  const L0 = 280.46646 + T * (36000.76983 + 0.0003032 * T);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
    + 0.000289 * Math.sin(3 * Mr);
  const nu = Mr + C * RAD; // true anomaly
  let R = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu));
  let lon = (L0 + C) * RAD;
  for (const t of TERM_VSOP_L0) lon += t[0] * 1e-8 * Math.cos(t[1] + t[2] * tau);
  for (const t of TERM_VSOP_R0) R += t[0] * 1e-8 * Math.cos(t[1] + t[2] * tau);
  lon -= 20.4898 * ARCSEC_RAD / R; // aberration
  // Nutation in longitude: the four largest terms (arcsec).
  const Om = (125.04452 - 1934.136261 * T) * RAD;
  const Ls = (280.4665 + 36000.7698 * T) * RAD;
  const Lm = (218.3165 + 481267.8813 * T) * RAD;
  lon += (-17.20 * Math.sin(Om) - 1.32 * Math.sin(2 * Ls)
    - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * Om)) * ARCSEC_RAD;
  const deg = lon / RAD % 360;
  return deg < 0 ? deg + 360 : deg;
}

function angDiffDeg(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/* The UTC instant at which the apparent longitude crosses angleDeg,
   Newton-solved from a guess within a couple of days of the truth.
   Converges to well under a second of time. */
function solveSolarTermInstant(angleDeg, guessMs) {
  let t = guessMs;
  for (let i = 0; i < 40; i++) {
    const f = angDiffDeg(sunCivilLongitudeDeg(new Date(t)), angleDeg);
    if (Math.abs(f) < 1e-9) break;
    const h = 60000;
    const d = angDiffDeg(sunCivilLongitudeDeg(new Date(t + h)), sunCivilLongitudeDeg(new Date(t - h))) / (2 * h);
    if (!(d > 0)) break;
    const step = f / d;
    t -= step;
    if (Math.abs(step) < 50) break;
  }
  return new Date(t);
}

/* [angle, rough day-of-year] for the 24 crossings of a year, in calendar
   order from 小寒. Solved once per year and cached — a page left open
   only re-solves when it rolls into a year it has not seen. */
const TERM_YEAR_GUESS = [
  [285, 5], [300, 20], [315, 35], [330, 49], [345, 64], [0, 79], [15, 94],
  [30, 110], [45, 125], [60, 141], [75, 156], [90, 172], [105, 188],
  [120, 204], [135, 219], [150, 235], [165, 250], [180, 266], [195, 281],
  [210, 296], [225, 311], [240, 326], [255, 341], [270, 356],
];
const termYearCache = new Map();
function solarTermInstantsForYear(year) {
  let list = termYearCache.get(year);
  if (list) return list;
  const jan1 = Date.UTC(year, 0, 1);
  list = TERM_YEAR_GUESS.map(([angle, doy]) => ({
    idx: (angle / 15) % 24, // index into SOLAR_TERMS / SOLAR_TERMS_EN
    angle,
    instant: solveSolarTermInstant(angle, jan1 + doy * DAY_MS),
  }));
  termYearCache.set(year, list);
  return list;
}

/* All crossings of the UTC years y−1 … y+1 around `date`, in time
   order (a window wide enough for any "last term before / first term
   after" question about a day). Shared by solarTermInfo and the
   almanac's 节月 helper so both read the very same instants. */
function solarTermsAround(date) {
  const y = date.getUTCFullYear();
  return [
    ...solarTermInstantsForYear(y - 1),
    ...solarTermInstantsForYear(y),
    ...solarTermInstantsForYear(y + 1),
  ].sort((a, b) => a.instant - b.instant);
}

/* [dayStart, dayEnd) of the LOCAL civil day containing `date`. Every
   calendar decision in the almanac is made on this half-open interval:
   a crossing belongs to day D when D's local midnight ≤ instant < the
   next local midnight. */
function localDayBounds(date) {
  return {
    dayStart: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    dayEnd: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
  };
}

/* The term picture for the LOCAL day containing `date`:
   today   — the crossing whose local calendar date is that day, else null;
   next    — the first crossing on/after the next local midnight;
   current — the term in force on that day: today when a crossing
             falls on it, else the last crossing before it.
   Entries carry { idx, angle, instant, name, nameEn }. */
function solarTermInfo(date) {
  const all = solarTermsAround(date);
  const { dayStart, dayEnd } = localDayBounds(date);
  let today = null, next = null, current = null;
  for (const t of all) {
    if (t.instant >= dayEnd) { next = t; break; }
    current = t;
    if (t.instant >= dayStart) today = t;
  }
  const named = (t) => (t ? {
    idx: t.idx, angle: t.angle, instant: t.instant,
    name: SOLAR_TERMS[t.idx], nameEn: SOLAR_TERMS_EN[t.idx],
  } : null);
  return { today: named(today), next: named(next), current: named(current) };
}

function localHM(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }

/* Published almanacs print term times rounded to the minute, so the
   card displays the rounded instant (date and HH:MM alike); the exact
   instant underneath still drives all date logic. */
function termDisplayInstant(instant) {
  return new Date(Math.round(instant.getTime() / 60000) * 60000);
}

/* ================= Almanac (zh only, computed per day) =================
   Rules, conventions and sources: docs/almanac-rules.md. In short —
   · day boundary = local civil midnight; the day ganzhi is that of the
     local calendar date;
   · 节月 (month branch): a 节 whose instant falls on local day D governs
     from D onward (the whole day), decided on the same instants and the
     same local-day interval as the card's 「今日交节」;
   · the card's 「X年」 is the lunar year (changes at 正月初一); the
     立春-based year is exposed separately for the month pillar;
   · 黄道黑道值神 and the day's 吉神/凶神 follow 《协纪辨方书》's rules
     (js/almanac-rules.js), and so do 宜忌, which are synthesised from the
     建除, the 神煞 and a few fixed special days (NAM_ALMANAC.yiJi). Nothing
     in the almanac is random. */
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

/* 节月 — the month of the 干支 calendar, which turns at each of the
   twelve 节 (立春 寅, 惊蛰 卯, 清明 辰, 立夏 巳, 芒种 午, 小暑 未,
   立秋 申, 白露 酉, 寒露 戌, 立冬 亥, 大雪 子, 小寒 丑); the twelve 中气
   in between do not move it. A 节 sits at an apparent solar longitude
   ≡ 15° (mod 30°); 立春 is 315°. The governing 节 of a local day is the
   last 节 whose instant is before that day's END, i.e. a 节 crossing at
   any time on day D already governs all of D — the convention of
   printed almanacs, and the same rule solarTermInfo uses for `current`.
   Returns
     branchIdx — month branch as an index into ZHI (0 子 … 11 亥);
     branch    — that branch, e.g. "寅";
     monthIdx  — 0 for 寅月 (the first 节月, from 立春) … 11 for 丑月;
     jieYear   — the 立春-based year number: the Gregorian year of the
                 立春 that opened the current 节年 (Jan before 立春 →
                 previous year);
     termIdx / termName / instant — the governing 节 itself;
     today     — true when that 节 crosses on this local day (交节日). */
function jieMonthInfo(date) {
  const { dayStart, dayEnd } = localDayBounds(date);
  let gov = null;
  for (const t of solarTermsAround(date)) {
    if (t.instant >= dayEnd) break;
    if (t.angle % 30 === 15) gov = t;
  }
  const monthIdx = ((gov.angle - 315 + 360) % 360) / 30; // 立春 → 0
  // 小寒 (丑月, early January) is the only 节 that opens a month of the
  // previous 节年; every other 节 shares its instant's Gregorian year.
  const jieYear = gov.instant.getUTCFullYear() - (monthIdx === 11 ? 1 : 0);
  return {
    branchIdx: (monthIdx + 2) % 12,
    branch: ZHI[(monthIdx + 2) % 12],
    monthIdx,
    jieYear,
    termIdx: gov.idx,
    termName: SOLAR_TERMS[gov.idx],
    instant: gov.instant,
    today: gov.instant >= dayStart,
  };
}

/* Year ganzhi of the 立春-based year (the year pillar of 八字 and the
   year a 节月 belongs to). Not shown on the card, which names the lunar
   year; exposed for the month pillar. */
function lichunYearGanzhi(date) {
  return ganzhiFromIndex(jieMonthInfo(date).jieYear - 4);
}

/* Month ganzhi by 五虎遁 (甲己之年丙作首, 乙庚之岁戊为头, 丙辛必定寻庚起,
   丁壬壬位顺行流, 戊癸何方发, 甲寅之上好追求): the 寅月 stem is fixed
   by the 立春-year stem, and stems then advance one per 节月. Shown on
   the card's meta line (「丙午年 己亥月」). */
function jieMonthGanzhi(date) {
  const jm = jieMonthInfo(date);
  const yearStem = ((jm.jieYear - 4) % 10 + 10) % 10;
  const stem = ((yearStem % 5) * 2 + 2 + jm.monthIdx) % 10;
  return GAN[stem] + jm.branch;
}

/* The lunar calendar (农历) — computed by js/lunar.js from Meeus new
   moons and this file's solar terms (中气) under the GB/T 33661-2017
   rules, never from Intl's "chinese" calendar (ICU starts 丁未 2027 a day
   late and differs between browsers). A local date D gets the lunar date
   of civil date D in Beijing time. lunarDate(date) → { year (the
   Gregorian year in which that lunar year began), month, day, leap,
   monthDays, yearGanzhi, label 「十月十八」 }. */
const LUNAR = NAM_LUNAR.create({ deltaTSeconds: civilDeltaTSeconds, termsOfYear: solarTermInstantsForYear });
function lunarDate(date) { return LUNAR.fromDate(date); }

/* Lunar-year ganzhi: the year that changes at 正月初一, as printed on
   almanacs (「乙巳年」 until the 2026 Spring Festival on Feb 17). */
function yearGanzhi(date) {
  return lunarDate(date).yearGanzhi;
}

/* 十二建除: the officer of a day is fixed by the distance from the 节月
   branch to the day branch — 建 when they are equal, then 除 满 平 定 执
   破 危 成 收 开 闭 (《淮南子·天文训》; 《协纪辨方书·义例·建除十二神》).
   Because the month branch advances on the 交节 day while the day branch
   advances every day, the officer repeats on each 交节 day. */
function jianchuOf(dayBranchIdx, monthBranchIdx) {
  return JIANCHU[((dayBranchIdx - monthBranchIdx) % 12 + 12) % 12];
}

/* 煞方 of a day by its branch's 三合 group: 申子辰煞南, 巳酉丑煞东,
   寅午戌煞北, 亥卯未煞西 — the 三煞 (劫煞·灾煞·岁煞) directions that
   《协纪辨方书》 gives by year branch, applied by day branch the way
   通书/printed almanacs print 「冲X煞Y」. It is the direction opposite
   the group's own 三合 element (申子辰 water ↔ south fire, etc.), NOT
   the direction of the clashing branch. The 三合 groups are exactly
   the branches with equal index mod 4 (子辰申 0, 丑巳酉 1, 寅午戌 2,
   卯未亥 3). */
const SHA_BY_TRINE = ["南", "东", "北", "西"];
function shaDirectionOf(dayBranchIdx) {
  return SHA_BY_TRINE[dayBranchIdx % 4];
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
/* 十二建除 in order, index 0 = 建 (day branch == month branch). */
const JIANCHU = ["建", "除", "满", "平", "定", "执", "破", "危", "成", "收", "开", "闭"];
/* Solar terms by 15° step of the Sun's apparent ecliptic longitude, index 0 = 0° (春分). */
const SOLAR_TERMS = ["春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰"];
/* 土王用事: the eighteen local days before each 四立 (立春 立夏 立秋 立冬),
   i.e. from the 四立 day minus 18 up to the day before it — the 季月's
   earth period of 《协纪辨方书》 (四立前十八日). Read on the same term
   instants and local days as 节月. */
const SI_LI_ANGLES = [315, 45, 135, 225];
function tuWangYongShi(date) {
  const { dayStart } = localDayBounds(date);
  const next = solarTermsAround(date).find((t) => t.instant >= dayStart && SI_LI_ANGLES.includes(t.angle));
  if (!next) return false;
  const i = next.instant;
  const liDay = new Date(i.getFullYear(), i.getMonth(), i.getDate());
  return dayStart >= new Date(liDay.getFullYear(), liDay.getMonth(), liDay.getDate() - 18) && dayStart < liDay;
}

/* The Moon's phase (朔 上弦 望 下弦) of the day, or "": the phase whose
   instant falls on the Beijing civil date that the lunar calendar maps
   to this local date (see lunarDate), so 朔日 is always 初一 and the
   phases never disagree with the lunar date shown beside them. */
function moonPhaseOn(date) {
  const dn = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const p = LUNAR.phasesBetween(dn - 8 * 3600000, dn + 16 * 3600000);
  return p.length ? p[0].name : "";
}

/* The day context the 择日 rules read (see js/almanac-rules.js): 节月
   index/branch and its season, the day stem/branch, the term crossing on
   the next local day (四离/四绝), whether 土王用事 is in force, and — for
   宜忌 — the term in force (霜降后…) and the term crossing today (二分二至);
   since M5 also the lunar day and month length (月忌 晦日 十五日 人神), the
   Moon's phase of the day (朔弦望, on the lunar calendar's Beijing date) and
   the 立春-year stem (上朔). */
function almanacRuleContext(date, gz, jm) {
  const tomorrow = solarTermInfo(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12)).today;
  const ti = solarTermInfo(date);
  const lunar = lunarDate(date);
  return {
    ld: lunar.day,
    monthDays: lunar.monthDays,
    phase: moonPhaseOn(date),
    ys: ((jm.jieYear - 4) % 10 + 10) % 10,
    m: jm.monthIdx,
    mb: jm.branchIdx,
    season: Math.floor(jm.monthIdx / 3),
    s: GAN.indexOf(gz[0]),
    b: ZHI.indexOf(gz[1]),
    gz,
    eve: tomorrow ? tomorrow.name : "",
    tuWang: tuWangYongShi(date),
    qi: ti.current ? ti.current.name : "",
    termToday: ti.today ? ti.today.name : "",
  };
}

function currentSolarTerm(date) {
  return SOLAR_TERMS[Math.floor(sunApparentLongitudeDeg(date) / 15) % 24];
}

function computeAlmanac(date) {
  const lunar = lunarDate(date);
  const gz = dayGanzhi(date);
  const stem = gz[0], branch = gz[1];
  const branchIdx = ZHI.indexOf(branch);
  // 十二建除 from the 节月 branch (not the lunar month): see jieMonthInfo.
  const jm = jieMonthInfo(date);
  const jianchu = jianchuOf(branchIdx, jm.branchIdx);
  const chong = ZHI_ANIMAL[(branchIdx + 6) % 12];
  const sha = shaDirectionOf(branchIdx);
  // 黄道黑道值神 and the day's 神煞: js/almanac-rules.js (NAM_ALMANAC).
  const zhiShen = NAM_ALMANAC.zhiShenOf(branchIdx, jm.branchIdx);
  const ctx = almanacRuleContext(date, gz, jm);
  const gods = NAM_ALMANAC.dayGods(ctx);
  // 宜忌 from the 建除, the gods and the special days (卷十「宜忌」): see NAM_ALMANAC.yiJi.
  const yiji = NAM_ALMANAC.yiJi(ctx, gods);
  return {
    lunarLabel: lunar.label,            // 「十月十八」
    lunar,                              // { year, month, day, leap, monthDays, yearGanzhi, label }
    yearGanzhi: lunar.yearGanzhi,       // lunar year, turns at 正月初一 (shown)
    lichunYearGanzhi: ganzhiFromIndex(jm.jieYear - 4), // 立春-based (not shown)
    monthGanzhi: jieMonthGanzhi(date),  // 节月 pillar, 五虎遁 (shown in the meta line)
    jieMonth: { branchIdx: jm.branchIdx, branch: jm.branch, monthIdx: jm.monthIdx, jieYear: jm.jieYear, termName: jm.termName },
    dayGanzhi: gz,
    yi: yiji.yi,                        // 用事 names, vocabulary (traditional) order
    ji: yiji.ji,
    yiJi: yiji,                         // + level (宜忌等第), allJi (诸事皆忌), trace
    termInfo: solarTermInfo(date),
    jianchu,
    chong,
    sha,
    chongSha: `冲${chong}煞${sha}`,
    pengzu: [PENGZU_BY_STEM[stem], PENGZU_BY_BRANCH[branch]],
    zhiShen,                            // { name, huangdao } — 黄道黑道十二值神
    // 纳音 of the three pillars shown (lunar year, 节月, day) and the day's 吉神方位.
    nayin: { year: NAM_ALMANAC.nayinOf(lunar.yearGanzhi), month: NAM_ALMANAC.nayinOf(jieMonthGanzhi(date)), day: NAM_ALMANAC.nayinOf(gz) },
    directions: NAM_ALMANAC.godDirections(GAN.indexOf(stem)),
    jiShen: gods.ji,                    // [{ name, gloss }], fixed rule order
    xiongShen: gods.xiong,
  };
}

/* How many 宜 / 忌 the card shows before 「等N事」 (two lines at 375px). */
const ALMANAC_CARD_YIJI = 8;
const YONGSHI_GLOSS = Object.fromEntries(NAM_ALMANAC.YONGSHI.map((y) => [y.name, y.gloss]));

/* The almanac's reading door (全文). The card already shows the pillars,
   建除, 值神, 冲煞, the first 宜/忌, three directions and the god names;
   the reading adds only what the card cannot hold, each thing once:
   · 宜/忌 in full, grouped by the gods that decided them
     （「月德·四相：祭祀 祈福 …」）, the resolution note on its group;
   · each god's gloss where that god first decides something; gods that
     decide nothing in our 用事 are glossed once in 「其余神煞」;
   · a 用事 gloss only where the name is not plain modern Chinese;
   · the 等第 only when a graded 凶煞 or 诸事皆忌 decided the day;
   · the five 吉神方位 and the three 纳音.
   almanacFullDoc is the single source; HTML and plain text render it. */
const ALMANAC_FOOT = "以节气定月；福神取「甲己正北」一说。释义为本站白话概括。宜忌属传统择日民俗，不具科学预测效力。";
const YONGSHI_PLAIN = new Set(NAM_ALMANAC.YONGSHI.filter((y) => y.plain).map((y) => y.name));

/* Rows of the 宜忌 trace → groups sharing the same sources and note, in
   the order their first 用事 appears (the book's 用事 order). */
function almanacGroups(rows, side, withWhy = true, levelName = "") {
  const groups = [], byKey = new Map();
  for (const t of rows) {
    const sources = side === "ji" ? t.ji : t.yi;
    // A note that only restates the day's 等第 (「从忌不从宜」) is the strip's.
    const why = withWhy && t.why && t.why !== levelName ? t.why : "";
    const key = sources.join("·") + "|" + why;
    let g = byKey.get(key);
    if (!g) { g = { sources, why, glosses: [], items: [] }; byKey.set(key, g); groups.push(g); }
    g.items.push({ name: t.name, gloss: YONGSHI_PLAIN.has(t.name) ? "" : YONGSHI_GLOSS[t.name] || "" });
  }
  return groups;
}

function almanacFullDoc(a) {
  const yj = a.yiJi;
  const rows = (result) => yj.trace.filter((t) => t.result === result);
  const levelName = yj.level ? yj.level.name : "";
  const yi = yj.allJi ? [] : almanacGroups(rows("宜"), "yi", true, levelName);
  const ji = yj.allJi ? [] : almanacGroups(rows("忌"), "ji", true, levelName);
  const quietRows = yj.allJi ? yj.trace.filter((t) => t.yi.length) : rows("不注").filter((t) => t.yi.length);
  // Each god's gloss goes on the first visible group it decides.
  const godGloss = new Map([...a.jiShen, ...a.xiongShen].map((g) => [g.name, g.gloss]));
  const glossed = new Set();
  for (const g of [...yi, ...ji]) {
    for (const s of g.sources) {
      if (godGloss.has(s) && !glossed.has(s)) { glossed.add(s); g.glosses.push({ name: s, gloss: godGloss.get(s) }); }
    }
  }
  const rest = (list) => list.filter((g) => !glossed.has(g.name));
  const count = (groups) => groups.reduce((n, g) => n + g.items.length, 0);
  return {
    kicker: [a.lunarLabel ? `农历${a.lunarLabel}` : "", `${a.dayGanzhi}日`].filter(Boolean).join(" · "),
    level: yj.allJi
      ? { strong: true, name: "诸事皆忌", note: "宜神所宜，本日皆不用" + (yj.level && yj.level.by.length ? `（${yj.level.by.join("、")}）` : "") }
      : yj.level ? { strong: false, name: yj.level.name, note: yj.level.by.join("、") } : null,
    allJi: !!yj.allJi,
    yi: { count: count(yi), groups: yi },
    ji: { count: count(ji), groups: ji },
    quiet: {
      title: yj.allJi ? "本有之宜" : "未注之事",
      note: yj.allJi ? "以下各事本有宜神，因诸事皆忌，均不注宜。" : "以下各事本有宜神，按本日等第不注宜忌。",
      count: quietRows.length,
      // On a 诸事皆忌 day every row's note is that verdict — the banner says it once.
      groups: almanacGroups(quietRows, "yi", !yj.allJi, levelName),
    },
    directions: a.directions,
    nayin: [["年", a.yearGanzhi, a.nayin.year], ["月", a.monthGanzhi, a.nayin.month], ["日", a.dayGanzhi, a.nayin.day]]
      .map(([label, gz, value]) => ({ label, gz, value })),
    otherGods: { title: glossed.size ? "其余神煞" : "神煞", ji: rest(a.jiShen), xiong: rest(a.xiongShen) },
    footnote: ALMANAC_FOOT,
  };
}

/* Plain text of the reading (the door's presence check, copy, tests). */
function almanacFullDocText(doc) {
  const groupLines = (groups) => groups.flatMap((g) => [
    `${g.sources.join("·")}${g.why ? `（${g.why}）` : ""}：${g.items.map((i) => i.name + (i.gloss ? `（${i.gloss}）` : "")).join(" ")}`,
    ...g.glosses.map((x) => `  ${x.name}：${x.gloss}`),
  ]);
  const parts = [[doc.kicker, ...(doc.level ? [`等第：${doc.level.name}（${doc.level.note}）`] : [])].join("\n")];
  if (doc.allJi) parts.push("宜：诸事不宜\n忌：诸事皆忌");
  else {
    parts.push([`宜（${doc.yi.count}）` + (doc.yi.count ? "" : "：诸事不宜"), ...groupLines(doc.yi.groups)].join("\n"));
    parts.push([`忌（${doc.ji.count}）` + (doc.ji.count ? "" : "：诸事不忌"), ...groupLines(doc.ji.groups)].join("\n"));
  }
  if (doc.quiet.count) parts.push([`${doc.quiet.title}（${doc.quiet.count}）`, ...groupLines(doc.quiet.groups)].join("\n"));
  parts.push("吉神方位 " + doc.directions.map((d) => `${d.name}${d.dir}`).join(" · ") + "\n" +
    "纳音 " + doc.nayin.map((n) => `${n.label} ${n.value}`).join(" · "));
  const og = doc.otherGods;
  if (og.ji.length || og.xiong.length) {
    parts.push([og.title, ...[...og.ji, ...og.xiong].map((g) => `${g.name}：${g.gloss}`)].join("\n"));
  }
  parts.push(doc.footnote);
  return parts.join("\n\n");
}

function almanacReadingHtml(doc) {
  const sec = (id, title, body, extra = "") =>
    `<section class="hr-section${extra}" aria-labelledby="al-${id}-title"><h3 class="hr-section-title" id="al-${id}-title">${title}</h3>${body}</section>`;
  const count = (n) => `<span class="al-count">${n}</span>`;
  // Group head: each deciding god, with its gloss the first time it
  // decides something, then the resolution note on its own line.
  const groupsHtml = (groups, side) => groups.map((g) => {
    const gloss = new Map(g.glosses.map((x) => [x.name, x.gloss]));
    return `<div class="al-group al-group--${side}">` +
      `<p class="al-src">${g.sources.map((n) =>
        `<span class="al-god"><b>${esc(n)}</b>${gloss.has(n) ? `<span>${esc(gloss.get(n))}</span>` : ""}</span>`).join("")}</p>` +
      (g.why ? `<p class="al-why">${esc(g.why)}</p>` : "") +
      `<ul class="al-items">${g.items.map((i) =>
        `<li><span class="al-item">${esc(i.name)}</span>${i.gloss ? `<span class="al-gloss">${esc(i.gloss)}</span>` : ""}</li>`).join("")}</ul>` +
    `</div>`;
  }).join("");
  const kicker = `<p class="al-kicker">${esc(doc.kicker)}</p>`;
  const level = doc.level
    ? `<p class="al-level${doc.level.strong ? " al-level--strong" : ""}"><b>${esc(doc.level.name)}</b><span>${esc(doc.level.note)}</span></p>`
    : "";
  const yiji = doc.allJi
    ? `<div class="al-allji"><p><span class="al-side al-side--yi">宜</span>诸事不宜</p><p><span class="al-side al-side--ji">忌</span>诸事皆忌</p></div>`
    : sec("yi", `宜 ${count(doc.yi.count)}`, doc.yi.count ? groupsHtml(doc.yi.groups, "yi") : `<p class="hr-note">诸事不宜</p>`, " al-sec--yi") +
      sec("ji", `忌 ${count(doc.ji.count)}`, doc.ji.count ? groupsHtml(doc.ji.groups, "ji") : `<p class="hr-note">诸事不忌</p>`, " al-sec--ji");
  const quiet = doc.quiet.count
    ? `<details class="al-quiet"><summary>${esc(doc.quiet.title)} ${count(doc.quiet.count)}</summary>` +
      `<p class="hr-note">${esc(doc.quiet.note)}</p>${groupsHtml(doc.quiet.groups, "quiet")}</details>`
    : "";
  const dl = (cls, items) => `<dl class="al-grid ${cls}">${items.map(([k, v, sub]) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd>${sub ? `<dd class="al-grid-sub">${esc(sub)}</dd>` : ""}</div>`).join("")}</dl>`;
  const dirs = sec("dirs", "吉神方位", dl("al-grid--dirs", doc.directions.map((d) => [d.name, d.dir])));
  const nayin = sec("nayin", "纳音", dl("al-grid--nayin", doc.nayin.map((n) => [n.label, n.value, n.gz])));
  const og = doc.otherGods;
  const godItems = (list, side) => list.map((g) => `<li class="al-side--${side}"><b>${esc(g.name)}</b>${esc(g.gloss)}</li>`).join("");
  const others = og.ji.length || og.xiong.length
    ? sec("gods", og.title, `<ul class="al-gods">${godItems(og.ji, "yi")}${godItems(og.xiong, "ji")}</ul>`)
    : "";
  const foot = `<footer class="hr-foot"><p>${esc(doc.footnote)}</p></footer>`;
  return kicker + level + yiji + quiet + dirs + nayin + others + foot;
}

function almanacFullText(a) { return almanacFullDocText(almanacFullDoc(a)); }

/* ================= Astrology: see js/astro.js ================= */

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

/* Lunar (month, day, leap) of the local date — the almanac's own lunar
   calendar (lunarDate, js/lunar.js). */
function lunarParts(date) {
  const l = lunarDate(date);
  return { month: l.month, day: l.day, leap: l.leap };
}
function sunLongitudeDeg(date) {
  return sunApparentLongitudeDeg(date);
}
function seasonOf(date) {
  const deg = sunLongitudeDeg(date);
  if (deg >= 315 || deg < 45) return "spring";
  if (deg < 135) return "summer";
  if (deg < 225) return "autumn";
  return "winter";
}
/* A solar-term day is the local calendar day on which a crossing
   instant falls — the precise instant decides, so the same crossing is
   冬至 on Dec 22 in Shanghai (04:50 local) and on Dec 21 in New York
   (15:50 local). */
function solarTermDay(date) {
  const t = solarTermInfo(date).today;
  return t ? t.name : null;
}
function lunarFestivalOn(date) {
  const lp = lunarParts(date);
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
    if (tm.month === 1 && tm.day === 1 && !tm.leap) return FESTIVALS.chuxi;
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
const MYDAY_EFFECTS = ["dress", "petals", "meteors", "snow", "confetti"];
let myDays = loadMyDays();
function loadMyDays() {
  try {
    const s = JSON.parse(appStorage.getItem(LS_MYDAYS) || "null");
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
    appStorage.setItem(LS_MYDAYS, JSON.stringify({ v: 1, days: myDays }));
  } catch (e) { /* storage unavailable: days live in memory only */ }
}
function matchPersonalDay(date) {
  let lp = null;
  for (const d of myDays) {
    if (d.cal === "solar") {
      if (date.getMonth() + 1 === d.month && date.getDate() === d.day) return d;
    } else {
      if (!lp) lp = lunarParts(date);
      if (!lp.leap && lp.month === d.month && lp.day === d.day) return d;
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
  const termInfo = solarTermInfo(date);
  const termDay = termInfo.today ? termInfo.today.name : null;
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
    // 清明 and 冬至 arrive via a term crossing: name its exact moment.
    if ((festival.key === "qingming" || festival.key === "dongzhi") && termInfo.today) {
      const hm = localHM(termDisplayInstant(termInfo.today.instant));
      note = { zh: `${note.zh} · 交节于 ${hm}`, en: `${note.en} · begins ${hm}` };
    }
    dress = festival.dress;
    anim = festival.anim;
  } else if (termDay) {
    const hm = localHM(termDisplayInstant(termInfo.today.instant));
    note = {
      zh: `今日${termDay} · 交节于 ${hm}`,
      en: `${SOLAR_TERMS_EN[SOLAR_TERMS.indexOf(termDay)]} today · begins ${hm}`,
    };
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
   (snow / petals / leaves / confetti) share one drift system parameterized by
   size, speed and paint; meteors are lone streaks on a slow timer. */
const LS_FX = "nam-effects";
let fxEnabled = appStorage.getItem(LS_FX) !== "off";
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
  confetti: { count: 26, vyMin: 8, vyMax: 18, sizeMin: 4.5, sizeMax: 8.0 },
};
/* Birthday-confetti palette: festive, but in the site's own register —
   vermillion and gold first, then teal, plum, apricot and a muted
   indigo. No neon. Stored as "r, g, b" so the per-piece alpha rides
   along at paint time. */
const CONFETTI_COLORS = ["198, 58, 40", "206, 152, 52", "43, 122, 112", "126, 70, 108", "230, 144, 84", "82, 98, 152"];
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
    // Confetti pieces carry a color and a private flutter tempo, and
    // swing and spin harder than petals do; other modes ignore these.
    ...(mode === "confetti" ? {
      col: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      fl: 2.0 + Math.random() * 2.6,
      sway: 14 + Math.random() * 20,
      vr: (Math.random() - 0.5) * 1.6,
      a: 0.55 + Math.random() * 0.35,
    } : {}),
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
    } else if (fxMode === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // Fake the 3D tumble of a paper scrap: it flips edge-on and back
      // (vertical squash through zero) while its width breathes a
      // little out of phase, so no two pieces turn alike.
      const flip = Math.cos(ts * 0.001 * p.fl + p.ph * 2.3);
      ctx.scale(0.7 + 0.3 * Math.sin(ts * 0.001 * p.fl * 0.9 + p.ph), flip);
      ctx.fillStyle = `rgba(${p.col}, ${p.a.toFixed(3)})`;
      ctx.fillRect(-p.s * 0.8, -p.s * 0.45, p.s * 1.6, p.s * 0.9);
      ctx.restore();
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
  try { appStorage.setItem(LS_FX, on ? "on" : "off"); } catch (e) { /* ignore */ }
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

/* ---------- My days: modal UI ---------- */
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
  const empty = $("mydays-empty");
  if (empty) empty.hidden = myDays.length > 0;
  wrap.innerHTML = "";
  myDays.forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "my-day-item";
    const label = document.createElement("span");
    label.textContent = `${d.name} · ${md.when(d.cal, d.month, d.day)} · ${md.fx[d.effect]}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "my-day-del";
    del.textContent = md.deleteLabel;
    del.dataset.idx = String(idx);
    row.appendChild(label);
    row.appendChild(del);
    wrap.appendChild(row);
  });
}

/* The modal mirrors the note modal's manners: opening closes the
   settings panel first; Esc, the backdrop and the close button all
   dismiss it. Focus returns to the gear on close — the row that
   opened it sits inside the now-closed panel. */
let myDaysOpener = null;
function openMyDaysModal(opener) {
  if (ambientOn || activeModal) return; // no overlapping dialogs or ambient editing
  setSettingsOpen(false);
  myDaysOpener = opener || null;
  renderMyDaysList();
  showModal("mydays-overlay");
  $("myday-name").focus();
}
function closeMyDaysModal() {
  if ($("mydays-overlay").hidden) return;
  hideModal("mydays-overlay");
  if (myDaysOpener && myDaysOpener.isConnected && !settingsPanel.hidden) myDaysOpener.focus({ preventScroll: true });
  else settingsBtn.focus({ preventScroll: true });
  myDaysOpener = null;
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
  $("mydays-open").addEventListener("click", () => openMyDaysModal($("mydays-open")));
  $("mydays-close").addEventListener("click", closeMyDaysModal);
  $("mydays-overlay").addEventListener("click", (e) => {
    if (e.target === $("mydays-overlay")) closeMyDaysModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("mydays-overlay").hidden) closeMyDaysModal();
  });
}

/* ================= Special-date postcards （特殊日明信片） =================
   On a day that means something — a solar term, a lunar festival, a day
   the world keeps — the site gifts the visitor one fixed composition: a
   painting full-bleed across the top of the card, and below it a strip
   of cream paper carrying a few lines. The geometry is pure proportion,
   anchored on the painting's native square: paper height = paper width
   × 4/3, the photo takes the first full width of height, and the text
   zone is the deterministic remainder (a third of the width) with fixed
   slots (title row with the meta at its right / a subtitle line / a
   passage of at most three lines / a slim footer row). The stage
   renders it with container-query units so the composition is identical
   at any width; the keepsake draws the same numbers at 1080×1440. Copy
   lives in
   POSTCARD_COPY (data.js) and is written to fit the passage slot —
   length discipline is part of the design.

   Delivery: the postcard is the FIRST card of its day, once per device
   (a per-date appStorage key, nam-postcard-<yyyymmdd>); afterwards it
   joins the day's rotation with a modest chance, never back-to-back.
   Outside ambient mode the first card is its envelope, and the receipt
   is written when the visitor opens the picture (deliverPostcardGift);
   an unopened postcard is offered again on every later draw that day.
   One postcard per day at most — collisions resolve festival first,
   then western days, then bare solar terms （清明 the festival beats
   清明 the term, so the term painting qingming.webp is kept in the data
   but the festival card is the one that ever appears). Personal days
   （我的日子） are not postcards and are untouched by this module. */

/* Painting slug per SOLAR_TERMS index (SOLAR_TERMS[0] = 春分 at 0°). */
const TERM_SLUG_BY_IDX = [
  "chunfen", "qingming", "guyu", "lixia", "xiaoman", "mangzhong",
  "xiazhi", "xiaoshu", "dashu", "liqiu", "chushu", "bailu",
  "qiufen", "hanlu", "shuangjiang", "lidong", "xiaoxue", "daxue",
  "dongzhi", "xiaohan", "dahan", "lichun", "yushui", "jingzhe",
];

/* Day-of-month of the n-th `weekday` (0 = Sunday) of a month. */
function nthWeekdayOfMonth(year, monthIdx, weekday, n) {
  const first = new Date(year, monthIdx, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
/* Western (Gregorian) Easter Sunday via the anonymous computus. */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}
function lunarLabelOf(date) {
  return lunarDate(date).label;
}

/* Which postcard (if any) belongs to the LOCAL day containing `date`.
   Pure function of the date — returns { key, termIdx, instantMs,
   lunarLabel } or null. Priority: lunar/fixed festival > western day >
   solar term. */
function postcardForDate(date) {
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
  const lp = lunarParts(date);
  // Tier 1a: lunar festivals.
  if (!lp.leap) {
    const lunarKey =
      (lp.month === 1 && lp.day === 1) ? "chunjie" :
      (lp.month === 1 && lp.day === 15) ? "yuanxiao" :
      (lp.month === 12 && lp.day === 8) ? "laba" :
      (lp.month === 5 && lp.day === 5) ? "duanwu" :
      (lp.month === 7 && lp.day === 7) ? "qixi" :
      (lp.month === 8 && lp.day === 15) ? "zhongqiu" :
      (lp.month === 9 && lp.day === 9) ? "chongyang" : null;
    if (lunarKey) return { key: lunarKey, termIdx: null, instantMs: null, lunarLabel: lunarLabelOf(date) };
  }
  if (lp.month === 12) {
    // 除夕： the last day of the lunar year — tomorrow is 正月初一.
    const tm = lunarParts(new Date(y, date.getMonth(), d + 1));
    if (tm.month === 1 && tm.day === 1 && !tm.leap) {
      return { key: "chuxi", termIdx: null, instantMs: null, lunarLabel: lunarLabelOf(date) };
    }
  }
  const ti = solarTermInfo(date);
  // Tier 1b: 清明 the festival (on the term day) beats 清明 the term.
  if (ti.today && ti.today.name === "清明") {
    return { key: "qingming-festival", termIdx: ti.today.idx, instantMs: ti.today.instant.getTime(), lunarLabel: null };
  }
  // Tier 1c: fixed festival — New Year's Day.
  if (mo === 1 && d === 1) return { key: "newyear", termIdx: null, instantMs: null, lunarLabel: null };
  // Tier 2: western days (fixed + rule-based).
  if (mo === 2 && d === 14) return { key: "valentines", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 3 && d === 17) return { key: "stpatricks", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 4 && d === 1) return { key: "aprilfools", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 4 && d === 22) return { key: "earthday", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 10 && d === 31) return { key: "halloween", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 12 && d === 25) return { key: "christmas", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 12 && d === 31) return { key: "newyearseve", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 5 && d === nthWeekdayOfMonth(y, 4, 0, 2)) return { key: "mothers", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 6 && d === nthWeekdayOfMonth(y, 5, 0, 3)) return { key: "fathers", termIdx: null, instantMs: null, lunarLabel: null };
  if (mo === 11 && d === nthWeekdayOfMonth(y, 10, 4, 4)) return { key: "thanksgiving", termIdx: null, instantMs: null, lunarLabel: null };
  const es = easterSunday(y);
  if (mo === es.month && d === es.day) return { key: "easter", termIdx: null, instantMs: null, lunarLabel: null };
  // Tier 3: a bare solar-term day.
  if (ti.today) {
    return { key: TERM_SLUG_BY_IDX[ti.today.idx], termIdx: ti.today.idx, instantMs: ti.today.instant.getTime(), lunarLabel: null };
  }
  return null;
}

function postcardDayKey(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/* Today's postcard as a renderable selection, resolved once per local
   day (the solar-term solver is not re-run on every draw). */
let postcardCache = { stamp: "", sel: null };
function todaysPostcardSelection(now, stamp) {
  if (postcardCache.stamp !== stamp) {
    const found = postcardForDate(now);
    postcardCache = {
      stamp,
      sel: found ? Object.assign({ cat: "postcard" }, found) : null,
    };
  }
  return postcardCache.sel;
}
let postcardGiftStamp = "";
function postcardGifted(stamp) {
  if (postcardGiftStamp === stamp) return true;
  try { return !!appStorage.getItem("nam-postcard-" + stamp); }
  catch (e) { return false; }
}
function markPostcardGifted(stamp) {
  postcardGiftStamp = stamp;
  try { appStorage.setItem("nam-postcard-" + postcardGiftStamp, "1"); }
  catch (e) { /* Still delivered for this page session. */ }
}

/* ---------- Picture cards （图卡） ----------
   Two categories are pictures rather than text: the special-date
   postcard and the night sky (chart / illustration / moon). Outside
   ambient mode they no longer render straight onto the stage: the
   stage shows an envelope that names the picture, and the picture
   itself opens in a modal (see the picture-modal section below).
   In ambient mode they still render directly — nobody is there to
   tap an envelope on a desk screen. */
function isPictureCard(sel) {
  return !!sel && (sel.cat === "postcard" || sel.cat === "sky");
}
/* True when this selection will sit on the stage as an envelope:
   a picture card, outside ambient mode. */
function stageShowsEnvelope(sel) {
  return isPictureCard(sel) && !ambientOn;
}
/* A gifted postcard is delivered when its picture is OPENED, not when
   its envelope is rendered: opening the modal is the moment the gift
   is received. Until then nextSelection keeps offering it first, so
   an unopened envelope can never be lost to the rotation. Pool
   re-entries (not gifted) carry no receipt and ignore this. */
function deliverPostcardGift(sel) {
  if (!sel || sel.cat !== "postcard" || !sel.gifted || !sel.giftStamp) return false;
  if (postcardGifted(sel.giftStamp)) return false;
  markPostcardGifted(sel.giftStamp);
  return true;
}

/* The meta line inside the composition, as segments so the term's exact
   time can wear the vermillion accent: { pre, time|null, post }. */
function postcardMetaParts(sel) {
  const now = new Date();
  if (lang === "zh") {
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`;
    if (sel.instantMs != null) {
      const hm = localHM(termDisplayInstant(new Date(sel.instantMs)));
      return { pre: `${dateStr} · `, time: hm, post: " 交节" };
    }
    if (sel.lunarLabel) return { pre: `农历${sel.lunarLabel} · ${dateStr}`, time: null, post: "" };
    return { pre: dateStr, time: null, post: "" };
  }
  const dateStr = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(now);
  if (sel.instantMs != null) {
    const hm = localHM(termDisplayInstant(new Date(sel.instantMs)));
    return { pre: `${dateStr} · begins `, time: hm, post: "" };
  }
  return { pre: dateStr, time: null, post: "" };
}
function postcardMetaText(sel) {
  const p = postcardMetaParts(sel);
  return p.pre + (p.time || "") + p.post;
}

/* ================= Gift notice （赠送提示） =================
   The gift moment gets one quiet announcement: a slim pill under the
   brand row that names the day and the gesture （今日大雪 · 送你一张明信
   片 / "Daxue today · a postcard for you"). A dated note delivered on
   its day (see the notes module below) borrows the same pill with its
   own line （你给今天的自己留了一句话）. It belongs to the gift only —
   never to pool re-entries, never to ordinary days — and it is page
   chrome, not part of the card, so it never enters a keepsake. It
   dismisses itself after ~10 s, when the stage card changes away from
   the gift, or when the visitor closes it; closing it never touches
   the card. In ambient mode it does not appear at all: the card still
   gifts, silently. */
const GIFT_NOTICE_MS = 10000;
let giftNoticeSel = null;     // selection the visible notice belongs to
let giftNoticeTimer = null;
let giftNoticeHideTimer = null;

function giftNoticeText(sel) {
  // A delivered note has its own line; the postcard names its day.
  if (sel.cat === "mine") return t().notes.giftNotice;
  const copy = POSTCARD_COPY[sel.key];
  if (!copy) return "";
  // A no-break space keeps the "·" with the words before it when the
  // pill wraps onto two lines on a phone.
  if (lang === "zh") return `今日${copy.titleZh}\u00a0· 送你一张明信片`;
  // English titles for the terms read "Daxue · Heavy Snow": the name
  // alone carries the sentence ("Daxue today · a postcard for you").
  const nameEn = copy.titleEn.split(" · ")[0];
  return `${nameEn} today\u00a0· a postcard for you`;
}

function showGiftNotice(sel) {
  if (ambientOn) return; // ambient hides all chrome: gift stays silent
  const bar = $("gift-notice");
  if (!bar) return;
  if (sel.cat === "postcard" && !POSTCARD_COPY[sel.key]) return;
  if (sel.cat !== "postcard" && sel.cat !== "mine") return;
  giftNoticeSel = sel;
  $("gift-notice-text").textContent = giftNoticeText(sel);
  $("gift-notice-close").setAttribute("aria-label", t().captureClose);
  clearTimeout(giftNoticeHideTimer);
  bar.hidden = false;
  void bar.offsetWidth; // let the entrance transition run from the hidden state
  bar.classList.add("show");
  clearTimeout(giftNoticeTimer);
  giftNoticeTimer = setTimeout(dismissGiftNotice, GIFT_NOTICE_MS);
}

function dismissGiftNotice() {
  clearTimeout(giftNoticeTimer);
  giftNoticeTimer = null;
  giftNoticeSel = null;
  const bar = $("gift-notice");
  if (!bar || bar.hidden) return;
  bar.classList.remove("show");
  clearTimeout(giftNoticeHideTimer);
  giftNoticeHideTimer = setTimeout(() => {
    if (!bar.classList.contains("show")) bar.hidden = true;
  }, 500);
}

$("gift-notice-close").addEventListener("click", (e) => {
  e.stopPropagation();
  dismissGiftNotice();
});

/* ================= Notes （写一句） — the visitor's own words =================
   The one pool the visitor writes themselves: a reflection （心得） or a
   memo （备忘）, at most 120 characters, kept in IndexedDB on this
   device only (database `nam-notes`, store `notes`) — never uploaded,
   never in appStorage. Entries join the weighted draw as the "mine"
   pool (weight 6) whenever the library is non-empty, drawn through a
   shuffle-bag keyed by entry id so nothing repeats until every entry
   has surfaced once.

   An entry may carry a date. On that date it is DELIVERED — 必达 —
   through the same gift machinery as the postcard: first card of the
   day, gift-notice pill, once per device per date (appStorage key
   nam-note-<yyyymmdd>). Priority between the day's two gifts: the
   visitor's own dated words outrank the postcard — the note goes
   first, and an ungifted postcard is then guaranteed as the very next
   draw. Only the earliest-created of several same-day notes is
   gift-delivered; the rest simply stay in that day's rotation.
   Delivery is not consumption: a delivered note remains in the library
   and in the random rotation afterwards.

   Entry points: a small floating button in the bottom-right corner,
   hidden by default — on desktop it fades in only while the pointer is
   in the corner hotspot or on the button itself; on touch it appears
   for ~5 s after an upward swipe that starts in the bottom ~30% of the
   viewport; keyboard focus also reveals it. Ambient mode suppresses it
   entirely. The library itself lives on its own page (library.html,
   linked from the settings panel); its "写一句" button lands back
   here with #write, which opens this modal on load. */
const NOTE_MAX_CHARS = 120;
const NOTES_DB_NAME = "nam-notes";
let notesList = [];        // all entries, createdAt ascending (stable pool order)
let notesDbPromise = null; // Promise<IDBDatabase|null>
let notesDbFailed = false; // IndexedDB unusable (private mode etc.)

/* ---------- IndexedDB wrapper ---------- */
function notesOpenDb() {
  if (notesDbPromise) return notesDbPromise;
  notesDbPromise = new Promise((resolve) => {
    let req;
    try {
      if (!("indexedDB" in window) || !window.indexedDB) throw new Error("no idb");
      req = indexedDB.open(NOTES_DB_NAME, 1);
    } catch (e) {
      notesDbFailed = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { notesDbFailed = true; resolve(null); };
    req.onblocked = () => { notesDbFailed = true; resolve(null); };
  });
  return notesDbPromise;
}
function validNote(n) {
  return !!n && Number.isSafeInteger(n.id) && n.id > 0 &&
    (n.type === "reflection" || n.type === "memo") &&
    typeof n.text === "string" && n.text.trim() && Number.isFinite(n.createdAt);
}
const NOTES_REVISION_KEY = "nam-notes-revision";
let loadedNotesRevision = null;
let notesLoaded = false;
let notesLoadSequence = 0;
let notesLoading = null;

function notesLoadAll() {
  const revision = appStorage.getItem(NOTES_REVISION_KEY);
  if (notesLoading && notesLoading.revision === revision) return notesLoading.task;
  const sequence = ++notesLoadSequence;
  const task = (async () => {
    const db = await notesOpenDb();
    if (!db) return;
    await new Promise(resolve => {
      try {
        const rq = db.transaction("notes", "readonly").objectStore("notes").getAll();
        rq.onsuccess = () => {
          if (sequence === notesLoadSequence && revision === appStorage.getItem(NOTES_REVISION_KEY)) {
            const rows = (rq.result || []).filter(validNote);
            rows.sort((a, b) => (a.createdAt - b.createdAt) || (a.id - b.id));
            notesList = rows;
            loadedNotesRevision = revision;
            notesLoaded = true;
          }
          resolve();
        };
        rq.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  })().finally(() => {
    if (notesLoading && notesLoading.sequence === sequence) notesLoading = null;
  });
  notesLoading = { revision, sequence, task };
  return task;
}

function notesCurrent() {
  if (notesLoaded && loadedNotesRevision === appStorage.getItem(NOTES_REVISION_KEY)) return true;
  // Do not draw from a known-stale snapshot while a refresh is pending.
  if (!notesDbFailed) notesLoadAll();
  return false;
}

function signalNotesChanged() {
  appStorage.setItem(NOTES_REVISION_KEY, Date.now() + ":" + Math.random());
}
async function notesAdd(entry) {
  const db = await notesOpenDb();
  if (!db) return null;
  return NAM_DEDUP.runShared(sharedLocks, () => new Promise(resolve => {
    try {
      const tx = db.transaction("notes", "readwrite");
      const rq = tx.objectStore("notes").add(entry);
      let id = null;
      rq.onsuccess = () => { id = rq.result; };
      tx.oncomplete = () => {
        if (id !== null) signalNotesChanged();
        resolve(id);
      };
      tx.onabort = () => resolve(null);
    } catch (e) { resolve(null); }
  }));
}

/* ---------- Dates ---------- */
/* Local YYYY-MM-DD for a Date — the same shape <input type="date">
   produces, so stored dates compare as plain strings. */
function noteDayStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function noteDateParts(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}
/* 记于 M月d日 / Written on Mon D — the year joins only when it is not
   the current one, so an old note never masquerades as a recent one. */
function noteWrittenOn(createdAt) {
  const d = new Date(createdAt);
  const withYear = d.getFullYear() !== new Date().getFullYear();
  if (lang === "zh") {
    return `记于 ${withYear ? d.getFullYear() + "年" : ""}${d.getMonth() + 1}月${d.getDate()}日`;
  }
  const base = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  return `Written on ${base}${withYear ? ", " + d.getFullYear() : ""}`;
}
/* 留给 M月d日 / For Mon D — the day a dated note is addressed to. */
function noteForDate(str) {
  const p = noteDateParts(str);
  if (!p) return "";
  if (lang === "zh") return `留给 ${p.mo}月${p.d}日`;
  const base = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
    .format(new Date(p.y, p.mo - 1, p.d));
  return `For ${base}`;
}

/* Notes share the stable-ID deck implementation. */
function drawNoteEntry() {
  if (!notesList.length) return null;
  const ids = notesList.map(n => "note:" + n.id);
  return notesList[deckState.draw("mine", ids)] || null;
}

/* ---------- Dated delivery （必达） ---------- */
function noteGiftKey(stamp) { return "nam-note-" + stamp; }
let deliveredNoteKey = "";
function noteDeliveredToday(stamp) {
  const key = noteGiftKey(stamp);
  if (deliveredNoteKey === key) return true;
  try { return !!appStorage.getItem(key); }
  catch (e) { return false; }
}
function markNoteDelivered(id, stamp) {
  deliveredNoteKey = noteGiftKey(stamp);
  try { appStorage.setItem(deliveredNoteKey, String(id)); }
  catch (e) { /* Still delivered for this page session. */ }
}
/* Today's dated note as a gift selection — the earliest-created entry
   addressed to today, and only until the day's one delivery has
   happened (the key above is the record). */
function todaysDatedNoteSelection(now, stamp) {
  if (!notesCurrent() || !notesList.length || noteDeliveredToday(stamp)) return null;
  const today = noteDayStr(now);
  const due = notesList.find((n) => n.date === today);
  return due ? { cat: "mine", note: due, gifted: true, giftStamp: stamp } : null;
}
/* ---------- Source context ---------- */
/* The short label of the card currently on stage, captured when the
   modal opens and attached to a reflection: a poem's title, a city's
   name, a quote's author… falling back to the category's name. */
function currentCardLabel() {
  const sel = currentSelection;
  if (!sel) return null;
  const zh = lang === "zh";
  switch (sel.cat) {
    case "poem": {
      const p = zh ? sel.poemZh : sel.poemEn;
      return p && p.title ? p.title : null;
    }
    case "world":
      return sel.city ? (zh ? sel.city.zh : sel.city.en) : null;
    case "sky":
      return sel.form === "moon" ? t().world.moonTitle : t().categories.sky;
    case "history":
      return sel.entry ? String(sel.entry.year) : null;
    case "quotes": {
      const q = zh ? sel.quoteZh : sel.quoteEn;
      return q && q.author ? q.author : null;
    }
    case "classics":
      return sel.item && sel.item.source ? sel.item.source : null;
    case "word":
      return sel.item && sel.item.word ? sel.item.word : null;
    case "postcard": {
      const c = POSTCARD_COPY[sel.key];
      return c ? (zh ? c.titleZh : c.titleEn) : null;
    }
    case "astro": {
      if (sel.subtype === "horoscope" && sel.horo) {
        const sg = SIGNS[sel.horo.signIdx];
        return sg ? (zh ? sg.zh : sg.en) : null;
      }
      if (sel.subtype === "profile") {
        const sg = SIGNS[sel.signIdx];
        return sg ? (zh ? sg.zh : sg.en) : null;
      }
      return t().categories.astro;
    }
    case "gossip":
      return sel.item && sel.item.source ? sel.item.source : null;
    case "mine":
      return t().categories.mine;
    default:
      return t().categories[sel.cat] || null;
  }
}
/* Book-title marks are added by the renderers, never stored: a label
   that already carries them (a classics source like 《荀子·劝学》) is
   stripped at capture time, and the renderers below refuse to wrap a
   source that still carries them (entries stored before this rule). */
function stripBookMarks(s) {
  return typeof s === "string" ? s.replace(/[《》]/g, "") : s;
}
function noteSourceLine(source) {
  if (!source) return "";
  if (lang !== "zh") return `Written while reading ${source}`;
  return source.includes("《") && source.includes("》")
    ? `读${source}时记`
    : `读《${source}》时记`;
}

/* ---------- The modal ---------- */
let noteType = "reflection";
let noteSourceCandidate = null; // stage card's label, captured at open
let noteOpener = null;          // element to refocus on close

function syncNoteTypeSeg() {
  $("note-type-reflection").classList.toggle("active", noteType === "reflection");
  $("note-type-memo").classList.toggle("active", noteType === "memo");
}
function updateNoteCount() {
  const len = [...$("note-text").value].length;
  $("note-count-num").textContent = String(len);
  $("note-save").disabled = len === 0;
}
function openNoteModal(opener) {
  if (ambientOn || activeModal) return; // no overlapping dialogs or ambient editing
  setSettingsOpen(false);
  noteOpener = opener || null;
  noteType = "reflection";
  noteSourceCandidate = stripBookMarks(currentCardLabel());
  syncNoteTypeSeg();
  $("note-text").value = "";
  $("note-date").value = "";
  $("note-date").min = noteDayStr(new Date());
  $("note-error").hidden = true;
  updateNoteCount();
  hideFabNow();
  showModal("note-overlay");
  $("note-text").focus();
}
function closeNoteModal() {
  if ($("note-overlay").hidden) return;
  hideModal("note-overlay");
  if (noteOpener && noteOpener.isConnected) noteOpener.focus({ preventScroll: true });
  noteOpener = null;
}
$("note-type-reflection").addEventListener("click", () => { noteType = "reflection"; syncNoteTypeSeg(); });
$("note-type-memo").addEventListener("click", () => { noteType = "memo"; syncNoteTypeSeg(); });
$("note-text").addEventListener("input", () => {
  const el = $("note-text");
  const chars = [...el.value];
  if (chars.length > NOTE_MAX_CHARS) el.value = chars.slice(0, NOTE_MAX_CHARS).join("");
  updateNoteCount();
});
$("note-cancel").addEventListener("click", closeNoteModal);
$("note-overlay").addEventListener("click", (e) => {
  if (e.target === $("note-overlay")) closeNoteModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("note-overlay").hidden) closeNoteModal();
});

/* ---------- Full-text reading modal ---------- */
/* The complete text behind a card — a classics passage, a full tale.
   Pure reading: opening or closing consumes no draw, touches no deck
   state, and never auto-opens — only the card's quiet 全文 door leads
   here. Any pool whose items carry a full text gets the door; the
   modal header names the current category. */
let fullOpener = null; // element to refocus on close

/* The full text to read for an item, in the UI language when the pool
   carries both (bilingual pools store the English retelling in fullEn;
   zh-only pools like classics simply have full). */
function fullTextOf(item) {
  if (!item) return "";
  if (lang === "en" && typeof item.fullEn === "string" && item.fullEn) return item.fullEn;
  return typeof item.full === "string" ? item.full : "";
}

/* Static pools and calculated horoscope snapshots share one reading door.
   Generate only the currently selected language; never mutate the selection. */
function fullTextItemForSelection(sel) {
  if (!sel) return null;
  if (sel.cat === "astro" && sel.subtype === "horoscope" && sel.horo) {
    const doc = horoscopeFullDoc(sel.horo, lang);
    return { full: horoscopeFullDocText(doc), horoscope: doc };
  }
  if (sel.cat === "almanac" && sel.data) {
    const doc = almanacFullDoc(sel.data);
    return { full: almanacFullDocText(doc), almanac: doc, source: "《钦定协纪辨方书》" };
  }
  return sel.item;
}

/* The horoscope reading as a laid-out document: a header with the overall
   rating, four area tiles that jump to their sections, then sky events,
   the four areas (suggestion first, its evidence beneath) and the shared
   sky readings. Every sentence comes from horoscopeFullDoc(), the same
   fields the plain full text joins. */
const horoStarsHtml = (n) =>
  `<span class="hr-stars" role="img" aria-label="${n}/5">${"★".repeat(n)}<span class="hr-stars-off">${"☆".repeat(5 - n)}</span></span>`;
// "Label：rest" / "Label: rest" -> a quiet run-in label and the sentence.
function horoLabelledHtml(text) {
  const m = /^([^：:。.]{2,48}?)(：|: )([\s\S]+)$/.exec(text);
  return m ? `<span class="hr-label">${esc(m[1])}</span>${esc(m[3])}` : esc(text);
}
const horoSigned = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
function horoTagsHtml(evidence, aspect) {
  const tags = evidence.split(" · ").concat(aspect ? [aspect] : []);
  return `<ul class="hr-tags">${tags.map((tag) => `<li>${esc(tag)}</li>`).join("")}</ul>`;
}
function horoContributionHtml(d, doc, scale) {
  const c = d.contribution;
  if (!c) return d.contributionText ? `<p class="hr-why-line">${esc(d.contributionText).replace(/\n/g, "<br>")}</p>` : "";
  const L = doc.labels;
  const fmt = horoSigned;
  const rows = c.bodies.map((term) => {
    const width = scale > 0 ? Math.min(50, (Math.abs(term.value) / scale) * 50) : 0;
    const side = term.value >= 0 ? "pos" : "neg";
    return `<li class="hr-bar-row"><span class="hr-bar-name">${esc(doc.bodyNames[term.key])}</span>` +
      `<span class="hr-bar-track" aria-hidden="true"><span class="hr-bar hr-bar--${side}" style="width:${width.toFixed(2)}%"></span></span>` +
      `<span class="hr-bar-value">${fmt(term.value)}</span></li>`;
  }).join("");
  const factors = c.factors.map((f, i) =>
    `<li><span>${esc(doc.factorNames[i])}</span> <b>${fmt(f.value)}</b></li>`).join("");
  return `<div class="hr-contrib">` +
    `<div class="hr-contrib-head"><span class="hr-label">${esc(L.contributions)}</span>` +
    `<span class="hr-contrib-total">${esc(L.total)} <b>${fmt(c.total)}</b></span></div>` +
    `<ul class="hr-bars">${rows}</ul>` +
    `<div class="hr-factors"><span class="hr-label">${esc(L.factors)}</span><ul>${factors}</ul></div>` +
    (d.timeUnits ? `<div class="hr-factors"><p>${horoLabelledHtml(d.timeUnits)}</p></div>` : "") + `</div>`;
}
function horoscopeReadingHtml(doc) {
  const L = doc.labels;
  // One scale for all four areas, so bar lengths compare across sections.
  const scale = Math.max(0, ...doc.domains.flatMap((d) => d.contribution ? d.contribution.bodies.map((t) => Math.abs(t.value)) : []));
  const head = `<header class="hr-head"><div class="hr-sign">` +
    `<span class="hr-symbol" aria-hidden="true">${esc(doc.sign.symbol)}\uFE0E</span>` +
    `<div><div class="hr-kicker">${esc(doc.dailyLabel)}</div><h2 class="hr-name">${esc(doc.sign.name)}</h2></div></div>` +
    `<div class="hr-overall"><span class="hr-kicker">${esc(doc.overallLabel)}</span>${horoStarsHtml(doc.stars)}</div></header>`;
  const tiles = `<nav class="hr-tiles" aria-label="${esc(L.domains)}">` + doc.domains.map((d) =>
    `<button type="button" class="hr-tile" data-jump="hr-area-${d.key}"><span class="hr-tile-name">${esc(d.label)}</span>${horoStarsHtml(d.stars)}</button>`).join("") + `</nav>`;
  const intro = `<p class="hr-intro">${esc(doc.intro)}</p>`;
  // V3.3 time scales: the first summary line becomes the section title and
  // three totals; the representative and day-over-day lines follow.
  const scaleLines = doc.timeSummary ? doc.timeSummary.split("\n") : [];
  const scales = doc.timeScales && scaleLines.length ? `<section class="hr-section" aria-labelledby="hr-scales-title">` +
    `<h3 class="hr-section-title" id="hr-scales-title">${esc(scaleLines[0].split(/：|: /)[0])}</h3>` +
    `<dl class="hr-scales">${doc.timeScales.map((t) =>
      `<div><dt>${esc(t.label)}</dt><dd>${horoSigned(t.value)}</dd></div>`).join("")}</dl>` +
    (scaleLines.length > 1 ? `<div class="hr-scale-notes">${scaleLines.slice(1).map((l) => `<p>${horoLabelledHtml(l)}</p>`).join("")}</div>` : "") +
    `</section>` : "";
  const events = doc.events ? `<section class="hr-section hr-events" aria-labelledby="hr-events-title">` +
    `<h3 class="hr-section-title" id="hr-events-title">${esc(doc.events.title)}</h3>` +
    `<p class="hr-note">${esc(doc.events.note)}</p>` +
    doc.events.items.map((e) => `<article class="hr-event"><h4 class="hr-event-title">${esc(e.title)}</h4>` +
      `<p class="hr-meta">${esc(e.evidence)}</p><p>${esc(e.interpretation)}</p>` +
      `<p class="hr-advice"><span class="hr-label">${esc(doc.events.suggestionLabel.replace(/[：:]\s*$/, ""))}</span>${esc(e.suggestion)}</p></article>`).join("") +
    `</section>` : "";
  const areas = `<section class="hr-section" aria-labelledby="hr-areas-title"><h3 class="hr-section-title" id="hr-areas-title">${esc(L.domains)}</h3>` +
    doc.domains.map((d) => `<article class="hr-area" id="hr-area-${d.key}" tabindex="-1">` +
      `<div class="hr-area-head"><h4 class="hr-area-name">${esc(d.label)}</h4>${horoStarsHtml(d.stars)}</div>` +
      `<p class="hr-advice"><span class="hr-label">${esc(L.advice)}</span>${esc(d.advice)}</p>` +
      `<div class="hr-why"><p class="hr-why-line"><span class="hr-label">${esc(L.basis)}</span>` +
      `<button type="button" class="hr-ref" data-jump="hr-reading-${d.readingId}">${esc(d.readingTitle)}</button> · ${esc(d.body)}</p>` +
      `<p class="hr-why-line">${horoLabelledHtml(d.balance)}</p>` +
      horoContributionHtml(d, doc, scale) +
      (d.ruler ? `<p class="hr-why-line">${horoLabelledHtml(d.ruler)}</p>` : "") +
      `</div></article>`).join("") + `</section>`;
  const readings = `<section class="hr-section" aria-labelledby="hr-readings-title"><h3 class="hr-section-title" id="hr-readings-title">${esc(L.readings)}</h3>` +
    doc.readings.map((r) => `<article class="hr-reading" id="hr-reading-${r.id}" tabindex="-1">` +
      `<div class="hr-reading-head"><span class="hr-badge" aria-hidden="true">${r.id}</span>` +
      `<h4 class="hr-reading-title">${esc(r.title)}<span class="hr-reading-areas"> · ${esc(r.domainLabels.join(doc.lang === "zh" ? "、" : ", "))}</span></h4></div>` +
      horoTagsHtml(r.evidence, r.aspect) +
      r.paragraphs.flatMap((p) => p.split("\n")).map((p) => `<p>${horoLabelledHtml(p)}</p>`).join("") +
      `</article>`).join("") + `</section>`;
  const lucky = `<section class="hr-section" aria-labelledby="hr-lucky-title"><h3 class="hr-section-title" id="hr-lucky-title">${esc(doc.lucky.title)}</h3>` +
    `<dl class="hr-lucky">${doc.lucky.items.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${esc(i.value)}</dd></div>`).join("")}</dl></section>`;
  const foot = `<footer class="hr-foot"><p>${esc(doc.basis)}</p><p>${esc(doc.footnote)}</p></footer>`;
  return head + tiles + intro + scales + events + areas + readings + lucky + foot;
}

function openFullText(item, opener, cat) {
  if (ambientOn || activeModal) return; // no overlapping dialogs or ambient editing
  const full = fullTextOf(item);
  if (!full) return;
  fullOpener = opener || null;
  $("full-cat").textContent = t().categories[cat] || t().categories.classics;
  $("full-close").setAttribute("aria-label", lang === "zh" ? "关闭" : "Close");
  $("full-body").className = item.horoscope ? "full-body hr" : item.almanac ? "full-body hr al" : "full-body";
  $("full-body").innerHTML = item.horoscope ? horoscopeReadingHtml(item.horoscope)
    : item.almanac ? almanacReadingHtml(item.almanac) : full
    .split(/\n\n+/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
  $("full-source").textContent = item.source || "";
  showModal("full-overlay");
  document.querySelector(".full-dialog").scrollTop = 0;
  $("full-close").focus();
}
function closeFullText() {
  if ($("full-overlay").hidden) return;
  hideModal("full-overlay");
  if (fullOpener && fullOpener.isConnected) fullOpener.focus({ preventScroll: true });
  fullOpener = null;
}
$("full-text-btn").addEventListener("click", (e) => {
  e.stopPropagation(); // the card itself advances the draw on click
  const sel = currentSelection;
  if (sel) openFullText(fullTextItemForSelection(sel), e.currentTarget, sel.cat);
});
$("full-close").addEventListener("click", closeFullText);
// Area tiles and "Sky reading n" references scroll within the dialog and
// move focus there, so keyboard and screen-reader users land on it too.
$("full-body").addEventListener("click", (e) => {
  const jump = e.target.closest && e.target.closest("[data-jump]");
  const target = jump && document.getElementById(jump.dataset.jump);
  if (!target) return;
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
});
$("full-overlay").addEventListener("click", (e) => {
  if (e.target === $("full-overlay")) closeFullText();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("full-overlay").hidden) closeFullText();
});

/* ================= Picture cards: envelope & modal （图卡信封与弹窗） =================
   A picture card (postcard / sky — see isPictureCard) arrives on the
   stage as an ENVELOPE: a card that names what was received — its
   category, its own title, one line of introduction, a blurred glimpse
   of the painting for a postcard — and invites a tap. The picture
   itself renders inside the image modal, in the same composition it
   always had on the stage. Ambient mode is the exception throughout:
   there the picture renders directly on the stage and the modal
   never opens.

   Rendering takes a SURFACE — the set of elements a renderer writes
   to. The stage surface is the page's #card; the modal surface is the
   modal's own card. Renderers never look elements up globally, so the
   two surfaces can never write into each other, and no id is ever
   duplicated. */

/* The stage surface: the page's one stage card. */
function stageSurface() {
  return {
    stage: true,
    card: $("card"), cat: $("card-category"), meta: $("card-meta"),
    body: $("card-body"), foot: $("card-foot"), fullBtn: $("full-text-btn"),
  };
}
/* The picture modal's surface: its own card, head and body. Picture
   cards never carry a full text, so there is no foot door here. */
function modalSurface() {
  return {
    stage: false,
    card: $("img-card"), cat: $("img-cat"), meta: $("img-meta"),
    body: $("img-body"), foot: null, fullBtn: null,
  };
}

/* What the envelope says about a picture, in the UI language: its
   category, its specific title, one introductory line, and — for a
   postcard — the painting to glimpse blurred under the words. Sky
   titles need no scene: the chart names itself, the illustration
   names its place (the same synchronous place the card would print),
   and the moon names its phase via the site's own moonPhase(). */
function pictureInfo(sel) {
  const s = t();
  if (sel.cat === "postcard") {
    const copy = POSTCARD_COPY[sel.key];
    if (!copy) return null;
    const title = lang === "zh" ? copy.titleZh : copy.titleEn;
    const sub = lang === "zh" ? copy.subZh : copy.subEn;
    const pass = lang === "zh" ? copy.passZh : copy.passEn;
    const art = lang === "en" && copy.artEn ? copy.artEn : copy.art;
    const chars = [...(pass || "")];
    const excerpt = chars.length > 42 ? chars.slice(0, 42).join("") + "…" : pass;
    return {
      kind: "postcard", category: s.categories.postcard, title,
      intro: sub || excerpt, glimpse: excerpt, art,
      meta: postcardMetaText(sel),
    };
  }
  const K = s.sky;
  if (sel.form === "chart") {
    return { kind: "sky", category: s.categories.sky, title: K.chartMeta, intro: K.approx, art: null, meta: "" };
  }
  if (sel.form === "moon") {
    const when = sel.observer && sel.observer.when ? new Date(sel.observer.when) : new Date();
    const mp = moonPhase(when);
    return {
      kind: "sky", category: s.categories.sky, title: s.world.moonTitle,
      intro: `${s.world.phases[mp.idx]} · ${s.world.moonIllum(mp.illum)}`, art: null, meta: "",
    };
  }
  return {
    kind: "sky", category: s.categories.sky,
    title: sel.place ? skyPlaceName(sel.place) : s.categories.sky,
    intro: K.illusMeta, art: null, meta: "",
  };
}

/* The envelope itself, rendered into a surface (in practice always
   the stage; the modal never shows an envelope). No sky scene is
   painted here — the SDK canvas exists only inside the modal, so a
   picture is never rendered twice. */
function renderEnvelope(sel, surface) {
  const info = pictureInfo(sel);
  if (!info) { renderPostcard(sel, surface); return; }
  const P = t().picture;
  surface.cat.textContent = info.category;
  surface.meta.textContent = info.meta || "";
  const preview = info.art
    ? `<div class="env-preview env-preview-art"><img src="assets/special-dates/${esc(info.art)}.webp" alt="" loading="lazy" decoding="async"></div>`
    : `<div class="env-preview env-preview-sky" aria-hidden="true"></div>`;
  // Every envelope is stacked: a wide glimpse on top, then one row
  // with the words on the left and the call to view on the right.
  // The category label already says what arrived, so there is no
  // separate "received" line.
  const copy = `<span class="big env-title">${esc(info.title)}</span>` +
    (info.intro ? `<div class="sub env-intro">${esc(info.intro)}</div>` : "") +
    (info.glimpse && info.glimpse !== info.intro ? `<div class="sub env-glimpse">${esc(info.glimpse)}</div>` : "");
  surface.body.innerHTML =
    `<div class="envelope env-${info.kind}">` +
    preview +
    `<div class="env-text">` +
    `<div class="env-copy">${copy}</div>` +
    `<p class="env-cta">${esc(P.view)} <span aria-hidden="true">›</span></p>` +
    `</div></div>`;
  liveWorldTime = null;
}

/* ---------- The picture modal ---------- */
let imageOpener = null; // element to refocus on close (the stage card)

function imageModalOpen() {
  return !$("img-overlay").hidden;
}

// The same immutable PNG is used for both preview and saving.
let modalPicture = null;
function modalPictureIsCurrent(sel, gen) {
  return imageModalOpen() && imageModalSel === sel && gen === skyVisualGen &&
    $("img-card").dataset.skyGen === String(gen);
}
function clearModalPicture() {
  $("img-capture-btn").disabled = true;
  if (modalPicture) URL.revokeObjectURL(modalPicture.url);
  modalPicture = null;
}
function showModalStatus(sel, failed) {
  const surface = modalSurface();
  surface.card.dataset.skyState = failed ? "error" : "loading";
  const sky = sel.cat === "sky";
  const message = sky ? (failed ? t().sky.error : t().sky.loading) :
    (failed ? (lang === "zh" ? "图片这次没有载入。" : "The picture did not load this time.") :
      (lang === "zh" ? "正在制作图片…" : "Preparing the picture…"));
  surface.body.innerHTML = '<div class="fact-row picture-status" role="status"><span>' +
    esc(message) + '</span>' + (failed ? '<span>' +
      (sky ? skyRetryButtonHtml() : '<button type="button" class="sky-retry">' + esc(t().sky.retry) + '</button>') +
      '</span>' : '') + '</div>';
  if (failed && sky) bindSkyRetry(sel);
  if (failed && !sky) {
    const retry = surface.body.querySelector(".sky-retry");
    if (retry) retry.addEventListener("click", () => {
      if (imageModalOpen() && imageModalSel === sel) renderModalPostcard(sel);
    });
  }
}
function modalPictureDescription(sel) {
  const s = t();
  if (sel.cat === "postcard") {
    const c = POSTCARD_COPY[sel.key];
    return [lang === "zh" ? c.titleZh : c.titleEn, postcardMetaText(sel),
      lang === "zh" ? c.subZh : c.subEn, lang === "zh" ? c.passZh : c.passEn].filter(Boolean).join(" · ");
  }
  if (sel.form === "moon") {
    const m = sel.summary.moon;
    return [s.world.moonTitle, s.world.phases[m.idx], s.world.moonIllum(m.illum),
      s.world.moonAge(m.age), s.sky.approx, s.sky.moonCredit].join(" · ");
  }
  const bits = skyFactsInner(sel);
  const title = sel.form === "illustration"
    ? (sel.place ? skyPlaceName(sel.place) : s.categories.sky) + " · " + s.sky.illusMeta
    : s.sky.chartMeta;
  return [title, bits.look, bits.line, sel.form === "chart" ? s.sky.approx : ""].filter(Boolean).join(" · ");
}
async function publishModalPicture(sel, gen, canvas, description) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!modalPictureIsCurrent(sel, gen)) return false;
  if (!blob) throw new Error("PNG encoding failed");
  const url = URL.createObjectURL(blob);
  let published = false;
  try {
    const image = document.createElement("img");
    image.className = "modal-picture";
    image.alt = description;
    image.width = canvas.width;
    image.height = canvas.height;
    image.style.setProperty("--picture-ratio", String(canvas.width / canvas.height));
    if (typeof image.decode === "function") {
      image.src = url;
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
    }
    if (!modalPictureIsCurrent(sel, gen)) return false;
    const fit = document.createElement("div");
    fit.className = "img-fit";
    fit.appendChild(image);
    const name = "now-and-more-" + (sel.cat === "postcard" ? "postcard" : sel.form) +
      "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
    modalSurface().body.replaceChildren(fit);
    modalPicture = { url, blob, name };
    published = true;
    $("img-card").dataset.skyState = "ready";
    $("img-capture-btn").disabled = false;
    return true;
  } finally {
    if (!published) URL.revokeObjectURL(url);
  }
}
function downloadModalPicture(picture) {
  const a = document.createElement("a");
  a.href = picture.url;
  a.download = picture.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function saveModalPicture() {
  const picture = modalPicture;
  if (!picture || !imageModalOpen() || $("img-capture-btn").disabled) return;
  // iOS/iPadOS exposes Save Image in the native file share sheet.
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && navigator.share && navigator.canShare && typeof File === "function") {
    try {
      const file = new File([picture.blob], picture.name, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch((err) => {
          if (err.name !== "AbortError" && modalPicture === picture) downloadModalPicture(picture);
        });
        return;
      }
    } catch (e) { /* fall back to download */ }
  }
  downloadModalPicture(picture);
}
async function renderModalPostcard(sel) {
  const gen = ++skyVisualGen;
  $("img-card").dataset.skyGen = String(gen);
  clearModalPicture();
  showModalStatus(sel, false);
  try {
    const copy = POSTCARD_COPY[sel.key];
    const art = lang === "en" && copy.artEn ? copy.artEn : copy.art;
    const image = await loadPostcardImage(`assets/special-dates/${art}.webp`);
    await ensureCaptureFonts();
    if (!modalPictureIsCurrent(sel, gen)) return;
    const canvas = renderPostcardKeepsake(sel, image, capturePalette().serif);
    await publishModalPicture(sel, gen, canvas, modalPictureDescription(sel));
  } catch (e) {
    if (modalPictureIsCurrent(sel, gen)) showModalStatus(sel, true);
  }
}

/* The gift receipt is still written when the envelope is opened. */
function openImageModal(sel) {
  if (ambientOn || activeModal || !isPictureCard(sel) || imageModalOpen()) return;
  imageModalSel = sel;
  imageOpener = $("card");
  showModal("img-overlay");
  const surface = modalSurface();
  const info = pictureInfo(sel);
  surface.cat.textContent = info.category;
  surface.meta.textContent = info.title;
  $("img-capture-btn").textContent = t().captureDownload;
  $("img-close-btn").textContent = t().captureClose;
  if (sel.cat === "sky") {
    scheduleSkyVisual(sel, surface);
    armSkyModalWatchdog(sel);
  } else {
    renderModalPostcard(sel);
  }
  deliverPostcardGift(sel);
  $("img-close-btn").focus();
}

/* One-shot watchdog for the modal's sky paint. If the generation
   scheduled by this opening has not actually painted ~2.8s later —
   the live first-open blank — schedule it once more into the modal
   surface. At most one re-schedule per opening; a modal that has
   closed (or moved on to another selection) is never touched. */
function armSkyModalWatchdog(sel) {
  const scheduledGen = sel._skyGen;
  let fired = false;
  const wd = setTimeout(() => {
    if (fired) return;
    fired = true;
    if (imageModalSel !== sel || !imageModalOpen()) return;
    if (sel._skyGen !== scheduledGen || sel._paintedGen === scheduledGen ||
        $("img-card").dataset.skyState !== "loading") return;
    scheduleSkyVisual(sel, modalSurface());
  }, 2800);
  if (wd && typeof wd.unref === "function") wd.unref();
}

function closeImageModal() {
  if (!imageModalOpen()) return;
  hideModal("img-overlay");
  if (imageModalSel && imageModalSel._abort) imageModalSel._abort.abort();
  imageModalSel = null;
  clearModalPicture();
  $("img-body").replaceChildren();
  // A sky paint still in flight for the modal must not land after the
  // modal has closed: dropping the surface's generation stamp makes
  // the late job a no-op (it re-checks the stamp before painting).
  skyVisualGen++;
  delete $("img-card").dataset.skyGen;
  delete $("img-card").dataset.skyState;
  if (imageOpener && imageOpener.isConnected) imageOpener.focus({ preventScroll: true });
  imageOpener = null;
}
$("img-close-btn").addEventListener("click", closeImageModal);
$("img-overlay").addEventListener("click", (e) => {
  if (e.target === $("img-overlay") || e.target === $("img-overlay").querySelector(".img-dialog")) closeImageModal();
});
$("img-capture-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  saveModalPicture();
});
document.addEventListener("keydown", (e) => {
  // Escape dismisses the picture without saving.
  if (e.key === "Escape" && imageModalOpen() && $("capture-overlay").hidden) closeImageModal();
});
$("note-save").addEventListener("click", async () => {
  const text = $("note-text").value.trim();
  if (!text) return;
  // A past date can still be typed in some browsers despite min=:
  // it simply means "no particular day" — the note joins the random
  // rotation undated rather than scolding its writer.
  let date = $("note-date").value || null;
  if (date && !noteDateParts(date)) date = null;
  if (date && date < noteDayStr(new Date())) date = null;
  const entry = {
    type: noteType,
    text: [...text].slice(0, NOTE_MAX_CHARS).join(""),
    date,
    source: noteType === "reflection" ? noteSourceCandidate : null,
    lang,
    createdAt: Date.now(),
  };
  const id = await notesAdd(entry);
  if (id === null || id === undefined) {
    // IndexedDB refused (private mode…): say so quietly, keep the text.
    $("note-error").hidden = false;
    return;
  }
  // Reload the committed database, rather than appending to a stale snapshot.
  notesLoadAll();
  closeNoteModal();
});

/* ---------- Floating button: contextual reveal ----------
   Desktop (fine pointer): visible only while the pointer is inside
   the bottom-right ~140×140 corner, or on the button itself; it fades
   ~600 ms after the pointer leaves both. Tracked from pointer
   position (no overlay hotspot), so the corner never swallows a
   click meant for the page. Touch (coarse pointer): an upward swipe
   (≥40 px) that starts in the bottom ~30% of the viewport reveals it
   for ~5 s. The listeners are passive and never preventDefault, so
   tapping, scrolling and every existing gesture are untouched.
   Keyboard focus reveals it too. Ambient mode suppresses it fully. */
const FAB_HIDE_MS = 600;
const FAB_TOUCH_SHOW_MS = 5000;
let fabInCorner = false;
let fabHovered = false;
let fabFocused = false;
let fabStickyUntil = 0;
let fabSyncTimer = null;

function fabShouldShow() {
  if (ambientOn || activeModal) return false;
  return fabInCorner || fabHovered || fabFocused || Date.now() < fabStickyUntil;
}
function syncFab() {
  $("note-fab").classList.toggle("show", fabShouldShow());
}
function scheduleFabSync(ms) {
  clearTimeout(fabSyncTimer);
  fabSyncTimer = setTimeout(syncFab, ms);
}
function hideFabNow() {
  fabInCorner = false;
  fabStickyUntil = 0;
  clearTimeout(fabSyncTimer);
  syncFab();
}
/* Called by enterAmbient: a visible button leaves with the chrome. */
function resetFab() {
  fabInCorner = false;
  fabHovered = false;
  fabFocused = false;
  fabStickyUntil = 0;
  clearTimeout(fabSyncTimer);
  syncFab();
}
/* The mousemove stream itself is the gate: it only flows when a
   pointer is actually moving, so no media-query check is needed (and
   headless or unusual pointers that report neither fine nor coarse
   still reveal the button the way a mouse would). */
document.addEventListener("mousemove", (e) => {
  if (activeModal) return;
  const inCorner = e.clientX >= window.innerWidth - 140 && e.clientY >= window.innerHeight - 140;
  if (inCorner === fabInCorner) return;
  fabInCorner = inCorner;
  if (inCorner) { clearTimeout(fabSyncTimer); syncFab(); }
  else scheduleFabSync(FAB_HIDE_MS);
}, { passive: true });
$("note-fab").addEventListener("mouseenter", () => {
  fabHovered = true;
  clearTimeout(fabSyncTimer);
  syncFab();
});
$("note-fab").addEventListener("mouseleave", () => {
  fabHovered = false;
  scheduleFabSync(FAB_HIDE_MS);
});
$("note-fab").addEventListener("focus", () => {
  fabFocused = true;
  clearTimeout(fabSyncTimer);
  syncFab();
});
$("note-fab").addEventListener("blur", () => {
  fabFocused = false;
  scheduleFabSync(FAB_HIDE_MS);
});
let fabTouchStart = null;
document.addEventListener("touchstart", (e) => {
  if (activeModal) { fabTouchStart = null; return; }
  const tch = e.changedTouches && e.changedTouches[0];
  if (!tch) { fabTouchStart = null; return; }
  fabTouchStart = {
    y: tch.clientY,
    inBottom: tch.clientY >= window.innerHeight * 0.7,
  };
}, { passive: true });
document.addEventListener("touchend", (e) => {
  const start = fabTouchStart;
  fabTouchStart = null;
  if (activeModal || !start || !start.inBottom) return;
  const tch = e.changedTouches && e.changedTouches[0];
  if (!tch) return;
  if (tch.clientY - start.y <= -40) {
    fabStickyUntil = Date.now() + FAB_TOUCH_SHOW_MS;
    clearTimeout(fabSyncTimer);
    syncFab();
    scheduleFabSync(FAB_TOUCH_SHOW_MS);
  }
}, { passive: true });
$("note-fab").addEventListener("click", () => openNoteModal($("note-fab")));

/* ================= Card selection & rendering ================= */
/* Categories available in the current language. almanac + classics are
   zh-only; proverbs + word are en-only; gossip joins only when its feed
   has actually delivered headlines. */
function availableCategories(now = new Date()) {
  const base = lang === "zh"
    ? ["world", "poem", "history", "thought", "science", "land", "math", "art", "tales", "sky", "quotes", "classics", "almanac", "astro", "chance", "memory"]
    : ["world", "poem", "history", "thought", "science", "land", "math", "art", "tales", "sky", "quotes", "proverbs", "word", "astro", "chance", "memory"];
  const list = CATEGORY_WEIGHTS.filter((c) => base.includes(c.key) &&
    (c.key !== "history" || deckState.historyAvailable(postcardDayKey(now))));
  if (gossipCandidates().length) {
    const g = CATEGORY_WEIGHTS.find((c) => c.key === "gossip");
    if (g) list.push(g);
  }
  // The visitor's own notes join only when the library is non-empty;
  // with an empty library the pool — and its weight — simply isn't there.
  if (notesCurrent() && notesList.length) {
    const m = CATEGORY_WEIGHTS.find((c) => c.key === "mine");
    if (m) list.push(m);
  }
  return list;
}

function weightedCategory(now = new Date()) {
  return NAM_DEDUP.weightedCategory(availableCategories(now), lastCategory, Math.random);
}

/* Only consume the language actually rendered. Keep the rendered variant
   on this encounter so toggling back and forth does not consume it again. */
function selectionForLanguage(sel) {
  if (sel.cat !== "poem" && sel.cat !== "quotes") return sel;
  const zh = lang === "zh";
  const poem = sel.cat === "poem";
  const key = poem ? (zh ? "poemZh" : "poemEn") : (zh ? "quoteZh" : "quoteEn");
  if (sel[key]) return sel;
  const pool = poem ? (zh ? POEMS_ZH : POEMS_EN) : (zh ? QUOTES_ZH : QUOTES_EN);
  return { ...sel, [key]: pool[deckDraw(sel.cat + ":" + lang)] };
}

function makeSelection(cat, now = new Date()) {
  switch (cat) {
    case "world":
      return { cat, city: CITIES[deckDraw("world")] };
    case "sky": {
      // No deck: the sky is computed per draw, like the almanac.
      // Near full moon, favour the lunar portrait without changing the
      // category weights or waiting for the asynchronous SDK scene.
      const now = new Date();
      const form = chooseSkyForm(now);
      if (form === "moon") {
        // Right now, not 21:00. The zone's city (or latitude 35) only
        // orients the portrait. No geolocation prompt on this card.
        const loc = skyLocation();
        const observer = { lat: loc.lat, lon: loc.lon, tz: loc.tz, when: now, name: "" };
        const sel = { cat, form, observer, summary: null, skyError: null };
        sel.ready = NAM_SKY.sceneFor(observer);
        return sel;
      }
      if (form === "chart") {
        const observer = skyObserverFor(now, null);
        const sel = { cat, form, observer, summary: null, skyError: null };
        sel.ready = NAM_SKY.sceneFor(observer);
        return sel;
      }
      const place = illustrationPlace(now);
      const observer = skyObserverFor(now, place);
      const sel = { cat, form, place, observer, summary: null, skyError: null };
      sel.ready = NAM_SKY.sceneFor(observer);
      return sel;
    }
    case "poem":
      return selectionForLanguage({ cat });
    case "history": {
      // Recheck at selection as well as eligibility. Count the new
      // encounter in the render draft; language/ambient repaints do not
      // call makeSelection. Use the same local day as the eligibility check.
      const day = postcardDayKey(now);
      if (!deckState.recordHistory(day)) {
        const fallback = NAM_DEDUP.weightedCategory(
          availableCategories(now).filter(c => c.key !== "history"), lastCategory, Math.random);
        return makeSelection(fallback, now);
      }
      const key = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      // Today's events are date-determined: the nth history encounter of
      // the local day shows the nth event for the date, rotated by year so
      // the first card differs from one year to the next. The daily budget
      // already counts this encounter, so no extra state is stored. Once a
      // date's events are used up, the deck governs the random-day pool.
      const todays = (HISTORY[key] ? [HISTORY[key]] : []).concat(HISTORY_MORE[key] || []);
      const spent = deckState.state.historyDaily.find(item => item.day === day);
      const nth = spent ? spent.count - 1 : 0;
      if (nth < todays.length) {
        return { cat, key, entry: todays[(nth + now.getFullYear()) % todays.length], today: true };
      }
      const keys = Object.keys(HISTORY);
      let rk = keys[deckDraw("history")];
      // Today's own date was just shown as today's event; draw past it.
      if (rk === key) rk = keys[deckDraw("history")];
      return { cat, key: rk, entry: HISTORY[rk], today: false };
    }
    case "thought":
      return { cat, item: THOUGHTS[deckDraw("thought")] };
    case "science":
      return { cat, item: SCIENCE[deckDraw("science")] };
    case "land":
      return { cat, item: LAND[deckDraw("land")] };
    case "math":
      return { cat, item: MATH[deckDraw("math")] };
    case "art":
      return { cat, item: ART[deckDraw("art")] };
    case "tales":
      return { cat, item: TALES[deckDraw("tales")] };
    case "quotes":
      return selectionForLanguage({ cat });
    case "classics":
      return { cat, item: CLASSICS[deckDraw("classics")] };
    case "almanac":
      return { cat, data: computeAlmanac(new Date()) };
    case "astro": {
      const subtype = NAM_DECK_IDS["astro:sub"][deckDraw("astro:sub")];
      if (subtype === "horoscope") {
        let signIdx = -1;
        if (userSign && Math.random() < 0.7) {
          signIdx = SIGNS.findIndex((sg) => sg.key === userSign);
        }
        // The user's own sign (above) is a deliberate feature and stays
        // random-access; every other horoscope sign comes from the deck.
        if (signIdx < 0) signIdx = deckDraw("astro:horo");
        return { cat, subtype, horo: makeHoroscope(new Date(), signIdx) };
      }
      // Positions are computed from the date — one card per day by
      // construction; the subtype deck above spaces their appearances.
      if (subtype === "positions") return { cat, subtype, positions: planetPositions(new Date()) };
      return { cat, subtype, signIdx: deckDraw("astro:prof") };
    }
    case "proverbs":
      return { cat, item: PROVERBS[deckDraw("proverbs")] };
    case "word":
      return { cat, item: WORDS[deckDraw("word")] };
    case "gossip": {
      const item = drawGossipItem();
      if (item) return { cat, item, newsLang: lang };
      // A candidate may expire at the boundary between eligibility and
      // selection. Recondition the original category weights, not a fixed
      // fallback that might repeat the last category.
      const fallback = NAM_DEDUP.weightedCategory(
        availableCategories(now).filter(c => c.key !== "gossip"), lastCategory, Math.random);
      return makeSelection(fallback, now);
    }
    case "memory":
      return { cat, item: MEMORY_PROMPTS[deckDraw("memory")] };
    case "mine": {
      const entry = notesCurrent() ? drawNoteEntry() : null;
      if (entry) return { cat, note: entry };
      const fallback = NAM_DEDUP.weightedCategory(
        availableCategories(now).filter(c => c.key !== "mine"), lastCategory, Math.random);
      return makeSelection(fallback, now);
    }
    case "chance": {
      const kinds = NAM_DECK_IDS["chance:kind"];
      const kind = kinds[deckDraw("chance:kind")];
      let value = rollChanceValue(kind);
      for (let attempt = 0; attempt < 3 && deckState.state.fp.includes(chanceFingerprint(kind, value)); attempt++) {
        value = rollChanceValue(kind);
      }
      deckState.state.fp.push(chanceFingerprint(kind, value));
      if (deckState.state.fp.length > 16) deckState.state.fp = deckState.state.fp.slice(-16);
      return { cat, kind, value };
    }
    default:
      return { cat: "thought", item: THOUGHTS[deckDraw("thought")] };
  }
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderPostcard(sel, surface) {
  surface = surface || stageSurface();
  const copy = POSTCARD_COPY[sel.key];
  if (!copy) return;
  const title = lang === "zh" ? copy.titleZh : copy.titleEn;
  const subtitle = lang === "zh" ? copy.subZh : copy.subEn;
  const passage = lang === "zh" ? copy.passZh : copy.passEn;
  const art = lang === "en" && copy.artEn ? copy.artEn : copy.art;
  const mp = postcardMetaParts(sel);
  const metaHtml = esc(mp.pre) + (mp.time ? `<b>${esc(mp.time)}</b>` : "") + esc(mp.post);
  const brand = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";
  // English titles read "Daxue · Heavy Snow": the gloss after the
  // separator is set smaller (see .pc-title-gloss) so the title row
  // always leaves room for the meta at its right.
  let titleHtml = esc(title);
  if (lang === "en") {
    const cut = title.indexOf(" · ");
    if (cut > 0) titleHtml = esc(title.slice(0, cut)) + `<span class="pc-title-gloss">${esc(title.slice(cut))}</span>`;
  }
  surface.cat.textContent = t().categories.postcard;
  surface.meta.textContent = "";
  surface.body.innerHTML =
    `<div class="postcard" lang="${lang === "zh" ? "zh-CN" : "en"}">` +
    `<div class="pc-photo"><img src="assets/special-dates/${art}.webp" alt="${esc(title)}" loading="lazy" decoding="async"></div>` +
    `<div class="pc-text">` +
    `<div class="pc-head"><h3 class="pc-title">${titleHtml}</h3><p class="pc-meta">${metaHtml}</p></div>` +
    (subtitle ? `<p class="pc-sub">${esc(subtitle)}</p>` : "") +
    `<p class="pc-passage">${esc(passage)}</p>` +
    `<div class="pc-foot"><span class="pc-seal">时</span><span>${esc(brand)}</span></div>` +
    `</div></div>`;
  liveWorldTime = null;
}

/* The sky illustration is its own surface too: the canvas sits
   full-bleed at the top of the card (the .skyart composition mirrors
   .postcard — cream paper only below the painting), and the paper
   strip below carries the place the painting looks from as its
   title (Elsewhere's postcard prints its place the same way), the
   meta at its right, then tonight's highlight lines for that
   place's sky. There is no approximation note: the place's
   coordinates are exact, whether they are the visitor's own or a
   drawn city's. The painting is portrait, as Elsewhere's keepsake
   sky is on a portrait screen — its postcard sky follows the view's
   aspect (skyHeight = clamp(1200/aspect, 800, 1500)), so there it
   stands 1200×1500, taller than wide. Here it is 1080×1180: as tall
   as the 3:4 card allows once the paper below is a compact strip
   sized by the longest (English) copy. */
function renderSkyArt(sel, surface) {
  surface = surface || stageSurface();
  const K = t().sky;
  surface.cat.textContent = t().categories.sky;
  surface.meta.textContent = "";
  const placeName = sel.place ? skyPlaceName(sel.place) : t().categories.sky;
  surface.body.innerHTML =
    `<div class="skyart">` +
    `<div class="sa-photo"><canvas class="sky-canvas sky-illustration" data-form="illustration" width="1080" height="1180"></canvas></div>` +
    `<div class="sa-text">` +
    `<div class="sa-head"><h3 class="sa-title">${esc(placeName)}</h3><p class="sa-meta">${esc(K.illusMeta)}</p></div>` +
    skyArtFactsHtml(sel) +
    `</div></div>`;
  liveWorldTime = null;
  scheduleSkyVisual(sel, surface);
}

function renderSelection(sel, surface) {
  surface = surface || stageSurface();
  // On the stage, outside ambient mode, a picture card arrives as an
  // envelope instead of the picture itself (see the picture-modal
  // section). The modal surface — and the stage in ambient mode —
  // always renders the picture directly.
  const envelope = surface.stage && stageShowsEnvelope(sel);
  const skyVisual = !envelope && sel.cat === "sky" && (sel.form === "chart" || sel.form === "illustration" || sel.form === "moon");
  if (!skyVisual) {
    // Drop a sky paint that is still in flight so it cannot write into the next card.
    skyVisualGen++;
    if (currentSelection && currentSelection._abort) currentSelection._abort.abort();
    delete surface.card.dataset.skyGen;
  }
  const s = t();
  // The postcard is its own surface: the card's chrome (header,
  // translucent panel) steps aside so the cream paper IS the card.
  surface.card.classList.toggle("has-postcard", !envelope && sel.cat === "postcard");
  // The sky illustration wears the same dress (see renderSkyArt).
  surface.card.classList.toggle("has-skyart", !envelope && sel.cat === "sky" && sel.form === "illustration");
  surface.card.classList.toggle("has-envelope", envelope);
  if (surface.foot) surface.foot.hidden = true; // re-enabled below when the item carries a full text
  if (envelope) { renderEnvelope(sel, surface); return; }
  if (sel.cat === "postcard") { renderPostcard(sel, surface); return; }
  if (sel.cat === "sky" && sel.form === "illustration") { renderSkyArt(sel, surface); return; }
  let meta = "";
  let body = "";
  let worldLive = null; // { prefix, tz } when this render is a world-city card
  const now = new Date();

  if (sel.cat === "world") {
    const city = sel.city;
    const name = lang === "zh" ? city.zh : city.en;
    const st = sunTimes(now, city.lat, city.lon);
    meta = `${name} · ${s.world.localTime} ${timeInZone(now, city.tz)}`;
    worldLive = { prefix: `${name} · ${s.world.localTime} `, tz: city.tz };
    let facts;
    if (st.polar === "day") facts = `<span><b>${s.world.polarDay}</b></span>`;
    else if (st.polar === "night") facts = `<span><b>${s.world.polarNight}</b></span>`;
    else facts =
      `<span>${s.world.sunrise} <b>${hmInZone(st.sunrise, city.tz)}</b></span>` +
      `<span>${s.world.sunset} <b>${hmInZone(st.sunset, city.tz)}</b></span>` +
      `<span>${s.world.dayLength} <b>${formatDuration(st.dayMinutes)}</b></span>`;
    body = `<span class="big">${name}</span><div class="fact-row">${facts}</div>`;
  }

  if (sel.cat === "sky") {
    const K = s.sky;
    if (sel.form === "moon") {
      meta = s.world.moonTitle;
      body = `<canvas class="sky-canvas sky-moon" data-form="moon" width="720" height="720"></canvas>` +
        `<span class="big">${esc(s.sky.loading)}</span>` +
        `<div class="fact-row">${skyMoonFactsHtml(sel)}</div>` +
        `<div class="sub">${K.approx}</div><div class="sub">${esc(K.moonCredit)}</div>`;
    } else {
      meta = sel.form === "chart" ? K.chartMeta : K.illusMeta;
      const size = sel.form === "chart"
        ? 'width="880" height="880"'
        : 'width="1120" height="640"';
      body = `<canvas class="sky-canvas sky-${sel.form}" data-form="${sel.form}" ${size}></canvas>` +
        `<div class="fact-row">${skyChartFactsHtml(sel)}</div>` +
        `<div class="sub">${K.approx}</div>`;
    }
  }

  if (sel.cat === "poem") {
    const p = lang === "zh" ? sel.poemZh : sel.poemEn;
    // No meta: the title already heads the body, so repeating it in
    // the corner only doubles it.
    body = `<span class="poem-title">${p.title}</span><span class="poem-author">${p.author}</span><br>` +
      p.lines.map((ln) => `<span class="poem-line">${ln}</span>`).join("");
  }

  if (sel.cat === "history") {
    meta = sel.today ? s.history.onThisDay(sel.entry.year) : `${s.history.randomDay} · ${sel.key}`;
    body = `<span class="big">${sel.entry.year}</span><br>${lang === "zh" ? sel.entry.zh : sel.entry.en}`;
  }

  if (sel.cat === "thought" || sel.cat === "memory" || sel.cat === "science" || sel.cat === "land" || sel.cat === "math" || sel.cat === "art" || sel.cat === "tales") {
    body = lang === "zh" ? sel.item.zh : sel.item.en;
  }

  if (sel.cat === "mine") {
    // The visitor's own words, in the language they were written in —
    // only the chrome around them (eyebrow, dates) follows the UI.
    const n = sel.note;
    if (n.date) meta = noteForDate(n.date);
    const foot = [];
    const srcLine = noteSourceLine(n.source);
    if (srcLine) foot.push(`<span>${esc(srcLine)}</span>`);
    foot.push(`<span>${esc(noteWrittenOn(n.createdAt))}</span>`);
    body = `<span class="note-text">${esc(n.text)}</span>` +
      `<div class="fact-row">${foot.join("")}</div>`;
  }

  if (sel.cat === "quotes") {
    const q = lang === "zh" ? sel.quoteZh : sel.quoteEn;
    // Chinese attributions take the two-em dash (——) with no space, and
    // works already sit in 《》. English uses an em dash and a space, with
    // a book, play or film title in italics; short works such as poems
    // and essays stay inside `author` in straight single quotes, as the
    // site's English does (curly quotes fall back to full-width CJK glyphs).
    const credit = lang === "zh"
      ? `——${q.author}`
      : `— ${q.author}${q.work ? `, <i>${q.work}</i>` : ""}`;
    // A short saying is set larger, like a pull quote, so it fills the
    // card's reserved height instead of floating in it.
    const short = q.text.length <= (lang === "zh" ? 20 : 48);
    body = `<span class="poem-line${short ? " quote-short" : ""}">${q.text}</span><span class="poem-author">${credit}</span>`;
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
    // Lunar date, then the lunar year and the 节月 pillar: 「农历十月十八 · 丙午年 己亥月」.
    const pillars = `${a.yearGanzhi}年 ${a.monthGanzhi}月`;
    meta = a.lunarLabel ? `农历${a.lunarLabel} · ${pillars}` : pillars;
    // 节气： the card speaks only of its own day. On a term day it
    // names the term and the exact local time it begins; on an
    // ordinary day it names the term currently in force — never the
    // next term's future date, which read like a future day's almanac.
    const ti = a.termInfo;
    const tMain = ti.today || ti.current || ti.next;
    let termLine;
    if (ti.today) {
      termLine = `节气 <b>${tMain.name}</b> · 今日交节 <b>${localHM(termDisplayInstant(tMain.instant))}</b>`;
    } else if (ti.current) {
      termLine = `节气 <b>${tMain.name}</b>`;
    } else {
      // No term in force on record (cannot happen with the y−1…y+1
      // window, but never crash the card): fall back to the next term.
      const tDisp = termDisplayInstant(tMain.instant);
      termLine = `节气 <b>${tMain.name}</b> · ${tDisp.getMonth() + 1}月${tDisp.getDate()}日 <b>${localHM(tDisp)}</b> 交节`;
    }
    const bits = [termLine];
    // 建除十二神 — labelled 建除, not 值神 (值神 = 黄道黑道十二神).
    if (a.jianchu) bits.push(`建除 <b>${a.jianchu}</b>`);
    if (a.zhiShen) bits.push(`值神 <b>${a.zhiShen.name}</b>（${a.zhiShen.huangdao ? "黄道" : "黑道"}）`);
    bits.push(`<b>${a.chongSha}</b>`);
    // Each row holds 0–9 gods (about 3 a day): names only, in rule order, so it
    // stays within two lines at phone width. The gloss rides on the title
    // (hover) and in full on the 全文 reading.
    const godRow = (label, gods) => `<div class="fact-row alm-gods"><span><b>${label}</b> ` +
      (gods.length ? gods.map((g) => `<span title="${esc(g.gloss)}">${g.name}</span>`).join(" ") : "无") +
      `</span></div>`;
    // 宜 / 忌: rule-derived (NAM_ALMANAC.yiJi), in the book's order of 用事;
    // the first ALMANAC_CARD_YIJI fit two lines at phone width, the rest
    // (and where each came from) are in the 全文 reading.
    const yjRow = (label, list, empty) => {
      const shown = list.slice(0, ALMANAC_CARD_YIJI);
      const more = list.length > shown.length ? ` <span class="alm-more">等${list.length}事</span>` : "";
      return `<div class="fact-row alm-gods"><span><b>${label}</b> ` +
        (list.length ? shown.map((n) => `<span title="${esc(YONGSHI_GLOSS[n] || "")}">${n}</span>`).join(" ") + more : empty) +
        `</span></div>`;
    };
    const allJi = a.yiJi && a.yiJi.allJi;
    // 喜神 财神 福神 fit one short line at phone width; the 贵神 are in 全文.
    const dirs = a.directions.slice(0, 3).map((d) => `${d.name}<b>${d.dir}</b>`).join(" ");
    body = `<span class="big">${a.dayGanzhi}日<span class="alm-nayin" title="日纳音">${a.nayin.day}</span></span>` +
      `<div class="fact-row">${bits.map((b) => `<span>${b}</span>`).join("")}</div>` +
      `<div class="fact-row"><span>${dirs}</span></div>` +
      yjRow(alm.yi, a.yi, "诸事不宜") +
      (allJi ? `<div class="fact-row alm-gods"><span><b>${alm.ji}</b> 诸事皆忌</span></div>` : yjRow(alm.ji, a.ji, "诸事不忌")) +
      godRow("吉神", a.jiShen) +
      godRow("凶神", a.xiongShen) +
      `<div class="fact-row"><span><b>彭祖百忌</b> ${a.pengzu[0]}；${a.pengzu[1]}</span></div>` +
      `<div class="sub">${alm.footnote}</div>`;
  }

  if (sel.cat === "astro") {
    const A = s.astro;
    const signName = (sg) => (lang === "zh" ? sg.zh : sg.en);
    if (sel.subtype === "horoscope") {
      const h = sel.horo;
      const sg = SIGNS[h.signIdx];
      const copy = horoscopeCopy(h, lang);
      const color = LUCKY_COLORS[h.colorIdx];
      const dir = LUCKY_DIRECTIONS[h.dirIdx];
      const item = LUCKY_ITEMS[h.itemIdx];
      meta = `${A.daily} · ${sg.symbol} ${signName(sg)}`;
      body = `<span class="big">${sg.symbol} ${signName(sg)}</span>` +
        `<div class="fact-row"><span>${A.overall} <b class="astro-stars">${"★".repeat(h.stars)}${"☆".repeat(5 - h.stars)}</b></span></div>` +
        `<div class="fact-row">${h.domains.map(d => `<span>${HORO_DOMAINS.find(x => x.key === d.key)[lang]} <b class="astro-stars" aria-label="${d.stars}/5">${"★".repeat(d.stars)}${"☆".repeat(5 - d.stars)}</b></span>`).join("")}</div>` +
        `<span class="poem-line">${copy.topic} · ${copy.advice}</span>` +
        (copy.eventSummary ? `<div class="sub astro-event">${esc(copy.eventSummary)}</div>` : "") +
        `<div class="sub">${copy.cues}</div>` +
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

  // A note's eyebrow is its kind （心得 / 备忘）, not the pool's name.
  surface.cat.textContent = sel.cat === "mine"
    ? s.notes.types[sel.note.type]
    : s.categories[sel.cat];
  surface.meta.textContent = meta;
  surface.body.innerHTML = body;

  // Static full passages and generated horoscope explanations get the same
  // quiet reading door, outside the body so keepsakes stay faithful to
  // the compact stage card.
  if (surface.foot && surface.fullBtn && ((sel.cat === "astro" && sel.subtype === "horoscope" && sel.horo) || fullTextOf(fullTextItemForSelection(sel)))) {
    surface.fullBtn.textContent = `${s.fullText} ›`;
    surface.foot.hidden = false;
  }

  // Chart and the in-card illustration paint after the SDK scene
  // resolves. The deck lock has already been released by then.
  if (sel.cat === "sky" && (sel.form === "chart" || sel.form === "moon")) {
    scheduleSkyVisual(sel, surface);
  }

  // A world-city card's local time is live text, not a snapshot: give it
  // its own span so tick() can advance it every second, in step with the
  // main clock. (Sunrise / sunset / day length on the same card are
  // per-day values and stay static.) Any other card clears the hook, so
  // the ticker never touches a stale element.
  liveWorldTime = null;
  if (worldLive) {
    const span = document.createElement("span");
    span.id = "world-live-time";
    span.dataset.tz = worldLive.tz;
    span.textContent = timeInZone(new Date(), worldLive.tz);
    const metaEl = surface.meta;
    metaEl.textContent = "";
    metaEl.append(document.createTextNode(worldLive.prefix), span);
    liveWorldTime = { tz: worldLive.tz, el: span };
  }
}

/* Dated note first, then the day's ungifted postcard. A dated note is
   marked delivered once it has rendered; a gifted postcard renders as
   an envelope outside ambient mode, so its receipt waits until the
   visitor opens the picture modal (deliverPostcardGift) — in ambient
   mode it renders directly and rendering is still the delivery.
   After the gifts, the postcard joins the rotation with its original
   12% chance (never twice in a row). */
const POSTCARD_POOL_CHANCE = 0.12;
const NOTE_GIFT_REFRESH_MS = 500;
const NOTE_GIFT_REFRESH_RETRIES = 2;

// Wait outside the shared lock and the synchronous render transaction.
// A stuck IndexedDB read must not keep the draw gate or other tabs blocked.
function waitForNoteGiftRefresh() {
  let timer;
  return Promise.race([
    notesLoadAll(),
    new Promise(resolve => { timer = setTimeout(resolve, NOTE_GIFT_REFRESH_MS); }),
  ]).catch(() => {}).finally(() => clearTimeout(timer));
}

function nextSelection(retryNotes = true) {
  // Use one local-day snapshot for gift lookup, receipt check and commit.
  const now = new Date();
  const stamp = postcardDayKey(now);
  const dn = todaysDatedNoteSelection(now, stamp);
  if (dn) return dn;
  const pc = todaysPostcardSelection(now, stamp);
  if (pc) {
    if (!postcardGifted(stamp)) {
      // Unknown is not the same as no due note. A revision may have changed
      // after the opening load, even when an existing due note is unchanged.
      if (!notesCurrent() && !noteDeliveredToday(stamp) && !notesDbFailed) {
        if (retryNotes) return null;
        // A bounded refresh failed: keep the stage usable without consuming
        // the postcard receipt. A later draw can still deliver both in order.
        return makeSelection(weightedCategory(now), now);
      }
      return { ...pc, gifted: true, giftStamp: stamp };
    }
    if (lastCategory !== "postcard" && Math.random() < POSTCARD_POOL_CHANCE) return pc;
  }
  return makeSelection(weightedCategory(now), now);
}

let drawsReady = false;
const drawGate = NAM_DEDUP.createDrawGate((task) => setTimeout(task, 180));

/* All five stage dialogs share one isolation boundary. Keep the body at
   the saved viewport offset (including older iOS Safari), make its
   other direct children inert, and contain keyboard focus. The clock
   keeps ticking; new encounters wait until the reader closes the modal. */
let imageModalSel = null;
let activeModal = null;
let modalEpoch = 0;
let modalScroll = null;

function showModal(id) {
  if (activeModal) return false;
  const overlay = $(id);
  const root = document.documentElement;
  const siblings = Array.from(document.body.children)
    .filter(el => el !== overlay && !el.inert);
  modalScroll = { x: window.scrollX, y: window.scrollY, siblings };
  activeModal = overlay;
  modalEpoch++;
  overlay.hidden = false;
  root.style.setProperty("--modal-page-top", `-${modalScroll.y}px`);
  root.style.setProperty("--modal-page-left", `-${modalScroll.x}px`);
  // Preserve the background's original width on desktop scrollbars.
  root.style.setProperty("--modal-page-width", `${root.clientWidth}px`);
  root.classList.add("modal-open");
  for (const el of siblings) el.inert = true;
  fabTouchStart = null;
  resetFab();
  return true;
}

function hideModal(id) {
  if (activeModal !== $(id)) return false;
  const { x, y, siblings } = modalScroll;
  activeModal.hidden = true;
  activeModal = null;
  modalScroll = null;
  for (const el of siblings) el.inert = false;
  const root = document.documentElement;
  root.classList.remove("modal-open");
  root.style.removeProperty("--modal-page-top");
  root.style.removeProperty("--modal-page-left");
  root.style.removeProperty("--modal-page-width");
  window.scrollTo(x, y);
  // If a deep link opened a note before the first draw, allow startup
  // to finish on the next tick rather than leaving an empty stage.
  lastDrawAt = currentSelection ? Date.now() : Date.now() - 60000;
  return true;
}

function modalFocusables() {
  return Array.from(activeModal.querySelectorAll(
    "a[href], button, input, select, textarea, [tabindex]"
  )).filter(el => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length);
}

function focusInsideModal(last = false) {
  const items = modalFocusables();
  const target = (last ? items[items.length - 1] : items[0]) ||
    activeModal.querySelector('[role="dialog"]');
  if (target) {
    if (!items.length) target.tabIndex = -1;
    target.focus();
  }
}

function trapModalTab(e) {
  if (!activeModal || e.key !== "Tab") return;
  const items = modalFocusables();
  const current = document.activeElement;
  const index = items.indexOf(current);
  // Focus can rest on a programmatic target inside the dialog (tabindex
  // -1, e.g. a section the reading's tiles jump to). Continue from its
  // place in document order; wrap only at the real first/last control.
  if (index < 0 && items.length && current !== activeModal && activeModal.contains(current)) {
    e.preventDefault();
    const next = e.shiftKey
      ? items.filter(el => current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING && !el.contains(current)).pop()
      : items.find(el => current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (next) next.focus(); else focusInsideModal(e.shiftKey);
    return;
  }
  if (!items.length || index < 0 ||
      (e.shiftKey ? index === 0 : index === items.length - 1)) {
    e.preventDefault();
    focusInsideModal(e.shiftKey);
  }
}

function retainModalFocus(e) {
  if (activeModal && !activeModal.contains(e.target)) focusInsideModal();
}

function drawCard() {
  if (!drawsReady || drawGate.pending || activeModal || imageModalSel) return false;
  const epoch = modalEpoch;
  const card = $("card");
  card.classList.add("leaving");
  return drawGate.request(() => {
    const finish = () => card.classList.remove("leaving");
    if (activeModal || epoch !== modalEpoch) { finish(); return; }
    if (gossipEndpoint()) refreshGossip();
    try {
      // Serialize choice, synchronous render, commit and daily receipt.
      const attempt = retriesLeft => {
        const result = deckState.withLock(() => {
          // The modal can open while waiting for a shared lock or note
          // refresh. Treat that attempt as finished without a draw/retry.
          if (activeModal || epoch !== modalEpoch) return true;
          const selected = deckState.transact(() => {
            const sel = nextSelection(retriesLeft > 0);
            if (!sel) return null;
            if (sel.cat === "mine" && sel.gifted) {
              deckState.markSeen("mine", notesList.map(n => "note:" + n.id), "note:" + sel.note.id);
            }
            renderSelection(sel);
            return sel;
          });
          if (!selected) return false;
          currentSelection = selected;
          lastCategory = selected.cat;
          encounter += 1;
          lastDrawAt = Date.now();
          $("encounter").textContent = t().encounter(encounter);
          if (selected.gifted) {
            if (selected.cat === "mine") markNoteDelivered(selected.note.id, selected.giftStamp);
            // A postcard shown as an envelope is announced, not yet
            // delivered: its receipt is written when the picture modal
            // opens. Direct rendering (ambient) delivers on render.
            if (selected.cat === "postcard" && !stageShowsEnvelope(selected)) {
              markPostcardGifted(selected.giftStamp);
            }
            showGiftNotice(selected);
          } else {
            dismissGiftNotice();
          }
          return true;
        });
        // Release the lock before waiting. Reacquire it and recompute the
        // day, note revision and receipts on every retry.
        const retry = drawn => drawn ? undefined
          : waitForNoteGiftRefresh().then(() => attempt(retriesLeft - 1));
        return result && typeof result.then === "function" ? result.then(retry) : retry(result);
      };
      const result = attempt(NOTE_GIFT_REFRESH_RETRIES);
      if (result && typeof result.then === "function") return result.finally(finish);
      finish();
    } catch (e) {
      finish();
      throw e;
    }
  });
}

function canRepaintSelection(sel) {
  // The cap excludes new history encounters, not the current bilingual card.
  if (sel.cat === "postcard" || sel.cat === "history") return true;
  if (sel.cat === "gossip") return sel.newsLang === lang;
  return availableCategories().some(c => c.key === sel.cat);
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
    let text = `${dateStr} · 农历${lunarDate(now).label}`;
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

  // World-city card on stage: its local time advances with the main clock.
  if (liveWorldTime) {
    if (!liveWorldTime.el.isConnected) {
      liveWorldTime = null;
    } else {
      const txt = timeInZone(now, liveWorldTime.tz);
      if (liveWorldTime.el.textContent !== txt) liveWorldTime.el.textContent = txt;
    }
  }

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
  appStorage.setItem(LS_THEME, theme);
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
  $("mydays-title").textContent = s.myDays.label;
  $("mydays-empty").textContent = s.myDays.empty;
  $("mydays-close").textContent = s.captureClose;
  $("myday-name").placeholder = s.myDays.namePlaceholder;
  $("myday-cal-solar").textContent = s.myDays.solar;
  $("myday-cal-lunar").textContent = s.myDays.lunar;
  $("myday-add").textContent = s.myDays.add;
  refreshMyDayEffectOptions();
  renderMyDaysList();
  $("notes-label").textContent = s.notes.libraryLabel;
  $("privacy-link").textContent = s.privacyLabel;
  $("about-link").textContent = s.aboutLabel;
  $("note-fab").textContent = s.notes.addButton;
  $("note-fab").setAttribute("aria-label", s.notes.modalTitle);
  $("note-title").textContent = s.notes.modalTitle;
  $("note-type-reflection").textContent = s.notes.types.reflection;
  $("note-type-memo").textContent = s.notes.types.memo;
  $("note-text").placeholder = s.notes.placeholder;
  $("note-date-label").textContent = s.notes.dateLabel;
  $("note-date-hint").textContent = s.notes.dateHint;
  $("note-error").textContent = s.notes.storeError;
  $("note-save").textContent = s.notes.save;
  $("note-cancel").textContent = s.notes.cancel;
  $("encounter").textContent = encounter > 0 ? s.encounter(encounter) : "";
  document.querySelectorAll(".style-chip").forEach((chip) => {
    chip.textContent = s.clockStyles[chip.dataset.style];
  });
  refreshSignOptions();
  if (currentSelection && !drawGate.pending) {
    if (!canRepaintSelection(currentSelection)) {
      drawCard();
    } else {
      // Resolve the latest language after acquiring the lock; the same
      // gate prevents concurrent lazy language and ordinary draws.
      drawGate.run(() => deckState.withLock(() => {
        if (!canRepaintSelection(currentSelection)) {
          setTimeout(drawCard, 0);
          return;
        }
        currentSelection = deckState.transact(() => {
          const sel = selectionForLanguage(currentSelection);
          renderSelection(sel);
          return sel;
        });
      }));
    }
  }
  // A visible gift notice follows the language like the card does.
  if (giftNoticeSel) {
    $("gift-notice-text").textContent = giftNoticeText(giftNoticeSel);
    $("gift-notice-close").setAttribute("aria-label", s.captureClose);
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
    if (userSign) appStorage.setItem(LS_SIGN, userSign);
    else appStorage.removeItem(LS_SIGN);
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
  appStorage.setItem(LS_STYLE, st);
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
  if (e.target.closest("a, .sky-retry")) return; // links and sky retry stay put
  // An envelope on the stage opens its picture instead of drawing.
  if (stageShowsEnvelope(currentSelection)) { openImageModal(currentSelection); return; }
  drawCard();
});
$("card").addEventListener("keydown", (e) => {
  // Enter draws only when the card itself is focused. Descendant controls
  // (including sky retry and reading links/buttons) own their activation.
  // On an envelope, Enter opens the picture, like a click does.
  if (e.key === "Enter" && e.target === e.currentTarget) {
    if (stageShowsEnvelope(currentSelection)) { openImageModal(currentSelection); return; }
    drawCard();
  }
});
document.addEventListener("keydown", (e) => {
  if (!activeModal && e.code === "Space" && !e.repeat && e.target === document.body) {
    e.preventDefault();
    drawCard();
  }
});
function setLang(next) {
  if (next === lang) return;
  // A picture modal open across a language switch would keep the old
  // language inside it: close it first; the stage (envelope or card)
  // is repainted by applyStaticStrings in the new language.
  if (imageModalOpen()) closeImageModal();
  lang = next;
  appStorage.setItem(LS_LANG, lang);
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
  // The gift notice shares the brand row; on a phone it would sit on
  // the panel's top edge. Opening settings is a fine moment to let it go.
  if (open) dismissGiftNotice();
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

/* Repaint the current selection in place (no new draw, no deck
   movement) — used when ambient mode flips a picture card between
   its envelope and its direct rendering. */
function repaintCurrentSelection() {
  if (!currentSelection || drawGate.pending) return;
  drawGate.run(() => deckState.withLock(() => {
    if (!currentSelection) return;
    currentSelection = deckState.transact(() => {
      const sel = selectionForLanguage(currentSelection);
      renderSelection(sel);
      return sel;
    });
  }));
}

function enterAmbient() {
  if (ambientOn || activeModal) return;
  ambientOn = true;
  document.body.classList.add("ambient");
  setSettingsOpen(false);
  dismissGiftNotice();
  resetFab();
  // A picture card (or its envelope) on the stage changes dress:
  // in ambient the picture itself is shown, directly.
  if (isPictureCard(currentSelection)) repaintCurrentSelection();
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
  // …and a picture that was shown directly goes back into its envelope.
  if (isPictureCard(currentSelection)) repaintCurrentSelection();
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
  // Keys inside a dialog belong to that dialog. F must not enter ambient
  // (which would also dismiss a picture) and Escape must not be treated
  // as leaving a mode the reader never entered.
  if (activeModal) return;
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
function extractCardBlocks(rootEl) {
  const root = rootEl || $("card-body");
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
    if (el.tagName === "CANVAS" && cls.contains("sky-canvas")) {
      // A painted sky: the keepsake repaints it from the scene (see
      // the sky branch of the layout), so it becomes a visual block.
      flush();
      blocks.push({ type: "sky", form: el.dataset.form || "chart" });
      return;
    }
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
    if (b.type === "sky") {
      const h = Math.round((b.form === "chart" || b.form === "moon" ? 300 : 225) * scale);
      if (y + h > maxHeight) { truncated = true; break; }
      items.push({ type: "sky", form: b.form, yOff: y, h });
      y += h + Math.round(10 * scale);
      continue;
    }
    const spec = KEEP_KINDS[b.kind] || KEEP_KINDS.normal;
    const font = keepFont(pal, spec, scale);
    ctx.font = font;
    const size = Math.max(10, Math.round(spec.size * scale));
    const lineH = Math.round(spec.size * scale * spec.lh);
    for (const ln of wrapText(ctx, b.text, maxWidth)) {
      if (y + lineH > maxHeight) { truncated = true; break outer; }
      // A standalone attribution (quotes, classics) sits flush right, as on the card.
      items.push({ type: "text", text: ln, font, color: spec.color, yOff: y, lineH, size, right: b.kind === "author" });
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
  // Fade to the same colour at zero alpha: fading to transparent black
  // would draw a grey ring around the light seasonal tints.
  glow.addColorStop(1, String(pal.glow).replace(/rgba?\(([^,]+),([^,]+),([^,)]+)(?:,[^)]*)?\)/, "rgba($1,$2,$3, 0)"));
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
  // Spaced out when the line leads with Chinese; near-normal when it
  // leads with English (wide tracking reads as a fault in Latin).
  const cjkFirst = /^[\u3400-\u9fff]/.test(snap.brand);
  setLetterSpacing(ctx, cjkFirst ? "6px" : "1.5px");
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
  // A Chinese label is spaced out; an English one is set as an
  // uppercase label with light tracking, as on the stage card.
  const cjkLabel = /[\u3400-\u9fff]/.test(snap.category);
  ctx.font = cjkLabel ? `600 30px ${pal.serif}` : `600 26px ${pal.serif}`;
  setLetterSpacing(ctx, cjkLabel ? "8px" : "3px");
  ctx.fillText(cjkLabel ? snap.category : snap.category.toUpperCase(), textX, catBaseline);
  setLetterSpacing(ctx, "0px");
  if (snap.meta) {
    ctx.fillStyle = pal.inkSoft;
    ctx.font = `400 28px ${pal.serif}`;
    ctx.fillText(snap.meta, textX, metaBaseline);
  }

  for (const it of layout.items) {
    if (it.type === "sky") {
      if (snap.skyCanvas && (it.form === "chart" || it.form === "moon")) {
        const side = Math.min(textW, it.h);
        ctx.drawImage(snap.skyCanvas, textX + (textW - side) / 2, bodyTop + it.yOff, side, side);
      }
      continue;
    }
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
      ctx.textAlign = it.right ? "right" : "left";
      ctx.fillText(it.text, it.right ? textX + textW : textX, bodyTop + it.yOff + (it.lineH - it.size) / 2 + it.size * 0.8);
      ctx.textAlign = "left";
    }
  }

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = pal.inkSoft;
  ctx.font = `300 26px ${pal.sans}`;
  setLetterSpacing(ctx, cjkFirst ? "3px" : "1px");
  ctx.fillText(snap.footer, cx, 1280);
  setLetterSpacing(ctx, "0px");

  return cv;
}

/* ---------- Postcard keepsake ----------
   When the card on stage is a special-date postcard, the keepsake IS
   the postcard: the same fixed composition, drawn at 1080×1440 (3:4 —
   ordinary keepsakes stay 1080×1350). The numbers below are the stage
   composition's proportions at that scale — the painting full-bleed at
   1080×1080 across the top, and the cream paper only below it: a 360px
   text zone with fixed slots (a title row with the meta at its right /
   a subtitle line / a passage of at most three lines / a slim footer
   row), side padding 56. */
const PC_KEEP_H = 1440;
const PC_PAPER = "#faf4e6";
const PC_INK = "#2b2620";
const PC_INK_SOFT = "#6f6656";
const PC_ACCENT = "#b23a2a";

function loadPostcardImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("postcard image failed to load"));
    img.src = src;
  }).then(async (img) => {
    try { await img.decode(); } catch (e) { /* onload already proved it usable */ }
    return img;
  });
}

function renderPostcardKeepsake(sel, img, serif) {
  const cv = document.createElement("canvas");
  cv.width = KEEP_W;
  cv.height = PC_KEEP_H;
  const ctx = cv.getContext("2d");
  const copy = POSTCARD_COPY[sel.key];
  const title = lang === "zh" ? copy.titleZh : copy.titleEn;
  const subtitle = lang === "zh" ? copy.subZh : copy.subEn;
  const passage = lang === "zh" ? copy.passZh : copy.passEn;
  const brand = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";
  const mp = postcardMetaParts(sel);

  // The cream paper backs the whole card (it is what the text zone is
  // made of); the painting then covers the top 1080×1080 full-bleed.
  ctx.fillStyle = PC_PAPER;
  ctx.fillRect(0, 0, KEEP_W, PC_KEEP_H);
  ctx.drawImage(img, 0, 0, KEEP_W, KEEP_W);

  // Text zone: y 1080→1440, x = 56, width 968. Fixed slots, mirroring
  // the stage composition's cqw numbers at this scale.
  const tx = 56, tw = KEEP_W - 112;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Title row: the title at the left, the meta right-aligned on the
  // same baseline — date in soft ink, the crossing time in vermillion.
  const rowBaseline = 1148;
  ctx.fillStyle = PC_INK;
  ctx.font = `900 50px ${serif}`;
  setLetterSpacing(ctx, "1px");
  // English titles: the gloss after " · " is set smaller, as on stage.
  let titleMain = title, titleGloss = "";
  if (lang === "en") {
    const cut = title.indexOf(" · ");
    if (cut > 0) { titleMain = title.slice(0, cut); titleGloss = title.slice(cut); }
  }
  ctx.fillText(titleMain, tx, rowBaseline);
  if (titleGloss) {
    const mainW = ctx.measureText(titleMain).width;
    ctx.font = `900 33px ${serif}`;
    ctx.fillText(titleGloss, tx + mainW + 3, rowBaseline);
  }
  setLetterSpacing(ctx, "0px");

  ctx.font = `400 27px ${serif}`;
  const preW = ctx.measureText(mp.pre).width;
  let timeW = 0;
  if (mp.time) {
    ctx.font = `600 27px ${serif}`;
    timeW = ctx.measureText(mp.time).width;
    ctx.font = `400 27px ${serif}`;
  }
  const postW = mp.post ? ctx.measureText(mp.post).width : 0;
  let mx = tx + tw - (preW + timeW + postW);
  ctx.fillStyle = PC_INK_SOFT;
  ctx.fillText(mp.pre, mx, rowBaseline);
  mx += preW;
  if (mp.time) {
    ctx.font = `600 27px ${serif}`;
    ctx.fillStyle = PC_ACCENT;
    ctx.fillText(mp.time, mx, rowBaseline);
    mx += timeW;
    ctx.font = `400 27px ${serif}`;
    ctx.fillStyle = PC_INK_SOFT;
  }
  if (mp.post) ctx.fillText(mp.post, mx, rowBaseline);

  // Subtitle: one quiet line under the title row (baseline 1192),
  // with ~17px of air above it and ~15px below — the slots are spread
  // over the whole text zone instead of stacked at its top.
  if (subtitle) {
    ctx.fillStyle = PC_INK_SOFT;
    ctx.font = `400 25px ${serif}`;
    setLetterSpacing(ctx, "1.5px");
    ctx.fillText(subtitle, tx, 1192);
    setLetterSpacing(ctx, "0px");
  }

  // Passage: 38px at ~1.45 line height, up to the three lines the copy
  // was written for (baselines 1244 / 1299 / 1354).
  ctx.fillStyle = PC_INK;
  ctx.font = `400 38px ${serif}`;
  const lines = wrapText(ctx, passage, tw).slice(0, 3);
  lines.forEach((ln, i) => ctx.fillText(ln, tx, 1244 + i * 55));

  // Footer: hairline, the 时 seal at the left, the brand at the right.
  ctx.strokeStyle = "rgba(43, 38, 32, 0.10)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tx, 1393);
  ctx.lineTo(tx + tw, 1393);
  ctx.stroke();
  roundRectPath(ctx, tx, 1399, 25, 25, 5);
  ctx.fillStyle = PC_ACCENT;
  ctx.fill();
  ctx.fillStyle = "#fff8ec";
  ctx.font = `900 17px ${serif}`;
  ctx.textAlign = "center";
  ctx.fillText("时", tx + 12.5, 1399 + 18);
  ctx.textAlign = "right";
  ctx.fillStyle = PC_INK_SOFT;
  ctx.font = `400 22px ${serif}`;
  setLetterSpacing(ctx, "2px");
  ctx.fillText(brand, tx + tw, 1420);
  setLetterSpacing(ctx, "0px");

  return cv;
}

/* ---------- Sky-illustration keepsake ----------
   A sky illustration on stage captures in its own dress too:
   Elsewhere's keepsake composition at full size — the painting at
   its portrait 4:5 (1080×1350, the tallest sky its postcard allows:
   skyHeight caps at 1500 for a 1200-wide card) full-bleed across
   the top, and below it a paper panel sized to its text, as
   Elsewhere sizes its own panel (padding and line heights, not a
   fixed total): a head row (the place at the left, the meta
   right-aligned), the two highlight lines, and a last row with the
   brand at the right. The total stands 1080×1700 — this form is not bound to the standard
   keepsake's 1080×1350 (ordinary keepsakes keep their panel,
   postcards theirs at 1080×1440). */
const SKY_KEEP_ART_H = 1350;   // the painting: 1080×1350, 4:5 portrait
const SKY_KEEP_PANEL_H = 350;  // the paper panel below it
const SKY_KEEP_H = SKY_KEEP_ART_H + SKY_KEEP_PANEL_H;
async function renderSkyArtKeepsake(sel, serif, paintedArt = null) {
  const cv = document.createElement("canvas");
  cv.width = KEEP_W;
  cv.height = SKY_KEEP_H;
  const ctx = cv.getContext("2d");
  const K = t().sky;
  const sc = sel.summary;
  const brand = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";

  ctx.fillStyle = PC_PAPER;
  ctx.fillRect(0, 0, KEEP_W, SKY_KEEP_H);
  // The painting at Elsewhere's portrait 4:5 (1080×1350 here); the
  // paper panel below is sized to its text (350), so the keepsake
  // stands 1080×1700 in all.
  const artH = SKY_KEEP_ART_H;
  if (paintedArt) {
    ctx.drawImage(paintedArt, 0, 0, KEEP_W, artH);
  } else if (sel.scene) {
    const off = document.createElement("canvas");
    off.width = KEEP_W;
    off.height = artH;
    await NAM_SKY.paintIllustration(off, sel.scene, sc && sc.sig);
    ctx.drawImage(off, 0, 0);
  } else {
    ctx.fillStyle = "#1b2438";
    ctx.fillRect(0, 0, KEEP_W, artH);
  }

  // Text zone: y 1350→1700, x = 56, width 968 (the postcard's numbers).
  const tx = 56, tw = KEEP_W - 112;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Head row: the place at the left (shrunk a step at a time if a
  // long name runs toward the meta), the meta right-aligned.
  const placeName = sel.place ? skyPlaceName(sel.place) : t().categories.sky;
  ctx.font = `400 27px ${serif}`;
  const metaW = ctx.measureText(K.illusMeta).width;
  let titleSize = 46;
  ctx.fillStyle = PC_INK;
  ctx.font = `900 ${titleSize}px ${serif}`;
  setLetterSpacing(ctx, "2px");
  while (ctx.measureText(placeName).width > tw - metaW - 30 && titleSize > 30) {
    titleSize -= 2;
    ctx.font = `900 ${titleSize}px ${serif}`;
  }
  ctx.fillText(placeName, tx, artH + 78);
  setLetterSpacing(ctx, "0px");
  ctx.font = `400 27px ${serif}`;
  ctx.fillStyle = PC_INK_SOFT;
  ctx.textAlign = "right";
  ctx.fillText(K.illusMeta, tx + tw, artH + 78);
  ctx.textAlign = "left";

  // The highlight lines, shrunk a step if one runs wide.
  const fitLine = (text, base, y) => {
    let size = base;
    ctx.font = `400 ${size}px ${serif}`;
    while (ctx.measureText(text).width > tw && size > 28) {
      size -= 2;
      ctx.font = `400 ${size}px ${serif}`;
    }
    ctx.fillText(text, tx, y);
  };
  ctx.fillStyle = PC_INK;
  if (sc && sc.sig) {
    fitLine(K.lookFor(K.asterisms[sc.sig.key].name, K.dirs[sc.sig.dir]), 37, artH + 140);
    fitLine(K.asterisms[sc.sig.key].line, 37, artH + 196);
  } else {
    fitLine(K.fallback, 37, artH + 140);
  }

  // Last row: the brand at the right. (No approximation note, as
  // on the card: the place's coordinates are exact.)
  ctx.font = `400 22px ${serif}`;
  setLetterSpacing(ctx, "2px");
  ctx.textAlign = "right";
  ctx.fillText(brand, tx + tw, SKY_KEEP_H - 38);
  setLetterSpacing(ctx, "0px");

  return cv;
}

/* The SDK artwork remains square; the 360px paper panel contains
   the title, observations, approximation, credits and brand. */
function renderAstronomyPicture(sel, art, serif) {
  const cv = document.createElement("canvas");
  cv.width = KEEP_W;
  cv.height = PC_KEEP_H;
  const ctx = cv.getContext("2d");
  const s = t(), K = s.sky;
  const moon = sel.form === "moon";
  const m = moon ? sel.summary.moon : null;
  const title = moon ? s.world.phases[m.idx] : K.chartMeta;
  const bits = moon ? null : skyFactsInner(sel);
  const facts = moon ? [s.world.moonIllum(m.illum) + " · " + s.world.moonAge(m.age)] :
    [bits.look, bits.line].filter(Boolean);
  const notes = moon ? [K.approx, K.moonCredit] : [K.approx];
  const brand = lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有";
  const tx = 56, tw = KEEP_W - tx * 2;
  ctx.fillStyle = PC_PAPER;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(art, 0, 0, KEEP_W, KEEP_W);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const fitLine = (value, size, weight, x, y, maxWidth) => {
    ctx.font = `${weight} ${size}px ${serif}`;
    while (ctx.measureText(value).width > maxWidth && size > 22) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${serif}`;
    }
    ctx.fillText(value, x, y, maxWidth);
  };
  ctx.fillStyle = PC_INK;
  fitLine(title, 50, 900, tx, 1152, moon ? tw * 0.58 : tw);
  if (moon) {
    ctx.fillStyle = PC_INK_SOFT;
    ctx.textAlign = "right";
    fitLine(s.world.moonTitle, 27, 400, tx + tw, 1152, tw * 0.39);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = PC_INK;
  let size = 38, lines;
  do {
    ctx.font = `400 ${size}px ${serif}`;
    lines = facts.flatMap((fact) => wrapText(ctx, fact, tw));
    if (lines.length <= 3 || size <= 24) break;
    size -= 2;
  } while (true);
  const step = Math.min(48, 96 / Math.max(1, lines.length - 1));
  lines.forEach((line, i) => ctx.fillText(line, tx, 1210 + i * step, tw));
  ctx.fillStyle = PC_INK_SOFT;
  notes.forEach((note, i) => fitLine(note, 27, 400, tx, 1350 + i * 31, tw));
  ctx.strokeStyle = "rgba(43, 38, 32, 0.10)";
  ctx.beginPath();
  ctx.moveTo(tx, 1395);
  ctx.lineTo(tx + tw, 1395);
  ctx.stroke();
  ctx.textAlign = "right";
  fitLine(brand, 22, 400, tx + tw, 1422, tw);
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
  // A delayed stage capture must not interrupt a newer reading/editing modal.
  if (activeModal) return;
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
  showModal("capture-overlay");
  $("capture-close-btn").focus();
}

function closeCapture() {
  if ($("capture-overlay").hidden) return;
  hideModal("capture-overlay");
  if (captureUrl) {
    URL.revokeObjectURL(captureUrl);
    captureUrl = null;
  }
  captureFile = null;
  // Return focus to the surface the keepsake was taken from.
  if (imageModalOpen()) $("img-close-btn").focus({ preventScroll: true });
  else $("capture-btn").focus({ preventScroll: true });
}

/* A sky chart / moon whose picture is NOT on the stage right now —
   its envelope is (or the stage is otherwise occupied) — captures
   from the selection itself: the scene is the adapter's cached one,
   painted once into an off-screen canvas at the stage's own size.
   Nothing here touches the stage DOM, so the envelope never leaks
   into the keepsake. */
async function captureSkyPanelSnap(sel, frozen) {
  const s = t();
  const scene = await (sel.ready || (sel.ready = NAM_SKY.sceneFor(sel.observer)));
  sel.scene = scene;
  if (!sel.summary) sel.summary = skySummary(scene, sel.observer);
  const cv = document.createElement("canvas");
  let meta = "";
  let blocks = [];
  if (sel.form === "chart") {
    cv.width = 880; cv.height = 880;
    await NAM_SKY.paintChart(cv, scene, lang === "zh" ? "zh-Hans" : "en");
    meta = s.sky.chartMeta;
    const bits = skyFactsInner(sel);
    const fact = [bits.look, bits.line].filter(Boolean).join("  ·  ");
    if (fact) blocks.push({ text: fact, kind: "fact" });
    blocks.push({ text: s.sky.approx, kind: "sub" });
  } else {
    cv.width = 720; cv.height = 720;
    await NAM_SKY.paintMoon(cv, scene, null);
    meta = s.world.moonTitle;
    const moon = sel.summary.moon;
    blocks.push({ text: s.world.phases[moon.idx], kind: "big" });
    blocks.push({ text: `${s.world.moonIllum(moon.illum)}  ·  ${s.world.moonAge(moon.age)}`, kind: "fact" });
    blocks.push({ text: s.sky.approx, kind: "sub" });
    blocks.push({ text: s.sky.moonCredit, kind: "sub" });
  }
  blocks.unshift({ type: "sky", form: sel.form });
  return {
    time: `${pad(frozen.getHours())}:${pad(frozen.getMinutes())}:${pad(frozen.getSeconds())}`,
    dateLine: $("date-line").textContent,
    category: s.categories.sky,
    meta,
    blocks,
    skyCanvas: cv,
    brand: lang === "zh" ? "此时，还有 · Now, and More" : "Now, and More · 此时，还有",
    footer: (encounter > 0 ? s.encounter(encounter) : "") ?
      `${s.encounter(encounter)} · now.orangely.xyz` : "now.orangely.xyz",
  };
}

async function captureKeepsake() {
  const btn = $("capture-btn");
  if (btn.disabled || imageModalOpen()) return;
  btn.disabled = true;
  try {
    const frozen = new Date();
    // A postcard on stage captures as the postcard itself (see above).
    if (currentSelection && currentSelection.cat === "postcard" && POSTCARD_COPY[currentSelection.key]) {
      const copy = POSTCARD_COPY[currentSelection.key];
      const art = lang === "en" && copy.artEn ? copy.artEn : copy.art;
      const img = await loadPostcardImage(`assets/special-dates/${art}.webp`);
      await ensureCaptureFonts();
      const palPc = capturePalette();
      const cvPc = renderPostcardKeepsake(currentSelection, img, palPc.serif);
      const blobPc = await new Promise((res) => cvPc.toBlob((b) => res(b), "image/png"));
      if (blobPc) showCapture(blobPc, frozen);
      return;
    }
    // A sky illustration captures in its postcard-like dress (see
    // renderSkyArtKeepsake); chart and moon forms keep the panel.
    if (currentSelection && currentSelection.cat === "sky" &&
        currentSelection.form === "illustration") {
      if (currentSelection.painted) await currentSelection.painted;
      await ensureCaptureFonts();
      const palSa = capturePalette();
      const cvSa = await renderSkyArtKeepsake(currentSelection, palSa.serif);
      const blobSa = await new Promise((res) => cvSa.toBlob((b) => res(b), "image/png"));
      if (blobSa) showCapture(blobSa, frozen);
      return;
    }
    if (currentSelection && currentSelection.cat === "sky" &&
        (currentSelection.form === "chart" || currentSelection.form === "moon") &&
        currentSelection.painted) {
      await currentSelection.painted;
    }
    // An unopened envelope on the stage: the keepsake is the picture
    // itself, rebuilt from the selection — never the envelope.
    if (currentSelection && currentSelection.cat === "sky" &&
        (currentSelection.form === "chart" || currentSelection.form === "moon") &&
        stageShowsEnvelope(currentSelection) && !imageModalOpen()) {
      const palEnv = capturePalette();
      await ensureCaptureFonts();
      const snapEnv = await captureSkyPanelSnap(currentSelection, frozen);
      const cvEnv = renderKeepsakeCanvas(snapEnv, palEnv);
      const blobEnv = await new Promise((res) => cvEnv.toBlob((b) => res(b), "image/png"));
      if (blobEnv) showCapture(blobEnv, frozen);
      return;
    }
    const s = t();
    const enc = encounter > 0 ? s.encounter(encounter) : "";
    // The stage keepsake remains separate from the picture modal.
    const snap = {
      time: `${pad(frozen.getHours())}:${pad(frozen.getMinutes())}:${pad(frozen.getSeconds())}`,
      dateLine: $("date-line").textContent,
      category: $("card-category").textContent,
      meta: $("card-meta").textContent,
      blocks: extractCardBlocks($("card-body")),
      skyCanvas: currentSelection && currentSelection.cat === "sky" &&
        (currentSelection.form === "chart" || currentSelection.form === "moon")
        ? $("card-body").querySelector("canvas.sky-canvas") : null,
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
document.addEventListener("keydown", trapModalTab, true);
document.addEventListener("focusin", retainModalFocus);
buildAnalogTicks();
buildStyleChips();
buildSignSelector();
buildMyDaysForm();
fxResize();
setClockStyle(clockStyle);
applyStaticStrings();
applySpecialDay();
refreshGossip();
/* The first card of the day may be a gift — a dated note or the
   postcard — so the opening draw waits for the notes library to load.
   IndexedDB answers in milliseconds; the timeouts are only a promise
   that a wedged database can never leave the stage empty. */
let initialDrawDone = false;
function initialDraw() {
  if (initialDrawDone) return;
  initialDrawDone = true;
  drawsReady = true;
  drawCard();
}
window.addEventListener("storage", e => {
  if (e.key === NAM_DEDUP.KEY || e.key === NAM_DEDUP.HISTORY_KEY || e.key === null) deckState.sync();
  if (e.key === NOTES_REVISION_KEY || e.key === null) notesLoadAll();
});
window.addEventListener("focus", () => { deckState.sync(); notesLoadAll(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { deckState.sync(); notesLoadAll(); }
});
const notesReady = notesLoadAll();
Promise.race([
  notesReady,
  new Promise((r) => setTimeout(r, 1500)),
]).then(initialDraw);
/* Arriving from library.html's 写一句 button (index.html#write): open
   the write modal once the library has loaded, then drop the hash so
   a reload does not reopen it. */
if (location.hash === "#write") {
  try { history.replaceState(null, "", location.pathname + location.search); }
  catch (e) { location.hash = ""; }
  notesReady.then(() => openNoteModal(null));
}
setTimeout(initialDraw, 3000);
setInterval(tick, 200);
tick();

/* Offline shell: register the service worker after load; any failure is
   silent — the site must work exactly the same without it. */
/* Warm the SDK after first paint. A failure here must not block the
   site; the sky card retries on its own. */
try {
  const warmSky = () => { if (window.NAM_SKY) NAM_SKY.warm().catch(() => {}); };
  if (window.requestIdleCallback) requestIdleCallback(warmSky, { timeout: 2500 });
  else setTimeout(warmSky, 600);
} catch (e) { /* ignore */ }

