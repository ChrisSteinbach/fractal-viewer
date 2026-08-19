import {
  balloonClearsGridBox,
  buildSurfaceGrid,
  buildSurfaceGridSlab,
  floorToF32,
  pickSurfaceGridResolution,
  surfaceGridEstimator,
  surfaceGridSpec,
} from "./surface-grid";
import { BALLOON_RHO_MARGIN, buildBalloon } from "./balloon-de";
import type { Balloon } from "./balloon-de";
import type { SurfaceGrid, SurfaceGridSpec } from "./surface-grid";
import { buildSurfaceDE } from "./surface-de";
import { runChaosGame } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Vec3 } from "./types";

/** Sierpinski tetrahedron with an anisotropic y-scale (0.25 instead of the
 * uniform 0.5) — mirrors `surface-de.test.ts`'s own `anisotropicSierpinski`,
 * duplicated locally since that file's helpers are not exported. The class
 * where deep certificates behave worst, per that module's doc. */
function anisotropicSierpinski(): Transform[] {
  return sierpinskiTetrahedron().map((t): Transform => ({
    ...t,
    scale: [0.5, 0.25, 0.5],
  }));
}

/** Both maps pure `boxfold`: 27 branches each, every one a reflection +
 * translation isometry (sigma_c = 1) — mirrors `scripts/harness-profiles.ts`'s
 * `foldBoxfoldPair` (itself extracted verbatim from `surface-de.test.ts`'s
 * `pureBoxfoldPair`), duplicated locally since that module sits outside the
 * `src/` program's `rootDir` — importing it here would break `tsc --noEmit`
 * (`npm run lint`'s first step) with a TS6059 rootDir violation. A small,
 * already-validated pure-fold system for the estimator-parameter tests
 * below. */
function foldBoxfoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** Flat index into a `resolution`-cube {@link SurfaceGrid.values}, matching
 * the module's own `x + resolution * (y + resolution * z)` layout. */
function cellIndex(
  resolution: number,
  ix: number,
  iy: number,
  iz: number,
): number {
  return ix + resolution * (iy + resolution * iz);
}

/** Cell axis index nearest `coord`, clamped to a valid `[0, resolution)`
 * slot — a point exactly on (or numerically just past) the cube's boundary
 * still lands in its edge cell instead of falling off the array. */
function clampIndex(i: number, resolution: number): number {
  return Math.min(resolution - 1, Math.max(0, i));
}

/** Flat index of the cell containing point `p` of `grid`. */
function containingCell(grid: SurfaceGrid, p: Vec3): number {
  const { resolution, halfExtent } = grid;
  const cell = (2 * halfExtent) / resolution;
  const ix = clampIndex(Math.floor((p[0] + halfExtent) / cell), resolution);
  const iy = clampIndex(Math.floor((p[1] + halfExtent) / cell), resolution);
  const iz = clampIndex(Math.floor((p[2] + halfExtent) / cell), resolution);
  return cellIndex(resolution, ix, iy, iz);
}

/** Brute-force nearest distance from `p` to any point of a sampled cloud —
 * an upper bound on the true attractor distance, checked below against the
 * grid's conservative lower bound. Independent of the module under test,
 * mirroring `surface-de.test.ts`'s own `nearestDistance`. */
