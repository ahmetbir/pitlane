// The circuit as a handful of merged meshes, built deterministically from the
// sampled track: asphalt ribbon, paint (kerbs, edge lines, start line, grid
// boxes), grass, structures (walls plus scenery.ts's barriers, gantry and
// grandstand) and trees, both split into chunks by track distance so frustum
// and shadow culling skip what is out of view, and the start lights.
import * as THREE from "three";
import type { Track } from "../track/track.ts";
import { toWorld } from "./frame.ts";
import { Mesher, type V3 } from "./mesher.ts";
import { BUILT, GROUND, LIGHT } from "./palette.ts";
import { fnv1a, gantry, grandstand, LAMP_COLS, lampColumn, prng, startLights, trees, tyreBarriers, tyreZones } from "./scenery.ts";
import { at, atS, Chunks, forwardOf, scale, side, UP } from "./trackgeo.ts";

/** The built circuit; root goes into the scene. */
export interface TrackMesh {
  readonly root: THREE.Group;
  /** Start lights: n of 5 columns lit; out = all dark (race start). */
  setLights(n: number, out: boolean): void;
  dispose(): void;
}

const PAINT_Y = 0.012;    // painted lines sit just above the asphalt
const KERB_TOP = 0.05;    // kerb outer edge height
const GRASS_Y = -0.03;
const WALL_H = 0.8;
const WALL_BAND = 0.55;   // concrete below, board colour above
const WALL_T = 0.35;      // wall thickness
const CHUNKS = 10;        // structure and tree meshes, each a run of track

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

  const n = t.segs.length;
  const built = new Chunks(n, CHUNKS), wood = new Chunks(n, CHUNKS);
  const zones = tyreZones(t);
  walls(t, built, zones);
  tyreBarriers(t, built, zones);
  gantry(t, built);
  grandstand(t, built);
  trees(t, wood);
  const flat = lambert({ vertexColors: true, flatShading: true });
  for (const g of built.geometries()) {
    const m = new THREE.Mesh(g, flat);
    m.name = "structures";
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  for (const g of wood.geometries()) {
    const m = new THREE.Mesh(g, flat);
    m.name = "trees"; // no shadows: they stand far from the cars and the shadow box
    root.add(m);
  }

  const lights = startLights(t);
  root.add(grassMesh(t), asphalt, paint, lights);
  let disposed = false;
  return {
    root,
    setLights(n, out) {
      const on = new THREE.Color(LIGHT.on), off = new THREE.Color(LIGHT.off);
      const lit = out ? 0 : Math.max(0, Math.min(LAMP_COLS, Math.floor(n)));
      for (let k = 0; k < lights.count; k++) lights.setColorAt(k, lampColumn(k) < lit ? on : off);
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const mats = new Set<THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>();
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        mats.add(o.material);
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      for (const m of mats) {
        if (m instanceof THREE.MeshLambertMaterial) m.map?.dispose();
        m.dispose();
      }
    },
  };
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

// walls: concrete with a board band at ±wallLat, except where a tyre barrier stands.
function walls(t: Track, ch: Chunks, tyres: Map<number, Set<number>>): void {
  const w = t.wallLat(), n = t.segs.length;
  const concrete = new THREE.Color(BUILT.wall), band = new THREE.Color(BUILT.wallBand), alt = new THREE.Color(BUILT.wallBandAlt);
  for (let i = 0; i < n; i++) {
    for (const sg of [1, -1]) {
      if (tyres.get(sg)!.has(i)) continue;
      const m = ch.at(i);
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
