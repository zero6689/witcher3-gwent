/* 无头测试：自动跑完整局，检测引擎/AI 异常 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = 'V:/CodexProjects/gwent-web/js';
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['art.js', 'data.js', 'engine.js', 'ai.js']) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}
// 类/const 声明属于脚本作用域，需显式导出到全局
vm.runInContext('globalThis.GwentGame = GwentGame; globalThis.GwentAI = GwentAI; globalThis.buildDeck = buildDeck; globalThis.ROWS = ROWS; globalThis.FACTIONS = FACTIONS;', ctx, { filename: 'export.js' });

async function runOnce(playerFac, aiFac, seedLabel) {
  const g = new ctx.GwentGame({
    playerDeck: ctx.buildDeck(playerFac),
    aiDeck: ctx.buildDeck(aiFac),
    playerFirst: Math.random() < 0.5,
    aiSkill: 0.65,
  });
  g.start();
  g.doMulligan([]);
  g.finishMulligan();

  const ai = new ctx.GwentAI(g, 0.65);
  let guard = 0;
  const actions = [];
  while (!g.over && guard++ < 600) {
    if (g.pendingMedic) { g.applyMedic('player', g.pendingMedic.options[0]); continue; }
    if (g.current === 'ai') {
      const act = await ai.act();
      actions.push('AI:' + act);
      if (act === null) { // AI 无法行动，防死循环
        if (!g.passed.ai) g.pass('ai');
        else break;
      }
    } else {
      // 玩家自动策略：随机出可出的牌，或过
      const side = g.side.player;
      let played = false;
      const order = side.hand.map((c, i) => i).sort(() => Math.random() - 0.5);
      for (const i of order) {
        const c = side.hand[i];
        if (c.type === 'special') {
          if (c.kind === 'weather') { const r = g.playCard('player', i, null); if (r.ok) { played = true; actions.push('P:weather'); break; } }
          else if (c.kind === 'clear') { if (Object.values(g.weather).some(Boolean)) { const r = g.playCard('player', i, null); if (r.ok) { played = true; actions.push('P:clear'); break; } } }
          else if (c.kind === 'horn') { for (const rr of ['melee','ranged','siege']) { const r = g.playCard('player', i, rr); if (r.ok) { played = true; actions.push('P:horn'); break; } } if (played) break; }
          else if (c.kind === 'scorch') { const r = g.playCard('player', i, null); if (r.ok) { played = true; actions.push('P:scorch'); break; } }
          continue;
        }
        if (c.ability === 'spy') { const rr0 = ['melee','ranged','siege'].find(rr => g.cardFitsRow(c, rr)); const r = g.playCard('player', i, rr0); if (r.ok) { played = true; actions.push('P:spy'); break; } continue; }
        for (const rr of ['melee', 'ranged', 'siege']) {
          if (!g.cardFitsRow(c, rr)) continue;
          const r = g.playCard('player', i, rr);
          if (r.ok) { played = true; actions.push('P:' + c.name.zh); break; }
        }
        if (played) break;
      }
      if (!played) {
        if (g.canUseLeader('player')) { const r = g.useLeader('player'); if (r.ok) { actions.push('P:leader'); continue; } }
        if (!g.passed.player) { g.pass('player'); actions.push('P:pass'); }
        else break;
      }
    }
  }
  return { over: g.over, winner: g.winner, rounds: g.round, pWins: g.side.player.roundsWon, aWins: g.side.ai.roundsWon, guard, actions: actions.length, log: g.log.length };
}

// 跑多组对阵
const facs = ['northern', 'nilfgaard', 'scoiatael', 'monsters'];
let fails = 0;
(async () => {
for (const p of facs) {
  for (const a of facs) {
    if (p === a) continue;
    try {
      const r = await runOnce(p, a);
      if (!r.over) { console.log(`!! 未正常结束: ${p} vs ${a}`, JSON.stringify(r)); fails++; }
      else console.log(`OK ${p} vs ${a} → winner=${r.winner} 比分 ${r.pWins}:${r.aWins} 局数=${r.rounds} 动作=${r.actions} 日志=${r.log}`);
    } catch (e) {
      console.log(`!! 异常 ${p} vs ${a}: ${e.message}\n${e.stack.split('\n').slice(0,4).join('\n')}`);
      fails++;
    }
  }
}
console.log(fails ? `\n${fails} 组失败` : '\n全部对阵通过');
})();
