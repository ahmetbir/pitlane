// A small geometry builder: vertex-coloured triangles appended into one
// BufferGeometry, so a whole family of static parts costs one draw call.
// Faces are oriented by an outward hint instead of by hand-kept winding.
import * as THREE from "three";

export type V3 = readonly [number, number, number];

const tmp = new THREE.Color();

/** Linear-space colour of a CSS colour (vertex colours are linear). */
function rgb(c: string | THREE.Color): THREE.Color {
  return typeof c === "string" ? tmp.set(c) : c;
}

export class Mesher {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  /** Adds a shared vertex (for smooth ribbons); returns its index. */
  vertex(p: V3, n: V3, c: string | THREE.Color, u = 0, v = 0): number {
    const k = rgb(c);
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(k.r, k.g, k.b);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /** Quad a-b-c-d over shared vertices, wound so its normal agrees with want. */
  quad(a: number, b: number, c: number, d: number, want: V3): void {
    const n = this.normalOf(a, b, c);
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(a, c, b, a, d, c);
  }

  /** Flat convex polygon with its own vertices, facing toward out. */
  face(pts: readonly V3[], c: string | THREE.Color, out: V3): void {
    const n = newell(pts);
    const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    const s = flip ? -1 : 1;
    const nn: V3 = [n[0] * s, n[1] * s, n[2] * s];
    const ix = pts.map((p) => this.vertex(p, nn, c));
    for (let i = 1; i + 1 < ix.length; i++) {
      if (flip) this.idx.push(ix[0], ix[i + 1], ix[i]);
      else this.idx.push(ix[0], ix[i], ix[i + 1]);
    }
  }

  /** Axis-aligned box (before yaw about its centre's Y), size sx × sy × sz. */
  box(c: V3, size: V3, colour: string | THREE.Color, yaw = 0): void {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const p = (x: number, y: number, z: number): V3 => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
    const d = (x: number, y: number, z: number): V3 => [x * cs + z * sn, y, -x * sn + z * cs];
    const k = typeof colour === "string" ? new THREE.Color(colour) : colour.clone();
    this.face([p(hx, -hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(hx, -hy, hz)], k, d(1, 0, 0));
    this.face([p(-hx, -hy, -hz), p(-hx, hy, -hz), p(-hx, hy, hz), p(-hx, -hy, hz)], k, d(-1, 0, 0));
    this.face([p(-hx, hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(-hx, hy, hz)], k, d(0, 1, 0));
    this.face([p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz)], k, d(0, -1, 0));
    this.face([p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz)], k, d(0, 0, 1));
    this.face([p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz)], k, d(0, 0, -1));
  }

  /** A square-section bar of width w from a to b (struts, tubes). */
  beam(a: V3, b: V3, w: number, colour: string | THREE.Color): void {
    const ax = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = ax.length();
    if (len < 1e-6) return;
    ax.divideScalar(len);
    const ref = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ax, ref).normalize().multiplyScalar(w / 2);
    const v = new THREE.Vector3().crossVectors(ax, u).normalize().multiplyScalar(w / 2);
    const k = typeof colour === "string" ? new THREE.Color(colour) : colour.clone();
    const corner = (p: V3, su: number, sv: number): V3 => [p[0] + u.x * su + v.x * sv, p[1] + u.y * su + v.y * sv, p[2] + u.z * su + v.z * sv];
    const sides: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [su0, sv0] = sides[i], [su1, sv1] = sides[(i + 1) % 4];
      const o: V3 = [u.x * (su0 + su1) + v.x * (sv0 + sv1), u.y * (su0 + su1) + v.y * (sv0 + sv1), u.z * (su0 + su1) + v.z * (sv0 + sv1)];
      this.face([corner(a, su0, sv0), corner(b, su0, sv0), corner(b, su1, sv1), corner(a, su1, sv1)], k, o);
    }
    this.face(sides.map(([su, sv]) => corner(a, su, sv)), k, [-ax.x, -ax.y, -ax.z]);
    this.face(sides.map(([su, sv]) => corner(b, su, sv)), k, [ax.x, ax.y, ax.z]);
  }

  /**
   * Prism of `sides` faces around an axis from base to base + axis·len, radius r
   * (wheels, tyre stacks, posts); cap colours for both ends, null leaves an end open.
   */
  prism(base: V3, axis: V3, len: number, r: number, sides: number, side: string, cap: string | null, cap0: string | null = cap): void {
    const a = new THREE.Vector3(...axis).normalize();
    const ref = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(a, ref).normalize();
    const v = new THREE.Vector3().crossVectors(a, u).normalize();
    const ring = (t: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < sides; i++) {
        const q = (2 * Math.PI * (i + 0.5)) / sides;
        const cx = Math.cos(q) * r, cy = Math.sin(q) * r;
        out.push([base[0] + a.x * t + u.x * cx + v.x * cy, base[1] + a.y * t + u.y * cx + v.y * cy, base[2] + a.z * t + u.z * cx + v.z * cy]);
      }
      return out;
    };
    const r0 = ring(0), r1 = ring(len);
    const sk = new THREE.Color(side);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const q = (2 * Math.PI * (i + 1)) / sides;
      const o: V3 = [u.x * Math.cos(q) + v.x * Math.sin(q), u.y * Math.cos(q) + v.y * Math.sin(q), u.z * Math.cos(q) + v.z * Math.sin(q)];
      this.face([r0[i], r0[j], r1[j], r1[i]], sk, o);
    }
    if (cap0 !== null) this.face(r0, new THREE.Color(cap0), [-a.x, -a.y, -a.z]);
    if (cap !== null) this.face(r1, new THREE.Color(cap), [a.x, a.y, a.z]);
  }

  /** Open cone (no base) of `sides` faces, apex straight above base by h. */
  cone(base: V3, r: number, h: number, sides: number, colour: string): void {
    const k = new THREE.Color(colour);
    const apex: V3 = [base[0], base[1] + h, base[2]];
    const slope = r / h;
    for (let i = 0; i < sides; i++) {
      const q0 = (2 * Math.PI * i) / sides, q1 = (2 * Math.PI * (i + 1)) / sides, qm = (q0 + q1) / 2;
      const p0: V3 = [base[0] + Math.cos(q0) * r, base[1], base[2] + Math.sin(q0) * r];
      const p1: V3 = [base[0] + Math.cos(q1) * r, base[1], base[2] + Math.sin(q1) * r];
      this.face([p0, p1, apex], k, [Math.cos(qm), slope, Math.sin(qm)]);
    }
  }

  /** A convex Three geometry centred on its origin, moved to at, flat-shaded in one colour. */
  convex(g: THREE.BufferGeometry, at: V3, colour: string): void {
    const k = new THREE.Color(colour);
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute("position");
    for (let i = 0; i + 2 < p.count; i += 3) {
      const tri: V3[] = [0, 1, 2].map((o) => [p.getX(i + o) + at[0], p.getY(i + o) + at[1], p.getZ(i + o) + at[2]] as V3);
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      this.face(tri, k, [cx, cy, cz]);
    }
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** The accumulated geometry (positions, normals, colours, uvs, index). */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private normalOf(a: number, b: number, c: number): V3 {
    const p = this.pos;
    const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
    const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
}

// newell returns the unit normal of a planar polygon (any winding).
function newell(pts: readonly V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
