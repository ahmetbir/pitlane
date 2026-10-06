// Race cameras: chase (a critically damped spring on the boom behind the car)
// and cockpit (driver's eye, glancing into corners). toggle() switches them,
// lookBack(true) looks behind while held. Input is the caller's business.
import * as THREE from "three";
import { forward, toWorld } from "./frame.ts";

/** What the cameras follow: sim position and heading, front-wheel angle, speed (m/s). */
export interface CamTarget {
  x: number;
  z: number;
  h: number;
  delta: number;
  speed: number;
}

export type CamMode = "chase" | "cockpit";

const BACK = 6;        // m behind the car
const ABOVE = 2;       // m above the ground
const AHEAD = 10;      // m ahead: the chase look point
const LOOK_Y = 0.7;    // m: height of the look point
const BOOM_W = 7;      // 1/s: chase spring stiffness (ω of the critically damped spring)
const EYE_X = 0.35;    // m: eye ahead of the centre of gravity, just behind the helmet's centre
const EYE_Y = 1.0;     // m: above the halo hoop, so the helmet stays out of view and the halo frames it
const GLANCE = 1.6;    // cockpit yaw per rad of front-wheel angle
const GLANCE_W = 5;    // 1/s
const COCKPIT_FOV = 78;

/** Chase FOV in degrees: 68 at a standstill, widening to 82 at 85 m/s and above. */
export function chaseFov(speed: number): number {
  const v = Number.isFinite(speed) ? speed : 0;
  return 68 + 14 * Math.max(0, Math.min(1, (v - 15) / 70));
}

/**
 * One exact step of a critically damped spring (any dt ≥ 0, unconditionally
 * stable): x toward target with angular frequency w; returns [x, v].
 */
export function springStep(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const y = x - target, e = Math.exp(-w * dt), k = (v + w * y) * dt;
  return [target + (y + k) * e, (v - w * k) * e];
}

export class Cams {
  private readonly cam: THREE.PerspectiveCamera;
  private current: CamMode = "chase";
  private back = false;
  private fresh = true;
  private readonly boom = new THREE.Vector3(); // chase offset from the car (world)
  private readonly boomV = new THREE.Vector3();
  private glance = 0;
  private glanceV = 0;
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(cam: THREE.PerspectiveCamera) {
    this.cam = cam;
  }

  mode(): CamMode {
    return this.current;
  }

  /** Chase ↔ cockpit. */
  toggle(): void {
    this.current = this.current === "chase" ? "cockpit" : "chase";
    this.fresh = true;
  }

  /** Look behind while on. */
  lookBack(on: boolean): void {
    if (on !== this.back) this.fresh = true;
    this.back = on;
  }

  /** Jump to the target on the next update (spawn, reset). */
  snap(): void {
    this.fresh = true;
  }

  /** Moves the camera for dt seconds toward its place for t. */
  update(dt: number, t: CamTarget): void {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    const h = Number.isFinite(t.h) ? t.h : 0;
    toWorld(t.x, t.z, 0, this.pos);
    forward(h, this.fwd);
    if (this.current === "chase") this.chase(step, t.speed);
    else this.cockpit(step, h, t.delta);
    this.fresh = false;
  }

  private chase(dt: number, speed: number): void {
    const dir = this.back ? -1 : 1;
    const want = [-this.fwd.x * BACK * dir, ABOVE, -this.fwd.z * BACK * dir];
    for (let a = 0; a < 3; a++) {
      if (this.fresh) {
        this.boom.setComponent(a, want[a]);
        this.boomV.setComponent(a, 0);
        continue;
      }
      const [x, v] = springStep(this.boom.getComponent(a), this.boomV.getComponent(a), want[a], BOOM_W, dt);
      this.boom.setComponent(a, x);
      this.boomV.setComponent(a, v);
    }
    this.cam.position.copy(this.pos).add(this.boom);
    this.look.copy(this.fwd).multiplyScalar(AHEAD * dir).add(this.pos);
    this.look.y = LOOK_Y;
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    this.setFov(chaseFov(speed));
  }

  private cockpit(dt: number, h: number, delta: number): void {
    const want = GLANCE * (Number.isFinite(delta) ? delta : 0);
    if (this.fresh) [this.glance, this.glanceV] = [want, 0];
    else [this.glance, this.glanceV] = springStep(this.glance, this.glanceV, want, GLANCE_W, dt);
    this.cam.position.copy(this.fwd).multiplyScalar(EYE_X).add(this.pos);
    this.cam.position.y = EYE_Y;
    const yaw = h + this.glance + (this.back ? Math.PI : 0);
    forward(yaw, this.look).multiplyScalar(20).add(this.cam.position);
    this.look.y = EYE_Y - 0.9;
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    this.setFov(COCKPIT_FOV);
  }

  private setFov(f: number): void {
    if (Math.abs(f - this.cam.fov) < 0.01) return;
    this.cam.fov = f;
    this.cam.updateProjectionMatrix();
  }
}
