// Port of internal/race/world.go's moveCar: one car step plus the barrier
// clamp, for the client's own-car predictor.

import { step, type Env, type Input, type Params, type State } from "../car/car.ts";
import { Surface, type Track } from "../track/track.ts";

const halfWidth = 1.0; // car half-width (m)
const wallBounce = 0.2; // normal velocity kept, reversed
const wallSlide = 0.7; // tangential velocity kept
const wallSpin = 0.5; // yaw rate kept
const bounceMass = 957.6; // Mass·(1+wallBounce), folded exactly by Go

/** The car's last seg, carried between steps as Locate's hint (-1: none). */
export interface Hint {
  i: number;
}

/** moveCar's result: wall impulse (N·s, 0 = no hit) and outward wall normal. */
export interface WallHit {
  impulse: number;
  nx: number;
  nz: number;
}

// envFor maps a surface to its grip and drag.
export function envFor(s: Surface): Env {
  switch (s) {
    case Surface.Asphalt:
      return { mu: 1, drag: 0 };
    case Surface.Kerb:
      return { mu: 0.9, drag: 0 };
  }
  return { mu: 0.55, drag: 0.9 };
}

/** Steps one car and resolves the barrier; hint is updated. */
export function moveCar(st: State, p: Params, input: Input, tr: Track, hint: Hint): WallHit {
  const { lat } = tr.locate(st.x, st.z, hint.i);
  step(st, p, input, envFor(tr.surfaceAt(lat)));

  const w = keepInside(st, tr, hint);
  if (!w) return { impulse: 0, nx: 0, nz: 0 };
  const [nx, nz] = w;
  const tx = -nz, tz = nx;
  const vx = st.vx * st.hx - st.vy * st.hz, vz = st.vx * st.hz + st.vy * st.hx; // worldVel
  let vn = vx * nx + vz * nz;
  const vt = vx * tx + vz * tz;
  let impulse = 0;
  if (vn > 0) {
    impulse = bounceMass * vn;
    vn = -wallBounce * vn;
  }
  const kt = vt * wallSlide;
  const wx = nx * vn + tx * kt, wz = nz * vn + tz * kt;
  st.vx = wx * st.hx + wz * st.hz; // setWorldVel
  st.vy = -wx * st.hz + wz * st.hx;
  st.r *= wallSpin;
  return { impulse, nx, nz };
}

// keepInside moves a car past the barrier limit back onto it (position only)
// and returns the outward wall normal, or undefined when inside; hint is updated.
function keepInside(st: State, tr: Track, hint: Hint): [number, number] | undefined {
  const { i, lat, s } = tr.locate(st.x, st.z, hint.i);
  hint.i = i;
  const limit = tr.wallLat() - halfWidth;
  if (Math.abs(lat) <= limit) return undefined;
  const sign = lat < 0 || Object.is(lat, -0) ? -1 : 1; // math.Copysign(1, lat)
  [st.x, st.z] = tr.point(s, sign * limit);

  // Outward wall normal from the track frame at s.
  const [x0, z0] = tr.point(s, 0);
  const [x1, z1] = tr.point(s, 1);
  return [sign * (x1 - x0), sign * (z1 - z0)];
}
