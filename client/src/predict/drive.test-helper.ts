// Test harness for the own-car predictor: a server car behind roomkit's
// session queue model, snapshots quantised as EncodeCar, and a client that
// drives by its own prediction over a network with configurable delays.

import { SessionModel } from "roomkit/predict/sessionmodel";
import { Handling, newParams, type Setup, type State } from "../car/car.ts";
import { carInput, decodeCar, wireInput, type CarRow, type WireInput } from "../net/protocol.ts";
import { moveCar } from "../race/world.ts";
import { kiyi } from "../track/track.ts";
import { angleDiff, Own, type OwnState } from "./own.ts";

export const track = kiyi();
export const SETUP: Setup = [6, 6, 58, 3, 5, 5, 1];
export const HANDLING = Handling.Arcade;
const RUN = { running: true };

/** Seeded uniform [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const goRound = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
const q = (x: number, k: number) => (Number.isFinite(x) ? goRound(x * k) : 0);
function wrap(h: number): number {
  let r = h - 2 * Math.PI * Math.round(h / (2 * Math.PI));
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** The server's snapshot row of st (protocol.EncodeCar), decoded as the client sees it. */
export function rowOf(id: number, st: State): CarRow {
  const f = st.dmg.frontWing > 0.6 ? 4 : 0;
  return decodeCar([id, q(st.x, 100), q(st.z, 100), q(wrap(st.h), 1000), q(st.vx, 100), q(st.vy, 100), q(st.r, 1000), q(st.delta, 1000), 0, 0, f]);
}

/** A car on the centre line at distance s, heading along the track, at vx. */
export function startState(s: number, vx: number): State & { seg: number } {
  const [x, z] = track.point(s, 0);
  const [x1, z1] = track.point(s + 1, 0);
  const h = Math.atan2(z1 - z, x1 - x);
  return { x, z, h, hx: Math.cos(h), hz: Math.sin(h), vx, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 4, ax: 0, launch: false, dmg: { frontWing: 0, rearWing: 0, susp: 0 }, seg: track.locate(x, z, -1).i };
}

/** A driver that follows the centre line by its own (predicted) state. */
export function drive(st: OwnState): WireInput {
  const { s } = track.locate(st.x, st.z, st.seg);
  const [tx, tz] = track.point(s + 14, 0);
  const err = angleDiff(Math.atan2(tz - st.z, tx - st.x), st.h);
  const v = Math.hypot(st.vx, st.vy);
  return wireInput({ throttle: v < 28 ? 0.7 : 0.1, brake: 0, steer: Math.max(-1, Math.min(1, 2 * err)) });
}

export type Net = {
  ticks: number;
  uplink(t: number): number;           // ticks an input sent at t travels
  downlink(t: number): number;         // ticks a snapshot of t travels
  stalled?(t: number): boolean;        // the client sends nothing (tab hidden)
  server?(t: number, st: State): void; // server-side events (contact) after its step of t
  marshal?(t: number, st: State): boolean; // a marshal reset after its step of t: the "reset" message follows that tick's snapshot
};

export type Trace = {
  sentAt: number[];   // per seq: tick it was sent
  err: number[];      // per seq: |predicted − server| right after the server applied it
  offset: number[];   // per tick: |drawn − physics| (0 when stalled)
  drawn: OwnState[];  // per tick: drawn state
  pred: OwnState[];   // per tick: physics state
  serverAt: State[];  // per tick: server state
};

/** Runs a client and a server for net.ticks ticks; snapshots every 2 ticks (30 Hz). */
export function run(net: Net): Trace {
  const s0 = startState(300, 30);
  const params = newParams(HANDLING, SETUP, s0.dmg);
  const own = new Own(track, HANDLING, SETUP);
  const sq = new SessionModel<WireInput>();
  const server: State & { seg: number } = { ...s0, dmg: { ...s0.dmg } };
  own.reset(rowOf(1, server), 0, 0);
  let seq = 0, lastUp = 0, lastDown = 0;
  const up: { at: number; seq: number; w: WireInput }[] = [];
  const down: { at: number; row?: CarRow; ack: number; tick: number }[] = [];
  const predicted = new Map<number, OwnState>(), truth = new Map<number, State>();
  const tr: Trace = { sentAt: [], err: [], offset: [], drawn: [], pred: [], serverAt: [] };
  for (let t = 1; t <= net.ticks; t++) {
    if (!net.stalled?.(t)) {
      const w = drive(own.state());
      seq++;
      own.push(seq, w, RUN);
      predicted.set(seq, own.state());
      tr.sentAt[seq] = t;
      lastUp = Math.max(lastUp, t + Math.round(net.uplink(t))); // TCP: in order
      up.push({ at: lastUp, seq, w });
    }
    while (up.length && up[0].at <= t) {
      const u = up.shift()!;
      sq.push(u.seq, u.w);
    }
    const n = sq.next(); // server tick t
    if (n.inp) {
      const hint = { i: server.seg };
      moveCar(server, params, carInput(n.inp), track, hint);
      server.seg = hint.i;
    }
    net.server?.(t, server);
    const reset = net.marshal?.(t, server) ?? false;
    if (n.fresh) truth.set(sq.ack, { ...server });
    if (t % 2 === 0) {
      lastDown = Math.max(lastDown, t + Math.round(net.downlink(t)));
      down.push({ at: lastDown, row: rowOf(1, server), ack: sq.ack, tick: t });
    }
    if (reset) {
      lastDown = Math.max(lastDown, t + Math.round(net.downlink(t)));
      down.push({ at: lastDown, ack: sq.ack, tick: t });
    }
    while (down.length && down[0].at <= t) {
      const d = down.shift()!;
      if (d.row) own.reconcile(d.row, d.ack, d.tick, RUN);
      else own.teleported();
    }
    const drawn = own.render(1 / 60);
    const p = own.state();
    tr.drawn[t] = drawn;
    tr.pred[t] = p;
    tr.serverAt[t] = { ...server };
    tr.offset[t] = Math.hypot(drawn.x - p.x, drawn.z - p.z);
  }
  for (const [k, p] of predicted) {
    const s = truth.get(k);
    if (s) tr.err[k] = Math.hypot(p.x - s.x, p.z - s.z);
  }
  return tr;
}

/** Largest prediction error over seqs sent in [from, to). */
export function worst(tr: Trace, from: number, to = Infinity): number {
  let w = 0;
  tr.err.forEach((e, k) => {
    if (tr.sentAt[k] >= from && tr.sentAt[k] < to) w = Math.max(w, e);
  });
  return w;
}

/** Whether every number of every drawn and predicted state is finite. */
export function finite(tr: Trace): boolean {
  const ok = (s: OwnState) => [s.x, s.z, s.h, s.hx, s.hz, s.vx, s.vy, s.r, s.delta, s.rpm, s.gear, s.ax].every(Number.isFinite);
  return tr.drawn.every((s) => !s || ok(s)) && tr.pred.every((s) => !s || ok(s));
}
