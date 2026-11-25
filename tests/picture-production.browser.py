"""End-to-end PNG regression against the actual app and vendored Sky Engine."""
import base64
import os
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@contextmanager
def site():
    handler = partial(QuietHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


# Observe (do not replace) the real caption drawing calls. Pixel checks below
# also prove that text and artwork actually made it into the decoded PNG.
OBSERVE_TEXT = """() => {
  window.pictureCaptionCalls = [];
  const original = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
    const result = original.call(this, text, x, y, ...rest);
    if (this.canvas.width === 1080 && [1440, 1700].includes(this.canvas.height)) {
      window.pictureCaptionCalls.push({text: String(text), y});
    }
    return result;
  };
}"""

OPEN_PICTURE = """kind => {
  window.pictureCaptionCalls.length = 0;
  const when = new Date('2026-11-24T23:00:00Z');
  const city = {en: 'London', zh: '\\u4f26\\u6566', tz: 'Europe/London'};
  const observer = {lat: 51.5, lon: -0.12, tz: city.tz, name: city.en, when};
  const sel = kind === 'postcard'
    ? {cat: 'postcard', key: 'lichun'}
    : {cat: 'sky', form: kind, observer,
       place: {city, lat: observer.lat, lon: observer.lon, when, here: false}};
  openImageModal(sel);
}"""

INSPECT_PNG = """kind => {
  const img = document.querySelector('.modal-picture');
  const sel = imageModalSel, s = t(), K = s.sky;
  const w = img.naturalWidth, h = img.naturalHeight;
  const artH = kind === 'illustration' ? 1350 : 1080;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const offset = (x, y) => (y * w + x) * 4;
  const colors = new Map();
  let samples = 0, opaque = 0, min = 255, max = 0;
  for (let y = 0; y < artH; y += 8) for (let x = 0; x < w; x += 8) {
    const i = offset(x, y);
    const r = px[i], g = px[i+1], b = px[i+2];
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    colors.set(key, (colors.get(key) || 0) + 1);
    const light = (r + g + b) / 3;
    min = Math.min(min, light); max = Math.max(max, light);
    samples++; if (px[i+3] === 255) opaque++;
  }
  let paper = 0, panel = 0;
  for (let y = artH; y < h; y += 5) for (let x = 0; x < w; x += 5) {
    const i = offset(x, y);
    if (Math.abs(px[i]-250) <= 5 && Math.abs(px[i+1]-244) <= 5 &&
        Math.abs(px[i+2]-230) <= 5 && px[i+3] === 255) paper++;
    panel++;
  }
  const ink = (top, bottom) => {
    let count = 0;
    for (let y = top; y < Math.min(bottom, h); y++) for (let x = 45; x < w-45; x++) {
      const i = offset(x, y);
      if (px[i] < 190 && px[i+1] < 180 && px[i+2] < 170 && px[i+3] === 255) count++;
    }
    return count;
  };
  let required = [];
  if (kind === 'moon') {
    const m = sel.summary.moon;
    required = [s.world.phases[m.idx], s.world.moonTitle, s.world.moonIllum(m.illum),
                s.world.moonAge(m.age), K.approx, K.moonCredit];
  } else if (kind === 'postcard') {
    const c = POSTCARD_COPY.lichun;
    required = lang === 'zh' ? [c.titleZh, c.subZh] : [c.titleEn, c.subEn];
  } else {
    const sig = sel.summary.sig;
    required = kind === 'chart' ? [K.chartMeta, K.approx] :
      [lang === 'zh' ? sel.place.city.zh : sel.place.city.en, K.illusMeta];
    if (sig) required.push(K.lookFor(K.asterisms[sig.key].name, K.dirs[sig.dir]),
                           K.asterisms[sig.key].line);
    else required.push(K.fallback);
  }
  // The real composer can wrap text, or split the English postcard title.
  const compact = value => value.replace(/\\s+/g, '');
  const painted = compact(window.pictureCaptionCalls.map(c => c.text).join(''));
  return {
    width: w, height: h, sameUrl: img.src === modalPicture.url,
    opaque: opaque / samples, colors: colors.size, contrast: max-min,
    varied: 1-Math.max(...colors.values())/samples, paper: paper / panel,
    titleInk: ink(artH+15, artH+82), bodyInk: ink(artH+98, artH+270),
    noteInk: kind === 'chart' || kind === 'moon' ? ink(1320, 1355) : null,
    creditInk: kind === 'moon' ? ink(1356, 1391) : null,
    missing: required.filter(text => text && !painted.includes(compact(text))),
    creditDrawn: kind !== 'moon' || window.pictureCaptionCalls.some(
      c => c.text === K.moonCredit && c.y >= 1356 && c.y < 1395),
    noExternalCaption: !document.querySelector('#img-body .fact-row, #img-body .sub'),
    alt: img.alt,
  };
}"""


def check_ready_and_download(page, kind, language):
    image = page.locator('#img-card[data-sky-state="ready"] .modal-picture')
    image.wait_for(state="visible", timeout=60000)
    save = page.locator("#img-capture-btn")
    assert save.is_enabled(), (language, kind)
    result = page.evaluate(INSPECT_PNG, kind)
    where = (language, kind, result)
    assert (result["width"], result["height"]) == (1080, 1700 if kind == "illustration" else 1440), where
    assert result["sameUrl"] and result["noExternalCaption"] and result["alt"], where
    assert result["opaque"] > .99 and result["colors"] > 8, where
    assert result["contrast"] > 40 and result["varied"] > .02, where
    assert result["paper"] > .65 and result["titleInk"] > 100 and result["bodyInk"] > 100, where
    assert not result["missing"] and result["creditDrawn"], where
    if kind in ("chart", "moon"):
        assert result["noteInk"] > 100, where
    if kind == "moon":
        assert result["creditInk"] > 100, where

    # Read the displayed Blob, not a newly rendered/exported canvas.
    data_url = page.evaluate("""async () => {
      const response = await fetch(document.querySelector('.modal-picture').src);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }""")
    assert data_url.startswith("data:image/png;base64,"), where
    expected = base64.b64decode(data_url.split(",", 1)[1])
    with page.expect_download() as pending:
        save.click()
    download = pending.value
    assert download.suggested_filename.startswith(f"now-and-more-{kind}-"), where
    assert download.suggested_filename.endswith(".png"), where
    assert download.path().read_bytes() == expected, where
    page.locator("#img-close-btn").click()
    assert not page.locator("#img-overlay").is_visible() and save.is_disabled(), where


def check_locale(browser, origin, language):
    context = browser.new_context(viewport={"width": 390, "height": 844},
                                  locale="zh-CN" if language == "zh" else "en-US",
                                  timezone_id="Europe/London", accept_downloads=True,
                                  service_workers="block")
    try:
        page = context.new_page()
        page.add_init_script(script=f"localStorage.setItem('nam-lang', '{language}'); "
                                   "window.NOW_AND_MORE_CONFIG = {gossipApi: ''}; "
                                   f"({OBSERVE_TEXT})();")
        # Force the actual asset request to fail, even if the idle warm-up
        # tries it first. Release only after the real error UI appears.
        fault = {"active": True, "failed": 0, "retried": 0}

        def moon_texture(route):
            if fault["active"]:
                fault["failed"] += 1
                route.abort()
            else:
                fault["retried"] += 1
                route.continue_()

        context.route("**/vendor/sky-engine/0.2.0/moon-lroc.jpg", moon_texture)
        page.goto(origin + "/index.html", wait_until="domcontentloaded")
        page.wait_for_function("() => initialDrawDone && !drawGate.pending && encounter > 0", timeout=30000)
        assert page.locator("html").get_attribute("lang") == ("zh-CN" if language == "zh" else "en")

        page.evaluate(OPEN_PICTURE, "moon")
        page.locator('#img-card[data-sky-state="error"]').wait_for(timeout=60000)
        retry = page.locator("#img-body .sky-retry")
        assert retry.is_visible() and fault["failed"] > 0, language
        assert retry.inner_text() == page.evaluate("() => t().sky.retry"), language
        assert page.locator("#img-capture-btn").is_disabled(), language
        assert page.locator(".modal-picture").count() == 0, language
        fault["active"] = False
        retry.click()
        check_ready_and_download(page, "moon", language)
        assert fault["retried"] > 0, language

        for kind in ("chart", "postcard", "illustration"):
            page.evaluate(OPEN_PICTURE, kind)
            check_ready_and_download(page, kind, language)
    finally:
        context.close()


if __name__ == "__main__":
    with site() as origin, sync_playwright() as p:
        options = {"headless": True}
        if os.getenv("CHROMIUM_PATH"):
            options["executable_path"] = os.environ["CHROMIUM_PATH"]
        browser = p.chromium.launch(**options)
        try:
            for language in ("zh", "en"):
                check_locale(browser, origin, language)
        finally:
            browser.close()
    print("8 actual picture compositions/downloads and 2 real moon texture retries passed")
