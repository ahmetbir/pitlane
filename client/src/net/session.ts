// Pitlane's network session: roomkit's Socket with Pitlane's wire and
// shaping, feeding the own-car predictor and the other cars' interpolation.
// The race loop calls input() once per 60 Hz tick and reads own() / others()
// every frame; every other server message is passed on to the screens.

import { Socket, type Env, type Join, type Quick, type Status } from "roomkit/net/socket";
import type { ShaperPolicy } from "roomkit/net/shaper";
import { clampSetup, defaultSetup, parseHandling, type Handling, type Input, type Setup } from "../car/car.ts";
import { Others } from "../predict/others.ts";
import { Own, type OwnEnv, type OwnState } from "../predict/own.ts";
import type { Track } from "../track/track.ts";
import { decodeCar, decodeServer, VERSION, wireInput, type CarRow, type ClientMsg, type Create, type Phase, type ServerMsg } from "./protocol.ts";

export { socketURL, type Status } from "roomkit/net/socket";

/** Least time between two ready/start messages; the newest waiting one is sent. */
export const GAP_MS = 500;

/** Inputs are newest-only while the connection is backed up (no one-shot presses to carry over). */
export const POLICY: ShaperPolicy<ClientMsg> = {
  isInput: (m) => m.t === "in",
  latch: (_held, m) => m,
  gapped: (m) => m.t === "ready" || m.t === "start",
  gapMs: GAP_MS,
};

export type SessionHandlers = {
  onMsg: (m: ServerMsg) => void; // every valid server message except "error"
  onStatus: (s: Status) => void;
  onFatal: (code: string, msg: string) => void;
  onUnreachable?: () => void;
};

/** Injectable clocks and connection (tests); defaults are the browser's. */
export type SessionOpts = { env?: Env; now?: () => number };

const running = (p: Phase): boolean => p === "lights" || p === "racing" || p === "finish";

export class Session {
  private readonly sock: Socket<ClientMsg, ServerMsg>;
  private readonly h: SessionHandlers;
  private readonly now: () => number;
  private readonly own: Own;
  private readonly others = new Others();
  private handling: Handling = parseHandling("arcade")[0];
  private setup: Setup = defaultSetup();
  private car = 0;      // own car id, 0 before a welcome
  private seated = false; // the own car's first snapshot since the welcome arrived
  private seq = 0;
  private env: OwnEnv = { running: false };

  constructor(url: string, name: string, entry: Create | Join | Quick, track: Track, h: SessionHandlers, o: SessionOpts = {}) {
    this.h = h;
    this.now = o.now ?? (() => performance.now());
    this.own = new Own(track, this.handling, this.setup);
    this.sock = new Socket<ClientMsg, ServerMsg>(url, name, entry, {
      onMsg: (m) => this.receive(m),
      onStatus: (s) => h.onStatus(s),
      onFatal: (code, msg) => h.onFatal(code, msg),
      onUnreachable: () => h.onUnreachable?.(),
    }, { version: VERSION, policy: POLICY }, o.env);
  }

  /** Room code after the first welcome, "" before. */
  code(): string {
    return this.sock.code();
  }

  /** Own car id, 0 before a welcome. */
  carID(): number {
    return this.car;
  }

  setToken(tok: string): void {
    this.sock.setToken(tok);
  }

  /** One 60 Hz tick of driver input: quantised, sent and predicted (from the own car's first snapshot). */
  input(inp: Input): void {
    if (!this.seated) return;
    const w = wireInput(inp);
    const seq = this.seq + 1;
    if (!this.sock.send({ t: "in", seq, ...w })) return;
    this.seq = seq;
    this.own.push(seq, w, this.env);
  }

  /** Submits the garage setup (grid phase); prediction uses it from now on. */
  ready(setup: Setup): void {
    this.setup = clampSetup(setup);
    this.own.configure(this.handling, this.setup);
    this.sock.send({ t: "ready", setup: this.setup });
  }

  /** Starts the race (room creator, grid phase). */
  start(): void {
    this.sock.send({ t: "start" });
  }

  chat(id: number): void {
    this.sock.send({ t: "chat", id });
  }

  /** The own car as drawn this frame (prediction plus fading correction), null before it is seated. */
  ownCar(dtS: number): OwnState | null {
    return this.seated ? this.own.render(dtS) : null;
  }

  /** The other cars as drawn at this moment, 100 ms behind the server. */
  otherCars(): CarRow[] {
    return this.others.sample(this.now());
  }

  retry(): void {
    this.sock.retry();
  }

  close(): void {
    this.sock.close();
  }

  private receive(raw: ServerMsg): void {
    const m = decodeServer(raw);
    if (!m) return;
    switch (m.t) {
      case "welcome":
        // A new server session: its input seqs start over and the car may differ.
        this.car = m.car;
        this.seated = false;
        this.seq = 0;
        this.handling = parseHandling(m.handling)[0];
        this.own.configure(this.handling, this.setup);
        this.others.clear();
        break;
      case "snap":
        this.snap(m.tick, m.ack, m.phase, m.cars);
        break;
    }
    this.h.onMsg(m);
  }

  private snap(tick: number, ack: number, phase: Phase, cars: number[][]): void {
    this.env = { running: running(phase) };
    const rows = cars.map(decodeCar);
    const mine = rows.find((r) => r.id === this.car);
    this.others.push(tick, rows.filter((r) => r.id !== this.car), this.now());
    if (!mine) return;
    if (!this.seated) {
      this.own.reset(mine, tick, ack);
      this.seq = ack;
      this.seated = true;
      return;
    }
    this.own.reconcile(mine, ack, tick, this.env);
  }
}
