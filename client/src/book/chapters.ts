// The manual's chapters, in reading order; each renders in the current language.
import { lang, t, type Key } from "../i18n/index.ts";
import { EN_BOOK } from "./en.ts";
import type { Chapter } from "./kit.ts";
import { TR_BOOK } from "./tr.ts";

export type ChapterName = "start" | "controls" | "handling" | "garage" | "race" | "contact" | "launch";

/** Chapter id (stable: remembered in storage), its prose and its title key. */
const ORDER: [string, ChapterName, Key][] = [
  ["baslarken", "start", "ch.start"], ["kontroller", "controls", "ch.controls"], ["arcade-sim", "handling", "ch.handling"],
  ["garaj", "garage", "ch.garage"], ["yaris", "race", "ch.race"], ["temas", "contact", "ch.contact"], ["kalkis", "launch", "ch.launch"],
];

export const CHAPTERS: readonly Chapter[] = ORDER.map(([id, name, title]) => ({
  id, title: () => t(title), render: (ctx) => (lang() === "tr" ? TR_BOOK : EN_BOOK)[name](ctx),
}));
