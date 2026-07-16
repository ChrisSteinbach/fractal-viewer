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
  SYMMETRY_AXES,
  VARIATION_TYPES,
} from "../fractal/types";
import type {
  ColorMode,
  FourDColorMode,
  SymmetryAxis,
  SymmetryParams,
  Transform,
  Variation,
  VariationType,
  Vec3,
  WExtension,
} from "../fractal/types";
import {
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FOUR_D_COLOR,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SYMMETRY_AXIS,
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
  clampToSpec,
} from "./state";
import type { AppState, FlameParams, RenderStyle, SolidParams } from "./state";
import { clampPhi, clampRadius, type CameraPose } from "./orbit";
import type { FourDPose } from "./four-d-view";
import { normalizeRotorPair } from "./rotor4";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";
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
   * Color-contrast exponent (fr-8sk, see {@link AppState.colorGamma}).
   * Persists like `colorMode`/`renderStyle`/`glowBrightness` — always
   * present, not session-only.
   */
  colorGamma: number;
  /**
   * Ramp palette for the height/radius color modes (fr-3b6, see
   * {@link AppState.rampPaletteId}). Persists like `colorMode`/`colorGamma`
   * — always present in the snapshot; the decoder's quiet fallback for
   * absent/unknown values is `"legacy"` (see decodeScene).
   */
  rampPaletteId: PaletteSelection;
  /**
   * 4D projection color mode (fr-d47, see {@link AppState.fourDColor}).
   * Persists like `colorMode` — always present, not session-only (unlike the
   * tumble/slice view state, which never persists).
   */
  fourDColor: FourDColorMode;
  /**
   * 4D camera-depth fade toggle (fr-3e0, see {@link AppState.fourDDepthFade}).
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
  /**
   * Rotational/mirror symmetry (fr-6im, see {@link AppState.symmetry}).
   * Persists like `colorMode`/`renderStyle` — always present, unlike the
   * optional `finalTransform`.
   */
  symmetry: SymmetryParams;
  /**
   * Manual glow-brightness override (fr-8b1, see {@link AppState.glowBrightness}).
   * Persists like `colorMode`/`renderStyle`/`symmetry` — always present, not
   * session-only.
   */
  glowBrightness: number;
  /**
   * The one user-authored gradient slot (fr-55k, see
   * {@link AppState.customPalette}). Optional like `finalTransform` — absent
   * until a palette selection first lands on Custom — unlike the always-
   * present settings blocks above (`flame`/`solid`/`symmetry`/
   * `glowBrightness`).
   */
  customPalette?: CustomPalette;
  /**
   * The position mode's custom axis colors (fr-8k7, see
   * {@link AppState.positionAxisColors}). Optional like `customPalette` —
   * absent = the legacy XYZ→RGB mapping — and like it never worth rejecting
   * a scene over; see {@link decodePositionAxisColors}.
   */
  positionAxisColors?: PositionAxisColors;
  /**
   * Optional orbit-camera pose (fr-1k4): the view a saved/shared/collection
   * scene was framed with (see {@link CameraPose}). Optional like
   * `customPalette` — and DELIBERATELY absent from the ENCODED undo-history
   * snapshot STRING: `history.ts` dedupes checkpoints by comparing
   * `encodeScene` output with `===`, and even tiny camera drift between two
   * otherwise-identical states would defeat that dedup. `main.ts` (not this
   * module) attaches `camera` only when writing a persisted / shared /
   * collection document, never to an in-session undo checkpoint. (Undo/redo
   * across a whole-system replace DOES restore the pre-replace framing —
   * fr-uf3 — but carries that pose OUT OF BAND on `history.ts`'s
   * `HistoryEntry.pose`, never in this encoded string, precisely so the
   * dedup keeps comparing camera-less bytes.)
   */
  camera?: CameraPose;
  /**
   * Optional 4D view pose (fr-pnek): the tumble rotor + soft w-slice window
   * a saved/shared/collection scene was framed with (see {@link FourDPose})
   * — the 4D sibling of `camera` just above. Optional like `camera` — and
   * DELIBERATELY absent from the ENCODED undo-history snapshot STRING for
   * the same reason, only more so: `history.ts` dedupes checkpoints by
   * comparing `encodeScene` output with `===`, and the live rotor drifts
   * every tumble frame, which would defeat that dedup even harder than
   * camera drift would. `main.ts` (not this module) attaches `fourD` only
   * when writing a persisted / shared / collection document, and only while
   * the system is non-flat — never to an in-session undo checkpoint. Tumble
   * on/off + speed are deliberately NOT part of the pose — a viewer
   * PREFERENCE (fr-0ya), never document state; see `FourDPose`'s own doc
   * comment.
   */
  fourD?: FourDPose;
}

