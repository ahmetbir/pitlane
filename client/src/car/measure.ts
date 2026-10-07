// Numbers the garage and the driver's manual quote, measured on the car model
// itself (the same procedure as car_test.go's zeroTo), so they follow any
// change to the physics. Cached: each case runs once per page.
import { defaultSetup, DT, Handling, launchRPM, newParams, noDamage, speed, step, TC, type State } from "./car.ts";

const ASPHALT = { mu: 1, drag: 0 };
const HOLD_STEPS = 90; // 1.5 s on the brakes at full throttle: the engine is at launchRPM
const cache = new Map<string, number>();

function rest(): State {
  return { x: 0, z: 0, h: 0, hx: 1, hz: 0, vx: 0, vy: 0, r: 0, delta: 0, rpm: 0, gear: 1, ax: 0, launch: false, dmg: noDamage() };
}

/**
 * Seconds from rest to v m/s at full throttle on a straight, default setup
 * with traction control tc (Arcade ignores it); launch: after a launch hold.
 */
export function zeroTo(h: Handling, tc: number, v: number, launch: boolean): number {
  const key = `${h}/${tc}/${v}/${launch}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const su = defaultSetup();
  su[TC] = tc;
  const p = newParams(h, su, noDamage());
  const st = rest();
  if (launch) for (let i = 0; i < HOLD_STEPS; i++) step(st, p, { throttle: 1, brake: 1, steer: 0 }, ASPHALT);
  let prev = speed(st);
  let out = Infinity;
  for (let i = 0; i < 60 * 20; i++) {
    step(st, p, { throttle: 1, brake: 0, steer: 0 }, ASPHALT);
    const s = speed(st);
    if (s >= v) {
      out = (i + (v - prev) / (s - prev)) * DT;
      break;
    }
    prev = s;
  }
  cache.set(key, out);
  return out;
}

/** 0–100 km/h in seconds. */
export const zeroTo100 = (h: Handling, tc: number, launch = false): number => zeroTo(h, tc, 100 / 3.6, launch);

/** Seconds the launch hold takes to bring the engine to within 1 % of launchRPM. */
export function launchRevS(h: Handling = Handling.Sim): number {
  const p = newParams(h, defaultSetup(), noDamage());
  const st = rest();
  for (let i = 1; i <= 600; i++) {
    step(st, p, { throttle: 1, brake: 1, steer: 0 }, ASPHALT);
    if (st.rpm >= launchRPM * 0.99) return i * DT;
  }
  return Infinity;
}

/** The reverse gear's steady speed (m/s, positive) at full throttle, after 6 s from rest. */
export function reverseTop(h: Handling = Handling.Sim): number {
  const p = newParams(h, defaultSetup(), noDamage());
  const st = rest();
  for (let i = 0; i < 360; i++) step(st, p, { throttle: 1, brake: 0, steer: 0, reverse: true }, ASPHALT);
  return -st.vx;
}
