"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const app = read("js/app.js");
const data = read("js/data.js");
const adviceSource = read("js/horoscope-advice.js");
const astro = read("js/astro.js");
const solarStart = app.indexOf("const TERM_VSOP_L0 =");
const solarEnd = app.indexOf("function angDiffDeg(", solarStart);
assert.ok(solarStart >= 0 && solarEnd > solarStart);
const renderStart = app.indexOf('  if (sel.cat === "astro") {');
const renderEnd = app.indexOf('  if (sel.cat === "gossip") {', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const fullStart = app.indexOf("let fullOpener = null;");
const fullEnd = app.indexOf("/* ================= Picture cards:", fullStart);
const escStart = app.indexOf("function esc(str)");
const escEnd = app.indexOf("function renderPostcard(", escStart);
const footerStart = app.indexOf("  if (surface.foot && surface.fullBtn && fullTextOf(");
const footerEnd = app.indexOf("\n\n  // Chart and the in-card", footerStart);
assert.ok(fullStart >= 0 && fullEnd > fullStart && escStart >= 0 && escEnd > escStart && footerStart >= 0 && footerEnd > footerStart);
const api = new Function(data + "\n" + adviceSource + "\nconst RAD = Math.PI / 180, DAY_MS = 86400000;\n" +
  app.slice(solarStart, solarEnd) + "\n" +
  astro + "\n" +
  "function render(sel, lang) { let meta, body; const s = I18N[lang];\n" +
  app.slice(renderStart, renderEnd) + "\nreturn {meta, body}; }\n" +
  app.slice(escStart, escEnd) + "\n" +
  `function reading(sel, lang) {
    const ids = ["full-text-btn", "full-close", "full-overlay", "full-body", "full-cat", "full-source"];
    const elements = Object.fromEntries(ids.map(id => [id, {
      hidden: true, isConnected: true, listeners: {}, focused: false,
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, focus() { this.focused = true; }
    }]));
    const $ = id => elements[id];
    const dialog = { scrollTop: 42 };
    const document = { addEventListener() {}, querySelector: () => dialog };
    const t = () => I18N[lang];
    const s = t();
    let currentSelection = sel, ambientOn = false, activeModal = null, stopped = false;
    const showModal = id => { $(id).hidden = false; activeModal = id; };
    const hideModal = id => { $(id).hidden = true; activeModal = null; };
  ` + app.slice(fullStart, fullEnd) + `
    const surface = { foot: { hidden: true }, fullBtn: $("full-text-btn") };
  ` + app.slice(footerStart, footerEnd) + `
    const visible = !surface.foot.hidden;
    if (visible) $("full-text-btn").listeners.click({ currentTarget: $("full-text-btn"),
      stopPropagation() { stopped = true; } });
    const result = { visible, stopped, opened: activeModal === "full-overlay",
      title: $("full-cat").textContent, body: $("full-body").innerHTML,
      source: $("full-source").textContent, label: $("full-text-btn").textContent,
      resetScroll: dialog.scrollTop === 0, closeFocused: $("full-close").focused };
    if (result.opened) $("full-close").listeners.click();
    return { ...result, closed: $("full-overlay").hidden, restoredFocus: $("full-text-btn").focused };
  }
  return {makeHoroscope, planetPositions, detectHoroscopeEvents, horoscopeEventsForDate, horoscopeEventCopy, horoscopeEventLabel, horoscopeEventParagraphs, horoscopeEventSummary, scoreHoroscope, horoscopeAspect, horoscopeAspectValue, horoscopeCopy, horoscopeFocusCopy, horoscopeTone, horoscopeDomainCopy, horoscopeActionFor, horoscopeAdviceWeights, bestHoroscopeAction, horoscopeActionOrder, horoscopeActionWindow, horoscopeBalanceCopy, horoscopeFocusGroups, horoscopeFocusKey, horoscopeAspectKey, horoscopeFullText, render, reading, HORO_DOMAINS, HORO_BODY_THEMES, HORO_HOUSE_THEMES, HORO_DOMAIN_ACTIONS, HORO_ASPECT_ACTIONS, HORO_CONJUNCTION_ACTIONS, HORO_RETROGRADE_ACTIONS, SIGNS, LUCKY_COLORS, LUCKY_ITEMS, LUCKY_DIRECTIONS};`)();
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
        assert.ok(Math.abs(d.contributions.reduce((s,t)=>s+t.value,0)-d.raw)<1e-12);
        assert.equal(new Set(d.contributions.map(t=>t.key)).size,d.contributions.length);
        assert.ok(d.contributions.every(t=>keys.includes(t.key)&&Number.isFinite(t.value)));
        const largest=d.contributions.reduce((best,t)=>Math.abs(t.value)>Math.abs(best.value)?t:best);
        assert.equal(largest.key,d.focus.key);
        const f = d.focus, actual = positions.find(p => p.key === f.key);
        assert.ok(actual);
        assert.equal(f.signIdx, actual.signIdx);
        assert.equal(f.retrograde, actual.retrograde);
        assert.equal(f.house,(actual.signIdx-sign+12)%12+1);
        for (const [li, lang] of ["zh","en"].entries()) {
          const detail = api.horoscopeDomainCopy(d,h,lang);
          assert.ok(detail.advice.includes(api.horoscopeActionFor(d,h).text[li]));
          assert.ok(detail.placement.includes(api.HORO_BODY_THEMES[f.key][li]));
          assert.ok(detail.placement.includes(api.HORO_HOUSE_THEMES[f.house-1].theme[li]));
          assert.ok(detail.placement.includes(api.HORO_HOUSE_THEMES[f.house-1].action[li]));
          assert.equal(Boolean(detail.aspectInterpretation),Boolean(f.aspect));
          assert.equal(Boolean(detail.retrogradeInterpretation),f.retrograde);
          if (f.retrograde) assert.ok(detail.retrogradeInterpretation.includes(api.HORO_RETROGRADE_ACTIONS[f.key][li]));
          assert.ok(!JSON.stringify(detail).includes("undefined"));
        }
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
test("bilingual compact card displays the stored ratings, summary advice and entertainment disclaimer", () => {
  const h = api.makeHoroscope(new Date(2026,10,25),7);
  for(const lang of ["zh","en"]) {
    const sel = {cat:"astro",subtype:"horoscope",horo:h};
    const copy = api.horoscopeCopy(h,lang);
    const card = api.render(sel,lang);
    assert.ok(!card.body.includes(copy.evidence));
    assert.ok(card.body.includes(copy.advice));
    assert.ok(!card.body.includes(copy.basis));
    assert.ok(card.body.includes(copy.cues));
    if(copy.aspect) assert.ok(!card.body.includes(copy.aspect));
    assert.ok(card.body.includes("★".repeat(h.stars)+"☆".repeat(5-h.stars)));
    for (const d of h.domains) assert.ok(card.body.includes('aria-label="'+d.stars+'/5"'));
    assert.match(card.body, lang === "zh" ? /仅供娱乐/ : /entertainment only/);
    assert.ok(!card.body.includes("undefined"));
  }
  assert.ok(!api.render({cat:"astro",subtype:"positions",positions:api.planetPositions(new Date(2026,10,25,12))},"en").body.includes("undefined"));
  assert.ok(!api.render({cat:"astro",subtype:"profile",signIdx:7},"zh").body.includes("undefined"));
});
test("full-text door opens the same calculated horoscope in both languages and preserves reading behavior", () => {
  const h = api.makeHoroscope(new Date(2026,10,25),7);
  const sel = {cat:"astro",subtype:"horoscope",horo:h};
  const snapshot = JSON.stringify(sel);
  for (const lang of ["zh","en"]) {
    const copy = api.horoscopeCopy(h,lang);
    const full = api.horoscopeFullText(h,lang);
    const paragraphs = full.split("\n\n");
    const groups=api.horoscopeFocusGroups(h.domains);
    const eventParagraphs=api.horoscopeEventParagraphs(h,lang);
    assert.equal(paragraphs.length, 8 + groups.size + eventParagraphs.length);
    assert.deepEqual(paragraphs.slice(2,2+eventParagraphs.length),eventParagraphs);
    assert.ok(paragraphs[0].includes(api.SIGNS[h.signIdx][lang]));
    assert.ok(paragraphs[0].includes(h.stars + "/5"));
    for (const [i, d] of h.domains.entries()) {
      const domain = api.HORO_DOMAINS.find(x => x.key === d.key);
      const focus = api.horoscopeFocusCopy(d.focus,lang);
      const paragraph = paragraphs[2+eventParagraphs.length+i];
      assert.ok(paragraph.startsWith(domain[lang] + " " + d.stars + "/5"));
      const group=groups.get(api.horoscopeFocusKey(d.focus));
      const shared=paragraphs[5+eventParagraphs.length+group.id];
      const title=(lang==="zh"?"星位解读 ":"Sky reading ")+group.id;
      assert.ok(paragraph.includes(title));
      assert.ok(paragraph.includes(api.horoscopeBalanceCopy(d,lang)));
      assert.ok(shared.startsWith(title+" · "));
      assert.ok(shared.includes(domain[lang]));
      assert.ok(shared.includes(focus.evidence));
      if (focus.aspect) assert.ok(shared.includes(focus.aspect));
      const detail = api.horoscopeDomainCopy(d,h,lang);
      assert.ok(shared.includes(detail.placement) && paragraph.includes(detail.advice));
      if (detail.retrogradeInterpretation) assert.ok(shared.includes(detail.retrogradeInterpretation));
      if (d.key === h.primary) assert.ok(paragraph.includes(copy.advice));
    }
    const dialog = api.reading(sel,lang);
    assert.ok(dialog.visible && dialog.stopped && dialog.opened && dialog.resetScroll && dialog.closeFocused);
    assert.ok(dialog.closed && dialog.restoredFocus);
    assert.equal(dialog.label, lang === "zh" ? "全文 ›" : "Full text ›");
    assert.ok(dialog.body.includes(copy.evidence) && dialog.body.includes(copy.basis));
    assert.match(dialog.body, lang === "zh" ? /仅供娱乐/ : /entertainment only/);
    assert.ok(!dialog.body.includes("undefined"));
    assert.equal((dialog.body.match(/<p>/g) || []).length, 8 + groups.size + eventParagraphs.length);
    assert.equal(api.horoscopeFullText(h,lang), full);
  }
  assert.equal(JSON.stringify(sel),snapshot);
});
test("the shared full-text door preserves ordinary bilingual passages and hides for non-reading cards", () => {
  const passage = {cat:"classics",item:{full:"中文 <文>",fullEn:"English <text>",source:"Source"}};
  for (const [lang,expected] of [["zh","中文 &lt;文&gt;"],["en","English &lt;text&gt;"]]) {
    const dialog = api.reading(passage,lang);
    assert.ok(dialog.visible && dialog.opened && dialog.closed && dialog.restoredFocus);
    assert.ok(dialog.body.includes(expected));
    assert.equal(dialog.source,"Source");
  }
  for (const sel of [{cat:"astro",subtype:"positions"},{cat:"astro",subtype:"profile",signIdx:7},{cat:"world"},{cat:"classics",item:{text:"short"}}]) {
    const dialog = api.reading(sel,"zh");
    assert.equal(dialog.visible,false);
    assert.equal(dialog.opened,false);
  }
});
test("identical ratings produce different bilingual advice for different actual bodies, houses and aspects", () => {
  const base = {key:"social", stars:3, raw:0, focus:{key:"mercury",signIdx:2,house:3,retrograde:false,aspect:null}};
  const h = {primary:"social",adviceIdx:0};
  const make = (changes, lang, domain=base.key) => api.horoscopeDomainCopy({...base,key:domain,focus:{...base.focus,...changes}},h,lang);
  const aspect = (angle, other, strength=1, value=0.6) => ({
    angle, other, strength, value, zh:{0:"合相",60:"六合",90:"四分相",120:"三分相",180:"对冲"}[angle],
    en:{0:"conjunction",60:"sextile",90:"square",120:"trine",180:"opposition"}[angle]
  });
  for (const [li,lang] of ["zh","en"].entries()) {
    const direct = make({},lang);
    const jupiter = make({key:"jupiter"},lang);
    const venus = make({key:"venus"},lang);
    assert.ok(api.HORO_DOMAIN_ACTIONS.social.mercury.some(action=>direct.advice.includes(action.text[li])));
    assert.notEqual(direct.advice,jupiter.advice);
    assert.notEqual(venus.advice,jupiter.advice);
    assert.notEqual(direct.advice,make({},lang,"work").advice);
    assert.equal(direct.aspectInterpretation,"");
    assert.equal(direct.retrogradeInterpretation,"");
    const fourth = make({house:4,signIdx:3},lang);
    assert.notEqual(fourth.placement,direct.placement);
    assert.ok(fourth.placement.includes(api.HORO_HOUSE_THEMES[3].action[li]));
    const retro = make({retrograde:true},lang);
    assert.ok(retro.retrogradeInterpretation.includes(api.HORO_RETROGRADE_ACTIONS.mercury[li]));
    const square = make({aspect:aspect(90,"saturn",0.8,-0.68)},lang);
    const trine = make({aspect:aspect(120,"saturn",0.8,0.52)},lang);
    assert.ok(square.aspectInterpretation.toLowerCase().includes(api.HORO_ASPECT_ACTIONS[90][li].toLowerCase()));
    assert.ok(trine.aspectInterpretation.toLowerCase().includes(api.HORO_ASPECT_ACTIONS[120][li].toLowerCase()));
    assert.notEqual(square.aspectInterpretation,trine.aspectInterpretation);
    assert.notEqual(square.aspectInterpretation,make({aspect:aspect(90,"venus",0.8,-0.68)},lang).aspectInterpretation);
    for (const [value,tone] of [[0.55,"support"],[-0.55,"challenge"],[0,"neutral"]]) {
      const detail=make({aspect:aspect(0,"venus",1,value)},lang);
      assert.ok(detail.aspectInterpretation.toLowerCase().includes(api.HORO_CONJUNCTION_ACTIONS[tone][li].toLowerCase()));
    }
    const edge=make({aspect:aspect(90,"saturn",0,0)},lang);
    assert.match(edge.aspectInterpretation,li===0?/不产生相位贡献/:/contributes no aspect weight/);
    assert.ok(!edge.aspectInterpretation.toLowerCase().includes(api.HORO_ASPECT_ACTIONS[90][li].toLowerCase()));
    const cautious=api.horoscopeDomainCopy({...base,raw:-0.5,stars:2},h,lang);
    assert.notEqual(cautious.advice,direct.advice);
    assert.ok(api.HORO_DOMAIN_ACTIONS.social.mercury.some(action=>cautious.advice.includes(action.text[li])));
  }
});
test("interpretation tables cover all seven bodies, twelve houses and four domains in both languages", () => {
  assert.equal(api.HORO_HOUSE_THEMES.length,12);
  for (const domain of api.HORO_DOMAINS) {
    for (const key of keys) {
      for (let house=1; house<=12; house++) {
        for (const [li,lang] of ["zh","en"].entries()) {
          const d={key:domain.key,raw:0,stars:3,focus:{key,house,signIdx:house-1,retrograde:false,aspect:null}};
          const detail=api.horoscopeDomainCopy(d,{primary:domain.key,adviceIdx:1},lang);
          assert.ok(api.HORO_DOMAIN_ACTIONS[domain.key][key].some(action=>detail.advice.includes(action.text[li])));
          assert.ok(detail.placement.includes(api.HORO_BODY_THEMES[key][li]));
          assert.ok(detail.placement.includes(api.HORO_HOUSE_THEMES[house-1].theme[li]));
          assert.ok(detail.placement.includes(api.HORO_HOUSE_THEMES[house-1].action[li]));
          assert.ok(!JSON.stringify(detail).includes("undefined"));
        }
      }
    }
  }
});
test("domain balance reports only the actual largest positive and negative contributions", () => {
  const mixed = {contributions:[{key:"sun",value:0.12},{key:"venus",value:0.3},{key:"mars",value:-0.4},{key:"saturn",value:-0.1}]};
  for (const [lang,positive,negative,excluded] of [["zh","金星","火星",["太阳","土星"]],["en","Venus","Mars",["Sun","Saturn"]]]) {
    const copy=api.horoscopeBalanceCopy(mixed,lang);
    assert.ok(copy.includes(positive) && copy.includes(negative));
    assert.ok(excluded.every(name=>!copy.includes(name)));
    assert.ok(!api.horoscopeBalanceCopy({contributions:[{key:"moon",value:0.1}]},lang).includes(lang==="zh"?"负向":"negative"));
    assert.ok(!api.horoscopeBalanceCopy({contributions:[{key:"moon",value:-0.1}]},lang).includes(lang==="zh"?"正向":"positive"));
    assert.match(api.horoscopeBalanceCopy({contributions:[{key:"sun",value:0}]},lang),lang==="zh"?/中性/:/neutral/);
  }
});
test("shared focus appears once with all four domain references; reciprocal aspects are expanded only once", () => {
  const actual=api.scoreHoroscope(7,api.planetPositions(new Date("2026-11-25T12:00:00Z")));
  const h={signIdx:7,...actual,adviceIdx:0,luckyNumber:10,colorIdx:0,dirIdx:0,itemIdx:0};
  assert.equal(api.horoscopeFocusGroups(h.domains).size,1);
  assert.ok(h.domains.every(d=>d.focus.key==="mars"));
  for(const lang of ["zh","en"]) {
    const full=api.horoscopeFullText(h,lang);
    const detail=api.horoscopeDomainCopy(h.domains[0],h,lang);
    assert.equal(full.split(detail.placement).length-1,1);
    assert.equal(full.split(detail.aspectInterpretation).length-1,1);
    assert.equal(full.split(detail.evidence).length-1,1);
    assert.equal(full.split(lang==="zh"?"主要依据：星位解读 1":"Main basis: Sky reading 1").length-1,4);
    assert.equal(full.split("\n\n").length,9);
    for(const d of h.domains) {
      const advice=api.horoscopeDomainCopy(d,h,lang).advice;
      assert.equal(full.split(advice).length-1,1);
    }
  }
  // Use two actual reciprocal aspect objects from the same real snapshot.
  // The Sun's opposite view of Mars is the same geometric aspect, even
  // though the solar house and its own body interpretation differ.
  const first=h.domains[0].focus;
  const positions=api.planetPositions(new Date("2026-11-25T12:00:00Z"));
  const sun=positions.find(p=>p.key==="sun");
  assert.equal(first.aspect.other,"sun");
  const reverse={key:"sun",signIdx:sun.signIdx,house:(sun.signIdx-7+12)%12+1,retrograde:false,
    aspect:{...first.aspect,other:"mars"}};
  const domains=h.domains.map((d,i)=>i===1?{...d,focus:reverse}:d);
  assert.equal(api.horoscopeAspectKey(first),api.horoscopeAspectKey(reverse));
  assert.equal(api.horoscopeFocusGroups(domains).size,2);
  const fixture={...h,domains};
  for(const lang of ["zh","en"]) {
    const text=api.horoscopeFullText(fixture,lang);
    const firstDetail=api.horoscopeDomainCopy(domains[0],fixture,lang);
    const secondDetail=api.horoscopeDomainCopy(domains[1],fixture,lang);
    assert.ok(text.includes(firstDetail.placement) && text.includes(secondDetail.placement));
    assert.equal(text.split(firstDetail.aspectInterpretation).length-1,1);
    assert.ok(!text.includes(secondDetail.aspectInterpretation));
    assert.ok(text.includes(lang==="zh"?"同一相位见星位解读 1":"the same aspect is explained in Sky reading 1"));
  }
});
test("advice corpus has 280 distinct bilingual core actions, stable IDs and valid context tags", () => {
  const ids=new Set(), zh=new Set(), en=new Set();
  const allowed=new Set(["express","connect","boundary","balance","home","reflect","detail","creative","plan","act","rest","learn","routine","resources","community"]);
  for(const domain of api.HORO_DOMAINS) for(const body of keys) {
    const pool=api.HORO_DOMAIN_ACTIONS[domain.key][body];
    assert.equal(pool.length,10);
    for(const [i,action] of pool.entries()) {
      assert.equal(action.id,domain.key+"."+body+"."+String(i+1).padStart(2,"0"));
      assert.equal(action.text.length,2);
      assert.ok(action.text.every(s=>typeof s==="string" && s.trim().length>8));
      assert.ok(action.tags.length>=2 && action.tags.every(tag=>allowed.has(tag)));
      assert.ok(!ids.has(action.id) && !zh.has(action.text[0]) && !en.has(action.text[1]));
      ids.add(action.id); zh.add(action.text[0]); en.add(action.text[1]);
    }
  }
  assert.equal(ids.size,280);
});
test("action ranking reacts to house, signed contribution, aspect and retrograde", () => {
  const base={key:"work",raw:0,contributions:[{key:"mercury",value:0}],focus:{key:"mercury",house:3,signIdx:2,retrograde:false,aspect:null}};
  const variant=changes=>({...base,focus:{...base.focus,...changes}});
  const weights=d=>api.horoscopeAdviceWeights(d);
  assert.ok(weights(base).get("detail")>0);
  assert.ok(weights(variant({house:4})).get("home")>0);
  assert.ok((weights(variant({retrograde:true})).get("reflect")||0)>(weights(base).get("reflect")||0));
  assert.ok((weights(variant({aspect:{angle:90,strength:0.8,value:-0.68}})).get("balance")||0)>(weights(base).get("balance")||0));
  assert.equal(weights(variant({aspect:{angle:90,strength:0,value:0}})).get("balance"),weights(base).get("balance"));
  const positive={...base,contributions:[{key:"mercury",value:0.2}]};
  const negative={...base,contributions:[{key:"mercury",value:-0.2}]};
  assert.ok((weights(positive).get("act")||0)>(weights(negative).get("act")||0));
  assert.ok((weights(negative).get("boundary")||0)>(weights(positive).get("boundary")||0));
  const options=[{id:"a",tags:["home","rest"]},{id:"b",tags:["express","detail"]}];
  assert.equal(api.bestHoroscopeAction(base,options).id,"b");
  assert.equal(api.bestHoroscopeAction(variant({house:4}),options).id,"a");
});
test("real dates have no seven-day core repeats for main or domain advice, including civil-year seams", () => {
  let samples=0;
  for(let sign=0;sign<12;sign++) {
    const histories=new Map(api.HORO_DOMAINS.map(d=>[d.key,[]]));
    const main=[];
    for(let day=-7;day<372;day++) {
      const date=new Date(2026,0,1+day,12);
      const h=api.makeHoroscope(date,sign);
      const primary=h.domains.find(d=>d.key===h.primary);
      const action=api.horoscopeActionFor(primary,h);
      assert.ok(!main.includes(action.id),"primary repeat: "+sign+"/"+date+"/"+action.id);
      main.push(action.id);if(main.length>7)main.shift();
      for(const d of h.domains) {
        const chosen=api.horoscopeActionFor(d,h);
        assert.equal(chosen.id,h.actionChoices[d.key]);
        const window=api.horoscopeActionWindow(date);
        const eligible=api.horoscopeActionOrder(sign,d.key,d.focus.key).slice(window.start,window.end);
        assert.ok(eligible.some(x=>x.id===chosen.id));
        const history=histories.get(d.key);
        assert.ok(!history.includes(chosen.id),"domain repeat: "+sign+"/"+date+"/"+chosen.id);
        history.push(chosen.id);if(history.length>7)history.shift();
        for(const [li,lang] of ["zh","en"].entries()) assert.ok(api.horoscopeDomainCopy(d,h,lang).advice.includes(chosen.text[li]));
      }
      samples++;
    }
  }
  assert.equal(samples,12*379);
});
test("civil-date advice windows advance across month, year and leap-day boundaries", () => {
  const dates=[new Date(2025,11,31,12),new Date(2026,0,1,12),new Date(2026,0,2,12)];
  const leap=[new Date(2028,1,28,12),new Date(2028,1,29,12),new Date(2028,2,1,12)];
  const slot=date=>{const w=api.horoscopeActionWindow(date);return w.start+w.elapsed};
  for(const seq of [dates,leap]) for(let i=1;i<seq.length;i++) assert.equal(slot(seq[i]),(slot(seq[i-1])+1)%10);
});
test("sky events use half-open day boundaries, order multiple changes and ignore routine lunar ingresses", () => {
  const start=Date.parse("2026-03-20T00:00:00Z"), hour=3600000, end=start+24*hour;
  const sampler=date=>{
    const t=date.valueOf();
    return keys.map(key=>{
      if(key==="sun") return {key,signIdx:t<start?11:0,retrograde:false};
      if(key==="mercury") return {key,signIdx:t<start+18*hour?0:11,retrograde:t>=start+5*hour};
      if(key==="venus") return {key,signIdx:11,retrograde:t<end};
      if(key==="moon") return {key,signIdx:t<start+hour?1:2,retrograde:false};
      return {key,signIdx:4,retrograde:false};
    });
  };
  const events=api.detectHoroscopeEvents(start,end,sampler);
  assert.deepEqual(events.map(e=>[e.body,e.type,e.at]),[
    ["sun","ingress",start],
    ["mercury","retrogradeStart",start+5*hour],
    ["mercury","ingress",start+18*hour]
  ]);
  assert.equal(events[0].backward,false);
  assert.equal(events[2].backward,true);
  assert.equal(events[2].fromSignIdx,0);
  assert.equal(events[2].toSignIdx,11);
  assert.deepEqual(api.detectHoroscopeEvents(end,end+23*hour,sampler).map(e=>[e.body,e.type,e.at]),
    [["venus","retrogradeEnd",end]]);
});
test("station split detects a brief ingress and return between coarse samples", () => {
  const start=Date.parse("2026-03-20T00:00:00Z"), hour=3600000, end=start+25*hour;
  const station=start+1.5*hour;
  const sampler=date=>keys.map(key=>{
    const x=(date.valueOf()-station)/hour;
    if(key!=="mercury") return {key,signIdx:0,retrograde:false};
    const lon=30.001-0.004*x*x;
    return {key,signIdx:lon>=30?1:0,retrograde:x>=0};
  });
  const events=api.detectHoroscopeEvents(start,end,sampler);
  assert.deepEqual(events.map(e=>e.type),["ingress","retrogradeStart","ingress"]);
  assert.ok(events[0].at<events[1].at && events[1].at<events[2].at);
  assert.equal(events[0].backward,false);
  assert.equal(events[2].backward,true);
});
test("real ingress and station events agree with independent Moshier reference epochs", () => {
  // Swiss Ephemeris 2.10.03 / FLG_MOSEPH | FLG_SPEED, UTC, rounded
  // to minutes. Planetary model is approximate, so tolerate timing error;
  // no exact-minute promise is exposed to the user.
  const refs=[
    ["sun","ingress","2026-03-20T14:45:00Z",11,0,0.15],
    ["sun","ingress","2026-06-21T08:24:00Z",2,3,0.15],
    ["mercury","retrogradeStart","2026-02-26T06:48:00Z",null,null,12],
    ["mercury","retrogradeEnd","2026-03-20T19:32:00Z",null,null,12],
    ["venus","ingress","2026-10-25T09:09:00Z",7,6,12],
    ["mars","ingress","2026-11-25T23:37:00Z",4,5,12],
    ["jupiter","retrogradeEnd","2026-03-11T03:30:00Z",null,null,36],
    ["saturn","retrogradeStart","2026-07-26T19:56:00Z",null,null,72],
  ];
  const hour=3600000;
  for(const [body,type,epoch,from,to,tolerance] of refs){
    const target=Date.parse(epoch), events=api.detectHoroscopeEvents(target-tolerance*hour,target+tolerance*hour);
    const e=events.find(e=>e.body===body&&e.type===type);
    assert.ok(e,body+"/"+type+"/"+epoch);
    assert.ok(Math.abs(e.at-target)<=tolerance*hour,body+"/"+type);
    if(type==="ingress"){
      assert.equal(e.fromSignIdx,from);assert.equal(e.toSignIdx,to);
      assert.equal(e.backward,(to-from+12)%12===11);
    }
    const earlier=api.planetPositions(new Date(e.at-60*1000)).find(p=>p.key===body);
    const later=api.planetPositions(new Date(e.at+60*1000)).find(p=>p.key===body);
    if(type==="ingress"){assert.equal(earlier.signIdx,from);assert.equal(later.signIdx,to);}
    else {assert.equal(earlier.retrograde,type==="retrogradeEnd");assert.equal(later.retrograde,type==="retrogradeStart");}
  }
});
test("event snapshot is sign-independent, stable through the local day and contextual in both languages", () => {
  // Use a real event date in local time, regardless of runner timezone.
  const start=Date.parse("2026-03-20T12:00:00Z"), end=start+8*3600000;
  const ingress=api.detectHoroscopeEvents(start,end).find(e=>e.body==="sun");
  assert.ok(ingress);
  const date=new Date(ingress.at);
  const h=api.makeHoroscope(date,0), other=api.makeHoroscope(date,6);
  const evening=new Date(date.getFullYear(),date.getMonth(),date.getDate(),23,59);
  assert.deepEqual(h.events,other.events);
  assert.deepEqual(h,api.makeHoroscope(evening,0));
  const event=h.events.find(e=>e.body==="sun"&&e.type==="ingress");
  assert.ok(event);
  const expectedNoon=api.scoreHoroscope(0,api.planetPositions(new Date(date.getFullYear(),date.getMonth(),date.getDate(),12)));
  assert.deepEqual(h.domains,expectedNoon.domains);
  assert.equal(h.stars,expectedNoon.stars);
  for(const lang of ["zh","en"]){
    const first=api.horoscopeEventCopy(event,0,lang), second=api.horoscopeEventCopy(event,6,lang);
    assert.match(first.evidence,lang==="zh"?/第12宫 → 第1宫/:/house 12 → 1/);
    assert.match(second.evidence,lang==="zh"?/第6宫 → 第7宫/:/house 6 → 7/);
    assert.notEqual(first.interpretation,second.interpretation);
    assert.notEqual(first.suggestion,second.suggestion);
    const copy=api.horoscopeCopy(h,lang), full=api.horoscopeFullText(h,lang);
    const card=api.render({cat:"astro",subtype:"horoscope",horo:h},lang);
    assert.ok(copy.eventSummary && card.body.includes(copy.eventSummary));
    assert.ok(!card.body.includes(first.interpretation));
    assert.ok(full.includes(first.title) && full.includes(first.suggestion));
    assert.ok(!full.includes("undefined"));
    const noEvent={...h,events:[]};
    assert.ok(!api.render({cat:"astro",subtype:"horoscope",horo:noEvent},lang).body.includes("astro-event"));
    assert.equal(api.horoscopeEventParagraphs(noEvent,lang).length,0);
    assert.ok(!api.horoscopeFullText(noEvent,lang).includes(first.title));
    assert.equal(api.horoscopeCopy(noEvent,lang).advice,copy.advice);
  }
});
test("station start/end and backward ingress have distinct bilingual, non-predictive event copy", () => {
  const events=[
    {body:"mercury",type:"retrogradeStart",signIdx:11,at:0},
    {body:"mercury",type:"retrogradeEnd",signIdx:11,at:1},
    {body:"venus",type:"ingress",fromSignIdx:7,toSignIdx:6,backward:true,at:2},
  ];
  for(const lang of ["zh","en"]){
    const copies=events.map(e=>api.horoscopeEventCopy(e,0,lang));
    assert.equal(new Set(copies.map(c=>c.title)).size,3);
    assert.equal(new Set(copies.map(c=>c.suggestion)).size,3);
    assert.match(copies[0].title,lang==="zh"?/开始逆行/:/stations retrograde/);
    assert.match(copies[1].title,lang==="zh"?/恢复顺行/:/stations direct/);
    assert.match(copies[2].title,lang==="zh"?/逆行回到/:/retrogrades into/);
    assert.match(api.horoscopeEventSummary(events,lang),lang==="zh"?/另有2项/:/2 more/);
    const paragraphs=api.horoscopeEventParagraphs({signIdx:0,events},lang);
    assert.equal(paragraphs.length,4);
    for(let i=0;i<copies.length;i++)assert.ok(paragraphs[i+1].includes(copies[i].title));
  }
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
