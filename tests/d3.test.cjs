"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root,file),"utf8");
const core = read("js/dedup.js");
const D = new Function(core+"\nreturn NAM_DEDUP;")();
const { NAM_DECK_IDS: catalog, NAM_LEGACY_DECK_IDS: legacy } =
  new Function(read("js/data.js")+"\nreturn {NAM_DECK_IDS,NAM_LEGACY_DECK_IDS};")();
const app = read("js/app.js");
function section(start,end) {
  const a=app.indexOf(start), b=app.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,start);
  return app.slice(a,b);
}
function store(seed={}) {
  const memory=new Map(Object.entries(seed).map(([k,v])=>[k,typeof v==="string"?v:JSON.stringify(v)]));
  return {writes:0,getItem:k=>memory.get(k)??null,
    setItem(k,v){this.writes++;memory.set(k,String(v));},
    removeItem:k=>memory.delete(k)};
}
function fakeLocks() {
  let tail=Promise.resolve(), active=0, calls=0;
  return {
    get calls(){return calls;},
    request(name,options,task) {
      assert.equal(name,"nam-decks-v2-write");
      assert.equal(options.mode,"exclusive");
      calls++;
      const next=tail.then(async()=>{
        assert.equal(active,0);
        active++;
        try{return await task();}finally{active--;}
      });
      tail=next.catch(()=>{});
      return next;
    }
  };
}
const draw=(d,key,pool)=>d.transact(()=>pool[d.draw(key,pool)]);
const lockedDraw=(d,key,pool)=>d.withLock(()=>draw(d,key,pool));

test("live catalog IDs are unique and the D2 migration map remains frozen",()=>{
  assert.equal(Object.keys(legacy).length,16);
  for(const [key,ids] of Object.entries(catalog)) {
    assert.ok(ids.length>0);
    assert.ok(ids.every(id=>typeof id==="string" && id.length>0 && id.length<=128),key);
    assert.equal(new Set(ids).size,ids.length,key);
  }
  assert.equal(legacy.world.length,43);
  assert.equal(legacy.history.length,366);
  const staticCount=["world","poem:zh","poem:en","thought","memory","classics","quotes:zh","quotes:en","science","proverbs","word"]
    .reduce((sum,key)=>sum+legacy[key].length,0)-1;
  assert.equal(staticCount,671);
  // This release checksum protects the migration order without forbidding
  // a later live pool reorder, addition, deletion or wording edit.
  const encoded=JSON.stringify(legacy);
  let hash=0x811c9dc5;
  for(let i=0;i<encoded.length;i++)hash=Math.imul(hash^encoded.charCodeAt(i),0x01000193);
  assert.equal((hash>>>0).toString(16).padStart(8,"0"),"709233bd");
});

test("reorder, deletion and insertion retain already-seen IDs until cycle completion",()=>{
  const d=D.createDeckState(store(),()=>0.999);
  assert.equal(draw(d,"p",["a","b","c","d"]),"d");
  assert.equal(draw(d,"p",["d","a","c","b"]),"c");
  const pool=["e","d","a","c"]; // b deleted, e added
  const rest=[draw(d,"p",pool),draw(d,"p",pool)];
  assert.deepEqual(new Set(rest),new Set(["a","e"]));
  assert.equal(d.state.d.p.s.length+d.state.d.p.r.length,pool.length);
  assert.equal(new Set(d.state.d.p.s.concat(d.state.d.p.r)).size,pool.length);
  const next=draw(d,"p",pool);
  assert.notEqual(next,rest[1]);
});

test("new membership after an exhausted round is seen before a repeat; singleton is valid",()=>{
  const d=D.createDeckState(store(),()=>0.999);
  assert.equal(draw(d,"p",["a"]),"a");
  assert.equal(draw(d,"p",["a"]),"a");
  assert.equal(draw(d,"p",["b","a"]),"b");
  assert.equal(draw(d,"p",["a","b"]),"a");
  assert.equal(d.transact(()=>d.draw("empty",[])),-1);
});

