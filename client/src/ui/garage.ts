// The garage: six setup sliders and the traction control choice, each with
// its live value and a one-line effect, and a reset to the default. Every
// change is stored (pitlane.setup) at once; the grid sends the stored setup
// with "ready". In an Arcade room traction control is always on (level 3).
import { h, text } from "roomkit/ui/dom";
import { clampSetup, defaultSetup, Handling, setupMax, setupMin, TC, type Setup } from "../car/car.ts";
import { zeroTo100 } from "../car/measure.ts";
import { fixed } from "../i18n/format.ts";
import { t, type Key } from "../i18n/index.ts";
import type { HandlingName } from "../net/protocol.ts";
import { loadSetup, saveSetup } from "./prefs.ts";
import { seg } from "./widgets.ts";

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

/** The traction control levels, Off (0) … 3. */
export const TC_LEVELS: readonly number[] = Array.from({ length: setupMax[TC] - setupMin[TC] + 1 }, (_, i) => setupMin[TC] + i);

/** A TC level's name: "Kapalı" / "Off", or the number. */
export const tcName = (level: number): string => (level === 0 ? t("garage.tcOff") : String(level));

/** A TC level's effect with its measured 0–100 km/h time (Sim, default setup). */
export function tcEffect(level: number): string {
  return `${t(`garage.tc${level}Fx` as Key)} ${t("garage.tc100", { s: fixed(zeroTo100(Handling.Sim, level), 1) })}`;
}

/** The traction control row; locked (Arcade): level 3, not changeable. */
function tcRow(level: number, locked: boolean, change: (v: number) => void): { el: HTMLElement; set(v: number): void } {
  const fx = h("p", { class: "muted hint" });
  const show = (v: number) => text(fx, locked ? t("garage.tcArcade") : tcEffect(v));
  let choice = seg(t("garage.tc"), TC_LEVELS.map((v) => ({ v, label: tcName(v) })), locked ? 3 : level, (v) => {
    show(v);
    change(v);
  });
  const box = h("div", { class: "slider tc" }, h("span", { class: "slider-head" }, h("span", {}, t("garage.tc")),
    locked ? h("span", { class: "lock-note" }, t("garage.tcLocked")) : null), choice, fx);
  if (locked) choice.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  show(level);
  return {
    el: box,
    set: (v: number) => {
      if (locked) return;
      const next = seg(t("garage.tc"), TC_LEVELS.map((x) => ({ v: x, label: tcName(x) })), v, (x) => {
        show(x);
        change(x);
      });
      choice.replaceWith(next);
      choice = next;
      show(v);
    },
  };
}

/**
 * The garage panel; done is called with the stored setup. handling: the
 * room's (in a session); Arcade locks traction control on.
 */
export function garagePanel(done: (s: Setup) => void, handling?: HandlingName): HTMLElement {
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
  const tc = tcRow(setup[TC], handling === "arcade", (v) => {
    setup = saveSetup(adjust(setup, TC, v));
  });
  const reset = h("button", { type: "button", class: "btn ghost" }, t("garage.reset"));
  reset.addEventListener("click", () => {
    setup = saveSetup(defaultSetup());
    show();
    tc.set(setup[TC]);
  });
  const ok = h("button", { type: "button", class: "btn primary" }, t("garage.done"));
  ok.addEventListener("click", () => done(setup));
  const note = handling === undefined ? h("p", { class: "muted hint" }, t("garage.tcHome")) : null;
  return h("div", { class: "garage" }, h("div", { class: "sliders" }, ...rows, tc.el), note, h("div", { class: "actions" }, reset, ok));
}
