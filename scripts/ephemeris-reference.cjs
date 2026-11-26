#!/usr/bin/env node
/* Build the offline ephemeris reference used by the accuracy report.

   Development tool only. The site never runs this and never calls an
   ephemeris service at runtime. It needs network access to the JPL
   Horizons API, `curl` on PATH, and astronomy-engine 2.1.19 installed
   somewhere outside the repository (it is not a project dependency):

     npm install --no-save --prefix "$TMPDIR/ae" astronomy-engine@2.1.19
     ASTRONOMY_ENGINE="$TMPDIR/ae/node_modules/astronomy-engine" \
       node scripts/ephemeris-reference.cjs

   Output: tests/fixtures/ephemeris-reference.json

   Two reference layers, both expressed in the frame the horoscope uses:
   geocentric, apparent (light time + aberration), true ecliptic and
   equinox of date, degrees.

   1. Positions: JPL Horizons (DE441), observer quantity 31
      (ObsEcLon), centre 500@399, UT, on a fixed 20011-minute grid from
      2000-01-01 to 2050-01-01. The odd step walks through every time of
      day and lunar phase instead of sampling the same clock time.
   2. Velocities and event epochs: astronomy-engine 2.1.19 (MIT), the
      library already bundled inside the Sky Engine SDK. It is checked
      against layer 1 on the whole grid, and its event epochs are
      spot-checked against fine Horizons tables (stored in the fixture).
*/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const A = require(process.env.ASTRONOMY_ENGINE || "astronomy-engine");
const OUT = path.join(__dirname, "..", "tests", "fixtures", "ephemeris-reference.json");
const BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
const HORIZONS_ID = { sun: "10", moon: "301", mercury: "199", venus: "299", mars: "499", jupiter: "599", saturn: "699" };
const AE_BODY = { sun: A.Body.Sun, moon: A.Body.Moon, mercury: A.Body.Mercury, venus: A.Body.Venus,
  mars: A.Body.Mars, jupiter: A.Body.Jupiter, saturn: A.Body.Saturn };
const GRID = { start: Date.UTC(2000, 0, 1), stop: Date.UTC(2050, 0, 1), stepMinutes: 20011 };
const EVENT_RANGE = { start: Date.UTC(2000, 0, 1), stop: Date.UTC(2050, 0, 1) };
const MOON_RANGE = { start: Date.UTC(2026, 0, 1), stop: Date.UTC(2031, 0, 1) };
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const norm360 = d => ((d % 360) + 360) % 360;
const norm180 = d => norm360(d + 180) - 180;
const round = (x, digits) => Number(x.toFixed(digits));

