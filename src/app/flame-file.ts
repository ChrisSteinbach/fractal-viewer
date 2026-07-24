/**
 * The flam3/Apophysis `.flame` XML codec (fr-8uy5) — file interop with the
 * wider fractal-flame ecosystem, sitting beside `scene-file.ts`'s JSON
 * envelope as a second import/export format.
 *
 * The mapping is exact where the vocabularies genuinely coincide, and an
 * explicit, warned approximation where they don't — see
 * `docs/flame-interop.md` for the full correspondence table. The load-bearing
 * facts:
 *
 *  - A flame xform's `coefs="a b c d e f"` applies `x' = a·x + c·y + e`,
 *    `y' = b·x + d·y + f` (column order, like an SVG matrix). Our
 *    {@link Transform} parameterizes the FULL 2D affine group through
 *    `M = R·diag(scale)·U` (rotation + per-axis scale + shear), so any coefs
 *    matrix imports EXACTLY via QR decomposition — θ from the first column,
 *    per-axis scales, and the one in-plane shear component. Imported maps pin
 *    `scale.z = 0` (and every z field to 0), so the orbit lives in the
 *    `z = 0` plane where our 3D variation lifts reproduce flam3's planar
 *    formulas bit-for-bit.
 *  - Our twelve {@link VARIATION_TYPES} ARE flam3 variation names, with
 *    matching formulas at `z = 0` and the same unnormalized weighted-sum
 *    blend (`variations.ts`'s `composeVariations` ≡ flam3's variation sum),
 *    so variation lists pass through by name in both directions.
 *  - flam3's `<finalxform>` is a plot-time lens that never feeds back into
 *    the orbit — exactly our `finalTransform`.
 *
 * Import (`decodeFlameFile`) is a never-throwing trust boundary in the same
 * mold as `scene-file.ts`'s `decodeImportFile`: anything unusable becomes
 * `null` (not a flame file at all) or a dropped flame with a warning, never
 * an exception. Every `encoded` string it returns has been round-tripped
 * through `decodeScene` and found loadable. Unsupported flam3 features
 * (xaos, post on a nonlinear xform, variations we don't implement) degrade
 * with human-readable warnings rather than rejecting the file.
 *
 * Export (`encodeFlameFile`) writes the system's XY shadow: exact for z-flat
 * systems — including anything imported from a `.flame` in the first place —
 * and a warned flattening for genuinely 3D/4D ones. Kaleidoscope copies are
 * baked into explicit xforms (composed into `coefs` for affine maps, a
 * `post` rotation for nonlinear ones), which is also how flam3's own
 * symmetry macro materializes.
 *
 * DOM note: this module uses `DOMParser`, so unlike `scene-file.ts` it is
 * browser-tied (tests run under jsdom); that is why it lives in `src/app/`
 * and not the dependency-free `src/fractal/`.
 */
import { composeAffine, rotationMatrixXYZ } from "../fractal/affine";
import { isFlatTransform } from "../fractal/affine4";
import {
  MAX_TRANSFORMS,
  effectiveSymmetryOrder,
  runChaosGame,
} from "../fractal/chaos-game";
import { transformColors } from "../fractal/color";
import {
  CUSTOM_PALETTE_ID,
  MAX_CUSTOM_PALETTE_STOPS,
  buildPaletteLUT,
  resolvePalette,
} from "../fractal/palette";
import type { CustomPalette, RgbStop } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import { VARIATION_TYPES } from "../fractal/types";
import type {
  SymmetryAxis,
  Transform,
  Variation,
  VariationType,
} from "../fractal/types";
import { COLLECTION_CAP } from "./collection";
import { decodeScene, encodeScene, toSnapshot } from "./persist";
import type { SceneSnapshot } from "./persist";
import { PARAM, clampToSpec, initialState } from "./state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One flame successfully decoded from a `.flame` file. */
export interface DecodedFlameScene {
  /** The flame's `name` attribute, or a positional fallback. */
  name: string;
  /**
   * A `persist.ts` wire string, verified loadable (`decodeScene` accepted
   * it) — ready for the exact load/merge paths JSON imports use.
   */
  encoded: string;
}

