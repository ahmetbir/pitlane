import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildCar, WHEEL_R } from "./carmesh.ts";
import { toWorld } from "./frame.ts";
import { teamColour } from "./palette.ts";

function named(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

test("a car builds without WebGL, finite, with four wheels", () => {
  const car = buildCar(teamColour(3));
  let meshes = 0;
  car.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const p = o.geometry.getAttribute("position").array;
    for (let i = 0; i < p.length; i++) assert.ok(Number.isFinite(p[i]), o.name);
  });
  assert.equal(meshes, 6);
  assert.equal(named(car.root, "wheel").length, 4);
  assert.equal(named(car.root, "frontWing").length, 1);
  car.dispose();
});

test("update places, steers, rolls and drops the front wing", () => {
  const car = buildCar(teamColour(0));
  car.update({ x: 10, z: 20, h: 0.5, delta: 0.2 }, Math.PI * WHEEL_R, false);
  assert.ok(car.root.position.distanceTo(toWorld(10, 20)) < 1e-12);
  assert.equal(car.root.rotation.y, 0.5);
  const wheels = named(car.root, "wheel");
  const steered = wheels.filter((w) => w.parent!.rotation.y === 0.2);
  assert.equal(steered.length, 2);
  for (const w of steered) assert.ok(w.parent!.position.x > 0, "front wheels steer");
  for (const w of wheels) assert.ok(Math.abs(Math.abs(w.rotation.z) - Math.PI) < 1e-9);
  assert.equal(named(car.root, "frontWing")[0].visible, true);
  car.update({ x: 10, z: 20, h: 0.5, delta: 0 }, 0, true);
  assert.equal(named(car.root, "frontWing")[0].visible, false);
  car.update({ x: 0, z: 0, h: 0, delta: NaN }, NaN, false);
  for (const w of wheels) assert.ok(Number.isFinite(w.rotation.z) && Number.isFinite(w.parent!.rotation.y));
});

test("the car sits on the ground, nose toward +X", () => {
  const car = buildCar(teamColour(1));
  car.update({ x: 0, z: 0, h: 0, delta: 0 }, 0, false);
  car.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(car.root);
  assert.ok(Math.abs(box.min.y) < 0.01, `min y ${box.min.y}`);
  assert.ok(box.max.x > 2.9 && box.min.x < -2.2, "about 5.4 m long");
  assert.ok(box.max.z - box.min.z < 2.1, "within 2 m wide");
});

test("ten distinct team colours, cycling by id", () => {
  const set = new Set(Array.from({ length: 10 }, (_, i) => teamColour(i)));
  assert.equal(set.size, 10);
  assert.equal(teamColour(13), teamColour(3));
  assert.equal(teamColour(-1), teamColour(9));
  assert.equal(teamColour(NaN), teamColour(0));
});
