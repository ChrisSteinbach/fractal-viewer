import {
  condensationBoundingRadius3,
  condensationDistance3,
  condensationDistance4,
  condensationHasFutureDepth,
  condensationTerm3,
  condensationTerm4,
  resolveCondensationDepthBand,
} from "./condensation-de";
import type { CondensationDE3, CondensationDE4 } from "./condensation-de";
import type { ShapeSpec } from "./shapes";

const SPHERE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "sphere", radius: 1 },
      combine: "union",
    },
  ],
};

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function de3(band = resolveCondensationDepthBand()): CondensationDE3 {
  return {
    depthBand: band,
    emitters: [
      {
        shape: SPHERE,
        invM: I3,
        invT: [0, 0, 0],
        sigmaMin: 1,
        center: [0, 0, 0],
        radius: 1,
        baseIndex: 3,
        shadeIndex: 3,
      },
    ],
  };
}

function de4(): CondensationDE4 {
  return {
    depthBand: resolveCondensationDepthBand(),
    emitters: [
      {
        shape: SPHERE,
        invM: I4,
        invT: [0, 0, 0, 0],
        sigmaMin: 1,
        center: [0, 0, 0, 0],
        radius: 1,
        baseIndex: 2,
        shadeIndex: 2,
      },
    ],
  };
}

describe("condensation depth bands", () => {
  it("resolves all/root/depth-1 bands inclusively", () => {
    const all = de3();
    expect(condensationTerm3(all, 0, 1, 2, 0, 0)).toBeCloseTo(0.9, 12);
    expect(condensationTerm3(all, 7, 1, 2, 0, 0)).toBeCloseTo(0.9, 12);

    const root = de3(resolveCondensationDepthBand({ maxDepth: 0 }));
    expect(condensationTerm3(root, 0, 2, 2, 0, 0)).toBeCloseTo(1.8, 12);
    expect(condensationTerm3(root, 1, 2, 2, 0, 0)).toBe(Infinity);

    const depth1 = de3(
      resolveCondensationDepthBand({ minDepth: 1, maxDepth: 1 }),
    );
    expect(condensationTerm3(depth1, 0, 1, 2, 0, 0)).toBe(Infinity);
    expect(condensationTerm3(depth1, 1, 0.5, 2, 0, 0)).toBeCloseTo(0.45, 12);

    const reversed = resolveCondensationDepthBand({
      minDepth: 4,
      maxDepth: 2,
    });
    expect(reversed).toEqual({ minDepth: 2, maxDepth: 4 });
    expect(condensationTerm3(de3(reversed), 2, 1, 2, 0, 0)).toBeCloseTo(
      0.9,
      12,
    );
    expect(condensationHasFutureDepth(reversed, 2)).toBe(true);
    expect(condensationHasFutureDepth(reversed, 4)).toBe(false);
  });
});

describe("condensation shape distances", () => {
  it("uses inverse-frame 3D SDF and a direct C0 radius", () => {
    const de = de3();
    expect(condensationDistance3(de, 2.5, 0, 0)).toBeCloseTo(1.5, 12);
    expect(condensationDistance3(de, 0, 0, 0)).toBeCloseTo(-1, 12);
    expect(condensationBoundingRadius3(de)).toBe(1);
  });

  it("embeds the solid at w=0 in 4D instead of extruding it", () => {
    const de = de4();
    expect(condensationDistance4(de, 2, 0, 0, 0.75)).toBeCloseTo(1.25, 12);
    expect(condensationDistance4(de, 0, 0, 0, 0.75)).toBeCloseTo(0.75, 12);
    expect(condensationTerm4(de, 0, 2, 0, 0, 0, 0.75)).toBeCloseTo(1.35, 12);
  });
});
