/* Now, and More — almanac day-selection rules (择日规则层).
   黄道黑道十二值神, the day 神煞 (吉神 / 凶神) and the 宜/忌 they give
   (yiJi, the second half of this file) of the 黄历 card, after
   《钦定协纪辨方书》 (1741): its 义例 chapters (each god's definition,
   mostly 卷四–卷六) and the 月表 / 日表 that tabulate them; each comment
   below gives the rule as the book states it. Rules, sources and the verification
   against an independent reference: docs/almanac-rules.md.

   Every rule reads only the 干支 calendar of the day, never the lunar
   month: the 节月 (monthIdx 0 = 寅月 from 立春 … 11 = 丑月, its branch),
   the season of that 节月 (寅卯辰 spring … 亥子丑 winter), and the day's
   stem and branch — plus, for 四离/四绝 and 母仓's 土王用事 clause, which
   term falls on the next day. app.js builds that context
   (almanacRuleContext) and asks dayGods(ctx); nothing here touches the DOM.

   Tables are written in month order 正月 (寅) … 十二月 (丑), or season
   order 春 夏 秋 冬, exactly as the 月表 print them, so each row can be
   checked by eye against the book. "·" marks a month with no entry. */
"use strict";

const NAM_ALMANAC = (() => {
  const GAN = "甲乙丙丁戊己庚辛壬癸";
  const ZHI = "子丑寅卯辰巳午未申酉戌亥";

  /* ---------- 黄道黑道十二值神 ----------
     《协纪辨方书·义例·黄道黑道》: the twelve run 青龙 明堂 天刑 朱雀 金匮
     天德 白虎 玉堂 天牢 玄武 司命 勾陈 in day-branch order, 青龙 starting
     on 子 in 寅/申月, 寅 in 卯/酉月, 辰 in 辰/戌月, 午 in 巳/亥月, 申 in
     子/午月, 戌 in 丑/未月 (青龙口诀 「子午寻申位，丑未戌上亲，寅申居子中，
     卯酉起于寅，辰戌龙位上，巳亥午中寻」). 黄道 = 青龙 明堂 金匮 天德 玉堂
     司命 (「道远几时通达，路遥何日还乡」, the six characters with 辶). */
  const ZHISHEN = ["青龙", "明堂", "天刑", "朱雀", "金匮", "天德", "白虎", "玉堂", "天牢", "玄武", "司命", "勾陈"];
  const HUANGDAO = new Set(["青龙", "明堂", "金匮", "天德", "玉堂", "司命"]);
  const QINGLONG_FROM_YIN = "子寅辰午申戌"; // month 寅 卯 辰 巳 午 未, repeating for 申 … 丑
  function zhiShenOf(dayBranchIdx, monthBranchIdx) {
    const start = ZHI.indexOf(QINGLONG_FROM_YIN[((monthBranchIdx - 2) % 6 + 6) % 6]);
    const name = ZHISHEN[((dayBranchIdx - start) % 12 + 12) % 12];
    return { name, huangdao: HUANGDAO.has(name) };
  }

  /* ---------- predicates over the day context ----------
     ctx = { m: 节月 index (0 = 寅月), mb: month branch index,
             season: 0 春 1 夏 2 秋 3 冬, s: day stem index,
             b: day branch index, gz: day ganzhi, eve: name of the term
             crossing on the NEXT local day or "", tuWang: true while 土王用事 } */
  const stem = (c) => GAN[c.s];
  const branch = (c) => ZHI[c.b];
  // The month's entry is the day's stem or branch (stems and branches never share a character).
  const byMonth = (table) => (c) => table[c.m] !== "·" && (table[c.m] === stem(c) || table[c.m] === branch(c));
  // The day's branch is one of the season's branches / the day's stem one of its stems.
  const bySeason = (table) => (c) => table[c.season].includes(branch(c)) || table[c.season].includes(stem(c));
  // The whole day ganzhi is listed for the season / the month.
  const daysBySeason = (table) => (c) => table[c.season].split(" ").includes(c.gz);
  const daysByMonth = (table) => (c) => table[c.m] === c.gz;
  // The day branch stands k places after the month branch, i.e. on a fixed 建除 day.
  const fromJian = (k) => (c) => (c.b - c.mb + 12) % 12 === k;
  // The month table repeats every four months (one 三合 group per position: 寅午戌, 亥卯未, 申子辰, 巳酉丑).
  const byTrine = (four) => (c) => four[c.m % 4] === branch(c) || four[c.m % 4] === stem(c);

  /* ---------- 吉神 ----------
     One entry per god: the table (or predicate), the source line, and a
     one-line plain gloss in our own words. */
  const JI = [
    // 天德: 正丁 二坤 三壬 四辛 五乾 六甲 七癸 八艮 九丙 十乙 十一巽 十二庚; for days the
    // four 卦 are read as their 支 申 亥 寅 巳 (口诀 「正丁二申宫，三壬四辛同，五亥六甲上，七癸八寅逢，九丙十归乙，子巽丑庚中」).
    { name: "天德", gloss: "上天福德所在，百事可用", hit: byMonth("丁申壬辛亥甲癸寅丙乙巳庚") },
    // 天德合: the 五合 partner of a 天德 stem; the 卦 months (二 五 八 十一) have none.
    { name: "天德合", gloss: "与天德相合，福力相近", hit: byMonth("壬·丁丙·己戊·辛庚·乙") },
    // 月德: the 阳干 of the month's 三合 element — 寅午戌 丙, 亥卯未 甲, 申子辰 壬, 巳酉丑 庚.
    { name: "月德", gloss: "一月之德神，主和顺", hit: byTrine("丙甲壬庚") },
    // 月德合: the 五合 partner of 月德 — 丙辛, 甲己, 壬丁, 庚乙.
    { name: "月德合", gloss: "与月德相合，宜和合之事", hit: byTrine("辛己丁乙") },
    // 天赦: 春戊寅 夏甲午 秋戊申 冬甲子.
    { name: "天赦", gloss: "上天赦宥之日，四季各一", hit: daysBySeason(["戊寅", "甲午", "戊申", "甲子"]) },
    // 天恩: 甲子至戊辰、己卯至癸未、己酉至癸丑，凡十五日（不论月）.
    { name: "天恩", gloss: "上天施恩之日，宜施惠行善", hit: (c) => TIANEN.has(c.gz) },
    // 月恩: 正丙 二丁 三庚 四己 五戊 六辛 七壬 八癸 九庚 十乙 十一甲 十二辛.
    { name: "月恩", gloss: "月中恩泽之日", hit: byMonth("丙丁庚己戊辛壬癸庚乙甲辛") },
    // 四相: 四时王相之干 — 春丙丁 夏戊己 秋壬癸 冬甲乙.
    { name: "四相", gloss: "得四时生旺之气", hit: bySeason(["丙丁", "戊己", "壬癸", "甲乙"]) },
    // 时德: 春午 夏辰 秋子 冬寅.
    { name: "时德", gloss: "四时得令之德，宜宴乐交好", hit: bySeason(["午", "辰", "子", "寅"]) },
    // 王日 官日 守日 相日 民日 (四时 by the 节月's season).
    { name: "王日", gloss: "四时当王之辰，宜立事", hit: bySeason(["寅", "巳", "申", "亥"]) },
    { name: "官日", gloss: "宜上任、临政", hit: bySeason(["卯", "午", "酉", "子"]) },
    { name: "守日", gloss: "宜守成、安居", hit: bySeason(["酉", "子", "卯", "午"]) },
    { name: "相日", gloss: "宜辅佐、谋事", hit: bySeason(["巳", "申", "亥", "寅"]) },
    { name: "民日", gloss: "宜安民、营生", hit: bySeason(["午", "酉", "子", "卯"]) },
    // 天愿: 正乙亥 二甲戌 三乙酉 四丙申 五丁未 六戊午 七己巳 八庚辰 九辛卯 十壬寅 十一癸丑 十二甲子.
    { name: "天愿", gloss: "月日相得，宜嫁娶、纳财", hit: daysByMonth(["乙亥", "甲戌", "乙酉", "丙申", "丁未", "戊午", "己巳", "庚辰", "辛卯", "壬寅", "癸丑", "甲子"]) },
    // 天喜: 正戌，顺行十二辰 (= 成日).
    { name: "天喜", gloss: "主喜庆", hit: fromJian(8) },
    // 母仓: 生我者为母 — 春亥子 夏寅卯 秋辰戌丑未 冬申酉；又土王用事后巳午日.
    { name: "母仓", gloss: "生我之辰，宜纳财、养育", hit: (c) => bySeason(["亥子", "寅卯", "辰戌丑未", "申酉"])(c) || (c.tuWang && (branch(c) === "巳" || branch(c) === "午")) },
    // 月空: 月德所冲之干 — 寅午戌 壬, 亥卯未 庚, 申子辰 丙, 巳酉丑 甲.
    { name: "月空", gloss: "宜上书陈策", hit: byTrine("壬庚丙甲") },
    // 三合: 日支与月建三合 (正月 午 戌).
    { name: "三合", gloss: "日与月建三合，主和合", hit: (c) => { const d = (c.b - c.mb + 12) % 12; return d === 4 || d === 8; } },
    // 六合: 日支与月建六合 (子丑 寅亥 卯戌 辰酉 巳申 午未).
    { name: "六合", gloss: "日与月建六合，宜结交", hit: (c) => (c.b + c.mb) % 12 === 1 },
    // 五合: 寅卯日 — 甲寅乙卯日月合, 丙寅丁卯阴阳合, 戊寅己卯人民合, 庚寅辛卯金石合, 壬寅癸卯江河合.
    { name: "五合", gloss: "阴阳和合，宜宴会、交易", hit: (c) => branch(c) === "寅" || branch(c) === "卯" },
    // 五富: 正亥 二寅 三巳 四申，周而复始.
    { name: "五富", gloss: "主丰盈富足", hit: byTrine("亥寅巳申") },
    // 驿马: 月建三合之马 — 寅午戌 申, 亥卯未 巳, 申子辰 寅, 巳酉丑 亥.
    { name: "驿马", gloss: "主奔走迁动，宜出行", hit: byTrine("申巳寅亥") },
    // 天马: 正午 二申 三戌 四子 五寅 六辰，周而复始.
    { name: "天马", gloss: "主出行顺遂", hit: byMonth("午申戌子寅辰午申戌子寅辰") },
    // 阳德: 正戌 二子 三寅 四辰 五午 六申，周而复始.
    { name: "阳德", gloss: "阳中德善之辰，宜行善", hit: byMonth("戌子寅辰午申戌子寅辰午申") },
    // 阴德: 正酉 二未 三巳 四卯 五丑 六亥，周而复始.
    { name: "阴德", gloss: "阴中德善之辰，宜施恩、雪冤", hit: byMonth("酉未巳卯丑亥酉未巳卯丑亥") },
    // 生气: 正子，顺行十二辰 (= 开日).
    { name: "生气", gloss: "生发之气，宜种植、修造", hit: fromJian(10) },
    // 益后 续世 要安 玉宇 金堂: 正月起子、二月起午，单月顺子丑寅…、双月顺午未申…; each next god one 辰 later.
    { name: "益后", gloss: "主利在后嗣", hit: byMonth("子午丑未寅申卯酉辰戌巳亥") },
    { name: "续世", gloss: "主承续延绵", hit: byMonth("丑未寅申卯酉辰戌巳亥午子") },
    { name: "要安", gloss: "主安稳", hit: byMonth("寅申卯酉辰戌巳亥午子未丑") },
    { name: "玉宇", gloss: "主居处安宁", hit: byMonth("卯酉辰戌巳亥午子未丑申寅") },
    { name: "金堂", gloss: "主宅舍兴旺", hit: byMonth("辰戌巳亥午子未丑申寅酉卯") },
    // 解神: 正二月申 三四月戌 五六月子 七八月寅 九十月辰 十一十二月午.
    { name: "解神", gloss: "主解除灾厄", hit: byMonth("申申戌戌子子寅寅辰辰午午") },
  ];
  const TIANEN = new Set(["甲子", "乙丑", "丙寅", "丁卯", "戊辰", "己卯", "庚辰", "辛巳", "壬午", "癸未", "己酉", "庚戌", "辛亥", "壬子", "癸丑"]);

  /* ---------- 凶神 ---------- */
  const XIONG = [
    // 月破: 日冲月建 (= 破日). 大耗 sits on the same 辰 (正月申，顺行).
    { name: "月破", gloss: "日冲月建，大事不宜", hit: fromJian(6) },
    { name: "大耗", gloss: "主耗散，忌出财", hit: fromJian(6) },
    // 小耗: 正未，顺行十二辰 (月破前一辰).
    { name: "小耗", gloss: "主小有耗损", hit: fromJian(5) },
    // 月厌: 正戌，逆行十二辰. 地火 runs with it.
    { name: "月厌", gloss: "月中厌恶之辰，忌嫁娶、出行", hit: byMonth("戌酉申未午巳辰卯寅丑子亥") },
    { name: "地火", gloss: "忌栽种、修筑", hit: byMonth("戌酉申未午巳辰卯寅丑子亥") },
    // 厌对: 月厌所冲 (正辰，逆行).
    { name: "厌对", gloss: "月厌所冲，忌嫁娶", hit: byMonth("辰卯寅丑子亥戌酉申未午巳") },
    // 天吏: 正酉 二午 三卯 四子，周而复始.
    { name: "天吏", gloss: "忌赴任、远行", hit: byTrine("酉午卯子") },
    // 河魁 / 天罡: 正亥 / 正巳，每月进七辰 (二者相冲).
    { name: "河魁", gloss: "主勾绞不利", hit: byMonth("亥午丑申卯戌巳子未寅酉辰") },
    { name: "天罡", gloss: "主刚戾，诸事少宜", hit: byMonth("巳子未寅酉辰亥午丑申卯戌") },
    // 月刑: 月建所刑 — 寅刑巳 卯刑子 辰自刑 巳刑申 午自刑 未刑丑 申刑寅 酉自刑 戌刑未 亥自刑 子刑卯 丑刑戌.
    { name: "月刑", gloss: "日与月建相刑", hit: byMonth("巳子辰申午丑寅酉未亥卯戌") },
    // 月害: 月建所害 (子未 丑午 寅巳 卯辰 申亥 酉戌).
    { name: "月害", gloss: "日与月建相害，忌交易、结交", hit: (c) => (c.b + c.mb) % 12 === 7 },
    // 月煞 / 灾煞 / 劫煞: 月建三合之煞 — 寅午戌月 丑 / 子 / 亥, 亥卯未月 戌 / 酉 / 申, 申子辰月 未 / 午 / 巳, 巳酉丑月 辰 / 卯 / 寅.
    { name: "月煞", gloss: "月内三合之煞", hit: byTrine("丑戌未辰") },
    { name: "灾煞", gloss: "主灾患", hit: byTrine("子酉午卯") },
    { name: "劫煞", gloss: "主劫夺", hit: byTrine("亥申巳寅") },
    // 四击: 春戌 夏丑 秋辰 冬未.
    { name: "四击", gloss: "冲四时墓库，忌远行", hit: bySeason(["戌", "丑", "辰", "未"]) },
    // 四废: 春庚申辛酉 夏壬子癸亥 秋甲寅乙卯 冬丙午丁巳.
    { name: "四废", gloss: "四时休废之日，百事少宜", hit: daysBySeason(["庚申 辛酉", "壬子 癸亥", "甲寅 乙卯", "丙午 丁巳"]) },
    // 四忌: 春甲子 夏丙子 秋庚子 冬壬子. 四穷: 春乙亥 夏丁亥 秋辛亥 冬癸亥.
    { name: "四忌", gloss: "四时所忌，忌嫁娶、安葬", hit: daysBySeason(["甲子", "丙子", "庚子", "壬子"]) },
    { name: "四穷", gloss: "四时穷尽之日，忌纳财", hit: daysBySeason(["乙亥", "丁亥", "辛亥", "癸亥"]) },
    // 四离 / 四绝: 春分 夏至 秋分 冬至前一日 / 立春 立夏 立秋 立冬前一日.
    { name: "四离", gloss: "分至前一日，大事勿用", hit: (c) => ["春分", "夏至", "秋分", "冬至"].includes(c.eve) },
    { name: "四绝", gloss: "四立前一日，忌出行、上任", hit: (c) => ["立春", "立夏", "立秋", "立冬"].includes(c.eve) },
    // 五离: 申酉日 (甲申乙酉 天地离 … 壬申癸酉 江河离).
    { name: "五离", gloss: "主离散，忌结交、会亲", hit: (c) => branch(c) === "申" || branch(c) === "酉" },
    // 往亡: 正寅 二巳 三申 四亥 五卯 六午 七酉 八子 九辰 十未 十一戌 十二丑.
    { name: "往亡", gloss: "主往而不返，忌出行、迁徙", hit: byMonth("寅巳申亥卯午酉子辰未戌丑") },
    // 归忌: 孟月丑 仲月寅 季月子.
    { name: "归忌", gloss: "忌远归、入宅", hit: byMonth("丑寅子丑寅子丑寅子丑寅子") },
    // 血支: 正丑，顺行十二辰 (= 闭日). 血忌: 正丑 二未 三寅 四申 五卯 六酉 七辰 八戌 九巳 十亥 十一午 十二子.
    { name: "血支", gloss: "忌针刺、见血", hit: fromJian(11) },
    { name: "血忌", gloss: "忌针灸、刺血", hit: byMonth("丑未寅申卯酉辰戌巳亥午子") },
    // 重日: 巳亥日.
    { name: "重日", gloss: "阴阳重叠，忌丧葬", hit: (c) => branch(c) === "巳" || branch(c) === "亥" },
    // 复日: 《历例》「正七月甲庚，二八月乙辛，四十月丙壬，五十一月丁癸，三九六十二月戊己」,
    // read month by month as the 本气 stem of the month branch (寅甲 卯乙 辰戊 巳丙 午丁 未己 申庚 酉辛 戌戊 亥壬 子癸 丑己).
    { name: "复日", gloss: "主重复，忌丧葬", hit: byMonth("甲乙戊丙丁己庚辛戊壬癸己") },
    // 天贼: 正丑，逆行十二辰 (正丑 二子 三亥 … 十二寅).
    { name: "天贼", gloss: "主盗失，忌出行、开仓", hit: byMonth("丑子亥戌酉申未午巳辰卯寅") },
    // 九空: 正辰 二丑 三戌 四未，周而复始 (三合墓库之冲).
    { name: "九空", gloss: "主空亡，忌进财、出行", hit: byTrine("辰丑戌未") },
    // 九坎 / 九焦: 正辰 二丑 三戌 四未 五卯 六子 七酉 八午 九寅 十亥 十一申 十二巳.
    { name: "九坎", gloss: "忌乘船、筑墙", hit: byMonth("辰丑戌未卯子酉午寅亥申巳") },
    { name: "九焦", gloss: "忌种植、鼓铸", hit: byMonth("辰丑戌未卯子酉午寅亥申巳") },
    // 土符: 正丑 二巳 三酉 四寅 五午 六戌 七卯 八未 九亥 十辰 十一申 十二子.
    { name: "土符", gloss: "忌动土、修筑", hit: byMonth("丑巳酉寅午戌卯未亥辰申子") },
    // 大时: 正卯 二子 三酉 四午，周而复始 (月建三合之沐浴).
    { name: "大时", gloss: "主时气大败，忌出师", hit: byTrine("卯子酉午") },
    // 游祸: 正巳 二寅 三亥 四申，周而复始.
    { name: "游祸", gloss: "忌服药、祈福", hit: byTrine("巳寅亥申") },
    // 五虚: 春巳酉丑 夏申子辰 秋亥卯未 冬寅午戌.
    { name: "五虚", gloss: "主空虚，忌开仓、纳财", hit: bySeason(["巳酉丑", "申子辰", "亥卯未", "寅午戌"]) },
    // 八专: 丁未 己未 庚申 甲寅 癸丑 — the five days 协纪 lists (干支同气). Other books
    // (e.g. 《三命通会》) add 乙卯 辛酉 戊戌 to make eight; we follow 协纪.
    { name: "八专", gloss: "干支同气，忌嫁娶、出军", hit: (c) => BAZHUAN.has(c.gz) },
    // 死神: 正巳，顺行十二辰 (= 平日). 死气: 正午，顺行 (生气所冲, = 定日).
    { name: "死神", gloss: "忌服药、问病", hit: fromJian(3) },
    { name: "死气", gloss: "主衰杀，忌种植", hit: fromJian(4) },
    // 天火: 正子 二卯 三午 四酉，周而复始.
    { name: "天火", gloss: "忌苫盖、修造", hit: byTrine("子卯午酉") },
  ];
  const BAZHUAN = new Set(["丁未", "己未", "庚申", "甲寅", "癸丑"]);

  /* All gods of a day, each list in the fixed order above. */
  function dayGods(ctx) {
    const pick = (list) => list.filter((g) => g.hit(ctx)).map((g) => ({ name: g.name, gloss: g.gloss }));
    return { ji: pick(JI), xiong: pick(XIONG) };
  }

  /* =====================================================================
     宜忌 — which 用事 the day 宜 and 忌, synthesised from the day's 建除,
     吉神 and 凶神 (and a few fixed special days), after 《协纪辨方书》:
       卷十「宜忌」  god by god: the 用事 each 吉神 宜 and each 凶神 忌, and
                     how they settle when they meet (「與…併則不忌」「猶忌」,
                     and for the great 凶煞 the six 等第 month by month);
       卷十「鋪註條例」 the printer's rules for writing 宜/忌 under a day;
       卷十一「用事」 the same table read activity by activity (used to
                     cross-check the god rows below; see docs/almanac-rules.md).
     Nothing here is random: the same day facts always give the same lists.
     Everything is restricted to the YONGSHI vocabulary; a god whose 用事
     all lie outside it (月空 上表章, 阳德 施恩惠…, 血支 针刺…) simply
     contributes nothing. 值神 (黄道/黑道) has no 宜忌 of its own (卷十:
     「與吉神併則從所宜，與凶神併則從所忌」, 「無專宜之事…亦無專忌之事」).
     ===================================================================== */

  /* 用事 vocabulary: a 通书 民用 subset (卷十一 「民用三十七事」, with 祈福
     求嗣 解除 from the 御用/通书 lists), in the book's order of 用事, which is
     also the order the card prints them in. `book` is the row of 卷十/卷十一 the
     item stands for where the name differs. Glosses are our own words. */
  const YONGSHI = [
    { name: "祭祀", gloss: "祭神祀祖" },
    { name: "祈福", gloss: "祈求福佑" },
    { name: "求嗣", gloss: "祈求子嗣" },
    { name: "会亲友", gloss: "宴请、走亲访友", book: "宴會（會親友同）" },
    { name: "入学", gloss: "入学拜师" },
    { name: "出行", gloss: "外出远行", book: "行幸遣使（出行同）" },
    { name: "赴任", gloss: "上任就职", book: "上官赴任" },
    { name: "纳采", gloss: "订婚下聘", book: "納采問名" },
    { name: "嫁娶", gloss: "结婚迎娶" },
    { name: "移徙", gloss: "搬家迁居", book: "般移（移徙同）" },
    { name: "安床", gloss: "安放床铺" },
    { name: "解除", gloss: "扫除、解厄" },
    { name: "沐浴", gloss: "沐浴斋戒" },
    { name: "剃头", gloss: "理发剃头", book: "整容剃頭" },
    { name: "求医疗病", gloss: "就医治病" },
    { name: "裁衣", gloss: "裁制衣裳", book: "裁製（裁衣同）" },
    { name: "修造动土", gloss: "建房动工", book: "興造動土（修造同）" },
    { name: "竖柱上梁", gloss: "立柱架梁" },
    { name: "开市", gloss: "开业开张" },
    { name: "立券交易", gloss: "签约买卖" },
    { name: "纳财", gloss: "收账进财" },
    { name: "开仓", gloss: "开仓出货", book: "開倉庫出貨財" },
    { name: "开渠穿井", gloss: "开沟挖井" },
    { name: "扫舍宇", gloss: "打扫房屋" },
    { name: "修饰垣墙", gloss: "修补墙垣" },
    { name: "平治道涂", gloss: "修路平地" },
    { name: "破屋坏垣", gloss: "拆除旧屋墙" },
    { name: "伐木", gloss: "砍伐树木" },
    { name: "捕捉", gloss: "捕捉禽兽" },
    { name: "畋猎", gloss: "打猎" },
    { name: "栽种", gloss: "栽苗种植" },
    { name: "牧养", gloss: "放牧饲养" },
    { name: "纳畜", gloss: "买进牲畜" },
    { name: "破土", gloss: "掘地营墓" },
    { name: "安葬", gloss: "下葬" },
    { name: "启攒", gloss: "起柩迁葬" },
  ];
  const YS = YONGSHI.map((y) => y.name);
  const YS_INDEX = new Map(YS.map((n, i) => [n, i]));
  // "a b c" → ["a","b","c"], checked against the vocabulary at load time.
  const items = (s) => {
    const list = s ? s.split(" ") : [];
    for (const n of list) if (!YS_INDEX.has(n)) throw new Error("almanac: unknown 用事 " + n);
    return list;
  };
  // Every 用事 except the listed ones (the book's 「止不忌…餘事皆忌」).
  const allBut = (s) => { const keep = new Set(items(s)); return YS.filter((n) => !keep.has(n)).join(" "); };

  /* Lists the book repeats for several gods (卷十, translated into the vocabulary). */
  // 天德 月德 天德合 月德合 / 天赦: 「宜祭祀祈福求嗣……般移解除求醫療病裁製營建宫室繕城郭興造動土豎柱上梁修倉庫栽種牧養納畜安葬」
  const DE_YI = "祭祀 祈福 求嗣 会亲友 出行 赴任 纳采 嫁娶 移徙 解除 求医疗病 裁衣 修造动土 竖柱上梁 栽种 牧养 纳畜 安葬";
  // 月恩 四相 時德: 「宜祭祀祈福求嗣施恩封拜舉正直慶賜賞賀宴㑹行幸遣使上官赴任臨政親民結婚姻納采問名般移解除求醫療病裁製修宮室繕城郭興造動土豎柱上梁納財開倉庫出貨財栽種牧養」
  const EN_YI = "祭祀 祈福 求嗣 会亲友 出行 赴任 纳采 移徙 解除 求医疗病 裁衣 修造动土 竖柱上梁 纳财 开仓 栽种 牧养";
  // 母倉: 「宜納財栽種牧養納畜」; 王日: 「宜……宴㑹行幸遣使……上官赴任臨政親民裁製」
  const MUCANG_YI = "纳财 栽种 牧养 纳畜";
  const WANG_YI = "会亲友 出行 赴任 裁衣";
  // 月破 (and 平日, 收日, 三煞, 月刑, 月厭, 四廢 in their own words): the long 忌 lists.
  // 月破: 「忌祈福求嗣……般移安牀整容剃頭整手足甲裁製……修飾垣墻伐木栽種牧養納畜破土安葬啟攢」
  const PO_JI = allBut("祭祀 入学 解除 沐浴 求医疗病 扫舍宇 平治道涂 破屋坏垣 捕捉 畋猎");
  // 劫煞 (災煞 月煞 月刑 「忌同刼煞」): …「止不忌祭祀……入學沐浴掃舍宇平治道塗伐木捕捉畋獵取魚」
  const SHA_JI = allBut("祭祀 入学 沐浴 扫舍宇 平治道涂 伐木 捕捉 畋猎");
  // 平日: 「……○止不忌祭祀……入學沐浴整容剃頭整手足甲安碓磑補垣塞穴掃舍宇修飾垣墻平治道塗破屋壞垣伐木捕捉畋獵取魚」
  const PING_JI = allBut("祭祀 入学 沐浴 剃头 扫舍宇 修饰垣墙 平治道涂 破屋坏垣 伐木 捕捉 畋猎");
  // 收日: 「……○止不忌祭祀……入學進人口沐浴整容剃頭整手足甲修倉庫納財……伐木補捉畋獵取魚栽種牧養納畜」
  const SHOU_JI = allBut("祭祀 入学 沐浴 剃头 纳财 扫舍宇 修饰垣墙 平治道涂 破屋坏垣 伐木 捕捉 畋猎 栽种 牧养 纳畜");
  // 月厭: 「……○止不忌祭祀……入學沐浴掃舍宇捕捉畋獵取魚」
  const YAN_JI = allBut("祭祀 入学 沐浴 扫舍宇 捕捉 畋猎");
  // 大時 / 天吏 (the same list): 「忌祈福求嗣上册進表章施恩封拜……結婚姻納采問名嫁娶進人口般移安牀解除求醫療病營建宮室……修倉庫開市立劵交易納財開倉庫出貨財修置產室栽種牧養納畜」
  const DASHI_JI = "祈福 求嗣 出行 赴任 纳采 嫁娶 移徙 安床 解除 求医疗病 修造动土 竖柱上梁 开市 立券交易 纳财 开仓 栽种 牧养 纳畜";
  // 土府 / 土符 地囊 / 土王用事: 「忌營建宮室……興造動土修倉庫修置産室開渠穿井安碓磑補垣修飾垣墻平治道塗破屋壞垣栽種破土」
  const EARTH_JI = "修造动土 开渠穿井 修饰垣墙 平治道涂 破屋坏垣 栽种 破土";
  // 四離 四絶 (with 上朔 晦日): 「止不忌祭祀解除沐浴整容剃頭整手足甲補垣塞穴掃舍宇修飾垣牆平治道塗破屋壊垣伐木餘事皆忌」
  const LIJUE_JI = allBut("祭祀 解除 沐浴 剃头 扫舍宇 修饰垣墙 平治道涂 破屋坏垣 伐木");
  // 四廢: 「……○止不忌祭祀……入學沐浴整容剃頭整手足甲掃舍宇平治道塗破屋壞垣伐木捕捉畋獵取魚」
  const FEI_JI = allBut("祭祀 入学 沐浴 剃头 扫舍宇 平治道涂 破屋坏垣 伐木 捕捉 畋猎");

  // 「霜降後立春前」 (畋獵) and 「立冬後立春前」 (伐木), read on the 节气 in force / the 节月.
  const FROST = (c) => ["霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒"].includes(c.qi);
  const WINTER = (c) => c.m >= 9; // 亥 子 丑月

  const DE4 = "天德 月德 天德合 月德合";

  /* One entry per source of 宜/忌: a 吉神, a 凶神, a 建除 day (「建日」…),
     or a fixed special day. Fields:
       yi / ji   the 用事 it 宜 / 忌 (卷十, translated into the vocabulary);
       yiIf      [[predicate, items], …] seasonal extras (执日 畋猎 …);
       unless    the 吉神 that neutralise its 忌 (「與…併則不忌」); `keep` then
                 lists what it still 忌 (「止忌…」). A source with no `unless`
                 that is not graded (below) is 猶忌: no 德 lifts its 忌;
       blockedBy 凶神 in whose presence `unless` does not work (「…雖與德合併猶忌」);
       noYi      用事 it stops from being written as 宜 (「不註宜」);
       noYiIfLifted  ditto, but only once its 忌 is neutralised (復日 重日).
     A 吉神 with no entry (月空 阳德 阴德 要安 玉宇 金堂 生气 …) has no 宜 in
     the vocabulary; a 凶神 with no entry (河魁 天罡 四击 九坎 血支 血忌 天火)
     likewise has no 忌 in it. 生气 is the 开日 and 天医/吉期… the other 建除
     names: the book files them under the 建除 day, and so do we. */
  const SOURCES = {
    // ---- 吉神 (卷十「以上所宜」) ----
    天德: { yi: DE_YI, ji: "畋猎" },   // 天德 月德 天德合 月德合: …「忌畋獵取魚」（恐傷生氣）
    月德: { yi: DE_YI, ji: "畋猎" },
    天德合: { yi: DE_YI, ji: "畋猎" },
    月德合: { yi: DE_YI, ji: "畋猎" },
    天赦: { yi: DE_YI, ji: "畋猎" },   // 天赦: 「所宜與二德同」，「忌畋獵取魚」
    天恩: { yi: "会亲友" },             // 天恩: 「宜覃恩肆赦施恩惠……慶賜賞賀宴㑹」
    天愿: { yi: "祭祀 祈福 求嗣 会亲友 出行 赴任 纳采 嫁娶 移徙 裁衣 修造动土 竖柱上梁 开市 立券交易 纳财 栽种 牧养 纳畜 安葬" }, // 天願: 「……不用以解除療病」
    月恩: { yi: EN_YI },
    四相: { yi: EN_YI },
    时德: { yi: EN_YI },
    王日: { yi: WANG_YI },
    官日: { yi: "赴任" },               // 官日 守日 相日: 「宜襲爵受封上官赴任臨政親民」
    守日: { yi: "赴任" },
    相日: { yi: "赴任" },
    民日: { yi: "会亲友 纳采 移徙 开市 立券交易 纳财 栽种 牧养 纳畜" }, // 「宜宴㑹結婚姻納采問名進人口般移開市立劵交易納財栽種牧養納畜」
    天喜: { yi: "会亲友 出行 赴任 纳采 嫁娶" }, // 成日「又為天喜宜施恩封拜……宴㑹行幸遣使上官赴任……納采問名嫁娶」
    母仓: { yi: MUCANG_YI },
    // 三合: 「宜慶賜賞賀宴㑹結婚姻納采問名嫁娶進人口裁製修宮室繕城郭興造動土豎柱上梁修倉庫經絡醞釀立劵交易納財安碓磑納畜」；
    // 「寅申巳亥日為三合長生所宜並同母倉，子午卯酉日為三合帝旺所宜並同王日」
    三合: {
      yi: "会亲友 纳采 嫁娶 裁衣 修造动土 竖柱上梁 立券交易 纳财 纳畜",
      yiIf: [[(c) => c.b % 3 === 2, MUCANG_YI], [(c) => c.b % 3 === 0, WANG_YI]],
    },
    六合: { yi: "会亲友 嫁娶 立券交易 纳财 纳畜 安葬" }, // 「宜宴㑹結婚姻嫁娶進人口經絡醞釀立劵交易納財納畜安葬」
    五合: { yi: "会亲友 立券交易" },     // 「宜宴㑹結婚姻立劵交易」
    五富: { yi: "开市 立券交易 纳财 开仓 栽种 牧养 纳畜" }, // 「宜經絡醞釀開市立劵交易納財開倉庫出貨財栽種牧養納畜」
    驿马: { yi: "出行 移徙" },           // 驛馬 天馬: 「宜行幸遣使般移」
    天马: { yi: "出行 移徙" },
    益后: { yi: "祭祀 祈福 求嗣" },      // 益後 續世: 「宜祭祀祈福求嗣」
    续世: { yi: "祭祀 祈福 求嗣" },
    解神: { yi: "解除 沐浴 剃头 求医疗病" }, // 「宜上表章陳詞訟解除沐浴整容剃頭整手足甲求醫療病」

    // ---- 建除十二神 (卷十; 宜 and 忌 of the day itself) ----
    建日: { yi: "出行 赴任", // 「宜施恩封拜……行幸遣使上官赴任臨政親民」; as 月建 (小時 土府) it 忌 (graded below):
      ji: "祈福 求嗣 纳采 解除 剃头 求医疗病 修造动土 竖柱上梁 开仓 开渠穿井 修饰垣墙 平治道涂 破屋坏垣 伐木 栽种 破土 安葬 启攒" },
    // 除日 (吉期 兵寶): 「宜解除沐浴整容剃頭整手足甲求醫療病掃舍宇；又為吉期宜施恩封拜舉正直行幸遣使上官赴任臨政親民」
    除日: { yi: "出行 赴任 解除 沐浴 剃头 求医疗病 扫舍宇" },
    // 滿日 (天巫 福德; 卷四「滿」): 「宜進人口裁製修倉庫經絡開市立劵交易納財開倉庫出貨財補垣塞穴；又為天巫宜祭祀祈福；
    // 又為福德宜上册進表章慶賜賞賀宴㑹修宮室繕城郭」；「忌施恩封拜……上官赴任臨政親民結婚姻納采問名求醫療病」
    满日: { yi: "祭祀 祈福 会亲友 裁衣 开市 立券交易 纳财 开仓", ji: "赴任 纳采 求医疗病" },
    // 天狗: only the 戌日 滿 of 申月 (卷四「滿」按: 「天狗者戌日值滿也……非謂凡為滿日皆天狗也」); 滿日「申月又為天狗忌祭祀與德合併猶忌」;
    // 鋪註條例 「凡天狗寅日忌祭祀不註宜求福祈嗣」.
    天狗: { ji: "祭祀", noYi: "祈福 求嗣" },
    平日: { yi: "修饰垣墙 平治道涂", ji: PING_JI },
    定日: {},                                      // 「宜冠帶」 (not in the vocabulary)
    执日: { yi: "捕捉", yiIf: [[FROST, "畋猎"]] },  // 「宜捕捉；霜降後立春前宜畋獵」
    破日: { yi: "求医疗病 破屋坏垣" },             // 「宜求醫療病破屋壞垣」 (its 忌 are 月破's)
    危日: { yi: "安床", yiIf: [[WINTER, "伐木"], [FROST, "畋猎"]] }, // 「宜……安牀；立冬後立春前宜伐木，霜降後立春前宜畋獵」
    成日: { yi: "入学 移徙 开市 求医疗病" },        // 「宜入學安撫邊境般移築隄防開市……又為天醫宜求醫療病」 (天喜 has its own row)
    收日: { yi: "纳财 捕捉 纳畜", yiIf: [[FROST, "畋猎"]], ji: SHOU_JI }, // 「宜進人口納財捕捉納畜」
    // 開日 (時陽 生氣): 「宜祭祀祈福求嗣……宴㑹入學行幸遣使上官赴任……般移解除求醫療病裁製……興造動土豎柱上梁開市修置產室開渠穿井安碓磑栽種牧養；
    // 忌伐木畋獵取魚破土安葬啓攢」; 鋪註條例 「凡開日不註宜破土安葬啟攢亦不註忌，遇忌則註」.
    开日: { yi: "祭祀 祈福 求嗣 会亲友 入学 出行 赴任 移徙 解除 求医疗病 裁衣 修造动土 竖柱上梁 开市 开渠穿井 栽种 牧养",
      ji: "伐木 畋猎", noYi: "破土 安葬 启攒" },
    闭日: { ji: "会亲友 出行 赴任 纳采 嫁娶 移徙 安床 求医疗病 修造动土 竖柱上梁 开市 开仓 开渠穿井" }, // 宜築隄防補垣塞穴 (not in the vocabulary)

    // ---- 凶神 (卷十「以上所忌」) ----
    月破: { ji: PO_JI },
    大耗: { ji: "开市 立券交易 纳财 开仓" },       // 月破「又為大耗忌修倉庫開市立劵交易納財開倉庫出貨財」
    死神: { ji: "解除 求医疗病 栽种 牧养 纳畜" },  // 平日「又為死神忌……進人口解除求醫療病修置產室栽種牧養納畜」
    劫煞: { ji: SHA_JI },
    灾煞: { ji: SHA_JI },
    月煞: { ji: SHA_JI },                          // 「又為月虛忌修倉庫開倉庫出貨財」 (开仓 is already in the list)
    月刑: { ji: SHA_JI },
    月害: { ji: "祈福 求嗣 会亲友 纳采 嫁娶 求医疗病 开市 立券交易 纳财 开仓 牧养 纳畜 破土 安葬 启攒" },
    月厌: { ji: YAN_JI },
    地火: { ji: "栽种" },                          // 月厭「又為地火忌栽種修築園圃」
    厌对: { ji: "嫁娶", unless: DE4 + " 天赦" },    // 「忌嫁娶……與天德月德天德合月德合天赦併則不忌」
    大时: { ji: DASHI_JI },
    天吏: { ji: DASHI_JI },
    游祸: { ji: "祈福 求嗣 解除 求医疗病" },        // 「與德合天赦併猶忌」
    // 死氣: 「忌安撫邊境選將訓兵出師解除求醫療病修置産室栽種；與天德月德天德合月德合併止忌安撫邊境選將訓兵出師求醫療病餘不忌；辰戌月值月厭雖與德合併猶忌」
    死气: { ji: "解除 求医疗病 栽种", unless: DE4, keep: "求医疗病", blockedBy: "月厌" },
    // 小耗: 「忌修倉庫開市立劵交易納財開倉庫出貨財；與天德月德天德合月德合天願併則不忌；子午卯酉月值刼煞雖與德合併猶忌」
    小耗: { ji: "开市 立券交易 纳财 开仓", unless: DE4 + " 天愿", blockedBy: "劫煞" },
    天贼: { ji: "出行 开仓" },                     // 「忌行幸遣使修倉庫開倉庫出貨財；與德合併猶忌」
    四废: { ji: FEI_JI },                          // 「與德合併猶忌，與月破併諸事皆忌」
    // 四忌 四窮: 「忌安撫邊境選將訓兵出師結婚姻納采問名嫁娶安葬；四窮又忌進人口修倉庫開市立劵交易納財開倉庫出貨財；
    // 與月德天德合月德合併猶忌，惟正月乙亥與天願併止忌安撫邊境選將訓兵出師餘皆不忌」
    四忌: { ji: "纳采 嫁娶 安葬", unless: "天愿" },
    四穷: { ji: "纳采 嫁娶 开市 立券交易 纳财 开仓 安葬", unless: "天愿" },
    五虚: { ji: "开仓", unless: DE4 + " 六合" },   // 「忌修倉庫開倉庫出貨財；與天德月德天德合月德合六合併則不忌」
    // 九空: 「忌進人口修倉庫開市立劵交易納財開倉庫出貨財；寅申月值滿日子午卯酉月值開日與月德天德合月德合併則不忌；巳亥月值月厭從月厭論，辰戌丑未月值破日從月破論」
    九空: { ji: "开市 立券交易 纳财 开仓", unless: "月德 天德合 月德合", blockedBy: "月厌 月破" },
    九焦: { ji: "栽种" },                          // 九坎「又為九焦忌鼓鑄栽種修築園圃；與德合併猶忌」
    土符: { ji: EARTH_JI },                        // 「與德合赦願併猶忌」
    归忌: { ji: "移徙" },                          // 「忌般移逺廻；與德合赦願併猶忌」
    往亡: { ji: "出行 赴任 嫁娶 移徙 求医疗病 捕捉 畋猎" }, // 「忌……行幸遣使……上官赴任臨政親民嫁娶進人口般移求醫療病捕捉畋獵取魚；與德合赦願併猶忌」
    // 復日 重日: 「忌破土安葬啟攢；與天德月德天德合月德合天赦六合併則不忌亦不註宜」；「復日又宜裁製」
    复日: { yi: "裁衣", ji: "破土 安葬 启攒", unless: DE4 + " 天赦 六合", noYiIfLifted: "破土 安葬 启攒" },
    重日: { ji: "破土 安葬 启攒", unless: DE4 + " 天赦 六合", noYiIfLifted: "破土 安葬 启攒" },
    // 五離: 「忌慶賜賞賀宴㑹結婚姻納采問名立劵交易；與天德月德天德合月德合天赦三合六合併則不忌」
    五离: { ji: "会亲友 纳采 立券交易", unless: DE4 + " 天赦 三合 六合" },
    // 八專: 「忌安撫邊境選將訓兵出師結婚姻納采問名嫁娶；與德合併猶忌，與天願併止忌安撫邊境選將訓兵出師餘不忌」
    八专: { ji: "纳采 嫁娶", unless: "天愿" },
    四离: { ji: LIJUE_JI },                        // 上朔 四離 四絶 晦日: 「……餘事皆忌；與徳合赦願併猶忌」
    四绝: { ji: LIJUE_JI },

    // ---- fixed special days ----
    土王用事: { ji: EARTH_JI },                    // 「忌營建宫室……栽種破土；義同土府」
    // 百忌日: 「甲日忌開倉庫出貨財 乙日忌栽種 丁日忌剃頭 ……壬日忌開渠 ……寅日忌祭祀 夘日忌穿井 巳日忌出行 ……未日忌求醫療病 申日忌安牀 酉日忌宴㑹 亥日忌嫁娶」
    // (庚 經絡, 辛 醖釀, 丑 冠帶, 午 苫葢 fall outside the vocabulary). 鋪註條例: 「凡天狗寅日忌祭祀不註宜求福祈嗣」.
    甲日: { ji: "开仓" }, 乙日: { ji: "栽种" }, 丁日: { ji: "剃头" }, 壬日: { ji: "开渠穿井" },
    寅日: { ji: "祭祀", noYi: "祈福 求嗣" }, 卯日: { ji: "开渠穿井" }, 巳日: { ji: "出行" },
    未日: { ji: "求医疗病" }, 申日: { ji: "安床" }, 酉日: { ji: "会亲友" }, 亥日: { ji: "嫁娶" },
    亥子日: { yi: "沐浴" },                        // 「亥子日 宜沐浴」（取水旺也）
    午申日: { yiIf: [[WINTER, "伐木"]] },          // 「午申日 立冬後立春前宜伐木」
    // 冬至 夏至 春分 秋分: 「不註上册進表章慶賜賞賀宴㑹行幸遣使……上官赴任……結婚姻納采問名嫁娶進人口般移開市立劵交易捕捉畋獵取魚；冬至日又不註伐木」
    二分二至: { noYi: "会亲友 出行 赴任 纳采 嫁娶 移徙 开市 立券交易 捕捉 畋猎" },
    冬至: { noYi: "会亲友 出行 赴任 纳采 嫁娶 移徙 开市 立券交易 捕捉 畋猎 伐木" },
  };
  for (const s of Object.values(SOURCES)) {
    for (const k of ["yi", "ji", "keep", "noYi", "noYiIfLifted"]) s[k] = items(s[k]);
    s.yiIf = (s.yiIf || []).map(([p, l]) => [p, items(l)]);
    s.unless = s.unless ? s.unless.split(" ") : null;
    s.blockedBy = s.blockedBy ? s.blockedBy.split(" ") : [];
  }

  /* 宜忌等第 — the great 凶煞 whose 忌 the book settles month by month
     (卷十, each god's paragraph after its list). For the month branch of the
     day, the first matching row gives the outcome:
       [months, outcome]                 always;
       [months, gods, withDe, without]   with / without any of those 吉神;
       [months, "→X"]                    「從X論」: X (also present that day) decides.
     Outcomes, mildest first (the book's six 等 reduce to these four):
       Y 從宜不從忌 — 「止忌軍事療病，餘皆不忌」: the god keeps only its `keep`
                     list (default 求医疗病; 大时 nothing; 月建 its earth items);
       D 吉凶相抵   — 「凡所忌者則不註宜，所宜者亦不註忌」: an item both 宜 and 忌
                     is written as neither;
       J 從忌不從宜 — 「如常例」: 忌 wins;
       X 諸事皆忌.
     Months not listed are 常例 (J). The strictest outcome of all graded
     gods present decides the day (「各從重論」). */
  const SAN_DE = "月德 天德合 月德合";
  const GRADED = {
    // 月建: 「與天德月德天德合月德合天赦月恩四相併止忌營建宮室……伐木栽種破土餘皆不忌…子午月值月厭辰午酉亥月值月刑從刑厭論」
    建日: { keep: EARTH_JI + " 伐木", rows: [["子午", "→月厌"], ["辰酉亥", "→月刑"], ["*", DE4 + " 天赦 月恩 四相", "Y", "J"]] },
    // 月破: 「與德併猶忌…子午月值災煞未申月值月刑與月德天德合月德合併不忌祭祀覃恩等事…不與德合併諸事皆忌；卯酉月值災煞又值月厭雖與德合併仍諸事皆忌」
    月破: { rows: [["子午未申", SAN_DE, "J", "X"], ["卯酉", "X"]] },
    大耗: { rows: [["*", "→月破"]] },
    // 平日: 「亥月又值時德六合止忌…求醫療病餘皆不忌；申月值月害與天德月德合併亦止忌…不與德合併如常例；寅巳月值月刑從月刑論；
    // 子午卯酉月值天吏，卯酉月與月德併、午月與月德合併凡所忌者則不註宜所宜者亦不註忌…子月又值月刑從月刑論；辰戌丑未月值月煞從月煞論」
    平日: { rows: [["亥", "Y"], ["申", DE4, "Y", "J"], ["寅巳子", "→月刑"], ["卯酉", "月德", "D", "J"], ["午", "月德合", "D", "J"], ["辰戌丑未", "→月煞"]] },
    死神: { rows: [["*", "→平日"]] },
    // 收日: 「寅申巳亥月值刼煞從刼煞論；子午卯酉月值大時，子午月與月德合併、酉月與月德併凡所忌者則不註宜…；卯月丑戌月皆值月刑從月刑論；辰未月與德合併止忌…療病餘皆不忌」
    收日: { rows: [["寅申巳亥", "→劫煞"], ["子午", "月德合", "D", "J"], ["酉", "月德", "D", "J"], ["卯丑戌", "→月刑"], ["辰未", DE4, "Y", "J"]] },
    // 滿日: 「寅申月值守日子午夘酉月值相日與月德天德合月德合月恩四相併則不忌；辰戌丑未月值災煞從災煞論；巳亥月值月厭從月厭論」
    满日: { keep: "", rows: [["寅申子午卯酉", SAN_DE + " 月恩 四相", "Y", "J"], ["辰戌丑未", "→灾煞"], ["巳亥", "→月厌"]] },
    // 閉日: 「子午夘酉月值王日辰戌丑未月值官日天吏與天德月德天德合月德合天赦天願併凡所忌者則不註宜所宜者亦不註忌…；寅申巳亥月值月煞從月煞論」
    闭日: { rows: [["子午卯酉辰戌丑未", DE4 + " 天赦 天愿", "D", "J"], ["寅申巳亥", "→月煞"]] },
    // 刼煞: 「寅申巳亥月值收日…寅申月又值六合止忌…療病餘皆不忌；巳亥月值月害與月德天德合併亦止忌…；辰戌丑未月值除日相日與德合併止忌…療病，不與德神併凡所忌者則不註宜…；
    // 子午夘酉月值執日與月德月德合併凡所忌者則不註宜…不與德合併如常例」
    劫煞: { rows: [["寅申", "Y"], ["巳亥", "月德 天德合", "Y", "J"], ["辰戌丑未", DE4, "Y", "D"], ["子午卯酉", "月德 月德合", "D", "J"]] },
    // 災煞: 「寅申巳亥月值開日、辰戌丑未月值滿日與天德月德天德合月德合併止忌…療病；寅申巳亥月不與德神併凡所忌者則不註宜…，辰戌丑未月…如常例；子午夘酉月值破日從月破論」
    灾煞: { rows: [["寅申巳亥", DE4, "Y", "D"], ["辰戌丑未", DE4, "Y", "J"], ["子午卯酉", "→月破"]] },
    // 月煞: 「夘酉月值六合與月德天願併止忌…療病…不與德願併凡所忌者則不註宜…；子午月值月害與月德合併凡所忌者則不註宜…不與德合併如常例；
    // 寅申巳亥月值閉日辰戌丑未月值平日與天德月德天德合月德合併如常例不與德合併諸事皆忌」
    月煞: { rows: [["卯酉", "月德 天愿", "Y", "D"], ["子午", "月德合", "D", "J"], ["*", DE4, "J", "X"]] },
    // 月刑: 「巳月值平日相日六合與月德天德合天願併止忌…療病…不與德願併凡所忌者則不註宜…；寅月…辰酉亥月值建日丑戌月值收日與德合併凡所忌者則不註宜…不與德合併如常例；
    // 子月值平日天吏夘月值收日大時未申月值月破與德合併如常例不與德合併諸事皆忌；午月值月厭從月厭論」
    月刑: { rows: [["巳", "月德 天德合 天愿", "Y", "D"], ["寅辰酉亥丑戌", DE4, "D", "J"], ["子卯未申", DE4, "J", "X"], ["午", "→月厌"]] },
    // 月害: 「卯酉月值除日守日丑未月值執日大時與天德月德併止忌…療病…不與二德併如常例；辰戌月值閉日官日天吏與天德合月德合併凡所忌者則不註宜…；
    // 子午月值月煞己亥月值刼煞寅月值月刑申月值平日各從重論」
    月害: { rows: [["卯酉丑未", "天德 月德", "Y", "J"], ["辰戌", "天德合 月德合", "D", "J"], ["子午", "→月煞"], ["巳亥", "→劫煞"], ["寅", "→月刑"], ["申", "→平日"]] },
    // 月厭: 「寅申月值成日丑未月值開日與月德天德合月德合併止忌行幸遣使……上官赴任臨政親民結婚姻納采問名嫁娶求醫療病般移遠迴栽種餘皆不忌…；
    // 辰戌月值定日己亥月值滿日與天德月德月德合併凡所忌者則不註宜…；子午月厭建㑹與天赦併如常例不與天赦併諸事皆忌；卯酉月值月破災煞雖與德合併仍諸事皆忌」
    月厌: { keep: "出行 赴任 纳采 嫁娶 移徙 求医疗病 栽种", rows: [["寅申丑未", SAN_DE, "Y", "J"], ["辰戌巳亥", "天德 月德 月德合", "D", "J"], ["子午", "天赦", "J", "X"], ["卯酉", "X"]] },
    地火: { keep: "栽种", rows: [["*", "→月厌"]] },
    // 大時: 「寅申巳亥月值除日官日辰戌月值執日六合止忌安撫邊境選將訓兵出師餘皆不忌；丑未月值執日六害與二德併亦止忌…；
    // 子午卯酉月值收日子午月與月德合併酉月與月德併凡所忌者則不註宜…；卯月又值月刑從月刑論」
    大时: { keep: "", rows: [["寅申巳亥辰戌", "Y"], ["丑未", "天德 月德", "Y", "J"], ["子午", "月德合", "D", "J"], ["酉", "月德", "D", "J"], ["卯", "→月刑"]] },
    // 天吏: 「寅申巳亥月值危日與天德月德天德合月德合併止忌…療病…不與德合併如常例；辰戌丑未月值閉日與德合赦願併凡所忌者則不註宜…；午卯酉月值平日從平日論，子月又值月刑從月刑論」
    天吏: { rows: [["寅申巳亥", DE4, "Y", "J"], ["辰戌丑未", DE4 + " 天赦 天愿", "D", "J"], ["午卯酉", "→平日"], ["子", "→月刑"]] },
  };
  for (const g of Object.values(GRADED)) {
    g.keep = items(g.keep === undefined ? "求医疗病" : g.keep);
    g.rows = g.rows.map(([months, a, b, c]) => ({
      months, defer: a && a[0] === "→" ? a.slice(1) : null,
      de: b ? a.split(" ") : null, withDe: b || a, without: c || a,
    }));
  }
  const SEVERITY = { Y: 0, D: 1, J: 2, X: 3 };
  const LEVEL_NAME = { Y: "从宜不从忌", D: "吉凶相抵", J: "从忌不从宜", X: "诸事皆忌" };

  /* 諸事皆忌 days named in the 月厭 and 月建 paragraphs (陰陽大㑹, 小㑹, 陰位,
     陰陽交破, 陰陽擊衝, 陽破陰衝, 陰道衝陽, 三陰, 陰錯, 絶陰, 絶陽), by 节月
     (正月 = 寅月). 陰陽俱錯 (五月丙午 十一月壬子) are 大㑹 days already. */
  const ALL_JI_DAYS = {
    阴阳大会: ["甲戌", "乙酉", "·", "·", "丙午", "丁巳", "庚辰", "辛卯", "·", "·", "壬子", "癸亥"],
    阴阳小会: ["·", "己卯", "戊辰", "己巳", "戊午", "·", "·", "己酉", "戊戌", "己亥", "戊子", "·"],
    阴位: ["·", "·", "庚辰", "·", "·", "·", "·", "·", "甲戌", "·", "·", "·"],
    阴阳交破: ["·", "·", "·", "癸亥", "·", "·", "·", "·", "·", "丁巳", "·", "·"],
    阴阳击冲: ["·", "·", "·", "·", "壬子", "·", "·", "·", "·", "·", "丙午", "·"],
    阳破阴冲: ["·", "·", "·", "·", "·", "癸丑", "·", "·", "·", "·", "·", "丁未"],
    阴道冲阳: ["·", "己酉", "·", "·", "·", "·", "·", "己卯", "·", "·", "·", "·"],
    三阴: ["辛酉", "·", "·", "·", "·", "·", "乙卯", "·", "·", "·", "·", "·"],
    阴错: ["·", "辛酉", "·", "·", "·", "·", "·", "乙卯", "·", "·", "·", "·"],
    绝阴: ["·", "·", "·", "戊辰", "·", "·", "·", "·", "·", "·", "·", "·"],
    绝阳: ["·", "·", "·", "·", "·", "·", "·", "·", "·", "戊戌", "·", "·"],
  };

  // 鋪註條例: 「凡徳合赦願月恩四相時徳等日不註忌進人口安牀經絡醖釀開市立劵交易納財開倉庫出貨財，如遇徳猶忌及從忌不從宜之日則仍註忌」
  const DE_DAY = new Set([...DE4.split(" "), "天赦", "天愿", "月恩", "四相", "时德"]);
  const DE_DAY_SPARE = new Set(items("安床 开市 立券交易 纳财 开仓"));

  /* The day's 宜/忌. ctx is almanacRuleContext (plus `qi`, the 节气 in
     force, and `termToday`); gods is dayGods(ctx). Returns
       yi, ji  — 用事 names in vocabulary order (ji is every 用事 on a 諸事皆忌 day);
       level   — { code: Y|D|J|X, name, by: [the graded gods / named day that decided] }
                 or null when no graded 凶煞 sits on the day;
       graded  — each graded god's own vote (Y D J X, or "→X" when it defers);
       allJi   — true on a 諸事皆忌 day;
       trace   — one row per 用事 that any source touched:
                 { name, yi: [sources], ji: [sources], result: "宜"|"忌"|"不注", why }. */
  const JIANCHU12 = "建除满平定执破危成收开闭";
  function yiJi(ctx, gods) {
    const godNames = [...gods.ji, ...gods.xiong].map((g) => g.name);
    const present = new Set(godNames);
    const jc = JIANCHU12[(ctx.b - ctx.mb + 12) % 12] + "日";
    // Active sources in display order: 吉神, the 建除 day, 凶神, then special days.
    const active = [...gods.ji.map((g) => g.name), jc, ...gods.xiong.map((g) => g.name)];
    if (jc === "满日" && ZHI[ctx.mb] === "申") active.push("天狗");
    if (ctx.tuWang) active.push("土王用事");
    for (const k of [GAN[ctx.s] + "日", ZHI[ctx.b] + "日"]) if (SOURCES[k]) active.push(k);
    if (ctx.b === 11 || ctx.b === 0) active.push("亥子日");
    if (ctx.b === 6 || ctx.b === 8) active.push("午申日");
    if (ctx.termToday === "冬至") active.push("冬至");
    else if (["春分", "夏至", "秋分"].includes(ctx.termToday)) active.push("二分二至");
    const has = new Set(active);
    const meets = (list) => list.some((n) => present.has(n));

    // ---- the day's 等第 ----
    const verdictOf = {};
    for (const name of active) {
      const g = GRADED[name];
      if (!g) continue;
      const row = g.rows.find((r) => r.months === "*" || r.months.includes(ZHI[ctx.mb]));
      if (!row) { verdictOf[name] = "J"; continue; }
      // 「從X論」 names a god that sits on the same day by construction; if it
      // ever did not, fall back to 常例 (tests assert this never happens).
      if (row.defer) { verdictOf[name] = has.has(row.defer) ? "→" + row.defer : "J?"; continue; }
      verdictOf[name] = row.de ? (meets(row.de) ? row.withDe : row.without) : row.withDe;
    }
    let code = null, by = [];
    for (const [name, v0] of Object.entries(verdictOf)) {
      if (v0[0] === "→") continue;
      const v = v0[0];
      if (code === null || SEVERITY[v] > SEVERITY[code]) { code = v; by = [name]; }
      else if (v === code) by.push(name);
    }
    // Named 諸事皆忌 days, and 四廢 on a 月破 (「與月破併諸事皆忌」).
    for (const [name, table] of Object.entries(ALL_JI_DAYS)) {
      if (table[ctx.m] === ctx.gz) { if (code !== "X") by = []; code = "X"; by.push(name); }
    }
    if (present.has("四废") && present.has("月破")) { if (code !== "X") by = []; code = "X"; by.push("四废逢月破"); }
    const level = code ? { code, name: LEVEL_NAME[code], by } : null;

    // ---- per 用事 ----
    const yiBy = new Map(), jiBy = new Map();
    const add = (map, item, src) => { if (!map.has(item)) map.set(item, []); if (!map.get(item).includes(src)) map.get(item).push(src); };
    const noYi = new Map();
    for (const name of active) {
      const s = SOURCES[name];
      if (!s) continue;
      for (const it of s.yi) add(yiBy, it, name);
      for (const [p, l] of s.yiIf) if (p(ctx)) for (const it of l) add(yiBy, it, name);
      for (const it of s.ji) add(jiBy, it, name);
      for (const it of s.noYi) add(noYi, it, name);
    }
    // Which sources' 忌 still stand, and why the others fell.
    const lifted = new Map(); // source → the god that lifted it
    for (const name of active) {
      const s = SOURCES[name];
      if (!s || !s.unless || s.blockedBy.some((n) => present.has(n))) continue;
      const by1 = s.unless.find((n) => present.has(n));
      if (by1) {
        lifted.set(name, by1);
        for (const it of s.noYiIfLifted) add(noYi, it, name);
      }
    }
    const deDay = godNames.find((n) => DE_DAY.has(n));
    const trace = [];
    const yi = [], ji = [];
    for (const item of YS) {
      const ys = yiBy.get(item) || [], js = jiBy.get(item) || [];
      const sup = noYi.get(item) || [];
      if (!ys.length && !js.length && !sup.length && code !== "X") continue;
      const fixed = [], open = [], graded = [], dropped = [];
      for (const src of js) {
        const s = SOURCES[src];
        if (GRADED[src]) {
          if (code === "Y" && !GRADED[src].keep.includes(item)) dropped.push(`${src}之忌不从`);
          else if (deDay && DE_DAY_SPARE.has(item) && code !== "J") dropped.push(`${deDay}之日不注${src}之忌`);
          else graded.push(src);
        } else if (lifted.has(src)) {
          if (s.keep.includes(item)) open.push(src); else dropped.push(`${src}遇${lifted.get(src)}不忌`);
        } else if (s.unless) {
          if (deDay && DE_DAY_SPARE.has(item) && code !== "J") dropped.push(`${deDay}之日不注${src}之忌`); else open.push(src);
        } else fixed.push(src);
      }
      const wantYi = ys.length > 0 && sup.length === 0;
      let result, why;
      if (code === "X") {
        result = "忌"; why = `诸事皆忌（${by.join("、")}）`;
      } else if (fixed.length) {
        result = "忌"; why = ys.length ? `${fixed.join("、")}之忌德不能解` : "";
      } else if (open.length) {
        result = "忌"; why = ys.length ? `${open.join("、")}之忌未解` : "";
      } else if (graded.length) {
        if (!wantYi) { result = "忌"; why = ""; }
        else if (code === "D") { result = "不注"; why = "吉凶相抵，不注宜亦不注忌"; }
        else { result = "忌"; why = code === "Y" ? `从宜不从忌，惟此事${graded.join("、")}仍忌` : "从忌不从宜"; }
      } else if (wantYi) {
        result = "宜"; why = "";
      } else {
        result = "不注";
        why = sup.length ? `${sup.join("、")}不注宜` : "";
      }
      if (dropped.length && code !== "X") why = [why, ...dropped].filter(Boolean).join("，");
      if (result === "宜") yi.push(item); else if (result === "忌") ji.push(item);
      trace.push({ name: item, yi: ys, ji: js, result, why });
    }
    return { yi, ji, level, allJi: code === "X", trace, graded: verdictOf };
  }

  return {
    ZHISHEN, zhiShenOf, dayGods, yiJi, YONGSHI,
    JI_NAMES: JI.map((g) => g.name), XIONG_NAMES: XIONG.map((g) => g.name),
    YIJI_SOURCES: Object.keys(SOURCES), GRADED_NAMES: Object.keys(GRADED),
  };
})();
