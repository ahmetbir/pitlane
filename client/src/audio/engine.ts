// Race audio on roomkit's shell: the own car's engine (two detuned saws + a sub
// sine through a throttle-driven low-pass), tyre squeal (filtered noise from
// slip and lateral load), a quiet engine for the nearest two cars, and one-shot
// contact thumps. Every continuous parameter moves by setTargetAtTime.
import { AudioShell, type Voices } from "roomkit/audio/shell";

export const IDLE_RPM = 4000;
export const LIMIT_RPM = 13500;
export const HZ_MIN = 60;
export const HZ_MAX = 420;
export const SLIP_MIN = 0.12; // |vy| / max(|vx|, 5) below this: no squeal
export const SLIP_FULL = 0.45;
export const OTHERS = 2;
export const OTHER_RANGE_M = 120;

const SMOOTH_S = 0.04;
const thumpCooldownS = 0.12;
const wallDropMS = 5; // a one-frame speed loss above this is a wall hit

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/** Fundamental in Hz of an engine at rpm: idle → 60 Hz, limiter → 420 Hz. */
export function rpmToHz(rpm: number): number {
  return HZ_MIN + clamp01((rpm - IDLE_RPM) / (LIMIT_RPM - IDLE_RPM)) * (HZ_MAX - HZ_MIN);
}

/** Low-pass cutoff in Hz: opens with throttle, and a little with rpm. */
export function cutoffHz(throttle: number, rpm: number): number {
  return 500 + clamp01(throttle) * 2500 + clamp01((rpm - IDLE_RPM) / (LIMIT_RPM - IDLE_RPM)) * 800;
}

/** Engine loudness: a floor at idle, up to full throttle. */
export function engineGain(throttle: number): number {
  return 0.05 + clamp01(throttle) * 0.13;
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

/** Another car's engine pitch from its speed (rows carry no rpm). */
export function otherHz(speedMS: number): number {
  return Math.min(HZ_MAX * 0.8, HZ_MIN + Math.abs(speedMS) * 3.2);
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
  private saw: [OscillatorNode, OscillatorNode] | null = null;
  private sub: OscillatorNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private engine: GainNode | null = null;
  private squeal: GainNode | null = null;
  private band: BiquadFilterNode | null = null;
  private others: { osc: OscillatorNode; gain: GainNode }[] = [];
  private on = false;

  start(ctx: AudioContext, master: GainNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.engine = gain(ctx, 0);
    this.lp = filter(ctx, "lowpass", 500, 0.8);
    const a = osc(ctx, "sawtooth", HZ_MIN, 0);
    const b = osc(ctx, "sawtooth", HZ_MIN, 9);
    this.saw = [a, b];
    this.sub = osc(ctx, "sine", HZ_MIN / 2, 0);
    const subGain = gain(ctx, 0.6);
    a.connect(this.lp);
    b.connect(this.lp);
    this.sub.connect(subGain).connect(this.lp);
    this.lp.connect(this.engine).connect(master);

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.band = filter(ctx, "bandpass", 2000, 4);
    this.squeal = gain(ctx, 0);
    src.connect(this.band).connect(this.squeal).connect(master);
    src.start();

    for (let i = 0; i < OTHERS; i++) {
      const o = osc(ctx, "sawtooth", HZ_MIN, 0);
      const g = gain(ctx, 0);
      const f = filter(ctx, "lowpass", 700, 0.7);
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
    if (!c || !this.on || !this.saw || !this.sub || !this.lp || !this.engine || !this.squeal || !this.band) return;
    const t = c.currentTime;
    const hz = rpmToHz(own.rpm);
    for (const s of this.saw) smooth(s.frequency, hz, t);
    smooth(this.sub.frequency, hz / 2, t);
    smooth(this.lp.frequency, cutoffHz(throttle, own.rpm), t);
    smooth(this.engine.gain, engineGain(throttle), t);
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

function osc(ctx: AudioContext, type: OscillatorType, hz: number, cents: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
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
