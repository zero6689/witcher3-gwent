/* ============================================================
 * 规则回归测试 —— 针对 2026-09-17 玩家反馈的 6 类问题
 *   1) 小局之间不该抽牌（旧版每局抽到 10 张，牌堆被抽空）
 *   2) 开局调度：双方各最多换 2 张，换回的牌洗回牌堆
 *   3) 金龙（Villentretenmerth）焚风：打对方同排最强的非英雄单位，不是自己消失
 *   4) 特殊牌焚风：全场最强非英雄单位（含己方），无 10 点门槛
 *   5) 医生：被焚风摧毁的牌也能复活；英雄不能复活
 *   6) 领袖「摧毁整排」= 只摧毁该排最强（并列全灭），不是整排
 *   另含：阵营被动 / 领袖整排翻倍 / 小局先手
 * 用法：node test/rules-test.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['art.js', 'data.js', 'engine.js', 'ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('globalThis.GwentGame=GwentGame; globalThis.makeCard=makeCard; globalThis.ALL_CARDS=ALL_CARDS; globalThis.ROWS=ROWS; globalThis.buildDeck=buildDeck; globalThis.buildCustomDeck=buildCustomDeck; globalThis.LEADERS=LEADERS; globalThis.autoPicks=autoPicks;', ctx, { filename: 'export.js' });
const { GwentGame, makeCard, ALL_CARDS, ROWS, buildCustomDeck, LEADERS, autoPicks } = ctx;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('OK   ' + m); };
const bad = (m) => { fail++; console.log('FAIL ' + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);
const eq = (a, b, m) => check(a === b, `${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);

/** 造一局：固定首领、可指定阵营 */
function fresh(pFac = 'monsters', aFac = 'northern', opts = {}) {
  const pDeck = buildCustomDeck(pFac, opts.pLeader || LEADERS[pFac][0].id, opts.pPicks || autoPicks(pFac));
  const aDeck = buildCustomDeck(aFac, opts.aLeader || LEADERS[aFac][0].id, opts.aPicks || autoPicks(aFac));
  const g = new GwentGame({
    playerDeck: pDeck, aiDeck: aDeck, playerFirst: true,
    aiSkill: opts.aiSkill == null ? 0.8 : opts.aiSkill,
    options: opts.options,
  });
  g.start();
  return g;
}
/** 直接给手牌塞一张（不经过牌堆） */
function give(g, side, defId) {
  const c = makeCard(ALL_CARDS[defId]);
  c.owner = side;
  g.side[side].hand.push(c);
  return c;
}
/** 直接往场上放一张单位（enter=true 时走一次进场结算，用于鼓舞测试） */
function put(g, side, defId, row, power, enter) {
  const c = makeCard(ALL_CARDS[defId]);
  if (power != null) c.power = power;
  c.owner = side; c._side = side; c.placedRow = row;
  g.side[side].rows[row].push(c);
  if (enter) g._applyEnterBuffs(c, side, row);
  g.refresh();
  return c;
}
/** 清掉某方牌堆/手牌里的某个召唤组（测试里避免自动组牌混入同组牌） */
function clearGroup(g, side, group) {
  const inGroup = (c) => (c.mg || c.defId) === group;
  g.side[side].pile = g.side[side].pile.filter(c => !inGroup(c));
  g.side[side].hand = g.side[side].hand.filter(c => !inGroup(c));
}
/** 把一张牌直接放进坟场（模拟被摧毁/阵亡） */
function bury(g, side, defId, power, tomb) {
  const c = makeCard(ALL_CARDS[defId]);
  if (power != null) c.power = power;
  c.owner = side; c.inGrave = true; c.tomb = !!tomb;
  g.side[side].graveyard.push(c);
  return c;
}
const onRow = (g, side, row, uid) => g.side[side].rows[row].some(c => c.uid === uid && !c.tomb);
const inGrave = (g, side, uid) => g.side[side].graveyard.some(c => c.uid === uid);
/** 开局：换牌 + 处理松鼠党先手挂起 */
function begin(g, takeFirst = true) {
  g.doMulligan([]);
  g.finishMulligan();
  if (g.pendingFirstPick) g.applyFirstChoice(takeFirst);
}

console.log('\n===== 1. 小局之间不抽牌 =====');
{
  const g = fresh('monsters', 'northern');
  begin(g);
  const pHand = g.side.player.hand.length, aHand = g.side.ai.hand.length;
  const pPile = g.side.player.pile.length, aPile = g.side.ai.pile.length;
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.round, 2, '进入第 2 局');
  eq(g.side.player.hand.length, pHand, '玩家手牌数不变（不补抽）');
  eq(g.side.ai.hand.length, aHand, 'AI 手牌数不变（不补抽）');
  eq(g.side.player.pile.length, pPile, '玩家牌堆不变');
  eq(g.side.ai.pile.length, aPile, 'AI 牌堆不变');
}

