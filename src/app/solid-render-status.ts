/**
 * One honest description of a sampled Solid render session.
 *
 * Solid is a progressively accumulated voxel-density render.  It is distinct
 * from the analytic Surface route, so every user-facing rendering of this
 * model deliberately says "Sampled Solid" and includes both the effective
 * voxel resolution and convergence state.  The same snapshot is suitable for
 * the live row, capture names, collection cards, timeline rows, and exports.
 */

export const SAMPLED_SOLID_IDENTITY = "Sampled Solid";

export type SampledSolidPhase = "active" | "complete" | "cancelled" | "failed";

export interface SampledSolidStatus {
  /** Stable discriminator for persisted collection/timeline snapshots. */
  readonly kind: "sampled-solid";
  readonly phase: SampledSolidPhase;
  readonly requestedResolution: number;
  /** Null only before the worker has resolved its memory-aware grid size. */
  readonly effectiveResolution: number | null;
  readonly iterationsDone: number;
  readonly iterationsBudget: number;
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resolution(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/** Begin a fresh session. Effective resolution remains pending until the
 * worker's resolution decision or first grid arrives. */
export function beginSampledSolidStatus(
  requestedResolution: number,
  iterationsBudget: number,
): SampledSolidStatus {
  return {
    kind: "sampled-solid",
    phase: "active",
    requestedResolution: resolution(requestedResolution),
    effectiveResolution: null,
    iterationsDone: 0,
    iterationsBudget: count(iterationsBudget),
  };
}

/** The existing worker has discarded accumulation and begun again. */
export function restartSampledSolidStatus(
  status: SampledSolidStatus,
  iterationsBudget: number,
): SampledSolidStatus {
  return {
    ...status,
    phase: "active",
    effectiveResolution: null,
    iterationsDone: 0,
    iterationsBudget: count(iterationsBudget),
  };
}

/** Record the worker's effective resolution. A null worker note means the
 * request was accepted without reduction. */
export function resolveSampledSolidResolution(
  status: SampledSolidStatus,
  effective: number | null,
  requested = status.requestedResolution,
): SampledSolidStatus {
  return {
    ...status,
    requestedResolution: resolution(requested),
    effectiveResolution: resolution(effective ?? requested),
  };
}

/** Record convergence counters; reaching the budget is the sole definition
 * of complete, including a zero-budget defensive session. */
export function progressSampledSolidStatus(
  status: SampledSolidStatus,
  iterationsDone: number,
  iterationsBudget: number,
  effectiveResolution?: number,
): SampledSolidStatus {
  const done = count(iterationsDone);
  const budget = count(iterationsBudget);
  return {
    ...status,
    phase: budget === 0 || done >= budget ? "complete" : "active",
    effectiveResolution:
      effectiveResolution === undefined
        ? status.effectiveResolution
        : resolution(effectiveResolution),
    iterationsDone: done,
    iterationsBudget: budget,
  };
}

/** Preserve the last real counters/resolution when a session ends early. */
export function endSampledSolidStatus(
  status: SampledSolidStatus,
  phase: "cancelled" | "failed",
): SampledSolidStatus {
  return status.phase === "complete" ? status : { ...status, phase };
}

export function sampledSolidConvergenceFraction(
  status: SampledSolidStatus,
): number {
  if (status.iterationsBudget <= 0) return 1;
  return Math.min(1, status.iterationsDone / status.iterationsBudget);
}

/** Floor rather than round: an active render never claims 100% early. */
export function sampledSolidConvergencePercent(
  status: SampledSolidStatus,
): number {
  return Math.floor(sampledSolidConvergenceFraction(status) * 100);
}

export function sampledSolidIsReduced(status: SampledSolidStatus): boolean {
  return (
    status.effectiveResolution !== null &&
    status.effectiveResolution < status.requestedResolution
  );
}

export function sampledSolidResolutionText(status: SampledSolidStatus): string {
  if (status.effectiveResolution === null) {
    return `requested ${status.requestedResolution}³ voxels · effective resolution pending`;
  }
  const effective = `${status.effectiveResolution}³ voxels`;
  return sampledSolidIsReduced(status)
    ? `${effective} (requested ${status.requestedResolution}³)`
    : effective;
}

export function sampledSolidConvergenceText(
  status: SampledSolidStatus,
): string {
  const percent = sampledSolidConvergencePercent(status);
  switch (status.phase) {
    case "complete":
      return "converged";
    case "cancelled":
      return `cancelled · incomplete at ${percent}%`;
    case "failed":
      return `failed · incomplete at ${percent}%`;
    case "active":
      return `converging ${percent}%`;
  }
}

/** The canonical visible/accessible label used on every product surface. */
export function sampledSolidStatusText(status: SampledSolidStatus): string {
  return `${SAMPLED_SOLID_IDENTITY} · ${sampledSolidResolutionText(status)} · ${sampledSolidConvergenceText(status)}`;
}

/** A persisted/captured snapshot does not continue converging. Reword only an
 * active session's verb while retaining the exact same identity, resolution,
 * counters, and terminal-state model. */
export function sampledSolidSnapshotText(status: SampledSolidStatus): string {
  if (status.phase !== "active") return sampledSolidStatusText(status);
  return `${SAMPLED_SOLID_IDENTITY} · ${sampledSolidResolutionText(status)} · incomplete at ${sampledSolidConvergencePercent(status)}%`;
}

/** Compact, filesystem-safe disclosure for PNG/video names. */
export function sampledSolidFileTag(status: SampledSolidStatus): string {
  const resolutionTag =
    status.effectiveResolution === null
      ? `requested-${status.requestedResolution}cubed`
      : sampledSolidIsReduced(status)
        ? `${status.effectiveResolution}cubed-requested-${status.requestedResolution}cubed`
        : `${status.effectiveResolution}cubed`;
  const convergenceTag =
    status.phase === "complete"
      ? "converged"
      : `incomplete-${sampledSolidConvergencePercent(status)}pct`;
  return `sampled-solid-${resolutionTag}-${convergenceTag}`;
}

/** Trust-boundary sanitizer for optional collection/timeline snapshots. A bad
 * snapshot costs only the disclosure field, never its scene. */
export function sanitizeSampledSolidStatus(
  value: unknown,
): SampledSolidStatus | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (
    o.kind !== "sampled-solid" ||
    (o.phase !== "active" &&
      o.phase !== "complete" &&
      o.phase !== "cancelled" &&
      o.phase !== "failed") ||
    typeof o.requestedResolution !== "number" ||
    !Number.isFinite(o.requestedResolution) ||
    (o.effectiveResolution !== null &&
      (typeof o.effectiveResolution !== "number" ||
        !Number.isFinite(o.effectiveResolution))) ||
    typeof o.iterationsDone !== "number" ||
    !Number.isFinite(o.iterationsDone) ||
    typeof o.iterationsBudget !== "number" ||
    !Number.isFinite(o.iterationsBudget)
  ) {
    return undefined;
  }
  const sanitized: SampledSolidStatus = {
    kind: "sampled-solid",
    phase: o.phase,
    requestedResolution: resolution(o.requestedResolution),
    effectiveResolution:
      o.effectiveResolution === null ? null : resolution(o.effectiveResolution),
    iterationsDone: count(o.iterationsDone),
    iterationsBudget: count(o.iterationsBudget),
  };
  // Persisted "complete" is accepted only when its counters support it;
  // conversely, counters at/over budget are always complete.
  return progressSampledSolidStatus(
    sanitized,
    sanitized.iterationsDone,
    sanitized.iterationsBudget,
  ).phase === "complete"
    ? { ...sanitized, phase: "complete" }
    : sanitized.phase === "complete"
      ? { ...sanitized, phase: "active" }
      : sanitized;
}
