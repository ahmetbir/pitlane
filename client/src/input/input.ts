// Keyboard and gamepad input. Keyboard values slew toward their targets; a
// moving gamepad (standard mapping) overrides the keyboard for GAMEPAD_HOLD_S.
// Output is in wire units (th/br 0..100, st −127..127, left +).

import { wireInput, type WireInput } from "../net/protocol.ts";

const STEER_RISE = 3; // per second toward ±1
const STEER_RETURN = 5; // per second toward 0
const THROTTLE_RAMP_S = 0.15;
const BRAKE_RAMP_S = 0.1;
const DEADZONE = 0.08;
const BUTTON_EPS = 0.05;
const MOVE_EPS = 0.02;
const GAMEPAD_HOLD_S = 2;

export type PadLike = { axes: readonly number[]; buttons: readonly { value: number; pressed?: boolean }[] } | null;

export type ControlsDeps = {
  /** Key events source (window). */
  target: { addEventListener(type: string, fn: (e: any) => void): void; removeEventListener(type: string, fn: (e: any) => void): void };
  getGamepads: () => ArrayLike<PadLike>;
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

function rescale(v: number): number {
  const a = Math.abs(v);
  if (!(a > DEADZONE)) return 0;
  return Math.sign(v) * Math.min((a - DEADZONE) / (1 - DEADZONE), 1);
}

export class Controls {
  private readonly held = new Set<string>();
  private camPressed = false;
  private th = 0;
  private br = 0;
  private st = 0;
  private padActiveUntil = -Infinity;
  private prev: number[] = [];
  private readonly down = (e: KeyboardEvent) => this.key(e, true);
  private readonly up = (e: KeyboardEvent) => this.key(e, false);
  private readonly blur = () => this.release();

  private readonly deps: ControlsDeps;

  constructor(deps: ControlsDeps) {
    this.deps = deps;
    deps.target.addEventListener("keydown", this.down);
    deps.target.addEventListener("keyup", this.up);
    deps.target.addEventListener("blur", this.blur);
  }

  dispose(): void {
    this.deps.target.removeEventListener("keydown", this.down);
    this.deps.target.removeEventListener("keyup", this.up);
    this.deps.target.removeEventListener("blur", this.blur);
    this.release();
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
    const dt = Math.max(0, dtS);
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
    if (!k) return;
    if (isDown && typing(e.target)) return;
    if (isDown) {
      if (k === "cam" && !this.held.has(k)) this.camPressed = true;
      this.held.add(k);
    } else this.held.delete(k);
  }

  private release(): void {
    this.held.clear();
    this.th = this.br = this.st = 0;
  }

  /** The active pad's input, or null when no pad moved within GAMEPAD_HOLD_S. */
  private pollPad(): { th: number; br: number; st: number } | null {
    const now = this.deps.now();
    let pad: PadLike = null;
    const pads = this.deps.getGamepads();
    for (let i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }
    if (!pad) return null;
    const cur = [...pad.axes, ...pad.buttons.map((b) => b.value)];
    const moved = cur.some((v, i) => Math.abs(v - (this.prev[i] ?? 0)) > MOVE_EPS)
      || (pad.axes.some((a) => Math.abs(a) > DEADZONE) || pad.buttons.some((b) => b.value > BUTTON_EPS));
    this.prev = cur;
    if (moved) this.padActiveUntil = now + GAMEPAD_HOLD_S;
    if (now > this.padActiveUntil) return null;
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    return { th: rt, br: lt, st: 0 - rescale(pad.axes[0] ?? 0) }; // stick right = +axis = negative st
  }
}

/** Controls on the browser's window and navigator. */
export function browserControls(): Controls {
  return new Controls({
    target: window,
    getGamepads: () => navigator.getGamepads(),
    now: () => performance.now() / 1000,
  });
}
