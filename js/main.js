/* ============================================================
 * 主控 —— 主菜单 → 选阵营 → 选难度 → 卡组编辑 → 换牌 → 开战
 * ============================================================ */
'use strict';

const GAME_CFG = { aiSkill: 0.5 };

let game = null;

/* ---------------- 0. 主菜单 ---------------- */
function showMainMenu() {
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal main-menu">
      <div class="mm-title">昆特牌</div>
      <div class="mm-sub">GWENT · THE WITCHER 3</div>
      <div class="mm-crests">
        ${['northern', 'nilfgaard', 'scoiatael', 'monsters'].map(k => `<span class="mm-crest">${emblemHtml(k)}</span>`).join('')}
      </div>
      <div class="mm-buttons">
        <button class="mm-btn primary" data-mm="play">开始游戏</button>
        <button class="mm-btn" data-mm="config">配置卡牌</button>
        <button class="mm-btn" data-mm="sound">音乐与音效</button>
        <button class="mm-btn" data-mm="about">关于 / 声明</button>
      </div>
      <div class="mm-foot">二创同人作品 · 非商业用途 · 仅供个人学习娱乐 · 卡面版权归 CD Projekt RED</div>
    </div>`;
  ov.querySelectorAll('[data-mm]').forEach(el => {
    el.addEventListener('click', () => {
      if (typeof SFX !== 'undefined') SFX.play('click');
      const a = el.dataset.mm;
      if (a === 'play') showFactionSelect('play');
      else if (a === 'config') showFactionSelect('config');
      else if (a === 'sound') showSoundPanel(showMainMenu);
      else if (a === 'about') showAboutPanel(showMainMenu);
    });
  });
}

/* ---------------- 1. 选阵营 ---------------- */
function showFactionSelect(mode) {
  mode = mode || 'play';
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  const facs = Object.entries(FACTIONS).filter(([k]) => k !== 'neutral');
  ov.innerHTML = `
    <div class="modal entry-modal">
      <div class="entry-head">
        <h2>${mode === 'config' ? '配置卡牌 · 选择阵营' : '选择你的阵营'}</h2>
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
      <div class="entry-foot">
        <button class="chip" data-back="menu">返回主菜单</button>
        <span class="entry-tip">天气把对应排非英雄单位降为 1；号角使该排非英雄单位翻倍；英雄免疫天气/号角/焚风。</span>
      </div>
    </div>`;
  ov.querySelectorAll('.fc').forEach(el => {
    el.addEventListener('click', () => {
      if (typeof SFX !== 'undefined') SFX.play('click');
      const fac = el.dataset.fac;
      if (mode === 'config') openDeckBuilder(fac, null, true);
      else showDifficultySelect(fac);
    });
  });
  const back = ov.querySelector('[data-back="menu"]');
  if (back) back.addEventListener('click', showMainMenu);
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
  document.getElementById('backFac').addEventListener('click', () => showFactionSelect('play'));
}

/* ---------------- 3. 卡组编辑 → 开战 / 保存 ---------------- */
function openDeckBuilder(facKey, diffKey, configOnly) {
  DeckBuilder.open(facKey, diffKey, (playerDeck, diff) => {
    if (configOnly) { showMainMenu(); return; }
    startGame(playerDeck, diff);
  }, configOnly);
}

/* ---------------- 设置面板（音乐 / 音效 / 重开 / 主菜单） ---------------- */
function showSoundPanel(returnTo) {
  const ov = document.getElementById('overlay');
  const bgmOk = typeof BGM !== 'undefined' && BGM.tracks.length > 0;
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal sound-panel">
      <h2>音乐与音效</h2>
      <div class="sp-row">
        <span class="sp-label">背景音乐</span>
        <button id="bgmToggle" class="chip ${bgmOk && BGM.enabled ? 'active' : ''}" ${bgmOk ? '' : 'disabled'}>
          ${bgmOk ? (BGM.enabled ? '已开启' : '已关闭') : '无音频文件'}
        </button>
      </div>
      <div class="sp-row">
        <span class="sp-label">音乐音量</span>
        <input type="range" id="bgmVol" min="0" max="100" value="${bgmOk ? Math.round(BGM.volume * 100) : 0}" ${bgmOk ? '' : 'disabled'}>
        <b id="bgmVolVal">${bgmOk ? Math.round(BGM.volume * 100) : 0}%</b>
      </div>
      <div class="sp-row">
        <span class="sp-label">游戏音效</span>
        <button id="sfxToggle" class="chip ${typeof SFX !== 'undefined' && SFX.enabled ? 'active' : ''}">
          ${typeof SFX !== 'undefined' && SFX.enabled ? '已开启' : '已关闭'}
        </button>
      </div>
      <div class="sp-hint ${bgmOk ? '' : 'warn'}">
        ${bgmOk
          ? `当前曲目：${BGM.current() ? BGM.current().title : ''}（共 ${BGM.tracks.length} 首）`
          : '未找到 BGM 文件 —— 把 widow-maker.mp3 放进 assets/audio/ 即可自动播放'}
      </div>
      <div class="sp-actions">
        ${game && !game.over ? '<button id="spRestart" class="chip">重新开始</button>' : ''}
        <button id="spMenu" class="chip">返回主菜单</button>
        <button id="spClose" class="primary">关闭</button>
      </div>
    </div>`;

  const bgmToggle = document.getElementById('bgmToggle');
  if (bgmToggle && bgmOk) bgmToggle.addEventListener('click', () => { BGM.toggle(); showSoundPanel(returnTo); });
  const sfxToggle = document.getElementById('sfxToggle');
  if (sfxToggle) sfxToggle.addEventListener('click', () => {
    if (typeof SFX === 'undefined') return;
    SFX.toggle();
    showSoundPanel(returnTo);
  });
  const vol = document.getElementById('bgmVol');
  if (vol && bgmOk) vol.addEventListener('input', () => {
    BGM.setVolume(Number(vol.value) / 100);
    document.getElementById('bgmVolVal').textContent = vol.value + '%';
  });
  const close = () => {
    ov.classList.add('hidden'); ov.innerHTML = '';
    if (typeof returnTo === 'function') returnTo();
    else if (game) { UI.render(); }
  };
  document.getElementById('spClose').addEventListener('click', close);
  document.getElementById('spMenu').addEventListener('click', () => { game = null; showMainMenu(); });
  const re = document.getElementById('spRestart');
  if (re) re.addEventListener('click', () => { game = null; showFactionSelect('play'); });
}

