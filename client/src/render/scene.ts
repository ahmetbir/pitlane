// The stage: WebGL renderer, scene, camera, sky, fog and lights. Everything
// that moves registers an animator; update(dt) runs them, keeps the drawing
// buffer sized to the canvas and draws one frame.
import * as THREE from "three";
import { FOG, SKY } from "./palette.ts";

const SKY_R = 2200;   // inside the far plane
const SHADOW_BOX = 45; // m: half extent of the shadow camera around the focus
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

export interface StageOptions {
  /** Directional shadows; off on mobile-class GPUs. Default: on unless the primary pointer is coarse. */
  shadows?: boolean;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2500);
  private readonly gl: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly sun: THREE.DirectionalLight;
  private readonly dome: THREE.Mesh;
  private readonly animators: Animator[] = [];
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement, opts: StageOptions = {}) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    const shadows = opts.shadows ?? !window.matchMedia?.("(pointer: coarse)").matches;
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
    this.sun.shadow.mapSize.set(2048, 2048);
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

  /** Adds obj to the scene, with its textures at the GPU's best anisotropy. */
  add(obj: THREE.Object3D): void {
    const aniso = this.gl.capabilities.getMaxAnisotropy();
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m?.map) m.map.anisotropy = Math.min(aniso, 8);
    });
    this.scene.add(obj);
  }

  /** Runs fn(dt) at the start of every update. */
  animate(fn: Animator): void {
    this.animators.push(fn);
  }

  /** Centres the sun's shadow box on p (the followed car). */
  focus(p: THREE.Vector3): void {
    this.sun.target.position.copy(p);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100).add(p);
  }

  /** One frame: animators, resize, sky follow, draw. */
  update(dt: number): void {
    for (const a of this.animators) a(dt);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
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
}
