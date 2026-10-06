// The stage: WebGL renderer, scene, camera, sky, fog and lights. Everything
// that moves registers an animator; update(dt) runs them, keeps the drawing
// buffer sized to the canvas and draws one frame. dispose() releases it all.
import * as THREE from "three";
import { FOG, SKY } from "./palette.ts";

const SKY_R = 2200;      // inside the far plane
const SHADOW_BOX = 45;   // m: half extent of the shadow camera around the focus
const SHADOW_MAP = 2048; // texels per side
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

const skyVertex = /* glsl */ `
varying float vY;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vY = normalize(world.xyz - cameraPosition).y;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const skyFragment = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
varying float vY;
void main() {
  gl_FragColor = vec4(mix(horizon, zenith, 1.0 - exp(-5.0 * max(vY, 0.0))), 1.0);
  #include <colorspace_fragment>
}`;

export type Animator = (dt: number) => void;

/** The part of THREE.WebGLRenderer the stage uses (a fake stands in for it in tests). */
export type StageRenderer = Pick<
  THREE.WebGLRenderer,
  "setPixelRatio" | "setSize" | "render" | "dispose" | "forceContextLoss" | "capabilities" | "shadowMap" | "info" | "toneMapping"
>;

/** The part of the canvas the stage reads. */
export type StageCanvas = Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">;

export interface StageOptions {
  /** Directional shadows; off on mobile-class GPUs. Default: on unless the primary pointer is coarse. */
  shadows?: boolean;
  /** Renderer factory; default a WebGLRenderer on the canvas. */
  renderer?: () => StageRenderer;
}

/** Device pixel ratio, capped at 2 (1 outside a browser). */
function pixelRatio(): number {
  const r = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(r, 2);
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2500);
  private readonly gl: StageRenderer;
  private readonly canvas: StageCanvas;
  private readonly sun: THREE.DirectionalLight;
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly animators = new Set<Animator>();
  private w = 0;
  private h = 0;
  private dpr = 0;
  private disposed = false;

  constructor(canvas: StageCanvas, opts: StageOptions = {}) {
    this.canvas = canvas;
    this.gl = opts.renderer?.() ?? new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: true, powerPreference: "high-performance" });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    const shadows = opts.shadows ?? !coarse;
    this.gl.shadowMap.enabled = shadows;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(SKY.horizon);
    this.scene.fog = new THREE.Fog(SKY.horizon, FOG.near, FOG.far);
    this.scene.add(new THREE.HemisphereLight(SKY.horizon, "#5c7a45", 1.15));

    this.sun = new THREE.DirectionalLight("#fff4e0", 2.1);
    this.sun.castShadow = shadows;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_BOX;
    sc.right = sc.top = SHADOW_BOX;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.focus(new THREE.Vector3());

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: { zenith: { value: new THREE.Color(SKY.zenith) }, horizon: { value: new THREE.Color(SKY.horizon) } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false, // the horizon must equal the fog colour
      }),
    );
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
  }

  /** Adds obj to the scene, with its textures at the GPU's best anisotropy (up to 8). */
  add(obj: THREE.Object3D): void {
    const aniso = this.gl.capabilities.getMaxAnisotropy();
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m?.map) m.map.anisotropy = Math.min(aniso, 8);
    });
    this.scene.add(obj);
  }

  /** Runs fn(dt) at the start of every update until the returned function is called. */
  animate(fn: Animator): () => void {
    const own: Animator = (dt) => fn(dt); // a fresh identity: the same fn may subscribe twice
    this.animators.add(own);
    return () => {
      this.animators.delete(own);
    };
  }

  /**
   * Centres the sun's shadow box on p (the followed car), snapped to whole
   * shadow-map texels in the light's frame so static shadows do not shimmer.
   */
  focus(p: THREE.Vector3): void {
    const texel = (2 * SHADOW_BOX) / SHADOW_MAP;
    const fwd = SUN_DIR.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const u = Math.round(p.dot(right) / texel) * texel, v = Math.round(p.dot(up) / texel) * texel, w = p.dot(fwd);
    const q = right.multiplyScalar(u).add(up.multiplyScalar(v)).add(fwd.multiplyScalar(w));
    this.sun.target.position.copy(q);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100).add(q);
  }

  /** One frame: animators, resize (size or pixel ratio changed), sky follow, draw. Nothing after dispose. */
  update(dt: number): void {
    if (this.disposed) return;
    for (const a of [...this.animators]) a(dt);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, dpr = pixelRatio();
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.gl.setPixelRatio(dpr);
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
    }
    this.dome.position.copy(this.camera.position);
    this.gl.render(this.scene, this.camera);
  }

  /** Draw statistics of the last frame. */
  info(): { calls: number; triangles: number } {
    const r = this.gl.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** Releases the renderer, its context, the shadow map and the sky. Idempotent; the scene's own content is the caller's. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animators.clear();
    this.sun.shadow.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}
