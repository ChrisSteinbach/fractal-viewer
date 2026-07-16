import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { shearMatrix } from "../fractal/affine";
import {
  transformColors,
  W_RAMP_BRIGHTNESS_FLOOR,
  W_RAMP_EXPONENT,
  W_RAMP_GRAY,
  W_SIDE_PALETTES,
} from "../fractal/color";
import { sliceColorRemap, SLICE_GHOST_FLOOR } from "../fractal/project4";
import { clone3 } from "../fractal/vec";
import type { Transform, Vec3, Vec4 } from "../fractal/types";
import type { Mat4 } from "../fractal/flame";
import type { OrbitCamera } from "./orbit";
import { wSupport } from "./rotor4";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";
import type { RenderStyle, SolidParams } from "./state";
import {
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelTexture,
  lightDirection,
  marchStepsForGrid,
} from "./voxel-material";

// Authored point/guide colors are already sRGB, so render them verbatim
// instead of running Three.js's sRGB<->linear conversions.
THREE.ColorManagement.enabled = false;

/** Midpoint of a backdrop's two stops — the single color that best stands in
 * for a vertical gradient across the whole frame. Numeric Color constructor
 * on purpose: it never applies color-space conversion. */
function backdropMidpoint(stops: { top: string; bottom: string }): THREE.Color {
  const [tr, tg, tb] = hexToRgb01(stops.top);
  const [br, bg, bb] = hexToRgb01(stops.bottom);
  return new THREE.Color((tr + br) / 2, (tg + bg) / 2, (tb + bb) / 2);
}

// Fog colors are derived from the backdrop gradients rather than authored
// separately, so fogged points always veil toward what's actually behind them
// and can't drift when a backdrop is retuned (fr-1lj). The haze pair is the
// cooler, lighter "atmosphere" distant points fade into for the aerial style.
const DARK_FOG = backdropMidpoint(DARK_BACKDROP);
const HAZE_FOG = backdropMidpoint(HAZE_BACKDROP);
const FOG_MARGIN = 1.2;

