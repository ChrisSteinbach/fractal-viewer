/**
 * The PreviewScene factory for the sphairahedron study — plain-data specs
 * in, `de-preview.ts` scene out, deterministic so `de-preview-parallel.ts`
 * workers rebuild byte-identical scenes. One factory serves every panel:
 * the constructions live in `sphairahedron-orbit.ts`, this file only binds
 * them to the shared marcher (frame, fold-cap, fudge, optional depth
 * coloring through the shade hook).
 */
import type { PreviewScene, Vec3 } from "./de-preview";
import {
  buildSphairahedron,
  estimateSph,
  foldQuery,
  makeFinite,
  makeSphScratch,
  wallSystem236,
  wallSystem244,
  wallSystem333,
  type BallSpec,
  type Dim,
  type HSphere,
  type SphScene,
} from "./sphairahedron-orbit";
import { mulberry32 } from "../src/fractal/rng";

export interface SphPanelSpec {
  kind: "cube1" | "cube4" | "cube9" | "tetra333" | "prism2" | "tetra4";
  zb?: number;
  zc?: number;
  z2?: number;
  /** Finite type: the inversion sphere. "reference" = the reference
   * implementation's constrained sphere with its center reflected through
   * the divide plane (see referenceInversionSphere); "shift" = that sphere
   * pushed `k·r` further along the divide's complement normal with the
   * radius scaled — the free parameter's deformation, deterministic;
   * "explicit" = a hand-placed center/radius; absent = infinite type. */
  inversion?:
    | { mode: "reference" }
    | { mode: "shift"; k: number; rScale: number }
    | { mode: "explicit"; c: [number, number, number]; r: number };
  /** Distance-estimate fudge (the reference ships 0.2). */
  fudge?: number;
  /** March damping on top of the fudged value. */
  stepScale?: number;
  /** Color hits by fold depth (the reference's tile coloring). */
  depthColor?: boolean;
  /** 4D slices: the w the 3D panel evaluates. */
  w0?: number;
  foldCap?: number;
  eyeOffset?: Vec3;
  zoom?: number;
  shadow?: boolean;
  ao?: boolean;
  fog?: boolean;
}

const PI3 = Math.PI / 3;

function buildInfinite(spec: SphPanelSpec): SphScene {
  const dim: Dim = spec.kind === "tetra4" ? 4 : 3;
  if (spec.kind === "tetra333" || spec.kind === "tetra4") {
    return buildSphairahedron({
      dim,
      kind: spec.kind,
      params: "",
      ws: wallSystem333(0.5),
      balls: [
        { corner: [0, 1], height: 0, theta: [PI3, PI3], radius: 1, name: "b" },
      ],
      divide: { n: [0, 1, 0, 0].slice(0, dim), h: 0 },
      foldCap: spec.foldCap,
    }).scene;
  }
  if (spec.kind === "prism2") {
    return buildSphairahedron({
      dim,
      kind: "prism2",
      params: `z2=${spec.z2}`,
      ws: wallSystem333(1),
      balls: [
        {
          corner: [0, 1],
          height: spec.z2 ?? 2,
          theta: [PI3, PI3],
          name: "b2",
        },
        {
          corner: [0, 2],
          height: 0,
          theta: [Math.PI / 6, Math.PI / 2],
          radius: Math.sqrt(3),
          name: "b4",
        },
      ],
      foldCap: spec.foldCap,
    }).scene;
  }
  const ws =
    spec.kind === "cube1"
      ? wallSystem333(0.5)
      : spec.kind === "cube4"
        ? wallSystem236()
        : wallSystem244();
  const th =
    spec.kind === "cube1"
      ? ([PI3, PI3] as [number, number])
      : spec.kind === "cube4"
        ? null
        : null;
  const balls: BallSpec[] =
    spec.kind === "cube1"
      ? [
          { corner: [0, 1], height: 0, theta: th!, name: "b2" },
          { corner: [0, 2], height: spec.zb ?? 0.5, theta: th!, name: "b4" },
          { corner: [1, 2], height: spec.zc ?? 1.0, theta: th!, name: "b6" },
        ]
      : spec.kind === "cube4"
        ? [
            {
              corner: [0, 1],
              height: 0,
              theta: [Math.PI / 6, PI3],
              name: "b2",
            },
            {
              corner: [0, 2],
              height: spec.zb ?? 0.5,
              theta: [PI3, PI3],
              name: "b4",
            },
            {
              corner: [1, 2],
              height: spec.zc ?? 1.0,
              theta: [PI3, Math.PI / 2],
              name: "b6",
            },
          ]
        : [
            {
              corner: [0, 1],
              height: 0,
              theta: [Math.PI / 4, Math.PI / 4],
              name: "b2",
            },
            {
              corner: [0, 2],
              height: spec.zb ?? 0.5,
              theta: [Math.PI / 2, Math.PI / 4],
              name: "b4",
            },
            {
              corner: [1, 2],
              height: spec.zc ?? 1.0,
              theta: [Math.PI / 4, Math.PI / 2],
              name: "b6",
            },
          ];
  return buildSphairahedron({
    dim,
    kind: spec.kind,
    params: `(${spec.zb}, ${spec.zc})`,
    ws,
    balls,
    foldCap: spec.foldCap,
  }).scene;
}

