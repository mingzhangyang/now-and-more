"""Tab-focus regression for the stage card, using the production CSS.

`.card { outline: none }` outranks the zero-specificity global focus
ring, so the card must restate a solid ring of its own. For light and
dark themes (plus every seasonal special accent) this tabs to the card
with a real keyboard press and checks that the focus outline is solid,
at least 2px wide, and contrasts at least 3:1 with the page background
(WCAG 2.2 non-text contrast)."""
import os
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "css/style.css").read_text()
INDEX = (ROOT / "index.html").read_text()


def section(source, start, end):
    i = source.index(start)
    return source[i:source.index(end, i)]


HTML = (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<body>' + section(INDEX, '<main class="stage">', '</main>') + '</main></body>'
)

MEASURE = """() => {
  const rgb = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = c => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const card = document.querySelector("#card"), s = getComputedStyle(card);
  return {
    focused: document.activeElement === card && card.matches(":focus-visible"),
    style: s.outlineStyle,
    width: parseFloat(s.outlineWidth),
    contrast: ratio(rgb(s.outlineColor), rgb(getComputedStyle(document.body).backgroundColor))
  };
}"""


def check(browser, theme, special):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        page.set_content(HTML)
        page.add_style_tag(content=CSS)
        page.evaluate("""([theme, special]) => {
          document.documentElement.dataset.theme = theme;
          if (special) document.body.dataset.special = special;
          document.querySelector("#card-body").textContent = "床前明月光";
        }""", [theme, special])
        for _ in range(12):
            page.keyboard.press("Tab")
            if page.evaluate("document.activeElement && document.activeElement.id === 'card'"):
                break
        m = page.evaluate(MEASURE)
        ok = m["focused"] and m["style"] == "solid" and m["width"] >= 2 and m["contrast"] >= 3
        assert ok, (theme, special, m)
        return m["contrast"]
    finally:
        page.close()


def check_horoscope_reader(browser):
    """Real production scripts and actual stage/reading modal, mobile viewport."""
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        page.goto(f"http://127.0.0.1:{server.server_port}/index.html",
                  wait_until="domcontentloaded")
        page.wait_for_function("typeof renderSelection === 'function' && typeof makeHoroscope === 'function'")
        for language, layer_text, change_text in (
            ("zh", "时间尺度（原始评分单位）", "较昨日的净评分变化"),
            ("en", "Time scales (raw score units)", "Compared with yesterday"),
        ):
            page.evaluate("""language => {
              if (activeModal) hideModal(activeModal);
              lang = language;
              ambientOn = false;
              currentSelection = {cat:"astro", subtype:"horoscope",
                horo:makeHoroscope(new Date(2026,10,25,12),7)};
              window.__v33Selection = currentSelection;
              renderSelection(currentSelection, stageSurface());
            }""", language)
            assert layer_text not in page.locator("#card-body").inner_text()
            page.locator("#full-text-btn").click()
            page.locator("#full-overlay").wait_for(state="visible")
            body = page.locator("#full-body").inner_text()
            assert layer_text in body and change_text in body, (language, body)
            assert "undefined" not in body and "NaN" not in body
            assert page.evaluate("currentSelection === window.__v33Selection")
            page.locator("#full-close").click()
            page.locator("#full-overlay").wait_for(state="hidden")
            assert page.evaluate("document.activeElement.id === 'full-text-btn'")
        print("horoscope V3.3 production reading modal ok")
    finally:
        page.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main():
    exe = os.environ.get("CHROMIUM_PATH")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        try:
            for theme in ("light", "dark"):
                for special in (None, "redgold", "moon", "green", "amber", "warm"):
                    c = check(browser, theme, special)
                    print(f"{theme:5} {special or '-':8} {c:.2f}:1")
            check_horoscope_reader(browser)
        finally:
            browser.close()
    print("card focus ok")


if __name__ == "__main__":
    main()