test("migrate v1 using frozen IDs even if the live pool is reordered, preserve D2 and original backup",()=>{
  const old={v:1,d:{
    "poem:zh":{n:legacy["poem:zh"].length,r:[0,2,4],l:1},
    world:{n:2,r:[0],l:1}, // ambiguous historical length; reset only this bag
    mine:{r:[7,7,5,99],l:5},
  },g:{en:{v:2,entries:[{keys:["u:0123456789abcdef"],at:123}]},zh:{seen:["old"]}},fp:["dice:[1,2]"]};
  const storage=store({[D.LEGACY_KEY]:old});
  const original=storage.getItem(D.LEGACY_KEY);
  const d=D.createDeckState(storage,()=>0.999,{legacyIds:legacy});
  const pool=catalog["poem:zh"].slice().reverse();
  const expected=[legacy["poem:zh"][4],legacy["poem:zh"][2],legacy["poem:zh"][0]];
  assert.deepEqual(expected.map(()=>draw(d,"poem:zh",pool)),expected);
  assert.equal(d.state.d.world,undefined);
  assert.deepEqual(d.state.g,old.g);
  assert.deepEqual(d.state.fp,old.fp);
  assert.equal(storage.getItem(D.LEGACY_KEY),original);
  assert.equal(JSON.parse(storage.getItem(D.KEY)).v,2);
  const other=D.createDeckState(storage,()=>0.999,{legacyIds:legacy});
  assert.equal(draw(other,"mine",["note:5","note:7","note:8"]),"note:7");
  storage.setItem(D.LEGACY_KEY,JSON.stringify({v:1,d:{},g:{},fp:[]}));
  other.sync();
  assert.deepEqual(other.state.g,old.g); // old page cannot overwrite v2
});

test("repair malformed individual bags without resetting valid histories",()=>{
  const storage=store({[D.KEY]:{v:2,d:{
    p:{s:["b","c","c",null],r:["a","a","missing",1,"b"],l:"b"},
    broken:{r:"bad"}, q:{s:["y"],r:["x"],l:"y"}
  },g:{en:{seen:["keep"]}},fp:["keep",null]}});
  const d=D.createDeckState(storage,()=>0.999);
  assert.deepEqual(d.state.d.p,{s:["b","c"],r:["a","missing"],l:"b"});
  assert.equal(d.state.d.broken,undefined);
  assert.equal(draw(d,"p",["a","b","c"]),"a");
  assert.deepEqual(d.state.d.p,{s:["b","c","a"],r:[],l:"a"});
  assert.deepEqual(d.state.d.q,{s:["y"],r:["x"],l:"y"});
  assert.deepEqual(d.state.g.en,{seen:["keep"]});
  assert.deepEqual(d.state.fp,["keep"]);
  const bad=D.createDeckState(store({[D.KEY]:"{broken"}),()=>0.999);
  assert.equal(draw(bad,"p",["a","b"]),"b");
});

test("shared storage tabs serialize 1000 draws, preserve cycle seams and resume after reload",async()=>{
  const storage=store(), locks=fakeLocks(), pool=Array.from({length:20},(_,i)=>"p:"+i);
  let a=D.createDeckState(storage,()=>0.999,{locks}), b=D.createDeckState(storage,()=>0.25,{locks});
  let previous=null;
  for(let cycle=0;cycle<50;cycle++){
    const seen=await Promise.all(pool.map((_,i)=>lockedDraw(i%2?a:b,"p",pool)));
    assert.equal(new Set(seen).size,20);
    assert.notEqual(seen[0],previous);
    previous=seen[seen.length-1];
    if(cycle===24) a=D.createDeckState(storage,()=>0.5,{locks});
  }
  assert.equal(locks.calls,1000);
  b.sync();
  assert.equal(b.state.d.p.l,previous);
});

test("news reconciliation and a stale tab's draw do not overwrite each other's state",async()=>{
  const storage=store(), locks=fakeLocks();
  const a=D.createDeckState(storage,()=>0.999,{locks});
  const b=D.createDeckState(storage,()=>0.999,{locks});
  await Promise.all([
    a.updateGossip("en",()=>({v:2,entries:[{keys:["u:0123456789abcdef"],at:1}]})),
    lockedDraw(b,"p",["a","b","c"]),
    b.updateGossip("zh",()=>({seen:["keep"]})),
    a.updateGossip("en",raw=>({...raw,entries:raw.entries.concat({keys:["u:fedcba9876543210"],at:2})})),
  ]);
  const latest=D.createDeckState(storage);
  assert.equal(latest.state.g.en.entries.length,2);
  assert.deepEqual(latest.state.g.zh,{seen:["keep"]});
  assert.deepEqual(latest.state.d.p.r,["a","b"]);
  assert.equal(await lockedDraw(a,"p",["a","b","c"]),"b");
});

