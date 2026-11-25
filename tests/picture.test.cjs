"use strict";
const test = require("node:test");
const { mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("js/app.js");
const data = read("js/data.js");

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
}

/* Real envelope / modal / receipt code from app.js, driven through a
   tiny element-map DOM. Only the boundaries are stubbed: the SDK
   (NAM_SKY), the scene summary, the postcard meta line and the
   keepsake entry the modal's button calls. */
function harness() {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const elements = new Map();
  function makeEl(id) {
    const el = {
      id, hidden: true, disabled: false, textContent: "", innerHTML: "",
      isConnected: true, focused: 0, dataset: {}, children: [], handlers: {},
      classList: {
        _s: new Set(),
        add(...cs) { cs.forEach((c) => this._s.add(c)); },
        remove(...cs) { cs.forEach((c) => this._s.delete(c)); },
        toggle(c, f) {
          if (f === undefined) f = !this._s.has(c);
          if (f) this._s.add(c); else this._s.delete(c);
          return f;
        },
        contains(c) { return this._s.has(c); },
      },
      addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
      setAttribute() {}, getAttribute() { return null; },
      focus() { this.focused++; },
      querySelector(sel) {
        // The one lookup the sky paint path cannot do without: the
        // canvas inside the card body. Everything else stays null,
        // which the copy/retry code already treats as "not there".
        return sel === "canvas.sky-canvas" ? { fakeCanvas: true } : null;
      },
      querySelectorAll() { return []; },
      append() {},
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; this.innerHTML = ""; },
      style: { setProperty() {} },
      decode: async () => {},
    };
    return el;
  }
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  const documentStub = {
    addEventListener() {},
    createElement: () => makeEl("anon"),
    createTextNode: (text) => ({ textContent: text }),
  };
  const paintCalls = [];
  const NAM_SKY = {
    sceneFor: () => Promise.resolve({ fake: true }),
    paintChart: async () => { paintCalls.push("chart"); },
    paintMoon: async () => { paintCalls.push("moon"); },
    paintIllustration: async () => {
      paintCalls.push("illustration");
      // With hang set, the paint starts but never lands — the live
      // first-open blank — until the test releases it.
      if (NAM_SKY.hang) await new Promise((resolve) => { NAM_SKY.release = resolve; });
    },
    hang: false, release: null,
    reset() {}, needsReload: () => false, warm: async () => {},
  };
  const source = data + "\n" + `
    let lang = "zh", ambientOn = false, currentSelection = null, encounter = 0,
        lastDrawAt = 0, liveWorldTime = null, imageModalSel = null;
    const appStorage = storage;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const t = () => I18N[lang];
    const postcardMetaParts = () => ({ pre: lang === "zh" ? "12月7日" : "Dec 7", time: null, post: "" });
    const skySummary = () => ({ sig: null, moon: { illum: 100, age: 15, idx: 4 } });
    const skyPlaceName = (place) => place && place.city
      ? (lang === "zh" ? place.city.zh : place.city.en) : t().sky.hereLabel;
    const postcardMetaText = () => lang === "zh" ? "12月7日" : "Dec 7";
    const fullTextOf = () => "";
    const KEEP_W = 1080, SKY_KEEP_ART_H = 1350;
    const fakePicture = (height = 1440) => ({
      width: 1080, height,
      toBlob: (done) => done(new Blob(["picture"], { type: "image/png" })),
    });
    const ensureCaptureFonts = async () => {};
    const capturePalette = () => ({ serif: "serif" });
    const renderAstronomyPicture = () => fakePicture();
    const renderSkyArtKeepsake = async () => fakePicture(1700);
    const loadPostcardImage = async () => ({});
    const renderPostcardKeepsake = () => fakePicture();
  ` +
    section("const MOON_GLYPHS", "/* ================= Night sky") +
    section("let skyVisualGen", "/* ================= End night sky") +
    section("function postcardDayKey(", "/* The meta line") +
    section("/* ================= Picture cards: envelope & modal", '$("note-save").addEventListener') +
    section("function esc(str)", "/* Dated note first") + `
    return {
      renderSelection, openImageModal, closeImageModal, imageModalOpen,
      deliverPostcardGift, stageShowsEnvelope, isPictureCard, pictureInfo, moonPhase,
      setAmbient: (v) => { ambientOn = v; },
      setLang: (v) => { lang = v; },
      get modalSel() { return imageModalSel; },
      get picture() { return modalPicture; },
    };
  `;
  const api = new Function("storage", "$", "document", "NAM_SKY", source)(
    storage, $, documentStub, NAM_SKY);
  return { api, $, storage, sky: NAM_SKY, paintCalls };
}

