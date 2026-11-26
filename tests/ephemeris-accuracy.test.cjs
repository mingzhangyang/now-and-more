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

test("all 14 Horizons spot checks found a real event close to the astronomy-engine epoch", () => {
  // Same limits as SPOT_LIMIT_MINUTES in scripts/ephemeris-reference.cjs, kept
  // here independently so a bad fixture cannot carry its own tolerance.
  const limit = { ingress: { sun: 2, moon: 2, mercury: 2, venus: 2, mars: 5, jupiter: 90, saturn: 90 },
    station: { mercury: 20, venus: 20, mars: 20, jupiter: 30, saturn: 30 } };
  const [from, to] = fixture.meta.velocitiesAndEvents.ranges.other;
  const spots = fixture.meta.velocitiesAndEvents.spotChecks;
  assert.equal(spots.length, 14);
  assert.equal(spots.filter(s => s.kind === "ingress" && s.body === "moon").length, 6);
  assert.deepEqual(spots.filter(s => s.kind === "station").map(s => s.body), ["mercury", "venus", "mars", "jupiter", "saturn"]);
  for (const s of spots) {
    const label = `${s.body} ${s.kind}`;
    for (const at of [s.astronomyEngine, s.horizons])
      assert.ok(Number.isFinite(at) && at >= from && at <= to, `${label}: epoch ${at} outside 2000-2050`);
    assert.ok(Number.isFinite(s.diffMinutes) && Math.abs(s.diffMinutes) <= limit[s.kind][s.body], `${label}: ${s.diffMinutes} min`);
    // The stored difference is the difference of the stored epochs.
    assert.ok(Math.abs((s.astronomyEngine - s.horizons) / 60000 - s.diffMinutes) < 0.06, `${label}: inconsistent diffMinutes`);
    // And the checked epoch is one of the fixture's own events.
    const list = s.kind === "ingress" ? fixture.events.ingress[s.body] : fixture.events.station[s.body];
    assert.ok(list.some(([at]) => at === s.astronomyEngine), `${label}: not a fixture event`);
  }
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
    for (const q of ["mean", "rms", "p95", "p99", "max"])
      assert.ok(now.errorMinutes[q] <= was.errorMinutes[q] + slack.errorMinutes, `${name} ${q}: ${now.errorMinutes[q]} > ${was.errorMinutes[q]}`);
  }
});