// Authored base point size per render style. The UI scales all of them by a
// single multiplier (see {@link FractalScene.setPointSize}) so each style keeps
// its own relative tuning as the user dials the cloud up or down.
const BASE_POINT_SIZE = 0.02; // depthFade + aerial
const DISC_POINT_SIZE = 0.025; // edl
const GLOW_POINT_SIZE = 0.042; // glow
const DOF_POINT_SIZE = 0.024; // dof
const GLOW_BASE_OPACITY = 0.28; // glow additive blend
// The "Watch it build" replay cursor (fr-1zb): the bright spark pinned to the
// newest revealed point. Sized well above every per-style point size so the
// current chaos-game landing reads as THE point even over a dense cloud (or
// against a translucent guide-box face).
const REPLAY_CURSOR_SIZE = 0.14;
// Guide-box wireframe/face opacity a box is built with (updateGuides'
// unselected branch) and the "Watch it build" replay's spotlight/hop
// emphasis on top of it (fr-01kf, see setGuideHighlight): HIGHLIGHT marks the
// map currently landing points, DIMMED recedes every other map so the
// highlighted one reads clearly.
const GUIDE_LINE_OPACITY = 0.9;
const GUIDE_FACE_OPACITY = 0.15;
const GUIDE_HIGHLIGHT_LINE_OPACITY = 1.0;
const GUIDE_HIGHLIGHT_FACE_OPACITY = 0.3;
const GUIDE_DIMMED_LINE_OPACITY = 0.25;
const GUIDE_DIMMED_FACE_OPACITY = 0.04;
// 4D projection: per-point additive contribution and the soft w-slice's
// Gaussian sigma (in signed normalized-w units; the slice slider spans [-1, 1]).
// The intensity is pitched like GLOW_BASE_OPACITY but far lower: the projected
// sheets of a 4D attractor stack tens-to-hundreds of points per pixel, and the
// palette only reads while the sum stays below saturation — density then shows
// up as brightness, exactly like the flame's log-density display.
const FOUR_D_BASE_INTENSITY = 0.055;
// Exported since fr-5b3/fr-4wd: main.ts sends this same width into the flame/
// solid render workers, so their CPU slice windows match the shader's exactly.
export const FOUR_D_SLICE_WIDTH = 0.12;

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
//
// Two choices here exist to make the FOURTH dimension legible rather than
// looking like one more 3D coordinate ramp:
//
// - A DIVERGING palette on the SIGNED rotated w — a cool side color on the −w
//   side of our 3-space, a warm one on the +w side (uSideNeg/uSidePos, fed
//   from color.ts's W_SIDE_PALETTES — blue/orange by default), dim
//   desaturated gray near w = 0 — instead of the height/radius-style rainbow,
//   which a still image cannot distinguish from the 3D "height" mode. Color
//   answers "how far OUT of the visible hyperplane, and to which side".
// - Additive translucency (see the material setup): an orthographic projection
//   folds several w-layers onto the same xyz spot, and opaque depth-tested
//   points would let the front layer win — hiding exactly the self-overlap
//   that makes a projection read as 4D. Additive blending superposes the
//   layers, and where −w and +w sheets cross, the cool + warm sides sum toward
//   white: color mixtures that exist nowhere in the palette flag genuine 4D
//   overlap.
//
// The baked 4D color modes (fr-d47 — "by transform" / "by 4D radius", both
// rotation-invariant) swap only WHERE the side color comes from: uUseAttrColor
// selects a per-point `color` attribute (color.ts's buildColors4) over the
// sign-picked pair. The gray-notch magnitude modulation below applies either
// way, so the fourth dimension stays legible in brightness while hue carries
// the structural information.
//
// The soft w-slice (fr-6x2) rides the same alpha path: a Gaussian opacity
// window in the signed rotated w, swept by a slider — depth-of-field in the
// fourth dimension. Points outside the slice keep a floor of visibility so the
// full projection stays as ghost context around the vivid cross-section.
//
// The opt-in camera-depth fade (fr-3e0) rides it too: attenuating each point's
// contribution with CAMERA distance is the one 3D depth style whose mechanism
// survives additive blending — fading toward black IS attenuation, which
// composes under addition, whereas fading toward any brighter fog color would
// add that color once per stacked layer and blow out. It restores the
// camera-z cue the projection otherwise lacks (post-processing never runs
// here — see render()), which matters most in stills, where motion parallax
// can't help. Off by default: brightness already encodes |w| (dim gray = near
// our 3-space), so the fade deliberately trades some of that legibility for
// camera depth. The near/far band re-brackets the projected cloud every
// rendered frame (updateFourDFade), mirroring updateFog's band for the 3D
// styles.
const FOUR_D_VERTEX = /* glsl */ `
  uniform mat4 uRot4;
  uniform vec4 uCenter4;
  uniform float uInvWAmp4;
  uniform float uSize;
  uniform float uHalfHeight;
  uniform float uIntensity;
  uniform float uSliceOn;
  uniform float uSliceCenter;
  uniform float uSliceWidth;
  uniform float uSliceColorShift;
  uniform float uSliceColorInvScale;
  uniform float uFadeOn;
  uniform float uFadeNear;
  uniform float uFadeFar;
  uniform vec3 uSideNeg;
  uniform vec3 uSidePos;
  uniform float uUseAttrColor;
  attribute float w;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Rotate about the cloud's 4D center so the projection tumbles in place,
    // then project orthographically to 3D by dropping the rotated w.
    vec4 q = uRot4 * (vec4(position, w) - uCenter4);
    vec3 projected = q.xyz + uCenter4.xyz;

    // Signed rotated w, normalized by the LARGEST |rotated w| the cloud's 4D
    // bounds box allows at THIS rotation (its support function in the
    // rotated-w direction — recomputed CPU-side whenever the tumble advances,
    // see updateWAmp4). Dividing by the rotation-INVARIANT 4D radius instead
    // would never need updating, but anisotropic clouds (w-spread far below
    // xyz-spread) would hug s = 0 at most tumble angles and wash out to gray
    // (fr-9bk); the support bound keeps the full diverging ramp in play at
    // every angle. The clamp only swallows Float32 rounding dust — the
    // support function bounds every stored point.
    float s = clamp(q.w * uInvWAmp4, -1.0, 1.0);

    // Diverging palette: sign picks the side (or, for the baked fr-d47 modes,
    // uUseAttrColor swaps in the per-point attribute), magnitude drives
    // saturation AND brightness (the 0.6 exponent lifts the mid-range, where
    // heavy-tailed w-distributions still cluster even after the support
    // normalization spreads the cloud over the full [-1, 1]). Near-zero w —
    // the part of the cloud passing through our own 3-space — stays dim gray
    // and recedes. (The side pair comes from color.ts's W_SIDE_PALETTES via
    // uniforms; the ramp SHAPE constants — the exponent, gray notch, and
    // brightness floor — are interpolated from color.ts's W_RAMP_* exports
    // (fr-3o2), so neither can drift from the CPU twin or the legend.)
    // Optional slice-relative recolor (fr-nn6): the w-ramp path evaluates the
    // ramp at an affine remap of s — recentered on the slice window, see
    // project4.ts's sliceColorRemap, whose (shift, invScale) these two
    // uniforms carry (identity 0/1 when off, making sc == s exactly). The
    // baked fr-d47 attribute modes keep the raw s: their hue is the
    // attribute, and their gray-notch brightness stays faithful to the
    // actual |w|. The slice WEIGHT below always uses the raw s — the remap
    // changes color only.
    float sc = mix(
      clamp((s - uSliceColorShift) * uSliceColorInvScale, -1.0, 1.0),
      s,
      uUseAttrColor
    );
    float m = pow(abs(sc), ${W_RAMP_EXPONENT});
    vec3 side = mix(sc < 0.0 ? uSideNeg : uSidePos, color, uUseAttrColor);
    vColor = mix(vec3(${W_RAMP_GRAY}), side, m) * (${W_RAMP_BRIGHTNESS_FLOOR} + ${1 - W_RAMP_BRIGHTNESS_FLOOR} * m);

    // Soft w-slice: a Gaussian window in s around uSliceCenter, with a floor so
    // the rest of the projection stays visible as ghost context.
    float slice = 1.0;
    if (uSliceOn > 0.5) {
      float d = (s - uSliceCenter) / uSliceWidth;
      slice = ${SLICE_GHOST_FLOOR} + ${1 - SLICE_GHOST_FLOOR} * exp(-0.5 * d * d);
    }
    vAlpha = uIntensity * slice;

    // The exact modelView/projection/gl_PointSize pipeline DOF_VERTEX uses,
    // minus its circle-of-confusion term: the same size-attenuation formula.
    vec4 mv = modelViewMatrix * vec4(projected, 1.0);
    float dist = -mv.z;

    // Opt-in camera-depth fade (fr-3e0, see the header comment): attenuate
    // the contribution toward zero across the [uFadeNear, uFadeFar] band —
    // fade-to-black is the additive-blending-safe analog of the 3D depthFade
    // style's fog. smoothstep rather than fog's linear ramp so the band's
    // edges land softly; the band brackets the cloud with the same margin.
    if (uFadeOn > 0.5) vAlpha *= 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

    gl_PointSize = uSize * (uHalfHeight / dist);
    gl_Position = projectionMatrix * mv;
  }
`;

// Additive square points: with THREE.AdditiveBlending the source factor is the
// fragment's alpha, so vAlpha scales each point's contribution and overlapping
// w-layers sum — no sorting needed (addition commutes), hence depthWrite off.
const FOUR_D_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
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
 * Hard cap on an export's drawing-buffer long side (fr-2urv), on top of the
 * device's own `maxTextureSize`: the glow composer chain re-allocates
 * half-float targets at the export size, so an unbounded multiple could
 * transiently demand gigabytes of GPU memory and lose the WebGL context.
 * 8192 px still covers a ~27-inch print at 300 dpi.
 */
const EXPORT_MAX_LONG_SIDE = 8192;

/**
 * A finished still export (fr-2urv): the encoded PNG plus its actual pixel
 * size — which the device ceilings in {@link FractalScene.captureFrame}'s
 * clamp may have held below the requested multiple, so callers report the
 * real dimensions rather than the asked-for ones.
 */
