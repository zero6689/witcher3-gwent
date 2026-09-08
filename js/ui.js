/* ============================================================
 * 昆特牌 UI —— DOM 渲染
 * ============================================================ */
'use strict';

const UI = {
  g: null,           // GwentGame 实例
  sel: null,         // 当前选中的手牌索引
  targetMode: null,  // null | 'row-for-horn' | 'row-for-unit' | 'decoy' | 'medic'
  targetCardUid: null,
  busy: false,       // 动画/延时锁
  aiTimer: null,
  artBase: 'assets/cards/',

  init(g) {
    this.g = g;
    this.sel = null;
    this._prevUids = new Set();
    this._dispScore = { player: 0, ai: 0 };
    this._scoreAnim = {};
    this.bindStatic();
    this.render();
  },

  el(id) { return document.getElementById(id); },

  bindStatic() {
    if (this._bound) return;
    this._bound = true;
    // 首次点击解锁音频
    const unlock = () => { if (typeof SFX !== 'undefined') SFX.unlock(); };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  },

  /* ---------------- 渲染主入口 ---------------- */
  render() {
    const g = this.g;
    if (!g) return;
    // 消费引擎事件 → 音效
    if (typeof SFX !== 'undefined') {
      const evs = g.drainEvents ? g.drainEvents() : [];
      if (evs.length) {
        SFX.handle(evs);
        if (evs.some(e => e.type === 'scorch' || e.type === 'matchEnd' || e.type === 'roundEnd')) this._flashTable();
      }
    }
    this.renderTopbar();
    this.renderEnemy();
    this.renderMidline();
    this.renderPlayer();
    this.renderControls();
    this._afterRender();
  },

  /** 渲染后处理：记录场上卡牌、分数滚动动画 */
  _afterRender() {
    const g = this.g;
    const uids = new Set();
    for (const s of ['player', 'ai']) for (const r of ROWS) {
      for (const c of g.side[s].rows[r]) if (!c.tomb) uids.add(c.uid);
    }
    this._prevUids = uids;
    this._prevHand = new Set(g.side.player.hand.map(c => c.uid));
    this._animateScore('player', g.scores.player);
    this._animateScore('ai', g.scores.ai);
  },

  /** 总分数字滚动 */
  _animateScore(side, target) {
    const cur = this._dispScore[side] || 0;
    if (cur === target) return;
    const el = side === 'player' ? this.el('playerSide') : this.el('enemySide');
    const b = el && el.querySelector ? el.querySelector('.sp-score b') : null;
    if (!b) { this._dispScore[side] = target; return; }
    if (this._scoreAnim[side]) cancelAnimationFrame(this._scoreAnim[side]);
    const from = cur, dur = 420, t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (target - from) * eased);
      if (b.isConnected === false) return;      // 元素已被重渲染替换
      b.textContent = v;
      if (k < 1) this._scoreAnim[side] = requestAnimationFrame(tick);
      else { this._dispScore[side] = target; this._scoreAnim[side] = null; }
    };
    this._scoreAnim[side] = requestAnimationFrame(tick);
  },

  _flashTable() {
    const t = this.el('table');
    if (!t) return;
    t.classList.remove('flash');
    void t.offsetWidth;      // 触发重排以重启动画
    t.classList.add('flash');
  },

  /* ---------------- 顶栏 ---------------- */
  renderTopbar() {
    const g = this.g;
    const sb = this.el('scoreboard');
    sb.innerHTML = '';
    const mk = (side) => {
      const wins = g.side[side].roundsWon;
      const arr = [];
      for (let i = 0; i < 2; i++) {
        const d = document.createElement('div');
        d.className = 'win-pip' + (i < wins ? ' won' : '');
        d.textContent = side === 'player' ? '你' : 'AI';
        if (i < wins) d.textContent = side === 'player' ? '★' : '★';
        arr.push(d);
      }
      return arr;
    };
    // 用文字更清晰：你 x - y AI
    sb.innerHTML = `<div style="font-size:15px;color:var(--gold-hi);letter-spacing:1px;white-space:nowrap">
      <span style="color:#9fdcff">你</span> ${g.side.player.roundsWon} : ${g.side.ai.roundsWon} <span style="color:#ffb59e">对手</span>
      <span style="color:var(--text-dim);font-size:12px">第 ${g.round} 局</span></div>`;
  },

  /* ---------------- 对手区 ---------------- */
  renderEnemy() {
    this.renderSidePanel('ai');
    this.renderRows('ai');
  },

  /* ---------------- 己方区 ---------------- */
  renderPlayer() {
    this.renderSidePanel('player');
    this.renderRows('player');
    this.renderPlayerHand();
  },

  /* ---------------- 侧边阵营面板（盾徽 / 领袖 / 分数 / 牌堆） ---------------- */
  renderSidePanel(sideName) {
    const g = this.g;
    const side = g.side[sideName];
    const fac = FACTIONS[side.deck.faction];
    const isEnemy = sideName === 'ai';
    const host = this.el(isEnemy ? 'enemySide' : 'playerSide');
    if (!host) return;
    const leaderArt = side.deck.leader.art;
    const score = isEnemy ? g.scores.ai : g.scores.player;

    host.innerHTML = `
      <div class="sp-top">
        <span class="sp-crest">${emblemHtml(side.deck.faction)}</span>
        <span class="sp-name">${fac.zh}</span>
      </div>
      <div class="sp-leader">
        <div class="sp-leader-art" style="${leaderArt ? `background-image:url('${leaderArt}')` : `background:linear-gradient(150deg,${fac.color1},${fac.color2})`}"></div>
        <div class="sp-leader-name">${side.deck.leader.name.zh}</div>
      </div>
      <div class="sp-score"><b>${score}</b></div>
      <div class="sp-stats">牌堆 ${side.pile.length} · 坟场 ${side.graveyard.length}</div>
      ${isEnemy ? `<div class="sp-hand" title="对手手牌 ${side.hand.length} 张">${Array.from({ length: side.hand.length }, () => '<i class="back-mini"></i>').join('')}</div>` : ''}
    `;
    // 牌堆/坟场信息也同步到侧边
    const pile = this.el(isEnemy ? 'enemyDiscard' : 'playerDiscard');
    if (pile) pile.innerHTML = `<span class="count">牌堆 ${side.pile.length}</span><span class="count">坟场 ${side.graveyard.length}</span>`;
  },

  renderRows(sideName) {
    const g = this.g;
    const side = g.side[sideName];
    const container = this.el(sideName === 'player' ? 'playerRows' : 'enemyRows');
    container.innerHTML = '';
    const isEnemy = sideName === 'ai';
    for (const r of ROWS) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'row ' + r + (this._weatherHit(r) ? ' weather-hit' : '');
      if (this._weatherHit(r)) {
        if (r === 'melee' && g.weather.frost) rowDiv.classList.add('frost-hit');
        if (r === 'ranged' && g.weather.fog) rowDiv.classList.add('fog-hit');
        if (r === 'siege' && g.weather.rain) rowDiv.classList.add('rain-hit');
      }
      if (side.horn[r]) rowDiv.classList.add('horned');
      // 可放牌高亮（己方行动回合 & 手牌已选 & 牌可放这排）
      const playable = this._rowPlayable(sideName, r);
      if (playable) rowDiv.classList.add('playable');
      rowDiv.dataset.side = sideName;
      rowDiv.dataset.row = r;

      // 左侧：排名 + 该排总分（对齐巫师3 的排计分区）
      const rowside = document.createElement('div');
      rowside.className = 'rowside';
      const label = document.createElement('div');
      label.className = 'rowlabel';
      label.textContent = ROW_CN[r];
      const score = document.createElement('div');
      score.className = 'rowscore';
      const horn = side.horn[r] ? '<span class="horn">🎺</span>' : '';
      score.innerHTML = horn + g.rowTotal(sideName, r);
      rowside.appendChild(label);
      rowside.appendChild(score);
      rowDiv.appendChild(rowside);

      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'rowcards';
      let z = 0;
      for (const c of side.rows[r]) {
        if (c.tomb) continue;
        const cardEl = this._boardCard(c, sideName, r);
        cardEl.style.zIndex = z++;          // 新牌叠在旧牌上方
        cardsWrap.appendChild(cardEl);
      }
      rowDiv.appendChild(cardsWrap);
      // 牌多时自动缩小，保证整排都看得见
      this._fitRowCards(cardsWrap, rowDiv);

      rowDiv.addEventListener('click', () => this.onRowClick(sideName, r));
      container.appendChild(rowDiv);
    }
  },

  _weatherHit(row) {
    const w = this.g.weather;
    return (row === 'melee' && w.frost) || (row === 'ranged' && w.fog) || (row === 'siege' && w.rain);
  },

  /** 根据本排卡牌数量与可用宽度，计算合适的卡牌宽度（层叠后仍全部可见） */
  _fitRowCards(cardsWrap, rowDiv) {
    const n = cardsWrap.children.length;
    if (!n) return;
    const rowW = (rowDiv && rowDiv.clientWidth) || (this.el('table') && this.el('table').clientWidth) || 0;
    if (!rowW) return;                       // 无布局信息（测试环境）→ 用 CSS 默认值
    const avail = Math.max(180, rowW - 56);  // 减去左侧计分区
    // 每张牌可见宽度 = cardw * 0.53（首张为 1.0）→ 总宽 = cardw * (1 + 0.53*(n-1))
    const factor = 1 + 0.53 * (n - 1);
    let w = Math.floor(avail / factor);
    w = Math.max(34, Math.min(64, w));
    rowDiv.style.setProperty('--cardw', w + 'px');
  },

  _rowPlayable(sideName, r) {
    const g = this.g;
    if (this.targetMode) return false;
    if (!g.isPlayerTurn() || sideName !== 'player') return false;
    if (g.passed.player) return false;
    if (this.sel == null) return false;
    const card = g.side.player.hand[this.sel];
    if (!card) return false;
    if (card.type === 'special') {
      if (card.kind === 'horn') return true;      // 放己方任意排
      if (card.kind === 'decoy') return false;    // 特殊交互
      return false;                               // 天气等不需要选排
    }
    return g.cardFitsRow(card, r);
  },

  /* 场上小卡 */
  _boardCard(c, sideName, row) {
    const div = document.createElement('div');
    div.className = 'card small' + (c.type === 'hero' ? ' hero' : '') + (c.used ? ' special-card' : '');
    if (this._prevUids && !this._prevUids.has(c.uid)) div.classList.add('enter');
    div.dataset.uid = c.uid;
    div.dataset.side = sideName;
    div.dataset.row = row;
    div.dataset.spy = c.spied ? '1' : '';
    const art = document.createElement('div');
    art.className = 'art';
    if (c.art) art.style.backgroundImage = `url('${c.art}')`;
    else art.style.background = 'linear-gradient(145deg,#33302a,#17150f)';
    div.appendChild(art);
    if (c.type !== 'special' || c.kind === 'decoy') {
      const pow = document.createElement('div');
      pow.className = 'power';
      pow.textContent = c._effective != null ? c._effective : (c.power || 0);
      div.appendChild(pow);
    }
    if (c.type === 'special') {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = c.icon || '';
      div.appendChild(tag);
    } else {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = this._abilityIcon(c);
      div.appendChild(tag);
    }
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.name.zh;
    div.appendChild(name);
    if (c.spied) {
      const rowIco = document.createElement('div');
      rowIco.className = 'rowico';
      rowIco.textContent = '🕵️';
      div.appendChild(rowIco);
      div.classList.add('spied');
    }
    // 诱饵/收回目标：允许点击
    if (this.targetMode === 'decoy' && sideName === 'player' && c.type !== 'hero' && !c.spied) {
      div.classList.add('playable');
      div.addEventListener('click', (ev) => { ev.stopPropagation(); this.onDecoyTarget(c.uid); });
    }
    return div;
  },

  _abilityIcon(c) {
    if (c.type === 'hero') return '👑';
    switch (c.ability) {
      case 'spy': return '🕵️';
      case 'medic': return '💊';
      case 'muster': return '🧲';
      case 'tight_bond': return '🤝';
      case 'morale_boost': return '🚩';
      default: return c.ability === 'agile' ? '' : '';
    }
  },

  /* ---------------- 己方手牌 ---------------- */
  renderPlayerHand() {
    const g = this.g;
    const side = g.side.player;
    const hand = this.el('playerHand');
    hand.innerHTML = '';
    for (let i = 0; i < side.hand.length; i++) {
      const c = side.hand[i];
      const d = document.createElement('div');
      let cls = 'card';
      if (c.type === 'hero') cls += ' hero';
      if (c.type === 'special') cls += ' special-card';
      const playable = this._handPlayable(i);
      if (playable) cls += ' playable'; else cls += ' unplayable';
      if (this.sel === i) cls += ' selected';
      d.className = cls;
      if (this._prevHand && !this._prevHand.has(c.uid)) d.classList.add('enter');
      d.dataset.index = i;
      const art = document.createElement('div');
      art.className = 'art';
      if (c.art) art.style.backgroundImage = `url('${c.art}')`;
      else art.style.background = this._placeholderArt(c);
      d.appendChild(art);
      if (c.type !== 'special') {
        const pow = document.createElement('div');
        pow.className = 'power';
        pow.textContent = c.power || 0;
        d.appendChild(pow);
      } else {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = c.icon || '✨';
        d.appendChild(tag);
      }
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = (c.type === 'hero' ? '👑' : '') + (c.type !== 'special' && c.ability && c.ability !== 'agile' ? this._abilityIcon(c) : '');
      // 若已有 tag 则不再加（特殊牌 icon 已放）
      if (c.type !== 'special') {
        const t2 = document.createElement('div');
        t2.className = 'tag';
        t2.textContent = this._abilityIcon(c) === '' ? '' : this._abilityIcon(c);
        if (t2.textContent) d.appendChild(t2);
      }
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = c.name.zh + (c.desc && c.desc.length > 14 ? '' : (c.desc ? ' · ' + c.desc : ''));
      d.title = `${c.name.zh} (${c.name.en})${c.desc ? '\n' + c.desc : ''}\n${c.type === 'hero' ? '英雄：免疫天气/号角/焚风/诱饵/医生' : (c.row === 'agile' ? '可放近战或远程' : '可放' + ROW_CN[c.row])}`;
      d.title = c.desc ? `${c.name.zh}：${c.desc}` : c.name.zh;
      d.addEventListener('click', () => this.onHandClick(i));
      hand.appendChild(d);
    }
  },

  _placeholderArt(c) {
    const fac = FACTIONS[c.faction];
    return `linear-gradient(150deg, ${fac.color1}, ${fac.color2})`;
  },

  _handPlayable(i) {
    const g = this.g;
    if (this.targetMode) return false;
    if (!g.isPlayerTurn()) return false;
    if (g.passed.player) return false;
    const c = g.side.player.hand[i];
    if (!c) return false;
    // 特殊牌基本可打（decoy 需有目标，UI 会在点选后进入目标模式）
    return true;
  },

  /* ---------------- 中线 ---------------- */
  renderMidline() {
    const g = this.g;
    const wslot = this.el('weatherSlot');
    wslot.innerHTML = '';
    for (const key of ['frost', 'fog', 'rain']) {
      const d = document.createElement('div');
      d.className = 'wtoken ' + key + (g.weather[key] ? ' active' : '');
      d.textContent = WEATHER[key].icon;
      d.title = WEATHER[key].zh + '：' + WEATHER[key].desc;
      wslot.appendChild(d);
    }
    const tb = this.el('turnBanner');
    tb.className = 'turn-banner' + (g.isPlayerTurn() ? ' mine' : '');
    if (g.over) tb.textContent = g.winner === 'player' ? '🏆 你赢了！' : g.winner === 'ai' ? '对手获胜' : '平局';
    else if (g.needMulligan) tb.textContent = '第一局换牌…';
    else if (g.passed.player && !g.passed.ai) tb.textContent = '你已【过】，等待对手…';
    else if (g.passed.ai && !g.passed.player) tb.textContent = '对手已【过】，你可继续出牌或过';
    else tb.textContent = g.isPlayerTurn() ? '你的回合' : '对手思考中…';
  },

  /* ---------------- 控制按钮 ---------------- */
  renderControls() {
    const g = this.g;
    const box = this.el('actionButtons');
    box.innerHTML = '';
    // 音效开关（始终显示）
    const sound = document.createElement('button');
    sound.textContent = (typeof SFX !== 'undefined' && SFX.enabled) ? '🔊 音效' : '🔇 静音';
    sound.title = '开关音效';
    sound.addEventListener('click', () => {
      if (typeof SFX === 'undefined') return;
      const on = SFX.toggle();
      sound.textContent = on ? '🔊 音效' : '🔇 静音';
      if (on) SFX.play('click');
    });
    box.appendChild(sound);
    if (g.over) {
      const again = document.createElement('button');
      again.className = 'primary';
      again.textContent = '再来一局';
      again.addEventListener('click', () => {
        if (typeof showFactionSelect === 'function') showFactionSelect();
        else location.reload();
      });
      box.appendChild(again);
      return;
    }
    if (this.targetMode) {
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => { this.cancelTarget(); });
      box.appendChild(cancel);
      return;
    }
    if (!g.isPlayerTurn() || g.passed.player) {
      const hint = document.createElement('span');
      hint.style.color = 'var(--text-dim)';
      hint.textContent = g.passed.player ? '等待本局结算…' : '等待对手出牌…';
      box.appendChild(hint);
      return;
    }
    // 过
    const pass = document.createElement('button');
    pass.textContent = '【过】结束本局行动';
    pass.classList.add('danger');
    pass.addEventListener('click', () => this.onPass());
    box.appendChild(pass);
    // 领袖技
    if (g.canUseLeader('player')) {
      const ld = document.createElement('button');
      ld.textContent = `领袖技：${g.side.player.deck.leader.name.zh}`;
      ld.title = LEADER_CN[g.side.player.deck.leader.effect] || '';
      ld.addEventListener('click', () => this.onLeader());
      box.appendChild(ld);
    }
  },

  /* ---------------- 交互：点卡即自动上场 ---------------- */
  onHandClick(i) {
    const g = this.g;
    if (this.targetMode) return;
    if (!g.isPlayerTurn() || g.passed.player) return;
    const c = g.side.player.hand[i];
    if (!c) return;

    // 需要指定目标的特殊牌：诱饵（选己方单位）
    if (c.type === 'special' && c.kind === 'decoy') {
      this.enterTargetMode('decoy');
      return;
    }

    // 其余全部「点一下直接打到对应位置」
    let targetRow = null;
    if (c.type === 'special' && c.kind === 'horn') targetRow = this._bestHornRow();
    else if (c.type !== 'special') targetRow = this._autoRow(c);

    const res = g.playCard('player', i, targetRow);
    if (res.ok) {
      this.sel = null;
      if (typeof SFX !== 'undefined') SFX.play('card');
      this.afterAction();
    } else {
      this.toast(res.error || '这张牌现在打不出去');
      this.sel = null;
      this.render();
    }
  },

  /** 单位自动落位：优先不受天气影响、且有同名/号角协同的排 */
  _autoRow(card) {
    const g = this.g;
    const side = g.side.player;
    const rows = card.row === 'agile' ? ['melee', 'ranged']
      : (Array.isArray(card.rows) ? card.rows : [card.row]);
    const valid = rows.filter(r => g.cardFitsRow(card, r));
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0];
    let best = valid[0], bestScore = -Infinity;
    for (const r of valid) {
      const w = r === 'melee' ? g.weather.frost : r === 'ranged' ? g.weather.fog : g.weather.rain;
      let s = 0;
      if (w && card.type !== 'hero') s -= 5;
      if (side.horn[r]) s += 2;
      if (side.rows[r].some(x => !x.tomb && x.defId === card.defId)) s += 3;   // 同袍/召唤聚堆
      if (side.rows[r].some(x => !x.tomb && x.ability === 'commanders_horn')) s += 2;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    return best;
  },

  /** 号角自动选择收益最大的一排 */
  _bestHornRow() {
    const g = this.g;
    const side = g.side.player;
    let best = 'melee', bestVal = -1;
    for (const r of ROWS) {
      if (side.horn[r]) continue;
      const total = side.rows[r].filter(c => !c.tomb && c.type !== 'hero')
        .reduce((a, c) => a + (c._effective || c.power || 0), 0);
      if (total > bestVal) { bestVal = total; best = r; }
    }
    return best;
  },

  playSelectedSpecial(c) {
    const g = this.g;
    const idx = g.side.player.hand.indexOf(c);
    const res = g.playCard('player', idx, null);
    if (res.ok) { this.sel = null; this.afterAction(); }
    else this.toast(res.error || '无法打出');
  },

  enterTargetMode(mode) {
    this.sel = null;
    this.targetMode = mode;
    if (mode === 'decoy') {
      // 检查是否场上有可收回单位
      const has = ROWS.some(r => g.side.player.rows[r].some(c => !c.tomb && c.type !== 'hero' && !c.spied));
      if (!has) { this.toast('场上没有可收回的单位'); this.targetMode = null; this.render(); return; }
    }
    this.toast(mode === 'row-for-horn' ? '选择要放置号角的己方排' : '选择要收回的己方单位');
    this.render();
  },

  onRowClick(sideName, r) {
    const g = this.g;
    if (this.targetMode === 'row-for-horn') {
      if (sideName !== 'player') return;
      // 找手牌里的号角
      const c = g.side.player.hand.find(c => c.type === 'special' && c.kind === 'horn');
      if (!c) return;
      const idx = g.side.player.hand.indexOf(c);
      const res = g.playCard('player', idx, r);
      this.targetMode = null;
      if (res.ok) { this.sel = null; this.afterAction(); }
      else this.toast(res.error);
      return;
    }
    if (this.sel == null || !this._rowPlayable(sideName, r)) return;
    const c = g.side.player.hand[this.sel];
    const res = g.playCard('player', this.sel, r);
    if (res.ok) { this.sel = null; this.afterAction(); }
    else this.toast(res.error || '不能放在这里');
  },

  onDecoyTarget(uid) {
    const g = this.g;
    const res = g.applyDecoy('player', uid);
    this.targetMode = null;
    if (res.ok) { this.sel = null; this.afterAction(); }
    else this.toast(res.error || '收回失败');
  },

  onPass() {
    const g = this.g;
    const res = g.pass('player');
    if (res.ok) { this.sel = null; this.afterAction(); }
  },

  onLeader() {
    const g = this.g;
    const res = g.useLeader('player');
    if (res.ok) this.afterAction();
    else this.toast(res.error || '领袖技不可用');
  },

  /* 换牌：开局换牌由 main.js 的弹窗统一处理（见 showMulliganUI） */

  cancelTarget() {
    this.targetMode = null;
    this.sel = null;
    this.render();
  },

  /* 每次行动后：推进 AI / 刷新 */
  afterAction() {
    const g = this.g;
    this.render();
    if (g.pendingMedic) { this.showMedicModal(); return; }
    if (g.over) { this.render(); return; }
    if (g.current === 'ai') this.scheduleAI();
  },

  /* ---------------- 医生：选择复活目标 ---------------- */
  showMedicModal() {
    const g = this.g;
    const ov = this.el('overlay');
    const opts = g.pendingMedic.options
      .map(uid => g.side.player.graveyard.find(c => c.uid === uid))
      .filter(Boolean);
    if (!opts.length) { g.applyMedic('player', -1); this.afterAction(); return; }
    ov.classList.remove('hidden');
    ov.innerHTML = `
      <div class="modal">
        <h2>医生：选择要复活的单位</h2>
        <div class="hint">从己方坟场选择一张单位牌，直接放到场上</div>
        <div class="deck-grid">
          ${opts.map(c => `
            <div class="deck-pick" data-uid="${c.uid}">
              ${cardHtml(c)}
              <div class="meta">${c.name.zh} · ${c.power}</div>
            </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:center">
          <button id="medicSkip">不复活</button>
        </div>
      </div>`;
    const pick = (uid) => {
      ov.classList.add('hidden'); ov.innerHTML = '';
      g.applyMedic('player', uid);
      this.render();
      if (g.current === 'ai') this.scheduleAI();
    };
    ov.querySelectorAll('.deck-pick').forEach(el => {
      el.addEventListener('click', () => pick(+el.dataset.uid));
    });
    document.getElementById('medicSkip').addEventListener('click', () => pick(-1));
  },

  scheduleAI() {
    const g = this.g;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => this.runAI(), 700 + Math.random() * 600);
  },

  async runAI() {
    const g = this.g;
    if (g.over) { this.render(); return; }
    const ai = new GwentAI(g, g.aiSkill);
    const act = await ai.act();
    // AI 无法行动（例如手中只剩无法使用的诱饵）→ 自动过牌，避免卡死
    if (act === null && !g.over && g.current === 'ai' && !g.passed.ai) {
      g.pass('ai');
      this.render();
      if (g.current === 'ai') this.scheduleAI();
      return;
    }
    this.render();
    if (act === null) { this.render(); return; }
    if (g.over) { this.render(); return; }
    if (g.current === 'ai' && !g.passed.ai) this.scheduleAI();
    else if (g.current === 'player') this.render();
  },

  toast(msg) {
    const t = this.el('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.add('hidden'), 1800);
  },
};
