import { systemPartsAreNonFlat } from "../fractal/affine4";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import { sierpinskiTetrahedron } from "../fractal/presets";
import type { Transform } from "../fractal/types";
import { initialState } from "./state";
import { toSnapshot, type SceneSnapshot } from "./persist";
import {
  CROSSOVER_ALGORITHM_VERSION,
  createEvolutionCrossoverAttempt,
  deriveCrossoverSeed32,
  evolutionSceneContentDigest,
  prepareEvolutionCrossover,
  rebuildCrossoverChaos,
  type EvolutionCrossoverAttempt,
  type EvolutionCrossoverParentInput,
  type EvolutionTopologyV1,
} from "./evolution-crossover";

function snapshot(): SceneSnapshot {
  const result = toSnapshot(initialState(false));
  result.transforms = sierpinskiTetrahedron();
  result.symmetry = { order: 1, plane: "xz" };
  delete result.finalTransform;
  delete result.schedule;
  delete result.condensationDepthBand;
  delete result.shapeTrap;
  delete result.camera;
  delete result.fourD;
  return result;
}

function topology(
  token: string,
  slotKeys: readonly string[],
): EvolutionTopologyV1 {
  return { version: 1, token, slotKeys };
}

function prepared(
  primary: EvolutionCrossoverParentInput,
  secondary: EvolutionCrossoverParentInput,
) {
  const result = prepareEvolutionCrossover(primary, secondary);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.refusal.detail);
  return result.prepared;
}

function attempt(
  plan: ReturnType<typeof prepared>,
  nodeSeed: number,
  attemptIndex = 0,
): EvolutionCrossoverAttempt {
  const result = createEvolutionCrossoverAttempt(plan, {
    algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
    nodeSeed,
    childOrdinal: 7,
    attempt: attemptIndex,
  });
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.refusal.detail);
  return result.attempt;
}

function sphereEmitter(radius: number) {
  return {
    parts: [
      {
        primitive: { kind: "sphere" as const, radius },
        combine: "union" as const,
      },
    ],
  };
}

function customEmitter(id: CustomMeshAssetId) {
  return {
    parts: [
      {
        primitive: { kind: "mesh" as const, meshId: id },
        combine: "union" as const,
      },
    ],
  };
}

