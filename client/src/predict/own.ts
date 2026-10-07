// Client-side prediction of the own car: roomkit's Reconciler over the car
// model plus the barrier (race/world.ts moveCar). The server's other contact
// (cars, kerbs it resolves after moveCar) arrives only as corrections; its
// damage arrives as the welcome's and "dmg" messages (×1000, so Params are
// within 0.05 % of the server's). Each input's live setup values (lv: brake
// bias, diff, TC, ABS) apply on top of the configured setup in the step that
// replays that input, as the server applies them on the tick it consumes it.
//
// A snapshot row carries less than car.State: hx, hz are rebuilt from h; ax
// and rpm are kept from the prediction (rpm is recomputed by the next step,
// ax only weights load transfer); the gear is the predicted one run through
// the gearbox's own shift rule at the snapshot speed, so a corrected state
// never sits in a gear the gearbox would not hold there; reverse (gear 0)
// is kept while the car is still slower than the reverse engage speed, so
// the HUD never flashes "1" while backing up. Snapshots are
// quantised, so after a correction prediction converges on the server
// instead of matching it bit for bit.

import { Reconciler, type Model, type Smoother } from "roomkit/predict/reconcile";
import { newParams, withLive, type Damage, type Handling, type Params, type Setup, type State } from "../car/car.ts";
import { carInput, type CarRow, type WireInput } from "../net/protocol.ts";
import { moveCar } from "../race/world.ts";
import type { Track } from "../track/track.ts";

const SMOOTH_S = 0.1; // visual correction time constant
const SNAP_M = 8;     // larger corrections are drawn at once

// Gearbox thresholds of car.step.
const SHIFT_UP = 12800;
const SHIFT_DOWN = 8000;
const REV_ENGAGE = 0.5; // car.step keeps the reverse gear (0) below this VX

/** The predicted car: its state plus the seg hint moveCar carries between steps. */
export type OwnState = State & { seg: number };

/** What a step needs from the room: whether cars move (lights, racing, finish). */
export type OwnEnv = { running: boolean };

const INTACT: Damage = { frontWing: 0, rearWing: 0, susp: 0 };

/** a − b wrapped to (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Drawn − physics position and heading, fading with SMOOTH_S; jumps above SNAP_M are not smoothed. */
class CarSmoother implements Smoother<OwnState> {
  private dx = 0;
  private dz = 0;
  private dh = 0;

  rebase(prev: OwnState, to: OwnState): void {
    this.dx += prev.x - to.x;
    this.dz += prev.z - to.z;
    this.dh += angleDiff(prev.h, to.h);
    if (Math.hypot(this.dx, this.dz) > SNAP_M || !Number.isFinite(this.dx + this.dz + this.dh)) this.reset();
  }

  draw(s: OwnState, dtS: number): OwnState {
    const k = Math.exp(-dtS / SMOOTH_S);
    this.dx *= k;
    this.dz *= k;
    this.dh *= k;
    if (this.dx === 0 && this.dz === 0 && this.dh === 0) return s;
    const h = s.h + this.dh;
    return { ...s, x: s.x + this.dx, z: s.z + this.dz, h, hx: Math.cos(h), hz: Math.sin(h) };
  }

  reset(): void {
    this.dx = this.dz = this.dh = 0;
  }
}

function blank(): OwnState {
  return { x: 0, z: 0, h: 0, hx: 1, hz: 0, vx: 0, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 1, ax: 0, launch: false, dmg: { ...INTACT }, seg: -1 };
}

export class Own {
  private readonly track: Track;
  private handling: Handling;
  private setup: Setup;
  private dmg: Damage = { ...INTACT };
  private params: Params;
  private liveKey = ""; // the lv liveParams were built for, "" = none
  private liveParams: Params;
  private hard = false; // the next reconcile is drawn at once (marshal reset)
  private readonly smoother = new CarSmoother();
  private readonly r: Reconciler<OwnState, WireInput, OwnEnv>;

  constructor(track: Track, handling: Handling, setup: Setup) {
    this.track = track;
    this.handling = handling;
    this.setup = setup;
    this.params = newParams(handling, setup, this.dmg);
    this.liveParams = this.params;
    const model: Model<OwnState, WireInput, OwnEnv> = { step: (s, w, env) => this.step(s, w, env) };
    this.r = new Reconciler(model, this.smoother, blank());
  }

