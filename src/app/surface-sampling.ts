/** User-facing Surface antialiasing choices, in samples per pixel. */
export const SURFACE_ANTIALIAS_DETENTS = [1, 2, 4, 8, 16] as const;

export type SurfaceAntialiasSamples =
  (typeof SURFACE_ANTIALIAS_DETENTS)[number];

export const DEFAULT_SURFACE_ANTIALIAS_SAMPLES: SurfaceAntialiasSamples = 8;

/** Snap an authored value to the nearest supported Surface quality detent. */
export function nearestSurfaceAntialiasSamples(
  samples: number,
): SurfaceAntialiasSamples {
  let nearest = DEFAULT_SURFACE_ANTIALIAS_SAMPLES;
  let distance = Infinity;
  for (const detent of SURFACE_ANTIALIAS_DETENTS) {
    const candidateDistance = Math.abs(samples - detent);
    if (candidateDistance < distance) {
      nearest = detent;
      distance = candidateDistance;
    }
  }
  return nearest;
}

/**
 * Diagnostic A/B override. Invalid values deliberately mean no override so
 * the authored document choice remains authoritative.
 */
export function parseSurfaceSamplesOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("surfacesamples");
  if (raw === null) return null;
  const samples = Number(raw);
  return Number.isInteger(samples) && samples >= 1 && samples <= 64
    ? samples
    : null;
}

export function effectiveSurfaceSamples(
  authored: number,
  override: number | null,
): number {
  return override ?? nearestSurfaceAntialiasSamples(authored);
}
