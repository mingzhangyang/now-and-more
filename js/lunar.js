/* Now, and More — the Chinese lunar calendar (农历), computed here.
   Replaces the browser's Intl "chinese" calendar (ICU), which is not
   precise enough (it starts 丁未 2027 on Feb 7; the conjunction is at
   23:56 Beijing time on Feb 6) and varies between browser versions.
   Rules, conventions, sources and verification: docs/almanac-rules.md §1a.

   Rules (GB/T 33661-2017 《农历的编算和颁行》):
   · time is Beijing time, UTC+8;
   · a month begins on the civil day that contains the new moon (朔);
   · the month containing 冬至 is the eleventh month;
   · in a 岁 (the span from one 冬至 month to the next) holding 13 months,
     the first month containing no 中气 is the leap month (闰), and takes
     the number of the month before it;
   · the lunar year begins on 正月初一.

   Mapping convention: a LOCAL calendar date D is given the lunar date of
   the same civil date D in the China (UTC+8) calendar — what ICU does,
   so a visitor in New York sees the same 「十月十八」 on 26 Nov as one in
   Shanghai. The almanac's other layers are reckoned in local days.

   New moons (and the other phases, for 朔弦望): Meeus, Astronomical
   Algorithms (2nd ed., 1998), ch. 49 — mean phase plus the full periodic
   series of each phase and the 14 planetary-argument terms (A1…A14); Meeus gives its error against
   ELP-2000/82 as a few seconds (max ≈ 17 s). The result is in TT; the
   injected ΔT model turns it into UT. 中气 come from the site's own
   solar-term solver, injected the same way, so the almanac's 「今日交节」
   and the lunar calendar read the very same instants. Nothing here
   touches the DOM or the clock. */
"use strict";

