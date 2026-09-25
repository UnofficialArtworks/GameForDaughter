// Tiny synthesized audio: pet voice, foley, UI sounds and a gentle generative tune.
// Nothing plays until the first user gesture unlocks the AudioContext.
import { rand, pick } from './util';

export class AudioManager {
  ctx: AudioContext | null = null;
  master!: GainNode; music!: GainNode; sfx!: GainNode;
  noise!: AudioBuffer;
  private purrSrc: AudioBufferSourceNode | null = null;
  private purrGain: GainNode | null = null;
  private musicTimer = 0;
  private nextNote = 0;
  private beatN = 0;
  musicVol = 0.5; sfxVol = 0.8;
  voicePitch = 1;
  private lastStep = 0;
  night = false;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.music = c.createGain(); this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.setVolumes(this.musicVol, this.sfxVol);
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setVolumes(m: number, s: number) {
    this.musicVol = m; this.sfxVol = s;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(m * 0.16, this.ctx.currentTime, 0.1);
    this.sfx.gain.setTargetAtTime(s * 0.7, this.ctx.currentTime, 0.05);
  }

  suspend(v: boolean) {
    if (!this.ctx) return;
    if (v) this.ctx.suspend(); else this.ctx.resume();
  }

  private ok() { return this.ctx && this.ctx.state === 'running' && this.sfxVol > 0; }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, dest?: AudioNode) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  private noiseBurst(dur: number, freq: number, q: number, vol: number, delay = 0, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, rand(0, 1)); s.stop(t + dur + 0.05);
  }

  // ---------- pet voice ----------
  /** A single chirp/mew. kind shapes the melody. */
  voice(kind: 'happy' | 'question' | 'sleepy' | 'excited' | 'giggle' | 'hmm' | 'yawn' | 'coo' | 'sad' | 'surprise' = 'happy') {
    if (!this.ok()) return;
    const p = 520 * this.voicePitch * rand(0.95, 1.05);
    const v = 0.22;
    const chirp = (f0: number, f1: number, d: number, delay = 0) => {
      const o = this.tone(f0, d, 'triangle', v, f1, delay);
      const lfo = this.ctx!.createOscillator(); const lg = this.ctx!.createGain();
      lfo.frequency.value = 18; lg.gain.value = f0 * 0.03; lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(this.ctx!.currentTime + delay); lfo.stop(this.ctx!.currentTime + delay + d + 0.05);
      this.tone(f0 * 2, d * 0.8, 'sine', v * 0.25, f1 * 2, delay);
    };
    switch (kind) {
      case 'happy': chirp(p, p * 1.35, 0.12); chirp(p * 1.2, p * 1.6, 0.14, 0.13); break;
      case 'question': chirp(p * 0.9, p * 1.5, 0.22); break;
      case 'sleepy': chirp(p * 0.9, p * 0.6, 0.35); break;
      case 'yawn': chirp(p * 0.8, p * 1.1, 0.25); chirp(p * 1.1, p * 0.55, 0.45, 0.25); break;
      case 'excited': for (let i = 0; i < 4; i++) chirp(p * (1 + i * 0.12), p * (1.4 + i * 0.12), 0.08, i * 0.09); break;
      case 'giggle': for (let i = 0; i < 5; i++) chirp(p * 1.3, p * 1.1, 0.06, i * 0.075); break;
      case 'hmm': chirp(p * 0.8, p * 0.75, 0.25); break;
      case 'coo': chirp(p * 0.85, p * 1.0, 0.3); break;
      case 'sad': chirp(p, p * 0.7, 0.3); break;
      case 'surprise': chirp(p * 1.1, p * 1.9, 0.12); break;
    }
  }

  purr(level: number) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (level > 0.01 && !this.purrSrc) {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
      const g = c.createGain(); g.gain.value = 0;
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.frequency.value = 24; const lg = c.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(am.gain);
      s.connect(f); f.connect(am); am.connect(g); g.connect(this.sfx);
      s.start(); lfo.start();
      this.purrSrc = s; this.purrGain = g;
    }
    if (this.purrGain) this.purrGain.gain.setTargetAtTime(Math.min(1, level) * 1.4, c.currentTime, 0.15);
    if (level <= 0.01 && this.purrSrc && this.purrGain && this.purrGain.gain.value < 0.01) {
      this.purrSrc.stop(); this.purrSrc = null; this.purrGain = null;
    }
  }

  // ---------- foley ----------
  crunch() { if (!this.ok()) return; for (let i = 0; i < 3; i++) this.noiseBurst(0.05, rand(1500, 2800), 2, 0.35, i * 0.09); }
  slurp() { if (!this.ok()) return; for (let i = 0; i < 3; i++) this.tone(rand(300, 420), 0.06, 'sine', 0.12, 700, i * 0.12); }
  squeak() { if (!this.ok()) return; this.tone(1300, 0.08, 'square', 0.05, 1900); this.tone(1900, 0.1, 'sine', 0.2, 1200, 0.07); }
  pop() { if (!this.ok()) return; this.tone(rand(700, 1000), 0.07, 'sine', 0.3, 1800); }
  boing() { if (!this.ok()) return; this.tone(180, 0.18, 'sine', 0.3, 420); }
  thud() { if (!this.ok()) return; this.tone(110, 0.12, 'sine', 0.35, 60); }
  splash() { if (!this.ok()) return; this.noiseBurst(0.4, 1800, 0.8, 0.35); this.noiseBurst(0.25, 3500, 1, 0.2, 0.1); }
  brush() { if (!this.ok()) return; this.noiseBurst(0.12, 4200, 1.5, 0.12); }
  scrub() { if (!this.ok()) return; this.noiseBurst(0.08, 2500, 3, 0.12); }
  dig() { if (!this.ok()) return; this.noiseBurst(0.12, 900, 1.2, 0.3); }
  sniff() { if (!this.ok()) return; this.noiseBurst(0.05, 3000, 4, 0.12); this.noiseBurst(0.05, 3200, 4, 0.12, 0.1); }
  sneeze() { if (!this.ok()) return; this.voice('surprise'); this.noiseBurst(0.18, 2500, 0.8, 0.45, 0.35); this.tone(700, 0.12, 'triangle', 0.2, 400, 0.35); }
  hic() { if (!this.ok()) return; this.tone(900, 0.07, 'triangle', 0.25, 1300); }
  step() { if (!this.ok()) return; const t = performance.now(); if (t - this.lastStep < 180) return; this.lastStep = t; this.tone(rand(140, 180), 0.04, 'sine', 0.05, 90); }
  whoosh() { if (!this.ok()) return; this.noiseBurst(0.25, 1200, 0.7, 0.18); }
  shake() { if (!this.ok()) return; for (let i = 0; i < 6; i++) this.noiseBurst(0.06, 2500, 1, 0.2, i * 0.06); }
  // ---------- outdoors (Walkies) ----------
  chirp() { if (!this.ok()) return; const f = rand(2400, 3400); for (let i = 0; i < 2 + Math.floor(rand(0, 3)); i++) this.tone(f * rand(0.9, 1.1), 0.08, 'sine', 0.05, f * 1.35, i * 0.13); }
  cricket() { if (!this.ok()) return; for (let i = 0; i < 4; i++) this.tone(4200, 0.03, 'triangle', 0.025, 4000, i * 0.07); }
  breeze() { if (!this.ok()) return; this.noiseBurst(1.4, 500, 0.4, 0.06, 0, 'lowpass'); }
  rustle() { if (!this.ok()) return; for (let i = 0; i < 4; i++) this.noiseBurst(0.09, rand(2500, 4500), 1.2, 0.14, i * 0.07); }
  plop() { if (!this.ok()) return; this.tone(500, 0.12, 'sine', 0.18, 180); this.noiseBurst(0.1, 2000, 1, 0.08); }
  hoot() { if (!this.ok()) return; this.tone(420, 0.35, 'sine', 0.12, 380); this.tone(420, 0.5, 'sine', 0.12, 360, 0.5); }
  highfive() { if (!this.ok()) return; this.noiseBurst(0.08, 2000, 0.8, 0.5); this.chime(); }
  // ---------- UI ----------
  click() { if (!this.ok()) return; this.tone(880, 0.05, 'sine', 0.15, 1100); }
  open() { if (!this.ok()) return; this.tone(660, 0.1, 'sine', 0.15, 990); }
  chime() { if (!this.ok()) return; [0, 4, 7].forEach((s, i) => this.tone(880 * Math.pow(2, s / 12), 0.35, 'sine', 0.15, undefined, i * 0.07)); }
  reward() { if (!this.ok()) return; [0, 4, 7, 12].forEach((s, i) => this.tone(784 * Math.pow(2, s / 12), 0.4, 'triangle', 0.14, undefined, i * 0.08)); }
  fanfare() { if (!this.ok()) return; [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.35, 'triangle', 0.16, undefined, i * 0.11)); }

  // ---------- music ----------
  private startMusic() {
    if (!this.ctx) return;
    this.nextNote = this.ctx.currentTime + 0.3;
    clearInterval(this.musicTimer);
    this.musicTimer = window.setInterval(() => this.schedule(), 120);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.musicVol <= 0) { if (c) this.nextNote = c.currentTime + 0.2; return; }
    const beat = this.night ? 0.62 : 0.42;
    // C major pentatonic, progression I - vi - IV - V
    const chords = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    while (this.nextNote < c.currentTime + 0.5) {
      const bar = Math.floor(this.beatN / 8) % 4;
      const inBar = this.beatN % 8;
      const root = 261.63;
      if (inBar === 0) {
        for (const s of chords[bar]) this.pad(root * 0.5 * Math.pow(2, s / 12), beat * 7.5, this.nextNote);
      }
      const play = this.night ? inBar % 2 === 0 && Math.random() < 0.7 : Math.random() < 0.72;
      if (play) {
        const s = pick(scale);
        this.pluck(root * Math.pow(2, s / 12), this.nextNote);
      }
      this.nextNote += beat;
      this.beatN++;
    }
  }

  private pad(freq: number, dur: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.1);
  }
  private pluck(freq: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g = c.createGain(); const g2 = c.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.music);
    o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
  }
}
