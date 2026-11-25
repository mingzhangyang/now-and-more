"""Focused responsive regression using the production CSS and envelope renderer."""
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "js/app.js").read_text()
CSS = (ROOT / "css/style.css").read_text()
INDEX = (ROOT / "index.html").read_text()
DATA = (ROOT / "js/data.js").read_text()


def section(source, start, end):
    i = source.index(start)
    return source[i:source.index(end, i)]


def lang_block(lang):
    zh, en = DATA.split("  en: {", 1)
    return zh if lang == "zh" else en


def quoted(lang, key):
    match = re.search(rf'\n\s+{re.escape(key)}: "([^"]*)"', lang_block(lang))
    if not match:
        raise AssertionError(key + " missing for " + lang)
    return match.group(1)


COPY = {
    lang: {key: quoted(lang, key) for key in (
        "approx", "loading", "error", "retry", "reload", "moonCredit",
        "capture", "captureClose", "illusMeta",
    )}
    for lang in ("zh", "en")
}

HTML = (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<body data-clock-style="paper">'
    + section(INDEX, '<main class="stage">', '</main>') + '</main>'
    + section(INDEX, '<div id="img-overlay"', '<!-- Keepsake capture result')
    + '</body>'
)
SCRIPT = """
let liveWorldTime = null;
let currentLang = "zh";
const copy = {
  zh: {categories: {sky: "星空"}, sky: {chartMeta: "今夜星图", approx: "按时区粗算 · 星位为近似位置"}, picture: {view: "点击查看", received: "你收到一张图卡"}},
  en: {categories: {sky: "Sky"}, sky: {chartMeta: "Tonight's star chart", approx: "Estimated from your time zone · positions approximate"}, picture: {view: "Tap to view", received: "You've received a picture card"}}
};
const t = () => copy[currentLang];
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;").replaceAll('"', "&quot;");
""" + section(APP, "function pictureInfo(", "/* The envelope itself") + section(
    APP, "function renderEnvelope(", "/* ---------- The picture modal"
)


def fully_inside(flags):
    return flags and all(flags.values())