/** Injectable browser dependencies; both default to their `window.*` counterparts. */
export interface PersistDeps {
  location?: { hash: string };
  storage?: Pick<Storage, "getItem" | "setItem">;
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
    symmetry: state.symmetry,
    glowBrightness: state.glowBrightness,
    customPalette: state.customPalette,
    positionAxisColors: state.positionAxisColors,
  };
}

/**
 * Merge a restored snapshot over a base AppState (typically `initialState`),
 * overwriting exactly the persisted fields while leaving session-only state
 * (selection, autoUpdate, panel) from `base` intact. `camera` and `fourD`
 * (fr-pnek) are document-only fields with no `AppState` counterpart (they're
 * applied instead by `main.ts`'s boot/load call sites), so both are
 * explicitly destructured out and never spread. The rest stays the exact
 * inverse of `toSnapshot`, with nothing else to hand-sync.
 * `positionAxisColors` (fr-8k7) is read explicitly off `snapshot` rather than
 * relying on the `rest` spread, so its absence always clears `base`'s value
 * even when the incoming snapshot object never declares the key at all —
 * unlike `customPalette`, which only clears because `toSnapshot`/
 * `decodeScene` happen to always emit that key.
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

/** Exact set of valid FourDColorMode values (fr-d47). */
const VALID_FOUR_D_COLOR_MODES = new Set<string>(FOUR_D_COLOR_MODES);

/** Exact set of valid RenderStyle values. */
const VALID_RENDER_STYLES = new Set<string>(RENDER_STYLES);

/** Exact set of valid VariationType values. */
const VALID_VARIATION_TYPES = new Set<string>(VARIATION_TYPES);

/**
 * Exact set of valid BUILT-IN palette ids (see `palette.ts`'s
 * `FLAME_PALETTES`), shared by the flame (`flame.paletteId`) and solid
 * (`solid.paletteId`, fr-1kt) validators. Deliberately excludes
 * {@link CUSTOM_PALETTE_ID} (fr-55k): `"custom"` is only ever valid alongside
 * an actually-decoded `customPalette` payload, a condition this fixed set
 * can't express — `decodeFlameParams`/`decodeSolidParams` check for that
 * separately via their `hasCustomPalette` parameter.
 */
const VALID_PALETTE_IDS = new Set<string>(FLAME_PALETTE_IDS);

/** Exact set of valid SymmetryAxis values. */
const VALID_SYMMETRY_AXES = new Set<string>(SYMMETRY_AXES);

/**
 * Cap on variations per transform when decoding untrusted input. There are only
 * a dozen distinct warps, so this is generous headroom while still bounding what
 * a hand-crafted URL can allocate.
 */
const MAX_VARIATIONS = 32;

/** Reject wildly out-of-range blend weights from hand-crafted input; clamp the rest. */
const MAX_VARIATION_WEIGHT = 100;

