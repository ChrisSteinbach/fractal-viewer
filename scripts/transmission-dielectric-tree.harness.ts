/**
 * Scalar-only work and residual controls for deterministic finite dielectric
 * trees. No image is rendered. D2 is a coarser finite-geometry comparison;
 * D3 full-raster cost remains an estimate until measured on the GPU.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Vec3 } from "./de-preview";
import {
  DIELECTRIC_SOLID_FIXTURES,
  dielectricBeerThroughput,
  dielectricNextBoundary,
  dielectricNextBoundaryFromAnchor,
  dielectricRefract,
  type DielectricBoundaryAnchor,
  type DielectricRefusalReason,
  type DielectricSolidFixture,
} from "./transmission-dielectric-solid";

const ERROR_BUDGET = 1 / 1024;
const ENVIRONMENT_BOUND = 4;
const INITIAL_THETA = ERROR_BUDGET / 64;
const REPLAY_PASSES = 6;
const IOR = 1.45;
const ABSORPTION = [0.17, 0.055, 0.025] as const;
const GEOMETRY_REASON_CODE: Record<DielectricRefusalReason, number> = {
  "visit-cap": 1,
  "state-mismatch": 2,
  "nonmonotone-crossing": 3,
  "degenerate-projected-normal": 4,
  "ambiguous-anchor": 5,
  "invalid-input": 6,
};

interface Limits {
  processed: number;
  interfaces: number;
  stack: number;
}

const CURRENT_LIMITS: Limits = { processed: 128, interfaces: 48, stack: 8 };
const REPLAY_LIMITS: Limits = {
  processed: 4096,
  interfaces: 96,
  stack: 24,
};
const EVIDENCE_LIMITS: Limits = {
  processed: 20_000,
  interfaces: 128,
  stack: 12,
};

interface Path {
  origin: Vec3;
  direction: Vec3;
  energy: Vec3;
  inside: boolean;
  interfaces: number;
  anchor?: DielectricBoundaryAnchor;
}

interface GeometryCounters {
  ddaVisits: number;
  refused: number;
  reasonMask: number;
  reasonCounts: Partial<Record<DielectricRefusalReason, number>>;
  insideMiss: number;
}

interface RefusalCounters {
  processed: number;
  interfaces: number;
  stack: number;
  geometry: GeometryCounters;
}

interface PassResult {
  pass: number;
  theta: number;
  processed: number;
  boundaries: number;
  maxInterfaces: number;
  maxLiveStack: number;
  terminalPaths: number;
  discardedPaths: number;
  residualBound: number;
  residualOverBudget: number;
  refusal: RefusalCounters;
  certifiedResourceOmission: boolean;
  processedTailBound: number | null;
  accepted: boolean;
}

function balancedSplitStackBound(initialBound: number, theta: number) {
  let descendingBound = initialBound;
  let queuedStrongerSiblings = 0;
  let maxLiveStack = 1;
  let strictWeakDescents = 0;
  while (descendingBound / 2 > theta) {
    descendingBound /= 2;
    strictWeakDescents++;
    queuedStrongerSiblings++;
    // The current weak child is on top of all retained stronger siblings.
    maxLiveStack = Math.max(maxLiveStack, queuedStrongerSiblings + 1);
  }
  return {
    initialBound,
    theta,
    ratio: initialBound / theta,
    strictWeakDescents,
    maxLiveStack,
    requiredCapacity: maxLiveStack,
    selectedCapacity: REPLAY_LIMITS.stack,
  };
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return value.map((component) => component / length) as Vec3;
}

function dot(left: Vec3, right: Vec3) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function reflect(direction: Vec3, normal: Vec3): Vec3 {
  const twiceProjection = 2 * dot(direction, normal);
  return normalize(
    direction.map(
      (component, axis) => component - twiceProjection * normal[axis],
    ) as Vec3,
  );
}

function fresnel(cosI: number, fromIor: number, toIor: number) {
  const eta = fromIor / toIor;
  const sinT2 = eta * eta * Math.max(0, 1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  const rs = (fromIor * cosI - toIor * cosT) / (fromIor * cosI + toIor * cosT);
  const rp = (fromIor * cosT - toIor * cosI) / (fromIor * cosT + toIor * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

function radianceBound(energy: Vec3) {
  return ENVIRONMENT_BOUND * Math.max(...energy);
}

function hasRefusal(refusal: RefusalCounters) {
  return (
    refusal.processed > 0 ||
    refusal.interfaces > 0 ||
    refusal.stack > 0 ||
    refusal.geometry.refused > 0 ||
    refusal.geometry.insideMiss > 0
  );
}

function tracePass(
  fixture: DielectricSolidFixture,
  direction: Vec3,
  theta: number,
  limits: Limits,
  pass: number,
  certifyResourceCaps = false,
): PassResult {
  const paths: Path[] = [
    {
      origin: [2.1, 1.4, 3.2],
      direction,
      energy: [1, 1, 1],
      inside: false,
      interfaces: 0,
    },
  ];
  let processed = 0;
  let boundaries = 0;
  let maxInterfaces = 0;
  let maxLiveStack = 1;
  let terminalPaths = 0;
  let discardedPaths = 0;
  let residualBound = 0;
  let processedTailBound: number | null = null;
  const refusal: RefusalCounters = {
    processed: 0,
    interfaces: 0,
    stack: 0,
    geometry: {
      ddaVisits: 0,
      refused: 0,
      reasonMask: 0,
      reasonCounts: {},
      insideMiss: 0,
    },
  };

  const discard = (bound: number) => {
    discardedPaths++;
    residualBound += bound;
  };
  const enqueue = (path: Path) => {
    const bound = radianceBound(path.energy);
    if (bound <= theta) {
      discard(bound);
      return;
    }
    if (paths.length >= limits.stack) {
      refusal.stack++;
      discard(bound);
      return;
    }
    paths.push(path);
    maxLiveStack = Math.max(maxLiveStack, paths.length);
  };

  while (paths.length > 0) {
    const path = paths.pop()!;
    const pathBound = radianceBound(path.energy);
    if (pathBound <= theta) {
      discard(pathBound);
      continue;
    }
    processed++;
    if (processed > limits.processed) {
      refusal.processed++;
      if (certifyResourceCaps) {
        processedTailBound =
          pathBound +
          paths.reduce(
            (sum, pending) => sum + radianceBound(pending.energy),
            0,
          );
        discardedPaths += paths.length + 1;
        residualBound += processedTailBound;
        paths.length = 0;
      } else discard(pathBound);
      continue;
    }
    if (path.interfaces >= limits.interfaces) {
      refusal.interfaces++;
      discard(pathBound);
      continue;
    }
    const boundary = path.anchor
      ? dielectricNextBoundaryFromAnchor(fixture, path.direction, {
          inside: path.inside,
          anchor: path.anchor,
        })
      : dielectricNextBoundary(fixture, path.origin, path.direction, {
          inside: path.inside,
        });
    refusal.geometry.ddaVisits += boundary.visits;
    if (boundary.kind === "refused") {
      refusal.geometry.refused++;
      refusal.geometry.reasonMask |= 1 << GEOMETRY_REASON_CODE[boundary.reason];
      refusal.geometry.reasonCounts[boundary.reason] =
        (refusal.geometry.reasonCounts[boundary.reason] ?? 0) + 1;
      discard(pathBound);
      continue;
    }
    if (boundary.kind === "miss") {
      if (path.inside) {
        refusal.geometry.insideMiss++;
        discard(pathBound);
      } else terminalPaths++;
      continue;
    }
    boundaries++;
    maxInterfaces = Math.max(maxInterfaces, path.interfaces + 1);
    const hit = path.origin.map(
      (component, axis) => component + boundary.t * path.direction[axis],
    ) as Vec3;
    let energy: Vec3 = [...path.energy];
    if (path.inside)
      energy = energy.map(
        (component, channel) =>
          component *
          dielectricBeerThroughput(
            ABSORPTION[channel],
            boundary.t,
            fixture.halfExtent,
          ),
      ) as Vec3;
    const fromIor = path.inside ? IOR : 1;
    const toIor = path.inside ? 1 : IOR;
    const split = fresnel(
      Math.abs(dot(path.direction, boundary.outwardNormal)),
      fromIor,
      toIor,
    );
    const refracted = dielectricRefract(
      path.direction,
      boundary.outwardNormal,
      fromIor,
      toIor,
    );
    const child = (
      childDirection: Vec3,
      childEnergy: Vec3,
      inside: boolean,
    ): Path => ({
      origin: hit,
      direction: childDirection,
      energy: childEnergy,
      inside,
      interfaces: path.interfaces + 1,
      anchor: boundary.anchor,
    });
    if (refracted.tir) {
      enqueue(child(refracted.direction, energy, path.inside));
      continue;
    }
    const transmittedEnergy = energy.map(
      (component) => component * (1 - split),
    ) as Vec3;
    const reflectedEnergy = energy.map(
      (component) => component * split,
    ) as Vec3;
    const transmitted = child(
      refracted.direction,
      transmittedEnergy,
      !path.inside,
    );
    const reflected = child(
      reflect(path.direction, boundary.outwardNormal),
      reflectedEnergy,
      path.inside,
    );
    // Match the GPU DFS: push the stronger path first, so the weaker child is
    // processed from the top of the LIFO stack.
    if (radianceBound(reflectedEnergy) > radianceBound(transmittedEnergy)) {
      enqueue(reflected);
      enqueue(transmitted);
    } else {
      enqueue(transmitted);
      enqueue(reflected);
    }
  }

  const geometryFailed =
    refusal.geometry.refused > 0 || refusal.geometry.insideMiss > 0;
  const resourceOmitted =
    refusal.processed > 0 || refusal.interfaces > 0 || refusal.stack > 0;
  return {
    pass,
    theta,
    processed,
    boundaries,
    maxInterfaces,
    maxLiveStack,
    terminalPaths,
    discardedPaths,
    residualBound,
    residualOverBudget: residualBound / ERROR_BUDGET,
    refusal,
    certifiedResourceOmission: certifyResourceCaps && resourceOmitted,
    processedTailBound,
    accepted:
      !geometryFailed &&
      residualBound <= ERROR_BUDGET &&
      (certifyResourceCaps || !resourceOmitted),
  };
}

function replay(
  fixture: DielectricSolidFixture,
  direction: Vec3,
  limits: Limits,
  certifyResourceCaps: boolean,
) {
  const passes: PassResult[] = [];
  let acceptedPass: number | null = null;
  for (let pass = 0; pass < REPLAY_PASSES; pass++) {
    const result = tracePass(
      fixture,
      direction,
      INITIAL_THETA / 2 ** pass,
      limits,
      pass,
      certifyResourceCaps,
    );
    passes.push(result);
    if (result.accepted) {
      acceptedPass = pass;
      break;
    }
  }
  return { limits, passes, acceptedPass };
}

function cameraRay(ndcX: number, ndcY: number): Vec3 {
  const eye: Vec3 = [2.1, 1.4, 3.2];
  const forward = normalize(eye.map((component) => -component) as Vec3);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanHalf = 0.39;
  return normalize(
    forward.map(
      (component, axis) =>
        component + ndcX * right[axis] * tanHalf + ndcY * up[axis] * tanHalf,
    ) as Vec3,
  );
}

function archivedGpuPrimaryRay(px: number, py: number, sample: number): Vec3 {
  const jitterX = (sample & 1) * 0.5 - 0.25;
  const jitterY = (sample >> 1) * 0.5 - 0.25;
  return cameraRay(
    (2 * (px + 0.5 + jitterX)) / 64 - 1,
    (2 * (py + 0.5 + jitterY)) / 64 - 1,
  );
}

const RAYS = [
  { name: "center", ndc: [0, 0] as const },
  { name: "lower", ndc: [0, -0.24] as const },
];

const CASES = [
  { name: "menger-d2", fixture: DIELECTRIC_SOLID_FIXTURES.mengerD2 },
  { name: "hyper-menger-d2", fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2 },
  { name: "menger-d3", fixture: DIELECTRIC_SOLID_FIXTURES.mengerD3 },
  { name: "hyper-menger-d3", fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD3 },
];

const GUARD_LIMITS = [
  { name: "4096/96", limits: REPLAY_LIMITS },
  {
    name: "16384/256",
    limits: { processed: 16_384, interfaces: 256, stack: 24 },
  },
];

const GPU_WITNESS_RAYS = [
  {
    name: "archived-menger-processed-p47,30-s3",
    fixture: DIELECTRIC_SOLID_FIXTURES.mengerD2,
    pixel: [47, 30] as const,
    sample: 3,
  },
  {
    name: "archived-menger-processed-p22,39-s1",
    fixture: DIELECTRIC_SOLID_FIXTURES.mengerD2,
    pixel: [22, 39] as const,
    sample: 1,
  },
  {
    name: "archived-menger-processed-p37,43-s0",
    fixture: DIELECTRIC_SOLID_FIXTURES.mengerD2,
    pixel: [37, 43] as const,
    sample: 0,
  },
  {
    name: "archived-menger-processed-p51,46-s2",
    fixture: DIELECTRIC_SOLID_FIXTURES.mengerD2,
    pixel: [51, 46] as const,
    sample: 2,
  },
  {
    name: "archived-hyper-interface-p51,28-s2",
    fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2,
    pixel: [51, 28] as const,
    sample: 2,
  },
  {
    name: "archived-hyper-interface-p55,28-s0",
    fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2,
    pixel: [55, 28] as const,
    sample: 0,
  },
  {
    name: "archived-hyper-interface-p46,31-s0",
    fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2,
    pixel: [46, 31] as const,
    sample: 0,
  },
  {
    name: "archived-hyper-interface-p53,32-s3",
    fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2,
    pixel: [53, 32] as const,
    sample: 3,
  },
];

describe("deterministic dielectric tree residual replay", () => {
  it("records bounded D2/D3 work and accepts only a per-sample residual proof", () => {
    const rows = CASES.flatMap(({ name, fixture }) =>
      RAYS.map(({ name: ray, ndc }) => {
        const direction = cameraRay(ndc[0], ndc[1]);
        const baseline = tracePass(
          fixture,
          direction,
          INITIAL_THETA,
          CURRENT_LIMITS,
          0,
        );
        const evidence = tracePass(
          fixture,
          direction,
          INITIAL_THETA,
          EVIDENCE_LIMITS,
          0,
        );
        const passes: PassResult[] = [];
        let acceptedPass: number | null = null;
        for (let pass = 0; pass < REPLAY_PASSES; pass++) {
          const result = tracePass(
            fixture,
            direction,
            INITIAL_THETA / 2 ** pass,
            REPLAY_LIMITS,
            pass,
          );
          passes.push(result);
          if (result.accepted) {
            acceptedPass = pass;
            break;
          }
        }
        return {
          fixture: name,
          dimension: fixture.dimension,
          depth: fixture.depth,
          geometryRole:
            fixture.depth === 2
              ? "coarser finite-geometry comparison"
              : "high-detail estimate only; no full-raster failure claim",
          ray,
          ndc,
          direction,
          baseline,
          evidence,
          passes,
          acceptedPass,
          finalStatus: acceptedPass === null ? "refused" : "accepted",
        };
      }),
    );

    const d2 = rows.filter((row) => row.depth === 2);
    const d3 = rows.filter((row) => row.depth === 3);
    expect(d2.every((row) => row.acceptedPass !== null)).toBe(true);
    expect(d2.some((row) => (row.acceptedPass ?? 0) > 0)).toBe(true);
    expect(d3.some((row) => row.acceptedPass === null)).toBe(true);
    expect(d3.some((row) => row.acceptedPass !== null)).toBe(true);
    expect(
      d3
        .filter((row) => row.acceptedPass === null)
        .every((row) => row.passes.some((pass) => hasRefusal(pass.refusal))),
    ).toBe(true);
    expect(rows.every((row) => row.baseline.refusal.processed > 0)).toBe(true);
    expect(
      rows.every((row) => row.evidence.refusal.geometry.refused === 0),
    ).toBe(true);
    expect(
      rows.every((row) => row.evidence.refusal.geometry.insideMiss === 0),
    ).toBe(true);
    for (const row of d2) {
      const accepted = row.passes[row.acceptedPass!];
      expect(accepted.residualBound).toBeLessThanOrEqual(ERROR_BUDGET);
      expect(hasRefusal(accepted.refusal)).toBe(false);
    }

    const expectedEvidenceProcessed = [
      857, 1185, 239, 275, 13_537, 10_540, 9479, 1471,
    ];
    const expectedEvidenceResidual = [
      0.0014663482603050546, 0.0018329557185108101, 0.00019775692440955226,
      0.0003540786979768428, 0.030823013881296712, 0.022267543780372795,
      0.016996838583071435, 0.0019796347558785274,
    ];
    const expectedAcceptedPass = [1, 2, 0, 0, null, null, null, 3];
    expect(rows.map((row) => row.evidence.processed)).toEqual(
      expectedEvidenceProcessed,
    );
    expect(rows.map((row) => row.acceptedPass)).toEqual(expectedAcceptedPass);
    rows.forEach((row, index) =>
      expect(row.evidence.residualBound).toBeCloseTo(
        expectedEvidenceResidual[index],
        14,
      ),
    );

    const finalTheta = INITIAL_THETA / 2 ** (REPLAY_PASSES - 1);
    const stackProof = balancedSplitStackBound(ENVIRONMENT_BOUND, finalTheta);
    expect(stackProof.ratio).toBe(2 ** 23);
    expect(stackProof.strictWeakDescents).toBe(22);
    expect(stackProof.requiredCapacity).toBe(23);
    expect(REPLAY_LIMITS.stack).toBeGreaterThanOrEqual(
      stackProof.requiredCapacity,
    );

    const guardInputs = [
      ...CASES.filter(({ fixture }) => fixture.depth === 2).flatMap(
        ({ name, fixture }) =>
          RAYS.map(({ name: ray, ndc }) => ({
            name: `${name}-${ray}`,
            fixture,
            direction: cameraRay(ndc[0], ndc[1]),
            source: { kind: "representative", ndc },
          })),
      ),
      ...GPU_WITNESS_RAYS.map(({ name, fixture, pixel, sample }) => ({
        name,
        fixture,
        direction: archivedGpuPrimaryRay(pixel[0], pixel[1], sample),
        source: {
          kind: "archived-gpu-primary-pixel",
          raster: [64, 64],
          pixel,
          sample,
        },
      })),
    ];
    const guardComparisons = guardInputs.map((input) => ({
      name: input.name,
      fixture: input.fixture.name,
      dimension: input.fixture.dimension,
      direction: input.direction,
      source: input.source,
      comparisons: GUARD_LIMITS.map(({ name, limits }) => ({
        name,
        ...replay(input.fixture, input.direction, limits, true),
      })),
    }));
    for (const comparison of guardComparisons)
      for (const result of comparison.comparisons)
        for (const pass of result.passes) {
          if (pass.accepted)
            expect(pass.residualBound).toBeLessThanOrEqual(ERROR_BUDGET);
          expect(pass.refusal.geometry.refused).toBe(0);
          expect(pass.refusal.geometry.insideMiss).toBe(0);
        }
    expect(
      guardComparisons.map((comparison) =>
        comparison.comparisons.map((result) => result.acceptedPass),
      ),
    ).toEqual([
      [1, 1],
      [2, 2],
      [0, 0],
      [0, 0],
      [null, 4],
      [null, 3],
      [null, 3],
      [null, 4],
      [1, 1],
      [0, 0],
      [1, 1],
      [null, 0],
    ]);
    expect(
      guardComparisons
        .flatMap((comparison) => comparison.comparisons)
        .some((result) =>
          result.passes.some(
            (pass) => pass.accepted && pass.refusal.interfaces > 0,
          ),
        ),
    ).toBe(true);
    expect(
      guardComparisons
        .flatMap((comparison) => comparison.comparisons)
        .some((result) =>
          result.passes.some(
            (pass) =>
              pass.refusal.processed > 0 &&
              pass.processedTailBound !== null &&
              !pass.accepted,
          ),
        ),
    ).toBe(true);

    // The budget is per sample. Four qualifying samples average to a
    // qualifying pixel even though summing independent pixels can exceed it.
    const sampleResiduals = [0.9, 0.8, 0.7, 0.6].map(
      (fraction) => fraction * ERROR_BUDGET,
    );
    expect(sampleResiduals.every((value) => value <= ERROR_BUDGET)).toBe(true);
    expect(
      sampleResiduals.reduce((sum, value) => sum + value, 0) /
        sampleResiduals.length,
    ).toBeLessThanOrEqual(ERROR_BUDGET);
    expect(2 * 0.75 * ERROR_BUDGET).toBeGreaterThan(ERROR_BUDGET);

    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-dielectric-tree-report.json",
      JSON.stringify(
        {
          status:
            "D2 REPRESENTATIVE RAYS QUALIFIED FOR RESIDUAL REPLAY; D3 FULL-RASTER UNQUALIFIED BY ESTIMATE",
          constants: {
            errorBudgetPerSample: ERROR_BUDGET,
            environmentRadianceBound: ENVIRONMENT_BOUND,
            initialThetaRadiance: INITIAL_THETA,
            thetaRule: "theta(pass) = initialTheta / 2^pass",
            maximumPasses: REPLAY_PASSES,
            currentLimits: CURRENT_LIMITS,
            replayLimits: REPLAY_LIMITS,
            evidenceLimits: EVIDENCE_LIMITS,
            stackProof: {
              ...stackProof,
              rationale:
                "each retained stronger sibling accompanies descent through a weak child of at most half the parent max-channel bound; equality with theta is pruned before push",
            },
          },
          acceptance:
            "one sample only: finite and cap-free with sum(discarded max-channel radiance bounds) <= errorBudgetPerSample",
          imageAggregation:
            "sample bounds average within a pixel; sums across independent pixels are informational and are not compared with the per-sample budget",
          resourceGuardCertificate:
            "processed guard omits current plus every pending path only after adding their full environment-times-max-channel bounds; interface and stack guards add the omitted path bound; geometry refusal and inside-miss always refuse",
          resourceGuardDecision: {
            recommendation:
              "compare GPU D2 at processed=16384/interfaces=256 with the certificate enabled; the certificate alone cannot qualify the archived processed-limit witnesses",
            blindCap:
              "always unresolved at a resource cap, even when the explicitly summed omitted radiance is already within budget",
            certifiedCap:
              "bounded completion only when accumulated discarded radiance plus every omitted or still-live branch bound is <= the per-sample budget",
            limitation:
              "the environment bound is intentionally loose; a work guard encountered with energetic queued siblings remains unresolved",
          },
          guardComparisons,
          rows,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          fixture: row.fixture,
          ray: row.ray,
          baseline: {
            processed: row.baseline.processed,
            residual: row.baseline.residualBound,
            refusal: row.baseline.refusal,
          },
          evidence: {
            processed: row.evidence.processed,
            maxInterfaces: row.evidence.maxInterfaces,
            maxLiveStack: row.evidence.maxLiveStack,
            residual: row.evidence.residualBound,
          },
          acceptedPass: row.acceptedPass,
          finalStatus: row.finalStatus,
        })),
      ),
    );
  });
});
