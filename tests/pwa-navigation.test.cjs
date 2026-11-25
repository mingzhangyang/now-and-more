const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

// A real followed redirect, not an object masquerading as a Response.
async function redirectedResponse() {
  const server = http.createServer((req, res) => {
    if (req.url === "/library.html") {
      res.writeHead(302, { Location: "/library" }).end();
    } else {
      res.writeHead(200, "Shell", { "Content-Type": "text/html", "X-Shell": "active" }).end("library shell");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/library.html`);
    assert.equal(response.redirected, true);
    // Buffer the body before shutting down the test server.
    await response.clone().text();
    return response;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function fixture(entries, network = async () => { throw Error("offline"); }) {
  const handlers = {}, matched = [];
  let fetches = 0;
  vm.runInNewContext(source, {
    self: { location: { origin: "https://test.invalid" }, addEventListener(name, fn) { handlers[name] = fn; } },
    URL, Response,
    caches: {
      async open(name) {
        assert.equal(name, source.match(/nam-v\d+/)[0]);
        return {
          async match(key) {
            const url = typeof key === "string" ? key : key.url;
            matched.push(url);
            return entries.get(url)?.clone();
          },
          async put() {},
        };
      },
      async match() { throw Error("navigation must not read other versions"); },
    },
    fetch(request) { fetches++; return network(request); },
  });
  return {
    matched, get fetches() { return fetches; },
    navigate(url) {
      let response;
      handlers.fetch({ request: { url: "https://test.invalid" + url, mode: "navigate", redirect: "manual", method: "GET", cache: "default" }, respondWith(promise) { response = promise; } });
      return response;
    },
  };
}

test("followed-redirect shell responses are safe for manual navigation to every page alias", async () => {
  const redirected = await redirectedResponse();
  const root = new Response("root shell");
  const f = fixture(new Map([["/", root], ...["library", "about", "privacy"].map(page => [`/${page}.html`, redirected])]));
  for (const page of ["library", "about", "privacy"]) {
    for (const suffix of ["", ".html"]) {
      const response = await f.navigate(`/${page}${suffix}?note=1`);
      assert.equal(response.redirected, false);
      assert.equal(response.status, 200);
      assert.equal(response.statusText, "Shell");
      assert.equal(response.headers.get("x-shell"), "active");
      assert.equal(response.headers.get("content-type"), "text/html");
      assert.equal(await response.text(), "library shell");
    }
  }
  for (const url of ["/", "/index", "/index.html"]) {
    assert.equal(await (await f.navigate(url)).text(), "root shell");
  }
  assert.equal(f.fetches, 0);
});

test("offline navigation normalizes exact hits and uses only the active root fallback", async () => {
  const redirected = await redirectedResponse();
  const f = fixture(new Map([["https://test.invalid/old", redirected], ["/", new Response("root shell")]]));
  const hit = await f.navigate("/old");
  assert.equal(hit.redirected, false);
  assert.equal(await hit.text(), "library shell");
  assert.equal(await (await f.navigate("/missing")).text(), "root shell");
  assert.equal(await (await f.navigate("/about")).text(), "root shell");
  assert.equal(f.fetches, 3);
  const empty = fixture(new Map());
  await assert.rejects(empty.navigate("/missing"), /offline/);
});

test("non-redirected and manual network redirect responses pass through", async () => {
  const networkRedirect = Response.redirect("https://test.invalid/elsewhere", 302);
  const f = fixture(new Map(), async () => networkRedirect);
  assert.equal(await f.navigate("/elsewhere.html"), networkRedirect);
  const plain = new Response("plain");
  const online = fixture(new Map(), async () => plain);
  assert.equal(await online.navigate("/new"), plain);
});
