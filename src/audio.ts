/** Volume steps offered in Settings, as linear gains. */
export const VOLUME_STEPS = [0.35, 0.7, 1] as const;

/** Engine hum for a speed: pitch and loudness rise with |v| / top speed; silent when stopped. */
export function engineParams(speed: number, topSpeed: number): { freq: number; gain: number } {
  const t = Math.min(1, Math.abs(speed) / Math.max(0.01, topSpeed));
  if (t < 0.02) return { freq: 55, gain: 0 };
  return { freq: 55 + 70 * t, gain: 0.03 + 0.05 * t };
}

/** Win jingle notes (Hz): a rising arpeggio that gains a note, then a high flourish, per star. */
export function winNotes(stars: number): number[] {
  const s = Math.max(1, Math.min(3, Math.round(stars) || 1));
  const base = [523, 659, 784, 1047, 1319, 1568];
  return base.slice(0, 2 + s * 1).concat(s === 3 ? [2093] : []);
}

const MUSIC_NOTES = [220, 261.6, 329.6, 392, 329.6, 261.6]; // soft A-minor arpeggio

/** Tiny WebAudio synth for beeps and bumps; no asset files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;
  /** Linear gains, 0..1, for effects (and engine) and for music. */
  sfxVolume = 0.7;
  musicVolume = 0.7;
  musicOn = true;
  private crashBuf: AudioBuffer | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private engine: { osc: OscillatorNode; gain: GainNode } | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicWanted = false;

  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      this.recover();
      this.buses();
    } catch {
      this.ctx = null;
      this.crashBuf = null;
      this.sfxBus = this.musicBus = null;
      this.engine = null;
    }
  }

  private buses(): void {
    const ctx = this.ctx;
    if (!ctx || this.sfxBus) return;
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(ctx.destination);
    this.applyVolumes();
  }

  /** Push the volume fields to the buses; call after changing them. */
  applyVolumes(): void {
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume;
    if (this.muted) this.stopEngine();
    if (this.muted || !this.musicOn) this.clearMusicTimer();
    else if (this.musicWanted) this.startMusic();
  }

  private get out(): AudioNode | null {
    return this.sfxBus ?? this.ctx?.destination ?? null;
  }

  /** Drive the engine hum from the car's speed (m/s). Call every frame while playing. */
  setEngine(speed: number, topSpeed: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running' || !this.sfxBus) return;
    const p = engineParams(speed, topSpeed);
    if (!this.engine) {
      if (p.gain === 0) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfxBus);
      osc.start();
      this.engine = { osc, gain };
    }
    const t = ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(p.freq, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(p.gain, t, 0.08);
  }

  /** Silence and release the engine hum (level over, paused, muted). */
  stopEngine(): void {
    const e = this.engine;
    this.engine = null;
    if (!e) return;
    try {
      e.gain.gain.value = 0;
      e.osc.stop();
      e.osc.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** Start the background music loop (a no-op when music or sound is off). */
  startMusic(): void {
    this.musicWanted = true;
    if (this.muted || !this.musicOn || this.musicTimer || !this.ctx) return;
    this.musicTimer = window.setInterval(() => this.musicTick(), 600);
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.clearMusicTimer();
  }

  private clearMusicTimer(): void {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  private musicTick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.musicBus) return;
    const f = MUSIC_NOTES[this.musicStep++ % MUSIC_NOTES.length];
    this.tone(f, 1.4, 'sine', 0.05, 0, undefined, this.musicBus);
    if (this.musicStep % MUSIC_NOTES.length === 1) this.tone(f / 2, 3.6, 'triangle', 0.04, 0, undefined, this.musicBus);
  }

  /** iOS reports 'interrupted' after a call or lock screen; anything not running or closed is resumable. */
  private recover(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume();
  }

  /** Silence everything while the app is in the background. */
  suspend(): void {
    this.stopEngine();
    try {
      if (this.ctx?.state === 'running') void this.ctx.suspend();
    } catch {
      /* ignore */
    }
  }

  /** Undo suspend() when the app returns to the foreground. */
  resume(): void {
    try {
      this.recover();
    } catch {
      /* ignore */
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0,
    endFreq?: number,
    dest: AudioNode | null = this.out,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !dest || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep(): void {
    this.tone(1250, 0.07, 'square', 0.05);
  }

  click(): void {
    this.tone(700, 0.05, 'triangle', 0.08);
  }

  crash(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    if (!this.crashBuf || this.crashBuf.sampleRate !== ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      this.crashBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.crashBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src
      .connect(filter)
      .connect(gain)
      .connect(this.out ?? ctx.destination);
    src.start();
    this.tone(120, 0.2, 'sine', 0.3, 0, 50);
  }

  /** Win jingle; a longer, higher one for more stars. */
  win(stars = 1): void {
    this.stopEngine();
    winNotes(stars).forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.1));
  }

  /** Fail sting: a falling minor pair after the crash thud, or alone for a timeout. */
  fail(): void {
    this.stopEngine();
    this.tone(330, 0.35, 'sawtooth', 0.07, 0.25, 220);
    this.tone(247, 0.6, 'sawtooth', 0.07, 0.55, 98);
  }
}
