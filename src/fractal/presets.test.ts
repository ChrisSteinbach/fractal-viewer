import { applyAffine, composeAffine } from "./affine";
import { systemIsFlat, systemPartsAreNonFlat, toTransform4 } from "./affine4";
import {
  DEFAULT_COLOR_SPEED,
  derivedColorIndex,
  runChaosGame,
} from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_LINK_BULB,
  ESCAPE_LINK_MANDELBOX,
  ESCAPE_LINK_QSQUARE,
} from "./escape-de";
import {
  analyzeEscapeSystem4,
  buildEscapeDE4,
  probeEscapeFill4,
} from "./escape-de-4d";
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
  fernForest,
  fernHills,
  fernThicket,
  hybridChainCraters,
  hybridChainCube,
  hybridChainQuaternion,
  hybridChainShells,
  hyperfern,
  hyperfernForest,
  hyperfernHills,
  icosahedronFlake,
  jerusalemCube,
  juliaDust,
  juliaIsland,
  juliaPinwheel,
  juliaPinwheelLens,
  juliaSet,
  juliaSnowflake,
  juliaSnowflakeLens,
  kelpForest,
  mandelboxBrick,
  mandelboxColumn,
  mandelboxKifs,
  mandelboxLattice,
  metalStudio,
  mengerSponge,
  nextId,
  octahedronFlake,
  pentatope,
  pentatopeWireframe,
  PRESET_FINALS,
  PRESET_NAMES,
  PRESET_PALETTES,
  PRESET_RENDER_HINTS,
  PRESET_SCAFFOLDS,
  PRESET_SYMMETRIES,
  PRESET_SURFACE_ROOMS,
  presetTransforms,
  radiolarian,
  sierpinskiPyramid,
  sierpinskiTetrahedron,
  sixteenCellFlake,
  sixteenCellWireframe,
  spiral,
  swirlFlame,
  dyedSpiral,
  tesseract,
  tesseractWireframe,
  twentyFourCellFlake,
  twentyFourCellWireframe,
  woodGrain,
} from "./presets";
import { mulberry32 } from "./rng";
import { analyzeSurfaceSystem } from "./surface-de";
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

