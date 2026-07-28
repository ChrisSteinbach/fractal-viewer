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
import { clamp, clone3 } from "../fractal/vec";
import type { Transform, Vec3, Vec4 } from "../fractal/types";
import type { Mat4 } from "../fractal/flame";
import type { OrbitCamera } from "./orbit";
import { wSupport } from "./rotor4";
import {
  contextAntialias,
  DARK_BACKDROP,
  HAZE_BACKDROP,
  hexToRgb01,
} from "./constants";
import type { RenderStyle, SolidParams } from "./state";
import {
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelTexture,
  lightDirection,
  marchStepsForGrid,
} from "./voxel-material";
import {
  configureSurfaceGridTexture,
  configureSurfaceLUTTexture,
  createSurfaceBlitMaterial,
  createSurfaceMaterial,
  setSurfaceGrid as packSurfaceGrid,
  setEscapeSystem as packEscapeSystem,
  setSurfaceSystem as packSurfaceSystem,
  SURFACE_FULL_AO_TAPS,
  SURFACE_FULL_HIT_FLOOR,
  SURFACE_FULL_MARCH_STEPS,
  SURFACE_FULL_SHADOW_STEPS,
  SURFACE_PREVIEW_AO_TAPS,
  SURFACE_PREVIEW_HIT_FLOOR,
  SURFACE_PREVIEW_MARCH_STEPS,
  SURFACE_PREVIEW_SHADOW_STEPS,
} from "./surface-material";
import {
  createPreviewGovernor,
  previewMaxDepth,
  type RenderTier,
} from "./render-tier";
import {
  createStripPlanner,
  STRIP_AFFINE_WORST_MS_PER_PX,
  STRIP_FOLD_PRIOR_MS_PER_PX,
  STRIP_FOLD_WORST_MS_PER_PX,
  type StripPlanner,
} from "./strip-planner";
import {
  createSurfaceMaterial4,
  setSurfaceSystem4 as packSurfaceSystem4,
  setSurfaceView4 as packSurfaceView4,
} from "./surface-material-4d";
import type { EscapeDE } from "../fractal/escape-de";
import { ESCAPE_TIME_ITERATIONS } from "../fractal/escape-de";
import type { SurfaceDE } from "../fractal/surface-de";
import { surfaceDescentCostWeight } from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import type { SurfaceGrid } from "../fractal/surface-grid";
import { SURFACE_COLOR_SOURCES } from "./state";
import type { SurfaceParams } from "./state";
import type { SurfaceComputeFrameSpec } from "./surface-compute";

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

  // The surface render (epic fr-7jlk): the IFS attractor sphere-traced as an
  // implicit surface against an analytic distance estimator (see
  // surface-material.ts / surface-de.ts). No volume, no worker — the whole
  // "session" is uniforms, so like the solid render the camera stays LIVE.
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  /** The 4D twin (fr-vxoj): same tracer one dimension up, marching the
   * w = w0 slice of the rotor-posed 4D attractor (surface-material-4d.ts /
   * surface-de-4d.ts). Shares {@link surfaceQuad}. */
  private readonly surfaceMaterial4: THREE.ShaderMaterial;
  /** The material {@link renderSurface} traces with — assigned by
   * {@link setSurfaceSystem} (3D) / {@link setSurfaceSystem4} (4D), so the
   * render/capture paths stay dimension-agnostic. */
  private activeSurfaceMaterial: THREE.ShaderMaterial;
  private readonly surfaceQuad: FullScreenQuad;
  /** Last rotor + w0 pushed to the 4D tracer — {@link setSurface4View} is
   * called every 4D-surface frame (paused tumble included), so equality
   * short-circuits the dirty flag exactly like {@link setRot4} (fr-py7z). */
  private readonly surface4Rot = new Array<number>(16).fill(NaN);
  private surface4W0 = NaN;
  /** The 3D empty-space-skipping grid texture (fr-55r5 part 2) the march
   * samples before paying a descent, or null while none is uploaded —
   * gridless marching is always correct, just slower. Owned here (created
   * in {@link setSurfaceGrid}, disposed on every system change and on the
   * next upload); the material only holds uniforms into it. */
  private surfaceGridTexture: THREE.Data3DTexture | null = null;
  /** Lazily allocated 256x1 ramp for the surface tracer's palette/height/
   * radius color sources — dimensions never change, so one texture is
   * mutated in place (see {@link setSurfaceColorLUT}). */
  private surfaceLUTTexture: THREE.DataTexture | null = null;
  /** Preview-tier target (fr-5ne3): while the view moves, the tracer
   * renders here at {@link surfacePreviewGovernor}'s current rung of the
   * drawing buffer and {@link surfaceBlitQuad} stretches it over the
   * canvas. Lazily sized in {@link renderSurface} so resizes/DPR changes —
   * and rung changes (fr-hith) — are absorbed without a per-frame
   * reallocation. */
  private readonly surfacePreviewTarget: THREE.WebGLRenderTarget;
  private readonly surfaceBlitMaterial: THREE.ShaderMaterial;
  private readonly surfaceBlitQuad: FullScreenQuad;
  /** The ACTIVE DE's own descent depth cap, recorded by
   * {@link setSurfaceSystem}/{@link setSurfaceSystem4}: the preview tier
   * clamps `uMaxDepth` below it and the full tier restores it, so the two
   * tiers can interleave freely (fr-5ne3). */
  private surfaceFullMaxDepth = 0;
  /** Which (scale, depth) rung preview traces currently cost (fr-hith),
   * driven by the measured cost of the traces themselves. Reset by
   * {@link setSurfaceSystem}/{@link setSurfaceSystem4}: a new DE is a new
   * cost profile, so the ladder re-adapts from the shipped 0.3 rung rather
   * than inheriting a verdict measured on the previous system. The rung's
   * depth is derived per frame in {@link setSurfaceFrameUniforms} rather
   * than cached, so it always matches both the live rung and the active
   * DE's own full depth (fr-ttg5). */
  private readonly surfacePreviewGovernor = createPreviewGovernor();
  /** Full-resolution target every FULL-quality trace renders into as
   * adaptive scissored strips (fr-sjff): a forced-completion readback
   * between strips keeps every GPU submission bounded, so a pathological
   * close-up can no longer wedge the GPU process — the failure that used
   * to require a browser restart. The async settle job spreads the strips
   * across animation frames; {@link renderSurface}'s full tier runs them
   * to completion synchronously (capture/offline export). */
  private readonly surfaceSettleTarget: THREE.WebGLRenderTarget;
  /** In-flight strip job over {@link surfaceSettleTarget}, or null. */
  private surfaceStripJob: SurfaceStripJob | null = null;
  /** In-flight strip job over {@link surfacePreviewTarget} (fr-du81), or
   * null. Preview traces used to be ONE unbounded GPU submission — the one
   * path fr-sjff left unarmored, and on fold-frontier systems (fr-5rvk,
   * 10^2-10^4x an affine descent per pixel) or software GL the FIRST frame
   * of a session could hand the GPU watchdog a minutes-long submission
   * before the preview governor had any sample to act on. Now every
   * preview renders as the same forced-completion scissor strips as the
   * settle/capture tiers, advanced by a per-frame budget: a frame too
   * heavy to finish presents its partial progress and continues (or is
   * superseded by the next invalidation, feeding the governor an
   * extrapolated cost so the ladder still learns). `spentMs` accumulates
   * the job's own measured strip time across frames — the governor sample
   * on completion. */
  private surfacePreviewJob: SurfaceStripJob | null = null;
  /** Scene holding a throwaway mesh that shares the active surface
   * material, for {@link compileSurfaceMaterial}'s async program compile
   * (fr-du81). Lazily built once. */
  private surfaceCompileScene: THREE.Scene | null = null;
  private surfaceCompileMesh: THREE.Mesh | null = null;
  /** Measured per-pixel cost (ms) of the last COMPLETED preview trace for
   * the current system, or null before one completes. SIZES the next
   * job's probe strip (fr-096u: the planner turns a prior into a
   * pixel-bounded probe), so a heavy DE's first submission is target-sized
   * from its very first strip. Reset with the governor on every system
   * upload — a new DE is a new cost profile. */
  private surfacePreviewPxCostMs: number | null = null;
  /** Whether the active WebGL surface DE is FOLD-CLASS (fold maps or a
   * fold lens — `surfaceDescentCostWeight` > 1): before ANY measurement
   * exists, its strip probes are sized from the pessimistic
   * {@link STRIP_FOLD_PRIOR_MS_PER_PX} instead of the rows-fraction
   * default. The unprimed rows-fraction probe on a fold system was
   * fr-096u's kernel-confirmed i915 preemption hang: 0.5-4ms/px at full
   * resolution put the one submission that runs before measurement past
   * the 7.5s watchdog. Affine and escape-time systems (microseconds per
   * pixel) keep the legacy probe. */
  private surfaceDeFoldClass = false;
  /** Worst per-pixel strip cost (ms) the most recently RETIRED strip job
   * observed (0 before any) — the fr-096u ratchet chain: it floors the
   * next job's worst-case cap so a monster pose discovered by one job
   * cannot be re-rouletted by its re-armed successor, and a later job on
   * a cheap pose (small observation) relaxes the floor back to the class
   * constant. Reset on every system upload. */
  private surfaceStripLastJobWorstMsPerPx = 0;
  /** Whether the ACTIVE surface session renders on the WebGPU compute path
   * (fr-tzdg) — set by {@link enterSurfaceComputeSession}. While true the
   * fold GLSL is never compiled: {@link renderSurface} degrades to a
   * re-present so a stray call cannot trigger the ~25s Mesa link the
   * compute path exists to avoid, and {@link captureThumbnail} reads the
   * last presented frame instead of tracing. */
  private surfaceComputeActive = false;
  /** Last compute frame, uploaded as a plain RGBA8 texture and stretched
   * over the canvas by the shared surface blit — the same presentation
   * seam as the preview/settle targets, so capture and the recorder keep
   * reading the one WebGL canvas. Row 0 is the BOTTOM row (the kernel's
   * py=0 is ndcY=-1), which is exactly an unflipped DataTexture under the
   * blit quad's v=0-at-bottom UVs. */
  private surfaceComputeTexture: THREE.DataTexture | null = null;
  /** Live SurfaceParams snapshot for compute frame specs — kept beside the
   * GLSL uniform writes in {@link setSurfaceParams} so both paths read the
   * one document. */
  private surfaceComputeParams: SurfaceParams | null = null;
  /** Bumped by {@link setSurfaceColorLUT} so the compute renderer
   * re-uploads its LUT texture only when the ramp actually changed. */
  private surfaceLUTVersion = 0;

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

    // MSAA is a context-creation-time choice (fr-rr2m): on at low DPR where
    // aliasing shows, off at DPR >= 2 where the buffer already oversamples
    // and the samples would quadruple fill/memory. `?msaa=0|1` overrides for
    // on-device profiling.
    this.renderer = new THREE.WebGLRenderer({
      antialias: contextAntialias(
        window.devicePixelRatio,
        new URLSearchParams(window.location.search).get("msaa"),
      ),
    });
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
      this.invalidate();
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

    // Zero-map placeholder until the first setSurfaceSystem call.
    this.surfaceMaterial = createSurfaceMaterial();
    this.surfaceMaterial4 = createSurfaceMaterial4();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad = new FullScreenQuad(this.surfaceMaterial);
    // Placeholder-sized; renderSurface's preview path sizes it to the live
    // drawing buffer. No depth/stencil — the tracer is a full-screen quad —
    // and linear filtering so the upscale blit smooths rather than blocks.
    this.surfacePreviewTarget = new THREE.WebGLRenderTarget(2, 2, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.surfaceSettleTarget = new THREE.WebGLRenderTarget(2, 2, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.surfaceBlitMaterial = createSurfaceBlitMaterial(
      this.surfacePreviewTarget.texture,
    );
    this.surfaceBlitQuad = new FullScreenQuad(this.surfaceBlitMaterial);
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

  /**
   * Force the next animation frame to repaint even if none of the per-frame
   * setters detect a change (fr-py7z). The public form of the internal dirty
   * flag, for the callers whose visible change is NOT expressed through one of
   * this scene's own mutators: returning to the live explorer from a
   * flame/solid render (fr-w9wl) — all three modes paint the one canvas, so
   * the point cloud must repaint over the lingering render image, which with
   * auto-orbit off no camera motion would otherwise trigger — and a restored
   * WebGL context (below).
   */
  invalidate(): void {
    this.renderNeeded = true;
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
    mode: "points" | "flame" | "solid" | "surface" = "points",
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
      else if (mode === "surface") {
        // Compute sessions re-present their last traced frame — tracing
        // here would be renderSurface's fold-GLSL path, which a compute
        // session deliberately never compiles (fr-tzdg). Before any frame
        // has presented, the explorer render is the honest thumbnail.
        if (!this.surfaceComputeActive) this.renderSurface();
        else if (!this.representSurfaceComputeFrame()) this.render();
      } else this.render();
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

  /**
   * Upload a freshly built surface distance estimator (epic fr-7jlk) so the
   * next {@link renderSurface} call sphere-traces it. `colors[j]` is the
   * sRGB base color and `trapIndices[j]` the orbit-trap palette coordinate
   * for `de.maps[j]` — main.ts keys both by each slot's `baseIndex`, so
   * kaleidoscope copies inherit their base map's color exactly like the
   * explorer's "By Transform" mode.
   */
  setSurfaceSystem(de: SurfaceDE, colors: Vec3[], trapIndices: number[]): void {
    this.renderNeeded = true;
    // packSurfaceSystem resets the material's grid uniforms; the texture
    // itself is ours to free (fr-55r5 part 2).
    this.dropSurfaceGridTexture();
    packSurfaceSystem(this.surfaceMaterial, de, colors, trapIndices);
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.surfaceFullMaxDepth = de.maxDepth;
    // Cost-weighted ladder entry (fr-5rvk): a fold-frontier DE's per-pixel
    // cost is a known static multiple of an affine system's, and the FIRST
    // trace has no measurement for the panic path to act on — the entry
    // rung must absorb what is known up front. The same "known up front"
    // marks the system fold-class for strip-probe sizing (fr-096u).
    const costWeight = surfaceDescentCostWeight(de);
    this.surfacePreviewGovernor.reset(costWeight);
    this.surfacePreviewPxCostMs = null;
    this.surfaceDeFoldClass = costWeight > 1;
    this.surfaceStripLastJobWorstMsPerPx = 0;
  }

  /**
   * Escape-time sibling of {@link setSurfaceSystem} (fr-kltj): upload the
   * single fold map's forward affine + fold params and flip the material
   * onto the SURFACE_ESCAPE variant. Everything else about the mode —
   * tiers, strips, compile gate, capture — runs unchanged on the same
   * material; the iteration budget rides {@link surfaceFullMaxDepth}, so
   * the preview depth clamp trades boundary detail for speed exactly as
   * the IFS descent trades levels. No grid exists for this mode.
   */
  setEscapeSystem(de: EscapeDE, color: Vec3): void {
    this.renderNeeded = true;
    this.dropSurfaceGridTexture();
    packEscapeSystem(this.surfaceMaterial, de, color);
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.surfaceFullMaxDepth = ESCAPE_TIME_ITERATIONS;
    // The escape loop is phone-cheap (~30 branchless folds per eval):
    // the plain anchor entry is right, and so is the legacy strip probe.
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceDeFoldClass = false;
    this.surfaceStripLastJobWorstMsPerPx = 0;
  }

  /**
   * Upload a finished empty-space-skipping grid (fr-55r5 part 2) for the
   * CURRENT 3D surface system — the async worker build main.ts kicked off
   * alongside {@link setSurfaceSystem}. Marks the frame dirty so the tier
   * loop re-previews and re-settles with the faster march; an in-flight
   * settle job keeps tracing gridless strips until that invalidation lands
   * (the uniforms flip here, but main.ts's invalidate supersedes the job
   * the same frame, so no mixed-grid seam survives to the screen).
   */
  setSurfaceGrid(grid: SurfaceGrid): void {
    this.dropSurfaceGridTexture();
    const texture = new THREE.Data3DTexture(
      grid.values,
      grid.resolution,
      grid.resolution,
      grid.resolution,
    );
    configureSurfaceGridTexture(texture);
    this.surfaceGridTexture = texture;
    packSurfaceGrid(this.surfaceMaterial, texture, grid.halfExtent);
    this.renderNeeded = true;
  }

  /** Dispose and forget the grid texture, and unhook the 3D material's grid
   * uniforms — every system change lands here before new state goes up. */
  private dropSurfaceGridTexture(): void {
    packSurfaceGrid(this.surfaceMaterial, null);
    this.surfaceGridTexture?.dispose();
    this.surfaceGridTexture = null;
  }

  /**
   * 4D twin of {@link setSurfaceSystem} (fr-vxoj): upload the 4D DE and
   * point the shared quad at the 4D tracer. The rotor/slice VIEW state
   * arrives separately ({@link setSurface4View}) — the DE is
   * pose-independent, exactly as the 3D DE is camera-independent.
   */
  setSurfaceSystem4(
    de: SurfaceDE4,
    colors: Vec3[],
    trapIndices: number[],
  ): void {
    this.renderNeeded = true;
    // A stale 3D grid must not outlive its system just because the next
    // session is 4D (no grid there — the live rotor/slice would invalidate
    // one every frame).
    this.dropSurfaceGridTexture();
    packSurfaceSystem4(this.surfaceMaterial4, de, colors, trapIndices);
    this.activeSurfaceMaterial = this.surfaceMaterial4;
    this.surfaceQuad.material = this.surfaceMaterial4;
    this.surfaceFullMaxDepth = de.maxDepth;
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    // 4D surface DEs have no fold vocabulary (affine-class throughout).
    this.surfaceDeFoldClass = false;
    this.surfaceStripLastJobWorstMsPerPx = 0;
  }

  /**
   * Per-frame rotor + w-slice for the 4D surface tracer — the live-pose
   * analogue of {@link setRot4}, with the same "same matrix, don't dirty
   * the frame" guard (fr-py7z): main.ts pushes every 4D-surface frame,
   * paused tumble included, and equality keeps render-on-demand honest.
   * `m` is the row-major world rotor from `fourDView.matrix()`; the packer
   * transposes it into the tracer's inverse-rotor uniform.
   */
  setSurface4View(m: number[], w0: number): void {
    const prev = this.surface4Rot;
    let changed = this.surface4W0 !== w0;
    for (let i = 0; i < 16 && !changed; i++) {
      if (prev[i] !== m[i]) changed = true;
    }
    if (!changed) return;
    for (let i = 0; i < 16; i++) prev[i] = m[i];
    this.surface4W0 = w0;
    this.renderNeeded = true;
    packSurfaceView4(this.surfaceMaterial4, m, w0);
  }

  /**
   * Push the surface render's lighting + color-source settings to the
   * tracer. Pure GPU uniforms — live-reactive at full frame rate, nothing
   * to restart (the tracer has no accumulation at all). The colorSource
   * string maps to the shader's integer dispatch via its position in
   * `SURFACE_COLOR_SOURCES` — the single source of truth both sides key on.
   */
  setSurfaceParams(params: SurfaceParams): void {
    this.renderNeeded = true;
    // The compute path reads the same document at frame-spec assembly
    // (fr-tzdg) — snapshot it beside the uniform writes.
    this.surfaceComputeParams = params;
    // Both tracers share the one SurfaceParams document — push to both so
    // whichever the next session activates is already current.
    for (const material of [this.surfaceMaterial, this.surfaceMaterial4]) {
      const u = material.uniforms;
      u.uAmbient.value = params.ambient;
      (u.uLightDir.value as THREE.Vector3).copy(
        lightDirection(params.lightAzimuth, params.lightElevation),
      );
      u.uColorSource.value = SURFACE_COLOR_SOURCES.indexOf(params.colorSource);
      u.uColorSpeed.value = params.colorSpeed;
    }
  }

  /**
   * Upload a 256x3 color ramp (0..1 floats from `surfaceColorLUT` — built
   * by color.ts/palette.ts's ONE ramp definitions) for the surface tracer's
   * palette/height/radius color sources. Quantized to RGBA8 here: byte
   * textures filter linearly everywhere, and the ramp was authored in
   * 8-bit-per-stop terms to begin with. The texture is allocated once and
   * mutated in place — its 256x1 dimensions never change.
   */
  setSurfaceColorLUT(lut: Float32Array): void {
    this.renderNeeded = true;
    if (!this.surfaceLUTTexture) {
      this.surfaceLUTTexture = new THREE.DataTexture(
        new Uint8Array(256 * 4),
        256,
        1,
      );
      configureSurfaceLUTTexture(this.surfaceLUTTexture);
      // One texture, both tracers — the ramp is a property of the document's
      // SurfaceParams, not of the system's dimensionality.
      this.surfaceMaterial.uniforms.uColorLUT.value = this.surfaceLUTTexture;
      this.surfaceMaterial4.uniforms.uColorLUT.value = this.surfaceLUTTexture;
    }
    const data = this.surfaceLUTTexture.image.data as Uint8Array;
    for (let i = 0; i < 256; i++) {
      data[i * 4] = Math.round(clamp(lut[i * 3], 0, 1) * 255);
      data[i * 4 + 1] = Math.round(clamp(lut[i * 3 + 1], 0, 1) * 255);
      data[i * 4 + 2] = Math.round(clamp(lut[i * 3 + 2], 0, 1) * 255);
      data[i * 4 + 3] = 255;
    }
    this.surfaceLUTTexture.needsUpdate = true;
    // The compute renderer shares these exact quantized bytes (fr-tzdg) —
    // one ramp definition, bit-identical on both tracers.
    this.surfaceLUTVersion++;
  }

  /**
   * Enter the WebGPU compute presentation for the surface session being
   * started (fr-tzdg): the same session-entry resets as
   * {@link setSurfaceSystem} — cost-weighted governor entry rung, the DE's
   * own full depth for the preview clamp — without touching the GLSL
   * material, whose fold variant must never compile on this path (the
   * ~25s Mesa link / fr-096u entry hazards are the point of the mode).
   */
  enterSurfaceComputeSession(de: SurfaceDE): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceFullMaxDepth = de.maxDepth;
    this.surfacePreviewGovernor.reset(surfaceDescentCostWeight(de));
    this.surfacePreviewPxCostMs = null;
  }

  /** Leave the compute presentation (session exit or fallback re-enter):
   * drop the flag and free the frame texture — a settled full-resolution
   * frame holds megabytes of GPU memory nothing will re-present. */
  exitSurfaceComputeSession(): void {
    this.surfaceComputeActive = false;
    this.surfaceComputeTexture?.dispose();
    this.surfaceComputeTexture = null;
  }

  get surfaceComputeSessionActive(): boolean {
    return this.surfaceComputeActive;
  }

  /**
   * Assemble one compute frame's inputs from the live camera, the tier
   * knobs, and the SurfaceParams snapshot — the exact quantities
   * {@link setSurfaceFrameUniforms} writes as uniforms, handed across the
   * WebGPU seam as plain data. Preview frames raster at the governor's
   * rung of the drawing buffer and clamp depth via previewMaxDepth, the
   * fr-hith/fr-ttg5 coupling; acceptance eps ALWAYS derives from the
   * native buffer height (fr-7xgi — a tier coarsens sampling, never
   * acceptance).
   */
  surfaceComputeFrameSpec(tier: RenderTier): SurfaceComputeFrameSpec {
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    const scale = tier === "preview" ? this.surfacePreviewGovernor.scale : 1;
    const w = Math.max(1, Math.round(size.x * scale));
    const h = Math.max(1, Math.round(size.y * scale));
    return this.surfaceComputeFrameSpecAt(tier, w, h, size.y);
  }

  private surfaceComputeFrameSpecAt(
    tier: RenderTier,
    width: number,
    height: number,
    acceptHeight: number,
  ): SurfaceComputeFrameSpec {
    const params = this.surfaceComputeParams;
    if (!params) {
      throw new Error("surface compute frame spec requested before params");
    }
    this.camera.updateMatrixWorld();
    const inv = new THREE.Matrix4()
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .invert();
    const angularPerPixel = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    const preview = tier === "preview";
    const light = lightDirection(params.lightAzimuth, params.lightElevation);
    return {
      width,
      height,
      invProjView: new Float32Array(inv.elements),
      camPos: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ],
      acceptPixelEps: angularPerPixel / Math.max(acceptHeight, 1),
      tracePixelEps: angularPerPixel / Math.max(height, 1),
      maxDepth: preview
        ? previewMaxDepth(
            this.surfaceFullMaxDepth,
            this.surfacePreviewGovernor.scale,
          )
        : this.surfaceFullMaxDepth,
      marchSteps: preview
        ? SURFACE_PREVIEW_MARCH_STEPS
        : SURFACE_FULL_MARCH_STEPS,
      shadowSteps: preview
        ? SURFACE_PREVIEW_SHADOW_STEPS
        : SURFACE_FULL_SHADOW_STEPS,
      aoTaps: preview ? SURFACE_PREVIEW_AO_TAPS : SURFACE_FULL_AO_TAPS,
      hitFloor: preview ? SURFACE_PREVIEW_HIT_FLOOR : SURFACE_FULL_HIT_FLOOR,
      lightDir: [light.x, light.y, light.z],
      ambient: params.ambient,
      colorSource: SURFACE_COLOR_SOURCES.indexOf(params.colorSource),
      colorSpeed: params.colorSpeed,
      lut:
        (this.surfaceLUTTexture?.image.data as Uint8Array | undefined) ?? null,
      lutVersion: this.surfaceLUTVersion,
      dither: true,
    };
  }

  /**
   * Upload a finished (or progressively presenting) compute frame and
   * stretch it over the canvas via the shared blit — presentation only,
   * deliberately not an invalidation: presents must not re-arm the
   * preview tier they themselves satisfy.
   */
  presentSurfaceComputeFrame(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): void {
    let tex = this.surfaceComputeTexture;
    if (!tex || tex.image.width !== width || tex.image.height !== height) {
      tex?.dispose();
      tex = new THREE.DataTexture(
        new Uint8Array(width * height * 4),
        width,
        height,
      );
      // Linear + clamp like the preview target: previews upscale to the
      // canvas, and nearest sampling would pixelate the stretch.
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      this.surfaceComputeTexture = tex;
    }
    (tex.image.data as Uint8Array).set(pixels);
    tex.needsUpdate = true;
    this.blitSurface(tex, null);
  }

  /** Repaint the last presented compute frame (recorder ticks, forced
   * offline frames, exit repaints). False when none exists yet. */
  representSurfaceComputeFrame(): boolean {
    if (!this.surfaceComputeTexture) return false;
    this.blitSurface(this.surfaceComputeTexture, null);
    return true;
  }

  /** Feed the preview governor a measured compute preview cost — the
   * compute path's analogue of the strip jobs' completed-trace samples. */
  sampleSurfaceComputeCost(traceMs: number): void {
    this.surfacePreviewGovernor.sample(traceMs);
  }

  /** Consume the dirty flag when the compute path kicks a frame for it —
   * the role {@link renderSurface}'s own clear plays on the GLSL path. */
  clearRenderNeeded(): void {
    this.renderNeeded = false;
  }

  /**
   * Compute-path Save-PNG (fr-tzdg): trace at the export raster fully
   * off-canvas (`trace` runs the async compute frame), then present and
   * read back in ONE synchronous span at the export pixel ratio — the
   * paint and the `toBlob` snapshot share a task, the same discipline as
   * {@link captureSurfaceFrame}. The spec is assembled under the centered
   * projection so the export composes like every other capture
   * (fr-936q), at the export buffer's own eps (finer resolution traces
   * finer, exactly like the GLSL capture).
   */
  async captureSurfaceComputeFrame(
    exportScale: number,
    trace: (spec: SurfaceComputeFrameSpec) => Promise<Uint8Array | null>,
  ): Promise<ExportImage | null> {
    const ratio = this.exportPixelRatio(exportScale);
    // The renderer floors when deriving a buffer from a ratio — match it
    // (flameRenderSize's own arithmetic) without paying a resize just to
    // measure.
    const width = Math.floor(this.viewportWidth * ratio);
    const height = Math.floor(this.viewportHeight * ratio);
    const spec = this.withCenteredProjection(() =>
      this.surfaceComputeFrameSpecAt("full", width, height, height),
    );
    const pixels = await trace(spec);
    if (!pixels) return null;
    return this.withPixelRatio(ratio, () => {
      this.presentSurfaceComputeFrame(pixels, width, height);
      return exportImageFrom(this.renderer.domElement);
    });
  }

  /**
   * Sphere-trace the surface DE from the CURRENT camera, filling the canvas
   * — used in place of {@link render} while the surface render is active.
   * Reads the live camera each call (the DE is world-space and
   * camera-independent, exactly like the solid render's volume), so
   * orbit/zoom keep working. The cone-tracing hit epsilon is the camera's
   * angular pixel footprint, recomputed here so an export-scaled drawing
   * buffer (see {@link captureSurfaceFrame}) traces at its own, finer
   * resolution rather than the on-screen one.
   *
   * `tier` (fr-5ne3) is main.ts's interaction split: "full" (the default —
   * capture and offline export land here by construction) traces at full
   * quality SYNCHRONOUSLY, as the same adaptive scissored strips the async
   * settle job uses (fr-sjff: a `gl.finish()` between strips bounds every
   * GPU submission, so even a pathological close-up export cannot wedge
   * the GPU process), then presents the completed frame; "preview" traces
   * {@link surfacePreviewTarget} at {@link surfacePreviewGovernor}'s
   * measured rung with the preview-tier quality knobs (depth clamp,
   * march/shadow/AO budgets, hit floor) and stretches it over the canvas —
   * the cheap frames that keep a drag/tumble fluid while the settle frame
   * carries the quality. Every knob is a plain uniform write restored by
   * the next full-tier call, so the shader bodies (and their CPU-oracle
   * discipline) are untouched. Each preview trace also feeds its own
   * measured cost back to the governor (fr-hith), so the rung tracks what
   * this device actually manages on this system — and only preview frames
   * are sampled, never the settle or capture paths.
   */
  renderSurface(tier: RenderTier = "full"): void {
    this.renderNeeded = false;
    if (this.surfaceComputeActive) {
      // A compute session never compiled the fold GLSL — a stray call
      // through this path must not trigger the ~25s Mesa link the mode
      // exists to avoid (fr-tzdg). main.ts routes ticks and captures
      // before this can matter; re-presenting keeps an accidental caller
      // harmless.
      this.representSurfaceComputeFrame();
      return;
    }
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    if (tier === "preview") {
      // Arm a fresh preview strip job for THIS invalidation (superseding
      // any in-flight one — its partial measurement still teaches the
      // governor, see armSurfacePreview) and advance it by one frame's
      // budget. On systems where a whole preview fits the budget — every
      // fold-free system on a healthy GPU — the job completes right here
      // and this call is behaviorally the old single-draw path; on heavy
      // systems the partial presents and stepSurfacePreview continues it
      // next frame (fr-du81).
      this.armSurfacePreview(size);
      this.stepSurfacePreview();
      return;
    }
    // Full quality, synchronously — but never as one unbounded GPU
    // submission (fr-sjff): the same adaptive strips as the async settle
    // job, run to completion right here. Capture and offline export land
    // on this path, so a pathological close-up export is watchdog-safe
    // too. A stale async job must not interleave with this frame's strips
    // — nor a stale preview job resume after it with full-tier uniforms.
    this.abandonSurfaceSettle();
    this.abandonSurfacePreview();
    sizeTarget(this.surfaceSettleTarget, size.x, size.y);
    this.setSurfaceFrameUniforms("full", size.y, size.y);
    this.surfaceStripJob = {
      planner: createStripPlanner(size.y, size.x, {
        priorMsPerPx: this.surfaceStripPriorMsPerPx(),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      lastStripMs: null,
      spentMs: 0,
      pending: null,
    };
    this.renderSurfaceStrips(Infinity);
    this.blitSurface(this.surfaceSettleTarget.texture, null);
  }

  /**
   * Best per-pixel cost estimate (ms) available BEFORE a strip job's probe
   * runs — the planner sizes the probe from it (fr-096u). A completed
   * preview's measurement when one exists (it understates the full tier's
   * deeper depth clamp and richer budgets by a small factor, which the
   * probe's target absorbs); else the pessimistic fold-class prior, so a
   * fold session's very FIRST submission is bounded the way the compute
   * path's first slice is (fr-p8bc's discipline); else null — affine-cheap
   * systems keep the legacy rows-fraction probe.
   */
  private surfaceStripPriorMsPerPx(): number | null {
    return (
      this.surfacePreviewPxCostMs ??
      (this.surfaceDeFoldClass ? STRIP_FOLD_PRIOR_MS_PER_PX : null)
    );
  }

  /**
   * Class-pessimistic per-pixel cost for the planner's worst-case strip
   * cap (fr-096u's second mechanism): unlike the probe prior above, this
   * must NEVER be replaced by a measurement — a measured value comes from
   * whatever band recent strips crossed, and the cap exists precisely for
   * the strip that leaves that band for a 100-1000x pricier one.
   */
  private surfaceStripWorstMsPerPx(): number {
    return Math.max(
      this.surfaceDeFoldClass
        ? STRIP_FOLD_WORST_MS_PER_PX
        : STRIP_AFFINE_WORST_MS_PER_PX,
      this.surfaceStripLastJobWorstMsPerPx,
    );
  }

  /** Retire a strip job into the ratchet chain (see
   * {@link surfaceStripLastJobWorstMsPerPx}): its own observation REPLACES
   * the chain value — a cheap pose's small observation is exactly what
   * lets the floor relax after a monster pose poisoned it. A job that
   * measured NOTHING (superseded before its first strip completed) is
   * absence of evidence and keeps the chain as it was — dropping the
   * floor on it would hand the next job one fresh roulette spin. */
  private retireStripJob(job: SurfaceStripJob): void {
    const observed = job.planner.observedWorstMsPerPx;
    if (observed > 0) this.surfaceStripLastJobWorstMsPerPx = observed;
  }

  /**
   * Arm a preview strip job at the governor's current rung: size the
   * target, freeze this frame's camera + preview-tier uniforms (any later
   * invalidation re-arms, so they cannot go stale mid-job — the settle
   * job's own discipline), and plan strips against the preview strip
   * target. A superseded in-flight job first feeds the governor its
   * measured cost extrapolated to the full frame: a device too slow to
   * EVER finish a preview inside one gesture frame would otherwise never
   * produce a sample, and the ladder (whose panic path acts on the very
   * first sample after warm-up) could not learn its way down to a rung
   * the device can hold.
   */
  private armSurfacePreview(size: THREE.Vector2): void {
    const job = this.surfacePreviewJob;
    // Per-pixel cost prediction for the NEW job's probe pacing: a
    // completed preview's measurement when one exists, else whatever the
    // superseded partial measured. Rung-invariant only approximately
    // (finer rungs trace deeper), but it only picks a pacing regime —
    // both regimes are correct.
    let pxCostMs = this.surfacePreviewPxCostMs;
    if (job) {
      this.surfacePreviewJob = null;
      this.retireStripJob(job);
      // Pixels handed to a still-pending fence were planned but never
      // accounted — extrapolate from the MEASURED pixels only, or the
      // estimate would read low by the pending strip's whole cost.
      const tracedPx = job.planner.plannedPx - (job.pending?.px ?? 0);
      this.releaseStripJob(job);
      if (tracedPx > 0 && job.spentMs > 0) {
        this.surfacePreviewGovernor.sample(
          (job.spentMs * job.planner.totalPx) / tracedPx,
        );
        pxCostMs ??= job.spentMs / tracedPx;
      }
    }
    // uPixelEps derives from the TARGET's height (shading probes match
    // the preview pixels), but ACCEPTANCE derives from the native height
    // — a preview must never accept a hit the settle frame would reject
    // (fr-7xgi; see setSurfaceFrameUniforms).
    const scale = this.surfacePreviewGovernor.scale;
    const w = Math.max(1, Math.round(size.x * scale));
    const h = Math.max(1, Math.round(size.y * scale));
    const resized =
      this.surfacePreviewTarget.width !== w ||
      this.surfacePreviewTarget.height !== h;
    sizeTarget(this.surfacePreviewTarget, w, h);
    if (resized) {
      // A partial present must show backdrop under untraced rows, never
      // uninitialized target memory. Same-size re-arms keep the previous
      // preview's pixels instead — the cheapest seed there is.
      this.renderer.setRenderTarget(this.surfacePreviewTarget);
      this.renderer.clear();
      this.renderer.setRenderTarget(null);
    }
    this.setSurfaceFrameUniforms("preview", h, size.y);
    // Probe SIZED from the prior (fr-096u): a measured px cost when one
    // exists, else the pessimistic fold-class prior. Either way the probe
    // plans at most ~one strip target of predicted GPU — during a drag on
    // a heavy fold system every frame re-arms, and each re-arm's first
    // submission stays bounded (fr-du81's pacing-only priming used to
    // leave the probe's SIZE fixed at a rows fraction, which on fold
    // systems was seconds of GPU in the one unmeasured submission).
    this.surfacePreviewJob = {
      planner: createStripPlanner(h, w, {
        targetMs: SURFACE_PREVIEW_STRIP_TARGET_MS,
        priorMsPerPx:
          pxCostMs ??
          (this.surfaceDeFoldClass ? STRIP_FOLD_PRIOR_MS_PER_PX : null),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      lastStripMs: null,
      spentMs: 0,
      pending: null,
    };
  }

  /**
   * Advance the in-flight preview job by about
   * {@link SURFACE_PREVIEW_STEP_BUDGET_MS} of measured GPU time and
   * repaint the canvas with its progress. On completion the job's total
   * measured cost — the same forced-completion semantics as the old
   * single-draw measurement, just accumulated over strips — feeds the
   * governor (fr-hith), and true is returned (no-op true when no job is
   * running).
   */
  stepSurfacePreview(): boolean {
    const job = this.surfacePreviewJob;
    if (!job) return true;
    const spentBefore = job.spentMs;
    const done = this.pumpStrips(
      job,
      this.surfacePreviewTarget,
      SURFACE_PREVIEW_STEP_BUDGET_MS,
    );
    if (done) {
      this.surfacePreviewJob = null;
      this.retireStripJob(job);
      const { width, height } = this.surfacePreviewTarget;
      // Per-pixel cost of the completed trace: primes the settle job's
      // probe prediction (beginSurfaceSettle) so ITS first strip can
      // fence-pace instead of blocking for seconds on the devices this
      // matters for.
      this.surfacePreviewPxCostMs = job.spentMs / Math.max(1, width * height);
      this.surfacePreviewGovernor.sample(job.spentMs);
    }
    // Present whenever this call traced NEW rows (or finished). A pure
    // fence poll-miss painted nothing — skip the blit so those frames
    // cost no GL work, but never skip after real progress: during a
    // fence-paced grind every completed strip must reach the canvas, or
    // the whole progressive fill would present only at job end.
    if (done || job.spentMs !== spentBefore) {
      this.blitSurface(this.surfacePreviewTarget.texture, null);
    }
    return done;
  }

  /** Discard the in-flight preview job (a full-tier trace or a session
   * exit supersedes it). No governor sample: the discard is not evidence
   * about trace cost. */
  abandonSurfacePreview(): void {
    this.releaseStripJob(this.surfacePreviewJob);
    this.surfacePreviewJob = null;
  }

  /** Whether a preview job is mid-flight (main.ts steps it per frame and
   * holds the settle job off until it completes). */
  get surfacePreviewActive(): boolean {
    return this.surfacePreviewJob !== null;
  }

  /**
   * Compile the ACTIVE surface material's program off the critical path
   * (fr-du81). The fold-frontier variant (fr-5rvk's SURFACE_FOLDS define)
   * is a large program measured at ~25s of driver compile on desktop Mesa
   * — synchronous at first draw, it blocks the main thread for the whole
   * stall. `WebGLRenderer.compileAsync` compiles via
   * KHR_parallel_shader_compile where the driver offers it (polling
   * completion instead of blocking); where it doesn't, this degrades to
   * the same one-off synchronous compile as before, just before the first
   * frame rather than inside it. main.ts gates the session's first-frame
   * flag on the returned promise, keeping the live explorer on screen
   * until the tracer is actually ready to draw.
   */
  async compileSurfaceMaterial(): Promise<void> {
    if (!this.surfaceCompileScene) {
      // The compile meshes MUST use FullScreenQuad's exact geometry — a
      // fullscreen triangle with position + uv and NO normal. Geometry
      // attributes feed the program cache key, so compiling the material
      // on (say) a PlaneGeometry links a program variant the real quad
      // draw then can't reuse — measured on Mesa/Iris as a SECOND ~68KB
      // fold link right after the first, which crashed the driver's
      // compiler where either alone succeeds.
      const quadGeometry = () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
        );
        geometry.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2),
        );
        return geometry;
      };
      this.surfaceCompileScene = new THREE.Scene();
      this.surfaceCompileMesh = new THREE.Mesh(
        quadGeometry(),
        this.activeSurfaceMaterial,
      );
      this.surfaceCompileScene.add(this.surfaceCompileMesh);
      // The blit material rides along: it is tiny, but its first-use link
      // would otherwise JOIN the driver's compile queue right behind the
      // fold program and stall the first present for the whole compile.
      this.surfaceCompileScene.add(
        new THREE.Mesh(quadGeometry(), this.surfaceBlitMaterial),
      );
    }
    this.surfaceCompileMesh!.material = this.activeSurfaceMaterial;
    await this.renderer.compileAsync(this.surfaceCompileScene, this.camera);
  }

  /**
   * One-pixel proof that the compiled tracer actually DRAWS (fr-du81):
   * `compileAsync` resolves when the program's compile completes, not when
   * it succeeds — a driver that crashed its compiler thread (observed on
   * Mesa/Iris under the 68KB fold program pre-fr-5rvk) reports link
   * failure only at first use, as an INVALID_OPERATION on the draw. A
   * 1x1 scissored trace into the preview target is one DE evaluation —
   * microseconds — and `getError` after it is the verdict main.ts's gate
   * needs to fail into the render-error path instead of presenting a
   * black canvas on a dying context.
   */
  probeSurfaceProgram(): boolean {
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    sizeTarget(this.surfacePreviewTarget, 1, 1);
    this.setSurfaceFrameUniforms("preview", 1, size.y);
    const target = this.surfacePreviewTarget;
    target.scissorTest = true;
    target.scissor.set(0, 0, 1, 1);
    this.renderer.setRenderTarget(target);
    const gl = this.renderer.getContext();
    // Drain any error already latched by unrelated code, so the verdict
    // below is this draw's own.
    gl.getError();
    this.surfaceQuad.render(this.renderer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    const ok = gl.getError() === gl.NO_ERROR;
    target.scissorTest = false;
    target.scissor.set(0, 0, target.width, target.height);
    this.renderer.setRenderTarget(null);
    return ok;
  }

  /**
   * Start the ASYNC full-quality settle job (fr-sjff): freeze the camera +
   * full-tier quality uniforms (main.ts abandons the job on any
   * invalidation, so they cannot go stale mid-job), seed the settle target
   * with the parked preview stretched to full size — per-step progress
   * blits then show the preview sharpening strip by strip, never
   * uninitialized rows — and arm the strip planner.
   * {@link stepSurfaceSettle} does the actual tracing, a bounded slice per
   * animation frame.
   *
   * May decline to arm (fr-096u): when the preview's measured cost prices
   * the full frame past {@link SURFACE_SETTLE_SKIP_CEILING_MS}, the seeded
   * stretch is the final frame — callers observe {@link surfaceSettleActive}
   * false right after this call and treat the settle as complete.
   */
  beginSurfaceSettle(): void {
    // main.ts holds the settle off until the preview job completes; a
    // still-armed job here would resume later with THIS frame's full-tier
    // uniforms, so drop it defensively.
    this.abandonSurfacePreview();
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    sizeTarget(this.surfaceSettleTarget, size.x, size.y);
    this.setSurfaceFrameUniforms("full", size.y, size.y);
    this.blitSurface(
      this.surfacePreviewTarget.texture,
      this.surfaceSettleTarget,
    );
    // Cost gate (fr-096u): the settle never ARMS when the preview's
    // measured per-pixel cost extrapolates the full-tier frame past
    // {@link SURFACE_SETTLE_SKIP_CEILING_MS}. On fold systems at
    // near-surface poses the full frame prices out in HOURS (measured
    // ~42ms/px band average on Iris, single crease pixels up to ~2.2s) —
    // a trace that can never complete, whose only real product is
    // watchdog-reset roulette that the per-strip cap alone cannot fully
    // rule out (crease pixels cluster, so even few-pixel strips can run
    // seconds). The preview-seeded stretch above IS the settled frame
    // then: the caller observes no job armed and treats the settle as
    // complete. A fold session with NO completed preview measurement is
    // expensive by definition (its previews could not finish) — same
    // verdict.
    const predictedMs =
      this.surfacePreviewPxCostMs !== null
        ? this.surfacePreviewPxCostMs * size.x * size.y
        : this.surfaceDeFoldClass
          ? Infinity
          : 0;
    if (predictedMs > SURFACE_SETTLE_SKIP_CEILING_MS) return;
    // Force the seed — and every frame still queued before it — to
    // COMPLETE before the probe strip runs, so the probe's measurement is
    // the probe alone, not leftover backlog. A 1x1 readback is the one
    // sync a driver cannot fake (see renderSurfaceStrips); on a healthy
    // device this is microseconds.
    this.renderer.setRenderTarget(this.surfaceSettleTarget);
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    this.renderer.setRenderTarget(null);
    // Probe SIZED from the completed preview's measured per-pixel cost —
    // or the pessimistic fold prior when none exists (fr-096u). The
    // rows-fraction probe this replaces was the settle's one unmeasured
    // submission: at full resolution on a fold system it measured up to
    // ~15s of GPU, past the i915 7.5s preemption window — the
    // kernel-confirmed context-loss class. Sized from the prior, the probe
    // plans ~one strip target of predicted GPU and the real measurement
    // takes over from the second strip.
    this.surfaceStripJob = {
      planner: createStripPlanner(size.y, size.x, {
        priorMsPerPx: this.surfaceStripPriorMsPerPx(),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      lastStripMs: null,
      spentMs: 0,
      pending: null,
    };
  }

  /**
   * Advance the settle job by about {@link SURFACE_SETTLE_STEP_BUDGET_MS}
   * of measured GPU time and repaint the canvas with the progress (the
   * traced strips over the preview-seeded rest). Returns true when the
   * frame is complete (the job is then disarmed). No-op true when no job
   * is running.
   */
  stepSurfaceSettle(): boolean {
    if (!this.surfaceStripJob) return true;
    const done = this.renderSurfaceStrips(SURFACE_SETTLE_STEP_BUDGET_MS);
    this.blitSurface(this.surfaceSettleTarget.texture, null);
    return done;
  }

  /** Discard the in-flight settle job (a fresh invalidation supersedes
   * it). The settle target keeps its stale pixels; nothing reads them
   * until a new job re-seeds it. */
  abandonSurfaceSettle(): void {
    this.releaseStripJob(this.surfaceStripJob);
    this.surfaceStripJob = null;
  }

  /** Whether a settle job is mid-flight (main.ts steps it per frame). */
  get surfaceSettleActive(): boolean {
    return this.surfaceStripJob !== null;
  }

  /**
   * Repaint the canvas from the COMPLETED settle target — main.ts's cheap
   * repaint for recorder frames of a parked, already-settled view (the
   * caller tracks validity; a re-trace would be seconds of GPU for an
   * identical image).
   */
  presentSettledSurface(): void {
    this.blitSurface(this.surfaceSettleTarget.texture, null);
  }

  /**
   * Camera + per-tier quality uniforms on the ACTIVE surface material, for
   * a trace whose buffer is `height` pixels tall. `acceptHeight` is the
   * height of the FULL-RESOLUTION frame this trace stands in for (the
   * settle/capture buffer): hit acceptance derives its epsilon from THAT,
   * tier-independently, so a preview can never accept a hit the settle
   * frame would reject (fr-7xgi — the fold-phantom fix; see
   * uAcceptPixelEps's doc in surface-material.ts). The tier knobs are all
   * tracer-side (march/shadow/AO budgets, hit floor, depth clamp — plain
   * uniform writes); the oracle-mirrored DE bodies never change.
   */
  private setSurfaceFrameUniforms(
    tier: RenderTier,
    height: number,
    acceptHeight: number,
  ): void {
    this.camera.updateMatrixWorld();
    const u = this.activeSurfaceMaterial.uniforms;
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    (u.uInvProjView.value as THREE.Matrix4)
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .invert();
    const angularPerPixel = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    u.uPixelEps.value = angularPerPixel / Math.max(height, 1);
    u.uAcceptPixelEps.value = angularPerPixel / Math.max(acceptHeight, 1);
    const preview = tier === "preview";
    // Derived per frame, never cached: the clamp depends on BOTH the
    // active DE's own full depth (fr-ttg5) and the live rung (fr-hith),
    // and the two change independently. A finer rung resolves smaller
    // pixels, so it must trace deeper or its unresolved core becomes a
    // visible blob — see previewMaxDepth.
    u.uMaxDepth.value = preview
      ? previewMaxDepth(
          this.surfaceFullMaxDepth,
          this.surfacePreviewGovernor.scale,
        )
      : this.surfaceFullMaxDepth;
    u.uMarchSteps.value = preview
      ? SURFACE_PREVIEW_MARCH_STEPS
      : SURFACE_FULL_MARCH_STEPS;
    u.uShadowSteps.value = preview
      ? SURFACE_PREVIEW_SHADOW_STEPS
      : SURFACE_FULL_SHADOW_STEPS;
    u.uAoTaps.value = preview ? SURFACE_PREVIEW_AO_TAPS : SURFACE_FULL_AO_TAPS;
    u.uHitFloor.value = preview
      ? SURFACE_PREVIEW_HIT_FLOOR
      : SURFACE_FULL_HIT_FLOOR;
  }

  /**
   * Render strips of the in-flight job into the settle target until about
   * `budgetMs` of MEASURED GPU time is spent (Infinity = run to
   * completion, the sync path). The 1x1 readback after each strip is the
   * point, not an accident: a readback of freshly rendered pixels is a
   * DATA DEPENDENCY, so it cannot return before the strip's draws
   * complete — it is what bounds every submission (the watchdog fix) and
   * what produces the true measurement the planner sizes the next strip
   * with. `gl.finish()` is deliberately NOT used: some command-buffer
   * paths return from it before execution (observed on
   * Chromium+SwiftShader), which would silently batch every strip back
   * into the one giant unbounded submission this mechanism exists to
   * prevent. Returns true (and disarms the job) when all rows are traced.
   */
  private renderSurfaceStrips(budgetMs: number): boolean {
    const job = this.surfaceStripJob;
    if (!job) return true;
    const done = this.pumpStrips(job, this.surfaceSettleTarget, budgetMs);
    if (done) {
      this.retireStripJob(job);
      if (SURFPERF) {
        const t = this.surfaceSettleTarget;
        console.log(
          `[surfperf] settle complete ${t.width}x${t.height}` +
            ` spentMs=${job.spentMs.toFixed(1)}`,
        );
      }
      this.surfaceStripJob = null;
    }
    return done;
  }

  /**
   * The shared strip pump under both the settle job and the preview job
   * (fr-du81): render strips of `job` into `target` until about `budgetMs`
   * of MEASURED GPU time is spent (Infinity = run to completion, the sync
   * capture path). Returns true when every row is traced AND accounted.
   *
   * Two pacing regimes, chosen per strip by its PREDICTED cost (the
   * previous strip's measurement — the planner sizes strips toward a
   * constant target, so it is the best available estimate):
   *
   * - CHEAP strips join synchronously: render, then a forced-completion
   *   1x1 readback — a data dependency no driver can fake (`gl.finish()`
   *   returns early on some command-buffer paths) — which yields the
   *   strip's true GPU cost for the planner and keeps submissions from
   *   batching unbounded. Several strips run per call up to the budget:
   *   on healthy devices this is the whole job in one call, behaviorally
   *   the pre-fr-du81 frame.
   * - HEAVY strips (predicted above {@link SURFACE_STRIP_SYNC_JOIN_CAP_MS};
   *   fold systems on weak GPUs sit here, pinned at few-pixel strips
   *   that still run whole seconds — fr-096u measured single crease
   *   pixels at 1.7-3.1s on Iris)
   *   would stall the main thread for their whole duration inside that
   *   readback, so they are submitted with a FENCE and polled: one strip
   *   in flight, `clientWaitSync(…, 0)` per call, the wall-clock from
   *   submission to the poll that observes completion as the measurement
   *   (rAF-quantized and slightly high — which only makes the planner
   *   more conservative). The page keeps animating between polls where it
   *   used to freeze in ~strip-length chunks. The probe strip (no
   *   prediction yet) always joins synchronously — sized from the
   *   planner's cost prior (fr-096u) it plans ~one strip target of GPU,
   *   so its one blocking join is affordable, and everything after it is
   *   calibrated.
   *
   * The capture path (budget Infinity) never uses fences: it must
   * complete synchronously, and its callers tolerate the stalls.
   */
  private pumpStrips(
    job: SurfaceStripJob,
    target: THREE.WebGLRenderTarget,
    budgetMs: number,
  ): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (job.pending) {
      const status = gl.clientWaitSync(job.pending.sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return false;
      // Signaled (or WAIT_FAILED on a dying context — treat as done
      // rather than polling forever): account the strip.
      gl.deleteSync(job.pending.sync);
      job.lastStripMs = performance.now() - job.pending.submittedAt;
      job.spentMs += job.lastStripMs;
      if (SURFPERF && job.lastStripMs > SURFPERF_HEAVY_STRIP_MS) {
        console.log(
          `[surfperf] heavy strip px=${job.pending.px}` +
            ` ms=${job.lastStripMs.toFixed(0)} (fenced)`,
        );
      }
      job.pending = null;
    }
    let spent = 0;
    let strip = job.planner.next(job.lastStripMs);
    while (strip) {
      const fencePaced =
        budgetMs !== Infinity &&
        job.lastStripMs !== null &&
        job.lastStripMs > SURFACE_STRIP_SYNC_JOIN_CAP_MS;
      target.scissorTest = true;
      const t0 = performance.now();
      // A strip is a row-major pixel interval, tiled by 1-3 scissor rects
      // (fr-096u: sub-row strips are what let the planner bound fold
      // submissions below one row's cost). All of a strip's rects go into
      // the ONE submission the fence/readback below closes — the bounded
      // quantity is the strip's pixel count, which the planner sized.
      for (const r of strip.rects) {
        target.scissor.set(r.x, r.y, r.w, r.h);
        // setRenderTarget re-applies the target's scissor each call — the
        // r185 idiom for scissored render-target draws.
        this.renderer.setRenderTarget(target);
        this.surfaceQuad.render(this.renderer);
      }
      const last = strip.rects[strip.rects.length - 1];
      if (fencePaced) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          // The flush hands the strip to the GPU now — without it the
          // fence may not signal until the browser's own end-of-frame
          // flush, double-counting a frame of latency.
          gl.flush();
          job.pending = { sync, px: strip.px, submittedAt: t0 };
          break;
        }
        // fenceSync failing (lost/dying context) degrades to the
        // blocking join below — correctness over smoothness.
      }
      // Forced-completion sync + measurement (see the method doc). Reads
      // a corner of the strip's LAST rect while the target is still
      // bound — freshly written pixels, so the read is a data dependency
      // on the whole strip.
      gl.readPixels(
        last.x,
        last.y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        SYNC_PIXEL,
      );
      job.lastStripMs = performance.now() - t0;
      if (SURFPERF && job.lastStripMs > SURFPERF_HEAVY_STRIP_MS) {
        console.log(
          `[surfperf] heavy strip px=${strip.px}` +
            ` ms=${job.lastStripMs.toFixed(0)}`,
        );
      }
      job.spentMs += job.lastStripMs;
      spent += job.lastStripMs;
      if (spent >= budgetMs) break;
      strip = job.planner.next(job.lastStripMs);
    }
    target.scissorTest = false;
    target.scissor.set(0, 0, target.width, target.height);
    this.renderer.setRenderTarget(null);
    return job.planner.done && !job.pending;
  }

  /** Drop a job's in-flight fence, if any, so an abandoned job cannot leak
   * the sync object. */
  private releaseStripJob(job: SurfaceStripJob | null): void {
    if (!job?.pending) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.deleteSync(job.pending.sync);
    job.pending = null;
  }

  /** Stretch `src` over `target` (null = the canvas) via the shared blit
   * quad. */
  private blitSurface(
    src: THREE.Texture,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.surfaceBlitMaterial.uniforms.uSrc.value = src;
    this.renderer.setRenderTarget(target);
    this.surfaceBlitQuad.render(this.renderer);
    this.renderer.setRenderTarget(null);
  }

  /**
   * Save-PNG source while the surface render is active: render synchronously
   * right before the read so the drawing buffer is intact, exactly like
   * {@link captureSolidFrame} — one bigger frame is just more rays (and
   * {@link renderSurface}'s per-call pixel epsilon means the export traces
   * at export resolution, not the screen's).
   */
  captureSurfaceFrame(exportScale = 1): Promise<ExportImage | null> {
    return this.withPixelRatio(this.exportPixelRatio(exportScale), () =>
      this.withCenteredProjection(() => {
        this.renderSurface();
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
/** Scratch for `renderSurface`'s per-call drawing-buffer query. */
const DRAW_SIZE = new THREE.Vector2();
/** Measured GPU time (ms) each async settle step spends tracing strips —
 * roughly one strip at the planner's target, several when they come in
 * cheaper. Low enough that the page stays responsive (and interruptible)
 * while a heavy frame settles over many animation frames. */
const SURFACE_SETTLE_STEP_BUDGET_MS = 40;
/** Predicted full-tier frame cost (ms, extrapolated from the completed
 * preview's measured per-pixel cost) above which the WebGL settle job
 * never arms (fr-096u): the preview-seeded settle target stands in as the
 * settled frame. The preview measurement UNDERSTATES the full tier
 * (deeper depth clamp, bigger march/shadow/AO budgets, ~4-6x measured),
 * so 15s here means a real frame of a minute at the very least — beyond
 * what a parked view's background job should grind through on the
 * fallback path, and on fold systems the poses that trip this measure in
 * HOURS with GPU-watchdog roulette on every band-transition strip. The
 * WebGPU compute path (the preferred fold tracer) has its own bounded
 * economics and no such gate. */
const SURFACE_SETTLE_SKIP_CEILING_MS = 15_000;
/** Measured GPU time (ms) each preview strip aims for (fr-du81) — well
 * under the settle tier's 75 so strips interleave with a live drag: a
 * preview frame's budget below fits two of these plus the probe. */
const SURFACE_PREVIEW_STRIP_TARGET_MS = 12;
/** Measured GPU time (ms) a preview job may spend per animation frame —
 * roughly the ~30fps interaction budget the preview governor targets
 * (fr-hith's PREVIEW_TARGET_MS). Light systems finish a whole preview
 * far inside it, so the arm+step call collapses to the old single-frame
 * behavior; heavy systems present partial progress and continue next
 * frame instead of handing the GPU one unbounded submission (fr-du81). */
const SURFACE_PREVIEW_STEP_BUDGET_MS = 30;
/** Predicted strip cost (ms) above which the strip pump switches from the
 * blocking forced-completion join to fence-paced submission (fr-du81). A
 * strip predicted under this joins synchronously — exact measurement,
 * whole-job-in-one-frame behavior on healthy devices; above it the join
 * itself would freeze the main thread for the strip's whole GPU duration
 * (fold systems on weak GLs run multi-second few-pixel strips), so the pump
 * fences and polls instead. Sits above both tiers' strip targets, so
 * fence pacing only ever engages when the planner is ALREADY pinned at
 * its 1-row floor and cannot size the strip down any further. */
const SURFACE_STRIP_SYNC_JOIN_CAP_MS = 150;

/** An in-flight strip job over one of the surface targets: the planner,
 * the previous strip's measurement (the planner's sizing input), the
 * job's accumulated measured cost (the preview governor's sample on
 * completion), and the fence of a heavy strip submitted but not yet
 * observed complete (see pumpStrips' pacing regimes). */
interface SurfaceStripJob {
  planner: StripPlanner;
  lastStripMs: number | null;
  spentMs: number;
  pending: { sync: WebGLSync; px: number; submittedAt: number } | null;
}
/** Scratch for the strip renderer's forced-completion 1x1 readbacks. */
const SYNC_PIXEL = new Uint8Array(4);

/** `?surfperf` (fr-ck0w): diagnostics-only opt-in, the surface twin of
 * main.ts's `?flameperf`. When present, every completed surface strip job
 * logs its accumulated MEASURED GPU cost (`spentMs` — per-strip
 * forced-completion/fence timings, the planner's own bookkeeping), which
 * lets external sweeps (the fold beam-width spill probe) read
 * settled-frame trace cost from the console without new plumbing. */
const SURFPERF =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("surfperf");
/** `?surfperf` also logs any single strip whose MEASURED cost exceeded
 * this (ms) — the field signal for fr-096u's watchdog class: a healthy
 * planner never plans a strip past `STRIP_WORST_CASE_CAP_MS` of
 * worst-case cost, so a heavy-strip log is either the bounded
 * cheap-to-expensive transition (expected, rare, ~seconds at most) or
 * evidence the priors are wrong on this hardware. */
const SURFPERF_HEAVY_STRIP_MS = 500;

/** Resize a render target only when the wanted size differs — `setSize`
 * reallocates, so per-frame calls must be no-ops at steady state. */
function sizeTarget(
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): void {
  if (target.width !== width || target.height !== height) {
    target.setSize(width, height);
  }
}

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