/** Unit normal of the divide plane pointing AWAY from the tile (the
 * complement side), from the corner vertices. */
function complementNormal(scene: SphScene): [number, number, number] {
  const vs = scene.vertices.filter((v) => v.faces.length === 3);
  const [a, b, d] = vs;
  const v1 = b.p.map((x, i) => x - a.p[i]);
  const v2 = d.p.map((x, i) => x - a.p[i]);
  const nn = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
  const l = Math.hypot(nn[0], nn[1], nn[2]);
  const n = nn.map((x) => x / l);
  const h = n.reduce((s, x, i) => s + x * a.p[i], 0);
  const probeSide = n.reduce((s, x, i) => s + x * scene.probe[i], 0) - h;
  const s = probeSide > 0 ? -1 : 1;
  return [n[0] * s, n[1] * s, n[2] * s];
}

/** Union/pocket sample counts at the inverted construction's own scale. */
function unionStats(scene: SphScene): { union: number; pocket: number } {
  const scratch = makeSphScratch(scene.dim, scene.foldCap);
  const rng = mulberry32(0x5eed_e5ca);
  let c0x = 0;
  let c0y = 0;
  let c0z = 0;
  let m0 = 0;
  for (const { face } of scene.foldFaces) {
    if (face.kind !== "sphere") continue;
    c0x += face.sphere.c[0];
    c0y += face.sphere.c[1];
    c0z += face.sphere.c[2];
    m0++;
  }
  c0x /= m0;
  c0y /= m0;
  c0z /= m0;
  let R0 = 0;
  for (const { face } of scene.foldFaces) {
    if (face.kind !== "sphere") continue;
    R0 = Math.max(
      R0,
      Math.hypot(
        face.sphere.c[0] - c0x,
        face.sphere.c[1] - c0y,
        face.sphere.c[2] - c0z,
      ) + face.sphere.r,
    );
  }
  R0 = Math.max(R0 * 1.4, 0.2);
  let union = 0;
  let pocket = 0;
  for (let i = 0; i < 8000; i++) {
    const p = [
      c0x + (rng() * 2 - 1) * R0,
      c0y + (rng() * 2 - 1) * R0,
      c0z + (rng() * 2 - 1) * R0,
    ];
    const d = estimateSph(scene, p, 0.2, scratch);
    if (scratch.capped) continue;
    if (d <= 0) union++;
    else pocket++;
  }
  return { union, pocket };
}

/**
 * Pick the inversion sphere: the reference's constrained sphere reflected
 * through the divide plane first, then a deterministic ladder of spheres
 * stepped along the divide's complement normal. Accepted when the finite
 * construction's union is a bounded blob (enough samples, minority side).
 */
