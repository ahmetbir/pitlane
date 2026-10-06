// The leaderboard page: the own pilot card (/api/me), then wins (then
// podiums) and best laps on Kıyı, each for this week or all time.
import { fill, h, text } from "roomkit/ui/dom";
import { t, type Key } from "../i18n/index.ts";
import { fetchLaps, fetchMe, fetchWins, type Board, type LapRow, type Period, type PilotCard, type WinRow } from "../net/api.ts";
import { fmtLap } from "./fmt.ts";
import { Refresher } from "./rooms.ts";
import { loadToken } from "./prefs.ts";
import { focusFirst, page, seg } from "./widgets.ts";

type Tab = "wins" | "laps";

export function showLeaderboard(root: HTMLElement, back: () => void): void {
  let tab: Tab = "wins";
  let period: Period = "week";
  const status = h("p", { class: "muted", role: "status" });
  const table = h("table", { class: "table board" });

  const show = (b: Board<WinRow> | Board<LapRow> | null) => {
    fill(table);
    if (b === null) return text(status, t("board.failed"));
    if (b === "off") return text(status, t("board.off"));
    text(status, b.top.length ? "" : t("board.empty"));
    if (!b.top.length) return;
    const cols: Key[] = tab === "wins" ? ["board.name", "board.winsCol", "board.podiums", "board.races"] : ["board.name", "board.time"];
    const rows = b.top.map((r, i) => {
      const cells = "ms" in r ? [fmtLap(r.ms)] : [r.wins, r.podiums, r.races];
      return h("tr", {}, h("td", { class: "num" }, i + 1), h("td", {}, r.name), ...cells.map((c) => h("td", { class: "num mono" }, c)));
    });
    fill(table, h("thead", {}, h("tr", {}, h("th", { scope: "col", class: "num" }, "#"), ...cols.map((k) => h("th", { scope: "col", class: k === "board.name" ? null : "num" }, t(k))))), h("tbody", {}, ...rows));
  };
  let refresher: Refresher<Board<WinRow> | Board<LapRow>> | null = null;
  const load = () => {
    refresher?.stop();
    text(status, t("board.loading"));
    refresher = new Refresher<Board<WinRow> | Board<LapRow>>(() => (tab === "wins" ? fetchWins(period) : fetchLaps(period)), show);
    void refresher.run();
  };
  const tabs = seg(t("board.kind"), [{ v: "wins" as Tab, label: t("board.wins") }, { v: "laps" as Tab, label: t("board.laps") }], tab, (v) => {
    tab = v;
    load();
  });
  const periods = seg(t("board.period"), [{ v: "week" as Period, label: t("board.week") }, { v: "all" as Period, label: t("board.all") }], period, (v) => {
    period = v;
    load();
  });
  const me = h("section", { class: "me", "aria-label": t("me.title") });
  const mine = new Refresher(() => fetchMe(loadToken()), (c) => showMe(me, c));
  fill(root, page("board-page", t("board.title"), () => {
    refresher?.stop();
    mine.stop();
    back();
  }, me, h("div", { class: "toolbar" }, tabs, periods), h("div", { class: "table-wrap" }, table), status));
  focusFirst(root);
  void mine.run();
  load();
}

/** The own card: five numbers, or why there are none (stats off: nothing at all). */
function showMe(el: HTMLElement, c: PilotCard | "none" | "off" | null): void {
  if (c === "off") return fill(el);
  if (c === null || c === "none") return fill(el, h("h3", {}, t("me.title")), h("p", { class: "muted" }, t(c === null ? "me.failed" : "me.none")));
  const stat = (k: Key, v: string | number) => h("div", { class: "stat" }, h("span", { class: "label" }, t(k)), h("strong", { class: "mono" }, v));
  fill(el, h("h3", {}, t("me.title"), " · ", c.name),
    h("div", { class: "stats" }, stat("me.races", c.races), stat("me.wins", c.wins), stat("me.podiums", c.podiums), stat("me.laps", c.laps), stat("me.best", fmtLap(c.best))));
}
