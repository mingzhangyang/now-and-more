# 黄历规则与口径 / Almanac rules and conventions

本文记录黄历卡（`js/app.js` 的 Almanac 一节，`computeAlmanac()`）每一项内容怎样算、按什么口径、出自哪里，
以及哪些仍是趣味随机、将在后续阶段替换。改动黄历代码时请同步修改本文。

This page documents how each line of the almanac card is computed, which conventions it follows, where each rule
comes from, and what is still a playful pseudo-random pick. Keep it in step with the code.

## 1. 三层结构 / Three layers

| 层 / Layer | 内容 | 状态 |
| --- | --- | --- |
| 天文历法 / Astronomical calendar | 节气交节时刻、干支纪日、农历日期、农历年、节月与立春年 | 精确计算（节气为分钟级求解器；农历日期用浏览器 Intl/ICU） |
| 择日规则 / Day-selection rules | 十二建除、冲煞、彭祖百忌；（后续）黄道黑道值神、神煞 | 建除、冲煞、彭祖已按传统规则；值神与神煞待做 |
| 宜忌 / Activities | 宜、忌 | 仍是按日种子的趣味随机，将由规则推导替换 |

上一层只依赖下一层：择日规则只读干支与节月，不读农历月份；宜忌将来只读择日规则的结果。

Each layer reads only the one beneath it: the selection rules read the ganzhi and the 节月, never the lunar month;
the activities will be derived from the selection rules.

## 2. 口径 / Conventions

1. **日界 / Day boundary**：本地民用午夜 00:00。日干支取本地日历日期的干支（不采用子初 23:00 换日）。
   The day ganzhi is that of the local calendar date; no 23:00 子初 rollover.
2. **节月界 / 节月 boundary**：某个「节」的交节时刻落在本地日历日 D（D 的 00:00 ≤ 时刻 < 次日 00:00），
   则自 D 日全天起换月建。判断用的是与卡片「今日交节」同一组时刻、同一个本地日区间
   （`solarTermsAround()` + `localDayBounds()`），所以建除与「今日交节」永远一致。
   时区取 Asia/Shanghai 时，与印本通书一致。/ A 节 crossing on local day D switches the month branch for the whole
   of D, using the very instants and local-day interval behind the card's 「今日交节」.
3. **年名 / Year label**：卡片上的「X年」是农历年，正月初一换年（ICU 的 `relatedYear`）。
   立春年（八字年柱口径）另行提供，不显示。/ The card's year is the lunar year (turns at Spring Festival);
   the 立春-based year is exposed separately and not displayed.
4. **其他时区 / Other time zones**：一切按本地日判断。同一交节时刻在北京是 12 月 7 日、在纽约是 12 月 6 日，
   两地建除各自在本地交节日重复。这是有意的口径，不是误差。

## 3. 已实现的规则 / Rules implemented

| 项目 | 规则 | 代码 | 出处 / Source |
| --- | --- | --- | --- |
| 日干支 | 儒略日数 JDN + 49 取六十甲子（以 1949-10-01、2000-01-07 两个甲子日校准） | `julianDayNumber()`、`dayGanzhi()` | 六十甲子逐日循环，不受月份、闰月影响 |
| 农历年干支 | Intl 中国历 `formatToParts` 的 `relatedYear`；无则依次用 `yearName`、`year`（数值或 1–60 的序数）；无中国历时退回立春年 | `yearGanzhi()` | 旧代码读取不存在的 `year` 字段，2026-01-01 至 02-16 误显丙午，应为乙巳 |
| 节月（月建） | 十二「节」换月：立春寅、惊蛰卯、清明辰、立夏巳、芒种午、小暑未、立秋申、白露酉、寒露戌、立冬亥、大雪子、小寒丑；中气不换月 | `jieMonthInfo()` | 《钦定协纪辨方书》以节气定月建（择日家通例） |
| 立春年 | 立春交节日起为新的一年；小寒所开的丑月属上一年 | `jieMonthInfo().jieYear`、`lichunYearGanzhi()` | 同上 |
| 月干支（未显示） | 五虎遁：甲己之年丙作首，乙庚之岁戊为头，丙辛必定寻庚起，丁壬壬位顺行流，戊癸何方发，甲寅之上好追求 | `jieMonthGanzhi()` | 通行口诀；已对照参考数据逐日验证，第二阶段（M2）再上卡 |
| 十二建除 | 日支与节月月支相同为「建」，顺数除满平定执破危成收开闭；交节日月支前进一位、日支也前进一位，故交节日与前一日同名 | `jianchuOf()` | 《淮南子·天文训》；《钦定协纪辨方书》建除十二神条 |
| 冲 | 地支六冲：日支 +6 的生肖 | `computeAlmanac().chong` | 子午、丑未、寅申、卯酉、辰戌、巳亥相冲 |
| 煞方 | 按日支三合局：申子辰煞南、巳酉丑煞东、寅午戌煞北、亥卯未煞西 | `shaDirectionOf()` | 《钦定协纪辨方书》劫煞、灾煞、岁煞（三煞）按年支三合定方位，通书以日支同法印「冲X煞Y」。旧代码误用相冲地支的方位 |
| 彭祖百忌 | 日干一句、日支一句 | `PENGZU_BY_STEM` / `PENGZU_BY_BRANCH` | 传统《彭祖百忌》原文 |
| 节气 | 视太阳黄经每 15° 一个交节时刻 | `solarTermInstantsForYear()`、`solarTermInfo()` | Meeus + VSOP87D 摄动，已对香港天文台表验证（见 README「天文与历法口径」） |

