/**
 * The subject families' canvas guides' pure half — what a subject block
 * draws UNDER the Points cloud when Show-guides is on. The transform boxes
 * draw the IFS's maps as unit-cell wireframes; a subject block replaces the
 * transform system (`main.ts`'s `subjectBlockPresent`), so its guides draw
 * the replacement's OWN defining geometry: for the sphairahedron family the
 * resolved construction's fold faces — each face's inversion sphere or wall
 * plane is one generator of the group whose limit set the cloud samples —
 * plus the divide plane and, for a finite construction, the authored
 * inversion sphere J. This is `sphere-inversion-controls.ts`'s template one
 * subject over in spirit; the drawing half is `scene.ts`'s
 * `updateSubjectGuides` (3D) and the 4D scaffold (`setFourDScaffold`, whose
 * rotor re-pose already runs per tick).
 *
 * DISPLAY-ONLY, deliberately: the boxes' drag/hit-test interactions do not
 * transfer to spheres, and the J sphere's centre/radius are already edited
 * by the J rows' sliders — a draggable ball guide would be a second editor
 * of the same numbers (docs/panel-ia.md: don't build that twice).
 *
 * COLOR COHERENCE: every fold face wears the hue the cloud and the
 * By-Transform legend give that face — `transformColors(foldFaces.length)`
 * indexed by the face's position in `foldFaces`, the same index the walk's
 * last-applied-face slot and the surface shade slots use, so guide, cloud
 * and legend cannot disagree about which face owns which hue. The divide
 * plane wears the 4D scaffold's neutral blue (it is the tile's carrier, not
 * a map); J wears white (the authored parameter, not a face).
 *
 * THE INFINITE FAMILIES ARE THE POINT of the feature, not a special case:
 * tetra333's limit set IS the plane y = 0 — its divide plane — so the drawn
 * sheet is the limit set itself, exactly, where the point sampler keeps
 * nothing (the set is unbounded and measure-zero to a sampler). The sphere
 * planes bound the tile; drawing them as bounded sheets sized by the
 * construction's own framing ball keeps every guide inside one honest
 * scale.
 *
 * THE 4D HALF rides the same spec: tetra4's faces are 3-spheres and
 * hyperplanes in R⁴; `specToScaffoldEdges` samples them into the
 * `[Vec4, Vec4][]` edge pairs `setFourDScaffold` already re-poses on every
 * rotor tick (the CPU twin of the cloud's own vertex transform — same
 * center, same rotation, so guide and cloud cannot drift). A 3-sphere
 * draws as its six coordinate-plane great circles; a hyperplane as its
 * bounded sheet's border loop.
 */
import {
  resolveSphairahedron,
  type SphairahedronAuthored,
} from "../fractal/sphairahedron";
import { transformColors } from "../fractal/color";
import type { Vec4 } from "../fractal/types";

/** Arc segments per wireframe circle — smooth at guide scale, cheap to
 * re-pose per rotor tick (a 4D ball costs 6 × this segments). */
export const SUBJECT_GUIDE_CIRCLE_SEGMENTS = 48;

/** The divide plane's neutral hue — the 4D scaffold's own blue (0x93a4c8):
 * the tile's carrier is construction furniture, not one of the maps. */
export const DIVIDE_COLOR: [number, number, number] = [
  0x93 / 255,
  0xa4 / 255,
  0xc8 / 255,
];

/** The authored inversion sphere's hue — the boxes' selected style's white:
 * J is the document's own free parameter, not one of the faces. */
const INVERSION_COLOR: [number, number, number] = [1, 1, 1];

export interface SubjectGuideSpec {
  dim: 3 | 4;
  /** Wireframe segments as consecutive endpoint pairs, flat: `positions`
   * holds `pairCount * 2 * dim` components, `colors` the per-endpoint RGB
   * (`pairCount * 2 * 3`) — one LineSegments draw for the whole subject. */
  pairCount: number;
  positions: Float32Array;
  colors: Float32Array;
  /** Bounded sheet fills — the walls and the divide as quads (4 corners of
   * `dim` components each), drawn translucent so a plane reads as a surface
   * without claiming the tile's exact polygonal boundary. */
  sheets: { corners: Float32Array; color: [number, number, number] }[];
  /** The construction's own framing ball (`bound`) — what an EMPTY cloud's
   * landing fit frames instead: the infinite families draw no points, so
   * the camera parks on the construction, not on a degenerate zero box. */
  frame: { center: number[]; radius: number };
}

