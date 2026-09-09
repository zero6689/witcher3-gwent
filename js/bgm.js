/* ============================================================
 * 背景音乐播放器（BGM）
 *  - 默认曲目：《巫师3》OST（如 Widow-Maker）
 *  - 音频文件需自行放入 assets/audio/（版权原因不随仓库分发）
 *  - 自动探测可用文件；找不到时静默降级，只显示提示
 *  - 浏览器禁止自动播放 → 首次点击/触摸后自动开始
 * ============================================================ */
'use strict';

const BGM = {
  /* 候选曲目：按顺序探测，只播放实际存在的文件 */
  candidates: [
    { title: 'Widow-Maker', artist: 'The Witcher 3 OST', file: 'widow-maker' },
    { title: 'The Nightingale', artist: 'The Witcher 3 OST', file: 'the-nightingale' },
    { title: 'Steel for Humans', artist: 'The Witcher 3 OST', file: 'steel-for-humans' },
    { title: 'Hunt or Be Hunted', artist: 'The Witcher 3 OST', file: 'hunt-or-be-hunted' },
  ],
  exts: ['mp3', 'ogg', 'm4a', 'wav'],
  baseDir: 'assets/audio/',

  tracks: [],
  index: 0,
  audio: null,
  enabled: true,
  volume: 0.35,
  started: false,
  _needsGesture: false,
  _el: null,
  _probed: false,

  /* ---------------- 初始化 ---------------- */
  async init() {
    this._restore();
    this._buildUI();
    await this._probe();
    this._bindAudio();
    // 首次用户手势后尝试播放
    const kick = () => { this._needsGesture = false; if (this.enabled) this.play(); };
    document.addEventListener('click', kick, { once: true });
    document.addEventListener('touchstart', kick, { once: true });
    document.addEventListener('keydown', kick, { once: true });
    this._render();
  },

  _restore() {
    try {
      const v = localStorage.getItem('gwent.bgm.volume');
      if (v != null) this.volume = Math.max(0, Math.min(1, parseFloat(v)));
      const on = localStorage.getItem('gwent.bgm');
      if (on === 'off') this.enabled = false;
    } catch (e) { /* ignore */ }
  },

  _save() {
    try {
      localStorage.setItem('gwent.bgm.volume', String(this.volume));
      localStorage.setItem('gwent.bgm', this.enabled ? 'on' : 'off');
    } catch (e) { /* ignore */ }
  },

  /* ---------------- 探测可用音频 + 读取用户曲库 ---------------- */
  async _probe() {
    const found = [];
    for (const c of this.candidates) {
      for (const ext of this.exts) {
        const src = this.baseDir + c.file + '.' + ext;
        if (await this._exists(src)) {
          found.push({ title: c.title, artist: c.artist, src });
          break;
        }
      }
    }
    // 用户自己添加的曲目（IndexedDB 持久保存）
    const mine = await this._idbAll();
    for (const rec of mine) {
      found.push({
        id: rec.id, title: rec.title, artist: '本地文件 · 自己添加',
        blob: rec.blob, src: URL.createObjectURL(rec.blob), user: true,
      });
    }
    // 一个都没有 → 用内置合成曲（原创、无版权）
    if (!found.length) {
      found.push({ title: '酒馆夜曲', artist: '内置合成 · 原创无版权', procedural: true });
    }
    this.tracks = found;
    this._probed = true;
  },

  async _exists(src) {
    try {
      const res = await fetch(src, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return false;
      const type = res.headers.get('content-type') || '';
      // 某些静态服务器对未知类型返回 text/html（404 页面），排除
      return type.startsWith('audio/') || type === 'application/octet-stream' || type === '';
    } catch (e) {
      return false;   // file:// 或跨域探测失败 → 视为不存在
    }
  },

  /* ---------------- 音频绑定 ---------------- */
  _bindAudio() {
    if (!this.tracks.length) return;
    const first = this.tracks[0];
    if (first.procedural) return;          // 合成曲不需要 <audio>
    const a = new Audio();
    a.preload = 'auto';
    a.volume = this.volume;
    a.addEventListener('ended', () => this.next());
    a.addEventListener('error', () => this._skipBroken());
    this.audio = a;
    a.src = first.src;
  },

  /* ---------------- 内置合成 BGM（原创，无版权） ----------------
   * D 小调酒馆风：低音持续音 + 鲁特琴琶音 + 框鼓，4 小节循环
   * ------------------------------------------------------------ */
  _ensureAudioCtx() {
    if (this._pctx) return this._pctx;
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      this._pctx = new AC();
      this._pmaster = this._pctx.createGain();
      this._pmaster.gain.value = this.volume * 0.5;
      this._pmaster.connect(this._pctx.destination);
    } catch (e) { return null; }
    return this._pctx;
  },

  _pluck(t, freq, dur, gain) {
    const ctx = this._pctx;
    const osc = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f); f.connect(g); g.connect(this._pmaster);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  _drone(t, freq, dur, gain) {
    const ctx = this._pctx;
    const osc = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = 380;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.7);
    g.gain.setValueAtTime(gain, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(f); f.connect(g); g.connect(this._pmaster);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  _drum(t, gain) {
    const ctx = this._pctx;
    const dur = 0.18;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this._pmaster);
    src.start(t);
  },

  _scheduleProcedural() {
    const ctx = this._pctx;
    if (!ctx) return;
    const CHORDS = [
      { root: 146.83, notes: [293.66, 349.23, 440.00, 349.23] },   // Dm
      { root: 116.54, notes: [233.08, 293.66, 349.23, 293.66] },   // Bb
      { root: 174.61, notes: [349.23, 440.00, 523.25, 440.00] },   // F
      { root: 130.81, notes: [261.63, 329.63, 392.00, 329.63] },   // C
    ];
    const beatDur = 0.5;
    while (this._pnext < ctx.currentTime + 0.7) {
      const bar = Math.floor(this._pstep / 4) % CHORDS.length;
      const beat = this._pstep % 4;
      const ch = CHORDS[bar];
      const t = this._pnext;
      if (beat === 0) { this._drone(t, ch.root, beatDur * 4, 0.045); this._drum(t, 0.14); }
      if (beat === 2) this._drum(t, 0.10);
      this._pluck(t, ch.notes[beat], 1.2, 0.085);
      if (beat % 2 === 1) this._pluck(t + beatDur / 2, ch.notes[beat] * 2, 0.5, 0.03);
      this._pnext += beatDur;
      this._pstep++;
    }
  },

  _startProcedural() {
    const ctx = this._ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    this._pmaster.gain.cancelScheduledValues(ctx.currentTime);
    this._pmaster.gain.setValueAtTime(this.volume * 0.5, ctx.currentTime);
    this._pnext = ctx.currentTime + 0.08;
    this._pstep = 0;
    clearInterval(this._ptimer);
    this._ptimer = setInterval(() => this._scheduleProcedural(), 120);
    this._scheduleProcedural();
    this.started = true;
    this._render();
  },

  _stopProcedural() {
    clearInterval(this._ptimer);
    this._ptimer = null;
    if (this._pmaster && this._pctx) {
      const t = this._pctx.currentTime;
      this._pmaster.gain.cancelScheduledValues(t);
      this._pmaster.gain.setValueAtTime(this._pmaster.gain.value, t);
      this._pmaster.gain.linearRampToValueAtTime(0.0001, t + 0.35);
    }
    this.started = false;
    this._render();
  },

  _isProcedural() {
    const t = this.current();
    return !!(t && t.procedural);
  },

  _skipBroken() {
    const cur = this.current();
    if (cur) cur.broken = true;
    const alive = this.tracks.filter(t => !t.broken);
    if (!alive.length) { this.tracks = []; this._render(); return; }
    this.next();
  },

  current() { return this.tracks[this.index] || null; },

  /* ---------------- IndexedDB：保存用户添加的音乐 ---------------- */
  _idb() {
    if (this._dbp) return this._dbp;
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
    this._dbp = new Promise((res, rej) => {
      const req = indexedDB.open('gwent-bgm', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('tracks')) req.result.createObjectStore('tracks', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this._dbp;
  },

  async _idbAll() {
    try {
      const db = await this._idb();
      return await new Promise((res, rej) => {
        const r = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    } catch (e) { return []; }
  },

  async _idbPut(rec) {
    try {
      const db = await this._idb();
      await new Promise((res, rej) => {
        const tx = db.transaction('tracks', 'readwrite');
        tx.objectStore('tracks').put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch (e) { return false; }
  },

  async _idbDelete(id) {
    try {
      const db = await this._idb();
      await new Promise((res, rej) => {
        const tx = db.transaction('tracks', 'readwrite');
        tx.objectStore('tracks').delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* ignore */ }
  },

  /* ---------------- 用户添加 / 删除 / 切换曲目 ---------------- */
  async addFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => /^audio\//.test(f.type) || /\.(mp3|ogg|m4a|wav|flac|aac)$/i.test(f.name));
    if (!files.length) { this._toast('请选择音频文件（mp3 / ogg / m4a / wav）'); return; }
    let added = 0;
    for (const f of files) {
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const title = f.name.replace(/\.[^.]+$/, '');
      const rec = { id, title, blob: f };
      const saved = await this._idbPut(rec);
      this.tracks.push({
        id, title, artist: '本地文件 · 自己添加',
        blob: f, src: URL.createObjectURL(f), user: true, persisted: saved,
      });
      added++;
    }
    this._toast(`已添加 ${added} 首，正在播放第一首`);
    this.index = this.tracks.length - added;
    this._loadCurrent(true);
    this._render();
    this.renderPanel();
  },

  async removeTrack(idx) {
    const t = this.tracks[idx];
    if (!t) return;
    if (t.user && t.id) await this._idbDelete(t.id);
    const wasCurrent = idx === this.index;
    this.tracks.splice(idx, 1);
    if (!this.tracks.length) {
      this.tracks.push({ title: '酒馆夜曲', artist: '内置合成 · 原创无版权', procedural: true });
      this.index = 0;
      this._loadCurrent(true);
    } else if (wasCurrent) {
      this.index = Math.min(idx, this.tracks.length - 1);
      this._loadCurrent(true);
    } else if (idx < this.index) this.index--;
    this._render();
    this.renderPanel();
  },

  selectTrack(idx) {
    if (!this.tracks[idx]) return;
    this.index = idx;
    this._loadCurrent(true);
    this._render();
    this.renderPanel();
  },

  /** 切换当前曲目并播放 */
  _loadCurrent(autoplay) {
    const t = this.current();
    if (!t) return;
    if (this._isProcedural()) {
      if (this.audio) { this.audio.pause(); this.audio.src = ''; }
      if (autoplay && this.enabled) this._startProcedural();
      return;
    }
    clearInterval(this._ptimer); this._ptimer = null;
    if (!this.audio) {
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('ended', () => this.next());
      a.addEventListener('error', () => this._skipBroken());
      this.audio = a;
    }
    this.audio.volume = this.volume;
    if (this.audio.src !== t.src) this.audio.src = t.src;
    if (autoplay && this.enabled) {
      this.started = true;
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => { this._needsGesture = true; this._render(); });
    }
  },

  _toast(msg) {
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg);
  },

  /* ---------------- 曲库面板 ---------------- */
  openPanel() { this._panelOpen = true; this.renderPanel(); },
  closePanel() { this._panelOpen = false; this.renderPanel(); },

  renderPanel() {
    let host = this._panel;
    if (!host) {
      host = document.createElement('div');
      host.id = 'bgmPanel';
      host.className = 'bgm-panel';
      document.body.appendChild(host);
      this._panel = host;
    }
    if (!this._panelOpen) { host.classList.remove('show'); host.innerHTML = ''; return; }
    host.classList.add('show');
    const items = this.tracks.map((t, i) => `
      <div class="bp-item${i === this.index ? ' active' : ''}" data-i="${i}">
        <span class="bp-play">${i === this.index && this.started && this.enabled ? '🔊' : '▶'}</span>
        <span class="bp-info">
          <span class="bp-name">${this._esc(t.title)}</span>
          <span class="bp-meta">${this._esc(t.artist || '')}${t.persisted === false ? ' · 未持久化' : ''}</span>
        </span>
        ${t.user ? `<button class="bp-del" data-del="${i}" title="删除">✕</button>` : ''}
      </div>`).join('');

    host.innerHTML = `
      <div class="bp-head">
        <span>背景音乐</span>
        <button class="bp-close" title="关闭">✕</button>
      </div>
      <div class="bp-list">${items || '<div class="bp-empty">曲库为空</div>'}</div>
      <div class="bp-foot">
        <button class="bp-add">＋ 添加音乐文件</button>
        <input class="bp-file" type="file" accept="audio/*,.mp3,.ogg,.m4a,.wav,.flac" multiple hidden>
      </div>
      <div class="bp-hint">
        支持 mp3 / ogg / m4a / wav；添加的曲目保存在浏览器本地（IndexedDB），刷新后仍在。
        也可把文件放进 <code>assets/audio/</code>（命名 <code>widow-maker.mp3</code> 等）。
      </div>`;

    host.querySelector('.bp-close').addEventListener('click', () => this.closePanel());
    const fileInput = host.querySelector('.bp-file');
    host.querySelector('.bp-add').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { this.addFiles(fileInput.files); fileInput.value = ''; });
    host.querySelectorAll('.bp-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.bp-del')) return;
        this.selectTrack(Number(el.dataset.i));
      });
    });
    host.querySelectorAll('.bp-del').forEach(el => {
      el.addEventListener('click', (ev) => { ev.stopPropagation(); this.removeTrack(Number(el.dataset.del)); });
    });
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  play() {
    if (!this.enabled || !this.tracks.length) { this._render(); return; }
    if (this._isProcedural()) { this._startProcedural(); return; }
    this._loadCurrent(true);
    this._render();
  },

  pause() {
    if (this._isProcedural()) { this._stopProcedural(); return; }
    if (this.audio) this.audio.pause();
    this.started = false;
    this._render();
  },

  toggle() {
    if (!this.tracks.length) { this._hint(); return; }
    this.enabled = !this.enabled;
    this._save();
    if (this.enabled) this.play(); else this.pause();
    this._render();
  },

  next() {
    if (!this.tracks.length) return;
    if (this._isProcedural()) { this._startProcedural(); return; }
    const alive = this.tracks.filter(t => !t.broken);
    if (alive.length <= 1) { this.play(); return; }
    let guard = 0;
    do {
      this.index = (this.index + 1) % this.tracks.length;
    } while (this.tracks[this.index].broken && guard++ < this.tracks.length);
    if (this.audio) { this.audio.src = this.current().src; if (this.enabled) this.play(); }
    this._render();
  },

  prev() {
    if (!this.tracks.length) return;
    if (this._isProcedural()) { this._startProcedural(); return; }
    let guard = 0;
    do {
      this.index = (this.index - 1 + this.tracks.length) % this.tracks.length;
    } while (this.tracks[this.index].broken && guard++ < this.tracks.length);
    if (this.audio) { this.audio.src = this.current().src; if (this.enabled) this.play(); }
    this._render();
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.volume;
    if (this._pmaster && this._pctx && this._ptimer) {
      this._pmaster.gain.setValueAtTime(this.volume * 0.5, this._pctx.currentTime);
    }
    this._save();
    this._render();
  },

  _hint() {
    if (typeof UI !== 'undefined' && UI.toast) {
      UI.toast('未找到 BGM 文件：请把 widow-maker.mp3 放到 assets/audio/');
    }
  },

  /* ---------------- 播放器 UI ---------------- */
  _buildUI() {
    const el = document.createElement('div');
    el.className = 'bgm-bar';
    el.id = 'bgmBar';
    document.body.appendChild(el);
    this._el = el;
  },

  _render() {
    const el = this._el;
    if (!el) return;
    const t = this.current();
    const playing = !!(this.audio && !this.audio.paused && this.started && this.enabled);
    const hasTracks = this.tracks.length > 0;

    if (!hasTracks) {
      el.className = 'bgm-bar bgm-empty';
      el.innerHTML = `
        <span class="bgm-note">🎵</span>
        <span class="bgm-title">背景音乐未就绪</span>
        <span class="bgm-tip">把 widow-maker.mp3 放入 assets/audio/</span>`;
      return;
    }

    el.className = 'bgm-bar' + (playing ? ' playing' : '');
    el.innerHTML = `
      <button class="bgm-btn" data-bgm="prev" title="上一首">⏮</button>
      <button class="bgm-btn bgm-main" data-bgm="toggle" title="${playing ? '暂停' : '播放'}">${playing ? '⏸' : '▶'}</button>
      <button class="bgm-btn" data-bgm="next" title="下一首">⏭</button>
      <div class="bgm-info">
        <div class="bgm-title"><span class="bgm-note">🎵</span>${this._esc(t ? t.title : '')}</div>
        <div class="bgm-artist">${this._esc(t ? t.artist : '')}</div>
      </div>
      <div class="bgm-vol">
        <span class="bgm-vol-ico">🔊</span>
        <input type="range" min="0" max="100" value="${Math.round(this.volume * 100)}" data-bgm="vol" title="音量">
      </div>
      <button class="bgm-btn bgm-list-btn" data-bgm="list" title="曲库 / 更换音乐">☰</button>`;

    el.querySelectorAll('[data-bgm]').forEach(node => {
      const act = node.dataset.bgm;
      if (act === 'toggle') node.addEventListener('click', () => this.toggle());
      else if (act === 'next') node.addEventListener('click', () => { this.next(); });
      else if (act === 'prev') node.addEventListener('click', () => { this.prev(); });
      else if (act === 'list') node.addEventListener('click', (e) => { e.stopPropagation(); this._panelOpen ? this.closePanel() : this.openPanel(); });
      else if (act === 'vol') {
        node.addEventListener('input', () => this.setVolume(Number(node.value) / 100));
        node.addEventListener('click', (e) => e.stopPropagation());
      }
    });
  },
};

/* 启动 */
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => BGM.init());
}
