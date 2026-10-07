import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DT, Handling, clampSetup, frontWingLost, liveOf, newParams, parseHandling, speed, step, withLive,
  type Damage, type Params, type Setup, type State,
} from "./car.ts";

// Go's JSON field names (encoding/json, exported fields).
interface GoDamage { FrontWing: number; RearWing: number; Susp: number }
interface GoState {
  X: number; Z: number; H: number; HX: number; HZ: number; VX: number; VY: number; R: number;
  Delta: number; RPM: number; Gear: number; AX: number; Launch: boolean; Dmg: GoDamage;
}
interface GoParams {
  Mu: number; AlphaF: number; AlphaR: number; SteerRate: number; Assists: boolean; TCShare: number; ABSShare: number;
  AeroF: number; AeroR: number; DragK: number; FzF0: number; FzR0: number; Transfer: number;
  BrakeF: number; BrakeR: number; Drive: number[]; RPMPerMS: number[];
  DiffK: number; DiffX: number; LatF: number; LatK: number; GripDmg: number;
}
interface CarCase {
  handling: string; setup: Setup; dmg: GoDamage; params: GoParams; init: GoState;
  inputs: [number, number, number, number][]; env: { t: number; mu: number; drag: number }[]; states: GoState[];
}
interface CarFile { dt: number; ticks: number; sampleEach: number; cases: CarCase[] }

const file: CarFile = JSON.parse(readFileSync(new URL("../../../testdata/vectors/car.json", import.meta.url), "utf8"));

const damage = (d: GoDamage): Damage => ({ frontWing: d.FrontWing, rearWing: d.RearWing, susp: d.Susp });
const state = (s: GoState): State => ({
  x: s.X, z: s.Z, h: s.H, hx: s.HX, hz: s.HZ, vx: s.VX, vy: s.VY, r: s.R,
  delta: s.Delta, rpm: s.RPM, gear: s.Gear, ax: s.AX, launch: s.Launch, dmg: damage(s.Dmg),
});
const params = (p: GoParams): Params => ({
  mu: p.Mu, alphaF: p.AlphaF, alphaR: p.AlphaR, steerRate: p.SteerRate, assists: p.Assists, tcShare: p.TCShare, absShare: p.ABSShare,
  aeroF: p.AeroF, aeroR: p.AeroR, dragK: p.DragK, fzF0: p.FzF0, fzR0: p.FzR0, transfer: p.Transfer,
  brakeF: p.BrakeF, brakeR: p.BrakeR, drive: p.Drive, rpmPerMS: p.RPMPerMS,
  diffK: p.DiffK, diffX: p.DiffX, latF: p.LatF, latK: p.LatK, gripDmg: p.GripDmg,
});

// exact compares every field bit for bit (Object.is: −0 ≠ +0, NaN = NaN).
function exact(got: unknown, want: unknown, where: string): void {
  if (typeof want === "object" && want !== null) {
    for (const k of Object.keys(want)) {
      exact((got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k], `${where}.${k}`);
    }
    return;
  }
  assert.ok(Object.is(got, want), `${where}: got ${String(got)}, want ${String(want)}`);
}

test("DT matches Go", () => {
  assert.ok(Object.is(DT, file.dt));
});

test("newParams matches Go bit for bit", () => {
  assert.equal(file.cases.length, 49); // 40 random, then the TC, reverse and launch scripts
  file.cases.forEach((c, i) => {
    const [h, ok] = parseHandling(c.handling);
    assert.ok(ok);
    exact(newParams(h, c.setup, damage(c.dmg)), params(c.params), `case ${i} params`);
  });
});

test("step replays Go's car vectors bit for bit", () => {
  file.cases.forEach((c, i) => {
    const [h] = parseHandling(c.handling);
    const p = newParams(h, c.setup, damage(c.dmg));
    const st = state(c.init);
    assert.equal(c.inputs.length, file.ticks);
    let e = 0, k = 0;
    for (let t = 0; t < file.ticks; t++) {
      while (e + 1 < c.env.length && c.env[e + 1].t <= t) e++;
      const [th, br, sr, rv] = c.inputs[t];
      // protocol.Input.Car(): wire integers to floats.
      step(st, p, { throttle: th / 100, brake: br / 100, steer: sr / 127, reverse: rv === 1 }, { mu: c.env[e].mu, drag: c.env[e].drag });
      if ((t + 1) % file.sampleEach === 0) {
        exact(st, state(c.states[k]), `case ${i} tick ${t + 1}`);
        k++;
      }
    }
    assert.equal(k, c.states.length);
  });
});

test("setup clamps and wing loss", () => {
  assert.deepEqual(clampSetup([0, 99, 10, 9, -3, 5, 7, 7]), [1, 11, 50, 5, 1, 5, 3, 3]);
  assert.deepEqual(clampSetup([6, 6, 58, 3, 5, 5, -1, -1]), [6, 6, 58, 3, 5, 5, 0, 0]);
  assert.equal(frontWingLost({ frontWing: 0.6, rearWing: 0, susp: 0 }), false);
  assert.equal(frontWingLost({ frontWing: 0.61, rearWing: 0, susp: 0 }), true);
  assert.deepEqual(parseHandling("sim"), [Handling.Sim, true]);
  assert.deepEqual(parseHandling("x"), [Handling.Arcade, false]);
});

test("non-finite input is ignored", () => {
  const p = newParams(Handling.Sim, [6, 6, 58, 3, 5, 5, 1, 1], { frontWing: 0, rearWing: 0, susp: 0 });
  const mk = (): State => ({ x: 0, z: 0, h: 0, hx: 1, hz: 0, vx: 20, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 3, ax: 0, launch: false, dmg: { frontWing: 0, rearWing: 0, susp: 0 } });
  const a = mk(), b = mk();
  step(a, p, { throttle: NaN, brake: Infinity, steer: -Infinity }, { mu: NaN, drag: 0 });
  step(b, p, { throttle: 0, brake: 0, steer: 0 }, { mu: 0, drag: 0 });
  exact(a, b, "nan");
  assert.ok(speed(a) > 0 && speed(a) < 20);
});

test("the scripted vectors cover TC levels, reverse and launch", () => {
  const sc = file.cases.slice(40);
  assert.deepEqual(sc.map((c) => [c.handling, c.setup[6]]), [["sim", 1], ["sim", 2], ["sim", 3], ["arcade", 0], ["sim", 2], ["arcade", 2], ["sim", 2], ["arcade", 2], ["sim", 1]]);
  assert.ok(sc[4].states.some((s) => s.Gear === 0 && s.VX < -7.5), "case 44 backs up at about 8 m/s");
  assert.ok(sc[5].inputs.some((w) => w[3] === 1) && sc[5].states.some((s) => s.Gear === 0), "case 45 reverses");
  for (const c of [sc[6], sc[7]]) assert.ok(c.states.some((s) => s.Launch && s.VX === 0 && s.RPM > 4000), "launch hold");
  const rh = sc[8].states;
  assert.ok(rh[0].X === sc[8].init.X && rh[0].VX === 0 && rh[0].Gear === 0, "case 48: reverse with the brake held stands still");
  assert.ok(rh.some((s) => s.VX < -5), "case 48 backs up once the brake is released");
});

test("withLive / liveOf mirror car.Setup.WithLive / LiveValues", () => {
  const got = withLive([2, 3, 55, 4, 6, 7, 1, 1], [99, 0, 3, -1]);
  assert.deepEqual(got, [2, 3, 70, 4, 1, 7, 3, 0]);
  assert.deepEqual(liveOf(got), [70, 1, 3, 0]);
});