/* ---- JPL Horizons ---- */
const horizonsStamp = ms => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
function horizons(body, startMs, stopMs, step) {
  const params = {
    format: "json", COMMAND: `'${HORIZONS_ID[body]}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'", CENTER: "'500@399'", START_TIME: `'${horizonsStamp(startMs)}'`,
    STOP_TIME: `'${horizonsStamp(stopMs)}'`, STEP_SIZE: `'${step}'`, QUANTITIES: "'31'",
    TIME_TYPE: "'UT'", CSV_FORMAT: "'YES'", ANG_FORMAT: "'DEG'", EXTRA_PREC: "'YES'", TIME_DIGITS: "'SECONDS'",
  };
  const args = ["-sS", "--fail", "-m", "180", "-G", "https://ssd.jpl.nasa.gov/api/horizons.api"];
  for (const [k, v] of Object.entries(params)) args.push("--data-urlencode", `${k}=${v}`);
  let raw;
  for (let attempt = 0; ; attempt++) {
    try { raw = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 64 << 20 }); break; }
    catch (error) { if (attempt >= 3) throw error; }
  }
  const json = JSON.parse(raw);
  const text = json.result;
  const source = (text.match(/Target body name:.*\{source:\s*([^}]+)\}/) || [])[1] || "unknown";
  const soe = text.indexOf("$$SOE"), eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < soe) throw Error(`Horizons returned no table for ${body}:\n${text.slice(0, 2000)}`);
  const rows = text.slice(soe + 5, eoe).trim().split("\n").map(line => {
    const cells = line.split(",").map(s => s.trim());
    const at = Date.parse(cells[0].replace(/^(\d{4})-(\w{3})-(\d{2}) /, "$2 $3 $1 ") + " UTC");
    return { at, lon: Number(cells[3]) };
  });
  return { rows, source, api: json.signature };
}

/* ---- astronomy-engine: same frame (apparent, true ecliptic of date) ---- */
const aeLon = (body, ms) => A.Ecliptic(A.GeoVector(AE_BODY[body], new Date(ms), true)).elon;
const aeVelocity = (body, ms, h = HOUR) => norm180(aeLon(body, ms + h) - aeLon(body, ms - h)) / (2 * h / DAY);
const signOf = lon => Math.floor(norm360(lon) / 30) % 12;

function bisect(lo, hi, predicate, tolerance) {
  // predicate(lo) is false, predicate(hi) is true
  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (predicate(mid)) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
function ingresses(body, start, stop, step) {
  const out = [];
  let t = start, sign = signOf(aeLon(body, t));
  while (t < stop) {
    const next = Math.min(t + step, stop), nextSign = signOf(aeLon(body, next));
    if (nextSign !== sign) {
      const at = bisect(t, next, x => signOf(aeLon(body, x)) !== sign, 1000);
      const to = signOf(aeLon(body, at + 1000));
      out.push([Math.round(at), to, (to - sign + 12) % 12 === 11 ? 1 : 0]);
      sign = to;
    }
    t = next;
  }
  return out;
}
function stations(body, start, stop) {
  const out = [];
  let t = start, v = aeVelocity(body, t);
  while (t < stop) {
    const next = Math.min(t + DAY / 2, stop), nv = aeVelocity(body, next);
    if (Math.sign(nv) !== Math.sign(v) && nv !== 0) {
      const at = bisect(t, next, x => Math.sign(aeVelocity(body, x)) === Math.sign(nv), 10000);
      out.push([Math.round(at), nv < 0 ? 1 : 0, signOf(aeLon(body, at))]); // 1 = stations retrograde
    }
    t = next; v = nv;
  }
  return out;
}

/* ---- spot checks of the astronomy-engine event epochs against Horizons ---- */
function horizonsIngress(body, approx) {
  const { rows } = horizons(body, approx - 30 * MIN, approx + 30 * MIN, "1m");
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (signOf(a.lon) === signOf(b.lon)) continue;
    const boundary = 30 * Math.round(norm360(b.lon) / 30);
    const da = norm180(a.lon - boundary), db = norm180(b.lon - boundary);
    return a.at + (b.at - a.at) * (da / (da - db));
  }
  return null;
}
function horizonsStation(body, approx) {
  const { rows } = horizons(body, approx - 3 * DAY, approx + 3 * DAY, "30m");
  const v = [];
  for (let i = 1; i < rows.length; i++) v.push({ at: (rows[i].at + rows[i - 1].at) / 2,
    rate: norm180(rows[i].lon - rows[i - 1].lon) / ((rows[i].at - rows[i - 1].at) / DAY) });
  // Smooth the 7-decimal quantisation with a least-squares line over a
  // +-12 h neighbourhood of the first sign change.
  for (let i = 1; i < v.length; i++) {
    if (Math.sign(v[i].rate) === Math.sign(v[i - 1].rate)) continue;
    const near = v.filter(p => Math.abs(p.at - v[i].at) <= 12 * HOUR);
    const mx = near.reduce((s, p) => s + p.at, 0) / near.length, my = near.reduce((s, p) => s + p.rate, 0) / near.length;
    const slope = near.reduce((s, p) => s + (p.at - mx) * (p.rate - my), 0) / near.reduce((s, p) => s + (p.at - mx) ** 2, 0);
    return mx - my / slope;
  }
  return null;
}

function main() {
  const grid = [];
  for (let t = GRID.start; t <= GRID.stop; t += GRID.stepMinutes * MIN) grid.push(t);
  const longitude = {}, velocity = {}, sources = {};
  for (const body of BODIES) {
    process.stderr.write(`Horizons grid: ${body}\n`);
    const { rows, source, api } = horizons(body, GRID.start, GRID.stop, `${GRID.stepMinutes}m`);
    if (rows.length !== grid.length || rows.some((r, i) => Math.abs(r.at - grid[i]) > 1000))
      throw Error(`Grid mismatch for ${body}: ${rows.length} rows, expected ${grid.length}`);
    longitude[body] = rows.map(r => r.lon);
    velocity[body] = grid.map(t => round(aeVelocity(body, t), 6));
    sources[body] = source;
    sources.api = api;
  }
  // astronomy-engine vs Horizons on the whole grid (validates layer 2).
  const aeCheck = {};
  for (const body of BODIES) {
    const errors = grid.map((t, i) => Math.abs(norm180(aeLon(body, t) - longitude[body][i]))).sort((a, b) => a - b);
    aeCheck[body] = { maxDeg: round(errors[errors.length - 1], 6), p95Deg: round(errors[Math.floor(0.95 * (errors.length - 1))], 6) };
  }
  process.stderr.write("Events\n");
  const events = { ingress: {}, station: {} };
  for (const body of BODIES) {
    if (body === "moon") events.ingress.moon = ingresses("moon", MOON_RANGE.start, MOON_RANGE.stop, 2 * HOUR);
    else events.ingress[body] = ingresses(body, EVENT_RANGE.start, EVENT_RANGE.stop, 6 * HOUR);
    if (body !== "sun" && body !== "moon") events.station[body] = stations(body, EVENT_RANGE.start, EVENT_RANGE.stop);
  }
  process.stderr.write("Horizons spot checks\n");
  const spot = [];
  const pick = (list, n) => Array.from({ length: n }, (_, i) => list[Math.floor((i + 0.5) * list.length / n)]);
  for (const [at] of pick(events.ingress.moon, 6)) {
    const h = horizonsIngress("moon", at);
    spot.push({ kind: "ingress", body: "moon", astronomyEngine: at, horizons: Math.round(h), diffMinutes: round((at - h) / MIN, 3) });
  }
  for (const body of ["sun", "mercury", "saturn"]) for (const [at] of pick(events.ingress[body], 1)) {
    const h = horizonsIngress(body, at);
    spot.push({ kind: "ingress", body, astronomyEngine: at, horizons: Math.round(h), diffMinutes: round((at - h) / MIN, 3) });
  }
  for (const body of ["mercury", "venus", "mars", "jupiter", "saturn"]) for (const [at] of pick(events.station[body], 1)) {
    const h = horizonsStation(body, at);
    spot.push({ kind: "station", body, astronomyEngine: at, horizons: Math.round(h), diffMinutes: round((at - h) / MIN, 1) });
  }
  const fixture = {
    meta: {
      purpose: "Offline accuracy reference for the horoscope ephemeris (development only; never fetched at runtime).",
      generated: new Date().toISOString().slice(0, 10),
      generator: "scripts/ephemeris-reference.cjs",
      frame: "geocentric apparent ecliptic longitude, true ecliptic and equinox of date (IAU76/80), degrees",
      timeScale: "UTC instants (Unix ms); Horizons queried in UT. UT1-UTC (<0.9 s) is ignored.",
      positions: { source: "NASA/JPL Horizons API, observer table quantity 31 (ObsEcLon), centre 500@399",
        ephemeris: sources, grid: { startMs: GRID.start, stepMinutes: GRID.stepMinutes, count: grid.length } },
      velocitiesAndEvents: { source: "astronomy-engine 2.1.19 (MIT, https://github.com/cosinekitty/astronomy), Ecliptic(GeoVector(body, t, aberration=true))",
        velocity: "central difference of the same longitude over +-1 hour, degrees per day",
        ingressTolerance: "1 s bisection", stationTolerance: "10 s bisection of the velocity sign",
        ranges: { moonIngress: [MOON_RANGE.start, MOON_RANGE.stop], other: [EVENT_RANGE.start, EVENT_RANGE.stop] },
        checkAgainstHorizonsGrid: aeCheck, spotChecks: spot },
      formats: { ingress: "[epochMs, enteredSignIdx, backward(0|1)]", station: "[epochMs, stationsRetrograde(1)|direct(0), signIdx]" },
      licence: "Horizons output is produced by NASA/JPL (US government work). astronomy-engine is MIT; only derived numbers are stored here, no source code.",
    },
    longitude, velocity, events,
  };
  fs.writeFileSync(OUT, JSON.stringify(fixture) + "\n");
  process.stderr.write(`Wrote ${OUT} (${fs.statSync(OUT).size} bytes)\n`);
  console.log(JSON.stringify({ aeCheck, spot }, null, 1));
}
main();
