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
  scorch_enemy_max:  '焚风：消灭对方场上战力最高的一张非英雄单位',
  draw_one:          '谋略：抽 1 张牌',
  draw_two:          '谋略：抽 2 张牌',
  revive_own:        '亡灵：从己方坟场复活一张单位上场',
  steal_opp_discard: '窃取：从对方坟场取一张牌加入自己手牌',
  spy_any:           '卧底：任意排放置一张 1 战力间谍到自己场上（你抽 1）',
  buff_melee_1:      '士气：己方近战排非英雄单位各 +1',
  fog_again:         '浓雾再临：天气变为浓雾（清除其它天气）',
  frost_again:       '寒潮：天气变为刺骨冰霜（清除其它天气）',
  rain_again:        '暴雨倾盆：天气变为倾盆大雨（清除其它天气）',
  take_enemy_hand:   '王权：随机取对方手牌 1 张加入己方手牌',
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
    this.needLeaderTarget = null; // 需要点选目标的领袖效果类型
    this.log = [];
    this.events = [];            // 供 UI 消费的事件队列（音效/动画）
    this.pendingScorch = null;   // 焚风连锁待结算
    this.roundHistory = [];      // 每局比分记录（结算界面用）
    this.stats = { player: this._blankStats(), ai: this._blankStats() };
    this.aiSkill = cfg.aiSkill == null ? 0.6 : cfg.aiSkill;
    this.difficulty = cfg.difficulty || 'normal';
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
    this._log('sys', '游戏开始！双方各抽 10 张牌，可各换 2 张。');
    this._log('sys', `${this.side.player.deck.faction}  VS  ${this.side.ai.deck.faction}`);
  }

  getSides() { return this.side; }

  /** 换牌：把手中某张放回牌堆并重抽；hands: [{side,index}] */
  doMulligan(replacements) {
    if (!this.needMulligan) return;
    for (const r of replacements) {
      const s = this.side[r.side];
      const c = s.hand.splice(r.index, 1)[0];
      if (!c) continue;
      s.pile.push(c);            // 换回的牌放到牌堆底部，避免立刻抽回
      // 重抽一张
      const nc = this._drawCards(s, 1);
      // 把 nc 插回原位附近以便玩家感知
      s.hand.splice(Math.min(r.index, s.hand.length), 0, nc[0]);
    }
    this.needMulligan = false;
    this._log('sys', `换牌完成：共替换 ${replacements.length} 张。`);
  }

  finishMulligan() {
    this.needMulligan = false;
    this.beginRound();
  }

  beginRound() {
    this.passed = { player: false, ai: false };
    this.weather = { frost: false, fog: false, rain: false };
    for (const s of ['player', 'ai']) {
      // 重新铺排：上一局已出场牌留在场上？不 —— 经典昆特：每局重新开始，场上清空、坟场累计
      const side = this.side[s];
      for (const r of ROWS) {
        while (side.rows[r].length) {
          const c = side.rows[r].shift();
          side.graveyard.push(c);   // 已出过场 → 进坟场（英雄同理，经典规则英雄死后也入坟但不可复活）
          c.placedRow = null;
        }
        side.horn[r] = false;
      }
    }
    if (this.round > 1) this._drawTo('player', 10), this._drawTo('ai', 10);
    // 谁先手：第一局由构造指定；之后上局胜者先手
    if (this.round === 1) this.current = this.first;
    else {
      // 若上局平局，沿用「上上局先手方换边」简化：改为本局由未先手方先手
      this.current = this._prevFirst === 'player' ? 'ai' : 'player';
    }
    this._prevFirst = this.current;
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

  /** 计算某个卡在某排的原始战力（不含天气/号角），同袍在此结算 */
  rawPower(card, sideName, row) {
    let p = card.power || 0;
    if (card.ability === 'tight_bond' && card.type === 'unit') {
      const rowCards = this.side[sideName].rows[row];
      const n = rowCards.filter(c => c.defId === card.defId && !c.tomb).length;
      // 至少自身 1 张
      if (this.tightMode === 'double') {
        if (n >= 2) p = p * 2;
      } else { // n² 模式：n 张 → 每张贡献 = base×n
        p = p * n;
      }
    }
    return p;
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

  /** 单卡最终战力 */
  _effectivePower(card, sideName, row, weatherOnRow) {
    let p = card.power || 0;
    const isHero = card.type === 'hero';
    if (!isHero) {
      // 鼓舞/士气 buff 已经在出牌时写入 card.buff
      if (card.buff) p += card.buff;
      // 同袍
      if (card.ability === 'tight_bond' && card.type === 'unit') {
        const n = this.side[sideName].rows[row].filter(c => c.defId === card.defId && !c.tomb).length;
        p = this.tightMode === 'double' ? (n >= 2 ? p * 2 : p) : p * n;
      }
      // 天气
      if (weatherOnRow) p = 1;
      // 号角（特殊牌号角 或 场上「指挥官号角」单位）
      if (this.side[sideName].horn[row] || this._rowHasHornUnit(sideName, row)) p *= 2;
      // 天晴抵消不掉已 buff
    }
    return p;
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
  /**
   * @returns {{ok:boolean, error?:string, events?:array}}
   */
  playCard(sideName, handIndex, targetRow) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    if (this.current !== sideName) return { ok: false, error: '还没轮到你' };
    if (this.passed[sideName]) return { ok: false, error: '本局你已过牌' };
    const side = this.side[sideName];
    const card = side.hand[handIndex];
    if (!card) return { ok: false, error: '手牌索引无效' };
    const events = [];
    let deferTurn = false;

    // ---------- 特殊牌 ----------
    if (card.type === 'special') {
      const res = this._playSpecial(sideName, card, targetRow);
      if (!res.ok) return res;
      events.push(...res.events);
    } else {
      // ---------- 单位 / 英雄 ----------
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

        // 召唤(muster)：牌组中同组卡牌全部自动打出（各归其排）
        if (card.ability === 'muster') {
          events.push(...this._doMuster(sideName, card, row));
        }
        // 医生(medic)：从坟场复活一张己方单位（玩家可选，AI 自动）
        if (card.ability === 'medic' && card.medicReady !== false) {
          const mres = this._startMedic(sideName, card);
          if (mres.pending) deferTurn = true;
          else events.push(...(mres.events || []));
        }
        // 焚风(scorch)：金龙进场时触发
        if (card.ability === 'scorch') {
          events.push(...this._triggerScorch(sideName, card));
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

  /** 焚风效果（特殊牌与金龙共用） */
  _triggerScorch(sideName, source) {
    const total = this.scores.player + this.scores.ai;
    if (total <= 10) {
      this._log('sys', `焚风（${source.name.zh}）：全场总战力未超过 10，无效`);
      return [];
    }
    const victims = this._scorchTargets();
    for (const v of victims) {
      const os = this.side[v.side];
      const ri = os.rows[v.row].indexOf(v.card);
      if (ri >= 0) { os.rows[v.row].splice(ri, 1); v.card.tomb = true; v.card.placedRow = null; os.graveyard.push(v.card); }
      this._removeBuffsOf(v.card, v.side, v.row);
      this._log('sys', `焚风摧毁了「${v.card.name.zh}」`);
    }
    return [{ type: 'scorch', victims: victims.map(v => v.card) }];
  }

  /** 医生：开牌（玩家弹窗选择 / AI 自动选最强） */
  _startMedic(sideName, medicCard) {
    const side = this.side[sideName];
    const targets = side.graveyard.filter(c =>
      !c.tomb && c.type === 'unit' && c.owner === sideName && c.defId !== medicCard.defId
    );
    if (!targets.length) return { events: [] };
    if (sideName === 'player') {
      this.pendingMedic = { side: sideName, options: targets.map(t => t.uid) };
      return { pending: true, events: [] };
    }
    targets.sort((a, b) => (b.power || 0) - (a.power || 0));
    return { events: this._reviveToBoard(sideName, targets[0]) };
  }

  /** 把坟场中的单位复活到场上 */
  _reviveToBoard(sideName, t) {
    const side = this.side[sideName];
    const idx = side.graveyard.indexOf(t);
    if (idx < 0) return [];
    const row = this._pickRow(t, sideName, null);
    if (!row) return [];
    side.graveyard.splice(idx, 1);
    t.owner = sideName; t.placedRow = row; t._side = sideName; t.tomb = false;
    t.medicReady = false;              // 被复活的医生不再连锁，避免无限循环
    side.rows[row].push(t);
    this._applyEnterBuffs(t, sideName, row);
    this._log(sideName, `  医生复活了「${t.name.zh}」到${ROW_CN[row]}排`);
    return [{ type: 'medic', card: t }];
  }

  /** UI：医生选择目标后调用 */
  applyMedic(sideName, uid) {
    if (!this.pendingMedic || this.pendingMedic.side !== sideName) return { ok: false };
    this.pendingMedic = null;
    const side = this.side[sideName];
    const t = side.graveyard.find(c => c.uid === uid && !c.tomb && c.type === 'unit');
    if (t) this._emit(this._reviveToBoard(sideName, t));
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

  /** 单位进场结算：鼓舞 buff 即时写入其它单位 */
  _applyEnterBuffs(newCard, sideName, row) {
    const side = this.side[sideName];
    if (newCard.ability === 'morale_boost' && newCard.type === 'unit') {
      for (const c of side.rows[row]) {
        if (c === newCard || c.tomb || c.type === 'hero') continue;
        c.buff = (c.buff || 0) + 1;
      }
    } else {
      // 若是普通单位进场，检查同行是否有鼓舞单位给它 buff
      for (const c of side.rows[row]) {
        if (c === newCard || c.tomb) continue;
        if (c.ability === 'morale_boost') {
          if (newCard.type !== 'hero') newCard.buff = (newCard.buff || 0) + 1;
          break;
        }
      }
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

  /** 召唤：牌堆内同组（mg，缺省同名）单位全部拉出，各归其合法排 */
  _doMuster(sideName, origin, row) {
    const side = this.side[sideName];
    const group = origin.mg || origin.defId;
    const evs = [];
    for (let i = side.pile.length - 1; i >= 0; i--) {
      const c = side.pile[i];
      if ((c.mg || c.defId) !== group || c.type !== 'unit') continue;
      side.pile.splice(i, 1);
      c.owner = sideName; c._side = sideName;
      const r = this._pickRow(c, sideName, null) || row;
      c.placedRow = r;
      side.rows[r].push(c);
      this._applyEnterBuffs(c, sideName, r);
      evs.push({ type: 'muster', card: c });
      this._log(sideName, `  召唤：「${c.name.zh}」自动上场`);
    }
    return evs;
  }

  /* ---------- 特殊牌 ---------- */
  _playSpecial(sideName, card, targetRow) {
    const side = this.side[sideName];
    const evs = [];
    switch (card.kind) {
      case 'weather':
        for (const k of Object.keys(this.weather)) this.weather[k] = false;
        this.weather[card.weatherKey] = true;
        side.hand.splice(side.hand.indexOf(card), 1);
        side.graveyard.push(card); card.placedRow = null; card.used = true;
        this._log(sideName, `使用天气牌「${card.name.zh}」${WEATHER[card.weatherKey].desc}`);
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
        side.hand.splice(side.hand.indexOf(card), 1);
        side.horn[targetRow] = true;
        side.graveyard.push(card); card.used = true;
        this._log(sideName, `在己方${ROW_CN[targetRow]}排放置号角，该排非英雄单位 ×2`);
        evs.push({ type: 'horn', row: targetRow });
        return { ok: true, events: evs };
      }
      case 'decoy': {
        // 需要选择自己场上非英雄单位
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

  _scorchTargets() {
    // 找全场最高非英雄单位战力（取 _effective）
    let max = -1;
    const cands = [];
    for (const s of ['player', 'ai']) {
      for (const r of ROWS) {
        for (const c of this.side[s].rows[r]) {
          if (c.tomb || c.type === 'hero') continue;
          const p = c._effective || this._effectivePower(c, s, r, false);
          if (p > max) { max = p; cands.length = 0; }
          if (p === max) cands.push({ side: s, row: r, card: c });
        }
      }
    }
    return cands;
  }

  /* ---------- 回合推进 / 过 ---------- */
  pass(sideName) {
    if (this.over || this.current !== sideName) return { ok: false };
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
      this.roundWinner = null;
      this._log('sys', '本局平局，无人得分。');
    } else {
      this.roundWinner = ps > as ? 'player' : 'ai';
      this.side[this.roundWinner].roundsWon++;
      this._log('sys', `${this.roundWinner === 'player' ? '你' : '对手'}赢得第 ${this.round} 局！`);
    }
    // 检查整局胜负
    this.roundHistory.push({ round: this.round, player: ps, ai: as, winner: this.roundWinner });
    this._emit([{ type: 'roundEnd', winner: this.roundWinner, scores: { player: ps, ai: as }, round: this.round }]);
    if (this.side.player.roundsWon >= 2 || this.side.ai.roundsWon >= 2) {
      this.over = true;
      this.winner = this.side.player.roundsWon >= 2 ? 'player' : 'ai';
      this._log('sys', `======== 整局结束：${this.winner === 'player' ? '你赢了！' : '对手获胜'} ========`);
      this._emit([{ type: 'matchEnd', winner: this.winner }]);
      return;
    }
    this.round++;
    // 若双方牌堆与手牌已尽且不能再战，按轮次分判负
    const exhausted = (s) =>
      this.side[s].pile.length === 0 && this.side[s].hand.length === 0 &&
      !(this.side[s].rows['melee'].length || this.side[s].rows['ranged'].length || this.side[s].rows['siege'].length);
    if (exhausted('player') && exhausted('ai') && this.round > 1) {
      // 极少出现；此时比 roundWon
      if (this.side.player.roundsWon !== this.side.ai.roundsWon) {
        this.over = true;
        this.winner = this.side.player.roundsWon > this.side.ai.roundsWon ? 'player' : 'ai';
        this._log('sys', `======== 牌已耗尽：${this.winner === 'player' ? '你赢了' : '对手获胜'} ========`);
      } else {
        this.over = true; this.winner = null;
        this._log('sys', '双方牌库耗尽且得分相同 —— 平局。');
      }
      return;
    }
    this.beginRound();
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
    if (e === 'horn_melee' || e === 'horn_ranged' || e === 'horn_siege' ||
        e === 'double_siege' || e === 'double_ranged' || e === 'double_melee' ||
        e === 'frost_again' || e === 'fog_again' || e === 'rain_again')
      return 'row';      // 无需真实选择，指向己方对应排（UI 也无需弹窗，可自动）
    return null;
  }

  canUseLeader(sideName) {
    const s = this.side[sideName];
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
      case 'double_siege': this._doubleRow(sideName, 'siege', 2); this._log(sideName, `领袖「${leader.name.zh}」攻城翻倍`); break;
      case 'double_ranged': this._doubleRow(sideName, 'ranged', 2); this._log(sideName, `领袖「${leader.name.zh}」远程翻倍`); break;
      case 'double_melee': this._doubleRow(sideName, 'melee', 2); this._log(sideName, `领袖「${leader.name.zh}」近战翻倍`); break;
      case 'scorch_enemy_max': this._leaderScorchEnemy(sideName); break;
      case 'draw_one': this._drawCards(s, 1).forEach(c => s.hand.push(c)); this._log(sideName, `领袖「${leader.name.zh}」抽 1 张`); break;
      case 'draw_two': this._drawCards(s, 2).forEach(c => s.hand.push(c)); this._log(sideName, `领袖「${leader.name.zh}」抽 2 张`); break;
      /* ---- 从牌组取天气牌并使用 ---- */
      case 'deck_weather_frost': case 'deck_weather_fog': case 'deck_weather_rain': case 'deck_weather_any': {
        const want = e === 'deck_weather_any' ? null : e.split('_')[2];
        const idx = s.pile.findIndex(c => c.type === 'special' && c.kind === 'weather' && (!want || c.weatherKey === want));
        if (idx >= 0) {
          const wc = s.pile.splice(idx, 1)[0];
          for (const k in this.weather) this.weather[k] = false;
          this.weather[wc.weatherKey] = true;
          s.graveyard.push(wc);
          this._log(sideName, `领袖「${leader.name.zh}」从牌组取出「${wc.name.zh}」`);
          evs.push({ type: 'weather', key: wc.weatherKey });
        } else this._log('sys', '牌组中没有对应天气牌，领袖技无效');
        break;
      }
      /* ---- 摧毁敌方整排（条件 >10） ---- */
      case 'destroy_enemy_melee': case 'destroy_enemy_siege': {
        const row = e === 'destroy_enemy_melee' ? 'melee' : 'siege';
        const enemy = this._other(sideName);
        const total = this.rowTotal(enemy, row);
        if (total > 10) {
          const os = this.side[enemy];
          const victims = os.rows[row].slice();
          for (const c of victims) {
            os.rows[row].splice(os.rows[row].indexOf(c), 1);
            c.tomb = true; c.placedRow = null; os.graveyard.push(c);
            this._removeBuffsOf(c, enemy, row);
            this._log('sys', `领袖技摧毁了对方「${c.name.zh}」`);
          }
          evs.push({ type: 'scorch', victims });
        } else this._log('sys', `对方${ROW_CN[row]}总战力未超过 10，领袖技无效`);
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
      /* ---- 弃 2 抽 1 ---- */
      case 'discard_2_draw_1': {
        const sorted = s.hand.map((c, i) => ({ c, i })).sort((a, b) => (a.c.power || 0) - (b.c.power || 0));
        const drop = sorted.slice(0, Math.min(2, s.hand.length)).map(x => x.c);
        for (const c of drop) {
          const i = s.hand.indexOf(c);
          if (i >= 0) { s.hand.splice(i, 1); s.graveyard.push(c); }
        }
        const got = this._drawCards(s, 1);
        got.forEach(c => s.hand.push(c));
        this._log(sideName, `领袖「${leader.name.zh}」弃掉 ${drop.map(c => c.name.zh).join('、')}，抽到 ${got.map(c => c.name.zh).join('、') || '无'}`);
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
        for (const k in this.weather) this.weather[k] = false;
        const wk = e.split('_')[0];
        this.weather[wk === 'frost' ? 'frost' : wk === 'fog' ? 'fog' : 'rain'] = true;
        this._log(sideName, `领袖「${leader.name.zh}」召唤${WEATHER[wk === 'frost' ? 'frost' : wk === 'fog' ? 'fog' : 'rain'].zh}`);
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

  _doubleRow(sideName, row, mult) {
    const s = this.side[sideName];
    for (const c of s.rows[row]) {
      if (!c.tomb && c.type !== 'hero') c._dbl = (c._dbl || 1) * mult;
    }
  }

  _leaderScorchEnemy(sideName) {
    const enemy = this._other(sideName);
    let max = -1, victim = null;
    for (const r of ROWS) for (const c of this.side[enemy].rows[r]) {
      if (c.tomb || c.type === 'hero') continue;
      const p = c._effective || c.power;
      if (p > max) { max = p; victim = { side: enemy, row: r, card: c }; }
    }
    if (victim) {
      const os = this.side[enemy];
      os.rows[victim.row].splice(os.rows[victim.row].indexOf(victim.card), 1);
      victim.card.tomb = true; victim.card.placedRow = null; os.graveyard.push(victim.card);
      this._removeBuffsOf(victim.card, enemy, victim.row);
      this._log('sys', `领袖技焚风摧毁对方「${victim.card.name.zh}」`);
    }
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
