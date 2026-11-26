/* Now, and More — almanac day-selection rules (择日规则层).
   黄道黑道十二值神 and the day 神煞 (吉神 / 凶神) of the 黄历 card, after
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

  return {
    ZHISHEN, zhiShenOf, dayGods,
    JI_NAMES: JI.map((g) => g.name), XIONG_NAMES: XIONG.map((g) => g.name),
  };
})();
