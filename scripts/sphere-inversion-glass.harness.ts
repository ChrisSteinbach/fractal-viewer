/**
 * THE LOOK GATE: what curved glass on the sphere-inversion family actually
 * looks like, rendered before a line of production code exists.
 *
 * The finite-solid glass direction reached its ceiling in the GEOMETRY, not
 * in the transport: the admitted optical solid is either the condensation
 * union at the ROOT (curved, but not a fractal) or a level-N cell
 * construction (a fractal, but flat-faced — boxes, and simplices after the
 * replacement). Raising the level buys smaller facets at every N and never a
 * curved silhouette. This sheet asks the one question that decides whether a
 * CURVED closed solid is worth building: does dielectric glass on the
 * sphere-inversion family's depth-D seed orbit read like glass.
 *
 * WHY THIS FAMILY IS THE CHEAP INSTANCE. `docs/surface-dielectric-transport.md`
 * records the scope wall that forced the pivot — the estimator march "can
 * find a boundary only from OUTSIDE, so a refracted child — which is what
 * glass IS — either misses the domain without a crossing or crawls its
 * anchor suppression into the step cap". Glass needs a SIGN. This family
 * nearly has one already: `sphere-inversion-de.ts` decides membership
 * exactly ("a return `<= 0` is a MEMBER SIGNAL in folded coordinates (the
 * folded seed SDF, untransported)"), and the folded seed is an intersection
 * of generalized balls whose member SDFs are exact, so the interior
 * clearance in FOLDED coordinates is the closed form `-sdfIntersection` with
 * nothing to derive.
 *
 * THE ONE PIECE THAT LOOKED NEW IS NOT. Carrying that folded clearance back
 * out through the fold's `k` inversions needs the FULL-ball law where
 * `transportSphereInversionBound` carries the EMPTY-ball one. Writing the
 * image ball out with `inversion.ts`'s identity (inversion takes `B(c, r)`
 * to `B(scale·c, scale·r)` with `scale = R²/(|c|² − r²)`): for a folded
 * clearance `rho` at distance `s` from the inversion centre, the clearance
 * at the unfolded point `p` (at `r = R²/s`) is
 *
 *     R²·rho / (s·(s + rho))  =  r²·rho / (R² + r·rho),
 *
 * which is `inversionDistanceLowerBound`'s expression term for term. The two
 * laws are the SAME MAP, so this prototype transports the interior clearance
 * with the shipped exterior function and no new arithmetic — and the
 * production child inherits that, not a second derivation. The soundness
 * probe below checks it numerically against the explicit orbit rather than
 * trusting the algebra.
 *
 * WHAT THIS SHEET IS. A prototype field built ENTIRELY here out of public
 * calls (`sphereInversionHitInfo` plus the DE's own fold scratch), driven
 * through `surface-dielectric.ts` — the ONE transport oracle — over the
 * closed-solid boundary query's f64 twin. No production module changes; no
 * new optical model; no displacement. Both dimensions in the same sheet.
 *
 * WHAT IT IS NOT. Not a certification of the field (the production form owes
 * its own module, tests and f32 argument), not a performance claim (a CPU
 * sheet at 160px prices nothing a renderer will pay), and not an admission
 * of any composition the family refuses today.
 *
 * ---------------------------------------------------------------- FINDINGS
 *
 * 1. THE FIELD IS SOUND, IN ALL THREE SENSES THE MARCH NEEDS, and the
 *    interior half cost no new arithmetic. Measured by the first three
 *    tests: zero membership disagreements between `field < 0` and
 *    `sphereInversionContains` over 200k samples at depths 2/4/6/8; zero
 *    clearance overshoot against the explicit orbit; zero oversteps in 8k
 *    interior samples stepping `|f|` in random directions. The sign is
 *    EXACT, not approximate.
 *
 * 2. THE LOOK IS REAL, AND IT IS A CURVED-GLASS LOOK. The opaque controls
 *    and the glass panels share a pose and a studio, so the panels differ
 *    only in the material: the glass refracts the checker floor through
 *    curved pearls, with Fresnel rims and Beer tint. This is the thing the
 *    box/simplicial solid cannot produce at any level.
 *
 * 3. DEPTH IS THE KNOB, AND IT CUTS BOTH WAYS. The depth sweep is the
 *    sheet's headline: depth 1-3 render as clean, convincing glass;
 *    by depth 4 the panels speckle and by 6-8 they are lace. The
 *    mechanism is not the estimator — it is FEATURE SIZE against the
 *    DECLARED OPTICAL RESOLUTION.
 *
 * 4. THE RESOLUTION IS THE REMEDY, MEASURED. `DIELECTRIC_CROSSING_EPS_REL`
 *    (R/512) is the production optical resolution, and a depth-6 seed orbit
 *    carries most of its structure below it. Refining it collapses the
 *    dominant failure — `inside-miss` 3671 -> 2162 -> 475 -> 10 at
 *    R/512 -> R/2048 -> R/8192 -> R/32768 — at 2.3x the CPU cost, and what
 *    remains is the PATH BUDGET rather than a defect. At R/8192 with a
 *    2048-path budget the depth-6 subjects resolve 92-93% of pixels.
 *
 * 5. THE FAILURE MODE, NAMED. Below the declared resolution the crossing
 *    band fires where the certified LOWER BOUND is merely loose (a
 *    near-kissing arrangement puts a near-cusp at every tangency, where the
 *    bound reaches ~0 with no surface there), and the caller-carried medium
 *    then drifts: a path marked inside sits in empty space, marches out of
 *    the domain and fails the whole trace `inside-miss`. Two fixes were
 *    measured. The MEMBERSHIP GATE (below) works and is kept — it takes
 *    65-98% unresolved down to 23-36% by itself. Re-deriving the medium
 *    from exact membership at every query (the `measured` rule) does NOT:
 *    it trades `state-mismatch` refusals for slightly more `inside-miss`,
 *    because the flip has to be judged along the CHILD's direction, not the
 *    incident one. That negative result is kept as a row.
 *
 * 6. BOTH DIMENSIONS RENDER, AND THE 4D HALF NEEDED NO NEW GEOMETRY. The
 *    posed-slice arm reads the 4D field through the app's own `lift4` at
 *    zero slab thickness and resolves 85-88% of pixels at the matched
 *    settings, on the 4D module's own argument that a 4D bound is a valid
 *    in-slice bound. Its fixtures are the sheet's own because `cell600`
 *    (both shipped 4D presets) costs about 20x per evaluation and no glass
 *    panel of one finished on the CPU.
 *
 * 7. WHAT THE PRODUCTION CHILDREN INHERIT. The field's two halves are one
 *    function each. The optical resolution is a per-subject choice, not the
 *    finite family's constant, and the boundary query needs a membership
 *    gate this family can afford and the closed-solid backend cannot. The
 *    depth at which the look is best is LOW — which is also the cheap end,
 *    and the opposite of where the estimator's cost concentrates.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion-glass.harness.ts
 * Writes: `scripts/out/sphere-inversion-glass*.png`
 */
