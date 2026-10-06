// Server error and notice codes → texts in the current language. A message
// with an unknown code (an older server) falls back to its own text.
import { isErrorCode, ROOM_GONE, type ErrorCode } from "roomkit/net/codes";
import { NOTICE_CODES, REFUSAL_CODES } from "../net/protocol.ts";
import { t, type Key } from "./index.ts";

type Fatal = ErrorCode | typeof ROOM_GONE | (typeof REFUSAL_CODES)[number];
type NoticeCode = (typeof NOTICE_CODES)[number];

export const ERROR_KEY: Record<Fatal, Key> = {
  version: "err.version", no_room: "err.no_room", bad_room: "err.bad_room", full: "err.full", bad_msg: "err.bad_msg",
  no_create: "err.no_create", busy: "err.busy", creates: "err.creates", joins: "err.joins", flood: "err.flood",
  conns: "err.conns", timeout: "err.timeout", updating: "err.updating", room_gone: "err.room_gone", racing: "err.racing",
};

export const NOTICE_KEY: Record<NoticeCode, Key> = { not_grid: "notice.not_grid", not_creator: "notice.not_creator" };

const isFatal = (c: unknown): c is Fatal => c === ROOM_GONE || isErrorCode(c) || (REFUSAL_CODES as readonly unknown[]).includes(c);
const isNotice = (c: unknown): c is NoticeCode => (NOTICE_CODES as readonly unknown[]).includes(c);

/** A fatal server error in the current language. */
export function errorText(code: string | undefined, msg: string): string {
  return isFatal(code) ? t(ERROR_KEY[code]) : msg || t("err.conn");
}

/** A server notice in the current language. */
export function noticeText(code: string | undefined, msg: string): string {
  return isNotice(code) ? t(NOTICE_KEY[code]) : msg;
}
