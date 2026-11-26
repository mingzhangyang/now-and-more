"use strict";
const HORO_BASELINE_SHA = "74519fb4f70ef4a0ba1b71b13948e7c173e9e494";
function loadHoroscope(astro, app, data = "", advice = "") {
  const start = app.indexOf("const TERM_VSOP_L0 =");
  const end = app.indexOf("function angDiffDeg(", start);
  if (start < 0 || end <= start) throw Error("Missing solar ephemeris");
  return new Function(data+"\n"+advice+"\nconst RAD=Math.PI/180,DAY_MS=86400000;\n"+app.slice(start,end)+"\n"+astro+
    "\nreturn {scoreHoroscope,scoreHoroscopeSamples,scoreHoroscopeDay,horoscopeSky,planetPositions,horoscopeAspect,horoscopeAspectValue,horoscopeStars,HORO_DOMAINS,HORO_RULERS,HORO_BODIES,HORO_FACTORS,makeHoroscope,horoscopeFullText,horoscopeDomainCopy,"+
    (astro.includes("const HORO_V32") ? "HORO_V32,HORO_V31,HORO_ROLE_WEIGHTS,HORO_PAIR_WEIGHTS,horoscopePairRecords,horoscopeHouseRulers,horoscopeRoleWeight,horoscopeCombinationWeight,horoscopeRulerCopy,horoscopeCombinationCopy," : "")+
    "};")();
}

module.exports={loadHoroscope,HORO_BASELINE_SHA};
