import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { shearMatrix } from "../fractal/affine";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
} from "../fractal/balloon-de";
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
import { contextAntialias } from "./constants";
import { predictCaptureMs, solidCaptureMsPerPx } from "./capture-cost";
import {
  backgroundGradientsEqual,
  DEFAULT_BACKGROUND,
  resolveBackground,
} from "./background";
import type { BackgroundGradient } from "./background";
import { rgbToHex } from "../fractal/palette";
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
  setBulbSystem as packBulbSystem,
  setEscapeSystem as packEscapeSystem,
  setSurfaceBalloon as packSurfaceBalloon,
  setSurfaceGroundPlane as packSurfaceGroundPlane,
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
import type { SurfaceGroundPlaneSpec } from "./surface-material";
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
  STRIP_WORST_CASE_CAP_MS,
  type Strip,
  type StripPlanner,
} from "./strip-planner";
import {
  createSurfaceMaterial4,
  setSurfaceSystem4 as packSurfaceSystem4,
  setSurfaceView4 as packSurfaceView4,
} from "./surface-material-4d";
import type { EscapeDE } from "../fractal/escape-de";
import { ESCAPE_TIME_ITERATIONS } from "../fractal/escape-de";
import type { BulbDE } from "../fractal/bulb-de";
import { BULB_ITERATIONS } from "../fractal/bulb-de";
import type { SurfaceDE } from "../fractal/surface-de";
import { surfaceDescentCostWeight } from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import type { SurfaceGrid } from "../fractal/surface-grid";
import { SURFACE_COLOR_SOURCES } from "./state";
import type { SurfaceParams } from "./state";
import { unmaskedWebglRenderer } from "./render-backend";
import type { SurfaceComputeFrameSpec } from "./surface-compute";
import {
  fitSurfaceComputeRaster,
  subPixelSample,
  surfaceComputeBandStops,
  surfaceComputeTileRows,
} from "./surface-compute";

// Authored point/guide colors are already sRGB, so render them verbatim
// instead of running Three.js's sRGB<->linear conversions.
THREE.ColorManagement.enabled = false;

/** Midpoint of a backdrop's two stops — the single color that best stands in
 * for a vertical gradient across the whole frame. Numeric Color constructor
 * on purpose: it never applies color-space conversion. */
function backdropMidpoint(stops: BackgroundGradient): THREE.Color {
  const { top, bottom } = stops;
  return new THREE.Color(
    (top[0] + bottom[0]) / 2,
    (top[1] + bottom[1]) / 2,
    (top[2] + bottom[2]) / 2,
  );
}

// The fog color is derived from the ACTIVE backdrop gradient rather than
// authored separately, so fogged points always veil toward what's actually
// behind them and can't drift when the backdrop changes (fr-1lj) — since
// fr-5ps1 that includes the live Background control: setBackground recomputes
// the midpoint on every backdrop change.
const FOG_MARGIN = 1.2;

// Authored base point size per render style. The UI scales all of them by a
// single multiplier (see {@link FractalScene.setPointSize}) so each style keeps
// its own relative tuning as the user dials the cloud up or down.
const BASE_POINT_SIZE = 0.02; // depthFade + aerial
const DISC_POINT_SIZE = 0.025; // edl
const GLOW_POINT_SIZE = 0.042; // glow
const DOF_POINT_SIZE = 0.024; // dof
// The balloon echo (fr-5wlv.2, see setBalloonEchoEnabled): its own fixed
// point size and color-dim multiplier — deliberately NOT wired into
// setPointSize's per-style scaling, so the echo reads as a distinct, dimmer
// backdrop cloud regardless of the main cloud's point-size slider.
const BALLOON_ECHO_POINT_SIZE = 0.016;
const BALLOON_ECHO_DIM = 0.5;
/** Ground plane (fr-rhn5) geometry, in multiples of the session ball's
 * radius — the ONE place the floor's shape is decided; both the GLSL
 * uniforms and the compute frame spec derive from these through
 * {@link FractalScene.setSurfaceGroundPlane}'s spec. The drop keeps the
 * floor >= 1.02 R below the ball CENTER, the bound the tracers' analytic
 * shadow-skip certificates assume; the fade band ends the "infinite"
 * floor in the pixel's own backdrop long before any disc edge could
 * show, and bounds which missed rays the compute march classifies as
 * plane work. */
const GROUND_PLANE_DROP = 1.02;
const GROUND_PLANE_FADE_START = 4;
const GROUND_PLANE_FADE_END = 10;
/** sRGB floor albedo: a neutral studio grey so the penumbra reads on any
 * backdrop (a floor matching a dark backdrop would swallow the shadow
 * that is this feature's point). */
const GROUND_PLANE_ALBEDO: Vec3 = [0.62, 0.62, 0.62];
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
 * Paint a top→bottom two-stop gradient across a whole canvas — the one
 * gradient-drawing routine the backdrop texture, the flame capture underlay
 * and the thumbnail underlay share (fr-5ps1), so no capture path can render
 * a different ramp than the live scene. Authored in sRGB and left
 * unconverted to match the rest of the pipeline (ColorManagement is off);
 * canvas gradients interpolate in the same space.
 */
function paintBackdropGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stops: BackgroundGradient,
): void {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, rgbToHex(stops.top));
  g.addColorStop(1, rgbToHex(stops.bottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
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

// The balloon echo (fr-5wlv.2 — epic fr-5wlv, the sphere-inverted "cave"
// twin of the explorer cloud): each vertex inverts the SAME shared position
// buffer about the cloud's enclosing ball, `I(p) = c + R²(p−c)/|p−c|²` (see
// fractal/balloon-de.ts's module doc for the distance-bound math the render
// mirrors nothing of — this is a plain per-vertex position remap, not a
// distance estimator). Point-size attenuation is DOF_VERTEX's formula
// verbatim; blending is the additive, non-depth-writing recipe fourDMaterial
// uses below (see its own construction), so overlapping echo points glow
// together instead of z-fighting — appropriate for a cloud that is, by
// construction, always "behind" (renderOrder -1) the main one.
const BALLOON_ECHO_VERTEX = /* glsl */ `
  uniform vec3 uEchoCenter;
  uniform float uEchoR;
  uniform float uEchoFloor2;
  uniform float uEchoFadeStart;
  uniform float uEchoFadeEnd;
  uniform float uEchoDim;
  uniform float uSize;
  uniform float uHalfHeight;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec3 d = position - uEchoCenter;
    float r2 = max(dot(d, d), uEchoFloor2);
    vec3 inv = uEchoCenter + (uEchoR * uEchoR / r2) * d;

    // Radial fade to nothing well before uEchoFadeEnd (the same
    // BALLOON_FAR_CAP_RHO horizon the DE march caps rays at, see
    // syncBalloonEchoUniforms): an unbounded inversion would otherwise
    // scatter near-center points arbitrarily far away as R sweeps through
    // them. vFade carries the fade into the fragment alpha; multiplying it
    // into vColor too means a fully-faded point is cheap even before the
    // fragment's own discard — additive blending contributes exactly zero.
    float rr = length(inv - uEchoCenter);
    float fade = 1.0 - smoothstep(uEchoFadeStart, uEchoFadeEnd, rr);

    // The inversion's own local conformal magnification at the image,
    // rr²/R²: the cave wall's copy of an arm is that arm magnified, so its
    // points must scale with it or the resting shell (image area grows as
    // the magnification squared) dissolves into unreadable dust. Clamped:
    // shrunken images (early inflation's crumpled ball) keep a visible
    // floor, and images racing toward the fade horizon can't become
    // screen-filling monsters. Brightness divides by the same factor
    // (floored at 1 — never brightened): a magnified copy spreads its
    // light, and without the dilution the additive wall blows out to
    // white where its enlarged points overlap.
    float mag = clamp(rr * rr / (uEchoR * uEchoR), 0.35, 8.0);
    vColor = color * (uEchoDim / max(mag, 1.0)) * fade;
    vFade = fade;

    // DOF_VERTEX's size-attenuation formula, minus its circle-of-confusion
    // term — the echo has no focal plane of its own — times the conformal
    // magnification above.
    vec4 mv = modelViewMatrix * vec4(inv, 1.0);
    float dist = -mv.z;
    gl_PointSize = uSize * mag * (uHalfHeight / dist);
    gl_Position = projectionMatrix * mv;
  }
`;

// DOF_FRAGMENT's circular-sprite alpha shaping (a soft dot, not a hard
// square point), with the vertex shader's radial fade multiplied in on top
// of it.
const BALLOON_ECHO_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float r = length(2.0 * gl_PointCoord - 1.0);
    float a = smoothstep(1.0, 0.25, r) * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
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
  // The balloon echo (fr-5wlv.2): a second Points object SHARING
  // pointGeometry by reference (see BALLOON_ECHO_VERTEX's header) — setPoints
  // replacing its attributes updates both clouds for free. Created once,
  // toggled with `.visible` (see syncBalloonEchoVisibility), exactly like
  // replayCursor above. `balloonEchoEnabled`/`balloonEchoRadius` are the raw
  // checkbox/slider state the two public setters record; the derived
  // uEcho* uniforms live on balloonEchoMaterial and are re-derived by
  // syncBalloonEchoUniforms whenever either one — or the cloud's own
  // enclosing ball — changes.
  private readonly balloonEchoPoints: THREE.Points;
  private balloonEchoEnabled = false;
  // Normalized multiple of the cloud's enclosing-ball radius (see
  // fractal/balloon-de.ts's buildBalloon). Mirrors state.ts's
  // DEFAULT_BALLOON_RADIUS as a plain literal rather than an import — the
  // balloon echo is off by default (this value is inert until
  // setBalloonEchoEnabled(true)), and control-spec.ts's checkbox effect
  // pushes the real slider value the moment it turns on.
  private balloonEchoRadius = 1.6;
  // Depth-fog density multiplier (fr-5h5d): scales the fog distance unit
  // for this.fog (updateFog), the balloon echo's radial fade
  // (syncBalloonEchoUniforms), and both surface tracers' uFogDensity — see
  // setFogDensity. Mirrors state.ts's DEFAULT_FOG_DENSITY as a plain
  // literal rather than an import, exactly like balloonEchoRadius above;
  // main.ts pushes the real (possibly-restored) value at boot and on
  // every snapshot load regardless, so this default only matters for the
  // instant before that first push.
  private fogDensity = 1;
  // Fog tint (fr-5h5d): rgb01 color + 0..1 strength shifting what depth
  // fog blends toward, applied AFTER the fr-1lj midpoint derivation
  // (applyFogColor) and pushed to the three fog-bearing materials — see
  // setFogTint. Mirrors state.ts's defaults as plain literals exactly
  // like fogDensity above; strength 0 is the untinted identity.
  private fogTint: [number, number, number] = [1, 1, 1];
  private fogTintStrength = 0;
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
  private readonly balloonEchoMaterial: THREE.ShaderMaterial; // balloon echo (fr-5wlv.2)
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
  // The scene backdrop (fr-5ps1): ONE mutable canvas-backed gradient texture,
  // repainted in place by setBackground — every render style shows it, and
  // the flame composite / capture underlays / compute frame spec all read the
  // same `backdrop` stops, so no path can disagree about what's behind the
  // attractor.
  private backdrop: BackgroundGradient = resolveBackground(DEFAULT_BACKGROUND);
  private readonly backdropCanvas: HTMLCanvasElement;
  private readonly backdropCtx: CanvasRenderingContext2D | null;
  private readonly backdropTexture: THREE.CanvasTexture;
  // The flame mode's underlay quad — renderFlame draws it first, then the
  // screen-blended flame quad on top (see renderFlame's doc).
  private readonly backdropQuad: FullScreenQuad;

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
  /**
   * Measured per-pixel cost (ms) of the last COMPLETED
   * {@link captureSolidFrame} — the solid twin of
   * {@link surfaceFullPxCostMs} (fr-2q01), and the only evidence
   * {@link predictSolidCaptureMs} answers from. Null until an export has
   * run, and again the moment anything below makes the last one a lie.
   *
   * SIMPLER than the surface twin, not merely analogous, and a reader
   * should not go looking for the missing subtraction: a solid capture is
   * ONE synchronous raymarch, so its wall IS its cost — no batch
   * attribution over strips, no `SURFACE_STRIP_SYNC_TAX_MS` to take back
   * out, and nothing partial to discard, because the draw either happened
   * whole or the export produced no image at all. The wall covers the
   * WHOLE export — buffer resize, march, readback, PNG encode — which is
   * exactly the duration the export modal is deciding about.
   *
   * STALE WHEN THE MARCH'S OWN WORK CHANGES, which is two things and not
   * the solid render's whole settings surface:
   *  - {@link setVoxelGrid}: the grid's resolution sets `uMarchSteps`
   *    (fr-2ul deliberately scales stride count with it) and its density
   *    field decides where each ray breaks out of that loop. A new volume
   *    is a new cost, in both factors at once.
   *  - {@link setSolidParams}: `uThreshold` IS the break condition of the
   *    primary march and the shadow march both — raise it and every ray
   *    travels further before anything stops it. Ambient and the light
   *    direction ride the same setter while changing no loop count;
   *    splitting them out would only buy a stale reading the right to
   *    survive an edit nobody makes on its own.
   * SURVIVES A POSE CHANGE, and that is the load-bearing decision here
   * rather than an omission. The pose genuinely re-prices a solid ray —
   * the span runs from "off screen, every ray a miss" to "filling the
   * frame, every ray running the full loop" — so clearing on
   * {@link applyCamera} is defensible on accuracy grounds, and was the
   * first thing tried. It is wrong anyway, for two reasons.
   *
   * First, it is accuracy this decision cannot spend. The reading feeds
   * ONE coarse question — is this export longer than the modal's grace
   * period — and the measured span between a 320x240 scale-2 export and a
   * 1920x1080 one is 3ms against 4482ms, about 1500x. A pose that
   * re-prices a ray by 2x or 5x still lands the same side of that
   * threshold nearly always.
   *
   * Second, clearing costs the bead itself. Open a scene, ORBIT to frame
   * the shot, Save PNG — the ordinary sequence — would then arrive with
   * no evidence every single time, fall back to the `scale > 1`
   * heuristic, and flash the modal on a 274ms export exactly as before.
   * The win would narrow to "two exports from a pixel-identical pose",
   * which is not how anyone uses it.
   *
   * The precedent agrees. The surface path keeps BOTH kinds and
   * distinguishes them by role: `surfacePreviewPxCostMs` is a PRIOR that
   * deliberately SURVIVES pose moves, while the strip evidence CHAIN
   * deliberately dies on them, because a superseded job means the pose
   * moved on. This field is a prior — there is no chain behind it — so it
   * survives.
   *
   * And the risk is far smaller than it looks, which is what turns this
   * from a gamble into the plainly right answer: AN UNDER-PREDICTION
   * CANNOT LOSE THE MODAL. `predictedMs` decides one thing — whether to
   * SKIP the grace period — and a value below the threshold, null
   * included, still arms `export-progress.ts`'s grace timer, which still
   * shows the modal {@link EXPORT_MODAL_GRACE_MS} in. So a pose change
   * into much heavier geometry costs exactly one grace period of extra
   * silence on an export that then discloses itself normally, and
   * self-corrects at the next capture. OVER-prediction is the direction
   * with teeth — a modal flashed over a 274ms export — and an absent
   * reading falling back to `scale > 1` produces it every time. The two
   * errors are not symmetric, so the field should survive everything it
   * plausibly can.
   *
   * {@link resize} survives for the same reason and a stronger one: the
   * field is per-PIXEL, so the pixel count is already the prediction's
   * own multiplier, and aspect's re-apportioning of rays is second order
   * beside it.
   *
   * Deliberately NOT cleared either by the adaptive resolution scale or the
   * panel inset — a capture overrides both ({@link withPixelRatio},
   * {@link withCenteredProjection}), so neither can reach it — nor by
   * fog, backdrop or lighting colour, which are per-pixel arithmetic at a
   * fixed instruction count. And deliberately not FED by
   * {@link captureThumbnail}'s solid arm: that marches at the live ratio
   * and spends most of its wall in the downscale and the JPEG encode, so
   * its ms/px is a different quantity wearing the same units.
   */
  private solidCapturePxCostMs: number | null = null;

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
  /** Last slab half-thickness pushed alongside {@link surface4W0} (fr-wa6o),
   * in the same world w units — part of the same equality guard. */
  private surface4HalfW = NaN;
  /** The 3D empty-space-skipping grid texture (fr-55r5 part 2) the march
   * samples before paying a descent, or null while none is uploaded —
   * gridless marching is always correct, just slower. Owned here (created
   * in {@link setSurfaceGrid}, disposed on every system change and on the
   * next upload); the material only holds uniforms into it. */
  private surfaceGridTexture: THREE.Data3DTexture | null = null;
  /** The surface balloon (fr-5wlv.4): the DE ball of the INSTALLED 3D
   * surface system — balloonBall(de) for IFS systems, the origin-centered
   * bailout ball for escape systems — recorded by
   * {@link setSurfaceSystem}/{@link setEscapeSystem} so
   * {@link setSurfaceBalloon} can derive the uniform spec from whatever
   * system is actually live (and a new install re-derives under a stored
   * on flag). Null until the first 3D surface install; the 4D install
   * path neither stores nor applies (the variant only exists in the 3D
   * material — fr-5wlv's 4D lift is a later child). */
  private surfaceBalloonBall: { center: Vec3; radius: number } | null = null;
  private surfaceBalloonOn = false;
  /** The ground plane's session ball (fr-rhn5): balloonBall(de) for IFS
   * installs, the origin bailout ball for escape — a SEPARATE field from
   * {@link surfaceBalloonBall} because escape sessions null that one
   * (the balloon degenerates there) while the classic Mandelbox floor is
   * exactly an escape session's look. Null until a 3D surface install;
   * 4D installs null it (the floor's 4D lift is out of fr-rhn5's scope). */
  private surfaceGroundBall: { center: Vec3; radius: number } | null = null;
  /** The persisted Floor toggle's stored intent (fr-rhn5), pushed by
   * {@link setSurfaceGroundPlane} and re-asserted against the installed
   * system after every install/toggle — the {@link surfaceBalloonOn}
   * discipline. The material define may sit BELOW this intent (the
   * balloon variant refuses the plane arm); the intent survives so the
   * floor returns when the balloon leaves. */
  private surfaceGroundPlaneOn = false;
  /** Normalized balloon radius (multiples of the raw ball radius —
   * buildBalloon's rMult). 1.6 mirrors {@link balloonEchoRadius}'s inert
   * default; main.ts overwrites it before it can matter. */
  private surfaceBalloonRMult = 1.6;
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
   * to completion synchronously (offline export, thumbnails), and
   * {@link captureSurfaceFrame} drains them while yielding (fr-7mfx). */
  private readonly surfaceSettleTarget: THREE.WebGLRenderTarget;
  /** In-flight strip job over {@link surfaceSettleTarget}, or null. */
  private surfaceStripJob: SurfaceStripJob | null = null;
  /** Passes the ACTIVE {@link surfaceSettleTarget} sequence wants (fr-jf9y)
   * — {@link SURFACE_STRIP_SETTLE_SAMPLES} for a settle or an interactive
   * Save-PNG, 1 for everything else, which is every path that existed
   * before supersampling. */
  private surfaceSampleTotal = 1;
  /** Which pass of that sequence is IN FLIGHT (0-based). */
  private surfaceSampleIndex = 0;
  /** Passes already folded into {@link surfaceSampleAccum}. */
  private surfaceSampleTaken = 0;
  /** Linear-light sum of the completed passes, 3 floats per pixel
   * (fr-jf9y). f32 rather than a float render target: this arm is the
   * FALLBACK one — no adapter, `?surfacegl`, a lost device — so it may
   * not assume `EXT_color_buffer_float`, and the sum then costs no
   * precision at all. See {@link foldSurfaceSample} for where the gamma
   * decode happens and why. */
  private surfaceSampleAccum: Float32Array | null = null;
  /** RGBA8 scratch the passes read back into and the mean is encoded back
   * into — the {@link surfaceSampleTexture}'s own storage, so a pass costs
   * one readback and one upload, no intermediate copy. */
  private surfaceSampleTexture: THREE.DataTexture | null = null;
  /** Frame the sequence's buffers are sized for. */
  private surfaceSampleWidth = 0;
  private surfaceSampleHeight = 0;
  /** Whether {@link surfaceSampleTexture} currently holds a mean of two or
   * more completed passes — i.e. whether it, rather than the settle
   * target, is the image this surface last presented. */
  private surfaceSampleMeanReady = false;
  /** True while {@link captureSurfaceFrame}'s yielding drain owns
   * {@link surfaceSettleTarget} and the full-tier uniforms — see
   * {@link surfaceCaptureBusy} for who has to respect it. */
  private surfaceCaptureFlight = false;
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
  /** In-flight fences a superseded/abandoned strip job left behind
   * (fr-7to5), awaiting adoption by the next job to arm. Deleting them
   * (the old behavior) forgot that the submitted GPU work still executes
   * FIFO ahead of everything a successor submits: the successor's refill
   * ceiling under-counted the queue (each re-arm in a drag burst stacked
   * another mispriced probe behind the grinding backlog) and its FIRST
   * fence attributed the whole backlog's GPU time to its own strip's
   * pixels (measured ~90x on the fr-b8o5 kaleido4 leg), poisoning the
   * preview px-cost field and the settle's evidence caps. Pooled entries
   * keep submission order — everything rides the ONE GL queue — and
   * `busyMark` keeps the oldest job's busy continuity so the successor's
   * first batch attributes over backlog + own pixels. Adopted at
   * {@link armSurfacePreview}/{@link beginSurfaceSettle}/
   * {@link beginSurfaceFullFrame} arm time; a system upload flushes
   * instead (cross-system observations must not seed a fresh evidence
   * chain). */
  private surfaceStripBacklog: {
    entries: { sync: WebGLSync; px: number }[];
    px: number;
    busyMark: number;
    /** Predicted GPU cost (ms) of `px` at the pooling jobs' own estimates
     * — the bound on how much busy wall this pool can honestly still owe
     * (fr-y6m0). A pool has a timestamp, not a clock: nothing observes it
     * while it waits, so an adoption minutes later would otherwise carry
     * a busy origin from work that finished in the first second, and the
     * adopting job's first batch would read (and TEACH) that whole idle
     * wall as trace cost. */
    predictedMs: number;
  } | null = null;
  /** Scene holding a throwaway mesh that shares the active surface
   * material, for {@link compileSurfaceMaterial}'s async program compile
   * (fr-du81). Lazily built once. */
  private surfaceCompileScene: THREE.Scene | null = null;
  private surfaceCompileMesh: THREE.Mesh | null = null;
  /** Measured per-pixel cost (ms) of the FRESHEST preview evidence for
   * the current system — the last completed preview trace, or a
   * superseded job's partial attribution when a re-arm interrupted one
   * that had measured (fr-b8o5: fresher pose wins; see
   * {@link armSurfacePreview}) — or null before any. SIZES the next
   * job's probe strip (fr-096u: the planner turns a prior into a
   * pixel-bounded probe), so a heavy DE's first submission is target-sized
   * from its very first strip, and prices the pipelined queue's est-side
   * admission. Reset with the governor on every system upload — a new DE
   * is a new cost profile. */
  private surfacePreviewPxCostMs: number | null = null;
  /** Measured per-pixel cost (ms) of the last COMPLETED full-tier frame —
   * a finished settle job or a finished capture drain — for the CURRENT
   * pose, or null. The capture cost ceiling's best predictor (fr-id9r):
   * unlike {@link surfacePreviewPxCostMs} it needs no tier-gap scaling.
   * Cleared wherever the pose-validity of a settle dies — every
   * {@link abandonSurfaceSettle} (each preview invalidation lands there)
   * and every system upload — so it can never price a moved pose. */
  private surfaceFullPxCostMs: number | null = null;
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
  /** Worst per-pixel strip cost (ms) observed by the most recent COMPLETED
   * strip job (null before any) — the fr-096u evidence chain: a completed
   * job traced its WHOLE frame, so its observation REPLACES the class
   * floor in both directions (scaled by
   * {@link STRIP_WORST_EVIDENCE_SAFETY}). Downward matters as much as up:
   * the fold-class floor is calibrated for deep-KIFS monsters, and pinning
   * a measured-cheap fold system (a lens over affine cores) to it forever
   * would dissolve its settle into tens of thousands of readback-bound
   * micro-strips — and feed the settle cost gate an overhead-inflated
   * prediction that silently skips a perfectly affordable frame (the
   * fr-096u review regression). Reset on every system upload. */
  private surfaceStripEvidencedWorstMsPerPx: number | null = null;
  /** Worst per-pixel strip cost (ms) observed by PARTIAL (superseded) jobs
   * since the last completed one (0 = none). Partial coverage can prove a
   * pose expensive but never cheap, so this only ever RAISES the floor —
   * a monster pose discovered mid-job cannot be re-rouletted by the
   * re-armed successor — and the next completed job's whole-frame
   * evidence clears it. Reset on every system upload. */
  private surfaceStripPartialWorstMsPerPx = 0;
  /** Whether the ACTIVE surface session renders on the WebGPU compute path
   * (fr-tzdg) — set by {@link enterSurfaceComputeSession}. While true the
   * fold GLSL is never compiled: {@link renderSurface} degrades to a
   * re-present so a stray call cannot trigger the ~25s Mesa link the
   * compute path exists to avoid, and {@link captureThumbnail} reads the
   * last presented frame instead of tracing. */
  private surfaceComputeActive = false;
  /** Whether that compute session is the 4D kind (fr-dlxh's 4D cut) —
   * set by {@link enterSurfaceCompute4Session}. While true every frame
   * spec carries the live rotor/slice view4 for the affine4 kernel's
   * params tail (per-frame, the fragment tracer's live-uniform
   * discipline across the WebGPU seam). */
  private surfaceCompute4 = false;
  /** Whether that compute session's kernels carry the balloon
   * inverted-union wrapper (fr-5wlv.5) — the SESSION's record, frozen at
   * {@link enterSurfaceComputeSession} beside the create-target's flag,
   * deliberately distinct from the live {@link surfaceBalloonOn} toggle:
   * a balloon kernel's 320-byte params struct needs the spec's balloon
   * block on EVERY frame of the session, however the toggle moves before
   * the restart lands (a toggle flip re-enters the session with fresh
   * kernels). While true every frame spec carries the live
   * center/rho/R/far block re-derived from the stored ball + rMult —
   * the R slider's per-frame door, view4's discipline. */
  private surfaceComputeBalloon = false;
  /** Whether the ACTIVE compute session's kernels carry the ground-plane
   * arm (fr-rhn5) — the {@link surfaceComputeBalloon} discipline:
   * created-with is what the 336-byte params struct needs on EVERY frame
   * of the session, however the toggle moves before the restart lands.
   * While true every frame spec carries the live floor block re-derived
   * from the stored ball. */
  private surfaceComputeGroundPlane = false;
  /** Rays the ACTIVE compute session's device can trace as ONE frame
   * (fr-biox) — `SurfaceComputeRenderer.maxFrameRays`, handed over at
   * create by {@link setSurfaceComputeRayCap}. Infinity until then (and
   * again after exit), which reads as "unbounded" everywhere it is
   * consulted: {@link captureSurfaceComputeFrame} still tiles at
   * SURFACE_COMPUTE_MAX_TILE_RAYS, and the live fit becomes a no-op. */
  private surfaceComputeRayCap = Number.POSITIVE_INFINITY;
  /** Whether a live frame has already been fitted under
   * {@link surfaceComputeRayCap} this session — the one-shot latch behind
   * the "traced at N x M" console note, so an every-frame clamp discloses
   * itself once instead of per frame. */
  private surfaceComputeFitNoted = false;
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
    // A camera-independent vertical gradient as the scene backdrop, so the
    // cloud floats in a sense of depth instead of a flat fill. One texture,
    // repainted in place when the Background control moves (fr-5ps1).
    this.backdropCanvas = document.createElement("canvas");
    this.backdropCanvas.width = 4;
    this.backdropCanvas.height = 256;
    this.backdropCtx = this.backdropCanvas.getContext("2d");
    if (this.backdropCtx) {
      paintBackdropGradient(this.backdropCtx, 4, 256, this.backdrop);
    }
    this.backdropTexture = new THREE.CanvasTexture(this.backdropCanvas);
    this.scene.background = this.backdropTexture;
    this.backdropQuad = new FullScreenQuad(
      new THREE.MeshBasicMaterial({
        map: this.backdropTexture,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.fog = new THREE.Fog(backdropMidpoint(this.backdrop), 1, 10);
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
    // The balloon echo (fr-5wlv.2): uEchoCenter/uEchoR/uEchoFloor2/
    // uEchoFadeStart/uEchoFadeEnd are all derived from the live cloud's
    // enclosing ball — placeholder zeros until the first setPoints call
    // (syncBalloonEchoUniforms) fills them in. Same additive, non-depth-
    // writing recipe as fourDMaterial above, for the same reason: overlapping
    // echo points should glow together, not depth-fight.
    this.balloonEchoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uEchoCenter: { value: new THREE.Vector3() },
        uEchoR: { value: 0 },
        uEchoFloor2: { value: 1e-8 },
        uEchoFadeStart: { value: 0 },
        uEchoFadeEnd: { value: 0 },
        uEchoDim: { value: BALLOON_ECHO_DIM },
        uSize: { value: BALLOON_ECHO_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
      },
      vertexShader: BALLOON_ECHO_VERTEX,
      fragmentShader: BALLOON_ECHO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.pointGeometry = new THREE.BufferGeometry();
    this.pointCloud = new THREE.Points(this.pointGeometry, this.baseMaterial);
    this.scene.add(this.pointCloud);

    // The balloon echo (fr-5wlv.2): SHARES pointGeometry by reference (its
    // header comment) rather than cloning it, so a fresh setPoints upload —
    // regen, morph tick, draw-range change — updates both clouds for free.
    // frustumCulled off: inverted points can land far outside the shared
    // geometry's own bounding sphere. renderOrder -1 draws it before (i.e.
    // behind) the main cloud, which never writes depth for the styles that
    // are themselves depthWrite:false, but DOES for the opaque ones
    // (baseMaterial/discMaterial) — either way the echo, which never writes
    // depth itself, can't occlude what draws after it.
    this.balloonEchoPoints = new THREE.Points(
      this.pointGeometry,
      this.balloonEchoMaterial,
    );
    this.balloonEchoPoints.visible = false;
    this.balloonEchoPoints.frustumCulled = false;
    this.balloonEchoPoints.renderOrder = -1;
    this.scene.add(this.balloonEchoPoints);

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
      // SCREEN-composite the flame over the backdrop quad renderFlame draws
      // first (fr-5ps1): out = flame + bg·(1 − flame), per channel. Over a
      // black backdrop this reduces to the flame bytes exactly (the
      // pre-fr-5ps1 look), zero-hit pixels show pure backdrop, and near-zero
      // densities fade smoothly into it — no coverage/alpha needed, which
      // matters because tonemapFlame writes binary alpha (255 wherever any
      // density landed). The same composite is exactly expressible in the
      // 2D-canvas capture paths (globalCompositeOperation "screen" — see
      // captureFlameFrame/thumbnailFrom), so captures match the live view
      // byte for byte.
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
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
    // The balloon echo's uEcho* uniforms are all derived from the cloud's
    // own enclosing ball, which just moved — re-derive them regardless of
    // whether the echo is currently enabled (fr-5wlv.2), so it never shows
    // stale geometry for one frame after a delayed enable.
    this.syncBalloonEchoUniforms();
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

    const palette = transformColors(
      transforms.length,
      transforms.map((t) => t.colorIndex),
    );
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
    // NOTE a pose change deliberately does NOT clear
    // {@link solidCapturePxCostMs} — the argument is at that field.
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
    // The backdrop itself no longer varies by style (fr-5ps1): every style
    // shows the one Background-control gradient (`this.backdropTexture`,
    // already installed as scene.background), and the fog color tracks its
    // midpoint via setBackground. A style only picks its material and
    // whether fog applies — "aerial" used to force the haze backdrop, and
    // pre-fr-5ps1 documents still get it, via persist.ts's decode migration
    // rather than anything here.
    switch (style) {
      case "depthFade":
        this.pointCloud.material = this.baseMaterial;
        this.scene.fog = this.fog;
        break;
      case "aerial":
        this.pointCloud.material = this.baseMaterial;
        this.scene.fog = this.fog;
        break;
      case "glow":
        this.pointCloud.material = this.glowMaterial;
        this.scene.fog = null;
        break;
      case "dof":
        this.pointCloud.material = this.dofMaterial;
        this.scene.fog = null;
        break;
      case "edl":
        this.pointCloud.material = this.discMaterial;
        this.scene.fog = null;
        break;
    }
  }

  /**
   * Set the scene backdrop (fr-5ps1): repaint the gradient texture in place,
   * re-derive the fog color from the new midpoint (fr-1lj — surfaces must
   * haze into what's actually behind them), and push the miss-gradient
   * uniforms to the three GLSL tracers. The flame composite, the capture/
   * thumbnail underlays and the WebGPU compute frame spec all read
   * `this.backdrop`, so one call moves every renderer at once. Cheap and
   * live-reactive (a uniform write + a 4×256 canvas repaint) — safe to call
   * per frame during a background crossfade.
   */
  setBackground(stops: BackgroundGradient): void {
    if (backgroundGradientsEqual(this.backdrop, stops)) return;
    this.backdrop = stops;
    this.renderNeeded = true;
    if (this.backdropCtx) {
      paintBackdropGradient(this.backdropCtx, 4, 256, stops);
      this.backdropTexture.needsUpdate = true;
    }
    this.applyFogColor();
    for (const material of [
      this.surfaceMaterial,
      this.surfaceMaterial4,
      this.voxelMaterial,
    ]) {
      const u = material.uniforms;
      (u.uBgTop.value as THREE.Vector3).set(...stops.top);
      (u.uBgBottom.value as THREE.Vector3).set(...stops.bottom);
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
    // The balloon echo is out of scope for 4D (fr-5wlv.2): the shared
    // position attribute holds pre-rotation 4D coords in that mode, and
    // inverting them would be meaningless. Entering/leaving 4D hides/
    // restores it without touching the user's enabled flag.
    this.syncBalloonEchoVisibility();
  }

  /**
   * Toggle the balloon echo (fr-5wlv.2): a second point cloud sharing the
   * explorer's own geometry, sphere-inverted about its enclosing ball — see
   * {@link syncBalloonEchoUniforms} and fractal/balloon-de.ts's module doc.
   * Visible exactly when `on` and the view isn't 4D (see
   * {@link syncBalloonEchoVisibility}).
   */
  setBalloonEchoEnabled(on: boolean): void {
    if (this.balloonEchoEnabled === on) return;
    this.balloonEchoEnabled = on;
    this.renderNeeded = true;
    this.syncBalloonEchoUniforms();
    this.syncBalloonEchoVisibility();
  }

  /**
   * Set the balloon echo's radius as a NORMALIZED multiple of the cloud's
   * own enclosing-ball radius (`rMult = 1` touches the attractor's extent —
   * see fractal/balloon-de.ts's `buildBalloon`, whose `rMult` carries the
   * same meaning). Live per-frame-updatable: the "Inflate" replay
   * (main.ts's `onBalloonInflate`) pushes it every tick of its sweep, and
   * this equality guard is what keeps that render-on-demand-correct.
   */
  setBalloonEchoRadius(rMult: number): void {
    if (this.balloonEchoRadius === rMult) return;
    this.balloonEchoRadius = rMult;
    this.renderNeeded = true;
    this.syncBalloonEchoUniforms();
    this.syncBalloonEchoVisibility();
  }

  /**
   * Re-derive every uEcho* uniform from {@link balloonEchoRadius} and the
   * cloud's current enclosing ball (`pointGeometry.boundingSphere` — exact,
   * computed by {@link setPoints}). A no-op before the first cloud ever
   * lands (`boundingSphere` is null until then, mirroring
   * {@link updateFog}'s own guard). Called from `setPoints` (the ball
   * moved) and both balloon-echo setters (the radius or enabled flag moved)
   * — cheap enough to re-run unconditionally rather than tracking which
   * particular input changed.
   */
  private syncBalloonEchoUniforms(): void {
    const sphere = this.pointGeometry.boundingSphere;
    if (!sphere) return;
    const u = this.balloonEchoMaterial.uniforms;
    (u.uEchoCenter.value as THREE.Vector3).copy(sphere.center);
    u.uEchoR.value = this.balloonEchoRadius * sphere.radius;
    // The vertex shader runs in float32, unlike the CPU DE oracle's float64
    // (fractal/balloon-de.ts's BALLOON_CENTER_FLOOR, 1e-12): a point landing
    // near the true center accumulates float32 rounding noise in `dot(d, d)`
    // well above `(1e-12 * rho)²`, which would swamp that floor and let a
    // near-center point invert to an enormous (or NaN-adjacent) position.
    // 1e-6 — its square is `1e-12 * rho²` — sits safely above that noise at
    // typical scene scales while staying visually indistinguishable from
    // the true center.
    const floor = 1e-6 * sphere.radius;
    u.uEchoFloor2.value = floor * floor;
    // BALLOON_FAR_CAP_RHO (10, fractal/balloon-de.ts): the balloon epic's
    // shared far-cap vocabulary — the DE march caps rays at this same
    // multiple of rho before falling through to the background, so the
    // echo cloud's own radial fade dissolves it against the SAME horizon
    // rather than an unrelated number.
    //
    // fr-5h5d: the Fog control stretches this same fade, so "thin fog"
    // reads consistently between the explorer's depth fog and the
    // balloon. Bounded at density 0.15 (~6.7x stretch) rather than
    // following fogDensity all the way to 0: the fade also bounds the
    // sphere inversion's run to infinity (see this module's balloon-echo
    // vertex shader / fractal/balloon-de.ts's module doc), so it must
    // never fully disable no matter how thin the fog reads.
    const fadeEnd =
      (BALLOON_FAR_CAP_RHO * sphere.radius) / Math.max(this.fogDensity, 0.15);
    u.uEchoFadeEnd.value = fadeEnd;
    u.uEchoFadeStart.value = 0.45 * fadeEnd;
  }

  /**
   * Recompute {@link balloonEchoPoints}'s visibility from
   * {@link balloonEchoEnabled} and {@link fourDActive} (the echo is out of
   * scope for 4D — see {@link setFourDActive}), equality-guarded like every
   * other per-frame setter (fr-py7z). Called from both balloon-echo setters
   * and from setFourDActive, so all three inputs stay in sync however they
   * change.
   */
  private syncBalloonEchoVisibility(): void {
    const visible = this.balloonEchoEnabled && !this.fourDActive;
    if (this.balloonEchoPoints.visible === visible) return;
    this.balloonEchoPoints.visible = visible;
    this.renderNeeded = true;
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
   * Set the depth-fog density multiplier (fr-5h5d) — see state.ts's
   * `AppState.fogDensity` for what `0`/`1` mean. Pushes `uFogDensity` to
   * both surface tracers and the solid render's voxel raymarcher (the
   * {@link setSurfaceParams} push-to-both pattern: whichever the next
   * session activates is already current), then re-derives the two OTHER
   * fog-bearing renderers this one control reaches from the new value —
   * the points explorer's own fog band ({@link updateFog}) and the
   * balloon echo's radial fade ({@link syncBalloonEchoUniforms}).
   */
  setFogDensity(v: number): void {
    if (this.fogDensity === v) return;
    this.fogDensity = v;
    this.renderNeeded = true;
    for (const material of [
      this.surfaceMaterial,
      this.surfaceMaterial4,
      this.voxelMaterial,
    ]) {
      material.uniforms.uFogDensity.value = v;
    }
    this.updateFog();
    this.syncBalloonEchoUniforms();
  }

  /**
   * Set the fog tint (fr-5h5d) — `tint` an rgb01 tuple, `strength` its
   * 0..1 blend weight; see state.ts's `AppState` fields for what they
   * mean. Pushes `uFogTint`/`uFogTintStrength` to both surface tracers
   * and the solid render's voxel raymarcher (the {@link setSurfaceParams}
   * push-to-both pattern, exactly like {@link setFogDensity}), then
   * re-derives the points explorer's fog color ({@link applyFogColor}) —
   * the tint applies AFTER the fr-1lj midpoint derivation, so changing
   * background keeps the atmosphere setting meaningful. Strength 0 (the
   * default) is the bit-exact identity in every renderer; the WebGPU
   * compute path reads the stored pair at spec assembly instead.
   */
  setFogTint(tint: [number, number, number], strength: number): void {
    if (
      this.fogTintStrength === strength &&
      this.fogTint[0] === tint[0] &&
      this.fogTint[1] === tint[1] &&
      this.fogTint[2] === tint[2]
    ) {
      return;
    }
    this.fogTint = [tint[0], tint[1], tint[2]];
    this.fogTintStrength = strength;
    this.renderNeeded = true;
    for (const material of [
      this.surfaceMaterial,
      this.surfaceMaterial4,
      this.voxelMaterial,
    ]) {
      const u = material.uniforms;
      (u.uFogTint.value as THREE.Vector3).set(...tint);
      u.uFogTintStrength.value = strength;
    }
    this.applyFogColor();
  }

  /**
   * Re-derive the points explorer's fog color: the backdrop midpoint
   * (fr-1lj — fogged points veil toward what's actually behind them),
   * then the fog tint lerped on top (fr-5h5d) — the tint applies AFTER
   * the midpoint derivation, so changing background keeps the atmosphere
   * setting meaningful. Strength 0 leaves the midpoint untouched.
   */
  private applyFogColor(): void {
    this.fog.color.copy(backdropMidpoint(this.backdrop));
    if (this.fogTintStrength > 0) {
      this.fog.color.lerp(
        FOG_TINT_COLOR.setRGB(...this.fogTint),
        this.fogTintStrength,
      );
    }
  }

  /**
   * Tighten the fog band to bracket the point cloud at the current distance.
   * No-op unless a depth-fading style (depthFade/aerial) is active.
   *
   * `fogDensity` (fr-5h5d) scales the fog DISTANCE UNIT: a larger density
   * packs both edges tighter around the camera (fog reaches full strength
   * over a shorter span), a smaller one pushes `far` out, thinning the fog
   * toward nothing. `near` deliberately does NOT keep retreating below its
   * density-1 baseline as density falls under 1 (`Math.max(d, 1)` floors
   * the divisor there) — only `far` needs to diverge to approximate "no
   * fog"; a `near` that retreated too would just pull the fog-free zone
   * further behind the camera for no visible benefit. `d <= 0` (the
   * slider's own floor) pushes `far` out to a practically unreachable
   * distance instead of dividing by zero — the `Fog` object stays
   * installed, so `setRenderStyle`'s own fog on/off switching is
   * untouched; the band just never visibly reaches anything.
   */
  updateFog(): void {
    const bounds = this.pointGeometry.boundingSphere;
    const fog = this.scene.fog;
    if (!bounds || bounds.radius === 0 || !(fog instanceof THREE.Fog)) return;

    const camDist = this.camera.position.distanceTo(bounds.center);
    const d = this.fogDensity;
    let near = Math.max(
      0.1,
      camDist - (bounds.radius * FOG_MARGIN) / Math.max(d, 1),
    );
    let far =
      d > 0
        ? camDist + (bounds.radius * FOG_MARGIN) / d
        : camDist + bounds.radius * FOG_MARGIN * 1.0e6;
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
    // A resize deliberately does NOT clear {@link solidCapturePxCostMs}:
    // the field is per-PIXEL, so the pixel count is already the
    // prediction's own multiplier, and the aspect's re-apportioning of
    // rays between the volume and the background is second order beside
    // it. Same argument as the pose site.
    this.syncProjection();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.syncBufferDependents();
  }

  /**
   * Re-derive everything sized from the PHYSICAL drawing buffer — the EDL
   * target/resolution and the three shader-point half-height uniforms —
   * after anything that changes that buffer: a viewport resize or an
   * adaptive pixel-ratio change ({@link setResolutionScale}).
   */
  private syncBufferDependents(): void {
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.edlTarget.setSize(buffer.x, buffer.y);
    this.edlResolution.set(buffer.x, buffer.y);
    this.dofMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
    this.fourDMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
    this.balloonEchoMaterial.uniforms.uHalfHeight.value = buffer.y * 0.5;
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
        ? thumbnailFrom(this.flameCanvas, maxDim, this.backdrop, "screen")
        : "";
    }
    return this.withCenteredProjection(() => {
      if (mode === "solid") this.renderSolid();
      else if (mode === "surface") {
        // Compute sessions re-present their last traced frame — tracing
        // here would be renderSurface's fold-GLSL path, which a compute
        // session deliberately never compiles (fr-tzdg). Before any frame
        // has presented, the explorer render is the honest thumbnail.
        if (!this.surfaceComputeActive) {
          try {
            this.renderSurface();
          } catch (err) {
            // A save-to-collection must never freeze the tab for a
            // monster pose's full-tier trace (fr-id9r): when the cost
            // ceiling refuses, the explorer render is the honest
            // fallback — the compute branch's own stance — and the
            // dirty flag makes the next live tick re-preview the
            // surface over it.
            if (!(err instanceof SurfaceCaptureCostError)) throw err;
            this.renderNeeded = true;
            this.render();
          }
        } else if (!this.representSurfaceComputeFrame()) this.render();
      } else this.render();
      return thumbnailFrom(this.renderer.domElement, maxDim, this.backdrop);
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
   * Render the backdrop quad, then the flame quad screen-blended over it
   * (fr-5ps1; see the flame material's blending doc in the constructor) —
   * used in place of {@link render} while a flame render is active, so the
   * (frozen) 3D scene never draws. autoClear is suspended for the second
   * draw: the flame quad renders through its own pass, which would
   * otherwise clear the backdrop it is meant to composite over.
   */
  renderFlame(): void {
    this.renderNeeded = false;
    this.renderer.setRenderTarget(null);
    this.backdropQuad.render(this.renderer);
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.flameQuad.render(this.renderer);
    this.renderer.autoClear = autoClear;
  }

  /**
   * Save-PNG source while a flame render is active. Screen-composites the
   * flame canvas over the scene backdrop gradient — the same
   * `flame + bg·(1 − flame)` blend {@link renderFlame} draws (see the flame
   * material's constructor doc), via canvas 2D's own "screen" operation, so
   * the exported PNG matches the on-screen appearance for any Background
   * choice (fr-5ps1). No `exportScale` parameter on purpose (fr-2urv): a
   * flame session ACCUMULATES at the export size (see
   * {@link flameRenderSize}), so its canvas already is the export —
   * re-scaling here would only interpolate.
   */
  captureFlameFrame(): Promise<ExportImage | null> {
    const { width, height } = this.flameCanvas;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    paintBackdropGradient(ctx, width, height, this.backdrop);
    ctx.globalCompositeOperation = "screen";
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
    // Both factors of a solid capture's per-pixel cost just moved
    // (fr-2q01): the step count above, and the density that decides where
    // a ray leaves the loop. See {@link solidCapturePxCostMs}.
    this.solidCapturePxCostMs = null;
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
    // uThreshold is where both marches stop, so an edit here re-prices
    // every ray (fr-2q01). See {@link solidCapturePxCostMs} for why the
    // whole setter clears rather than the threshold alone.
    this.solidCapturePxCostMs = null;
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
   *
   * Times itself into {@link solidCapturePxCostMs} (fr-2q01), so the NEXT
   * export's modal decides from evidence instead of from export scale. The
   * clock spans the whole promise — a capture's wall is what the modal is
   * about, and the readback and PNG encode are part of the wait whether or
   * not they are part of the march. A capture that produced no image
   * teaches nothing and leaves the previous reading standing.
   */
  captureSolidFrame(exportScale = 1): Promise<ExportImage | null> {
    const started = performance.now();
    return this.withPixelRatio(this.exportPixelRatio(exportScale), () =>
      this.withCenteredProjection(() => {
        this.renderSolid();
        return exportImageFrom(this.renderer.domElement);
      }),
    ).then((image) => {
      if (image !== null) {
        // Null from a poisoned reading leaves the field null, which is
        // the "no evidence" state the fallback already handles — see
        // capture-cost.ts for why that beats keeping a defensible-looking
        // number nobody can defend.
        this.solidCapturePxCostMs = solidCaptureMsPerPx(
          performance.now() - started,
          image.width * image.height,
        );
      }
      return image;
    });
  }

  /**
   * Measured evidence for what a solid capture at `exportScale` would
   * cost, or null when none survives (nothing exported yet against this
   * volume and isosurface — the POSE is deliberately not an invalidator,
   * see {@link solidCapturePxCostMs}) — the solid twin of
   * {@link predictSurfaceCaptureMs} (fr-2q01), feeding the same ONE
   * decision: whether the export modal skips its grace period and shows
   * at once. Never displayed, for the same reason its surface sibling
   * isn't — coverage and elapsed are measured, a predicted total is a
   * guess at the user's patience.
   *
   * Linear in the pixel count, which is what the march is: the same rays,
   * more of them. A capture's FIXED part — the drawing-buffer resize, the
   * encoder's own setup — rides inside the measured ms/px and is
   * therefore charged per pixel, so a 1x measurement predicting a 4x
   * export reads slightly high. Both directions are mild: reading high
   * opens a modal the grace period would have opened a third of a second
   * later anyway, and reading low merely declines to skip that grace
   * period, after which the modal appears on its own.
   */
  predictSolidCaptureMs(exportScale = 1): number | null {
    const { width, height } = this.exportSize(exportScale);
    return predictCaptureMs(this.solidCapturePxCostMs, width * height);
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
    // The balloon (fr-5wlv.4) certifies against the DE's OWN ball, so a
    // new system re-derives it and re-applies the stored on/rMult — a
    // session entered with the balloon already on wraps the new system's
    // ball, not the previous one's.
    this.surfaceBalloonBall = balloonBall(de);
    this.applySurfaceBalloon();
    // The ground plane (fr-rhn5) drops under the same ball, re-derived
    // and re-asserted per install exactly like the balloon above — AFTER
    // it, so the eligibility gate reads the final balloon define.
    this.surfaceGroundBall = balloonBall(de);
    this.applySurfaceGroundPlane();
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
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = costWeight > 1;
    this.surfaceStripEvidencedWorstMsPerPx = null;
    this.surfaceStripPartialWorstMsPerPx = 0;
    // A new DE is a new cost class: a predecessor system's pooled fences
    // must not seed this evidence chain (fr-7to5 declines cross-system
    // inheritance — the backlog still drains FIFO, unpriced, as before
    // the pool existed).
    this.flushStripBacklog();
  }

  /**
   * Escape-time sibling of {@link setSurfaceSystem} (fr-kltj): upload the
   * fold CHAIN's forward affines + fold params (fr-s04t — one slot per
   * link, the document's transform list being the formula sequence) and
   * flip the material onto the SURFACE_ESCAPE variant. Everything else
   * about the mode — tiers, strips, compile gate, capture — runs unchanged
   * on the same material; the iteration budget rides
   * {@link surfaceFullMaxDepth} as PASSES, so the preview depth clamp
   * trades boundary detail for speed exactly as the IFS descent trades
   * levels, at any chain length. No grid exists for this mode.
   */
  setEscapeSystem(de: EscapeDE, color: Vec3): void {
    this.renderNeeded = true;
    this.dropSurfaceGridTexture();
    packEscapeSystem(this.surfaceMaterial, de, color);
    // NO balloon ball for escape sessions (fr-5wlv.4, measured): the
    // escape set is a FILLED solid whose interior reaches the ball
    // center (never-escaping orbits return DE ~ 0 throughout), and the
    // sphere-inverted echo of a solid containing its own center is a
    // solid containing INFINITY — the camera sits inside the echo, the
    // union DE is legitimately ~0 everywhere, and every ray "hits" at
    // t ~ 0 with degenerate normals (observed: a black frame at every
    // R). The balloon narrative needs a thin set whose center sits in a
    // void — exactly the IFS attractors the spike certified. Nulling the
    // ball keeps applySurfaceBalloon packing the variant OFF however the
    // shared toggle is set, so escape sessions render plain.
    this.surfaceBalloonBall = null;
    this.applySurfaceBalloon();
    // The floor (fr-rhn5) survives where the balloon degenerates: the
    // escape solid is bounded by its origin bailout ball, and a plane
    // under a Mandelbox is the mode's classic look.
    this.surfaceGroundBall = { center: [0, 0, 0], radius: de.boundingRadius };
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.surfaceFullMaxDepth = ESCAPE_TIME_ITERATIONS;
    // The escape loop is phone-cheap (~30 branchless folds per eval):
    // the plain anchor entry is right, and so is the legacy strip probe.
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = false;
    this.surfaceStripEvidencedWorstMsPerPx = null;
    this.surfaceStripPartialWorstMsPerPx = 0;
    this.flushStripBacklog();
  }

  /**
   * Mandelbulb sibling of {@link setEscapeSystem} (fr-tdin): upload the
   * single triplex-power map's forward affine and flip the material onto
   * the SURFACE_BULB variant. Everything else about the mode — tiers,
   * strips, compile gate, capture — runs unchanged on the same material,
   * and the orbit's iteration budget rides {@link surfaceFullMaxDepth}
   * exactly like the escape arm's. No grid for this mode either (the
   * empty-space chain's validity argument is IFS-specific).
   *
   * ONE asymmetry against the escape twin, and it is the same one the
   * packers carry: the orbit's bailout ball and the QUERY-space marching
   * ball are different numbers here, so the balls below take
   * `de.boundingRadius` — the marching one.
   */
  setBulbSystem(de: BulbDE, color: Vec3): void {
    this.renderNeeded = true;
    this.dropSurfaceGridTexture();
    packBulbSystem(this.surfaceMaterial, de, color);
    // NO balloon ball, for the escape solid's reason re-measured on this
    // object (fr-tdin): the Mandelbulb is a FILLED solid whose interior
    // reaches the ball centre — DE(0) = 0 and 100% of a 0.1R neighbourhood
    // of the centre is interior, against 0.1% for the Mandelbox at its own
    // (much larger) bailout ball — so the sphere-inverted echo contains
    // infinity, the camera sits inside it (measured union DE at the
    // session's own opening eye: exactly 0 at R = 0.35 and 0.9 raw-ball
    // radii), and every ray hits at t ~ 0 with degenerate normals: a flat,
    // featureless frame at every R, exactly what fr-5wlv.4 observed one
    // object over. Nulling the ball keeps applySurfaceBalloon packing the
    // variant OFF however the shared toggle is set, so bulb sessions
    // render plain.
    this.surfaceBalloonBall = null;
    this.applySurfaceBalloon();
    // The floor (fr-rhn5) survives where the balloon degenerates, exactly
    // as it does for the escape solid — and a plane under a Mandelbulb is
    // the mode's classic look too.
    this.surfaceGroundBall = { center: [0, 0, 0], radius: de.boundingRadius };
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.surfaceFullMaxDepth = BULB_ITERATIONS;
    // Cheaper per eval than the fold mode that already ships (0.29 us
    // against 1.04, bulb-de.ts's measured verdict), so the plain anchor
    // entry and the legacy strip probe are right here too.
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = false;
    this.surfaceStripEvidencedWorstMsPerPx = null;
    this.surfaceStripPartialWorstMsPerPx = 0;
    this.flushStripBacklog();
  }

  /**
   * Turn the surface balloon (fr-5wlv.4) on or off at a normalized radius
   * `rMult` (multiples of the raw DE-ball radius — buildBalloon's rMult,
   * the same continuous parameter as the explorer echo's slider). Applies
   * immediately when a 3D surface system is installed; the stored pair
   * also re-applies whenever a NEW system lands (see
   * {@link setSurfaceSystem}/{@link setEscapeSystem}). Equality-guarded
   * with a dirty mark on change, the {@link setSurface4View} discipline.
   */
  setSurfaceBalloon(on: boolean, rMult: number): void {
    if (this.surfaceBalloonOn === on && this.surfaceBalloonRMult === rMult) {
      return;
    }
    this.surfaceBalloonOn = on;
    this.surfaceBalloonRMult = rMult;
    this.renderNeeded = true;
    this.applySurfaceBalloon();
    // A balloon flip changes the floor's eligibility (the two never
    // compile together; packSurfaceBalloon force-drops the plane define
    // when the balloon lands) — re-assert the stored floor intent under
    // the new define state (fr-rhn5).
    this.applySurfaceGroundPlane();
  }

  /**
   * The radius slider's cheap path (fr-5wlv.4): recompute R and rewrite
   * uniforms only — packSurfaceBalloon guarantees a no-shader-touch when
   * the flag doesn't flip, so every drag tick may call this. Equality
   * guard keeps render-on-demand honest, like {@link setBalloonEchoRadius}.
   * The compute path (fr-5wlv.5) needs nothing more than the field update
   * + renderNeeded: frame specs re-derive the balloon block from the
   * stored rMult at every assembly, exactly {@link setSurface4View}'s
   * live-pose discipline.
   */
  setSurfaceBalloonRadius(rMult: number): void {
    if (this.surfaceBalloonRMult === rMult) return;
    this.surfaceBalloonRMult = rMult;
    if (!this.surfaceBalloonOn) return;
    this.renderNeeded = true;
    this.applySurfaceBalloon();
  }

  /** The live balloon parameter block derived from the stored ball +
   * rMult — ONE definition (fractal/balloon-de.ts's buildBalloon
   * convention with the march far cap alongside) for both the GLSL
   * uniforms and the compute frame spec (fr-5wlv.5): rho takes the
   * certification margin, R is the normalized radius in world units, and
   * the far cap is the oracle's shared horizon. Null without an
   * installed ball. */
  private surfaceBalloonSpec(): {
    center: Vec3;
    rho: number;
    R: number;
    far: number;
  } | null {
    const ball = this.surfaceBalloonBall;
    if (!ball) return null;
    return {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: this.surfaceBalloonRMult * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
  }

  /** Re-derive the balloon uniform spec from the stored on/rMult and the
   * installed system's ball (null clears) and pack it into the 3D
   * material. */
  private applySurfaceBalloon(): void {
    packSurfaceBalloon(
      this.surfaceMaterial,
      this.surfaceBalloonOn ? this.surfaceBalloonSpec() : null,
    );
  }

  /**
   * Turn the ground plane (fr-rhn5) on or off — the persisted Floor
   * toggle's scene entry, {@link setSurfaceBalloon}'s discipline: store
   * the intent, then re-assert it against whatever system is installed.
   * The WebGL material only compiles the plane arm where it is eligible
   * (see {@link applySurfaceGroundPlane}); the compute path carries the
   * floor through its own session flag instead
   * ({@link enterSurfaceComputeSession}).
   */
  setSurfaceGroundPlane(on: boolean): void {
    if (this.surfaceGroundPlaneOn === on) return;
    this.surfaceGroundPlaneOn = on;
    this.renderNeeded = true;
    this.applySurfaceGroundPlane();
  }

  /** The live ground-plane parameter block derived from the stored
   * session ball — ONE definition (the {@link surfaceBalloonSpec}
   * discipline) for both the GLSL uniforms and the compute frame spec:
   * floor height, fade band and albedo all in world units, the
   * GROUND_PLANE_* constants applied to the ball. Null without an
   * installed 3D ball. */
  private surfaceGroundPlaneSpec(): SurfaceGroundPlaneSpec | null {
    const ball = this.surfaceGroundBall;
    if (!ball) return null;
    return {
      y: ball.center[1] - ball.radius * GROUND_PLANE_DROP,
      fadeStart: ball.radius * GROUND_PLANE_FADE_START,
      fadeEnd: ball.radius * GROUND_PLANE_FADE_END,
      ballCenter: ball.center,
      ballRadius: ball.radius,
      albedo: GROUND_PLANE_ALBEDO,
    };
  }

  /** Re-assert the stored floor intent (fr-rhn5) against the installed
   * system: packs the plane arm into the 3D material exactly where it is
   * eligible — a ball exists and the balloon variant is not compiled
   * (no horizon inside the shell; every other variant carries the plane
   * arm, its programs stripped far under the Mesa cliff by
   * surfaceFragmentFor). Reading the define makes the gate
   * ordering-proof against the install sequence. */
  private applySurfaceGroundPlane(): void {
    const eligible =
      this.surfaceGroundPlaneOn &&
      this.surfaceMaterial.defines.SURFACE_BALLOON !== 1;
    packSurfaceGroundPlane(
      this.surfaceMaterial,
      eligible ? this.surfaceGroundPlaneSpec() : null,
    );
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
    if (SURFPERF) {
      console.log(
        `[surfperf] grid arrived res=${String(grid.resolution)}` +
          ` halfExtent=${grid.halfExtent.toFixed(3)}`,
      );
    }
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
    // No 4D floor (fr-rhn5 is 3D-scoped) — and the stored intent must not
    // leave a stale plane arm compiled into the 3D material underneath.
    this.surfaceGroundBall = null;
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial4;
    this.surfaceQuad.material = this.surfaceMaterial4;
    this.surfaceFullMaxDepth = de.maxDepth;
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    // 4D surface DEs have no fold vocabulary (affine-class throughout).
    this.surfaceDeFoldClass = false;
    this.surfaceStripEvidencedWorstMsPerPx = null;
    this.surfaceStripPartialWorstMsPerPx = 0;
    this.flushStripBacklog();
  }

  /**
   * Per-frame rotor + w-slice for the 4D surface tracer — the live-pose
   * analogue of {@link setRot4}, with the same "same matrix, don't dirty
   * the frame" guard (fr-py7z): main.ts pushes every 4D-surface frame,
   * paused tumble included, and equality keeps render-on-demand honest.
   * `m` is the row-major world rotor from `fourDView.matrix()`; the packer
   * transposes it into the tracer's inverse-rotor uniform.
   *
   * `sliceCenter` arrives in the SIGNED NORMALIZED rotated-w units the slice
   * slider spans — the same [-1, 1] the cloud shader compares against
   * `q.w * uInvWAmp4` and the flame/solid slice windows share — while the
   * tracer's `uW0` is a LITERAL world w (it marches `vec4(p, uW0)` and gates
   * the visible ball against the attractor's own 4D radius). fr-33yb: those
   * two readings put one slider position on two different hyperplanes, so
   * the conversion happens HERE, through {@link updateWAmp4}'s own
   * `wSupport` — one expression defines the convention and there is nothing
   * left to drift.
   *
   * `sliceThickness` (fr-wa6o) is the slab's HALF-thickness and rides the
   * identical normalized→world conversion — one `wSupport` call feeds both —
   * so the slab's two edges land on real hyperplanes the position slider
   * could itself have selected, rather than on a plane pair whose spacing
   * drifts with the rotation. A thickness change dirties the frame exactly
   * like a centre change does (it is in the same equality guard below).
   *
   * Before the first 4D cloud upload the half-extents are still zero, so the
   * amplitude is 0 and the tracer marches `w = 0` — the centered slice a
   * fresh visit means anyway, with a zero-thickness slab, which is the
   * cross-section every 4D surface render was before fr-wa6o — and the
   * cloud's arrival re-packs by itself, since the guard below compares the
   * CONVERTED w0/half-thickness (a half-extent change that moves the plane
   * is a change).
   */
  setSurface4View(
    m: number[],
    sliceCenter: number,
    sliceThickness: number,
  ): void {
    const support = wSupport(m, this.fourDHalfExtents);
    const w0 = sliceCenter * support;
    const halfW = sliceThickness * support;
    const prev = this.surface4Rot;
    let changed = this.surface4W0 !== w0 || this.surface4HalfW !== halfW;
    for (let i = 0; i < 16 && !changed; i++) {
      if (prev[i] !== m[i]) changed = true;
    }
    if (!changed) return;
    for (let i = 0; i < 16; i++) prev[i] = m[i];
    this.surface4W0 = w0;
    this.surface4HalfW = halfW;
    this.renderNeeded = true;
    packSurfaceView4(this.surfaceMaterial4, m, w0, halfW);
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
   *
   * `balloon` (fr-5wlv.5) records whether this session's kernels carry
   * the inverted-union wrapper — pass exactly the create-target's flag —
   * and re-derives the ball from the DE (the WebGL install path's
   * {@link setSurfaceSystem} move, which never runs here), so every
   * frame spec can attach the live center/rho/R/far block the 320-byte
   * params struct expects.
   */
  enterSurfaceComputeSession(
    de: SurfaceDE,
    balloon: boolean,
    groundPlane = false,
  ): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = false;
    this.surfaceBalloonBall = balloonBall(de);
    this.surfaceComputeBalloon = balloon;
    // The floor flag (fr-rhn5) records the create-target's choice exactly
    // like `balloon` above; the ball it drops under is re-derived from
    // the DE so every frame spec can attach the live floor block the
    // 336-byte params struct expects.
    this.surfaceGroundBall = balloonBall(de);
    this.surfaceComputeGroundPlane = groundPlane;
    this.surfaceFullMaxDepth = de.maxDepth;
    this.surfacePreviewGovernor.reset(surfaceDescentCostWeight(de));
    this.surfacePreviewPxCostMs = null;
    // A previous strip session's pooled fences must not linger into (or
    // past) a compute session — the strip machinery never arms here, so
    // nothing would ever adopt them (fr-7to5).
    this.flushStripBacklog();
  }

  /**
   * {@link enterSurfaceComputeSession}'s FORWARD-ORBIT twin (fr-dlxh, and
   * one object wider since fr-tdin): the same session-entry resets
   * {@link setEscapeSystem}/{@link setBulbSystem} make — the orbit's
   * iteration budget as the preview depth clamp, a plain governor reset
   * (both forward loops are phone-cheap; no descent cost weight exists) —
   * without touching the GLSL material.
   *
   * `maxDepth` is the only thing that differs between the two objects
   * here, which is why they share one method behind the two named
   * wrappers below rather than one copy each.
   * `ballRadius` is the marching ball the floor drops under — the escape
   * DE's origin bailout ball, the bulb DE's query-space bounding ball.
   */
  private enterSurfaceComputeForwardSession(
    maxDepth: number,
    groundPlane: boolean,
    ballRadius: number,
  ): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = false;
    // Forward-orbit sessions never balloon (fr-5wlv.4's measured
    // degeneracy, re-measured on the Mandelbulb by fr-tdin —
    // setEscapeSystem's and setBulbSystem's comments) — null the ball
    // exactly like the WebGL install path, and the session flag with it.
    this.surfaceBalloonBall = null;
    this.surfaceComputeBalloon = false;
    // The floor (fr-rhn5) survives where the balloon degenerates — the
    // WebGL path's setEscapeSystem/setBulbSystem move.
    this.surfaceGroundBall = groundPlane
      ? { center: [0, 0, 0], radius: ballRadius }
      : null;
    this.surfaceComputeGroundPlane = groundPlane;
    this.surfaceFullMaxDepth = maxDepth;
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.flushStripBacklog();
  }

  /** The escape-time forward orbit's compute entry (fr-dlxh) — see
   * {@link enterSurfaceComputeForwardSession}. */
  enterSurfaceComputeEscapeSession(groundPlane = false, ballRadius = 1): void {
    this.enterSurfaceComputeForwardSession(
      ESCAPE_TIME_ITERATIONS,
      groundPlane,
      ballRadius,
    );
  }

  /** The Mandelbulb forward orbit's compute entry (fr-tdin) — see
   * {@link enterSurfaceComputeForwardSession}. */
  enterSurfaceComputeBulbSession(groundPlane = false, ballRadius = 1): void {
    this.enterSurfaceComputeForwardSession(
      BULB_ITERATIONS,
      groundPlane,
      ballRadius,
    );
  }

  /**
   * {@link enterSurfaceComputeSession}'s 4D twin (fr-dlxh's 4D cut): the
   * same session-entry resets {@link setSurfaceSystem4} makes — the 4D
   * DE's own full depth for the preview clamp, a plain governor reset
   * (no 4D descent cost weight exists yet; the governor's EMA re-prices
   * within a few frames) — without touching either GLSL material. While
   * active, every frame spec carries the live rotor/slice view
   * ({@link setSurface4View} keeps feeding the scene state exactly as in
   * the fragment path — one funnel, both tracers).
   */
  enterSurfaceCompute4Session(de: SurfaceDE4): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = true;
    // The 4D lift is a later fr-5wlv child — no 4D session balloons.
    this.surfaceComputeBalloon = false;
    // Nor floors (fr-rhn5's scope is 3D; the pack layer refuses 4D cores).
    this.surfaceGroundBall = null;
    this.surfaceComputeGroundPlane = false;
    this.surfaceFullMaxDepth = de.maxDepth;
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.flushStripBacklog();
  }

  /**
   * Record what the session's device can allocate for ONE frame (fr-biox):
   * `SurfaceComputeRenderer.maxFrameRays`, set once the renderer exists —
   * the enters above all run while `create()` is still in flight. Frames
   * are sized against it from here on: the live pane fits under it, a
   * capture tiles under it.
   */
  setSurfaceComputeRayCap(rays: number): void {
    this.surfaceComputeRayCap = rays;
    this.surfaceComputeFitNoted = false;
  }

  /** Leave the compute presentation (session exit or fallback re-enter):
   * drop the flag and free the frame texture — a settled full-resolution
   * frame holds megabytes of GPU memory nothing will re-present. */
  exitSurfaceComputeSession(): void {
    this.surfaceComputeActive = false;
    this.surfaceComputeGroundPlane = false;
    this.surfaceCompute4 = false;
    this.surfaceComputeBalloon = false;
    this.surfaceComputeRayCap = Number.POSITIVE_INFINITY;
    this.surfaceComputeFitNoted = false;
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
    // fr-biox: a live frame IS the image — it cannot tile the way a
    // capture does — so an enormous drawing buffer traces at the largest
    // raster the device can allocate for and blits up (the preview tier's
    // own mechanism) rather than failing to allocate. A no-op on every
    // ordinary display; acceptance eps stays native-height either way
    // (fr-7xgi).
    const w = Math.max(1, Math.round(size.x * scale));
    const h = Math.max(1, Math.round(size.y * scale));
    const fit = fitSurfaceComputeRaster(w, h, this.surfaceComputeRayCap);
    if (fit.width !== w && !this.surfaceComputeFitNoted) {
      this.surfaceComputeFitNoted = true;
      console.info(
        `Surface compute: tracing ${String(fit.width)}x${String(fit.height)} for a ` +
          `${String(w)}x${String(h)} raster — this device allocates at most ` +
          `${String(this.surfaceComputeRayCap)} rays per frame.`,
      );
    }
    return this.surfaceComputeFrameSpecAt(tier, fit.width, fit.height, size.y);
  }

  private surfaceComputeFrameSpecAt(
    tier: RenderTier,
    width: number,
    height: number,
    acceptHeight: number,
    /** The horizontal BAND of a taller image this raster covers, when it
     * is one capture tile of several (fr-biox): `bottom` rows above the
     * full image's bottom row, out of `fullHeight`. The camera's
     * sub-frustum ({@link withViewBand}) already aims the rays; what the
     * band changes HERE is everything derived from the raster's height —
     * the trace eps (a tile's pixels are the full image's pixels, so its
     * cone footprint is the full image's) and the backdrop stops (every
     * tracer spreads them over its OWN raster, so a band needs the two
     * the full gradient holds at its edges). */
    band?: { bottom: number; fullHeight: number },
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
    // A band traces the full image's pixels through a sub-frustum, so its
    // per-pixel cone footprint is the full image's, not its own raster's.
    const traceHeight = band ? band.fullHeight : height;
    const stops = band
      ? surfaceComputeBandStops(
          this.backdrop.top,
          this.backdrop.bottom,
          band.bottom,
          height,
          band.fullHeight,
        )
      : { bgTop: this.backdrop.top, bgBottom: this.backdrop.bottom };
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
      tracePixelEps: angularPerPixel / Math.max(traceHeight, 1),
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
      // The live fog density (fr-5h5d) — re-read at every spec assembly
      // exactly like the lighting/backdrop fields around it, so a live
      // Fog slider drag tracks the compute path the same frame the GLSL
      // uniform does.
      fogDensity: this.fogDensity,
      // The live fog tint (fr-5h5d) — re-read at every spec assembly
      // exactly like fogDensity above; strength 0 keeps the shade
      // kernel's fog toward the pixel's own backdrop alone.
      fogTint: [this.fogTint[0], this.fogTint[1], this.fogTint[2]],
      fogTintStrength: this.fogTintStrength,
      // The live backdrop stops (fr-5ps1) — the same pair the GLSL tracers
      // carry as uBgTop/uBgBottom, read fresh at every spec assembly so the
      // compute frames track a background change/crossfade exactly like a
      // lighting change (restricted to a capture tile's own band above).
      bgTop: [stops.bgTop[0], stops.bgTop[1], stops.bgTop[2]],
      bgBottom: [stops.bgBottom[0], stops.bgBottom[1], stops.bgBottom[2]],
      colorSource: SURFACE_COLOR_SOURCES.indexOf(params.colorSource),
      colorSpeed: params.colorSpeed,
      lut:
        (this.surfaceLUTTexture?.image.data as Uint8Array | undefined) ?? null,
      lutVersion: this.surfaceLUTVersion,
      dither: true,
      // The 4D session's live pose (fr-dlxh 4D cut): the same
      // (rotor, w0, halfW) state setSurface4View maintains — already
      // CONVERTED to literal world w (fr-33yb happens at the setter),
      // re-read at every spec assembly so the compute frames track the
      // tumble/slider exactly as the fragment tracer's uniforms would.
      ...(this.surfaceCompute4
        ? {
            view4: {
              rotor: [...this.surface4Rot],
              w0: this.surface4W0,
              sliceHalfW: this.surface4HalfW,
            },
          }
        : {}),
      // The balloon session's live block (fr-5wlv.5): keyed on the
      // SESSION flag — the kernels were compiled with the wrapper and
      // their 320-byte params struct — with values re-derived from the
      // stored ball + rMult at every assembly, so the R slider is live
      // per frame exactly like the rotor/slice above.
      ...(() => {
        if (!this.surfaceComputeBalloon) return {};
        const balloon = this.surfaceBalloonSpec();
        return balloon ? { balloon } : {};
      })(),
      // The floor session's live block (fr-rhn5): keyed on the SESSION
      // flag — the kernels were compiled with the plane arm and their
      // 336-byte params struct — with values re-derived from the stored
      // ball at every assembly, the balloon block's discipline above.
      ...(() => {
        if (!this.surfaceComputeGroundPlane) return {};
        const groundPlane = this.surfaceGroundPlaneSpec();
        return groundPlane ? { groundPlane } : {};
      })(),
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
  /** Feed a compute preview's measured wall cost to the preview governor.
   * `truncated` marks a budget-cut frame (unresolved rays remained): the
   * governor then panics through its warm-up (fr-khxy round 3 — see
   * PreviewGovernor.sample). Returns the new scale when the sample tipped
   * a rung, else null — the caller re-kicks a truncated preview exactly
   * when a drop happened. */
  sampleSurfaceComputeCost(traceMs: number, truncated = false): number | null {
    return this.surfacePreviewGovernor.sample(traceMs, { truncated });
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
   *
   * TILED since fr-biox, because a frame's cost in GPU memory scales with
   * its rays (44 B/ray across five buffers) and an export's rays scale
   * with exportScale SQUARED: a 4x export of a 1920x1057 pane is 32.5M
   * rays — a 520 MB ray-state buffer inside a ~1.4 GB frame — which
   * devices refuse. WebGPU does not throw for it either; `createBuffer`
   * returns an invalid buffer and the first REJECTION is a staging
   * `mapAsync` ("Invalid buffer"), which is how the bug reached a user as
   * a failed export and a console line naming nothing. So the export
   * traces as full-width horizontal BANDS, each a sub-frustum of the same
   * camera ({@link withViewBand}) at the same eps, sized under the
   * device's own ceiling ({@link surfaceComputeTileRows}), assembled here.
   * One tile is the whole image on any ordinary export, and that path is
   * byte-identical to the untiled one.
   */
  async captureSurfaceComputeFrame(
    exportScale: number,
    trace: (
      spec: SurfaceComputeFrameSpec,
      tile: { index: number; count: number },
    ) => Promise<Uint8Array | null>,
  ): Promise<ExportImage | null> {
    const ratio = this.exportPixelRatio(exportScale);
    // The renderer floors when deriving a buffer from a ratio — match it
    // (flameRenderSize's own arithmetic) without paying a resize just to
    // measure.
    const width = Math.floor(this.viewportWidth * ratio);
    const height = Math.floor(this.viewportHeight * ratio);
    const rows = surfaceComputeTileRows(
      width,
      height,
      this.surfaceComputeRayCap,
    );
    // EVERY band's spec is assembled in this one synchronous span, before
    // any of them traces. A tiled export spans minutes, and the live
    // camera can move through it (auto-orbit, a drift leg, a tween still
    // gliding): re-reading the pose per band would compose each stripe
    // from a different one. This is the compute path's answer to the
    // WebGL drain's frozen full-tier uniforms (fr-7mfx) — and it freezes
    // the live lighting/backdrop/palette inputs with it.
    const bands = this.withCenteredProjection(() => {
      const specs: SurfaceComputeFrameSpec[] = [];
      for (let bottom = 0; bottom < height; bottom += rows) {
        const bandHeight = Math.min(rows, height - bottom);
        specs.push(
          this.withViewBand(width, height, bottom, bandHeight, () =>
            this.surfaceComputeFrameSpecAt("full", width, bandHeight, height, {
              bottom,
              fullHeight: height,
            }),
          ),
        );
      }
      return specs;
    });
    const count = bands.length;
    // One band is the whole image: trace it and present its own pixels,
    // no assembly buffer (a 4x export's would be another 130 MB).
    const image = count === 1 ? null : new Uint8Array(width * height * 4);
    for (let index = 0; index < count; index++) {
      const band = bands[index];
      const traced = await trace(band, { index, count });
      if (!traced) return null;
      if (image === null) {
        return this.deliverSurfaceCapture(traced, width, height, ratio);
      }
      // Row 0 is the bottom row on both sides (the kernel's py=0 row is
      // ndcY=-1), so a band's rows land contiguously at its own offset.
      image.set(
        traced.subarray(0, width * band.height * 4),
        index * rows * width * 4,
      );
    }
    return image
      ? this.deliverSurfaceCapture(image, width, height, ratio)
      : null;
  }

  /** Present a finished capture at the export pixel ratio and read it
   * back — the paint and the `toBlob` snapshot in ONE synchronous span
   * (the renderer runs without `preserveDrawingBuffer`). */
  private deliverSurfaceCapture(
    pixels: Uint8Array,
    width: number,
    height: number,
    ratio: number,
  ): Promise<ExportImage | null> {
    return this.withPixelRatio(ratio, () => {
      this.presentSurfaceComputeFrame(pixels, width, height);
      return exportImageFrom(this.renderer.domElement);
    });
  }

  /**
   * Assemble something under a SUB-FRUSTUM of the live projection: the
   * band of `bandHeight` rows sitting `bandBottom` rows above the bottom
   * of a `fullWidth` x `fullHeight` image (fr-biox). Three.js's view
   * offset is exactly this — a sub-view of a notional full image, with
   * its own y measured from the TOP — so a band's rays are the full
   * image's rays, no reprojection of our own. Restores through
   * {@link syncProjection} like {@link withCenteredProjection}, whose
   * inset-free projection this composes inside.
   */
  private withViewBand<T>(
    fullWidth: number,
    fullHeight: number,
    bandBottom: number,
    bandHeight: number,
    read: () => T,
  ): T {
    this.camera.setViewOffset(
      fullWidth,
      fullHeight,
      0,
      fullHeight - bandBottom - bandHeight,
      fullWidth,
      bandHeight,
    );
    this.camera.updateProjectionMatrix();
    try {
      return read();
    } finally {
      this.syncProjection();
    }
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
   * offline export and thumbnails land here by construction) traces at full
   * quality SYNCHRONOUSLY, through the same adaptive scissored strips and
   * the same pump the async settle job uses (fr-sjff: every strip is its
   * own flushed submission, so even a pathological close-up export cannot
   * wedge the GPU process), then presents the completed frame; "preview" traces
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
    // A yielding capture owns the target and the frozen full-tier uniforms
    // (fr-7mfx). main.ts's tick already stands aside on
    // {@link surfaceCaptureBusy}; leaving renderNeeded set means the
    // invalidation this call carried is honoured once the capture lets go,
    // rather than being swallowed here.
    if (this.surfaceCaptureFlight) return;
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
    // submission (fr-sjff): the same adaptive strips through the same
    // pipelined pump as the async settle job (fr-y6m0), run to completion
    // right here. Offline export and thumbnails land on this path, so a
    // pathological close-up export is watchdog-safe
    // too — and COST-BOUNDED (fr-id9r): a monster fold pose prices a
    // full-tier frame in minutes to HOURS of frozen tab, so the frame
    // refuses up front when measured evidence predicts past the export
    // ceiling (checked before any live job is disturbed), and the drain
    // below aborts when an unpredicted pose lies. Both throw
    // {@link SurfaceCaptureCostError}; callers own the surface (offline
    // "Export failed", thumbnail's explorer fallback). This is where the
    // ceilings live NOW and only here (fr-avf6): these callers freeze the
    // tab for the frame's whole duration and offer no way to stop it, so a
    // predicted monster has to be refused for them. The interactive
    // Save-PNG has a modal, a percentage and a Cancel, so it is refused
    // nothing — see {@link captureSurfaceFrame}.
    const totalPx = size.x * size.y;
    const arm = this.beginSurfaceFullFrame(size.x, size.y, true);
    const completed = this.drainStripsSync(
      arm.job,
      this.surfaceSettleTarget,
      SURFACE_CAPTURE_SPEND_CEILING_MS,
    );
    this.finishSurfaceFullFrame(arm, totalPx, completed ? "done" : "ceiling");
    this.blitSurface(this.surfaceSettleTarget.texture, null);
  }

  /**
   * Arm a full-tier strip job over a `width` x `height` buffer: refuse up
   * front when measured evidence prices the frame past the export ceiling,
   * clear the live jobs out of the way, size the settle target and freeze
   * this frame's uniforms into it. Split out of {@link renderSurface} so
   * the synchronous drain and the yielding capture drain (fr-7mfx) arm
   * IDENTICALLY — the refusal, the abandon trio and the uniform freeze are
   * the parts that must not drift between them.
   *
   * The size is passed rather than read from the drawing buffer because
   * the async capture no longer holds the export pixel ratio across its
   * drain (see {@link captureSurfaceFrame}); the CALLER establishes the
   * centered projection around this call, since
   * {@link setSurfaceFrameUniforms} snapshots the camera into uniforms and
   * nothing after it reads the camera again.
   *
   * `costCeilings` is the fr-avf6 split. The SYNCHRONOUS callers pass true:
   * offline export and thumbnails run with nobody watching and no way to
   * interrupt a frame, so a predicted monster is refused here — BEFORE any
   * live job is disturbed, so a refused export leaves the pane exactly as
   * it was — with {@link SurfaceCaptureCostError}. The interactive capture
   * passes false and is never refused: it has a modal disclosing measured
   * coverage and a Cancel that works, which is a better answer than a
   * prediction that over-predicts ~4x, and the same button already behaves
   * that way on the WebGPU arm.
   */
  private beginSurfaceFullFrame(
    width: number,
    height: number,
    costCeilings: boolean,
  ): SurfaceFullFrameArm {
    if (costCeilings) {
      const predictedMs = this.predictSurfaceFullCostMs(width * height);
      if (
        predictedMs !== null &&
        predictedMs > SURFACE_CAPTURE_PREDICT_CEILING_MS
      ) {
        throw new SurfaceCaptureCostError(
          `Surface frame would take ~${formatGpuMinutes(predictedMs)} to ` +
            `trace at this view — export skipped`,
        );
      }
    }
    // A stale async job must not interleave with this frame's strips —
    // nor a stale preview job resume after it with full-tier uniforms.
    const priorPxCostMs = this.surfaceFullPxCostMs;
    this.abandonSurfaceSettle();
    this.abandonSurfacePreview();
    sizeTarget(this.surfaceSettleTarget, width, height);
    this.setSurfaceFrameUniforms("full", height, height);
    // Single-pass by default (fr-jf9y), which is what the synchronous
    // callers of this — offline export force frames and thumbnails — stay
    // at: an export's cost would multiply by the frame count, and a
    // thumbnail is already cheap and small. The interactive Save-PNG
    // re-opens the sequence at full width right after this returns.
    this.beginSurfaceSamples(1, width, height);
    // The job stays LOCAL: {@link surfaceStripJob} is the ASYNC settle's
    // slot, and a drain that parked its job there would only invite an
    // abandon path to half-release it mid-call.
    const job = this.newStripJob(
      createStripPlanner(height, width, {
        priorMsPerPx: this.surfaceStripPriorMsPerPx(),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      this.surfaceStripPriorMsPerPx(),
      // A capture NEVER presents: the export-scale target must not reach
      // the canvas mid-drain (fr-7mfx keeps the giant buffer off screen),
      // and a present-on-drain gap would only idle the GPU for a blit
      // nobody sees. An unreachable present due keeps the pump refilling.
      Number.POSITIVE_INFINITY,
    );
    // Adopt whatever the jobs just abandoned still have executing (fr-7to5)
    // rather than flushing it: since fr-y6m0 the drains pipeline, so their
    // refill ceiling has to price the REAL GL queue, and their first fence
    // batch has to attribute its busy wall over backlog + own pixels
    // instead of charging a predecessor's queue to this frame. Inherited
    // pixels stay out of `spentMs`, which is what keeps the export's spend
    // ceiling measuring this frame and nothing else.
    this.adoptStripBacklog(job);
    return { job, priorPxCostMs };
  }

  /**
   * Retire a full-tier job and record what it taught. The shared tail of
   * {@link renderSurface} and {@link captureSurfaceFrame}; throws
   * {@link SurfaceCaptureCostError} on the spend ceiling, which only the
   * synchronous drain can reach (fr-avf6), and the caller surfaces the
   * refusal.
   *
   * A frame that did not finish teaches nothing about its own cost — a
   * partial's per-pixel figure understates a frame whose expensive rows
   * it never reached, and strip cost is bimodal enough (fr-id9r measured
   * a 100-1000x band) that under-predicting is the direction that freezes
   * a tab. But the evidence the ARMING threw away is still good: the pose
   * has not moved, so what priced this view a moment ago prices it now.
   * Restoring it keeps a cancelled export from sending the next one to the
   * preview fallback's ~5x over-prediction (fr-7mfx) — which since fr-avf6
   * decides only whether the modal skips its grace period for an
   * interactive save, but still decides whether a thumbnail or an offline
   * frame is refused outright.
   */
  private finishSurfaceFullFrame(
    arm: SurfaceFullFrameArm,
    totalPx: number,
    outcome: SurfaceDrainOutcome,
  ): void {
    // Capture-mode retirement: an export-scale drain's observation may
    // TIGHTEN the live evidence but never own it — the pose did not move,
    // so the completed live settle/preview evidence is still the truth the
    // next live job should price from. A COMPLETED one may additionally
    // SEED an empty chain (fr-y1m7), which is the only evidence an offline
    // export ever gets.
    this.retireStripJob(
      arm.job,
      outcome === "done" ? "capture-completed" : "capture",
    );
    if (SURFPERF) {
      console.log(
        `[surfperf] capture ${outcome} px=${String(totalPx)}` +
          ` spentMs=${arm.job.spentMs.toFixed(1)}` +
          ` wall=${(performance.now() - arm.job.stat.t0).toFixed(0)}` +
          ` strips=${arm.job.stat.strips} polls=${arm.job.stat.polls}` +
          ` calls=${arm.job.stat.calls}`,
      );
    }
    if (outcome !== "done") {
      this.surfaceFullPxCostMs = arm.priorPxCostMs;
      if (outcome === "ceiling") {
        throw new SurfaceCaptureCostError(
          `Surface frame passed ${Math.round(arm.job.spentMs / 1000)}s of ` +
            `GPU time — export aborted`,
        );
      }
      return;
    }
    this.surfaceFullPxCostMs = arm.job.spentMs / Math.max(1, totalPx);
  }

  /**
   * Best measured prediction (ms) for a full-tier frame of `totalPx`
   * pixels, or null when no measurement survives (fresh session, or a
   * pose the evidence can no longer vouch for): a completed full-tier
   * frame's own per-pixel cost when the pose hasn't moved since, else
   * the completed preview's scaled by the measured preview->full tier
   * gap. The fold-class PRIOR deliberately does not predict — it is
   * calibrated ~100x past typical fold pixels (probe-sizing pessimism)
   * and would refuse every fold export sight unseen.
   */
  private predictSurfaceFullCostMs(totalPx: number): number | null {
    const pxCost =
      this.surfaceFullPxCostMs ??
      (this.surfacePreviewPxCostMs !== null
        ? this.surfacePreviewPxCostMs * STRIP_WORST_EVIDENCE_SAFETY
        : null);
    return pxCost !== null ? pxCost * totalPx : null;
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
   * The evidence-chain price core shared by the strip cap and the queue
   * bound: `classFloor` rules until a COMPLETED job's whole-frame
   * observation OWNS the price — scaled by
   * {@link STRIP_WORST_EVIDENCE_SAFETY} for the tier gap (the settle
   * traces deeper than the preview whose evidence seeds it, ~4-6x
   * measured) — in both directions: up on monster poses (Iris crease
   * pixels measured 1.7-3.1s), down on measured-cheap fold systems.
   * Partial (superseded-job) measurements come from whatever band the
   * strips crossed and can prove a pose expensive, never cheap, so they
   * only ever RAISE it.
   */
  private surfaceStripPrice(classFloor: number): number {
    const evidenced = this.surfaceStripEvidencedWorstMsPerPx;
    const base =
      evidenced !== null ? evidenced * STRIP_WORST_EVIDENCE_SAFETY : classFloor;
    return Math.max(
      base,
      this.surfaceStripPartialWorstMsPerPx * STRIP_WORST_EVIDENCE_SAFETY,
    );
  }

  /** Worst-case per-pixel price (ms) for the planner's strip cap
   * (fr-096u's second mechanism): {@link surfaceStripPrice} on the
   * class-pessimistic WORST constants — a single strip that plans into
   * the frame's most expensive band must still fit the watchdog, so
   * before evidence exists the fold floor assumes band prices
   * ({@link STRIP_FOLD_WORST_MS_PER_PX}'s doc). Without the evidence
   * relaxation, measured-cheap fold settles would crawl through tens of
   * thousands of class-floor micro-strips of pure readback overhead. */
  private surfaceStripWorstMsPerPx(): number {
    return this.surfaceStripPrice(
      this.surfaceDeFoldClass
        ? STRIP_FOLD_WORST_MS_PER_PX
        : STRIP_AFFINE_WORST_MS_PER_PX,
    );
  }

  /** Per-pixel price (ms) for the pump's in-flight queue bound (fr-id9r)
   * — {@link surfaceStripPrice} on the TYPICAL-cost class floors (the
   * fold probe prior, not the fold worst constant), still raised live by
   * the job's own ratcheted observations in the pump. The two bounds
   * deliberately price differently: the strip cap bounds ONE submission
   * against the band's worst single pixels (watchdog math — pessimism is
   * cheap there, it just shortens strips), while the queue bound paces
   * how much unmeasured work rides between rAF polls — and pricing THAT
   * at the 50ms/px worst constant rAF-dripped a fresh fold session's
   * first preview through an 80px queue, ~10x its real wall (measured on
   * the lens scenario: 8.6s spentMs against a 0.041ms/px marginal
   * estimate), inflating the governor sample and the preview evidence
   * with pacing bubbles. The band-entry exposure this leaves before the
   * first expensive batch ratchets the price is ~one
   * {@link SURFACE_STRIP_QUEUE_WORST_MS} of prior-priced pixels — the
   * measured 0.5-4ms/px transition class lands that at low seconds, the
   * bead's irreducible per-monster-pixel floor. */
  private surfaceStripQueueWorstMsPerPx(): number {
    return this.surfaceStripPrice(
      this.surfaceDeFoldClass
        ? STRIP_FOLD_PRIOR_MS_PER_PX
        : STRIP_AFFINE_WORST_MS_PER_PX,
    );
  }

  /** Retire a strip job into the evidence chain (see
   * {@link surfaceStripWorstMsPerPx}). A "completed" LIVE job's
   * observation replaces the evidence (and clears the partial raise); a
   * "superseded" job's observation can only raise; a "capture" drain
   * (fr-id9r) can only raise WITHOUT killing the evidence — the pose did
   * not move, so live settle/preview evidence is still the truth a live
   * job should price from, and an export-scale observation must tighten
   * that floor, never own it. "capture-completed" adds the one thing a
   * capture may do beyond raising: SEED a chain that is empty (fr-y1m7).
   * A job that measured NOTHING (superseded before its first strip
   * completed, or done in a single strip) carries no information and
   * changes nothing. */
  private retireStripJob(
    job: SurfaceStripJob,
    outcome: "completed" | "superseded" | "capture" | "capture-completed",
  ): void {
    const observed = job.planner.observedWorstMsPerPx;
    if (outcome === "completed") {
      if (observed > 0) {
        this.surfaceStripEvidencedWorstMsPerPx = observed;
        this.surfaceStripPartialWorstMsPerPx = 0;
      }
      return;
    }
    // A capture that COMPLETED may SEED an empty evidence chain (fr-y1m7),
    // never replace a live one. The seed matters because an offline export
    // is the one caller that never produces live evidence at all: a system
    // upload clears the chain, force frames bypass the preview, and a
    // raise-only retire cannot fill it — so every frame of a fold-scene
    // video priced its queue at the class prior, ~100x above what its own
    // pixels measured, and paid a forced-completion join per ~400px. Frame
    // one still does; the rest now price from it. It is safe in the
    // direction it can be wrong: a capture traces the WHOLE frame at the
    // same pose, so its observation is a settle's in kind, and an
    // export-scale trace resolves finer pixels than the live tier, which
    // reads HIGH — tighter strips, never looser.
    if (
      outcome === "capture-completed" &&
      observed > 0 &&
      this.surfaceStripEvidencedWorstMsPerPx === null
    ) {
      this.surfaceStripEvidencedWorstMsPerPx = observed;
    }
    // A SUPERSEDED job means the pose moved on — and with it whatever a
    // completed predecessor proved cheap. Keeping stale evidence bit
    // live (fr-096u validation): a far-pose preview completed cheap
    // during the entry glide, its relaxed floor let the PARKED monster
    // pose plan 2220px strips, and the first groups ran 16-22s. Evidence
    // relaxation lives exactly one completed-preview -> settle handoff
    // (main.ts begins the settle only while the completing preview's
    // pose still stands); everything mid-motion prices at the class
    // floor plus the partial ratchet.
    if (outcome === "superseded") {
      this.surfaceStripEvidencedWorstMsPerPx = null;
    }
    if (observed > 0) {
      this.surfaceStripPartialWorstMsPerPx = Math.max(
        this.surfaceStripPartialWorstMsPerPx,
        observed,
      );
    }
  }

  /** Build a strip job around `planner`: the cost estimate starts at the
   * probe prior (null for affine-cheap systems — the sync-collapse
   * regime's marker, see pumpStrips), the in-flight queue prices at the
   * frozen {@link surfaceStripQueueWorstMsPerPx} (fr-id9r — frozen like
   * the planner's floor, and raised live by the planner's own ratchet),
   * and presents pace at `presentIntervalMs` (see present-on-drain in
   * pumpStrips; `Infinity` for the capture jobs, which never present). */
  private newStripJob(
    planner: StripPlanner,
    priorMsPerPx: number | null,
    presentIntervalMs: number,
  ): SurfaceStripJob {
    return {
      planner,
      msPerPxEstimate: priorMsPerPx,
      queueWorstMsPerPx: this.surfaceStripQueueWorstMsPerPx(),
      measured: false,
      lastSubmittedPx: 0,
      spentMs: 0,
      inFlight: [],
      inFlightPx: 0,
      inheritedPx: 0,
      busyMark: null,
      presentDue: 0,
      presentIntervalMs,
      stat: { strips: 0, polls: 0, presents: 0, calls: 0, t0: 0 },
    };
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
    // Per-pixel cost prediction for the NEW job's probe pacing and queue
    // pricing. Rung-invariant only approximately (finer rungs trace
    // deeper), but it only picks a pacing regime — both regimes are
    // correct.
    let pxCostMs = this.surfacePreviewPxCostMs;
    if (job) {
      this.surfacePreviewJob = null;
      this.retireStripJob(job, "superseded");
      // Pixels still riding in-flight fences were planned but never
      // accounted — extrapolate from the MEASURED pixels only, or the
      // estimate would read low by the whole queued cost. Own pixels
      // only (fr-7to5): fences this job itself inherited were never in
      // its planner's plannedPx, so counting them would deflate (or
      // negate) the traced share. Computed BEFORE the harvest below
      // zeroes the counters.
      const tracedPx =
        job.planner.plannedPx - (job.inFlightPx - job.inheritedPx);
      this.poolStripBacklog(job);
      if (tracedPx > 0 && job.spentMs > 0) {
        this.surfacePreviewGovernor.sample(
          (job.spentMs * job.planner.totalPx) / tracedPx,
        );
        // FRESHER WINS (fr-b8o5): the superseded job measured the pose
        // the view is at (or just left), while surfacePreviewPxCostMs can
        // predate the whole gesture. 4D slice moves shift per-pixel cost
        // 20-40x pose to pose, and re-arming at the stale-cheap completed
        // prior priced the pipelined queue's est-side admission ~150x
        // under reality — each of a drag's coalesced re-arms then
        // orphaned seconds of already-submitted strips in the GL queue
        // ahead of the final preview (measured: 30.8s post-drag wall
        // where a fresh session at the same pose paid 4.3s). Written back
        // to the field so the NEXT re-arm prices from this pose evidence
        // even if its own job dies before a fence lands. Partial batch
        // attributions quantize toward rAF boundaries, which only reads
        // HIGH — smaller probes and queues, the safe direction — and the
        // next completed preview overwrites with its whole-frame number.
        pxCostMs = job.spentMs / tracedPx;
        this.surfacePreviewPxCostMs = pxCostMs;
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
    const previewPrior =
      pxCostMs ?? (this.surfaceDeFoldClass ? STRIP_FOLD_PRIOR_MS_PER_PX : null);
    if (SURFPERF) {
      // The evidence-chain components behind worst= (fr-1znb diagnosis):
      // evidenced= is the completed-job floor (null until one completes),
      // partial= the superseded-job term — both RAW, before
      // STRIP_WORST_EVIDENCE_SAFETY scales them into worst.
      console.log(
        `[surfperf] preview armed ${String(w)}x${String(h)}` +
          ` prior=${String(previewPrior)}` +
          ` worst=${this.surfaceStripWorstMsPerPx().toFixed(2)}` +
          ` evidenced=${String(this.surfaceStripEvidencedWorstMsPerPx)}` +
          ` partial=${this.surfaceStripPartialWorstMsPerPx.toFixed(3)}`,
      );
    }
    this.surfacePreviewJob = this.newStripJob(
      createStripPlanner(h, w, {
        targetMs: SURFACE_PREVIEW_STRIP_TARGET_MS,
        priorMsPerPx: previewPrior,
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      previewPrior,
      SURFACE_PREVIEW_PRESENT_MS,
    );
    // Inherit whatever the superseded job (or an abandoned settle — one
    // GL queue, whichever target owned it) still has executing (fr-7to5):
    // the refill ceiling then sees the real queue instead of stacking
    // another probe behind the backlog, and the first fence batch
    // attributes over backlog + own pixels.
    this.adoptStripBacklog(this.surfacePreviewJob);
  }

  /**
   * Advance the in-flight preview job — light systems complete right here
   * in the pump's sync-collapse regime, heavy ones ride the pipelined
   * queue — and repaint the canvas on its present-on-drain cadence. On
   * completion the job's accumulated GPU-busy cost feeds the governor
   * (fr-hith), and true is returned (no-op true when no job is running).
   * However expensive the pose, the job runs to COMPLETION — the
   * fr-24to/fr-zx34 verdict: an automatic give-up (bail, sub-floor
   * rung, or spend/prediction truncation — two shipped rounds of the
   * latter each clipped a completable heavy-lens preview) decides for
   * the user what only the user can weigh, so the mode instead
   * discloses {@link surfaceRenderProgress} and leaves the wait/move
   * decision to them. Every submission stays strip-bounded and the
   * partial presents keep the grind visible and interruptible.
   */
  stepSurfacePreview(): boolean {
    const job = this.surfacePreviewJob;
    if (!job) return true;
    const { done, present } = this.pumpStrips(
      job,
      this.surfacePreviewTarget,
      SURFACE_STRIP_QUEUE_MS,
    );
    if (done) {
      this.surfacePreviewJob = null;
      this.retireStripJob(job, "completed");
      const { width, height } = this.surfacePreviewTarget;
      // Per-pixel cost of the completed trace: primes the settle job's
      // probe prediction (beginSurfaceSettle) so ITS first strip can
      // fence-pace instead of blocking for seconds on the devices this
      // matters for.
      this.surfacePreviewPxCostMs = job.spentMs / Math.max(1, width * height);
      this.surfacePreviewGovernor.sample(job.spentMs);
      if (SURFPERF) {
        console.log(
          `[surfperf] preview complete ${String(width)}x${String(height)}` +
            ` spentMs=${job.spentMs.toFixed(1)}` +
            ` pxCost=${this.surfacePreviewPxCostMs.toFixed(4)}` +
            ` worstSeen=${job.planner.observedWorstMsPerPx.toFixed(3)}`,
        );
      }
    }
    // Present on the pump's drain gaps (and on completion): the blit
    // rides the same GL queue as the strips, so presenting mid-queue
    // would stall the page's own frames behind the queued trace work.
    if (done || present) {
      this.blitSurface(this.surfacePreviewTarget.texture, null);
    }
    return done;
  }

  /** Discard the in-flight preview job (a full-tier trace or a session
   * exit supersedes it). No governor sample: the discard is not evidence
   * about trace cost. Its in-flight fences pool for the next job to arm
   * (fr-7to5) — the entry points that must not inherit flush the pool
   * themselves. */
  abandonSurfacePreview(): void {
    this.poolStripBacklog(this.surfacePreviewJob);
    this.surfacePreviewJob = null;
  }

  /** Whether a preview job is mid-flight (main.ts steps it per frame and
   * holds the settle job off until it completes). */
  get surfacePreviewActive(): boolean {
    return this.surfacePreviewJob !== null;
  }

  /** Honest coverage of the in-flight surface trace, for main.ts's
   * progress readout (fr-zx34's verdict: the mode never gives up on a
   * frame — it reports progress and the USER decides whether the pose
   * is worth the wait). Traced-and-measured pixels over the job's
   * total: the preview job when one is mid-flight, else the settle
   * job, else null (nothing grinding — settled, superseded, or not in
   * surface mode). No time predictions here by design: two shipped
   * rounds of prediction-driven truncation each misjudged a
   * completable preview (fr-zx34); a moving percent lets the user
   * read the rate themselves. */
  surfaceRenderProgress(): {
    phase: "preview" | "settle";
    fraction: number;
    /** Which supersampling pass is tracing, 1-based (fr-jf9y), and how
     * many the sequence wants. Always 1/1 for a preview and for every
     * single-pass settle, so a caller that ignores them reads exactly what
     * it read before. */
    sample: number;
    samples: number;
  } | null {
    const preview = this.surfacePreviewJob;
    if (preview) {
      return {
        phase: "preview",
        fraction: stripJobCoverage(preview),
        sample: 1,
        samples: 1,
      };
    }
    const settle = this.surfaceStripJob;
    if (settle) {
      // Coverage spans the WHOLE sequence, so the row's percentage stays
      // monotone across the passes instead of resetting to 0% eight times
      // (the compute arm's `done`/`total` convention, fr-vpbq).
      const samples = this.surfaceSampleTotal;
      return {
        phase: "settle",
        fraction:
          (this.surfaceSampleIndex + stripJobCoverage(settle)) /
          Math.max(1, samples),
        sample: Math.min(samples, this.surfaceSampleIndex + 1),
        samples,
      };
    }
    return null;
  }

  /** The unmasked WebGL renderer string (fr-tmgf):
   * WEBGL_debug_renderer_info where the browser exposes it, else the
   * masked RENDERER. main.ts matches it against the software-rasterizer
   * tells ONCE at boot — the incident behind the bead was a browser that
   * silently blocklisted the GPU, so every mode rendered on SwiftShader
   * for a day with nothing on screen saying so. Lives here because raw-GL
   * access stays inside FractalScene. */
  unmaskedRendererLabel(): string | null {
    return unmaskedWebglRenderer(this.renderer.getContext());
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
    const compileStart = performance.now();
    await this.renderer.compileAsync(this.surfaceCompileScene, this.camera);
    if (SURFPERF) {
      // Wall time of the driver's program compile+link — the fold variant's
      // measured ~25s Mesa cliff, and fr-zqu8's gate metric for growing the
      // fold source. `khr` reports whether the async path
      // (KHR_parallel_shader_compile) was even on offer: fr-f21s's
      // session-death lottery is sessions that come up without it and pay
      // the link synchronously.
      const khr = this.renderer.extensions.has("KHR_parallel_shader_compile")
        ? 1
        : 0;
      console.log(
        `[surfperf] surface compileAsync ms=${(
          performance.now() - compileStart
        ).toFixed(0)} khr=${String(khr)}`,
      );
    }
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
   * Open a supersampling sequence over a `width` x `height` frame in
   * {@link surfaceSettleTarget} (fr-jf9y — fr-vpbq's compute-arm shape
   * said in strip vocabulary).
   *
   * `samples` PASSES, each a whole-frame strip job through the untouched
   * pump, at {@link subPixelSample}'s offsets — the SAME R2 sequence the
   * WebGPU arm walks, so "8 samples" means one thing in this app. The
   * alternative, an N-loop inside the fragment, multiplies EVERY strip's
   * cost by N: the planner would ratchet and shrink strips to stay
   * watchdog-safe, so it would be safe, but a 3s settle would become 24s
   * with nothing to show at 3s — against fr-096u/fr-id9r's bounded-strip
   * tuning and against fr-24to's verdict that this renderer discloses
   * progress rather than making the user wait blind.
   *
   * `samples <= 1` is every path that existed before this: previews (cheap
   * by definition and replaced anyway), thumbnails, and offline video force
   * frames (whose cost would multiply by the frame count). It releases the
   * accumulator and leaves the jitter at the pixel centre, so those traces
   * are the pre-fr-jf9y ones value for value.
   */
  private beginSurfaceSamples(
    samples: number,
    width: number,
    height: number,
  ): void {
    const total = Math.max(1, Math.floor(samples));
    this.surfaceSampleTotal = total;
    this.surfaceSampleIndex = 0;
    this.surfaceSampleTaken = 0;
    this.surfaceSampleMeanReady = false;
    this.surfaceSampleWidth = width;
    this.surfaceSampleHeight = height;
    if (total <= 1) {
      // ~33MB at 1080p between the accumulator and the mean texture: a
      // single-pass caller has no use for either.
      this.surfaceSampleAccum = null;
      this.surfaceSampleTexture?.dispose();
      this.surfaceSampleTexture = null;
      return;
    }
    const px = width * height;
    if (this.surfaceSampleAccum?.length === px * 3) {
      this.surfaceSampleAccum.fill(0);
    } else {
      this.surfaceSampleAccum = new Float32Array(px * 3);
    }
    const tex = this.surfaceSampleTexture;
    if (!tex || tex.image.width !== width || tex.image.height !== height) {
      tex?.dispose();
      const next = new THREE.DataTexture(new Uint8Array(px * 4), width, height);
      // Linear + clamp like the targets it stands in for — a capture
      // presents it at export ratio, and a live present at DPR.
      next.minFilter = THREE.LinearFilter;
      next.magFilter = THREE.LinearFilter;
      next.wrapS = THREE.ClampToEdgeWrapping;
      next.wrapT = THREE.ClampToEdgeWrapping;
      this.surfaceSampleTexture = next;
    }
  }

  /** Point the active tracer at the CURRENT pass's spot inside the pixel
   * and arm a whole-frame strip job for it (fr-jf9y). Priors and worst
   * prices come from the same accessors {@link beginSurfaceSettle} uses,
   * so a later pass paces exactly like the first — except that pass 0's
   * completed retire has by now put a MEASURED observation in the evidence
   * chain, which is strictly better than the class floor it started from.
   *
   * The present CADENCE is pass 0's, deliberately, even though a later
   * pass has no new image to show until it lands: present-on-drain is how
   * this pump bounds its own queue (see {@link pumpStrips}), and a job
   * that never takes a gap keeps ~{@link SURFACE_STRIP_QUEUE_MS} of work
   * permanently in flight for whatever interrupts it to wait behind.
   * MEASURED (scripts/surface-tier.verify.mjs, SwiftShader, default
   * system): with the gaps suppressed the mid-drag preview took longer
   * than the gate's 1.5s to reach the canvas and its softness check read
   * 1.03 against a 0.81 control — i.e. a drag mid-settle showed the
   * settled frame instead of a preview, which is fr-nl32's symptom
   * arriving by another route. What a later pass presents INTO that gap
   * is the last COMPLETED image ({@link presentSurfaceSampleImage}), never
   * the half-traced pass being written over it. */
  private armSurfaceSamplePass(width: number, height: number): SurfaceStripJob {
    const [sx, sy] = subPixelSample(this.surfaceSampleIndex);
    const dx = sx - 0.5;
    const dy = sy - 0.5;
    (
      this.activeSurfaceMaterial.uniforms.uPixelJitter.value as THREE.Vector4
    ).set(dx / Math.max(1, width), dy / Math.max(1, height), dx, dy);
    return this.newStripJob(
      createStripPlanner(height, width, {
        priorMsPerPx: this.surfaceStripPriorMsPerPx(),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      this.surfaceStripPriorMsPerPx(),
      SURFACE_SETTLE_PRESENT_MS,
    );
  }

  /**
   * Fold the completed pass sitting in {@link surfaceSettleTarget} into the
   * running linear-light sum (fr-jf9y).
   *
   * THE GAMMA DECODE HAPPENS HERE, on the way in, and the re-encode in
   * {@link encodeSurfaceSampleMean} on the way out. Both tracers end with
   * `pow(lit, 1/2.2)`, so the bytes this readback returns are
   * gamma-ENCODED; summing them directly is the classic edge-darkening
   * antialiasing bug — a half-covered edge pixel would come out darker
   * than the average light reaching it. A 256-entry table makes the decode
   * a lookup per channel rather than a `Math.pow`.
   *
   * The readback is also the sequence's barrier: it forces every strip of
   * this pass to have executed before the next pass is armed, which is the
   * clean-probe guarantee {@link beginSurfaceSettle} pays a 1x1 readback
   * for. It is ONE sync point per PASS, outside any job, so the pump's
   * cost model never sees it.
   */
  private foldSurfaceSample(): void {
    const accum = this.surfaceSampleAccum;
    const tex = this.surfaceSampleTexture;
    if (!accum || !tex) return;
    const width = this.surfaceSampleWidth;
    const height = this.surfaceSampleHeight;
    const buf = tex.image.data as Uint8Array;
    const t0 = SURFPERF ? performance.now() : 0;
    this.renderer.readRenderTargetPixels(
      this.surfaceSettleTarget,
      0,
      0,
      width,
      height,
      buf,
    );
    const tRead = SURFPERF ? performance.now() : 0;
    const px = width * height;
    for (let i = 0, p = 0, a = 0; i < px; i++, p += 4, a += 3) {
      accum[a] += SRGB_TO_LINEAR[buf[p]];
      accum[a + 1] += SRGB_TO_LINEAR[buf[p + 1]];
      accum[a + 2] += SRGB_TO_LINEAR[buf[p + 2]];
    }
    this.surfaceSampleTaken += 1;
    // The texture now holds THIS pass verbatim — which is already the
    // right image to re-present while pass 1 traces over the target
    // (encodeSurfaceSampleMean takes over from two passes on).
    tex.needsUpdate = true;
    if (SURFPERF) {
      // The accumulator's whole overhead, the number the host-side-vs-float-
      // target choice was made on: readback + decode, once per PASS.
      console.log(
        `[surfperf] sample fold ${String(this.surfaceSampleTaken)} ` +
          `${String(width)}x${String(height)} read=${(tRead - t0).toFixed(1)}ms` +
          ` decode=${(performance.now() - tRead).toFixed(1)}ms`,
      );
    }
  }

  /**
   * Re-encode the mean of the folded passes over the readback buffer it was
   * accumulated from (fr-jf9y) — the gamma decode's inverse, see
   * {@link foldSurfaceSample}. In place, so a pass costs one full-frame
   * readback and one upload with no copy between them; alpha is left as the
   * trace wrote it (always opaque). A no-op at one pass, where the buffer
   * already holds that pass verbatim and a round trip through the table
   * could only lose a least significant bit.
   */
  private encodeSurfaceSampleMean(): void {
    const accum = this.surfaceSampleAccum;
    const tex = this.surfaceSampleTexture;
    if (!accum || !tex || this.surfaceSampleTaken < 2) return;
    const buf = tex.image.data as Uint8Array;
    const inv = 1 / this.surfaceSampleTaken;
    const invGamma = 1 / SURFACE_OUTPUT_GAMMA;
    for (let p = 0, a = 0; p < buf.length; p += 4, a += 3) {
      buf[p] = Math.round(255 * Math.pow(accum[a] * inv, invGamma));
      buf[p + 1] = Math.round(255 * Math.pow(accum[a + 1] * inv, invGamma));
      buf[p + 2] = Math.round(255 * Math.pow(accum[a + 2] * inv, invGamma));
    }
    tex.needsUpdate = true;
  }

  /**
   * Stretch the last COMPLETED image of the current sequence over `target`
   * (null = the canvas): the mean of the folded passes, or pass 0 verbatim
   * while it is the only one. False — and nothing drawn — before any pass
   * has landed, which is the single-pass caller's whole path: it presents
   * its traced target directly, byte for byte as before fr-jf9y.
   */
  private presentSurfaceSampleImage(
    target: THREE.WebGLRenderTarget | null = null,
  ): boolean {
    const tex = this.surfaceSampleTexture;
    if (!tex || this.surfaceSampleTaken < 1) return false;
    this.blitSurface(tex, target);
    this.surfaceSampleMeanReady = true;
    return true;
  }

  /**
   * Start the ASYNC full-quality settle job (fr-sjff): freeze the camera +
   * full-tier quality uniforms (main.ts abandons the job on any
   * invalidation, so they cannot go stale mid-job), seed the settle target
   * with the parked preview stretched to full size — per-step progress
   * blits then show the preview sharpening strip by strip, never
   * uninitialized rows — and arm the strip planner.
   * {@link stepSurfaceSettle} does the actual tracing, a bounded slice per
   * animation frame. It always ARMS — however expensive the frame, the
   * planner's caps keep every submission bounded and the progressive
   * blits keep the grind visible and interruptible; a silent refusal
   * would read as a broken render (the fr-096u review lesson).
   */
  beginSurfaceSettle(seed: "preview" | "hold" = "preview"): void {
    // main.ts holds the settle off until the preview job completes; a
    // still-armed job here would resume later with THIS frame's full-tier
    // uniforms, so drop it defensively.
    this.abandonSurfacePreview();
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    sizeTarget(this.surfaceSettleTarget, size.x, size.y);
    this.setSurfaceFrameUniforms("full", size.y, size.y);
    // Seed for the rows the strips haven't traced yet. "preview" — the
    // normal choreography — upscales the completed preview of THIS pose.
    // "hold" (fr-37c6, previews off) keeps the target's own stale pixels:
    // no preview of this pose exists, and the previous settled frame is the
    // exact image the frozen pane is already showing, so the develop stays
    // seamless — the compute path's prefill-from-last-frame discipline.
    // (A resize re-allocates the target and the hold seed degrades to
    // undefined rows — rare, and strips overwrite them progressively.)
    if (seed === "preview") {
      this.blitSurface(
        this.surfacePreviewTarget.texture,
        this.surfaceSettleTarget,
      );
    }
    // Force the seed — and every frame still queued before it — to
    // COMPLETE before the probe strip runs, so the probe's measurement is
    // the probe alone, not leftover backlog. A 1x1 readback is the one
    // sync a driver cannot fake (see renderSurfaceStrips); on a healthy
    // device this is microseconds.
    this.renderer.setRenderTarget(this.surfaceSettleTarget);
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    this.renderer.setRenderTarget(null);
    // The barrier above just drained any pooled backlog with the queue —
    // its fences carry nothing the settle needs (fr-7to5: the normal
    // choreography completes the preview before this runs, so a pool
    // here is the rare defensive-abandon case). Flush so the settle's
    // clean-probe invariant holds exactly as before inheritance existed.
    this.flushStripBacklog();
    // Probe SIZED from the completed preview's measured per-pixel cost —
    // or the pessimistic fold prior when none exists (fr-096u). The
    // rows-fraction probe this replaces was the settle's one unmeasured
    // submission: at full resolution on a fold system it measured up to
    // ~15s of GPU, past the i915 7.5s preemption window — the
    // kernel-confirmed context-loss class. Sized from the prior, the probe
    // plans ~one strip target of predicted GPU and the real measurement
    // takes over from the second strip.
    if (SURFPERF) {
      console.log(
        `[surfperf] settle armed prior=${String(this.surfaceStripPriorMsPerPx())}` +
          ` worst=${this.surfaceStripWorstMsPerPx().toFixed(2)}` +
          ` evidenced=${String(this.surfaceStripEvidencedWorstMsPerPx)}` +
          ` partial=${this.surfaceStripPartialWorstMsPerPx.toFixed(3)}`,
      );
    }
    // fr-jf9y: the settle is the one live frame worth supersampling — it
    // is what a parked view finally shows, and the escape-time objects'
    // speckle is sub-pixel structure no march budget or viewport reaches
    // (fr-vpbq's measurement, on the engine this arm stands in for). Pass
    // 0 is armed exactly as it always was, below.
    this.beginSurfaceSamples(SURFACE_STRIP_SETTLE_SAMPLES, size.x, size.y);
    this.surfaceStripJob = this.newStripJob(
      createStripPlanner(size.y, size.x, {
        priorMsPerPx: this.surfaceStripPriorMsPerPx(),
        worstMsPerPx: this.surfaceStripWorstMsPerPx(),
      }),
      this.surfaceStripPriorMsPerPx(),
      SURFACE_SETTLE_PRESENT_MS,
    );
  }

  /**
   * Advance the settle job — pipelined strips against the shared queue
   * budget — and repaint the canvas with the progress (the traced strips
   * over the preview-seeded rest) on the pump's present-on-drain cadence.
   * Returns true when the frame is complete (the job is then disarmed).
   * No-op true when no job is running.
   *
   * "Complete" means the whole SUPERSAMPLING SEQUENCE since fr-jf9y: a
   * finished pass folds itself into the running mean and arms the next
   * one here, so the caller's loop is unchanged and its own settled flag
   * still means "this is the final image". Pass 0 lands exactly when it
   * always did.
   */
  stepSurfaceSettle(): boolean {
    if (!this.surfaceStripJob) return true;
    const { done, present } = this.renderSurfaceStrips(SURFACE_STRIP_QUEUE_MS);
    if (!done) {
      // Present into the pump's drain gap. Pass 0 shows its own strips
      // sharpening over the preview seed, exactly as this always did; a
      // LATER pass repaints the last completed image instead (fr-jf9y) —
      // the gap itself is what keeps the queue from running permanently
      // full, but the pass being traced over the target must not be shown
      // half-done.
      if (present) {
        if (
          this.surfaceSampleIndex === 0 ||
          !this.presentSurfaceSampleImage()
        ) {
          this.blitSurface(this.surfaceSettleTarget.texture, null);
        }
      }
      return false;
    }
    return this.advanceSurfaceSettleSample();
  }

  /**
   * A settle pass just completed (fr-jf9y): fold it in, present, and arm
   * the next one — or report the sequence finished.
   *
   * PASS 0 IS THE PRE-fr-jf9y SETTLE and is presented as one: the traced
   * target itself, at the moment it always arrived. Everything after it
   * only refines, and an abandon between passes leaves the canvas showing
   * the mean of what completed — never a partially traced pass, which is
   * why the later jobs repaint that mean into their drain gaps rather than
   * the target they are writing.
   */
  private advanceSurfaceSettleSample(): boolean {
    const target = this.surfaceSettleTarget;
    if (this.surfaceSampleTotal <= 1) {
      this.blitSurface(target.texture, null);
      return true;
    }
    const first = this.surfaceSampleIndex === 0;
    this.foldSurfaceSample();
    this.encodeSurfaceSampleMean();
    if (first || !this.presentSurfaceSampleImage()) {
      // Pass 0 presents its own TARGET — the pre-fr-jf9y settle, at the
      // moment it always arrived — and never the readback of it.
      this.blitSurface(target.texture, null);
    }
    this.surfaceSampleIndex += 1;
    if (this.surfaceSampleIndex >= this.surfaceSampleTotal) return true;
    if (SURFPERF) {
      console.log(
        `[surfperf] settle sample ${String(this.surfaceSampleIndex)}/` +
          `${String(this.surfaceSampleTotal)} armed`,
      );
    }
    this.surfaceStripJob = this.armSurfaceSamplePass(
      target.width,
      target.height,
    );
    return false;
  }

  /** Discard the in-flight settle job (a fresh invalidation supersedes
   * it). The settle target keeps its stale pixels; nothing reads them
   * until a new job re-seeds it. The completed-full-frame cost dies with
   * the pose too (fr-id9r): every invalidation lands here, so the
   * capture predictor can never price a pose the measurement didn't
   * see. */
  abandonSurfaceSettle(): void {
    // Settle fences pool for the NEXT preview to adopt (fr-7to5): the
    // abandon crosses render targets, but the GL queue is one — the
    // re-armed preview's strips execute behind these exact submissions.
    this.poolStripBacklog(this.surfaceStripJob);
    this.surfaceStripJob = null;
    this.surfaceFullPxCostMs = null;
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
    // The supersampled settle's own image is the MEAN, not the last pass
    // left in the target (fr-jf9y) — a re-present has to repaint what the
    // pane is already showing, or a recorder frame of a parked view would
    // be visibly noisier than the view it recorded.
    if (this.surfaceSampleMeanReady && this.presentSurfaceSampleImage()) return;
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
    // Every freshly armed job aims at the pixel CENTRE (fr-jf9y). This is
    // the ONE funnel each of them goes through, so resetting here is what
    // makes an abandoned supersampling pass unable to leak its jitter into
    // the preview, thumbnail or export that follows — and what keeps every
    // single-pass trace value-identical to the pre-fr-jf9y one. Only
    // {@link armSurfaceSamplePass} sets it otherwise, and only after this
    // has run for the sequence's first pass.
    (u.uPixelJitter.value as THREE.Vector4).set(0, 0, 0, 0);
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
   * Advance the in-flight settle job through {@link pumpStrips} —
   * pipelined fenced strips against the given queue budget (see
   * pumpStrips' doc for the regimes and why fences and readbacks bound
   * every submission where `gl.finish()` could not; the capture drains
   * pump the same way from their own loops, {@link drainStripsSync}).
   * Disarms the job when all pixels are traced.
   */
  private renderSurfaceStrips(queueBudgetMs: number): {
    done: boolean;
    present: boolean;
  } {
    const job = this.surfaceStripJob;
    if (!job) return { done: true, present: false };
    const result = this.pumpStrips(
      job,
      this.surfaceSettleTarget,
      queueBudgetMs,
    );
    const done = result.done;
    if (done) {
      this.retireStripJob(job, "completed");
      // The completed settle's whole-frame cost is the capture
      // predictor's best evidence (fr-id9r) — same tier, same pose;
      // it dies with the pose in abandonSurfaceSettle.
      this.surfaceFullPxCostMs = job.spentMs / Math.max(1, job.planner.totalPx);
      if (SURFPERF) {
        const t = this.surfaceSettleTarget;
        console.log(
          `[surfperf] settle complete ${t.width}x${t.height}` +
            ` spentMs=${job.spentMs.toFixed(1)}` +
            ` wall=${(performance.now() - job.stat.t0).toFixed(0)}` +
            ` strips=${job.stat.strips} polls=${job.stat.polls}` +
            ` calls=${job.stat.calls} presents=${job.stat.presents}`,
        );
      }
      this.surfaceStripJob = null;
    }
    return result;
  }

  /**
   * The shared strip pump under both the settle job and the preview job
   * (fr-du81/fr-096u): collect completed strips, submit new ones, report
   * completion and when the caller should present. THE cost model this
   * pump exists for, measured on Mesa/Iris (fr-096u's perf review): a
   * forced-completion readback costs ~10-25ms REGARDLESS of strip size,
   * so per-strip joins multiply that floor by the planner's strip count —
   * the capped fold frames that keep submissions watchdog-safe plan
   * THOUSANDS of strips, and joining each one turned a measured ~2s of
   * GPU into ~55s of drains where main's ~50 uncapped strips paid ~1s.
   * Fences amortize the floor to ~50us/strip; the caps become free.
   *
   * EVERY surface trace runs through this pump: the live preview and settle
   * one budget per rAF, the capture and offline drains in their own loops
   * (fr-y6m0 — they used to join every strip themselves, which is the same
   * multiplication in export clothing). The drains differ from the live
   * callers in exactly two ways: how they WAIT between pump calls (a
   * blocking {@link joinStripQueue} for the synchronous one, a hand-back for
   * the yielding one) and that they never present.
   *
   * Two regimes:
   *
   * - SYNC COLLAPSE (`msPerPxEstimate` null — affine-cheap systems, no
   *   cost prior): render strips and join each with the forced-completion
   *   readback in a tight loop, exactly the legacy single-call behavior —
   *   a light preview/settle completes right here in a handful of strips,
   *   and the few drains are cheaper than a frame of fence latency. A
   *   strip measuring past {@link SURFACE_STRIP_SYNC_ESCAPE_MS} is the
   *   "not actually light" signal: its measurement seeds the estimate and
   *   every later call runs pipelined.
   * - PIPELINED (estimate known — fold-class priors or any measured
   *   system): every strip goes out as its own flushed draw group closed
   *   by a fence, ~{@link SURFACE_STRIP_QUEUE_MS} of PREDICTED work rides
   *   in flight, and the pump NEVER blocks. Completed fences are measured
   *   in batches per poll ({@link collectStripFences} — the busy wall since
   *   the queue last had work, attributed across the batch's pixels; poll
   *   timestamps quantize to the caller's clock, so cheap batches read
   *   high, which only over-queues cheap regions, and at saturation, where
   *   pricing matters, it is accurate). The
   *   estimate feeds the planner as `estimate x lastSubmittedPx` (the
   *   shape its sizing formula expects) and spikes the moment a batch
   *   lands in an expensive band, emptying the refill behind it. The
   *   estimate is also one whole batch BEHIND reality, and fold frames
   *   are 100-1000x bimodal — so the refill ALSO prices the queue at the
   *   job's queue price, raised live by the planner's ratcheted
   *   observations ({@link SURFACE_STRIP_QUEUE_WORST_MS}; fr-id9r): an
   *   est-lagged cost-band entry used to ride the queue as whole seconds
   *   of unpredicted work (measured 16-22s groups in the fr-096u
   *   stale-evidence incident, ~3s main-thread stalls once per crease
   *   pixel) that everything touching the GL stream then stalled behind;
   *   queue-pricing bounds that exposure at ~one worst-capped strip
   *   beyond the strip executing, while the evidence-relaxed price keeps
   *   the bound above the est-priced budget on measured-cheap systems
   *   (so the fast paths never feel it).
   *   PRESENT-ON-DRAIN: canvas blits ride the same GL queue as strips, so
   *   presenting behind a deep queue would stall the page's own frames
   *   (the first pipelined cut measured multi-second rAF beats) — instead,
   *   every `presentIntervalMs` the pump stops refilling, lets the queue
   *   drain, and tells the caller to present into the gap.
   */
  private pumpStrips(
    job: SurfaceStripJob,
    target: THREE.WebGLRenderTarget,
    queueBudgetMs: number,
  ): { done: boolean; present: boolean } {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (job.presentDue === 0) {
      job.presentDue = performance.now() + job.presentIntervalMs;
      job.stat.t0 = performance.now();
    }
    job.stat.calls += 1;
    // Sync collapse only with an EMPTY queue: a no-prior job that
    // adopted a backlog (fr-7to5) must poll the inherited fences out
    // first — a forced-completion join here would block the main thread
    // behind the whole backlog and attribute it to one strip. The first
    // completed batch below seeds the estimate, and the job continues
    // pipelined.
    if (job.msPerPxEstimate === null && job.inFlight.length === 0) {
      const escaped = this.collapseStripsSync(job, target);
      if (!escaped) return { done: true, present: true };
    }
    // Pipelined regime: retire whatever the GPU has finished, then refill.
    this.collectStripFences(job);
    let now = performance.now();
    let present = false;
    if (job.inFlight.length === 0 && now >= job.presentDue) {
      // The queue is drained on schedule: present into the gap and let
      // the NEXT call refill — submitting first would queue the caller's
      // blit behind the fresh strips.
      present = true;
      job.stat.presents += 1;
      job.presentDue = now + job.presentIntervalMs;
    } else {
      // Refill in FENCE GROUPS: each strip is its own flushed draw group
      // (the preemption boundary the watchdog needs), but the ~80ms sync
      // service cost is paid once per group, not per strip.
      let submits = 0;
      let groupPx = 0;
      let groupStrips = 0;
      const est = (): number => job.msPerPxEstimate ?? 0;
      const worst = (): number =>
        Math.max(job.queueWorstMsPerPx, job.planner.observedWorstMsPerPx);
      const closeGroup = (): boolean => {
        if (groupPx === 0) return true;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!sync) return false;
        job.busyMark ??= performance.now();
        job.inFlight.push({ sync, px: groupPx, inherited: false });
        job.inFlightPx += groupPx;
        groupPx = 0;
        groupStrips = 0;
        return true;
      };
      while (
        // No refill while an adopted backlog rides unmeasured (fr-7to5):
        // est() would read 0 and admit unbounded strips behind a queue
        // whose cost nothing has priced yet. The first completed batch
        // seeds the estimate and refill resumes. Every other path into
        // this loop carries a non-null estimate (prior-seeded, batch-
        // attributed, or the sync-collapse escape's own measurement).
        job.msPerPxEstimate !== null &&
        now < job.presentDue &&
        submits < SURFACE_STRIP_MAX_SUBMITS_PER_PUMP &&
        (job.inFlightPx + groupPx) * est() < queueBudgetMs &&
        // Queue-priced twin of the line above (fr-id9r): the estimate
        // lags a cost-band entry by a whole fence batch, so the queue is
        // ALSO bounded at the job's queue price raised by the planner's
        // own ratcheted observations — an empty queue always admits one
        // strip, so the degenerate case is one worst-capped strip riding
        // alone, never a stall.
        (job.inFlightPx + groupPx) * worst() < SURFACE_STRIP_QUEUE_WORST_MS
      ) {
        const strip = job.planner.next(seedStripMeasurement(job));
        if (!strip) break;
        this.renderStripRects(target, strip.rects);
        // The flush hands the strip to the GPU as its own submission now —
        // without it the whole group would ride one oversized submission
        // with no preemption boundaries inside it.
        gl.flush();
        job.lastSubmittedPx = strip.px;
        job.stat.strips += 1;
        groupPx += strip.px;
        groupStrips += 1;
        if (
          groupPx * est() >= SURFACE_STRIP_FENCE_GROUP_MS ||
          groupStrips >= SURFACE_STRIP_FENCE_GROUP_MAX
        ) {
          if (!closeGroup()) {
            // Dying context (fenceSync failed): join what the group has
            // with the forced-completion readback so the job still
            // terminates — correctness over smoothness.
            const t0 = performance.now();
            this.readStripCorner(gl, strip);
            const ms = performance.now() - t0;
            job.spentMs += ms;
            job.msPerPxEstimate = ms / Math.max(1, groupPx);
            job.planner.observe(ms, groupPx);
            job.measured = true;
            groupPx = 0;
            groupStrips = 0;
          }
        }
        submits += 1;
        now = performance.now();
      }
      if (!closeGroup()) {
        // Same dying-context degrade for a trailing open group.
        const gl2 = gl;
        gl2.readPixels(0, 0, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, SYNC_PIXEL);
        groupPx = 0;
      }
    }
    this.resetScissor(target);
    return { done: job.planner.done && job.inFlight.length === 0, present };
  }

  /**
   * Retire every fence at the head of `job`'s queue that the GPU has
   * finished, attribute the busy wall since the last observation across the
   * batch, and teach the planner what it measured. The pump's first act on
   * every call — and the whole of what an aborting capture drain still owes
   * its own queue ({@link windDownStrips}).
   *
   * `assumeComplete` retires the queue WITHOUT polling it, and only
   * {@link drainStripsSync} passes it, only immediately after a
   * {@link joinStripQueue}. The second reason for it is not an
   * optimisation. The readback is a strictly stronger barrier than the
   * fences it retires — every command submitted before it has executed, so
   * every fence behind it is signaled by construction — and MEASURED, a
   * sync object's signaled state is NOT observable from a loop that never
   * returns to the event loop: `clientWaitSync(sync, 0, 0)` is a
   * client-side check against state the command buffer refreshes on the
   * page's own message loop, so a synchronous drain that polls it reads
   * TIMEOUT_EXPIRED forever. The pump then collects nothing, the queue
   * bound blocks every refill, and the drain spins on a queue the GPU
   * finished long ago — measured as a thumbnail capture going from 4.3s to
   * a >300s hang, with `spentMs` frozen at 0 so even the spend ceiling
   * could not end it. The yielding drain never meets this: its ticks ARE
   * the message loop.
   *
   * When polling, completion is in submission order (one GL queue), so the
   * first still-running fence ends the batch. Time lands in three places
   * with three different rules, all of them load-bearing:
   *
   * - `spentMs` — THIS frame's cost (the governor sample, the px-cost
   *   fields, the capture spend ceiling) — takes only the OWN-pixel share:
   *   inherited fences traced a superseded pose's frame (fr-7to5).
   * - the estimate and the planner's ratchet take the WHOLE batch: that
   *   wall really did trace that many pixels of this system, and the
   *   ratchet is a max, so a cheap inherited batch cannot lower it.
   * - the busy MARK re-bases only when time was just attributed (or the
   *   queue drained): advancing it on a completion-less poll would silently
   *   discard the GPU-busy time since the previous poll, and both `spentMs`
   *   and the estimate would read low by exactly the discarded share.
   */
  private collectStripFences(
    job: SurfaceStripJob,
    assumeComplete = false,
  ): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const now = performance.now();
    let completedPx = 0;
    let completedOwnPx = 0;
    let completedCount = 0;
    while (job.inFlight.length > 0) {
      const head = job.inFlight[0];
      if (
        !assumeComplete &&
        gl.clientWaitSync(head.sync, 0, 0) === gl.TIMEOUT_EXPIRED
      ) {
        break;
      }
      // Signaled (or WAIT_FAILED on a dying context — treat as done
      // rather than polling forever): account it.
      gl.deleteSync(head.sync);
      job.inFlight.shift();
      job.inFlightPx -= head.px;
      if (head.inherited) {
        job.inheritedPx -= head.px;
      } else {
        completedOwnPx += head.px;
      }
      completedPx += head.px;
      completedCount += 1;
    }
    if (completedCount > 0) {
      const busyMs = now - (job.busyMark ?? now);
      job.spentMs += busyMs * (completedOwnPx / completedPx);
      // MARGINAL px rate: subtract the fixed sync tax the batch's fence
      // observation cost, floored at 5% of the raw figure so a cheap
      // stack cannot drive the estimate to zero.
      const marginalMs = Math.max(
        busyMs - SURFACE_STRIP_SYNC_TAX_MS,
        busyMs * 0.05,
      );
      job.msPerPxEstimate = marginalMs / Math.max(1, completedPx);
      // Report at measurement time (fr-id9r): the `prevMs` door on
      // next() never hears about a job's LAST batch — which is exactly
      // the batch that discovers the expensive band on frames traced
      // top-down toward the surface.
      job.planner.observe(marginalMs, completedPx);
      job.measured = true;
      job.stat.polls += 1;
      if (SURFPERF && busyMs > SURFPERF_HEAVY_STRIP_MS) {
        console.log(
          `[surfperf] heavy batch px=${completedPx}` +
            ` strips=${completedCount} ms=${busyMs.toFixed(0)}`,
        );
      }
    }
    if (completedCount > 0 || job.inFlight.length === 0) {
      job.busyMark = job.inFlight.length > 0 ? now : null;
    }
  }

  /** The sync-collapse regime of {@link pumpStrips}: serial strips with
   * forced-completion joins, the legacy whole-job-in-one-call behavior
   * for systems with no cost prior. Returns true when a strip measured
   * past {@link SURFACE_STRIP_SYNC_ESCAPE_MS} — the caller then continues
   * pipelined with the measurement as its seed estimate — false when the
   * job completed here. */
  private collapseStripsSync(
    job: SurfaceStripJob,
    target: THREE.WebGLRenderTarget,
  ): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    let lastMs: number | null = null;
    let strip = job.planner.next(lastMs);
    while (strip) {
      this.renderStripRects(target, strip.rects);
      const t0 = performance.now();
      this.readStripCorner(gl, strip);
      lastMs = performance.now() - t0;
      job.spentMs += lastMs;
      job.lastSubmittedPx = strip.px;
      // Measurement-time report (fr-id9r): the final strip's — and an
      // escaping strip's — measurement never reaches next().
      job.planner.observe(lastMs, strip.px);
      if (SURFPERF && lastMs > SURFPERF_HEAVY_STRIP_MS) {
        console.log(
          `[surfperf] heavy strip px=${strip.px} ms=${lastMs.toFixed(0)}`,
        );
      }
      if (lastMs > SURFACE_STRIP_SYNC_ESCAPE_MS) {
        job.msPerPxEstimate =
          Math.max(lastMs - SURFACE_STRIP_SYNC_TAX_MS, lastMs * 0.05) /
          Math.max(1, strip.px);
        job.measured = true;
        this.resetScissor(target);
        return true;
      }
      strip = job.planner.next(lastMs);
    }
    this.resetScissor(target);
    return false;
  }

  /**
   * The capture/offline drain ({@link renderSurface}'s full tier calls
   * this): run the job to completion right here, through the same
   * {@link pumpStrips} the live settle rides — pipelined fence groups, not
   * the per-strip forced-completion joins this drain used to pay (fr-y6m0).
   * The old shape bought exact per-strip measurements at one
   * ~{@link SURFACE_STRIP_SYNC_TAX_MS} sync point PER STRIP, and a capped
   * frame plans hundreds to thousands of them: measured on SwiftShader at
   * 1280x720, a Save-PNG of a pose the live settle finished in 19s had
   * covered ~37% when it hit the 60s spend ceiling. Now the queue carries
   * the frame and a synchronous caller pays ONE sync point per queueful
   * ({@link joinStripQueue}) — the wait it has instead of a yield.
   *
   * Tolerate is not "forever" (fr-id9r): a monster fold pose prices a frame
   * in hours of frozen tab, and THIS drain really does freeze it — its
   * callers have no modal, no percentage and no Cancel — so past
   * `spendCeilingMs` ({@link SURFACE_CAPTURE_SPEND_CEILING_MS}) of measured
   * spend it gives up and returns false, and the caller surfaces the
   * refusal. The yielding drain, which has all three, is bounded by the
   * user instead (fr-avf6). Giving up winds the queue down first (see
   * {@link windDownStrips} for why the fences cannot simply be left
   * behind).
   */
  private drainStripsSync(
    job: SurfaceStripJob,
    target: THREE.WebGLRenderTarget,
    spendCeilingMs: number,
  ): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (;;) {
      if (this.pumpStrips(job, target, SURFACE_STRIP_QUEUE_MS).done) {
        return true;
      }
      const abort = job.spentMs > spendCeilingMs;
      // The pump has queued everything the budget admits, so nothing can
      // advance until the GPU catches up: block on the queue rather than
      // spin. The retire that follows must NOT poll the fences the join
      // just made moot — a loop that never reaches the message loop cannot
      // observe a sync object signal (see collectStripFences) — so it is
      // also the whole of the abort path's wind-down.
      this.joinStripQueue(gl, target);
      this.collectStripFences(job, true);
      if (abort) return false;
    }
  }

  /**
   * {@link drainStripsSync}, yielding (fr-7mfx): the same pump, the same
   * fence groups, the same spend backstop — but between pump calls it hands
   * the main thread back ({@link nextDrainTick}) instead of blocking on a
   * join, so the export modal can paint its coverage and its Cancel button
   * can actually be clicked. Without this the modal would open on an
   * already frozen tab and read as a hang: worse than no modal at all.
   *
   * The hand-back is safe precisely here: every strip's measurement is
   * already folded into the job and the planner, the scissor state is
   * unwound by each pump call and re-established by the next, and the
   * queue's fences are POLLED, never waited on. What it does NOT survive is
   * another writer: the caller must fence the live tier off for the
   * duration ({@link surfaceCaptureBusy}), or a preview tick would clobber
   * the frozen full-tier uniforms and a settle would re-size the target
   * being drained. main.ts's tick does exactly that — for the tracing arms,
   * and (fr-p0mr) for the two uniform writers that used to sit outside the
   * guard: a live 4D view push, which would have split an exported frame
   * across two hyperplanes, and a late grid upload.
   *
   * Since fr-y6m0 the main thread never blocks on GPU work at all, so
   * responsiveness no longer bottoms out at one strip's cost (the planner
   * caps a strip at `STRIP_WORST_CASE_CAP_MS` of predicted GPU, and on a
   * monster fold pose single crease pixels have measured 1.7-3.1s): a
   * cancel is observed within a tick even while such a strip executes.
   * What a cancel still waits for is the queue it already submitted.
   *
   * There is no spend ceiling here (fr-avf6). This drain runs exactly as
   * long as the user lets it: `cancelled` is the stop, `onProgress` is the
   * basis they stop on, and an abort the app decided for itself would be
   * the same patience-guessing fr-zx34 reverted for the preview tier — and
   * worse timed, since it would arrive after a minute of watching a
   * percentage climb. {@link drainStripsSync} keeps its ceiling: its
   * callers have neither a percentage nor a Cancel.
   */
  private async drainStripsAsync(
    job: SurfaceStripJob,
    target: THREE.WebGLRenderTarget,
    hooks: {
      onProgress?: (fraction: number) => void;
      cancelled?: () => boolean;
    },
  ): Promise<SurfaceDrainOutcome> {
    for (;;) {
      if (this.pumpStrips(job, target, SURFACE_STRIP_QUEUE_MS).done) {
        return "done";
      }
      hooks.onProgress?.(stripJobCoverage(job));
      await nextDrainTick();
      if (hooks.cancelled?.() === true) {
        return this.windDownStrips(job, "cancelled");
      }
    }
  }

  /**
   * Let an abandoned capture's already-submitted strips finish before the
   * drain returns (fr-y6m0). The queued GPU work cannot be recalled, and an
   * export's leftovers are the last thing the live tier should inherit: the
   * strips write the EXPORT-SIZED settle target, which the next settle
   * re-sizes (reallocating texture and framebuffer) the moment it takes the
   * pane back — defined behaviour in GL, but not a queue worth leaving
   * outstanding for a live job to price, attribute and draw behind.
   * Attribution is the sharper half: the fences are THIS frame's, so
   * collecting them here charges their wall to the frame that submitted
   * them rather than to whichever live job observes the queue next
   * (fr-7to5's contamination, one queueful of it).
   *
   * The wait costs the queue's own remaining time, with the main thread
   * free throughout. That is what a cancel waits for, and it is not free:
   * the refill admitted {@link SURFACE_STRIP_QUEUE_WORST_MS} of work priced
   * at the job's QUEUE price (the typical-cost class floor, fr-id9r), so a
   * queue that entered an expensive band before the planner's ratchet
   * caught it can hold several worst-capped strips — low seconds on the
   * measured transition class, the same order the per-strip drain's cancel
   * already cost while a crease strip joined. Once the ratchet has seen the
   * band the queue pins to ~one strip and a cancel is near-instant.
   */
  private async windDownStrips(
    job: SurfaceStripJob,
    outcome: SurfaceDrainOutcome,
  ): Promise<SurfaceDrainOutcome> {
    while (job.inFlight.length > 0) {
      await nextDrainTick();
      this.collectStripFences(job);
    }
    return outcome;
  }

  /** Block until every strip the pump has submitted has executed: a 1x1
   * readback from the target they wrote is a data dependency the whole GL
   * queue must clear first (`gl.finish()` returns early on some
   * command-buffer paths — see {@link readStripCorner}). The synchronous
   * drain's wait, paid once per QUEUEFUL where that drain used to pay the
   * same ~{@link SURFACE_STRIP_SYNC_TAX_MS} once per STRIP (fr-y6m0). */
  private joinStripQueue(
    gl: WebGL2RenderingContext,
    target: THREE.WebGLRenderTarget,
  ): void {
    this.renderer.setRenderTarget(target);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    this.renderer.setRenderTarget(null);
  }

  /** Render one strip's 1-3 scissor rects (fr-096u: sub-row strips are
   * what let the planner bound fold submissions below one row's cost).
   * All of a strip's rects belong to ONE submission — the bounded
   * quantity is the strip's pixel count, which the planner sized. */
  private renderStripRects(
    target: THREE.WebGLRenderTarget,
    rects: Strip["rects"],
  ): void {
    target.scissorTest = true;
    for (const r of rects) {
      target.scissor.set(r.x, r.y, r.w, r.h);
      // setRenderTarget re-applies the target's scissor each call — the
      // r185 idiom for scissored render-target draws.
      this.renderer.setRenderTarget(target);
      this.surfaceQuad.render(this.renderer);
    }
  }

  /** Forced-completion join on a strip: read a corner of its LAST rect
   * while the target is still bound — freshly written pixels, so the read
   * is a data dependency on the whole strip (`gl.finish()` returns early
   * on some command-buffer paths; a readback cannot). */
  private readStripCorner(gl: WebGL2RenderingContext, strip: Strip): void {
    const last = strip.rects[strip.rects.length - 1];
    gl.readPixels(last.x, last.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
  }

  /** Undo strip scissoring on `target` and unbind it. */
  private resetScissor(target: THREE.WebGLRenderTarget): void {
    target.scissorTest = false;
    target.scissor.set(0, 0, target.width, target.height);
    this.renderer.setRenderTarget(null);
  }

  /** Move a superseded/abandoned job's in-flight fences into
   * {@link surfaceStripBacklog} (fr-7to5) instead of deleting them — the
   * queued GPU work cannot be recalled, so the next job to arm must see
   * it (queue admission) and attribute its completion honestly (busy
   * continuity). Entries append in submission order; the pool's busyMark
   * keeps the OLDEST busy origin so no busy time is dropped between
   * jobs. A job with an empty queue pools nothing. */
  private poolStripBacklog(job: SurfaceStripJob | null): void {
    if (!job || job.inFlight.length === 0) return;
    const busyMark = job.busyMark ?? performance.now();
    const pool = (this.surfaceStripBacklog ??= {
      entries: [],
      px: 0,
      busyMark,
      predictedMs: 0,
    });
    pool.busyMark = Math.min(pool.busyMark, busyMark);
    // What this job's own estimate says its queue still owes — the clamp
    // adoption needs on a pool nobody claimed promptly (fr-y6m0). A job
    // with NO estimate can still hold fences (it adopted a backlog and was
    // superseded before a batch landed), and pricing that queue at zero
    // would hand the next adopter `busyMark = now`: a first batch measuring
    // ~0ms/px, which is the one estimate the refill's own doc calls
    // dangerous. Unpriced means unclamped — the honest bound on unknown
    // work is no bound.
    pool.predictedMs +=
      job.msPerPxEstimate === null
        ? Number.POSITIVE_INFINITY
        : job.inFlightPx * job.msPerPxEstimate;
    for (const f of job.inFlight) {
      pool.entries.push({ sync: f.sync, px: f.px });
      pool.px += f.px;
    }
    job.inFlight = [];
    job.inFlightPx = 0;
    job.inheritedPx = 0;
  }

  /** Adopt the pooled backlog into a freshly armed `job`: its refill
   * ceiling starts against the REAL GL queue, and its first fence batch
   * attributes the busy wall over backlog + own pixels instead of
   * charging the whole backlog to its own strips (fr-7to5's 90x
   * contamination). `spentMs` stays clean — the pump excludes the
   * inherited share (those pixels belong to a superseded pose's frame,
   * not this one's cost). */
  private adoptStripBacklog(job: SurfaceStripJob): void {
    const pool = this.surfaceStripBacklog;
    if (!pool) return;
    this.surfaceStripBacklog = null;
    job.inFlight = pool.entries.map((e) => ({ ...e, inherited: true }));
    job.inFlightPx = pool.px;
    job.inheritedPx = pool.px;
    // Busy continuity, bounded by what the pooled work could still owe
    // (fr-y6m0): the normal adoption is a frame or two after pooling, where
    // the clamp is inert; the pathological one is a pool that waited out an
    // idle stretch (a cancelled export leaves the pane parked, and a parked
    // pane arms nothing), where crediting the whole wait as GPU busy would
    // spike the estimate and ratchet the planner's worst-price evidence off
    // a queue that had long since finished.
    job.busyMark = Math.max(
      pool.busyMark,
      performance.now() - pool.predictedMs,
    );
    if (SURFPERF) {
      console.log(
        `[surfperf] adopted backlog px=${pool.px}` +
          ` groups=${pool.entries.length}`,
      );
    }
  }

  /** Delete the pooled backlog's fences without adoption — for the entry
   * points that must NOT price or attribute a predecessor's queue: a
   * system upload (fresh evidence chain, cross-system observations would
   * seed it wrong) and the settle's clean-probe barrier, which has just
   * joined the whole queue anyway. The GPU work itself still drains
   * FIFO. */
  private flushStripBacklog(): void {
    const pool = this.surfaceStripBacklog;
    if (!pool) return;
    this.surfaceStripBacklog = null;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (const f of pool.entries) gl.deleteSync(f.sync);
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
   * Save-PNG source while the surface render is active: trace the frame at
   * export resolution into the settle target, then present and read it back
   * in ONE synchronous span at the export pixel ratio — the same two-phase
   * shape as {@link captureSurfaceComputeFrame}, and for the same reason:
   * the paint and the `toBlob` snapshot must share a task (the renderer
   * runs without `preserveDrawingBuffer`), but the TRACE must not, because
   * it can run for minutes.
   *
   * That split is fr-7mfx's prerequisite. The drain used to run inside the
   * ratio/projection wrappers with no yield, freezing the tab for its whole
   * duration; now it hands the main thread back on every
   * {@link nextDrainTick} between pump calls, so the export modal can
   * disclose coverage and offer a working Cancel. Two consequences follow. The
   * export pixel ratio is NOT held across the trace — the size is derived
   * arithmetically instead (three.js floors a buffer out of a ratio the
   * same way), so the live canvas keeps its own buffer and nothing giant
   * ever reaches the screen mid-drain. And the centered projection
   * (fr-936q) wraps only the arming call, because
   * {@link setSurfaceFrameUniforms} snapshots the camera into uniforms and
   * the drain never reads it again.
   *
   * `opts.onProgress` reports traced coverage in [0, 1]; `opts.cancelled`
   * is polled at every tick and resolves the capture `null` — the caller
   * knows it asked, so it owns the difference between "cancelled" and "the
   * browser refused the encode".
   *
   * NO COST CEILING RUNS HERE (fr-avf6). fr-id9r's predict refusal and
   * spend abort were written for a drain that froze the tab for its whole
   * duration, where refusing was the only protection there was. This one
   * yields, discloses measured coverage and stops the instant the user
   * says so — so a refusal would only be the app guessing at a patience
   * the user is already expressing, off a prediction measured to
   * over-predict ~4x, on a button whose WebGPU arm has never refused
   * anything. The ceilings stay where nobody is watching:
   * {@link renderSurface}'s full tier, which offline export and thumbnails
   * drain synchronously with no way to interrupt a frame.
   */
  async captureSurfaceFrame(
    exportScale = 1,
    opts?: {
      onProgress?: (fraction: number) => void;
      cancelled?: () => boolean;
    },
  ): Promise<ExportImage | null> {
    // A compute session never compiled the fold GLSL (fr-tzdg). main.ts
    // routes captures to captureSurfaceComputeFrame before this can
    // matter; refusing keeps an accidental caller from paying the ~25s
    // Mesa link the mode exists to avoid.
    if (this.surfaceComputeActive) return null;
    const ratio = this.exportPixelRatio(exportScale);
    const width = Math.floor(this.viewportWidth * ratio);
    const height = Math.floor(this.viewportHeight * ratio);
    const arm = this.withCenteredProjection(() =>
      this.beginSurfaceFullFrame(width, height, false),
    );
    // fr-jf9y: a saved PNG gets the same supersampling the pane it was
    // saved from does, exactly as on the WebGPU arm (fr-vpbq) — the
    // aliasing is scale-invariant, so exporting larger does not fix it and
    // an unsampled export would be visibly worse than the screen it came
    // from. Coverage below spans the passes, and Cancel lands between them.
    this.beginSurfaceSamples(SURFACE_STRIP_SETTLE_SAMPLES, width, height);
    this.surfaceCaptureFlight = true;
    // Definite by the loop's first iteration; the initializer only tells
    // the compiler the `finally` cannot see it unassigned.
    let outcome!: SurfaceDrainOutcome;
    let job = arm.job;
    try {
      for (;;) {
        const pass = this.surfaceSampleIndex;
        // Each pass retires on its OWN completed measurement, so a cancel
        // mid-sequence restores the last pass that finished rather than
        // the pre-capture prior (finishSurfaceFullFrame's rule, applied
        // per pass because each pass IS a full frame at this pose).
        const passArm = {
          job,
          priorPxCostMs:
            pass === 0 ? arm.priorPxCostMs : this.surfaceFullPxCostMs,
        };
        outcome = await this.drainStripsAsync(job, this.surfaceSettleTarget, {
          onProgress: opts?.onProgress
            ? (fraction) =>
                opts.onProgress?.(
                  (pass + fraction) / Math.max(1, this.surfaceSampleTotal),
                )
            : undefined,
          cancelled: opts?.cancelled,
        });
        // "cancelled" returns having restored the evidence the arming
        // discarded, so the next export prices this pose from what already
        // measured it.
        this.finishSurfaceFullFrame(passArm, width * height, outcome);
        if (outcome !== "done" || this.surfaceSampleTotal <= 1) break;
        this.foldSurfaceSample();
        this.encodeSurfaceSampleMean();
        this.surfaceSampleIndex = pass + 1;
        if (this.surfaceSampleIndex >= this.surfaceSampleTotal) break;
        job = this.armSurfaceSamplePass(width, height);
      }
    } finally {
      this.surfaceCaptureFlight = false;
    }
    if (outcome === "cancelled") return null;
    // A viewport resize during the drain leaves the traced target and the
    // canvas the blit lands on at different sizes — the export would be a
    // scaled, half-stale frame. Rare (the modal's scrim covers the app,
    // but not the window chrome), so refuse rather than ship a torn image.
    if (
      Math.floor(this.viewportWidth * ratio) !== width ||
      Math.floor(this.viewportHeight * ratio) !== height
    ) {
      return null;
    }
    return this.withPixelRatio(ratio, () => {
      // The mean of the completed passes (fr-jf9y), or — for a single-pass
      // export, and for every caller that predates supersampling — the
      // traced target itself, byte for byte as before.
      if (this.surfaceSampleTaken < 2 || !this.presentSurfaceSampleImage()) {
        this.blitSurface(this.surfaceSettleTarget.texture, null);
      }
      return exportImageFrom(this.renderer.domElement);
    });
  }

  /**
   * The pixel dimensions a still export at `exportScale` will produce —
   * what the export progress modal names so the user can see what they
   * asked for (fr-7mfx). Matches the arithmetic three.js applies when it
   * derives a drawing buffer from a pixel ratio.
   */
  exportSize(exportScale = 1): { width: number; height: number } {
    const ratio = this.exportPixelRatio(exportScale);
    return {
      width: Math.floor(this.viewportWidth * ratio),
      height: Math.floor(this.viewportHeight * ratio),
    };
  }

  /**
   * Measured evidence for what a surface capture at `exportScale` would
   * cost, or null when nothing survives to predict from (fr-7mfx). The
   * export modal uses it for ONE decision — whether to skip the grace
   * period and show at once — and deliberately never displays it: the same
   * number over-predicts by ~4x off preview evidence (see
   * {@link predictSurfaceFullCostMs}), which is exactly the patience-
   * guessing fr-zx34 reverted. Coverage and elapsed are measured; a
   * predicted total would not be.
   */
  predictSurfaceCaptureMs(exportScale = 1): number | null {
    const { width, height } = this.exportSize(exportScale);
    return this.predictSurfaceFullCostMs(width * height);
  }

  /**
   * Whether an async capture drain (fr-7mfx) currently owns the surface
   * tracer. It yields to the event loop, so the rAF loop runs DURING a
   * capture — main.ts's surface tick stands aside on this, which is what
   * keeps a preview from clobbering the frozen full-tier uniforms and a
   * settle from re-sizing the target being drained.
   */
  get surfaceCaptureBusy(): boolean {
    return this.surfaceCaptureFlight;
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
/** Scratch for `applyFogColor`'s tint lerp (fr-5h5d). */
const FOG_TINT_COLOR = new THREE.Color();
/** Scratch for `renderSurface`'s per-call drawing-buffer query. */
const DRAW_SIZE = new THREE.Vector2();
/** Predicted in-flight GPU work (ms) the pipelined strip pump keeps
 * queued (fr-096u): deep enough to saturate the GPU between rAF polls,
 * short enough that a present-on-drain gap or an interrupting
 * invalidation waits behind at most a few hundred milliseconds of stale
 * strips. */
const SURFACE_STRIP_QUEUE_MS = 600;
/** Present cadence (ms) for the preview job's progressive fill — tight:
 * it is the interactive tier. */
const SURFACE_PREVIEW_PRESENT_MS = 200;
/** Present cadence (ms) for the settle job's progressive sharpening —
 * the view is parked; fewer drain gaps means better GPU utilization. */
const SURFACE_SETTLE_PRESENT_MS = 600;
/**
 * Supersampling passes the WebGL settle and the interactive Save-PNG spend
 * (fr-jf9y) — main.ts's `SURFACE_COMPUTE_SETTLE_SAMPLES` for the WebGPU
 * arm, deliberately the same number: the two engines render the same
 * document, and "how much antialiasing does this app do" must not depend
 * on which one a machine happens to have. Pass 0 lands when the settle
 * always landed, so the count buys refinement time, never first-image
 * time.
 */
const SURFACE_STRIP_SETTLE_SAMPLES = /* @__PURE__ */ resolveSettleSamples();

/**
 * `?surfacesamples=N` (fr-jf9y): the A/B override for the supersampling
 * count, `?surfshadewidth=N`'s precedent one module over — and for the
 * same reason. N=1 turns the settle and the Save-PNG back into the exact
 * single-pass traces this arm made before supersampling, on the SAME
 * build, so "pass 0 is value-identical" is a byte comparison anyone can
 * rerun rather than an argument. Out-of-range or unparseable falls back to
 * the shipped 8.
 */
function resolveSettleSamples(): number {
  const shipped = 8;
  if (typeof window === "undefined") return shipped;
  const raw = new URLSearchParams(window.location.search).get("surfacesamples");
  if (raw === null) return shipped;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : shipped;
}
/** Gamma the surface tracers encode their output with — the
 * `pow(lit, 1/2.2)` that ends surface-material.ts's shade path and its 4D
 * twin. fr-jf9y's averaging has to undo it before summing and reapply it
 * after, or antialiased edges come out too dark (surface-compute.ts states
 * the same constant for the WebGPU arm's accumulator; if a third consumer
 * ever appears, hoist it). */
const SURFACE_OUTPUT_GAMMA = 2.2;
/** Decode table for that gamma: byte -> linear light. 256 entries, so a
 * pass costs a lookup per channel rather than a `Math.pow` per channel per
 * pixel. */
const SRGB_TO_LINEAR = /* @__PURE__ */ (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = Math.pow(i / 255, SURFACE_OUTPUT_GAMMA);
  }
  return table;
})();
/** Cap on strips submitted per pump call — bounds the refill loop's own
 * CPU cost (draw setup + flush per strip) per animation frame when the
 * estimate prices strips near-free. */
const SURFACE_STRIP_MAX_SUBMITS_PER_PUMP = 256;
/** Predicted cost (ms) at which a fence group closes. MEASURED (fr-096u
 * A/B): every sync point — fence observation or forced-completion
 * readback alike — costs ~66-90ms of wall on this stack REGARDLESS of the
 * strips behind it, which made per-strip fences cost `strips x 80ms` (the
 * whole main-vs-branch settle gap: ~50 strips on main vs hundreds under
 * the safety caps). Strips still go out as individually flushed draw
 * groups — the flush is the watchdog's preemption boundary — but only
 * every ~this much predicted work pays a fence, so the sync tax is
 * amortized across the group while measurement granularity stays useful
 * for the planner. */
const SURFACE_STRIP_FENCE_GROUP_MS = 300;
/** Strip count at which a fence group closes regardless of predicted
 * cost — bounds how much REAL work an estimate-lagged group can hold at
 * a cost-band entry (each strip is individually capped, so a group is at
 * most this many worst-case strips), and keeps a mispriced cheap run
 * from riding one fence so long that a batch measurement means
 * nothing. */
const SURFACE_STRIP_FENCE_GROUP_MAX = 8;
/** Fixed cost (ms) of one sync-point observation on this stack — fence
 * service or forced-completion readback alike, measured ~66-90ms on
 * Iris/ANGLE/Chromium regardless of the work behind it (fr-096u A/B).
 * Batch measurements subtract it so the planner, the worst-price
 * evidence, and the queue all price MARGINAL trace work; leaving it in
 * inflated the evidence ~5x, which tightened the caps 5x, which
 * quintupled the strip count, which multiplied the tax — the vicious
 * cycle that made capped settles ~15x slower than main. On stacks with a
 * cheaper sync point the subtraction under-prices batches once, and the
 * five-percent floor plus the planner's growth cap converge the estimate
 * within a couple of groups. */
const SURFACE_STRIP_SYNC_TAX_MS = 80;
/** Sync-collapse escape (ms): a no-prior job joining strips serially
 * (light-system fast path) that measures a strip past this is not light —
 * it seeds the pipelined regime's estimate instead of paying a
 * ~10-25ms forced-completion drain per strip for thousands of strips
 * (the fr-096u perf-review regression). */
const SURFACE_STRIP_SYNC_ESCAPE_MS = 25;
/** Multiplier from a completed job's observed worst px cost to the next
 * job's worst-case price floor (fr-096u): covers the preview-to-settle
 * tier gap (~4-6x measured px cost). Crease structure the coarser trace
 * under-sampled is the accepted residual — the cap's own headroom under
 * the watchdog absorbs it; pricing it here as well (the first cut used
 * x10) doubled the strip count of every measured-cheap fold frame for no
 * measured safety. */
const STRIP_WORST_EVIDENCE_SAFETY = 5;
/** Measured GPU time (ms) each preview strip aims for (fr-du81) — well
 * under the settle tier's 75 so strips interleave with a live drag: a
 * preview frame's budget below fits two of these plus the probe. */
const SURFACE_PREVIEW_STRIP_TARGET_MS = 12;
/** Queue-price ceiling (ms) on the pipelined pump's in-flight work
 * (fr-id9r, fr-24to's safety half). The est-priced
 * {@link SURFACE_STRIP_QUEUE_MS} keeps the GPU fed, but the estimate is
 * one fence batch behind reality and fold+grid frames are 100-1000x
 * bimodal: at a cost-band entry the queue held `QUEUE_MS / est` pixels
 * of REAL monster work (measured 16-22s groups in the fr-096u
 * stale-evidence incident; ~3s main-thread stalls once per crease
 * pixel; ~46s pings at parked monster poses) and every main-thread
 * touch of the GL stream — draw submission backpressure, the seed
 * join, the present — stalled behind it. The refill ALSO prices the
 * queue at the job's queue price (surfaceStripQueueWorstMsPerPx —
 * typical-cost class floor / completed-job evidence, raised mid-job by
 * the planner's own ratchet) and stops at this ceiling. Equal to
 * {@link STRIP_WORST_CASE_CAP_MS} by design: the queue tolerates as
 * much mispredicted work as one strip is allowed to plan. On
 * measured-cheap systems the evidence-relaxed price keeps the bound at
 * or above the est-priced one (the reporting lens hash: ~1600px
 * queue-priced vs ~1660px est-priced), so the measured fast paths
 * never feel it; post-discovery monster poses pin to ~one strip in
 * flight, which a 3s crease strip saturates anyway. */
const SURFACE_STRIP_QUEUE_WORST_MS = STRIP_WORST_CASE_CAP_MS;
/** Predicted-cost ceiling (ms) past which a full-tier SYNCHRONOUS frame
 * REFUSES up front (fr-id9r; sync-only since fr-avf6 — the interactive
 * capture discloses and lets the user stop it instead of predicting for
 * them). Prediction uses measured evidence only —
 * a completed settle's whole-frame cost, else the completed preview's
 * scaled by the tier gap; never the fold-class prior, which is
 * probe-sizing pessimism ~100x past typical fold pixels and would
 * refuse every fold export sight unseen. Generous by design:
 * prediction honesty is ~4x at worst (the fr-096u review measured a
 * floor-rung preview overpredicting the real grind 4x), so this only
 * catches the minutes-to-HOURS class that the spend ceiling below
 * would otherwise burn a real minute of frozen tab discovering. */
export const SURFACE_CAPTURE_PREDICT_CEILING_MS = 120_000;
/** Measured-spend ceiling (ms) at which an in-progress full-tier sync
 * drain gives up (fr-id9r) — the backstop for poses with no (or
 * pose-stale) evidence: an offline export's fresh keyframe pose runs
 * un-predicted, and a monster pose there used to freeze the tab for
 * the frame's bounded-submission-but-hours-long duration. A minute of
 * genuine grind is the tolerated worst case — long enough for every
 * legitimately expensive export measured to date, short enough that a
 * user (or the browser's hang detector) still owns the tab. The yielding
 * capture drain has no equivalent (fr-avf6): nothing about it is frozen,
 * so the tab is the user's throughout and Cancel is the backstop. */
const SURFACE_CAPTURE_SPEND_CEILING_MS = 60_000;
/** Pacing floor (ms) for the yielding capture drain's hand-back when the
 * page is HIDDEN (fr-y6m0) — see {@link nextDrainTick}. A visible page
 * paces on rAF, which leaves the main thread genuinely idle between polls;
 * a hidden one has no frame clock and cannot use timers either (throttled
 * to 1s, and to a minute past five minutes hidden), so it spins the
 * un-throttleable macrotask yield instead. That spin holds a core for the
 * length of the export — no worse than the per-strip drain, which blocked
 * the thread outright in every tab, but worth naming rather than calling
 * the cycles free: it buys a backgrounded export full speed instead of a
 * throttled crawl. This bound is what keeps the GL fence polling behind it
 * at ~125/s rather than the ~20k/s a bare yield loop would reach — a rate
 * at which the poll's own driver round trip competes with the tracing it is
 * waiting for. Far tighter than the ~600ms queue needs either way. */
const SURFACE_CAPTURE_TICK_MS = 8;
/** Timer backstop (ms) behind the visible page's rAF pacing (fr-y6m0): a
 * frame, so the drain polls at a frame's cadence whether or not this page
 * is actually being ASKED for frames. Both halves of that matter. A page
 * that never gets a frame callback would otherwise hang the export
 * outright; and a page whose frame clock merely runs SLOW starves the GPU
 * between polls, which is not hypothetical — headless SwiftShader serves
 * rAF at ~10Hz, where a 100ms backstop measured a 504k-px export at 6.5s
 * against the same frame's 2.7s settle, all of the difference idle queue.
 * A timer is the right instrument for that: unlike the hidden-page spin it
 * leaves the main thread genuinely idle between polls, and a visible page's
 * timers are not throttled. */
const SURFACE_CAPTURE_TICK_BACKSTOP_MS = 16;

/** How a capture drain ended (fr-7mfx). "ceiling" is fr-id9r's spend
 * backstop — a refusal the caller reports; "cancelled" is the user's own
 * choice, which is not an error at all. */
type SurfaceDrainOutcome = "done" | "ceiling" | "cancelled";

/** A full-tier frame's arming state: the strip job, plus the measured
 * evidence the arming itself discarded (fr-7mfx). */
interface SurfaceFullFrameArm {
  job: SurfaceStripJob;
  /** {@link FractalScene.surfaceFullPxCostMs} as it stood before
   * `abandonSurfaceSettle` cleared it. Restored when the frame does not
   * complete — see {@link FractalScene.finishSurfaceFullFrame}. */
  priorPxCostMs: number | null;
}

/** The `prevMs` the planner's next sizing call gets: the estimate in the
 * planner's own units (`msPerPxEstimate x lastSubmittedPx`), or null while
 * nothing REAL has been measured yet — a prior-seeded estimate must never
 * reach the planner as a measurement (see {@link SurfaceStripJob.measured}),
 * and a job that already carries one (an adopted/re-armed one) sizes its
 * first strip from it instead of paying the probe again. */
function seedStripMeasurement(job: SurfaceStripJob): number | null {
  return job.measured && job.msPerPxEstimate !== null && job.lastSubmittedPx > 0
    ? job.msPerPxEstimate * job.lastSubmittedPx
    : null;
}

/** Traced-and-measured coverage of `job` in [0, 1]: planned pixels less the
 * ones still riding this job's OWN fences (an adopted backlog's pixels were
 * never in `plannedPx`, fr-7to5, so subtracting them too would report
 * negative coverage). The one definition {@link
 * FractalScene.surfaceRenderProgress} and the capture drain's progress hook
 * share — a pipelined drain always has a queueful in flight, so reporting
 * `plannedPx` alone would claim pixels no measurement has landed on. */
function stripJobCoverage(job: SurfaceStripJob): number {
  return (
    (job.planner.plannedPx - (job.inFlightPx - job.inheritedPx)) /
    Math.max(1, job.planner.totalPx)
  );
}

/** Hand the main thread back for one macrotask. A `MessageChannel` rather
 * than `setTimeout(0)`: no 4ms clamp, no background-tab throttling, and
 * the browser gets a genuine rendering opportunity between turns — the
 * same primitive main.ts's offline-export driver yields with. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * One tick of the yielding capture drain (fr-y6m0): hand the main thread
 * back and give the submitted queue time to advance before the next pump.
 *
 * A visible page paces on rAF — the live pump's own clock. 60Hz is ~40x
 * more often than a {@link SURFACE_STRIP_QUEUE_MS} queue needs to stay fed,
 * and between callbacks the main thread is genuinely IDLE: the export modal
 * paints, its Cancel button responds, and nothing spins. A frame callback
 * is not a GUARANTEE though (a page can be "visible" and still not be asked
 * to produce frames), and a tick that never resolves is an export that
 * hangs with a Cancel button that cannot even be observed — so a plain
 * timer backstops it at {@link SURFACE_CAPTURE_TICK_BACKSTOP_MS}, whichever
 * arrives first.
 *
 * A hidden page stops firing rAF altogether, and there timers are the one
 * primitive that must NOT be reached for (throttled to 1s hidden, to a
 * minute past five minutes hidden — a backgrounded export would crawl), so
 * it falls back to spinning the un-throttleable macrotask yield for
 * {@link SURFACE_CAPTURE_TICK_MS}. Re-checked every tick, so a tab switch
 * mid-export lands on the right clock immediately.
 */
function nextDrainTick(): Promise<void> {
  if (
    typeof requestAnimationFrame === "function" &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible"
  ) {
    return new Promise((resolve) => {
      let settled = false;
      const tick = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(tick);
      setTimeout(tick, SURFACE_CAPTURE_TICK_BACKSTOP_MS);
    });
  }
  return spinYieldToEventLoop(SURFACE_CAPTURE_TICK_MS);
}

/** {@link yieldToEventLoop} until `ms` of wall has passed — the hidden-tab
 * pacing floor. Each turn is a macrotask, so the page stays responsive
 * throughout; what the spin costs is main-thread cycles that are otherwise
 * idle while the GPU traces. */
async function spinYieldToEventLoop(ms: number): Promise<void> {
  const until = performance.now() + ms;
  do {
    await yieldToEventLoop();
  } while (performance.now() < until);
}

/** Thrown by {@link FractalScene.renderSurface}'s full tier when a
 * frame's predicted or measured cost crosses the export ceilings
 * (fr-id9r) — the tab-freeze guard for the callers that really do freeze
 * the tab: offline export, which fails the run with it, and thumbnails,
 * which fall back to the explorer render. The message is
 * user-presentable. The interactive Save-PNG raises it no longer
 * (fr-avf6). */
export class SurfaceCaptureCostError extends Error {}

/** "~Ns of GPU" / "~N min of GPU" / "~N hr of GPU" for
 * {@link SurfaceCaptureCostError} messages. The hours tier exists
 * because heavy-pose preview evidence can put hour-scale full-frame
 * predictions into the refusal message — "3534 min" reads as a bug,
 * not a verdict. Same 90x tier rule at both cuts. */
function formatGpuMinutes(ms: number): string {
  if (ms < 90_000) return `${String(Math.round(ms / 1000))}s of GPU time`;
  if (ms < 90 * 60_000) {
    return `${String(Math.round(ms / 60_000))} min of GPU time`;
  }
  return `${String(Math.round(ms / 3_600_000))} hr of GPU time`;
}

/** An in-flight strip job over one of the surface targets: the planner,
 * the previous strip's measurement (the planner's sizing input), the
 * job's accumulated measured cost (the preview governor's sample on
 * completion), and the fence of a heavy strip submitted but not yet
 * observed complete (see pumpStrips' pacing regimes). */
interface SurfaceStripJob {
  planner: StripPlanner;
  /** Latest per-pixel cost estimate (ms): seeded from the probe prior
   * (null = no prior = the sync-collapse regime), batch-attributed by the
   * pipelined pump thereafter. Times `lastSubmittedPx`, it is the
   * `prevMs` the planner's sizing formula expects. */
  msPerPxEstimate: number | null;
  /** Frozen-at-arm per-pixel price (ms) for the pump's in-flight queue
   * bound (fr-id9r; see surfaceStripQueueWorstMsPerPx) — the pump maxes
   * it live with the planner's own ratcheted observations. */
  queueWorstMsPerPx: number;
  /** False until the estimate reflects a REAL measurement: the planner
   * must never be fed the prior-seeded estimate as a measurement — its
   * worst-price ratchet would record the PRIOR as an observation and the
   * evidence chain would echo it forever (caught live: worstSeen exactly
   * 10.000 = STRIP_FOLD_PRIOR_MS_PER_PX). */
  measured: boolean;
  /** Pixel count of the most recently PLANNED strip (the planner's
   * `lastPx`, mirrored so the estimate can be handed back in its
   * units). */
  lastSubmittedPx: number;
  /** Accumulated GPU-busy wall time (ms) — the preview governor's sample,
   * the px-cost numerator, and the capture drains' spend ceiling. "Busy" is
   * measured as WALL WITH THE QUEUE OUTSTANDING, not as GPU time: a batch
   * is charged from the moment its group was fenced to the moment a poll
   * observed it complete, so a queue that empties between polls bills the
   * idle remainder too (up to one caller tick). At saturation — the regime
   * the pacing aims for and the one where the numbers are used — the two
   * agree; a queue pinned small by the fr-id9r worst-price bound over a
   * cheap band is where they diverge, and the drift is one-directional
   * (reads high, refuses early, never over-spends). */
  spentMs: number;
  /** Fenced strips submitted but not yet observed complete, in
   * submission order. `inherited` entries are a superseded predecessor's
   * fences adopted at arm (fr-7to5) — same GL queue, so they complete
   * ahead of everything this job submits; the pump prices the queue over
   * them but excludes their busy share from `spentMs` (they traced
   * another pose's pixels). */
  inFlight: { sync: WebGLSync; px: number; inherited: boolean }[];
  /** Sum of `inFlight` pixels — inherited backlog included, because the
   * refill ceiling must see the REAL GL queue (fr-7to5). */
  inFlightPx: number;
  /** The inherited subset of `inFlightPx`. Own in-flight pixels — the
   * progress readout's and the superseded-job extrapolation's share —
   * are `inFlightPx - inheritedPx`. */
  inheritedPx: number;
  /** Timestamp the in-flight queue last went (or was observed) busy —
   * the base of the next poll's busy-time attribution. Null while the
   * queue is empty. */
  busyMark: number | null;
  /** When the pump next drains the queue for a present (0 = set on first
   * pump call). */
  presentDue: number;
  /** Diagnostics (surfperf): submits, polls-with-completions, presents,
   * and the first pump-call timestamp. */
  stat: {
    strips: number;
    polls: number;
    presents: number;
    calls: number;
    t0: number;
  };
  /** Present cadence — tighter for the interactive preview than for the
   * parked settle, `Infinity` for a capture (which presents once, at the
   * end, and only into the export image). */
  presentIntervalMs: number;
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
 * JPEG-encode it over the scene backdrop gradient — the shared tail of every
 * `captureThumbnail` mode (fr-75sq). The underlay + `composite` op are what
 * make the flame canvas match its on-screen appearance (`"screen"`, the same
 * blend `renderFlame` draws — see `captureFlameFrame`); for the
 * already-opaque WebGL canvas the underlay is fully covered and the default
 * `"source-over"` changes nothing. Returns `""` when a 2D context is
 * unavailable.
 */
function thumbnailFrom(
  src: HTMLCanvasElement,
  maxDim: number,
  backdrop: BackgroundGradient,
  composite: GlobalCompositeOperation = "source-over",
): string {
  const longSide = Math.max(src.width, src.height);
  const scale = longSide > maxDim ? maxDim / longSide : 1;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  paintBackdropGradient(ctx, w, h, backdrop);
  ctx.globalCompositeOperation = composite;
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
