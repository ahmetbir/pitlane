// The controls card: the keyboard and gamepad keys at a glance, rendered from
// the bindings. Shown once before the first race, then on F1 / ? in a race
// and from the home page. While it is up in a race the car gets neutral input
// and coasts (app.ts blocks the controls); Escape closes it.
import { fill, h } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import { cardRows, keysLabel, padRows, type Bindings, type KeyRow } from "../input/bindings.ts";

export type CardOpts = {
  /** After it closed (the first-race card: remember it was seen). */
  closed?(): void;
  /** Opens the driver's manual (a button on the card). */
  manual?(): void;
  /** Opens the settings page at the controls (home only: a race would be left). */
  settings?(): void;
};

function rows(list: readonly KeyRow[]): HTMLElement {
  return h("table", { class: "keytable" }, h("tbody", {}, ...list.map(([k, what]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, what)))));
}

export class ControlsCard {
  readonly el = h("div", { class: "controls-card", role: "dialog", "aria-labelledby": "controls-title", hidden: true });
  private readonly opts: CardOpts;
  private back: HTMLElement | null = null; // focus to restore on close (opened with focus)
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  constructor(opts: CardOpts = {}) {
    this.opts = opts;
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Shows the card for bindings b; focus: move the keyboard focus to it (not in a race). */
  open(b: Bindings, focus = false): void {
    const ok = h("button", { type: "button", class: "btn primary" }, t("card.gotIt"));
    ok.addEventListener("click", () => this.close());
    const manual = this.opts.manual ? h("button", { type: "button", class: "btn ghost" }, t("home.manual")) : null;
    manual?.addEventListener("click", () => {
      this.close();
      this.opts.manual?.();
    });
    const change = this.opts.settings ? h("button", { type: "button", class: "btn ghost" }, t("card.change")) : null;
    change?.addEventListener("click", () => {
      this.close();
      this.opts.settings?.();
    });
    fill(this.el, h("div", { class: "panel" },
      h("h2", { id: "controls-title" }, t("card.controls")),
      h("div", { class: "card-cols" },
        h("section", {}, h("h3", {}, t("card.keyboard")), rows(cardRows(b))),
        h("section", {}, h("h3", {}, t("card.gamepad")), rows(padRows()))),
      h("p", { class: "muted hint" }, t("card.again", { keys: b.help.length ? `${keysLabel(b.help)} / ?` : "?" })),
      h("div", { class: "actions" }, change, manual, ok)));
    if (!this.isOpen()) {
      window.addEventListener("keydown", this.onKey, true);
      const active = document.activeElement;
      this.back = focus && active instanceof HTMLElement ? active : null;
    }
    this.el.hidden = false;
    if (focus) ok.focus();
  }

  toggle(b: Bindings): void {
    if (this.isOpen()) this.close();
    else this.open(b);
  }

  /** Closes, gives the focus back to what opened it with focus (the home page's Controls button). */
  close(): void {
    if (!this.isOpen()) return;
    const back = this.back;
    this.hide();
    if (back?.isConnected) back.focus();
    this.opts.closed?.();
  }

  /** Closes without the closed() callback or the focus (the session ends, another page opens). */
  hide(): void {
    this.el.hidden = true;
    this.back = null;
    window.removeEventListener("keydown", this.onKey, true);
  }
}
