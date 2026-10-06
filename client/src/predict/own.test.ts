// The own car must stay on the server's trajectory: its predicted state for
// input k must match the server's state right after the server applied k, up
// to the snapshot quantisation and to the one tick of travel the server's
// input queue may add or drop under jitter (mirrors Dogfight's converge and
// jitter tests). Corrections fade with a 0.1 s time constant, jumps above
// 8 m are drawn at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newParams } from "../car/car.ts";
import { moveCar } from "../race/world.ts";
import { finite, HANDLING, rng, rowOf, run, SETUP, startState, track, worst, type Trace } from "./drive.test-helper.ts";
import { Own } from "./own.ts";

const QUANT_M = 0.03; // what replaying from a quantised snapshot may cost

/** Jitter of 100 ms ± 40 ms (6 ± 2.4 ticks), seeded. */
const jitter = (seed: number) => {
  const r = rng(seed);
  return () => 6 + (r() * 2 - 1) * 2.4;
};

/** One tick of travel at the server's top speed in the run. */
const tickM = (tr: Trace) => Math.max(...tr.serverAt.slice(60).map((s) => Math.hypot(s.vx, s.vy))) / 60;

/** A contact the client cannot predict: shove, side slip and yaw kick. */
const shove = (at: number) => (t: number, s: { x: number; vy: number; r: number }) => {
  if (t === at) {
    s.x += 1.5;
    s.vy += 4;
    s.r += 0.3;
  }
};

test("steady 100 ms each way: prediction matches the server up to quantisation", () => {
  const tr = run({ ticks: 1200, uplink: () => 6, downlink: () => 6 });
  assert.ok(worst(tr, 60) < QUANT_M, `${worst(tr, 60).toFixed(3)} m`);
  assert.ok(Math.max(...tr.offset.slice(60)) < QUANT_M);
  assert.ok(finite(tr));
});

test("100 ms ± 40 ms jitter: within one tick of travel of the server", () => {
  for (const seed of [1, 2, 3, 4]) {
    const tr = run({ ticks: 1200, uplink: jitter(seed), downlink: jitter(seed + 100) });
    const w = worst(tr, 60);
    assert.ok(w <= tickM(tr) * 1.15 + QUANT_M, `seed ${seed}: ${w.toFixed(3)} m (one tick = ${tickM(tr).toFixed(3)} m)`);
    assert.ok(finite(tr));
  }
});

test("a server correction under jitter converges within 1 s and fades smoothly", () => {
  for (const seed of [1, 2, 3, 4]) {
    const tr = run({ ticks: 1200, uplink: jitter(seed), downlink: jitter(seed + 100), server: shove(600) });
    const bound = tickM(tr) * 1.15 + QUANT_M;
    assert.ok(worst(tr, 600 - 30, 600 - 15) <= bound, `seed ${seed}: off before the shove`);
    assert.ok(worst(tr, 600, 640) > 1, `seed ${seed}: the shove should be a real correction`);
    assert.ok(worst(tr, 660) <= bound, `seed ${seed}: ${worst(tr, 660).toFixed(3)} m off 1 s after the shove`);
    // Drawn: the correction appears as an offset that only decays (no jump on screen).
    const peak = tr.offset.slice(600).findIndex((o) => o > 0.5) + 600;
    assert.ok(peak > 600 && peak < 640, `seed ${seed}: correction at ${peak}`);
    for (let t = peak + 1; t < peak + 10; t++) assert.ok(tr.offset[t] < tr.offset[t - 1], `seed ${seed}: offset grew at ${t}`);
    assert.ok(tr.offset[peak + 30] < tr.offset[peak] * 0.01 + QUANT_M, `seed ${seed}: offset ${tr.offset[peak + 30]} 0.5 s later`);
    assert.ok(finite(tr));
  }
});

test("bursty input delivery: at most one tick of travel off the server, drawn steadily", () => {
  for (const burst of [3, 6, 8]) {
    const tr = run({ ticks: 900, uplink: (t) => Math.ceil(t / burst) * burst + 2 - t, downlink: () => 3 });
    const w = worst(tr, 120);
    assert.ok(w <= tickM(tr) * 1.05 + QUANT_M, `burst ${burst}: ${w.toFixed(3)} m (one tick = ${tickM(tr).toFixed(3)} m)`);
    assert.ok(Math.max(...tr.offset.slice(120)) <= tickM(tr) * 0.25, `burst ${burst}: drawn ${Math.max(...tr.offset.slice(120)).toFixed(3)} m off the prediction`);
    assert.ok(finite(tr));
  }
});

test("2 s send stall (tab hidden) then a burst: back on the server within 1.5 s", () => {
  const tr = run({ ticks: 1200, uplink: () => 6, downlink: () => 6, stalled: (t) => t >= 400 && t < 520 });
  assert.ok(worst(tr, 520 + 90) < QUANT_M, `${worst(tr, 520 + 90).toFixed(3)} m 1.5 s after resuming`);
  assert.ok(finite(tr));
});

