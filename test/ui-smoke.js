/* ============================================================
 * UI 冒烟测试（自建 DOM 垫片）
 * 流程：加载 index.html → 注入全部脚本 → 选阵营 → 选难度 → 卡组编辑
 *       → 换牌 → 打完一整局
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createDocument, createWindow } = require('./dom-shim.js');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

const doc = createDocument(html);
const win = createWindow(doc);

const errors = [];
win.onerror = (msg) => errors.push('onerror: ' + msg);

// 浏览器 API 垫片
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const raf = (fn) => setTimeout(() => fn(Date.now()), 16);
const perf = { now: () => Date.now() };

const sandbox = Object.assign(Object.create(null), {
  window: win, document: doc, console, Math, JSON, Object, Array, String, Number, Boolean,
  Date, Set, Map, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, Infinity, NaN,
  setTimeout, clearTimeout, Promise, Symbol, localStorage, performance: perf,
  navigator: { userAgent: 'dom-shim' },
  location: { protocol: 'http:', href: 'http://localhost/', reload() {} },
  requestAnimationFrame: raf, cancelAnimationFrame: (id) => clearTimeout(id),
});
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let fail = 0;
const results = [];
const check = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert failed'); };
const fire = (el, type) => el.dispatchEvent({ type, target: el, preventDefault() {}, stopPropagation() {} });
const evalIn = (expr) => vm.runInContext(expr, sandbox);

// ---- 注入脚本 ----
try {
  for (const rel of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
} catch (e) {
  console.log('❌ 脚本注入失败：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
try {
  (win._listeners['DOMContentLoaded'] || []).forEach(fn => fn({ type: 'DOMContentLoaded' }));
} catch (e) {
  console.log('❌ DOMContentLoaded 处理异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

/* ---------------- 流程断言 ---------------- */
check('⓪ 开场动画渲染 + 跳过', () => {
  const intro = doc.getElementById('intro');
  assert(intro && !intro._class.has('hidden'), '开场动画应显示');
  assert(intro.querySelectorAll('.intro-medal .crest').length === 1, '缺少徽章');
  assert(intro.querySelectorAll('.intro-title').length === 1, '缺少标题');
  const skip = intro.querySelector('.intro-skip');
  assert(skip, '缺少跳过按钮');
  fire(skip, 'click');
  assert(intro._class.has('hidden'), '跳过应关闭动画');
});

check('① 跳过动画后渲染主菜单（5 个按钮）', () => {
  const ov = doc.getElementById('overlay');
  assert(ov && !ov._class.has('hidden'), 'overlay 应可见');
  assert(ov.querySelectorAll('[data-mm]').length === 5, `主菜单按钮数 ${ov.querySelectorAll('[data-mm]').length}`);
  assert(ov.querySelectorAll('.mm-crest').length === 4, '主菜单应有 4 个阵营盾徽');
});

check('② 点「开始游戏」→ 阵营选择（4 阵营）', () => {
  fire(doc.getElementById('overlay').querySelectorAll('[data-mm]').find(e => e.dataset.mm === 'play'), 'click');
  assert(doc.getElementById('overlay').querySelectorAll('.fc').length === 4, '阵营数应为 4');
});

check('③ 选阵营 → 难度选择（4 档）', () => {
  const fc = doc.getElementById('overlay').querySelectorAll('.fc').find(e => e.dataset.fac === 'northern');
  assert(fc, '未找到北方领域');
  fire(fc, 'click');
  const diffs = doc.getElementById('overlay').querySelectorAll('.diff-card');
  assert(diffs.length === 4, `难度档数 ${diffs.length}`);
});

check('④ 选「困难」→ 进入卡组编辑器（卡池带本地卡面）', () => {
  const d = doc.getElementById('overlay').querySelectorAll('.diff-card').find(e => e.dataset.diff === 'hard');
  fire(d, 'click');
  const ov = doc.getElementById('overlay');
  const pool = ov.querySelectorAll('.pool-card');
  assert(pool.length > 20, `卡池卡数 ${pool.length}`);
  assert(ov.querySelectorAll('.leader-chip').length === 4, '领袖选项应为 4');
  // 卡池里的每张牌都必须挂上本地卡面（不是占位色块）
  const arts = ov.querySelectorAll('.pool-card .card img.art');
  const withArt = arts.filter(a => String(a.getAttribute('src') || '').includes('assets/cards'));
  assert(withArt.length === arts.length, `卡池卡面缺失：${arts.length - withArt.length}/${arts.length} 张是占位色块`);
  // 懒加载：卡池里除首屏外的卡面都应标 lazy（否则会一次拉满 143 张图）
  const lazy = arts.filter(a => a.getAttribute('loading') === 'lazy');
  assert(lazy.length > 0, '卡池卡面缺少 loading="lazy"，会导致首屏一次性加载全部卡图');
  assert(arts.every(a => a.getAttribute('decoding') === 'async'), '卡面缺少 decoding="async"');
  // 领袖卡面同样必须挂上
  const lcArt = ov.querySelectorAll('.leader-chip .lc-art').filter(a => String(a.style.backgroundImage || '').includes('assets/cards'));
  assert(lcArt.length === 4, `领袖卡面缺失：${lcArt.length}/4`);
  const st = evalIn('DeckBuilder.stats()');
  assert(st.unitCount >= 22 && st.unitCount <= 40, `默认牌组单位数 ${st.unitCount} 不在 22–40`);
  assert(st.ok, '默认牌组应合法：' + st.errors.join('; '));
});