describe("crossover-v1 exact content identity", () => {
  it("has a golden SHA-256 semantic digest and ignores only transform ids", () => {
    const first = snapshot();
    first.transforms[0].position[0] = -0;
    const digest = evolutionSceneContentDigest(first);
    expect(digest).toBe(
      "scene-sha256-85ed00889cd99016e836d49cf8ddfd431d38e4ec0c3980be33bd554b3dcd8ae7",
    );

    const reidentified = structuredClone(first);
    reidentified.transforms.forEach((transform, index) => {
      transform.id = 900 + index;
    });
    expect(evolutionSceneContentDigest(reidentified)).toBe(digest);

    const localIds = structuredClone(first);
    localIds.finalTransform = {
      id: 40,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    localIds.schedule = {
      depth: 1,
      transforms: [
        {
          id: 41,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const differentLocalIds = structuredClone(localIds);
    differentLocalIds.finalTransform!.id = 401;
    differentLocalIds.schedule!.transforms[0].id = 402;
    expect(evolutionSceneContentDigest(differentLocalIds)).toBe(
      evolutionSceneContentDigest(localIds),
    );

    const positiveZero = structuredClone(first);
    positiveZero.transforms[0].position[0] = 0;
    expect(evolutionSceneContentDigest(positiveZero)).not.toBe(digest);

    const explicitAbsence = structuredClone(first);
    explicitAbsence.camera = undefined;
    expect(evolutionSceneContentDigest(explicitAbsence)).not.toBe(digest);
  });

  it("pins the independent stream derivation with a golden vector", () => {
    expect(
      deriveCrossoverSeed32([
        "crossover-v1",
        "primary",
        "secondary",
        0x51a7cafe,
        3,
        2,
        "geometry",
        "slot:0",
      ]),
    ).toBe(3898342118);
  });

  it("rejects nonfinite exact data before hashing", () => {
    const parent = snapshot();
    parent.transforms[0].scale[0] = Number.NaN;
    expect(() => evolutionSceneContentDigest(parent)).toThrow(/finite/);
  });

  it("rejects negative-zero ordinals before streams and topology can disagree", () => {
    const plan = prepared({ snapshot: snapshot() }, { snapshot: snapshot() });
    expect(
      createEvolutionCrossoverAttempt(plan, {
        algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
        nodeSeed: 1,
        childOrdinal: -0,
        attempt: 0,
      }),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "invalid-coordinates" },
    });
  });
});

describe("crossover-v1 pairing and xaos", () => {
  it("pairs related parents by topology key, ignoring document order and ids", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.transforms = primary.transforms.slice(0, 3);
    secondary.transforms = [
      structuredClone(primary.transforms[1]),
      structuredClone(primary.transforms[2]),
      structuredClone(primary.transforms[0]),
    ];
    secondary.transforms.forEach((transform) => {
      transform.id = 42;
    });
    // Valid snapshots still require distinct document-local ids; equal ids
    // across parents are deliberately harmless.
    secondary.transforms.forEach((transform, index) => (transform.id = index));
    const plan = prepared(
      { snapshot: primary, topology: topology("family", ["a", "b", "c"]) },
      { snapshot: secondary, topology: topology("family", ["b", "c", "a"]) },
    );
    expect(plan.pairing).toEqual({
      kind: "related-slot-v1",
      secondaryIndexByChildSlot: [2, 0, 1],
    });
  });

  it("pairs unrelated ordinary and emitter roles in stable role order", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.transforms = primary.transforms.slice(0, 3);
    secondary.transforms = secondary.transforms.slice(0, 3);
    primary.transforms[1].emitter = sphereEmitter(0.2);
    secondary.transforms[0].emitter = sphereEmitter(0.7);
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    expect(plan.pairing).toEqual({
      kind: "unrelated-role-order-v1",
      secondaryIndexByChildSlot: [1, 0, 2],
    });
  });

  it("rejects incompatible counts, roles, and related certificates structurally", () => {
    const primary = snapshot();
    const shorter = snapshot();
    shorter.transforms.pop();
    expect(
      prepareEvolutionCrossover({ snapshot: primary }, { snapshot: shorter }),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "transform-count-mismatch" },
    });

    const roleMismatch = snapshot();
    roleMismatch.transforms[0].emitter = sphereEmitter(0.3);
    expect(
      prepareEvolutionCrossover(
        { snapshot: primary },
        { snapshot: roleMismatch },
      ),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "emitter-count-mismatch" },
    });

    const keys = primary.transforms.map((_, index) => `k${index}`);
    const badKeys = [...keys];
    badKeys[badKeys.length - 1] = "foreign";
    expect(
      prepareEvolutionCrossover(
        { snapshot: primary, topology: topology("same", keys) },
        { snapshot: snapshot(), topology: topology("same", badKeys) },
      ),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "invalid-related-topology" },
    });

    const relatedEmitter = snapshot();
    relatedEmitter.transforms[0].emitter = sphereEmitter(0.25);
    expect(
      prepareEvolutionCrossover(
        { snapshot: primary, topology: topology("roles", keys) },
        { snapshot: relatedEmitter, topology: topology("roles", keys) },
      ),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "emitter-role-mismatch" },
    });

    const relatedShort = snapshot();
    relatedShort.transforms = relatedShort.transforms.slice(0, 2);
    const relatedLong = snapshot();
    relatedLong.transforms = relatedLong.transforms.slice(0, 3);
    expect(
      prepareEvolutionCrossover(
        {
          snapshot: relatedShort,
          topology: topology("asymmetric", ["a", "b"]),
        },
        {
          snapshot: relatedLong,
          topology: topology("asymmetric", ["a", "b", "c"]),
        },
      ),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "invalid-related-topology" },
    });
  });

  it("remaps both xaos axes using the accepted unrelated worked example", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        chaos: [1, 0, 0.5],
      },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        chaos: [0.2, 1, 0],
      },
      {
        id: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        chaos: [0, 0.7, 1],
      },
    ];
    expect(rebuildCrossoverChaos(transforms, [1, 0, 2])).toEqual([
      [1, 0.2, 0],
      [0, 1, 0.5],
      [0.7, 0, 1],
    ]);
  });

  it("densifies sparse xaos, omits identities, and preserves exact zero", () => {
    const transforms: Transform[] = [
      { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        chaos: [1, 0],
      },
    ];
    expect(rebuildCrossoverChaos(transforms, [0, 1])).toEqual([
      undefined,
      [1, 0],
    ]);
    transforms[1].chaos = [1];
    expect(rebuildCrossoverChaos(transforms, [0, 1])).toEqual([
      undefined,
      undefined,
    ]);
    expect(() => rebuildCrossoverChaos(transforms, [0, 0])).toThrow(
      /permutation/,
    );
    transforms[1].chaos = [-1];
    expect(rebuildCrossoverChaos(transforms, [0, 1])).toEqual([
      undefined,
      [-1, 1],
    ]);
  });
});

