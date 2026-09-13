import type { Vec3, Vec4 } from "./types";

/**
 * The selected Surface transmission model as ONE executable definition:
 * intrinsic dielectric transport on an explicitly closed optical solid,
 * evaluated in the DISPLAYED 3D coordinates of both the ordinary 3D renderer
 * and the posed native-4D slice.
 *
 * The owner selected the closed-solid dielectric appearance (finite Menger in
 * 3D, the posed hyper-Menger slice in 4D) and delegated the numeric envelope;
 * production integration is unblocked. Before any renderer path is built, the
 * accepted transport/event mathematics must have one executable definition —
 * this module — so the WebGPU compute backend and the GLSL twins cannot
 * restate it. The harness that qualified the model
 * (`scripts/transmission-dielectric-*.ts`, pinned against the owner-approved
 * images) remains the qualified reference; its finite-grid boundary query is
 * the fixture implementation of the scene interface defined here.
 *
 * WHAT LIVES HERE. The optics (exact unpolarized Fresnel, Snell refraction
 * with total internal reflection, Beer attenuation), the branch-cutoff and
 * replay policy, the event vocabulary, the work-list transport oracle over an
 * injected {@link DielectricScene}, the per-sample acceptance predicate, and
 * one emitted optics body shared by the GLSL and WGSL dialects (the `js`
 * dialect executes it, bit-identically, as the test pin).
 *
 * WHAT DOES NOT LIVE HERE. The boundary query itself. A backend implements
 * {@link DielectricScene.nextBoundary} against the PUBLIC displayed object —
 * rotor/slice, lenses, Balloon and tiling within their existing contracts —
 * never a convenient unposed inner estimator, and never a generic sign-based
 * inside test: the medium state is carried by the caller and cross-checked by
 * the query's own membership logic. The qualified finite-grid implementation
 * additionally defines the anchor/roundoff envelope and the exact corner
 * convention documented in `docs/surface-dielectric-transport.md`.
 *
 * DIMENSIONAL PARITY. The definition is dimension-free. A posed 4D query
 * reduces to displayed 3D before the transport sees it (slice-then-operate):
 * {@link dielectricIntrinsicPoint}/{@link dielectricIntrinsicDirection} carry
 * the one embedding convention and {@link dielectricSliceNormal} the one
 * displayed-normal convention. There is no second transport half to drift.
 *
 * ZERO TRANSMISSION STAYS CLASSIC. A document without authored transmission
 * never constructs a scene or a trace; the classic finish path is untouched
 * (`surface-finish.ts`'s compile-gate discipline applies when the document
 * vocabulary arrives).
 */

/**
 * The qualified material constants: interior index of refraction and the
 * per-channel Beer absorption of the owner-selected appearance, per unit of
 * the optical normalization radius. The pinned images were rendered with
 * exactly these numbers; a later parametrization keeps them as defaults.
 */
export const DIELECTRIC_IOR = 1.45;
export const DIELECTRIC_ABSORPTION: Vec3 = [0.17, 0.055, 0.025];

/**
 * Upper bound on any {@link DielectricScene.rearRadiance} output. Every
 * branch bound is the path's max throughput channel times this number, so it
 * must really bound the rear scene — the qualified studio's worst additive
 * radiance is under 4.
 */
export const DIELECTRIC_ENVIRONMENT_BOUND = 4;

/**
 * Per-sample acceptance budget: the sample is accepted when the max-channel
 * omitted contribution (after sample averaging) is at most this. It bounds
 * DISCARDED optical branches, not floating-point or antialiasing error.
 */
export const DIELECTRIC_ERROR_BUDGET = 1 / 1024;

/**
 * Initial branch-cutoff radiance. A path whose bound falls at or below theta
 * contributes its full bound to the residual instead of being traced. The
 * divisor lets up to 64 cuts still meet the budget; a trace that exceeds it
 * is discarded whole and replayed with theta halved.
 */
export const DIELECTRIC_INITIAL_BRANCH_THETA = DIELECTRIC_ERROR_BUDGET / 64;

/** Replay attempts before a still-pending sample is reported unresolved. */
export const DIELECTRIC_REPLAY_PASSES = 6;

/**
 * Whole-tree work guard (paths actually queried). The CPU replay witnesses
 * need at most 5,714; every interface also consumes a processed path, so the
 * interface guard shares the ceiling without extra work or state.
 */
