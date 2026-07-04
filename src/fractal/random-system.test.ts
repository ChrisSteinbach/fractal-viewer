import {
  isAcceptableSystem,
  MIN_OCCUPIED_CELLS,
  occupiedCellCount,
  randomSystem,
} from "./random-system";
import { ESCAPE_LIMIT, runChaosGame } from "./chaos-game";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Bounds, Transform } from "./types";

const SEED_SAMPLE_SIZE = 50;

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
});
