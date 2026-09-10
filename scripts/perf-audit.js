/* ============================================================
 * 真机浏览器性能体检（Edge/Chrome headless + CDP）
 *
 * 目的：量化「加载卡牌速度」，验证优化效果（图片体积、懒加载、卡面预热）。
 * 用法：
 *   node scripts/perf-audit.js                     # 默认 http://127.0.0.1:8080
 *   node scripts/perf-audit.js http://host:port    # 指定地址
 *
 * 依赖：本机 Edge 或 Chrome（脚本自动探测），Node 内置 WebSocket（Node >= 22）。
 * 输出：out/perf-report.json + 控制台表格
 * ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const OUT_DIR = path.join(__dirname, '..', 'out');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Chrome/Edge');
}

async function cdpTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

/** 极简 CDP 客户端（只用 WebSocket + JSON-RPC，避免引入 puppeteer） */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('WS 连接失败')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) c.handlers.forEach(h => h(msg));
    };
    return c;
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    });
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = findBrowser();
  const port = 9333;
  const profile = path.join(os.tmpdir(), 'gwent-perf-profile-' + Date.now());
  const proc = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,900',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(250);
    try {
      const list = await cdpTargets(port);
      const page = list.find(t => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
  }
  if (!wsUrl) { proc.kill(); throw new Error('浏览器调试端口未就绪'); }

  const cdp = await CDP.connect(wsUrl);
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /* 轮询直到页面出现某个选择器，返回耗时（毫秒），超时抛错 */
  async function until(sel, timeoutMs) {
    const t = Date.now();
    const step = 100;
    while (Date.now() - t < (timeoutMs || 20000)) {
      const r = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `!!document.querySelector(${JSON.stringify(sel)})`,
      });
      if (r.result.value) return Date.now() - t;
      await sleep(step);
    }
    throw new Error(`等待 ${sel} 超时`);
  }
  const evalJSON = async (expr) => (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: expr })).result.value;
  const click = (expr) => cdp.send('Runtime.evaluate', { expression: `(${expr})?.click();` });

  const RES_SUMMARY = `(() => {
    const rs = performance.getEntriesByType('resource');
    const cards = rs.filter(r => /assets\\/cards\\//.test(r.name));
    const sum = (a) => a.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0);
    return {
      requests: rs.length,
      totalKB: Math.round(sum(rs) / 1024),
      cardRequests: cards.length,
      cardKB: Math.round(sum(cards) / 1024),
      shellKB: Math.round((sum(rs) - sum(cards)) / 1024),
    };
  })()`;

  // —— 阶段 1：冷启动（含开场动画）→ 主菜单 ——
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  const tMenu = await until('.main-menu', 25000);
  const shellAtMenu = await evalJSON(RES_SUMMARY);
  await sleep(2500);                                   // 让后台预热再跑一会儿
  const shell = Object.assign({ timeToMenuMs: tMenu, msSinceMenu: Date.now() - t0 - tMenu }, await evalJSON(RES_SUMMARY));

  // —— 阶段 2：进卡组编辑器，量首屏卡面（「配置卡牌」路径：选阵营后直接进编辑器）——
  await click(`[...document.querySelectorAll('[data-mm]')].find(b => b.dataset.mm === 'config')`);
  await until('.fc', 6000);
  const tClick = Date.now();
  await click(`[...document.querySelectorAll('.fc')].find(b => b.dataset.fac === 'northern')`);
  await until('.pool-card', 6000);
  const poolSeenMs = Date.now() - tClick;
  const POOL = `(() => {
    const imgs = [...document.querySelectorAll('.pool-card img.art')];
    const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0);
    return {
      poolCards: document.querySelectorAll('.pool-card').length,
      poolImgTags: imgs.length,
      lazyTags: imgs.filter(i => i.getAttribute('loading') === 'lazy').length,
      loadedCount: loaded.length,
    };
  })()`;
  const poolAtStart = await evalJSON(POOL);
  await sleep(700);
  const poolMid = await evalJSON(POOL);
  await sleep(1300);
  const poolEnd = Object.assign({ firstPaintMs: poolSeenMs }, await evalJSON(POOL), await evalJSON(RES_SUMMARY));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'perf-deckbuilder.png'), Buffer.from(shot.data, 'base64'));

  // —— 阶段 3：真开一局，量牌桌首屏（手牌 + 双方排面）——
  await cdp.send('Runtime.evaluate', { expression: `sessionStorage.setItem('gwent.intro','1'); location.reload();` });
  await until('.main-menu', 15000);
  await click(`[...document.querySelectorAll('[data-mm]')].find(b => b.dataset.mm === 'play')`);
  await until('.fc', 5000);
  await click(`[...document.querySelectorAll('.fc')].find(b => b.dataset.fac === 'northern')`);
  await until('.diff-card', 5000);
  await click(`[...document.querySelectorAll('.diff-card')].find(b => b.dataset.diff === 'normal')`);
  await until('.pool-card', 8000);
  await click(`[...document.querySelectorAll('[data-act]')].find(b => b.dataset.act === 'auto')`);
  await sleep(200);
  await click(`[...document.querySelectorAll('[data-act]')].find(b => b.dataset.act === 'start')`);
  await until('#mullNone', 8000);
  await click(`document.getElementById('mullNone')`);
  const tBoard = Date.now();
  await until('#playerHand .card', 8000);
  const boardSeenMs = Date.now() - tBoard;
  await sleep(800);
  const board = Object.assign({ boardSeenMs }, await evalJSON(`(() => {
    const imgs = [...document.querySelectorAll('.card img.art')];
    const hand = [...document.querySelectorAll('#playerHand img.art')];
    const kb = (list) => Math.round(list.reduce((s, i) => {
      const e = performance.getEntriesByName(i.src)[0];
      return s + (e ? (e.encodedBodySize || e.transferSize || 0) : 0);
    }, 0) / 1024);
    return {
      cardEls: document.querySelectorAll('.card').length,
      imgTags: imgs.length,
      loadedAll: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      handImgs: hand.length,
      handLoaded: hand.filter(i => i.complete && i.naturalWidth > 0).length,
      handKB: kb(hand),
      boardKB: kb(imgs),
    };
  })()`), await evalJSON(RES_SUMMARY));
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'perf-board.png'), Buffer.from(shot2.data, 'base64'));

  /* —— 阶段 4：布局体检（手牌是否在首屏内可见）——
     在几种常见录制分辨率下量「手牌底边 vs 视口高度」，
     并试算「按视口高度自适应卡宽」的候选方案，看能否一屏放下。 */
  const LAYOUT = `(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const hand = document.getElementById('playerHand');
    const hb = hand.getBoundingClientRect();
    const cs = getComputedStyle(hand.querySelector('.card') || hand);
    return {
      vw, vh,
      pageScrollH: Math.round(document.documentElement.scrollHeight),
      handTop: Math.round(hb.top), handBottom: Math.round(hb.bottom),
      handFullyVisible: hb.bottom <= vh + 1 && hb.top >= 0,
      handCardW: cs.width,
      overflowPx: Math.max(0, Math.round(hb.bottom - vh)),
      scrollable: document.documentElement.scrollHeight > vh + 1,
    };
  })()`;
  const layout = {};
  for (const [w, h] of [[1920, 1080], [1600, 900], [1440, 900], [1366, 768]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    if (await evalJSON(`typeof UI !== 'undefined' && !!UI.render`)) await evalJSON(`(() => { UI.render(); return true; })()`);
    await sleep(400);
    layout[w + 'x' + h] = await evalJSON(LAYOUT);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const shot3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'perf-board-1080p.png'), Buffer.from(shot3.data, 'base64'));

  const report = {
    url: BASE,
    coldStart: Object.assign({}, shell, { atMenu: shellAtMenu, timeToMenuMs: tMenu }),
    deckBuilder: Object.assign({}, poolEnd, { atOpen: poolAtStart, after700ms: poolMid }),
    board,
    layout,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'perf-report.json'), JSON.stringify(report, null, 2));

  console.log('\n=== 冷启动（打开网页 → 主菜单可点） ===');
  console.log(`到主菜单 ${report.coldStart.timeToMenuMs} ms（含开场动画）`);
  console.log(`刚进菜单：请求 ${report.coldStart.atMenu.requests} 个 / ${report.coldStart.atMenu.totalKB} KB（外壳 ${report.coldStart.atMenu.shellKB} KB + 卡面 ${report.coldStart.atMenu.cardRequests} 张 ${report.coldStart.atMenu.cardKB} KB）`);
  console.log(`再等 2.5s（后台预热推进）：卡面 ${report.coldStart.cardRequests} 张 / ${report.coldStart.cardKB} KB，总计 ${report.coldStart.totalKB} KB`);

  console.log('\n=== 冷启动 → 卡组编辑器首屏 ===');
  console.log(`卡池渲染 ${report.deckBuilder.firstPaintMs} ms | 卡数 ${report.deckBuilder.poolCards} | <img> ${report.deckBuilder.poolImgTags}（lazy ${report.deckBuilder.lazyTags}）`);
  console.log(`刚渲染完已出图 ${report.deckBuilder.atOpen.loadedCount} 张 → 0.7s 后 ${report.deckBuilder.after700ms.loadedCount} 张 → 2s 后 ${report.deckBuilder.loadedCount} 张`);
  console.log(`累计卡面 ${report.deckBuilder.cardRequests} 张 / ${report.deckBuilder.cardKB} KB（含后台预热）`);

  console.log('\n=== 开一局 → 牌桌首屏 ===');
  console.log(`牌桌渲染 ${report.board.boardSeenMs} ms | 卡牌元素 ${report.board.cardEls} | <img> ${report.board.imgTags}（已加载 ${report.board.loadedAll}）`);
  console.log(`手牌 ${report.board.handImgs} 张，已加载 ${report.board.handLoaded}，手牌卡面合计 ${report.board.handKB} KB`);
  console.log(`累计卡面 ${report.board.cardRequests} 张 / ${report.board.cardKB} KB`);

  console.log('\n=== 布局体检：手牌是否在首屏内 ===');
  for (const [k, v] of Object.entries(report.layout)) {
    console.log(`${k}  手牌 ${v.handTop}→${v.handBottom} / 视口 ${v.vh} | 手牌卡宽 ${v.handCardW} | 溢出 ${v.overflowPx}px | 需滚动 ${v.scrollable}`);
  }

  cdp.close();
  proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log('\n报告已写入 out/perf-report.json，截图 out/perf-deckbuilder.png');
}

main().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
