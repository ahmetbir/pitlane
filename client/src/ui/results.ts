// The results table: position, driver, laps, total time, best lap, penalty.
// A car that did not finish (total 0) is marked DNF; the fastest lap is purple.
import { fill, h } from "roomkit/ui/dom";
import { t } from "../i18n/index.ts";
import type { ResultRow } from "../net/protocol.ts";
import { fmtLap } from "./fmt.ts";

/** A penalty: 5000 → "+5 s" / "+5 sn", 0 → "". */
export function penaltyText(ms: number): string {
  return ms > 0 ? t("results.penaltySec", { n: Math.round(ms / 1000) }) : "";
}

/** One table row's texts; dnf when the car did not finish. */
export function resultCells(r: ResultRow): { pos: string; name: string; laps: string; total: string; best: string; penalty: string; dnf: boolean } {
  const dnf = r.total <= 0;
  return {
    pos: dnf ? t("results.dnf") : String(r.pos),
    name: r.name,
    laps: String(r.laps),
    total: dnf ? t("results.dnf") : fmtLap(r.total),
    best: r.best > 0 ? fmtLap(r.best) : fmtLap(0),
    penalty: penaltyText(r.penalty),
    dnf,
  };
}

/** The fastest best lap among rows, 0 = none. */
export function fastest(rows: readonly ResultRow[]): number {
  let m = 0;
  for (const r of rows) if (r.best > 0 && (m === 0 || r.best < m)) m = r.best;
  return m;
}

/** The results screen; actions (Leave) go under the table. */
export function resultsView(rows: readonly ResultRow[], own: number, ...actions: HTMLElement[]): HTMLElement {
  const top = fastest(rows);
  const body = h("tbody");
  fill(body, ...rows.map((r) => {
    const c = resultCells(r);
    const cls = [r.id === own ? "me" : "", c.dnf ? "dnf" : ""].filter(Boolean).join(" ");
    return h("tr", { class: cls || null },
      h("td", { class: "num" }, c.pos),
      h("td", {}, c.name),
      h("td", { class: "num" }, c.laps),
      h("td", { class: "num mono" }, c.total),
      h("td", { class: `num mono ${r.best > 0 && r.best === top ? "purple" : ""}`.trim() }, c.best),
      h("td", { class: "num mono penalty" }, c.penalty));
  }));
  const head = h("tr", {}, ...(["results.pos", "results.name", "results.laps", "results.total", "results.best", "results.penalty"] as const)
    .map((k) => h("th", { scope: "col", class: k === "results.name" ? null : "num" }, t(k))));
  return h("div", { class: "results-screen" },
    h("section", { class: "panel" },
      h("h2", {}, t("results.title")),
      h("div", { class: "table-wrap" }, h("table", { class: "table results" }, h("thead", {}, head), body)),
      h("p", { class: "muted hint" }, t("results.next")),
      actions.length ? h("div", { class: "actions" }, ...actions) : null));
}
