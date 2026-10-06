// UI language: Turkish (the source) and English on roomkit's i18n. t() reads
// the current dictionary; setLang() switches it (stored as pitlane.lang).
import { createI18n } from "roomkit/i18n/i18n";
import { EN } from "./en.ts";
import { TR, type Key } from "./tr.ts";

export type { Key } from "./tr.ts";
export type { Params } from "roomkit/i18n/types";

export type Lang = "tr" | "en";
export const LANGS: readonly Lang[] = ["tr", "en"];

/** Browser preferences → language: a first choice starting with "tr" is Turkish, anything else English. */
export function detect(prefs: readonly string[]): Lang {
  return /^tr\b/i.test(prefs.find((p) => p.trim() !== "") ?? "") ? "tr" : "en";
}

const i18n = createI18n<Lang, Key>({ dicts: { tr: TR, en: EN }, source: "tr", langs: LANGS, storeKey: "pitlane.lang", detect });

export const { lang, isLang, initialLang, setLang, onLang, t, tIn, lt } = i18n;
