import { composeAffine } from "./affine";
import { toTransform4 } from "./affine4";
import { runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import {
  appendTransform,
  barnsleyFern,
  chiralLace,
  curlingFern,
  defaultTransforms,
  dodecahedronFlake,
  doubleRotation,
  duoprism,
  duoprismWireframe,
  hyperfern,
  icosahedronFlake,
  jerusalemCube,
  mengerSponge,
  nextId,
  octahedronFlake,
  pentatope,
  pentatopeWireframe,
  PRESET_NAMES,
  PRESET_RENDER_HINTS,
  PRESET_SCAFFOLDS,
  presetTransforms,
  radiolarian,
  sierpinskiPyramid,
  sierpinskiTetrahedron,
  sixteenCellFlake,
  sixteenCellWireframe,
  spiral,
  swirlFlame,
  tesseract,
  tesseractWireframe,
  twentyFourCellFlake,
  twentyFourCellWireframe,
} from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Vec4 } from "./types";

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
  it("radiolarian is the icosahedron flake with a partial spherical warp", () => {
    const transforms = radiolarian();
    expect(transforms).toHaveLength(12);
    for (const t of transforms) {
      expect(t.variations).toEqual([
        { type: "linear", weight: 1 },
        { type: "spherical", weight: 0.32 },
      ]);
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
    radiolarian: radiolarian(),
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

function dot4(a: Vec4, b: Vec4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

describe("pentatope (unified 4D preset)", () => {
  it("lifts to five half-scale contractions of all of 4-space (w scale derived)", () => {
    const lifted = pentatope().map(toTransform4);
    expect(lifted).toHaveLength(5);
    // scale[3] is exactly 0.5 because it is DERIVED — the mean contraction of
    // [½, ½, ½] — not because the preset pins it (w.scale stays absent).
    for (const m of lifted) expect(m.scale).toEqual([0.5, 0.5, 0.5, 0.5]);
    for (const t of pentatope()) expect(t.w?.scale).toBeUndefined();
  });

  it("places its lifted fixed points on a unit regular 4-simplex (|v| = 1, pairwise dot −1/4)", () => {
    // Each lifted map's fixed point is v = 2·position (scale ½ ⇒ x* = 2·position).
    const vertices = pentatope()
      .map(toTransform4)
      .map((m): Vec4 => [
        m.position[0] * 2,
        m.position[1] * 2,
        m.position[2] * 2,
        m.position[3] * 2,
      ]);
    for (const v of vertices) {
      expect(Math.sqrt(dot4(v, v))).toBeCloseTo(1, 12);
    }
    for (let i = 0; i < vertices.length; i++) {
      for (let j = i + 1; j < vertices.length; j++) {
        expect(dot4(vertices[i], vertices[j])).toBeCloseTo(-0.25, 12);
      }
    }
  });
});

describe("pentatopeWireframe (legibility scaffold)", () => {
  it("has the 5-cell's ten edges, all of the regular simplex's edge length", () => {
    const edges = pentatopeWireframe();
    expect(edges).toHaveLength(10);
    // Unit-circumradius regular 4-simplex edge: |a − b|² = 2 − 2·(a·b) = 2.5.
    for (const [a, b] of edges) {
      const d: Vec4 = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
      expect(Math.sqrt(dot4(d, d))).toBeCloseTo(Math.sqrt(2.5), 12);
    }
  });

  // Adapted for the unified factory (fr-bf6): the wireframe's vertices must be
  // exactly the LIFTED gasket's fixed points, not the native-Transform4
  // pentatopeGasket's — the fixed point of a lifted map (scale ½) is
  // 2 · position, INCLUDING the lifted w (position[3]).
  it("uses exactly the lifted gasket's fixed points", () => {
    const fixed = pentatope()
      .map(toTransform4)
      .map((m) => m.position.map((p) => p * 2).join());
    for (const [a, b] of pentatopeWireframe()) {
      expect(fixed).toContain(a.join());
      expect(fixed).toContain(b.join());
    }
  });
});

describe("doubleRotation (unified 4D preset)", () => {
  it("lifts the Euler-z swirl and the zw w-rotation into one double rotation", () => {
    // Individual fields, not whole-object equality: the embed also writes the
    // flat planes (yz: rx, xz: −ry), whose −0/0 distinctions are noise here.
    const [swirlMap] = doubleRotation().map(toTransform4);
    expect(swirlMap.rotation?.xy).toBe(0.55);
    expect(swirlMap.rotation?.zw).toBe(0.34);
  });

  it("lifts the seed map's w offset", () => {
    const seed = toTransform4(doubleRotation()[1]);
    expect(seed.position[3]).toBe(0.75);
  });

  it("lifts to contractive maps only, derived w scales included", () => {
    const lifted = doubleRotation().map(toTransform4);
    for (const m of lifted) {
      for (const s of m.scale) expect(Math.abs(s)).toBeLessThan(1);
    }
    // The derived w scales are each map's mean spatial contraction.
    expect(lifted[0].scale[3]).toBeCloseTo(0.93, 12);
    expect(lifted[1].scale[3]).toBeCloseTo(0.22, 12);
  });

  it("fills all four dimensions, stays bounded, and carries visible w structure", () => {
    const result = runChaosGame4(
      doubleRotation().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    // Genuinely 4D: every coordinate opens up, not collapsed to a lower flat.
    expect(maxX - minX).toBeGreaterThan(0.2);
    expect(maxY - minY).toBeGreaterThan(0.2);
    expect(maxZ - minZ).toBeGreaterThan(0.2);
    expect(maxW - minW).toBeGreaterThan(0.2);
    // Bounded (contractive maps never let it run away).
    expect(result.radius).toBeLessThan(3);
    // The double-rotation signature: the zw-plane spin pushes points well off
    // the w = 0 slice a 3D system could never leave.
    let farW = 0;
    for (const w of result.w) farW = Math.max(farW, Math.abs(w));
    expect(farW).toBeGreaterThan(0.15);
  });
});

/** The lifted fixed point of a uniform flake map: `x* = position / (1 − r)`. */
function liftedFixedPoint(t: Transform, ratio: number): Vec4 {
  const m = toTransform4(t);
  const k = 1 / (1 - ratio);
  return [
    m.position[0] * k,
    m.position[1] * k,
    m.position[2] * k,
    m.position[3] * k,
  ];
}

function edgeLength(edge: [Vec4, Vec4]): number {
  const [a, b] = edge;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

describe("tesseract (4D preset)", () => {
  it("has sixteen ⅓-scale maps whose lifted fixed points are the 4-cube's corners", () => {
    const transforms = tesseract();
    expect(transforms).toHaveLength(16);
    for (const t of transforms) {
      expect(t.scale).toEqual([1 / 3, 1 / 3, 1 / 3]);
      // w.scale absent ⇒ derived as the mean contraction, exactly the ratio.
      expect(t.w?.scale).toBeUndefined();
      expect(toTransform4(t).scale[3]).toBeCloseTo(1 / 3, 12);
      // Every corner coordinate is ±h — the (±h)⁴ sign lattice.
      for (const c of liftedFixedPoint(t, 1 / 3)) {
        expect(Math.abs(c)).toBeCloseTo(0.65, 12);
      }
    }
    // All sixteen sign choices, no corner doubled.
    const corners = new Set(
      transforms.map((t) =>
        liftedFixedPoint(t, 1 / 3)
          .map((c) => Math.sign(c))
          .join(),
      ),
    );
    expect(corners.size).toBe(16);
  });

  // Ratio ⅓ makes the attractor the four-fold product of middle-third Cantor
  // sets: the dust must span the full ±h cube on EVERY axis, w included.
  it("renders Cantor dust with full, equal extent on all four axes", () => {
    const result = runChaosGame4(
      tesseract().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    for (const extent of [maxX - minX, maxY - minY, maxZ - minZ, maxW - minW]) {
      expect(extent).toBeGreaterThan(1.2);
      expect(extent).toBeLessThanOrEqual(1.3 + 1e-6);
    }
    expect(result.radius).toBeLessThan(1.4);
  });

  it("wireframe has the tesseract's 32 edges, all one coordinate-flip long", () => {
    const edges = tesseractWireframe();
    expect(edges).toHaveLength(32);
    for (const edge of edges) {
      expect(edgeLength(edge)).toBeCloseTo(1.3, 12);
    }
  });
});

describe("sixteenCellFlake (4D preset)", () => {
  it("has eight 0.4-scale maps toward ±r on each of the four axes", () => {
    const transforms = sixteenCellFlake();
    expect(transforms).toHaveLength(8);
    for (const t of transforms) {
      expect(t.scale).toEqual([0.4, 0.4, 0.4]);
      // Cross-polytope vertex: exactly one nonzero coordinate, at radius r.
      const coords = liftedFixedPoint(t, 0.4).map((c) => Math.abs(c));
      const nonzero = coords.filter((c) => c > 1e-12);
      expect(nonzero).toHaveLength(1);
      expect(nonzero[0]).toBeCloseTo(1.3, 12);
    }
  });

  // The 4D signature: unlike its 3D sibling (octahedronFlake, w extent 0),
  // the two ±w lobes give the attractor the same span in w as in x/y/z.
  it("spans w as fully as the three visible axes", () => {
    const result = runChaosGame4(
      sixteenCellFlake().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    for (const extent of [maxX - minX, maxY - minY, maxZ - minZ, maxW - minW]) {
      expect(extent).toBeGreaterThan(2.3);
      expect(extent).toBeLessThanOrEqual(2.6 + 1e-6);
    }
  });

  it("wireframe has the 16-cell's 24 edges (no antipodal pairs)", () => {
    const edges = sixteenCellWireframe();
    expect(edges).toHaveLength(24);
    // Every edge joins vertices on DIFFERENT axes (√2·r); the four antipodal
    // pairs (length 2r) are diagonals, not edges.
    for (const edge of edges) {
      expect(edgeLength(edge)).toBeCloseTo(1.3 * Math.SQRT2, 12);
    }
  });
});

describe("twentyFourCellFlake (4D preset)", () => {
  it("has 24 maps at 0.3 scale toward the (±1, ±1, 0, 0) permutations", () => {
    const transforms = twentyFourCellFlake();
    expect(transforms).toHaveLength(24);
    const s = 1.4 / Math.SQRT2;
    const seen = new Set<string>();
    for (const t of transforms) {
      expect(t.scale).toEqual([0.3, 0.3, 0.3]);
      const v = liftedFixedPoint(t, 0.3);
      // Exactly two nonzero coordinates of magnitude s ⇒ vertex norm 1.4.
      const nonzero = v.filter((c) => Math.abs(c) > 1e-12);
      expect(nonzero).toHaveLength(2);
      for (const c of nonzero) expect(Math.abs(c)).toBeCloseTo(s, 12);
      seen.add(v.map((c) => Math.round(c / s)).join());
    }
    expect(seen.size).toBe(24);
  });

  it("fills all four dimensions and stays bounded", () => {
    const result = runChaosGame4(
      twentyFourCellFlake().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    for (const extent of [maxX - minX, maxY - minY, maxZ - minZ, maxW - minW]) {
      expect(extent).toBeGreaterThan(1.9);
    }
    expect(result.radius).toBeLessThan(1.5);
  });

  // The 24-cell's signature property: edge length EQUALS circumradius — no
  // other regular 4-polytope has this.
  it("wireframe has 96 edges, each exactly one circumradius long", () => {
    const edges = twentyFourCellWireframe();
    expect(edges).toHaveLength(96);
    for (const edge of edges) {
      expect(edgeLength(edge)).toBeCloseTo(1.4, 12);
    }
  });
});

describe("duoprism (4D preset)", () => {
  // The duoprism is the product of two triangles in orthogonal planes; every
  // vertex projects to radius R/√2 in BOTH the xy- and zw-planes, i.e. all
  // nine lie on a Clifford torus.
  it("puts all nine ⅓-scale maps' fixed points on a Clifford torus", () => {
    const transforms = duoprism();
    expect(transforms).toHaveLength(9);
    const planeR = 1.3 / Math.SQRT2;
    for (const t of transforms) {
      expect(t.scale).toEqual([1 / 3, 1 / 3, 1 / 3]);
      const [x, y, z, w] = liftedFixedPoint(t, 1 / 3);
      expect(Math.hypot(x, y)).toBeCloseTo(planeR, 12);
      expect(Math.hypot(z, w)).toBeCloseTo(planeR, 12);
    }
  });

  it("fills all four dimensions and stays bounded", () => {
    const result = runChaosGame4(
      duoprism().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    // Each triangle spans its own plane: full triangle height in x/z, full
    // side in y/w (the vertex sets are identical in both planes).
    expect(maxX - minX).toBeGreaterThan(1.3);
    expect(maxZ - minZ).toBeGreaterThan(1.3);
    expect(maxY - minY).toBeGreaterThan(1.5);
    expect(maxW - minW).toBeGreaterThan(1.5);
    expect(result.radius).toBeLessThan(2);
  });

  it("wireframe has the duoprism's 18 edges, all one triangle-side long", () => {
    const edges = duoprismWireframe();
    expect(edges).toHaveLength(18);
    // A triangle inscribed in a circle of radius r has side √3·r; cross-pairs
    // (both triangles advance) sit at √6·r and must NOT appear.
    const side = Math.sqrt(3) * (1.3 / Math.SQRT2);
    for (const edge of edges) {
      expect(edgeLength(edge)).toBeCloseTo(side, 9);
    }
  });
});

describe("hyperfern (4D preset)", () => {
  // The whole design: Barnsley's flat fern verbatim, plus ONE w block. Strip
  // the w blocks and the systems must be deep-equal — same weights, same
  // exact linear parts, same planar z-flattening.
  it("is the flat fern plus a w-curl, nothing else", () => {
    const stripped = hyperfern().map((t) => {
      const copy = { ...t };
      delete copy.w;
      return copy;
    });
    expect(stripped).toEqual(barnsleyFern());
  });

  it("curls only the dominant frond map, in the yw plane, with pinned w depth", () => {
    const transforms = hyperfern();
    const curled = transforms.filter((t) => t.w !== undefined);
    expect(curled).toHaveLength(1);
    const [frond] = curled;
    expect(frond.weight).toBe(
      Math.max(...transforms.map((t) => t.weight ?? 1)),
    );
    // The curl tilts the rachis direction (+y) toward +w — yw, no other plane.
    expect(frond.w?.rotation?.yw).toBeGreaterThan(0);
    expect(frond.w?.rotation?.xw).toBeUndefined();
    expect(frond.w?.rotation?.zw).toBeUndefined();
    // Pinned to the frond's own planar scale (a true rotation keeps depth),
    // not left to derive as the z-flattened mean.
    expect(frond.w?.scale).toBe(frond.scale[0]);
  });

  // The 4D counterpart of curlingFern's acceptance test: the leaf develops
  // real extent in w (the curl) while staying EXACTLY planar in z and keeping
  // its upright leaf proportions.
  it("curls through w while staying flat in z and leaf-shaped", () => {
    const result = runChaosGame4(
      hyperfern().map(toTransform4),
      30000,
      mulberry32(4),
    );
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    const width = maxX - minX;
    const height = maxY - minY;
    expect(Number.isFinite(result.radius)).toBe(true);
    expect(result.radius).toBeLessThan(3);
    expect(height).toBeGreaterThan(width); // still an upright leaf
    // Planar in z: nothing ever mixes z, so the seed's z decays to nothing.
    expect(maxZ - minZ).toBeLessThan(1e-9);
    expect(maxW - minW).toBeGreaterThan(0.2 * height); // genuinely curled
  });
});

describe("PRESET_SCAFFOLDS", () => {
  // main.ts shows a preset's wireframe by this lookup: exactly the polytope
  // presets carry one (their maps' fixed points ARE the polytope vertices);
  // dynamic 4D systems (doubleRotation, hyperfern) have no natural wireframe.
  it("covers exactly the polytope presets", () => {
    expect(Object.keys(PRESET_SCAFFOLDS).sort()).toEqual([
      "duoprism",
      "pentatope",
      "sixteenCell",
      "tesseract",
      "twentyFourCell",
    ]);
  });
});

describe("PRESET_RENDER_HINTS", () => {
  // radiolarian and swirlFlame are fractal-flame compositions whose payoff
  // lives in the flame render, not the live point cloud (see their own docs)
  // — loading either switches the app into that renderer (fr-39y).
  it("hints radiolarian and swirl as flame showcases", () => {
    expect(PRESET_RENDER_HINTS.radiolarian).toBe("flame");
    expect(PRESET_RENDER_HINTS.swirl).toBe("flame");
  });

  // Guards against a typo'd key silently falling out of the Preset union.
  it("keys only real preset names", () => {
    for (const key of Object.keys(PRESET_RENDER_HINTS)) {
      expect(PRESET_NAMES).toContain(key);
    }
  });
});
