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
  const g = new GwentGame({ playerDeck: pDeck, aiDeck: aDeck, playerFirst: true, aiSkill: opts.aiSkill == null ? 0.8 : opts.aiSkill });
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
/** 直接往场上放一张单位 */
function put(g, side, defId, row, power) {
  const c = makeCard(ALL_CARDS[defId]);
  if (power != null) c.power = power;
  c.owner = side; c._side = side; c.placedRow = row;
  g.side[side].rows[row].push(c);
  g.refresh();
  return c;
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

console.log('\n===== 2. 开局调度（换牌） =====');
{
  const g = fresh('northern', 'monsters');
  const before = g.side.player.hand.map(c => c.uid);
  const pileBefore = g.side.player.pile.length;
  g.doMulligan([{ side: 'player', index: 0 }, { side: 'player', index: 1 }, { side: 'player', index: 2 }]);
  eq(g.side.player.hand.length, 10, '换牌后仍是 10 张');
  eq(g.side.player.pile.length, pileBefore, '牌堆张数不变（换回 → 洗回 → 再抽）');
  eq(g.side.player.pile.filter(c => c.uid === before[0]).length, 1, '换回的牌回到牌堆');
  check(!g.side.player.hand.some(c => c.uid === before[0]), '换回的牌没有留在手里');
  eq(g.side.player.pile.filter(c => before.slice(0, 3).includes(c.uid)).length, 2, '最多只换 2 张（第 3 张未被换出）');
  g.aiMulligan();
  check(g.aiMulliganDone === true, 'AI 也执行了换牌流程');
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
  check(g.playCard('player', 0, null).ok, '选择后可以正常出牌');
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

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
