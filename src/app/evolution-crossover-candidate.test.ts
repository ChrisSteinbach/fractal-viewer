import { sierpinskiTetrahedron } from "../fractal/presets";
import { initialState } from "./state";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { CROSSOVER_ALGORITHM_VERSION } from "./evolution-crossover";
import { SURFACE_MAX_MAPS } from "./surface-material";
import {
  CROSSOVER_V1_MAX_ATTEMPTS,
  createEvolutionCrossoverCandidate,
  type EvolutionCrossoverCandidate,
  type EvolutionCrossoverCandidateRequest,
  type EvolutionCrossoverCandidateResult,
} from "./evolution-crossover-candidate";

const REQUEST: EvolutionCrossoverCandidateRequest = {
  algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
  nodeSeed: 0x51a7cafe,
  childOrdinal: 3,
  surfaceRequired: false,
};

function snapshot(): SceneSnapshot {
  const result = toSnapshot(initialState(false));
  result.transforms = sierpinskiTetrahedron();
  result.symmetry = { order: 1, plane: "xz" };
  delete result.finalTransform;
  delete result.schedule;
  delete result.shapeTrap;
  return result;
}

function accepted(
  result: EvolutionCrossoverCandidateResult,
): EvolutionCrossoverCandidate {
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.reason);
  return result.candidate;
}

describe("crossover-v1 strict candidate gate", () => {
  it("returns the first deterministic two-probe exact document with complete provenance", () => {
    const primary = snapshot();
    const secondary = snapshot();
    secondary.transforms.forEach((transform) => {
      transform.position[0] += 0.03;
    });
    const first = accepted(
      createEvolutionCrossoverCandidate(
        { snapshot: primary },
        { snapshot: secondary },
        REQUEST,
      ),
    );
    const second = accepted(
      createEvolutionCrossoverCandidate(
        { snapshot: primary },
        { snapshot: secondary },
        REQUEST,
      ),
    );
    expect(first).toEqual(second);
    expect(first.quality.scores).toHaveLength(2);
    expect(first.profile).toMatchObject({
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      nodeSeed: REQUEST.nodeSeed,
      childOrdinal: REQUEST.childOrdinal,
      pairingKind: "unrelated-role-order-v1",
      surfaceRequired: false,
    });
    expect(first.profile.acceptedAttempt).toBeLessThan(
      CROSSOVER_V1_MAX_ATTEMPTS,
    );
    expect(first.surfaceEligibility).toBeNull();
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.topology.slotKeys)).toBe(true);
    expect(first.profile.topologyToken).toBe(first.topology.token);
    expect(first.profile.topologySlotKeys).toBe(first.topology.slotKeys);
  });

  it("returns structured eight-attempt exhaustion and never a candidate below quality", () => {
    const primary = snapshot();
    const secondary = snapshot();
    for (const parent of [primary, secondary]) {
      parent.transforms = [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0, 0, 0],
        },
      ];
    }
    const result = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      REQUEST,
    );
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejection).toMatchObject({ reason: "attempts-exhausted" });
    if (result.rejection.reason !== "attempts-exhausted") return;
    expect(result.rejection.attempts).toHaveLength(CROSSOVER_V1_MAX_ATTEMPTS);
    expect(
      result.rejection.attempts.every(
        (failure) => failure.reason === "quality-below-threshold",
      ),
    ).toBe(true);
    expect("candidate" in result).toBe(false);
  });

  it("retains the complete frozen neutral Surface result in lineage provenance", () => {
    const candidate = accepted(
      createEvolutionCrossoverCandidate(
        { snapshot: snapshot() },
        { snapshot: snapshot() },
        { ...REQUEST, surfaceRequired: true },
      ),
    );
    expect(candidate.surfaceEligibility).toEqual({
      status: "eligible",
      note: null,
      kind: "ifs",
    });
    expect(candidate.profile.surfaceEligibility).toEqual(
      candidate.surfaceEligibility,
    );
    expect(candidate.profile.surfaceEligibility).toBe(
      candidate.surfaceEligibility,
    );
    expect(Object.isFrozen(candidate.profile.surfaceEligibility)).toBe(true);
  });

  it("applies capability-neutral Surface after quality and isolates later ordinals", () => {
    const primary = snapshot();
    const secondary = snapshot();
    for (const parent of [primary, secondary]) {
      // Repeating the healthy tetrahedron leaves its distribution intact but
      // exceeds Surface's bounded map representation exactly.
      const tetrahedron = sierpinskiTetrahedron();
      parent.transforms = Array.from(
        { length: SURFACE_MAX_MAPS + 1 },
        (_, index) => ({
          ...structuredClone(tetrahedron[index % tetrahedron.length]),
          id: index,
        }),
      );
    }
    const unconstrained = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      REQUEST,
    );
    expect(unconstrained.accepted).toBe(true);

    const laterRequest = { ...REQUEST, childOrdinal: 19 };
    const before = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      laterRequest,
    );
    const rejected = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      { ...REQUEST, surfaceRequired: true },
    );
    expect(rejected.accepted).toBe(false);
    if (
      !rejected.accepted &&
      rejected.rejection.reason === "attempts-exhausted"
    ) {
      expect(
        rejected.rejection.attempts.some(
          (failure) => failure.reason === "surface-incompatible",
        ),
      ).toBe(true);
    }
    const after = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      laterRequest,
    );
    expect(after).toEqual(before);
  });

  it("preflights missing custom resources before any candidate attempt", () => {
    const id = `mesh-sha256-${"a".repeat(64)}` as const;
    const primary = snapshot();
    const secondary = snapshot();
    primary.transforms[0].emitter = {
      parts: [
        {
          primitive: { kind: "mesh", meshId: id },
          combine: "union",
        },
      ],
    };
    secondary.transforms[0].emitter = structuredClone(
      primary.transforms[0].emitter,
    );
    const result = createEvolutionCrossoverCandidate(
      { snapshot: primary },
      { snapshot: secondary },
      REQUEST,
      { availableResourceIds: new Set() },
    );
    expect(result).toMatchObject({
      accepted: false,
      rejection: {
        reason: "preflight-refusal",
        refusal: { code: "missing-resource", resourceId: id },
      },
    });
  });
});
