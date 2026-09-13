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
  stack: 12,
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
  accepted: boolean;
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
      discard(pathBound);
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
    accepted: !hasRefusal(refusal) && residualBound <= ERROR_BUDGET,
  };
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
          },
          acceptance:
            "one sample only: finite and cap-free with sum(discarded max-channel radiance bounds) <= errorBudgetPerSample",
          imageAggregation:
            "sample bounds average within a pixel; sums across independent pixels are informational and are not compared with the per-sample budget",
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
