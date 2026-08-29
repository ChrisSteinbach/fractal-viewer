import { MIN_OCCUPIED_CELLS } from "../fractal/random-system";
import { sierpinskiTetrahedron } from "../fractal/presets";
import { SEEDED_MUTATION_ALGORITHM_VERSION } from "../fractal/mutate-system";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import { initialState } from "./state";
import { toSnapshot, type SceneSnapshot } from "./persist";
import {
  EVOLUTION_CANDIDATE_QUALITY_PROBES,
  createEvolutionMutationCandidate,
  ownEvolutionSceneSnapshot,
  type EvolutionMutationCandidate,
  type EvolutionMutationCandidateResult,
} from "./evolution-candidate";
import { evaluateEvolutionSurfaceAdmission } from "./evolution-surface-constraint";

const REQUEST = {
  algorithmVersion: SEEDED_MUTATION_ALGORITHM_VERSION,
  nodeSeed: 0x51a7cafe,
  childOrdinal: 3,
  profile: {
    wildcard: true,
    lockedDomains: ["appearance" as const],
  },
} as const;

function scheduledParent(): SceneSnapshot {
  const snapshot = toSnapshot(initialState(false));
  snapshot.transforms = sierpinskiTetrahedron();
  snapshot.symmetry = { order: 1, plane: "xz" };
  snapshot.schedule = {
    depth: 1,
    transforms: sierpinskiTetrahedron().map((transform) => ({
      id: transform.id,
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [0.43, 0.43, 0.43],
    })),
  };
  snapshot.condensationDepthBand = { minDepth: 1, maxDepth: 4 };
  snapshot.shapeTrap = {
    shape: {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.4 },
          combine: "union",
        },
      ],
    },
    position: [0.1, -0.2, 0.3],
    mode: "threshold",
    threshold: 0.25,
  };
  snapshot.camera = {
    target: [0.2, -0.1, 0.3],
    radius: 8,
    theta: 0.4,
    phi: 1.2,
  };
  snapshot.fourD = {
    pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
    sliceOn: true,
    sliceCenter: 0.15,
    sliceThickness: 0.2,
    sliceRelColor: true,
  };
  snapshot.colorGamma = 1.7;
  snapshot.glowBrightness = 2.25;
  snapshot.background = {
    ...snapshot.background,
    mode: "custom",
    custom: {
      top: [0.07, 0.13, 0.2],
      bottom: [0.27, 0.33, 0.4],
    },
  };
  delete snapshot.finalTransform;
  return snapshot;
}

function accepted(
  result: EvolutionMutationCandidateResult,
): EvolutionMutationCandidate {
  expect(result.accepted).toBe(true);
  if (!result.accepted) {
    throw new Error(
      `unexpected rejection: ${result.rejection.quality.minimum}`,
    );
  }
  return result.candidate;
}

function withoutKernelFields(snapshot: SceneSnapshot): object {
  const {
    transforms: _transforms,
    finalTransform: _finalTransform,
    symmetry: _symmetry,
    ...carried
  } = snapshot;
  return carried;
}

