import {
  buildMengerDE4,
  estimateMengerDistance4,
  mengerSetContains4,
  mengerTrap4,
} from "./menger-de-4d";
import type { MengerDE4 } from "./menger-de-4d";
import { resolveMengerTwist } from "./menger-twist";
import type {
  MengerTwistAuthored,
  MengerTwistConstruction,
} from "./menger-twist";
import { mulberry32 } from "./rng";
import type { Vec4 } from "./types";

function constructionOf(
  authored: MengerTwistAuthored,
): MengerTwistConstruction {
  const resolution = resolveMengerTwist(authored);
  if (!resolution.ok) {
    throw new Error(resolution.reasons.join("; "));
  }
  return resolution.construction;
}

describe("twisted hyper-menger estimate (4D)", () => {
  const plain = buildMengerDE4(
    constructionOf({ levels: 4, rotation: [0, 0, 0] }),
  );

  // THE 4D CARVE RULE: the central void reads the exact wall distance 1/3;
  // one middle coordinate survives (the hyper-Menger keeps cells with at
  // most one middle among four); two middles are removed at the exact wall
  // distance.
  it("reads the hyper-Menger rule at the classic points", () => {
    expect(estimateMengerDistance4(plain, [0, 0, 0, 0])).toBe(1 / 3);
    // One middle among xyz: survives (negative interior value).
    expect(estimateMengerDistance4(plain, [0, 0.8, 0.8, 0.8])).toBeLessThan(0);
    // Two middles: removed, at the exact wall distance 1/3.
    expect(estimateMengerDistance4(plain, [0, 0, 0.8, 0.8])).toBe(1 / 3);
  });

  it("classifies membership exactly as the carve chain does", () => {
    expect(mengerSetContains4(plain, [0.95, 0.95, 0.95, 0.95])).toBe(true);
    expect(mengerSetContains4(plain, [0, 0, 0, 0])).toBe(false);
    expect(mengerSetContains4(plain, [0, 0, 0.8, 0.8])).toBe(false);
    expect(mengerSetContains4(plain, [2, 0, 0, 0])).toBe(false);
  });

  // THE 4D TWIST CERTIFICATION: the xy plane's 90° turn is a coordinate
  // permutation — a symmetry of the hyper-Menger carve — so the twisted
  // construction describes the same set and the DE must reproduce the
  // plain one at every point.
  it("reproduces the plain hyper-Menger under a carve-symmetric plane twist", () => {
    const twisted = buildMengerDE4(
      constructionOf({
        levels: 4,
        rotation: [0, 0, 0],
        w: { rotation: { xy: Math.PI / 2 } },
      }),
    );
    const rng = mulberry32(0x71ce);
    for (let i = 0; i < 150; i++) {
      const p: Vec4 = [
        rng() * 4 - 2,
        rng() * 4 - 2,
        rng() * 4 - 2,
        rng() * 4 - 2,
      ];
      expect(
        estimateMengerDistance4(twisted, p),
        `xy 90° at ${p.join(", ")}`,
      ).toBeCloseTo(estimateMengerDistance4(plain, p), 10);
    }
  });

  it("changes the object under a non-symmetric twist", () => {
    const twisted = buildMengerDE4(
      constructionOf({
        levels: 4,
        rotation: [0, 0, 0],
        w: { rotation: { xw: 0.9 } },
      }),
    );
    expect(estimateMengerDistance4(twisted, [0, 0, 0.8, 0.8])).not.toBeCloseTo(
      estimateMengerDistance4(plain, [0, 0, 0.8, 0.8]),
      9,
    );
    let differing = 0;
    const rng = mulberry32(13);
    for (let i = 0; i < 300; i++) {
      const p: Vec4 = [
        rng() * 3 - 1.5,
        rng() * 3 - 1.5,
        rng() * 3 - 1.5,
        rng() * 3 - 1.5,
      ];
      if (
        Math.abs(
          estimateMengerDistance4(twisted, p) -
            estimateMengerDistance4(plain, p),
        ) > 1e-9
      ) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(60);
  });

  it("keeps the DE a lower bound against membership over the 4D ball", () => {
    const rng = mulberry32(0x5eed4d);
    let found = 0;
    let worstPositive = -Infinity;
    for (let i = 0; i < 200000 && found < 300; i++) {
      const p: Vec4 = [
        rng() * 2 - 1,
        rng() * 2 - 1,
        rng() * 2 - 1,
        rng() * 2 - 1,
      ];
      if (mengerSetContains4(plain, p)) {
        found++;
        worstPositive = Math.max(
          worstPositive,
          estimateMengerDistance4(plain, p),
        );
      }
    }
    expect(found).toBe(300);
    expect(worstPositive).toBeLessThanOrEqual(1e-12);
  });

  it("exposes the wire the mirrors import", () => {
    const de: MengerDE4 = buildMengerDE4(
      constructionOf({
        levels: 5,
        rotation: [0.1, 0.2, 0.3],
        offset: [0.4, 0.5, 0.6],
        w: { rotation: { xw: 0.7, yw: -0.2 }, offset: 0.15 },
      }),
    );
    expect(de.twistM).toHaveLength(16);
    for (let row = 0; row < 4; row++) {
      const length = Math.hypot(
        de.twistM[row],
        de.twistM[row + 4],
        de.twistM[row + 8],
        de.twistM[row + 12],
      );
      expect(length, `row ${row}`).toBeCloseTo(1, 12);
    }
    // The w row of a purely-3D twist stays exactly (0,0,0,1) — the
    // embedding rule affine4.ts's rotationMatrix4 skips zero factors for.
    const flat = buildMengerDE4(
      constructionOf({ levels: 2, rotation: [0.4, 0, 0.9] }),
    );
    expect(flat.twistM[12]).toBe(0);
    expect(flat.twistM[13]).toBe(0);
    expect(flat.twistM[14]).toBe(0);
    expect(flat.twistM[15]).toBe(1);
    expect(de.levels).toBe(5);
    expect(de.boundingRadius).toBe(2);
    expect(de.visibleBoundingRadius).toBe(2);
    expect(de.stepScale).toBe(plain.stepScale);
    expect(de.maxDepth).toBe(5);
  });

  it("clamps the level budget and reads the trap off the same chain", () => {
    const full = estimateMengerDistance4(plain, [0, 0, 0.8, 0.8]);
    expect(estimateMengerDistance4(plain, [0, 0, 0.8, 0.8], 1)).toBe(full);
    expect(estimateMengerDistance4(plain, [0, 0, 0.8, 0.8], 3)).toBe(full);
    expect(mengerTrap4(plain, [0, 0, 0.8, 0.8])).toBe(0);
    const rng = mulberry32(31);
    for (let i = 0; i < 100; i++) {
      const trap = mengerTrap4(plain, [
        rng() * 4 - 2,
        rng() * 4 - 2,
        rng() * 4 - 2,
        rng() * 4 - 2,
      ]);
      expect(trap).toBeGreaterThanOrEqual(0);
      expect(trap).toBeLessThanOrEqual(1);
    }
  });
});
