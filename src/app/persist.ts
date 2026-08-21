/**
 * Scene persistence — URL hash + localStorage.
 *
 * `encodeScene` / `decodeScene` handle a compact `v1=<base64url>` wire format;
 * `loadScene` / `saveScene` bridge that format to the browser's address bar and
 * localStorage so the current scene is always share-ready.
 *
 * All browser globals are accessed through injectable `PersistDeps` so the
 * module stays fully testable without a real DOM.
 */
import { isFlatTransform } from "../fractal/affine4";
import {
  SURFACE_PATTERN_AXES,
  SURFACE_PATTERN_KINDS,
} from "../fractal/surface-pattern";
import type { PositionAxisColors } from "../fractal/color";
import {
  CUSTOM_PALETTE_ID,
  FLAME_PALETTE_IDS,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  hexToRgb,
  rgbToHex,
} from "../fractal/palette";
import type {
  CustomPalette,
  PaletteSelection,
  RgbStop,
} from "../fractal/palette";
import {
  COLOR_MODES,
  FOUR_D_COLOR_MODES,
  SYMMETRY_PLANES,
  VARIATION_TYPES,
} from "../fractal/types";
import type {
  ColorMode,
  FourDColorMode,
  SurfaceFinish,
  SurfacePattern,
  SymmetryParams,
  SymmetryPlane,
  Transform,
  Variation,
  VariationType,
  Vec3,
  WExtension,
} from "../fractal/types";
import {
  DEFAULT_BALLOON_RADIUS,
  DEFAULT_BALLOON_TINT,
  DEFAULT_BALLOON_TINT_STRENGTH,
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_TINT,
  DEFAULT_FOG_TINT_STRENGTH,
  DEFAULT_FOUR_D_COLOR,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SYMMETRY_PLANE,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_W_ANGLE,
  MIN_W_POSITION,
  MIN_W_SCALE,
  MIN_W_SHEAR,
  PARAM,
  RENDER_STYLES,
  SURFACE_COLOR_SOURCES,
  SURFACE_FLOOR_PATTERNS,
  clampToSpec,
} from "./state";
import type {
  AppState,
  FlameParams,
  RenderStyle,
  SolidParams,
  SurfaceColorSource,
  SurfaceFloorPattern,
  SurfaceParams,
} from "./state";
import { clampPhi, clampRadius, type CameraPose } from "./orbit";
import { BACKGROUND_MODES } from "./background";
import type {
  BackgroundGradient,
  BackgroundMode,
  BackgroundParams,
  BackgroundShape,
} from "./background";
import {
  BACKGROUND_SHAPES,
  DEFAULT_BACKGROUND_SHAPE,
} from "../fractal/background-shape";
import type { FourDPose } from "./four-d-view";
import { normalizeRotorPair } from "./rotor4";
import { DEFAULT_COLOR_SPEED, MAX_TRANSFORMS } from "../fractal/chaos-game";
import { clamp } from "../fractal/vec";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The persistent subset of AppState — everything needed to recreate the scene. */
export interface SceneSnapshot {
  transforms: Transform[];
  /** Optional final-transform lens (see {@link AppState.finalTransform}). */
  finalTransform?: Transform;
  numPoints: number;
  pointSize: number;
  colorMode: ColorMode;
  /**
   * Color-contrast exponent (see {@link AppState.colorGamma}).
   * Persists like `colorMode`/`renderStyle`/`glowBrightness` — always
   * present, not session-only.
   */
  colorGamma: number;
  /**
   * Ramp palette for the height/radius color modes (see
   * {@link AppState.rampPaletteId}). Persists like `colorMode`/`colorGamma`
   * — always present in the snapshot; the decoder's quiet fallback for
   * absent/unknown values is `"legacy"` (see decodeScene).
   */
  rampPaletteId: PaletteSelection;
  /**
   * 4D projection color mode (see {@link AppState.fourDColor}).
   * Persists like `colorMode` — always present, not session-only (unlike the
   * tumble/slice view state, which never persists).
   */
  fourDColor: FourDColorMode;
  /**
   * 4D camera-depth fade toggle (see {@link AppState.fourDDepthFade}).
   * Persists like `fourDColor` — always present, not session-only (unlike the
   * tumble/slice view state, which never persists).
   */
  fourDDepthFade: boolean;
  renderStyle: RenderStyle;
  showGuides: boolean;
  /**
   * Flame render-current-view settings (see {@link AppState.flame}). Note
   * `AppState.renderMode` is intentionally NOT part of this snapshot — the
   * app always boots into the point-cloud explorer, never straight into a
   * flame/solid render.
   */
  flame: FlameParams;
  /** Solid render settings (see {@link AppState.solid}); like `flame`, the
   * session-only `renderMode` is intentionally NOT part of this snapshot. */
  solid: SolidParams;
  /** Surface render settings (see {@link AppState.surface}); like `flame`/
   * `solid`, the session-only `renderMode` is intentionally NOT part of this
   * snapshot. */
  surface: SurfaceParams;
  /**
   * Rotational/mirror symmetry (see {@link AppState.symmetry}).
   * Persists like `colorMode`/`renderStyle` — always present, unlike the
   * optional `finalTransform`.
   */
  symmetry: SymmetryParams;
  /**
   * Manual glow-brightness override (see {@link AppState.glowBrightness}).
   * Persists like `colorMode`/`renderStyle`/`symmetry` — always present, not
   * session-only.
   */
  glowBrightness: number;
  /**
   * The scene backdrop (see {@link AppState.background}). Always
   * present in the snapshot like `symmetry`, but the WIRE form omits the
   * pristine default (`{ mode: "dark" }`, nothing authored) so never-touched
   * scenes keep their short URLs — except under the aerial render style,
   * where it is always written: an ABSENT field is what a document
   * predating the persisted backdrop looks like, and the decoder reads that
   * as the LEGACY coupling (aerial forced the haze backdrop), so an aerial
   * scene that genuinely means "dark" must say so explicitly to round-trip.
   * See {@link decodeBackground}.
   */
  background: BackgroundParams;
  /**
   * The one user-authored gradient slot (see
   * {@link AppState.customPalette}). Optional like `finalTransform` — absent
   * until a palette selection first lands on Custom — unlike the always-
   * present settings blocks above (`flame`/`solid`/`symmetry`/
   * `glowBrightness`).
   */
  customPalette?: CustomPalette;
  /**
   * The position mode's custom axis colors (see
   * {@link AppState.positionAxisColors}). Optional like `customPalette` —
   * absent = the legacy XYZ→RGB mapping — and like it never worth rejecting
   * a scene over; see {@link decodePositionAxisColors}.
   */
  positionAxisColors?: PositionAxisColors;
  /**
   * Optional orbit-camera pose: the view a saved/shared/collection
   * scene was framed with (see {@link CameraPose}). Optional like
   * `customPalette` — and DELIBERATELY absent from the ENCODED undo-history
   * snapshot STRING: `history.ts` dedupes checkpoints by comparing
   * `encodeScene` output with `===`, and even tiny camera drift between two
   * otherwise-identical states would defeat that dedup. `main.ts` (not this
   * module) attaches `camera` only when writing a persisted / shared /
   * collection document, never to an in-session undo checkpoint. (Undo/redo
   * across a whole-system replace DOES restore the pre-replace framing,
   * but carries that pose OUT OF BAND on `history.ts`'s
   * `HistoryEntry.pose`, never in this encoded string, precisely so the
   * dedup keeps comparing camera-less bytes.)
   */
  camera?: CameraPose;
  /**
   * Optional 4D view pose: the tumble rotor + soft w-slice window
   * a saved/shared/collection scene was framed with (see {@link FourDPose})
   * — the 4D sibling of `camera` just above. Optional like `camera` — and
   * DELIBERATELY absent from the ENCODED undo-history snapshot STRING for
   * the same reason, only more so: `history.ts` dedupes checkpoints by
   * comparing `encodeScene` output with `===`, and the live rotor drifts
   * every tumble frame, which would defeat that dedup even harder than
   * camera drift would. `main.ts` (not this module) attaches `fourD` only
   * when writing a persisted / shared / collection document, and only while
   * the system is non-flat — never to an in-session undo checkpoint. (Like
   * `camera`, undo/redo across a whole-system replace DOES restore the
   * pre-replace rotor/slice, via the same out-of-band
   * `HistoryEntry.pose` channel, never these encoded bytes.) Tumble
   * on/off + speed are deliberately NOT part of the pose — a viewer
   * PREFERENCE, never document state; see `FourDPose`'s own doc
   * comment.
   */
  fourD?: FourDPose;
  /**
   * Whether the balloon echo/surface-balloon toggle is on (see
   * `state.ts`'s `AppState.balloonEcho`): scene content, by the balloon's
   * own "mode persists" rule, unlike `camera`/`fourD` above (which have
   * no `AppState` counterpart at all — this field DOES, and `fromSnapshot`
   * merges it in with a real default rather than just excluding it).
   * Optional for the same reason `camera` is optional rather than always
   * present like `background`: `toSnapshot` always WRITES a defined
   * boolean (there is no "pristine" value worth omitting — see
   * `encodeScene`), but a document decoded from a link predating the
   * balloon pair, or from hand-crafted/malformed input, quietly comes back
   * with this field absent (see `decodeScene`) — the CameraPose/FourDPose
   * "malformed drops the field, never the scene" precedent, applied to a
   * field with a real fallback instead of no counterpart at all.
   */
  balloonEcho?: boolean;
  /**
   * The balloon's normalized radius (see
   * `state.ts`'s `AppState.balloonRadius`) — persisted alongside
   * `balloonEcho` exactly the same way, right down to the optionality
   * rationale. Decoded values are clamped through `PARAM.balloonRadius`,
   * like every other PARAM-backed numeric field; absent or malformed
   * quietly decodes to `undefined`, and `fromSnapshot` supplies
   * `DEFAULT_BALLOON_RADIUS` for whichever comes back that way.
   */
  balloonRadius?: number;
  /**
   * The balloon shell's tint color (see `state.ts`'s
   * {@link AppState.balloonTint}) — persisted alongside `balloonRadius` the
   * identical way: optional here even though `toSnapshot`/`encodeScene`
   * always WRITE a defined value once `AppState` carries one. Decoded
   * values must match the `#rrggbb` hex pattern (reusing {@link hexToRgb}
   * as the validator, like `fogTint`'s own field just below); absent or
   * malformed decodes to `undefined`, and `fromSnapshot` supplies
   * {@link DEFAULT_BALLOON_TINT} for whichever comes back that way — so a
   * link predating the tint pair decodes with the field absent and still
   * boots with the shell untinted.
   */
  balloonTint?: string;
  /**
   * The balloon tint's blend strength (see `state.ts`'s
   * {@link AppState.balloonTintStrength}) — persisted alongside
   * `balloonTint`, clamping through {@link PARAM}.balloonTintStrength
   * exactly like `fogTintStrength` clamps through `PARAM.fogTintStrength`.
   * Absent or malformed decodes to `undefined`; `fromSnapshot` supplies
   * {@link DEFAULT_BALLOON_TINT_STRENGTH} — `0`, the untinted identity — so
   * the absent pair of a link predating them reproduces today's balloon
   * rendering exactly.
   */
  balloonTintStrength?: number;
  /**
   * Depth-fog density multiplier (see `state.ts`'s
   * {@link AppState.fogDensity}) — persisted alongside `balloonRadius`
   * exactly the same way: optional here (so a hand-built `SceneSnapshot`,
   * or one predating the fog controls, need not supply it) even though
   * `toSnapshot`/`encodeScene` always WRITE a defined value once `AppState`
   * carries one — there is no legacy meaning tied to this field's absence,
   * so the `balloonRadius` "always written, `??` only for hand-built input"
   * shape applies rather than `background`'s omit-while-pristine dance.
   * Decoded values clamp through {@link PARAM}.fogDensity, like every other
   * PARAM-backed numeric field; absent or malformed decodes to `undefined`,
   * and `fromSnapshot` supplies {@link DEFAULT_FOG_DENSITY} for whichever
   * comes back that way — so a link predating the fog controls decodes
   * with the field absent and still boots at density 1, reproducing the
   * fixed fog exactly.
   */
  fogDensity?: number;
  /**
   * Fog tint color (see `state.ts`'s {@link AppState.fogTint}) —
   * persisted alongside `fogDensity` the identical way: optional here even
   * though `toSnapshot`/`encodeScene` always WRITE a defined value once
   * `AppState` carries one. Decoded values must match the `#rrggbb` hex
   * pattern (reusing {@link hexToRgb} as the validator, like `background`'s
   * custom stops); absent or malformed decodes to `undefined`, and
   * `fromSnapshot` supplies {@link DEFAULT_FOG_TINT} for whichever comes
   * back that way — so a link predating the fog controls decodes with the
   * field absent and still boots at the untinted white default.
   */
  fogTint?: string;
  /**
   * Fog tint blend strength (see `state.ts`'s
   * {@link AppState.fogTintStrength}) — persisted alongside `fogTint`,
   * clamping through {@link PARAM}.fogTintStrength exactly like
   * `fogDensity` clamps through `PARAM.fogDensity`. Absent or malformed
   * decodes to `undefined`; `fromSnapshot` supplies
   * {@link DEFAULT_FOG_TINT_STRENGTH} — `0`, the untinted identity — so
   * the absent pair of a link predating them reproduces today's fog exactly.
   */
  fogTintStrength?: number;
  /**
   * Whether the surface ground plane is on (see `state.ts`'s
   * {@link AppState.groundPlane}): scene content, the same treatment as
   * `balloonEcho` above — optional here (so a hand-built `SceneSnapshot`,
   * or one predating the ground plane, need not supply it) even though
   * `toSnapshot`/`encodeScene` always WRITE a defined value once `AppState`
   * carries one; `fromSnapshot` merges it in with a real default (`false`)
   * rather than just excluding it. A malformed value (anything but a real
   * boolean) decodes to `undefined` rather than rejecting the scene,
   * `balloonEcho`'s own no-coercion stance.
   */
  groundPlane?: boolean;
}

