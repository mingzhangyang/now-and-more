#!/usr/bin/env node
/* Build tests/fixtures/new-moons-horizons.json: the instant (TT) of every
   new moon from 1950 to 2100 according to JPL Horizons (DE441), plus the
   first quarter, full moon and last quarter of every 6th lunation — the
   reference for js/lunar.js's Meeus phases (tests/lunar.test.cjs).

   Development tool only; the site never calls an ephemeris service. It
   needs network access to the JPL Horizons API and `curl` on PATH:

     node scripts/new-moon-reference.cjs

   Method: for each lunation k, Horizons gives the geocentric apparent
   ecliptic-of-date longitude (observer quantity 31, centre 500@399, TT)
   of the Moon and the Sun at our predicted instant t and at t + 0.01 d.
   The new moon is where λMoon − λSun = 0 (quarters and full moon: 90°,
   180°, 270°); one secant step from t gives
   it to far better than a second (our prediction is already within
   ~20 s, and the elongation is linear over that span to ~1e-4 s).
   The fixture stores the Horizons instant as a Julian Ephemeris Day,
   rounded to 1e-6 d (0.09 s), and nothing derived from ΔT: ΔT is a
   separate model (docs/almanac-rules.md). */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const OUT = path.join(root, "tests", "fixtures", "new-moons-horizons.json");
const NAM_LUNAR = new Function(fs.readFileSync(path.join(root, "js/lunar.js"), "utf8") + "\nreturn NAM_LUNAR;")();
const K_FIRST = -618; // 1950-01-18
const K_LAST = 1249;  // 2100-12-01
const H = 0.01;       // days
const BATCH = 100;
const PHASE_STEP = 6; // lunations between sampled quarters / full moons

function horizons(body, jdes) {
  const input = [
    "!$$SOF", `COMMAND='${body}'`, "CENTER='500@399'", "EPHEM_TYPE='OBSERVER'", "QUANTITIES='31'",
    "TIME_TYPE='TT'", "CSV_FORMAT='YES'", "EXTRA_PREC='YES'", "TLIST=",
    ...jdes.map((t) => `'${t.toFixed(9)}'`), "",
  ].join("\n");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hz-")), "input.txt");
  fs.writeFileSync(file, input);
  for (let attempt = 0; attempt < 5; attempt++) {
    let text = "";
    try {
      text = execFileSync("curl", ["-sS", "--max-time", "180", "-F", "format=text", "-F", `input=@${file}`,
        "https://ssd.jpl.nasa.gov/api/horizons_file.api"], { encoding: "utf8", maxBuffer: 64 << 20 });
    } catch (e) { continue; } // transient network failure: try again
    const a = text.indexOf("$$SOE"), b = text.indexOf("$$EOE");
    if (a < 0 || b < 0) continue;
    const values = text.slice(a + 5, b).trim().split("\n").map((line) => Number(line.split(",")[3]));
    if (values.length !== jdes.length || values.some((v) => !Number.isFinite(v))) throw new Error("bad Horizons reply");
    return values;
  }
  throw new Error("Horizons did not answer");
}

const wrap = (d) => ((d + 180) % 360 + 360) % 360 - 180;
/* Horizons instant (JDE) of phase q for each lunation in ks. */
function solve(ks, q) {
  const out = [];
  for (let i = 0; i < ks.length; i += BATCH) {
    const chunk = ks.slice(i, i + BATCH);
    const times = chunk.flatMap((k) => { const t = NAM_LUNAR.phaseJDE(k, q); return [t, t + H]; });
    const moon = horizons("301", times), sun = horizons("10", times);
    chunk.forEach((k, j) => {
      const e0 = wrap(moon[2 * j] - sun[2 * j] - 90 * q), e1 = wrap(moon[2 * j + 1] - sun[2 * j + 1] - 90 * q);
      out.push(Math.round((times[2 * j] - e0 / ((e1 - e0) / H)) * 1e6) / 1e6);
    });
    process.stderr.write(`phase ${q}: k ${chunk[0]}…${chunk[chunk.length - 1]}\n`);
  }
  return out;
}
const all = [], sampled = [];
for (let k = K_FIRST; k <= K_LAST; k++) { all.push(k); if ((k - K_FIRST) % PHASE_STEP === 0) sampled.push(k); }
const rows = solve(all, 0).map((jde, i) => [all[i], jde]);
const phases = [];
for (const q of [1, 2, 3]) solve(sampled, q).forEach((jde, i) => phases.push([sampled[i], q, jde]));
const head = {
  source: "JPL Horizons (DE441) via scripts/new-moon-reference.cjs: apparent geocentric ecliptic-of-date " +
    "longitudes of Moon and Sun (quantity 31), new moon = equal longitudes; JDE in TT",
  fields: ["k", "jde"],
  phaseFields: ["k", "q (1 first quarter, 2 full, 3 last quarter)", "jde"],
};
fs.writeFileSync(OUT, "{\n" + Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join("") +
  '  "rows": [\n' + rows.map((r) => "    " + JSON.stringify(r)).join(",\n") + "\n  ],\n" +
  '  "phases": [\n' + phases.map((r) => "    " + JSON.stringify(r)).join(",\n") + "\n  ]\n}\n");
process.stderr.write(`wrote ${rows.length} new moons and ${phases.length} other phases to ${path.relative(root, OUT)}\n`);