const daxue = () => ({
  cat: "postcard", key: "daxue", termIdx: 17, instantMs: null, lunarLabel: null,
  gifted: true, giftStamp: "20261207",
});
const skySel = (form) => ({
  cat: "sky", form, summary: null, skyError: null,
  observer: { lat: 31, lon: 121, tz: "Asia/Shanghai", when: new Date(2026, 11, 7, 21) },
  place: form === "illustration" ? { city: { zh: "耶路撒冷", en: "Jerusalem" } } : undefined,
  ready: Promise.resolve({ fake: true }),
});

test("non-ambient picture cards render as envelopes on the stage, not the picture", () => {
  const { api, $ } = harness();
  // Postcard: identity, blurred glimpse of the real painting, CTA.
  api.renderSelection(daxue());
  let body = $("card-body").innerHTML;
  assert.ok(body.includes("envelope"), "envelope markup");
  assert.ok(body.includes('class="env-text"'), "the words ride in their own column beside the thumbnail");
  assert.ok(body.includes("你收到一张图卡"), "received line");
  assert.ok(body.includes("大雪"), "postcard title");
  assert.ok(body.includes("点击查看"), "call to view");
  assert.ok(body.includes("assets/special-dates/daxue.webp"), "real painting as the glimpse");
  assert.ok(!body.includes('class="postcard"'), "the postcard itself is not on the stage");
  assert.equal($("card").classList.contains("has-envelope"), true);
  assert.equal($("card").classList.contains("has-postcard"), false);
  assert.equal($("card-category").textContent, "今日明信片");

  // Sky chart: named, with a motif panel — and no SDK canvas anywhere.
  api.renderSelection(skySel("chart"));
  body = $("card-body").innerHTML;
  assert.ok(body.includes("envelope"));
  assert.ok(body.includes("今夜星图"), "chart title");
  assert.ok(body.includes('class="envelope env-sky env-chart"'), "chart-only stacked layout");
  assert.ok(!body.includes("env-received"), "chart has no redundant received line");
  assert.match(body, /class="env-preview env-preview-sky"[^>]*><\/div><div class="env-text"><div class="env-copy">/);
  assert.match(body, /class="env-copy"><span class="big env-title">今夜星图<\/span><div class="sub env-intro">[^<]+<\/div><\/div><p class="env-cta">点击查看 /);
  assert.ok(body.includes("env-preview-sky"), "starfield motif preview");
  assert.ok(!body.includes("sky-canvas"), "no sky canvas is painted for an envelope");

  // Sky moon: the phase name comes from the site's own moonPhase().
  const moon = skySel("moon");
  api.renderSelection(moon);
  body = $("card-body").innerHTML;
  assert.ok(body.includes("此刻的月亮"), "moon title");
  assert.ok(body.includes("env-received"), "other picture envelopes are unchanged");
  assert.ok(!body.includes("env-chart"));
  const phase = api.moonPhase(new Date(moon.observer.when)).idx;
  assert.ok(body.includes(["新月", "娥眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"][phase]),
    "moon phase intro");

  // Sky illustration: the envelope names its place.
  api.renderSelection(skySel("illustration"));
  body = $("card-body").innerHTML;
  assert.ok(body.includes("耶路撒冷"), "illustration place");
  assert.ok(!body.includes("sky-canvas"));

  // English envelope follows the language.
  api.setLang("en");
  api.renderSelection(daxue());
  body = $("card-body").innerHTML;
  assert.ok(body.includes("You&#39;ve received a picture card")); // esc() escapes the apostrophe
  assert.ok(body.includes("Daxue"));
  assert.ok(body.includes("Tap to view"));
  api.renderSelection(skySel("chart"));
  body = $("card-body").innerHTML;
  assert.ok(body.includes("Tonight&#39;s star chart"));
  assert.ok(body.includes("Tap to view"));
  assert.ok(body.includes("env-chart"));
  assert.ok(!body.includes("env-received"));
});

