import {
  isAcceptableSystem,
  isAcceptableSystem4,
  MIN_OCCUPIED_CELLS,
  occupiedCellCount,
  randomSystem,
} from "./random-system";
import { systemIsFlat, toTransform4 } from "./affine4";
import { ESCAPE_LIMIT, runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { doubleRotation, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Bounds, Bounds4, Transform } from "./types";

const SEED_SAMPLE_SIZE = 50;
/** Larger batch for the 4D-roll tests (fr-bf6.5): the roll only hits ~1/4 of
 * the time, so a bigger sample is needed for both the fraction check and to
 * reliably surface at least one of each sparse-`w` shape (position-only,
 * rotation-only, two-plane rotation, the flat-roll force-fallback). */
const FOUR_D_SEED_SAMPLE_SIZE = 200;

describe("randomSystem", () => {
  it("is deterministic for a given seed, including the quality gate's probes", () => {
    const a = randomSystem(mulberry32(42));
    const b = randomSystem(mulberry32(42));
    expect(a).toEqual(b);
  });

  it("generates between 2 and 4 transforms", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      expect(transforms.length).toBeGreaterThanOrEqual(2);
      expect(transforms.length).toBeLessThanOrEqual(4);
    }
  });

  it("keeps every transform's position, rotation, scale, and shear within their documented ranges", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      for (const t of transforms) {
        for (const v of t.position) {
          expect(v).toBeGreaterThanOrEqual(-0.9);
          expect(v).toBeLessThanOrEqual(0.9);
        }
        for (const v of t.rotation) {
          expect(v).toBeGreaterThanOrEqual(-Math.PI);
          expect(v).toBeLessThanOrEqual(Math.PI);
        }
        for (const v of t.scale) {
          expect(v).toBeGreaterThanOrEqual(0.35);
          expect(v).toBeLessThanOrEqual(0.85);
        }
        expect(t.shear).toBeDefined();
        for (const v of t.shear ?? []) {
          expect(v).toBeGreaterThanOrEqual(-0.3);
          expect(v).toBeLessThanOrEqual(0.3);
        }
      }
    }
  });

  it("keeps every transform's weight an integer within [1, 25]", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      for (const t of transforms) {
        expect(Number.isInteger(t.weight)).toBe(true);
        expect(t.weight).toBeGreaterThanOrEqual(1);
        expect(t.weight).toBeLessThanOrEqual(25);
      }
    }
  });

  it("keeps variation weights within their documented ranges (linear companion vs. the rest)", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      for (const t of transforms) {
        for (const v of t.variations ?? []) {
          if (v.type === "linear") {
            expect(v.weight).toBeGreaterThanOrEqual(0.4);
            expect(v.weight).toBeLessThanOrEqual(0.8);
          } else {
            expect(v.weight).toBeGreaterThanOrEqual(0.3);
            expect(v.weight).toBeLessThanOrEqual(0.9);
          }
        }
      }
    }
  });

  it("gives every transform that has variations a linear companion", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      for (const t of transforms) {
        if (t.variations && t.variations.length > 0) {
          expect(t.variations.some((v) => v.type === "linear")).toBe(true);
        }
      }
    }
  });

  it("rolls either no final transform or a valid identity-affine lens with one in-range variation", () => {
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { finalTransform } = randomSystem(mulberry32(seed));
      if (finalTransform === null) continue;
      expect(finalTransform.position).toEqual([0, 0, 0]);
      expect(finalTransform.rotation).toEqual([0, 0, 0]);
      expect(finalTransform.scale).toEqual([1, 1, 1]);
      expect(finalTransform.variations).toHaveLength(1);
      const [v] = finalTransform.variations ?? [];
      expect(["spherical", "bubble", "disc", "julia"]).toContain(v.type);
      expect(v.weight).toBeGreaterThanOrEqual(0.6);
      expect(v.weight).toBeLessThanOrEqual(1.2);
    }
  });

  it("floors every uniform-scale map at count^(-1/1.8), so jitter can't drag a 2-map roll into a thin squiggle (fr-d61)", () => {
    let uniformScaleMapsSeen = 0;
    for (let seed = 0; seed < SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      const floor = Math.pow(transforms.length, -1 / 1.8);
      for (const t of transforms) {
        const [sx, sy, sz] = t.scale;
        // Exact equality identifies the uniform-scale branch: the
        // anisotropic branch's three independent continuous draws can never
        // coincide.
        if (sx !== sy || sy !== sz) continue;
        uniformScaleMapsSeen++;
        expect(t.scale[0]).toBeGreaterThanOrEqual(floor - 1e-12);
      }
    }
    expect(uniformScaleMapsSeen).toBeGreaterThan(0);
  });

  it("caps a 2-map system's weight skew at 4:1 so the light branch keeps at least a fifth of the orbit (fr-d61)", () => {
    let twoMapSystemsSeen = 0;
    // Bigger sample (matching the 4D-roll tests) to hit plenty of 2-map
    // systems.
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      if (transforms.length !== 2) continue;
      twoMapSystemsSeen++;
      const [w0, w1] = transforms.map((t) => t.weight ?? 1);
      expect(Math.max(w0, w1)).toBeLessThanOrEqual(4 * Math.min(w0, w1));
    }
    expect(twoMapSystemsSeen).toBeGreaterThan(0);
  });
});