/** Injectable browser dependencies; each defaults to its real-global counterpart. */
export interface PersistDeps {
  location?: { hash: string };
  storage?: Pick<Storage, "getItem" | "setItem">;
  history?: Pick<History, "replaceState">;
}

// ---------------------------------------------------------------------------
// AppState <-> SceneSnapshot projection
// ---------------------------------------------------------------------------

/**
 * Project the persistent subset out of full app state. This is the ONE place
 * that lists the persisted fields; both restore (`fromSnapshot`) and save go
 * through here, so a forgotten field can't silently drop out of storage with
 * no compiler complaint.
 */
export function toSnapshot(state: AppState): SceneSnapshot {
  return {
    transforms: state.transforms,
    finalTransform: state.finalTransform,
    numPoints: state.numPoints,
    pointSize: state.pointSize,
    colorMode: state.colorMode,
    colorGamma: state.colorGamma,
    rampPaletteId: state.rampPaletteId,
    fourDColor: state.fourDColor,
    fourDDepthFade: state.fourDDepthFade,
    renderStyle: state.renderStyle,
    showGuides: state.showGuides,
    flame: state.flame,
    solid: state.solid,
    surface: state.surface,
    symmetry: state.symmetry,
    glowBrightness: state.glowBrightness,
    background: state.background,
    customPalette: state.customPalette,
    positionAxisColors: state.positionAxisColors,
    // Always written: AppState's own fields are always defined
    // — false/DEFAULT_BALLOON_RADIUS is a perfectly ordinary pair to carry
    // — matching how `background`'s own `state.background` copy above is
    // unconditional here too. Unlike `background`, encodeScene below does
    // NOT then omit a pristine default from the wire payload: there is no
    // legacy document whose meaning depends on this field's absence, so
    // the simpler "always written" rule (`colorGamma`/`glowBrightness`)
    // applies instead of `background`'s omit-while-pristine dance.
    balloonEcho: state.balloonEcho,
    balloonRadius: state.balloonRadius,
    // Always written, the identical balloonRadius shape just
    // above: AppState.balloonTint/balloonTintStrength are always defined,
    // and there is no legacy document whose meaning depends on either
    // field's absence.
    balloonTint: state.balloonTint,
    balloonTintStrength: state.balloonTintStrength,
    // Always written, the identical balloonRadius shape just
    // above: AppState.fogDensity is always defined, and there is no legacy
    // document whose meaning depends on this field's absence.
    fogDensity: state.fogDensity,
    // Always written, the identical fogDensity shape just above:
    // AppState.fogTint/fogTintStrength are always defined, and there is no
    // legacy document whose meaning depends on either field's absence.
    fogTint: state.fogTint,
    fogTintStrength: state.fogTintStrength,
    // Always written, the identical fogTintStrength shape just
    // above: AppState.groundPlane is always defined, and there is no
    // legacy document whose meaning depends on this field's absence.
    groundPlane: state.groundPlane,
  };
}

/**
 * Merge a restored snapshot over a base AppState (typically `initialState`),
 * overwriting exactly the persisted fields while leaving session-only state
 * (selection, autoUpdate, panel) from `base` intact. `camera` and `fourD`
 * are document-only fields with no `AppState` counterpart (they're
 * applied instead by `main.ts`'s boot/load call sites), so both are
 * explicitly destructured out and never spread. The rest stays the exact
 * inverse of `toSnapshot`, with nothing else to hand-sync.
 * `positionAxisColors` is read explicitly off `snapshot` rather than
 * relying on the `rest` spread, so its absence always clears `base`'s value
 * even when the incoming snapshot object never declares the key at all —
 * unlike `customPalette`, which only clears because `toSnapshot`/
 * `decodeScene` happen to always emit that key.
 *
 * `balloonEcho`/`balloonRadius` are read explicitly off
 * `snapshot` for the same reason, one step further than
 * `positionAxisColors`: both HAVE a real `AppState` default
 * (`false`/`DEFAULT_BALLOON_RADIUS`) to fall back to rather than merely
 * clearing to `undefined`, so a `??` supplies it whenever the decoded (or
 * hand-built) snapshot came back without one. `balloonTint`/
 * `balloonTintStrength` follow the identical shape, falling back
 * to {@link DEFAULT_BALLOON_TINT} / {@link DEFAULT_BALLOON_TINT_STRENGTH} —
 * as does `fogDensity`, falling back to
 * {@link DEFAULT_FOG_DENSITY} — as do `fogTint`/`fogTintStrength`, falling
 * back to {@link DEFAULT_FOG_TINT} / {@link DEFAULT_FOG_TINT_STRENGTH} —
 * and `groundPlane`, falling back to `false`.
 */
export function fromSnapshot(
  snapshot: SceneSnapshot,
  base: AppState,
): AppState {
  const { camera: _camera, fourD: _fourD, ...rest } = snapshot;
  return {
    ...base,
    ...rest,
    positionAxisColors: snapshot.positionAxisColors,
    balloonEcho: snapshot.balloonEcho ?? false,
    balloonRadius: snapshot.balloonRadius ?? DEFAULT_BALLOON_RADIUS,
    balloonTint: snapshot.balloonTint ?? DEFAULT_BALLOON_TINT,
    balloonTintStrength:
      snapshot.balloonTintStrength ?? DEFAULT_BALLOON_TINT_STRENGTH,
    fogDensity: snapshot.fogDensity ?? DEFAULT_FOG_DENSITY,
    fogTint: snapshot.fogTint ?? DEFAULT_FOG_TINT,
    fogTintStrength: snapshot.fogTintStrength ?? DEFAULT_FOG_TINT_STRENGTH,
    groundPlane: snapshot.groundPlane ?? false,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "fractal-viewer:scene";

// Built FROM the const-array unions so the runtime guard can never drift from
// the type: adding a value to COLOR_MODES / RENDER_STYLES grows these sets too,
// while a removed value stops compiling everywhere it is referenced. The sets
// still match exactly — unknown values are rejected just as before.

/** Exact set of valid ColorMode values for strict validation of untrusted input. */
const VALID_COLOR_MODES = new Set<string>(COLOR_MODES);

/** Exact set of valid FourDColorMode values. */
const VALID_FOUR_D_COLOR_MODES = new Set<string>(FOUR_D_COLOR_MODES);

/** Exact set of valid RenderStyle values. */
const VALID_RENDER_STYLES = new Set<string>(RENDER_STYLES);

/** Exact set of valid VariationType values. */
const VALID_VARIATION_TYPES = new Set<string>(VARIATION_TYPES);

/**
 * Exact set of valid BUILT-IN palette ids (see `palette.ts`'s
 * `FLAME_PALETTES`), shared by the flame (`flame.paletteId`) and solid
 * (`solid.paletteId`) validators. Deliberately excludes
 * {@link CUSTOM_PALETTE_ID}: `"custom"` is only ever valid alongside
 * an actually-decoded `customPalette` payload, a condition this fixed set
 * can't express — `decodeFlameParams`/`decodeSolidParams` check for that
 * separately via their `hasCustomPalette` parameter.
 */
const VALID_PALETTE_IDS = new Set<string>(FLAME_PALETTE_IDS);

/** Exact set of valid SymmetryPlane values. */
const VALID_SYMMETRY_PLANES = new Set<string>(SYMMETRY_PLANES);

/**
 * The legacy `symmetry.axis` vocabulary, as the plane each axis named
 * from the other side (a simple rotation ABOUT an axis is a rotation IN the
 * orthogonal plane). Every mapping is the SAME matrix, same sign — see
 * `chaos-game.ts`'s `symmetryRotation` — so a legacy document decoded through
 * this table renders bit-identically to what it always rendered.
 */
const LEGACY_AXIS_PLANE: Readonly<Record<string, SymmetryPlane>> = {
  x: "yz",
  y: "xz",
  z: "xy",
};

/** Exact set of valid SurfaceColorSource values. */
const VALID_SURFACE_COLOR_SOURCES = new Set<string>(SURFACE_COLOR_SOURCES);

/**
 * Exact set of valid BackgroundMode values. Unlike
 * {@link VALID_PALETTE_IDS}, `"custom"` IS a member — the "only alongside a
 * payload" condition is checked separately in {@link decodeBackground},
 * where the payload lives inside the same block rather than in a sibling
 * field.
 */
const VALID_BACKGROUND_MODES = new Set<string>(BACKGROUND_MODES);

/** Exact set of valid BackgroundShape values, the same
 * quiet-fallback discipline as {@link VALID_BACKGROUND_MODES}. */
const VALID_BACKGROUND_SHAPES = new Set<string>(BACKGROUND_SHAPES);

/**
 * Cap on variations per transform when decoding untrusted input: one lane per
 * distinct warp. Every producer treats a variation list as a type -> weight map
 * (see `types.ts`'s {@link Variation}), so a longer list is either redundant or
 * hand-crafted — and it has to be exactly this tight rather than generous
 * headroom: `flame-gpu.ts`'s Slot carries `MAX_SLOT_VARIATIONS`
 * variation lanes, itself `VARIATION_TYPES.length`, and its packer throws past
 * that, so a longer blend would decode fine, render fine on every CPU path,
 * and then knock a flame session off the GPU onto its permanent CPU fallback.
 */
const MAX_VARIATIONS = VARIATION_TYPES.length;

/** Reject wildly out-of-range blend weights from hand-crafted input; clamp the rest. */
const MAX_VARIATION_WEIGHT = 100;

/**
 * Sanity bound on each component of an untrusted `camera.target`:
 * real attractor targets sit within a few units of the origin, and
 * `orbit.ts`'s own {@link MAX_RADIUS} (the orbit-distance ceiling) is only
 * 100 — so 1000 is generous headroom while still rejecting a wildly
 * hand-crafted value. See {@link decodeCameraPose}.
 */
const CAMERA_TARGET_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Codec helpers
// ---------------------------------------------------------------------------

/** Round to 4 decimal places to keep encoded URLs compact. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toBase64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(s: string): string {
  // Restore the stripped `=` padding before handing to atob.
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

/** Narrow `v` to Vec3: exactly 3 finite numbers. */
function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every(
      (n: unknown): n is number => typeof n === "number" && Number.isFinite(n),
    )
  );
}

/**
 * Decode one optional fold-length leaf on an untrusted variation entry —
 * `minRadius`, `fixedRadius`, or `boxLimit` (see `types.ts`'s
 * {@link Variation}). QUIET fallback like {@link decodeTransform}'s
 * `colorIndex`/`colorSpeed`: a malformed value never rejects the whole
 * scene, it just leaves the field absent, exactly as if it had never been
 * supplied. Unlike every other optional-number decoder in this file, this
 * performs NO `Number(x)` coercion: only a genuine, finite `number` survives
 * — a numeric string, a boolean, `null`, `NaN`/`Infinity`, or an object all
 * drop to `undefined` rather than being coerced into one. There is also no
 * clamp — unlike `colorIndex`'s `[0, 1]` range, this field's domain belongs
 * entirely to `variations.ts`'s `resolveFoldRadii`; persist's job here is
 * fidelity, not validation, so an out-of-domain but genuinely finite value
 * (e.g. a negative `fixedRadius`) survives the decode untouched and is
 * resolved at read time exactly as an authored one would be.
 */
function decodeFoldRadius(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Validate one transform's untrusted `variations` field: an array (capped at
 * {@link MAX_VARIATIONS}) of `{ type, weight }` with a known {@link VariationType}
 * and a finite weight (clamped to ±{@link MAX_VARIATION_WEIGHT}), plus the
 * fold's three optional lengths (`minRadius`/`fixedRadius`/
 * `boxLimit`), each decoded independently via {@link decodeFoldRadius} and
 * never gated on `type`, matching how `weight` itself isn't type-checked
 * here either. Returns the parsed list, or `null` when the `type`/`weight`
 * pair is malformed so the caller rejects the whole scene — matching how
 * every other field guards untrusted input; a malformed fold length alone
 * never rejects the scene (see {@link decodeFoldRadius}).
 */
function decodeVariations(raw: unknown): Variation[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_VARIATIONS) return null;
  const variations: Variation[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const v = entry as Record<string, unknown>;
    if (typeof v.type !== "string" || !VALID_VARIATION_TYPES.has(v.type))
      return null;
    const weight = Number(v.weight);
    if (!Number.isFinite(weight)) return null;
    const decoded: Variation = {
      type: v.type as VariationType,
      weight: clamp(weight, -MAX_VARIATION_WEIGHT, MAX_VARIATION_WEIGHT),
    };
    const minRadius = decodeFoldRadius(v.minRadius);
    if (minRadius !== undefined) decoded.minRadius = minRadius;
    const fixedRadius = decodeFoldRadius(v.fixedRadius);
    if (fixedRadius !== undefined) decoded.fixedRadius = fixedRadius;
    const boxLimit = decodeFoldRadius(v.boxLimit);
    if (boxLimit !== undefined) decoded.boxLimit = boxLimit;
    variations.push(decoded);
  }
  return variations;
}

