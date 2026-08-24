import { composeAffine } from "./affine";
import type { FlamePaletteId } from "./palette";
import type { Rng } from "./rng";
import type {
  HybridSchedule,
  Rotation4,
  SurfaceFinish,
  SymmetryParams,
  Transform,
  Variation,
  Vec3,
  Vec4,
} from "./types";

const HALF = 0.5;

/**
 * The identity map the final-transform lens starts as when first enabled: a
 * visual no-op (unit scale, no rotation/translation, no variation) the user then
 * shapes — mirroring how "+ Add" seeds a plain transform.
 */
export function defaultFinalTransform(): Transform {
  return { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

/** The four-map system the viewer starts with. */
export function defaultTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0.5, 0.5],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.5, 0.5, -0.5],
      rotation: [0, Math.PI / 4, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 2,
      position: [0.5, -0.5, -0.5],
      rotation: [0, 0, Math.PI / 4],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 3,
      position: [-0.5, -0.5, 0.5],
      rotation: [Math.PI / 4, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];
}

/** Four corner maps whose attractor is a Sierpinski tetrahedron. */
export function sierpinskiTetrahedron(): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 1,
      position: [0.75, -0.4, 0],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 2,
      position: [-0.375, -0.4, 0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 3,
      position: [-0.375, -0.4, -0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
  ];
}

/** The 20 edge/corner sub-cubes of a Menger sponge (face/centre cells removed). */
export function mengerSponge(): Transform[] {
  const s = 1 / 3;
  const transforms: Transform[] = [];
  let id = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const zeros = (x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0);
        if (zeros >= 2) continue;
        transforms.push({
          id: id++,
          position: [x * 0.5, y * 0.5, z * 0.5],
          rotation: [0, 0, 0],
          scale: [s, s, s],
        });
      }
    }
  }
  return transforms;
}

/** Six maps arranged on a rising, twisting spiral. */
export function spiral(): Transform[] {
  const transforms: Transform[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    transforms.push({
      id: i,
      position: [Math.cos(angle) * 0.4, i * 0.15 - 0.3, Math.sin(angle) * 0.4],
      rotation: [0, angle * 0.5, 0],
      scale: [0.4, 0.4, 0.4],
    });
  }
  return transforms;
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/**
 * Build self-similar "flake" maps: each one contracts all of space toward a
 * fixed point `v` by `ratio` (so `v` is where that map's copy lands). Choosing
 * the fixed points as the vertices of a polyhedron, with a ratio at which the
 * shrunken copies just touch, yields that polyhedron's Sierpinski-style
 * fractal. One shared ratio because the chaos game picks transforms uniformly.
 */
function flake(vertices: Vec3[], ratio: number): Transform[] {
  const k = 1 - ratio;
  return vertices.map((v, id): Transform => ({
    id,
    position: [v[0] * k, v[1] * k, v[2] * k],
    rotation: [0, 0, 0],
    scale: [ratio, ratio, ratio],
  }));
}

/** Five maps — square base plus apex — whose attractor is a fractal pyramid. */
export function sierpinskiPyramid(): Transform[] {
  const b = 1.2;
  const vertices: Vec3[] = [
    [0, 1.4, 0], // apex
    [b, -0.6, b],
    [b, -0.6, -b],
    [-b, -0.6, b],
    [-b, -0.6, -b],
  ];
  return flake(vertices, HALF);
}

/** Six maps toward the vertices of an octahedron — the Sierpinski octahedron. */
export function octahedronFlake(): Transform[] {
  const r = 1.3;
  const vertices: Vec3[] = [
    [r, 0, 0],
    [-r, 0, 0],
    [0, r, 0],
    [0, -r, 0],
    [0, 0, r],
    [0, 0, -r],
  ];
  // Below the just-touching 0.5: separates the six lobes so the recursive
  // structure reads instead of merging into a near-solid octahedron.
  return flake(vertices, 0.4);
}

/** Twelve maps toward icosahedron vertices — an ornate, near-spherical flake. */
export function icosahedronFlake(): Transform[] {
  const p = (1 + Math.sqrt(5)) / 2; // golden ratio
  const r = 1.4 / Math.hypot(1, p); // circumradius of raw verts is hypot(1, phi)
  const raw: Vec3[] = [
    [0, 1, p],
    [0, 1, -p],
    [0, -1, p],
    [0, -1, -p],
    [1, p, 0],
    [1, -p, 0],
    [-1, p, 0],
    [-1, -p, 0],
    [p, 0, 1],
    [p, 0, -1],
    [-p, 0, 1],
    [-p, 0, -1],
  ];
  return flake(
    raw.map((v) => scaleVec(v, r)),
    0.35,
  );
}

/** Twenty maps toward dodecahedron vertices — the most intricate flake. */
export function dodecahedronFlake(): Transform[] {
  const p = (1 + Math.sqrt(5)) / 2; // golden ratio
  const q = 1 / p;
  const r = 1.5 / Math.sqrt(3); // circumradius of raw verts is sqrt(3)
  const raw: Vec3[] = [
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
    [0, q, p],
    [0, q, -p],
    [0, -q, p],
    [0, -q, -p],
    [q, p, 0],
    [q, -p, 0],
    [-q, p, 0],
    [-q, -p, 0],
    [p, 0, q],
    [p, 0, -q],
    [-p, 0, q],
    [-p, 0, -q],
  ];
  return flake(
    raw.map((v) => scaleVec(v, r)),
    0.3,
  );
}

/**
 * The Jerusalem cube — the Menger sponge's lesser-known cousin. Where the
 * Menger uses one cube size, the Jerusalem cube interlocks cubes of *two*
 * sizes: eight large cubes at the corners (side `L`) and twelve smaller cubes
 * at the edge midpoints (side `S = L²`), leaving a recessed plus/cross on every
 * face. Centering a sub-cube on each edge fixes `2L + S = 1`; with `S = L²`
 * that is `L² + 2L − 1 = 0`, so `L = √2 − 1` and the two scales nest exactly.
 * Twenty maps, no rotation, but two scales — a crisper, rarer relative of the
 * sponge.
 */
export function jerusalemCube(): Transform[] {
  const big = Math.SQRT2 - 1; // L: root of L² + 2L − 1 = 0
  const small = big * big; // S = L² = 3 − 2√2
  const cornerOffset = 0.5 - big / 2; // corner-cube center on each axis
  const edgeOffset = 0.5 - small / 2; // edge-cube offset on its two face axes
  const transforms: Transform[] = [];
  let id = 0;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        transforms.push({
          id: id++,
          position: [x * cornerOffset, y * cornerOffset, z * cornerOffset],
          rotation: [0, 0, 0],
          scale: [big, big, big],
        });
      }
    }
  }
  // One small cube centered on each of the twelve edges: the edge's own axis
  // sits at 0, the other two at ±edgeOffset.
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const e = a * edgeOffset;
      const f = b * edgeOffset;
      transforms.push(
        {
          id: id++,
          position: [0, e, f],
          rotation: [0, 0, 0],
          scale: [small, small, small],
        },
        {
          id: id++,
          position: [e, 0, f],
          rotation: [0, 0, 0],
          scale: [small, small, small],
        },
        {
          id: id++,
          position: [e, f, 0],
          rotation: [0, 0, 0],
          scale: [small, small, small],
        },
      );
    }
  }
  return transforms;
}

/**
 * Chiral Lace — a reflected, tilted tetrahedral gasket. Each of the four maps
 * contracts toward a tetrahedron vertex like a Sierpinski flake, but with a
 * *negative* y-scale (a mirror reflection), unequal axis scales, and a small
 * two-axis tilt. The reflection flips handedness at every level while the
 * uneven scale stretches each copy, weaving an organic, frost-like lace that an
 * upright single-scale flake never produces. It deliberately reaches into the
 * corners of the affine range the other presets leave unused: reflection
 * (negative scale), off-axis rotation, and anisotropic scale.
 */
export function chiralLace(): Transform[] {
  const corners: Vec3[] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  // Seat each copy halfway out toward its (scaled) vertex; the mirror + tilt do
  // the weaving. Scale magnitudes stay < 1 so every map still contracts.
  return corners.map((v, id): Transform => ({
    id,
    position: scaleVec(v, 0.3),
    rotation: [0, 0.5, 0.6],
    scale: [0.54, -0.5, 0.46],
  }));
}

/**
 * One Barnsley-fern map: the *exact* 2x2 linear part of his published affine
 * transform plus its translation, in the fern's own tall coordinates (a frond
 * rooted at the origin growing up +y), with its relative selection weight.
 * These are literally Barnsley's numbers — {@link buildFern} decomposes each
 * linear part into the engine's rotation/scale/shear at build time.
 */
interface FernMap {
  /**
   * Barnsley's exact linear part, row-major `[a, b, c, d]` for the planar map
   * `x' = a·x + b·y`, `y' = c·x + d·y`.
   */
  linear: [number, number, number, number];
  /** Native translation, in Barnsley's coordinates. */
  translate: [number, number];
  /** Relative selection weight (see {@link Transform.weight}). */
  weight: number;
}

/** Uniform shrink that brings the ~10-tall frond into the viewer's box. */
const FERN_SCALE = 0.3;
/** Shift (in fern coordinates) that re-centres the frond on the origin. */
const FERN_CENTER: [number, number] = [-0.07, -1.5];
/** z-axis contraction; any magnitude < 1 collapses the leaf onto z = 0. */
const FERN_FLATTEN = 0.3;
/**
 * Curling Fern only: out-of-plane tilt of the frond map per application,
 * radians. Each recursive step up the rachis adds this tilt, so it compounds
 * into a fiddlehead curl toward the tip. Larger ⇒ tighter curl; 0 ⇒ flat.
 */
const FERN_CURL = 0.12;
/**
 * Hyperfern only: out-of-SPACE tilt of the frond map per application, radians
 * — {@link FERN_CURL}'s 4D sibling, rotating the rachis direction `+y` toward
 * `+w` (the `yw` plane) instead of toward `+z`. Compounds up the frond exactly
 * the same way, so the base stays in the `w = 0` slice while the tip rolls
 * into the fourth dimension. Slightly larger than the 3D curl because the
 * projection hides the curled direction — the head-on foreshortening has to
 * read on its own.
 */
const HYPERFERN_CURL = 0.15;

/**
 * Barnsley's four exact maps, with weights proportional to his published
 * probabilities — `1 : 85 : 7 : 7` for stem : frond : left : right. The frond
 * is a pure similarity (rotation + uniform 0.85 scale) run ~85% of the time and
 * accumulates into the signature curl; the two leaflets are near-similarities,
 * each carrying a slight shear, and the right one also reflects (its 2x2 has a
 * negative determinant). The stem is a rank-1 line map that collapses x —
 * Barnsley's `[[0, 0], [0, 0.16]]` — drawn ~1% of the time.
 */
const FERN_MAPS: FernMap[] = [
  { linear: [0, 0, 0, 0.16], translate: [0, 0], weight: 1 }, // f1 stem
  { linear: [0.85, 0.04, -0.04, 0.85], translate: [0, 1.6], weight: 85 }, // f2 frond
  { linear: [0.2, -0.26, 0.23, 0.22], translate: [0, 1.6], weight: 7 }, // f3 left
  { linear: [-0.15, 0.28, 0.26, 0.24], translate: [0, 0.44], weight: 7 }, // f4 right
];

/** A planar 2x2 linear part decomposed into the engine's affine parameters. */
interface PlanarParts {
  /** z-rotation, radians. */
  angle: number;
  /** Native x scale (always ≥ 0). */
  scaleX: number;
  /** Native y scale; negative ⇒ the map reflects. */
  scaleY: number;
  /** The unit upper-triangular factor's xy shear. */
  shear: number;
}

/**
 * QR-decompose a planar 2x2 linear part `[[a, b], [c, d]]` into the engine's
 * `M = R(angle) · diag(scaleX, scaleY) · [[1, shear], [0, 1]]`.
 *
 * The rotation aligns the first column `(a, c)` with +x, so `scaleX` is that
 * column's length and `angle = atan2(c, a)`. The second scale is the signed
 * area `det(M) / scaleX` (negative ⇒ the map reflects), and the shear is the
 * first column's pull on the second, `(a·b + c·d) / scaleX²`. A zero first
 * column — Barnsley's rank-1 stem, which collapses x — has no width to rotate,
 * so it degenerates to `R(0) · diag(0, d)`.
 */
function decomposePlanar(
  a: number,
  b: number,
  c: number,
  d: number,
): PlanarParts {
  const scaleX = Math.hypot(a, c);
  if (scaleX === 0) return { angle: 0, scaleX: 0, scaleY: d, shear: 0 };
  return {
    angle: Math.atan2(c, a),
    scaleX,
    scaleY: (a * d - b * c) / scaleX,
    shear: (a * b + c * d) / (scaleX * scaleX),
  };
}

/**
 * Build a fern from Barnsley's {@link FERN_MAPS}. Each linear part is decomposed
 * into the engine's rotation/scale/shear ({@link decomposePlanar}) — the right
 * leaflet needs all three, which is what shear unlocked — then conjugated by
 * `A(p) = FERN_SCALE·p + FERN_CENTER` so the frond lands centred in the box.
 * Conjugating by a similarity leaves each map's linear part `M` untouched and
 * only rewrites its translation to `FERN_SCALE·t + (I − M)·FERN_CENTER`.
 *
 * With `curl = 0` this is Barnsley's exact, perfectly planar fern. A non-zero
 * `curl` tilts the dominant frond map that many radians out of plane per
 * application: because the frond is the recursive map that climbs the rachis,
 * the tilt compounds, so the base stays flat while the tip curls like an
 * unfurling fiddlehead, and the leaflets ride the curl inside the rotated
 * copies. Only the frond curls — and it keeps its depth (z-scale = its xy
 * scale) so the tilt is a true 3-D rotation, not flattened to `FERN_FLATTEN`
 * like the planar maps.
 *
 * A non-zero `wCurl` is the same construction one dimension up (the
 * {@link hyperfern}): the frond map gains a `w.rotation.yw` tilt of that many
 * radians per application, rotating the rachis direction into `+w` instead of
 * `+z` while the fern stays exactly planar in z. And for the same reason the
 * 3D curl keeps z-depth, the w-curl pins `w.scale` to the frond's planar
 * scale rather than leaving it derived — derived would be the FLATTENED mean
 * `(0.85 + 0.85 + 0.3)/3`, squashing the curl in `w` each recursion instead
 * of truly rotating it.
 */
