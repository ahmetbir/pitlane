import { test } from "node:test";
import assert from "node:assert/strict";
import type { Conn, Env } from "roomkit/net/socket";
import { kiyi } from "../track/track.ts";
import { GAP_MS, Session } from "./session.ts";
import type { ServerMsg } from "./protocol.ts";

class FakeConn implements Conn {
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  send(d: string): void {
    this.sent.push(JSON.parse(d));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  recv(m: unknown): void {
    this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  }
}

function harness() {
  let now = 0;
  const timers: { at: number; f: () => void }[] = [];
  const conns: FakeConn[] = [];
  const env: Env = {
    dial: () => {
      const c = new FakeConn();
      conns.push(c);
      return c;
    },
    now: () => now,
    setTimeout: (f, ms) => {
      const t = { at: now + ms, f };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.f();
    }
  };
  const msgs: ServerMsg[] = [];
  const s = new Session("ws://x/ws", "Ace", { t: "create", handling: "arcade", contact: "soft", laps: 3 }, tr, {
    onMsg: (m) => msgs.push(m), onStatus: () => {}, onFatal: () => {},
  }, { env, now: () => now });
  return { s, conns, msgs, advance };
}

const tr = kiyi();
const [X, Z] = tr.point(300, 0);
const [X1, Z1] = tr.point(301, 0);
const H = Math.round(Math.atan2(Z1 - Z, X1 - X) * 1000);
const XQ = Math.round(X * 100), ZQ = Math.round(Z * 100);

const WELCOME = { t: "welcome", you: 7, code: "K3FQ", car: 4, handling: "arcade", contact: "soft", laps: 3, track: "kiyi", creator: true };
const snap = (tick: number, ack: number, phase = "racing") => ({
  t: "snap", tick, ack, phase, clock: 0,
  cars: [[4, XQ, ZQ, H, 3000, 0, 0, 0, 0, 0, 0], [5, 1500, 2000, 3142, 0, 0, 0, 0, 0, 0, 1]],
});

test("handshake: hello v1 then the create", () => {
  const { conns } = harness();
  conns[0].open();
  assert.deepEqual(conns[0].sent, [
    { t: "hello", v: 1, name: "Ace" },
    { t: "create", handling: "arcade", contact: "soft", laps: 3 },
  ]);
});

test("inputs wait for the own car's first snapshot, then go out quantised with seq from its ack", () => {
  const { s, conns, msgs } = harness();
  const c = conns[0];
  c.open();
  c.recv(WELCOME);
  s.input({ throttle: 1, brake: 0, steer: 0.5 });
  assert.equal(c.sent.filter((m) => m.t === "in").length, 0);
  assert.equal(s.ownCar(0), null);
  c.recv(snap(100, 0));
  s.input({ throttle: 1, brake: 0, steer: 0.5 });
  s.input({ throttle: 0.333, brake: 0.2, steer: -1 });
  assert.deepEqual(c.sent.filter((m) => m.t === "in"), [
    { t: "in", seq: 1, th: 100, br: 0, st: 64 },
    { t: "in", seq: 2, th: 33, br: 20, st: -127 },
  ]);
  const own = s.ownCar(1 / 60)!;
  const moved = Math.hypot(own.x - XQ / 100, own.z - ZQ / 100);
  assert.ok(moved > 0.9 && moved < 1.1, `predicted ${moved} m in two ticks at 30 m/s`);
  assert.deepEqual(msgs.map((m) => m.t), ["welcome", "snap"]);
  assert.equal(s.carID(), 4);
});

test("other cars come from the snapshot rows except the own one", () => {
  const { s, conns, advance } = harness();
  const c = conns[0];
  c.open();
  c.recv(WELCOME);
  c.recv(snap(100, 0));
  advance(400);
  const others = s.otherCars();
  assert.deepEqual(others.map((o) => [o.id, o.x, o.h, o.bot]), [[5, 15, 3.142, true]]);
});

test("ready and start keep a 500 ms gap; the setup is clamped", () => {
  const { s, conns, advance } = harness();
  const c = conns[0];
  c.open();
  c.recv(WELCOME);
  s.ready([6, 6, 99, 3, 5, 5]);
  s.start();
  assert.deepEqual(c.sent.slice(2), [{ t: "ready", setup: [6, 6, 70, 3, 5, 5] }]);
  advance(GAP_MS);
  assert.deepEqual(c.sent.slice(3), [{ t: "start" }]);
});

test("malformed server messages are dropped", () => {
  const { conns, msgs } = harness();
  const c = conns[0];
  c.open();
  c.recv(WELCOME);
  c.recv({ t: "snap", tick: 1 });
  c.recv({ t: "bogus" });
  assert.deepEqual(msgs.map((m) => m.t), ["welcome"]);
});

test("a new welcome (rejoin) restarts the seqs and waits for the new seat", () => {
  const { s, conns } = harness();
  const c = conns[0];
  c.open();
  c.recv(WELCOME);
  c.recv(snap(100, 0));
  s.input({ throttle: 1, brake: 0, steer: 0 });
  c.recv({ ...WELCOME, car: 5 });
  assert.equal(s.ownCar(0), null);
  c.recv(snap(200, 0));
  s.input({ throttle: 1, brake: 0, steer: 0 });
  assert.deepEqual(c.sent.filter((m) => m.t === "in").map((m) => m.seq), [1, 1]);
  assert.deepEqual(s.otherCars().map((o) => o.id), [4]);
});
