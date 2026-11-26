# 黄历规则与口径 / Almanac rules and conventions

本文记录黄历卡（`js/app.js` 的 Almanac 一节，`computeAlmanac()`）每一项内容怎样算、按什么口径、出自哪里，
以及哪些仍是趣味随机、将在后续阶段替换。改动黄历代码时请同步修改本文。
择日规则（值神、神煞）的数据表在 `js/almanac-rules.js`（`NAM_ALMANAC`，纯计算，在 `app.js` 之前载入）。

This page documents how each line of the almanac card is computed, which conventions it follows, where each rule
comes from, and what is still a playful pseudo-random pick. Keep it in step with the code.

## 1. 三层结构 / Three layers

| 层 / Layer | 内容 | 状态 |
| --- | --- | --- |
| 天文历法 / Astronomical calendar | 节气交节时刻、干支纪日、农历日期、农历年、节月与立春年 | 精确计算（节气为分钟级求解器；农历日期用浏览器 Intl/ICU） |
| 择日规则 / Day-selection rules | 月干支、十二建除、黄道黑道值神、吉神凶神（神煞）、冲煞、彭祖百忌 | 全部按传统规则推算（神煞依《钦定协纪辨方书》，见 §3.2） |
| 宜忌 / Activities | 宜、忌 | 仍是按日种子的趣味随机，将由规则推导替换 |

上一层只依赖下一层：择日规则只读干支与节月（及节月所属季节、次日节气），不读农历月份；宜忌将来只读择日规则的结果。

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
4. **季节 / Seasons**：神煞中的「春夏秋冬」一律按节月：寅卯辰为春（立春至立夏前一日）、巳午未为夏、申酉戌为秋、亥子丑为冬。
   「土王用事」取四立（立春、立夏、立秋、立冬）交节日之前的 18 个本地日。/ Seasons follow the 节月; 土王用事 is the
   18 local days before each 四立 day.
5. **其他时区 / Other time zones**：一切按本地日判断。同一交节时刻在北京是 12 月 7 日、在纽约是 12 月 6 日，
   两地建除各自在本地交节日重复。这是有意的口径，不是误差。

## 3. 已实现的规则 / Rules implemented

### 3.1 历法与建除 / Calendar, officer and clash

| 项目 | 规则 | 代码 | 出处 / Source |
| --- | --- | --- | --- |
| 日干支 | 儒略日数 JDN + 49 取六十甲子（以 1949-10-01、2000-01-07 两个甲子日校准） | `julianDayNumber()`、`dayGanzhi()` | 六十甲子逐日循环，不受月份、闰月影响 |
| 农历年干支 | Intl 中国历 `formatToParts` 的 `relatedYear`；无则依次用 `yearName`、`year`（数值或 1–60 的序数）；无中国历时退回立春年 | `yearGanzhi()` | 旧代码读取不存在的 `year` 字段，2026-01-01 至 02-16 误显丙午，应为乙巳 |
| 节月（月建） | 十二「节」换月：立春寅、惊蛰卯、清明辰、立夏巳、芒种午、小暑未、立秋申、白露酉、寒露戌、立冬亥、大雪子、小寒丑；中气不换月 | `jieMonthInfo()` | 《钦定协纪辨方书》以节气定月建（择日家通例） |
| 立春年 | 立春交节日起为新的一年；小寒所开的丑月属上一年 | `jieMonthInfo().jieYear`、`lichunYearGanzhi()` | 同上 |
| 月干支 | 五虎遁：甲己之年丙作首，乙庚之岁戊为头，丙辛必定寻庚起，丁壬壬位顺行流，戊癸何方发，甲寅之上好追求 | `jieMonthGanzhi()` | 通行口诀；逐日与参考数据一致。卡片元信息行显示为「农历十月十六 · 丙午年 己亥月」（年为农历年，月为节月） |
| 十二建除 | 日支与节月月支相同为「建」，顺数除满平定执破危成收开闭；交节日月支前进一位、日支也前进一位，故交节日与前一日同名 | `jianchuOf()` | 《淮南子·天文训》；《钦定协纪辨方书》建除十二神条 |
| 黄道黑道值神 | 青龙 明堂 天刑 朱雀 金匮 天德 白虎 玉堂 天牢 玄武 司命 勾陈 按日支顺排；青龙起点：寅申月子、卯酉月寅、辰戌月辰、巳亥月午、子午月申、丑未月戌。黄道 = 青龙 明堂 金匮 天德 玉堂 司命 | `NAM_ALMANAC.zhiShenOf()` | 《钦定协纪辨方书》黄道黑道条；用节月月支。卡片显示「值神 青龙（黄道）」，与「建除」分列 |
| 冲 | 地支六冲：日支 +6 的生肖 | `computeAlmanac().chong` | 子午、丑未、寅申、卯酉、辰戌、巳亥相冲 |
| 煞方 | 按日支三合局：申子辰煞南、巳酉丑煞东、寅午戌煞北、亥卯未煞西 | `shaDirectionOf()` | 《钦定协纪辨方书》劫煞、灾煞、岁煞（三煞）按年支三合定方位，通书以日支同法印「冲X煞Y」。旧代码误用相冲地支的方位 |
| 彭祖百忌 | 日干一句、日支一句 | `PENGZU_BY_STEM` / `PENGZU_BY_BRANCH` | 传统《彭祖百忌》原文 |
| 节气 | 视太阳黄经每 15° 一个交节时刻 | `solarTermInstantsForYear()`、`solarTermInfo()` | Meeus + VSOP87D 摄动，已对香港天文台表验证（见 README「天文与历法口径」） |