describe("randomSystem's 4D extension (fr-bf6.5)", () => {
  it("is deterministic for a seed that rolls a non-flat system, including identical w blocks", () => {
    // Seed 7 is confirmed (empirically) to roll a non-flat system, so this
    // exercises the w-block equality path rather than incidentally passing
    // because neither run touched `w` at all.
    const a = randomSystem(mulberry32(7));
    const b = randomSystem(mulberry32(7));
    expect(systemIsFlat(a.transforms)).toBe(false);
    expect(a).toEqual(b);
  });

  it("lands a non-flat system on roughly one 'Surprise Me' roll in four", () => {
    let nonFlatCount = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      if (!systemIsFlat(transforms)) nonFlatCount++;
    }
    const fraction = nonFlatCount / FOUR_D_SEED_SAMPLE_SIZE;
    // Generous band around the ¼ design target (FOUR_D_PROBABILITY): loose
    // enough to never flake, tight enough to catch a broken or always-on roll.
    expect(fraction).toBeGreaterThanOrEqual(0.12);
    expect(fraction).toBeLessThanOrEqual(0.4);
  });

  it("carries no w key on any transform when a roll comes out flat", () => {
    let flatSystemsSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      if (!systemIsFlat(transforms)) continue;
      flatSystemsSeen++;
      for (const t of transforms) {
        expect("w" in t).toBe(false);
      }
    }
    expect(flatSystemsSeen).toBeGreaterThan(0);
  });

  it("never attaches a w block to the final transform, flat or non-flat", () => {
    let finalTransformsSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { finalTransform } = randomSystem(mulberry32(seed));
      if (finalTransform === null) continue;
      finalTransformsSeen++;
      expect("w" in finalTransform).toBe(false);
    }
    expect(finalTransformsSeen).toBeGreaterThan(0);
  });

  it("keeps every rolled w block sparse: no scale, no shear, position and rotation within their documented ranges", () => {
    let wBlocksSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms } = randomSystem(mulberry32(seed));
      for (const t of transforms) {
        if (!t.w) continue;
        wBlocksSeen++;
        expect(t.w.scale).toBeUndefined();
        expect(t.w.shear).toBeUndefined();
        if (t.w.position !== undefined) {
          expect(t.w.position).toBeGreaterThanOrEqual(-0.5);
          expect(t.w.position).toBeLessThanOrEqual(0.5);
        }
        if (t.w.rotation) {
          const angles = Object.values(t.w.rotation);
          expect(angles.length).toBeGreaterThanOrEqual(1);
          expect(angles.length).toBeLessThanOrEqual(2);
          for (const angle of angles) {
            expect(angle).toBeGreaterThanOrEqual(-0.7);
            expect(angle).toBeLessThanOrEqual(0.7);
          }
        }
      }
    }
    expect(wBlocksSeen).toBeGreaterThan(0);
  });

  it("re-probing a batch's non-flat systems confirms the 4D gate's own promises: bounded radius and genuine w-extent", () => {
    let nonFlatSystemsSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const system = randomSystem(mulberry32(seed));
      if (systemIsFlat(system.transforms)) continue;
      nonFlatSystemsSeen++;
      const finalTransform4 = system.finalTransform
        ? toTransform4(system.finalTransform)
        : null;
      // A fresh, independent rng stream -- not a replay of the internal
      // generation-time probe -- so this genuinely re-verifies the system
      // rather than trivially repeating the check that already accepted it.
      const result = runChaosGame4(
        system.transforms.map(toTransform4),
        6000,
        mulberry32(seed * 7919 + 1),
        finalTransform4,
      );
      expect(result.bounds.maxW - result.bounds.minW).toBeGreaterThan(0.1);
      expect(isAcceptableSystem4(result.bounds, result.radius)).toBe(true);
    }
    expect(nonFlatSystemsSeen).toBeGreaterThan(0);
  });
});

