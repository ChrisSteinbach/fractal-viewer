import { mulberry32 } from "../../fractal/rng";
import {
  resolveSphereInversion,
  type SphereInversionAuthored,
  type SphereInversionConstruction,
} from "../../fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  sphereInversionContains,
  sphereInversionSignedDistance,
} from "../../fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  sphereInversionContains4,
  sphereInversionSignedDistance4,
} from "../../fractal/sphere-inversion-de-4d";
import { SURFACE_GPU_TRANSPORT_FAILURE_INSIDE_MISS } from "../../fractal/surface-de-gpu";
import {
  SURFACE_GPU_TRANSPORT_REASON_INVALID_INPUT,
  SURFACE_GPU_TRANSPORT_REASON_STATE_MISMATCH,
  transportBoundaryQueryCPU,
  transportFiniteBoundaryQueryCPU,
  transportShadowCorridorGate,
  transportShadowVisibilityCPU,
  transportTerminalDisplacementCPU,
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  TRANSPORT_SHADOW_BAND_SUBSTEPS,
  type TransportFiniteQueryFn,
  type TransportFixtureSystem,
} from "./surface-transport-fixture";
import {
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_ERROR_BUDGET,
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

describe("finite rear terminals skip origin-independent displacement", () => {
  const material: DielectricMaterial = { ...MATERIAL, distortion: 0.08 };
  const background: Vec3 = [0.125, 0.25, 0.5];
  const floorY = -0.95;
  const direction = (y: number): Vec3 => [Math.sqrt(1 - y * y), y, 0];
  // An independently evaluated plane terminal: its floor color depends on
  // the actual intersection, while the background is origin-independent.
  const terminal = (origin: Vec3, dir: Vec3, floor: boolean): Vec3 => {
    if (!floor || dir[1] >= -1e-6 || origin[1] <= floorY) return background;
    const t = (floorY - origin[1]) / dir[1];
    const x = origin[0] + t * dir[0];
    const z = origin[2] + t * dir[2];
    return [0.5 + 0.25 * Math.sin(x), 0.5 + 0.25 * Math.cos(z), 0.75];
  };

  it("keeps upward, horizontal and no-floor radiance exact with zero field calls", () => {
    const origin: Vec3 = [0.5, 0.2, 0];
    for (const [floor, y] of [
      [true, 0.2],
      [true, 0],
      [true, -1e-6],
      [false, -0.2],
    ] as const) {
      let calls = 0;
      const system: TransportFixtureSystem = {
        estimate: (p) => {
          calls++;
          return p[0];
        },
        stepScale: 1,
        visibleRadius: 1,
      };
      const dir = direction(y);
      const original = transportTerminalDisplacementCPU(
        system,
        origin,
        dir,
        material,
      );
      expect(calls).toBe(4);
      if (y !== 0) expect(original.applied).toBe(true);
      calls = 0;
      const skipped = transportTerminalDisplacementCPU(
        system,
        origin,
        dir,
        material,
        floor,
      );
      expect(calls).toBe(0);
      expect(skipped.origin).toBe(origin);
      expect(terminal(skipped.origin, dir, floor)).toEqual(
        terminal(original.origin, dir, floor),
      );
    }
  });

  it("retains every downward floor displacement, including origins below its height", () => {
    for (const y of [-0.2, -2e-6]) {
      for (const originY of [0.2, floorY - 0.001]) {
        let calls = 0;
        const system: TransportFixtureSystem = {
          estimate: (p) => {
            calls++;
            return p[0];
          },
          stepScale: 1,
          visibleRadius: 1,
        };
        const origin: Vec3 = [0.5, originY, 0];
        const dir = direction(y);
        const original = transportTerminalDisplacementCPU(
          system,
          origin,
          dir,
          material,
        );
        expect(calls).toBe(4);
        calls = 0;
        const retained = transportTerminalDisplacementCPU(
          system,
          origin,
          dir,
          material,
          true,
        );
        expect(calls).toBe(4);
        expect(retained).toEqual(original);
        expect(terminal(retained.origin, dir, true)).toEqual(
          terminal(original.origin, dir, true),
        );
      }
    }
  });
});

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

  it("pays the interface pair ONCE on the face-abutting boxes' exit face", () => {
    // The bench's closedSolidAbutting leg's through-lobe probe, at the
    // scale where the defect was measured: two half-unit boxes at
    // x = ∓0.5 (the min-union field), a floor point below, straight up
    // through the +x box. The SAFETY-scaled field's gradient at the
    // exit face is 0.9, so the declared crossing band (|f| < eps) is
    // ±eps/0.9 wide in SPACE — wider than the old fixed 2·eps skip —
    // and a fire on the band's near side re-fired the crossing one
    // sample later, paying the interface's (1-F0)² a second time
    // (measured: 0.7740 of transmittance where the geometry's one pair
    // gives 0.8198). The march must LEAVE the band after firing.
    const visR = 1.4353266739736605;
    const boxes: ShapeSpec = {
      parts: ([-0.5, 0.5] as const).map((x) => ({
        primitive: { kind: "box", half: [0.5, 0.5, 0.5] } as const,
        combine: "union" as const,
        pose: { offset: [x, 0, 0] as Vec3 },
      })),
    };
    const abutting: TransportFixtureSystem = {
      estimate: (p: Vec3) =>
        SHAPE_MARCH_SAFETY * shapeSdf(boxes, p[0], p[1], p[2]),
      stepScale: 1,
      visibleRadius: visR,
    };
    const mat: DielectricMaterial = {
      ior: material.ior,
      absorption: material.absorption,
      radius: visR,
    };
    const vis = transportShadowVisibilityCPU(
      abutting,
      [0.35, -1.2 * visR, 0.05],
      [0, 1, 0],
      mat,
      ballC,
      visR,
      visR,
    );
    // One crossing pair through the box: chord exactly 1.0, normal
    // incidence on both faces.
    for (let c = 0; c < 3; c++) {
      const expected =
        (1 - f0) ** 2 * Math.exp((-material.absorption[c] * 1.0) / visR);
      expect(Math.abs(vis[c] - expected)).toBeLessThan(2e-3);
    }
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

for (const dim of [3, 4] as const) {
  it(`matches the absorbing slab's complete reflection series in ${dim}D from the camera`, () => {
    const cube = buildFiniteSolidConstruction(
      dim === 3 ? "menger" : "hyperMenger",
      dim,
      0,
    );
    const material: DielectricMaterial = {
      ior: 1.45,
      radius: 1,
      absorption: [0.17, 0.055, 0.025],
    };
    const background: Vec3 = [0.25, 0.35, 0.45];
    const result = transportTraceCPU(
      {
        estimate: () => {
          throw new Error("finite transport must not use the display normal");
        },
        stepScale: 1,
        visibleRadius: 1.5,
      },
      [-2, 0, 0],
      [1, 0, 0],
      DIELECTRIC_INITIAL_BRANCH_THETA,
      material,
      background,
      undefined,
      undefined,
      (origin, direction, anchor, inside) =>
        transportFiniteBoundaryQueryCPU(
          cube,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          direction,
          anchor,
          inside,
        ),
    );
    expect(["complete", "residual"]).toContain(result.status);
    expect(result.failure).toBe(0);
    const fresnel = ((material.ior - 1) / (material.ior + 1)) ** 2;
    for (let channel = 0; channel < 3; channel++) {
      const beer = Math.exp(
        (-material.absorption[channel] * 2 * FINITE_SOLID_HALF_EXTENT) /
          material.radius,
      );
      // Primary reflection, then both slab faces' infinite internal series.
      const exact =
        background[channel] *
        (fresnel + ((1 - fresnel) ** 2 * beer) / (1 - fresnel * beer));
      expect(Math.abs(exact - result.radiance[channel])).toBeLessThanOrEqual(
        result.residual + 1e-14,
      );
    }
  });
}

/**
 * THE SPHERE-INVERSION ARM. Its field is a certified LOWER BOUND, not a
 * signed distance, so the queries above run with the exact membership
 * predicate wired in (`TransportFixtureSystem.contains`). What is pinned
 * here is what that changes and what it must not: the analytic control on a
 * construction whose orbit IS a sphere, the gate's effect on a phantom band,
 * the family's three singular outcomes, and the 4D arm through the app's own
 * posed lift at zero slab thickness.
 */
describe("the sphere-inversion arm's transport", () => {
  const authored = (a: SphereInversionAuthored) => {
    const r = resolveSphereInversion(a);
    if (!r.ok) throw new Error(r.reasons.join("; "));
    return r.construction;
  };

  /** A construction whose depth-0 orbit is EXACTLY the seed ball: the
   * generators sit at distance 1 with radius 0.7, so they reach in to 0.3
   * and never touch a seed of radius 0.28. `K ∩ F` is then the ball alone,
   * and every optical quantity through it has a closed form. */
  const BALL_RADIUS = 0.28;
  const ballOnly = authored({
    arrangement: "oct6",
    seed: { size: BALL_RADIUS },
    depth: 0,
  });

  const material: DielectricMaterial = {
    ior: 1.45,
    absorption: [0.17, 0.055, 0.025],
    radius: 1,
  };

  function siSystem(c: SphereInversionConstruction): TransportFixtureSystem {
    const de = buildSphereInversionDE(c);
    return {
      estimate: (p) => sphereInversionSignedDistance(de, p),
      contains: (p) => sphereInversionContains(de, p),
      stepScale: 1,
      visibleRadius: 2,
    };
  }

  it("ANALYTIC CONTROL: one interface pair and Beer over a known chord", () => {
    // Independent of the twin and of the field: the orbit is a ball of a
    // radius the construction states, so a normal-incidence shadow ray pays
    // exactly (1 - F0)^2 and Beer over its diameter.
    const system = siSystem(ballOnly);
    const f0 = ((material.ior - 1) / (material.ior + 1)) ** 2;
    const chord = 2 * BALL_RADIUS;
    const vis = transportShadowVisibilityCPU(
      system,
      [0, -1.3, 0],
      [0, 1, 0],
      material,
      [0, 0, 0],
      1.2,
      1.2,
    );
    for (let c = 0; c < 3; c++) {
      const expected =
        (1 - f0) ** 2 *
        Math.exp((-material.absorption[c] * chord) / material.radius);
      expect(Math.abs(vis[c] - expected)).toBeLessThan(2e-3);
    }
  });

  it("finds the ball's entry and exit at the radii the construction states", () => {
    const system = siSystem(ballOnly);
    const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
    const entry = transportSolidBoundaryQueryCPU(
      system,
      [0, -1, 0],
      [0, 1, 0],
      false,
      [0, -1, 0],
      false,
      eps,
    );
    expect(entry.kind).toBe("boundary");
    expect(Math.abs(entry.t - (1 - BALL_RADIUS))).toBeLessThan(4 * eps);
    expect(entry.normal[1]).toBeLessThan(-0.99);
    const hit: Vec3 = [0, -1 + entry.t, 0];
    const exit = transportSolidBoundaryQueryCPU(
      system,
      hit,
      [0, 1, 0],
      true,
      hit,
      true,
      eps,
    );
    expect(exit.kind).toBe("boundary");
    expect(Math.abs(exit.t - 2 * BALL_RADIUS)).toBeLessThan(4 * eps);
    expect(exit.normal[1]).toBeGreaterThan(0.99);
  });

  it("THE MEMBERSHIP GATE changes the answer where the bound is merely loose", () => {
    // A near-kissing arrangement at depth: the bound dips into the band at
    // the tangency cusps with no surface there. Without the predicate the
    // query reports those as crossings; with it, every reported crossing
    // has membership flipping across it.
    const c = authored({
      arrangement: "oct6",
      radiusFraction: 0.99,
      seed: { size: 0.28 },
      depth: 6,
    });
    const gated = siSystem(c);
    const ungated: TransportFixtureSystem = {
      estimate: gated.estimate,
      stepScale: 1,
      visibleRadius: 2,
    };
    const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
    const rng = mulberry32(0xc0ffee);
    let phantomsRejected = 0;
    let gatedCrossings = 0;
    for (let i = 0; i < 400; i++) {
      const origin: Vec3 = [2 * rng() - 1, 2 * rng() - 1, -1.8];
      const dir: Vec3 = [0, 0, 1];
      const a = transportSolidBoundaryQueryCPU(
        ungated,
        origin,
        dir,
        false,
        origin,
        false,
        eps,
      );
      const b = transportSolidBoundaryQueryCPU(
        gated,
        origin,
        dir,
        false,
        origin,
        false,
        eps,
      );
      if (b.kind === "boundary") {
        gatedCrossings++;
        // Every gated crossing is a real one: membership flips across it.
        const p: Vec3 = [
          origin[0] + dir[0] * b.t,
          origin[1] + dir[1] * b.t,
          origin[2] + dir[2] * b.t,
        ];
        expect(
          gated.contains?.([
            p[0] + dir[0] * 2 * eps,
            p[1] + dir[1] * 2 * eps,
            p[2] + dir[2] * 2 * eps,
          ]),
        ).toBe(true);
      }
      if (a.kind === "boundary" && (b.kind !== "boundary" || b.t > a.t + eps)) {
        phantomsRejected++;
      }
    }
    expect(gatedCrossings).toBeGreaterThan(20);
    expect(phantomsRejected).toBeGreaterThan(0);
  });

  it("invents no crossing at a POLE, a CUSP or an exhausted fold", () => {
    const c = authored({
      arrangement: "oct6",
      radiusFraction: 1,
      seed: { size: 0.28 },
      depth: 2,
    });
    const system = siSystem(c);
    const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
    const centre = c.generators[0].center as unknown as Vec3;
    // Straight at a generator centre: the bound decays toward it, so the
    // march creeps and must terminate in a REFUSAL or a miss — never a
    // crossing the ray can be marked inside of.
    const len = Math.hypot(...centre);
    const dir: Vec3 = [centre[0] / len, centre[1] / len, centre[2] / len];
    const start: Vec3 = [-dir[0] * 1.6, -dir[1] * 1.6, -dir[2] * 1.6];
    const pole = transportSolidBoundaryQueryCPU(
      system,
      start,
      dir,
      false,
      start,
      false,
      eps,
    );
    if (pole.kind === "boundary") {
      const p: Vec3 = [
        start[0] + dir[0] * pole.t,
        start[1] + dir[1] * pole.t,
        start[2] + dir[2] * pole.t,
      ];
      expect(
        system.contains?.([
          p[0] + dir[0] * 2 * eps,
          p[1] + dir[1] * 2 * eps,
          p[2] + dir[2] * 2 * eps,
        ]),
      ).toBe(true);
    }
    // At a kissing tangency the estimate reaches 0 without membership. The
    // gate must not read that as an interface.
    const tangency: Vec3 = [
      c.generators[0].center[0] - c.generators[0].radius,
      0,
      0,
    ];
    expect(system.contains?.(tangency)).toBe(false);
    const cusp = transportSolidBoundaryQueryCPU(
      system,
      [tangency[0] - 0.2, 0, 0],
      [1, 0, 0],
      false,
      [tangency[0] - 0.2, 0, 0],
      false,
      eps,
    );
    if (cusp.kind === "boundary") {
      const p: Vec3 = [tangency[0] - 0.2 + cusp.t, 0, 0];
      expect(system.contains?.([p[0] + 2 * eps, p[1], p[2]])).toBe(true);
    }
  });

  it("traces a sphere-inversion glass path end to end with complete accounting", () => {
    const system = siSystem(ballOnly);
    const result = transportTraceCPU(
      system,
      [0, 0, -BALL_RADIUS],
      [0, 0, 1],
      DIELECTRIC_INITIAL_BRANCH_THETA,
      material,
      [0.6, 0.6, 0.6],
      { maxProcessedPaths: 4096, maxInterfaces: 4096 },
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
    // COMPLETE ACCOUNTING is the claim, not "complete": a trace that cuts
    // weak branches at theta terminates `residual` and carries what it
    // omitted, which is a resolved sample as long as the omission fits the
    // per-sample budget. What must never happen is `unresolved` or
    // `invalid` — an inside path with nowhere to go, or a refusal presented
    // as background.
    expect(["complete", "residual"]).toContain(result.status);
    expect(result.failure).toBe(0);
    expect(result.residual).toBeLessThanOrEqual(DIELECTRIC_ERROR_BUDGET);
    expect(result.radiance.every((v) => Number.isFinite(v) && v >= 0)).toBe(
      true,
    );
    expect(Math.max(...result.radiance)).toBeGreaterThan(0);
  });

  it("MEASURES the declared band's width in space against the sub-step guard", () => {
    // The closed-solid field's gradient at a face is the SAFETY factor 0.9,
    // so its band is 1.11·eps wide and four 2·eps sub-steps clear it. A
    // certified BOUND is a different regime, and this is the figure the
    // guard is qualified against for this family.
    const c = authored({
      arrangement: "oct6",
      radiusFraction: 0.99,
      seed: { size: 0.28 },
      depth: 6,
    });
    const de = buildSphereInversionDE(c);
    const field = (p: Vec3) => sphereInversionSignedDistance(de, p);
    const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
    const rng = mulberry32(0xba2d);
    let samples = 0;
    let worstWidth = 0;
    let sumWidth = 0;
    for (let i = 0; i < 4000000 && samples < 400; i++) {
      const p: Vec3 = [3 * rng() - 1.5, 3 * rng() - 1.5, 3 * rng() - 1.5];
      const f = field(p);
      if (!(Math.abs(f) < eps)) continue;
      samples++;
      const h = eps * 0.25;
      const g: Vec3 = [
        (field([p[0] + h, p[1], p[2]]) - field([p[0] - h, p[1], p[2]])) /
          (2 * h),
        (field([p[0], p[1] + h, p[2]]) - field([p[0], p[1] - h, p[2]])) /
          (2 * h),
        (field([p[0], p[1], p[2] + h]) - field([p[0], p[1], p[2] - h])) /
          (2 * h),
      ];
      const m = Math.hypot(...g);
      // Band width in SPACE for this sample: 2·eps / |grad f|.
      const width = m > 1e-9 ? (2 * eps) / m : Infinity;
      sumWidth += Math.min(width, 1e6);
      if (width > worstWidth) worstWidth = width;
    }
    const mean = sumWidth / samples;
    console.log(
      `  sphere-inversion band width in space: mean ${(mean / eps).toFixed(2)}·eps,` +
        ` worst ${(worstWidth / eps).toFixed(2)}·eps` +
        ` over ${samples} band samples (the guard advances ${TRANSPORT_SHADOW_BAND_SUBSTEPS} × 2·eps)`,
    );
    expect(samples).toBeGreaterThan(100);
    // The measurement is the point; what it must establish is that a fixed
    // sub-step count is NOT the thing keeping the march honest here — the
    // exact-membership exit is.
    expect(worstWidth).toBeGreaterThan(
      2 * eps * TRANSPORT_SHADOW_BAND_SUBSTEPS,
    );
  });

  it("carries the 4D field through a posed slice at zero slab thickness", () => {
    const c = authored({
      arrangement: "cross8",
      radiusFraction: 0.99,
      seed: { size: 0.32 },
      depth: 3,
    });
    const de = buildSphereInversionDE4(c);
    const angle = 0.3;
    const w0 = 0.1;
    const lift = (p: Vec3): [number, number, number, number] => {
      const co = Math.cos(angle);
      const si = Math.sin(angle);
      return [co * p[0] - si * w0, p[1], p[2], si * p[0] + co * w0];
    };
    const system: TransportFixtureSystem = {
      estimate: (p) => sphereInversionSignedDistance4(de, lift(p)),
      contains: (p) => sphereInversionContains4(de, lift(p)),
      stepScale: 1,
      visibleRadius: 2,
    };
    const eps = DIELECTRIC_CROSSING_EPS_REL * material.radius;
    const rng = mulberry32(0x4d5e);
    let crossings = 0;
    for (let i = 0; i < 300; i++) {
      const origin: Vec3 = [0.8 * (2 * rng() - 1), 0.8 * (2 * rng() - 1), -1.8];
      const dir: Vec3 = [0, 0, 1];
      const r = transportSolidBoundaryQueryCPU(
        system,
        origin,
        dir,
        false,
        origin,
        false,
        eps,
      );
      expect(["boundary", "miss", "refused"]).toContain(r.kind);
      if (r.kind !== "boundary") continue;
      crossings++;
      const p: Vec3 = [origin[0], origin[1], origin[2] + r.t];
      // The displayed point's membership flips across the crossing: the 4D
      // field read in the slice is an in-slice boundary query.
      expect(system.contains?.([p[0], p[1], p[2] + 2 * eps])).toBe(true);
      expect(Math.hypot(...r.normal)).toBeGreaterThan(0.99);
    }
    expect(crossings).toBeGreaterThan(20);
  });

  describe("the membership-crossed branch", () => {
    // Near a tangency cusp the transported bound's gradient degenerates,
    // and the band landing's "is the zero ahead" test can read backwards:
    // the query stepped past a real exit and the path ran to the domain,
    // failing its trace inside-miss. The branch reports a crossing where
    // the field's sign AND exact membership both contradict the claim,
    // located by bisecting membership. These pin it at the session's own
    // scales (the optical radius is the estimator's bounding radius).
    const orbitSystem = (depth: number): TransportFixtureSystem => {
      const de = buildSphereInversionDE(
        authored({
          arrangement: "oct6",
          radiusFraction: 0.99,
          seed: { size: 0.28 },
          depth,
        }),
      );
      return {
        estimate: (p) => sphereInversionSignedDistance(de, p),
        contains: (p) => sphereInversionContains(de, p),
        stepScale: 1,
        visibleRadius: de.boundingRadius,
      };
    };
    const traceOf = (system: TransportFixtureSystem, origin: Vec3, dir: Vec3) =>
      transportTraceCPU(
        system,
        origin,
        dir,
        DIELECTRIC_INITIAL_BRANCH_THETA,
        { ...material, radius: system.visibleRadius },
        [0.2, 0.3, 0.4],
        { maxProcessedPaths: 512, maxInterfaces: 512 },
        (o, d, ap, apt, ins, eps) =>
          transportSolidBoundaryQueryCPU(system, o, d, ap, apt, ins, eps),
      );
    const firstHit = (
      system: TransportFixtureSystem,
      ro: Vec3,
      target: Vec3,
    ): { hit: Vec3; dir: Vec3 } | null => {
      const v = [0, 1, 2].map((a) => target[a] - ro[a]);
      const len = Math.hypot(v[0], v[1], v[2]);
      const dir = v.map((x) => x / len) as Vec3;
      let t = 0;
      for (let i = 0; i < 4096; i++) {
        const p = [0, 1, 2].map((a) => ro[a] + dir[a] * t) as Vec3;
        const e = system.estimate(p);
        if (e < system.visibleRadius * 1e-3) return { hit: p, dir };
        t += Math.max(e, 0);
        if (t > 4 * system.visibleRadius) return null;
      }
      return null;
    };

    it("resolves the near-cusp ray the query used to strand inside-miss", () => {
      const system = orbitSystem(3);
      const w = Math.sqrt(1 / 3);
      const probe = firstHit(system, [3 * w, 3 * w, 3 * w], [0.5, 0.5, 0]);
      expect(probe).not.toBeNull();
      const r = traceOf(system, probe!.hit, probe!.dir);
      expect(["complete", "residual"]).toContain(r.status);
    });

    it("leaves no inside-miss at depth 6 at the shipped crossing scale", () => {
      const system = orbitSystem(6);
      const visR = system.visibleRadius;
      const ro: Vec3 = [0.9 * visR, 0.55 * visR, 1.7 * visR];
      const rng = mulberry32(99);
      let traced = 0;
      let resolved = 0;
      while (traced < 40) {
        const target = [0, 1, 2].map(() => (rng() * 2 - 1) * 0.9) as Vec3;
        const probe = firstHit(system, ro, target);
        if (!probe) continue;
        traced++;
        const r = traceOf(system, probe.hit, probe.dir);
        expect(r.failure).not.toBe(SURFACE_GPU_TRANSPORT_FAILURE_INSIDE_MISS);
        if (r.status === "complete" || r.status === "residual") resolved++;
      }
      expect(resolved / traced).toBeGreaterThan(0.8);
    });

    it("never reports a crossing membership does not flip across", () => {
      const system = orbitSystem(6);
      const eps = DIELECTRIC_CROSSING_EPS_REL * system.visibleRadius;
      const rng = mulberry32(7);
      let crossings = 0;
      for (let i = 0; i < 1200; i++) {
        const origin = [0, 1, 2].map(() => (rng() * 2 - 1) * 1.2) as Vec3;
        const v = [0, 1, 2].map(() => rng() * 2 - 1);
        const len = Math.hypot(v[0], v[1], v[2]);
        const dir = v.map((x) => x / len) as Vec3;
        const inside = system.contains!(origin);
        const r = transportSolidBoundaryQueryCPU(
          system,
          origin,
          dir,
          false,
          origin,
          inside,
          eps,
        );
        if (r.kind !== "boundary") continue;
        crossings++;
        const at = (t: number) =>
          system.contains!(
            [0, 1, 2].map((a) => origin[a] + dir[a] * t) as Vec3,
          );
        expect(at(r.t + 2 * eps)).not.toBe(inside);
      }
      expect(crossings).toBeGreaterThan(80);
    });
  });
});
