# 此时，还有 · Now, and More

> 时间是确定的，下一块是什么，不确定。
> The time is certain. What comes next is not.

一个单页时钟应用：页面中央是一座一秒不差的真时钟（确定性），下方有一张舞台卡，每分钟随机换一块内容（不确定性）。先按权重抽类别，再在类别里抽一条，所以你连下一张会来什么*种类*的东西都不知道。

A single-page clock. At the centre, a precise real clock that never moves (certainty). Below it, one stage card that changes every minute (uncertainty): first a category is drawn by weight, then an item inside it, so you never know even what *kind* of thing comes next.

## 功能 / Features

- **真时钟 / A real clock** — 每秒更新，带日期、星期；中文模式附带农历（站内自算：Meeus 朔望 + 节气求解器，按 GB/T 33661-2017 编排，不用浏览器 Intl）。
- **五种时钟样式 / Five clock styles** — 宣纸大字 (Paper)、极简细体 (Minimal)、模拟表盘 (Analog, SVG 真指针)、翻页钟 (Flip)、竖排 (Vertical)。选择会保存在 localStorage。
- **六个随机池 / Six random pools**（权重）：
  - 与此同时 Meanwhile (30)：135 座城市（含极昼极夜之地）此刻的真实当地时间，卡片右侧有一个以该城市为中心的小地球，阴影是此刻的夜半球，外加现场计算的日出、日落与昼长（含极昼/极夜），还有一张实时计算的月相卡。
  - 一首诗 A Poem (25)：中文公版诗与英文公版诗，随机语言模式出对应语种。
  - 历史上的今天 On This Day (15)：按日期索引的历史事件（双语），每个日期有 `HISTORY` 与 `HISTORY_MORE` 两条以上；当天第 n 次抽到就显示该日期的第 n 条（起点按年份轮换），当天的条目用完后随机抽另一天并标注。/ Date-keyed bilingual events, at least two per date (`HISTORY` plus `HISTORY_MORE`); the nth encounter of the day shows the date's nth event (starting point rotated by year), and once they are used up a random other day is drawn and labelled.
  - 一个念头 A Thought (15)：双语认知短句。
  - 纯偶然 Pure Chance (10)：当场生成的随机整数、骰子、硬币序列、抽牌、随机颜色。
  - 你的从前 Your Past (5)：回望提示，只提问，不编造你的记忆。
  - 七十二候 Micro-seasons (8)：当前所处的「候」（双语，含所属节气、始于何日、下一候），按太阳视黄经每 5° 一候，与节气共用同一个分钟级求解器；节气交节时刻即该节气初候的开始。名称依《月令七十二候集解》。由日期决定，不进牌袋。/ The pentad in force now, at every 5° of the Sun's apparent longitude, solved with the same solver as the solar terms (a term's instant opens its first pentad); names after the Yuan-dynasty Yueling qishi'er hou jijie. Date-determined, never in a deck. Tests: `node --test tests/pentad.test.cjs`.
