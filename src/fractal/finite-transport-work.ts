import { DIELECTRIC_MAX_STACK } from "./surface-dielectric";

/** Scheduling quantum, not a path/energy limit. A paused finite trace resumes
 * the same LIFO work list at the same replay threshold. No scene field. */
export const FINITE_TRANSPORT_CHUNK_PATHS = 2048;

/** Internal status only: it must never reach a completed frame's census or
 * advance the outer refinement pass. Existing transport statuses stay frozen. */
export const FINITE_TRANSPORT_RUNNING = 6;

/** Batch buffer header: initialize, atomic running count, generation, ray
 * count, then the submission's scheduling quantum and three pad words. Host
 * rewrites the first two words and the quantum before each submission;
 * generation changes only for a new batch, whose ray-to-slot mapping stays
 * fixed while paused. The quantum moves no pixel: a pause changes no path,
 * term or arithmetic order, whatever the count between pauses. */
export const FINITE_TRANSPORT_BUFFER_HEADER_BYTES = 32;
export const FINITE_TRANSPORT_QUANTUM_OFFSET = 16;
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

/** The generic `TransportPath` (every non-finite backend): origin, dir and
 * energy vec3f pairs through 56, the displayed anchor vec3f at 64, flags at
 * 76/80, rounded to 96 at alignment 16. The sphere-inversion glass
 * continuation stores this stride; the slot header above is unchanged. */
export const TRANSPORT_PATH_BYTES = 96;

/** One continuation slot for a path stride: the shared 48-byte header and
 * the unchanged 24-entry LIFO stack. */
export function transportWorkSlotBytes(pathBytes: number): number {
  return FINITE_TRANSPORT_WORK_HEADER_BYTES + DIELECTRIC_MAX_STACK * pathBytes;
}

/** The sphere-inversion glass backend's BASE scheduling quantum. Unlike the
 * finite DDA, one processed path here is an estimator march over the
 * family's fold (up to depth x generators inversions per field tap), so the
 * base is small: it bounds a batch's full-width first chunk and ONE
 * WORKGROUP's submission, which the transport lane cannot shrink below.
 * The host grows each later chunk's quantum from it as the batch drains
 * (`surface-compute.ts`'s `nextTransportQuantum`) unless a quantum is
 * pinned. Measured on the RX 7900 XTX, recorded in
 * docs/sphere-inversion-family.md's glass envelope and transport-cost
 * sections. */
export const SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS = 32;

export function finiteTransportWorkBytes(capacity: number): number {
  return transportWorkBytes(capacity, FINITE_TRANSPORT_PATH_BYTES);
}

