/* Now, and More — astrology (星位 / 每日运势)
   Loaded as a classic script after data.js and horoscope-advice.js and
   before app.js. At load time it only declares tables and functions; at
   call time it uses RAD, DAY_MS and sunApparentLongitudeDeg from app.js's
   shared solar-term ephemeris, plus the data.js pools (SIGNS, I18N, ...).
   No DOM access, so tests can load the whole file directly. */
"use strict";
/* Two kinds of content live here:
   - 星位 star positions: REAL astronomy, computed live from JPL Keplerian
     elements (approximate; measured against JPL Horizons in
     docs/ephemeris-accuracy.md).
   - 每日运势 daily horoscope: traditional-inspired entertainment rules
     based on duration-weighted complete ephemeris snapshots over the local
     civil day; seeded variation is confined to advice
     wording and symbolic lucky cues. Weights: HORO_MODEL. */

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
  return sunApparentLongitudeDeg(date);
}
/* Rotate the J2000 ecliptic vector to the mean ecliptic/equinox of date
   (Meeus, Astronomical Algorithms, ch. 21, ecliptic precession; epoch
   J2000). This includes the small change of the ecliptic plane as well
   as precession in longitude. The planetary model remains approximate:
   light time, aberration and nutation are not modeled for the planets. */
function tropicalLongitudeOfDate(x, y, z, date) {
  const T = julianCenturies(date);
  const eta = (47.0029 * T - 0.03302 * T * T + 0.000060 * T ** 3) * RAD / 3600;
  const Pi = (174.876384 + (-869.8089 * T + 0.03536 * T * T) / 3600) * RAD;
  const p = (5029.0966 * T + 1.11113 * T * T - 0.000006 * T ** 3) / 3600;
  const A = Math.cos(eta) * (Math.sin(Pi) * x - Math.cos(Pi) * y) - Math.sin(eta) * z;
  const B = Math.cos(Pi) * x + Math.sin(Pi) * y;
  return norm360(p + (Pi - Math.atan2(A, B)) / RAD);
}
function planetLongitude(body, date, e = helioRect("earth", date)) {
  const p = helioRect(body, date);
  return tropicalLongitudeOfDate(p.x - e.x, p.y - e.y, p.z - e.z, date);
}
/* Simplified lunar longitude: mean longitude plus the main perturbation
   terms (evection, variation, equation of centre...). Against JPL
   Horizons 2000-2050: P95 0.18°, max 0.32° (docs/ephemeris-accuracy.md). */
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

/* Placements for the seven bodies at the requested instant. Use a short
   symmetric difference to estimate apparent geocentric longitude velocity
   at that instant, rather than averaging across a future station. */
const HORO_BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
const HORO_VELOCITY_HALF_DAYS = 1 / 24;
function longitudeVelocity(before, after, halfDays = HORO_VELOCITY_HALF_DAYS) {
  return norm180(after - before) / (2 * halfDays);
}
function planetPositions(date) {
  const halfWindow = DAY_MS * HORO_VELOCITY_HALF_DAYS;
  const epochs = [-halfWindow, 0, halfWindow].map(offset => new Date(date.valueOf() + offset));
  // Share the Earth vector among all planets at each of the three epochs.
  const earth = epochs.map(t => helioRect("earth", t));
  return HORO_BODIES.map(key => {
    const [before, lon, after] = epochs.map((t, i) => key === "sun" ? sunLongitude(t) :
      key === "moon" ? moonLongitude(t) : planetLongitude(key, t, earth[i]));
    const velocity = longitudeVelocity(before, after);
    return { key, lon, signIdx: signIndexFromLongitude(lon),
      retrograde: key !== "sun" && key !== "moon" && velocity < 0, velocity };
  });
}

/* ---- Calendar-day sky events (the same approximate tropical ephemeris) ----
   The Sun and five classical planets get sign-ingress events, including
   backward crossings. For planets we also detect the two station types.
   Ordinary lunar sign changes are intentionally not treated as special.
   Exact major aspects include all seven bodies, with separate card priority.
   Local days are half-open [midnight, next midnight), including DST days.
   The numerical event time is for ordering/day ownership, NOT a claim
   of precise observational timing. */
const HORO_EVENT_BODIES = ["sun", "mercury", "venus", "mars", "jupiter", "saturn"];
function detectHoroscopeEvents(start, end, positionsAt = planetPositions, includeAspects = true, cache = new Map()) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const position = (body, time) => {
    if (!cache.has(time)) cache.set(time, positionsAt(new Date(time)));
    return cache.get(time).find(p => p.key === body);
  };
  // Include the instant before midnight to assign a crossing at midnight
  // to the new day; exclude the next midnight from this day's interval.
  const ticks = [start - 1, start];
  for (let time = start + DAY_MS / 8; time < end - 1; time += DAY_MS / 8) ticks.push(time);
  if (ticks[ticks.length - 1] < end - 1) ticks.push(end - 1);
  const firstChange = (lo, hi, read, oldValue) => {
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (read(mid) === oldValue) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const events = [];
  for (const body of HORO_EVENT_BODIES) {
    const read = time => position(body, time);
    const stationTicks = [];
    if (body !== "sun") {
      for (let i = 1; i < ticks.length; i++) {
        const lo = ticks[i - 1], hi = ticks[i];
        const wasRetrograde = read(lo).retrograde;
        if (wasRetrograde === read(hi).retrograde) continue;
        const at = firstChange(lo, hi, time => read(time).retrograde, wasRetrograde);
        events.push({ type: wasRetrograde ? "retrogradeEnd" : "retrogradeStart", body, at, signIdx: read(at).signIdx });
        // Split the ingress search at the station, so a short excursion
        // across a sign boundary and back between coarse samples is not
        // lost merely because the two outer signs match.
        stationTicks.push(at - 1, at);
      }
    }
    const signTicks = [...new Set([...ticks, ...stationTicks])].sort((a,b) => a - b);
    for (let i = 1; i < signTicks.length; i++) {
      const lo = signTicks[i - 1], hi = signTicks[i];
      const fromSignIdx = read(lo).signIdx, toSignIdx = read(hi).signIdx;
      if (fromSignIdx === toSignIdx) continue;
      const at = firstChange(lo, hi, time => read(time).signIdx, fromSignIdx);
      const entered = read(at).signIdx;
      events.push({ type: "ingress", body, at, fromSignIdx, toSignIdx: entered,
        backward: (entered - fromSignIdx + 12) % 12 === 11 });
    }
  }
  if (includeAspects) events.push(...detectExactHoroscopeAspects(start, end, position));
  return events.sort((a,b) => a.at - b.at || HORO_BODIES.indexOf(a.body) - HORO_BODIES.indexOf(b.body));
}
/* Unwrap signed relative longitude within each short interval. Refine
   the phase extremum at a relative station so a brief approach and
   return can yield two separate roots. Approximate numerical epochs
   are for day ownership and quadrature, not observed event times. */
function detectExactHoroscopeAspects(start, end, position) {
  const ticks = [start - 1, start];
  for (let at = start + DAY_MS / 24; at < end - 1; at += DAY_MS / 24) ticks.push(at);
  if (ticks[ticks.length - 1] < end - 1) ticks.push(end - 1);
  const targets = [0, 60, 90, 120, 180, 240, 270, 300];
  const bodies = HORO_BODIES.slice().sort();
  const events = new Map();
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const body = bodies[i], other = bodies[j], pair = body + "/" + other;
    const relative = at => position(body, at)?.lon - position(other, at)?.lon;
    const longitude = at => norm360(relative(at));
    // Evaluate the signed residual directly: adding an unwrapped delta to
    // its origin can leave a tiny nonzero value at an exact midnight root.
    const residual = (at, target) => {
      const delta = relative(at) - target;
      return delta - 360 * Math.round(delta / 360);
    };
    const speed = at => position(body, at)?.velocity - position(other, at)?.velocity;
    if (!Number.isFinite(longitude(start)) || !Number.isFinite(speed(start))) continue;
    for (let k = 1; k < ticks.length; k++) {
      const lo = ticks[k - 1], hi = ticks[k], origin = longitude(lo);
      const phase = at => origin + norm180(longitude(at) - origin);
      const cuts = [lo, hi];
      const v0 = speed(lo), v1 = speed(hi);
      if (hi - lo > 2 && v0 * v1 < 0) {
        const direction = v0 > 0 ? 1 : -1;
        let left = lo, right = hi;
        while (right - left > 4) {
          const m1 = left + Math.floor((right - left) / 3);
          const m2 = right - Math.floor((right - left) / 3);
          if (direction * phase(m1) < direction * phase(m2)) left = m1;
          else right = m2;
        }
        let extremum = left;
        for (let at = left + 1; at <= right; at++)
          if (direction * phase(at) > direction * phase(extremum)) extremum = at;
        if (extremum > lo && extremum < hi) cuts.splice(1, 0, extremum);
      }
      for (let n = 1; n < cuts.length; n++) {
        const a = cuts[n - 1], b = cuts[n];
        for (const target of targets) {
          const from = residual(a, target), to = residual(b, target);
          if (Math.abs(to - from) >= 180) continue; // opposite-side wrap, not a root
          const rising = from < 0 && to >= 0;
          const falling = from > 0 && to <= 0;
          if (!rising && !falling) continue;
          let left = a, right = b;
          while (right - left > 1) {
            const mid = left + Math.floor((right - left) / 2);
            if (rising ? residual(mid, target) < 0 : residual(mid, target) > 0) left = mid;
            else right = mid;
          }
          if (right < start || right >= end) continue;
          const angle = Math.min(target, 360 - target);
          events.set(pair + "/" + angle + "/" + right,
            { type: "aspect", body, other, pair, angle, at: right });
        }
      }
    }
  }
  return [...events.values()];
}
let horoscopeEventCache = null;
function horoscopeEventsForDate(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).valueOf();
  // Shared by all twelve signs; bounded to one day and keyed by actual
  // local-day endpoints so timezone changes cannot reuse the wrong day.
  if (!horoscopeEventCache || horoscopeEventCache.start !== start || horoscopeEventCache.end !== end) {
    horoscopeEventCache = { start, end, events: Object.freeze(detectHoroscopeEvents(start, end).map(Object.freeze)) };
  }
  return horoscopeEventCache.events;
}

