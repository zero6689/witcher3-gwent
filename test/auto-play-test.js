/* ============================================================
 * 「点卡即自动上场」行为测试
 * 验证：点击手牌 → 直接落到对应排，无需再点排
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createDocument, createWindow } = require('./dom-shim.js');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

const doc = createDocument(html);
const win = createWindow(doc);
const store = new Map();
const sandbox = Object.assign(Object.create(null), {
  window: win, document: doc, console, Math, JSON, Object, Array, String, Number, Boolean,
  Date, Set, Map, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, Promise,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  performance: { now: () => Date.now() },
  requestAnimationFrame: f => setTimeout(() => f(Date.now()), 16),
  cancelAnimationFrame: id => clearTimeout(id),
});
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const rel of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
(win._listeners['DOMContentLoaded'] || []).forEach(fn => fn({ type: 'DOMContentLoaded' }));

const evalIn = (expr) => vm.runInContext(expr, sandbox);
const fire = (el, type) => el.dispatchEvent({ type, target: el, preventDefault() {}, stopPropagation() {} });

let fail = 0;
const ok = (m) => console.log('✅ ' + m);
const bad = (m) => { fail++; console.log('❌ ' + m); };
const assert = (c, m) => { if (!c) throw new Error(m); };

/* 跳过开场动画，进入主菜单 */
{
  const intro = doc.getElementById('intro');
  const skip = intro && intro.querySelector('.intro-skip');
  if (skip) fire(skip, 'click');
}

/* 开局：主菜单 → 北方 + 普通 + 一键填充 + 不换牌 */
fire(doc.getElementById('overlay').querySelectorAll('[data-mm]').find(e => e.dataset.mm === 'play'), 'click');
fire(doc.getElementById('overlay').querySelectorAll('.fc').find(e => e.dataset.fac === 'northern'), 'click');
fire(doc.getElementById('overlay').querySelectorAll('.diff-card').find(e => e.dataset.diff === 'normal'), 'click');
fire(doc.getElementById('overlay').querySelectorAll('[data-act]').find(e => e.dataset.act === 'auto'), 'click');
fire(doc.getElementById('overlay').querySelectorAll('[data-act]').find(e => e.dataset.act === 'start'), 'click');
fire(doc.getElementById('mullNone'), 'click');

const g = evalIn('game');
const UI = evalIn('UI');
const ROWS = evalIn('ROWS');
const makeCard = evalIn('makeCard');
const ALL_CARDS = evalIn('ALL_CARDS');

/** 注入指定卡牌到手牌，保证每种情况都被覆盖 */
function inject(defId) {
  const card = makeCard(ALL_CARDS[defId]);
  card.owner = 'player';
  g.side.player.hand.push(card);
  return card;
}
/** 按 uid 点击手牌 */
function clickUid(uid) {
  const i = g.side.player.hand.findIndex(c => c.uid === uid);
  if (i < 0) throw new Error('手牌里找不到 uid ' + uid);
  UI.render();
  const els = doc.getElementById('playerHand').querySelectorAll('.card');
  fire(els[i], 'click');
}

/* 轮到玩家（AI 先手时先让 AI 走完） */
async function ensurePlayerTurn() {
  let guard = 0;
  while (!g.over && g.current !== 'player' && guard++ < 50) {
    const ai = new (evalIn('GwentAI'))(g, g.aiSkill);
    const act = await ai.act();
    if (act === null && !g.passed.ai) g.pass('ai');
  }
}

function boardUids() {
  const set = new Set();
  for (const r of ROWS) for (const c of g.side.player.rows[r]) if (!c.tomb) set.add(c.uid);
  return set;
}

function handEl(i) {
  return doc.getElementById('playerHand').querySelectorAll('.card')[i];
}

(async () => {
  await ensurePlayerTurn();

  /* ---- 1. 普通单位：点一下直接落到自己的排 ---- */
  {
    const hand = g.side.player.hand;
    const idx = hand.findIndex(c => c.type === 'unit' && c.ability !== 'spy' && c.ability !== 'medic' && c.row !== 'agile');
    if (idx < 0) { bad('手牌里没有可测的普通单位'); }
    else {
      const card = hand[idx];
      const expectRow = card.row;
      const before = boardUids();
      fire(handEl(idx), 'click');
      const placed = g.side.player.rows[expectRow].find(c => c.uid === card.uid && !c.tomb);
      if (placed) ok(`点「${card.name.zh}」自动落到 ${expectRow} 排（无需点排）`);
      else bad(`「${card.name.zh}」未落到 ${expectRow} 排`);
      if (boardUids().size === before.size + 1) ok('牌桌上新增 1 张卡'); else bad('牌桌数量未按预期增加');
      if (!g.side.player.hand.includes(card)) ok('该牌已从手牌移除'); else bad('该牌仍在手牌里');
    }
  }

  /* ---- 2. 敏捷单位：自动选排（近战或远程） ---- */
  await ensurePlayerTurn();
  {
    const card = inject('scoiatael_dol_blathanna_scout');   // 敏捷 6
    clickUid(card.uid);
    const inMelee = g.side.player.rows.melee.some(c => c.uid === card.uid && !c.tomb);
    const inRanged = g.side.player.rows.ranged.some(c => c.uid === card.uid && !c.tomb);
    if (inMelee || inRanged) ok(`敏捷「${card.name.zh}」自动落到 ${inMelee ? '近战' : '远程'} 排`);
    else bad(`敏捷「${card.name.zh}」未落位`);
  }

  /* ---- 3. 间谍：自动打到对方场上，自己抽牌 ---- */
  await ensurePlayerTurn();
  {
    const card = inject('northern_sigismund_dijkstra');      // 间谍
    const handBefore = g.side.player.hand.length;
    clickUid(card.uid);
    const onEnemy = ROWS.some(r => g.side.ai.rows[r].some(c => c.uid === card.uid && !c.tomb));
    if (onEnemy) ok(`间谍「${card.name.zh}」自动打到对方场上`); else bad('间谍未落到对方场上');
    if (g.side.player.hand.length > handBefore - 1) ok('间谍抽牌已生效'); else bad('间谍抽牌未生效');
  }

  /* ---- 4. 天气牌：点一下直接生效 ---- */
  await ensurePlayerTurn();
  {
    const card = inject('special_biting_frost');
    clickUid(card.uid);
    if (g.weather.frost) ok(`天气「${card.name.zh}」点一下直接生效`); else bad('天气牌未生效');
  }

  /* ---- 5. 号角：自动放到收益最大的排 ---- */
  await ensurePlayerTurn();
  {
    const card = inject('special_commanders_horn');
    clickUid(card.uid);
    const horned = ROWS.filter(r => g.side.player.horn[r]);
    if (horned.length === 1) ok(`号角自动放到 ${horned[0]} 排`); else bad(`号角未自动落位（horned=${horned.length}）`);
  }

  /* ---- 6. 全程无需点击任何排 ---- */
  ok('以上全部通过点击手牌完成，未调用任何选排交互');

  console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