/** Batch header plus `capacity` slots of the given path stride. */
export function transportWorkBytes(
  capacity: number,
  pathBytes: number,
): number {
  const bytes =
    FINITE_TRANSPORT_BUFFER_HEADER_BYTES +
    capacity * transportWorkSlotBytes(pathBytes);
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

/** Zero selects uninterrupted execution (the direct-codegen default and the
 * diagnostic equivalence control); omitted selects the production quantum. */
export function resolveSphereInversionTransportChunkPaths(
  value?: number,
): number {
  return resolveFiniteTransportChunkPaths(
    value ?? SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS,
  );
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

/**
 * THE SPHERE-INVERSION TRANSPORT POOL'S SLOT WORD. The host keeps a pool of
 * continuation slots busy: a finished slot takes the next queued ray at once,
 * and a ray whose trace came back pending re-enters the queue at its next
 * replay pass, so the long serial traces of one batch or pass overlap the rest
 * of the frame instead of trailing it. Each slot therefore carries its own
 * replay pass and its own fresh start, in the ray-list word the kernel reads:
 * the ray in the low {@link SPHERE_INVERSION_POOL_RAY_BITS} bits, the pass
 * above them, a SPECULATIVE trace in bit 30 and a fresh start in bit 31. The
 * finite lane keeps its plain ray list and batch-wide pass.
 *
 * 27 ray bits hold 134M rays: past every raster the pool is handed (capture
 * tiles stop at 4M rays, the joint pool's arenas near 1.2M), and the word
 * refuses rather than wraps.
 */
export const SPHERE_INVERSION_POOL_RAY_BITS = 27;
export const SPHERE_INVERSION_POOL_RAY_MASK =
  (1 << SPHERE_INVERSION_POOL_RAY_BITS) - 1;
export const SPHERE_INVERSION_POOL_PASS_MASK = 7;
/**
 * A SPECULATIVE replay pass (the host pool's speculation): the trace runs
 * exactly as its pass would, but a finished one never writes the ray's
 * pixel, layer or record. It keeps its result in its own continuation slot
 * (radiance, residual, and status/failure/reason packed in the header's
 * spare word with {@link SPHERE_INVERSION_SPEC_STORED} set) until the host
 * decides, however early it finished (a later pass can fail before its
 * predecessor finishes): re-dispatched with this bit clear, a finished slot
 * COMMITS its stored result through the ordinary output lines; a running one
 * simply writes them when it finishes. A resumed speculative slot that finds
 * the ray already final stops without writing, where a real one would
 * reject.
 */
export const SPHERE_INVERSION_POOL_SPEC_BIT = 0x40000000;
export const SPHERE_INVERSION_POOL_FRESH_BIT = 0x80000000;
/** The stored-result flag in a speculative slot's spare header word. */
export const SPHERE_INVERSION_SPEC_STORED = 0x80000000;

/** One pool slot's word (module doc). Throws on a ray or pass the word
 * cannot carry — never a silently wrapped index. */
export function sphereInversionPoolWord(
  ray: number,
  replayPass: number,
  fresh: boolean,
): number {
  if (
    !Number.isInteger(ray) ||
    ray < 0 ||
    ray > SPHERE_INVERSION_POOL_RAY_MASK ||
    !Number.isInteger(replayPass) ||
    replayPass < 0 ||
    replayPass > SPHERE_INVERSION_POOL_PASS_MASK
  )
    throw new RangeError("Transport pool word: ray or pass out of range");
  return (
    (ray |
      (replayPass << SPHERE_INVERSION_POOL_RAY_BITS) |
      (fresh ? SPHERE_INVERSION_POOL_FRESH_BIT : 0)) >>>
    0
  );
}

/**
 * THE JOINT POOL: one pool over EVERY supersample of a frame. A sample's
 * transport is paced by the serial length of its longest traces, not by the
 * device's width: past the first few hundred milliseconds a sample's pool
 * runs a few thousand, then a few dozen, slots, and each chunk still costs
 * what a full one does. So an N-sample frame queues all N samples' glass rays
 * into ONE pool and their tails run side by side, instead of four drains
 * running one after the other.
 *
 * The ray field then names a GLOBAL ray, `sample * stride + pixel`, over
 * per-ray arenas holding `stride` rays per sample. The batch header's first
 * pad word ({@link SPHERE_INVERSION_JOINT_STRIDE_OFFSET}) carries `stride`,
 * and 0 there is the single-sample pool exactly. A sample's sub-pixel offset
 * is the one per-sample quantity the transport reads. It rides the optics
 * lane buffer's tail: {@link SPHERE_INVERSION_JOINT_SAMPLES_MAX} `vec4f`
 * entries whose `xy` is sample `s`'s offset, as f32, the same value the
 * shade uniform's `pixelJitter` carries for that sample. A ray's arithmetic
 * is its own in either pool, so no pixel moves.
 */
export const SPHERE_INVERSION_JOINT_STRIDE_OFFSET = 20;
export const SPHERE_INVERSION_JOINT_SAMPLES_MAX = 64;
/** Arena strides are whole multiples of this many rays, so every sample's
 * sub-range starts on a 256-byte storage-binding offset for the 4-byte
 * per-ray buffers, and on a larger multiple for the wider ones. */
export const SPHERE_INVERSION_JOINT_STRIDE_ALIGN = 64;

/** The per-sample arena stride for a raster of `rays`: rounded up to
 * {@link SPHERE_INVERSION_JOINT_STRIDE_ALIGN}. */
export function sphereInversionJointStride(rays: number): number {
  if (!Number.isSafeInteger(rays) || rays < 1)
    throw new RangeError("Joint transport stride: rays must be positive");
  return (
    Math.ceil(rays / SPHERE_INVERSION_JOINT_STRIDE_ALIGN) *
    SPHERE_INVERSION_JOINT_STRIDE_ALIGN
  );
}