function buildFern(curl: number, wCurl = 0): Transform[] {
  const [cx, cy] = FERN_CENTER;
  // The frond is Barnsley's dominant, self-similar map (his highest weight); it
  // alone climbs the rachis, so it alone carries the curl.
  const frond = FERN_MAPS.reduce(
    (best, m, i, maps) => (m.weight > maps[best].weight ? i : best),
    0,
  );
  return FERN_MAPS.map(({ linear, translate, weight }, id): Transform => {
    const [a, b, c, d] = linear;
    const { angle, scaleX, scaleY, shear } = decomposePlanar(a, b, c, d);
    // Translation under the re-centring conjugation: FERN_SCALE·t +
    // (I − M)·FERN_CENTER, using Barnsley's exact M = [[a, b], [c, d]].
    const px = FERN_SCALE * translate[0] + cx - (a * cx + b * cy);
    const py = FERN_SCALE * translate[1] + cy - (c * cx + d * cy);
    const curls = curl !== 0 && id === frond;
    const transform: Transform = {
      id,
      position: [px, py, 0],
      rotation: [curls ? curl : 0, 0, angle],
      scale: [scaleX, scaleY, curls ? scaleX : FERN_FLATTEN],
      shear: [shear, 0, 0],
      weight,
    };
    if (wCurl !== 0 && id === frond) {
      transform.w = { rotation: { yw: wCurl }, scale: scaleX };
    }
    return transform;
  });
}

/**
 * Barnsley's fern — the canonical "looks nothing like its equations" fractal.
 *
 * A *weighted* IFS: the self-similar frond map must run the large majority of
 * the time for the rachis to grow tall and the leaflets to recurse into
 * ever-smaller fronds; pick the four maps evenly and you get a smudge, not a
 * fern. Each map carries a {@link Transform.weight} and the chaos game samples
 * in proportion — frond ~85%, each leaflet ~7%, the stem ~1%. The maps are
 * Barnsley's exact, perfectly planar affine transforms ({@link buildFern}).
 */
export function barnsleyFern(): Transform[] {
  return buildFern(0);
}

/**
 * Curling Fern — Barnsley's fern lifted into 3-D. The maps are identical except
 * the frond is tilted {@link FERN_CURL} radians out of plane each time it
 * recurses, so the frond rolls toward its tip like an unfurling fiddlehead and
 * the leaflets fan out along the curl. See {@link buildFern}.
 */
export function curlingFern(): Transform[] {
  return buildFern(FERN_CURL);
}

/** Attach the same variation blend to every map in a system. */
function withVariations(
  transforms: Transform[],
  variations: Variation[],
): Transform[] {
  return transforms.map((t) => ({ ...t, variations }));
}

/**
 * "Radiolarian" — an {@link icosahedronFlake} bent into an ornate, hollow orb by
 * a partial `spherical` inversion. The twelve vertex maps alone make a crisp,
 * spiky icosahedral gasket; giving each a light `spherical` warp (weight 0.32)
 * blended over a full-weight `linear` everts that gasket through the unit
 * sphere, folding its lobes into the nested, interlocking rings of a
 * fractal-flame "bubble" while the icosahedral symmetry holds it to a rounded
 * shell — a five-fold mandala down one axis, a rounded triangle down another.
 *
 * Keeping `linear` at full weight is the whole trick: unlike the pure `spherical`
 * flame this replaces (a triangular gasket everted into a featureless blob), the
 * geometric skeleton survives the warp, so the attractor reads as an intricate,
 * silica-shelled radiolarian rather than a smudge.
 */
export function radiolarian(): Transform[] {
  return withVariations(icosahedronFlake(), [
    { type: "linear", weight: 1 },
    { type: "spherical", weight: 0.32 },
  ]);
}

/**
 * "Swirl" — a two-map flame that rotates every point by its own squared radius
 * (`swirl`) with a whisper of `linear` to keep the arms coherent. The result is
 * a churning, galaxy-like spiral that the strictly self-similar presets can
 * never produce — the clearest demonstration of what nonlinear variations add.
 */
export function swirlFlame(): Transform[] {
  const base: Transform[] = [
    {
      id: 0,
      position: [0.35, 0.25, 0],
      rotation: [0, 0, 0.5],
      scale: [0.7, 0.7, 0.7],
    },
    {
      id: 1,
      position: [-0.45, -0.2, 0.15],
      rotation: [0.25, 0, 1.3],
      scale: [0.55, 0.55, 0.55],
    },
  ];
  return withVariations(base, [
    { type: "swirl", weight: 1 },
    { type: "linear", weight: 0.2 },
  ]);
}

/** The slot the two {@link dyedSpiral} arm maps SHARE — the whole point of
 * that preset, and the one thing the derived spread cannot express. Named
 * rather than repeated so the two maps cannot drift apart by a typo. */
const DYED_ARM_SLOT = 0.62;

/**
 * "Dyed Spiral" — the showcase for per-transform flame color. A
 * four-map spiral whose palette structure is AUTHORED rather than derived, so
 * color follows where a point CAME FROM instead of where its map happens to
 * sit in the transform list.
 *
 * Every other preset leaves `colorIndex`/`colorSpeed` absent and so gets the
 * even spread `i / (n - 1)` blended halfway on every pick: one hue per map, in
 * list order, and no way to say anything else. This one says three things that
 * spread cannot:
 *
 * - The two ARM maps SHARE {@link DYED_ARM_SLOT}. They are geometrically
 *   distinct — counter-rotating, differently scaled, different tilt — but read
 *   as one color family, so the eye groups them as a single braided structure
 *   instead of two rival hues. Under the derived spread they would be forced
 *   to slots 0 and 1/3.
 * - The CORE map takes a far-off slot at `colorSpeed: 0.9`: a point landing
 *   there SNAPS almost fully to its color rather than drifting toward it, so
 *   the center reads as a hard-edged bloom against the arms rather than a
 *   gradient into them.
 * - The DUST map sits at `colorSpeed: 0` — flam3's "symmetry xform". It never
 *   moves the color coordinate at all, so its wide, low-weight scatter
 *   inherits whatever color the orbit already carried: texture everywhere,
 *   tinting nothing. That is the behaviour the old fixed halfway blend made
 *   impossible, and it is why the map's own `colorIndex` is deliberately left
 *   ABSENT — at speed 0 the slot is never read, so authoring one would be
 *   decoration.
 *
 * The color pair only bites on the structural (gradient-palette) path, so
 * flame is its showcase ({@link PRESET_RENDER_HINTS}); under the `"legacy"`
 * palette it falls back to flat per-map hues like any other system.
 */
export function dyedSpiral(): Transform[] {
  return [
    {
      id: 0,
      position: [0.36, 0.24, 0],
      rotation: [0, 0, 0.55],
      scale: [0.72, 0.72, 0.72],
      colorIndex: DYED_ARM_SLOT,
      variations: [
        { type: "swirl", weight: 1 },
        { type: "linear", weight: 0.25 },
      ],
    },
    {
      id: 1,
      position: [-0.58, -0.34, 0.12],
      rotation: [0.22, 0, -1.5],
      scale: [0.5, 0.5, 0.5],
      colorIndex: DYED_ARM_SLOT,
      variations: [
        { type: "swirl", weight: 1 },
        { type: "linear", weight: 0.25 },
      ],
    },
    {
      id: 2,
      position: [0, -0.04, 0],
      rotation: [0, 0, 0.9],
      scale: [0.42, 0.42, 0.42],
      weight: 0.9,
      colorIndex: 0.05,
      colorSpeed: 0.9,
    },
    {
      id: 3,
      position: [0.02, 0.3, -0.08],
      rotation: [0, 0.4, 0.3],
      scale: [0.56, 0.56, 0.56],
      weight: 0.5,
      colorSpeed: 0,
      variations: [
        { type: "linear", weight: 1 },
        { type: "swirl", weight: 0.3 },
      ],
    },
  ];
}

/** The Julia constant {@link juliaSet} renders: −0.123 + 0.745i, Douady's
 * rabbit — the center of the Mandelbrot set's period-3 hyperbolic
 * component. See {@link juliaSet}'s doc. */
const JULIA_SET_C: [number, number] = [-0.123, 0.745];

/** The Julia constant {@link juliaDust} renders: 0.36 + 0.6i, verified
 * outside the Mandelbrot set with a clean, fast escape (iteration 27 from
 * z = 0 — not a razor's-edge near-boundary crawl). See presets.test.ts. */
const JULIA_DUST_C: [number, number] = [0.36, 0.6];

/**
 * The one-transform recipe shared by {@link juliaSet} and {@link juliaDust}:
 * exact Inverse Iteration (IIM) for the Julia set of z² + c.
 * `variations.ts`'s `julia` IS flam3's `juliaN(power=2, dist=1)` — half the
 * angle, square-root the radius, a random half-turn — which is exactly the
 * pair of inverse branches w±(z) = ±sqrt(z − c) that make
 * J = w+(J) ∪ w−(J), Hutchinson's IFS fixed-point equation with non-affine
 * maps. The chaos game applies a transform's variation to its affine
 * output, V(Mv + t), so translating by −c BEFORE the variation is the one
 * piece of setup IIM needs; `julia`'s own random half-turn already IS the
 * random branch pick. `scale.z = 0` pins the sheet at z = 0 — `julia`
 * carries z through untouched (see `variations.ts`'s file doc), so without
 * it the plane would sit wherever the seed point's z happened to warm up
 * to, not at 0.
 */
function juliaIim(cx: number, cy: number): Transform[] {
  return [
    {
      id: 0,
      position: [-cx, -cy, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 0],
      variations: [{ type: "julia", weight: 1 }],
    },
  ];
}

/** {@link juliaIim}'s single map at an explicit id, so a preset can braid
 * SEVERAL constants into one system ({@link juliaIsland}). Same recipe,
 * same numbers — only the slot differs. */
function juliaBranch(id: number, c: [number, number]): Transform {
  return { ...juliaIim(c[0], c[1])[0], id };
}

/**
 * The Julia set of z² + c at {@link JULIA_SET_C}, by exact
 * Inverse Iteration — see {@link juliaIim}. `−0.123 + 0.745i` is Douady's
 * rabbit, the center of M's period-3 hyperbolic component: the critical
 * orbit of z² + c lands on an attracting 3-cycle (magnitude ~0.869,
 * confirmed identical at iteration 5000 and 50000 — matching residues mod
 * 3) rather than ever escaping, so this Julia set is genuinely, robustly
 * connected — not a near-boundary judgment call (contrast
 * {@link juliaDust}, verified outside M instead; presets.test.ts pins both
 * facts). Measured 93.84% of 50k plotted points straddle the
 * forward-escape boundary within delta 0.01 (91.61% at 0.02, 92.31% at
 * 0.004), against 8.39% for a uniform control over the same disk
 * (2026-08-13 probe, mulberry32(7); presets.test.ts pins the > 0.8 / < 0.3
 * shape of that gap so the recipe cannot silently rot if `julia` or the
 * affine order changes). The bounded cloud's max planar radius (1.4148)
 * sits just under the theoretical escape bailout
 * `(1 + sqrt(1 + 4|c|)) / 2 = 1.5025`, exactly as IIM predicts. See
 * `docs/julia-sets.md` for the harmonic-measure caveat behind the ~6%
 * residual above (it applies to both presets, connected or not).
 *
 * A PROOF, NOT A SHOWCASE — and deliberately still one. A
 * LONE transform parks the flame's color coordinate at
 * `derivedColorIndex(0, 1) = 0.5` forever: there is no second slot for a
 * point's history to move it toward, so this preset is STRUCTURALLY
 * incapable of color variation whatever palette it is handed. That is
 * not a tuning gap, and no palette table can close it — measured hue
 * entropy 0.04, against `radiolarian`'s 0.80 and `swirlFlame`'s 0.94 on
 * the same tone-map (`scripts/julia-flame.harness.ts`). ONE extra map is
 * the entire fix, and {@link juliaIsland} is that fix and nothing else.
 * This pair stays austere anyway, because what it exists to pin is the
 * INVERSE-ITERATION RECIPE (presets.test.ts measures where its points
 * land relative to the escape boundary); a blend or a second constant
 * would render something prettier that those tests could no longer
 * check. Being the demonstration and being the showcase are different
 * jobs; the menu now carries both.
 */
export function juliaSet(): Transform[] {
  return juliaIim(...JULIA_SET_C);
}

/**
 * {@link juliaSet}'s dust twin: the identical IIM recipe at
 * {@link JULIA_DUST_C}, a c verified outside the Mandelbrot set with room
 * to spare (unlike a marginal outside-M c, whose Cantor gaps would be too
 * fine to read as anything but connected — see `docs/julia-sets.md`). For
 * such c the textbook conformal-IFS case holds — both inverse branches
 * w±(z) = ±sqrt(z − c) map a disk containing the Julia set into two
 * genuinely DISJOINT sub-disks — so the attractor is an unambiguous,
 * visibly separated Cantor dust (measured straddle ~11% at delta 0.01,
 * roughly 8x below `juliaSet`'s 93.84%: presets.test.ts checks the
 * constant is outside M directly rather than re-deriving that
 * percentage). See `docs/julia-sets.md`.
 */
export function juliaDust(): Transform[] {
  return juliaIim(...JULIA_DUST_C);
}

/**
 * The second constant the braid presets pair with the rabbit: `−0.4 +
 * 0.6i`, deep inside M's period-2 disc, whose Julia set is the classic
 * many-whorled "spiral". Braided against {@link JULIA_SET_C}'s dendrites
 * the two read as different FAMILIES rather than two views of one, which
 * is what makes the pair worth two transforms.
 *
 * Any c is reachable and no other affine freedom is: a transform applies
 * `V(Mv + t)`, so a `julia` map behind a UNIFORM scale + in-plane
 * rotation is still an exact inverse branch — of `λ(z² + c)`, which is
 * linearly conjugate to some `z² + C`. Scale and rotation therefore only
 * re-coordinate the picture, and the constant is the whole shape
 * freedom, which is why these presets spend it on two constants rather
 * than on affine noise.
 */
