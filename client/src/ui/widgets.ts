// Small shared pieces of the screens: a segmented single choice and the frame
// of a full-page screen (brand, title, back button).
import { h, type Child } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";

export const BRAND = "PITLANE";

/** A segmented single choice (radio semantics): one button per option, change fires on a new pick. */
export function seg<T extends string | number>(label: string, opts: readonly { v: T; label: string }[], value: T, change: (v: T) => void): HTMLElement {
  const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  const buttons = opts.map((o) => {
    const b = h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(o.v === value) }, o.label);
    b.addEventListener("click", () => {
      for (const x of buttons) x.setAttribute("aria-checked", String(x === b));
      change(o.v);
    });
    return b;
  });
  box.append(...buttons);
  return box;
}

/** A full-page screen: brand header with a back button, then a titled panel. */
export function page(cls: string, title: string, back: () => void, ...children: Child[]): HTMLElement {
  const b = h("button", { type: "button", class: "btn ghost" }, `← ${t("common.back")}`);
  b.addEventListener("click", back);
  return h("div", { class: `screen ${cls}` },
    h("header", { class: "brand" }, h("h1", {}, BRAND), b),
    h("section", { class: "panel" }, h("h2", {}, title), ...children));
}
