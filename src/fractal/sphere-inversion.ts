/**
 * The sphere-inversion family's ONE shared vocabulary, imported by both
 * estimator twins (`sphere-inversion-de.ts`, `sphere-inversion-de-4d.ts`)
 * and by the explicit-orbit oracle (`sphere-inversion-oracle.ts`): what a
 * construction IS has one definition across both dimensions, and only the
 * estimators' vector arithmetic is duplicated under the twin-file convention
 * (the `escape-de-4d.ts` rule). The construction, its covering argument and
 * the measurements behind every choice below are in
 * `docs/sphere-inversion-family.md`.
 *
 * THE OBJECT. Generators are closed balls `B_i = B(c_i, r_i)` in `R^n`
 * (`n` = 3 or 4) with pairwise disjoint interiors — tangency admitted,
 * overlap refused. `I_i(x) = c_i + r_i²(x − c_i)/|x − c_i|²`, and in 4D the
 * generators are hyperspheres acting on all of `xyzw`. The fundamental domain
 * is `F = R^n \ ∪ open B_i`. The SEED is `K ∩ F` where `K` is an intersection
 * of GENERALIZED BALLS (a ball, or the complement of an open one), the class
 * inversion maps to itself exactly. The rendered set is the DEPTH-D SEED
 * ORBIT `O_D = ∪ { g(K ∩ F) : g a reduced word of length <= D }` — never the
 * limit set, which would need its own stopping rule and remainder argument.
 * Generator ORDER is not part of the geometry: disjoint interiors mean at
 * most one open ball holds a point, and the lowest index wins only on a
 * tangency point.
 *
 * TWO LAYERS, so explicit-ball authoring can arrive later without touching
 * the core:
 *
 *   - AUTHORED ({@link SphereInversionAuthored}): a compact parametric form —
 *     arrangement id, generator radius as a fraction of tangency, seed kind
 *     with its lengths, depth. Every field is optional; absent fields take
 *     {@link SPHERE_INVERSION_DEFAULTS}.
 *   - RESOLVED ({@link SphereInversionConstruction}): the explicit
 *     `{dim, generators, seed, depth}` the estimators and the oracle read.
 *
 * {@link resolveSphereInversion} expands the first into the second in the
 * `resolveFoldRadii` style, with one deliberate difference: an out-of-domain
 * or unknown value is REFUSED with a reason, never clamped, because a clamp
 * would render a different object than the document names. The resolver
 * never mutates or normalizes its input, so a caller can keep the authored
 * block byte for byte and show the refusal beside it.
 * {@link analyzeSphereInversionSystem} is the construction-level gate
 * (eligible / degraded / ineligible) the resolver runs last, and the one an
 * explicitly authored construction will run on its own. It is disjoint from
 * the affine/fold, escape and bulb gates by construction — those read a
 * `Transform[]`, this reads a construction no transform list can express
 * (the representation verdict in the doc) — and it is NOT yet wired into
 * `surface-eligibility.ts` or persistence.
 *
 * UNIT ARRANGEMENTS. Every shipped arrangement puts its generator centres at
 * distance 1 from the origin, so seed lengths are absolute and comparable
 * across arrangements; a uniform size change is the camera's job, not a
 * document field.
 */
import {
  inversionDistanceLowerBound,
  signedInversionBallScale,
} from "./inversion";

// ------------------------------------------------------------- constants

/** How a query's fold ended — the numeric codes every later mirror
 * dispatches on. */
export const SPHERE_INVERSION_FOLD_DOMAIN = 0;
/** The inversion budget was spent while the query still sat inside a ball. */
export const SPHERE_INVERSION_FOLD_EXHAUSTED = 1;
/** The query reached a generator centre (within
 * {@link SPHERE_INVERSION_POLE_FLOOR}). */
export const SPHERE_INVERSION_FOLD_POLE = 2;
export type SphereInversionFoldStatus =
  | typeof SPHERE_INVERSION_FOLD_DOMAIN
  | typeof SPHERE_INVERSION_FOLD_EXHAUSTED
  | typeof SPHERE_INVERSION_FOLD_POLE;

/** Relative floor under which a query counts as AT a generator centre:
 * `|x − c| <= floor · r`. */
export const SPHERE_INVERSION_POLE_FLOOR = 1e-12;

/** The march step scale. 1 by the certified-bound verdict: no damping
 * factor is applied anywhere in this family. */
export const SPHERE_INVERSION_STEP_SCALE = 1;

/** Structural depth cap: it sizes the fold's transport scratch and the fixed
 * loop of both shader mirrors. NOT the public range: the measured public
 * depth range is 0–12 in both dimensions (settle cost is flat in depth to
 * this cap; `docs/sphere-inversion-family.md`, "Cost and exhaustion"), and a
 * document may still carry any depth up to this cap. */
export const SPHERE_INVERSION_MAX_DEPTH = 32;

/** A seed sphere whose depth-1 image scale `r_j² / | |c − c_j|² − r² |`
 * reaches this is refused as a plane image: its image radius is then at
 * least a million seed radii, and the SDF `|x − c'| − r'` cancels about six
 * of f64's sixteen digits. */