const JULIA_SPIRAL_C: [number, number] = [-0.4, 0.6];

/**
 * "Julia Island" — TWO exact IIM maps, at {@link JULIA_SET_C} and
 * {@link JULIA_SPIRAL_C}. Each alone is a genuine Julia
 * set ({@link juliaIim}); both together are the attractor of FOUR
 * inverse branches, which is no polynomial's Julia set — an island whose
 * boundary carries the rabbit's dendrites and the spiral's whorls at
 * once, still built from nothing but exact inverse branches.
 *
 * It is also the cheapest possible fix for what {@link juliaSet}'s doc
 * calls the austere pair's real defect: with two maps the flame's color
 * coordinate tracks WHICH branch the orbit took last, so the palette
 * paints the structure's own history instead of a single flat slot
 * (measured hue entropy 0.28 against `juliaSet`'s 0.04,
 * `scripts/julia-flame.harness.ts`). Flame is its showcase — the
 * log-density exposure is what turns an IIM sheet's tip-heavy density
 * into a legible curve (see {@link PRESET_RENDER_HINTS}) — under the
 * `dusk` palette ({@link PRESET_PALETTES}).
 */
export function juliaIsland(): Transform[] {
  return [juliaBranch(0, JULIA_SET_C), juliaBranch(1, JULIA_SPIRAL_C)];
}

/**
 * "Julia Snowflake" — {@link juliaIsland} seen through a
 * final `julia` LENS ({@link juliaSnowflakeLens}, installed by
 * {@link PRESET_FINALS}). The plot-time map halves every angle and
 * square-roots every radius, so the island folds into a two-fold star and
 * its dendritic boundary wraps the origin.
 *
 * The lens applies at PLOT time only and never feeds back into the orbit,
 * so the attractor under it stays exactly the island's — which is why
 * this is that system plus one table entry rather than a hand-tuned
 * second system, and why the factory below returns the island verbatim.
 * The best panel on `scripts/julia-flame.harness.ts`'s sheet, and made
 * out of nothing but julia maps and a julia lens.
 */
export function juliaSnowflake(): Transform[] {
  return juliaIsland();
}

/** {@link juliaSnowflake}'s plot-time lens. Scale slightly under 1 so the
 * folded star sits inside the frame the island's own auto-fit finds; z
 * pinned to 0 like every map in this family. */
/**
 * "Four Finishes" — the surface FINISH feature's showcase, and the one
 * preset whose subject is how a map's part of the surface CATCHES LIGHT
 * rather than where it lands.
 *
 * The system is the fold-FINAL lens archetype: a Sierpinski-shaped
 * four-map affine base under a `boxfold` final transform
 * ({@link fourFinishesLens}), so the descent takes the same
 * `descendLens` sweep the surface tracers' lens arm exists for, and the
 * frame FILLS — a sparse object cannot show a material.
 *
 * WHY FOUR MAPS AND WHY THIS ONE. A finish is keyed on the hit's depth-0
 * winning branch — exactly the partition the "By Transform" colour source
 * paints — so a showcase has to be a system whose partition is already
 * legible to the eye. Four corner maps of a tetrahedron are the most
 * legible partition this project has: each owns a whole visible lobe, so
 * four different finishes read as four MATERIALS of one object rather than
 * as noise. More maps would be more impressive and less instructive;
 * `mandelboxKifs`'s twelve would be a mosaic.
 *
 * The four are chosen to separate the BRDF's terms rather than to be
 * pretty in isolation: GLASS (transmit 0.75 under a fresnel-weighted
 * reflection) shows the thin-shell read, transmitting head-on and
 * reflecting at grazing; GEMSTONE sits beside it, a hard pinpoint specular
 * over a partial transmit; SATIN is the other end of the exponent, a broad
 * soft sheen; and the fourth map is left UNAUTHORED
 * — the classic formula, byte for byte — because the feature's whole
 * claim is that an absent finish renders exactly as it always did, and a
 * showcase that authors every map cannot show it. The comparison IS the
 * fourth panel.
 *
 * Surface-hinted ({@link PRESET_RENDER_HINTS}): finishes are read by the
 * surface tracers and by nothing else, so the preset opens where its
 * subject exists.
 */
export function fourFinishes(): Transform[] {
  const corners: Vec3[] = [
    [0.35, 0.35, 0.35],
    [-0.35, -0.35, 0.35],
    [0.35, -0.35, -0.35],
    [-0.35, 0.35, -0.35],
  ];
  // Glass, gemstone, satin — then the classic control. Every value is a
  // named bundle from the panel's own Finish select (`ui.ts`'s
  // FINISH_BUNDLES), spelled out here as the numbers the document stores:
  // a bundle is UI vocabulary and never rides a scene, so a preset carries
  // params exactly as a hand-authored scene does. Fields equal to their
  // classic value are OMITTED, which is what the panel's own write rule
  // does and what keeps the fourth map's absence meaningful.
  //
  // NO METAL HERE, and that is a MEASUREMENT rather than a taste: a
  // metalness-1 finish damps the diffuse body away entirely and lights the
  // surface from the backdrop alone, so against this app's SHIPPED dark
  // backdrop (dark's stops are near-black) a chrome map renders very
  // nearly BLACK — measured on this exact system, the lobe that reads
  // bright red unauthored going dark maroon under Chrome. That is
  // physically right (a mirror in an unlit room is dark) and it is exactly
  // why the panel's Finish hint says metals show their backdrop; it is
  // also useless as a showcase, which must read on the backdrop the app
  // actually opens with. The three authored here keep `metalness` at its
  // classic 0, so each shades its own albedo and the differences between
  // them are differences the eye can attribute.
  const finishes: (SurfaceFinish | undefined)[] = [
    // Glass: transmits head-on, reflects at grazing.
    { specular: 0.9, shininess: 96, reflect: 0.35, transmit: 0.75 },
    // Gemstone: a hard pinpoint over a partial transmit.
    { specular: 1, shininess: 128, reflect: 0.5, transmit: 0.35 },
    // Satin: a broad, soft sheen — the other end of the exponent.
    { specular: 0.25, shininess: 8, reflect: 0.08 },
    undefined,
  ];
  return corners.map((position, i) => ({
    id: i,
    position,
    rotation: [0, 0, 0] as Vec3,
    scale: [0.5, 0.5, 0.5] as Vec3,
    ...(finishes[i] ? { finish: finishes[i] } : {}),
  }));
}

/** {@link fourFinishes}'s plot-time lens: the `boxfold` FINAL transform
 * that turns four plain affine corners into a folded surface with enough
 * area to show a material. Turned off-axis so no two lobes catch the light
 * identically — with the fold square to the camera the chrome map and the
 * gemstone map return the same highlight and the sheet reads as two
 * materials, not four. */
export function fourFinishesLens(): Transform {
  return {
    id: 0,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
  };
}

export function juliaSnowflakeLens(): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.9, 0.9, 0],
    variations: [{ type: "julia", weight: 1 }],
  };
}

/**
 * "Julia Pinwheel" — the counter-rotating `swirl` PAIR (the
 * same two arm maps {@link dyedSpiral} braids, without its authored color
 * slots) flattened to the plane, seen through a final `julia` lens turned
 * 1.1 rad ({@link juliaPinwheelLens}). The lens doubles the spiral and
 * pulls its arms around the origin, so the churn reads as a pinwheel
 * rather than a galaxy.
 *
 * Its own ablation already ships beside it: {@link swirlFlame} is this
 * shape without the lens (and without the flattening), which is why the
 * two sit in the same menu group — the fold is the whole difference.
 *
 * Written out rather than derived from that sibling: the two arms are
 * pinned to z = 0 because the `julia` lens carries z through untouched
 * (see `variations.ts`), so an unpinned sheet would sit wherever the seed
 * point's z warmed up to — the same reason {@link juliaIim} pins its own.
 */
export function juliaPinwheel(): Transform[] {
  const swirlPair: Variation[] = [
    { type: "swirl", weight: 1 },
    { type: "linear", weight: 0.25 },
  ];
  return [
    {
      id: 0,
      position: [0.36, 0.24, 0],
      rotation: [0, 0, 0.55],
      scale: [0.72, 0.72, 0],
      variations: swirlPair,
    },
    {
      id: 1,
      position: [-0.58, -0.34, 0],
      rotation: [0, 0, -1.5],
      scale: [0.5, 0.5, 0],
      variations: swirlPair,
    },
  ];
}

/** {@link juliaPinwheel}'s plot-time lens — the 1.1 rad turn is what puts
 * the arms where the sheet's panel has them; z pinned to 0 like the maps
 * it folds. */
export function juliaPinwheelLens(): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 1.1],
    scale: [0.8, 0.8, 0],
    variations: [{ type: "julia", weight: 1 }],
  };
}

/**
 * "Fold Lattice" — an eight-map fold lattice built on the `mandelbox`
 * variation, the box-fold + sphere-fold composite behind the
 * escape-time Mandelbox, here driving an IFS. It carried the menu label
 * "Mandelbox" until the Mandelbrot form made the actual Mandelbox reachable
 * ({@link mandelboxClassic}) and the name had to go to the object that
 * earns it; the preset KEY is untouched, since keys never reach a saved
 * document. Each map runs the classic step
 * `s·sphereFold(boxFold(p̃))` at `s = 1.2` over a contracted, slightly
 * twisted copy of space, with a whisper of `linear` keeping the creases
 * connected. Rendered: a hollow cube of folded plates over vaulted interior
 * arches, wrapped in the sphere fold's inversion glow — flame is its
 * showcase ({@link PRESET_RENDER_HINTS}).
 *
 * The eight maps are exact conjugates under the box's own symmetries —
 * quarter-turns about y and the y-mirror. Both commute with the folds (a
 * quarter-turn/mirror only permutes/negates the folded axes; the sphere fold
 * is rotation- and reflection-invariant), so conjugating one map moves ONLY
 * its translation (rotated / y-negated) and its y-twist's sign (mirror
 * conjugation reverses the turn). Two y-mirrored rings of four y-rotated
 * translations therefore make the IFS genuinely symmetric under the full
 * 4-fold prism group: the boxy Mandelbox facade owned by the transforms
 * themselves rather than the kaleidoscope setting.
 */
export function mandelboxLattice(): Transform[] {
  const twist = 0.08;
  const scale: Vec3 = [0.5, 0.5, 0.5];
  const t: Vec3 = [0.78, 0.42, 0.22];
  const ring = (y: number): Vec3[] => [
    [t[0], y, t[2]],
    [t[2], y, -t[0]],
    [-t[0], y, -t[2]],
    [-t[2], y, t[0]],
  ];
  // Conjugating by the y-mirror flips the y-twist's sign along with the
  // translation's y, so the lower ring twists the other way.
  return [...ring(t[1]), ...ring(-t[1])].map((position, id): Transform => ({
    id,
    position,
    rotation: [0, id < 4 ? twist : -twist, 0],
    scale,
    variations: [
      { type: "mandelbox", weight: 1.2 },
      { type: "linear", weight: 0.25 },
    ],
  }));
}

/**
 * "Mandelbox KIFS" — the fold family's SURFACE-render showcase:
 * twelve maps whose variation lists are each exactly ONE fold entry, so the
 * surface DE can descend them. Its sibling {@link mandelboxLattice} never
 * can: a `mandelbox` + `linear` BLEND is a weighted sum, not a composition,
 * and has no inverse branches to descend (see `surface-de.ts`'s fold
 * section) — this preset is that lattice's pure-fold twin, kept as its own
 * system rather than a derived variant because the pure-fold contraction
 * budget forces every other number to move with it.
 *
 * THE BUDGET. A pure-fold map iterates `w·V(Mp + t)`, so eligibility gates
 * the composite Lipschitz bound `|w|·L_V·sigma_max < 1`. The sphere fold's
 * inner branch multiplies by 4 (`L = 4` for `mandelbox`/`spherefold`), so at
 * the lattice's own fold weight `1.2` the affine scale could go as high as
 * `1/(4·1.2) ≈ 0.208` — but the BINDING constraint is the descent's depth
 * ceiling, not the gate: `buildSurfaceDE` sizes `maxDepth` so the slowest
 * branch factor resolves features below `1e-4`, and a composite of `0.97`
 * would need ~300 levels against `MAX_DESCENT_DEPTH`'s 128 — the clamp
 * measured as ~0.23%R of erosion on exact on-attractor probes (the
 * clamp-erosion residual class, fold edition). `0.19` puts the composite at
 * `4·1.2·0.19 = 0.912`, which resolves in exactly 100 levels — under the
 * ceiling with margin — at a barely-visible cost in fold-structure size.
 * The box fold's branches are plane REFLECTIONS (`L = 1`), so a `boxfold`
 * map's whole budget is `|w|·sigma_max` — which is why the four binder
 * maps below contract at `0.66` where the eight Mandelbox maps must sit
 * at `0.19`.
 *
 * THE SHAPE. Eight `mandelbox` maps sit on the cube's corners (`±0.7`), one
 * per corner: at ratio `0.242` those eight alone are a dust (similarity
 * dimension `log 8 / log 4.1 ≈ 1.5`), so a `boxfold` tetrahedron — the four
 * EVEN corners at `0.62`, contracting at `0.66` — knits them into a
 * connected body. Rendered: a cubic core of rounded, crease-carved blocks
 * with eight corner lobes repeating the whole at every scale, hollow enough
 * (measured 74% empty cells inside its own p90 ball) that the surface tracer
 * sees real interior.
 *
 * THE SYMMETRY. Every element of the tetrahedral group `T_d` is a signed
 * permutation matrix; the box fold acts per axis and is odd, so it commutes
 * with signed permutations, and the sphere fold is radius-only, so it
 * commutes with every orthogonal map. Conjugating a map by a `T_d` element
 * therefore moves ONLY its translation (rotation is identity throughout,
 * scale and variation untouched), and both translation orbits — all eight
 * cube corners, the four even corners — are closed under `T_d`. The
 * attractor carries the full 24-element tetrahedral symmetry with not one
 * rotated map, and the chaos-game cloud lands a `±1.11` cube (max radius
 * `1.92`, octants even to 14%).
 *
 * WHY TWELVE. A fold map expands into 81 (`mandelbox`) or 27 (`boxfold`)
 * inverse branches per descent level, so map count is a direct cost on the
 * tracer, not just on the 24-slot uniform arrays: the 20-cell Menger
 * arrangement of the same maps measured ~14x this system's descent cost for
 * no more structure.
 */
