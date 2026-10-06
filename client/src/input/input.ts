// Keyboard and gamepad input. Keyboard values slew toward their targets; a
// moving gamepad (standard mapping) overrides the keyboard for GAMEPAD_HOLD_S.
// Output is in wire units (th/br 0..100, st −127..127, left +).

import { wireInput, type WireInput } from "../net/protocol.ts";

const STEER_RISE = 3; // per second toward ±1
const STEER_RETURN = 5; // per second toward 0
const THROTTLE_RAMP_S = 0.15;
const BRAKE_RAMP_S = 0.1;
const DEADZONE = 0.08;
const TRIGGER_DEADZONE = 0.05;
const MOVE_EPS = 0.02;
const GAMEPAD_HOLD_S = 2;

export type PadLike = { mapping?: string; axes: readonly number[]; buttons: readonly { value: number; pressed?: boolean }[] } | null;

export type ControlsDeps = {
  /** Key events source (window). */
  target: { addEventListener(type: string, fn: (e: any) => void): void; removeEventListener(type: string, fn: (e: any) => void): void };
  getGamepads: () => ArrayLike<PadLike>;
  /** document: hidden state releases everything. */
  doc?: { hidden: boolean; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void };
  /** Seconds. */
  now: () => number;
};

const CODES: Record<string, "up" | "down" | "left" | "right" | "cam" | "back"> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyC: "cam", KeyR: "back",
};

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
  private readonly held = new Set<string>();
  private camPressed = false;
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

  /** True once per C press. */
  cameraToggle(): boolean {
    const p = this.camPressed;
    this.camPressed = false;
    return p;
  }

  /** True while R is held. */
  get lookBack(): boolean {
    return this.held.has("back");
  }

  sample(dtS: number): WireInput {
    const pad = this.pollPad();
    if (pad) {
      this.th = pad.th;
      this.br = pad.br;
      this.st = pad.st;
      return wireInput({ throttle: this.th, brake: this.br, steer: this.st });
    }
    const dt = Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    this.th = this.held.has("up") ? Math.min(1, this.th + dt / THROTTLE_RAMP_S) : 0;
    this.br = this.held.has("down") ? Math.min(1, this.br + dt / BRAKE_RAMP_S) : 0;
    const dir = (this.held.has("left") ? 1 : 0) - (this.held.has("right") ? 1 : 0);
    const rate = dir === 0 ? STEER_RETURN : STEER_RISE;
    const d = dir * 1 - this.st;
    const step = rate * dt;
    this.st = Math.abs(d) <= step ? dir : this.st + Math.sign(d) * step;
    return wireInput({ throttle: this.th, brake: this.br, steer: this.st });
  }

  private key(e: KeyboardEvent, isDown: boolean): void {
    const k = CODES[e.code];
    const space = e.code === "Space";
    if (!k && !space) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (isDown && (mod || typing(e.target))) return;
    if (isDown && !e.shiftKey && (space || e.code.startsWith("Arrow"))) e.preventDefault?.();
    if (!k) return;
    if (isDown) {
      if (k === "cam" && !this.held.has(k)) this.camPressed = true;
      this.held.add(k);
    } else this.held.delete(k);
  }

  private release(): void {
    this.held.clear();
    this.th = this.br = this.st = 0;
  }

  /** The active pad's input, or null when no standard pad moved within GAMEPAD_HOLD_S. */
  private pollPad(): { th: number; br: number; st: number } | null {
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
    const cur = [pad.axes[0] ?? 0, pad.buttons[6]?.value ?? 0, pad.buttons[7]?.value ?? 0].map((v) => (Number.isFinite(v) ? v : 0));
    const prev = this.prev ?? cur;
    this.prev = cur;
    const moved = Math.abs(cur[0]) > DEADZONE || cur[1] > TRIGGER_DEADZONE || cur[2] > TRIGGER_DEADZONE
      || cur.some((v, i) => Math.abs(v - prev[i]) > MOVE_EPS);
    if (moved) {
      this.padActiveUntil = now + GAMEPAD_HOLD_S;
      this.active = now;
    }
    if (now > this.padActiveUntil) return null;
    return {
      th: rescale(cur[2], TRIGGER_DEADZONE),
      br: rescale(cur[1], TRIGGER_DEADZONE),
      st: 0 - rescale(cur[0], DEADZONE), // stick right = +axis = negative st
    };
  }
}

/** Controls on the browser's window and navigator. */
export function browserControls(): Controls {
  return new Controls({
    target: window,
    doc: document,
    getGamepads: () => navigator.getGamepads(),
    now: () => performance.now() / 1000,
  });
}