function nearestDistance(cloud: ChaosGameResult, p: Vec3): number {
  let best = Infinity;
  const { positions, count } = cloud;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - p[0];
    const dy = positions[i * 3 + 1] - p[1];
    const dz = positions[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Uniform-random point inside grid cell `(ix, iy, iz)` of `spec`. */
function randomPointInCell(
  spec: SurfaceGridSpec,
  ix: number,
  iy: number,
  iz: number,
  rng: () => number,
): Vec3 {
  const cell = (2 * spec.halfExtent) / spec.resolution;
  const cx = -spec.halfExtent + (ix + 0.5) * cell;
  const cy = -spec.halfExtent + (iy + 0.5) * cell;
  const cz = -spec.halfExtent + (iz + 0.5) * cell;
  return [
    cx + (rng() - 0.5) * cell,
    cy + (rng() - 0.5) * cell,
    cz + (rng() - 0.5) * cell,
  ];
}

/**
 * The module's core conservativeness claim, brute-forced against a sampled
 * cloud: every POSITIVE stored floor must be `<=` the true nearest-cloud
 * distance from a random point drawn from inside that floor's own cell (a
 * cloud sample upper-bounds the true attractor distance, and a positive
 * floor lower-bounds it — see `surface-grid.ts`'s module doc). Draws random
 * cells until `targetDraws` positive ones have been exercised or
 * `maxAttempts` random cells have been tried; returns how many positive
 * draws it actually managed, so callers can assert that count stays well
 * clear of zero — the check would pass vacuously against an all-zero grid
 * otherwise.
 */
function checkStoredFloorsAgainstCloud(
  grid: SurfaceGrid,
  cloud: ChaosGameResult,
  rng: () => number,
  targetDraws = 150,
  maxAttempts = 20000,
): number {
  const { resolution, values } = grid;
  let positiveDraws = 0;
  for (
    let attempt = 0;
    attempt < maxAttempts && positiveDraws < targetDraws;
    attempt++
  ) {
    const ix = Math.floor(rng() * resolution);
    const iy = Math.floor(rng() * resolution);
    const iz = Math.floor(rng() * resolution);
    const stored = values[cellIndex(resolution, ix, iy, iz)];
    if (stored <= 0) continue;
    positiveDraws++;
    const p = randomPointInCell(grid, ix, iy, iz, rng);
    expect(stored).toBeLessThanOrEqual(nearestDistance(cloud, p));
  }
  return positiveDraws;
}

describe("surfaceGridSpec", () => {
  it("sizes the cube to cover everything the tracer can sample", () => {
    const plain = buildSurfaceDE(sierpinskiTetrahedron());
    expect(surfaceGridSpec(plain, 8).halfExtent).toBe(
      plain.visibleBoundingRadius * 1.03,
    );

    // A modest expanding final-transform lens: visibleBoundingRadius then
    // grows past the raw attractor's boundingRadius, and the spec has to
    // track the VISIBLE radius, not the raw one.
    const finalTransform: Transform = {
      id: 99,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [1.2, 1.2, 1.2],
    };
    const lensed = buildSurfaceDE(sierpinskiTetrahedron(), finalTransform);
    expect(lensed.visibleBoundingRadius).toBeGreaterThan(lensed.boundingRadius);
    expect(surfaceGridSpec(lensed, 8).halfExtent).toBe(
      lensed.visibleBoundingRadius * 1.03,
    );
  });
});

describe("floorToF32", () => {
  it("never exceeds its input and stays within one ulp", () => {
    const scratchF32 = new Float32Array(1);
    const scratchU32 = new Uint32Array(scratchF32.buffer);
    /** Float32 bit-pattern successor of `f` — the step opposite
     * `floorToF32`'s internal one-ulp-down, used only here to pin the
     * "within one ulp" property independently of that implementation: by
     * construction, the largest float32 `<= v` has no other float32
     * between it and `v`, so `v` must be strictly less than that value's
     * successor. */
    function nextF32(f: number): number {
      scratchF32[0] = f;
      scratchU32[0] += 1;
      return scratchF32[0];
    }

    const values = [0, 1e-40, 1 / 3, Math.PI, 1e6 * (1 / 3), 0.5];
    for (const v of values) {
      const floored = floorToF32(v);
      expect(floored).toBeLessThanOrEqual(v);
      expect(Math.fround(floored)).toBe(floored);
      expect(v).toBeLessThan(nextF32(floored));
    }
  });
});

describe("stored floors never exceed the true distance", () => {
  it("holds against a brute-force nearest-cloud-point check on sierpinskiTetrahedron", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(2024),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });
});

describe("stored floors stay conservative on harder systems", () => {
  it("holds on an anisotropic sierpinski (scale [0.5, 0.25, 0.5]), the class where deep certificates behave worst", () => {
    const transforms = anisotropicSierpinski();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(4242),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });

  it("holds on a kaleidoscope build (order 3, axis z)", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, plane: "xy" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(5150),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });
});

describe("cells containing attractor samples", () => {
  it("store exactly 0", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(3));
    const grid = buildSurfaceGrid(de, 12);
    for (let i = 0; i < 200; i++) {
      const idx = Math.floor((i / 200) * cloud.count);
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      // Their center is within cellRadius of the attractor (the sample
      // itself sits inside the cell), so the descent's value cannot clear
      // the cutoff — equality at the boundary also lands 0 (see the module
      // doc's cutoff paragraph).
      expect(grid.values[containingCell(grid, p)]).toBe(0);
    }
  });
});

describe("the central void", () => {
  it("stores a positive skip at resolution 12", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const grid = buildSurfaceGrid(de, 12);
    // The centroid void `estimateDistance` is pinned against directly in
    // surface-de.test.ts ("crosses the central void rather than stalling
    // at a non-positive bound"): [0, -0.1, 0]. Pinning a positive value
    // here — not just checking >= 0 — is what keeps this test from passing
    // against a grid of all zeros.
    const idx = containingCell(grid, [0, -0.1, 0]);
    expect(grid.values[idx]).toBeGreaterThan(0);
  });
});

