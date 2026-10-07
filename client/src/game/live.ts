// The live setup controls (the wheel's): one press moves brake bias by 1 %, or
// the diff, TC or ABS by one step, within the setup ranges. In an Arcade room
// TC and ABS are the room's, so their presses change nothing.
import { ABS, BrakeBias, clampSetup, Diff, TC, type Setup } from "../car/car.ts";
import type { LiveAction } from "../input/bindings.ts";

const STEP: Record<LiveAction, readonly [index: number, delta: number]> = {
  tcDown: [TC, -1], tcUp: [TC, 1],
  absDown: [ABS, -1], absUp: [ABS, 1],
  bbBack: [BrakeBias, -1], bbFwd: [BrakeBias, 1],
  diffDown: [Diff, -1], diffUp: [Diff, 1],
};

/** s after one press of a, and the setup index that moved (−1: none, at a limit or locked by Arcade). */
export function liveStep(s: Readonly<Setup>, a: LiveAction, arcade: boolean): { setup: Setup; changed: number } {
  const [i, d] = STEP[a];
  const out = s.slice() as Setup;
  if (arcade && (i === TC || i === ABS)) return { setup: out, changed: -1 };
  out[i] += d;
  const setup = clampSetup(out);
  return { setup, changed: setup[i] !== s[i] ? i : -1 };
}
