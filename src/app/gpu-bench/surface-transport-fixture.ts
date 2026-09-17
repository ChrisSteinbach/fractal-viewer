import type { Vec3 } from "../../fractal/types";
import {
  DIELECTRIC_ANCHOR_ENVELOPE_REL,
  DIELECTRIC_CROSSING_EPS_REL,
  type DielectricMaterial,
  dielectricBeerThroughput,
  dielectricBranchBound,
  dielectricFresnel,
  dielectricRefract,
} from "../../fractal/surface-dielectric";
import {
  SURFACE_GPU_TRANSPORT_MAX_INTERFACES,
  SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS,
  SURFACE_GPU_TRANSPORT_SHADOW_STEPS,
} from "../../fractal/surface-de-gpu";

/**
 * The CPU twin of the compute transport's boundary query and trace — the
 * agreement fixture the bench legs pin the WGSL against, per core.
 *
 * Every rule here is MIRRORED, not restated: the crossing scale, anchor
 * envelope and step budget come from `surface-dielectric.ts`'s production
 * constants; the optics (Fresnel, Snell/TIR, Beer, branch bounds) are the
 * oracle's own f64 functions; the caps are the runtime's exported
 * constants. What the twin OWNS is the estimator ADAPTER — the composed
 * public estimator of whichever core the fixture drives, called at the
 * same cutoff (0) and with the same step scale the kernel reads from
 * params. 4D adapters evaluate the 4D estimator at the fixture's frozen
 `w0` with an identity rotor — the canonical pose, whose lift is the
 * identity the kernel also applies; the posed-lift agreement is the
 * existing 4D legs' and the end-to-end leg's, not this fixture's.
 *
 * The domain gate mirrors the kernel's non-balloon, non-lattice arm (the
 * visible sphere at `visibleRadius * 1.02`): the agreement fixtures drive
 * plain systems — wrappers are pinned by their own legs.
 */

/** One fixture system: the composed estimator and its march step scale. */
export interface TransportFixtureSystem {
  /** The composed PUBLIC estimator at cutoff 0 — the exact call the
   * kernel's `surfaceDE(p, 0.0, li)` spells per core. */
  estimate(p: Vec3): number;
  /** The march's step scale (`params.stepScale`): 1 for the descent
   * cores, the family's own damping for the forward ones. */
  stepScale: number;
  /** The domain radius (`params.visibleRadius`). */
  visibleRadius: number;
}

export const TRANSPORT_QUERY_MAX_STEPS = 192;

export type TransportBoundaryKind = "boundary" | "miss" | "refused";

export interface TransportBoundaryResult {
  kind: TransportBoundaryKind;
  reason: number;
  t: number;
  normal: Vec3;
}

/** The kernel's `transportDomainExit`, non-balloon non-lattice arm. */
function domainExit(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
): number {
  const radius = system.visibleRadius * 1.02;
  const bq = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2];
  const cq =
    origin[0] * origin[0] +
    origin[1] * origin[1] +
    origin[2] * origin[2] -
    radius * radius;
  const disc = bq * bq - cq;
  if (disc < 0) return -1;
  return -bq + Math.sqrt(disc);
}

/** The kernel's `transportOpticalNormal`: tetrahedron taps at the optical
 * scale, incident-facing fallback on a vanishing gradient. */
export function transportOpticalNormal(
  system: TransportFixtureSystem,
  p: Vec3,
  dir: Vec3,
  eps: number,
): Vec3 {
  const e = 0.5773;
  const ex: Vec3 = [e, -e, -e];
  const ey: Vec3 = [-e, -e, e];
  const ez: Vec3 = [-e, e, -e];
  const ew: Vec3 = [e, e, e];
  const tap = (o: Vec3) =>
    system.estimate([p[0] + o[0] * eps, p[1] + o[1] * eps, p[2] + o[2] * eps]);
  const gx =
    tap(ex) * ex[0] + tap(ey) * ey[0] + tap(ez) * ez[0] + tap(ew) * ew[0];
  const gy =
    tap(ex) * ex[1] + tap(ey) * ey[1] + tap(ez) * ez[1] + tap(ew) * ew[1];
  const gz =
    tap(ex) * ex[2] + tap(ey) * ey[2] + tap(ez) * ez[2] + tap(ew) * ew[2];
  const m = Math.hypot(gx, gy, gz);
  if (!(m > 1e-12)) return [-dir[0], -dir[1], -dir[2]];
  return [gx / m, gy / m, gz / m];
}

