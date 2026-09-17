/* ============================================================
 * 昆特牌（巫师3 版）规则引擎
 * GwentEngine —— 纯逻辑、无 DOM，UI 只负责渲染本模块状态。
 *
 * 规则要点（巫师3 内置昆特牌 / 经典三排版）：
 *  - 三局两胜，每局限时出牌直到双方都「过」。
 *  - 每排单位战力求和；天气牌把对应排的非英雄单位降为 1；
 *    号角把该排非英雄单位 ×2；英雄免疫天气/号角/焚风/诱饵/医生复活。
 *  - 同袍(tight_bond)：同行同名每多一张 +1 倍基础（本实现：n 张 → 每张按 n×基础? 采用
 *    官方口径：存在另一张同名则各翻倍一次 —— 见 normalizeRowPower 中实现并可用配置切换）。
 *    —— 注：当前实现使用「n 张同排同名 → 每张贡献 = 基础 × n」(即总 = 基础 × n²)，
 *    与多数 Gwent 复刻(如 Cynthia.Card / LegacyGwent)一致。可据调研修正。
 *  - 领袖技每局一次。
 *  - 回合开始抽牌至手牌 10 张；第一局开局可换 2 张（mulligan）。
 * ============================================================ */
'use strict';

const ROWS = ['melee', 'ranged', 'siege'];
const ROW_CN = { melee: '近战', ranged: '远程', siege: '攻城' };

/* ---------------- 全局效果描述表（特殊牌） ---------------- */
const WEATHER = {
  frost: { row: 'melee', zh: '刺骨冰霜', icon: '❄️', desc: '所有近战排非英雄单位战力降为 1' },
  fog:   { row: 'ranged', zh: '迷漫浓雾', icon: '🌫️', desc: '所有远程排非英雄单位战力降为 1' },
  rain:  { row: 'siege', zh: '倾盆大雨', icon: '🌧️', desc: '所有攻城排非英雄单位战力降为 1' },
};

/* 领袖效果 code → 文案 */
const LEADER_CN = {
  clear_weather:     '放晴：清除场上所有天气效果',
  horn_melee:        '号令：己方近战排全体 ×2',
  horn_ranged:       '号令：己方远程排全体 ×2',
  horn_siege:        '号令：己方攻城排全体 ×2',
  double_siege:      '攻城：己方攻城排单位战力翻倍',
  double_ranged:     '远程：己方远程排单位战力翻倍',
  double_melee:      '近战：己方近战排单位战力翻倍',
  scorch_enemy_max:  '焚风：摧毁对方场上战力最高的非英雄单位（并列全灭）',
  draw_one:          '谋略：抽 1 张牌',
  draw_two:          '谋略：抽 2 张牌',
  revive_own:        '亡灵：从己方坟场复活一张单位上场',
  steal_opp_discard: '窃取：从对方坟场取一张牌加入自己手牌',
  spy_any:           '卧底：任意排放置一张 1 战力间谍到自己场上（你抽 1）',
  buff_melee_1:      '士气：己方近战排非英雄单位各 +1',
  fog_again:         '浓雾再临：天气变为浓雾（不影响其它天气）',
  frost_again:       '寒潮：天气变为刺骨冰霜（不影响其它天气）',
  rain_again:        '暴雨倾盆：天气变为倾盆大雨（不影响其它天气）',
  take_enemy_hand:   '王权：随机取对方手牌 1 张加入己方手牌',
  deck_weather_frost: '从牌组取出一张「刺骨冰霜」并使用（不影响其它天气）',
  deck_weather_fog:  '从牌组取出一张「蔽日浓雾」并使用（不影响其它天气）',
  deck_weather_rain: '从牌组取出一张「倾盆大雨」并使用（不影响其它天气）',
  deck_weather_any:  '从牌组取出一张天气牌并使用（不影响其它天气）',
  see_opponent_hand: '查看对手手牌中随机 3 张',
  cancel_opponent_leader: '封锁对手的领袖技（对手已用时无效）',
  discard_2_draw_1:  '弃掉 2 张牌（由你选），再从牌组挑 1 张加入手牌（也由你选）',
  revive_to_hand:    '从己方坟场取一张牌加入手牌',
  destroy_enemy_melee:  '焚风：对方近战排总战力 ≥10 时，摧毁该排最强的非英雄单位（并列全灭）',
  destroy_enemy_siege:  '焚风：对方攻城排总战力 ≥10 时，摧毁该排最强的非英雄单位（并列全灭）',
  draw_extra_first_round: '被动：第一局开始时额外抽 1 张牌',
};

/* ---------------- 纸牌对象：见 data.js 的 makeCard（此处不再重复定义） ---------------- */

/* ---------------- 牌组 ---------------- */
class GwentGame {
  /**
   * @param {object} cfg
   *  - playerDeck: { faction, leader, cards:[CardDef...] }
   *  - aiDeck:    同
   *  - playerFirst: boolean
   *  - aiSkill: 0..1
   *  - tightBondPowerOf: 'n2' | 'double'  （同袍结算方式，默认 'n2'）
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.tightMode = cfg.tightBondPowerOf || 'n2';
    this.round = 1;
    this.side = {
      player: this._buildSide('player', cfg.playerDeck),
      ai:     this._buildSide('ai', cfg.aiDeck),
    };
    this.weather = { frost: false, fog: false, rain: false }; // 场上天气
    this.passed = { player: false, ai: false };
    this.scores = { player: 0, ai: 0 };
    this.current = null;        // 'player'|'ai'
    this.first = cfg.playerFirst ? 'player' : 'ai';
    this.winner = null;         // 整局赢家
    this.roundWinner = null;    // 本局赢家
    this.over = false;
    this.needMulligan = false;
    // 领袖「翻倍整排」标记（与号角同效，不叠加 —— 见 _effectivePower）
    this.doubled = { player: { melee: false, ranged: false, siege: false },
                     ai:     { melee: false, ranged: false, siege: false } };
    this.aiMulliganDone = false;
    this.pendingFirstPick = null;   // 松鼠党被动：由该方决定谁先手（等待 UI 选择）
    this.needLeaderTarget = null; // 需要点选目标的领袖效果类型
    this.log = [];
    this.events = [];            // 供 UI 消费的事件队列（音效/动画）
    this.pendingScorch = null;   // 焚风连锁待结算
    this.roundHistory = [];      // 每局比分记录（结算界面用）
    this.stats = { player: this._blankStats(), ai: this._blankStats() };
    this.aiSkill = cfg.aiSkill == null ? 0.6 : cfg.aiSkill;
    this.difficulty = cfg.difficulty || 'normal';
    // 可调规则选项：默认共用全局 GAME_OPTIONS（设置面板改了立刻生效）；测试可用 cfg.options 覆盖
    this.opts = (cfg && cfg.options) || (typeof GAME_OPTIONS !== 'undefined' ? GAME_OPTIONS : {});
    // 需要玩家做选择的挂起状态（UI 弹窗处理完再调用对应的 apply* 方法）
    this.pendingDiscard = null;     // 领袖「世界毁灭者」：选择要弃掉的手牌
    this.pendingDeckPick = null;    // 领袖「世界毁灭者」：从牌组挑一张
  }

  /** 读一个规则选项（没有就返回默认值） */
  _opt(name, def) {
    const v = this.opts ? this.opts[name] : undefined;
    return typeof v === 'boolean' ? v : def;
  }

  /** 是否还有必须由玩家完成的选择（UI 一律用这个判断，别再逐个字段写） */
  hasPendingChoice() {
    return !!(this.pendingFirstPick || this.pendingMedic || this.pendingDiscard || this.pendingDeckPick);
  }

  /** 空统计表（结算界面用） */
  _blankStats() {
    return { units: 0, specials: 0, spies: 0, medics: 0, musters: 0, leaders: 0, scorches: 0, weather: 0, horn: 0, passed: 0, power: 0 };
  }

  _buildSide(name, deck) {
    const d = deck.cards.slice();
    // 洗牌
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return {
      name, deck: deck,
      leaderId: deck.leader.id,
      leaderUsed: false,
      pile: d,          // 抽牌堆
      hand: [],
      graveyard: [],
      rows: { melee: [], ranged: [], siege: [] },
      horn: { melee: false, ranged: false, siege: false },
      roundsWon: 0,
    };
  }