export interface ExportImage {
  blob: Blob;
  width: number;
  height: number;
}

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
  // The "Watch it build" replay cursor (fr-1zb): one bright sprite riding the
  // newest revealed point (see setReplayCursor). Hidden whenever no replay is
  // running.
  private readonly replayCursor: THREE.Points;
  private guideCubes: THREE.Object3D[] = [];
  // The shear currently baked into each guide cube's geometry, parallel to
  // guideCubes. Lets setGuideGeometry skip rebuilding the cell unless the shear
  // actually changed (position/rotation/scale ride the Object3D's TRS instead).
  private guideShears: Vec3[] = [];
  // The index setGuideHighlight last spotlighted, or null; compared against
  // on every call so a replay's per-frame repeats stay free (fr-py7z).
  private guideHighlight: number | null = null;

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
  // The projected 4D wireframe scaffold (e.g. the pentatope's ten edges, the
  // rotating-tesseract-style legibility cue) and the state needed to re-pose it:
  // its 4D edge endpoints and the current row-major 4D rotation. Re-posed on the
  // CPU whenever the rotation uniform changes — a handful of vertices, not the
  // half-million-point cloud, so per-frame CPU projection costs nothing.
  private fourDScaffold: THREE.LineSegments | null = null;
  private fourDScaffoldEdges: [Vec4, Vec4][] = [];
  // prettier-ignore
  private fourDRot: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Half-extents of the current 4D cloud's bounds box, the other input (with
  // fourDRot) to the w-color amplitude — see updateWAmp4.
  private fourDHalfExtents: Vec4 = [0, 0, 0, 0];

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

  /** Live viewport size, kept for {@link syncProjection} (fr-936q). */
  private viewportWidth: number;
  private viewportHeight: number;

  /**
   * Horizontal strip (CSS px) on the right edge covered by the control-panel
   * overlay (fr-936q). While non-zero, {@link syncProjection} designs the
   * projection for the UNCOVERED region — the camera's `aspect` (which the
   * fit math in orbit.ts/camera-tween.ts reads) describes that visible
   * region, and a `setViewOffset` extension keeps rendering the full canvas
   * so the strip under the panel still shows scene rather than a void. World
   * center then projects to the visible region's center, and every auto-fit
   * frames the attractor clear of the panel.
   */
  private rightInsetPx = 0;

  /**
   * Whether anything visible changed since the last render (fr-py7z). Set by
   * every mutating method — the per-frame setters (applyCamera, setRot4,
   * setGlowExposure, setDrawCount, setReplayCursor) compare first, so a frame
   * where nothing moved marks nothing — and cleared by the render methods.
   * main.ts's animate loop skips rendering while this is false, dropping GPU
   * work to zero for a static scene.
   */
  private renderNeeded = true;

  /**
   * Last camera pose {@link applyCamera} applied (position then target), for
   * its no-change fast path. `null` until the first apply ever runs.
   */
  private lastCameraPose:
    [number, number, number, number, number, number] | null = null;

  /**
   * Adaptive-resolution scale (fr-4lyt) multiplied into the base pixel ratio:
   * 1 = native (capped) resolution, lower = fewer pixels for slow hardware.
   * Driven by main.ts's resolution governor via {@link setResolutionScale};
   * exports and the flame render target deliberately ignore it (see
   * {@link withFullResolution} / {@link flameRenderSize}).
   */
  private resolutionScale = 1;

  constructor(container: HTMLElement) {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.viewportWidth = width;
    this.viewportHeight = height;

    this.scene = new THREE.Scene();
    this.darkBackground = gradientBackground(
      DARK_BACKDROP.top,
      DARK_BACKDROP.bottom,
    );
    this.hazeBackground = gradientBackground(
      HAZE_BACKDROP.top,
      HAZE_BACKDROP.bottom,
    );
    this.scene.background = this.darkBackground;
    this.fog = new THREE.Fog(DARK_FOG, 1, 10);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(5, 4, 5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.basePixelRatio());
    // Colors are authored as verbatim sRGB (ColorManagement is off), so the
    // output must pass through unconverted. Without this the post-processing
    // (glow) path re-applies an sRGB encode and lifts the blacks to grey.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    // A restored WebGL context comes back with an undefined drawing buffer;
    // make sure the render-on-demand gate (fr-py7z) repaints it even if the
    // scene is otherwise static.
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.renderNeeded = true;
    });
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
        uInvWAmp4: { value: 1 },
        uSize: { value: DOF_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
        uIntensity: { value: FOUR_D_BASE_INTENSITY },
        uSliceOn: { value: 0 },
        uSliceCenter: { value: 0 },
        uSliceWidth: { value: FOUR_D_SLICE_WIDTH },
        uSliceColorShift: { value: 0 },
        uSliceColorInvScale: { value: 1 },
        uFadeOn: { value: 0 },
        uFadeNear: { value: 1 },
        uFadeFar: { value: 10 },
        uSideNeg: {
          value: new THREE.Vector3(...W_SIDE_PALETTES.wBlueOrange.neg),
        },
        uSidePos: {
          value: new THREE.Vector3(...W_SIDE_PALETTES.wBlueOrange.pos),
        },
        uUseAttrColor: { value: 0 },
      },
      vertexShader: FOUR_D_VERTEX,
      fragmentShader: FOUR_D_FRAGMENT,
      // Additive, unsorted, no depth write — the glowMaterial recipe. See the
      // FOUR_D_VERTEX comment: superposing w-layers instead of depth-testing
      // them away is what makes the projection read as 4D.
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.pointGeometry = new THREE.BufferGeometry();
    this.pointCloud = new THREE.Points(this.pointGeometry, this.baseMaterial);
    this.scene.add(this.pointCloud);

    // One vertex at the object's origin; setReplayCursor moves the OBJECT to
    // the highlighted point. No depth test (a landing inside a dense region
    // must still read), no fog (stays bright at any camera distance), additive
    // so it glows over whatever it lands on. frustumCulled off: a 1-point
    // geometry's bounding sphere has radius 0 and would cull at the edge.
    const cursorGeometry = new THREE.BufferGeometry();
    cursorGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    this.replayCursor = new THREE.Points(
      cursorGeometry,
      new THREE.PointsMaterial({
        size: REPLAY_CURSOR_SIZE,
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.replayCursor.visible = false;
    this.replayCursor.frustumCulled = false;
    this.replayCursor.renderOrder = 1;
    this.scene.add(this.replayCursor);

    // Bloom for the glow style. EffectComposer's default render target is
    // half-float, letting dense, overlapping additive points exceed 1.0 so
    // only true hot-spots bloom. Constructed WITHOUT an explicit target on
    // purpose: handing one over pins the composer's internal pixel ratio to
    // 1, after which the first resize() silently drops the whole glow chain
    // to CSS resolution on hi-DPI displays. Sizing itself from the renderer
    // keeps that bookkeeping right, and setResolutionScale (fr-4lyt) keeps
    // it in step with every adaptive ratio change from then on.
    this.composer = new EffectComposer(this.renderer);
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

  /**
   * Whether the next animation frame must actually render (fr-py7z) — true
   * whenever something visible changed since the last render. main.ts's
   * animate loop is the consumer; the render methods clear it.
   */
  get needsRender(): boolean {
    return this.renderNeeded;
  }

  /** Upload a freshly generated point cloud (interleaved xyz + rgb buffers). */
  setPoints(positions: Float32Array, colors: Float32Array): void {
    this.renderNeeded = true;
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
    // A fresh cloud always shows whole: clear any "Watch it build" prefix
    // limit (fr-1zb) a replay left on the shared geometry. main.ts cancels
    // the replay on arrival too — this keeps the upload self-consistent even
    // if a future caller forgets.
    this.setDrawCount(null);
    this.setReplayCursor(null);
    this.pointGeometry.computeBoundingSphere();
  }

  /**
   * Upload a freshly generated 4D cloud (fr-cbg spike): the projected-to-3D
   * `xyz` positions plus the separate `w` coordinate the shader colors by, and
   * the 4D `center`/`halfExtents` that drive the shader's rotation pivot and
   * w-color normalization. `radius` is now only the rotation-invariant
   * bounding sphere used for frustum culling. Any `color` attribute is
   * dropped: it belonged to the previous cloud (possibly a different length),
   * and main.ts re-points the color source — re-baking the attribute when the
   * current 4D color mode needs one — via {@link setFourDColorSource} right
   * after every upload.
   */
  setPoints4(
    positions: Float32Array,
    w: Float32Array,
    center: Vec4,
    radius: number,
    halfExtents: Vec4,
  ): void {
    this.renderNeeded = true;
    this.pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.pointGeometry.setAttribute("w", new THREE.BufferAttribute(w, 1));
    this.pointGeometry.deleteAttribute("color");
    // Same replay-reset as setPoints (fr-1zb): a fresh upload shows whole.
    this.setDrawCount(null);
    this.setReplayCursor(null);

    const u = this.fourDMaterial.uniforms;
    (u.uCenter4.value as THREE.Vector4).set(
      center[0],
      center[1],
      center[2],
      center[3],
    );
    this.fourDHalfExtents = halfExtents;
    this.updateWAmp4();

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

    // The scaffold pivots on the same center, which a fresh generation may
    // have moved — re-pose it.
    this.updateFourDScaffoldPositions();
  }

  /**
   * Replace only the per-point colors, leaving positions (and the bounding
   * sphere) untouched. Lets a color-mode switch recolor the existing cloud
   * without re-running the chaos game.
   */
  setColors(colors: Float32Array): void {
    this.renderNeeded = true;
    this.pointGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3),
    );
  }

  /**
   * Draw only the first `count` points of the cloud — the "Watch it build"
   * replay (fr-1zb). The buffers arrive in chaos-game generation order (one
   * point per orbit step, for the 3D and 4D paths alike), so the growing
   * prefix IS a faithful replay of how the attractor was drawn. `null`
   * restores the full cloud. Positions, colors, and the bounding sphere are
   * untouched: the full-cloud sphere is a superset of every prefix, so
   * frustum culling stays correct throughout.
   */
  setDrawCount(count: number | null): void {
    // Per-frame caller (the replay's done-linger repeats `null`): skip the
    // dirty mark when the range is already what's asked for (fr-py7z).
    const target = count ?? Infinity;
    if (this.pointGeometry.drawRange.count === target) return;
    this.pointGeometry.setDrawRange(0, target);
    this.renderNeeded = true;
  }

  /**
   * Pin the replay cursor — a bright, depth-test-free spark — onto the cloud
   * point at `index`, or hide it with `null`. In the 4D projection the stored
   * xyz is the UN-rotated projection, so the cursor applies the same
   * rotate-about-center the vertex shader does (the CPU twin in
   * {@link updateFourDScaffoldPositions}); called once per frame during a
   * replay, it rides the tumble exactly like the points themselves.
   */
  setReplayCursor(index: number | null): void {
    const position = this.pointGeometry.getAttribute("position") as
      THREE.BufferAttribute | undefined;
    if (index === null || !position || index < 0 || index >= position.count) {
      if (this.replayCursor.visible) {
        this.replayCursor.visible = false;
        this.renderNeeded = true;
      }
      return;
    }
    let x = position.getX(index);
    let y = position.getY(index);
    let z = position.getZ(index);
    if (this.fourDActive) {
      const wAttr = this.pointGeometry.getAttribute("w") as
        THREE.BufferAttribute | undefined;
      const w = wAttr ? wAttr.getX(index) : 0;
      const m = this.fourDRot;
      const c = this.fourDMaterial.uniforms.uCenter4.value as THREE.Vector4;
      const dx = x - c.x;
      const dy = y - c.y;
      const dz = z - c.z;
      const dw = w - c.w;
      x = m[0] * dx + m[1] * dy + m[2] * dz + m[3] * dw + c.x;
      y = m[4] * dx + m[5] * dy + m[6] * dz + m[7] * dw + c.y;
      z = m[8] * dx + m[9] * dy + m[10] * dz + m[11] * dw + c.z;
    }
    // Per-frame caller: an idle replay (paused phase) re-pins the same spot —
    // don't mark the frame dirty for it (fr-py7z).
    if (
      this.replayCursor.visible &&
      this.replayCursor.position.x === x &&
      this.replayCursor.position.y === y &&
      this.replayCursor.position.z === z
    ) {
      return;
    }
    this.replayCursor.position.set(x, y, z);
    this.replayCursor.visible = true;
    this.renderNeeded = true;
  }

  /**
   * Point the 4D shader's color at its source (fr-d47): either a diverging
   * side-color pair (the "w depth" modes — pure shader work on the signed
   * rotated w; see `color.ts`'s `W_SIDE_PALETTES`) or a baked per-point
   * attribute (`buildColors4`'s rotation-invariant transform / 4D-radius
   * modes). The gray-notch magnitude modulation applies either way — see
   * FOUR_D_VERTEX. Passing sides drops any baked attribute so a stale buffer
   * from a previous mode never lingers; the shader's `color` attribute then
   * falls back to ShaderMaterial's default (white), which `uUseAttrColor = 0`
   * multiplies out entirely.
   */
  setFourDColorSource(
    source: { sides: { neg: Vec3; pos: Vec3 } } | { colors: Float32Array },
  ): void {
    this.renderNeeded = true;
    const u = this.fourDMaterial.uniforms;
    if ("sides" in source) {
      (u.uSideNeg.value as THREE.Vector3).set(...source.sides.neg);
      (u.uSidePos.value as THREE.Vector3).set(...source.sides.pos);
      u.uUseAttrColor.value = 0;
      this.pointGeometry.deleteAttribute("color");
    } else {
      this.pointGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(source.colors, 3),
      );
      u.uUseAttrColor.value = 1;
    }
  }

  /** Rebuild the wireframe guide boxes from the current transform list. */
  updateGuides(
    transforms: Transform[],
    selected: number | null,
    showGuides: boolean,
  ): void {
    this.renderNeeded = true;
    // A rebuild disposes the cubes and constructs fresh ones at default
    // opacity (fr-01kf): the stored index must not go on claiming a
    // highlight is showing once the boxes it pointed at are gone.
    this.guideHighlight = null;
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
          opacity: selectedHere ? 1.0 : GUIDE_LINE_OPACITY,
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
            opacity: selectedHere ? 0.25 : GUIDE_FACE_OPACITY,
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
    this.renderNeeded = true;
    this.grid.visible = showGuides;
    this.axes.visible = showGuides;
    for (const cube of this.guideCubes) {
      cube.visible = showGuides;
    }
    if (this.fourDScaffold) this.fourDScaffold.visible = showGuides;
  }

  /**
   * Spotlight/dim the guide boxes for the "Watch it build" replay's
   * spotlight/hop guide-box emphasis (fr-01kf): the hop phase flashes the
   * box of the map the point just landed in, the spotlight phase pins it on
   * the map whose landings are lit. `null` restores every box to its built
   * default. Deliberate simplification: restoring ignores updateGuides's
   * drag-selection tint, because no selection can coexist with a replay —
   * the panel is closed while one plays, and any edit rebuilds the guides,
   * which also cancels the replay upstream.
   */
  setGuideHighlight(index: number | null): void {
    // Per-frame caller (the hop phase repeats the same index): skip the
    // dirty mark when nothing changed (fr-py7z).
    if (index === this.guideHighlight) return;
    this.guideHighlight = index;
    this.renderNeeded = true;
    for (let i = 0; i < this.guideCubes.length; i++) {
      const cube = this.guideCubes[i];
      const line = (cube as THREE.LineSegments)
        .material as THREE.LineBasicMaterial;
      const face = (cube.children[0] as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
      if (index === null) {
        line.opacity = GUIDE_LINE_OPACITY;
        face.opacity = GUIDE_FACE_OPACITY;
      } else if (i === index) {
        line.opacity = GUIDE_HIGHLIGHT_LINE_OPACITY;
        face.opacity = GUIDE_HIGHLIGHT_FACE_OPACITY;
      } else {
        line.opacity = GUIDE_DIMMED_LINE_OPACITY;
        face.opacity = GUIDE_DIMMED_FACE_OPACITY;
      }
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
    this.renderNeeded = true;
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
    const tx = orbit.target[0];
    const ty = orbit.target[1];
    const tz = orbit.target[2];
    // Per-frame caller: a static orbit hands back the identical pose every
    // frame — don't mark the frame dirty for it (fr-py7z). Every camera
    // motion source (gesture, wheel, tween, auto-orbit) mutates the orbit,
    // so this one compare covers them all.
    const last = this.lastCameraPose;
    if (
      last !== null &&
      last[0] === x &&
      last[1] === y &&
      last[2] === z &&
      last[3] === tx &&
      last[4] === ty &&
      last[5] === tz
    ) {
      return;
    }
    this.lastCameraPose = [x, y, z, tx, ty, tz];
    this.renderNeeded = true;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(tx, ty, tz);
  }

  /**
   * Select how the point cloud conveys depth. Swaps the point material and
   * configures fog/background/post-processing for the chosen style.
   */
  setRenderStyle(style: RenderStyle): void {
    this.renderNeeded = true;
    this.renderStyle = style;
    // While the 4D projection owns the point cloud, record the requested style
    // (so exiting 4D can restore it) but don't overwrite fourDMaterial. main.ts
    // also guards its onRenderStyle handler, but the scene must not be
    // corruptible from here either.
    if (this.fourDActive) return;
    switch (style) {
      case "depthFade":
        this.pointCloud.material = this.baseMaterial;
        this.fog.color.copy(DARK_FOG);
        this.scene.fog = this.fog;
        this.scene.background = this.darkBackground;
        break;
      case "aerial":
        this.pointCloud.material = this.baseMaterial;
        this.fog.color.copy(HAZE_FOG);
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
    this.renderNeeded = true;
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
    // Per-frame caller (the 4D tumble tick): a paused tumble hands back the
    // same matrix — don't mark the frame dirty for it (fr-py7z).
    const prev = this.fourDRot;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (prev[i] !== m[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.renderNeeded = true;
    const uRot4 = this.fourDMaterial.uniforms.uRot4.value as THREE.Matrix4;
    // prettier-ignore
    uRot4.set(
      m[0],  m[1],  m[2],  m[3],
      m[4],  m[5],  m[6],  m[7],
      m[8],  m[9],  m[10], m[11],
      m[12], m[13], m[14], m[15],
    );
    // The scaffold rides the exact same rotation, applied on the CPU (see the
    // field comment). `rotationMatrix4` hands us a fresh array every call, so
    // keeping the reference is safe.
    this.fourDRot = m;
    this.updateWAmp4();
    this.updateFourDScaffoldPositions();
  }

  /**
   * Show a 4D wireframe scaffold (fr-6d5) — line segments given by their 4D
   * endpoints, projected through the SAME rotation/center as the point cloud so
   * the two can never drift. A preset's tumbling edges (the pentatope's ten,
   * the tesseract's thirty-two) are what make the 4D rotation legible at a
   * glance, the way a rotating tesseract's frame does. Pass `null` (or `[]`)
   * to remove it. Follows the Show-guides toggle like the grid and axes.
   */
  setFourDScaffold(edges: [Vec4, Vec4][] | null): void {
    this.renderNeeded = true;
    if (this.fourDScaffold) {
      this.scene.remove(this.fourDScaffold);
      this.fourDScaffold.geometry.dispose();
      (this.fourDScaffold.material as THREE.Material).dispose();
      this.fourDScaffold = null;
    }
    this.fourDScaffoldEdges = edges ?? [];
    if (this.fourDScaffoldEdges.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(this.fourDScaffoldEdges.length * 6),
        3,
      ),
    );
    const material = new THREE.LineBasicMaterial({
      color: 0x93a4c8,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      // Additive like the cloud: the scaffold brightens dark background but
      // never darkens the glowing cloud into crack-like seams.
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geometry, material);
    // A handful of segments under a moving projection: culling isn't worth it.
    lines.frustumCulled = false;
    // Match the current Show-guides state (the grid is its source of truth).
    lines.visible = this.grid.visible;
    this.fourDScaffold = lines;
    this.scene.add(lines);
    this.updateFourDScaffoldPositions();
  }

  /** Re-pose the scaffold under the current 4D rotation: for each endpoint,
   * `projected = center.xyz + (R4 · (v − center)).xyz` — the CPU twin of the
   * vertex shader's transform. */
  private updateFourDScaffoldPositions(): void {
    const lines = this.fourDScaffold;
    if (!lines) return;
    const m = this.fourDRot;
    const c = this.fourDMaterial.uniforms.uCenter4.value as THREE.Vector4;
    const attr = lines.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const out = attr.array as Float32Array;
    let o = 0;
    for (const edge of this.fourDScaffoldEdges) {
      for (const v of edge) {
        const x = v[0] - c.x;
        const y = v[1] - c.y;
        const z = v[2] - c.z;
        const w = v[3] - c.w;
        out[o++] = m[0] * x + m[1] * y + m[2] * z + m[3] * w + c.x;
        out[o++] = m[4] * x + m[5] * y + m[6] * z + m[7] * w + c.y;
        out[o++] = m[8] * x + m[9] * y + m[10] * z + m[11] * w + c.z;
      }
    }
    attr.needsUpdate = true;
  }

  /** Re-aim the w-color normalization at the current rotation: 1 / (the 4D
   * bounds box's support in the rotated-w direction) — the exact max
   * |rotated w| any stored point can reach at this tumble angle (fr-9bk).
   * Called on every rotation change and cloud upload; four |m_wi|*h_i terms,
   * so the per-frame cost is noise next to the scaffold re-pose that shares
   * the trigger. The 1e-6 floor covers empty or w-flat clouds, whose q.w is
   * 0 anyway (s = 0, the palette's neutral gray). */
  private updateWAmp4(): void {
    this.fourDMaterial.uniforms.uInvWAmp4.value =
      1 / Math.max(wSupport(this.fourDRot, this.fourDHalfExtents), 1e-6);
  }

  /**
   * Configure the soft w-slice (fr-6x2): a Gaussian opacity window around
   * `center` in SIGNED normalized rotated-w units (the [-1, 1] range the
   * shader's diverging palette uses), with a fixed width and a visibility floor
   * so the unsliced projection stays as ghost context. The normalization
   * tracks the cloud's w-amplitude at the current rotation (fr-9bk), so
   * [-1, 1] always spans the occupied w-range — the slider has no dead zones
   * on anisotropic clouds. A handful of uniform writes, so sweeping the
   * slider costs nothing per frame.
   *
   * `relativeColor` (fr-nn6) recenters the w-ramp color modes' diverging
   * palette on the slice window — `sliceColorRemap` owns the gate and the
   * mapping (identity uniforms when the slice is off or the option unchosen),
   * so the shader's remap can't drift from the flame/solid renders'.
   */
  setFourDSlice(on: boolean, center: number, relativeColor: boolean): void {
    this.renderNeeded = true;
    this.fourDMaterial.uniforms.uSliceOn.value = on ? 1 : 0;
    this.fourDMaterial.uniforms.uSliceCenter.value = center;
    const { shift, invScale } = sliceColorRemap({
      sliceOn: on,
      sliceRelativeColor: relativeColor,
      sliceCenter: center,
      sliceWidth: FOUR_D_SLICE_WIDTH,
    });
    this.fourDMaterial.uniforms.uSliceColorShift.value = shift;
    this.fourDMaterial.uniforms.uSliceColorInvScale.value = invScale;
  }

  /**
   * Enable/disable the 4D projection's camera-depth fade (fr-3e0): dim each
   * point's additive contribution with camera distance — see FOUR_D_VERTEX's
   * header for why fade-to-black is the only 3D depth style that survives
   * additive blending. One uniform write; the near/far band itself follows
   * the camera per rendered frame via {@link updateFourDFade}.
   */
  setFourDDepthFade(on: boolean): void {
    this.renderNeeded = true;
    this.fourDMaterial.uniforms.uFadeOn.value = on ? 1 : 0;
  }

  /**
   * Scale every render style's points by `multiplier` (1 = authored size).
   * Applied to all materials at once so switching styles preserves the choice.
   */
  setPointSize(multiplier: number): void {
    this.renderNeeded = true;
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
    // Per-frame caller: static inputs produce the identical factor every
    // frame — don't mark the frame dirty for it (fr-py7z).
    const opacity = GLOW_BASE_OPACITY * factor;
    if (this.glowMaterial.opacity === opacity) return;
    this.glowMaterial.opacity = opacity;
    this.renderNeeded = true;
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

  /**
   * Re-bracket the camera-depth fade band around the projected 4D cloud — the
   * 4D sibling of {@link updateFog}, sharing its margin and minimum band.
   * Called from {@link render} on every 4D frame (the camera is final by
   * then), so the band is already current whenever the toggle switches the
   * fade on. The radius must be the 4D bounding ball's — the length of the
   * halfExtents 4-vector, around uCenter4.xyz — because the stored xyz
   * attribute only bounds the UN-rotated projection: once w-extent rotates
   * into view the cloud projects wider, while the 4D ball bounds it at every
   * tumble angle (the same argument as setPoints4's bounding-sphere comment).
   */
  private updateFourDFade(): void {
    const u = this.fourDMaterial.uniforms;
    if (u.uFadeOn.value === 0) return;
    const [hx, hy, hz, hw] = this.fourDHalfExtents;
    const radius = Math.hypot(hx, hy, hz, hw);
    const c = u.uCenter4.value as THREE.Vector4;
    const camDist = Math.hypot(
      this.camera.position.x - c.x,
      this.camera.position.y - c.y,
      this.camera.position.z - c.z,
    );
    let near = Math.max(0.1, camDist - radius * FOG_MARGIN);
    let far = camDist + radius * FOG_MARGIN;
    if (far - near < 0.5) {
      near = camDist - 0.5;
      far = camDist + 0.5;
    }
    u.uFadeNear.value = near;
    u.uFadeFar.value = far;
  }

  /**
   * Reserve `px` of the right edge for the panel overlay (fr-936q) — see
   * {@link rightInsetPx}. Values are clamped so at least half the viewport
   * stays visible; 0 restores the plain full-canvas projection.
   */
  setRightInset(px: number): void {
    const clamped = Math.max(0, Math.min(px, this.viewportWidth * 0.5));
    if (clamped === this.rightInsetPx) return;
    this.rightInsetPx = clamped;
    this.renderNeeded = true;
    this.syncProjection();
  }

  /**
   * Point the projection at the visible (non-panel) region: `aspect` is the
   * visible region's, and the view offset extends the render across the full
   * canvas (a sub-view wider than the "full" image is exactly how Three.js
   * expresses that). With no inset this is the ordinary full-canvas
   * projection.
   */
  private syncProjection(): void {
    const width = this.viewportWidth;
    const height = this.viewportHeight;
    const visible = width - this.rightInsetPx;
    this.camera.aspect = visible / height;
    if (this.rightInsetPx > 0) {
      this.camera.setViewOffset(visible, height, 0, 0, width, height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.renderNeeded = true;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.syncProjection();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.syncBufferDependents();
  }

  /**
   * Re-derive everything sized from the PHYSICAL drawing buffer — the EDL
   * target/resolution and the two shader-point half-height uniforms — after
   * anything that changes that buffer: a viewport resize or an adaptive
   * pixel-ratio change ({@link setResolutionScale}).
   */
  private syncBufferDependents(): void {
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.edlTarget.setSize(buffer.x, buffer.y);
    this.edlResolution.set(buffer.x, buffer.y);
    this.dofMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
    this.fourDMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
  }

  /**
   * The pixel ratio before adaptive scaling: the device's, capped at 2 —
   * beyond that the extra pixels cost more than the sharpness they add.
   */
  private basePixelRatio(): number {
    return Math.min(window.devicePixelRatio, 2);
  }

  /**
   * Scale the rendering resolution (fr-4lyt): the effective pixel ratio
   * becomes `basePixelRatio() * scale`, shrinking the drawing buffer, the
   * glow composer chain, and the EDL target together — the point sizes'
   * buffer-height uniforms follow, so points keep their on-screen size and
   * the frame just softens. Clamped to [0.25, 1]; 1 restores native
   * resolution. Exports and the flame render target are NOT scaled — see
   * {@link withFullResolution} and {@link flameRenderSize}.
   */
  setResolutionScale(scale: number): void {
    const clamped = Math.max(0.25, Math.min(1, scale));
    if (clamped === this.resolutionScale) return;
    this.resolutionScale = clamped;
    this.applyPixelRatio(this.basePixelRatio() * clamped);
  }

  /**
   * Point the renderer, composer chain, and buffer-sized dependents (EDL
   * target, point-size uniforms) at a new effective pixel ratio — the shared
   * tail of {@link setResolutionScale} and {@link withPixelRatio}. Marks the
   * frame dirty so the next live frame repaints at whatever ratio is left in
   * effect.
   */
  private applyPixelRatio(ratio: number): void {
    this.renderNeeded = true;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.syncBufferDependents();
  }

  /**
   * Run a synchronous render-and-read at an explicit pixel ratio: exports
   * are keepsakes, and they shouldn't inherit whatever transient downscale
   * the adaptive governor (fr-4lyt) happens to be at — and a hi-res export
   * (fr-2urv) renders ABOVE the live ratio the same way. No-op when the live
   * ratio already matches; the next live frame re-renders at the restored
   * ratio, so nothing soft (or giant) ever reaches the screen.
   */
  private withPixelRatio<T>(ratio: number, readback: () => T): T {
    const live = this.basePixelRatio() * this.resolutionScale;
    if (ratio === live) return readback();
    this.applyPixelRatio(ratio);
    try {
      return readback();
    } finally {
      this.applyPixelRatio(live);
    }
  }

  /**
   * The effective pixel ratio for a still export at `exportScale` × the
   * screen resolution (fr-2urv): the base ratio times the requested
   * multiple, clamped so the resulting drawing buffer's long side fits both
   * the device's texture ceiling (the EDL/composer targets and the flame
   * display texture are all textures) and {@link EXPORT_MAX_LONG_SIDE} —
   * and never below the base ratio, so an export is never softer than the
   * screen.
   */
  private exportPixelRatio(exportScale: number): number {
    const base = this.basePixelRatio();
    const longSide = Math.max(this.viewportWidth, this.viewportHeight) * base;
    const maxSide = Math.min(
      this.renderer.capabilities.maxTextureSize,
      EXPORT_MAX_LONG_SIDE,
    );
    return base * Math.max(1, Math.min(exportScale, maxSide / longSide));
  }

  render(): void {
    this.renderNeeded = false;
    // The 4D projection (fr-cbg spike) always renders plain: its material is
    // designed to look like the base style, and layering the recorded render
    // style's post-processing (bloom / EDL / DOF focus) over it would restyle
    // the projection unpredictably — including in captureFrame's PNG export.
    // The recorded style still drives fog/background until the user exits.
    // The camera-depth fade (fr-3e0) is part of the 4D material itself, not
    // post-processing, so "plain" rendering still carries it.
    if (this.fourDActive) {
      this.updateFourDFade();
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
   * Render one frame at the export resolution (fr-2urv: `exportScale` × the
   * screen buffer, device-clamped — see {@link exportPixelRatio}) and read it
   * back as an encoded PNG. Renders synchronously right before the read so
   * the drawing buffer is still intact (the renderer runs without
   * `preserveDrawingBuffer`, so a frame from the rAF loop would already be
   * gone); `canvas.toBlob` snapshots the bitmap synchronously at call time
   * and only ENCODES async, so neither the cleared buffer nor the restored
   * live ratio can race the result. Works for every render style since each
   * paints the canvas. Resolves `null` if the browser refuses the encode.
   */
  captureFrame(exportScale = 1): Promise<ExportImage | null> {
    return this.withPixelRatio(this.exportPixelRatio(exportScale), () =>
      this.withCenteredProjection(() => {
        this.render();
        return exportImageFrom(this.renderer.domElement);
      }),
    );
  }

  /**
   * Run a synchronous render-and-read with the panel inset lifted (fr-936q):
   * exports and thumbnails should compose the fractal centered in the full
   * frame, not shifted for an overlay the image doesn't contain. Restores
   * the inset projection afterwards; the next live frame re-renders with it,
   * so nothing off-center ever reaches the screen.
   */
  private withCenteredProjection<T>(readback: () => T): T {
    const inset = this.rightInsetPx;
    if (inset === 0) return readback();
    this.rightInsetPx = 0;
    this.syncProjection();
    try {
      return readback();
    } finally {
      this.rightInsetPx = inset;
      this.syncProjection();
    }
  }

  /**
   * Read the current display back as a small JPEG data URL — the thumbnail
   * source for the saved-scene collection (fr-cai). `mode` picks the source
   * the way the Save-PNG export does (fr-75sq): `"points"` renders the live
   * explorer scene, `"solid"` re-marches the voxel volume, both with the
   * same synchronous-render-then-read trick as {@link captureFrame} (the
   * renderer runs without `preserveDrawingBuffer`); `"flame"` reads the
   * flame canvas, whose zero-hit pixels are transparent — the unconditional
   * black underlay in the downscale is what {@link captureFlameFrame}'s
   * composite does, a no-op for the opaque WebGL canvas. Downsamples to at
   * most `maxDim` px on the long side and JPEG-compresses, so a whole
   * collection of thumbnails stays well within the localStorage budget.
   * Returns `""` when a 2D context is unavailable — the collection treats an
   * empty thumbnail as "no image" and renders a placeholder card.
   */
  captureThumbnail(
    mode: "points" | "flame" | "solid" = "points",
    maxDim = 160,
  ): string {
    if (mode === "flame") {
      // A flame canvas that never received an image is 0×0, and drawImage
      // would throw on it; "" is the collection's own "no image" value.
      // (main.ts prefers the explorer capture during the first-frame gap,
      // so this is belt-and-braces.)
      return this.flameCanvas.width > 0
        ? thumbnailFrom(this.flameCanvas, maxDim)
        : "";
    }
    return this.withCenteredProjection(() => {
      if (mode === "solid") this.renderSolid();
      else this.render();
      return thumbnailFrom(this.renderer.domElement, maxDim);
    });
  }

  /**
   * Physical pixel size of the drawing buffer (accounts for
   * `devicePixelRatio`) — the resolution a flame render should target so it
   * matches what is currently on screen 1:1. A hi-res export session
   * (fr-2urv) passes its `exportScale` so the WHOLE flame accumulation runs
   * at the export size (the converging on-screen image IS the export);
   * clamped like every export (see {@link exportPixelRatio}) so the display
   * texture stays under the device ceiling — main.ts additionally clamps
   * to the flame accumulation-memory budget.
   */
  flameRenderSize(exportScale = 1): { width: number; height: number } {
    // Deliberately NOT the live drawing buffer: the adaptive governor
    // (fr-4lyt) may have that scaled down under load, but a flame render is
    // a converging still — its quality shouldn't inherit a transient
    // live-cloud slowdown. Floor matches how the renderer itself derives the
    // buffer from a pixel ratio.
    const ratio = this.exportPixelRatio(exportScale);
    return {
      width: Math.floor(this.viewportWidth * ratio),
      height: Math.floor(this.viewportHeight * ratio),
    };
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
    this.renderNeeded = true;
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
    this.renderNeeded = false;
    this.renderer.setRenderTarget(null);
    this.flameQuad.render(this.renderer);
  }

  /**
   * Save-PNG source while a flame render is active. Composites the flame
   * canvas (which has transparent pixels where the histogram was never hit)
   * over opaque black so the exported PNG matches the on-screen appearance:
   * the flame quad's material is opaque (alpha ignored), and `tonemapFlame`
   * leaves zero-hit pixels black, so on screen the backdrop is pure black.
   * No `exportScale` parameter on purpose (fr-2urv): a flame session
   * ACCUMULATES at the export size (see {@link flameRenderSize}), so its
   * canvas already is the export — re-scaling here would only interpolate.
   */
  captureFlameFrame(): Promise<ExportImage | null> {
    const { width, height } = this.flameCanvas;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this.flameCanvas, 0, 0);
    return exportImageFrom(out);
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
    this.renderNeeded = true;
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
    u.uMarchSteps.value = marchStepsForGrid(size);
  }

  /**
   * Push the solid render's lighting/surface settings to the raymarcher.
   * Pure GPU uniforms — live-reactive at full frame rate, no worker restart
   * or re-accumulation for any of them (`resolution`/`iterations`, the
   * accumulation-side params, are the worker's business, not this one's).
   */
  setSolidParams(params: SolidParams): void {
    this.renderNeeded = true;
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
    this.renderNeeded = false;
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
   * {@link captureFrame} (the renderer runs without `preserveDrawingBuffer`)
   * — including its export-resolution raymarch (fr-2urv: the volume is
   * camera-independent, so one bigger frame is just more rays).
   */
  captureSolidFrame(exportScale = 1): Promise<ExportImage | null> {
    return this.withPixelRatio(this.exportPixelRatio(exportScale), () =>
      this.withCenteredProjection(() => {
        this.renderSolid();
        return exportImageFrom(this.renderer.domElement);
      }),
    );
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

/**
 * Downscale a source canvas to at most `maxDim` px on the long side and
 * JPEG-encode it over an opaque black underlay — the shared tail of every
 * `captureThumbnail` mode (fr-75sq). The black fill is what makes the flame
 * canvas's transparent zero-hit pixels match their on-screen appearance
 * (see `captureFlameFrame`); for the already-opaque WebGL canvas it changes
 * nothing. Returns `""` when a 2D context is unavailable.
 */
function thumbnailFrom(src: HTMLCanvasElement, maxDim: number): string {
  const longSide = Math.max(src.width, src.height);
  const scale = longSide > maxDim ? maxDim / longSide : 1;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return out.toDataURL("image/jpeg", 0.72);
}

/**
 * Encode a canvas as a PNG {@link ExportImage} (fr-2urv). `toBlob` snapshots
 * the bitmap synchronously at call time (only the encode runs async — see
 * `captureFrame`'s doc for why that timing matters against the
 * non-`preserveDrawingBuffer` renderer), and a Blob download skips the
 * ~hundred-MB base64 string a `toDataURL` of an 8K frame would build.
 * Resolves `null` when the browser refuses the encode.
 */
function exportImageFrom(src: HTMLCanvasElement): Promise<ExportImage | null> {
  const { width, height } = src;
  return new Promise((resolve) =>
    src.toBlob(
      (blob) => resolve(blob ? { blob, width, height } : null),
      "image/png",
    ),
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
