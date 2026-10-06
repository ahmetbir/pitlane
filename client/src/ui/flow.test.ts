import { test } from "node:test";
import assert from "node:assert/strict";
import type { Phase, ServerMsg } from "../net/protocol.ts";
import { initialFlow, step, type Flow, type FlowEvent } from "./flow.ts";

const welcome: ServerMsg = {
  t: "welcome", you: 1, code: "K3FQ", car: 4, handling: "arcade", contact: "soft", laps: 3, track: "kiyi", creator: true,
  setup: [6, 6, 58, 3, 5, 5], dmg: { fw: 0, rw: 0, su: 0 },
};
const snap = (phase: Phase): ServerMsg => ({ t: "snap", tick: 1, ack: 0, phase, clock: 0, cars: [] });
const grid: ServerMsg = { t: "grid", cars: [{ id: 4, name: "Ace", bot: false, ready: false }], creator: 4 };
const results: ServerMsg = { t: "results", rows: [] };
const msg = (m: ServerMsg): FlowEvent => ({ t: "msg", m });
const run = (evs: FlowEvent[], f: Flow = initialFlow()) => evs.reduce(step, f);

test("connecting → welcome → grid", () => {
  assert.equal(initialFlow().view, "connecting");
  const f = run([msg(welcome), msg(grid), msg(snap("grid"))]);
  assert.equal(f.view, "grid");
  assert.equal(f.phase, "grid");
});

test("lights → race; a whole race → results → back to the grid", () => {
  let f = run([msg(welcome), msg(snap("grid")), msg({ t: "lights", on: 1 })]);
  assert.equal(f.view, "race");
  f = run([msg(snap("lights")), msg({ t: "lights", on: 0, out: 99 }), msg(snap("racing")), msg(snap("finish"))], f);
  assert.equal(f.view, "race");
  f = run([msg(snap("results")), msg(results)], f);
  assert.equal(f.view, "results", "the results message shows the table");
  f = run([msg(snap("results")), msg(grid)], f);
  assert.equal(f.view, "results", "a roster change during results keeps the table");
  f = run([msg(snap("grid"))], f);
  assert.equal(f.view, "grid", "the grid phase's snapshot forms the grid");
});

test("a late joiner lands in the race; a mid-race roster change keeps it there", () => {
  let f = run([msg(welcome), msg(grid), msg(snap("racing"))]);
  assert.equal(f.view, "race");
  f = run([msg(grid), msg({ t: "lap", car: 4, lap: 1, ms: 80000, valid: true, best: 80000 })], f);
  assert.equal(f.view, "race");
});

test("joining during results shows the results the server sends", () => {
  const f = run([msg(welcome), msg(grid), msg(results), msg(snap("results"))]);
  assert.equal(f.view, "results");
});

test("error codes end on the error card; nothing moves it afterwards", () => {
  let f = run([msg(welcome), { t: "fatal", code: "full", msg: "room full" }]);
  assert.equal(f.view, "error");
  assert.deepEqual(f.error, { code: "full", msg: "room full" });
  f = run([msg(snap("racing")), msg(results)], f);
  assert.equal(f.view, "error");
  assert.equal(run([{ t: "fatal", code: "racing", msg: "" }]).error?.code, "racing", "refused before any welcome");
});

test("a reconnect's welcome keeps the view and learns the phase again", () => {
  const f = run([msg(welcome), msg(snap("racing")), msg(welcome)]);
  assert.equal(f.view, "race", "no grid flash mid-race");
  assert.equal(f.phase, null);
  assert.equal(run([msg(welcome), msg(snap("grid")), msg(welcome)]).view, "grid");
  assert.equal(run([msg(snap("racing"))], f).view, "race");
  assert.equal(run([{ t: "retry" }], f).view, "connecting");
});