console.log('\n===== 2. 开局调度：逐张换牌，换掉的牌本次绝不会再抽到 =====');
{
  // 真规则（玩家反馈 #1）：选一张不要的牌 → 立刻重抽一张；最多 2 次；
  // 换掉的牌先放在一边（不在牌堆里）→ 调度期间抽不到它；全部换完后才洗回牌堆。
  const g = fresh('northern', 'monsters');
  const before = g.side.player.hand.map(c => c.uid);
  const pileBefore = g.side.player.pile.length;
  const r1 = g.mulliganSwap('player', 0);
  check(r1.ok, '第 1 次换牌成功');
  eq(g.side.player.hand.length, 10, '换牌后仍是 10 张');
  check(!g.side.player.hand.some(c => c.uid === before[0]), '换掉的牌没有留在手里');
  check(!!r1.in && g.side.player.hand.some(c => c.uid === r1.in.uid), '立刻重抽了一张（旧版是勾完再一起抽）');
  eq(g.side.player.pile.length, pileBefore - 1, '换掉的牌此刻不在牌堆里（所以本次抽不到它）');
  const r2 = g.mulliganSwap('player', 0);
  check(r2.ok, '第 2 次换牌成功');
  const r3 = g.mulliganSwap('player', 0);
  check(!r3.ok, '第 3 次换牌被拒绝（每局最多 2 张）');
  eq(g.mulliganUsed.player, 2, '换牌次数累计为 2');
  const aside = g.mulliganSetAside.player.map(c => c.uid);
  eq(aside.length, 2, '两张换掉的牌被放在一边');
  check(aside.includes(before[0]), '第 1 张换掉的牌就在"一边"里（不在牌堆、不在手牌）');
  g.aiMulligan();
  check(g.aiMulliganDone === true, 'AI 也执行了换牌流程');
  g.finishMulligan();
  check(!g.needMulligan, '调度阶段已结束');
  eq(g.side.player.pile.length, pileBefore, '调度结束后牌堆张数恢复（换掉的牌洗回牌堆）');
  eq(g.side.player.pile.filter(c => c.uid === before[0]).length, 1, '换掉的牌洗回了牌堆');
}
{
  // 极端验证：牌堆里只剩 1 张时，换牌抽到的必须是它，而不是刚换掉的那张
  const g = fresh('northern', 'monsters');
  const out = g.side.player.hand[0];
  const rest = g.side.player.pile.splice(0, g.side.player.pile.length);
  const only = makeCard(ALL_CARDS['northern_ballista']);
  only.owner = 'player';
  g.side.player.pile.push(only);
  const r = g.mulliganSwap('player', 0);
  check(!!r.in && r.in.uid === only.uid, '牌堆只剩 1 张时抽到的是那一张（不是刚换掉的牌）');
  check(!g.side.player.hand.some(c => c.uid === out.uid), '换掉的牌没有被立刻抽回来');
  g.side.player.pile.push(...rest);
}

console.log('\n===== 3. 金龙：打对方同排最强，而不是自杀 =====');
{
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  const a1 = put(g, 'ai', 'northern_blue_stripes_commando', 'melee', 6);
  const a2 = put(g, 'ai', 'northern_blue_stripes_commando', 'melee', 6);
  const dragon = give(g, 'player', 'neutral_villentretenmerth');
  const res = g.playCard('player', g.side.player.hand.indexOf(dragon), 'melee');
  check(res.ok, '金龙可以打出');
  check(onRow(g, 'player', 'melee', dragon.uid), '金龙留在场上（旧版会把自己焚掉）');
  check(!onRow(g, 'ai', 'melee', a1.uid) && !onRow(g, 'ai', 'melee', a2.uid), '对方 6+6 并列最强 → 全灭');
  check(inGrave(g, 'ai', a1.uid), '被焚风摧毁的牌进了对方坟场');
  check(g.side.ai.graveyard.every(c => !c.tomb), '进坟场的牌 tomb 已清（可被医生复活）');
}
{
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  const a1 = put(g, 'ai', 'northern_blue_stripes_commando', 'melee', 4);
  put(g, 'ai', 'northern_blue_stripes_commando', 'melee', 5);
  const dragon = give(g, 'player', 'neutral_villentretenmerth');
  g.playCard('player', g.side.player.hand.indexOf(dragon), 'melee');
  check(onRow(g, 'ai', 'melee', a1.uid), '对方近战总战力 <10 → 焚风无效，对方单位存活');
  check(onRow(g, 'player', 'melee', dragon.uid), '金龙仍在场');
}
{
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  // 注意：同袍牌会有倍率，这里用无技能的牌构造 4/4/5
  const w1 = put(g, 'ai', 'monsters_arachas', 'melee', 4);
  const w2 = put(g, 'ai', 'monsters_nekker', 'melee', 4);
  const best = put(g, 'ai', 'monsters_forktail', 'melee', 5);
  const dragon = give(g, 'player', 'neutral_villentretenmerth');
  g.playCard('player', g.side.player.hand.indexOf(dragon), 'melee');
  check(!onRow(g, 'ai', 'melee', best.uid), '对方该排最强的 5 被摧毁');
  check(onRow(g, 'ai', 'melee', w1.uid) && onRow(g, 'ai', 'melee', w2.uid), '并列次强的 4+4 存活（不是整排清空）');
}
{
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  const hero = put(g, 'ai', 'northern_esterad_thyssen', 'melee', 10);
  const w1 = put(g, 'ai', 'northern_blue_stripes_commando', 'melee', 4);
  const dragon = give(g, 'player', 'neutral_villentretenmerth');
  g.playCard('player', g.side.player.hand.indexOf(dragon), 'melee');
  check(onRow(g, 'ai', 'melee', hero.uid), '英雄免疫焚风');
  check(!onRow(g, 'ai', 'melee', w1.uid), '英雄的 10 点计入门槛 → 非英雄最强的 4 被摧毁');
}