- **写一句 / Add a note** — 你可以写下一句心得或备忘（≤120 字），存进只属于这台设备的库（IndexedDB），日后像其他内容一样随机回来相遇；若选定了日期，它会在那天作为第一张卡准时送达。写字入口藏在右下角（悬停 / 上滑 / 聚焦时浮现），库本身是独立的一页（`library.html`，「我的库」），在设置里只有一个链接通向它；库页可看全文、删除，页上的「写一句」会回到主页并打开写字框。
- **特殊日明信片 / Special-date postcards** — 节气与节日当天，第一张卡是一张明信片：画满幅在上，下方纸面写几行字；留影即 1080×1440 的成图。图卡（明信片与星空）以信封送达：非氛围模式下舞台先显示一张写明身份的信封卡：与图卡本身一样上图下文，上方是一条横幅式的模糊预览，下方一行写名字与简介、右侧是「点击查看」（最窄的手机上按钮落到文字下方，名字不会被拆开），点击后在透明灯箱里打开图卡。月相、星图、明信片与水彩星空插画均为完整成图，文字与版权说明绘入图内；灯箱只显示图片和「保存图片」「关闭」，保存即当前展示的 PNG，作品带一圈细边。赠送的明信片以打开为送达，未打开会持续呈递；氛围模式下图卡仍直接显示，插画若失败，重试落在画面下方而不是被纸带裁掉。/ Picture cards (postcards and the night sky) arrive as envelopes: outside ambient mode the stage first shows a named envelope card, stacked like the picture itself — a wide blurred glimpse on top, then the name and a line about it with “Tap to view” at the right (on the narrowest phones the button drops under the words, so a name is never split) — and the picture opens in a transparent lightbox. All four picture types contain their text and applicable credits in the artwork itself. Save image downloads the very same PNG displayed in the lightbox, with no second capture preview; the artwork keeps a hairline edge against the dim backdrop. A gifted postcard counts as delivered when opened. In ambient mode pictures still render directly, and a failed illustration places Try again under the artwork instead of inside the clipped paper strip.
- **秒层随机 / Second-layer randomness** — 左下角每秒跳一个新随机数，背景微光每秒随机漂移，还有一条走完一分钟的细进度线。
- **双语 / Bilingual** — 中文 / English 一键切换，按浏览器语言自动首选，选择保存在 localStorage。界面、城市名、诗歌、念头、历史全部双语。
- **交互 / Interaction** — 点卡片、点「再抽一张 / Draw another」或按空格立刻抽下一张；计数器记录「第 N 次相遇 / Encounter N」。同一类别不会连续出现两次（可避免时）。
- 浅色宣纸主题，深色模式跟随系统 (`prefers-color-scheme`)。无账号、无统计、无框架、无构建步骤。
- **三页独立页 / Three standalone pages** — 设置面板链向 `library.html`（我的库）、`privacy.html`（隐私政策）与 `about.html`（关于）三页（双语、随站内语言与外观）：你的库、本站不追踪且个人数据只存本地的完整说明，以及这件作品的自述。

## 抽卡去重 / Draw deduplication

固定内容池使用无放回洗牌袋，正常循环边界不重复；仅在成功渲染后提交进度，并使用 `nam-decks-v2` 在同一浏览器重载时恢复。诗词和名言独立记录中英文进度，切换语言时才抽取需要展示的版本。同一相遇内切回已展示的语言不会再消耗牌组。手动、定时和键盘抽卡共用一个过渡锁；特殊日期赠礼优先，日期确定内容和纯随机值仍允许设计上的重复；历史上的今天在本地自然日最多出现三次（中英文、手动和自动抽卡共用），成功渲染才计数，重绘不计。这条上限单独记在 `nam-history-daily-v1`，不写进 `nam-decks-v2`。仍开着更新前页面的标签不会执行这三条上限，也清不掉已经记下的次数，直到那个标签重新加载。D2 动态新闻采用列表接口、URL/标题指纹、语言独立缓存和 72 小时本地历史（重复间隔至少 30 分钟）。D3 固定内容采用永久 ID；旧版索引状态按冻结的 D2 基线迁移；现代浏览器使用 Web Locks 串行提交多标签页的抽卡及新闻历史。

Fixed pools draw without replacement and avoid repeats across normal bag boundaries. Progress commits after rendering and survives reload in the same browser via `nam-decks-v2`. Poems and quotes consume only the language rendered; revisiting an already displayed variant of the same encounter consumes nothing. Manual, keyboard and timed draws share a transition lock. Date-specific gifts retain priority; deterministic daily cards and chance values may repeat by design. On This Day is capped at three new encounters per local calendar day across languages and manual/automatic draws; failed renders and repaints do not spend a slot. That cap lives in `nam-history-daily-v1`, not in `nam-decks-v2`. A tab still running the previous build cannot apply or erase it until that tab is reloaded. Dynamic news uses the D2 list API, URL/title fingerprints, per-language caching, and a bounded 72-hour local history with a 30-minute minimum repeat cooldown. D3 uses permanent content IDs, frozen D2 index migration and Web Locks for cross-tab draw/history commits.

All five main-page dialogs share a background scroll and focus lock. The clock continues to update, but new draws (including previously queued draws) pause until the dialog closes. Closing restores the saved scroll offset and starts a fresh rotation interval.

Regression tests (Node 22+, no dependencies): `node --test tests/*.test.cjs`.

## 本地运行 / Run locally

纯静态文件，用任何静态服务器即可，例如：

```bash
# Python
python3 -m http.server 8000

# 或 Node
npx serve .
```

