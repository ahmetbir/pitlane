// Trackside scenery, deterministic per track: tyre barriers on the outside
// of corners, the start gantry and its lights, a grandstand on the main
// straight and pines beyond the barriers. Static parts go into the caller's
// chunks; the lights are their own instanced mesh.
import * as THREE from "three";
import type { Track } from "../track/track.ts";
import { toWorld, yawOf } from "./frame.ts";
import { type V3 } from "./mesher.ts";
import { BUILT, CROWD, LIGHT } from "./palette.ts";
import { at, atS, Chunks, forwardOf, headingAt, lerpV, scale, side, UP } from "./trackgeo.ts";

const CORNER_K = 0.008;   // 1/m: corners for tyre barriers
const TYRE_R = 0.38;
const TYRE_STACK_H = 0.8; // the wall's height
const TYRE_ZONE = 8;      // segs past either end of a corner
const GANTRY_H = 7.4;
const LAMP_Y = 5.9;
const STAND_TIERS = 8;
const TREES = 360;
export const LAMP_COLS = 5;

/** Per side (+1 left, −1 right), the segs whose barrier is a tyre wall: the outside of every corner around its apex. */
export function tyreZones(t: Track): Map<number, Set<number>> {
  const n = t.segs.length;
  const zones = new Map<number, Set<number>>([[1, new Set()], [-1, new Set()]]);
  const bent = (i: number) => Math.abs(t.segs[((i % n) + n) % n].k) > CORNER_K;
  let start = 0;
  while (start < n && bent(start)) start++; // begin on a straight so no corner wraps unseen
  if (start === n) return zones;
  for (let a = start; a < start + n; a++) {
    if (!bent(a)) continue;
    let b = a, apex = a;
    while (bent(b + 1) && b + 1 < start + n) {
      b++;
      if (Math.abs(t.segs[b % n].k) > Math.abs(t.segs[apex % n].k)) apex = b;
    }
    const outside = t.segs[apex % n].k > 0 ? -1 : 1; // k > 0 turns left: the outside is the right
    for (let k = a - TYRE_ZONE; k <= b + TYRE_ZONE; k++) zones.get(outside)!.add(((k % n) + n) % n);
    a = b;
  }
  return zones;
}

/** Stacks tyres shoulder to shoulder along the wall line of each zone, into the seg's chunk. */
export function tyreBarriers(t: Track, ch: Chunks, tyres: Map<number, Set<number>>): void {
  const lat = t.wallLat() + TYRE_R, pitch = 2 * TYRE_R + 0.02;
  for (const [sg, zone] of tyres) {
    let carry = 0, stack = 0;
    for (const i of [...zone].sort((a, b) => a - b)) {
      const p0 = at(t, i, sg * lat, 0), p1 = at(t, i + 1, sg * lat, 0);
      const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      if (!zone.has((i - 1 + t.segs.length) % t.segs.length)) carry = 0;
      for (let d = carry; d < len; d += pitch) {
        const f = d / len;
        const base: V3 = [p0[0] + (p1[0] - p0[0]) * f, 0, p0[2] + (p1[2] - p0[2]) * f];
        // One hexagonal prism per stack; the colour alternates along the barrier so it reads at speed.
        const k = stack++;
        const colour = k % 4 === 3 ? BUILT.wallBandAlt : k % 2 ? BUILT.tyreAlt : BUILT.tyre;
        ch.at(i).prism(base, UP, TYRE_STACK_H, TYRE_R, 6, colour, BUILT.tyreAlt, null);
      }
      carry = (((carry - len) % pitch) + pitch) % pitch;
    }
  }
}

/** The gantry spanning the track at s = 0, posts behind both walls. */
export function gantry(t: Track, ch: Chunks): void {
  const m = ch.at(0);
  const reach = t.wallLat() + 0.9;
  const steel = BUILT.steel;
  for (const sg of [1, -1]) {
    const base = atS(t, 0, sg * reach, 0);
    m.prism(base, UP, GANTRY_H + 0.4, 0.28, 8, steel, steel);
  }
  for (const y of [GANTRY_H, GANTRY_H - 0.7]) m.beam(atS(t, 0, reach, y), atS(t, 0, -reach, y), 0.32, steel);
  for (let l = -reach + 2; l < reach - 1; l += 2.5) {
    const flip = Math.round((l + reach) / 2.5) % 2 ? 1 : -1;
    m.beam(atS(t, 0, l, GANTRY_H - 0.7), atS(t, 0, l + 2.5 * flip * 0.5, GANTRY_H), 0.12, steel);
  }
  const yaw = yawOf(headingAt(t, 0));
  m.box(atS(t, 0, 0, LAMP_Y), [0.3, 1.3, 4.8], BUILT.panel, yaw);
  for (const l of [-1.8, 1.8]) m.beam(atS(t, 0, l, LAMP_Y + 0.6), atS(t, 0, l, GANTRY_H - 0.7), 0.1, steel);
}

/** Lamp instance k → column 0..4 (0 lights first, leftmost seen from the grid). */
export function lampColumn(k: number): number {
  return Math.floor(k / 2);
}

/** The ten start lamps on the gantry panel as one instanced mesh, all off. */
export function startLights(t: Track): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(0.42, 0.34, 0.34);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, LAMP_COLS * 2);
  const h = headingAt(t, 0), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOf(h));
  const one = new THREE.Vector3(1, 1, 1), off = new THREE.Color(LIGHT.off), mtx = new THREE.Matrix4();
  for (let k = 0; k < LAMP_COLS * 2; k++) {
    const col = lampColumn(k), row = k % 2;
    const p = atS(t, 0, (2 - col) * 0.85, LAMP_Y + (row ? 0.28 : -0.28));
    mesh.setMatrixAt(k, mtx.compose(new THREE.Vector3(...p), q, one));
    mesh.setColorAt(k, off);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "startLights";
  return mesh;
}

