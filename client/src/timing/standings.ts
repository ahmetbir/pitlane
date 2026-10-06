// Race order, gaps and sector times on the client, from snapshots (and the
// server's results order once it is in).
//
// Each car's distance raced ("progress") is its track distance s unwrapped
// across the line: the grid stands behind the line, so a car is at s − L
// until it first crosses (progress 0), and lap n ends at progress n·L (lap 1
// includes the run from the grid). Order: finished cars in the order they
// were seen finishing (cars finishing in one snapshot, or first seen
// finished, by distance driven), then progress, then id.
//
// Gaps are measured at timing lines every LINE_M: the car ahead's gap is how
// long ago it passed the point where I am now; the car behind's is how long
// ago I passed where it is now. Sector times come from the same crossings,
// interpolated between snapshots.

const LINE_M = 10;

/** What a snapshot row gives the standings. */
export type Mark = { id: number; s: number; lap: number; finished: boolean };

/** A gap to a neighbour: time, or whole laps when a lap or more apart. */
export type Gap = { id: number; ms: number; laps: number };

export type SectorColour = "" | "purple" | "green" | "yellow";

class Runner {
  progress: number;
  max: number; // highest progress seen: only new ground is timed
  prevS: number;
  at = 0; // clock of the last snapshot
  readonly lines = new Map<number, number>(); // line index → clock when first crossed
  sectorStart: number; // clock the current sector began
  timed: boolean; // sectorStart is a real sector start (seen from the race start, or since a sector end)
  finished = false;

  constructor(progress: number, s: number, clock: number) {
    this.progress = this.max = progress;
    this.prevS = s;
    this.at = clock;
    this.sectorStart = clock;
    this.timed = clock === 0;
  }

  /** Clock when this car passed progress p, or null when it has not (or before its first sighting). */
  timeAt(p: number): number | null {
    const k = Math.floor(p / LINE_M);
    const a = this.lines.get(k), b = this.lines.get(k + 1);
    if (a === undefined) return null;
    if (b === undefined) return p <= this.max ? a : null;
    return a + ((b - a) * (p - k * LINE_M)) / LINE_M;
  }
}

export class Standings {
  private readonly length: number;
  private readonly bounds: readonly number[]; // sector ends within a lap: [b1, b2, L]
  private readonly cars = new Map<number, Runner>();
  private finishOrder: number[] = [];
  private clock = 0;
  private best: [number, number, number] = [Infinity, Infinity, Infinity]; // fastest sector of any car
  private ownBest: [number, number, number] = [Infinity, Infinity, Infinity];
  private colours: [SectorColour, SectorColour, SectorColour] = ["", "", ""];
  private readonly own: () => number;

  /** sectors: the track's sector starts [0, b1, b2]; own: the own car id (read each push). */
  constructor(length: number, sectors: readonly number[], own: () => number) {
    this.length = length;
    this.bounds = [sectors[1], sectors[2], length];
    this.own = own;
  }

  /** Forgets everything (a new race). */
  reset(): void {
    this.cars.clear();
    this.finishOrder = [];
    this.clock = 0;
    this.best = [Infinity, Infinity, Infinity];
    this.ownBest = [Infinity, Infinity, Infinity];
    this.colours = ["", "", ""];
  }

  /** One snapshot of a running race: race clock ms and every car. */
  push(clock: number, marks: readonly Mark[]): void {
    this.clock = clock;
    const L = this.length;
    const seen = new Set<number>();
    const done: number[] = []; // finished in this snapshot (or first seen finished)
    for (const m of marks) {
      seen.add(m.id);
      let r = this.cars.get(m.id);
      if (!r) {
        // Behind the line before the first crossing; a late sighting trusts the lap count.
        const p = m.lap > 0 || m.s < L / 2 || clock > 30000 ? m.lap * L + m.s : m.s - L;
        r = new Runner(p, m.s, clock);
        r.lines.set(Math.floor(p / LINE_M), clock);
        this.cars.set(m.id, r);
      } else {
        let d = m.s - r.prevS;
        if (d < -L / 2) d += L;
        else if (d > L / 2) d -= L;
        this.advance(m.id, r, r.progress + d, clock);
        r.prevS = m.s;
      }
      if (m.finished && !r.finished) {
        r.finished = true;
        done.push(m.id);
      }
    }
    // Several in one snapshot: the one further on crossed first (finished cars drive on).
    done.sort((a, b) => this.cars.get(b)!.progress - this.cars.get(a)!.progress || a - b);
    this.finishOrder.push(...done);
    for (const id of this.cars.keys()) if (!seen.has(id)) this.cars.delete(id);
  }

