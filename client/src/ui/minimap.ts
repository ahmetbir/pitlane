// The HUD's mini-map: the track outline drawn once into an offscreen canvas,
// a dot per car on top every frame, the own car larger and outlined.
// Sim +z is up on the map, as seen from above in the 3D view.
import { teamColour } from "../render/palette.ts";

export type XZ = { x: number; z: number };
export type Project = (x: number, z: number) => [number, number];

/** Maps sim (x, z) into a w × h box with pad pixels of margin, aspect kept, centred. */
export function fitMap(points: readonly XZ[], w: number, h: number, pad: number): Project {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  if (!Number.isFinite(x0)) return () => [w / 2, h / 2];
  const k = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-6), (h - 2 * pad) / Math.max(z1 - z0, 1e-6));
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  return (x, z) => [w / 2 + (x - mx) * k, h / 2 - (z - mz) * k];
}

export type Dot = { id: number; x: number; z: number };

const SIZE = 168;
const PAD = 10;

export class MiniMap {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base: HTMLCanvasElement;
  private readonly at: Project;
  private readonly dpr: number;

  constructor(outline: readonly XZ[]) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(SIZE * this.dpr);
    this.el = document.createElement("canvas");
    this.el.className = "minimap";
    this.el.width = this.el.height = px;
    this.ctx = this.el.getContext("2d");
    this.at = fitMap(outline, SIZE, SIZE, PAD);
    this.base = document.createElement("canvas");
    this.base.width = this.base.height = px;
    const b = this.base.getContext("2d");
    if (!b) return;
    b.scale(this.dpr, this.dpr);
    b.lineJoin = "round";
    b.beginPath();
    outline.forEach((p, i) => {
      const [x, y] = this.at(p.x, p.z);
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    });
    b.closePath();
    b.strokeStyle = "rgba(10, 12, 16, 0.75)";
    b.lineWidth = 7;
    b.stroke();
    b.strokeStyle = "rgba(235, 240, 246, 0.9)";
    b.lineWidth = 3;
    b.stroke();
    const [sx, sy] = this.at(outline[0].x, outline[0].z); // the start line
    b.fillStyle = "#fff";
    b.fillRect(sx - 3, sy - 3, 6, 6);
  }

  /** Redraws the cars; own is drawn last, on top. */
  draw(cars: readonly Dot[], own: number): void {
    const c = this.ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.el.width, this.el.height);
    c.drawImage(this.base, 0, 0);
    c.scale(this.dpr, this.dpr);
    const me = cars.find((d) => d.id === own);
    for (const d of cars) {
      if (d.id === own) continue;
      this.dot(c, d, 3.5, teamColour(d.id), "rgba(0,0,0,0.6)");
    }
    if (me) this.dot(c, me, 5.5, teamColour(me.id), "#fff");
  }

  private dot(c: CanvasRenderingContext2D, d: Dot, r: number, fill: string, ring: string): void {
    const [x, y] = this.at(d.x, d.z);
    c.beginPath();
    c.arc(x, y, r, 0, 2 * Math.PI);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = ring;
    c.stroke();
  }
}
