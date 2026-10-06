// A procedural low-poly formula car in a team colour: lofted monocoque and
// engine cover, sidepods, floor, halo, front and rear wings, and four wheels
// that steer by delta and roll by distance. Built facing local +X (frame.ts),
// origin at the centre of gravity on the ground. Six draw calls per car.
import * as THREE from "three";
import { toWorld, yawOf } from "./frame.ts";
import { Mesher, type V3 } from "./mesher.ts";
import { CAR } from "./palette.ts";

/** What the mesh needs of a car: position, heading, front-wheel angle (car.State fits). */
export interface CarPose {
  x: number;
  z: number;
  h: number;
  delta: number;
}

export interface CarMesh {
  readonly root: THREE.Group;
  /** Places the car; wheelSpin is metres rolled (cumulative), frontWingLost hides the front wing. */
  update(st: CarPose, wheelSpin: number, frontWingLost: boolean): void;
  dispose(): void;
}

export const WHEEL_R = 0.33;       // m, as the car model
const FRONT_X = 1.98, REAR_X = -1.62; // axles from the centre of gravity (cgFront, cgRear)
const FRONT_Z = 0.8, REAR_Z = 0.78;    // wheel centres off the centre line
const FRONT_W = 0.3, REAR_W = 0.38;    // tyre widths

/** One loft section: x along the car, half width, floor and roof heights, centre offset in z. */
type Section = { x: number; hw: number; y0: number; y1: number; zc?: number };

/** Paints face j (0..7 around the section, 7–0 is the bottom) of segment i. */
type Livery = (i: number, j: number) => string;

const HULL: Section[] = [
  { x: 3.05, hw: 0.08, y0: 0.2, y1: 0.3 },
  { x: 2.6, hw: 0.13, y0: 0.18, y1: 0.38 },
  { x: 1.9, hw: 0.2, y0: 0.17, y1: 0.48 },
  { x: 1.2, hw: 0.3, y0: 0.14, y1: 0.58 },
  { x: 0.75, hw: 0.38, y0: 0.12, y1: 0.64 },
  { x: 0.0, hw: 0.42, y0: 0.1, y1: 0.66 },
  { x: -0.7, hw: 0.34, y0: 0.12, y1: 0.6 },
  { x: -1.4, hw: 0.2, y0: 0.18, y1: 0.5 },
  { x: -2.0, hw: 0.13, y0: 0.22, y1: 0.42 },
];

const COVER: Section[] = [
  { x: 0.12, hw: 0.13, y0: 0.6, y1: 0.98 },
  { x: -0.4, hw: 0.15, y0: 0.56, y1: 0.9 },
  { x: -1.2, hw: 0.1, y0: 0.46, y1: 0.66 },
  { x: -1.9, hw: 0.05, y0: 0.4, y1: 0.5 },
];

const POD: Section[] = [
  { x: 0.8, hw: 0.2, y0: 0.14, y1: 0.5, zc: 0.62 },
  { x: 0.3, hw: 0.26, y0: 0.12, y1: 0.52, zc: 0.6 },
  { x: -0.6, hw: 0.22, y0: 0.12, y1: 0.42, zc: 0.5 },
  { x: -1.3, hw: 0.08, y0: 0.14, y1: 0.28, zc: 0.4 },
];

