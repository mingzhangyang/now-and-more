// now-and-more-gossip — lightweight entertainment-headline relay for "Now, and More / 此时，还有".
//
// The main site is a pure static page on Cloudflare Pages. Entertainment
// headlines are real-time, so they cannot ship with the static build; this
// separate Worker aggregates direct publisher entertainment RSS feeds
// (plus the Weibo hot-search board for zh),
// caches the parsed headlines for 10 minutes (Workers Cache API), and serves
// ONE randomly chosen recent headline as JSON. It stores nothing and only
// relays headline + source + link from public RSS.
//
// Endpoints:
//   GET /gossip?lang=zh|en   -> {"title","source","link","publishedAt","lang"}
//   GET /health              -> {"ok": true}
//   (no headlines available) -> 503 {"error":"no_headlines"}

const CACHE_TTL_SECONDS = 600; // 10 minutes
const MAX_HEADLINES = 50;
const MAX_AGE_MS = 72 * 60 * 60 * 1000; // drop items older than 72 hours

const TOPIC_ID =
  "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB";

// Google News RSS is deliberately NOT used: from Cloudflare Workers egress
// it times out or returns 503 (verified 2026-11-23 via /debug). Sources are
// direct publisher feeds plus the Weibo hot-search board (HTML, zh only).
const RSS_SOURCES = {
  zh: [
    "https://feeds.feedburner.com/ettoday/star",
    "https://news.mingpao.com/rss/ins/all.xml",
    "https://www.chinanews.com.cn/rss/scroll-news.xml",
  ],
  en: [
    "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed/",
    "https://deadline.com/feed/",
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? unescapeXml(m[1]) : "";
}

export function parseFeed(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    let title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDateRaw = extractTag(block, "pubDate");
    let source = extractTag(block, "source");
    if (!title || !link) continue;

    // Google News appends " - Source" to titles; prefer the <source> tag,
    // fall back to the title suffix, and strip the suffix either way.
    const suffixMatch = title.match(/^(.*)\s+-\s+([^-]+)$/);
    if (suffixMatch) {
      if (!source) source = suffixMatch[2].trim();
      if (source && suffixMatch[2].trim() === source) {
        title = suffixMatch[1].trim();
      }
    }
    if (!source) source = "Google News";

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

export function mergeHeadlines(feedTexts) {
  const byLink = new Map();
  for (const text of feedTexts) {
    for (const item of parseFeed(text)) {
      if (!byLink.has(item.link)) byLink.set(item.link, item);
    }
  }
  const now = Date.now();
  const merged = [...byLink.values()]
    .filter((it) => it._ts === 0 || now - it._ts <= MAX_AGE_MS)
    .sort((a, b) => b._ts - a._ts)
    .slice(0, MAX_HEADLINES)
    .map(({ _ts, ...rest }) => rest);
  return merged;
}

// ---------- caching (Workers Cache API, per language) ----------

function cacheKeyFor(lang) {
  return new Request(`https://gossip-cache.internal/headlines?lang=${lang}`);
}

async function readCache(lang) {
  try {
    const hit = await caches.default.match(cacheKeyFor(lang));
    if (!hit) return null;
    const payload = await hit.json();
    if (!payload || !Array.isArray(payload.headlines)) return null;
    return payload; // { fetchedAt, headlines }
  } catch {
    return null;
  }
}

async function writeCache(lang, headlines) {
  try {
    const payload = { fetchedAt: Date.now(), headlines };
    const res = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
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
  while ((m = re.exec(html)) !== null && items.length < MAX_HEADLINES) {
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
  // Fetch all sources in parallel: one slow source must not stall the rest.
  const jobs = RSS_SOURCES[lang].map((url) =>
    fetchSource(url)
      .then((r) => (r.ok ? mergeHeadlines([r.text]) : []))
      .catch(() => [])
  );
  if (lang === "zh") jobs.push(fetchWeiboTop());
  const pools = await Promise.all(jobs);
  const byLink = new Map();
  for (const pool of pools) {
    for (const item of pool) {
      const { _ts, ...rest } = item;
      if (!byLink.has(rest.link)) byLink.set(rest.link, rest);
    }
  }
  const merged = [...byLink.values()].slice(0, MAX_HEADLINES);
  if (merged.length === 0) throw new Error("all_sources_failed");
  return merged;
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

async function getHeadlines(lang) {
  const cached = await readCache(lang);
  const fresh =
    cached && Date.now() - cached.fetchedAt < CACHE_TTL_SECONDS * 1000;
  if (fresh && cached.headlines.length > 0) return cached.headlines;
  try {
    const headlines = await fetchHeadlines(lang);
    if (headlines.length > 0) {
      await writeCache(lang, headlines);
      return headlines;
    }
    throw new Error("empty_pool");
  } catch {
    // Serve stale cache on failure, if we have any.
    if (cached && cached.headlines.length > 0) return cached.headlines;
    return null;
  }
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
      const headlines = await getHeadlines(lang);
      if (!headlines || headlines.length === 0) {
        return jsonResponse({ error: "no_headlines" }, 503);
      }
      const idx = Math.floor(Math.random() * headlines.length);
      const picked = headlines[idx];
      return jsonResponse({
        title: picked.title,
        source: picked.source,
        link: picked.link,
        publishedAt: picked.publishedAt ?? null,
        lang,
      });
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
};
