// Port of internal/car: Pitlane's vehicle model, a dynamic bicycle model
// stepped at a fixed 60 Hz. Line-by-line with car.go and step.go so the
// client's prediction matches the server bit for bit: only + − × ÷ sqrt and
// comparisons, the same operation order, and derived constants as the literal
// doubles Go uses. JS never fuses a*b+c, which equals Go's materialised
// float64(a*b)+c.

/** One simulation step. */
export const DT = 1 / 60;

export const Handling = { Arcade: 0, Sim: 1 } as const;
export type Handling = (typeof Handling)[keyof typeof Handling];

export function parseHandling(s: string): [Handling, boolean] {
  switch (s) {
    case "arcade":
      return [Handling.Arcade, true];
    case "sim":
      return [Handling.Sim, true];
  }
  return [Handling.Arcade, false];
}

export function handlingString(h: Handling): string {
  return h === Handling.Sim ? "sim" : "arcade";
}

/** Garage setup, indexed by FrontWing … TC. */
export type Setup = [number, number, number, number, number, number, number];

export const FrontWing = 0;
export const RearWing = 1;
export const BrakeBias = 2;
export const Gearing = 3;
export const Diff = 4;
export const SuspBalance = 5;
/** Traction control level: 0 off, 1..3 (Arcade always acts as 3). */
export const TC = 6;

/** Garage ranges per setup index (inclusive); read-only. */
export const setupMin: Readonly<Setup> = [1, 1, 50, 1, 1, 1, 0];
export const setupMax: Readonly<Setup> = [11, 11, 70, 5, 10, 9, 3];

export function defaultSetup(): Setup {
  return [6, 6, 58, 3, 5, 5, 2];
}

export function clampSetup(s: Setup): Setup {
  const out = s.slice() as Setup;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(Math.max(out[i], setupMin[i]), setupMax[i]);
  return out;
}

/** Damage is 0 (intact) .. 1 (broken) per part. */
export interface Damage {
  frontWing: number;
  rearWing: number;
  susp: number;
}

export function noDamage(): Damage {
  return { frontWing: 0, rearWing: 0, susp: 0 };
}

/** Whether the front wing is gone (damage above 0.6). */
export function frontWingLost(d: Damage): boolean {
  return d.frontWing > wingLost;
}

/**
 * One tick of driver input: throttle 0..1, brake 0..1, steer -1..1 (left +).
 * reverse selects the reverse gear, which the throttle drives while the car is
 * (nearly) stopped or rolling backwards; rolling forward, the throttle brakes.
 */
export interface Input {
  throttle: number;
  brake: number;
  steer: number;
  reverse?: boolean;
}

export function cleanInput(input: Input): Input {
  return { throttle: clean(input.throttle, 0, 1), brake: clean(input.brake, 0, 1), steer: clean(input.steer, -1, 1), reverse: input.reverse === true };
}

function clean(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, lo), hi);
}

/** Surface under the car: grip multiplier and extra drag. */
export interface Env {
  mu: number;
  drag: number;
}

/**
 * One car. (hx, hz) is the unit heading the step integrates; h is the
 * accumulated heading angle (display only). ax is the last step's body
 * longitudinal acceleration; dmg is bookkeeping only (rebuild Params on change).
 */
export interface State {
  x: number;
  z: number;
  h: number;
  hx: number;
  hz: number;
  vx: number;
  vy: number;
  r: number;
  delta: number;
  rpm: number;
  /** 1..8; 0 is reverse. */
  gear: number;
  ax: number;
  dmg: Damage;
}

export function speed(st: State): number {
  return Math.sqrt(st.vx * st.vx + st.vy * st.vy);
}

/** Car mass (kg), for collision impulses. */
export const Mass = 798.0;

// Model constants.
const mass = Mass;
const cgFront = 1.98;
const cgRear = 1.62;
const yawI = 1100.0;
/** Yaw inertia (kg·m²), for collision impulses. */
export const Iz = yawI;
const cdBase = 0.7;
const cdPerStep = 0.035;
const wheelR = 0.33;
const shiftUp = 12800.0;
const shiftDown = 8000.0;
const idleRPM = 4000.0;
const limitRPM = 13500.0;
const taperRPM = 13300.0;
const clRearBase = 1.5;
const simAlphaR = 0.11;
const arcAlphaR = 0.15;
const brakeMax = 30e3;
const rollRes = 120.0;
const steerLock = 0.3;
const latLoss = 0.12;
const suspLoss = 0.15;
const minLoad = 0.1;
const wingLost = 0.6;
const lostWingCL = 0.3;
const lowSpeed = 1.0;
const slipCap = 0.6;
const slipVX = 3.0;
const yawDamp = 0.9;
const yawCapK = 1.15;
const arcadeVX = 60.0;
const revEngage = 0.5;
/** Reverse drive cuts out beyond this backward speed (m/s). */
export const revTop = 8.0;
const tcCut = 0.5;
const tcShare = 0.8;
/** Share of the rear capacity the drive may ask per TC level; 0 = no limit. */
export const tcShares: readonly number[] = [0, 1.0, 0.9, tcShare];
const absCut = 0.6;
const tcSlip = 0.9;
const diffOn = 0.3;
const diffStep = 0.015;
const diffGrip = 0.03;
const latFront0 = 0.3;
const latFrontK = 0.05;

