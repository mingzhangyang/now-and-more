"""Real-Chromium regressions for the Meanwhile globe on the production page.

1. A globe canvas whose getContext("2d") returns null must not break the
   world draw: the draw transaction completes, the city, local time and
   facts stay visible, and only the globe is hidden.
2. Changing the effective theme repaints the globe already on stage with
   the new palette and the same inputs (city, instant), without drawing a
   new card: by the theme buttons (light -> dark) and, in Auto mode, by a
   system colour-scheme change.

Set PW_CHROMIUM to a Chromium binary to run against a preinstalled browser.
"""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


NULL_GLOBE_CONTEXT = """
const original = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (...args) {
  if (this.classList && this.classList.contains("globe")) return null;
  return original.apply(this, args);
};
"""

# Draw a world card through the real draw transaction, with timed draws paused.
DRAW_WORLD = """async () => {
  drawsReady = false;
  let error = null, sel = null;
  try {
    // Same shape as the app's own draws: shared lock, then the transaction.
    sel = await deckState.withLock(() => deckState.transact(() => {
      const s = makeSelection("world");
      renderSelection(s);
      return s;
    }));
    currentSelection = sel;
  } catch (e) { error = String(e); }
  const body = document.getElementById("card-body");
  const big = body.querySelector(".big");
  const facts = body.querySelector(".fact-row");
  const globe = body.querySelector("canvas.globe");
  return {
    error,
    city: sel && sel.city.en,
    big: big && big.textContent,
    meta: document.getElementById("card-meta").textContent,
    factsShown: !!facts && facts.getBoundingClientRect().height > 0 && facts.textContent.length > 0,
    globeHidden: !!globe && globe.hidden,
  };
}"""

SPY = """() => {
  window.__globeCalls = [];
  const draw = NAM_GLOBE.draw;
  NAM_GLOBE.draw = (ctx, cx, cy, r, o) => {
    window.__globeCalls.push({ dark: o.dark, lat: o.lat, lon: o.lon, sunLat: o.sun.lat, sunLon: o.sun.lon });
    return draw(ctx, cx, cy, r, o);
  };
}"""

# A stable fingerprint of the painted globe plus the draw state.
SNAPSHOT = """() => {
  const cv = document.querySelector("#card-body canvas.globe");
  const px = cv.getContext("2d").getImageData(Math.round(cv.width * 0.2), Math.round(cv.height * 0.5), 1, 1).data;
  return {
    calls: window.__globeCalls.slice(),
    pixel: Array.from(px),
    deck: JSON.stringify(deckState.state),
    encounter,
    sameSelection: window.__sel === currentSelection,
    when: cv.dataset.when,
  };
}"""


def open_page(browser, init=None, scheme="light", theme=None):
    context = browser.new_context(viewport={"width": 390, "height": 844},
                                  color_scheme=scheme, service_workers="block")
    script = "localStorage.setItem('nam-lang', 'en');"
    if theme:
        script += f"localStorage.setItem('nam-theme', '{theme}');"
    context.add_init_script(script + (init or ""))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/index.html")
    page.wait_for_function("typeof deckState !== 'undefined' && typeof NAM_GLOBE !== 'undefined'")
    return context, page, errors


def null_context_keeps_card(browser):
    context, page, errors = open_page(browser, init=NULL_GLOBE_CONTEXT)
    try:
        r = page.evaluate(DRAW_WORLD)
        assert r["error"] is None, r
        assert r["big"] == r["city"], r
        assert r["meta"].startswith(r["city"]), r
        assert r["factsShown"], r
        assert r["globeHidden"], r
        assert not errors, errors
    finally:
        context.close()


def theme_buttons_repaint(browser):
    context, page, errors = open_page(browser, theme="light")
    try:
        page.evaluate(SPY)
        r = page.evaluate(DRAW_WORLD)
        assert r["error"] is None and not r["globeHidden"], r
        page.evaluate("() => { window.__sel = currentSelection; }")
        before = page.evaluate(SNAPSHOT)
        assert before["calls"] and before["calls"][-1]["dark"] is False, before
        page.evaluate("() => setTheme('dark')")
        after = page.evaluate(SNAPSHOT)
        assert len(after["calls"]) == len(before["calls"]) + 1, (before["calls"], after["calls"])
        old, new = before["calls"][-1], after["calls"][-1]
        assert new["dark"] is True, new
        assert (new["lat"], new["lon"], new["sunLat"], new["sunLon"]) == \
            (old["lat"], old["lon"], old["sunLat"], old["sunLon"]), (old, new)
        assert after["pixel"] != before["pixel"], (before["pixel"], after["pixel"])
        assert after["deck"] == before["deck"] and after["encounter"] == before["encounter"]
        assert after["sameSelection"] and after["when"] == before["when"]
        assert not errors, errors
    finally:
        context.close()


def auto_follows_system_scheme(browser):
    context, page, errors = open_page(browser, scheme="light", theme="auto")
    try:
        page.evaluate(SPY)
        page.evaluate(DRAW_WORLD)
        page.evaluate("() => { window.__sel = currentSelection; }")
        before = page.evaluate(SNAPSHOT)
        assert before["calls"][-1]["dark"] is False, before
        page.emulate_media(color_scheme="dark")
        page.wait_for_function("window.__globeCalls.length > %d" % len(before["calls"]))
        after = page.evaluate(SNAPSHOT)
        assert after["calls"][-1]["dark"] is True, after
        assert after["deck"] == before["deck"] and after["sameSelection"]
        assert not errors, errors
    finally:
        context.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    BASE = f"http://127.0.0.1:{server.server_port}"
    with sync_playwright() as p:
        exe = os.environ.get("PW_CHROMIUM")
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        try:
            null_context_keeps_card(browser)
            theme_buttons_repaint(browser)
            auto_follows_system_scheme(browser)
        finally:
            browser.close()
            server.shutdown()
    print("globe browser regressions: 3 passed")