test("a note edit holds the same lock through its async commit; queued draw sees the revision",async()=>{
  const storage=store(), locks=fakeLocks(), d=D.createDeckState(storage,()=>0.999,{locks});
  let release, observed=false;
  const edit=D.runShared(locks,()=>new Promise(resolve=>{
    release=()=>{storage.setItem("nam-notes-revision","committed");resolve();};
  }));
  await Promise.resolve();
  const drawTask=d.withLock(()=>{observed=storage.getItem("nam-notes-revision")==="committed";return draw(d,"p",["a","b"]);});
  await Promise.resolve();
  assert.equal(observed,false);
  release();
  await edit;
  assert.equal(await drawTask,"b");
  assert.equal(observed,true);
});

test("failed locked render rolls back and never replays; denied lock falls back once",async()=>{
  const storage=store(), locks=fakeLocks(), d=D.createDeckState(storage,()=>0.999,{locks});
  let calls=0;
  await assert.rejects(d.withLock(()=>d.transact(()=>{calls++;d.draw("p",["a","b"]);throw Error("render failed");})),/render failed/);
  assert.equal(calls,1);
  assert.equal(storage.getItem(D.KEY),null);
  assert.equal(await lockedDraw(d,"p",["a","b"]),"b");
  const denied={request(){return Promise.reject(Error("unsupported"));}};
  const fallback=D.createDeckState(storage,()=>0.999,{locks:denied});
  assert.equal(await lockedDraw(fallback,"p",["a","b"]),"a");
});

test("async transition gate rejects overlap until lock resolves and releases on rejection",async()=>{
  const queue=[],errors=[], gate=D.createDrawGate(fn=>queue.push(fn),e=>errors.push(e.message));
  let release;
  assert.equal(gate.request(()=>new Promise(resolve=>{release=resolve;})),true);
  const pending=queue.shift()();
  assert.equal(gate.pending,true);
  assert.equal(gate.run(()=>{}),false);
  release();
  await pending;
  assert.equal(gate.pending,false);
  assert.equal(gate.request(()=>Promise.reject(Error("failed"))),true);
  await queue.shift()();
  assert.deepEqual(errors,["failed"]);
  assert.equal(gate.pending,false);
});

test("no-op redraw and reconciliation avoid writes; storage denial keeps page-local state",()=>{
  const storage=store(),d=D.createDeckState(storage,()=>0.999);
  draw(d,"p",["a","b"]);
  const before=storage.writes;
  d.transact(()=>42);
  d.updateGossip("en",x=>x);
  assert.equal(storage.writes,before);
  const denied=D.safeStorage(()=>{throw Error("denied");});
  const a=D.createDeckState(denied,()=>0.999);
  assert.equal(draw(a,"p",["a","b"]),"b");
  assert.equal(draw(a,"p",["a","b"]),"a");
  const backend=store(), wrapper=D.safeStorage(()=>backend);
  wrapper.setItem("setting","en");
  backend.setItem=()=>{throw Error("quota");};
  wrapper.setItem("setting","zh");
  assert.equal(wrapper.getItem("setting"),"zh");
  wrapper.removeItem("setting");
  assert.equal(wrapper.getItem("setting"),null);
});

test("actual app note gift uses current random cycle and does not consume an unseen slot twice",()=>{
  const storage=store(),queue=[],rendered=[];
  const source=core+"\n"+section("function drawNoteEntry()","/* ---------- Dated delivery")+"\n"+
    section("const POSTCARD_POOL_CHANCE","/* ================= Clock engine")+String.raw`
    let currentSelection=null,lastCategory=null,encounter=0,lastDrawAt=0,delivered=false,fail=false;
    const notesList=[{id:1},{id:2},{id:3}];
    const deckState=NAM_DEDUP.createDeckState(storage,()=>0.999);
    const postcardDayKey=()=>"20261124", todaysPostcardSelection=()=>null;
    const todaysDatedNoteSelection=()=>delivered?null:{cat:"mine",note:notesList[1],gifted:true,giftStamp:"20261124"};
    const markNoteDelivered=()=>{delivered=true;};
    const showGiftNotice=()=>{},dismissGiftNotice=()=>{},gossipEndpoint=()=>"";
    const weightedCategory=()=>"mine",makeSelection=cat=>({cat,note:drawNoteEntry()});
    const t=()=>({encounter:n=>String(n)});
    const el={classList:{add(){},remove(){}},textContent:""};
    const $=()=>el;
    const renderSelection=sel=>{if(fail)throw Error("render failed");rendered.push(sel.note.id);};
    drawsReady=true;
    return {drawCard,deckState,fail:v=>{fail=v;},get delivered(){return delivered;}};
  `;
  const h=new Function("storage","rendered","setTimeout",source)(storage,rendered,fn=>queue.push(fn));
  const step=()=>{assert.equal(h.drawCard(),true);queue.shift()();};
  h.fail(true);
  assert.throws(step,/render failed/);
  assert.equal(h.delivered,false);
  assert.equal(storage.getItem(D.KEY),null);
  h.fail(false);
  step();
  assert.equal(h.delivered,true);
  assert.equal(h.deckState.state.d.mine.l,"note:2");
  assert.equal(h.deckState.state.d.mine.r.length,2);
  step();step();
  assert.deepEqual(new Set(rendered),new Set([1,2,3]));
  step();
  assert.notEqual(rendered[3],rendered[2]);
});

