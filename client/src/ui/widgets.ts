// Small shared pieces of the screens: a segmented single choice (radio group
// with arrow keys), the frame of a full-page screen, a toast, and focus entry.
import { tabMove } from "roomkit/ui/modal";
import { h, text, type Child } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";

export const BRAND = "PITLANE";

/**
 * A segmented single choice with radio semantics: one tab stop (the checked
 * button), arrow keys move the choice, change fires on a new pick.
 */
export function seg<T extends string | number>(label: string, opts: readonly { v: T; label: string }[], value: T, change: (v: T) => void): HTMLElement {
  const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  let cur = Math.max(0, opts.findIndex((o) => o.v === value));
  const pick = (i: number, focus: boolean) => {
    buttons.forEach((b, j) => {
      b.setAttribute("aria-checked", String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    if (focus) buttons[i].focus();
    if (i !== cur) {
      cur = i;
      change(opts[i].v);
    }
  };
  const buttons = opts.map((o, i) => {
    const b = h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(i === cur), tabindex: i === cur ? 0 : -1 }, o.label);
    b.addEventListener("click", () => pick(i, false));
    b.addEventListener("keydown", (e) => {
      const key = e.key === "ArrowDown" ? "ArrowRight" : e.key === "ArrowUp" ? "ArrowLeft" : e.key;
      const to = tabMove(key, i, buttons.length);
      if (to === null) return;
      e.preventDefault();
      pick(to, true);
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

const FOCUSABLE = "input:not([disabled]), button:not([disabled]):not([tabindex='-1']), select, a[href]";

/** Focuses the first control inside the first panel of root (a page or overlay just opened). */
export function focusFirst(root: ParentNode): void {
  const panel = root.querySelector(".panel") ?? root;
  panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
}

/** A short message over a screen; show() restarts its timer. */
export class Toast {
  readonly el = h("div", { class: "toast", role: "status" });
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(msg: string, ms = 3000): void {
    text(this.el, msg);
    this.el.classList.add("on");
    this.clear();
    this.timer = setTimeout(() => this.el.classList.remove("on"), ms);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
