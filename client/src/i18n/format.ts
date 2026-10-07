// Numbers in the current language: Turkish writes a decimal comma ("4,5"), English a point.
import { makeFormat } from "roomkit/i18n/format";
import { lang } from "./index.ts";

export const { num, fixed } = makeFormat(() => lang() === "tr");

/** A share as a percentage: 0.9 → "%90" (tr) / "90%" (en). */
export const pct = (v: number): string => (lang() === "tr" ? `%${Math.round(v * 100)}` : `${Math.round(v * 100)}%`);
