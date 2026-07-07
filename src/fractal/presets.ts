import type { Rng } from "./rng";
import type { Transform, Variation, Vec3, Vec4 } from "./types";

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
  radiolarian,
  swirl: swirlFlame,
  // The first non-flat presets (fr-bf6): systems whose w extension is in play.
  pentatope,
  doubleRotation,
  // The second wave of 4D systems (fr-zde): the remaining regular polytopes
  // small enough to converge as flakes (the 120-/600-cell's hundreds of maps
  // are not), a duoprism, and the fern bent through w.
  sixteenCell: sixteenCellFlake,
  duoprism,
  tesseract,
  twentyFourCell: twentyFourCellFlake,
  hyperfern,
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
