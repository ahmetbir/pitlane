// Keyboard and gamepad input. Keyboard values slew toward their targets; a
// moving gamepad (standard mapping) overrides the keyboard for GAMEPAD_HOLD_S.
// Output is in wire units (th/br 0..100, st −127..127, left +, rv reverse).
//
// Keys come from the bindings (bindings.ts). The brake/reverse key drives the
// reverse gear while the car is stopped (|VX| ≤ STOPPED_VX) or already in
// reverse, and brakes otherwise (rolling forward, or backwards after a spin);
// the launch key held with the throttle while stopped holds the car on the
// brakes at full revs (car.ts launch), released it launches.
// Shift is a game key (the launch chord); Ctrl, Alt and Meta chords are the
// browser's and are ignored.

import { wireInput, type WireInput } from "../net/protocol.ts";
import { actionMap, defaultBindings, type Action, type Bindings } from "./bindings.ts";

const STEER_RISE = 3; // per second toward ±1
const STEER_RETURN = 5; // per second toward 0
/** Seconds a throttle key takes from 0 to full. */
export const THROTTLE_RAMP_S = 0.15;
const BRAKE_RAMP_S = 0.1;
const DEADZONE = 0.08;
const TRIGGER_DEADZONE = 0.05;
const MOVE_EPS = 0.02;
/** Seconds a gamepad keeps the car after its last movement. */
export const GAMEPAD_HOLD_S = 2;
/** At or below this speed (|VX|, m/s) the car counts as stopped: brake/reverse reverses, launch holds. */
export const STOPPED_VX = 0.5;

// Standard-mapping buttons.
const PAD_A = 0;
const PAD_B = 1;
const PAD_LT = 6;
const PAD_RT = 7;

export type PadLike = { mapping?: string; axes: readonly number[]; buttons: readonly { value: number; pressed?: boolean }[] } | null;

export type ControlsDeps = {
  /** Key events source (window). */
  target: { addEventListener(type: string, fn: (e: any) => void): void; removeEventListener(type: string, fn: (e: any) => void): void };
  getGamepads: () => ArrayLike<PadLike>;
  /** document: hidden state releases everything. */
  doc?: { hidden: boolean; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void };
  /** Seconds. */
  now: () => number;
  /** The key bindings (default: defaultBindings()). */
  bindings?: Bindings;
  /** The own car's forward speed VX (m/s); 0 before it is on track. */
  vx?: () => number;
  /** The own car's gear (0 = reverse); 1 before it is on track. */
  gear?: () => number;
  /**
   * True while a screen covers the race (the manual, the controls card):
   * the car gets neutral input and driving keys keep their browser default
   * (Space and the arrows scroll that screen). Only the help key still counts.
   */
  blocked?: () => boolean;
};

/** Keys whose browser default (scroll, help page) a game press must not trigger. */
const NO_DEFAULT = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1", "Tab", "Backspace", "Slash", "Quote"]);

function typing(t: unknown): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function rescale(v: number, dz: number): number {
  const a = Math.abs(v);
  if (!(a > dz)) return 0;
  return Math.sign(v) * Math.min((a - dz) / (1 - dz), 1);
}

export class Controls {
  // Held keys by the code that pressed them: a keyup releases what its keydown started,
  // whatever the bindings or the typed character say by then ("?" pressed, "/" released).
  private readonly keysDown = new Map<string, Action>();
  private readonly pressed = new Set<Action>(); // one-shot presses: camera, help
  private keys: Map<string, Action>;
  private th = 0;
  private br = 0;
  private st = 0;
  private padActiveUntil = -Infinity;
  private prev: number[] | null = null;
  private active: number; // seconds: the last key press or pad movement
  private readonly down = (e: KeyboardEvent) => {
    this.active = this.deps.now();
    this.key(e, true);
  };
  private readonly up = (e: KeyboardEvent) => this.key(e, false);
  private readonly blur = () => this.release();
  private readonly vis = () => { if (this.deps.doc?.hidden) this.release(); };

  private readonly deps: ControlsDeps;

  constructor(deps: ControlsDeps) {
    this.deps = deps;
    this.keys = actionMap(deps.bindings ?? defaultBindings());
    this.active = deps.now();
    deps.target.addEventListener("keydown", this.down);
    deps.target.addEventListener("keyup", this.up);
    deps.target.addEventListener("blur", this.blur);
    deps.doc?.addEventListener("visibilitychange", this.vis);
  }

  dispose(): void {
    this.deps.target.removeEventListener("keydown", this.down);
    this.deps.target.removeEventListener("keyup", this.up);
    this.deps.target.removeEventListener("blur", this.blur);
    this.deps.doc?.removeEventListener("visibilitychange", this.vis);
    this.release();
  }

  /** Seconds since the last key press or pad movement (or since touch). */
  idleS(): number {
    return this.deps.now() - this.active;
  }

  /** Restarts the idle clock (a race begins). */
  touch(): void {
    this.active = this.deps.now();
  }

  /** New bindings (the settings changed); held keys are released. */
  rebind(b: Bindings): void {
    this.keys = actionMap(b);
    this.release();
  }

  /** True once per camera key press. */
  cameraToggle(): boolean {
    return this.take("camera");
  }

  /** True once per press of a one-shot action (camera, help); clears it. */
  take(a: Action): boolean {
    return this.pressed.delete(a);
  }

