import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carInput, damageOf, decodeCar, decodeServer, VERSION, wireInput, type Dmg, type Snap, type Welcome } from "./protocol.ts";

// The documented one-line examples of internal/protocol/server.go, read from the Go source.
const goExamples = (): string[] => {
  const src = readFileSync(new URL("../../../internal/protocol/server.go", import.meta.url), "utf8");
  return src.split("\n").filter((l) => /^\/\/\t\{"t":/.test(l)).map((l) => l.slice(3));
};

test("version is 2", () => {
  assert.equal(VERSION, 3);
});

test("every documented server example decodes", () => {
  const ex = goExamples();
  assert.deepEqual(ex.map((l) => JSON.parse(l).t), ["welcome", "dmg", "snap", "grid", "lights", "lights", "lap", "results", "wing", "reset"]);
  for (const l of ex) assert.ok(decodeServer(JSON.parse(l)), l);
});

test("the core's messages decode", () => {
  for (const l of [
    `{"t":"notice","msg":"only the room creator can start","code":"not_creator"}`,
    `{"t":"error","msg":"no bot car left","code":"racing"}`,
    `{"t":"error","msg":"bad"}`,
    `{"t":"pong","ts":1234.5}`,
    `{"t":"chat","from":3,"id":2}`,
  ]) assert.ok(decodeServer(JSON.parse(l)), l);
});

test("the snapshot example's row decodes to SI units", () => {
  const snap = decodeServer(JSON.parse(goExamples().find((l) => l.startsWith(`{"t":"snap"`))!)) as Snap;
  assert.equal(snap.clock, 41200);
  const c = decodeCar(snap.cars[0]);
  assert.deepEqual(c, {
    id: 1, x: 12.34, z: -5.6, h: 3.142, vx: 55, vy: -0.12, r: 0.04, delta: -0.035, lap: 2, s: 1834,
    bot: false, finished: false, wingLost: false, offTrack: false,
  });
  assert.ok(Math.abs(c.h - Math.PI) < 1e-3);
  const f = decodeCar([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0b1111]);
  assert.deepEqual([f.bot, f.finished, f.wingLost, f.offTrack], [true, true, true, true]);
});

test("the welcome carries the car's setup and damage; dmg converts to the car model's damage", () => {
  const ex = goExamples();
  const w = decodeServer(JSON.parse(ex.find((l) => l.startsWith(`{"t":"welcome"`))!)) as Welcome;
  assert.deepEqual([w.setup, w.dmg], [[6, 6, 58, 3, 5, 5, 1, 1], { fw: 0, rw: 0, su: 0 }]);
  const d = decodeServer(JSON.parse(ex.find((l) => l.startsWith(`{"t":"dmg"`))!)) as Dmg;
  assert.deepEqual(damageOf(d), { frontWing: 0.42, rearWing: 0, susp: 0.075 });
});

test("malformed messages are dropped", () => {
  for (const m of [
    null, 3, "snap", [], {}, { t: "nope" }, { t: "toString" },
    { t: "snap", tick: 1, ack: 0, phase: "racing", clock: 0, cars: [[1, 2, 3]] },
    { t: "snap", tick: 1, ack: 0, phase: "warmup", clock: 0, cars: [] },
    { t: "snap", tick: 1.5, ack: 0, phase: "racing", clock: 0, cars: [] },
    { t: "welcome", you: 1, code: "K3FQ", car: 1, handling: "drift", contact: "soft", laps: 5, track: "kiyi", creator: true, setup: [6, 6, 58, 3, 5, 5, 1, 1], dmg: { fw: 0, rw: 0, su: 0 } },
    { t: "welcome", you: 1, code: "K3FQ", car: 1, handling: "sim", contact: "soft", laps: 5, track: "kiyi", creator: true, setup: [6, 6, 58, 3, 5, 5], dmg: { fw: 0, rw: 0, su: 0 } },
    { t: "welcome", you: 1, code: "K3FQ", car: 1, handling: "sim", contact: "soft", laps: 5, track: "kiyi", creator: true, setup: [6, 6, 58, 3, 5, 5, 1], dmg: { fw: 0, rw: 0, su: 0 } },
    { t: "welcome", you: 1, code: "K3FQ", car: 1, handling: "sim", contact: "soft", laps: 5, track: "kiyi", creator: true, setup: [6, 6, 58, 3, 5, 5, 1, 1] },
    { t: "dmg", car: 1, fw: 0.5, rw: 0, su: 0 },
    { t: "lights", on: 0, out: "x" },
    { t: "lap", car: 1, lap: 1, ms: 1, valid: 1, best: 0 },
    { t: "pong", ts: null },
  ]) assert.equal(decodeServer(m), null, JSON.stringify(m));
});

test("wire input quantises like protocol.WireInput and converts back like Input.Car", () => {
  assert.deepEqual(wireInput({ throttle: 1, brake: 0, steer: -1 }), { th: 100, br: 0, st: -127 });
  // Halves round away from zero as Go's math.Round does.
  assert.deepEqual(wireInput({ throttle: 0.005, brake: 0.125, steer: -2.5 / 127 }), { th: 1, br: 13, st: -3 });
  assert.deepEqual(wireInput({ throttle: 2, brake: NaN, steer: 5 }), { th: 100, br: 0, st: 127 });
  assert.deepEqual(carInput({ th: 50, br: 100, st: -127 }), { throttle: 0.5, brake: 1, steer: -1, reverse: false });
});

test("reverse travels as rv, omitted when off (Go's omitempty)", () => {
  assert.deepEqual(wireInput({ throttle: 0.5, brake: 0, steer: 0, reverse: true }), { th: 50, br: 0, st: 0, rv: true });
  assert.equal("rv" in wireInput({ throttle: 1, brake: 0, steer: 0, reverse: false }), false);
  assert.deepEqual(carInput({ th: 100, br: 0, st: 0, rv: true }), { throttle: 1, brake: 0, steer: 0, reverse: true });
});