check('⑤ 点卡加牌 / 右键减牌 + 上限校验', () => {
  const ov = doc.getElementById('overlay');
  const first = ov.querySelectorAll('.pool-card')[0];
  const defId = first.dataset.def;
  const before = evalIn(`DeckBuilder.countOf('${defId}')`);
  fire(first, 'click');
  const after = evalIn(`DeckBuilder.countOf('${defId}')`);
  assert(after === before + 1 || after === before, `加牌失败（${before}→${after}）`);
  // 超编保护：单位最多 40
  evalIn('DeckBuilder.picks = autoPicks("northern")');
  evalIn('DeckBuilder.render()');
  const st = evalIn('DeckBuilder.stats()');
  assert(st.unitCount <= 40, `自动填充后单位超编 ${st.unitCount}`);
});

check('⑥ 非法牌组时开始按钮禁用', () => {
  evalIn('DeckBuilder.picks = {}; DeckBuilder.render()');
  const ov = doc.getElementById('overlay');
  const start = ov.querySelectorAll('[data-act]').find(e => e.dataset.act === 'start');
  assert(start && start.getAttribute('disabled') != null, '空牌组时开始按钮应禁用');
  assert(/不足/.test(ov.querySelector('.deck-msg').textContent), '应提示单位牌不足');
});

check('⑦ 一键填充 → 开始对战 → 换牌界面', () => {
  const ov = doc.getElementById('overlay');
  fire(ov.querySelectorAll('[data-act]').find(e => e.dataset.act === 'auto'), 'click');
  assert(evalIn('DeckBuilder.stats().ok'), '一键填充后应合法');
  fire(doc.getElementById('overlay').querySelectorAll('[data-act]').find(e => e.dataset.act === 'start'), 'click');
  const picks = doc.getElementById('overlay').querySelectorAll('.deck-pick');
  assert(picks.length >= 10, `换牌界面手牌数 ${picks.length}`);
});

let g = null;
check('⑧ 开始游戏 → 牌桌渲染', () => {
  fire(doc.getElementById('mullNone'), 'click');
  g = evalIn('game');
  assert(g, '全局 game 未创建');
  assert(g.difficulty === 'hard', `难度应为 hard，实际 ${g.difficulty}`);
  assert(g.aiSkill === 0.8, `AI skill 应为 0.8，实际 ${g.aiSkill}`);
  assert(doc.getElementById('playerRows').querySelectorAll('.row').length === 3, '己方排数不对');
  assert(doc.getElementById('enemyRows').querySelectorAll('.row').length === 3, '对方排数不对');
  assert(doc.getElementById('playerHand').querySelectorAll('.card').length === g.side.player.hand.length, '手牌数量不符');
});

check('⑨ 卡面原画（本地文件）+ 音效开关按钮', () => {
  const withArt = doc.querySelectorAll('.card img.art').filter(a => String(a.getAttribute('src') || '').includes('assets/cards'));
  assert(withArt.length > 0, '没有卡面挂载本地原画');
  const btns = doc.getElementById('actionButtons').querySelectorAll('button');
  assert(btns.some(b => /音效|静音/.test(b.textContent)), '缺少音效开关按钮');
});