  /** True while the look-back key is held. */
  get lookBack(): boolean {
    return this.holding("lookBack");
  }

  sample(dtS: number): WireInput {
    if (this.deps.blocked?.()) { // the car coasts; keys held under the screen do not count after it
      this.keysDown.clear();
      this.th = this.br = this.st = 0;
      return wireInput({ throttle: 0, brake: 0, steer: 0 });
    }
    const vx = this.deps.vx?.() ?? 0;
    const stopped = Math.abs(vx) <= STOPPED_VX;
    // Reverse: from a stop, or on in reverse; rolling either way out of gear R the key brakes.
    const canReverse = stopped || (this.deps.gear?.() === 0 && vx < STOPPED_VX);
    const pad = this.pollPad(stopped, canReverse);
    if (pad) {
      this.th = pad.th;
      this.br = pad.br;
      this.st = pad.st;
      return wireInput({ throttle: this.th, brake: this.br, steer: this.st, reverse: pad.rv });
    }
    const dt = Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    const go = this.holding("throttle");
    const back = this.holding("brakeReverse");
    // Throttle held, the brake/reverse key brakes (W+S stopped is a launch hold too).
    const reverse = back && canReverse && !go;
    const launch = go && stopped && this.holding("launch");
    const brake = this.holding("brake") || (back && !reverse) || launch;
    this.th = go || reverse ? Math.min(1, this.th + dt / THROTTLE_RAMP_S) : 0;
    this.br = brake ? Math.min(1, this.br + dt / BRAKE_RAMP_S) : 0;
    const dir = (this.holding("left") ? 1 : 0) - (this.holding("right") ? 1 : 0);
    const rate = dir === 0 ? STEER_RETURN : STEER_RISE;
    const d = dir * 1 - this.st;
    const step = rate * dt;
    this.st = Math.abs(d) <= step ? dir : this.st + Math.sign(d) * step;
    return wireInput({ throttle: this.th, brake: this.br, steer: this.st, reverse });
  }

  /** Whether any key of action a is down. */
  private holding(a: Action): boolean {
    for (const x of this.keysDown.values()) if (x === a) return true;
    return false;
  }

  private key(e: KeyboardEvent, isDown: boolean): void {
    if (!isDown) {
      this.keysDown.delete(e.code);
      return;
    }
    const a = this.keys.get(e.code) ?? (e.key === "?" ? "help" : undefined);
    if (!a) return;
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (this.deps.blocked?.()) {
      if (a !== "help") return;
      if (NO_DEFAULT.has(e.code)) e.preventDefault?.(); // F1: not the browser's help page
      if (!e.repeat) this.pressed.add(a);
      return;
    }
    if (NO_DEFAULT.has(e.code)) e.preventDefault?.();
    if ((a === "camera" || a === "help") && !this.holding(a)) this.pressed.add(a);
    this.keysDown.set(e.code, a);
  }

  private release(): void {
    this.keysDown.clear();
    this.pressed.clear();
    this.th = this.br = this.st = 0;
  }

  /**
   * The active pad's input, or null when no standard pad moved within
   * GAMEPAD_HOLD_S. B reverses at full throttle from a stop or in reverse
   * and brakes otherwise; A held with RT while stopped holds a launch.
   */
  private pollPad(stopped: boolean, canReverse: boolean): { th: number; br: number; st: number; rv: boolean } | null {
    const now = this.deps.now();
    let pad: PadLike = null;
    try {
      const pads = this.deps.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.mapping === "standard") { pad = p; break; }
      }
    } catch {
      pad = null;
    }
    if (!pad) {
      this.prev = null;
      this.padActiveUntil = -Infinity;
      return null;
    }
    const btn = (i: number) => pad.buttons[i]?.value ?? (pad.buttons[i]?.pressed ? 1 : 0);
    const cur = [pad.axes[0] ?? 0, btn(PAD_LT), btn(PAD_RT), btn(PAD_A), btn(PAD_B)].map((v) => (Number.isFinite(v) ? v : 0));
    const prev = this.prev ?? cur;
    this.prev = cur;
    const moved = Math.abs(cur[0]) > DEADZONE || cur.slice(1).some((v) => v > TRIGGER_DEADZONE)
      || cur.some((v, i) => Math.abs(v - prev[i]) > MOVE_EPS);
    if (moved) {
      this.padActiveUntil = now + GAMEPAD_HOLD_S;
      this.active = now;
    }
    if (now > this.padActiveUntil) return null;
    const rt = rescale(cur[2], TRIGGER_DEADZONE), lt = rescale(cur[1], TRIGGER_DEADZONE);
    const a = cur[3] > 0.5, b = cur[4] > 0.5;
    const rv = b && canReverse; // B: full reverse from a stop or in reverse, else the brake
    const launch = a && stopped && rt > 0 && !b;
    return {
      th: rv ? 1 : rt,
      br: launch || (b && !rv) ? 1 : lt,
      st: 0 - rescale(cur[0], DEADZONE), // stick right = +axis = negative st
      rv,
    };
  }
}

/** Controls on the browser's window and navigator; vx, gear: the own car's; blocked: a screen covers the race. */
export function browserControls(bindings: Bindings, vx: () => number, gear: () => number, blocked: () => boolean): Controls {
  return new Controls({
    target: window,
    doc: document,
    getGamepads: () => navigator.getGamepads(),
    now: () => performance.now() / 1000,
    bindings,
    vx,
    gear,
    blocked,
  });
}
