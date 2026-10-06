import { test } from "node:test";
import assert from "node:assert/strict";
import { DT } from "../car/car.ts";
import { ticks } from "./loop.ts";

test("fixed step: 60 Hz ticks from any frame rate, remainder carried", () => {
  let acc = 0, n = 0;
  for (let i = 0; i < 144; i++) {
    const k = ticks(acc, 1 / 144);
    acc = k.acc;
    n += k.n;
  }
  assert.ok(n === 59 || n === 60, `${n} ticks in one second at 144 fps`);
  assert.deepEqual(ticks(0, 0), { n: 0, acc: 0 });
  const k = ticks(0, DT * 2.5);
  assert.equal(k.n, 2);
  assert.ok(Math.abs(k.acc - DT / 2) < 1e-12);
});

test("a long stall is not caught up", () => {
  const k = ticks(0, 5);
  assert.equal(k.n, 8);
  assert.ok(k.acc <= DT);
  assert.equal(ticks(0, -1).n, 0);
});
