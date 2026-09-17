import {
  transportBoundaryQueryCPU,
  transportShadowCorridorGate,
  transportShadowVisibilityCPU,
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  type TransportFixtureSystem,
} from "./surface-transport-fixture";
import {
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_INITIAL_BRANCH_THETA,
  type DielectricMaterial,
} from "../../fractal/surface-dielectric";
import {
  SHAPE_MARCH_SAFETY,
  shapeSdf,
  type ShapeSpec,
} from "../../fractal/shapes";
import type { Vec3 } from "../../fractal/types";

/**
 * The closed-solid boundary query's traversal laws, pinned against exact
 * analytic solids. The field adapter is the production shape vocabulary's
 * own form — the SAFETY-scaled signed `shapeSdf` — so every distance the
 * query reads is the exact Euclidean distance the composed condensation
 * union field certifies. The estimator-march contrast pins the anchored
 * suppression arithmetic that makes the UNSIGNED query crawl inside a
 * signed field (the renderer envelope's structural finding, in miniature).
 */

const BOX: ShapeSpec = {
  parts: [
    { primitive: { kind: "box", half: [0.5, 0.5, 0.5] }, combine: "union" },
  ],
};

const BOX_UNION: ShapeSpec = {
  parts: [
    { primitive: { kind: "box", half: [0.5, 0.5, 0.5] }, combine: "union" },
    {
      primitive: { kind: "box", half: [0.5, 0.5, 0.5] },
      combine: "union",
      pose: { offset: [0.9, 0, 0] },
    },
  ],
};

const signedField =
  (spec: ShapeSpec) =>
  (p: Vec3): number =>
    SHAPE_MARCH_SAFETY * shapeSdf(spec, p[0], p[1], p[2]);

function solidSystem(spec: ShapeSpec): TransportFixtureSystem {
  return { estimate: signedField(spec), stepScale: 1, visibleRadius: 2 };
}

const MATERIAL: DielectricMaterial = {
  ior: 1.45,
  absorption: [0.17, 0.055, 0.025],
  radius: 1,
};

const EPS = DIELECTRIC_CROSSING_EPS_REL * 1;

describe("transportSolidBoundaryQueryCPU", () => {
  it("finds an outside entry crossing at the wall with an outward normal", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX),
      [-2, 0, 0],
      [1, 0, 0],
      false,
      [0, 0, 0],
      false,
      EPS,
    );
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(1.5, 2);
    expect(hit.normal[0]).toBeLessThan(-0.99);
    expect(Math.hypot(...hit.normal)).toBeCloseTo(1, 9);
  });

  it("traverses an interior and reports the exit wall", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX),
      [0, 0, 0],
      [1, 0, 0],
      false,
      [0, 0, 0],
      true,
      EPS,
    );
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.normal[0]).toBeGreaterThan(0.99);
  });

  it("suppresses the anchored entry face and reports only the exit", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX),
      [-0.5, 0, 0],
      [1, 0, 0],
      true,
      [-0.5, 0, 0],
      true,
      EPS,
    );
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(1 - 2 * EPS, 2);
    expect(hit.normal[0]).toBeGreaterThan(0.99);
  });

  it("keeps an anchored child just inside the envelope off the mismatch refusal", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX),
      [-0.5, 0, 0],
      [1, 0, 0],
      true,
      [-0.5, 0, 0],
      false,
      EPS,
    );
    expect(hit.kind).toBe("boundary");
  });

  it("refuses state-mismatch when the caller's medium contradicts the field", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX),
      [0, 0, 0],
      [1, 0, 0],
      true,
      [0, 0, 0],
      false,
      EPS,
    );
    expect(hit).toEqual({
      kind: "refused",
      reason: 3,
      t: 2 * EPS,
      normal: [0, 0, 0],
    });
  });

  it("exits a union through the merged interval's end, not the first part's wall", () => {
    const hit = transportSolidBoundaryQueryCPU(
      solidSystem(BOX_UNION),
      [0.45, 0, 0],
      [1, 0, 0],
      false,
      [0, 0, 0],
      true,
      EPS,
    );
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(0.95, 2);
    expect(hit.normal[0]).toBeGreaterThan(0.99);
  });
});