/** `decodeFlameFile`'s success shape. `scenes` may be empty (the file IS a
 * flame file, but nothing in it was usable — see the per-flame warnings). */
export interface DecodedFlameFile {
  scenes: DecodedFlameScene[];
  /** Human-readable notes on anything skipped or approximated, deduplicated. */
  warnings: string[];
}

/** `encodeFlameFile`'s result: the XML text plus fidelity warnings. */
export interface FlameFileExport {
  xml: string;
  /** Human-readable notes on anything the 2D projection loses, deduplicated. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Our variation names — which are exactly flam3's attribute names. */
const VARIATION_NAMES = new Set<string>(VARIATION_TYPES);

/**
 * Standard xform attributes that are NOT variation weights and need no
 * warning when skipped: either handled elsewhere in this module (`weight`,
 * `coefs`, `post`, `opacity`, `chaos`) or genuinely inert for us (color
 * blending speed, animation flags, editor labels). Anything outside this
 * set and {@link VARIATION_NAMES} is reported as an unsupported feature.
 */
const KNOWN_XFORM_ATTRS = new Set([
  "weight",
  "color",
  "symmetry",
  "color_speed",
  "coefs",
  "post",
  "opacity",
  "animate",
  "name",
  "plotmode",
  "chaos",
  "var_color",
  "motion_frequency",
  "motion_offset",
]);

/** Mirror of `persist.ts`'s variation-weight clamp, applied at build time so
 * the snapshot we encode is exactly what `decodeScene` would keep. */
const MAX_VARIATION_WEIGHT = 100;

/** Mirror of `persist.ts`'s transform-weight clamp. */
const MIN_XFORM_WEIGHT = 0.0001;
const MAX_XFORM_WEIGHT = 10000;

/** Below this first-column length the QR decomposition treats the column as
 * zero: `persist.ts` rounds to 4 decimals, so finer structure cannot survive
 * the encode anyway. */
const DEGENERATE_COLUMN = 1e-4;

/** Exported image framing: flam3's `size`, and the fit margin around the
 * probe's trimmed bounds. */
const EXPORT_SIZE = 1024;
const EXPORT_MARGIN = 1.15;

/** flam3's default `brightness` is 4 and our default `exposure` is 1, so the
 * two tone-map scales exchange through this factor. */
const BRIGHTNESS_PER_EXPOSURE = 4;

/** Seed for the export framing probe — any fixed value keeps exports stable. */
const PROBE_SEED = 0x5eed;
const PROBE_POINTS = 4096;
/** Trim ratio for the framing probe's bounds — same rationale as
 * `framing-bounds.ts`: a nonlinear variation's sparse flung points shouldn't
 * inflate the frame. Deliberately its own constant, like `voxel.ts`'s. */
const PROBE_TRIM = 0.02;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Format a number for XML output: 6 decimals, no trailing zeros, no `-0`. */
function fmt(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Escape a string for use inside a double-quoted XML attribute. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Parse an attribute as a finite number, or `undefined`. */
function attrNumber(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (raw === null) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A 2D affine map in flam3's own reading of `coefs="a b c d e f"`:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
interface Coefs2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY_COEFS: Coefs2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Parse a 6-number attribute (`coefs`/`post`) or `null` when malformed. */
function parseCoefs(raw: string): Coefs2D | null {
  const parts = raw.trim().split(/\s+/).map(Number.parseFloat);
  if (parts.length !== 6 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [a, b, c, d, e, f] = parts;
  return { a, b, c, d, e, f };
}

/** Compose two {@link Coefs2D} as maps: `first`, then `second` — i.e.
 * `second(first(p))`. Used to fold a `post` matrix onto a purely affine
 * xform, where the composition is exact. */
function composeCoefs(second: Coefs2D, first: Coefs2D): Coefs2D {
  // Linear blocks (row-major [[a, c], [b, d]]): S·F.
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

function isIdentityCoefs(m: Coefs2D): boolean {
  return (
    m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
  );
}

/**
 * QR-decompose a {@link Coefs2D} onto our `Transform` parameterization:
 * `M = R(θ)·diag(sx, sy)·U(k)` with `U` the unit upper-triangular in-plane
 * shear — exactly what `composeAffine` re-composes for a
 * `rotation [0, 0, θ] / scale [sx, sy, ·] / shear [k, 0, 0]` transform, so
 * the import is exact (up to `persist.ts`'s 4-decimal rounding).
 *
 * Degenerate first column (`|col0| < DEGENERATE_COLUMN`): the shear carries
 * no information (`k·sx ≈ 0`), so θ is taken from the second column instead
 * — `R(θ)·diag(0, sy)` spans every rank-≤1 matrix with a zero first column
 * exactly.
 */
function decomposeCoefs(m: Coefs2D): {
  rotation: number;
  scaleX: number;
  scaleY: number;
  shear: number;
} {
  const colLen = Math.hypot(m.a, m.b);
  if (colLen < DEGENERATE_COLUMN) {
    return {
      rotation: m.c === 0 && m.d === 0 ? 0 : Math.atan2(-m.c, m.d),
      scaleX: 0,
      scaleY: Math.hypot(m.c, m.d),
      shear: 0,
    };
  }
  const rotation = Math.atan2(m.b, m.a);
  const det = m.a * m.d - m.b * m.c;
  return {
    rotation,
    scaleX: colLen,
    scaleY: det / colLen,
    shear: (m.a * m.c + m.b * m.d) / (colLen * colLen),
  };
}

/** Multiply two row-major 3x3 matrices: `A·B`. */
function mul3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** The rotation matrix of one kaleidoscope copy (`chaos-game.ts`'s
 * `symmetryRotation`, reproduced via the same one-axis Euler call). */
function symmetryRotation(axis: SymmetryAxis, angle: number): number[] {
  switch (axis) {
    case "x":
      return rotationMatrixXYZ(angle, 0, 0);
    case "y":
      return rotationMatrixXYZ(0, angle, 0);
    case "z":
      return rotationMatrixXYZ(0, 0, angle);
  }
}

// ---------------------------------------------------------------------------
// Import: .flame XML -> encoded scenes
// ---------------------------------------------------------------------------

/** One xform's imported pieces, before system-level weight normalization. */
interface ImportedXform {
  transform: Transform;
  weight: number;
}

/**
 * Convert one `<xform>`/`<finalxform>` element to a {@link Transform}, or
 * `null` to skip it (malformed coefs; non-positive weight on a base xform).
 * Feature losses are reported into `warnings`/`ignoredAttrs` rather than
 * failing the xform.
 */
function xformToTransform(
  el: Element,
  id: number,
  isFinal: boolean,
  warnings: Set<string>,
  ignoredAttrs: Set<string>,
): ImportedXform | null {
  const rawCoefs = el.getAttribute("coefs");
  let coefs = rawCoefs === null ? IDENTITY_COEFS : parseCoefs(rawCoefs);
  if (coefs === null) {
    warnings.add("Skipped a transform with malformed coefficients");
    return null;
  }

  let weight = 1;
  if (!isFinal) {
    const w = attrNumber(el, "weight");
    if (w !== undefined) weight = w;
    if (!Number.isFinite(weight) || weight <= 0) {
      warnings.add("Skipped a transform with non-positive weight");
      return null;
    }
  }

  // Variation weights, in attribute order (evaluation order only matters for
  // the RNG stream, never the attractor's distribution). Unknown attributes
  // are collected for one aggregated warning — they are either variations we
  // don't implement or their parameters.
  let variations: Variation[] = [];
  for (const name of el.getAttributeNames()) {
    if (VARIATION_NAMES.has(name)) {
      const w = attrNumber(el, name);
      if (w === undefined || w === 0) continue;
      variations.push({
        type: name as VariationType,
        weight: Math.max(
          -MAX_VARIATION_WEIGHT,
          Math.min(MAX_VARIATION_WEIGHT, w),
        ),
      });
      continue;
    }
    if (KNOWN_XFORM_ATTRS.has(name)) {
      if (name === "chaos") {
        warnings.add(
          "Xaos (per-transform chaos weights) is not supported and was ignored",
        );
      }
      if (name === "opacity" && attrNumber(el, "opacity") === 0) {
        warnings.add("A hidden (opacity 0) transform was imported visible");
      }
      continue;
    }
    ignoredAttrs.add(name);
  }

  // A pure `linear` blend is the affine map scaled by its total weight —
  // fold that scale into the coefficients exactly and drop the list, so the
  // common linear-only xform imports as a plain affine map.
  if (variations.length > 0 && variations.every((v) => v.type === "linear")) {
    const total = variations.reduce((sum, v) => sum + v.weight, 0);
    coefs = {
      a: coefs.a * total,
      b: coefs.b * total,
      c: coefs.c * total,
      d: coefs.d * total,
      e: coefs.e * total,
      f: coefs.f * total,
    };
    variations = [];
  }

  // `post` applies AFTER the variation sum. On a purely affine xform the
  // composition post∘affine is itself affine — fold it in exactly. With
  // nonlinear variations in between there is nothing in our vocabulary to
  // hang it on, so it is dropped with a warning.
  const rawPost = el.getAttribute("post");
  if (rawPost !== null) {
    const post = parseCoefs(rawPost);
    if (post === null) {
      warnings.add("Ignored a malformed post transform");
    } else if (!isIdentityCoefs(post)) {
      if (variations.length === 0) {
        coefs = composeCoefs(post, coefs);
      } else {
        warnings.add(
          "Ignored a post transform on a nonlinear map (shape will differ)",
        );
      }
    }
  }

  const { rotation, scaleX, scaleY, shear } = decomposeCoefs(coefs);
  const transform: Transform = {
    id,
    position: [coefs.e, coefs.f, 0],
    rotation: [0, 0, rotation],
    // scale.z = 0 pins the orbit to the z = 0 plane, where our 3D variation
    // lifts agree with flam3's planar formulas exactly (see the module doc).
    scale: [scaleX, scaleY, 0],
  };
  if (Math.abs(shear) > 1e-9) transform.shear = [shear, 0, 0];
  if (variations.length > 0) transform.variations = variations;
  return { transform, weight };
}

/**
 * Parse a flame's palette: the compact `<palette count format="RGB">hex…`
 * block (Apophysis style) or `<color index rgb="R G B"/>` entries (flam3
 * style), downsampled evenly onto a {@link CustomPalette}'s
 * {@link MAX_CUSTOM_PALETTE_STOPS} stops. `null` when absent or unusable —
 * the scene simply keeps the default palette; a palette is cosmetic and
 * never worth a warning that would drown the structural ones.
 */
function parseFlamePalette(flameEl: Element): CustomPalette | null {
  const entries: RgbStop[] = [];

  const paletteEl = flameEl.getElementsByTagName("palette")[0];
  if (paletteEl?.textContent) {
    const hex = paletteEl.textContent.replace(/\s+/g, "");
    if (/^[0-9a-fA-F]*$/.test(hex)) {
      for (let o = 0; o + 6 <= hex.length; o += 6) {
        entries.push([
          Number.parseInt(hex.slice(o, o + 2), 16) / 255,
          Number.parseInt(hex.slice(o + 2, o + 4), 16) / 255,
          Number.parseInt(hex.slice(o + 4, o + 6), 16) / 255,
        ]);
      }
    }
  } else {
    const colors = Array.from(flameEl.getElementsByTagName("color"));
    const byIndex: RgbStop[] = [];
    for (const el of colors) {
      const index = attrNumber(el, "index");
      const rgb = el
        .getAttribute("rgb")
        ?.trim()
        .split(/\s+/)
        .map(Number.parseFloat);
      if (
        index === undefined ||
        index < 0 ||
        index > 4096 ||
        !Number.isInteger(index) ||
        rgb === undefined ||
        rgb.length < 3 ||
        rgb.slice(0, 3).some((n) => !Number.isFinite(n))
      ) {
        continue;
      }
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v / 255));
      byIndex[index] = [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
    }
    for (const stop of byIndex) if (stop !== undefined) entries.push(stop);
  }

  if (entries.length < 2) return null;
  const stops: RgbStop[] = [];
  for (let j = 0; j < MAX_CUSTOM_PALETTE_STOPS; j++) {
    const index = Math.round(
      (j / (MAX_CUSTOM_PALETTE_STOPS - 1)) * (entries.length - 1),
    );
    stops.push(entries[index]);
  }
  return { stops };
}

/**
 * Convert one `<flame>` element to a loadable encoded scene, or `null` when
 * nothing usable remains (which lands a warning naming the flame).
 */
function flameToScene(
  flameEl: Element,
  fallbackName: string,
  warnings: Set<string>,
  ignoredAttrs: Set<string>,
): DecodedFlameScene | null {
  const name = flameEl.getAttribute("name") || fallbackName;

  let xformEls = Array.from(flameEl.getElementsByTagName("xform"));
  if (xformEls.length > MAX_TRANSFORMS) {
    warnings.add(
      `Only the first ${MAX_TRANSFORMS} transforms of "${name}" were imported`,
    );
    xformEls = xformEls.slice(0, MAX_TRANSFORMS);
  }

  const imported: ImportedXform[] = [];
  for (const el of xformEls) {
    const xf = xformToTransform(
      el,
      imported.length,
      false,
      warnings,
      ignoredAttrs,
    );
    if (xf !== null) imported.push(xf);
  }
  if (imported.length === 0) {
    warnings.add(`Flame "${name}" has no usable transforms — skipped`);
    return null;
  }

  // Weights: flam3 weights are relative, exactly like ours. When every
  // xform carries the same weight the system is uniform — omit the field
  // entirely so the chaos game keeps its unweighted fast path.
  const transforms = imported.map((xf) => xf.transform);
  const allEqual = imported.every((xf) => xf.weight === imported[0].weight);
  if (!allEqual) {
    for (let i = 0; i < imported.length; i++) {
      transforms[i].weight = Math.min(
        MAX_XFORM_WEIGHT,
        Math.max(MIN_XFORM_WEIGHT, imported[i].weight),
      );
    }
  }

  let finalTransform: Transform | undefined;
  const finalEl = flameEl.getElementsByTagName("finalxform")[0];
  if (finalEl !== undefined) {
    const final = xformToTransform(finalEl, 0, true, warnings, ignoredAttrs);
    if (final !== null) finalTransform = final.transform;
  }

  const base = toSnapshot(initialState(false));
  const snapshot: SceneSnapshot = {
    ...base,
    transforms,
    finalTransform,
    flame: { ...base.flame },
  };

  // Tone-map header: flam3's brightness/gamma/vibrancy are the same knobs
  // our flame render exposes (its tone-map is modeled on flam3's), modulo
  // the brightness↔exposure scale. Absent attributes keep OUR defaults.
  const brightness = attrNumber(flameEl, "brightness");
  if (brightness !== undefined) {
    snapshot.flame.exposure = clampToSpec(
      PARAM.flameExposure,
      brightness / BRIGHTNESS_PER_EXPOSURE,
    );
  }
  const gamma = attrNumber(flameEl, "gamma");
  if (gamma !== undefined) {
    snapshot.flame.gamma = clampToSpec(PARAM.flameGamma, gamma);
  }
  const vibrancy = attrNumber(flameEl, "vibrancy");
  if (vibrancy !== undefined) {
    snapshot.flame.vibrancy = clampToSpec(PARAM.flameVibrancy, vibrancy);
  }
  const supersample =
    attrNumber(flameEl, "supersample") ?? attrNumber(flameEl, "oversample");
  if (supersample !== undefined) {
    snapshot.flame.supersample = clampToSpec(
      PARAM.flameSupersample,
      supersample,
    );
  }
  const estimatorRadius = attrNumber(flameEl, "estimator_radius");
  if (estimatorRadius !== undefined) {
    snapshot.flame.estimatorRadius = clampToSpec(
      PARAM.estimatorRadius,
      estimatorRadius,
    );
  }
  const estimatorMinimum = attrNumber(flameEl, "estimator_minimum");
  if (estimatorMinimum !== undefined) {
    snapshot.flame.estimatorMinimumRadius = clampToSpec(
      PARAM.estimatorMinimumRadius,
      estimatorMinimum,
    );
  }
  const estimatorCurve = attrNumber(flameEl, "estimator_curve");
  if (estimatorCurve !== undefined) {
    snapshot.flame.estimatorCurve = clampToSpec(
      PARAM.estimatorCurve,
      estimatorCurve,
    );
  }

  const palette = parseFlamePalette(flameEl);
  if (palette !== null) {
    snapshot.customPalette = palette;
    snapshot.flame.paletteId = CUSTOM_PALETTE_ID;
    snapshot.rampPaletteId = CUSTOM_PALETTE_ID;
  }

  const encoded = encodeScene(snapshot);
  // By construction this can't miss — but the module's contract is that
  // every returned scene is PROVEN loadable, so verify rather than trust.
  if (decodeScene(encoded) === null) {
    warnings.add(`Flame "${name}" could not be converted — skipped`);
    return null;
  }
  return { name, encoded };
}

/**
 * Parse `.flame` file text into loadable scenes — the never-throwing trust
 * boundary for untrusted flame files, mirroring `scene-file.ts`'s
 * `decodeImportFile` contract. Returns `null` when the text is not a flame
 * file at all (not XML, no `<flame>` elements); otherwise a
 * {@link DecodedFlameFile} whose `scenes` may be empty (nothing usable —
 * the warnings say why). At most {@link COLLECTION_CAP} flames are read, so
 * a hostile file with thousands of `<flame>` elements can't force unbounded
 * work — the merge path caps at the collection size anyway.
 */
export function decodeFlameFile(text: string): DecodedFlameFile | null {
  try {
    // Cheap sniff before invoking a whole XML parse on arbitrary text.
    if (!/<flames?[\s>]/.test(text)) return null;
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;

    const flameEls = Array.from(doc.getElementsByTagName("flame"));
    if (flameEls.length === 0) return null;

    const warnings = new Set<string>();
    const ignoredAttrs = new Set<string>();
    if (flameEls.length > COLLECTION_CAP) {
      warnings.add(
        `Only the first ${COLLECTION_CAP} flames in the file were imported`,
      );
    }

    const scenes: DecodedFlameScene[] = [];
    for (const [i, flameEl] of flameEls.slice(0, COLLECTION_CAP).entries()) {
      const scene = flameToScene(
        flameEl,
        `Flame ${i + 1}`,
        warnings,
        ignoredAttrs,
      );
      if (scene !== null) scenes.push(scene);
    }

    if (ignoredAttrs.size > 0) {
      const names = [...ignoredAttrs];
      const shown = names.slice(0, 8).join(", ");
      const more = names.length > 8 ? `, +${names.length - 8} more` : "";
      warnings.add(`Unsupported flame features ignored: ${shown}${more}`);
    }
    return { scenes, warnings: [...warnings] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Export: SceneSnapshot -> .flame XML
// ---------------------------------------------------------------------------

/** The composed affine of one transform, reduced to flam3's 2D reading:
 * linear block columns from the row-major 3x3's XY block. */
function affineToCoefs(m: number[], t: readonly number[]): Coefs2D {
  return { a: m[0], b: m[3], c: m[1], d: m[4], e: t[0], f: t[1] };
}

function coefsAttr(m: Coefs2D): string {
  return `${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)}`;
}

/** Merge a transform's variation list by type (XML attributes must be
 * unique), dropping zero/non-finite weights like `composeVariations` does.
 * An empty result means the map is purely affine. */
function mergedVariations(t: Transform): Map<VariationType, number> {
  const merged = new Map<VariationType, number>();
  for (const v of t.variations ?? []) {
    if (!Number.isFinite(v.weight) || v.weight === 0) continue;
    merged.set(v.type, (merged.get(v.type) ?? 0) + v.weight);
  }
  for (const [type, weight] of merged) if (weight === 0) merged.delete(type);
  return merged;
}

/** Whether a merged variation list is pure `linear` — i.e. the map is affine
 * (possibly scaled), so a symmetry copy's rotation composes into `coefs`
 * exactly instead of needing a `post`. */
function isAffineBlend(merged: Map<VariationType, number>): boolean {
  for (const type of merged.keys()) if (type !== "linear") return false;
  return true;
}

/** Variation attributes for an xform: the merged list, or `linear="1"` for a
 * purely affine map (flam3 xforms need at least one variation term). */
function variationAttrs(merged: Map<VariationType, number>): string {
  if (merged.size === 0) return ` linear="1"`;
  let out = "";
  for (const [type, weight] of merged) out += ` ${type}="${fmt(weight)}"`;
  return out;
}

/**
 * Frame the export like a camera fit: run a short seeded chaos probe and
 * take trimmed XY bounds (sparse flung points shouldn't set the frame — the
 * same rationale as `framing-bounds.ts`, deliberately re-derived here so the
 * codec stays self-contained). Falls back to flam3's classic
 * `center 0 0 / scale 240` for degenerate clouds.
 */
function probeFraming(s: SceneSnapshot): {
  centerX: number;
  centerY: number;
  scale: number;
} {
  const fallback = { centerX: 0, centerY: 0, scale: 240 };
  const result = runChaosGame(
    s.transforms,
    PROBE_POINTS,
    mulberry32(PROBE_SEED),
    s.finalTransform ?? null,
    s.symmetry,
  );
  if (result.count < 16) return fallback;

  const xs = new Float64Array(result.count);
  const ys = new Float64Array(result.count);
  for (let i = 0; i < result.count; i++) {
    xs[i] = result.positions[i * 3];
    ys[i] = result.positions[i * 3 + 1];
  }
  xs.sort();
  ys.sort();
  const lo = Math.floor(result.count * PROBE_TRIM);
  const hi = Math.min(
    result.count - 1,
    Math.ceil(result.count * (1 - PROBE_TRIM)),
  );
  const minX = xs[lo];
  const maxX = xs[hi];
  const minY = ys[lo];
  const maxY = ys[hi];
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (
    !Number.isFinite(spanX) ||
    !Number.isFinite(spanY) ||
    Math.max(spanX, spanY) < 1e-6
  ) {
    return fallback;
  }
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: EXPORT_SIZE / (Math.max(spanX, spanY) * EXPORT_MARGIN),
  };
}

/** The 256-entry palette block: the scene's resolved gradient palette, or —
 * for the `"legacy"` per-transform mode, which has no gradient — the
 * per-transform hues laid out as equal blocks so each xform's `color` index
 * lands on its own hue. */
function paletteBlock(s: SceneSnapshot, transformCount: number): string {
  const lut = buildPaletteLUT(
    resolvePalette(s.flame.paletteId, s.customPalette),
  );
  const byte = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");

  let hex = "";
  if (lut !== null) {
    for (let i = 0; i < 256; i++) {
      hex += byte(lut[i * 3]) + byte(lut[i * 3 + 1]) + byte(lut[i * 3 + 2]);
    }
  } else {
    const colors = transformColors(transformCount);
    for (let i = 0; i < 256; i++) {
      const c =
        colors[
          Math.min(transformCount - 1, Math.floor((i / 256) * transformCount))
        ];
      hex += byte(c[0]) + byte(c[1]) + byte(c[2]);
    }
  }

  const lines: string[] = [];
  for (let o = 0; o < hex.length; o += 96) {
    lines.push("      " + hex.slice(o, o + 96));
  }
  return `    <palette count="256" format="RGB">\n${lines.join("\n")}\n    </palette>`;
}

/**
 * Serialize a scene to flam3/Apophysis `.flame` XML — the system's XY
 * shadow (see the module doc). Kaleidoscope copies are baked into explicit
 * xforms exactly the way flam3's own symmetry macro would: composed into
 * `coefs` for affine maps, a `post` rotation for nonlinear ones (our
 * post-rotation applies to the variation output, which at `z = 0` is what
 * flam3's `post` does too). Returns the XML plus warnings for anything the
 * projection genuinely loses (z structure, 4D extensions, x/y-axis
 * kaleidoscopes' out-of-plane rotations).
 */
export function encodeFlameFile(
  s: SceneSnapshot,
  name: string,
): FlameFileExport {
  const warnings = new Set<string>();
  const transforms = s.transforms;
  const n = transforms.length;

  const order = effectiveSymmetryOrder(s.symmetry.order, n);
  if (order > 1 && s.symmetry.axis !== "z") {
    warnings.add(
      "Kaleidoscope about the X/Y axis exports as its flat 2D shadow",
    );
  }

  const affines = transforms.map(composeAffine);
  const finalAffine = s.finalTransform ? composeAffine(s.finalTransform) : null;
  const allAffines = finalAffine === null ? affines : [...affines, finalAffine];
  if (allAffines.some((a) => a.m[6] !== 0 || a.m[7] !== 0 || a.t[2] !== 0)) {
    warnings.add("3D structure was flattened onto the XY plane");
  }
  if (
    transforms.some((t) => !isFlatTransform(t)) ||
    (s.finalTransform !== undefined && !isFlatTransform(s.finalTransform))
  ) {
    warnings.add("4D structure was flattened onto the XY plane");
  }

  const xforms: string[] = [];
  for (let k = 0; k < order; k++) {
    const rot =
      k === 0
        ? null
        : symmetryRotation(s.symmetry.axis, (2 * Math.PI * k) / order);
    for (let i = 0; i < n; i++) {
      const t = transforms[i];
      const affine = affines[i];
      const merged = mergedVariations(t);
      const weight = t.weight ?? 1;
      const color = n === 1 ? 0 : i / (n - 1);

      let coefs: Coefs2D;
      let post = "";
      if (rot === null) {
        coefs = affineToCoefs(affine.m, affine.t);
      } else if (isAffineBlend(merged)) {
        // Affine map: the copy's rotation composes into the coefficients
        // exactly (rotate the linear block and the translation).
        const m = mul3(rot, affine.m);
        const tx =
          rot[0] * affine.t[0] + rot[1] * affine.t[1] + rot[2] * affine.t[2];
        const ty =
          rot[3] * affine.t[0] + rot[4] * affine.t[1] + rot[5] * affine.t[2];
        coefs = affineToCoefs(m, [tx, ty]);
      } else {
        // Nonlinear map: our copy rotation applies AFTER the variation
        // blend — exactly what flam3's `post` does.
        coefs = affineToCoefs(affine.m, affine.t);
        post = ` post="${fmt(rot[0])} ${fmt(rot[3])} ${fmt(rot[1])} ${fmt(rot[4])} 0 0"`;
      }

      xforms.push(
        `    <xform weight="${fmt(weight)}" color="${fmt(color)}"` +
          `${variationAttrs(merged)} coefs="${coefsAttr(coefs)}"${post}/>`,
      );
    }
  }

  if (finalAffine !== null && s.finalTransform) {
    const merged = mergedVariations(s.finalTransform);
    xforms.push(
      `    <finalxform color="0"${variationAttrs(merged)}` +
        ` coefs="${coefsAttr(affineToCoefs(finalAffine.m, finalAffine.t))}"/>`,
    );
  }

  const framing = probeFraming(s);
  const flameAttrs =
    `name="${escapeXml(name)}" version="fractal-explorer" ` +
    `size="${EXPORT_SIZE} ${EXPORT_SIZE}" ` +
    `center="${fmt(framing.centerX)} ${fmt(framing.centerY)}" ` +
    `scale="${fmt(Math.round(framing.scale * 100) / 100)}" ` +
    `background="0 0 0" ` +
    `brightness="${fmt(s.flame.exposure * BRIGHTNESS_PER_EXPOSURE)}" ` +
    `gamma="${fmt(s.flame.gamma)}" ` +
    `vibrancy="${fmt(s.flame.vibrancy)}" ` +
    `supersample="${fmt(s.flame.supersample)}" ` +
    `estimator_radius="${fmt(s.flame.estimatorRadius)}" ` +
    `estimator_minimum="${fmt(s.flame.estimatorMinimumRadius)}" ` +
    `estimator_curve="${fmt(s.flame.estimatorCurve)}"`;

  const xml =
    `<flames name="${escapeXml(name)}">\n` +
    `  <flame ${flameAttrs}>\n` +
    `${xforms.join("\n")}\n` +
    `${paletteBlock(s, n)}\n` +
    `  </flame>\n` +
    `</flames>\n`;

  return { xml, warnings: [...warnings] };
}