/**
 * The escape-time Mandelbox family's shared recipe: ONE fold map
 * at a non-contracting weight, no pre-fold offset.
 *
 * `analyzeSurfaceSystem` refuses this shape — an expanding map has no IFS
 * attractor to descend onto — and that refusal is precisely what routes it to
 * `escape-de.ts` instead, which iterates the map FORWARD from each query and
 * marches the boundary of the set whose orbits stay bounded. So these presets
 * reach a render mode no other preset can, which is the whole reason they
 * exist: before them the only way into the escape-time mode was to author a
 * single fold map by hand and hope the weight was a good one.
 *
 * `weight` is the classic Mandelbox `scale`, and it is the family's real
 * knob — the three presets below are one number apart and are three different
 * objects. `position` (the fold's box/sphere centre) is a second, continuous
 * one: left at zero here for the textbook object, but live, and morphs and
 * mutations already interpolate it.
 */
function escapeMandelbox(weight: number): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight }],
    },
  ];
}

/**
 * The Mandelbox itself, at the canonical scale 2 — the knobbly
 * fractal ball with crevices running to every depth, and the object the
 * escape-time mode was built for. Measured (`scripts/escape-form-sweep.harness.ts`):
 * its non-escaping set fills 10.6% of the bailout ball and reaches to the
 * ball's own radius, so the session's opening framing is right for it.
 */
export function mandelboxClassic(): Transform[] {
  return escapeMandelbox(2);
}

/**
 * The same map at scale 3: by far the sparsest of the three at
 * 2.8% ball fill, and the sparseness is what shapes it — the solid breaks up
 * into many small densely-packed lobes arranged in a shell around a hollow
 * centre, which from the session's opening view reads as a ring. (Described
 * from the shipped render at that pose rather than from the fold algebra: an
 * earlier draft of this comment called it "a ball drilled through by rings of
 * circular voids", which is the CPU harness's higher-angle view and overstates
 * what the default framing shows.)
 */
export function mandelboxRings(): Transform[] {
  return escapeMandelbox(3);
}

/**
 * The same map at scale -1.5. Negative scales turn the Mandelbox
 * inside out: the set becomes a solid CUBE (17.7% ball fill, the fattest of
 * the three) with fractal detail carved into its faces rather than a lobed
 * ball — the cheapest of the three to march, and the one that reads clearly
 * at a glance.
 */
export function mandelboxCube(): Transform[] {
  return escapeMandelbox(-1.5);
}

/**
 * One link of an escape-time CHAIN in the document's own
 * vocabulary: a transform whose only variation is a single fold, at a
 * `weight` that is the classic Mandelbox `scale` and a `rotation` that is
 * genuinely part of the formula rather than a re-posing (the orbit applies
 * `M` before the fold, and folds do not commute with rotations).
 *
 * The whole point of these presets is that the transform LIST is a formula
 * chain: orbit step `i` applies link `i mod n`, with the Mandelbrot offset
 * `+ p` and the bailout test after EACH link (see `escape-de.ts` — "THE LIST
 * IS THE SEQUENCE"). So a link is exactly {@link escapeMandelbox}'s single
 * map with the list one longer, and no preset below invents any vocabulary
 * the single-map trio did not already have.
 */
function foldLink(
  id: number,
  type: "mandelbox" | "boxfold" | "spherefold",
  weight: number,
  rotationY = 0,
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, (rotationY * Math.PI) / 180, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
  };
}

/**
 * "Fold Chain" — the escape-time mode's first HYBRID: a
 * Mandelbox at the canonical scale 2 followed by a box fold at 1.6 through a
 * 20° turn about `y`, the orbit alternating between them one link per step.
 *
 * It exists because the chain shipped with no way in. `escape-de.ts` became a
 * formula chain and both shader mirrors learned to cycle it, but every
 * escape-time preset was still ONE map — so the only route to a hybrid was to
 * hand-author two transforms and guess two weights and an angle, which is the
 * "a render mode with no preset is a mode nobody reaches" hole
 * {@link mandelboxClassic} was created to close, one composition level up.
 *
 * The 20° turn is what makes this a chain rather than a longer Mandelbox: with
 * both links axis-aligned the two folds share the cube's symmetry group, and
 * the second fold's creases land on the first's. Turned, the box fold cuts
 * ACROSS them, and the flanged, ring-eyed body of {@link mandelboxClassic}
 * becomes a wider, flatter-topped mass carved by coarse voids that run right
 * through it (close in it reads as a fluted drum; from the session's opening
 * stand-off, as a cratered round body). Measured
 * (`scripts/escape-chain.harness.ts`'s method): 6.7% of the bailout ball,
 * against the single map's 7.8% — composition here changes the SHAPE at
 * essentially unchanged density, which is the argument for shipping it beside
 * the trio rather than instead of any of them.
 */
export function foldChain(): Transform[] {
  return [foldLink(0, "mandelbox", 2), foldLink(1, "boxfold", 1.6, 20)];
}

/**
 * "Fold Chain Boulder" — three links: Mandelbox 2, Mandelbox −1.5, and
 * {@link foldChain}'s 20°-turned box fold at 1.6. Where the
 * two-link chain is carved by a few coarse voids, this is the densest and
 * roundest of the three — a near-spherical MASS filling its bailout ball,
 * finely pitted all over rather than cut through.
 *
 * The middle link is the map {@link mandelboxCube} is built on. A negative
 * scale turns the Mandelbox inside out (that preset's whole subject), so as
 * a link it re-enters the positive-scale fold's output through an
 * orientation-reversing one every pass, and the turned box fold then cuts
 * across both. Three links, three genuinely different maps: nothing here can
 * collapse back to a longer Mandelbox.
 *
 * SUBSTITUTED, and the reason is framing. The chain first drafted
 * here was `Mandelbox 2 → box fold 1.6 → sphere fold 1.2`, whose silhouette
 * is a far more interesting object — a flat-topped urn with a rim and a
 * waist, no single fold map's shape at any weight. But `buildEscapeDE` pins
 * `boundingRadius` to the BAILOUT ball for every escape system, and main.ts
 * frames a new escape session on exactly that ball, so an object reaching
 * only ~2.0 of a radius-4 ball opens as a speck a quarter of the pane wide
 * (measured: 2.8% ball fill, ~7% of pixels hit). This chain fills 7.8% and
 * reaches 3.96 — the same presence as {@link mandelboxClassic} — which is
 * what a preset owes on load. The urn is still one edit away for anyone who
 * wants it; it is just not what a menu entry should open on.
 */
export function foldChainBoulder(): Transform[] {
  return [
    foldLink(0, "mandelbox", 2),
    foldLink(1, "mandelbox", -1.5),
    foldLink(2, "boxfold", 1.6, 20),
  ];
}

/**
 * "Fold Chain Flower" — {@link foldChain}'s two links under a five-fold
 * kaleidoscope, and the preset that needed {@link PRESET_SYMMETRIES} to
 * exist at all.
 *
 * The kaleidoscope is not decoration here, it is the object: `escape-de.ts`
 * folds the QUERY into one sector before the orbit runs (`foldQueryIntoSector`
 * — 1-Lipschitz, an isometry per sector, so the rendered set is exactly
 * `g⁻¹(M)` and costs nothing per orbit step), which makes the result dihedral
 * rather than the chaos game's cyclic. Looked at down its own axis it is a
 * five-petalled flower around a ring; obliquely — the app's opening camera —
 * it reads as radial fluting on a drum, so this preset rewards an orbit to
 * the pole in a way the other two do not.
 *
 * FIVE, specifically. Both links' folds are odd axis by axis, so the chain
 * already carries the cube's own symmetry and a wedge fold at order 2 or 4
 * would be a NO-OP — the preset would silently be {@link foldChain} again.
 * Five is coprime to the cube's 4-fold axis, so every sector boundary cuts
 * new geometry. Measured 7.0% of the bailout ball against the bare chain's
 * 6.7%: the fold moves structure around the axis without inflating the set.
 */
export function foldChainFlower(): Transform[] {
  return foldChain();
}

/**
 * The Mandelbulb family's shared recipe: ONE map whose only
 * variation is the `bulb` triplex 8th power at weight 1 — the exact shape
 * `analyzeBulbSystem` admits, and the deliberate complement of both other
 * surface gates (`analyzeSurfaceSystem` refuses it for "uses variations",
 * `analyzeEscapeSystem` for "not a pure fold"). Surface then iterates the
 * map FORWARD from every query and marches the boundary of the set whose
 * orbits stay bounded: the Mandelbulb.
 *
 * These exist for {@link mandelboxClassic}'s reason, one object over: the
 * `bulb` variation, its CPU estimator and both shader mirrors all shipped
 * before anything routed a bulb system into the renderer, so the only way
 * to reach the most famous 3D fractal there is was to author a single
 * triplex-power map by hand and hope. A render mode with no preset is a
 * mode nobody reaches.
 *
 * The whole family is ONE map with two knobs, and both are already
 * document state that morphs and mutations interpolate: `position` is the
 * PRE-power offset `t` (the textbook object is `t = 0`), and `rotation`
 * is a genuinely SECOND family rather than a re-posing, because `M` does
 * not commute with the triplex power (see `bulb-de.ts`). The power itself
 * is fixed at 8 and deliberately not a knob — every power needs its own
 * closed form, since triplex multiplication is not associative.
 */
function bulbMap(t: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Transform[] {
  return [
    {
      id: 0,
      position: t,
      rotation,
      scale: [1, 1, 1],
      variations: [{ type: "bulb", weight: 1 }],
    },
  ];
}

/**
 * The Mandelbulb itself — the White/Nylander triplex 8th power
 * at `t = 0`, which is the object every published "Mandelbulb" render
 * shows: a knobbly ball of stacked bulbs with a fluted equator and
 * filigree running into every crease. `scripts/bulb-preview.harness.ts`'s
 * first panel is this exact system through the shipped estimator.
 */
export function mandelbulbClassic(): Transform[] {
  return bulbMap();
}

/** The shipped look target for the metal room: neutral Chrome on a broad,
 * smooth-enough Mandelbulb subject. The room itself is preset side-state
 * below; keeping the transform finish here means exports/share links retain
 * the material exactly like a hand-authored Chrome choice. */
export function metalStudio(): Transform[] {
  return mandelbulbClassic().map((transform) => ({
    ...transform,
    finish: {
      specular: 1,
      shininess: 96,
      metalness: 1,
      reflect: 0.9,
      reflectionTint: 0,
    },
  }));
}

/**
 * The same power with a pre-power offset. `t` is added BEFORE
 * the triplex power rather than after it, so it does not slide the object
 * — it bites into it, opening the bulbs asymmetrically and breaking the
 * z-axis symmetry the classic object has. The one continuous deformation
 * knob the mode carries, at a value the harness sheet renders.
 */
export function mandelbulbOffset(): Transform[] {
  return bulbMap([0.2, -0.1, 0.3]);
}

/**
 * The same power behind a ROTATION — a genuinely different
 * object, not a different view of the first. A rigid rotation `M` applied
 * before the power does not commute with it (the triplex power is defined
 * in spherical coordinates about the z axis, so rotating first moves
 * which direction the eight-fold azimuthal fan is measured from), and the
 * orbit re-applies `M` every iteration: the poles walk, and the stacked
 * bulbs shear into a spiral rather than a stack. Turning the camera
 * around {@link mandelbulbClassic} can never produce it.
 */
export function mandelbulbRotated(): Transform[] {
  return bulbMap([0, 0, 0], [0.4, -0.8, 0.3]);
}

/**
 * One link of a CROSS-FAMILY escape-time chain: {@link foldLink}'s
 * SIBLING, admitting the two POWER maps — `bulb`, `qsquare` — beside the
 * three folds, and spending its fourth parameter on a uniform `scale` where
 * {@link foldLink} spends one on rotation. `scale` is `escape-de.ts`'s
 * "pre-scale" — the same affine scale every transform already carries,
 * multiplying the point BEFORE the variation runs.
 *
 * A SIBLING RATHER THAN A WIDENING, deliberately. {@link foldLink}'s own doc
 * says it builds a transform whose only variation is a single FOLD, and
 * widening its type union would falsify that sentence for all three
 * `foldChain*` presets without changing a thing about what they build. The
 * two also want different fourth parameters — no fold-chain preset needs a
 * scale, and none of these three needs a rotation — and two independently
 * motivated fourth parameters on one function is worse than two functions
 * with narrower, honest docs. Both return an ordinary `Transform`, so
 * nothing downstream knows a helper exists at all.
 *
 * A power link needs this knob in a way a fold link never did: a
 * unit-weight triplex power's own safe affine scale against this mode's
 * radius-4 bailout ball is 0.30 (0.5 for the quaternion square) —
 * `escape-de.ts`'s `escapeLinkStiffnessLimit`, an order of magnitude
 * tighter than any fold link here has ever needed. The shipped orbit CYCLES
 * rather than chains, which is what makes a link renderable well past that
 * bound rather than merely near it (that module's POWER LINKS ARE STIFF
 * paragraph) — the three presets below sit at 0.5, past the bulb's own
 * "safe" limit, and still render cleanly.
 */
function hybridLink(
  id: number,
  type: "boxfold" | "spherefold" | "mandelbox" | "bulb" | "qsquare",
  weight: number,
  scale = 1,
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [scale, scale, scale],
    variations: [{ type, weight }],
  };
}

