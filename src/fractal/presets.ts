import type { Rng } from "./rng";
import type { Transform, Vec3 } from "./types";

const HALF = 0.5;

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
 * One Barnsley-fern map, written in the fern's own tall coordinates (a frond
 * rooted at the origin growing up +y), with its relative selection weight.
 */
interface FernMap {
  /** z-rotation of the linear part, radians. */
  angle: number;
  /** Native [x, y] scale; a negative axis reflects (the mirrored leaflet). */
  scale: [number, number];
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
 * Barnsley's four maps with his classic probabilities. The frond map is a pure
 * similarity (its 0.85 scale and 2.7° lean accumulate into the signature curl)
 * selected ~80% of the time; the leaflets are near-similarities at ~8% each
 * (the right one carrying Barnsley's mirror reflection — a negative y-scale),
 * and the thin stem makes up the remainder. The weights are relative, so they
 * are proportional to Barnsley's [20, 2, 2, 1] selection ratio.
 */
const FERN_MAPS: FernMap[] = [
  { angle: -0.047, scale: [0.851, 0.851], translate: [0, 1.6], weight: 1 },
  { angle: 0.855, scale: [0.305, 0.34], translate: [0, 1.6], weight: 0.1 },
  { angle: 2.094, scale: [0.3, -0.363], translate: [0, 0.44], weight: 0.1 },
  { angle: 0, scale: [0.02, 0.16], translate: [0, 0], weight: 0.05 },
];

/**
 * Fern — Barnsley's fern, the canonical "looks nothing like its equations"
 * fractal.
 *
 * It is a *weighted* IFS: the self-similar frond map must run the large
 * majority of the time for the rachis to grow tall and the leaflets to recurse
 * into ever-smaller fronds; pick the four maps evenly and you get a smudge, not
 * a fern. Each map carries a {@link Transform.weight} and the chaos game samples
 * in proportion — frond ~80%, each leaflet ~8%, the stem the rest.
 *
 * The maps live in Barnsley's tall coordinates, then are conjugated by
 * `A(p) = FERN_SCALE·p + FERN_CENTER` so the frond lands centred in the box.
 * Conjugating by a similarity leaves each map's linear part `M` untouched and
 * only rewrites its translation to `FERN_SCALE·t + (I − M)·FERN_CENTER`.
 */
export function fern(): Transform[] {
  const [cx, cy] = FERN_CENTER;
  let id = 0;
  return FERN_MAPS.map(({ angle, scale, translate, weight }): Transform => {
    const [sx, sy] = scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Linear part M = R(angle) · diag(sx, sy), then translation under the
    // re-centring conjugation: FERN_SCALE·t + (I − M)·FERN_CENTER.
    const m00 = cos * sx;
    const m01 = -sin * sy;
    const m10 = sin * sx;
    const m11 = cos * sy;
    const px = FERN_SCALE * translate[0] + cx - (m00 * cx + m01 * cy);
    const py = FERN_SCALE * translate[1] + cy - (m10 * cx + m11 * cy);
    return {
      id: id++,
      position: [px, py, 0],
      rotation: [0, 0, angle],
      scale: [sx, sy, FERN_FLATTEN],
      weight,
    };
  });
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
  fern,
} as const satisfies Record<string, () => Transform[]>;

export type Preset = keyof typeof PRESETS;

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
