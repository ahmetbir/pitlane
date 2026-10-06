// The circuit as a handful of merged meshes, built deterministically from the
// sampled track: asphalt ribbon, paint (kerbs, edge lines, start line, grid
// boxes), grass, structures (walls, tyre barriers, gantry, grandstand, trees)
// and the start lights. Five draw calls for the whole circuit.
import * as THREE from "three";
import type { Track } from "../track/track.ts";
import { toWorld, yawOf } from "./frame.ts";
import { Mesher, type V3 } from "./mesher.ts";
import { BUILT, CROWD, GROUND, LIGHT } from "./palette.ts";

/** The built circuit; root goes into the scene. */
export interface TrackMesh {
  readonly root: THREE.Group;
  /** Start lights: n of 5 columns lit; out = all dark (race start). */
  setLights(n: number, out: boolean): void;
  dispose(): void;
}

const UP: V3 = [0, 1, 0];
const PAINT_Y = 0.012;    // painted lines sit just above the asphalt
const KERB_TOP = 0.05;    // kerb outer edge height
const GRASS_Y = -0.03;
const WALL_H = 0.8;
const WALL_BAND = 0.55;   // concrete below, board colour above
const WALL_T = 0.35;      // wall thickness
const CORNER_K = 0.008;   // 1/m: corners for tyre barriers
const TYRE_R = 0.38;
const TYRE_H = 0.27;     // three layers make the wall height
const TYRE_ZONE = 8;      // segs past either end of a corner
const GANTRY_H = 7.4;
const LAMP_COLS = 5;
const STAND_TIERS = 8;
const TREES = 360;

/** Builds the circuit's meshes from t. Pure Three.js objects; textures only in a browser. */
export function buildTrack(t: Track): TrackMesh {
  const root = new THREE.Group();
  root.name = "track";
  const lambert = (opts: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(opts);

  const asphalt = new THREE.Mesh(asphaltGeometry(t), lambert({ color: GROUND.asphalt, map: noiseTexture(asphaltNoise) }));
  asphalt.name = "asphalt";
  asphalt.receiveShadow = true;

  const paint = new THREE.Mesh(
    paintGeometry(t),
    lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  paint.name = "paint";
  paint.receiveShadow = true;

  const grass = grassMesh(t);

  const structures = new THREE.Mesh(structureGeometry(t), lambert({ vertexColors: true, flatShading: true }));
  structures.name = "structures";
  structures.castShadow = true;
  structures.receiveShadow = true;

  const lights = startLights(t);

  root.add(grass, asphalt, paint, structures, lights);
  return {
    root,
    setLights(n, out) {
      const on = new THREE.Color(LIGHT.on), off = new THREE.Color(LIGHT.off);
      const lit = out ? 0 : Math.max(0, Math.min(LAMP_COLS, Math.floor(n)));
      for (let k = 0; k < lights.count; k++) lights.setColorAt(k, lampColumn(k) < lit ? on : off);
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    },
    dispose() {
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        const m = o.material as THREE.MeshLambertMaterial;
        m.map?.dispose();
        m.dispose();
      });
    },
  };
}

// --- frame helpers --------------------------------------------------------

/** World point at seg i (cyclic), lateral lat (left +), height y. */
function at(t: Track, i: number, lat: number, y: number): V3 {
  const n = t.segs.length;
  const s = t.segs[((i % n) + n) % n];
  return [s.x + lat * s.nx, y, -(s.z + lat * s.nz)];
}

/** World direction of seg i's left normal times sign. */
function side(t: Track, i: number, sign: number): V3 {
  const s = t.segs[((i % t.segs.length) + t.segs.length) % t.segs.length];
  return [sign * s.nx, 0, -sign * s.nz];
}

/** World point at distance s (interpolated), lateral lat, height y. */
function atS(t: Track, s: number, lat: number, y: number): V3 {
  const [x, z] = t.point(s, lat);
  return [x, y, -z];
}

