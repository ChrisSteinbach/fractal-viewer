import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { shearMatrix } from "../fractal/affine";
import { transformColors } from "../fractal/color";
import { clone3 } from "../fractal/vec";
import type { Transform, Vec3, Vec4 } from "../fractal/types";
import type { Mat4 } from "../fractal/flame";
import type { OrbitCamera } from "./orbit";
import type { RenderStyle, SolidParams } from "./state";
import {
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelTexture,
  lightDirection,
} from "./voxel-material";

// Authored point/guide colors are already sRGB, so render them verbatim
// instead of running Three.js's sRGB<->linear conversions.
THREE.ColorManagement.enabled = false;

const BACKGROUND = 0x1a1a2e;
// Cooler, lighter "atmosphere" distant points fade into for the aerial style.
const AERIAL_HAZE = 0x4a5a86;
const FOG_MARGIN = 1.2;

// Authored base point size per render style. The UI scales all of them by a
// single multiplier (see {@link FractalScene.setPointSize}) so each style keeps
// its own relative tuning as the user dials the cloud up or down.
const BASE_POINT_SIZE = 0.02; // depthFade + aerial
const DISC_POINT_SIZE = 0.025; // edl
const GLOW_POINT_SIZE = 0.042; // glow
const DOF_POINT_SIZE = 0.024; // dof
const GLOW_BASE_OPACITY = 0.28; // glow additive blend

function color(rgb: Vec3): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]);
}

/** A round sprite: opaque disc in the centre, feathered to nothing at the rim. */
function discTexture(): THREE.Texture {
  return sprite((ctx, c) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c * 2, c * 2);
  });
}

/** A soft sprite: bright core falling off to a wide, faint halo (for glow). */
function glowTexture(): THREE.Texture {
  return sprite((ctx, c) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c * 2, c * 2);
  });
}

function sprite(
  draw: (ctx: CanvasRenderingContext2D, c: number) => void,
): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * A camera-independent vertical gradient used as the scene backdrop, so the
 * cloud floats in a sense of depth instead of a flat fill. Authored in sRGB and
 * left unconverted to match the rest of the pipeline (ColorManagement is off).
 */
function gradientBackground(top: string, bottom: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Out-of-focus points are spread wider and faded; in-focus points stay crisp.
// A cheap circle-of-confusion stand-in for true bokeh that works on points.
const DOF_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uHalfHeight;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uMaxBlur;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    float coc = min(uMaxBlur, 1.0 + uAperture * abs(dist - uFocus));
    gl_PointSize = uSize * (uHalfHeight / dist) * coc;
    vAlpha = 1.0 / (coc * coc);
    gl_Position = projectionMatrix * mv;
  }
`;

const DOF_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(2.0 * gl_PointCoord - 1.0);
    float a = smoothstep(1.0, 0.25, r) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// 4D projection point shader (fr-cbg spike). A 4D IFS cloud is rotated in 4D
// about its own center, then orthographically projected to 3D (drop the rotated
// w), and colored in-shader by that rotated w. Modeled on DOF_VERTEX's raw
// ShaderMaterial pipeline (there is deliberately no onBeforeCompile in this
// codebase). The color MUST live in the shader, not a CPU-baked `color` buffer:
// it depends on the LIVE uRot4 uniform, so a baked buffer would go stale the
// moment the rotation advances a frame.
const FOUR_D_VERTEX = /* glsl */ `
  uniform mat4 uRot4;
  uniform vec4 uCenter4;
  uniform float uInvRadius4;
  uniform float uSize;
  uniform float uHalfHeight;
  attribute float w;
  varying vec3 vColor;

  // A GLSL port of color.ts's hue2rgb/hslToRgb (THREE.Color.setHSL's algorithm),
  // so the 4D w-ramp is a sibling of the height/radius ramps: w = -radius maps
  // to cool blue-violet, w = +radius to warm red.
  float hue2rgb(float q, float p, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return q + (p - q) * 6.0 * t;
    if (t < 1.0 / 2.0) return p;
    if (t < 2.0 / 3.0) return q + (p - q) * 6.0 * (2.0 / 3.0 - t);
    return q;
  }
  vec3 hsl2rgb(float h, float s, float l) {
    h = fract(h);
    if (s == 0.0) return vec3(l);
    float p = l <= 0.5 ? l * (1.0 + s) : l + s - l * s;
    float q = 2.0 * l - p;
    return vec3(
      hue2rgb(q, p, h + 1.0 / 3.0),
      hue2rgb(q, p, h),
      hue2rgb(q, p, h - 1.0 / 3.0)
    );
  }

  void main() {
    // Rotate about the cloud's 4D center so the projection tumbles in place,
    // then project orthographically to 3D by dropping the rotated w.
    vec4 q = uRot4 * (vec4(position, w) - uCenter4);
    vec3 projected = q.xyz + uCenter4.xyz;

    // Color by the rotated w. |q| = |p - center| <= radius is rotation-
    // invariant, so t stays within [0, 1] at every tumble angle and never
    // needs re-normalizing as the view turns.
    float t = clamp(0.5 + 0.5 * q.w * uInvRadius4, 0.0, 1.0);
    vColor = hsl2rgb(0.7 * (1.0 - t), 0.85, 0.55);

    // The exact modelView/projection/gl_PointSize pipeline DOF_VERTEX uses,
    // minus its circle-of-confusion term: the same size-attenuation formula.
    vec4 mv = modelViewMatrix * vec4(projected, 1.0);
    float dist = -mv.z;
    gl_PointSize = uSize * (uHalfHeight / dist);
    gl_Position = projectionMatrix * mv;
  }