/** Orthonormal tangent basis of the hyperplane {x : n·x = h}, n unit. */
function tangentBasis(n: number[]): [number[], number[]] {
  // Seed with the coordinate axis LEAST aligned with n (largest |component|
  // of n → least parallel), so the Gram-Schmidt never sees a near-parallel
  // seed.
  let pivot = 0;
  for (let i = 1; i < n.length; i++) {
    if (Math.abs(n[i]) > Math.abs(n[pivot])) pivot = i;
  }
  const seed = new Array<number>(n.length).fill(0);
  const j = pivot === 0 ? 1 : 0;
  seed[j] = 1;
  // u = seed − (seed·n)n, then normalized — the in-plane component of the
  // seed axis.
  const dot = seed.reduce((s, x, i) => s + x * n[i], 0);
  const u = seed.map((s, i) => s - dot * n[i]);
  let un = 0;
  for (let i = 0; i < n.length; i++) un += u[i] * u[i];
  for (let i = 0; i < n.length; i++) u[i] /= Math.sqrt(un);
  // v = n × u for 3D; for 4D Gram-Schmidt a second axis against {n, u}.
  if (n.length === 3) {
    const v = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];
    return [u, v];
  }
  let seed2 = 0;
  for (let i = 0; i < n.length; i++) {
    if (i !== pivot && i !== (pivot === 0 ? 1 : 0)) {
      seed2 = i;
      break;
    }
  }
  const e = new Array<number>(n.length).fill(0);
  e[seed2] = 1;
  const dotNV = e.reduce((s, x, i) => s + x * n[i], 0);
  const dotUV = e.reduce((s, x, i) => s + x * u[i], 0);
  const v = e.map((x, i) => x - dotNV * n[i] - dotUV * u[i]);
  let vn = 0;
  for (let i = 0; i < n.length; i++) vn += v[i] * v[i];
  for (let i = 0; i < n.length; i++) v[i] /= Math.sqrt(vn);
  return [u, v];
}

/** The great circles of the sphere {c, r} in the coordinate 2-planes
 * through its centre — three per ball in 3D, six in 4D (the w-carrying
 * planes are what make a 4D ball read as 4D under the rotor projection). */
function ballCircles(dim: 3 | 4): [number[], number[]][] {
  const axes: number[][] = [];
  for (let a = 0; a < dim; a++) {
    for (let b = a + 1; b < dim; b++) {
      const u = new Array<number>(dim).fill(0);
      const v = new Array<number>(dim).fill(0);
      u[a] = 1;
      v[b] = 1;
      axes.push(u, v);
    }
  }
  const pairs: [number[], number[]][] = [];
  for (let i = 0; i < axes.length; i += 2) {
    pairs.push([axes[i], axes[i + 1]]);
  }
  return pairs;
}

function pushCircle(
  positions: number[],
  colors: number[],
  center: readonly number[],
  u: readonly number[],
  v: readonly number[],
  radius: number,
  color: [number, number, number],
): void {
  const dim = center.length;
  const segs = SUBJECT_GUIDE_CIRCLE_SEGMENTS;
  const at = (t: number): number[] => {
    const cos = Math.cos((2 * Math.PI * t) / segs);
    const sin = Math.sin((2 * Math.PI * t) / segs);
    const p: number[] = [];
    for (let i = 0; i < dim; i++) {
      p.push(center[i] + radius * (cos * u[i] + sin * v[i]));
    }
    return p;
  };
  for (let s = 0; s < segs; s++) {
    const a = at(s);
    const b = at(s + 1);
    positions.push(...a, ...b);
    colors.push(...color, ...color);
  }
}

/**
 * The sphaira block's guide spec, or `null` when there is nothing to draw:
 * no block, or a block the resolver refuses (a refused block draws nothing
 * and the panel's refusal disclosure owns the why — the guides draw the
 * construction, and there is none).
 */