// Derived constants: the exact doubles Go uses (Go folds constant expressions exactly).
const aeroQ = 0.9187500000000001; // 0.5·ρ·A
const fzF0 = 3522.771; // m·g·b/L
const fzR0 = 4305.6089999999995; // m·g·a/L
const transferK = 66.49999999999999; // m·hcg/L
const latK = 0.18749999999999997; // hcg/track width
const rpmPerRad = 9.549296585513721; // 60/(2π)
const envDragM = 159.60000000000002; // 0.2·m
const taperSpan = 200; // limitRPM − taperRPM, folded exactly by Go

const torqueRPM = [4000, 7000, 10500, 12500, 13500];
const torqueNm = [430, 560, 600, 540, 470];

const gearTable: readonly (readonly number[])[] = [
  [16.169999999999998, 14.077693756915655, 12.256120068862218, 10.670247679494764, 9.289578178254004, 8.08755947584331, 7.0410751726508, 6.129999999999999],
  [16.169999999999998, 13.94958018798571, 12.034062301857974, 10.381578049906228, 8.956008378787832, 7.726194003968631, 6.665254347946494, 5.750000000000001],
  [16.169999999999998, 13.82133013649865, 11.813801282751133, 10.09786318465644, 8.631162693155987, 7.377498394801466, 6.305927080769321, 5.389999999999999],
  [16.169999999999998, 13.69327584116387, 11.595906200507242, 9.81978616152184, 8.315710612922839, 7.042011084603978, 5.963401376500671, 5.050000000000001],
  [16.169999999999998, 13.573994709262424, 11.394763906436875, 9.565396721043202, 8.02972445785013, 6.740595999238883, 5.658430082309467, 4.750000000000003],
];

/** Every constant step needs, derived once per car. */
export interface Params {
  mu: number;
  alphaF: number;
  alphaR: number;
  steerRate: number;
  assists: boolean;
  tcShare: number;
  aeroF: number;
  aeroR: number;
  dragK: number;
  fzF0: number;
  fzR0: number;
  transfer: number;
  brakeF: number;
  brakeR: number;
  drive: number[]; // 8 gears
  rpmPerMS: number[]; // 8 gears
  diffK: number;
  diffX: number;
  latF: number;
  latK: number;
  gripDmg: number;
}

export function newParams(h: Handling, setup: Setup, dmg: Damage): Params {
  const s = clampSetup(setup);
  const d: Damage = { frontWing: clean(dmg.frontWing, 0, 1), rearWing: clean(dmg.rearWing, 0, 1), susp: clean(dmg.susp, 0, 1) };
  let mu = 1.0, alphaF = 0.1, alphaR = simAlphaR, steerRate = 2.5, assists = false, tc = tcShares[s[TC]];
  if (h === Handling.Arcade) {
    mu = 1.25; alphaF = 0.14; alphaR = arcAlphaR; steerRate = 4.0; assists = true; tc = tcShare;
  }
  const fw = s[FrontWing] - 1, rw = s[RearWing] - 1;
  let clF = 0.9 + 0.22 * fw * (1 - 0.7 * d.frontWing);
  if (frontWingLost(d)) clF = (0.9 + 0.22 * fw) * lostWingCL;
  const clR = clRearBase + 0.26 * rw * (1 - 0.7 * d.rearWing);
  const bias = s[BrakeBias] / 100;
  const drive: number[] = [], rpmPerMS: number[] = [];
  const gears = gearTable[s[Gearing] - 1];
  for (let g = 0; g < 8; g++) {
    drive[g] = gears[g] / wheelR;
    rpmPerMS[g] = drive[g] * rpmPerRad;
  }
  return {
    mu, alphaF, alphaR, steerRate, assists, tcShare: tc,
    aeroF: aeroQ * clF,
    aeroR: aeroQ * clR,
    dragK: aeroQ * (cdBase + cdPerStep * (fw + rw)),
    fzF0, fzR0,
    transfer: transferK,
    brakeF: brakeMax * bias,
    brakeR: brakeMax * (1 - bias),
    drive, rpmPerMS,
    diffK: diffStep * (s[Diff] - 1),
    diffX: diffGrip * (s[Diff] - 1),
    latF: latFront0 + latFrontK * (s[SuspBalance] - 1),
    latK,
    gripDmg: 1 - suspLoss * d.susp,
  };
}