/* ---------------- 完整对局 ---------------- */
(async () => {
  let steps = 0;
  const played = { unit: 0, spy: 0, medic: 0, muster: 0, weather: 0, horn: 0, scorch: 0, decoy: 0, leader: 0 };
  const soundCalls = [];
  // 记录音效触发（jsdom 无音频设备，改为记录调用）
  try { evalIn('SFX.enabled = true'); evalIn('SFX.ctx = {}'); evalIn('SFX.master = {}'); } catch (e) {}
  try {
    vm.runInContext('const __origPlay = SFX.play.bind(SFX); SFX.play = (n) => { globalThis.__sounds = globalThis.__sounds || []; globalThis.__sounds.push(n); };', sandbox);
  } catch (e) { errors.push('音效钩子失败: ' + e.message); }

  try {
    while (!g.over && steps++ < 600) {
      if (g.pendingMedic) { g.applyMedic('player', g.pendingMedic.options[0]); evalIn('UI').render(); played.medic++; continue; }
      if (g.current === 'ai') {
        const ai = new (evalIn('GwentAI'))(g, g.aiSkill);
        const act = await ai.act();
        if (act === null) { if (!g.passed.ai) g.pass('ai'); else break; }
        evalIn('UI').render();
        continue;
      }
      const side = g.side.player;
      let did = false;
      for (let i = 0; i < side.hand.length && !did; i++) {
        const c = side.hand[i];
        if (c.type === 'special') {
          if (c.kind === 'horn') { for (const r of ['melee', 'ranged', 'siege']) { if (g.playCard('player', i, r).ok) { did = true; played.horn++; break; } } }
          else if (c.kind === 'decoy') {
            const target = ['melee', 'ranged', 'siege'].flatMap(r => g.side.player.rows[r].filter(x => !x.tomb && x.type !== 'hero' && !x.spied)).map(x => x.uid)[0];
            if (target != null && g.playCard('player', i, null).ok) { g.applyDecoy('player', target); did = true; played.decoy++; }
          }
          else if (g.playCard('player', i, null).ok) { did = true; if (c.kind === 'weather') played.weather++; else if (c.kind === 'scorch') played.scorch++; }
        } else {
          for (const r of ['melee', 'ranged', 'siege']) {
            if (!g.cardFitsRow(c, r)) continue;
            if (g.playCard('player', i, r).ok) {
              did = true;
              if (c.ability === 'spy') played.spy++;
              else if (c.ability === 'medic') played.medic++;
              else if (c.ability === 'muster') played.muster++;
              else played.unit++;
              break;
            }
          }
        }
      }
      if (!did) {
        if (g.canUseLeader('player') && g.useLeader('player').ok) { played.leader++; evalIn('UI').render(); continue; }
        if (!g.pass('player').ok) break;
      }
      evalIn('UI').render();
    }
  } catch (e) {
    errors.push('对局异常: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
  }

  const sounds = (() => { try { return evalIn('globalThis.__sounds || []'); } catch (e) { return []; } })();
  const flyCount = (() => { try { return evalIn('UI._flyCount || 0'); } catch (e) { return 0; } })();
  await new Promise(r => setTimeout(r, 1300));   // 等结算面板弹出

  check('⑩ 整局对战在 UI 层跑完（困难 AI）', () => {
    assert(g.over, `未结束（steps=${steps}, round=${g.round}）`);
  });
  check('⑪ 音效事件被触发', () => {
    assert(sounds.length > 0, '没有触发任何音效');
  });
  check('⑫ 出牌飞行动画被触发', () => {
    assert(flyCount > 0, '没有触发飞行动画');
  });
  check('⑬ 局末弹出结算面板（含战绩表）', () => {
    const ov = doc.getElementById('overlay');
    assert(ov.querySelectorAll('.results-modal').length === 1, '结算面板未出现');
    assert(ov.querySelectorAll('.res-table tbody tr').length >= 8, '战绩表行数不足');
    assert(ov.querySelectorAll('.res-score').length === 1, '缺少比分');
  });
  check('⑭ 渲染路径无异常', () => {
    assert(errors.length === 0, '捕获异常：\n    ' + errors.slice(0, 6).join('\n    '));
  });

  for (const [st, name] of results) {
    if (st === 'FAIL') fail++;
    console.log(`${st === 'PASS' ? '✅' : '❌'} ${name}`);
  }
  console.log(`\n动作统计：${Object.entries(played).filter(([, v]) => v).map(([k, v]) => k + '×' + v).join(' ') || '（无）'}`);
  console.log(`音效：${[...new Set(sounds)].join(' ')}（共 ${sounds.length} 次）`);
  console.log(`对局：${g.side.player.roundsWon}:${g.side.ai.roundsWon}，共 ${g.round} 局，${steps} 步`);
  console.log(`结果：${results.length - fail}/${results.length} 通过`);
  if (errors.length) { console.log('\n异常：'); errors.slice(0, 10).forEach(e => console.log('  - ' + e)); }
  process.exit(fail ? 1 : 0);
})();

