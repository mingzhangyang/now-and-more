"""Exercise the actual SW under Chromium with Cloudflare-like HTML redirects."""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

WORKER = (Path(__file__).resolve().parents[1] / 'sw.js').read_bytes()
CACHE = 'nam-v' + WORKER.split(b'nam-v', 1)[1].split(b'"', 1)[0].decode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.server.offline:
            # Also block SW-originated fetches if browser offline emulation
            # does not propagate to the worker's networking session.
            self.close_connection = True
            return
        path = urlsplit(self.path).path
        if path == '/sw.js':
            body, content_type = WORKER, 'text/javascript'
        elif path in ['/index.html', '/library.html', '/about.html', '/privacy.html']:
            self.send_response(302)
            self.send_header('Location', '/' if path == '/index.html' else path[:-5])
            self.end_headers()
            return
        elif path in ['/', '/library', '/about', '/privacy']:
            body = f'<!doctype html><title>{path}</title><main>{path}</main>'.encode()
            content_type = 'text/html'
        else:
            # Stub only non-page precache assets. Browser navigation, SW
            # lifecycle, redirected Responses and Cache Storage are real.
            body, content_type = b'fixture asset', 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.offline = False
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            executable = os.environ.get('NAM_CHROMIUM_EXECUTABLE')
            browser = p.chromium.launch(executable_path=executable)
            context = browser.new_context()
            page = context.new_page()
            try:
                page.goto(origin)
                page.evaluate('navigator.serviceWorker.register("/sw.js")')
                page.wait_for_function('!!navigator.serviceWorker.controller')
                assert page.evaluate('''async name => {
                    const response = await (await caches.open(name)).match('/library.html');
                    return response.redirected;
                }''', CACHE), 'fixture must cache an actually followed redirect'

                def navigate(dest, expected):
                    response = page.goto(origin + dest)
                    assert response.status == 200, (dest, response.status)
                    assert response.from_service_worker, dest
                    assert page.locator('main').inner_text() == expected, dest

                routes = [('/', '/'), ('/index', '/'), ('/index.html', '/')]
                routes += [(f'/{name}{suffix}?note=1', f'/{name}')
                           for name in ['library', 'about', 'privacy']
                           for suffix in ['', '.html']]
                for offline in [False, True]:
                    server.offline = offline
                    context.set_offline(offline)
                    for dest, expected in routes:
                        navigate(dest, expected)

                page.evaluate('''async name => {
                    const cache = await caches.open(name);
                    await cache.put('/old', await cache.match('/library.html'));
                    await cache.delete('/about.html');
                    const newer = await caches.open('nam-v' + (Number(name.slice(5)) + 1));
                    await newer.put('/missing', new Response('wrong version'));
                }''', CACHE)
                for dest, expected in [('/old', '/library'), ('/missing', '/'), ('/about', '/')]:
                    navigate(dest, expected)
                print('21 controlled Chromium navigations passed (online/offline and fallbacks)')
            finally:
                context.close()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
