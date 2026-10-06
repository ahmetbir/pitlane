import { test } from "node:test";
import assert from "node:assert/strict";
import { LapTimer, traceAt } from "./laptimer.ts";

const L = 1000;

test("trace lookup interpolates and refuses outside", () => {
  const tr = { d: [0, 100, 300], t: [0, 2000, 4000] };
  assert.equal(traceAt(tr, 50), 1000);
  assert.equal(traceAt(tr, 200), 3000);
  assert.equal(traceAt(tr, 300), 4000);
  assert.equal(traceAt(tr, 301), null);
  assert.equal(traceAt({ d: [], t: [] }, 0), null);
});

test("current, last and best from the race clock and the server's laps", () => {
  const lt = new LapTimer(L);
  lt.reset(true);
  lt.snap(0, -40);
  assert.equal(lt.current(), 0);
  lt.snap(30500, 900);
  assert.equal(lt.current(), 30500);
  lt.lap(1, 32000, true, 32000);
  lt.snap(33000, 1050);
  assert.equal(lt.current(), 1000, "lap 2 began at the sum of the laps before it");
  assert.equal(lt.last(), 32000);
  assert.equal(lt.best(), 32000);
  assert.equal(lt.delta(), null, "lap 1 starts from the grid: never a reference");
});

test("live delta against the best flying lap", () => {
  const lt = new LapTimer(L);
  lt.reset(true);
  lt.lap(1, 40000, true, 40000);
  // Lap 2: 25 m/s → 40 s for 1000 m.
  for (let t = 0; t <= 40000; t += 1000) lt.snap(40000 + t, L + (t / 1000) * 25);
  lt.lap(2, 40000, true, 40000);
  assert.equal(lt.delta(), 0, "on the line: level");
  // Lap 3: 1 s down at 500 m.
  lt.snap(80000 + 21000, 2 * L + 500);
  assert.equal(lt.current(), 21000);
  assert.equal(lt.delta(), 1000);
  lt.snap(80000 + 21500, 2 * L + 600);
  assert.equal(lt.delta(), -2500, "gaining: negative");
});

test("an invalid lap never becomes the reference", () => {
  const lt = new LapTimer(L);
  lt.reset(true);
  lt.lap(1, 40000, true, 40000);
  for (let t = 0; t <= 30000; t += 1000) lt.snap(40000 + t, L + (t / 1000) * (L / 30));
  lt.lap(2, 30000, false, 40000);
  lt.snap(70000 + 5000, 2 * L + 100);
  assert.equal(lt.delta(), null);
  assert.equal(lt.best(), 40000);
  assert.equal(lt.last(), 30000);
});

test("joined mid-race: the lap start is unknown until the next line", () => {
  const lt = new LapTimer(L);
  lt.reset(false, 2);
  lt.snap(90000, 2 * L + 300);
  assert.equal(lt.current(), null);
  assert.equal(lt.lapsDone(), 2);
  lt.snap(100000, 3 * L - 1);
  lt.lap(3, 45000, true, 45000);
  lt.snap(101000, 3 * L + 20);
  assert.equal(lt.current(), 1000);
});
