// The own car's lap clock: current, last and best lap, and the live delta to
// the best lap. Lap times are the server's ("lap" messages); the current lap
// runs from the sum of the laps before it on the race clock. The delta
// compares the time into this lap with the best flying lap's time at the
// same distance (lap 1 starts from the grid, so it is never the reference).

type Trace = { d: number[]; t: number[] }; // distance into the lap (m) → time into it (ms), ascending

const empty = (): Trace => ({ d: [], t: [] });

/** Time into the lap at distance d along tr, linearly between samples; null outside it. */
export function traceAt(tr: Trace, d: number): number | null {
  const n = tr.d.length;
  if (n === 0 || d < tr.d[0] || d > tr.d[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.d[mid] <= d) lo = mid;
    else hi = mid;
  }
  if (tr.d[hi] === tr.d[lo]) return tr.t[lo];
  return tr.t[lo] + ((tr.t[hi] - tr.t[lo]) * (d - tr.d[lo])) / (tr.d[hi] - tr.d[lo]);
}

export class LapTimer {
  private readonly length: number;
  private done = 0;                    // laps completed
  private start: number | null = null; // race clock at which the current lap began; null = unknown (joined mid-race)
  private clock = 0;
  private progress: number | null = null;
  private trace = empty();
  private ref: Trace | null = null;
  private refMs = Infinity;
  private lastMs = 0;
  private bestMs = 0;

  constructor(length: number) {
    this.length = length;
  }

  /** A new race. fromStart: the lights were seen, so lap 1 began at clock 0; otherwise its start is unknown. */
  reset(fromStart: boolean, lapsDone = 0): void {
    this.done = lapsDone;
    this.start = fromStart ? 0 : null;
    this.clock = 0;
    this.progress = null;
    this.trace = empty();
    this.ref = null;
    this.refMs = Infinity;
    this.lastMs = this.bestMs = 0;
  }

  /** A snapshot: race clock and the own car's distance raced (Standings). */
  snap(clock: number, progress: number | null): void {
    this.clock = clock;
    this.progress = progress;
    if (progress === null || this.start === null) return;
    const d = progress - this.done * this.length;
    const tr = this.trace;
    if (d >= 0 && d <= this.length && (tr.d.length === 0 || d > tr.d[tr.d.length - 1])) {
      tr.d.push(d);
      tr.t.push(clock - this.start);
    }
  }

  /** The own car completed lap n in ms (valid or not); best is its best valid lap so far, 0 = none. */
  lap(n: number, ms: number, valid: boolean, best: number): void {
    const flying = n >= 2 && this.start !== null && this.done === n - 1;
    if (flying && valid && ms < this.refMs && this.trace.d.length > 1) {
      this.ref = this.trace;
      this.refMs = ms;
    }
    this.start = this.start === null || this.done !== n - 1 ? this.clock : this.start + ms;
    this.done = n;
    this.trace = empty();
    this.lastMs = ms;
    this.bestMs = best;
  }

  lapsDone(): number {
    return this.done;
  }

  /** Time into the current lap, null when its start is unknown. */
  current(): number | null {
    return this.start === null ? null : Math.max(0, this.clock - this.start);
  }

  last(): number {
    return this.lastMs;
  }

  best(): number {
    return this.bestMs;
  }

  /** Current time into the lap minus the reference lap's at the same distance (negative = faster); null without one. */
  delta(): number | null {
    if (!this.ref || this.start === null || this.progress === null || this.done < 1) return null;
    const d = this.progress - this.done * this.length;
    const r = traceAt(this.ref, d);
    return r === null ? null : this.clock - this.start - r;
  }
}