/**
 * "Hybrid Chain Cube" — the escape-time mode's first CROSS-FAMILY chain:
 * {@link mandelboxCube}'s own inside-out mandelbox fold (weight −1.5)
 * followed by a Mandelbulb triplex power pre-scaled to 0.5. A
 * Mandelbox and a Mandelbulb, in one formula chain — exactly the
 * combination `escape-de.ts`'s CROSS-FAMILY LINKS section widened the chain
 * to reach, where before the three estimators shipped as three separate
 * modes, unable to be combined.
 *
 * The composition reads as exactly what it is. {@link mandelboxCube}'s
 * negative-scale fold is already a solid cube with fractal detail carved
 * into its faces (that preset's own doc); cycling a pre-scaled bulb link
 * into the orbit after it stamps a Mandelbulb's cauliflower skin onto those
 * faces and bores circular pits into them — unmistakably two named objects
 * composed, not a third, unrelated one.
 *
 * Measured (`scripts/hybrid-chain.harness.ts`'s own preset test, a single
 * quiet-box run — see that file to regenerate these figures rather than
 * re-derive them): 29.0% of rays hit; `probeEscapeFill` reads 17.642% of
 * the bailout ball filled at 131072 samples — the densest of the three
 * hybrids, and the only one with double-digit fill. It is also the
 * priciest per eval of the three (0.34 us), and the only hybrid dearer
 * than either shipped fold control (foldChain 0.15, mandelboxClassic
 * 0.14 — 2.3-2.4x). Plausibly the same mechanism as the module doc's
 * n-times iteration ceiling, paid only by a non-escaping orbit — this
 * chain leaves the most orbits non-escaping of the three, consistent
 * with being the only one whose fill sits in double digits — though the
 * cost/fill relationship was not separately measured for this trio. Its
 * heuristic bound is also the loosest of the three at this pose (44.1%
 * raw overshoot, against Quaternion's 7.3% and Craters' 0.0%) — but the
 * DAMPED marching step, the number that actually governs the tracer,
 * overshoots only 0.3% of the time, tighter than the shipped
 * {@link foldChain} control's 4.1%.
 */
export function hybridChainCube(): Transform[] {
  return [hybridLink(0, "mandelbox", -1.5), hybridLink(1, "bulb", 1, 0.5)];
}

/**
 * "Hybrid Chain Craters" — the POWER LINK FIRST: a Mandelbulb
 * triplex power pre-scaled to 0.5, followed by {@link mandelboxClassic}'s
 * own mandelbox fold at weight 2 — the same two map types
 * {@link hybridChainCube} chains, reordered, and at the classic scale
 * rather than Cube's inside-out −1.5.
 *
 * LINK ORDER IS A REAL KNOB, and this pair is the demonstration: the same
 * two maps, the other way round, are a different object entirely. Cube's
 * fold-then-bulb order reads as a cube with a Mandelbulb skin stamped onto
 * its faces; running the bulb FIRST instead folds its already
 * power-stretched output back toward the origin every pass, and the result
 * reads as nothing like a cube at all — a pitted sphere whose entire
 * surface is bulb-shaped craters.
 *
 * A thin fractal, and not merely by description: 18.5% of rays hit while
 * `probeEscapeFill` reads just 0.011% of the bailout ball filled at
 * 131072 samples (same harness run as {@link hybridChainCube}'s doc).
 * {@link mandelboxRings} is the shipped precedent for exactly this
 * shape — a thin fractal with a large surface and essentially no
 * volume: `escape-de.ts`'s own EMPTY CHAINS section quotes it at
 * "0.0000% fill at 65536 samples." Both are systems a volume probe reads
 * as next to nothing while the renderer fills a meaningful fraction of
 * the frame with them — literally the pair of numbers the blank-frame
 * notice's first cut got wrong, reproduced by a preset that ships.
 *
 * Its heuristic bound is exact at this pose (0.0% / 0.0% overshoot), and
 * at 0.08 us/eval it is cheaper than BOTH shipped fold controls
 * (foldChain 0.15, mandelboxClassic 0.14) — not merely the cheapest of
 * the three hybrids. A cross-family chain costing less per estimate than
 * the single Mandelbox is the opposite of what a stiff power link sounds
 * like it should produce: an orbit that leaves via the stiff bulb link
 * on its first pass never reaches the fold at all, so it never pays the
 * chain's n-times iteration ceiling, resolving well inside the 30-pass
 * budget (by pass 8, per the harness's own budget table).
 */
export function hybridChainCraters(): Transform[] {
  return [hybridLink(0, "bulb", 1, 0.5), hybridLink(1, "mandelbox", 2)];
}

/**
 * "Hybrid Chain Quaternion" — the only place in the app a `qsquare` map
 * renders at all: {@link mandelboxClassic}'s own mandelbox fold
 * at weight 2, followed by the quaternion square pre-scaled to 0.5.
 *
 * `qjulia-de.ts` measured the quaternion square ALONE as smooth and
 * detail-free — twenty panels across rotations, rotor-posed slices and
 * several constants, all shells and whorls and none of them fractal
 * detail — and a renderer of its own was refused on exactly that
 * measurement (see that module's doc). `escape-de.ts`'s own gate names it
 * directly on the same grounds when it refuses a LONE quaternion square —
 * "`qjulia-de.ts`'s measured-dull object" — but a chain is not a lone map,
 * and composed with a fold the object earns a place it does not have
 * alone.
 *
 * Measured (same harness run as {@link hybridChainCube}'s doc): 47.9% of
 * rays hit; `probeEscapeFill` reads 1.587% of the bailout ball filled at
 * 131072 samples, at 0.11 us/eval — cheaper than BOTH shipped fold
 * controls (foldChain 0.15, mandelboxClassic 0.14), 0.73x foldChain's
 * cost despite being a genuinely new map pairing. Its heuristic bound is
 * also TIGHTER than that control at the same pose (7.3% / 2.1% overshoot
 * against 8.0% / 4.1%), another instance of composition not degrading DE
 * quality (`escape-de.ts`'s COMPOSITION BUYS DE QUALITY section). One
 * plausible contributor, not separately confirmed here: one of the two
 * links' bound is EXACT rather than heuristic — the quaternion square's
 * `2|y|` local factor, exact because quaternion norms are multiplicative
 * rather than merely Lipschitz-bounded.
 */
export function hybridChainQuaternion(): Transform[] {
  return [hybridLink(0, "mandelbox", 2), hybridLink(1, "qsquare", 1, 0.5)];
}

/**
 * The 4D escape-time PAIR's shared recipe: {@link mandelboxCube}'s
 * own map — the inside-out fold at weight −1.5 — with ONE `w`-mixing rotation
 * angle spliced onto it, and nothing else touched.
 *
 * SPREAD ONTO THE 3D PRESET'S TRANSFORM rather than re-spelled, because the
 * pair's whole claim is that these two systems ARE {@link mandelboxCube} with
 * one angle changed. Written out longhand that claim would be a comment
 * anybody could falsify with an edit; here it is the code, and the two
 * presets below differ from each other by exactly the argument. A rotation is
 * the only parameter the recipe takes because the rotation is the only thing
 * that differs — the `w` block (`types.ts`'s
 * {@link import("./types").WExtension}) carries a `w` position, a `w` scale
 * and a shear too, and none of them is in play here.
 *
 * BOTH ARE REFUSED BY THE 3D GATE AND ADMITTED BY THE 4D ONE, which is the
 * whole reason they are new objects rather than new views:
 * `analyzeEscapeSystem` reports `map 1 extends into 4D` for each of them, and
 * `analyzeEscapeSystem4` — the twin whose folds treat `w` exactly like a
 * spatial axis — admits them. No 3D document can express either.
 *
 * A `w` ROTATION AND NEVER A `w` TRANSLATION, and that is measured rather
 * than stylistic. A sweep of the other knob — the quaternion square's `k`
 * component, i.e. a `w` OFFSET on a chain link — came back negative: it
 * behaves as a weaker fourth translation, every slice off `w = 0` is an
 * EROSION of the `w = 0` set (containment 94-98%), and there is nothing left
 * to draw at all by `w0 = 0.8`. A translation cannot MIX `w` with a spatial
 * axis; it can only slide the object along an axis the render then cuts
 * across. A rotation mixes, so a flat query's orbit leaves the `w = 0`
 * hyperplane at the very first link. `scripts/escape-4d.harness.ts` section 3
 * re-ran that same question against the rotation knob (on its own subject
 * chain, `mandelbox 2` turned `xw 0.35` then `mandelbox −1.5`, not on this
 * pair) and got the opposite answer: containment reads 57.0 / 55.3 / 52.5 /
 * 61.3 / 61.5% as `w0` runs 0.1 → 1.2, so roughly HALF of every offset
 * slice's members are not members of the `w0 = 0` slice — genuinely different
 * cuts rather than a shrinking subset — and 16.0% of rays still draw at
 * `w0 = 1.2`, where the translation sweep had gone blank by 0.8. The slice
 * slider is a live knob on a `w`-rotated system; it pays in density, not in
 * existence.
 */
function turnedCube(
  rotation: Pick<Rotation4, "xw" | "yw" | "zw">,
): Transform[] {
  const [cube] = mandelboxCube();
  return [{ ...cube, w: { rotation } }];
}

/**
 * "Mandelbox Brick" — {@link mandelboxCube} turned 1.0 rad in the `xw`
 * plane, and half of a PAIR whose other half is {@link mandelboxColumn}.
 *
 * THE ROTATION PLANE PICKS THE LONG AXIS, and that is the pair's subject.
 * `mandelboxCube` renders a solid cube with fractal detail carved into its
 * faces, and the sheet's per-axis extent column reads 2.00/2.00/2.00 for it —
 * a cube, to the instrument's own resolution. Turn the same map into `w` and
 * the proportions move with the PLANE: `xw` reads 3.13/2.00/2.00, a wide
 * BRICK with its face medallions flattened into shallow pits, while
 * {@link mandelboxColumn}'s `yw` reads 2.00/2.49/2.00, a standing column. A
 * 4D rotation showing up as a 3D PROPORTION is the clearest thing this family
 * can show a user, and it happens here on a single-map document — the
 * simplest shape either escape-time gate admits. (`reach` cannot see any of
 * it: reach is a radius, and a brick and a cube of the same diagonal read
 * identically through one, which is why `scripts/escape-4d.harness.ts` prints
 * three numbers per row.)
 *
 * AND THE 4D VIEW'S ROTOR UNDOES IT, live. The sheet's section 4 poses this
 * exact system through `rotorInv · vec4(p, w0)`, the kernel body's own lift,
 * and the three `w`-FREE control poses hold its member count to 0.4%
 * (67367-67604 against the identity pose's 67427) — a rigid turn, exactly as
 * the algebra requires. The `xw` rotor poses instead drop 20-28% of their
 * members and walk the extent from 3.13/2.00/2.00 through 2.39 and 2.14 to
 * EXACTLY 2.00/2.00/2.00 at rotor `xw = 1.0`: the rotor cancelling the
 * document's own `xw = 1` and handing back cube proportions. `zw 0.6`
 * redirects instead, to 3.13/2.00/2.42. So on this pair — anisotropic in `w`
 * by construction — the 4D rotor slider reads as geometry rather than as a
 * tumble, which the sheet's other subject (a chain, near-isotropic in `w`)
 * does not do.
 *
 * Measured at the entry pose (`scripts/escape-4d.harness.ts`'s shortlist,
 * where this row is `escapeBrick`): 41.4% of rays hit, against the 3D
 * {@link mandelboxCube} control's 30.7% through the same marcher at the same
 * camera — 4-ball fill 14.816%, `w = 0` slice fill 25.705%. Cost 1.45
 * us/eval against the control's 0.90. The fill, extent and hit columns are
 * seeded and deterministic; the us column is wall clock and moves with the
 * machine, so read it as the 1.6x ratio to the control on that same run.
 */
export function mandelboxBrick(): Transform[] {
  return turnedCube({ xw: 1 });
}

/**
 * "Mandelbox Column" — the same map as {@link mandelboxBrick}, turned 0.8 rad
 * in `yw` instead of `xw`. It exists to run that preset's
 * plane → axis claim TWICE, which is what turns an observation into a knob:
 * one rotated system is a curiosity, two systems whose long axis follows the
 * plane you rotated in is a rule the user can predict and steer.
 *
 * The extent column reads 2.00/2.49/2.00 against the brick's 3.13/2.00/2.00
 * and the 3D cube's 2.00/2.00/2.00, so this is a standing COLUMN where that
 * one is a lying brick — and its faces read as banded in horizontal courses
 * rather than medallioned. The two angles differ (1.0 rad and 0.8) because
 * each is the value the sheet measured, not because the plane demands one:
 * the axis follows the PLANE, and the angle sets how far.
 *
 * Measured at the entry pose (the sheet's `escapeColumn` row): 41.6% of rays,
 * 4-ball fill 14.452%, slice fill 21.512%, 1.30 us/eval. The two columns a
 * user reads as "is it there" land within half a point of the brick's (41.4%
 * of rays, 14.816% fill); what moves is the shape — the extents above, and a
 * `w = 0` slice 4.2 points thinner. That is the pair's point.
 * Both are refused in 3D with `map 1 extends into 4D` (see {@link
 * turnedCube}).
 */
export function mandelboxColumn(): Transform[] {
  return turnedCube({ yw: 0.8 });
}

/**
 * "Hybrid Shells" — {@link hybridChainQuaternion} with the QUATERNION SQUARE
 * link turned 0.35 rad in the `zw` plane: the cross-family member
 * of the 4D escape-time trio, and the sheet's own pick if only one of the
 * three shipped.
 *
 * WHICH LINK CARRIES THE ROTATION IS THE WHOLE DESIGN, and
 * `scripts/escape-4d.harness.ts` says so outright — "IF ONE ROW OF THIS SHEET
 * DECIDES A PRESET, IT IS THAT ONE". Rotating the chain's HEAD (the Mandelbox
 * at weight 2) reaches every later step through the whole orbit: it costs a
 * third of the rays, 49.2% → 32.6%, and FLATTENS the set along the rotated
 * axis while the other two hold, per-axis extents running 3.99/4.00/3.99 →
 * 3.16/4.00/3.99 → 1.29/4.00/3.99 as the angle opens. Rotating the POWER link
 * instead leaves all three extents at 3.99/4.00/3.99 on every row of that
 * sweep and holds 43.8-51.6% of rays, because a power link's output meets the
 * bailout test before any fold can compound it — so the rotation DEFORMS
 * without shrinking. It is the one link position in the family that costs
 * essentially nothing. (The sweep turns `xw`; this preset ships `zw 0.35`,
 * which the shortlist measures at 43.7% of rays against the 3D twin's 47.9%
 * — the same verdict at a second plane.) The
 * 3D gate names the link, which is a useful thing to be able to read back:
 * `analyzeEscapeSystem` refuses this system with `map 2 extends into 4D`,
 * and `analyzeEscapeSystem4` admits it.
 *
 * IT IS ALSO `probeEscapeFill`'s OWN WARNING IN MINIATURE, off one table.
 * This chain occupies 0.346% of the bailout 4-ball while drawing 43.7% of its
 * rays; {@link mandelboxBrick} occupies 14.816% and draws 41.4%. That is 43x
 * less volume for 1.06x the pixels. A set of shells is a set of SURFACES and
 * no volume statistic can see one — `escape-de-4d.ts`'s `probeEscapeFill4`
 * doc carries the stronger case, where a `w = 0.4` slice of this preset's
 * own 3D twin has literally zero members in 524288 samples and still
 * draws 20.9% of its rays as a coherent shaded object. Read the hit column.
 *
 * Rendered: broken plates, arcs and hooks scattered round a core — the
 * family's most dramatic morphology, and about as far from
 * {@link mandelboxBrick}'s solid block as this gate's vocabulary reaches.
 *
 * The `w` block is spread onto {@link hybridLink}'s output at the call site
 * rather than passed through a fifth parameter, so this function reads as
 * {@link hybridChainQuaternion} line for line with one field added — the
 * diff a reader wants to see. Widening the helper would instead make all
 * three flat hybrid chains above declare a `w` extension none of them has,
 * which is {@link hybridLink}'s own A SIBLING RATHER THAN A WIDENING
 * argument, one field over.
 */