/** The kernel's `transportNextBoundary`, f64. */
export function transportBoundaryQueryCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  anchorPresent: boolean,
  anchorPoint: Vec3,
  eps: number,
): TransportBoundaryResult {
  let px = origin[0];
  let py = origin[1];
  let pz = origin[2];
  let t = 0;
  if (anchorPresent) {
    const skip = 2 * eps;
    px += dir[0] * skip;
    py += dir[1] * skip;
    pz += dir[2] * skip;
    t += skip;
  }
  const tFar = domainExit(system, origin, dir);
  for (let i = 0; i < TRANSPORT_QUERY_MAX_STEPS; i++) {
    if (tFar < 0 || t >= tFar) {
      return { kind: "miss", reason: 0, t, normal: [0, 0, 0] };
    }
    const d = system.estimate([px, py, pz]);
    if (!Number.isFinite(d) || d <= -1e30) {
      return { kind: "refused", reason: 2, t, normal: [0, 0, 0] };
    }
    const dd = Math.max(d, 0);
    if (dd < eps) {
      const hx = px + dir[0] * dd;
      const hy = py + dir[1] * dd;
      const hz = pz + dir[2] * dd;
      const tc = t + dd;
      if (
        anchorPresent &&
        Math.hypot(
          hx - anchorPoint[0],
          hy - anchorPoint[1],
          hz - anchorPoint[2],
        ) <=
          DIELECTRIC_ANCHOR_ENVELOPE_REL * eps
      ) {
        const skip = 2 * eps;
        px = hx + dir[0] * skip;
        py = hy + dir[1] * skip;
        pz = hz + dir[2] * skip;
        t = tc + skip;
        continue;
      }
      return {
        kind: "boundary",
        reason: 0,
        t: tc,
        normal: transportOpticalNormal(system, [hx, hy, hz], dir, eps),
      };
    }
    const step = d * system.stepScale;
    px += dir[0] * step;
    py += dir[1] * step;
    pz += dir[2] * step;
    t += step;
  }
  return { kind: "refused", reason: 1, t, normal: [0, 0, 0] };
}

/**
 * The closed-solid boundary query, f64 — the twin of the kernel's
 * `opticsBackend: "closedSolid"` emission. Same march structure as
 * {@link transportBoundaryQueryCPU}, over the SIGNED closed-solid field
 * (the system's `estimate` is now the union field: negative inside the
 * optical solid, positive outside, zero only at its surface), with three
 * differences the sign unlocks:
 *
 * 1. **Inside traversal.** Outside, the field understates the distance to
 *    the solid (the certified conservative bound) and the march steps it
 *    forward. Inside, `|f|` is the deepest containing part's certified
 *    depth, which bounds the distance to the union's complement — the
 *    merged interval along the ray ends at the LAST containing part's
 *    exit — so stepping `|f|` cannot cross the boundary without sampling
 *    its band. The estimator march's inside crawl (unsigned `d = 0`
 *    everywhere inside, the anchor suppression advancing `2·eps` per
 *    step into the visit cap) has no signed analog: the first steps are
 *    small and grow geometrically away from the entry wall.
 * 2. **The medium cross-check.** The caller's `inside` is checked against
 *    the field's own membership at the anchored restart: beyond the
 *    anchor envelope (`DIELECTRIC_ANCHOR_ENVELOPE_REL·eps`, within which
 *    the boundary's own band is consistent with either medium) a
 *    contradiction refuses `state-mismatch` (reason 3) — the qualified
 *    fixture's exact-occupancy discipline, made real by the signed field.
 * 3. **The crossing band is two-sided.** `|f| < eps` crosses from either
 *    side; the reported advance stays `max(f, 0)` (an inside crossing is
 *    reported at the query point, an outside one at the band's edge).
 *
 * The anchor envelope, crossing scale, step budget, domain gate and
 * normal taps are the SAME definitions the estimator query imports.
 */
export function transportSolidBoundaryQueryCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  anchorPresent: boolean,
  anchorPoint: Vec3,
  inside: boolean,
  eps: number,
): TransportBoundaryResult {
  let px = origin[0];
  let py = origin[1];
  let pz = origin[2];
  let t = 0;
  if (anchorPresent) {
    const skip = 2 * eps;
    px += dir[0] * skip;
    py += dir[1] * skip;
    pz += dir[2] * skip;
    t += skip;
    const f0 = system.estimate([px, py, pz]);
    if (
      Number.isFinite(f0) &&
      ((inside && f0 > DIELECTRIC_ANCHOR_ENVELOPE_REL * eps) ||
        (!inside && f0 < -DIELECTRIC_ANCHOR_ENVELOPE_REL * eps))
    ) {
      return { kind: "refused", reason: 3, t, normal: [0, 0, 0] };
    }
  }
  const tFar = domainExit(system, origin, dir);
  for (let i = 0; i < TRANSPORT_QUERY_MAX_STEPS; i++) {
    if (tFar < 0 || t >= tFar) {
      return { kind: "miss", reason: 0, t, normal: [0, 0, 0] };
    }
    const f = system.estimate([px, py, pz]);
    if (!Number.isFinite(f) || f <= -1e30) {
      return { kind: "refused", reason: 2, t, normal: [0, 0, 0] };
    }
    if (Math.abs(f) < eps) {
      const dd = Math.max(f, 0);
      const hx = px + dir[0] * dd;
      const hy = py + dir[1] * dd;
      const hz = pz + dir[2] * dd;
      const tc = t + dd;
      if (
        anchorPresent &&
        Math.hypot(
          hx - anchorPoint[0],
          hy - anchorPoint[1],
          hz - anchorPoint[2],
        ) <=
          DIELECTRIC_ANCHOR_ENVELOPE_REL * eps
      ) {
        const skip = 2 * eps;
        px = hx + dir[0] * skip;
        py = hy + dir[1] * skip;
        pz = hz + dir[2] * skip;
        t = tc + skip;
        continue;
      }
      return {
        kind: "boundary",
        reason: 0,
        t: tc,
        normal: transportOpticalNormal(system, [hx, hy, hz], dir, eps),
      };
    }
    const stride = Math.abs(f) * system.stepScale;
    px += dir[0] * stride;
    py += dir[1] * stride;
    pz += dir[2] * stride;
    t += stride;
  }
  return { kind: "refused", reason: 1, t, normal: [0, 0, 0] };
}

export type TransportTraceStatus =
  "pending" | "complete" | "residual" | "unresolved" | "invalid";

export interface TransportTraceResult {
  radiance: Vec3;
  residual: number;
  status: TransportTraceStatus;
  failure: number;
  reason: number;
}

const ENVIRONMENT_BOUND = 4;

interface FixturePath {
  origin: Vec3;
  dir: Vec3;
  energy: Vec3;
  inside: boolean;
  interfaces: number;
  anchorPresent: boolean;
  anchorPoint: Vec3;
  bound: number;
}

/** A backend-supplied boundary query, used by the trace in place of
 * {@link transportBoundaryQueryCPU}. The closed-solid twin passes
 * {@link transportSolidBoundaryQueryCPU} here — the extra `inside`
 * argument is the medium state the estimator query is sign-agnostic
 * about but the signed query cross-checks. */
export type TransportQueryFn = (
  origin: Vec3,
  dir: Vec3,
  anchorPresent: boolean,
  anchorPoint: Vec3,
  inside: boolean,
  eps: number,
) => TransportBoundaryResult;

/** The kernel's `transportTrace`, f64: the primary split at the march's
 * own hit, then the oracle's work-list loop over the twin boundary query.
 * `caps` mirrors the kernel's `transportMaxPaths` option — both engines
 * must run the SAME budget, so the leg passes the value it compiled the
 * kernel with; omitted, the shipped runtime caps. `query` swaps the
 * boundary backend (the closed-solid emission's twin); the loop text is
 * otherwise the kernel's, term for term. */
