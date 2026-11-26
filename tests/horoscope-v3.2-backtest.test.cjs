"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadBacktestModels,compareBaseline,houseWeightShares}=require("../scripts/horoscope-v3.2-backtest.cjs");
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} vs ${b}`);

test("house ruler audit distinguishes participation, extras and new membership",()=>{
  const roles=[
    {natural:true,solarRuler:false,baseWeight:1,solarExtra:0,houseExtra:.06,weight:1.06},
    {natural:false,solarRuler:false,baseWeight:.12,solarExtra:0,houseExtra:.06,weight:.18},
    {natural:false,solarRuler:true,baseWeight:.6,solarExtra:.5,houseExtra:0,weight:1.1},
  ];
  const total=roles.reduce((sum,r)=>sum+r.weight,0);
  const shares=houseWeightShares(roles.map(role=>({role,share:role.weight/total})));
  close(shares.participating,1.24/total);
  close(shares.extra,.12/total);
  close(shares.newMembership,.12/total);
  assert.ok(shares.extra+shares.newMembership<shares.participating);
  const disabled={natural:true,solarRuler:false,baseWeight:1,solarExtra:0,houseExtra:0,weight:1};
  assert.deepEqual(houseWeightShares([{role:disabled,share:1}]),{participating:0,extra:0,newMembership:0});
});

test("independent pinned V3.1 sky agrees on DST and lunar ingress days; omitted cut is detected",()=>{
  const previousTZ=process.env.TZ;
  process.env.TZ="America/New_York";
  try{
    const {current,prior}=loadBacktestModels();
    for(const [date,hours,hasIngress] of [
      [new Date(2026,2,8,12),23,false],
      [new Date(2026,10,1,12),25,true],
      [new Date(2026,2,9,12),24,true],
    ]){
      const sky=current.horoscopeSky(date),baselineSky=prior.horoscopeSky(date);
      assert.notEqual(sky.samples,baselineSky.samples);
      assert.equal(baselineSky.end-baselineSky.start,hours*3600000);
      assert.equal(baselineSky.moonIngress!==null,hasIngress);
      assert.deepEqual(sky.samples,baselineSky.samples);
      close(baselineSky.samples.reduce((sum,s)=>sum+s.weight,0),1);
      if(hasIngress)assert.ok(baselineSky.samples.some(s=>s.to===baselineSky.moonIngress));
      for(let sign=0;sign<12;sign++){
        const disabled=current.scoreHoroscopeSamples(sign,sky.samples,current.HORO_V31);
        const result=compareBaseline(prior,date,sign,sky,baselineSky,disabled);
        close(result.endToEndMaxDelta,0);close(result.scoringOnlyMaxDelta,0);
      }
      if(hasIngress){
        // Simulate dropping the lunar ingress boundary but preserving the full civil day.
        const index=sky.samples.findIndex(s=>s.to===sky.moonIngress);
        assert.ok(index>=0&&index+1<sky.samples.length);
        const left=sky.samples[index],right=sky.samples[index+1];
        const at=left.from+Math.floor((right.to-left.from)/2);
        const merged={...left,to:right.to,at,weight:left.weight+right.weight,
          positions:current.planetPositions(new Date(at))};
        const changed={samples:[...sky.samples.slice(0,index),merged,...sky.samples.slice(index+2)]};
        let detected=0;
        for(let sign=0;sign<12;sign++){
          const disabled=current.scoreHoroscopeSamples(sign,changed.samples,current.HORO_V31);
          // Sharing the candidate sky hides the regression, even with the pinned scorer.
          const shared=prior.scoreHoroscopeSamples(sign,changed.samples);
          for(const [i,value] of [disabled,...disabled.domains].entries()){
            const reference=[shared,...shared.domains][i];
            close(value.raw,reference.raw);assert.equal(value.stars,reference.stars);
          }
          try{compareBaseline(prior,date,sign,changed,baselineSky,disabled);}
          catch(error){assert.match(error.message,/End-to-end baseline mismatch/);detected++;}
        }
        assert.ok(detected>0,"independent sky must detect omitted lunar ingress cut");
      }
    }
    // Check all 48 sign/domain weight configurations, not just the synthetic fixture.
    const totals={participating:0,extra:0,newMembership:0};
    const sky=current.horoscopeSky(new Date(2026,2,9,12));
    for(let sign=0;sign<12;sign++){
      const scored=current.scoreHoroscopeSamples(sign,sky.samples,current.HORO_V32);
      for(const domain of scored.domains){
        const shares=houseWeightShares(domain.contributions);
        assert.ok(shares.extra+shares.newMembership<=shares.participating+1e-10);
        for(const key of Object.keys(totals))totals[key]+=shares[key];
      }
    }
    close(totals.participating/48,.3321203035619);
    close(totals.extra/48,.03482643023839);
    close(totals.newMembership/48,.04003217678167);
  }finally{
    if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;
  }
});