describe("randomSystem's symmetry roll (fr-d61)", () => {
  it("rolls symmetry on roughly 3 in 10 flat systems: integer order 2..6 about y, null otherwise", () => {
    let flatSystemsSeen = 0;
    let symmetryHits = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms, symmetry } = randomSystem(mulberry32(seed));
      if (!systemIsFlat(transforms)) continue;
      flatSystemsSeen++;
      if (symmetry === null) continue;
      symmetryHits++;
      expect(Number.isInteger(symmetry.order)).toBe(true);
      expect(symmetry.order).toBeGreaterThanOrEqual(2);
      expect(symmetry.order).toBeLessThanOrEqual(6);
      expect(symmetry.axis).toBe("y");
    }
    const fraction = symmetryHits / flatSystemsSeen;
    // Generous band around the 0.3 design target (SYMMETRY_PROBABILITY):
    // loose enough to never flake, tight enough to catch a broken or
    // always-on roll.
    expect(fraction).toBeGreaterThanOrEqual(0.15);
    expect(fraction).toBeLessThanOrEqual(0.45);
  });

  it("never attaches symmetry to a non-flat system (the 4D pipeline has no symmetry support)", () => {
    let nonFlatSystemsSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const { transforms, symmetry } = randomSystem(mulberry32(seed));
      if (systemIsFlat(transforms)) continue;
      nonFlatSystemsSeen++;
      expect(symmetry).toBeNull();
    }
    expect(nonFlatSystemsSeen).toBeGreaterThan(0);
  });

  it("re-probing a symmetric system WITH its rolled symmetry still lands acceptable bounds", () => {
    let symmetricSystemsSeen = 0;
    for (let seed = 0; seed < FOUR_D_SEED_SAMPLE_SIZE; seed++) {
      const system = randomSystem(mulberry32(seed));
      if (system.symmetry === null) continue;
      symmetricSystemsSeen++;
      // A fresh, independent rng stream -- not a replay of the internal
      // generation-time probe -- so this genuinely re-verifies the system
      // rather than trivially repeating the check that already accepted it.
      const result = runChaosGame(
        system.transforms,
        4000,
        mulberry32(seed * 7919 + 1),
        system.finalTransform,
        system.symmetry,
      );
      // Occupancy is deliberately not re-asserted here: a marginal system
      // near the floor can legitimately wobble across it between seeds.
      // Bounds acceptability is the stable promise -- the existing 4D
      // re-probe test above makes the same trade.
      expect(isAcceptableSystem(result.bounds)).toBe(true);
    }
    expect(symmetricSystemsSeen).toBeGreaterThan(0);
  });
});

