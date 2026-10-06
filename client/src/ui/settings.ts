// The settings page: default camera, volume, language; the controls for reference.
import { fill, h, text } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import type { CamMode } from "../render/cams.ts";
import { langToggle } from "./lang.ts";
import { loadSettings, saveSettings } from "./prefs.ts";
import { page, seg } from "./widgets.ts";

export function showSettings(root: HTMLElement, back: () => void): void {
  const s = loadSettings();
  const camera = seg(t("settings.camera"), [{ v: "chase" as CamMode, label: t("settings.chase") }, { v: "cockpit" as CamMode, label: t("settings.cockpit") }], s.camera, (v) => {
    s.camera = v;
    saveSettings(s);
  });
  const vol = h("input", { type: "range", id: "volume", min: 0, max: 100, step: 5, value: s.volume });
  const volOut = h("output", { class: "value", for: "volume" }, `${s.volume}`);
  vol.addEventListener("input", () => {
    s.volume = Number(vol.value);
    text(volOut, `${s.volume}`);
    saveSettings(s);
  });
  fill(root, page("settings-page", t("settings.title"), back,
    h("div", { class: "field" }, h("span", { class: "label" }, t("settings.camera")), camera),
    h("div", { class: "field" }, h("label", { class: "slider-head", for: "volume" }, h("span", {}, t("settings.volume")), volOut), vol),
    h("div", { class: "field" }, h("span", { class: "label" }, t("settings.language")), langToggle(() => showSettings(root, back))),
    h("div", { class: "field" }, h("span", { class: "label" }, t("settings.controls")), h("p", { class: "muted hint" }, t("settings.keys")))));
}
