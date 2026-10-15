/**
 * The scene description as PROSE: a short, share-ready paragraph describing
 * the current document — the subject (which family is at work), the object's
 * composition (how many maps, which variations, which finishes) and the look
 * (render mode, palette, atmosphere) — for the user to copy, edit and post
 * to a social feed. `legend-spec.ts`'s pattern one level up: a pure
 * derivation over the document, testable without a DOM, with the panel/UI
 * only painting the result into a textarea.
 *
 * THREE STANDING POLICIES, enforced by construction rather than by trimming
 * after the fact:
 *
 * - CONVERSATIONAL, NOT TECHNICAL. The app's own vocabulary rendered human:
 *   finishes ("polished to metal", "glassy faces"), the render mode as a
 *   medium ("a cloud of points"), symmetry as "kaleidoscoped N-fold". No
 *   attractor/affine/distance-estimator jargon — the audience is whoever
 *   follows the user's feed, not this repo.
 * - DESCRIBE THE COMPOSITION, NEVER THE INVENTORY. The grammar has no
 *   per-transform production: the map count is ONE clause, variation types
 *   appear only as the mix's identity ("built from sphere folds and box
 *   folds"), and a mixed system describes itself as mixed rather than
 *   listing. A twenty-map system costs the same words as a two-map one —
 *   that is the point. The mechanism list is likewise capped at two
 *   clauses, the most distinctive two by a fixed priority.
 * - DESCRIBE ONLY WHAT IS AUTHORED. The document's own
 *   absent-means-classic convention is the prose budget: an absent block,
 *   finish or symmetry order is never mentioned, so a simple system
 *   describes simply and the description cannot drift from what actually
 *   renders. (The backdrop is the one deliberate exception — the atmosphere
 *   is what a post is about, and "against a dark backdrop" says something
 *   even when it is the default.)
 *
 * The subject precedence copies `scene-dimension.ts`'s (sphereInversion >
 * mengerTwist > sphairahedron > the transform system), and the transform
 * system's own family comes from the SAME analyzers the renderers route
 * through (`analyzeEscapeSystem`/`analyzeEscapeSystem4`/
 * `analyzeBulbSystem`), so the description cannot disagree with the render
 * about what an object IS. This is deliberately document-level
 * classification, NOT `deriveSurfaceEligibility`: a route the Surface gate
 * refuses (a 25-record system, a tiled lattice) still renders in Points and
 * still deserves prose, so the gate's route refusals do not belong here.
 *
 * Blocks that only some render modes draw are described only in those
 * modes, matching the panel's own disclosures: the Menger carve, the glass
 * solid and the chain twist are Surface-only (Points/Flame/Solid keep the
 * transforms' own render), while the sphere-inversion and sphairahedron
 * blocks are subjects in Points and Surface alike — the chaos game routes
 * through them — and dormant or refused in Flame and Solid, where the
 * description falls back to the transforms those modes actually draw.
 *
 * `rng` picks among template variants per sentence beat, so a reroll offers
 * fresh phrasing over the same facts; the same seed always yields the same
 * text. Length targets a short social post (~300 characters) and stays
 * there by construction — short beats, no enumeration — never by
 * truncation, which would mangle the final sentence.
 */

import type { LegendPaletteControl } from "./legend-spec";
import type { AppState, RenderMode } from "./state";
import type { PaletteSelection } from "../fractal/palette";
import type { Transform } from "../fractal/types";
import { analyzeBulbSystem } from "../fractal/bulb-de";
import { analyzeEscapeSystem } from "../fractal/escape-de";
import { analyzeEscapeSystem4 } from "../fractal/escape-de-4d";
import {
  MENGER_TWIST_DEFAULTS,
  resolveMengerTwist,
} from "../fractal/menger-twist";
import { isLatticeTilingSpec } from "../fractal/tiling";
import {
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
} from "../fractal/surface-finish";
import { twistIsTrivial } from "../fractal/twist";

/** Everything {@link describeScene} reads. The caller supplies the two
 * things a document cannot answer — the session's render mode (never
 * persisted) and the displayed system's dimension — plus the palette
 * display-name lookup (`legend-spec.ts`'s discipline: index.html's option
 * labels are the one source of palette names) and the reroll randomness. */