import {
  PREVIEW_HIT,
  renderPreview,
  writeContactSheet,
  type PanelStats,
  type PreviewScene,
  type Vec3,
} from "./de-preview";
import { lift4, type RotorPlane } from "./sphere-inversion-orbit";
import {
  SPHERE_INVERSION_FOLD_POLE,
  makeSphereInversionHit,
  resolveSphereInversion,
  transportSphereInversionBound,
  type SphereInversionAuthored,
  type SphereInversionConstruction,
  type SphereInversionDE,
  type SphereInversionHit,
} from "../src/fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  sphereInversionContains,
  sphereInversionHitInfo,
} from "../src/fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  sphereInversionContains4,
  sphereInversionHitInfo4,
} from "../src/fractal/sphere-inversion-de-4d";
import {
  enumerateSeedOrbit,
  oracleMemberSdf,
  pieceContains,
  type OrbitPiece,
} from "../src/fractal/sphere-inversion-oracle";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_ENVIRONMENT_BOUND,
  DIELECTRIC_IOR,
  dielectricTrace,
  type DielectricBoundaryResult,
  type DielectricMaterial,
  type DielectricScene,
  type DielectricTraceStatus,
} from "../src/fractal/surface-dielectric";
import {
  transportSolidBoundaryQueryCPU,
  type TransportFixtureSystem,
} from "../src/app/gpu-bench/surface-transport-fixture";
import { PRESET_SPHERE_INVERSIONS, PRESET_VIEWS } from "../src/fractal/presets";

const SIZE = Number(process.env.SIG_SIZE ?? 160);
/** The 4D panels' own raster: the 600-cell's fold scans 120 generators per
 * step, about 20x the octahedral arrangements' cost per evaluation. */
const SIZE_4D = Number(process.env.SIG_SIZE_4D ?? 96);

// ------------------------------------------------------------- the field

