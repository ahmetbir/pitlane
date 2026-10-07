import { test } from "node:test";
import assert from "node:assert/strict";
import { Controls, type PadLike } from "./input.ts";
import { defaultBindings, rebind, type Bindings } from "./bindings.ts";

function rig(bindings?: Bindings) {
  const fns: Record<string, ((e: any) => void)[]> = {};
  let t = 100;
  let pad: PadLike = null;
  const target = {
    addEventListener: (k: string, f: (e: any) => void) => (fns[k] ??= []).push(f),
    removeEventListener: (k: string, f: (e: any) => void) => (fns[k] = (fns[k] ?? []).filter((x) => x !== f)),
  };
  const dfns: (() => void)[] = [];
  const doc = { hidden: false, addEventListener: (_: string, f: () => void) => dfns.push(f), removeEventListener: (_: string, f: () => void) => dfns.splice(dfns.indexOf(f), 1) };
  let throws = false;
  let vx = 0;
  let blocked = false;
  let gear = 1;
  const c = new Controls({ target, doc, getGamepads: () => { if (throws) throw new Error("x"); return [pad]; }, now: () => t, bindings, vx: () => vx, gear: () => gear, blocked: () => blocked });
  const fire = (k: string, e: object) => (fns[k] ?? []).forEach((f) => f(e));
  return {
    c,
    down: (code: string, tgt: object = {}, mods: object = {}) => fire("keydown", { code, target: tgt, ...mods }),
    fire, fns, dfns, doc, setThrows: (v: boolean) => (throws = v),
    up: (code: string) => fire("keyup", { code, target: {} }),
    blur: () => fire("blur", {}),
    setPad: (p: PadLike) => (pad = p),
    advance: (s: number) => (t += s),
    setVX: (v: number) => (vx = v),
    setBlocked: (v: boolean) => (blocked = v),
    setGear: (g: number) => (gear = g),
  };
}
const mkPad = (axis0: number, lt = 0, rt = 0, a = 0, b = 0): PadLike => ({
  mapping: "standard",
  axes: [axis0, 0],
  buttons: Array.from({ length: 8 }, (_, i) => ({ value: i === 6 ? lt : i === 7 ? rt : i === 0 ? a : i === 1 ? b : 0 })),
});

test("throttle ramps 0 to 1 in 0.15 s, brake in 0.1 s", () => {
  const r = rig();
  r.down("KeyW");
  assert.equal(r.c.sample(0.075).th, 50);
  assert.equal(r.c.sample(0.075).th, 100);
  r.up("KeyW");
  assert.equal(r.c.sample(0.016).th, 0);
  r.down("Space");
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
  assert.equal(x.br, 47); // 0.5 rescaled past the 0.05 trigger deadzone
});

test("gamepad overrides keyboard for 2 s after last movement", () => {
  const r = rig();
  r.down("KeyW");
  r.setPad(mkPad(0, 0, 0));
  assert.equal(r.c.sample(0.2).th, 100); // idle pad: keyboard
  r.setPad(mkPad(0, 0, 0.3));
  assert.equal(r.c.sample(0.016).th, 26);
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

test("modifier chords are ignored and not prevented", () => {
  const r = rig();
  let prevented = 0;
  for (const m of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) r.down("KeyW", {}, { ...m, preventDefault: () => prevented++ });
  assert.equal(r.c.sample(1).th, 0);
  assert.equal(prevented, 0);
});

test("arrows and space preventDefault when unmodified", () => {
  const r = rig();
  let prevented = 0;
  const pd = () => prevented++;
  r.down("ArrowUp", {}, { preventDefault: pd });
  r.down("Space", {}, { preventDefault: pd });
  r.down("ArrowLeft", { tagName: "INPUT" }, { preventDefault: pd });
  r.down("ArrowDown", {}, { metaKey: true, preventDefault: pd });
  assert.equal(prevented, 2);
});

test("non-standard pad and resting -1 trigger axes do not take over", () => {
  const r = rig();
  r.down("KeyW");
  r.setPad({ mapping: "", axes: [0.9, 0], buttons: [] });
  assert.ok(r.c.sample(0.2).th > 0 && r.c.sample(0.2).st === 0);
  r.setPad({ mapping: "standard", axes: [0, 0, -1, -1], buttons: Array.from({ length: 8 }, () => ({ value: 0 })) });
  r.c.sample(0.2);
  assert.equal(r.c.sample(0.2).th, 100);
});

test("disconnect mid-race falls back to keyboard; getGamepads throw tolerated", () => {
  const r = rig();
  r.down("KeyW");
  r.setPad(mkPad(0, 0, 0.5));
  assert.equal(r.c.sample(0.016).th, 47);
  r.setPad(null);
  assert.ok(r.c.sample(0.05).th > 0);
  r.setPad(mkPad(0, 0, 0.5));
  r.setThrows(true);
  assert.doesNotThrow(() => r.c.sample(0.2));
});

test("NaN and negative dt treated as 0", () => {
  const r = rig();
  r.down("KeyW");
  r.down("KeyA");
  assert.deepEqual(r.c.sample(NaN), { th: 0, br: 0, st: 0 });
  assert.deepEqual(r.c.sample(-1), { th: 0, br: 0, st: 0 });
});

test("hidden document releases; dispose removes listeners", () => {
  const r = rig();
  r.down("KeyW");
  r.down("KeyR");
  r.c.sample(1);
  r.doc.hidden = true;
  r.dfns.forEach((f) => f());
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 });
  assert.equal(r.c.lookBack, false);
  r.c.dispose();
  assert.equal(r.dfns.length, 0);
  assert.ok(Object.values(r.fns).every((a) => a.length === 0));
});

