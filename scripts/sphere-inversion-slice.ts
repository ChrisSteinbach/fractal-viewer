/**
 * WHAT DOES A RENDERED PANEL'S FOLD WORD SAY — HOW DEEP ARE THE COPIES, AND
 * IS THIS 4D SLICE ITS OWN OBJECT OR THE 3D SUB-ARRANGEMENT'S?
 *
 * The native 4D beauty search answered that question with three columns, and
 * the authored-sets look study asks it of jittered and parametric 4D
 * arrangements. This module is the ONE definition the two sheets share, for
 * the `set-extent.ts` reason: a second copy of "which generators are off the
 * slice" is a second chance to disagree about what GENUINE means, and the
 * columns' calibrated floors (`docs/sphere-inversion-family.md`, "Native 4D
 * beauty search") are quoted against one instrument or against nothing.
 *
 * THE SUB-ARRANGEMENT is the explicit 3D construction a passive slice would
 * be: the generators whose centres lie IN the slice hyperplane, acting on the
 * seed's own slice. A word on in-plane centres never leaves the hyperplane,
 * so wherever the slice is passive that 3D scene draws the same picture.
 *
 * THE COLUMNS are image-weighted, because the cloud columns cannot judge
 * lace: lace has no volume, so a membership cloud's copy share reads 0.00 and
 * containment against the reference pose is vacuous.
 *
 *   - `copyPx`: share of HIT pixels whose surface point folds through at
 *     least one inversion — how much of the picture is copies rather than
 *     the seed itself.
 *   - `offPx`: of those, the share whose fold word uses a generator centred
 *     OFF the slice. 0 means the whole picture is the sub-arrangement's; 1
 *     by construction whenever no centre lies in the slice at all, which is
 *     why it is read beside `wordMatch` and never alone.
 *   - `wordMatch`: share of copy pixels whose fold word at the SAME in-slice
 *     point is identical under the reference pose. Erosion keeps every word,
 *     so a flat embedding's passive offset reads 1; new arrangement reads
 *     low. Calibrated on the gate's flat embedding (oct6 r .70 at `w = 0`):
 *     passive `w0` .15 reads 1.00, `xw` .40 reads 0.95.
 */
import { PREVIEW_HIT } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import { foldQuery, makeFoldScratch } from "./sphere-inversion-orbit";
import type {
  GBall,
  Generator,
  InversionScene,
  InversionSceneSpec,
  RotorPlane,
} from "./sphere-inversion-orbit";
import { sliceBasis4 } from "./sphere-inversion-orbit";

/** A slice of 4D space: the rotor's planes and the world `w` the slice sits
 * at. `Pose4`-shaped records from either sheet satisfy it structurally. */
export interface SlicePose {
  planes: [RotorPlane, number][];
  w0: number;
}

/** The tolerance a centre's height off the slice must clear to count as OFF
 * it. Exact in the poses that matter: an arrangement's own symmetry puts
 * centres exactly in the hyperplane, and a jittered one puts none there. */
export const SLICE_IN_PLANE_TOLERANCE = 1e-9;

const dot4 = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** Per generator: is its centre off the slice hyperplane? */
export function offSliceFlags(
  gens: readonly Generator[],
  pose: SlicePose,
): boolean[] {
  const basis = sliceBasis4(pose.planes);
  return gens.map(
    (g) => Math.abs(dot4(basis[3], g.c) - pose.w0) >= SLICE_IN_PLANE_TOLERANCE,
  );
}

/**
 * The slice's EXPLICIT 3D sub-arrangement: generators centred in the slice
 * hyperplane, acting on the seed's own slice. Null when the seed misses the
 * slice entirely (every member is then a non-member of both).
 */
