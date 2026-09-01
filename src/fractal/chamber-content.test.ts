import { describe, expect, it } from "vitest";
import {
  chamberContentFit,
  poseTilingForContent,
  tilingClipHasAuthoredPose,
} from "./chamber-content";
import { foldToChamber, resolveTiling } from "./tiling";
import { sierpinskiTetrahedron, pentatope } from "./presets";
import { shapeSdf, type ShapeSpec } from "./shapes";
import { runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { toTransform4 } from "./affine4";
import { mulberry32 } from "./rng";
import type {
  HybridSchedule,
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "./types";

const TETRA = sierpinskiTetrahedron();
const PENTATOPE = pentatope();
const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };
const GEAR: ShapeSpec = {
  parts: [
    {
      primitive: {
        kind: "gear",
        teeth: 8,
        radius: 1,
        tooth: [0.22, 0.16],
        hole: 0.35,
        halfHeight: 0.25,
      },
      combine: "union",
    },
  ],
};

describe("chamberContentFit", () => {
  it("measures the folded 3D content away from the origin", () => {
    const fit = chamberContentFit(
      TETRA,
      null,
      resolveTiling({ group: "b3" })!,
      false,
    );
    expect(fit).not.toBeNull();
    // The B3 chamber cone's content: z well above the origin, radius ~0.8.
    expect(fit!.center[2]).toBeGreaterThan(0.5);
    expect(fit!.center[2]).toBeLessThan(1.2);
    expect(fit!.radius).toBeGreaterThan(0.5);
    expect(fit!.radius).toBeLessThan(1.2);
  });

  it("is deterministic for a fixed seed", () => {
    const tiling = resolveTiling({ group: "b3" })!;
    const a = chamberContentFit(TETRA, null, tiling, false);
    const b = chamberContentFit(TETRA, null, tiling, false);
    expect(a).toEqual(b);
  });

  it("folds the 4D content and fits its xyz only", () => {
    const fit = chamberContentFit(
      PENTATOPE,
      null,
      resolveTiling({ group: "a4" })!,
      true,
    );
    expect(fit).not.toBeNull();
    expect(fit!.center).toHaveLength(3);
    expect(Number.isFinite(fit!.center[0])).toBe(true);
    expect(Number.isFinite(fit!.center[1])).toBe(true);
    expect(Number.isFinite(fit!.center[2])).toBe(true);
    expect(fit!.radius).toBeGreaterThan(0);
  });

  it("mirrors the content for a lattice block", () => {
    const lattice = resolveTiling({ kind: "lattice", cellScale: 1.5 }, 2);
    const fit = chamberContentFit(TETRA, null, lattice, false);
    expect(fit).not.toBeNull();
    expect(fit!.radius).toBeGreaterThan(0.5);
  });

  it("returns null for an empty transform list", () => {
    expect(
      chamberContentFit([], null, resolveTiling({ group: "a3" })!, false),
    ).toBeNull();
  });

  it("measures the scheduled post-word in both seeded 4D passes", () => {
    const tiling = resolveTiling({ group: "a4" })!;
    const schedule: HybridSchedule = {
      transforms: [
        {
          id: 90,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [2, 2, 2],
        },
      ],
      depth: 1,
    };
    const scheduled = chamberContentFit(
      PENTATOPE,
      null,
      tiling,
      true,
      NO_SYMMETRY,
      schedule,
      4_000,
    )!;
    const run = runChaosGame4(
      PENTATOPE.map(toTransform4),
      4_000,
      mulberry32(0x7a7c),
      null,
      NO_SYMMETRY,
      undefined,
      schedule,
    );
    const folded: Vec4[] = [];
    for (let i = 0; i < run.count; i++) {
      const q = foldToChamber(
        tiling.info,
        [
          run.positions[i * 3],
          run.positions[i * 3 + 1],
          run.positions[i * 3 + 2],
          run.w[i],
        ],
        [0, 0, 0, 0],
      );
      if (q) folded.push(q as Vec4);
    }
    const expectedCenter: Vec3 = [
      folded.reduce((sum, q) => sum + q[0], 0) / folded.length,
      folded.reduce((sum, q) => sum + q[1], 0) / folded.length,
      folded.reduce((sum, q) => sum + q[2], 0) / folded.length,
    ];
    const expectedRadius = folded.reduce(
      (radius, q) =>
        Math.max(
          radius,
          Math.hypot(
            q[0] - expectedCenter[0],
            q[1] - expectedCenter[1],
            q[2] - expectedCenter[2],
          ),
        ),
      0,
    );
    expect(scheduled.center[0]).toBeCloseTo(expectedCenter[0], 10);
    expect(scheduled.center[1]).toBeCloseTo(expectedCenter[1], 10);
    expect(scheduled.center[2]).toBeCloseTo(expectedCenter[2], 10);
    expect(scheduled.radius).toBeCloseTo(expectedRadius, 10);
  });

  it("uses the requested symmetry in the centroid and radius passes", () => {
    const system: Transform[] = [
      {
        id: 0,
        position: [1, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.2, 0.2, 0.2],
      },
    ];
    const symmetry: SymmetryParams = { order: 2, plane: "xy" };
    const tiling = resolveTiling({ kind: "lattice", cellScale: 10 }, 10);
    const fit = chamberContentFit(
      system,
      null,
      tiling,
      false,
      symmetry,
      null,
      4_000,
    )!;
    const run = runChaosGame(system, 4_000, mulberry32(0x7a7c), null, symmetry);
    let expectedRadius = 0;
    for (let i = 0; i < run.count; i++) {
      expectedRadius = Math.max(
        expectedRadius,
        Math.hypot(
          run.positions[i * 3] - fit.center[0],
          run.positions[i * 3 + 1] - fit.center[1],
          run.positions[i * 3 + 2] - fit.center[2],
        ),
      );
    }
    expect(Math.abs(fit.center[0])).toBeLessThan(0.1);
    expect(fit.radius).toBeCloseTo(expectedRadius, 10);
    expect(fit.radius).toBeGreaterThan(0.5);
  });
});

describe("poseTilingForContent", () => {
  it("poses an unposed clip onto the measured content so the trim is real", () => {
    const tiling = resolveTiling({ group: "b3", clip: GEAR })!;
    const fit = chamberContentFit(TETRA, null, tiling, false)!;
    const posed = poseTilingForContent(tiling, fit);
    expect(posed).not.toBe(tiling);
    expect(posed.clip!.parts[0].pose).toEqual({
      offset: [fit.center[0], fit.center[1], fit.center[2]],
      scale: fit.radius,
    });
    // The trim is now real: the posed gear overlaps content that the
    // unposed origin gear misses entirely.
    const run = runChaosGame(TETRA, 20000, mulberry32(9), null);
    let survive = 0;
    let total = 0;
    for (let i = 0; i < run.count; i++) {
      const p: Vec3 = [
        run.positions[i * 3],
        run.positions[i * 3 + 1],
        run.positions[i * 3 + 2],
      ];
      const q = foldToChamber(tiling.info, p, [0, 0, 0]);
      if (!q) continue;
      total++;
      if (shapeSdf(posed.clip!, q[0], q[1], q[2]) < 0) survive++;
    }
    expect(total).toBeGreaterThan(0);
    expect(survive).toBeGreaterThan(0);
    expect(survive).toBeLessThan(total);
  });

  it("leaves an authored pose untouched and the document unchanged", () => {
    const authored = resolveTiling({
      group: "b3",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.5 },
            combine: "union",
            pose: { offset: [1, 2, 3] },
          },
        ],
      },
    })!;
    const fit = chamberContentFit(TETRA, null, authored, false)!;
    expect(tilingClipHasAuthoredPose(authored)).toBe(true);
    const posed = poseTilingForContent(authored, fit);
    expect(posed).toBe(authored);
    expect(authored.clip!.parts[0].pose).toEqual({ offset: [1, 2, 3] });
  });

  it("poses every part of an unposed compound clip as one shape", () => {
    const clip: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "torus", major: 1, minor: 0.12 },
          combine: "union",
        },
        {
          primitive: {
            kind: "capsule",
            a: [0, -1, 0],
            b: [0, 1, 0],
            radius: 0.12,
          },
          combine: "union",
        },
      ],
    };
    const tiling = resolveTiling({ group: "b3", clip })!;
    const fit = { center: [1, 2, 3] as Vec3, radius: 0.75 };
    const posed = poseTilingForContent(tiling, fit);
    expect(posed.clip!.parts.map((part) => part.pose)).toEqual([
      { offset: [1, 2, 3], scale: 0.75 },
      { offset: [1, 2, 3], scale: 0.75 },
    ]);
    expect(tiling.clip!.parts.every((part) => part.pose === undefined)).toBe(
      true,
    );
  });

  it("leaves the whole compound clip authored when any part has a pose", () => {
    const authored = resolveTiling({
      group: "b3",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.5 },
            combine: "union",
          },
          {
            primitive: { kind: "sphere", radius: 0.25 },
            combine: "union",
            pose: { rotate: [0, 0, Math.PI / 2] },
          },
        ],
      },
    })!;
    expect(tilingClipHasAuthoredPose(authored)).toBe(true);
    expect(
      poseTilingForContent(authored, {
        center: [1, 2, 3],
        radius: 0.75,
      }),
    ).toBe(authored);
  });

  it("returns the tiling unchanged without a clip or fit", () => {
    const plain = resolveTiling({ group: "a3" })!;
    expect(poseTilingForContent(plain, { center: [0, 0, 0], radius: 1 })).toBe(
      plain,
    );
    const clipped = resolveTiling({ group: "a3", clip: GEAR })!;
    expect(poseTilingForContent(clipped, null)).toBe(clipped);
  });
});
