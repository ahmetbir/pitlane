// The home page: name, quick race, join by code, open rooms, the create
// dialog, and the ways to the garage, leaderboard and settings. Also the name
// prompt of a /r/CODE link.
import { normalizeCode } from "roomkit/net/code";
import { fill, h } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import type { Create, Join, Quick } from "../net/protocol.ts";
import { createDialog } from "./create.ts";
import { langToggle } from "./lang.ts";
import { NAME_MAX, storedName, storeName } from "./prefs.ts";
import { RoomList } from "./rooms.ts";
import { BRAND } from "./widgets.ts";

export type Entry = Create | Join | Quick;

/** Where the home page leads. */
export type HomeNav = {
  play(name: string, entry: Entry): void;
  garage(): void;
  board(): void;
  settings(): void;
};

function nameField(value: string): HTMLInputElement {
  return h("input", {
    type: "text", class: "input", maxlength: NAME_MAX, placeholder: t("home.namePh"), value,
    autocomplete: "nickname", spellcheck: false, "aria-label": t("home.name"),
  });
}

/** The typed name, or a generated one; stored for the next visit. */
function takeName(input: HTMLInputElement): string {
  const n = input.value.trim().slice(0, NAME_MAX) || `Pilot${Math.floor(100 + Math.random() * 900)}`;
  storeName(n);
  return n;
}

function navButton(label: string, go: () => void): HTMLButtonElement {
  const b = h("button", { type: "button", class: "btn ghost" }, label);
  b.addEventListener("click", go);
  return b;
}

/** draft: the name being typed, kept across a language switch (which re-renders the page). */
export function showHome(root: HTMLElement, nav: HomeNav, draft?: string): void {
  const name = nameField(draft ?? storedName());
  const list = new RoomList((code) => go({ t: "join", code }));
  const leave = (f: () => void) => () => {
    storeName(name.value.trim().slice(0, NAME_MAX));
    list.stop();
    f();
  };
  function go(entry: Entry): void {
    list.stop();
    if (entry.t === "join") history.pushState(null, "", `/r/${entry.code}`);
    nav.play(takeName(name), entry);
  }

  const quick = h("button", { type: "button", class: "btn primary big" }, t("home.quick"));
  quick.addEventListener("click", () => go({ t: "quick" }));
  const dialog = createDialog((entry) => go(entry));
  const create = h("button", { type: "button", class: "btn big" }, t("home.create"));
  create.addEventListener("click", () => dialog.showModal());

  const code = h("input", { type: "text", class: "input code", maxlength: 4, placeholder: t("home.codePh"), autocomplete: "off", spellcheck: false, "aria-label": t("home.codeAria") });
  code.addEventListener("input", () => {
    code.value = code.value.toUpperCase();
  });
  const joinErr = h("p", { class: "form-error", role: "alert" });
  const join = h("form", { class: "join-row" }, code, h("button", { type: "submit", class: "btn" }, t("common.join")));
  join.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = normalizeCode(code.value);
    if (c) go({ t: "join", code: c });
    else joinErr.textContent = t("home.codeErr");
  });

  const lang = langToggle(() => {
    list.stop();
    showHome(root, nav, name.value);
  });
  fill(root, h("div", { class: "screen home" },
    h("header", { class: "brand" },
      h("div", {}, h("h1", {}, BRAND), h("p", { class: "muted tagline" }, t("app.tagline"))),
      h("nav", { class: "brand-tools" },
        navButton(t("home.garage"), leave(nav.garage)), navButton(t("home.board"), leave(nav.board)),
        navButton(t("home.settings"), leave(nav.settings)), lang)),
    h("div", { class: "home-grid" },
      h("section", { class: "panel card driver" },
        h("label", { class: "field" }, h("span", { class: "label" }, t("home.name")), name),
        h("div", { class: "actions stack" }, quick, create),
        h("p", { class: "muted hint" }, t("home.quickHint")),
        h("div", { class: "field" }, h("span", { class: "label" }, t("home.joinTitle")), join, joinErr)),
      list.el)), dialog);
  list.start();
  if (draft === undefined) name.focus();
}

/** /r/CODE: joins at once with a stored name, otherwise asks for one. */
export function showJoin(root: HTMLElement, code: string, play: HomeNav["play"]): void {
  if (storedName()) {
    play(storedName(), { t: "join", code });
    return;
  }
  const name = nameField("");
  const form = h("form", { class: "panel narrow" },
    h("h2", {}, t("home.joinPrompt")),
    h("p", { class: "muted" }, t("common.room"), " ", h("span", { class: "code-tag" }, code)),
    h("label", { class: "field" }, h("span", { class: "label" }, t("home.name")), name),
    h("button", { type: "submit", class: "btn primary" }, t("common.join")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    play(takeName(name), { t: "join", code });
  });
  fill(root, h("div", { class: "screen home" }, h("header", { class: "brand" }, h("h1", {}, BRAND)), form));
  name.focus();
}
