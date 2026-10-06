import { test } from "node:test";
import assert from "node:assert/strict";
import { CarAudio, HZ_MAX, HZ_MIN, OTHERS, RaceAudio, SQUEAL_MAX, cutoffHz, nearest, otherGain, rpmToHz, squealGain, volumeGain } from "./engine.ts";

type Call = { node: string; param: string; v: number; tc: number };

function fakeCtx() {
  const calls: Call[] = [];
  const nodes: { kind: string }[] = [];
  const param = (node: string, name: string) => ({ value: 0, setTargetAtTime(v: number, _t: number, tc: number) { calls.push({ node, param: name, v, tc }); } });
  const mk = (kind: string, params: string[], extra = {}) => {
    const n: Record<string, unknown> = { kind, ...extra, connect: (d: unknown) => d, start() {}, stop() {} };
    for (const p of params) n[p] = param(kind, p);
    nodes.push(n as { kind: string });
    return n;
  };
  const ctx = {
    currentTime: 1,
    createOscillator: () => mk("osc", ["frequency", "detune"]),
    createGain: () => mk("gain", ["gain"]),
    createBiquadFilter: () => mk("filter", ["frequency", "Q"]),
    createBufferSource: () => mk("src", []),
  };
  return { ctx: ctx as unknown as AudioContext, calls, nodes };
}

test("rpm maps to 60..420 Hz, monotonic and clamped", () => {
  assert.equal(rpmToHz(4000), HZ_MIN);
  assert.equal(rpmToHz(13500), HZ_MAX);
  assert.equal(rpmToHz(0), HZ_MIN);
  assert.equal(rpmToHz(99999), HZ_MAX);
  assert.ok(rpmToHz(9000) > rpmToHz(8000));
  assert.ok(rpmToHz(12800) > rpmToHz(7000), "a shift drop is a pitch drop");
});

test("cutoff follows throttle", () => {
  assert.ok(cutoffHz(1, 8000) > cutoffHz(0, 8000));
});

test("squeal: silent in grip, rises with slip and load, silent when crawling", () => {
  assert.equal(squealGain(30, 1, 0.1), 0);
  assert.equal(squealGain(2, 5, 1), 0);
  const a = squealGain(30, 6, 0.3);
  const b = squealGain(30, 12, 0.9);
  assert.ok(a > 0 && b > a && b <= SQUEAL_MAX);
  assert.ok(squealGain(30, 12, 0.9) > squealGain(30, 12, 0), "lateral load adds");
  assert.equal(squealGain(NaN, NaN, NaN), 0);
});

test("nearest picks two closest in range; far cars are silent", () => {
  const o = (x: number) => ({ x, z: 0, vx: 0, vy: 0 });
  const n = nearest({ x: 0, z: 0 }, [o(50), o(10), o(30), o(500)]);
  assert.deepEqual(n.map((e) => e.d), [10, 30]);
  assert.equal(n.length, OTHERS);
  assert.ok(otherGain(10) > otherGain(40));
  assert.equal(otherGain(200), 0);
});

test("update smooths every parameter with setTargetAtTime", () => {
  const f = fakeCtx();
  const car = new CarAudio();
  car.start(f.ctx, { connect: (d: unknown) => d } as unknown as GainNode, {} as AudioBuffer);
  car.update({ x: 0, z: 0, vx: 30, vy: 8, r: 0.5, rpm: 9000 }, 1, [{ x: 20, z: 0, vx: 30, vy: 0 }]);
  assert.equal(f.calls.length, 0, "off: nothing is scheduled");
  car.setOn(true);
  f.calls.length = 0;
  car.update({ x: 0, z: 0, vx: 30, vy: 8, r: 0.5, rpm: 9000 }, 1, [{ x: 20, z: 0, vx: 30, vy: 0 }]);
  const freqs = f.calls.filter((c) => c.node === "osc" && c.param === "frequency");
  assert.ok(freqs.some((c) => c.v === rpmToHz(9000)));
  assert.ok(freqs.some((c) => c.v === rpmToHz(9000) / 2), "sub an octave down");
  assert.ok(f.calls.every((c) => c.tc > 0 && Number.isFinite(c.v)));
  assert.ok(f.calls.some((c) => c.node === "gain" && c.v === squealGain(30, 8, 0.5)));
  car.setOn(false);
  f.calls.length = 0;
  car.update({ x: 0, z: 0, vx: 30, vy: 0, r: 0, rpm: 9000 }, 1, []);
  assert.equal(f.calls.length, 0);
});

test("setOn(false) fades the voices to zero", () => {
  const f = fakeCtx();
  const car = new CarAudio();
  car.start(f.ctx, { connect: (d: unknown) => d } as unknown as GainNode, {} as AudioBuffer);
  car.setOn(true);
  car.setOn(false);
  const gains = f.calls.filter((c) => c.param === "gain");
  assert.ok(gains.length >= 2 && gains.every((c) => c.v === 0));
});

function fakeShell() {
  const log: string[] = [];
  const vols: number[] = [];
  const tones: number[] = [];
  const shell = { setVolume: (v: number) => { vols.push(v); }, tone: (_t: string, _a: number, _b: number, _s: number, g: number) => { tones.push(g); }, dispose: () => { log.push("dispose"); } };
  return { shell, log, vols, tones };
}

test("lifecycle: silent until active, contact thumps, cooldown, dispose", () => {
  const s = fakeShell();
  const a = new RaceAudio(70, () => s.shell);
  const own = { x: 0, z: 0, vx: 30, vy: 0, r: 0, rpm: 8000 };
  a.contact();
  assert.equal(s.tones.length, 0, "menus: no thump");
  a.setActive(true);
  a.contact(1);
  a.contact(1);
  assert.equal(s.tones.length, 1, "cooldown");
  a.frame(0.2, own, 1, []);
  a.frame(0.016, { ...own, vx: 10 }, 0, []);
  assert.equal(s.tones.length, 2, "a one-frame speed drop is a wall hit");
  a.setActive(false);
  a.contact();
  assert.equal(s.tones.length, 2);
  a.dispose();
  assert.deepEqual(s.log, ["dispose"]);
});

test("volume setting 0..100 drives the master gain", () => {
  const s = fakeShell();
  const a = new RaceAudio(70, () => s.shell);
  a.setVolume(0);
  a.setVolume(250);
  assert.deepEqual(s.vols, [0.7, 0, 1]);
  assert.equal(volumeGain(NaN), 0);
});
