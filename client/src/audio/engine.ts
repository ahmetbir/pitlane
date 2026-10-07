// Race audio on roomkit's shell: the own car's engine, a V10 (tyre squeal from
// filtered noise, a quiet engine for the nearest two cars, one-shot contact
// thumps). Every continuous parameter moves by setTargetAtTime.
//
// The V10 is voiced from its firing order: a four-stroke V10 fires five times
// per crank turn, so its note is rpm/12 Hz (333 Hz at idle, 1125 Hz at the
// limiter). Two banks of a bright harmonic wave a few cents apart beat against
// each other. Low in the revs the bank order (half the firing note) and the
// crank order (a fifth) give a heavy body, and slow noise on the banks' level
// makes the firing lumpy; both fade out as the revs climb. High in the revs a
// resonance riding at 2.5× the firing note lifts up to 12 dB: the scream. The
// mix is driven into a soft clipper (harder with throttle and revs: rasp on
// power, cleaner on the overrun) and low-passed, opening with throttle and revs.
import { AudioShell, type Voices } from "roomkit/audio/shell";

export const IDLE_RPM = 4000;
export const LIMIT_RPM = 13500;
/** Firing frequency at idle and at the limiter (rpm / 12: five firings per turn). */
export const HZ_MIN = IDLE_RPM / 12;
export const HZ_MAX = LIMIT_RPM / 12;
export const SLIP_MIN = 0.12; // |vy| / max(|vx|, 5) below this: no squeal
export const SLIP_FULL = 0.45;
export const OTHERS = 2;
export const OTHER_RANGE_M = 120;

const SMOOTH_S = 0.04;
const LUMP_DEPTH = 3; // × lowWeight: 30 Hz low-passed white noise is about ±0.1
const thumpCooldownS = 0.12;
const wallDropMS = 5; // a one-frame speed loss above this is a wall hit

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

const revs = (rpm: number): number => clamp01((rpm - IDLE_RPM) / (LIMIT_RPM - IDLE_RPM));

/** The V10's firing frequency in Hz at rpm (rpm/12), clamped to idle … limiter. */
export function rpmToHz(rpm: number): number {
  return HZ_MIN + revs(rpm) * (HZ_MAX - HZ_MIN);
}

/** Low-pass cutoff in Hz: opens with throttle, and with rpm. */
export function cutoffHz(throttle: number, rpm: number): number {
  return 1800 + clamp01(throttle) * 6000 + revs(rpm) * 6000;
}

/** Drive into the soft clipper: harder on power and high in the revs (rasp), clean on the overrun. */
export function driveOf(throttle: number, rpm = IDLE_RPM): number {
  return 0.9 + clamp01(throttle) * 2.6 + revs(rpm) * 0.8;
}

/** Engine loudness: a floor at idle and on the overrun, up with throttle and a little with revs. */
export function engineGain(throttle: number, rpm = IDLE_RPM): number {
  return 0.035 + clamp01(throttle) * 0.075 + revs(rpm) * 0.02;
}

/** Weight of the low orders (bank, crank) and of the lumpy firing: full at idle, gone at the limiter. */
export function lowWeight(rpm: number): number {
  const k = 1 - revs(rpm);
  return k * k;
}

/** The scream resonance: 2.5× the firing note (600 … 4500 Hz) and its lift in dB (2 → 12 with revs). */
export function screamHz(rpm: number): number {
  return Math.min(4500, Math.max(600, 2.5 * rpmToHz(rpm)));
}
export function screamDb(rpm: number): number {
  return 2 + 10 * revs(rpm);
}

export function slipOf(vx: number, vy: number): number {
  return Math.abs(vy) / Math.max(Math.abs(vx), 5);
}

/** Squeal gain 0 … SQUEAL_MAX from body velocity and yaw rate (vx·r is the lateral acceleration). */
export const SQUEAL_MAX = 0.22;
export function squealGain(vx: number, vy: number, r: number): number {
  if (Math.abs(vx) < 4) return 0;
  const slip = clamp01((slipOf(vx, vy) - SLIP_MIN) / (SLIP_FULL - SLIP_MIN));
  const load = 0.4 + 0.6 * clamp01(Math.abs(vx * r) / 25);
  return SQUEAL_MAX * slip * load;
}

/** Another car's engine note from its speed (rows carry no rpm): idle to 90 % of the limiter. */
export function otherHz(speedMS: number): number {
  const v = Math.abs(speedMS);
  return Math.min(HZ_MAX * 0.9, HZ_MIN + (Number.isFinite(v) ? v : 0) * 9);
}

