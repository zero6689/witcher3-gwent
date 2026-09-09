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

  /* ---------------- 探测可用音频 ---------------- */
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
    // 没有真实音频文件 → 用内置合成曲（原创、无版权）
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

  /* ---------------- 播放控制 ---------------- */
  play() {
    if (!this.enabled || !this.tracks.length) { this._render(); return; }
    if (this._isProcedural()) { this._startProcedural(); return; }
    if (!this.audio) { this._render(); return; }
    this.audio.volume = this.volume;
    const p = this.audio.play();
    if (p && p.catch) {
      p.catch(() => { this._needsGesture = true; this._render(); });
    }
    this.started = true;
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
        <div class="bgm-title"><span class="bgm-note">🎵</span>${t ? t.title : ''}</div>
        <div class="bgm-artist">${t ? t.artist : ''}</div>
      </div>
      <div class="bgm-vol">
        <span class="bgm-vol-ico">🔊</span>
        <input type="range" min="0" max="100" value="${Math.round(this.volume * 100)}" data-bgm="vol" title="音量">
      </div>`;

    el.querySelectorAll('[data-bgm]').forEach(node => {
      const act = node.dataset.bgm;
      if (act === 'toggle') node.addEventListener('click', () => this.toggle());
      else if (act === 'next') node.addEventListener('click', () => { this.next(); });
      else if (act === 'prev') node.addEventListener('click', () => { this.prev(); });
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