/**
 * The prototype SIGNED field, 3D. Positive is the shipped certified
 * exterior bound, untouched. Negative is the folded interior clearance
 * (`-hit.d`, exact for an intersection of generalized balls) carried back
 * through the fold with the module's own transport — the header's identity.
 * A POLE returns 0: it is not a member, and the family's own contract
 * already says a ray aimed at one creeps.
 */
interface OpticalSolid {
  /** The prototype signed field. */
  field(p: Vec3): number;
  /** EXACT membership in the displayed solid — the family's own predicate,
   * never a threshold on a distance. */
  contains(p: Vec3): boolean;
}

function signedField3(de: SphereInversionDE): (p: Vec3) => number {
  const hit: SphereInversionHit = makeSphereInversionHit();
  return (p) => {
    sphereInversionHitInfo(de, p, 0, hit);
    if (hit.status === SPHERE_INVERSION_FOLD_POLE) return 0;
    if (hit.d > 0) return hit.d;
    return -transportSphereInversionBound(
      de.foldRadius,
      de.foldRadius2,
      hit.foldDepth,
      -hit.d,
    );
  };
}

/** The same field one dimension up, over the app's own posed lift
 * `q = rotorInv · (p, w0)` (`lift4`). The 4D module's own header carries
 * the reason no new geometry is needed: "A slice's distance is at least the
 * 4D distance, so this certified 4D bound is a certified in-slice bound" —
 * and the identical inequality makes a 4D interior clearance a conservative
 * IN-SLICE clearance. Zero slab thickness, which this family already
 * refuses to widen. */
function signedField4(
  de: SphereInversionDE,
  planes: [RotorPlane, number][],
  w0: number,
): (p: Vec3) => number {
  const hit: SphereInversionHit = makeSphereInversionHit();
  const lift = lift4(planes, w0);
  return (p) => {
    const q = lift(p);
    sphereInversionHitInfo4(de, [q[0], q[1], q[2], q[3]], 0, hit);
    if (hit.status === SPHERE_INVERSION_FOLD_POLE) return 0;
    if (hit.d > 0) return hit.d;
    return -transportSphereInversionBound(
      de.foldRadius,
      de.foldRadius2,
      hit.foldDepth,
      -hit.d,
    );
  };
}

function solid3(de: SphereInversionDE): OpticalSolid {
  return {
    field: signedField3(de),
    contains: (p) => sphereInversionContains(de, p),
  };
}

function solid4(
  de: SphereInversionDE,
  planes: [RotorPlane, number][],
  w0: number,
): OpticalSolid {
  const lift = lift4(planes, w0);
  return {
    field: signedField4(de, planes, w0),
    contains: (p) => {
      const q = lift(p);
      return sphereInversionContains4(de, [q[0], q[1], q[2], q[3]]);
    },
  };
}

// ------------------------------------------------------------- the studio

/**
 * The rear scene the transmission is FOR: a checkered floor under a two-stop
 * sky. A glass object against a flat backdrop shows almost nothing — the
 * finite study reached the same conclusion and installed a checker room for
 * its own showcases. Every output stays under
 * `DIELECTRIC_ENVIRONMENT_BOUND`, which every branch bound multiplies.
 */
const SKY_ZENITH: Vec3 = [0.34, 0.42, 0.62];
const SKY_HORIZON: Vec3 = [0.74, 0.76, 0.82];
const TILE_LIGHT: Vec3 = [0.92, 0.9, 0.85];
const TILE_DARK: Vec3 = [0.1, 0.11, 0.14];

function studio(origin: Vec3, dir: Vec3, radius: number): Vec3 {
  const g = Math.min(1, Math.max(0, dir[1] * 1.6 + 0.35));
  const sky: Vec3 = [
    SKY_HORIZON[0] + (SKY_ZENITH[0] - SKY_HORIZON[0]) * g,
    SKY_HORIZON[1] + (SKY_ZENITH[1] - SKY_HORIZON[1]) * g,
    SKY_HORIZON[2] + (SKY_ZENITH[2] - SKY_HORIZON[2]) * g,
  ];
  const floorY = -1.5 * radius;
  if (dir[1] >= -1e-6) return sky;
  const t = (floorY - origin[1]) / dir[1];
  if (!(t > 0)) return sky;
  const x = origin[0] + dir[0] * t;
  const z = origin[2] + dir[2] * t;
  const tile = 0.45 * radius;
  const dark = (Math.floor(x / tile) + Math.floor(z / tile)) & 1;
  const base = dark ? TILE_DARK : TILE_LIGHT;
  const f = Math.min(1, t / (18 * radius));
  const fade = f * f;
  return [
    base[0] + (sky[0] - base[0]) * fade,
    base[1] + (sky[1] - base[1]) * fade,
    base[2] + (sky[2] - base[2]) * fade,
  ];
}

