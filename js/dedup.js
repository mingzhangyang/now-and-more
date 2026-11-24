/* Now, and More — stable-ID decks and shared render transactions.
   v2 is isolated from legacy clients writing nam-decks-v1. */
"use strict";

const NAM_DEDUP = (() => {
  const KEY = "nam-decks-v2";
  const LEGACY_KEY = "nam-decks-v1";
  const LOCK = "nam-decks-v2-write";
  const fresh = () => ({ v: 2, d: {}, g: {}, fp: [] });
  const object = x => !!x && typeof x === "object" && !Array.isArray(x);
  const validId = x => typeof x === "string" && x.length > 0 && x.length <= 128;
  const uniqueIds = x => [...new Set((Array.isArray(x) ? x : []).filter(validId))];
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };
  const safeKey = key => !["__proto__", "constructor", "prototype"].includes(key);

  function baseFields(s) {
    const state = fresh();
    if (object(s.g)) {
      for (const lang of ["zh", "en"]) if (own(s.g, lang) && object(s.g[lang])) state.g[lang] = s.g[lang];
    }
    if (Array.isArray(s.fp)) state.fp = s.fp.filter(x => typeof x === "string" && x.length <= 1024).slice(-16);
    return state;
  }

  function cleanBag(d) {
    if (!object(d) || !Array.isArray(d.r)) return null;
    const l = validId(d.l) ? d.l : null;
    if (d.legacyMine === true) return { legacyMine: true, r: uniqueIds(d.r).filter(id => id !== l), l };
    if (!Array.isArray(d.s)) return null;
    const s = uniqueIds(d.s);
    if (l && !s.includes(l)) s.push(l);
    const seen = new Set(s);
    return { s, r: uniqueIds(d.r).filter(id => !seen.has(id)), l };
  }

  function decode(raw) {
    const s = parse(raw);
    if (!object(s) || s.v !== 2) return fresh();
    const state = baseFields(s);
    if (object(s.d)) {
      for (const [key, bag] of Object.entries(s.d)) {
        if (!safeKey(key)) continue;
        const clean = cleanBag(bag);
        if (clean) state.d[key] = clean;
      }
    }
    return state;
  }

  function migrate(raw, legacyIds) {
    const s = parse(raw);
    if (!object(s) || s.v !== 1) return fresh();
    const state = baseFields(s);
    if (!object(s.d)) return state;
    const noteId = id => Number.isSafeInteger(id) && id > 0 ? "note:" + id : null;
    for (const [key, d] of Object.entries(s.d)) {
      if (!safeKey(key) || !object(d) || !Array.isArray(d.r)) continue;
      if (key === "mine") {
        const l = noteId(d.l);
        // Old note bags did not store total membership. At first use, the
        // surviving remaining IDs are exact; other current IDs are treated
        // as already seen until the next cycle.
        state.d[key] = { legacyMine: true, r: uniqueIds(d.r.map(noteId)).filter(id => id !== l), l };
        continue;
      }
      const ids = own(legacyIds, key) ? legacyIds[key] : null;
      if (!Array.isArray(ids) || d.n !== ids.length) continue;
      const at = i => Number.isInteger(i) && i >= 0 && i < ids.length ? ids[i] : null;
      const l = at(d.l);
      const r = uniqueIds(d.r.map(at)).filter(id => id !== l);
      const remaining = new Set(r);
      state.d[key] = { s: ids.filter(id => !remaining.has(id)), r, l };
    }
    return state;
  }

  // A storage exception should not prevent the clock, settings or draws
  // from running. If storage becomes unusable, keep a page-local shadow.
  // Do not silently switch back to a stale persistent snapshot mid-session.
  function safeStorage(getStorage) {
    const memory = new Map();
    let backend;
    try { backend = getStorage(); } catch { backend = null; }
    return {
      getItem(key) {
        if (backend) {
          try {
            const value = backend.getItem(key);
            if (value == null) memory.delete(key); else memory.set(key, value);
            return value;
          } catch { backend = null; }
        }
        return memory.get(key) ?? null;
      },
      setItem(key, value) {
        value = String(value);
        memory.set(key, value);
        if (backend) { try { backend.setItem(key, value); } catch { backend = null; } }
      },
      removeItem(key) {
        memory.delete(key);
        if (backend) { try { backend.removeItem(key); } catch { backend = null; } }
      },
    };
  }

  function shuffle(ids, random, last) {
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.length > 1 && a[a.length - 1] === last) {
      [a[0], a[a.length - 1]] = [a[a.length - 1], a[0]];
    }
    return a;
  }

  function browserLocks() {
    try { return navigator.locks || null; } catch { return null; }
  }

  // Note edits use this same lock until IndexedDB commit and notification.
  // The draw transaction itself remains synchronous; no network I/O runs
  // under the lock. Only API rejection before entry may fall back.
  function runShared(locks, work) {
    if (!locks || typeof locks.request !== "function") return work();
    let entered = false;
    let result;
    try {
      result = locks.request(LOCK, { mode: "exclusive" }, () => {
        entered = true;
        return work();
      });
    } catch (e) {
      if (entered) throw e;
      return work();
    }
    return Promise.resolve(result).catch(e => {
      if (entered) throw e;
      return work();
    });
  }

  function createDeckState(storage, random = Math.random, { legacyIds = {}, locks = null } = {}) {
    let lastRaw = null, initialized = false, active = false, held = false;
    let state = fresh();

    // Refresh immediately before each mutation; storage events also update
    // passive tabs. Never replace an in-flight render draft.
    function sync() {
      if (active || held) return;
      try {
        const raw = storage.getItem(KEY);
        if (initialized && raw === lastRaw) return;
        state = raw !== null ? decode(raw) : (!initialized ? migrate(storage.getItem(LEGACY_KEY), legacyIds) : fresh());
        lastRaw = raw;
        initialized = true;
      } catch { /* Keep the last valid in-memory state. */ }
    }
    sync();

    function persist() {
      const raw = JSON.stringify(state);
      if (raw === lastRaw) return;
      try {
        storage.setItem(KEY, raw);
        lastRaw = raw;
        initialized = true;
      } catch { /* In-memory draw history is still committed. */ }
    }

    // Browser Web Locks cover the complete synchronous choice/render/
    // commit (including gift receipts) and D2 maintenance. Older browsers
    // have best-effort reread, not a fake localStorage atomic mutex.
    function withLock(work) {
      const run = () => {
        sync();
        held = true;
        try { return work(); } finally { held = false; }
      };
      return runShared(locks, run);
    }

    function prepare(key, pool) {
      if (!active) throw new Error("Deck draws must be inside a render transaction");
      if (!safeKey(key)) throw new Error("Invalid deck key");
      const ids = uniqueIds(pool);
      if (!ids.length) {
        delete state.d[key];
        return null;
      }
      const alive = new Set(ids);
      let d = cleanBag(state.d[key]);
      if (!d) d = { s: [], r: shuffle(ids, random, null), l: null };
      else {
        const remaining = d.r.filter(id => alive.has(id));
        const remainingSet = new Set(remaining);
        const seen = d.legacyMine
          ? ids.filter(id => !remainingSet.has(id))
          : d.s.filter(id => alive.has(id));
        const known = new Set(seen.concat(remaining));
        const additions = ids.filter(id => !known.has(id));
        const last = alive.has(d.l) ? d.l : null;
        // Seen and remaining partition the current pool: store each ID
        // once. Newly added IDs join the round; deleted IDs are pruned.
        d = { s: seen, r: additions.length ? shuffle(remaining.concat(additions), random, last) : remaining, l: last };
      }
      if (!d.r.length) {
        d.s = [];
        d.r = shuffle(ids, random, d.l);
      }
      state.d[key] = d;
      return d;
    }

    function draw(key, ids) {
      const d = prepare(key, ids);
      if (!d) return -1;
      d.l = d.r.pop();
      d.s.push(d.l);
      return ids.indexOf(d.l);
    }

    // Mandatory delivery counts as an actual display in the current
    // random note cycle. If already seen, don't consume a second slot.
    function markSeen(key, ids, id) {
      if (!ids.includes(id)) return;
      const d = prepare(key, ids);
      if (!d) return;
      d.r = d.r.filter(value => value !== id);
      if (!d.s.includes(id)) d.s.push(id);
      d.l = id;
    }

    function updateGossip(language, update) {
      if (!["zh", "en"].includes(language)) return;
      if (active) throw new Error("News maintenance must be outside a render transaction");
      return withLock(() => {
        const previous = state.g[language];
        const next = update(previous);
        if (JSON.stringify(next) === JSON.stringify(previous)) return;
        if (next == null) delete state.g[language]; else state.g[language] = next;
        persist();
      });
    }

    function transact(render) {
      if (active) throw new Error("Nested draw transaction");
      if (locks && !held) throw new Error("Render requires the shared draw lock");
      sync();
      const previous = state;
      const before = JSON.stringify(previous);
      state = JSON.parse(before);
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
      // Do not write for a pure rerender or unchanged state.
      if (JSON.stringify(state) !== before) persist();
      return selection;
    }

    return { get state() { return state; }, draw, markSeen, transact, updateGossip, withLock, sync };
  }

  function weightedCategory(available, last, random = Math.random) {
    const positive = available.filter(c => c.weight > 0);
    if (!positive.length) return null;
    const alternatives = positive.filter(c => c.key !== last);
    const pool = alternatives.length ? alternatives : positive;
    let r = random() * pool.reduce((sum, c) => sum + c.weight, 0);
    for (const c of pool) {
      if (r < c.weight) return c.key;
      r -= c.weight;
    }
    return pool[pool.length - 1].key;
  }

  // Retain the transition gate until an asynchronous lock request has
  // completed. An immediate language repaint uses the same gate.
  function createDrawGate(schedule, onError = e => console.error(e)) {
    let pending = false;
    function request(draw, immediate = false) {
      if (pending) return false;
      pending = true;
      function run() {
        try {
          const result = draw();
          if (result && typeof result.then === "function") {
            return Promise.resolve(result).finally(() => { pending = false; }).catch(onError);
          }
          pending = false;
        } catch (e) {
          pending = false;
          throw e;
        }
      }
      try {
        if (immediate) run(); else schedule(run);
      } catch (e) {
        pending = false;
        throw e;
      }
      return true;
    }
    return { get pending() { return pending; }, request, run: draw => request(draw, true) };
  }

  return { KEY, LEGACY_KEY, safeStorage, browserLocks, runShared, createDeckState, weightedCategory, createDrawGate };
})();