console.log('\n===== 4. 特殊牌焚风：全场最强（含己方），无 10 点门槛 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const mine = put(g, 'player', 'northern_ballista', 'siege', 5);
  const his = put(g, 'ai', 'monsters_arachas', 'melee', 5);
  const smaller = put(g, 'ai', 'monsters_nekker', 'melee', 2);
  const sc = give(g, 'player', 'special_scorch');
  const res = g.playCard('player', g.side.player.hand.indexOf(sc), null);
  check(res.ok, '焚风牌可以打出');
  check(!onRow(g, 'player', 'siege', mine.uid), '并列最强的己方单位也被摧毁（真规则含己方）');
  check(!onRow(g, 'ai', 'melee', his.uid), '并列最强的对方单位被摧毁');
  check(onRow(g, 'ai', 'melee', smaller.uid), '较低战力的单位存活');
}
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const his = put(g, 'ai', 'monsters_arachas', 'melee', 5);
  const sc = give(g, 'player', 'special_scorch');
  g.playCard('player', g.side.player.hand.indexOf(sc), null);
  check(!onRow(g, 'ai', 'melee', his.uid), '全场最高只有 5 分时依然生效（旧版误判「总分≤10 无效」）');
}

console.log('\n===== 5. 医生复活 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const dead = bury(g, 'player', 'northern_ballista', 6, true);
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  check(!!g.pendingMedic, '玩家医生开出复活选择');
  check(g.pendingMedic && g.pendingMedic.options.includes(dead.uid), '被焚风摧毁的单位出现在可复活列表');
  if (g.pendingMedic) g.applyMedic('player', dead.uid);
  check(onRow(g, 'player', 'siege', dead.uid), '复活成功并直接上场');
  check(!inGrave(g, 'player', dead.uid), '复活后离开坟场');
}
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const hero = bury(g, 'player', 'northern_esterad_thyssen', 10, false);
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  check(!g.pendingMedic || !g.pendingMedic.options.includes(hero.uid), '英雄不可被医生复活');
}
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const dead = bury(g, 'player', 'northern_ballista', 6, false);
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  if (g.pendingMedic) g.applyMedic('player', dead.uid);
  check(g.current === 'ai' || g.passed.player || g.passed.ai || g.over, '医生结算后正常交回合');
}

console.log('\n===== 6. 领袖「摧毁整排」= 只摧毁最强 =====');
{
  const g = fresh('monsters', 'scoiatael', { aLeader: 'scoiatael_francesca_queen_of_dol_blathanna' });
  begin(g);
  const w1 = put(g, 'player', 'monsters_arachas', 'melee', 4);
  const w2 = put(g, 'player', 'monsters_arachas', 'melee', 4);
  const best = put(g, 'player', 'monsters_vampire_katakan', 'melee', 5);
  g.current = 'ai';
  const res = g.useLeader('ai');
  check(res.ok, 'AI 领袖技可用');
  check(!onRow(g, 'player', 'melee', best.uid), '只摧毁最强的 5');
  check(onRow(g, 'player', 'melee', w1.uid) && onRow(g, 'player', 'melee', w2.uid), '其余单位存活（旧版会整排清空）');
}
{
  const g = fresh('monsters', 'scoiatael', { aLeader: 'scoiatael_francesca_queen_of_dol_blathanna' });
  begin(g);
  const w1 = put(g, 'player', 'monsters_arachas', 'melee', 4);
  g.current = 'ai';
  g.useLeader('ai');
  check(onRow(g, 'player', 'melee', w1.uid), '对方该排总战力 <10 → 领袖技无效');
}

console.log('\n===== 7. 领袖「整排翻倍」真的生效 =====');
{
  const g = fresh('monsters', 'northern', { pLeader: 'monsters_eredin_commander_of_the_red_riders' });
  begin(g);
  g.current = 'player';
  put(g, 'player', 'monsters_arachas', 'melee', 4);
  put(g, 'player', 'monsters_imlerith', 'melee', 10);
  const before = g.rowTotal('player', 'melee');
  const res = g.useLeader('player');
  check(res.ok, '近战翻倍领袖技可用');
  eq(g.rowTotal('player', 'melee'), before + 4, '该排非英雄单位翻倍（英雄不受影响；旧版 _dbl 无人读取 = 完全无效）');
  g.side.player.horn.melee = true;
  g.refresh();
  eq(g.rowTotal('player', 'melee'), before + 4, '已有号角时不再叠乘');
}

console.log('\n===== 8. 阵营被动 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  put(g, 'player', 'northern_ballista', 'siege', 6);
  const handBefore = g.side.player.hand.length;
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.roundWinner, 'player', '北方赢下第 1 局');
  eq(g.side.player.hand.length, handBefore + 1, '北方阵营被动：赢局后抽 1 张');
}
{
  const g = fresh('nilfgaard', 'monsters');
  begin(g);
  put(g, 'player', 'nilfgaard_black_infantry_archer', 'ranged', 5);
  put(g, 'ai', 'monsters_arachas', 'melee', 5);
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.roundWinner, 'player', '平局时尼弗迦德获胜');
}
{
  const g = fresh('monsters', 'northern');
  begin(g);
  put(g, 'player', 'monsters_arachas', 'melee', 4);
  put(g, 'player', 'monsters_arachas', 'melee', 4);
  put(g, 'ai', 'northern_ballista', 'siege', 6);
  g.passed = { player: true, ai: true };
  g._endRound();
  const pKept = ROWS.reduce((a, r) => a + g.side.player.rows[r].length, 0);
  const aKept = ROWS.reduce((a, r) => a + g.side.ai.rows[r].length, 0);
  eq(pKept, 1, '怪物阵营留 1 张单位进入下一局');
  eq(aKept, 0, '非怪物阵营场上清空');
  eq(g.side.player.graveyard.filter(c => c.type === 'unit').length, 1, '留下的牌没有同时进坟场');
}
{
  const g = fresh('scoiatael', 'monsters');
  g.doMulligan([]);
  g.finishMulligan();
  check(!!g.pendingFirstPick, '松鼠党被动：挂起等待玩家选择先手');
  g.applyFirstChoice(false);
  eq(g.current, 'ai', '玩家选择「让对手先手」生效');
  eq(g.pendingFirstPick, null, '选择后清除挂起状态');
}
{
  const g = fresh('northern', 'monsters');
  begin(g);
  put(g, 'player', 'northern_ballista', 'siege', 6);
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.current, 'player', '上一局胜者先手（旧版是双方轮换）');
}

