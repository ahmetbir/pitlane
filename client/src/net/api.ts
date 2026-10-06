// Read-only HTTP API (/api/rooms, /api/leaderboard): same-origin JSON with a
// timeout; every body is validated before a screen sees it.
import { normalizeCode } from "roomkit/net/code";
import type { ContactName, HandlingName, Phase } from "./protocol.ts";

const TIMEOUT_MS = 5000;
const MAX_ROWS = 50;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === "string" && (set as readonly string[]).includes(v);

export type RoomRow = {
  code: string; handling: HandlingName; contact: ContactName; laps: number;
  humans: number; seats: number; phase: Phase; lap: number;
};

const HANDLINGS = ["arcade", "sim"] as const;
const CONTACTS = ["ghost", "soft", "full"] as const;
const PHASES = ["grid", "lights", "racing", "finish", "results"] as const;

export type Reply = { ok: boolean; status: number; body: unknown };
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** GETs url; null on network errors and after the timeout. */
export async function request(url: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<Reply | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
    let body: unknown = null;
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function roomRow(v: unknown): RoomRow | null {
  if (!isObj(v) || typeof v.code !== "string" || normalizeCode(v.code) !== v.code || !v.code) return null;
  if (!oneOf(v.handling, HANDLINGS) || !oneOf(v.contact, CONTACTS) || !oneOf(v.phase, PHASES)) return null;
  if (!count(v.laps, 99) || !count(v.humans, 99) || !count(v.seats, 99) || !count(v.lap, 99)) return null;
  return { code: v.code, handling: v.handling, contact: v.contact, laps: v.laps, humans: v.humans, seats: v.seats, phase: v.phase, lap: v.lap };
}

/** The well-formed rows of an /api/rooms body (at most 50). */
export function parseRooms(v: unknown): RoomRow[] {
  if (!isObj(v) || !Array.isArray(v.rooms)) return [];
  return v.rooms.map(roomRow).filter((r): r is RoomRow => r !== null).slice(0, MAX_ROWS);
}

export async function fetchRooms(fetchImpl?: Fetch): Promise<RoomRow[] | null> {
  const r = await request("/api/rooms", fetchImpl);
  return r?.ok ? parseRooms(r.body) : null;
}

export type Period = "week" | "all";
export type WinRow = { name: string; wins: number; podiums: number; races: number };
export type LapRow = { name: string; ms: number };
/** A board, or "off" when the server keeps no stats. */
export type Board<T> = { week: string; top: T[] } | "off";

const winRow = (v: unknown): WinRow | null =>
  isObj(v) && typeof v.name === "string" && count(v.wins) && count(v.podiums) && count(v.races) ? { name: v.name, wins: v.wins, podiums: v.podiums, races: v.races } : null;
const lapRow = (v: unknown): LapRow | null =>
  isObj(v) && typeof v.name === "string" && count(v.ms) && v.ms > 0 ? { name: v.name, ms: v.ms } : null;

/** An /api/leaderboard body; malformed rows are dropped, a malformed body is null. */
export function parseBoard<T>(v: unknown, row: (v: unknown) => T | null): { week: string; top: T[] } | null {
  if (!isObj(v) || !Array.isArray(v.top)) return null;
  return { week: typeof v.week === "string" ? v.week : "", top: v.top.map(row).filter((r): r is T => r !== null).slice(0, MAX_ROWS) };
}

async function board<T>(url: string, row: (v: unknown) => T | null, fetchImpl?: Fetch): Promise<Board<T> | null> {
  const r = await request(url, fetchImpl);
  if (r && r.status === 503) return "off";
  return r?.ok ? parseBoard(r.body, row) : null;
}

export const fetchWins = (p: Period, f?: Fetch) => board(`/api/leaderboard?period=${p}`, winRow, f);
export const fetchLaps = (p: Period, f?: Fetch) => board(`/api/leaderboard?period=${p}&key=kiyi`, lapRow, f);
