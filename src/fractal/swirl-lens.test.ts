import { applyAffine, composeAffine } from "./affine";
import { applyAffine4, composeAffine4, toTransform4 } from "./affine4";
import {
  buildBalloon,
  buildBalloon4,
  estimateBalloonDistance,
  estimateBalloonDistance4,
} from "./balloon-de";
import { runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { pentatope, sierpinskiTetrahedron } from "./presets";
import { resolvePointTilingSession } from "./point-tiling-session";
import { mulberry32 } from "./rng";
import { resolveSolidTilingSession } from "./solid-tiling-session";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
  surfaceDescentCostWeight,
  transformSeparatedSigmas,
} from "./surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
  slabExact4,
  systemFoldShaped4,
  transformSeparatedSigmas4,
} from "./surface-de-4d";
import {
  inverseSwirlInto,
  pureSwirlFinal,
  SURFACE_LENS_SWIRL,
  SWIRL_LENS_MAX_RADIUS,
  swirlInverseLipschitz,
  swirlGlobalInverseLipschitz,
  surfaceSwirlAcceptanceScale,
  validatedSwirlLensLipschitz,
  validatedSwirlLensRadius,
} from "./swirl-lens";
import type { HybridSchedule, Transform, Vec3, Vec4 } from "./types";
import type { TilingSpec } from "./tiling";
import { composeVariations } from "./variations";
import { composeVariations4 } from "./variations4";

function swirlFinal(weight = 1): Transform {
  return {
    id: 99,
    position: [0.02, -0.01, 0.01],
    rotation: [0.2, -0.3, 0.1],
    scale: [-0.05, 0.05, 0.05],
    variations: [{ type: "swirl", weight }],
  };
}

