import type { SurfaceDE } from "../../fractal/surface-de";
import type { SurfaceDE4 } from "../../fractal/surface-de-4d";

export const SURFACE_CHAOS_ROW_3D = "xaosFernSponge3";
export const SURFACE_CHAOS_ROW_4D = "xaosFernSponge4Flat";

export interface SurfaceChaosKernelSpec {
  activeStateCount: number;
  predecessorMasks: ArrayLike<number>;
}

/**
 * Project a graph-directed DE onto the source-generation contract. The
 * benchmark calls this unconditionally for its xaos rows so an absent chi
 * table cannot silently compile and time the classic all-paths kernel.
 */
export function surfaceChaosKernelSpec(
  de: Pick<SurfaceDE | SurfaceDE4, "chaos">,
): SurfaceChaosKernelSpec {
  if (!de.chaos || de.chaos.activeStateCount === 0) {
    throw new Error("surface chaos bench fixture has no active chaos graph");
  }
  return {
    activeStateCount: de.chaos.activeStateCount,
    predecessorMasks: de.chaos.predecessorMasks,
  };
}

export interface SurfaceChaosMarchRow {
  rays: number;
  gpuHits: number;
  cpuHits: number;
  passes: number;
  failures: number;
  truncated: boolean;
}

export interface SurfaceChaosMarchAcceptance {
  ok: boolean;
  activated: boolean;
  completed: boolean;
  agreed: boolean;
  gpuUseful: boolean;
  cpuUseful: boolean;
}

/** Graph-directed app-march activation, agreement, and anti-vacuity gate. */
export function surfaceChaosMarchAcceptance(
  row: SurfaceChaosMarchRow,
): SurfaceChaosMarchAcceptance {
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

export interface SurfaceChaosFrameRow {
  passes: number;
  truncated: boolean;
  counts: { hit: number; miss: number; exhausted: number; active: number };
}

export interface SurfaceChaosFrameAcceptance {
  ok: boolean;
  activated: boolean;
  geometry: boolean;
  settled: boolean;
}

/** Production-frame activation and terminal-status gate for the xaos row. */
export function surfaceChaosFrameAcceptance(
  row: SurfaceChaosFrameRow,
  software: boolean,
): SurfaceChaosFrameAcceptance {
  const activated = row.passes > 0;
  const geometry = row.counts.hit > 0;
  const cleanTerminalMix =
    !row.truncated &&
    row.counts.miss > 0 &&
    row.counts.exhausted === 0 &&
    row.counts.active === 0;
  // Software frames are throughput diagnostics: only dispatch activation
  // and visible geometry gate there, whether or not the host budget happened
  // to finish the tiny raster. Terminal cleanliness is a real-adapter gate.
  const settled = software || cleanTerminalMix;
  return {
    ok: activated && geometry && settled,
    activated,
    geometry,
    settled,
  };
}
