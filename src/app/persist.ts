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
import { FLAME_PALETTE_IDS } from "../fractal/palette";
import type { FlamePaletteId } from "../fractal/palette";
import { COLOR_MODES, VARIATION_TYPES } from "../fractal/types";
import type {
  ColorMode,
  Transform,
  Variation,
  VariationType,
  Vec3,
} from "../fractal/types";
import {
  DEFAULT_ESTIMATOR_CURVE,
  DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
  DEFAULT_ESTIMATOR_RADIUS,
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_MINIMUM_RADIUS,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FLAME_VIBRANCY,
  MAX_SOLID_AMBIENT,
  MAX_SOLID_ITERATIONS,
  MAX_SOLID_LIGHT_AZIMUTH,
  MAX_SOLID_LIGHT_ELEVATION,
  MAX_SOLID_RESOLUTION,
  MAX_SOLID_THRESHOLD,
  MIN_ESTIMATOR_CURVE,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_ESTIMATOR_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_GAMMA,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_SUPERSAMPLE,
  MIN_FLAME_VIBRANCY,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_LIGHT_AZIMUTH,
  MIN_SOLID_LIGHT_ELEVATION,
  MIN_SOLID_RESOLUTION,
  MIN_SOLID_THRESHOLD,
  RENDER_STYLES,
} from "./state";
import type { AppState, FlameParams, RenderStyle, SolidParams } from "./state";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";

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
  renderStyle: RenderStyle;
  showGuides: boolean;
  /**
   * Flame render-current-view settings (see {@link AppState.flame}). Note
   * `AppState.flameActive` is intentionally NOT part of this snapshot — the
   * app always boots into the explorer, never straight into a render.
   */
  flame: FlameParams;
  /** Solid render settings (see {@link AppState.solid}); like `flame`,
   * `solidActive` is intentionally NOT part of this snapshot. */
  solid: SolidParams;
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
    renderStyle: state.renderStyle,
    showGuides: state.showGuides,
    flame: state.flame,
    solid: state.solid,
  };
}

/**
 * Merge a restored snapshot over a base AppState (typically `initialState`),
 * overwriting exactly the persisted fields while leaving session-only state
 * (selection, autoUpdate, panel) from `base` intact. `SceneSnapshot` is a
 * structural subset of `AppState`, so the spread needs no field list of its
 * own — it stays the exact inverse of `toSnapshot` with nothing to hand-sync.
 */
export function fromSnapshot(
  snapshot: SceneSnapshot,
  base: AppState,
): AppState {
  return { ...base, ...snapshot };
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

/** Exact set of valid RenderStyle values. */
const VALID_RENDER_STYLES = new Set<string>(RENDER_STYLES);

/** Exact set of valid VariationType values. */
const VALID_VARIATION_TYPES = new Set<string>(VARIATION_TYPES);

/** Exact set of valid flame palette ids (see `palette.ts`'s `FLAME_PALETTES`). */
const VALID_FLAME_PALETTES = new Set<string>(FLAME_PALETTE_IDS);

/**
 * Cap on variations per transform when decoding untrusted input. There are only
 * a dozen distinct warps, so this is generous headroom while still bounding what
 * a hand-crafted URL can allocate.
 */
const MAX_VARIATIONS = 32;

/** Reject wildly out-of-range blend weights from hand-crafted input; clamp the rest. */
const MAX_VARIATION_WEIGHT = 100;

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
      weight: Math.max(
        -MAX_VARIATION_WEIGHT,
        Math.min(MAX_VARIATION_WEIGHT, weight),
      ),
    });
  }
  return variations;
}

/**
 * Validate one untrusted transform into a {@link Transform} with the given `id`,
 * or `null` when anything is malformed so the caller rejects the whole scene.
 * Requires three valid Vec3 fields; `weight` / `shear` / `variations` are
 * optional and validated exactly as they encode. Shared by the transform list
 * (id = array index) and the final transform (id = 0) so neither can drift.
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
    decoded.weight = Math.max(0.0001, Math.min(10000, w));
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
  return decoded;
}

/**
 * Validate the untrusted `flame` render-settings block. `flame` predates
 * this feature's rollout (and `gamma`/`vibrancy`/`supersample` predate
 * fr-ucs's rollout within it, and `estimatorRadius`/`estimatorMinimumRadius`/
 * `estimatorCurve` predate fr-17t's within it) in exactly zero existing
 * links, so — like `finalTransform` — an absent block, or an absent field
 * within a present block, decodes quietly to its default rather than
 * rejecting the scene; but once a field IS present, a malformed value
 * rejects the whole scene, matching `weight`/`shear`/`variations`. Finite
 * values are clamped into range rather than rejected, matching `weight`.
 * `supersample` is additionally rounded to an integer, matching
 * `setFlameSupersample`; the estimator radii/curve are NOT (continuous like
 * gamma/vibrancy, matching their own setters).
 *
 * `paletteId` (fr-6us) is the one exception to the reject-on-malformed rule:
 * an unknown OR missing id decodes to `"legacy"` rather than rejecting the
 * scene, so a link written by a future build carrying a palette this build
 * doesn't know keeps the rest of its scene instead of being thrown away over
 * one cosmetic field — the enum equivalent of the finite-but-out-of-range
 * clamp the numeric fields already use.
 */
