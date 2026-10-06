import { test } from "node:test";
import assert from "node:assert/strict";
import { Controls, type PadLike } from "./input.ts";

function rig() {
  const fns: Record<string, ((e: any) => void)[]> = {};
  let t = 100;
  let pad: PadLike = null;
  const target = {
    addEventListener: (k: string, f: (e: any) => void) => (fns[k] ??= []).push(f),
    removeEventListener: (k: string, f: (e: any) => void) => (fns[k] = (fns[k] ?? []).filter((x) => x !== f)),
  };
  const c = new Controls({ target, getGamepads: () => [pad], now: () => t });
  const fire = (k: string, e: object) => (fns[k] ?? []).forEach((f) => f(e));
  return {
    c,
    down: (code: string, tgt: object = {}) => fire("keydown", { code, target: tgt }),
    up: (code: string) => fire("keyup", { code, target: {} }),
    blur: () => fire("blur", {}),
    setPad: (p: PadLike) => (pad = p),
    advance: (s: number) => (t += s),
  };
}
const mkPad = (axis0: number, lt = 0, rt = 0): PadLike => ({
  axes: [axis0, 0],
  buttons: Array.from({ length: 8 }, (_, i) => ({ value: i === 6 ? lt : i === 7 ? rt : 0 })),
});

test("throttle ramps 0 to 1 in 0.15 s, brake in 0.1 s", () => {
  const r = rig();
  r.down("KeyW");
  assert.equal(r.c.sample(0.075).th, 50);
  assert.equal(r.c.sample(0.075).th, 100);
  r.up("KeyW");
  assert.equal(r.c.sample(0.016).th, 0);
  r.down("ArrowDown");
  assert.equal(r.c.sample(0.05).br, 50);
  assert.equal(r.c.sample(0.05).br, 100);
});

test("steer slews at 3/s toward left (+), returns at 5/s", () => {
  const r = rig();
  r.down("KeyA");
  assert.equal(r.c.sample(0.1).st, Math.round(0.3 * 127));
  r.up("KeyA");
  assert.equal(r.c.sample(0.02).st, Math.round(0.2 * 127));
  assert.equal(r.c.sample(1).st, 0);
  r.down("ArrowRight");
  assert.equal(r.c.sample(0.1).st, -Math.round(0.3 * 127));
  r.down("KeyA"); // both held: cancel
  for (let i = 0; i < 20; i++) r.c.sample(0.1);
  assert.equal(r.c.sample(0.1).st, 0);
});

test("quantization to wire ints", () => {
  const r = rig();
  r.down("KeyA");
  const w = r.c.sample(1 / 60);
  assert.ok(Number.isInteger(w.st) && Number.isInteger(w.th) && Number.isInteger(w.br));
  assert.equal(w.st, Math.round(0.05 * 127));
});

test("gamepad deadzone rescale, left positive", () => {
  const r = rig();
  r.setPad(mkPad(0.08));
  assert.equal(r.c.sample(0.016).st, 0);
  r.setPad(mkPad(-1, 0, 1));
  const w = r.c.sample(0.016);
  assert.deepEqual(w, { th: 100, br: 0, st: 127 });
  r.setPad(mkPad(-0.54, 0.5));
  const x = r.c.sample(0.016);
  assert.equal(x.st, Math.round(0.5 * 127));
  assert.equal(x.br, 50);
});

test("gamepad overrides keyboard for 2 s after last movement", () => {
  const r = rig();
  r.down("KeyW");
  r.setPad(mkPad(0, 0, 0));
  assert.equal(r.c.sample(0.2).th, 100); // idle pad: keyboard
  r.setPad(mkPad(0, 0, 0.3));
  assert.equal(r.c.sample(0.016).th, 30);
  r.setPad(mkPad(0, 0, 0)); // released: still pad-owned, throttle 0
  r.advance(1.5);
  assert.equal(r.c.sample(0.016).th, 0);
  r.advance(2.1);
  assert.ok(r.c.sample(0.2).th > 0); // keyboard back
});

test("camera toggle once per press, lookBack held", () => {
  const r = rig();
  assert.equal(r.c.cameraToggle(), false);
  r.down("KeyC");
  r.down("KeyC"); // auto-repeat
  assert.equal(r.c.cameraToggle(), true);
  assert.equal(r.c.cameraToggle(), false);
  r.up("KeyC");
  r.down("KeyR");
  assert.equal(r.c.lookBack, true);
  r.up("KeyR");
  assert.equal(r.c.lookBack, false);
});

test("keys ignored while typing; blur releases everything", () => {
  const r = rig();
  r.down("KeyW", { tagName: "INPUT" });
  r.down("KeyS", { tagName: "TEXTAREA" });
  r.down("KeyA", { tagName: "SELECT" });
  r.down("KeyD", { isContentEditable: true });
  assert.deepEqual(r.c.sample(1), { th: 0, br: 0, st: 0 });
  r.down("KeyW");
  r.down("KeyA");
  r.down("KeyR");
  r.c.sample(1);
  r.blur();
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 });
  assert.equal(r.c.lookBack, false);
});
