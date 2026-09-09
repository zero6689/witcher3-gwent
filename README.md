# 昆特牌 · 巫师3 网页版（Gwent · TW3）

用 HTML/CSS/原生 JS 复刻的《巫师3：狂猎》内置小游戏**昆特牌**（经典三排版）：
完整核心规则 + 官方卡面 + 卡组编辑器 + 四档难度 + 音效与出牌动画 + 开场动画与结算面板 + 手机端适配。

> **二创同人作品 · 非商业用途 · 仅供个人学习娱乐** —— 详见 [版权与声明](#版权与声明) 与 [LICENSE](LICENSE)

## 🌐 在线玩（手机可直接打开）

**https://zero6689.github.io/witcher3-gwent/**

## 📱 安装到手机（PWA）

用手机浏览器打开上面的网址 → 菜单里选「**添加到主屏幕**」，即可像 App 一样全屏运行，
有独立图标（金色狼首徽章），**断网也能玩**（Service Worker 已缓存应用外壳与卡面）。

## 📦 打包成 APK

仓库已内置 Capacitor 工程与 GitHub Actions 工作流，**不用在本机装 Android SDK**：

1. 打开仓库的 **Actions** 页 → 选 **Build Android APK** → **Run workflow**；
2. 等 3-5 分钟构建完成，在该次运行页面底部下载 **Artifacts → gwent-android-apk**；
3. 把 APK 传到手机，允许「安装未知来源应用」后安装。

打 tag（如 `git tag v1.0.0 && git push --tags`）时会自动发布到 **Releases** 供直接下载。

本机构建（需 JDK 17 + Android SDK）：

```bash
node scripts/prepare-www.js          # 把网页资源复制到 android-app/www
cd android-app
npm install
npx cap add android
npx @capacitor/assets generate --android --iconBackgroundColor "#0b0705" --splashBackgroundColor "#0b0705"
npx cap sync android
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

应用图标由 `scripts/make-icons.js` 纯代码生成（金色狼首徽章，与开场动画同一个图案）：
`node scripts/make-icons.js` 可重新生成所有尺寸（含 Android 自适应图标的前景/背景层）。

## 快速开始（本地）

**方式一：直接打开** `index.html`（无需构建、无需服务器）。

**方式二：本地 / 局域网服务器**

```powershell
node server.js            # 默认 0.0.0.0:8080
npm start                 # 同上
```

启动后会打印本机 / 局域网 / Tailscale 地址，同一 WiFi 下的手机、平板可直接访问。

## 功能

### 开场动画与结算
- **开场动画**：首次进入自动播放（狼首徽章 + 金色标题渐显 + 余烬），约 6 秒，可随时「跳过」；主菜单可重播。
- **结算界面**：局末弹出战绩面板 —— 胜负标题、大比分、逐局比分，以及双方对照统计
  （打出单位 / 特殊牌 / 间谍 / 医生复活 / 召唤 / 天气 / 号角 / 焚风 / 领袖技 / 过牌次数 / 出牌总战力）。
- **出牌飞行动画**：手牌点击后从手牌位置带弧线飞到目标排并落位；特殊牌飞向中线消散；AI 出牌从对方信息栏飞出。

### 主菜单与设置
- **主菜单**：开始游戏 / 配置卡牌 / 开场动画 / 音乐与音效 / 关于·声明。
- **设置面板**：背景音乐开关与音量、游戏音效开关、重新开始、返回主菜单。

### 背景音乐（BGM）
- 右下角常驻播放条：上一首 / 播放暂停 / 下一首 / 音量，设置自动记忆。
- 浏览器禁止自动播放 → **首次点击或触摸后自动开始**。
- **内置合成曲**：仓库不附带任何 OST 音频，默认播放一段**原创的中世纪酒馆风循环**
  （Web Audio 实时合成：低音持续音 + 鲁特琴琶音 + 框鼓），无版权问题。
- **换成真正的巫师3 OST**：把文件放进 `assets/audio/`（见该目录 README），
  命名为 `widow-maker.mp3` 等即可自动优先播放，内置合成曲自动让位。

### 卡组编辑器
- 规则与原版一致：**单位牌 22–40 张**、**特殊牌 ≤10 张**、同名卡不超过持有张数；4 位领袖任选其一。
- 卡池支持 **+/− 按钮**与点击加减；底部显示总战力与间谍/医生/召唤/同袍数量统计。
- 「一键填充」按价值优先级自动配好一套合法牌组；牌组按阵营保存在 `localStorage`。

### 难度分级

| 难度 | AI 强度 | 特点 |
|---|---|---|
| 简单 | 0.15 | 牌组更弱（只带 24 张最弱单位）、频繁失误、会无理由过牌 |
| 普通 | 0.5 | 按战力出牌，偶有失误 |
| 困难 | 0.8 | 算牌差、保关键牌、精准过牌、会用领袖技 |
| 大师 | 1.0 | 零失误、完整过牌判断、间谍/医生/召唤连锁、天气压制 |

实测（同一套固定玩家策略，每档 96 局，固定随机种子）：玩家胜率 简单 74% → 普通 43% → 困难 43% → 大师 35%。

### 音效与动画
- **音效全部实时合成**（Web Audio API），零音频文件：出牌、落桌、间谍、医生、召唤、天气、天晴、号角、焚风、诱饵、过牌、局胜/局负、整局胜负。
- 出牌旋转落下、新牌滑入、号角呼吸光晕、焚风与局末全屏闪光、天气特效（结霜/漂雾/斜雨）、总分滚动。

### 规则实现（完整核心规则）

- **三局两胜**；每局双方轮流出牌或「过」，双方都过后比总战力。
- **三排**：近战 / 远程 / 攻城；**天气**使对应排非英雄单位降为 1；**号角**使该排非英雄单位 ×2。
- **英雄**免疫天气 / 号角 / 焚风 / 诱饵 / 医生复活。
- **技能**：间谍、医生、同袍、召唤、鼓舞、焚风（全场 >10 时摧毁最强非英雄）。
- **领袖技**：每阵营 4 位，每局一次（放晴、排翻倍、牌组取天气、摧毁敌方整排、封锁对手领袖等）。
- **换牌**：开局换 2 张；第 2、3 局开始前补抽至 10 张。
- **点一下手牌就打出去**：单位自动落到对应排，敏捷牌自动选最有利排，间谍自动打到对方场上，
  天气/天晴/焚风立即生效，号角自动放到收益最大排（只有「诱饵」需要点选目标）。

## 卡池

基础游戏 **143 种卡**（4 阵营 + 中立 + 特殊牌），数据经两套独立来源交叉核对：

| 来源 | 用途 |
|---|---|
| [asundr/gwent-classic](https://github.com/asundr/gwent-classic) | 战力/排位/技能/张数（引擎级数据） |
| [gwentcards.github.io](https://github.com/gwentcards/gwentcards.github.io) | 卡池集合与实体张数（全收集清单） |
| [gosunoob 卡表](https://www.gosunoob.com/witcher-3/witcher-3-gwent-cards-list/) | 领袖文字/行位 tiebreak |

已排除：独立版《巫师之昆特牌》数据、Skellige 牌组、石之心/血与酒新增卡。

界面观感参考了 [664235822/GwentCard](https://github.com/664235822/GwentCard)（Unity3D 复刻版）的截图与设计文档
（卡面圆徽/阵营竖条/月桂花环/信息栏布局），**代码为独立实现，未复制其源码**。

## 目录结构

```
index.html               页面骨架
manifest.webmanifest     PWA 清单（可安装）
sw.js                    Service Worker（离线缓存）
server.js                零依赖静态服务器
package.json             npm 脚本
LICENSE                  MIT（代码）+ 素材版权说明
css/style.css            全部样式与动画
assets/cards/            143 张卡面（本地 webp）
assets/emblems/          阵营盾徽（官方图，本地 png）
assets/audio/            BGM 目录（音频文件需自行放入）
icons/                   应用图标（PWA，代码生成）
js/art.js                卡牌 → 本地卡面路径映射
js/emblems.js            盾徽图片 + SVG 兜底 + 月桂花环生成
js/data.js               阵营、领袖、卡池、组牌规则、难度定义
js/engine.js             规则引擎（纯逻辑，含事件队列与战绩统计）
js/ai.js                 四档难度 AI
js/audio.js              Web Audio 合成音效
js/bgm.js                BGM 播放器 + 内置合成曲
js/deckbuilder.js        卡组编辑器
js/ui.js                 DOM 渲染、动画、结算面板
js/main.js               主菜单 / 开场动画 / 设置 / 开局流程
android-app/             Capacitor Android 工程（打包 APK 用）
.github/workflows/       GitHub Actions 云端编译 APK
scripts/                 卡图下载、图标生成、资源打包
test/                    测试套件
```

## 测试

```powershell
npm test                    # 全部五套
node test/static-check.js   # 脚本加载顺序/全局声明冲突/DOM id/跨文件符号
node test/headless-test.js  # 4 阵营两两对阵 12 组，自动打完整局
node test/ui-smoke.js       # 自建 DOM 垫片，跑真实 UI 流程（15 项断言）
node test/auto-play-test.js # 「点卡自动上场」行为
node test/difficulty-test.js# 四档难度胜率曲线（固定种子，可复现）
```

## 版权与声明

- 本项目是**《巫师3：狂猎》内置昆特牌的二次创作（同人作品）**，出于对这款游戏的喜爱而制作，
  **仅供个人学习与娱乐，不用于任何商业用途**，不提供付费服务、不投放广告、不涉及任何盈利行为。
- 游戏内卡面原画、阵营盾徽、角色形象与专有名词的版权归 **CD Projekt RED** 及原作者所有；
  本项目仅以学习、研究为目的引用，未做任何商业性使用。
- **代码以 MIT 许可证开源**（见 [LICENSE](LICENSE)）；游戏素材不在 MIT 授权范围内。
- 代码由 **AI 辅助编写**（DeepSeek Harness），作为技术演示与学习用途。
- 若版权方认为不妥，请联系删除，本项目会立即下线相关内容。

## 已知限制

- 没有卡牌收集/解锁系统：编辑器里可用的是该阵营的全部卡池（等同于"全收集"）。
- 领袖技「弃 2 抽 1」自动弃掉战力最低的 2 张，不提供手动选择。
- 部分中文译名按社区通行译法，个别专有名词可能与官方简中略有出入。
- APK 为 **debug 签名**（可直接安装，但不上架应用商店）；如需发布请自行配置正式签名。
