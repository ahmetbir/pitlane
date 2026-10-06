import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, ROOM_GONE } from "roomkit/net/codes";
import { NOTICE_CODES, REFUSAL_CODES } from "../net/protocol.ts";
import { EN } from "./en.ts";
import { detect, setLang, t } from "./index.ts";
import { errorText, noticeText } from "./messages.ts";
import { TR } from "./tr.ts";

test("every Turkish key exists in English and the other way round", () => {
  const tr = Object.keys(TR).sort(), en = Object.keys(EN).sort();
  assert.deepEqual(tr.filter((k) => !en.includes(k)), [], "missing in en");
  assert.deepEqual(en.filter((k) => !tr.includes(k)), [], "missing in tr");
  for (const k of tr) assert.ok(JSON.stringify((EN as Record<string, unknown>)[k]).length > 2, `empty en ${k}`);
});

test("placeholders match between the languages", () => {
  const forms = (m: unknown): string[] => (typeof m === "string" ? [m] : Object.values(m as Record<string, string>));
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(TR) as (keyof typeof TR)[]) {
    for (const f of forms(EN[k])) assert.deepEqual(holes(f), holes(TR[k]), k);
  }
});

test("language detection: tr* is Turkish, anything else English", () => {
  assert.equal(detect(["tr-TR", "en"]), "tr");
  assert.equal(detect(["TR"]), "tr");
  assert.equal(detect(["en-US", "tr"]), "en");
  assert.equal(detect(["", "de"]), "en");
  assert.equal(detect([]), "en");
});

test("every error code and notice has a text in both languages", () => {
  for (const l of ["tr", "en"] as const) {
    setLang(l, null);
    for (const c of [...ERROR_CODES, ROOM_GONE, ...REFUSAL_CODES]) {
      const s = errorText(c, "raw");
      assert.ok(s && s !== "raw" && !s.startsWith("err."), `${l} ${c}: ${s}`);
    }
    for (const c of NOTICE_CODES) {
      const s = noticeText(c, "raw");
      assert.ok(s && s !== "raw" && !s.startsWith("notice."), `${l} ${c}`);
    }
  }
  setLang("en", null);
  assert.equal(errorText("racing", ""), "A race is running and no bot car is left to take over.");
  assert.equal(errorText("mystery", "server text"), "server text", "unknown code: the server's text");
  assert.equal(errorText(undefined, ""), t("err.conn"));
  assert.equal(noticeText("other", "as sent"), "as sent");
  setLang("tr", null);
  assert.equal(noticeText("not_creator", ""), "Yarışı yalnızca oda sahibi başlatabilir.");
});