export interface DescribeInputs {
  readonly state: AppState;
  /**
   * Whether the displayed system is non-flat — the caller's already-computed
   * `displayedIsNonFlat(state)` (`state.ts`: the scene's dimension in Surface
   * and Points, the transforms' in Flame and Solid), so the description and
   * the rest of the panel can never read a different dimension.
   */
  readonly nonFlat: boolean;
  /** The active render mode — session-only, never persisted, so passed in. */
  readonly renderMode: RenderMode;
  /** The human-readable name of a palette id, read off the `<select>` that
   * picked it — the same lookup {@link LegendPaletteControl} names. */
  readonly paletteName: (
    control: LegendPaletteControl,
    id: PaletteSelection,
  ) => string;
  /** Injected randomness for the reroll: which template variant each beat
   * takes. Same seed, same text (a mulberry32 seed is enough). */
  readonly rng: () => number;
}

/** Words for numbers small enough to read as words — the count budget.
 * Beyond twenty the digits are shorter than the word. */
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

function countWords(n: number): string {
  return n >= 0 && n <= 20 ? NUMBER_WORDS[n] : String(n);
}

/** The map count as ONE clause — "a single map", "a pair of maps",
 * "twenty maps". This is the whole of the grammar's map-count budget:
 * nothing downstream ever enumerates individual maps. */
function mapCountPhrase(n: number): string {
  if (n <= 0) return "a few maps";
  if (n === 1) return "a single map";
  if (n === 2) return "a pair of maps";
  return `${countWords(n)} maps`;
}

/** The one-clause variation-identity dictionary. Every entry of
 * `VARIATION_TYPES` gets the words a feed reader knows — the flam3 names
 * are the community's own vocabulary, so most render as "<name> maps" —
 * while an unknown FUTURE type falls to silence (null), never a raw
 * identifier in user-facing prose. */
const VARIATION_WORDS: Record<string, string> = {
  sinusoidal: "sinusoidal maps",
  spherical: "spherical maps",
  swirl: "swirl maps",
  horseshoe: "horseshoe maps",
  polar: "polar maps",
  handkerchief: "handkerchief maps",
  heart: "heart maps",
  disc: "disc maps",
  spiral: "spiral maps",
  bubble: "bubble maps",
  julia: "Julia-set maps",
  julian: "Julian power maps",
  juliascope: "Juliascope power maps",
  curl: "curl-warped maps",
  bipolar: "bipolar maps",
  diamond: "diamond maps",
  ex: "ex maps",
  pdj: "PDJ maps",
  rings: "rings maps",
  boxfold: "box folds",
  spherefold: "sphere folds",
  mandelbox: "Mandelbox folds",
  qsquare: "quaternion squarings",
  bulb: "triplex powers",
};

const FOLD_TYPES = new Set(["boxfold", "spherefold", "mandelbox"]);

/** The identity clause for the composition beat: what the ACTIVE maps are
 * made of, when the mix has one voice. Exactly one non-linear type across
 * every active map names it; a folds-only mix names the fold kinds; a
 * mixed system names nothing (the count clause already said "maps", and
 * naming two of five kinds would be the start of an inventory). Returns
 * null when the mix has no voice worth naming. */
function variationIdentity(active: readonly Transform[]): string | null {
  if (active.length === 0) return null;
  const kinds = new Set<string>();
  let foldOnlyMaps = 0;
  let nonFoldMaps = 0;
  for (const map of active) {
    // The renderer's own "active variation" rule (`composeVariations`):
    // a finite nonzero weight is what makes an entry speak for the map.
    const types = (map.variations ?? [])
      .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
      .map((v) => v.type);
    if (types.length === 0) continue;
    const folds = types.filter((t) => FOLD_TYPES.has(t));
    for (const type of types) kinds.add(type);
    if (folds.length === types.length) foldOnlyMaps += 1;
    else nonFoldMaps += 1;
  }
  if (kinds.size === 0) return null;
  if (foldOnlyMaps === active.length && kinds.size <= 3) {
    const named = Array.from(kinds).map((t) => VARIATION_WORDS[t] ?? "folds");
    if (named.length === 1) return `built from ${named[0]}`;
    return `built from ${named.slice(0, -1).join(", ")} and ${
      named[named.length - 1]
    }`;
  }
  if (nonFoldMaps === active.length && kinds.size === 1) {
    const word = VARIATION_WORDS[Array.from(kinds)[0]];
    return word ? `shaped by ${word}` : null;
  }
  return null;
}