test("known-stale IndexedDB note snapshot is excluded and older load cannot replace newer revision",async()=>{
  const storage=store(),requests=[];
  const db={transaction:()=>({objectStore:()=>({getAll:()=>{const rq={};requests.push(rq);return rq;}})})};
  const source=section("function validNote(n)","/* ---------- Dates ---------- */")+String.raw`
    let notesList=[],notesDbFailed=false;
    const notesOpenDb=async()=>db;
    return {notesLoadAll,notesCurrent,get rows(){return notesList;}};
  `;
  const h=new Function("appStorage","db",source)(storage,db);
  const old=h.notesLoadAll();
  await Promise.resolve();
  storage.setItem("nam-notes-revision","new");
  assert.equal(h.notesCurrent(),false);
  const latest=h.notesLoadAll();
  await Promise.resolve();
  const note=id=>({id,type:"memo",text:"x",createdAt:id});
  requests[1].result=[note(2)];requests[1].onsuccess();
  await latest;
  assert.equal(h.notesCurrent(),true);
  requests[0].result=[note(1)];requests[0].onsuccess();
  await old;
  assert.deepEqual(h.rows.map(n=>n.id),[2]);
});

test("library shares the write lock, signals after commit, and offline shell includes the script",()=>{
  const library=read("library.html");
  assert.ok(library.includes('src="js/dedup.js?v=28"'));
  assert.ok(library.includes('NAM_DEDUP.runShared(NAM_DEDUP.browserLocks(), remove)'));
  assert.ok(library.indexOf("tx.oncomplete = function ()")<library.indexOf('localStorage.setItem("nam-notes-revision"'));
  assert.ok(app.includes("NAM_DEDUP.runShared(sharedLocks"));
  assert.ok(read("sw.js").includes('"/js/dedup.js?v=28"'));
});

/* Real draw, revision, receipt and bag logic. Only IndexedDB, the clock,
   timers, locks and rendering are deterministic adapters. */
