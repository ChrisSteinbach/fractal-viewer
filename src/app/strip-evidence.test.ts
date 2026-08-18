import {
  StripCostEvidence,
  STRIP_WORST_EVIDENCE_SAFETY,
} from "./strip-evidence";

// The fr-096u evidence chain's rules, each pinned in the direction whose
// regression the docs record as a real incident (fr-vja8.66): these were
// previously testable only by minutes-long real-browser capture gates.

describe("StripCostEvidence", () => {
  it("prices at the class floor before any evidence exists", () => {
    const evidence = new StripCostEvidence();
    expect(evidence.price(50)).toBe(50);
  });

  it("a completed job's observation replaces the floor DOWNWARD", () => {
    // The direction the fr-096u review regression was about: a
    // measured-cheap fold system pinned to the monster-class floor forever
    // dissolves its settle into readback-bound micro-strips.
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 0.5);
    expect(evidence.price(50)).toBe(0.5 * STRIP_WORST_EVIDENCE_SAFETY);
    expect(evidence.price(50)).toBeLessThan(50);
  });

  it("a completed job's observation replaces the floor UPWARD", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 30);
    expect(evidence.price(50)).toBe(30 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a completed job clears the partial ratchet along with owning the price", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("superseded", 40);
    evidence.retire("completed", 1);
    // Were the ratchet still live, max(1*S, 40*S) would price at 200.
    expect(evidence.price(50)).toBe(1 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a superseded job's observation can prove a pose expensive, never cheap", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("superseded", 2);
    // 2*S = 10 < the 50 floor: a partial cannot relax anything.
    expect(evidence.price(50)).toBe(50);
    evidence.retire("superseded", 40);
    expect(evidence.price(50)).toBe(40 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a superseded job kills completed evidence — the pose moved on", () => {
    // The fr-096u validation incident: a far-pose preview completed cheap
    // during the entry glide, and its stale relaxed floor let the parked
    // monster pose plan 16-22s strip groups.
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 0.5);
    evidence.retire("superseded", 0);
    expect(evidence.price(50)).toBe(50);
  });

  it("a superseded job's own observation still ratchets after the kill", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 0.5);
    evidence.retire("superseded", 40);
    expect(evidence.price(50)).toBe(40 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a capture drain raises the price but never owns the evidence", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 1);
    evidence.retire("capture", 40);
    // The raise lands through the ratchet...
    expect(evidence.price(50)).toBe(40 * STRIP_WORST_EVIDENCE_SAFETY);
    // ...but the live evidence survives underneath: a later completed job
    // resets the ratchet and the chain prices from live truth again.
    evidence.retire("completed", 1);
    expect(evidence.price(50)).toBe(1 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a completed capture SEEDS an empty chain (fr-y1m7)", () => {
    // Offline export is the one caller that never produces live evidence;
    // without the seed every frame of a fold-scene video paid class-prior
    // micro-strips.
    const evidence = new StripCostEvidence();
    evidence.retire("capture-completed", 3);
    expect(evidence.price(50)).toBe(3 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a completed capture never replaces a live chain — seed only", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 1);
    evidence.retire("capture-completed", 0.1);
    // Live evidence stands; the capture's cheaper reading cannot relax it
    // below the live truth (its 0.1 raise is under the ratchet floor too).
    expect(evidence.price(50)).toBe(1 * STRIP_WORST_EVIDENCE_SAFETY);
  });

  it("a job that measured nothing changes nothing — except the superseded kill", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 2);
    evidence.retire("capture", 0);
    evidence.retire("capture-completed", 0);
    expect(evidence.price(50)).toBe(2 * STRIP_WORST_EVIDENCE_SAFETY);
    // Superseded-with-nothing still means the pose moved: evidence dies,
    // and with no observation the ratchet stays empty — back to the floor.
    evidence.retire("superseded", 0);
    expect(evidence.price(50)).toBe(50);
  });

  it("reset forgets both terms — a new DE is a new cost class", () => {
    const evidence = new StripCostEvidence();
    evidence.retire("completed", 30);
    evidence.retire("superseded", 40);
    evidence.reset();
    expect(evidence.price(50)).toBe(50);
    expect(evidence.evidencedRawMsPerPx).toBeNull();
    expect(evidence.partialRawMsPerPx).toBe(0);
  });
});