`;

// Opaque square points matching baseMaterial's plain look: no map, no
// transparency, default depth write, no fog.
const FOUR_D_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// Eye-dome lighting: a screen-space pass that darkens each pixel in proportion
// to how much its neighbours sit *in front* of it, carving silhouettes and
// creases so the cloud reads as solid without any lights. (Potree's technique.)
const EDL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EDL_FRAGMENT = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uStrength;
  uniform float uRadius;
  uniform float uCap;
  uniform float uFloor;
  uniform float cameraNear;
  uniform float cameraFar;
  varying vec2 vUv;

  float eyeDist(vec2 uv) {
    float frag = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(frag, cameraNear, cameraFar);
  }

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float d0 = eyeDist(vUv);
    vec2 px = uRadius / uResolution;
    vec2 offs[8];
    offs[0] = vec2(1.0, 0.0); offs[1] = vec2(-1.0, 0.0);
    offs[2] = vec2(0.0, 1.0); offs[3] = vec2(0.0, -1.0);
    offs[4] = vec2(0.7, 0.7); offs[5] = vec2(-0.7, 0.7);
    offs[6] = vec2(0.7, -0.7); offs[7] = vec2(-0.7, -0.7);
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      float di = eyeDist(vUv + offs[i] * px);
      sum += min(uCap, max(0.0, (d0 - di) / d0));
    }
    float shade = clamp(exp(-uStrength * (sum / 8.0)), uFloor, 1.0);
    gl_FragColor = vec4(col * shade, 1.0);
  }
`;

/**
 * Thin wrapper around the Three.js scene graph: a point cloud, a reference grid
 * and axes, and one wireframe "guide" box per transform. This is the main home
 * for Three.js (interactions.ts also uses it for raycasting); everything else
 * works with plain numbers and the pure `fractal/` core.
 *
 * The point cloud can be drawn in several {@link RenderStyle}s — see
 * {@link setRenderStyle} — to compare ways of conveying depth.
 */