/* Entertainment rules, not a scientifically validated prediction. All
   houses below are whole-sign SOLAR houses (Sun sign = house 1), not natal
   houses or the ascendant. Only the seven traditional bodies are used. */
const HORO_RULERS = ["mars", "venus", "mercury", "moon", "sun", "mercury",
  "venus", "mars", "jupiter", "saturn", "saturn", "jupiter"];
const HORO_ASPECTS = [
  { angle: 0, orb: 6, zh: "合相", en: "conjunction", kind: "conjunction" },
  { angle: 60, orb: 5, zh: "六合", en: "sextile", kind: "support" },
  { angle: 90, orb: 6, zh: "四分相", en: "square", kind: "challenge" },
  { angle: 120, orb: 6, zh: "三分相", en: "trine", kind: "support" },
  { angle: 180, orb: 6, zh: "对冲", en: "opposition", kind: "challenge" },
];
const HORO_DOMAINS = [
  { key: "love", zh: "情感", en: "Love", bodies: ["venus", "moon"], houses: [5, 7],
    items: [4, 12, 19, 17] },
  { key: "work", zh: "事业", en: "Work", bodies: ["sun", "mars", "saturn"], houses: [6, 10],
    items: [1, 7, 8, 14] },
  { key: "money", zh: "财务", en: "Money", bodies: ["venus", "jupiter", "saturn"], houses: [2, 8],
    items: [0, 5, 8, 14] },
  { key: "social", zh: "人际", en: "Social", bodies: ["mercury", "moon", "jupiter"], houses: [3, 7, 11],
    items: [2, 13, 16, 21] },
];
/* Editorial interpretation vocabulary. Every phrase is bilingual and tied
   to a computed input; these are symbolic reflection prompts, not causal
   claims or predictions. The scoring weights above/below stay independent. */
const HORO_BODY_THEMES = {
  sun: ["目标、意愿与自我表达", "purpose, intention and self-expression"],
  moon: ["感受、安全感与日常需求", "feelings, security and everyday needs"],
  mercury: ["沟通、学习与信息核对", "communication, learning and checking information"],
  venus: ["关系、价值取舍与审美", "relationships, values and appreciation"],
  mars: ["行动、勇气与冲突处理", "action, courage and handling friction"],
  jupiter: ["成长、视野与期望", "growth, perspective and expectations"],
  saturn: ["责任、时间与界限", "responsibility, time and boundaries"],
};
// Indexed by solar whole-sign house, NOT the observer's natal houses.
const HORO_HOUSE_THEMES = [
  { theme: ["个人选择与自我定位", "identity and personal choices"], action: ["厘清自己的需求和决定权", "clarify your own needs and choices"] },
  { theme: ["个人资源与价值观", "personal resources and values"], action: ["区分真正重要的事与一时的偏好", "distinguish enduring priorities from passing preferences"] },
  { theme: ["交流、学习与身边的人", "communication, learning and everyday contacts"], action: ["把关键信息说清楚并听取反馈", "communicate essential details clearly and invite feedback"] },
  { theme: ["家庭、归属与私人空间", "home, belonging and private life"], action: ["留意熟悉环境中的感受与实际需求", "notice feelings and practical needs in familiar surroundings"] },
  { theme: ["创造力、兴趣与亲密表达", "creativity, enjoyment and affectionate expression"], action: ["给轻松而有创造性的表达留一点时间", "make room for playful or creative expression"] },
  { theme: ["日常习惯、工作流程与照料", "daily habits, routines and care"], action: ["从一件具体、可完成的小事开始", "start with one practical, manageable step"] },
  { theme: ["伙伴关系、协商与承诺", "partnership, negotiation and commitments"], action: ["与相关的人确认彼此期待和界限", "clarify mutual expectations and boundaries"] },
  { theme: ["共享资源、信任与深层议题", "shared resources, trust and deeper concerns"], action: ["先厘清共同承担的事项及责任", "clarify shared obligations and responsibilities first"] },
  { theme: ["学习、长远视野与信念", "learning, wider perspectives and beliefs"], action: ["核对自己的假设，并考虑另一种视角", "check your assumptions and consider another perspective"] },
  { theme: ["目标、角色与公共责任", "goals, roles and public responsibilities"], action: ["明确自己承担的角色及下一步目标", "clarify your role and next realistic goal"] },
  { theme: ["友谊、团体与共同愿望", "friendship, groups and shared aspirations"], action: ["寻找能够互相支持的共同目标", "look for shared goals that allow mutual support"] },
  { theme: ["独处、休整与内在整理", "solitude, rest and private reflection"], action: ["留出一点安静时间整理尚未解决的事", "set aside quiet time to reflect on unfinished concerns"] },
];
// Domain × strongest contributing body: the actual action changes even
// when two days have the same rounded star rating or overall tone.
// Every tone has the same number of wording frames, so the date-seeded
// frame index does not depend on which tone a domain ends up with.
const HORO_ADVICE_VARIANTS = 2;
const HORO_ADVICE_FRAMES = {
  support: [["不妨{action}。", "Consider making time to {action}."], ["可以试着{action}。", "Take the opportunity to {action}."]],
  neutral: [["今天可以{action}。", "Today, aim to {action}."], ["可把注意力放在这件事上：{action}。", "One useful focus today is to {action}."]],
  challenge: [["不必急于求成，{action}。", "Rather than rushing, take time to {action}."], ["遇到阻力时，不妨{action}。", "If you encounter friction, try to {action}."]],
};
const HORO_ASPECT_ACTIONS = {
  60: ["寻找两者可以配合的小机会，并先做一次小尝试", "look for a small opportunity to combine the two themes and try it on a modest scale"],
  90: ["把两种需求分开看，先处理具体的摩擦点", "separate the two needs and address a specific point of friction first"],
  120: ["寻找两种主题相互支持的方式，并落实到可行的小事上", "look for ways the two themes can reinforce each other in a manageable action"],
  180: ["兼顾两种需求，避免急于站到任何一端", "consider both needs without rushing to choose one extreme"],
};
const HORO_CONJUNCTION_ACTIONS = {
  support: ["两个主题可以相互配合，寻找一件能够共同推进的小事", "the two themes may complement each other; identify one small way to advance both"],
  challenge: ["留意两个主题叠加的压力，避免一味加码", "notice the combined demands of the two themes and avoid taking on too much"],
  neutral: ["两个主题值得同时关注，但不把合相本身视为吉凶", "consider both themes together without treating the conjunction itself as favorable or unfavorable"],
};
const HORO_RETROGRADE_ACTIONS = {
  mercury: ["重新核对表述、时间和已知信息", "recheck wording, timing and known information"],
  venus: ["回顾已有的关系、偏好与价值取舍", "review existing relationships, preferences and value judgments"],
  mars: ["复盘行动顺序，重新安排速度与精力", "review the order of actions and reconsider pace and effort"],
  jupiter: ["检查较大的期望与计划是否符合实际资源", "check whether larger expectations and plans match actual resources"],
  saturn: ["重新审视已有责任、期限与界限", "review existing responsibilities, deadlines and boundaries"],
};
const HORO_ELEMENT_CUES = {
  fire: { colors: [0, 6, 14, 17], dirs: [1, 2, 3] },
  earth: { colors: [3, 9, 14, 16], dirs: [5, 6, 7] },
  air: { colors: [1, 2, 10, 12], dirs: [7, 0, 1] },
  water: { colors: [4, 7, 12, 15], dirs: [3, 4, 5] },
};
/* Nearest oriented exact branch is stable at conjunction/opposition;
   reversing the bodies flips both residual and relative speed. */
function horoscopeAspectResidual(delta, angle) {
  const positive = norm180(delta - angle), negative = norm180(delta + angle);
  return Math.abs(positive) <= Math.abs(negative) ? positive : negative;
}
function horoscopeSmoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}
function horoscopeAspect(a, b) {
  const delta = norm180(a.lon - b.lon);
  for (const rule of HORO_ASPECTS) {
    const residual = horoscopeAspectResidual(delta, rule.angle);
    const deviation = Math.abs(residual);
    if (deviation > rule.orb) continue;
    const cfg = HORO_MODEL.aspectDynamics;
    const relativeSpeed = Number.isFinite(a.velocity) && Number.isFinite(b.velocity)
      ? a.velocity - b.velocity : null;
    let state = null, dynamicWeight = 1;
    // Missing velocities cannot justify a motion label; use neutral weight.
    if (relativeSpeed !== null) {
      const speed = Math.abs(relativeSpeed), applying = residual * relativeSpeed < 0;
      state = deviation <= cfg.exactTolerance ? "exact" :
        speed <= cfg.stationaryTolerance ? "stationary" : applying ? "applying" : "separating";
      const speedMix = horoscopeSmoothstep((speed - cfg.stationaryTolerance) /
        (cfg.speedBlend - cfg.stationaryTolerance));
      const directional = cfg.stationary + speedMix *
        ((applying ? cfg.applying : cfg.separating) - cfg.stationary);
      const distanceMix = horoscopeSmoothstep((deviation - cfg.exactTolerance) /
        (cfg.exactBlend - cfg.exactTolerance));
      dynamicWeight = cfg.exact + distanceMix * (directional - cfg.exact);
    }
    return { angle: rule.angle, separation: Math.abs(delta), orb: rule.orb, deviation, strength: 1 - deviation / rule.orb,
      zh: rule.zh, en: rule.en, kind: rule.kind, relativeSpeed, state, dynamicWeight };
  }
  return null;
}

