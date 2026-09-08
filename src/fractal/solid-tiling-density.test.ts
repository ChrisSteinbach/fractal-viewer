import { describe, expect, it } from "vitest";
import { buildBalloonFromBall, invertBalloon } from "./balloon-de";
import { sampleSolidTiledVoxelAlpha } from "./solid-tiling-density";
import { enumerateOrbit, isInChamber, resolveTiling } from "./tiling";
import type { Vec3 } from "./types";
import { sampleVoxelAlpha } from "./voxel-raymarch";

const SIZE = 4;
const MIN: Vec3 = [0.05, 0.3, 0.9];
const MAX: Vec3 = [0.25, 0.5, 1.1];
const SOURCE: Vec3 = [0.15, 0.4, 1];
const DATA = new Uint8Array(SIZE ** 3 * 4);
for (let i = 0; i < SIZE ** 3; i++) DATA[4 * i + 3] = 80 + ((i * 37) % 176);

describe("sampleSolidTiledVoxelAlpha", () => {
  it.each(["a3", "b3", "h3"] as const)(
    "agrees with an explicit %s orbit at source and inverted echo positions beyond the original box",
    (group) => {
      const tiling = resolveTiling({ group });
      if (!tiling) throw new Error("finite fixture did not resolve");
      const balloon = buildBalloonFromBall(
        { center: [0, 0, 0], radius: 1.25 },
        1.6,
      );
      const images: number[][] = [];
      enumerateOrbit(tiling.info, SOURCE, images);
      const explicit = (p: Vec3): number => {
        const queries: number[][] = [];
        enumerateOrbit(tiling.info, p, queries);
        return Math.max(
          0,
          ...queries
            .filter((q) => isInChamber(tiling.info, q as Vec3))
            .map((q) => sampleVoxelAlpha(DATA, SIZE, MIN, MAX, q as Vec3)),
        );
      };
      const tiled = (p: Vec3) =>
        sampleSolidTiledVoxelAlpha(DATA, SIZE, MIN, MAX, p, tiling);
      const sourceAlpha = sampleVoxelAlpha(DATA, SIZE, MIN, MAX, SOURCE);
      let reflectedOutsideBox = 0;
      for (const image of images) {
        const p = image as Vec3;
        expect(tiled(p)).toBeCloseTo(sourceAlpha, 10);
        expect(tiled(p)).toBeCloseTo(explicit(p), 10);
        if (sampleVoxelAlpha(DATA, SIZE, MIN, MAX, p) === 0)
          reflectedOutsideBox++;
        const echoPoint = invertBalloon(balloon, p);
        expect(Math.hypot(...echoPoint)).toBeGreaterThan(balloon.rho);
        expect(tiled(echoPoint)).toBe(0);
        const invertedQuery = invertBalloon(balloon, echoPoint);
        expect(tiled(invertedQuery)).toBeCloseTo(explicit(invertedQuery), 10);
        expect(tiled(invertedQuery)).toBeCloseTo(sourceAlpha, 10);
        expect(sampleVoxelAlpha(DATA, SIZE, MIN, MAX, echoPoint)).toBe(0);
      }
      expect(reflectedOutsideBox).toBeGreaterThan(0);
    },
  );

  it("applies a live analytic clip to the origin density used by Balloon's infinity refusal", () => {
    const data = new Uint8Array(SIZE ** 3 * 4).fill(255);
    const boundsMin: Vec3 = [-1, -1, -1];
    const boundsMax: Vec3 = [1, 1, 1];
    const origin: Vec3 = [0, 0, 0];
    const plain = resolveTiling({ group: "a3" });
    const clipped = resolveTiling({
      group: "a3",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.1 },
            combine: "union",
            pose: { offset: [0.5, 0.5, 0.5] },
          },
        ],
      },
    });
    expect(
      sampleSolidTiledVoxelAlpha(
        data,
        SIZE,
        boundsMin,
        boundsMax,
        origin,
        plain,
      ),
    ).toBe(1);
    expect(
      sampleSolidTiledVoxelAlpha(
        data,
        SIZE,
        boundsMin,
        boundsMax,
        origin,
        clipped,
      ),
    ).toBe(0);
  });

  it("leaves a baked projected 4D volume unfurled and forbids a post-projection 4D fold", () => {
    const p: Vec3 = [-0.15, 0.4, 1];
    expect(sampleSolidTiledVoxelAlpha(DATA, SIZE, MIN, MAX, p, null)).toBe(
      sampleVoxelAlpha(DATA, SIZE, MIN, MAX, p),
    );
    expect(() =>
      sampleSolidTiledVoxelAlpha(
        DATA,
        SIZE,
        MIN,
        MAX,
        p,
        resolveTiling({ group: "a4" }),
      ),
    ).toThrow(/projected 4D volume/);
  });
});