describe("Evolution exact-document mutation candidates", () => {
  it("owns and deeply freezes the full candidate while carrying non-kernel document fields", () => {
    const parent = scheduledParent();
    const before = structuredClone(parent);
    const candidate = accepted(
      createEvolutionMutationCandidate(parent, REQUEST),
    );

    expect(candidate.snapshot.transforms).not.toEqual(parent.transforms);
    expect(
      withoutKernelFields(candidate.snapshot as unknown as SceneSnapshot),
    ).toEqual(withoutKernelFields(before));
    expect("finalTransform" in candidate.snapshot).toBe(false);
    expect(candidate.quality.scores).toHaveLength(
      EVOLUTION_CANDIDATE_QUALITY_PROBES,
    );
    expect(candidate.quality.minimum).toBeGreaterThanOrEqual(
      MIN_OCCUPIED_CELLS,
    );

    expect(Object.isFrozen(candidate.snapshot)).toBe(true);
    expect(Object.isFrozen(candidate.snapshot.transforms)).toBe(true);
    expect(Object.isFrozen(candidate.snapshot.transforms[0].position)).toBe(
      true,
    );
    expect(Object.isFrozen(candidate.snapshot.schedule)).toBe(true);
    expect(Object.isFrozen(candidate.snapshot.schedule?.transforms[0])).toBe(
      true,
    );
    expect(Object.isFrozen(candidate.snapshot.camera?.target)).toBe(true);
    expect(Object.isFrozen(candidate.snapshot.fourD?.pair.p)).toBe(true);

    parent.schedule!.depth = 4;
    parent.camera!.target[0] = 999;
    parent.fourD!.pair.p[0] = 0;
    parent.shapeTrap!.position![0] = 999;
    expect(candidate.snapshot.schedule?.depth).toBe(1);
    expect(candidate.snapshot.camera?.target[0]).toBe(0.2);
    expect(candidate.snapshot.fourD?.pair.p[0]).toBe(1);
    expect(candidate.snapshot.shapeTrap?.position?.[0]).toBe(0.1);
  });

  it("returns a structured two-probe rejection and no candidate below threshold", () => {
    const parent = scheduledParent();
    parent.transforms = [];
    delete parent.schedule;
    const result = createEvolutionMutationCandidate(parent, REQUEST);
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejection).toMatchObject({
      reason: "quality-below-threshold",
      nodeSeed: REQUEST.nodeSeed,
      childOrdinal: REQUEST.childOrdinal,
      algorithmVersion: SEEDED_MUTATION_ALGORITHM_VERSION,
      quality: {
        threshold: MIN_OCCUPIED_CELLS,
      },
    });
    expect(result.rejection.quality.scores).toHaveLength(2);
    expect(result.rejection.quality.minimum).toBeLessThan(MIN_OCCUPIED_CELLS);
    expect("candidate" in result).toBe(false);
  });

  it("isolates child ordinals from rejected sibling generation", () => {
    const parent = scheduledParent();
    const nextRequest = { ...REQUEST, childOrdinal: 4 };
    const before = createEvolutionMutationCandidate(parent, nextRequest);

    const invalid = scheduledParent();
    invalid.transforms = [];
    delete invalid.schedule;
    expect(createEvolutionMutationCandidate(invalid, REQUEST).accepted).toBe(
      false,
    );

    const after = createEvolutionMutationCandidate(parent, nextRequest);
    expect(after).toEqual(before);
    expect(
      accepted(createEvolutionMutationCandidate(parent, REQUEST)).snapshot,
    ).not.toEqual(accepted(after).snapshot);
  });

  it("does not perturb a later child stream when Surface admission rejects a sibling", () => {
    const parent = scheduledParent();
    const laterRequest = { ...REQUEST, childOrdinal: 11 };
    const before = createEvolutionMutationCandidate(parent, laterRequest);

    const refusal = evaluateEvolutionSurfaceAdmission(
      {
        transforms: [
          {
            id: 1,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            variations: [{ type: "qsquare", weight: 1 }],
          },
        ],
        symmetry: { order: 1, plane: "xy" },
      },
      true,
    );
    expect(refusal.admitted).toBe(false);

    const after = createEvolutionMutationCandidate(parent, laterRequest);
    expect(after).toEqual(before);
  });

  it("includes the carried effective schedule in strict quality scoring", () => {
    const scheduled = scheduledParent();
    const classic = structuredClone(scheduled);
    delete classic.schedule;
    const scheduledCandidate = accepted(
      createEvolutionMutationCandidate(scheduled, REQUEST),
    );
    const classicCandidate = accepted(
      createEvolutionMutationCandidate(classic, REQUEST),
    );
    expect(scheduledCandidate.snapshot.transforms).toEqual(
      classicCandidate.snapshot.transforms,
    );
    expect(scheduledCandidate.quality.scores).not.toEqual(
      classicCandidate.quality.scores,
    );
  });

  it("returns sorted custom-mesh resource ids without changing the carried trap", () => {
    const a: CustomMeshAssetId = `mesh-sha256-${"a".repeat(64)}`;
    const b: CustomMeshAssetId = `mesh-sha256-${"b".repeat(64)}`;
    const parent = scheduledParent();
    parent.shapeTrap = {
      shape: {
        parts: [
          { primitive: { kind: "mesh", meshId: b }, combine: "union" },
          { primitive: { kind: "mesh", meshId: a }, combine: "union" },
          { primitive: { kind: "mesh", meshId: b }, combine: "union" },
        ],
      },
      position: [0.1, 0.2, 0.3],
    };
    const candidate = accepted(
      createEvolutionMutationCandidate(parent, REQUEST),
    );
    expect(candidate.resourceIds).toEqual([a, b]);
    expect(Object.isFrozen(candidate.resourceIds)).toBe(true);
    expect(candidate.snapshot.shapeTrap).toEqual(parent.shapeTrap);
    expect(candidate.snapshot.shapeTrap).not.toBe(parent.shapeTrap);
  });

  it("uses the same defensive ownership boundary for lineage roots", () => {
    const source = scheduledParent();
    const owned = ownEvolutionSceneSnapshot(source);
    source.transforms[0].position[0] = 99;
    source.surface.lightAzimuth = 99;
    expect(owned.transforms[0].position[0]).not.toBe(99);
    expect(owned.surface.lightAzimuth).not.toBe(99);
    expect(Object.isFrozen(owned.surface)).toBe(true);
  });
});
