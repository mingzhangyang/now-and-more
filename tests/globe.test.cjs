"use strict";
/* The Meanwhile globe shades night from subsolarPoint(); it must agree with
   the sunrise and sunset the same card prints (both use the compact solar
   model in app.js). The drawing itself needs a canvas and is checked in
   the browser; here we check the astronomy and the land data's shape. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const data = fs.readFileSync(path.join(root, "js/data.js"), "utf8");
const globe = fs.readFileSync(path.join(root, "js/globe.js"), "utf8");

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
}
const api = new Function(data + "\n" +
  section("/* ================= Solar calculation", "/* ================= Moon phase") +
  "\nreturn { subsolarPoint, sunTimes, CITIES };")();

const RAD = Math.PI / 180;
function sunAltitudeDeg(date, lat, lon) {
  const s = api.subsolarPoint(date);
  const v = Math.sin(lat * RAD) * Math.sin(s.lat * RAD) +
    Math.cos(lat * RAD) * Math.cos(s.lat * RAD) * Math.cos((lon - s.lon) * RAD);
  return Math.asin(v) / RAD;
}

test("subsolar point: declination and longitude at known moments", () => {
  // June solstice: the Sun stands over the Tropic of Cancer.
  const june = api.subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12)));
  assert.ok(Math.abs(june.lat - 23.44) < 0.1, `June lat ${june.lat}`);
  // At 12:00 UTC the Sun is near Greenwich, off by the equation of time
  // (late Nov: sundials run ~12 min fast, so it crossed Greenwich at
  // about 11:48 and is now ~3° west).
  const nov = api.subsolarPoint(new Date(Date.UTC(2026, 10, 28, 12)));
  assert.ok(nov.lon < -2 && nov.lon > -4.5, `Nov lon ${nov.lon}`);
  assert.ok(nov.lat < -21 && nov.lat > -21.6, `Nov lat ${nov.lat}`);
  // Six hours later it has moved 90° west.
  const later = api.subsolarPoint(new Date(Date.UTC(2026, 10, 28, 18)));
  assert.ok(Math.abs(((nov.lon - later.lon + 540) % 360) - 180 - 90) < 0.2);
});

test("the globe's day/night line matches every city's printed sunrise and sunset", () => {
  const day = new Date(Date.UTC(2026, 10, 28, 12));
  let checked = 0;
  for (const c of api.CITIES) {
    const st = api.sunTimes(day, c.lat, c.lon);
    if (st.polar) {
      // Polar day: the Sun stays above the horizon at midnight too.
      if (st.polar === "day") {
        const lowest = Math.min(...[0, 6, 12, 18].map(h => sunAltitudeDeg(new Date(day.getTime() + h * 3600000), c.lat, c.lon)));
        assert.ok(lowest > -1, `${c.en} lowest ${lowest.toFixed(2)}°`);
      }
      continue;
    }
    for (const t of [st.sunrise, st.sunset]) {
      const alt = sunAltitudeDeg(t, c.lat, c.lon);
      assert.ok(Math.abs(alt - -0.833) < 0.35, `${c.en} ${alt.toFixed(2)}°`);
    }
    checked++;
  }
  assert.ok(checked > 120);
});

test("land data: 0.5° rings, a ring around the South Pole, nothing malformed", () => {
  const land = new Function(globe.replace(/const NAM_GLOBE[\s\S]*$/, "") + "\nreturn GLOBE_LAND;")();
  const rings = land.split(";");
  assert.ok(rings.length > 100 && land.length < 40000);
  let polar = 0;
  for (const r of rings) {
    const v = r.split(",").map(Number);
    assert.ok(v.length >= 6 && v.length % 2 === 0 && v.every(Number.isInteger));
    let net = 0;
    for (let i = 2; i < v.length; i += 2) {
      let dx = v[i];
      if (dx > 360) dx -= 720; else if (dx < -360) dx += 720;
      net += dx;
    }
    if (Math.abs(net) > 600) polar++;
  }
  assert.equal(polar, 1); // Antarctica
});
