// now-and-more-gossip — lightweight entertainment-headline relay for "Now, and More / 此时，还有".
//
// The main site is a pure static page on Cloudflare Pages. Entertainment
// headlines are real-time, so they cannot ship with the static build; this
// separate Worker aggregates direct publisher entertainment RSS feeds
// (plus the Weibo hot-search board for zh),
// caches the deduplicated news pool for 10 minutes (Workers Cache API),
// and serves a list of recent headlines. No personal data or history is
// stored by the Worker; the browser owns display history.
//
// GET /gossip?lang=zh|en -> {lang, fetchedAt, items:[...]}
// GET /health           -> {"ok":true}
// Empty/unavailable pool -> 503 {"error":"no_headlines"}

import "./news-id.js";
const NEWS_ID = globalThis.NAM_NEWS_ID;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_HEADLINES = NEWS_ID.MAX_ITEMS;

// Google News RSS is deliberately NOT used: from Cloudflare Workers egress
// it times out or returns 503 (verified 2026-11-23 via /debug). Sources are
// direct publisher feeds plus the Weibo hot-search board (HTML, zh only).
const RSS_SOURCES = {
  zh: [
    "https://feeds.feedburner.com/ettoday/star",
    "https://feeds.feedburner.com/ettoday/realtime",
    "https://www.chinanews.com.cn/rss/scroll-news.xml",
  ],
  en: [
    "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed/",
    "https://deadline.com/feed/",
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://feeds.bbci.co.uk/sport/rss.xml",
    "https://feeds.bbci.co.uk/news/technology/rss.xml",
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
  ],
};

const WEIBO_TOP_URL = "https://s.weibo.com/top/summary";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

// ---------- RSS parsing (string/regex only, no XML library) ----------

function safeCodePoint(entity, n) {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
}

function unescapeXml(text) {
  if (!text) return "";
  let out = text;
  const cdata = out.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) out = cdata[1];
  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => safeCodePoint(m, Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => safeCodePoint(m, parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? unescapeXml(m[1]) : "";
}

export function parseFeed(xml) {
  const items = [];
  // Atom feeds (e.g. The Verge) use <entry> instead of <item>.
  if (!/<item(?:\s[^>]*)?>/.test(xml) && /<entry(?:\s[^>]*)?>/.test(xml)) {
    const head = xml.slice(0, xml.indexOf("<entry"));
    const feedTitle = extractTag(head, "title");
    const entryBlocks = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g) || [];
    for (const block of entryBlocks) {
      const title = extractTag(block, "title");
      const linkMatch =
        block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) ||
        block.match(/<link[^>]*href="([^"]+)"/);
      const link = linkMatch ? unescapeXml(linkMatch[1]) : "";
      const dateRaw = extractTag(block, "published") || extractTag(block, "updated");
      if (!title || !link) continue;
      const parsed = dateRaw ? Date.parse(dateRaw) : NaN;
      items.push({
        title,
        source: feedTitle || "Atom",
        link,
        publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
        _ts: Number.isNaN(parsed) ? 0 : parsed,
      });
    }
    return items;
  }
  const firstItem = xml.search(/<item(?:\s[^>]*)?>/);
  const feedTitle = firstItem >= 0 ? extractTag(xml.slice(0, firstItem), "title") : "";
  const itemBlocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    let title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDateRaw = extractTag(block, "pubDate");
    let source = extractTag(block, "source");
    if (!title || !link) continue;

    // Strip a publisher suffix only when the source is independently known.
    // A hyphen can be meaningful in an ordinary publisher's headline.
    source = source || feedTitle;
    const suffixMatch = title.match(/^(.*)\s+-\s+([^-]+)$/);
    if (suffixMatch && source && suffixMatch[2].trim() === source) {
      title = suffixMatch[1].trim();
    }
    if (!source) {
      try { source = new URL(link).hostname; }
      catch { source = "RSS"; }
    }

    const parsed = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    items.push({
      title,
      source,
      link,
      publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
      _ts: Number.isNaN(parsed) ? 0 : parsed,
    });
  }
  return items;
}

export function mergeHeadlines(feedTexts, now = Date.now()) {
  const items = feedTexts.flatMap(parseFeed).sort((a, b) => b._ts - a._ts);
  return NEWS_ID.dedupe(items, now, MAX_HEADLINES);
}

// ---------- caching (Workers Cache API, per language) ----------
// Store for the stale-fallback window, but revalidate after ten minutes.
// v2 avoids mixing legacy single-link cache identities with the list protocol.
function cacheKeyFor(lang) {
  return new Request(`https://gossip-cache.internal/headlines?v=2&lang=${lang}`);
}

async function readCache(lang) {
  try {
    const hit = await caches.default.match(cacheKeyFor(lang));
    if (!hit) return null;
    const payload = await hit.json();
    const now = Date.now();
    if (!payload || !Array.isArray(payload.headlines) ||
        !Number.isFinite(payload.fetchedAt) || payload.fetchedAt > now ||
        now - payload.fetchedAt > NEWS_ID.MAX_STALE_MS) return null;
    const headlines = NEWS_ID.dedupe(payload.headlines, now);
    return headlines.length ? { fetchedAt: payload.fetchedAt, headlines } : null;
  } catch {
    return null;
  }
}

