import type { Vec3 } from "../../fractal/types";
import {
  type FiniteSolidAnchor,
  type FiniteSolidConstruction,
  type FiniteSolidPose,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
} from "../../fractal/finite-solid";
import {
  DIELECTRIC_ANCHOR_ENVELOPE_REL,
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_DISTORTION_NORMAL_REL,
  DIELECTRIC_MAX_PROCESSED_PATHS,
  DIELECTRIC_MAX_INTERFACES,
  type DielectricMaterial,
  dielectricBeerThroughput,
  dielectricBranchBound,
  dielectricFresnel,
  dielectricRefract,
  dielectricSlabDisplacement,
  dielectricSmoothedNormal,
} from "../../fractal/surface-dielectric";
import {
  SURFACE_GPU_TRANSPORT_MAX_INTERFACES,
  SURFACE_GPU_TRANSPORT_MEMBERSHIP_BISECT_STEPS,
  SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS,
  SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT,
  SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH,
  SURFACE_GPU_TRANSPORT_REASON_VISIT_CAP,
  SURFACE_GPU_TRANSPORT_SHADOW_STEPS,
} from "../../fractal/surface-de-gpu";

// Re-exported for the bench legs and their tests: the DDA's reason
// vocabulary, shared with the kernel's emitted literals.
export {
  SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT,
  SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH,
  SURFACE_GPU_TRANSPORT_REASON_VISIT_CAP,
};

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

/** One fixture system: the composed estimator and its march step scale.
 *
 * `contains` is the OPTIONAL exact membership predicate, and it exists for
 * one family: the sphere-inversion seed orbit, whose field is a certified
 * LOWER BOUND rather than a signed distance. A band test `|f| < eps` is a
 * boundary test for a distance; for a bound it fires wherever the bound is
 * merely LOOSE, and a near-kissing arrangement puts a near-cusp at every
 * tangency where the bound reaches ~0 with no surface there at all. Those
 * phantom crossings flip the caller's medium, and a path marked inside while
 * sitting in empty space marches out of the domain and fails the whole trace
 * `inside-miss` (measured on the look gate: 65-98% of pixels, every panel
 * black — `scripts/sphere-inversion-glass.harness.ts`).
 *
 * The family settles it EXACTLY: `sphereInversionContains` is real
 * membership, not a threshold on a distance, so a crossing is real only if
 * membership actually FLIPS across it. Absent — every closed-solid and
 * estimator caller — the queries below run their existing path, and the
 * gate's branches are not reached. */
