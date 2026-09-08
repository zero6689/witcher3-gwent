/* ============================================================
 * 卡组编辑器（22–40 单位 + ≤10 特殊牌 + 选领袖）
 * 用法：DeckBuilder.open(factionKey, difficultyKey, onStart)
 * ============================================================ */
'use strict';

const DeckBuilder = {
  faction: null,
  difficulty: 'normal',
  leaderId: null,
  picks: {},
  onStart: null,
  filter: 'all',       // all | unit | hero | special
  _key: null,

  /* ---------- 本地存储 ---------- */
  storageKey(fac) { return 'gwent.deck.' + fac; },
  save() {
    try {
      localStorage.setItem(this.storageKey(this.faction), JSON.stringify({ leaderId: this.leaderId, picks: this.picks }));
    } catch (e) { /* file:// 或隐私模式下降级为仅内存 */ }
  },
  load(fac) {
    try {
      const raw = localStorage.getItem(this.storageKey(fac));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d && d.picks && LEADERS[fac].some(l => l.id === d.leaderId)) return d;
    } catch (e) { /* ignore */ }
    return null;
  },

  /* ---------- 打开编辑器 ---------- */
  open(factionKey, difficultyKey, onStart) {
    this.faction = factionKey;
    this.difficulty = difficultyKey || 'normal';
    this.onStart = onStart;
    const saved = this.load(factionKey);
    if (saved) {
      this.leaderId = saved.leaderId;
      this.picks = Object.assign({}, saved.picks);
    } else {
      this.leaderId = LEADERS[factionKey][0].id;
      this.picks = autoPicks(factionKey);          // 默认给一套合法牌组，玩家再微调
    }
    this.render();
  },

  /* ---------- 统计 / 校验 ---------- */
  stats() { return validatePicks(this.faction, this.picks); },
  countOf(defId) { return this.picks[defId] || 0; },

  add(defId) {
    const def = ALL_CARDS[defId];
    if (!def) return;
    const cur = this.countOf(defId);
    if (cur >= (def.n || 1)) { UI.toast(`「${def.zh}」最多 ${def.n || 1} 张`); return; }
    const st = this.stats();
    if (def.t === 'special' && st.specialCount >= DECK_RULES.maxSpecials) { UI.toast('特殊牌最多 10 张'); return; }
    if (def.t !== 'special' && st.unitCount >= DECK_RULES.maxUnits) { UI.toast('单位牌最多 40 张'); return; }
    this.picks[defId] = cur + 1;
    this.save();
    this.render();
  },

  remove(defId) {
    const cur = this.countOf(defId);
    if (!cur) return;
    if (cur <= 1) delete this.picks[defId]; else this.picks[defId] = cur - 1;
    this.save();
    this.render();
  },

  fillAuto() {
    this.picks = autoPicks(this.faction);
    this.save();
    this.render();
  },

  clearAll() {
    this.picks = {};
    this.save();
    this.render();
  },

  /* ---------- 渲染 ---------- */
  render() {
    const ov = document.getElementById('overlay');
    const fac = FACTIONS[this.faction];
    const st = this.stats();
    const leaders = LEADERS[this.faction];

    // 卡池：阵营 + 中立
    const pool = CARDS[this.faction].concat(CARDS.neutral, CARDS.special)
      .map(d => ALL_CARDS[d.id])
      .filter(d => {
        if (this.filter === 'unit') return d.t === 'unit';
        if (this.filter === 'hero') return d.t === 'hero';
        if (this.filter === 'special') return d.t === 'special';
        return true;
      })
      .sort((a, b) => {
        const order = { hero: 0, unit: 1, special: 2 };
        const oa = order[a.t], ob = order[b.t];
        if (oa !== ob) return oa - ob;
        if (a.t === 'special' && b.t === 'special') return a.zh.localeCompare(b.zh, 'zh');
        return (b.p || 0) - (a.p || 0);
      });

    const cardTile = (d) => {
      const cur = this.countOf(d.id);
      const max = d.n || 1;
      const full = cur >= max;
      return `<div class="pool-card${cur ? ' chosen' : ''}${full ? ' full' : ''}" data-def="${d.id}" title="${d.zh}${d.desc ? ' · ' + d.desc : ''}">
        ${cardHtml(Object.assign({}, d, { faction: d.faction, type: d.t, power: d.p }))}
        <div class="pool-badge">${cur}/${max}</div>
      </div>`;
    };

    ov.classList.remove('hidden');
    ov.innerHTML = `
      <div class="modal deck-modal">
        <div class="deck-head">
          <div class="dh-title"><span class="dh-crest">${emblemHtml(this.faction)}</span> ${fac.zh} · 卡组编辑</div>
          <div class="dh-stats">
            <span class="stat ${st.unitCount < DECK_RULES.minUnits ? 'bad' : (st.unitCount > DECK_RULES.maxUnits ? 'bad' : 'good')}">单位 ${st.unitCount}/${DECK_RULES.maxUnits}</span>
            <span class="stat ${st.specialCount > DECK_RULES.maxSpecials ? 'bad' : 'good'}">特殊 ${st.specialCount}/${DECK_RULES.maxSpecials}</span>
            <span class="stat">总计 ${st.total}</span>
          </div>
        </div>

        <div class="deck-leaders">
          ${leaders.map(l => `
            <div class="leader-chip${l.id === this.leaderId ? ' active' : ''}" data-leader="${l.id}" title="${l.desc}">
              <div class="lc-art" style="${l.art ? `background-image:url('${l.art}')` : `background:linear-gradient(150deg,${fac.color1},${fac.color2})`}"></div>
              <div class="lc-name">${l.name.zh}</div>
              <div class="lc-desc">${l.desc}</div>
            </div>`).join('')}
        </div>

        <div class="deck-filters">
          ${['all', 'unit', 'hero', 'special'].map(f => `
            <button class="chip${this.filter === f ? ' active' : ''}" data-filter="${f}">
              ${{ all: '全部', unit: '单位', hero: '英雄', special: '特殊牌' }[f]}
            </button>`).join('')}
          <span class="spacer"></span>
          <button class="chip" data-act="auto">一键填充</button>
          <button class="chip" data-act="clear">清空</button>
        </div>

        <div class="deck-body">
          <div class="pool-grid">${pool.map(cardTile).join('')}</div>
        </div>

        <div class="deck-foot">
          <div class="deck-msg">${st.ok ? '<span class="ok">✅ 卡组合法，可以开战</span>' : `<span class="err">${st.errors[0]}</span>`}</div>
          <div class="deck-actions">
            <button class="chip" data-act="back">返回阵营选择</button>
            <button class="primary" data-act="start" ${st.ok ? '' : 'disabled'}>开始对战（${DIFFICULTIES[this.difficulty].zh}）</button>
          </div>
        </div>
      </div>`;

    // 事件绑定
    ov.querySelectorAll('.pool-card').forEach(el => {
      const id = el.dataset.def;
      el.addEventListener('click', (ev) => {
        if (ev.shiftKey || ev.button === 2) this.remove(id); else this.add(id);
      });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.remove(id); });
    });
    ov.querySelectorAll('.leader-chip').forEach(el => {
      el.addEventListener('click', () => { this.leaderId = el.dataset.leader; this.save(); this.render(); });
    });
    ov.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('click', () => { this.filter = el.dataset.filter; this.render(); });
    });
    ov.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      el.addEventListener('click', () => {
        if (act === 'auto') this.fillAuto();
        else if (act === 'clear') this.clearAll();
        else if (act === 'back') showFactionSelect();
        else if (act === 'start') this.start();
      });
    });
  },

  start() {
    const st = this.stats();
    if (!st.ok) { UI.toast(st.errors[0]); return; }
    const deck = buildCustomDeck(this.faction, this.leaderId, this.picks);
    this.save();
    const ov = document.getElementById('overlay');
    ov.classList.add('hidden');
    ov.innerHTML = '';
    this.onStart && this.onStart(deck, this.difficulty);
  },
};