def check(browser, width, lang):
    page = browser.new_page(viewport={"width": width, "height": 844})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        page.add_script_tag(content=SCRIPT)
        page.evaluate("""lang => {
          currentLang = lang;
          renderEnvelope({cat:"sky",form:"chart"}, {
            cat:document.querySelector("#card-category"),
            meta:document.querySelector("#card-meta"),
            body:document.querySelector("#card-body")
          });
        }""", lang)
        assert page.locator(".env-received").count() == 0
        assert page.locator("canvas").count() == 0
        layout = page.evaluate("""() => {
          const r = s => document.querySelector(s).getBoundingClientRect();
          const p=r(".env-preview"), t=r(".env-text"), c=r(".env-copy"), b=r(".env-cta");
          const stage=document.querySelector(".stage"), card=document.querySelector("#card");
          const sr=stage.getBoundingClientRect(), cr=card.getBoundingClientRect(), body=r("#card-body");
          const grid=getComputedStyle(stage), columns=grid.gridTemplateColumns.split(" ").map(parseFloat);
          const desktop=innerWidth>=1200;
          const cta=document.querySelector(".env-cta");
          return {
            stageMode: grid.display === (desktop ? "grid" : "flex"),
            rightColumn: !desktop || (columns.length===2 &&
              getComputedStyle(card).gridColumnStart==="2" &&
              Math.abs(cr.left-(sr.right-columns[1]))<1 && Math.abs(cr.right-sr.right)<1),
            previewInside: p.left>=body.left-0.5 && p.right<=body.right+0.5 &&
              t.left>=body.left-0.5 && t.right<=body.right+0.5,
            vertical: t.top >= p.bottom,
            fullWidth: Math.abs(p.width-t.width) < 1,
            copyLeft: c.right <= b.left+0.5,
            actionInside: b.right <= t.right+0.5,
            actionOneLine: cta.scrollWidth <= cta.clientWidth+1 &&
              getComputedStyle(cta).whiteSpace === "nowrap"
          };
        }""")
        assert all(layout.values()), (width, lang, layout)

        labels = COPY[lang]
        page.evaluate("""(labels) => {
          document.querySelector("#img-overlay").hidden=false;
          document.querySelector("#img-capture-btn").textContent=labels.capture;
          document.querySelector("#img-close-btn").textContent=labels.captureClose;
          document.querySelector("#img-cat").textContent="Sky";
          document.querySelector("#img-meta").textContent="Tonight's star chart";
          document.querySelector("#img-card").dataset.skyState="ready";
          document.querySelector("#img-body").innerHTML =
            '<div class="img-fit"><canvas class="sky-canvas sky-chart" data-form="chart" width="880" height="880"></canvas></div>' +
            '<div class="fact-row"><span>Tonight: Cassiopeia</span></div>' +
            '<div class="sub">Positions approximate</div>';
        }""", labels)
        for form in ("chart", "moon"):
            page.locator("#img-body canvas").evaluate("""(c, form) => {
              c.className="sky-canvas sky-"+form;
              c.width=c.height=form==="chart"?880:720;
            }""", form)
            fit = page.evaluate("""() => {
              const r=s=>document.querySelector(s).getBoundingClientRect();
              const c=r("#img-body canvas"), b=r("#img-body"), d=document.querySelector(".img-dialog");
              const canvas=document.querySelector("#img-body canvas");
              return {
                left:c.left>=b.left-0.5,
                right:c.right<=b.right+0.5,
                square:Math.abs(c.width-c.height)<1,
                centered:Math.abs(c.left+c.width/2-b.left-b.width/2)<1,
                noHorizontalScroll:d.scrollWidth<=d.clientWidth+1,
                noVerticalScroll:d.scrollHeight<=d.clientHeight+1,
                fullWidth:Math.abs(c.width-b.width)<1,
                transparent:getComputedStyle(d).backgroundColor==="rgba(0, 0, 0, 0)" &&
                  getComputedStyle(d).borderTopWidth==="0px" &&
                  getComputedStyle(d).boxShadow==="none" &&
                  getComputedStyle(document.querySelector("#img-card")).backgroundColor==="rgba(0, 0, 0, 0)",
                chromeHidden:r("#img-card .card-head").width<=1 &&
                  r("#img-card .sub").width<=1,
                captionShown:r("#img-card .fact-row").width>8 &&
                  r("#img-card .fact-row").bottom<=innerHeight &&
                  r("#img-card .fact-row").top>=0,
                edged:getComputedStyle(canvas).boxShadow!=="none",
                focusRoom:parseFloat(getComputedStyle(d).paddingBottom)>=4,
                buttonsFit:r("#img-close-btn").bottom<=innerHeight &&
                  r("#img-close-btn").height>=44 &&
                  r("#img-capture-btn").bottom<=innerHeight &&
                  r("#img-capture-btn").top>=0
              };
            }""")
            assert all(fit.values()), (width, lang, form, fit)

        page.evaluate("""() => {
          document.querySelector("#img-card").dataset.skyState="error";
          document.querySelector("#img-body .fact-row").innerHTML =
            '<span>Unavailable</span><span><button class="sky-retry">Retry</button></span>';
        }""")
        retry = page.locator("#img-body .sky-retry")
        box = retry.bounding_box()
        assert retry.is_visible() and box["height"] >= 44
        assert box["y"] >= 0 and box["y"] + box["height"] <= 844

        for form in ("postcard", "skyart"):
            page.evaluate("""form => {
              const card = document.querySelector("#img-card");
              card.className = "card img-card has-" + form;
              delete card.dataset.skyState;
              document.querySelector("#img-body").innerHTML =
                '<div class="img-fit"><div class="' + form + '"><div>Image composition</div></div></div>';
            }""", form)
            box = page.locator("#img-body ." + form).bounding_box()
            assert abs(box["height"] - box["width"] * 4 / 3) < 1, (width, lang, form, box)
            close = page.locator("#img-close-btn").bounding_box()
            assert close["y"] >= 0 and close["y"] + close["height"] <= 844
            assert close["height"] >= 44
            assert page.locator(".img-dialog").evaluate("(d) => d.scrollHeight <= d.clientHeight + 1")
    finally:
        page.close()


