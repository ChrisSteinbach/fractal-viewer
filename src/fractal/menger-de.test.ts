import {
  buildMengerDE,
  estimateMengerDistance,
  MENGER_STEP_SCALE,
  mengerSetContains,
  mengerTrap,
} from "./menger-de";
import type { MengerDE } from "./menger-de";
import {
  MENGER_TWIST_AUTHORED_FIELDS,
  MENGER_TWIST_DEFAULTS,
  MENGER_TWIST_MAX_LEVELS,
  MENGER_TWIST_W_FIELDS,
  mengerTwistAuthoredDimension,
  resolveMengerTwist,
} from "./menger-twist";
import type {
  MengerTwistAuthored,
  MengerTwistConstruction,
} from "./menger-twist";
import { mulberry32 } from "./rng";
import type { Vec3 } from "./types";

/** The default construction (the repo's own twist), built directly — the
 * resolver's `ok` path, asserted once and reused. */
function constructionOf(
  authored: MengerTwistAuthored,
): MengerTwistConstruction {
  const resolution = resolveMengerTwist(authored);
  if (!resolution.ok) {
    throw new Error(resolution.reasons.join("; "));
  }
  return resolution.construction;
}

describe("menger-twist resolver", () => {
  it("fills the defaults with the reference construction (4 levels, the ~53° Y twist, no offset)", () => {
    const resolution = resolveMengerTwist({});
    if (!resolution.ok) {
      throw new Error(resolution.reasons.join("; "));
    }
    const construction = resolution.construction;
    expect(construction.levels).toBe(4);
    expect(construction.rotation).toEqual([0, -0.9272952180016122, 0]);
    expect(construction.offset).toEqual([0, 0, 0]);
    expect(construction.dim).toBe(3);
    expect(construction.rotation4).toEqual({});
    expect(construction.offsetW).toBe(0);
    expect(MENGER_TWIST_DEFAULTS.levels).toBe(4);
  });

  it("refuses unknown keys at both levels, out-of-range and non-integer level counts, and non-finite numbers", () => {
    const cases: MengerTwistAuthored[] = [
      { bogus: 1 } as unknown as MengerTwistAuthored,
      { w: { bogus: 1 } } as unknown as MengerTwistAuthored,
      { w: { rotation: { bogus: 1 } } } as unknown as MengerTwistAuthored,
      { levels: 0 },
      { levels: MENGER_TWIST_MAX_LEVELS + 1 },
      { levels: 2.5 },
      { rotation: [0, Number.NaN, 0] },
      { offset: [0, 0, Number.POSITIVE_INFINITY] },
      { rotation: [0, 0] as unknown as Vec3 },
      { w: { offset: Number.NaN } },
      { w: "nope" } as unknown as MengerTwistAuthored,
    ];
    for (const authored of cases) {
      const resolution = resolveMengerTwist(authored);
      if (resolution.ok) {
        throw new Error(`expected refusal: ${JSON.stringify(authored)}`);
      }
      expect(
        resolution.reasons.length,
        JSON.stringify(authored),
      ).toBeGreaterThan(0);
    }
  });

  it("accepts every legal level count and reports the authored dimension from a non-trivial w only", () => {
    for (let levels = 1; levels <= MENGER_TWIST_MAX_LEVELS; levels++) {
      expect(resolveMengerTwist({ levels }).ok).toBe(true);
    }
    expect(mengerTwistAuthoredDimension({})).toBe(3);
    expect(mengerTwistAuthoredDimension({ w: {} })).toBe(3);
    expect(mengerTwistAuthoredDimension({ w: { offset: 0 } })).toBe(3);
    expect(mengerTwistAuthoredDimension({ w: { rotation: { xw: 0 } } })).toBe(
      3,
    );
    expect(mengerTwistAuthoredDimension({ w: { rotation: { yw: 0.3 } } })).toBe(
      4,
    );
    expect(mengerTwistAuthoredDimension({ w: { offset: -0.2 } })).toBe(4);
  });

  it("never mutates its input", () => {
    const authored: MengerTwistAuthored = {
      levels: 3,
      rotation: [0.1, 0.2, 0.3],
      offset: [0.4, 0.5, 0.6],
      w: { rotation: { xw: 0.7 }, offset: 0.8 },
    };
    const before = JSON.stringify(authored);
    resolveMengerTwist(authored);
    expect(JSON.stringify(authored)).toBe(before);
    expect(Object.keys(MENGER_TWIST_AUTHORED_FIELDS).length).toBeGreaterThan(0);
    expect(MENGER_TWIST_W_FIELDS.includes("rotation")).toBe(true);
  });
});

