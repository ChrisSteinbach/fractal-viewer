import {
  SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT,
  SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH,
  transportBoundaryQueryCPU,
  transportFiniteBoundaryQueryCPU,
  transportShadowCorridorGate,
  transportShadowVisibilityCPU,
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  type TransportFiniteQueryFn,
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
import {
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_IDENTITY_POSE,
  buildFiniteSolidConstruction,
  finiteSolidDisplayDistance,
} from "../../fractal/finite-solid";
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

describe("transportFiniteBoundaryQueryCPU — the DDA adapter", () => {
  const construction = buildFiniteSolidConstruction("menger", 3, 1);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("maps the oracle's boundary onto the transport vocabulary with the anchor out", () => {
    // The level-1 Menger's root face at x = +0.75: a ray from outside
    // heading -x enters at t = 1.25 (the same control the unit oracle
    // pins), entering, and hands back the full anchor.
    const hit = transportFiniteBoundaryQueryCPU(
      construction,
      pose,
      [2, 0.6, 0.6],
      [-1, 0, 0],
      null,
      false,
    );
    expect(hit.kind).toBe("boundary");
    expect(hit.reason).toBe(0);
    expect(hit.t).toBe(1.25);
    expect(hit.anchor).not.toBeNull();
    expect(hit.anchor!.planeMask).toBe(1);
    // The root face plane at level 1's G = 3 grid is plane index 3.
    expect(hit.anchor!.planeIndices[0]).toBe(3);
  });

  it("maps every oracle refusal onto its transport reason code", () => {
    // state-mismatch: an anchored query whose post-incident cell contradicts
    // the claimed medium — the entry anchor claimed as inside=0 is exactly
    // that contradiction (the anchor's post-incident cell is the interior).
    const entry = transportFiniteBoundaryQueryCPU(
      construction,
      pose,
      [2, 0.6, 0.6],
      [-1, 0, 0],
      null,
      false,
    );
    expect(entry.kind).toBe("boundary");
    const mismatch = transportFiniteBoundaryQueryCPU(
      construction,
      pose,
      [0, 0, 0],
      [-1, 0, 0],
      entry.anchor,
      false,
    );
    expect(mismatch.kind).toBe("refused");
    expect(mismatch.reason).toBe(SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH);
    // invalid-input: a zero direction.
    const invalid = transportFiniteBoundaryQueryCPU(
      construction,
      pose,
      [2, 0, 0],
      [0, 0, 0],
      null,
      false,
    );
    expect(invalid.kind).toBe("refused");
    expect(invalid.reason).toBe(SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT);
  });

  it("threads the anchor through transportTraceCPU's finite backend", () => {
    // The DDA's chained sweep: the trace's refracted child restarts from
    // the primary's anchor and walks to the exit — the trace twin must
    // complete (not refuse state-mismatch), which only happens when the
    // anchor is actually threaded. The system's estimate is the certified
    // hybrid display DE.
    const system: TransportFixtureSystem = {
      estimate: (p) => finiteSolidDisplayDistance(construction, pose, p),
      stepScale: 1,
      visibleRadius: FINITE_SOLID_HALF_EXTENT * Math.sqrt(3),
    };
    const finiteQuery = (
      origin: Vec3,
      dir: Vec3,
      anchor: Parameters<TransportFiniteQueryFn>[2],
      inside: boolean,
    ) =>
      transportFiniteBoundaryQueryCPU(
        construction,
        pose,
        origin,
        dir,
        anchor,
        inside,
      );
    const result = transportTraceCPU(
      system,
      [2, 0.6, 0.6],
      [-1, 0, 0],
      DIELECTRIC_INITIAL_BRANCH_THETA,
      MATERIAL,
      [0.25, 0.35, 0.45],
      undefined,
      undefined,
      finiteQuery,
    );
    // Complete or residual (sub-theta children are the replay's normal
    // residual, never a refusal) — and crucially failure 0: a state-
    // mismatch refusal (failure 4, reason 3) would mean the anchor was
    // NOT threaded through the paths.
    expect(["complete", "residual"]).toContain(result.status);
    expect(result.failure).toBe(0);
    expect(result.radiance.every((c) => c >= 0)).toBe(true);
  });
});