const HORO_PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn"];
function horoscopeV31AspectValue(aspect, a, b) {
  const strength = aspect.strength * (aspect.dynamicWeight ?? 1);
  if (aspect.kind === "support") return 0.65 * strength;
  if (aspect.kind === "challenge") return -0.85 * strength;
  // A planet conjunct the Sun is read through combustion/cazimi instead
  // (horoscopeSolarCondition), so the same closeness is not scored twice.
  if ((a.key === "sun" && HORO_PLANETS.includes(b.key)) ||
      (b.key === "sun" && HORO_PLANETS.includes(a.key))) return 0;
  // A conjunction is contextual, not automatically favorable.
  const keys = [a.key, b.key];
  const favorable = keys.filter(k => k === "venus" || k === "jupiter").length;
  const demanding = keys.filter(k => k === "mars" || k === "saturn").length;
  return 0.55 * (favorable - demanding) * strength;
}
/* V3.2: independently switchable scales. Zero restores the original
   domain membership/weights and V3.1 aspect contributions. */
const HORO_V32 = Object.freeze({
  houseRulerScale: 0.2, combinationScale: 0.5,
});
const HORO_V31 = Object.freeze({ houseRulerScale: 0, combinationScale: 0 });
const HORO_ROLE_WEIGHTS = Object.freeze({
  natural: 1, other: 0.6, solarRuler: 0.5,
  houseRoles: Object.freeze([0.30, 0.15, 0.05]), houseCap: 0.45, max: 1.95,
});
// Sparse symmetric table; unspecified pairs/angles (including conjunctions)
// are neutral. Coefficients multiply the existing signed V3.1 value once.
const HORO_PAIR_WEIGHTS = Object.freeze({
  "jupiter/venus": Object.freeze({60:1.06, 90:0.96, 120:1.10, 180:1.02}),
  "mars/saturn": Object.freeze({60:1.04, 90:1.10, 120:1.08, 180:1.08}),
  "mercury/saturn": Object.freeze({60:1.08, 90:1.04, 120:1.06, 180:1.04}),
  "moon/venus": Object.freeze({60:1.06, 120:1.08}),
  "mars/mercury": Object.freeze({60:1.04, 90:1.06, 120:1.04, 180:1.06}),
  "jupiter/saturn": Object.freeze({60:1.04, 90:1.06, 120:1.04, 180:1.06}),
});
function horoscopePairId(a, b) {
  return [a, b].sort().join("/");
}
function horoscopeCombinationWeight(a, b, angle, model = HORO_V32) {
  const configured = HORO_PAIR_WEIGHTS[horoscopePairId(a, b)]?.[angle] ?? 1;
  return 1 + (configured - 1) * model.combinationScale;
}
function horoscopeAspectValue(aspect, a, b, model = HORO_V32) {
  return horoscopeV31AspectValue(aspect, a, b) *
    horoscopeCombinationWeight(a.key, b.key, aspect.angle, model);
}
function horoscopeHouseRulers(signIdx, domain) {
  return domain.houses.map(house => {
    const sign = (signIdx + house - 1) % 12;
    return { house, signIdx: sign, ruler: HORO_RULERS[sign] };
  });
}
function horoscopeRoleWeight(signIdx, domain, key, model = HORO_V32) {
  const cfg = HORO_ROLE_WEIGHTS;
  const natural = domain.bodies.includes(key), solarRuler = HORO_RULERS[signIdx] === key;
  const houses = model.houseRulerScale > 0 ?
    horoscopeHouseRulers(signIdx, domain).filter(h => h.ruler === key) : [];
  if (!natural && !solarRuler && !houses.length) return null;
  const baseWeight = natural ? cfg.natural : solarRuler ? cfg.other : cfg.other * model.houseRulerScale;
  const solarExtra = solarRuler ? cfg.solarRuler : 0;
  let remaining = Math.min(cfg.houseCap, cfg.max - baseWeight - solarExtra);
  const houseRoles = houses.map((house, i) => {
    const extra = Math.min(remaining, (cfg.houseRoles[i] ?? 0) * model.houseRulerScale);
    remaining -= extra;
    return { ...house, extra };
  });
  const houseExtra = houseRoles.reduce((sum, h) => sum + h.extra, 0);
  return { natural, solarRuler, baseWeight, solarExtra, houseRoles, houseExtra,
    weight: baseWeight + solarExtra + houseExtra };
}
/* Editorial weights of the traditional-inspired model (v3.1 dynamics). Kept in one
   table so the distribution simulation and tests can reason about them. */
const HORO_MODEL = {
  // Jupiter and Saturn stay in one sign for one to three years. Their
  // placement terms (solar-house relation, house-topic bonus and essential
  // dignity) are damped so a single slow placement cannot fix a sign's
  // tone for a whole year. Their aspects still count in full.
  placementScale: { jupiter: 0.4, saturn: 0.4 },
  // Saturn is retrograde about 37% and Jupiter about 30% of the time, so a
  // uniform penalty would turn a passing caution into a standing one.
  retrograde: { mercury: 0.5, venus: 0.5, mars: 0.45, jupiter: 0.2, saturn: 0.2 },
  // Essential dignity (tropical, traditional rulerships and exaltations).
  dignity: { domicile: 0.25, exaltation: 0.2, detriment: -0.25, fall: -0.2 },
  // Combustion: a planet within 8.5° of the Sun is weakened, scaled by
  // closeness; within 17′ (cazimi) it is traditionally strengthened.
  combustOrb: 8.5, combust: -0.35, cazimiOrb: 17 / 60, cazimi: 0.3,
  houseBonus: 0.35,
  aspectDynamics: {
    applying: 1.10, exact: 1.15, separating: 0.90, stationary: 1.00,
    exactTolerance: 0.05, exactBlend: 0.75, // degrees
    stationaryTolerance: 0.01, speedBlend: 0.05, // degrees/day
  },
  // raw score → 1..5 stars around 3.
  starScale: 2.0,
  // Midpoints of four equal elapsed-time intervals of the local civil day.
  // Split at approximate ingresses/stations, including lunar ingresses.
  dayIntervals: 4,
};
const HORO_EXALTATION_SIGNS = { sun: 0, moon: 1, mercury: 5, venus: 11, mars: 9, jupiter: 3, saturn: 6 };
const HORO_CONDITION_LABELS = {
  domicile: ["入庙", "domicile"], exaltation: ["擢升", "exalted"],
  detriment: ["失势", "detriment"], fall: ["落陷", "fall"],
  combust: ["灼伤", "combust"], cazimi: ["日核", "cazimi"],
};
/* Domicile = the signs a body rules (HORO_RULERS); detriment is the
   opposite sign; fall is opposite the exaltation. Mercury in Virgo is both
   domicile and exalted; in Pisces both detriment and fall. */
function horoscopeDignity(key, signIdx) {
  const conditions = [];
  if (HORO_RULERS[signIdx] === key) conditions.push("domicile");
  if (HORO_EXALTATION_SIGNS[key] === signIdx) conditions.push("exaltation");
  if (HORO_RULERS[(signIdx + 6) % 12] === key) conditions.push("detriment");
  if ((HORO_EXALTATION_SIGNS[key] + 6) % 12 === signIdx) conditions.push("fall");
  return { conditions, value: conditions.reduce((s, c) => s + HORO_MODEL.dignity[c], 0) };
}
function horoscopeSolarCondition(p, positions) {
  const sun = positions.find(q => q.key === "sun");
  if (!sun || !HORO_PLANETS.includes(p.key)) return null;
  const distance = Math.abs(norm180(p.lon - sun.lon));
  if (distance <= HORO_MODEL.cazimiOrb) return { kind: "cazimi", distance, value: HORO_MODEL.cazimi };
  if (distance <= HORO_MODEL.combustOrb) return { kind: "combust", distance,
    value: HORO_MODEL.combust * (1 - distance / HORO_MODEL.combustOrb) };
  return null;
}
function horoscopeStars(raw) {
  return Math.max(1, Math.min(5, Math.round(3 + raw * HORO_MODEL.starScale)));
}
function horoscopeTone(raw) {
  return raw >= 0.28 ? "support" : raw <= -0.28 ? "challenge" : "neutral";
}
/* Cache pair geometry across signs only for immutable sky snapshots.
   Allocate the signed net aspect cap proportionally for an additive audit. */