export const SPHERE_INVERSION_PLANE_SCALE_LIMIT = 1e6;

/**
 * The relative margin a cutoff exit must clear: an exit is taken only when
 * the transported running minimum `v` satisfies `v · (1 + margin) < cutoff`.
 * The exact transport is monotone, so `v` is at least the full estimate; its
 * f64 EVALUATION is not exactly monotone (a quotient of two rounded,
 * increasing terms), so without a margin a query whose full estimate sits
 * within a few ulps of the cutoff could exit below it while the full value
 * does not — the decision `result < cutoff` would then differ from the
 * uncut estimator's. Each transport step's relative rounding is a few ulps
 * and the step's sensitivity `s / (s + d)` never amplifies it, so over the
 * {@link SPHERE_INVERSION_MAX_DEPTH} steps the two evaluations differ by far
 * less than `2^-40`; exits inside that band fall through to the full scan.
 */
export const SPHERE_INVERSION_CUTOFF_EXIT_MARGIN = 2 ** -40;

/** Generators overlap when their gap falls below `−tol · (r_i + r_j)`. The
 * tolerance admits tangency computed in f64 (a fraction of exactly 1). */
export const SPHERE_INVERSION_OVERLAP_TOLERANCE = 1e-12;

/** Generators within `tol · (r_i + r_j)` of touching are reported tangent. */
export const SPHERE_INVERSION_TANGENT_TOLERANCE = 1e-9;

/**
 * How many "By Transform" colour slots a depth-`D` construction has: one per
 * GENERATION a renderer can attribute. The estimators' winning covering term
 * has word length fold depth, +1 for a copy, +2 for a gap ball, so a Surface
 * hit reaches `D + 2`; a Points sample reaches only `D` but reads the same
 * slot count, so one generation wears one hue in every renderer
 * (`color.ts`'s `transformColors` spreads hues over the count).
 */
export function sphereInversionGenerationSlots(depth: number): number {
  return depth + 3;
}

// ----------------------------------------------------------- arrangements

/** One named generator arrangement: centres at distance 1 in `dim`. */
export interface SphereInversionArrangement {
  dim: 3 | 4;
  centers: readonly (readonly number[])[];
  /** Half the smallest centre-to-centre distance: the equal radius at which
   * neighbouring generators kiss. */
  tangentRadius: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

function arrangement(
  dim: 3 | 4,
  centers: number[][],
): SphereInversionArrangement {
  let minDist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      let d2 = 0;
      for (let a = 0; a < dim; a++) d2 += (centers[i][a] - centers[j][a]) ** 2;
      minDist = Math.min(minDist, Math.sqrt(d2));
    }
  }
  return { dim, centers, tangentRadius: minDist / 2 };
}

function oct6Centers(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0];
      c[a] = s;
      out.push(c);
    }
  }
  return out;
}

function cube8Centers(): number[][] {
  const out: number[][] = [];
  const k = 1 / Math.sqrt(3);
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [1, -1]) out.push([x * k, y * k, z * k]);
    }
  }
  return out;
}

function ico12Centers(): number[][] {
  const k = 1 / Math.hypot(1, PHI);
  const out: number[][] = [];
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      out.push([0, a * k, b * PHI * k]);
      out.push([a * k, b * PHI * k, 0]);
      out.push([b * PHI * k, 0, a * k]);
    }
  }
  return out;
}

function cross8Centers(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0, 0];
      c[a] = s;
      out.push(c);
    }
  }
  return out;
}

function cell24Centers(): number[][] {
  const out: number[][] = [];
  const k = Math.SQRT1_2;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const c = [0, 0, 0, 0];
          c[a] = sa * k;
          c[b] = sb * k;
          out.push(c);
        }
      }
    }
  }
  return out;
}

function tess16Centers(): number[][] {
  const out: number[][] = [];
  for (let m = 0; m < 16; m++) {
    out.push([0, 1, 2, 3].map((a) => ((m >> a) & 1 ? 0.5 : -0.5)));
  }
  return out;
}

/** The 600-cell's 120 vertices at unit distance: the 8 axis units `±e_k`,
 * the 16 `(±½)⁴`, and the 96 EVEN permutations of `(±φ, ±1, ±1/φ, 0)/2`.
 * The edge is `1/φ`, so the kissing radius is `1/(2φ) ≈ 0.309`. The native
 * 4D beauty search's construction, copied from its prototype. */
function cell600Centers(): number[][] {
  const out = [...cross8Centers(), ...tess16Centers()];
  const evenPerms = [
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 0, 3, 2],
    [1, 2, 0, 3],
    [1, 3, 2, 0],
    [2, 0, 1, 3],
    [2, 1, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 2, 1],
    [3, 1, 0, 2],
    [3, 2, 1, 0],
  ];
  const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
  for (const perm of evenPerms) {
    for (let m = 0; m < 8; m++) {
      const v = base.map((b, i) => (i < 3 && (m >> i) & 1 ? -b : b));
      const c = [0, 0, 0, 0];
      perm.forEach((dst, src) => (c[dst] = v[src]));
      out.push(c);
    }
  }
  return out;
}

