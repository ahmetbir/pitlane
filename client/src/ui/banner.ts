// The connection banner (reconnecting, server update, fatal) and the cards
// shown instead of a session: error, unreachable, no WebGL.
import { Banner as CoreBanner } from "roomkit/ui/banner";
import { errorCard as core } from "roomkit/ui/errorcard";
import { fill, h } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import { BRAND } from "./widgets.ts";

export class Banner extends CoreBanner {
  constructor(el: HTMLElement) {
    super(el, { updating: () => t("banner.updating"), lost: () => t("banner.lost"), conn: () => t("err.conn"), home: () => t("common.home") });
  }
}

/** A centered error card with the way home (and any extra actions). */
export function errorCard(ui: HTMLElement, title: string, msg: string, ...actions: HTMLElement[]): void {
  core(ui, BRAND, t("common.home"), title, msg, ...actions);
}

/** The first connection never got a welcome: "try again" runs retry. */
export function unreachableCard(ui: HTMLElement, retry: () => void): void {
  const again = h("button", { type: "button", class: "btn primary" }, t("card.retry"));
  again.addEventListener("click", retry);
  errorCard(ui, t("card.unreachTitle"), t("card.unreachBody"), again);
  again.focus();
}

export function noWebGL(ui: HTMLElement): void {
  fill(ui, h("div", { class: "screen" },
    h("div", { class: "panel narrow" }, h("h2", {}, t("app.webglTitle")), h("p", {}, t("app.webglBody")), h("a", { href: "/", class: "btn" }, t("common.home")))));
}

export function loading(): HTMLElement {
  return h("div", { class: "screen" }, h("div", { class: "panel narrow loading" }, h("span", { class: "spinner" }), t("app.connecting")));
}