/**
 * The V10 wave's harmonic amplitudes (index 1…N): a slow roll-off with the odd
 * harmonics lifted, which reads as rasp rather than buzz.
 */
export function v10Harmonics(n = 32): Float32Array {
  const a = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) a[k] = (k % 2 === 1 ? 1.3 : 1) / k ** 0.55;
  return a;
}

/** tanh soft-clip curve for the WaveShaper. */
export function clipCurve(n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1)) * 2 - 1) / Math.tanh(1);
  return c;
}

/** Distance attenuation of another car, 0 beyond OTHER_RANGE_M. */
export function otherGain(d: number): number {
  return d >= OTHER_RANGE_M ? 0 : 0.05 / (1 + (d / 25) ** 2);
}

export type Own = { vx: number; vy: number; r: number; rpm: number; x: number; z: number };
export type Other = { x: number; z: number; vx: number; vy: number };

/** The nearest `n` others within range, with their distance. */
export function nearest(own: { x: number; z: number }, others: readonly Other[], n = OTHERS): { o: Other; d: number }[] {
  const out: { o: Other; d: number }[] = [];
  for (const o of others) {
    const d = Math.hypot(o.x - own.x, o.z - own.z);
    if (d < OTHER_RANGE_M) out.push({ o, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}

type Param = Pick<AudioParam, "setTargetAtTime" | "value">;

/** The continuous voices; built by the shell once the context exists. */
export class CarAudio implements Voices {
  private ctx: AudioContext | null = null;
  private banks: [OscillatorNode, OscillatorNode] | null = null;
  private bank: OscillatorNode | null = null; // bank order: half the firing note
  private crank: OscillatorNode | null = null; // crank order: a fifth of it
  private bankGain: GainNode | null = null;
  private crankGain: GainNode | null = null;
  private lump: GainNode | null = null; // depth of the slow noise on the banks' level
  private scream: BiquadFilterNode | null = null;
  private drive: GainNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private engine: GainNode | null = null;
  private squeal: GainNode | null = null;
  private band: BiquadFilterNode | null = null;
  private others: { osc: OscillatorNode; gain: GainNode }[] = [];
  private on = false;

  start(ctx: AudioContext, master: GainNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    const h = v10Harmonics();
    const wave = ctx.createPeriodicWave(new Float32Array(h.length), h);
    this.engine = gain(ctx, 0);
    this.lp = filter(ctx, "lowpass", 1800, 0.7);
    this.scream = filter(ctx, "peaking", screamHz(IDLE_RPM), 1.4);
    this.scream.gain.value = screamDb(IDLE_RPM);
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve();
    shaper.oversample = "2x";
    this.drive = gain(ctx, driveOf(0));
    const a = osc(ctx, "sine", HZ_MIN, -4, wave);
    const b = osc(ctx, "sine", HZ_MIN, 4, wave);
    this.banks = [a, b];
    const banks = gain(ctx, 1); // its level wobbles by the lump
    a.connect(gain(ctx, 0.35)).connect(banks);
    b.connect(gain(ctx, 0.35)).connect(banks);
    banks.connect(this.drive);
    this.bank = osc(ctx, "sawtooth", HZ_MIN / 2, 0);
    this.crank = osc(ctx, "sine", HZ_MIN / 5, 0);
    this.bankGain = gain(ctx, 0.29);
    this.crankGain = gain(ctx, 0.55);
    this.bank.connect(this.bankGain).connect(this.drive);
    this.crank.connect(this.crankGain).connect(this.drive);
    const lumpSrc = ctx.createBufferSource();
    lumpSrc.buffer = noise;
    lumpSrc.loop = true;
    this.lump = gain(ctx, LUMP_DEPTH);
    lumpSrc.connect(filter(ctx, "lowpass", 30, 0.7)).connect(this.lump).connect(banks.gain);
    lumpSrc.start();
    this.drive.connect(shaper).connect(this.scream).connect(this.lp).connect(this.engine).connect(master);

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.band = filter(ctx, "bandpass", 2000, 4);
    this.squeal = gain(ctx, 0);
    src.connect(this.band).connect(this.squeal).connect(master);
    src.start();

    for (let i = 0; i < OTHERS; i++) {
      const o = osc(ctx, "sine", HZ_MIN, 0, wave);
      const g = gain(ctx, 0);
      const f = filter(ctx, "lowpass", 2500, 0.7);
      o.connect(f).connect(g).connect(master);
      this.others.push({ osc: o, gain: g });
    }
  }

  /** Voices sound only while on (the race screen). */
  setOn(on: boolean): void {
    this.on = on;
    if (!on) this.silence();
  }

  isOn(): boolean {
    return this.on;
  }

  /** One frame of the own car (and the others when drawn). */
  update(own: Own, throttle: number, others: readonly Other[]): void {
    const c = this.ctx;
    if (!c || !this.on || !this.banks || !this.bank || !this.crank || !this.bankGain || !this.crankGain || !this.lump || !this.scream
      || !this.drive || !this.lp || !this.engine || !this.squeal || !this.band) return;
    const t = c.currentTime;
    const rpm = own.rpm;
    const hz = rpmToHz(rpm);
    const low = lowWeight(rpm);
    for (const o of this.banks) smooth(o.frequency, hz, t);
    smooth(this.bank.frequency, hz / 2, t);
    smooth(this.crank.frequency, hz / 5, t);
    smooth(this.bankGain.gain, 0.04 + 0.25 * low, t);
    smooth(this.crankGain.gain, 0.05 + 0.5 * low, t);
    smooth(this.lump.gain, LUMP_DEPTH * low, t);
    smooth(this.scream.frequency, screamHz(rpm), t);
    smooth(this.scream.gain, screamDb(rpm), t);
    smooth(this.drive.gain, driveOf(throttle, rpm), t);
    smooth(this.lp.frequency, cutoffHz(throttle, rpm), t);
    smooth(this.engine.gain, engineGain(throttle, rpm), t);
    const sq = squealGain(own.vx, own.vy, own.r);
    smooth(this.squeal.gain, sq, t);
    smooth(this.band.frequency, 1800 + 1500 * clamp01(slipOf(own.vx, own.vy)), t);
    const near = nearest(own, others);
    this.others.forEach((v, i) => {
      const n = near[i];
      smooth(v.gain.gain, n ? otherGain(n.d) : 0, t);
      if (n) smooth(v.osc.frequency, otherHz(Math.hypot(n.o.vx, n.o.vy)), t);
    });
  }

  private silence(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    if (this.engine) smooth(this.engine.gain, 0, t);
    if (this.squeal) smooth(this.squeal.gain, 0, t);
    for (const v of this.others) smooth(v.gain.gain, 0, t);
  }
}

function smooth(p: Param, v: number, t: number): void {
  p.setTargetAtTime(v, t, SMOOTH_S);
}

function osc(ctx: AudioContext, type: OscillatorType, hz: number, cents: number, wave?: PeriodicWave): OscillatorNode {
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave);
  else o.type = type;
  o.frequency.value = hz;
  o.detune.value = cents;
  o.start();
  return o;
}

function gain(ctx: AudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function filter(ctx: AudioContext, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** What RaceAudio needs of the shell (the real AudioShell fits). */
export type Shell = Pick<AudioShell, "setVolume" | "tone" | "dispose">;

/** Volume setting 0…100 → master gain 0…1. */
export function volumeGain(setting: number): number {
  return clamp01(setting / 100);
}

/** One race session's sound: the shell, the voices and the thump triggers. */
export class RaceAudio {
  private readonly car = new CarAudio();
  private readonly shell: Shell;
  private lastSpeed = 0;
  private cooldown = 0;

  constructor(volume: number, mk: (v: Voices) => Shell = (v) => new AudioShell(v)) {
    this.shell = mk(this.car);
    this.shell.setVolume(volumeGain(volume));
  }

  setVolume(setting: number): void {
    this.shell.setVolume(volumeGain(setting));
  }

  /** Sound on while the race screen is up, off elsewhere. */
  setActive(on: boolean): void {
    if (this.car.isOn() === on) return;
    this.car.setOn(on);
    this.lastSpeed = 0;
  }

  /** Own damage or contact event. */
  contact(strength = 0.5): void {
    if (!this.car.isOn() || this.cooldown > 0) return;
    this.cooldown = thumpCooldownS;
    const g = 0.25 + 0.5 * clamp01(strength);
    this.shell.tone("sine", 110, 38, 0.22, g);
  }

  /** The own jump-start penalty: a low double buzz. */
  penalty(): void {
    if (!this.car.isOn()) return;
    this.shell.tone("square", 220, 220, 0.18, 0.3);
    this.shell.tone("square", 165, 165, 0.34, 0.3);
  }

  /** Per frame while the race screen is up. */
  frame(dt: number, own: Own, throttle: number, others: readonly Other[]): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const speed = Math.hypot(own.vx, own.vy);
    const drop = this.lastSpeed - speed;
    this.lastSpeed = speed;
    if (dt > 0 && dt < 0.1 && drop > wallDropMS) this.contact(drop / 20);
    this.car.update(own, throttle, others);
  }

  dispose(): void {
    this.car.setOn(false);
    this.shell.dispose();
  }
}