export const DIELECTRIC_MAX_PROCESSED_PATHS = 16384;
export const DIELECTRIC_MAX_INTERFACES = DIELECTRIC_MAX_PROCESSED_PATHS;

/**
 * Live-stack capacity. Weak-child-first descent needs 23 live entries at the
 * qualified environment bound and last cutoff
 * ({@link dielectricWeakChildStackBound}); 24 carries one spare.
 */
export const DIELECTRIC_MAX_STACK = 24;

/**
 * Snell refraction with total internal reflection; `outwardNormal` points
 * from the incident medium toward the other one. Returns the unit refracted
 * direction, or — when `sinT2 > 1` — the reflected direction with `tir` set.
 * The f64 arithmetic is the qualified oracle's, verbatim.
 */
export interface DielectricRefraction {
  tir: boolean;
  direction: Vec3;
}

export function dielectricRefract(
  incident: Vec3,
  outwardNormal: Vec3,
  fromIor: number,
  toIor: number,
): DielectricRefraction {
  const incidentLength = Math.hypot(...incident);
  const normalLength = Math.hypot(...outwardNormal);
  if (
    !(incidentLength > 0) ||
    !(normalLength > 0) ||
    ![...incident, ...outwardNormal, fromIor, toIor].every(Number.isFinite) ||
    !(fromIor > 0) ||
    !(toIor > 0)
  )
    throw new Error(
      "Refraction inputs must be finite with positive lengths/IORs",
    );
  const i = incident.map((value) => value / incidentLength) as Vec3;
  const outward = outwardNormal.map((value) => value / normalLength) as Vec3;
  const against =
    i[0] * outward[0] + i[1] * outward[1] + i[2] * outward[2] < 0
      ? outward
      : (outward.map((value) => -value) as Vec3);
  const cosI = -(i[0] * against[0] + i[1] * against[1] + i[2] * against[2]);
  const eta = fromIor / toIor;
  const sinT2 = eta * eta * Math.max(0, 1 - cosI * cosI);
  let direction: Vec3;
  if (sinT2 > 1) {
    direction = i.map(
      (value, axis) => value + 2 * cosI * against[axis],
    ) as Vec3;
    return { tir: true, direction };
  }
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  direction = i.map(
    (value, axis) => eta * value + (eta * cosI - cosT) * against[axis],
  ) as Vec3;
  const length = Math.hypot(...direction);
  return {
    tir: false,
    direction: direction.map((value) => value / length) as Vec3,
  };
}

/**
 * Exact unpolarized dielectric Fresnel reflectance for the incident
 * direction's |cosine| against the boundary normal. Full reflectance at and
 * beyond the critical angle (`sinT2 >= 1`); the transport's refraction test
 * uses the strict `> 1`, which is harmless — at exactly `sinT2 = 1` the
 * Fresnel weight is 1, so the transmitted child's energy is zero and its
 * bound is cut before it is pushed.
 */