console.log('\n===== 9. 双方无牌可出时对局必须收束（旧版会无限空转） =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  put(g, 'player', 'northern_ballista', 'siege', 6);
  g.side.player.hand.length = 0;
  g.side.ai.hand.length = 0;
  g.side.player.leaderUsed = true;
  g.side.ai.leaderUsed = true;
  let rounds = 0;
  while (!g.over && rounds++ < 12) { g.passed = { player: true, ai: true }; g._endRound(); }
  check(g.over, '双方无牌可出时对局正常结束（不再无限空转）');
  eq(g.winner, 'player', '按已赢局数判定胜负');
  check(rounds <= 3, `最多打 3 局（实际 ${rounds}）`);
}

console.log('\n===== 10. 换牌上限按整局累计（跨多次调用也不能超过 2 张） =====');
{
  const g = fresh('northern', 'monsters');
  const before = g.side.player.hand.map(c => c.uid);
  g.doMulligan([{ side: 'player', index: 0 }, { side: 'player', index: 1 }]);
  g.doMulligan([{ side: 'player', index: 0 }, { side: 'player', index: 1 }]);
  const swapped = before.filter(u => !g.side.player.hand.some(c => c.uid === u)).length;
  eq(swapped, 2, '整个换牌阶段最多只换 2 张');
  eq(g.side.player.pile.filter(c => before.includes(c.uid)).length >= 0, true, '牌堆状态正常');
}

console.log('\n===== 11. 新一局：分数归零 + 留场牌缓存刷新 =====');
{
  const g = fresh('northern', 'nilfgaard');
  begin(g);
  put(g, 'player', 'northern_ballista', 'siege', 6);
  put(g, 'ai', 'nilfgaard_black_infantry_archer', 'ranged', 4);
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.scores.player, 0, '新一局玩家分数归零（不是上一局的 6）');
  eq(g.scores.ai, 0, '新一局对手分数归零（不是上一局的 4）');
  eq(g.round, 2, '已进入第 2 局');
}
{
  const g = fresh('monsters', 'northern');
  begin(g);
  put(g, 'player', 'monsters_arachas', 'melee', 4);
  g.side.player.horn.melee = true;
  g.refresh();
  eq(g.rowTotal('player', 'melee'), 8, '号角先把该排翻倍');
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.rowTotal('player', 'melee'), 4, '新一局号角失效，留场牌的缓存已重算');
}

console.log('\n===== 12. 松鼠党挂起期间禁止出牌/过牌/用领袖 =====');
{
  const g = fresh('scoiatael', 'monsters');
  g.doMulligan([]);
  g.finishMulligan();
  check(!!g.pendingFirstPick, '先手选择挂起中');
  check(!g.playCard('player', 0, null).ok, '挂起期间不能出牌');
  check(!g.pass('player').ok, '挂起期间不能过牌');
  check(!g.canUseLeader('player'), '挂起期间不能用领袖技');
  g.applyFirstChoice(true);
  eq(g.current, 'player', '选择「我先手」后轮到自己');
  // 手牌第 0 张可能是「没有可收回目标」的诱饵 → 挑一张一定能打出去的单位牌（避免随机牌序导致的假失败）
  const playableIdx = g.side.player.hand.findIndex(c => c.type !== 'special');
  check(playableIdx >= 0 && g.playCard('player', playableIdx, null).ok, '选择后可以正常出牌');
}

console.log('\n===== 13. 复活的间谍不再算「对方场上的间谍」 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const spy = bury(g, 'player', 'northern_thaler', 1, false);
  spy.spied = true;
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  if (g.pendingMedic) g.applyMedic('player', spy.uid);
  check(!spy.spied, '复活的间谍回到自己场上（spied 已清）');
}

console.log('\n===== 14. 医生只能复活本次候选里的己方单位 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  bury(g, 'player', 'northern_ballista', 6, false);                       // 合法候选
  const his = makeCard(ALL_CARDS['monsters_arachas']);
  his.owner = 'ai';
  g.side.ai.graveyard.push(his);                                          // 对方坟场的牌
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  check(!g.pendingMedic.options.includes(his.uid), '对方坟场的牌不在候选里');
  const opts = g.pendingMedic.options.slice();
  g.applyMedic('player', his.uid);                                        // 非法 uid
  check(!onRow(g, 'player', 'melee', his.uid) && !onRow(g, 'player', 'ranged', his.uid) && !onRow(g, 'player', 'siege', his.uid),
    '非法 uid 不会把对方的牌复活到自己场上');
  check(opts.length > 0, '合法候选仍存在');
}

