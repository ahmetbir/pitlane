import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../i18n/index.ts";
import { ACTIONS, actionMap, cardRows, bindable, cleanBindings, defaultBindings, keyName, keyRows, keysLabel, padRows, rebind, unbind } from "./bindings.ts";

test("defaults: every action bound, each code once", () => {
  const b = defaultBindings();
  for (const a of ACTIONS) assert.ok(b[a].length > 0, a);
  const all = ACTIONS.flatMap((a) => b[a]);
  assert.equal(new Set(all).size, all.length);
  assert.equal(actionMap(b).get("Space"), "brake");
  assert.equal(actionMap(b).get("KeyS"), "brakeReverse");
  assert.equal(actionMap(b).get("ShiftRight"), "launch");
});

test("rebind: a taken key swaps, an empty slot fills, same key is a no-op", () => {
  const d = defaultBindings();
  const b = rebind(d, "throttle", 0, "Space");
  assert.deepEqual(b.throttle, ["Space", "ArrowUp"]);
  assert.deepEqual(b.brake, ["KeyW"], "the brake took W in exchange");
  assert.deepEqual(d.throttle, ["KeyW", "ArrowUp"], "the input is not changed");
  const c = rebind(d, "brake", 1, "KeyW");
  assert.deepEqual(c.brake, ["Space", "KeyW"]);
  assert.deepEqual(c.throttle, ["ArrowUp"], "an empty slot has nothing to give back");
  assert.equal(rebind(d, "brake", 0, "Space"), d);
  const w = rebind(d, "throttle", 0, "ArrowUp");
  assert.deepEqual(w.throttle, ["ArrowUp", "KeyW"], "within one action: the slots swap");
  assert.equal(rebind(d, "brake", 0, "Escape"), d, "Escape is not bindable");
  assert.equal(rebind(d, "brake", 0, "ControlLeft"), d);
  assert.deepEqual(unbind(d, "throttle", 0).throttle, ["ArrowUp"]);
});

test("stored bindings are validated", () => {
  assert.deepEqual(cleanBindings(null), defaultBindings());
  assert.deepEqual(cleanBindings("x"), defaultBindings());
  const b = cleanBindings({ throttle: ["KeyI", "KeyI", 5, "Meta"], brake: [], camera: ["KeyW", "KeyC", "KeyV"], left: "KeyA" });
  assert.deepEqual(b.throttle, ["KeyI"]);
  assert.deepEqual(b.brake, [], "a cleared action stays cleared");
  assert.deepEqual(b.camera, ["KeyW", "KeyC"], "at most two");
  assert.deepEqual(b.left, ["KeyA", "ArrowLeft"], "malformed: the defaults");
  assert.ok(!b.lookBack.includes("KeyW"));
  const all = ACTIONS.flatMap((a) => b[a]);
  assert.equal(new Set(all).size, all.length, "each code once");
  assert.ok(bindable("ShiftLeft") && bindable("F1") && !bindable("AltRight") && !bindable("") && !bindable("a b"));
});

test("key names and rows in both languages", () => {
  setLang("en", null);
  assert.equal(keyName("KeyW"), "W");
  assert.equal(keyName("ArrowUp"), "↑");
  assert.equal(keyName("Space"), "Space");
  assert.equal(keyName("Digit3"), "3");
  assert.equal(keyName("Numpad4"), "Num 4");
  assert.equal(keysLabel(["ShiftLeft", "ShiftRight"]), "Shift");
  const rows = keyRows(defaultBindings());
  assert.equal(rows.length, ACTIONS.length);
  assert.deepEqual(rows[0], ["W / ↑", "Throttle"]);
  assert.ok(rows.some(([k]) => k === "Shift + W"));
  assert.equal(padRows().length, 7);
  setLang("tr", null);
  assert.equal(keyName("Space"), "Boşluk");
  assert.equal(keyRows(defaultBindings())[0][1], "Gaz");
});

test("the controls card folds the eight live keys into four pairs", () => {
  setLang("en", null);
  const rows = cardRows(defaultBindings());
  assert.equal(rows.length, ACTIONS.length - 4);
  assert.deepEqual(cardRows(defaultBindings(), true).slice(-2).map(([k]) => k), ["5 / 6", "7 / 8"], "Arcade: no TC / ABS keys");
  assert.deepEqual(rows.slice(-4), [["1 / 2", "TC − / + (while racing)"], ["3 / 4", "ABS − / + (while racing)"], ["5 / 6", "Brake bias rear / front (while racing)"], ["7 / 8", "Diff open / locked (while racing)"]]);
});
