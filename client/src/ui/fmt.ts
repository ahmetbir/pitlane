// Timing formats. Race timing keeps the decimal point in every language.

const MINUS = "−";
const BLANK = "-:--.---";

/** 83456 → "1:23.456"; a missing time (≤ 0, NaN) → "-:--.---". */
export function fmtLap(ms: number): string {
  return ms > 0 && Number.isFinite(ms) ? fmtTime(ms) : BLANK;
}

/** A running clock: like fmtLap, but 0 (and below) is "0:00.000". */
export function fmtTime(ms: number): string {
  const t = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`;
}

/** Signed seconds with three decimals: 123 → "+0.123", −45 → "−0.045" (a true minus sign). */
export function fmtDelta(ms: number): string {
  const r = Math.round(ms);
  return `${r < 0 ? MINUS : "+"}${(Math.abs(r) / 1000).toFixed(3)}`;
}

/** A gap in seconds, one tenth under a minute is enough on a HUD: 1234 → "1.2", 61234 → "1:01.2". */
export function fmtGap(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100)); // tenths
  const s = t / 10;
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** m/s → whole km/h. */
export function kmh(ms: number): number {
  return Number.isFinite(ms) ? Math.round(Math.abs(ms) * 3.6) : 0;
}