describe("slab builds", () => {
  it("compose to the full build bit for bit", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const resolution = 8;
    const spec = surfaceGridSpec(de, resolution);
    const full = buildSurfaceGrid(de, resolution);

    const slabbed = new Float32Array(resolution ** 3);
    buildSurfaceGridSlab(de, spec, 0, 3, slabbed);
    buildSurfaceGridSlab(de, spec, 3, 8, slabbed);

    expect(Array.from(slabbed)).toEqual(Array.from(full.values));
  });
});

describe("cells fully outside the traced sphere", () => {
  it("store 0 without costing a descent", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const resolution = 8;
    const grid = buildSurfaceGrid(de, resolution);
    const r = resolution - 1;
    // The design (skipping the estimator call entirely for these cells) is
    // not observable from the stored value alone — pinned in the module
    // doc instead — so this only asserts the value every outer-corner cell
    // has to land on regardless.
    const corners: Array<[number, number, number]> = [
      [0, 0, 0],
      [r, 0, 0],
      [0, r, 0],
      [0, 0, r],
      [r, r, r],
    ];
    for (const [x, y, z] of corners) {
      expect(grid.values[cellIndex(resolution, x, y, z)]).toBe(0);
    }
  });
});

describe("buildSurfaceGrid", () => {
  it("is deterministic", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const a = buildSurfaceGrid(de, 8);
    const b = buildSurfaceGrid(de, 8);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });
});

// -----------------------------------------------------------------------
// The `estimator` parameter (measurement infrastructure for the
// fold-system grid-build cost; see scripts/surface-grid-cost.harness.ts).
// "plain" must stay a SOUND — if weaker — lower bound on every fold system,
// exactly like "refined". The DEFAULT is no longer flatly "refined": it now
// follows surfaceGridEstimator's per-system choice (affine -> "refined",
// the original behavior; fold -> "plain", the newer one, so fold builds
// stay inside budget).
// -----------------------------------------------------------------------

describe("surfaceGridEstimator", () => {
  it('picks "refined" for an affine system', () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(surfaceGridEstimator(de)).toBe("refined");
  });

  it('picks "plain" for a fold system', () => {
    const de = buildSurfaceDE(foldBoxfoldPair());
    expect(surfaceGridEstimator(de)).toBe("plain");
  });
});

describe("the estimator parameter", () => {
  // Affine systems keep the original default: surfaceGridEstimator only
  // switches FOLD systems to "plain" (see "the default estimator flip is
  // live" below for that half).
  it('defaults to "refined" on an affine system: bit-identical values to an explicit refined build', () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const implicit = buildSurfaceGrid(de, 8);
    const explicit = buildSurfaceGrid(de, 8, "refined");
    expect(Array.from(implicit.values)).toEqual(Array.from(explicit.values));
  });

  it("stores a plain floor no greater than the refined floor, cell for cell, on a fold system", () => {
    const de = buildSurfaceDE(foldBoxfoldPair());
    const plain = buildSurfaceGrid(de, 12, "plain");
    const refined = buildSurfaceGrid(de, 12, "refined");
    for (let i = 0; i < plain.values.length; i++) {
      expect(plain.values[i]).toBeLessThanOrEqual(refined.values[i]);
    }
  });

  it("keeps plain floors conservative against a brute-force nearest-cloud check on a fold system", () => {
    const transforms = foldBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const grid = buildSurfaceGrid(de, 12, "plain");
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(2024),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });
});

describe("the default estimator flip is live", () => {
  it('matches an explicit "plain" build bit-for-bit on a fold system', () => {
    const de = buildSurfaceDE(foldBoxfoldPair());
    const implicit = buildSurfaceGrid(de, 8);
    const plain = buildSurfaceGrid(de, 8, "plain");
    expect(Array.from(implicit.values)).toEqual(Array.from(plain.values));
  });

  // Deliberately NOT asserting implicit !== an explicit "refined" build:
  // checked directly, this small 2-map fold pair already agrees with
  // refined cell for cell at resolution 8 (surfaceGridEstimator's own doc
  // notes 2-map fold pairs cost the same because the refined level's lazy
  // guard almost never fires extra sweeps — evidently that extends to the
  // VALUES here too, not just the timing). Asserting inequality would pin a
  // coincidental property of this tiny fixture rather than the default flip
  // under test, and would go flaky the moment somebody retuned
  // foldBoxfoldPair.
});