function makeBounds(overrides: Partial<Bounds> = {}): Bounds {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minR: 0,
    maxR: 0,
    ...overrides,
  };
}

describe("isAcceptableSystem", () => {
  it("rejects bounds collapsed to a point (every extent near zero)", () => {
    const bounds = makeBounds({
      minX: 0,
      maxX: 0.001,
      minY: 0,
      maxY: 0.001,
      minZ: 0,
      maxZ: 0.001,
    });
    expect(isAcceptableSystem(bounds)).toBe(false);
  });

  it("rejects bounds collapsed to a line (only one axis has meaningful extent)", () => {
    const bounds = makeBounds({
      minX: -2,
      maxX: 2,
      minY: 0,
      maxY: 0.001,
      minZ: 0,
      maxZ: 0.001,
    });
    expect(isAcceptableSystem(bounds)).toBe(false);
  });

  it("accepts a planar system with two large extents and one near zero", () => {
    const bounds = makeBounds({
      minX: -2,
      maxX: 2,
      minY: -1.5,
      maxY: 1.5,
      minZ: 0,
      maxZ: 0.001,
    });
    expect(isAcceptableSystem(bounds)).toBe(true);
  });

  it("rejects bounds hugging the escape wall", () => {
    const bounds = makeBounds({
      minX: -1,
      maxX: ESCAPE_LIMIT * 0.95,
      minY: -1,
      maxY: 1,
      minZ: -1,
      maxZ: 1,
    });
    expect(isAcceptableSystem(bounds)).toBe(false);
  });

  it("accepts a healthy attractor's probe bounds (Sierpinski tetrahedron)", () => {
    const { bounds } = runChaosGame(
      sierpinskiTetrahedron(),
      2000,
      mulberry32(3),
    );
    expect(isAcceptableSystem(bounds)).toBe(true);
  });
});

function makeBounds4(overrides: Partial<Bounds4> = {}): Bounds4 {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minW: 0,
    maxW: 0,
    ...overrides,
  };
}

describe("isAcceptableSystem4", () => {
  it("rejects bounds collapsed to a point (every x/y/z extent near zero)", () => {
    const bounds = makeBounds4({
      minX: 0,
      maxX: 0.001,
      minY: 0,
      maxY: 0.001,
      minZ: 0,
      maxZ: 0.001,
      minW: 0,
      maxW: 1,
    });
    expect(isAcceptableSystem4(bounds, 1)).toBe(false);
  });

  it("rejects bounds collapsed to a line (only one of x/y/z has meaningful extent)", () => {
    const bounds = makeBounds4({
      minX: -2,
      maxX: 2,
      minY: 0,
      maxY: 0.001,
      minZ: 0,
      maxZ: 0.001,
      minW: 0,
      maxW: 1,
    });
    expect(isAcceptableSystem4(bounds, 2)).toBe(false);
  });

  it("accepts a system planar in x/y/z (two large extents, one near zero) provided w opens up too", () => {
    const bounds = makeBounds4({
      minX: -2,
      maxX: 2,
      minY: -1.5,
      maxY: 1.5,
      minZ: 0,
      maxZ: 0.001,
      minW: -0.5,
      maxW: 0.5,
    });
    expect(isAcceptableSystem4(bounds, 2.5)).toBe(true);
  });

  it("rejects a w-extent at or below the 0.1 floor even with healthy x/y/z extents", () => {
    const bounds = makeBounds4({
      minX: -2,
      maxX: 2,
      minY: -1.5,
      maxY: 1.5,
      minZ: -1,
      maxZ: 1,
      minW: 0,
      maxW: 0.1,
    });
    expect(isAcceptableSystem4(bounds, 2.5)).toBe(false);
  });

  it("rejects bounds hugging the escape wall on the w axis", () => {
    const bounds = makeBounds4({
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      minZ: -1,
      maxZ: 1,
      minW: -1,
      maxW: ESCAPE_LIMIT * 0.95,
    });
    expect(isAcceptableSystem4(bounds, 10)).toBe(false);
  });

  it("rejects a radius at or past the documented cap (half of ESCAPE_LIMIT) even with otherwise sane bounds", () => {
    const bounds = makeBounds4({
      minX: -2,
      maxX: 2,
      minY: -1.5,
      maxY: 1.5,
      minZ: -1,
      maxZ: 1,
      minW: -1,
      maxW: 1,
    });
    expect(isAcceptableSystem4(bounds, ESCAPE_LIMIT * 0.5)).toBe(false);
  });

  it("accepts a healthy non-flat attractor's probe bounds (doubleRotation)", () => {
    const result = runChaosGame4(
      doubleRotation().map(toTransform4),
      4000,
      mulberry32(4),
    );
    expect(isAcceptableSystem4(result.bounds, result.radius)).toBe(true);
  });
});