export function hybridChainShells(): Transform[] {
  return [
    hybridLink(0, "mandelbox", 2),
    { ...hybridLink(1, "qsquare", 1, 0.5), w: { rotation: { zw: 0.35 } } },
  ];
}

export function mandelboxKifs(): Transform[] {
  const foldWeight = 1.2;
  const foldScale = 0.19;
  const binderScale = 0.66;
  const corner = 0.7;
  const binder = 0.62;
  const transforms: Transform[] = [];
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [1, -1]) {
        transforms.push({
          id: transforms.length,
          position: [x * corner, y * corner, z * corner],
          rotation: [0, 0, 0],
          scale: [foldScale, foldScale, foldScale],
          variations: [{ type: "mandelbox", weight: foldWeight }],
        });
      }
    }
  }
  // The even corners (an even number of minus signs) are one of the cube's
  // two inscribed tetrahedra — the orbit `T_d` preserves.
  for (const corners of [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ] as Vec3[]) {
    transforms.push({
      id: transforms.length,
      position: [corners[0] * binder, corners[1] * binder, corners[2] * binder],
      rotation: [0, 0, 0],
      scale: [binderScale, binderScale, binderScale],
      variations: [{ type: "boxfold", weight: 1 }],
    });
  }
  return transforms;
}

/**
 * Circumradius-1 vertices of the regular 4-simplex (5-cell / pentatope): an
 * alternated-cube tetrahedron sitting in the `w = −1/4` hyperplane plus the
 * apex on the `+w` axis. With `s = √5/4` each vertex is a unit vector and
 * every pair meets at the regular-simplex angle `arccos(−1/4)` (verified in
 * presets.test.ts).
 */
function pentatopeVertices(): Vec4[] {
  const s = Math.sqrt(5) / 4;
  return [
    [s, s, s, -1 / 4],
    [s, -s, -s, -1 / 4],
    [-s, s, -s, -1 / 4],
    [-s, -s, s, -1 / 4],
    [0, 0, 0, 1],
  ];
}

/**
 * {@link flake}, one dimension up: each map contracts all of 4-space toward a
 * fixed point `v` by `ratio`, the fourth coordinate riding the `w` extension.
 * `position = v·(1 − ratio)` puts the fixed point of `x ↦ ratio·x + position`
 * exactly at `v` — INCLUDING its `w` component, because `w.scale` is
 * deliberately ABSENT on every map: `toTransform4` derives `scale_w` as the
 * mean spatial contraction of `[ratio, ratio, ratio]`, which is exactly
 * `ratio`, so the whole flake family contracts all of 4-space uniformly with
 * nothing pinned and nothing to go stale (the absent-means-derived convention
 * {@link pentatope} showcases).
 */
function flake4(vertices: Vec4[], ratio: number): Transform[] {
  const k = 1 - ratio;
  return vertices.map((v, id): Transform => ({
    id,
    position: [v[0] * k, v[1] * k, v[2] * k],
    rotation: [0, 0, 0],
    scale: [ratio, ratio, ratio],
    w: { position: v[3] * k },
  }));
}

/** 4D Euclidean distance between two vertices. */
function dist4(a: Vec4, b: Vec4): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

/**
 * A polytope's edges as vertex pairs: every pair whose distance ties (within
 * floating-point tolerance) the MINIMAL pairwise distance. For every polytope
 * used here that minimum IS the edge length — and for the regular 4-simplex,
 * where all pairs are edges, all C(5,2) distances tie at the minimum, so the
 * same rule yields the complete graph. The next-nearest distance class in
 * each of these polytopes sits ≥ 25% above the edge length, so a relative
 * `1e-9` tolerance can never leak a diagonal in.
 */
function wireframeEdges(vertices: Vec4[]): [Vec4, Vec4][] {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      min = Math.min(min, dist4(vertices[i], vertices[j]));
    }
  }
  const edges: [Vec4, Vec4][] = [];
  const limit = min * (1 + 1e-9);
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      if (dist4(vertices[i], vertices[j]) <= limit) {
        edges.push([vertices[i], vertices[j]]);
      }
    }
  }
  return edges;
}

/**
 * The pentatope (5-cell) gasket — the true 4D successor of the Sierpinski
 * tetrahedron, and the first NON-FLAT preset: five maps, each contracting all
 * of 4-space by ½ toward one vertex of a regular 4-simplex (circumradius 1,
 * centered at the origin), expressed as ordinary {@link Transform}s whose `w`
 * extension carries the fourth coordinate. Its attractor has Hausdorff
 * dimension `log 5 / log 2 ≈ 2.32` (five ½-scale copies), just as the
 * Sierpinski tetrahedron's is `log 4 / log 2 = 2`.
 *
 * Each map fixes its vertex `v`: with scale ½, the fixed point of
 * `x ↦ ½·x + position` is `2·position`, so `position = v/2` — see
 * {@link flake4}. The four base maps land at `w.position = −1/8`, the apex
 * map at `+1/2`, and `w.scale` stays absent (derived as exactly ½).
 */
export function pentatope(): Transform[] {
  return flake4(pentatopeVertices(), HALF);
}

/**
 * The 5-cell's wireframe scaffold: all C(5,2) = 10 edges of the regular
 * 4-simplex whose vertices anchor {@link pentatope}'s lifted maps (see
 * `affine4.ts`'s `toTransform4`: each map's fixed point is `2 · position`,
 * including the lifted `w`, which is exactly a {@link pentatopeVertices}
 * entry). Rendered as a projected, tumbling wireframe it is the legibility
 * cue for the 4D view — a rigid 4D rotation bends the PROJECTED edge lengths
 * and angles through changes no rigid 3D motion could produce, which is
 * exactly what makes classic rotating-tesseract renders read as 4D. See
 * {@link PRESET_SCAFFOLDS}.
 */
export function pentatopeWireframe(): [Vec4, Vec4][] {
  return wireframeEdges(pentatopeVertices());
}

/**
 * A double-rotation spiral — a structure with NO 3D counterpart, expressed as
 * ordinary {@link Transform}s. The dominant "swirl" map contracts while
 * rotating simultaneously in two ORTHOGONAL planes at incommensurate angles:
 * its `xy` spin is the plain Euler-z rotation (`embedTransform3` relabels
 * `rz` → the `xy` plane angle verbatim), and its `zw` spin rides the `w`
 * extension (`w.rotation.zw`). A true 4D double rotation has no fixed axis
 * (unlike every 3D rotation), so the orbit winds through all four dimensions
 * at once instead of spiralling about a line. The small, heavily
 * out-weighted seed map keeps injecting points off-center in both planes
 * (`x = 0.85` for `xy`, `w.position = 0.75` for `zw`) for the swirl to draw
 * into filaments.
 *
 * The constants are tuned so the attractor is genuinely 4D (all four
 * coordinate extents open up) yet bounded, and carries visible `w` structure
 * — see the acceptance test in presets.test.ts. Both maps stay contractive,
 * including the derived `w` scales (0.93 / 0.22, the mean of each map's
 * uniform spatial scale — `w.scale` stays absent here too).
 */
export function doubleRotation(): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0.55],
      scale: [0.93, 0.93, 0.93],
      weight: 6,
      w: { rotation: { zw: 0.34 } },
    },
    {
      id: 1,
      position: [0.85, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.22, 0.22, 0.22],
      weight: 1,
      w: { position: 0.75 },
    },
  ];
}

/**
 * "Wood Grain" — the patterned-Surface feature's post-acceptance showcase.
 * Three spatial affine maps are each duplicated at `w = ±0.15`, so the
 * attractor is a triangular gasket carried through a short fourth-dimensional
 * interval. The six depth-0 partitions alternate the Wood axis y/z/x, making
 * the object-attached grain change direction with the structure instead of
 * reading as one screen-space overlay.
 *
 * WHY THIS EXACT SYSTEM. The fr-cmtl.8 real-Intel release gate's ordinary 1x,
 * slice-0 affine4 Wood card passed every effect gate, retained its variance
 * through 64x, and was the only Wood card the blinded owner named Wood. The
 * evidence remains deliberately modest (confidence 2/5 and only 2/9 exact
 * names overall), so this is a study of the accepted material, not a claim
 * that every view is unmistakable. The exact accepted settled capture is
 * `affine4/compute/wood/1x/slice-0` in the
 * `pattern-release-machine-e3397fd-20260823a` manifest.
 *
 * The large xyz translations are not decorative: they are the accepted
 * fixture's 67.2x homothety, which kept the complete 1x/4x/16x/64x camera
 * ladder above the production camera's radius floor. Do not normalize them
 * while retaining the fixture claim. Likewise, no finish is authored: the
 * accepted frame paired Wood with the classic lighting response. Only stable
 * material values ride the transforms; the menu label never enters a scene.
 * Surface-hinted because no other renderer reads `surfacePattern`.
 */
export function woodGrain(): Transform[] {
  const spatialPositions: Vec3[] = [
    [33.6, 0, 0],
    [-16.8, 28.896, 0],
    [-16.8, -28.896, 0],
  ];
  const axes = ["y", "z", "x", "y", "z", "x"] as const;
  return spatialPositions.flatMap((position, spatialIndex) =>
    [-0.15, 0.15].map((wPosition, wIndex): Transform => {
      const id = spatialIndex * 2 + wIndex;
      return {
        id,
        position: [...position] as Vec3,
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        w: { position: wPosition, scale: 0.5 },
        surfacePattern: {
          kind: "wood",
          axis: axes[id],
          scale: 3,
          strength: 1,
        },
      };
    }),
  );
}

/** Half-side of the tesseract: vertices `(±h)⁴`, circumradius `2h = 1.3`. */
const TESSERACT_HALF_SIDE = 0.65;

/** The 16 vertices of the tesseract (4-cube): every sign choice of `(±h)⁴`. */
function tesseractVertices(): Vec4[] {
  const h = TESSERACT_HALF_SIDE;
  const out: Vec4[] = [];
  for (const x of [-h, h]) {
    for (const y of [-h, h]) {
      for (const z of [-h, h]) {
        for (const w of [-h, h]) {
          out.push([x, y, z, w]);
        }
      }
    }
  }
  return out;
}

/**
 * Tesseract dust — sixteen maps at ratio ⅓ toward the corners of a 4-cube,
 * i.e. the four-fold Cartesian product of middle-third Cantor sets
 * `C × C × C × C` (at ratio ⅓ the sub-copies along each axis reproduce the
 * middle-third gaps exactly). Hausdorff dimension `log 16 / log 3 ≈ 2.52`.
 *
 * The projection trick that makes it a 4D showpiece: seen head-on, vertices
 * differing only in `w` project onto the SAME 3D corner, so eight corners
 * each hold two interleaved dust clusters at opposite `w` (opposite ends of
 * the diverging w palettes) — then any w-plane tumble slides them apart into
 * the sixteen-corner shadow every rotating-tesseract render is famous for.
 */
export function tesseract(): Transform[] {
  return flake4(tesseractVertices(), 1 / 3);
}

/** The tesseract's 32 edges (pairs differing in exactly one coordinate) —
 * THE canonical 4D wireframe. See {@link PRESET_SCAFFOLDS}. */
export function tesseractWireframe(): [Vec4, Vec4][] {
  return wireframeEdges(tesseractVertices());
}

/** Circumradius of the 16-cell, matching {@link octahedronFlake}'s 1.3. */
const SIXTEEN_CELL_R = 1.3;

/** The 8 vertices of the 16-cell (4D cross-polytope): `±r` on each axis. */
function sixteenCellVertices(): Vec4[] {
  const r = SIXTEEN_CELL_R;
  return [
    [r, 0, 0, 0],
    [-r, 0, 0, 0],
    [0, r, 0, 0],
    [0, -r, 0, 0],
    [0, 0, r, 0],
    [0, 0, -r, 0],
    [0, 0, 0, r],
    [0, 0, 0, -r],
  ];
}

/**
 * The 16-cell (hyperoctahedron) flake — {@link octahedronFlake}'s direct 4D
 * sibling: eight maps toward `±r` on each of the four axes, at the same
 * separates-the-lobes ratio 0.4 the octahedron uses (below the just-touching
 * ½). Six lobes form the familiar octahedron; the other two live entirely on
 * the `±w` axis, so head-on they project onto the CENTER — a superimposed
 * pair at opposite ends of the w palettes — until an xw/yw/zw tumble swings
 * them out of what looks like nowhere. The clearest "there is an eighth lobe
 * hiding in the fourth direction" demonstration in the menu.
 */
export function sixteenCellFlake(): Transform[] {
  return flake4(sixteenCellVertices(), 0.4);
}

/** The 16-cell's 24 edges (every vertex pair except the four antipodal
 * ones). See {@link PRESET_SCAFFOLDS}. */
export function sixteenCellWireframe(): [Vec4, Vec4][] {
  return wireframeEdges(sixteenCellVertices());
}

/** Circumradius of the 24-cell, matching {@link icosahedronFlake}'s reach. */
const TWENTY_FOUR_CELL_R = 1.4;

