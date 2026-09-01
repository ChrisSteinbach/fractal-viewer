import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { shearMatrix } from "../fractal/affine";
import {
  backgroundColorAt,
  backgroundImageUv,
  backgroundMeanColor,
  backgroundRadialScale,
  backgroundShapeCode,
  DEFAULT_BACKGROUND_SHAPE_CENTER,
} from "../fractal/background-shape";
import type { BackgroundShapeSpec } from "../fractal/background-shape";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  balloonBall4,
  buildBalloonFromBall,
} from "../fractal/balloon-de";
import type { Balloon } from "../fractal/balloon-de";
import {
  transformColors,
  W_RAMP_BRIGHTNESS_FLOOR,
  W_RAMP_EXPONENT,
  W_RAMP_GRAY,
  W_SIDE_PALETTES,
} from "../fractal/color";
import { sliceColorRemap, SLICE_GHOST_FLOOR } from "../fractal/project4";
import { clamp, clone3 } from "../fractal/vec";
import type { ShapeTrap, Transform, Vec3, Vec4 } from "../fractal/types";
import type { Mat4 } from "../fractal/flame";
import { presentationFloorSpec } from "../fractal/presentation-floor";
import type { VoxelMaxHierarchy } from "../fractal/voxel-max-hierarchy";
import {
  DEFAULT_CAMERA_FOV,
  adaptiveSurfaceDetail,
  type AdaptiveSurfaceDetail,
  type OrbitCamera,
} from "./orbit";
import { wSupport } from "./rotor4";
import { contextAntialias } from "./constants";
import { predictCaptureMs, solidCaptureMsPerPx } from "./capture-cost";
import {
  backgroundGradientsEqual,
  DEFAULT_BACKGROUND,
  resolveBackground,
} from "./background";
import type { BackgroundGradient, BackgroundShape } from "./background";
import { rgbToHex } from "../fractal/palette";
import type { RenderStyle, SolidParams } from "./state";
import {
  fourPointsViewports,
  pointsViewportAt,
  type PointsAxisProjection,
  type PointsViewLayout,
  type PointsViewportKind,
  type PointsViewportRect,
} from "./points-view-layout";
import {
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelTexture,
  lightDirection,
  marchStepsForGrid,
  packVoxelBalloonPalette,
  packVoxelBalloonTint,
  packVoxelPresentation,
  sampleVoxelAlpha,
  setVoxelBalloon,
  solidBalloonCenterIsEmpty,
  updateVoxelMaxHierarchyTexture,
} from "./voxel-material";
import {
  configureSurfaceGridTexture,
  configureSurfaceLUTTexture,
  createSurfaceBlitMaterial,
  createSurfaceMaterial,
  setSurfaceGrid as packSurfaceGrid,
  setSurfaceGridEnabled as packSurfaceGridEnabled,
  setBulbSystem as packBulbSystem,
  setEscapeSystem as packEscapeSystem,
  setSurfaceShapeTrapUniforms as packSurfaceShapeTrapUniforms,
  setSurfaceBalloon as packSurfaceBalloon,
  packSurfaceBalloonPalette,
  packSurfaceBalloonTint,
  setSurfaceMaterials as packSurfaceMaterials,
  setSurfaceGroundPlane as packSurfaceGroundPlane,
  installSurfaceTiling,
  materialSurfaceTiling,
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
  StripCostEvidence,
  STRIP_WORST_EVIDENCE_SAFETY,
  type StripJobOutcome,
} from "./strip-evidence";
import {
  createSurfaceMaterial4,
  setSurface4Balloon as packSurface4Balloon,
  setSurface4Materials as packSurface4Materials,
  setSurface4GroundPlane as packSurface4GroundPlane,
  setSurfaceSystem4 as packSurfaceSystem4,
  setSurfaceView4 as packSurfaceView4,
} from "./surface-material-4d";
import type { EscapeDE } from "../fractal/escape-de";
import { ESCAPE_TIME_ITERATIONS } from "../fractal/escape-de";
import { resolveShapeTrap } from "../fractal/shape-trap";
import type { BulbDE } from "../fractal/bulb-de";
import { BULB_ITERATIONS } from "../fractal/bulb-de";
import type { SurfaceDE } from "../fractal/surface-de";
import { surfaceDescentCostWeight } from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import { latticePresentationPolicyOf } from "../fractal/lattice-march";
import {
  isResolvedLatticeTiling,
  resolveTiling,
  type ResolvedTiling,
} from "../fractal/tiling";
import {
  surfaceMaterialsNeedAo,
  surfaceMaterialsNeedShadow,
  type SurfaceMaterialSlots,
} from "../fractal/surface-material-wire";
import { balloonClearsGridBox } from "../fractal/surface-grid";
import type { SurfaceGrid } from "../fractal/surface-grid";
import { SURFACE_COLOR_SOURCES } from "./state";
import type { SurfaceParams } from "./state";
import { unmaskedWebglRenderer } from "./render-backend";
import type { SurfaceComputeFrameSpec } from "./surface-compute";
import {
  fitSurfaceComputeRaster,
  subPixelSample,
  surfaceComputeTileRows,
} from "./surface-compute";
import {
  decodeSurfaceRayCensus,
  type SurfaceRayCensus,
} from "./surface-ray-census";
import {
  compositeSurfaceBackgroundLayer,
  snapshotTraceBackground,
  traceBackgroundsEqual,
  type TraceBackgroundImage,
  type TraceBackgroundReference,
} from "../fractal/surface-background-layer";
import type { FlameBackdropImage } from "./flame-backdrop-generator";

// Authored point/guide colors are already sRGB, so render them verbatim
// instead of running Three.js's sRGB<->linear conversions.
THREE.ColorManagement.enabled = false;

/** Midpoint of a backdrop's two stops — the single color that best stands in
 * for a vertical gradient across the whole frame. Numeric Color constructor
 * on purpose: it never applies color-space conversion.
 *
 * Kept as its own function (rather than inlining {@link backgroundMeanColor}
 * at its two call sites) so THREE.Fog's ONE scalar color has one derivation
 * to read, matching the module's shape wherever else a stop pair collapses
 * to a single value. The shape is the INTEGRATED-AWAY one:
 * `backgroundMeanColor`'s `"linear"` branch is the exact closed form
 * `(top + bottom) / 2`, byte-identical to what this function used to
 * compute inline; its `"radial"` branch is the area-weighted mean
 * over the current shape's own geometry, so the fog picks up a vignette's
 * darker edges rather than staying pinned to the linear midpoint. */
function backdropMidpoint(
  stops: BackgroundGradient,
  shape: BackgroundShapeSpec,
): THREE.Color {
  const [r, g, b] = backgroundMeanColor(stops, shape);
  return new THREE.Color(r, g, b);
}

// The fog color is derived from the ACTIVE backdrop gradient rather than
// authored separately, so fogged points always veil toward what's actually
// behind them and can't drift when the backdrop changes — including the
// live Background control: setBackground recomputes the midpoint on every
// backdrop change.
const FOG_MARGIN = 1.2;

// Authored base point size per render style. The UI scales all of them by a
// single multiplier (see {@link FractalScene.setPointSize}) so each style keeps
// its own relative tuning as the user dials the cloud up or down.
const BASE_POINT_SIZE = 0.02; // depthFade + aerial
const DISC_POINT_SIZE = 0.025; // edl
const GLOW_POINT_SIZE = 0.042; // glow
const DOF_POINT_SIZE = 0.024; // dof
// The balloon echo (see setBalloonEchoEnabled): its own fixed
// point size and color-dim multiplier — deliberately NOT wired into
// setPointSize's per-style scaling, so the echo reads as a distinct, dimmer
// backdrop cloud regardless of the main cloud's point-size slider.
// BALLOON_ECHO_DIM stays a MODULE CONSTANT rather than becoming a
// slider: it is this additive-points arm's own baseline — an additive
// cloud drawn at full source brightness blows out against the main cloud —
// not a user knob. The authored knob is the tint pair (uEchoTint/
// uEchoTintStrength, see BALLOON_ECHO_VERTEX and setBalloonTint), which
// reaches brightness through a black tint: mix(base, black, s) equals
// base * (1 - s).
const BALLOON_ECHO_POINT_SIZE = 0.016;
const BALLOON_ECHO_DIM = 0.5;
const GLOW_BASE_OPACITY = 0.28; // glow additive blend
// The "Watch it build" replay cursor: the bright spark pinned to the
// newest revealed point. Sized well above every per-style point size so the
// current chaos-game landing reads as THE point even over a dense cloud (or
// against a translucent guide-box face).
const REPLAY_CURSOR_SIZE = 0.14;
// Guide-box wireframe/face opacity a box is built with (updateGuides'
// unselected branch) and the "Watch it build" replay's spotlight/hop
// emphasis on top of it (see setGuideHighlight): HIGHLIGHT marks the
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
// Exported for the 4D flame and solid renders: main.ts sends this same width
// into those workers, so their CPU slice windows match the shader's exactly.
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
 * Paint the backdrop gradient across a whole canvas — the one
 * gradient-drawing routine the backdrop texture, the flame capture underlay
 * and the thumbnail underlay share, so no capture path can render
 * a different shape than the live scene. Authored in sRGB and left
 * unconverted to match the rest of the pipeline (ColorManagement is off);
 * canvas gradients/pixels are written in the same space.
 *
 * `shape.kind === "linear"` (the default) takes the LINEAR FAST PATH: the
 * canvas 2D API has a vertical ramp natively, so painting it as one
 * `createLinearGradient` call is cheaper than looping `backgroundColorAt`
 * per pixel and produces the same result for a shape that ignores `u` and
 * is monotonic in `v`. DELIBERATE Y-FLIP: canvas row 0 is the TOP of the
 * frame, i.e. `t = 1` (`addColorStop(0, ...top)` below) — the opposite of
 * every GPU site's `imageUv.y`, where row 0 is `t = 0`. Both are correct
 * for their own coordinate system; this is the one place that has to
 * remember it flips.
 *
 * `"radial"` falls to a per-pixel `backgroundColorAt` loop
 * instead, the way {@link buildSurfaceComputeBackground}'s non-linear
 * branch already does — the canvas 2D API's own `createRadialGradient` has
 * no `smoothstep` easing and no per-axis scale, so it can't express this
 * shape directly. The linear fast path's Y-flip does NOT need reproducing
 * here: a radial `t` depends only on distance from a `v = 0.5`-centered
 * `center`, which is exactly symmetric under `v -> 1 - v`, so the flipped
 * and unflipped canvas conventions evaluate to the identical `t` at every
 * pixel. `width`/`height` are THIS CANVAS's own pixel dimensions — not
 * necessarily the viewport's, since the live backdrop texture is a small
 * proxy stretched to fit (see {@link FractalScene.setBackground}) while a
 * capture/thumbnail underlay paints at its own final size directly; either
 * way `shape.scale` must already be `backgroundRadialScale` of whatever
 * FULL IMAGE this canvas represents, computed by the caller.
 */
function paintBackdropGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stops: BackgroundGradient,
  shape: BackgroundShapeSpec = { kind: "linear" },
): void {
  if (shape.kind === "linear") {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, rgbToHex(stops.top));
    g.addColorStop(1, rgbToHex(stops.bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const [u, v] = backgroundImageUv(px, py, [0, 0], [width, height]);
      const [rf, gf, bf] = backgroundColorAt(u, v, stops, shape);
      const o = (py * width + px) * 4;
      data[o] = Math.round(clamp(rf, 0, 1) * 255);
      data[o + 1] = Math.round(clamp(gf, 0, 1) * 255);
      data[o + 2] = Math.round(clamp(bf, 0, 1) * 255);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The backdrop canvas's pixel size — ONE size for every shape,
 * and the "one" is the load-bearing word.
 *
 * The obvious design gives each shape the canvas it wants: linear keeps its
 * shipped 4x256 vertical-ramp trick, radial gets a square. THAT IS A BUG,
 * and a silent one. three.js allocates a CanvasTexture's GPU storage with
 * IMMUTABLE `texStorage2D` (`useTexStorage = texture.isVideoTexture !==
 * true`, WebGLTextures), so the very first upload fixes the texture's
 * dimensions for its lifetime. Resizing the source canvas afterwards
 * repaints the 2D context and sets `needsUpdate`, and the new pixels simply
 * never reach the GPU: the points explorer and the flame composite keep
 * rendering the FIRST shape's backdrop forever, with no error anywhere.
 * MEASURED before the fix: switching Shape to Radial moved the solid
 * tracer's four corner luminances to a single value (a vignette) while the
 * points and flame backdrops kept the vertical ramp's top-dark/bottom-light
 * split unchanged, 14.7/15.0 against 32.9/32.9. A second, independent run
 * caught the same breakage from the other end and named the symptom: every
 * flip to Radial logged `GL_INVALID_VALUE: glCopySubTextureCHROMIUM:
 * Offset overflows texture dimensions`, from exactly the renderers that go
 * through this canvas, and never from the two that read the shape as plain
 * uniforms. THAT ERROR IS THE IMMUTABLE ALLOCATION REFUSING THE NEW SIZE,
 * and it is worth knowing it is NOT adapter-specific: `useTexStorage` is a
 * three.js policy, not a driver behaviour, so this would have shipped
 * broken on every GPU rather than only on the software rasteriser it
 * happened to be caught on.
 *
 * So the canvas is 256x256 always. The cost is a 256 KB canvas instead of a
 * 4 KB one, once; the linear ramp is unchanged where it is sampled, since
 * `createLinearGradient` still runs down the same 256 rows and every column
 * of the result is identical — 4 identical columns and 256 identical
 * columns sample the same under any filtering.
 */
const BACKDROP_CANVAS_PX = 256;

// Out-of-focus points are spread wider and faded; in-focus points stay crisp.
// A cheap circle-of-confusion stand-in for true bokeh that works on points.
const DOF_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uHalfHeight;
  uniform float uOrthographic;
  uniform float uParallelPointScale;
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
    float pointScale = mix(uHalfHeight / dist, uParallelPointScale, uOrthographic);
    gl_PointSize = uSize * pointScale * coc;
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

// 4D projection point shader. A 4D IFS cloud is rotated in 4D
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
// The baked 4D color modes ("by transform" / "by 4D radius", both
// rotation-invariant) swap only WHERE the side color comes from: uUseAttrColor
// selects a per-point `color` attribute (color.ts's buildColors4) over the
// sign-picked pair. The gray-notch magnitude modulation below applies either
// way, so the fourth dimension stays legible in brightness while hue carries
// the structural information.
//
// The soft w-slice rides the same alpha path: a Gaussian opacity
// window in the signed rotated w, swept by a slider — depth-of-field in the
// fourth dimension. Points outside the slice keep a floor of visibility so the
// full projection stays as ghost context around the vivid cross-section.
//
// Glow and depth-of-field stay inside this same material rather than swapping
// to the flat Points materials. Glow changes the projected sprite's size/soft
// radial envelope and then sends this additive HDR result through the existing
// bloom composer. DOF computes its circle of confusion from the PROJECTED
// point's camera-space depth and divides alpha by coc squared, so spreading a
// point does not manufacture energy; all of its w-layers still superpose under
// the one additive blend. Aerial haze and EDL intentionally have no shader
// modes here: adding a non-black fog colour once per stacked layer blows out,
// while one depth-buffer sample cannot represent several projected w-layers.
//
// The opt-in camera-depth fade rides it too: attenuating each point's
// contribution with CAMERA distance is the one 3D depth style whose mechanism
// survives additive blending — fading toward black IS attenuation, which
// composes under addition, whereas fading toward any brighter fog color would
// add that color once per stacked layer and blow out. It restores the
// camera-z cue the projection otherwise lacks (Glow's optional bloom pass has
// no depth representation of its own), which matters most in stills, where
// motion parallax can't help. Off by default: brightness already encodes |w|,
// with dim gray marking proximity to our 3-space, so the fade deliberately
// trades some of that legibility for
// camera depth. The near/far band re-brackets the projected cloud every
// rendered frame (updateFourDFade), mirroring updateFog's band for the 3D
// styles.
// The 4D point transform/color/slice shared by the main projection and the
// balloon echo. Keeping the dimensional-reduction step in ONE GLSL
// block is the semantic guard: the echo inverts the exact projected point the
// main cloud draws, with the same signed-w color and soft-slice weight, rather
// than projecting a separately inverted 4D point.
const FOUR_D_PROJECT_POINT_GLSL = /* glsl */ `
  uniform mat4 uRot4;
  uniform vec4 uCenter4;
  uniform float uInvWAmp4;
  uniform float uIntensity;
  uniform float uSliceOn;
  uniform float uSliceCenter;
  uniform float uSliceWidth;
  uniform float uSliceColorShift;
  uniform float uSliceColorInvScale;
  uniform vec3 uSideNeg;
  uniform vec3 uSidePos;
  uniform float uUseAttrColor;
  attribute float w;
  attribute vec3 color;

  void projectPoint4(
    out vec3 projected,
    out vec3 projectedColor,
    out float slice
  ) {
    // Rotate about the cloud's 4D center so the projection tumbles in place,
    // then project orthographically to 3D by dropping the rotated w.
    vec4 q = uRot4 * (vec4(position, w) - uCenter4);
    projected = q.xyz + uCenter4.xyz;

    // Signed rotated w, normalized by the LARGEST |rotated w| the cloud's 4D
    // bounds box allows at THIS rotation (its support function in the
    // rotated-w direction — recomputed CPU-side whenever the tumble advances,
    // see updateWAmp4). Dividing by the rotation-INVARIANT 4D radius instead
    // would never need updating, but anisotropic clouds (w-spread far below
    // xyz-spread) would hug s = 0 at most tumble angles and wash out to
    // gray; the support bound keeps the full diverging ramp in play at
    // every angle. The clamp only swallows Float32 rounding dust — the
    // support function bounds every stored point.
    float s = clamp(q.w * uInvWAmp4, -1.0, 1.0);

    // Diverging palette: sign picks the side (or, for the baked attribute
    // modes, uUseAttrColor swaps in the per-point attribute), magnitude drives
    // saturation AND brightness (the 0.6 exponent lifts the mid-range, where
    // heavy-tailed w-distributions still cluster even after the support
    // normalization spreads the cloud over the full [-1, 1]). Near-zero w —
    // the part of the cloud passing through our own 3-space — stays dim gray
    // and recedes. (The side pair comes from color.ts's W_SIDE_PALETTES via
    // uniforms; the ramp SHAPE constants — the exponent, gray notch, and
    // brightness floor — are interpolated from color.ts's W_RAMP_* exports,
    // so neither can drift from the CPU twin or the legend.)
    // Optional slice-relative recolor: the w-ramp path evaluates the
    // ramp at an affine remap of s — recentered on the slice window, see
    // project4.ts's sliceColorRemap, whose (shift, invScale) these two
    // uniforms carry (identity 0/1 when off, making sc == s exactly). The
    // baked attribute modes keep the raw s: their hue is the
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
    projectedColor = mix(vec3(${W_RAMP_GRAY}), side, m) * (${W_RAMP_BRIGHTNESS_FLOOR} + ${1 - W_RAMP_BRIGHTNESS_FLOOR} * m);

    // Soft w-slice: a Gaussian window in s around uSliceCenter, with a floor so
    // the rest of the projection stays visible as ghost context.
    slice = 1.0;
    if (uSliceOn > 0.5) {
      float d = (s - uSliceCenter) / uSliceWidth;
      slice = ${SLICE_GHOST_FLOOR} + ${1 - SLICE_GHOST_FLOOR} * exp(-0.5 * d * d);
    }
  }
`;

export const FOUR_D_VERTEX = /* glsl */ `
  ${FOUR_D_PROJECT_POINT_GLSL}
  uniform float uSize;
  uniform float uGlowSize;
  uniform float uHalfHeight;
  uniform float uOrthographic;
  uniform float uParallelPointScale;
  uniform float uDepthStyle;
  uniform float uGlowExposure;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uMaxBlur;
  uniform float uFadeOn;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 projected;
    float slice;
    projectPoint4(projected, vColor, slice);
    vAlpha = uIntensity * slice;

    // The exact modelView/projection/gl_PointSize pipeline DOF_VERTEX uses,
    // minus its circle-of-confusion term: the same size-attenuation formula.
    vec4 mv = modelViewMatrix * vec4(projected, 1.0);
    float dist = -mv.z;

    // Opt-in camera-depth fade (see the header comment): attenuate
    // the contribution toward zero across the [uFadeNear, uFadeFar] band —
    // fade-to-black is the additive-blending-safe analog of the 3D depthFade
    // style's fog. smoothstep rather than fog's linear ramp so the band's
    // edges land softly; the band brackets the cloud with the same margin.
    if (uFadeOn > 0.5) vAlpha *= 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

    float pointSize = uSize;
    if (uDepthStyle > 0.5 && uDepthStyle < 1.5) {
      pointSize = uGlowSize;
      vAlpha *= uGlowExposure;
    } else if (uDepthStyle > 1.5) {
      // Same camera-space circle of confusion as the flat DOF shader, after
      // 4D rotation/projection. The alpha correction preserves one projected
      // layer's integrated additive contribution as its sprite spreads.
      float coc = min(uMaxBlur, 1.0 + uAperture * abs(dist - uFocus));
      pointSize *= coc;
      vAlpha /= coc * coc;
    }

    float pointScale = mix(uHalfHeight / dist, uParallelPointScale, uOrthographic);
    gl_PointSize = pointSize * pointScale;
    gl_Position = projectionMatrix * mv;
  }
`;

// Additive points (square in the plain mode, soft radial sprites for Glow/DOF):
// with THREE.AdditiveBlending the source factor is the fragment's alpha, so
// vAlpha scales each point's contribution and overlapping w-layers sum — no
// sorting needed (addition commutes), hence depthWrite off.
export const FOUR_D_FRAGMENT = /* glsl */ `
  uniform float uDepthStyle;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = vAlpha;
    if (uDepthStyle > 0.5) {
      float r = length(2.0 * gl_PointCoord - 1.0);
      if (r > 1.0) discard;
      if (uDepthStyle < 1.5) {
        // GLSL twin of glowTexture's 1.0 -> 0.5 -> 0 radial stops. Keeping
        // the softness in alpha preserves AdditiveBlending's layer sum.
        float glow = r < 0.25
          ? mix(1.0, 0.5, r / 0.25)
          : mix(0.5, 0.0, (r - 0.25) / 0.75);
        a *= glow;
      } else {
        // The flat DOF shader's circular sprite envelope; vAlpha already
        // carries the circle-of-confusion energy correction from the vertex.
        a *= smoothstep(1.0, 0.25, r);
      }
    }
    if (a < 0.0001) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// The balloon echo, the sphere-inverted "cave" twin of the explorer cloud. In
// 3D each vertex inverts the shared position buffer directly. In 4D
// projectPoint4 first produces the SAME rotor-posed, w-colored, soft-sliced
// 3D point the main cloud draws, and the echo inverts that projected point:
// PROJECT THEN INVERT. That preserves the feature's promise — an echo of
// exactly what is on screen — rather than projecting a 4D inversion, which is
// a different object.
//
// Both paths invert about the cloud's enclosing ball,
// `I(p) = c + R²(p−c)/|p−c|²` (see fractal/balloon-de.ts's module doc for
// the distance-bound math the render mirrors nothing of — this is a plain
// per-vertex position remap, not a distance estimator). Point-size attenuation
// is DOF_VERTEX's formula verbatim; blending is the additive, non-depth-writing
// recipe fourDMaterial uses below, so overlapping echo points glow together
// instead of z-fighting — appropriate for a cloud that is, by construction,
// always "behind" (renderOrder -1) the main one.
export const BALLOON_ECHO_VERTEX = /* glsl */ `
  ${FOUR_D_PROJECT_POINT_GLSL}
  uniform float uFourDActive;
  uniform vec3 uEchoCenter;
  uniform float uEchoR;
  uniform float uEchoRho;
  uniform float uEchoFloor2;
  uniform float uEchoFadeStart;
  uniform float uEchoFadeEnd;
  uniform float uEchoDim;
  // The independent balloon palette is echo-only. Inherit keeps this flag at
  // zero and therefore leaves sourceColor on the exact path it followed before
  // the palette existed. A non-inherit selection samples the shared 256-entry
  // LUT at balloon-de.ts's renderer-neutral pre-inversion radius coordinate.
  uniform float uEchoUsePalette;
  uniform sampler2D uEchoPalette;
  // Independent balloon color: the echo's own base-albedo tint —
  // see the mix at vColor's assignment below. Default black at strength 0
  // is the untinted identity.
  uniform vec3 uEchoTint;
  uniform float uEchoTintStrength;
  uniform float uSize;
  uniform float uHalfHeight;
  uniform float uOrthographic;
  uniform float uParallelPointScale;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    // The flat path stays byte-for-expression identical to the original
    // 3D-only echo. A live 4D view replaces only the inversion's
    // source/color/weight with the main shader's shared projection result.
    // uIntensity belongs in RGB rather than vFade: putting 0.055 in alpha
    // would make the fragment's a < 0.01 discard erase the soft slice's
    // 0.06 ghost floor completely.
    vec3 source = position;
    vec3 sourceColor = color;
    float slice = 1.0;
    float sourceIntensity = 1.0;
    if (uFourDActive > 0.5) {
      projectPoint4(source, sourceColor, slice);
      sourceIntensity = uIntensity;
    }

    vec3 d = source - uEchoCenter;
    if (uEchoUsePalette > 0.5) {
      float paletteT = clamp(length(d) / uEchoRho, 0.0, 1.0);
      // Match palette.ts/flame.ts's 256-bucket lookup exactly rather than
      // letting texture filtering invent a renderer-specific interpolation.
      float paletteIndex = min(floor(paletteT * 256.0), 255.0);
      float paletteU = (paletteIndex + 0.5) / 256.0;
      sourceColor = texture2D(uEchoPalette, vec2(paletteU, 0.5)).rgb;
    }
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
    // Independent balloon color: tint the echo's own base albedo
    // toward uEchoTint before the dim/fade/magnification terms apply. This
    // sits AFTER the 3D/4D branch above, on sourceColor both paths have
    // already produced — uFourDActive is a uniform branch inside this ONE
    // material rather than a second program, so this one edit serves both
    // dimensions for free: no 4D-specific echo-tint code exists or is
    // needed. uEchoTintStrength 0 (the default) makes
    // mix(sourceColor, uEchoTint, 0.0) exactly sourceColor — today's frame
    // byte for byte, in both dimensions.
    vColor = mix(sourceColor, uEchoTint, uEchoTintStrength) *
      (sourceIntensity * uEchoDim / max(mag, 1.0)) * fade;
    // Slice once, in source alpha. Radial fade deliberately remains in both
    // RGB and alpha, preserving the original echo horizon's soft fade squared.
    vFade = fade * slice;

    // DOF_VERTEX's size-attenuation formula, minus its circle-of-confusion
    // term — the echo has no focal plane of its own — times the conformal
    // magnification above.
    vec4 mv = modelViewMatrix * vec4(inv, 1.0);
    float dist = -mv.z;
    float pointScale = mix(uHalfHeight / dist, uParallelPointScale, uOrthographic);
    gl_PointSize = uSize * mag * pointScale;
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
 * Hard cap on an export's drawing-buffer long side, on top of the
 * device's own `maxTextureSize`: the glow composer chain re-allocates
 * half-float targets at the export size, so an unbounded multiple could
 * transiently demand gigabytes of GPU memory and lose the WebGL context.
 * 8192 px still covers a ~27-inch print at 300 dpi.
 */
const EXPORT_MAX_LONG_SIDE = 8192;

/**
 * A finished still export: the encoded PNG plus its actual pixel
 * size — which the device ceilings in {@link FractalScene.captureFrame}'s
 * clamp may have held below the requested multiple, so callers report the
 * real dimensions rather than the asked-for ones.
 */
export interface ExportImage {
  blob: Blob;
  width: number;
  height: number;
}

/** One live Points pane resolved for a pointer gesture. The rectangle is in
 * browser-client CSS pixels, matching MouseEvent/Touch coordinates. */
export interface PointsInteractionView {
  kind: PointsViewportKind;
  camera: THREE.Camera;
  rect: Omit<PointsViewportRect, "kind" | "adjustable">;
  adjustable: boolean;
}

/** One compute-export band. `layers` is Surface's retained background
 * sidecar; when present the scene composes it against the capture-frozen live
 * source before bands are assembled. */
export interface SurfaceComputeCaptureBand {
  pixels: Uint8Array;
  layers?: Uint8Array;
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

  /** Fixed positive-axis cameras used only by the optional Points 2×2
   * workspace. Both projection families stay allocated so toggling does not
   * disturb a latched interaction; the existing public camera remains the
   * adjustable perspective pane and is never temporarily re-posed. */
  private readonly perspectiveAxisCameras: Record<
    Exclude<PointsViewportKind, "current">,
    THREE.PerspectiveCamera
  >;
  private readonly parallelAxisCameras: Record<
    Exclude<PointsViewportKind, "current">,
    THREE.OrthographicCamera
  >;
  private pointsAxisProjection: PointsAxisProjection = "perspective";
  private pointsViewLayout: PointsViewLayout = "single";
  private readonly pointsViewGrid: HTMLElement | null;

  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;
  private readonly pointGeometry: THREE.BufferGeometry;
  private readonly pointCloud: THREE.Points;
  // The "Watch it build" replay cursor: one bright sprite riding the
  // newest revealed point (see setReplayCursor). Hidden whenever no replay is
  // running.
  private readonly replayCursor: THREE.Points;
  // The balloon echo: a second Points object SHARING
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
  /** Lazily allocated echo-only palette ramp. The primary cloud never binds
   * this texture and continues to read pointGeometry's `color` attribute.
   * Null is the explicit inherit state and allocates/uploads nothing. */
  private balloonEchoPaletteTexture: THREE.DataTexture | null = null;
  /** Shared selection gate for Points and both Surface engines. */
  private balloonPaletteEnabled = false;
  /** Independent compute upload revision; never aliases surfaceLUTVersion. */
  private balloonPaletteLUTVersion = 0;
  // The exact enclosing ball the echo inverts about. Kept apart from
  // pointGeometry.boundingSphere because the 4D geometry's sphere includes
  // 0.1% culling slack (setPoints4), while Balloon size 1.00× promises the
  // exact rotation-invariant 4D cloud ball and must not inherit render-system
  // padding. The readiness bit covers the instant before the first upload.
  private readonly balloonEchoSourceSphere = new THREE.Sphere(
    new THREE.Vector3(),
    0,
  );
  private balloonEchoSourceSphereReady = false;
  /** Solid's own inversion ball. In 3D it matches the cloud sphere above; in
   * 4D it is deliberately origin-centred with a full, slice-independent 4D
   * radius, matching balloonBall4 rather than Points' projection-centred ball. */
  private readonly solidBalloonSourceSphere = new THREE.Sphere(
    new THREE.Vector3(),
    0,
  );
  private solidBalloonSourceSphereReady = false;
  /** Latest authored Solid look. Null only before boot's first settings push;
   * cloud uploads re-derive presentation from it without consulting the
   * camera-independent voxel grid. */
  private solidParams: SolidParams | null = null;
  /** Latest trilinear packed-alpha sample at the Solid ball centre. A filled
   * centre makes the inverted isosurface unbounded and refuses the echo. */
  private solidBalloonCenterAlpha = 0;
  private solidThreshold = 0.3;
  // Normalized multiple of the cloud's enclosing-ball radius (see
  // fractal/balloon-de.ts's buildBalloon). Mirrors state.ts's
  // DEFAULT_BALLOON_RADIUS as a plain literal rather than an import — the
  // balloon echo is off by default (this value is inert until
  // setBalloonEchoEnabled(true)), and control-spec.ts's checkbox effect
  // pushes the real slider value the moment it turns on.
  private balloonEchoRadius = 1.6;
  // Depth-fog density multiplier: scales the fog distance unit
  // for this.fog (updateFog), the balloon echo's radial fade
  // (syncBalloonEchoUniforms), and both surface tracers' uFogDensity — see
  // setFogDensity. Mirrors state.ts's DEFAULT_FOG_DENSITY as a plain
  // literal rather than an import, exactly like balloonEchoRadius above;
  // main.ts pushes the real (possibly-restored) value at boot and on
  // every snapshot load regardless, so this default only matters for the
  // instant before that first push.
  private fogDensity = 1;
  // Fog tint: rgb01 color + 0..1 strength shifting what depth
  // fog blends toward, applied AFTER the backdrop-derived midpoint
  // (applyFogColor) and pushed to the three fog-bearing materials — see
  // setFogTint. Mirrors state.ts's defaults as plain literals exactly
  // like fogDensity above; strength 0 is the untinted identity.
  private fogTint: [number, number, number] = [1, 1, 1];
  private fogTintStrength = 0;
  // The live surface session's unified per-slot materials, or null for a
  // classic+none document — SESSION state set beside the system itself (main.ts
  // computes it once per surface enter through surface-slots.ts's gate).
  // Three readers: setSurfaceMaterials pushes it into both fragment
  // materials' uniform lanes + independent finish/pattern defines, and
  // surfaceComputeFrameSpecAt discloses it on every compute frame spec so
  // the offline force-frame memo key re-traces when a timeline leg's
  // document authors different materials under a parked camera (the compute
  // renderer's own copy is create-time, packed into its shadeMaps buffer).
  private surfaceMaterials: SurfaceMaterialSlots | null = null;
  // Balloon tint: rgb01 color + 0..1 strength blended onto the
  // shell's BASE ALBEDO — the explorer echo (BALLOON_ECHO_VERTEX's
  // uEchoTint/uEchoTintStrength) AND both surface tracers
  // (packSurfaceBalloonTint on surfaceMaterial/surfaceMaterial4) — ONE
  // setting across all three, see setBalloonTint. Mirrors state.ts's
  // defaults as plain literals exactly like fogTint above; strength 0 is
  // the untinted identity in every arm and both dimensions.
  private balloonTint: [number, number, number] = [0, 0, 0];
  private balloonTintStrength = 0;
  private guideCubes: THREE.Object3D[] = [];
  // The shear currently baked into each guide cube's geometry, parallel to
  // guideCubes. Lets setGuideGeometry skip rebuilding the cell unless the shear
  // actually changed (position/rotation/scale ride the Object3D's TRS instead).
  private guideShears: Vec3[] = [];
  // The index setGuideHighlight last spotlighted, or null; compared against
  // on every call so render-on-demand keeps a replay's per-frame repeats
  // free.
  private guideHighlight: number | null = null;

  private renderStyle: RenderStyle = "depthFade";

  // Per-style materials; the active one is swapped onto the single point cloud.
  private readonly baseMaterial: THREE.PointsMaterial; // depthFade + aerial
  private readonly discMaterial: THREE.PointsMaterial; // edl
  private readonly glowMaterial: THREE.PointsMaterial; // glow
  private readonly dofMaterial: THREE.ShaderMaterial; // dof
  private readonly fourDMaterial: THREE.ShaderMaterial; // 4D projection
  private readonly balloonEchoMaterial: THREE.ShaderMaterial; // balloon echo
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
  // The scene backdrop: ONE mutable canvas-backed gradient texture,
  // repainted in place by setBackground — every render style shows it, and
  // the flame composite / capture underlays / compute frame spec all read the
  // same `backdrop` stops, so no path can disagree about what's behind the
  // attractor.
  private backdrop: BackgroundGradient = resolveBackground(DEFAULT_BACKGROUND);
  // The backdrop's gradient SHAPE — orthogonal to `backdrop`'s
  // colors, see setBackground. Kept alongside it for the same reason:
  // applyFogColor, resize and every GLSL push need to know the CURRENT
  // shape, not just the current stops.
  private backdropShape: BackgroundShape = "linear";
  /** The generated backdrop is transient render state. Its bytes are an
   * immutable 256x256 snapshot so Surface's host compositor and a capture
   * spanning multiple event turns can keep a stable source by reference. */
  private backdropImage: TraceBackgroundImage | null = null;
  private backdropImageMean: readonly [number, number, number] = [0, 0, 0];
  private backdropImageActive = false;
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

  // The flame render: a plain 2D canvas holds the tone-mapped RGBA
  // image (see `setFlameImage`) and doubles as both the CanvasTexture source
  // for on-screen display AND the Save-PNG export source (`captureFlameFrame`).
  // The 2D canvas retains true per-pixel alpha (transparent where the histogram
  // was never hit); captureFlameFrame composites it over the background color.
  private readonly flameCanvas: HTMLCanvasElement;
  private readonly flameCtx: CanvasRenderingContext2D;
  private readonly flameTexture: THREE.CanvasTexture;
  private readonly flameMaterial: THREE.MeshBasicMaterial;
  private readonly flameQuad: FullScreenQuad;

  // The solid render: the chaos game's density volume raymarched on
  // the GPU with lighting/shadows/AO (see voxel-material.ts). The volume is
  // world-space and camera-independent, so — unlike the flame's frozen view —
  // renderSolid reads the LIVE camera every frame and the user keeps orbiting.
  private voxelTexture: THREE.Data3DTexture;
  // GPU-side half of the exact progressive snapshot that produced
  // `voxelTexture`. Null is an explicit unaccelerated fallback and,
  // importantly, clears the preceding grid's hierarchy rather than pairing
  // stale bounds with a newer density texture.
  private voxelMaxHierarchyTexture: THREE.Data3DTexture | null = null;
  private readonly voxelMaterial: THREE.ShaderMaterial;
  private readonly voxelQuad: FullScreenQuad;
  /**
   * Measured per-pixel cost (ms) of the last COMPLETED
   * {@link captureSolidFrame} — the solid twin of
   * {@link surfaceFullPxCostMs}, and the only evidence
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
   *    (the stride count deliberately scales with it) and its density
   *    field decides where each ray breaks out of that loop. A new volume
   *    is a new cost, in both factors at once.
   *  - {@link setSolidParams}: `uThreshold` IS the break condition of the
   *    primary march and the shadow march both — raise it and every ray
   *    travels further before anything stops it. Ambient and the light
   *    direction ride the same setter while changing no loop count;
   *    splitting them out would only buy a stale reading the right to
   *    survive an edit nobody makes on its own.
   *  - {@link setBalloonEchoEnabled}/{@link setBalloonEchoRadius}: the Solid
   *    balloon replaces the box interval with the ten-radius horizon and
   *    preserves the voxel stride by increasing the loop count. A toggle or
   *    radius therefore invalidates the old price without rebuilding a grid.
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
   * Second, clearing costs the very case this field exists for. Open a
   * scene, ORBIT to frame the shot, Save PNG — the ordinary sequence —
   * would then arrive with no evidence every single time, fall back to the
   * `scale > 1` heuristic, and flash the modal on a 274ms export exactly
   * as before.
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
   * MEASURED, on the sequence the argument is about — export, ORBIT,
   * export — at a 600x400 viewport sized so the export straddles the
   * grace period but stays under the skip threshold, which makes the
   * modal's show OFFSET the readout (~0ms = the scale heuristic answered,
   * several hundred = a measured prediction let the grace period run):
   *
   *                          this build      pose-clearing build
   *   first export here      +4ms            +3ms   (no evidence yet)
   *   same pose again        +679ms          +596ms (evidence)
   *   AFTER ORBITING         +645ms          +1ms   <- the whole point
   *   same new pose again    +678ms          +618ms
   *
   * At the reported 320x240 the same result reads as modal vs no modal:
   * the first export flashes at 273ms (the recorded 274ms, reproduced) and
   * every export after it is silent, ORBIT INCLUDED.
   *
   * {@link resize} survives for the same reason and a stronger one, which
   * is measured rather than argued: at one fixed pose the per-pixel cost
   * came out 7.5e-4 at 640x480 (4:3) and 7.2e-4 at 3840x2160 (16:9) — a
   * 27x change in pixel count and a change of aspect moving ms/px by ~4%.
   * The field is per-PIXEL, so the count is already the prediction's own
   * multiplier, and clearing here was discarding a predictor that
   * transfers across viewports almost exactly in order to dodge a 4%
   * error.
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

  // The surface render: the IFS attractor sphere-traced as an
  // implicit surface against an analytic distance estimator (see
  // surface-material.ts / surface-de.ts). No volume, no worker — the whole
  // "session" is uniforms, so like the solid render the camera stays LIVE.
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  /** The 4D twin: same tracer one dimension up, marching the
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
   * short-circuits the dirty flag exactly like {@link setRot4}. */
  private readonly surface4Rot = new Array<number>(16).fill(NaN);
  private surface4W0 = NaN;
  /** Last slab half-thickness pushed alongside {@link surface4W0},
   * in the same world w units — part of the same equality guard. */
  private surface4HalfW = NaN;
  /** The 3D empty-space-skipping grid texture the march
   * samples before paying a descent, or null while none is uploaded —
   * gridless marching is always correct, just slower. Owned here (created
   * in {@link setSurfaceGrid}, disposed on every system change and on the
   * next upload); the material only holds uniforms into it. */
  private surfaceGridTexture: THREE.Data3DTexture | null = null;

  /** The installed grid cube's half side, kept beside the texture because
   * {@link applySurfaceGridEnable} re-answers the balloon's grid-validity
   * predicate against it at every balloon change — the grid itself never
   * moves, only `R` does. `null` exactly when no grid is installed. */
  private surfaceGridHalfExtent: number | null = null;
  /** The surface balloon: the DE ball of the INSTALLED surface system —
   * balloonBall(de) for IFS systems, the origin-centered bailout ball for
   * escape systems — recorded by {@link setSurfaceSystem} and {@link
   * setEscapeSystem} so {@link setSurfaceBalloon} can derive the uniform spec
   * from whatever system is actually live (and a new install re-derives under
   * a stored on flag). Null until the first surface install; the 4D install
   * path stores `balloonBall4(de)` and applies through these same methods
   * (see {@link setSurfaceSystem4}). */
  private surfaceBalloonBall: { center: Vec3; radius: number } | null = null;
  /** Stable autofocus target for Surface depth of field. Unlike the balloon
   * ball, this remains present for filled escape-family sessions; unlike the
   * floor ball, it never depends on whether the Floor control is enabled. */
  private surfaceFocusBall: { center: Vec3; radius: number } | null = null;
  private surfaceBalloonOn = false;
  /** The ground plane's session ball: balloonBall(de) for IFS
   * installs, the origin bailout ball for escape — a SEPARATE field from
   * {@link surfaceBalloonBall} because escape sessions null that one
   * (the balloon degenerates there) while the classic Mandelbox floor is
   * exactly an escape session's look. Null until the first surface
   * install; the 4D install path sets it from `balloonBall4(de)` like the
   * balloon's. */
  private surfaceGroundBall: { center: Vec3; radius: number } | null = null;
  /** The persisted Floor toggle's stored intent, pushed by
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
  /** Preview-tier target: while the view moves, the tracer
   * renders here at {@link surfacePreviewGovernor}'s current rung of the
   * drawing buffer and {@link surfaceBlitQuad} stretches it over the
   * canvas. Lazily sized in {@link renderSurface} so resizes/DPR changes —
   * and adaptive rung changes — are absorbed without a per-frame
   * reallocation. */
  private readonly surfacePreviewTarget: THREE.WebGLRenderTarget;
  private readonly surfaceBlitMaterial: THREE.ShaderMaterial;
  private readonly surfaceBlitQuad: FullScreenQuad;
  /** The ACTIVE DE's full-detail descent/iteration cap: installed from the
   * session's base depth, then extended by Continuous zoom. The preview tier
   * clamps `uMaxDepth` below it and the full tier restores it, so the two
   * tiers can interleave freely. */
  private surfaceFullMaxDepth = 0;
  /** Unmagnified session depth and, for inverse-IFS surfaces, its certified
   * slowest contraction. Continuous zoom derives the live full depth from
   * these instead of compounding each wheel event onto the previous result. */
  private surfaceBaseMaxDepth = 0;
  private surfaceSlowestSigma: number | null = null;
  private surfaceZoomMagnification = 1;
  /** Which (scale, depth) rung preview traces currently cost, driven by
   * the measured cost of the traces themselves. Reset by
   * {@link setSurfaceSystem}/{@link setSurfaceSystem4}: a new DE is a new
   * cost profile, so the ladder re-adapts from the shipped 0.3 rung rather
   * than inheriting a verdict measured on the previous system. The rung's
   * depth is derived per frame in {@link setSurfaceFrameUniforms} rather
   * than cached, so it always matches both the live rung and the active
   * DE's own full depth — the contraction-aware clamp that keeps a
   * slow-map system from previewing as one giant core ball. */
  private readonly surfacePreviewGovernor = createPreviewGovernor();
  /** Full-resolution target every FULL-quality trace renders into as
   * adaptive scissored strips: a forced-completion readback
   * between strips keeps every GPU submission bounded, so a pathological
   * close-up can no longer wedge the GPU process — the failure that used
   * to require a browser restart. The async settle job spreads the strips
   * across animation frames; {@link renderSurface}'s full tier runs them
   * to completion synchronously (offline export, thumbnails), and
   * {@link captureSurfaceFrame} drains them while yielding. */
  private readonly surfaceSettleTarget: THREE.WebGLRenderTarget;
  /** Background snapshot baked into each MRT target's legacy RGB. The
   * sidecar attachment makes that RGB cheaply re-compositable against a
   * later live backdrop without touching the tracer. */
  private surfacePreviewBackground: TraceBackgroundReference | null = null;
  private surfaceSettleBackground: TraceBackgroundReference | null = null;
  /** In-flight strip job over {@link surfaceSettleTarget}, or null. */
  private surfaceStripJob: SurfaceStripJob | null = null;
  /** Passes the ACTIVE {@link surfaceSettleTarget} supersampling sequence
   * wants — {@link surfaceSettleSamples} for a settle or an
   * interactive Save-PNG, 1 for everything else, which is every path that
   * existed before supersampling. */
  private surfaceSampleTotal = 1;
  /** Which pass of that sequence is IN FLIGHT (0-based). */
  private surfaceSampleIndex = 0;
  /** Passes already folded into {@link surfaceSampleAccum}. */
  private surfaceSampleTaken = 0;
  /** Linear-light sum of the completed passes, 3 floats per pixel.
   * f32 rather than a float render target: this arm is the
   * FALLBACK one — no adapter, `?surfacegl`, a lost device — so it may
   * not assume `EXT_color_buffer_float`, and the sum then costs no
   * precision at all. See {@link foldSurfaceSample} for where the gamma
   * decode happens and why. */
  private surfaceSampleAccum: Float32Array | null = null;
  /** Byte-domain sums of the coverage/fog/background-weight sidecar. The
   * RGB mean keeps the existing linear-light path; metadata is averaged in
   * its own affine domain for changed-background presentation. */
  private surfaceSampleLayerAccum: Float32Array | null = null;
  /** Frontmost signed-CoC byte per pixel across completed samples. Kept as
   * one byte/pixel instead of growing the float RGB sidecar accumulator. */
  private surfaceSampleCoc: Uint8Array | null = null;
  /** RGBA8 scratch the passes read back into and the mean is encoded back
   * into — the {@link surfaceSampleTexture}'s own storage, so a pass costs
   * one readback and one upload, no intermediate copy. */
  private surfaceSampleTexture: THREE.DataTexture | null = null;
  private surfaceSampleLayerTexture: THREE.DataTexture | null = null;
  /** Frame the sequence's buffers are sized for. */
  private surfaceSampleWidth = 0;
  private surfaceSampleHeight = 0;
  /** Whether {@link surfaceSampleTexture} currently holds a mean of two or
   * more completed passes — i.e. whether it, rather than the settle
   * target, is the image this surface last presented. */
  private surfaceSampleMeanReady = false;
  /** Exact terminal-ray census of the FIRST completed pass in the current
   * settle, or null before that pass completes (and after invalidation).
   * Read from the invisible trace-target alpha status bytes in the readback
   * the accumulator already pays for. */
  private surfaceSettledRayCensus: SurfaceRayCensus | null = null;
  /** True while {@link captureSurfaceFrame}'s yielding drain owns
   * {@link surfaceSettleTarget} and the full-tier uniforms — see
   * {@link surfaceCaptureBusy} for who has to respect it. */
  private surfaceCaptureFlight = false;
  /** In-flight strip job over {@link surfacePreviewTarget}, or null. Preview
   * traces used to be ONE unbounded GPU submission — the one path the
   * settle/capture tiers' strips left unarmored, and on fold-frontier systems
   * (10^2-10^4x an affine descent per pixel) or software GL the FIRST frame
   * of a session could hand the GPU watchdog a minutes-long submission before
   * the preview governor had any sample to act on. Now every preview renders
   * as the same forced-completion scissor strips as the settle/capture tiers,
   * advanced by a per-frame budget: a frame too heavy to finish presents its
   * partial progress and continues (or is superseded by the next
   * invalidation, feeding the governor an extrapolated cost so the ladder
   * still learns). `spentMs` accumulates the job's own measured strip time
   * across frames — the governor sample on completion. */
  private surfacePreviewJob: SurfaceStripJob | null = null;
  /** In-flight fences a superseded/abandoned strip job left behind,
   * awaiting adoption by the next job to arm. Deleting them (the old
   * behavior) forgot that the submitted GPU work still executes FIFO ahead of
   * everything a successor submits: the successor's refill
   * ceiling under-counted the queue (each re-arm in a drag burst stacked
   * another mispriced probe behind the grinding backlog) and its FIRST
   * fence attributed the whole backlog's GPU time to its own strip's
   * pixels (measured ~90x on an order-6 4D kaleidoscope leg), poisoning the
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
     * — the bound on how much busy wall this pool can honestly still
     * owe. A pool has a timestamp, not a clock: nothing observes it
     * while it waits, so an adoption minutes later would otherwise carry
     * a busy origin from work that finished in the first second, and the
     * adopting job's first batch would read (and TEACH) that whole idle
     * wall as trace cost. */
    predictedMs: number;
  } | null = null;
  /** Scene holding a throwaway mesh that shares the active surface
   * material, for {@link compileSurfaceMaterial}'s async program compile.
   * Lazily built once. */
  private surfaceCompileScene: THREE.Scene | null = null;
  private surfaceCompileMesh: THREE.Mesh | null = null;
  /** Measured per-pixel cost (ms) of the FRESHEST preview evidence for the
   * current system — the last completed preview trace, or a superseded job's
   * partial attribution when a re-arm interrupted one that had measured
   * (fresher pose wins; see {@link armSurfacePreview}) — or null before any.
   * SIZES the next job's probe strip (the planner turns a prior into a
   * pixel-bounded probe), so a heavy DE's first submission is target-sized
   * from its very first strip, and prices the pipelined queue's est-side
   * admission. Reset with the governor on every system upload — a new DE is a
   * new cost profile. */
  private surfacePreviewPxCostMs: number | null = null;
  /** Measured per-pixel cost (ms) of the last COMPLETED full-tier frame —
   * a finished settle job or a finished capture drain — for the CURRENT
   * pose, or null. The capture cost ceiling's best predictor:
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
   * the kernel-confirmed i915 preemption hang: 0.5-4ms/px at full
   * resolution put the one submission that runs before measurement past
   * the 7.5s watchdog. Affine and escape-time systems (microseconds per
   * pixel) keep the legacy probe. */
  private surfaceDeFoldClass = false;
  /** The strip cost evidence chain — completed observations own the
   * price in both directions, partials raise only, captures seed-or-raise.
   * The rules and their measured verdicts live in strip-evidence.ts
   * (extracted per the capture-cost.ts precedent so they test without a
   * WebGL context); reset on every system upload. */
  private readonly stripEvidence = new StripCostEvidence();
  /** Whether the ACTIVE surface session renders on the WebGPU compute path
   * — set by {@link enterSurfaceComputeSession}. While true the
   * fold GLSL is never compiled: {@link renderSurface} degrades to a
   * re-present so a stray call cannot trigger the ~25s Mesa link the
   * compute path exists to avoid, and {@link captureThumbnail} reads the
   * last presented frame instead of tracing. */
  private surfaceComputeActive = false;
  /** Whether that compute session is the 4D kind — set by {@link
   * enterSurfaceCompute4Session}. While true every frame spec carries the
   * live rotor/slice view4 for the affine4 kernel's params tail (per-frame,
   * the fragment tracer's live-uniform discipline across the WebGPU seam). */
  private surfaceCompute4 = false;
  /** Whether that compute session's kernels carry the balloon
   * inverted-union wrapper — the SESSION's record, frozen at
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
   * arm — the {@link surfaceComputeBalloon} discipline:
   * created-with is what the 336-byte params struct needs on EVERY frame
   * of the session, however the toggle moves before the restart lands.
   * While true every frame spec carries the live floor block re-derived
   * from the stored ball. */
  private surfaceComputeGroundPlane = false;
  /** Whether the ACTIVE compute session's kernels carry the shape-trap
   * channel — the {@link surfaceComputeBalloon} discipline: created-with
   * is what the trap-grown params struct needs on EVERY frame of the
   * session (a shape edit re-enters with fresh kernels). While true every
   * frame spec carries the stored document block re-read at assembly, so
   * pose/threshold/fade edits are live per frame. */
  private surfaceComputeShapeTrap = false;
  /** Whether the ACTIVE surface session — either engine — carries the
   * shape-trap channel at all: set by the forward installers/enters, false
   * for every descent session. The `"shapeTrap"` color source resolves to
   * `"transform"` while this is false ({@link surfaceColorSourceIndex}'s
   * pinned fallback). */
  private surfaceShapeTrapLive = false;
  /** The document's shape-trap block, stored by
   * {@link setSurfaceShapeTrap} — the ONE source the GLSL uniforms and
   * every compute frame spec re-derive from, `surfaceBalloonRMult`'s
   * live-value discipline. */
  private surfaceShapeTrap: ShapeTrap | null = null;
  /** Rays the ACTIVE compute session's device can trace as ONE frame
   * — `SurfaceComputeRenderer.maxFrameRays`, handed over at
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
  private surfaceComputeLayerTexture: THREE.DataTexture | null = null;
  private surfaceComputeBackground: TraceBackgroundReference | null = null;
  private surfaceComputeMetadataInSourceAlpha = false;
  /** Background edits are presentation work while Surface owns the canvas.
   * They never set renderNeeded (the trace dirty bit); tickRender consumes
   * this latch through presentSurfaceComposite. */
  private surfaceDisplayActive = false;
  private surfaceCompositePending = false;
  /** Surface-owned retained-frame optical treatment. Metadata is produced
   * unconditionally, so this flag changes presentation without retracing. */
  private surfaceDepthOfField = false;
  /** The last source actually shown on the canvas, retained so a backdrop
   * tween can repaint it without re-tracing. */
  private surfacePresentation: {
    color: THREE.Texture;
    layer: THREE.Texture | null;
    background: TraceBackgroundReference | null;
    /** Capture-only compact sidecar transport; live frames keep full uLayer. */
    metadataInSourceAlpha: boolean;
  } | null = null;
  /** Live SurfaceParams snapshot for compute frame specs — kept beside the
   * GLSL uniform writes in {@link setSurfaceParams} so both paths read the
   * one document. */
  private surfaceComputeParams: SurfaceParams | null = null;
  /** Effective settle/capture sample count, including any diagnostic query
   * override resolved once by main.ts. Previews remain one sample. */
  private surfaceSettleSamples = 8;
  /** Bumped by {@link setSurfaceColorLUT} so the compute renderer
   * re-uploads its LUT texture only when the ramp actually changed. */
  private surfaceLUTVersion = 0;

  /** Live viewport size, kept for {@link syncProjection}. */
  private viewportWidth: number;
  private viewportHeight: number;

  /**
   * Horizontal strip (CSS px) on the right edge covered by the control-panel
   * overlay. While non-zero, {@link syncProjection} designs the
   * projection for the UNCOVERED region — the camera's `aspect` (which the
   * fit math in orbit.ts/camera-tween.ts reads) describes that visible
   * region, and a `setViewOffset` extension keeps rendering the full canvas
   * so the strip under the panel still shows scene rather than a void. World
   * center then projects to the visible region's center, and every auto-fit
   * frames the attractor clear of the panel.
   */
  private rightInsetPx = 0;

  /**
   * Whether anything visible changed since the last render. Set by
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
    [number, number, number, number, number, number, number, number] | null =
    null;

  /**
   * Adaptive-resolution scale multiplied into the base pixel ratio:
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
    this.pointsViewGrid = container.querySelector("#pointsViewGrid");

    this.scene = new THREE.Scene();
    // A camera-independent vertical gradient as the scene backdrop, so the
    // cloud floats in a sense of depth instead of a flat fill. One texture,
    // repainted in place when the Background control moves.
    this.backdropCanvas = document.createElement("canvas");
    this.backdropCanvas.width = BACKDROP_CANVAS_PX;
    this.backdropCanvas.height = BACKDROP_CANVAS_PX;
    this.backdropCtx = this.backdropCanvas.getContext("2d");
    if (this.backdropCtx) {
      paintBackdropGradient(
        this.backdropCtx,
        BACKDROP_CANVAS_PX,
        BACKDROP_CANVAS_PX,
        this.backdrop,
      );
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
    this.fog = new THREE.Fog(
      backdropMidpoint(this.backdrop, { kind: "linear" }),
      1,
      10,
    );
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_FOV,
      width / height,
      0.1,
      1000,
    );
    this.camera.position.set(5, 4, 5);
    this.camera.lookAt(0, 0, 0);
    this.perspectiveAxisCameras = {
      x: new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, 1, 0.1, 1000),
      y: new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, 1, 0.1, 1000),
      z: new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, 1, 0.1, 1000),
    };
    this.parallelAxisCameras = {
      x: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
      y: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
      z: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
    };
    // Looking down +Y needs an up vector that is not parallel to the view
    // direction. The sign makes the fixed Y pane read as a conventional top
    // view, with -Z toward the top of the screen.
    this.perspectiveAxisCameras.y.up.set(0, 0, -1);
    this.parallelAxisCameras.y.up.set(0, 0, -1);

    // MSAA is a context-creation-time choice: on at low DPR where
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
    // The canvas is a focus target: interactions.ts binds the
    // camera keys to it, and element-scoped keydown is what keeps arrows/
    // Space from ever shadowing the panel's own controls. The accessible
    // identity lives HERE, on the widget — index.html's container div
    // carries no role since this feature (its old role="img"
    // would prune this focusable canvas from the accessibility tree) — and
    // the label doubles as the discoverability channel: a screen reader
    // teaches the keys on focus. role="application" is what makes those
    // keys REACHABLE for that audience at all (wave-5 review finding):
    // without a widget role, NVDA/JAWS stay in browse mode on focus and
    // the virtual cursor swallows the very arrows the label teaches. The
    // role is scoped to the leaf canvas — it contains no other content to
    // trap a browse-mode user inside. Sighted keyboard users get the focus
    // ring style.css draws on :focus-visible.
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "application");
    this.syncPointsCanvasLabel();
    // A restored WebGL context comes back with an undefined drawing buffer;
    // make sure the render-on-demand gate repaints it even if the
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
        uOrthographic: { value: 0 },
        uParallelPointScale: { value: 1 },
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
        uGlowSize: { value: GLOW_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
        uOrthographic: { value: 0 },
        uParallelPointScale: { value: 1 },
        // 0 = plain projection, 1 = glow sprite + bloom, 2 = projected-depth
        // DOF. Aerial and EDL deliberately resolve to 0; see FOUR_D_VERTEX.
        uDepthStyle: { value: 0 },
        uGlowExposure: { value: 1 },
        uFocus: { value: 9 },
        uAperture: { value: 3.5 },
        uMaxBlur: { value: 14 },
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
    // The balloon echo: uEchoCenter/uEchoR/uEchoFloor2/
    // uEchoFadeStart/uEchoFadeEnd are all derived from the live cloud's
    // enclosing ball — placeholder zeros until the first setPoints call
    // (syncBalloonEchoUniforms) fills them in. Same additive, non-depth-
    // writing recipe as fourDMaterial above, for the same reason: overlapping
    // echo points should glow together, not depth-fight.
    this.balloonEchoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        // Alias the main 4D material's uniform OBJECTS, not merely their
        // current values: rotor ticks, a fresh center/support, color
        // changes, and slice sweeps then reach both shaders through the one
        // existing write path and cannot drift a frame apart.
        uRot4: this.fourDMaterial.uniforms.uRot4,
        uCenter4: this.fourDMaterial.uniforms.uCenter4,
        uInvWAmp4: this.fourDMaterial.uniforms.uInvWAmp4,
        uIntensity: this.fourDMaterial.uniforms.uIntensity,
        uSliceOn: this.fourDMaterial.uniforms.uSliceOn,
        uSliceCenter: this.fourDMaterial.uniforms.uSliceCenter,
        uSliceWidth: this.fourDMaterial.uniforms.uSliceWidth,
        uSliceColorShift: this.fourDMaterial.uniforms.uSliceColorShift,
        uSliceColorInvScale: this.fourDMaterial.uniforms.uSliceColorInvScale,
        uSideNeg: this.fourDMaterial.uniforms.uSideNeg,
        uSidePos: this.fourDMaterial.uniforms.uSidePos,
        uUseAttrColor: this.fourDMaterial.uniforms.uUseAttrColor,
        uFourDActive: { value: 0 },
        uEchoCenter: { value: new THREE.Vector3() },
        uEchoR: { value: 0 },
        uEchoRho: { value: 1 },
        uEchoFloor2: { value: 1e-8 },
        uEchoFadeStart: { value: 0 },
        uEchoFadeEnd: { value: 0 },
        uEchoDim: { value: BALLOON_ECHO_DIM },
        // Explicit inherit: no texture is allocated until a real independent
        // palette arrives, and the shader retains sourceColor unchanged.
        uEchoUsePalette: { value: 0 },
        uEchoPalette: { value: null },
        // Balloon tint: NOT aliased to fourDMaterial's uniforms
        // above — every entry above IS an alias (the main cloud and its
        // echo must track the same rotor/slice/color state), but tint is
        // echo-only BY DEFINITION: the whole feature is the echo diverging
        // from the main cloud's own color, so these stay this material's
        // own uniform objects, written by setBalloonTint.
        uEchoTint: { value: new THREE.Vector3() }, // DEFAULT_BALLOON_TINT is #000000
        uEchoTintStrength: { value: 0 },
        uSize: { value: BALLOON_ECHO_POINT_SIZE },
        uHalfHeight: { value: buffer.y * 0.5 },
        uOrthographic: { value: 0 },
        uParallelPointScale: { value: 1 },
      },
      vertexShader: BALLOON_ECHO_VERTEX,
      fragmentShader: BALLOON_ECHO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // setPoints deliberately deletes a stale 4D w buffer. The shared echo
    // shader still declares `w`, so give its 3D branch the constant zero Three
    // does not provide for custom attributes (it defaults only color/uv/uv1).
    Object.assign(this.balloonEchoMaterial.defaultAttributeValues, { w: [0] });

    this.pointGeometry = new THREE.BufferGeometry();
    this.pointCloud = new THREE.Points(this.pointGeometry, this.baseMaterial);
    this.scene.add(this.pointCloud);

    // The balloon echo: SHARES pointGeometry by reference (its
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
    // keeps that bookkeeping right, and setResolutionScale keeps
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
      // first: out = flame + bg·(1 − flame), per channel. Over a black
      // backdrop this reduces to the flame bytes exactly (the look before the
      // backdrop was persisted), zero-hit pixels show pure backdrop, and
      // near-zero densities fade smoothly into it — no coverage/alpha needed,
      // which matters because tonemapFlame writes binary alpha (255 wherever
      // any density landed). The same composite is exactly expressible in the
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
    this.voxelMaterial = createVoxelMaterial(
      this.voxelTexture,
      this.backdropTexture,
    );
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
      count: 2,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.surfaceSettleTarget = new THREE.WebGLRenderTarget(2, 2, {
      count: 2,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.surfaceBlitMaterial = createSurfaceBlitMaterial(
      this.surfacePreviewTarget.texture,
      this.surfacePreviewTarget.textures[1],
    );
    this.surfaceBlitQuad = new FullScreenQuad(this.surfaceBlitMaterial);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Whether the next animation frame must actually render — true
   * whenever something visible changed since the last render. main.ts's
   * animate loop is the consumer; the render methods clear it.
   */
  get needsRender(): boolean {
    return this.renderNeeded;
  }

  /** Install the active Surface renderer's unmagnified work budget. IFS
   * callers provide their certified contraction; forward escape/bulb callers
   * pass null and use iteration rungs instead. */
  private installSurfaceDepth(
    baseDepth: number,
    slowestSigma: number | null,
  ): void {
    this.surfaceBaseMaxDepth = baseDepth;
    this.surfaceSlowestSigma = slowestSigma;
    const detail = adaptiveSurfaceDetail(
      baseDepth,
      this.surfaceZoomMagnification,
      slowestSigma,
    );
    this.surfaceFullMaxDepth = detail.depth;
  }

  /**
   * Adapt analytic Surface detail to Continuous zoom. Both fragment and
   * compute paths read {@link surfaceFullMaxDepth} when assembling their next
   * frame, so this is the one backend-independent detail funnel. The returned
   * cap bit feeds the View disclosure; it never silently promises resolution
   * after the bounded per-query budget is exhausted.
   */
  setSurfaceZoomMagnification(magnification: number): AdaptiveSurfaceDetail {
    this.surfaceZoomMagnification = Math.max(1, magnification);
    const detail = adaptiveSurfaceDetail(
      this.surfaceBaseMaxDepth,
      this.surfaceZoomMagnification,
      this.surfaceSlowestSigma,
    );
    if (detail.depth !== this.surfaceFullMaxDepth) {
      this.surfaceFullMaxDepth = detail.depth;
      this.renderNeeded = true;
    }
    return detail;
  }

  /** Full-tier absolute hit floor follows deep magnification until the f32
   * world-space floor. Preview deliberately keeps its coarse fixed value. */
  private surfaceFullHitFloor(): number {
    return Math.max(
      1e-7,
      SURFACE_FULL_HIT_FLOOR / this.surfaceZoomMagnification,
    );
  }

  /**
   * Force the next animation frame to repaint even if none of the per-frame
   * setters detect a change. The public form of the internal dirty
   * flag, for the callers whose visible change is NOT expressed through one of
   * this scene's own mutators: returning to the live explorer from a
   * flame/solid render — all three modes paint the one canvas, so
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
    // limit a replay left on the shared geometry. main.ts cancels
    // the replay on arrival too — this keeps the upload self-consistent even
    // if a future caller forgets.
    this.setDrawCount(null);
    this.setReplayCursor(null);
    if (positions.length === 0) {
      // A legal tiled request may deterministically produce no accepted
      // images. Install that empty geometry as-is: Three's empty-position
      // warning is not an error condition here, and no stale source ball may
      // keep Balloon/Solid presentation alive over the vanished cloud.
      this.pointGeometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        0,
      );
    } else {
      this.pointGeometry.computeBoundingSphere();
    }
    const sphere = this.pointGeometry.boundingSphere;
    if (positions.length > 0 && sphere) {
      this.balloonEchoSourceSphere.copy(sphere);
      this.balloonEchoSourceSphereReady = true;
      this.solidBalloonSourceSphere.copy(sphere);
      this.solidBalloonSourceSphereReady = true;
    } else {
      this.balloonEchoSourceSphereReady = false;
      this.solidBalloonSourceSphereReady = false;
    }
    this.applySolidPresentation();
    // This ball belongs to a new cloud while the voxel texture still belongs
    // to the previous Solid session. Treat eligibility as unknown/safe until
    // setVoxelGrid samples the first matching progressive grid; carrying the
    // previous cloud's refusal into this session would disable unrelated art.
    this.solidBalloonCenterAlpha = 0;
    // The balloon echo's uEcho* uniforms are all derived from the cloud's
    // own enclosing ball, which just moved — re-derive them regardless of
    // whether the echo is currently enabled, so it never shows stale
    // geometry for one frame after a delayed enable.
    this.syncBalloonEchoUniforms();
    this.syncSolidBalloonUniforms();
  }

  /**
   * Upload a freshly generated 4D cloud: the projected-to-3D
   * `xyz` positions plus the separate `w` coordinate the shader colors by, and
   * the 4D `center`/`halfExtents` that drive the shader's rotation pivot and
   * w-color normalization. `radius` is the exact rotation-invariant,
   * center-relative ball used by the Points/Flame balloon echo, while
   * `originRadius` is Solid's exact full-cloud origin-relative ball; the
   * frustum-culling copy receives 0.1% slack. Any
   * `color` attribute is dropped: it belonged to the previous cloud (possibly
   * a different length),
   * and main.ts re-points the color source — re-baking the attribute when the
   * current 4D color mode needs one — via {@link setFourDColorSource} right
   * after every upload.
   */
  setPoints4(
    positions: Float32Array,
    w: Float32Array,
    center: Vec4,
    radius: number,
    originRadius: number,
    halfExtents: Vec4,
  ): void {
    this.renderNeeded = true;
    this.pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.pointGeometry.setAttribute("w", new THREE.BufferAttribute(w, 1));
    this.pointGeometry.deleteAttribute("color");
    // Same replay-reset as setPoints: a fresh upload shows whole.
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

    // The echo uses the exact 4D ball, not the culling sphere's 0.1% slack.
    // Projection cannot escape this rotation-invariant ball, so it stays one
    // stable inversion frame as the rotor tumbles instead of being recomputed
    // (and pulsing) from each projected pose.
    this.balloonEchoSourceSphere.center.set(center[0], center[1], center[2]);
    this.balloonEchoSourceSphere.radius = radius;
    this.balloonEchoSourceSphereReady = positions.length > 0;
    // Solid slices to a 3D grid BEFORE the material ever sees it. Its
    // inversion nevertheless uses balloonBall4's semantic ball: origin plus
    // the FULL 4D visible radius, never the slice-aware voxel AABB or Points'
    // projection-centred sphere. `originRadius` is the exact full-cloud
    // maximum |p4| from chaos-game-4d.ts's existing radius pass and is
    // invariant under the frozen rotor/slice snapshot.
    this.solidBalloonSourceSphere.center.set(0, 0, 0);
    this.solidBalloonSourceSphere.radius = originRadius;
    this.solidBalloonSourceSphereReady = positions.length > 0;
    this.applySolidPresentation();
    this.solidBalloonCenterAlpha = 0;
    this.syncBalloonEchoUniforms();
    this.syncSolidBalloonUniforms();

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
   * replay. The buffers arrive in chaos-game generation order (one
   * point per orbit step, for the 3D and 4D paths alike), so the growing
   * prefix IS a faithful replay of how the attractor was drawn. `null`
   * restores the full cloud. Positions, colors, and the bounding sphere are
   * untouched: the full-cloud sphere is a superset of every prefix, so
   * frustum culling stays correct throughout.
   */
  setDrawCount(count: number | null): void {
    // Per-frame caller (the replay's done-linger repeats `null`): skip the
    // dirty mark when the range is already what's asked for.
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
    // don't mark the frame dirty for it.
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
   * Point the 4D shader's color at its source: either a diverging
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
    // opacity: the stored index must not go on claiming a
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
   * spotlight/hop guide-box emphasis: the hop phase flashes the
   * box of the map the point just landed in, the spotlight phase pins it on
   * the map whose landings are lit. `null` restores every box to its built
   * default. Deliberate simplification: restoring ignores updateGuides's
   * drag-selection tint, because no selection can coexist with a replay —
   * the panel is closed while one plays, and any edit rebuilds the guides,
   * which also cancels the replay upstream.
   */
  setGuideHighlight(index: number | null): void {
    // Per-frame caller (the hop phase repeats the same index): skip the
    // dirty mark when nothing changed.
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
    // Keep the near plane proportional to physical camera distance while
    // retaining a conservative floor. Continuous zoom narrows the lens at a
    // safe radius instead of driving through the focus, so this modest
    // 0.01..0.1 range is enough to avoid clipping foreground detail without
    // sacrificing the depth precision EDL and the raymarchers consume.
    const near = clamp(orbit.spherical.radius * 0.01, 0.01, 0.1);
    // Per-frame caller: a static orbit hands back the identical pose every
    // frame — don't mark the frame dirty for it. Every camera
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
      last[5] === tz &&
      last[6] === orbit.fov &&
      last[7] === near
    ) {
      return;
    }
    this.lastCameraPose = [x, y, z, tx, ty, tz, orbit.fov, near];
    this.renderNeeded = true;
    // NOTE a pose change deliberately does NOT clear
    // {@link solidCapturePxCostMs} — the argument is at that field.
    this.camera.position.set(x, y, z);
    this.camera.lookAt(tx, ty, tz);
    if (this.camera.fov !== orbit.fov || this.camera.near !== near) {
      this.camera.fov = orbit.fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Select how the point cloud conveys depth. Swaps the point material and
   * configures fog/background/post-processing for the chosen style.
   */
  setRenderStyle(style: RenderStyle): void {
    this.renderNeeded = true;
    this.renderStyle = style;
    // The 4D projection never swaps away from its dedicated additive
    // material. Only the two depth mechanisms whose representation survives
    // stacked w-layers select shader modes; Aerial's coloured fog and EDL's
    // single depth sample remain reasoned refusals and therefore resolve to
    // the plain projected-points path.
    this.fourDMaterial.uniforms.uDepthStyle.value =
      style === "glow" ? 1 : style === "dof" ? 2 : 0;
    // While the 4D projection owns the point cloud, record the requested style
    // (so exiting 4D can restore it) and configure that material's shader mode,
    // but don't overwrite fourDMaterial. The scene must not be corruptible
    // even if a caller changes style while the 4D view is live.
    if (this.fourDActive) return;
    // The backdrop itself no longer varies by style: every style
    // shows the one Background-control gradient (`this.backdropTexture`,
    // already installed as scene.background), and the fog color tracks its
    // midpoint via setBackground. A style only picks its material and
    // whether fog applies — "aerial" used to force the haze backdrop, and
    // documents predating the persisted backdrop still get it, via
    // persist.ts's decode migration rather than anything here.
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
   * The current backdrop shape as a {@link BackgroundShapeSpec} for a canvas
   * (or GLSL fragment shader viewport) whose own pixel dimensions ARE the
   * full image it represents — the live viewport, a flame capture canvas
   * at its own accumulation size, a downscaled thumbnail — so `scale`
   * comes from {@link backgroundRadialScale} of THAT `width`/`height`, not
   * some other buffer's. Linear ignores both and returns the bare kind.
   */
  private backgroundShapeSpecForImage(
    width: number,
    height: number,
  ): BackgroundShapeSpec {
    return this.backdropShape === "linear"
      ? { kind: "linear" }
      : {
          kind: "radial",
          center: DEFAULT_BACKGROUND_SHAPE_CENTER,
          scale: backgroundRadialScale(width, height),
        };
  }

  /**
   * Set the scene backdrop and its shape: repaint the gradient
   * texture in place, re-derive the fog color from the new midpoint
   * (surfaces must haze into what's actually behind them), and
   * push the miss-gradient uniforms to the three GLSL tracers. The flame
   * composite, the capture/thumbnail underlays and the WebGPU compute frame
   * spec all read `this.backdrop`/`this.backdropShape`, so one call moves
   * every renderer at once. Cheap and live-reactive (a uniform write + a
   * small canvas repaint) — safe to call per frame during a background
   * crossfade (which never changes `shape` mid-fade — see
   * `background.ts`'s `BackgroundTween` doc).
   *
   * `shape`'s SCALE is derived from the LIVE VIEWPORT, not the
   * small backdrop canvas's own resolution — see
   * {@link backgroundShapeSpecForImage} and {@link paintBackdropGradient}'s
   * doc for why that is what keeps the vignette circular in real pixels
   * once the canvas is stretched to fit. `resize` re-applies this same
   * geometry when the viewport's aspect moves without the stops/shape
   * changing.
   */
  setBackground(
    stops: BackgroundGradient,
    shape: BackgroundShape = "linear",
  ): void {
    if (
      backgroundGradientsEqual(this.backdrop, stops) &&
      this.backdropShape === shape &&
      !this.backdropImageActive
    ) {
      return;
    }
    this.backdrop = stops;
    this.backdropShape = shape;
    this.backdropImageActive = false;
    if (
      this.surfaceDisplayActive &&
      this.surfacePresentation !== null &&
      this.surfacePresentation.layer !== null &&
      this.surfacePresentation.background !== null
    ) {
      this.surfaceCompositePending = true;
    } else {
      this.renderNeeded = true;
    }
    if (this.backdropCtx) {
      paintBackdropGradient(
        this.backdropCtx,
        BACKDROP_CANVAS_PX,
        BACKDROP_CANVAS_PX,
        stops,
        this.backgroundShapeSpecForImage(
          this.viewportWidth,
          this.viewportHeight,
        ),
      );
      this.backdropTexture.needsUpdate = true;
    }
    this.applyFogColor();
    const spec = this.backgroundShapeSpecForImage(
      this.viewportWidth,
      this.viewportHeight,
    );
    // Surface tracers snapshot their backdrop when a frame is ARMED. A live
    // edit must only move the compositor while that expensive frame remains
    // valid; mutating their uniforms here would tear a scissored frame across
    // old/new backgrounds. Solid still shades directly to the canvas.
    for (const material of [this.voxelMaterial]) {
      const u = material.uniforms;
      (u.uBgTop.value as THREE.Vector3).set(...stops.top);
      (u.uBgBottom.value as THREE.Vector3).set(...stops.bottom);
      u.uBgShape.value = backgroundShapeCode(shape);
      (u.uBgCenter.value as THREE.Vector2).set(
        ...(spec.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER),
      );
      (u.uBgScale.value as THREE.Vector2).set(...(spec.scale ?? [1, 1]));
      u.uBgImageOn.value = 0;
    }
  }

  /**
   * Publish the latest low-budget flame render as the active scene backdrop.
   * The display canvas keeps its construction-time 256x256 dimensions: Three
   * allocates immutable texture storage for a CanvasTexture, so resizing that
   * canvas after first upload can silently leave the old GPU allocation bound.
   * A viewport-shaped worker image is therefore resampled into the fixed
   * canvas, and the exact resampled bytes become Surface's immutable source.
   */
  setFlameBackdropImage(image: FlameBackdropImage): void {
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx || !this.backdropCtx) return;
    sourceCtx.putImageData(
      new ImageData(image.rgba, image.width, image.height),
      0,
      0,
    );
    this.backdropCtx.clearRect(0, 0, BACKDROP_CANVAS_PX, BACKDROP_CANVAS_PX);
    this.backdropCtx.imageSmoothingEnabled = true;
    this.backdropCtx.drawImage(
      source,
      0,
      0,
      BACKDROP_CANVAS_PX,
      BACKDROP_CANVAS_PX,
    );
    const rgba = new Uint8ClampedArray(
      this.backdropCtx.getImageData(
        0,
        0,
        BACKDROP_CANVAS_PX,
        BACKDROP_CANVAS_PX,
      ).data,
    );
    this.backdropImage = {
      width: BACKDROP_CANVAS_PX,
      height: BACKDROP_CANVAS_PX,
      rgba,
      revision: image.revision,
    };
    this.backdropImageMean = image.meanRgb;
    this.backdropImageActive = true;
    this.backdropTexture.needsUpdate = true;
    if (
      this.surfaceDisplayActive &&
      this.surfacePresentation !== null &&
      this.surfacePresentation.layer !== null &&
      this.surfacePresentation.background !== null
    ) {
      this.surfaceCompositePending = true;
    } else {
      this.renderNeeded = true;
    }
    this.applyFogColor();
    this.voxelMaterial.uniforms.uBgImageOn.value = 1;
  }

  /** Paint the active source at an arbitrary capture size. */
  private paintCurrentBackdrop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    if (this.backdropImageActive && this.backdropImage !== null) {
      ctx.drawImage(this.backdropCanvas, 0, 0, width, height);
      return;
    }
    paintBackdropGradient(
      ctx,
      width,
      height,
      this.backdrop,
      this.backgroundShapeSpecForImage(width, height),
    );
  }

  /**
   * Re-apply the CURRENT backdrop shape's geometry to the live viewport's
   * new aspect — called from {@link resize}. A no-op under
   * `"linear"`, whose shape has no notion of aspect at all; under
   * `"radial"` this repaints the backdrop canvas and re-pushes
   * `uBgCenter`/`uBgScale` with a freshly computed
   * {@link backgroundRadialScale}, so the vignette stays circular in real
   * pixels as the window/canvas resizes instead of stretching into an
   * ellipse between background pushes.
   */
  private refreshBackgroundShapeForViewport(): void {
    if (this.backdropImageActive || this.backdropShape !== "radial") return;
    const spec = this.backgroundShapeSpecForImage(
      this.viewportWidth,
      this.viewportHeight,
    );
    if (this.backdropCtx) {
      paintBackdropGradient(
        this.backdropCtx,
        BACKDROP_CANVAS_PX,
        BACKDROP_CANVAS_PX,
        this.backdrop,
        spec,
      );
      this.backdropTexture.needsUpdate = true;
    }
    for (const material of [this.voxelMaterial]) {
      const u = material.uniforms;
      (u.uBgCenter.value as THREE.Vector2).set(
        ...(spec.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER),
      );
      (u.uBgScale.value as THREE.Vector2).set(...(spec.scale ?? [1, 1]));
    }
  }

  /** Tell the scene whether the Surface session owns the shared canvas.
   * Background edits use this to dirty presentation rather than tracing;
   * points/flame/solid retain the ordinary renderNeeded behavior. */
  setSurfaceDisplayActive(active: boolean): void {
    if (active && !this.surfaceDisplayActive) {
      // Session-scoped: an image from the previous Surface visit may have a
      // different DE even when its dimensions happen to match.
      this.surfacePresentation = null;
      this.surfaceComputeBackground = null;
    }
    this.surfaceDisplayActive = active;
    this.surfaceCompositePending = false;
  }

  get surfaceCompositeNeeded(): boolean {
    return this.surfaceCompositePending;
  }

  /** Repaint the last surface source against the live backdrop. False before
   * any trace has presented in this session. */
  presentSurfaceComposite(): boolean {
    const source = this.surfacePresentation;
    if (!source || (source.layer === null && !source.metadataInSourceAlpha)) {
      return false;
    }
    this.blitSurface(
      source.color,
      null,
      source.layer,
      source.background,
      null,
      undefined,
      source.metadataInSourceAlpha,
    );
    this.surfaceCompositePending = false;
    return true;
  }

  /**
   * Enter or exit the 4D projection view. Swaps the point cloud
   * to fourDMaterial on entry; on exit, restores the current render style's
   * material by re-running {@link setRenderStyle} (which owns the style→material
   * mapping) rather than duplicating it here.
   */
  setFourDActive(active: boolean): void {
    this.renderNeeded = true;
    this.fourDActive = active;
    this.syncPointsCanvasLabel();
    // The echo remains visible across the dimensional flip. This uniform
    // chooses direct 3D inversion or project-then-invert inside its one shader.
    this.balloonEchoMaterial.uniforms.uFourDActive.value = active ? 1 : 0;
    if (active) {
      this.pointCloud.material = this.fourDMaterial;
    } else {
      // fourDActive is now false, so this restores the recorded style's
      // material (and its fog/background) instead of being guarded out.
      this.setRenderStyle(this.renderStyle);
    }
  }

  /**
   * Toggle the balloon echo: a second point cloud sharing the
   * explorer's own geometry, sphere-inverted about its enclosing ball — see
   * {@link syncBalloonEchoUniforms} and fractal/balloon-de.ts's module doc.
   * Visible exactly when `on`; the shader itself selects direct 3D inversion
   * or 4D project-then-invert (see {@link setFourDActive}).
   */
  setBalloonEchoEnabled(on: boolean): void {
    if (this.balloonEchoEnabled === on) return;
    this.balloonEchoEnabled = on;
    this.renderNeeded = true;
    this.syncBalloonEchoUniforms();
    this.syncSolidBalloonUniforms();
    this.syncBalloonEchoVisibility();
    this.solidCapturePxCostMs = null;
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
    this.syncSolidBalloonUniforms();
    this.syncBalloonEchoVisibility();
    this.solidCapturePxCostMs = null;
  }

  /**
   * Set the Points echo's independent 256x3 palette LUT. `null` is explicit
   * inherit: the echo keeps the main point's sourceColor exactly, including
   * the shared 4D projection/color path. A real LUT is uploaded into one
   * echo-only RGBA8 texture and sampled in the vertex shader before the
   * existing tint/dim/fade/magnification operations. Nothing here mutates the
   * shared geometry or its primary `color` attribute.
   *
   * The echo Points object is absent from rendering while disabled, and a
   * palette edit in that state deliberately does not dirty the live frame.
   * Enabling it later already marks the frame dirty through
   * {@link setBalloonEchoEnabled}.
   */
  setBalloonPalette(lut: Float32Array | null): void {
    const u = this.balloonEchoMaterial.uniforms;
    if (lut === null) {
      if (!this.balloonPaletteEnabled) return;
      this.balloonPaletteEnabled = false;
      u.uEchoUsePalette.value = 0;
      packSurfaceBalloonPalette(this.surfaceMaterial, null);
      packSurfaceBalloonPalette(this.surfaceMaterial4, null);
      packVoxelBalloonPalette(this.voxelMaterial, null);
      if (this.balloonEchoEnabled || this.surfaceBalloonOn) {
        this.renderNeeded = true;
      }
      return;
    }
    if (lut.length !== 256 * 3) {
      throw new RangeError(
        `Balloon palette LUT must contain 768 channels; received ${lut.length}`,
      );
    }

    if (!this.balloonEchoPaletteTexture) {
      this.balloonEchoPaletteTexture = new THREE.DataTexture(
        new Uint8Array(256 * 4),
        256,
        1,
      );
      // Lookups explicitly address texel centres after applying the shared
      // floor(t*256) bucketing rule, so nearest filtering is the honest state.
      this.balloonEchoPaletteTexture.minFilter = THREE.NearestFilter;
      this.balloonEchoPaletteTexture.magFilter = THREE.NearestFilter;
      this.balloonEchoPaletteTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.balloonEchoPaletteTexture.wrapT = THREE.ClampToEdgeWrapping;
      u.uEchoPalette.value = this.balloonEchoPaletteTexture;
    }

    const data = this.balloonEchoPaletteTexture.image.data as Uint8Array;
    let changed = false;
    for (let i = 0; i < 256; i++) {
      const o = i * 4;
      const r = Math.round(clamp(lut[i * 3], 0, 1) * 255);
      const g = Math.round(clamp(lut[i * 3 + 1], 0, 1) * 255);
      const b = Math.round(clamp(lut[i * 3 + 2], 0, 1) * 255);
      if (
        data[o] !== r ||
        data[o + 1] !== g ||
        data[o + 2] !== b ||
        data[o + 3] !== 255
      ) {
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
        changed = true;
      }
    }
    if (changed) this.balloonEchoPaletteTexture.needsUpdate = true;
    const enabling = !this.balloonPaletteEnabled;
    this.balloonPaletteEnabled = true;
    u.uEchoUsePalette.value = 1;
    packSurfaceBalloonPalette(
      this.surfaceMaterial,
      this.balloonEchoPaletteTexture,
    );
    packSurfaceBalloonPalette(
      this.surfaceMaterial4,
      this.balloonEchoPaletteTexture,
    );
    packVoxelBalloonPalette(this.voxelMaterial, this.balloonEchoPaletteTexture);
    if (changed) this.balloonPaletteLUTVersion++;
    if (
      (changed || enabling) &&
      (this.balloonEchoEnabled || this.surfaceBalloonOn)
    ) {
      this.renderNeeded = true;
    }
  }

  /**
   * Re-derive every uEcho* uniform from {@link balloonEchoRadius} and the
   * cloud's exact current enclosing ball ({@link balloonEchoSourceSphere}). A
   * no-op before the first cloud ever lands. In 3D that ball copies
   * `pointGeometry.boundingSphere`; in 4D it keeps setPoints4's exact
   * rotation-invariant radius apart from the geometry sphere's culling slack.
   * Called from both upload paths and both balloon-echo setters — cheap enough
   * to re-run unconditionally rather than tracking which input changed.
   */
  private syncBalloonEchoUniforms(): void {
    if (!this.balloonEchoSourceSphereReady) return;
    const sphere = this.balloonEchoSourceSphere;
    const u = this.balloonEchoMaterial.uniforms;
    (u.uEchoCenter.value as THREE.Vector3).copy(sphere.center);
    u.uEchoR.value = this.balloonEchoRadius * sphere.radius;
    // balloon-de.ts's renderer-neutral palette coordinate divides the exact
    // visible-3D pre-inversion source radius by the certified, margined rho.
    // In 4D `source` is projectPoint4's result, so both dimensional branches
    // meet at the same formula in BALLOON_ECHO_VERTEX.
    u.uEchoRho.value = sphere.radius * BALLOON_RHO_MARGIN;
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
    // The Fog control stretches this same fade, so "thin fog"
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
   * Re-resolve Solid's shader variant from the shared balloon state, its own
   * dimension-correct ball, and the latest installed grid's centre-density
   * refusal. The density texture itself is never duplicated or enlarged:
   * {@link setVoxelBalloon} only changes the query program/uniforms.
   */
  private syncSolidBalloonUniforms(): void {
    const available = this.solidBalloonAvailable();
    if (
      !this.balloonEchoEnabled ||
      !this.solidBalloonSourceSphereReady ||
      !(this.solidBalloonSourceSphere.radius > 0) ||
      !available
    ) {
      setVoxelBalloon(this.voxelMaterial, null);
      return;
    }
    const sphere = this.solidBalloonSourceSphere;
    const balloon = buildBalloonFromBall(
      {
        center: [sphere.center.x, sphere.center.y, sphere.center.z],
        radius: sphere.radius,
      },
      this.balloonEchoRadius,
    );
    setVoxelBalloon(this.voxelMaterial, {
      center: balloon.center,
      radius: sphere.radius,
      rho: balloon.rho,
      R: balloon.R,
    });
  }

  /** Whether the installed Solid grid may be inverted without turning an
   * occupied centre neighbourhood into above-threshold density at infinity. */
  solidBalloonAvailable(): boolean {
    return solidBalloonCenterIsEmpty(
      this.solidBalloonCenterAlpha,
      this.solidThreshold,
    );
  }

  /**
   * Recompute {@link balloonEchoPoints}'s visibility from
   * {@link balloonEchoEnabled}, equality-guarded like every other per-frame
   * setter. Dimensionality changes the echo shader's source mapping,
   * not whether the authored echo exists.
   */
  private syncBalloonEchoVisibility(): void {
    const visible = this.balloonEchoEnabled;
    if (this.balloonEchoPoints.visible === visible) return;
    this.balloonEchoPoints.visible = visible;
    this.renderNeeded = true;
  }

  /**
   * Set the 4D rotation uniform. `m` is a row-major 16-entry
   * array — the format affine4.ts's `rotationMatrix4` produces.
   * `THREE.Matrix4.set()` takes its arguments in row-major order and stores them
   * column-major internally (exactly the WebGL layout the shader's `mat4 uRot4`
   * expects), so handing the row-major array straight to `set()` is the correct
   * pairing.
   */
  setRot4(m: number[]): void {
    // Per-frame caller (the 4D tumble tick): a paused tumble hands back the
    // same matrix — don't mark the frame dirty for it.
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
   * Show a 4D wireframe scaffold — line segments given by their 4D
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
   * |rotated w| any stored point can reach at this tumble angle.
   * Called on every rotation change and cloud upload; four |m_wi|*h_i terms,
   * so the per-frame cost is noise next to the scaffold re-pose that shares
   * the trigger. The 1e-6 floor covers empty or w-flat clouds, whose q.w is
   * 0 anyway (s = 0, the palette's neutral gray). */
  private updateWAmp4(): void {
    this.fourDMaterial.uniforms.uInvWAmp4.value =
      1 / Math.max(wSupport(this.fourDRot, this.fourDHalfExtents), 1e-6);
  }

  /**
   * Configure the soft w-slice: a Gaussian opacity window around
   * `center` in SIGNED normalized rotated-w units (the [-1, 1] range the
   * shader's diverging palette uses), with a fixed width and a visibility floor
   * so the unsliced projection stays as ghost context. The normalization
   * tracks the cloud's w-amplitude at the current rotation, so
   * [-1, 1] always spans the occupied w-range — the slider has no dead zones
   * on anisotropic clouds. A handful of uniform writes, so sweeping the
   * slider costs nothing per frame.
   *
   * `relativeColor` recenters the w-ramp color modes' diverging
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
   * Enable/disable the 4D projection's camera-depth fade: dim each
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
    this.fourDMaterial.uniforms.uGlowSize.value = GLOW_POINT_SIZE * multiplier;
  }

  /**
   * Scale the glow material's opacity by a density-adaptive exposure factor.
   * Called per frame while the glow style is active; pass 1 to reset.
   */
  setGlowExposure(factor: number): void {
    // Per-frame caller: static inputs produce the identical factor every
    // frame — don't mark the frame dirty for it.
    const opacity = GLOW_BASE_OPACITY * factor;
    const uGlowExposure = this.fourDMaterial.uniforms.uGlowExposure;
    if (
      this.glowMaterial.opacity === opacity &&
      uGlowExposure.value === factor
    ) {
      return;
    }
    this.glowMaterial.opacity = opacity;
    uGlowExposure.value = factor;
    this.renderNeeded = true;
  }

  /**
   * Set the depth-fog density multiplier — see state.ts's
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
   * Set the fog tint — `tint` an rgb01 tuple, `strength` its
   * 0..1 blend weight; see state.ts's `AppState` fields for what they
   * mean. Pushes `uFogTint`/`uFogTintStrength` to both surface tracers
   * and the solid render's voxel raymarcher (the {@link setSurfaceParams}
   * push-to-both pattern, exactly like {@link setFogDensity}), then
   * re-derives the points explorer's fog color ({@link applyFogColor}) —
   * the tint applies AFTER the backdrop-midpoint derivation, so changing
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
   * (fogged points veil toward what's actually behind them),
   * then the fog tint lerped on top — the tint applies AFTER
   * the midpoint derivation, so changing background keeps the atmosphere
   * setting meaningful. Strength 0 leaves the midpoint untouched.
   */
  private applyFogColor(): void {
    if (this.backdropImageActive && this.backdropImage !== null) {
      this.fog.color.setRGB(...this.backdropImageMean);
    } else {
      this.fog.color.copy(
        backdropMidpoint(
          this.backdrop,
          this.backgroundShapeSpecForImage(
            this.viewportWidth,
            this.viewportHeight,
          ),
        ),
      );
    }
    if (this.fogTintStrength > 0) {
      this.fog.color.lerp(
        FOG_TINT_COLOR.setRGB(...this.fogTint),
        this.fogTintStrength,
      );
    }
  }

  /**
   * Set the balloon tint — `tint` an rgb01 tuple, `strength` its
   * 0..1 blend weight; see state.ts's `AppState` fields for what they mean.
   * ONE setter feeds every balloon renderer: the explorer echo
   * (balloonEchoMaterial's uEchoTint/uEchoTintStrength) and the surface
   * balloon (packSurfaceBalloonTint on BOTH surfaceMaterial and
   * surfaceMaterial4) plus Solid's query-space volume arm
   * (packVoxelBalloonTint), unconditionally — the uniform objects exist on
   * every material regardless of which arm is compiled —
   * the {@link setBalloonEchoRadius}/{@link setSurfaceBalloonRadius}
   * "one balloon, two renderers" precedent applied to color instead of
   * size. The compute path needs nothing beyond the field update +
   * renderNeeded: frame specs re-derive the pair from these stored fields
   * at every assembly, exactly {@link setSurfaceBalloonRadius}'s own
   * live-pose discipline ("frame specs re-derive the balloon block from
   * the stored rMult at every assembly"). Strength 0 (the default) is the
   * bit-exact identity in every renderer and both dimensions.
   */
  setBalloonTint(tint: [number, number, number], strength: number): void {
    if (
      this.balloonTintStrength === strength &&
      this.balloonTint[0] === tint[0] &&
      this.balloonTint[1] === tint[1] &&
      this.balloonTint[2] === tint[2]
    ) {
      return;
    }
    this.balloonTint = [tint[0], tint[1], tint[2]];
    this.balloonTintStrength = strength;
    this.renderNeeded = true;
    const u = this.balloonEchoMaterial.uniforms;
    (u.uEchoTint.value as THREE.Vector3).set(...tint);
    u.uEchoTintStrength.value = strength;
    packSurfaceBalloonTint(this.surfaceMaterial, this.balloonTint, strength);
    packSurfaceBalloonTint(this.surfaceMaterial4, this.balloonTint, strength);
    packVoxelBalloonTint(this.voxelMaterial, this.balloonTint, strength);
  }

  /**
   * Tighten the fog band to bracket the point cloud at the current distance.
   * No-op unless a depth-fading style (depthFade/aerial) is active.
   *
   * `fogDensity` scales the fog DISTANCE UNIT: a larger density
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
    this.updateFogFor(this.camera);
  }

  /** Camera-parameterized fog band used by each synchronized Points pane. */
  private updateFogFor(camera: THREE.Camera): void {
    const bounds = this.pointGeometry.boundingSphere;
    const fog = this.scene.fog;
    if (!bounds || bounds.radius === 0 || !(fog instanceof THREE.Fog)) return;

    const camDist = camera.position.distanceTo(bounds.center);
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
  private updateFourDFade(camera: THREE.Camera = this.camera): void {
    const u = this.fourDMaterial.uniforms;
    if (u.uFadeOn.value === 0) return;
    const [hx, hy, hz, hw] = this.fourDHalfExtents;
    const radius = Math.hypot(hx, hy, hz, hw);
    const c = u.uCenter4.value as THREE.Vector4;
    const camDist = Math.hypot(
      camera.position.x - c.x,
      camera.position.y - c.y,
      camera.position.z - c.z,
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
   * Switch the live Points workspace between its original single camera and
   * the synchronized 2×2 placement workspace. This is display state only:
   * no orbit, selection, guide, or point buffer is replaced.
   */
  setPointsViewLayout(layout: PointsViewLayout): void {
    if (layout === this.pointsViewLayout) return;
    this.pointsViewLayout = layout;
    this.renderNeeded = true;
    this.syncProjection();
    this.syncPointsCanvasLabel();
  }

  /** Switch only the three fixed panes between perspective and parallel
   * projection. Current remains the authored perspective camera. */
  setPointsAxisProjection(projection: PointsAxisProjection): void {
    if (projection === this.pointsAxisProjection) return;
    this.pointsAxisProjection = projection;
    this.renderNeeded = true;
    this.syncAxisCameras();
    this.syncPointsCanvasLabel();
  }

  /** Keep the focusable canvas's interaction contract dimensionally honest. */
  private syncPointsCanvasLabel(): void {
    this.canvas.setAttribute(
      "aria-label",
      this.pointsViewLayout === "four"
        ? this.fourDActive
          ? `Four-view 4D fractal workspace. Fixed X, Y, and Z axis views use ${this.pointsAxisProjection} projection and are followed by the adjustable perspective Current view. Edit transforms in the controls panel; only Current accepts view gestures. Camera keys control Current. Shift with arrows or Page Up and Page Down turns the fourth-dimension view, and the bracket keys move the w slice.`
          : `Four-view fractal placement workspace. Fixed X, Y, and Z axis views use ${this.pointsAxisProjection} projection and are followed by the adjustable perspective Current view. Drag a selected transform in any view; camera keys and camera gestures control Current. Arrow keys orbit, plus and minus zoom, and Space pauses or resumes automatic motion.`
        : "Fractal viewpoint. Arrow keys orbit, plus and minus zoom, Space pauses or resumes the automatic motion. In a 4D scene, Shift with arrows or Page Up and Page Down turns the fourth-dimension view, and the bracket keys move the w slice.",
    );
  }

  /**
   * Resolve a browser pointer to the camera and local rectangle that own the
   * gesture. Axis cameras are synchronized here as well as at render time so
   * a press can never race the first repaint after a layout/zoom change.
   */
  pointsInteractionView(
    clientX: number,
    clientY: number,
  ): PointsInteractionView | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (this.pointsViewLayout === "single") {
      return {
        kind: "current",
        camera: this.camera,
        rect: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        adjustable: true,
      };
    }

    const scaleX = bounds.width > 0 ? this.viewportWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? this.viewportHeight / bounds.height : 1;
    const localX = (clientX - bounds.left) * scaleX;
    const localY = (clientY - bounds.top) * scaleY;
    const viewports = this.livePointsViewports();
    const view = pointsViewportAt(viewports, localX, localY);
    if (!view) return null;
    return this.pointsInteractionViewForKind(view.kind, bounds, viewports);
  }

  /** Re-resolve a latched pane after resize or the panel inset changes. */
  pointsInteractionViewForKind(
    kind: PointsViewportKind,
    bounds = this.canvas.getBoundingClientRect(),
    viewports = this.livePointsViewports(),
  ): PointsInteractionView | null {
    if (this.pointsViewLayout === "single") {
      if (kind !== "current") return null;
      return {
        kind,
        camera: this.camera,
        rect: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        adjustable: true,
      };
    }
    const view = viewports.find((candidate) => candidate.kind === kind);
    if (!view) return null;
    this.syncAxisCameras(viewports);
    const scaleX = bounds.width > 0 ? this.viewportWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? this.viewportHeight / bounds.height : 1;
    const camera =
      view.kind === "current" ? this.camera : this.axisCamera(view.kind);
    return {
      kind: view.kind,
      camera,
      rect: {
        left: bounds.left + view.left / scaleX,
        top: bounds.top + view.top / scaleY,
        width: view.width / scaleX,
        height: view.height / scaleY,
      },
      adjustable: view.adjustable,
    };
  }

  private livePointsViewports(): readonly PointsViewportRect[] {
    return fourPointsViewports(
      this.viewportWidth,
      this.viewportHeight,
      this.rightInsetPx,
    );
  }

  private axisCamera(
    kind: Exclude<PointsViewportKind, "current">,
  ): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.pointsAxisProjection === "parallel"
      ? this.parallelAxisCameras[kind]
      : this.perspectiveAxisCameras[kind];
  }

  private pointsCameraDistanceToTarget(camera: THREE.Camera): number {
    const pose = this.lastCameraPose;
    return Math.max(
      Math.hypot(
        camera.position.x - (pose?.[3] ?? 0),
        camera.position.y - (pose?.[4] ?? 0),
        camera.position.z - (pose?.[5] ?? 0),
      ),
      1e-6,
    );
  }

  /** Keep fixed directions while sharing the live target, radius and target-
   * plane framing. Parallel uses the Current lens at the target plane, so
   * toggling projection changes convergence without a scale jump. */
  private syncAxisCameras(viewports = this.livePointsViewports()): void {
    const pose = this.lastCameraPose;
    const target = new THREE.Vector3(
      pose?.[3] ?? 0,
      pose?.[4] ?? 0,
      pose?.[5] ?? 0,
    );
    const radius = Math.max(this.camera.position.distanceTo(target), 1e-6);
    const zoom = Math.max(this.camera.zoom, 1e-6);
    const halfHeight =
      (radius * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))) /
      zoom;
    for (const kind of ["x", "y", "z"] as const) {
      const viewport = viewports.find((view) => view.kind === kind);
      const aspect = viewport
        ? viewport.width / Math.max(viewport.height, 1)
        : 1;
      const perspective = this.perspectiveAxisCameras[kind];
      perspective.fov = this.camera.fov;
      perspective.near = this.camera.near;
      perspective.far = this.camera.far;
      perspective.aspect = aspect;
      perspective.zoom = this.camera.zoom;
      perspective.clearViewOffset();

      const parallel = this.parallelAxisCameras[kind];
      parallel.left = -halfHeight * aspect;
      parallel.right = halfHeight * aspect;
      parallel.top = halfHeight;
      parallel.bottom = -halfHeight;
      parallel.near = this.camera.near;
      parallel.far = this.camera.far;
      parallel.zoom = 1;

      for (const camera of [perspective, parallel]) {
        camera.position.copy(target);
        if (kind === "x") camera.position.x += radius;
        else if (kind === "y") camera.position.y += radius;
        else camera.position.z += radius;
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      }
    }
  }

  /**
   * Reserve `px` of the right edge for the panel overlay — see
   * {@link rightInsetPx}. Values are clamped so at least half the viewport
   * stays visible; 0 restores the plain full-canvas projection.
   */
  setRightInset(px: number): void {
    const clamped = Math.max(0, Math.min(px, this.viewportWidth * 0.5));
    if (clamped === this.rightInsetPx) return;
    this.rightInsetPx = clamped;
    if (this.pointsViewGrid) {
      this.pointsViewGrid.style.right = `${String(Math.floor(clamped))}px`;
    }
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
    if (this.pointsViewLayout === "four") {
      const current = this.livePointsViewports().find(
        (view) => view.kind === "current",
      );
      this.camera.aspect = current
        ? current.width / Math.max(current.height, 1)
        : visible / height;
      this.camera.clearViewOffset();
    } else if (this.rightInsetPx > 0) {
      this.camera.aspect = visible / height;
      this.camera.setViewOffset(visible, height, 0, 0, width, height);
    } else {
      this.camera.aspect = visible / height;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.renderNeeded = true;
    this.viewportWidth = width;
    this.viewportHeight = height;
    // A radial vignette's SCALE is derived from the viewport's own
    // aspect (backgroundRadialScale), so a resize that changes that aspect
    // must repaint the backdrop canvas and re-push uBgScale even though
    // neither the stops nor the shape KIND moved — linear has no such
    // dependency and this is a no-op for it.
    this.refreshBackgroundShapeForViewport();
    // A resize deliberately does NOT clear {@link solidCapturePxCostMs}:
    // the field is per-PIXEL, so the pixel count is already the
    // prediction's own multiplier, and the aspect's re-apportioning of
    // rays between the volume and the background is second order beside
    // it. Same argument as the pose site.
    this.syncProjection();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // Re-read the LIVE devicePixelRatio: browser zoom and a
    // monitor move change it and fire this resize, but three derives the
    // drawing buffer from its STORED ratio — without this the app renders
    // persistently soft on a denser display (or wastefully oversampled on
    // a sparser one) until a Save-PNG or governor rung change happens to
    // re-apply it. Equality-guarded: three's setPixelRatio
    // re-runs setSize unconditionally, so an unguarded re-apply paid the
    // whole renderer+composer resize path twice per event through every
    // ordinary drag-resize where the ratio never moved.
    const ratio = this.basePixelRatio() * this.resolutionScale;
    if (ratio !== this.renderer.getPixelRatio()) {
      this.applyPixelRatio(ratio);
    } else {
      this.syncBufferDependents();
    }
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
   * Scale the rendering resolution: the effective pixel ratio
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
   * the adaptive governor happens to be at — and a hi-res export
   * renders ABOVE the live ratio the same way. No-op when the live
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
   * screen resolution: the base ratio times the requested
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
    if (this.pointsViewLayout === "four") {
      this.renderFourPointsViews();
      return;
    }
    // The 4D projection always keeps its dedicated additive material. Glow
    // adds the same bloom composer the flat glow uses after the material has
    // drawn its soft HDR sprites; DOF derives focus and camera-depth blur in
    // that material itself. Aerial and EDL intentionally fall through to a
    // plain render: coloured haze is not additive-layer-safe, and an EDL
    // depth target cannot retain several w-layers at one projected pixel.
    // The independent camera-depth fade is also part of the 4D material.
    if (this.fourDActive) {
      this.updateFourDFade();
      if (this.renderStyle === "glow") {
        this.composer.render();
      } else {
        if (this.renderStyle === "dof") this.focusDof(true);
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }
    switch (this.renderStyle) {
      case "glow":
        this.composer.render();
        break;
      case "dof":
        this.focusDof(false);
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
   * Render the shared scene graph through X/Y/Z fixed cameras and the normal
   * user camera. Full-screen post-processors (Bloom and EDL) intentionally do
   * not run here: their render targets and screen-space kernels span the
   * whole canvas and would bleed across pane boundaries. Their underlying
   * point materials remain active, yielding a stable placement preview; the
   * unchanged single view and saved-image captures retain the authored full
   * effect.
   */
  private renderFourPointsViews(): void {
    const viewports = this.livePointsViewports();
    this.syncAxisCameras(viewports);
    const renderer = this.renderer;

    // Paint the authored backdrop across the whole canvas first, including
    // the strip beneath the translucent desktop panel. Each subsequent
    // render clears only its own scissored cell with that same scene backdrop
    // before drawing the one shared set of points/guides.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.viewportWidth, this.viewportHeight);
    this.backdropQuad.render(renderer);
    renderer.setScissorTest(true);
    const nativePointMaterials = [
      this.baseMaterial,
      this.discMaterial,
      this.glowMaterial,
      this.replayCursor.material as THREE.PointsMaterial,
    ];
    const nativePointSizes = nativePointMaterials.map(
      (material) => material.size,
    );
    try {
      for (const view of viewports) {
        if (view.width <= 0 || view.height <= 0) continue;
        const camera =
          view.kind === "current" ? this.camera : this.axisCamera(view.kind);
        const bottom = this.viewportHeight - view.top - view.height;
        renderer.setViewport(view.left, bottom, view.width, view.height);
        renderer.setScissor(view.left, bottom, view.width, view.height);
        // Three's built-in perspective attenuation uses the full render
        // target height, not the active viewport height. Counter-scale its
        // authored CSS-pixel size so half-height panes match Single exactly.
        // Orthographic projection skips Three's attenuation entirely, so its
        // separate factor reproduces that same target-plane pixel size.
        const pointScale =
          camera instanceof THREE.OrthographicCamera
            ? view.height / (2 * this.pointsCameraDistanceToTarget(camera))
            : view.height / Math.max(this.viewportHeight, 1);
        nativePointMaterials.forEach((material, index) => {
          material.size = nativePointSizes[index] * pointScale;
        });
        this.preparePointsCamera(camera, view.height);
        renderer.render(this.scene, camera);
      }
    } finally {
      nativePointMaterials.forEach((material, index) => {
        material.size = nativePointSizes[index];
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, this.viewportWidth, this.viewportHeight);
      this.preparePointsCamera(this.camera, this.viewportHeight);
    }
  }

  /** Push the camera-dependent shared fog/point uniforms before one pane. */
  private preparePointsCamera(camera: THREE.Camera, cssHeight: number): void {
    this.updateFogFor(camera);
    if (this.fourDActive) this.updateFourDFade(camera);
    if (this.renderStyle === "dof") this.focusDof(this.fourDActive, camera);
    const halfHeight = cssHeight * this.renderer.getPixelRatio() * 0.5;
    const orthographic = camera instanceof THREE.OrthographicCamera ? 1 : 0;
    const parallelPointScale =
      halfHeight / this.pointsCameraDistanceToTarget(camera);
    for (const material of [
      this.dofMaterial,
      this.fourDMaterial,
      this.balloonEchoMaterial,
    ]) {
      material.uniforms.uHalfHeight.value = halfHeight;
      material.uniforms.uOrthographic.value = orthographic;
      material.uniforms.uParallelPointScale.value = parallelPointScale;
    }
  }

  /**
   * Render one frame at the export resolution (`exportScale` × the
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
   * Run a synchronous render-and-read with the panel inset lifted:
   * exports and thumbnails should compose the fractal centered in the full
   * frame, not shifted for an overlay the image doesn't contain. Restores
   * the inset projection afterwards AND, by default, marks the frame dirty:
   * the render paths clear {@link renderNeeded} before painting, so a
   * centered frame a readback painted onto the canvas would otherwise STAY
   * on screen for a parked camera — render-on-demand only repaints on an
   * invalidation, and a capture must supply its own. `invalidate: false` is
   * for readbacks that only ASSEMBLE capture state under the centered
   * camera and never paint the live canvas (the compute export's band
   * specs, the WebGL capture's job arm): for those the latch is a phantom
   * pose change that hands the surface tier a full re-settle for a
   * byte-identical canvas.
   */
  private withCenteredProjection<T>(readback: () => T, invalidate = true): T {
    const inset = this.rightInsetPx;
    const layout = this.pointsViewLayout;
    if (inset === 0 && layout === "single") return readback();
    this.rightInsetPx = 0;
    // Four-up is editing workspace chrome. Captures/thumbnails keep their
    // established contract: the authored Current camera as one labeled-free
    // image, never an HTML-label-free mosaic.
    this.pointsViewLayout = "single";
    this.syncProjection();
    try {
      return readback();
    } finally {
      this.rightInsetPx = inset;
      this.pointsViewLayout = layout;
      this.syncProjection();
      if (invalidate) this.renderNeeded = true;
    }
  }

  /**
   * Read the current display back as a small JPEG data URL — the thumbnail
   * source for the saved-scene collection. `mode` picks the source
   * the way the Save-PNG export does: `"points"` renders the live
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
        ? thumbnailFrom(
            this.flameCanvas,
            maxDim,
            this.backdrop,
            this.backdropShape,
            "screen",
            this.backdropImageActive ? this.backdropCanvas : null,
          )
        : "";
    }
    if (mode === "surface" && this.surfaceComputeActive) {
      // A compute session's thumbnail re-presents the last traced frame —
      // a projection-independent blit, so the centered wrapper has nothing
      // to lift and its capture invalidation would only hand
      // the surface tier a phantom pose change: a full preview plus
      // supersampled settle re-run for a byte-identical canvas after every
      // ★ save. Tracing here would be renderSurface's
      // fold-GLSL path, which a compute session deliberately never
      // compiles. Only the not-yet-presented fallback paints the
      // (projection-dependent) explorer cloud, and that path takes the
      // wrapper like every other painting arm.
      if (this.representSurfaceComputeFrame()) {
        return thumbnailFrom(
          this.renderer.domElement,
          maxDim,
          this.backdrop,
          this.backdropShape,
        );
      }
      return this.withCenteredProjection(() => {
        this.render();
        return thumbnailFrom(
          this.renderer.domElement,
          maxDim,
          this.backdrop,
          this.backdropShape,
        );
      });
    }
    return this.withCenteredProjection(() => {
      if (mode === "solid") this.renderSolid();
      else if (mode === "surface") {
        // Tracing is the WebGL session's own full-tier drain, blitted
        // centered onto the live canvas — a painting arm, so the wrapper's
        // invalidation is load-bearing here.
        try {
          this.renderSurface();
        } catch (err) {
          // A save-to-collection must never freeze the tab for a
          // monster pose's full-tier trace: when the cost
          // ceiling refuses, the explorer render is the honest
          // fallback — the compute branch's own stance — and the
          // dirty flag makes the next live tick re-preview the
          // surface over it.
          if (!(err instanceof SurfaceCaptureCostError)) throw err;
          this.renderNeeded = true;
          this.render();
        }
      } else this.render();
      return thumbnailFrom(
        this.renderer.domElement,
        maxDim,
        this.backdrop,
        this.backdropShape,
      );
    });
  }

  /**
   * Physical pixel size of the drawing buffer (accounts for
   * `devicePixelRatio`) — the resolution a flame render should target so it
   * matches what is currently on screen 1:1. A hi-res export session passes
   * its `exportScale` so the WHOLE flame accumulation runs at the export
   * size (the converging on-screen image IS the export);
   * clamped like every export (see {@link exportPixelRatio}) so the display
   * texture stays under the device ceiling — main.ts additionally clamps
   * to the flame accumulation-memory budget.
   */
  flameRenderSize(exportScale = 1): { width: number; height: number } {
    // Deliberately NOT the live drawing buffer: the adaptive governor may
    // have that scaled down under load, but a flame render is a converging
    // still — its quality shouldn't inherit a transient live-cloud
    // slowdown. Floor matches how the renderer itself derives the buffer
    // from a pixel ratio.
    const ratio = this.exportPixelRatio(exportScale);
    return {
      width: Math.floor(this.viewportWidth * ratio),
      height: Math.floor(this.viewportHeight * ratio),
    };
  }

  /** Viewport-shaped worker raster for the decorative backdrop. The long
   * side is capped independently of DPR: the fixed 256px display texture is
   * intentionally low-detail and the worker must stay cheap on 4K screens. */
  flameBackdropRenderSize(maxSide = BACKDROP_CANVAS_PX): {
    width: number;
    height: number;
  } {
    const scale = Math.min(
      1,
      maxSide / Math.max(this.viewportWidth, this.viewportHeight, 1),
    );
    return {
      width: Math.max(1, Math.round(this.viewportWidth * scale)),
      height: Math.max(1, Math.round(this.viewportHeight * scale)),
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
   * Snapshot the exact enclosing ball used by the Points balloon echo for a
   * flame accumulation. Returning the already-built {@link Balloon} keeps
   * the histogram backend on the same raw-radius / margined-rho convention
   * as every other balloon arm without exposing Three.js objects across the
   * worker boundary. `null` only before the first cloud has landed.
   */
  flameBalloon(radiusMultiple: number): Balloon | null {
    if (!this.balloonEchoSourceSphereReady) return null;
    const sphere = this.balloonEchoSourceSphere;
    return buildBalloonFromBall(
      {
        center: [sphere.center.x, sphere.center.y, sphere.center.z],
        radius: sphere.radius,
      },
      radiusMultiple,
    );
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
   * (see the flame material's blending doc in the constructor) —
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
   * choice. No `exportScale` parameter on purpose: a
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
    this.paintCurrentBackdrop(ctx, width, height);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(this.flameCanvas, 0, 0);
    return exportImageFrom(out);
  }

  /**
   * Leave the flame render session (a mode switch away from "flame"):
   * shrink the accumulator canvas back to its 1x1 placeholder (see the
   * constructor) and drop the texture's uploaded GPU copy — a flame
   * session ACCUMULATES AT EXPORT SIZE (see {@link setFlameImage} and
   * {@link captureFlameFrame}'s doc), so a 4x export leaves ~132MB of
   * canvas + GPU texture resident for the rest of the page's life once
   * nothing shrinks it back down. Mirrors
   * {@link exitSurfaceComputeSession}'s dispose+null shape; `flameTexture`
   * itself stays (it is `readonly`, and `flameMaterial.map` keeps pointing
   * at it) — `dispose()` only releases the renderer's uploaded copy, which
   * it transparently re-uploads from the canvas the next time the flame
   * quad draws. There is no warm path to protect: flame RE-ENTRY re-seeds
   * the accumulation from scratch, and the next {@link setFlameImage} call
   * grows the canvas right back through this same file's resize check.
   */
  exitFlameSession(): void {
    this.flameCanvas.width = 1;
    this.flameCanvas.height = 1;
    this.flameTexture.dispose();
  }

  /**
   * Upload a freshly packed density volume (RGBA8 bytes from
   * `voxelTextureData`, `size ** 3 * 4` long, x-fastest) so the next
   * {@link renderSolid} call marches it. Re-uses the existing 3D texture
   * when the resolution is unchanged (the common progressive-update case) and
   * rebuilds it otherwise — a `Data3DTexture`'s dimensions are fixed at
   * construction. `maxHierarchy` is transferred with these exact packed bytes;
   * installing both in this one synchronous call keeps progressive snapshots
   * matched. Null deliberately replaces, rather than preserves, an older
   * hierarchy when construction or allocation fell back in the worker.
   */
  setVoxelGrid(
    data: Uint8Array<ArrayBuffer>,
    size: number,
    boundsMin: Vec3,
    boundsMax: Vec3,
    maxHierarchy: VoxelMaxHierarchy | null,
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
    this.voxelMaxHierarchyTexture = updateVoxelMaxHierarchyTexture(
      this.voxelMaterial,
      this.voxelMaxHierarchyTexture,
      maxHierarchy?.sourceSize === size ? maxHierarchy : null,
    );
    const u = this.voxelMaterial.uniforms;
    (u.uBoundsMin.value as THREE.Vector3).set(...boundsMin);
    (u.uBoundsSize.value as THREE.Vector3).set(
      boundsMax[0] - boundsMin[0],
      boundsMax[1] - boundsMin[1],
      boundsMax[2] - boundsMin[2],
    );
    u.uTexel.value = 1 / size;
    u.uMarchSteps.value = marchStepsForGrid(size);
    if (this.solidBalloonSourceSphereReady) {
      const center = this.solidBalloonSourceSphere.center;
      this.solidBalloonCenterAlpha = sampleVoxelAlpha(
        data,
        size,
        boundsMin,
        boundsMax,
        [center.x, center.y, center.z],
      );
    } else {
      this.solidBalloonCenterAlpha = 0;
    }
    // A progressive upload can cross (or clear) the centre-density refusal
    // as log normalization converges, so re-answer it on every grid event.
    this.syncSolidBalloonUniforms();
    // Both factors of a solid capture's per-pixel cost just moved: the
    // step count above, and the density that decides where a ray leaves
    // the loop. See {@link solidCapturePxCostMs}.
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
    this.solidParams = params;
    const u = this.voxelMaterial.uniforms;
    u.uThreshold.value = params.threshold;
    this.solidThreshold = params.threshold;
    u.uAmbient.value = params.ambient;
    (u.uLightDir.value as THREE.Vector3).copy(
      lightDirection(params.lightAzimuth, params.lightElevation),
    );
    this.applySolidPresentation();
    // Threshold is also the centre-density refusal boundary. Raising it can
    // make a previously filled-centre grid safe to invert, and lowering it
    // can refuse one, without any worker round-trip.
    this.syncSolidBalloonUniforms();
    // uThreshold is where both marches stop, so an edit here re-prices
    // every ray. See {@link solidCapturePxCostMs} for why the
    // whole setter clears rather than the threshold alone.
    this.solidCapturePxCostMs = null;
  }

  /** Derive Solid's environment/floor payload from authored look and the
   * neutral presentation sphere retained by the cloud upload. In 3D that is
   * the cloud sphere; in 4D it is the origin/full-radius sphere installed by
   * {@link setPoints4}, stable across rotor and slice edits. */
  private applySolidPresentation(): void {
    const params = this.solidParams;
    if (!params) return;
    const sphere = this.solidBalloonSourceSphere;
    const ball =
      params.floorEnabled &&
      this.solidBalloonSourceSphereReady &&
      sphere.radius > 0
        ? {
            center: [sphere.center.x, sphere.center.y, sphere.center.z] as Vec3,
            radius: sphere.radius,
          }
        : null;
    packVoxelPresentation(this.voxelMaterial, {
      envLight: params.envLight,
      floor: presentationFloorSpec(ball, {
        pattern: params.floorPattern,
        tileScale: params.floorTileScale,
        emission: params.floorEmission,
      }),
    });
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
   * — including its export-resolution raymarch (the volume is
   * camera-independent, so one bigger frame is just more rays).
   *
   * Times itself into {@link solidCapturePxCostMs}, so the NEXT
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
   * {@link predictSurfaceCaptureMs}, feeding the same ONE
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
   * Upload a freshly built surface distance estimator so the
   * next {@link renderSurface} call sphere-traces it. `colors[j]` is the
   * sRGB base color and `trapIndices[j]` the orbit-trap palette coordinate
   * for `de.maps[j]` — main.ts keys both by each slot's `baseIndex`, so
   * kaleidoscope copies inherit their base map's color exactly like the
   * explorer's "By Transform" mode.
   */
  setSurfaceSystem(
    de: SurfaceDE,
    colors: Vec3[],
    trapIndices: number[],
    tiling: ResolvedTiling | null = null,
  ): void {
    this.renderNeeded = true;
    // packSurfaceSystem resets the material's grid uniforms; the texture
    // itself is ours to free.
    this.dropSurfaceGridTexture();
    // A descent session never carries the shape-trap channel — the color
    // source's fallback resolution keys on this (the stored document block
    // survives for the next forward session).
    this.surfaceShapeTrapLive = false;
    // A preceding balloon session can leave its compile gate on until this
    // new system's stored intent is re-applied below. Clear that stale arm
    // before installing tiling so the material packer's explicit
    // tiling+balloon refusal continues to mean a real simultaneous request,
    // not ordinary balloon -> tiled session replacement.
    if (tiling) packSurfaceBalloon(this.surfaceMaterial, null);
    packSurfaceSystem(this.surfaceMaterial, de, colors, trapIndices, tiling);
    // The balloon certifies against the DE's OWN ball, so a
    // new system re-derives it and re-applies the stored on/rMult — a
    // session entered with the balloon already on wraps the new system's
    // ball, not the previous one's.
    const focusBall = balloonBall(de);
    this.surfaceFocusBall = focusBall;
    this.surfaceBalloonBall = focusBall;
    this.applySurfaceBalloon();
    // The ground plane drops under the same ball, re-derived
    // and re-asserted per install exactly like the balloon above — AFTER
    // it, so the eligibility gate reads the final balloon define.
    this.surfaceGroundBall = focusBall;
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.installSurfaceDepth(de.maxDepth, de.slowestSigma);
    // Cost-weighted ladder entry: a fold-frontier DE's per-pixel
    // cost is a known static multiple of an affine system's, and the FIRST
    // trace has no measurement for the panic path to act on — the entry
    // rung must absorb what is known up front. The same "known up front"
    // marks the system fold-class for strip-probe sizing.
    const costWeight = surfaceDescentCostWeight(de);
    this.surfacePreviewGovernor.reset(costWeight);
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = costWeight > 1;
    this.stripEvidence.reset();
    // A new DE is a new cost class: a predecessor system's pooled fences
    // must not seed this evidence chain (the fence pool declines
    // cross-system inheritance — the backlog still drains FIFO, unpriced,
    // as before the pool existed).
    this.flushStripBacklog();
  }

  /**
   * Install the surface session's per-slot authored materials — or clear
   * them with `null`, the classic+none document's value. ONE call serves every
   * session shape and both engines: the two fragment materials take their
   * uniform lanes and independent finish/pattern gates here (inert until a session
   * actually draws one of them — on the compute route the materials stay
   * out of the scene graph, so the define flip costs no compile), and the
   * stored list rides every compute frame spec for the offline
   * force-frame memo key. main.ts calls this once per surface enter,
   * beside {@link setSurfaceBalloon}/{@link setSurfaceGroundPlane}, with
   * `surface-slots.ts`'s gate already applied — a classic-resolving
   * document passes `null` and both engines compile literally today's
   * programs. Forward-orbit sessions pass ONE slot, selected by the shared
   * first-positive-weight rule in `surface-slots.ts`.
   */
  setSurfaceMaterials(materials: SurfaceMaterialSlots | null): void {
    this.renderNeeded = true;
    this.surfaceMaterials = materials;
    packSurfaceMaterials(this.surfaceMaterial, materials);
    packSurface4Materials(this.surfaceMaterial4, materials);
  }

  /**
   * Escape-time sibling of {@link setSurfaceSystem}: upload the
   * fold CHAIN's forward affines + fold params (one slot per
   * link, the document's transform list being the formula sequence) and
   * flip the material onto the SURFACE_ESCAPE variant. Everything else
   * about the mode — tiers, strips, compile gate, capture — runs unchanged
   * on the same material; the iteration budget rides
   * {@link surfaceFullMaxDepth} as PASSES, so the preview depth clamp
   * trades boundary detail for speed exactly as the IFS descent trades
   * levels, at any chain length. No grid exists for this mode.
   */
  setEscapeSystem(
    de: EscapeDE,
    color: Vec3,
    trap: ShapeTrap | null = null,
    tiling: ResolvedTiling | null = null,
  ): void {
    this.renderNeeded = true;
    this.dropSurfaceGridTexture();
    // The trap is session state on BOTH engines: store the block (the live
    // wire's source) and mark the channel live so the "shapeTrap" color
    // source stops resolving to its fallback.
    this.surfaceShapeTrap = trap;
    this.surfaceShapeTrapLive = trap !== null;
    if (tiling) packSurfaceBalloon(this.surfaceMaterial, null);
    packEscapeSystem(this.surfaceMaterial, de, color, trap, tiling);
    // NO balloon ball for escape sessions (measured): the
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
    this.surfaceFocusBall = {
      center: [0, 0, 0],
      radius: de.boundingRadius,
    };
    this.surfaceBalloonBall = null;
    this.applySurfaceBalloon();
    // The floor survives where the balloon degenerates: the
    // escape solid is bounded by its origin bailout ball, and a plane
    // under a Mandelbox is the mode's classic look.
    this.surfaceGroundBall = { center: [0, 0, 0], radius: de.boundingRadius };
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.installSurfaceDepth(ESCAPE_TIME_ITERATIONS, null);
    // The escape loop is phone-cheap (~30 branchless folds per eval):
    // the plain anchor entry is right, and so is the legacy strip probe.
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = false;
    this.stripEvidence.reset();
    this.flushStripBacklog();
  }

  /**
   * Mandelbulb sibling of {@link setEscapeSystem}: upload the
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
  setBulbSystem(
    de: BulbDE,
    color: Vec3,
    trap: ShapeTrap | null = null,
    tiling: ResolvedTiling | null = null,
  ): void {
    this.renderNeeded = true;
    this.dropSurfaceGridTexture();
    // The escape twin's trap store, verbatim.
    this.surfaceShapeTrap = trap;
    this.surfaceShapeTrapLive = trap !== null;
    if (tiling) packSurfaceBalloon(this.surfaceMaterial, null);
    packBulbSystem(this.surfaceMaterial, de, color, trap, tiling);
    // NO balloon ball, for the escape solid's reason re-measured on this
    // object: the Mandelbulb is a FILLED solid whose interior
    // reaches the ball centre — DE(0) = 0 and 100% of a 0.1R neighbourhood
    // of the centre is interior, against 0.1% for the Mandelbox at its own
    // (much larger) bailout ball — so the sphere-inverted echo contains
    // infinity, the camera sits inside it (measured union DE at the
    // session's own opening eye: exactly 0 at R = 0.35 and 0.9 raw-ball
    // radii), and every ray hits at t ~ 0 with degenerate normals: a flat,
    // featureless frame at every R, exactly what the escape solid showed
    // one object over. Nulling the ball keeps applySurfaceBalloon packing the
    // variant OFF however the shared toggle is set, so bulb sessions
    // render plain.
    this.surfaceFocusBall = {
      center: [0, 0, 0],
      radius: de.boundingRadius,
    };
    this.surfaceBalloonBall = null;
    this.applySurfaceBalloon();
    // The floor survives where the balloon degenerates, exactly
    // as it does for the escape solid — and a plane under a Mandelbulb is
    // the mode's classic look too.
    this.surfaceGroundBall = { center: [0, 0, 0], radius: de.boundingRadius };
    this.applySurfaceGroundPlane();
    this.activeSurfaceMaterial = this.surfaceMaterial;
    this.surfaceQuad.material = this.surfaceMaterial;
    this.installSurfaceDepth(BULB_ITERATIONS, null);
    // Cheaper per eval than the fold mode that already ships (0.29 us
    // against 1.04, bulb-de.ts's measured verdict), so the plain anchor
    // entry and the legacy strip probe are right here too.
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceDeFoldClass = false;
    this.stripEvidence.reset();
    this.flushStripBacklog();
  }

  /**
   * Turn the surface balloon on or off at a normalized radius
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
    // the new define state.
    this.applySurfaceGroundPlane();
  }

  /**
   * The radius slider's cheap path: recompute R and rewrite
   * uniforms only — packSurfaceBalloon guarantees a no-shader-touch when
   * the flag doesn't flip, so every drag tick may call this. Equality
   * guard keeps render-on-demand honest, like {@link setBalloonEchoRadius}.
   * The compute path needs nothing more than the field update
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

  /**
   * Store the document's shape-trap block — the LIVE half of the trap's
   * wire ({@link setSurfaceBalloonRadius}'s cheap-path discipline): pose/
   * mode/threshold/fade edits rewrite uniforms (GLSL) or ride the next
   * frame spec (compute) with no shader touch, while SHAPE and mode-CLASS
   * changes re-enter the session (main.ts's effect owns that split). Every
   * call may be a drag tick, so equality-guard by content. Stored even
   * while no trap session is live, so the next session enter reads the
   * settled document.
   */
  setSurfaceShapeTrap(trap: ShapeTrap | null): void {
    const next = trap ? JSON.stringify(trap) : null;
    const prev = this.surfaceShapeTrap
      ? JSON.stringify(this.surfaceShapeTrap)
      : null;
    if (next === prev) return;
    this.surfaceShapeTrap = trap;
    if (!this.surfaceShapeTrapLive) return;
    this.renderNeeded = true;
    // The GLSL fallback sessions read uniforms; the compute sessions
    // re-derive from the stored block at every frame-spec assembly, so the
    // field update above IS their push.
    if (!this.surfaceComputeActive && trap) {
      packSurfaceShapeTrapUniforms(
        this.surfaceMaterial,
        resolveShapeTrap(trap),
      );
    }
  }

  /** Push the lattice arm's only live authored field. The GLSL path updates
   * its existing canonical material record and `uTilingH`; compute owns the
   * matching target update in `SurfaceComputeRenderer`, so here it only
   * marks the next frame dirty. Kind/clip edits still re-enter the session. */
  setSurfaceLatticeScale(cellScale: number): void {
    if (this.surfaceComputeActive) {
      this.renderNeeded = true;
      return;
    }
    const fourD = this.activeSurfaceMaterial === this.surfaceMaterial4;
    const material = fourD ? this.surfaceMaterial4 : this.surfaceMaterial;
    const current = materialSurfaceTiling(material, fourD);
    if (!current || !isResolvedLatticeTiling(current)) return;
    const next = resolveTiling(
      {
        kind: "lattice",
        cellScale,
        ...(current.clip ? { clip: current.clip } : {}),
      },
      current.radius,
      latticePresentationPolicyOf(current.presentation),
    );
    if (!next || !isResolvedLatticeTiling(next)) {
      throw new Error("Surface WebGL: failed to resolve live lattice scale");
    }
    if (next.h === current.h) return;
    if (installSurfaceTiling(material, next, fourD, current.radius)) {
      throw new Error(
        "Surface lattice scale unexpectedly changed shader source",
      );
    }
    this.renderNeeded = true;
  }

  /** The live balloon parameter block derived from the stored ball +
   * rMult — ONE definition (fractal/balloon-de.ts's buildBalloon
   * convention with the march far cap alongside) for both the GLSL
   * uniforms and the compute frame spec: rho takes the
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
   * installed system's ball (null clears) and pack it into the ACTIVE
   * fragment material, clearing the other (the 4D tracer has its
   * own arm, so the stored intent must not leave a stale one compiled
   * into the material underneath — `setSurfaceSystem4`'s original move,
   * now needed in both directions). */
  private applySurfaceBalloon(): void {
    const spec = this.surfaceBalloonOn ? this.surfaceBalloonSpec() : null;
    const on4 = this.activeSurfaceMaterial === this.surfaceMaterial4;
    packSurfaceBalloon(this.surfaceMaterial, on4 ? null : spec);
    packSurface4Balloon(this.surfaceMaterial4, on4 ? spec : null);
    // The balloon is the only live input to the grid's validity gate, so
    // every path that moves it — the toggle, a radius drag, a system
    // install re-asserting the stored pair — re-answers it here.
    this.applySurfaceGridEnable();
  }

  /**
   * Re-answer the balloon's grid-validity predicate for the INSTALLED grid
   * and write the march's enable flag — a uniform write, never a rebuild:
   * the cube and its floors are frozen with the session's DE, and only the
   * balloon radius moves.
   *
   * The grid's floors bound the FRACTAL alone, so they are a valid bound
   * on the balloon's UNION exactly while the inverted shell clears the
   * cube ({@link balloonClearsGridBox}, whose module doc carries the
   * derivation, the six-system measurement and the per-cell soundness
   * check). A compiled balloon that fails the predicate marches gridless —
   * the balloon's original state — and one that passes gets its floors
   * back.
   *
   * `spec === null` is the no-balloon case in both directions: either the
   * toggle is off, or the installed system has no ball to certify against
   * (a forward-orbit session), and {@link applySurfaceBalloon} packs the
   * wrapper OFF in both — a plain march, where the floors were always
   * valid.
   */
  private applySurfaceGridEnable(): void {
    if (this.surfaceGridHalfExtent === null) return;
    const spec = this.surfaceBalloonOn ? this.surfaceBalloonSpec() : null;
    packSurfaceGridEnabled(
      this.surfaceMaterial,
      spec === null || balloonClearsGridBox(spec, this.surfaceGridHalfExtent),
    );
  }

  /**
   * Turn the ground plane on or off — the persisted Floor
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
    const room = this.surfaceComputeParams;
    return presentationFloorSpec(ball, {
      pattern: room?.floorPattern ?? "solid",
      tileScale: room?.floorTileScale ?? 0.64,
      emission: room?.floorEmission ?? 0,
    });
  }

  /** Re-assert the stored floor intent against the installed
   * system: packs the plane arm into the 3D material exactly where it is
   * eligible — a ball exists and the balloon variant is not compiled
   * (no horizon inside the shell; every other variant carries the plane
   * arm, its programs stripped far under the Mesa cliff by
   * surfaceFragmentFor). Reading the define makes the gate
   * ordering-proof against the install sequence. */
  private applySurfaceGroundPlane(): void {
    const on4 = this.activeSurfaceMaterial === this.surfaceMaterial4;
    const material = on4 ? this.surfaceMaterial4 : this.surfaceMaterial;
    const balloonDefine = on4
      ? material.defines.SURFACE4_BALLOON
      : material.defines.SURFACE_BALLOON;
    const eligible = this.surfaceGroundPlaneOn && balloonDefine !== 1;
    const spec = eligible ? this.surfaceGroundPlaneSpec() : null;
    // Clear the inactive material's arm for the reason applySurfaceBalloon
    // does: a stale floor must not survive a 3D <-> 4D swap.
    packSurfaceGroundPlane(this.surfaceMaterial, on4 ? null : spec);
    packSurface4GroundPlane(this.surfaceMaterial4, on4 ? spec : null);
  }

  /**
   * Upload a finished empty-space-skipping grid for the
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
    this.surfaceGridHalfExtent = grid.halfExtent;
    packSurfaceGrid(this.surfaceMaterial, texture, grid.halfExtent);
    // packSurfaceGrid enables the reads; the balloon gate may take them
    // straight back off — a grid that arrives mid-inflation is
    // installed and inert until the radius clears the box.
    this.applySurfaceGridEnable();
    this.renderNeeded = true;
  }

  /** Dispose and forget the grid texture, and unhook the 3D material's grid
   * uniforms — every system change lands here before new state goes up. */
  private dropSurfaceGridTexture(): void {
    packSurfaceGrid(this.surfaceMaterial, null);
    this.surfaceGridTexture?.dispose();
    this.surfaceGridTexture = null;
    // No grid installed, so nothing for the balloon gate to re-enable —
    // packSurfaceGrid already dropped the flag.
    this.surfaceGridHalfExtent = null;
  }

  /**
   * 4D twin of {@link setSurfaceSystem}: upload the 4D DE and
   * point the shared quad at the 4D tracer. The rotor/slice VIEW state
   * arrives separately ({@link setSurface4View}) — the DE is
   * pose-independent, exactly as the 3D DE is camera-independent.
   */
  setSurfaceSystem4(
    de: SurfaceDE4,
    colors: Vec3[],
    trapIndices: number[],
    tiling: ResolvedTiling | null = null,
  ): void {
    this.renderNeeded = true;
    // A stale 3D grid must not outlive its system just because the next
    // session is 4D (no grid there — the live rotor/slice would invalidate
    // one every frame).
    this.dropSurfaceGridTexture();
    // The 4D fragment tracer carries no trap arm (escape4 is
    // compute-only), so the channel is never live here.
    this.surfaceShapeTrapLive = false;
    // The 3D install's session-replacement clear, one dimension up.
    if (tiling) packSurface4Balloon(this.surfaceMaterial4, null);
    packSurfaceSystem4(this.surfaceMaterial4, de, colors, trapIndices, tiling);
    this.activeSurfaceMaterial = this.surfaceMaterial4;
    this.surfaceQuad.material = this.surfaceMaterial4;
    // The floor and the balloon install here exactly as they do for a 3D
    // system — both live in the SLICED 3D world space, so their balls are the
    // 4D ball projected (`balloonBall4`: the origin, and the FULL 4D visible
    // radius, so neither slides as the slice slider scrubs). The apply
    // methods dispatch on the active material, which is why it is set above
    // them.
    const focusBall = balloonBall4(de);
    this.surfaceFocusBall = focusBall;
    this.surfaceBalloonBall = focusBall;
    this.surfaceGroundBall = focusBall;
    this.applySurfaceBalloon();
    this.applySurfaceGroundPlane();
    this.installSurfaceDepth(de.maxDepth, de.slowestSigma);
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.surfaceFullPxCostMs = null;
    // 4D surface DEs have no fold vocabulary (affine-class throughout).
    this.surfaceDeFoldClass = false;
    this.stripEvidence.reset();
    this.flushStripBacklog();
  }

  /**
   * Per-frame rotor + w-slice for the 4D surface tracer — the live-pose
   * analogue of {@link setRot4}, with the same "same matrix, don't dirty
   * the frame" guard: main.ts pushes every 4D-surface frame,
   * paused tumble included, and equality keeps render-on-demand honest.
   * `m` is the row-major world rotor from `fourDView.matrix()`; the packer
   * transposes it into the tracer's inverse-rotor uniform.
   *
   * `sliceCenter` arrives in the SIGNED NORMALIZED rotated-w units the slice
   * slider spans — the same [-1, 1] the cloud shader compares against
   * `q.w * uInvWAmp4` and the flame/solid slice windows share — while the
   * tracer's `uW0` is a LITERAL world w (it marches `vec4(p, uW0)` and gates
   * the visible ball against the attractor's own 4D radius). Those two
   * readings would otherwise put one slider position on two different
   * hyperplanes, so the conversion happens HERE, through
   * {@link updateWAmp4}'s own `wSupport` — one expression defines the
   * convention and there is nothing left to drift.
   *
   * `sliceThickness` is the slab's HALF-thickness and rides the
   * identical normalized→world conversion — one `wSupport` call feeds both —
   * so the slab's two edges land on real hyperplanes the position slider
   * could itself have selected, rather than on a plane pair whose spacing
   * drifts with the rotation. A thickness change dirties the frame exactly
   * like a centre change does (it is in the same equality guard below).
   *
   * Before the first 4D cloud upload the half-extents are still zero, so the
   * amplitude is 0 and the tracer marches `w = 0` — the centered slice a
   * fresh visit means anyway, with a zero-thickness slab, which is the
   * cross-section every 4D surface render was before the slab — and the
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
    // The compute path reads the same document at frame-spec assembly —
    // snapshot it beside the uniform writes.
    this.surfaceComputeParams = params;
    // Both tracers share the one SurfaceParams document — push to both so
    // whichever the next session activates is already current.
    for (const material of [this.surfaceMaterial, this.surfaceMaterial4]) {
      const u = material.uniforms;
      u.uAmbient.value = params.ambient;
      u.uEnvLight.value = params.envLight;
      (u.uLightDir.value as THREE.Vector3).copy(
        lightDirection(params.lightAzimuth, params.lightElevation),
      );
      u.uColorSource.value = this.surfaceColorSourceIndex(params);
      u.uColorSpeed.value = params.colorSpeed;
    }
    // Pattern/scale/emission are part of the already-installed floor's
    // uniform payload. Re-pack live; this never changes the shader variant.
    this.applySurfaceGroundPlane();
    // Kept out of the tracer uniforms: metadata is always written, and the
    // saved switch controls only the retained-frame presentation pass.
    this.setSurfaceDepthOfField(params.depthOfField);
  }

  /** Toggle Surface's depth-aware presentation without invalidating the
   * expensive trace. The next presentation of an in-flight frame reads the
   * field directly; an already retained frame is re-blitted immediately by
   * the normal composite latch consumed from the animation loop. */
  setSurfaceDepthOfField(on: boolean): void {
    if (this.surfaceDepthOfField === on) return;
    this.surfaceDepthOfField = on;
    const presentation = this.surfacePresentation;
    if (
      this.surfaceDisplayActive &&
      presentation !== null &&
      (presentation.layer !== null || presentation.metadataInSourceAlpha)
    ) {
      this.surfaceCompositePending = true;
    }
  }

  setSurfaceSettleSamples(samples: number): void {
    this.surfaceSettleSamples = Math.max(1, Math.min(64, Math.round(samples)));
  }

  /**
   * The color-source integer BOTH engines dispatch on — the ONE resolution
   * site of the `"shapeTrap"` source's pinned fallback: selected without a
   * live trap session (the document has no block, or the session is not an
   * escape-family one — the only kind whose shaders carry the channel), it
   * READS AS `"transform"`, the default source, rather than aliasing onto
   * whatever the dispatch's final else happens to hold. `SURFACE_COLOR_SOURCES`
   * stays the single source of truth for the index mapping.
   */
  private surfaceColorSourceIndex(params: SurfaceParams): number {
    const source =
      params.colorSource === "shapeTrap" && !this.surfaceShapeTrapLive
        ? "transform"
        : params.colorSource;
    return SURFACE_COLOR_SOURCES.indexOf(source);
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
    // The compute renderer shares these exact quantized bytes —
    // one ramp definition, bit-identical on both tracers.
    this.surfaceLUTVersion++;
  }

  /**
   * Enter the WebGPU compute presentation for the surface session being
   * started: the same session-entry resets as {@link setSurfaceSystem} —
   * cost-weighted governor entry rung, the DE's own full depth for the
   * preview clamp — without touching the GLSL material, whose fold variant
   * must never compile on this path (the ~25s Mesa link and the
   * kernel-confirmed i915 preemption hang at entry are the point of the
   * mode).
   *
   * `balloon` records whether this session's kernels carry
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
    // An IFS compute session's kernels never carry the trap channel.
    this.surfaceComputeShapeTrap = false;
    this.surfaceShapeTrapLive = false;
    const focusBall = balloonBall(de);
    this.surfaceFocusBall = focusBall;
    this.surfaceBalloonBall = focusBall;
    this.surfaceComputeBalloon = balloon;
    // The floor flag records the create-target's choice exactly
    // like `balloon` above; the ball it drops under is re-derived from
    // the DE so every frame spec can attach the live floor block the
    // 336-byte params struct expects.
    this.surfaceGroundBall = focusBall;
    this.surfaceComputeGroundPlane = groundPlane;
    this.installSurfaceDepth(de.maxDepth, de.slowestSigma);
    this.surfacePreviewGovernor.reset(surfaceDescentCostWeight(de));
    this.surfacePreviewPxCostMs = null;
    // A previous strip session's pooled fences must not linger into (or
    // past) a compute session — the strip machinery never arms here, so
    // nothing would ever adopt them.
    this.flushStripBacklog();
  }

  /**
   * {@link enterSurfaceComputeSession}'s FORWARD-ORBIT twin — escape-time
   * chains and the Mandelbulb alike: the same session-entry resets
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
    shapeTrap: ShapeTrap | null,
  ): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = false;
    // The trap is create-time kernel state exactly like the floor below:
    // record the SESSION's choice (the trap-grown params struct needs the
    // live block on every frame) and store the document block the frame
    // specs re-derive from.
    this.surfaceComputeShapeTrap = shapeTrap !== null;
    this.surfaceShapeTrapLive = shapeTrap !== null;
    this.surfaceShapeTrap = shapeTrap;
    // Forward-orbit sessions never balloon (the escape solid's measured
    // degeneracy, re-measured on the Mandelbulb — see setEscapeSystem's
    // and setBulbSystem's comments) — null the ball
    // exactly like the WebGL install path, and the session flag with it.
    this.surfaceFocusBall = {
      center: [0, 0, 0],
      radius: ballRadius,
    };
    this.surfaceBalloonBall = null;
    this.surfaceComputeBalloon = false;
    // The floor survives where the balloon degenerates — the
    // WebGL path's setEscapeSystem/setBulbSystem move.
    this.surfaceGroundBall = groundPlane
      ? { center: [0, 0, 0], radius: ballRadius }
      : null;
    this.surfaceComputeGroundPlane = groundPlane;
    this.installSurfaceDepth(maxDepth, null);
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.flushStripBacklog();
  }

  /** The escape-time forward orbit's compute entry — see
   * {@link enterSurfaceComputeForwardSession}. */
  enterSurfaceComputeEscapeSession(
    groundPlane = false,
    ballRadius = 1,
    shapeTrap: ShapeTrap | null = null,
  ): void {
    this.enterSurfaceComputeForwardSession(
      ESCAPE_TIME_ITERATIONS,
      groundPlane,
      ballRadius,
      shapeTrap,
    );
  }

  /** The Mandelbulb forward orbit's compute entry — see
   * {@link enterSurfaceComputeForwardSession}. */
  enterSurfaceComputeBulbSession(
    groundPlane = false,
    ballRadius = 1,
    shapeTrap: ShapeTrap | null = null,
  ): void {
    this.enterSurfaceComputeForwardSession(
      BULB_ITERATIONS,
      groundPlane,
      ballRadius,
      shapeTrap,
    );
  }

  /**
   * {@link enterSurfaceComputeSession}'s 4D twin: the
   * same session-entry resets {@link setSurfaceSystem4} makes — the 4D
   * DE's own full depth for the preview clamp, a plain governor reset
   * (no 4D descent cost weight exists yet; the governor's EMA re-prices
   * within a few frames) — without touching either GLSL material. While
   * active, every frame spec carries the live rotor/slice view
   * ({@link setSurface4View} keeps feeding the scene state exactly as in
   * the fragment path — one funnel, both tracers).
   */
  enterSurfaceCompute4Session(
    de: SurfaceDE4,
    balloon = false,
    groundPlane = false,
  ): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = true;
    // A 4D IFS session never carries the trap channel (the 3D entry's
    // clear, one dimension up).
    this.surfaceComputeShapeTrap = false;
    this.surfaceShapeTrapLive = false;
    // Both wrappers are lifted to 4D, and both balls are the 4D
    // ball projected into the sliced world space (`balloonBall4`) — the
    // 3D entry's move with its own ball choice. The flags record the
    // create-target's choice exactly as the 3D entry's do, so every frame
    // spec can attach the live block the grown params struct expects.
    const focusBall = balloonBall4(de);
    this.surfaceFocusBall = focusBall;
    this.surfaceBalloonBall = focusBall;
    this.surfaceComputeBalloon = balloon;
    this.surfaceGroundBall = groundPlane ? focusBall : null;
    this.surfaceComputeGroundPlane = groundPlane;
    this.installSurfaceDepth(de.maxDepth, de.slowestSigma);
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.flushStripBacklog();
  }

  /**
   * {@link enterSurfaceCompute4Session}'s FORWARD-ORBIT sibling — the 4D
   * escape chain, which is compute-only (the fragment 4D tracer carries no
   * escape GLSL, the same verdict fold-shaped 4D sessions took one family
   * over). Structurally {@link enterSurfaceComputeForwardSession} with the 4D
   * preview clamp: the orbit's PASS budget, no balloon ever (a forward
   * solid's echo swallows the camera), and the floor dropping under the
   * bailout ball.
   */
  enterSurfaceComputeEscape4Session(
    groundPlane = false,
    ballRadius = 1,
    shapeTrap: ShapeTrap | null = null,
  ): void {
    this.renderNeeded = true;
    this.surfaceComputeActive = true;
    this.surfaceCompute4 = true;
    // The 3D forward entries' trap record, one dimension up.
    this.surfaceComputeShapeTrap = shapeTrap !== null;
    this.surfaceShapeTrapLive = shapeTrap !== null;
    this.surfaceShapeTrap = shapeTrap;
    this.surfaceFocusBall = {
      center: [0, 0, 0],
      radius: ballRadius,
    };
    this.surfaceBalloonBall = null;
    this.surfaceComputeBalloon = false;
    this.surfaceGroundBall = groundPlane
      ? { center: [0, 0, 0], radius: ballRadius }
      : null;
    this.surfaceComputeGroundPlane = groundPlane;
    this.installSurfaceDepth(ESCAPE_TIME_ITERATIONS, null);
    this.surfacePreviewGovernor.reset();
    this.surfacePreviewPxCostMs = null;
    this.flushStripBacklog();
  }

  /**
   * Record what the session's device can allocate for ONE frame:
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
    this.surfaceComputeShapeTrap = false;
    this.surfaceComputeGroundPlane = false;
    this.surfaceCompute4 = false;
    this.surfaceComputeBalloon = false;
    this.surfaceComputeRayCap = Number.POSITIVE_INFINITY;
    this.surfaceComputeFitNoted = false;
    this.surfaceComputeTexture?.dispose();
    this.surfaceComputeTexture = null;
    this.surfaceComputeLayerTexture?.dispose();
    this.surfaceComputeLayerTexture = null;
    this.surfaceComputeBackground = null;
    this.surfaceComputeMetadataInSourceAlpha = false;
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
   * adaptive rung's scale/depth coupling; acceptance eps ALWAYS derives
   * from the native buffer height (a tier coarsens sampling, never
   * acceptance).
   */
  surfaceComputeFrameSpec(tier: RenderTier): SurfaceComputeFrameSpec {
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    const scale = tier === "preview" ? this.surfacePreviewGovernor.scale : 1;
    // A live frame IS the image — it cannot tile the way a
    // capture does — so an enormous drawing buffer traces at the largest
    // raster the device can allocate for and blits up (the preview tier's
    // own mechanism) rather than failing to allocate. A no-op on every
    // ordinary display; acceptance eps stays native-height either way.
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

  /** Camera-aligned autofocus plane through the active Surface enclosing-ball
   * centre. Both renderer backends receive this same projected depth so the
   * focal region cannot drift when the camera or 4D view moves. */
  private surfaceFocusPlane(): {
    forward: THREE.Vector3;
    depth: number;
  } {
    const forward = this.camera.getWorldDirection(SURFACE_CAMERA_FORWARD);
    const ball = this.surfaceFocusBall;
    if (!ball) return { forward, depth: 1 };
    const [x, y, z] = ball.center;
    return {
      forward,
      depth:
        (x - this.camera.position.x) * forward.x +
        (y - this.camera.position.y) * forward.y +
        (z - this.camera.position.z) * forward.z,
    };
  }

  private surfaceComputeFrameSpecAt(
    tier: RenderTier,
    width: number,
    height: number,
    acceptHeight: number,
    /** The horizontal BAND of a taller image this raster covers, when it
     * is one capture tile of several: `bottom` rows above the
     * full image's bottom row, out of `fullHeight`. The camera's
     * sub-frustum ({@link withViewBand}) already aims the rays; what the
     * band changes HERE is everything derived from the raster's height —
     * the trace eps (a tile's pixels are the full image's pixels, so its
     * cone footprint is the full image's) and the backdrop's `bgOffset`/
     * `bgExtent` (the shared shape reads the FULL image's
     * coordinates — see `fractal/background-shape.ts` — so a band passes
     * its own place in that image rather than a remapped pair of stops;
     * this retired `surfaceComputeBandStops`, which existed only because a
     * LINEAR ramp restricted to a sub-rectangle is still linear). */
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
    const focus = this.surfaceFocusPlane();
    // A band traces the full image's pixels through a sub-frustum, so its
    // per-pixel cone footprint is the full image's, not its own raster's.
    const traceHeight = band ? band.fullHeight : height;
    // This raster's place in the full image the shared shape is
    // evaluated over — (0, 0)/(width, height) for an ordinary frame,
    // (0, band.bottom)/(width, band.fullHeight) for one capture tile of
    // several (bands are always full-width — surfaceComputeTileRows).
    const bgOffset: [number, number] = [0, band ? band.bottom : 0];
    const bgExtent: [number, number] = [width, band ? band.fullHeight : height];
    const traceBackground = this.surfaceTraceBackground(
      bgExtent[0],
      bgExtent[1],
    );
    return {
      width,
      height,
      invProjView: new Float32Array(inv.elements),
      camPos: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ],
      camForward: [focus.forward.x, focus.forward.y, focus.forward.z],
      focusDepth: focus.depth,
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
      shadowSteps:
        this.surfaceComputeGroundPlane ||
        surfaceMaterialsNeedShadow(params.ambient, this.surfaceMaterials)
          ? preview
            ? SURFACE_PREVIEW_SHADOW_STEPS
            : SURFACE_FULL_SHADOW_STEPS
          : 0,
      aoTaps:
        this.surfaceComputeGroundPlane ||
        surfaceMaterialsNeedAo(params.ambient, this.surfaceMaterials)
          ? preview
            ? SURFACE_PREVIEW_AO_TAPS
            : SURFACE_FULL_AO_TAPS
          : 0,
      hitFloor: preview
        ? SURFACE_PREVIEW_HIT_FLOOR
        : this.surfaceFullHitFloor(),
      lightDir: [light.x, light.y, light.z],
      ambient: params.ambient,
      // The environment-light strength, mirroring uEnvLight.
      envLight: params.envLight,
      // The live fog density — re-read at every spec assembly
      // exactly like the lighting/backdrop fields around it, so a live
      // Fog slider drag tracks the compute path the same frame the GLSL
      // uniform does.
      fogDensity: this.fogDensity,
      // The live fog tint — re-read at every spec assembly
      // exactly like fogDensity above; strength 0 keeps the shade
      // kernel's fog toward the pixel's own backdrop alone.
      fogTint: [this.fogTint[0], this.fogTint[1], this.fogTint[2]],
      fogTintStrength: this.fogTintStrength,
      // The live balloon tint — re-read at every spec assembly
      // like the fog pair above, and unconditional like it: the kernel
      // reads balloonTint/balloonTintStrength only under the balloon
      // wrapper, where hi.shell gates the mix, so a non-balloon session is
      // unaffected at any value.
      balloonTint: [
        this.balloonTint[0],
        this.balloonTint[1],
        this.balloonTint[2],
      ],
      balloonTintStrength: this.balloonTintStrength,
      // The session's authored materials — create-time renderer state
      // (its shadeMaps buffer), disclosed on the spec purely so the
      // offline force-frame memo key changes when a timeline leg's
      // document authors different finish/pattern fields under a parked camera; see
      // the field's doc on SurfaceComputeFrameSpec. Absent for a classic
      // document, matching the packer's absent default.
      materials: this.surfaceMaterials ?? undefined,
      // The live backdrop stops — the same pair the GLSL tracers
      // carry as uBgTop/uBgBottom, read fresh at every spec assembly so the
      // compute frames track a background change/crossfade exactly like a
      // lighting change. ALWAYS the full-image stops — a
      // capture tile's own place in the image rides bgOffset/bgExtent
      // below instead of a remapped pair.
      bgTop: [...traceBackground.stops.top],
      bgBottom: [...traceBackground.stops.bottom],
      bgOffset,
      bgExtent,
      // The live backdrop SHAPE, mirroring the GLSL tracers'
      // uBgShape/uBgCenter/uBgScale push in setBackground. Radial's scale
      // is backgroundRadialScale of bgExtent — the FULL image bgOffset/
      // bgExtent already name above — and deliberately NOT of `width`/
      // `height`: a capture band's own raster is a slice of that full
      // image, and scaling by the slice's own dimensions would draw a
      // different ellipse per band instead of one consistent vignette
      // across the whole tiled export (the same reason
      // `surfaceComputeBandStops` had to go — see this method's own doc).
      bgShape: traceBackground.shape,
      colorSource: this.surfaceColorSourceIndex(params),
      colorSpeed: params.colorSpeed,
      lut:
        (this.surfaceLUTTexture?.image.data as Uint8Array | undefined) ?? null,
      lutVersion: this.surfaceLUTVersion,
      // Independent balloon bytes/revision: never overwrite or version-bump
      // the primary surface LUT. Explicit inherit carries null.
      balloonLut:
        this.balloonPaletteEnabled && this.balloonEchoPaletteTexture
          ? (this.balloonEchoPaletteTexture.image.data as Uint8Array)
          : null,
      balloonLutVersion: this.balloonPaletteLUTVersion,
      dither: true,
      // The 4D session's live pose: the same (rotor, w0, halfW) state
      // setSurface4View maintains — already CONVERTED to literal world w
      // (that happens at the setter), re-read at every spec assembly so the
      // compute frames track the tumble/slider exactly as the fragment
      // tracer's uniforms would.
      ...(this.surfaceCompute4
        ? {
            view4: {
              rotor: [...this.surface4Rot],
              w0: this.surface4W0,
              sliceHalfW: this.surface4HalfW,
            },
          }
        : {}),
      // The balloon session's live block: keyed on the
      // SESSION flag — the kernels were compiled with the wrapper and
      // their 320-byte params struct — with values re-derived from the
      // stored ball + rMult at every assembly, so the R slider is live
      // per frame exactly like the rotor/slice above.
      ...(() => {
        if (!this.surfaceComputeBalloon) return {};
        const balloon = this.surfaceBalloonSpec();
        return balloon ? { balloon } : {};
      })(),
      // The floor session's live block: keyed on the SESSION
      // flag — the kernels were compiled with the plane arm and their
      // 336-byte params struct — with values re-derived from the stored
      // ball at every assembly, the balloon block's discipline above.
      ...(() => {
        if (!this.surfaceComputeGroundPlane) return {};
        const groundPlane = this.surfaceGroundPlaneSpec();
        return groundPlane ? { groundPlane } : {};
      })(),
      // The shape-trap session's live block: keyed on the SESSION flag —
      // the kernels were compiled with the trap and their trap-grown
      // params struct — carrying the stored DOCUMENT block re-read at
      // every assembly, so pose/threshold/fade edits are live per frame
      // (the balloon's discipline; the shape inside it is create-time and
      // rides along for the force-frame memo key).
      ...(this.surfaceComputeShapeTrap && this.surfaceShapeTrap
        ? { shapeTrap: this.surfaceShapeTrap }
        : {}),
    };
  }

  /**
   * Upload a finished (or progressively presenting) compute frame and
   * stretch it over the canvas via the shared blit — presentation only,
   * deliberately not an invalidation: presents must not re-arm the
   * preview tier they themselves satisfy.
   */
  presentSurfaceComputeFrame(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    layers?: Uint8Array,
    traceSpec?: SurfaceComputeFrameSpec,
    presentation?: {
      depthOfFieldOverride?: boolean;
      metadataInSourceAlpha?: boolean;
    },
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
    let layerTex: THREE.DataTexture | null = null;
    let reference: TraceBackgroundReference | null = null;
    if (layers && traceSpec) {
      layerTex = this.surfaceComputeLayerTexture;
      if (
        !layerTex ||
        layerTex.image.width !== width ||
        layerTex.image.height !== height
      ) {
        layerTex?.dispose();
        layerTex = new THREE.DataTexture(
          new Uint8Array(width * height * 4),
          width,
          height,
        );
        layerTex.minFilter = THREE.LinearFilter;
        layerTex.magFilter = THREE.LinearFilter;
        layerTex.wrapS = THREE.ClampToEdgeWrapping;
        layerTex.wrapT = THREE.ClampToEdgeWrapping;
        this.surfaceComputeLayerTexture = layerTex;
      }
      (layerTex.image.data as Uint8Array).set(layers);
      layerTex.needsUpdate = true;
      reference = snapshotTraceBackground({
        stops: { top: traceSpec.bgTop, bottom: traceSpec.bgBottom },
        shape: traceSpec.bgShape ?? { kind: "linear" },
      });
    } else {
      // A flattened capture has no beta sidecar. Drop any retained live layer
      // so recorder re-presents cannot pair the new color with stale metadata.
      this.surfaceComputeLayerTexture?.dispose();
      this.surfaceComputeLayerTexture = null;
    }
    this.surfaceComputeBackground = reference;
    this.surfaceComputeMetadataInSourceAlpha =
      presentation?.metadataInSourceAlpha ?? false;
    this.blitSurface(
      tex,
      null,
      layerTex,
      reference,
      null,
      presentation?.depthOfFieldOverride,
      presentation?.metadataInSourceAlpha ?? false,
    );
  }

  /** Repaint the last presented compute frame (recorder ticks, forced
   * offline frames, exit repaints). False when none exists yet. */
  representSurfaceComputeFrame(): boolean {
    if (!this.surfaceComputeTexture) return false;
    this.blitSurface(
      this.surfaceComputeTexture,
      null,
      this.surfaceComputeLayerTexture,
      this.surfaceComputeBackground,
      null,
      undefined,
      this.surfaceComputeMetadataInSourceAlpha,
    );
    return true;
  }

  /** Feed the preview governor a measured compute preview cost — the
   * compute path's analogue of the strip jobs' completed-trace samples. */
  /** Feed a compute preview's measured wall cost to the preview governor.
   * `truncated` marks a budget-cut frame (unresolved rays remained): the
   * governor then panics through its warm-up (the truncated-preview
   * panic — see PreviewGovernor.sample). Returns the new scale when the
   * sample tipped a rung, else null — the caller re-kicks a truncated
   * preview exactly when a drop happened. */
  sampleSurfaceComputeCost(traceMs: number, truncated = false): number | null {
    return this.surfacePreviewGovernor.sample(traceMs, { truncated });
  }

  /** Consume the dirty flag when the compute path kicks a frame for it —
   * the role {@link renderSurface}'s own clear plays on the GLSL path. */
  clearRenderNeeded(): void {
    this.renderNeeded = false;
  }

  /**
   * Compute-path Save-PNG: trace at the export raster fully
   * off-canvas (`trace` runs the async compute frame), then present and
   * read back in ONE synchronous span at the export pixel ratio — the
   * paint and the `toBlob` snapshot share a task, the same discipline as
   * {@link captureSurfaceFrame}. The spec is assembled under the centered
   * projection so the export composes like every other capture
   * (the panel inset is lifted), at the export buffer's own eps (finer
   * resolution traces finer, exactly like the GLSL capture).
   *
   * TILED, because a frame's cost in GPU memory scales with its rays
   * (44 B/ray across eight buffers with the status and background-layer
   * side channels; 36 before the layer) and an export's rays scale
   * with exportScale SQUARED: a 4x export of a 1920x1057 pane is 32.5M
   * rays — a 520 MB ray-state buffer inside a ~1.43 GB GPU frame — which
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
    ) => Promise<SurfaceComputeCaptureBand | null>,
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
    // Like the camera/background specs below, the optical choice is frozen at
    // capture arm. A checkbox change during a long tiled trace affects the
    // live pane afterward, never some bands but not others in the PNG.
    const captureDepthOfField = this.surfaceDepthOfField;
    // EVERY band's spec is assembled in this one synchronous span, before
    // any of them traces. A tiled export spans minutes, and the live
    // camera can move through it (auto-orbit, a drift leg, a tween still
    // gliding): re-reading the pose per band would compose each stripe
    // from a different one. This is the compute path's answer to the
    // WebGL drain's frozen full-tier uniforms — and it freezes
    // the live lighting/backdrop/palette inputs with it.
    // invalidate: false — this readback only assembles band specs under the
    // centered camera; nothing paints the live canvas, so the wrapper's
    // capture invalidation would be a phantom pose change costing a full
    // re-settle after every compute Save-PNG.
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
    }, false);
    const count = bands.length;
    const captureBackground = this.currentSurfaceBackground(width, height);
    const deliverFrozen = async (
      pixels: Uint8Array | Uint8ClampedArray,
      metadataInSourceAlpha: boolean,
    ): Promise<ExportImage | null> => {
      const result = await this.deliverSurfaceCapture(
        pixels,
        width,
        height,
        ratio,
        captureDepthOfField,
        metadataInSourceAlpha,
      );
      if (
        !traceBackgroundsEqual(
          captureBackground,
          this.currentSurfaceBackground(width, height),
        )
      ) {
        // The capture has consumed beta into flattened RGB. Its compact alpha
        // retains CoC only, so a later backdrop edit still needs one live
        // compute frame to recover the full sidecar.
        this.surfaceCompositePending = false;
        this.renderNeeded = true;
      } else if (captureDepthOfField !== this.surfaceDepthOfField) {
        // CoC survived in source alpha, so a switch moved during capture can
        // re-present immediately without tracing the scene again.
        this.surfaceCompositePending = metadataInSourceAlpha;
      }
      return result;
    };
    // One band is the whole image: trace it and present its own pixels,
    // no assembly buffer (a 4x export's would be another 130 MB).
    const image = count === 1 ? null : new Uint8Array(width * height * 4);
    let metadataComplete = true;
    for (let index = 0; index < count; index++) {
      const band = bands[index];
      const traced = await trace(band, { index, count });
      if (!traced) return null;
      const referenceBackground = snapshotTraceBackground({
        stops: { top: band.bgTop, bottom: band.bgBottom },
        shape: band.bgShape ?? { kind: "linear" },
      });
      const pixels = traced.layers
        ? compositeSurfaceBackgroundLayer({
            width,
            height: band.height,
            legacyRgba: traced.pixels,
            layerRgba: traced.layers,
            referenceBackground,
            liveBackground: captureBackground,
            traceOffset: band.bgOffset,
            traceExtent: band.bgExtent,
            outputAlpha: "circle-of-confusion",
          })
        : traced.pixels;
      if (!traced.layers) metadataComplete = false;
      if (image === null) {
        return deliverFrozen(pixels, metadataComplete);
      }
      // Row 0 is the bottom row on both sides (the kernel's py=0 row is
      // ndcY=-1), so a band's rows land contiguously at its own offset.
      image.set(
        pixels.subarray(0, width * band.height * 4),
        index * rows * width * 4,
      );
    }
    return image ? deliverFrozen(image, metadataComplete) : null;
  }

  /** Present a finished capture at the export pixel ratio and read it
   * back — the paint and the `toBlob` snapshot in ONE synchronous span
   * (the renderer runs without `preserveDrawingBuffer`). */
  private deliverSurfaceCapture(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    ratio: number,
    depthOfField: boolean,
    metadataInSourceAlpha: boolean,
  ): Promise<ExportImage | null> {
    return this.withPixelRatio(ratio, () => {
      this.presentSurfaceComputeFrame(
        pixels,
        width,
        height,
        undefined,
        undefined,
        { depthOfFieldOverride: depthOfField, metadataInSourceAlpha },
      );
      return exportImageFrom(this.renderer.domElement);
    });
  }

  /**
   * Assemble something under a SUB-FRUSTUM of the live projection: the
   * band of `bandHeight` rows sitting `bandBottom` rows above the bottom
   * of a `fullWidth` x `fullHeight` image. Three.js's view
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
   * `tier` is main.ts's interaction split: "full" (the default —
   * offline export and thumbnails land here by construction) traces at full
   * quality SYNCHRONOUSLY, through the same adaptive scissored strips and
   * the same pump the async settle job uses (every strip is its own
   * flushed submission, so even a pathological close-up export cannot
   * wedge the GPU process), then presents the completed frame; "preview" traces
   * {@link surfacePreviewTarget} at {@link surfacePreviewGovernor}'s
   * measured rung with the preview-tier quality knobs (depth clamp,
   * march/shadow/AO budgets, hit floor) and stretches it over the canvas —
   * the cheap frames that keep a drag/tumble fluid while the settle frame
   * carries the quality. Every knob is a plain uniform write restored by
   * the next full-tier call, so the shader bodies (and their CPU-oracle
   * discipline) are untouched. Each preview trace also feeds its own
   * measured cost back to the governor, so the rung tracks what
   * this device actually manages on this system — and only preview frames
   * are sampled, never the settle or capture paths.
   */
  renderSurface(tier: RenderTier = "full"): void {
    // A yielding capture owns the target and the frozen full-tier
    // uniforms. main.ts's tick already stands aside on
    // {@link surfaceCaptureBusy}; leaving renderNeeded set means the
    // invalidation this call carried is honoured once the capture lets go,
    // rather than being swallowed here.
    if (this.surfaceCaptureFlight) return;
    this.renderNeeded = false;
    if (this.surfaceComputeActive) {
      // A compute session never compiled the fold GLSL — a stray call
      // through this path must not trigger the ~25s Mesa link the mode
      // exists to avoid. main.ts routes ticks and captures
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
      // next frame.
      this.armSurfacePreview(size);
      this.stepSurfacePreview();
      return;
    }
    // Full quality, synchronously — but never as one unbounded GPU
    // submission: the same adaptive strips through the same
    // pipelined pump as the async settle job, run to completion
    // right here. Offline export and thumbnails land on this path, so a
    // pathological close-up export is watchdog-safe
    // too — and COST-BOUNDED: a monster fold pose prices a
    // full-tier frame in minutes to HOURS of frozen tab, so the frame
    // refuses up front when measured evidence predicts past the export
    // ceiling (checked before any live job is disturbed), and the drain
    // below aborts when an unpredicted pose lies. Both throw
    // {@link SurfaceCaptureCostError}; callers own the surface (offline
    // "Export failed", thumbnail's explorer fallback). This is where the
    // ceilings live NOW and only here: these callers freeze the
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
    this.blitSurface(
      this.surfaceSettleTarget.texture,
      null,
      this.surfaceSettleTarget.textures[1],
      this.surfaceSettleBackground,
    );
  }

  /**
   * Arm a full-tier strip job over a `width` x `height` buffer: refuse up
   * front when measured evidence prices the frame past the export ceiling,
   * clear the live jobs out of the way, size the settle target and freeze
   * this frame's uniforms into it. Split out of {@link renderSurface} so
   * the synchronous drain and the yielding capture drain arm
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
   * `costCeilings` is the interactive/synchronous split. The SYNCHRONOUS
   * callers pass true: offline export and thumbnails run with nobody watching
   * and no way to interrupt a frame, so a predicted monster is refused here —
   * BEFORE any live job is disturbed, so a refused export leaves the pane
   * exactly as it was — with {@link SurfaceCaptureCostError}. The interactive
   * capture passes false and is never refused: it has a modal disclosing
   * measured coverage and a Cancel that works, which is a better answer than
   * a prediction that over-predicts ~4x, and the same button already behaves
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
    this.surfaceSettleBackground = this.setSurfaceFrameUniforms(
      "full",
      height,
      height,
    );
    // Single-pass by default, which is what the synchronous
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
      // A capture NEVER presents: the export-scale target must not reach the
      // canvas mid-drain (the export modal keeps the giant buffer off
      // screen), and a present-on-drain gap would only idle the GPU for a
      // blit nobody sees. An unreachable present due keeps the pump
      // refilling.
      Number.POSITIVE_INFINITY,
    );
    // Adopt whatever the jobs just abandoned still have executing
    // rather than flushing it: the drains pipeline, so their
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
   * synchronous drain can reach, and the caller surfaces the
   * refusal.
   *
   * A frame that did not finish teaches nothing about its own cost — a
   * partial's per-pixel figure understates a frame whose expensive rows
   * it never reached, and strip cost is bimodal enough (a measured
   * 100-1000x band) that under-predicting is the direction that freezes
   * a tab. But the evidence the ARMING threw away is still good: the pose
   * has not moved, so what priced this view a moment ago prices it now.
   * Restoring it keeps a cancelled export from sending the next one to the
   * preview fallback's ~5x over-prediction — which now decides only
   * whether the modal skips its grace period for an interactive save, but
   * still decides whether a thumbnail or an offline frame is refused
   * outright.
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
    // SEED an empty chain, which is the only evidence an offline
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
   * runs — the planner sizes the probe from it. A completed
   * preview's measurement when one exists (it understates the full tier's
   * deeper depth clamp and richer budgets by a small factor, which the
   * probe's target absorbs); else the pessimistic fold-class prior, so a
   * fold session's very FIRST submission is bounded the way the compute
   * path's first slice is (the shade-batch discipline); else null —
   * affine-cheap systems keep the legacy rows-fraction probe.
   */
  private surfaceStripPriorMsPerPx(): number | null {
    return (
      this.surfacePreviewPxCostMs ??
      (this.surfaceDeFoldClass ? STRIP_FOLD_PRIOR_MS_PER_PX : null)
    );
  }

  /** Worst-case per-pixel price (ms) for the planner's strip cap — the second
   * mechanism guarding against the preemption hang: {@link
   * StripCostEvidence.price} on the class-pessimistic WORST constants — a
   * single strip that plans into the frame's most expensive band must still
   * fit the watchdog, so before evidence exists the fold floor assumes band
   * prices ({@link STRIP_FOLD_WORST_MS_PER_PX}'s doc). Without the evidence
   * relaxation, measured-cheap fold settles would crawl through tens of
   * thousands of class-floor micro-strips of pure readback overhead. */
  private surfaceStripWorstMsPerPx(): number {
    return this.stripEvidence.price(
      this.surfaceDeFoldClass
        ? STRIP_FOLD_WORST_MS_PER_PX
        : STRIP_AFFINE_WORST_MS_PER_PX,
    );
  }

  /** Per-pixel price (ms) for the pump's in-flight queue bound
   * — {@link StripCostEvidence.price} on the TYPICAL-cost class floors (the
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
   * irreducible per-monster-pixel floor. */
  private surfaceStripQueueWorstMsPerPx(): number {
    return this.stripEvidence.price(
      this.surfaceDeFoldClass
        ? STRIP_FOLD_PRIOR_MS_PER_PX
        : STRIP_AFFINE_WORST_MS_PER_PX,
    );
  }

  /** Retire a strip job into the evidence chain — the rules (completed
   * replaces both directions, superseded raises only, capture never owns, a
   * completed capture may seed an empty chain) live in {@link
   * StripCostEvidence.retire}; this adapter contributes only the job's
   * observed worst px cost. */
  private retireStripJob(job: SurfaceStripJob, outcome: StripJobOutcome): void {
    this.stripEvidence.retire(outcome, job.planner.observedWorstMsPerPx);
  }

  /** Build a strip job around `planner`: the cost estimate starts at the
   * probe prior (null for affine-cheap systems — the sync-collapse
   * regime's marker, see pumpStrips), the in-flight queue prices at the
   * frozen {@link surfaceStripQueueWorstMsPerPx} (frozen like the
   * planner's floor, and raised live by the planner's own ratchet),
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
      // only: fences this job itself inherited were never in
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
        // FRESHER WINS: the superseded job measured the pose
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
    // (see setSurfaceFrameUniforms).
    const scale = this.surfacePreviewGovernor.scale;
    const w = Math.max(1, Math.round(size.x * scale));
    const h = Math.max(1, Math.round(size.y * scale));
    sizeTarget(this.surfacePreviewTarget, w, h);
    this.surfacePreviewBackground = this.setSurfaceFrameUniforms(
      "preview",
      h,
      size.y,
    );
    // Deliberate composite-layer prefill: unresolved rows are uncovered
    // backdrop (coverage=0, fog=0, beta=1), even on a same-size re-arm.
    // Carrying the prior frame would mix two trace-background references in
    // one MRT and make a later background edit impossible to recompose.
    this.seedSurfaceTarget(
      this.surfacePreviewTarget,
      this.surfacePreviewBackground,
    );
    // Probe SIZED from the prior: a measured px cost when one
    // exists, else the pessimistic fold-class prior. Either way the probe
    // plans at most ~one strip target of predicted GPU — during a drag on
    // a heavy fold system every frame re-arms, and each re-arm's first
    // submission stays bounded (priming the PACING alone used to leave
    // the probe's SIZE fixed at a rows fraction, which on fold systems
    // was seconds of GPU in the one unmeasured submission).
    const previewPrior =
      pxCostMs ?? (this.surfaceDeFoldClass ? STRIP_FOLD_PRIOR_MS_PER_PX : null);
    if (SURFPERF) {
      // The evidence-chain components behind worst= (the instruments the
      // off-centre-slice cost diagnosis shipped): evidenced= is the
      // completed-job floor (null until one completes), partial= the
      // superseded-job term — both RAW, before STRIP_WORST_EVIDENCE_SAFETY
      // scales them into worst.
      console.log(
        `[surfperf] preview armed ${String(w)}x${String(h)}` +
          ` prior=${String(previewPrior)}` +
          ` worst=${this.surfaceStripWorstMsPerPx().toFixed(2)}` +
          ` evidenced=${String(this.stripEvidence.evidencedRawMsPerPx)}` +
          ` partial=${this.stripEvidence.partialRawMsPerPx.toFixed(3)}`,
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
    // GL queue, whichever target owned it) still has executing:
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
   * and true is returned (no-op true when no job is running).
   * However expensive the pose, the job runs to COMPLETION — the standing
   * no-automatic-give-up verdict: an automatic give-up (bail, sub-floor
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
            ` worstSeen=${job.planner.observedWorstMsPerPx.toFixed(3)}` +
            // The two-term cost model, so a field run can tell a
            // fixed-cost-dominated frame from an expensive one: an
            // intercept past the tier target is the regime the sizer
            // switches branches in.
            ` fixedMs=${job.planner.cost.interceptMs.toFixed(1)}` +
            ` marginal=${job.planner.cost.marginalMsPerPx.toFixed(4)}`,
        );
      }
    }
    // Present on the pump's drain gaps (and on completion): the blit
    // rides the same GL queue as the strips, so presenting mid-queue
    // would stall the page's own frames behind the queued trace work.
    if (done || present) {
      this.blitSurface(
        this.surfacePreviewTarget.texture,
        null,
        this.surfacePreviewTarget.textures[1],
        this.surfacePreviewBackground,
      );
    }
    return done;
  }

  /** Discard the in-flight preview job (a full-tier trace or a session
   * exit supersedes it). No governor sample: the discard is not evidence
   * about trace cost. Its in-flight fences pool for the next job to arm
   * — the entry points that must not inherit flush the pool
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
   * progress readout (the standing verdict: the mode never gives up on a
   * frame — it reports progress and the USER decides whether the pose
   * is worth the wait). Traced-and-measured pixels over the job's
   * total: the preview job when one is mid-flight, else the settle
   * job, else null (nothing grinding — settled, superseded, or not in
   * surface mode). No time predictions here by design: two shipped
   * rounds of prediction-driven truncation each misjudged a
   * completable preview; a moving percent lets the user
   * read the rate themselves. */
  surfaceRenderProgress(): {
    phase: "preview" | "settle";
    fraction: number;
    /** Which supersampling pass is tracing, 1-based, and how
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
      // (the compute arm's `done`/`total` convention).
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

  /** The unmasked WebGL renderer string: WEBGL_debug_renderer_info where the
   * browser exposes it, else the masked RENDERER. main.ts matches it against
   * the software-rasterizer tells ONCE at boot — the incident behind it was a
   * browser that silently blocklisted the GPU, so every mode rendered on
   * SwiftShader for a day with nothing on screen saying so. Lives here
   * because raw-GL access stays inside FractalScene. */
  unmaskedRendererLabel(): string | null {
    return unmaskedWebglRenderer(this.renderer.getContext());
  }

  /**
   * Compile the ACTIVE surface material's program off the critical path.
   * The fold-frontier variant (the SURFACE_FOLDS define) is a large
   * program measured at ~25s of driver compile on desktop Mesa —
   * synchronous at first draw, it blocks the main thread for the whole
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
      // measured ~25s Mesa cliff, and the gate metric for growing the
      // fold source. `khr` reports whether the async path
      // (KHR_parallel_shader_compile) was even on offer: the session-death
      // lottery is sessions that come up without it and pay the link
      // synchronously.
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
   * One-pixel proof that the compiled tracer actually DRAWS:
   * `compileAsync` resolves when the program's compile completes, not when
   * it succeeds — a driver that crashed its compiler thread (observed on
   * Mesa/Iris under the 68KB fold program) reports link
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
   * {@link surfaceSettleTarget} — the compute arm's supersampling shape
   * said in strip vocabulary.
   *
   * `samples` PASSES, each a whole-frame strip job through the untouched
   * pump, at {@link subPixelSample}'s offsets — the SAME R2 sequence the
   * WebGPU arm walks, so "8 samples" means one thing in this app. The
   * alternative, an N-loop inside the fragment, multiplies EVERY strip's
   * cost by N: the planner would ratchet and shrink strips to stay
   * watchdog-safe, so it would be safe, but a 3s settle would become 24s
   * with nothing to show at 3s — against the bounded-strip tuning the
   * preemption hang forced and against the standing verdict that this
   * renderer discloses progress rather than making the user wait blind.
   *
   * `samples <= 1` is every path that existed before this: previews (cheap
   * by definition and replaced anyway), thumbnails, and offline video force
   * frames (whose cost would multiply by the frame count). It releases the
   * accumulator and leaves the jitter at the pixel centre, so those traces
   * are the pre-supersampling ones value for value.
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
      // A single-pass caller has no use for either accumulation pair.
      this.surfaceSampleAccum = null;
      this.surfaceSampleLayerAccum = null;
      this.surfaceSampleCoc = null;
      if (
        this.surfacePresentation?.color === this.surfaceSampleTexture ||
        this.surfacePresentation?.layer === this.surfaceSampleLayerTexture
      ) {
        this.surfacePresentation = null;
      }
      this.surfaceSampleTexture?.dispose();
      this.surfaceSampleTexture = null;
      this.surfaceSampleLayerTexture?.dispose();
      this.surfaceSampleLayerTexture = null;
      return;
    }
    const px = width * height;
    if (this.surfaceSampleAccum?.length === px * 3) {
      this.surfaceSampleAccum.fill(0);
    } else {
      this.surfaceSampleAccum = new Float32Array(px * 3);
    }
    if (this.surfaceSampleLayerAccum?.length === px * 3) {
      this.surfaceSampleLayerAccum.fill(0);
    } else {
      this.surfaceSampleLayerAccum = new Float32Array(px * 3);
    }
    if (this.surfaceSampleCoc?.length === px) {
      this.surfaceSampleCoc.fill(255);
    } else {
      this.surfaceSampleCoc = new Uint8Array(px);
      this.surfaceSampleCoc.fill(255);
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
    const layerTex = this.surfaceSampleLayerTexture;
    if (
      !layerTex ||
      layerTex.image.width !== width ||
      layerTex.image.height !== height
    ) {
      layerTex?.dispose();
      const next = new THREE.DataTexture(new Uint8Array(px * 4), width, height);
      next.minFilter = THREE.LinearFilter;
      next.magFilter = THREE.LinearFilter;
      next.wrapS = THREE.ClampToEdgeWrapping;
      next.wrapT = THREE.ClampToEdgeWrapping;
      this.surfaceSampleLayerTexture = next;
    }
  }

  /** Point the active tracer at the CURRENT pass's spot inside the pixel
   * and arm a whole-frame strip job for it. Priors and worst
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
   * system): with the gaps suppressed the mid-drag preview took longer than
   * the gate's 1.5s to reach the canvas and its softness check read 1.03
   * against a 0.81 control — i.e. a drag mid-settle showed the settled frame
   * instead of a preview — the re-arm-discards-partials symptom arriving by
   * another route. What a later pass presents INTO that gap is the last
   * COMPLETED image ({@link presentSurfaceSampleImage}), never
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
   * running linear-light sum.
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
    const layerAccum = this.surfaceSampleLayerAccum;
    const coc = this.surfaceSampleCoc;
    const tex = this.surfaceSampleTexture;
    const layerTex = this.surfaceSampleLayerTexture;
    if (!accum || !layerAccum || !coc || !tex || !layerTex) return;
    const width = this.surfaceSampleWidth;
    const height = this.surfaceSampleHeight;
    const buf = tex.image.data as Uint8Array;
    const layerBuf = layerTex.image.data as Uint8Array;
    const t0 = SURFPERF ? performance.now() : 0;
    this.renderer.readRenderTargetPixels(
      this.surfaceSettleTarget,
      0,
      0,
      width,
      height,
      buf,
    );
    this.renderer.readRenderTargetPixels(
      this.surfaceSettleTarget,
      0,
      0,
      width,
      height,
      layerBuf,
      0,
      1,
    );
    const tRead = SURFPERF ? performance.now() : 0;
    const px = width * height;
    // The terminal census is measured on the FIRST completed pass — the
    // frame the verifier and blank-frame question care about; passes 1..7
    // only anti-alias it. The decoder rejects any alpha outside the exact
    // miss/exhausted/covered vocabulary rather than guessing.
    if (this.surfaceSampleTaken === 0) {
      this.surfaceSettledRayCensus = decodeSurfaceRayCensus(buf, width, height);
    }
    for (let i = 0, p = 0, a = 0; i < px; i++, p += 4, a += 3) {
      accum[a] += SRGB_TO_LINEAR[buf[p]];
      accum[a + 1] += SRGB_TO_LINEAR[buf[p + 1]];
      accum[a + 2] += SRGB_TO_LINEAR[buf[p + 2]];
      layerAccum[a] += layerBuf[p];
      layerAccum[a + 1] += layerBuf[p + 1];
      layerAccum[a + 2] += layerBuf[p + 2];
      // Signed CoC is monotone camera depth. Arithmetic averaging would let
      // near/far samples cancel at silhouettes, so retain the frontmost
      // covered sample; an all-uncovered pixel keeps the far sentinel 255.
      if (layerBuf[p] > 0) coc[i] = Math.min(coc[i], layerBuf[p + 3]);
    }
    this.surfaceSampleTaken += 1;
    // The texture now holds THIS pass verbatim — which is already the
    // right image to re-present while pass 1 traces over the target
    // (encodeSurfaceSampleMean takes over from two passes on).
    tex.needsUpdate = true;
    layerTex.needsUpdate = true;
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
   * Decode the completed settle target's terminal-ray census when the sample
   * accumulator is not there to do so for free.
   *
   * Alpha is a trace-only status byte: 255 for a hit or lit ground plane, 0
   * for a miss, and 128 for an exhausted ray — the WebGPU arm's terminal
   * status tally, one engine over.
   */
  private measureSurfaceRayCensus(width: number, height: number): void {
    const px = width * height;
    if (px <= 0) return;
    const buf = new Uint8Array(px * 4);
    this.renderer.readRenderTargetPixels(
      this.surfaceSettleTarget,
      0,
      0,
      width,
      height,
      buf,
    );
    this.surfaceSettledRayCensus = decodeSurfaceRayCensus(buf, width, height);
  }

  /** Exact status census for the current completed settle pass, or null
   * while that pass is absent/in flight. */
  get surfaceRayCensus(): SurfaceRayCensus | null {
    return this.surfaceSettledRayCensus;
  }

  /**
   * Share of the completed settle frame that drew something, or null if no
   * settle pass has completed since the last {@link beginSurfaceSettle}.
   * main.ts's blank-frame notice reads this on the WebGL arm, where
   * `surface-compute.ts` hands it `(hit + plane) / rays` directly.
   * Same units — a fraction of the settle frame's pixels — and the same
   * classification, so the two engines cannot disagree about whether a
   * document rendered.
   */
  get surfaceCoveredFraction(): number | null {
    const census = this.surfaceSettledRayCensus;
    return census && census.rays > 0 ? census.covered / census.rays : null;
  }

  /**
   * Re-encode the mean of the folded passes over the readback buffer it was
   * accumulated from — the gamma decode's inverse, see
   * {@link foldSurfaceSample}. In place, so a pass costs one full-frame
   * readback and one upload with no copy between them. Color alpha is left as
   * the trace wrote it — the last folded pass's terminal status rather than
   * an opacity, which is invisible because the present blit strips alpha to 1
   * (three r163+ creates the canvas `alpha: true` regardless of the
   * renderer's `alpha` param, so a coverage-0 pixel that DID reach the canvas
   * composited the page background into the pane — the earlier "canvas is
   * alpha:false" claim here was wrong) and is nothing this path reads.
   * Sidecar alpha is the frontmost covered sample's CoC (all-uncovered stays
   * the far sentinel), deliberately not a near/far-cancelling mean. A
   * no-op at one pass, where the buffer already holds that pass verbatim and
   * a round trip through the table could only lose a least significant bit.
   */
  private encodeSurfaceSampleMean(): void {
    const accum = this.surfaceSampleAccum;
    const layerAccum = this.surfaceSampleLayerAccum;
    const coc = this.surfaceSampleCoc;
    const tex = this.surfaceSampleTexture;
    const layerTex = this.surfaceSampleLayerTexture;
    if (
      !accum ||
      !layerAccum ||
      !coc ||
      !tex ||
      !layerTex ||
      this.surfaceSampleTaken < 2
    ) {
      return;
    }
    const buf = tex.image.data as Uint8Array;
    const layerBuf = layerTex.image.data as Uint8Array;
    const inv = 1 / this.surfaceSampleTaken;
    const invGamma = 1 / SURFACE_OUTPUT_GAMMA;
    for (let p = 0, a = 0, i = 0; p < buf.length; p += 4, a += 3, i++) {
      buf[p] = Math.round(255 * Math.pow(accum[a] * inv, invGamma));
      buf[p + 1] = Math.round(255 * Math.pow(accum[a + 1] * inv, invGamma));
      buf[p + 2] = Math.round(255 * Math.pow(accum[a + 2] * inv, invGamma));
      layerBuf[p] = Math.round(layerAccum[a] * inv);
      layerBuf[p + 1] = Math.round(layerAccum[a + 1] * inv);
      layerBuf[p + 2] = Math.round(layerAccum[a + 2] * inv);
      layerBuf[p + 3] = coc[i];
    }
    tex.needsUpdate = true;
    layerTex.needsUpdate = true;
  }

  /**
   * Stretch the last COMPLETED image of the current sequence over `target`
   * (null = the canvas): the mean of the folded passes, or pass 0 verbatim
   * while it is the only one. False — and nothing drawn — before any pass
   * has landed, which is the single-pass caller's whole path: it presents
   * its traced target directly, byte for byte as before supersampling.
   */
  private presentSurfaceSampleImage(
    target: THREE.WebGLRenderTarget | null = null,
    liveOverride: TraceBackgroundReference | null = null,
    depthOfFieldOverride?: boolean,
  ): boolean {
    const tex = this.surfaceSampleTexture;
    if (!tex || this.surfaceSampleTaken < 1) return false;
    this.blitSurface(
      tex,
      target,
      this.surfaceSampleLayerTexture,
      this.surfaceSettleBackground,
      liveOverride,
      depthOfFieldOverride,
    );
    this.surfaceSampleMeanReady = true;
    return true;
  }

  /**
   * Start the ASYNC full-quality settle job: freeze the camera +
   * full-tier quality uniforms (main.ts abandons the job on any
   * invalidation, so they cannot go stale mid-job), seed the settle target
   * with the parked preview stretched to full size — per-step progress
   * blits then show the preview sharpening strip by strip, never
   * uninitialized rows — and arm the strip planner.
   * {@link stepSurfaceSettle} does the actual tracing, a bounded slice per
   * animation frame. It always ARMS — however expensive the frame, the
   * planner's caps keep every submission bounded and the progressive
   * blits keep the grind visible and interruptible; a silent refusal
   * would read as a broken render (the preemption hang's review lesson).
   */
  beginSurfaceSettle(seed: "preview" | "hold" = "preview"): void {
    // main.ts holds the settle off until the preview job completes; a
    // still-armed job here would resume later with THIS frame's full-tier
    // uniforms, so drop it defensively.
    this.abandonSurfacePreview();
    const size = this.renderer.getDrawingBufferSize(DRAW_SIZE);
    sizeTarget(this.surfaceSettleTarget, size.x, size.y);
    this.surfaceSettleBackground = this.setSurfaceFrameUniforms(
      "full",
      size.y,
      size.y,
    );
    // Seed for the rows the strips haven't traced yet. "preview" — the
    // normal choreography — upscales the completed preview of THIS pose.
    // "hold" (the previews-off pref) keeps the target's own stale pixels:
    // no preview of this pose exists, and the previous settled frame is the
    // exact image the frozen pane is already showing, so the develop stays
    // seamless — the compute path's prefill-from-last-frame discipline.
    // (A resize re-allocates the target and the hold seed degrades to
    // undefined rows — rare, and strips overwrite them progressively.)
    if (seed === "preview") {
      this.blitSurface(
        this.surfacePreviewTarget.texture,
        this.surfaceSettleTarget,
        this.surfacePreviewTarget.textures[1],
        this.surfacePreviewBackground,
      );
    } else {
      // With previews disabled there is no coherent same-pose layer to seed
      // from. Start uncovered so a mid-frame background edit remains exact.
      this.seedSurfaceTarget(
        this.surfaceSettleTarget,
        this.surfaceSettleBackground,
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
    // its fences carry nothing the settle needs (the normal
    // choreography completes the preview before this runs, so a pool
    // here is the rare defensive-abandon case). Flush so the settle's
    // clean-probe invariant holds exactly as before inheritance existed.
    this.flushStripBacklog();
    // Probe SIZED from the completed preview's measured per-pixel cost —
    // or the pessimistic fold prior when none exists. The
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
          ` evidenced=${String(this.stripEvidence.evidencedRawMsPerPx)}` +
          ` partial=${this.stripEvidence.partialRawMsPerPx.toFixed(3)}`,
      );
    }
    // The settle is the one live frame worth supersampling — it is what a
    // parked view finally shows, and the escape-time objects' speckle is
    // sub-pixel structure no march budget or viewport reaches (measured on
    // the compute engine this arm stands in for). Pass
    // 0 is armed exactly as it always was, below.
    this.beginSurfaceSamples(this.surfaceSettleSamples, size.x, size.y);
    this.surfaceSettledRayCensus = null;
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
   * "Complete" means the whole SUPERSAMPLING SEQUENCE: a
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
      // LATER pass repaints the last completed image instead —
      // the gap itself is what keeps the queue from running permanently
      // full, but the pass being traced over the target must not be shown
      // half-done.
      if (present) {
        if (
          this.surfaceSampleIndex === 0 ||
          !this.presentSurfaceSampleImage()
        ) {
          this.blitSurface(
            this.surfaceSettleTarget.texture,
            null,
            this.surfaceSettleTarget.textures[1],
            this.surfaceSettleBackground,
          );
        }
      }
      return false;
    }
    return this.advanceSurfaceSettleSample();
  }

  /**
   * A settle pass just completed: fold it in, present, and arm
   * the next one — or report the sequence finished.
   *
   * PASS 0 IS THE PRE-SUPERSAMPLING SETTLE and is presented as one: the
   * traced target itself, at the moment it always arrived. Everything after it
   * only refines, and an abandon between passes leaves the canvas showing
   * the mean of what completed — never a partially traced pass, which is
   * why the later jobs repaint that mean into their drain gaps rather than
   * the target they are writing.
   */
  private advanceSurfaceSettleSample(): boolean {
    const target = this.surfaceSettleTarget;
    if (this.surfaceSampleTotal <= 1) {
      // `?surfacesamples=1` — no accumulator, so the status census has to
      // buy its own readback. One frame, once per settle, on a
      // debug path: the alternative is a blank-frame notice that silently
      // stops working under the flag that exists to A/B this arm.
      this.measureSurfaceRayCensus(target.width, target.height);
      this.blitSurface(
        target.texture,
        null,
        target.textures[1],
        this.surfaceSettleBackground,
      );
      return true;
    }
    const first = this.surfaceSampleIndex === 0;
    this.foldSurfaceSample();
    this.encodeSurfaceSampleMean();
    if (first || !this.presentSurfaceSampleImage()) {
      // Pass 0 presents its own TARGET — the pre-supersampling settle, at
      // the moment it always arrived — and never the readback of it.
      this.blitSurface(
        target.texture,
        null,
        target.textures[1],
        this.surfaceSettleBackground,
      );
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
   * the pose too: every invalidation lands here, so the
   * capture predictor can never price a pose the measurement didn't
   * see. */
  abandonSurfaceSettle(): void {
    // Settle fences pool for the NEXT preview to adopt: the
    // abandon crosses render targets, but the GL queue is one — the
    // re-armed preview's strips execute behind these exact submissions.
    this.poolStripBacklog(this.surfaceStripJob);
    this.surfaceStripJob = null;
    this.surfaceFullPxCostMs = null;
    this.surfaceSettledRayCensus = null;
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
    // left in the target — a re-present has to repaint what the
    // pane is already showing, or a recorder frame of a parked view would
    // be visibly noisier than the view it recorded.
    if (this.surfaceSampleMeanReady && this.presentSurfaceSampleImage()) return;
    this.blitSurface(
      this.surfaceSettleTarget.texture,
      null,
      this.surfaceSettleTarget.textures[1],
      this.surfaceSettleBackground,
    );
  }

  /**
   * Camera + per-tier quality uniforms on the ACTIVE surface material, for
   * a trace whose buffer is `height` pixels tall. `acceptHeight` is the
   * height of the FULL-RESOLUTION frame this trace stands in for (the
   * settle/capture buffer): hit acceptance derives its epsilon from THAT,
   * tier-independently, so a preview can never accept a hit the settle frame
   * would reject (the fold-phantom fix; see uAcceptPixelEps's doc in
   * surface-material.ts). The tier knobs are all tracer-side (march/shadow/AO
   * budgets, hit floor, depth clamp — plain uniform writes); the
   * oracle-mirrored DE bodies never change.
   */
  private setSurfaceFrameUniforms(
    tier: RenderTier,
    height: number,
    acceptHeight: number,
  ): TraceBackgroundReference {
    this.camera.updateMatrixWorld();
    const u = this.activeSurfaceMaterial.uniforms;
    const background = this.surfaceTraceBackground(
      this.viewportWidth,
      this.viewportHeight,
    );
    (u.uBgTop.value as THREE.Vector3).set(...background.stops.top);
    (u.uBgBottom.value as THREE.Vector3).set(...background.stops.bottom);
    u.uBgShape.value = backgroundShapeCode(background.shape.kind);
    (u.uBgCenter.value as THREE.Vector2).set(
      ...(background.shape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER),
    );
    (u.uBgScale.value as THREE.Vector2).set(
      ...(background.shape.scale ?? [1, 1]),
    );
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    const focus = this.surfaceFocusPlane();
    (u.uFocusPlane.value as THREE.Vector4).set(
      focus.forward.x,
      focus.forward.y,
      focus.forward.z,
      focus.depth,
    );
    (u.uInvProjView.value as THREE.Matrix4)
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .invert();
    const angularPerPixel = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    u.uPixelEps.value = angularPerPixel / Math.max(height, 1);
    u.uAcceptPixelEps.value = angularPerPixel / Math.max(acceptHeight, 1);
    // Every freshly armed job aims at the pixel CENTRE. This is
    // the ONE funnel each of them goes through, so resetting here is what
    // makes an abandoned supersampling pass unable to leak its jitter into
    // the preview, thumbnail or export that follows — and what keeps every
    // single-pass trace value-identical to the pre-supersampling one. Only
    // {@link armSurfaceSamplePass} sets it otherwise, and only after this
    // has run for the sequence's first pass.
    (u.uPixelJitter.value as THREE.Vector4).set(0, 0, 0, 0);
    const preview = tier === "preview";
    // Derived per frame, never cached: the clamp depends on BOTH the
    // active DE's own full depth and the live governor rung, and the two
    // change independently. A finer rung resolves smaller
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
    u.uShadowSteps.value =
      this.surfaceGroundPlaneOn ||
      surfaceMaterialsNeedShadow(
        this.surfaceComputeParams?.ambient ?? 0,
        this.surfaceMaterials,
      )
        ? preview
          ? SURFACE_PREVIEW_SHADOW_STEPS
          : SURFACE_FULL_SHADOW_STEPS
        : 0;
    u.uAoTaps.value =
      this.surfaceGroundPlaneOn ||
      surfaceMaterialsNeedAo(
        this.surfaceComputeParams?.ambient ?? 0,
        this.surfaceMaterials,
      )
        ? preview
          ? SURFACE_PREVIEW_AO_TAPS
          : SURFACE_FULL_AO_TAPS
        : 0;
    u.uHitFloor.value = preview
      ? SURFACE_PREVIEW_HIT_FLOOR
      : this.surfaceFullHitFloor();
    return background;
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
      // predictor's best evidence — same tier, same pose;
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
   * The shared strip pump under both the settle job and the preview job — the
   * bounded-submission answer to the kernel-confirmed i915 preemption hang:
   * collect completed strips, submit new ones, report completion and when the
   * caller should present. THE cost model this pump exists for, measured on
   * Mesa/Iris: a forced-completion readback costs ~10-25ms REGARDLESS of
   * strip size, so per-strip joins multiply that floor by the planner's strip
   * count — the capped fold frames that keep submissions watchdog-safe plan
   * THOUSANDS of strips, and joining each one turned a measured ~2s of GPU
   * into ~55s of drains where main's ~50 uncapped strips paid ~1s. Fences
   * amortize the floor to ~50us/strip; the caps become free.
   *
   * EVERY surface trace runs through this pump: the live preview and settle
   * one budget per rAF, the capture and offline drains in their own loops
   * (they used to join every strip themselves, which is the same
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
   *   pricing matters, it is accurate). Each batch is reported to the
   *   planner at the width it was measured at, where the two-term cost
   *   model attributes it — the sizing call itself passes NO
   *   measurement, since re-quoting a batch average at one strip's width
   *   is what drove the old sizer to 1px strips. The estimate still
   *   spikes the moment a batch lands in an expensive band, emptying the
   *   refill behind it. The
   *   estimate is also one whole batch BEHIND reality, and fold frames
   *   are 100-1000x bimodal — so the refill ALSO prices the queue at the
   *   job's queue price, raised live by the planner's ratcheted
   *   observations ({@link SURFACE_STRIP_QUEUE_WORST_MS}): an
   *   est-lagged cost-band entry used to ride the queue as whole seconds
   *   of unpredicted work (measured 16-22s groups in the stale-evidence
   *   incident, ~3s main-thread stalls once per crease
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
    // adopted a backlog must poll the inherited fences out
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
      // PRICE THE PACING ON THE MARGINAL, not on the batch
      // average. A batch's wall carries its fixed cost — the fence
      // service, and for a yielding drain one whole caller tick of poll
      // quantization — and charging that to the pixels that happened to
      // ride it collapses both lines below to a single strip on exactly
      // the frames where the fixed cost dominates, which is where a
      // pipeline is worth having (a queue one strip deep re-measures the
      // same tick against fewer pixels, which is the one-way-ratchet loop
      // seen from the caller's side). On an ordinary frame the two agree
      // within `(px + pivot)/px` and nothing moves. SAFETY IS NOT ON
      // THIS LINE: the queue's real bound is `worst()` below, priced at
      // the planner's raw ms/px ratchet and untouched.
      const est = (): number =>
        job.planner.cost.marginalMsPerPx > 0
          ? job.planner.cost.marginalMsPerPx
          : (job.msPerPxEstimate ?? 0);
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
        // No refill while an adopted backlog rides unmeasured:
        // est() would read 0 and admit unbounded strips behind a queue
        // whose cost nothing has priced yet. The first completed batch
        // seeds the estimate and refill resumes. Every other path into
        // this loop carries a non-null estimate (prior-seeded, batch-
        // attributed, or the sync-collapse escape's own measurement).
        job.msPerPxEstimate !== null &&
        now < job.presentDue &&
        submits < SURFACE_STRIP_MAX_SUBMITS_PER_PUMP &&
        (job.inFlightPx + groupPx) * est() < queueBudgetMs &&
        // Queue-priced twin of the line above: the estimate
        // lags a cost-band entry by a whole fence batch, so the queue is
        // ALSO bounded at the job's queue price raised by the planner's
        // own ratcheted observations — an empty queue always admits one
        // strip, so the degenerate case is one worst-capped strip riding
        // alone, never a stall.
        (job.inFlightPx + groupPx) * worst() < SURFACE_STRIP_QUEUE_WORST_MS
      ) {
        // NULL, NOT THE ESTIMATE: this regime measures FENCE
        // BATCHES, and {@link collectStripFences} already reports each
        // one to `planner.observe` at the width it was measured at.
        // Handing the same batch back here as
        // `estimate x lastSubmittedPx` would be a fabricated measurement
        // at a width nothing was measured at — the per-pixel-average
        // re-quotation the two-term model exists to undo — and the
        // planner would attribute it a second time. Its worst-price
        // ratchet contribution was redundant anyway: identical ms/px, and
        // the ratchet is a max.
        const strip = job.planner.next(null);
        if (!strip) break;
        this.renderStripRects(target, strip.rects);
        // The flush hands the strip to the GPU as its own submission now —
        // without it the whole group would ride one oversized submission
        // with no preemption boundaries inside it.
        gl.flush();
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
   *   inherited fences traced a superseded pose's frame.
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
      // Report at measurement time: the `prevMs` door on
      // next() never hears about a job's LAST batch — which is exactly
      // the batch that discovers the expensive band on frames traced
      // top-down toward the surface.
      job.planner.observe(marginalMs, completedPx);
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
      // Measurement-time report: the final strip's — and an
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
   * the per-strip forced-completion joins this drain used to pay.
   * The old shape bought exact per-strip measurements at one
   * ~{@link SURFACE_STRIP_SYNC_TAX_MS} sync point PER STRIP, and a capped
   * frame plans hundreds to thousands of them: measured on SwiftShader at
   * 1280x720, a Save-PNG of a pose the live settle finished in 19s had
   * covered ~37% when it hit the 60s spend ceiling. Now the queue carries
   * the frame and a synchronous caller pays ONE sync point per queueful
   * ({@link joinStripQueue}) — the wait it has instead of a yield.
   *
   * Tolerate is not "forever": a monster fold pose prices a frame
   * in hours of frozen tab, and THIS drain really does freeze it — its
   * callers have no modal, no percentage and no Cancel — so past
   * `spendCeilingMs` ({@link SURFACE_CAPTURE_SPEND_CEILING_MS}) of measured
   * spend it gives up and returns false, and the caller surfaces the
   * refusal. The yielding drain, which has all three, is bounded by the
   * user instead. Giving up winds the queue down first (see
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
   * {@link drainStripsSync}, yielding: the same pump, the same
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
   * and for the two uniform writers that used to sit outside the
   * guard: a live 4D view push, which would have split an exported frame
   * across two hyperplanes, and a late grid upload.
   *
   * The main thread never blocks on GPU work at all, so
   * responsiveness no longer bottoms out at one strip's cost (the planner
   * caps a strip at `STRIP_WORST_CASE_CAP_MS` of predicted GPU, and on a
   * monster fold pose single crease pixels have measured 1.7-3.1s): a
   * cancel is observed within a tick even while such a strip executes.
   * What a cancel still waits for is the queue it already submitted.
   *
   * There is no spend ceiling here. This drain runs exactly as
   * long as the user lets it: `cancelled` is the stop, `onProgress` is the
   * basis they stop on, and an abort the app decided for itself would be
   * the same patience-guessing the preview tier already reverted — and
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
   * drain returns. The queued GPU work cannot be recalled, and an
   * export's leftovers are the last thing the live tier should inherit: the
   * strips write the EXPORT-SIZED settle target, which the next settle
   * re-sizes (reallocating texture and framebuffer) the moment it takes the
   * pane back — defined behaviour in GL, but not a queue worth leaving
   * outstanding for a live job to price, attribute and draw behind.
   * Attribution is the sharper half: the fences are THIS frame's, so
   * collecting them here charges their wall to the frame that submitted
   * them rather than to whichever live job observes the queue next
   * (the pooled-fence contamination, one queueful of it).
   *
   * The wait costs the queue's own remaining time, with the main thread
   * free throughout. That is what a cancel waits for, and it is not free:
   * the refill admitted {@link SURFACE_STRIP_QUEUE_WORST_MS} of work priced
   * at the job's QUEUE price (the typical-cost class floor), so a
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
   * same ~{@link SURFACE_STRIP_SYNC_TAX_MS} once per STRIP. */
  private joinStripQueue(
    gl: WebGL2RenderingContext,
    target: THREE.WebGLRenderTarget,
  ): void {
    this.renderer.setRenderTarget(target);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    this.renderer.setRenderTarget(null);
  }

  /** Render one strip's 1-3 scissor rects (sub-row strips are what let
   * the planner bound fold submissions below one row's cost).
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
   * {@link surfaceStripBacklog} instead of deleting them — the
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
    // adoption needs on a pool nobody claimed promptly. A job
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
   * charging the whole backlog to its own strips (the measured 90x
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
    // Busy continuity, bounded by what the pooled work could still owe:
    // the normal adoption is a frame or two after pooling, where the clamp
    // is inert; the pathological one is a pool that waited out an
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

  /** The analytic source expensive Surface tracers freeze. An active image
   * uses its mean as a flat fallback; the final compositor replaces only the
   * retained background contribution with the full per-pixel source. */
  private surfaceTraceBackground(
    width: number,
    height: number,
  ): TraceBackgroundReference {
    if (this.backdropImageActive && this.backdropImage !== null) {
      const mean: [number, number, number] = [...this.backdropImageMean];
      return snapshotTraceBackground({
        stops: { top: mean, bottom: [...mean] },
        shape: { kind: "linear" },
      });
    }
    return snapshotTraceBackground({
      stops: this.backdrop,
      shape: this.backgroundShapeSpecForImage(width, height),
    });
  }

  /** The source the final compositor should show right now. */
  private currentSurfaceBackground(
    width = this.viewportWidth,
    height = this.viewportHeight,
  ): TraceBackgroundReference {
    const fallback = this.surfaceTraceBackground(width, height);
    return this.backdropImageActive && this.backdropImage !== null
      ? snapshotTraceBackground({ ...fallback, image: this.backdropImage })
      : fallback;
  }

  /** Bind an image reference. The live image reuses the CanvasTexture; a
   * capture-frozen older revision gets a short-lived DataTexture so a later
   * worker delivery cannot alter the export midway through its async drain. */
  private surfaceBackgroundTexture(background: TraceBackgroundReference): {
    texture: THREE.Texture;
    disposable: THREE.Texture | null;
  } {
    const image = background.image;
    if (
      image === undefined ||
      (this.backdropImageActive && image === this.backdropImage)
    ) {
      return { texture: this.backdropTexture, disposable: null };
    }
    const texture = new THREE.DataTexture(
      image.rgba,
      image.width,
      image.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.flipY = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { texture, disposable: texture };
  }

  private setSurfaceBlitBackground(
    prefix: "Trace" | "Live",
    background: TraceBackgroundReference,
  ): THREE.Texture | null {
    const u = this.surfaceBlitMaterial.uniforms;
    const image = this.surfaceBackgroundTexture(background);
    u[`u${prefix}BgImage`].value = image.texture;
    u[`u${prefix}BgKind`].value = background.image === undefined ? 0 : 1;
    (u[`u${prefix}BgTop`].value as THREE.Vector3).set(...background.stops.top);
    (u[`u${prefix}BgBottom`].value as THREE.Vector3).set(
      ...background.stops.bottom,
    );
    u[`u${prefix}BgShape`].value = backgroundShapeCode(background.shape.kind);
    (u[`u${prefix}BgCenter`].value as THREE.Vector2).set(
      ...(background.shape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER),
    );
    (u[`u${prefix}BgScale`].value as THREE.Vector2).set(
      ...(background.shape.scale ?? [1, 1]),
    );
    return image.disposable;
  }

  /** Fill both attachments with uncovered backdrop. This is the deliberate
   * mid-frame policy: pixels a bounded trace has not reached yet follow a
   * live background edit immediately instead of impersonating misses from a
   * stale reference. */
  private seedSurfaceTarget(
    target: THREE.WebGLRenderTarget,
    background: TraceBackgroundReference,
  ): void {
    const u = this.surfaceBlitMaterial.uniforms;
    u.uHasSource.value = 0;
    u.uHasLayer.value = 0;
    u.uComposite.value = 0;
    u.uDepthOfField.value = 0;
    u.uDofMetadataInSourceAlpha.value = 0;
    const disposable = this.setSurfaceBlitBackground("Live", background);
    this.renderer.setRenderTarget(target);
    this.surfaceBlitQuad.render(this.renderer);
    this.renderer.setRenderTarget(null);
    disposable?.dispose();
  }

  /** Stretch `src` over `target` (null = the canvas) via the shared opaque
   * compositor. Equal backgrounds take a literal legacy RGB copy; only an
   * actual edit evaluates the sidecar delta. */
  private blitSurface(
    src: THREE.Texture,
    target: THREE.WebGLRenderTarget | null,
    layer: THREE.Texture | null = null,
    background: TraceBackgroundReference | null = null,
    liveOverride: TraceBackgroundReference | null = null,
    depthOfFieldOverride?: boolean,
    metadataInSourceAlpha = false,
  ): void {
    const u = this.surfaceBlitMaterial.uniforms;
    const live = liveOverride ?? this.currentSurfaceBackground();
    u.uSrc.value = src;
    u.uLayer.value = layer ?? src;
    u.uHasSource.value = 1;
    u.uHasLayer.value = layer === null ? 0 : 1;
    u.uComposite.value =
      layer !== null &&
      background !== null &&
      !traceBackgroundsEqual(background, live)
        ? 1
        : 0;
    // Filtering belongs only to the final presentation. Intermediate seed,
    // sample and settle copies must keep raw color/metadata or later passes
    // would blur twice and lose the unfiltered trace.
    u.uDepthOfField.value =
      target === null &&
      (depthOfFieldOverride ?? this.surfaceDepthOfField) &&
      (layer !== null || metadataInSourceAlpha)
        ? 1
        : 0;
    u.uDofMetadataInSourceAlpha.value =
      target === null && metadataInSourceAlpha ? 1 : 0;
    const liveDisposable = this.setSurfaceBlitBackground("Live", live);
    const traceDisposable =
      background === null
        ? null
        : this.setSurfaceBlitBackground("Trace", background);
    this.renderer.setRenderTarget(target);
    this.surfaceBlitQuad.render(this.renderer);
    this.renderer.setRenderTarget(null);
    liveDisposable?.dispose();
    traceDisposable?.dispose();
    if (target === null) {
      this.surfacePresentation = {
        color: src,
        layer,
        background,
        metadataInSourceAlpha,
      };
      this.surfaceCompositePending = false;
    }
  }

  /**
   * Release {@link surfaceSampleAccum}/{@link surfaceSampleTexture} —
   * however a {@link captureSurfaceFrame} call ends (delivered, Cancelled,
   * or the viewport-mismatch refusal) — so an export-scale sample sequence
   * does not sit resident for a parked view that never arms another settle
   * (up to hundreds of MB at a large export scale). Mirrors
   * {@link exitSurfaceComputeSession}'s dispose+null shape.
   *
   * Safe against the LIVE settle path sharing these exact two fields:
   * {@link beginSurfaceSettle} unconditionally re-arms both, lazily, at ITS
   * OWN (live) size on every settle (`beginSurfaceSamples`'s own
   * reuse-or-reallocate check, this file) — same as
   * {@link beginSurfaceFullFrame} does at the START of every full frame,
   * export or live — and every reader of the two
   * ({@link foldSurfaceSample}, {@link encodeSurfaceSampleMean},
   * {@link presentSurfaceSampleImage}) already no-ops when either is
   * absent. A parked view just never reaches that next settle to reclaim
   * an export-sized buffer on its own. {@link surfaceSettleTarget} is
   * deliberately left alone: {@link presentSettledSurface}'s
   * parked-recorder-frame path reads it directly whenever the sample
   * texture is absent, so it has to stay the one always-valid fallback
   * image — this capture leaves it holding the last pass traced into it,
   * not shrunk.
   */
  private releaseSurfaceSampleSequence(): void {
    if (
      this.surfacePresentation?.color === this.surfaceSampleTexture ||
      this.surfacePresentation?.layer === this.surfaceSampleLayerTexture
    ) {
      this.surfacePresentation = null;
    }
    this.surfaceSampleAccum = null;
    this.surfaceSampleLayerAccum = null;
    this.surfaceSampleCoc = null;
    this.surfaceSampleTexture?.dispose();
    this.surfaceSampleTexture = null;
    this.surfaceSampleLayerTexture?.dispose();
    this.surfaceSampleLayerTexture = null;
    this.surfaceSampleMeanReady = false;
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
   * That split is the export modal's prerequisite. The drain used to run
   * inside the ratio/projection wrappers with no yield, freezing the tab for
   * its whole duration; now it hands the main thread back on every {@link
   * nextDrainTick} between pump calls, so the export modal can disclose
   * coverage and offer a working Cancel. Two consequences follow. The export
   * pixel ratio is NOT held across the trace — the size is derived
   * arithmetically instead (three.js floors a buffer out of a ratio the same
   * way), so the live canvas keeps its own buffer and nothing giant ever
   * reaches the screen mid-drain. And the centered projection wraps only the
   * arming call, because {@link setSurfaceFrameUniforms} snapshots the camera
   * into uniforms and the drain never reads it again.
   *
   * `opts.onProgress` reports traced coverage in [0, 1]; `opts.cancelled`
   * is polled at every tick and resolves the capture `null` — the caller
   * knows it asked, so it owns the difference between "cancelled" and "the
   * browser refused the encode".
   *
   * NO COST CEILING RUNS HERE. The predict refusal and the
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
    // A compute session never compiled the fold GLSL. main.ts
    // routes captures to captureSurfaceComputeFrame before this can
    // matter; refusing keeps an accidental caller from paying the ~25s
    // Mesa link the mode exists to avoid.
    if (this.surfaceComputeActive) return null;
    const ratio = this.exportPixelRatio(exportScale);
    const width = Math.floor(this.viewportWidth * ratio);
    const height = Math.floor(this.viewportHeight * ratio);
    const captureBackground = this.currentSurfaceBackground(width, height);
    const captureDepthOfField = this.surfaceDepthOfField;
    // invalidate: false — this arms the offscreen capture job under the
    // centered camera; a capture job never presents (strip-planner's own
    // rule), so nothing centered ever reaches the live canvas and the
    // wrapper's invalidation would re-arm a full settle for a frame that
    // never changed.
    const arm = this.withCenteredProjection(
      () => this.beginSurfaceFullFrame(width, height, false),
      false,
    );
    // A saved PNG gets the same supersampling the pane it was saved from
    // does, exactly as on the WebGPU arm — the aliasing is scale-invariant,
    // so exporting larger does not fix it and an unsampled export would be
    // visibly worse than the screen it came from. Coverage below spans the
    // passes, and Cancel lands between them.
    this.beginSurfaceSamples(this.surfaceSettleSamples, width, height);
    this.surfaceCaptureFlight = true;
    // Definite by the loop's first iteration; the initializer only tells
    // the compiler the `finally` cannot see it unassigned.
    let outcome!: SurfaceDrainOutcome;
    let job = arm.job;
    // HOWEVER this capture ends — delivered, Cancelled, the
    // viewport-mismatch refusal, or a throw unwinding out of the drain or
    // the readback — the export-scale sample sequence is released on the
    // way out. One outer finally rather than a release on each exit path,
    // so an exit added later (or an exception path nobody enumerated)
    // cannot leak the very buffers this exists to free.
    try {
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
      const exported = await this.withPixelRatio(ratio, () => {
        // The mean of the completed passes, or — for a single-pass
        // export, and for every caller that predates supersampling — the
        // traced target itself, byte for byte as before. The image reads the
        // CANVAS, already blitted synchronously, so nothing needs this
        // capture's sample sequence once this returns.
        if (
          this.surfaceSampleTaken < 2 ||
          !this.presentSurfaceSampleImage(
            null,
            captureBackground,
            captureDepthOfField,
          )
        ) {
          this.blitSurface(
            this.surfaceSettleTarget.texture,
            null,
            this.surfaceSettleTarget.textures[1],
            this.surfaceSettleBackground,
            captureBackground,
            captureDepthOfField,
          );
        }
        return exportImageFrom(this.renderer.domElement);
      });
      if (
        !traceBackgroundsEqual(
          captureBackground,
          this.currentSurfaceBackground(width, height),
        )
      ) {
        this.surfaceCompositePending = true;
      } else if (captureDepthOfField !== this.surfaceDepthOfField) {
        this.surfaceCompositePending = true;
      }
      return exported;
    } finally {
      this.releaseSurfaceSampleSequence();
    }
  }

  /**
   * The pixel dimensions a still export at `exportScale` will produce —
   * what the export progress modal names so the user can see what they
   * asked for. Matches the arithmetic three.js applies when it
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
   * cost, or null when nothing survives to predict from. The
   * export modal uses it for ONE decision — whether to skip the grace
   * period and show at once — and deliberately never displays it: the same
   * number over-predicts by ~4x off preview evidence (see
   * {@link predictSurfaceFullCostMs}), which is exactly the patience-
   * guessing the preview tier already reverted. Coverage and elapsed are
   * measured; a predicted total would not be.
   */
  predictSurfaceCaptureMs(exportScale = 1): number | null {
    const { width, height } = this.exportSize(exportScale);
    return this.predictSurfaceFullCostMs(width * height);
  }

  /**
   * Whether an async capture drain currently owns the surface
   * tracer. It yields to the event loop, so the rAF loop runs DURING a
   * capture — main.ts's surface tick stands aside on this, which is what
   * keeps a preview from clobbering the frozen full-tier uniforms and a
   * settle from re-sizing the target being drained.
   */
  get surfaceCaptureBusy(): boolean {
    return this.surfaceCaptureFlight;
  }

  /** Park either depth-of-field material's focal plane on the cloud centre. */
  private focusDof(fourD: boolean, camera: THREE.Camera = this.camera): void {
    const bounds = this.pointGeometry.boundingSphere;
    const center = bounds ? bounds.center : ZERO;
    const focus = camera.position.distanceTo(center);
    const material = fourD ? this.fourDMaterial : this.dofMaterial;
    material.uniforms.uFocus.value = focus;
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
const SURFACE_CAMERA_FORWARD = new THREE.Vector3(0, 0, -1);
const NO_SHEAR: Vec3 = [0, 0, 0];
/** Scratch for `applyFogColor`'s tint lerp. */
const FOG_TINT_COLOR = new THREE.Color();
/** Scratch for `renderSurface`'s per-call drawing-buffer query. */
const DRAW_SIZE = new THREE.Vector2();
/** Predicted in-flight GPU work (ms) the pipelined strip pump keeps
 * queued: deep enough to saturate the GPU between rAF polls,
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
/** Gamma the surface tracers encode their output with — the
 * `pow(lit, 1/2.2)` that ends surface-material.ts's shade path and its 4D
 * twin. The supersampling average has to undo it before summing and
 * reapply it after, or antialiased edges come out too dark
 * (surface-compute.ts states the same constant for the WebGPU arm's
 * accumulator; if a third consumer ever appears, hoist it). */
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
/** Predicted cost (ms) at which a fence group closes. MEASURED by A/B:
 * every sync point — fence observation or forced-completion
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
 * Iris/ANGLE/Chromium regardless of the work behind it (measured A/B).
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
 * (the perf-review regression that made the pump pipelined). */
const SURFACE_STRIP_SYNC_ESCAPE_MS = 25;
// STRIP_WORST_EVIDENCE_SAFETY moved to strip-evidence.ts with the chain;
// predictSurfaceFullCostMs still applies it below.
/** Measured GPU time (ms) each preview strip aims for — well
 * under the settle tier's 75 so strips interleave with a live drag: a
 * preview frame's budget below fits two of these plus the probe. */
const SURFACE_PREVIEW_STRIP_TARGET_MS = 12;
/** Queue-price ceiling (ms) on the pipelined pump's in-flight work —
 * the safety half of the no-automatic-give-up verdict. The est-priced {@link
 * SURFACE_STRIP_QUEUE_MS} keeps the GPU fed, but the estimate is one fence
 * batch behind reality and fold+grid frames are 100-1000x bimodal: at a
 * cost-band entry the queue held `QUEUE_MS / est` pixels of REAL monster work
 * (measured 16-22s groups in the stale-evidence incident; ~3s main-thread
 * stalls once per crease pixel; ~46s pings at parked monster poses) and every
 * main-thread touch of the GL stream — draw submission backpressure, the seed
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
 * REFUSES up front (sync callers only — the interactive capture discloses and
 * lets the user stop it instead of predicting for them). Prediction uses
 * measured evidence only — a completed settle's whole-frame cost, else the
 * completed preview's scaled by the tier gap; never the fold-class prior,
 * which is probe-sizing pessimism ~100x past typical fold pixels and would
 * refuse every fold export sight unseen. Generous by design: prediction
 * honesty is ~4x at worst (a floor-rung preview measured overpredicting the
 * real grind 4x), so this only catches the minutes-to-HOURS class that the
 * spend ceiling below would otherwise burn a real minute of frozen tab
 * discovering. */
export const SURFACE_CAPTURE_PREDICT_CEILING_MS = 120_000;
/** Measured-spend ceiling (ms) at which an in-progress full-tier sync
 * drain gives up — the backstop for poses with no (or
 * pose-stale) evidence: an offline export's fresh keyframe pose runs
 * un-predicted, and a monster pose there used to freeze the tab for
 * the frame's bounded-submission-but-hours-long duration. A minute of
 * genuine grind is the tolerated worst case — long enough for every
 * legitimately expensive export measured to date, short enough that a
 * user (or the browser's hang detector) still owns the tab. The yielding
 * capture drain has no equivalent: nothing about it is frozen,
 * so the tab is the user's throughout and Cancel is the backstop. */
const SURFACE_CAPTURE_SPEND_CEILING_MS = 60_000;
/** Pacing floor (ms) for the yielding capture drain's hand-back when the
 * page is HIDDEN — see {@link nextDrainTick}. A visible page
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
/** Timer backstop (ms) behind the visible page's rAF pacing: a
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

/** How a capture drain ended. "ceiling" is the measured-spend
 * backstop — a refusal the caller reports; "cancelled" is the user's own
 * choice, which is not an error at all. */
type SurfaceDrainOutcome = "done" | "ceiling" | "cancelled";

/** A full-tier frame's arming state: the strip job, plus the measured
 * evidence the arming itself discarded. */
interface SurfaceFullFrameArm {
  job: SurfaceStripJob;
  /** {@link FractalScene.surfaceFullPxCostMs} as it stood before
   * `abandonSurfaceSettle` cleared it. Restored when the frame does not
   * complete — see {@link FractalScene.finishSurfaceFullFrame}. */
  priorPxCostMs: number | null;
}

/** Traced-and-measured coverage of `job` in [0, 1]: planned pixels less the
 * ones still riding this job's OWN fences (an adopted backlog's pixels were
 * never in `plannedPx`, so subtracting them too would report
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
 * One tick of the yielding capture drain: hand the main thread
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
 * — the tab-freeze guard for the callers that really do freeze the tab:
 * offline export, which fails the run with it, and thumbnails, which fall
 * back to the explorer render. The message is user-presentable. The
 * interactive Save-PNG raises it no longer. */
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
   * pipelined pump thereafter. It PRICES the pump's queue and its own
   * regime marker, and it no longer sizes anything — the
   * planner's two-term {@link StripPlanner.cost} does, off the same
   * batch measurements reported through `observe` at their real widths,
   * and the pump's queue prices off its marginal. A prior-seeded value
   * therefore never reaches the planner as a measurement at all, which is
   * what the job's old `measured` flag existed to guarantee (caught live
   * once: worstSeen exactly 10.000 = STRIP_FOLD_PRIOR_MS_PER_PX). */
  msPerPxEstimate: number | null;
  /** Frozen-at-arm per-pixel price (ms) for the pump's in-flight queue
   * bound (see surfaceStripQueueWorstMsPerPx) — the pump maxes
   * it live with the planner's own ratcheted observations. */
  queueWorstMsPerPx: number;
  /** Accumulated GPU-busy wall time (ms) — the preview governor's sample,
   * the px-cost numerator, and the capture drains' spend ceiling. "Busy" is
   * measured as WALL WITH THE QUEUE OUTSTANDING, not as GPU time: a batch
   * is charged from the moment its group was fenced to the moment a poll
   * observed it complete, so a queue that empties between polls bills the
   * idle remainder too (up to one caller tick). At saturation — the regime
   * the pacing aims for and the one where the numbers are used — the two
   * agree; a queue pinned small by the worst-price bound over a
   * cheap band is where they diverge, and the drift is one-directional
   * (reads high, refuses early, never over-spends). */
  spentMs: number;
  /** Fenced strips submitted but not yet observed complete, in
   * submission order. `inherited` entries are a superseded predecessor's
   * fences adopted at arm — same GL queue, so they complete
   * ahead of everything this job submits; the pump prices the queue over
   * them but excludes their busy share from `spentMs` (they traced
   * another pose's pixels). */
  inFlight: { sync: WebGLSync; px: number; inherited: boolean }[];
  /** Sum of `inFlight` pixels — inherited backlog included, because the
   * refill ceiling must see the REAL GL queue. */
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

/** `?surfperf`: diagnostics-only opt-in, the surface twin of
 * main.ts's `?flameperf`. When present, every completed surface strip job
 * logs its accumulated MEASURED GPU cost (`spentMs` — per-strip
 * forced-completion/fence timings, the planner's own bookkeeping), which
 * lets external sweeps (the fold beam-width spill probe) read
 * settled-frame trace cost from the console without new plumbing. */
const SURFPERF =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("surfperf");
/** `?surfperf` also logs any single strip whose MEASURED cost exceeded
 * this (ms) — the field signal for the GPU-watchdog class: a healthy
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
 * `captureThumbnail` mode. The underlay + `composite` op are what
 * make the flame canvas match its on-screen appearance (`"screen"`, the same
 * blend `renderFlame` draws — see `captureFlameFrame`); for the
 * already-opaque WebGL canvas the underlay is fully covered and the default
 * `"source-over"` changes nothing. Returns `""` when a 2D context is
 * unavailable.
 *
 * `shape`'s scale is derived from THIS OUTPUT canvas's own `w`/`h`
 * — the downscale keeps `src`'s aspect ratio (both axes scale by the same
 * factor), so the vignette painted here stays circular in the thumbnail's
 * own pixels, matching what a full-resolution capture of the same frame
 * would show.
 */
function thumbnailFrom(
  src: HTMLCanvasElement,
  maxDim: number,
  backdrop: BackgroundGradient,
  shape: BackgroundShape,
  composite: GlobalCompositeOperation = "source-over",
  backdropImage: HTMLCanvasElement | null = null,
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
  if (backdropImage) {
    ctx.drawImage(backdropImage, 0, 0, w, h);
  } else {
    paintBackdropGradient(
      ctx,
      w,
      h,
      backdrop,
      shape === "radial"
        ? {
            kind: "radial",
            center: DEFAULT_BACKGROUND_SHAPE_CENTER,
            scale: backgroundRadialScale(w, h),
          }
        : { kind: "linear" },
    );
  }
  ctx.globalCompositeOperation = composite;
  ctx.drawImage(src, 0, 0, w, h);
  return out.toDataURL("image/jpeg", 0.72);
}

/**
 * Encode a canvas as a PNG {@link ExportImage}. `toBlob` snapshots
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