/**
 * Decode one optional finish leaf on an untrusted transform — `specular`,
 * `shininess`, `metalness`, `reflect`, or `transmit` (see `types.ts`'s
 * {@link SurfaceFinish}). QUIET fallback like {@link decodeFoldRadius}: a
 * malformed value never rejects the whole scene, it just leaves the field
 * absent, exactly as if it had never been supplied. Same two deliberate
 * deviations from every other optional-number decoder in this file: NO
 * `Number(x)` coercion (a numeric string or boolean drops rather than
 * becoming a finish value) and NO clamp — this field's domain belongs
 * entirely to `surface-finish.ts`'s `resolveSurfaceFinish`; persist's job
 * here is fidelity, not validation, so an out-of-domain but genuinely
 * finite value (e.g. a negative `specular`) survives the decode untouched
 * and is resolved at read time exactly as an authored one would be.
 */
function decodeFinishField(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Decode one transform's untrusted `finish` field (see `types.ts`'s
 * {@link SurfaceFinish}). QUIET fallback like {@link decodeCustomPalette}:
 * a non-object, an array, or `null` drops the WHOLE field to `undefined`
 * rather than rejecting the scene — a finish is cosmetic shading data,
 * never worth losing an otherwise-valid shared link over, the same spirit
 * {@link decodeTransform} already applies per-field to `colorIndex`/
 * `colorSpeed`. Each of the six fields decodes independently via
 * {@link decodeFinishField}; an entry with nothing that survives
 * (`finish: {}`, or every field malformed) decodes to `undefined`, matching
 * how an all-zero-weight `variations` array decodes to `undefined` above.
 */
function decodeFinish(raw: unknown): SurfaceFinish | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const f = raw as Record<string, unknown>;
  const finish: SurfaceFinish = {};
  const specular = decodeFinishField(f.specular);
  if (specular !== undefined) finish.specular = specular;
  const shininess = decodeFinishField(f.shininess);
  if (shininess !== undefined) finish.shininess = shininess;
  const metalness = decodeFinishField(f.metalness);
  if (metalness !== undefined) finish.metalness = metalness;
  const reflect = decodeFinishField(f.reflect);
  if (reflect !== undefined) finish.reflect = reflect;
  const transmit = decodeFinishField(f.transmit);
  if (transmit !== undefined) finish.transmit = transmit;
  const reflectionTint = decodeFinishField(f.reflectionTint);
  if (reflectionTint !== undefined) finish.reflectionTint = reflectionTint;
  return Object.keys(finish).length > 0 ? finish : undefined;
}

/**
 * Decode cosmetic patterned-albedo state without coercion or clamping.
 * `kind` and `axis` are required stable discriminators; malformed structure
 * quietly drops this block, while malformed optional numeric leaves alone are
 * omitted. Runtime domains belong to `surface-pattern.ts`, not persistence.
 */
function decodeSurfacePattern(raw: unknown): SurfacePattern | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const p = raw as Record<string, unknown>;
  if (
    typeof p.kind !== "string" ||
    !SURFACE_PATTERN_KINDS.includes(
      p.kind as (typeof SURFACE_PATTERN_KINDS)[number],
    ) ||
    typeof p.axis !== "string" ||
    !SURFACE_PATTERN_AXES.includes(
      p.axis as (typeof SURFACE_PATTERN_AXES)[number],
    )
  ) {
    return undefined;
  }
  const pattern: SurfacePattern = {
    kind: p.kind as SurfacePattern["kind"],
    axis: p.axis as SurfacePattern["axis"],
  };
  const scale = decodeFinishField(p.scale);
  if (scale !== undefined) pattern.scale = scale;
  const strength = decodeFinishField(p.strength);
  if (strength !== undefined) pattern.strength = strength;
  return pattern;
}

/**
 * Decode one optional numeric leaf inside an untrusted `w` block — a
 * position, a scale, or a single rotation/shear w-plane angle. All four kinds
 * share the identical "coerce, reject non-finite, clamp into `[min, max]`"
 * contract (just with different bounds), so {@link decodeTransform}'s `w`
 * handling and {@link decodeWPlanes} both funnel through here.
 *
 * `null` is special-cased to reject rather than falling into the generic
 * finite check: `Number(null)` is `0`, a deceptively finite value that would
 * otherwise silently accept a field a hand-crafted payload explicitly set to
 * `null` instead of omitting. Returns the clamped value, or `null` to tell
 * the caller to reject the whole scene — unambiguous, since a successfully
 * decoded value is always a `number`.
 */
function decodeWField(raw: unknown, min: number, max: number): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clamp(n, min, max);
}

/**
 * Decode the one SIGNED `w` leaf: `w.scale`, whose sign is a 4D reflection
 * (the editor expresses it as a magnitude slider plus a Mirror W
 * toggle, the 4D counterpart of the 3D scale channel's own treatment).
 * Same coerce/reject contract as {@link decodeWField}, but the
 * [`MIN_W_SCALE`, `MAX_W_SCALE`] clamp applies to the MAGNITUDE with the
 * sign preserved, so a hand-authored negative w.scale survives decode
 * instead of being crushed up to +MIN_W_SCALE. An explicit 0 still clamps
 * up to +MIN_W_SCALE, exactly as before.
 */
function decodeWScale(raw: unknown): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const magnitude = clamp(Math.abs(n), MIN_W_SCALE, MAX_W_SCALE);
  return n < 0 ? -magnitude : magnitude;
}

/**
 * Decode one optional w-plane sub-object — `w.rotation` or `w.shear`, which
 * share the exact `{ xw?, yw?, zw? }` shape (see {@link WExtension}). Must be
 * a non-null object; each of `xw`/`yw`/`zw` is decoded independently via
 * {@link decodeWField} when present (clamped to `[min, max]`), and absent
 * entries stay absent. Returns `null` to reject the whole scene, or the
 * sparse object of whatever entries validated — possibly empty, which
 * {@link decodeTransform} treats as "omit the sub-object", no different from
 * it never having been present at all.
 */
function decodeWPlanes(
  raw: unknown,
  min: number,
  max: number,
): NonNullable<WExtension["rotation"]> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const planes: NonNullable<WExtension["rotation"]> = {};
  for (const key of ["xw", "yw", "zw"] as const) {
    if (r[key] === undefined) continue;
    const value = decodeWField(r[key], min, max);
    if (value === null) return null;
    planes[key] = value;
  }
  return planes;
}

/**
 * Validate one untrusted transform into a {@link Transform} with the given `id`,
 * or `null` when anything is malformed so the caller rejects the whole scene.
 * Requires three valid Vec3 fields; `weight` / `shear` / `variations` / `w` are
 * optional and validated exactly as they encode (`w`'s own presence/clamp
 * contract is spelled out inline below, in {@link WExtension}'s terms).
 * `colorIndex` / `colorSpeed` / `finish` are optional too, but — unlike
 * every other field here — a malformed value never rejects the whole scene;
 * see their own block below for why (`finish`'s is {@link decodeFinish}).
 * Shared by the transform list (id = array index) and the final transform
 * (id = 0) so neither can drift — including the `w` (4D lens) support this
 * adds.
 */
function decodeTransform(raw: unknown, id: number): Transform | null {
  if (typeof raw !== "object" || raw === null) return null;
  const tf = raw as Record<string, unknown>;
  if (!isVec3(tf.position) || !isVec3(tf.rotation) || !isVec3(tf.scale))
    return null;
  // Safe: isVec3 verified these are valid Vec3 tuples.
  const decoded: Transform = {
    id,
    position: tf.position,
    rotation: tf.rotation,
    scale: tf.scale,
  };
  // weight: optional. Reject non-finite (malformed), clamp to a positive range
  // otherwise; absent stays undefined ⇒ uniform.
  if (tf.weight !== undefined) {
    const w = Number(tf.weight);
    if (!Number.isFinite(w)) return null;
    decoded.weight = clamp(w, 0.0001, 10000);
  }
  // colorIndex / colorSpeed: optional, [0, 1]. Unlike every other
  // field in this function, a malformed value does NOT reject the whole
  // scene — it just leaves the field absent, exactly as if it had never been
  // supplied. Both are narrowly cosmetic (flame structural coloring only,
  // and only under a gradient palette — see their Transform doc comments in
  // types.ts), the same "never worth losing an otherwise-valid shared link
  // over" spirit as colorGamma/glowBrightness/customPalette elsewhere in
  // this file, just applied per-field here instead of per-block. `null` is
  // special-cased like decodeWField's own guard above: `Number(null)` is
  // `0`, a deceptively finite value that would otherwise silently turn an
  // explicit `null` into a real color slot instead of leaving it absent.
  if (tf.colorIndex !== undefined && tf.colorIndex !== null) {
    const ci = Number(tf.colorIndex);
    if (Number.isFinite(ci)) decoded.colorIndex = clamp(ci, 0, 1);
  }
  if (tf.colorSpeed !== undefined && tf.colorSpeed !== null) {
    const cs = Number(tf.colorSpeed);
    if (Number.isFinite(cs)) decoded.colorSpeed = clamp(cs, 0, 1);
  }
  // shear: optional. Present ⇒ must be a valid Vec3; absent stays undefined.
  if (tf.shear !== undefined) {
    if (!isVec3(tf.shear)) return null;
    decoded.shear = tf.shear;
  }
  // variations: optional. Present ⇒ an array (capped) of { type, weight } with a
  // known type and finite weight; weight is clamped, absent stays undefined. Any
  // malformed entry rejects the whole scene.
  if (tf.variations !== undefined) {
    const variations = decodeVariations(tf.variations);
    if (variations === null) return null;
    if (variations.length > 0) decoded.variations = variations;
  }
  // w: optional 4D extension (see WExtension). Absent ⇒ the decoded transform
  // has no `w` key at all — flat, exactly like a pre-4D link (isFlatTransform
  // agrees: an absent block is always flat). Present ⇒ must be a non-null
  // plain object — beware `typeof null === "object"`, the same explicit check
  // this function's own head uses above — else the whole scene rejects.
  //
  // Each field is validated/clamped independently against the shared
  // MIN_W_*/MAX_W_* range (state.ts — the same constants the upcoming
  // single-editor UI will use for its sliders) and ONLY set when it actually
  // arrived: sparseness is preserved faithfully, so a present-but-exactly-0
  // value is kept rather than treated as absent. It is `encodeTransform`'s
  // isFlatTransform-driven canonicalization that collapses an all-zero block
  // back to fully absent on the NEXT encode — not this decode step, which
  // stays a faithful mirror of whatever arrived. If nothing in the block
  // survives validation (`w: {}`, or every sub-object validates to empty),
  // `w` is omitted from the decoded transform entirely, matching how an
  // all-zero-weight `variations` array decodes to undefined above. Unknown
  // extra keys inside `w` are ignored, exactly like this function already
  // ignores unknown keys on the transform itself.
  if (tf.w !== undefined) {
    if (typeof tf.w !== "object" || tf.w === null) return null;
    const rawW = tf.w as Record<string, unknown>;
    // Named `wExt`, not `w` — this function already uses `w` as the local for
    // the coerced `weight` value a few lines up (a different block scope, so
    // it wouldn't collide, but a distinct name keeps the two unmistakable).
    const wExt: WExtension = {};

    if (rawW.position !== undefined) {
      const position = decodeWField(
        rawW.position,
        MIN_W_POSITION,
        MAX_W_POSITION,
      );
      if (position === null) return null;
      wExt.position = position;
    }
    // scale: absent means DERIVED (see WExtension.scale's doc), so this only
    // fires when the field actually arrived — an explicit value (even one
    // that happens to equal what would have been derived) is preserved. This
    // field is signed (a negative scale is a 4D reflection) and clamped by
    // magnitude, not by range — see decodeWScale.
    if (rawW.scale !== undefined) {
      const scale = decodeWScale(rawW.scale);
      if (scale === null) return null;
      wExt.scale = scale;
    }
    if (rawW.rotation !== undefined) {
      const rotation = decodeWPlanes(rawW.rotation, MIN_W_ANGLE, MAX_W_ANGLE);
      if (rotation === null) return null;
      if (Object.keys(rotation).length > 0) wExt.rotation = rotation;
    }
    if (rawW.shear !== undefined) {
      const shear = decodeWPlanes(rawW.shear, MIN_W_SHEAR, MAX_W_SHEAR);
      if (shear === null) return null;
      if (Object.keys(shear).length > 0) wExt.shear = shear;
    }

    if (Object.keys(wExt).length > 0) decoded.w = wExt;
  }
  // finish: optional per-transform surface shading (see SurfaceFinish).
  // QUIET fallback exactly like colorIndex/colorSpeed above — a malformed
  // value never rejects the whole scene, it just leaves the field absent
  // (see decodeFinish).
  if (tf.finish !== undefined) {
    const finish = decodeFinish(tf.finish);
    if (finish !== undefined) decoded.finish = finish;
  }
  if (tf.surfacePattern !== undefined) {
    const pattern = decodeSurfacePattern(tf.surfacePattern);
    if (pattern !== undefined) decoded.surfacePattern = pattern;
  }
  return decoded;
}

/**
 * Validate the untrusted `customPalette` scene field: the one
 * user-authored gradient slot (see `state.ts`'s `AppState.customPalette`).
 * QUIET fallback semantics, like `symmetry`/`glowBrightness` rather than
 * `transforms`'s reject-the-scene rule — a custom gradient is cosmetic, never
 * worth losing an otherwise-valid shared link over. Returns `undefined` for
 * anything malformed (rather than `null`): "absent" and "invalid" collapse to
 * the exact same quiet fallback here, unlike `decodeTransform`, whose `null`
 * distinguishes "reject the scene" from a genuinely absent optional field.
 *
 * Unlike the live gradient editor's reducer (`setCustomPaletteStops` in
 * `state.ts`), which TRIMS an overlong stop list down to
 * {@link MAX_CUSTOM_PALETTE_STOPS} rather than reject it, a hand-crafted stop
 * count outside [{@link MIN_CUSTOM_PALETTE_STOPS}, {@link MAX_CUSTOM_PALETTE_STOPS}]
 * here drops the WHOLE payload — the quiet-fallback contract for a malformed
 * enum-ish field is "drop the field", not "repair it" (see `decodeSymmetry`'s
 * axis or `decodeFlameParams`'s paletteId for the same rule applied to a
 * single value rather than an array).
 *
 * Called BEFORE `decodeFlameParams`/`decodeSolidParams` in `decodeScene`, so
 * its result can tell them whether a `"custom"` paletteId selection actually
 * has a payload to back it.
 */
