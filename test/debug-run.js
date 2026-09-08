/* 调试：单局逐步打印，定位活锁 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = 'V:/CodexProjects/gwent-web/js';
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, setTimeout, clearTimeout };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'engine.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
vm.runInContext('globalThis.GwentGame=GwentGame;globalThis.GwentAI=GwentAI;globalThis.buildDeck=buildDeck;', ctx, { filename: 'e.js' });

const P = process.argv[2] || 'northern', A = process.argv[3] || 'scoiatael';
const g = new ctx.GwentGame({ playerDeck: ctx.buildDeck(P), aiDeck: ctx.buildDeck(A), playerFirst: true, aiSkill: 0.65 });
g.start(); g.doMulligan([]); g.finishMulligan();
const ai = new ctx.GwentAI(g, 0.65);

for (let i = 0; i < 4000; i++) {
  const st = () => `r${g.round} cur=${g.current} passed(p=${g.passed.player},ai=${g.passed.ai}) hand(p=${g.side.player.hand.length},ai=${g.side.ai.hand.length}) pile(p=${g.side.player.pile.length},ai=${g.side.ai.pile.length}) score(${g.scores.player}:${g.scores.ai}) over=${g.over}`;
  if (i % 100 === 0 || g.over) console.log(`\n[${i}] ${st()}`);
  if (g.over) break;
  if (g.current === 'ai') {
    const act = ai.act();
    if (i < 40) console.log(`    AI act = ${act}  →  ${st()}`);
    if (act === null) { console.log('    AI null'); break; }
  } else {
    const side = g.side.player;
    let played = false;
    for (let k = 0; k < side.hand.length; k++) {
      const c = side.hand[k];
      if (c.type === 'special') {
        if (c.kind === 'horn') { for (const rr of ['melee','ranged','siege']) { const r = g.playCard('player', k, rr); if (r.ok) { played = true; break; } } }
        else if (c.kind === 'decoy') continue;
        else { const r = g.playCard('player', k, null); if (r.ok) played = true; }
      } else {
        for (const rr of ['melee','ranged','siege']) { if (!g.cardFitsRow(c, rr)) continue; const r = g.playCard('player', k, rr); if (r.ok) { played = true; break; } }
      }
      if (played) break;
    }
    if (!played) {
      const pr = g.pass('player');
      if (!pr.ok) { console.log(`    P pass FAILED at ${i}: ${st()}`); break; }
    }
  }
}
console.log('\n最终:', g.dump());