卡片把建除标为「建除」。「值神」在传统通书里指黄道黑道十二神（青龙、明堂、天刑……），留给后续阶段。
The card labels the officer 「建除」; 「值神」 is reserved for the 黄道黑道 twelve gods of a later stage.

### 给下一阶段的接口 / Helpers for the next stages

- `jieMonthInfo(date)` → `{ branchIdx, branch, monthIdx, jieYear, termIdx, termName, instant, today }`
  — `branchIdx` 为 `ZHI` 下标（0 子 … 11 亥），`monthIdx` 0 = 寅月 … 11 = 丑月，`today` 表示本日即交节日。
- `lichunYearGanzhi(date)`、`jieMonthGanzhi(date)`、`yearGanzhi(date)`、`dayGanzhi(date)`
- `jianchuOf(dayBranchIdx, monthBranchIdx)`、`shaDirectionOf(dayBranchIdx)`
- `solarTermsAround(date)`、`localDayBounds(date)`
- `computeAlmanac()` 在原有字段之外新增 `lichunYearGanzhi`、`monthGanzhi`（未显示）、`jieMonth`、`chong`、`sha`；
  原有字段（`yearGanzhi`、`dayGanzhi`、`jianchu`、`chongSha`、`yi`、`ji`、`jiShen`、`xiongShen`、`pengzu`、`termInfo`、`lunarLabel`）不变。

## 4. 仍是趣味随机 / Still pseudo-random

- **宜 / 忌**：`seededDailyPick(ALMANAC_YI / ALMANAC_JI, …)`，以儒略日数为种子，同一天总得同一组，但与择日规则无关。
- **吉神 / 凶神**：同样按日种子从十个名字中抽取，释义是本站自拟的一句话，不是传统神煞算法。
- 二者将在后续阶段（M3/M4）换成按《钦定协纪辨方书》推导的神煞与宜忌；本阶段刻意保持其种子与输出不变（有回归测试）。
- 卡片脚注「宜忌为趣味版 · 仅供参考」在此之前保留。

These two stay day-seeded until stages M3/M4 replace them with rule-derived 神煞 and 宜忌; their seeds and outputs are
deliberately unchanged in this stage (a regression test pins them).

## 5. 验证 / Verification

- **金标准数据 / Golden fixture**：`tests/fixtures/almanac-golden.json`，2025–2028 年每一天（1461 天，含 2025 闰六月、
  2028 闰五月）的农历年干支、立春年干支、月干支、日干支、建除、冲、煞、当日节气与农历日期。
- **生成 / Generator**：`scripts/almanac-golden.py`，独立实现为 [cnlunar](https://github.com/OPN48/cnLunar) 0.2.5
  （MIT 许可，© 2025 OPN48）。它用自带的春节表与按日节气表，方法与本站的 VSOP87D 求解器和 ICU 不同，且以北京时间计。
  cnlunar 只用于离线生成参考数据，代码和表格都未进入 `js/`。cnlunar 不计算煞方，脚本用 cnlunar 的日支查一张显式的
  三合方位表得到参考值（这验证的是取模算术，规则本身见上表出处）。
- **测试 / Tests**：`tests/almanac-golden.test.cjs` 在载入前固定 `TZ=Asia/Shanghai`，在任何机器上结果一致；逐日比对全部字段，
  并单列本文提到的例子（2026-01-01 乙巳、2026-12-07 平、2027-02-05 除、2026-11-24 冲猴煞北）。
  `tests/almanac.test.cjs` 不固定时区，只断言任何时区都成立的性质（节月恰在本地交节日前进一位、建除逐日前进且交节日重复、
  三合煞方、Intl 缺失时的年名回退、宜忌种子不变）。建议用 `TZ=Asia/Shanghai` 与 `TZ=America/New_York` 各跑一次。
- **重新生成 / Regenerate**：`pip install cnlunar==0.2.5 && python3 scripts/almanac-golden.py`。

### 比对中发现的差异 / Disagreements found

1. **cnlunar 的立春年在冬至后出错**：`year8Char='beginningOfSpring'` 在 12 月冬至至 12 月 31 日把年份减一
   （如 2025-12-25 给甲辰，应为乙巳）。脚本改用 cnlunar 自己的立春日期推出立春年，并断言这是两者唯一的差别。
2. **ICU 把 2027 年春节放在 2 月 7 日**：2027-02-06 的朔在 15:56 UTC，即北京时间 23:56，正月初一应为 2 月 6 日
   （cnlunar 与官方历书一致）。Node 22 自带的 ICU 78 农历精度不足，把整个丁未正月（2027-02-06 至 03-07）推迟一天。
   黄历卡的年名因此在 2027-02-06 显示丙午；同一误差也影响农历日期文字、春节/除夕/元宵等节日判断。
   测试用 `KNOWN_ICU_DEVIATIONS` 列出这一天（两种值都接受，出现任何新差异即失败）。根治需要自带精确朔望求解器，留待后续阶段。
3. 除以上两点，日干支、月干支、建除、冲、煞以及 96 个节气的落日在北京时间下与 cnlunar 逐日一致。
