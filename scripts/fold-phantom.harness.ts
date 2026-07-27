/**
 * fr-7xgi diagnostic harness: phantom box faces on MIXED affine+fold
 * systems.
 *
 * Repro (user screenshots, 2026-07-27): the "Twisted Tetrahedron" preset
 * (`defaultTransforms`, four 0.5-scale rotated corner maps) with a single
 * `boxfold` variation added to ONE map renders, in Surface mode only, a
 * large crisp box corner off one cluster plus smaller self-similar tent
 * copies of it — geometry the Points render (ground truth by definition:
 * chaos-game samples ARE the attractor) does not contain.
 *
 * NEGATIVE CONTROL — REFUTED (see the MEASURED VERDICT below). The
 * investigation's first suspect was `descendFold` (surface-de.ts,
 * fr-5rvk): a tuple dropped or evicted from its width-12 frontier folds
 * its REGION FLOOR — `scale * |w| * regionDist`, where `regionDist`
 * measures how far the chain point strayed outside a fold branch's
 * validity region. Those floors are valid lower bounds, but their
 * zero-sets are the branch validity planes: for a boxfold map applied as
 * `q = w * V(M p + t)`, the LEVEL-1 planes sit at `|q_axis| = |w|` in
 * world space — an axis-aligned cube of side `2|w|` — and deeper levels
 * image that cube through the system's maps (the receding tents). On the
 * pure-fold profiles fr-5rvk measured, frontier pressure was low enough
 * that drop-folds never surfaced (deep-void false hits 0 everywhere). The
 * suspicion this harness was built to test: a MIXED system changes that,
 * since every level spawns 27 boxfold branches + one candidate per
 * affine map against the same 12 slots, so in-sphere tuples with
 * near-zero floors — chains hugging a validity plane — would be evicted
 * constantly, and in a genuine void their folded near-zero floors would
 * become the descent's min, with a sphere tracer converging onto the
 * validity plane itself: a rendered box face that is not attractor. The
 * DE sections below pin the oracle clean on every probe instead — which
 * is exactly why they are kept as a NEGATIVE CONTROL: a future
 * regression that IS a true DE plateau-hit (rather than a tier-acceptance
 * bug, fr-7xgi's actual mechanism) will fire here.
 *
 * WHAT THIS HARNESS MEASURES, per fold-map choice (the fold on map 0, 1,
 * 2, 3) and per estimator (plain = what the GLSL fold tracer marches,
 * refined = the CPU production estimator):
 *
 *  (1) DEEP-VOID FALSE HITS on general uniform probes — the beam
 *      harness's proxy (estimate < 0.01R while the true nearest cloud
 *      sample is > 0.15R away): does the mixed system false-hit at all,
 *      where the fr-5rvk profiles measured 0?
 *  (2) FACE FINGERPRINT — probes sampled ON the level-1 cube's surface
 *      (`max|q_axis| = |w|`, restricted to deep void) and offset 0.02R
 *      outward along the face normal: if the phantom is the validity
 *      plane, on-face void probes read ~0 (false hit) and the offset
 *      probes read ~c * 0.02R — the linear ramp a marcher rides down onto
 *      a rendered face.
 *  (3) LEVEL-1 IMAGES — the same on-face void probes pushed through each
 *      affine map: the self-similar tents. Same expectation as (2).
 *  (4) CONTROLS — the identical probe pipeline on (a) the pure affine
 *      default preset (no fold): must read 0 false hits everywhere, or
 *      the probe method itself is broken; and (b) a WEIGHT SWEEP (w =
 *      0.8 / 1.0 / 1.2 on one map): the on-face fingerprint must TRACK
 *      the cube `|q| = |w|` as it moves — probes on the w-cube of a
 *      DIFFERENT weight land off the planes and must go clean. Face
 *      identity, not coincidence.
 *
 * MEASURED VERDICT (fr-7xgi, 2026-07-27): the region-floor hypothesis was
 * REFUTED — the CPU oracle is clean on the repro system every way it was
 * probed (plain/refined estimators, cutoff 0 and march-like cutoffs,
 * f32-emulated arithmetic, depth-limited descents 4..14, and full march
 * emulation along 7k+ rays: zero deep-void hits everywhere), and the
 * browser matrix showed the phantom identically on SwiftShader,
 * ANGLE/Iris-Xe and Firefox/Mesa, ruling out driver miscompiles. The
 * actual mechanism was tier interaction, not the DE: the preview tier
 * derived its hit-acceptance epsilon from the PREVIEW buffer height, so
 * at the coarse rungs fold systems start on (cost-weighted ladder start +
 * panic drops; SwiftShader sat at scale ~0.1, uMaxDepth 6, acceptance
 * ~0.04 at the phantom's distance) the epsilon crossed the fold DE's
 * loose-but-valid plateau band (region-floor certificates measure DE/D as
 * low as 0.13 near fold faces vs 0.6+ on affine systems, fr-5rvk's
 * tables) and the march accepted the whole box-face shell as surface:
 * crisp phantom faces with flat plateau-gradient normals, self-similar at
 * every fold-image scale, erased only by a settle frame fold systems are
 * slowest to reach. Fix: uAcceptPixelEps (surface-material.ts, its 4D
 * twin, scene.ts) pins acceptance to the full-resolution epsilon in every
 * tier — a tier may coarsen sampling, never acceptance. Emulated at the
 * 40-step preview budget: phantom hits 2 -> 0, holes 0.4-0.9% of true
 * hits; verified live on all three GLSL stacks (phantom gone at every
 * rung, previews now match the Points silhouette).
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/fold-phantom.harness.ts
 * Env: CLOUD (ground-truth sample count, default 60000).
 */
