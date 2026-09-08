/* ============================================================
 * 昆特牌 AI —— 难度分级启发式
 *   skill 0.0–1.0（简单 0.15 / 普通 0.5 / 困难 0.8 / 大师 1.0）
 * 影响：候选牌选择精度、过牌时机、间谍/领袖技时机、换牌质量、失误率
 * ============================================================ */
'use strict';

class GwentAI {
  constructor(game, skill) {
    this.g = game;
    this.skill = skill == null ? 0.5 : Math.max(0, Math.min(1, skill));
    this.mistakeRate = (1 - this.skill) * 0.8;   // 大师 0%，简单约 47%
  }

  /* ---------------- 主决策 ---------------- */
  async act() {
    const g = this.g;
    if (g.over || g.current !== 'ai') return null;

    if (g.needMulligan && g.current === 'ai') { this._doMulligan(); return 'ai-mulligan'; }

    // 1) 领袖技时机
    if (this._shouldUseLeader()) return this._useLeader();

    // 2) 过牌判断
    if (this._shouldPass()) { g.pass('ai'); return 'ai-pass'; }

    // 3) 选牌
    const pick = this._choosePlay();
    if (!pick) {
      if (!g.passed.ai) { g.pass('ai'); return 'ai-pass-empty'; }
      return null;
    }
    const played = this._execute(pick);
    if (played === null) {
      if (!g.passed.ai) { g.pass('ai'); return 'ai-pass-stuck'; }
      return null;
    }
    return played;
  }

  /* ---------------- 局势评估 ---------------- */
  _state() {
    const g = this.g;
    const me = g.side.ai, opp = g.side.player;
    const boardCount = (s) => ROWS.reduce((a, r) => a + g.side[s].rows[r].filter(c => !c.tomb).length, 0);
    return {
      myScore: g.scores.ai,
      oppScore: g.scores.player,
      myHand: me.hand.length,
      oppHand: opp.hand.length,
      myBoard: boardCount('ai'),
      oppBoard: boardCount('player'),
      oppPassed: g.passed.player,
      iPassed: g.passed.ai,
      round: g.round,
      myRounds: me.roundsWon,
      oppRounds: opp.roundsWon,
      diff: g.scores.ai - g.scores.player,
    };
  }

  /** 对手剩余潜在战力估算（牌数 × 平均战力，困难以上更精确） */
  _opponentPotential() {
    const g = this.g;
    const st = this._state();
    if (st.oppHand === 0) return 0;
    // 手牌平均战力：按已见牌估算（大师会用场上均值，弱 AI 用固定 8）
    if (this.skill < 0.5) return st.oppHand * 8;
    let sum = 0, n = 0;
    for (const r of ROWS) for (const c of g.side.player.rows[r]) { if (!c.tomb) { sum += (c.power || 0); n++; } }
    const avg = n ? Math.max(5, sum / n) : 7;
    return st.oppHand * avg * (st.oppHand >= 4 ? 0.85 : 1);
  }

  /** 是否该用领袖技 */
  _shouldUseLeader() {
    const g = this.g;
    if (!g.canUseLeader('ai')) return false;
    const st = this._state();
    const leader = g.side.ai.deck.leader;

    // 弱 AI 很少想起来用
    if (Math.random() > this.skill * 0.9 + 0.05) return false;

    switch (leader.effect) {
      case 'double_siege': case 'double_ranged': case 'double_melee': {
        const row = leader.effect.split('_')[1];
        const total = g.rowTotal('ai', row);
        return total >= (this.skill >= 0.8 ? 10 : 14);
      }
      case 'horn_melee': case 'horn_ranged': case 'horn_siege': {
        const row = leader.effect.split('_')[1];
        return g.rowTotal('ai', row) >= (this.skill >= 0.8 ? 8 : 12);
      }
      case 'clear_weather': {
        const anyW = Object.values(g.weather).some(Boolean);
        if (!anyW) return false;
        const hurtMe = ROWS.reduce((a, r) => a + (this._rowWeatherHit(r) ? g.rowTotal('ai', r) : 0), 0);
        const hurtOpp = ROWS.reduce((a, r) => a + (this._rowWeatherHit(r) ? g.rowTotal('player', r) : 0), 0);
        return hurtMe > hurtOpp || (st.diff < 0 && hurtMe > 0);
      }
      case 'destroy_enemy_melee': case 'destroy_enemy_siege': {
        const row = leader.effect === 'destroy_enemy_melee' ? 'melee' : 'siege';
        return g.rowTotal('player', row) > (this.skill >= 0.8 ? 10 : 16);
      }
      case 'cancel_opponent_leader':
        // 对手领袖技有威胁时才值得花一回合封锁
        return !g.side.player.leaderUsed && st.oppHand >= 5 && st.round === 1;
      case 'discard_2_draw_1': {
        const junk = g.side.ai.hand.filter(c => this._mulliganValue(c) < 5).length;
        return junk >= 2 && st.diff < 5;
      }
      case 'revive_to_hand': {
        const best = g.side.ai.graveyard.filter(c => !c.tomb).reduce((m, c) => Math.max(m, c.power || 0), 0);
        return best >= 6;
      }
      case 'steal_opp_discard': {
        const best = g.side.player.graveyard.filter(c => !c.tomb).reduce((m, c) => Math.max(m, c.power || 0), 0);
        return best >= 6;
      }
      case 'see_opponent_hand':
        return false;    // 纯情报、白费一个回合 → 高难度也不打
      case 'deck_weather_frost': case 'deck_weather_fog': case 'deck_weather_rain': case 'deck_weather_any':
        return this.skill >= 0.5 && st.oppBoard >= 3;
      default:
        return false;
    }
  }