const horoscopeAspectCache = new WeakMap();
// Geometry is sign/domain independent. Canonical orientation is lexical;
// endpoint projections retain the old endpoint-relative velocity sign.
function horoscopePairRecords(positions) {
  const records = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const [a, b] = [positions[i], positions[j]].sort((x,y) => x.key < y.key ? -1 : 1);
      const aspect = horoscopeAspect(a, b);
      records.push(Object.freeze({
        pair: horoscopePairId(a.key, b.key), bodies: Object.freeze([a.key,b.key]),
        separation: Math.abs(norm180(a.lon - b.lon)),
        relativeSpeed: Number.isFinite(a.velocity) && Number.isFinite(b.velocity) ? a.velocity-b.velocity : null,
        aspect: aspect && Object.freeze(aspect),
        valueBeforeDynamics: aspect ? horoscopeV31AspectValue({...aspect, dynamicWeight:1},a,b) : 0,
        valueBeforeCombination: aspect ? horoscopeV31AspectValue(aspect,a,b) : 0,
      }));
    }
  }
  return Object.freeze(records);
}
function horoscopeSnapshotAspects(positions, model = HORO_V32) {
  const immutable = Object.isFrozen(positions) && positions.every(Object.isFrozen);
  let entry = immutable ? horoscopeAspectCache.get(positions) : null;
  if (!entry) {
    entry = { pairs: horoscopePairRecords(positions), variants: new Map() };
    if (immutable) horoscopeAspectCache.set(positions, entry);
  }
  const key = model.combinationScale;
  if (entry.variants.has(key)) return entry.variants.get(key);
  const byBody = new Map(positions.map(p => [p.key, {aspects:[],total:0}]));
  for (const record of entry.pairs) {
    if (!record.aspect) continue;
    const [a,b] = record.bodies;
    const combinationWeight = horoscopeCombinationWeight(a,b,record.aspect.angle,model);
    const value = record.valueBeforeCombination * combinationWeight;
    for (const [body,other] of [[a,b],[b,a]]) {
      const relativeSpeed = record.relativeSpeed === null ? null :
        body === a ? record.relativeSpeed : -record.relativeSpeed;
      byBody.get(body).aspects.push({ ...record.aspect, relativeSpeed, body, other,
        pair:record.pair, pairRecord:record, combinationWeight,
        valueBeforeDynamics:record.valueBeforeDynamics,
        valueBeforeCombination:record.valueBeforeCombination, value });
    }
  }
  for (const result of byBody.values()) {
    result.aspects.sort((a,b) => Math.abs(b.value)-Math.abs(a.value) || a.deviation-b.deviation);
    const sum = result.aspects.reduce((total,a) => total+a.value,0);
    result.total = Math.max(-0.9, Math.min(0.9,sum));
    const scale = sum === 0 ? 1 : result.total/sum;
    result.aspects = Object.freeze(result.aspects.map(a=>Object.freeze({...a,cappedValue:a.value*scale})));
    Object.freeze(result);
  }
  // Only the shared immutable sky cache retains variants; bound experiments.
  if (immutable) {
    if (entry.variants.size >= 4) entry.variants.delete(entry.variants.keys().next().value);
    entry.variants.set(key,byBody);
  }
  return byBody;
}
function horoscopeBodyAspects(p, positions, model = HORO_V32) {
  return horoscopeSnapshotAspects(positions,model).get(p.key);
}
/* One body's state against the selected solar sign in one snapshot. */
function horoscopeBodyState(p, positions, signIdx, model = HORO_V32, snapshot = null) {
  const house = (p.signIdx - signIdx + 12) % 12 + 1;
  const distance = Math.min(house - 1, 13 - house);
  const relation = [0.55, 0, 0.55, -0.8, 0.95, 0, -0.85][distance];
  const { aspects, total: aspectValue } = snapshot ? snapshot.get(p.key) : horoscopeBodyAspects(p, positions, model);
  const dignity = horoscopeDignity(p.key, p.signIdx);
  const solar = horoscopeSolarCondition(p, positions);
  const scale = HORO_MODEL.placementScale[p.key] ?? 1;
  const retrograde = p.retrograde ? HORO_MODEL.retrograde[p.key] ?? 0 : 0;
  const components = {
    relation: scale * relation, dignity: scale * dignity.value,
    aspect: aspectValue, solar: solar ? solar.value : 0, retrograde: -retrograde,
  };
  const base = scale * (relation + dignity.value) + aspectValue + (solar ? solar.value : 0) - retrograde;
  return { house, aspects, dignity: dignity.conditions, solar, base, components, placementScale: scale };
}
/* Pure scoring of one coherent sky snapshot. Every body's aspects see
   exactly the same positions. Relative motion weights aspect strength;
   other factors and the star conversion are unchanged. */
const HORO_FACTORS = ["relation", "dignity", "aspect", "solar", "retrograde", "house"];
const horoscopeFactorTotal = components => HORO_FACTORS.reduce((sum, key) => sum + components[key], 0);
function horoscopeFocus(p, aspects = p.aspects) {
  return { key: p.key, signIdx: p.signIdx, house: p.house, retrograde: p.retrograde,
    dignity: p.dignity, solar: p.solar ? p.solar.kind : null, aspect: aspects[0] || null };
}
function horoscopeDomainResult(key, contributions) {
  const raw = contributions.reduce((sum, term) => sum + term.value, 0);
  const driver = contributions.reduce((best, term) =>
    Math.abs(term.value) > Math.abs(best.value) ? term : best);
  return { key, raw, stars: horoscopeStars(raw), contributions, focus: driver.focus };
}
function horoscopeRatingResult(domains) {
  const raw = domains.reduce((sum, d) => sum + d.raw, 0) / domains.length;
  const primary = domains.reduce((best, d) => Math.abs(d.raw) > Math.abs(best.raw) ? d : best);
  return { raw, stars: horoscopeStars(raw), domains, primary: primary.key, focus: primary.focus,
    tone: horoscopeTone(primary.raw) };
}
function weightedHoroscopeAspect(a, contribution, sampleAt) {
  return { angle:a.angle, deviation:a.deviation, strength:a.strength, zh:a.zh, en:a.en,
    kind:a.kind, relativeSpeed:a.relativeSpeed, state:a.state, dynamicWeight:a.dynamicWeight,
    body:a.body, other:a.other, pair:a.pair, pairRecord:a.pairRecord, separation:a.separation, orb:a.orb,
    combinationWeight:a.combinationWeight, valueBeforeDynamics:a.valueBeforeDynamics,
    valueBeforeCombination:a.valueBeforeCombination, value:a.value, cappedValue:a.cappedValue,
    contribution, sampleAt };
}
function scoreHoroscope(signIdx, positions, model = HORO_V32) {
  const snapshot = horoscopeSnapshotAspects(positions, model);
  const planets = positions.map(p => ({ ...p, ...horoscopeBodyState(p, positions, signIdx, model, snapshot) }));
  const domains = HORO_DOMAINS.map(domain => {
    const weighted = planets.map(p => ({p, role:horoscopeRoleWeight(signIdx,domain,p.key,model)}))
      .filter(term => term.role && term.role.weight > 0);
    const totalWeight = weighted.reduce((sum, term) => sum + term.role.weight, 0);
    const contributions = weighted.map(({p, role}) => {
      const share = role.weight / totalWeight;
      const factors = { ...p.components,
        house: domain.houses.includes(p.house) ? p.placementScale * HORO_MODEL.houseBonus : 0 };
      const components = Object.fromEntries(HORO_FACTORS.map(key => [key, factors[key] * share]));
      const aspects = p.aspects.map(a => weightedHoroscopeAspect(a, a.cappedValue * share));
      return { key: p.key, role, share, value: horoscopeFactorTotal(components), components, aspects,
        focus: horoscopeFocus(p, aspects) };
    });
    return horoscopeDomainResult(domain.key, contributions);
  });
  return horoscopeRatingResult(domains);
}

/* Split the actual elapsed local day, not a nominal 24-hour UTC day.
   Equal-width midpoint quadrature includes the night; split intervals at
   known discontinuities so short-lived pre/post-event states get their
   correct duration share. The event epochs themselves are approximate. */
function horoscopeSamplePlan(start, end, cuts = []) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const edges = [...new Set([
    start, end,
    ...Array.from({length: HORO_MODEL.dayIntervals - 1}, (_, i) =>
      Math.round(start + (end - start) * (i + 1) / HORO_MODEL.dayIntervals)),
    ...cuts.filter(at => Number.isFinite(at) && at > start && at < end).map(Math.round),
  ])].sort((a,b) => a - b);
  return edges.slice(1).map((to, i) => {
    const from = edges[i];
    return { from, to, at: from + Math.floor((to - from) / 2), weight: (to - from) / (end - start) };
  });
}
function horoscopeSampleLabel(at) {
  const date = new Date(at), offset = -date.getTimezoneOffset();
  const pad = n => String(n).padStart(2, "0");
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) +
    " UTC" + (offset < 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60)) + ":" + pad(Math.abs(offset) % 60);
}
/* The Moon's routine ingress is a scoring boundary, not a special card
   event. On one civil day its longitude moves monotonically by <30°. */
function horoscopeMoonIngress(start, end) {
  const signAt = at => signIndexFromLongitude(moonLongitude(new Date(at)));
  const first = signAt(start);
  if (first === signAt(end - 1)) return null;
  let lo = start, hi = end - 1;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (signAt(mid) === first) lo = mid;
    else hi = mid;
  }
  return hi;
}
const horoscopeSkyCache = new Map();
function horoscopeSky(date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const start = new Date(y,m,d).valueOf(), end = new Date(y,m,d+1).valueOf();
  const key = start + "/" + end;
  if (horoscopeSkyCache.has(key)) {
    const cached = horoscopeSkyCache.get(key);
    horoscopeSkyCache.delete(key);
    horoscopeSkyCache.set(key, cached);
    return cached;
  }
  const cache = new Map();
  const boundaryEvents = detectHoroscopeEvents(start, end, planetPositions, false, cache);
  const moonIngress = horoscopeMoonIngress(start, end);
  const cuts = boundaryEvents.map(event => event.at);
  if (moonIngress !== null) cuts.push(moonIngress);
  const samples = horoscopeSamplePlan(start, end, cuts).map(sample => Object.freeze({
    ...sample, label: horoscopeSampleLabel(sample.at),
    positions: Object.freeze(planetPositions(new Date(sample.at)).map(Object.freeze)),
  }));
  let events;
  const sky = Object.freeze({ start, end, get events() {
    if (!events) {
      const position = (body, at) => {
        if (!cache.has(at)) cache.set(at, planetPositions(new Date(at)));
        return cache.get(at).find(p => p.key === body);
      };
      events = Object.freeze([...boundaryEvents, ...detectExactHoroscopeAspects(start, end, position)]
        .sort((a,b) => a.at - b.at || HORO_BODIES.indexOf(a.body) - HORO_BODIES.indexOf(b.body)).map(Object.freeze));
      cache.clear();
    }
    return events;
  }, boundaryEvents: Object.freeze(boundaryEvents.map(Object.freeze)), moonIngress, samples: Object.freeze(samples) });
  // A handful of civil days covers advice replay and all twelve signs.
  horoscopeSkyCache.set(key, sky);
  if (horoscopeSkyCache.size > 4) horoscopeSkyCache.delete(horoscopeSkyCache.keys().next().value);
  return sky;
}
/* Integrate unrounded, normalized contributions (never rounded stars).
   Each daily term retains its six additive factors and each sample's
   weighted value/evidence. Pick the strongest actual contributing sample
   in the direction of the integrated term; ties keep chronological order.
   Consequently displayed evidence is a real sampled sky, not a noon proxy. */