test("gifted postcard: envelope writes no receipt; opening the modal delivers it", async () => {
  const { api, $, storage } = harness();
  const sel = daxue();
  api.renderSelection(sel);
  assert.equal(storage.getItem("nam-postcard-20261207"), null,
    "rendering the envelope must not write the gift receipt");
  assert.equal(api.imageModalOpen(), false);

  api.openImageModal(sel);
  assert.equal(api.imageModalOpen(), true);
  assert.equal(api.modalSel, sel);
  assert.equal($("img-capture-btn").disabled, true, "save waits for the PNG");
  await flush();
  assert.equal($("img-capture-btn").disabled, false);
  assert.equal($("img-capture-btn").textContent, "保存图片");
  assert.equal($("img-body").children[0].children[0].src, api.picture.url);
  assert.match($("img-body").children[0].children[0].alt, /大雪/);
  assert.equal(storage.getItem("nam-postcard-20261207"), "1",
    "opening the picture writes the gift receipt");

  api.closeImageModal();
  assert.equal(api.imageModalOpen(), false);
  assert.equal(api.modalSel, null);

  // A pool re-entry (not gifted) opens without any receipt.
  const again = { cat: "postcard", key: "daxue", termIdx: 17, instantMs: null, lunarLabel: null };
  api.openImageModal(again);
  assert.equal(api.imageModalOpen(), true);
  api.closeImageModal();

  // A sky picture opens in the modal too, and touches no storage.
  const before = storage.getItem("nam-postcard-20261207");
  api.openImageModal(skySel("chart"));
  assert.equal(api.imageModalOpen(), true);
  assert.equal($("img-capture-btn").disabled, true, "chart still loading");
  api.closeImageModal();
  assert.equal(storage.getItem("nam-postcard-20261207"), before);
});

test("ambient mode: picture cards render directly and the modal never opens", () => {
  const { api, $ } = harness();
  api.setAmbient(true);
  api.renderSelection(daxue());
  let body = $("card-body").innerHTML;
  assert.ok(body.includes('class="postcard"'), "postcard renders directly in ambient");
  assert.ok(!body.includes("envelope"), "no envelope in ambient");
  assert.equal($("card").classList.contains("has-postcard"), true);

  api.renderSelection(skySel("illustration"));
  body = $("card-body").innerHTML;
  assert.ok(body.includes("skyart"), "sky illustration renders directly in ambient");
  assert.ok(body.includes("sky-canvas"));
  assert.equal($("card").classList.contains("has-skyart"), true);

  api.openImageModal(daxue());
  assert.equal(api.imageModalOpen(), false, "the picture modal never opens in ambient");
});

test("draw and rotation stay inert while the picture modal is open", () => {
  // The guard lives in drawCard itself: every draw path (minute tick,
  // button, card, space) funnels through it.
  assert.ok(app.includes("if (!drawsReady || drawGate.pending || imageModalSel) return false;"));
  // Closing the modal restarts the visitor's minute.
  const close = section("function closeImageModal()", '$("img-close-btn")');
  assert.ok(close.includes("lastDrawAt = Date.now();"));
  // The stage card opens an envelope instead of drawing past it.
  assert.ok(app.includes('if (stageShowsEnvelope(currentSelection)) { openImageModal(currentSelection); return; }'));
});

test("picture modal: the overlay unhides before the picture renders into it", () => {
  const open = section("function openImageModal(sel)", "function armSkyModalWatchdog");
  assert.ok(
    open.indexOf('$("img-overlay").hidden = false') < open.indexOf("scheduleSkyVisual(sel, surface)"),
    "a sky canvas must start painting in a visible layout, not under display:none");
  assert.ok(open.includes("armSkyModalWatchdog(sel)"), "sky openings arm the watchdog");
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

test("sky modal watchdog: a paint that never lands is re-scheduled exactly once", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { api, $, sky, paintCalls } = harness();
    sky.hang = true; // the first paint starts but never lands (the live blank)
    const sel = skySel("illustration");
    api.openImageModal(sel);
    await flush();
    assert.deepEqual(paintCalls, ["illustration"]);
    assert.equal(sel._paintedGen, undefined, "nothing has painted yet");
    assert.equal($("img-card").dataset.skyState, "loading");

    mock.timers.tick(2800); // the watchdog fires
    await flush();
    assert.deepEqual(paintCalls, ["illustration", "illustration"],
      "the watchdog re-scheduled the modal paint");

    sky.hang = false;
    sky.release(); // the re-scheduled paint lands
    await flush();
    assert.equal(sel._paintedGen, sel._skyGen, "the re-scheduled generation is the painted one");
    assert.equal($("img-card").dataset.skyState, "ready");

    mock.timers.tick(60000); // one-shot: no third schedule, however long the modal stays open
    await flush();
    assert.equal(paintCalls.length, 2);
    api.closeImageModal();
  } finally {
    mock.timers.reset();
  }
});