describe("pickSurfaceGridResolution", () => {
  it("keeps the requested resolution when the pilot projects comfortably under budget", () => {
    // projected(64) = 5 * 64 * (64/64)^3 = 320 <= 3000.
    expect(pickSurfaceGridResolution(64, 5)).toBe(64);
  });

  it("downshifts one rung when the requested resolution projects over budget but the next rung down fits", () => {
    // projected(64) = 100 * 64 = 6400 > 3000.
    // projected(48) = 100 * 64 * (48/64)^3 = 6400 * 0.75^3 = 2700 <= 3000.
    expect(pickSurfaceGridResolution(64, 100)).toBe(48);
  });

  it("falls all the way to the ladder floor when every rung projects over budget", () => {
    // projected(64) = 600 * 64 = 38400 > 3000.
    // projected(48) = 600 * 64 * 0.75^3 = 16200 > 3000.
    // projected(32) = 600 * 64 * 0.5^3 = 4800 > 3000: over budget even at
    // the floor, but the floor still wins — coarsest grid, never no grid.
    expect(pickSurfaceGridResolution(64, 600)).toBe(32);
  });

  it("keeps the requested resolution for a degenerate zero-time pilot", () => {
    expect(pickSurfaceGridResolution(64, 0)).toBe(64);
  });

  it("treats an exactly-at-budget projection as fitting (inclusive boundary)", () => {
    // projected(64) = 46.875 * 64 = 3000.0 exactly.
    expect(pickSurfaceGridResolution(64, 46.875)).toBe(64);
  });

  it("returns the requested resolution unchanged when it already sits at the ladder floor", () => {
    // 32 is the lowest ladder rung, so there is nowhere lower to shift to,
    // no matter how expensive the pilot projects.
    expect(pickSurfaceGridResolution(32, 1e9)).toBe(32);
  });

  it("returns the requested resolution unchanged when it sits below the whole ladder", () => {
    // 24 is below every ladder rung (64/48/32), so the loop never matches
    // an `r <= requested` and the explicit small resolution is never
    // second-guessed, however expensive the pilot projects.
    expect(pickSurfaceGridResolution(24, 1e9)).toBe(24);
  });

  it("honors a custom budget", () => {
    // projected(64) = 100 * 64 = 6400 <= 10_000.
    expect(pickSurfaceGridResolution(64, 100, 10_000)).toBe(64);
  });

  it("skips ladder rungs above the requested resolution", () => {
    // 64 sits above the requested 48 and is skipped entirely.
    // projected(48) = 600 * 48 = 28800 > 3000.
    // projected(32) = 600 * 48 * (32/48)^3 ~= 8533 > 3000 -> floor 32.
    expect(pickSurfaceGridResolution(48, 600)).toBe(32);
  });
});

