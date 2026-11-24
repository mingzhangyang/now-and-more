"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
require("../gossip-service/news-id.js");
const ID = globalThis.NAM_NEWS_ID;
const G = new Function(read("js/gossip.js") + "\nreturn NAM_GOSSIP;")();
const D = new Function(read("js/dedup.js") + "\nreturn NAM_DEDUP;")();
const start = Date.now();
const story = (name, link = "https://example.com/" + name, title = "Detailed entertainment headline number " + name) =>
  ({ title, link, source: "Example", publishedAt: new Date(start).toISOString() });
const A = story("A"), B = story("B"), C = story("C");
const list = (lang, items, fetchedAt = start) => ({ lang, items, fetchedAt });
const response = value => ({ ok: true, json: async () => value });
const endpoint = "https://worker.example.com/gossip";
const fakeTimers = () => {
  let seq = 0;
  const timers = new Map();
  return { timers, schedule: fn => { timers.set(++seq, fn); return seq; }, cancel: id => timers.delete(id) };
};

test("canonical URL drops tracking but preserves article identity and original link", () => {
  const link = "https://EXAMPLE.com/a?utm_source=x&b=2&a=1#x";
  assert.equal(ID.canonicalUrl(link), "https://example.com/a?a=1&b=2");
  assert.notEqual(ID.canonicalUrl("https://example.com/a?id=1"), ID.canonicalUrl("https://example.com/a?id=2"));
  assert.equal(ID.canonicalUrl("https://example.com/a?q=%23topic%23"), "https://example.com/a?q=%23topic%23");
  assert.equal(ID.canonicalUrl("javascript:alert(1)"), "");
  assert.equal(ID.canonicalUrl("https://user:pass@example.com/"), "");
  assert.equal(ID.normalize(story("A", link), start).link, link);
  assert.equal(ID.normalize(story("A", "file:///tmp/a"), start), null);
});

test("normalized titles merge across publishers, short generic titles do not", () => {
  const rows = ID.dedupe([
    story("1", "https://a.example/1", "Ｆilm Star — New Project !"),
    story("2", "https://b.example/2", "film star-new project!"),
    story("3", "https://a.example/3", "News"),
    story("4", "https://b.example/4", "News"),
    story("5", "https://a.example/5", "新电影　正式宣布主演"),
    story("6", "https://b.example/6", "新电影正式宣布主演"),
  ], start);
  assert.equal(rows.length, 4);
  assert.ok(ID.keysFor(rows[0]).includes(ID.normalize(story("2", "https://b.example/2"), start).id));
  assert.equal(ID.titleKey("News"), "");
});

test("dedupe resolves transitive URL/title groups, retains aliases and stable representative", () => {
  const left = story("one", "https://a.example/1", "A detailed article about a new film");
  const right = story("two", "https://b.example/2", "Another detailed article about a new film");
  const bridge = story("bridge", left.link + "?utm_source=x", right.title);
  const rows = ID.dedupe([left, right, bridge], start);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, ID.normalize(left, start).id);
  assert.ok(ID.keysFor(rows[0]).includes(ID.normalize(right, start).id));
  assert.ok(ID.keysFor(rows[0]).includes(ID.titleKey(right.title)));
  assert.deepEqual(ID.dedupe(rows, start), rows);
});

test("age, malformed items, and pool limit", () => {
  const old = { ...A, publishedAt: new Date(start - ID.MAX_AGE_MS - 1).toISOString() };
  const rows = ID.dedupe([old, null, { title: "bad", link: "javascript:x" }, ...Array.from({length: 60}, (_, i) => story(String(i)))], start);
  assert.equal(rows.length, 50);
  assert.equal(new Set(rows.map(i => i.id)).size, 50);
  assert.equal(ID.dedupe([{...A, publishedAt: null}], start).length, 1);
});

test("unseen-first, no repeat across refresh, cooldown then least recently shown", () => {
  let h = G.record(null, A, start);
  assert.deepEqual(G.eligible([A,B,C], h, start).map(x => x.title), [B.title,C.title]);
  h = G.record(h, B, start + 1);
  // A disappeared from a response, then reappeared with a tracking link.
  const returned = {...A, link: A.link + "?utm_medium=social"};
  assert.deepEqual(G.eligible([returned,B,C], h, start + 2).map(x => x.title), [C.title]);
  h = G.record(h, C, start + 2);
  assert.deepEqual(G.eligible([A,B,C], h, start + G.COOLDOWN_MS - 1), []);
  assert.equal(G.eligible([A,B,C], h, start + G.COOLDOWN_MS + 2)[0].title, A.title);
  h = G.record(h, returned, start + G.COOLDOWN_MS + 2);
  assert.equal(G.eligible([A,B,C], h, start + G.COOLDOWN_MS + 2)[0].title, B.title);
});

