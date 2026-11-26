"use strict";
const fs=require("node:fs");
const cp=require("node:child_process");
const path=require("node:path");
const {loadHoroscope,HORO_BASELINE_SHA}=require("./horoscope-model-loader.cjs");
const root=path.join(__dirname,".."),read=name=>fs.readFileSync(path.join(root,name),"utf8");
const baseline=cp.execFileSync("git",["show",HORO_BASELINE_SHA+":js/astro.js"],{cwd:root,encoding:"utf8"});
const app=read("js/app.js"),current=loadHoroscope(read("js/astro.js"),app),prior=loadHoroscope(baseline,app);
if (new Date(2026,0,1).getTimezoneOffset()!==0 || new Date(2026,6,1).getTimezoneOffset()!==0) throw Error("Run with TZ=UTC");
const start=process.argv[2]||"2026-01-01",end=process.argv[3]||"2031-01-01";
const report=runBacktest(current,prior,start,end);
console.log(JSON.stringify(report,null,2));
function runBacktest(api,prior,start,end){
  const models={
    A:api.HORO_V31,
    B:{...api.HORO_V32,combinationScale:0},
    C:{...api.HORO_V32,houseRulerScale:0},
    D:api.HORO_V32,
    E:{houseRulerScale:0.5,combinationScale:0.5},
    F:{houseRulerScale:1,combinationScale:1},
  };
  const labels=["overall",...api.HORO_DOMAINS.map(d=>d.key)];
  const zero=()=>({n:0,sum:0,sq:0,stars:[0,0,0,0,0],change:0,delta:0,starChanges:0,adj:0,adjStar:0,adjN:0,maxHigh:0,maxLow:0});
  const setup=()=>({byMetric:labels.map(zero),bySign:Array.from({length:12},()=>labels.map(zero)),
    byBody:{},pairs:{},concentration:0,slowShare:0,roleShare:0,domainN:0,distinct:labels.map(()=>0),
    domainCorrelations:Array.from({length:6},()=>({n:0,x:0,y:0,xx:0,yy:0,xy:0})),elapsedMs:0,
    previous:Array.from({length:12},()=>labels.map(()=>null)),days:0});
  const stats=Object.fromEntries(Object.keys(models).map(k=>[k,setup()]));
  const close=(x,y)=>Math.abs(x-y)<1e-10;
  let days=0,baselineCases=0,baselineMaxDelta=0,skyMs=0,baselineMs=0;
  const now=()=>Date.now();
  const track=(o,raw,star,braw,bstar,previous)=>{
    o.n++;o.sum+=raw;o.sq+=raw*raw;o.stars[star-1]++;
    o.change+=Math.abs(raw-braw)>1e-10?1:0;o.delta+=Math.abs(raw-braw);o.starChanges+=star!==bstar?1:0;
    if(previous){o.adj+=Math.abs(raw-previous.raw);o.adjStar+=star!==previous.star?1:0;o.adjN++;}
  };
  for(let t=Date.parse(start);t<Date.parse(end);t+=86400000){
    const date=new Date(t),begin=now(),sky=api.horoscopeSky(date);skyMs+=now()-begin;days++;
    const perDay=Object.fromEntries(Object.keys(models).map(k=>[k,labels.map(()=>[])]));
    for(let sign=0;sign<12;sign++){
      const bp=now(),old=prior.scoreHoroscopeSamples(sign,sky.samples);baselineMs+=now()-bp;
      const br=[old,...old.domains];
      for(const [k,model] of Object.entries(models)){
        const ts=now(),h=api.scoreHoroscopeSamples(sign,sky.samples,model);const m=stats[k],list=[h,...h.domains];m.elapsedMs+=now()-ts;
        if(k==="A"){baselineCases++;for(let i=0;i<list.length;i++){
          const diff=Math.abs(list[i].raw-br[i].raw);baselineMaxDelta=Math.max(baselineMaxDelta,diff);
          if(!close(list[i].raw,br[i].raw)||list[i].stars!==br[i].stars)throw Error("Baseline mismatch "+date.toISOString()+" "+sign+" "+i);
        }}
        for(let i=0;i<list.length;i++){
          const {raw,stars}=list[i],p=m.previous[sign][i],q=m.bySign[sign][i];
          track(m.byMetric[i],raw,stars,br[i].raw,br[i].stars,p);track(q,raw,stars,br[i].raw,br[i].stars,p);
          const high=stars>=4?(p?.high||0)+1:0,low=stars<=2?(p?.low||0)+1:0;
          q.maxHigh=Math.max(q.maxHigh,high);q.maxLow=Math.max(q.maxLow,low);
          m.byMetric[i].maxHigh=Math.max(m.byMetric[i].maxHigh,high);m.byMetric[i].maxLow=Math.max(m.byMetric[i].maxLow,low);
          m.previous[sign][i]={raw,star:stars,high,low};perDay[k][i].push(raw);
        }
        let ci=0;
        for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
          const a=h.domains[i].raw,b=h.domains[j].raw,o=m.domainCorrelations[ci++];
          o.n++;o.x+=a;o.y+=b;o.xx+=a*a;o.yy+=b*b;o.xy+=a*b;
        }
        for(const d of h.domains){
          m.domainN++;
          let absolute=0,slow=0;
          for(const term of d.contributions){
            const abs=Math.abs(term.value),o=m.byBody[term.key]||={absolute:0,signed:0,weight:0,houseExtra:0,count:0};
            o.absolute+=abs;o.signed+=term.value;o.weight+=term.share;o.houseExtra+=term.role.houseExtra;o.count++;
            absolute+=abs;if(["jupiter","saturn"].includes(term.key))slow+=abs;
            m.concentration+=term.share*term.share;
            if(term.role.houseExtra>0)m.roleShare+=term.share;
            // Count endpoint-attributed normalized contributions, not new pair bonuses.
            for(const sample of term.samples)for(const a of sample.aspects){
              const id=a.pair+"/"+a.angle,o=m.pairs[id]||={n:0,signed:0,absolute:0,combinationWeight:0};
              o.n++;o.signed+=a.contribution;o.absolute+=Math.abs(a.contribution);o.combinationWeight+=a.combinationWeight;
            }
          }
          if(absolute)m.slowShare+=slow/absolute;
        }
      }
    }
    for(const [k,m] of Object.entries(stats)){
      m.days++;
      for(let i=0;i<labels.length;i++){const a=perDay[k][i],mean=a.reduce((s,v)=>s+v,0)/a.length;m.distinct[i]+=Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length);}
    }
  }
  function summary(o){return {n:o.n,meanRaw:o.sum/o.n,sdRaw:Math.sqrt(Math.max(0,o.sq/o.n-(o.sum/o.n)**2)),stars:o.stars,
    lowShare:(o.stars[0]+o.stars[1])/o.n,highShare:(o.stars[3]+o.stars[4])/o.n,changedRawShare:o.change/o.n,meanAbsoluteDelta:o.delta/o.n,changedStarShare:o.starChanges/o.n,
    meanAdjacentRawChange:o.adj/o.adjN,adjacentStarChangeShare:o.adjStar/o.adjN,maxHighStreak:o.maxHigh,maxLowStreak:o.maxLow};}
  function corr(o){return (o.n*o.xy-o.x*o.y)/Math.sqrt((o.n*o.xx-o.x*o.x)*(o.n*o.yy-o.y*o.y));}
  const output={start,end,timezone:"UTC",days,baselineCases,baselineMaxDelta,skyMs,baselineMs,models:{}};
  for(const [k,m] of Object.entries(stats)){
    const sumAbs=Object.values(m.byBody).reduce((s,o)=>s+o.absolute,0);
    output.models[k]={parameters:models[k],metrics:Object.fromEntries(labels.map((l,i)=>[l,summary(m.byMetric[i])])),
      signs:m.bySign.map((s,sign)=>({sign,metrics:Object.fromEntries(labels.map((l,i)=>[l,summary(s[i])]))})),
      sameDaySignSd:Object.fromEntries(labels.map((l,i)=>[l,m.distinct[i]/days])),
      domainCorrelations:m.domainCorrelations.map(corr),meanWeightHHI:m.concentration/m.domainN,slowAbsoluteShare:m.slowShare/m.domainN,
      houseRulerWeightShare:m.roleShare/m.domainN,bodyContributions:Object.fromEntries(Object.entries(m.byBody).map(([key,o])=>[key,{...o,absoluteShare:o.absolute/sumAbs,meanWeight:o.weight/m.domainN}])),
      pairContributions:m.pairs,scoreMs:m.elapsedMs};
  }
  return output;
}