export interface TransportFixtureSystem {
  /** The composed PUBLIC estimator at cutoff 0 — the exact call the
   * kernel's `surfaceDE(p, 0.0, li)` spells per core. */
  estimate(p: Vec3): number;
  /** The march's step scale (`params.stepScale`): 1 for the descent
   * cores, the family's own damping for the forward ones. */
  stepScale: number;
  /** The domain radius (`params.visibleRadius`). */
  visibleRadius: number;
  /** Exact membership in the displayed solid, for a field that is a
   * certified bound rather than a signed distance (interface doc). */
  contains?: (p: Vec3) => boolean;
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
  anchorPresentIn: boolean,
  anchorPointIn: Vec3,
  inside: boolean,
  eps: number,
): TransportBoundaryResult {
  let anchorPresent = anchorPresentIn;
  let anchorPoint = anchorPointIn;
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
        (!inside && f0 < -DIELECTRIC_ANCHOR_ENVELOPE_REL * eps)) &&
      // With an exact predicate the cross-check asks IT rather than the
      // sign of a bound: outside the anchor envelope a loose bound reads
      // the wrong side often enough to refuse honest children, and this
      // family's own membership never does.
      (!system.contains || system.contains([px, py, pz]) !== inside)
    ) {
      return { kind: "refused", reason: 3, t, normal: [0, 0, 0] };
    }
  }
  const tFar = domainExit(system, origin, dir);
  // The last sample's t, for the membership-crossed branch's bisection.
  let tPrev = t;
  for (let i = 0; i < TRANSPORT_QUERY_MAX_STEPS; i++) {
    if (tFar < 0 || t >= tFar) {
      return { kind: "miss", reason: 0, t, normal: [0, 0, 0] };
    }
    const f = system.estimate([px, py, pz]);
    if (!Number.isFinite(f) || f <= -1e30) {
      return { kind: "refused", reason: 2, t, normal: [0, 0, 0] };
    }
    if (
      system.contains &&
      (inside ? f > 0 : f < 0) &&
      (!anchorPresent ||
        Math.hypot(
          px - anchorPoint[0],
          py - anchorPoint[1],
          pz - anchorPoint[2],
        ) >
          DIELECTRIC_ANCHOR_ENVELOPE_REL * eps) &&
      system.contains([px, py, pz]) !== inside
    ) {
      // THE MEMBERSHIP-CROSSED BRANCH (exact-predicate systems only): the
      // march has LEFT the claimed medium without a band landing — the
      // field's sign and exact membership now both contradict the claim.
      // A transported BOUND's gradient degenerates near a tangency cusp,
      // so the landing's "is the zero ahead" test can read backwards and
      // step past a real exit; unrecovered, the path runs to the domain
      // and fails the trace inside-miss (the near-cusp probe on oct6 at
      // radius fraction 0.99, depth 3). The crossing lies between the
      // previous sample and this one: bisect exact membership there and
      // report it, the shadow march's stride-crossed rule with the
      // crossing located rather than approximated.
      return membershipCrossing(system, origin, dir, tPrev, t, inside, eps);
    }
    tPrev = t;
    if (Math.abs(f) < eps) {
      // Land the crossing ON the surface: one secant step along the ray
      // with the field's unit-normalized gradient at the query point (the
      // kernel's closed-solid query's own rule — the band-edge advance
      // left the hit short of the surface for oblique approaches and the
      // grazing TIR crawl's children drifted). A touch whose zero is not
      // ahead of the query point within the band's own scale is not a
      // crossing: step past the band and keep marching.
      const n0 = transportOpticalNormal(system, [px, py, pz], dir, eps);
      const dN = dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2];
      const run = Math.abs(dN) > 1e-4 ? -f / dN : -1;
      if (!(run >= 0 && run <= 32 * eps)) {
        px += dir[0] * 2 * eps;
        py += dir[1] * 2 * eps;
        pz += dir[2] * 2 * eps;
        t += 2 * eps;
        continue;
      }
      const dd = run;
      const hx = px + dir[0] * dd;
      const hy = py + dir[1] * dd;
      const hz = pz + dir[2] * dd;
      const tc = t + dd;
      // Same-boundary suppression, part 2, MEDIUM-AWARE (the kernel's
      // rule): suppress only while the claimed medium continues beyond
      // the landing — a union's corner region puts a DIFFERENT face
      // within the anchor envelope, and the distance test alone ate an
      // honest exit crossing there.
      let suppress = false;
      const beyond: Vec3 = [
        hx + dir[0] * 2 * eps,
        hy + dir[1] * 2 * eps,
        hz + dir[2] * 2 * eps,
      ];
      if (system.contains && system.contains(beyond) === inside) {
        // THE MEMBERSHIP GATE (interface doc): the band fired where the
        // certified bound is loose, not at a surface — membership does not
        // flip across this landing, so there is no interface here. Step
        // past it and keep marching on the SAME budget; a phantom costs
        // steps, never a crossing.
        px = beyond[0];
        py = beyond[1];
        pz = beyond[2];
        t = tc + 2 * eps;
        anchorPresent = true;
        anchorPoint = [hx, hy, hz];
        continue;
      }
      if (
        anchorPresent &&
        Math.hypot(
          hx - anchorPoint[0],
          hy - anchorPoint[1],
          hz - anchorPoint[2],
        ) <=
          DIELECTRIC_ANCHOR_ENVELOPE_REL * eps
      ) {
        const fBeyond = system.estimate(beyond);
        suppress = (inside && fBeyond < 0) || (!inside && fBeyond > 0);
      }
      if (suppress) {
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

/** Locate a membership crossing bracketed by `[tLo, tHi]` (membership at
 * `tLo` is the claimed medium, at `tHi` it is not) and report it as the
 * query's boundary: the landing is the bracket's claimed-medium end, the
 * normal the optical taps there. */
function membershipCrossing(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  tLo: number,
  tHi: number,
  inside: boolean,
  eps: number,
): TransportBoundaryResult {
  let lo = tLo;
  let hi = tHi;
  for (let k = 0; k < SURFACE_GPU_TRANSPORT_MEMBERSHIP_BISECT_STEPS; k++) {
    const mid = 0.5 * (lo + hi);
    const q: Vec3 = [
      origin[0] + dir[0] * mid,
      origin[1] + dir[1] * mid,
      origin[2] + dir[2] * mid,
    ];
    if (system.contains!(q) === inside) lo = mid;
    else hi = mid;
  }
  const hit: Vec3 = [
    origin[0] + dir[0] * lo,
    origin[1] + dir[1] * lo,
    origin[2] + dir[2] * lo,
  ];
  return {
    kind: "boundary",
    reason: 0,
    t: lo,
    normal: transportOpticalNormal(system, hit, dir, eps),
  };
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
  /** The finite DDA's continuation state — threaded only when the trace
   * runs the finite backend's query (inert, undefined, otherwise). */
  finiteAnchor?: FiniteSolidAnchor | null;
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

// The finite-solid DDA's refusal reasons, past the shared vocabulary:
// the DDA's own internal invariants, mapped identically by the kernel's
// emission (surface-finite-solid-gpu.ts's literals 4/5/6).
export const SURFACE_GPU_TRANSPORT_REASON_AMBIGUOUS_ANCHOR = 4;
export const SURFACE_GPU_TRANSPORT_REASON_NONMONOTONE = 5;
export const SURFACE_GPU_TRANSPORT_REASON_DEGENERATE_NORMAL = 6;

/** A boundary result carrying the DDA's full anchor out — the chained
 * queries' continuation state (the oracle's `FiniteSolidAnchor`). */
export interface TransportFiniteBoundaryResult extends TransportBoundaryResult {
  anchor: FiniteSolidAnchor | null;
}

/** The finite backend's query signature, as the trace twin consumes it:
 * the anchor is the FULL DDA state (null = the non-anchored first call
 * from a world origin), and `inside` is the caller-carried medium the
 * DDA cross-checks. */
export type TransportFiniteQueryFn = (
  origin: Vec3,
  dir: Vec3,
  anchor: FiniteSolidAnchor | null,
  inside: boolean,
) => TransportFiniteBoundaryResult;

/** The finite backend's boundary query, f64 — NOT a re-statement of the
 * DDA: this adapter calls `finite-solid.ts`'s oracle directly (the
 * qualified fixture's own arithmetic IS the twin), and maps its result
 * onto the transport's vocabulary the way the kernel's emission maps its
 * WGSL literals. An anchored query consumes the FULL anchor — f32
 * reconstruction of cell identities is lossy, which is the whole point of
 * the anchor contract. */
export function transportFiniteBoundaryQueryCPU(
  construction: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
  anchor: FiniteSolidAnchor | null,
  inside: boolean,
): TransportFiniteBoundaryResult {
  const result = anchor
    ? finiteSolidNextBoundaryFromAnchor(construction, pose, dir, {
        inside,
        anchor,
      })
    : finiteSolidNextBoundary(construction, pose, origin, dir, { inside });
  if (result.kind === "boundary") {
    return {
      kind: "boundary",
      reason: 0,
      t: result.t,
      normal: result.outwardNormal,
      anchor: result.anchor,
    };
  }
  if (result.kind === "miss") {
    return { kind: "miss", reason: 0, t: 0, normal: [0, 0, 0], anchor: null };
  }
  const reason =
    result.reason === "visit-cap"
      ? SURFACE_GPU_TRANSPORT_REASON_VISIT_CAP
      : result.reason === "state-mismatch"
        ? SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH
        : result.reason === "ambiguous-anchor"
          ? SURFACE_GPU_TRANSPORT_REASON_AMBIGUOUS_ANCHOR
          : result.reason === "nonmonotone-crossing"
            ? SURFACE_GPU_TRANSPORT_REASON_NONMONOTONE
            : result.reason === "degenerate-projected-normal"
              ? SURFACE_GPU_TRANSPORT_REASON_DEGENERATE_NORMAL
              : SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT;
  return { kind: "refused", reason, t: 0, normal: [0, 0, 0], anchor: null };
}

/** The kernel's `transportTrace`, f64: the primary split at the march's
 * own hit, then the oracle's work-list loop over the twin boundary query.
 * `caps` mirrors the kernel's `transportMaxPaths` option — both engines
 * must run the SAME budget, so the leg passes the value it compiled the
 * kernel with; omitted, the shipped runtime caps. `query` swaps the
 * boundary backend (the closed-solid emission's twin); `finiteQuery`
 * swaps it for the finite DDA's instead, threading the full anchor
 * through the paths (the anchor out feeds each event's children exactly
 * as the kernel's trace copies it); the loop text is otherwise the
 * kernel's, term for term. */
export function transportTraceCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  theta: number,
  material: DielectricMaterial,
  bgLinear: Vec3,
  caps?: { maxProcessedPaths: number; maxInterfaces: number },
  query?: TransportQueryFn,
  finiteQuery?: TransportFiniteQueryFn,
): TransportTraceResult {
  const maxProcessed =
    caps?.maxProcessedPaths ??
    (finiteQuery
      ? DIELECTRIC_MAX_PROCESSED_PATHS
      : SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS);
  const maxInterfaces =
    caps?.maxInterfaces ??
    (finiteQuery
      ? DIELECTRIC_MAX_INTERFACES
      : SURFACE_GPU_TRANSPORT_MAX_INTERFACES);
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
  if (finiteQuery) {
    // The finite path starts at the camera. Its exact boundary query owns
    // the primary interface and both children, as it does every later one.
    push({
      origin: [...origin],
      dir: [...dir],
      energy: [1, 1, 1],
      inside: false,
      interfaces: 0,
      anchorPresent: false,
      anchorPoint: [...origin],
      bound: dielectricBranchBound([1, 1, 1], ENVIRONMENT_BOUND),
      finiteAnchor: null,
    });
  } else {
    // --- the primary split (the march's own hit, entering from outside) ---
    const n0 = transportOpticalNormal(system, origin, dir, eps);
    // The accepted hit may sit up to one pixel footprint OUTSIDE the
    // surface; the child's anchored restart keeps only the 2·eps baseline
    // (the kernel's rule — the query's own march reaches the surface and
    // the anchor suppression absorbs the entry crossing).
    const origin0: Vec3 = [origin[0], origin[1], origin[2]];
    const cosI0 = Math.abs(dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]);
    const f0 = dielectricFresnel(cosI0, 1, material.ior);
    const bend0 = dielectricRefract(dir, n0, 1, material.ior);
    const reflDir0: Vec3 = [
      dir[0] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[0],
      dir[1] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[1],
      dir[2] - 2 * (dir[0] * n0[0] + dir[1] * n0[1] + dir[2] * n0[2]) * n0[2],
    ];
    const refl0: FixturePath = {
      origin: origin0,
      dir: reflDir0,
      energy: [f0, f0, f0],
      inside: false,
      interfaces: 1,
      anchorPresent: true,
      anchorPoint: origin0,
      bound: dielectricBranchBound([f0, f0, f0], ENVIRONMENT_BOUND),
    };
    const refr0: FixturePath = {
      origin: origin0,
      dir: bend0.direction,
      energy: [1 - f0, 1 - f0, 1 - f0],
      inside: true,
      interfaces: 1,
      anchorPresent: true,
      anchorPoint: origin0,
      bound: dielectricBranchBound([1 - f0, 1 - f0, 1 - f0], ENVIRONMENT_BOUND),
    };
    const first0 = refl0.bound >= refr0.bound ? refl0 : refr0;
    const second0 = first0 === refl0 ? refr0 : refl0;
    if (!push(first0)) {
      return {
        radiance,
        residual,
        status: "unresolved",
        failure: 3,
        reason: 0,
      };
    }
    if (!push(second0)) {
      return {
        radiance,
        residual,
        status: "unresolved",
        failure: 3,
        reason: 0,
      };
    }
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
    let hitAnchor: FiniteSolidAnchor | null = null;
    let hit: TransportBoundaryResult;
    if (finiteQuery) {
      let finiteHit = finiteQuery(
        path.origin,
        path.dir,
        path.finiteAnchor ?? null,
        path.inside,
      );
      if (
        finiteHit.kind === "refused" &&
        finiteHit.reason === SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH &&
        path.finiteAnchor
      ) {
        // The corner class, resolved the closed-solid backend's way (the
        // geometry re-anchors the split, one query deeper): the event's
        // medium flag rides the INCIDENT direction's coverage, and at a
        // shared-edge crossing the child's own sweep can honestly read
        // the other side — the walk's near-tie corner fires a split
        // whose anchored restart the same walk reads as interior. The
        // kernel retries identically (its transportTrace emission);
        // re-query ONCE with the flipped claim and adopt what the sweep
        // says. A query that refuses both ways stays unresolved.
        const flipped = !path.inside;
        const retry = finiteQuery(
          path.origin,
          path.dir,
          path.finiteAnchor,
          flipped,
        );
        if (retry.kind !== "refused") {
          path.inside = flipped;
          finiteHit = retry;
        }
      }
      hit = finiteHit;
      if (finiteHit.kind === "boundary") {
        hitAnchor = finiteHit.anchor;
      }
    } else if (query) {
      hit = query(
        path.origin,
        path.dir,
        path.anchorPresent,
        path.anchorPoint,
        path.inside,
        eps,
      );
    } else {
      hit = transportBoundaryQueryCPU(
        system,
        path.origin,
        path.dir,
        path.anchorPresent,
        path.anchorPoint,
        eps,
      );
    }
    if (hit.kind === "refused") {
      residual += path.bound;
      status = "unresolved";
      failure = 4;
      reason = hit.reason;
      break;
    }
    if (hit.kind === "miss") {
      if (path.inside && (finiteQuery || path.interfaces !== 1)) {
        // An inside miss is unresolved, never a background hit — a path
        // that entered through a real crossing cannot miss a closed
        // solid, so this is an anomaly. The ONE exception is the primary
        // refracted child (interfaces === 1): the display march's
        // acceptance band catches near-miss grazes at silhouettes and
        // cell edges, whose refracted child then misses the solid
        // entirely — the ray slipped past the glass, and the honest
        // terminal is the rear scene behind it (the kernel's rule).
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
    const childOrigin: Vec3 = [
      path.origin[0] + hit.t * path.dir[0],
      path.origin[1] + hit.t * path.dir[1],
      path.origin[2] + hit.t * path.dir[2],
    ];
    // The interface's media derive from the SEGMENT GEOMETRY — which side
    // of the surface the segment started on — not the inherited medium
    // flag: on every honest event the two agree exactly, and on a stale
    // one (the grazing TIR crawl's phantom band crossings, whose child
    // used to escape the solid and miss) the geometry re-anchors the
    // split. `path.inside` stays the claimed medium the boundary query
    // cross-checks.
    const incidentInGlass = finiteQuery
      ? path.inside
      : (path.origin[0] - childOrigin[0]) * n[0] +
          (path.origin[1] - childOrigin[1]) * n[1] +
          (path.origin[2] - childOrigin[2]) * n[2] <
        0;
    const energy: Vec3 = incidentInGlass
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
    const fromIor = incidentInGlass ? material.ior : 1;
    const toIor = incidentInGlass ? 1 : material.ior;
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
      finiteAnchor: hitAnchor,
    });
    if (bend.tir) {
      const child = makeChild(energy, bend.direction, incidentInGlass);
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
      !incidentInGlass,
    );
    const reflected = makeChild(
      [energy[0] * f, energy[1] * f, energy[2] * f],
      [
        path.dir[0] - 2 * dot * n[0],
        path.dir[1] - 2 * dot * n[1],
        path.dir[2] - 2 * dot * n[2],
      ],
      incidentInGlass,
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

/** The kernel's terminal displacement (the agreement legs' mode-3 probe),
 * f64: the SMOOTHED optical normal at the exit point — the ORACLE's own
 * taps over this fixture's field — then the virtual parallel slab's
 * lateral offset, the ORACLE's own
 * {@link dielectricSlabDisplacement}. The twin owns no displacement
 * arithmetic of its own; the returned origin is the exit origin plus the
 * applied delta (or the origin itself when the displacement falls back —
 * the deterministic straight terminal). The control kernel's mode-3
 * branch is compared against this, origin for origin and component for
 * component; the constant-backdrop trace probes cannot see an origin
 * displacement (the twin's rear scene is the fixed backdrop), which is
 * why this probe exists. */
export interface TransportTerminalDisplacement {
  origin: Vec3;
  normal: Vec3;
  applied: boolean;
}

export function transportTerminalDisplacementCPU(
  system: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  material: DielectricMaterial,
  finiteGroundPlane?: boolean,
): TransportTerminalDisplacement {
  const distortion = material.distortion ?? 0;
  // The finite app terminal is origin-independent without a floor or when
  // its unchanged direction fails the floor's one-sided admission. Keep
  // undefined as the general mode-3 displacement probe, including upward
  // rays; an origin-height test would be unsound because the offset can
  // move an origin across the plane.
  if (
    !(distortion > 0) ||
    (finiteGroundPlane !== undefined && (!finiteGroundPlane || dir[1] >= -1e-6))
  ) {
    return { origin, normal: [0, 0, 0], applied: false };
  }
  const smoothed = dielectricSmoothedNormal(
    (p: Vec3): number => system.estimate(p),
    origin,
    DIELECTRIC_DISTORTION_NORMAL_REL * material.radius,
  );
  if (!smoothed) {
    return { origin, normal: [0, 0, 0], applied: false };
  }
  const thickness = distortion * material.radius;
  const disp = dielectricSlabDisplacement(
    dir,
    smoothed,
    material.ior,
    thickness,
    thickness,
  );
  if (!disp.applied) {
    return { origin, normal: smoothed, applied: false };
  }
  return {
    origin: [
      origin[0] + disp.delta[0],
      origin[1] + disp.delta[1],
      origin[2] + disp.delta[2],
    ],
    normal: smoothed,
    applied: true,
  };
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
/**
 * The shadow band's bounded sub-step advance. FOUR was qualified against the
 * closed-solid field, whose SAFETY-scaled gradient at a face is 0.9, making
 * the declared band 1.11·eps wide in space — comfortably inside four 2·eps
 * sub-steps. A certified BOUND is a different regime: its gradient falls
 * where the transport compresses, so the same band can be many times wider,
 * and the measured figure for the sphere-inversion field is in
 * `docs/sphere-inversion-family.md`'s transport section. The bound stays a
 * bound in both regimes — a graze along a wall can hold `|f| < eps`
 * indefinitely and the guard must surrender to the march's own budget —
 * which is why the exact-membership exit above matters more than the count.
 */
export const TRANSPORT_SHADOW_BAND_SUBSTEPS = 4;

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
    if (
      Math.abs(f) < eps &&
      // The membership gate (TransportFixtureSystem's doc): with a
      // certified BOUND rather than a signed distance, a band fire is an
      // interface only where membership actually flips across it.
      (!system.contains ||
        system.contains([
          sp[0] + dir[0] * 2 * eps,
          sp[1] + dir[1] * 2 * eps,
          sp[2] + dir[2] * 2 * eps,
        ]) !== inside)
    ) {
      // The declared crossing band: the boundary is here, within the
      // declared resolution. Fire the state's crossing, then step past
      // the band (below — a bounded advance, since the band's width in
      // space depends on the field's gradient at the face).
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
      // Leave the declared band. It is ±eps in FIELD value, and the
      // SAFETY-scaled field's gradient at a face is below 1, so the
      // band can be wider in SPACE than 2·eps and one fixed skip can
      // land inside it — the next sample would re-fire the crossing
      // and pay the interface's Fresnel pair a second time (measured
      // on the abutting boxes' exit face: one pair gives 0.8198, the
      // re-fire read 0.7740). Advance in 2·eps sub-steps until the
      // sample reads |f| >= eps; bounded, because a graze along a wall
      // can hold |f| < eps indefinitely — the guard surrenders to the
      // march, whose own budget paces it.
      let guard = 0;
      while (guard < TRANSPORT_SHADOW_BAND_SUBSTEPS) {
        const q: Vec3 = [
          origin[0] + dir[0] * ts,
          origin[1] + dir[1] * ts,
          origin[2] + dir[2] * ts,
        ];
        const fq = solidField(q);
        if (!(fq > -1e30) || Math.abs(fq) >= eps) break;
        // An exact predicate ends the advance as soon as the sample agrees
        // with the medium the crossing just established: the band's width
        // in SPACE is set by the field's gradient, which for a transported
        // BOUND falls with the fold depth, so "is the value out of the
        // band" alone can walk much further than the interface is wide.
        if (system.contains && system.contains(q) === inside) break;
        ts += 2 * eps;
        guard += 1;
      }
      continue;
    }
    if (
      (f < 0 ? 1 : 0) !== (inside ? 1 : 0) &&
      (!system.contains || system.contains(sp) !== inside)
    ) {
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