function decodeCustomPalette(raw: unknown): CustomPalette | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.stops)) return undefined;
  if (
    p.stops.length < MIN_CUSTOM_PALETTE_STOPS ||
    p.stops.length > MAX_CUSTOM_PALETTE_STOPS
  )
    return undefined;

  const stops: RgbStop[] = [];
  for (const entry of p.stops) {
    if (typeof entry !== "string") return undefined;
    const stop = hexToRgb(entry);
    if (stop === null) return undefined;
    stops.push(stop);
  }
  return { stops };
}

/**
 * Validate the untrusted `positionAxisColors` scene field: the
 * position color mode's three axis colors (see `state.ts`'s
 * {@link AppState.positionAxisColors}). QUIET fallback semantics exactly
 * like {@link decodeCustomPalette} — absent, malformed, or any
 * unparseable axis hex collapses the whole field to `undefined` (the
 * legacy XYZ→RGB mapping) rather than rejecting the scene: axis colors
 * are cosmetic, never worth losing an otherwise-valid shared link over.
 */
function decodePositionAxisColors(
  raw: unknown,
): PositionAxisColors | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.x !== "string" ||
    typeof p.y !== "string" ||
    typeof p.z !== "string"
  )
    return undefined;
  const x = hexToRgb(p.x);
  const y = hexToRgb(p.y);
  const z = hexToRgb(p.z);
  if (x === null || y === null || z === null) return undefined;
  return { x, y, z };
}

/**
 * Validate the untrusted `background` scene field: which backdrop
 * the scene renders (see `background.ts`). QUIET fallback semantics
 * throughout, like {@link decodeSymmetry} — a backdrop is cosmetic, never
 * worth losing an otherwise-valid shared link over — and this function is
 * also the LEGACY MIGRATION: every document written before the field existed
 * carries no `background` at all, and those documents rendered the haze
 * backdrop exactly when their render style was `"aerial"` (the style used to
 * force it — see scene.ts before the backdrop was persisted). So the
 * fallback for an absent or malformed block is keyed on `legacyAerial` (the
 * already-validated render style), and an aerial link predating the field
 * keeps rendering the haze it always rendered. The same fallback covers an
 * unrecognized mode, so a link from a future build's curated presets
 * degrades to the legacy resolution rather than costing the scene — exactly
 * how builds predating the auto backdrop degrade the now-valid `"auto"`.
 * `"auto"` itself round-trips as the bare mode: the derived colors are
 * never written, so the backdrop keeps tracking palette edits after a link
 * round-trip.
 *
 * The custom gradient (`top`/`bottom` hex strings, {@link hexToRgb}-strict
 * like {@link decodePositionAxisColors}) decodes independently of the mode
 * and survives alongside a built-in selection — the authored slot outlives
 * being unselected, exactly like `customPalette`. Both stops must parse or
 * the payload drops whole. A `"custom"` mode with no surviving payload
 * can't be honored and takes the legacy fallback, mirroring the `"custom"`
 * paletteId rule in {@link decodeFlameParams}.
 *
 * `shape` decodes independently of `mode`/`custom` too — it is
 * ORTHOGONAL, not a fourth thing that can fail alongside them — and falls
 * back QUIETLY to `DEFAULT_BACKGROUND_SHAPE` ("linear") on anything not in
 * {@link VALID_BACKGROUND_SHAPES}: absent (every document predating the
 * shape field), malformed, or a shape id from a future build. Never written
 * when it resolves to the default (see the encoder), so this fallback is
 * also what keeps a linear-only document decoding to exactly the shape it
 * always had.
 */
function decodeBackground(
  raw: unknown,
  legacyAerial: boolean,
): BackgroundParams {
  const fallback: BackgroundMode = legacyAerial ? "haze" : "dark";
  if (typeof raw !== "object" || raw === null) return { mode: fallback };
  const b = raw as Record<string, unknown>;

  let custom: BackgroundGradient | undefined;
  if (typeof b.top === "string" && typeof b.bottom === "string") {
    const top = hexToRgb(b.top);
    const bottom = hexToRgb(b.bottom);
    if (top !== null && bottom !== null) custom = { top, bottom };
  }

  let mode: BackgroundMode =
    typeof b.mode === "string" && VALID_BACKGROUND_MODES.has(b.mode)
      ? (b.mode as BackgroundMode)
      : fallback;
  if (mode === "custom" && custom === undefined) mode = fallback;

  const shape: BackgroundShape =
    typeof b.shape === "string" && VALID_BACKGROUND_SHAPES.has(b.shape)
      ? (b.shape as BackgroundShape)
      : DEFAULT_BACKGROUND_SHAPE;

  return {
    mode,
    ...(custom === undefined ? {} : { custom }),
    ...(shape === DEFAULT_BACKGROUND_SHAPE ? {} : { shape }),
  };
}

/**
 * Validate the untrusted `flame` render-settings block: like `finalTransform`,
 * an absent block, or an absent field within a present block, decodes
 * quietly to its default rather than rejecting the scene; but once a field
 * IS present, a malformed value rejects the whole scene, matching
 * `weight`/`shear`/`variations`. Finite values are clamped into range rather
 * than rejected, matching `weight`. `supersample` is additionally rounded to
 * an integer, matching `setFlameSupersample`; the estimator radii/curve are
 * NOT (continuous like gamma/vibrancy, matching their own setters).
 *
 * `paletteId` is the one exception to the reject-on-malformed rule:
 * an unknown OR missing id decodes to {@link DEFAULT_FLAME_PALETTE} rather
 * than rejecting the scene, so a link carrying a palette this build doesn't
 * know keeps the rest of its scene instead of being thrown away over one
 * cosmetic field — the enum equivalent of the finite-but-out-of-range clamp
 * the numeric fields already use.
 *
 * `hasCustomPalette` is the caller's answer to "did a valid
 * `customPalette` payload actually decode alongside this block" (see
 * {@link decodeCustomPalette}, called BEFORE this function in `decodeScene`).
 * {@link CUSTOM_PALETTE_ID} is deliberately absent from `VALID_PALETTE_IDS`
 * (see its own doc), so a `"custom"` id is accepted ONLY when
 * `hasCustomPalette` is true; a `"custom"` selection with no stop data to
 * back it can't be honored, so it takes the exact same quiet
 * {@link DEFAULT_FLAME_PALETTE} fallback an unrecognized id takes, rather
 * than rejecting the scene.
 */
