"use strict";
/* Ephemeris accuracy against the offline JPL Horizons / astronomy-engine
   reference (tests/fixtures/ephemeris-reference.json). The recorded
   baseline (docs/ephemeris-accuracy-baseline.json) is a ceiling: an
   ephemeris change may improve any figure, but must not make one worse.
   After an intentional improvement, refresh the baseline with
   `node scripts/ephemeris-accuracy.cjs --write` and update
   docs/ephemeris-accuracy.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fixture = require("./fixtures/ephemeris-reference.json");
const baseline = require("../docs/ephemeris-accuracy-baseline.json");
const { evaluate } = require(path.join(__dirname, "..", "scripts", "ephemeris-accuracy.cjs"));

const BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
const result = evaluate(fixture);
// One unit in the last reported digit, for floating-point drift between runtimes.
const slack = { longitudeDeg: 1e-4, velocityDegPerDay: 1e-6, errorMinutes: 0.1, pct: 1e-3 };

test("the reference fixture states its source, frame and coverage", () => {
  const { meta } = fixture;
  assert.match(meta.positions.source, /Horizons/);
  assert.match(meta.frame, /apparent/);
  assert.match(meta.frame, /of date/);
  assert.equal(meta.positions.ephemeris.sun, "DE441");
  assert.equal(meta.positions.grid.count, 1315);
  for (const body of BODIES) {
    assert.equal(fixture.longitude[body].length, meta.positions.grid.count);
    assert.equal(fixture.velocity[body].length, meta.positions.grid.count);
  }
  // The secondary reference agrees with Horizons far below the errors measured here.
  for (const body of BODIES) assert.ok(meta.velocitiesAndEvents.checkAgainstHorizonsGrid[body].maxDeg < 0.01);
});

test("longitude and velocity errors do not exceed the recorded baseline", () => {
  for (const body of BODIES) {
    for (const metric of ["longitudeDeg", "velocityDegPerDay"]) for (const q of ["mean", "rms", "p95", "p99", "max"]) {
      assert.ok(result.bodies[body][metric][q] <= baseline.bodies[body][metric][q] + slack[metric],
        `${body} ${metric} ${q}: ${result.bodies[body][metric][q]} > ${baseline.bodies[body][metric][q]}`);
    }
    for (const key of ["signAgreementPct", "directionAgreementPct"]) if (key in baseline.bodies[body])
      assert.ok(result.bodies[body][key] >= baseline.bodies[body][key] - slack.pct, `${body} ${key}`);
  }
});

test("aspect identification agreement does not regress", () => {
  for (const key of ["identificationAgreementPct", "moonPairsAgreementPct", "otherPairsAgreementPct", "motionStateAgreementPct"])
    assert.ok(result.aspects[key] >= baseline.aspects[key] - slack.pct, key);
});

test("event detection finds every reference ingress and station, with no extra events and no slower timing", () => {
  assert.deepEqual(Object.keys(result.events).sort(), Object.keys(baseline.events).sort());
  for (const [name, now] of Object.entries(result.events)) {
    const was = baseline.events[name];
    assert.equal(now.reference, was.reference, name);
    assert.ok(now.missed <= was.missed && now.extra <= was.extra, `${name}: missed ${now.missed}, extra ${now.extra}`);
    for (const q of ["mean", "p95", "max"])
      assert.ok(now.errorMinutes[q] <= was.errorMinutes[q] + slack.errorMinutes, `${name} ${q}: ${now.errorMinutes[q]} > ${was.errorMinutes[q]}`);
  }
});