  /** Room handling and the setup the server holds for this car (welcome, then each accepted ready). */
  configure(handling: Handling, setup: Setup): void {
    this.handling = handling;
    this.setup = setup;
    this.rebuild();
  }

  /** The car's damage as the server holds it (welcome, "dmg"). */
  damage(d: Damage): void {
    if (d.frontWing === this.dmg.frontWing && d.rearWing === this.dmg.rearWing && d.susp === this.dmg.susp) return;
    this.dmg = { ...d };
    this.rebuild();
  }

  /**
   * The server moved the car (marshal reset): the correction in progress and
   * the next one are drawn at once instead of fading. The reset message may
   * arrive after the snapshot that carries the new pose, or before it.
   */
  teleported(): void {
    this.smoother.reset();
    this.hard = true;
  }

  /** Hard reset on the first snapshot of a seat: no smoothing, no pending inputs. */
  reset(row: CarRow, tick: number, ack: number): void {
    this.hard = false;
    this.r.reset(this.fromRow(row, blank()), tick, ack);
  }

  /** Records sent input seq and predicts one tick. */
  push(seq: number, w: WireInput, env: OwnEnv): void {
    this.r.push(seq, w, this.r.tickFor(seq), env);
  }

  /** Rebases prediction on the server's row of tick, on which it applied input ack. */
  reconcile(row: CarRow, ack: number, tick: number, env: OwnEnv): void {
    this.r.reconcile(this.fromRow(row, this.r.state()), ack, tick, env);
    if (this.hard) {
      this.smoother.reset();
      this.hard = false;
    }
  }

  /** Predicted physics state. */
  state(): OwnState {
    return this.r.state();
  }

  /** Physics state plus the fading visual correction; dtS = frame time. Decays the correction: call once per frame. */
  render(dtS: number): OwnState {
    return this.r.render(dtS);
  }

  /** Unacknowledged inputs kept for replay. */
  pendingCount(): number {
    return this.r.pendingCount();
  }

  private step(s: OwnState, w: WireInput, env: OwnEnv): OwnState {
    if (!env.running) return s;
    const st: OwnState = { ...s, dmg: { ...s.dmg } };
    const hint = { i: s.seg };
    moveCar(st, this.paramsFor(w), carInput(w), this.track, hint);
    st.seg = hint.i;
    return st;
  }

  /** The server state of row; like supplies what the row does not carry. */
  private fromRow(row: CarRow, like: OwnState): OwnState {
    const h = like.h + angleDiff(row.h, like.h); // continuous with the predicted heading
    const sv = Math.abs(row.vx);
    return {
      x: row.x, z: row.z, h, hx: Math.cos(h), hz: Math.sin(h),
      vx: row.vx, vy: row.vy, r: row.r, delta: row.delta,
      rpm: like.rpm, gear: like.gear === 0 && row.vx < REV_ENGAGE ? 0 : this.gearAt(sv, like.gear), ax: like.ax, launch: like.launch,
      dmg: { ...this.dmg },
      seg: this.track.locate(row.x, row.z, like.seg).i,
    };
  }

  /** gear moved by car.step's shift rule until it holds at body speed sv. */
  private gearAt(sv: number, gear: number): number {
    let g = Number.isInteger(gear) && gear >= 1 && gear <= 8 ? gear : 1;
    const k = this.params.rpmPerMS;
    for (let i = 0; i < 8; i++) {
      if (sv * k[g - 1] > SHIFT_UP && g < 8) g++;
      else if (sv * k[g - 1] < SHIFT_DOWN && g > 1 && sv * k[g - 2] < SHIFT_UP) g--;
      else break;
    }
    return g;
  }

  /** The Params of an input: the configured ones, or with its live values (cached while they repeat). */
  private paramsFor(w: WireInput): Params {
    if (!w.lv) return this.params;
    const key = w.lv.join(",");
    if (key !== this.liveKey) {
      this.liveParams = newParams(this.handling, withLive(this.setup, w.lv), this.dmg);
      this.liveKey = key;
    }
    return this.liveParams;
  }

  private rebuild(): void {
    this.params = newParams(this.handling, this.setup, this.dmg);
    this.liveKey = "";
  }
}