// ------------------------------------------------------- the glass renderer

const REFUSAL_REASON = ["", "visit-cap", "invalid-input", "state-mismatch"];

interface GlassCounters {
  traces: number;
  complete: number;
  residual: number;
  unresolved: number;
  invalid: number;
  paths: number;
  phantoms: number;
  corrected: number;
  failures: Map<string, number>;
}

/** The maximum phantom-band skips one query will pay before giving up. */
const MAX_PHANTOM_SKIPS = 24;

function glassScene(
  solid: OpticalSolid,
  system: TransportFixtureSystem,
  radius: number,
  eps: number,
  counters: GlassCounters,
  medium: MediumRule,
): DielectricScene {
  return {
    nextBoundary(rawQuery): DielectricBoundaryResult {
      // THE MEDIUM RULE. "carried" is the production contract: the caller
      // owns the medium and the query only cross-checks it. "measured"
      // re-reads it from the family's EXACT membership predicate one
      // anchor-skip along the ray — legitimate only because this family HAS
      // one (it is not the sign inference the contract forbids for unsigned
      // estimators). The A/B is the sheet's second finding: carried loses
      // the medium on features thinner than the declared optical
      // resolution, which is most of a deep seed orbit.
      const query =
        medium === "carried"
          ? rawQuery
          : {
              ...rawQuery,
              inside: solid.contains([
                rawQuery.origin[0] + rawQuery.direction[0] * 2 * eps,
                rawQuery.origin[1] + rawQuery.direction[1] * 2 * eps,
                rawQuery.origin[2] + rawQuery.direction[2] * 2 * eps,
              ]),
            };
      if (medium === "measured" && query.inside !== rawQuery.inside)
        counters.corrected++;
      // THE MEMBERSHIP GATE — the finding this sheet exists to carry.
      //
      // The closed-solid query declares a crossing where the field's band
      // `|f| < eps` fires. That is exact for a signed DISTANCE, but this
      // family's field is a certified LOWER BOUND, and a lower bound dips
      // into the band wherever it is loose — near-kissing generators put a
      // near-cusp region at every tangency, where the bound reaches ~0 with
      // no surface there at all (the module's own "the depth-2 gap terms
      // reach 0 AT a tangency point ... where the estimate is 0 without
      // membership"). Unfiltered, each of those is a PHANTOM interface that
      // flips the caller's medium; the ray is then marked inside while
      // sitting in empty space, marches out of the domain, and the whole
      // trace fails `inside-miss` (measured: 65-98% of pixels, every panel
      // black).
      //
      // This family can settle it EXACTLY: `sphereInversionContains` is the
      // real membership predicate, not a threshold on a distance. A
      // crossing is real only if membership actually flips across it. The
      // shipped query text is untouched — the gate re-asks it past each
      // phantom.
      let origin: Vec3 = [...query.origin] as Vec3;
      let anchored = query.anchor !== null;
      let anchorPoint = (query.anchor?.p as Vec3 | undefined) ?? query.origin;
      let travelled = 0;
      for (let skip = 0; skip <= MAX_PHANTOM_SKIPS; skip++) {
        const r = transportSolidBoundaryQueryCPU(
          system,
          origin,
          query.direction,
          anchored,
          anchorPoint,
          query.inside,
          eps,
        );
        if (r.kind === "miss") {
          return { kind: "miss" };
        }
        if (r.kind === "refused")
          return {
            kind: "refused",
            reason: REFUSAL_REASON[r.reason] ?? "invalid-input",
          };
        const p: Vec3 = [
          origin[0] + query.direction[0] * r.t,
          origin[1] + query.direction[1] * r.t,
          origin[2] + query.direction[2] * r.t,
        ];
        const beyond: Vec3 = [
          p[0] + query.direction[0] * 2 * eps,
          p[1] + query.direction[1] * 2 * eps,
          p[2] + query.direction[2] * 2 * eps,
        ];
        if (solid.contains(beyond) === !query.inside) {
          return {
            kind: "boundary",
            t: travelled + r.t,
            entering: !query.inside,
            outwardNormal: r.normal,
            anchor: { p },
          };
        }
        counters.phantoms++;
        travelled += r.t + 2 * eps;
        origin = beyond;
        anchored = true;
        anchorPoint = p;
      }
      return { kind: "refused", reason: "visit-cap" };
    },
    rearRadiance: (origin, dir) => studio(origin, dir, radius),
    radianceBound: DIELECTRIC_ENVIRONMENT_BOUND,
    opticalField: (p) => system.estimate(p),
  };
}

