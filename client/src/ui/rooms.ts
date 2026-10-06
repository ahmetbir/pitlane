// Open rooms on the home page: a table refreshed every 5 s, a join button per room.
import { fill, h, text } from "roomkit/ui/dom";
import { t, type Key } from "../i18n/index.ts";
import { fetchRooms, type RoomRow } from "../net/api.ts";
import type { ContactName, HandlingName, Phase } from "../net/protocol.ts";

const REFRESH_MS = 5000;

export const handlingName = (h: HandlingName): string => t(`handling.${h}` as Key);
export const contactName = (c: ContactName): string => t(`contact.${c}` as Key);
export const phaseName = (p: Phase): string => t(`phase.${p}` as Key);

/** "2/10" drivers in the room / seats. */
export const seatsText = (r: RoomRow): string => `${r.humans}/${r.seats}`;

/** "2/3" while racing, "–" before the start. */
export const lapText = (r: RoomRow): string => (r.lap > 0 ? `${r.lap}/${r.laps}` : "–");

/**
 * One fetch at a time: a refresh while one runs is skipped, a rejected fetch
 * counts as failed (null), answers arriving after stop() are dropped.
 */
export class Refresher<T> {
  private gen = 0;
  private busy = false;
  private readonly fetch: () => Promise<T | null>;
  private readonly apply: (v: T | null) => void;

  constructor(fetch: () => Promise<T | null>, apply: (v: T | null) => void) {
    this.fetch = fetch;
    this.apply = apply;
  }

  async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const gen = this.gen;
    let v: T | null = null;
    try {
      v = await this.fetch();
    } catch {
      v = null;
    } finally {
      this.busy = false;
    }
    if (gen === this.gen) this.apply(v);
  }

  stop(): void {
    this.gen++;
  }
}

export class RoomList {
  readonly el: HTMLElement;
  private readonly body = h("tbody");
  private readonly status = h("p", { class: "muted room-status", role: "status" });
  private readonly onJoin: (code: string) => void;
  private readonly refresher: Refresher<RoomRow[]>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(onJoin: (code: string) => void) {
    this.onJoin = onJoin;
    this.refresher = new Refresher(() => fetchRooms(), (rows) => this.show(rows));
    const head = h("tr", {}, ...(["rooms.code", "rooms.handling", "rooms.contact", "rooms.laps", "rooms.humans", "rooms.phase", "rooms.lap"] as const)
      .map((k) => h("th", { scope: "col", class: k === "rooms.laps" || k === "rooms.humans" || k === "rooms.lap" ? "num" : null }, t(k))), h("th", {}));
    this.el = h("section", { class: "panel card rooms" },
      h("div", { class: "card-head" }, h("h2", {}, t("rooms.title")), h("span", { class: "live-dot", "aria-hidden": "true" })),
      h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", {}, head), this.body)),
      this.status);
    text(this.status, t("rooms.loading"));
  }

  start(): void {
    if (this.timer !== null) return;
    void this.refresher.run();
    this.timer = setInterval(() => void this.refresher.run(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.refresher.stop();
  }

  private show(rows: RoomRow[] | null): void {
    if (rows === null) {
      text(this.status, t("rooms.failed")); // keep the last list
      return;
    }
    text(this.status, rows.length ? "" : t("rooms.none"));
    fill(this.body, ...rows.map((r) => this.row(r)));
  }

  private row(r: RoomRow): HTMLElement {
    const full = r.humans >= r.seats;
    const join = h("button", { type: "button", class: "btn small", disabled: full }, full ? t("rooms.full") : t("common.join"));
    join.addEventListener("click", () => this.onJoin(r.code));
    return h("tr", {},
      h("td", {}, h("span", { class: "code-tag" }, r.code)),
      h("td", {}, handlingName(r.handling)),
      h("td", {}, contactName(r.contact)),
      h("td", { class: "num" }, r.laps),
      h("td", { class: "num" }, seatsText(r)),
      h("td", {}, h("span", { class: `phase phase-${r.phase}` }, phaseName(r.phase))),
      h("td", { class: "num" }, lapText(r)),
      h("td", { class: "end" }, join));
  }
}
