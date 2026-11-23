# 此时，还有 · Now, and More

> 时间是确定的，下一块是什么，不确定。
> The time is certain. What comes next is not.

一个单页时钟应用：页面中央是一座一秒不差的真时钟（确定性），下方有一张舞台卡，每分钟随机换一块内容（不确定性）。先按权重抽类别，再在类别里抽一条，所以你连下一张会来什么*种类*的东西都不知道。

A single-page clock. At the centre, a precise real clock that never moves (certainty). Below it, one stage card that changes every minute (uncertainty): first a category is drawn by weight, then an item inside it, so you never know even what *kind* of thing comes next.

## 功能 / Features

- **真时钟 / A real clock** — 每秒更新，带日期、星期；中文模式附带农历（Intl 中国农历历法）。
- **五种时钟样式 / Five clock styles** — 宣纸大字 (Paper)、极简细体 (Minimal)、模拟表盘 (Analog, SVG 真指针)、翻页钟 (Flip)、竖排 (Vertical)。选择会保存在 localStorage。
- **六个随机池 / Six random pools**（权重）：
  - 与此同时 Meanwhile (30)：18 座城市此刻的真实当地时间，外加现场计算的日出、日落与昼长（含极昼/极夜），还有一张实时计算的月相卡。
  - 一首诗 A Poem (25)：中文公版诗与英文公版诗，随机语言模式出对应语种。
  - 历史上的今天 On This Day (15)：按日期索引的历史事件（双语）；当天没有条目时随机抽一条并标注。
  - 一个念头 A Thought (15)：双语认知短句。
  - 纯偶然 Pure Chance (10)：当场生成的随机整数、骰子、硬币序列、抽牌、随机颜色。
  - 你的从前 Your Past (5)：回望提示，只提问，不编造你的记忆。
- **秒层随机 / Second-layer randomness** — 左下角每秒跳一个新随机数，背景微光每秒随机漂移，还有一条走完一分钟的细进度线。
- **双语 / Bilingual** — 中文 / English 一键切换，按浏览器语言自动首选，选择保存在 localStorage。界面、城市名、诗歌、念头、历史全部双语。
- **交互 / Interaction** — 点卡片、点「再抽一张 / Draw another」或按空格立刻抽下一张；计数器记录「第 N 次相遇 / Encounter N」。同一类别不会连续出现两次（可避免时）。
- 浅色宣纸主题，深色模式跟随系统 (`prefers-color-scheme`)。无账号、无统计、无框架、无构建步骤。

## 本地运行 / Run locally

纯静态文件，用任何静态服务器即可，例如：

```bash
# Python
python3 -m http.server 8000

# 或 Node
npx serve .
```

然后打开 http://localhost:8000 。直接双击 `index.html` 一般也可以（Google Fonts 需要联网）。

## 部署到 Cloudflare Pages / Deploy to Cloudflare Pages

1. 把本仓库推送到 GitHub。
2. 在 Cloudflare 控制台进入 **Workers & Pages → Create → Pages → Connect to Git**，选择本仓库。
3. 构建设置：
   - **Framework preset**: `None`
   - **Build command**: *(留空 / leave empty)*
   - **Build output directory**: `/`
4. 保存并部署。之后每次推送到主分支都会自动重新部署。

也可以用 Wrangler 命令行直接部署：

```bash
npx wrangler pages deploy . --project-name now-and-more
```

仓库内的 `wrangler.toml` 已写好项目名 (`now-and-more`) 与输出目录 (`.`)。

## 结构 / Repository structure

```
.
├── index.html        # 页面结构 / page structure
├── css/
│   └── style.css     # 全部样式、五种时钟外观、深色模式 / all styles
├── js/
│   ├── data.js       # 内容池与双语文案 / content pools & i18n strings
│   └── app.js        # 时钟引擎、样式切换、随机轮转、日出月相计算 / engine
├── wrangler.toml     # Cloudflare Pages 配置
└── README.md
```

## 说明 / Notes

- 日出、日落与昼长由页面内嵌的紧凑太阳位置算法现场计算（基于太阳黄经、赤纬与时角），不是查表。
- 月相由朔望月周期现场计算：月龄、照亮比例与月相名称。
- 字体通过 Google Fonts 加载（思源宋体/黑体），离线时自动回退到系统衬线/无衬线字体，不影响使用。
- 诗歌均为公有领域作品。