describe("occupiedCellCount", () => {
  it("counts a repeated point as a single occupied cell", () => {
    const positions = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const bounds = makeBounds({ maxX: 1, maxY: 1, maxZ: 1 });
    expect(occupiedCellCount(positions, 2, bounds)).toBe(1);
  });

  it("counts points in separated regions as separate cells", () => {
    // The 8 corners of the unit cube land in 8 distinct grid cells.
    const positions = new Float32Array(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
      ].flat(),
    );
    const bounds = makeBounds({ maxX: 1, maxY: 1, maxZ: 1 });
    expect(occupiedCellCount(positions, 8, bounds)).toBe(8);
  });

  it("scores a captured dusty roll below the gate threshold and a healthy preset above it", () => {
    // Captured from manual QA: two maps whose variation blends over-contract
    // the orbit into a few dozen specks — sane bounds, no visible structure.
    const dust: Transform[] = [
      {
        id: 0,
        position: [-0.5906, 0.7748, -0.6933],
        rotation: [1.8868, 2.2868, -2.5576],
        scale: [0.798, 0.798, 0.798],
        weight: 18,
        variations: [
          { type: "bubble", weight: 0.6261 },
          { type: "linear", weight: 0.5848 },
        ],
      },
      {
        id: 1,
        position: [0.6458, 0.7098, -0.181],
        rotation: [0.8098, 1.4409, -2.3454],
        scale: [0.7197, 0.7197, 0.7197],
        weight: 13,
        shear: [0.2306, -0.0779, 0.1727],
        variations: [
          { type: "polar", weight: 0.3869 },
          { type: "linear", weight: 0.4345 },
        ],
      },
    ];
    const dustProbe = runChaosGame(dust, 4000, mulberry32(1));
    expect(
      occupiedCellCount(dustProbe.positions, dustProbe.count, dustProbe.bounds),
    ).toBeLessThan(MIN_OCCUPIED_CELLS);

    const healthy = runChaosGame(sierpinskiTetrahedron(), 4000, mulberry32(1));
    expect(
      occupiedCellCount(healthy.positions, healthy.count, healthy.bounds),
    ).toBeGreaterThanOrEqual(MIN_OCCUPIED_CELLS);
  });

  it("accepts a Bounds4 directly, for the 4D probe's projected-xyz occupancy check (fr-bf6.5)", () => {
    // The 8 corners of the unit cube again, but handed a Bounds4 (minW/maxW
    // included and ignored) instead of a Bounds -- occupiedCellCount only
    // ever reads the six x/y/z fields the two types share.
    const positions = new Float32Array(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
      ].flat(),
    );
    const bounds4 = makeBounds4({
      maxX: 1,
      maxY: 1,
      maxZ: 1,
      minW: -3,
      maxW: 3,
    });
    expect(occupiedCellCount(positions, 8, bounds4)).toBe(8);
  });
});
