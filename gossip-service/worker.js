// now-and-more-gossip — lightweight entertainment-headline relay for "Now, and More / 此时，还有".
//
// The main site is a pure static page on Cloudflare Pages. Entertainment
// headlines are real-time, so they cannot ship with the static build; this
// separate Worker aggregates public Google News entertainment RSS feeds,
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

const SOURCES = {
  zh: [
    `https://news.google.com/rss/topics/${TOPIC_ID}?hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    "https://news.google.com/rss/search?q=%E5%A8%B1%E4%B9%90&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  ],
  en: [
    `https://news.google.com/rss/topics/${TOPIC_ID}?hl=en-US&gl=US&ceid=US:en`,
    "https://news.google.com/rss/search?q=entertainment&hl=en-US&gl=US&ceid=US:en",
  ],
};

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

async function fetchHeadlines(lang) {
  const texts = [];
  for (const url of SOURCES[lang]) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "now-and-more-gossip/1.0 (+https://github.com/mingzhangyang/now-and-more)" },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      if (res.ok) texts.push(await res.text());
    } catch {
      // One bad source must not sink the others.
    }
  }
  if (texts.length === 0) throw new Error("all_sources_failed");
  return mergeHeadlines(texts);
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