卡片把建除标为「建除」，「值神」专指黄道黑道十二神，两者并列显示。
The card labels the officer 「建除」 and shows the 黄道黑道 god separately as 「值神」.

### 3.2 吉神 / 凶神（神煞）

依《钦定协纪辨方书》义例各条（主要在卷四至卷六）及其月表。每位神煞在 `js/almanac-rules.js` 里是一行：
一张按「正月…十二月」或「春夏秋冬」排列的表（或一个很小的判断式），上方注释写明书中规则。输入只有节月序号与月支、
节月季节、日干、日支、日干支，以及次日的节气（四离、四绝）与是否土王用事（母仓）。卡片按表中固定次序列出当日命中的神煞。

**吉神（33）**：天德、天德合、月德、月德合、天赦、天恩、月恩、四相、时德、王日、官日、守日、相日、民日、天愿、天喜、母仓、
月空、三合、六合、五合、五富、驿马、天马、阳德、阴德、生气、益后、续世、要安、玉宇、金堂、解神。

**凶神（39）**：月破、大耗、小耗、月厌、地火、厌对、天吏、河魁、天罡、月刑、月害、月煞、灾煞、劫煞、四击、四废、四忌、四穷、
四离、四绝、五离、往亡、归忌、血支、血忌、重日、复日、天贼、九空、九坎、九焦、土符、大时、游祸、五虚、八专、死神、死气、天火。

规则要点（完整表见代码注释）：

| 类别 | 神煞与规则 |
| --- | --- |
| 按月德系 | 天德：正丁 二申 三壬 四辛 五亥 六甲 七癸 八寅 九丙 十乙 十一巳 十二庚（二五八十一月本为坤乾艮巽，日用取申亥寅巳，见口诀「正丁二申宫……子巽丑庚中」）；天德合：其干之合，坤乾艮巽之月无合；月德：寅午戌月丙、亥卯未月甲、申子辰月壬、巳酉丑月庚；月德合：辛己丁乙；月空：壬庚丙甲 |
| 按季节 | 天赦（春戊寅 夏甲午 秋戊申 冬甲子）、四相（王相之干）、时德、王官守相民日、母仓（生我之支，另加土王用事后巳午日）、四击、四废、四忌、四穷、五虚 |
| 按月支关系（多为四月一周） | 三合（月建三合的另两支，不含建日本身）、六合、月害、月刑、驿马、月煞、灾煞、劫煞、九空、大时、天吏、游祸、五富、天火 |
| 按建除位置 | 月破与大耗＝破日，小耗＝执日，死神＝平日，死气＝定日，天喜＝成日，生气＝开日，血支＝闭日 |
| 逐月一表 | 月恩、天愿、天马、阳德、阴德、益后、续世、要安、玉宇、金堂、解神、月厌、地火、厌对、河魁、天罡、往亡、归忌、血忌、复日（月建本气之干：寅甲 卯乙 辰戊 巳丙 午丁 未己 申庚 酉辛 戌戊 亥壬 子癸 丑己）、天贼（正丑逆行）、九坎、九焦、土符 |
| 与月无关 | 天恩（十五个日干支）、五合（寅卯日）、五离（申酉日）、重日（巳亥日）、八专（丁未 己未 庚申 甲寅 癸丑） |
| 按次日节气 | 四离（春分 夏至 秋分 冬至前一日）、四绝（四立前一日），按本地日判断 |

取舍 / Choices:

- **与值神不重复**：黄道黑道十二神（青龙、明堂……勾陈）只作「值神」显示，不再列入吉神凶神（cnlunar 把朱雀、白虎、玄武、勾陈
  也列进凶神，我们不重复）。唯一同名的是吉神「天德」：它是月表的天德（正丁二申……），与黄道「天德」是两位神，故两处都可能出现。
- **有意未做 / Left out**：不将、鸣吠（成表繁复，我们无法逐条确认）；岁神（岁德、岁破等按年干支，不属日表）；
  天医、天巫、福德、天仓、兵福等通书杂神；民间「红沙」「杨公忌」「受死」等不出自协纪的忌日；「致死」（无法确认它在协纪中的独立定义）。
