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
        "captureDownload", "captureClose", "illusMeta",
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
  zh: {categories: {sky: "星空"}, sky: {chartMeta: "今夜星图", approx: "按时区粗算 · 星位为近似位置"}, picture: {view: "点击查看"}},
  en: {categories: {sky: "Sky"}, sky: {chartMeta: "Tonight's star chart", approx: "Estimated from your time zone · positions approximate"}, picture: {view: "Tap to view"}}
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
            actionPlaced: c.right <= b.left+0.5 || b.top >= c.bottom-0.5,
            actionInside: b.right <= t.right+0.5,
            actionOneLine: cta.scrollWidth <= cta.clientWidth+1 &&
              getComputedStyle(cta).whiteSpace === "nowrap"
          };
        }""")
        assert all(layout.values()), (width, lang, layout)

    finally:
        page.close()



def check_lightbox(browser, width, height, lang):
    """Real production publication/save code and intrinsic aspect ratios."""
    copy = COPY[lang]
    page = browser.new_page(viewport={"width": width, "height": height}, accept_downloads=True)
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        page.add_script_tag(content="""
const $ = id => document.getElementById(id);
let skyVisualGen = 0, imageModalSel = null;
const modalSurface = () => ({card: $("img-card"), body: $("img-body")});
const imageModalOpen = () => !$("img-overlay").hidden;
""" + section(APP, "let modalPicture = null;", "async function renderModalPostcard(") + """
$("img-capture-btn").addEventListener("click", saveModalPicture);
""")
        for kind in ("chart", "moon", "postcard", "illustration"):
            image_height = 1700 if kind == "illustration" else 1440
            assert page.evaluate("""async ({kind, imageHeight, copy}) => {
              $("img-overlay").hidden = false;
              $("img-capture-btn").textContent = copy.captureDownload;
              $("img-close-btn").textContent = copy.captureClose;
              clearModalPicture();
              imageModalSel = {cat: kind === "postcard" ? "postcard" : "sky", form: kind};
              $("img-card").dataset.skyGen = String(++skyVisualGen);
              const canvas = document.createElement("canvas");
              canvas.width = 1080; canvas.height = imageHeight;
              const ctx = canvas.getContext("2d");
              ctx.fillStyle = "#10182e"; ctx.fillRect(0, 0, 1080, imageHeight);
              ctx.fillStyle = "#faf4e6"; ctx.fillRect(0, imageHeight - 360, 1080, 360);
              ctx.fillStyle = "#2b2620"; ctx.font = "48px serif";
              ctx.fillText(kind, 56, imageHeight - 260);
              return publishModalPicture(imageModalSel, skyVisualGen, canvas, kind);
            }""", {"kind": kind, "imageHeight": image_height, "copy": copy})
            fit = page.evaluate("""() => {
              const art = document.querySelector(".modal-picture"), a = art.getBoundingClientRect();
              const d = document.querySelector(".img-dialog");
              const inside = el => {
                const b = el.getBoundingClientRect();
                const hit = document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);
                return b.height >= 44 && b.width > 8 && b.top >= -0.5 &&
                  b.left >= -0.5 && b.bottom <= innerHeight+0.5 && b.right <= innerWidth+0.5 &&
                  !!(hit && (hit === el || el.contains(hit)));
              };
              return {
                size: a.width > 40 && a.height > 40,
                inside: a.top >= 0 && a.bottom <= innerHeight+0.5 && a.left >= 0 && a.right <= innerWidth+0.5,
                ratio: Math.abs(a.height - a.width * art.naturalHeight / art.naturalWidth) < 1,
                scroll: d.scrollHeight <= d.clientHeight+1 && d.scrollWidth <= d.clientWidth+1,
                edged: getComputedStyle(art).boxShadow !== "none",
                transparent: getComputedStyle(d).backgroundColor === "rgba(0, 0, 0, 0)",
                chromeHidden: $("img-card").querySelector(".card-head").getBoundingClientRect().width <= 1,
                noExternalCaption: !$("img-body").querySelector(".fact-row, .big, .sub"),
                sameUrl: art.src === modalPicture.url,
                actions: inside($("img-capture-btn")) && inside($("img-close-btn")),
                saveReady: !$("img-capture-btn").disabled
              };
            }""")
            assert all(fit.values()), (width, height, lang, kind, fit)
            if (width, height, lang) == (390, 844, "zh"):
                expected = bytes(page.evaluate("async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('.modal-picture').src)).arrayBuffer()))"))
                with page.expect_download() as download_info:
                    page.locator("#img-capture-btn").click()
                download = download_info.value
                assert download.suggested_filename.endswith(".png")
                assert download.path().read_bytes() == expected, kind
        page.evaluate("""(copy) => {
          clearModalPicture();
          $("img-body").innerHTML = '<div class="fact-row picture-status" role="status"><span>' +
            copy.error + '</span><span><button type="button" class="sky-retry">' + copy.retry + '</button></span></div>';
        }""", copy)
        assert page.locator("#img-capture-btn").is_disabled()
        assert page.locator(".modal-picture").count() == 0
        retry = page.locator(".sky-retry").bounding_box()
        assert retry["height"] >= 44 and retry["y"] >= 0 and retry["y"]+retry["height"] <= height
        assert page.locator("#img-close-btn").is_visible()
    finally:
        page.close()


def check_stacked_envelopes(browser, width, lang):
    """Postcard, moon and illustration envelopes share the chart's stacked
    layout: glimpse on top, then copy and a one-line call to view."""
    samples = {
        "zh": [
            ("明信片", "art", "中秋 · 一轮圆月挂在城上", "宜窗边", "长街灯火与远处的潮声都停在这一夜里"),
            ("明信片", "art", "感恩节", "世界的节日", "感恩节，北美的团圆日。火鸡、南瓜派……"),
            ("星空", "sky", "布宜诺斯艾利斯", "今夜的星空插画", ""),
            ("星空", "sky", "AntananarivoObservatoryNight", "满月 · 照亮约 100%", ""),
        ],
        "en": [
            ("Postcard", "art", "Mid-Autumn Festival", "A round moon over the city", "The tide and the street lamps pause for this one night"),
            ("Postcard", "art", "Thanksgiving", "A Day the World Keeps", "Thanksgiving. North America's reunion day."),
            ("Sky", "sky", "Buenos Aires", "Tonight's illustrated sky", ""),
            ("Sky", "sky", "AntananarivoObservatoryNight", "Full moon · about 100% lit", ""),
        ],
    }[lang]
    view = "点击查看" if lang == "zh" else "Tap to view"
    page = browser.new_page(viewport={"width": width, "height": 844})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        for sample in samples:
            page.evaluate("""([sample, view]) => {
              const [cat, kind, title, intro, glimpse] = sample;
              document.querySelector("#card").className = "card has-envelope";
              document.querySelector("#card-category").textContent = cat;
              const preview = kind === "art"
                ? '<div class="env-preview env-preview-art"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>'
                : '<div class="env-preview env-preview-sky"></div>';
              document.querySelector("#card-body").innerHTML =
                '<div class="envelope env-' + (kind === "art" ? "postcard" : "sky") + '">' + preview +
                '<div class="env-text"><div class="env-copy">' +
                '<span class="big env-title">' + title + '</span>' +
                '<div class="sub env-intro">' + intro + '</div>' +
                (glimpse ? '<div class="sub env-glimpse">' + glimpse + '</div>' : '') +
                '</div><p class="env-cta">' + view + ' <span aria-hidden="true">›</span></p>' +
                '</div></div>';
            }""", [list(sample), view])
            fit = page.evaluate("""() => {
              const r = s => document.querySelector(s).getBoundingClientRect();
              const body = r("#card-body");
              const card = document.querySelector("#card");
              const p = r(".env-preview"), t = r(".env-text"), c = r(".env-copy"), b = r(".env-cta");
              const cta = document.querySelector(".env-cta");
              const title = document.querySelector(".env-title");
              const inside = x => x.left >= body.left - 0.5 && x.right <= body.right + 0.5;
              return {
                noCardOverflow: card.scrollWidth <= card.clientWidth + 1,
                previewInside: inside(p),
                textInside: inside(t),
                vertical: t.top >= p.bottom,
                fullWidth: Math.abs(p.width - t.width) < 1,
                // The call sits beside the copy, or under it on the
                // narrowest phones — never on top of it.
                actionPlaced: c.right <= b.left + 0.5 || b.top >= c.bottom - 0.5,
                actionInside: inside(b),
                actionOneLine: cta.scrollWidth <= cta.clientWidth + 1 &&
                  getComputedStyle(cta).whiteSpace === "nowrap",
                // A one-word name of ordinary length is never split
                // mid-word (the old row layout broke "Thanksgiving").
                titleWhole: /\s/.test(title.textContent) || title.textContent.length > 20 ||
                  title.offsetHeight < 1.5 * parseFloat(getComputedStyle(title).lineHeight)
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
        for width in (320, 340, 360, 375, 390, 768, 1440):
            for lang in ("zh", "en"):
                check_stacked_envelopes(browser, width, lang)
        check_stage_illustration_retry(browser)
        for width, height in ((390, 844), (320, 844), (844, 390), (667, 320), (1440, 900)):
            for lang in ("zh", "en"):
                check_lightbox(browser, width, height, lang)
        browser.close()
    print("stacked envelopes, stage retry, PNG layout, direct download byte equality and controls passed")
