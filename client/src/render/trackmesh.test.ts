import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { kiyi } from "../track/track.ts";
import { asphaltGeometry, buildTrack, tyreZones } from "./trackmesh.ts";

const tr = kiyi();
const built = buildTrack(tr);

function meshes(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  built.root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

function finite(g: THREE.BufferGeometry): boolean {
  const p = g.getAttribute("position").array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false;
  return true;
}

test("asphalt: two strips per seg, 3 vertices per row plus the seam row", () => {
  const g = asphaltGeometry(tr);
  const n = tr.segs.length;
  assert.equal(g.getAttribute("position").count, (n + 1) * 3);
  assert.equal(g.getIndex()!.count / 3, n * 4);
  assert.ok(finite(g));
  // The seam row sits on seg 0, with v continuing past the lap.
  const p = g.getAttribute("position"), uv = g.getAttribute("uv");
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(p.getX(3 * n + k) - p.getX(k)) < 1e-9 && Math.abs(p.getZ(3 * n + k) - p.getZ(k)) < 1e-9);
    assert.ok(Math.abs(uv.getY(3 * n + k) - tr.length / 6) < 1e-3); // float32
  }
});

test("asphalt faces up", () => {
  const g = asphaltGeometry(tr);
  const p = g.getAttribute("position"), idx = g.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(p, idx.getX(t));
    b.fromBufferAttribute(p, idx.getX(t + 1));
    c.fromBufferAttribute(p, idx.getX(t + 2));
    const n = b.sub(a).cross(c.sub(a));
    assert.ok(n.y > 0, `triangle ${t / 3}`);
  }
});

test("every mesh is finite and the circuit costs few draw calls", () => {
  const ms = meshes();
  assert.ok(ms.length <= 6, `${ms.length} meshes`);
  for (const m of ms) assert.ok(finite(m.geometry), m.name);
  const names = ms.map((m) => m.name).sort();
  assert.deepEqual(names, ["asphalt", "grass", "paint", "startLights", "structures"]);
});

test("tyre barriers sit on the outside of corners", () => {
  const z = tyreZones(tr);
  for (const [side, segs] of z) {
    for (const i of segs) assert.ok(i >= 0 && i < tr.segs.length);
    assert.ok(segs.size > 0, `side ${side}`);
  }
  // The sharpest seg's outside is a tyre wall.
  let apex = 0;
  tr.segs.forEach((s, i) => {
    if (Math.abs(s.k) > Math.abs(tr.segs[apex].k)) apex = i;
  });
  assert.ok(z.get(tr.segs[apex].k > 0 ? -1 : 1)!.has(apex));
});

test("start lights: n columns lit, out darkens all", () => {
  const lights = meshes().find((m) => m.name === "startLights") as THREE.InstancedMesh;
  assert.equal(lights.count, 10);
  const lit = () => {
    const c = new THREE.Color();
    let n = 0;
    for (let k = 0; k < lights.count; k++) {
      lights.getColorAt(k, c);
      if (c.r > 0.5) n++;
    }
    return n;
  };
  assert.equal(lit(), 0);
  built.setLights(3, false);
  assert.equal(lit(), 6);
  built.setLights(5, false);
  assert.equal(lit(), 10);
  built.setLights(9, false);
  assert.equal(lit(), 10);
  built.setLights(5, true);
  assert.equal(lit(), 0);
});

test("the build is deterministic", () => {
  const a = buildTrack(tr), b = buildTrack(tr);
  const s = (t: typeof a) => {
    let pos = 0;
    t.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === "structures") {
        const p = o.geometry.getAttribute("position").array;
        for (let i = 0; i < p.length; i += 97) pos += p[i];
      }
    });
    return pos;
  };
  assert.equal(s(a), s(b));
  a.dispose();
  b.dispose();
});
