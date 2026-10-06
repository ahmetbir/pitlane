import { test } from "node:test";
import assert from "node:assert/strict";
import { Handling, newParams, type State } from "../car/car.ts";
import { moveCar } from "../race/world.ts";
import { kiyi } from "../track/track.ts";
import { AutoDriver } from "./autodrive.ts";

test("the debug driver laps from the pole without touching a wall", () => {
  const t = kiyi(), g = t.grid[0];
  const st: State = { x: g.x, z: g.z, h: g.h, hx: Math.cos(g.h), hz: Math.sin(g.h), vx: 0, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 1, ax: 0, dmg: { frontWing: 0, rearWing: 0, susp: 0 } };
  const p = newParams(Handling.Arcade, [6, 6, 58, 3, 5, 5], st.dmg);
  const d = new AutoDriver(t, 17);
  const hint = { i: -1 };
  let s = t.locate(st.x, st.z, -1).s, dist = 0, ticks = 0, worst = 0;
  while (dist < t.length && ticks < 60 * 150) {
    assert.equal(moveCar(st, p, d.input(st, s), t, hint).impulse, 0, `wall at s=${s.toFixed(0)}`);
    const loc = t.locate(st.x, st.z, hint.i);
    dist += ((loc.s - s + 1.5 * t.length) % t.length) - t.length / 2;
    s = loc.s;
    worst = Math.max(worst, Math.abs(loc.lat));
    ticks++;
  }
  assert.ok(dist >= t.length, `lapped only ${dist.toFixed(0)} m`);
  assert.ok(worst < t.wallLat() - 5, `widest ${worst.toFixed(1)} m`);
});
