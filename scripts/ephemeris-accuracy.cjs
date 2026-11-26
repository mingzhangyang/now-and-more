#!/usr/bin/env node
/* Measure the production horoscope ephemeris against the offline
   reference in tests/fixtures/ephemeris-reference.json (JPL Horizons
   DE441 positions; astronomy-engine velocities and event epochs, see
   scripts/ephemeris-reference.cjs). No network, no dependencies.

     node scripts/ephemeris-accuracy.cjs            # print the summary
     node scripts/ephemeris-accuracy.cjs --write    # refresh docs/ephemeris-accuracy-baseline.json

   It runs the code paths the site runs: planetPositions() (longitude and
   the +-1 h velocity used for retrograde and aspect motion),
   horoscopeAspect() for aspect identification, detectHoroscopeEvents()
   for Sun/planet ingresses and stations, and horoscopeMoonIngress() for
   the lunar sign changes that split the daily samples. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "ephemeris-reference.json");
const BASELINE = path.join(ROOT, "docs", "ephemeris-accuracy-baseline.json");
const BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
const PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn"];
const MIN = 60000, DAY = 86400000;
const norm180 = d => ((((d + 180) % 360) + 360) % 360) - 180;

function loadProduction(root = ROOT) {
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  const app = read("js/app.js");
  const start = app.indexOf("const TERM_VSOP_L0 =");
  const end = app.indexOf("function angDiffDeg(", start);
  if (start < 0 || end <= start) throw Error("Missing solar ephemeris in js/app.js");
  return new Function(read("js/data.js") + "\n" + read("js/horoscope-advice.js") +
    "\nconst RAD=Math.PI/180,DAY_MS=86400000;\n" + app.slice(start, end) + "\n" + read("js/astro.js") +
    "\nreturn {planetPositions,horoscopeAspect,detectHoroscopeEvents,horoscopeMoonIngress};")();
}

function stats(values, digits = 4) {
  const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
  const q = p => sorted[Math.min(n - 1, Math.ceil(p * n) - 1)];
  const r = x => Number(x.toFixed(digits));
  return { n, mean: r(sorted.reduce((s, x) => s + x, 0) / n), rms: r(Math.sqrt(sorted.reduce((s, x) => s + x * x, 0) / n)),
    p95: r(q(0.95)), p99: r(q(0.99)), max: r(sorted[n - 1]) };
}
const pct = (hit, total) => Number((100 * hit / total).toFixed(3));

/* One-to-one nearest matching of reference and production events. */
function matchEvents(reference, produced, windowMs) {
  const used = new Set(), errors = [], missed = [];
  for (const ref of reference) {
    let best = -1;
    for (let i = 0; i < produced.length; i++) {
      if (used.has(i) || produced[i].key !== ref.key) continue;
      const d = Math.abs(produced[i].at - ref.at);
      if (d <= windowMs && (best < 0 || d < Math.abs(produced[best].at - ref.at))) best = i;
    }
    if (best < 0) { missed.push(ref.at); continue; }
    used.add(best);
    errors.push(Math.abs(produced[best].at - ref.at) / MIN);
  }
  const extra = produced.filter((_, i) => !used.has(i)).map(e => e.at);
  return { errors, missed, extra };
}

