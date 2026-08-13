import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  estimateEscapeDistance,
} from "./escape-de";
import { mandelboxClassic, mandelboxCube, mandelboxRings } from "./presets";
import { analyzeSurfaceSystem, SURFACE_FOLD_MANDELBOX } from "./surface-de";
import type { Transform, Vec3 } from "./types";

/** The canonical single-map Mandelbox shape: identity-scale affine with an
 * offset, mandelbox variation at the classic weight 2 — exactly the
 * parameterization the IFS surface gate refuses as non-contracting. */
function canonicalMandelbox(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    ...overrides,
  };
}

describe("analyzeEscapeSystem eligibility (fr-kltj)", () => {
  it("admits the canonical non-contracting single-map mandelbox", () => {
    const analysis = analyzeEscapeSystem([canonicalMandelbox()]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("refuses a CONTRACTING fold map — the attractor surface render owns it", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox({
        scale: [0.1, 0.1, 0.1],
        variations: [{ type: "mandelbox", weight: 1 }],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual([
      "the map contracts (the attractor surface render owns it)",
    ]);
  });

  it("is the exact complement of the IFS gate across the contraction line", () => {
    // Sweep the fold weight through the CONTRACTION_LIMIT crossing: at
    // every point exactly ONE of the two analyses should admit the map.
    for (const weight of [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2]) {
      const system = [
        canonicalMandelbox({
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "mandelbox", weight }],
        }),
      ];
      const ifs = analyzeSurfaceSystem(system);
      const escape = analyzeEscapeSystem(system);
      expect(ifs.status !== "ineligible" || escape.status === "eligible").toBe(
        true,
      );
      expect(
        ifs.status === "ineligible" || escape.status === "ineligible",
      ).toBe(true);
    }
  });

  it("refuses multi-map systems", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1 }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual([
      "more than one active map (escape-time sets are single-map)",
    ]);
  });

  it("treats extra weight-0 maps as inert", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, weight: 0 }),
    ]);
    expect(analysis.status).toBe("eligible");
  });

  it("refuses blends, non-fold variations, finals and kaleidoscopes", () => {
    expect(
      analyzeEscapeSystem([
        canonicalMandelbox({
          variations: [
            { type: "mandelbox", weight: 2 },
            { type: "linear", weight: 0.2 },
          ],
        }),
      ]).reasons,
    ).toEqual(["the map is not a pure fold"]);

    expect(
      analyzeEscapeSystem([
        canonicalMandelbox({ variations: [{ type: "swirl", weight: 2 }] }),
      ]).reasons,
    ).toEqual(["the map is not a pure fold"]);

    expect(
      analyzeEscapeSystem(
        [canonicalMandelbox()],
        canonicalMandelbox({ id: 9, variations: undefined }),
      ).reasons,
    ).toEqual(["final transform (unsupported in escape-time mode)"]);

    expect(
      analyzeEscapeSystem([canonicalMandelbox()], null, {
        order: 3,
        plane: "xz",
      }).reasons,
    ).toEqual(["kaleidoscope symmetry (unsupported in escape-time mode)"]);
  });

  it("refuses a 4D map", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox({ w: { position: 0.4 } }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["the map extends into 4D"]);
  });
});

describe("buildEscapeDE (fr-kltj)", () => {
  it("carries the forward affine, the signed weight, and the derivative growth", () => {
    const de = buildEscapeDE([
      canonicalMandelbox({
        scale: [1.5, 1.5, 1.5],
        variations: [{ type: "mandelbox", weight: -2 }],
      }),
    ]);
    expect(de.foldKind).toBe(SURFACE_FOLD_MANDELBOX);
    expect(de.w).toBe(-2);
    expect(de.derivGrowth).toBeCloseTo(2 * 1.5, 12);
    expect(de.t).toEqual([0.4, 0.3, 0.2]);
    expect(de.boundingRadius).toBe(ESCAPE_TIME_RADIUS);
  });

  it("throws on an ineligible system", () => {
    expect(() =>
      buildEscapeDE([canonicalMandelbox(), canonicalMandelbox({ id: 1 })]),
    ).toThrow(/no escape-time estimator/);
  });
});

describe("estimateEscapeDistance (fr-kltj)", () => {
  it("reads 0 at a fixed point of the iteration — the inside signal", () => {
    // With t = 0 the origin maps to itself forever; dr grows but |v| = 0.
    const de = buildEscapeDE([canonicalMandelbox({ position: [0, 0, 0] })]);
    expect(estimateEscapeDistance(de, [0, 0, 0])).toBe(0);
  });

  it("returns the plain radius for a query already past the bailout", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const p: Vec3 = [ESCAPE_TIME_RADIUS + 2, 0, 0];
    // The loop never runs (r > bailout at entry), so DE = |p| / 1.
    expect(estimateEscapeDistance(de, p)).toBe(ESCAPE_TIME_RADIUS + 2);
  });

  it("returns positive finite estimates across a probe grid", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    for (let i = 0; i < 50; i++) {
      const p: Vec3 = [
        Math.sin(i * 1.7) * 2,
        Math.cos(i * 2.3) * 2,
        Math.sin(i * 0.9 + 1) * 2,
      ];
      const d = estimateEscapeDistance(de, p);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("honors the iteration clamp the preview tier passes", () => {
    const de = buildEscapeDE([canonicalMandelbox({ position: [0, 0, 0] })]);
    // Near the origin the orbit needs many iterations to escape (if ever):
    // a shallower clamp must settle the estimate with a SMALLER dr, so the
    // clamped estimate is at least the full one.
    const p: Vec3 = [0.01, 0.005, -0.02];
    const shallow = estimateEscapeDistance(de, p, 4);
    const full = estimateEscapeDistance(de, p, ESCAPE_TIME_ITERATIONS);
    expect(shallow).toBeGreaterThanOrEqual(full);
  });

  it("is deterministic", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const p: Vec3 = [0.3, -0.7, 0.4];
    expect(estimateEscapeDistance(de, p)).toBe(estimateEscapeDistance(de, p));
  });
});

