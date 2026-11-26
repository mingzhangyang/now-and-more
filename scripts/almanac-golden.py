#!/usr/bin/env python3
"""Generate tests/fixtures/almanac-golden.json — independent reference
values for the 黄历 card, checked by tests/almanac-golden.test.cjs.

Reference implementation: cnlunar 0.2.5 (https://github.com/OPN48/cnLunar),
MIT License, Copyright (c) 2025 OPN48 — checked with `pip show cnlunar`.
It is used ONLY here, offline, to produce test reference data. None of its
code or tables are copied into js/; the site never depends on it.

    pip install cnlunar==0.2.5
    python3 scripts/almanac-golden.py      # rewrites the fixture

cnlunar works from its own tables (lunar new-year codes and day-level
solar-term dates, i.e. a different method from our VSOP87D solver and
ICU's chinese calendar), and it reckons in Beijing time. The fixture is
therefore checked with TZ=Asia/Shanghai.

Per date (every day of 2025-2028, at 12:00 so cnlunar's 23:00 子初换日
rule never applies) it records:
  lunarYear  年干支 of the lunar year (turns at 正月初一)   cnlunar year8Char (default)
  lichunYear 年干支 of the 立春-based year — derived HERE from cnlunar's
             立春 date (thisYearSolarTermsDic): before it → previous year.
             cnlunar's own year8Char='beginningOfSpring' is wrong from 冬至
             to Dec 31 (getBeginningOfSpringX treats "next term is 小寒"
             as "before 立春" and subtracts a year, e.g. 2025-12-25 → 甲辰
             instead of 乙巳); the script checks that this is the ONLY
             place the two disagree.
  month      节月 month ganzhi (五虎遁)                    cnlunar month8Char
  day        day ganzhi                                    cnlunar day8Char
  jianchu    十二建除 (节月 branch vs day branch)           cnlunar get_today12DayOfficer()[0] (godType '8char')
  chong      the animal the day clashes                    cnlunar chineseZodiacClash
  sha        煞方 — cnlunar does not compute it. Derived HERE from cnlunar's
             day branch with an explicit lookup table of the 三合 rule
             (申子辰南 巳酉丑东 寅午戌北 亥卯未西); this independently checks
             the JS mod-4 arithmetic, not the rule itself.
  term       name of the solar term falling on that day, else ""
  lunar      lunar month/day, "L" prefix for a leap month (e.g. "L6-01")
"""
import datetime
import json
import os
import sys

from importlib.metadata import version

import cnlunar

# The fixture records this exact reference; regenerate deliberately if it changes.
assert version("cnlunar") == "0.2.5", "expected cnlunar 0.2.5, got " + version("cnlunar")

YEARS = range(2025, 2029)
GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"


def ganzhi_of_year(y):
    i = (y - 4) % 60
    return GAN[i % 10] + ZHI[i % 12]
SHA_TABLE = {
    "申": "南", "子": "南", "辰": "南",
    "巳": "东", "酉": "东", "丑": "东",
    "寅": "北", "午": "北", "戌": "北",
    "亥": "西", "卯": "西", "未": "西",
}
FIELDS = ["date", "lunarYear", "lichunYear", "month", "day", "jianchu",
          "chong", "sha", "term", "lunar"]


def row(d):
    noon = datetime.datetime(d.year, d.month, d.day, 12, 0)
    a = cnlunar.Lunar(noon)
    b = cnlunar.Lunar(noon, year8Char="beginningOfSpring")
    clash = a.chineseZodiacClash  # e.g. "虎日冲猴"
    assert "日冲" in clash, clash
    lichun = a.thisYearSolarTermsDic["立春"]
    lichun_year = d.year if (d.month, d.day) >= lichun else d.year - 1
    lichun_gz = ganzhi_of_year(lichun_year)
    if b.year8Char != lichun_gz:
        # The known cnlunar defect described in the header, and nothing else.
        dongzhi = a.thisYearSolarTermsDic["冬至"]
        assert d.month == 12 and (d.month, d.day) >= dongzhi, (d, b.year8Char, lichun_gz)
        assert b.year8Char == ganzhi_of_year(d.year - 1), (d, b.year8Char)
    lunar = "%s%d-%02d" % ("L" if a.isLunarLeapMonth else "", a.lunarMonth, a.lunarDay)
    return [
        d.isoformat(),
        a.year8Char,
        lichun_gz,
        a.month8Char,
        a.day8Char,
        a.get_today12DayOfficer()[0],
        clash.split("日冲")[1],
        SHA_TABLE[a.day8Char[1]],
        "" if a.todaySolarTerms == "无" else a.todaySolarTerms,
        lunar,
    ]


def main():
    rows = []
    d = datetime.date(YEARS[0], 1, 1)
    end = datetime.date(YEARS[-1], 12, 31)
    while d <= end:
        rows.append(row(d))
        d += datetime.timedelta(days=1)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "tests", "fixtures", "almanac-golden.json")
    head = {
        "source": "cnlunar 0.2.5 (MIT, OPN48) via scripts/almanac-golden.py; "
                  "sha derived from cnlunar's day branch by the 三合 table",
        "timeZone": "Asia/Shanghai",
        "years": [YEARS[0], YEARS[-1]],
        "fields": FIELDS,
    }
    with open(out, "w", encoding="utf-8") as f:
        f.write("{\n")
        for k, v in head.items():
            f.write("  %s: %s,\n" % (json.dumps(k), json.dumps(v, ensure_ascii=False)))
        f.write('  "rows": [\n')
        f.write(",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in rows))
        f.write("\n  ]\n}\n")
    print("wrote %d rows to %s" % (len(rows), os.path.normpath(out)), file=sys.stderr)


if __name__ == "__main__":
    main()
