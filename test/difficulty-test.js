/* ============================================================
 * 难度分级验证：同一套玩家策略 vs 四档 AI，比较胜率
 * 用固定种子的 Math.random，结果可复现。
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'js');

/* 固定种子 PRNG（mulberry32） */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeContext(seed) {
  const seededMath = Object.create(Math);       // 继承 floor/abs 等，仅覆盖 random
  seededMath.random = mulberry32(seed);
  const ctx = {
    console, Math: seededMath, JSON, Object, Array, String, Number, Boolean, Date,
    Set, Map, RegExp, Error, parseInt, parseFloat, isNaN, Infinity, NaN,
    window: {}, localStorage: { getItem: () => null, setItem: () => {} },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['art.js', 'data.js', 'engine.js', 'ai.js', 'audio.js', 'deckbuilder.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('globalThis.GwentGame=GwentGame;globalThis.GwentAI=GwentAI;globalThis.buildDeck=buildDeck;globalThis.DIFFICULTIES=DIFFICULTIES;globalThis.ROWS=ROWS;globalThis.WEATHER=WEATHER;globalThis.buildCustomDeck=buildCustomDeck;globalThis.autoPicks=autoPicks;', ctx, { filename: 'export.js' });
  return ctx;
}

/* ---------------- 玩家策略（固定、不随难度变化） ---------------- */
function playerValue(g, c, ROWS, WEATHER) {
  const side = g.side.player;
  if (c.type === 'special') {
    if (c.kind === 'weather') {
      if (g.weather[c.weatherKey]) return null;
      const row = WEATHER[c.weatherKey].row;
      const gain = g.rowTotal('player', row) - g.rowTotal('ai', row);
      if (gain <= 0) return null;
      return { row, value: 30 + gain };
    }
    if (c.kind === 'clear') {
      if (!Object.values(g.weather).some(Boolean)) return null;
      const hit = (s) => ROWS.reduce((a, r) => a + ((r === 'melee' ? g.weather.frost : r === 'ranged' ? g.weather.fog : g.weather.rain) ? g.rowTotal(s, r) : 0), 0);
      const gain = hit('player') - hit('ai');
      return gain > 0 ? { row: null, value: 25 + gain } : null;
    }
    if (c.kind === 'horn') {
      let bestRow = null, bestVal = 0;
      for (const r of ROWS) {
        if (side.horn[r]) continue;
        const total = side.rows[r].filter(x => !x.tomb && x.type !== 'hero').reduce((a, x) => a + (x._effective || x.power || 0), 0);
        if (total > bestVal) { bestVal = total; bestRow = r; }
      }
      return bestRow && bestVal >= 8 ? { row: bestRow, value: 20 + bestVal } : null;
    }
    if (c.kind === 'scorch') {
      if (g.scores.player + g.scores.ai <= 10) return null;
      let oppMax = -1, myMax = 0;
      for (const s of ['player', 'ai']) for (const r of ROWS) for (const x of g.side[s].rows[r]) {
        if (x.tomb || x.type === 'hero') continue;
        const p = x._effective || x.power || 0;
        if (s === 'player') myMax = Math.max(myMax, p); else oppMax = Math.max(oppMax, p);
      }
      return (oppMax > myMax && oppMax >= 5) ? { row: null, value: 30 + oppMax - myMax } : null;
    }
    return null; // 诱饵：玩家策略不用
  }
  if (c.ability === 'spy') return { row: c.row === 'agile' ? 'melee' : c.row, value: 55 };
  if (c.ability === 'medic') {
    const targets = side.graveyard.filter(x => !x.tomb && x.type === 'unit');
    if (!targets.length) return null;
    const best = Math.max(...targets.map(t => t.power || 0));
    return { row: c.row === 'agile' ? 'melee' : c.row, value: 30 + best * 1.5 };
  }
  const row = c.row === 'agile' ? (g.weather.fog && !g.weather.frost ? 'melee' : 'ranged') : c.row;
  let v = c.power || 0;
  const w = row === 'melee' ? g.weather.frost : row === 'ranged' ? g.weather.fog : g.weather.rain;
  if (w && c.type !== 'hero') v = 1;
  if (c.ability === 'muster') v *= 2;
  if (c.ability === 'tight_bond') {
    const same = side.rows[row].filter(x => x.defId === c.defId && !x.tomb).length;
    v *= (same + 1);
  }
  return { row, value: v };
}

function playerTurn(g, ROWS, WEATHER) {
  const side = g.side.player;
  if (g.passed.ai && g.scores.player > g.scores.ai) { g.pass('player'); return; }
  if (g.canUseLeader('player')) {
    const eff = g.side.player.deck.leader.effect;
    const row = eff.includes('siege') ? 'siege' : eff.includes('ranged') ? 'ranged' : 'melee';
    if (g.rowTotal('player', row) >= 12 || eff === 'clear_weather') { g.useLeader('player'); return; }
  }
  if (!side.hand.length) { g.pass('player'); return; }
  let best = null;
  for (let i = 0; i < side.hand.length; i++) {
    const v = playerValue(g, side.hand[i], ROWS, WEATHER);
    if (v && (!best || v.value > best.value)) best = Object.assign({ i }, v);
  }
  if (!best) { g.pass('player'); return; }
  if (!g.playCard('player', best.i, best.row || null).ok) g.pass('player');
}

/* ---------------- 跑一局 ---------------- */
async function playMatch(ctx, diffKey, seed) {
  const g = new ctx.GwentGame({
    playerDeck: ctx.buildCustomDeck('northern', ctx.buildDeck('northern').leader.id, ctx.autoPicks('northern')),
    aiDeck: ctx.buildDeck(seed % 2 ? 'monsters' : 'nilfgaard', { tier: diffKey === 'easy' ? 'weak' : 'normal' }),
    playerFirst: seed % 3 === 0,
    aiSkill: ctx.DIFFICULTIES[diffKey].skill,
    difficulty: diffKey,
  });
  g.start();
  g.doMulligan([]);
  g.finishMulligan();
  const ai = new ctx.GwentAI(g, g.aiSkill);
  const ROWS = ctx.ROWS, WEATHER = ctx.WEATHER;

  let guard = 0;
  while (!g.over && guard++ < 800) {
    if (g.pendingMedic) { g.applyMedic('player', g.pendingMedic.options[0]); continue; }
    if (g.current === 'ai') {
      const act = await ai.act();
      if (act === null) { if (!g.passed.ai) g.pass('ai'); else break; }
    } else {
      playerTurn(g, ROWS, WEATHER);
    }
  }
  return g.winner;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const N = 96;
  const rows = [];
  for (const key of ['easy', 'normal', 'hard', 'master']) {
    const ctx = makeContext(20260908);          // 每档同一种子 → 牌序可比
    let wins = 0, losses = 0, draws = 0;
    for (let i = 0; i < N; i++) {
      const w = await playMatch(ctx, key, i);
      if (w === 'player') wins++; else if (w === 'ai') losses++; else draws++;
    }
    rows.push({ key, zh: ctx.DIFFICULTIES[key].zh, skill: ctx.DIFFICULTIES[key].skill, wins, losses, draws, rate: wins / N });
  }

  console.log('玩家使用同一套固定策略，对阵四档 AI，每档 96 局：\n');
  console.log('难度      AI强度   玩家胜   玩家负   平   胜率');
  for (const r of rows) {
    console.log(`${r.zh.padEnd(6)}  ${String(r.skill).padEnd(8)} ${String(r.wins).padEnd(8)} ${String(r.losses).padEnd(8)} ${String(r.draws).padEnd(4)} ${(r.rate * 100).toFixed(0)}%`);
  }

  const easy = rows[0], master = rows[rows.length - 1];
  const monotonic = rows.every((r, i) => i === 0 || r.rate <= rows[i - 1].rate + 0.10);
  let fail = 0;
  console.log('');
  if (easy.rate > master.rate) console.log(`✅ 简单胜率(${(easy.rate * 100).toFixed(0)}%) 高于大师(${(master.rate * 100).toFixed(0)}%)`);
  else { console.log(`❌ 简单胜率未高于大师（${(easy.rate * 100).toFixed(0)}% vs ${(master.rate * 100).toFixed(0)}%）`); fail++; }
  if (monotonic) console.log('✅ 胜率随难度单调下降（容差 10%）');
  else { console.log('❌ 胜率未随难度单调下降'); fail++; }

  process.exit(fail ? 1 : 0);
})();