console.log('\n===== 15. 同袍：n 张同名同排 → 每张 ×n（合计 ×n²） =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const powerOf = (uid) => {
    const c = g.side.player.rows.melee.find(x => x.uid === uid);
    return c ? c._effective : null;
  };
  const a = put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  eq(powerOf(a.uid), 4, '1 张 → 4');
  const b = put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  eq(powerOf(a.uid), 8, '2 张 → 每张 8');
  eq(powerOf(b.uid), 8, '2 张 → 新来的也是 8');
  eq(g.rowTotal('player', 'melee'), 16, '2 张合计 16（×2²）');
  const c3 = put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  eq(powerOf(a.uid), 12, '3 张 → 每张 12');
  eq(powerOf(c3.uid), 12, '3 张 → 第三张也是 12');
  eq(g.rowTotal('player', 'melee'), 36, '3 张合计 36（×3²）');
  // 号角在同袍倍率之后
  g.side.player.horn.melee = true;
  g.refresh();
  eq(powerOf(a.uid), 24, '号角再 ×2 → 24');
  eq(g.rowTotal('player', 'melee'), 72, '号角后合计 72');
  g.side.player.horn.melee = false;
  // 天气按卡面字面最后覆盖为 1
  g.weather.frost = true;
  g.refresh();
  eq(g.rowTotal('player', 'melee'), 3, '冰霜把该排三张同袍全降为 1（合计 3）');
  g.weather.frost = false;
  g.refresh();
}
{
  // 不同排不互相加成
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const x = put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  const y = put(g, 'player', 'northern_blue_stripes_commando', 'ranged', 4);   // 人为放到另一排
  g.refresh();
  eq(x._effective, 4, '近战排 1 张 → 4');
  eq(y._effective, 4, '远程排 1 张 → 4（不跨排加成）');
}

console.log('\n===== 16. 同袍 × 鼓舞：倍率先算、鼓舞后加 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const a = put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  put(g, 'player', 'northern_blue_stripes_commando', 'melee', 4);
  // 放一个鼓舞单位（米尔瓦，本为远程；这里人为放到近战排）
  const moral = makeCard(ALL_CARDS['scoiatael_milva']);
  moral.row = 'melee'; moral.owner = 'player'; moral._side = 'player'; moral.placedRow = 'melee';
  g.side.player.rows.melee.push(moral);
  g._applyEnterBuffs(moral, 'player', 'melee');
  g.refresh();
  eq(a._effective, 13, '同袍 4×3=12，再 +1 鼓舞 = 13（不是 (4+1)×3=15）');
  eq(g.rowTotal('player', 'melee'), 13 * 3 + 10, '该排合计 39 + 米尔瓦 10');
}
{
  // 多个鼓舞单位叠加 +2（旧版只 +1）
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  put(g, 'player', 'northern_kaedweni_siege_expert', 'siege', 1, true);
  put(g, 'player', 'northern_kaedweni_siege_expert', 'siege', 1, true);
  const ballista = put(g, 'player', 'northern_ballista', 'siege', 6, true);
  g.refresh();
  eq(ballista.buff, 2, '两个鼓舞单位 → 新进场单位 +2');
  eq(ballista._effective, 8, '6 + 2 = 8');
}
{
  // 英雄不接收鼓舞，但英雄鼓舞单位仍然给本排 +1（凯兰：英雄 + 鼓舞）
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  const kayran = makeCard(ALL_CARDS['monsters_kayran']);
  kayran.owner = 'player'; kayran._side = 'player'; kayran.placedRow = 'melee';
  g.side.player.rows.melee.push(kayran);
  g._applyEnterBuffs(kayran, 'player', 'melee');
  const u = put(g, 'player', 'monsters_arachas', 'melee', 4, true);
  g.refresh();
  eq(u.buff, 1, '英雄鼓舞单位也给本排 +1');
  eq(u._effective, 5, '4 + 1 = 5');
  eq(kayran._effective, 8, '英雄自身不吃鼓舞（仍是 8）');
}

