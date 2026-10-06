import { test } from "node:test";
import assert from "node:assert/strict";
import { kiyi } from "../track/track.ts";
import { fitMap } from "./minimap.ts";

test("projection: fits the box with padding, keeps the aspect, +z is up", () => {
  const at = fitMap([{ x: -100, z: -50 }, { x: 100, z: 50 }], 200, 200, 10);
  assert.deepEqual(at(-100, 0), [10, 100]);
  assert.deepEqual(at(100, 0), [190, 100]);
  assert.deepEqual(at(0, 50), [100, 55], "aspect kept: 100 m of z is 90 px, centred");
  assert.ok(at(0, 50)[1] < at(0, -50)[1], "+z is up");
});

test("projection of the real track stays inside the canvas", () => {
  const t = kiyi();
  const at = fitMap(t.segs, 168, 168, 10);
  for (const s of t.segs) {
    const [x, y] = at(s.x, s.z);
    assert.ok(x >= 9.999 && x <= 158.001 && y >= 9.999 && y <= 158.001, `${x}, ${y}`);
  }
});

test("projection without points is the centre", () => {
  assert.deepEqual(fitMap([], 100, 80, 5)(3, 4), [50, 40]);
});
