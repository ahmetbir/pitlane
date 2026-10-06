// Track-frame helpers shared by the circuit meshes: world points and
// directions at a seg or a distance, and per-chunk meshers so long runs of
// static geometry split into a few cullable meshes.
import * as THREE from "three";
import type { Track } from "../track/track.ts";
import { Mesher, type V3 } from "./mesher.ts";

export const UP: V3 = [0, 1, 0];

/** World point at seg i (cyclic), lateral lat (left +), height y. */
export function at(t: Track, i: number, lat: number, y: number): V3 {
  const n = t.segs.length;
  const s = t.segs[((i % n) + n) % n];
  return [s.x + lat * s.nx, y, -(s.z + lat * s.nz)];
}

/** World direction of seg i's left normal times sign. */
export function side(t: Track, i: number, sign: number): V3 {
  const s = t.segs[((i % t.segs.length) + t.segs.length) % t.segs.length];
  return [sign * s.nx, 0, -sign * s.nz];
}

/** World point at distance s (interpolated), lateral lat, height y. */
export function atS(t: Track, s: number, lat: number, y: number): V3 {
  const [x, z] = t.point(s, lat);
  return [x, y, -z];
}

export function forwardOf(t: Track, i: number): V3 {
  const s = t.segs[((i % t.segs.length) + t.segs.length) % t.segs.length];
  return [s.tx, 0, -s.tz];
}

export function scale(v: V3, k: number): V3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function lerpV(p: V3, q: V3, f: number): V3 {
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
}

/** Heading of the centre line at distance s. */
export function headingAt(t: Track, s: number): number {
  const [x0, z0] = t.point(s, 0), [x1, z1] = t.point(s + 1, 0);
  return Math.atan2(z1 - z0, x1 - x0);
}

/** count meshers, each owning a contiguous run of segs (by track distance). */
export class Chunks {
  private readonly segs: number;
  private readonly ms: Mesher[];

  constructor(segs: number, count: number) {
    this.segs = segs;
    this.ms = Array.from({ length: count }, () => new Mesher());
  }

  /** The mesher owning seg i (cyclic). */
  at(i: number): Mesher {
    const k = ((i % this.segs) + this.segs) % this.segs;
    return this.ms[Math.floor((k * this.ms.length) / this.segs)];
  }

  /** The non-empty chunks' geometries. */
  geometries(): THREE.BufferGeometry[] {
    return this.ms.filter((m) => m.triangleCount > 0).map((m) => m.build());
  }
}