function evaluate(fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")), api = loadProduction()) {
  const { startMs, stepMinutes, count } = fixture.meta.positions.grid;
  const grid = Array.from({ length: count }, (_, i) => startMs + i * stepMinutes * MIN);
  const production = grid.map(t => api.planetPositions(new Date(t)));
  const result = { reference: { grid: { from: new Date(grid[0]).toISOString(), to: new Date(grid[count - 1]).toISOString(), samples: count },
    positions: fixture.meta.positions.source, velocitiesAndEvents: fixture.meta.velocitiesAndEvents.source }, bodies: {}, aspects: {}, events: {} };

  // Reference placements in the same shape planetPositions() returns.
  const reference = grid.map((_, i) => BODIES.map(key => ({ key, lon: fixture.longitude[key][i], velocity: fixture.velocity[key][i] })));
  for (const [b, key] of BODIES.entries()) {
    const lon = [], vel = [];
    let sign = 0, direction = 0;
    for (let i = 0; i < count; i++) {
      const p = production[i][b], r = reference[i][b];
      lon.push(Math.abs(norm180(p.lon - r.lon)));
      vel.push(Math.abs(p.velocity - r.velocity));
      if (p.signIdx === Math.floor(((r.lon % 360) + 360) % 360 / 30) % 12) sign++;
      if (Math.sign(p.velocity) === Math.sign(r.velocity)) direction++;
    }
    result.bodies[key] = { longitudeDeg: stats(lon), velocityDegPerDay: stats(vel, 6), signAgreementPct: pct(sign, count),
      ...(PLANETS.includes(key) ? { directionAgreementPct: pct(direction, count) } : {}) };
  }

  // Aspect identification for all 21 pairs, with the production orbs.
  let pairs = 0, sameAspect = 0, refAspects = 0, prodAspects = 0, sameState = 0, bothAspects = 0;
  const moonPairs = { pairs: 0, same: 0 }, otherPairs = { pairs: 0, same: 0 };
  for (let i = 0; i < count; i++) for (let a = 0; a < BODIES.length; a++) for (let b = a + 1; b < BODIES.length; b++) {
    const p = api.horoscopeAspect(production[i][a], production[i][b]);
    const r = api.horoscopeAspect(reference[i][a], reference[i][b]);
    const same = (p?.angle ?? null) === (r?.angle ?? null);
    pairs++; if (same) sameAspect++;
    const bucket = a === 1 || b === 1 ? moonPairs : otherPairs;
    bucket.pairs++; if (same) bucket.same++;
    if (r) refAspects++;
    if (p) prodAspects++;
    if (p && r && same) { bothAspects++; if (p.state === r.state) sameState++; }
  }
  result.aspects = { pairSamples: pairs, referenceAspects: refAspects, productionAspects: prodAspects,
    identificationAgreementPct: pct(sameAspect, pairs), moonPairsAgreementPct: pct(moonPairs.same, moonPairs.pairs),
    otherPairsAgreementPct: pct(otherPairs.same, otherPairs.pairs), motionStateAgreementPct: pct(sameState, bothAspects) };

  // Sun/planet ingresses and stations through the production detector,
  // run over consecutive UTC days across the reference range.
  const [from, to] = fixture.meta.velocitiesAndEvents.ranges.other;
  const produced = [];
  const cache = new Map();
  for (let day = from; day < to; day += DAY) {
    if (cache.size > 4000) cache.clear();
    for (const e of api.detectHoroscopeEvents(day, day + DAY, api.planetPositions, false, cache)) produced.push(e);
  }
  const window = { sun: DAY, mercury: 5 * DAY, venus: 5 * DAY, mars: 5 * DAY, jupiter: 10 * DAY, saturn: 10 * DAY };
  for (const body of ["sun", ...PLANETS]) {
    const ref = fixture.events.ingress[body].map(([at, sign, back]) => ({ at, key: `${sign}/${back}` }));
    const got = produced.filter(e => e.type === "ingress" && e.body === body).map(e => ({ at: e.at, key: `${e.toSignIdx}/${e.backward ? 1 : 0}` }));
    const m = matchEvents(ref, got, window[body]);
    result.events[`${body} ingress`] = { reference: ref.length, matched: m.errors.length, missed: m.missed.length, extra: m.extra.length,
      ...(m.errors.length ? { errorMinutes: stats(m.errors, 1) } : {}) };
    if (body === "sun") continue;
    const sref = fixture.events.station[body].map(([at, retro]) => ({ at, key: retro ? "retrogradeStart" : "retrogradeEnd" }));
    const sgot = produced.filter(e => e.body === body && e.type !== "ingress").map(e => ({ at: e.at, key: e.type }));
    const s = matchEvents(sref, sgot, 2 * window[body]);
    result.events[`${body} station`] = { reference: sref.length, matched: s.errors.length, missed: s.missed.length, extra: s.extra.length,
      ...(s.errors.length ? { errorMinutes: stats(s.errors, 1) } : {}) };
  }
  // Lunar sign changes as used to split the day's samples.
  const [mFrom, mTo] = fixture.meta.velocitiesAndEvents.ranges.moonIngress;
  const moon = [];
  for (let day = mFrom; day < mTo; day += DAY) {
    const at = api.horoscopeMoonIngress(day, day + DAY);
    if (at !== null) moon.push({ at, key: "moon" });
  }
  const mm = matchEvents(fixture.events.ingress.moon.map(([at]) => ({ at, key: "moon" })), moon, DAY / 4);
  result.events["moon ingress"] = { reference: fixture.events.ingress.moon.length, matched: mm.errors.length,
    missed: mm.missed.length, extra: mm.extra.length, errorMinutes: stats(mm.errors, 1) };
  return result;
}

module.exports = { evaluate, loadProduction, stats };

if (require.main === module) {
  const started = Date.now();
  const result = evaluate();
  const out = JSON.stringify(result, null, 2) + "\n";
  if (process.argv.includes("--write")) fs.writeFileSync(BASELINE, out);
  process.stdout.write(out);
  process.stderr.write(`Evaluated in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
}
