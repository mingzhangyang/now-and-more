"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {loadHoroscope}=require("../scripts/horoscope-model-loader.cjs");
const read=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const api=loadHoroscope(read("js/astro.js"),read("js/app.js"),read("js/data.js"),read("js/horoscope-advice.js"));
function verifyV32(api, assert) {
  const {HORO_BODIES:bodies,HORO_DOMAINS:domains,HORO_RULERS:rulers,HORO_V31:off,HORO_V32:on}=api;
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-11, a+" vs "+b);
  for(let sign=0;sign<12;sign++){
    const all=api.horoscopeHouseRulers(sign,{houses:Array.from({length:12},(_,i)=>i+1)});
    assert.equal(new Set(all.map(h=>h.signIdx)).size,12);
    for(const h of all){assert.equal(h.signIdx,(sign+h.house-1)%12);assert.equal(h.ruler,rulers[h.signIdx]);}
    for(const domain of domains)for(const key of bodies){
      const role=api.horoscopeRoleWeight(sign,domain,key,on);
      const expected=domain.houses.filter(h=>rulers[(sign+h-1)%12]===key);
      assert.equal(role?.houseRoles.length??0,expected.length);
      if(role){assert.ok(role.weight<=api.HORO_ROLE_WEIGHTS.max);close(role.weight,role.baseWeight+role.solarExtra+role.houseExtra);}
      const prior=api.horoscopeRoleWeight(sign,domain,key,off);
      const natural=domain.bodies.includes(key), solar=rulers[sign]===key;
      if(natural||solar)close(prior.weight,(natural?1:0.6)+(solar?0.5:0));else assert.equal(prior,null);
    }
  }
  const aries=api.horoscopeHouseRulers(0,domains[0]);
  assert.equal(aries[0].ruler,"sun");assert.equal(aries[1].ruler,"venus");
  const cap=api.horoscopeRoleWeight(9,{bodies:["saturn"],houses:[1,2]}, "saturn",{houseRulerScale:1,combinationScale:1});
  close(cap.houseExtra,0.45);close(cap.weight,1.95);
  const fixture=bodies.map((key,i)=>({key,lon:(i*61)%360,signIdx:Math.floor(((i*61)%360)/30),velocity:i*.1,retrograde:false}));
  const pairs=api.horoscopePairRecords(fixture);
  assert.equal(pairs.length,21);assert.equal(new Set(pairs.map(p=>p.pair)).size,21);
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    for(const angle of [0,60,90,120,180]){
      const w=api.horoscopeCombinationWeight(a,b,angle,on);
      assert.ok(w>=.85&&w<=1.15);close(w,api.horoscopeCombinationWeight(b,a,angle,on));
      close(api.horoscopeCombinationWeight(a,b,angle,off),1);
      const p={key:a,lon:0,velocity:1},q={key:b,lon:angle,velocity:0};
      const aspect=api.horoscopeAspect(p,q);
      const v=api.horoscopeAspectValue(aspect,p,q,on),v0=api.horoscopeAspectValue(aspect,p,q,off);
      close(v,v0*w);if(v0)assert.equal(Math.sign(v),Math.sign(v0));else close(v,0);
    }
  }
  const p={key:"mars",lon:89,velocity:1},q={key:"saturn",lon:0,velocity:0};
  const applying=api.horoscopeAspect(p,q);assert.equal(applying.state,"applying");
  const separating=api.horoscopeAspect({...p,lon:91},q);assert.equal(separating.state,"separating");
  assert.ok(Math.abs(api.horoscopeAspectValue(applying,p,q,on))>Math.abs(api.horoscopeAspectValue(separating,p,q,on)));
  const edge=api.horoscopeAspect({...p,lon:96},q);close(api.horoscopeAspectValue(edge,p,q,on),0);
  const solar={key:"sun",lon:0,velocity:0},venus={key:"venus",lon:0,velocity:1};
  close(api.horoscopeAspectValue(api.horoscopeAspect(solar,venus),solar,venus,on),0);
  for(const day of [new Date(2026,10,25),new Date(2028,1,29),new Date(2030,11,31)]){
    const sky=api.horoscopeSky(day);
    for(let sign=0;sign<12;sign++){
      const h=api.scoreHoroscopeSamples(sign,sky.samples,on);
      for(const d of h.domains){
        assert.equal(new Set(d.contributions.map(t=>t.key)).size,d.contributions.length);
        close(d.contributions.reduce((sum,t)=>sum+t.share,0),1);
        close(d.contributions.reduce((sum,t)=>sum+t.value,0),d.raw);
        for(const t of d.contributions){
          close(api.HORO_FACTORS.reduce((sum,k)=>sum+t.components[k],0),t.value);
          close(t.samples.reduce((sum,a)=>sum+a.value,0),t.value);
          for(const sample of t.samples){
            close(sample.aspects.reduce((sum,a)=>sum+a.contribution,0),sample.components.aspect);
            for(const a of sample.aspects){assert.equal(a.sampleAt,sample.at);assert.equal(a.pair,a.pairRecord.pair);close(a.value,a.valueBeforeCombination*a.combinationWeight);}
          }
        }
      }
    }
  }
  return true;
}

test("V3.2 rulership, canonical pairs, dynamics and additive audit",()=>verifyV32(api,assert));
test("V3.2 bilingual reader reflects scored roles and pair combinations",()=>{
  for(const lang of ["zh","en"]){
    let roles=0,pairs=0;
    for(let i=0;i<20;i++)for(let sign=0;sign<12;sign++){
      const h=api.makeHoroscope(new Date(2026,10,1+i),sign),full=api.horoscopeFullText(h,lang);
      for(const d of h.domains){
        const role=api.horoscopeRulerCopy(d,lang),pair=api.horoscopeCombinationCopy(d.focus.aspect,lang);
        if(role){roles++;assert.ok(full.includes(role));}
        if(pair){pairs++;assert.ok(api.horoscopeDomainCopy(d,h,lang).aspectInterpretation.includes(pair));}
      }
    }
    assert.ok(roles>0 && pairs>0);
  }
});
