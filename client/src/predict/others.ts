// Other cars: snapshot rows interpolated 100 ms behind the server through
// roomkit's InterpBuffer (positions and velocities lerped, heading along the
// shortest arc, discrete fields from the nearer snapshot), then carried
// forward by their own velocity to the own car's predicted time (sample's
// lead): the own car is drawn ahead of the server, and a car drawn in the past
// beside it is metres behind where the server has it (12 m at 80 m/s and
// 150 ms), so a hit would show seconds after the cars seemed to touch. A teleport is
// drawn as one: any move above 8 m between snapshots (back to the grid), and
// a marshal reset ("reset" message), whose move may be short.

import { InterpBuffer, ServerClock } from "roomkit/predict/interp";
import type { CarRow } from "../net/protocol.ts";
import { angleDiff } from "./own.ts";

export const INTERP_DELAY_MS = 100;
/** Longest lead a car is carried forward by (a stalled connection is not extrapolated further). */
export const MAX_LEAD_MS = 250;
const TICK_MS = 1000 / 60;
const JUMP_M = 8;  // a move this long between snapshots is never slid along
const CUT_M = 0.5; // a reset car stood still (< 1 m/s), so a move this long between its snapshots is the reset
const CUT_WAIT = 3; // snapshots a reset waits for its move to show up

/** Blends two rows of one car; u in [0, 1]. */
export function mixRow(a: CarRow, b: CarRow, u: number): CarRow {
  const l = (p: number, q: number) => p + (q - p) * u;
  const near = u < 0.5 ? a : b;
  if (Math.hypot(b.x - a.x, b.z - a.z) > JUMP_M) return near;
  return {
    ...near,
    x: l(a.x, b.x), z: l(a.z, b.z), h: a.h + angleDiff(b.h, a.h) * u,
    vx: l(a.vx, b.vx), vy: l(a.vy, b.vy), r: l(a.r, b.r), delta: l(a.delta, b.delta),
  };
}

/** row carried forward by s seconds along its world velocity, turning at its yaw rate. */
export function lead(row: CarRow, s: number): CarRow {
  if (!(s > 0)) return row;
  const c = Math.cos(row.h), sn = Math.sin(row.h);
  return {
    ...row,
    x: row.x + (row.vx * c - row.vy * sn) * s,
    z: row.z + (row.vx * sn + row.vy * c) * s,
    h: row.h + row.r * s,
  };
}

const apart = (a: CarRow, b: CarRow): number => Math.hypot(b.x - a.x, b.z - a.z);

/** One car's buffer and its last two snapshots (to find a reset's move). */
class Car {
  buf = new InterpBuffer<CarRow>(mixRow);
  prev: CarRow | null = null;
  last: CarRow | null = null;
  lastT = 0;
  cut = 0; // snapshots left in which a reset's move is looked for

  push(t: number, row: CarRow): void {
    if (this.last && t <= this.lastT) return;
    this.prev = this.last;
    this.last = row;
    this.lastT = t;
    this.buf.push(t, row);
    if (this.cut > 0) {
      this.cut--;
      if (this.prev && apart(this.prev, row) > CUT_M) this.restart();
    }
  }

  /** The server reset this car: the snapshot with the new pose is the newest one or one of the next. */
  reset(): void {
    if (this.prev && this.last && apart(this.prev, this.last) > CUT_M) {
      this.restart();
      return;
    }
    this.cut = CUT_WAIT;
  }

  /** Drops every snapshot before the newest: nothing is lerped across the move. */
  private restart(): void {
    this.cut = 0;
    this.buf = new InterpBuffer<CarRow>(mixRow);
    this.buf.push(this.lastT, this.last!);
  }
}

export class Others {
  private clock = new ServerClock(TICK_MS, INTERP_DELAY_MS);
  private readonly cars = new Map<number, Car>();

  /** A snapshot of tick received at local nowMs: rows of every car but the own one. */
  push(tick: number, rows: readonly CarRow[], nowMs: number): void {
    this.clock.observe(tick, nowMs);
    const t = this.clock.serverMs(tick);
    const seen = new Set<number>();
    for (const row of rows) {
      seen.add(row.id);
      let c = this.cars.get(row.id);
      if (!c) {
        c = new Car();
        this.cars.set(row.id, c);
      }
      c.push(t, row);
    }
    for (const id of this.cars.keys()) if (!seen.has(id)) this.cars.delete(id);
  }

  /** The marshals moved car id ("reset"): it is drawn at its new pose without sliding there. */
  reset(id: number): void {
    this.cars.get(id)?.reset();
  }

  /** Every car as drawn at local nowMs, by id, carried forward by leadMs (0 … MAX_LEAD_MS). */
  sample(nowMs: number, leadMs = 0): CarRow[] {
    const at = this.clock.renderTime(nowMs);
    const ahead = Math.min(Math.max(Number.isFinite(leadMs) ? leadMs : 0, 0), MAX_LEAD_MS) / 1000;
    const out: CarRow[] = [];
    for (const c of this.cars.values()) {
      const s = c.buf.sample(at);
      if (s) out.push(lead(s, ahead));
    }
    return out.sort((p, q) => p.id - q.id);
  }

  /** Forgets every car and the clock (a new seat; after an update the ticks restart). */
  clear(): void {
    this.cars.clear();
    this.clock = new ServerClock(TICK_MS, INTERP_DELAY_MS);
  }
}
