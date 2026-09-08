/* ============================================================
 * 音效 —— 全部用 Web Audio API 实时合成（无需任何音频文件）
 * 用法：SFX.unlock() 首次用户手势后调用；SFX.handle(events) 消费引擎事件
 * ============================================================ */
'use strict';

const SFX = {
  ctx: null,
  master: null,
  enabled: true,
  volume: 0.55,

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
    try {
      const saved = localStorage.getItem('gwent.sfx');
      if (saved === 'off') this.enabled = false;
    } catch (e) { /* ignore */ }
    return this.ctx;
  },

  /** 浏览器要求用户手势后才能出声 */
  unlock() {
    const ctx = this.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  },

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('gwent.sfx', this.enabled ? 'on' : 'off'); } catch (e) {}
    if (this.enabled) { this.unlock(); this.play('click'); }
    return this.enabled;
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  },

  /* ---------------- 基础发声 ---------------- */
  _tone(o) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), t0 + (o.dur || 0.2));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    const peak = (o.gain == null ? 0.3 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.dur || 0.2));
    osc.connect(g);
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = o.filter.freq || 1200;
      if (o.filter.q) f.Q.value = o.filter.q;
      g.connect(f); f.connect(this.master);
    } else g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + (o.dur || 0.2) + 0.02);
  },

  _noise(o) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.3;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.setValueAtTime(o.from || 800, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to || 300), t0 + dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain == null ? 0.25 : o.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur);
  },

  /* ---------------- 具体音效 ---------------- */
  play(name) {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    switch (name) {
      case 'click':
        this._tone({ freq: 880, type: 'triangle', dur: 0.06, gain: 0.12 });
        break;
      case 'card':   // 抽牌/出牌：纸片摩擦
        this._noise({ from: 2600, to: 700, dur: 0.16, gain: 0.16, q: 0.8 });
        this._tone({ freq: 520, type: 'triangle', dur: 0.08, gain: 0.06 });
        break;
      case 'place':  // 牌落桌
        this._tone({ freq: 150, sweepTo: 70, type: 'sine', dur: 0.16, gain: 0.34 });
        this._noise({ from: 1200, to: 300, dur: 0.09, gain: 0.12 });
        break;
      case 'spy':    // 间谍：两声鬼祟小音
        this._tone({ freq: 660, type: 'triangle', dur: 0.09, gain: 0.16 });
        this._tone({ freq: 495, type: 'triangle', dur: 0.12, gain: 0.16, delay: 0.1 });
        break;
      case 'medic':  // 医生：上行铃声
        [523, 659, 784].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.18, gain: 0.14, delay: i * 0.07 }));
        break;
      case 'muster': // 召唤：连续短促
        [440, 554, 659, 880].forEach((f, i) => this._tone({ freq: f, type: 'square', dur: 0.07, gain: 0.08, delay: i * 0.05 }));
        break;
      case 'weather': // 天气：风声
        this._noise({ from: 300, to: 90, dur: 1.4, gain: 0.22, filterType: 'lowpass', q: 0.7 });
        break;
      case 'clear':   // 天晴：明亮上行
        [392, 523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.3, gain: 0.1, delay: i * 0.06 }));
        break;
      case 'horn':    // 号角：铜管和弦
        [196, 294, 392].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.7, gain: 0.11, delay: i * 0.02, filter: { type: 'lowpass', freq: 1400 } }));
        this._tone({ freq: 784, type: 'sawtooth', dur: 0.5, gain: 0.07, delay: 0.14, filter: { type: 'lowpass', freq: 1800 } });
        break;
      case 'scorch':  // 焚风：火焰爆裂
        this._noise({ from: 2400, to: 120, dur: 0.5, gain: 0.3, q: 0.6 });
        this._tone({ freq: 320, sweepTo: 60, type: 'sawtooth', dur: 0.4, gain: 0.16 });
        break;
      case 'decoy':   // 诱饵：上行嗖声
        this._noise({ from: 400, to: 2800, dur: 0.28, gain: 0.16, q: 0.7 });
        break;
      case 'pass':    // 过牌：两下轻敲
        this._tone({ freq: 220, sweepTo: 140, type: 'sine', dur: 0.1, gain: 0.24 });
        this._tone({ freq: 200, sweepTo: 120, type: 'sine', dur: 0.1, gain: 0.2, delay: 0.12 });
        break;
      case 'score':   // 分数滚动滴答
        this._tone({ freq: 1320, type: 'square', dur: 0.03, gain: 0.05 });
        break;
      case 'roundWin':
        [523, 659, 784].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.13, delay: i * 0.09 }));
        break;
      case 'roundLose':
        [523, 440, 349].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.55, gain: 0.13, delay: i * 0.1 }));
        break;
      case 'matchWin':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.6, gain: 0.1, delay: i * 0.1, filter: { type: 'lowpass', freq: 2200 } }));
        break;
      case 'matchLose':
        [392, 349, 294, 233].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.7, gain: 0.1, delay: i * 0.12, filter: { type: 'lowpass', freq: 1200 } }));
        break;
    }
  },

  /* ---------------- 引擎事件 → 音效 ---------------- */
  handle(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'unit': this.play('place'); break;
        case 'spy': this.play('spy'); break;
        case 'medic': this.play('medic'); break;
        case 'muster': this.play('muster'); break;
        case 'weather': this.play('weather'); break;
        case 'clear': this.play('clear'); break;
        case 'horn': this.play('horn'); break;
        case 'scorch': this.play('scorch'); break;
        case 'decoy': this.play('decoy'); break;
        case 'pass': this.play('pass'); break;
        case 'leader': this.play('horn'); break;
        case 'roundEnd':
          this.play(ev.winner === 'player' ? 'roundWin' : ev.winner === 'ai' ? 'roundLose' : 'score');
          break;
        case 'matchEnd':
          this.play(ev.winner === 'player' ? 'matchWin' : 'matchLose');
          break;
      }
    }
  },
};
