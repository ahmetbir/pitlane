// What the HUD knows about the race, from server messages: phase, names,
// standings, the own lap clock and the own car's latest row. hud() turns it
// into the HUD's texts. No DOM, no rendering.
import type { State } from "../car/car.ts";
import { decodeCar, type CarRow, type Phase, type ServerMsg } from "../net/protocol.ts";
import { LapTimer } from "../timing/laptimer.ts";
import { Standings, type Gap } from "../timing/standings.ts";
import type { Track } from "../track/track.ts";
import { lapOf, type GapView, type HudText } from "../ui/hud.ts";

const WRONG_DOT = -0.2; // heading · track tangent below this is driving backwards
const WRONG_MIN_MS = 4;

const running = (p: Phase | null): boolean => p === "lights" || p === "racing" || p === "finish";

export class RaceState {
  private readonly track: Track;
  private readonly laps: number;
  private readonly own: () => number;
  private readonly names = new Map<number, string>();
  private readonly standings: Standings;
  private readonly timer: LapTimer;
  private readonly hints = new Map<number, number>(); // locate hints per car (lights only)
  private phase: Phase | null = null;
  private ownRow: CarRow | null = null;
  private ownHint = -1;
  private seat = 0;  // car id of the latest welcome
  private clock = 0; // of the latest running snapshot
  private rows: CarRow[] = [];

  constructor(track: Track, laps: number, own: () => number) {
    this.track = track;
    this.laps = laps;
    this.own = own;
    this.standings = new Standings(track.length, track.sectors, own);
    this.timer = new LapTimer(track.length);
  }

  currentPhase(): Phase | null {
    return this.phase;
  }

  nameOf(id: number): string {
    return this.names.get(id) ?? `#${id}`;
  }

  /** The own car's latest snapshot row. */
  ownLatest(): CarRow | null {
    return this.ownRow;
  }

  apply(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        // A reconnect into the same car keeps the race picture (laps, best, sectors);
        // a new seat starts over with the next snapshot.
        if (m.car !== this.seat) {
          this.phase = null;
          this.ownRow = null;
        }
        this.seat = m.car;
        break;
      case "results":
        this.standings.final(m.rows.map((r) => r.id));
        break;
      case "grid":
        for (const c of m.cars) this.names.set(c.id, c.name);
        break;
      case "snap":
        this.snap(m.phase, m.clock, m.cars.map(decodeCar));
        break;
      case "lap":
        if (m.car === this.own()) this.timer.lap(m.lap, m.ms, m.valid, m.best);
        break;
    }
  }

  private snap(phase: Phase, clock: number, rows: CarRow[]): void {
    const prev = this.phase;
    this.phase = phase;
    this.rows = rows;
    this.ownRow = rows.find((r) => r.id === this.own()) ?? null;
    if (!running(phase)) return;
    if (phase === "lights" && prev !== "lights") {
      this.standings.reset();
      this.timer.reset(true);
      this.hints.clear();
    } else if (phase !== "lights" && (!running(prev) || clock + 1000 < this.clock)) {
      // Seated mid-race (a takeover or reconnect): no start seen, the laps so far are the server's.
      this.standings.reset();
      this.timer.reset(false, this.ownRow?.lap ?? 0);
    }
    this.clock = clock;
    this.standings.push(clock, rows.map((r) => ({ id: r.id, s: phase === "lights" ? this.locate(r) : r.s, lap: r.lap, finished: r.finished })));
    this.timer.snap(clock, this.standings.progressOf(this.own()));
  }

  /** Track distance of a car on the grid (the server's s is not kept up while the lights are on). */
  private locate(r: CarRow): number {
    const loc = this.track.locate(r.x, r.z, this.hints.get(r.id) ?? -1);
    this.hints.set(r.id, loc.i);
    return loc.s;
  }

  /** The HUD's texts; st: the own car as drawn (for wrong way), null before it is seated. */
  hud(st: State | null): HudText {
    const id = this.own();
    const g = this.standings.gaps(id);
    const view = (x: Gap | null): GapView | null => (x ? { name: this.nameOf(x.id), gap: x } : null);
    const done = this.ownRow?.lap ?? this.timer.lapsDone();
    return {
      pos: this.standings.position(id), cars: Math.max(this.standings.count(), this.rows.length),
      lap: lapOf(done, this.laps), laps: this.laps,
      current: this.phase === "lights" ? 0 : this.timer.current(), last: this.timer.last(), best: this.timer.best(), delta: this.timer.delta(),
      ahead: view(g.ahead), behind: view(g.behind),
      sectors: this.standings.sectors(),
      finished: this.ownRow?.finished ?? false,
      wrongWay: this.phase === "racing" && st !== null && this.wrongWay(st),
      offTrack: running(this.phase) && (this.ownRow?.offTrack ?? false),
    };
  }

  private wrongWay(st: State): boolean {
    if (st.gear === 0 || Math.hypot(st.vx, st.vy) < WRONG_MIN_MS) return false; // backing up in reverse is not wrong way
    const loc = this.track.locate(st.x, st.z, this.ownHint);
    this.ownHint = loc.i;
    const seg = this.track.segs[loc.i];
    const fx = Math.sign(st.vx) * st.hx, fz = Math.sign(st.vx) * st.hz; // direction of travel
    return fx * seg.tx + fz * seg.tz < WRONG_DOT;
  }
}
