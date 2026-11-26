#!/usr/bin/env python3
"""Generate tests/fixtures/lunar-months.json — the first day of every
lunar month from 1950 to 2100 according to cnlunar 0.2.5 (MIT License,
Copyright (c) 2025 OPN48), checked by tests/lunar.test.cjs against the
site's own lunar calendar (js/lunar.js).

    pip install cnlunar==0.2.5
    python3 scripts/lunar-golden.py      # rewrites the fixture

cnlunar does not compute the moon: it decodes a precomputed 1901-2100
table (the widely circulated table of month lengths, leap months and
Spring Festival dates, after the Hong Kong Observatory's calendar). It
is used ONLY here, offline, to produce reference data; nothing of it is
copied into js/. Its table ends with lunar year 2099 (i.e. on the day
before 2100's Spring Festival); every day from 1950-01-01 to that last
convertible day (at 12:00, so
cnlunar's 23:00 rule never applies) is converted, and each day that
cnlunar calls 初一 is recorded as

    [ISO date, lunar year (the Gregorian year it began in), month, leap]

The lunar date of every other day follows from these starts, so the
fixture pins the whole calendar. Daily values for 2025-2028 are also in
tests/fixtures/almanac-golden.json (field "lunar").
"""
import datetime
import json
import os
import sys

from importlib.metadata import version

import cnlunar

assert version("cnlunar") == "0.2.5", "expected cnlunar 0.2.5, got " + version("cnlunar")

FIRST, LAST = datetime.date(1950, 1, 1), datetime.date(2100, 12, 31)  # cnlunar stops early in 2100


def main():
    starts = []
    d = FIRST
    while d <= LAST:
        try:
            a = cnlunar.Lunar(datetime.datetime(d.year, d.month, d.day, 12, 0))
        except IndexError:
            # Past the end of cnlunar's table (lunar year 2100 onwards).
            assert d.year == 2100, d
            break
        if a.lunarDay == 1:
            starts.append([d.isoformat(), a.lunarYear, a.lunarMonth, bool(a.isLunarLeapMonth)])
        d += datetime.timedelta(days=1)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "tests", "fixtures", "lunar-months.json")
    head = {
        "source": "cnlunar 0.2.5 (MIT, OPN48) via scripts/lunar-golden.py: "
                  "every day cnlunar calls 初一, 1950 to the end of its table",
        "timeZone": "Asia/Shanghai",
        "range": [FIRST.isoformat(), (d - datetime.timedelta(days=1)).isoformat()],
        "fields": ["date", "year", "month", "leap"],
    }
    with open(out, "w", encoding="utf-8") as f:
        f.write("{\n")
        for k, v in head.items():
            f.write("  %s: %s,\n" % (json.dumps(k), json.dumps(v, ensure_ascii=False)))
        f.write('  "starts": [\n')
        f.write(",\n".join("    " + json.dumps(r) for r in starts))
        f.write("\n  ]\n}\n")
    print("wrote %d month starts to %s" % (len(starts), os.path.normpath(out)), file=sys.stderr)


if __name__ == "__main__":
    main()
