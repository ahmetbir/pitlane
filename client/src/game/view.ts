// The race in 3D: the stage, the circuit, a mesh per car and the cameras.
// draw() places every car (own from prediction, others interpolated), rolls
// the wheels by distance, hides lost wings, follows the own car and renders.
// In ghost rooms other cars near the own one are drawn translucent.
import * as THREE from "three";
import { speed, type State } from "../car/car.ts";
import type { CarRow, ContactName } from "../net/protocol.ts";
import { Cams, type CamMode } from "../render/cams.ts";
import { buildCar, type CarMesh, type CarPose } from "../render/carmesh.ts";
import { toWorld } from "../render/frame.ts";
import { teamColour } from "../render/palette.ts";
import { Stage } from "../render/scene.ts";
import { buildTrack, type TrackMesh } from "../render/trackmesh.ts";
import type { Track } from "../track/track.ts";

const GHOST_M = 15;
const GHOST_OPACITY = 0.35;

type Drawn = { mesh: CarMesh; rolled: number; faded: boolean };

/** The own car as drawn this frame. */
export type OwnDraw = { id: number; st: State; wingLost: boolean };

export class RaceView {
  private readonly stage: Stage;
  private readonly circuit: TrackMesh;
  private readonly cams: Cams;
  private readonly cars = new Map<number, Drawn>();
  private readonly track: Track;
  private readonly ghost: boolean;
  private readonly focus = new THREE.Vector3();

  /** Throws when WebGL is unavailable. */
  constructor(canvas: HTMLCanvasElement, track: Track, contact: ContactName, camera: CamMode) {
    this.track = track;
    this.ghost = contact === "ghost";
    this.stage = new Stage(canvas);
    this.circuit = buildTrack(track);
    this.stage.add(this.circuit.root);
    this.cams = new Cams(this.stage.camera);
    if (camera === "cockpit") this.cams.toggle();
  }

  setLights(on: number, out: boolean): void {
    this.circuit.setLights(on, out);
  }

  toggleCamera(): void {
    this.cams.toggle();
  }

  lookBack(on: boolean): void {
    this.cams.lookBack(on);
  }

  /** The next frame jumps the camera to its place (marshal reset, new seat). */
  snapCamera(): void {
    this.cams.snap();
  }

  draw(dt: number, own: OwnDraw | null, others: readonly CarRow[]): void {
    const seen = new Set<number>();
    for (const r of others) {
      seen.add(r.id);
      this.place(r.id, r, r.vx, r.wingLost, dt);
    }
    if (own) {
      seen.add(own.id);
      this.place(own.id, own.st, own.st.vx, own.wingLost, dt);
    }
    for (const [id, c] of this.cars) {
      if (seen.has(id)) continue;
      this.stage.scene.remove(c.mesh.root);
      c.mesh.dispose();
      this.cars.delete(id);
    }
    if (this.ghost && own) for (const r of others) this.fade(r.id, Math.hypot(r.x - own.st.x, r.z - own.st.z) < GHOST_M);

    const t = own?.st ?? others[0];
    if (t) {
      const v = own ? speed(own.st) : Math.hypot(others[0].vx, others[0].vy);
      this.cams.update(dt, { x: t.x, z: t.z, h: t.h, delta: t.delta, speed: v });
      this.stage.focus(toWorld(t.x, t.z, 0, this.focus));
    } else {
      const g = this.track.grid[0];
      this.cams.update(dt, { x: g.x, z: g.z, h: g.h, delta: 0, speed: 0 });
    }
    this.stage.update(dt);
  }

  /** Releases every mesh and the renderer. */
  dispose(): void {
    for (const c of this.cars.values()) c.mesh.dispose();
    this.cars.clear();
    this.circuit.dispose();
    this.stage.dispose();
  }

  private place(id: number, pose: CarPose, vx: number, wingLost: boolean, dt: number): void {
    let c = this.cars.get(id);
    if (!c) {
      c = { mesh: buildCar(teamColour(id)), rolled: 0, faded: false };
      this.cars.set(id, c);
      this.stage.add(c.mesh.root);
    }
    if (Number.isFinite(vx)) c.rolled += vx * dt;
    c.mesh.update(pose, c.rolled, wingLost);
  }

  private fade(id: number, on: boolean): void {
    const c = this.cars.get(id);
    if (!c || c.faded === on) return;
    c.faded = on;
    c.mesh.root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!(m instanceof THREE.Material)) return;
      m.transparent = on;
      m.opacity = on ? GHOST_OPACITY : 1;
      m.depthWrite = !on;
    });
  }
}