- **八专**取协纪所列五日（丁未 己未 庚申 甲寅 癸丑），不取《三命通会》等书的八日之说。
- **天贼**有两种口诀流传；取「正丑逆行」（与参考实现一致），另一说（正辰、每月进五辰）未采用。

The 黄道黑道 gods are shown once, as 值神, and never repeated in the 吉神/凶神 rows; the month-table 天德 is a different
god from the 黄道 天德 and may appear in both places. 不将 and 鸣吠 are left out because we could not pin their tables
down exactly.

### 3.3 卡片显示 / Card layout

- 元信息行：「农历十月十六 · 丙午年 己亥月」；大字仍为日干支。
- 「节气 · 建除 · 值神」一行，冲煞随后。
- 吉神、凶神各一行，只列名字（一天通常各 2–6 个，最多各 9 个），名字不断行；每个名字的 `title` 是释义（悬停可见）。
- 「全文」入口打开阅读弹窗，逐条列出「名字：释义」。释义是本站自拟的一句白话概括，不是古书原文。

### 3.4 给下一阶段的接口 / Helpers for the next stages

- `jieMonthInfo(date)` → `{ branchIdx, branch, monthIdx, jieYear, termIdx, termName, instant, today }`
  — `branchIdx` 为 `ZHI` 下标（0 子 … 11 亥），`monthIdx` 0 = 寅月 … 11 = 丑月，`today` 表示本日即交节日。
- `lichunYearGanzhi(date)`、`jieMonthGanzhi(date)`、`yearGanzhi(date)`、`dayGanzhi(date)`
- `jianchuOf(dayBranchIdx, monthBranchIdx)`、`shaDirectionOf(dayBranchIdx)`
- `solarTermsAround(date)`、`localDayBounds(date)`
- `NAM_ALMANAC.zhiShenOf(dayBranchIdx, monthBranchIdx)` → `{ name, huangdao }`；`NAM_ALMANAC.dayGods(ctx)` → `{ ji, xiong }`；
  `NAM_ALMANAC.ZHISHEN`、`JI_NAMES`、`XIONG_NAMES`（全部可能的名字，按显示次序）。
- `almanacRuleContext(date, dayGanzhi, jieMonthInfo)` → 规则读取的上下文 `{ m, mb, season, s, b, gz, eve, tuWang }`；
  `tuWangYongShi(date)`。
- `computeAlmanac()` 另有 `zhiShen`（`{ name, huangdao }`），`jiShen` / `xiongShen` 为当日全部神煞 `[{ name, gloss }]`；
  M4 合成宜忌所需的建除、值神与完整神煞都已在这里。
- `almanacFullText(almanac)`：全文弹窗的纯文本。
- （M1）`computeAlmanac()` 在原有字段之外新增 `lichunYearGanzhi`、`monthGanzhi`、`jieMonth`、`chong`、`sha`；
  原有字段（`yearGanzhi`、`dayGanzhi`、`jianchu`、`chongSha`、`yi`、`ji`、`jiShen`、`xiongShen`、`pengzu`、`termInfo`、`lunarLabel`）不变。

## 4. 仍是趣味随机 / Still pseudo-random

- **宜 / 忌**：`seededDailyPick(ALMANAC_YI / ALMANAC_JI, …)`，以儒略日数为种子，同一天总得同一组，但与择日规则无关。
  将在 M4 由建除、值神与神煞推导；在此之前刻意保持种子与输出不变（有回归测试），卡片脚注「宜忌为趣味版 · 仅供参考」保留。
- **吉神 / 凶神已不再随机**（M3 起按规则推算，见 §3.2）。旧的十个名字的种子抽取已删除。

Only 宜/忌 remain day-seeded (stage M4 replaces them); 吉神/凶神 are rule-derived since M3.

## 5. 验证 / Verification

- **金标准数据 / Golden fixture**：`tests/fixtures/almanac-golden.json`，2025–2028 年每一天（1461 天，含 2025 闰六月、
  2028 闰五月）的农历年干支、立春年干支、月干支、日干支、建除、冲、煞、当日节气、农历日期，以及黄道黑道值神
  （cnlunar `today12DayGod`，其「金贵」写法统一为「金匮」）和 cnlunar 的全部吉神、凶神名（`goodGodName` / `badGodName`）。