function notePriorityHarness() {
  const storage=store(),locks=fakeLocks(),requests=[],rendered=[],timers=new Map();
  let timerId=0;
  const date=new Date(2026,11,24,12).getTime();
  class FakeDate extends Date {
    constructor(...args){super(...(args.length?args:[date]));}
    static now(){return date;}
  }
  const db={transaction:()=>({objectStore:()=>({getAll:()=>{const rq={};requests.push(rq);return rq;}})})};
  const source=core+"\n"+
    section("function validNote(n)","/* ---------- Dates ---------- */")+
    section("function noteDayStr(","function noteDateParts(")+
    section("function drawNoteEntry()","/* ---------- Source context")+
    section("function postcardDayKey(","/* The meta line")+
    section("const POSTCARD_POOL_CHANCE","/* ================= Clock engine")+String.raw`
    let notesList=[],notesDbFailed=false,currentSelection=null,lastCategory=null,encounter=0,lastDrawAt=0;
    const notesOpenDb=async()=>db;
    const pad=n=>String(n).padStart(2,"0");
    const deckState=NAM_DEDUP.createDeckState(appStorage,()=>0.999,{locks});
    const postcardForDate=()=>({key:"test"});
    const gossipEndpoint=()=>"",weightedCategory=()=>"world",makeSelection=cat=>({cat});
    const t=()=>({encounter:n=>String(n)});
    const el={classList:{add(){},remove(){}},textContent:""};
    const $=()=>el;
    const showGiftNotice=()=>{},dismissGiftNotice=()=>{};
    const renderSelection=sel=>rendered.push(sel);
    drawsReady=true;
    return {drawCard,notesLoadAll,get pending(){return drawGate.pending;}};
  `;
  const h=new Function("appStorage","locks","db","rendered","Date","setTimeout","clearTimeout",source)(
    storage,locks,db,rendered,FakeDate,
    (fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},
    id=>timers.delete(id));
  const hasTimer=ms=>[...timers.values()].some(t=>t.ms===ms);
  const fire=ms=>{
    const entry=[...timers].find(([,t])=>t.ms===ms);
    assert.ok(entry,"expected timer "+ms);
    timers.delete(entry[0]);
    return entry[1].fn();
  };
  const until=async condition=>{
    for(let i=0;i<100;i++){
      if(condition())return;
      await Promise.resolve();
    }
    assert.ok(condition(),"expected refresh/retry to be pending");
  };
  const due={id:1,type:"memo",text:"for today",createdAt:1,date:"2026-12-24"};
  const unrelated={id:2,type:"memo",text:"unrelated",createdAt:2};
  const finishRead=(i,rows)=>{requests[i].result=rows;requests[i].onsuccess();};
  const load=async()=>{
    const ready=h.notesLoadAll();
    await until(()=>requests.length===1);
    finishRead(0,[due]);
    await ready;
  };
  const draw=()=>{assert.equal(h.drawCard(),true);return fire(180);};
  const revision=value=>D.runShared(locks,()=>storage.setItem("nam-notes-revision",value));
  return {h,storage,requests,rendered,hasTimer,fire,until,due,unrelated,finishRead,load,draw,revision};
}

test("unrelated cross-tab note edit before first draw preserves note-first gift order; retry revalidates revision",async()=>{
  const x=notePriorityHarness();
  await x.load();
  await x.revision("edit-1");
  const draw=x.draw();
  await x.until(()=>x.requests.length===2&&x.hasTimer(500));
  assert.equal(x.rendered.length,0);
  assert.equal(x.h.drawCard(),false);
  assert.equal(x.storage.getItem("nam-postcard-20261224"),null);
  // Another tab can edit during the wait: no Web Lock is held by the reader.
  await x.revision("edit-2");
  x.finishRead(1,[x.due,x.unrelated]);
  await x.until(()=>x.requests.length===3&&x.hasTimer(500));
  x.finishRead(2,[x.due]);
  await draw;
  assert.deepEqual(x.rendered.map(s=>s.cat),["mine"]);
  assert.equal(x.storage.getItem("nam-note-20261224"),"1");
  assert.equal(x.storage.getItem("nam-postcard-20261224"),null);
  await x.draw();
  assert.deepEqual(x.rendered.map(s=>s.cat),["mine","postcard"]);
  assert.equal(x.storage.getItem("nam-postcard-20261224"),"1");
  assert.equal(x.hasTimer(500),false);
});

test("fresh snapshot confirms deletion before gifting postcard; stale due note is never delivered",async()=>{
  const x=notePriorityHarness();
  await x.load();
  await x.revision("deleted");
  const draw=x.draw();
  await x.until(()=>x.requests.length===2&&x.hasTimer(500));
  x.finishRead(1,[x.unrelated]);
  await draw;
  assert.deepEqual(x.rendered.map(s=>s.cat),["postcard"]);
  assert.equal(x.storage.getItem("nam-note-20261224"),null);
  assert.equal(x.storage.getItem("nam-postcard-20261224"),"1");
});

test("bounded note read timeout renders ordinary card without consuming gifts; later draw delivers note then postcard",async()=>{
  const x=notePriorityHarness();
  await x.load();
  await x.revision("slow");
  const draw=x.draw();
  await x.until(()=>x.requests.length===2&&x.hasTimer(500));
  x.fire(500);
  await x.until(()=>x.hasTimer(500));
  x.fire(500);
  await draw;
  assert.deepEqual(x.rendered.map(s=>s.cat),["world"]);
  assert.equal(x.h.pending,false);
  assert.equal(x.storage.getItem("nam-note-20261224"),null);
  assert.equal(x.storage.getItem("nam-postcard-20261224"),null);
  x.finishRead(1,[x.due,x.unrelated]);
  await x.h.notesLoadAll();
  await x.draw();
  await x.draw();
  assert.deepEqual(x.rendered.map(s=>s.cat),["world","mine","postcard"]);
});