function scoreHoroscopeSamples(signIdx, samples, model = HORO_V32) {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  if (!samples.length || !Number.isFinite(totalWeight) || totalWeight <= 0 ||
      samples.some(sample => !Number.isFinite(sample.weight) || sample.weight <= 0))
    throw new RangeError("Invalid horoscope samples");
  const scored = samples.map(sample => ({
    ...sample, weight: sample.weight / totalWeight,
    score: scoreHoroscope(signIdx, sample.positions, model),
  }));
  const domains = HORO_DOMAINS.map((domain, i) => {
    const contributions = scored[0].score.domains[i].contributions.map(initial => {
      const terms = scored.map(sample => {
        const term = sample.score.domains[i].contributions.find(t => t.key === initial.key);
        const components = Object.fromEntries(HORO_FACTORS.map(key => [key, term.components[key] * sample.weight]));
        const aspects = term.aspects.map(a => weightedHoroscopeAspect(a, a.contribution * sample.weight, sample.at));
        return { at: sample.at, weight: sample.weight, value: horoscopeFactorTotal(components), components, aspects,
          focus: { ...term.focus, aspect: aspects[0] || null, sampleAt: sample.at, sampleLabel: sample.label } };
      });
      const components = Object.fromEntries(HORO_FACTORS.map(key =>
        [key, terms.reduce((sum, term) => sum + term.components[key], 0)]));
      const value = horoscopeFactorTotal(components);
      const strength = term => value === 0 ? Math.abs(term.value) : Math.sign(value) * term.value;
      const representative = terms.reduce((best, term) => strength(term) > strength(best) ? term : best);
      return { key: initial.key, role:initial.role, share:initial.share, value, components, focus: representative.focus, samples: terms };
    });
    return horoscopeDomainResult(domain.key, contributions);
  });
  return { ...horoscopeRatingResult(domains), samples: scored.map(({from,to,at,weight,label}) => ({from,to,at,weight,label})) };
}
function scoreHoroscopeDay(date, signIdx, model = HORO_V32) {
  return scoreHoroscopeSamples(signIdx, horoscopeSky(date).samples, model);
}
/* Context matching is restricted to the preassigned date window to
   guarantee a seven-day no-repeat interval without local storage, network
   calls or a replay of unbounded history. A stable per-sign/domain/body
   permutation partitions ten unique actions into windows of 3, 3, 2, 2.
   Each action belongs to exactly one window. Across successive ten-day
   cycles its closest possible recurrence is 10 - (3 - 1) = 8 days.
   Within a window we replay at most two earlier local-day integrated scores and
   remove any action already selected for the same domain/body. */
