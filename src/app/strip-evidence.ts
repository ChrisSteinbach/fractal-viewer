/**
 * The strip pump's COST EVIDENCE CHAIN, extracted from scene.ts per the
 * capture-cost.ts precedent: the rules here carry four separate measured
 * verdicts — completed observations replace the class floor in BOTH
 * directions, partials raise only, captures raise but never own, and a
 * completed capture may SEED an empty chain — and every one has a
 * failure mode a one-line regression would reintroduce silently, with the
 * only nets being minutes-long real-browser capture gates. Pure state and
 * arithmetic, so `strip-evidence.test.ts` pins each documented direction
 * without a WebGL context; scene.ts consumes it verbatim-behavior (its
 * `retireStripJob` adapts a job to {@link StripCostEvidence.retire}, its
 * two price wrappers pick the class floors).
 */

/** Multiplier from a completed job's observed worst px cost to the next
 * job's worst-case price floor: covers the preview-to-settle
 * tier gap (~4-6x measured px cost). Crease structure the coarser trace
 * under-sampled is the accepted residual — the cap's own headroom under
 * the watchdog absorbs it; pricing it here as well (the first cut used
 * x10) doubled the strip count of every measured-cheap fold frame for no
 * measured safety. */
export const STRIP_WORST_EVIDENCE_SAFETY = 5;

/** How a strip job left the pump — the evidence chain's whole input
 * vocabulary (see {@link StripCostEvidence.retire}). */
export type StripJobOutcome =
  "completed" | "superseded" | "capture" | "capture-completed";

/**
 * The evidence chain: what the strip pump has MEASURED about the
 * current system's worst per-pixel cost, and the rules for how new
 * observations move the price. Reset on every system upload — a new DE is
 * a new cost class.
 */
export class StripCostEvidence {
  /** Worst per-pixel strip cost (ms) observed by the most recent COMPLETED
   * strip job (null before any): a completed job traced its WHOLE frame,
   * so its observation REPLACES the class floor in both directions (scaled
   * by {@link STRIP_WORST_EVIDENCE_SAFETY}). Downward matters as much as
   * up: the fold-class floor is calibrated for deep-KIFS monsters, and
   * pinning a measured-cheap fold system (a lens over affine cores) to it
   * forever would dissolve its settle into tens of thousands of
   * readback-bound micro-strips — and feed the settle cost gate an
   * overhead-inflated prediction that silently skips a perfectly
   * affordable frame (the review regression that put this rule here). */
  private evidencedWorstMsPerPx: number | null = null;

  /** Worst per-pixel strip cost (ms) observed by PARTIAL (superseded) jobs
   * since the last completed one (0 = none). Partial coverage can prove a
   * pose expensive but never cheap, so this only ever RAISES the floor —
   * a monster pose discovered mid-job cannot be re-rouletted by the
   * re-armed successor — and the next completed job's whole-frame
   * evidence clears it. */
  private partialWorstMsPerPx = 0;

  /** A new DE is a new cost class: forget everything. */
  reset(): void {
    this.evidencedWorstMsPerPx = null;
    this.partialWorstMsPerPx = 0;
  }

  /** RAW completed-job floor for the ?surfacetrace diagnosis line
   * — before {@link STRIP_WORST_EVIDENCE_SAFETY} scales it into
   * the worst price. Null until a job completes. */
  get evidencedRawMsPerPx(): number | null {
    return this.evidencedWorstMsPerPx;
  }

  /** RAW superseded-job ratchet term for the same diagnosis line. */
  get partialRawMsPerPx(): number {
    return this.partialWorstMsPerPx;
  }

  /**
   * The evidence-chain price core shared by the strip cap and the queue
   * bound: `classFloor` rules until a COMPLETED job's whole-frame
   * observation OWNS the price — scaled by
   * {@link STRIP_WORST_EVIDENCE_SAFETY} for the tier gap (the settle
   * traces deeper than the preview whose evidence seeds it, ~4-6x
   * measured) — in both directions: up on monster poses (Iris crease
   * pixels measured 1.7-3.1s), down on measured-cheap fold systems.
   * Partial (superseded-job) measurements come from whatever band the
   * strips crossed and can prove a pose expensive, never cheap, so they
   * only ever RAISE it.
   */
  price(classFloor: number): number {
    const evidenced = this.evidencedWorstMsPerPx;
    const base =
      evidenced !== null ? evidenced * STRIP_WORST_EVIDENCE_SAFETY : classFloor;
    return Math.max(
      base,
      this.partialWorstMsPerPx * STRIP_WORST_EVIDENCE_SAFETY,
    );
  }

  /**
   * Retire a strip job's observation into the chain. A "completed" LIVE
   * job's observation replaces the evidence (and clears the partial
   * raise); a "superseded" job's observation can only raise; a "capture"
   * drain can only raise WITHOUT killing the evidence — the pose
   * did not move, so live settle/preview evidence is still the truth a
   * live job should price from, and an export-scale observation must
   * tighten that floor, never own it. "capture-completed" adds the one
   * thing a capture may do beyond raising: SEED a chain that is empty.
   * A job that measured NOTHING (superseded before its first
   * strip completed, or done in a single strip) carries no information
   * and changes nothing.
   */
  retire(outcome: StripJobOutcome, observedWorstMsPerPx: number): void {
    const observed = observedWorstMsPerPx;
    if (outcome === "completed") {
      if (observed > 0) {
        this.evidencedWorstMsPerPx = observed;
        this.partialWorstMsPerPx = 0;
      }
      return;
    }
    // A capture that COMPLETED may SEED an empty evidence chain,
    // never replace a live one. The seed matters because an offline export
    // is the one caller that never produces live evidence at all: a system
    // upload clears the chain, force frames bypass the preview, and a
    // raise-only retire cannot fill it — so every frame of a fold-scene
    // video priced its queue at the class prior, ~100x above what its own
    // pixels measured, and paid a forced-completion join per ~400px. Frame
    // one still does; the rest now price from it. It is safe in the
    // direction it can be wrong: a capture traces the WHOLE frame at the
    // same pose, so its observation is a settle's in kind, and an
    // export-scale trace resolves finer pixels than the live tier, which
    // reads HIGH — tighter strips, never looser.
    if (
      outcome === "capture-completed" &&
      observed > 0 &&
      this.evidencedWorstMsPerPx === null
    ) {
      this.evidencedWorstMsPerPx = observed;
    }
    // A SUPERSEDED job means the pose moved on — and with it whatever a
    // completed predecessor proved cheap. Keeping stale evidence bit
    // live, as validation measured: a far-pose preview completed cheap
    // during the entry glide, its relaxed floor let the PARKED monster
    // pose plan 2220px strips, and the first groups ran 16-22s. Evidence
    // relaxation lives exactly one completed-preview -> settle handoff
    // (main.ts begins the settle only while the completing preview's
    // pose still stands); everything mid-motion prices at the class
    // floor plus the partial ratchet.
    if (outcome === "superseded") {
      this.evidencedWorstMsPerPx = null;
    }
    if (observed > 0) {
      this.partialWorstMsPerPx = Math.max(this.partialWorstMsPerPx, observed);
    }
  }
}
