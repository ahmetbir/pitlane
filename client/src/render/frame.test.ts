import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { forward, fromWorld, toWorld, yawOf } from "./frame.ts";

test("toWorld and fromWorld round-trip", () => {
  for (const [x, z] of [[0, 0], [12.5, -3], [-187.3, 886.6], [1e-9, -1e9]]) {
    const [bx, bz] = fromWorld(toWorld(x, z, 4));
    assert.equal(bx, x);
    assert.equal(bz, z);
  }
  assert.equal(toWorld(1, 2, 3).y, 3);
});

test("the circuit stays counter-clockwise seen from above", () => {
  // Sim +Z is +X rotated 90° CCW; seen from +Y (x right, −z up on screen) the world point must be "up".
  const p = toWorld(0, 1);
  assert.ok(p.z < 0);
});

test("a model's +X points along the heading and its −Z to the left", () => {
  for (const h of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
    const o = new THREE.Object3D();
    o.rotation.y = yawOf(h);
    o.updateMatrixWorld();
    const f = new THREE.Vector3(1, 0, 0).transformDirection(o.matrixWorld);
    const want = toWorld(Math.cos(h), Math.sin(h));
    assert.ok(f.distanceTo(want) < 1e-12, `forward at h=${h}`);
    assert.ok(forward(h).distanceTo(want) < 1e-12);
    const left = new THREE.Vector3(0, 0, -1).transformDirection(o.matrixWorld);
    assert.ok(left.distanceTo(toWorld(-Math.sin(h), Math.cos(h))) < 1e-12, `left at h=${h}`);
  }
});