test("wide layout: the split-grid card rule is scoped to the stage card only", () => {
  // Regression: at >=1200px the split layout once styled every .card —
  // including the picture modal's card. width:auto collapsed the modal
  // card to 0px wide (the .skyart composition is a size container and
  // contributes no intrinsic width), so the modal opened blank on
  // desktop-width windows while narrow windows rendered fine.
  const css = read("css/style.css");
  const wide = css.slice(css.indexOf("@media (min-width: 1200px)"));
  const block = wide.slice(0, wide.indexOf("\n}\n") > 0 ? wide.indexOf("\n}\n") : 4000);
  assert.ok(!/body:not\(\.ambient\) \.card \{/.test(block),
    "the wide split-layout rule must not target .card generically");
  assert.ok(/body:not\(\.ambient\) #card \{/.test(block),
    "the wide split-layout rule targets the stage card by id");
  assert.ok(/\.capture-dialog\.img-dialog \{\s*width: min\(680px/.test(css),
    "the picture dialog keeps its 680px width over the generic capture dialog");
  assert.ok(!css.includes("--img-height") && !css.includes("max(180px"),
    "the lightbox must not reserve a fixed chrome height or a 180px composition floor");
  assert.match(css, /#img-card \.img-fit \{[\s\S]*container-type: size;/);
  assert.match(css, /width: min\(100cqw, calc\(100cqh \* var\(--picture-ratio, 0\.75\)\)\)/);
  assert.match(app, /className = "img-fit"/);
  assert.match(app, /fact-row skyart-status/);
  assert.match(app, /if \(sel\.skyError\) \{[\s\S]*?skyart-status/);
  assert.doesNotMatch(app, /if \(!surface\.stage && sel\.skyError\)/);
});

test("sky modal watchdog: closing the modal disarms it", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { api, sky, paintCalls } = harness();
    sky.hang = true;
    const sel = skySel("illustration");
    api.openImageModal(sel);
    await flush();
    assert.deepEqual(paintCalls, ["illustration"]);
    api.closeImageModal();
    mock.timers.tick(10000); // the leftover timer must not fire into a closed modal
    await flush();
    assert.deepEqual(paintCalls, ["illustration"], "no re-schedule after close");
  } finally {
    mock.timers.reset();
  }
});

test("lightbox tracks sky failure, successful paint and close", async () => {
  const { api, $ } = harness();
  const sel = skySel("chart");
  sel.ready = Promise.reject(new Error("offline"));
  api.openImageModal(sel);
  assert.equal($("img-card").dataset.skyState, "loading");
  await sel.painted;
  assert.equal($("img-card").dataset.skyState, "error");
  assert.equal($("img-capture-btn").disabled, true);
  assert.equal(api.picture, null);
  api.closeImageModal();
  assert.equal($("img-card").dataset.skyState, undefined);
  const next = skySel("moon");
  api.openImageModal(next);
  await next.painted;
  assert.equal($("img-card").dataset.skyState, "ready");
  assert.equal($("img-capture-btn").disabled, false);
  assert.equal($("img-body").children[0].children[0].src, api.picture.url);
  assert.equal(api.picture.blob.type, "image/png");
  api.closeImageModal();
  assert.equal(api.picture, null);
  assert.equal($("img-capture-btn").disabled, true);
  assert.equal($("img-card").dataset.skyState, undefined);
});


test("near-full moon doubles lunar portrait odds without changing ordinary sky odds", () => {
  const choose = new Function("DAY_MS", section("const MOON_GLYPHS", "/* ================= Night sky") + "\nreturn chooseSkyForm;")(86400000);
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const atAge = age => new Date(epoch + age * 86400000);
  const odds = date => Array.from({length: 600}, (_, i) => choose(date, () => (i + 0.5) / 600))
    .reduce((counts, form) => ({...counts, [form]: (counts[form] || 0) + 1}), {});
  for (const age of [14, 14.765, 16]) {
    assert.deepEqual(odds(atAge(age)), {chart:100, illustration:100, moon:400});
  }
  for (const age of [0, 7, 12, 18, 22]) {
    assert.deepEqual(odds(atAge(age)), {chart:200, illustration:200, moon:200});
  }
  assert.match(app, /const now = new Date\(\);\s*const form = chooseSkyForm\(now\);/);
});