  _useLeader() {
    const g = this.g;
    const res = g.useLeader('ai');
    return res.ok ? 'ai-leader' : null;
  }

  /** 是否过牌 */
  _shouldPass() {
    const g = this.g;
    const st = this._state();
    if (st.iPassed) return false;

    const oppPot = this._opponentPotential();
    const hasPlayable = this._hasPlayable();

    // 对方已过：只有「对方即使把剩下的牌全打出来也追不上」时才过
    if (st.oppPassed) {
      if (!hasPlayable) return true;
      const buffer = this.skill >= 0.8 ? 0 : (this.skill >= 0.5 ? 2 : 5);   // 弱 AI 更保守/更容易乱过
      if (st.diff > oppPot + buffer) return true;
      // 高手还会判断：对方手牌已空 → 立即过
      if (this.skill >= 0.8 && st.oppHand === 0) return true;
      return false;
    }

    // 手牌耗尽且无领袖可用
    if (st.myHand === 0 && !g.canUseLeader('ai')) return true;

    if (this.skill >= 0.8) {
      // 本局已稳赢（对方追不上）且自己手牌快空 → 过，保住牌
      if (st.diff > oppPot && st.myHand <= 1) return true;
      // 本局必输且输得起（已赢下 1 局）→ 放弃本局，保留手牌打决胜局
      if (st.diff < -12 && st.oppHand >= st.myHand && st.round < 3 && st.myRounds > st.oppRounds) return true;
      return false;
    }
    if (this.skill >= 0.5) {
      // 中档：对方没牌且自己领先较多才过
      if (st.oppHand === 0 && st.diff > 6) return true;
      return false;
    }
    // 弱 AI：偶尔无理由过牌（会因此丢分）
    if (st.diff > 0 && Math.random() < 0.18) return true;
    return false;
  }

  _hasPlayable() {
    const g = this.g;
    const side = g.side.ai;
    for (let i = 0; i < side.hand.length; i++) {
      const c = side.hand[i];
      if (c.type === 'special') {
        if (c.kind === 'decoy') {
          const has = ROWS.some(r => side.rows[r].some(x => !x.tomb && x.type !== 'hero' && !x.spied));
          if (has) return true;
        } else return true;
      } else return true;
    }
    return false;
  }

  /* ---------------- 换牌 ---------------- */
  _doMulligan() {
    const g = this.g;
    const side = g.side.ai;
    const swaps = [];
    if (this.skill >= 0.4) {
      // 换掉最没用的：战力低且无关键技能，且该牌在牌堆里还有同伴（保留同袍/召唤组）
      const scored = side.hand.map((c, i) => ({ c, i, v: this._mulliganValue(c) }));
      scored.sort((a, b) => a.v - b.v);
      const n = Math.min(DECK_RULES.mulligan, this.skill >= 0.8 ? 2 : 1);
      for (const s of scored.slice(0, n)) {
        if (s.v < 5) swaps.push(s.i);
      }
      swaps.sort((a, b) => b - a);
    }
    g.doMulligan(swaps.map(i => ({ side: 'ai', index: i })));
    g.finishMulligan();
  }

  _mulliganValue(c) {
    if (c.ability === 'spy') return 100;
    if (c.ability === 'medic') return 80;
    if (c.ability === 'commanders_horn') return 60;
    if (c.ability === 'muster') return 55;
    if (c.type === 'hero') return 90;
    if (c.type === 'special') {
      if (c.kind === 'horn') return 45;
      if (c.kind === 'scorch') return 40;
      if (c.kind === 'clear') return 30;
      if (c.kind === 'weather') return 25;
      return 20;
    }
    let v = c.power || 0;
    if (c.ability === 'tight_bond') v += 2;
    if (c.ability === 'morale_boost') v += 3;
    return v;
  }