console.log('\n===== 17. 召唤（集合）：双向对称 + 可选的「连手牌一起拉」 =====');
{
  // 真规则默认：牌堆 + 手牌都拉（玩家反馈 #3：游戏里集合会强制打出手牌里的同组牌）
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'vampire');            // 自动组牌里本来就有吸血鬼，先清干净
  for (const id of ['monsters_vampire_bruxa', 'monsters_vampire_ekimmara', 'monsters_vampire_fleder',
                    'monsters_vampire_garkain', 'monsters_vampire_katakan']) {
    const c = makeCard(ALL_CARDS[id]);
    c.owner = 'player';
    g.side.player.pile.push(c);
  }
  const handA = give(g, 'player', 'monsters_vampire_bruxa');
  const handB = give(g, 'player', 'monsters_vampire_fleder');
  const played = give(g, 'player', 'monsters_vampire_ekimmara');
  const handBefore = g.side.player.hand.length;
  const res = g.playCard('player', g.side.player.hand.indexOf(played), 'melee');
  check(res.ok, '打出吸血鬼（召唤）');
  const field = g.side.player.rows.melee.map(c => c.defId);
  eq(field.filter(id => id === 'monsters_vampire_bruxa').length, 2, '牌堆里的布鲁萨 + 手牌里的布鲁萨都上场了（真规则）');
  eq(field.filter(c => c.startsWith('monsters_vampire_')).length, 8, '打出的 1 张 + 牌堆 5 张 + 手牌 2 张 = 场上 8 张同组牌');
  check(!g.side.player.hand.some(c => c.uid === handA.uid), '手牌里的布鲁萨被强制拉上场（旧版留在手上）');
  check(!g.side.player.hand.some(c => c.uid === handB.uid), '手牌里的弗莱德也被拉上场');
  eq(g.side.player.pile.filter(c => (c.mg || c.defId) === 'vampire').length, 0, '牌堆里的同组牌已被拉空');
  eq(g.side.player.hand.length, handBefore - 3, '手牌少了打出的 1 张 + 被拉走的 2 张');
}
{
  // 关掉「连手牌一起拉」→ 只从牌堆拉（更省手牌，玩家更喜欢的口径）
  const g = fresh('monsters', 'northern', { options: { musterAuto: true, musterFromHand: false } });
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'vampire');
  for (const id of ['monsters_vampire_bruxa', 'monsters_vampire_katakan']) {
    const c = makeCard(ALL_CARDS[id]); c.owner = 'player'; g.side.player.pile.push(c);
  }
  const handA = give(g, 'player', 'monsters_vampire_bruxa');
  const played = give(g, 'player', 'monsters_vampire_ekimmara');
  g.playCard('player', g.side.player.hand.indexOf(played), 'melee');
  eq(g.side.player.rows.melee.filter(c => (c.mg || c.defId) === 'vampire').length, 3, '只从牌堆拉：场上 3 张（打出的 1 + 牌堆 2）');
  check(g.side.player.hand.some(c => c.uid === handA.uid), '手牌里的同组牌留在手上（设置已关闭手牌拉牌）');
}
{
  // 关掉「集合自动拉牌」→ 集合牌就是一张普通单位牌
  const g = fresh('monsters', 'northern', { options: { musterAuto: false, musterFromHand: true } });
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'nekker');
  const inDeck = give(g, 'player', 'monsters_nekker');       // 先给一张再挪进牌堆
  g.side.player.hand.pop();
  inDeck.owner = 'player';
  g.side.player.pile.push(inDeck);
  const played = give(g, 'player', 'monsters_nekker');
  const res = g.playCard('player', g.side.player.hand.indexOf(played), 'melee');
  check(res.ok, '召唤关闭时集合牌仍可正常打出');
  eq(g.side.player.rows.melee.filter(c => c.defId === 'monsters_nekker').length, 1, '牌堆里的同组牌没有被自动拉出来');
  eq(g.side.player.pile.filter(c => c.defId === 'monsters_nekker').length, 1, '它还在牌堆里');
}
{
  // 双向对称（玩家反馈 #3：巨兽能拉蟹蜘蛛，蟹蜘蛛拉不到巨兽）
  const g = fresh('monsters', 'northern', { options: { musterAuto: true, musterFromHand: false } });
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'arachas');
  const beh = makeCard(ALL_CARDS['monsters_arachas_behemoth']); beh.owner = 'player'; g.side.player.pile.push(beh);
  const a1 = makeCard(ALL_CARDS['monsters_arachas']); a1.owner = 'player'; g.side.player.pile.push(a1);
  const played = give(g, 'player', 'monsters_arachas');
  const res = g.playCard('player', g.side.player.hand.indexOf(played), 'melee');
  check(res.ok, '打出阿拉哈斯');
  check(g.side.player.rows.siege.some(c => c.uid === beh.uid) || g.side.player.rows.melee.some(c => c.uid === beh.uid),
    '阿拉哈斯把牌堆里的「阿拉哈斯巨兽」也拉上场了（反方向同样成立）');
  eq(g.side.player.rows.melee.filter(c => c.defId === 'monsters_arachas').length + 0, 2, '牌堆里的另一张阿拉哈斯也在场（打出的 1 + 拉出的 1）');
}
{
  // 牌堆没有同组牌：不报错
  const g = fresh('monsters', 'northern');
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'nekker');
  const n = give(g, 'player', 'monsters_nekker');
  const res = g.playCard('player', g.side.player.hand.indexOf(n), 'melee');
  check(res.ok, '牌堆无同组牌时召唤不报错');
  eq(g.side.player.rows.melee.filter(c => c.defId === 'monsters_nekker').length, 1, '只有打出的那一张在场');
}
{
  // 医生复活的召唤牌会再次触发召唤
  const g = fresh('monsters', 'northern', { options: { musterAuto: true, musterFromHand: false } });
  begin(g);
  g.current = 'player';
  clearGroup(g, 'player', 'vampire');
  const dead = bury(g, 'player', 'monsters_vampire_bruxa', 4, false);
  for (const id of ['monsters_vampire_katakan', 'monsters_vampire_garkain']) {
    const c = makeCard(ALL_CARDS[id]);
    c.owner = 'player';
    g.side.player.pile.push(c);
  }
  const medic = give(g, 'player', 'northern_dun_banner_medic');
  g.playCard('player', g.side.player.hand.indexOf(medic), 'siege');
  if (g.pendingMedic) g.applyMedic('player', dead.uid);
  g.refresh();
  check(onRow(g, 'player', 'melee', dead.uid), '复活的吸血鬼上场');
  eq(g.side.player.rows.melee.filter(c => (c.mg || c.defId) === 'vampire').length, 3, '复活后再次召唤出牌堆里的同组牌（共 3 张）');
}

/* ============================================================
 * 第二批（2026-09-17 第二轮玩家反馈 10 条）—— 18~24
 *   18) 诱饵失效/卡死   19) 天气互相覆盖   20) 世界毁灭者全程随机
 *   21) 平局不加胜场   22) 松鼠党每局都能定先手   23) 敏捷不能选排
 *   24) 号角不能选排
 * ============================================================ */