def check_lightbox(browser, width, height, lang):
    """Portrait and landscape, using the modal markup for ready, loading and error."""
    copy = COPY[lang]
    states = [
        {"kind": "chart", "skyState": "ready", "message": "Tonight: Cassiopeia", "label": ""},
        {"kind": "chart", "skyState": "loading", "message": copy["loading"], "label": ""},
        {"kind": "chart", "skyState": "error", "message": copy["error"], "label": copy["retry"]},
        {"kind": "moon", "skyState": "error", "message": copy["error"], "label": copy["reload"]},
        {"kind": "moon", "skyState": "ready", "message": "about 100% lit", "label": ""},
        {"kind": "postcard", "skyState": "ready", "message": "", "label": ""},
        {"kind": "skyart", "skyState": "error", "message": copy["error"], "label": copy["retry"]},
        {"kind": "skyart", "skyState": "error", "message": copy["error"], "label": copy["reload"]},
    ]
    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        for state in states:
            page.evaluate("""({copy, state}) => {
              document.querySelector("#img-overlay").hidden = false;
              document.querySelector("#img-capture-btn").textContent = copy.capture;
              document.querySelector("#img-close-btn").textContent = copy.captureClose;
              const card = document.querySelector("#img-card");
              card.className = "card img-card" + ((state.kind === "postcard" || state.kind === "skyart") ? " has-" + state.kind : "");
              card.dataset.skyState = state.skyState;
              const facts = state.label
                ? `<span>${state.message}</span><span><button type="button" class="sky-retry">${state.label}</button></span>`
                : `<span>${state.message}</span>`;
              const body = document.querySelector("#img-body");
              if (state.kind === "chart" || state.kind === "moon") {
                const canvas = state.kind === "moon"
                  ? '<canvas class="sky-canvas sky-moon" data-form="moon" width="720" height="720"></canvas>'
                  : '<canvas class="sky-canvas sky-chart" data-form="chart" width="880" height="880"></canvas>';
                const big = state.kind === "moon" ? `<span class="big">${copy.loading}</span>` : "";
                const credit = state.kind === "moon" ? `<div class="sub">${copy.moonCredit}</div>` : "";
                body.innerHTML = `<div class="img-fit">${canvas}</div>${big}<div class="fact-row">${facts}</div><div class="sub">${copy.approx}</div>${credit}`;
              } else if (state.kind === "postcard") {
                body.innerHTML = '<div class="img-fit"><div class="postcard"><div class="pc-photo"></div><div class="pc-text"><div class="pc-head"><h3 class="pc-title">Daxue</h3><p class="pc-meta">Dec 7</p></div><p class="pc-passage">A line for the day.</p></div></div></div>';
              } else {
                body.innerHTML =
                  `<div class="img-fit"><div class="skyart"><div class="sa-photo"><canvas class="sky-canvas sky-illustration" data-form="illustration" width="1080" height="1180"></canvas></div>` +
                  `<div class="sa-text"><div class="sa-head"><h3 class="sa-title">Where you are</h3><p class="sa-meta">${copy.illusMeta}</p></div></div></div></div>` +
                  `<div class="fact-row skyart-status">${facts}</div>`;
              }
            }""", {"copy": copy, "state": state})
            fit = page.evaluate("""(state) => {
              const box = el => el.getBoundingClientRect();
              const inside = el => {
                const b = box(el);
                const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, b.width - 1), b.top + b.height / 2);
                return {
                  top: b.top >= -0.5, left: b.left >= -0.5,
                  bottom: b.bottom <= innerHeight + 0.5, right: b.right <= innerWidth + 0.5,
                  tall: b.height >= 44, wide: b.width > 8,
                  hit: !!(hit && (hit === el || el.contains(hit)))
                };
              };
              const art = document.querySelector("#img-body > .img-fit > .skyart, #img-body > .img-fit > .postcard, #img-body > .img-fit > canvas");
              const a = box(art);
              const d = document.querySelector(".img-dialog");
              const retry = document.querySelector(".sky-retry");
              const sky = document.querySelector(".skyart");
              return {
                artW: a.width, artH: a.height, artTop: a.top, artBottom: a.bottom,
                actions: {
                  capture: inside(document.querySelector("#img-capture-btn")),
                  close: inside(document.querySelector("#img-close-btn"))
                },
                retry: retry ? inside(retry) : null,
                retryInArt: !!(retry && sky && sky.contains(retry)),
                scroll: d.scrollHeight <= d.clientHeight + 1 && d.scrollWidth <= d.clientWidth + 1,
                square: art.matches("canvas") ? Math.abs(a.width - a.height) < 1 : true,
                ratio: art.matches("canvas") ? true : Math.abs(a.height - a.width * 4 / 3) < 1,
                edged: getComputedStyle(art).boxShadow !== "none",
                chromeHidden: state.kind === "chart" || state.kind === "moon"
                  ? box(document.querySelector("#img-card .card-head")).width <= 1 &&
                    box(document.querySelector("#img-card .sub")).width <= 1
                  : true,
                captionShown: (state.kind === "chart" || state.kind === "moon") && state.skyState === "ready"
                  ? box(document.querySelector("#img-card .fact-row")).width > 8 &&
                    box(document.querySelector("#img-card .fact-row")).bottom <= innerHeight + 0.5
                  : true,
                phaseShown: state.kind === "moon" && state.skyState === "ready"
                  ? box(document.querySelector("#img-card .big")).width > 8 &&
                    box(document.querySelector("#img-card .big")).bottom <= innerHeight + 0.5
                  : true
              };
            }""", state)
            where = (width, height, lang, state["kind"], state["skyState"], state["label"], fit)
            assert fit["artW"] > 40 and fit["artH"] > 40, where
            assert 0 <= fit["artTop"] and fit["artBottom"] <= height + 0.5, where
            assert fully_inside(fit["actions"]["capture"]) and fully_inside(fit["actions"]["close"]), where
            assert fit["scroll"] and fit["square"] and fit["ratio"] and fit["chromeHidden"], where
            assert fit["captionShown"] and fit["phaseShown"] and fit["edged"], where
            if state["label"]:
                assert fully_inside(fit["retry"]), where
                if state["kind"] == "skyart":
                    assert fit["retryInArt"] is False, where
            else:
                assert fit["retry"] is None, where
    finally:
        page.close()


