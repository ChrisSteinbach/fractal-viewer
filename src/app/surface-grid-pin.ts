/**
 * Diagnostics override for the surface render's empty-space-skipping grid,
 * the same URL convention as `?surfacesamples` (`surface-sampling.ts`):
 * invalid values deliberately mean no override so the shipped flow stays
 * authoritative. Two levers, one parser — both consumed at the one grid
 * request site:
 *
 * - `?surfacegrid=0` refuses the grid outright; the session marches
 *   gridless (correct, slower). The A/B arm that separates skip-regime
 *   variance from everything else in a determinism investigation.
 * - `?surfacegridres=N` (4..64) pins the build's per-axis cell count and
 *   marks the request `explicit`, so the worker's measured pilot slab never
 *   second-guesses it. The lever that holds the grid constant across two
 *   boots — without it, `pickSurfaceGridResolution`'s wall-clock pilot is
 *   free to deliver 48 on one boot and 32 on another, and every trace that
 *   samples the grid's floors changes its march-step regime with it.
 */
export interface SurfaceGridOverride {
  refuse: boolean;
  resolution: number | null;
}

export function parseSurfaceGridOverride(search: string): SurfaceGridOverride {
  const params = new URLSearchParams(search);
  const refuse = params.get("surfacegrid") === "0";
  const raw = params.get("surfacegridres");
  const resolution =
    raw === null
      ? null
      : Number.isInteger(Number(raw)) && Number(raw) >= 4 && Number(raw) <= 64
        ? Number(raw)
        : null;
  return { refuse, resolution };
}