function pickInversionSphere(scene: SphScene): HSphere {
  const base = referenceInversionSphere(scene);
  const dir = complementNormal(scene);
  const scale = base.r;
  const candidates: HSphere[] = [
    base,
    ...[0.6, 1.6].map((rs) => ({ c: [...base.c], r: base.r * rs })),
  ];
  for (const step of [0.5, 1.0, 1.6, 2.4]) {
    for (const rScale of [1.0, 0.6, 1.6]) {
      candidates.push({
        c: base.c.map((v, i) => v + dir[i] * step * scale),
        r: scale * rScale,
      });
    }
  }
  // Ladder two: spheres over the divide plane's centroid, at the wall
  // triangle's own scale — rescues parameters whose reflected reference
  // collapses the image construction.
  const vs = scene.vertices.filter((v) => v.faces.length === 3);
  if (vs.length >= 3) {
    const dc = [0, 1, 2].map(
      (i) => vs.reduce((s, v) => s + v.p[i], 0) / vs.length,
    );
    const span = Math.max(
      ...vs.map((v) =>
        Math.hypot(v.p[0] - dc[0], v.p[1] - dc[1], v.p[2] - dc[2]),
      ),
    );
    for (const step of [0.4, 0.8, 1.4, 2.2]) {
      for (const rScale of [0.6, 1.0, 1.5]) {
        candidates.push({
          c: dc.map((v, i) => v + dir[i] * step * span),
          r: span * rScale,
        });
      }
    }
  }
  let fallback = base;
  let fallbackUnion = -1;
  for (const cand of candidates) {
    const fin = makeFinite(scene, cand);
    const { union, pocket } = unionStats(fin);
    if (union >= 12 && union <= pocket) return cand;
    if (union > fallbackUnion) {
      fallbackUnion = union;
      fallback = cand;
    }
  }
  return fallback;
}

function referenceInversionSphere(scene: SphScene): HSphere {
  // The reference implementation constrains the free inversion sphere to
  // the mirror of its last ball (computeInversionSphere). That center sits
  // on the TILED side of the divide plane, where the compact side of the
  // limit set is a complement pocket the camera cannot fit inside; the
  // study reflects the center through the divide plane (radius kept) so
  // the compact union faces the camera, matching the site's gallery
  // presentation. J is a free parameter — this is a rendering stance, not
  // a different family member.
  const last = scene.faces[2];
  if (last.kind !== "sphere")
    throw new Error("reference inversion needs 3 balls");
  const c = last.sphere.c;
  const j0: HSphere = { c: [-c[0], -c[1], c[2]], r: last.sphere.r };
  const vs = scene.vertices.filter((v) => v.faces.length === 3);
  if (vs.length < 3) return j0;
  const [a, b, d] = vs;
  const v1 = b.p.map((x, i) => x - a.p[i]);
  const v2 = d.p.map((x, i) => x - a.p[i]);
  const nn = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
  const l = Math.hypot(nn[0], nn[1], nn[2]);
  const n = nn.map((x) => x / l);
  const h = n.reduce((s, x, i) => s + x * a.p[i], 0);
  const d0 = n.reduce((s, x, i) => s + x * j0.c[i], 0) - h;
  // Reflecting through the plane moves the center to the opposite side of
  // the divide from where the reference put it.
  return { c: j0.c.map((x, i) => x - 2 * d0 * n[i]), r: j0.r };
}

function hsv(h: number, s: number, v: number): Vec3 {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const k = i % 6;
  const r = [v, q, p, p, t, v][k];
  const g = [t, v, v, q, p, p][k];
  const b = [p, p, t, v, v, q][k];
  return [
    Math.pow(Math.max(0, r), 1 / 2.2),
    Math.pow(Math.max(0, g), 1 / 2.2),
    Math.pow(Math.max(0, b), 1 / 2.2),
  ];
}