describe("balloonClearsGridBox", () => {
  /** `buildBalloon`'s own arithmetic, spelled out so each row below reads
   * as the four numbers the predicate is a function of: the balloon sits
   * at `center`, its divisor is the MARGINED ball radius, and `R` is the
   * normalized radius in world units. */
  function balloonAt(rawRadius: number, center: Vec3, rMult: number): Balloon {
    return {
      center,
      rho: rawRadius * BALLOON_RHO_MARGIN,
      R: rMult * rawRadius,
    };
  }

  // The `spherefold pair` row, reconstructed from the measurement's
  // own printed figures: |boundCenter| 0.7857, the box's far corner from
  // the ORIGIN 3.0532, and R^2/rho at rest 4.3812. It is the row where
  // the origin offset is not a formality — 0.7857 is ~46% of the system's
  // own visibleBoundingRadius.
  const SPHEREFOLD_CENTER: Vec3 = [0.7857, 0, 0];
  const SPHEREFOLD_HALF_EXTENT = 3.0532 / Math.sqrt(3);
  const SPHEREFOLD_RAW_RADIUS = (4.3812 * BALLOON_RHO_MARGIN) / 1.6 ** 2;

  it("clears at the rest radius, where the shell has swallowed the whole grid box", () => {
    // R^2/rho = 4.3812 against a box reaching 3.8389 from the balloon
    // center: the 14.1% rest margin the measurement reports for this row.
    const rest = balloonAt(SPHEREFOLD_RAW_RADIUS, SPHEREFOLD_CENTER, 1.6);
    expect(balloonClearsGridBox(rest, SPHEREFOLD_HALF_EXTENT)).toBe(true);
  });

  it("fails at the early-inflation radius, where the echo is still a crumpled ball inside the box", () => {
    const early = balloonAt(SPHEREFOLD_RAW_RADIUS, SPHEREFOLD_CENTER, 0.35);
    expect(balloonClearsGridBox(early, SPHEREFOLD_HALF_EXTENT)).toBe(false);
  });

  it("fails at the mid-inflation radius, where the shell interpenetrates the attractor", () => {
    const mid = balloonAt(SPHEREFOLD_RAW_RADIUS, SPHEREFOLD_CENTER, 0.9);
    expect(balloonClearsGridBox(mid, SPHEREFOLD_HALF_EXTENT)).toBe(false);
  });

  it("measures the box from the BALLOON CENTER, refusing a radius an origin-centered reading would admit", () => {
    // The grid cube is origin-centered; this balloon is not. At rMult 1.41
    // the shell has cleared the box's far corner as measured FROM THE
    // ORIGIN (3.0532) but not as measured from the balloon center
    // (3.8389) — so a predicate written against the origin would enable
    // fractal-only floors with the shell still cutting through the box.
    const b = balloonAt(SPHEREFOLD_RAW_RADIUS, SPHEREFOLD_CENTER, 1.41);
    const shellNear = (b.R * b.R) / b.rho;
    expect(shellNear).toBeGreaterThan(Math.sqrt(3) * SPHEREFOLD_HALF_EXTENT);
    expect(balloonClearsGridBox(b, SPHEREFOLD_HALF_EXTENT)).toBe(false);
  });

  it("keeps the whole box-corner term for an origin-centered ball, where the offset contributes nothing", () => {
    // The `default` row: R^2/rho 4.5894 against boxFarFromC 3.1983,
    // the uniform 43.5% margin every origin-centered system shows at rest.
    const halfExtent = 3.1983 / Math.sqrt(3);
    const raw = (4.5894 * BALLOON_RHO_MARGIN) / 1.6 ** 2;
    expect(
      balloonClearsGridBox(balloonAt(raw, [0, 0, 0], 1.6), halfExtent),
    ).toBe(true);
    expect(
      balloonClearsGridBox(balloonAt(raw, [0, 0, 0], 0.9), halfExtent),
    ).toBe(false);
  });

  it("flips exactly once across an inflation sweep, so the enable falls cleanly instead of flickering", () => {
    // R is the only live term and the left side is monotone in it, which
    // is what makes this a per-frame gate the animation can cross without
    // debouncing. 400 steps from a crumpled ball to well past rest.
    const seen: boolean[] = [];
    for (let i = 0; i <= 400; i++) {
      const rMult = (i / 400) * 2.5;
      seen.push(
        balloonClearsGridBox(
          balloonAt(SPHEREFOLD_RAW_RADIUS, SPHEREFOLD_CENTER, rMult),
          SPHEREFOLD_HALF_EXTENT,
        ),
      );
    }
    const flips = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    expect(flips).toBe(1);
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });

  it("refuses a degenerate ball rather than dividing its way to a pass", () => {
    // rho = R = 0 makes the left side NaN, which compares false: the safe
    // direction, since a disabled grid is only slower.
    expect(balloonClearsGridBox({ center: [0, 0, 0], rho: 0, R: 0 }, 1)).toBe(
      false,
    );
  });

  it("answers for a real DE through buildBalloon and surfaceGridSpec — the pair main.ts hands it", () => {
    const de = buildSurfaceDE(anisotropicSierpinski(), null, {
      order: 1,
      plane: "xz",
    });
    const halfExtent = surfaceGridSpec(de).halfExtent;
    expect(balloonClearsGridBox(buildBalloon(de, 1.6), halfExtent)).toBe(true);
    expect(balloonClearsGridBox(buildBalloon(de, 0.9), halfExtent)).toBe(false);
    expect(balloonClearsGridBox(buildBalloon(de, 0.35), halfExtent)).toBe(
      false,
    );
  });

  it("is unmoved by the grid's resolution, so a worker downshift cannot invalidate the request-time answer", () => {
    const de = buildSurfaceDE(foldBoxfoldPair(), null, {
      order: 1,
      plane: "xz",
    });
    const balloon = buildBalloon(de, 1.6);
    expect(surfaceGridSpec(de, 32).halfExtent).toBe(
      surfaceGridSpec(de, 64).halfExtent,
    );
    expect(
      balloonClearsGridBox(balloon, surfaceGridSpec(de, 32).halfExtent),
    ).toBe(balloonClearsGridBox(balloon, surfaceGridSpec(de, 64).halfExtent));
  });
});