describe("Metal Studio", () => {
  it("ships neutral Chrome together with its authorable checker room", () => {
    const [subject] = metalStudio();
    expect(subject.finish).toEqual({
      specular: 1,
      shininess: 96,
      metalness: 1,
      reflect: 0.9,
      reflectionTint: 0,
    });
    expect(PRESET_RENDER_HINTS.metalStudio).toBe("surface");
    expect(PRESET_SURFACE_ROOMS.metalStudio).toEqual({
      groundPlane: true,
      floorPattern: "checker",
      floorTileScale: 0.64,
      floorEmission: 1.4,
    });
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

  it("mandelboxLattice is eight box-symmetry conjugates of one fold map", () => {
    const transforms = mandelboxLattice();
    expect(transforms).toHaveLength(8);
    for (const t of transforms) {
      // Conjugating by a quarter-turn about y (or the y-mirror) leaves scale
      // and variations untouched — the box fold commutes with both, the
      // sphere fold with every rotation/reflection.
      expect(t.scale).toEqual(transforms[0].scale);
      expect(t.variations).toEqual([
        { type: "mandelbox", weight: 1.2 },
        { type: "linear", weight: 0.25 },
      ]);
    }
    // Each ring of four is a y-quarter-turn cycle of translations.
    for (const ring of [0, 4]) {
      for (let k = 0; k < 4; k++) {
        const [x, y, z] = transforms[ring + k].position;
        const next = transforms[ring + ((k + 1) % 4)].position;
        expect(next[0]).toBeCloseTo(z, 12);
        expect(next[1]).toBeCloseTo(y, 12);
        expect(next[2]).toBeCloseTo(-x, 12);
      }
    }
    // The lower ring is the y-mirror conjugate of the upper: translation's y
    // negated, and the y-twist's sign reversed (a mirror reverses the turn).
    for (let k = 0; k < 4; k++) {
      const upper = transforms[k];
      const lower = transforms[k + 4];
      expect(lower.position[0]).toBeCloseTo(upper.position[0], 12);
      expect(lower.position[1]).toBeCloseTo(-upper.position[1], 12);
      expect(lower.position[2]).toBeCloseTo(upper.position[2], 12);
      expect(lower.rotation[1]).toBeCloseTo(-upper.rotation[1], 12);
    }
  });

  it("mandelboxKifs is eight Mandelbox corners bound by a box-fold tetrahedron", () => {
    const transforms = mandelboxKifs();
    expect(transforms).toHaveLength(12);
    const corners = transforms.slice(0, 8);
    for (const t of corners) {
      expect(t.variations).toEqual([{ type: "mandelbox", weight: 1.2 }]);
      // 4 * 1.2 * 0.19 = 0.912: well inside the fold gate (the sphere
      // fold's inner branch multiplies by 4), sized so the composite
      // resolves 1e-4 features in exactly 100 descent levels — under
      // MAX_DESCENT_DEPTH's 128 ceiling, whose clamp otherwise erodes
      // exact on-attractor estimates (~0.23%R measured at scale 0.202).
      expect(t.scale).toEqual([0.19, 0.19, 0.19]);
      expect(t.rotation).toEqual([0, 0, 0]);
      expect(t.position.map((v) => Math.abs(v))).toEqual([0.7, 0.7, 0.7]);
    }
    // Every sign combination once: the whole cube-corner orbit.
    expect(new Set(corners.map((t) => t.position.join(","))).size).toBe(8);
    // The binder sits on the EVEN corners — one of the cube's two inscribed
    // tetrahedra, the orbit the tetrahedral group preserves — and contracts
    // at 0.66, three times the Mandelbox maps' 0.202, because a box fold's
    // branches are isometries and its budget is the whole |w| * sigma.
    const binder = transforms.slice(8);
    expect(binder).toHaveLength(4);
    for (const t of binder) {
      expect(t.variations).toEqual([{ type: "boxfold", weight: 1 }]);
      expect(t.scale).toEqual([0.66, 0.66, 0.66]);
      expect(t.position.map((v) => Math.abs(v))).toEqual([0.62, 0.62, 0.62]);
      expect(t.position.filter((v) => v < 0).length % 2).toBe(0);
    }
  });

  it("every mandelboxKifs map is a single fold variation, never a blend", () => {
    for (const t of mandelboxKifs()) {
      // A blend is a weighted SUM of maps, not a composition, so it has no
      // inverse branches for the surface DE to descend (surface-de.ts's fold
      // section): one active fold entry per map is the whole eligibility.
      expect(t.variations).toHaveLength(1);
      expect(["boxfold", "spherefold", "mandelbox"]).toContain(
        t.variations?.[0].type,
      );
      expect(t.variations?.[0].weight).not.toBe(0);
    }
  });

  it("mandelboxKifs is surface-eligible at full step scale", () => {
    const analysis = analyzeSurfaceSystem(mandelboxKifs());
    expect(analysis.reasons).toEqual([]);
    expect(analysis.status).toBe("eligible");
    // Uniform per-map scale, so the descent never has to shorten its steps.
    expect(analysis.stepScale).toBe(1);
  });

  // The pair is the point: mandelboxLattice blends `mandelbox` with
  // `linear` for the flame, which no surface DE can descend, so the KIFS
  // exists as its own pure-fold system rather than a tweak of that one.
  it("mandelboxLattice's blend keeps it out of the surface render", () => {
    const analysis = analyzeSurfaceSystem(mandelboxLattice());
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons[0]).toContain("uses variations");
  });

  // Nonlinear maps can diverge at singularities; the point of the test is that
  // the chaos game's guard keeps the whole cloud finite (never NaN/Inf) and the
  // attractor has real extent rather than collapsing to a point.
  for (const [name, transforms] of Object.entries({
    radiolarian: radiolarian(),
    swirlFlame: swirlFlame(),
    mandelboxLattice: mandelboxLattice(),
    mandelboxKifs: mandelboxKifs(),
    juliaSet: juliaSet(),
    juliaDust: juliaDust(),
    juliaIsland: juliaIsland(),
    juliaPinwheel: juliaPinwheel(),
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

// The recipe pin: `juliaSet`/`juliaDust` render the genuine
// Julia set of z^2 + c by exact Inverse Iteration (see the presets' own
// docs and docs/julia-sets.md), which is a claim about where the PLOTTED
// POINTS land relative to the escape boundary of z^2 + c — not something
// "renders a finite, non-degenerate cloud" can tell apart from an ordinary
// blob. These tests exist so that recipe cannot silently rot if `julia`
// stops being the juliaN inverse branches, or the affine order stops
// applying -c before the variation: either change would still pass every
// other preset test while producing a cloud that no longer concentrates on
// the Julia set.
describe("juliaSet / juliaDust (IIM Julia sets)", () => {
  /** Recover a juliaSet/juliaDust preset's Julia constant from its one
   * transform's position (c = -position) rather than duplicating the
   * literal — these tests check what the preset actually emits. */
  function juliaConstant(transforms: Transform[]): [number, number] {
    const [px, py] = transforms[0].position;
    return [-px, -py];
  }

  /** Iterate z <- z^2 + c from z = 0 (the Mandelbrot-set membership test):
   * the 1-based escape iteration if |z| exceeds the classic bailout radius
   * 2 within `maxIters` steps, else -1 (never escaped). */
  function mandelbrotEscapeIteration(
    cx: number,
    cy: number,
    maxIters: number,
  ): number {
    let x = 0;
    let y = 0;
    for (let i = 0; i < maxIters; i++) {
      const nx = x * x - y * y + cx;
      const ny = 2 * x * y + cy;
      x = nx;
      y = ny;
      if (x * x + y * y > 4) return i + 1;
    }
    return -1;
  }

  /** Forward-iterate z <- z^2 + c from `(px, py)`; true if it escapes the
   * classic bailout radius 2 within `iters` steps. */
  function escapesForward(
    px: number,
    py: number,
    cx: number,
    cy: number,
    iters: number,
  ): boolean {
    let x = px;
    let y = py;
    for (let i = 0; i < iters; i++) {
      const nx = x * x - y * y + cx;
      const ny = 2 * x * y + cy;
      x = nx;
      y = ny;
      if (x * x + y * y > 4) return true;
    }
    return false;
  }

  /**
   * Fraction of points `(xs[i], ys[i])` whose 8-direction, radius-`delta`
   * neighborhood has SOME probe directions that escape z^2 + c within 40
   * forward iterations and some that don't — i.e. straddles the boundary
   * between the filled and escaping sets. A point deep inside a bounded
   * component, or deep in the escaping exterior, never straddles; only
   * points close to the Julia set itself do (the presets' own probe
   * methodology, cleaned up).
   */
  function straddleFraction(
    xs: Float32Array,
    ys: Float32Array,
    cx: number,
    cy: number,
    delta: number,
  ): number {
    const dirs = 8;
    const iters = 40;
    let straddling = 0;
    for (let i = 0; i < xs.length; i++) {
      let escapeCount = 0;
      for (let d = 0; d < dirs; d++) {
        const angle = (d / dirs) * 2 * Math.PI;
        const ox = xs[i] + delta * Math.cos(angle);
        const oy = ys[i] + delta * Math.sin(angle);
        if (escapesForward(ox, oy, cx, cy, iters)) escapeCount++;
      }
      if (escapeCount > 0 && escapeCount < dirs) straddling++;
    }
    return straddling / xs.length;
  }

  // The recipe's central claim: IIM concentrates plotted points ON the
  // Julia set, so a small neighborhood around a typical plotted point has
  // both escaping and non-escaping directions. A uniform sample of the same
  // disk mostly lands deep in one region or the other instead. Thresholds
  // sit with real headroom around the measured values (93.84% / 8.39% at
  // delta 0.01, juliaSet's own doc) so ordinary run-to-run/engine noise
  // can't flip this, while a broken recipe (wrong sign on -c, a dropped
  // z-pin letting variations.ts's `julia` see a nonzero seed z, or `julia`
  // itself changing) reliably would.
  it("juliaSet concentrates points on the Julia boundary, unlike a uniform sample of the same disk", () => {
    const transforms = juliaSet();
    const [cx, cy] = juliaConstant(transforms);
    const n = 50000;
    const { positions, bounds } = runChaosGame(transforms, n, mulberry32(7));
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = positions[i * 3];
      ys[i] = positions[i * 3 + 1];
    }

    // Guards the straddle metric itself: a variation with no per-step
    // randomness (unlike `julia`'s coin flip) collapses the whole orbit onto
    // a single fixed point after warmup, which can straddle the boundary
    // trivially (50000 copies of one point, all-or-nothing) and slip past
    // the assertion below unless the cloud's actual spread is checked too.
    // The true Julia set spans a max radius of 1.4148 (juliaSet's doc); 0.5
    // is comfortably below that and above a collapsed orbit's ~0 spread.
    expect(bounds.maxR - bounds.minR).toBeGreaterThan(0.5);
    expect(straddleFraction(xs, ys, cx, cy, 0.01)).toBeGreaterThan(0.8);

    // Uniform control over the disk the cloud actually filled.
    const radius = bounds.maxR;
    const controlRng = mulberry32(11);
    const cxs = new Float32Array(n);
    const cys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = radius * Math.sqrt(controlRng());
      const theta = controlRng() * 2 * Math.PI;
      cxs[i] = r * Math.cos(theta);
      cys[i] = r * Math.sin(theta);
    }
    expect(straddleFraction(cxs, cys, cx, cy, 0.01)).toBeLessThan(0.3);
  });

  // The recipe's z-pin: `variations.ts`'s `julia` carries z through
  // unchanged, so without `scale.z = 0` the cloud would sit wherever the
  // seed point's z happened to warm up to, not flattened at 0 (juliaIim's
  // doc). The straddle test above only reads x/y, so this is the z-pin's
  // own check.
  it("juliaSet and juliaDust stay pinned to z = 0", () => {
    for (const transforms of [juliaSet(), juliaDust()]) {
      const { bounds } = runChaosGame(transforms, 2000, mulberry32(3));
      expect(bounds.minZ).toBe(0);
      expect(bounds.maxZ).toBe(0);
    }
  });

  // juliaDust's whole reason to exist (see its doc): c sits OUTSIDE the
  // Mandelbrot set, where IIM's two inverse branches genuinely contract
  // into disjoint sub-disks. Checked against the preset's OWN transform, so
  // an edit to its Julia constant that wanders back into M goes red instead
  // of silently shipping a "dust" preset that no longer is one.
  it("juliaDust's constant is outside the Mandelbrot set (the critical orbit of z^2+c escapes)", () => {
    const [cx, cy] = juliaConstant(juliaDust());
    expect(mandelbrotEscapeIteration(cx, cy, 1000)).toBeGreaterThan(0);
  });

  // juliaSet's constant is Douady's rabbit — the center of M's period-3
  // hyperbolic component, so the critical orbit doesn't just fail to
  // escape within some arbitrary budget, it settles onto an attracting
  // cycle. This pins the fact the doc relies on for calling the Julia set
  // genuinely connected, not just its consequence for the point cloud (the
  // straddle test above).
  it("juliaSet's constant stays bounded (is inside M) over a long iteration budget", () => {
    const [cx, cy] = juliaConstant(juliaSet());
    expect(mandelbrotEscapeIteration(cx, cy, 5000)).toBe(-1);
  });
});

// The julia SHOWCASES. These pin what was AUTHORED, not what
// renders: every one of them would still make a pretty flame if its second
// constant drifted, its lens were dropped, or its palette went missing, and
// no other test in this file would notice — which is exactly the failure
// mode `scripts/julia-flame.harness.ts`'s sheet cannot guard against on its
// own, since a sheet is only ever run by hand.
describe("julia showcases", () => {
  it("juliaIsland braids TWO exact inverse-iteration branches at two constants", () => {
    const island = juliaIsland();

    expect(island).toHaveLength(2);
    for (const map of island) {
      // Still an EXACT IIM branch each: one full-weight `julia` variation
      // over a pre-affine translation, pinned to the plane. A blend or an
      // extra scale would make it an ordinary flame map that merely looks
      // Julia-ish (the sheet's own rejected class).
      expect(map.variations).toEqual([{ type: "julia", weight: 1 }]);
      expect(map.scale).toEqual([1, 1, 0]);
      expect(map.weight).toBeUndefined();
    }
    // Two DIFFERENT constants — the whole point of the pair. (c = −position;
    // read off the maps rather than re-stating the literals.)
    const constants = island.map((m) => [-m.position[0], -m.position[1]]);
    expect(constants[0]).not.toEqual(constants[1]);
    expect(constants[0]).toEqual(
      juliaSet()[0]
        .position.slice(0, 2)
        .map((v) => -v),
    );
  });

  // The documented defect and its documented fix, side by side: the flame's
  // color coordinate can only move between SLOTS, and a one-map system has
  // exactly one.
  it("gives the island the second color slot juliaSet structurally cannot have", () => {
    expect(juliaSet()).toHaveLength(1);
    expect(derivedColorIndex(0, juliaSet().length)).toBe(0.5);

    const island = juliaIsland();
    expect(derivedColorIndex(0, island.length)).not.toBe(
      derivedColorIndex(1, island.length),
    );
  });

  // The snowflake is the island THROUGH A LENS, not a second hand-tuned
  // system — the lens applies at plot time and never feeds back, so the
  // attractor underneath must stay byte-for-byte the island's.
  it("juliaSnowflake is juliaIsland's attractor plus a plot-time lens", () => {
    expect(juliaSnowflake()).toEqual(juliaIsland());
    expect(PRESET_FINALS.juliaSnowflake?.()).toEqual(juliaSnowflakeLens());
  });

  it("both lenses are flat julia folds", () => {
    for (const lens of [juliaSnowflakeLens(), juliaPinwheelLens()]) {
      expect(lens.variations).toEqual([{ type: "julia", weight: 1 }]);
      // z pinned to 0: `julia` carries z through untouched, so an unpinned
      // lens would fold the sheet off its own plane.
      expect(lens.scale[2]).toBe(0);
    }
  });

  it("juliaPinwheel is a flat counter-rotating swirl pair", () => {
    const pinwheel = juliaPinwheel();

    expect(pinwheel).toHaveLength(2);
    for (const map of pinwheel) {
      expect(map.variations?.[0].type).toBe("swirl");
      expect(map.scale[2]).toBe(0);
      expect(map.rotation[0]).toBe(0);
      expect(map.rotation[1]).toBe(0);
    }
    // Counter-rotating is the shape: the two in-plane turns have opposite
    // signs, which is what the lens doubles into a pinwheel.
    expect(Math.sign(pinwheel[0].rotation[2])).toBe(
      -Math.sign(pinwheel[1].rotation[2]),
    );
  });
});

describe("PRESET_FINALS", () => {
  // Guards against a typo'd key silently falling out of the Preset union,
  // exactly like PRESET_RENDER_HINTS' own guard.
  it("keys only real preset names", () => {
    for (const key of Object.keys(PRESET_FINALS)) {
      expect(PRESET_NAMES).toContain(key);
    }
  });

  // ABSENT MEANS NONE (see the table's doc): main.ts clears the final on
  // every load with no entry, which is what keeps a lens from surviving a
  // preset load into a system whose render mode refuses one.
  it("carries a lens only for the compositions authored around one", () => {
    expect(Object.keys(PRESET_FINALS).sort()).toEqual([
      // The finish showcase is the first non-flame composition built
      // around a lens: its four affine corners have no surface area to
      // show a material until the boxfold FINAL folds them.
      "fourFinishes",
      "juliaPinwheel",
      "juliaSnowflake",
    ]);
  });
});

describe("PRESET_PALETTES", () => {
  it("keys only real preset names", () => {
    for (const key of Object.keys(PRESET_PALETTES)) {
      expect(PRESET_NAMES).toContain(key);
    }
  });

  // The table's own scoping claim: it repaints the FLAME palette — and,
  // for solid-hinted presets, the solid session's own structural palette
  // (state.solid.paletteId, where main.ts's preset handler routes the
  // hint, since the solid render draws the same structural LUT through
  // its own field) — so it may only key presets the app actually takes
  // into one of those renderers.
  it("only paints presets that are flame or solid showcases", () => {
    for (const key of Object.keys(PRESET_PALETTES)) {
      expect(["flame", "solid"]).toContain(
        PRESET_RENDER_HINTS[key as keyof typeof PRESET_RENDER_HINTS],
      );
    }
  });
});

describe("PRESET_SYMMETRIES", () => {
  it("keys only real preset names", () => {
    for (const key of Object.keys(PRESET_SYMMETRIES)) {
      expect(PRESET_NAMES).toContain(key);
    }
  });

  // ABSENT MEANS OFF (see the table's doc): main.ts turns the kaleidoscope
  // off on every load with no entry, so a preset added here silently
  // replicates itself for everyone who loads it. One composition earns that.
  it("carries a kaleidoscope only for the composition that IS one", () => {
    expect(Object.keys(PRESET_SYMMETRIES)).toEqual(["foldChainFlower"]);
  });

  // The table's own scoping claim, and the half that would break a render
  // mode rather than merely look wrong: a `w` plane or a nonzero twist
  // rotates the copies out of 3D, which every gate that reads this table
  // refuses. main.ts clears the twist unconditionally; no entry may set one.
  it("only prescribes 3D kaleidoscopes", () => {
    for (const symmetry of Object.values(PRESET_SYMMETRIES)) {
      expect(symmetry.plane).not.toContain("w");
      expect(symmetry.twist ?? 0).toBe(0);
      expect(symmetry.order).toBeGreaterThan(1);
    }
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

  // Adapted for the unified factory: the wireframe's vertices must be
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

describe("Wood Grain (accepted patterned-material showcase)", () => {
  it("reproduces the accepted affine4 Wood fixture values exactly", () => {
    const transforms = woodGrain();
    expect(transforms).toHaveLength(6);
    expect(transforms.map((transform) => transform.position)).toEqual([
      [33.6, 0, 0],
      [33.6, 0, 0],
      [-16.8, 28.896, 0],
      [-16.8, 28.896, 0],
      [-16.8, -28.896, 0],
      [-16.8, -28.896, 0],
    ]);
    expect(transforms.map((transform) => transform.w)).toEqual([
      { position: -0.15, scale: 0.5 },
      { position: 0.15, scale: 0.5 },
      { position: -0.15, scale: 0.5 },
      { position: 0.15, scale: 0.5 },
      { position: -0.15, scale: 0.5 },
      { position: 0.15, scale: 0.5 },
    ]);
    expect(transforms.map((transform) => transform.surfacePattern)).toEqual(
      (["y", "z", "x", "y", "z", "x"] as const).map((axis) => ({
        kind: "wood",
        axis,
        scale: 3,
        strength: 1,
      })),
    );
    for (const transform of transforms) {
      expect(transform.rotation).toEqual([0, 0, 0]);
      expect(transform.scale).toEqual([0.5, 0.5, 0.5]);
      expect(transform.finish).toBeUndefined();
    }
  });

  it("is registered and opens in the only renderer that reads the pattern", () => {
    expect(PRESET_NAMES).toContain("woodGrain");
    expect(PRESET_RENDER_HINTS.woodGrain).toBe("surface");
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

describe("the landscape presets", () => {
  // The whole wave shares one construction: a shipped plant sub-IFS
  // verbatim plus scatter placement maps. The plant halves must be the
  // shipped presets' maps exactly — a landscape is a composition, not a
  // re-tuning.
  it("builds on the shipped plants verbatim", () => {
    expect(fernForest().slice(0, 4)).toEqual(curlingFern());
    expect(fernThicket().slice(0, 4)).toEqual(curlingFern());
    expect(hyperfernForest().slice(0, 4)).toEqual(hyperfern());
  });

  // The seating rule: a scatter map's position is chosen so the scene's
  // ground anchor (0, -1.5, 0) — the ferns' own base — lands exactly at the
  // authored base point. Pinned both ways: the computed position, and the
  // seating itself through the engine's own composition.
  it("seats fernForest's row map on the ground line", () => {
    const row = fernForest()[4];
    expect(row.position[0]).toBeCloseTo(1.62, 10);
    expect(row.position[1]).toBeCloseTo(-0.3, 10);
    expect(row.position[2]).toBeCloseTo(-0.62, 10);
    const seated = applyAffine(composeAffine(row), 0, -1.5, 0);
    expect(seated[0]).toBeCloseTo(1.62, 12);
    expect(seated[1]).toBeCloseTo(-1.5, 12);
    expect(seated[2]).toBeCloseTo(-0.62, 12);
  });

  it("seats fernThicket's three grove placements at their authored poses", () => {
    const grove = fernThicket().slice(4);
    const expected = [
      [-1.9002, -0.6321, -0.5156],
      [1.8252, -0.3914, -1.1006],
      [0.4139, -0.5448, -2.0285],
    ];
    expect(grove).toHaveLength(3);
    grove.forEach((map, i) => {
      map.position.forEach((c, axis) => {
        expect(c).toBeCloseTo(expected[i][axis], 4);
      });
    });
  });

  // The thicket's points-mode look was judged with DERIVED colors, and an
  // authored colorIndex would also re-hue the points "By Transform"
  // palette (transformColors reads colorIndex as the hue) — so no map may
  // carry either color field.
  it("keeps fernThicket free of authored color fields", () => {
    for (const map of fernThicket()) {
      expect(map.colorIndex).toBeUndefined();
      expect(map.colorSpeed).toBeUndefined();
    }
  });

  it("gives kelpForest the row's winning share over a contracting plant", () => {
    const transforms = kelpForest();
    expect(transforms.map((t) => t.weight)).toEqual([2, 78, 9, 9, 42]);
    // The kelp plant's weights total 98, so 42 is EXACTLY the sheet's
    // winning scatter share of 0.30 — not approximately.
    expect(42 / 140).toBe(0.3);
    // Every map contracts (all scale magnitudes < 1), so the chaos game
    // converges rather than escaping.
    for (const t of transforms) {
      for (const c of t.scale) {
        expect(Math.abs(c)).toBeLessThan(1);
      }
    }
  });

  it("keeps the kelp bed inside its box", () => {
    const { bounds } = runChaosGame(kelpForest(), 30000, mulberry32(1));
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // The sheet measured ≈3.2 of height for the kelp plant alone; the
    // row's receding copies are each smaller than their parent, so the bed
    // adds height slowly and the plant stays in its box.
    const ySpan = bounds.maxY - bounds.minY;
    expect(ySpan).toBeGreaterThan(2.5);
    expect(ySpan).toBeLessThan(4.5);
  });

  // The wave's 4D half: the ONE row map carries the w-mixing rotation, so
  // the rotation compounds with recession — copy k is turned k·0.35 rad
  // into +w.
  it("turns hyperfernForest's row map into +w with no pinned w scale", () => {
    const row = hyperfernForest()[4];
    expect(row.w?.rotation?.xw).toBe(0.35);
    expect(row.w?.rotation?.yw).toBeUndefined();
    expect(row.w?.rotation?.zw).toBeUndefined();
    expect(row.w?.position).toBeUndefined();
    // w.scale stays ABSENT because the derived default — the mean spatial
    // contraction — is already the map's uniform 0.8, so deriving IS the
    // true rotation (unlike hyperfern's z-flattened frond, which pins it).
    expect(row.w?.scale).toBeUndefined();
    expect(toTransform4(row).scale[3]).toBeCloseTo(0.8, 12);
    expect(systemIsFlat(hyperfernForest())).toBe(false);
  });

  it("rolls the treeline genuinely out of the w = 0 hyperplane", () => {
    const { bounds } = runChaosGame4(
      hyperfernForest().map(toTransform4),
      30000,
      mulberry32(4),
    );
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(bounds.maxW - bounds.minW).toBeGreaterThan(0.5);
  });

  // The solid pair builds on the shipped plants the same way, plus an
  // authored plant color OVERLAY (the lagoon scheme's teal-green band:
  // stem 0.6 in the near-black shadow slot, frond and leaflets 0.88-0.95).
  // Stripping colorIndex must give back the shipped maps exactly — a
  // landscape is a composition, not a re-tuning.
  it("overlays fernHills' plant colors on curlingFern verbatim", () => {
    const plants = fernHills().slice(0, 4);
    expect(plants.map(({ colorIndex: _ci, ...rest }) => rest)).toEqual(
      curlingFern(),
    );
    expect(plants.map((t) => t.colorIndex)).toEqual([0.6, 0.92, 0.95, 0.88]);
  });

  it("overlays hyperfernHills' plant colors without losing the frond's w block", () => {
    const plants = hyperfernHills().slice(0, 4);
    expect(plants.map(({ colorIndex: _ci, ...rest }) => rest)).toEqual(
      hyperfern(),
    );
    expect(plants.map((t) => t.colorIndex)).toEqual([0.6, 0.92, 0.95, 0.88]);
    // The overlay is a spread, and the spread must preserve the frond's
    // existing w block — the yw curl IS the hyperfern.
    expect(plants[1].w?.rotation?.yw).toBe(0.15);
  });

  // The terrain maps: squashed (sy < s) so each copy carpets into rolling
  // ground rather than standing beside it, and still seated on the ground
  // line through the engine's own composition — a non-uniform scale
  // changes M·anchor, so the seating rule itself is what is under test.
  it("squashes and seats fernHills' terrain copies on the ground line", () => {
    const terrain = fernHills()[4];
    expect(terrain.scale).toEqual([0.72, 0.45, 0.72]);
    const seated = applyAffine(composeAffine(terrain), 0, -1.5, 0);
    expect(seated[0]).toBeCloseTo(-1.6, 12);
    expect(seated[1]).toBeCloseTo(-1.5, 12);
    expect(seated[2]).toBeCloseTo(-1.2, 12);
    const far = applyAffine(composeAffine(fernHills()[6]), 0, -1.5, 0);
    expect(far[0]).toBeCloseTo(0.2, 12);
    expect(far[1]).toBeCloseTo(-1.5, 12);
    expect(far[2]).toBeCloseTo(-3.2, 12);
  });

  it("gives fernHills the terrain-row share the solid sheet measured", () => {
    // (?? 0 so an unauthored weight fails the pin loudly rather than
    // typing as undefined.)
    const weights = fernHills().map((t) => t.weight ?? 0);
    expect(weights).toEqual([1, 85, 7, 7, 27, 27, 27, 41]);
    // Scatter 27 + 27 + 27 + 41 = 122 of 222 total — the addendum's ≈0.55
    // terrain-row share, pinned as its own arithmetic.
    const scatter = weights.slice(4).reduce((a, b) => a + b, 0);
    const total = weights.reduce((a, b) => a + b, 0);
    expect(scatter).toBe(122);
    expect(total).toBe(222);
    expect(scatter / total).toBeCloseTo(0.55, 2);
  });

  // The solid landscape's 4D half: only the ROW carries the w-mixing
  // rotation (hyperfernForest's own compounding lift), and it genuinely
  // rolls the terrain out of the w = 0 hyperplane.
  it("turns hyperfernHills' row into +w and rolls the terrain out of the hyperplane", () => {
    const row = hyperfernHills()[7];
    expect(row.w?.rotation?.xw).toBe(0.35);
    expect(row.w?.rotation?.yw).toBeUndefined();
    expect(row.w?.rotation?.zw).toBeUndefined();
    expect(row.w?.position).toBeUndefined();
    // Absent for hyperfernForest's reason: the derived mean contraction IS
    // the row's uniform 0.8.
    expect(row.w?.scale).toBeUndefined();
    expect(systemIsFlat(hyperfernHills())).toBe(false);
    const { bounds } = runChaosGame4(
      hyperfernHills().map(toTransform4),
      30000,
      mulberry32(4),
    );
    for (const v of Object.values(bounds)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(bounds.maxW - bounds.minW).toBeGreaterThan(0.5);
  });

  // Registration: the pair carries the table's FIRST "solid" render hints
  // (the opaque lit terrain look lives in the solid renderer — measured on
  // the solid-landscape sheet) and the lagoon palette they were composed
  // against.
  it("registers the solid pair with solid hints and the lagoon palette", () => {
    for (const key of ["fernHills", "hyperfernHills"]) {
      expect(PRESET_NAMES).toContain(key);
    }
    expect(PRESET_RENDER_HINTS.fernHills).toBe("solid");
    expect(PRESET_RENDER_HINTS.hyperfernHills).toBe("solid");
    expect(PRESET_PALETTES.fernHills).toBe("lagoon");
    expect(PRESET_PALETTES.hyperfernHills).toBe("lagoon");
  });

  // Registration: all four are real presets; the two row landscapes open
  // in the flame renderer under their composed palettes, while the thicket
  // and the 4D colonnade stay point-cloud showcases (no hint entry).
  it("registers the wave with its render hints and palettes", () => {
    for (const key of [
      "fernForest",
      "fernThicket",
      "kelpForest",
      "hyperfernForest",
    ]) {
      expect(PRESET_NAMES).toContain(key);
    }
    expect(PRESET_RENDER_HINTS.fernForest).toBe("flame");
    expect(PRESET_RENDER_HINTS.kelpForest).toBe("flame");
    expect(PRESET_RENDER_HINTS.fernThicket).toBeUndefined();
    expect(PRESET_RENDER_HINTS.hyperfernForest).toBeUndefined();
    expect(PRESET_PALETTES.fernForest).toBe("moss");
    expect(PRESET_PALETTES.kelpForest).toBe("lagoon");
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
  // radiolarian, swirlFlame, and mandelboxLattice are fractal-flame
  // compositions whose payoff lives in the flame render, not the live point
  // cloud (see their own docs) — loading one switches the app into that
  // renderer.
  it("hints radiolarian, swirl, mandelbox, and dyedSpiral as flame showcases", () => {
    expect(PRESET_RENDER_HINTS.radiolarian).toBe("flame");
    expect(PRESET_RENDER_HINTS.swirl).toBe("flame");
    expect(PRESET_RENDER_HINTS.mandelbox).toBe("flame");
    // dyedSpiral's whole payload is a gradient-palette color structure, which
    // only the structural (colorLUT) path reads at all.
    expect(PRESET_RENDER_HINTS.dyedSpiral).toBe("flame");
  });

  // mandelboxKifs is the pure-fold twin whose payoff lives in the fold
  // surface descent, not the live point cloud (see its own doc) —
  // loading it switches the app into that renderer.
  it("hints mandelboxKifs as a surface showcase", () => {
    expect(PRESET_RENDER_HINTS.mandelboxKifs).toBe("surface");
  });

  // The cross-family chains need the hint for the same reason as
  // the fold-only and Mandelbulb trios: every link is non-contracting, so
  // the chaos-game cloud is escape-reset debris rather than the attractor.
  it("hints the hybrid chain presets as surface showcases", () => {
    expect(PRESET_RENDER_HINTS.hybridChainCube).toBe("surface");
    expect(PRESET_RENDER_HINTS.hybridChainCraters).toBe("surface");
    expect(PRESET_RENDER_HINTS.hybridChainQuaternion).toBe("surface");
  });

  // Both are flat 2D sheets (z pinned to 0) whose point density is heavily
  // tip-weighted — exactly what the flame's log-density exposure is for.
  it("hints julia and juliaDust as flame showcases", () => {
    expect(PRESET_RENDER_HINTS.julia).toBe("flame");
    expect(PRESET_RENDER_HINTS.juliaDust).toBe("flame");
  });

  // Guards against a typo'd key silently falling out of the Preset union.
  it("keys only real preset names", () => {
    for (const key of Object.keys(PRESET_RENDER_HINTS)) {
      expect(PRESET_NAMES).toContain(key);
    }
  });
});

describe("dyedSpiral (per-transform flame color showcase)", () => {
  // The preset exists to demonstrate what the DERIVED spread cannot express,
  // so these pin its authored intent rather than its geometry: an edit that
  // quietly dropped the color pair would still render a pretty spiral, just a
  // meaningless rainbow one, and no other test would notice.
  it("gives its two arm maps the SAME palette slot", () => {
    const [armA, armB] = dyedSpiral();

    expect(armA.colorIndex).toBeDefined();
    expect(armB.colorIndex).toBe(armA.colorIndex);
    // And that shared slot is genuinely off the spread those two indices
    // would otherwise get (0 and 1/3 across four maps).
    expect(armA.colorIndex).not.toBe(derivedColorIndex(0, 4));
    expect(armA.colorIndex).not.toBe(derivedColorIndex(1, 4));
  });

  it("snaps its core map toward a far-off slot", () => {
    const core = dyedSpiral()[2];

    expect(core.colorSpeed).toBeGreaterThan(DEFAULT_COLOR_SPEED);
    // Far enough from the arms' shared slot to read as contrast, not drift.
    expect(
      Math.abs(core.colorIndex! - dyedSpiral()[0].colorIndex!),
    ).toBeGreaterThan(0.4);
  });

  it("pins its dust map's color coordinate and authors no slot for it", () => {
    const dust = dyedSpiral()[3];

    // flam3's "symmetry xform": it never moves the coordinate, so its scatter
    // inherits whatever color arrived.
    expect(dust.colorSpeed).toBe(0);
    // A slot would be decoration — at speed 0 it is never read.
    expect(dust.colorIndex).toBeUndefined();
  });

  it("converges to a bounded attractor", () => {
    const { positions, count, bounds } = runChaosGame(
      dyedSpiral(),
      4000,
      mulberry32(7),
    );

    expect(count).toBeGreaterThan(0);
    for (const v of positions) expect(Number.isFinite(v)).toBe(true);
    expect(bounds.maxR).toBeLessThan(20);
  });
});

describe("hybrid chain presets (cross-family links)", () => {
  // Pins each preset to its own renderer's gate: a preset that drifted out
  // of analyzeEscapeSystem's eligibility (a stray final transform, a weight
  // edited to 0, a third active map) would still build a valid Transform[]
  // and pass every test above, but would silently stop reaching the
  // escape-time marcher at all — and if it stayed eligible but lost its
  // power link, it would silently fall back to the linear (non-Böttcher)
  // estimate instead.
  it("hybridChainCube is a mandelbox-then-bulb chain the escape gate admits", () => {
    const transforms = hybridChainCube();
    expect(analyzeEscapeSystem(transforms).status).toBe("eligible");
    const de = buildEscapeDE(transforms);
    expect(de.logEstimate).toBe(true);
    expect(de.links.map((l) => l.kind)).toEqual([
      ESCAPE_LINK_MANDELBOX,
      ESCAPE_LINK_BULB,
    ]);
  });

  it("hybridChainCraters is a bulb-then-mandelbox chain the escape gate admits", () => {
    const transforms = hybridChainCraters();
    expect(analyzeEscapeSystem(transforms).status).toBe("eligible");
    const de = buildEscapeDE(transforms);
    expect(de.logEstimate).toBe(true);
    expect(de.links.map((l) => l.kind)).toEqual([
      ESCAPE_LINK_BULB,
      ESCAPE_LINK_MANDELBOX,
    ]);
  });

  it("hybridChainQuaternion is a mandelbox-then-qsquare chain the escape gate admits", () => {
    const transforms = hybridChainQuaternion();
    expect(analyzeEscapeSystem(transforms).status).toBe("eligible");
    const de = buildEscapeDE(transforms);
    expect(de.logEstimate).toBe(true);
    expect(de.links.map((l) => l.kind)).toEqual([
      ESCAPE_LINK_MANDELBOX,
      ESCAPE_LINK_QSQUARE,
    ]);
  });
});

describe("the 4D escape-time presets", () => {
  // THE GATE PAIRING IS THE POINT, so every preset below asserts BOTH halves
  // of it. `analyzeEscapeSystem` refusing with "extends into 4D" is what says
  // the system is a genuinely new object rather than a new view of a shipped
  // one — no 3D document can express it — and `analyzeEscapeSystem4` admitting
  // it is what says something renders. A preset that lost its `w` rotation
  // would still build a valid Transform[], still pass every other test here,
  // and silently become its 3D twin: eligible in 3D, and identical to a preset
  // the menu already offers one optgroup up.

  it("mandelboxBrick is mandelboxCube turned in xw — refused in 3D, admitted in 4D", () => {
    const transforms = mandelboxBrick();
    const gate3 = analyzeEscapeSystem(transforms);

    expect(gate3.status).toBe("ineligible");
    expect(gate3.reasons.join("; ")).toContain("map 1 extends into 4D");
    expect(analyzeEscapeSystem4(transforms).status).toBe("eligible");
  });

  it("mandelboxColumn is the same map turned in yw — refused in 3D, admitted in 4D", () => {
    const transforms = mandelboxColumn();
    const gate3 = analyzeEscapeSystem(transforms);

    expect(gate3.status).toBe("ineligible");
    expect(gate3.reasons.join("; ")).toContain("map 1 extends into 4D");
    expect(analyzeEscapeSystem4(transforms).status).toBe("eligible");
  });

  it("hybridChainShells turns the SECOND link — refused in 3D, admitted in 4D", () => {
    const transforms = hybridChainShells();
    const gate3 = analyzeEscapeSystem(transforms);

    // Map 2, not map 1: the rotation rides the qsquare link, which is the one
    // link position the harness measured as costing essentially no rays.
    expect(gate3.status).toBe("ineligible");
    expect(gate3.reasons.join("; ")).toContain("map 2 extends into 4D");
    expect(analyzeEscapeSystem4(transforms).status).toBe("eligible");
  });

  // main.ts routes a system to the 4D half on this predicate, so a preset that
  // reads flat here never reaches `escape-de-4d.ts` at all — it would take the
  // 3D path, where the gate refuses it, and land in no render mode.
  it("routes all three to the 4D branch", () => {
    // No lens and no kaleidoscope (neither side table carries an entry), so
    // the transform list alone has to be what makes these non-flat.
    for (const build of [mandelboxBrick, mandelboxColumn, hybridChainShells]) {
      expect(
        systemPartsAreNonFlat(build(), null, { order: 1, plane: "xz" }),
      ).toBe(true);
    }
  });

  it("builds mandelboxBrick as a single fold link on the linear estimate", () => {
    const de = buildEscapeDE4(mandelboxBrick());

    expect(de.links.map((l) => l.kind)).toEqual([ESCAPE_LINK_MANDELBOX]);
    // No power link, so the terminal radius is read through the linear r/dr
    // and not the Böttcher log form.
    expect(de.logEstimate).toBe(false);
  });

  it("builds mandelboxColumn as a single fold link on the linear estimate", () => {
    const de = buildEscapeDE4(mandelboxColumn());

    expect(de.links.map((l) => l.kind)).toEqual([ESCAPE_LINK_MANDELBOX]);
    expect(de.logEstimate).toBe(false);
  });

  it("builds hybridChainShells as a fold-then-power chain on the Böttcher estimate", () => {
    const de = buildEscapeDE4(hybridChainShells());

    expect(de.links.map((l) => l.kind)).toEqual([
      ESCAPE_LINK_MANDELBOX,
      ESCAPE_LINK_QSQUARE,
    ]);
    // A power link makes the chain super-exponential, so the estimate form
    // follows the escape law (`escape-de.ts`'s THE ESTIMATE FORM FOLLOWS THE
    // CHAIN'S ESCAPE LAW).
    expect(de.logEstimate).toBe(true);
  });

  // Pins the authored intent the doc's measured figures rest on: every extent,
  // fill and hit number quoted for this preset was measured on
  // hybridChainQuaternion's exact links with one `w` block added, so a link
  // edited here silently stales the whole paragraph.
  it("is hybridChainQuaternion with a w rotation on the power link and nothing else", () => {
    const [head, power] = hybridChainShells();
    const [flatHead, flatPower] = hybridChainQuaternion();

    expect(head).toEqual(flatHead);
    expect(power.w).toEqual({ rotation: { zw: 0.35 } });
    expect({ ...power, w: undefined }).toEqual({ ...flatPower, w: undefined });
  });

  it("hints all three as surface showcases", () => {
    expect(PRESET_RENDER_HINTS.mandelboxBrick).toBe("surface");
    expect(PRESET_RENDER_HINTS.mandelboxColumn).toBe("surface");
    expect(PRESET_RENDER_HINTS.hybridChainShells).toBe("surface");
  });

  // The other four side tables are ABSENT-MEANS-something for all of them, and
  // three of those defaults are load-bearing here: an inherited final
  // transform or kaleidoscope takes the render mode away outright
  // (`analyzeEscapeSystem4` refuses a final, and a `w`-plane wedge is a no-op
  // at even order — see PRESET_SYMMETRIES' doc), and no wireframe exists for a
  // set with no polytope behind it.
  it("carries no scaffold, lens, palette or kaleidoscope", () => {
    for (const name of [
      "mandelboxBrick",
      "mandelboxColumn",
      "hybridChainShells",
    ] as const) {
      expect(PRESET_SCAFFOLDS[name]).toBeUndefined();
      expect(PRESET_FINALS[name]).toBeUndefined();
      expect(PRESET_PALETTES[name]).toBeUndefined();
      expect(PRESET_SYMMETRIES[name]).toBeUndefined();
    }
  });

  // Registered, or the menu entry in index.html points at nothing —
  // `ui.test.ts`'s preset-menu check compares the <option> values against
  // PRESET_NAMES, so this is the other half of that pair.
  it("registers all three under their menu values", () => {
    expect(PRESET_NAMES).toContain("mandelboxBrick");
    expect(PRESET_NAMES).toContain("mandelboxColumn");
    expect(PRESET_NAMES).toContain("hybridChainShells");
  });

  // ONE MEASURED GUARD PER PRESET, and it is a BAND rather than a value: an
  // empty set renders a blank frame (`escape-de.ts`'s EMPTY CHAINS ARE
  // REACHABLE) and a set filling its own bailout ball renders as the bounding
  // sphere (the Mandelbrot form's own defect), and both are reachable by
  // editing one weight. Sampled far below the sheet's 131072 for suite
  // speed, so the figure moves; the band is wide enough to be about the
  // OBJECT and not the sample. Fill is never a visibility predicate — see
  // the third case.
  const FILL_SAMPLES = 4096;

  it("keeps mandelboxBrick a solid but partial fraction of the 4-ball", () => {
    // Sheet: 14.816% at 131072 samples; 15.186% at this budget.
    const fill = probeEscapeFill4(
      buildEscapeDE4(mandelboxBrick()),
      FILL_SAMPLES,
    );

    expect(fill).toBeGreaterThan(0.08);
    expect(fill).toBeLessThan(0.25);
  });

  it("keeps mandelboxColumn a solid but partial fraction of the 4-ball", () => {
    // Sheet: 14.452% at 131072 samples; 14.722% at this budget.
    const fill = probeEscapeFill4(
      buildEscapeDE4(mandelboxColumn()),
      FILL_SAMPLES,
    );

    expect(fill).toBeGreaterThan(0.08);
    expect(fill).toBeLessThan(0.25);
  });

  it("keeps hybridChainShells a THIN set that still renders", () => {
    // Sheet: 0.346% at 131072 samples, 0.464% at this budget — 43x less
    // volume than the brick while drawing 1.06x its rays (43.7% against
    // 41.4%), which is why the upper bound here sits four times BELOW the
    // pair's lower one and the lower bound is only "not empty".
    const fill = probeEscapeFill4(
      buildEscapeDE4(hybridChainShells()),
      FILL_SAMPLES,
    );

    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(0.02);
  });
});