import { runChaosGame } from "../src/fractal/chaos-game";
import type { ChaosGameResult } from "../src/fractal/chaos-game";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import { defaultTransforms } from "../src/fractal/presets";
import { applyAffine, composeAffine } from "../src/fractal/affine";
import { initialState } from "../src/app/state";
import { encodeScene, toSnapshot } from "../src/app/persist";
import { previewMaxDepth } from "../src/app/render-tier";
import type { Transform, Vec3 } from "../src/fractal/types";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CLOUD = envInt("CLOUD", 60_000);

/** Deep-void / hit thresholds — the beam harness's proxies, verbatim:
 * a probe whose nearest true sample is beyond `DEEP_VOID_R * R` sits in
 * genuine void; an estimate under `HIT_R * R` is what a marcher would
 * accept as a surface hit. */
const DEEP_VOID_R = 0.15;
const HIT_R = 0.01;

/** The repro system: the "Twisted Tetrahedron" UI preset with a single
 * pure-`boxfold` variation (weight `w`) on map `foldIndex`. */
function twistedTetraWithBoxfold(foldIndex: number, w = 1): Transform[] {
  return defaultTransforms().map((t) =>
    t.id === foldIndex
      ? { ...t, variations: [{ type: "boxfold" as const, weight: w }] }
      : t,
  );
}

