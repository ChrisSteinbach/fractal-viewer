/** Exact terminal-ray census for one completed surface trace pass. */
export interface SurfaceRayCensus {
  rays: number;
  covered: number;
  miss: number;
  exhausted: number;
  /** Exact bottom-row-first linear raster indices of every exhausted ray. */
  exhaustedIndices: readonly number[];
}

/** Trace-target alpha is a status side channel, never presented opacity. */
export const SURFACE_TRACE_ALPHA_MISS = 0;
export const SURFACE_TRACE_ALPHA_EXHAUSTED = 128;
export const SURFACE_TRACE_ALPHA_COVERED = 255;

/** GLSL value whose RGBA8 UNORM encoding is
 * {@link SURFACE_TRACE_ALPHA_EXHAUSTED}. */
export const SURFACE_TRACE_EXHAUSTED_ALPHA = 0.5;

/** Build a census only when the four terminal classes exactly partition the
 * raster. A partial/truncated or otherwise inconsistent frame has no exact
 * census and must stay undisclosed. */
export function exactSurfaceRayCensus(
  rays: number,
  covered: number,
  miss: number,
  exhausted: number,
  exhaustedIndices: readonly number[],
): SurfaceRayCensus | null {
  const values = [rays, covered, miss, exhausted];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  if (covered + miss + exhausted !== rays) return null;
  if (
    exhaustedIndices.length !== exhausted ||
    exhaustedIndices.some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= rays,
    ) ||
    new Set(exhaustedIndices).size !== exhaustedIndices.length
  ) {
    return null;
  }
  return {
    rays,
    covered,
    miss,
    exhausted,
    exhaustedIndices: [...exhaustedIndices],
  };
}

/** Decode the invisible RGBA8 alpha side channel written by the GLSL
 * tracers. Unknown alpha bytes are rejected rather than guessed: returning a
 * plausible but inexact census would defeat the verifier this channel exists
 * for. */
export function decodeSurfaceRayCensus(
  rgba: Uint8Array,
  width: number,
  height: number,
): SurfaceRayCensus | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 0 ||
    height < 0
  ) {
    return null;
  }
  const rays = width * height;
  if (!Number.isSafeInteger(rays) || rgba.length !== rays * 4) return null;

  let covered = 0;
  let miss = 0;
  let exhausted = 0;
  const exhaustedIndices: number[] = [];
  for (let index = 0, alpha = 3; alpha < rgba.length; index++, alpha += 4) {
    switch (rgba[alpha]) {
      case SURFACE_TRACE_ALPHA_MISS:
        miss++;
        break;
      case SURFACE_TRACE_ALPHA_EXHAUSTED:
        exhausted++;
        exhaustedIndices.push(index);
        break;
      case SURFACE_TRACE_ALPHA_COVERED:
        covered++;
        break;
      default:
        return null;
    }
  }
  return exactSurfaceRayCensus(
    rays,
    covered,
    miss,
    exhausted,
    exhaustedIndices,
  );
}
