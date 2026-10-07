import { test } from "node:test";
import assert from "node:assert/strict";
import { ABS, BrakeBias, defaultSetup, Diff, TC, type Setup } from "../car/car.ts";
import { liveStep } from "./live.ts";

test("one press, one step, within the setup ranges", () => {
  const s = defaultSetup(); // bb 58, diff 5, tc 1, abs 1
  assert.deepEqual(liveStep(s, "bbFwd", false), { setup: [6, 6, 59, 3, 5, 5, 1, 1], index: BrakeBias, moved: true });
  assert.deepEqual(liveStep(s, "bbBack", false).setup[BrakeBias], 57);
  assert.deepEqual(liveStep(s, "diffUp", false), { setup: [6, 6, 58, 3, 6, 5, 1, 1], index: Diff, moved: true });
  assert.equal(liveStep(s, "diffDown", false).setup[Diff], 4);
  assert.deepEqual(liveStep(s, "tcUp", false), { setup: [6, 6, 58, 3, 5, 5, 2, 1], index: TC, moved: true });
  assert.equal(liveStep(s, "tcDown", false).setup[TC], 0);
  assert.deepEqual(liveStep(s, "absUp", false), { setup: [6, 6, 58, 3, 5, 5, 1, 2], index: ABS, moved: true });
  assert.equal(liveStep(s, "absDown", false).setup[ABS], 0);
  assert.deepEqual(s, defaultSetup(), "the input is not changed");
});

test("at a limit nothing changes", () => {
  const lo: Setup = [6, 6, 50, 3, 1, 5, 0, 0];
  const hi: Setup = [6, 6, 70, 3, 10, 5, 3, 3];
  const at = [BrakeBias, Diff, TC, ABS];
  (["bbBack", "diffDown", "tcDown", "absDown"] as const).forEach((a, k) => assert.deepEqual(liveStep(lo, a, false), { setup: lo, index: at[k], moved: false }, a));
  (["bbFwd", "diffUp", "tcUp", "absUp"] as const).forEach((a, k) => assert.deepEqual(liveStep(hi, a, false), { setup: hi, index: at[k], moved: false }, a));
});

test("Arcade: TC and ABS are the room's; brake bias and diff still move", () => {
  const s = defaultSetup();
  for (const a of ["tcDown", "tcUp"] as const) assert.deepEqual(liveStep(s, a, true), { setup: s, index: TC, moved: false }, a);
  for (const a of ["absDown", "absUp"] as const) assert.deepEqual(liveStep(s, a, true), { setup: s, index: ABS, moved: false }, a);
  assert.equal(liveStep(s, "bbFwd", true).moved, true);
  assert.equal(liveStep(s, "diffUp", true).moved, true);
});