  /* ---------- 初始：抽 10、第一局换牌 ---------- */
  start() {
    for (const s of ['player', 'ai']) this._drawTo(s, 10);
    // 领袖被动：法兰茜丝卡·溪谷雏菊 —— 第一局额外抽 1 张
    for (const s of ['player', 'ai']) {
      if (this.side[s].deck.leader.effect === 'draw_extra_first_round') {
        this._drawCards(this.side[s], 1).forEach(c => this.side[s].hand.push(c));
        this._log('sys', `${s === 'player' ? '你' : '对手'}的领袖被动：额外抽 1 张牌`);
      }
    }
    this.needMulligan = true;
    this.aiMulliganDone = false;
    this.mulliganUsed = { player: 0, ai: 0 };   // 每方最多换 2 张（整个换牌阶段累计）
    // 被换掉的牌先「放在一边」——调度期间不在牌堆里，所以绝不会被重新抽到（真规则）
    this.mulliganSetAside = { player: [], ai: [] };
    this._log('sys', `游戏开始！双方各抽 10 张牌。调度规则：选一张不要的牌 → 立刻重抽一张，最多 ${this._mulliganLimit()} 次；换掉的牌本轮不会再抽到，调度结束后洗回牌堆。`);
    this._log('sys', `${this.side.player.deck.faction}  VS  ${this.side.ai.deck.faction}`);
  }

  _mulliganLimit() {
    return (typeof DECK_RULES !== 'undefined' && DECK_RULES.mulligan) || 2;
  }

  getSides() { return this.side; }

  /** 开局调度（逐张）：把手里第 handIndex 张放到一边，立刻从牌堆重抽一张。
   *  真规则（W3 内置昆特）：选一张不要的牌 → 重新抓一张，最多 2 次；
   *  换掉的牌不会被重复抓到（它们此刻不在牌堆里），调度结束后再洗回牌堆。
   *  @returns {{ok:boolean, out?:Card, in?:Card, left?:number, error?:string}}
   */
  mulliganSwap(sideName, handIndex) {
    if (!this.needMulligan) return { ok: false, error: '现在不是开局调度阶段' };
    const LIMIT = this._mulliganLimit();
    const s = this.side[sideName];
    if (!s) return { ok: false, error: '未知方' };
    const used = this.mulliganUsed[sideName] || 0;
    if (used >= LIMIT) return { ok: false, error: `最多只能换 ${LIMIT} 张` };
    const card = s.hand[handIndex];
    if (!card) return { ok: false, error: '手牌索引无效' };
    s.hand.splice(handIndex, 1);
    this.mulliganSetAside[sideName].push(card);
    this.mulliganUsed[sideName] = used + 1;
    const nc = this._drawCards(s, 1)[0] || null;     // 换回的牌不在牌堆里 → 抽不到它
    if (nc) s.hand.push(nc);
    this._log('sys', `${sideName === 'player' ? '你' : '对手'}换掉「${card.name.zh}」${nc ? `，重抽到「${nc.name.zh}」` : '（牌堆已空，没得抽）'}（还剩 ${Math.max(0, LIMIT - this.mulliganUsed[sideName])} 次）`);
    return { ok: true, out: card, in: nc, left: Math.max(0, LIMIT - this.mulliganUsed[sideName]) };
  }

  /** 一次换多张（测试/无头入口用）：按顺序逐张结算，所以同样受 2 张上限约束。
   *  hands: [{side, index}] —— 索引按「当前手牌」逐个结算（与旧版行为一致）。 */
  doMulligan(replacements) {
    if (!this.needMulligan) return;
    for (const r of (replacements || [])) this.mulliganSwap(r.side, r.index);
  }

  /** AI 开局调度（引擎侧实现，保证所有入口都一致；难度越高换得越准） */
  aiMulligan() {
    if (this.aiMulliganDone) return;
    this.aiMulliganDone = true;
    if (!this.needMulligan) return;
    const side = this.side.ai;
    const skill = this.aiSkill == null ? 0.6 : this.aiSkill;
    if (skill < 0.4) return;                       // 简单 AI 不换牌
    const limit = skill >= 0.8 ? 2 : 1;
    const scored = side.hand.map((c, i) => ({ i, c, v: this._mulliganValue(c) }));
    scored.sort((a, b) => a.v - b.v);
    const picks = scored.filter(x => x.v < 5).slice(0, limit);
    if (!picks.length) return;
    picks.sort((a, b) => b.i - a.i);               // 从后往前换，索引不串位
    for (const p of picks) this.mulliganSwap('ai', p.i);
  }

  _mulliganValue(c) {
    if (c.ability === 'spy') return 100;
    if (c.ability === 'medic') return 80;
    if (c.type === 'hero') return 90;
    if (c.type === 'special') {
      if (c.kind === 'horn') return 45;
      if (c.kind === 'scorch') return 40;
      if (c.kind === 'clear') return 30;
      if (c.kind === 'weather') return 25;
      return 20;
    }
    if (c.ability === 'muster') return 55;
    if (c.ability === 'commanders_horn') return 60;
    let v = c.power || 0;
    if (c.ability === 'tight_bond') v += 2;
    if (c.ability === 'morale_boost') v += 3;
    return v;
  }

  finishMulligan() {
    if (!this.needMulligan) return;
    this.aiMulligan();                 // 双方都要换牌
    this.needMulligan = false;
    // 调度结束：被换掉的牌才洗回牌堆（调度期间它们不在牌堆里 ⇒ 一定不会被重复抓到）
    for (const s of ['player', 'ai']) {
      const pile = this.side[s].pile;
      const back = (this.mulliganSetAside && this.mulliganSetAside[s]) || [];
      for (const c of back) pile.splice(Math.floor(Math.random() * (pile.length + 1)), 0, c);
      if (back.length) this._log('sys', `${s === 'player' ? '你' : '对手'}换掉的 ${back.length} 张牌已洗回牌堆。`);
    }
    this.mulliganSetAside = { player: [], ai: [] };
    this.beginRound();
  }

  beginRound() {
    this.passed = { player: false, ai: false };
    this.weather = { frost: false, fog: false, rain: false };
    for (const s of ['player', 'ai']) {
      const side = this.side[s];
      // 怪物阵营被动：小局结束时随机留下 1 张单位牌继续留在场上
      const keep = side.deck.faction === 'monsters' ? this._monstersKeep(s) : null;
      for (const r of ROWS) {
        const kept = (keep && keep.placedRow === r) ? keep : null;
        const leaving = side.rows[r].filter(c => c !== kept);
        side.rows[r] = kept ? [kept] : [];
        for (const c of leaving) this._toGrave(c, s);
        side.horn[r] = false;
        this.doubled[s][r] = false;
      }
      if (keep) this._log(s, `  怪物阵营被动：「${keep.name.zh}」留在场上进入下一局`);
    }
    // 小局之间不抽牌（真规则：开局 10 张用到底，额外摸牌只靠间谍/领袖/北方被动）
    // 先手：第一局由开局决定；之后「上局胜者先手」
    if (this.round === 1) this.current = this.first;
    else if (this.roundWinner) this.current = this.roundWinner;
    else this.current = this._prevFirst === 'player' ? 'ai' : 'player';
    // 松鼠党阵营被动：由该方决定谁先手
    // 真规则：只有【第一局】能用（旧版每局都给，等于白送两局优势）——可在设置里放开
    const everyRound = this._opt('scoiataelEveryRound', false);
    const chooser = (this.round === 1 || everyRound) ? this._firstChooser() : null;
    if (chooser === 'player') {
      this.pendingFirstPick = { round: this.round };
      this._log('sys', '松鼠党被动：由你决定本局谁先手（请选择）');
      return;
    }
    if (chooser === 'ai') this.current = this._aiPickFirst();
    this._startRoundPlay();
  }

  /** 谁有「决定先手」的权利（松鼠党阵营被动） */
  _firstChooser() {
    if (this.side.player.deck.faction === 'scoiatael') return 'player';
    if (this.side.ai.deck.faction === 'scoiatael') return 'ai';
    return null;
  }

  /** AI 的先手选择：先手是劣势，通常选择后手 */
  _aiPickFirst() { return 'player'; }

  /** UI/驱动：松鼠党被动选择先手方 */
  applyFirstChoice(takeFirst) {
    if (!this.pendingFirstPick) return { ok: false };
    this.pendingFirstPick = null;
    this.current = takeFirst ? 'player' : 'ai';
    this._startRoundPlay();
    return { ok: true };
  }

  _startRoundPlay() {
    this._prevFirst = this.current;
    this.refresh();                      // 新一局场上为空 → 必须重算分数/缓存，否则 UI 会显示上一局的比分
    this._log('sys', `———— 第 ${this.round} 局开始，${this.current === 'player' ? '你' : '对手'} 先手 ————`);
    this._logTurn();
  }

  _logTurn() {
    if (this.current === 'player') this._log('sys', '轮到你出牌。');
  }

