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
import type { ColorMode, Transform, Vec3 } from "../fractal/types";
import type { RenderStyle } from "./state";
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
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "fractal-viewer:scene";

/** Exact set of valid ColorMode values for strict validation of untrusted input. */
const VALID_COLOR_MODES = new Set<string>([
  "transform",
  "height",
  "radius",
  "position",
  "iterationAge",
  "uniform",
]);

/** Exact set of valid RenderStyle values. */
const VALID_RENDER_STYLES = new Set<string>([
  "depthFade",
  "aerial",
  "glow",
  "dof",
  "edl",
]);

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
    transforms: s.transforms.map(({ position, rotation, scale }) => ({
      position: position.map(round4),
      rotation: rotation.map(round4),
      scale: scale.map(round4),
    })),
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
      transforms.push({
        id: i,
        position: tf.position,
        rotation: tf.rotation,
        scale: tf.scale,
      });
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
