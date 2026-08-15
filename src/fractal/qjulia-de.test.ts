import {
  analyzeQJuliaSystem,
  buildQJuliaDE,
  estimateQJuliaDistance,
  QJULIA_STEP_SCALE,
  systemHasActiveQSquare,
} from "./qjulia-de";
import type { Transform, Vec4 } from "./types";

/** A single pure quaternion square whose translation is the Julia constant. */
function qjuliaSystem(c: Vec4, extra: Partial<Transform> = {}): Transform {
  return {
    id: 1,
    position: [c[0], c[1], c[2]],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "qsquare", weight: 1 }],
    ...(c[3] === 0 ? {} : { w: { position: c[3], scale: 1 } }),
    ...extra,
  };
}

/**
 * Independent reference: does `q -> q² + c` escape from `q0`? This is the
 * defining membership test for the classic set, written from the textbook
 * form rather than from anything the module under test does.
 */
function classicEscapes(q0: Vec4, c: Vec4, budget: number, bail = 64): boolean {
  let [x, y, z, w] = q0;
  for (let i = 0; i < budget; i++) {
    const sx = x * x - (y * y + z * z + w * w);
    const sy = 2 * x * y;
    const sz = 2 * x * z;
    const sw = 2 * x * w;
    x = sx + c[0];
    y = sy + c[1];
    z = sz + c[2];
    w = sw + c[3];
    if (Math.hypot(x, y, z, w) > bail) return true;
  }
  return false;
}

