import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Cams, chaseFov, springStep } from "./cams.ts";
import { forward, toWorld } from "./frame.ts";

test("springStep converges without overshoot and holds at dt = 0", () => {
  let x = 10, v = 0;
  for (let i = 0; i < 120; i++) {
    [x, v] = springStep(x, v, 0, 7, 1 / 60);
    assert.ok(x >= -1e-9, "critically damped: no overshoot");
  }
  assert.ok(Math.abs(x) < 0.01 && Math.abs(v) < 0.1);
  assert.deepEqual(springStep(3, 2, 0, 7, 0), [3, 2]);
  // Any step size is stable.
  [x, v] = springStep(10, 0, 0, 7, 5);
  assert.ok(Math.abs(x) < 1e-6);
});

test("chase FOV widens with speed, finite everywhere", () => {
  assert.equal(chaseFov(0), 68);
  assert.ok(chaseFov(85) > chaseFov(40));
  assert.equal(chaseFov(300), chaseFov(85));
  assert.equal(chaseFov(NaN), 68);
});

const at = (x: number, z: number, h: number, speed = 0, delta = 0) => ({ x, z, h, delta, speed });

function finite(c: THREE.PerspectiveCamera): boolean {
  return [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov].every(Number.isFinite);
}

test("chase: 6 m behind and 2 m up once settled, no NaN at a standstill", () => {
  const cam = new THREE.PerspectiveCamera();
  const cams = new Cams(cam);
  cams.update(1 / 60, at(100, 50, 1.1));
  for (let i = 0; i < 60; i++) cams.update(0, at(100, 50, 1.1));
  assert.ok(finite(cam));
  const car = toWorld(100, 50), back = forward(1.1).multiplyScalar(-6);
  assert.ok(cam.position.distanceTo(car.clone().add(back).setY(2)) < 1e-9);
  // Turning: the boom swings round on the spring and settles.
  for (let i = 0; i < 240; i++) cams.update(1 / 60, at(100, 50, 2.0, 30));
  const want = toWorld(100, 50).add(forward(2.0).multiplyScalar(-6)).setY(2);
  assert.ok(cam.position.distanceTo(want) < 0.01);
  assert.ok(finite(cam));
  // Looking along the car.
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  assert.ok(dir.dot(forward(2.0)) > 0.9);
});

test("look back puts the camera ahead, looking behind", () => {
  const cam = new THREE.PerspectiveCamera();
  const cams = new Cams(cam);
  cams.lookBack(true);
  cams.update(1 / 60, at(0, 0, 0));
  assert.ok(cam.position.x > 5);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  assert.ok(dir.x < -0.9);
});

test("cockpit: at the driver's eye, glancing into the corner", () => {
  const cam = new THREE.PerspectiveCamera();
  const cams = new Cams(cam);
  cams.toggle();
  assert.equal(cams.mode(), "cockpit");
  cams.update(1 / 60, at(0, 0, 0, 0, 0.2));
  assert.ok(cam.position.distanceTo(new THREE.Vector3(0.35, 1.0, 0)) < 1e-9);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  assert.ok(dir.z < -0.1, "steering left looks left (world −Z)");
  cams.update(Infinity, at(NaN, NaN, NaN, NaN, NaN));
  cams.toggle();
  assert.equal(cams.mode(), "chase");
});