export function transportTraceCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  theta: number,
  material: DielectricMaterial,
  bgLinear: Vec3,
  caps?: { maxProcessedPaths: number; maxInterfaces: number },
  query?: TransportQueryFn,
): TransportTraceResult {
  const maxProcessed =
    caps?.maxProcessedPaths ?? SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS;
  const maxInterfaces =
    caps?.maxInterfaces ?? SURFACE_GPU_TRANSPORT_MAX_INTERFACES;
  const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
  const stack: FixturePath[] = [];
  let radiance: Vec3 = [0, 0, 0];
  let residual = 0;
  let processed = 0;
  const push = (child: FixturePath): boolean => {
    if (child.bound <= theta) {
      residual += child.bound;
      return true;
    }
    if (stack.length >= 24) {
      residual += child.bound;
      return false;
    }
    stack.push(child);
    return true;
  };
  // --- the primary split (the march's own hit, entering from outside) ---
  const n0 = transportOpticalNormal(system, origin, dir, eps);
  const cosI0 = Math.abs(dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]);
  const f0 = dielectricFresnel(cosI0, 1, material.ior);
  const bend0 = dielectricRefract(dir, n0, 1, material.ior);
  const reflDir0: Vec3 = [
    dir[0] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[0],
    dir[1] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[1],
    dir[2] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[2],
  ];
  const refl0: FixturePath = {
    origin,
    dir: reflDir0,
    energy: [f0, f0, f0],
    inside: false,
    interfaces: 1,
    anchorPresent: true,
    anchorPoint: origin,
    bound: dielectricBranchBound([f0, f0, f0], ENVIRONMENT_BOUND),
  };
  const refr0: FixturePath = {
    origin,
    dir: bend0.direction,
    energy: [1 - f0, 1 - f0, 1 - f0],
    inside: true,
    interfaces: 1,
    anchorPresent: true,
    anchorPoint: origin,
    bound: dielectricBranchBound([1 - f0, 1 - f0, 1 - f0], ENVIRONMENT_BOUND),
  };
  const first0 = refl0.bound >= refr0.bound ? refl0 : refr0;
  const second0 = first0 === refl0 ? refr0 : refl0;
  if (!push(first0)) {
    return { radiance, residual, status: "unresolved", failure: 3, reason: 0 };
  }
  if (!push(second0)) {
    return { radiance, residual, status: "unresolved", failure: 3, reason: 0 };
  }
  // --- the oracle's work-list loop ---
  let status: TransportTraceStatus = "pending";
  let failure = 0;
  let reason = 0;
  loop: while (stack.length > 0) {
    const path = stack.pop() as FixturePath;
    if (path.bound <= theta) {
      residual += path.bound;
      continue;
    }
    if (processed >= maxProcessed) {
      residual += path.bound;
      status = "unresolved";
      failure = 1;
      break;
    }
    if (path.interfaces >= maxInterfaces) {
      residual += path.bound;
      status = "unresolved";
      failure = 2;
      break;
    }
    processed++;
    const hit = query
      ? query(
          path.origin,
          path.dir,
          path.anchorPresent,
          path.anchorPoint,
          path.inside,
          eps,
        )
      : transportBoundaryQueryCPU(
          system,
          path.origin,
          path.dir,
          path.anchorPresent,
          path.anchorPoint,
          eps,
        );
    if (hit.kind === "refused") {
      residual += path.bound;
      status = "unresolved";
      failure = 4;
      reason = hit.reason;
      break;
    }
    if (hit.kind === "miss") {
      if (path.inside) {
        residual += path.bound;
        status = "unresolved";
        failure = 5;
        break;
      }
      radiance = [
        radiance[0] + bgLinear[0] * path.energy[0],
        radiance[1] + bgLinear[1] * path.energy[1],
        radiance[2] + bgLinear[2] * path.energy[2],
      ];
      if (!radiance.every(Number.isFinite)) {
        status = "invalid";
        break loop;
      }
      continue;
    }
    const n = hit.normal;
    const dot = path.dir[0] * n[0] + path.dir[1] * n[1] + path.dir[2] * n[2];
    const energy: Vec3 = path.inside
      ? [
          path.energy[0] *
            dielectricBeerThroughput(
              material.absorption[0],
              hit.t,
              material.radius,
            ),
          path.energy[1] *
            dielectricBeerThroughput(
              material.absorption[1],
              hit.t,
              material.radius,
            ),
          path.energy[2] *
            dielectricBeerThroughput(
              material.absorption[2],
              hit.t,
              material.radius,
            ),
        ]
      : [...path.energy];
    const childOrigin: Vec3 = [
      path.origin[0] + hit.t * path.dir[0],
      path.origin[1] + hit.t * path.dir[1],
      path.origin[2] + hit.t * path.dir[2],
    ];
    const fromIor = path.inside ? material.ior : 1;
    const toIor = path.inside ? 1 : material.ior;
    const bend = dielectricRefract(path.dir, n, fromIor, toIor);
    const makeChild = (
      childEnergy: Vec3,
      direction: Vec3,
      inside: boolean,
    ): FixturePath => ({
      origin: childOrigin,
      dir: direction,
      energy: childEnergy,
      inside,
      interfaces: path.interfaces + 1,
      anchorPresent: true,
      anchorPoint: childOrigin,
      bound: dielectricBranchBound(childEnergy, ENVIRONMENT_BOUND),
    });
    if (bend.tir) {
      const child = makeChild(energy, bend.direction, path.inside);
      if (!push(child)) {
        status = "unresolved";
        failure = 3;
        break;
      }
      continue;
    }
    const f = dielectricFresnel(Math.abs(dot), fromIor, toIor);
    const transmitted = makeChild(
      [energy[0] * (1 - f), energy[1] * (1 - f), energy[2] * (1 - f)],
      bend.direction,
      !path.inside,
    );
    const reflected = makeChild(
      [energy[0] * f, energy[1] * f, energy[2] * f],
      [
        path.dir[0] - 2 * dot * n[0],
        path.dir[1] - 2 * dot * n[1],
        path.dir[2] - 2 * dot * n[2],
      ],
      path.inside,
    );
    const first =
      reflected.bound >= transmitted.bound ? reflected : transmitted;
    const second = first === reflected ? transmitted : reflected;
    if (!push(first)) {
      status = "unresolved";
      failure = 3;
      break;
    }
    if (!push(second)) {
      status = "unresolved";
      failure = 3;
      break;
    }
  }
  if (status === "pending" && stack.length === 0) {
    status = residual > 0 ? "residual" : "complete";
  }
  return { radiance, residual, status, failure, reason };
}