test("idle: key presses and pad movement restart the clock, touch too", () => {
  const r = rig();
  assert.equal(r.c.idleS(), 0);
  r.advance(120);
  assert.equal(r.c.idleS(), 120);
  r.down("KeyQ"); // any key counts
  assert.equal(r.c.idleS(), 0);
  r.advance(30);
  r.c.sample(0.016); // no pad: nothing
  assert.equal(r.c.idleS(), 30);
  r.setPad(mkPad(0.5));
  r.c.sample(0.016);
  assert.equal(r.c.idleS(), 0);
  r.setPad(mkPad(0)); // released: a movement too
  r.c.sample(0.016);
  r.advance(10);
  r.c.sample(0.016); // the pad at rest: no activity
  assert.equal(r.c.idleS(), 10);
  r.c.touch();
  assert.equal(r.c.idleS(), 0);
});

test("space brakes; S brakes while rolling forward, reverses when stopped", () => {
  const r = rig();
  r.down("Space");
  assert.deepEqual(r.c.sample(0.1), { th: 0, br: 100, st: 0 });
  r.up("Space");
  r.setVX(12);
  r.down("KeyS");
  assert.deepEqual(r.c.sample(0.1), { th: 0, br: 100, st: 0 }, "rolling: S brakes");
  r.setVX(0.5);
  assert.deepEqual(r.c.sample(0.075), { th: 50, br: 0, st: 0, rv: true }, "stopped: S drives the reverse gear");
  r.setVX(-6);
  r.setGear(0);
  assert.deepEqual(r.c.sample(0.075), { th: 100, br: 0, st: 0, rv: true }, "backing up in reverse: still reverse");
  r.up("KeyS");
  r.down("ArrowDown");
  assert.equal(r.c.sample(0.016).rv, true, "↓ is the same action");
});

test("throttle held with S while stopped brakes (no reverse): a launch hold", () => {
  const r = rig();
  r.down("KeyW");
  r.down("KeyS");
  assert.deepEqual(r.c.sample(0.2), { th: 100, br: 100, st: 0 });
});

test("Shift+W while stopped holds a launch; once moving Shift does nothing", () => {
  const r = rig();
  r.down("ShiftLeft", {}, { shiftKey: true });
  r.down("KeyW", {}, { shiftKey: true });
  assert.deepEqual(r.c.sample(0.2), { th: 100, br: 100, st: 0 });
  r.up("ShiftLeft");
  assert.deepEqual(r.c.sample(0.016), { th: 100, br: 0, st: 0 }, "released: the launch");
  r.down("ShiftRight", {}, { shiftKey: true });
  r.setVX(3);
  assert.deepEqual(r.c.sample(0.016), { th: 100, br: 0, st: 0 }, "moving: throttle only");
  r.up("KeyW");
  r.setVX(0);
  assert.deepEqual(r.c.sample(0.2), { th: 0, br: 0, st: 0 }, "Shift alone: nothing");
});

test("ctrl chords stay ignored with Shift a game key", () => {
  const r = rig();
  r.down("KeyW", {}, { ctrlKey: true, shiftKey: true });
  assert.equal(r.c.sample(1).th, 0);
});

test("custom bindings drive the actions; rebind() swaps the table live", () => {
  const b = rebind(defaultBindings(), "throttle", 0, "KeyI");
  const r = rig(b);
  r.down("KeyW");
  assert.equal(r.c.sample(1).th, 0, "W no longer bound");
  r.down("KeyI");
  assert.equal(r.c.sample(1).th, 100);
  r.c.rebind(rebind(b, "brake", 0, "KeyI"));
  assert.deepEqual(r.c.sample(1), { th: 0, br: 0, st: 0 }, "rebinding releases held keys");
  r.down("KeyI");
  assert.equal(r.c.sample(1).br, 100, "I now brakes");
  r.down("Space");
  assert.equal(r.c.sample(1).th, 100, "the swap gave Space to the throttle");
});