const HORO_ADVICE_WINDOW_ENDS = [3, 6, 8, 10];
const HORO_ADVICE_HOUSE_TAGS = [
  ["express","boundary","act"], ["resources","balance","detail"],
  ["express","detail","learn"], ["home","rest","connect"],
  ["creative","express","connect"], ["routine","detail","act"],
  ["connect","balance","boundary"], ["resources","reflect","boundary"],
  ["learn","plan","reflect"], ["plan","act","resources"],
  ["community","connect","learn"], ["rest","reflect","routine"],
];
const HORO_ADVICE_TONE_TAGS = {
  support: ["act","connect","creative"], neutral: ["routine","reflect","learn"],
  challenge: ["balance","boundary","detail"],
};
function horoscopeAdviceWeights(d) {
  const f = d.focus, weights = new Map();
  const add = (tags, weight) => {
    for (const tag of tags) weights.set(tag, (weights.get(tag) || 0) + weight);
  };
  add(HORO_ADVICE_HOUSE_TAGS[f.house - 1], 3);
  add(HORO_ADVICE_TONE_TAGS[horoscopeTone(d.raw)], 1);
  const contribution = d.contributions?.find(t => t.key === f.key)?.value ?? d.raw;
  add(HORO_ADVICE_TONE_TAGS[horoscopeTone(contribution === 0 ? 0 : Math.sign(contribution))], 2);
  if (f.retrograde) add(["reflect","detail","rest"], 3);
  if (f.aspect && f.aspect.strength > 0) {
    const a = f.aspect;
    const tags = a.angle === 0
      ? HORO_ADVICE_TONE_TAGS[horoscopeTone(Math.sign(a.value))]
      : a.angle === 60 ? ["act","connect","learn"]
      : a.angle === 120 ? ["creative","connect","act"]
      : a.angle === 90 ? ["balance","detail","reflect"]
      : ["balance","boundary","connect"];
    add(tags, 2 * a.strength);
  }
  return weights;
}
function bestHoroscopeAction(d, candidates) {
  const weights = horoscopeAdviceWeights(d);
  const score = action => action.tags.reduce((s,tag) => s + (weights.get(tag) || 0), 0);
  // Stable order breaks ties; presentation language never enters selection.
  return candidates.reduce((best, action) => score(action) > score(best) ? action : best);
}
function horoscopeActionOrder(signIdx, domain, body) {
  const pool = HORO_DOMAIN_ACTIONS[domain][body].slice();
  let hash = 2166136261;
  for (const c of `${signIdx}/${domain}/${body}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const rng = seededRng(hash >>> 0);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function horoscopeActionWindow(noon) {
  // Use civil-day numbers rather than elapsed local milliseconds, so the
  // sequence does not skip or repeat a slot during daylight saving changes.
  const ordinal = Math.floor(Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate()) / DAY_MS);
  const slot = ((ordinal % 10) + 10) % 10;
  const index = HORO_ADVICE_WINDOW_ENDS.findIndex(end => slot < end);
  const start = index === 0 ? 0 : HORO_ADVICE_WINDOW_ENDS[index - 1];
  return { start, end: HORO_ADVICE_WINDOW_ENDS[index], elapsed: slot - start };
}
function chooseHoroscopeActions(noon, signIdx, scored) {
  const window = horoscopeActionWindow(noon);
  const earlier = [];
  for (let back = window.elapsed; back > 0; back--) {
    const date = new Date(noon);
    date.setDate(date.getDate() - back);
    earlier.push(scoreHoroscopeDay(date, signIdx));
  }
  const choices = {};
  for (const d of scored.domains) {
    const candidates = horoscopeActionOrder(signIdx, d.key, d.focus.key).slice(window.start, window.end);
    for (const snapshot of earlier) {
      const prev = snapshot.domains.find(x => x.key === d.key);
      if (prev.focus.key !== d.focus.key) continue;
      const selected = bestHoroscopeAction(prev, candidates);
      candidates.splice(candidates.indexOf(selected), 1);
    }
    choices[d.key] = bestHoroscopeAction(d, candidates).id;
  }
  return choices;
}
function horoscopeActionFor(d, h) {
  const pool = HORO_DOMAIN_ACTIONS[d.key][d.focus.key];
  // Stored choices are authoritative for a real day's snapshot; fallback
  // keeps the pure presentation usable with injected score-only fixtures.
  return pool.find(action => action.id === h.actionChoices?.[d.key]) || bestHoroscopeAction(d, pool);
}
/* One local calendar day = one set of coherent weighted sky samples. Language,
   refresh time, Math.random, and lucky-cue choices cannot affect scores. */
function makeHoroscope(date, signIdx) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const sky = horoscopeSky(noon);
  const scored = scoreHoroscopeSamples(signIdx, sky.samples);
  const seed = (date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()) * 16 + signIdx;
  const rng = seededRng(seed);
  const choose = list => list[Math.floor(rng() * list.length)];
  const domain = HORO_DOMAINS.find(d => d.key === scored.primary);
  const cues = HORO_ELEMENT_CUES[SIGNS[signIdx].element];
  return { signIdx, ...scored, actionChoices: chooseHoroscopeActions(noon, signIdx, scored),
    cardEvents: sky.boundaryEvents,
    get events() { return sky.events; },
    adviceIdx: Math.floor(rng() * HORO_ADVICE_VARIANTS),
    // Symbolic entertainment cues, NOT astronomical predictions.
    luckyNumber: scored.focus.house + 12 * Math.floor(rng() * 8),
    colorIdx: choose(cues.colors), dirIdx: choose(cues.dirs), itemIdx: choose(domain.items) };
}
/* Localized presentation uses the stored calculation, never a new draw. */
function horoscopeFocusCopy(f, lang) {
  const zh = lang === "zh";
  const a = I18N[lang].astro;
  const body = a.bodies[f.key];
  const sign = SIGNS[f.signIdx][lang];
  const li = zh ? 0 : 1;
  const conditions = [...(f.dignity || []), ...(f.solar ? [f.solar] : [])]
    .map(c => HORO_CONDITION_LABELS[c][li]);
  const tags = conditions.map(c => " · " + (zh ? c : c[0].toUpperCase() + c.slice(1))).join("");
  const evidence = zh
    ? body + "位于" + sign + " · 太阳星座第" + f.house + "宫" + tags + (f.retrograde ? " · 逆行" : "")
    : body + " in " + sign + " · Solar house " + f.house + tags + (f.retrograde ? " · Retrograde" : "");
  const aspect = f.aspect
    ? (zh ? body + "与" + a.bodies[f.aspect.other] + f.aspect.zh
      : body + " / " + a.bodies[f.aspect.other] + " · " + f.aspect.en)
    : "";
  const prefix = f.sampleLabel ? (zh ? "代表采样约 " : "Representative sample ~") + f.sampleLabel + " · " : "";
  return { evidence: prefix + evidence, aspect };
}
/* Select a wording frame from the date seed, but derive the action and
   every explanatory sentence from the stored domain score and real focus.
   Aspect guidance describes that individual aspect, not the aggregate
   rating; a zero-strength orb boundary is explicitly non-contributing. */
function horoscopeAspectMotionCopy(f, lang) {
  const a = f.aspect;
  if (!a?.state) return "";
  const zh = lang === "zh", names = I18N[lang].astro.bodies;
  const timing = f.sampleAt != null ? (zh ? "在该代表采样时刻，" : "At this representative sample, ") :
    (zh ? "在该星位快照中，" : "In this sky snapshot, ");
  const motion = {
    applying: ["正在接近精确相位（入相）", "is approaching its exact angle (applying)"],
    separating: ["正在远离精确相位（出相）", "is moving away from its exact angle (separating)"],
    exact: ["处于近似精确相位容差内", "is within the near-exact angle tolerance"],
    stationary: ["相对运动极小，入相与出相暂不确定", "has very little relative motion; applying or separating is uncertain"],
  }[a.state];
  return zh ? timing + names[f.key] + "与" + names[a.other] + "的" + a.zh + motion[0] + "。"
    : timing + "the " + a.en + " between " + names[f.key] + " and " + names[a.other] + " " + motion[1] + ".";
}
// Localized pair-specific reflection prompts. Only displayed for a nonzero
// scored aspect whose configured multiplier actually changed its magnitude.
const HORO_PAIR_REFLECTIONS = {
  "jupiter/venus": {
    support:["在关系、享受与成长之间寻找适度的配合","look for a measured balance of relationships, enjoyment and growth"],
    challenge:["核对期待与实际资源，不把愿望当作承诺","check expectations against actual resources rather than treating wishes as commitments"],
  },
  "mars/saturn": {
    support:["让行动力与纪律配合，把任务分成可完成的步骤","combine initiative with discipline by breaking tasks into manageable steps"],
    challenge:["协调行动节奏与现实约束，给必要的等待留出空间","coordinate the pace of action with real constraints and allow room for necessary delays"],
  },
  "mercury/saturn": {
    support:["将信息整理与耐心、结构化思考结合","combine organizing information with patient, structured thinking"],
    challenge:["检查沟通中的限制与假设，避免过早下结论","check constraints and assumptions in communication before drawing conclusions"],
  },
  "moon/venus": {support:["兼顾感受与关系中的实际需要","consider feelings together with practical needs in relationships"]},
  "mars/mercury": {
    support:["让清晰沟通服务于具体行动","connect clear communication to practical action"],
    challenge:["在表达意见与采取行动前核实信息","check information before expressing opinions or taking action"],
  },
  "jupiter/saturn": {
    support:["在成长目标与可持续责任之间寻找配合","align growth goals with sustainable responsibilities"],
    challenge:["核对扩展计划与时间、资源的界限","check expansion plans against limits of time and resources"],
  },
};
function horoscopeCombinationCopy(a, lang) {
  if (!a || !a.value || !a.contribution || a.combinationWeight === 1) return "";
  const phrase = HORO_PAIR_REFLECTIONS[a.pair]?.[a.kind];
  if (!phrase) return "";
  return lang === "zh"
    ? "组合反思：" + phrase[0] + "。"
    : "Pair reflection: " + phrase[1] + ".";
}
function horoscopeRulerCopy(d, lang) {
  const term = (d.contributions || []).filter(t=>t.role?.houseExtra > 0)
    .sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
  if (!term) return "";
  const zh = lang === "zh", names = I18N[lang].astro.bodies;
  const houses = term.role.houseRoles.filter(h=>h.extra>0)
    .map(h=>zh ? "第"+h.house+"宫（"+SIGNS[h.signIdx][lang]+"）" :
      "house "+h.house+" ("+SIGNS[h.signIdx][lang]+")").join(zh?"、":" and ");
  const shared = term.role.houseRoles.length>1;
  return zh ? "守护角色："+names[term.key]+"守护此领域的太阳星座"+houses+"，因此获得额外权重"+(shared?"（多宫位增量递减且有上限）":"")+"。"
    : "Rulership: "+names[term.key]+" rules solar "+houses+" in this domain and receives extra weight"+(shared?" (diminishing, capped additions for shared rulership)":"")+".";
}
function horoscopeDomainCopy(d, h, lang) {
  const zh = lang === "zh";
  const li = zh ? 0 : 1;
  const domain = HORO_DOMAINS.find(x => x.key === d.key);
  const f = d.focus;
  const names = I18N[lang].astro.bodies;
  const house = HORO_HOUSE_THEMES[f.house - 1];
  const bodyTheme = HORO_BODY_THEMES[f.key][li];
  const action = horoscopeActionFor(d, h).text[li];
  const frames = HORO_ADVICE_FRAMES[horoscopeTone(d.raw)];
  const variant = (h.adviceIdx + (d.key === h.primary ? 0 : HORO_DOMAINS.indexOf(domain))) % frames.length;
  const advice = frames[variant][li].replace("{action}", action);
  const placement = zh
    ? `象征解读：${names[f.key]}象征${bodyTheme}。它所在的太阳星座第${f.house}宫涉及${house.theme[li]}，不妨${house.action[li]}。`
    : `Symbolic reading: ${names[f.key]} represents ${bodyTheme}. Its solar house ${f.house} concerns ${house.theme[li]}. Try to ${house.action[li]}.`;
  let aspectInterpretation = "";
  if (f.aspect) {
    const a = f.aspect;
    const otherTheme = HORO_BODY_THEMES[a.other][li];
    if (a.strength === 0) {
      aspectInterpretation = zh
        ? `${a.zh}处于容许度边缘，在${f.sampleLabel ? "该采样时刻" : "本次评分中"}不产生相位贡献。`
        : `The ${a.en} is at the edge of its orb and contributes no aspect weight ${f.sampleLabel ? "at this sample" : "to this rating"}.`;
    } else {
      const guidance = a.angle === 0
        ? HORO_CONJUNCTION_ACTIONS[a.value > 0 ? "support" : a.value < 0 ? "challenge" : "neutral"][li]
        : HORO_ASPECT_ACTIONS[a.angle][li];
      aspectInterpretation = zh
        ? `相位提示：${names[f.key]}（${bodyTheme}）与${names[a.other]}（${otherTheme}）形成${a.zh}。${guidance}。`
        : `The ${a.en} links ${names[f.key]} (${bodyTheme}) and ${names[a.other]} (${otherTheme}). ${guidance[0].toUpperCase() + guidance.slice(1)}.`;
    }
  }
  const motion = horoscopeAspectMotionCopy(f, lang);
  if (motion) aspectInterpretation += (aspectInterpretation ? " " : "") + motion;
  const pairReflection = horoscopeCombinationCopy(f.aspect, lang);
  if (pairReflection) aspectInterpretation += " " + pairReflection;
  let conditionInterpretation = "";
  if (f.dignity?.length) {
    const labels = f.dignity.map(c => HORO_CONDITION_LABELS[c][li]).join(zh ? "、" : " and ");
    const strong = f.dignity.includes("domicile") || f.dignity.includes("exaltation");
    const sign = SIGNS[f.signIdx][lang];
    conditionInterpretation = zh
      ? `庙旺提示：按传统规则，${names[f.key]}在${sign}属于${labels}，${strong ? "其主题较易顺畅表达" : "其主题较难直接发挥"}，本规则评分中${strong ? "略为加分" : "略为减分"}。`
      : `Dignity note: by traditional rules ${names[f.key]} is in ${labels} in ${sign}, so its themes ${strong ? "tend to find easier expression" : "may need more patience to express"}; the rule-based score ${strong ? "adds" : "subtracts"} a little.`;
  }
  if (f.solar === "combust") {
    conditionInterpretation += (conditionInterpretation ? "\n" : "") + (zh
      ? `灼伤提示：${names[f.key]}与太阳相距不足8.5°，传统上视为被日光遮蔽，适合先观察、少下定论。`
      : `Combustion note: ${names[f.key]} is within 8.5° of the Sun, traditionally read as obscured by its light; observe first and conclude later.`);
  } else if (f.solar === "cazimi") {
    conditionInterpretation += (conditionInterpretation ? "\n" : "") + (zh
      ? `日核提示：${names[f.key]}与太阳几乎精确同度，传统上视为得到加强，可把它的主题当作今天的清晰焦点。`
      : `Cazimi note: ${names[f.key]} is almost exactly conjunct the Sun, traditionally read as empowered; treat its themes as a clear focus today.`);
  }
  const review = f.retrograde && HORO_RETROGRADE_ACTIONS[f.key];
  const retrogradeInterpretation = review
    ? (zh ? `逆行复核提示：${review[li]}。` : `Retrograde reflection prompt: ${review[li]}.`)
    : "";
  return { ...horoscopeFocusCopy(f, lang), advice, placement, aspectInterpretation,
    conditionInterpretation, retrogradeInterpretation };
}
/* Report only the largest positive/negative terms of this domain's actual
   weighted mean, not an inference from planet names or from rounded stars.
   The two extrema are selected independently, so mixed evidence stays visible. */
function horoscopeBalanceCopy(d, lang) {
  const zh = lang === "zh";
  const names = I18N[lang].astro.bodies;
  let positive = null, negative = null;
  for (const term of d.contributions) {
    if (term.value > 0 && (!positive || term.value > positive.value)) positive = term;
    if (term.value < 0 && (!negative || term.value < negative.value)) negative = term;
  }
  const parts = [];
  if (positive) parts.push(zh
    ? `${names[positive.key]}是最大的正向评分因素`
    : `${names[positive.key]} contributes the most positive weight`);
  if (negative) parts.push(zh
    ? `${names[negative.key]}是最大的负向评分因素`
    : `${names[negative.key]} contributes the most negative weight`);
  if (!parts.length) return zh
    ? "规则评分：各项贡献均为中性。"
    : "Rule-based score: all contributions are neutral.";
  return zh ? "规则评分：" + parts.join("；") + "。"
    : "Rule-based score: " + parts.join("; ") + ".";
}
/* Several domains can share evidence from the same representative sample.
   Group by evidence, not by localized text or rounded score, and keep
   reciprocal descriptions of the same aspect from being repeated. */
function horoscopeFocusKey(f) {
  return JSON.stringify([f.sampleAt ?? null, f.key, f.signIdx, f.house, f.retrograde, f.dignity || [], f.solar || null,
    f.aspect ? [f.aspect.other, f.aspect.angle, f.aspect.strength, f.aspect.value, f.aspect.state, f.aspect.dynamicWeight] : null]);
}
function horoscopeFocusGroups(domains) {
  const groups = new Map();
  for (const d of domains) {
    const key = horoscopeFocusKey(d.focus);
    if (!groups.has(key)) groups.set(key, { id: groups.size + 1, domains: [] });
    groups.get(key).domains.push(d);
  }
  return groups;
}
function horoscopeAspectKey(f) {
  return f.aspect ? JSON.stringify([f.sampleAt ?? null, [f.key, f.aspect.other].sort(), f.aspect.angle]) : null;
}
/* The daily event interpretation is a separate editorial layer: it
   describes the actual crossing/station and the selected sign's solar
   house. The event text never adds an independent scoring bonus; its
   epoch only splits the daily integration interval. */
const HORO_INGRESS_ACTIONS = {
  sun: ["重新审视近期目标，确定一件接下来值得投入的事", "review your recent goals and identify one worthwhile next priority"],
  mercury: ["挑一个值得深入了解的话题，先核实关键信息", "choose a topic worth exploring and verify its key details"],
  venus: ["留意新的相处方式或审美兴趣，分清喜欢与真正需要", "notice new ways of connecting or new interests, and distinguish preferences from needs"],
  mars: ["把想尝试的行动变成一项安全、具体而可完成的小任务", "turn an intended action into a safe, concrete and manageable task"],
  jupiter: ["重新评估一个学习或成长方向，用实际条件衡量可能性", "reassess a learning or growth goal using practical constraints"],
  saturn: ["梳理长期责任，明确需要坚持的习惯和合理界限", "review long-term responsibilities, sustainable habits and reasonable boundaries"],
};
const HORO_DIRECT_ACTIONS = {
  mercury: ["整理此前核对过的信息，继续推进已经确认的事项", "organize previously checked information and continue with confirmed tasks"],
  venus: ["回顾自己梳理过的偏好和关系需求，选择一件力所能及的行动", "review your clarified preferences and relationship needs and choose one manageable action"],
  mars: ["按调整后的计划选择一个可完成的下一步，避免一下子加大负担", "choose one manageable next step in your revised plan without suddenly increasing your workload"],
  jupiter: ["把重新评估过的长远想法变成一个小规模试验", "turn a reassessed long-term idea into a small-scale experiment"],
  saturn: ["将重新厘清的责任、期限和界限落实到可持续的安排中", "put clarified responsibilities, deadlines and boundaries into a sustainable plan"],
};
function horoscopeEventLabel(event, lang) {
  const zh = lang === "zh", body = I18N[lang].astro.bodies[event.body];
  if (event.type === "aspect") {
    const rule = HORO_ASPECTS.find(a => a.angle === event.angle);
    const other = I18N[lang].astro.bodies[event.other];
    return zh ? body + "与" + other + "近似精确" + rule.zh :
      body + " / " + other + " · near-exact " + rule.en;
  }
  if (event.type === "ingress") {
    const sign = SIGNS[event.toSignIdx][lang];
    return zh ? body + (event.backward ? "逆行回到" : "进入") + sign
      : body + (event.backward ? " retrogrades into " : " enters ") + sign;
  }
  if (event.type === "retrogradeStart") return zh ? body + "开始逆行" : body + " stations retrograde";
  return zh ? body + "恢复顺行" : body + " stations direct";
}
function horoscopeEventCopy(event, signIdx, lang) {
  const zh = lang === "zh", li = zh ? 0 : 1;
  const houseFor = index => (index - signIdx + 12) % 12 + 1;
  const body = I18N[lang].astro.bodies[event.body];
  const title = horoscopeEventLabel(event, lang);
  const theme = HORO_BODY_THEMES[event.body][li];
  if (event.type === "aspect") {
    const other = I18N[lang].astro.bodies[event.other], rule = HORO_ASPECTS.find(a => a.angle === event.angle);
    const otherTheme = HORO_BODY_THEMES[event.other][li];
    const guidance = (event.angle === 0 ? HORO_CONJUNCTION_ACTIONS.neutral : HORO_ASPECT_ACTIONS[event.angle])[li];
    return { title,
      evidence: zh ? "近似星历显示，本地自然日内两者达到" + rule.angle + "°的主要相位；不是精确观测时刻。"
        : "The approximate ephemeris places this " + rule.angle + "° major aspect within the local civil day; no precise observed timing is implied.",
      interpretation: zh ? body + "象征" + theme + "，" + other + "象征" + otherTheme + "。这只是传统规则的象征性主题，不预示吉凶。"
        : "Symbolically, " + body + " represents " + theme + " and " + other + " represents " + otherTheme + ". This is a traditional reflection prompt, not a prediction.",
      suggestion: zh ? guidance + "。" : guidance[0].toUpperCase() + guidance.slice(1) + ".",
    };
  }
  if (event.type === "ingress") {
    const from = houseFor(event.fromSignIdx), to = houseFor(event.toSignIdx);
    const oldHouse = HORO_HOUSE_THEMES[from - 1], newHouse = HORO_HOUSE_THEMES[to - 1];
    const fromSign = SIGNS[event.fromSignIdx][lang], toSign = SIGNS[event.toSignIdx][lang];
    return { title,
      evidence: zh ? `近似回归黄道星位：${fromSign} → ${toSign}；太阳星座第${from}宫 → 第${to}宫。`
        : `Approximate tropical placement: ${fromSign} → ${toSign}; solar house ${from} → ${to}.`,
      interpretation: zh
        ? `${body}象征${theme}。这次${event.backward ? "逆行跨界" : "跨界"}可作为反思主题的转换：从${oldHouse.theme[li]}到${newHouse.theme[li]}。`
        : `In symbolic terms, ${body} represents ${theme}. This ${event.backward ? "backward " : ""}crossing invites reflection on a shift from ${oldHouse.theme[li]} to ${newHouse.theme[li]}.`,
      suggestion: zh ? `不妨${HORO_INGRESS_ACTIONS[event.body][li]}；也可${newHouse.action[li]}。`
        : `Consider taking time to ${HORO_INGRESS_ACTIONS[event.body][li]}, and to ${newHouse.action[li]}.`,
    };
  }
  const house = houseFor(event.signIdx), area = HORO_HOUSE_THEMES[house - 1];
  const starting = event.type === "retrogradeStart";
  const action = (starting ? HORO_RETROGRADE_ACTIONS : HORO_DIRECT_ACTIONS)[event.body][li];
  return { title,
    evidence: zh ? `近似地心黄经视运动方向由${starting ? "顺行转为逆行" : "逆行转为顺行"}；${SIGNS[event.signIdx][lang]} · 太阳星座第${house}宫。`
      : `Approximate apparent geocentric longitude changes from ${starting ? "direct to retrograde" : "retrograde to direct"}; ${SIGNS[event.signIdx][lang]} · solar house ${house}.`,
    interpretation: zh
      ? `${body}象征${theme}；第${house}宫涉及${area.theme[li]}。可把${starting ? "逆行开始" : "恢复顺行"}当作${starting ? "复核、整理的契机" : "回顾调整并考虑下一步的契机"}，而非对实际吉凶的预示。`
      : `${body} symbolizes ${theme}; solar house ${house} concerns ${area.theme[li]}. Treat this station as a reflection prompt to ${starting ? "review and reorganize" : "review adjustments and consider next steps"}, not a prediction of outcomes.`,
    suggestion: zh ? `不妨${action}；也可${area.action[li]}。`
      : `Consider taking time to ${action}, and to ${area.action[li]}.`,
  };
}
function horoscopeEventSummary(events, lang) {
  if (!events?.length) return "";
  const zh = lang === "zh";
  // Ingress/station > non-lunar aspect > new/full Moon. Routine lunar
  // encounters stay in the reader.
  const priority = e => e.type !== "aspect" ? 0 :
    e.body !== "moon" && e.other !== "moon" ? 1 :
    e.pair === "moon/sun" && (e.angle === 0 || e.angle === 180) ? 2 : Infinity;
  const important = events.filter(e => Number.isFinite(priority(e)))
    .sort((a,b) => priority(a) - priority(b) || a.at - b.at);
  if (!important.length) return "";
  const first = horoscopeEventLabel(important[0], lang);
  const more = important.length - 1;
  return zh ? "今日天象 · " + first + (more ? ` · 另有${more}项` : "")
    : "Sky event today · " + first + (more ? ` · ${more} more` : "");
}
/* Event readings as data: the dialog renders the fields, and the plain
   text below joins the same fields, so both always say the same thing. */
function horoscopeEventDoc(h, lang) {
  if (!h.events?.length) return null;
  const zh = lang === "zh";
  return {
    title: zh ? "今日特别天象" : "Today's sky events",
    note: zh
      ? "按本地自然日和近似星历估算，临界时刻可能跨日；星位变化通过全天采样反映于评分，以下象征提示不另行加减分。"
      : "Estimated for the local calendar day using an approximate ephemeris. Near-midnight events may fall on a neighboring date. The changing sky is included in the daily samples; these symbolic prompts do not add an independent score adjustment.",
    suggestionLabel: zh ? "专题建议：" : "Event reflection: ",
    items: h.events.map(event => horoscopeEventCopy(event, h.signIdx, lang)),
  };
}
function horoscopeEventParagraphs(h, lang) {
  const doc = horoscopeEventDoc(h, lang);
  if (!doc) return [];
  return [doc.title + (lang === "zh" ? "｜" : " | ") + doc.note, ...doc.items.map(detail =>
    [detail.title, detail.evidence, detail.interpretation, doc.suggestionLabel + detail.suggestion].join("\n"))];
}
function horoscopeCopy(h, lang) {
  const zh = lang === "zh";
  const domain = HORO_DOMAINS.find(d => d.key === h.primary);
  const primary = h.domains.find(d => d.key === h.primary);
  const detail = horoscopeDomainCopy(primary, h, lang);
  return { topic: domain[lang], evidence: detail.evidence, aspect: detail.aspect,
    advice: detail.advice, eventSummary: horoscopeEventSummary(h.cardEvents ?? h.events, lang),
    basis: h.samples?.length
      ? (zh
        ? "评分：按本地自然日分为四个等时长区间，月亮及其他天体换座、顺逆行转换时细分；每段中点统一计算七颗天体及相对运动，按时长平均原始贡献后转换为星级。星位解读为实际代表采样，而非全天固定状态。传统占星规则（太阳星座宫位）"
        : "Ratings integrate all seven bodies at the midpoints of four equal elapsed-time intervals of the local civil day, splitting at ingresses and stations. Relative motion weights aspect strength. Unrounded contributions are duration-weighted before conversion to stars. Sky readings describe representative samples, not fixed all-day placements. Traditional-inspired solar-sign rules")
      : (zh ? "评分：单次近似星位快照；传统占星规则（太阳星座宫位）"
        : "Ratings use one approximate sky snapshot. Traditional-inspired solar-sign rules"),
    cues: zh ? "趣味幸运提示" : "Playful lucky cues" };
}
/* Show the additive daily audit in scoring units, not percentages or
   probabilities. Only presentation rounds; stored terms retain precision. */
function horoscopeContributionCopy(d, lang) {
  if (!d.contributions?.[0]?.samples) return "";
  const zh = lang === "zh";
  const names = I18N[lang].astro.bodies;
  const labels = zh ? ["宫位关系","庙旺","相位","太阳状态","逆行","领域宫位"]
    : ["House relation","Dignity","Aspects","Solar condition","Retrograde","Domain houses"];
  const fmt = n => (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(2);
  const sep = zh ? "；" : "; ";
  const bodies = d.contributions.map(term => names[term.key] + " " + fmt(term.value)).join(sep);
  const factors = HORO_FACTORS.map((key, i) =>
    labels[i] + " " + fmt(d.contributions.reduce((sum, term) => sum + term.components[key], 0))).join(sep);
  return (zh ? "全天贡献（约值）：" : "Daily contributions (approx.): ") + bodies + "\n" +
    (zh ? "因素分解：" : "Factor breakdown: ") + factors +
    (zh ? "；合计 " : "; total ") + fmt(d.raw);
}
/* The same daily audit as numbers, for the dialog's contribution bars. */
function horoscopeContributionData(d) {
  if (!d.contributions?.[0]?.samples) return null;
  return {
    bodies: d.contributions.map(term => ({ key: term.key, value: term.value })),
    factors: HORO_FACTORS.map(key => ({ key,
      value: d.contributions.reduce((sum, term) => sum + term.components[key], 0) })),
    total: d.raw,
  };
}
/* The reading dialog expands the same stored daily result into four domain
   explanations. No fresh Date, ephemeris calculation, RNG or deck draw.
   horoscopeFullDoc() holds the reading as fields for the dialog layout;
   horoscopeFullDocText() joins those fields into the plain full text. */
function horoscopeFullDoc(h, lang) {
  const zh = lang === "zh";
  const A = I18N[lang].astro;
  const sg = SIGNS[h.signIdx];
  const copy = horoscopeCopy(h, lang);
  const groups = horoscopeFocusGroups(h.domains);
  const title = id => zh ? `星位解读 ${id}` : `Sky reading ${id}`;
  const label = d => HORO_DOMAINS.find(x => x.key === d.key)[lang];
  const doc = {
    lang, sign: { symbol: sg.symbol, name: sg[lang] }, dailyLabel: A.daily, overallLabel: A.overall, stars: h.stars,
    intro: zh
      ? "以下先看四项评分与建议，再阅读对应的星位解读。正向和负向因素来自传统规则的加权评分，不代表实际吉凶；相同星位及相位只展开一次。"
      : "Read the four ratings and practical prompts first, then their referenced sky readings. Positive and negative factors are contributions to an editorial weighted score, not real-world outcomes. Shared placements and aspects are explained once.",
    events: horoscopeEventDoc(h, lang),
    labels: zh
      ? { domains: "分项运势", readings: "星位解读", basis: "主要依据", advice: "建议",
        contributions: "全天贡献（约值）", factors: "因素分解", total: "合计", positive: "正向", negative: "负向" }
      : { domains: "By area", readings: "Sky readings", basis: "Main basis", advice: "Suggestion",
        contributions: "Daily contributions (approx.)", factors: "Factor breakdown", total: "Total", positive: "positive", negative: "negative" },
    factorNames: zh ? ["宫位关系","庙旺","相位","太阳状态","逆行","领域宫位"]
      : ["House relation","Dignity","Aspects","Solar condition","Retrograde","Domain houses"],
    bodyNames: A.bodies,
    domains: [], readings: [],
    lucky: { title: copy.cues, items: [
      { label: A.luckyNumber, value: String(h.luckyNumber) },
      { label: A.luckyColor, value: LUCKY_COLORS[h.colorIdx][lang] },
      { label: A.luckyDirection, value: LUCKY_DIRECTIONS[h.dirIdx][lang] },
      { label: A.luckyItem, value: LUCKY_ITEMS[h.itemIdx][lang] },
    ] },
    basis: copy.basis, footnote: A.footnote,
  };
  for (const d of h.domains) {
    const detail = horoscopeDomainCopy(d, h, lang);
    const group = groups.get(horoscopeFocusKey(d.focus));
    doc.domains.push({ key: d.key, label: label(d), stars: d.stars, primary: d.key === h.primary,
      readingId: group.id, readingTitle: title(group.id), body: A.bodies[d.focus.key],
      balance: horoscopeBalanceCopy(d, lang), contributionText: horoscopeContributionCopy(d, lang),
      contribution: horoscopeContributionData(d), ruler: horoscopeRulerCopy(d, lang), advice: detail.advice });
  }
  const aspectOwners = new Map();
  for (const group of groups.values()) {
    const d = group.domains[0];
    const detail = horoscopeDomainCopy(d, h, lang);
    const aspectKey = horoscopeAspectKey(d.focus);
    let aspectText = detail.aspectInterpretation;
    if (aspectKey) {
      if (aspectOwners.has(aspectKey)) {
        const earlier = title(aspectOwners.get(aspectKey));
        aspectText = zh ? `相位提示：同一相位见${earlier}。`
          : `Aspect note: the same aspect is explained in ${earlier}.`;
      } else {
        aspectOwners.set(aspectKey, group.id);
      }
    }
    doc.readings.push({ id: group.id, title: title(group.id), domainLabels: group.domains.map(label),
      evidence: detail.evidence, aspect: detail.aspect,
      paragraphs: [detail.placement, detail.conditionInterpretation, aspectText, detail.retrogradeInterpretation].filter(Boolean) });
  }
  return doc;
}
function horoscopeFullDocText(doc) {
  const zh = doc.lang === "zh";
  const paragraphs = [
    `${doc.dailyLabel} · ${doc.sign.symbol} ${doc.sign.name}\n${doc.overallLabel} ${doc.stars}/5`,
    doc.intro,
  ];
  if (doc.events) paragraphs.push(doc.events.title + (zh ? "｜" : " | ") + doc.events.note,
    ...doc.events.items.map(e => [e.title, e.evidence, e.interpretation, doc.events.suggestionLabel + e.suggestion].join("\n")));
  for (const d of doc.domains) paragraphs.push([
    `${d.label} ${d.stars}/5`,
    zh ? `${doc.labels.basis}：${d.readingTitle}（${d.body}）` : `${doc.labels.basis}: ${d.readingTitle} (${d.body})`,
    d.balance, d.contributionText, d.ruler,
    `${zh ? "建议：" : "Suggestion: "}${d.advice}`,
  ].filter(Boolean).join("\n"));
  for (const r of doc.readings) paragraphs.push([
    `${r.title} · ${r.domainLabels.join(zh ? "、" : ", ")}`,
    `${r.evidence}${r.aspect ? " · " + r.aspect : ""}`,
    ...r.paragraphs,
  ].filter(Boolean).join("\n"));
  paragraphs.push(`${doc.lucky.title}\n${doc.lucky.items.map(i => `${i.label} ${i.value}`).join(" · ")}`);
  paragraphs.push(`${doc.basis} · ${doc.footnote}`);
  return paragraphs.join("\n\n");
}
function horoscopeFullText(h, lang) {
  return horoscopeFullDocText(horoscopeFullDoc(h, lang));
}