/* ---------------- 关于 / 声明 ---------------- */
function showAboutPanel(returnTo) {
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal about-panel">
      <h2>关于 / 声明</h2>
      <div class="about-body">
        <p><b>二创同人作品</b>：本项目是《巫师3：狂猎》内置小游戏「昆特牌」的网页版二次创作，
        出于对这款游戏的喜爱而制作。</p>
        <p><b>非商业用途</b>：仅供个人学习与娱乐，不提供付费服务、不投放广告、不涉及任何盈利行为。</p>
        <p><b>版权归属</b>：卡面原画、阵营盾徽、角色形象与专有名词版权归 <b>CD Projekt RED</b> 及原作者所有，
        仅以学习、研究目的引用；背景音乐请使用你本人拥有的音频文件。</p>
        <p><b>技术说明</b>：代码由 AI 辅助编写（DeepSeek Harness），规则引擎、AI、音效均为纯前端实现。</p>
        <p class="about-dim">若版权方认为不妥，请联系删除，本项目会立即下线相关内容。</p>
      </div>
      <div class="sp-actions"><button id="abClose" class="primary">关闭</button></div>
    </div>`;
  document.getElementById('abClose').addEventListener('click', () => {
    ov.classList.add('hidden'); ov.innerHTML = '';
    if (typeof returnTo === 'function') returnTo();
  });
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
/* 阵营色竖条（对齐参考版：北方蓝/尼弗迦德金/松鼠绿/怪物红） */
const FACTION_BAR = {
  northern: '#4a7ba6',
  nilfgaard: '#a07c34',
  scoiatael: '#3f6b3a',
  monsters: '#7a1f1f',
  neutral: '#8a8a8a',
};

/* 技能 / 排位圆徽 */
const ROW_BADGE = {
  melee: { icon: '⚔', cls: 'melee', title: '近战排' },
  ranged: { icon: '🏹', cls: 'ranged', title: '远程排' },
  siege: { icon: '💣', cls: 'siege', title: '攻城排' },
  agile: { icon: '↔', cls: 'agile', title: '可放近战或远程' },
};
const ABILITY_BADGE = {
  spy: { icon: '🕵', title: '间谍' },
  medic: { icon: '✚', title: '医生' },
  muster: { icon: '🧲', title: '召唤' },
  tight_bond: { icon: '🤝', title: '同袍' },
  morale_boost: { icon: '🚩', title: '鼓舞' },
  commanders_horn: { icon: '🎺', title: '号角' },
  scorch: { icon: '🔥', title: '焚风' },
};

/** 卡牌圆徽列表（排位 + 技能） */
function cardBadges(c) {
  const out = [];
  if (c.type === 'hero') out.push({ icon: '👑', cls: 'hero', title: '英雄：免疫天气/号角/焚风' });
  if (c.row && ROW_BADGE[c.row]) out.push(ROW_BADGE[c.row]);
  const abs = c.abilities || (c.ability ? [c.ability] : []);
  for (const a of abs) if (ABILITY_BADGE[a]) out.push(Object.assign({ cls: a }, ABILITY_BADGE[a]));
  return out;
}

/** .card 的内部结构（art / 阵营竖条 / 战力圆徽 / 技能圆徽 / 名字带） */
function cardFaceHtml(c, opts) {
  opts = opts || {};
  const fac = FACTIONS[c.faction] || FACTIONS.neutral;
  const type = c.type || c.t;
  const zh = c.name ? c.name.zh : (c.zh || c.en || '');
  const art = c.art
    ? `background-image:url('${c.art}')`
    : `background:linear-gradient(150deg,${fac.color1},${fac.color2})`;
  const power = opts.power != null ? opts.power : (c.power != null ? c.power : (c.p != null ? c.p : 0));
  const bar = FACTION_BAR[c.faction] || FACTION_BAR.neutral;
  const badges = (opts.badges || cardBadges(c))
    .map(b => `<span class="cbadge ${b.cls || ''}" title="${b.title || ''}">${b.icon}</span>`).join('');
  return `<div class="art" style="${art}"></div>
    <span class="faction-bar" style="background:${bar}"></span>
    ${type !== 'special' ? `<div class="power">${power}</div>` : `<div class="tag">${c.icon || ''}</div>`}
    ${badges ? `<div class="abilities">${badges}</div>` : ''}
    <div class="name">${zh}</div>`;
}

function cardHtml(c, opts) {
  opts = opts || {};
  const type = c.type || c.t;
  const cls = 'card' + (type === 'hero' ? ' hero' : '') + (type === 'special' ? ' special-card' : '');
  return `<div class="${cls}">${cardFaceHtml(c, opts)}</div>`;
}

/* ---------------- 启动 ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  showMainMenu();
});