// --- asphalt --------------------------------------------------------------

/** Ribbon of two strips per seg: 3 vertices across × (segs + 1) rows (the seam row repeats seg 0 at s = length). */
export function asphaltGeometry(t: Track): THREE.BufferGeometry {
  const m = new Mesher();
  const n = t.segs.length, hw = t.width / 2;
  const row: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i === n ? t.length : t.segs[i].s;
    row.push([hw, 0, -hw].map((lat) => m.vertex(at(t, i, lat, 0), UP, "#ffffff", lat / 4, s / 6)));
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) m.quad(row[i][k], row[i + 1][k], row[i + 1][k + 1], row[i][k + 1], UP);
  }
  return m.build();
}

// --- paint ----------------------------------------------------------------

function paintGeometry(t: Track): THREE.BufferGeometry {
  const m = new Mesher();
  const n = t.segs.length, hw = t.width / 2, kerb = t.kerb;
  const red = new THREE.Color(GROUND.kerbRed), white = new THREE.Color(GROUND.kerbWhite), line = new THREE.Color(GROUND.paint);
  for (let i = 0; i < n; i++) {
    for (const sg of [1, -1]) {
      const c = i % 2 === 0 ? red : white;
      const in0 = at(t, i, sg * hw, PAINT_Y), in1 = at(t, i + 1, sg * hw, PAINT_Y);
      const out0 = at(t, i, sg * (hw + kerb), KERB_TOP), out1 = at(t, i + 1, sg * (hw + kerb), KERB_TOP);
      m.face([in0, in1, out1, out0], c, UP);
      m.face([out0, out1, at(t, i + 1, sg * (hw + kerb), GRASS_Y), at(t, i, sg * (hw + kerb), GRASS_Y)], c, side(t, i, sg));
      // Track-limit line just inside the kerb.
      m.face([at(t, i, sg * (hw - 0.25), PAINT_Y), at(t, i + 1, sg * (hw - 0.25), PAINT_Y), in1, in0], line, UP);
    }
  }
  startLine(t, m);
  gridBoxes(t, m);
  return m.build();
}

// startLine paints a chequered band across the asphalt at s = 0.
function startLine(t: Track, m: Mesher): void {
  const cols = 20, rows = 3, cell = t.width / cols, depth = 0.45;
  const dark = new THREE.Color(GROUND.checkerDark), light = new THREE.Color(GROUND.paint);
  for (let r = 0; r < rows; r++) {
    const s0 = (r - rows / 2) * depth, s1 = s0 + depth;
    for (let c = 0; c < cols; c++) {
      const l0 = -t.width / 2 + c * cell, l1 = l0 + cell;
      const y = PAINT_Y + 0.002;
      m.face([atS(t, s0, l0, y), atS(t, s1, l0, y), atS(t, s1, l1, y), atS(t, s0, l1, y)], (r + c) % 2 ? dark : light, UP);
    }
  }
}

// gridBoxes paints a bracket in front of each grid slot.
function gridBoxes(t: Track, m: Mesher): void {
  const y = PAINT_Y + 0.002, w = 0.18;
  for (const g of t.grid) {
    const f = [Math.cos(g.h), Math.sin(g.h)], l = [-Math.sin(g.h), Math.cos(g.h)];
    const p = (a: number, b: number): V3 => [g.x + f[0] * a + l[0] * b, y, -(g.z + f[1] * a + l[1] * b)];
    const front = 3.4;
    m.face([p(front, 1.2), p(front + w, 1.2), p(front + w, -1.2), p(front, -1.2)], GROUND.paint, UP);
    for (const sg of [1, -1]) {
      m.face([p(front - 1.4, sg * 1.2), p(front + w, sg * 1.2), p(front + w, sg * (1.2 - w)), p(front - 1.4, sg * (1.2 - w))], GROUND.paint, UP);
    }
  }
}

// --- grass ----------------------------------------------------------------

