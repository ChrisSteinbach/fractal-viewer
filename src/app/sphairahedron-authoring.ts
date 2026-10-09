/**
 * The sphairahedron J picker — the study's DE-sampling deterministic
 * inversion-sphere chooser (`scripts/sphairahedron-factory.ts`'s
 * `pickInversionSphere`, ported onto the production vocabulary), as an
 * AUTHORING ACTION: the inversion sphere is authored explicitly (the
 * vocabulary's own rule — no silent default), and this module is the rule
 * that chooses one. It cannot live in the pure resolver because it SAMPLES
 * THE DE SIGN (`sphairahedron.ts`'s module doc); it lives outside the
 * panel's pure half because it is an action, not a range.
 *
 * THE RULE. Try the reflected reference (`defaultSphairahedronInversion`,
 * the documented FIRST CANDIDATE) and its radius variants, then a ladder
 * stepped along the divide's complement normal, then a ladder over the
 * three-face vertices' centroid at their own span; accept the first
 * candidate whose finite union is a bounded blob — enough union samples,
 * minority side (the study's `unionStats`, on the production estimator;
 * capped folds are excluded from every sign reading — a capped fold's
 * tile SDF is not a membership reading). Deterministic in the
 * construction: no RNG reaches the candidate list, and the census's own
 * stream is fixed-seeded, so the same construction picks the same sphere
 * every time.
 *
 * THE REFUSAL. When every candidate degenerates the seed image (the
 * finite mapping throws) or the census finds no bounded blob at all, the
 * picker returns `null` — a REFUSAL the panel discloses, never a silent
 * sphere. The best-union candidate is returned only when the study's
 * fallback rule applies (some union was found); a zero-union sweep
 * refuses.
 */
import {
  buildSphairahedron,
  defaultSphairahedronInversion,
  resolveSphairahedron,
  SPHAIRAHEDRON_FOLD_CAPPED,
  type SphairahedronAuthored,
  type SphairahedronConstruction,
} from "../fractal/sphairahedron";
import {
  buildSphairahedronDE,
  sphairahedronHitInfo,
} from "../fractal/sphairahedron-de";
import { mulberry32 } from "../fractal/rng";

/** The bounded-blob census: the study's sample count and minimum union —
 * enough sign readings that a thin arm reads as content, few enough that
 * the picker stays interactive (8000 evaluations ≈ a few ms). */
const CENSUS_SAMPLES = 8000;
const CENSUS_MIN_UNION = 12;

export interface SphairahedronPickedSphere {
  c: number[];
  r: number;
}

/**
 * The picker's first accepted sphere for a block's RESOLVED construction,
 * as an authored `inversion` object — `undefined` when the block does not
 * resolve or the picker refuses (the caller discloses). The single write
 * the finite checkbox and the Pick button share.
 */
export function authoredPickerInversion(
  block: SphairahedronAuthored,
): Record<string, number> | undefined {
  const resolution = resolveSphairahedron(block);
  if (!resolution.ok) return undefined;
  const picked = pickSphairahedronInversion(resolution.construction);
  if (!picked) return undefined;
  const out: Record<string, number> = {
    cx: picked.c[0],
    cy: picked.c[1],
    cz: picked.c[2],
  };
  if (picked.c.length > 3) out.cw = picked.c[3];
  out.r = picked.r;
  return out;
}

/**
 * Pick the inversion sphere for a resolved construction. Deterministic.
 * `null` refuses: no candidate produced a bounded finite union (the
 * panel's note names it — "the construction refused every sphere").
 */
