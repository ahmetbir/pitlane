import { test } from "node:test";
import assert from "node:assert/strict";
import { COOLDOWN_MS, cooled } from "./grid.ts";

test("Ready and Start: one action per click, then disabled for the cooldown", () => {
  const b = { disabled: false };
  let runs = 0;
  const pending: { f: () => void; ms: number }[] = [];
  const click = cooled(b, () => runs++, (f, ms) => pending.push({ f, ms }));
  for (let i = 0; i < 5; i++) click();
  assert.equal(runs, 1);
  assert.equal(b.disabled, true);
  assert.deepEqual(pending.map((p) => p.ms), [COOLDOWN_MS]);
  assert.equal(COOLDOWN_MS, 1000);
  pending[0].f();
  assert.equal(b.disabled, false);
  click();
  assert.equal(runs, 2);
});