test("1 s snapshot stall then a burst of them: no jump, back on the server", () => {
  const tr = run({ ticks: 1200, uplink: () => 6, downlink: (t) => (t >= 400 && t < 460 ? 466 - t : 6) });
  assert.ok(worst(tr, 480) < QUANT_M, `${worst(tr, 480).toFixed(3)} m`);
  assert.ok(Math.max(...tr.offset.slice(400)) < 0.1);
  assert.ok(finite(tr));
});

test("a jump above 8 m (marshal reset) is drawn at once", () => {
  const tr = run({ ticks: 900, uplink: () => 6, downlink: () => 6, server: (t, s) => { if (t === 400) s.x += 40; } });
  const arrived = tr.pred.findIndex((p, t) => t > 400 && p && Math.abs(p.x - tr.pred[t - 1].x) > 20);
  assert.ok(arrived > 400, "the reset never reached the prediction");
  assert.ok(tr.offset[arrived] < QUANT_M, `drawn ${tr.offset[arrived]} m off the prediction`);
  assert.ok(Math.abs(tr.drawn[arrived].x - tr.drawn[arrived - 1].x) > 20, "drawn car slid instead of jumping");
  assert.ok(worst(tr, 470) < 0.1);
});

test("random driving into the barriers with random contact never yields NaN", () => {
  const r = rng(99);
  const tr = run({
    ticks: 1500, uplink: jitter(5), downlink: jitter(6),
    server: (_t, s) => {
      if (r() < 0.02) {
        s.vx += (r() - 0.5) * 30;
        s.vy += (r() - 0.5) * 20;
        s.r += (r() - 0.5) * 4;
        s.x += (r() - 0.5) * 20;
      }
    },
  });
  assert.ok(finite(tr));
});

test("the server's damage predicts with its Params", () => {
  const s0 = startState(300, 40);
  const dmg = { frontWing: 0.75, rearWing: 0.2, susp: 0.1 };
  const own = new Own(track, HANDLING, SETUP);
  own.damage(dmg);
  own.reset(rowOf(1, s0), 0, 0);
  const from = own.state();
  assert.deepEqual(from.dmg, dmg);
  own.push(1, { th: 100, br: 0, st: 60 }, { running: true });
  const want = { ...from, dmg: { ...from.dmg } };
  const hint = { i: from.seg };
  moveCar(want, newParams(HANDLING, SETUP, dmg), { throttle: 1, brake: 0, steer: 60 / 127 }, track, hint);
  assert.deepEqual(own.state(), { ...want, seg: hint.i });
  const intact = new Own(track, HANDLING, SETUP);
  intact.reset(rowOf(1, s0), 0, 0);
  intact.push(1, { th: 100, br: 0, st: 60 }, { running: true });
  assert.notDeepEqual(intact.state().vx, own.state().vx);
});

test("a marshal reset under 8 m is drawn at once, whichever comes first: its snapshot or its message", () => {
  for (const at of [400, 401]) { // even: the snapshot of that tick carries the move; odd: the next one
    for (const seed of [1, 2]) {
      const tr = run({
        ticks: 900, uplink: jitter(seed), downlink: jitter(seed + 100),
        marshal: (t, s) => {
          if (t !== at) return false;
          const [x, z] = track.point(track.locate(s.x, s.z, -1).s + 3, 4); // 3 m on, 4 m to the side: about 5 m
          Object.assign(s, { x, z, vx: 0, vy: 0, r: 0, delta: 0 });
          return true;
        },
      });
      const moved = tr.pred.findIndex((p, t) => t > at && p && Math.hypot(p.x - tr.pred[t - 1].x, p.z - tr.pred[t - 1].z) > 2);
      assert.ok(moved > at, `at ${at} seed ${seed}: the reset never reached the prediction`);
      // The message travels with (right after, or right before) the snapshot of the move: drawn = physics from that frame on.
      for (let t = moved; t < moved + 30; t++) assert.ok(tr.offset[t] < QUANT_M, `at ${at} seed ${seed} t ${t}: drawn ${tr.offset[t].toFixed(3)} m off`);
      assert.ok(finite(tr));
    }
  }
});

test("cars do not move while the room is not running (grid, results)", () => {
  const own = new Own(track, HANDLING, SETUP);
  own.reset(rowOf(1, startState(300, 0)), 0, 0);
  const s = own.state();
  own.push(1, { th: 100, br: 0, st: 0 }, { running: false });
  assert.deepEqual(own.state(), s);
});

test("the corrected heading stays continuous with the predicted one across ±π", () => {
  const own = new Own(track, HANDLING, SETUP);
  const s0 = startState(300, 20);
  own.reset({ ...rowOf(1, s0), h: 3.1 }, 0, 0);
  own.push(1, { th: 0, br: 0, st: 0 }, { running: true });
  own.reconcile({ ...rowOf(1, s0), h: -3.1 }, 1, 1, { running: true });
  const h = own.state().h;
  assert.ok(Math.abs(h - (2 * Math.PI - 3.1)) < 1e-9, `h ${h}`);
  assert.ok(Math.abs(own.render(0).h - 3.1) < 1e-9, "the drawn heading should start where it was");
});
