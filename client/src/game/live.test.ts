import { test } from "node:test";
import assert from "node:assert/strict";
import { ABS, BrakeBias, defaultSetup, Diff, TC, type Setup } from "../car/car.ts";
import { liveStep } from "./live.ts";

test("one press, one step, within the setup ranges", () => {
  const s = defaultSetup(); // bb 58, diff 5, tc 1, abs 1
  assert.deepEqual(liveStep(s, "bbFwd", false), { setup: [6, 6, 59, 3, 5, 5, 1, 1], changed: BrakeBias });
  assert.deepEqual(liveStep(s, "bbBack", false).setup[BrakeBias], 57);
  assert.deepEqual(liveStep(s, "diffUp", false), { setup: [6, 6, 58, 3, 6, 5, 1, 1], changed: Diff });
  assert.equal(liveStep(s, "diffDown", false).setup[Diff], 4);
  assert.deepEqual(liveStep(s, "tcUp", false), { setup: [6, 6, 58, 3, 5, 5, 2, 1], changed: TC });
  assert.equal(liveStep(s, "tcDown", false).setup[TC], 0);
  assert.deepEqual(liveStep(s, "absUp", false), { setup: [6, 6, 58, 3, 5, 5, 1, 2], changed: ABS });
  assert.equal(liveStep(s, "absDown", false).setup[ABS], 0);
  assert.deepEqual(s, defaultSetup(), "the input is not changed");
});

test("at a limit nothing changes", () => {
  const lo: Setup = [6, 6, 50, 3, 1, 5, 0, 0];
  const hi: Setup = [6, 6, 70, 3, 10, 5, 3, 3];
  for (const a of ["bbBack", "diffDown", "tcDown", "absDown"] as const) assert.deepEqual(liveStep(lo, a, false), { setup: lo, changed: -1 }, a);
  for (const a of ["bbFwd", "diffUp", "tcUp", "absUp"] as const) assert.deepEqual(liveStep(hi, a, false), { setup: hi, changed: -1 }, a);
});

test("Arcade: TC and ABS are the room's; brake bias and diff still move", () => {
  const s = defaultSetup();
  for (const a of ["tcDown", "tcUp", "absDown", "absUp"] as const) assert.deepEqual(liveStep(s, a, true), { setup: s, changed: -1 }, a);
  assert.equal(liveStep(s, "bbFwd", true).changed, BrakeBias);
  assert.equal(liveStep(s, "diffUp", true).changed, Diff);
});
