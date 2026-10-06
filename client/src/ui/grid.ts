// The grid screen over the 3D scene: the roster with ready flags and the
// creator's crown, Ready (sends the garage setup), Start (creator only),
// Garage and Leave.
import { fill, h, text } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import type { Grid } from "../net/protocol.ts";
import { teamColour } from "../render/palette.ts";

export type GridActions = { ready(): void; start(): void; garage(): void; leave(): void };

export class GridScreen {
  readonly el: HTMLElement;
  private readonly list = h("ol", { class: "roster" });
  private readonly code = h("p", { class: "muted share" });
  private readonly readyBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly note = h("p", { class: "notice", role: "status" });
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(a: GridActions) {
    this.readyBtn = h("button", { type: "button", class: "btn primary" }, t("grid.ready"));
    this.readyBtn.addEventListener("click", () => a.ready());
    this.startBtn = h("button", { type: "button", class: "btn", hidden: true }, t("grid.start"));
    this.startBtn.addEventListener("click", () => a.start());
    const garage = h("button", { type: "button", class: "btn" }, t("grid.garage"));
    garage.addEventListener("click", () => a.garage());
    const leave = h("button", { type: "button", class: "btn ghost" }, t("grid.leave"));
    leave.addEventListener("click", () => a.leave());
    this.el = h("div", { class: "grid-screen" },
      h("section", { class: "panel" },
        h("div", { class: "card-head" }, h("h2", {}, t("grid.title")), this.code),
        this.list,
        h("p", { class: "muted hint" }, t("grid.hint")),
        this.note,
        h("div", { class: "actions" }, leave, garage, this.startBtn, this.readyBtn)));
  }

  /** Shows the roster of g; own is the own car id, room the room code. */
  show(g: Grid, own: number, room: string): void {
    text(this.code, room ? t("grid.share", { code: room }) : "");
    const mine = g.cars.find((c) => c.id === own);
    text(this.readyBtn, mine?.ready ? t("grid.unready") : t("grid.ready"));
    this.startBtn.hidden = g.creator === 0 || g.creator !== own;
    fill(this.list, ...g.cars.map((c) => {
      const crown = c.id === g.creator ? h("span", { class: "crown", title: t("grid.creator"), "aria-label": t("grid.creator") }, "♛") : null;
      const sw = h("span", { class: "swatch" });
      sw.style.background = teamColour(c.id);
      return h("li", { class: `${c.id === own ? "me" : ""} ${c.bot ? "bot" : ""}`.trim() },
        sw,
        h("span", { class: "who" }, c.name, c.id === own ? h("em", {}, ` (${t("common.you")})`) : null, crown),
        c.bot ? h("span", { class: "state muted" }, "–")
          : h("span", { class: `state ${c.ready ? "ok" : "muted"}` }, c.ready ? t("grid.isReady") : t("grid.waiting")));
    }));
  }

  /** A refused action (notice), shown for a few seconds. */
  notice(msg: string): void {
    text(this.note, msg);
    if (this.noteTimer !== null) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => text(this.note, ""), 4000);
  }
}