describe("the estimator query's signed-field crawl", () => {
  it("reports a boundary 6·eps past the anchor after exhausting the suppression envelope", () => {
    const hit = transportBoundaryQueryCPU(
      solidSystem(BOX),
      [-0.5, 0, 0],
      [1, 0, 0],
      true,
      [-0.5, 0, 0],
      EPS,
    );
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(6 * EPS, 12);
  });
});

describe("transportTraceCPU over the closed-solid query", () => {
  it("resolves a normal-incidence glass trace end to end", () => {
    const system = solidSystem(BOX);
    const result = transportTraceCPU(
      system,
      [-0.5, 0, 0],
      [1, 0, 0],
      DIELECTRIC_INITIAL_BRANCH_THETA,
      MATERIAL,
      [0, 0, 0],
      undefined,
      (origin, dir, anchorPresent, anchorPoint, inside, eps) =>
        transportSolidBoundaryQueryCPU(
          system,
          origin,
          dir,
          anchorPresent,
          anchorPoint,
          inside,
          eps,
        ),
    );
    expect(["complete", "residual"]).toContain(result.status);
    expect(result.failure).toBe(0);
    expect(result.radiance).toEqual([0, 0, 0]);
  });
});

describe("transportShadowVisibilityCPU — the corridor's straight visibility", () => {
  const SPHERE: ShapeSpec = {
    parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
  };
  const system: TransportFixtureSystem = {
    estimate: (p: Vec3) =>
      SHAPE_MARCH_SAFETY * shapeSdf(SPHERE, p[0], p[1], p[2]),
    stepScale: 1,
    visibleRadius: 2,
  };
  const material: DielectricMaterial = {
    ior: 1.45,
    absorption: [0.17, 0.055, 0.025],
    radius: 1,
  };
  const ballC: Vec3 = [0, 0, 0];
  // The corridor's own geometry: the certified ball (1.2) just contains
  // the unit sphere, and the floor point sits below it the way the
  // corridor's call sites place it — the outside approach must fit the
  // march's step budget the way a production floor point's does.
  const ballR = 1.2;
  const visR = 1.2;
  const chord = 2;
  const f0 = ((material.ior - 1) / (material.ior + 1)) ** 2;

  it("pays (1 - Fresnel)^2 and Beer over a normal-incidence chord", () => {
    const vis = transportShadowVisibilityCPU(
      system,
      [0, -1.3, 0],
      [0, 1, 0],
      material,
      ballC,
      ballR,
      visR,
    );
    for (let c = 0; c < 3; c++) {
      const expected =
        (1 - f0) ** 2 *
        Math.exp((-material.absorption[c] * chord) / material.radius);
      expect(Math.abs(vis[c] - expected)).toBeLessThan(2e-3);
    }
  });

  it("returns exactly 1 on both corridor gate exits", () => {
    // Ball behind: the shadow ray recedes from the ball.
    expect(
      transportShadowVisibilityCPU(
        system,
        [4, 0, 0],
        [1, 0, 0],
        material,
        ballC,
        ballR,
        visR,
      ),
    ).toEqual([1, 1, 1]);
    // Closest approach clears 1.05 R + 0.3 * along.
    expect(
      transportShadowVisibilityCPU(
        system,
        [0, -1.3, 0],
        [1, 0.05, 0],
        material,
        ballC,
        ballR,
        visR,
      ).every((c) => c === 1),
    ).toBe(true);
  });

  it("goes dark straight through when the exit total-internally-reflects", () => {
    // A vertical ray through x = 0.9 meets the exit interface at
    // |cos| = 0.436, past the critical angle (1/1.45): the straight ray
    // keeps its energy inside, so the straight model transmits nothing
    // (no caustic is promised).
    const vis = transportShadowVisibilityCPU(
      system,
      [0.9, -1.3, 0],
      [0, 1, 0],
      material,
      ballC,
      ballR,
      visR,
    );
    for (let c = 0; c < 3; c++) {
      expect(vis[c]).toBeLessThan(1e-6);
    }
  });

  it("keeps the corridor gate's arithmetic exact at its boundary", () => {
    // along <= 0 is ball-behind: shadow 1 with zero field evals.
    expect(
      transportShadowCorridorGate([3, 0, 0], [1, 0, 0], ballC, ballR),
    ).toBe(false);
    // Inside the corridor: the march runs.
    expect(
      transportShadowCorridorGate([0, -1.3, 0], [0, 1, 0], ballC, ballR),
    ).toBe(true);
  });
});
