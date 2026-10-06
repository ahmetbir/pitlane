// The leaderboard page: wins (then podiums) and best laps on Kıyı, each for
// this week or all time.
import { fill, h, text } from "roomkit/ui/dom";
import { t, type Key } from "../i18n/index.ts";
import { fetchLaps, fetchWins, type Board, type LapRow, type Period, type WinRow } from "../net/api.ts";
import { fmtLap } from "./fmt.ts";
import { Refresher } from "./rooms.ts";
import { page, seg } from "./widgets.ts";

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
  const tabs = seg(t("board.title"), [{ v: "wins" as Tab, label: t("board.wins") }, { v: "laps" as Tab, label: t("board.laps") }], tab, (v) => {
    tab = v;
    load();
  });
  const periods = seg(t("board.title"), [{ v: "week" as Period, label: t("board.week") }, { v: "all" as Period, label: t("board.all") }], period, (v) => {
    period = v;
    load();
  });
  fill(root, page("board-page", t("board.title"), () => {
    refresher?.stop();
    back();
  }, h("div", { class: "toolbar" }, tabs, periods), h("div", { class: "table-wrap" }, table), status));
  load();
}
