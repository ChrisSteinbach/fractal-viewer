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
import { COLOR_MODES, VARIATION_TYPES } from "../fractal/types";
import type {
  ColorMode,
  Transform,
  Variation,
  VariationType,
  Vec3,
} from "../fractal/types";
import { RENDER_STYLES } from "./state";
import type { AppState, RenderStyle } from "./state";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The persistent subset of AppState — everything needed to recreate the scene. */
export interface SceneSnapshot {
  transforms: Transform[];
  numPoints: number;
  pointSize: number;
  colorMode: ColorMode;
  renderStyle: RenderStyle;
  showGuides: boolean;
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
    numPoints: state.numPoints,
    pointSize: state.pointSize,
    colorMode: state.colorMode,
    renderStyle: state.renderStyle,
    showGuides: state.showGuides,
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

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * Produce a compact, URL-safe `v1=<base64url>` string for `s`. Floats are
 * rounded to 4 decimal places; transform ids are omitted and reassigned from
 * the array index on decode.
 */
export function encodeScene(s: SceneSnapshot): string {
  const payload = {
    transforms: s.transforms.map((t) => {
      // Only non-default weight is written, keeping uniform systems' URLs as
      // short as before (old links, which never had the field, still decode).
      const e: {
        position: number[];
        rotation: number[];
        scale: number[];
        weight?: number;
        shear?: number[];
        variations?: { type: VariationType; weight: number }[];
      } = {
        position: t.position.map(round4),
        rotation: t.rotation.map(round4),
        scale: t.scale.map(round4),
      };
      if (t.weight !== undefined && t.weight !== 1) e.weight = round4(t.weight);
      if (t.shear && t.shear.some((v) => v !== 0))
        e.shear = t.shear.map(round4);
      // Only inert-free variations are written: a zero weight is a no-op the
      // engine already ignores, so dropping it keeps affine URLs short and old
      // links (which never had the field) decoding unchanged.
      if (t.variations && t.variations.length > 0) {
        const active = t.variations
          .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
          .map((v) => ({ type: v.type, weight: round4(v.weight) }));
        if (active.length > 0) e.variations = active;
      }
      return e;
    }),
    numPoints: s.numPoints,
    pointSize: round4(s.pointSize),
    colorMode: s.colorMode,
    renderStyle: s.renderStyle,
    showGuides: s.showGuides,
  };
  return "v1=" + toBase64url(JSON.stringify(payload));
}

/**
 * Decode a raw `v1=<base64url>` string into a SceneSnapshot, or `null` for
 * anything malformed. This is the robustness boundary for untrusted input —
 * it must never throw.
 *
 * Validates strictly: requires the `v1=` prefix; 1..MAX_TRANSFORMS transforms
 * each with valid Vec3 fields; exact colorMode / renderStyle matches. Clamps
 * numPoints to [0, 500 000] and pointSize to [0.25, 4].
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
      const t: unknown = rawTransforms[i];
      if (typeof t !== "object" || t === null) return null;
      const tf = t as Record<string, unknown>;
      if (!isVec3(tf.position) || !isVec3(tf.rotation) || !isVec3(tf.scale))
        return null;
      // Safe: isVec3 verified these are valid Vec3 tuples.
      const decoded: Transform = {
        id: i,
        position: tf.position,
        rotation: tf.rotation,
        scale: tf.scale,
      };
      // weight: optional. Reject non-finite (malformed), clamp to a positive
      // range otherwise; absent stays undefined ⇒ uniform.
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
      // variations: optional. Present ⇒ an array (capped) of { type, weight }
      // with a known type and finite weight; weight is clamped, absent stays
      // undefined. Any malformed entry rejects the whole scene.
      if (tf.variations !== undefined) {
        const variations = decodeVariations(tf.variations);
        if (variations === null) return null;
        if (variations.length > 0) decoded.variations = variations;
      }
      transforms.push(decoded);
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

    return {
      transforms,
      numPoints,
      pointSize,
      colorMode: colorMode as ColorMode,
      renderStyle: renderStyle as RenderStyle,
      showGuides: Boolean(o.showGuides),
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