export class FractalScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;
  private readonly pointGeometry: THREE.BufferGeometry;
  private readonly pointCloud: THREE.Points;
  private guideCubes: THREE.Object3D[] = [];
  // The shear currently baked into each guide cube's geometry, parallel to
  // guideCubes. Lets setGuideGeometry skip rebuilding the cell unless the shear
  // actually changed (position/rotation/scale ride the Object3D's TRS instead).
  private guideShears: Vec3[] = [];

  private renderStyle: RenderStyle = "depthFade";

  // Per-style materials; the active one is swapped onto the single point cloud.
  private readonly baseMaterial: THREE.PointsMaterial; // depthFade + aerial
  private readonly discMaterial: THREE.PointsMaterial; // edl
  private readonly glowMaterial: THREE.PointsMaterial; // glow
  private readonly dofMaterial: THREE.ShaderMaterial; // dof
  private readonly fourDMaterial: THREE.ShaderMaterial; // 4D projection (fr-cbg)
  // True while the 4D projection owns the point cloud, so setRenderStyle records
  // the requested style without clobbering fourDMaterial (see setFourDActive).
  private fourDActive = false;

  private readonly fog: THREE.Fog;
  private readonly darkBackground: THREE.Texture;
  private readonly hazeBackground: THREE.Texture;

  // Glow uses bloom post-processing; EDL renders to a depth target then shades.
  private readonly composer: EffectComposer;
  private readonly edlTarget: THREE.WebGLRenderTarget;
  private readonly edlMaterial: THREE.ShaderMaterial;
  private readonly edlResolution: THREE.Vector2;
  private readonly edlQuad: FullScreenQuad;

  // The flame render (fr-o7s): a plain 2D canvas holds the tone-mapped RGBA
  // image (see `setFlameImage`) and doubles as both the CanvasTexture source
  // for on-screen display AND the Save-PNG export source (`captureFlameFrame`).
  // The 2D canvas retains true per-pixel alpha (transparent where the histogram
  // was never hit); captureFlameFrame composites it over the background color.
  private readonly flameCanvas: HTMLCanvasElement;
  private readonly flameCtx: CanvasRenderingContext2D;
  private readonly flameTexture: THREE.CanvasTexture;
  private readonly flameMaterial: THREE.MeshBasicMaterial;
  private readonly flameQuad: FullScreenQuad;

  // The solid render (fr-v4f): the chaos game's density volume raymarched on
  // the GPU with lighting/shadows/AO (see voxel-material.ts). The volume is
  // world-space and camera-independent, so — unlike the flame's frozen view —
  // renderSolid reads the LIVE camera every frame and the user keeps orbiting.
  private voxelTexture: THREE.Data3DTexture;
  private readonly voxelMaterial: THREE.ShaderMaterial;
  private readonly voxelQuad: FullScreenQuad;

  constructor(container: HTMLElement) {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.darkBackground = gradientBackground("#0d0d18", "#1f2039");
    this.hazeBackground = gradientBackground("#3c4a72", "#5d6d9b");
    this.scene.background = this.darkBackground;
    this.fog = new THREE.Fog(BACKGROUND, 1, 10);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(5, 4, 5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Colors are authored as verbatim sRGB (ColorManagement is off), so the
    // output must pass through unconverted. Without this the post-processing
    // (glow) path re-applies an sRGB encode and lifts the blacks to grey.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    // A quiet ground reference, not a focal point: dim lines, held translucent
    // so the vignette can dissolve the grid's hard square edge into the backdrop.
    this.grid = new THREE.GridHelper(6, 12, 0x3a3a5c, 0x24243c);
    disableFog(this.grid.material);
    fadeLines(this.grid.material, 0.5);
    this.scene.add(this.grid);

    // A subtle orientation hint rather than RGB laser beams: short and faint.
    this.axes = new THREE.AxesHelper(1.4);
    disableFog(this.axes.material);
    fadeLines(this.axes.material, 0.32);
    this.scene.add(this.axes);

    this.baseMaterial = new THREE.PointsMaterial({
      size: BASE_POINT_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      fog: true,
    });
    this.discMaterial = new THREE.PointsMaterial({
      size: DISC_POINT_SIZE,
      map: discTexture(),
      alphaTest: 0.5,
      vertexColors: true,
      sizeAttenuation: true,
      fog: false,
    });
    this.glowMaterial = new THREE.PointsMaterial({
      // Additive: each point adds only a little, so colour survives in sparse
      // regions and only genuinely dense overlaps build up to a hot, bloom-able
      // core. Pitched so a lone point still reads as a saturated spark while
      // overlaps push past 1.0 (HDR buffer) into the bloom — too much per-point
      // alpha would blow the whole cloud out to white.
      size: GLOW_POINT_SIZE,
      map: glowTexture(),
      transparent: true,
      opacity: GLOW_BASE_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
      fog: false,
    });
    this.dofMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DOF_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
        uFocus: { value: 9 },
        uAperture: { value: 3.5 },
        uMaxBlur: { value: 14 },
      },
      vertexShader: DOF_VERTEX,
      fragmentShader: DOF_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.fourDMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uRot4: { value: new THREE.Matrix4() },
        uCenter4: { value: new THREE.Vector4() },
        uInvRadius4: { value: 1 },
        uSize: { value: DOF_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
      },
      vertexShader: FOUR_D_VERTEX,
      fragmentShader: FOUR_D_FRAGMENT,
    });

    this.pointGeometry = new THREE.BufferGeometry();
    this.pointCloud = new THREE.Points(this.pointGeometry, this.baseMaterial);
    this.scene.add(this.pointCloud);

    // Bloom for the glow style. A half-float buffer lets dense, overlapping
    // additive points exceed 1.0 so only true hot-spots bloom.
    const hdr = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, hdr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // strength, radius, threshold — only cores brighter than `threshold` bloom.
    // A lower threshold lets the cloud's denser veins catch light; modest
    // radius/strength keep the blur from flooding the frame with grey haze.
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.4, 0.58),
    );

    const depthTexture = new THREE.DepthTexture(buffer.x, buffer.y);
    depthTexture.type = THREE.UnsignedIntType;
    this.edlTarget = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
      depthTexture,
      depthBuffer: true,
    });
    this.edlResolution = new THREE.Vector2(buffer.x, buffer.y);
    this.edlMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uResolution: { value: this.edlResolution },
        uStrength: { value: 55 },
        uRadius: { value: 1.5 },
        uCap: { value: 0.16 },
        uFloor: { value: 0.32 },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
      },
      vertexShader: EDL_VERTEX,
      fragmentShader: EDL_FRAGMENT,
    });
    this.edlQuad = new FullScreenQuad(this.edlMaterial);

    // 1x1 until the first setFlameImage call sizes it to the actual render.
    this.flameCanvas = document.createElement("canvas");
    this.flameCanvas.width = 1;
    this.flameCanvas.height = 1;
    const flameCtx = this.flameCanvas.getContext("2d");
    if (!flameCtx) {
      throw new Error("2D canvas context unavailable for the flame renderer.");
    }
    this.flameCtx = flameCtx;
    this.flameTexture = new THREE.CanvasTexture(this.flameCanvas);
    this.flameMaterial = new THREE.MeshBasicMaterial({
      map: this.flameTexture,
      depthTest: false,
      depthWrite: false,
    });
    this.flameQuad = new FullScreenQuad(this.flameMaterial);

    // 1x1x1 transparent placeholder until the first setVoxelGrid call.
    this.voxelTexture = emptyVoxelTexture();
    this.voxelMaterial = createVoxelMaterial(this.voxelTexture);
    this.voxelQuad = new FullScreenQuad(this.voxelMaterial);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Upload a freshly generated point cloud (interleaved xyz + rgb buffers). */
  setPoints(positions: Float32Array, colors: Float32Array): void {
    this.pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.pointGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3),
    );
    // Drop any 4D `w` attribute left over from the projection view, so a stale
    // (possibly shorter) w buffer never lingers on the 3D cloud.
    this.pointGeometry.deleteAttribute("w");
    this.pointGeometry.computeBoundingSphere();
  }

  /**
   * Upload a freshly generated 4D cloud (fr-cbg spike): the projected-to-3D
   * `xyz` positions plus the separate `w` coordinate the shader colors by, and
   * the 4D `center`/`radius` that drive the shader's rotation pivot and w-color
   * normalization. The 4D shader reads no `color` attribute (color is computed
   * from `w` and the live rotation), so any stale one is dropped.
   */
  setPoints4(
    positions: Float32Array,
    w: Float32Array,
    center: Vec4,
    radius: number,
  ): void {
    this.pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.pointGeometry.setAttribute("w", new THREE.BufferAttribute(w, 1));
    this.pointGeometry.deleteAttribute("color");

    const u = this.fourDMaterial.uniforms;
    (u.uCenter4.value as THREE.Vector4).set(
      center[0],
      center[1],
      center[2],
      center[3],
    );
    u.uInvRadius4.value = 1 / Math.max(radius, 1e-6);

    // Set the bounding sphere MANUALLY rather than computeBoundingSphere(): the
    // raw xyz attribute only bounds the un-rotated projection and underestimates
    // where the shader moves points as the cloud tumbles. But the 4D ball of
    // `radius` around `center` is rotation-invariant, and its orthographic
    // projection always sits inside the SAME xyz sphere (center, radius), so a
    // sphere there bounds the projection at EVERY tumble angle — frustum culling
    // stays correct throughout. (1.001 is a hair of slack against Float32 round.)
    this.pointGeometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(center[0], center[1], center[2]),
      radius * 1.001,
    );
  }

  /**
   * Replace only the per-point colors, leaving positions (and the bounding
   * sphere) untouched. Lets a color-mode switch recolor the existing cloud
   * without re-running the chaos game.
   */
  setColors(colors: Float32Array): void {
    this.pointGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3),
    );
  }

  /** Rebuild the wireframe guide boxes from the current transform list. */
  updateGuides(
    transforms: Transform[],
    selected: number | null,
    showGuides: boolean,
  ): void {
    for (const cube of this.guideCubes) {
      this.scene.remove(cube);
      disposeTree(cube);
    }

    const palette = transformColors(transforms.length);
    this.guideShears = transforms.map((t) => clone3(t.shear ?? NO_SHEAR));
    this.guideCubes = transforms.map((t, i) => {
      const selectedHere = selected === i;
      const tint = selectedHere ? new THREE.Color(0xffffff) : color(palette[i]);

      // The box is the unit cell's affine image. Position/rotation/scale ride
      // the Object3D's TRS (so interactions.ts can drag them); shear, which a
      // TRS can't express, is baked into the geometry as a parallelepiped.
      const { edges, faces } = guideCellGeometry(t.shear);
      const cube = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: tint,
          transparent: true,
          opacity: selectedHere ? 1.0 : 0.9,
          fog: false,
        }),
      );
      cube.position.set(t.position[0], t.position[1], t.position[2]);
      cube.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
      cube.scale.set(t.scale[0], t.scale[1], t.scale[2]);
      cube.visible = showGuides;

      cube.add(
        new THREE.Mesh(
          faces,
          new THREE.MeshBasicMaterial({
            color: tint,
            transparent: true,
            opacity: selectedHere ? 0.25 : 0.15,
            side: THREE.DoubleSide,
            fog: false,
          }),
        ),
      );

      this.scene.add(cube);
      return cube;
    });
  }

  /** Toggle visibility of the grid, axes, and guide boxes together. */
  setGuidesVisible(showGuides: boolean): void {
    this.grid.visible = showGuides;
    this.axes.visible = showGuides;
    for (const cube of this.guideCubes) {
      cube.visible = showGuides;
    }
  }

  /** The live guide box for a transform, so drags can move it directly. */
  guideCube(index: number): THREE.Object3D | undefined {
    return this.guideCubes[index];
  }

  /**
   * Move one guide box to match an edited transform, without the dispose-and-
   * rebuild of {@link updateGuides}. Lets the panel sliders drive the box live.
   *
   * Position/rotation/scale ride the Object3D's TRS so the drag gizmos in
   * `interactions.ts` can keep reading and writing them. A change to `shear` —
   * which a TRS can't express — re-bakes just this cell's geometry into the
   * matching parallelepiped (see {@link reshapeGuide}).
   */
  setGuideGeometry(
    index: number,
    geometry: Pick<Transform, "position" | "rotation" | "scale" | "shear">,
  ): void {
    const cube = this.guideCubes[index];
    if (!cube) return;
    cube.position.set(...geometry.position);
    cube.rotation.set(...geometry.rotation);
    cube.scale.set(...geometry.scale);
    this.reshapeGuide(index, cube, geometry.shear);
  }

  /**
   * Re-bake a guide cell's geometry when its shear changes, so the box stays the
   * parallelepiped the map actually sends the unit cube to. A no-op while the
   * shear is unchanged, so position/rotation/scale drags don't churn geometry.
   */
  private reshapeGuide(
    index: number,
    cube: THREE.Object3D,
    shear: Vec3 | undefined,
  ): void {
    const next = shear ?? NO_SHEAR;
    const prev = this.guideShears[index];
    if (
      prev &&
      prev[0] === next[0] &&
      prev[1] === next[1] &&
      prev[2] === next[2]
    ) {
      return;
    }
    this.guideShears[index] = clone3(next);

    const { edges, faces } = guideCellGeometry(next);
    const line = cube as THREE.LineSegments;
    line.geometry.dispose();
    line.geometry = edges;
    const mesh = cube.children[0] as THREE.Mesh | undefined;
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = faces;
    }
  }

  /** Place the camera from the orbit state. */
  applyCamera(orbit: OrbitCamera): void {
    const [x, y, z] = orbit.position();
    this.camera.position.set(x, y, z);
    this.camera.lookAt(orbit.target[0], orbit.target[1], orbit.target[2]);
  }

  /**
   * Select how the point cloud conveys depth. Swaps the point material and
   * configures fog/background/post-processing for the chosen style.
   */
  setRenderStyle(style: RenderStyle): void {
    this.renderStyle = style;
    // While the 4D projection owns the point cloud, record the requested style
    // (so exiting 4D can restore it) but don't overwrite fourDMaterial. main.ts
    // also guards its onRenderStyle handler, but the scene must not be
    // corruptible from here either.
    if (this.fourDActive) return;
    switch (style) {
      case "depthFade":
        this.pointCloud.material = this.baseMaterial;
        this.fog.color.setHex(BACKGROUND);
        this.scene.fog = this.fog;
        this.scene.background = this.darkBackground;
        break;
      case "aerial":
        this.pointCloud.material = this.baseMaterial;
        this.fog.color.setHex(AERIAL_HAZE);
        this.scene.fog = this.fog;
        this.scene.background = this.hazeBackground;
        break;
      case "glow":
        this.pointCloud.material = this.glowMaterial;
        this.scene.fog = null;
        this.scene.background = this.darkBackground;
        break;
      case "dof":
        this.pointCloud.material = this.dofMaterial;
        this.scene.fog = null;
        this.scene.background = this.darkBackground;
        break;
      case "edl":
        this.pointCloud.material = this.discMaterial;
        this.scene.fog = null;
        this.scene.background = this.darkBackground;
        break;
    }
  }

  /**
   * Enter or exit the 4D projection view (fr-cbg spike). Swaps the point cloud
   * to fourDMaterial on entry; on exit, restores the current render style's
   * material by re-running {@link setRenderStyle} (which owns the style→material
   * mapping) rather than duplicating it here.
   */
  setFourDActive(active: boolean): void {
    this.fourDActive = active;
    if (active) {
      this.pointCloud.material = this.fourDMaterial;
    } else {
      // fourDActive is now false, so this restores the recorded style's
      // material (and its fog/background) instead of being guarded out.
      this.setRenderStyle(this.renderStyle);
    }
  }

  /**
   * Set the 4D rotation uniform (fr-cbg spike). `m` is a row-major 16-entry
   * array — the format affine4.ts's `rotationMatrix4` produces.
   * `THREE.Matrix4.set()` takes its arguments in row-major order and stores them
   * column-major internally (exactly the WebGL layout the shader's `mat4 uRot4`
   * expects), so handing the row-major array straight to `set()` is the correct
   * pairing.
   */
  setRot4(m: number[]): void {
    const uRot4 = this.fourDMaterial.uniforms.uRot4.value as THREE.Matrix4;
    // prettier-ignore
    uRot4.set(
      m[0],  m[1],  m[2],  m[3],
      m[4],  m[5],  m[6],  m[7],
      m[8],  m[9],  m[10], m[11],
      m[12], m[13], m[14], m[15],
    );
  }

  /**
   * Scale every render style's points by `multiplier` (1 = authored size).
   * Applied to all materials at once so switching styles preserves the choice.
   */
  setPointSize(multiplier: number): void {
    this.baseMaterial.size = BASE_POINT_SIZE * multiplier;
    this.discMaterial.size = DISC_POINT_SIZE * multiplier;
    this.glowMaterial.size = GLOW_POINT_SIZE * multiplier;
    this.dofMaterial.uniforms.uSize.value = DOF_POINT_SIZE * multiplier;
    this.fourDMaterial.uniforms.uSize.value = DOF_POINT_SIZE * multiplier;
  }

  /**
   * Scale the glow material's opacity by a density-adaptive exposure factor.
   * Called per frame while the glow style is active; pass 1 to reset.
   */
  setGlowExposure(factor: number): void {
    this.glowMaterial.opacity = GLOW_BASE_OPACITY * factor;
  }

  /**
   * Tighten the fog band to bracket the point cloud at the current distance.
   * No-op unless a depth-fading style (depthFade/aerial) is active.
   */
  updateFog(): void {
    const bounds = this.pointGeometry.boundingSphere;
    const fog = this.scene.fog;
    if (!bounds || bounds.radius === 0 || !(fog instanceof THREE.Fog)) return;

    const camDist = this.camera.position.distanceTo(bounds.center);
    let near = Math.max(0.1, camDist - bounds.radius * FOG_MARGIN);
    let far = camDist + bounds.radius * FOG_MARGIN;
    if (far - near < 0.5) {
      near = camDist - 0.5;
      far = camDist + 0.5;
    }
    fog.near = near;
    fog.far = far;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.edlTarget.setSize(buffer.x, buffer.y);
    this.edlResolution.set(buffer.x, buffer.y);
    this.dofMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
    this.fourDMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
  }

  render(): void {
    // The 4D projection (fr-cbg spike) always renders plain: its material is
    // designed to look like the base style, and layering the recorded render
    // style's post-processing (bloom / EDL / DOF focus) over it would restyle
    // the projection unpredictably — including in captureFrame's PNG export.
    // The recorded style still drives fog/background until the user exits.
    if (this.fourDActive) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    switch (this.renderStyle) {
      case "glow":
        this.composer.render();
        break;
      case "dof":
        this.focusDof();
        this.renderer.render(this.scene, this.camera);
        break;
      case "edl":
        this.renderEdl();
        break;
      default:
        this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Render one frame and read it back as a PNG data URL. Renders synchronously
   * right before the read so the drawing buffer is still intact (the renderer
   * runs without `preserveDrawingBuffer`, so a frame from the rAF loop would
   * already be gone). Works for every render style since each paints the canvas.
   */
  captureFrame(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /**
   * Physical pixel size of the drawing buffer (accounts for
   * `devicePixelRatio`) — the resolution a flame render should target so it
   * matches what is currently on screen 1:1.
   */
  flameRenderSize(): { width: number; height: number } {
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { width: Math.round(buffer.x), height: Math.round(buffer.y) };
  }

  /**
   * The current camera's combined `projection * view` matrix, row-major and
   * flattened to plain numbers (see `flame.ts`'s `Mat4`) — the boundary
   * across which the camera crosses from the Three.js layer into the
   * dependency-free `src/fractal/` core. Snapshotting this once and not
   * calling {@link applyCamera} again is what "freezes the camera" for a
   * flame render.
   *
   * `updateMatrixWorld` is called explicitly first so this is correct
   * regardless of whether a normal render has already happened this frame
   * (Three.js otherwise only refreshes a camera's world/inverse matrices as
   * a side effect of rendering).
   */
  flameProjectionMatrix(): Mat4 {
    this.camera.updateMatrixWorld();
    const combined = this.camera.projectionMatrix
      .clone()
      .multiply(this.camera.matrixWorldInverse);
    // Matrix4.elements is column-major (WebGL convention); .transpose() before
    // reading it sequentially gives the row-major flattening flame.ts expects.
    return Array.from(combined.transpose().elements);
  }

  /**
   * Upload a freshly tone-mapped flame image (RGBA bytes, `width * height *
   * 4` long, row 0 = top — see `tonemapFlame`) so the next {@link
   * renderFlame} call displays it. Resizes the backing canvas/texture only
   * when the requested size changes.
   */
  setFlameImage(
    image: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
  ): void {
    if (
      this.flameCanvas.width !== width ||
      this.flameCanvas.height !== height
    ) {
      this.flameCanvas.width = width;
      this.flameCanvas.height = height;
    }
    this.flameCtx.putImageData(new ImageData(image, width, height), 0, 0);
    this.flameTexture.needsUpdate = true;
  }

  /**
   * Render only the flame quad, filling the canvas with the last image
   * uploaded via {@link setFlameImage} — used in place of {@link render}
   * while a flame render is active, so the (frozen) 3D scene never draws.
   */
  renderFlame(): void {
    this.renderer.setRenderTarget(null);
    this.flameQuad.render(this.renderer);
  }

  /**
   * Save-PNG source while a flame render is active. Composites the flame
   * canvas (which has transparent pixels where the histogram was never hit)
   * over opaque black so the exported PNG matches the on-screen appearance:
   * the flame quad's material is opaque (alpha ignored), and `tonemapFlame`
   * leaves zero-hit pixels black, so on screen the backdrop is pure black.
   */
  captureFlameFrame(): string {
    const { width, height } = this.flameCanvas;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this.flameCanvas, 0, 0);
    return out.toDataURL("image/png");
  }

  /**
   * Upload a freshly packed density volume (RGBA8 bytes from
   * `voxelTextureData`, `size ** 3 * 4` long, x-fastest) so the next
   * {@link renderSolid} call marches it. Re-uses the existing 3D texture
   * when the resolution is unchanged (the common progressive-update case) and
   * rebuilds it otherwise — a `Data3DTexture`'s dimensions are fixed at
   * construction.
   */
  setVoxelGrid(
    data: Uint8Array<ArrayBuffer>,
    size: number,
    boundsMin: Vec3,
    boundsMax: Vec3,
  ): void {
    if (this.voxelTexture.image.width !== size) {
      this.voxelTexture.dispose();
      this.voxelTexture = new THREE.Data3DTexture(data, size, size, size);
      configureVoxelTexture(this.voxelTexture);
      this.voxelMaterial.uniforms.uVolume.value = this.voxelTexture;
    } else {
      this.voxelTexture.image.data = data;
      this.voxelTexture.needsUpdate = true;
    }
    const u = this.voxelMaterial.uniforms;
    (u.uBoundsMin.value as THREE.Vector3).set(...boundsMin);
    (u.uBoundsSize.value as THREE.Vector3).set(
      boundsMax[0] - boundsMin[0],
      boundsMax[1] - boundsMin[1],
      boundsMax[2] - boundsMin[2],
    );
    u.uTexel.value = 1 / size;
  }

  /**
   * Push the solid render's lighting/surface settings to the raymarcher.
   * Pure GPU uniforms — live-reactive at full frame rate, no worker restart
   * or re-accumulation for any of them (`resolution`/`iterations`, the
   * accumulation-side params, are the worker's business, not this one's).
   */
  setSolidParams(params: SolidParams): void {
    const u = this.voxelMaterial.uniforms;
    u.uThreshold.value = params.threshold;
    u.uAmbient.value = params.ambient;
    (u.uLightDir.value as THREE.Vector3).copy(
      lightDirection(params.lightAzimuth, params.lightElevation),
    );
  }

  /**
   * Raymarch the density volume from the CURRENT camera, filling the canvas —
   * used in place of {@link render} while the solid render is active. Reads
   * the live camera each call, so orbit/zoom keep working mid-render.
   */
  renderSolid(): void {
    this.camera.updateMatrixWorld();
    const u = this.voxelMaterial.uniforms;
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    (u.uInvProjView.value as THREE.Matrix4)
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .invert();
    this.renderer.setRenderTarget(null);
    this.voxelQuad.render(this.renderer);
  }

  /**
   * Save-PNG source while the solid render is active: render synchronously
   * right before the read so the drawing buffer is intact, exactly like
   * {@link captureFrame} (the renderer runs without `preserveDrawingBuffer`).
   */
  captureSolidFrame(): string {
    this.renderSolid();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Park the depth-of-field focal plane on the centre of the cloud. */
  private focusDof(): void {
    const bounds = this.pointGeometry.boundingSphere;
    const center = bounds ? bounds.center : ZERO;
    this.dofMaterial.uniforms.uFocus.value =
      this.camera.position.distanceTo(center);
  }

  private renderEdl(): void {
    this.renderer.setRenderTarget(this.edlTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    const u = this.edlMaterial.uniforms;
    u.tColor.value = this.edlTarget.texture;
    u.tDepth.value = this.edlTarget.depthTexture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    this.edlQuad.render(this.renderer);
  }
}

const ZERO = new THREE.Vector3();
const NO_SHEAR: Vec3 = [0, 0, 0];

/**
 * Build a guide cell's wireframe edges + translucent faces. Any shear is baked
 * into the vertices, so a sheared map's cell renders as the parallelepiped it
 * sends the unit cube to rather than an upright box. The edges are taken from
 * the pristine cube (a guaranteed 12) and then sheared, so the wireframe is
 * exact for any shear magnitude.
 */
function guideCellGeometry(shear: Vec3 | undefined): {
  edges: THREE.BufferGeometry;
  faces: THREE.BufferGeometry;
} {
  const faces: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edges: THREE.BufferGeometry = new THREE.EdgesGeometry(faces);
  if (shear && (shear[0] !== 0 || shear[1] !== 0 || shear[2] !== 0)) {
    const u = shearMatrix4(shear);
    faces.applyMatrix4(u);
    edges.applyMatrix4(u);
  }
  return { edges, faces };
}

/**
 * The shear factor {@link shearMatrix} as a Three.js Matrix4. `Matrix4.set` and
 * `shearMatrix` are both row-major, so the 3x3 maps straight into the upper-left
 * block with an identity translation row/column.
 */
function shearMatrix4(shear: Vec3): THREE.Matrix4 {
  const u = shearMatrix(shear);
  // prettier-ignore
  return new THREE.Matrix4().set(
    u[0], u[1], u[2], 0,
    u[3], u[4], u[5], 0,
    u[6], u[7], u[8], 0,
    0,    0,    0,    1,
  );
}

function disableFog(material: THREE.Material | THREE.Material[]): void {
  // `fog` lives on concrete material subclasses, not the base `Material` type.
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    (m as { fog?: boolean }).fog = false;
  }
}

/** Render a helper's lines translucent so they read as quiet reference, not UI. */
function fadeLines(
  material: THREE.Material | THREE.Material[],
  opacity: number,
): void {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    m.transparent = true;
    m.opacity = opacity;
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const node = child as Partial<THREE.Mesh>;
    node.geometry?.dispose();
    if (node.material) disposeMaterial(node.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
  } else {
    material.dispose();
  }
}