export function sliceSubArrangement(
  spec: InversionSceneSpec,
  pose: SlicePose,
): InversionSceneSpec | null {
  const basis = sliceBasis4(pose.planes);
  const toSlice = (c: readonly number[]) =>
    [0, 1, 2].map((a) => dot4(basis[a], c));
  const gens: Generator[] = [];
  for (const g of spec.gens) {
    if (Math.abs(dot4(basis[3], g.c) - pose.w0) < SLICE_IN_PLANE_TOLERANCE) {
      gens.push({ c: toSlice(g.c), r: g.r });
    }
  }
  const seed: GBall[] = [];
  for (const b of spec.seed) {
    const h = dot4(basis[3], b.c) - pose.w0;
    if (Math.abs(h) >= b.r) {
      if (b.sign === 1) return null;
      continue;
    }
    seed.push({
      c: toSlice(b.c),
      r: Math.sqrt(b.r * b.r - h * h),
      sign: b.sign,
    });
  }
  return { dim: 3, gens, seed, depth: spec.depth };
}

export interface FoldWordColumns {
  /** Share of HIT pixels that are copies (fold spent >= 1 inversion). */
  copyPx: number;
  /** Share of HIT pixels whose word is at least TWO inversions long: a copy
   * inside a copy, which is what NESTING means at the pixel level. A set
   * whose generators have drifted apart still draws first-generation copies
   * long after the second generation has left the picture, so `copyPx` alone
   * cannot say whether an arrangement still nests. */
  deepPx: number;
  /** Mean word length over hit pixels — how many generations the picture
   * averages, rather than how many it reaches. */
  meanWord: number;
  /** Of the copy pixels, the share whose word uses an off-slice centre.
   * NaN when no slice was given. */
  offPx: number;
  /** Of the copy pixels, the share whose word is unchanged under the
   * reference pose. NaN when no reference pose was given. */
  wordMatch: number;
}

export interface FoldWordOpts {
  /** Places an in-slice point in 4D under this pose. Absent = a 3D panel,
   * whose surface points are already the query points. */
  lift?: (p: Vec3) => ArrayLike<number>;
  /** The reference pose `wordMatch` compares against. */
  liftRef?: (p: Vec3) => ArrayLike<number>;
  /** Per generator, is its centre off the slice ({@link offSliceFlags})? */
  offPlane?: readonly boolean[];
}

/**
 * The image-weighted columns over one rendered panel, in ONE pass so a sheet
 * that prints both the depth columns and the slice columns cannot report two
 * different copy shares. `stats` must carry `status`/`hitPos` (render with
 * `collect: true`).
 */
export function foldWordColumns(
  scene: InversionScene,
  stats: PanelStats,
  size: number,
  opts: FoldWordOpts = {},
): FoldWordColumns {
  const { lift, liftRef, offPlane } = opts;
  const scratch = makeFoldScratch(scene);
  const scratchRef = makeFoldScratch(scene);
  const p3: Vec3 = [0, 0, 0];
  let hitPx = 0;
  let copyPx = 0;
  let deepPx = 0;
  let words = 0;
  let offPx = 0;
  let sameWord = 0;
  for (let px = 0; px < size * size; px++) {
    if (stats.status![px] !== PREVIEW_HIT) continue;
    hitPx++;
    p3[0] = stats.hitPos![px * 3];
    p3[1] = stats.hitPos![px * 3 + 1];
    p3[2] = stats.hitPos![px * 3 + 2];
    const f = foldQuery(scene, lift ? lift(p3) : p3, scratch);
    words += f.k;
    if (f.k === 0) continue;
    copyPx++;
    if (f.k >= 2) deepPx++;
    if (offPlane) {
      for (let t = 0; t < f.k; t++) {
        if (offPlane[f.word[t]]) {
          offPx++;
          break;
        }
      }
    }
    if (liftRef) {
      const f0 = foldQuery(scene, liftRef(p3), scratchRef);
      let same = f0.k === f.k;
      for (let t = 0; same && t < f.k; t++) same = f0.word[t] === f.word[t];
      if (same) sameWord++;
    }
  }
  return {
    copyPx: hitPx > 0 ? copyPx / hitPx : 0,
    deepPx: hitPx > 0 ? deepPx / hitPx : 0,
    meanWord: hitPx > 0 ? words / hitPx : 0,
    offPx: offPlane ? (copyPx > 0 ? offPx / copyPx : 0) : NaN,
    wordMatch: liftRef ? (copyPx > 0 ? sameWord / copyPx : 1) : NaN,
  };
}