describe("the escape-time presets (fr-7u8t.8)", () => {
  // These three exist to make the mode reachable, and they reach it only by
  // being refused by the IFS gate — a preset that quietly became contracting
  // would land in the attractor tracer and render an empty point, with
  // nothing anywhere saying why.
  it.each([
    ["mandelboxClassic", mandelboxClassic()],
    ["mandelboxRings", mandelboxRings()],
    ["mandelboxCube", mandelboxCube()],
  ])(
    "%s is refused by the IFS gate and admitted by the escape gate",
    (_name, transforms) => {
      expect(analyzeSurfaceSystem(transforms).status).toBe("ineligible");
      expect(analyzeEscapeSystem(transforms)).toEqual({
        status: "eligible",
        reasons: [],
      });
    },
  );

  it("renders three DIFFERENT objects — the fold weight is the family's knob", () => {
    // Ball fill measured by scripts/escape-form-sweep.harness.ts: 10.6% /
    // 2.8% / 17.7%. Collapse the weights onto one value and this fails.
    const fill = (transforms: Transform[]): number => {
      const de = buildEscapeDE(transforms);
      const N = 17;
      let inBall = 0;
      let interior = 0;
      const step = (2 * ESCAPE_TIME_RADIUS) / (N - 1);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const p: Vec3 = [
              -ESCAPE_TIME_RADIUS + step * i,
              -ESCAPE_TIME_RADIUS + step * j,
              -ESCAPE_TIME_RADIUS + step * k,
            ];
            if (Math.hypot(p[0], p[1], p[2]) > ESCAPE_TIME_RADIUS) continue;
            inBall++;
            if (estimateEscapeDistance(de, p) < 1e-3) interior++;
          }
        }
      }
      return interior / inBall;
    };
    const [ball, rings, cube] = [
      fill(mandelboxClassic()),
      fill(mandelboxRings()),
      fill(mandelboxCube()),
    ];
    // Each is non-empty (a preset that renders nothing is worse than no
    // preset) and each is a distinctly different amount of solid.
    for (const f of [ball, rings, cube]) {
      expect(f).toBeGreaterThan(0.01);
      expect(f).toBeLessThan(0.3);
    }
    expect(rings).toBeLessThan(ball);
    expect(ball).toBeLessThan(cube);
  });
});

describe("the Mandelbrot form (fr-7u8t.8)", () => {
  it("adds the QUERY POINT as the per-iteration offset, not the document's t", () => {
    // One iteration of a box fold at weight 2, t = 0, hand-computed:
    //   fold  = 2·clamp(1.2, -1, 1) - 1.2 = 0.8   (local factor 1)
    //   v     = w·fold + p = 2(0.8) + 1.2 = 2.8   <- the +p under test
    //   dr    = |w|·sigma_max(M)·1·dr + 1 = 2(1)(1) + 1 = 3
    // Drop the offset and this reads 1.6/3 — the shipped fr-kltj value.
    const de = buildEscapeDE([
      canonicalMandelbox({
        position: [0, 0, 0],
        variations: [{ type: "boxfold", weight: 2 }],
      }),
    ]);
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 1)).toBeCloseTo(2.8 / 3, 12);
  });

  it("leaves most of the bounding ball OUTSIDE the object — the fr-7u8t.8 bug", () => {
    // The defect this form fixes: the Julia-form set at an authored constant
    // filled 96% of its own marching ball, so the escape mode rendered its
    // bounding sphere. Probe the same fixture on a deterministic grid and
    // count the marcher's own view of inside (a DE collapsed by a runaway
    // dr). Measured here: ~11%. Restore the fixed offset and it reads 96%.
    const de = buildEscapeDE([canonicalMandelbox()]);
    const N = 21;
    let inBall = 0;
    let interior = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          const step = (2 * ESCAPE_TIME_RADIUS) / (N - 1);
          const p: Vec3 = [
            -ESCAPE_TIME_RADIUS + step * i,
            -ESCAPE_TIME_RADIUS + step * j,
            -ESCAPE_TIME_RADIUS + step * k,
          ];
          if (Math.hypot(p[0], p[1], p[2]) > ESCAPE_TIME_RADIUS) continue;
          inBall++;
          if (estimateEscapeDistance(de, p) < 1e-3) interior++;
        }
      }
    }
    expect(interior / inBall).toBeLessThan(0.3);
  });
});
