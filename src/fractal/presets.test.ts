import { composeAffine } from "./affine";
import { runChaosGame } from "./chaos-game";
import {
  appendTransform,
  barnsleyFern,
  chiralLace,
  curlingFern,
  defaultTransforms,
  dodecahedronFlake,
  icosahedronFlake,
  jerusalemCube,
  mengerSponge,
  nextId,
  octahedronFlake,
  PRESET_NAMES,
  presetTransforms,
  sierpinskiPyramid,
  sierpinskiTetrahedron,
  spiral,
  sphericalFlame,
  swirlFlame,
} from "./presets";
import { mulberry32 } from "./rng";

describe("presets", () => {
  it("defaultTransforms has four maps", () => {
    expect(defaultTransforms()).toHaveLength(4);
  });

  it("sierpinskiTetrahedron has four maps", () => {
    expect(sierpinskiTetrahedron()).toHaveLength(4);
  });

  it("mengerSponge has the 20 non-face sub-cubes at scale 1/3", () => {
    const transforms = mengerSponge();
    expect(transforms).toHaveLength(20);
    for (const t of transforms) {
      expect(t.scale).toEqual([1 / 3, 1 / 3, 1 / 3]);
    }
  });

  it("spiral has six maps", () => {
    expect(spiral()).toHaveLength(6);
  });

  it("sierpinskiPyramid has five maps", () => {
    expect(sierpinskiPyramid()).toHaveLength(5);
  });

  it("octahedronFlake has six maps", () => {
    expect(octahedronFlake()).toHaveLength(6);
  });

  it("icosahedronFlake has twelve maps", () => {
    expect(icosahedronFlake()).toHaveLength(12);
  });

  it("dodecahedronFlake has twenty maps", () => {
    expect(dodecahedronFlake()).toHaveLength(20);
  });

  it("assigns unique ids within each preset", () => {
    const ids = dodecahedronFlake().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("presetTransforms", () => {
  // The system the viewer boots with must be reachable from the menu, or it is
  // an orphan the user can never return to once they pick another preset.
  it("the 'default' preset is the startup system", () => {
    expect(presetTransforms("default")).toEqual(defaultTransforms());
  });

  it("every preset name builds a non-empty system", () => {
    for (const name of PRESET_NAMES) {
      expect(presetTransforms(name).length).toBeGreaterThan(0);
    }
  });
});

// Every map must contract (scale < 1 on all axes), or the chaos game escapes
// instead of converging onto an attractor.
describe("flake presets converge", () => {
  const flakes = {
    sierpinskiPyramid: sierpinskiPyramid(),
    octahedronFlake: octahedronFlake(),
    icosahedronFlake: icosahedronFlake(),
    dodecahedronFlake: dodecahedronFlake(),
  };

  for (const [name, transforms] of Object.entries(flakes)) {
    it(`${name} uses only contractions`, () => {
      for (const t of transforms) {
        expect(Math.max(...t.scale)).toBeLessThan(1);
        expect(Math.min(...t.scale)).toBeGreaterThan(0);
      }
    });

    it(`${name} renders a finite, bounded cloud`, () => {
      const { bounds } = runChaosGame(transforms, 2000, mulberry32(1));
      for (const v of Object.values(bounds)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(10);
      }
    });
  }
});

describe("jerusalemCube", () => {
  it("has eight large corner cubes and twelve small edge cubes", () => {
    const big = Math.SQRT2 - 1;
    const small = big * big;
    const transforms = jerusalemCube();
    const atScale = (s: number) =>
      transforms.filter((t) => t.scale.every((c) => Math.abs(c - s) < 1e-9))
        .length;
    expect(transforms).toHaveLength(20);
    expect(atScale(big)).toBe(8);
    expect(atScale(small)).toBe(12);
  });

  it("uses only contractions", () => {
    for (const t of jerusalemCube()) {
      expect(Math.max(...t.scale)).toBeLessThan(1);
      expect(Math.min(...t.scale)).toBeGreaterThan(0);
    }
  });

  it("renders a finite, bounded cloud", () => {
    const { bounds } = runChaosGame(jerusalemCube(), 2000, mulberry32(1));
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(10);
    }
  });
});

describe("chiralLace", () => {
  it("has four maps", () => {
    expect(chiralLace()).toHaveLength(4);
  });

  // The mirror is the whole point — without a sign flip it is just a plain
  // flake — but a reflected map must still contract or the cloud escapes.
  it("reflects on an axis yet contracts on every axis", () => {
    const transforms = chiralLace();
    expect(transforms.some((t) => t.scale.some((c) => c < 0))).toBe(true);
    for (const t of transforms) {
      for (const c of t.scale) {
        expect(Math.abs(c)).toBeGreaterThan(0);
        expect(Math.abs(c)).toBeLessThan(1);
      }
    }
  });

  it("renders a finite, bounded cloud", () => {
    const { bounds } = runChaosGame(chiralLace(), 2000, mulberry32(1));
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(10);
    }
  });
});

describe("barnsleyFern", () => {
  // Four maps now that the chaos game samples by weight — no duplication.
  it("is a compact four-map weighted system", () => {
    const transforms = barnsleyFern();
    expect(transforms).toHaveLength(4);
    expect(transforms.some((t) => (t.weight ?? 1) !== 1)).toBe(true);
  });

  // The frond map must dominate selection for the frond to develop; Barnsley
  // runs it the large majority of the time.
  it("weights the frond map far above the leaflets", () => {
    const weights = barnsleyFern().map((t) => t.weight ?? 1);
    const total = weights.reduce((sum, w) => sum + w, 0);
    expect(Math.max(...weights) / total).toBeGreaterThan(0.5);
  });

  // Every map must contract (no axis magnitude ≥ 1) or the cloud escapes. The
  // right leaflet reflects — its 2x2 has a negative determinant, encoded as a
  // negative scale axis. Barnsley's stem is rank-1: its x-scale is exactly 0
  // (the plane collapses onto the stem line), so the bound is |scale| < 1 with
  // no positive lower bound.
  it("contracts on every axis and reflects the right leaflet", () => {
    const transforms = barnsleyFern();
    expect(transforms.some((t) => t.scale.some((c) => c < 0))).toBe(true);
    for (const t of transforms) {
      for (const c of t.scale) {
        expect(Math.abs(c)).toBeLessThan(1);
      }
    }
  });

  // The whole point of this preset: the maps are Barnsley's published affine
  // transforms verbatim, not the rotation+scale similarities that approximate
  // them. Conjugation by the re-centring similarity leaves each linear part
  // intact, so the composed map's xy block must be his exact 2x2 — including
  // the right leaflet's shear (m[1] = 0.28) and reflection that a pure
  // scale+rotation cannot express.
  it("expresses Barnsley's exact linear parts", () => {
    // [a, b, c, d] per map, in barnsleyFern() order: stem, frond, left, right.
    const barnsley = [
      [0, 0, 0, 0.16],
      [0.85, 0.04, -0.04, 0.85],
      [0.2, -0.26, 0.23, 0.22],
      [-0.15, 0.28, 0.26, 0.24],
    ];
    const maps = barnsleyFern();
    barnsley.forEach(([a, b, c, d], i) => {
      const { m } = composeAffine(maps[i]);
      expect(m[0]).toBeCloseTo(a, 10);
      expect(m[1]).toBeCloseTo(b, 10);
      expect(m[3]).toBeCloseTo(c, 10);
      expect(m[4]).toBeCloseTo(d, 10);
    });
  });

  // A fern frond is a flat leaf, taller than it is wide: the cloud collapses
  // onto a plane (negligible depth) and its height dominates its width.
  it("renders a flat, upright leaf", () => {
    const { bounds } = runChaosGame(barnsleyFern(), 4000, mulberry32(1));
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(10);
    }
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const depth = bounds.maxZ - bounds.minZ;
    expect(height).toBeGreaterThan(width);
    expect(depth).toBeLessThan(0.01 * height);
  });
});

describe("curlingFern", () => {
  // Same four weighted maps as the flat fern — it is the planar fern with one
  // map tilted out of plane, not a different system.
  it("is a four-map weighted system like the flat fern", () => {
    const transforms = curlingFern();
    expect(transforms).toHaveLength(4);
    expect(transforms.some((t) => (t.weight ?? 1) !== 1)).toBe(true);
  });

  // The curl lives on exactly one map — the dominant frond (highest weight),
  // which alone climbs the rachis — tilted about x. That single compounding
  // tilt is what lifts the tip out of plane.
  it("tilts only the dominant frond map out of plane", () => {
    const transforms = curlingFern();
    const tilted = transforms.filter((t) => t.rotation[0] !== 0);
    expect(tilted).toHaveLength(1);
    const maxWeight = Math.max(...transforms.map((t) => t.weight ?? 1));
    expect(tilted[0].weight).toBe(maxWeight);
  });

  // Unlike the flat fern (depth ≈ 0), the curl gives the leaf real depth while
  // it stays an upright leaf — taller than wide, and not ballooned into a blob.
  it("lifts the leaf out of plane while staying upright", () => {
    const { bounds } = runChaosGame(curlingFern(), 4000, mulberry32(1));
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(10);
    }
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const depth = bounds.maxZ - bounds.minZ;
    expect(height).toBeGreaterThan(width);
    expect(depth).toBeGreaterThan(0.1 * height); // genuinely 3-D, not flat
    expect(depth).toBeLessThan(height); // still a leaf, not a blob
  });
});

