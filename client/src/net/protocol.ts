// Wire messages, version 1; mirrors internal/protocol (the Go JSON tags and
// documented examples are authoritative). Decoders check shapes only: the
// server is trusted, a malformed message is dropped instead of crashing a frame.

import { cleanInput, type Input, type Setup } from "../car/car.ts";

export const VERSION = 1;

export type HandlingName = "arcade" | "sim";
export type ContactName = "ghost" | "soft" | "full";
export type Phase = "grid" | "lights" | "racing" | "finish" | "results";

// Client → server.

export type Hello = { t: "hello"; v: number; name: string; tok?: string };
/** Missing settings take the server defaults. */
export type Create = { t: "create"; handling?: HandlingName; contact?: ContactName; laps?: 3 | 5 | 8; listed?: boolean };
export type Join = { t: "join"; code: string };
export type Quick = { t: "quick" };
/** One tick of input in wire units: th 0..100, br 0..100, st −127..127 (left +); seq starts at 1. */
export type In = { t: "in"; seq: number } & WireInput;
/** Garage setup [fw, rw, bb, gear, diff, susp]; grid phase only. */
export type Ready = { t: "ready"; setup: Setup };
/** Creator only, grid phase only. */
export type Start = { t: "start" };
export type Ping = { t: "ping"; ts: number };
/** Quick chat preset 1..6. */
export type Chat = { t: "chat"; id: number };
export type ClientMsg = Hello | Create | Join | Quick | In | Ready | Start | Ping | Chat;

export type WireInput = { th: number; br: number; st: number };

/** Go's math.Round: halves away from zero (Math.round rounds −2.5 to −2). */
function goRound(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Quantises a car input to wire units (protocol.WireInput). */
export function wireInput(in_: Input): WireInput {
  const c = cleanInput(in_);
  return { th: goRound(c.throttle * 100), br: goRound(c.brake * 100), st: goRound(c.steer * 127) };
}

/** The car model's input of a wire input (protocol.Input.Car): th/100, br/100, st/127. */
export function carInput(w: WireInput): Input {
  return { throttle: w.th / 100, brake: w.br / 100, steer: w.st / 127 };
}

// Server → client.

/** {"t":"welcome","you":7,"code":"K3FQ","car":4,"handling":"arcade","contact":"soft","laps":5,"track":"kiyi","creator":true} */
export type Welcome = {
  t: "welcome"; you: number; code: string; tok?: string;
  car: number; handling: HandlingName; contact: ContactName; laps: number; track: string; creator: boolean;
};
/** 30 Hz state; cars rows as EncodeCar (decodeCar). clock: race clock ms. */
export type Snap = { t: "snap"; tick: number; ack: number; phase: Phase; clock: number; cars: number[][] };
export type GridCar = { id: number; name: string; bot: boolean; ready: boolean };
/** creator: car id that may press start, 0 = none. */
export type Grid = { t: "grid"; cars: GridCar[]; creator: number };
/** on: lights lit 1..5; on 0 with out: the tick they went out. */
export type Lights = { t: "lights"; on: number; out?: number };
/** best: the car's best valid lap ms, 0 = none. */
export type Lap = { t: "lap"; car: number; lap: number; ms: number; valid: boolean; best: number };
export type ResultRow = { pos: number; id: number; name: string; laps: number; total: number; best: number; penalty: number };
export type Results = { t: "results"; rows: ResultRow[] };
/** A car's front wing came off. */
export type Wing = { t: "wing"; car: number };
/** The marshals put a stuck car back on the racing line. */
export type Reset = { t: "reset"; car: number };
export type Notice = { t: "notice"; msg: string; code?: string };
export type ErrorMsg = { t: "error"; msg: string; code?: string };
export type Pong = { t: "pong"; ts: number };
export type ChatMsg = { t: "chat"; from: number; id: number };
export type ServerMsg = Welcome | Snap | Grid | Lights | Lap | Results | Wing | Reset | Notice | ErrorMsg | Pong | ChatMsg;

/** Notice codes (protocol.NoticeCodes) and Pitlane's refusal code. */
export const NOTICE_CODES = ["not_creator", "not_grid"] as const;
export const REFUSAL_CODES = ["racing"] as const;

/** Car flag bits (the last element of a cars row). */
export const FlagBot = 1 << 0;
export const FlagFinished = 1 << 1;
export const FlagWingLost = 1 << 2;
export const FlagOffTrack = 1 << 3;

/** One decoded cars row: SI units, heading in (−π, π], s in m. */
export type CarRow = {
  id: number; x: number; z: number; h: number; vx: number; vy: number; r: number; delta: number;
  lap: number; s: number; bot: boolean; finished: boolean; wingLost: boolean; offTrack: boolean;
};

/** Decodes [id, x·100, z·100, h·1000, vx·100, vy·100, r·1000, δ·1000, lap, s·10, flags]. */
export function decodeCar(row: readonly number[]): CarRow {
  const f = row[10];
  return {
    id: row[0], x: row[1] / 100, z: row[2] / 100, h: row[3] / 1000,
    vx: row[4] / 100, vy: row[5] / 100, r: row[6] / 1000, delta: row[7] / 1000,
    lap: row[8], s: row[9] / 10,
    bot: (f & FlagBot) !== 0, finished: (f & FlagFinished) !== 0,
    wingLost: (f & FlagWingLost) !== 0, offTrack: (f & FlagOffTrack) !== 0,
  };
}

type Check = (v: unknown) => boolean;
type Obj = Record<string, unknown>;

const int: Check = (v) => Number.isInteger(v);
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const str: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const oneOf = (...xs: string[]): Check => (v) => xs.includes(v as string);
const row: Check = (v) => Array.isArray(v) && v.length === 11 && v.every(int);
const listOf = (c: Check): Check => (v) => Array.isArray(v) && v.every(c);
const shape = (req: Record<string, Check>, opt: Record<string, Check> = {}): Check => (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Obj;
  for (const k in req) if (!req[k](o[k])) return false;
  for (const k in opt) if (o[k] !== undefined && !opt[k](o[k])) return false;
  return true;
};

const SERVER: Record<ServerMsg["t"], Check> = {
  welcome: shape(
    { you: int, code: str, car: int, handling: oneOf("arcade", "sim"), contact: oneOf("ghost", "soft", "full"), laps: int, track: str, creator: bool },
    { tok: str },
  ),
  snap: shape({ tick: int, ack: int, phase: oneOf("grid", "lights", "racing", "finish", "results"), clock: int, cars: listOf(row) }),
  grid: shape({ cars: listOf(shape({ id: int, name: str, bot: bool, ready: bool })), creator: int }),
  lights: shape({ on: int }, { out: int }),
  lap: shape({ car: int, lap: int, ms: int, valid: bool, best: int }),
  results: shape({ rows: listOf(shape({ pos: int, id: int, name: str, laps: int, total: int, best: int, penalty: int })) }),
  wing: shape({ car: int }),
  reset: shape({ car: int }),
  notice: shape({ msg: str }, { code: str }),
  error: shape({ msg: str }, { code: str }),
  pong: shape({ ts: num }),
  chat: shape({ from: int, id: int }),
};

/** m as a server message, or null when its type is unknown or a field is missing or mistyped. */
export function decodeServer(m: unknown): ServerMsg | null {
  if (typeof m !== "object" || m === null) return null;
  const t = (m as Obj).t;
  if (typeof t !== "string" || !Object.hasOwn(SERVER, t)) return null;
  return SERVER[t as ServerMsg["t"]](m) ? (m as ServerMsg) : null;
}
