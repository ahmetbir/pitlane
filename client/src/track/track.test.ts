import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Surface, kiyi } from "./track.ts";

interface TrackCase { s: number; lat: number; x: number; z: number; i: number; locLat: number; locS: number }
const file: { length: number; cases: TrackCase[] } = JSON.parse(
  readFileSync(new URL("../../../testdata/vectors/track.json", import.meta.url), "utf8"),
);

const tr = kiyi();

test("kiyi.json loads", () => {
  assert.equal(tr.id, "kiyi");
  assert.ok(Object.is(tr.length, file.length));
  assert.equal(tr.line.length, tr.segs.length);
  assert.equal(tr.grid.length, 10);
  assert.equal(tr.wallLat(), 20);
});

// Go materialises every product in the queries (no FMA), so results are bit-identical.
const same = (got: number, want: number, what: string): void =>
  assert.ok(Object.is(got, want), `${what}: got ${got}, want ${want}`);

test("point and locate match Go", () => {
  assert.equal(file.cases.length, 50);
  file.cases.forEach((c, k) => {
    const [x, z] = tr.point(c.s, c.lat);
    same(x, c.x, `case ${k} x`);
    same(z, c.z, `case ${k} z`);
    const loc = tr.locate(c.x, c.z, -1);
    assert.equal(loc.i, c.i, `case ${k} i`);
    same(loc.lat, c.locLat, `case ${k} lat`);
    same(loc.s, c.locS, `case ${k} s`);
  });
});

test("locate with a hint agrees with the full search, stale hints fall back", () => {
  const n = tr.segs.length;
  for (const c of file.cases) {
    const full = tr.locate(c.x, c.z, -1);
    for (const hint of [c.i, (c.i + 10) % n, (c.i + n - 39) % n, Math.floor(c.i + n / 2) % n, (c.i + 40) % n]) {
      assert.deepEqual(tr.locate(c.x, c.z, hint), full, `hint ${hint}`);
    }
  }
});

test("surfaceAt bands", () => {
  assert.equal(tr.surfaceAt(0), Surface.Asphalt);
  assert.equal(tr.surfaceAt(-7), Surface.Asphalt);
  assert.equal(tr.surfaceAt(7.5), Surface.Kerb);
  assert.equal(tr.surfaceAt(-8), Surface.Kerb);
  assert.equal(tr.surfaceAt(20), Surface.Grass);
  assert.equal(tr.surfaceAt(-20.01), Surface.Wall);
});

test("point and locate are inverse", () => {
  for (let s = 0; s < tr.length; s += 97.3) {
    const [x, z] = tr.point(s, 5);
    const loc = tr.locate(x, z, -1);
    assert.ok(Math.abs(loc.lat - 5) < 1e-9);
    const ds = Math.abs(loc.s - s);
    assert.ok(Math.min(ds, tr.length - ds) < 1e-9); // s just below 0 wraps to length, as in Go
  }
});