/** The 24 vertices of the 24-cell: all permutations of `(±1, ±1, 0, 0)`,
 * scaled from raw norm √2 to {@link TWENTY_FOUR_CELL_R}. */
function twentyFourCellVertices(): Vec4[] {
  const s = TWENTY_FOUR_CELL_R / Math.SQRT2;
  const out: Vec4[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const v: Vec4 = [0, 0, 0, 0];
          v[i] = si * s;
          v[j] = sj * s;
          out.push(v);
        }
      }
    }
  }
  return out;
}

/**
 * The 24-cell flake — twenty-four maps toward the vertices of 4D's celebrity
 * polytope: the one regular polytope with NO analogue in any other dimension
 * (not a simplex, hypercube, or cross-polytope family member), self-dual,
 * its vertices the D₄ root system. Ratio 0.3 follows
 * {@link dodecahedronFlake}'s choice for a 20-map flake; dimension
 * `log 24 / log(1/0.3) ≈ 2.64`. Its edge length EQUALS its circumradius — a
 * property no other regular 4-polytope shares — which is why the 96-edge
 * scaffold reads as an unusually even, crystalline cage from every tumble
 * angle.
 */
export function twentyFourCellFlake(): Transform[] {
  return flake4(twentyFourCellVertices(), 0.3);
}

/** The 24-cell's 96 edges (each vertex has eight nearest neighbours). See
 * {@link PRESET_SCAFFOLDS}. */
export function twentyFourCellWireframe(): [Vec4, Vec4][] {
  return wireframeEdges(twentyFourCellVertices());
}

/** 4D circumradius of the duoprism; each triangle's own circle is `R/√2`. */
const DUOPRISM_R = 1.3;

/** The 9 vertices of the 3×3 duoprism: the Cartesian product of a triangle
 * in the xy-plane with a triangle in the zw-plane. */
function duoprismVertices(): Vec4[] {
  const r = DUOPRISM_R / Math.SQRT2;
  const out: Vec4[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 2 * Math.PI;
    for (let j = 0; j < 3; j++) {
      const b = (j / 3) * 2 * Math.PI;
      out.push([
        r * Math.cos(a),
        r * Math.sin(a),
        r * Math.cos(b),
        r * Math.sin(b),
      ]);
    }
  }
  return out;
}

/**
 * The 3×3 duoprism gasket — nine maps toward the product of two triangles
 * living in completely orthogonal planes, a shape 3-space cannot host (its
 * polygon × polygon products stop at prisms, polygon × segment). Every
 * vertex satisfies `|xy| = |zw| = R/√2`, i.e. all nine sit ON a Clifford
 * torus — so this is also the menu's picture of that famously
 * unpicturable surface. The symmetry is the double rotation split in two: a
 * plain 3D yaw (xy) spins one triangle while the zw tumble spins the other,
 * independently. Ratio ⅓ gives dimension `log 9 / log 3 = 2`.
 */
export function duoprism(): Transform[] {
  return flake4(duoprismVertices(), 1 / 3);
}

/** The duoprism's 18 edges: each triangle's 3 edges, once per vertex of the
 * other triangle. See {@link PRESET_SCAFFOLDS}. */
export function duoprismWireframe(): [Vec4, Vec4][] {
  return wireframeEdges(duoprismVertices());
}

/**
 * Hyperfern — Barnsley's fern curling through the FOURTH dimension. The four
 * maps are the flat fern's verbatim (planar in z, Barnsley's exact linear
 * parts); the one change is the frond map, whose per-application tilt is a
 * `yw` plane rotation riding the `w` extension instead of {@link curlingFern}'s
 * 3D `yz` tilt — rotating the rachis direction `+y` toward `+w`, an angle per
 * recursion ({@link HYPERFERN_CURL}). Because the frond alone climbs the
 * rachis the tilt compounds: the base of the leaf lies in ordinary 3-space
 * and each step up the stem rotates a little more of it into `w`, so the
 * projection shows the tip foreshortening away into the invisible direction,
 * a yw/zw tumble unrolls the fiddlehead back into view, and the diverging w
 * palettes paint the curl base → tip. See {@link buildFern} for why the
 * frond's `w.scale` is pinned to its planar scale.
 */
export function hyperfern(): Transform[] {
  return buildFern(0, HYPERFERN_CURL);
}

/**
 * Conjugate every map of a system by the translation `A(p) = p + offset`,
 * moving its attractor RIGIDLY by `offset`: conjugation leaves each map's
 * linear part `M` untouched and rewrites only its translation to
 * `position + (I − M)·offset` (the same identity {@link buildFern}'s
 * re-centring uses, computed here numerically from the COMPOSED affine so it
 * holds for any rotation/scale/shear a map carries). This is how the xaos
 * presets seat two whole systems side by side in one space — each keeps its
 * own internal geometry exactly.
 */
function conjugateApart(transforms: Transform[], offset: Vec3): Transform[] {
  const [ox, oy, oz] = offset;
  return transforms.map((t) => {
    const m = composeAffine(t).m;
    const position: Vec3 = [
      t.position[0] + ox - (m[0] * ox + m[1] * oy + m[2] * oz),
      t.position[1] + oy - (m[3] * ox + m[4] * oy + m[5] * oz),
      t.position[2] + oz - (m[6] * ox + m[7] * oy + m[8] * oz),
    ];
    return { ...t, position };
  });
}

/** How far each of the fern|sponge pair's two systems sits from the origin
 * along ±x — chosen so the fern's ~0.75 x half-extent and the sponge's 0.75
 * cube clear each other with a visible gap. */
const FERN_SPONGE_OFFSET = 1.2;

/**
 * Every sponge map's selection weight in the fern|sponge pair: the fern's
 * four maps sum to weight 100 (1 + 85 + 7 + 7, Barnsley's proportions), so
 * 20 sponge maps at 5 sum to 100 too — the ENTRY pick (which draws from the
 * global weighted table; see `chaos-game.ts`'s `CHAOS_SUB_ORBIT_POINTS`)
 * then lands each sub-orbit in either block with equal probability, and the
 * two objects render at comparable density instead of the sponge getting a
 * sixth of the points. Within the sponge block the uniform 5s stay uniform,
 * so the sponge itself is unchanged.
 */
const FERN_SPONGE_SPONGE_WEIGHT = 5;

/**
 * The xaos reachability pair's shared construction: Barnsley's fern
 * ({@link barnsleyFern}, 4 maps) and the Menger sponge
 * ({@link mengerSponge}, 20 maps) conjugated apart along x
 * ({@link conjugateApart}) into ONE 24-map system, with BLOCK-STRUCTURED
 * chaos rows: every fern map's row carries 1 toward fern columns and
 * `offBlock` toward sponge columns, and vice versa. At `offBlock` 0 the two
 * systems are fully isolated — merging their transform lists WITHOUT rows
 * would bud shrunken sponges along fern fronds and ferns inside every
 * sub-cube (every map applies to everything); the rows are what keep them
 * two neat objects in one space. Small non-zero `offBlock` leaks them into
 * each other in a controlled way.
 */
function fernSpongeSystem(offBlock: number): Transform[] {
  const fern = conjugateApart(barnsleyFern(), [-FERN_SPONGE_OFFSET, 0, 0]);
  const sponge = conjugateApart(mengerSponge(), [FERN_SPONGE_OFFSET, 0, 0]);
  const fernCount = fern.length;
  const all = [...fern, ...sponge];
  const total = all.length;
  return all.map((t, i): Transform => {
    const inFern = i < fernCount;
    const chaos = new Array<number>(total);
    for (let j = 0; j < total; j++) {
      chaos[j] = inFern === j < fernCount ? 1 : offBlock;
    }
    return {
      ...t,
      id: i,
      weight: inFern ? t.weight : FERN_SPONGE_SPONGE_WEIGHT,
      chaos,
    };
  });
}

/**
 * "Fern | Sponge (isolated)" — the xaos (graph-directed selection) proof:
 * two whole systems sharing one space as SEPARATE objects, which no plain
 * transform-list merge can express (see {@link fernSpongeSystem}). The
 * block-diagonal rows mean an orbit entering either block never leaves it;
 * the engine's sub-orbit re-fusing is what samples both
 * (`chaos-game.ts`'s `CHAOS_SUB_ORBIT_POINTS`).
 */
export function fernSpongeIsolated(): Transform[] {
  return fernSpongeSystem(0);
}

/**
 * "Fern | Sponge (1% leak)" — {@link fernSpongeIsolated} with 0.01 in every
 * off-block entry: about one transition in ~100 weighted picks crosses
 * systems, so sponges bud tiny ferns and fern fronds sprout sponge dust —
 * the controlled cross-infection that makes xaos a CONTINUOUS dial from
 * "side by side" to the everything-hybrid a plain merge gives.
 */
export function fernSpongeLeak(): Transform[] {
  return fernSpongeSystem(0.01);
}

/**
 * The named systems offered in the preset menu, mapped to their transform
 * factories. `default` is the system the viewer boots with (see
 * {@link defaultTransforms}); listing it here keeps the startup fractal
 * selectable from the menu instead of being an orphan you can never return to.
 *
 * This record is the single source of truth for both the {@link Preset} type
 * and the menu↔factory mapping ({@link presetTransforms}), so adding a preset
 * is one edit and the option list in `index.html` is checked against these keys
 * by `ui.test.ts`.
 */
const PRESETS = {
  default: defaultTransforms,
  sierpinski: sierpinskiTetrahedron,
  menger: mengerSponge,
  spiral,
  pyramid: sierpinskiPyramid,
  octahedron: octahedronFlake,
  icosahedron: icosahedronFlake,
  dodecahedron: dodecahedronFlake,
  jerusalem: jerusalemCube,
  chiral: chiralLace,
  barnsley: barnsleyFern,
  curling: curlingFern,
  // The xaos (graph-directed selection) pair — chaos rows' reachability
  // proof: two systems in one space, isolated and 1%-leaked. Points/flame/
  // solid render them; the surface and escape gates refuse chi documents.
  fernSponge: fernSpongeIsolated,
  fernSpongeLeak,
  // The scheduled-hybrid post-word's reachability proof, third member of
  // the fern-and-sponge family: system A alone here — the schedule block
  // (B = the sponge, depth 2) rides PRESET_SCHEDULES, exactly as a lens
  // rides PRESET_FINALS.
  spongeOfFerns: barnsleyFern,
  radiolarian,
  swirl: swirlFlame,
  dyedSpiral,
  julia: juliaSet,
  juliaDust,
  // The julia family's SHOWCASES, beside the two austere
  // proofs above — see `scripts/julia-flame.harness.ts` for the sheet
  // these three were picked off, and {@link juliaSet}'s doc for why the
  // proofs could not simply be prettied up instead.
  juliaIsland,
  juliaSnowflake,
  juliaPinwheel,
  mandelbox: mandelboxLattice,
  mandelboxKifs,
  // The surface FINISH showcase — four maps in four materials, one of
  // them deliberately unauthored (see fourFinishes).
  fourFinishes,
  metalStudio,
  // The escape-time set's own presets: the mode had none, so the
  // only route in was authoring a lone fold map by hand.
  mandelboxClassic,
  mandelboxRings,
  mandelboxCube,
  // The escape-time CHAINS: the transform list became a
  // hybrid formula chain and both shader mirrors learned to cycle it, but
  // every preset above is still ONE map — so the composition had no way in.
  foldChain,
  foldChainBoulder,
  foldChainFlower,
  // The escape-time family's THIRD object: the Mandelbulb had
  // an estimator, two shader mirrors and no way in at all.
  mandelbulbClassic,
  mandelbulbOffset,
  mandelbulbRotated,
  // The first CROSS-FAMILY chains: a link need not be a fold — the
  // chain also admits the two power maps, so a Mandelbox and a Mandelbulb (or
  // a quaternion square) can ride one formula chain instead of shipping as
  // three separate, uncombinable modes.
  hybridChainCube,
  hybridChainCraters,
  hybridChainQuaternion,
  // The first non-flat presets: systems whose w extension is in play.
  pentatope,
  doubleRotation,
  // The accepted patterned-material showcase. Its deliberately simple
  // affine4 partitions and exact Wood values are documented at woodGrain.
  woodGrain,
  // The second wave of 4D systems: the remaining regular polytopes
  // small enough to converge as flakes (the 120-/600-cell's hundreds of maps
  // are not), a duoprism, and the fern bent through w.
  sixteenCell: sixteenCellFlake,
  duoprism,
  tesseract,
  twentyFourCell: twentyFourCellFlake,
  hyperfern,
  // The escape-time family's 4D HALF: every preset above it is
  // flat by gate, so the mode the site is named after had no 4D entry at
  // all. Each of these three is refused by `analyzeEscapeSystem` ("map N
  // extends into 4D") and admitted by `analyzeEscapeSystem4` — objects no 3D
  // document can express, picked off `scripts/escape-4d.harness.ts`.
  mandelboxBrick,
  mandelboxColumn,
  hybridChainShells,
} as const satisfies Record<string, () => Transform[]>;

export type Preset = keyof typeof PRESETS;

/**
 * Legibility scaffolds a preset can carry — projected, tumbling wireframes
 * the 4D view renders alongside the cloud (see `scene.ts`'s
 * `setFourDScaffold`). Every {@link flake4} preset qualifies, because a flake
 * map's fixed point IS its polytope vertex (see {@link flake4}), so the
 * wireframe traces exactly the cloud's own anchor points; presets with no
 * natural wireframe — flat ones, `doubleRotation`, `hyperfern` — are simply
 * absent. Keyed by {@link Preset} (not a parallel enum) so `main.ts` can look
 * one up by the same name `presetTransforms` just used, with no second
 * mapping to keep in sync.
 */
export const PRESET_SCAFFOLDS: Partial<Record<Preset, () => [Vec4, Vec4][]>> = {
  pentatope: pentatopeWireframe,
  sixteenCell: sixteenCellWireframe,
  duoprism: duoprismWireframe,
  tesseract: tesseractWireframe,
  twentyFourCell: twentyFourCellWireframe,
};