function grassMesh(t: Track): THREE.Mesh {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of t.segs) {
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
  }
  const pad = 600, w = x1 - x0 + 2 * pad, d = z1 - z0 + 2 * pad;
  const map = noiseTexture(grassNoise);
  if (map) map.repeat.set(w / 10, d / 10);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: GROUND.grass, map }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(toWorld((x0 + x1) / 2, (z0 + z1) / 2, GRASS_Y));
  mesh.name = "grass";
  mesh.receiveShadow = true;
  return mesh;
}

// --- structures -----------------------------------------------------------

function structureGeometry(t: Track): THREE.BufferGeometry {
  const m = new Mesher();
  const tyres = tyreZones(t);
  walls(t, m, tyres);
  tyreBarriers(t, m, tyres);
  gantry(t, m);
  grandstand(t, m);
  trees(t, m);
  return m.build();
}

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

function walls(t: Track, m: Mesher, tyres: Map<number, Set<number>>): void {
  const w = t.wallLat(), n = t.segs.length;
  const concrete = new THREE.Color(BUILT.wall), band = new THREE.Color(BUILT.wallBand), alt = new THREE.Color(BUILT.wallBandAlt);
  for (let i = 0; i < n; i++) {
    for (const sg of [1, -1]) {
      if (tyres.get(sg)!.has(i)) continue;
      const inward = side(t, i, -sg), outward = side(t, i, sg);
      const q = (lat: number, y0: number, y1: number): V3[] => [at(t, i, lat, y0), at(t, i + 1, lat, y0), at(t, i + 1, lat, y1), at(t, i, lat, y1)];
      const inner = sg * w, outer = sg * (w + WALL_T);
      m.face(q(inner, 0, WALL_BAND), concrete, inward);
      m.face(q(inner, WALL_BAND, WALL_H), Math.floor(i / 4) % 2 ? band : alt, inward);
      m.face([at(t, i, inner, WALL_H), at(t, i + 1, inner, WALL_H), at(t, i + 1, outer, WALL_H), at(t, i, outer, WALL_H)], concrete, UP);
      m.face(q(outer, 0, WALL_H), concrete, outward);
      // Close the wall where a tyre barrier takes over.
      if (tyres.get(sg)!.has((i + 1) % n)) m.face([at(t, i + 1, inner, 0), at(t, i + 1, outer, 0), at(t, i + 1, outer, WALL_H), at(t, i + 1, inner, WALL_H)], concrete, forwardOf(t, i + 1));
      if (tyres.get(sg)!.has((i - 1 + n) % n)) m.face([at(t, i, inner, 0), at(t, i, outer, 0), at(t, i, outer, WALL_H), at(t, i, inner, WALL_H)], concrete, scale(forwardOf(t, i), -1));
    }
  }
}

function forwardOf(t: Track, i: number): V3 {
  const s = t.segs[((i % t.segs.length) + t.segs.length) % t.segs.length];
  return [s.tx, 0, -s.tz];
}

function scale(v: V3, k: number): V3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

// tyreBarriers stacks tyres shoulder to shoulder along the wall line of each zone.
function tyreBarriers(t: Track, m: Mesher, tyres: Map<number, Set<number>>): void {
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
        tyreStack(m, base, stack++);
      }
      carry = (((carry - len) % pitch) + pitch) % pitch;
    }
  }
}

function tyreStack(m: Mesher, base: V3, k: number): void {
  const layers = 3;
  for (let l = 0; l < layers; l++) {
    const top = l === layers - 1;
    const sideC = top && k % 2 === 0 ? BUILT.wallBandAlt : l % 2 ? BUILT.tyreAlt : BUILT.tyre;
    m.prism([base[0], l * TYRE_H, base[2]], UP, TYRE_H, TYRE_R, 6, sideC, top ? BUILT.tyreAlt : null, null);
  }
}

