// Port of internal/track's queries. The circuit itself is not rebuilt here:
// kiyi.json is the Go-sampled track (cmd/vectors), and these functions are
// line-by-line ports of WallLat, SurfaceAt, frame, Point and Locate.
//
// Conventions: x right, z forward on a flat plane; heading from +X
// counter-clockwise; the left normal of tangent (tx, tz) is (−tz, tx);
// lateral offsets are positive to the left.

import kiyiData from "./kiyi.json" with { type: "json" };

export const Surface = { Asphalt: 0, Kerb: 1, Grass: 2, Wall: 3 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** One 2 m sample: centre, unit tangent, unit left normal, distance from start, signed curvature. */
export interface Seg {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  s: number;
  k: number;
}

/** A position with heading (0 = +X, CCW positive). */
export interface Pose {
  x: number;
  z: number;
  h: number;
}

/** Locate's result: nearest seg (keep it as the next hint), lateral offset (left +), distance along. */
export interface Location {
  i: number;
  lat: number;
  s: number;
}

/** The JSON shape cmd/vectors writes. */
export interface TrackData {
  id: string;
  width: number;
  kerb: number;
  runoff: number;
  length: number;
  sectors: number[];
  grid: number[][];
  segs: number[][];
  line: number[];
}

export class Track {
  readonly id: string;
  readonly width: number;
  readonly kerb: number;
  readonly runoff: number;
  readonly length: number;
  readonly segs: readonly Seg[];
  readonly sectors: readonly number[];
  readonly grid: readonly Pose[];
  readonly line: readonly number[];

  constructor(d: TrackData) {
    this.id = d.id;
    this.width = d.width;
    this.kerb = d.kerb;
    this.runoff = d.runoff;
    this.length = d.length;
    this.segs = d.segs.map(([x, z, tx, tz, nx, nz, s, k]) => ({ x, z, tx, tz, nx, nz, s, k }));
    this.sectors = d.sectors.slice();
    this.grid = d.grid.map(([x, z, h]) => ({ x, z, h }));
    this.line = d.line.slice();
  }

  private ds(): number {
    return this.length / this.segs.length;
  }

  /** Lateral distance at which the wall starts. */
  wallLat(): number {
    return this.width / 2 + this.kerb + this.runoff;
  }

  /** Classifies a lateral offset. */
  surfaceAt(lat: number): Surface {
    const a = Math.abs(lat);
    if (a <= this.width / 2) return Surface.Asphalt;
    if (a <= this.width / 2 + this.kerb) return Surface.Kerb;
    if (a <= this.wallLat()) return Surface.Grass;
    return Surface.Wall;
  }

  // frame returns the interpolated centre, tangent and normal at continuous index u.
  private frame(u: number): [number, number, number, number, number, number] {
    const n = this.segs.length;
    const fi = Math.floor(u);
    const f = u - fi;
    const i = ((fi % n) + n) % n;
    const a = this.segs[i], b = this.segs[(i + 1) % n];
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    let tx = a.tx + (b.tx - a.tx) * f, tz = a.tz + (b.tz - a.tz) * f;
    const l = Math.sqrt(tx * tx + tz * tz);
    tx = tx / l;
    tz = tz / l;
    return [x, z, tx, tz, -tz, tx];
  }

  /** Inverse of locate: world position at distance s along the track, lat to the left. */
  point(s: number, lat: number): [number, number] {
    const [x, z, , , nx, nz] = this.frame(s / this.ds());
    return [x + lat * nx, z + lat * nz];
  }

  /**
   * Finds the nearest seg to (x, z). With hint >= 0 only segs within ±40 of
   * hint (cyclic) are searched, falling back to a full search when the hint is
   * stale; hint < 0 searches all.
   */
  locate(x: number, z: number, hint: number): Location {
    const segs = this.segs;
    const n = segs.length;
    let best = 0, bd = Infinity;
    const tryK = (k: number): void => {
      const dx = x - segs[k].x, dz = z - segs[k].z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        best = k;
        bd = d;
      }
    };
    if (hint < 0) {
      for (let k = 0; k < n; k++) tryK(k);
    } else {
      for (let o = -40; o <= 40; o++) tryK((((hint + o) % n) + n) % n);
      // A stale hint finds only a distant or edge-of-window seg: search everything.
      const w = this.wallLat();
      if (bd > w * w || edgeOffset(best, hint, n)) {
        bd = Infinity;
        for (let k = 0; k < n; k++) tryK(k);
      }
    }
    const ds = this.ds();
    let u = best;
    for (let it = 0; it < 8; it++) {
      const [cx, cz, tx, tz] = this.frame(u);
      u += ((x - cx) * tx + (z - cz) * tz) / ds;
    }
    const [cx, cz, , , nx, nz] = this.frame(u);
    const lat = (x - cx) * nx + (z - cz) * nz;
    let s = (u * ds) % this.length;
    if (s < 0) s += this.length;
    return { i: best, lat, s };
  }
}

// edgeOffset reports whether best sits on the edge of the ±40 window around hint.
function edgeOffset(best: number, hint: number, n: number): boolean {
  const d = (((best - hint) % n) + n) % n;
  return d === 40 || d === n - 40;
}

let cached: Track | undefined;

/** The Kiyi circuit, loaded once from kiyi.json. Read-only: never mutate it. */
export function kiyi(): Track {
  cached ??= new Track(kiyiData as TrackData);
  return cached;
}