describe("crossover-v1 field policy", () => {
  it("is deterministic, owns inputs, assigns canonical ids, and carries primary presentation", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.colorGamma = 1.23456789;
    primary.camera = {
      target: [0.1, 0.2, 0.3],
      radius: 8,
      theta: 0.4,
      phi: 1.1,
    };
    secondary.colorGamma = 4.75;
    secondary.camera = { target: [9, 9, 9], radius: 2, theta: 1, phi: 1 };
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    primary.colorGamma = 7;
    primary.camera.target[0] = 77;
    primary.transforms[0].position[0] = 77;
    const first = attempt(plan, 123);
    const second = attempt(plan, 123);
    expect(first).toEqual(second);
    expect(first.snapshot.colorGamma).toBe(1.23456789);
    expect(first.snapshot.camera).toEqual({
      target: [0.1, 0.2, 0.3],
      radius: 8,
      theta: 0.4,
      phi: 1.1,
    });
    expect(first.snapshot.camera).not.toBe(primary.camera);
    expect(first.snapshot.transforms.map((transform) => transform.id)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot.transforms[0].position)).toBe(true);

    expect(first.snapshot.camera?.target[0]).toBe(0.1);
    expect(first.snapshot.transforms[0].position[0]).not.toBe(77);
  });

  it("selects each transform policy block atomically and preserves sparse absence", () => {
    const primary = snapshot();
    const secondary = snapshot();
    const p = primary.transforms[0];
    const s = secondary.transforms[0];
    p.position = [1, 2, 3];
    p.rotation = [0.1, 0.2, 0.3];
    p.scale = [0.4, 0.5, 0.6];
    p.shear = [0.01, 0.02, 0.03];
    p.variations = [
      {
        type: "mandelbox",
        weight: 0.5,
        minRadius: 0.2,
        fixedRadius: 0.8,
        boxLimit: 1.1,
      },
    ];
    p.w = { position: 0.4, rotation: { xw: 0.3 }, shear: { yw: 0.1 } };
    p.weight = 7;
    p.colorIndex = 0.2;
    p.colorSpeed = 0.3;
    p.finish = { metalness: 0.8, reflect: 0.4 };
    p.surfacePattern = { kind: "wood", axis: "x", scale: 2, strength: 0.5 };
    p.emitter = sphereEmitter(0.2);

    s.position = [-1, -2, -3];
    s.rotation = [-0.1, -0.2, -0.3];
    s.scale = [0.7, 0.8, 0.9];
    delete s.shear;
    s.variations = [{ type: "swirl", weight: 0.9 }];
    delete s.w;
    delete s.weight;
    s.colorIndex = 0.8;
    s.colorSpeed = 0.9;
    s.finish = { transmit: 0.6 };
    s.surfacePattern = { kind: "marble", axis: "z", scale: 3, strength: 0.2 };
    s.emitter = sphereEmitter(0.7);

    // Keep emitter roles aligned in every paired slot.
    for (let index = 1; index < primary.transforms.length; index += 1) {
      primary.transforms[index].emitter = sphereEmitter(0.2 + index);
      secondary.transforms[index].emitter = sphereEmitter(0.7 + index);
    }
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    let sawSparseW = false;
    let sawMixedBlocks = false;
    for (let seed = 0; seed < 64; seed += 1) {
      const child = attempt(plan, seed).snapshot.transforms[0];
      const geometry = [
        child.position,
        child.rotation,
        child.scale,
        child.shear,
      ];
      expect([
        [p.position, p.rotation, p.scale, p.shear],
        [s.position, s.rotation, s.scale, s.shear],
      ]).toContainEqual(geometry);
      expect([p.variations, s.variations]).toContainEqual(child.variations);
      expect([p.w, s.w]).toContainEqual(child.w);
      expect([p.weight, s.weight]).toContainEqual(child.weight);
      expect([
        [p.colorIndex, p.colorSpeed, p.finish, p.surfacePattern],
        [s.colorIndex, s.colorSpeed, s.finish, s.surfacePattern],
      ]).toContainEqual([
        child.colorIndex,
        child.colorSpeed,
        child.finish,
        child.surfacePattern,
      ]);
      expect([p.emitter, s.emitter]).toContainEqual(child.emitter);
      sawSparseW ||= !("w" in child);
      const fromPrimaryGeometry = child.position[0] === 1;
      sawMixedBlocks ||= fromPrimaryGeometry !== (child.colorIndex === 0.2);
    }
    expect(sawSparseW).toBe(true);
    expect(sawMixedBlocks).toBe(true);
  });

  it("takes globals whole, resets local ids, and never carries morph-only symmetry blend", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.finalTransform = {
      id: 88,
      position: [0.1, 0.2, 0.3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      chaos: [0, 1],
      emitter: sphereEmitter(0.2),
    };
    primary.schedule = {
      depth: 2,
      transforms: primary.transforms.slice(0, 2).map((transform, index) => ({
        id: 70 + index,
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
        weight: index + 2,
      })),
    };
    primary.condensationDepthBand = { minDepth: 2, maxDepth: 5 };
    primary.shapeTrap = {
      shape: sphereEmitter(0.4),
      geometry: true,
      geometryLevelMin: 2,
      geometryLevelMax: 6,
    };
    primary.symmetry = { order: 3, plane: "xy", twist: 1 };
    secondary.finalTransform = {
      id: 99,
      position: [-0.1, -0.2, -0.3],
      rotation: [1, 1, 1],
      scale: [0.8, 0.8, 0.8],
      variations: [{ type: "bubble", weight: 0.8 }],
    };
    secondary.schedule = {
      depth: 1,
      transforms: secondary.transforms.slice(0, 3).map((transform, index) => ({
        id: 90 + index,
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
      })),
    };
    secondary.condensationDepthBand = { minDepth: 0, maxDepth: 1 };
    secondary.shapeTrap = {
      shape: sphereEmitter(0.9),
      mode: "threshold",
      threshold: 0.2,
    };
    secondary.symmetry = { order: 5, plane: "yz" };
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    for (let seed = 0; seed < 32; seed += 1) {
      const child = attempt(plan, seed).snapshot;
      expect([primary.finalTransform, secondary.finalTransform]).toContainEqual(
        {
          ...child.finalTransform,
          id: child.finalTransform
            ? child.finalTransform.position[0] > 0
              ? 88
              : 99
            : 0,
        },
      );
      expect(child.finalTransform?.id).toBe(0);
      expect([primary.schedule?.depth, secondary.schedule?.depth]).toContain(
        child.schedule?.depth,
      );
      expect(
        child.schedule?.transforms.map((transform) => transform.id),
      ).toEqual(child.schedule?.transforms.map((_, index) => index));
      expect([
        primary.condensationDepthBand,
        secondary.condensationDepthBand,
      ]).toContainEqual(child.condensationDepthBand);
      expect([primary.shapeTrap, secondary.shapeTrap]).toContainEqual(
        child.shapeTrap,
      );
      expect([primary.symmetry, secondary.symmetry]).toContainEqual(
        child.symmetry,
      );
      expect("blend" in child.symmetry).toBe(false);
    }
  });

  it("preserves absent versus explicitly-undefined optional global blocks", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.finalTransform = undefined;
    primary.schedule = undefined;
    delete secondary.finalTransform;
    delete secondary.schedule;
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    let finalPresent = false;
    let finalAbsent = false;
    let schedulePresent = false;
    let scheduleAbsent = false;
    for (let seed = 0; seed < 64; seed += 1) {
      const child = attempt(plan, seed).snapshot;
      finalPresent ||= Object.hasOwn(child, "finalTransform");
      finalAbsent ||= !Object.hasOwn(child, "finalTransform");
      schedulePresent ||= Object.hasOwn(child, "schedule");
      scheduleAbsent ||= !Object.hasOwn(child, "schedule");
    }
    expect({
      finalPresent,
      finalAbsent,
      schedulePresent,
      scheduleAbsent,
    }).toEqual({
      finalPresent: true,
      finalAbsent: true,
      schedulePresent: true,
      scheduleAbsent: true,
    });
  });

  it("derives flat/4D state without synthesizing structure and applies pose fallback", () => {
    const primary = snapshot();
    const secondary = snapshot();
    secondary.transforms[0].w = { position: 0.5, rotation: { xw: 0.2 } };
    secondary.fourD = {
      pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
      sliceOn: true,
      sliceCenter: 0.2,
      sliceThickness: 0.3,
      sliceRelColor: true,
    };
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    let flat: EvolutionCrossoverAttempt | undefined;
    let nonFlat: EvolutionCrossoverAttempt | undefined;
    for (let seed = 0; seed < 256 && (!flat || !nonFlat); seed += 1) {
      const child = attempt(plan, seed);
      const isNonFlat = systemPartsAreNonFlat(
        child.snapshot.transforms as Transform[],
        (child.snapshot.finalTransform as Transform | undefined) ?? null,
        child.snapshot.symmetry,
      );
      if (isNonFlat) nonFlat = child;
      else flat = child;
    }
    expect(flat).toBeDefined();
    expect(nonFlat).toBeDefined();
    expect(flat?.snapshot.fourD).toBeUndefined();
    expect(nonFlat?.snapshot.fourD).toEqual(secondary.fourD);
    expect(nonFlat?.snapshot.fourD).not.toBe(secondary.fourD);
  });

  it("allows two non-flat parents to produce a flat child and drops an inert pose", () => {
    const primary = snapshot();
    const secondary = snapshot();
    primary.transforms[0].w = { position: 0.4 };
    secondary.transforms[1].w = { rotation: { yw: 0.3 } };
    const pose = {
      pair: {
        p: [1, 0, 0, 0] as [number, number, number, number],
        q: [1, 0, 0, 0] as [number, number, number, number],
      },
      sliceOn: false,
      sliceCenter: 0,
      sliceThickness: 0.2,
      sliceRelColor: false,
    };
    primary.fourD = structuredClone(pose);
    secondary.fourD = structuredClone(pose);
    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    let flat: EvolutionCrossoverAttempt | undefined;
    for (let seed = 0; seed < 256 && !flat; seed += 1) {
      const child = attempt(plan, seed);
      if (
        !systemPartsAreNonFlat(
          child.snapshot.transforms as Transform[],
          (child.snapshot.finalTransform as Transform | undefined) ?? null,
          child.snapshot.symmetry,
        )
      ) {
        flat = child;
      }
    }
    expect(flat).toBeDefined();
    expect(
      flat?.snapshot.transforms.every((transform) => transform.w === undefined),
    ).toBe(true);
    expect(flat?.snapshot.fourD).toBeUndefined();
  });

  it("returns sorted resources, refuses missing parents, and rejects a five-mesh child", () => {
    const ids: CustomMeshAssetId[] = Array.from(
      { length: 8 },
      (_, index): CustomMeshAssetId =>
        `mesh-sha256-${String(index).repeat(64)}`,
    );
    const primary = snapshot();
    const secondary = snapshot();
    primary.transforms.forEach((transform, index) => {
      transform.emitter = customEmitter(ids[index]);
      secondary.transforms[index].emitter = customEmitter(ids[index + 4]);
    });
    primary.shapeTrap = { shape: customEmitter(ids[0]) };
    secondary.shapeTrap = { shape: customEmitter(ids[4]) };
    expect(
      prepareEvolutionCrossover(
        { snapshot: primary },
        { snapshot: secondary },
        { availableResourceIds: new Set([ids[0]]) },
      ),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "missing-resource" },
    });

    const plan = prepared({ snapshot: primary }, { snapshot: secondary });
    let budgetRefusal = false;
    for (let seed = 0; seed < 256; seed += 1) {
      const result = createEvolutionCrossoverAttempt(plan, {
        algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
        nodeSeed: seed,
        childOrdinal: 0,
        attempt: 0,
      });
      if (
        !result.accepted &&
        result.refusal.code === "child-resource-budget-exceeded"
      ) {
        budgetRefusal = true;
        break;
      }
      if (result.accepted) {
        expect(result.attempt.resourceIds).toEqual(
          [...result.attempt.resourceIds].sort(),
        );
      }
    }
    expect(budgetRefusal).toBe(true);
  });
});
