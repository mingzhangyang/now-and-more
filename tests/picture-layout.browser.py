"""Focused responsive regression using the production CSS and envelope renderer."""
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "js/app.js").read_text()
CSS = (ROOT / "css/style.css").read_text()
INDEX = (ROOT / "index.html").read_text()


def section(source, start, end):
    i = source.index(start)
    return source[i:source.index(end, i)]


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

        page.evaluate("""() => {
          document.querySelector("#img-overlay").hidden=false;
          document.querySelector("#img-cat").textContent="Sky";
          document.querySelector("#img-meta").textContent="Tonight's star chart";
          document.querySelector("#img-body").innerHTML =
            '<canvas class="sky-canvas sky-chart" data-form="chart" width="880" height="880"></canvas>' +
            '<div class="fact-row"><span>Tonight: Cassiopeia</span></div>';
        }""")
        for form in ("chart", "moon"):
            page.locator("#img-body canvas").evaluate("""(c, form) => {
              c.className="sky-canvas sky-"+form;
              c.width=c.height=form==="chart"?880:720;
            }""", form)
            fit = page.evaluate("""() => {
              const r=s=>document.querySelector(s).getBoundingClientRect();
              const c=r("#img-body canvas"), b=r("#img-body"), d=document.querySelector(".img-dialog");
              return {
                left:c.left>=b.left-0.5,
                right:c.right<=b.right+0.5,
                square:Math.abs(c.width-c.height)<1,
                centered:Math.abs(c.left+c.width/2-b.left-b.width/2)<1,
                noHorizontalScroll:d.scrollWidth<=d.clientWidth+1
              };
            }""")
            assert all(fit.values()), (width, lang, form, fit)
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
        browser.close()
    print("16 envelope layouts and 32 modal canvas layouts passed")
