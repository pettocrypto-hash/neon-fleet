import { onSettings, settings } from '../app/settings';

/**
 * Komplett per WebAudio erzeugter Sound: Synthwave-Soundtrack (Sequencer mit
 * Bass, Pad, Arpeggio, Drums) und Effekte. Keine Audiodateien nötig.
 */
export type Sfx =
  | 'click'
  | 'select'
  | 'fire'
  | 'hit'
  | 'miss'
  | 'sunk'
  | 'mine'
  | 'radar'
  | 'drone'
  | 'emp'
  | 'shield'
  | 'repair'
  | 'hologram'
  | 'jump'
  | 'turn'
  | 'win'
  | 'lose'
  | 'event'
  | 'combo'
  | 'place'
  | 'error'
  | 'salvo';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicOn = false;
  private nextNote = 0;
  private step = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private intensity = 0;

  constructor() {
    onSettings(() => this.applyVolumes());
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    if (this.musicOn) this.startScheduler();
    return ctx;
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.05);
    this.musicGain.gain.setTargetAtTime(settings.music * 0.55, t, 0.1);
    this.sfxGain.gain.setTargetAtTime(settings.sfx, t, 0.05);
  }

  /** 0 = Menü, 1 = Kampf (mehr Drums). */
  setIntensity(n: number) {
    this.intensity = n;
  }

  startMusic() {
    this.musicOn = true;
    if (this.ctx) this.startScheduler();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.schedTimer) clearInterval(this.schedTimer);
    this.schedTimer = null;
  }

  private startScheduler() {
    if (this.schedTimer || !this.ctx) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.schedTimer = setInterval(() => this.schedule(), 30);
  }

  // ---------- Bausteine ----------

  private osc(type: OscillatorType, freq: number, t: number, dur: number, gain: number, dest: AudioNode, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noise(t: number, dur: number, gain: number, dest: AudioNode, filter: BiquadFilterType, f0: number, f1?: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- Musik ----------

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    const bpm = 104;
    const sixteenth = 60 / bpm / 4;
    while (this.nextNote < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextNote, sixteenth);
      this.nextNote += sixteenth;
      this.step = (this.step + 1) % 256;
    }
  }

  private playStep(step: number, t: number, len: number) {
    const dest = this.musicGain;
    // Akkordfolge Am – F – C – G (je 1 Takt = 16 Schritte)
    const roots = [57, 53, 48, 55];
    const chords = [
      [0, 3, 7],
      [0, 4, 7],
      [0, 4, 7],
      [0, 4, 7],
    ];
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const root = roots[bar];
    const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

    // Bass: treibende Achtel
    if (s % 2 === 0) {
      const note = root - 24 + (s % 8 === 6 ? 12 : 0);
      const o = this.osc('sawtooth', mtof(note), t, len * 1.8, 0.11, this.lowpass(dest, 420 + 200 * Math.sin(step / 9)));
      o.detune.value = -5;
    }
    // Pad: Akkord zu Taktbeginn
    if (s === 0) {
      for (const iv of chords[bar]) {
        const p = this.osc('triangle', mtof(root + iv), t, len * 15, 0.035, dest);
        p.detune.value = 8;
      }
    }
    // Arpeggio
    if (s % 2 === 1 || this.intensity > 0) {
      const arp = chords[bar];
      const n = root + 12 + arp[(step >> (this.intensity > 0 ? 0 : 1)) % 3] + (s >= 8 ? 12 : 0);
      this.osc('square', mtof(n), t, len * 0.8, 0.018, this.lowpass(dest, 2400));
    }
    // Drums
    if (s % 4 === 0) {
      this.osc('sine', 120, t, 0.32, 0.4, dest, 38);
    }
    if (s === 4 || s === 12) this.noise(t, 0.18, 0.12, dest, 'bandpass', 1800, 900, 0.8);
    if (this.intensity > 0 || s % 4 === 2) this.noise(t, 0.04, s % 4 === 2 ? 0.05 : 0.025, dest, 'highpass', 8000);
  }

  private lowpass(dest: AudioNode, f: number) {
    const flt = this.ctx!.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = f;
    flt.Q.value = 6;
    flt.connect(dest);
    // Filter wird nach Ende der Quelle vom GC eingesammelt.
    return flt;
  }

  // ---------- Effekte ----------

  play(name: Sfx) {
    const ctx = this.ensure();
    if (!ctx || settings.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const d = this.sfxGain;
    switch (name) {
      case 'click':
        this.osc('square', 1200, t, 0.05, 0.05, d, 800);
        break;
      case 'select':
        this.osc('triangle', 660, t, 0.07, 0.08, d);
        this.osc('triangle', 990, t + 0.05, 0.08, 0.06, d);
        break;
      case 'place':
        this.osc('sine', 300, t, 0.1, 0.15, d, 180);
        this.noise(t, 0.05, 0.05, d, 'highpass', 4000);
        break;
      case 'error':
        this.osc('square', 180, t, 0.12, 0.06, d);
        this.osc('square', 140, t + 0.1, 0.15, 0.06, d);
        break;
      case 'fire':
        this.osc('sawtooth', 1800, t, 0.25, 0.12, d, 120);
        this.osc('square', 900, t, 0.18, 0.05, d, 60);
        break;
      case 'salvo':
        for (let i = 0; i < 3; i++) this.osc('sawtooth', 1600, t + i * 0.09, 0.2, 0.09, d, 140);
        break;
      case 'hit':
        this.noise(t, 0.5, 0.5, d, 'lowpass', 2400, 200);
        this.osc('sine', 140, t, 0.45, 0.45, d, 40);
        break;
      case 'miss':
        this.noise(t, 0.6, 0.18, d, 'bandpass', 600, 2400, 2);
        this.osc('sine', 500, t, 0.4, 0.05, d, 900);
        break;
      case 'sunk':
        this.noise(t, 1.4, 0.65, d, 'lowpass', 3000, 90);
        this.osc('sine', 90, t, 1.2, 0.55, d, 25);
        this.osc('sawtooth', 220, t + 0.1, 0.9, 0.08, d, 40);
        break;
      case 'mine':
        for (let i = 0; i < 3; i++) this.osc('square', 880, t + i * 0.12, 0.08, 0.08, d);
        this.noise(t + 0.36, 0.8, 0.5, d, 'lowpass', 1800, 100);
        this.osc('sine', 110, t + 0.36, 0.7, 0.4, d, 30);
        break;
      case 'radar':
        for (let i = 0; i < 3; i++) this.osc('sine', 1400, t + i * 0.22, 0.35, 0.08 / (i + 1), d, 1100);
        break;
      case 'drone':
        this.osc('sawtooth', 220, t, 0.7, 0.05, this.lowpass(d, 900), 330);
        this.osc('sine', 880, t + 0.5, 0.2, 0.07, d);
        break;
      case 'emp':
        this.osc('sawtooth', 60, t, 0.9, 0.15, this.lowpass(d, 1200), 400);
        this.noise(t, 0.9, 0.2, d, 'bandpass', 200, 4000, 4);
        break;
      case 'shield':
        [523, 659, 784, 1046].forEach((f, i) => this.osc('triangle', f, t + i * 0.06, 0.4, 0.06, d));
        break;
      case 'repair':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.osc('square', f, t + i * 0.07, 0.12, 0.04, d));
        break;
      case 'hologram':
        for (let i = 0; i < 6; i++) this.osc('sine', 1200 + Math.random() * 1200, t + i * 0.05, 0.25, 0.03, d);
        break;
      case 'jump':
        this.osc('sawtooth', 100, t, 0.35, 0.1, this.lowpass(d, 2000), 2000);
        this.osc('sine', 2000, t + 0.35, 0.35, 0.08, d, 120);
        this.noise(t + 0.3, 0.3, 0.15, d, 'highpass', 2000);
        break;
      case 'turn':
        this.osc('triangle', 880, t, 0.1, 0.07, d);
        this.osc('triangle', 1320, t + 0.09, 0.14, 0.07, d);
        break;
      case 'combo':
        [659, 784, 988, 1318].forEach((f, i) => this.osc('square', f, t + i * 0.07, 0.15, 0.05, d));
        break;
      case 'event':
        for (let i = 0; i < 4; i++) this.osc('sawtooth', i % 2 ? 660 : 880, t + i * 0.16, 0.14, 0.06, d);
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.osc('square', f, t + i * 0.12, 0.5, 0.06, d));
        [261, 329, 392].forEach((f) => this.osc('triangle', f, t + 0.6, 1.4, 0.07, d));
        break;
      case 'lose':
        [392, 349, 311, 261].forEach((f, i) => this.osc('sawtooth', f, t + i * 0.22, 0.4, 0.05, this.lowpass(d, 1400)));
        this.osc('sine', 130, t + 0.9, 1.2, 0.2, d, 50);
        break;
    }
  }
}

export const audio = new AudioEngine();
