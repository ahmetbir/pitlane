// The create-room dialog: handling, contact and laps (each with its one-line
// explanation), listed or private.
import { h, text } from "roomkit/ui/dom";
import { t, type Key } from "../i18n/index.ts";
import type { ContactName, Create, HandlingName } from "../net/protocol.ts";
import { seg } from "./widgets.ts";

export type Choice = { handling: HandlingName; contact: ContactName; laps: 3 | 5 | 8; listed: boolean };

export const DEFAULT_CHOICE: Choice = { handling: "arcade", contact: "soft", laps: 3, listed: true };

export function createEntry(c: Choice): Create {
  return { t: "create", handling: c.handling, contact: c.contact, laps: c.laps, listed: c.listed };
}

/** A modal dialog; go is called with the create message on submit. Append the returned element, then call showModal(). */
export function createDialog(go: (entry: Create) => void): HTMLDialogElement {
  const c: Choice = { ...DEFAULT_CHOICE };
  const hHint = h("p", { class: "muted hint" });
  const cHint = h("p", { class: "muted hint" });
  const hints = () => {
    text(hHint, t(`handling.${c.handling}Hint` as Key));
    text(cHint, t(`contact.${c.contact}Hint` as Key));
  };
  hints();
  const handling = seg(t("create.handling"), (["arcade", "sim"] as const).map((v) => ({ v, label: t(`handling.${v}`) })), c.handling, (v) => {
    c.handling = v;
    hints();
  });
  const contact = seg(t("create.contact"), (["ghost", "soft", "full"] as const).map((v) => ({ v, label: t(`contact.${v}`) })), c.contact, (v) => {
    c.contact = v;
    hints();
  });
  const laps = seg(t("create.laps"), ([3, 5, 8] as const).map((v) => ({ v, label: String(v) })), c.laps, (v) => {
    c.laps = v;
  });
  const listed = h("input", { type: "checkbox", checked: true });
  listed.addEventListener("change", () => {
    c.listed = listed.checked;
  });
  const cancel = h("button", { type: "button", class: "btn ghost" }, t("common.close"));
  const form = h("form", { class: "panel create", method: "dialog" },
    h("h2", {}, t("create.title")),
    h("div", { class: "field" }, h("span", { class: "label" }, t("create.handling")), handling, hHint),
    h("div", { class: "field" }, h("span", { class: "label" }, t("create.contact")), contact, cHint),
    h("div", { class: "field" }, h("span", { class: "label" }, t("create.laps")), laps),
    h("label", { class: "check" }, listed, t("create.listed")),
    h("div", { class: "actions" }, cancel, h("button", { type: "submit", class: "btn primary" }, t("create.go"))));
  const dlg = h("dialog", { class: "dialog" }, form);
  cancel.addEventListener("click", () => dlg.close());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    dlg.close();
    go(createEntry(c));
  });
  return dlg;
}