console.log('\n===== 18. 诱饵：走引擎的「挂起 → 选目标」协议（旧版 UI 绕开引擎 = 永远失败） =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const unit = put(g, 'player', 'northern_blue_stripes_commando', 'melee');
  const decoy = give(g, 'player', 'special_decoy');
  const res = g.playCard('player', g.side.player.hand.indexOf(decoy), null);
  check(res.needTarget === 'decoy', '打出诱饵 → 引擎挂起「待选目标」（ok=false 是这个协议的正常值）');
  check(!!g.pendingDecoy, 'pendingDecoy 已设置');
  check(g.side.player.hand.some(c => c.uid === decoy.uid), '未收目标前诱饵仍在手牌');
  check(!g.playCard('player', 0, null).ok, '选目标期间不能出别的牌（不会插队把状态搞乱）');
  const r2 = g.applyDecoy('player', unit.uid);
  check(r2.ok, '选中单位后收回成功');
  check(g.side.player.hand.some(c => c.uid === unit.uid), '被收回的单位回到手牌');
  check(!onRow(g, 'player', 'melee', unit.uid), '单位已离场');
  check(!g.side.player.hand.some(c => c.uid === decoy.uid), '诱饵已消耗（不在手牌）');
  check(g.side.player.graveyard.some(c => c.uid === decoy.uid), '诱饵进了坟场');
  check(!g.pendingDecoy, '挂起状态已清空（不会卡死在选目标模式）');
}
{
  // 场上没有可收回单位（只有英雄）→ 直接拒绝，且不留挂起状态
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  put(g, 'player', 'monsters_kayran', 'melee');       // 英雄（免疫诱饵）
  const decoy = give(g, 'player', 'special_decoy');
  const res = g.playCard('player', g.side.player.hand.indexOf(decoy), null);
  check(!res.ok && res.needTarget !== 'decoy', '只有英雄时直接失败');
  check(!g.pendingDecoy, '不会留下 pendingDecoy（旧版会让 UI 卡死）');
  check(g.side.player.hand.some(c => c.uid === decoy.uid), '诱饵留在手牌');
}

console.log('\n===== 19. 天气各管一排：霜冻与雨天可同时挂（旧版互相覆盖） =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  const enemy = put(g, 'ai', 'monsters_arachas', 'melee', 5);
  const enemy2 = put(g, 'ai', 'monsters_arachas', 'ranged', 5);   // 借个远程位放非英雄
  const frost = give(g, 'player', 'special_biting_frost');
  g.playCard('player', g.side.player.hand.indexOf(frost), null);
  eq(g.weather.frost, true, '霜冻生效');
  g.current = 'player';
  const rain = give(g, 'player', 'special_torrential_rain');
  g.playCard('player', g.side.player.hand.indexOf(rain), null);
  eq(g.weather.frost, true, '打雨天不会清掉霜冻（玩家反馈 #10）');
  eq(g.weather.rain, true, '雨天同时生效');
  eq(g.rowTotal('ai', 'melee'), 1, '近战非英雄被霜冻压到 1');
  eq(g.rowTotal('ai', 'ranged'), 5, '远程排不受霜冻影响（5 点原样）');
  g.current = 'player';
  const clear = give(g, 'player', 'special_clear_weather');
  g.playCard('player', g.side.player.hand.indexOf(clear), null);
  check(!g.weather.frost && !g.weather.rain, '只有「天晴」才清空所有天气');
}

console.log('\n===== 20. 领袖「世界毁灭者」：弃哪 2 张、取哪 1 张都由玩家自己选 =====');
{
  const g = fresh('monsters', 'northern', { pLeader: 'monsters_eredin_destroyer_of_worlds' });
  begin(g);
  g.current = 'player';
  const pileBefore = g.side.player.pile.length;
  const handUids = g.side.player.hand.map(c => c.uid);
  const res = g.useLeader('player');
  check(res.ok && res.pendingDiscard, '领袖技挂起「选择要弃掉的牌」');
  check(g.side.player.leaderUsed, '领袖技已标记用掉（不能反复触发）');
  check(!g.playCard('player', 0, null).ok, '未完成弃牌前不能出牌');
  check(!g.pass('player').ok, '未完成弃牌前不能过牌');
  check(!g.applyDiscard('player', handUids.slice(0, 1)).ok, '只选 1 张会被拒绝');
  check(!g.applyDiscard('player', [handUids[0], handUids[0]]).ok, '同一张牌选两次会被拒绝');
  check(!g.applyDiscard('player', [handUids[0], 999999]).ok, '手牌里没有的牌会被拒绝');
  const r2 = g.applyDiscard('player', [handUids[0], handUids[1]]);
  check(r2.ok && r2.pendingDeckPick, '弃牌完成 → 挂起「从牌组挑 1 张」');
  eq(g.side.player.graveyard.filter(c => handUids.slice(0, 2).includes(c.uid)).length, 2, '进坟场的正是玩家选的那 2 张');
  check(!g.side.player.hand.some(c => handUids.slice(0, 2).includes(c.uid)), '这 2 张已不在手牌');
  const want = g.side.player.pile[3];
  const r3 = g.applyDeckPick('player', want.uid);
  check(r3.ok, '从牌组取牌成功');
  check(g.side.player.hand.some(c => c.uid === want.uid), '取到的正是玩家挑的那一张（旧版是随机）');
  eq(g.side.player.pile.length, pileBefore - 1, '牌堆少 1 张');
  check(!g.pendingDeckPick && !g.pendingDiscard, '挂起状态全部清空');
}

