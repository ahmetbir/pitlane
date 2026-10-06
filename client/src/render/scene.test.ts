import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Stage, type StageRenderer } from "./scene.ts";

/** A renderer that only counts calls (no WebGL in node). */
function fake() {
  const n = { render: 0, dispose: 0, lost: 0, setSize: 0, ratio: [] as number[] };
  const r = {
    setPixelRatio: (v: number) => void n.ratio.push(v),
    setSize: () => void n.setSize++,
    render: () => void n.render++,
    dispose: () => void n.dispose++,
    forceContextLoss: () => void n.lost++,
    capabilities: { getMaxAnisotropy: () => 16 },
    shadowMap: { enabled: false, type: 0 },
    info: { render: { calls: 3, triangles: 9 } },
    toneMapping: 0,
  } as unknown as StageRenderer;
  return { r, n };
}

const canvas = { clientWidth: 800, clientHeight: 400 };

test("animate's unsubscribe stops its callbacks", () => {
  const { r } = fake();
  const st = new Stage(canvas, { renderer: () => r, shadows: false });
  let a = 0, b = 0;
  const offA = st.animate(() => a++);
  st.animate(() => b++);
  st.update(1 / 60);
  offA();
  offA();
  st.update(1 / 60);
  assert.equal(a, 1);
  assert.equal(b, 2);
});

test("an animator may unsubscribe itself mid-frame", () => {
  const { r } = fake();
  const st = new Stage(canvas, { renderer: () => r, shadows: false });
  let n = 0;
  const off = st.animate(() => {
    n++;
    off();
  });
  st.update(0);
  st.update(0);
  assert.equal(n, 1);
});

test("dispose is idempotent and stops drawing", () => {
  const { r, n } = fake();
  const st = new Stage(canvas, { renderer: () => r, shadows: true });
  let ticks = 0;
  st.animate(() => ticks++);
  st.update(1 / 60);
  assert.equal(n.render, 1);
  assert.equal(st.camera.aspect, 2);
  st.dispose();
  st.dispose();
  assert.equal(n.dispose, 1);
  assert.equal(n.lost, 1);
  st.update(1 / 60);
  assert.equal(n.render, 1);
  assert.equal(ticks, 1);
});

test("resize only when the size or pixel ratio changes", () => {
  const { r, n } = fake();
  const c = { clientWidth: 640, clientHeight: 480 };
  const st = new Stage(c, { renderer: () => r, shadows: false });
  st.update(0);
  st.update(0);
  assert.equal(n.setSize, 1);
  assert.deepEqual(n.ratio, [1]);
  c.clientWidth = 1280;
  st.update(0);
  assert.equal(n.setSize, 2);
  assert.ok(Math.abs(st.camera.aspect - 1280 / 480) < 1e-12);
});

test("focus snaps the shadow box to whole texels: sub-texel moves keep it still", () => {
  const { r } = fake();
  const st = new Stage(canvas, { renderer: () => r, shadows: true });
  const sun = st.scene.children.find((o) => o instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
  st.focus(new THREE.Vector3(100, 0, -40));
  const a = sun.target.position.clone();
  assert.ok(a.distanceTo(new THREE.Vector3(100, 0, -40)) < 0.1);
  // A sub-texel move shifts the box only along the light (depth), never across the map.
  st.focus(new THREE.Vector3(100.001, 0, -40.001));
  const along = sun.position.clone().sub(sun.target.position).normalize();
  const d = sun.target.position.clone().sub(a);
  assert.ok(d.clone().cross(along).length() < 1e-9, `moved across by ${d.toArray()}`);
});