/**
 * The named arrangements. EXTENSIBLE: a new id is one entry here, and every
 * consumer reads the registry rather than a closed union.
 *
 * - `oct6`: `±e_x, ±e_y, ±e_z`.
 * - `cube8`: the cube's vertices.
 * - `ico12`: the icosahedron's vertices.
 * - `cross8`: the 16-cell's vertices `±e_k`, k = x,y,z,w.
 * - `cell24`: the 24-cell's vertices, permutations of `(±1,±1,0,0)/√2`.
 * - `tess16`: the tesseract's vertices `(±½,±½,±½,±½)`.
 * - `cell600`: the 600-cell's 120 vertices — the native 4D subjects' (the
 *   pearl-window vault and the medallion sphere) arrangement.
 */
export const SPHERE_INVERSION_ARRANGEMENTS: Readonly<
  Record<string, SphereInversionArrangement>
> = Object.freeze({
  oct6: arrangement(3, oct6Centers()),
  cube8: arrangement(3, cube8Centers()),
  ico12: arrangement(3, ico12Centers()),
  cell24: arrangement(4, cell24Centers()),
  tess16: arrangement(4, tess16Centers()),
  cross8: arrangement(4, cross8Centers()),
  cell600: arrangement(4, cell600Centers()),
});

/** The seed kinds. `ball` is `B(0, size)`: inside the central void it seeds
 * the pearls, and grown across the generators its `∩ F` is a sphairahedron
 * (the pre-gate sheets' "cap") — ONE kind, because the seed is always
 * `K ∩ F` and two document spellings for one object would be a defect.
 * `shell` is `size − thickness <= |x| <= size + thickness`; `cutShell` is a
 * shell with one side removed by a large complement ball (the vaults). */
export const SPHERE_INVERSION_SEED_KINDS = [
  "ball",
  "shell",
  "cutShell",
] as const;
export type SphereInversionSeedKind =
  (typeof SPHERE_INVERSION_SEED_KINDS)[number];

// ---------------------------------------------------------- authored form

/** The authored seed. KNOWN fields a kind does not read are ignored, never
 * refused, so switching kinds keeps the other kinds' lengths; an UNKNOWN key
 * is refused ({@link SPHERE_INVERSION_SEED_FIELDS}). */
export interface SphereInversionAuthoredSeed {
  kind?: string;
  /** Ball radius, or the shell's mid radius. */
  size?: number;
  /** Shell half-thickness. */
  thickness?: number;
  /** Cut direction's xyz (need not be unit). */
  cutDirection?: readonly number[];
  /** Cut direction's w — 4D arrangements only; a nonzero value on a 3D
   * arrangement is refused. */
  cutDirectionW?: number;
  /** Signed distance from the origin, along the cut direction, at which the
   * cut surface crosses; must lie strictly inside the shell's outer radius
   * on either side. */
  cutOffset?: number;
  /** Radius of the complement ball doing the cut (large = nearly flat). */
  cutRadius?: number;
}

/** The authored compact parametric form (module doc). */
export interface SphereInversionAuthored {
  arrangement?: string;
  /** Generator radius as a fraction of the arrangement's tangent radius, in
   * `(0, 1]`; 1 is kissing. */
  radiusFraction?: number;
  seed?: SphereInversionAuthoredSeed;
  /** Inversion budget `D`: an integer in `[0, SPHERE_INVERSION_MAX_DEPTH]`. */
  depth?: number;
}

/** Every field the authored form defines, top level and seed. Any other
 * key is REFUSED as unknown: a document written by a newer version may name
 * a field this version cannot read, and ignoring it would render a different
 * object than the document names (the no-clamp rule applied to keys). */
export const SPHERE_INVERSION_AUTHORED_FIELDS: readonly string[] =
  Object.freeze(["arrangement", "radiusFraction", "seed", "depth"]);