/** Advances st by DT (port of car.Step). */
export function step(st: State, p: Params, input: Input, env: Env): void {
  const inp = cleanInput(input);
  const mu = clean(env.mu, 0, 2);
  if (st.gear < 0 || st.gear > 8) st.gear = 1;
  {
    const n = st.hx * st.hx + st.hz * st.hz;
    if (!(n > 0.25 && n < 4)) {
      st.hx = 1;
      st.hz = 0;
    }
  }

  // Steering: rate-limited toward the (Arcade: speed-scaled) target.
  let target = inp.steer * steerLock;
  if (p.assists) target = target / (1 + Math.max(st.vx, 0) / arcadeVX);
  const stp = p.steerRate * DT;
  st.delta += Math.min(Math.max(target - st.delta, -stp), stp);

  // Slip angles (small-angle form).
  const den = Math.max(abs(st.vx), slipVX);
  const cd = 1 - (st.delta * st.delta) / 2;
  const w = st.vy + cgFront * st.r;
  const af = clamp((st.delta * st.vx - cd * w) / den, slipCap);
  const ar = clamp(-(st.vy - cgRear * st.r) / den, slipCap);

  // Reverse gear: (nearly) stopped or rolling backwards; rolling forward the pedal brakes.
  const rev = inp.reverse === true && st.vx < revEngage;
  let thr = inp.throttle, brk = inp.brake;
  if (inp.reverse === true && !rev) {
    brk = Math.max(brk, thr);
    thr = 0;
  }

  // Assists.
  if (p.assists) {
    if (abs(ar) > tcSlip * p.alphaR) thr = thr * tcCut;
    if (abs(af) > p.alphaF) brk = brk * absCut;
  }

  // Normal loads: static + downforce ∓ longitudinal transfer.
  const v2 = st.vx * st.vx + st.vy * st.vy;
  const spd = Math.sqrt(v2);
  const tr = p.transfer * st.ax;
  const fzF = Math.max(p.fzF0 + p.aeroF * v2 - tr, minLoad * p.fzF0);
  const fzR = Math.max(p.fzR0 + p.aeroR * v2 + tr, minLoad * p.fzR0);

  // Engine and automatic gearbox; reverse (gear 0) has first gear's ratio.
  const sv = abs(st.vx);
  if (rev) {
    st.gear = 0;
  } else {
    if (st.gear === 0) st.gear = 1;
    const r0 = sv * p.rpmPerMS[st.gear - 1];
    if (r0 > shiftUp && st.gear < 8) {
      st.gear++;
    } else if (r0 < shiftDown && st.gear > 1 && sv * p.rpmPerMS[st.gear - 2] < shiftUp) {
      st.gear--;
    }
  }
  const g = Math.max(st.gear, 1) - 1;
  const rpm = Math.max(sv * p.rpmPerMS[g], idleRPM);
  st.rpm = rpm;
  let drive = 0.0; // magnitude; reverse flips its sign below
  if (thr > 0 && !(rev && st.vx < -revTop)) drive = thr * thr * torque(rpm) * p.drive[g];

  // Lateral slip forces, then lateral transfer as grip loss on each axle.
  const baseMu = mu * p.mu * p.gripDmg;
  let capF = baseMu * fzF, capR = baseMu * fzR;
  let fyF = capF * curve(af / p.alphaF);
  let fyR = capR * curve(ar / p.alphaR);
  const lat = abs(fyF + fyR) * p.latK;
  const kF = Math.max(1 - (latLoss * p.latF * lat) / fzF, 0);
  const kR = Math.max(1 - (latLoss * (1 - p.latF) * lat) / fzR, 0);
  capF = capF * kF;
  capR = capR * kR;
  fyF = fyF * kF;
  fyR = fyR * kR;
  if (!p.assists && p.tcShare > 0) {
    // Sim traction control: drive ≤ tcShare of the rear friction circle left
    // beside the cornering force; before the diff.
    const left = Math.sqrt(Math.max(capR * capR - fyR * fyR, 0));
    drive = Math.min(drive, p.tcShare * left);
  }
  let capX = capR;
  const eff = Math.min(inp.throttle * inp.throttle, drive / Math.max(capR, 1));
  if (eff > diffOn) {
    const kd = Math.max(1 - p.diffK * eff, 0);
    capX = capR * (1 + p.diffX);
    capR = capR * kd;
    fyR = fyR * kd;
  }
  if (spd < lowSpeed) {
    fyF = fyF * spd;
    fyR = fyR * spd;
    st.r = st.r * yawDamp;
  }

  // Brakes and rolling resistance oppose the full velocity; friction circle.
  let ux = 0.0, uy = 0.0;
  if (spd > 0) {
    ux = st.vx / spd;
    uy = st.vy / spd;
  }
  const bF = Math.min(brk * p.brakeF, capF);
  const bR = Math.min(brk * p.brakeR, capR);
  const fxF = -(ux * bF);
  if (p.assists) drive = Math.min(drive, tcShare * capR);
  if (rev) drive = -drive;
  const fxR = clamp(drive - ux * bR, capX);
  fyF = circle(fxF, fyF - uy * bF, capF);
  fyR = circle(fxR, fyR - uy * bR, capR);

  // Body accelerations (force part only).
  const drag = p.dragK * spd + envDragM * clean(env.drag, 0, 10);
  const fyFl = fyF * cd;
  const fx = fxF + fxR - fyF * st.delta - drag * st.vx - ux * rollRes;
  const fy = fyFl + fyR - drag * st.vy - uy * rollRes;
  let ax = fx / mass;
  const ay = fy / mass;
  const rdot = (cgFront * fyFl - cgRear * fyR) / yawI;

  // Integrate the force part; outside reverse never takes VX below 0.
  let vx = st.vx + ax * DT;
  if ((!rev && st.vx > 0 && vx < 0) || (st.vx < 0 && vx > 0 && drive === 0)) vx = 0;
  let vy = st.vy + ay * DT;
  st.r += rdot * DT;
  if (p.assists) {
    const yawCap = ((p.mu * mu * (fzF + fzR)) * yawCapK) / (mass * Math.max(vx, 5));
    st.r = Math.min(Math.max(st.r, -yawCap), yawCap);
  }
  // Brakes and rolling resistance hold a car that they can stop this tick.
  if (drive === 0 && (bF + bR + rollRes) * DT >= mass * spd) {
    vx = 0;
    vy = 0;
    st.r = 0;
    ax = 0;
  }
  st.ax = ax;

  // Rotate heading by +θ and body velocity by −θ (Taylor sin/cos).
  const th = st.r * DT;
  const t2 = th * th;
  const c = 1 - t2 / 2 + (t2 * t2) / 24;
  const s = th - (t2 * th) / 6 + (t2 * t2 * th) / 120;
  st.vx = vx * c + vy * s;
  st.vy = vy * c - vx * s;
  const hx = st.hx * c - st.hz * s;
  const hz = st.hx * s + st.hz * c;
  const n = Math.sqrt(hx * hx + hz * hz);
  st.hx = hx / n;
  st.hz = hz / n;
  st.h += th;

  // Position: world velocity = VX·heading + VY·left.
  const wx = st.vx * st.hx - st.vy * st.hz;
  const wz = st.vx * st.hz + st.vy * st.hx;
  st.x += wx * DT;
  st.z += wz * DT;
}

