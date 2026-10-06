// The TR / EN switch (home header, settings).
import { langToggle as core } from "roomkit/ui/lang";
import { lang, LANGS, setLang, t, tIn, type Lang } from "../i18n/index.ts";

/** Two toggle buttons; a click switches the language, then switched re-renders what is not live. */
export const langToggle = (switched?: (l: Lang) => void): HTMLElement =>
  core({ lang, setLang }, LANGS, () => t("lang.label"), (l) => tIn(l, `lang.${l}`), switched);