/** Deterministic LCG so every query set in this file is reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("analyzeQJuliaSystem", () => {
  it("admits a lone pure quaternion square", () => {
    const analysis = analyzeQJuliaSystem([qjuliaSystem([-0.2, 0.6, 0.2, 0])]);

    expect(analysis).toEqual({ status: "eligible", reasons: [] });
  });

  it("refuses a fold map, leaving it to the escape-time renderer", () => {
    const fold: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight: 2.2 }],
    };

    const analysis = analyzeQJuliaSystem([fold]);

    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toContain(
      "the map is not a pure quaternion square",
    );
  });

  it("refuses a second active map", () => {
    const c: Vec4 = [-0.2, 0.6, 0.2, 0];
    const analysis = analyzeQJuliaSystem([
      qjuliaSystem(c),
      { ...qjuliaSystem(c), id: 2 },
    ]);

    expect(analysis.reasons).toContain(
      "more than one active map (quaternion Julia sets are single-map)",
    );
  });

  it("refuses a kaleidoscope", () => {
    const analysis = analyzeQJuliaSystem(
      [qjuliaSystem([-0.2, 0.6, 0.2, 0])],
      null,
      { order: 4, plane: "xz" },
    );

    expect(analysis.reasons).toContain(
      "kaleidoscope symmetry (unsupported in quaternion Julia mode)",
    );
  });

  it("refuses a variation weight other than 1, which would render a different set", () => {
    const scaled = qjuliaSystem([-0.2, 0.6, 0.2, 0], {
      variations: [{ type: "qsquare", weight: 0.5 }],
    });

    const analysis = analyzeQJuliaSystem([scaled]);

    expect(analysis.reasons).toContain(
      "the quaternion square's weight must be 1 (scale the map instead)",
    );
  });

  it("refuses a singular map, which has no escape radius", () => {
    const flattened = qjuliaSystem([-0.2, 0.6, 0.2, 0], { scale: [1, 0, 1] });

    const analysis = analyzeQJuliaSystem([flattened]);

    expect(analysis.reasons).toContain(
      "the map is singular (zero scale on some axis)",
    );
  });
});

describe("systemHasActiveQSquare", () => {
  it("is false for a system with no qsquare variation anywhere", () => {
    const spherical: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "spherical", weight: 1 }],
    };

    expect(systemHasActiveQSquare([spherical])).toBe(false);
  });

  it("is true for a lone active qsquare map", () => {
    const map: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "qsquare", weight: 1 }],
    };

    expect(systemHasActiveQSquare([map])).toBe(true);
  });

  it("is true when qsquare is blended with other variations on the same map", () => {
    // Broader than the eligibility gate's pure-map requirement on purpose:
    // this predicate is asking whether the refusal reason should name
    // qsquare, not whether the quaternion-Julia estimator applies.
    const blended: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [
        { type: "qsquare", weight: 0.5 },
        { type: "spherical", weight: 0.5 },
      ],
    };

    expect(systemHasActiveQSquare([blended])).toBe(true);
  });

  it("is true when only one of several maps carries an active qsquare", () => {
    const plain: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "linear", weight: 1 }],
    };
    const qsquareMap: Transform = {
      id: 2,
      position: [0.3, -0.1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "qsquare", weight: 1 }],
    };

    expect(systemHasActiveQSquare([plain, qsquareMap])).toBe(true);
  });

  it("ignores a qsquare variation on a map whose own weight is 0", () => {
    const disabledMap: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      weight: 0,
      variations: [{ type: "qsquare", weight: 1 }],
    };

    expect(systemHasActiveQSquare([disabledMap])).toBe(false);
  });

  it("ignores a qsquare entry whose own variation weight is 0", () => {
    const zeroWeightVariation: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [
        { type: "qsquare", weight: 0 },
        { type: "linear", weight: 1 },
      ],
    };

    expect(systemHasActiveQSquare([zeroWeightVariation])).toBe(false);
  });

  it("is true for an active qsquare on the final transform", () => {
    const linearMap: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const finalTransform: Transform = {
      id: 2,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "qsquare", weight: 1 }],
    };

    expect(systemHasActiveQSquare([linearMap], finalTransform)).toBe(true);
  });

  it("ignores an inactive qsquare on the final transform", () => {
    const linearMap: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const finalTransform: Transform = {
      id: 2,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "qsquare", weight: 0 }],
    };

    expect(systemHasActiveQSquare([linearMap], finalTransform)).toBe(false);
  });
});

describe("buildQJuliaDE", () => {
  it("reads the transform's translation as the Julia constant", () => {
    const de = buildQJuliaDE([qjuliaSystem([-0.2, 0.6, 0.2, 0.1])]);

    expect(de.t).toEqual([-0.2, 0.6, 0.2, 0.1]);
  });

  it("calls a rotation-only map conformal, which is what licenses the full step scale", () => {
    const rotated = qjuliaSystem([-0.2, 0.6, 0.2, 0], {
      rotation: [0.3, -0.7, 1.1],
    });

    const de = buildQJuliaDE([rotated]);

    expect(de.conformal).toBe(true);
    expect(de.sigmaMax).toBeCloseTo(1, 12);
  });

  it("calls an anisotropically scaled map non-conformal", () => {
    const squashed = qjuliaSystem([-0.2, 0.6, 0.2, 0], { scale: [1, 0.6, 1] });

    expect(buildQJuliaDE([squashed]).conformal).toBe(false);
  });

  it("bounds the set inside its bounding radius", () => {
    const c: Vec4 = [-0.2, 0.6, 0.2, 0];
    const de = buildQJuliaDE([qjuliaSystem(c)]);
    const rng = seeded(31);

    // The rendered set is the classic set translated by -c (module doc), so a
    // query p is in it exactly when p + c does not escape.
    let outsideBall = 0;
    for (let i = 0; i < 20000; i++) {
      const p: Vec4 = [
        rng() * 8 - 4,
        rng() * 8 - 4,
        rng() * 8 - 4,
        rng() * 8 - 4,
      ];
      const q: Vec4 = [p[0] + c[0], p[1] + c[1], p[2] + c[2], p[3] + c[3]];
      if (!classicEscapes(q, c, 200) && Math.hypot(...p) > de.boundingRadius) {
        outsideBall++;
      }
    }

    expect(outsideBall).toBe(0);
  });
});

describe("estimateQJuliaDistance", () => {
  it("renders the classic set translated by -c (the conjugacy the module is built on)", () => {
    const c: Vec4 = [-0.2, 0.6, 0.2, 0];
    const de = buildQJuliaDE([qjuliaSystem(c)]);
    const rng = seeded(7);

    // Membership through the estimator must agree with the independent
    // textbook orbit at the translated point, for every query where the
    // estimator commits (a zero estimate is the inside signal).
    let disagreements = 0;
    let inside = 0;
    for (let i = 0; i < 5000; i++) {
      const p: Vec4 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2, 0];
      const q: Vec4 = [p[0] + c[0], p[1] + c[1], p[2] + c[2], c[3]];
      const estimatedInside = estimateQJuliaDistance(de, p) === 0;
      if (estimatedInside) inside++;
      // Points very near the boundary legitimately differ: the estimator runs
      // 30 iterations, the reference 200. Only count disagreements where the
      // estimator claims a comfortable distance yet the reference says inside.
      if (!classicEscapes(q, c, 200) && estimateQJuliaDistance(de, p) > 0.05) {
        disagreements++;
      }
    }

    expect(inside).toBeGreaterThan(100);
    expect(disagreements).toBe(0);
  });

  it("never overshoots at the full step scale, for every c", () => {
    // The module's headline claim: the conformal estimate needs no damping,
    // unlike the fold marchers' 0.7. A step of QJULIA_STEP_SCALE * DE from a
    // query must never land inside the set.
    const constants: Vec4[] = [
      [-0.2, 0.6, 0.2, 0],
      [-0.45, 0.3, -0.2, 0],
      [-0.3, 0.4, 0.3, 0.2],
    ];

    for (const c of constants) {
      const de = buildQJuliaDE([qjuliaSystem(c)]);
      const rng = seeded(99);
      let overshoots = 0;
      let probed = 0;

      for (let i = 0; i < 1500; i++) {
        const p: Vec4 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2, 0];
        const d = estimateQJuliaDistance(de, p);
        if (!(d > 1e-4 && d < 1.5)) continue;
        probed++;
        for (let k = 0; k < 16; k++) {
          const a = rng() * 2 - 1;
          const b = rng() * 2 - 1;
          const e = rng() * 2 - 1;
          const n = Math.hypot(a, b, e) || 1;
          const s = (QJULIA_STEP_SCALE * d) / n;
          const step: Vec4 = [p[0] + a * s, p[1] + b * s, p[2] + e * s, 0];
          const q: Vec4 = [
            step[0] + c[0],
            step[1] + c[1],
            step[2] + c[2],
            c[3],
          ];
          if (!classicEscapes(q, c, 200)) {
            overshoots++;
            break;
          }
        }
      }

      expect(probed).toBeGreaterThan(500);
      expect(overshoots).toBe(0);
    }
  });

  it("never overshoots when the map carries a scale, not just a rotation", () => {
    // sigma_max rides the derivative recurrence, and every identity-or-rotation
    // fixture has sigma_max = 1 — where dropping it entirely is a no-op. A
    // uniformly scaled map is the case that actually exercises the term.
    // s > 1 is the direction that matters: dropping sigma_max there SHRINKS
    // dr, inflates the estimate, and overshoots. The constant is picked so
    // the conjugated constant `s·c` is the well-inside (-0.2, 0.6) — scaling
    // MOVES the Julia constant (module doc), and a naive s·c lands outside
    // the connectedness locus, leaving an empty interior and a vacuous test.
    const c: Vec4 = [-0.16, 0.48, 0, 0];
    const s = 1.25;
    const scaled = qjuliaSystem(c, { scale: [s, s, s], w: { scale: s } });
    const de = buildQJuliaDE([scaled]);
    const rng = seeded(1234);

    /** The textbook orbit for `y <- s·y² + t`, started at `y0 = s·p + t`. */
    const escapesScaled = (p: Vec4): boolean => {
      let [x, y, z, w] = [
        s * p[0] + c[0],
        s * p[1] + c[1],
        s * p[2] + c[2],
        s * p[3] + c[3],
      ];
      for (let i = 0; i < 200; i++) {
        const sx = x * x - (y * y + z * z + w * w);
        const sy = 2 * x * y;
        const sz = 2 * x * z;
        const sw = 2 * x * w;
        x = s * sx + c[0];
        y = s * sy + c[1];
        z = s * sz + c[2];
        w = s * sw + c[3];
        if (Math.hypot(x, y, z, w) > 64) return true;
      }
      return false;
    };

    expect(de.sigmaMax).toBeCloseTo(s, 12);

    let overshoots = 0;
    let probed = 0;
    let interior = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Vec4 = [
        rng() * 2.4 - 1.2,
        rng() * 2.4 - 1.2,
        rng() * 2.4 - 1.2,
        0,
      ];
      if (!escapesScaled(p)) interior++;
      const d = estimateQJuliaDistance(de, p);
      if (!(d > 1e-4 && d < 1.5)) continue;
      probed++;
      for (let k = 0; k < 16; k++) {
        const a = rng() * 2 - 1;
        const b = rng() * 2 - 1;
        const e = rng() * 2 - 1;
        const n = Math.hypot(a, b, e) || 1;
        const step = (QJULIA_STEP_SCALE * d) / n;
        if (
          !escapesScaled([p[0] + a * step, p[1] + b * step, p[2] + e * step, 0])
        ) {
          overshoots++;
          break;
        }
      }
    }

    // Guard the guard: a degenerate scale would empty the set and make the
    // overshoot count vacuously zero.
    expect(interior).toBeGreaterThan(50);
    expect(probed).toBeGreaterThan(500);
    expect(overshoots).toBe(0);
  });

  it("never returns a negative distance, however the orbit converges", () => {
    // ln|y| goes negative below |y| = 1, which a converging orbit reaches.
    const de = buildQJuliaDE([qjuliaSystem([-0.2, 0.6, 0.2, 0])]);
    const rng = seeded(4242);

    let min = Infinity;
    for (let i = 0; i < 20000; i++) {
      const p: Vec4 = [
        rng() * 6 - 3,
        rng() * 6 - 3,
        rng() * 6 - 3,
        rng() * 6 - 3,
      ];
      min = Math.min(min, estimateQJuliaDistance(de, p));
    }

    expect(min).toBe(0);
    expect(min).not.toBeLessThan(0);
  });

  it("honours the preview tier's depth clamp", () => {
    const de = buildQJuliaDE([qjuliaSystem([-0.2, 0.6, 0.2, 0])]);
    const p: Vec4 = [0.9, 0.4, 0.1, 0];

    // A shallower budget can only stop the orbit earlier, so the estimate is
    // larger (less converged), never smaller — the same monotonicity the fold
    // descents' maxDepth clamp has.
    expect(estimateQJuliaDistance(de, p, 4)).toBeGreaterThanOrEqual(
      estimateQJuliaDistance(de, p, 30),
    );
  });
});
