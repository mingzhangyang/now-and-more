"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const app = read("js/app.js");
const data = read("js/data.js");
const start = app.indexOf("/* ================= Astrology (astro) ================= */");
const end = app.indexOf("/* ================= End astrology ================= */", start);
assert.ok(start >= 0 && end > start);
const solarStart = app.indexOf("const TERM_VSOP_L0 =");
const solarEnd = app.indexOf("function angDiffDeg(", solarStart);
assert.ok(solarStart >= 0 && solarEnd > solarStart);
const renderStart = app.indexOf('  if (sel.cat === "astro") {');
const renderEnd = app.indexOf('  if (sel.cat === "gossip") {', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const api = new Function(data + "\nconst RAD = Math.PI / 180, DAY_MS = 86400000;\n" +
  app.slice(solarStart, solarEnd) + "\n" +
  app.slice(start, end) + "\n" +
  "function render(sel, lang) { let meta, body; const s = I18N[lang];\n" +
  app.slice(renderStart, renderEnd) + "\nreturn {meta, body}; }\n" +
  "return {makeHoroscope, planetPositions, scoreHoroscope, horoscopeAspect, horoscopeAspectValue, horoscopeCopy, render, SIGNS, LUCKY_COLORS, LUCKY_ITEMS, LUCKY_DIRECTIONS};")();
const keys = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
const fixture = (lon, retrograde = []) => keys.map(key => ({
  key, lon, signIdx: Math.floor(lon / 30), retrograde: retrograde.includes(key)
}));
test("actual date calculation is stable for all 12 signs across local-day times", () => {
  for (const [y,m,d] of [[2026,10,25],[2026,2,8],[2026,10,1],[2028,1,29],[2026,11,31]]) {
    for (let sign = 0; sign < 12; sign++) {
      const morning = api.makeHoroscope(new Date(y,m,d,0,1), sign);
      const evening = api.makeHoroscope(new Date(y,m,d,23,59), sign);
      assert.deepEqual(morning, evening);
      const computed = api.scoreHoroscope(sign, api.planetPositions(new Date(y,m,d,12)));
      assert.equal(morning.stars, computed.stars);
      assert.deepEqual(morning.domains, computed.domains);
    }
  }
});
test("scores respond to sign geometry and real retrograde inputs, not a date seed", () => {
  const supportive = api.scoreHoroscope(0, fixture(120));
  const challenging = api.scoreHoroscope(0, fixture(90));
  assert.ok(supportive.stars > challenging.stars);
  assert.ok(supportive.domains.every(d => d.stars > challenging.domains.find(c => c.key === d.key).stars));
  const direct = api.scoreHoroscope(0, fixture(120));
  const retro = api.scoreHoroscope(0, fixture(120, ["mercury"]));
  assert.ok(retro.domains.find(d => d.key === "social").raw < direct.domains.find(d => d.key === "social").raw);
  assert.notDeepEqual(api.scoreHoroscope(0, fixture(120)), api.scoreHoroscope(1, fixture(120)));
});
test("major aspects handle 0/360 wrap and reject out-of-orb pairs", () => {
  const p = lon => ({ lon });
  assert.equal(api.horoscopeAspect(p(359),p(1)).angle, 0);
  assert.equal(api.horoscopeAspect(p(359),p(59)).angle, 60);
  assert.equal(api.horoscopeAspect(p(0),p(90)).angle, 90);
  assert.equal(api.horoscopeAspect(p(0),p(120)).angle, 120);
  assert.equal(api.horoscopeAspect(p(0),p(180)).angle, 180);
  assert.equal(api.horoscopeAspect(p(0),p(42)), null);
  assert.equal(api.horoscopeAspect(p(0),p(68)), null);
  const a = {key:"venus", lon:0}, b = {key:"jupiter", lon:0}, c = {key:"saturn", lon:0}, d = {key:"mars", lon:0};
  assert.ok(api.horoscopeAspectValue(api.horoscopeAspect(a,b),a,b)>0);
  assert.ok(api.horoscopeAspectValue(api.horoscopeAspect(c,d),c,d)<0);
});
test("every day's focus and aspect are traceable to its noon positions; scores and cue indices stay bounded", () => {
  const seen = new Set();
  for (let offset = 0; offset < 366; offset++) {
    const date = new Date(2026,0,1+offset,12);
    const positions = api.planetPositions(date);
    for(let sign = 0; sign < 12; sign++) {
      const h = api.makeHoroscope(date, sign);
      seen.add(h.stars);
      assert.ok(h.stars >= 1 && h.stars <= 5);
      assert.equal(h.domains.length,4);
      for(const d of h.domains) {
        assert.ok(Number.isFinite(d.raw) && d.stars >= 1 && d.stars <= 5);
        const f = d.focus, actual = positions.find(p => p.key === f.key);
        assert.ok(actual);
        assert.equal(f.signIdx, actual.signIdx);
        assert.equal(f.retrograde, actual.retrograde);
        assert.equal(f.house,(actual.signIdx-sign+12)%12+1);
        if(f.aspect) {
          const other = positions.find(p=>p.key===f.aspect.other);
          assert.ok(other && other.key !== actual.key);
          assert.equal(api.horoscopeAspect(actual,other).angle,f.aspect.angle);
        }
      }
      assert.ok(h.luckyNumber>=1 && h.luckyNumber<=99);
      assert.ok(api.LUCKY_COLORS[h.colorIdx] && api.LUCKY_DIRECTIONS[h.dirIdx] && api.LUCKY_ITEMS[h.itemIdx]);
      assert.ok(api.horoscopeCopy(h,"zh").advice && api.horoscopeCopy(h,"en").advice);
    }
  }
  assert.ok(seen.size >= 3);
});
test("bilingual card displays the same stored ratings, real evidence and entertainment disclaimer", () => {
  const h = api.makeHoroscope(new Date(2026,10,25),7);
  for(const lang of ["zh","en"]) {
    const sel = {cat:"astro",subtype:"horoscope",horo:h};
    const copy = api.horoscopeCopy(h,lang);
    const card = api.render(sel,lang);
    assert.ok(card.body.includes(copy.evidence));
    assert.ok(card.body.includes(copy.advice));
    assert.ok(card.body.includes(copy.basis));
    assert.ok(card.body.includes(copy.cues));
    if(copy.aspect) assert.ok(card.body.includes(copy.aspect));
    assert.ok(card.body.includes("★".repeat(h.stars)+"☆".repeat(5-h.stars)));
    for (const d of h.domains) assert.ok(card.body.includes('aria-label="'+d.stars+'/5"'));
    assert.match(card.body, lang === "zh" ? /仅供娱乐/ : /entertainment only/);
    assert.ok(!card.body.includes("undefined"));
  }
  assert.ok(!api.render({cat:"astro",subtype:"positions",positions:api.planetPositions(new Date(2026,10,25,12))},"en").body.includes("undefined"));
  assert.ok(!api.render({cat:"astro",subtype:"profile",signIdx:7},"zh").body.includes("undefined"));
});
test("real Mercury stations use the motion at noon and affect the daily rating", () => {
  const positionsAt = day => api.planetPositions(new Date(day + "T12:00:00Z"));
  // Independent Moshier/Swiss Ephemeris 2.10.03 speed signs at UTC noon.
  for (const [day, retrograde] of [["2026-02-24", false], ["2026-02-25", false],
    ["2026-02-26", true], ["2026-03-19", true], ["2026-03-20", true], ["2026-03-21", false]]) {
    const positions = positionsAt(day);
    assert.equal(positions.find(p => p.key === "mercury").retrograde, retrograde, day);
    const actual = api.scoreHoroscope(4, positions).domains.find(d => d.key === "social");
    const flipped = api.scoreHoroscope(4, positions.map(p => p.key === "mercury"
      ? { ...p, retrograde: !p.retrograde } : p)).domains.find(d => d.key === "social");
    assert.ok(retrograde ? actual.raw < flipped.raw : actual.raw > flipped.raw, day);
    if (day === "2026-02-24") {
      assert.equal(actual.stars, 3);
      assert.equal(flipped.stars, 2);
    }
  }
});
test("of-date tropical positions agree with independent reference longitudes and solar ingresses", () => {
  const at = day => api.planetPositions(new Date(day + "T12:00:00Z"));
  // Swiss Ephemeris 2.10.03, Moshier, apparent geocentric tropical degrees.
  // The approximate lunar/planetary model allows looser tolerances than the Sun.
  const references = [
    ["2026-06-21", [90.14282, 175.21724, 113.70082, 129.33059, 54.75531, 118.15348, 13.70920]],
    ["2049-01-01", [281.50271, 244.90611, 299.31585, 328.70964, 344.43490, 83.93674, 287.55821]],
  ];
  const tolerances = [0.01, 0.5, 0.08, 0.08, 0.08, 0.25, 0.25];
  for (const [day, expected] of references) {
    for (const [i, p] of at(day).entries()) {
      const error = Math.abs(((p.lon - expected[i] + 540) % 360) - 180);
      assert.ok(error < tolerances[i], `${day} ${p.key}: ${p.lon} vs ${expected[i]}`);
    }
  }
  for (const [day, sign] of [["2026-03-20", 11], ["2026-03-21", 0],
    ["2026-06-20", 2], ["2026-06-21", 3]]) {
    assert.equal(at(day).find(p => p.key === "sun").signIdx, sign, day);
  }
  const work = day => api.scoreHoroscope(1, at(day)).domains.find(d => d.key === "work").stars;
  assert.equal(work("2026-06-20"), 3);
  assert.equal(work("2026-06-21"), 4);
});
test("PWA shell and all four HTML pages agree on the asset version", () => {
  const sw=read("sw.js");
  const version=sw.match(/nam-v(\d+)/)[1];
  for (const name of ["index.html","about.html","privacy.html","library.html","sw.js"]) {
    const versions=[...read(name).matchAll(/\?v=(\d+)/g)].map(m=>m[1]);
    assert.ok(versions.length && versions.every(v=>v===version));
  }
});