/**
 * Sanity bound on each component of an untrusted `camera.target` (fr-1k4):
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
 * Validate one transform's untrusted `variations` field: an array (capped at
 * {@link MAX_VARIATIONS}) of `{ type, weight }` with a known {@link VariationType}
 * and a finite weight (clamped to ±{@link MAX_VARIATION_WEIGHT}). Returns the
 * parsed list, or `null` when anything is malformed so the caller rejects the
 * whole scene — matching how every other field guards untrusted input.
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
    variations.push({
      type: v.type as VariationType,
      weight: clamp(weight, -MAX_VARIATION_WEIGHT, MAX_VARIATION_WEIGHT),
    });
  }
  return variations;
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
 * (fr-icy — the editor expresses it as a magnitude slider plus a Mirror W
 * toggle, the 4D counterpart of the 3D scale channel's fr-lca treatment).
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
 * contract is spelled out inline below, in {@link WExtension}'s terms). Shared
 * by the transform list (id = array index) and the final transform (id = 0)
 * so neither can drift — including the `w` (4D lens) support this adds.
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
  return decoded;
}

/**
 * Validate the untrusted `customPalette` scene field (fr-55k): the one
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
 * Validate the untrusted `positionAxisColors` scene field (fr-8k7): the
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
 * Validate the untrusted `flame` render-settings block: like `finalTransform`,
 * an absent block, or an absent field within a present block, decodes
 * quietly to its default rather than rejecting the scene; but once a field
 * IS present, a malformed value rejects the whole scene, matching
 * `weight`/`shear`/`variations`. Finite values are clamped into range rather
 * than rejected, matching `weight`. `supersample` is additionally rounded to
 * an integer, matching `setFlameSupersample`; the estimator radii/curve are
 * NOT (continuous like gamma/vibrancy, matching their own setters).
 *
 * `paletteId` (fr-6us) is the one exception to the reject-on-malformed rule:
 * an unknown OR missing id decodes to {@link DEFAULT_FLAME_PALETTE} rather
 * than rejecting the scene, so a link carrying a palette this build doesn't
 * know keeps the rest of its scene instead of being thrown away over one
 * cosmetic field — the enum equivalent of the finite-but-out-of-range clamp
 * the numeric fields already use.
 *
 * `hasCustomPalette` (fr-55k) is the caller's answer to "did a valid
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
  // above) rather than rejecting the scene. "custom" (fr-55k) is accepted
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
 * Validate the untrusted `solid` render-settings block (fr-v4f), following
 * `decodeFlameParams`' presence rules exactly: an absent block — or an
 * absent field within a present block — decodes quietly to its default,
 * while a present-but-malformed (non-finite) value rejects the whole scene.
 * Finite values are clamped into range; `resolution` is additionally
 * snapped to the voxel step and `iterations` rounded, matching their
 * setters.
 *
 * `paletteId` (fr-1kt) is the one exception to the reject-on-malformed rule,
 * mirroring `flame.paletteId`: an unknown or missing id decodes to
 * {@link DEFAULT_SOLID_PALETTE} rather than rejecting the scene.
 * `hasCustomPalette` (fr-55k) extends that mirror exactly like
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

  // paletteId (fr-1kt): unknown or missing quietly becomes the default —
  // same quiet-fallback contract as flame.paletteId (see decodeFlameParams).
  // "custom" (fr-55k) is accepted only alongside a valid decoded
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
 * Validate the untrusted `symmetry` block (fr-6im). Unlike `flame`/`solid`, a
 * malformed field never rejects the whole scene: `order` coerces and clamps
 * (an out-of-range or non-finite request quietly becomes the nearest valid
 * value, the same spirit as `weight`'s clamp) and an unrecognized/missing
 * `axis` quietly becomes `"y"` (the same quiet-fallback `flame.paletteId`
 * uses for an unknown enum, generalized to this field too) — a kaleidoscope
 * order/axis is cosmetic geometry, not a value worth losing an otherwise-
 * valid shared link over. An absent block, or a block missing a field,
 * defaults quietly to `{ order: 1, axis: "y" }`; order 1 is the
 * unreplicated system.
 */
function decodeSymmetry(raw: unknown): SymmetryParams {
  if (typeof raw !== "object" || raw === null) {
    return { order: PARAM.symmetryOrder.default, axis: DEFAULT_SYMMETRY_AXIS };
  }
  const s = raw as Record<string, unknown>;

  let order = PARAM.symmetryOrder.default;
  const rawOrder = Number(s.order);
  if (Number.isFinite(rawOrder)) order = rawOrder;

  const axis: SymmetryAxis =
    typeof s.axis === "string" && VALID_SYMMETRY_AXES.has(s.axis)
      ? (s.axis as SymmetryAxis)
      : DEFAULT_SYMMETRY_AXIS;

  return {
    order: clampToSpec(PARAM.symmetryOrder, order),
    axis,
  };
}

/**
 * Validate the untrusted `camera` scene field (fr-1k4): the orbit-camera
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
 * Validate the untrusted `fourD` scene field (fr-pnek): the 4D view pose a
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

  return {
    pair,
    sliceOn: Boolean(f.sliceOn),
    sliceCenter: clamp(sliceCenter, -1, 1),
    sliceRelColor: Boolean(f.sliceRelColor),
  };
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * The compact wire form of one transform: `id` dropped, floats rounded. `w`
 * mirrors {@link WExtension} field-for-field (same optional sub-object
 * shape) — see `encodeTransform`'s canonicalization rule for when it's
 * present at all.
 */