function pick(rng: () => number, variants: readonly string[]): string {
  return variants[Math.floor(rng() * variants.length)] ?? variants[0];
}

/** En-US comma grouping for the one count a post states exactly (the point
 * count — every other number reads as a word). */
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/** Whether a subject block is the ACTIVE subject in this render mode — the
 * same mode-dormancy rule the composition beat applies, so the identity
 * clause is suppressed exactly when the block replaced the maps it would
 * describe. */
function blockIsSubject(state: AppState, mode: RenderMode): boolean {
  const surface = mode === "surface";
  if (state.sphereInversion !== undefined) {
    return mode === "points" || surface;
  }
  if (state.mengerTwist !== undefined) return surface;
  if (state.sphairahedron !== undefined) {
    return mode === "points" || surface;
  }
  if (state.finiteSolid !== undefined) return surface;
  return false;
}

/** The composition beat: the medium lead (render-mode noun) and the
 * subject core (what the object IS, map count included), plus whether the
 * transform system routes as an escape family (which gates the chain-twist
 * clause, itself Surface-only). The subject-block precedence is
 * `scene-dimension.ts`'s; the transform system's family comes from the
 * renderers' own analyzers, in the routing arm's order (escape first, then
 * bulb, then the plain IFS attractor). */
function compositionBeat(inputs: DescribeInputs): {
  lead: string;
  core: string;
  isEscape: boolean;
} {
  const { state, nonFlat, renderMode: mode, rng } = inputs;
  const surface = mode === "surface";
  const lead = mediumLead(inputs);
  if (state.sphereInversion && (mode === "points" || surface)) {
    return {
      lead,
      core: pick(rng, [
        "folded through inverted spheres",
        "built by inverting spheres into spheres",
      ]),
      isEscape: false,
    };
  }
  if (state.mengerTwist && surface) {
    const resolved = resolveMengerTwist(state.mengerTwist);
    const levels = resolved.ok
      ? resolved.construction.levels
      : (state.mengerTwist.levels ?? MENGER_TWIST_DEFAULTS.levels);
    const twisted = resolved.ok && !twistIsTrivial(resolved.construction);
    const core = twisted
      ? `a twisted Menger sponge, ${countWords(levels)} levels deep`
      : `a Menger sponge, ${countWords(levels)} levels deep`;
    return { lead, core, isEscape: false };
  }
  if (state.sphairahedron && (mode === "points" || surface)) {
    return {
      lead,
      core: pick(rng, [
        "folded between intersecting spheres",
        "grown between intersecting spheres",
      ]),
      isEscape: false,
    };
  }
  if (state.finiteSolid && surface) {
    return {
      lead,
      core: pick(rng, [
        "a construction of nested glass cells",
        "a nested glass construction",
      ]),
      isEscape: false,
    };
  }
  const active = state.transforms.filter((map) => (map.weight ?? 1) > 0);
  const escape = nonFlat
    ? analyzeEscapeSystem4(
        state.transforms,
        state.finalTransform ?? null,
        state.symmetry,
      )
    : analyzeEscapeSystem(
        state.transforms,
        state.finalTransform ?? null,
        state.symmetry,
      );
  if (escape.status === "eligible") {
    const steps =
      active.length === 1
        ? "a single folding step"
        : `a chain of ${countWords(active.length)} folding steps`;
    return { lead, core: steps, isEscape: true };
  }
  if (
    !nonFlat &&
    analyzeBulbSystem(
      state.transforms,
      state.finalTransform ?? null,
      state.symmetry,
    ).status === "eligible"
  ) {
    return { lead, core: "a single triplex-power formula", isEscape: true };
  }
  return {
    lead,
    core: `${mapCountPhrase(active.length)}, iterated at random`,
    isEscape: false,
  };
}

/** The medium lead: the render mode as a noun phrase. The point count is
 * the one exact number a post states, and it lives here. */
