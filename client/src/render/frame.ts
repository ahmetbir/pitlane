// The one mapping from the track's 2D frame to Three.js world space.
//
// The simulation works on a flat (x, z) plane with headings from +X counter-
// clockwise. Three.js is Y-up and right-handed, so +Z in the sim is drawn as
// −Z in the world: the circuit stays counter-clockwise seen from above.
// Every model is built facing local +X; local −Z is its left.
import * as THREE from "three";

/** Sim (x, z) at height y → world position. */
export function toWorld(x: number, z: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, y, -z);
}

/** World position → sim [x, z]. */
export function fromWorld(v: THREE.Vector3): [number, number] {
  return [v.x, -v.z];
}

/** Sim heading → Object3D rotation.y (local +X ends up along the heading). */
export function yawOf(h: number): number {
  return h;
}

/** World unit vector of sim heading h. */
export function forward(h: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(h), 0, -Math.sin(h));
}