/** The corridor's analytic gate values for one shadow ray — the emitted
 * `transportShadowVisibility`'s own fast path, mirrored so the leg's
 * probes can predict the gate answer without marching: ball-behind
 * (along <= 0) and a closest approach clearing `1.05 R + 0.3 * along`
 * certify the ray misses the certified ball entirely. */
export function transportShadowCorridorGate(
  origin: Vec3,
  dir: Vec3,
  ballC: Vec3,
  ballR: number,
): boolean {
  const toC: Vec3 = [
    ballC[0] - origin[0],
    ballC[1] - origin[1],
    ballC[2] - origin[2],
  ];
  const along = toC[0] * dir[0] + toC[1] * dir[1] + toC[2] * dir[2];
  const perp2 =
    toC[0] * toC[0] + toC[1] * toC[1] + toC[2] * toC[2] - along * along;
  const corridor = ballR * 1.05 + 0.3 * along;
  return along > 0 && perp2 < corridor * corridor;
}

/**
 * The kernel's closed-solid `transportShadowVisibility`, f64: the floor
 * corridor's shadow ray through the session's optical solid — a bounded
 * march of the SIGNED field along an UNREFRACTED ray, pairing the
 * solid's crossings. Each entry pays (1 - Fresnel) into a per-channel
 * transmittance, Beer attenuates over the traversed interior, each exit
 * pays (1 - Fresnel), and a total-internal-reflection exit contributes
 * nothing straight through. Bounded work: interior strides are |f| (the
 * certified depth bound), the runtime's shadow budget paces the march,
 * and an exhausted march returns the transmittance accumulated so far —
 * the over-report both engines share. The corridor's analytic gates ride
 * at the top (the fast path that certifies transmittance 1 with zero
 * field evals). The material is the leg's own (the kernel reads slot 0's
 * opticsMaps lanes; the leg packs that one-slot wire with the same
 * numbers), and the ball/step parameters mirror the packed params.
 */