  /** The server's final order (results): it replaces the order seen from snapshots. */
  final(ids: readonly number[]): void {
    this.finishOrder = ids.filter((id) => this.cars.has(id));
  }

  /** Car ids in race order. */
  order(): number[] {
    const fin = new Map(this.finishOrder.map((id, i) => [id, i]));
    return [...this.cars.entries()]
      .sort(([ia, a], [ib, b]) => {
        const fa = fin.get(ia), fb = fin.get(ib);
        if (fa !== undefined || fb !== undefined) return (fa ?? Infinity) - (fb ?? Infinity);
        return b.progress - a.progress || ia - ib;
      })
      .map(([id]) => id);
  }

  /** 1-based position of car id, 0 when unknown. */
  position(id: number): number {
    return this.order().indexOf(id) + 1;
  }

  count(): number {
    return this.cars.size;
  }

  /** Distance raced by car id (m), or null. */
  progressOf(id: number): number | null {
    return this.cars.get(id)?.progress ?? null;
  }

  /** Gaps from car id to the cars directly ahead and behind; null where there is none or no timing yet. */
  gaps(id: number): { ahead: Gap | null; behind: Gap | null } {
    const order = this.order();
    const i = order.indexOf(id);
    const me = this.cars.get(id);
    if (i < 0 || !me) return { ahead: null, behind: null };
    const gap = (front: Runner, back: Runner, otherId: number): Gap | null => {
      const apart = front.progress - back.progress;
      if (apart >= this.length) return { id: otherId, ms: 0, laps: Math.floor(apart / this.length) };
      const t = front.timeAt(back.progress);
      return t === null ? null : { id: otherId, ms: Math.max(0, this.clock - t), laps: 0 };
    };
    const a = i > 0 ? this.cars.get(order[i - 1]) : undefined;
    const b = i + 1 < order.length ? this.cars.get(order[i + 1]) : undefined;
    return { ahead: a ? gap(a, me, order[i - 1]) : null, behind: b ? gap(me, b, order[i + 1]) : null };
  }

  /** The own car's sector colours: the latest time of each sector (cleared from S2 on when a new lap's S1 is in). */
  sectors(): readonly SectorColour[] {
    return this.colours;
  }

  /** Moves r to progress p at clock: timing lines and sector ends crossed on new ground. */
  private advance(id: number, r: Runner, p: number, clock: number): void {
    const p0 = r.max, t0 = r.at;
    r.progress = p;
    r.at = clock;
    if (p <= p0) return;
    r.max = p;
    const when = (x: number) => t0 + ((clock - t0) * (x - p0)) / (p - p0);
    for (let k = Math.floor(p0 / LINE_M) + 1; k * LINE_M <= p; k++) r.lines.set(k, when(k * LINE_M));
    if (r.finished) return;
    const L = this.length;
    for (let lap = Math.max(0, Math.floor(p0 / L)); lap * L <= p; lap++) {
      for (let k = 0; k < 3; k++) {
        const b = lap * L + this.bounds[k];
        if (b <= p0 || b > p || b <= 0) continue;
        const t = when(b);
        if (r.timed) this.sector(id, k, t - r.sectorStart);
        r.sectorStart = t;
        r.timed = true;
      }
    }
  }

  private sector(id: number, k: number, ms: number): void {
    if (id === this.own()) {
      const c: SectorColour = ms <= this.best[k] ? "purple" : ms <= this.ownBest[k] ? "green" : "yellow";
      if (k === 0) this.colours = [c, "", ""];
      else this.colours[k] = c;
      this.ownBest[k] = Math.min(this.ownBest[k], ms);
    }
    this.best[k] = Math.min(this.best[k], ms);
  }
}
