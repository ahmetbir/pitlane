// A debug driver for the render check: pure pursuit toward the racing line
// with a curvature speed limit looked up ahead. Not the server's bot; it only
// has to lap tidily enough to look at.
import type { Input, State } from "../car/car.ts";
import type { Track } from "../track/track.ts";

const WHEELBASE = 3.6;  // m (cgFront + cgRear)
const STEER_LOCK = 0.3; // rad at steer = 1
const ARCADE_VX = 60;   // m/s: Arcade's speed scaling of the steering target
const BRAKE_A = 14;     // m/s², planned braking (well short of the car's best)
const CG_FRONT = 1.98;  // m
const FRONT_SLIP = 0.11; // rad: front slip angle the steering stays within

export class AutoDriver {
  private readonly t: Track;
  private readonly grip: number;
  private readonly ds: number;

  /** grip: lateral acceleration (m/s²) the speed limit allows; vary it per car for spread. */
  constructor(t: Track, grip = 24) {
    this.t = t;
    this.grip = grip;
    this.ds = t.length / t.segs.length;
  }

  /** The racing line's lateral offset at distance s. */
  lineAt(s: number): number {
    const n = this.t.segs.length;
    const u = s / this.ds, i = Math.floor(u), f = u - i;
    const a = this.t.line[((i % n) + n) % n], b = this.t.line[(((i + 1) % n) + n) % n];
    return a + (b - a) * f;
  }

  /** Input for st at distance s along the track (Arcade steering scale). */
  input(st: State, s: number): Input {
    const v = Math.hypot(st.vx, st.vy);
    const look = 8 + 0.35 * v;
    const [px, pz] = this.t.point(s + look, this.lineAt(s + look));
    const dx = px - st.x, dz = pz - st.z;
    const alpha = Math.atan2(-dx * st.hz + dz * st.hx, dx * st.hx + dz * st.hz);
    const kappa = (2 * Math.sin(alpha)) / look;
    // Yaw-rate feedback (as the server bot): steer less when the car already rotates faster than the arc.
    const vr = Math.max(v, 5);
    let delta = WHEELBASE * kappa + (WHEELBASE * (kappa * vr - st.r)) / vr;
    // Keep the front slip angle near the tyre's peak (Arcade's 0.14 rad).
    if (st.vx > 3) {
      const th = (st.vy + CG_FRONT * st.r) / st.vx;
      delta = Math.max(th - FRONT_SLIP, Math.min(th + FRONT_SLIP, delta));
    }
    const steer = (delta / STEER_LOCK) * (1 + Math.max(st.vx, 0) / ARCADE_VX);

    const err = this.targetSpeed(s, v) - v;
    return {
      // Short of wheelspin in the low gears, and off while the car slides.
      throttle: Math.abs(st.vy) > 2.5 ? 0 : Math.max(0, Math.min(1, err / 4, 0.5 + v / 80)),
      brake: Math.max(0, Math.min(1, -err / 2)),
      steer: Math.max(-1, Math.min(1, steer)),
    };
  }

  // targetSpeed is the fastest speed from which every corner within braking range is still makeable.
  private targetSpeed(s: number, v: number): number {
    const reach = (v * v) / (2 * BRAKE_A) + 30;
    let best = Infinity;
    for (let d = 0; d <= reach; d += 4) {
      const i = Math.floor((s + d) / this.ds);
      const k = Math.abs(this.t.segs[((i % this.t.segs.length) + this.t.segs.length) % this.t.segs.length].k);
      const vk = Math.sqrt(this.grip / Math.max(k, 1e-4));
      best = Math.min(best, Math.sqrt(vk * vk + 2 * BRAKE_A * d));
    }
    return best;
  }
}