function decodeFlameParams(
  raw: unknown,
  hasCustomPalette: boolean,
): FlameParams | null {
  if (raw === undefined) {
    return {
      exposure: PARAM.flameExposure.default,
      iterations: PARAM.flameIterations.default,
      gamma: PARAM.flameGamma.default,
      vibrancy: PARAM.flameVibrancy.default,
      supersample: PARAM.flameSupersample.default,
      estimatorRadius: PARAM.estimatorRadius.default,
      estimatorMinimumRadius: PARAM.estimatorMinimumRadius.default,
      estimatorCurve: PARAM.estimatorCurve.default,
      paletteId: DEFAULT_FLAME_PALETTE,
    };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;

  const exposure = Number(f.exposure);
  const iterations = Number(f.iterations);
  if (!Number.isFinite(exposure) || !Number.isFinite(iterations)) return null;

  // gamma/vibrancy/supersample/estimatorRadius/estimatorMinimumRadius/
  // estimatorCurve: each optional independently, so an absent field defaults
  // quietly while a present-but-malformed one rejects the whole scene, same
  // as exposure just above — the fields share one block but not one
  // presence rule.
  let gamma = PARAM.flameGamma.default;
  if (f.gamma !== undefined) {
    gamma = Number(f.gamma);
    if (!Number.isFinite(gamma)) return null;
  }
  let vibrancy = PARAM.flameVibrancy.default;
  if (f.vibrancy !== undefined) {
    vibrancy = Number(f.vibrancy);
    if (!Number.isFinite(vibrancy)) return null;
  }
  let supersample = PARAM.flameSupersample.default;
  if (f.supersample !== undefined) {
    supersample = Number(f.supersample);
    if (!Number.isFinite(supersample)) return null;
  }
  let estimatorRadius = PARAM.estimatorRadius.default;
  if (f.estimatorRadius !== undefined) {
    estimatorRadius = Number(f.estimatorRadius);
    if (!Number.isFinite(estimatorRadius)) return null;
  }
  let estimatorMinimumRadius = PARAM.estimatorMinimumRadius.default;
  if (f.estimatorMinimumRadius !== undefined) {
    estimatorMinimumRadius = Number(f.estimatorMinimumRadius);
    if (!Number.isFinite(estimatorMinimumRadius)) return null;
  }
  let estimatorCurve = PARAM.estimatorCurve.default;
  if (f.estimatorCurve !== undefined) {
    estimatorCurve = Number(f.estimatorCurve);
    if (!Number.isFinite(estimatorCurve)) return null;
  }
  // paletteId: unknown or missing quietly becomes the default (see the doc
  // above) rather than rejecting the scene. "custom" is accepted
  // only alongside a valid decoded customPalette payload.
  const paletteId: PaletteSelection =
    typeof f.paletteId === "string" &&
    (VALID_PALETTE_IDS.has(f.paletteId) ||
      (f.paletteId === CUSTOM_PALETTE_ID && hasCustomPalette))
      ? (f.paletteId as PaletteSelection)
      : DEFAULT_FLAME_PALETTE;

  return {
    exposure: clampToSpec(PARAM.flameExposure, exposure),
    iterations: clampToSpec(PARAM.flameIterations, iterations),
    gamma: clampToSpec(PARAM.flameGamma, gamma),
    vibrancy: clampToSpec(PARAM.flameVibrancy, vibrancy),
    supersample: clampToSpec(PARAM.flameSupersample, supersample),
    estimatorRadius: clampToSpec(PARAM.estimatorRadius, estimatorRadius),
    estimatorMinimumRadius: clampToSpec(
      PARAM.estimatorMinimumRadius,
      estimatorMinimumRadius,
    ),
    estimatorCurve: clampToSpec(PARAM.estimatorCurve, estimatorCurve),
    paletteId,
  };
}

/**
 * Validate the untrusted `solid` render-settings block, following
 * `decodeFlameParams`' presence rules exactly: an absent block — or an
 * absent field within a present block — decodes quietly to its default,
 * while a present-but-malformed (non-finite) value rejects the whole scene.
 * Finite values are clamped into range; `resolution` is additionally
 * snapped to the voxel step and `iterations` rounded, matching their
 * setters.
 *
 * `paletteId` is the one exception to the reject-on-malformed rule,
 * mirroring `flame.paletteId`: an unknown or missing id decodes to
 * {@link DEFAULT_SOLID_PALETTE} rather than rejecting the scene.
 * `hasCustomPalette` extends that mirror exactly like
 * `decodeFlameParams`'s own parameter: a `"custom"` id is accepted only when
 * a valid `customPalette` payload actually decoded alongside it (see
 * {@link decodeCustomPalette}), otherwise it takes the same quiet fallback
 * an unrecognized id takes.
 */
function decodeSolidParams(
  raw: unknown,
  hasCustomPalette: boolean,
): SolidParams | null {
  const defaults: SolidParams = {
    resolution: PARAM.solidResolution.default,
    iterations: PARAM.solidIterations.default,
    threshold: PARAM.solidThreshold.default,
    lightAzimuth: PARAM.solidLightAzimuth.default,
    lightElevation: PARAM.solidLightElevation.default,
    ambient: PARAM.solidAmbient.default,
    paletteId: DEFAULT_SOLID_PALETTE,
  };
  if (raw === undefined) return defaults;
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;

  const out = { ...defaults };
  const numeric: Exclude<keyof SolidParams, "paletteId">[] = [
    "resolution",
    "iterations",
    "threshold",
    "lightAzimuth",
    "lightElevation",
    "ambient",
  ];
  for (const key of numeric) {
    if (s[key] === undefined) continue;
    const value = Number(s[key]);
    if (!Number.isFinite(value)) return null;
    out[key] = value;
  }

  // paletteId: unknown or missing quietly becomes the default —
  // same quiet-fallback contract as flame.paletteId (see decodeFlameParams).
  // "custom" is accepted only alongside a valid decoded
  // customPalette payload.
  const paletteId: PaletteSelection =
    typeof s.paletteId === "string" &&
    (VALID_PALETTE_IDS.has(s.paletteId) ||
      (s.paletteId === CUSTOM_PALETTE_ID && hasCustomPalette))
      ? (s.paletteId as PaletteSelection)
      : DEFAULT_SOLID_PALETTE;

  return {
    resolution: clampToSpec(PARAM.solidResolution, out.resolution),
    iterations: clampToSpec(PARAM.solidIterations, out.iterations),
    threshold: clampToSpec(PARAM.solidThreshold, out.threshold),
    lightAzimuth: clampToSpec(PARAM.solidLightAzimuth, out.lightAzimuth),
    lightElevation: clampToSpec(PARAM.solidLightElevation, out.lightElevation),
    ambient: clampToSpec(PARAM.solidAmbient, out.ambient),
    paletteId,
  };
}

/**
 * Validate the untrusted `surface` render-settings block,
 * following `decodeSolidParams`'s presence rules exactly: an absent block —
 * or an absent field within a present block — decodes quietly to its
 * default, while a present-but-malformed (non-finite) value rejects the
 * whole scene. Finite values are clamped into range.
 *
 * `colorSource` is a QUIET-fallback enum, like `symmetry.plane` (see
 * {@link decodeSymmetry}): an unrecognized or missing value decodes to
 * `"transform"` rather than rejecting the scene — a base-color choice is
 * cosmetic, not worth losing an otherwise-valid shared link over.
 *
 * `paletteId` mirrors `flame.paletteId`/`solid.paletteId` exactly:
 * an unknown or missing id decodes to {@link DEFAULT_SOLID_PALETTE} — the
 * surface render's own default, reused from the solid render rather than
 * redeclared, see `state.ts`'s `SurfaceParams` — rather than rejecting the
 * scene. `hasCustomPalette` extends that mirror exactly like the
 * other two blocks' own parameter: a `"custom"` id is accepted only when a
 * valid `customPalette` payload actually decoded alongside it (see
 * {@link decodeCustomPalette}), otherwise it takes the same quiet fallback an
 * unrecognized id takes.
 */
function decodeSurfaceParams(
  raw: unknown,
  hasCustomPalette: boolean,
): SurfaceParams | null {
  const defaults: SurfaceParams = {
    lightAzimuth: PARAM.surfaceLightAzimuth.default,
    lightElevation: PARAM.surfaceLightElevation.default,
    ambient: PARAM.surfaceAmbient.default,
    colorSource: "transform",
    paletteId: DEFAULT_SOLID_PALETTE,
    colorSpeed: PARAM.surfaceColorSpeed.default,
    // envLight: absent (every document predating the environment light)
    // decodes to the default, which is the intended on-by-default
    // behaviour — those links render slightly differently now, on purpose.
    envLight: PARAM.surfaceEnvLight.default,
    floorPattern: "solid",
    floorTileScale: PARAM.surfaceFloorTileScale.default,
    floorEmission: PARAM.surfaceFloorEmission.default,
  };
  if (raw === undefined) return defaults;
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;

  const out = { ...defaults };
  const numeric: Exclude<
    keyof SurfaceParams,
    "colorSource" | "paletteId" | "floorPattern"
  >[] = [
    "lightAzimuth",
    "lightElevation",
    "ambient",
    "colorSpeed",
    "envLight",
    "floorTileScale",
    "floorEmission",
  ];
  for (const key of numeric) {
    if (s[key] === undefined) continue;
    const value = Number(s[key]);
    if (!Number.isFinite(value)) return null;
    out[key] = value;
  }

  // colorSource: unknown or missing quietly becomes "transform" —
  // the same quiet-fallback contract as symmetry.plane just below.
  const colorSource: SurfaceColorSource =
    typeof s.colorSource === "string" &&
    VALID_SURFACE_COLOR_SOURCES.has(s.colorSource)
      ? (s.colorSource as SurfaceColorSource)
      : "transform";
  const floorPattern: SurfaceFloorPattern =
    typeof s.floorPattern === "string" &&
    (SURFACE_FLOOR_PATTERNS as readonly string[]).includes(s.floorPattern)
      ? (s.floorPattern as SurfaceFloorPattern)
      : "solid";

  // paletteId: unknown or missing quietly becomes the default —
  // same quiet-fallback contract as flame.paletteId/solid.paletteId (see
  // decodeFlameParams). "custom" is accepted only alongside a valid
  // decoded customPalette payload.
  const paletteId: PaletteSelection =
    typeof s.paletteId === "string" &&
    (VALID_PALETTE_IDS.has(s.paletteId) ||
      (s.paletteId === CUSTOM_PALETTE_ID && hasCustomPalette))
      ? (s.paletteId as PaletteSelection)
      : DEFAULT_SOLID_PALETTE;

  return {
    lightAzimuth: clampToSpec(PARAM.surfaceLightAzimuth, out.lightAzimuth),
    lightElevation: clampToSpec(
      PARAM.surfaceLightElevation,
      out.lightElevation,
    ),
    ambient: clampToSpec(PARAM.surfaceAmbient, out.ambient),
    colorSource,
    paletteId,
    colorSpeed: clampToSpec(PARAM.surfaceColorSpeed, out.colorSpeed),
    envLight: clampToSpec(PARAM.surfaceEnvLight, out.envLight),
    floorPattern,
    floorTileScale: clampToSpec(
      PARAM.surfaceFloorTileScale,
      out.floorTileScale,
    ),
    floorEmission: clampToSpec(PARAM.surfaceFloorEmission, out.floorEmission),
  };
}

/**
 * Validate the untrusted `symmetry` block. Unlike `flame`/`solid`, a
 * malformed field never rejects the whole scene: `order` coerces and clamps
 * (an out-of-range or non-finite request quietly becomes the nearest valid
 * value, the same spirit as `weight`'s clamp) and an unrecognized/missing
 * `plane` quietly becomes `"xz"` (the same quiet-fallback `flame.paletteId`
 * uses for an unknown enum, generalized to this field too) — a kaleidoscope
 * order/plane is cosmetic geometry, not a value worth losing an otherwise-
 * valid shared link over. An absent block, or a block missing a field,
 * defaults quietly to `{ order: 1, plane: "xz" }`; order 1 is the
 * unreplicated system.
 *
 * ## Reading a legacy document
 *
 * The field was `axis: "x" | "y" | "z"` before the 4D kaleidoscope replaced
 * it with `plane`. This decoder is the migration, and it is the ONLY one —
 * nothing downstream ever sees an `axis` again:
 *
 * - a modern `plane` wins whenever it is present and recognized;
 * - otherwise a legacy `axis` maps through {@link LEGACY_AXIS_PLANE}
 *   (`x → yz`, `y → xz`, `z → xy` — the same rotation named the other way,
 *   matrix for matrix, so nothing a legacy document renders moves);
 * - anything else — an unknown plane, an unknown axis, neither field at all
 *   — falls back to `"xz"`, which is exactly what the legacy default axis
 *   `"y"` meant, so the fallback did not change meaning either.
 *
 * `twist` (the second angle of a 4D double rotation) coerces to an
 * integer and clamps into `[0, order)` against the ALREADY-clamped order,
 * defaulting to `0` — a simple rotation, which is what every document
 * written before this field existed decodes to.
 */
function decodeSymmetry(raw: unknown): SymmetryParams {
  if (typeof raw !== "object" || raw === null) {
    return {
      order: PARAM.symmetryOrder.default,
      plane: DEFAULT_SYMMETRY_PLANE,
    };
  }
  const s = raw as Record<string, unknown>;

  let order = PARAM.symmetryOrder.default;
  const rawOrder = Number(s.order);
  if (Number.isFinite(rawOrder)) order = rawOrder;
  order = clampToSpec(PARAM.symmetryOrder, order);

  const plane: SymmetryPlane =
    typeof s.plane === "string" && VALID_SYMMETRY_PLANES.has(s.plane)
      ? (s.plane as SymmetryPlane)
      : typeof s.axis === "string" && s.axis in LEGACY_AXIS_PLANE
        ? LEGACY_AXIS_PLANE[s.axis]
        : DEFAULT_SYMMETRY_PLANE;

  // Copy k's second angle is 2*pi*k*twist/order, so `order` twists is a full
  // turn and the value is only ever meaningful below it; clamped (not
  // reduced) for the same reason `order` is — a nonsense request becomes the
  // nearest sane value rather than costing the scene.
  let twist = PARAM.symmetryTwist.default;
  const rawTwist = Number(s.twist);
  if (Number.isFinite(rawTwist)) twist = rawTwist;
  twist = Math.min(clampToSpec(PARAM.symmetryTwist, twist), order - 1);

  return twist === 0 ? { order, plane } : { order, plane, twist };
}

/**
 * Validate the untrusted `camera` scene field: the orbit-camera
 * pose a save/share/collection document was written with (see
 * {@link CameraPose}). Its validation policy is deliberately DIFFERENT from
 * the core fields above (`transforms`/`colorMode`/`renderStyle`/...): those
 * reject the WHOLE scene on anything malformed, but a camera pose is a view,
 * not structural data — an optional field must never cost the user their
 * scene, and a hash lacking this field (or an undo-history snapshot, which
 * never carries one at all — see {@link SceneSnapshot.camera}'s doc) has to
 * keep decoding. So this returns `undefined` (drop only the camera) rather
 * than `null` (reject the scene) for anything malformed:
 *
 * - not a non-null object;
 * - `target` not exactly 3 finite numbers (via {@link isVec3}), or any
 *   component's absolute value exceeds {@link CAMERA_TARGET_LIMIT};
 * - `radius` / `theta` / `phi` not literally typeof `"number"` and finite —
 *   deliberately NOT the `Number(x)` coercion most other fields in this file
 *   use, so a string like `"7"` is rejected rather than silently accepted.
 *
 * A validated pose clamps `radius` to `orbit.ts`'s [{@link MIN_RADIUS},
 * {@link MAX_RADIUS}] and `phi` to its [{@link MIN_PHI}, {@link MAX_PHI}];
 * `theta` (azimuth) is stored as-is, unbounded, matching `OrbitCamera`'s own
 * contract.
 */
function decodeCameraPose(raw: unknown): CameraPose | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const c = raw as Record<string, unknown>;

  if (!isVec3(c.target)) return undefined;
  if (c.target.some((n) => Math.abs(n) > CAMERA_TARGET_LIMIT)) {
    return undefined;
  }

  const { radius, theta, phi } = c;
  if (typeof radius !== "number" || !Number.isFinite(radius)) return undefined;
  if (typeof theta !== "number" || !Number.isFinite(theta)) return undefined;
  if (typeof phi !== "number" || !Number.isFinite(phi)) return undefined;

  return {
    target: c.target,
    radius: clampRadius(radius),
    theta,
    phi: clampPhi(phi),
  };
}

/**
 * Validate the untrusted `fourD` scene field: the 4D view pose a
 * save/share/collection document was written with (see {@link FourDPose}) —
 * the 4D sibling of `camera`/{@link decodeCameraPose} just above, and its
 * validation policy is identical in spirit: a 4D pose is view state, not
 * structural data, so anything malformed drops ONLY the pose — returns
 * `undefined` — rather than rejecting the whole scene (`null`):
 *
 * - not a non-null object;
 * - `p` / `q` not both arrays — once narrowed, they're handed to
 *   `rotor4.ts`'s {@link normalizeRotorPair}, which is the actual trust
 *   boundary: it requires exactly 4 finite `typeof "number"` entries per
 *   half (deliberately NOT the `Number(x)` coercion most other fields in
 *   this file use — the same strictness rationale as `decodeCameraPose`'s
 *   `radius`/`theta`/`phi`) with a norm large enough to normalize, and
 *   returns a fresh unit-normalized pair or `null` — relayed here as
 *   `undefined` without duplicating any of that per-entry logic;
 * - `sliceCenter` not literally typeof `"number"` and finite — same
 *   all-or-nothing stance as `decodeCameraPose`'s scalar fields: the whole
 *   pose drops rather than defaulting just this one field.
 *
 * A validated pose clamps `sliceCenter` to `[-1, 1]` (the slice-position
 * slider's own range — see index.html's `fourDSliceSlider`); `sliceOn` /
 * `sliceRelColor` coerce with `Boolean(...)`, the same contract
 * `showGuides`/`fourDDepthFade` use elsewhere in this file — absent
 * coerces to off.
 *
 * `sliceThickness` is the one field here that DOESN'T follow
 * `sliceCenter`'s all-or-nothing rule, and deliberately so: every document
 * written before that slider existed carries no such key at all, and those
 * poses must keep decoding. So it takes the TOLERANT contract
 * `glowBrightness`/`colorGamma` use — coerce, and fall back to 0 (the
 * zero-thickness cross-section those documents were framed with) for
 * anything absent or non-finite — then clamps to `[0, 0.5]`, the
 * thickness slider's own range (see index.html's
 * `fourDSliceThicknessSlider`).
 */
function decodeFourDPose(raw: unknown): FourDPose | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const f = raw as Record<string, unknown>;

  if (!Array.isArray(f.p) || !Array.isArray(f.q)) return undefined;
  const pair = normalizeRotorPair(f.p, f.q);
  if (pair === null) return undefined;

  const { sliceCenter } = f;
  if (typeof sliceCenter !== "number" || !Number.isFinite(sliceCenter))
    return undefined;

  const rawThickness = Number(f.sliceThickness);
  const sliceThickness = Number.isFinite(rawThickness)
    ? clamp(rawThickness, 0, 0.5)
    : 0;

  return {
    pair,
    sliceOn: Boolean(f.sliceOn),
    sliceCenter: clamp(sliceCenter, -1, 1),
    sliceThickness,
    sliceRelColor: Boolean(f.sliceRelColor),
  };
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * The compact wire form of one variation entry: `{ type, weight }` plus the
 * fold's three optional lengths, each present only when the
 * source field is finite (see `encodeTransform`'s `encodeFoldRadius`).
 */
interface EncodedVariation {
  type: VariationType;
  weight: number;
  minRadius?: number;
  fixedRadius?: number;
  boxLimit?: number;
}

/**
 * The compact wire form of one transform: `id` dropped, floats rounded. `w`
 * mirrors {@link WExtension} field-for-field (same optional sub-object
 * shape) — see `encodeTransform`'s canonicalization rule for when it's
 * present at all. `finish` mirrors {@link SurfaceFinish} field-for-field the
 * identical way, but on the fold-length rule instead — see
 * `encodeTransform`'s `encodeFinish`: present only when at least one field
 * survives.
 */
interface EncodedTransform {
  position: number[];
  rotation: number[];
  scale: number[];
  weight?: number;
  colorIndex?: number;
  colorSpeed?: number;
  shear?: number[];
  variations?: EncodedVariation[];
  w?: WExtension;
  finish?: SurfaceFinish;
  surfacePattern?: SurfacePattern;
}

/**
 * Round one of the fold's three lengths for the wire IFF it's
 * present and finite — `encodeTransform`'s counterpart to
 * {@link decodeFoldRadius}: `undefined` in, `undefined` out, so an absent
 * `minRadius`/`fixedRadius`/`boxLimit` writes nothing and a document that
 * never authored these fields encodes byte-identically to one that predates
 * them.
 */
function encodeFoldRadius(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) ? round4(n) : undefined;
}

