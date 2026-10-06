import { test } from "node:test";
import assert from "node:assert/strict";
import { Handling, newParams, step, type State } from "../car/car.ts";
import { kiyi } from "../track/track.ts";
import { envFor, moveCar, type Hint } from "./world.ts";

const tr = kiyi();
const p = newParams(Handling.Sim, [6, 6, 58, 3, 5, 5], { frontWing: 0, rearWing: 0, susp: 0 });

// carAt places a car at distance s, offset lat, heading along the track rotated by turn (rad, left +).
function carAt(s: number, lat: number, turn: number, vx: number): State {
  const [x, z] = tr.point(s, lat);
  const [x1, z1] = tr.point(s + 1, lat);
  const h = Math.atan2(z1 - z, x1 - x) + turn;
  return { x, z, h, hx: Math.cos(h), hz: Math.sin(h), vx, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 5, ax: 0, dmg: { frontWing: 0, rearWing: 0, susp: 0 } };
}

test("a car inside the walls steps exactly as car.step on its surface", () => {
  const a = carAt(500, 9, 0, 40), b = carAt(500, 9, 0, 40);
  const hint: Hint = { i: -1 };
  const hit = moveCar(a, p, { throttle: 1, brake: 0, steer: 0 }, tr, hint);
  step(b, p, { throttle: 1, brake: 0, steer: 0 }, envFor(tr.surfaceAt(tr.locate(b.x, b.z, -1).lat)));
  assert.deepEqual(a, b);
  assert.deepEqual(hit, { impulse: 0, nx: 0, nz: 0 });
  assert.equal(hint.i, tr.locate(a.x, a.z, -1).i);
});

test("a car driven into the barrier is held on the limit and bounces", () => {
  const limit = tr.wallLat() - 1;
  const st = carAt(500, limit - 0.05, 0.6, 50); // pointing left, into the left wall
  const hint: Hint = { i: tr.locate(st.x, st.z, -1).i };
  const hit = moveCar(st, p, { throttle: 1, brake: 0, steer: 0 }, tr, hint);
  assert.ok(hit.impulse > 0);
  assert.ok(Math.abs(Math.hypot(hit.nx, hit.nz) - 1) < 1e-9);
  const loc = tr.locate(st.x, st.z, hint.i);
  assert.ok(Math.abs(loc.lat - limit) < 1e-9, `lat ${loc.lat}`);
  // World velocity now points away from (or along) the wall.
  const wx = st.vx * st.hx - st.vy * st.hz, wz = st.vx * st.hz + st.vy * st.hx;
  assert.ok(wx * hit.nx + wz * hit.nz <= 0);
});

test("the right wall's normal points right", () => {
  const limit = tr.wallLat() - 1;
  const st = carAt(1200, -(limit - 0.05), -0.6, 50);
  const hint: Hint = { i: -1 };
  const hit = moveCar(st, p, { throttle: 1, brake: 0, steer: 0 }, tr, hint);
  assert.ok(hit.impulse > 0);
  const [x0, z0] = tr.point(1200, 0), [x1, z1] = tr.point(1200, 1); // left normal
  assert.ok(hit.nx * (x1 - x0) + hit.nz * (z1 - z0) < -0.99);
  assert.ok(Math.abs(tr.locate(st.x, st.z, hint.i).lat + limit) < 1e-9);
});