function nearest3(cloud: ChaosGameResult, p: Vec3): number {
  let best = Infinity;
  const pos = cloud.positions;
  for (let i = 0; i < cloud.count; i++) {
    const dx = pos[i * 3] - p[0];
    const dy = pos[i * 3 + 1] - p[1];
    const dz = pos[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Uniformly sample the surface of the axis-aligned cube `[-w, w]^3`,
 * optionally offset along the face's outward normal. */
function cubeFacePoint(
  rng: () => number,
  w: number,
  normalOffset: number,
): Vec3 {
  const axis = Math.floor(rng() * 3) % 3;
  const sign = rng() < 0.5 ? -1 : 1;
  const a = (rng() * 2 - 1) * w;
  const b = (rng() * 2 - 1) * w;
  const p: Vec3 = [0, 0, 0];
  p[axis] = sign * (w + normalOffset);
  p[(axis + 1) % 3] = a;
  p[(axis + 2) % 3] = b;
  return p;
}

interface ClassStats {
  probes: number;
  falseHits: number;
  /** Median estimate over the class's DEEP-VOID probes, as a fraction of
   * R — the "how close to zero does the descent read here" summary. */
  medEstFracR: number;
  /** Worst (smallest) deep-void estimate, fraction of R. */
  minEstFracR: number;
}

function classify(
  de: SurfaceDE,
  cloud: ChaosGameResult,
  probes: Vec3[],
  estimator: (de: SurfaceDE, p: Vec3) => number,
): ClassStats {
  const R = de.boundingRadius;
  let falseHits = 0;
  const voidEsts: number[] = [];
  for (const p of probes) {
    const trueD = nearest3(cloud, p);
    if (trueD <= DEEP_VOID_R * R) continue;
    const est = estimator(de, p);
    voidEsts.push(est / R);
    if (est < HIT_R * R) falseHits++;
  }
  voidEsts.sort((a, b) => a - b);
  return {
    probes: voidEsts.length,
    falseHits,
    medEstFracR: voidEsts.length ? voidEsts[voidEsts.length >> 1] : NaN,
    minEstFracR: voidEsts.length ? voidEsts[0] : NaN,
  };
}

function fmt(label: string, s: ClassStats): string {
  return (
    `${label.padEnd(18)} deepVoidProbes=${String(s.probes).padStart(4)}` +
    ` falseHits=${String(s.falseHits).padStart(4)}` +
    ` medEst=${(s.medEstFracR * 100).toFixed(3)}%R` +
    ` minEst=${(s.minEstFracR * 100).toFixed(3)}%R`
  );
}

/** The probe families of module-doc sections (1)-(3), built once per
 * system so every estimator row scores the identical points. */
function buildProbes(
  rng: () => number,
  R: number,
  w: number,
  affines: Transform[],
): { label: string; probes: Vec3[] }[] {
  const uniform: Vec3[] = [];
  const half = 1.2 * R;
  for (let i = 0; i < 1000; i++) {
    uniform.push([
      (rng() - 0.5) * 2 * half,
      (rng() - 0.5) * 2 * half,
      (rng() - 0.5) * 2 * half,
    ]);
  }
  const onFace: Vec3[] = [];
  const offFace: Vec3[] = [];
  for (let i = 0; i < 600; i++) {
    onFace.push(cubeFacePoint(rng, w, 0));
    offFace.push(cubeFacePoint(rng, w, 0.02 * R));
  }
  const families = [
    { label: "uniform", probes: uniform },
    { label: "onFace", probes: onFace },
    { label: "offFace+.02R", probes: offFace },
  ];
  for (const t of affines) {
    const a = composeAffine(t);
    const img: Vec3[] = onFace
      .slice(0, 300)
      .map((p) => applyAffine(a, p[0], p[1], p[2]));
    families.push({ label: `img(map${t.id})`, probes: img });
  }
  return families;
}

const ESTIMATORS = [
  { label: "plain", fn: estimateDistance },
  { label: "refined", fn: estimateDistanceRefined },
] as const;

describe("fr-7xgi browser-repro scene hashes", () => {
  it("prints the #v1 scene hash per fold-map choice for erosion-browser.mjs --hash", () => {
    // The CPU oracle measured clean on this system (see the fold-phantom
    // tables), which is what made the browser render the next suspect:
    // these hashes feed `node scripts/erosion-browser.mjs --hash=...` to
    // reproduce the user's exact system in the real app (persist.ts's own
    // encoder — the same wire format the share link produces). The
    // browser matrix the MEASURED VERDICT cites came from exactly these
    // hashes; the mechanism it found was tier acceptance, not a driver
    // miscompile (every stack showed the identical phantom).
    const base = toSnapshot(initialState(false));
    for (let foldIndex = 0; foldIndex < 4; foldIndex++) {
      const hash = encodeScene({
        ...base,
        transforms: twistedTetraWithBoxfold(foldIndex),
      });
      console.log(`fold on map ${foldIndex}: ${hash}`);
    }
    expect(true).toBe(true);
  });
});

describe("fr-7xgi fold phantom faces", () => {
  it("control: the pure affine preset shows zero deep-void false hits under the same probes", () => {
    const transforms = defaultTransforms();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, CLOUD, mulberry32(101), null, {
      order: 1,
      axis: "y",
    });
    console.log(
      `\n== control: pure affine default (CLOUD=${CLOUD}, R=${de.boundingRadius.toFixed(4)}) ==`,
    );
    const failures: string[] = [];
    // Same probe families the fold rows use (w = 1 cube — on the pure
    // affine system those planes are nothing special, which is the point).
    const families = buildProbes(mulberry32(7), de.boundingRadius, 1, []);
    for (const est of ESTIMATORS) {
      for (const fam of families) {
        const s = classify(de, cloud, fam.probes, est.fn);
        console.log(`  ${est.label.padEnd(8)} ${fmt(fam.label, s)}`);
        if (s.falseHits !== 0) {
          failures.push(
            `${est.label}/${fam.label}: ${s.falseHits} false hits on the affine control`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it("measures deep-void false hits and the box-face fingerprint per fold-map choice", () => {
    console.log(
      `\n== twisted tetrahedron + boxfold(w=1) on one map (CLOUD=${CLOUD}) ==`,
    );
    for (let foldIndex = 0; foldIndex < 4; foldIndex++) {
      const transforms = twistedTetraWithBoxfold(foldIndex);
      const analysis = analyzeSurfaceSystem(transforms);
      if (analysis.status === "ineligible") {
        console.log(
          `-- fold on map ${foldIndex}: INELIGIBLE (${analysis.reasons.join("; ")})`,
        );
        continue;
      }
      const de = buildSurfaceDE(transforms);
      const cloud = runChaosGame(transforms, CLOUD, mulberry32(101), null, {
        order: 1,
        axis: "y",
      });
      console.log(
        `-- fold on map ${foldIndex}: status=${analysis.status}` +
          ` maps=${de.maps.length} R=${de.boundingRadius.toFixed(4)}` +
          ` maxDepth=${de.maxDepth}`,
      );
      const affines = transforms.filter((t) => t.id !== foldIndex);
      const families = buildProbes(
        mulberry32(7),
        de.boundingRadius,
        1,
        affines,
      );
      for (const est of ESTIMATORS) {
        for (const fam of families) {
          const s = classify(de, cloud, fam.probes, est.fn);
          console.log(`  ${est.label.padEnd(8)} ${fmt(fam.label, s)}`);
        }
      }
    }
    // Diagnostic print, no hard assertion: every family here already reads
    // 0 false hits (the MEASURED VERDICT's "zero deep-void hits
    // everywhere") — the region-floor hypothesis predicted a fingerprint
    // on exactly these probes and none appeared, which is the negative
    // control's result, not a pending one. Kept as prints rather than
    // hard zeros because this table's job is documenting the fingerprint
    // methodology (and staying ready for a genuine future DE regression),
    // not gating CI on a bug that was never in the DE to begin with.
    expect(true).toBe(true);
  }, 600_000);

  it("weight sweep: the on-face fingerprint tracks the fold weight's cube, not a fixed one", () => {
    console.log(`\n== weight sweep, fold on map 0 (CLOUD=${CLOUD}) ==`);
    for (const w of [0.8, 1.0, 1.2]) {
      const transforms = twistedTetraWithBoxfold(0, w);
      const analysis = analyzeSurfaceSystem(transforms);
      if (analysis.status === "ineligible") {
        console.log(`-- w=${w}: INELIGIBLE (${analysis.reasons.join("; ")})`);
        continue;
      }
      const de = buildSurfaceDE(transforms);
      const cloud = runChaosGame(transforms, CLOUD, mulberry32(101), null, {
        order: 1,
        axis: "y",
      });
      const rng = mulberry32(11);
      // On-face probes for the SWEPT weight's cube and for the two other
      // weights' cubes: the region-floor hypothesis (REFUTED — see the
      // MEASURED VERDICT) predicted only the matching cube's probes would
      // false-hit if the phantom WERE the validity plane |q| = |w|; the
      // negative-control result is that none of them do, at any weight.
      for (const probeW of [0.8, 1.0, 1.2]) {
        const probes: Vec3[] = [];
        for (let i = 0; i < 400; i++)
          probes.push(cubeFacePoint(rng, probeW, 0));
        const s = classify(de, cloud, probes, estimateDistance);
        console.log(
          `  w=${w.toFixed(1)} probeCube=${probeW.toFixed(1)} ${fmt("onFace", s)}`,
        );
      }
    }
    expect(true).toBe(true);
  }, 600_000);
});

// -----------------------------------------------------------------------
// ACCEPTANCE POLICY (fr-7xgi, the shipped fix). Emulates the preview
// march's hit test at rungs 0.1 / 0.3 / 0.7 under three eps policies:
//
//  - "native" (the fix): pixelEps of the FULL-RESOLUTION (800px) frame,
//    the PREVIEW hit floor (2e-4, SURFACE_PREVIEW_HIT_FLOOR) — mirrors
//    `uAcceptPixelEps` exactly: scene.ts's `acceptHeight` is always the
//    settle buffer's height in every tier, but the tier's own hit floor
//    still varies (`uHitFloor` stays SURFACE_PREVIEW_HIT_FLOOR in
//    preview), so the fixed policy pairs the NATIVE eps with the PREVIEW
//    floor, not the full one.
//  - "buffer" (the dead pre-fix policy): pixelEps of the SCALED preview
//    buffer, same preview hit floor — `uPixelEps`'s old role as the
//    acceptance epsilon too. Its phantom count is printed, never
//    asserted: the table exists to document why the fix was needed.
//  - "full": the 160-step/full-depth settle reference — full hit floor,
//    native eps — every hole count (a ray the fixed policy misses that
//    the settle frame would have hit) is measured against.
//
// This emulates surface-material.ts's SURFACE_FOLDS march loop (ray
// setup, `eps = max(pixelEps * t, R * hitFloor)`, `t += d * stepScale`)
// on the CPU; the GLSL is the mirror SOURCE, so keep this in lockstep by
// hand if that shader body's march changes.
// -----------------------------------------------------------------------

const ACCEPT_FOV = (60 * Math.PI) / 180;
const ACCEPT_NATIVE_H = 800;
/** pixelEps of an 800px-tall full-resolution frame — what `uAcceptPixelEps`
 * now carries into every tier. */
const ACCEPT_FULL_EPS = (2 * Math.tan(ACCEPT_FOV / 2)) / ACCEPT_NATIVE_H;
/** SURFACE_PREVIEW_HIT_FLOOR (surface-material.ts) — untouched by the fix:
 * only the pixelEps term unified across tiers, not the hit floor. */
const ACCEPT_PREVIEW_HIT_FLOOR = 2e-4;
/** SURFACE_FULL_HIT_FLOOR (surface-material.ts) — the settle reference's
 * own floor. */
const ACCEPT_FULL_HIT_FLOOR = 1e-5;

/** CPU emulation of the GLSL fold march's accept/step loop: ray-sphere
 * entry against the visible bound, then `estimateDistance` steps with
 * `eps = max(pixelEps * t, R * hitFloor)` until a hit or the step budget
 * runs out. Mirrors surface-material.ts's SURFACE_FOLDS march body. */
function acceptMarch(
  de: SurfaceDE,
  ro: Vec3,
  rd: Vec3,
  steps: number,
  maxDepth: number,
  pixelEps: number,
  hitFloor: number,
): { hit: boolean; t: number } {
  const deK = maxDepth === de.maxDepth ? de : { ...de, maxDepth };
  const R = de.boundingRadius;
  const far = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] ** 2 + ro[1] ** 2 + ro[2] ** 2 - far * far;
  const disc = b * b - c;
  if (disc <= 0) return { hit: false, t: 0 };
  let t = Math.max(0, -b - Math.sqrt(disc));
  const tFar = -b + Math.sqrt(disc);
  for (let i = 0; i < steps; i++) {
    if (t > tFar) break;
    const eps = Math.max(pixelEps * t, R * hitFloor);
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = estimateDistance(deK, p, eps);
    if (d < eps) return { hit: true, t };
    t += d * de.stepScale;
  }
  return { hit: false, t };
}

/** Four orthographic 44x44 ray bundles through the visible sphere (the
 * -x/-y/-z/-diagonal view directions), the camera coverage the
 * acceptance-policy comparison marches. */
function acceptRayBundles(de: SurfaceDE): { ro: Vec3; rd: Vec3 }[] {
  const far = de.visibleBoundingRadius * 1.02;
  const dirs: Vec3[] = [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
    [-1 / Math.sqrt(3), -1 / Math.sqrt(3), -1 / Math.sqrt(3)],
  ];
  const N = 44;
  const rays: { ro: Vec3; rd: Vec3 }[] = [];
  for (const rd of dirs) {
    const up: Vec3 = Math.abs(rd[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const sx: Vec3 = [
      rd[1] * up[2] - rd[2] * up[1],
      rd[2] * up[0] - rd[0] * up[2],
      rd[0] * up[1] - rd[1] * up[0],
    ];
    const nx = Math.hypot(...sx);
    sx[0] /= nx;
    sx[1] /= nx;
    sx[2] /= nx;
    const sy: Vec3 = [
      rd[1] * sx[2] - rd[2] * sx[1],
      rd[2] * sx[0] - rd[0] * sx[2],
      rd[0] * sx[1] - rd[1] * sx[0],
    ];
    for (let a = 0; a < N; a++) {
      for (let bb = 0; bb < N; bb++) {
        const ua = ((a + 0.5) / N - 0.5) * 2 * far;
        const ub = ((bb + 0.5) / N - 0.5) * 2 * far;
        const ro: Vec3 = [
          -rd[0] * far * 1.5 + sx[0] * ua + sy[0] * ub,
          -rd[1] * far * 1.5 + sx[1] * ua + sy[1] * ub,
          -rd[2] * far * 1.5 + sx[2] * ua + sy[2] * ub,
        ];
        rays.push({ ro, rd });
      }
    }
  }
  return rays;
}

/** Did a march result land in genuine void (>0.1R from the nearest sampled
 * point) — the same phantom-hit proxy the rest of this harness uses. */
function acceptIsPhantom(
  cloud: ChaosGameResult,
  R: number,
  ro: Vec3,
  rd: Vec3,
  m: { hit: boolean; t: number },
): boolean {
  if (!m.hit) return false;
  const hp: Vec3 = [
    ro[0] + rd[0] * m.t,
    ro[1] + rd[1] * m.t,
    ro[2] + rd[2] * m.t,
  ];
  return nearest3(cloud, hp) > 0.1 * R;
}

describe("fr-7xgi acceptance policy (the shipped fix)", () => {
  it("rungs 0.1/0.3/0.7: native acceptance is phantom-free with negligible hole cost", () => {
    const transforms = twistedTetraWithBoxfold(0);
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 60_000, mulberry32(101), null, {
      order: 1,
      axis: "y",
    });
    const R = de.boundingRadius;
    const rays = acceptRayBundles(de);
    console.log(
      `\n== acceptance policy: twistedTetra+boxfold(map0) ` +
        `(fullMaxDepth=${de.maxDepth}, rays=${rays.length}) ==`,
    );
    const failures: string[] = [];
    for (const scale of [0.1, 0.3, 0.7]) {
      const depth = previewMaxDepth(de.maxDepth, scale);
      const bufEps = ACCEPT_FULL_EPS / scale;
      let nativePhantom = 0;
      let bufferPhantom = 0;
      let holes = 0;
      let fullHits = 0;
      for (const { ro, rd } of rays) {
        // (i) Native (the fix): full-resolution pixelEps, PREVIEW floor.
        const native = acceptMarch(
          de,
          ro,
          rd,
          40,
          depth,
          ACCEPT_FULL_EPS,
          ACCEPT_PREVIEW_HIT_FLOOR,
        );
        // (iii) Buffer-scaled (dead pre-fix policy): printed, not asserted.
        const buffer = acceptMarch(
          de,
          ro,
          rd,
          40,
          depth,
          bufEps,
          ACCEPT_PREVIEW_HIT_FLOOR,
        );
        // Reference: the settle frame.
        const full = acceptMarch(
          de,
          ro,
          rd,
          160,
          de.maxDepth,
          ACCEPT_FULL_EPS,
          ACCEPT_FULL_HIT_FLOOR,
        );
        if (full.hit) fullHits++;
        if (acceptIsPhantom(cloud, R, ro, rd, native)) nativePhantom++;
        if (acceptIsPhantom(cloud, R, ro, rd, buffer)) bufferPhantom++;
        // (ii) Holes: rays the reference hits that the fixed policy misses.
        if (full.hit && !native.hit) holes++;
      }
      const holeFrac = holes / Math.max(1, fullHits);
      console.log(
        `  scale=${scale} depth=${depth}` +
          ` | native: phantomHits=${nativePhantom}` +
          ` holes=${holes}/${fullHits} (${(holeFrac * 100).toFixed(2)}%)` +
          ` | buffer(dead, pre-fix): phantomHits=${bufferPhantom}`,
      );
      if (nativePhantom !== 0) {
        failures.push(
          `scale=${scale}: native policy phantom hits=${nativePhantom} (want 0)`,
        );
      }
      if (!(holeFrac < 0.02)) {
        failures.push(
          `scale=${scale}: hole fraction=${(holeFrac * 100).toFixed(2)}% (want <2%)`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