- **生成 / Generator**：`scripts/almanac-golden.py`，独立实现为 [cnlunar](https://github.com/OPN48/cnLunar) 0.2.5
  （MIT 许可，© 2025 OPN48）。它用自带的春节表与按日节气表，方法与本站的 VSOP87D 求解器和 ICU 不同，且以北京时间计。
  cnlunar 只用于离线生成参考数据，代码和表格都未进入 `js/`。cnlunar 不计算煞方，脚本用 cnlunar 的日支查一张显式的
  三合方位表得到参考值（这验证的是取模算术，规则本身见上表出处）。
- **测试 / Tests**：`tests/almanac-golden.test.cjs` 在载入前固定 `TZ=Asia/Shanghai`，在任何机器上结果一致；逐日比对全部字段，
  并单列本文提到的例子（2026-01-01 乙巳、2026-12-07 平、2027-02-05 除、2026-11-24 冲猴煞北）。
  `tests/almanac.test.cjs` 不固定时区，只断言任何时区都成立的性质（节月恰在本地交节日前进一位、建除逐日前进且交节日重复、
  三合煞方、Intl 缺失时的年名回退、宜忌种子不变）。建议用 `TZ=Asia/Shanghai` 与 `TZ=America/New_York` 各跑一次。
- **重新生成 / Regenerate**：`pip install cnlunar==0.2.5 && python3 scripts/almanac-golden.py`。
  cnlunar 的代码与表格从未拷入 `js/`；神煞表按协纪原文自行编写，再拿 cnlunar 的输出逐日核对。

### 比对中发现的差异 / Disagreements found

1. **cnlunar 的立春年在冬至后出错**：`year8Char='beginningOfSpring'` 在 12 月冬至至 12 月 31 日把年份减一
   （如 2025-12-25 给甲辰，应为乙巳）。脚本改用 cnlunar 自己的立春日期推出立春年，并断言这是两者唯一的差别。
2. **ICU 把 2027 年春节放在 2 月 7 日**：2027-02-06 的朔在 15:56 UTC，即北京时间 23:56，正月初一应为 2 月 6 日
   （cnlunar 与官方历书一致）。Node 22 自带的 ICU 78 农历精度不足，把整个丁未正月（2027-02-06 至 03-07）推迟一天。
   黄历卡的年名因此在 2027-02-06 显示丙午；同一误差也影响农历日期文字、春节/除夕/元宵等节日判断。
   测试用 `KNOWN_ICU_DEVIATIONS` 列出这一天（两种值都接受，出现任何新差异即失败）。根治需要自带精确朔望求解器，留待后续阶段。
3. 除以上两点，日干支、月干支、建除、值神、冲、煞以及 96 个节气的落日在北京时间下与 cnlunar 逐日一致。

### 神煞逐日比对 / Per-god agreement (1461 days, Beijing time)

`tests/almanac-golden.test.cjs` 对我们实现的每一位神煞，逐日比较「有/无」是否与 cnlunar 相同。
cnlunar 的神煞同样按八字月柱（节月）计算，口径一致。结果：

- 72 位中 67 位与 cnlunar **逐日 100% 一致**；「土王用事」窗口（四立前十八日）也逐日一致。
- **阳德**：cnlunar 不计算；按协纪「正戌、二子、三寅、四辰、五午、六申，周而复始」手工核对若干日期并写入测试
  （2025-02-10 庚戌寅月、2025-03-08 丙子卯月、2025-01-01 庚午子月有，相邻日无）。
- 以下四位有已知差异，测试用 `KNOWN_REFERENCE_DEVIATIONS` 逐条限定形态，任何其他差异都会失败：

| 神煞 | 原始一致率 | 差异 | 我们的依据 |
| --- | --- | --- | --- |
| 天德 | 1421/1461（97.3%） | 二、五、八、十一月 cnlunar 另把未、戌、丑、辰日也算天德 | 这四个月的天德是卦（坤乾艮巽），通行口诀「正丁二申宫……五亥……八寅……子巽」日用只取申、亥、寅、巳一支 |
| 三合 | 1340/1461（91.7%） | cnlunar 把建日（日支＝月支）也算三合 | 协纪：「正月午戌、二月亥未……」，三合是月建与另两支相合，不含月建本身 |
| 母仓 | 1412/1461（96.6%） | 我们在土王用事期间另加巳、午日 | 协纪母仓条「又土王用事后巳午日」，cnlunar 未实现此句 |
| 复日 | 1417/1461（97.0%） | 六月、十二月 cnlunar 标在巳日，我们标在己日 | 复日取月建本气之干，未、丑本气为己；cnlunar 表中此处为「巳」，是巳/己形近之误 |

Every implemented god agrees with cnlunar on 100% of days except the four above, each whitelisted by an exact pattern
with the reason given; 阳德, which cnlunar lacks, is checked by hand on explicit dates.

在 Asia/Shanghai、America/New_York、UTC 三个时区下，`tests/almanac.test.cjs` 另行检查与时区无关的性质：值神每日进一位、
交节日退一位；四离/四绝恰在本地分至/四立的前一日；土王用事恰为四立前 18 日；破日必有月破大耗、开日必有生气、平日必有死神。