function mediumLead(inputs: DescribeInputs): string {
  const { state, renderMode: mode, rng } = inputs;
  switch (mode) {
    case "points":
      return pick(rng, [
        `A cloud of ${NUMBER_FORMAT.format(state.numPoints)} points`,
        `A point cloud of ${NUMBER_FORMAT.format(state.numPoints)} samples`,
      ]);
    case "flame":
      return pick(rng, ["A glowing fractal", "A bloom of light"]);
    case "solid":
      return pick(rng, ["A solid fractal volume", "A carved fractal solid"]);
    case "surface":
      return pick(rng, ["A lit fractal surface", "A ray-traced fractal"]);
  }
}

/** The mechanism clauses, most distinctive first, capped at two — the
 * anti-runaway budget. Absent blocks cost nothing. */
function mechanismClauses(inputs: DescribeInputs, isEscape: boolean): string[] {
  const { state, renderMode: mode, rng } = inputs;
  const clauses: string[] = [];
  if (state.schedule) {
    clauses.push(
      pick(rng, [
        `woven through ${countWords(state.schedule.depth)} picks from a second system`,
        "re-bent by a second, simpler system",
      ]),
    );
  }
  if (state.symmetry.order > 1) {
    clauses.push(
      pick(rng, [
        `kaleidoscoped ${countWords(state.symmetry.order)}-fold`,
        `${countWords(state.symmetry.order)}-fold kaleidoscope symmetry`,
      ]),
    );
  }
  if (state.tiling) {
    clauses.push(
      isLatticeTilingSpec(state.tiling)
        ? pick(rng, [
            "repeated along an endless mirrored line",
            "mirrored into an endless lattice",
          ])
        : pick(rng, [
            "tiled across space by mirror reflections",
            "tiled by reflections",
          ]),
    );
  }
  if (state.balloonEcho) {
    clauses.push(
      pick(rng, [
        "with a sphere-inverted echo wrapped around it",
        "under its own sphere-inverted echo",
      ]),
    );
  }
  if (mode === "surface" && isEscape && state.chainTwist) {
    clauses.push("twisted a little at every step");
  }
  if (state.condensationDepthBand) {
    const max = state.condensationDepthBand.maxDepth;
    clauses.push(
      max !== undefined
        ? `shown only ${countWords(max)} levels deep`
        : "with its deepest copies withheld",
    );
  }
  if (state.finalTransform) {
    clauses.push("lensed through a final map");
  }
  return clauses.slice(0, 2);
}

/** The look beat's color fragment — the active render's own coloring, in
 * the legend's narrate-the-screen spirit, as a comma-list fragment. */
function colorFragment(inputs: DescribeInputs): string | null {
  const { state, nonFlat, renderMode: mode, paletteName } = inputs;
  if (mode === "surface") {
    const source = state.surface.colorSource;
    if (source === "transform") return "each map tinted its own color";
    if (source === "height") return "shaded by height";
    if (source === "radius") return "shaded by distance";
    if (
      source === "palette" ||
      source === "rings" ||
      source === "sheets" ||
      source === "shapeTrap"
    ) {
      return `shaded by a ${paletteName("surfacePalette", state.surface.paletteId)} gradient`;
    }
    return null;
  }
  if (mode === "flame") {
    if (state.flame.paletteId === "legacy") {
      return nonFlat
        ? "colored by depth in the fourth dimension"
        : "colored along the orbit";
    }
    return `in ${paletteName("flamePalette", state.flame.paletteId)} palette colors`;
  }
  if (mode === "solid" && state.solid.paletteId !== "legacy") {
    return `in ${paletteName("solidPalette", state.solid.paletteId)} palette colors`;
  }
  const source = nonFlat ? state.fourDColor : state.colorMode;
  if (source === "transform") return "each map tinted its own color";
  if (source === "height") return "colored by height";
  if (source === "radius") return "colored by distance from the center";
  if (source === "position") return "colored by position";
  if (nonFlat && source.startsWith("w")) {
    return "colored by depth in the fourth dimension";
  }
  return null;
}

/** The look beat's finish fragment, Surface mode only: the authored
 * per-slot finishes grouped into one impression — never a per-map list.
 * A dielectric-optics slot is the real glass and speaks for itself. */
