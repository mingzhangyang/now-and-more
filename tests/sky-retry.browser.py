"""Focused real-Chromium regression for the production retry handlers."""
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MODULE = "/vendor/sky-engine/0.2.0/sky-engine.mjs"
ADAPTER = (ROOT / "js/sky-engine-adapter.js").read_text()
APP = (ROOT / "js/app.js").read_text()
SW = (ROOT / "sw.js").read_text()
CACHE_NAME = re.search(r'var CACHE_NAME = "(nam-v\d+)";', SW).group(1)
SDK = "export function starCatalogLoaded(){return true;} export async function createSkyScene(){return {ok:true};}"


def section(start, end):
    return APP[APP.index(start):APP.index(end, APP.index(start))]


HTML = """<!doctype html><meta charset=utf-8>
<button id=draw-btn>Draw</button><section id=card tabindex=0 role=button>
<div id=card-body></div><div id=card-foot><button>Read</button></div></section>
<script src="/js/sky-engine-adapter.js"></script><script>
const $ = id => document.getElementById(id);
const t = () => ({sky:{retry:"Try again",reload:"Reload page"}});
const esc = s => s;
let currentSelection = {observer:{lat:39,lon:-77,tz:"UTC",when:new Date()}};
window.draws = 0;
window.fixtureToken = Math.random();
function drawCard(){window.draws++;}
function updateSkyCopy(sel){
  $("card-body").innerHTML = sel.skyError ? skyRetryButtonHtml() : "Ready";
  bindSkyRetry(sel);
}
function scheduleSkyVisual(sel){
  sel.ready.then(scene => {sel.scene=scene;sel.skyError=null;updateSkyCopy(sel);},
    err => {sel.skyError=err;updateSkyCopy(sel);});
}
window.begin = () => {
  currentSelection.ready = NAM_SKY.sceneFor(currentSelection.observer);
  scheduleSkyVisual(currentSelection);
};
""" + section("function skyRetryButtonHtml(", "function skyMoonFactsHtml(") + section(
    "function bindSkyRetry(", "function updateSkyCopy("
) + section('$("draw-btn").addEventListener("click", drawCard);',
            'document.addEventListener("keydown",') + "</script>"


class Server(BaseHTTPRequestHandler):
    fail = False
    requests = []

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == MODULE:
            Server.requests.append(url.query)
            self.send_body(503 if Server.fail else 200,
                           "unavailable" if Server.fail else SDK, "text/javascript")
        elif url.path == "/fixture":
            self.send_body(200, HTML, "text/html")
        elif url.path == "/js/sky-engine-adapter.js":
            self.send_body(200, ADAPTER, "text/javascript")
        elif url.path == "/sw.js":
            self.send_body(200, SW, "text/javascript")
        else:
            # Unrelated app-shell assets are inert fixtures for SW precaching.
            self.send_body(200, "", "text/plain")

    def send_body(self, status, body, content_type):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


def retry_case(browser, origin, keyboard):
    with browser.new_context(service_workers="block") as ctx:
        page = ctx.new_page()
        Server.requests.clear()
        Server.fail = True
        page.goto(origin + "/fixture")
        token = page.evaluate("fixtureToken")
        page.evaluate("begin()")
        retry = page.locator("#card-body").get_by_role("button", name="Try again")
        retry.wait_for()
        assert Server.requests == [""], Server.requests
        Server.fail = False
        if keyboard:
            retry.focus()
            page.keyboard.press("Enter")
        else:
            retry.click()
        page.wait_for_function("currentSelection.scene?.ok")
        assert Server.requests == ["", "retry=1"], Server.requests
        assert page.evaluate("draws") == 0
        assert page.evaluate("fixtureToken") == token
        page.evaluate("currentSelection.scene = null; NAM_SKY.reset(); begin()")
        page.wait_for_function("currentSelection.scene?.ok")
        assert Server.requests == ["", "retry=1"], Server.requests
        page.locator("#card").focus()
        page.keyboard.press("Enter")
        assert page.evaluate("draws") == 1


def bounded_case(browser, origin):
    with browser.new_context(service_workers="block") as ctx:
        page = ctx.new_page()
        Server.requests.clear()
        Server.fail = True
        page.goto(origin + "/fixture")
        page.evaluate("begin()")
        retry = page.locator("#card-body").get_by_role("button", name="Try again")
        for attempt in range(1, 4):
            retry.wait_for()
            page.evaluate("currentSelection.scene = null")
            retry.click()
            page.locator("#card-body").get_by_role("button", name="Reload page" if attempt == 3 else "Try again").wait_for()
        reload_button = page.locator("#card-body").get_by_role("button", name="Reload page")
        reload_button.wait_for()
        assert Server.requests == ["", "retry=1", "retry=2", "retry=3"], Server.requests
        token = page.evaluate("fixtureToken")
        Server.fail = False
        with page.expect_navigation():
            reload_button.click()
        assert page.evaluate("fixtureToken") != token


def offline_case(browser, origin):
    with browser.new_context() as ctx:
        page = ctx.new_page()
        Server.fail = False
        page.goto(origin + "/fixture")
        page.evaluate("navigator.serviceWorker.register('/sw.js')")
        page.wait_for_function("!!navigator.serviceWorker.controller")
        page.wait_for_function(
            "(url) => caches.match(url).then(Boolean)", arg=MODULE
        )
        Server.requests.clear()
        ctx.set_offline(True)
        assert page.evaluate("(url) => import(url).then(m => m.starCatalogLoaded())",
                             MODULE + "?retry=1")
        assert Server.requests == [], Server.requests
        ctx.set_offline(False)
        # A recovered response must also populate the canonical cache key.
        assert page.evaluate(
            "([name, url]) => caches.open(name).then(c => c.delete(url))",
            [CACHE_NAME, MODULE],
        )
        assert not page.evaluate("(url) => caches.match(url).then(Boolean)", MODULE)
        assert page.evaluate("(url) => import(url).then(m => m.starCatalogLoaded())",
                             MODULE + "?retry=2")
        page.wait_for_function("(url) => caches.match(url).then(Boolean)", arg=MODULE)
        assert not page.evaluate("(url) => caches.match(url).then(Boolean)", MODULE + "?retry=2")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), Server)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as p:
            options = {"headless": True}
            if os.getenv("CHROMIUM_PATH"):
                options["executable_path"] = os.environ["CHROMIUM_PATH"]
            browser = p.chromium.launch(**options)
            retry_case(browser, origin, keyboard=False)
            retry_case(browser, origin, keyboard=True)
            bounded_case(browser, origin)
            offline_case(browser, origin)
            browser.close()
        print("4 Chromium retry regressions passed")
    finally:
        server.shutdown()
