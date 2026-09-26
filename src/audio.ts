// Procedural sound kit (WebAudio). No samples: everything is synthesized.
// - Effects go through a bus with a small synthesized reverb send. Each play gets a little
//   pitch and gain variation, a stereo pan from its screen position, and a voice limit, so
//   rapid fire doesn't turn into a machine-gun loop.
// - Ambience is alive: gusty wind, birdsong by day, crickets at night, rain.
// - Recorded CC0 samples (sfx.ts) play on top where they exist; until they've loaded (or if a
//   file is missing) the synth recipe alone covers the sound.

import { SFX, SFX_FILES } from './sfx';

type Osc = OscillatorType;

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private verb!: GainNode;          // reverb send
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private voices = new Map<string, number[]>();   // end times of sounding voices, per name
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private gust = 0; private gustV = 0;
  private nextBird = 0; private nextCricket = 0;
  private buffers = new Map<string, AudioBuffer>();
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
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1.1; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // small outdoor reverb: decaying, darkening stereo noise
    const conv = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const o = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        lp += ((Math.random() * 2 - 1) - lp) * (0.5 - t * 0.4);   // the high end dies first
        o[i] = lp * Math.pow(1 - t, 2.6) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
      }
    }
    conv.buffer = ir;
    this.verb = ctx.createGain(); this.verb.gain.value = 0.55;
    this.verb.connect(conv).connect(this.master);

    // ambience beds
    const bed = (freq: number, q: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb); src.start(0, Math.random() * 2);
      return { g, f };
    };
    this.rainGain = bed(2600, 0.5, 'bandpass').g;
    const wind = bed(420, 0.8, 'lowpass');
    this.windGain = wind.g; this.windFilter = wind.f;
    this.nextBird = ctx.currentTime + 2;
    this.nextCricket = ctx.currentTime + 1;
    void this.loadSamples();
  }

  private async loadSamples() {
    const ctx = this.ctx!;
    await Promise.all(SFX_FILES.map(async (name) => {
      try {
        const r = await fetch(`assets/sfx/${name}.mp3`);
        if (r.ok) this.buffers.set(name, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch { /* the synth recipe covers it */ }
    }));
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = this.muted ? 0 : v; }

  /** Called every frame. rain 0..1, night 0..1, wind ~1 (calm) .. 2.4 (storm). */
  ambience(rain: number, night: number, wind = 1, dt = 1 / 60) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.rainGain?.gain.setTargetAtTime(rain * 0.2, t, 0.5);
    // gusts: a slow random walk on level and brightness
    this.gustV += (Math.random() - 0.5) * dt * 3 - this.gustV * dt * 0.8;
    this.gust = Math.min(1, Math.max(0, this.gust + this.gustV * dt));
    this.windGain?.gain.setTargetAtTime((0.018 + this.gust * 0.035) * wind * (1 + night * 0.3), t, 0.3);
    this.windFilter?.frequency.setTargetAtTime(280 + this.gust * 520 * wind, t, 0.4);

    if (night < 0.5 && rain < 0.2 && t > this.nextBird) {
      this.bird();
      this.nextBird = t + 1.5 + Math.random() * 5.5;
    }
    if (night > 0.5 && rain < 0.4 && t > this.nextCricket) {
      this.cricket();
      this.nextCricket = t + 0.35 + Math.random() * 0.9;
    }
  }

  private bird() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain(); out.gain.value = 0.025 + Math.random() * 0.025;
    out.connect(pan).connect(this.amb);
    const send = ctx.createGain(); send.gain.value = 0.5; out.connect(send).connect(this.verb);
    const chirp = (f0: number, f1: number, at: number, dur: number) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(1, t + at + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(out); o.start(t + at); o.stop(t + at + dur + 0.02);
    };
    const kind = Math.random();
    const base = 2200 + Math.random() * 1400;
    if (kind < 0.4) {                     // two-note whistle, sometimes repeated
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) { chirp(base, base * 1.04, i * 0.45, 0.14); chirp(base * 0.8, base * 0.76, i * 0.45 + 0.17, 0.2); }
    } else if (kind < 0.75) {             // trill
      const n = 5 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) chirp(base * 1.2, base * 1.55, i * 0.055, 0.035);
    } else {                              // rising questions
      for (let i = 0; i < 3; i++) chirp(base * (0.8 + i * 0.1), base * (1.1 + i * 0.12), i * 0.16, 0.09);
    }
  }

  private cricket() {
    const ctx = this.ctx!, t = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.8 - 0.9;
    const out = ctx.createGain(); out.gain.value = 0.012 + Math.random() * 0.01;
    out.connect(pan).connect(this.amb);
    const f = 4300 + Math.random() * 700;
    const pulses = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const a = t + i * 0.045;
      g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(1, a + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.03);
      o.connect(g).connect(out); o.start(a); o.stop(a + 0.04);
    }
  }

  /** pan: -1 (left) .. 1 (right), from the event's screen position. */
  play(name: string, vol = 1, pan = 0) {
    if (!this.ctx || this.volume <= 0 || this.muted) return;
    const now = performance.now();
    const gap = name === 'zap' || name === 'bolt' || name === 'fire' || name === 'frost' || name === 'death' ? 60 : 35;
    if ((this.last.get(name) ?? 0) + gap > now) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // voice limit: frequent sounds never stack more than a few deep
    const cap = name === 'death' || name === 'bolt' || name === 'zap' ? 3 : 4;
    const live = (this.voices.get(name) ?? []).filter((e) => e > t);
    if (live.length >= cap) return;
    this.last.set(name, now);

    const p = 1 + (Math.random() - 0.5) * 0.12;          // pitch variation
    const out = ctx.createGain();
    out.gain.value = vol * (0.85 + Math.random() * 0.3);
    const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    out.connect(panner).connect(this.sfx);
    const send = ctx.createGain(); send.gain.value = 0.12; panner.connect(send).connect(this.verb);
    let end = 0;
    // recorded variant, if there is one
    const def = SFX[name];
    const buf = def ? this.buffers.get(def.files[Math.floor(Math.random() * def.files.length)]) : undefined;
    let synthGain = 1;
    if (def && buf) {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const r = (def.rate ? def.rate[0] + Math.random() * (def.rate[1] - def.rate[0]) : 1) * p;
      src.playbackRate.value = r;
      const g = ctx.createGain(); g.gain.value = def.gain;
      src.connect(g).connect(out); src.start(t);
      end = buf.duration / r;
      synthGain = def.layer ?? 0;
    }
    const sOut = ctx.createGain(); sOut.gain.value = synthGain; sOut.connect(out);
    const osc = (type: Osc, f0: number, f1: number, dur: number, g0: number, delay = 0, atk = 0.006) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0 * p, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * p), t + delay + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(g0, t + delay + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(sOut); o.start(t + delay); o.stop(t + delay + dur + 0.05);
      end = Math.max(end, delay + dur);
    };
    const noise = (type: BiquadFilterType, f0: number, f1: number, dur: number, g0: number, q = 1, delay = 0, atk = 0.004) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0 * p, t + delay); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * p), t + delay + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(g0, t + delay + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      s.connect(f).connect(g).connect(sOut); s.start(t + delay, Math.random() * 1.5); s.stop(t + delay + dur + 0.05);
      end = Math.max(end, delay + dur);
    };
    /** n tiny noise grains scattered over `span` seconds (crackle, debris, sizzle). */
    const grains = (n: number, span: number, fLo: number, fHi: number, g0: number, delay = 0) => {
      for (let i = 0; i < n; i++) {
        const f = fLo + Math.random() * (fHi - fLo);
        noise('bandpass', f, f * 0.8, 0.008 + Math.random() * 0.018, g0 * (0.4 + Math.random() * 0.6), 2.5, delay + Math.random() * span, 0.001);
      }
    };
    const wet = (v: number) => { send.gain.value = v; };

    if (synthGain > 0) switch (name) {
      // ---- towers
      case 'bolt':      // ballista: string snap, wooden knock, bolt whoosh
        osc('triangle', 240, 95, 0.12, 0.16, 0, 0.002);
        osc('sine', 120, 70, 0.16, 0.16, 0, 0.002);
        noise('bandpass', 950, 520, 0.05, 0.3, 3, 0, 0.001);
        noise('bandpass', 2600, 900, 0.2, 0.06, 1.2, 0.02, 0.03);
        wet(0.1); break;
      case 'cannon':    // crack, blast body, sub drop, rolling tail
        noise('highpass', 3200, 1600, 0.05, 0.45, 0.7, 0, 0.001);
        noise('lowpass', 1800, 90, 0.7, 0.75, 0.7, 0, 0.002);
        osc('sine', 88, 32, 0.55, 0.85, 0, 0.003);
        noise('lowpass', 320, 60, 1.4, 0.22, 0.7, 0.08, 0.05);
        wet(0.3); break;
      case 'zap':       // tesla: crackle grains over a low buzz
        grains(9, 0.16, 2500, 6500, 0.35);
        osc('sawtooth', 130, 95, 0.15, 0.035, 0, 0.004);
        wet(0.08); break;
      case 'fire':      // flame burst
        noise('bandpass', 500, 1700, 0.3, 0.22, 0.8, 0, 0.03);
        grains(5, 0.25, 1500, 4000, 0.12, 0.02);
        break;
      case 'frost':     // glassy chime + shimmer
        osc('sine', 1850, 1900, 0.3, 0.07); osc('sine', 2470, 2500, 0.26, 0.05, 0.02); osc('sine', 3120, 3150, 0.22, 0.035, 0.04);
        noise('highpass', 6000, 8000, 0.25, 0.05, 0.7, 0, 0.02);
        wet(0.3); break;
      case 'acid':      // bubbles
        for (let i = 0; i < 4; i++) { const f = 280 + Math.random() * 260; osc('sine', f, f * 2.2, 0.06, 0.12, i * 0.05 + Math.random() * 0.02, 0.003); }
        break;
      case 'blaze':     // big whoomp of fire
        noise('lowpass', 2600, 180, 0.9, 0.6, 0.7, 0, 0.02);
        osc('sawtooth', 75, 38, 0.6, 0.12);
        grains(10, 0.8, 1200, 4500, 0.1, 0.1);
        wet(0.25); break;
      case 'whip': noise('bandpass', 1200, 4200, 0.12, 0.28, 3, 0, 0.002); break;
      case 'splash':    // water body + droplets
        noise('bandpass', 1400, 320, 0.45, 0.55, 0.7, 0, 0.01);
        for (let i = 0; i < 4; i++) { const f = 1100 + Math.random() * 900; osc('sine', f, f * 1.5, 0.03, 0.1, 0.06 + Math.random() * 0.2, 0.002); }
        wet(0.2); break;
      // ---- spells and weather
      case 'holy': [660, 830, 990, 1320].forEach((f, i) => osc('sine', f, f * 1.005, 0.9, 0.06, i * 0.03, 0.08)); wet(0.5); break;
      case 'arcane': osc('triangle', 600, 1500, 0.25, 0.09); osc('sine', 1200, 2000, 0.3, 0.05, 0.05); wet(0.45); break;
      case 'thunder': noise('lowpass', 900, 60, 2.2, 0.85, 0.7, 0, 0.005); noise('lowpass', 300, 50, 2.8, 0.6, 1, 0.15, 0.2); wet(0.5); break;
      case 'emp': osc('sawtooth', 1500, 60, 0.45, 0.14); noise('highpass', 4000, 800, 0.4, 0.12); grains(8, 0.3, 3000, 7000, 0.15); break;
      case 'overheat': noise('highpass', 3000, 6000, 0.9, 0.18, 0.7, 0, 0.05); osc('square', 880, 440, 0.3, 0.04); break;
      // ---- runners
      case 'death':     // soft thump + a coin
        noise('lowpass', 600, 120, 0.12, 0.2, 0.7, 0, 0.003);
        osc('sine', 2600, 2640, 0.1, 0.03, 0.04, 0.002); osc('sine', 3900, 3950, 0.08, 0.018, 0.05, 0.002);
        break;
      case 'roar': osc('sawtooth', 160, 70, 0.6, 0.2); noise('lowpass', 800, 200, 0.6, 0.25); wet(0.3); break;
      case 'horn': osc('sawtooth', 147, 147, 0.9, 0.5, 0, 0.08); osc('sawtooth', 220, 220, 0.9, 0.38, 0.35, 0.08); noise('lowpass', 400, 300, 1.2, 0.12); wet(0.55); break;
      case 'leak': osc('square', 220, 110, 0.5, 0.1); osc('square', 208, 104, 0.5, 0.07, 0.05); break;
      // ---- building / UI
      case 'build':     // stone set down: thud and a little rubble
        noise('lowpass', 700, 110, 0.25, 0.45, 0.7, 0, 0.003);
        osc('sine', 125, 55, 0.2, 0.35, 0, 0.003);
        grains(4, 0.15, 1500, 3500, 0.12, 0.04);
        break;
      case 'sell':      // coins
        [2640, 3300, 2960].forEach((f, i) => { osc('sine', f, f * 1.01, 0.14, 0.07, i * 0.055, 0.002); osc('triangle', f * 1.5, f * 1.5, 0.08, 0.02, i * 0.055, 0.002); });
        break;
      case 'upgrade': [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, 0.2, 0.14, i * 0.06)); wet(0.3); break;
      case 'link': osc('sawtooth', 220, 1400, 0.16, 0.05); grains(5, 0.12, 3000, 7000, 0.12); break;
      case 'cleared': [392, 494, 587, 784].forEach((f, i) => osc('triangle', f, f, 0.4, 0.4, i * 0.11)); wet(0.35); break;
      case 'research': osc('sine', 880, 880, 0.12, 0.12); break;
      case 'complete': [659, 880, 1318].forEach((f, i) => osc('sine', f, f, 0.45, 0.12, i * 0.09)); wet(0.35); break;
      default:
        if (name.startsWith('spell_')) { osc('triangle', 300, 1200, 0.5, 0.12); noise('bandpass', 800, 3000, 0.6, 0.16); wet(0.45); }
    }
    live.push(t + end);
    this.voices.set(name, live);
  }
}