/**
 * Round one of a finish's six fields for the wire IFF it's present and
 * finite — `encodeFinish`'s counterpart to {@link decodeFinishField}, the
 * identical shape as {@link encodeFoldRadius}: `undefined` in, `undefined`
 * out, so an absent `specular`/`shininess`/`metalness`/`reflect`/`transmit`/
 * `reflectionTint` writes nothing.
 */
function encodeFinishField(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) ? round4(n) : undefined;
}

/**
 * Encode a transform's optional `finish` (see `types.ts`'s
 * {@link SurfaceFinish}): each of the six fields written only when present
 * and finite, mirroring {@link encodeFoldRadius}'s per-field omission on
 * `Variation`'s own optional lengths rather than `w`'s single shared
 * predicate — there is no `isFlatTransform`-style test for a finish, so
 * each field stands on its own. Returns `undefined` when nothing survives,
 * so a `finish` whose every field is absent or non-finite encodes with NO
 * `finish` key at all — a document that never meaningfully authored one
 * stays byte-identical to a document that predates the field, exactly like
 * `encodeTransform`'s own `variations` omission just below.
 */
function encodeFinish(
  finish: SurfaceFinish | undefined,
): SurfaceFinish | undefined {
  if (finish === undefined) return undefined;
  const e: SurfaceFinish = {};
  const specular = encodeFinishField(finish.specular);
  if (specular !== undefined) e.specular = specular;
  const shininess = encodeFinishField(finish.shininess);
  if (shininess !== undefined) e.shininess = shininess;
  const metalness = encodeFinishField(finish.metalness);
  if (metalness !== undefined) e.metalness = metalness;
  const reflect = encodeFinishField(finish.reflect);
  if (reflect !== undefined) e.reflect = reflect;
  const transmit = encodeFinishField(finish.transmit);
  if (transmit !== undefined) e.transmit = transmit;
  const reflectionTint = encodeFinishField(finish.reflectionTint);
  if (reflectionTint !== undefined) e.reflectionTint = reflectionTint;
  return Object.keys(e).length > 0 ? e : undefined;
}

/** Sparse, fidelity-only patterned-albedo encoder. */
function encodeSurfacePattern(
  pattern: SurfacePattern | undefined,
): SurfacePattern | undefined {
  if (
    pattern === undefined ||
    !SURFACE_PATTERN_KINDS.includes(pattern.kind) ||
    !SURFACE_PATTERN_AXES.includes(pattern.axis)
  ) {
    return undefined;
  }
  const encoded: SurfacePattern = {
    kind: pattern.kind,
    axis: pattern.axis,
  };
  const scale = encodeFinishField(pattern.scale);
  if (scale !== undefined) encoded.scale = scale;
  const strength = encodeFinishField(pattern.strength);
  if (strength !== undefined) encoded.strength = strength;
  return encoded;
}

/**
 * Encode one transform's persistent fields, dropping inert data so URLs stay
 * short: `id` (reassigned on decode), a weight of 1, a colorSpeed of
 * {@link DEFAULT_COLOR_SPEED}, an all-zero shear, and zero-weight variations
 * are all omitted. Shared by the transform list and the final transform so
 * their wire forms can't drift.
 *
 * `colorIndex` is the one deliberate exception to the
 * omit-the-default rule: it is written whenever present, regardless of
 * value. Every other optional field here has one fixed default it can
 * compare against (1 for weight, {@link DEFAULT_COLOR_SPEED} for colorSpeed,
 * all-zero for shear); `colorIndex`'s absent-default is not a fixed value
 * but `derivedColorIndex(i, n)` (`chaos-game.ts`) — a function of this map's
 * index `i` AND the system's transform count `n`, neither of which this
 * per-transform function has in hand (it runs once per transform, and is
 * shared with the final transform, which has no index or transform count to
 * speak of at all). With nothing to compare against, there is no default
 * value to omit — an authored `colorIndex` is recorded verbatim, and it is
 * `derivedColorIndex` at the READING end (`prepareChaosGame`) that supplies
 * the fallback for a transform that never set one.
 *
 * `w` (the optional 4D extension — see {@link WExtension}) follows the same
 * "drop the identity" spirit, but keyed on ONE shared predicate rather than a
 * per-field check: {@link isFlatTransform}, the exact test the runtime itself
 * uses to decide whether a system needs the 4D path at all. Omitting `w`
 * whenever the transform is flat means "all-identity ⇒ absent" can never
 * drift from what the app considers flat — a flat system's encoded bytes stay
 * byte-identical to a pre-4D link, canonical down to the byte.
 *
 * For a NON-flat transform, `position` and each rotation/shear w-plane are
 * included only when defined && non-zero — the same omit-the-identity-value
 * convention `weight`/`shear` use above — but `scale` is included whenever
 * DEFINED, regardless of value: its presence is semantic (absent means
 * "derive from the 3D scale at lift time", see `WExtension.scale`'s doc), so
 * an explicitly authored value that happens to equal the derived mean must
 * still survive the round trip rather than silently reverting to "derived".
 *
 * `finish` (see {@link SurfaceFinish}) follows the fold length's PER-FIELD
 * omission instead — see {@link encodeFinish} — because unlike `w` it has no
 * single shared "is this the identity" predicate to key on: each of its five
 * fields is independently classic-or-not, so each is dropped independently.
 */
function encodeTransform(t: Transform): EncodedTransform {
  const e: EncodedTransform = {
    position: t.position.map(round4),
    rotation: t.rotation.map(round4),
    scale: t.scale.map(round4),
  };
  if (t.weight !== undefined && t.weight !== 1) e.weight = round4(t.weight);
  // colorIndex: always written when present — see this function's doc
  // comment for why there is no default value to omit it against.
  if (t.colorIndex !== undefined) e.colorIndex = round4(t.colorIndex);
  // colorSpeed: omitted at DEFAULT_COLOR_SPEED, mirroring weight's
  // omit-the-default rule above — unlike colorIndex, colorSpeed's
  // absent-default IS one fixed constant, so there IS something to compare
  // against.
  if (t.colorSpeed !== undefined && t.colorSpeed !== DEFAULT_COLOR_SPEED) {
    e.colorSpeed = round4(t.colorSpeed);
  }
  if (t.shear && t.shear.some((v) => v !== 0)) e.shear = t.shear.map(round4);
  if (t.variations && t.variations.length > 0) {
    const active: EncodedVariation[] = t.variations
      .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
      .map((v) => {
        const ev: EncodedVariation = {
          type: v.type,
          weight: round4(v.weight),
        };
        // The fold's three lengths: written ONLY when present and
        // finite, so a document that never authored them encodes
        // byte-identically to one predating the fields entirely — see
        // encodeFoldRadius.
        const minRadius = encodeFoldRadius(v.minRadius);
        if (minRadius !== undefined) ev.minRadius = minRadius;
        const fixedRadius = encodeFoldRadius(v.fixedRadius);
        if (fixedRadius !== undefined) ev.fixedRadius = fixedRadius;
        const boxLimit = encodeFoldRadius(v.boxLimit);
        if (boxLimit !== undefined) ev.boxLimit = boxLimit;
        return ev;
      });
    if (active.length > 0) e.variations = active;
  }
  if (!isFlatTransform(t)) {
    // Safe: isFlatTransform only returns false when `t.w` is present (an
    // absent block is always flat — see its doc).
    const tw = t.w as WExtension;
    const w: WExtension = {};
    if (tw.position !== undefined && tw.position !== 0) {
      w.position = round4(tw.position);
    }
    if (tw.scale !== undefined) w.scale = round4(tw.scale);
    if (tw.rotation) {
      const { xw, yw, zw } = tw.rotation;
      const rotation: NonNullable<WExtension["rotation"]> = {};
      if (xw !== undefined && xw !== 0) rotation.xw = round4(xw);
      if (yw !== undefined && yw !== 0) rotation.yw = round4(yw);
      if (zw !== undefined && zw !== 0) rotation.zw = round4(zw);
      if (Object.keys(rotation).length > 0) w.rotation = rotation;
    }
    if (tw.shear) {
      const { xw, yw, zw } = tw.shear;
      const shear: NonNullable<WExtension["shear"]> = {};
      if (xw !== undefined && xw !== 0) shear.xw = round4(xw);
      if (yw !== undefined && yw !== 0) shear.yw = round4(yw);
      if (zw !== undefined && zw !== 0) shear.zw = round4(zw);
      if (Object.keys(shear).length > 0) w.shear = shear;
    }
    e.w = w;
  }
  const finish = encodeFinish(t.finish);
  if (finish !== undefined) e.finish = finish;
  const surfacePattern = encodeSurfacePattern(t.surfacePattern);
  if (surfacePattern !== undefined) e.surfacePattern = surfacePattern;
  return e;
}

/**
 * Produce a compact, URL-safe `v1=<base64url>` string for `s`. Floats are
 * rounded to 4 decimal places; transform ids are omitted and reassigned from
 * the array index on decode.
 */
