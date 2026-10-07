import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSetup, type Setup } from "../car/car.ts";
import { defaultBindings, rebind } from "../input/bindings.ts";
import { adjust, SLIDERS, tcEffect, tcName, TC_LEVELS } from "./garage.ts";
import { setLang } from "../i18n/index.ts";
import { defaultSettings, loadSettings, loadSetup, saveSettings, saveSetup, storedName, storeName } from "./prefs.ts";

class Mem {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

test("garage: a slider is rounded and clamped to its range", () => {
  const s = defaultSetup();
  assert.deepEqual(adjust(s, 0, 99), [11, 6, 58, 3, 5, 5, 1]);
  assert.deepEqual(adjust(s, 2, 10), [6, 6, 50, 3, 5, 5, 1]);
  assert.deepEqual(adjust(s, 3, 4.6), [6, 6, 58, 5, 5, 5, 1]);
  assert.deepEqual(adjust(s, 5, NaN), s);
  assert.deepEqual(s, [6, 6, 58, 3, 5, 5, 1], "the input is not changed");
  assert.equal(SLIDERS.length, 6);
  assert.equal(SLIDERS[2].value(58), "58 : 42");
});

test("garage: the setup persists under pitlane.setup, clamped", () => {
  const st = new Mem();
  assert.deepEqual(loadSetup(st), defaultSetup(), "nothing stored: the default");
  const saved = saveSetup([0, 12, 71, 3, 5, 5, 4] as Setup, st);
  assert.deepEqual(saved, [1, 11, 70, 3, 5, 5, 3]);
  assert.equal(st.getItem("pitlane.setup"), "[1,11,70,3,5,5,3]");
  assert.deepEqual(loadSetup(st), [1, 11, 70, 3, 5, 5, 3]);
  st.setItem("pitlane.setup", "[1,11,70,3,5,5]");
  assert.deepEqual(loadSetup(st), [1, 11, 70, 3, 5, 5, 1], "a six-value setup gets the default TC");
});

test("garage: a malformed stored setup falls back to the default", () => {
  const st = new Mem();
  for (const bad of ["{", "[1,2,3]", '["6",6,58,3,5,5]', "[6,6,58,3,5,5.5]", "[6,6,58,3,5,5,2,1]", "null"]) {
    st.setItem("pitlane.setup", bad);
    assert.deepEqual(loadSetup(st), defaultSetup(), bad);
  }
  st.setItem("pitlane.setup", "[99,-3,58,3,5,5]");
  assert.deepEqual(loadSetup(st), [11, 1, 58, 3, 5, 5, 1], "out of range: clamped");
  assert.deepEqual(loadSetup(null), defaultSetup(), "storage blocked");
});

test("settings and name persist and validate", () => {
  const st = new Mem();
  assert.deepEqual(loadSettings(st), defaultSettings());
  const keys = rebind(defaultBindings(), "brake", 0, "KeyB");
  saveSettings({ camera: "cockpit", volume: 40, keys, seenControls: true }, st);
  assert.deepEqual(loadSettings(st), { camera: "cockpit", volume: 40, keys, seenControls: true });
  st.setItem("pitlane.settings", '{"camera":"drone","volume":400}');
  assert.deepEqual(loadSettings(st), { camera: "chase", volume: 100, keys: defaultBindings(), seenControls: false }, "v1 settings: default keys, card unseen");
  st.setItem("pitlane.settings", '{"keys":{"brake":["KeyW"]},"seenControls":"yes"}');
  const s = loadSettings(st);
  assert.deepEqual(s.keys.brake, ["KeyW"]);
  assert.deepEqual(s.keys.throttle, ["ArrowUp"], "a stored key wins over a default");
  assert.equal(s.seenControls, false);
  storeName("  Ayrton  ", st);
  assert.equal(storedName(st), "Ayrton");
});

test("garage: traction control Off..3 with its effect and measured 0–100", () => {
  assert.deepEqual(TC_LEVELS, [0, 1, 2, 3]);
  setLang("en", null);
  assert.equal(tcName(0), "Off");
  assert.match(tcEffect(1), /^1: .* Sim 0–100 km\/h ≈ 4\.4 s\.$/);
  setLang("tr", null);
  assert.match(tcEffect(3), /0–100 km\/sa ≈ 5,8 sn\.$/);
  assert.deepEqual(adjust(defaultSetup(), 6, 0), [6, 6, 58, 3, 5, 5, 0]);
});
