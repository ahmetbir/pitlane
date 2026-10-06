// Other cars are drawn 100 ms behind the server: position lerped, heading on
// the shortest arc, steady under jitter and bursts, never NaN.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CarRow } from "../net/protocol.ts";
import { rng } from "./drive.test-helper.ts";
import { mixRow, Others } from "./others.ts";

const TICK_MS = 1000 / 60;
const V = 30; // m/s along x

function row(id: number, x: number, h = 0): CarRow {
  return { id, x, z: 0, h, vx: V, vy: 0, r: 0, delta: 0, lap: 1, s: x, bot: true, finished: false, wingLost: false, offTrack: false };
}

test("mix lerps position and takes the shortest arc of the heading", () => {
  const m = mixRow(row(1, 0, 3.1), row(1, 2, -3.1), 0.5);
  assert.equal(m.x, 1);
  assert.ok(Math.abs(Math.cos(m.h) + 1) < 1e-6, `h ${m.h} should pass through π, not 0`);
  const q = mixRow(row(1, 0, 0.2), row(1, 2, -0.2), 0.25);
  assert.ok(Math.abs(q.h - 0.1) < 1e-12);
});

test("a teleport between snapshots is not slid along", () => {
  assert.equal(mixRow(row(1, 0), row(1, 50), 0.3).x, 0);
  assert.equal(mixRow(row(1, 0), row(1, 50), 0.7).x, 50);
});

/**
 * A car at V m/s, snapshots every 2 ticks delivered after `delay(t)` ms (in
 * order), drawn every 60 Hz frame. Returns the drawn x per frame and the true
 * x at that frame.
 */
function watch(delay: (t: number) => number, frames = 600): { drawn: number[]; truth: number[] } {
  const o = new Others();
  const inFlight: { at: number; tick: number }[] = [];
  let last = 0;
  const drawn: number[] = [], truth: number[] = [];
  for (let t = 1; t <= frames; t++) {
    if (t % 2 === 0) {
      last = Math.max(last, t * TICK_MS + delay(t));
      inFlight.push({ at: last, tick: t });
    }
    const now = t * TICK_MS;
    while (inFlight.length && inFlight[0].at <= now) {
      const s = inFlight.shift()!;
      o.push(s.tick, [row(2, (V * s.tick) / 60)], s.at);
    }
    const cars = o.sample(now);
    drawn[t] = cars.length ? cars[0].x : NaN;
    truth[t] = (V * t) / 60;
  }
  return { drawn, truth };
}

test("steady delivery: drawn 100 ms behind the newest snapshot, moving evenly", () => {
  const { drawn, truth } = watch(() => 50);
  for (let t = 120; t <= 600; t++) {
    const lag = (truth[t] - drawn[t]) / V; // seconds behind the server: 50 ms on the wire + 100 ms
    assert.ok(Math.abs(lag - 0.15) < 0.02, `t ${t}: ${lag.toFixed(3)} s behind`);
    assert.ok(Math.abs(drawn[t] - drawn[t - 1] - V / 60) < 1e-9, `t ${t}: uneven step`);
  }
});

test("100 ms ± 40 ms jitter: no stall, no backstep, no NaN", () => {
  for (const seed of [1, 2, 3]) {
    const r = rng(seed);
    const { drawn } = watch(() => 100 + (r() * 2 - 1) * 40, 1200);
    for (let t = 120; t <= 1200; t++) {
      assert.ok(Number.isFinite(drawn[t]));
      const step = drawn[t] - drawn[t - 1];
      assert.ok(step >= 0 && step <= (V / 60) * 2.5, `seed ${seed} t ${t}: step ${step.toFixed(3)} m`);
    }
  }
});

test("bursty delivery (a stall then a burst): the car holds, then catches up without jumping back", () => {
  const { drawn } = watch((t) => (t >= 300 && t < 360 ? (360 - t) * TICK_MS + 50 : 50), 900);
  for (let t = 120; t <= 900; t++) {
    assert.ok(Number.isFinite(drawn[t]));
    assert.ok(drawn[t] >= drawn[t - 1], `t ${t}: drawn moved back`);
  }
  assert.ok(Math.abs(drawn[900] - drawn[899] - V / 60) < 1e-9, "not back to an even pace");
});

test("cars missing from a snapshot are dropped; clear forgets everything", () => {
  const o = new Others();
  o.push(2, [row(2, 0), row(3, 5)], 100);
  o.push(4, [row(3, 6)], 133);
  assert.deepEqual(o.sample(1000).map((c) => c.id), [3]);
  o.clear();
  assert.deepEqual(o.sample(1000), []);
});