export function encodeScene(s: SceneSnapshot): string {
  const payload: {
    transforms: EncodedTransform[];
    finalTransform?: EncodedTransform;
    numPoints: number;
    pointSize: number;
    colorMode: ColorMode;
    colorGamma: number;
    rampPaletteId: PaletteSelection;
    fourDColor: FourDColorMode;
    fourDDepthFade: boolean;
    renderStyle: RenderStyle;
    showGuides: boolean;
    flame: FlameParams;
    solid: SolidParams;
    surface: SurfaceParams;
    symmetry: SymmetryParams;
    glowBrightness: number;
    balloonEcho: boolean;
    balloonRadius: number;
    balloonTint: string;
    balloonTintStrength: number;
    fogDensity: number;
    fogTint: string;
    fogTintStrength: number;
    groundPlane: boolean;
    background?: {
      mode: BackgroundMode;
      top?: string;
      bottom?: string;
      shape?: BackgroundShape;
    };
    customPalette?: { stops: string[] };
    positionAxisColors?: { x: string; y: string; z: string };
    camera?: {
      target: number[];
      radius: number;
      theta: number;
      phi: number;
    };
    fourD?: {
      p: number[];
      q: number[];
      sliceOn: boolean;
      sliceCenter: number;
      sliceThickness: number;
      sliceRelColor: boolean;
    };
  } = {
    transforms: s.transforms.map(encodeTransform),
    numPoints: s.numPoints,
    pointSize: round4(s.pointSize),
    colorMode: s.colorMode,
    // Always written, like glowBrightness — a small, always-present setting,
    // not a per-transform optional feature like finalTransform/weight/shear.
    colorGamma: round4(s.colorGamma),
    // Always written, like colorGamma above — even while a color
    // mode it doesn't affect is active, where it is inert exactly the way
    // colorGamma is.
    rampPaletteId: s.rampPaletteId,
    // Always written for the same reason — even for a flat system, where it
    // is inert exactly the way colorMode is inert for a non-flat one.
    fourDColor: s.fourDColor,
    // Always written, exactly like fourDColor above.
    fourDDepthFade: s.fourDDepthFade,
    renderStyle: s.renderStyle,
    showGuides: s.showGuides,
    // Always written, like numPoints/pointSize (not conditionally omitted
    // like finalTransform/weight/shear): it is a small, always-present
    // settings block, not a per-transform optional feature.
    flame: {
      exposure: round4(s.flame.exposure),
      iterations: Math.round(s.flame.iterations),
      gamma: round4(s.flame.gamma),
      vibrancy: round4(s.flame.vibrancy),
      supersample: Math.round(s.flame.supersample),
      estimatorRadius: round4(s.flame.estimatorRadius),
      estimatorMinimumRadius: round4(s.flame.estimatorMinimumRadius),
      estimatorCurve: round4(s.flame.estimatorCurve),
      paletteId: s.flame.paletteId,
    },
    solid: {
      resolution: Math.round(s.solid.resolution),
      iterations: Math.round(s.solid.iterations),
      threshold: round4(s.solid.threshold),
      lightAzimuth: round4(s.solid.lightAzimuth),
      lightElevation: round4(s.solid.lightElevation),
      ambient: round4(s.solid.ambient),
      paletteId: s.solid.paletteId,
    },
    surface: {
      lightAzimuth: round4(s.surface.lightAzimuth),
      lightElevation: round4(s.surface.lightElevation),
      ambient: round4(s.surface.ambient),
      colorSource: s.surface.colorSource,
      paletteId: s.surface.paletteId,
      colorSpeed: round4(s.surface.colorSpeed),
      envLight: round4(s.surface.envLight),
      floorPattern: s.surface.floorPattern,
      floorTileScale: round4(s.surface.floorTileScale),
      floorEmission: round4(s.surface.floorEmission),
    },
    symmetry: {
      order: Math.round(s.symmetry.order),
      plane: s.symmetry.plane,
      // Written only when nonzero, so an ordinary simple-rotation
      // document's encoded form gains nothing but the renamed field — the
      // same absent-means-identity discipline as finalTransform/weight/shear.
      ...(s.symmetry.twist ? { twist: Math.round(s.symmetry.twist) } : {}),
    },
    // Always written, like symmetry — a small, always-present setting, not a
    // per-transform optional feature like finalTransform/weight/shear.
    glowBrightness: round4(s.glowBrightness),
    // Always written, like glowBrightness just above — NOT
    // conditionally omitted at the pristine default the way `background`
    // is below: there is no document predating the pair whose meaning depends
    // on this field's absence (unlike background's aerial-coupling
    // legacy), so the simpler always-written rule applies and a
    // false/DEFAULT_BALLOON_RADIUS pair costs nothing to carry. The `??`
    // fallbacks only matter for a hand-built SceneSnapshot that skipped
    // toSnapshot (which always supplies both) — see toSnapshot's own note.
    balloonEcho: s.balloonEcho ?? false,
    balloonRadius: round4(s.balloonRadius ?? DEFAULT_BALLOON_RADIUS),
    // Always written, the identical balloonRadius shape just
    // above — the `??` fallbacks only matter for a hand-built SceneSnapshot
    // that skipped toSnapshot. balloonTint is a hex string already (no
    // rounding); balloonTintStrength rounds like every other float in this
    // payload.
    balloonTint: s.balloonTint ?? DEFAULT_BALLOON_TINT,
    balloonTintStrength: round4(
      s.balloonTintStrength ?? DEFAULT_BALLOON_TINT_STRENGTH,
    ),
    // Always written, like balloonRadius just above — the `??`
    // fallback only matters for a hand-built SceneSnapshot that skipped
    // toSnapshot (which always supplies it).
    fogDensity: round4(s.fogDensity ?? DEFAULT_FOG_DENSITY),
    // Always written, the identical fogDensity shape just above —
    // the `??` fallbacks only matter for a hand-built SceneSnapshot that
    // skipped toSnapshot. fogTint is a hex string already (no rounding);
    // fogTintStrength rounds like every other float in this payload.
    fogTint: s.fogTint ?? DEFAULT_FOG_TINT,
    fogTintStrength: round4(s.fogTintStrength ?? DEFAULT_FOG_TINT_STRENGTH),
    // Always written, like fogTintStrength just above — the `??`
    // fallback only matters for a hand-built SceneSnapshot that skipped
    // toSnapshot (which always supplies it). A boolean, so no rounding.
    groundPlane: s.groundPlane ?? false,
  };
  // background: omitted while pristine (`dark`, nothing authored,
  // shape linear) so never-touched scenes keep their short URLs AND
  // documents predating the field keep identical encoded bytes — EXCEPT
  // under the aerial render style, where even the pristine default is
  // written out: an absent field is what a legacy document looks like, and
  // the decoder reads legacy-aerial as haze (the backdrop the style used to
  // force), so an aerial scene that means "dark" must say so. The custom
  // gradient is written whenever authored, selected or not — the slot
  // survives like customPalette — as hex strings for URL compactness (see
  // rgbToHex). `shape` is written only when it is NOT the default "linear" —
  // a linear-only document, radial-authored or not, encodes byte-identical
  // to one predating the shape field, the same absent-means-identity
  // discipline as finalTransform/weight/shear.
  if (
    s.background.mode !== "dark" ||
    s.background.custom !== undefined ||
    s.renderStyle === "aerial" ||
    (s.background.shape ?? DEFAULT_BACKGROUND_SHAPE) !==
      DEFAULT_BACKGROUND_SHAPE
  ) {
    payload.background = {
      mode: s.background.mode,
      ...(s.background.custom
        ? {
            top: rgbToHex(s.background.custom.top),
            bottom: rgbToHex(s.background.custom.bottom),
          }
        : {}),
      ...(s.background.shape && s.background.shape !== DEFAULT_BACKGROUND_SHAPE
        ? { shape: s.background.shape }
        : {}),
    };
  }
  // Written only when present, so lens-free systems keep their short URLs.
  if (s.finalTransform)
    payload.finalTransform = encodeTransform(s.finalTransform);
  // Written only when present, like finalTransform above — never-authored
  // scenes keep their short URLs. Encoded as hex strings for URL
  // compactness — see rgbToHex.
  if (s.customPalette)
    payload.customPalette = { stops: s.customPalette.stops.map(rgbToHex) };
  // Written only when present, like customPalette above — the legacy
  // identity is expressed by absence (see AppState.positionAxisColors),
  // so never-customized scenes stay byte-identical.
  if (s.positionAxisColors) {
    payload.positionAxisColors = {
      x: rgbToHex(s.positionAxisColors.x),
      y: rgbToHex(s.positionAxisColors.y),
      z: rgbToHex(s.positionAxisColors.z),
    };
  }
  // Written only when present, like finalTransform/customPalette above — an
  // undo-history snapshot (which never carries a camera — see
  // SceneSnapshot.camera's doc) stays byte-identical.
  if (s.camera) {
    payload.camera = {
      target: s.camera.target.map(round4),
      radius: round4(s.camera.radius),
      theta: round4(s.camera.theta),
      phi: round4(s.camera.phi),
    };
  }
  // Written only when present, like camera above — an undo-history
  // snapshot (which never carries a 4D pose either — see SceneSnapshot.fourD's
  // doc) stays byte-identical. Wire form flattens the rotor pair to p/q (URL
  // compactness — no nested `pair` object). Quaternion components +
  // sliceCenter/sliceThickness are rounded to 4 decimals like every other
  // float in this file: the resulting angle error is far below visibility,
  // and the decoder renormalizes the pair anyway. sliceThickness
  // is written unconditionally, like the two booleans beside it — its
  // absence is what a document predating the slab looks like, and the decoder
  // already reads that as 0.
  if (s.fourD) {
    payload.fourD = {
      p: s.fourD.pair.p.map(round4),
      q: s.fourD.pair.q.map(round4),
      sliceOn: s.fourD.sliceOn,
      sliceCenter: round4(s.fourD.sliceCenter),
      sliceThickness: round4(s.fourD.sliceThickness),
      sliceRelColor: s.fourD.sliceRelColor,
    };
  }
  return "v1=" + toBase64url(JSON.stringify(payload));
}

/**
 * Decode a raw `v1=<base64url>` string into a SceneSnapshot, or `null` for
 * anything malformed. This is the robustness boundary for untrusted input —
 * it must never throw.
 *
 * Validates strictly: requires the `v1=` prefix; 1..MAX_TRANSFORMS transforms
 * each with valid Vec3 fields; an optional finalTransform validated the same
 * way; exact colorMode / renderStyle matches. Clamps numPoints to
 * [0, {@link MAX_NUM_POINTS}] (the 0 floor is the deliberate data floor,
 * wider than the UI slider — see PARAM.numPoints in state.ts), pointSize to
 * [{@link MIN_POINT_SIZE}, {@link MAX_POINT_SIZE}], flame.exposure to
 * [{@link MIN_FLAME_EXPOSURE},
 * {@link MAX_FLAME_EXPOSURE}], flame.iterations to
 * [{@link MIN_FLAME_ITERATIONS}, {@link MAX_FLAME_ITERATIONS}], flame.gamma to
 * [{@link MIN_FLAME_GAMMA}, {@link MAX_FLAME_GAMMA}], flame.vibrancy to
 * [{@link MIN_FLAME_VIBRANCY}, {@link MAX_FLAME_VIBRANCY}], flame.supersample
 * to [{@link MIN_FLAME_SUPERSAMPLE}, {@link MAX_FLAME_SUPERSAMPLE}],
 * flame.estimatorRadius to [{@link MIN_ESTIMATOR_RADIUS},
 * {@link MAX_ESTIMATOR_RADIUS}], flame.estimatorMinimumRadius to
 * [{@link MIN_ESTIMATOR_MINIMUM_RADIUS}, {@link MAX_ESTIMATOR_MINIMUM_RADIUS}],
 * and flame.estimatorCurve to [{@link MIN_ESTIMATOR_CURVE},
 * {@link MAX_ESTIMATOR_CURVE}]. An unknown/missing flame.paletteId falls back
 * to {@link DEFAULT_FLAME_PALETTE} (see {@link decodeFlameParams});
 * rampPaletteId follows the identical quiet-fallback shape at the
 * top level, falling back to {@link DEFAULT_RAMP_PALETTE} instead. Likewise,
 * symmetry.order clamps to [{@link MIN_SYMMETRY_ORDER},
 * {@link MAX_SYMMETRY_ORDER}] and an
 * unrecognized/missing symmetry.plane falls back to `"xz"` (the plane the
 * legacy default axis `"y"` named), and symmetry.twist clamps into
 * `[0, order)` — none of these ever
 * rejects the scene on malformed input (see {@link decodeSymmetry}). Same
 * spirit for glowBrightness: it clamps to [{@link MIN_GLOW_BRIGHTNESS},
 * {@link MAX_GLOW_BRIGHTNESS}], falling back to
 * {@link DEFAULT_GLOW_BRIGHTNESS} when absent or non-finite rather than
 * rejecting the scene. colorGamma follows the identical contract:
 * clamps to [{@link MIN_COLOR_GAMMA}, {@link MAX_COLOR_GAMMA}], falling back
 * to {@link DEFAULT_COLOR_GAMMA} when absent or non-finite rather than
 * rejecting the scene. fourDColor is enum-shaped like symmetry.plane
 * and shares its quiet fallback: absent or unrecognized values become
 * {@link DEFAULT_FOUR_D_COLOR}, never a rejection. fourDDepthFade
 * follows showGuides's boolean-coercion contract: any truthy value is on,
 * and absent coerces to off — the default.
 *
 * customPalette is the one user-authored gradient slot: optional
 * like finalTransform rather than always-present like flame/solid/symmetry,
 * and never rejects the scene — absent, malformed, or an out-of-range stop
 * count all quietly decode to `undefined` (see {@link decodeCustomPalette}),
 * the same cosmetic-field spirit as glowBrightness/colorGamma. Consequently,
 * flame.paletteId / solid.paletteId accept the `"custom"` id only when a
 * valid customPalette payload actually decoded alongside it; a `"custom"`
 * selection with nothing to back it falls back to that block's default
 * paletteId exactly like any other unrecognized id (see
 * {@link decodeFlameParams}).
 *
 * positionAxisColors follows the identical quiet-fallback contract:
 * absent or malformed decodes to `undefined` — the legacy axis mapping —
 * never a rejection.
 *
 * camera is the optional orbit-camera pose (see {@link CameraPose}).
 * Its policy is stricter than customPalette's in one way (no `Number(x)`
 * string coercion — see {@link decodeCameraPose}) but the same in spirit:
 * absent or malformed NEVER rejects the scene, it just decodes to
 * `undefined`, same as customPalette above.
 *
 * fourD is the optional 4D view pose — the tumble rotor plus the
 * soft w-slice window (see {@link FourDPose}), the 4D sibling of `camera`
 * just above. Same policy as `camera`, including its stricter no-coercion
 * stance on the numeric fields (see {@link decodeFourDPose}): absent or
 * malformed never rejects the scene, it just decodes to `undefined`. Its
 * one tolerant field is `sliceThickness`, which defaults to 0
 * rather than dropping the pose — every document written before that
 * slider existed lacks the key entirely.
 *
 * balloonEcho / balloonRadius follow camera/fourD's exact
 * quiet-drop contract — a malformed value (balloonEcho not literally a
 * boolean, balloonRadius not finite) decodes to `undefined` rather than
 * rejecting the scene — with one difference: unlike camera/fourD, both
 * fields DO have a real `AppState` counterpart, so `undefined` here is not
 * the final answer. balloonRadius additionally clamps into
 * {@link PARAM}.balloonRadius's range like any other PARAM-backed numeric
 * field. `fromSnapshot` (not this function) supplies the true defaults —
 * `false` / {@link DEFAULT_BALLOON_RADIUS} — for whichever comes back
 * `undefined`, so a link predating the pair decodes here with both fields
 * absent and still boots with the balloon off, exactly as it always did.
 *
 * balloonTint/balloonTintStrength are `balloonRadius`'s tint-pair
 * siblings, same never-rejects contract: `balloonTintStrength` coerces/
 * clamps into {@link PARAM}.balloonTintStrength's range exactly like
 * `fogTintStrength` clamps into `PARAM.fogTintStrength`; `balloonTint` must
 * be a string matching the `#rrggbb` hex pattern ({@link hexToRgb} is the
 * validator, reused from `fogTint`'s own field below) or it decodes to
 * `undefined`. `fromSnapshot` supplies {@link DEFAULT_BALLOON_TINT} /
 * {@link DEFAULT_BALLOON_TINT_STRENGTH}, so a link predating the tint pair
 * decodes with the pair absent and still boots with the shell untinted,
 * reproducing today's balloon rendering exactly.
 *
 * fogDensity follows the identical quiet-drop/clamp contract as
 * balloonRadius just above: coerce, reject non-finite to `undefined`, clamp
 * a finite value into {@link PARAM}.fogDensity's range, never rejecting the
 * scene. `fromSnapshot` supplies the true default, {@link
 * DEFAULT_FOG_DENSITY}, so a link predating the fog controls decodes here
 * with the field absent and still boots at density 1, reproducing the fixed
 * fog exactly.
 *
 * fogTint/fogTintStrength are `fogDensity`'s atmosphere-pair
 * siblings, same never-rejects contract: `fogTintStrength` coerces/clamps
 * into {@link PARAM}.fogTintStrength's range exactly like `fogDensity`;
 * `fogTint` must be a string matching the `#rrggbb` hex pattern ({@link
 * hexToRgb} is the validator, reused from `background`'s custom stops) or
 * it decodes to `undefined`. `fromSnapshot` supplies {@link DEFAULT_FOG_TINT}
 * / {@link DEFAULT_FOG_TINT_STRENGTH}, so a link predating the fog controls
 * decodes with the pair absent and still boots untinted, reproducing today's
 * fog exactly.
 *
 * groundPlane follows `balloonEcho`'s exact quiet-drop contract:
 * it requires a REAL boolean (no `Boolean(x)` coercion — a stray truthy
 * value must not silently turn the floor on), and a malformed or absent
 * value decodes to `undefined` rather than rejecting the scene.
 * `fromSnapshot` supplies the true default, `false`, so a link predating
 * the ground plane decodes here with the field absent and still boots with
 * the floor off, exactly as it always rendered.
 */