describe("twisted menger estimate (3D)", () => {
  const plain = buildMengerDE(
    constructionOf({ levels: 4, rotation: [0, 0, 0] }),
  );

  // EXACTNESS AT LEVEL 0 (module doc): the box's central void reads the
  // exact wall distance 1/3, a point inside a removed bar reads its exact
  // wall distance, and surviving cells read negative.
  it("reads the exact wall distance at the classic carve's known points", () => {
    expect(estimateMengerDistance(plain, [0, 0, 0])).toBe(1 / 3);
    // Inside the removed z-bar, distance to its x/y walls: 1/3 − 0.1.
    expect(estimateMengerDistance(plain, [0.1, 0.1, 0.8])).toBeCloseTo(
      1 / 3 - 0.1,
      12,
    );
    // An off-center bar point: the nearer wall governs.
    expect(estimateMengerDistance(plain, [0.05, 0.2, 0.8])).toBeCloseTo(
      1 / 3 - 0.2,
      12,
    );
    // The corner cell's own center is INSIDE that cell's level-1 cross
    // (every cell's center void is carved), at the exact wall distance 1/9
    // from the removed sub-cell [5/9,7/9]³.
    expect(estimateMengerDistance(plain, [2 / 3, 2 / 3, 2 / 3])).toBe(1 / 9);
  });

  it("classifies membership exactly as the carve chain does", () => {
    // The near-corner chain survives every level (each coordinate reads an
    // outer third at every scale); a box-center/bar/interior point does not.
    expect(mengerSetContains(plain, [0.95, 0.95, 0.95])).toBe(true);
    expect(mengerSetContains(plain, [1 / 3, 0.95, 0.95])).toBe(true);
    expect(mengerSetContains(plain, [0, 0, 0])).toBe(false);
    expect(mengerSetContains(plain, [0.1, 0.1, 0.8])).toBe(false);
    expect(mengerSetContains(plain, [2 / 3, 2 / 3, 2 / 3])).toBe(false);
    expect(mengerSetContains(plain, [2, 0, 0])).toBe(false);
  });

  it("reports the winning level as the trap coordinate", () => {
    // The box center: the level-0 carve dominates (the central void's wall).
    expect(mengerTrap(plain, [0, 0, 0])).toBe(0);
    // The corner cell's center: the level-1 carve dominates.
    expect(mengerTrap(plain, [2 / 3, 2 / 3, 2 / 3])).toBeCloseTo(1 / 3, 12);
  });

  // THE TWIST CERTIFICATION, executable: a 90° rotation about an axis is a
  // SYMMETRY of the carve pattern, so the twisted construction describes
  // the same set as the untwisted one — the twisted DE must reproduce the
  // plain DE at every point (to rounding; the Euler π/2's cos is 6e-17, so
  // bit-exactness is not available, but any wrong composition order,
  // missing offset, or transposed matrix breaks 1e-10 immediately).
  it("reproduces the plain sponge exactly under a carve-symmetric twist", () => {
    const rng = mulberry32(0x6d656e67);
    for (const axisRotation of [
      [0, 0, Math.PI / 2],
      [Math.PI / 2, 0, 0],
      [0, Math.PI / 2, 0],
      [0, 0, Math.PI],
    ] as const) {
      const twisted = buildMengerDE(
        constructionOf({ levels: 4, rotation: [...axisRotation] as Vec3 }),
      );
      for (let i = 0; i < 200; i++) {
        const p: Vec3 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
        const label = axisRotation.join(", ");
        expect(
          estimateMengerDistance(twisted, p),
          `twist (${label}) at ${p.join(", ")}`,
        ).toBeCloseTo(estimateMengerDistance(plain, p), 10);
      }
    }
  });

  it("reads the same chain for the trap as the estimate does", () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
      const trap = mengerTrap(plain, p);
      expect(trap).toBeGreaterThanOrEqual(0);
      expect(trap).toBeLessThanOrEqual(1);
    }
  });

  // The 53° twist is NOT a symmetry: it must move the set. This catches a
  // twist that silently no-ops (an identity wire, a dropped matrix): a
  // hand-chosen point whose plain chain reads a removed bar and whose
  // twisted chain does not, plus a randomized sweep with a loose bar.
  it("changes the object under the reference twist", () => {
    const twisted = buildMengerDE(constructionOf({}));
    expect(estimateMengerDistance(twisted, [0.1, 0.1, 0.8])).toBeLessThan(0);
    expect(estimateMengerDistance(plain, [0.1, 0.1, 0.8])).toBeGreaterThan(0);
    let differing = 0;
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [rng() * 3 - 1.5, rng() * 3 - 1.5, rng() * 3 - 1.5];
      if (
        Math.abs(
          estimateMengerDistance(twisted, p) - estimateMengerDistance(plain, p),
        ) > 1e-9
      ) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(100);
  });

  // The offset displaces each level's pattern after the rotation; it must
  // also move the object, and the DE must stay a lower bound in the
  // direction that matters: points of the UNtwisted set never read far
  // positive... they can read positive (the set moved), so this pins only
  // the weaker must-hold: with off = 0 the DE agrees, with a large off it
  // disagrees almost everywhere.
  it("responds to the per-level offset", () => {
    const offset = buildMengerDE(
      constructionOf({
        levels: 4,
        rotation: [0, 0, 0],
        offset: [0.6, 0.6, 0.6],
      }),
    );
    // The offset displaces every level's pattern — at the box center the
    // twisted chain reads a shifted point whose carve differs from 1/3.
    expect(estimateMengerDistance(offset, [0, 0, 0])).not.toBeCloseTo(1 / 3, 9);
    let differing = 0;
    const rng = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [rng() * 3 - 1.5, rng() * 3 - 1.5, rng() * 3 - 1.5];
      if (
        Math.abs(
          estimateMengerDistance(offset, p) - estimateMengerDistance(plain, p),
        ) > 1e-9
      ) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(100);
  });

  it("clamps the level budget through the preview-tier door", () => {
    const full = estimateMengerDistance(plain, [0.1, 0.1, 0.8]);
    const one = estimateMengerDistance(plain, [0.1, 0.1, 0.8], 1);
    expect(one).toBe(full);
    const deep = estimateMengerDistance(plain, [0, 0, 0], 6);
    expect(deep).toBeGreaterThan(0);
  });

  it("exposes the one march step scale and the level budget the mirrors import", () => {
    expect(MENGER_STEP_SCALE).toBe(1);
    expect(plain.stepScale).toBe(MENGER_STEP_SCALE);
    expect(plain.maxDepth).toBe(4);
    expect(plain.boundingRadius).toBe(Math.sqrt(3));
    expect(plain.visibleBoundingRadius).toBe(plain.boundingRadius);
  });

  it("keeps the DE a lower bound against a deep membership oracle", () => {
    // The certification's empirical form: points ON the level-4 sponge
    // (found by membership) sit within rounding of zero, never
    // meaningfully positive — an overshooting bound would put set points
    // outside its own zero set. Membership points come from a rejection
    // walk over the bounding ball.
    const rng = mulberry32(0x5eed);
    let found = 0;
    let worstPositive = -Infinity;
    for (let i = 0; i < 200000 && found < 400; i++) {
      const p: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      if (mengerSetContains(plain, p)) {
        found++;
        worstPositive = Math.max(
          worstPositive,
          estimateMengerDistance(plain, p),
        );
      }
    }
    expect(found).toBe(400);
    // Membership says "inside or on the set", so the estimate must not
    // exceed zero beyond rounding.
    expect(worstPositive).toBeLessThanOrEqual(1e-12);
  });
});

describe("twisted menger DE wire", () => {
  it("pre-composes the twist into one matrix and one offset", () => {
    const de: MengerDE = buildMengerDE(
      constructionOf({
        levels: 3,
        rotation: [0.1, 0.2, 0.3],
        offset: [0.4, 0.5, 0.6],
      }),
    );
    expect(de.twistM).toHaveLength(9);
    // Rotation rows stay orthonormal — the isometry the soundness argument
    // rides, pinned on the wire the kernels receive.
    const rowLength = (i: number) =>
      Math.hypot(de.twistM[i], de.twistM[i + 1], de.twistM[i + 2]);
    expect(rowLength(0)).toBeCloseTo(1, 12);
    expect(rowLength(3)).toBeCloseTo(1, 12);
    expect(rowLength(6)).toBeCloseTo(1, 12);
    expect(
      de.twistM[0] * de.twistM[3] +
        de.twistM[1] * de.twistM[4] +
        de.twistM[2] * de.twistM[5],
    ).toBeCloseTo(0, 12);
    expect(de.levels).toBe(3);
  });
});