interface EncodedTransform {
  position: number[];
  rotation: number[];
  scale: number[];
  weight?: number;
  shear?: number[];
  variations?: { type: VariationType; weight: number }[];
  w?: WExtension;
}

/**
 * Encode one transform's persistent fields, dropping inert data so URLs stay
 * short: `id` (reassigned on decode), a weight of 1, an all-zero shear, and
 * zero-weight variations are all omitted. Shared by the transform list and
 * the final transform so their wire forms can't drift.
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
 */
function encodeTransform(t: Transform): EncodedTransform {
  const e: EncodedTransform = {
    position: t.position.map(round4),
    rotation: t.rotation.map(round4),
    scale: t.scale.map(round4),
  };
  if (t.weight !== undefined && t.weight !== 1) e.weight = round4(t.weight);
  if (t.shear && t.shear.some((v) => v !== 0)) e.shear = t.shear.map(round4);
  if (t.variations && t.variations.length > 0) {
    const active = t.variations
      .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
      .map((v) => ({ type: v.type, weight: round4(v.weight) }));
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
    symmetry: SymmetryParams;
    glowBrightness: number;
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
    // Always written, like colorGamma above (fr-3b6) — even while a color
    // mode it doesn't affect is active, where it is inert exactly the way
    // colorGamma is.
    rampPaletteId: s.rampPaletteId,
    // Always written for the same reason — even for a flat system, where it
    // is inert exactly the way colorMode is inert for a non-flat one.
    fourDColor: s.fourDColor,
    // Always written, exactly like fourDColor above (fr-3e0).
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
    symmetry: {
      order: Math.round(s.symmetry.order),
      axis: s.symmetry.axis,
    },
    // Always written, like symmetry — a small, always-present setting, not a
    // per-transform optional feature like finalTransform/weight/shear.
    glowBrightness: round4(s.glowBrightness),
  };
  // Written only when present, so lens-free systems keep their short URLs.
  if (s.finalTransform)
    payload.finalTransform = encodeTransform(s.finalTransform);
  // Written only when present, like finalTransform above — never-authored
  // scenes keep their short URLs. Encoded as hex strings (fr-55k) for URL
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
  // Written only when present, like camera above (fr-pnek) — an undo-history
  // snapshot (which never carries a 4D pose either — see SceneSnapshot.fourD's
  // doc) stays byte-identical. Wire form flattens the rotor pair to p/q (URL
  // compactness — no nested `pair` object). Quaternion components +
  // sliceCenter are rounded to 4 decimals like every other float in this
  // file: the resulting angle error is far below visibility, and the decoder
  // renormalizes the pair anyway.
  if (s.fourD) {
    payload.fourD = {
      p: s.fourD.pair.p.map(round4),
      q: s.fourD.pair.q.map(round4),
      sliceOn: s.fourD.sliceOn,
      sliceCenter: round4(s.fourD.sliceCenter),
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
 * rampPaletteId (fr-3b6) follows the identical quiet-fallback shape at the
 * top level, falling back to {@link DEFAULT_RAMP_PALETTE} instead. Likewise,
 * symmetry.order clamps to [{@link MIN_SYMMETRY_ORDER},
 * {@link MAX_SYMMETRY_ORDER}] and an
 * unrecognized/missing symmetry.axis falls back to `"y"` — neither ever
 * rejects the scene on malformed input (see {@link decodeSymmetry}). Same
 * spirit for glowBrightness: it clamps to [{@link MIN_GLOW_BRIGHTNESS},
 * {@link MAX_GLOW_BRIGHTNESS}], falling back to
 * {@link DEFAULT_GLOW_BRIGHTNESS} when absent or non-finite rather than
 * rejecting the scene. colorGamma (fr-8sk) follows the identical contract:
 * clamps to [{@link MIN_COLOR_GAMMA}, {@link MAX_COLOR_GAMMA}], falling back
 * to {@link DEFAULT_COLOR_GAMMA} when absent or non-finite rather than
 * rejecting the scene. fourDColor (fr-d47) is enum-shaped like symmetry.axis
 * and shares its quiet fallback: absent or unrecognized values become
 * {@link DEFAULT_FOUR_D_COLOR}, never a rejection. fourDDepthFade (fr-3e0)
 * follows showGuides's boolean-coercion contract: any truthy value is on,
 * and absent coerces to off — the default.
 *
 * customPalette (fr-55k) is the one user-authored gradient slot: optional
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
 * positionAxisColors (fr-8k7) follows the identical quiet-fallback contract:
 * absent or malformed decodes to `undefined` — the legacy axis mapping —
 * never a rejection.
 *
 * camera (fr-1k4) is the optional orbit-camera pose (see {@link CameraPose}).
 * Its policy is stricter than customPalette's in one way (no `Number(x)`
 * string coercion — see {@link decodeCameraPose}) but the same in spirit:
 * absent or malformed NEVER rejects the scene, it just decodes to
 * `undefined`, same as customPalette above.
 *
 * fourD (fr-pnek) is the optional 4D view pose — the tumble rotor plus the
 * soft w-slice window (see {@link FourDPose}), the 4D sibling of `camera`
 * just above. Same policy as `camera`, including its stricter no-coercion
 * stance on the numeric fields (see {@link decodeFourDPose}): absent or
 * malformed never rejects the scene, it just decodes to `undefined`.
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

    // customPalette (fr-55k): decoded BEFORE flame/solid so their paletteId
    // logic can tell whether a "custom" selection actually has a payload to
    // back it. Never rejects the scene — see decodeCustomPalette.
    const customPalette = decodeCustomPalette(o.customPalette);

    // positionAxisColors (fr-8k7): the position color mode's custom axis
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

    // symmetry: never rejects — a missing block or malformed field quietly
    // falls back to its default. See decodeSymmetry.
    const symmetry = decodeSymmetry(o.symmetry);

    // glowBrightness (fr-8b1): manual override on top of the glow render's
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

    // colorGamma (fr-8sk): color-contrast exponent for the height/radius/
    // position color modes (see color.ts's colorModeUsesGamma). Same
    // never-rejects contract as glowBrightness just above — a contrast tweak
    // is cosmetic, not worth losing a shared link over.
    let colorGamma = PARAM.colorGamma.default;
    const rawColorGamma = Number(o.colorGamma);
    if (Number.isFinite(rawColorGamma)) colorGamma = rawColorGamma;
    colorGamma = clampToSpec(PARAM.colorGamma, colorGamma);

    // fourDColor (fr-d47): how the 4D projection colors points. Same quiet-
    // fallback contract as symmetry.axis / flame.paletteId, NOT colorMode's
    // strict reject: an absent or unrecognized value falls back to the
    // default blue/orange ramp — a 4D palette choice is cosmetic, not worth
    // losing an otherwise-valid shared link over.
    const fourDColor: FourDColorMode =
      typeof o.fourDColor === "string" &&
      VALID_FOUR_D_COLOR_MODES.has(o.fourDColor)
        ? (o.fourDColor as FourDColorMode)
        : DEFAULT_FOUR_D_COLOR;

    // rampPaletteId (fr-3b6): the height/radius ramps' gradient palette. The
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

    // camera (fr-1k4): the optional orbit-camera pose. Never rejects the
    // scene — a malformed or absent value quietly decodes to undefined,
    // exactly like customPalette above. See decodeCameraPose.
    const camera = decodeCameraPose(o.camera);

    // fourD (fr-pnek): the optional 4D view pose (tumble rotor + soft
    // w-slice). Never rejects the scene — a malformed or absent value
    // quietly decodes to undefined, exactly like camera above. See
    // decodeFourDPose.
    const fourD = decodeFourDPose(o.fourD);

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
      symmetry,
      glowBrightness,
      customPalette,
      positionAxisColors,
      camera,
      fourD,
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
  if (typeof history !== "undefined") {
    try {
      history.replaceState(null, "", "#" + encoded);
    } catch {
      // SecurityError in sandboxed / cross-origin iframes — ignore silently.
    }
  }

  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined);
  storage?.setItem(STORAGE_KEY, encoded);
}

/** localStorage access throws in some private-browsing / sandboxed contexts. */
function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