export function decodeScene(raw: string): SceneSnapshot | null {
  if (!raw.startsWith("v1=")) return null;

  try {
    const parsed: unknown = JSON.parse(fromBase64url(raw.slice(3)));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;

    const o = parsed as Record<string, unknown>;

    // Transforms: 1..MAX_TRANSFORMS entries, each with three Vec3 fields. ----
    const rawTransforms: unknown = o.transforms;
    if (!Array.isArray(rawTransforms)) return null;
    if (rawTransforms.length < 1 || rawTransforms.length > MAX_TRANSFORMS)
      return null;

    const transforms: Transform[] = [];
    for (let i = 0; i < rawTransforms.length; i++) {
      const decoded = decodeTransform(rawTransforms[i], i);
      if (decoded === null) return null;
      transforms.push(decoded);
    }

    // finalTransform: optional. Present ⇒ must validate like any transform (its
    // id is irrelevant, so 0); a malformed lens rejects the whole scene, exactly
    // as a malformed transform does. Absent/null stays undefined ⇒ no lens.
    let finalTransform: Transform | undefined;
    if (o.finalTransform !== undefined && o.finalTransform !== null) {
      const decoded = decodeTransform(o.finalTransform, 0);
      if (decoded === null) return null;
      finalTransform = decoded;
    }

    // colorMode / renderStyle: exact known-string matches only. ---------------
    const { colorMode, renderStyle } = o;
    if (typeof colorMode !== "string" || !VALID_COLOR_MODES.has(colorMode))
      return null;
    if (
      typeof renderStyle !== "string" ||
      !VALID_RENDER_STYLES.has(renderStyle)
    )
      return null;

    // numPoints: coerce, reject non-finite, clamp into PARAM.numPoints —
    // whose floor is 0 (a shared link may carry an empty-to-huge cloud),
    // deliberately BELOW the UI slider's own MIN_NUM_POINTS (1000) floor, so a
    // crafted sub-1000 count survives decode the way an off-detent iteration
    // count does. See PARAM.numPoints's doc in state.ts. -----------------------
    const rawNumPoints = Number(o.numPoints);
    if (!Number.isFinite(rawNumPoints)) return null;
    const numPoints = clampToSpec(PARAM.numPoints, rawNumPoints);

    // pointSize: coerce, reject non-finite, clamp into PARAM.pointSize
    // ([MIN_POINT_SIZE, MAX_POINT_SIZE]). ------------------------------------
    const rawPointSize = Number(o.pointSize);
    if (!Number.isFinite(rawPointSize)) return null;
    const pointSize = clampToSpec(PARAM.pointSize, rawPointSize);

    // customPalette: decoded BEFORE flame/solid so their paletteId
    // logic can tell whether a "custom" selection actually has a payload to
    // back it. Never rejects the scene — see decodeCustomPalette.
    const customPalette = decodeCustomPalette(o.customPalette);

    // positionAxisColors: the position color mode's custom axis
    // colors. Never rejects the scene — see decodePositionAxisColors.
    const positionAxisColors = decodePositionAxisColors(o.positionAxisColors);

    // flame/solid: an absent block defaults quietly; present-but-malformed
    // rejects the whole scene. See decodeFlameParams / decodeSolidParams. A
    // "custom" paletteId is honored only when customPalette (above) actually
    // decoded.
    const flame = decodeFlameParams(o.flame, customPalette !== undefined);
    if (flame === null) return null;
    const solid = decodeSolidParams(o.solid, customPalette !== undefined);
    if (solid === null) return null;
    const surface = decodeSurfaceParams(o.surface, customPalette !== undefined);
    if (surface === null) return null;

    // symmetry: never rejects — a missing block or malformed field quietly
    // falls back to its default. See decodeSymmetry.
    const symmetry = decodeSymmetry(o.symmetry);

    // glowBrightness: manual override on top of the glow render's
    // density-adaptive auto-exposure (see exposure.ts's glowExposure). Like
    // symmetry.order, an absent or non-finite value falls back to the
    // neutral default (1) rather than rejecting the scene — a brightness
    // override is a cosmetic tweak, not structural data worth losing an
    // otherwise-valid shared link over. A finite-but-out-of-range value
    // clamps instead.
    let glowBrightness = PARAM.glowBrightness.default;
    const rawGlowBrightness = Number(o.glowBrightness);
    if (Number.isFinite(rawGlowBrightness)) glowBrightness = rawGlowBrightness;
    glowBrightness = clampToSpec(PARAM.glowBrightness, glowBrightness);

    // colorGamma: color-contrast exponent for the height/radius/
    // position color modes (see color.ts's colorModeUsesGamma). Same
    // never-rejects contract as glowBrightness just above — a contrast tweak
    // is cosmetic, not worth losing a shared link over.
    let colorGamma = PARAM.colorGamma.default;
    const rawColorGamma = Number(o.colorGamma);
    if (Number.isFinite(rawColorGamma)) colorGamma = rawColorGamma;
    colorGamma = clampToSpec(PARAM.colorGamma, colorGamma);

    // fourDColor: how the 4D projection colors points. Same quiet-
    // fallback contract as symmetry.plane / flame.paletteId, NOT colorMode's
    // strict reject: an absent or unrecognized value falls back to the
    // default blue/orange ramp — a 4D palette choice is cosmetic, not worth
    // losing an otherwise-valid shared link over.
    const fourDColor: FourDColorMode =
      typeof o.fourDColor === "string" &&
      VALID_FOUR_D_COLOR_MODES.has(o.fourDColor)
        ? (o.fourDColor as FourDColorMode)
        : DEFAULT_FOUR_D_COLOR;

    // rampPaletteId: the height/radius ramps' gradient palette. The
    // same quiet-fallback shape as flame.paletteId / solid.paletteId (see
    // decodeFlameParams): absent or unknown falls back to "legacy" — the
    // built-in ramps — and "custom" is honored only alongside the valid
    // decoded customPalette payload above.
    const rampPaletteId: PaletteSelection =
      typeof o.rampPaletteId === "string" &&
      (VALID_PALETTE_IDS.has(o.rampPaletteId) ||
        (o.rampPaletteId === CUSTOM_PALETTE_ID && customPalette !== undefined))
        ? (o.rampPaletteId as PaletteSelection)
        : DEFAULT_RAMP_PALETTE;

    // background: never rejects — absent, malformed, or unknown
    // falls back to the LEGACY resolution (haze under the aerial style, dark
    // otherwise), which is also the legacy migration. Safe to key on
    // renderStyle here: it was strictly validated above. See
    // decodeBackground.
    const background = decodeBackground(o.background, renderStyle === "aerial");

    // camera: the optional orbit-camera pose. Never rejects the
    // scene — a malformed or absent value quietly decodes to undefined,
    // exactly like customPalette above. See decodeCameraPose.
    const camera = decodeCameraPose(o.camera);

    // fourD: the optional 4D view pose (tumble rotor + soft
    // w-slice). Never rejects the scene — a malformed or absent value
    // quietly decodes to undefined, exactly like camera above. See
    // decodeFourDPose.
    const fourD = decodeFourDPose(o.fourD);

    // balloonEcho / balloonRadius: the balloon pair, persisted
    // by the balloon's own "mode persists" rule. Same quiet-fallback
    // policy as camera/fourD just above — malformed or absent drops ONLY
    // the field to undefined, never the whole scene — but no sub-object to
    // open, so no dedicated decodeX helper: balloonEcho requires a REAL
    // boolean (camera/fourD's no-coercion stance, not showGuides-style
    // Boolean(x) truthiness — a stray truthy value must not silently turn
    // the balloon on), and balloonRadius coerces and clamps like every
    // other PARAM-backed numeric field (numPoints/pointSize above), never
    // rejecting the scene the way a transform field would. Neither
    // supplies its own true default here — false / DEFAULT_BALLOON_RADIUS
    // is fromSnapshot's job (see its own doc) — so both stay undefined
    // when absent or malformed, exactly like camera/fourD.
    const balloonEcho: boolean | undefined =
      typeof o.balloonEcho === "boolean" ? o.balloonEcho : undefined;
    const rawBalloonRadius = Number(o.balloonRadius);
    const balloonRadius: number | undefined = Number.isFinite(rawBalloonRadius)
      ? clampToSpec(PARAM.balloonRadius, rawBalloonRadius)
      : undefined;

    // balloonTint: a #rrggbb string. Validated with hexToRgb, the
    // same strict validator fogTint uses below — but only its "did this
    // parse" verdict matters here: like fogTint, AppState stores the hex
    // STRING itself (not an RgbStop), so the parsed triple is discarded and
    // the original string survives. Absent or malformed decodes to
    // undefined, never rejecting the scene; fromSnapshot supplies
    // DEFAULT_BALLOON_TINT.
    const balloonTint: string | undefined =
      typeof o.balloonTint === "string" && hexToRgb(o.balloonTint) !== null
        ? o.balloonTint
        : undefined;

    // balloonTintStrength: same coerce/clamp/never-reject
    // contract as balloonRadius just above. fromSnapshot supplies
    // DEFAULT_BALLOON_TINT_STRENGTH when this comes back undefined.
    const rawBalloonTintStrength = Number(o.balloonTintStrength);
    const balloonTintStrength: number | undefined = Number.isFinite(
      rawBalloonTintStrength,
    )
      ? clampToSpec(PARAM.balloonTintStrength, rawBalloonTintStrength)
      : undefined;

    // fogDensity: same coerce/clamp/never-reject contract as
    // balloonRadius just above. fromSnapshot supplies DEFAULT_FOG_DENSITY
    // when this comes back undefined.
    const rawFogDensity = Number(o.fogDensity);
    const fogDensity: number | undefined = Number.isFinite(rawFogDensity)
      ? clampToSpec(PARAM.fogDensity, rawFogDensity)
      : undefined;

    // fogTint: a #rrggbb string. Validated with hexToRgb, the
    // same strict validator background's custom stops use — but only its
    // "did this parse" verdict matters here: unlike background/
    // customPalette/positionAxisColors, AppState stores the hex STRING
    // itself (not an RgbStop), so the parsed triple is discarded and the
    // original string survives. Absent or malformed decodes to undefined,
    // never rejecting the scene; fromSnapshot supplies DEFAULT_FOG_TINT.
    const fogTint: string | undefined =
      typeof o.fogTint === "string" && hexToRgb(o.fogTint) !== null
        ? o.fogTint
        : undefined;

    // fogTintStrength: same coerce/clamp/never-reject contract as
    // fogDensity just above. fromSnapshot supplies
    // DEFAULT_FOG_TINT_STRENGTH when this comes back undefined.
    const rawFogTintStrength = Number(o.fogTintStrength);
    const fogTintStrength: number | undefined = Number.isFinite(
      rawFogTintStrength,
    )
      ? clampToSpec(PARAM.fogTintStrength, rawFogTintStrength)
      : undefined;

    // groundPlane: same quiet-drop contract as balloonEcho above
    // — a real boolean or undefined, never a rejected scene. fromSnapshot
    // supplies `false` when this comes back undefined.
    const groundPlane: boolean | undefined =
      typeof o.groundPlane === "boolean" ? o.groundPlane : undefined;

    return {
      transforms,
      finalTransform,
      numPoints,
      pointSize,
      colorMode: colorMode as ColorMode,
      colorGamma,
      rampPaletteId,
      fourDColor,
      fourDDepthFade: Boolean(o.fourDDepthFade),
      renderStyle: renderStyle as RenderStyle,
      showGuides: Boolean(o.showGuides),
      flame,
      solid,
      surface,
      symmetry,
      glowBrightness,
      background,
      customPalette,
      positionAxisColors,
      camera,
      fourD,
      balloonEcho,
      balloonRadius,
      balloonTint,
      balloonTintStrength,
      fogDensity,
      fogTint,
      fogTintStrength,
      groundPlane,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Return the stored scene, or `null` if none exists. The URL hash takes
 * priority over localStorage — a pasted shared link beats the last local
 * session. If the hash is absent or invalid, falls back to localStorage.
 */
export function loadScene(deps?: PersistDeps): SceneSnapshot | null {
  const loc =
    deps?.location ??
    (typeof window !== "undefined" ? window.location : undefined);
  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined);

  if (loc?.hash) {
    const raw = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;
    const result = decodeScene(raw);
    if (result !== null) return result;
  }

  if (storage) {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved !== null) return decodeScene(saved);
  }

  return null;
}

/**
 * Persist the snapshot to the URL hash (silent `replaceState`, no new history
 * entry) and to localStorage. Guards for missing browser globals.
 */
export function saveScene(s: SceneSnapshot, deps?: PersistDeps): void {
  const encoded = encodeScene(s);

  // Keep the address bar share-ready without cluttering the back-button stack.
  const hist =
    deps?.history ?? (typeof history !== "undefined" ? history : undefined);
  if (hist) {
    try {
      hist.replaceState(null, "", "#" + encoded);
    } catch {
      // SecurityError in sandboxed / cross-origin iframes — ignore silently.
    }
  }

  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined);
  try {
    storage?.setItem(STORAGE_KEY, encoded);
  } catch {
    // QuotaExceededError / private-mode SecurityError — ignore silently,
    // matching viewer-prefs.ts's saveViewerPrefs.
  }
}

/** localStorage access throws in some private-browsing / sandboxed contexts. */
function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