test("singleton cooldown, newly arrived news, cross-source aliases, expiry and legacy history migration", () => {
  const h = G.record(null, A, start);
  assert.equal(G.eligible([A], h, start).length, 0);
  assert.equal(G.eligible([A], h, start + G.COOLDOWN_MS).length, 1);
  assert.equal(G.eligible([A,B], h, start + 10)[0].title, B.title);
  assert.equal(G.eligible([{...A, link:"https://different.example.com/reprint"}], h, start + 10).length, 0);
  assert.equal(G.history(h, start + ID.MAX_AGE_MS).entries.length, 0);
  assert.equal(G.eligible([A,B], {seen:[A.title], last:A.title}, start)[0].title, B.title);
  const dirty = {v:2, entries:[null,{at:Infinity,keys:["broken"]},{at:start+10,keys:ID.keysFor(A)},{at:start,keys:["broken"]}]};
  assert.equal(G.history(dirty,start).entries.length,0);
  let many = null;
  for (let i=0;i<510;i++) many = G.record(many, story(String(i)), start+i);
  assert.equal(many.entries.length,G.HISTORY_LIMIT);
});

test("actual app news draw participates in D1 transaction and reload; no fetch consumes history", () => {
  const memory = new Map();
  const storage = {getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const app = read("js/app.js");
  const from = app.indexOf("function gossipCandidates()");
  const to = app.indexOf("/* Chance values", from);
  assert.ok(from>=0 && to>from);
  function boot() {
    const deckState = D.createDeckState(storage, ()=>0);
    return new Function("NAM_GOSSIP","deckState","gossipClient","lang","gossipEndpoint","pick",
      app.slice(from,to)+"\nreturn {drawGossipItem,gossipCandidates};")(
      G, deckState, {items:()=>[A,B]}, "en", ()=>endpoint, rows=>rows[0]);
  }
  let deck = D.createDeckState(storage,()=>0);
  const api = new Function("NAM_GOSSIP","deckState","gossipClient","lang","gossipEndpoint","pick",
    app.slice(from,to)+"\nreturn {drawGossipItem,gossipCandidates};")(
    G, deck, {items:()=>[A,B]}, "en", ()=>endpoint, rows=>rows[0]);
  assert.equal(api.gossipCandidates().length,2);
  assert.equal(memory.size,0);
  assert.throws(()=>deck.transact(()=>{api.drawGossipItem();throw Error("render failed");}), /render failed/);
  assert.equal(api.gossipCandidates().length,2);
  assert.equal(deck.transact(()=>api.drawGossipItem()).title,A.title);
  assert.equal(boot().gossipCandidates()[0].title,B.title);
  assert.equal(deck.transact(()=>api.drawGossipItem()).title,B.title);
  assert.equal(boot().gossipCandidates().length,0);
});

test("client request URLs, language slots, shared promises and out-of-order responses", async () => {
  const pending = new Map(), timers = fakeTimers();
  const client = G.createClient({ now:()=>start, ...timers, fetcher:url=>new Promise(resolve=>pending.set(new URL(url).searchParams.get("lang"),resolve)) });
  assert.equal(G.requestUrl("https://worker.example.com", "zh"),endpoint+"?lang=zh&v=2");
  const zh = client.refresh("zh",endpoint);
  assert.equal(client.refresh("zh",endpoint),zh);
  const en = client.refresh("en",endpoint);
  await Promise.resolve();
  assert.equal(pending.size,2);
  pending.get("en")(response(list("en",[A,B])));
  await en;
  pending.get("zh")(response(list("zh",[C])));
  await zh;
  assert.equal(client.items("en",endpoint).length,2);
  assert.equal(client.items("zh",endpoint)[0].title,C.title);
  assert.equal(timers.timers.size,0);
  await client.refresh("en",endpoint);
  assert.equal(pending.size,2);
});

test("client rejects legacy single-item, wrong language, invalid lists and stale responses", async () => {
  let now=start, value=A, calls=0;
  const timers=fakeTimers();
  const client=G.createClient({now:()=>now,...timers,fetcher:async()=>{calls++;return response(value);}});
  assert.deepEqual(await client.refresh("en",endpoint),[]);
  assert.deepEqual(await client.refresh("en",endpoint),[]);
  assert.equal(calls,1);
  for (const bad of [list("zh",[A]), list("en",[]), list("en",[{title:"bad",link:"javascript:x"}]), list("en",[A],start-ID.MAX_STALE_MS-1)]) {
    now+=G.RETRY_MS;
    value=bad;
    assert.deepEqual(await client.refresh("en",endpoint),[]);
  }
  now+=G.RETRY_MS;
  value=list("en",[A,B],now);
  assert.equal((await client.refresh("en",endpoint)).length,2);
  now+=G.CACHE_MS;
  value=list("en",[C],start);
  await client.refresh("en",endpoint);
  assert.equal(client.items("en",endpoint)[0].title,A.title);
  now+=ID.MAX_STALE_MS;
  assert.equal(client.items("en",endpoint).length,0);
});

test("timeout releases pending request and retries, old endpoint cannot replace new endpoint", async () => {
  let now=start;
  const pending=new Map(), timers=fakeTimers();
  const client=G.createClient({now:()=>now,...timers,fetcher:(url,opts)=>new Promise(resolve=>pending.set(url,{resolve,signal:opts.signal}))});
  const a=client.refresh("en",endpoint);
  await Promise.resolve();
  const old=pending.get(G.requestUrl(endpoint,"en"));
  const b=client.refresh("en","https://new.example/gossip");
  await Promise.resolve();
  pending.get(G.requestUrl("https://new.example/gossip","en")).resolve(response(list("en",[B])));
  await b;
  old.resolve(response(list("en",[A])));
  await a;
  assert.equal(client.items("en","https://new.example/gossip")[0].title,B.title);
  const other=client.refresh("zh",endpoint);
  await Promise.resolve();
  for(const fn of timers.timers.values()) fn();
  assert.deepEqual(await other,[]);
  assert.ok(pending.get(G.requestUrl(endpoint,"zh")).signal.aborted);
  now+=G.RETRY_MS;
  const retry=client.refresh("zh",endpoint);
  await Promise.resolve();
  pending.get(G.requestUrl(endpoint,"zh")).resolve(response(list("zh",[C],now)));
  assert.equal((await retry)[0].title,C.title);
});

async function workerModule() {
  return import(pathToFileURL(path.join(root,"gossip-service/worker.js")).href);
}
const rss = (items, title="Test feed") => "<rss><channel><title>"+title+"</title>"+
  items.map(i=>"<item><title><![CDATA["+i.title+"]]></title><link>"+i.link.replaceAll("&","&amp;")+"</link><pubDate>"+i.publishedAt+"</pubDate></item>").join("")+"</channel></rss>";

test("real Worker parsers merge RSS and Atom, keep source suffix semantics and source diversity", async () => {
  const w = await workerModule();
  const a = story("a","https://a.example/one?utm_medium=x");
  const b = {...a,link:"https://b.example/reprint"};
  const atom = '<feed><title>Atom publisher</title><entry><title>'+b.title+'</title><link rel="alternate" href="'+b.link+'"/><updated>'+b.publishedAt+'</updated></entry></feed>';
  const merged=w.mergeHeadlines([rss([a]),atom],start);
  assert.equal(merged.length,1);
  assert.ok(ID.keysFor(merged[0]).includes(ID.normalize(b,start).id));
  const parsed=w.parseFeed(rss([story("suffix",undefined,"A title - meaningful ending")],"Test feed"));
  assert.equal(parsed[0].title,"A title - meaningful ending");
  const pools=Array.from({length:3},(_,p)=>Array.from({length:30},(_,i)=>story(p+"-"+i)));
  const round=w.mergePools(pools,start);
  assert.equal(round.length,50);
  assert.equal(round[0].link,pools[0][0].link);
  assert.equal(round[1].link,pools[1][0].link);
  assert.equal(round[2].link,pools[2][0].link);
});

test("real Worker endpoint: strict list response, CORS, fresh cache, language isolation, stale failure and expiration", async () => {
  const w=await workerModule();
  const oldFetch=globalThis.fetch, oldCaches=globalThis.caches, oldNow=Date.now;
  let now=start,calls=0,fail=false;
  const memory=new Map();
  globalThis.caches={default:{
    match:async req=>memory.get(req.url)?.clone(),
    put:async (req,res)=>{memory.set(req.url,res.clone());},
  }};
  Date.now=()=>now;
  globalThis.fetch=async url=>{
    calls++;
    if(fail) throw Error("upstream unavailable");
    if(String(url).includes("s.weibo.com")) return new Response("",{status:200});
    const isZh=/ettoday|chinanews/.test(String(url));
    return new Response(rss(isZh?[C]:[A,B]),{status:200});
  };
  const request=lang=>w.default.fetch(new Request(endpoint+"?lang="+lang+"&v=2"));
  try {
    const en=await request("en");
    assert.equal(en.status,200);
    assert.equal(en.headers.get("Access-Control-Allow-Origin"),"*");
    const body=await en.json();
    assert.equal(body.lang,"en");
    assert.equal(body.fetchedAt,start);
    assert.equal(body.items.length,2);
    assert.equal(body.title,undefined);
    assert.equal(new Set(body.items.map(x=>x.id)).size,2);
    const count=calls;
    assert.deepEqual(await (await request("en")).json(),body);
    assert.equal(calls,count);
    const zh=await (await request("zh")).json();
    assert.equal(zh.lang,"zh");
    assert.equal(zh.items[0].title,C.title);
    fail=true;
    now+=G.CACHE_MS+1;
    const stale=await (await request("en")).json();
    assert.equal(stale.fetchedAt,start);
    assert.equal(stale.items.length,2);
    const failureCalls=calls;
    await request("en");
    assert.equal(calls,failureCalls);
    now=start+ID.MAX_STALE_MS+1;
    const expired=await request("en");
    assert.equal(expired.status,503);
    assert.deepEqual(await expired.json(),{error:"no_headlines"});
    assert.equal((await w.default.fetch(new Request("https://worker.example.com/health"))).status,200);
  } finally {
    globalThis.fetch=oldFetch;globalThis.caches=oldCaches;Date.now=oldNow;
  }
});