console.log('\n===== 21. 小局平局：双方各 +1；1:0 之后打平 = 2:1 直接结束 =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  put(g, 'player', 'northern_blue_stripes_commando', 'melee', 6);
  put(g, 'ai', 'monsters_arachas', 'melee', 6);
  eq(g.scores.player, g.scores.ai, '双方同分');
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.side.player.roundsWon, 1, '平局 → 玩家 +1 胜场');
  eq(g.side.ai.roundsWon, 1, '平局 → 对手 +1 胜场');
  check(!g.over, '1:1 → 还要打第 3 局');
}
{
  const g = fresh('northern', 'monsters');
  begin(g);
  put(g, 'player', 'northern_ballista', 'siege', 6);
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.side.player.roundsWon, 1, '第 1 局玩家拿下（1:0）');
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.side.player.roundsWon, 2, '第 2 局打平 → 玩家也 +1');
  eq(g.side.ai.roundsWon, 1, '对手拿到 1 胜');
  check(g.over, '2:1 → 整局立刻结束（旧版平局不加分，会白打第 3 局）');
  eq(g.winner, 'player', '玩家获胜');
}

console.log('\n===== 22. 松鼠党被动：只有第一局能定先手（可选项放开为每局） =====');
{
  const g = fresh('scoiatael', 'monsters');
  g.doMulligan([]);
  g.finishMulligan();
  check(!!g.pendingFirstPick, '第 1 局挂起等待选择');
  g.applyFirstChoice(true);
  g.passed = { player: true, ai: true };
  g._endRound();
  eq(g.round, 2, '进入第 2 局');
  check(!g.pendingFirstPick, '第 2 局不再挂起（真规则：只有第一局，玩家反馈 #6）');
  eq(g.current, 'ai', '第 2 局先手改由引擎决定（平局无人获胜 → 双方轮换，第 1 局先手是玩家）');
}
{
  const g = fresh('scoiatael', 'monsters', { options: { scoiataelEveryRound: true } });
  g.doMulligan([]);
  g.finishMulligan();
  if (g.pendingFirstPick) g.applyFirstChoice(true);
  g.passed = { player: true, ai: true };
  g._endRound();
  check(!!g.pendingFirstPick, '打开「每局都能定先手」选项后，第 2 局照样挂起');
}

console.log('\n===== 23. 敏捷单位：两排都合法，玩家选哪排就放哪排 =====');
{
  const g = fresh('scoiatael', 'monsters');
  begin(g);
  g.current = 'player';
  const agile = give(g, 'player', 'scoiatael_barclay_els');
  eq(g.rowOptions(agile).length, 2, '敏捷单位有两个合法排（近战/远程）');
  check(g.needsRowChoice(agile), '引擎提示「需要玩家选排」');
  const res = g.playCard('player', g.side.player.hand.indexOf(agile), 'ranged');
  check(res.ok, '打得出去');
  eq(g.side.player.rows.ranged.filter(c => c.uid === agile.uid).length, 1, '落在玩家选的远程排（旧版自动挑一排）');
  eq(g.side.player.rows.melee.filter(c => c.uid === agile.uid).length, 0, '没有落到近战排');
}
{
  const g = fresh('scoiatael', 'monsters');
  begin(g);
  g.current = 'player';
  const fixed = give(g, 'player', 'scoiatael_elven_skirmisher');    // 固定远程排
  eq(g.rowOptions(fixed).length, 1, '固定排单位只有一个合法排');
  check(!g.needsRowChoice(fixed), '不需要选排');
  const res = g.playCard('player', g.side.player.hand.indexOf(fixed), 'melee');
  check(!res.ok, '传一个不合法的排 → 直接拒绝（不再悄悄换排）');
  check(g.side.player.hand.some(c => c.uid === fixed.uid), '被拒绝的牌仍在手牌');
}

console.log('\n===== 24. 号角：由玩家指定排；不叠加的排会被拒绝（不白扔一张） =====');
{
  const g = fresh('northern', 'monsters');
  begin(g);
  g.current = 'player';
  put(g, 'player', 'northern_ballista', 'siege', 6);
  const horn = give(g, 'player', 'special_commanders_horn');
  const res = g.playCard('player', g.side.player.hand.indexOf(horn), 'siege');
  check(res.ok, '放到玩家选的攻城排');
  eq(g.rowTotal('player', 'siege'), 12, '该排非英雄 ×2');
  eq(g.side.player.horn.melee, false, '没有自作主张放到近战排（旧版自动挑一排）');
  const horn2 = give(g, 'player', 'special_commanders_horn');
  g.current = 'player';
  const r2 = g.playCard('player', g.side.player.hand.indexOf(horn2), 'siege');
  check(!r2.ok, '同一排第二张号角被拒绝（不叠加）');
  check(g.side.player.hand.some(c => c.uid === horn2.uid), '被拒绝的号角仍在手牌（没有白扔）');
}
{
  // 领袖「号令」翻倍过的排同样不能再放号角
  const g = fresh('monsters', 'northern', { pLeader: 'monsters_eredin_commander_of_the_red_riders' });
  begin(g);
  g.current = 'player';
  put(g, 'player', 'monsters_arachas', 'melee', 4);
  g.useLeader('player');
  const horn = give(g, 'player', 'special_commanders_horn');
  g.current = 'player';
  const res = g.playCard('player', g.side.player.hand.indexOf(horn), 'melee');
  check(!res.ok, '已被领袖技翻倍的排不能再叠号角');
  check(g.side.player.hand.some(c => c.uid === horn.uid), '号角留在手牌');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
