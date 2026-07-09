/**
 * fr-ul2 throughput instrumentation for the flame accumulation loop. A
 * {@link FlameWorkerSession} that opted in (its `start` set `instrument`) feeds
 * one {@link FlameChunkSample} per completed accumulation chunk; the meter sums
 * each phase and, once a display window's worth of wall time has elapsed,
 * yields a one-line human-readable summary — and resets the window — for the
 * session to hand to its `log` dep. Pure: no clock, no globals, no DOM. It is
 * driven entirely by the samples it is handed, so it unit-tests without a
 * browser like the rest of the core.
 *
 * Why it exists: the `/gpu-bench/` page measures RAW kernel throughput —
 * `iterations / sum(accumulate())`, with no readback and no scheduling gap in
 * the denominator (see gpu-bench's `runGpuTimed`). A phone soak (fr-7su) saw
 * the PRODUCTION path sustain ~50x LESS than that same adapter's bench number.
 * The bench cannot reproduce the deficit precisely because it excludes the two
 * phases this meter isolates: the per-redisplay readback and the inter-chunk
 * scheduling gap. The summary's split — accumulate vs readback vs gap vs other,
 * plus the app-side accumulate rate to hold against the bench's — is what tells
 * whether the deficit is readback-bound, scheduling-bound, or a genuinely
 * slower in-app kernel. This module only measures; it deliberately changes no
 * behavior (every clock read feeding it is guarded in the session).
 */

/** One completed accumulation chunk's phase timings (all wall-clock ms). */
export interface FlameChunkSample {
  /** `accumulate()` wall time — directly comparable to the bench's per-call
   * timing, which likewise brackets `accumulate()` alone. */
  accumulateMs: number;
  /** Iterations the backend retired this chunk. */
  iterations: number;
  /** Redisplay (readback + convert + present) wall time on a due tick; 0 on a
   * chunk that wasn't due for a redisplay. */
  readbackMs: number;
  /** Scheduling gap since the previous chunk's work ended — the cost the bench
   * has none of; 0 for a session's first chunk. */
  gapMs: number;
  /** Total chunk-body wall time (accumulate + any redisplay + loop overhead),
   * NOT including the inter-chunk `gapMs`. */
  wallMs: number;
  /** Adaptive chunk size in effect after this chunk. */
  chunkSize: number;
  backendKind: "gpu" | "cpu";
}

/** Default display window: long enough to average many chunks (and several of
 * the 150 ms redisplays) yet frequent enough to watch a multi-minute soak
 * evolve. */
export const FLAME_PERF_WINDOW_MS = 2000;

/** Human-scale iteration rate, e.g. `53.0 M iter/s`; `—` for a rate that can't
 * be computed (a zero/negative/non-finite denominator). */
function formatRate(itersPerSec: number): string {
  if (!Number.isFinite(itersPerSec) || itersPerSec <= 0) return "—";
  if (itersPerSec >= 1e9) return `${(itersPerSec / 1e9).toFixed(2)} B iter/s`;
  if (itersPerSec >= 1e6) return `${(itersPerSec / 1e6).toFixed(1)} M iter/s`;
  if (itersPerSec >= 1e3) return `${(itersPerSec / 1e3).toFixed(1)} K iter/s`;
  return `${Math.round(itersPerSec)} iter/s`;
}

/** Compact count, e.g. `1.2M` / `262K`, for the adaptive chunk size. */
function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/**
 * Accumulates {@link FlameChunkSample}s and emits a windowed summary. The
 * window is measured in the samples' OWN wall time — `wallMs + gapMs` summed —
 * not a separate clock, so it advances in lockstep with the render it measures
 * and stays fully deterministic under test.
 */
export class FlamePerfMeter {
  private chunks = 0;
  private iterations = 0;
  private accumulateMs = 0;
  private readbackMs = 0;
  private gapMs = 0;
  private wallMs = 0;
  private lastChunkSize = 0;
  private lastBackendKind: "gpu" | "cpu" = "cpu";

  constructor(private readonly windowMs: number = FLAME_PERF_WINDOW_MS) {}

  /**
   * Fold one chunk in. Returns a summary string once the accumulated window
   * (chunk wall time + inter-chunk gaps) reaches {@link windowMs} — resetting
   * the window so the next call starts a fresh one — or `null` while the window
   * is still filling.
   */
  record(sample: FlameChunkSample): string | null {
    this.chunks += 1;
    this.iterations += sample.iterations;
    this.accumulateMs += sample.accumulateMs;
    this.readbackMs += sample.readbackMs;
    this.gapMs += sample.gapMs;
    this.wallMs += sample.wallMs;
    this.lastChunkSize = sample.chunkSize;
    this.lastBackendKind = sample.backendKind;
    if (this.elapsedMs() < this.windowMs) return null;
    const summary = this.summary();
    this.reset();
    return summary;
  }

  /** Window wall time so far: chunk bodies plus the gaps between them. */
  private elapsedMs(): number {
    return this.wallMs + this.gapMs;
  }

  private summary(): string {
    const elapsed = this.elapsedMs();
    const effRate = (this.iterations / elapsed) * 1000;
    // The bench-comparable number: iterations per second of PURE accumulate. If
    // this matches the bench but `effRate` is far below it, the deficit is all
    // readback + gap (overhead-bound); if this itself is far below the bench,
    // the in-app kernel is the slower one.
    const accumRate =
      this.accumulateMs > 0
        ? (this.iterations / this.accumulateMs) * 1000
        : NaN;
    // Loop overhead outside the two named phases (rebuildDisplay, sendProgress,
    // chunk bookkeeping). Floored at 0 against sub-millisecond clock jitter.
    const otherMs = Math.max(
      0,
      this.wallMs - this.accumulateMs - this.readbackMs,
    );
    const pct = (ms: number): string => `${Math.round((100 * ms) / elapsed)}%`;
    return (
      `flame perf [${this.lastBackendKind}] eff ${formatRate(effRate)}` +
      ` | accum ${formatRate(accumRate)} (${pct(this.accumulateMs)})` +
      ` · readback ${pct(this.readbackMs)} · gap ${pct(this.gapMs)}` +
      ` · other ${pct(otherMs)}` +
      ` | ${this.chunks} chunks, size ${formatCount(this.lastChunkSize)},` +
      ` ${Math.round(elapsed)} ms`
    );
  }

  private reset(): void {
    this.chunks = 0;
    this.iterations = 0;
    this.accumulateMs = 0;
    this.readbackMs = 0;
    this.gapMs = 0;
    this.wallMs = 0;
    // lastChunkSize / lastBackendKind are the latest STATE, not windowed sums —
    // retained across the reset so a new window's summary never reports size 0
    // before its first sample lands (it always has one, but this keeps the
    // fields' meaning honest).
  }
}
