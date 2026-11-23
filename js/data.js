/* Now, and More — content pools (bilingual, public domain where applicable) */
"use strict";

/* ---------- UI strings ---------- */
const I18N = {
  zh: {
    title: "此时，还有",
    subtitle: "Now, and More",
    tagline: "时间是确定的，下一块是什么，不确定。",
    drawNext: "再抽一张",
    encounter: (n) => `第 ${n} 次相遇`,
    hint: "点卡片、按空格，或等下一分钟",
    categories: {
      world: "与此同时",
      poem: "一首诗",
      history: "历史上的今天",
      thought: "一个念头",
      chance: "纯偶然",
      memory: "你的从前",
    },
    world: {
      localTime: "当地时间",
      sunrise: "日出",
      sunset: "日落",
      dayLength: "昼长",
      polarDay: "今天太阳不会落下",
      polarNight: "今天太阳不会升起",
      moonTitle: "此刻的月亮",
      moonIllum: (p) => `照亮 ${p}%`,
      moonAge: (d) => `月龄 ${d} 天`,
      phases: ["新月", "娥眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"],
    },
    history: {
      onThisDay: (y) => `${y} 年的今天`,
      randomDay: "历史上的某一天",
    },
    chance: {
      integer: "一个随机整数",
      dice: "掷骰子",
      coins: "抛硬币",
      card: "抽一张牌",
      color: "一个随机颜色",
      heads: "正",
      tails: "反",
      suits: { S: "黑桃", H: "红桃", D: "方块", C: "梅花" },
    },
    clockStyles: {
      label: "时钟样式",
      paper: "宣纸",
      minimal: "极简",
      analog: "表盘",
      flip: "翻页",
      vertical: "竖排",
    },
    langToggle: "EN",
  },
  en: {
    title: "Now, and More",
    subtitle: "此时，还有",
    tagline: "The time is certain. What comes next is not.",
    drawNext: "Draw another",
    encounter: (n) => `Encounter ${n}`,
    hint: "Click the card, press Space, or wait for the next minute",
    categories: {
      world: "Meanwhile",
      poem: "A Poem",
      history: "On This Day",
      thought: "A Thought",
      chance: "Pure Chance",
      memory: "Your Past",
    },
    world: {
      localTime: "local time",
      sunrise: "Sunrise",
      sunset: "Sunset",
      dayLength: "Day length",
      polarDay: "The sun does not set today",
      polarNight: "The sun does not rise today",
      moonTitle: "The Moon, right now",
      moonIllum: (p) => `${p}% illuminated`,
      moonAge: (d) => `Moon age ${d} days`,
      phases: ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"],
    },
    history: {
      onThisDay: (y) => `On this day in ${y}`,
      randomDay: "A random day in history",
    },
    chance: {
      integer: "A random integer",
      dice: "Rolling dice",
      coins: "Flipping coins",
      card: "A drawn card",
      color: "A random colour",
      heads: "H",
      tails: "T",
      suits: { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" },
    },
    clockStyles: {
      label: "Clock style",
      paper: "Paper",
      minimal: "Minimal",
      analog: "Analog",
      flip: "Flip",
      vertical: "Vertical",
    },
    langToggle: "中文",
  },
};

/* ---------- World: cities ---------- */
/* tz: IANA timezone; lat/lon for solar calculation */
const CITIES = [
  { tz: "Asia/Shanghai", lat: 39.90, lon: 116.40, zh: "北京", en: "Beijing" },
  { tz: "Asia/Tokyo", lat: 35.68, lon: 139.69, zh: "东京", en: "Tokyo" },
  { tz: "Asia/Singapore", lat: 1.35, lon: 103.82, zh: "新加坡", en: "Singapore" },
  { tz: "Asia/Kolkata", lat: 28.61, lon: 77.21, zh: "德里", en: "Delhi" },
  { tz: "Asia/Dubai", lat: 25.20, lon: 55.27, zh: "迪拜", en: "Dubai" },
  { tz: "Europe/Moscow", lat: 55.76, lon: 37.62, zh: "莫斯科", en: "Moscow" },
  { tz: "Europe/Istanbul", lat: 41.01, lon: 28.98, zh: "伊斯坦布尔", en: "Istanbul" },
  { tz: "Europe/Paris", lat: 48.86, lon: 2.35, zh: "巴黎", en: "Paris" },
  { tz: "Europe/London", lat: 51.51, lon: -0.13, zh: "伦敦", en: "London" },
  { tz: "Atlantic/Reykjavik", lat: 64.15, lon: -21.94, zh: "雷克雅未克", en: "Reykjavík" },
  { tz: "America/Sao_Paulo", lat: -23.55, lon: -46.63, zh: "圣保罗", en: "São Paulo" },
  { tz: "America/New_York", lat: 40.71, lon: -74.01, zh: "纽约", en: "New York" },
  { tz: "America/Chicago", lat: 41.88, lon: -87.63, zh: "芝加哥", en: "Chicago" },
  { tz: "America/Denver", lat: 39.74, lon: -104.99, zh: "丹佛", en: "Denver" },
  { tz: "America/Los_Angeles", lat: 34.05, lon: -118.24, zh: "洛杉矶", en: "Los Angeles" },
  { tz: "Pacific/Auckland", lat: -36.85, lon: 174.76, zh: "奥克兰", en: "Auckland" },
  { tz: "Australia/Sydney", lat: -33.87, lon: 151.21, zh: "悉尼", en: "Sydney" },
  { tz: "Africa/Cairo", lat: 30.04, lon: 31.24, zh: "开罗", en: "Cairo" },
];

/* ---------- Poems: Chinese (public domain) ---------- */
const POEMS_ZH = [
  { title: "终南别业", author: "王维", lines: ["行到水穷处，坐看云起时。", "偶然值林叟，谈笑无还期。"] },
  { title: "登鹳雀楼", author: "王之涣", lines: ["白日依山尽，黄河入海流。", "欲穷千里目，更上一层楼。"] },
  { title: "静夜思", author: "李白", lines: ["床前明月光，疑是地上霜。", "举头望明月，低头思故乡。"] },
  { title: "春晓", author: "孟浩然", lines: ["春眠不觉晓，处处闻啼鸟。", "夜来风雨声，花落知多少。"] },
  { title: "江雪", author: "柳宗元", lines: ["千山鸟飞绝，万径人踪灭。", "孤舟蓑笠翁，独钓寒江雪。"] },
  { title: "枫桥夜泊", author: "张继", lines: ["月落乌啼霜满天，江枫渔火对愁眠。", "姑苏城外寒山寺，夜半钟声到客船。"] },
  { title: "山居秋暝", author: "王维", lines: ["空山新雨后，天气晚来秋。", "明月松间照，清泉石上流。"] },
  { title: "相思", author: "王维", lines: ["红豆生南国，春来发几枝。", "愿君多采撷，此物最相思。"] },
  { title: "登幽州台歌", author: "陈子昂", lines: ["前不见古人，后不见来者。", "念天地之悠悠，独怆然而涕下。"] },
  { title: "早发白帝城", author: "李白", lines: ["朝辞白帝彩云间，千里江陵一日还。", "两岸猿声啼不住，轻舟已过万重山。"] },
  { title: "游子吟", author: "孟郊", lines: ["慈母手中线，游子身上衣。", "临行密密缝，意恐迟迟归。"] },
  { title: "赋得古原草送别（节选）", author: "白居易", lines: ["离离原上草，一岁一枯荣。", "野火烧不尽，春风吹又生。"] },
  { title: "鹿柴", author: "王维", lines: ["空山不见人，但闻人语响。", "返景入深林，复照青苔上。"] },
  { title: "悯农（其二）", author: "李绅", lines: ["锄禾日当午，汗滴禾下土。", "谁知盘中餐，粒粒皆辛苦。"] },
];

/* ---------- Poems: English (public domain) ---------- */
const POEMS_EN = [
  { title: "The Road Not Taken", author: "Robert Frost", lines: ["Two roads diverged in a wood, and I,", "I took the one less traveled by,", "And that has made all the difference."] },
  { title: "Hope is the thing with feathers", author: "Emily Dickinson", lines: ["Hope is the thing with feathers", "That perches in the soul,", "And sings the tune without the words,", "And never stops at all."] },
  { title: "A Psalm of Life", author: "Henry Wadsworth Longfellow", lines: ["Life is real! Life is earnest!", "And the grave is not its goal;", "Dust thou art, to dust returnest,", "Was not spoken of the soul."] },
  { title: "If—", author: "Rudyard Kipling", lines: ["If you can keep your head when all about you", "Are losing theirs and blaming it on you,", "If you can trust yourself when all men doubt you,", "But make allowance for their doubting too."] },
  { title: "Sonnet 18", author: "William Shakespeare", lines: ["Shall I compare thee to a summer's day?", "Thou art more lovely and more temperate:", "Rough winds do shake the darling buds of May,", "And summer's lease hath all too short a date."] },
  { title: "Ozymandias", author: "Percy Bysshe Shelley", lines: ["I met a traveller from an antique land,", "Who said: Two vast and trunkless legs of stone", "Stand in the desert. Near them, on the sand,", "Half sunk a shattered visage lies."] },
  { title: "The Tyger", author: "William Blake", lines: ["Tyger Tyger, burning bright,", "In the forests of the night;", "What immortal hand or eye,", "Could frame thy fearful symmetry?"] },
  { title: "Because I could not stop for Death", author: "Emily Dickinson", lines: ["Because I could not stop for Death,", "He kindly stopped for me;", "The Carriage held but just Ourselves", "And Immortality."] },
  { title: "Invictus", author: "William Ernest Henley", lines: ["Out of the night that covers me,", "Black as the pit from pole to pole,", "I thank whatever gods may be", "For my unconquerable soul."] },
  { title: "Daffodils", author: "William Wordsworth", lines: ["I wandered lonely as a cloud", "That floats on high o'er vales and hills,", "When all at once I saw a crowd,", "A host, of golden daffodils."] },
  { title: "Annabel Lee", author: "Edgar Allan Poe", lines: ["It was many and many a year ago,", "In a kingdom by the sea,", "That a maiden there lived whom you may know", "By the name of Annabel Lee."] },
  { title: "A Light exists in Spring", author: "Emily Dickinson", lines: ["A Light exists in Spring", "Not present on the Year", "At any other period,", "When March is scarcely here."] },
  { title: "The New Colossus", author: "Emma Lazarus", lines: ["Give me your tired, your poor,", "Your huddled masses yearning to breathe free,", "The wretched refuse of your teeming shore.", "Send these, the homeless, tempest-tost to me."] },
];

/* ---------- History: on this day, keyed by MM-DD ---------- */
const HISTORY = {
  "01-01": { year: 1863, zh: "林肯签署《解放黑奴宣言》生效，美国南方各州的奴隶获得法律上的自由。", en: "Lincoln's Emancipation Proclamation takes effect, legally freeing enslaved people in the Confederate states." },
  "01-27": { year: 1880, zh: "爱迪生获得白炽电灯专利，一盏能连续点亮的灯泡走进千家万户的倒计时开始了。", en: "Thomas Edison receives a patent for the incandescent electric lamp." },
  "02-11": { year: 1990, zh: "曼德拉在被监禁 27 年后走出监狱，南非种族隔离制度走向终结。", en: "Nelson Mandela is released after 27 years in prison, hastening the end of apartheid in South Africa." },
  "03-14": { year: 1879, zh: "爱因斯坦出生于德国乌尔姆。这一天后来也成了圆周率日。", en: "Albert Einstein is born in Ulm, Germany. The date later becomes Pi Day." },
  "04-12": { year: 1961, zh: "加加林乘坐东方一号飞船绕地球一周，成为第一个进入太空的人类。", en: "Yuri Gagarin aboard Vostok 1 becomes the first human in space, completing one orbit of Earth." },
  "04-15": { year: 1912, zh: "泰坦尼克号在首航途中撞上冰山后沉没，超过 1500 人遇难。", en: "The RMS Titanic sinks after striking an iceberg on its maiden voyage, killing more than 1,500 people." },
  "05-29": { year: 1953, zh: "希拉里与丹增诺尔盖首次成功登顶珠穆朗玛峰。", en: "Edmund Hillary and Tenzing Norgay become the first climbers confirmed to summit Mount Everest." },
  "06-06": { year: 1944, zh: "诺曼底登陆：盟军在法国北部海岸发起人类历史上最大规模的两栖作战。", en: "D-Day: Allied forces launch the largest seaborne invasion in history on the Normandy coast." },
  "06-28": { year: 1914, zh: "萨拉热窝事件：奥匈帝国皇储斐迪南大公遇刺，一个月后第一次世界大战爆发。", en: "Archduke Franz Ferdinand is assassinated in Sarajevo; within a month, the First World War begins." },
  "07-20": { year: 1969, zh: "阿波罗 11 号登月，阿姆斯特朗踏上月球表面：这是个人的一小步，却是人类的一大步。", en: "Apollo 11 lands on the Moon; Neil Armstrong takes 'one small step' onto the lunar surface." },
  "08-06": { year: 1991, zh: "蒂姆·伯纳斯-李发布第一个网站，万维网向公众打开。", en: "Tim Berners-Lee releases the first website, opening the World Wide Web to the public." },
  "08-15": { year: 1969, zh: "伍德斯托克音乐节开幕，三天里约 40 万人聚集在一座农场。", en: "The Woodstock music festival opens, drawing some 400,000 people to a farm in New York." },
  "09-02": { year: 1945, zh: "第二次世界大战正式结束，日本在密苏里号战列舰上签署投降书。", en: "The Second World War formally ends as Japan signs the surrender aboard USS Missouri." },
  "10-01": { year: 1949, zh: "中华人民共和国成立，开国大典在北京天安门广场举行。", en: "The People's Republic of China is founded, proclaimed at Tiananmen in Beijing." },
  "10-04": { year: 1957, zh: "苏联发射斯普特尼克 1 号，人类第一颗人造卫星进入轨道。", en: "The Soviet Union launches Sputnik 1, the first artificial satellite to orbit Earth." },
  "10-29": { year: 1969, zh: "ARPANET 完成第一次主机到主机的连接，互联网的雏形发出第一个词：login（只发出 lo 就崩溃了）。", en: "ARPANET makes its first host-to-host connection; the first message, 'login', crashes after just 'lo'." },
  "11-09": { year: 1989, zh: "柏林墙倒塌，冷战格局开始瓦解。", en: "The Berlin Wall falls, opening the way to German reunification and the end of the Cold War order." },
  "11-23": { year: 1963, zh: "《神秘博士》在 BBC 首播。这部剧后来成了世界上最长寿的科幻电视剧之一，今天仍在播出。", en: "Doctor Who premieres on the BBC. It goes on to become one of the longest-running science-fiction series in television history, and is still running today." },
  "12-17": { year: 1903, zh: "莱特兄弟在北卡罗来纳州完成人类第一次有动力、可控的飞行，只飞了 12 秒。", en: "The Wright brothers make the first powered, controlled aeroplane flight in North Carolina. It lasts 12 seconds." },
  "12-25": { year: 1642, zh: "牛顿出生于英格兰林肯郡伍尔索普（儒略历）。苹果和万有引力的故事，还要再等二十多年。", en: "Isaac Newton is born in Woolsthorpe, England (Julian calendar). The apple, and universal gravitation, are still two decades away." },
};

/* ---------- Thoughts (bilingual pairs) ---------- */
const THOUGHTS = [
  { zh: "你以为你在回忆，其实你每回忆一次，就重写了一次记忆。", en: "You think you are remembering. Each time you recall something, you rewrite the memory a little." },
  { zh: "注意力是你唯一真正拥有的货币，花在哪里，你的人生就在哪里。", en: "Attention is the only currency you truly own. Where you spend it is where your life happens." },
  { zh: "大脑不是用来存真相的，它是用来预测下一秒的。预测错了，才轮到学习。", en: "The brain is not built to store truth. It is built to predict the next second, and it learns only when the prediction fails." },
  { zh: "你确信的事里，有相当一部分只是你重复听说过很多次。", en: "A fair share of what you are certain of is simply what you have heard repeated many times." },
  { zh: "无聊不是没有事情做，是所有事情都没有先抓住你的注意力。", en: "Boredom is not having nothing to do. It is nothing having caught your attention first." },
  { zh: "选择困难往往不是选项太多，而是你还没决定用什么标准选。", en: "Hard choices are rarely about too many options. They are about not yet having decided what counts as a reason." },
  { zh: "你读过的书大多会忘掉，但忘掉之后剩下的形状，就是你的判断力。", en: "You will forget most of what you read. What remains after forgetting is the shape of your judgement." },
  { zh: "地图不是领土，模型不是现实，时钟也不是时间本身，它只是我们约定好的一种看法。", en: "The map is not the territory, the model is not reality, and the clock is not time itself. It is only an agreed way of looking." },
  { zh: "人会高估一天能做的事，低估一年能做的事。时钟只管走，不负责纠正这个错觉。", en: "We overestimate what a day can hold and underestimate what a year can. The clock just keeps walking; correcting the illusion is on us." },
  { zh: "确定性让人安心，偶然性让人活着。两者缺一个，日子都不完整。", en: "Certainty comforts us; chance keeps us alive to possibility. A day missing either one is incomplete." },
  { zh: "你此刻觉得漫长的一分钟，回忆起来往往只剩一个模糊的影子。时间在感受里从来不是匀速的。", en: "A minute that feels endless now will shrink to a blur in memory. In felt experience, time never runs at a constant speed." },
  { zh: "问题比答案活得久。一个好问题，可以陪你走很多年。", en: "Questions outlive answers. A good question can keep you company for years." },
  { zh: "所谓灵感，常常是注意力在别处闲逛时，替你带回来的东西。", en: "What we call inspiration is often just attention, wandering elsewhere, bringing something back for you." },
  { zh: "你无法同时抓住这一秒和回味上一秒。意识的带宽，只够选一个。", en: "You cannot hold this second and savour the last one at the same time. Consciousness has bandwidth for one." },
];

/* ---------- Memory prompts (bilingual, reflection only) ---------- */
const MEMORY_PROMPTS = [
  { zh: "去年的今天，你在做什么？先别查手机，试着只凭记忆想一想。", en: "What were you doing a year ago today? Try to answer from memory alone before checking your phone." },
  { zh: "想一个你很久没有联系的人。此刻，他或她大概在哪里，过着怎样的一天？", en: "Think of someone you have not contacted in a long time. Where might they be right now, living what kind of day?" },
  { zh: "你手机相册里最早的那张照片是什么？你还记得按下快门时在想什么吗？", en: "What is the oldest photo on your phone? Do you remember what you were thinking when you took it?" },
  { zh: "十年前，你以为自己现在会过怎样的生活？和此刻比，差在哪里，对在哪里？", en: "Ten years ago, what did you imagine your life would look like now? Where were you wrong, and where were you right?" },
  { zh: "有没有一句话，你听过一次就再也没忘掉？它是谁说的，在什么场合？", en: "Is there a sentence you heard once and never forgot? Who said it, and on what occasion?" },
  { zh: "想一个你曾经每天都去、现在再也不会去的地方。它还在吗？", en: "Think of a place you used to visit every day and will probably never visit again. Is it still there?" },
  { zh: "你小时候最喜欢的一首歌或一本书，现在再听、再看，会是什么感觉？", en: "A song or book you loved as a child: what would it feel like to hear or read it again now?" },
  { zh: "上一次你完全没有看时间、忘记了时间，是在做什么的时候？", en: "When did you last lose track of time completely, and what were you doing?" },
  { zh: "如果此刻能给三年前的自己留一句话，你会留什么？只许一句。", en: "If you could leave one sentence for yourself three years ago, what would it be? Only one." },
  { zh: "今天这一天里，有没有一个瞬间值得被记住？哪怕它非常小。", en: "Was there a moment today worth remembering, however small?" },
  { zh: "你记得的第一个清晨是什么样的？光线、声音、气味，随便哪一个都行。", en: "What is the earliest morning you can remember? The light, a sound, a smell, any one of them." },
  { zh: "有没有一件你学会之后就再也没忘过的技能？是谁教你的？", en: "Is there a skill you learned once and never lost? Who taught you?" },
];

/* ---------- Category weights ---------- */
const CATEGORY_WEIGHTS = [
  { key: "world", weight: 30 },
  { key: "poem", weight: 25 },
  { key: "history", weight: 15 },
  { key: "thought", weight: 15 },
  { key: "chance", weight: 10 },
  { key: "memory", weight: 5 },
];