const NAM_LUNAR = (() => {
  const DAY_MS = 86400000;
  const BEIJING_MS = 8 * 3600000;
  const D2R = Math.PI / 180;
  const GAN = "甲乙丙丁戊己庚辛壬癸";
  const ZHI = "子丑寅卯辰巳午未申酉戌亥";
  const MONTH_NAMES = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "腊月"];
  const DAY_DIGITS = "一二三四五六七八九十";
  const PHASE_NAMES = ["朔", "上弦", "望", "下弦"];

  /* ---------- Phases of the Moon (Meeus ch. 49) ---------- */
  // Periodic terms: [coefficient (days), power of E, M, M', F, Ω] — new moon, full moon, quarters.
  const NEW_MOON_TERMS = [
    [-0.40720, 0, 0, 1, 0, 0], [0.17241, 1, 1, 0, 0, 0], [0.01608, 0, 0, 2, 0, 0],
    [0.01039, 0, 0, 0, 2, 0], [0.00739, 1, -1, 1, 0, 0], [-0.00514, 1, 1, 1, 0, 0],
    [0.00208, 2, 2, 0, 0, 0], [-0.00111, 0, 0, 1, -2, 0], [-0.00057, 0, 0, 1, 2, 0],
    [0.00056, 1, 1, 2, 0, 0], [-0.00042, 0, 0, 3, 0, 0], [0.00042, 1, 1, 0, 2, 0],
    [0.00038, 1, 1, 0, -2, 0], [-0.00024, 1, -1, 2, 0, 0], [-0.00017, 0, 0, 0, 0, 1],
    [-0.00007, 0, 2, 1, 0, 0], [0.00004, 0, 0, 2, -2, 0], [0.00004, 0, 3, 0, 0, 0],
    [0.00003, 0, 1, 1, -2, 0], [0.00003, 0, 0, 2, 2, 0], [-0.00003, 0, 1, 1, 2, 0],
    [0.00003, 0, -1, 1, 2, 0], [-0.00002, 0, -1, 1, -2, 0], [-0.00002, 0, 1, 3, 0, 0],
    [0.00002, 0, 0, 4, 0, 0],
  ];
  const FULL_MOON_TERMS = [
    [-0.40614, 0, 0, 1, 0, 0], [0.17302, 1, 1, 0, 0, 0], [0.01614, 0, 0, 2, 0, 0],
    [0.01043, 0, 0, 0, 2, 0], [0.00734, 1, -1, 1, 0, 0], [-0.00515, 1, 1, 1, 0, 0],
    [0.00209, 2, 2, 0, 0, 0], [-0.00111, 0, 0, 1, -2, 0], [-0.00057, 0, 0, 1, 2, 0],
    [0.00056, 1, 1, 2, 0, 0], [-0.00042, 0, 0, 3, 0, 0], [0.00042, 1, 1, 0, 2, 0],
    [0.00038, 1, 1, 0, -2, 0], [-0.00024, 1, -1, 2, 0, 0], [-0.00017, 0, 0, 0, 0, 1],
    [-0.00007, 0, 2, 1, 0, 0], [0.00004, 0, 0, 2, -2, 0], [0.00004, 0, 3, 0, 0, 0],
    [0.00003, 0, 1, 1, -2, 0], [0.00003, 0, 0, 2, 2, 0], [-0.00003, 0, 1, 1, 2, 0],
    [0.00003, 0, -1, 1, 2, 0], [-0.00002, 0, -1, 1, -2, 0], [-0.00002, 0, 1, 3, 0, 0],
    [0.00002, 0, 0, 4, 0, 0],
  ];
  const QUARTER_TERMS = [
    [-0.62801, 0, 0, 1, 0, 0], [0.17172, 1, 1, 0, 0, 0], [-0.01183, 1, 1, 1, 0, 0],
    [0.00862, 0, 0, 2, 0, 0], [0.00804, 0, 0, 0, 2, 0], [0.00454, 1, -1, 1, 0, 0],
    [0.00204, 2, 2, 0, 0, 0], [-0.00180, 0, 0, 1, -2, 0], [-0.00070, 0, 0, 1, 2, 0],
    [-0.00040, 0, 0, 3, 0, 0], [-0.00034, 1, -1, 2, 0, 0], [0.00032, 1, 1, 0, 2, 0],
    [0.00032, 1, 1, 0, -2, 0], [-0.00028, 2, 2, 1, 0, 0], [0.00027, 1, 1, 2, 0, 0],
    [-0.00017, 0, 0, 0, 0, 1], [-0.00005, 0, -1, 1, -2, 0], [0.00004, 0, 0, 2, 2, 0],
    [-0.00004, 0, 1, 1, 2, 0], [0.00004, 0, -2, 1, 0, 0], [0.00003, 0, 1, 1, -2, 0],
    [0.00003, 0, 3, 0, 0, 0], [0.00002, 0, 0, 2, -2, 0], [0.00002, 0, -1, 1, 2, 0],
    [-0.00002, 0, 1, 3, 0, 0],
  ];
  // Additional corrections: [coefficient (1e-6 days), A0 (deg), rate per lunation (deg)].
  const PLANETARY_TERMS = [
    [325, 299.77, 0.107408], [165, 251.88, 0.016321], [164, 251.83, 26.651886],
    [126, 349.42, 36.412478], [110, 84.66, 18.206239], [62, 141.74, 53.303771],
    [60, 207.14, 2.453732], [56, 154.84, 7.306860], [47, 34.52, 27.261239],
    [42, 207.19, 0.121824], [40, 291.34, 1.844379], [37, 161.72, 24.198154],
    [35, 239.56, 25.513099], [23, 331.55, 3.592518],
  ];
  /* Julian Ephemeris Day (TT) of phase q of lunation k: q = 0 new moon,
     1 first quarter, 2 full moon, 3 last quarter (k = 0 is the new moon
     of 2000-01-06). */
  function phaseJDE(k, q) {
    const kk = k + q / 4;
    const T = kk / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    let jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = (2.5534 + 29.10535670 * kk - 0.0000014 * T2 - 0.00000011 * T3) * D2R;
    const Mp = (201.5643 + 385.81693528 * kk + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * D2R;
    const F = (160.7108 + 390.67050284 * kk - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * D2R;
    const Om = (124.7746 - 1.56375588 * kk + 0.0020672 * T2 + 0.00000215 * T3) * D2R;
    const terms = q === 0 ? NEW_MOON_TERMS : q === 2 ? FULL_MOON_TERMS : QUARTER_TERMS;
    for (const [c, e, m, mp, f, om] of terms) {
      jde += c * (e === 0 ? 1 : e === 1 ? E : E * E) * Math.sin(m * M + mp * Mp + f * F + om * Om);
    }
    if (q === 1 || q === 3) {
      const W = 0.00306 - 0.00038 * E * Math.cos(M) + 0.00026 * Math.cos(Mp) - 0.00002 * Math.cos(Mp - M)
        + 0.00002 * Math.cos(Mp + M) + 0.00002 * Math.cos(2 * F);
      jde += q === 1 ? W : -W;
    }
    for (let i = 0; i < PLANETARY_TERMS.length; i++) {
      const [c, a0, rate] = PLANETARY_TERMS[i];
      const A = a0 + rate * kk - (i === 0 ? 0.009173 * T2 : 0);
      jde += c * 1e-6 * Math.sin(A * D2R);
    }
    return jde;
  }
  const newMoonJDE = (k) => phaseJDE(k, 0);

  /* ---------- Calendar ---------- */
  const ganzhiOfYear = (y) => {
    const i = (((y - 4) % 60) + 60) % 60;
    return GAN[i % 10] + ZHI[i % 12];
  };
  function dayName(d) {
    if (d === 10) return "初十";
    if (d === 20) return "二十";
    if (d === 30) return "三十";
    const tens = ["初", "十", "廿"][Math.floor(d / 10)];
    return tens + DAY_DIGITS[(d % 10) - 1];
  }
  const monthName = (month, leap) => (leap ? "闰" : "") + MONTH_NAMES[month - 1];
  /* 「十月十八」 「闰六月初三」 「腊月廿九」 */
  const label = (l) => monthName(l.month, l.leap) + dayName(l.day);

  /* Civil-day number in Beijing time (days since 1970-01-01) of an instant. */
  const beijingDay = (ms) => Math.floor((ms + BEIJING_MS) / DAY_MS);

  /* A calendar bound to the site's ΔT model and solar-term solver:
       deltaTSeconds(yearFloat) → TT − UT in seconds;
       termsOfYear(year)        → [{ angle, instant: Date }] for the 24
                                  crossings of that UTC year (cached by
                                  the caller). 中气 are angle ≡ 0 (mod 30). */
  function create({ deltaTSeconds, termsOfYear }) {
    const phaseCache = new Map();
    /* UTC milliseconds of phase q (0 朔, 1 上弦, 2 望, 3 下弦) of lunation k. */
    function phaseMs(k, q) {
      const key = k * 4 + q;
      let ms = phaseCache.get(key);
      if (ms !== undefined) return ms;
      const jde = phaseJDE(k, q);
      const yearFloat = 2000 + (jde - 2451545) / 365.25;
      ms = (jde - 2440587.5) * DAY_MS - deltaTSeconds(yearFloat) * 1000;
      phaseCache.set(key, ms);
      return ms;
    }
    const newMoonMs = (k) => phaseMs(k, 0);
    /* The phases whose instant lies in [startMs, endMs) — at most one for
       any span under a week: [{ q, name: 朔|上弦|望|下弦, ms }]. */
    function phasesBetween(startMs, endMs) {
      const k0 = Math.floor(((startMs / DAY_MS + 2440587.5) - 2451550.09766) / 29.530588861) - 1;
      const out = [];
      for (let k = k0; k <= k0 + 2; k++) {
        for (let q = 0; q < 4; q++) {
          const ms = phaseMs(k, q);
          if (ms >= startMs && ms < endMs) out.push({ q, name: PHASE_NAMES[q], ms });
        }
      }
      return out.sort((a, b) => a.ms - b.ms);
    }
    const newMoonDay = (k) => beijingDay(newMoonMs(k));
    /* The lunation k whose month (Beijing civil days) contains day dn. */
    function lunationContaining(dn) {
      let k = Math.floor((dn + 2440587.5 - 2451550.09766) / 29.530588861);
      while (newMoonDay(k) > dn) k--;
      while (newMoonDay(k + 1) <= dn) k++;
      return k;
    }
    function zhongQiDays(year) {
      return termsOfYear(year).filter((t) => t.angle % 30 === 0)
        .map((t) => ({ angle: t.angle, day: beijingDay(t.instant.getTime()) }));
    }
    function dongZhiDay(year) {
      return zhongQiDays(year).find((t) => t.angle === 270).day;
    }

    /* 岁 Y: the months from the 冬至 month of year Y−1 (month 11) up to,
       not including, the 冬至 month of year Y. Each month is
       { start, days, month, leap, year } with start a Beijing day number
       and year the lunar year (relatedYear) it belongs to. */
    const suiCache = new Map();
    function sui(Y) {
      let months = suiCache.get(Y);
      if (months) return months;
      const k0 = lunationContaining(dongZhiDay(Y - 1));
      const k1 = lunationContaining(dongZhiDay(Y));
      const qi = [...zhongQiDays(Y - 1), ...zhongQiDays(Y)].map((t) => t.day);
      const count = k1 - k0;
      if (count !== 12 && count !== 13) throw new Error(`岁 ${Y}: ${count} months`);
      let leapSeen = count === 12; // a 12-month 岁 has no leap month
      let num = 11;
      months = [];
      for (let k = k0; k < k1; k++) {
        const start = newMoonDay(k), end = newMoonDay(k + 1);
        let leap = false;
        if (k > k0) {
          if (!leapSeen && !qi.some((d) => d >= start && d < end)) { leap = true; leapSeen = true; }
          else num = num % 12 + 1;
        }
        months.push({ start, days: end - start, month: num, leap });
      }
      // Months before the first 正月 belong to the previous lunar year.
      const first = months.findIndex((m) => m.month === 1 && !m.leap);
      months.forEach((m, i) => { m.year = i < first ? Y - 1 : Y; });
      suiCache.set(Y, months);
      return months;
    }

    /* Lunar date of Beijing civil day number dn. */
    function fromDayNumber(dn) {
      // 冬至 is on Dec 21–23, so the 岁 holding dn is that of its UTC year or the next.
      let Y = new Date(dn * DAY_MS).getUTCFullYear();
      let months = sui(Y + 1);
      if (dn < months[0].start) { months = sui(Y); if (dn < months[0].start) months = sui(Y - 1); }
      let i = months.length - 1;
      while (months[i].start > dn) i--;
      const m = months[i];
      return {
        year: m.year,
        month: m.month,
        day: dn - m.start + 1,
        leap: m.leap,
        monthDays: m.days,
        yearGanzhi: ganzhiOfYear(m.year),
      };
    }

    /* Lunar date of the LOCAL calendar date of `date` (see the mapping
       convention above). Adds `label` (「十月十八」). */
    const dayCache = new Map();
    function fromDate(date) {
      const dn = Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
      let l = dayCache.get(dn);
      if (!l) {
        l = fromDayNumber(dn);
        l.label = label(l);
        if (dayCache.size > 4000) dayCache.clear();
        dayCache.set(dn, l);
      }
      return { ...l };
    }

    /* The months of lunar year Y (正月 … 腊月, leap months in place):
       [{ month, leap, days, start: "YYYY-MM-DD" }]. */
    function monthsOfYear(Y) {
      return [...sui(Y), ...sui(Y + 1)].filter((m) => m.year === Y).map((m) => ({
        month: m.month, leap: m.leap, days: m.days,
        start: new Date(m.start * DAY_MS).toISOString().slice(0, 10),
      }));
    }

    return { fromDate, fromDayNumber, monthsOfYear, newMoonMs, phaseMs, phasesBetween, lunationContaining };
  }

  return { create, newMoonJDE, phaseJDE, PHASE_NAMES, label, monthName, dayName, ganzhiOfYear, beijingDay, MONTH_NAMES };
})();
