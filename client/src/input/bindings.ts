// Key bindings: the one table the controls (input.ts), the settings page, the
// controls card, the HUD's launch hint and the driver's manual read. Each
// action holds up to SLOTS key codes (KeyboardEvent.code); a code belongs to
// one action at most. Rebinding a code that another action holds swaps them.
import { t, type Key } from "../i18n/index.ts";

export const ACTIONS = ["throttle", "brake", "brakeReverse", "left", "right", "launch", "camera", "lookBack", "help"] as const;
export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, readonly string[]>;

/** Key slots per action. */
export const SLOTS = 2;

const DEFAULTS: Bindings = {
  throttle: ["KeyW", "ArrowUp"],
  brake: ["Space"],
  brakeReverse: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  launch: ["ShiftLeft", "ShiftRight"],
  camera: ["KeyC"],
  lookBack: ["KeyR"],
  help: ["F1"],
};

export function defaultBindings(): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a, [...DEFAULTS[a]]])) as unknown as Bindings;
}

/** Codes that never bind: Escape cancels a capture; Ctrl, Alt and Meta belong to the browser. */
export function bindable(code: string): boolean {
  return /^[A-Za-z0-9]{1,24}$/.test(code) && code !== "Escape" && !/^(Control|Alt|Meta|OS)(Left|Right)?$/.test(code);
}

/**
 * A stored value as bindings: every action an array of up to SLOTS bindable
 * codes, each code once (an earlier action keeps it). A missing or malformed
 * action takes its defaults, minus codes already taken.
 */
export function cleanBindings(v: unknown): Bindings {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const used = new Set<string>();
  const take = (codes: readonly unknown[]): string[] => {
    const out: string[] = [];
    for (const c of codes) {
      if (typeof c !== "string" || !bindable(c) || used.has(c) || out.length >= SLOTS) continue;
      used.add(c);
      out.push(c);
    }
    return out;
  };
  const out: Partial<Record<Action, string[]>> = {};
  const missing: Action[] = [];
  for (const a of ACTIONS) {
    const raw = o[a];
    if (Array.isArray(raw)) out[a] = take(raw);
    else missing.push(a);
  }
  for (const a of missing) out[a] = take(DEFAULTS[a]);
  return out as Bindings;
}

/**
 * b with code in action's slot. A code another slot holds moves here, and the
 * key this slot held goes there (a swap); an empty slot fills the next free one.
 */
export function rebind(b: Bindings, action: Action, slot: number, code: string): Bindings {
  if (!bindable(code) || slot < 0 || slot >= SLOTS) return b;
  const out = Object.fromEntries(ACTIONS.map((a) => [a, [...b[a]]])) as Record<Action, string[]>;
  const old = out[action][slot];
  for (const a of ACTIONS) {
    const i = out[a].indexOf(code);
    if (i < 0) continue;
    if (a === action && i === slot) return b;
    if (old !== undefined) out[a][i] = old;
    else out[a].splice(i, 1);
  }
  const mine = out[action];
  if (slot < mine.length) mine[slot] = code;
  else mine.push(code);
  return out;
}

/** b with action's slot emptied. */
export function unbind(b: Bindings, action: Action, slot: number): Bindings {
  const out = Object.fromEntries(ACTIONS.map((a) => [a, [...b[a]]])) as Record<Action, string[]>;
  out[action].splice(slot, 1);
  return out;
}

/** code → action. */
export function actionMap(b: Bindings): Map<string, Action> {
  const m = new Map<string, Action>();
  for (const a of ACTIONS) for (const c of b[a]) if (!m.has(c)) m.set(c, a);
  return m;
}

const SYMBOLS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Slash: "/", Period: ".", Comma: ",", Semicolon: ";", Quote: "'", Backquote: "`",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=",
  CapsLock: "Caps Lock", Enter: "Enter", Backspace: "Backspace", Tab: "Tab",
};

const shift = (c: string) => c === "ShiftLeft" || c === "ShiftRight";

/** "KeyW" → "W", "ArrowUp" → "↑", "Space" → "Boşluk" / "Space", "ShiftRight" → "Sağ Shift" / "Right Shift". */
export function keyName(code: string): string {
  if (code === "Space") return t("key.space");
  if (code === "ShiftLeft") return t("key.shiftLeft");
  if (code === "ShiftRight") return t("key.shiftRight");
  if (SYMBOLS[code]) return SYMBOLS[code];
  const num = /^Numpad(.+)$/.exec(code);
  if (num) return `Num ${num[1]}`;
  return code.replace(/^(Key|Digit)/, "");
}

/** A list label of codes, each key family once: "W / ↑", "Shift". */
export function keysLabel(codes: readonly string[]): string {
  const family = (c: string) => (shift(c) ? "Shift" : keyName(c));
  return [...new Set(codes.map(family))].join(" / ") || "–";
}

/** The first key of an action ("" when unbound), for chord hints: "Shift+W". */
export function firstKey(b: Bindings, a: Action): string {
  return b[a].length ? (shift(b[a][0]) ? "Shift" : keyName(b[a][0])) : "";
}

/** The action's name in the current language. */
export const actionName = (a: Action): string => t(`act.${a}` as Key);

/** One row of a key list: keys, what they do. */
export type KeyRow = [string, string];

/** The keyboard rows (settings, manual, controls card): every action with its keys. */
export function keyRows(b: Bindings): KeyRow[] {
  const th = firstKey(b, "throttle");
  return ACTIONS.map((a): KeyRow => {
    if (a === "launch") return [b.launch.length && th ? `${firstKey(b, "launch")} + ${th}` : "–", t("act.launchRow")];
    if (a === "help") return [`${keysLabel(b.help)} / ?`, t("act.helpRow")];
    return [keysLabel(b[a]), t(`act.${a}Row` as Key)];
  });
}

/** The gamepad rows (standard mapping; Xbox names, PlayStation in brackets). */
export function padRows(): KeyRow[] {
  return [
    ["RT [R2]", t("pad.throttle")], ["LT [L2]", t("pad.brake")], [t("pad.stickKey"), t("pad.steer")],
    ["B [○]", t("pad.reverse")], ["A [✕] + RT", t("pad.launch")],
  ];
}
