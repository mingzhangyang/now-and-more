"use strict";
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const sdkDir = path.join(root, "vendor/sky-engine/0.2.0");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("vendored Sky Engine 0.2.0 matches the published checksums", () => {
  const sums = fs.readFileSync(path.join(sdkDir, "SHA256SUMS"), "utf8").trim().split(/\n/);
  const expected = new Map();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})\s+(\S+)$/.exec(line.trim());
    assert.ok(match, line);
    expected.set(match[2], match[1]);
  }
  for (const name of ["sky-engine.mjs", "stars.json", "sky-engine-NOTICES.txt", "manifest.json", "moon-lroc.jpg"]) {
    const hash = createHash("sha256").update(fs.readFileSync(path.join(sdkDir, name))).digest("hex");
    assert.equal(hash, expected.get(name), name);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(sdkDir, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.tag, "sky-engine-v0.2.0");
  assert.equal(manifest.sourceCommit, "c177b659cf1bc5200698c11d3ec408890fbcc297");
  assert.equal(manifest.moonTexture.sha256, "f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170");
  const notices = fs.readFileSync(path.join(sdkDir, "sky-engine-NOTICES.txt"), "utf8");
  assert.match(notices, /CC BY-SA 4\.0|CC-BY-SA-4\.0|Creative Commons/i);
  assert.match(notices, /MIT/);
});

test("signature patterns are real HYG ids, not chart indexes", () => {
  const data = read("js/data.js");
  assert.doesNotMatch(data, /SKY_STARS|SKY_FIELD|SKY_ASTERISMS/);
  const ids = [...data.matchAll(/hyg-\d+/g)].map((m) => Number(m[0].slice(4)));
  assert.ok(ids.length >= 40);
  const catalog = JSON.parse(fs.readFileSync(path.join(sdkDir, "stars.json"), "utf8"));
  const have = new Set(catalog[0]);
  for (const id of ids) assert.ok(have.has(id), "missing hyg " + id);
});

test("app keeps business astronomy and drops the ported illustration engine", () => {
  const app = read("js/app.js");
  assert.match(app, /function sunTimes/);
  assert.match(app, /function moonPhase/);
  assert.match(app, /function computeAlmanac/);
  assert.match(app, /function planetPositions/);
  assert.match(app, /NAM_SKY\.sceneFor/);
  assert.match(app, /NAM_SKY\.paintIllustration/);
  assert.match(app, /NAM_SKY\.paintChart/);
  assert.match(app, /NAM_SKY\.paintMoon/);
  assert.match(read("js/sky-engine-adapter.js"), /weather: "clear"/);
  for (const gone of [
    "function drawSkyIllustration",
    "function drawSkyChart",
    "function drawSkyMoon",
    "function skyMilkyWay",
    "function skyPlanets",
    "function computeSkyScene",
    "function skyCreateProjection",
    "SKY_FIELD",
    "SKY_STARS",
  ]) {
    assert.equal(app.includes(gone), false, gone);
  }
  const sw = read("sw.js");
  assert.match(sw, /nam-v33/);
  assert.match(sw, /vendor\/sky-engine\/0\.2\.0\/sky-engine\.mjs/);
  assert.match(sw, /vendor\/sky-engine\/0\.2\.0\/stars\.json/);
  assert.match(sw, /vendor\/sky-engine\/0\.2\.0\/moon-lroc\.jpg/);
  assert.doesNotMatch(read("js/sky-engine-adapter.js"), /cdn|jsdelivr|unpkg|elsewhere\.|github\.com/i);
});

test("fixed scenes match Sky Engine 0.2.0", async () => {
  const { createSkyScene, decodeStarColumns, starCatalogLoaded } = await import(
    path.join(sdkDir, "sky-engine.mjs")
  );
  const rows = decodeStarColumns(JSON.parse(fs.readFileSync(path.join(sdkDir, "stars.json"), "utf8")));
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/sky-scenes.json"), "utf8"));
  assert.equal(fixtures.length, 7);
  for (const fixture of fixtures) {
    const scene = await createSkyScene({
      latitude: fixture.lat,
      longitude: fixture.lon,
      timezone: fixture.tz,
      instant: new Date(fixture.instant),
      weather: "clear",
      loadCatalog: starCatalogLoaded() ? undefined : async () => rows,
    });
    assert.equal(scene.provenance.kind, "clear");
    assert.equal(scene.sky.stars.length, 5070);
    const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${fixture.name} ${label} ${a} vs ${b}`);
    near(scene.sky.sun.altitude, fixture.sun.alt, 0.02, "sun.alt");
    near(scene.sky.sun.azimuth, fixture.sun.az, 0.02, "sun.az");
    near(scene.sky.moon.altitude, fixture.moon.alt, 0.02, "moon.alt");
    near(scene.sky.moon.azimuth, fixture.moon.az, 0.02, "moon.az");
    near(scene.sky.moon.illumination, fixture.moon.illum, 0.002, "moon.illum");
    assert.equal(scene.sky.moon.phase, fixture.moon.phase);
    assert.equal(scene.sky.moon.visible, fixture.moon.visible);
    for (const [id, pos] of Object.entries(fixture.stars)) {
      const star = scene.sky.stars.find((s) => s.id === id);
      assert.ok(star, id);
      near(star.altitude, pos.alt, 0.02, id + ".alt");
      near(star.azimuth, pos.az, 0.02, id + ".az");
    }
    for (const planet of scene.sky.planets) {
      const want = fixture.planets[planet.id];
      near(planet.altitude, want.alt, 0.02, planet.id + ".alt");
      near(planet.azimuth, want.az, 0.02, planet.id + ".az");
      near(planet.magnitude, want.mag, 0.01, planet.id + ".mag");
    }
  }
});
