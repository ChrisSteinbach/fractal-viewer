import { DIELECTRIC_MAX_STACK } from "./surface-dielectric";

/** Scheduling quantum, not a path/energy limit. A paused finite trace resumes
 * the same LIFO work list at the same replay threshold. No scene field. */
export const FINITE_TRANSPORT_CHUNK_PATHS = 2048;

/** Internal status only: it must never reach a completed frame's census or
 * advance the outer refinement pass. Existing transport statuses stay frozen. */
export const FINITE_TRANSPORT_RUNNING = 6;

/** Batch buffer header: initialize, atomic running count, generation, ray count.
 * Host resets the first two words before each submission; generation changes
 * only for a new batch, whose ray-to-slot mapping stays fixed while paused. */
export const FINITE_TRANSPORT_BUFFER_HEADER_BYTES = 16;
export const FINITE_TRANSPORT_RUNNING_OFFSET = 4;

/** The existing finite path, including its complete canonical anchor. */
export const FINITE_TRANSPORT_PATH_BYTES = 112;

/** Per-slot header (48 bytes, followed by the unchanged 24-entry path stack):
 * 0: radiance vec3f; 12: residual f32; 16: stack size; 20: processed paths;
 * 24: done; 28: pixel; 32: replay pass; 36: generation; 40: padding vec2u.
 * Integer identity/counters and every f32 payload survive a pause verbatim. */
export const FINITE_TRANSPORT_WORK_HEADER_BYTES = 48;
export const FINITE_TRANSPORT_WORK_BYTES =
  FINITE_TRANSPORT_WORK_HEADER_BYTES +
  DIELECTRIC_MAX_STACK * FINITE_TRANSPORT_PATH_BYTES;

export function finiteTransportWorkBytes(capacity: number): number {
  const bytes =
    FINITE_TRANSPORT_BUFFER_HEADER_BYTES +
    capacity * FINITE_TRANSPORT_WORK_BYTES;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    !Number.isSafeInteger(bytes)
  )
    throw new RangeError(
      "Finite transport work capacity must be a positive safe integer",
    );
  return bytes;
}

/** Zero selects uninterrupted execution for diagnostic equivalence controls.
 * Omitted create options select the production scheduling quantum. */
export function resolveFiniteTransportChunkPaths(value?: number): number {
  const paths = value ?? FINITE_TRANSPORT_CHUNK_PATHS;
  if (!Number.isSafeInteger(paths) || paths < 0 || paths > 0xffffffff)
    throw new RangeError(
      "Finite transport chunk size must fit an unsigned word",
    );
  return paths;
}
