// audio.js — every sound in Palmera Heat is synthesized with WebAudio.
// No audio files exist; engines, sirens, gunfire and the score are all
// oscillators and filtered noise shaped in code.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = 0;
    this.chordStep = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  tone(freq, dur, type, vol, slideTo, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, vol, filterFreq, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  punch() { this.noise(0.08, 0.5, 700); this.tone(120, 0.08, 'sine', 0.4, 60); }
  hurt() { this.tone(220, 0.12, 'square', 0.25, 110); }
  shot() { this.noise(0.14, 0.7, 3200); this.tone(160, 0.1, 'sawtooth', 0.3, 40); }
  dryFire() { this.tone(1200, 0.03, 'square', 0.15); }
  hitCar() { this.noise(0.2, 0.6, 500); this.tone(70, 0.22, 'sine', 0.5, 35); }
  glass() { this.noise(0.25, 0.35, 5200); this.tone(2400, 0.18, 'triangle', 0.12, 900); }
  door() { this.tone(180, 0.07, 'sine', 0.3, 90); this.noise(0.05, 0.2, 900, 0.02); }
  cash() { this.tone(1320, 0.09, 'triangle', 0.3); this.tone(1760, 0.14, 'triangle', 0.3, null, 0.07); }
  phone() { this.tone(1046, 0.12, 'sine', 0.25); this.tone(1046, 0.12, 'sine', 0.25, null, 0.18); }
  sting() {
    this.tone(392, 0.16, 'triangle', 0.35);
    this.tone(523, 0.16, 'triangle', 0.35, null, 0.13);
    this.tone(659, 0.3, 'triangle', 0.4, null, 0.26);
  }
  fail() { this.tone(330, 0.2, 'sawtooth', 0.25, 220); this.tone(220, 0.35, 'sawtooth', 0.25, 147, 0.16); }
  sirenBlip() { this.tone(880, 0.14, 'triangle', 0.2, 660); }

  // One entry point for the game's event system: sfx('shot'), sfx('cash')…
  sfx(name) {
    const table = {
      punch: this.punch, hurt: this.hurt, shot: this.shot, dryFire: this.dryFire,
      hitCar: this.hitCar, glass: this.glass, door: this.door, cash: this.cash,
      phone: this.phone, sting: this.sting, fail: this.fail, sirenBlip: this.sirenBlip,
    };
    const fn = table[name];
    if (fn) fn.call(this);
  }

  // A looping engine note whose pitch follows the car's speed.
  engine(on, speedRatio, dt) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      const target = on ? 0.05 + speedRatio * 0.05 : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
      this.engineOsc.frequency.setTargetAtTime(55 + speedRatio * 165, this.ctx.currentTime, 0.06);
      if (!on && this.engineGain.gain.value < 0.004) {
        this.engineOsc.stop();
        this.engineOsc = null;
        this.engineGain = null;
      }
    }
  }

  // A two-tone police siren that swells while officers are close.
  siren(level, dt) {
    if (!this.ctx) return;
    if (level > 0.02 && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
    }
    if (this.sirenOsc) {
      const t = this.ctx.currentTime;
      const wail = 720 + Math.sin(t * 4.4) * 190;
      this.sirenOsc.frequency.setTargetAtTime(wail, t, 0.03);
      this.sirenGain.gain.setTargetAtTime(Math.min(0.11, level * 0.11), t, 0.15);
      if (level <= 0.02 && this.sirenGain.gain.value < 0.004) {
        this.sirenOsc.stop();
        this.sirenOsc = null;
        this.sirenGain = null;
      }
    }
  }

  // A slow neon-noir pad: minor chords breathing under the city.
  music(dt, active) {
    if (!this.ctx || !active) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 3.6;
    const chords = [
      [110.0, 164.8, 261.6],   // Am
      [87.3, 130.8, 220.0],    // F
      [98.0, 146.8, 246.9],    // G
      [110.0, 164.8, 220.0],   // Am (open)
    ];
    const chord = chords[this.chordStep % chords.length];
    this.chordStep++;
    for (const f of chord) {
      this.tone(f, 3.4, 'sine', 0.045);
      this.tone(f * 2, 3.4, 'triangle', 0.014);
    }
  }
}