interface PanelView {
  eye: Vec3;
  target: Vec3;
  zoom: number;
}

type MediumRule = "carried" | "measured";

interface GlassOptions {
  /** Panel raster, when a subject's cost needs its own (the 600-cell's fold
   * scans 120 generators per step, about 20x the octahedral arrangements'). */
  size?: number;
  /** The declared optical resolution as a fraction of the radius. The
   * production constant is `DIELECTRIC_CROSSING_EPS_REL` (1/512); this sheet
   * sweeps it because the object's own feature size is the thing it is
   * being matched against. */
  epsRel?: number;
  medium?: MediumRule;
  ior?: number;
  absorption?: Vec3;
  theta?: number;
  maxPaths?: number;
  maxSteps?: number;
}

/** One panel: glass through the oracle, or the matched opaque control. */
function panel(
  solid: OpticalSolid,
  radius: number,
  view: PanelView,
  mode: "glass" | "opaque",
  options: GlassOptions = {},
): { stats: PanelStats; counters: GlassCounters } {
  const field = (p: Vec3) => solid.field(p);
  const system: TransportFixtureSystem = {
    estimate: field,
    stepScale: 1,
    visibleRadius: radius,
  };
  const eps = (options.epsRel ?? DIELECTRIC_CROSSING_EPS_REL) * radius;
  const material: DielectricMaterial = {
    ior: options.ior ?? DIELECTRIC_IOR,
    absorption: options.absorption ?? DIELECTRIC_ABSORPTION,
    radius,
  };
  const counters: GlassCounters = {
    traces: 0,
    complete: 0,
    residual: 0,
    unresolved: 0,
    invalid: 0,
    paths: 0,
    phantoms: 0,
    corrected: 0,
    failures: new Map(),
  };
  const scene = glassScene(
    solid,
    system,
    radius,
    eps,
    counters,
    options.medium ?? "carried",
  );
  const maxPaths = options.maxPaths ?? 192;
  const previewScene: PreviewScene = {
    de: field,
    boundingRadius: radius,
    stepScale: 1,
    eye: view.eye,
    target: view.target,
    zoom: view.zoom,
    maxSteps: options.maxSteps ?? 400,
    ao: mode === "opaque",
    shadow: mode === "opaque",
    rayLinear: (ray) => {
      if (ray.status !== PREVIEW_HIT) return studio(ray.origin, ray.rd, radius);
      if (mode === "opaque") return ray.linear;
      // The transport starts at the MARCH'S OWN HIT, not at the eye: the
      // boundary query carries the production 192-step budget, and a query
      // asked to cross the whole empty approach from the camera spends it
      // before reaching the solid (measured — every trace refused
      // `visit-cap` and the panels came back black).
      const start: Vec3 = [
        ray.origin[0] + ray.rd[0] * ray.distance,
        ray.origin[1] + ray.rd[1] * ray.distance,
        ray.origin[2] + ray.rd[2] * ray.distance,
      ];
      const state = dielectricTrace(scene, start, ray.rd, material, {
        theta: options.theta,
        limits: { maxProcessedPaths: maxPaths, maxInterfaces: maxPaths },
      });
      counters.traces++;
      counters.paths += state.processedPaths;
      const key: DielectricTraceStatus = state.status;
      if (key === "complete") counters.complete++;
      else if (key === "residual") counters.residual++;
      else if (key === "unresolved") counters.unresolved++;
      else counters.invalid++;
      if (state.failure) {
        const label =
          state.failure.kind +
          (state.failure.reason ? `:${state.failure.reason}` : "");
        counters.failures.set(label, (counters.failures.get(label) ?? 0) + 1);
      }
      return state.radiance;
    },
  };
  return { stats: renderPreview(previewScene, SIZE), counters };
}

// --------------------------------------------------------- the soundness probe

/** The reference interior clearance: the largest inscribed radius among the
 * explicit orbit's pieces that contain `p`. A piece is an intersection of
 * generalized balls, so its own clearance is the min over members of each
 * member's exact interior distance; the union's clearance is at least the
 * best containing piece's. A sound field never reads MORE clearance than
 * this, and must agree on membership. */
