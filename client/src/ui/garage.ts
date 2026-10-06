// The garage: six setup sliders, each with its live value and a one-line
// effect, and a reset to the default. Every change is stored (pitlane.setup)
// at once; the grid sends the stored setup with "ready".
import { h, text } from "roomkit/ui/dom";
import { clampSetup, defaultSetup, setupMax, setupMin, type Setup } from "../car/car.ts";
import { t, type Key } from "../i18n/index.ts";
import { loadSetup, saveSetup } from "./prefs.ts";

type Slider = { label: Key; fx: Key; value: (v: number) => string };

/** Indexed as car.Setup: FrontWing, RearWing, BrakeBias, Gearing, Diff, SuspBalance. */
export const SLIDERS: readonly Slider[] = [
  { label: "garage.fw", fx: "garage.fwFx", value: String },
  { label: "garage.rw", fx: "garage.rwFx", value: String },
  { label: "garage.bb", fx: "garage.bbFx", value: (v) => `${v} : ${100 - v}` },
  { label: "garage.gear", fx: "garage.gearFx", value: String },
  { label: "garage.diff", fx: "garage.diffFx", value: String },
  { label: "garage.susp", fx: "garage.suspFx", value: String },
];

/** s with slider i set to v, rounded and clamped to the garage ranges. */
export function adjust(s: Setup, i: number, v: number): Setup {
  const out = s.slice() as Setup;
  out[i] = Number.isFinite(v) ? Math.round(v) : s[i];
  return clampSetup(out);
}

/** The garage panel; done is called with the stored setup. */
export function garagePanel(done: (s: Setup) => void): HTMLElement {
  let setup = loadSetup();
  const inputs: HTMLInputElement[] = [];
  const values: HTMLElement[] = [];
  const show = () => SLIDERS.forEach((sl, i) => {
    inputs[i].value = String(setup[i]);
    text(values[i], sl.value(setup[i]));
  });
  const rows = SLIDERS.map((sl, i) => {
    const id = `setup-${i}`;
    const input = h("input", { type: "range", id, min: setupMin[i], max: setupMax[i], step: 1, value: setup[i] });
    const value = h("output", { class: "value", for: id });
    input.addEventListener("input", () => {
      setup = saveSetup(adjust(setup, i, Number(input.value)));
      text(value, sl.value(setup[i]));
    });
    inputs.push(input);
    values.push(value);
    return h("div", { class: "slider" },
      h("label", { class: "slider-head", for: id }, h("span", {}, t(sl.label)), value),
      input,
      h("p", { class: "muted hint" }, t(sl.fx)));
  });
  show();
  const reset = h("button", { type: "button", class: "btn ghost" }, t("garage.reset"));
  reset.addEventListener("click", () => {
    setup = saveSetup(defaultSetup());
    show();
  });
  const ok = h("button", { type: "button", class: "btn primary" }, t("garage.done"));
  ok.addEventListener("click", () => done(setup));
  return h("div", { class: "garage" }, h("div", { class: "sliders" }, ...rows), h("div", { class: "actions" }, reset, ok));
}
