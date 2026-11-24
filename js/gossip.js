/* Dynamic news pool and render-transaction history. */
"use strict";
const NAM_GOSSIP = (() => {
  const ID = globalThis.NAM_NEWS_ID;
  const CACHE_MS = 10 * 60 * 1000;
  const RETRY_MS = 60 * 1000;
  const COOLDOWN_MS = 30 * 60 * 1000;
  const HISTORY_LIMIT = 500;

  // News history schema is independent of the outer deck-store version.
  function history(raw, now = Date.now()) {
    let rows = [];
    if (raw && raw.v === 2 && Array.isArray(raw.entries)) {
      rows = raw.entries;
    } else if (raw && Array.isArray(raw.seen)) {
      const titles = [...new Set(raw.seen.filter(t => typeof t === "string"))];
      if (typeof raw.last === "string") {
        const at = titles.indexOf(raw.last);
        if (at >= 0) titles.splice(at, 1);
        titles.push(raw.last);
      }
      rows = titles.slice(-HISTORY_LIMIT).map(title => ({ keys: [ID.titleKey(title)], at: now }));
    }
    return {
      v: 2,
      entries: rows.filter(row => row && Number.isFinite(row.at) &&
        row.at <= now && now - row.at < ID.MAX_AGE_MS)
        .map(row => ({ keys: ID.cleanKeys(row.keys), at: row.at }))
        .filter(row => row.keys.length).sort((a, b) => a.at - b.at).slice(-HISTORY_LIMIT),
    };
  }

  function matchIndex(entries, item) {
    const keys = new Set(ID.keysFor(item));
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].keys.some(key => keys.has(key))) return i;
    }
    return -1;
  }

  function eligible(pool, raw, now = Date.now()) {
    const entries = history(raw, now).entries;
    const ranked = ID.dedupe(pool, now).map(item => ({ item, index: matchIndex(entries, item) }));
    const unseen = ranked.filter(row => row.index < 0);
    if (unseen.length) return unseen.map(row => row.item);
    // Exhausted pool: least recently shown first, no blanket reset.
    // Never repeat even a singleton before the cooldown has elapsed.
    const cooled = ranked.filter(row => now - entries[row.index].at >= COOLDOWN_MS)
      .sort((a, b) => a.index - b.index);
    return cooled.length ? [cooled[0].item] : [];
  }

  // Collect all transitively connected history entries without changing
  // their timestamps. The caller decides whether a display actually happened.
  function collectMatches(entries, keys) {
    const remaining = entries.slice();
    const matches = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const row = remaining[i];
        if (!row.keys.some(k => keys.has(k))) continue;
        for (const k of row.keys) keys.add(k);
        matches.push(row);
        remaining.splice(i, 1);
        changed = true;
      }
    }
    return { remaining, matches };
  }

  // Observation is not a draw. Migrate once and enrich only already-seen
  // identities, retaining the most recent actual display time in a group.
  function reconcile(pool, raw, now = Date.now()) {
    if (raw == null) return raw;
    let { entries } = history(raw, now);
    for (const item of ID.dedupe(pool, now)) {
      const keys = new Set(ID.keysFor(item));
      const { remaining, matches } = collectMatches(entries, keys);
      if (!matches.length) continue;
      if (matches.length === 1 && [...keys].every(k => matches[0].keys.includes(k))) continue;
      const at = Math.max(...matches.map(row => row.at));
      entries = [...remaining, { keys: ID.cleanKeys([...keys]), at }].sort((a, b) => a.at - b.at);
    }
    return { v: 2, entries };
  }

  function record(raw, item, now = Date.now()) {
    const entries = history(raw, now).entries;
    const keys = new Set(ID.keysFor(item));
    if (!keys.size) return { v: 2, entries };
    const { remaining } = collectMatches(entries, keys);
    remaining.push({ keys: ID.cleanKeys([...keys]), at: now });
    return { v: 2, entries: remaining.slice(-HISTORY_LIMIT) };
  }

  function requestUrl(endpoint, lang) {
    if (!["zh", "en"].includes(lang)) return "";
    try {
      const u = new URL(endpoint);
      if (!ID.canonicalUrl(u.href)) return "";
      if (u.pathname === "/") u.pathname = "/gossip";
      u.hash = "";
      u.searchParams.set("lang", lang);
      // Keep the new list protocol separate from old SW/HTTP cached URLs.
      u.searchParams.set("v", "2");
      return u.href;
    } catch { return ""; }
  }

  // One cache and in-flight request per language and current endpoint.
  // Late responses only write their own slot, not a global current pool.
  function createClient({ fetcher = (...args) => fetch(...args),
    now = () => Date.now(), timeoutMs = 15000,
    schedule = setTimeout, cancel = clearTimeout } = {}) {
    const slots = new Map();
    function slotFor(lang, endpoint) {
      const url = requestUrl(endpoint, lang);
      if (!url) return null;
      let slot = slots.get(lang);
      if (!slot || slot.url !== url) {
        slot = { url, items: [], sourceAt: null, nextAt: 0, pending: null };
        slots.set(lang, slot);
      }
      return slot;
    }
    function freshItems(slot, time) {
      if (!slot || slot.sourceAt === null || time - slot.sourceAt > ID.MAX_STALE_MS) return [];
      // The list was already normalized/deduped on ingestion.
      return slot.items.filter(item => !item.publishedAt ||
        time - Date.parse(item.publishedAt) <= ID.MAX_AGE_MS);
    }
    function items(lang, endpoint) {
      return freshItems(slotFor(lang, endpoint), now());
    }
    function refresh(lang, endpoint) {
      const slot = slotFor(lang, endpoint);
      if (!slot) return Promise.resolve([]);
      if (slot.pending) return slot.pending;
      if (now() < slot.nextAt) return Promise.resolve(freshItems(slot, now()));
      const ctl = new AbortController();
      let timer;
      // Race the full response (including JSON) against a timeout, even
      // if a network adapter ignores AbortSignal.
      const load = Promise.resolve().then(async () => {
        const res = await fetcher(slot.url, { signal: ctl.signal, cache: "no-store" });
        if (!res.ok) throw Error("news unavailable");
        return res.json();
      });
      const deadline = new Promise((_, reject) => {
        timer = schedule(() => { ctl.abort(); reject(Error("news timeout")); }, timeoutMs);
      });
      slot.pending = Promise.race([load, deadline]).then(payload => {
        const time = now();
        // D2 is list-only. A legacy single response is intentionally ignored.
        if (!payload || payload.lang !== lang || !Array.isArray(payload.items) ||
            !Number.isFinite(payload.fetchedAt) || payload.fetchedAt > time + 60000 ||
            time - payload.fetchedAt > ID.MAX_STALE_MS) throw Error("invalid news list");
        const clean = ID.dedupe(payload.items.filter(i => i && (!i.lang || i.lang === lang)), time);
        if (!clean.length) throw Error("empty news");
        const sourceAt = Math.min(payload.fetchedAt, time);
        if (slot.sourceAt === null || sourceAt >= slot.sourceAt) {
          slot.items = clean;
          slot.sourceAt = sourceAt;
        }
        slot.nextAt = time + Math.max(RETRY_MS, CACHE_MS - (time - slot.sourceAt));
        return freshItems(slot, time);
      }).catch(() => {
        slot.nextAt = now() + RETRY_MS;
        return freshItems(slot, now());
      }).finally(() => {
        cancel(timer);
        slot.pending = null;
      });
      return slot.pending;
    }
    return { items, refresh };
  }

  return { history, eligible, reconcile, record, createClient, requestUrl, CACHE_MS, RETRY_MS, COOLDOWN_MS, HISTORY_LIMIT };
})();