function referenceClearance(
  pieces: readonly OrbitPiece[],
  p: readonly number[],
): number {
  let best = -1;
  for (const piece of pieces) {
    if (!pieceContains(piece, p)) continue;
    let inner = Infinity;
    for (const m of piece.members)
      inner = Math.min(inner, -oracleMemberSdf(m, p));
    if (inner > best) best = inner;
  }
  return best;
}

interface SceneSpec {
  name: string;
  construction: SphereInversionConstruction;
  radius: number;
}

function build(preset: keyof typeof PRESET_SPHERE_INVERSIONS): SceneSpec {
  const authored = PRESET_SPHERE_INVERSIONS[preset]!();
  const resolved = resolveSphereInversion(authored);
  if (!resolved.ok)
    throw new Error(`${String(preset)}: ${resolved.reasons.join("; ")}`);
  const de =
    resolved.construction.dim === 4
      ? buildSphereInversionDE4(resolved.construction)
      : buildSphereInversionDE(resolved.construction);
  return {
    name: String(preset),
    construction: resolved.construction,
    radius: de.boundingRadius,
  };
}

function atDepth(
  construction: SphereInversionConstruction,
  depth: number,
): SphereInversionConstruction {
  return { ...construction, depth };
}

/** A preset's authored camera as the preview's own framing. `zoom` is the
 * tangent of the half vertical FOV, which is what `renderPreview` scales its
 * ray offsets by. */
function presetView(name: string): PanelView {
  const view = PRESET_VIEWS[name as keyof typeof PRESET_VIEWS];
  if (!view) throw new Error(`no authored view for ${name}`);
  return {
    eye: [...view.camera.eye] as Vec3,
    target: [...view.camera.target] as Vec3,
    zoom: Math.tan((view.camera.fov * Math.PI) / 360),
  };
}

function report(label: string, stats: PanelStats, counters: GlassCounters) {
  const pct = (n: number) =>
    counters.traces > 0 ? ((100 * n) / counters.traces).toFixed(1) : "0.0";
  console.log(
    `  ${label.padEnd(26)} ${(stats.ms / 1000).toFixed(1)}s` +
      `  hits ${stats.hits}` +
      (counters.traces > 0
        ? `  complete ${pct(counters.complete)}%` +
          `  residual ${pct(counters.residual)}%` +
          `  unresolved ${pct(counters.unresolved)}%` +
          `  invalid ${pct(counters.invalid)}%` +
          `  paths/trace ${(counters.paths / counters.traces).toFixed(1)}` +
          `  phantoms/trace ${(counters.phantoms / counters.traces).toFixed(1)}` +
          (counters.corrected > 0
            ? `  medium corrections/trace ${(counters.corrected / counters.traces).toFixed(1)}`
            : "") +
          (counters.failures.size > 0
            ? `  [${[...counters.failures]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}]`
            : "")
        : ""),
  );
}