export function transportShadowVisibilityCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  material: DielectricMaterial,
  ballC: Vec3,
  ballR: number,
  visR: number,
  stepScale = system.stepScale,
): Vec3 {
  if (!transportShadowCorridorGate(origin, dir, ballC, ballR)) {
    return [1, 1, 1];
  }
  const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
  const solidField = (p: Vec3): number => system.estimate(p);
  const normal = (p: Vec3): Vec3 => {
    const e = 0.5773;
    const ex: Vec3 = [e, -e, -e];
    const ey: Vec3 = [-e, -e, e];
    const ez: Vec3 = [-e, e, -e];
    const ew: Vec3 = [e, e, e];
    const tap = (o: Vec3) =>
      solidField([p[0] + o[0] * eps, p[1] + o[1] * eps, p[2] + o[2] * eps]);
    const gx =
      tap(ex) * ex[0] + tap(ey) * ey[0] + tap(ez) * ez[0] + tap(ew) * ew[0];
    const gy =
      tap(ex) * ex[1] + tap(ey) * ey[1] + tap(ez) * ez[1] + tap(ew) * ew[1];
    const gz =
      tap(ex) * ex[2] + tap(ey) * ey[2] + tap(ez) * ez[2] + tap(ew) * ew[2];
    const m = Math.hypot(gx, gy, gz);
    if (!(m > 1e-12)) return [-dir[0], -dir[1], -dir[2]];
    return [gx / m, gy / m, gz / m];
  };
  const clamp = (x: number, lo: number, hi: number): number =>
    Math.min(Math.max(x, lo), hi);
  let trans: Vec3 = [1, 1, 1];
  let inside = solidField(origin) < 0;
  let cosEnter = 1;
  let segStart = 0;
  let ts = ballR * 4.0e-4;
  for (let i = 0; i < SURFACE_GPU_TRANSPORT_SHADOW_STEPS; i++) {
    const sp: Vec3 = [
      origin[0] + dir[0] * ts,
      origin[1] + dir[1] * ts,
      origin[2] + dir[2] * ts,
    ];
    const f = solidField(sp);
    if (!(f > -1e30)) break;
    if (Math.abs(f) < eps) {
      // The declared crossing band: the boundary is here, within the
      // declared resolution. Fire the state's crossing, then step past
      // the band (the anchor suppression's own 2·eps skip).
      if (inside) {
        const n = normal(sp);
        const segLen = ts - segStart;
        const exitPass =
          1 -
          dielectricFresnel(
            Math.abs(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]),
            material.ior,
            1,
          );
        const entryPass = 1 - dielectricFresnel(cosEnter, 1, material.ior);
        trans = [
          trans[0] *
            dielectricBeerThroughput(
              material.absorption[0],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
          trans[1] *
            dielectricBeerThroughput(
              material.absorption[1],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
          trans[2] *
            dielectricBeerThroughput(
              material.absorption[2],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
        ];
        cosEnter = 1;
        inside = false;
        if (Math.max(Math.max(trans[0], trans[1]), trans[2]) <= 0) break;
      } else {
        inside = true;
        segStart = ts;
        const n = normal(sp);
        cosEnter = Math.abs(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]);
      }
      ts += 2 * eps;
      continue;
    }
    if ((f < 0 ? 1 : 0) !== (inside ? 1 : 0)) {
      // A stride jumped clean across the band: the crossing happened
      // between the samples; report it here.
      if (inside) {
        const n = normal(sp);
        const segLen = ts - segStart;
        const exitPass =
          1 -
          dielectricFresnel(
            Math.abs(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]),
            material.ior,
            1,
          );
        const entryPass = 1 - dielectricFresnel(cosEnter, 1, material.ior);
        trans = [
          trans[0] *
            dielectricBeerThroughput(
              material.absorption[0],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
          trans[1] *
            dielectricBeerThroughput(
              material.absorption[1],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
          trans[2] *
            dielectricBeerThroughput(
              material.absorption[2],
              segLen,
              material.radius,
            ) *
            (entryPass * exitPass),
        ];
        if (Math.max(Math.max(trans[0], trans[1]), trans[2]) <= 0) break;
      } else {
        segStart = ts;
        const n = normal(sp);
        cosEnter = Math.abs(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]);
      }
      inside = f < 0;
    }
    ts += clamp(Math.abs(f) * stepScale, ballR * 2.0e-4, visR);
    const rx = sp[0] - ballC[0];
    const ry = sp[1] - ballC[1];
    const rz = sp[2] - ballC[2];
    if (rx * dir[0] + ry * dir[1] + rz * dir[2] > 0) {
      if (Math.hypot(rx, ry, rz) > ballR * 1.05) break;
    }
  }
  if (inside) {
    const segLen = ts - segStart;
    const entryPass = 1 - dielectricFresnel(cosEnter, 1, material.ior);
    trans = [
      trans[0] *
        dielectricBeerThroughput(
          material.absorption[0],
          segLen,
          material.radius,
        ) *
        entryPass,
      trans[1] *
        dielectricBeerThroughput(
          material.absorption[1],
          segLen,
          material.radius,
        ) *
        entryPass,
      trans[2] *
        dielectricBeerThroughput(
          material.absorption[2],
          segLen,
          material.radius,
        ) *
        entryPass,
    ];
  }
  return [
    Math.min(Math.max(trans[0], 0), 1),
    Math.min(Math.max(trans[1], 0), 1),
    Math.min(Math.max(trans[2], 0), 1),
  ];
}
