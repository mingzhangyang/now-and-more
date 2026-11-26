"use strict";
// Run from a full checkout (git history is needed for the independent baseline).
const fs=require("node:fs"),cp=require("node:child_process"),path=require("node:path");
const {performance}=require("node:perf_hooks");
const {loadHoroscope}=require("./horoscope-model-loader.cjs");
const root=path.join(__dirname,".."),read=p=>fs.readFileSync(path.join(root,p),"utf8");
const BASE="d30e497c3b4b1153b0360660d689e5d95a97883c";
const pin=p=>cp.execFileSync("git",["show",BASE+":"+p],{cwd:root,encoding:"utf8"});
const L=["background","trend","daily"],labels=["overall","love","work","money","social"];
const w=(background,trend,daily)=>({background,trend,daily}),neutral=w(1,1,1);
const star=x=>Math.max(1,Math.min(5,Math.round(3+2*x)));
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
const corr=(a,b)=>{const x=mean(a),y=mean(b);let xx=0,yy=0,xy=0;for(let i=0;i<a.length;i++){const u=a[i]-x,v=b[i]-y;xx+=u*u;yy+=v*v;xy+=u*v;}return xx&&yy?xy/Math.sqrt(xx*yy):null;};
function loadModels(){
  return {prior:loadHoroscope(pin("js/astro.js"),pin("js/app.js"),pin("js/data.js"),pin("js/horoscope-advice.js")),
    current:loadHoroscope(read("js/astro.js"),read("js/app.js"),read("js/data.js"),read("js/horoscope-advice.js"))};
}
// Baseline sample components already include role normalization, the original
// aspect cap and elapsed time. Compact only for experiments; preserve the cap
// per endpoint and sample. No second ephemeris per candidate.
function prepare(h,api){
  return h.domains.map(d=>d.contributions.flatMap(t=>t.samples.map(s=>{
    const p=[0,0,0],abs=[0,0,0],a=[0,0,0],aa=[0,0,0];
    for(const [k,v] of Object.entries(s.components))if(k!=="aspect"){
      const i=L.indexOf(api.horoscopeTimeLayer(t.key,k,null));p[i]+=v;abs[i]+=Math.abs(v);
    }
    for(const q of s.aspects){const i=L.indexOf(api.horoscopeTimeLayer(t.key,"aspect",q.other));a[i]+=q.contribution;aa[i]+=Math.abs(q.contribution);}
    return {p,abs,a,aa,slow:t.key==="jupiter"||t.key==="saturn",cap:.9*t.share*s.weight,hhi:t.share*t.share*s.weight};
  })));
}
function evaluate(domains,weights){
  const k=L.map(l=>weights[l]),result=[];
  for(const terms of domains){
    const net=[0,0,0],abs=[0,0,0],raw=[0,0,0];let slow=0,total=0,hhi=0;
    for(const t of terms){
      const capNet=t.a[0]*k[0]+t.a[1]*k[1]+t.a[2]*k[2];
      const cap=Math.abs(capNet)>t.cap?t.cap/Math.abs(capNet):1;
      for(let i=0;i<3;i++){
        const n=(t.p[i]+t.a[i]*cap)*k[i],v=(t.abs[i]+t.aa[i]*cap)*k[i];
        net[i]+=n;abs[i]+=v;raw[i]+=t.p[i]+t.a[i];total+=v;if(t.slow)slow+=v;
      }
      hhi+=t.hhi;
    }
    result.push({raw:net.reduce((a,b)=>a+b,0),net,abs,base:raw,slow,total,hhi});
  }
  return [{raw:mean(result.map(x=>x.raw)),net:L.map((_,i)=>mean(result.map(x=>x.net[i]))),
    abs:L.map((_,i)=>mean(result.map(x=>x.abs[i]))),base:L.map((_,i)=>mean(result.map(x=>x.base[i]))),
    slow:mean(result.map(x=>x.slow)),total:mean(result.map(x=>x.total)),hhi:mean(result.map(x=>x.hhi))},...result];
}
function metric(series){
  const flat=series.flat(),mu=mean(flat),stars=flat.map(star),counts=[1,2,3,4,5].map(k=>stars.filter(s=>s===k).length);
  let n=0,delta=0,changes=0,jumps=0,runs=0,maxRun=0,maxHigh=0,maxLow=0;
  for(const s of series){let run=1,hi=0,lo=0;runs++;for(let i=0;i<s.length;i++){
    const st=star(s[i]);hi=st>=4?hi+1:0;lo=st<=2?lo+1:0;maxHigh=Math.max(maxHigh,hi);maxLow=Math.max(maxLow,lo);
    if(i){n++;delta+=Math.abs(s[i]-s[i-1]);if(st!==star(s[i-1])){changes++;runs++;run=1;}else run++;if(Math.abs(st-star(s[i-1]))>=2)jumps++;}
    maxRun=Math.max(maxRun,run);
  }}
  const auto=[1,7,30].map(l=>{const a=[],b=[];for(const s of series)for(let i=l;i<s.length;i++){a.push(s[i-l]);b.push(s[i]);}return a.length?corr(a,b):null;});
  return {n:flat.length,meanRaw:mu,meanStars:mean(stars),sdRaw:Math.sqrt(mean(flat.map(x=>(x-mu)**2))),stars:counts,
    lowShare:(counts[0]+counts[1])/flat.length,highShare:(counts[3]+counts[4])/flat.length,
    adjacentRawChange:n?delta/n:0,adjacentStarChange:n?changes/n:0,jumpShare:n?jumps/n:0,
    meanRun:flat.length/runs,maxRun,maxHigh,maxLow,autocorrelation:auto};
}
function run(current,prior,start,end,models){
  const t=performance.now(),state=models.map(weights=>({weights,series:Array.from({length:12},()=>labels.map(()=>[])),
    net:labels.map(()=>[0,0,0]),abs:labels.map(()=>[0,0,0]),change:labels.map(()=>[0,0,0]),dominance:labels.map(()=>[0,0,0]),
    changeDominance:labels.map(()=>[0,0,0]),prev:Array.from({length:12},()=>labels.map(()=>null)),
    slow:labels.map(()=>0),total:labels.map(()=>0),hhi:labels.map(()=>0),distinct:labels.map(()=>0),elapsed:0}));
  let days=0,baselineMaxDelta=0,productionMaxDelta=0,skyMs=0,prepMs=0,checked=0;
  for(let date=new Date(start+"T12:00:00Z");date<new Date(end+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+1)){
    days++;const begin=performance.now(),sky=prior.horoscopeSky(date);skyMs+=performance.now()-begin;
    const pt=performance.now(),baseline=Array.from({length:12},(_,s)=>prior.scoreHoroscopeSamples(s,sky.samples)),terms=baseline.map(h=>prepare(h,current));prepMs+=performance.now()-pt;
    const check=days%30===1;
    for(const m of state){
      const bt=performance.now(),all=terms.map(t=>evaluate(t,m.weights));m.elapsed+=performance.now()-bt;
      for(let i=0;i<5;i++){
        const v=all.map(a=>a[i].raw),mu=mean(v);m.distinct[i]+=Math.sqrt(mean(v.map(x=>(x-mu)**2)));
        for(let sign=0;sign<12;sign++){
          const h=all[sign][i],p=m.prev[sign][i];
          m.series[sign][i].push(h.raw);m.slow[i]+=h.slow;m.total[i]+=h.total;m.hhi[i]+=h.hhi;
          for(let j=0;j<3;j++){m.net[i][j]+=h.net[j];m.abs[i][j]+=h.abs[j];if(p)m.change[i][j]+=Math.abs(h.net[j]-p[j]);}
          if(h.total>0)m.dominance[i][h.abs.indexOf(Math.max(...h.abs))]++;
          if(p){const a=h.net.map((v,j)=>Math.abs(v-p[j]));if(Math.max(...a)>1e-14)m.changeDominance[i][a.indexOf(Math.max(...a))]++;}
          m.prev[sign][i]=h.net;
          if(L.every(k=>m.weights[k]===1)){
            const old=[baseline[sign],...baseline[sign].domains][i],delta=Math.abs(old.raw-h.raw);
            baselineMaxDelta=Math.max(baselineMaxDelta,delta);
            if(delta>1e-10||old.stars!==star(h.raw))throw Error("Pinned V3.2 discrepancy "+date+" "+sign+" "+i);
          }
        }
      }
      // Check the compact evaluator against the live production path; every
      // validation candidate, all 12 signs, at regular independent dates.
      if(check&&(state.length<=5||m===state[0]||m===state.at(-1)||L.every(k=>m.weights[k]===1))){
        const currentSky=current.horoscopeSky(date);
        for(let sign=0;sign<12;sign++){
          const result=current.scoreHoroscopeSamples(sign,currentSky.samples,{...current.HORO_V32,timeLayers:m.weights});
          for(const [i,v] of [result,...result.domains].entries()){
            const delta=Math.abs(v.raw-all[sign][i].raw);productionMaxDelta=Math.max(productionMaxDelta,delta);checked++;
            if(delta>1e-10||v.stars!==star(all[sign][i].raw))throw Error("Production discrepancy "+date+" "+sign+" "+i);
          }
        }
      }
    }
    if(days%365===0)console.error(start,days,"days");
  }
  const div=(a,b)=>b?a/b:0;
  return {start,end,days,baselineMaxDelta,productionMaxDelta,productionChecks:checked,skyMs,prepMs,elapsedMs:performance.now()-t,
    models:state.map(m=>({weights:m.weights,scoreMs:m.elapsed,metrics:Object.fromEntries(labels.map((label,i)=>{
      const series=m.series.map(s=>s[i]);return[label,{...metric(series),
        bySign:series.map(s=>({meanStars:mean(s.map(star)),lowShare:s.filter(x=>star(x)<=2).length/s.length,highShare:s.filter(x=>star(x)>=4).length/s.length})),
        sameDaySignSd:m.distinct[i]/days,net:m.net[i].map(x=>x/(days*12)),absoluteShare:m.abs[i].map(x=>div(x,m.total[i])),
        deltaAbsoluteShare:m.change[i].map(x=>div(x,m.change[i].reduce((a,b)=>a+b,0))),dominance:m.dominance[i].map(x=>x/(days*12)),
        changeDominance:m.changeDominance[i].map(x=>div(x,(days-1)*12)),slowAbsoluteShare:div(m.slow[i],m.total[i]),meanWeightHHI:m.hhi[i]/(days*12)}];
    })),domainCorrelations:[1,2,3].flatMap(i=>Array.from({length:4-i},(_,j)=>corr(m.series.flatMap(s=>s[i]),m.series.flatMap(s=>s[i+j+1]))))}))};
}
function rankEligible(report){
  const base=report.models.find(m=>L.every(k=>m.weights[k]===1)),b=base.metrics.overall,target=[.20,.45,.35];
  const gap=m=>Math.max(...m.bySign.map(x=>x.lowShare))-Math.min(...m.bySign.map(x=>x.lowShare));
  return report.models.map(m=>{
    const v=m.metrics.overall,p=m.weights;
    const valid=p.background<1&&p.trend!==1&&p.daily>1&&gap(v)<.09&&v.stars[2]/v.n<.55&&v.stars[0]>0&&v.stars[4]/v.n>.015&&
      v.adjacentRawChange/b.adjacentRawChange>=.99&&v.adjacentRawChange/b.adjacentRawChange<=1.20&&v.sameDaySignSd/b.sameDaySignSd>=.95&&
      Math.abs(v.meanStars-b.meanStars)<=.10&&m.domainCorrelations.every((c,i)=>Math.abs(c-base.domainCorrelations[i])<.06)&&v.jumpShare<=b.jumpShare+.025;
    const score=v.absoluteShare.reduce((s,x,i)=>s+(x-target[i])**2,0)+.02*L.reduce((s,k)=>s+(1-p[k])**2,0)+.15*Math.abs(v.meanStars-b.meanStars);
    return {weights:p,valid,score,gap:gap(v)};
  }).filter(x=>x.valid).sort((a,b)=>a.score-b.score);
}
function choose(report){return rankEligible(report)[0];}
const sameWeights=(a,b)=>!!a&&!!b&&L.every(k=>a[k]===b[k]);
function assessRelease(selected,production,candidate,validation,publishedBaseline){
  const neutralResult=validation.models.find(m=>sameWeights(m.weights,neutral));
  const historic=publishedBaseline.models.D;
  const baselineHistogramMatches=publishedBaseline.timezone==="UTC"&&publishedBaseline.start===validation.start&&
    publishedBaseline.end===validation.end&&historic.parameters.houseRulerScale===.2&&historic.parameters.combinationScale===.5&&
    labels.every(label=>historic.metrics[label].n===neutralResult.metrics[label].n&&
      historic.metrics[label].stars.every((n,i)=>n===neutralResult.metrics[label].stars[i]));
  const candidateMatchesTraining=sameWeights(selected?.weights,candidate);
  // Apply the predeclared eligibility thresholds on holdout; never select a new winner there.
  const candidatePassesHoldout=rankEligible(validation).some(m=>sameWeights(m.weights,candidate));
  const selectionMatchesProduction=sameWeights(selected?.weights,production);
  const productionMatchesCandidate=sameWeights(production,candidate);
  return {baselineHistogramMatches,candidateMatchesTraining,candidatePassesHoldout,selectionMatchesProduction,
    productionMatchesCandidate,releaseReady:baselineHistogramMatches&&candidateMatchesTraining&&candidatePassesHoldout&&productionMatchesCandidate,
    baselineHistograms:Object.fromEntries(labels.map(label=>[label,{published:historic.metrics[label].stars,pinned:neutralResult.metrics[label].stars}]))};
}
function benchmark(api){
  const n=24,date=new Date(2026,10,25,12),times={score:0,make:0,warm:0,batch:0},heapBefore=process.memoryUsage().heapUsed;
  let maxBytes=0;
  for(let i=0;i<n;i++){
    const d=new Date(2026,9,1+i,12);let t=performance.now();api.scoreHoroscopeDay(d,i%12);times.score+=performance.now()-t;
    t=performance.now();const h=api.makeHoroscope(d,i%12);times.make+=performance.now()-t;
    maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(h)));
  }
  api.makeHoroscope(date,0);
  for(let i=0;i<n;i++){const t=performance.now();api.makeHoroscope(date,i%12);times.warm+=performance.now()-t;}
  for(let i=0;i<6;i++){const d=new Date(2026,10,25+i,12),t=performance.now();for(let s=0;s<12;s++)api.scoreHoroscopeDay(d,s);times.batch+=performance.now()-t;}
  return {samples:n,scoreMs:times.score/n,makeMs:times.make/n,warmMakeMs:times.warm/n,batch12Ms:times.batch/6,
    maxSerializedBytes:maxBytes,heapBefore,heapAfter:process.memoryUsage().heapUsed};
}
if(require.main===module){
  if(new Date(2026,0,1).getTimezoneOffset()!==0||new Date(2026,6,1).getTimezoneOffset()!==0)throw Error("Run with TZ=UTC");
  const {current,prior}=loadModels(),grid=[];
  for(const b of [.65,.75,.85,.95,1])for(const t of [.95,1,1.05])for(const d of [1,1.05,1.1,1.15,1.2])grid.push(w(b,t,d));
  const training=run(current,prior,"2021-01-01","2026-01-01",grid),selected=choose(training);
  if(!selected)throw Error("No eligible three-layer candidate");
  const production=current.HORO_V33.timeLayers,candidate=w(.95,.95,1.2);
  // Keep the provisional candidate frozen, independent of production and holdout.
  const models=[neutral,w(candidate.background,1,1),w(1,1,candidate.daily),candidate,w(1,candidate.trend,1)];
  const validation=run(current,prior,"2026-01-01","2031-01-01",models);
  const release=assessRelease(selected,production,candidate,validation,JSON.parse(read("docs/horoscope-v3.2-backtest.json")));
  console.log(JSON.stringify({baseline:BASE,timezone:"UTC",layers:L,selected,candidate,production,...release,
    training,validation,performance:{v32:benchmark(prior),v33:benchmark(current)}},null,2));
  if(process.argv.includes("--release-check")&&!release.releaseReady){
    console.error("V3.3 release blocked: reconcile baseline histograms, verify the frozen candidate, and match production to the training winner.");
    process.exitCode=1;
  }
}
module.exports={loadModels,prepare,evaluate,run,choose,benchmark,assessRelease};