然后打开 http://localhost:8000 。直接双击 `index.html` 一般也可以（字体已打包在仓库里，无需联网）。

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
├── index.html        # 主页面 / main page
├── library.html      # 我的库（用户笔记）/ the notes library page
├── privacy.html      # 隐私政策 / privacy policy
├── about.html        # 关于 / about
├── css/
│   └── style.css     # 全部样式、五种时钟外观、深色模式 / all styles
├── js/
│   ├── data.js       # 内容池与双语文案 / content pools & i18n strings
│   ├── horoscope-advice.js # 运势行动建议双语库 / 280 bilingual core actions
│   ├── astro.js      # 星位与每日运势（纯计算，无 DOM）/ star positions & daily horoscope
│   ├── almanac-rules.js # 黄历值神、神煞与宜忌规则表（纯计算）/ almanac 值神, 神煞 & 宜忌 rule tables
│   ├── lunar.js      # 农历：朔望与置闰（GB/T 33661-2017，纯计算）/ the lunar calendar, computed
│   ├── dedup.js      # 牌局状态、迁移与事务化抽卡 / deck state & transactional draws
│   ├── gossip.js     # 热点列表的浏览器侧处理 / client-side news handling
│   ├── sky-engine-adapter.js  # 版本化 Sky Engine 加载与场景缓存 / pinned SDK loader
│   ├── globe.js      # 与此同时的小地球（Natural Earth 陆地 + 逐像素绘制）/ the Meanwhile globe
│   └── app.js        # 时钟引擎、样式切换、随机轮转、产品星空规则 / engine
├── vendor/sky-engine/0.2.0/  # 正式发布的 SDK 与星表（勿手改）/ published SDK, do not edit
├── docs/sky-engine.md
├── assets/
│   ├── fonts/        # 自托管字体切片（勿改回 CDN）/ self-hosted font slices
│   └── special-dates/ # 明信片画作 512×512 WebP / postcard paintings
├── gossip-service/   # 热点 Worker（Git 连接自动部署）/ the news Worker
├── tests/            # Node 回归测试 / regression tests
├── wrangler.toml     # Cloudflare Pages 配置
└── README.md
```

## 说明 / Notes

- 日出、日落与昼长由页面内嵌的紧凑太阳位置算法现场计算（基于太阳黄经、赤纬与时角），不是查表。世界卡片与节气历法仍用这套，不走 Sky Engine。
- 月相卡片是 Sky Engine 的月面肖像（当前时刻，朝向按时间区估算），月龄与照亮比例取自同一次计算。星图是 SDK 的圆形星图。星空插画仍是 SDK 的水彩。星空三形态与明信片同为图卡：非氛围模式下以信封送达、点击在弹窗里打开（SDK 画布只在弹窗里绘制），氛围模式直接显示。日出、日落与节气不走 Sky Engine。见 `docs/sky-engine.md`。
- 字体已自托管（思源宋体/黑体，unicode-range 切片 woff2 在 `assets/fonts/`，OFL 许可同目录），随站点一同提供，不向任何第三方发出请求；用过的切片由 Service Worker 缓存，离线可用。
- 诗歌均为公有领域作品。

### D3 storage and maintenance / 持久化与维护

- The new `nam-decks-v2` key retains static, note, chance and D2 news history separately from legacy pages. The v1 key is left untouched; upgrade is one-way after the first changed v2 transaction. Static index bags migrate only when their recorded length matches the frozen D2 catalog; ambiguous lengths reset that bag, not other histories. Existing date gift receipt keys and IndexedDB notes are retained.
- Each fixed content row in `js/data.js` has a permanent `id`; never reuse or renumber one. Additions enter the remaining cycle; deletions are pruned at the next draw; reorder and wording edits do not change identity. Keep `NAM_LEGACY_DECK_IDS` frozen. Note IDs come from IndexedDB. A dated delivery consumes its note's current-cycle slot, but the once-per-date gift remains mandatory even if previously randomly shown.
- Same-origin D3 tabs with working localStorage and Web Locks serialize choice/render/commit and news reconciliation; each mutation rereads the latest state. The lock is never held across network I/O. Category/encounter counters remain per tab. The On This Day budget is `nam-history-daily-v1` because deployed pages rewrite `nam-decks-v2` as `{v,d,g,fp}` and would drop any field added there. A pre-update tab does not enforce the three-encounter cap, and cannot clear it, until it is reloaded. Old-version pages cannot participate in the rest of the deck protocol until reloaded either. Browsers without Web Locks use best-effort rereads (not strict atomic exclusion); denied storage uses a page-local shadow and cannot guarantee persistence or cross-tab dedup. Note writes/deletes share the lock until IndexedDB commit and revision notification; known-stale note snapshots are excluded while reloading. If an ungifted postcard might compete with an undelivered dated note, the draw waits outside the lock for up to two 500 ms note refresh attempts, then rechecks the current date, revision and receipts under the lock. If the snapshot is still unknown, an ordinary card is shown without consuming either gift; a later draw can deliver the gifts in order. If IndexedDB is known unavailable, the postcard is still offered. A newly due note is offered on a subsequent draw once its snapshot is ready.
- Each bag stores disjoint seen and remaining lists (one ID per current member, plus the last ID). Unchanged rerenders and unchanged news reconciliation do not write storage. Invalid bags are repaired independently; malformed outer JSON safely starts a fresh state. Note text remains in IndexedDB, not deck history.

## 开发注意事项 / Development notes

改这个仓库之前先读这一节——每一条都是踩过坑或明确拍板过的决定。

Read this section before changing anything — every item is either a lesson learned or a deliberate decision.

- **内容 ID 是永久的 / Content IDs are permanent.** 见上文 D3 一节：给内容池加条目只能追加新 `id`，绝不重编号、绝不复用；`NAM_LEGACY_DECK_IDS` 已冻结。改完内容池跑 `node --test tests/*.test.cjs`。/ See the D3 section above: append new IDs only, never renumber or reuse; keep `NAM_LEGACY_DECK_IDS` frozen. Run the tests after touching the pools.
- **版本戳必须同步 / Version stamps move together.** 改任何静态资源，都要把 `sw.js` 的缓存名（`nam-vN`）与所有页面里的 `?v=N` 一起升版，否则 Service Worker 会让用户混用新旧文件。/ Whenever a static asset changes, bump the `sw.js` cache name (`nam-vN`) and every `?v=N` reference in the same commit, or the service worker will mix file versions.
- **PWA 更新 / PWA updates.** 新版 Service Worker 完整预缓存后等待激活；页面底部提示“新版本已就绪”，仅点击“立即更新”才请求激活并刷新当前窗口。选择“稍后”不打断操作，关闭所有旧窗口后浏览器可正常激活。首次安装不提示。启动、回到前台、恢复联网及前台每 15 分钟检查；氛围模式和弹窗期间隐藏提示。四个页面共享 `js/pwa-update.js` 与 `css/pwa-update.css`，已知页面导航使用当前 worker 的版本化外壳，避免新旧 HTML 混用。/ A fully precached update waits for opt-in activation; Later preserves the current session, first install is silent, and the app checks on launch, foreground/online events and every 15 minutes while visible. Known page navigations stay on the active worker's shell. Tests: `node --test tests/pwa-update.test.cjs`.
- **二进制文件不能走文本推送 / Binaries don't ride the text push channel.** 字体 woff2、图片等二进制文件必须由仓库所有者手动上传到 GitHub；`assets/fonts/` 与 `assets/special-dates/` 都是这样进来的。Worker 的 PNG 图标（og-image、favicon 等）以 base64 内嵌在 `gossip-service/assets.js`，原因相同。/ Binary files (font woff2, images) must be uploaded to GitHub by hand — that is how `assets/fonts/` and `assets/special-dates/` got here. The Worker's PNG icons are base64-embedded in `gossip-service/assets.js` for the same reason.
- **部署全自动 / Deployment is fully automatic.** Pages 与 gossip Worker 都是 Git 连接，推 `main` 即部署，不要手动 deploy。Worker 在 `gossip-service/`，其 `/debug` 路径可查看各新闻源的抓取健康。/ Pages and the gossip Worker are both Git-connected; pushing to `main` deploys. Never deploy by hand. The Worker's `/debug` route reports per-source fetch health.
- **热点源的禁区 / Dead ends for news sources — do not retry.** Google News RSS 从 Workers 出口超时/503；微博热搜 ajax 端点 Forbidden、榜单页从 Workers 解析为 0；明报 RSS 返回 403（已撤下）。Facebook 不接：Worker 用不了站长的个人连接，个人 feed 绝不接公开站。/ Google News RSS times out from Workers egress; Weibo's ajax endpoint is Forbidden and its board parses to zero from Workers; Mingpao RSS returns 403 (removed). Facebook is out: a Worker cannot use the owner's personal connection, and a personal feed must never pipe into a public site.
- **天文与历法口径 / Astronomy conventions.** 节气用分钟级求解器（Meeus + VSOP87D 摄动 + 牛顿迭代），已对香港天文台 2026 年表验证（最大误差约 1.3 分钟）——不要换成按日查表或粗略公式。占星一律用回归黄道（tropical），不是恒星黄道。/ Solar terms use the minute-level solver (Meeus + VSOP87D perturbations + Newton iteration), verified against the Hong Kong Observatory 2026 table (max deviation ≈1.3 min) — do not replace it with day tables or coarse formulas. Astrology is tropical, never sidereal.
- **小地球 / The Meanwhile globe.** `js/globe.js` 内嵌 Natural Earth 1:110m 陆地轮廓（公有领域，4.1.0 版，取自 world-atlas 2.0.2 的 land-110m.json），按 0.5° 取整、差分编码，约 23 KB；首次使用时在 1440×720 画布上栅格化为陆地覆盖图，之后逐像素做正射投影反算并双线性取样。夜半球按 `subsolarPoint()` 计算，与卡片上的日出日落共用同一套太阳算法（`tests/globe.test.cjs` 逐城核对）。要更新数据，从 land-110m.json 重新生成，不要手改。/ `js/globe.js` embeds Natural Earth 1:110m land (public domain, v4.1.0 via world-atlas 2.0.2), rounded to 0.5° and delta-encoded (~23 KB), rasterised once to a 1440×720 coverage mask and sampled bilinearly per pixel of an orthographic globe. Night comes from `subsolarPoint()`, the same solar model as the card's sunrise and sunset (checked city by city in `tests/globe.test.cjs`). Regenerate from land-110m.json rather than editing by hand.
- **每日运势 / Daily horoscope.** 以本地自然日的完整近似回归黄道星位为采样，按七颗传统天体、守护星、太阳星座整宫、相位、庙旺落陷（入庙/擢升/失势/落陷）、灼伤与日核及逆行规则计算四项评分与综合评分；木星、土星在一个星座停留一至三年，其宫位关系、宫位主题加分和庙旺按 0.4 倍计入，以免单一慢行星定下某星座全年基调；逆行扣分按天体区分（水、金 0.5，火 0.45，木、土 0.2）；V3.0 将本地自然日按实际经过时间分为四个等长区间，在所有天体换座及五颗行星顺逆行转换时细分，每个子区间中点统一计算七颗天体，以时长加权平均原始评分（23/25 小时夏令时日期同样适用），最后才转换星级；保留每颗天体、六种评分因素及每次采样的可加贡献，全文显示代表采样时间及约值；主卡展示评分与简短建议，全文弹窗按实际天体、太阳星座宫位、相位类型、逆行及运势领域组合双语象征解析和生活建议，相同采样时刻的共享星位与互为倒向的相位仅展开一次，各领域另显示原加权评分中最大的正向、负向贡献；行动建议库包含四领域×七天体×十条，共280组双语核心建议；固定十日轮转（3/3/2/2）在候选窗口内按宫位、相位、逆行和评分贡献匹配，至多重放前两个本地日期的评分，保证同一星座七天内核心建议不重复，无需存储阅读历史。日期种子只改变措辞和象征性幸运提示，不决定评分或解析依据。特殊天象由同一近似星历计算：太阳及水、金、火、木、土星跨越回归黄道星座边界（含逆行回到上一星座），五颗行星开始逆行或恢复顺行；按本地自然日半开区间检测，每三小时扫描并细化变化时刻，临近午夜可能有跨日误差。主卡仅显示一行提示，全文按所选太阳星座宫位解读全部事件；事件时刻用于细分全天采样，专题文字本身不另行加减分或直接改变建议轮转与幸运提示，普通日期不显示提示。太阳星座宫位不是出生星盘；评分是人为设定的娱乐规则，不代表科学预测。/ The horoscope uses complete approximate tropical ephemeris samples across the local civil day, the seven traditional bodies, ruler weighting, whole-sign solar houses, aspects, essential dignity (domicile/exaltation/detriment/fall), combustion/cazimi and retrograde to derive four domain ratings and an overall rating. Jupiter and Saturn placement terms (house relation, house-topic bonus, dignity) count at 0.4× so one slow placement cannot set a sign's tone for a year; retrograde caution is body-specific (Mercury/Venus 0.5, Mars 0.45, Jupiter/Saturn 0.2); V3.0 divides the actual elapsed local civil day into four equal intervals, splitting at all body ingresses and planetary stations. Each subinterval midpoint computes all seven bodies together, duration-weights unrounded contributions, then converts to stars (including 23/25-hour DST days). The additive audit retains every body, six scoring factors and each sample; full text identifies representative sample times and approximate contributions. Weights live in `HORO_MODEL` in `js/astro.js`, and a five-year distribution test guards cross-sign fairness. It shows a compact summary and a full-text dialog. Bilingual interpretations compose the actual contributing body, solar house, aspect type, retrograde and domain into symbolic explanations and practical prompts. Shared placements and reciprocal aspects at the same sample are explained once; each domain separately reports the largest positive and negative contributions to its existing weighted mean. The advice library has 280 distinct bilingual core actions (four domains × seven bodies × ten). A stable ten-day rotation (3/3/2/2) ranks eligible actions using house, aspect, retrograde and score contribution; replaying at most two earlier local-day scores prevents repeats within seven days for the same sign without storing reading history. The date seed varies wording and symbolic lucky cues only, never ratings or interpretation inputs. Special events use the same approximate ephemeris: sign ingresses of the Sun, Mercury, Venus, Mars, Jupiter and Saturn (including backward crossings), plus retrograde/direct stations of the five planets. Events are assigned to half-open local civil days by three-hour sampling and refinement; approximate near-midnight events may be off by a day. A compact card notice leads to all event readings in the existing dialog, contextualized to the selected solar-sign houses. Event epochs split daily integration intervals; event text adds no independent score adjustment and does not directly change advice rotation or lucky cues, and ordinary days have no event notice. This is an editorial entertainment model, not a natal chart or scientific prediction. Tests: `node --test tests/horoscope.test.cjs`.
- **运势全文 / Horoscope reading.** 全文弹窗按结构排版：标题与综合星级、四项领域卡片（点按跳转）、V3.3 时间尺度（三项合计及代表贡献、较昨日变化）、今日天象、各领域（先建议，后依据、逐天体贡献条形图与因素分解）、共享星位解读（标签化证据）、幸运提示与说明。版式字段来自 `horoscopeFullDoc()`，纯文本全文由同一字段拼接（`horoscopeFullDocText()`），两者内容一致。/ The full-text dialog lays the horoscope out as a header with the overall rating, four area tiles that jump to their sections, the V3.3 time scales (three totals, representative contributors and the change since yesterday), sky events, the four areas (suggestion first, then its evidence, per-body contribution bars and the factor breakdown), the shared sky readings with tagged evidence, lucky cues and the method note. Layout fields come from `horoscopeFullDoc()`; the plain full text joins the same fields (`horoscopeFullDocText()`), so both say the same thing.
- **星历精度 / Ephemeris accuracy.** 运势星历相对 JPL Horizons（DE441）的误差、角速度、星座与相位一致率、换座与驻留时刻误差见 [docs/ephemeris-accuracy.md](docs/ephemeris-accuracy.md)；`node --test tests/ephemeris-accuracy.test.cjs` 防止任何一项变差。参考数据离线保存于 `tests/fixtures/ephemeris-reference.json`，站点运行时不访问星历服务。/ Errors of the horoscope ephemeris against JPL Horizons (DE441), plus velocity, sign and aspect agreement and ingress/station timing, are in [docs/ephemeris-accuracy.md](docs/ephemeris-accuracy.md); `node --test tests/ephemeris-accuracy.test.cjs` fails if any figure gets worse. The reference is stored offline; the site never calls an ephemeris service.
- **黄历规则 / Almanac rules.** 农历（自算朔望与置闰，1950–2100 逐月对照 cnlunar、朔时对照 JPL Horizons）、日界、节月（建除按「节」换月）、年名、冲煞、黄道黑道值神、吉神凶神、纳音与吉神方位，以及按《协纪辨方书》卷十由建除与神煞合成的宜忌（黄历中没有任何随机成分）的口径和出处见 [docs/almanac-rules.md](docs/almanac-rules.md)；`node --test tests/almanac-golden.test.cjs` 逐日比对 2025–2028 年的独立参考数据，`tests/almanac-yiji.test.cjs` 守住宜忌一致度的底线。/ Day boundary, 节月 (建除 switch at each 节), year label, 冲煞, 值神, 吉神/凶神, 纳音, god directions and the rule-derived 宜/忌 (nothing in the almanac is random) are documented with sources in [docs/almanac-rules.md](docs/almanac-rules.md), as is the site's own lunar calendar (new moons and leap months computed, checked month by month 1950–2100 against cnlunar and new moon by new moon against JPL Horizons; `tests/lunar.test.cjs`); the golden test checks every day of 2025–2028 against an independent reference, and the 宜忌 agreement test guards a recorded baseline.
- **星空引擎只在 Elsewhere 改 / Sky drawing has one source.** 星图与插画的位置和画法来自 `vendor/sky-engine/` 里固定版本的 Sky Engine SDK，不要把算法再抄回 `js/app.js`。升级步骤在 `docs/sky-engine.md`。特色星群（`SKY_PATTERNS`）留在本仓库。/ Star-chart positions and the illustration are the pinned Sky Engine SDK under `vendor/sky-engine/`. Do not copy the algorithms back into `js/app.js`. Upgrade steps are in `docs/sky-engine.md`. Signature asterisms (`SKY_PATTERNS`) stay in this repo.
- **内容纪律 / Content discipline.** 诗歌、名言的署名必须真实可核；历史事件故意避开日期有争议者；明信片文案全部原创，不伪造古文引文。热点是全品类（新闻/体育/科技/娱乐），不只是娱乐。/ Poem and quote attributions must be real and verifiable; history entries deliberately avoid disputed dates; postcard copy is all original — never fabricate classical quotations. Trending is all-category, not entertainment only.
- **名言署名格式 / Quote attributions.** 中文：渲染为「——作者《作品》」，破折号占两格、不空格，作品名放在 `author` 里的书名号中。英文：渲染为「— Author, *Work*」，书、剧、电影等长篇作品放在 `work` 字段并以斜体显示；诗、散文等短篇作品留在 `author` 里，用直单引号（如 `T. S. Eliot, 'Little Gidding'`），不要用弯引号——衬线字体栈以 Noto Serif SC 打头，弯引号会显示成全角。数据里不写破折号。常见误传（如“Be the change…”归于甘地）不收；出处存疑的宁可不收。/ Chinese renders as ——作者《作品》 (two-em dash, no space). English renders as “— Author, *Work*”: long works go in `work` (italic); short works stay in `author` in straight single quotes, never curly quotes (the serif stack starts with Noto Serif SC, which draws them full-width). Data never carries the dash. Leave out well-known misattributions and anything that cannot be sourced.
- **明信片是固定构图 / The postcard composition is fixed.** 整卡 3:4：画 1080×1080 满幅贴顶、纸区 360、正文 ≤3 行。文案超长就改文案，不改构图。清明节日版恒压节气版（`qingming.webp` 不露面）是有意设计，不是 bug。新画作 512×512 WebP 可用，重出建议 1024 宽。/ The card is 3:4 — painting 1080×1080 full-bleed on top, 360px paper zone, passages ≤3 lines. If copy overflows, shorten the copy, never the composition. The festival Qingming always outranks the solar-term one (`qingming.webp` never surfaces) by design. New paintings: 512×512 WebP works; 1024 wide preferred.
- **产品红线 / Product red lines.** 类别权重是编辑配比，访客不可调：不给滑杆、不给类别开关、不给预设——这是明确决定，不要以"增强可控性"为名加回来。无账号、无统计、无追踪；个人数据（设置、我的日子、笔记库、牌局）只存本机（localStorage / IndexedDB），从不上传。/ Category weights are an editorial mix and are NOT user-adjustable: no sliders, no category toggles, no presets — a deliberate decision; do not re-add them as "user control". No accounts, no analytics, no tracking; personal data (settings, my days, the notes library, decks) lives only on the device and is never uploaded.
- **隐私页必须与代码一致 / The privacy page must stay true to the code.** `privacy.html` 承诺本站不发出任何第三方请求（字体自托管于 `assets/fonts/`，勿改回 Google Fonts CDN）。凡改动涉及网络请求、外部资源或数据存储，先核对隐私页的每句话是否仍然属实，并同步修改。/ `privacy.html` promises zero third-party requests (fonts are self-hosted in `assets/fonts/` — do not switch back to a CDN). Any change touching network requests, external resources or data storage must re-verify every sentence of the privacy page and update it in the same commit.
- **抽卡语义不可绕过 / Draw semantics are load-bearing.** 礼物送达优先级：定期笔记 > 特殊日明信片 > 普通抽卡。豁免清单：黄历、七十二候与历史上的今天由日期决定、自选星座运势直达——不要把它们塞进牌袋；历史类别受每日三次上限约束。抽卡状态只能经 `deckState.transact()` 修改，不要直接写 `nam-decks-v2` 或 `nam-history-daily-v1`。/ Gift priority: dated note > special-date postcard > ordinary draw. Exempt by design: the almanac, the micro-seasons, on-this-day (date-determined) and the user's own-sign horoscope (direct) — never put them in a deck. The history category is still subject to its daily limit of three. Deck state changes only through `deckState.transact()`; never write `nam-decks-v2` or `nam-history-daily-v1` directly.
- **iOS 表单字号 / Form controls on iOS.** 触屏下所有 `input/select/textarea` 字号必须 ≥16px（`css/style.css` 末尾的 `(pointer: coarse)` 规则），否则 iPhone Safari 聚焦时自动放大页面。新增表单控件时沿用这条规则，不要动 viewport meta 去禁用缩放。/ Under a coarse pointer every form control must render at ≥16px (the `(pointer: coarse)` block at the end of `css/style.css`), or iPhone Safari zooms the page on focus. New form controls follow the rule; never "fix" it via the viewport meta.
- **中英文字距与焦点环 / Tracking and focus rings.** 宽字距（0.1em 以上）只给中文；英文在 `css/style.css` 的 `:root:lang(en)` 一节收回到接近正常，红色小标签改为大写。新增带字距的界面文字时，同时在该节补上英文值。键盘焦点统一用 `:where(...):focus-visible` 的朱砂色描边；父元素 `overflow: hidden` 的控件（分段按钮）改用内描边 `outline-offset: -2px`，卡片自己重申实线描边（由 `tests/card-focus.browser.py` 守护）。/ Wide tracking (0.1em+) is for Chinese only; the `:root:lang(en)` block in `css/style.css` brings English back to near-normal and sets the accent labels as uppercase. Any new tracked UI text gets its English value there too. Keyboard focus is the shared vermillion `:where(...):focus-visible` ring; controls clipped by an `overflow: hidden` parent (segmented buttons) draw it inset (`outline-offset: -2px`), and the stage card restates a solid ring (guarded by `tests/card-focus.browser.py`).

### V3.1 aspect dynamics

Seven-body geocentric longitude velocities use a centered ±1-hour circular difference. Relative velocity and the nearest oriented aspect residual determine applying/separating; exact tolerance is 0.05°, stationary threshold 0.01°/day. Weights 1.10/1.15/0.90/1.00 respectively blend smoothly over 0.05–0.75° and 0.01–0.05°/day. Both signed contributions are scaled; existing caps and solar exclusions remain. Exact major aspects are calculated lazily for the full reader, without extra quadrature cuts or event scoring. Main cards show ingress/station events only; the full reader retains all exact aspects. The five-year comparison was regenerated against the optimized ingress/station-only quadrature (2026–2030 UTC, all twelve signs). Exact-aspect cuts are intentionally omitted to reduce cost; continuous relative-motion weights remain in the daily samples. Approximate model epochs are not precise observations. See `docs/horoscope-v3.1-backtest.json` for the five-year UTC comparison. Astrology scores are editorial entertainment, not scientific predictions.

### Horoscope V3.2 (experimental domain rulers and pair weights)

V3.2 adds traditional solar whole-sign domain rulers and bounded, symmetric body-pair/major-aspect multipliers to V3.1. The four domain ratings remain normalized, duration-weighted sums of the same six factors. Pair geometry is shared across endpoints and signs; endpoint contributions retain the V3.1 signed net cap. Zeroing both scales restores V3.1. The full reader explains participating rulers and nonzero weighted pair reflections in both languages. These are symbolic editorial rules, not scientifically validated forecasts.

Run the pinned-baseline, five-year ablation with a full git history:

```sh
mkdir -p backtest-output
TZ=UTC node scripts/horoscope-v3.2-backtest.cjs 2026-01-01 2031-01-01 > backtest-output/horoscope-v3.2-backtest.json
node --test tests/horoscope-v3.2.test.cjs
```


Final candidate: house scale 0.2, pair scale 0.5. See [five-year ablation](docs/horoscope-v3.2.md) and [aggregate JSON summary](docs/horoscope-v3.2-backtest.json).

### Horoscope V3.3 (multi-time-scale factor ledger)

V3.3 partitions existing normalized, capped V3.2 factors into background, trend and daily contributions, preserving shared sky samples, the single final star conversion, signed aspect caps and seven-day advice uniqueness. The full reader shows bilingual raw-score layer contributions and net day-to-day change, not additional ratings or predictions. See [model definition and verification limits](docs/horoscope-v3.3.md), [local experimental data](docs/horoscope-v3.3-backtest.json) and `TZ=UTC node scripts/horoscope-v3.3-backtest.cjs` for the reproducible pinned-baseline/holdout experiment.
