/* Now, and More — zero-dependency draw primitives.
   Keep the existing nam-decks-v1 storage shape; stable IDs and cross-tab
   reconciliation are separate follow-up work. Loaded before app.js. */
"use strict";

const NAM_DEDUP = (() => {
  const KEY = "nam-decks-v1";

  function load(storage) {
    const fresh = { v: 1, d: {}, g: {}, fp: [] };
    try {
      const s = JSON.parse(storage.getItem(KEY));
      if (!s || s.v !== 1 || !s.d || typeof s.d !== "object" || Array.isArray(s.d)) return fresh;
      if (!s.g || typeof s.g !== "object" || Array.isArray(s.g)) s.g = {};
      if (!Array.isArray(s.fp)) s.fp = [];
      return s;
    } catch (e) { return fresh; }
  }

  function valid(d, n) {
    if (!d || d.n !== n || !Array.isArray(d.r)) return false;
    const seen = new Set();
    for (const i of d.r) {
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
      seen.add(i);
    }
    return d.l == null || (Number.isInteger(d.l) && d.l >= 0 && d.l < n);
  }

  function shuffle(n, random, last) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    // No repeat across an exhausted or rebuilt bag if the previous index
    // still exists. Stable identity across reordering is D3's responsibility.
    if (n > 1 && a[n - 1] === last) {
      [a[0], a[n - 1]] = [a[n - 1], a[0]];
    }
    return a;
  }

  function createDeckState(storage, random = Math.random) {
    let state = load(storage);
    let active = false;

    function draw(key, n) {
      if (!active) throw new Error("Deck draws must be inside a render transaction");
      if (n <= 0) return -1;
      let d = state.d[key];
      if (!valid(d, n)) {
        const last = d && Number.isInteger(d.l) && d.l >= 0 && d.l < n ? d.l : null;
        d = state.d[key] = { n, r: shuffle(n, random, last), l: last };
      }
      if (!d.r.length) d.r = shuffle(n, random, d.l);
      const idx = d.r.pop();
      d.l = idx;
      return idx;
    }

    function persist() {
      try { storage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { /* Keep the committed state in memory if storage is unavailable. */ }
    }

    // Non-draw maintenance is independent of the render transaction.
    // The updater is pure and must not consume an unseen news item.
    function updateGossip(language, update) {
      if (active) throw new Error("News maintenance must be outside a render transaction");
      const previous = state.g[language];
      const next = update(previous);
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      state.g[language] = next;
      persist();
    }

    // Synchronous: choose, render, and only then publish the new history.
    // No asynchronous callback or storage write can expose a partial bag.
    function transact(render) {
      if (active) throw new Error("Nested draw transaction");
      const previous = state;
      state = JSON.parse(JSON.stringify(previous));
      active = true;
      let selection;
      try {
        selection = render();
      } catch (e) {
        state = previous;
        throw e;
      } finally {
        active = false;
      }
      persist();
      return selection;
    }

    return { get state() { return state; }, draw, transact, updateGossip };
  }

  // Condition the configured weights on a different eligible category.
  // A single eligible category remains drawable.
  function weightedCategory(available, last, random = Math.random) {
    const positive = available.filter((c) => c.weight > 0);
    if (!positive.length) return null;
    const alternatives = positive.filter((c) => c.key !== last);
    const pool = alternatives.length ? alternatives : positive;
    let r = random() * pool.reduce((sum, c) => sum + c.weight, 0);
    for (const c of pool) {
      if (r < c.weight) return c.key;
      r -= c.weight;
    }
    return pool[pool.length - 1].key;
  }

  // The scheduler is injectable for deterministic tests. Ignore further
  // manual/automatic requests until the accepted draw has finished.
  function createDrawGate(schedule) {
    let pending = false;
    return {
      get pending() { return pending; },
      request(draw) {
        if (pending) return false;
        pending = true;
        try {
          schedule(() => {
            try { draw(); }
            finally { pending = false; }
          });
        } catch (e) {
          pending = false;
          throw e;
        }
        return true;
      },
    };
  }

  return { createDeckState, weightedCategory, createDrawGate };
})();