export function deriveSphairaGuides(
  block: SphairahedronAuthored | null | undefined,
): SubjectGuideSpec | null {
  if (!block) return null;
  const resolution = resolveSphairahedron(block);
  if (!resolution.ok) return null;
  const construction = resolution.construction;
  const dim = construction.dim;
  const palette = transformColors(construction.foldFaces.length);
  const positions: number[] = [];
  const colors: number[] = [];
  const sheets: SubjectGuideSpec["sheets"] = [];
  const bound = construction.bound;

  construction.foldFaces.forEach((foldFace, faceIndex) => {
    const color = palette[faceIndex];
    const face = foldFace.face;
    if (face.kind === "sphere") {
      const { c, r } = face.sphere;
      for (const [u, v] of ballCircles(dim)) {
        pushCircle(positions, colors, c, u, v, r, color);
      }
    } else {
      const { n, h } = face.plane;
      let nn = 0;
      for (let i = 0; i < n.length; i++) nn += n[i] * n[i];
      const nhat = n.map((x) => x / Math.sqrt(nn));
      const [u, v] = tangentBasis(nhat);
      // The sheet's centre: the plane's closest point to the framing ball's
      // centre — the quad then spans the ball's own scale, so every guide
      // object sits inside one honest size.
      let dot = 0;
      for (let i = 0; i < nhat.length; i++) dot += bound.center[i] * nhat[i];
      const center = nhat.map((x, i) => bound.center[i] + (h - dot) * x);
      const half = bound.radius;
      const corners = [
        center.map((x, i) => x - half * (u[i] + v[i])),
        center.map((x, i) => x + half * (u[i] - v[i])),
        center.map((x, i) => x + half * (u[i] + v[i])),
        center.map((x, i) => x - half * (u[i] - v[i])),
      ];
      // Border loop + the fill's corners.
      for (let i = 0; i < 4; i++) {
        positions.push(...corners[i], ...corners[(i + 1) % 4]);
        colors.push(...color, ...color);
      }
      const flat: number[] = [];
      for (const corner of corners) flat.push(...corner);
      sheets.push({ corners: new Float32Array(flat), color });
    }
  });

  // The divide plane: the tile's carrier — and for the tetra families the
  // limit set itself (the plane y = 0).
  {
    const { n, h } = construction.divide;
    let nn = 0;
    for (let i = 0; i < n.length; i++) nn += n[i] * n[i];
    const nhat = n.map((x) => x / Math.sqrt(nn));
    const [u, v] = tangentBasis(nhat);
    let dot = 0;
    for (let i = 0; i < nhat.length; i++) dot += bound.center[i] * nhat[i];
    const center = nhat.map((x, i) => bound.center[i] + (h - dot) * x);
    const half = bound.radius;
    const corners = [
      center.map((x, i) => x - half * (u[i] + v[i])),
      center.map((x, i) => x + half * (u[i] - v[i])),
      center.map((x, i) => x + half * (u[i] + v[i])),
      center.map((x, i) => x - half * (u[i] - v[i])),
    ];
    for (let i = 0; i < 4; i++) {
      positions.push(...corners[i], ...corners[(i + 1) % 4]);
      colors.push(...DIVIDE_COLOR, ...DIVIDE_COLOR);
    }
    const flat: number[] = [];
    for (const corner of corners) flat.push(...corner);
    sheets.push({ corners: new Float32Array(flat), color: DIVIDE_COLOR });
  }

  // The authored inversion sphere J — finite constructions only (it is what
  // makes them finite), drawn white to read as the document's parameter.
  if (construction.inversion) {
    const { c, r } = construction.inversion;
    for (const [u, v] of ballCircles(dim)) {
      pushCircle(positions, colors, c, u, v, r, INVERSION_COLOR);
    }
  }

  return {
    dim,
    pairCount: positions.length / (2 * dim),
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sheets,
    frame: {
      center: [...construction.bound.center],
      radius: construction.bound.radius,
    },
  };
}

/** The 4D spec's wireframe as the `[Vec4, Vec4][]` edge pairs
 * `scene.setFourDScaffold` re-poses on every rotor tick. The 3D spec has no
 * scaffold form (its drawer is `updateSubjectGuides`). */
export function specToScaffold(spec: SubjectGuideSpec): {
  edges: [Vec4, Vec4][];
  colors: Float32Array;
} {
  if (spec.dim !== 4) return { edges: [], colors: new Float32Array(0) };
  const edges: [Vec4, Vec4][] = [];
  for (let i = 0; i < spec.pairCount; i++) {
    const o = i * 8;
    const a: Vec4 = [
      spec.positions[o],
      spec.positions[o + 1],
      spec.positions[o + 2],
      spec.positions[o + 3],
    ];
    const b: Vec4 = [
      spec.positions[o + 4],
      spec.positions[o + 5],
      spec.positions[o + 6],
      spec.positions[o + 7],
    ];
    edges.push([a, b]);
  }
  return { edges, colors: spec.colors };
}
