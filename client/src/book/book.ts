// The driver's manual: a modal with a chapter list and a content pane, opened
// from the home page, the controls card and the race HUD. It lives on
// document.body while open, so the screens below can re-render freely. Esc
// closes it; Tab cycles inside it; the last chapter is remembered.
import { tabMove, trapIndex } from "roomkit/ui/modal";
import { fill, h } from "roomkit/ui/dom";
import { slot, type Store } from "roomkit/store";
import { t } from "../i18n/index.ts";
import { CHAPTERS } from "./chapters.ts";
import type { BookCtx, Chapter } from "./kit.ts";

const LAST = slot("pitlane.book");

/** The remembered chapter index (0 when unknown or storage is blocked). */
export function lastChapter(chapters: readonly Chapter[], store?: Pick<Store, "getItem"> | null): number {
  const id = LAST.get(store);
  return Math.max(0, chapters.findIndex((c) => c.id === id));
}

export class Book {
  private el: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private page: HTMLElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private current = 0;
  private back: HTMLElement | null = null; // focus to restore on close
  private readonly ctx: () => BookCtx;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onFocus = (e: FocusEvent) => {
    if (this.panel && e.target instanceof Node && !this.panel.contains(e.target)) this.panel.focus();
  };

  /** ctx: what the chapters render from (read at every open: the bindings may have changed). */
  constructor(ctx: () => BookCtx) {
    this.ctx = ctx;
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  open(): void {
    if (this.el) return;
    const active = document.activeElement;
    this.back = active instanceof HTMLElement ? active : null;
    this.tabs = CHAPTERS.map((c, i) => {
      const b = h("button", {
        type: "button", class: "book-tab", role: "tab", id: `book-tab-${c.id}`, "aria-controls": "book-page", "aria-selected": "false", tabindex: -1,
      }, h("span", { class: "book-num" }, String(i + 1)), c.title());
      b.addEventListener("click", () => this.show(i, false));
      return b;
    });
    const toc = h("nav", { class: "book-toc", role: "tablist", "aria-orientation": "vertical", "aria-label": t("book.toc") }, ...this.tabs);
    toc.addEventListener("keydown", (e) => {
      const to = tabMove(e.key, this.current, this.tabs.length);
      if (to === null) return;
      e.preventDefault();
      this.show(to, true);
    });
    const close = h("button", { type: "button", class: "btn small ghost", "aria-label": t("book.closeAria") }, t("common.close"));
    close.addEventListener("click", () => this.close());
    this.page = h("article", { class: "book-page", role: "tabpanel", tabindex: 0, id: "book-page" });
    // tabindex -1: a click on plain text focuses the panel, so focus never drops to <body>.
    this.panel = h("div", { class: "panel book-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "book-title", tabindex: -1 },
      h("div", { class: "book-head" }, h("h2", { id: "book-title" }, t("book.title")), close),
      h("div", { class: "book-body" }, toc, this.page));
    this.el = h("div", { class: "book-overlay" }, this.panel);
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    document.body.append(this.el);
    // Capture on window: runs before the race's own key handlers (Esc never reaches the garage overlay).
    window.addEventListener("keydown", this.onKey, true);
    document.addEventListener("focusin", this.onFocus);
    this.show(lastChapter(CHAPTERS), true);
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = this.panel = this.page = null;
    window.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("focusin", this.onFocus);
    if (this.back?.isConnected) this.back.focus();
    this.back = null;
  }

  /** Esc closes the book (only the book); Tab and Shift+Tab cycle inside it. */
  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Tab" || !this.panel) return;
    e.preventDefault();
    e.stopPropagation();
    const list = Array.from(this.panel.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]"))
      .filter((x) => x !== this.panel && x.tabIndex >= 0 && !(x as HTMLButtonElement).disabled);
    if (!list.length) return;
    const cur = list.indexOf(document.activeElement as HTMLElement);
    list[trapIndex(cur, list.length, e.shiftKey)].focus();
  }

  /** Shows chapter i; focusTab moves the focus to its tab (keyboard and open). */
  private show(i: number, focusTab: boolean): void {
    if (!this.page) return;
    this.current = i;
    const c = CHAPTERS[i];
    this.tabs.forEach((b, j) => {
      b.setAttribute("aria-selected", String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    this.page.setAttribute("aria-labelledby", `book-tab-${c.id}`);
    fill(this.page, h("h2", { class: "book-title" }, c.title()), ...c.render(this.ctx()));
    this.page.scrollTop = 0;
    LAST.set(c.id); // storage blocked: the manual opens on the first chapter next time
    const tab = this.tabs[i];
    if (focusTab) tab.focus();
    tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
}