def check_row_envelopes(browser, width, lang):
    """Horizontal postcard / sky envelopes keep their words inside the card."""
    samples = {
        "zh": [
            ("明信片", "你收到一张图卡", "中秋 · 一轮圆月挂在城上", "宜窗边", "长街灯火与远处的潮声都停在这一夜里", "点击查看"),
            ("星空", "你收到一张图卡", "布宜诺斯艾利斯", "今夜的星空插画", "", "点击查看"),
            ("星空", "你收到一张图卡", "AntananarivoObservatoryNight", "满月 · 照亮约 100%", "", "点击查看"),
        ],
        "en": [
            ("Postcard", "You've received a picture card", "Mid-Autumn Festival", "A round moon over the city", "The tide and the street lamps pause for this one night", "Tap to view"),
            ("Sky", "You've received a picture card", "Buenos Aires", "Tonight's illustrated sky", "", "Tap to view"),
            ("Sky", "You've received a picture card", "AntananarivoObservatoryNight", "Full moon · about 100% lit", "", "Tap to view"),
        ],
    }[lang]
    page = browser.new_page(viewport={"width": width, "height": 844})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        for sample in samples:
            page.evaluate("""(sample) => {
              const [cat, received, title, intro, glimpse, view] = sample;
              document.querySelector("#card").className = "card has-envelope";
              document.querySelector("#card-category").textContent = cat;
              document.querySelector("#card-body").innerHTML =
                '<div class="envelope env-postcard">' +
                '<div class="env-preview env-preview-sky"></div>' +
                '<div class="env-text">' +
                '<p class="env-received">' + received + '</p>' +
                '<span class="big env-title">' + title + '</span>' +
                '<div class="sub env-intro">' + intro + '</div>' +
                (glimpse ? '<div class="sub env-glimpse">' + glimpse + '</div>' : '') +
                '<p class="env-cta">' + view + ' <span aria-hidden="true">›</span></p>' +
                '</div></div>';
            }""", list(sample))
            fit = page.evaluate("""() => {
              const r = s => document.querySelector(s).getBoundingClientRect();
              const body = r("#card-body");
              const card = document.querySelector("#card");
              const title = r(".env-title"), intro = r(".env-intro"), cta = r(".env-cta"), preview = r(".env-preview");
              const inside = b => b.left >= body.left - 0.5 && b.right <= body.right + 0.5 &&
                b.top >= body.top - 0.5 && b.bottom <= body.bottom + 0.5;
              return {
                noCardOverflow: card.scrollWidth <= card.clientWidth + 1,
                previewInside: inside(preview),
                titleInside: inside(title),
                introInside: inside(intro),
                ctaInside: inside(cta),
                row: preview.right <= title.left + 1,
                titleVisible: title.width > 8 && title.height > 8
              };
            }""")
            assert all(fit.values()), (width, lang, sample[2], fit)
    finally:
        page.close()


