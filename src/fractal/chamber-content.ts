import { runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { toTransform4 } from "./affine4";
import {
  foldLattice3,
  foldLattice4,
  foldToChamber,
  isResolvedLatticeTiling,
  type ResolvedTiling,
} from "./tiling";
import { mulberry32 } from "./rng";
import type { Transform, Vec3, Vec4 } from "./types";

/**
 * Dependency-free measurement of WHERE a tiled system's chamber content
 * sits, and the session-level presentation pose derived from it.
 *
 * The tiling clip is a `ShapeSpec` evaluated at the FOLDED query point, and
 * the chamber is a cone from the origin whose content — the folded
 * attractor — lives AWAY from the origin (the origin sits in the
 * attractor's central void; the folded tetrahedron content measured at
 * 0.4-1.6 world units out, median 0.76). A canned clip shape authored at
 * the origin therefore overlaps nothing and the render is empty. The fix
 * this module supplies: measure the folded content of the CURRENT system
 * (seeded chaos game + the same fold the renderer applies), and pose an
 * unposed clip onto that content so the trim is actually visible.
 *
 * The pose is SESSION presentation state, never authored document state:
 * the authored `TilingSpec.clip` keeps the unposed shape byte for byte, an
 * authored pose wins untouched, and the pose re-derives on every session
 * enter against the system actually being rendered (so it stays right
 * across morphs and randomize). Both engines receive the posed resolved
 * tiling from the routing arms.
 */

export interface ChamberContentFit {
  /** The folded content's centroid, in chamber/world coordinates. */
  center: Vec3;
  /** Max distance from the centroid over the folded sample. */
  radius: number;
}

/** The seeded chaos-game sample size per fit. 20k settled points is ~2-5ms
 * and far denser than the 60k-ball probe that measured the content's
 * location in the first place. */
export const CHAMBER_CONTENT_FIT_SAMPLES = 20_000;

/** Scale factor from the content radius to the clip's authored scale: 1
 * spans the content exactly, so a cog's hole/rim pattern cuts through the
 * copies rather than grazing them. */
export const TILING_CLIP_POSE_SCALE = 1;

const CHAMBER_CONTENT_FIT_SEED = 0x7a7c;

/** The one fold the renderer applies for this resolved tiling, per point. */
function foldFor(
  tiling: ResolvedTiling,
  p: Vec3 | Vec4,
  out: Vec3 | Vec4,
): Vec3 | Vec4 | null {
  if (isResolvedLatticeTiling(tiling)) {
    if (out.length === 4) {
      return foldLattice4(p as Vec4, tiling.h, out);
    }
    return foldLattice3(p as Vec3, tiling.h, out);
  }
  return foldToChamber(tiling.info, p, out);
}

/**
 * Measure the chamber content of an INVERSE-DESCENT system: run the seeded
 * chaos game on the untiled attractor, fold every settled point through the
 * SAME fold the renderer applies, and fit the folded cloud. 4D systems fold
 * their lifted (xyz, w) points and fit the folded xyz — the clip is a 3D
 * shape evaluated on the folded point's first three coordinates. Returns
 * null when the sample is empty (a degenerate/empty attractor — callers
 * fall back to not posing). FORWARD systems must NOT use this: their chaos
 * game samples escape-reset debris near the origin, not the escape set —
 * the routing arms pass the bailout ball's {origin, boundingRadius} fit
 * instead.
 */
export function chamberContentFit(
  transforms: Transform[],
  finalTransform: Transform | null,
  tiling: ResolvedTiling,
  fourD: boolean,
  samples = CHAMBER_CONTENT_FIT_SAMPLES,
): ChamberContentFit | null {
  const rng = mulberry32(CHAMBER_CONTENT_FIT_SEED);
  let foldedCount = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  if (fourD) {
    const transforms4 = transforms.map(toTransform4);
    const final4 = finalTransform ? toTransform4(finalTransform) : null;
    const run = runChaosGame4(transforms4, samples, rng, final4);
    for (let i = 0; i < run.count; i++) {
      const p: Vec4 = [
        run.positions[i * 3],
        run.positions[i * 3 + 1],
        run.positions[i * 3 + 2],
        run.w[i],
      ];
      const q = foldFor(tiling, p, [0, 0, 0, 0]);
      if (!q) continue;
      sumX += q[0];
      sumY += q[1];
      sumZ += q[2];
      foldedCount++;
    }
  } else {
    const run = runChaosGame(transforms, samples, rng, finalTransform);
    for (let i = 0; i < run.count; i++) {
      const p: Vec3 = [
        run.positions[i * 3],
        run.positions[i * 3 + 1],
        run.positions[i * 3 + 2],
      ];
      const q = foldFor(tiling, p, [0, 0, 0]);
      if (!q) continue;
      sumX += q[0];
      sumY += q[1];
      sumZ += q[2];
      foldedCount++;
    }
  }
  if (foldedCount < 100) return null;
  const center: Vec3 = [
    sumX / foldedCount,
    sumY / foldedCount,
    sumZ / foldedCount,
  ];
  let radius = 0;
  const measure = (q: Vec3 | Vec4): void => {
    const dx = q[0] - center[0];
    const dy = q[1] - center[1];
    const dz = q[2] - center[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) radius = d;
  };
  if (fourD) {
    const transforms4 = transforms.map(toTransform4);
    const final4 = finalTransform ? toTransform4(finalTransform) : null;
    const run = runChaosGame4(
      transforms4,
      samples,
      mulberry32(CHAMBER_CONTENT_FIT_SEED),
      final4,
    );
    for (let i = 0; i < run.count; i++) {
      const p: Vec4 = [
        run.positions[i * 3],
        run.positions[i * 3 + 1],
        run.positions[i * 3 + 2],
        run.w[i],
      ];
      const q = foldFor(tiling, p, [0, 0, 0, 0]);
      if (q) measure(q);
    }
  } else {
    const run = runChaosGame(
      transforms,
      samples,
      mulberry32(CHAMBER_CONTENT_FIT_SEED),
      finalTransform,
    );
    for (let i = 0; i < run.count; i++) {
      const p: Vec3 = [
        run.positions[i * 3],
        run.positions[i * 3 + 1],
        run.positions[i * 3 + 2],
      ];
      const q = foldFor(tiling, p, [0, 0, 0]);
      if (q) measure(q);
    }
  }
  return { center, radius };
}

/** Does the clip carry an authored pose? Only `parts[0]` is posed by this
 * module; an authored pose on the first part wins. */
export function tilingClipHasAuthoredPose(tiling: ResolvedTiling): boolean {
  const pose = tiling.clip?.parts[0]?.pose;
  if (!pose) return false;
  return pose.offset !== undefined || pose.scale !== undefined;
}

/**
 * The session-level presentation pose: when the authored clip has no pose,
 * place it on the measured chamber content (offset = content centroid,
 * scale = content radius × {@link TILING_CLIP_POSE_SCALE}) so the trim is
 * visible. Returns the tiling unchanged when there is no clip, the clip
 * already carries an authored pose, or no fit could be measured. The
 * document's authored clip is never mutated — this returns a session copy.
 */
export function poseTilingForContent(
  tiling: ResolvedTiling,
  fit: ChamberContentFit | null,
): ResolvedTiling {
  if (!tiling.clip || !fit || tilingClipHasAuthoredPose(tiling)) {
    return tiling;
  }
  if (!Number.isFinite(fit.radius) || fit.radius <= 0) return tiling;
  const posed: ResolvedTiling = {
    ...tiling,
    clip: {
      ...tiling.clip,
      parts: [
        {
          ...tiling.clip.parts[0],
          pose: {
            offset: [fit.center[0], fit.center[1], fit.center[2]],
            scale: fit.radius * TILING_CLIP_POSE_SCALE,
          },
        },
        ...tiling.clip.parts.slice(1),
      ],
    },
  };
  return posed;
}
