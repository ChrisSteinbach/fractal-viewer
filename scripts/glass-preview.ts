/**
 * The shared CPU GLASS RENDERER for the look-gate sheets: a studio rear
 * scene (checker floor under a two-stop sky), a membership-gated boundary
 * scene over the closed-solid query's f64 twin, and one panel function that
 * traces every primary hit through `surface-dielectric.ts`'s
 * `dielectricTrace` — the ONE transport oracle — or shades it opaque as the
 * matched control. Primary rays, normals, lighting and PNG assembly are
 * `de-preview.ts`'s; a sheet supplies its SOLID (a signed field, exact
 * membership and optionally an exact normal) and its panel list, never a
 * renderer of its own.
 *
 * Extracted from `sphere-inversion-glass.harness.ts` unchanged, so that
 * sheet's panels are byte-identical through it; the membership gate's
 * reasoning (why a certified lower bound needs exact membership to reject
 * phantom crossings) is documented where it is applied below.
 */
import {
  PREVIEW_HIT,
  renderPreview,
  type PanelStats,
  type PreviewScene,
  type Vec3,
} from "./de-preview";
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

export interface OpticalSolid {
  /** The SHIPPED signed field. */
  field(p: Vec3): number;
  /** EXACT membership in the displayed solid — the family's own predicate,
   * never a threshold on a distance. */
  contains(p: Vec3): boolean;
  /** The EXACT Möbius normal (`sphereInversionSignedNormal`), for the
   * normal A/B; null where the field has none and the taps stand in. */
  normal(p: Vec3): Vec3 | null;
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

export function studio(origin: Vec3, dir: Vec3, radius: number): Vec3 {
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

export interface GlassCounters {
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

export function glassScene(
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

export interface PanelView {
  eye: Vec3;
  target: Vec3;
  zoom: number;
}

export type MediumRule = "carried" | "measured";

export interface GlassOptions {
  /** A caller's own raster bookkeeping: {@link glassPanel} renders at its
   * `size` argument and never reads this (the sphere-inversion sheet's 4D
   * rows set it and render at that sheet's SIZE, as they always have). */
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
  /** The boundary query's normals from the exact Möbius normal instead of
   * the kernel's tetrahedron taps (the normal A/B). */
  exactNormal?: boolean;
}

/** One panel: glass through the oracle, or the matched opaque control. */
export function glassPanel(
  solid: OpticalSolid,
  radius: number,
  view: PanelView,
  mode: "glass" | "opaque",
  size: number,
  options: GlassOptions = {},
): { stats: PanelStats; counters: GlassCounters } {
  const field = (p: Vec3) => solid.field(p);
  const system: TransportFixtureSystem = {
    estimate: field,
    stepScale: 1,
    visibleRadius: radius,
    ...(options.exactNormal ? { normal: (p: Vec3) => solid.normal(p) } : {}),
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
  return { stats: renderPreview(previewScene, size), counters };
}

export function report(
  label: string,
  stats: PanelStats,
  counters: GlassCounters,
) {
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
