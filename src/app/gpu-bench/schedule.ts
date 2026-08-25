import type { SurfaceDE } from "../../fractal/surface-de";
import type { SurfaceDE4 } from "../../fractal/surface-de-4d";

export const SURFACE_SCHEDULE_ROW_3D = "scheduledSpongeOfFerns3";
export const SURFACE_SCHEDULE_ROW_4D = "scheduledSpongeOfFerns4Flat";

export interface SurfaceScheduleKernelSpec {
  mapCount: number;
  scheduleMapCount: number;
}

/**
 * Project a built scheduled DE onto the source-generation half of the GPU
 * contract. Throwing for an absent schedule is intentional: the benchmark's
 * schedule rows must never silently compile and time the classic kernel.
 */
export function surfaceScheduleKernelSpec(
  de: Pick<SurfaceDE | SurfaceDE4, "maps" | "schedule">,
): SurfaceScheduleKernelSpec {
  if (!de.schedule || de.schedule.maps.length === 0) {
    throw new Error("surface schedule bench fixture has no schedule maps");
  }
  return {
    mapCount: de.maps.length,
    scheduleMapCount: de.schedule.maps.length,
  };
}

export interface SurfaceScheduleMarchRow {
  rays: number;
  gpuHits: number;
  cpuHits: number;
  passes: number;
  failures: number;
  truncated: boolean;
}

export interface SurfaceScheduleMarchAcceptance {
  ok: boolean;
  activated: boolean;
  completed: boolean;
  agreed: boolean;
  gpuUseful: boolean;
  cpuUseful: boolean;
}

/**
 * The scheduled app-path leg's anti-vacuity gate. Agreement alone is not
 * enough: a compiled-but-undispatched row and an all-background/all-surface
 * frame would both exercise no useful scheduled geometry.
 */
export function surfaceScheduleMarchAcceptance(
  row: SurfaceScheduleMarchRow,
): SurfaceScheduleMarchAcceptance {
  const activated = row.passes > 0;
  const completed = !row.truncated;
  const agreed = row.failures === 0;
  const gpuUseful = row.gpuHits > 0 && row.gpuHits < row.rays;
  const cpuUseful = row.cpuHits > 0 && row.cpuHits < row.rays;
  return {
    ok: activated && completed && agreed && gpuUseful && cpuUseful,
    activated,
    completed,
    agreed,
    gpuUseful,
    cpuUseful,
  };
}

export interface SurfaceScheduleFrameRow {
  passes: number;
  truncated: boolean;
  counts: { hit: number; miss: number; exhausted: number; active: number };
}

export interface SurfaceScheduleFrameAcceptance {
  ok: boolean;
  activated: boolean;
  geometry: boolean;
  settled: boolean;
}

/** Production-frame anti-vacuity/status gate for the scheduled fixture. */
export function surfaceScheduleFrameAcceptance(
  row: SurfaceScheduleFrameRow,
  software: boolean,
): SurfaceScheduleFrameAcceptance {
  const activated = row.passes > 0;
  const geometry = row.counts.hit > 0;
  const cleanTerminalMix =
    !row.truncated &&
    row.counts.miss > 0 &&
    row.counts.exhausted === 0 &&
    row.counts.active === 0;
  const settled = cleanTerminalMix || (software && row.truncated);
  return {
    ok: activated && geometry && settled,
    activated,
    geometry,
    settled,
  };
}
