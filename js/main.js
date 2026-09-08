/* ============================================================
 * 主控 —— 开局流程：选阵营 → 选难度 → 卡组编辑 → 换牌 → 开战
 * ============================================================ */
'use strict';

const GAME_CFG = { aiSkill: 0.5 };

let game = null;

/* ---------------- 1. 选阵营 ---------------- */
function showFactionSelect() {
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  const facs = Object.entries(FACTIONS).filter(([k]) => k !== 'neutral');
  ov.innerHTML = `
    <div class="modal entry-modal">
      <div class="entry-head">
        <h2>选择你的阵营</h2>
        <div class="hint">经典三排昆特牌 · 三局两胜 · 完整技能规则 · 官方卡面与阵营盾徽</div>
      </div>
      <div class="faction-choice" id="facChoice">
        ${facs.map(([k, f]) => `
          <div class="fc" data-fac="${k}">
            <div class="crest-wrap">${emblemHtml(k)}</div>
            <div class="fc-name">${f.zh}</div>
            <div class="fc-en">${f.en}</div>
            <div class="fc-tag">${f.tagline || ''}</div>
          </div>`).join('')}
      </div>
      <div class="entry-foot">天气把对应排非英雄单位降为 1；号角使该排非英雄单位翻倍；英雄免疫天气/号角/焚风。</div>
    </div>`;
  ov.querySelectorAll('.fc').forEach(el => {
    el.addEventListener('click', () => { if (typeof SFX !== 'undefined') SFX.play('click'); showDifficultySelect(el.dataset.fac); });
  });
}

/* ---------------- 2. 选难度 ---------------- */
function showDifficultySelect(facKey) {
  const ov = document.getElementById('overlay');
  const fac = FACTIONS[facKey];
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal entry-modal">
      <div class="entry-head">
        <div class="entry-crest">${emblemHtml(facKey)}</div>
        <div>
          <h2>选择对手难度</h2>
          <div class="hint">${fac.zh} · AI 会使用同阵营卡池的自动牌组</div>
        </div>
      </div>
      <div class="diff-choice">
        ${DIFFICULTY_ORDER.map(k => {
          const d = DIFFICULTIES[k];
          return `<div class="diff-card" data-diff="${k}">
            <div class="diff-name">${d.zh}</div>
            <div class="diff-desc">${d.desc}</div>
            <div class="diff-bar"><span style="width:${Math.round(d.skill * 100)}%"></span></div>
          </div>`;
        }).join('')}
      </div>
      <div class="entry-foot"><button class="chip" id="backFac">返回阵营选择</button></div>
    </div>`;
  ov.querySelectorAll('.diff-card').forEach(el => {
    el.addEventListener('click', () => {
      if (typeof SFX !== 'undefined') SFX.play('click');
      openDeckBuilder(facKey, el.dataset.diff);
    });
  });
  document.getElementById('backFac').addEventListener('click', showFactionSelect);
}

/* ---------------- 3. 卡组编辑 → 开战 ---------------- */
function openDeckBuilder(facKey, diffKey) {
  DeckBuilder.open(facKey, diffKey, (playerDeck, diff) => startGame(playerDeck, diff));
}

/* ---------------- 4. 开始对局 ---------------- */
function startGame(playerDeck, diffKey) {
  const difficulty = DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
  // AI 用不同阵营 + 自动牌组
  const others = Object.keys(FACTIONS).filter(k => k !== 'neutral' && k !== playerDeck.faction);
  const aiFac = others[Math.floor(Math.random() * others.length)];
  const aiDeck = buildDeck(aiFac, { tier: difficulty.key === 'easy' ? 'weak' : 'normal' });

  game = new GwentGame({
    playerDeck, aiDeck,
    playerFirst: Math.random() < 0.5,
    aiSkill: difficulty.skill,
    difficulty: difficulty.key,
  });
  game.difficultyLabel = difficulty.zh;
  game.start();

  if (typeof SFX !== 'undefined') { SFX.unlock(); SFX.play('card'); }

  UI.init(game);
  UI.render();
  showMulliganUI();
}

/* ---------------- 换牌 UI ---------------- */
function showMulliganUI() {
  const ov = document.getElementById('overlay');
  const g = game;
  const hand = g.side.player.hand;
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal">
      <h2>开局换牌</h2>
      <div class="hint">点击手牌可替换（最多 ${DECK_RULES.mulligan} 张）。替换后随机重抽。</div>
      <div class="deck-grid" id="mullGrid">
        ${hand.map((c, i) => `
          <div class="deck-pick" data-i="${i}">
            ${cardHtml(c)}
            <div class="meta">${c.name.zh}</div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:8px">
        <button id="mullConfirm" class="primary">开始游戏</button>
        <button id="mullNone">不换牌，直接开始</button>
      </div>
    </div>`;

  const selected = new Set();
  ov.querySelectorAll('.deck-pick').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.i;
      if (selected.has(i)) { selected.delete(i); el.style.outline = ''; }
      else {
        if (selected.size >= DECK_RULES.mulligan) { UI.toast(`最多换 ${DECK_RULES.mulligan} 张`); return; }
        selected.add(i); el.style.outline = '2px solid var(--gold)';
      }
      document.getElementById('mullConfirm').textContent =
        selected.size ? `换 ${selected.size} 张并开始` : '开始游戏';
    });
  });

  const finish = (replacements) => {
    ov.classList.add('hidden'); ov.innerHTML = '';
    if (replacements.length) {
      g.doMulligan(replacements.map(i => ({ side: 'player', index: i })));
    }
    g.finishMulligan();
    if (typeof SFX !== 'undefined') SFX.play('card');
    UI.init(game);
    UI.render();
    if (g.current === 'ai') UI.scheduleAI();
  };

  document.getElementById('mullConfirm').addEventListener('click', () => {
    finish([...selected].sort((a, b) => b - a));
  });
  document.getElementById('mullNone').addEventListener('click', () => finish([]));
}

/* ---------------- 卡牌 HTML 片段 ---------------- */
function cardHtml(c, opts) {
  opts = opts || {};
  const fac = FACTIONS[c.faction] || FACTIONS.neutral;
  const zh = c.name ? c.name.zh : (c.zh || c.en || '');
  const type = c.type || c.t;
  const art = c.art
    ? `background-image:url('${c.art}')`
    : `background:linear-gradient(150deg,${fac.color1},${fac.color2})`;
  const cls = 'card' + (type === 'hero' ? ' hero' : '') + (type === 'special' ? ' special-card' : '');
  const power = c.power != null ? c.power : (c.p != null ? c.p : 0);
  return `<div class="${cls}">
    <div class="art" style="${art}"></div>
    ${type !== 'special' ? `<div class="power">${power}</div>` : `<div class="tag">${c.icon || ''}</div>`}
    ${opts.badge ? `<div class="pool-badge">${opts.badge}</div>` : ''}
    <div class="name">${zh}</div>
  </div>`;
}

/* ---------------- 启动 ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  showFactionSelect();
});