/**
 * Frame the quasi-sphere empirically: sample the DE sign at the inverted
 * construction's own scale, take the compact side of the zero set — the
 * union when it is bounded (camera outside), the complement pocket
 * otherwise (camera inside, looking out) — and frame on it. Which side is
 * compact depends on where the inversion sphere's center sits relative to
 * the divide plane, so nothing here is derived; it is measured,
 * deterministically (fixed seed).
 */
function autoFrame(scene: SphScene, preview: PreviewScene): void {
  const scratch = makeSphScratch(scene.dim, scene.foldCap);
  const rng = mulberry32(0x5eed_e5ca);
  // The inverted construction's own extent.
  let c0x = 0;
  let c0y = 0;
  let c0z = 0;
  let m0 = 0;
  for (const { face } of scene.foldFaces) {
    if (face.kind !== "sphere") continue;
    c0x += face.sphere.c[0];
    c0y += face.sphere.c[1];
    c0z += face.sphere.c[2];
    m0++;
  }
  c0x /= m0;
  c0y /= m0;
  c0z /= m0;
  let R0 = 0;
  for (const { face } of scene.foldFaces) {
    if (face.kind !== "sphere") continue;
    R0 = Math.max(
      R0,
      Math.hypot(
        face.sphere.c[0] - c0x,
        face.sphere.c[1] - c0y,
        face.sphere.c[2] - c0z,
      ) + face.sphere.r,
    );
  }
  R0 = Math.max(R0 * 1.4, 0.2);
  const n = 24000;
  const dim = scene.dim;
  const C0 = [c0x, c0y, c0z];
  while (C0.length < dim) C0.push(0);
  let union = 0;
  let pocket = 0;
  const uu = new Float64Array(n * dim);
  const pp = new Float64Array(n * dim);
  for (let i = 0; i < n; i++) {
    const p = C0.map((v) => v + (rng() * 2 - 1) * R0);
    const d = estimateSph(scene, p, 0.2, scratch);
    if (scratch.capped) continue; // a capped fold's sign is not a reading
    if (d <= 0) {
      for (let a = 0; a < dim; a++) uu[union * dim + a] = p[a];
      union++;
    } else {
      for (let a = 0; a < dim; a++) pp[pocket * dim + a] = p[a];
      pocket++;
    }
  }
  // A tiny-but-real union (a compressed image construction) is still
  // framable: the percentile reach zooms onto it.
  // The wide pass can miss a compressed union entirely; the probe's image
  // is guaranteed union-interior, so sample around it at the construction's
  // own scale until the union registers.
  if (union < 3) {
    const probe = [...scene.probe];
    let faceR = 0;
    for (const { face } of scene.foldFaces) {
      if (face.kind === "sphere") faceR = Math.max(faceR, face.sphere.r);
    }
    for (const frac of [3, 0.6, 0.1]) {
      const R1 = Math.max(faceR * frac, 1e-4);
      union = 0;
      pocket = 0;
      for (let i = 0; i < n; i++) {
        const p = probe.map((v) => v + (rng() * 2 - 1) * R1);
        const d = estimateSph(scene, p, 0.2, scratch);
        if (scratch.capped) continue;
        if (d <= 0) {
          for (let a = 0; a < dim; a++) uu[union * dim + a] = p[a];
          union++;
        } else {
          for (let a = 0; a < dim; a++) pp[pocket * dim + a] = p[a];
          pocket++;
        }
      }
      if (union >= 3) break;
    }
  }
  const boundedUnion = union <= pocket && union >= 3;
  let compact = boundedUnion ? uu : pp;
  let m = boundedUnion ? union : pocket;
  if (m < 3) throw new Error("autoFrame: no compact side found");
  // A compact side measured by only a handful of samples is framed poorly;
  // re-sample densely around its centroid once.
  if (m < 300) {
    const gc = new Array<number>(dim).fill(0);
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < dim; a++) gc[a] += compact[i * dim + a];
    }
    for (let a = 0; a < dim; a++) gc[a] /= m;
    const R1 = Math.max(
      1e-3,
      4 *
        Math.max(
          ...Array.from({ length: m }, (_, i) => {
            let dd = 0;
            for (let a = 0; a < dim; a++)
              dd += (compact[i * dim + a] - gc[a]) ** 2;
            return Math.sqrt(dd);
          }),
        ),
    );
    const fine = new Float64Array(n * dim);
    let fm = 0;
    for (let i = 0; i < n; i++) {
      const p = C0.map((v) => v + (rng() * 2 - 1) * R1);
      const d = estimateSph(scene, p, 0.2, scratch);
      if (scratch.capped) continue;
      const isCompact = boundedUnion ? d <= 0 : d > 0;
      if (isCompact) {
        for (let a = 0; a < dim; a++) fine[fm * dim + a] = p[a];
        fm++;
      }
    }
    if (fm >= 3) {
      compact = fine;
      m = fm;
    }
  }
  const cc = new Array<number>(dim).fill(0);
  for (let i = 0; i < m; i++) {
    for (let a = 0; a < dim; a++) cc[a] += compact[i * dim + a];
  }
  for (let a = 0; a < dim; a++) cc[a] /= m;
  const cx = cc[0];
  const cy = cc[1];
  const cz = cc[2];
  // Robust radius: a stray deep sample must not shrink the object in
  // frame — take the 92nd percentile of the sample distances.
  const dists: number[] = [];
  for (let i = 0; i < m; i++) {
    let dd = 0;
    for (let a = 0; a < dim; a++) dd += (compact[i * dim + a] - cc[a]) ** 2;
    dists.push(Math.sqrt(dd));
  }
  dists.sort((a, b) => a - b);
  const reach = dists[Math.min(m - 1, Math.floor(m * 0.92))] * 1.18;
  const dirs: Vec3[] = [
    [1.55, 1.1, 1.8],
    [-1.55, 1.1, 1.8],
    [1.55, -1.1, -1.8],
    [-1.55, -1.1, -1.8],
    [0.2, 1.9, 0.4],
    [1.8, 0.3, -1.2],
  ];
  const scale = boundedUnion ? 2.0 * reach : 0.45 * reach;
  let bestEye: Vec3 | undefined;
  let bestD = -Infinity;
  for (const dir of dirs) {
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    const eye: Vec3 = [
      cx + (dir[0] / l) * scale,
      cy + (dir[1] / l) * scale,
      cz + (dir[2] / l) * scale,
    ];
    const d = estimateSph(
      scene,
      dim === 4 ? [eye[0], eye[1], eye[2], 0] : [...eye],
      0.2,
      scratch,
    );
    if (d > 0) {
      bestEye = eye;
      break;
    }
    if (d > bestD) {
      bestD = d;
      bestEye = eye;
    }
  }
  preview.eye = bestEye;
  if (process.env.SPHAIRA_DEBUG) {
    console.log(
      `    [frame] ${scene.kind} ${scene.params}: union ${union} pocket ${pocket} ` +
        `boundedUnion ${boundedUnion} m ${m} reach ${reach.toFixed(3)} R0 ${R0.toFixed(3)}`,
    );
  }
  preview.boundingRadius = boundedUnion ? reach * 1.12 : R0;
  preview.boundingCenter = [cx, cy, cz];
  preview.target = [cx, cy, cz];
  if (!boundedUnion) preview.zoom = 0.85;
}

