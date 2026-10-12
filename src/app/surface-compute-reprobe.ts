/**
 * The Surface compute probe's RETRY and RE-PROBE policy — the two levers
 * that make an adapter-unavailable verdict a recoverable state instead of
 * a page-long block.
 *
 * The measured defect (2026-10-10, real Chrome on the AMD RX 7900 XTX,
 * `--display=:0`): the boot probe RACES Chrome's GPU-process
 * initialization, and losing the race latched `surfaceComputeBlock =
 * "unavailable"` one-way for the whole page — six of six fresh contexts
 * booting the same sphaira document routed every later Surface session to
 * the WebGL fallback with no diagnostics, while the same document in a
 * context whose probe had already succeeded took the compute engine. The
 * one-way design exists for FAILED creates (a dead device never returns);
 * an adapter UNAVAILABLE verdict is a different class — the GPU process
 * comes up — so the policy makes that class self-healing in two places:
 *
 * 1. THE BOOT LADDER. {@link probeAdapterWithRetries} re-asks a FRESH
 *    `requestAdapter()` (never a cached verdict) on a short doubling
 *    backoff — three attempts, ~0.75s of total waiting — before the
 *    caller latches. Chrome's GPU process typically finishes initializing
 *    well inside that window, so the latch becomes the rare outcome it
 *    should have been all along.
 *
 * 2. THE SESSION DOOR. {@link surfaceComputeReprobeDue} gates a one-shot
 *    re-probe at a Surface session entry: when the block still reads
 *    "unavailable" and the verdict is older than
 *    {@link SURFACE_REPROBE_MIN_AGE_MS}, the door awaits one fresh probe
 *    before the routing decision — a page that lost the race recovers on
 *    its first Surface click instead of needing a reload. A failed
 *    re-probe re-stamps the verdict time, which throttles the next door
 *    the same way; the caller supersedes a pending probe (any mode
 *    switch, any newer entry) by token, and its continuation re-checks
 *    the render mode it was kicked from before entering.
 *
 * The "failed" class (device/pipeline death mid-session) and the "flag"
 * block (the user's own `?surfacegl`) stay one-way by measurement and by
 * choice respectively — neither is this module's business.
 */

import type { SurfaceComputeBlock } from "./render-backend";

/** Boot-ladder attempts including the first (at t=0). Three is the bead's
 * own shape: enough to ride out Chrome's GPU-process init, short enough
 * that a genuinely adapterless Firefox latches the honest note without a
 * long dead boot. */
export const SURFACE_PROBE_ATTEMPTS = 3;

/** The ladder's backoff base, DOUBLED per retry: 250ms then 500ms — the
 * whole ladder spans ~0.75s of waiting. */
export const SURFACE_PROBE_BACKOFF_MS = 250;

/** A session-door re-probe fires only when the "unavailable" verdict is at
 * least this old: a verdict stamped moments ago (a create() failure that
 * just latched, the boot ladder's own final failure) is fresh evidence,
 * and re-asking it per re-enter would spend probes on a question the page
 * just answered. */
export const SURFACE_REPROBE_MIN_AGE_MS = 2000;

/** What a probe attempt looks like: one `requestAdapter()` round-trip and
 * the wait between attempts. Injected so the ladder is testable without a
 * browser or real timers. */
export interface SurfaceComputeProbeHarness {
  probe: () => Promise<boolean>;
  delay?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The boot probe's retry ladder: attempt immediately, then retry FRESH
 * probes on the doubling backoff until one succeeds or the ladder runs
 * out. Every attempt is a new `requestAdapter()` — a cached one-shot
 * would return the losing race's verdict forever. A rejected probe
 * counts as a failed attempt (the renderer's own probe already catches,
 * but the ladder refuses to turn a thrown probe into an unhandled
 * rejection), and `false` resolves only after the full ladder.
 */
export async function probeAdapterWithRetries(
  harness: SurfaceComputeProbeHarness,
  opts: { attempts?: number; backoffMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? SURFACE_PROBE_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? SURFACE_PROBE_BACKOFF_MS;
  const wait = harness.delay ?? defaultDelay;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(backoffMs * 2 ** (attempt - 1));
    try {
      if (await harness.probe()) return true;
    } catch {
      // A thrown probe is a failed attempt, never an unhandled rejection.
    }
  }
  return false;
}

/**
 * The session-door re-probe gate. True when a Surface entry should await
 * one fresh probe before its routing decision: the block reads
 * "unavailable" (never "flag" — the user's own choice — nor "failed" — a
 * dead device never returns — and a clear block has nothing to recover),
 * the context even exposes `navigator.gpu` (an absent API is a permanent
 * verdict, not a stale one), and the verdict is at least
 * {@link SURFACE_REPROBE_MIN_AGE_MS} old.
 */
export function surfaceComputeReprobeDue(args: {
  block: SurfaceComputeBlock | null;
  supported: boolean;
  unavailableAt: number;
  now: number;
}): boolean {
  return (
    args.block === "unavailable" &&
    args.supported &&
    args.now - args.unavailableAt >= SURFACE_REPROBE_MIN_AGE_MS
  );
}