/** Builds one car in colour (a CSS colour; see palette.teamColour). Three.js objects only. */
export function buildCar(colour: string): CarMesh {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.1 });
  const root = new THREE.Group();
  root.name = "car";

  const body = new THREE.Mesh(bodyGeometry(colour), mat);
  body.name = "body";
  const wing = new THREE.Mesh(frontWingGeometry(colour), mat);
  wing.name = "frontWing";
  root.add(body, wing);

  const frontGeo = wheelGeometry(FRONT_W), rearGeo = wheelGeometry(REAR_W);
  const steer: THREE.Object3D[] = [];
  const spin: THREE.Mesh[] = [];
  for (const [x, z, front] of [[FRONT_X, FRONT_Z, true], [FRONT_X, -FRONT_Z, true], [REAR_X, REAR_Z, false], [REAR_X, -REAR_Z, false]] as const) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, WHEEL_R, z);
    const wheel = new THREE.Mesh(front ? frontGeo : rearGeo, mat);
    wheel.name = "wheel";
    pivot.add(wheel);
    root.add(pivot);
    spin.push(wheel);
    if (front) steer.push(pivot);
  }
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  return {
    root,
    update(st, wheelSpin, frontWingLost) {
      toWorld(st.x, st.z, 0, root.position);
      root.rotation.y = yawOf(st.h);
      const d = Number.isFinite(st.delta) ? st.delta : 0;
      for (const p of steer) p.rotation.y = d; // delta > 0 steers left, toward local −Z
      // Rolling forward along +X turns the top of the wheel toward +X: negative about Z.
      const a = Number.isFinite(wheelSpin) ? -(wheelSpin / WHEEL_R) % (2 * Math.PI) : 0;
      for (const w of spin) w.rotation.z = a;
      wing.visible = !frontWingLost;
    },
    dispose() {
      body.geometry.dispose();
      wing.geometry.dispose();
      frontGeo.dispose();
      rearGeo.dispose();
      mat.dispose();
    },
  };
}

function bodyGeometry(team: string): THREE.BufferGeometry {
  const m = new Mesher();
  // Monocoque: team colour on top, carbon below, white nose tip, open cockpit.
  loft(m, HULL, (i, j) => {
    if (j === 7 || j === 0 || j === 6) return CAR.carbon;
    if (i === 0 && j >= 1 && j <= 5) return CAR.accent;
    if (i === 4 && j === 3) return CAR.intake; // cockpit opening (x 0.0 … 0.75)
    return team;
  }, team, CAR.carbon);
  loft(m, COVER, (i, j) => (j === 3 && i === 0 ? CAR.accent : j === 7 ? CAR.carbon : team), CAR.intake, team);
  for (const sg of [1, -1]) {
    loft(m, POD.map((s) => ({ ...s, zc: sg * (s.zc ?? 0) })), (_i, j) => (j === 7 || j === 0 || j === 6 ? CAR.carbon : team), CAR.intake, team);
  }
  // Floor, plank and diffuser.
  m.box([-0.2, 0.065, 0], [3.4, 0.03, 1.5], CAR.carbon);
  m.face([[-1.9, 0.08, 0.5], [-1.9, 0.08, -0.5], [-2.35, 0.26, -0.5], [-2.35, 0.26, 0.5]], CAR.carbon, [0, -1, 0]);
  m.face([[-1.9, 0.08, 0.5], [-1.9, 0.08, -0.5], [-2.35, 0.26, -0.5], [-2.35, 0.26, 0.5]], CAR.carbon, [0, 1, 0]);
  // Helmet in the cockpit.
  m.convex(new THREE.IcosahedronGeometry(0.155, 1), [0.42, 0.72, 0], CAR.helmet);
  // Halo: a centre pillar and a hoop over the driver.
  const hoop: V3[] = [[0.9, 0.86, 0], [0.66, 0.87, 0.24], [0.2, 0.84, 0.33], [0.06, 0.64, 0.36]];
  m.beam([1.02, 0.6, 0], hoop[0], 0.05, CAR.carbon);
  for (const sg of [1, -1]) {
    for (let k = 0; k + 1 < hoop.length; k++) {
      m.beam([hoop[k][0], hoop[k][1], sg * hoop[k][2]], [hoop[k + 1][0], hoop[k + 1][1], sg * hoop[k + 1][2]], 0.045, CAR.carbon);
    }
    // Mirrors.
    m.beam([0.95, 0.56, sg * 0.3], [0.95, 0.68, sg * 0.45], 0.03, CAR.carbon);
    m.box([0.95, 0.7, sg * 0.48], [0.05, 0.07, 0.14], team);
    // Suspension: upper and lower arms to each wheel.
    for (const [x, zw] of [[FRONT_X, FRONT_Z], [REAR_X, REAR_Z]]) {
      m.beam([x - 0.25, 0.44, sg * 0.18], [x, 0.44, sg * (zw - 0.12)], 0.035, CAR.carbon);
      m.beam([x + 0.2, 0.2, sg * 0.18], [x, 0.22, sg * (zw - 0.12)], 0.035, CAR.carbon);
    }
    // Rear wing endplates.
    m.box([-2.15, 0.72, sg * 0.53], [0.62, 0.6, 0.03], team);
  }
  // Rear wing: main plane, flap, beam wing and a pylon.
  m.box([-2.18, 0.86, 0], [0.36, 0.05, 1.04], CAR.carbon);
  m.box([-2.05, 0.98, 0], [0.24, 0.04, 1.04], team);
  m.box([-2.2, 0.47, 0], [0.3, 0.04, 0.9], CAR.carbon);
  m.beam([-1.9, 0.42, 0], [-2.12, 0.86, 0], 0.05, CAR.carbon);
  return m.build();
}