// gantry spans the track at s = 0 with posts behind both walls.
function gantry(t: Track, m: Mesher): void {
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

const LAMP_Y = 5.9;

function headingAt(t: Track, s: number): number {
  const [x0, z0] = t.point(s, 0), [x1, z1] = t.point(s + 1, 0);
  return Math.atan2(z1 - z0, x1 - x0);
}

/** Lamp instance k → column 0..4 (0 lights first, leftmost seen from the grid). */
function lampColumn(k: number): number {
  return Math.floor(k / 2);
}

function startLights(t: Track): THREE.InstancedMesh {
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

// grandstand: stepped tiers of spectators outside the right wall of the main straight, under a roof.
function grandstand(t: Track, m: Mesher): void {
  const [a, b] = mainStraight(t);
  const L = (k: number) => -(t.wallLat() + 2.5 + k * 1.1); // tier k's front edge (right side: lat < 0)
  const Y = (k: number) => 0.9 + k * 0.6;                   // tier k's floor height
  const stand = new THREE.Color(BUILT.stand);
  const rnd = prng(fnv1a(t.id + ":stand"));
  for (let i = a; i < b; i++) {
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
    const dir = scale(forwardOf(t, i), out);
    for (let k = 0; k < STAND_TIERS; k++) {
      m.face([at(t, i, L(k), 0), at(t, i, L(k + 1), 0), at(t, i, L(k + 1), Y(k)), at(t, i, L(k), Y(k))], stand, dir);
    }
  }
}

function lerpV(p: V3, q: V3, f: number): V3 {
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
}

// trees scatters pines beyond the barriers, deterministic per track id.
function trees(t: Track, m: Mesher): void {
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
    if (nearest(t, x, z) < clear) continue;
    const base = toWorld(x, z);
    m.prism([base.x, 0, base.z], UP, 1.6 * sc, 0.22 * sc, 5, BUILT.trunk, null, null);
    m.cone([base.x, 1.2 * sc, base.z], 1.9 * sc, 3.2 * sc, 7, leaf);
    m.cone([base.x, 3.0 * sc, base.z], 1.35 * sc, 2.6 * sc, 7, leaf);
    placed++;
  }
}

function nearest(t: Track, x: number, z: number): number {
  let best = Infinity;
  for (const s of t.segs) best = Math.min(best, (s.x - x) ** 2 + (s.z - z) ** 2);
  return Math.sqrt(best);
}

/** FNV-1a 32-bit hash of a string. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: uniform [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// --- textures (browser only) ------------------------------------------------

type Painter = (g: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

/** A repeating canvas texture, or null outside a browser (tests). */
function noiseTexture(paint: Painter): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  paint(g, size, prng(fnv1a("pitlane-texture")));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// asphaltNoise: fine aggregate speckle around white (the material colour tints it).
const asphaltNoise: Painter = (g, size, rnd) => {
  const img = g.createImageData(size, size);
  for (let p = 0; p < size * size; p++) {
    const v = 200 + rnd() * 40 + (rnd() < 0.04 ? 15 : 0) - (rnd() < 0.05 ? 25 : 0);
    img.data[4 * p] = img.data[4 * p + 1] = img.data[4 * p + 2] = v;
    img.data[4 * p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
};

// grassNoise: soft clumps plus blade speckle.
const grassNoise: Painter = (g, size, rnd) => {
  g.fillStyle = "#e6e6e6";
  g.fillRect(0, 0, size, size);
  for (let k = 0; k < 220; k++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "150,160,140"},0.18)`;
    const x = rnd() * size, y = rnd() * size, r = 6 + rnd() * 20;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      g.beginPath();
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      g.fill(); // drawn wrapped so the tile repeats without seams
    }
  }
  const img = g.getImageData(0, 0, size, size);
  for (let p = 0; p < size * size; p++) {
    const d = (rnd() - 0.5) * 30;
    for (let c = 0; c < 3; c++) img.data[4 * p + c] = Math.max(0, Math.min(255, img.data[4 * p + c] + d));
  }
  g.putImageData(img, 0, 0);
};
