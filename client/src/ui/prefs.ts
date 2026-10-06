// What the browser remembers, each under its own pitlane.* slot: the name,
// the garage setup, the settings and the pilot token. Every load validates:
// a hand-edited or stale value falls back to the default.
import { tokenStore } from "roomkit/net/pilot";
import { slot, type Store } from "roomkit/store";
import { clampSetup, defaultSetup, type Setup } from "../car/car.ts";
import type { CamMode } from "../render/cams.ts";

type Get = Pick<Store, "getItem"> | null;
type Set = Pick<Store, "setItem"> | null;

const NAME = slot("pitlane.name");
const SETUP = slot("pitlane.setup");
const SETTINGS = slot("pitlane.settings");
const tokens = tokenStore(slot("pitlane.pilot"));

export const NAME_MAX = 16;

export function storedName(store?: Get): string {
  return (NAME.get(store) ?? "").trim().slice(0, NAME_MAX);
}

export function storeName(name: string, store?: Set): void {
  NAME.set(name, store);
}

export const loadToken = (store?: Get): string => tokens.load(store);
export const storeToken = (tok: string, store?: Set): void => tokens.save(tok, store);

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The stored setup clamped to the garage ranges; the default when missing or malformed. */
export function loadSetup(store?: Get): Setup {
  const v = parse(SETUP.get(store));
  if (!Array.isArray(v) || v.length !== 6 || !v.every((x) => Number.isInteger(x))) return defaultSetup();
  return clampSetup(v as Setup);
}

/** Stores s clamped; returns what was stored. */
export function saveSetup(s: Setup, store?: Set): Setup {
  const c = clampSetup(s.map((x) => Math.round(x)) as Setup);
  SETUP.set(JSON.stringify(c), store);
  return c;
}

export type Settings = { camera: CamMode; volume: number };

export function defaultSettings(): Settings {
  return { camera: "chase", volume: 70 };
}

export function loadSettings(store?: Get): Settings {
  const v = parse(SETTINGS.get(store));
  const d = defaultSettings();
  if (typeof v !== "object" || v === null) return d;
  const o = v as Record<string, unknown>;
  const camera = o.camera === "cockpit" || o.camera === "chase" ? o.camera : d.camera;
  const volume = Number.isInteger(o.volume) ? Math.min(100, Math.max(0, o.volume as number)) : d.volume;
  return { camera, volume };
}

export function saveSettings(s: Settings, store?: Set): void {
  SETTINGS.set(JSON.stringify({ camera: s.camera, volume: s.volume }), store);
}