describe("variation flame presets", () => {
  it("sphericalFlame is three maps, each carrying a spherical variation", () => {
    const transforms = sphericalFlame();
    expect(transforms).toHaveLength(3);
    for (const t of transforms) {
      expect(t.variations).toEqual([{ type: "spherical", weight: 1 }]);
    }
  });

  it("swirlFlame blends swirl with a touch of linear across two maps", () => {
    const transforms = swirlFlame();
    expect(transforms).toHaveLength(2);
    for (const t of transforms) {
      expect(t.variations?.map((v) => v.type)).toEqual(["swirl", "linear"]);
    }
  });

  // Nonlinear maps can diverge at singularities; the point of the test is that
  // the chaos game's guard keeps the whole cloud finite (never NaN/Inf) and the
  // attractor has real extent rather than collapsing to a point.
  for (const [name, transforms] of Object.entries({
    sphericalFlame: sphericalFlame(),
    swirlFlame: swirlFlame(),
  })) {
    it(`${name} renders a finite, non-degenerate cloud`, () => {
      const { bounds } = runChaosGame(transforms, 3000, mulberry32(1));
      for (const v of Object.values(bounds)) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
      expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
    });
  }
});

describe("nextId", () => {
  it("is 0 for an empty list", () => {
    expect(nextId([])).toBe(0);
  });

  it("is one past the highest existing id", () => {
    expect(nextId(defaultTransforms())).toBe(4);
  });
});

describe("appendTransform", () => {
  it("adds one transform without mutating the input", () => {
    const before = defaultTransforms();
    const after = appendTransform(before, mulberry32(1));
    expect(before).toHaveLength(4);
    expect(after).toHaveLength(5);
  });

  it("gives the new transform a fresh id", () => {
    const after = appendTransform(defaultTransforms(), mulberry32(1));
    expect(after[4].id).toBe(4);
  });

  it("is deterministic with a seeded RNG", () => {
    const a = appendTransform(defaultTransforms(), mulberry32(2));
    const b = appendTransform(defaultTransforms(), mulberry32(2));
    expect(a[4].position).toEqual(b[4].position);
  });
});