  /* ---------- 抽牌 ---------- */
  _drawCards(side, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = side.pile.shift();
      if (!c) break;
      c.owner = side.name;
      out.push(c);
    }
    return out;
  }
  _drawTo(sideName, count) {
    const s = this.side[sideName];
    const n = Math.max(0, count - s.hand.length);
    const arr = this._drawCards(s, n);
    s.hand.push(...arr);
  }

  /* ---------- 工具 ---------- */
  isPlayerTurn() { return this.current === 'player' && !this.over; }

  cardCount(sideName) { return this.side[sideName].pile.length; }

  /** 单位可否放在该排 */
  cardFitsRow(card, row) {
    if (card.type === 'leader' || card.type === 'special') return false;
    if (card.row === 'agile') return row === 'melee' || row === 'ranged';
    if (Array.isArray(card.rows)) return card.rows.includes(row);
    return card.row === row;
  }

  /** 该单位所有合法排（UI 用它判断「是否需要玩家选排」）。
   *  真规则：敏捷单位由玩家自己决定放近战还是远程（旧版自动选，玩家无法干预）。 */
  rowOptions(card) {
    return ROWS.filter(r => this.cardFitsRow(card, r));
  }

  /** 是否需要玩家手动选排（≥2 个合法排） */
  needsRowChoice(card) {
    return this.rowOptions(card).length > 1;
  }

  /** 该排最终战力（考虑号角/天气/士气等已经过 buff 后做一次性求值） */
  rowTotal(sideName, row) {
    const side = this.side[sideName];
    let total = 0;
    const w = this.weather;
    const weatherOnRow =
      (row === 'melee' && w.frost) ||
      (row === 'ranged' && w.fog) ||
      (row === 'siege' && w.rain);
    for (const card of side.rows[row]) {
      if (card.tomb) continue;
      let p = card._effective || this._effectivePower(card, sideName, row, weatherOnRow);
      total += p;
    }
    return total;
  }

  /** 单卡最终战力
   *  结算顺序（依据 asundr/gwent-classic `Row.calcCardScore` + 巫师3 卡面）：
   *    同袍倍率 → 鼓舞 +N → 天气覆盖为 1 → 号角/领袖翻倍
   *  即：同袍先把基础战力按同排同名张数放大，鼓舞是「加算」的 +1/每个鼓舞单位，
   *  天气按卡面字面把该排战力「降为 1」，号角最后翻倍。 */
  _effectivePower(card, sideName, row, weatherOnRow) {
    let p = card.power || 0;
    const isHero = card.type === 'hero';
    if (!isHero) {
      // 同袍（n² 模式：n 张同名同排 → 每张 ×n，总战力 ×n²；可用 tightBondPowerOf='double' 切成 ×2）
      const bond = this.bondCount(sideName, card, row);
      if (bond > 1) p *= bond;
      // 鼓舞/士气：每个同排鼓舞单位 +1（加算在倍率之后）
      if (card.buff) p += card.buff;
      // 天气
      if (weatherOnRow) p = 1;
      // 号角（特殊牌号角 / 场上「指挥官号角」单位 / 领袖号令）
      // 领袖「整排翻倍」与号角同效，不叠加（真规则：unless a Commander's Horn is present）
      const horned = this.side[sideName].horn[row] || this._rowHasHornUnit(sideName, row);
      if (horned || this.doubled[sideName][row]) p *= 2;
      // 天晴抵消不掉已 buff
    }
    return p;
  }

  /** 同袍倍率：同排同名（defId）张数；非同级牌 / 不同排不互相加成 */
  bondCount(sideName, card, row) {
    if (!(card.ability === 'tight_bond' && card.type === 'unit')) return 1;
    const n = this.side[sideName].rows[row].filter(c => c.defId === card.defId && !c.tomb).length;
    if (this.tightMode === 'double') return n >= 2 ? 2 : 1;
    return Math.max(1, n);
  }

  /** 召唤组名（缺省用 defId = 同名）。组关系是【对称】的：
   *  两张牌只要有一侧声明了 mg 指向另一侧（或声明了同一个 mg），就算同组。
   *  旧版只比 `mg || defId` —— 只要数据里某一侧漏写 mg，就会出现「A 能拉 B、B 拉不到 A」。 */
  musterGroup(card) { return card.mg || card.defId; }

  /** c 是否属于 origin 的召唤组（对称判定，修掉「反过来不行」） */
  inMusterGroup(origin, c) {
    if (!c || !origin || c.type !== 'unit') return false;
    if (c === origin) return false;
    if (this.musterGroup(c) === this.musterGroup(origin)) return true;
    if (c.mg && c.mg === origin.defId) return true;
    if (origin.mg && origin.mg === c.defId) return true;
    return false;
  }

  /** 召唤：该组还在【牌堆】里的张数 */
  musterDeckCount(sideName, card) {
    if (card.ability !== 'muster') return 0;
    return this.side[sideName].pile.filter(c => this.inMusterGroup(card, c)).length;
  }

  /** 召唤：该组在【手牌】里的张数（是否会一起被拉上场取决于设置 musterFromHand） */
  musterHandCount(sideName, card) {
    if (card.ability !== 'muster') return 0;
    return this.side[sideName].hand.filter(c => this.inMusterGroup(card, c)).length;
  }

  /** 该排是否受天气影响 */
  _rowWeather(sideName, row) {
    const w = this.weather;
    return (row === 'melee' && w.frost) || (row === 'ranged' && w.fog) || (row === 'siege' && w.rain);
  }

  /** 怪物阵营被动：随机挑一张场上【己方】单位牌留到下一局（没有则返回 null） */
  _monstersKeep(sideName) {
    const units = [];
    for (const r of ROWS) for (const c of this.side[sideName].rows[r]) {
      if (!c.tomb && !c.spied) units.push(c);      // 不保留对方间谍
    }
    if (!units.length) return null;
    return units[Math.floor(Math.random() * units.length)];
  }

  /** 场上牌离开 → 进坟场。注意：进坟场后 tomb 必须清掉，
   *  否则医生/领袖复活会把「被焚风摧毁的牌」当成不可用（旧版 bug）。 */
  _toGrave(card, sideName) {
    card.tomb = false;
    card.placedRow = null;
    card._effective = null;
    card.inGrave = true;
    this.side[sideName].graveyard.push(card);
  }

  /** 该排是否存在「指挥官号角」单位（丹德里恩） */
  _rowHasHornUnit(sideName, row) {
    return this.side[sideName].rows[row].some(c => !c.tomb && c.ability === 'commanders_horn');
  }

  /** 刷新某排所有卡的 _effective 缓存并返回总和（顺带全盘重算总分） */
  refresh() {
    for (const s of ['player', 'ai']) {
      for (const r of ROWS) {
        const w =
          (r === 'melee' && this.weather.frost) ||
          (r === 'ranged' && this.weather.fog) ||
          (r === 'siege' && this.weather.rain);
        for (const c of this.side[s].rows[r]) {
          if (!c.tomb) c._effective = this._effectivePower(c, s, r, w);
        }
      }
    }
    this._recalcTotals();
  }

  _recalcTotals() {
    this.scores.player = ROWS.reduce((a, r) => a + this.rowTotal('player', r), 0);
    this.scores.ai = ROWS.reduce((a, r) => a + this.rowTotal('ai', r), 0);
  }

  /* =========================================================
   * 出牌
   * ========================================================= */
  /** 有未完成的选择 → 返回统一的拒绝对象；没有则返回 null。
   *  旧版只挡了「先手选择 / 医生」，领袖弃牌、诱饵等挂起状态都能被别的操作插队。 */
  _pendingBlock() {
    if (this.pendingFirstPick) return { ok: false, error: '请先选择本局先手方' };
    if (this.pendingMedic) return { ok: false, error: '请先完成医生复活选择' };
    if (this.pendingDiscard) return { ok: false, error: '请先完成领袖技的弃牌选择' };
    if (this.pendingDeckPick) return { ok: false, error: '请先从牌组选择要取走的牌' };
    if (this.pendingDecoy) return { ok: false, error: '请先选择诱饵要收回的单位（或取消）' };
    return null;
  }

  /**
   * @returns {{ok:boolean, error?:string, events?:array}}
   */
  playCard(sideName, handIndex, targetRow) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    const blocked = this._pendingBlock();
    if (blocked) return blocked;
    if (this.current !== sideName) return { ok: false, error: '还没轮到你' };
    if (this.passed[sideName]) return { ok: false, error: '本局你已过牌' };
    const side = this.side[sideName];
    const card = side.hand[handIndex];
    if (!card) return { ok: false, error: '手牌索引无效' };
    const events = [];
    let deferTurn = false;

    // ---------- 特殊牌 ----------
    if (card.type === 'special') {
      if (targetRow && !ROWS.includes(targetRow)) return { ok: false, error: '目标排无效' };
      const res = this._playSpecial(sideName, card, targetRow);
      if (!res.ok) return res;
      events.push(...res.events);
    } else {
      // ---------- 单位 / 英雄 ----------
      // 玩家明确指定的排必须合法：不能悄悄换成另一排（否则「我明明选了远程」会被无视）
      if (targetRow && !this.cardFitsRow(card, targetRow)) {
        return { ok: false, error: `该单位不能放在${ROW_CN[targetRow] || targetRow}排` };
      }
      if (card.ability === 'spy') {
        // 间谍：放在对方场上（对方计分），自己抽 2
        const enemy = sideName === 'player' ? 'ai' : 'player';
        const row = this._pickRow(card, enemy, targetRow);
        if (!row) return { ok: false, error: '需选择放置排' };
        side.hand.splice(handIndex, 1);
        card.owner = enemy; card.placedRow = row; card._side = enemy; card.spied = true;
        this.side[enemy].rows[row].push(card);
        this._applyEnterBuffs(card, enemy, row);
        this._drawCards(side, card.spyDraw || 2).forEach(c => side.hand.push(c));
        this._log(sideName, `打出间谍「${card.name.zh}」放置到对方${ROW_CN[row]}排，抽 ${card.spyDraw || 2} 张牌`);
        events.push({ type: 'spy', card, side: sideName });
      } else {
        const row = this._pickRow(card, sideName, targetRow);
        if (!row) return { ok: false, error: `该单位不能放在这里` };
        side.hand.splice(handIndex, 1);
        card.owner = sideName; card.placedRow = row; card._side = sideName;
        side.rows[row].push(card);
        this._applyEnterBuffs(card, sideName, row);
        this._log(sideName, `打出「${card.name.zh}」到${ROW_CN[row]}排`);
        events.push({ type: 'unit', card, side: sideName });

        // 同袍(tight_bond)：日志里说明这一手把该排同名牌放大到几倍
        if (card.ability === 'tight_bond') {
          const n = this.bondCount(sideName, card, row);
          if (n > 1) this._log(sideName, `  同袍：${ROW_CN[row]}排现有 ${n} 张「${card.name.zh}」，每张战力 ×${n}（合计 ${(card.power || 0) * n * n}）`);
          else this._log(sideName, `  同袍：该排暂时只有 1 张「${card.name.zh}」，同名越多每张越强`);
        }
        // 召唤(muster)：牌组中同组卡牌全部自动打出（各归其排）
        if (card.ability === 'muster') {
          events.push(...this._doMuster(sideName, card, row));
        }
        // 医生(medic)：从坟场复活一张己方单位（玩家可选，AI 自动）
        if (card.ability === 'medic') {
          const mres = this._startMedic(sideName, card);
          if (mres.pending) deferTurn = true;
          else events.push(...(mres.events || []));
        }
        // 焚风(scorch)：金龙进场时触发（真规则：只打对方同排最强的非英雄单位）
        if (card.ability === 'scorch') {
          events.push(...this._scorchEnemyRow(sideName, row, card));
        }
        // 鼓舞(morale)：已通过 _applyEnterBuffs 实现即时、永久生效
      }
    }

    // 阶段推进（医生待选时挂起，等 UI 调用 applyMedic 后再推进）
    this._recordPlay(sideName, card);
    this._emit(events);
    if (!deferTurn) this._afterPlay(sideName, events);
    this.refresh();
    return { ok: true, events, pendingMedic: !!this.pendingMedic };
  }

  /* =========================================================
   * 焚风（Scorch）—— 两种口径，别混用：
   *  1) 特殊牌「焚风」：弃置后摧毁【全场】最强的非英雄单位（含己方，并列全灭）
   *  2) 单位焚风（金龙 Villentretenmerth / 蟾蜍 / 席鲁）与两位领袖：
   *     若对方该排总战力 ≥ 10，摧毁该排【最强】的非英雄单位（并列全灭，不是整排）
   *  依据：巫师3 原版卡面 + asundr/gwent-classic abilities.js（scorch / scorch_c）
   * ========================================================= */
  /** 特殊牌焚风：全场最强非英雄单位（含己方） */
  _scorchBattlefield(sideName, source) {
    this.refresh();                       // 用最新战力判定，避免使用旧缓存
    let max = -1;
    let cands = [];
    for (const s of ['player', 'ai']) {
      for (const r of ROWS) {
        for (const c of this.side[s].rows[r]) {
          if (c.tomb || c.type === 'hero') continue;
          const p = this._effectivePower(c, s, r, this._rowWeather(s, r));
          if (p > max) { max = p; cands = []; }
          if (p === max) cands.push({ side: s, row: r, card: c });
        }
      }
    }
    if (max < 0) {
      this._log(sideName, `焚风（${source.name.zh}）：场上没有可摧毁的非英雄单位`);
      return [];
    }
    this._log(sideName, `焚风（${source.name.zh}）：全场最高战力 ${max}`);
    return this._destroyUnits(cands, sideName);
  }

  /** 排焚风（金龙 / 领袖技）：对方该排总战力 ≥10 时，摧毁该排最强的非英雄单位 */
  _scorchEnemyRow(sideName, row, source) {
    this.refresh();
    const enemy = this._other(sideName);
    const total = this.rowTotal(enemy, row);          // 英雄也计入总战力
    if (total < 10) {
      this._log(sideName, `焚风（${source.name.zh}）：对方${ROW_CN[row]}排总战力 ${total} < 10，无效`);
      return [];
    }
    const rowCards = this.side[enemy].rows[row].filter(c => !c.tomb && c.type !== 'hero');
    if (!rowCards.length) {
      this._log(sideName, `焚风（${source.name.zh}）：对方${ROW_CN[row]}排没有非英雄单位`);
      return [];
    }
    let max = -1;
    for (const c of rowCards) max = Math.max(max, this._effectivePower(c, enemy, row, this._rowWeather(enemy, row)));
    const victims = rowCards.filter(c => this._effectivePower(c, enemy, row, this._rowWeather(enemy, row)) === max);
    this._log(sideName, `焚风（${source.name.zh}）：摧毁对方${ROW_CN[row]}排最强（${max}）的 ${victims.length} 张单位`);
    return this._destroyUnits(victims.map(c => ({ side: enemy, row, card: c })), sideName);
  }

  /** 统一的摧毁结算：离场 → 进坟场（tomb 清掉，保证可被医生复活） */
  _destroyUnits(victims, actor) {
    const killed = [];
    for (const v of victims) {
      const os = this.side[v.side];
      const ri = os.rows[v.row].indexOf(v.card);
      if (ri < 0) continue;
      os.rows[v.row].splice(ri, 1);
      this._removeBuffsOf(v.card, v.side, v.row);
      this._toGrave(v.card, v.side);
      killed.push(v.card);
      this._log(actor, `  摧毁了${v.side === actor ? '己方' : '对方'}「${v.card.name.zh}」`);
    }
    return killed.length ? [{ type: 'scorch', victims: killed }] : [];
  }

  /** 旧的统一入口（特殊牌焚风）：保留名字给外部调用 */
  _triggerScorch(sideName, source) {
    return this._scorchBattlefield(sideName, source);
  }

  /** 医生：开牌（玩家弹窗选择 / AI 自动选最强） */
  _startMedic(sideName, medicCard, depth) {
    const side = this.side[sideName];
    // 真规则：己方坟场里的【单位牌】（不含英雄/特殊牌）；被焚风摧毁的牌同样可复活
    const targets = side.graveyard.filter(c =>
      c.type === 'unit' && c.owner === sideName
    );
    if (!targets.length) return { events: [] };
    if (sideName === 'player') {
      this.pendingMedic = { side: sideName, options: targets.map(t => t.uid), depth: depth || 0 };
      return { pending: true, events: [] };
    }
    targets.sort((a, b) => (b.power || 0) - (a.power || 0));
    return { events: this._reviveToBoard(sideName, targets[0], depth || 0) };
  }

  /** 把坟场中的单位复活到场上（复活的牌自身技能也生效：可医生连锁/召唤，带深度上限防死循环） */
  _reviveToBoard(sideName, t, depth) {
    depth = depth || 0;
    const side = this.side[sideName];
    const idx = side.graveyard.indexOf(t);
    if (idx < 0) return [];
    const row = this._pickRow(t, sideName, null);
    if (!row) return [];
    side.graveyard.splice(idx, 1);
    t.owner = sideName; t.placedRow = row; t._side = sideName; t.tomb = false; t.inGrave = false;
    t.spied = false;                   // 复活的间谍回到自己场上，不再是「对方场上的间谍」
    side.rows[row].push(t);
    this._applyEnterBuffs(t, sideName, row);
    this._log(sideName, `  医生复活了「${t.name.zh}」到${ROW_CN[row]}排`);
    const evs = [{ type: 'medic', card: t }];
    // 真规则：复活的牌自身技能照样生效（医生可连锁）。深度上限防止异常结构死循环。
    if (depth < 3) {
      if (t.ability === 'muster') {
        evs.push(...this._doMuster(sideName, t, row));
      } else if (t.ability === 'medic') {
        const r2 = this._startMedic(sideName, t, depth + 1);
        evs.push(...(r2.events || []));
      } else if (t.ability === 'scorch') {
        evs.push(...this._scorchEnemyRow(sideName, row, t));
      }
    }
    return evs;
  }

  /** UI：医生选择目标后调用（uid 必须来自本次给出的候选，防止复活对方/非候选的牌） */
  applyMedic(sideName, uid) {
    if (!this.pendingMedic || this.pendingMedic.side !== sideName) return { ok: false };
    const depth = this.pendingMedic.depth || 0;
    const opts = this.pendingMedic.options || [];
    this.pendingMedic = null;
    const side = this.side[sideName];
    const t = opts.indexOf(uid) >= 0
      ? side.graveyard.find(c => c.uid === uid && c.type === 'unit' && c.owner === sideName)
      : null;
    if (t) this._emit(this._reviveToBoard(sideName, t, depth));
    // 连锁：复活的医生若又开出新的选择，等 UI 继续处理，本轮不推进
    if (this.pendingMedic) { this.refresh(); return { ok: true, chained: true }; }
    this._afterPlay(sideName, []);
    this.refresh();
    return { ok: true };
  }

  _pickRow(card, sideName, targetRow) {
    if (targetRow && this.cardFitsRow(card, targetRow)) return targetRow;
    // 自动选择：优先不受天气影响、其次有同名/号角协同的合法排
    const valid = [];
    for (const r of ROWS) if (this.cardFitsRow(card, r)) valid.push(r);
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0];
    const side = this.side[sideName];
    let best = valid[0], bestScore = -Infinity;
    for (const r of valid) {
      const w = (r === 'melee' && this.weather.frost) || (r === 'ranged' && this.weather.fog) || (r === 'siege' && this.weather.rain);
      let s = 0;
      if (w && card.type !== 'hero') s -= 5;
      if (side.horn[r]) s += 2;
      if (side.rows[r].some(c => !c.tomb && c.defId === card.defId)) s += 3;
      if (side.rows[r].some(c => !c.tomb && c.ability === 'commanders_horn')) s += 2;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    return best;
  }

  /** 单位进场结算：鼓舞 buff 即时写入其它单位
   *  - 英雄鼓舞单位（伊森格林 / 凯兰）同样给本排 +1（敌人免疫的是「被加成」而不是「加成别人」）
   *  - 多个鼓舞单位叠加：每个 +1
   *  - 英雄不接收鼓舞加成（与参考实现 calcCardScore 的 `if (card.hero) return total` 一致） */
  _applyEnterBuffs(newCard, sideName, row) {
    const side = this.side[sideName];
    if (newCard.ability === 'morale_boost') {
      // 新来的鼓舞单位 → 给本排其它非英雄单位各 +1
      for (const c of side.rows[row]) {
        if (c === newCard || c.tomb || c.type === 'hero') continue;
        c.buff = (c.buff || 0) + 1;
      }
    } else if (newCard.type !== 'hero') {
      // 普通单位进场 → 本排每个鼓舞单位各给它 +1（旧版遇到第一个就 break，导致两个鼓舞只加 1）
      let n = 0;
      for (const c of side.rows[row]) {
        if (c === newCard || c.tomb) continue;
        if (c.ability === 'morale_boost') n++;
      }
      if (n) newCard.buff = (newCard.buff || 0) + n;
    }
  }

  /** 移除单位时回滚它的鼓舞 buff（焚风/领袖技用） */
  _removeBuffsOf(card, sideName, row) {
    const side = this.side[sideName];
    if (card.ability === 'morale_boost') {
      for (const c of side.rows[row]) {
        if (c === card || c.tomb || c.type === 'hero') continue;
        if (c.buff && c.buff > 0) c.buff -= 1;
      }
    }
  }

  /** 召唤：同组单位全部拉上场（各归其合法排）
   *  真规则（巫师3 卡面「Find any cards with the same name in your deck and play them instantly」）：
   *  把同组牌直接从牌堆打出来 —— 这会让「凑齐一组」变成强迫症，也会吃掉手牌。
   *  ⇒ 两个开关（设置面板）：
   *     · musterAuto     关掉后集合牌只是一张普通单位牌（有玩家觉得这样更好玩）
   *     · musterFromHand 开启后连手牌里的同组牌也一起打出去（真规则；会把你的手牌「强制上场」）
   *  组关系用 inMusterGroup 判定 → 双向对称，不会再出现「A 拉得到 B、B 拉不到 A」。
   */
  _doMuster(sideName, origin, row) {
    const side = this.side[sideName];
    const evs = [];
    if (!this._opt('musterAuto', true)) {
      this._log(sideName, `召唤：设置里已关闭「集合自动拉牌」，「${origin.name.zh}」作为普通单位牌留场`);
      return evs;
    }
    const fromHand = this._opt('musterFromHand', true);
    const group = this.musterGroup(origin);
    let power = 0;

    const bringIn = (c, from) => {
      c.owner = sideName; c._side = sideName;
      const r = this._pickRow(c, sideName, null) || row;
      c.placedRow = r;
      side.rows[r].push(c);
      this._applyEnterBuffs(c, sideName, r);
      power += c.power || 0;
      evs.push({ type: 'muster', card: c });
      this._log(sideName, `  召唤：「${c.name.zh}」${from === 'hand' ? '（手牌）' : ''}自动上场到${ROW_CN[r]}排`);
    };

    // 1) 牌堆里的同组牌
    for (let i = side.pile.length - 1; i >= 0; i--) {
      const c = side.pile[i];
      if (!this.inMusterGroup(origin, c)) continue;
      side.pile.splice(i, 1);
      bringIn(c, 'deck');
    }
    // 2) 手牌里的同组牌（真规则；可由设置关掉）
    if (fromHand) {
      for (let i = side.hand.length - 1; i >= 0; i--) {
        const c = side.hand[i];
        if (!this.inMusterGroup(origin, c)) continue;
        side.hand.splice(i, 1);
        bringIn(c, 'hand');
      }
    } else {
      const n = side.hand.filter(c => this.inMusterGroup(origin, c)).length;
      if (n) this._log(sideName, `  召唤：手牌里还有 ${n} 张同组牌（设置里未开启「连手牌一起拉」，它们留在手上）`);
    }

    if (evs.length) {
      this._log(sideName, `召唤结算（组「${group}」）：拉出 ${evs.length} 张同组牌（基础战力和 ${power}）`);
    } else {
      this._log(sideName, `召唤：牌堆里没有可召唤的同组牌`);
    }
    return evs;
  }

  /* ---------- 特殊牌 ---------- */
  _playSpecial(sideName, card, targetRow) {
    const side = this.side[sideName];
    const evs = [];
    switch (card.kind) {
      case 'weather':
        // 真规则（修正）：天气牌【各管一排】，互不覆盖 ——
        // 刺骨冰霜只冻近战、倾盆大雨只浇攻城，两者可以同时挂在场上；
        // 只有「天晴」才会清除全部天气。（旧版打一张雨就把霜冻清掉了 = 玩家反馈 #10）
        this.weather[card.weatherKey] = true;
        side.hand.splice(side.hand.indexOf(card), 1);
        side.graveyard.push(card); card.placedRow = null; card.used = true;
        this._log(sideName, `使用天气牌「${card.name.zh}」${WEATHER[card.weatherKey].desc}（只影响这一排，其它天气不受影响）`);
        evs.push({ type: 'weather', key: card.weatherKey });
        return { ok: true, events: evs };
      case 'clear':
        for (const k of Object.keys(this.weather)) this.weather[k] = false;
        side.hand.splice(side.hand.indexOf(card), 1);
        side.graveyard.push(card); card.used = true;
        this._log(sideName, '使用「天晴」，清除所有天气效果');
        evs.push({ type: 'clear' });
        return { ok: true, events: evs };
      case 'horn': {
        if (!targetRow) {
          // 需要 UI 指定排 —— 由 UI 调用 side-effects 前先 resolve
          this.pendingHorn = { side: sideName, card };
          return { ok: false, needRow: true, error: '需要选择目标排' };
        }
        // 号角不叠加：已号角 / 已被领袖技翻倍的排 → 直接拒绝，别让玩家白扔一张牌
        if (side.horn[targetRow] || this.doubled[sideName][targetRow]) {
          return { ok: false, error: `己方${ROW_CN[targetRow]}排已有号角或已被领袖技翻倍，号角不叠加 —— 请选别的排` };
        }
        side.hand.splice(side.hand.indexOf(card), 1);
        side.horn[targetRow] = true;
        side.graveyard.push(card); card.used = true;
        this._log(sideName, `在己方${ROW_CN[targetRow]}排放置号角，该排非英雄单位 ×2`);
        evs.push({ type: 'horn', row: targetRow });
        return { ok: true, events: evs };
      }
      case 'decoy': {
        // 需要选择自己场上非英雄单位（没有目标就别挂起 —— 否则 UI 会卡在"选目标"模式里出不来）
        const hasTarget = ROWS.some(r => side.rows[r].some(c => !c.tomb && c.type !== 'hero' && !c.spied));
        if (!hasTarget) return { ok: false, error: '场上没有可收回的单位（诱饵不能收回英雄/间谍）' };
        this.pendingDecoy = { side: sideName, card };
        return { ok: false, needTarget: 'decoy', error: '请选择场上要收回的单位' };
      }
      case 'scorch': {
        side.hand.splice(side.hand.indexOf(card), 1);
        side.graveyard.push(card); card.used = true;
        evs.push(...this._triggerScorch(sideName, card));
        return { ok: true, events: evs };
      }
      default:
        return { ok: false, error: '未知特殊牌' };
    }
  }

  /* ---------- 回合推进 / 过 ---------- */
  pass(sideName) {
    if (this.over || this.current !== sideName) return { ok: false };
    const blocked = this._pendingBlock();
    if (blocked) return blocked;
    if (this.passed[sideName]) return { ok: false, error: '本局你已过牌' };
    this.passed[sideName] = true;
    this._log(sideName, `${sideName === 'player' ? '你' : '对手'}选择【过】`);
    if (this.stats[sideName]) this.stats[sideName].passed++;
    this._emit([{ type: 'pass', side: sideName }]);
    this._afterPlay(sideName, [{ type: 'pass', side: sideName }]);
    return { ok: true };
  }

  _afterPlay(justPlayedSide, events) {
    // 检查双方都过 → 本局结束
    if (this.passed.player && this.passed.ai) { this._endRound(); return; }
    const other = this._other(justPlayedSide);
    if (this.passed[other]) {
      // 对方已过 → 由本方继续出牌（一人独自打完剩余手牌）
      this.current = justPlayedSide;
    } else {
      this.current = other;
    }
    // 自动过：手牌为空且无领袖可用
    if (!this.over) this._autoCheck(this.current);
    this._logTurn();
  }

  _autoCheck(sideName) {
    const side = this.side[sideName];
    const hasLeader = !side.leaderUsed && this._leaderTargetType(this.side[sideName].deck.leader) !== 'never';
    if (side.hand.length === 0 && !hasLeader && !this.passed[sideName]) {
      this.passed[sideName] = true;
      this._log('sys', `${sideName === 'player' ? '你' : '对手'}无牌可出，自动【过】`);
      this._afterPlay(sideName, []);
    }
  }

  _other(s) { return s === 'player' ? 'ai' : 'player'; }

  /* ---------- 局终结算 ---------- */
  _endRound() {
    this.refresh();
    const ps = this.scores.player, as = this.scores.ai;
    this._log('sys', `本局结算：你 ${ps} 分  VS  对手 ${as} 分`);
    if (ps === as) {
      // 尼弗迦德阵营被动：平局算尼弗迦德赢
      const nif = ['player', 'ai'].filter(s => this.side[s].deck.faction === 'nilfgaard');
      if (nif.length === 1) {
        this.roundWinner = nif[0];
        this.side[this.roundWinner].roundsWon++;
        this._log('sys', `平局！尼弗迦德阵营被动生效 —— ${this.roundWinner === 'player' ? '你' : '对手'}赢得第 ${this.round} 局。`);
      } else {
        // 真规则（修正 #8）：小局平局 → 双方胜场【同时 +1】。
        // 旧版谁都不加分：于是 1:0 之后打平，本该 2:1 直接结束，却还继续打第 3 局。
        this.roundWinner = null;
        this.side.player.roundsWon++;
        this.side.ai.roundsWon++;
        this._log('sys', `本局平局 —— 双方各得 1 个胜场（现在 ${this.side.player.roundsWon} : ${this.side.ai.roundsWon}）。`);
      }
    } else {
      this.roundWinner = ps > as ? 'player' : 'ai';
      this.side[this.roundWinner].roundsWon++;
      this._log('sys', `${this.roundWinner === 'player' ? '你' : '对手'}赢得第 ${this.round} 局！`);
    }
    // 北方领域阵营被动：赢下一局后抽 1 张
    if (this.roundWinner && this.side[this.roundWinner].deck.faction === 'northern') {
      const got = this._drawCards(this.side[this.roundWinner], 1);
      if (got.length) {
        this.side[this.roundWinner].hand.push(got[0]);
        this._log(this.roundWinner, `  北方领域被动：赢下本局，抽 1 张「${got[0].name.zh}」`);
      }
    }
    // 检查整局胜负
    this.roundHistory.push({ round: this.round, player: ps, ai: as, winner: this.roundWinner });
    this._emit([{ type: 'roundEnd', winner: this.roundWinner, scores: { player: ps, ai: as }, round: this.round }]);
    if (this.side.player.roundsWon >= 2 || this.side.ai.roundsWon >= 2) {
      this.over = true;
      const pw = this.side.player.roundsWon, aw = this.side.ai.roundsWon;
      if (pw >= 2 && aw >= 2) {
        // 平局给双方都加分 ⇒ 理论上可能出现 2:2（第 3 局打平）→ 整局平局
        this.winner = null;
        this._log('sys', `======== 整局结束：${pw}:${aw} —— 平局 ========`);
      } else {
        this.winner = pw >= 2 ? 'player' : 'ai';
        this._log('sys', `======== 整局结束：${this.winner === 'player' ? '你赢了！' : '对手获胜'}（${pw}:${aw}）========`);
      }
      this._emit([{ type: 'matchEnd', winner: this.winner }]);
      return;
    }
    // 三局两胜：第 3 局结束后按已赢局数定胜负（正常路径下这里不会走到，
    // 但「双方都换不出牌」时能保证对局一定收束，不会再无限空转）
    if (this.round >= 3) { this._finishByRounds(); return; }
    // 双方都没牌可出（手中无牌、领袖技也已用/不可用）→ 后续小局只会 0:0 空过
    const stuck = !this._hasPlayableResources('player') && !this._hasPlayableResources('ai');
    if (stuck) { this._finishByRounds(); return; }
    this.round++;
    this.beginRound();
  }

  /** 收束：按已赢局数判定整局胜负（平局则 winner=null） */
  _finishByRounds() {
    this.over = true;
    const pw = this.side.player.roundsWon, aw = this.side.ai.roundsWon;
    if (pw !== aw) {
      this.winner = pw > aw ? 'player' : 'ai';
      this._log('sys', `======== 对局结束：${this.winner === 'player' ? '你赢了' : '对手获胜'}（${pw}:${aw}）========`);
    } else {
      this.winner = null;
      this._log('sys', `======== 对局结束：${pw}:${aw} —— 平局 ========`);
    }
    this._emit([{ type: 'matchEnd', winner: this.winner }]);
  }

  /** 该方是否还有能出牌的手段（手牌 / 未用过且此刻有意义的领袖技） */
  _hasPlayableResources(sideName) {
    const side = this.side[sideName];
    if (side.hand.length > 0) return true;
    if (side.leaderUsed) return false;
    const e = side.deck.leader.effect;
    if (!e || this._leaderTargetType(side.deck.leader) === 'never') return false;
    switch (e) {
      case 'draw_one': case 'draw_two':
        return side.pile.length > 0;
      case 'deck_weather_frost': case 'deck_weather_fog': case 'deck_weather_rain':
        return side.pile.some(c => c.type === 'special' && c.kind === 'weather' && c.weatherKey === e.split('_')[2]);
      case 'deck_weather_any':
        return side.pile.some(c => c.type === 'special' && c.kind === 'weather');
      case 'revive_to_hand': case 'revive_own':
        return side.graveyard.some(c => c.type === 'unit');
      case 'steal_opp_discard':
        return this.side[this._other(sideName)].graveyard.length > 0;
      case 'take_enemy_hand':
        return this.side[this._other(sideName)].hand.length > 0;
      case 'cancel_opponent_leader':
        return !this.side[this._other(sideName)].leaderUsed;
      default:
        return true;
    }
  }

  /* ---------- 领袖技 ---------- */
  leaderTargets(sideName) {
    const leader = this.side[sideName].deck.leader;
    return this._leaderTargetType(leader);
  }

  /** 返回需要的目标类型：null(无需目标直接可用) | 'row' | 'unit' | 'discard' | 'never' */
  _leaderTargetType(leader) {
    if (!leader || !leader.effect) return 'never';
    const e = leader.effect;
    if (e === 'draw_extra_first_round') return 'never';   // 被动，开局已生效，不能主动使用
    if (e === 'horn_melee' || e === 'horn_ranged' || e === 'horn_siege' ||
        e === 'double_siege' || e === 'double_ranged' || e === 'double_melee' ||
        e === 'frost_again' || e === 'fog_again' || e === 'rain_again')
      return 'row';      // 无需真实选择，指向己方对应排（UI 也无需弹窗，可自动）
    return null;
  }

  canUseLeader(sideName) {
    const s = this.side[sideName];
    if (this._pendingBlock()) return false;
    if (s.leaderUsed || this.over || this.current !== sideName || this.passed[sideName]) return false;
    if (this._leaderTargetType(s.deck.leader) === 'never') return false;
    return true;
  }

  useLeader(sideName) {
    if (!this.canUseLeader(sideName)) return { ok: false, error: '领袖技不可用' };
    const s = this.side[sideName];
    const leader = s.deck.leader;
    const e = leader.effect;
    const evs = [];
    switch (e) {
      case 'clear_weather':
        for (const k in this.weather) this.weather[k] = false;
        this._log(sideName, `领袖「${leader.name.zh}」放晴`);
        break;
      case 'horn_melee': case 'horn_ranged': case 'horn_siege': {
        const row = e.split('_')[1];
        s.horn[row] = true;
        this._log(sideName, `领袖「${leader.name.zh}」号令己方${ROW_CN[row]}排 ×2`);
        evs.push({ type: 'horn', row });
        break;
      }
      case 'double_siege': this._doubleRow(sideName, 'siege'); this._log(sideName, `领袖「${leader.name.zh}」攻城翻倍`); break;
      case 'double_ranged': this._doubleRow(sideName, 'ranged'); this._log(sideName, `领袖「${leader.name.zh}」远程翻倍`); break;
      case 'double_melee': this._doubleRow(sideName, 'melee'); this._log(sideName, `领袖「${leader.name.zh}」近战翻倍`); break;
      case 'scorch_enemy_max': this._leaderScorchEnemy(sideName); break;
      case 'draw_one': this._drawCards(s, 1).forEach(c => s.hand.push(c)); this._log(sideName, `领袖「${leader.name.zh}」抽 1 张`); break;
      case 'draw_two': this._drawCards(s, 2).forEach(c => s.hand.push(c)); this._log(sideName, `领袖「${leader.name.zh}」抽 2 张`); break;
      /* ---- 从牌组取天气牌并使用 ---- */
      case 'deck_weather_frost': case 'deck_weather_fog': case 'deck_weather_rain': case 'deck_weather_any': {
        const want = e === 'deck_weather_any' ? null : e.split('_')[2];
        const idx = s.pile.findIndex(c => c.type === 'special' && c.kind === 'weather' && (!want || c.weatherKey === want));
        if (idx >= 0) {
          const wc = s.pile.splice(idx, 1)[0];
          // 天气各管一排：领袖取出的天气牌只开自己那一排，不清除其它天气（玩家反馈 #10 的同源修正）
          this.weather[wc.weatherKey] = true;
          s.graveyard.push(wc);
          this._log(sideName, `领袖「${leader.name.zh}」从牌组取出「${wc.name.zh}」${WEATHER[wc.weatherKey].desc}`);
          evs.push({ type: 'weather', key: wc.weatherKey });
        } else this._log('sys', '牌组中没有对应天气牌，领袖技无效');
        break;
      }
      /* ---- 排焚风（条件：对方该排总战力 ≥10）----
       * 真规则（巫师3 / asundr gwent-classic scorch_s、scorch_c）：
       * 摧毁对方该排【最强】的非英雄单位（并列全灭），不是整排。 */
      case 'destroy_enemy_melee': case 'destroy_enemy_siege': {
        const row = e === 'destroy_enemy_melee' ? 'melee' : 'siege';
        evs.push(...this._scorchEnemyRow(sideName, row, leader));
        break;
      }
      /* ---- 取消对手领袖技 ---- */
      case 'cancel_opponent_leader': {
        const os = this.side[this._other(sideName)];
        if (!os.leaderUsed) { os.leaderUsed = true; this._log(sideName, `领袖「${leader.name.zh}」封锁了对手的领袖技`); }
        else this._log('sys', '对手领袖技已使用，此技无效');
        break;
      }
      /* ---- 查看对手手牌 ---- */
      case 'see_opponent_hand': {
        const os = this.side[this._other(sideName)];
        const picks = os.hand.slice().sort(() => Math.random() - 0.5).slice(0, 3).map(c => c.name.zh);
        this.revealedOppHand = picks;
        this._log(sideName, `领袖「${leader.name.zh}」窥视对手手牌：${picks.join('、') || '（空）'}`);
        break;
      }
      /* ---- 弃 2 抽 1（真规则：弃哪两张、从牌组拿哪一张，都由玩家自己选；
       *     旧版全程随机/自动 = 玩家反馈 #4） ---- */
      case 'discard_2_draw_1': {
        const n = Math.min(2, s.hand.length);
        if (n === 0) { this._log(sideName, '手牌为空，领袖技无效'); break; }
        if (sideName === 'player') {
          s.leaderUsed = true;
          if (this.stats.player) this.stats.player.leaders++;
          this.pendingDiscard = { side: sideName, count: n };
          this._log('sys', `领袖「${leader.name.zh}」：请选择要弃掉的 ${n} 张手牌`);
          this._emit([{ type: 'leader', effect: e, side: sideName }]);
          this.refresh();
          return { ok: true, pendingDiscard: true };
        }
        // AI：弃最没用的 n 张，再从牌组挑最好的一张
        const sorted = s.hand.map((c, i) => ({ c, i })).sort((a, b) => this._mulliganValue(a.c) - this._mulliganValue(b.c));
        const drop = sorted.slice(0, n).map(x => x.c);
        for (const c of drop) {
          const i = s.hand.indexOf(c);
          if (i >= 0) { s.hand.splice(i, 1); c.inGrave = true; s.graveyard.push(c); }
        }
        const got = this._takeBestFromPile(sideName, 1);
        this._log(sideName, `领袖「${leader.name.zh}」弃掉 ${drop.map(c => c.name.zh).join('、')}，从牌组取出 ${got.map(c => c.name.zh).join('、') || '（牌组为空）'}`);
        break;
      }
      /* ---- 坟场取一张回手牌 ---- */
      case 'revive_to_hand': {
        const t = s.graveyard.filter(c => !c.tomb).sort((a, b) => (b.power || 0) - (a.power || 0))[0];
        if (t) {
          s.graveyard.splice(s.graveyard.indexOf(t), 1);
          t.owner = sideName; t.placedRow = null; t.tomb = false;
          s.hand.push(t);
          this._log(sideName, `领袖「${leader.name.zh}」从坟场取回「${t.name.zh}」`);
        } else this._log('sys', '坟场为空，领袖技无效');
        break;
      }
      /* ---- 第一局额外抽牌（被动，在 start() 处理） ---- */
      case 'draw_extra_first_round':
        this._log('sys', '该领袖效果在开局时已自动生效');
        break;
      case 'revive_own': {
        const t = s.graveyard.filter(c => !c.tomb && (c.type === 'unit' || c.type === 'hero')).sort((a,b)=>(b.power||0)-(a.power||0))[0];
        if (t) {
          s.graveyard.splice(s.graveyard.indexOf(t), 1);
          const row = this._pickRow(t, sideName, null);
          t.owner = sideName; t.placedRow = row; t._side = sideName;
          s.rows[row].push(t);
          this._applyEnterBuffs(t, sideName, row);
          this._log(sideName, `领袖「${leader.name.zh}」复活「${t.name.zh}」`);
        } else this._log('sys', '坟场无单位可复活，领袖技无效（本局不再可用）');
        break;
      }
      case 'steal_opp_discard': {
        const os = this.side[this._other(sideName)];
        const t = os.graveyard.filter(c => !c.tomb).sort((a,b)=>(b.power||0)-(a.power||0))[0];
        if (t) { os.graveyard.splice(os.graveyard.indexOf(t), 1); t.owner = sideName; s.hand.push(t); this._log(sideName, `领袖「${leader.name.zh}」窃取「${t.name.zh}」`); }
        break;
      }
      case 'spy_any': {
        const enemy = this._other(sideName);
        const row = this._pickRow({ row: 'agile' }, enemy, 'melee');
        const sp = makeCard({ defId: 'ldr_spy', name: { zh: '临时间谍', en: 'Spy' }, faction: 'neutral', type: 'unit', row: 'agile', power: 1, ability: 'spy', spyDraw: 1 });
        sp.owner = enemy; sp.placedRow = row; sp._side = enemy; sp.spied = true;
        this.side[enemy].rows[row].push(sp);
        this._drawCards(s, 1).forEach(c => s.hand.push(c));
        this._log(sideName, `领袖「${leader.name.zh}」放置间谍并抽 1`);
        break;
      }
      case 'buff_melee_1': {
        for (const c of s.rows['melee']) if (!c.tomb && c.type !== 'hero') c.buff = (c.buff || 0) + 1;
        this._log(sideName, `领袖「${leader.name.zh}」近战 +1 士气`);
        break;
      }
      case 'frost_again': case 'fog_again': case 'rain_again': {
        // 只开自己那一排的天气，不动其它排（旧版会把场上所有天气清掉）
        const wk = e.split('_')[0];
        const key = wk === 'frost' ? 'frost' : wk === 'fog' ? 'fog' : 'rain';
        this.weather[key] = true;
        this._log(sideName, `领袖「${leader.name.zh}」召唤${WEATHER[key].zh}`);
        break;
      }
      case 'take_enemy_hand': {
        const os = this.side[this._other(sideName)];
        if (os.hand.length) {
          const i = Math.floor(Math.random() * os.hand.length);
          const t = os.hand.splice(i, 1)[0];
          t.owner = sideName; s.hand.push(t);
          this._log(sideName, `领袖「${leader.name.zh}」取走对方一张「${t.name.zh}」`);
        }
        break;
      }
      default: return { ok: false, error: '未知领袖效果' };
    }
    s.leaderUsed = true;
    if (this.stats[sideName]) this.stats[sideName].leaders++;
    this._emit([{ type: 'leader', effect: e, side: sideName }].concat(evs));
    this._afterPlay(sideName, evs);
    this.refresh();
    this._logTurn();
    return { ok: true };
  }

  /** 领袖「整排翻倍」（真规则：与号角同效，不叠加 —— 见 _effectivePower） */
  _doubleRow(sideName, row) {
    this.doubled[sideName][row] = true;
    const n = this.side[sideName].rows[row].filter(c => !c.tomb && c.type !== 'hero').length;
    this._log(sideName, `  该排 ${n} 张非英雄单位战力翻倍${this.side[sideName].horn[row] ? '（该排已有号角，不叠加）' : ''}`);
  }

  /** 领袖焚风（scorch_enemy_max）：摧毁对方场上最强的非英雄单位（并列全灭） */
  _leaderScorchEnemy(sideName) {
    this.refresh();
    const enemy = this._other(sideName);
    let max = -1;
    const cands = [];
    for (const r of ROWS) for (const c of this.side[enemy].rows[r]) {
      if (c.tomb || c.type === 'hero') continue;
      const p = this._effectivePower(c, enemy, r, this._rowWeather(enemy, r));
      if (p > max) { max = p; cands.length = 0; }
      if (p === max) cands.push({ side: enemy, row: r, card: c });
    }
    if (cands.length) this._destroyUnits(cands, sideName);
    else this._log(sideName, '  对方场上没有非英雄单位，领袖技无效');
  }

  /* ---------- 诱饵/号角需要 UI 指定目标后调用 ---------- */
  /** UI: resolve horn target row after pendingHorn set */
  applyPendingHorn(targetRow) {
    if (!this.pendingHorn) return { ok: false };
    const { side, card } = this.pendingHorn;
    this.pendingHorn = null;
    return this._playSpecial(side, card, targetRow).ok ? (this._afterPlay(side, [{ type: 'horn', row: targetRow }]), this.refresh(), { ok: true })
      : { ok: false };
  }

  /** UI: decoy → 选自己某单位收回 */
  applyDecoy(sideName, targetUid) {
    if (!this.pendingDecoy) return { ok: false };
    const { side, card } = this.pendingDecoy;
    this.pendingDecoy = null;
    const s = this.side[side];
    // 找到目标
    for (const r of ROWS) {
      const i = s.rows[r].findIndex(c => c.uid === targetUid && !c.tomb && c.type !== 'hero' && !c.spied);
      if (i >= 0) {
        const t = s.rows[r][i];
        s.rows[r].splice(i, 1);
        this._removeBuffsOf(t, side, r);
        t.placedRow = null; t.owner = side;
        s.hand.push(t);
        s.hand.splice(s.hand.indexOf(card), 1);
        s.graveyard.push(card); card.used = true;
        this._log(side, `使用诱饵收回「${t.name.zh}」回手牌`);
        this._emit([{ type: 'decoy', card: t, side }]);
        this._afterPlay(side, [{ type: 'decoy', card: t }]);
        this.refresh();
        return { ok: true };
      }
    }
    return { ok: false, error: '没有可收回的单位' };
  }

  /** 从牌堆里取 n 张「最有价值」的牌进手牌（AI 用；玩家路径走 applyDeckPick） */
  _takeBestFromPile(sideName, n) {
    const s = this.side[sideName];
    const out = [];
    for (let k = 0; k < n; k++) {
      if (!s.pile.length) break;
      let bestI = 0, bestV = -Infinity;
      s.pile.forEach((c, i) => { const v = this._mulliganValue(c); if (v > bestV) { bestV = v; bestI = i; } });
      const c = s.pile.splice(bestI, 1)[0];
      c.owner = sideName; s.hand.push(c);
      out.push(c);
    }
    return out;
  }

  /** UI：领袖「世界毁灭者」第一步 —— 玩家选好要弃掉的 n 张手牌（uids） */
  applyDiscard(sideName, uids) {
    if (!this.pendingDiscard || this.pendingDiscard.side !== sideName) return { ok: false, error: '当前没有待完成的弃牌选择' };
    const need = this.pendingDiscard.count;
    const s = this.side[sideName];
    const picks = [];
    for (const uid of (uids || [])) {
      const c = s.hand.find(x => x.uid === uid);
      if (!c) return { ok: false, error: '手牌里没有这张牌' };
      if (picks.includes(c)) return { ok: false, error: '同一张牌不能选两次' };
      picks.push(c);
    }
    if (picks.length !== need) return { ok: false, error: `需要选择 ${need} 张（已选 ${picks.length} 张）` };
    for (const c of picks) {
      s.hand.splice(s.hand.indexOf(c), 1);
      c.inGrave = true; c.placedRow = null; c._effective = null;
      s.graveyard.push(c);
    }
    this._log(sideName, `领袖弃牌：${picks.map(c => c.name.zh).join('、')}`);
    this.pendingDiscard = null;
    if (s.pile.length) {
      this.pendingDeckPick = { side: sideName, count: 1 };
      this._log('sys', '请从牌组选择 1 张加入手牌');
      this.refresh();
      return { ok: true, pendingDeckPick: true };
    }
    this._log('sys', '牌组已空，没有牌可取');
    this._afterPlay(sideName, []);
    this.refresh();
    return { ok: true };
  }

  /** UI：领袖「世界毁灭者」第二步 —— 玩家从牌组挑走一张 */
  applyDeckPick(sideName, uid) {
    if (!this.pendingDeckPick || this.pendingDeckPick.side !== sideName) return { ok: false, error: '当前没有待完成的取牌选择' };
    const s = this.side[sideName];
    const i = s.pile.findIndex(c => c.uid === uid);
    if (i < 0) return { ok: false, error: '牌组里没有这张牌' };
    const c = s.pile.splice(i, 1)[0];
    c.owner = sideName;
    s.hand.push(c);
    this.pendingDeckPick = null;
    this._log(sideName, `领袖从牌组取出「${c.name.zh}」加入手牌`);
    this._emit([{ type: 'draw', card: c, side: sideName }]);
    this._afterPlay(sideName, []);
    this.refresh();
    return { ok: true };
  }

  /** 记录出牌统计（结算界面用） */
  _recordPlay(sideName, card) {
    const st = this.stats[sideName];
    if (!st || !card) return;
    if (card.type === 'special') {
      st.specials++;
      if (card.kind === 'weather') st.weather++;
      else if (card.kind === 'horn') st.horn++;
      else if (card.kind === 'scorch') st.scorches++;
    } else {
      st.units++;
      st.power += card.power || 0;
      if (card.ability === 'spy') st.spies++;
      else if (card.ability === 'medic') st.medics++;
      else if (card.ability === 'muster') st.musters++;
    }
  }

  /* ---------- 事件队列 ---------- */
  _emit(evs) { if (evs && evs.length) this.events.push(...evs); }
  /** UI 取走并清空事件（音效/动画用） */
  drainEvents() { const e = this.events; this.events = []; return e; }

  /* ---------- 日志 ---------- */
  _log(who, msg) {
    this.log.push({ who, msg });
  }

  /* ---------- 序列化（调试） ---------- */
  dump() {
    return JSON.stringify({
      round: this.round, scores: this.scores, weather: this.weather,
      passed: this.passed, current: this.current,
      player: {
        roundsWon: this.side.player.roundsWon,
        hand: this.side.player.hand.map(c => c.name.zh),
        rows: ROWS.map(r => ({ r, cards: this.side.player.rows[r].map(c => c.name.zh) })),
        pile: this.side.player.pile.length,
      },
      ai: {
        roundsWon: this.side.ai.roundsWon,
        handCount: this.side.ai.hand.length,
        rows: ROWS.map(r => ({ r, cards: this.side.ai.rows[r].map(c => c.name.zh) })),
        pile: this.side.ai.pile.length,
      },
    }, null, 2);
  }
}