  /* ---------------- 选牌 ---------------- */
  _choosePlay() {
    const g = this.g;
    const side = g.side.ai;
    const cands = [];
    for (let i = 0; i < side.hand.length; i++) {
      const s = this._scoreCard(side.hand[i], i);
      if (s) cands.push(Object.assign({ handIndex: i, card: side.hand[i] }, s));
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.value - a.value);

    // 失误率：不选最优，从前几名随机挑 / 甚至乱选
    if (Math.random() < this.mistakeRate) {
      if (Math.random() < 0.35) return cands[Math.floor(Math.random() * cands.length)];
      return cands[Math.min(cands.length - 1, 1 + Math.floor(Math.random() * 2))];
    }
    return cands[0];
  }

  /** 单卡价值（返回 {value, type, row, targetUid?} 或 null） */
  _scoreCard(card, handIndex) {
    const g = this.g;
    const side = g.side.ai;
    const st = this._state();

    /* ---- 特殊牌 ---- */
    if (card.type === 'special') {
      if (card.kind === 'weather') {
        const row = WEATHER[card.weatherKey].row;
        if (g.weather[card.weatherKey]) return null;
        const gain = g.rowTotal('player', row) - g.rowTotal('ai', row);
        if (gain <= 0) return null;
        return { row, value: 25 + gain * 1.5, type: 'weather' };
      }
      if (card.kind === 'clear') {
        if (!Object.values(g.weather).some(Boolean)) return null;
        const hit = (s) => ROWS.reduce((a, r) => a + (this._rowWeatherHit(r) ? g.rowTotal(s, r) : 0), 0);
        const gain = hit('ai') - hit('player');
        if (gain <= 0 && this.skill >= 0.5) return null;
        return { row: null, value: 30 + gain, type: 'clear' };
      }
      if (card.kind === 'horn') {
        let bestRow = null, bestVal = 0;
        for (const r of ROWS) {
          if (side.horn[r]) continue;
          const total = side.rows[r].filter(c => !c.tomb && c.type !== 'hero')
            .reduce((a, c) => a + (c._effective || c.power || 0), 0);
          if (total > bestVal) { bestVal = total; bestRow = r; }
        }
        if (!bestRow || bestVal < (this.skill >= 0.8 ? 6 : 10)) return null;
        return { row: bestRow, value: 20 + bestVal, type: 'horn' };
      }
      if (card.kind === 'decoy') {
        // 收回被天气压制的强力单位，或重复利用间谍/医生
        const wKey = Object.keys(WEATHER).find(k => g.weather[k]);
        if (wKey) {
          const wr = WEATHER[wKey].row;
          const cand = side.rows[wr].filter(c => !c.tomb && c.type !== 'hero' && !c.spied && (c.power || 0) >= 4)
            .sort((a, b) => (b.power || 0) - (a.power || 0))[0];
          if (cand) return { row: wr, value: 12 + (cand.power || 0), type: 'decoy', targetUid: cand.uid };
        }
        const medicOnBoard = ROWS.flatMap(r => side.rows[r]).find(c => !c.tomb && c.ability === 'medic' && c.medicReady !== false);
        if (medicOnBoard && this.skill >= 0.8) return { row: null, value: 40, type: 'decoy', targetUid: medicOnBoard.uid };
        return null;
      }
      if (card.kind === 'scorch') {
        const total = g.scores.player + g.scores.ai;
        if (total <= 10) return null;
        let oppMax = -1, myMax = 0;
        for (const s of ['player', 'ai']) for (const r of ROWS) for (const c of g.side[s].rows[r]) {
          if (c.tomb || c.type === 'hero') continue;
          const p = c._effective || c.power || 0;
          if (s === 'player') oppMax = Math.max(oppMax, p); else myMax = Math.max(myMax, p);
        }
        const net = oppMax - myMax;
        if (oppMax >= 5 && net > 0) return { row: null, value: 30 + net * 3, type: 'scorch' };
        return null;
      }
      return null;
    }

    /* ---- 单位 / 英雄 ---- */
    if (card.ability === 'spy') {
      // 领先很多时不再送战力给对手（大师才会判断）
      if (this.skill >= 0.8 && st.diff > 12 && st.myHand <= 3) return null;
      if (this.skill < 0.4 && Math.random() < 0.4) return null;   // 弱 AI 常常不用间谍
      return { row: this._pickRowFor(card), value: 55 + (card.power || 0) * 0.4, type: 'spy' };
    }
    if (card.ability === 'medic') {
      const targets = side.graveyard.filter(c => !c.tomb && c.type === 'unit' && c.defId !== card.defId);
      if (!targets.length) return null;
      const best = targets.reduce((a, b) => ((b.power || 0) > (a.power || 0) ? b : a), targets[0]);
      return { row: this._pickRowFor(card), value: 35 + (best.power || 0) * 1.2, type: 'medic' };
    }
    if (card.ability === 'muster') {
      const group = card.mg || card.defId;
      const inDeck = side.pile.filter(c => (c.mg || c.defId) === group).length;
      return { row: this._pickRowFor(card), value: (card.power || 0) * (1 + inDeck) * 1.4 + (inDeck ? 15 : 0), type: 'unit' };
    }
    if (card.ability === 'tight_bond') {
      const row = this._pickRowFor(card);
      const same = side.rows[row].filter(c => c.defId === card.defId && !c.tomb).length;
      const inHand = side.hand.filter(c => c.defId === card.defId).length;
      const mult = g.tightMode === 'double' ? (same >= 1 ? 2 : 1) : (same + 1);
      return { row, value: (card.power || 0) * mult * (1 + inHand * 0.2) * 1.15, type: 'unit' };
    }
    if (card.ability === 'commanders_horn') {
      // 号角单位：放人多的排
      const row = this._pickRowFor(card);
      const count = side.rows[row].filter(c => !c.tomb).length;
      return { row, value: (card.power || 0) + count * 4 + 10, type: 'unit' };
    }

    const row = this._pickRowFor(card);
    let val = card.power || 0;
    if (card.type === 'hero') val *= 1.05;
    else if (this._rowWeatherHit(row)) val = 1 + (card.power || 0) * 0.08;
    if (side.horn[row] && card.type !== 'hero') val *= 1.3;
    return { row, value: val, type: 'unit' };
  }