/**
 * The render mode a preset was authored to showcase, for presets
 * whose payoff lives in a specific renderer rather than the live point
 * cloud: {@link radiolarian} and {@link swirlFlame} are fractal-FLAME
 * compositions (see their docs — nonlinear variation blends that read as a
 * dull smudge of points but bloom in the flame's log-density exposure), so
 * loading one switches the app into that renderer instead of silently
 * under-delivering as a point cloud. Absent = the point-cloud explorer, the
 * ordinary case. Keyed by {@link Preset} exactly like
 * {@link PRESET_SCAFFOLDS}, and using plain string literals (not the app's
 * `RenderMode` type) so this module stays dependency-free; `main.ts`'s
 * preset handler consumes it when the freshly loaded system's cloud lands.
 */
export const PRESET_RENDER_HINTS: Partial<
  Record<Preset, "flame" | "solid" | "surface">
> = {
  radiolarian: "flame",
  swirl: "flame",
  dyedSpiral: "flame",
  // Flat 2D sheets in the XY plane: the flame's log-density
  // exposure is what turns an IIM Julia set's tip-heavy point density into
  // a legible curve instead of a faint, mostly-empty sparkle.
  julia: "flame",
  juliaDust: "flame",
  // The julia SHOWCASES, for the same reason one line up —
  // they are flat sheets too, and two of them are the same sheet through
  // a plot-time lens ({@link PRESET_FINALS}).
  juliaIsland: "flame",
  juliaSnowflake: "flame",
  juliaPinwheel: "flame",
  mandelbox: "flame",
  // The pure-fold twin exists to showcase the fold-branch surface descent
  // — as a point cloud it under-delivers the same way the flame presets do.
  mandelboxKifs: "surface",
  // Finishes are read by the surface tracers and by nothing else, so the
  // finish showcase opens where its subject exists.
  fourFinishes: "surface",
  metalStudio: "surface",
  // Patterned albedo is likewise a Surface-only concern. This one is 4D,
  // which routes it to the affine4 tracer before the hint is consumed.
  woodGrain: "surface",
  // The escape-time trio needs the hint more than any preset
  // here: the chaos-game cloud of a non-contracting map is escape-reset
  // debris, so as a point cloud these look BROKEN rather than merely
  // under-delivered. Surface mode is the only place they are anything at
  // all — and the mode reached this way is the escape-time marcher, not the
  // IFS descent mandelboxKifs above lands in.
  mandelboxClassic: "surface",
  mandelboxRings: "surface",
  mandelboxCube: "surface",
  // The chains need the hint for the identical reason —
  // every link is non-contracting, so the chaos-game cloud is escape-reset
  // debris — and the mode reached this way is the same escape-time marcher,
  // now cycling the whole list instead of iterating one map.
  foldChain: "surface",
  foldChainBoulder: "surface",
  foldChainFlower: "surface",
  // The Mandelbulb trio needs the hint for exactly the same
  // reason — a single non-contracting map's chaos-game cloud is
  // escape-reset debris — and the mode reached this way is the
  // escape-time family's THIRD marcher, the forward triplex-power orbit.
  mandelbulbClassic: "surface",
  mandelbulbOffset: "surface",
  mandelbulbRotated: "surface",
  // The cross-family chains need the hint for the same reason as
  // every escape-time preset above: every link is non-contracting, so the
  // chaos-game cloud is escape-reset debris, and the mode reached this way
  // cycles the same formula chain the fold-only presets do.
  hybridChainCube: "surface",
  hybridChainCraters: "surface",
  hybridChainQuaternion: "surface",
  // The 4D escape-time trio needs the hint for the reason every
  // escape-time preset above it does — a non-contracting map's chaos-game
  // cloud is escape-reset debris, so as a point cloud these look BROKEN
  // rather than merely under-delivered — and the mode reached this way is
  // the same forward orbit, now over 4D points (`escape-de-4d.ts`).
  mandelboxBrick: "surface",
  mandelboxColumn: "surface",
  hybridChainShells: "surface",
};

/**
 * The FINAL-TRANSFORM lens a preset was authored around, for the
 * compositions whose subject is the lens rather than the attractor:
 * {@link juliaSnowflake} and {@link juliaPinwheel} are one plot-time map
 * over a system that renders as something else entirely without it, so
 * shipping them as transform lists alone would ship the wrong picture.
 *
 * A third table beside {@link PRESET_SCAFFOLDS}/{@link
 * PRESET_RENDER_HINTS} for exactly their reason: `PRESETS` maps a name to
 * `() => Transform[]`, and widening that signature would make every
 * preset declare a lens it does not have. Keyed by {@link Preset} so
 * `main.ts` looks one up by the name `presetTransforms` just used.
 *
 * ABSENT MEANS NONE, not "leave whatever was there": main.ts's preset
 * handler CLEARS the final on every load that carries no entry. A preset
 * is a whole-system replacement, and a lens surviving one would silently
 * re-pose the next preset's attractor — and, for the escape-time and
 * Mandelbulb presets, take their render mode away outright (both gates
 * refuse a final transform).
 */
export const PRESET_FINALS: Partial<Record<Preset, () => Transform>> = {
  juliaSnowflake: juliaSnowflakeLens,
  juliaPinwheel: juliaPinwheelLens,
  fourFinishes: fourFinishesLens,
};

/**
 * The flame palette a preset was composed against — the fourth side
 * table, and the one that needed the most justification,
 * since a palette is the user's taste everywhere else in the app.
 *
 * It earns a table because for these compositions the palette is not
 * decoration but part of the authored picture: `scripts/julia-flame.
 * harness.ts` chose `dusk`/`sunset` per composition and reports colour
 * as half a flame's impact, and the sheet the three were picked off is
 * the sheet with those palettes on. Shipping the maps without them
 * delivers a different picture than the one that was reviewed.
 *
 * Scoped deliberately narrow: built-in {@link FlamePaletteId}s only (no
 * custom gradients — every value here is one the palette `<select>`
 * offers), applied to the FLAME palette alone, and only for presets that
 * also carry a `"flame"` {@link PRESET_RENDER_HINTS} entry, so it can
 * never repaint a mode the preset was not authored for. Absent = the
 * user's current palette, untouched — the ordinary case, and every
 * pre-existing preset.
 */
export const PRESET_PALETTES: Partial<Record<Preset, FlamePaletteId>> = {
  juliaIsland: "dusk",
  juliaSnowflake: "sunset",
  juliaPinwheel: "sunset",
};

/**
 * The KALEIDOSCOPE a preset was composed under — the fifth side
 * table, and the one {@link foldChainFlower} could not exist without: its
 * subject IS the symmetry. `escape-de.ts` folds the query into one sector
 * before the orbit runs, so the five-fold flower is not a decorated
 * {@link foldChain}, it is a different object, and shipping its transform
 * list alone ships the wrong picture — exactly {@link PRESET_FINALS}'s
 * argument one setting over.
 *
 * A fifth table beside the four above for their shared reason: `PRESETS` maps
 * a name to `() => Transform[]`, and widening that signature would make every
 * preset declare a symmetry it does not have. Keyed by {@link Preset} so
 * `main.ts` looks one up by the name `presetTransforms` just used, and held
 * as a plain value like {@link PRESET_PALETTES} rather than a factory —
 * main.ts reads the fields into `state.ts`'s clamping setters and never
 * stores the object, so there is nothing here to mutate.
 *
 * ABSENT MEANS OFF, not "leave whatever was there" — {@link PRESET_FINALS}'s
 * rule, and load-bearing in BOTH directions. A preset is a whole-system
 * replacement, so a kaleidoscope surviving one would silently replicate the
 * arriving system into copies it was never composed with; and for the
 * escape-time and Mandelbulb presets it would take their render mode away
 * outright, because `analyzeBulbSystem` refuses ANY order above 1 and
 * `analyzeEscapeSystem` refuses one that rotates into 4D. The `twist` a
 * leftover order could carry does exactly that, which is why main.ts clears
 * the twist here too and no entry below may set one: this table is 3D
 * kaleidoscopes only, the shape every gate that reads it admits.
 *
 * AND IT STAYS 3D-ONLY EVEN THOUGH ONE GATE WOULD NOW TAKE A `w`-PLANE.
 * `analyzeEscapeSystem4` admits a kaleidoscope turning in any of
 * the six coordinate planes — `foldQueryIntoSector4` is still 1-Lipschitz and
 * an isometry per sector there — so the 4D escape-time trio ({@link
 * mandelboxBrick}, {@link mandelboxColumn}, {@link hybridChainShells}) COULD
 * have carried one, and deliberately does not. Measured
 * (`scripts/escape-4d.harness.ts`'s shortlist): a `w`-plane wedge is a
 * genuinely different object (IoU 0.673 against order 1) but NOT a visible
 * rosette, because the wedge's symmetry plane CONTAINS `w` and so does not
 * lie in the rendered slice — it reads as the unsymmetrised object with its
 * lobes rearranged. Worse, at EVEN order it is a measurable NO-OP on that
 * slice: 1 point of 262144 changes side at orders 2, 4, 6 and 8, against 3821
 * and 3662 at orders 3 and 5, because the fold's arithmetic is odd axis by
 * axis and the set already carries the symmetry the wedge would impose. (The
 * 1 point is not a rounding coincidence worth chasing: `Math.sin(Math.PI)` is
 * 1.22e-16, so the wedge leaks that much `w` into a query that was exactly on
 * the slice.) A preset authored at order 4 would therefore silently be its 3D
 * twin — {@link foldChainFlower}'s FIVE, SPECIFICALLY paragraph one dimension
 * up, and the reason no entry here turns in a `w` plane.
 */
export const PRESET_SYMMETRIES: Partial<Record<Preset, SymmetryParams>> = {
  foldChainFlower: { order: 5, plane: "xz" },
};

/**
 * How far apart {@link spongeOfFernsSchedule} spreads the sponge's cells,
 * as a uniform conjugation of {@link mengerSponge}'s maps (`s'(x) =
 * c·s(x/c)`: positions scale by `c`, the 1/3 contractions are untouched, so
 * the arrangement is the SAME sponge at twice the size). The classic sponge
 * fills [-0.75, 0.75]³ — cell edge `1.5/3^k` at depth k — while the
 * re-centred fern stands ~3.0 tall, i.e. `3.0/3^k` after a depth-k word:
 * TWICE a cell, so neighbouring ferns overlapped into fuzz at every depth.
 * At 2 the cell pitch equals the contracted fern's height at every depth
 * alike, and the arrangement reads as distinct whole plants — judged in
 * the browser at depths 1..3 (the K1/K2 grove picture).
 */
const SPONGE_OF_FERNS_SPREAD = 2;

/**
 * "Sponge of Ferns"' schedule block: the Menger sponge as system B — the
 * union of `s_w(Fern)` over all depth-length sponge words, "a Menger sponge
 * MADE OF ferns". A plain-transform-list merge cannot produce this (every
 * map would apply to everything — sponges budding along fronds), and a chi
 * matrix CAN only at the cost of depth-many layered sponge copies; the
 * post-word stage is THE construction for a grove of distinct whole
 * individuals (the forest-composition measurement: K1 renders crisp whole
 * ferns at the arrangement's placements, K2 the second generation). The
 * sponge's maps are pure affine, which is exactly the schedule's
 * affine-only document rule.
 *
 * DEPTH 2, NOT 3, judged by eye in the browser at the default 100k-point
 * budget: depth 2's 400 word-cells leave ~250 points per fern — every copy
 * still reads as a plant AND the sponge's level-2 holes read as a sponge —
 * while depth 3's 8,000 cells leave ~12 points each, dissolving the ferns
 * into strand texture (the brief's own "as k grows the ferns shrink into
 * invisibility"). The slider reaches 3 in one tick for anyone who raises
 * the point budget to match.
 */
function spongeOfFernsSchedule(): HybridSchedule {
  const c = SPONGE_OF_FERNS_SPREAD;
  return {
    transforms: mengerSponge().map((t) => ({
      ...t,
      position: [
        t.position[0] * c,
        t.position[1] * c,
        t.position[2] * c,
      ] as Vec3,
    })),
    depth: 2,
  };
}

/**
 * The scheduled-hybrid post-word a preset is a composition OF — the sixth
 * side table, on {@link PRESET_FINALS}' exact both-directions rule: a
 * preset composed around a schedule installs it, and every other preset
 * CLEARS one (ABSENT MEANS CLEAR — a leftover post-word would rearrange
 * the arriving attractor into copies it was never composed with, and would
 * take the Surface modes away outright, since the gate refuses schedule
 * documents until the descent lift ships). A factory like
 * `PRESET_FINALS`' entries — main.ts's handler feeds it through
 * `setSchedule`, which strips and clamps, so the table cannot smuggle
 * non-affine fields into the document even if an entry grew some.
 */
export const PRESET_SCHEDULES: Partial<Record<Preset, () => HybridSchedule>> = {
  spongeOfFerns: spongeOfFernsSchedule,
};

/** Surface-room state carried by the one preset composed around it. Absent
 * leaves the user's room controls alone, matching lighting/palette settings;
 * this entry authors the floor explicitly when Metal Studio is chosen. */
export const PRESET_SURFACE_ROOMS: Partial<
  Record<
    Preset,
    {
      groundPlane: boolean;
      floorPattern: "solid" | "checker";
      floorTileScale: number;
      floorEmission: number;
    }
  >
> = {
  metalStudio: {
    groundPlane: true,
    floorPattern: "checker",
    floorTileScale: 0.64,
    floorEmission: 1.4,
  },
};

/** Build the transform set for a named preset. */
export function presetTransforms(preset: Preset): Transform[] {
  return PRESETS[preset]();
}

/** Every preset key, for menus and exhaustiveness checks. */
export const PRESET_NAMES = Object.keys(PRESETS) as Preset[];

/** Lowest unused id in a transform list (max existing id + 1, or 0 if empty). */
export function nextId(transforms: Transform[]): number {
  return transforms.reduce((max, t) => Math.max(max, t.id), -1) + 1;
}

/**
 * Append a new transform on a widening spiral, mirroring the viewer's "+ Add"
 * button. Returns a new array — the input is not mutated. Vertical jitter uses
 * the injected RNG so tests can make it deterministic.
 */
export function appendTransform(
  transforms: Transform[],
  rng: Rng = Math.random,
): Transform[] {
  const angle = transforms.length * 2.4;
  const added: Transform = {
    id: nextId(transforms),
    position: [
      Math.cos(angle) * 0.6,
      (rng() - 0.5) * 0.6,
      Math.sin(angle) * 0.6,
    ],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };
  return [...transforms, added];
}