// torque interpolates the engine table: flat below idle, tapering linearly to
// 0 between taperRPM and limitRPM.
function torque(rpm: number): number {
  if (rpm >= limitRPM) return 0;
  if (rpm <= torqueRPM[0]) return torqueNm[0];
  let i = 1;
  while (rpm > torqueRPM[i]) i++;
  const f = (rpm - torqueRPM[i - 1]) / (torqueRPM[i] - torqueRPM[i - 1]);
  let t = torqueNm[i - 1] + f * (torqueNm[i] - torqueNm[i - 1]);
  if (rpm > taperRPM) t = (t * (limitRPM - rpm)) / taperSpan;
  return t;
}

// curve is the rational tyre curve 2s/(1+s²).
function curve(s: number): number {
  return (2 * s) / (1 + s * s);
}

// circle scales fy so that fx²+fy² ≤ cap².
function circle(fx: number, fy: number, cap: number): number {
  const c2 = cap * cap, x2 = fx * fx;
  if (x2 + fy * fy <= c2) return fy;
  const rem = Math.sqrt(Math.max(c2 - x2, 0));
  return clamp(fy, rem);
}

// abs keeps Go's sign behaviour for −0 (returns −0).
function abs(v: number): number {
  return v < 0 ? -v : v;
}

function clamp(v: number, lim: number): number {
  return Math.min(Math.max(v, -lim), lim);
}
