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

   New moons: Meeus, Astronomical Algorithms (2nd ed., 1998), ch. 49 —
   mean phase plus the full periodic series for the new moon and the 14
   planetary-argument terms (A1…A14); Meeus gives its error against
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

  /* ---------- New moon (Meeus ch. 49) ---------- */
  // Periodic terms for the new moon: [coefficient (days), power of E, M, M', F, Ω].
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
  // Additional corrections: [coefficient (1e-6 days), A0 (deg), rate per lunation (deg)].
  const PLANETARY_TERMS = [
    [325, 299.77, 0.107408], [165, 251.88, 0.016321], [164, 251.83, 26.651886],
    [126, 349.42, 36.412478], [110, 84.66, 18.206239], [62, 141.74, 53.303771],
    [60, 207.14, 2.453732], [56, 154.84, 7.306860], [47, 34.52, 27.261239],
    [42, 207.19, 0.121824], [40, 291.34, 1.844379], [37, 161.72, 24.198154],
    [35, 239.56, 25.513099], [23, 331.55, 3.592518],
  ];
  /* Julian Ephemeris Day (TT) of the true new moon of lunation k
     (k = 0 is the new moon of 2000-01-06). */
  function newMoonJDE(k) {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = (2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3) * D2R;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * D2R;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * D2R;
    const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * D2R;
    for (const [c, e, m, mp, f, om] of NEW_MOON_TERMS) {
      jde += c * (e === 0 ? 1 : e === 1 ? E : E * E) * Math.sin(m * M + mp * Mp + f * F + om * Om);
    }
    for (let i = 0; i < PLANETARY_TERMS.length; i++) {
      const [c, a0, rate] = PLANETARY_TERMS[i];
      const A = a0 + rate * k - (i === 0 ? 0.009173 * T2 : 0);
      jde += c * 1e-6 * Math.sin(A * D2R);
    }
    return jde;
  }

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
    const newMoonCache = new Map();
    /* UTC milliseconds of new moon k. */
    function newMoonMs(k) {
      let ms = newMoonCache.get(k);
      if (ms !== undefined) return ms;
      const jde = newMoonJDE(k);
      const yearFloat = 2000 + (jde - 2451545) / 365.25;
      ms = (jde - 2440587.5) * DAY_MS - deltaTSeconds(yearFloat) * 1000;
      newMoonCache.set(k, ms);
      return ms;
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

    return { fromDate, fromDayNumber, monthsOfYear, newMoonMs, lunationContaining };
  }

  return { create, newMoonJDE, label, monthName, dayName, ganzhiOfYear, beijingDay, MONTH_NAMES };
})();