describe("sphere-inversion glass (the look gate)", () => {
  it("checks the prototype signed field against the explicit orbit", () => {
    const rows: string[] = [];
    for (const name of ["inversionPearls", "inversionLace"] as const) {
      const spec = build(name);
      // A shallow depth keeps the explicit enumeration affordable; the
      // transport law being checked is the fold's, not the depth's.
      const construction = atDepth(spec.construction, 3);
      const de = buildSphereInversionDE(construction);
      const field = signedField3(de);
      const pieces = enumerateSeedOrbit(construction);
      let inside = 0;
      let worstOver = 0;
      let membershipMismatch = 0;
      let samples = 0;
      let seed = 12345;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const R = spec.radius;
      for (let i = 0; i < 40000; i++) {
        const p: Vec3 = [
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
        ];
        const f = field(p);
        const member = referenceClearance(pieces, p) >= 0;
        samples++;
        if (member !== f < 0) {
          // The band where the field reads exactly 0 (a pole, a tangency
          // cusp, the surface itself) is not a disagreement.
          if (Math.abs(f) > 1e-12) membershipMismatch++;
          continue;
        }
        if (f < 0) {
          inside++;
          const reference = referenceClearance(pieces, p);
          const over = -f - reference;
          if (over > worstOver) worstOver = over;
        }
      }
      rows.push(
        `  ${spec.name.padEnd(16)} samples ${samples}  interior ${inside}` +
          `  membership mismatches ${membershipMismatch}` +
          `  worst clearance overshoot ${(worstOver / R).toExponential(3)} R`,
      );
    }
    console.log("\nPrototype signed field against the explicit orbit:");
    for (const row of rows) console.log(row);
  });

  it("pins the field's SIGN against the family's exact membership", () => {
    const spec = build("inversionPearls");
    for (const depth of [2, 4, 6, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const hit = makeSphereInversionHit();
      const R = de.boundingRadius;
      let seed = 987654321;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let negNotMember = 0;
      let posMember = 0;
      let neg = 0;
      let member = 0;
      let exhaustedNeg = 0;
      for (let i = 0; i < 200000; i++) {
        const p: Vec3 = [
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
        ];
        const f = shape.field(p);
        const inSolid = shape.contains(p);
        if (f < 0) neg++;
        if (inSolid) member++;
        if (f < 0 && !inSolid) {
          negNotMember++;
          sphereInversionHitInfo(de, p, 0, hit);
          if (hit.status !== 0) exhaustedNeg++;
        }
        if (f >= 0 && inSolid) posMember++;
      }
      console.log(
        `  depth ${depth}: negative ${neg}  member ${member}` +
          `  negative-but-not-member ${negNotMember} (fold not DOMAIN: ${exhaustedNeg})` +
          `  member-but-not-negative ${posMember}`,
      );
    }
  });

  it("pins the interior value as a STEPPING bound", () => {
    const spec = build("inversionPearls");
    for (const depth of [2, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const R = de.boundingRadius;
      const eps = DIELECTRIC_CROSSING_EPS_REL * R;
      let seed = 24680;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let interior = 0;
      let overstepped = 0;
      let worstRatio = 0;
      let bandWouldCatch = 0;
      for (let i = 0; i < 4000000 && interior < 4000; i++) {
        const p: Vec3 = [
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
          (rand() * 2 - 1) * R,
        ];
        if (!shape.contains(p)) continue;
        interior++;
        const f = shape.field(p);
        if (!(f < 0)) continue;
        const h = -f;
        // A random unit direction.
        let dx = rand() * 2 - 1;
        let dy = rand() * 2 - 1;
        let dz = rand() * 2 - 1;
        const n = Math.hypot(dx, dy, dz) || 1;
        dx /= n;
        dy /= n;
        dz /= n;
        const q: Vec3 = [p[0] + dx * h, p[1] + dy * h, p[2] + dz * h];
        if (!shape.contains(q)) {
          overstepped++;
          // How far past the true boundary did it land? Bisect for the exit.
          let lo = 0;
          let hi = h;
          for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2;
            const m: Vec3 = [p[0] + dx * mid, p[1] + dy * mid, p[2] + dz * mid];
            if (shape.contains(m)) lo = mid;
            else hi = mid;
          }
          const ratio = h / Math.max(lo, 1e-18);
          if (ratio > worstRatio) worstRatio = ratio;
          if (Math.abs(shape.field(q)) < eps) bandWouldCatch++;
        }
      }
      console.log(
        `  depth ${depth}: interior samples ${interior}` +
          `  oversteps ${overstepped}` +
          `  worst step/true-clearance ${worstRatio.toFixed(2)}x` +
          `  band would still catch ${bandWouldCatch}`,
      );
    }
  });

  it("renders the 3D subjects as glass beside their opaque controls", () => {
    const panels: PanelStats[] = [];
    console.log("\n3D subjects (glass through the transport oracle):");
    for (const name of [
      "inversionPearls",
      "inversionCubePearls",
      "inversionLace",
    ] as const) {
      const spec = build(name);
      const de = buildSphereInversionDE(spec.construction);
      const shape = solid3(de);
      const view = presetView(name);
      const opaque = panel(shape, spec.radius, view, "opaque");
      const glass = panel(shape, spec.radius, view, "glass");
      report(`${name} opaque`, opaque.stats, opaque.counters);
      report(`${name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-3d.png")}`,
    );
  });

  it("sweeps DEPTH, the parameter that decides whether the look survives", () => {
    const panels: PanelStats[] = [];
    console.log(
      "\nDepth sweep (inversionPearls, glass; the optical resolution is R/512):",
    );
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    for (const depth of [1, 2, 3, 4, 6, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const glass = panel(shape, de.boundingRadius, view, "glass");
      report(`depth ${depth}`, glass.stats, glass.counters);
      panels.push(glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "sphere-inversion-glass-depth.png")}`,
    );
  });

  it("A/Bs the carried medium against the family's exact membership", () => {
    const panels: PanelStats[] = [];
    console.log("\nMedium rule A/B (inversionPearls, glass):");
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    for (const depth of [4, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      for (const medium of ["carried", "measured"] as const) {
        const glass = panel(shape, de.boundingRadius, view, "glass", {
          medium,
        });
        report(`depth ${depth} ${medium}`, glass.stats, glass.counters);
        panels.push(glass.stats);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-medium.png")}`,
    );
  });

  it("sweeps the declared optical resolution against the object's features", () => {
    const panels: PanelStats[] = [];
    console.log("\nOptical resolution sweep (inversionPearls depth 6, glass):");
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    const de = buildSphereInversionDE(atDepth(spec.construction, 6));
    const shape = solid3(de);
    for (const [label, epsRel] of [
      ["R/512 (shipped)", 1 / 512],
      ["R/2048", 1 / 2048],
      ["R/8192", 1 / 8192],
      ["R/32768", 1 / 32768],
    ] as const) {
      const glass = panel(shape, de.boundingRadius, view, "glass", {
        epsRel,
      });
      report(label, glass.stats, glass.counters);
      panels.push(glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-eps.png")}`,
    );
  });

  it("renders at settings matched to the object (the sheet's verdict panels)", () => {
    const panels: PanelStats[] = [];
    console.log(
      "\nMatched settings (optical resolution R/8192, 2048-path budget):",
    );
    const options: GlassOptions = { epsRel: 1 / 8192, maxPaths: 2048 };
    for (const [name, depth] of [
      ["inversionPearls", 6],
      ["inversionCubePearls", 6],
    ] as const) {
      const spec = build(name);
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const view = presetView(name);
      const opaque = panel(shape, de.boundingRadius, view, "opaque");
      const glass = panel(shape, de.boundingRadius, view, "glass", options);
      report(`${name} opaque`, opaque.stats, opaque.counters);
      report(`${name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-matched.png")}`,
    );
  });

  it("renders the native posed 4D slices as glass beside their controls", () => {
    // THE 4D ARM'S FIXTURES ARE THIS SHEET'S OWN, and the reason is cost,
    // not parity: both shipped 4D presets use `cell600`, whose fold scans
    // 120 generators at every march step — about 20x an octahedral
    // arrangement's per-evaluation cost — and a single 48px glass panel of
    // one did not finish in two minutes of CPU. The 4D arm therefore uses
    // the cheap 4D arrangements at the depth the sweep says the look lives
    // at. The GEOMETRY QUESTION is unchanged: a posed slice, zero slab
    // thickness, the 4D field read through the app's own `lift4`, and the
    // 4D module's own reason that a 4D bound is a valid in-slice bound.
    const panels: PanelStats[] = [];
    console.log("\n4D subjects (posed slice, zero slab thickness):");
    const options: GlassOptions = {
      epsRel: 1 / 8192,
      maxPaths: 512,
      size: SIZE_4D,
    };
    const pose: { planes: [RotorPlane, number][]; w0: number } = {
      planes: [["xw", 0.3]],
      w0: 0.1,
    };
    const view: PanelView = {
      eye: [1.32, 0.96, 1.56],
      target: [0, 0, 0],
      zoom: Math.tan((62 * Math.PI) / 360),
    };
    const fixtures: { name: string; authored: SphereInversionAuthored }[] = [
      {
        name: "cross8 ball d3",
        authored: {
          arrangement: "cross8",
          radiusFraction: 0.99,
          seed: { kind: "ball", size: 0.42 },
          depth: 3,
        },
      },
      {
        name: "tess16 shell d2",
        authored: {
          arrangement: "tess16",
          radiusFraction: 0.99,
          seed: { kind: "shell", size: 1, thickness: 0.06 },
          depth: 2,
        },
      },
    ];
    for (const fixture of fixtures) {
      const resolved = resolveSphereInversion(fixture.authored);
      if (!resolved.ok)
        throw new Error(`${fixture.name}: ${resolved.reasons.join("; ")}`);
      const de = buildSphereInversionDE4(resolved.construction);
      const shape = solid4(de, pose.planes, pose.w0);
      const opaque = panel(shape, de.boundingRadius, view, "opaque", {
        size: options.size,
      });
      const glass = panel(shape, de.boundingRadius, view, "glass", options);
      report(`${fixture.name} opaque`, opaque.stats, opaque.counters);
      report(`${fixture.name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-4d.png")}`,
    );
  });
});