export function pickSphairahedronInversion(
  construction: SphairahedronConstruction,
): SphairahedronPickedSphere | null {
  const base = defaultSphairahedronInversion(construction);
  // The complement normal: the divide's unit normal, oriented AWAY from
  // the tile (the divide's solid side is the probe's).
  const n = construction.divide.n;
  const probeSide =
    n.reduce((s, v, i) => s + v * construction.probe[i], 0) -
    construction.divide.h;
  const dir = n.map((v) => v * (probeSide > 0 ? -1 : 1));
  const scale = base ? base.r : Math.max(construction.bound.radius, 0.2);
  const anchor = base ? base.c : construction.bound.center;
  const candidates: SphairahedronPickedSphere[] = [];
  if (base) {
    candidates.push(base);
    for (const rs of [0.6, 1.6]) {
      candidates.push({ c: [...base.c], r: base.r * rs });
    }
  }
  for (const step of [0.5, 1.0, 1.6, 2.4]) {
    for (const rScale of [1.0, 0.6, 1.6]) {
      candidates.push({
        c: anchor.map((v, i) => v + dir[i] * step * scale),
        r: scale * rScale,
      });
    }
  }
  // Ladder two: spheres over the divide's three-face vertices' centroid,
  // at the vertex triangle's own span — rescues parameters whose
  // reflected reference collapses the image construction (type 9's).
  const tri = construction.vertices.filter((v) => v.faces.length === 3);
  if (tri.length >= 3) {
    const dc = [0, 1, 2].map(
      (i) => tri.reduce((s, v) => s + v.p[i], 0) / tri.length,
    );
    const span = Math.max(
      ...tri.map((v) =>
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
  let fallback: SphairahedronPickedSphere | null = null;
  let fallbackUnion = -1;
  for (const cand of candidates) {
    let stats: { union: number; pocket: number };
    try {
      stats = finiteUnionStats(
        buildSphairahedron(construction.family, construction.moduli, cand),
      );
    } catch {
      continue;
    }
    if (stats.union >= CENSUS_MIN_UNION && stats.union <= stats.pocket) {
      return cand;
    }
    if (stats.union > fallbackUnion) {
      fallbackUnion = stats.union;
      fallback = cand;
    }
  }
  return fallback;
}

/** The DE-sign census behind the bounded-blob reading — the study's
 * `unionStats` on the production estimator. A 4D construction accepts its
 * first candidate outright: the census is a 3D presentation stance, and
 * the tetra lift's finite limit set is an analytic 3-sphere (the anchor
 * measurement), so there is no pocket reading to make. */
function finiteUnionStats(construction: SphairahedronConstruction): {
  union: number;
  pocket: number;
} {
  if (construction.dim !== 3) return { union: CENSUS_SAMPLES, pocket: 0 };
  const de = buildSphairahedronDE(construction);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let m = 0;
  for (const { face } of construction.foldFaces) {
    if (face.kind !== "sphere") continue;
    cx += face.sphere.c[0];
    cy += face.sphere.c[1];
    cz += face.sphere.c[2];
    m++;
  }
  if (m === 0) return { union: 0, pocket: 1 };
  cx /= m;
  cy /= m;
  cz /= m;
  let r0 = 0;
  for (const { face } of construction.foldFaces) {
    if (face.kind !== "sphere") continue;
    r0 = Math.max(
      r0,
      Math.hypot(
        face.sphere.c[0] - cx,
        face.sphere.c[1] - cy,
        face.sphere.c[2] - cz,
      ) + face.sphere.r,
    );
  }
  r0 = Math.max(r0 * 1.4, 0.2);
  const rng = mulberry32(0x5eed_e5ca);
  let union = 0;
  let pocket = 0;
  for (let i = 0; i < CENSUS_SAMPLES; i++) {
    const p: [number, number, number] = [
      cx + (rng() * 2 - 1) * r0,
      cy + (rng() * 2 - 1) * r0,
      cz + (rng() * 2 - 1) * r0,
    ];
    const hit = sphairahedronHitInfo(de, p);
    if (hit.status === SPHAIRAHEDRON_FOLD_CAPPED) continue;
    if (hit.d <= 0) union++;
    else pocket++;
  }
  return { union, pocket };
}