export function dielectricFresnel(
  cosI: number,
  fromIor: number,
  toIor: number,
): number {
  const eta = fromIor / toIor;
  const sinT2 = eta * eta * Math.max(0, 1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  const rs = (fromIor * cosI - toIor * cosT) / (fromIor * cosI + toIor * cosT);
  const rp = (fromIor * cosT - toIor * cosI) / (fromIor * cosT + toIor * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

/**
 * Beer–Lambert transmission of one linear channel: `exp(-a · d / radius)`,
 * with absorption authored per unit of the optical normalization radius.
 * Applies inside the medium only; it never increases energy.
 */
export function dielectricBeerThroughput(
  absorptionPerRadius: number,
  distance: number,
  radius: number,
): number {
  if (
    ![absorptionPerRadius, distance, radius].every(Number.isFinite) ||
    absorptionPerRadius < 0 ||
    distance < 0 ||
    !(radius > 0)
  )
    throw new Error(
      "Beer inputs must be finite and non-negative with radius > 0",
    );
  return Math.exp((-absorptionPerRadius * distance) / radius);
}

/**
 * Replay-pass theta: the branch cutoff halves each attempt,
 * `initialTheta · 2^-pass`. Pass 0 is the initial cutoff.
 */
export function dielectricReplayTheta(
  pass: number,
  initialTheta = DIELECTRIC_INITIAL_BRANCH_THETA,
): number {
  if (!Number.isFinite(pass) || pass < 0 || !Number.isFinite(initialTheta))
    throw new Error("Replay theta needs a finite pass and initial theta");
  return initialTheta * Math.pow(2, -pass);
}

/**
 * A path's contribution bound: its largest linear throughput channel times
 * the scene's environment bound. This is the number compared against theta
 * and summed into the residual — the assumption is that no rear-scene
 * radiance exceeds the bound and attenuation only decreases throughput.
 */
export function dielectricBranchBound(
  throughput: Vec3,
  radianceBound: number,
): number {
  return (
    Math.max(Math.max(throughput[0], throughput[1]), throughput[2]) *
    radianceBound
  );
}

/**
 * The weak-child-first stack requirement: with every interface splitting a
 * path's energy between two children (`reflected + transmitted = parent` per
 * channel), the weaker child's bound is at most half the parent's, so
 * processing weaker children first retains one stronger sibling per strict
 * descent above theta. Returns the descent count and the live entries it
 * needs (`descents + 1`) — the derivation behind {@link DIELECTRIC_MAX_STACK}.
 */
export function dielectricWeakChildStackBound(
  environmentBound: number,
  thetaMin: number,
): { descents: number; liveEntries: number } {
  let descents = 0;
  for (let bound = environmentBound; bound / 2 > thetaMin; bound /= 2)
    descents++;
  return { descents, liveEntries: descents + 1 };
}

/**
 * Displayed-3D → intrinsic-4D point for a posed slice: the displayed point
 * embeds as `(x, y, z, slice)` and transforms by the row-major
 * world→intrinsic rows. The rows come from `affine4.ts`'s `rotationMatrix4`
 * (orthonormal, so the inverse is the transpose); the harness freezes them
 * with `Math.fround` for its f32 wire.
 */
export function dielectricIntrinsicPoint(
  rows: readonly number[],
  slice: number,
  p: Vec3,
): Vec4 {
  if (rows.length !== 16)
    throw new Error("Slice rows must be 16 row-major entries");
  return [
    rows[0] * p[0] + rows[1] * p[1] + rows[2] * p[2] + rows[3] * slice,
    rows[4] * p[0] + rows[5] * p[1] + rows[6] * p[2] + rows[7] * slice,
    rows[8] * p[0] + rows[9] * p[1] + rows[10] * p[2] + rows[11] * slice,
    rows[12] * p[0] + rows[13] * p[1] + rows[14] * p[2] + rows[15] * slice,
  ];
}

/** Displayed-3D → intrinsic-4D direction: embedded with `w = 0`. */
export function dielectricIntrinsicDirection(
  rows: readonly number[],
  d: Vec3,
): Vec4 {
  if (rows.length !== 16)
    throw new Error("Slice rows must be 16 row-major entries");
  return [
    rows[0] * d[0] + rows[1] * d[1] + rows[2] * d[2],
    rows[4] * d[0] + rows[5] * d[1] + rows[6] * d[2],
    rows[8] * d[0] + rows[9] * d[1] + rows[10] * d[2],
    rows[12] * d[0] + rows[13] * d[1] + rows[14] * d[2],
  ];
}

/**
 * The displayed 3D normal of an intrinsic-axis face of a posed slice: the
 * normalized xyz part of the face's matrix row, signed outward. Faces live in
 * the displayed slice, so the row's slice-column entry is dropped. Returns
 * `null` for a degenerate (zero-length) row — a backend must refuse rather
 * than emit one.
 */
export function dielectricSliceNormal(
  row: Vec4,
  faceSign: 1 | -1,
): Vec3 | null {
  const magnitude = Math.hypot(row[0], row[1], row[2]);
  if (!(magnitude > 0)) return null;
  return [
    (faceSign * row[0]) / magnitude,
    (faceSign * row[1]) / magnitude,
    (faceSign * row[2]) / magnitude,
  ];
}

/**
 * Backend-owned boundary-continuation state, opaque to the transport: the
 * oracle stores it and hands it back verbatim on the child queries. The
 * contract it must satisfy — a canonical boundary identity that survives f32
 * rounding within a declared envelope, lets the next query suppress the same
 * face, and refuses cleanly when inconsistent — is specified in
 * `docs/surface-dielectric-transport.md`. The qualified finite-grid
 * implementation carries the intrinsic intersection, the tied-plane mask and
 * the post-incident cell indices.
 */
export type DielectricAnchor = Readonly<Record<string, unknown>>;

export type DielectricRefusalReason =
  | "visit-cap"
  | "invalid-input"
  | "state-mismatch"
  | "ambiguous-anchor"
  | "nonmonotone-crossing"
  | "degenerate-normal"
  | (string & {});

/**
 * One boundary query: the ray (unit direction), the CALLER-carried medium
 * state, and the anchor when the ray continues from a boundary. The query
 * cross-checks the medium state against its own membership logic and refuses
 * on disagreement — the transport never infers "inside" from a distance sign.
 */
export interface DielectricBoundaryQuery {
  origin: Vec3;
  direction: Vec3;
  inside: boolean;
  anchor: DielectricAnchor | null;
}

export interface DielectricBoundaryEvent {
  kind: "boundary";
  /**
   * Distance from the query origin to the boundary in the ray's own
   * (unit-direction) parametrization. Anchored continuation queries restart
   * at the boundary, so `t` is the traversed segment's length — exactly what
   * the Beer term needs.
   */
  t: number;
  /** The medium state AFTER the crossing. */
  entering: boolean;
  /** Displayed 3D outward normal; never zero-length. */
  outwardNormal: Vec3;
  /** Canonical boundary state for the child queries; `null` when the backend offers none. */
  anchor: DielectricAnchor | null;
  /**
   * Per-hit material attribution (the backend's slot/firstChoice vocabulary),
   * riding the event for backends that shade interface hits. The transport
   * itself never reads it.
   */
  materialSlot?: number;
}

export type DielectricBoundaryResult =
  | DielectricBoundaryEvent
  | { kind: "miss" }
  | { kind: "refused"; reason: DielectricRefusalReason };

/**
 * The optical scene the transport oracle consumes. `nextBoundary` returns the
 * next boundary of the closed optical solid for the ray's current medium — a
 * `miss` means the ray leaves the declared domain without one (while inside
 * the solid that is a failure, never a background hit). `rearRadiance` is the
 * linear radiance behind an escaped ray: environment, procedural studio,
 * opaque rear geometry — whatever the backend displays; per-hit material
 * attribution for those terminals happens inside the backend.
 */
export interface DielectricScene {
  nextBoundary(query: DielectricBoundaryQuery): DielectricBoundaryResult;
  rearRadiance(origin: Vec3, direction: Vec3): Vec3;
  /** Upper bound on any `rearRadiance` output; multiplies every branch bound. */
  radianceBound: number;
}

/**
 * The optical material: interior IOR (the exterior is 1), per-channel
 * absorption, and the radius absorption is authored per. The qualified
 * appearance is {@link DIELECTRIC_IOR}, {@link DIELECTRIC_ABSORPTION} and the
 * solid's half extent.
 */
export interface DielectricMaterial {
  ior: number;
  absorption: Vec3;
  radius: number;
}

export interface DielectricTransportLimits {
  maxProcessedPaths: number;
  maxInterfaces: number;
  maxStack: number;
}

/**
 * One live path: the continuation payload. `origin`/`direction` are displayed
 * 3D; `throughput` is linear energy; `anchor` (when present) is the canonical
 * boundary state the next query must use in preference to the rounded
 * displayed origin; `bound` is the cached contribution bound.
 */
export interface DielectricPath {
  origin: Vec3;
  direction: Vec3;
  throughput: Vec3;
  inside: boolean;
  interfaces: number;
  anchor: DielectricAnchor | null;
  bound: number;
}

export type DielectricTraceStatus =
  "running" | "complete" | "residual" | "unresolved" | "invalid";

export type DielectricTraceFailureKind =
  "processed-paths" | "interfaces" | "stack" | "traversal" | "inside-miss";

export interface DielectricTraceFailure {
  kind: DielectricTraceFailureKind;
  /** The query's refusal reason, for `traversal`. */
  reason?: DielectricRefusalReason;
}

/**
 * The transport state — also the resumable continuation record. It is a plain
 * data record (scene and material are call arguments): chunked processing
 * pauses between paths with the live stack intact, so a chunked run visits
 * paths in exactly the uninterrupted order and reproduces it bit-for-bit. The
 * replay schedule is the OTHER resumption shape (re-trace a pending sample
 * from scratch at halved theta), which is what the GPU backends implement per
 * pass.
 */
export interface DielectricTraceState {
  stack: DielectricPath[];
  radiance: Vec3;
  residual: number;
  processedPaths: number;
  status: DielectricTraceStatus;
  failure: DielectricTraceFailure | null;
  theta: number;
  limits: DielectricTransportLimits;
}

export interface DielectricTraceOptions {
  theta?: number;
  /**
   * The root path's medium: `false` (the default) for camera rays, `true` for
   * a ray born inside the optical solid — its first Beer segment then runs
   * from the origin.
   */
  initialMedium?: boolean;
  limits?: Partial<DielectricTransportLimits>;
}

function resolveLimits(partial?: Partial<DielectricTransportLimits>) {
  const limits: DielectricTransportLimits = {
    maxProcessedPaths:
      partial?.maxProcessedPaths ?? DIELECTRIC_MAX_PROCESSED_PATHS,
    maxInterfaces: partial?.maxInterfaces ?? DIELECTRIC_MAX_INTERFACES,
    maxStack: partial?.maxStack ?? DIELECTRIC_MAX_STACK,
  };
  if (
    ![limits.maxProcessedPaths, limits.maxInterfaces, limits.maxStack].every(
      (value) => Number.isInteger(value) && value >= 1,
    )
  )
    throw new Error("Transport limits must be integers >= 1");
  return limits;
}

function validateMaterial(material: DielectricMaterial): void {
  if (
    !Number.isFinite(material.ior) ||
    !(material.ior > 0) ||
    !Number.isFinite(material.radius) ||
    !(material.radius > 0) ||
    !material.absorption.every((value) => Number.isFinite(value) && value >= 0)
  )
    throw new Error(
      "Dielectric material needs a positive IOR/radius and finite non-negative absorption",
    );
}

/**
 * Start a trace: validate the inputs, seed the root path (unit direction,
 * throughput 1, the caller's medium) and return the running state. Throws on
 * structural misuse — a broken scene answer mid-trace is the backend's
 * `refused` result, not an exception.
 */
export function dielectricTraceStart(
  scene: DielectricScene,
  origin: Vec3,
  direction: Vec3,
  material: DielectricMaterial,
  options: DielectricTraceOptions = {},
): DielectricTraceState {
  if (
    ![...origin, ...direction].every(Number.isFinite) ||
    !(Math.hypot(...direction) > 0)
  )
    throw new Error("Trace ray must be finite with a non-zero direction");
  validateMaterial(material);
  if (!Number.isFinite(scene.radianceBound) || !(scene.radianceBound > 0))
    throw new Error("Scene radiance bound must be finite and positive");
  const theta = options.theta ?? DIELECTRIC_INITIAL_BRANCH_THETA;
  if (!Number.isFinite(theta) || theta < 0)
    throw new Error("Branch theta must be finite and non-negative");
  const limits = resolveLimits(options.limits);
  const unitLength = Math.hypot(...direction);
  const unit = direction.map((value) => value / unitLength) as Vec3;
  const throughput: Vec3 = [1, 1, 1];
  return {
    stack: [
      {
        origin: [...origin] as Vec3,
        direction: unit,
        throughput,
        inside: options.initialMedium ?? false,
        interfaces: 0,
        anchor: null,
        bound: dielectricBranchBound(throughput, scene.radianceBound),
      },
    ],
    radiance: [0, 0, 0],
    residual: 0,
    processedPaths: 0,
    status: "running",
    failure: null,
    theta,
    limits,
  };
}

function addRadiance(state: DielectricTraceState, radiance: Vec3): void {
  state.radiance = [
    state.radiance[0] + radiance[0],
    state.radiance[1] + radiance[1],
    state.radiance[2] + radiance[2],
  ];
  if (!state.radiance.every(Number.isFinite)) {
    state.status = "invalid";
    state.stack.length = 0;
  }
}

function guard(
  state: DielectricTraceState,
  path: DielectricPath,
  failure: DielectricTraceFailure,
): void {
  state.residual += path.bound;
  state.failure = failure;
  state.status = "unresolved";
  state.stack.length = 0;
}

/** Cut or enqueue one child; false when the trace terminated on the stack guard. */
function pushChild(
  state: DielectricTraceState,
  child: DielectricPath,
): boolean {
  if (child.bound <= state.theta) {
    state.residual += child.bound;
    return true;
  }
  if (state.stack.length >= state.limits.maxStack) {
    guard(state, child, { kind: "stack" });
    return false;
  }
  state.stack.push(child);
  return true;
}

/**
 * Process up to `maxProcessedPaths` further paths (all of them when
 * omitted); returns the same state, mutated. A resource guard, a traversal
 * refusal, an inside miss or a non-finite radiance terminates the trace as
 * unresolved/invalid — guards add the blocked work's bound to the residual,
 * but the sample stays unresolved: a summed bound never upgrades a refused
 * run to complete.
 */
export function dielectricTraceStep(
  state: DielectricTraceState,
  scene: DielectricScene,
  material: DielectricMaterial,
  maxProcessedPaths = Number.POSITIVE_INFINITY,
): DielectricTraceState {
  let processed = 0;
  while (state.status === "running" && state.stack.length > 0) {
    if (processed >= maxProcessedPaths) return state;
    const path = state.stack.pop() as DielectricPath;
    if (path.bound <= state.theta) {
      state.residual += path.bound;
      continue;
    }
    if (state.processedPaths >= state.limits.maxProcessedPaths) {
      guard(state, path, { kind: "processed-paths" });
      return state;
    }
    if (path.interfaces >= state.limits.maxInterfaces) {
      guard(state, path, { kind: "interfaces" });
      return state;
    }
    state.processedPaths++;
    processed++;
    const result = scene.nextBoundary({
      origin: path.origin,
      direction: path.direction,
      inside: path.inside,
      anchor: path.anchor,
    });
    if (result.kind === "refused") {
      guard(state, path, { kind: "traversal", reason: result.reason });
      return state;
    }
    if (result.kind === "miss") {
      if (path.inside) {
        guard(state, path, { kind: "inside-miss" });
        return state;
      }
      const rear = scene.rearRadiance(path.origin, path.direction);
      addRadiance(state, [
        rear[0] * path.throughput[0],
        rear[1] * path.throughput[1],
        rear[2] * path.throughput[2],
      ]);
      continue;
    }
    // Boundary event: Beer over the traversed interior segment, then the
    // Fresnel split.
    const energy: Vec3 = path.inside
      ? [
          path.throughput[0] *
            dielectricBeerThroughput(
              material.absorption[0],
              result.t,
              material.radius,
            ),
          path.throughput[1] *
            dielectricBeerThroughput(
              material.absorption[1],
              result.t,
              material.radius,
            ),
          path.throughput[2] *
            dielectricBeerThroughput(
              material.absorption[2],
              result.t,
              material.radius,
            ),
        ]
      : [...path.throughput];
    const n = result.outwardNormal;
    const dot =
      path.direction[0] * n[0] +
      path.direction[1] * n[1] +
      path.direction[2] * n[2];
    const fromIor = path.inside ? material.ior : 1;
    const toIor = path.inside ? 1 : material.ior;
    const bend = dielectricRefract(path.direction, n, fromIor, toIor);
    const childOrigin: Vec3 = [
      path.origin[0] + result.t * path.direction[0],
      path.origin[1] + result.t * path.direction[1],
      path.origin[2] + result.t * path.direction[2],
    ];
    const makeChild = (
      childEnergy: Vec3,
      direction: Vec3,
      inside: boolean,
    ): DielectricPath => ({
      origin: childOrigin,
      direction,
      throughput: childEnergy,
      inside,
      interfaces: path.interfaces + 1,
      anchor: result.anchor,
      bound: dielectricBranchBound(childEnergy, scene.radianceBound),
    });
    if (bend.tir) {
      // One child, full (Beer-damped) energy, same medium.
      if (!pushChild(state, makeChild(energy, bend.direction, path.inside)))
        return state;
      continue;
    }
    const f = dielectricFresnel(Math.abs(dot), fromIor, toIor);
    const transmitted = makeChild(
      [energy[0] * (1 - f), energy[1] * (1 - f), energy[2] * (1 - f)],
      bend.direction,
      result.entering,
    );
    const reflected = makeChild(
      [energy[0] * f, energy[1] * f, energy[2] * f],
      [
        path.direction[0] - 2 * dot * n[0],
        path.direction[1] - 2 * dot * n[1],
        path.direction[2] - 2 * dot * n[2],
      ],
      path.inside,
    );
    // Push the stronger child first so the weaker actual-throughput child is
    // processed first; Fresnel is not assumed below 0.5.
    const [first, second] =
      reflected.bound >= transmitted.bound
        ? [reflected, transmitted]
        : [transmitted, reflected];
    if (!pushChild(state, first)) return state;
    if (!pushChild(state, second)) return state;
  }
  if (state.status === "running" && state.stack.length === 0)
    state.status = state.residual > 0 ? "residual" : "complete";
  return state;
}

/** Run a trace to termination (or invalid) in one call. */
export function dielectricTraceRun(
  state: DielectricTraceState,
  scene: DielectricScene,
  material: DielectricMaterial,
): DielectricTraceState {
  while (state.status === "running")
    dielectricTraceStep(state, scene, material);
  return state;
}

/** One-shot convenience: {@link dielectricTraceStart} + {@link dielectricTraceRun}. */
export function dielectricTrace(
  scene: DielectricScene,
  origin: Vec3,
  direction: Vec3,
  material: DielectricMaterial,
  options: DielectricTraceOptions = {},
): DielectricTraceState {
  return dielectricTraceRun(
    dielectricTraceStart(scene, origin, direction, material, options),
    scene,
    material,
  );
}

/**
 * Replay acceptance for one sample: a terminal, finite result whose residual
 * fits the per-sample budget. Unresolved and invalid samples keep their
 * pending identity and are re-traced from scratch at the next pass's halved
 * theta; an invalid sample is never retried and never presented as
 * background.
 */
export function dielectricSampleAccepted(
  status: DielectricTraceStatus,
  radiance: Vec3,
  residual: number,
  budget = DIELECTRIC_ERROR_BUDGET,
): boolean {
  return (
    (status === "complete" || status === "residual") &&
    radiance.every(Number.isFinite) &&
    Number.isFinite(residual) &&
    residual <= budget
  );
}

/**
 * The emitted optics body: ONE shared math text for the five scalar-optics
 * functions the backends need ({@link dielectricFresnel},
 * {@link dielectricRefract}, {@link dielectricBeerThroughput},
 * {@link dielectricReplayTheta}, {@link dielectricBranchBound}), emitted in
 * the GLSL, WGSL and `js` dialects. The GLSL and WGSL bodies are token
 * renames of each other; the `js` dialect executes bit-identically to the f64
 * oracle functions above (that identity is the test pin — `Math.hypot`
 * carries the oracle's length arithmetic where the shader text spells the
 * sqrt form). `dielectricRefract` takes eight scalars and returns the
 * direction with the TIR flag in `w`, so no dialect needs vector operators.
 *
 * The shader text performs NO input validation (a shader cannot throw): the
 * f64 oracle validates, and shader callers are contract-bound to finite
 * unit-length rays and positive lengths — the same discipline the qualified
 * kernel's own mirrors follow. Consumers splice this source per engine
 * (`surface-de-gpu.ts`'s codegen, the GLSL tracers' variants); until those
 * backends adopt it, the qualified kernel keeps its own f32 mirrors.
 */
export type DielectricOpticsDialect = "glsl" | "wgsl" | "js";

export function dielectricOpticsSource(
  dialect: DielectricOpticsDialect,
): string {
  const js = dialect === "js";
  const wgsl = dialect === "wgsl";
  const decl = js ? "const " : wgsl ? "let " : "float ";
  const param = (name: string) =>
    js ? name : wgsl ? `${name}: f32` : `float ${name}`;
  const fn = (name: string, params: string[], ret: string) =>
    js
      ? `function ${name}(${params.join(", ")}) {`
      : wgsl
        ? `fn ${name}(${params.map(param).join(", ")}) -> ${ret} {`
        : `${ret} ${name}(${params.map(param).join(", ")}) {`;
  const max = (a: string, b: string) =>
    js ? `Math.max(${a}, ${b})` : `max(${a}, ${b})`;
  const sqrt = (x: string) => (js ? `Math.sqrt(${x})` : `sqrt(${x})`);
  const exp = (x: string) => (js ? `Math.exp(${x})` : `exp(${x})`);
  const exp2 = (x: string) => (js ? `Math.pow(2.0, ${x})` : `exp2(${x})`);
  const step = (edge: string, x: string) =>
    js ? `((${x}) < ${edge} ? 0.0 : 1.0)` : `step(${edge}, ${x})`;
  const mix = (f: string, t: string, a: string) =>
    js
      ? `((${f}) * (1.0 - (${a})) + (${t}) * (${a}))`
      : `mix(${f}, ${t}, ${a})`;
  const len3 = (x: string, y: string, z: string) =>
    js
      ? `Math.hypot(${x}, ${y}, ${z})`
      : `sqrt(${x}*${x} + ${y}*${y} + ${z}*${z})`;
  const vec4 = (x: string, y: string, z: string, w: string) =>
    js
      ? `{ x: ${x}, y: ${y}, z: ${z}, w: ${w} }`
      : wgsl
        ? `vec4f(${x}, ${y}, ${z}, ${w})`
        : `vec4(${x}, ${y}, ${z}, ${w})`;
  const lines: string[] = [];
  lines.push(
    fn(
      "dielectricFresnel",
      ["cosI", "fromIor", "toIor"],
      js ? "" : wgsl ? "f32" : "float",
    ),
    `${decl}eta = fromIor / toIor;`,
    `${decl}sinT2 = eta * eta * ${max("0.0", "1.0 - cosI * cosI")};`,
    "  if (sinT2 >= 1.0) { return 1.0; }",
    `${decl}cosT = ${sqrt(max("0.0", "1.0 - sinT2"))};`,
    `${decl}rs = (fromIor * cosI - toIor * cosT) / (fromIor * cosI + toIor * cosT);`,
    `${decl}rp = (fromIor * cosT - toIor * cosI) / (fromIor * cosT + toIor * cosI);`,
    "  return 0.5 * (rs * rs + rp * rp);",
    "}",
  );
  lines.push(
    fn(
      "dielectricRefract",
      ["ix", "iy", "iz", "nx", "ny", "nz", "fromIor", "toIor"],
      js ? "" : wgsl ? "vec4f" : "vec4",
    ),
    `${decl}iLen = ${len3("ix", "iy", "iz")};`,
    `${decl}nLen = ${len3("nx", "ny", "nz")};`,
    `${decl}ux = ix / iLen; ${decl}uy = iy / iLen; ${decl}uz = iz / iLen;`,
    `${decl}wx = nx / nLen; ${decl}wy = ny / nLen; ${decl}wz = nz / nLen;`,
    `${decl}c = ux*wx + uy*wy + uz*wz;`,
    `${decl}b = 1.0 - ${step("0.0", "c")};`,
    `${decl}ax = ${mix("-wx", "wx", "b")}; ${decl}ay = ${mix("-wy", "wy", "b")}; ${decl}az = ${mix("-wz", "wz", "b")};`,
    `${decl}cosI = -(ux*ax + uy*ay + uz*az);`,
    `${decl}eta = fromIor / toIor;`,
    `${decl}sinT2 = eta * eta * ${max("0.0", "1.0 - cosI*cosI")};`,
    "  if (sinT2 > 1.0) {",
    `    return ${vec4("ux + 2.0*cosI*ax", "uy + 2.0*cosI*ay", "uz + 2.0*cosI*az", "1.0")};`,
    "  }",
    `${decl}cosT = ${sqrt(max("0.0", "1.0 - sinT2"))};`,
    `${decl}k = eta * cosI - cosT;`,
    `${decl}dx = eta*ux + k*ax;`,
    `${decl}dy = eta*uy + k*ay;`,
    `${decl}dz = eta*uz + k*az;`,
    `${decl}dLen = ${len3("dx", "dy", "dz")};`,
    `  return ${vec4("dx / dLen", "dy / dLen", "dz / dLen", "0.0")};`,
    "}",
  );
  lines.push(
    fn(
      "dielectricBeerThroughput",
      ["absorption", "distance", "radius"],
      js ? "" : wgsl ? "f32" : "float",
    ),
    `  return ${exp("(-absorption * distance) / radius")};`,
    "}",
  );
  lines.push(
    fn(
      "dielectricReplayTheta",
      ["pass", "initialTheta"],
      js ? "" : wgsl ? "f32" : "float",
    ),
    `  return initialTheta * ${exp2("-pass")};`,
    "}",
  );
  lines.push(
    fn(
      "dielectricBranchBound",
      ["r", "g", "b", "radianceBound"],
      js ? "" : wgsl ? "f32" : "float",
    ),
    `  return ${max(max("r", "g"), "b")} * radianceBound;`,
    "}",
  );
  return lines.join("\n") + "\n";
}