def check_stage_illustration_retry(browser):
    """A failed illustration on the stage keeps Try again outside the clipped paper."""
    page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        page.evaluate("""() => {
          const card = document.querySelector("#card");
          card.className = "card has-skyart";
          document.querySelector("#card-body").innerHTML =
            '<div class="skyart"><div class="sa-photo"></div>' +
            '<div class="sa-text"><div class="sa-head"><h3 class="sa-title">Where you are</h3></div></div></div>' +
            '<div class="fact-row skyart-status"><span>The sky did not load this time.</span>' +
            '<span><button type="button" class="sky-retry">Try again</button></span></div>';
        }""")
        fit = page.evaluate("""() => {
          const sky = document.querySelector(".skyart");
          const btn = document.querySelector(".sky-retry");
          const br = btn.getBoundingClientRect();
          const sr = sky.getBoundingClientRect();
          return {
            outside: !sky.contains(btn),
            below: br.top >= sr.bottom - 1,
            tall: br.height >= 24,
            wide: br.width > 8,
            artClips: getComputedStyle(sky).overflow === "hidden"
          };
        }""")
        assert all(fit.values()), fit
    finally:
        page.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        options = {"headless": True}
        if os.getenv("CHROMIUM_PATH"):
            options["executable_path"] = os.environ["CHROMIUM_PATH"]
        browser = p.chromium.launch(**options)
        for width in (320, 375, 390, 430, 768, 1199, 1200, 1440):
            for lang in ("zh", "en"):
                check(browser, width, lang)
        for width in (320, 375, 390):
            for lang in ("zh", "en"):
                check_row_envelopes(browser, width, lang)
        check_stage_illustration_retry(browser)
        for width, height in ((390, 844), (320, 844), (844, 390), (667, 320)):
            for lang in ("zh", "en"):
                check_lightbox(browser, width, height, lang)
        browser.close()
    print("envelope rows, stage retry, tall lightbox canvases, and portrait/landscape controls passed")