/** Segs [a, b] (b ≥ a, cyclic indices) of the straight around the start line. */
function mainStraight(t: Track): [number, number] {
  const n = t.segs.length, flat = (i: number) => Math.abs(t.segs[((i % n) + n) % n].k) < 0.0015;
  let a = 0, b = 0;
  while (a > -45 && flat(a - 1)) a--;
  while (b < 45 && flat(b + 1)) b++;
  return [a, b];
}

/** Stepped tiers of spectators outside the right wall of the main straight, under a roof. */
export function grandstand(t: Track, ch: Chunks): void {
  const [a, b] = mainStraight(t);
  const L = (k: number) => -(t.wallLat() + 2.5 + k * 1.1); // tier k's front edge (right side: lat < 0)
  const Y = (k: number) => 0.9 + k * 0.6;                   // tier k's floor height
  const stand = new THREE.Color(BUILT.stand);
  const rnd = prng(fnv1a(t.id + ":stand"));
  for (let i = a; i < b; i++) {
    const m = ch.at(i);
    const toTrack = side(t, i, 1);
    for (let k = 0; k < STAND_TIERS; k++) {
      m.face([at(t, i, L(k), Y(k)), at(t, i + 1, L(k), Y(k)), at(t, i + 1, L(k + 1), Y(k)), at(t, i, L(k + 1), Y(k))], stand, UP);
      // The riser is the crowd: two colours per seg and tier.
      const y0 = k === 0 ? 0 : Y(k - 1);
      for (let h = 0; h < 2; h++) {
        const c = CROWD[Math.floor(rnd() * CROWD.length)];
        const p0 = lerpV(at(t, i, L(k), 0), at(t, i + 1, L(k), 0), h / 2), p1 = lerpV(at(t, i, L(k), 0), at(t, i + 1, L(k), 0), (h + 1) / 2);
        m.face([[p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], Y(k), p1[2]], [p0[0], Y(k), p0[2]]], c, toTrack);
      }
    }
    const top = Y(STAND_TIERS - 1), back = L(STAND_TIERS), roofY = top + 2.8;
    m.face([at(t, i, back, 0), at(t, i + 1, back, 0), at(t, i + 1, back, roofY), at(t, i, back, roofY)], stand, side(t, i, -1));
    // Roof: white on top, grey below, a coloured fascia toward the track.
    const front = L(0) + 1.2;
    m.face([at(t, i, front, roofY), at(t, i + 1, front, roofY), at(t, i + 1, back, roofY), at(t, i, back, roofY)], BUILT.roof, UP);
    m.face([at(t, i, front, roofY - 0.15), at(t, i + 1, front, roofY - 0.15), at(t, i + 1, back, roofY - 0.15), at(t, i, back, roofY - 0.15)], BUILT.stand, [0, -1, 0]);
    m.face([at(t, i, front, roofY - 0.6), at(t, i + 1, front, roofY - 0.6), at(t, i + 1, front, roofY), at(t, i, front, roofY)], BUILT.wallBand, toTrack);
    if ((i - a) % 8 === 0) m.beam(at(t, i, front + 0.3, 0), at(t, i, front + 0.3, roofY - 0.6), 0.25, BUILT.steel);
  }
  for (const [i, out] of [[a, -1], [b, 1]] as const) {
    const m = ch.at(i);
    const dir = scale(forwardOf(t, i), out);
    for (let k = 0; k < STAND_TIERS; k++) {
      m.face([at(t, i, L(k), 0), at(t, i, L(k + 1), 0), at(t, i, L(k + 1), Y(k)), at(t, i, L(k), Y(k))], stand, dir);
    }
  }
}

/** Pines beyond the barriers, each into the chunk of its nearest seg. */
export function trees(t: Track, ch: Chunks): void {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of t.segs) {
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
  }
  const rnd = prng(fnv1a(t.id + ":trees"));
  const clear = t.wallLat() + 16, pad = 220;
  let placed = 0;
  for (let tries = 0; placed < TREES && tries < TREES * 20; tries++) {
    const x = x0 - pad + rnd() * (x1 - x0 + 2 * pad), z = z0 - pad + rnd() * (z1 - z0 + 2 * pad);
    const sc = 0.8 + rnd() * 0.9, leaf = rnd() < 0.5 ? BUILT.leaf : BUILT.leafAlt;
    const [i, d] = nearest(t, x, z);
    if (d < clear) continue;
    const m = ch.at(i), base = toWorld(x, z);
    m.prism([base.x, 0, base.z], UP, 1.6 * sc, 0.22 * sc, 5, BUILT.trunk, null, null);
    m.cone([base.x, 1.2 * sc, base.z], 1.9 * sc, 3.2 * sc, 7, leaf);
    m.cone([base.x, 3.0 * sc, base.z], 1.35 * sc, 2.6 * sc, 7, leaf);
    placed++;
  }
}

/** Nearest seg to (x, z) and its distance. */
function nearest(t: Track, x: number, z: number): [number, number] {
  let best = Infinity, at = 0;
  t.segs.forEach((s, i) => {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < best) [best, at] = [d, i];
  });
  return [at, Math.sqrt(best)];
}

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: uniform [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