export const SPHERE_INVERSION_SEED_FIELDS: readonly string[] = Object.freeze([
  "kind",
  "size",
  "thickness",
  "cutDirection",
  "cutDirectionW",
  "cutOffset",
  "cutRadius",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The dimension an authored block's arrangement names — `3`, `4`, or `null`
 * when the id is not a registry arrangement (absent, unknown, or not a
 * string). It reads ONLY the arrangement: a block refused for any other
 * reason (an out-of-domain depth, an unknown field) still names its
 * dimension, so repairing that reason never flips the scene between 3D and
 * 4D. The scene-level derivation (`scene-dimension.ts`) is its one caller.
 */
export function sphereInversionAuthoredDimension(
  authored: unknown,
): 3 | 4 | null {
  if (!isPlainObject(authored)) return null;
  const id = authored.arrangement;
  return typeof id === "string" &&
    Object.prototype.hasOwnProperty.call(SPHERE_INVERSION_ARRANGEMENTS, id)
    ? SPHERE_INVERSION_ARRANGEMENTS[id].dim
    : null;
}

/** Absent-field values. The seed lengths are the pre-gate sheets' panels
 * (pearls ball .28 is inside every 3D arrangement's central void at the
 * default fraction; shells 1 ± .03; the vault cut at .25 with radius 10). */
export const SPHERE_INVERSION_DEFAULTS = Object.freeze({
  radiusFraction: 0.99,
  depth: 8,
  seedKind: "ball",
  ballSize: 0.28,
  shellSize: 1,
  shellThickness: 0.03,
  cutShellThickness: 0.06,
  cutDirection: Object.freeze([0.35, 1, 0.55]),
  cutDirectionW: 0,
  cutOffset: 0.25,
  cutRadius: 10,
});

// ----------------------------------------------------- resolved construction

export interface SphereInversionGenerator {
  center: readonly number[];
  radius: number;
}

/** A generalized ball: the closed ball, or (`complement`) the complement of
 * the open ball. Its SDF `±(|x − c| − r)` is exact in both cases. */
export interface SphereInversionSeedMember {
  center: readonly number[];
  radius: number;
  complement: boolean;
}

/** The explicit construction every estimator and the oracle read. */
export interface SphereInversionConstruction {
  dim: 3 | 4;
  generators: readonly SphereInversionGenerator[];
  /** `K`, the intersection of these members. */
  seed: readonly SphereInversionSeedMember[];
  depth: number;
}

export type SphereInversionEligibilityStatus =
  "eligible" | "degraded" | "ineligible";

export interface SphereInversionEligibility {
  /** `eligible`: marched at {@link SPHERE_INVERSION_STEP_SCALE} with no
   * disclosure. `degraded`: still marched at step scale 1 and still
   * certified, with `degradations` naming what costs (tangency cusps).
   * `ineligible`: no construction exists; see `reasons`. */
  status: SphereInversionEligibilityStatus;
  /** Blockers; non-empty exactly when `ineligible`. */
  reasons: string[];
  /** Disclosures; non-empty exactly when `degraded`. */
  degradations: string[];
}

function finiteVector(v: readonly number[], dim: number): boolean {
  return v.length === dim && v.every((x) => Number.isFinite(x));
}

function dist2(a: readonly number[], b: readonly number[], dim: number) {
  let s = 0;
  for (let i = 0; i < dim; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

/**
 * The construction-level gate. Ineligible when the vectors or lengths are
 * malformed, the depth is out of domain, generators overlap, the seed has
 * no bounded member, a seed sphere passes through (or within f64 reach of,
 * {@link SPHERE_INVERSION_PLANE_SCALE_LIMIT}) a generator centre, or a
 * bounded seed member lies inside one closed generator ball (the orbit is
 * then empty — a SUFFICIENT emptiness test, not a necessary one: a seed
 * covered by several balls at once is not detected). Degraded when two
 * generators are tangent: the certified bound vanishes at the tangency
 * point, so a ray aimed at a cusp creeps.
 */
export function analyzeSphereInversionSystem(
  construction: SphereInversionConstruction,
): SphereInversionEligibility {
  const reasons: string[] = [];
  const degradations: string[] = [];
  const { dim, generators, seed, depth } = construction;
  const done = (): SphereInversionEligibility => ({
    status:
      reasons.length > 0
        ? "ineligible"
        : degradations.length > 0
          ? "degraded"
          : "eligible",
    reasons,
    degradations: reasons.length > 0 ? [] : degradations,
  });
  if (dim !== 3 && dim !== 4) {
    reasons.push(`dimension ${String(dim)} is not 3 or 4`);
    return done();
  }
  if (!Number.isInteger(depth) || depth < 0) {
    reasons.push(`depth ${depth} is not a non-negative integer`);
  } else if (depth > SPHERE_INVERSION_MAX_DEPTH) {
    reasons.push(
      `depth ${depth} exceeds the structural cap ${SPHERE_INVERSION_MAX_DEPTH}`,
    );
  }
  if (generators.length === 0) reasons.push("no generators");
  generators.forEach((g, i) => {
    if (!finiteVector(g.center, dim)) {
      reasons.push(`generator ${i + 1} centre is not a finite ${dim}-vector`);
    }
    if (!(Number.isFinite(g.radius) && g.radius > 0)) {
      reasons.push(`generator ${i + 1} radius must be finite and positive`);
    }
  });
  if (seed.length === 0) reasons.push("the seed has no members");
  seed.forEach((m, i) => {
    if (!finiteVector(m.center, dim)) {
      reasons.push(`seed member ${i + 1} centre is not a finite ${dim}-vector`);
    }
    if (!(Number.isFinite(m.radius) && m.radius > 0)) {
      reasons.push(`seed member ${i + 1} radius must be finite and positive`);
    }
  });
  if (seed.length > 0 && seed.every((m) => m.complement)) {
    reasons.push("the seed has no bounded (non-complement) member");
  }
  if (reasons.length > 0) return done();

  let tangentPairs = 0;
  for (let i = 0; i < generators.length; i++) {
    for (let j = i + 1; j < generators.length; j++) {
      const a = generators[i];
      const b = generators[j];
      const gap =
        Math.sqrt(dist2(a.center, b.center, dim)) - a.radius - b.radius;
      const scale = a.radius + b.radius;
      if (gap < -SPHERE_INVERSION_OVERLAP_TOLERANCE * scale) {
        reasons.push(`generators ${i + 1} and ${j + 1} overlap`);
      } else if (gap <= SPHERE_INVERSION_TANGENT_TOLERANCE * scale) {
        tangentPairs++;
      }
    }
  }
  if (tangentPairs > 0) {
    degradations.push(
      `${tangentPairs} tangent generator pair${tangentPairs === 1 ? "" : "s"}: ` +
        "the certified bound vanishes at each tangency point (a cusp), so " +
        "rays aimed at one creep",
    );
  }
  seed.forEach((m, i) => {
    generators.forEach((g, j) => {
      const d2 = dist2(m.center, g.center, dim);
      const den = Math.abs(d2 - m.radius * m.radius);
      if (den * SPHERE_INVERSION_PLANE_SCALE_LIMIT <= g.radius * g.radius) {
        reasons.push(
          `seed member ${i + 1} passes through generator ${j + 1}'s centre: ` +
            "its image is a plane",
        );
      }
      if (!m.complement && Math.sqrt(d2) + m.radius <= g.radius) {
        reasons.push(
          `seed member ${i + 1} lies inside generator ${j + 1}: the orbit is empty`,
        );
      }
    });
  });
  return done();
}

// ------------------------------------------------------------------ resolver

export type SphereInversionResolution =
  | {
      ok: true;
      construction: SphereInversionConstruction;
      eligibility: SphereInversionEligibility;
    }
  | { ok: false; reasons: string[] };

/** A finite `dim`-vector, for authored values that may not be arrays at all
 * (an imported document is untrusted). Deliberately not a type guard. */
function isFiniteVectorValue(v: unknown, dim: number): boolean {
  return (
    Array.isArray(v) &&
    v.length === dim &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Expand the authored form into an explicit construction (module doc).
 * Absent fields take {@link SPHERE_INVERSION_DEFAULTS}; present fields out of
 * domain REFUSE with every reason collected, never clamp. A resolved result
 * has already passed {@link analyzeSphereInversionSystem} (so its
 * eligibility is `eligible` or `degraded`); its refusals are merged into the
 * same reason list.
 *
 * Domain: `arrangement` a registry id; `radiusFraction` in `(0, 1]`; `depth`
 * an integer in `[0, SPHERE_INVERSION_MAX_DEPTH]`; `seed.kind` one of
 * {@link SPHERE_INVERSION_SEED_KINDS}; `size > 0`; shell `thickness` in
 * `(0, size)`; a `ball` may cross the generators (its seed is `K ∩ F`);
 * `cutDirection` a nonzero finite
 * 3-vector, `cutDirectionW` finite and zero on a 3D arrangement,
 * `cutRadius > 0`, `|cutOffset| < size + thickness`. The block and a present
 * seed must be plain objects, and every key must be one of
 * {@link SPHERE_INVERSION_AUTHORED_FIELDS} / {@link SPHERE_INVERSION_SEED_FIELDS}
 * (an unknown key is refused by name). Values may be of any JSON type — an
 * imported document is untrusted — and a wrongly typed value is refused like
 * an out-of-domain one.
 */
export function resolveSphereInversion(
  authored: SphereInversionAuthored,
): SphereInversionResolution {
  const reasons: string[] = [];
  const block: unknown = authored;
  if (!isPlainObject(block)) {
    return {
      ok: false,
      reasons: ["the sphere-inversion block is not an object"],
    };
  }
  const unknownKeys = (o: Record<string, unknown>, known: readonly string[]) =>
    Object.keys(o).filter((key) => !known.includes(key));
  for (const key of unknownKeys(block, SPHERE_INVERSION_AUTHORED_FIELDS)) {
    reasons.push(`unknown field "${key}" (not readable by this version)`);
  }
  const rawSeed: unknown = block.seed;
  if (rawSeed !== undefined && !isPlainObject(rawSeed)) {
    reasons.push("seed is not an object");
  } else if (rawSeed !== undefined) {
    for (const key of unknownKeys(rawSeed, SPHERE_INVERSION_SEED_FIELDS)) {
      reasons.push(
        `unknown seed field "${key}" (not readable by this version)`,
      );
    }
  }
  const D = SPHERE_INVERSION_DEFAULTS;
  const id = authored.arrangement;
  const arr =
    typeof id === "string" &&
    Object.prototype.hasOwnProperty.call(SPHERE_INVERSION_ARRANGEMENTS, id)
      ? SPHERE_INVERSION_ARRANGEMENTS[id]
      : undefined;
  if (id === undefined) {
    reasons.push("no arrangement");
  } else if (!arr) {
    reasons.push(
      `unknown arrangement "${String(id)}" (known: ${Object.keys(
        SPHERE_INVERSION_ARRANGEMENTS,
      ).join(", ")})`,
    );
  }

  const fraction = authored.radiusFraction ?? D.radiusFraction;
  if (!(isFiniteNumber(fraction) && fraction > 0 && fraction <= 1)) {
    reasons.push(
      `generator radius fraction ${String(fraction)} is outside (0, 1]`,
    );
  }
  const depth = authored.depth ?? D.depth;
  if (!(
    isFiniteNumber(depth) &&
    Number.isInteger(depth) &&
    depth >= 0 &&
    depth <= SPHERE_INVERSION_MAX_DEPTH
  )) {
    reasons.push(
      `depth ${String(depth)} is not an integer in [0, ${SPHERE_INVERSION_MAX_DEPTH}]`,
    );
  }

  const s: SphereInversionAuthoredSeed = isPlainObject(rawSeed) ? rawSeed : {};
  const kind = s.kind ?? D.seedKind;
  const knownKind = (
    SPHERE_INVERSION_SEED_KINDS as readonly unknown[]
  ).includes(kind);
  if (!knownKind) {
    reasons.push(
      `unknown seed kind "${String(kind)}" (known: ${SPHERE_INVERSION_SEED_KINDS.join(", ")})`,
    );
  }
  const isShell = kind === "shell" || kind === "cutShell";
  const size = s.size ?? (kind === "ball" ? D.ballSize : D.shellSize);
  if (knownKind && !(isFiniteNumber(size) && size > 0)) {
    reasons.push(`seed size ${String(size)} must be finite and positive`);
  }
  const thickness =
    s.thickness ??
    (kind === "cutShell" ? D.cutShellThickness : D.shellThickness);
  if (
    isShell &&
    isFiniteNumber(size) &&
    !(isFiniteNumber(thickness) && thickness > 0 && thickness < size)
  ) {
    reasons.push(
      `shell thickness ${String(thickness)} must lie in (0, size ${size})`,
    );
  }
  let cutDir: number[] | null = null;
  let cutRadius = 0;
  let cutOffset = 0;
  if (kind === "cutShell") {
    const xyz: readonly number[] = s.cutDirection ?? D.cutDirection;
    const w = s.cutDirectionW ?? D.cutDirectionW;
    const okXyz = isFiniteVectorValue(xyz, 3);
    if (!okXyz) reasons.push("cut direction is not a finite 3-vector");
    if (!isFiniteNumber(w)) reasons.push("cut direction w is not finite");
    if (arr && arr.dim === 3 && isFiniteNumber(w) && w !== 0) {
      reasons.push("cut direction w applies only to a 4D arrangement");
    }
    if (okXyz && isFiniteNumber(w)) {
      const v: number[] = arr?.dim === 4 ? [...xyz, w] : [...xyz];
      const len = Math.hypot(...v);
      if (len > 0) cutDir = v.map((x) => x / len);
      else reasons.push("cut direction is zero");
    }
    cutRadius = s.cutRadius ?? D.cutRadius;
    if (!(isFiniteNumber(cutRadius) && cutRadius > 0)) {
      reasons.push(
        `cut radius ${String(cutRadius)} must be finite and positive`,
      );
    }
    cutOffset = s.cutOffset ?? D.cutOffset;
    if (!isFiniteNumber(cutOffset)) {
      reasons.push(`cut offset ${String(cutOffset)} is not finite`);
    } else if (
      isFiniteNumber(size) &&
      isFiniteNumber(thickness) &&
      !(Math.abs(cutOffset) < size + thickness)
    ) {
      reasons.push(
        `cut offset ${cutOffset} must lie strictly inside the shell's outer radius ${size + thickness}`,
      );
    }
  }
  if (reasons.length > 0 || !arr) return { ok: false, reasons };

  const dim = arr.dim;
  const radius = fraction * arr.tangentRadius;
  const generators: SphereInversionGenerator[] = arr.centers.map((c) => ({
    center: [...c],
    radius,
  }));
  const origin = new Array<number>(dim).fill(0);
  const seed: SphereInversionSeedMember[] = [];
  if (kind === "ball") {
    seed.push({ center: origin, radius: size, complement: false });
  } else {
    seed.push({ center: origin, radius: size + thickness, complement: false });
    seed.push({
      center: [...origin],
      radius: size - thickness,
      complement: true,
    });
    if (kind === "cutShell" && cutDir) {
      seed.push({
        center: cutDir.map((x) => x * (cutOffset + cutRadius)),
        radius: cutRadius,
        complement: true,
      });
    }
  }
  const construction: SphereInversionConstruction = {
    dim,
    generators,
    seed,
    depth,
  };
  const eligibility = analyzeSphereInversionSystem(construction);
  if (eligibility.status === "ineligible") {
    return { ok: false, reasons: eligibility.reasons };
  }
  return { ok: true, construction, eligibility };
}

// ------------------------------------------------------------ build tables

/** Flat generalized balls, stride `dim`. `sign` is +1 for a ball and −1 for
 * a complement, so a member's SDF is `sign · (|x − c| − r)`. */
export interface SphereInversionBallTable {
  count: number;
  center: Float64Array;
  radius: Float64Array;
  sign: Float64Array;
}

/**
 * The precomputed covering tables both estimator twins read (the doc's
 * covering argument):
 *
 *   - `domainSeed`: `K ∩ F` — the seed members, then `ext(B_i)` for every
 *     generator in index order.
 *   - `copies[j]`: `I_j(K ∩ F)` — the seed members' images, then `B_j`
 *     itself, then `ext(I_j(B_l))` for every `l != j` in index order.
 *   - `gaps[j]`: the depth-2 balls `I_j(B_l)`, `l != j`, in index order.
 *
 * The member ORDER is part of the attribution contract: a hit's
 * `seedMember` is an index below `seedCount` into these lists.
 */
export interface SphereInversionTables {
  dim: 3 | 4;
  depth: number;
  generatorCount: number;
  seedCount: number;
  generatorCenter: Float64Array;
  generatorRadius: Float64Array;
  generatorRadius2: Float64Array;
  domainSeed: SphereInversionBallTable;
  copies: SphereInversionBallTable[];
  gaps: SphereInversionBallTable[];
  /** Radius about the origin enclosing `O_D` at every depth:
   * `max(bounded seed reach, max_i |c_i| + r_i)`. In 4D it is the FULL 4D
   * radius, so a slice's entry sphere does not move as the slice scrubs. */
  boundingRadius: number;
  /** Smallest `|c_i − c_j| − r_i − r_j` (≈ 0 at a tangency). */
  minGeneratorGap: number;
}

interface GBall {
  center: number[];
  radius: number;
  sign: number;
}

function table(dim: number, balls: GBall[]): SphereInversionBallTable {
  const center = new Float64Array(balls.length * dim);
  const radius = new Float64Array(balls.length);
  const sign = new Float64Array(balls.length);
  balls.forEach((b, i) => {
    for (let a = 0; a < dim; a++) center[i * dim + a] = b.center[a];
    radius[i] = b.radius;
    sign[i] = b.sign;
  });
  return { count: balls.length, center, radius, sign };
}

/** Image of a generalized ball under `I_g` via
 * {@link signedInversionBallScale}; the analyzer has already refused the
 * plane images this cannot express. */
function invertBall(g: SphereInversionGenerator, b: GBall, dim: number): GBall {
  const d = Math.sqrt(dist2(b.center, g.center, dim));
  const s = signedInversionBallScale(d, b.radius, g.radius * g.radius);
  return {
    center: b.center.map((v, a) => g.center[a] + s * (v - g.center[a])),
    radius: Math.abs(s) * b.radius,
    sign: s > 0 ? b.sign : -b.sign,
  };
}

/** Build the covering tables. Throws with the analyzer's reasons when the
 * construction is ineligible. */
export function buildSphereInversionTables(
  construction: SphereInversionConstruction,
): SphereInversionTables {
  const eligibility = analyzeSphereInversionSystem(construction);
  if (eligibility.status === "ineligible") {
    throw new Error(
      `sphere-inversion construction is ineligible: ${eligibility.reasons.join("; ")}`,
    );
  }
  const { dim, generators, seed, depth } = construction;
  const n = generators.length;
  const seedBalls: GBall[] = seed.map((m) => ({
    center: [...m.center],
    radius: m.radius,
    sign: m.complement ? -1 : 1,
  }));
  const ext = (g: SphereInversionGenerator): GBall => ({
    center: [...g.center],
    radius: g.radius,
    sign: -1,
  });
  const copies: SphereInversionBallTable[] = [];
  const gaps: SphereInversionBallTable[] = [];
  generators.forEach((g, j) => {
    const images = seedBalls.map((b) => invertBall(g, b, dim));
    const gapBalls = generators
      .filter((_, l) => l !== j)
      .map((o) =>
        invertBall(
          g,
          { center: [...o.center], radius: o.radius, sign: 1 },
          dim,
        ),
      );
    copies.push(
      table(dim, [
        ...images,
        { center: [...g.center], radius: g.radius, sign: 1 },
        ...gapBalls.map((b) => ({ ...b, sign: -1 })),
      ]),
    );
    gaps.push(table(dim, gapBalls));
  });
  let seedReach = Infinity;
  for (const m of seed) {
    if (!m.complement) {
      seedReach = Math.min(seedReach, Math.hypot(...m.center) + m.radius);
    }
  }
  let boundingRadius = seedReach;
  let minGeneratorGap = Infinity;
  const generatorCenter = new Float64Array(n * dim);
  const generatorRadius = new Float64Array(n);
  const generatorRadius2 = new Float64Array(n);
  generators.forEach((g, i) => {
    boundingRadius = Math.max(
      boundingRadius,
      Math.hypot(...g.center) + g.radius,
    );
    for (let a = 0; a < dim; a++) generatorCenter[i * dim + a] = g.center[a];
    generatorRadius[i] = g.radius;
    generatorRadius2[i] = g.radius * g.radius;
    for (let j = i + 1; j < n; j++) {
      const o = generators[j];
      minGeneratorGap = Math.min(
        minGeneratorGap,
        Math.sqrt(dist2(g.center, o.center, dim)) - g.radius - o.radius,
      );
    }
  });
  return {
    dim,
    depth,
    generatorCount: n,
    seedCount: seed.length,
    generatorCenter,
    generatorRadius,
    generatorRadius2,
    domainSeed: table(dim, [...seedBalls, ...generators.map(ext)]),
    copies,
    gaps,
    boundingRadius,
    minGeneratorGap,
  };
}

// ------------------------------------------------------ estimator scaffolding

/**
 * A built estimator: the covering tables plus the fold's transport scratch.
 * The SAME shape in both dimensions (the vectors are flat with stride
 * `dim`); each twin builds it through {@link createSphereInversionDE} and
 * owns only its unrolled arithmetic. The scratch makes a DE single-threaded
 * and non-reentrant, like the other CPU estimators.
 */
export interface SphereInversionDE extends SphereInversionTables {
  construction: SphereInversionConstruction;
  /** `|x − c|` before fold inversion `i`. */
  foldRadius: Float64Array;
  /** `r²` of fold inversion `i`. */
  foldRadius2: Float64Array;
  /** The folded query. */
  foldPoint: Float64Array;
}

/** Build the tables and scratch for a construction of dimension `dim`.
 * Throws when the dimension disagrees or the construction is ineligible. */
export function createSphereInversionDE(
  construction: SphereInversionConstruction,
  dim: 3 | 4,
): SphereInversionDE {
  if (construction.dim !== dim) {
    throw new Error(
      `sphere-inversion construction is ${construction.dim}D, estimator is ${dim}D`,
    );
  }
  const tables = buildSphereInversionTables(construction);
  return {
    ...tables,
    construction,
    foldRadius: new Float64Array(construction.depth + 1),
    foldRadius2: new Float64Array(construction.depth + 1),
    foldPoint: new Float64Array(dim),
  };
}

/**
 * Attribution for a query — what a shader will need to colour and light a
 * hit, at the cost of one extra member scan of the winning covering term.
 */
export interface SphereInversionHit {
  /** The estimate, bit-identical to the plain estimator's at the same
   * cutoff. */
  d: number;
  status: SphereInversionFoldStatus;
  /** Inversions the query's fold spent. */
  foldDepth: number;
  /** Word length of the covering term that set `d`: the fold depth for the
   * folded seed, +1 for a one-step copy, +2 for a depth-2 gap ball. */
  depth: number;
  /** Outermost letter of that word (the first generator the query's fold
   * inverted through), −1 at depth 0. */
  firstGenerator: number;
  /** Innermost letter of that word, −1 at depth 0. */
  lastGenerator: number;
  /** Index into `construction.seed` of the binding member of the winning
   * intersection, or −1 when it is a generator wall, a gap ball or a pole. */
  seedMember: number;
}

export function makeSphereInversionHit(): SphereInversionHit {
  return {
    d: 0,
    status: SPHERE_INVERSION_FOLD_DOMAIN,
    foldDepth: 0,
    depth: 0,
    firstGenerator: -1,
    lastGenerator: -1,
    seedMember: -1,
  };
}

/** Carry a folded-coordinate EXACT lower bound back through the fold's `k`
 * inversions, innermost first, with `inversionDistanceLowerBound`. */
export function transportSphereInversionBound(
  foldRadius: Float64Array,
  foldRadius2: Float64Array,
  k: number,
  d: number,
): number {
  let v = d;
  for (let i = k - 1; i >= 0; i--) {
    v = inversionDistanceLowerBound(foldRadius[i], foldRadius2[i], v);
  }
  return v;
}

/**
 * The folded-coordinate value below which the transported result would fall
 * below `cutoff`: the transport's monotone inverse `d = s·y/(r − y)` applied
 * outermost first (`Infinity` once `y >= r`, where no folded value reaches
 * the cutoff). It ignores the transport's `1 + 2^-20` margin, which puts it
 * slightly BELOW the true threshold (an exit may be tried late, never
 * wrongly), and f64 rounding can move it either way; the estimators confirm
 * every exit by transporting forward against
 * {@link SPHERE_INVERSION_CUTOFF_EXIT_MARGIN}, so this decides when an exit
 * is TRIED, never whether one is taken.
 */
export function sphereInversionFoldedCutoff(
  foldRadius: Float64Array,
  foldRadius2: Float64Array,
  k: number,
  cutoff: number,
): number {
  let c = cutoff;
  for (let i = 0; i < k; i++) {
    const r = foldRadius[i];
    if (c >= r) return Infinity;
    c = ((foldRadius2[i] / r) * c) / (r - c);
  }
  return c;
}

/** The generator `l` whose image `I_j(B_l)` sits at index `gapIndex` of
 * `gaps[j]` (the list skips `l = j`). */
export function sphereInversionGapGenerator(
  j: number,
  gapIndex: number,
): number {
  return gapIndex < j ? gapIndex : gapIndex + 1;
}