test("help: F1 or ? once per press, F1's browser default prevented", () => {
  const r = rig();
  let prevented = 0;
  r.down("F1", {}, { preventDefault: () => prevented++ });
  r.down("F1", {});
  assert.equal(r.c.take("help"), true);
  assert.equal(r.c.take("help"), false);
  assert.equal(prevented, 1);
  r.up("F1");
  r.fire("keydown", { code: "Minus", key: "?", target: {} });
  assert.equal(r.c.take("help"), true);
});

test("gamepad: B reverses when stopped and brakes when rolling; A + RT holds a launch", () => {
  const r = rig();
  r.setPad(mkPad(0, 0, 0, 0, 1));
  assert.deepEqual(r.c.sample(0.016), { th: 100, br: 0, st: 0, rv: true });
  r.setVX(10);
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 100, st: 0 });
  r.setVX(0);
  r.setPad(mkPad(0, 0, 0.5, 1, 0));
  assert.deepEqual(r.c.sample(0.016), { th: 47, br: 100, st: 0 });
  r.setVX(2);
  assert.deepEqual(r.c.sample(0.016), { th: 47, br: 0, st: 0 }, "moving: A does nothing");
  r.setVX(0);
  r.setPad(mkPad(0, 0, 0, 1, 0));
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 }, "A alone: nothing");
});

test("a screen over the race (manual, controls card): neutral input, keys keep their default, help still toggles", () => {
  const r = rig();
  r.down("KeyW");
  r.down("KeyA");
  r.c.sample(0.5);
  r.setBlocked(true);
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 }, "keys held when the screen opened no longer drive");
  let prevented = 0;
  const pd = () => prevented++;
  r.down("Space", {}, { preventDefault: pd });
  r.down("ArrowDown", {}, { preventDefault: pd });
  r.down("KeyS");
  r.down("ShiftLeft", {}, { shiftKey: true });
  r.down("KeyW", {}, { shiftKey: true });
  assert.deepEqual(r.c.sample(0.2), { th: 0, br: 0, st: 0 }, "no throttle, brake, steer or reverse");
  assert.equal(prevented, 0, "Space and the arrows act on the screen");
  r.setPad(mkPad(-1, 0.8, 1, 0, 1));
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 }, "the pad is neutral too");
  r.setPad(null);
  r.down("F1", {}, { preventDefault: pd });
  assert.equal(r.c.take("help"), true, "help still toggles the card");
  assert.equal(prevented, 1, "F1's browser default is still prevented");
  r.setBlocked(false);
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 0, st: 0 }, "closed: keys pressed under the screen are not held");
  r.down("KeyW");
  assert.equal(r.c.sample(0.15).th, 100, "pressed again: drives");
});

test("a key releases what its keydown started: ? with Shift let go first works every time", () => {
  const r = rig();
  for (let i = 0; i < 3; i++) {
    r.fire("keydown", { code: "ShiftLeft", key: "Shift", shiftKey: true, target: {} });
    r.fire("keydown", { code: "Slash", key: "?", shiftKey: true, target: {} });
    r.fire("keyup", { code: "ShiftLeft", key: "Shift", target: {} });
    r.fire("keyup", { code: "Slash", key: "/", target: {} }); // Shift already up: the key reads "/"
    assert.equal(r.c.take("help"), true, `press ${i + 1}`);
  }
  r.down("F1");
  assert.equal(r.c.take("help"), true, "F1 after ? still works");
  r.up("F1");
  r.down("KeyW");
  r.down("ArrowUp");
  r.up("KeyW");
  assert.equal(r.c.sample(0.15).th, 100, "↑ still held: throttle stays on");
  r.up("ArrowUp");
  assert.equal(r.c.sample(0.016).th, 0);
});

test("S and pad B brake a car rolling backwards out of reverse (after a spin)", () => {
  const r = rig();
  r.setVX(-4);
  r.setGear(2);
  r.down("KeyS");
  assert.deepEqual(r.c.sample(0.1), { th: 0, br: 100, st: 0 }, "rolling back in gear 2: brake");
  r.setVX(-0.4);
  assert.deepEqual(r.c.sample(0.15), { th: 100, br: 0, st: 0, rv: true }, "stopped: reverse");
  r.setGear(0);
  r.setVX(-6);
  assert.equal(r.c.sample(0.016).rv, true, "in gear R: reverse continues");
  r.up("KeyS");
  r.setGear(3);
  r.setPad(mkPad(0, 0, 0, 0, 1));
  assert.deepEqual(r.c.sample(0.016), { th: 0, br: 100, st: 0 }, "pad B rolling back out of reverse: brake");
  r.setGear(0);
  assert.deepEqual(r.c.sample(0.016), { th: 100, br: 0, st: 0, rv: true }, "pad B in reverse: reverse");
});
