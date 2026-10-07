// The settings page: default camera, volume, language, and the controls:
// every action with its two key slots (click a slot, press a key; Esc
// cancels, Backspace clears; a key another slot holds swaps), a reset, and
// the gamepad's fixed layout.
import { fill, h, text } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import { ACTIONS, actionName, bindable, defaultBindings, keyName, padRows, rebind, SLOTS, unbind, type Action } from "../input/bindings.ts";
import type { CamMode } from "../render/cams.ts";
import { langToggle } from "./lang.ts";
import { loadSettings, saveSettings, type Settings } from "./prefs.ts";
import { focusFirst, page, seg } from "./widgets.ts";

/** The key table; edits s.keys in place and stores it. */
function keysEditor(s: Settings): HTMLElement {
  const body = h("tbody");
  // The slots' aria-labels name the key; this region tells a screen reader what a click started.
  const live = h("p", { class: "sr-only", "aria-live": "polite" });
  const slotLabel = (a: Action, i: number) => {
    const code = s.keys[a][i];
    return t("settings.slot", { action: actionName(a), n: i + 1, key: code ? keyName(code) : t("settings.none") });
  };
  let capture: { action: Action; slot: number; btn: HTMLButtonElement } | null = null;

  const stop = () => {
    window.removeEventListener("keydown", onKey, true);
    capture = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (!capture) return;
    if (!capture.btn.isConnected) { // the page was left mid-capture
      stop();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { action, slot } = capture;
    if (e.code === "Escape") {
      stop();
      render(action, slot);
      text(live, "");
      return;
    }
    if (e.code === "Backspace" || e.code === "Delete") s.keys = unbind(s.keys, action, slot);
    else if (bindable(e.code)) s.keys = rebind(s.keys, action, slot, e.code);
    else return;
    saveSettings(s);
    stop();
    render(action, slot);
    text(live, slotLabel(action, slot));
  };

  /** Re-renders the rows; fa, fs: the slot to focus after (the one just edited). */
  function render(fa?: Action, fs?: number): void {
    fill(body, ...ACTIONS.map((a) => h("tr", {},
      h("th", { scope: "row" }, actionName(a)),
      ...Array.from({ length: SLOTS }, (_, i) => {
        const code = s.keys[a][i];
        const btn = h("button", { type: "button", class: "keycap", "aria-label": slotLabel(a, i) }, code ? keyName(code) : t("settings.unbound"));
        btn.addEventListener("click", () => {
          if (capture) {
            const prev = capture;
            stop();
            text(prev.btn, prev.btn.dataset.label ?? "");
            prev.btn.classList.remove("listening");
          }
          btn.dataset.label = btn.textContent ?? "";
          text(btn, t("settings.press"));
          btn.classList.add("listening");
          text(live, `${actionName(a)}: ${t("settings.press")}`);
          capture = { action: a, slot: i, btn };
          window.addEventListener("keydown", onKey, true);
        });
        if (a === fa && i === fs) queueMicrotask(() => btn.focus());
        return h("td", {}, btn);
      }))));
  }
  render();

  const reset = h("button", { type: "button", class: "btn ghost small" }, t("settings.resetKeys"));
  reset.addEventListener("click", () => {
    stop();
    s.keys = defaultBindings();
    saveSettings(s);
    render();
  });
  return h("div", { class: "keys-editor" },
    h("p", { class: "muted hint" }, t("settings.keysHint")), live,
    h("div", { class: "table-wrap" }, h("table", { class: "table keys" }, body)),
    h("div", { class: "actions start" }, reset),
    h("h3", { class: "label" }, t("settings.gamepad")),
    h("table", { class: "keytable" }, h("tbody", {}, ...padRows().map(([k, what]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, what))))));
}

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
    h("section", { class: "field", id: "controls" }, h("h2", {}, t("settings.controls")), keysEditor(s))));
  focusFirst(root);
}
