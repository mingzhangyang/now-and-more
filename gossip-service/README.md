# now-and-more-gossip · 八卦后端

A tiny standalone Cloudflare Worker that feeds real-time entertainment
headlines to **Now, and More / 此时，还有**. / 为《此时，还有》提供实时娱乐
八卦标题的独立轻量 Cloudflare Worker。

## Why separate? / 为什么独立？

The main site is a pure static page (Cloudflare Pages): everything in it is
computed or drawn locally in the browser. Entertainment headlines are
**real-time** — they cannot be baked into a static build. So they live here,
in this one-file Worker, deployed and scaled independently. The static site
only calls this service if its URL is configured; until then the site's
gossip pool stays off and nothing breaks.

主站是纯静态页面（Cloudflare Pages），内容都在浏览器本地计算或抽取。唯独
娱乐八卦有**实时性**，没法打包进静态构建，所以单独放在这个单文件 Worker
里，独立部署、独立扩缩。主站只有在配置了本服务的地址后才会调用它；没配置
之前，站内的八卦池保持关闭，页面不受任何影响。

## What it does / 它做什么

- Aggregates public **Google News entertainment RSS** feeds (per language:
  the entertainment topic feed + an entertainment search feed).
- Parses RSS with plain string/regex extraction (no dependencies, no build
  step), dedupes by link, drops items older than 72 hours, keeps at most
  50 headlines, newest first.
- Caches the parsed pool per language in the **Workers Cache API for
  10 minutes**. On upstream failure it serves the stale cache if present.
- Serves **one randomly chosen** headline per request.
- Stores nothing: no database, no logs of headlines, no user data. It only
  relays headline + source name + original link from public RSS.

聚合公开的 **Google News 娱乐 RSS**（每种语言两个源：娱乐主题源 + 娱乐搜索
源）；用字符串/正则解析 RSS（零依赖、免构建），按链接去重，丢弃 72 小时
以前的条目，最多保留 50 条、最新在前；解析结果按语言在 **Workers Cache
API 中缓存 10 分钟**，上游失败时有旧缓存就先顶着。每次请求**随机返回一条**。
本服务不存任何东西：没有数据库、不留存标题、不碰用户数据，只转发公开 RSS
里的标题、出处和原文链接。

## Endpoints / 接口

```
GET /health
→ 200 {"ok": true}

GET /gossip?lang=zh        (default / 默认中文)
GET /gossip?lang=en
→ 200 {
    "title": "…",
    "source": "…",
    "link": "https://news.google.com/…",
    "publishedAt": "2026-11-23T19:02:02.000Z",   // or null
    "lang": "zh"
  }
→ 503 {"error": "no_headlines"}   // no headlines available / 暂时无可用标题
```

All responses carry `Access-Control-Allow-Origin: *` and
`Content-Type: application/json; charset=utf-8`; `OPTIONS` preflight is
handled. / 所有响应都带 CORS 头和 JSON Content-Type，并处理 OPTIONS 预检。

## Deploy / 部署

Option A — Wrangler CLI / 命令行：

```bash
cd gossip-service/
npx wrangler deploy
```

Option B — Cloudflare dashboard / 后台：Workers & Pages → Create Worker →
name it `now-and-more-gossip`, paste `worker.js`, Deploy. (`wrangler.toml`
already sets `name = "now-and-more-gossip"`, `main = "worker.js"`,
`workers_dev = true`.)

后台路径：Workers & Pages → Create Worker → 命名 `now-and-more-gossip`，
粘贴 `worker.js` 内容后部署即可。

After deploying you get a URL like / 部署后会得到类似地址：

```
https://now-and-more-gossip.<your-subdomain>.workers.dev
```

Sanity check / 验证：

```bash
curl https://now-and-more-gossip.<your-subdomain>.workers.dev/health
curl "https://now-and-more-gossip.<your-subdomain>.workers.dev/gossip?lang=zh"
```

## Plug into the frontend / 接入主站

In the main site's config, set `gossipApi` to the deployed base URL / 在主站
配置里把 `gossipApi` 设为部署后的基础地址：

```js
gossipApi: "https://now-and-more-gossip.<your-subdomain>.workers.dev"
```

The site will then call `GET {gossipApi}/gossip?lang=<current language>`
when the gossip pool is drawn. Leave `gossipApi` empty/unset to keep the
gossip pool off. / 设置后，抽到八卦池时主站会请求该接口；留空则八卦池关闭。

## Files / 文件

| File | Purpose |
|---|---|
| `worker.js` | The whole service (plain ES module Worker, no dependencies) / 全部服务代码 |
| `wrangler.toml` | Worker name / entry / compatibility date / 部署配置 |
| `README.md` | This file / 本文件 |