/** The scene plus its bound preview — the harness's cross-checks reuse the
 * exact framing the beauty panels get. */
export function buildSceneFull(spec: SphPanelSpec): {
  scene: SphScene;
  preview: PreviewScene;
  j?: HSphere;
} {
  const dim: Dim = spec.kind === "tetra4" ? 4 : 3;
  const w0 = spec.w0 ?? 0;
  const fudge = spec.fudge ?? 0.2;
  const infinite = buildInfinite(spec);
  let scene = infinite;
  let j: HSphere | undefined;
  const inv = spec.inversion;
  if (inv) {
    if (inv.mode === "reference") {
      j = pickInversionSphere(infinite);
    } else if (inv.mode === "shift") {
      const base = pickInversionSphere(infinite);
      const dir = complementNormal(infinite);
      j = {
        c: base.c.map((v, i) => v + dir[i] * inv.k * base.r),
        r: base.r * inv.rScale,
      };
    } else {
      j = { c: padTo(inv.c, dim), r: inv.r };
    }
    scene = makeFinite(infinite, j, spec.foldCap);
  }
  return { scene, preview: buildSceneFrom(scene, spec, fudge, dim, w0), j };
}

export function buildScene(spec: SphPanelSpec): PreviewScene {
  const dim: Dim = spec.kind === "tetra4" ? 4 : 3;
  const w0 = spec.w0 ?? 0;
  const fudge = spec.fudge ?? 0.2;
  const infinite = buildInfinite(spec);
  let scene = infinite;
  const inv = spec.inversion;
  if (inv) {
    if (inv.mode === "reference") {
      scene = makeFinite(infinite, pickInversionSphere(infinite), spec.foldCap);
    } else if (inv.mode === "shift") {
      const base = pickInversionSphere(infinite);
      const dir = complementNormal(infinite);
      scene = makeFinite(
        infinite,
        {
          c: base.c.map((v, i) => v + dir[i] * inv.k * base.r),
          r: base.r * inv.rScale,
        },
        spec.foldCap,
      );
    } else {
      scene = makeFinite(
        infinite,
        { c: padTo(inv.c, dim), r: inv.r },
        spec.foldCap,
      );
    }
  }
  return buildSceneFrom(scene, spec, fudge, dim, w0);
}