  _rowWeatherHit(row) {
    const w = this.g.weather;
    return (row === 'melee' && w.frost) || (row === 'ranged' && w.fog) || (row === 'siege' && w.rain);
  }

  /** 选排：避开天气、优先有号角/同袍的排 */
  _pickRowFor(card) {
    const g = this.g;
    const rows = card.row === 'agile' ? ['melee', 'ranged'] : (Array.isArray(card.rows) ? card.rows : [card.row]);
    const valid = rows.filter(r => g.cardFitsRow(card, r));
    if (!valid.length) return rows[0];
    let best = valid[0], bestVal = -Infinity;
    for (const r of valid) {
      let v = 1;
      if (this._rowWeatherHit(r)) v -= 0.6;
      if (g.side.ai.horn[r]) v += 0.4;
      if (g.side.ai.rows[r].some(c => !c.tomb && c.ability === 'commanders_horn')) v += 0.3;
      if (g.side.ai.rows[r].some(c => !c.tomb && c.defId === card.defId)) v += 0.5;   // 同袍/召唤聚堆
      if (v > bestVal) { bestVal = v; best = r; }
    }
    return best;
  }

  /* ---------------- 执行 ---------------- */
  _execute(pick) {
    const g = this.g;
    const { card, handIndex } = pick;

    if (pick.type === 'decoy') {
      const res = g.playCard('ai', handIndex, null);
      if (res.ok && g.pendingDecoy && pick.targetUid != null) {
        g.applyDecoy('ai', pick.targetUid);
        return 'ai-play-decoy';
      }
      // 诱饵失败 → 换别的牌
      const alt = this._choosePlayExcluding(handIndex);
      return alt ? this._execute(alt) : null;
    }

    const row = pick.row || null;
    const res = g.playCard('ai', handIndex, row);
    if (res.ok) return 'ai-play-' + (pick.type || 'unit');

    // 出牌失败（例如需要选排的特殊情况）→ 尝试其它排 / 其它牌
    for (const r of ROWS) {
      if (r === row || !g.cardFitsRow(card, r)) continue;
      if (g.playCard('ai', handIndex, r).ok) return 'ai-play-' + (pick.type || 'unit');
    }
    const alt = this._choosePlayExcluding(handIndex);
    return alt ? this._execute(alt) : null;
  }

  _choosePlayExcluding(skipIndex) {
    const g = this.g;
    const side = g.side.ai;
    const cands = [];
    for (let i = 0; i < side.hand.length; i++) {
      if (i === skipIndex) continue;
      const s = this._scoreCard(side.hand[i], i);
      if (s) cands.push(Object.assign({ handIndex: i, card: side.hand[i] }, s));
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.value - a.value);
    return cands[0];
  }
}

