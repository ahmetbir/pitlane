// Other cars: snapshot rows drawn 100 ms behind the server through roomkit's
// InterpBuffer: positions and velocities lerped, heading along the shortest
// arc, discrete fields (lap, flags) from the nearer snapshot; a teleport
// (marshal reset, back to the grid) is drawn as one.

import { InterpBuffer, ServerClock } from "roomkit/predict/interp";
import type { CarRow } from "../net/protocol.ts";
import { angleDiff } from "./own.ts";

export const INTERP_DELAY_MS = 100;
const TICK_MS = 1000 / 60;
const JUMP_M = 8; // a move this long between snapshots (marshal reset, regrid) is not slid along

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

export class Others {
  private clock = new ServerClock(TICK_MS, INTERP_DELAY_MS);
  private readonly bufs = new Map<number, InterpBuffer<CarRow>>();

  /** A snapshot of tick received at local nowMs: rows of every car but the own one. */
  push(tick: number, rows: readonly CarRow[], nowMs: number): void {
    this.clock.observe(tick, nowMs);
    const t = this.clock.serverMs(tick);
    const seen = new Set<number>();
    for (const row of rows) {
      seen.add(row.id);
      let b = this.bufs.get(row.id);
      if (!b) {
        b = new InterpBuffer<CarRow>(mixRow);
        this.bufs.set(row.id, b);
      }
      b.push(t, row);
    }
    for (const id of this.bufs.keys()) if (!seen.has(id)) this.bufs.delete(id);
  }

  /** Every car as drawn at local nowMs, by id. */
  sample(nowMs: number): CarRow[] {
    const at = this.clock.renderTime(nowMs);
    const out: CarRow[] = [];
    for (const b of this.bufs.values()) {
      const s = b.sample(at);
      if (s) out.push(s);
    }
    return out.sort((p, q) => p.id - q.id);
  }

  /** Forgets every car and the clock (a new seat; after an update the ticks restart). */
  clear(): void {
    this.bufs.clear();
    this.clock = new ServerClock(TICK_MS, INTERP_DELAY_MS);
  }
}