function padTo(c: number[], dim: Dim): number[] {
  const out = [...c];
  while (out.length < dim) out.push(0);
  return out;
}

function buildSceneFrom(
  scene: SphScene,
  spec: SphPanelSpec,
  fudge: number,
  dim: Dim,
  w0: number,
): PreviewScene {
  const scratch = makeSphScratch(dim, scene.foldCap);
  const foldScratch = makeSphScratch(dim, scene.foldCap);
  const extend = (p: Vec3): number[] =>
    dim === 4 ? [p[0], p[1], p[2], w0] : [...p];
  const de = (p: Vec3): number => estimateSph(scene, extend(p), fudge, scratch);
  const preview: PreviewScene = {
    de,
    stepScale: spec.stepScale ?? 1,
    shadow: spec.shadow,
    ao: spec.ao,
    fog: spec.fog,
    boundingRadius: 1,
    boundingCenter: [0, 0, 0],
    target: [0, 0, 0],
  };
  if (spec.inversion) {
    autoFrame(scene, preview);
  } else {
    preview.boundingRadius = scene.bound.radius;
    preview.boundingCenter = [...scene.bound.center] as Vec3;
    preview.target = [...scene.bound.center] as Vec3;
    if (spec.kind === "prism2") {
      // Terrain: look at the divide plane's height range from above.
      preview.target = [0, 0.2, 0];
    }
    if (spec.kind === "tetra333" || spec.kind === "tetra4") {
      preview.target = [0, -0.2, 0];
    }
  }
  if (spec.depthColor) {
    preview.shade = (hit) => {
      const s = foldQuery(scene, extend(hit.p), foldScratch);
      const depth = s.inversions + s.reflections;
      const base = hsv((((depth * 0.031) % 1) + 1) % 1, 0.75, 1);
      const lit =
        0.25 +
        0.75 *
          Math.max(
            0,
            hit.n[0] * hit.light[0] +
              hit.n[1] * hit.light[1] +
              hit.n[2] * hit.light[2],
          ) *
          hit.shadow;
      return [base[0] * lit, base[1] * lit, base[2] * lit];
    };
  }
  if (spec.eyeOffset) preview.eyeOffset = spec.eyeOffset;
  if (spec.zoom !== undefined) preview.zoom = spec.zoom;
  return preview;
}