function frontWingGeometry(team: string): THREE.BufferGeometry {
  const m = new Mesher();
  m.box([2.78, 0.1, 0], [0.5, 0.035, 1.9], CAR.carbon);
  m.box([2.62, 0.16, 0], [0.28, 0.03, 1.84], team);
  m.box([2.56, 0.21, 0], [0.18, 0.025, 1.7], CAR.accent);
  for (const sg of [1, -1]) {
    m.box([2.7, 0.17, sg * 0.95], [0.68, 0.24, 0.03], team);
    m.beam([2.72, 0.22, sg * 0.07], [2.72, 0.11, sg * 0.07], 0.03, CAR.carbon);
  }
  return m.build();
}

/** A wheel around local Z (centre at the origin): tread, black sidewalls, rims with 7 spokes so rolling shows. */
function wheelGeometry(width: number): THREE.BufferGeometry {
  const m = new Mesher();
  const sides = 14, r = WHEEL_R, rim = 0.68 * r;
  m.prism([0, 0, -width / 2], [0, 0, 1], width, r, sides, CAR.tyre, null, null);
  for (const zf of [-1, 1]) {
    const z = (zf * width) / 2, out: V3 = [0, 0, zf];
    const pt = (rad: number, i: number): V3 => {
      const q = (2 * Math.PI * (i + 0.5)) / sides; // matches the prism's ring
      return [Math.cos(q) * rad, Math.sin(q) * rad, z];
    };
    for (let i = 0; i < sides; i++) {
      m.face([pt(r, i), pt(r, i + 1), pt(rim, i + 1), pt(rim, i)], CAR.tyre, out);
      m.face([[0, 0, z + zf * 0.01], pt(rim, i), pt(rim, i + 1)], i % 2 ? CAR.rim : CAR.carbon, out);
    }
  }
  return m.build();
}

/**
 * Lofts sections into a closed octagonal hull: faces between consecutive
 * sections coloured by livery, the first and last section capped.
 */
function loft(m: Mesher, secs: readonly Section[], livery: Livery, frontCap: string, rearCap: string): void {
  const ring = (s: Section): V3[] => {
    const zc = s.zc ?? 0, h = s.y1 - s.y0, ya = s.y0 + 0.25 * h, yb = s.y0 + 0.7 * h;
    return [
      [s.x, s.y0, zc + 0.75 * s.hw], [s.x, ya, zc + s.hw], [s.x, yb, zc + s.hw], [s.x, s.y1, zc + 0.55 * s.hw],
      [s.x, s.y1, zc - 0.55 * s.hw], [s.x, yb, zc - s.hw], [s.x, ya, zc - s.hw], [s.x, s.y0, zc - 0.75 * s.hw],
    ];
  };
  const rings = secs.map(ring);
  for (let i = 0; i + 1 < secs.length; i++) {
    const a = rings[i], b = rings[i + 1];
    const cy = (secs[i].y0 + secs[i].y1 + secs[i + 1].y0 + secs[i + 1].y1) / 4, cz = ((secs[i].zc ?? 0) + (secs[i + 1].zc ?? 0)) / 2;
    for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8;
      const my = (a[j][1] + a[k][1] + b[j][1] + b[k][1]) / 4, mz = (a[j][2] + a[k][2] + b[j][2] + b[k][2]) / 4;
      m.face([a[j], a[k], b[k], b[j]], livery(i, j), [0, my - cy, mz - cz]);
    }
  }
  m.face(rings[0], frontCap, [1, 0, 0]);
  m.face(rings[rings.length - 1], rearCap, [-1, 0, 0]);
}