function decodeFlameParams(raw: unknown): FlameParams | null {
  if (raw === undefined) {
    return {
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      paletteId: DEFAULT_FLAME_PALETTE,
    };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;

  const exposure = Number(f.exposure);
  const iterations = Number(f.iterations);
  if (!Number.isFinite(exposure) || !Number.isFinite(iterations)) return null;

  // gamma/vibrancy/supersample/estimatorRadius/estimatorMinimumRadius/
  // estimatorCurve: each optional independently (an fr-o7s-era link carries
  // none of them), so an absent field defaults quietly while a
  // present-but-malformed one rejects the whole scene, same as exposure just
  // above — the three feature rollouts share one block but not one presence
  // rule per field.
  let gamma = DEFAULT_FLAME_GAMMA;
  if (f.gamma !== undefined) {
    gamma = Number(f.gamma);
    if (!Number.isFinite(gamma)) return null;
  }
  let vibrancy = DEFAULT_FLAME_VIBRANCY;
  if (f.vibrancy !== undefined) {
    vibrancy = Number(f.vibrancy);
    if (!Number.isFinite(vibrancy)) return null;
  }
  let supersample = DEFAULT_FLAME_SUPERSAMPLE;
  if (f.supersample !== undefined) {
    supersample = Number(f.supersample);
    if (!Number.isFinite(supersample)) return null;
  }
  let estimatorRadius = DEFAULT_ESTIMATOR_RADIUS;
  if (f.estimatorRadius !== undefined) {
    estimatorRadius = Number(f.estimatorRadius);
    if (!Number.isFinite(estimatorRadius)) return null;
  }
  let estimatorMinimumRadius = DEFAULT_ESTIMATOR_MINIMUM_RADIUS;
  if (f.estimatorMinimumRadius !== undefined) {
    estimatorMinimumRadius = Number(f.estimatorMinimumRadius);
    if (!Number.isFinite(estimatorMinimumRadius)) return null;
  }
  let estimatorCurve = DEFAULT_ESTIMATOR_CURVE;
  if (f.estimatorCurve !== undefined) {
    estimatorCurve = Number(f.estimatorCurve);
    if (!Number.isFinite(estimatorCurve)) return null;
  }
  // paletteId: unknown or missing quietly becomes "legacy" (see the doc above)
  // rather than rejecting the scene.
  const paletteId: FlamePaletteId =
    typeof f.paletteId === "string" && VALID_FLAME_PALETTES.has(f.paletteId)
      ? (f.paletteId as FlamePaletteId)
      : DEFAULT_FLAME_PALETTE;

  return {
    exposure: Math.max(
      MIN_FLAME_EXPOSURE,
      Math.min(MAX_FLAME_EXPOSURE, exposure),
    ),
    iterations: Math.round(
      Math.max(
        MIN_FLAME_ITERATIONS,
        Math.min(MAX_FLAME_ITERATIONS, iterations),
      ),
    ),
    gamma: Math.max(MIN_FLAME_GAMMA, Math.min(MAX_FLAME_GAMMA, gamma)),
    vibrancy: Math.max(
      MIN_FLAME_VIBRANCY,
      Math.min(MAX_FLAME_VIBRANCY, vibrancy),
    ),
    supersample: Math.round(
      Math.max(
        MIN_FLAME_SUPERSAMPLE,
        Math.min(MAX_FLAME_SUPERSAMPLE, supersample),
      ),
    ),
    estimatorRadius: Math.max(
      MIN_ESTIMATOR_RADIUS,
      Math.min(MAX_ESTIMATOR_RADIUS, estimatorRadius),
    ),
    estimatorMinimumRadius: Math.max(
      MIN_ESTIMATOR_MINIMUM_RADIUS,
      Math.min(MAX_ESTIMATOR_MINIMUM_RADIUS, estimatorMinimumRadius),
    ),
    estimatorCurve: Math.max(
      MIN_ESTIMATOR_CURVE,
      Math.min(MAX_ESTIMATOR_CURVE, estimatorCurve),
    ),
    paletteId,
  };
}

/**
 * Validate the untrusted `solid` render-settings block (fr-v4f), following
 * `decodeFlameParams`' presence rules exactly: the block predates its own
 * rollout in every existing link, so an absent block — or an absent field
 * within a present block — decodes quietly to its default, while a
 * present-but-malformed (non-finite) value rejects the whole scene. Finite
 * values are clamped into range; `resolution` is additionally snapped to the
 * voxel step and `iterations` rounded, matching their setters.
 */
function decodeSolidParams(raw: unknown): SolidParams | null {
  const defaults: SolidParams = {
    resolution: DEFAULT_SOLID_RESOLUTION,
    iterations: DEFAULT_SOLID_ITERATIONS,
    threshold: DEFAULT_SOLID_THRESHOLD,
    lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
    lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
    ambient: DEFAULT_SOLID_AMBIENT,
  };
  if (raw === undefined) return defaults;
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;

  const out = { ...defaults };
  const numeric: (keyof SolidParams)[] = [
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

  return {
    resolution: Math.max(
      MIN_SOLID_RESOLUTION,
      Math.min(
        MAX_SOLID_RESOLUTION,
        Math.round(out.resolution / VOXEL_RESOLUTION_STEP) *
          VOXEL_RESOLUTION_STEP,
      ),
    ),
    iterations: Math.round(
      Math.max(
        MIN_SOLID_ITERATIONS,
        Math.min(MAX_SOLID_ITERATIONS, out.iterations),
      ),
    ),
    threshold: Math.max(
      MIN_SOLID_THRESHOLD,
      Math.min(MAX_SOLID_THRESHOLD, out.threshold),
    ),
    lightAzimuth: Math.max(
      MIN_SOLID_LIGHT_AZIMUTH,
      Math.min(MAX_SOLID_LIGHT_AZIMUTH, out.lightAzimuth),
    ),
    lightElevation: Math.max(
      MIN_SOLID_LIGHT_ELEVATION,
      Math.min(MAX_SOLID_LIGHT_ELEVATION, out.lightElevation),
    ),
    ambient: Math.max(
      MIN_SOLID_AMBIENT,
      Math.min(MAX_SOLID_AMBIENT, out.ambient),
    ),
  };
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/** The compact wire form of one transform: `id` dropped, floats rounded. */
interface EncodedTransform {
  position: number[];
  rotation: number[];
  scale: number[];
  weight?: number;
  shear?: number[];
  variations?: { type: VariationType; weight: number }[];
}

/**
 * Encode one transform's persistent fields, dropping inert data so URLs stay
 * short and old links decode unchanged: `id` (reassigned on decode), a weight
 * of 1, an all-zero shear, and zero-weight variations are all omitted. Shared
 * by the transform list and the final transform so their wire forms can't drift.
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
    renderStyle: RenderStyle;
    showGuides: boolean;
    flame: FlameParams;
    solid: SolidParams;
  } = {
    transforms: s.transforms.map(encodeTransform),
    numPoints: s.numPoints,
    pointSize: round4(s.pointSize),
    colorMode: s.colorMode,
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
    },
  };
  // Written only when present, so old links stay byte-identical (they never
  // carried the field) and lens-free systems keep their short URLs.
  if (s.finalTransform)
    payload.finalTransform = encodeTransform(s.finalTransform);
  return "v1=" + toBase64url(JSON.stringify(payload));
}

/**
 * Decode a raw `v1=<base64url>` string into a SceneSnapshot, or `null` for
 * anything malformed. This is the robustness boundary for untrusted input —
 * it must never throw.
 *
 * Validates strictly: requires the `v1=` prefix; 1..MAX_TRANSFORMS transforms
 * each with valid Vec3 fields; an optional finalTransform validated the same
 * way; exact colorMode / renderStyle matches. Clamps numPoints to [0, 500 000],
 * pointSize to [0.25, 4], flame.exposure to [{@link MIN_FLAME_EXPOSURE},
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
 * to `"legacy"` (see {@link decodeFlameParams}).
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

    // numPoints: coerce, reject non-finite, clamp to [0, 500 000]. ------------
    const rawNumPoints = Number(o.numPoints);
    if (!Number.isFinite(rawNumPoints)) return null;
    const numPoints = Math.max(0, Math.min(500_000, rawNumPoints));

    // pointSize: coerce, reject non-finite, clamp to [0.25, 4]. ---------------
    const rawPointSize = Number(o.pointSize);
    if (!Number.isFinite(rawPointSize)) return null;
    const pointSize = Math.max(0.25, Math.min(4, rawPointSize));

    // flame/solid: absent (an old link) defaults quietly; present-but-
    // malformed rejects the whole scene. See decodeFlameParams /
    // decodeSolidParams.
    const flame = decodeFlameParams(o.flame);
    if (flame === null) return null;
    const solid = decodeSolidParams(o.solid);
    if (solid === null) return null;

    return {
      transforms,
      finalTransform,
      numPoints,
      pointSize,
      colorMode: colorMode as ColorMode,
      renderStyle: renderStyle as RenderStyle,
      showGuides: Boolean(o.showGuides),
      flame,
      solid,
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