function finishFragment(state: AppState, mode: RenderMode): string | null {
  if (mode !== "surface") return null;
  if (state.transforms.some((map) => map.optics !== undefined)) {
    return "with refracting glass";
  }
  const looks = new Set<string>();
  for (const map of state.transforms) {
    if (isClassicSurfaceFinish(map.finish)) continue;
    const r = resolveSurfaceFinish(map.finish);
    if (r.metalness > 0.5) looks.add("metal");
    else if (r.transmit > 0) looks.add("glass");
    else if (r.reflect > 0) looks.add("reflective");
    else looks.add("polished");
  }
  if (looks.size === 0) return null;
  if (looks.size === 1) {
    const [sole] = Array.from(looks);
    if (sole === "metal") return "polished to metal";
    if (sole === "glass") return "with glassy faces";
    if (sole === "reflective") return "with reflective faces";
    return "polished";
  }
  // Two or more impressions stay generic — naming both would be the start
  // of a per-map inventory, the one thing the grammar never does.
  return "a mix of finishes";
}

/** The look beat's background fragment — the one deliberate
 * default-mention: the atmosphere is what a post is about. */
function backgroundFragment(inputs: DescribeInputs): string {
  const { state } = inputs;
  const bg = state.background;
  const radial = (bg.shape ?? "linear") === "radial" && bg.mode !== "flame";
  let phrase: string;
  switch (bg.mode) {
    case "dark":
      phrase = "against a dark backdrop";
      break;
    case "haze":
      phrase = "in a soft haze";
      break;
    case "auto":
      phrase = "against a palette-tinted backdrop";
      break;
    case "flame":
      phrase = "against a generated glow";
      break;
    case "custom":
      phrase = "on an authored gradient";
      break;
  }
  if (radial) phrase += " with a soft vignette";
  return phrase;
}

/** The flame iteration budget as a friendly magnitude: millions below a
 * billion, billions above — digits past twenty, where words stop being
 * shorter. */
function flameIterationsPhrase(iterations: number): string {
  const millions = Math.max(1, Math.round(iterations / 1_000_000));
  if (millions >= 1000) {
    const billions = Math.round(millions / 100) / 10;
    return `${billions} billion light iterations`;
  }
  return `${countWords(millions)} million light iterations`;
}

/** Capitalize a sentence fragment for its slot at the head of a sentence. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Compose the description: a composition sentence (subject, identity,
 * dimension, at most two mechanisms) then a look sentence (medium, color,
 * atmosphere) — or one sentence when the look has nothing to add. The same
 * seed always yields the same text; a fresh seed re-words the same facts.
 */
export function describeScene(inputs: DescribeInputs): string {
  const { state, nonFlat, renderMode: mode, rng } = inputs;
  const { lead, core, isEscape } = compositionBeat(inputs);

  const parts: string[] = [];
  if (!blockIsSubject(state, mode)) {
    const active = state.transforms.filter((m) => (m.weight ?? 1) > 0);
    const identity = variationIdentity(active);
    if (identity) parts.push(identity);
  }
  if (nonFlat) {
    parts.push(
      mode === "surface"
        ? pick(rng, [
            "sliced out of four dimensions",
            "a slice through four dimensions",
          ])
        : pick(rng, [
            "projected from four dimensions",
            "reaching into a fourth dimension",
          ]),
    );
  }
  parts.push(...mechanismClauses(inputs, isEscape));

  const composition =
    parts.length > 0
      ? `${lead} — ${core}, ${parts.join(", ")}.`
      : `${lead} — ${core}.`;

  const look: string[] = [];
  if (mode === "flame") {
    look.push(`painted by ${flameIterationsPhrase(state.flame.iterations)}`);
  }
  const finish = finishFragment(state, mode);
  if (finish) look.push(finish);
  const color = colorFragment(inputs);
  if (color) look.push(color);
  look.push(backgroundFragment(inputs));
  if (mode === "surface" && state.groundPlane) {
    look.push("standing on an endless floor");
  }

  const lookJoined = look.join(", ");
  return `${composition} ${capitalize(lookJoined)}.`;
}
