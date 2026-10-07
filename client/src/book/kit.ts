// Building blocks of the driver's manual: text blocks, tables and a tiny SVG
// builder. DOM only through createElement(NS) and text nodes.
import { append, h, type Child } from "roomkit/ui/dom";
import type { Bindings } from "../input/bindings.ts";

/** What a chapter renders from: the player's key bindings. */
export type BookCtx = { keys: Bindings };

/** A chapter's content in one language. */
export type ChapterBody = (ctx: BookCtx) => Node[];

/** A chapter: its stable id, its title and content in the current language. */
export type Chapter = { id: string; title(): string; render(ctx: BookCtx): Node[] };

export { fixed, num } from "../i18n/format.ts";

export const p = (...c: Child[]) => h("p", {}, ...c);
export const b = (...c: Child[]) => h("strong", {}, ...c);
export const kbd = (k: string) => h("kbd", {}, k);
export const sub = (title: string) => h("h3", { class: "book-sub" }, title);

/** A bullet list; each item may mix text and nodes. */
export function list(...items: Child[][]): HTMLElement {
  return h("ul", { class: "book-list" }, ...items.map((c) => h("li", {}, ...c)));
}

/** A numbered list. */
export function steps(...items: Child[][]): HTMLElement {
  return h("ol", { class: "book-steps" }, ...items.map((c) => h("li", {}, ...c)));
}

/** A tip / warning box. */
export const note = (kind: "tip" | "warn", ...c: Child[]) => h("div", { class: `book-note ${kind}` }, ...c);

/** A table: header row and body rows. */
export function table(head: string[], rows: Child[][]): HTMLElement {
  return h("div", { class: "book-table-wrap" }, h("table", { class: "book-table" },
    h("thead", {}, h("tr", {}, ...head.map((x) => h("th", {}, x)))),
    h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c)))))));
}

/** A figure: a drawing with a caption. */
export const figure = (art: SVGSVGElement, caption: string) => h("figure", { class: "book-fig" }, art, h("figcaption", {}, caption));

const NS = "http://www.w3.org/2000/svg";

/** An SVG element; children may be text (as text nodes). */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  append(e, ...children);
  return e;
}

/** An <svg> of w × h user units that scales to its box; label is its accessible name. */
export function art(w: number, hgt: number, label: string, ...children: Child[]): SVGSVGElement {
  return s("svg", { viewBox: `0 0 ${w} ${hgt}`, class: "book-art", role: "img", "aria-label": label }, s("title", {}, label), ...children);
}

/** A text label in a drawing. */
export const label = (x: number, y: number, t: string, cls = "") => s("text", { x, y, class: `t ${cls}`.trim() }, t);