describe("the shared swirl lens certificate", () => {
  it("inverts independent production variations and agrees exactly on the flat 3D/4D lift", () => {
    const forward3 = composeVariations([{ type: "swirl", weight: 1 }])!;
    const forward4 = composeVariations4([{ type: "swirl", weight: 1 }])!;
    const rng = mulberry32(0x541a1);
    for (let i = 0; i < 256; i++) {
      const p: Vec4 = [rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const f3 = [...forward3(p[0], p[1], p[2], rng)];
      expect([...forward4(p[0], p[1], p[2], 0, rng)]).toEqual([...f3, 0]);
      inverseSwirlInto(f3, f3);
      const f4 = [...forward4(...p, rng)];
      inverseSwirlInto(f4, f4);
      for (let axis = 0; axis < 4; axis++) {
        expect(f4[axis]).toBeCloseTo(p[axis], 13);
        if (axis < 3) expect(f3[axis]).toBeCloseTo(p[axis], 13);
      }
    }
  });

  it("lower-bounds exact singleton distances, including nearby off-plane 4D queries", () => {
    const forward = composeVariations4([{ type: "swirl", weight: 1 }])!;
    const rng = mulberry32(0x61ca);
    for (const dimension of [3, 4]) {
      for (let i = 0; i < 512; i++) {
        const p: Vec4 = [
          rng() - 0.5,
          rng() - 0.5,
          rng() - 0.5,
          dimension === 4 ? rng() - 0.5 : 0,
        ];
        const image = [...forward(...p, rng)];
        const step = i % 2 === 0 ? 1e-5 : 1;
        const query = image.map(
          (x, axis) => x + (axis < dimension ? (rng() - 0.5) * step : 0),
        );
        const trueDistance = Math.hypot(
          ...query.map((x, axis) => x - image[axis]),
        );
        const inverse: number[] = [];
        inverseSwirlInto(query, inverse);
        const lower =
          Math.hypot(...inverse.map((x, axis) => x - p[axis])) /
          swirlInverseLipschitz(Math.hypot(...query), Math.hypot(...p));
        expect(lower).toBeLessThanOrEqual(trueDistance + 1e-12);
      }
    }
  });

  it("stores an upward-rounded global certificate valid for near and arbitrarily far queries", () => {
    const forward = composeVariations4([{ type: "swirl", weight: 1 }])!;
    const rng = mulberry32(0x610ba1);
    for (const rho of [0.05, 0.15, 0.3, SWIRL_LENS_MAX_RADIUS]) {
      const bound = swirlGlobalInverseLipschitz(rho);
      const exactExpression = 1 + rho * rho + rho * Math.sqrt(rho * rho + 2);
      expect(bound).toBe(Math.fround(bound));
      expect(bound).toBeGreaterThanOrEqual(exactExpression);
      expect(bound).toBeLessThan(exactExpression * (1 + 2e-7));
      expect(validatedSwirlLensLipschitz(rho, bound)).toBe(bound);
      for (const dimension of [3, 4]) {
        for (let i = 0; i < 128; i++) {
          const point: Vec4 = [
            rng() - 0.5,
            rng() - 0.5,
            rng() - 0.5,
            dimension === 4 ? rng() - 0.5 : 0,
          ];
          const radialScale = (rho * rng()) / Math.hypot(...point);
          for (let axis = 0; axis < 4; axis++) point[axis] *= radialScale;
          const image = [...forward(...point, rng)];
          // Near-pair derivative limit, the crossover sphere, and queries
          // far beyond the source ball all use the SAME stored coefficient.
          const span = [1e-6, Math.sqrt(rho * rho + 2) * 2, 1e4][i % 3];
          const query = image.map(
            (value, axis) =>
              value + (axis < dimension ? (rng() - 0.5) * span : 0),
          );
          const inverse: number[] = [];
          inverseSwirlInto(query, inverse);
          const lower =
            Math.hypot(...inverse.map((value, axis) => value - point[axis])) /
            bound;
          const actual = Math.hypot(
            ...query.map((value, axis) => value - image[axis]),
          );
          expect(lower).toBeLessThanOrEqual(actual + 1e-11);
        }
      }
    }
    expect(swirlGlobalInverseLipschitz(0)).toBe(1);
    const rho = SWIRL_LENS_MAX_RADIUS;
    for (const invalid of [
      undefined,
      NaN,
      Infinity,
      1,
      swirlGlobalInverseLipschitz(rho) + 1e-10,
    ]) {
      expect(() => validatedSwirlLensLipschitz(rho, invalid)).toThrow(
        /f32 Lipschitz/,
      );
    }
  });

  it("recognizes only a single active swirl and validates its supported certificate", () => {
    const final = swirlFinal();
    expect(pureSwirlFinal(final)?.type).toBe("swirl");
    expect(
      pureSwirlFinal({
        ...final,
        variations: [
          ...final.variations!,
          { type: "linear", weight: 0 },
          { type: "boxfold", weight: NaN },
        ],
      })?.type,
    ).toBe("swirl");
    expect(
      pureSwirlFinal({
        ...final,
        variations: [...final.variations!, { type: "linear", weight: 0.1 }],
      }),
    ).toBeNull();
    expect(validatedSwirlLensRadius(SWIRL_LENS_MAX_RADIUS)).toBe(
      SWIRL_LENS_MAX_RADIUS,
    );
    for (const invalid of [
      undefined,
      NaN,
      Infinity,
      -1,
      SWIRL_LENS_MAX_RADIUS + 1e-4,
    ]) {
      expect(() => validatedSwirlLensRadius(invalid)).toThrow(/swirl/);
    }
  });
});

describe("Surface swirl final admission in both dimensions", () => {
  it("keeps newly admitted Point/Solid tiling on the same lensed set and radius in both dimensions", () => {
    for (const fourD of [false, true]) {
      const transforms = fourD ? pentatope() : sierpinskiTetrahedron();
      const final = swirlFinal(-2);
      const symmetry = { order: 3, plane: "xy" as const };
      const raw = fourD
        ? buildSurfaceDE4(transforms, final, symmetry)
        : buildSurfaceDE(transforms, final, symmetry);
      const tilings: TilingSpec[] = [
        { group: fourD ? "a4" : "a3" },
        { kind: "lattice", cellScale: 1.5 },
      ];
      for (const tiling of tilings) {
        const args = [
          transforms,
          final,
          symmetry,
          null,
          tiling,
          false,
          fourD,
        ] as const;
        const points = resolvePointTilingSession(...args);
        const solid = resolveSolidTilingSession(...args);
        expect(points.status).toBe("active");
        expect(solid.status).toBe("active");
        if (points.status !== "active" || solid.status !== "active") continue;
        expect(points.originVisibleRadius).toBe(raw.visibleBoundingRadius);
        expect(solid.originVisibleRadius).toBe(raw.visibleBoundingRadius);
        expect(points.resolved).toEqual(solid.resolved);
        const refused: Transform = {
          ...final,
          position: [SWIRL_LENS_MAX_RADIUS + 1, 0, 0],
        };
        expect(
          resolvePointTilingSession(
            transforms,
            refused,
            symmetry,
            null,
            tiling,
            false,
            fourD,
          ).note,
        ).toMatch(/pre-swirl radius/);
        expect(
          resolveSolidTilingSession(
            transforms,
            refused,
            symmetry,
            null,
            tiling,
            false,
            fourD,
          ).note,
        ).toMatch(/pre-swirl radius/);
      }
    }
  });

  for (const dimension of [3, 4] as const) {
    const transforms = dimension === 3 ? sierpinskiTetrahedron() : pentatope();
    const analyze =
      dimension === 3 ? analyzeSurfaceSystem : analyzeSurfaceSystem4;
    const build = dimension === 3 ? buildSurfaceDE : buildSurfaceDE4;

    it(`${dimension}D admits bounded finals and refuses recursive swirl, blends, singular stages and tiny weights`, () => {
      const final = swirlFinal(-2);
      expect(analyze(transforms, final).status).not.toBe("ineligible");
      expect(
        analyze([{ ...transforms[0], variations: final.variations }]).reasons,
      ).toContain("map 1 uses variations");
      expect(
        analyze(transforms, {
          ...final,
          variations: [...final.variations!, { type: "linear", weight: 0.1 }],
        }).reasons,
      ).toContain("final transform uses variations");
      expect(analyze(transforms, swirlFinal(1e-7)).reasons).toContain(
        "final transform swirl weight ≈ 0",
      );
      expect(
        analyze(transforms, { ...final, scale: [0, 0.05, 0.05] }).status,
      ).toBe("ineligible");
      expect(
        analyze(transforms, {
          ...final,
          post: { m: [0, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] },
        }).status,
      ).toBe("ineligible");
      const de = build(transforms, final);
      expect(de.final).toBeNull();
      expect(de.foldFinal?.foldKind).toBe(SURFACE_LENS_SWIRL);
      expect(de.foldFinal?.swirlRadius).toBeLessThanOrEqual(
        SWIRL_LENS_MAX_RADIUS,
      );
      expect(de.foldFinal?.swirlLipschitz).toBe(
        swirlGlobalInverseLipschitz(de.foldFinal!.swirlRadius!),
      );
      expect(surfaceSwirlAcceptanceScale(de)).toBe(
        1 / de.foldFinal!.swirlLipschitz!,
      );
      expect(surfaceSwirlAcceptanceScale(build(transforms))).toBe(1);
      expect(de.patternCalibration).toEqual(
        build(transforms).patternCalibration,
      );
    });

    it(`${dimension}D prices strength before weight/post and includes the live symmetry and schedule in admission`, () => {
      const final = swirlFinal();
      const tooStrong: Transform = {
        ...final,
        position: [SWIRL_LENS_MAX_RADIUS + 1, 0, 0],
      };
      expect(analyze(transforms, tooStrong).reasons.join(" ")).toMatch(
        /pre-swirl radius.*reduce final scale or translation/,
      );
      expect(
        analyze(transforms, {
          ...tooStrong,
          variations: [{ type: "swirl", weight: 1e-3 }],
          post: { m: [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01], t: [0, 0, 0] },
        }).status,
      ).toBe("ineligible");
      const symmetry = { order: 3, plane: "xy" as const };
      const schedule: HybridSchedule = {
        depth: 1,
        transforms: [
          {
            ...transforms[0],
            position: [20, 0, 0],
            scale: [1, 1, 1] as Vec3,
            variations: undefined,
          },
        ],
      };
      const analysis = analyze(transforms, final, schedule, symmetry);
      expect(analysis.status).toBe("ineligible");
      expect(() => build(transforms, final, symmetry, { schedule })).toThrow(
        /pre-swirl radius/,
      );
      expect(systemFoldShaped4(transforms, final)).toBe(false);
    });
  }
});

describe("the one-shot 3D/4D swirl inverse wrapper", () => {
  it("keeps the CPU cone-footprint resolution independent of the swirl certificate", () => {
    const foldBase = sierpinskiTetrahedron().map((t) => ({
      ...t,
      scale: [0.15, 0.15, 0.15] as Vec3,
      variations: [{ type: "boxfold" as const, weight: 0.8 }],
    }));
    const rng = mulberry32(0xc0e610d);
    for (const transforms of [sierpinskiTetrahedron(), foldBase]) {
      const raw = buildSurfaceDE(transforms);
      const final = swirlFinal(-2);
      const de = buildSurfaceDE(transforms, final);
      const affine = composeAffine(final);
      const forward = composeVariations(final.variations)!;
      const scale =
        Math.abs(final.variations![0].weight) *
        transformSeparatedSigmas(final).min;
      const lipschitz = de.foldFinal!.swirlLipschitz!;
      const factor = scale / lipschitz;
      // Place the footprint across a depth boundary: multiplying it by G
      // makes the core stop one level earlier and accept extra geometry.
      const rawFootprint =
        (2 * raw.boundingRadius * raw.slowestSigma ** 6) / Math.sqrt(lipschitz);
      const footprint = scale * rawFootprint;
      const cloud = runChaosGame(transforms, 128, rng);
      for (const estimate of [estimateDistance, estimateDistanceRefined]) {
        let coarsened = 0;
        for (let i = 0; i < cloud.count; i++) {
          const q: Vec3 = [0, 1, 2].map(
            (axis) =>
              cloud.positions[i * 3 + axis] + (rng() - 0.5) * rawFootprint * 4,
          ) as Vec3;
          const p = forward(...applyAffine(affine, ...q), rng);
          const visibleFloor = Math.hypot(...p) - de.visibleBoundingRadius;
          const expected = Math.max(
            visibleFloor,
            factor * estimate(raw, q, 0, rawFootprint),
          );
          const coarse = Math.max(
            visibleFloor,
            factor * estimate(raw, q, 0, rawFootprint * lipschitz),
          );
          if (Math.abs(expected - coarse) > 1e-12) coarsened++;
          expect(estimate(de, p, 0, footprint)).toBeCloseTo(expected, 11);
        }
        expect(coarsened).toBeGreaterThan(0);
      }
    }
  });

  it("preserves the compensated hit and cutoff contracts through both balloon union terms", () => {
    const rng = mulberry32(0xba1100);
    let hits = 0;
    let misses = 0;
    for (const fourD of [false, true]) {
      const final: Transform = {
        ...swirlFinal(-2),
        scale: [-0.2, 0.2, 0.2],
        ...(fourD ? { w: { scale: 0.2, position: 0.03 } } : {}),
      };
      const de3 = fourD ? null : buildSurfaceDE(sierpinskiTetrahedron(), final);
      const de4 = fourD ? buildSurfaceDE4(pentatope(), final) : null;
      const de = de3 ?? de4!;
      const ball = de3 ? buildBalloon(de3, 0.35) : buildBalloon4(de4!, 0.35);
      // G=1 is ONLY an acceptance reference; its values must never march.
      // It keeps the same raw estimator, transforms and sphere floors.
      const reference3 = de3
        ? { ...de3, foldFinal: { ...de3.foldFinal!, swirlLipschitz: 1 } }
        : null;
      const reference4 = de4
        ? { ...de4, foldFinal: { ...de4.foldFinal!, swirlLipschitz: 1 } }
        : null;
      const evaluate = (point: Vec3, reference: boolean, cutoff = 0): number =>
        de3
          ? estimateBalloonDistance(
              estimateDistanceRefined,
              reference ? reference3! : de3,
              ball,
              point,
              cutoff,
            ).d
          : estimateBalloonDistance4(
              estimateDistance4Refined,
              reference ? reference4! : de4!,
              ball,
              point,
              0.05 * de.visibleBoundingRadius,
              cutoff,
            ).d;
      const eps = 0.02 * de.visibleBoundingRadius;
      const acceptEps = eps * surfaceSwirlAcceptanceScale(de);
      for (let i = 0; i < 128; i++) {
        const point: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
        const insideBothBalls = i % 2 === 0;
        const radius =
          de.visibleBoundingRadius *
          (insideBothBalls ? 0.2 + 0.6 * rng() : 1.1 + 2 * rng());
        const radialScale = radius / Math.hypot(...point);
        for (let axis = 0; axis < 3; axis++) point[axis] *= radialScale;
        const full = evaluate(point, false);
        const accepted = full < acceptEps;
        const referenceAccepted = evaluate(point, true) < eps;
        if (accepted) expect(referenceAccepted).toBe(true);
        if (insideBothBalls) expect(accepted).toBe(referenceAccepted);
        if (accepted) hits++;
        else misses++;
        const withCutoff = evaluate(point, false, acceptEps);
        expect(withCutoff < acceptEps).toBe(accepted);
        if (!accepted) expect(withCutoff).toBe(full);
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });

  it("3D un-posts, un-weights, inverse-swirls and inverse-affines around both untouched core families", () => {
    const foldBase = sierpinskiTetrahedron().map((t) => ({
      ...t,
      scale: [0.15, 0.15, 0.15] as Vec3,
      variations: [{ type: "boxfold" as const, weight: 0.8 }],
    }));
    const rng = mulberry32(0x352);
    let nontrivial = 0;
    for (const transforms of [sierpinskiTetrahedron(), foldBase]) {
      const raw = buildSurfaceDE(transforms);
      for (const weight of [-2, 0.7]) {
        const final: Transform = {
          ...swirlFinal(weight),
          post: {
            m: [0.6, 0.04, 0, 0, 0.7, 0.02, 0, 0, 0.8],
            t: [0.04, -0.01, 0.02],
          },
        };
        const de = buildSurfaceDE(transforms, final);
        const affine = composeAffine(final);
        const forward = composeVariations(final.variations)!;
        const sigma = transformSeparatedSigmas(final).min;
        expect(surfaceDescentCostWeight(de)).toBe(
          surfaceDescentCostWeight(raw),
        );
        for (let i = 0; i < 80; i++) {
          const q: Vec3 = [
            (rng() - 0.5) * raw.boundingRadius * 2,
            (rng() - 0.5) * raw.boundingRadius * 2,
            (rng() - 0.5) * raw.boundingRadius * 2,
          ];
          const pre = applyAffine(affine, ...q);
          const varied = forward(...pre, rng);
          const p = applyAffine(final.post!, ...varied);
          const factor =
            (Math.abs(weight) * sigma) / de.foldFinal!.swirlLipschitz!;
          for (const estimate of [estimateDistance, estimateDistanceRefined]) {
            const expected = Math.max(
              Math.hypot(...p) - de.visibleBoundingRadius,
              factor * estimate(raw, q),
            );
            expect(estimate(de, p)).toBeCloseTo(expected, 10);
            const hitEps = 0.003;
            const rawHit =
              Math.max(
                Math.hypot(...p) - de.visibleBoundingRadius,
                Math.abs(weight) * sigma * estimate(raw, q),
              ) < hitEps;
            const compensatedHit =
              estimate(de, p) < hitEps * surfaceSwirlAcceptanceScale(de);
            if (compensatedHit) expect(rawHit).toBe(true);
            if (Math.hypot(...p) <= de.visibleBoundingRadius)
              expect(compensatedHit).toBe(rawHit);
            if (expected > 1e-6 && expected === factor * estimate(raw, q))
              nontrivial++;
            const cutoff = 0.0001;
            const capped = estimate(de, p, cutoff);
            expect(capped >= cutoff ? capped : 0).toBeCloseTo(
              expected >= cutoff ? expected : 0,
              10,
            );
          }
        }
        const cloud = runChaosGame(transforms, 2048, rng, final);
        for (let i = 0; i < cloud.count; i++) {
          expect(
            Math.hypot(
              cloud.positions[i * 3],
              cloud.positions[i * 3 + 1],
              cloud.positions[i * 3 + 2],
            ),
          ).toBeLessThanOrEqual(de.visibleBoundingRadius);
        }
      }
    }
    expect(nontrivial).toBeGreaterThan(20);
  });

  it("4D uses w in the inverse angle, respects post4 and refuses every nonzero slab", () => {
    const foldBase = pentatope().map((t) => ({
      ...t,
      scale: [0.15, 0.15, 0.15] as Vec3,
      w: { ...t.w, scale: 0.15 },
      variations: [{ type: "boxfold" as const, weight: 0.8 }],
    }));
    const rng = mulberry32(0x452);
    let nontrivial = 0;
    for (const transforms of [pentatope(), foldBase]) {
      const raw = buildSurfaceDE4(transforms);
      for (const weight of [-2, 0.7]) {
        const final: Transform = {
          ...swirlFinal(weight),
          w: { scale: 0.05, position: 0.03, rotation: { xw: 0.25 } },
          post: {
            m: [0.6, 0.04, 0, 0, 0.7, 0.02, 0, 0, 0.8],
            t: [0.04, -0.01, 0.02],
          },
        };
        const lifted = toTransform4(final);
        const de = buildSurfaceDE4(transforms, final);
        const affine = composeAffine4(lifted);
        const forward = composeVariations4(final.variations)!;
        const sigma = transformSeparatedSigmas4(lifted).min;
        expect(slabExact4(de)).toBe(false);
        expect(() =>
          estimateDistance4(de, [0, 0, 0, 0], [0, 0, 0, 0.01]),
        ).toThrow(/nonlinear final lens/);
        expect(() =>
          estimateDistance4Refined(de, [0, 0, 0, 0], 0, [0.01, 0, 0, 0]),
        ).toThrow(/nonlinear final lens/);
        for (let i = 0; i < 80; i++) {
          const q: Vec4 = [
            (rng() - 0.5) * raw.boundingRadius * 2,
            (rng() - 0.5) * raw.boundingRadius * 2,
            (rng() - 0.5) * raw.boundingRadius * 2,
            (rng() - 0.5) * raw.boundingRadius * 2,
          ];
          const pre = applyAffine4(affine, ...q);
          const varied = forward(...pre, rng);
          const p = applyAffine4(lifted.post4!, ...varied);
          const factor =
            (Math.abs(weight) * sigma) / de.foldFinal!.swirlLipschitz!;
          for (const estimate of [
            estimateDistance4,
            estimateDistance4Refined,
          ]) {
            const expected = Math.max(
              Math.hypot(...p) - de.visibleBoundingRadius,
              factor * estimate(raw, q),
            );
            expect(estimate(de, p)).toBeCloseTo(expected, 10);
            const hitEps = 0.003;
            const rawHit =
              Math.max(
                Math.hypot(...p) - de.visibleBoundingRadius,
                Math.abs(weight) * sigma * estimate(raw, q),
              ) < hitEps;
            const compensatedHit =
              estimate(de, p) < hitEps * surfaceSwirlAcceptanceScale(de);
            if (compensatedHit) expect(rawHit).toBe(true);
            if (Math.hypot(...p) <= de.visibleBoundingRadius)
              expect(compensatedHit).toBe(rawHit);
            if (expected > 1e-6 && expected === factor * estimate(raw, q))
              nontrivial++;
          }
          expect(estimateDistance4(de, p, [0, 0, 0, 0])).toBe(
            estimateDistance4(de, p),
          );
          const expected = estimateDistance4Refined(de, p);
          const capped = estimateDistance4Refined(de, p, 0.0001);
          expect(capped >= 0.0001 ? capped : 0).toBeCloseTo(
            expected >= 0.0001 ? expected : 0,
            10,
          );
        }
        const cloud = runChaosGame4(
          transforms.map(toTransform4),
          2048,
          rng,
          lifted,
        );
        for (let i = 0; i < cloud.count; i++) {
          expect(
            Math.hypot(
              cloud.positions[i * 3],
              cloud.positions[i * 3 + 1],
              cloud.positions[i * 3 + 2],
              cloud.w[i],
            ),
          ).toBeLessThanOrEqual(de.visibleBoundingRadius);
        }
      }
    }
    expect(nontrivial).toBeGreaterThan(20);
  });
});