async function writeCache(lang, payload) {
  try {
    const ttl = Math.max(1, Math.ceil((NEWS_ID.MAX_STALE_MS - (Date.now() - payload.fetchedAt)) / 1000));
    const res = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${ttl}`,
      },
    });
    await caches.default.put(cacheKeyFor(lang), res);
  } catch {
    // Cache write failures must not break the response path.
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SOURCE_TIMEOUT_MS = 12000;

async function fetchSource(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: ctl.signal,
    });
    const text = await res.text();
    return { url, status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

// Parse the Weibo hot-search board (server-rendered HTML table).
// Each ranked row links the word to /weibo?q=... followed by a heat number.
// Tolerant by design: if the markup shifts, this returns [] and /debug shows it.
export function parseWeiboTop(html) {
  const items = [];
  const re = /<a[^>]+href="\/weibo\?q=[^"]*"[^>]*>([^<]+)<\/a>\s*<span>([\d,]+)<\/span>/g;
  let m;
  let rank = 0;
  while ((m = re.exec(html)) !== null) {
    const word = unescapeXml(m[1]);
    const heat = m[2].replace(/,/g, "");
    if (!word) continue;
    rank += 1;
    items.push({
      title: word,
      source: `微博热搜第${rank}名 · 热度 ${heat}`,
      link: `https://s.weibo.com/weibo?q=${encodeURIComponent("#" + word + "#")}`,
      publishedAt: new Date().toISOString(),
      _ts: Date.now(),
    });
  }
  return items;
}

async function fetchWeiboTop() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(WEIBO_TOP_URL, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://s.weibo.com/",
      },
      signal: ctl.signal,
    });
    if (!res.ok) return [];
    return parseWeiboTop(await res.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHeadlines(lang) {
  // Fetch all sources in parallel. Keep raw rows (including late alias
  // bridges) until the single global grouping and output cap in mergePools.
  const jobs = RSS_SOURCES[lang].map((url) =>
    fetchSource(url)
      .then((r) => (r.ok ? parseFeed(r.text).sort((a, b) => b._ts - a._ts) : []))
      .catch(() => [])
  );
  if (lang === "zh") jobs.push(fetchWeiboTop());
  const pools = await Promise.all(jobs);
  const merged = mergePools(pools);
  if (merged.length === 0) throw new Error("all_sources_failed");
  return merged;
}

export function mergePools(pools, now = Date.now()) {
  // Round robin preserves source diversity. Collect all rows before the
  // limit so duplicate groups can acquire aliases even after the first 50.
  const rows = [];
  const maxLen = Math.max(0, ...pools.map(pool => pool.length));
  for (let i = 0; i < maxLen; i++) {
    for (const pool of pools) {
      if (pool[i]) rows.push(pool[i]);
    }
  }
  return NEWS_ID.dedupe(rows, now, MAX_HEADLINES);
}

// Diagnostic for /debug: per-source HTTP status and parsed item counts.
// Relays no content beyond counts and lengths; safe to leave enabled.
async function debugSources(lang) {
  const rss = await Promise.all(
    RSS_SOURCES[lang].map(async (url) => {
      try {
        const r = await fetchSource(url);
        return {
          url,
          status: r.status,
          bytes: r.text.length,
          looksLikeRss: r.text.includes("<item"),
          items: r.ok ? parseFeed(r.text).length : 0,
        };
      } catch (e) {
        return { url, status: 0, error: String(e && e.name ? e.name : e) };
      }
    })
  );
  if (lang === "zh") {
    try {
      const items = await fetchWeiboTop();
      rss.unshift({ url: WEIBO_TOP_URL, type: "weibo-html", items: items.length });
    } catch (e) {
      rss.unshift({ url: WEIBO_TOP_URL, type: "weibo-html", status: 0, error: String(e) });
    }
  }
  return rss;
}

// Cache settled data only. Avoid sharing a pending I/O promise between
// independent Worker request contexts. Browser-side requests coalesce.
const retryAt = new Map();
async function getHeadlines(lang) {
  const cached = await readCache(lang);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (now < (retryAt.get(lang) || 0)) return cached;
  try {
    const headlines = await fetchHeadlines(lang);
    const payload = { fetchedAt: Date.now(), headlines };
    await writeCache(lang, payload);
    retryAt.delete(lang);
    return payload;
  } catch {
    retryAt.set(lang, Date.now() + RETRY_MS);
    return cached;
  }
}

// ---------- static site assets (PNGs served from base64; see assets.js) ----------

import { OG_IMAGE_B64, FAVICON192_B64, APPLE_ICON_B64, ICON512_B64 } from "./assets.js";

const ASSET_ROUTES = {
  "/og-image.png": OG_IMAGE_B64,
  "/favicon-192.png": FAVICON192_B64,
  "/apple-touch-icon.png": APPLE_ICON_B64,
  "/icon-512.png": ICON512_B64,
};

function serveAsset(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ---------- worker entry ----------

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    if (ASSET_ROUTES[url.pathname]) {
      return serveAsset(ASSET_ROUTES[url.pathname]);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/debug") {
      const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";
      const sources = await debugSources(lang);
      const totalItems = sources.reduce((n, s) => n + (s.items || 0), 0);
      return jsonResponse({ lang, totalItems, sources });
    }

    if (url.pathname === "/gossip") {
      const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";
      const payload = await getHeadlines(lang);
      const items = payload && Date.now() - payload.fetchedAt <= NEWS_ID.MAX_STALE_MS
        ? NEWS_ID.dedupe(payload.headlines, Date.now()) : [];
      if (!items.length) return jsonResponse({ error: "no_headlines" }, 503, { "Cache-Control": "no-store" });
      return jsonResponse({ lang, fetchedAt: payload.fetchedAt, items }, 200, {
        "Cache-Control": "no-store",
      });
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
};
