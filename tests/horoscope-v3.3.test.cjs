"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const {loadHoroscope}=require("../scripts/horoscope-model-loader.cjs");
const root=path.join(__dirname,".."),read=p=>fs.readFileSync(path.join(root,p),"utf8");
const BASE="d30e497c3b4b1153b0360660d689e5d95a97883c";
const pin=p=>cp.execFileSync("git",["show",BASE+":"+p],{cwd:root,encoding:"utf8"});
const api=loadHoroscope(read("js/astro.js"),read("js/app.js"),read("js/data.js"),read("js/horoscope-advice.js"));
const old=loadHoroscope(pin("js/astro.js"),pin("js/app.js"));
const close=(a,b)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10,a+" vs "+b);
const layers=api.HORO_TIME_LAYERS, off={...api.HORO_V32,timeLayers:api.HORO_TIME_NEUTRAL};
test("V3.3 stable factor and pair classification, independent of instantaneous speed",()=>{
  for(const b of api.HORO_BODIES)for(const f of api.HORO_FACTORS.filter(k=>k!=="aspect")){
    const want=f==="solar"?"trend":b==="moon"?"daily":["jupiter","saturn"].includes(b)?"background":"trend";
    assert.equal(api.horoscopeTimeLayer(b,f),want);
  }
  for(const a of api.HORO_BODIES)for(const b of api.HORO_BODIES.filter(x=>x!==a)){
    const want=[a,b].includes("moon")?"daily":[a,b].every(x=>["jupiter","saturn"].includes(x))?"background":"trend";
    assert.equal(api.horoscopeTimeLayer(a,"aspect",b),want);
    assert.equal(api.horoscopeTimeLayer(b,"aspect",a),want);
  }
});
test("neutral gains restore the independently pinned V3.2, ledger conserves all sampled contributions",()=>{
  const dates=[new Date(2026,0,1),new Date(2026,1,26),new Date(2026,2,8),new Date(2026,2,20),
    new Date(2026,5,21),new Date(2026,10,1),new Date(2026,10,25),new Date(2028,1,29),new Date(2030,11,31)];
  for(const date of dates){
    const sky=api.horoscopeSky(date), priorSky=old.horoscopeSky(date);
    assert.deepEqual(sky.samples,priorSky.samples);
    for(let sign=0;sign<12;sign++){
      const prior=old.scoreHoroscopeSamples(sign,priorSky.samples),neutral=api.scoreHoroscopeSamples(sign,sky.samples,off),now=api.scoreHoroscopeSamples(sign,sky.samples);
      const r=[prior,...prior.domains],z=[neutral,...neutral.domains],n=[now,...now.domains];
      for(let i=0;i<r.length;i++){
        close(r[i].raw,z[i].raw);assert.equal(r[i].stars,z[i].stars);
        close(r[i].raw,layers.reduce((sum,k)=>sum+n[i].timeLayers[k].raw,0));
        close(n[i].raw,layers.reduce((sum,k)=>sum+n[i].timeLayers[k].adjusted,0));
        for(const k of layers){const t=n[i].timeLayers[k];assert.ok(t.absolute+1e-12>=Math.abs(t.adjusted));}
      }
      for(let i=0;i<now.domains.length;i++){
        const d=now.domains[i],p=prior.domains[i];
        close(d.contributions.reduce((sum,t)=>sum+t.share,0),1);
        for(let j=0;j<d.contributions.length;j++){
          const t=d.contributions[j],b=p.contributions[j];
          assert.deepEqual(t.role,b.role);close(t.share,b.share);
          close(t.value,t.samples.reduce((sum,s)=>sum+s.value,0));
          for(let k=0;k<t.samples.length;k++){
            const s=t.samples[k],before=b.samples[k],snapshot=now.samples.find(x=>x.at===s.at);
            assert.ok(snapshot);close(s.weight,before.weight);
            close(s.value,s.timeFactors.reduce((sum,f)=>sum+f.adjusted,0));
            close(before.value,s.timeFactors.reduce((sum,f)=>sum+f.raw,0));
            close(s.components.aspect,s.aspects.reduce((sum,a)=>sum+a.contribution,0));
            assert.ok(Math.abs(s.components.aspect)<=.9*t.share*s.weight+1e-12);
            for(const f of s.timeFactors){
              assert.equal(f.domain,d.key);assert.equal(f.body,t.key);assert.equal(f.sampleAt,s.at);
              assert.equal(f.layer,api.horoscopeTimeLayer(f.body,f.factor,f.other));
              close(f.adjusted,f.raw*f.coefficient*f.capScale);
              assert.ok(snapshot.positions.some(q=>q.key===f.body));
              if(f.other)assert.ok(snapshot.positions.some(q=>q.key===f.other));
            }
            for(const a of s.aspects){
              const original=before.aspects.find(v=>v.pair===a.pair&&v.angle===a.angle);
              assert.ok(original);close(a.rawContribution,original.contribution);
              close(a.value,a.valueBeforeCombination*a.combinationWeight);
              assert.equal(a.sampleAt,s.at);
            }
          }
        }
      }
    }
  }
});
test("signed cancellation, empty layers, re-cap and zero coefficients",()=>{
  const components={relation:0,dignity:0,aspect:.8,solar:0,retrograde:0,house:0};
  const aspects=[{other:"moon",angle:90,contribution:1,deviation:0},{other:"jupiter",angle:120,contribution:-.2,deviation:0}];
  const adjusted=api.horoscopeTimeAdjust("saturn","work",components,aspects,1,{background:.5,trend:1,daily:1.5});
  close(adjusted.components.aspect,.9);assert.ok(adjusted.timeFactors.filter(f=>f.factor==="aspect").every(f=>f.capScale<1));
  const zero=api.horoscopeTimeAdjust("saturn","work",{...components,aspect:0},[],0,api.HORO_TIME_NEUTRAL);
  close(zero.components.aspect,0);assert.ok(zero.timeFactors.every(f=>f.adjusted===0));
  const model={...api.HORO_V32,timeLayers:{background:0,trend:0,daily:0}};
  const h=api.scoreHoroscopeDay(new Date(2026,10,25),7,model);close(h.raw,0);assert.equal(h.stars,3);
  assert.throws(()=>api.scoreHoroscopeDay(new Date(2026,10,25),7,{...model,timeLayers:{background:1,trend:1,daily:NaN}}),RangeError);
});
test("23/25-hour days integrate actual elapsed time",()=>{
  const code='const {loadHoroscope}=require("./scripts/horoscope-model-loader.cjs");const fs=require("node:fs"),a=require("node:assert/strict");const m=loadHoroscope(fs.readFileSync("js/astro.js","utf8"),fs.readFileSync("js/app.js","utf8"));for(const [month,day,hours] of [[2,8,23],[10,1,25]]){const date=new Date(2026,month,day,12),sky=m.horoscopeSky(date);a.equal((sky.end-sky.start)/3600000,hours);a.ok(Math.abs(sky.samples.reduce((s,x)=>s+x.weight,0)-1)<1e-12);const h=m.scoreHoroscopeSamples(0,sky.samples);a.ok(Math.abs(h.raw-m.HORO_TIME_LAYERS.reduce((s,k)=>s+h.timeLayers[k].adjusted,0))<1e-10);}';
  cp.execFileSync(process.execPath,["-e",code],{cwd:root,env:{...process.env,TZ:"America/New_York"}});
});
test("daily comparison, bilingual real evidence, deterministic advice and bounded replay",()=>{
  const date=new Date(2026,10,25,12),h=api.makeHoroscope(date,7),prev=new Date(2026,10,24,12),y=api.scoreHoroscopeDay(prev,7);
  close(h.timeChange.raw,h.raw-y.raw);
  close(h.timeChange.raw,layers.reduce((s,k)=>s+h.timeChange.layers[k],0));
  assert.deepEqual(h,api.makeHoroscope(new Date(2026,10,25,23,59),7));
  for(const lang of ["zh","en"]){
    const full=api.horoscopeFullText(h,lang);
    assert.ok(full.includes(api.horoscopeTimeSummaryCopy(h,lang)));
    assert.match(full,lang==="zh"?/时间尺度（原始评分单位）/:/Time scales \(raw score units\)/);
    assert.match(full,lang==="zh"?/较昨日的净评分变化/:/Compared with yesterday/);
    assert.ok(!full.includes("undefined")&&!full.includes("NaN"));
    for(const layer of layers){
      const driver=api.horoscopeTimeDriver(h,layer);
      if(driver)assert.ok(h.samples.some(s=>s.at===driver.factor.sampleAt));
    }
  }
  const history=[];
  for(let i=0;i<36;i++){
    const day=api.makeHoroscope(new Date(2026,0,1+i,12),7);
    const action=day.actionChoices[day.primary];
    assert.ok(!history.slice(-7).includes(action),"core action repeated");
    history.push(action);
  }
});
