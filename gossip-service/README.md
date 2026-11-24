# now-and-more-gossip · 新闻后端

Cloudflare Worker for **Now, and More / 此时，还有**. The static Pages site and the Worker deploy independently. The Worker aggregates public publisher RSS/Atom feeds and the Chinese Weibo hot-search board; it stores no visitor identity or reading history.

## D2 list protocol / 列表协议

```
GET /health
→ 200 {"ok":true}

GET /gossip?lang=zh&v=2
GET /gossip?lang=en&v=2
→ 200 {
  "lang": "zh",
  "fetchedAt": 1795514400000,
  "items": [
    {
      "id": "u:0123456789abcdef",
      "title": "Headline",
      "source": "Publisher",
      "link": "https://example.com/article",
      "publishedAt": "2026-11-24T10:00:00.000Z",
      "aliases": ["t:0123456789abcdef"]
    }
  ]
}
→ 503 {"error":"no_headlines"}
```

The response is always a list envelope; the legacy single-headline response is intentionally removed. The client uses `v=2` to separate old cached URLs. Both runtimes share `news-id.js`. Identity uses normalized HTTP(S) URL (remove tracking keys and fragments; retain meaningful query parameters), and a conservative normalized exact title for sufficiently informative titles. Aliases connect duplicate publisher links and titles, including transitive groups; no semantic or fuzzy similarity inference. Up to 50 distinct items are retained with round-robin source diversity. Dated items older than 72 hours are rejected.

Worker cache is fresh for ten minutes; if upstream fails, a valid cached list may be served for up to six hours from its original `fetchedAt`. Browser requests coalesce per language and endpoint. The Worker caches settled lists (does not share pending I/O between request contexts), and failed upstream refreshes have a one-minute retry delay per isolate. The client rejects invalid/expired responses, keeps languages separate, and never blocks ordinary card draws on the network. History is saved only after rendering in the existing `nam-decks-v1` transaction, per language, at most 500 entries over 72 hours. Unseen headlines are preferred; after exhaustion, the least recently shown eligible headline returns only after 30 minutes. No eligible headline means no gossip category. This includes singleton and temporarily absent headlines.

## Deploy / 部署

```bash
cd gossip-service/
npx wrangler deploy
```

Use the Worker production deployment from main and keep non-production Worker preview builds disabled. Pages previews may remain enabled. The configured Worker name on the dashboard may differ from the example `wrangler.toml`; preserve the existing deployment settings. Do not add a preview block just for this feature.

During the independent Pages/Worker rollout, an old single-headline response is ignored by the D2 client, leaving other cards functional. Verify after both production deployments:

```bash
curl https://now-and-more.orangely.workers.dev/health
curl 'https://now-and-more.orangely.workers.dev/gossip?lang=zh&v=2'
curl 'https://now-and-more.orangely.workers.dev/gossip?lang=en&v=2'
```

Check list shape, unique identities, valid HTTP(S) links, and per-language counts. GET /debug still reports per-source status and item counts. All JSON responses retain CORS.

Front-end config accepts a full /gossip URL or a Worker origin:
```js
window.NOW_AND_MORE_CONFIG = { gossipApi: "https://now-and-more.orangely.workers.dev/gossip" };
```
Use an empty string to disable the news category.

## Tests

From the repository root: `node --test tests/*.test.cjs` (Node 22+, no dependencies). Tests use synthetic RSS/Atom and controlled cache/network adapters; they do not fetch real publishers.
