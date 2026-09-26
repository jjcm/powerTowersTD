// Tiny procedural sound kit (WebAudio). No samples: everything is synthesized.

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  volume = 0.6;
  /** Hard mute (`?mute` in the URL, for automated testing); leaves the saved volume alone. */
  muted = false;

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // ambience beds
    const bed = (freq: number, q: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return g;
    };
    this.rainGain = bed(2500, 0.4, 'bandpass');
    this.windGain = bed(400, 0.6, 'lowpass');
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = this.muted ? 0 : v; }

  ambience(rain: number, night: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainGain?.gain.setTargetAtTime(rain * 0.22, t, 0.5);
    this.windGain?.gain.setTargetAtTime(0.03 + night * 0.02, t, 0.5);
  }

  play(name: string, vol = 1) {
    if (!this.ctx || this.volume <= 0 || this.muted) return;
    const now = performance.now();
    const gap = name === 'zap' || name === 'bolt' || name === 'fire' || name === 'frost' ? 70 : 40;
    if ((this.last.get(name) ?? 0) + gap > now) return;
    this.last.set(name, now);
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.master);
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, g0: number, delay = 0) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(g0, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    const noise = (type: BiquadFilterType, f0: number, f1: number, dur: number, g0: number, q = 1, delay = 0) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t + delay); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(g0, t + delay + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      s.connect(f).connect(g).connect(out); s.start(t + delay, Math.random()); s.stop(t + delay + dur + 0.05);
    };
    switch (name) {
      case 'build': noise('lowpass', 900, 120, 0.25, 0.5); osc('sine', 140, 60, 0.2, 0.4); break;
      case 'sell': osc('sine', 1320, 1320, 0.12, 0.2); osc('sine', 1760, 1760, 0.18, 0.2, 0.08); break;
      case 'upgrade': [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, 0.18, 0.18, i * 0.06)); break;
      case 'link': osc('sawtooth', 220, 1400, 0.18, 0.08); noise('highpass', 3000, 6000, 0.15, 0.08); break;
      case 'bolt': noise('bandpass', 2400, 900, 0.08, 0.25, 2); osc('triangle', 300, 120, 0.08, 0.12); break;
      case 'cannon': noise('lowpass', 1400, 80, 0.55, 0.9); osc('sine', 110, 35, 0.45, 0.8); break;
      case 'zap': noise('highpass', 5000, 1500, 0.14, 0.3); osc('sawtooth', 900, 200, 0.12, 0.08); break;
      case 'fire': noise('bandpass', 700, 2200, 0.25, 0.25, 0.8); break;
      case 'frost': osc('sine', 1800, 2400, 0.25, 0.1); osc('sine', 2700, 3200, 0.2, 0.06, 0.03); break;
      case 'acid': osc('sine', 300, 900, 0.12, 0.2); osc('sine', 500, 1200, 0.1, 0.12, 0.08); break;
      case 'blaze': noise('lowpass', 2500, 200, 0.9, 0.7); osc('sawtooth', 80, 40, 0.6, 0.2); break;
      case 'whip': noise('bandpass', 1200, 4000, 0.12, 0.3, 3); break;
      case 'splash': noise('bandpass', 1500, 400, 0.4, 0.4, 0.7); break;
      case 'holy': [660, 830, 990].forEach((f) => osc('sine', f, f * 1.01, 0.5, 0.08)); break;
      case 'arcane': osc('triangle', 600, 1500, 0.2, 0.1); osc('sine', 1200, 2000, 0.25, 0.06, 0.05); break;
      case 'roar': osc('sawtooth', 160, 70, 0.6, 0.25); noise('lowpass', 800, 200, 0.6, 0.3); break;
      case 'horn': osc('sawtooth', 147, 147, 0.9, 0.18); osc('sawtooth', 220, 220, 0.9, 0.12, 0.35); noise('lowpass', 400, 300, 1.2, 0.05); break;
      case 'cleared': [392, 494, 587, 784].forEach((f, i) => osc('triangle', f, f, 0.35, 0.16, i * 0.11)); break;
      case 'leak': osc('square', 220, 110, 0.5, 0.14); osc('square', 208, 104, 0.5, 0.1, 0.05); break;
      case 'thunder': noise('lowpass', 900, 60, 2.2, 0.9); noise('lowpass', 300, 50, 2.8, 0.7, 1, 0.15); break;
      case 'emp': osc('sawtooth', 1500, 60, 0.45, 0.18); noise('highpass', 4000, 800, 0.4, 0.15); break;
      case 'overheat': noise('highpass', 3000, 6000, 0.9, 0.25); osc('square', 880, 440, 0.3, 0.06); break;
      case 'research': osc('sine', 880, 880, 0.12, 0.15); break;
      case 'complete': [659, 880, 1318].forEach((f, i) => osc('sine', f, f, 0.4, 0.15, i * 0.09)); break;
      default:
        if (name.startsWith('spell_')) { osc('triangle', 300, 1200, 0.5, 0.15); noise('bandpass', 800, 3000, 0.6, 0.2); }
    }
  }
}
