/* Shared news identity, used by the static page and the Worker.
   No dependencies or network I/O. */
"use strict";
globalThis.NAM_NEWS_ID = (() => {
  const MAX_AGE_MS = 72 * 60 * 60 * 1000;
  const MAX_STALE_MS = 6 * 60 * 60 * 1000;
  const MAX_ITEMS = 50;
  const TRACKERS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid"]);

  function canonicalUrl(link) {
    if (typeof link !== "string" || link.length > 2048) return "";
    try {
      const u = new URL(link);
      if (!["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) return "";
      u.hash = "";
      for (const key of [...u.searchParams.keys()]) {
        const lower = key.toLowerCase();
        if (lower.startsWith("utm_") || TRACKERS.has(lower)) u.searchParams.delete(key);
      }
      u.searchParams.sort();
      return u.href;
    } catch { return ""; }
  }

  // Two compact deterministic 32-bit hashes; no BigInt or async crypto
  // on the Worker hot path. Not security tokens, only content fingerprints.
  function fingerprint(prefix, value) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x85ebca6b);
      b ^= b >>> 13;
    }
    return prefix + ":" + (a >>> 0).toString(16).padStart(8, "0") +
      (b >>> 0).toString(16).padStart(8, "0");
  }

  function titleKey(title) {
    if (typeof title !== "string" || title.length > 512) return "";
    const s = title.normalize("NFKC").toLowerCase()
      .replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"')
      .replace(/[‐‑‒–—]/gu, "-")
      .replace(/\s+/gu, " ").replace(/\s*([,:;!?-])\s*/gu, "$1")
      .replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, "$1").trim();
    // Short generic titles are ambiguous across publishers.
    if (Array.from(s.replace(/[\s\p{P}\p{S}]/gu, "")).length < 8 &&
        (s.match(/\p{Script=Han}/gu) || []).length < 5) return "";
    return fingerprint("t", s);
  }

  function cleanKeys(keys) {
    return [...new Set((Array.isArray(keys) ? keys : []).filter(k =>
      typeof k === "string" && /^[ut]:[0-9a-f]{16}$/.test(k)
    ))].slice(0, 12);
  }

  function keysFor(item) {
    const url = canonicalUrl(item && item.link);
    if (!url) return [];
    return cleanKeys([fingerprint("u", url), titleKey(item.title),
      ...(Array.isArray(item.aliases) ? item.aliases : [])]);
  }

  function normalize(item, now = Date.now()) {
    if (!item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 512) return null;
    const keys = keysFor(item);
    if (!keys.length) return null;
    const time = typeof item.publishedAt === "string" ? Date.parse(item.publishedAt) : NaN;
    if (Number.isFinite(time) && now - time > MAX_AGE_MS) return null;
    return {
      id: keys[0], title: item.title.trim(),
      source: typeof item.source === "string" ? item.source.slice(0, 256) : "",
      link: item.link.trim(), publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
      aliases: keys.slice(1),
    };
  }

  // First representative wins (caller sets recency/source order).
  // Merge alias groups transitively before capping the result.
  function dedupe(items, now = Date.now(), limit = MAX_ITEMS) {
    const groups = [];
    const owners = new Map();
    for (const raw of items) {
      const item = normalize(raw, now);
      if (!item) continue;
      const keys = keysFor(item);
      const matches = [...new Set(keys.map(key => owners.get(key)).filter(Boolean))]
        .sort((a, b) => a.order - b.order);
      const group = matches[0] || { item, order: groups.length, keys: new Set(), removed: false };
      if (!matches.length) groups.push(group);
      for (const other of matches.slice(1)) {
        for (const key of other.keys) group.keys.add(key);
        other.removed = true;
      }
      for (const key of keys) group.keys.add(key);
      for (const key of group.keys) owners.set(key, group);
    }
    return groups.filter(g => !g.removed).slice(0, limit).map(g => ({
      ...g.item, aliases: cleanKeys([...g.keys].filter(k => k !== g.item.id)).slice(0, 11),
    }));
  }

  return { MAX_AGE_MS, MAX_STALE_MS, MAX_ITEMS, canonicalUrl, titleKey, cleanKeys, keysFor, normalize, dedupe };
})();
