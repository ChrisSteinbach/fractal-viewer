import { runChaosGame } from "./chaos-game";
import {
  appendTransform,
  chiralLace,
  defaultTransforms,
  dodecahedronFlake,
  fern,
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

describe("fern", () => {
  // Barnsley weights the frond map far above the leaflets; with no per-map
  // weight in the chaos game, the fern encodes that by emitting the frond map
  // many times, so the system has the same geometry repeated.
  it("repeats a map to weight it", () => {
    const transforms = fern();
    const geometries = transforms.map((t) =>
      JSON.stringify([t.position, t.rotation, t.scale]),
    );
    expect(new Set(geometries).size).toBeLessThan(transforms.length);
  });

  // Every map must contract (|scale| < 1 on each axis) or the cloud escapes;
  // one axis is negative — the mirror reflection of the right-hand leaflet.
  it("contracts on every axis, with a reflected leaflet", () => {
    const transforms = fern();
    expect(transforms.some((t) => t.scale.some((c) => c < 0))).toBe(true);
    for (const t of transforms) {
      for (const c of t.scale) {
        expect(Math.abs(c)).toBeGreaterThan(0);
        expect(Math.abs(c)).toBeLessThan(1);
      }
    }
  });

  // A fern frond is a flat leaf, taller than it is wide: the cloud collapses
  // onto a plane (negligible depth) and its height dominates its width.
  it("renders a flat, upright leaf", () => {
    const { bounds } = runChaosGame(fern(), 4000, mulberry32(1));
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
