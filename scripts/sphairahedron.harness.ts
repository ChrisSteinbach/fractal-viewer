/**
 * WHAT DO SPHAIRAHEDRAL LIMIT SETS LOOK LIKE, AND DOES THE IIS ESTIMATOR
 * RENDER THEM CHEAPLY ENOUGH TO SHIP.
 *
 * The owner's visual gate for the sphairahedron family (the epic's
 * promotion gate): render known sphairahedral limit sets — finite
 * quasi-spheres across cube type 1's parameter space, the crater types,
 * the prism terrains — through `de-preview.ts`'s shared marcher, with the
 * correctness anchors (the analytic sphere/plane cases), the tile
 * cross-check (the seed-ball orbit), the Points-stance samplers and the
 * 4D stance panel, and measure the fold and the estimator while at it.
 *
 * THE ESTIMATOR IS THE AUTHOR-FORM HEURISTIC: fold into the fundamental
 * domain (IIS), divide the tile SDF by the accumulated conformal Jacobian,
 * times a fudge (the reference ships 0.2). It is NOT a certified bound —
 * no disjointness, no covering argument; the study measures its step
 * scale, its overshoot against the analytic anchors, and its cap behavior.
 * Construction verification (Lemmas 3.3/3.5 at machine precision) gates
 * every rendered panel; see `sphairahedron-orbit.ts` for the math and
 * `docs/sphairahedron-family.md` for the record.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphairahedron.harness.ts
 * Writes, under `scripts/out/`:
 *   sphairahedron-finite.png     (a) finite quasi-spheres, cube types
 *   sphairahedron-terrain.png    (b) prism type 2 terrains
 *   sphairahedron-anchor.png     (c) the analytic-sphere/plane anchors
 *   sphairahedron-orbit.png      (d) seed-ball orbit vs the fold DE
 *   sphairahedron-points.png     (e) inverse-iteration clouds
 *   sphairahedron-4d.png         (f) the 4D tetra lift, sliced
 * `SPHAIRA_SIZE=N` overrides the panel size (a coarse pass while iterating).
 * `SPHAIRA_SERIAL=1` forces the in-thread renderer.
 */
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../src/fractal/rng";
import {
  renderPreview,
  writeLabeledContactSheet,
  encodePng,
} from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import { renderPreviewParallel } from "./de-preview-parallel";
import {
  buildScene,
  buildSceneFull,
  type SphPanelSpec,
} from "./sphairahedron-factory";
import {
  buildSphairahedron,
  estimateSph,
  foldQuery,
  invertPoint,
  invertSphere,
  makeFinite,
  makeSphScratch,
  sphContains,
  tileSDF,
  wallSystem333,
  type HSphere,
  type SphScene,
} from "./sphairahedron-orbit";

const SIZE = Number(process.env.SPHAIRA_SIZE ?? 256);
const SERIAL = process.env.SPHAIRA_SERIAL === "1";
const FUDGE = 0.2;

/** Minimal vec3 helpers for ray reconstruction in the anchor check. */
function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function pct(n: number, size: number): string {
  return ((100 * n) / (size * size)).toFixed(1);
}

function statLine(stats: PanelStats, size: number): string {
  return (
    `H${pct(stats.hits, size)}% X${pct(stats.exhausted, size)}% ` +
    `S${(stats.steps / size / size).toFixed(1)} ` +
    `E${(stats.evals / size / size).toFixed(1)}`
  );
}

interface Row {
  label: string;
  sub: string;
  spec: SphPanelSpec;
}

async function renderRows(
  title: string,
  rows: Row[],
  size: number,
  file: string,
  cols: number,
): Promise<void> {
  const panels: { stats: PanelStats; lines: readonly [string, string] }[] = [];
  console.log(
    `\n  ${title} (${size}px; H hit%, X exhausted%, S steps/ray, E de-evals/ray)`,
  );
  for (const row of rows) {
    const t0 = Date.now();
    const stats = SERIAL
      ? renderPreview(buildScene(row.spec), size)
      : await renderPreviewParallel(
          {
            module: "./sphairahedron-factory",
            factory: "buildScene",
            args: [row.spec],
          },
          size,
        );
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `    ${row.label.padEnd(30)} ${statLine(stats, size).padEnd(24)} ${secs}s`,
    );
    panels.push({ stats, lines: [row.label, row.sub] });
  }
  const out = writeLabeledContactSheet(panels, cols, file);
  console.log(`    wrote ${out}`);
}

// ------------------------------------------------------- (a) finite beauties

const BEAUTY_ROWS: Row[] = [
  {
    label: "CUBE1 (0.50,1.00) CANON",
    sub: "reference inversion sphere",
    spec: {
      kind: "cube1",
      zb: 0.5,
      zc: 1.0,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
  {
    label: "CUBE1 (0.80,0.64) GALLERY",
    sub: "author gallery pair",
    spec: {
      kind: "cube1",
      zb: 0.8,
      zc: 0.64,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
  {
    label: "CUBE1 (0.60,1.20) NEAR CUSP",
    sub: "arms lengthen toward the cusp",
    spec: {
      kind: "cube1",
      zb: 0.6,
      zc: 1.2,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
  {
    label: "CUBE1 (0.65,1.30) PAST CUSP",
    sub: "outside the region: arms overlap",
    spec: {
      kind: "cube1",
      zb: 0.65,
      zc: 1.3,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
  {
    label: "CUBE1 (0.50,1.00) INV FAR",
    sub: "inversion sphere pushed out, r x1.3",
    spec: {
      kind: "cube1",
      zb: 0.5,
      zc: 1.0,
      inversion: { mode: "shift", k: 0.3, rScale: 1.4 },
      depthColor: true,
    },
  },
  {
    label: "CUBE1 (0.50,1.00) INV NEAR",
    sub: "inversion sphere pulled in, r x0.7",
    spec: {
      kind: "cube1",
      zb: 0.5,
      zc: 1.0,
      inversion: { mode: "shift", k: -0.2, rScale: 0.7 },
      depthColor: true,
    },
  },
  {
    label: "CUBE4 CRATER TYPE",
    sub: "walls pi/2, pi/3, pi/6",
    spec: {
      kind: "cube4",
      zb: 0.4,
      zc: 0.3,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
  {
    label: "CUBE9 CRATER TYPE",
    sub: "walls pi/2, pi/4, pi/4 at (0.3, 0.2)",
    spec: {
      kind: "cube9",
      zb: 0.3,
      zc: 0.2,
      inversion: { mode: "reference" },
      depthColor: true,
    },
  },
];

// ------------------------------------------------------------ (b) terrains

const TERRAIN_ROWS: Row[] = [
  {
    label: "PRISM2 z2=+2",
    sub: "the reference terrain chirality",
    spec: {
      kind: "prism2",
      z2: 2,
      depthColor: true,
      fog: false,
      eyeOffset: [0.5, 1.9, 1.1],
      zoom: 0.45,
    },
  },
  {
    label: "PRISM2 z2=-2",
    sub: "the mirrored chirality",
    spec: {
      kind: "prism2",
      z2: -2,
      depthColor: true,
      fog: false,
      eyeOffset: [0.5, 1.9, 1.1],
      zoom: 0.45,
    },
  },
  {
    label: "PRISM2 z2=+1",
    sub: "gentler relief",
    spec: {
      kind: "prism2",
      z2: 1,
      depthColor: true,
      fog: false,
      eyeOffset: [0.5, 1.9, 1.1],
      zoom: 0.45,
    },
  },
];

// ------------------------------------------------------------- (c) anchors

const ANCHOR_ROWS: Row[] = [
  {
    label: "TETRA333 INFINITE",
    sub: "limit set = the plane y=0",
    spec: {
      kind: "tetra333",
      depthColor: true,
      fog: false,
      eyeOffset: [0.8, 1.4, 0.9],
      zoom: 0.5,
    },
  },
  {
    label: "TETRA333 FINITE",
    sub: "limit set = an analytic sphere",
    spec: {
      kind: "tetra333",
      inversion: { mode: "explicit", c: [0.5, 3, 0], r: 1.3 },
      depthColor: true,
      fog: false,
    },
  },
  {
    label: "CUBE1 (0,0) EISENSTEIN",
    sub: "flat case: limit set = the plane",
    spec: {
      kind: "cube1",
      zb: 0,
      zc: 0,
      inversion: { mode: "reference" },
      depthColor: true,
      fog: false,
    },
  },
];

// ------------------------------------------------------- analytic anchors

/** The analytic limit set of the finite tetra: the image of the invariant
 * plane y=0 under the inversion sphere — a sphere through its center. */
function tetraFiniteAnchor(j: HSphere): { c: Vec3; r: number } {
  const d = j.c[1];
  const k = (j.r * j.r) / (2 * d);
  return { c: [j.c[0], j.c[1] - k, j.c[2]], r: Math.abs(k) };
}

interface AnchorCheck {
  name: string;
  /** Distance from a marched hit point to the analytic limit set. */
  error: (p: Vec3) => number;
  scene: SphScene;
  /** Camera aimed at the analytic object (the marching bias is refined
   * away by bisection; the frame just has to reach it). */
  preview: PreviewScene;
}

function buildAnchors(): AnchorCheck[] {
  const tetra = buildSphairahedron({
    dim: 3,
    kind: "tetra333",
    params: "",
    ws: wallSystem333(0.5),
    balls: [
      {
        corner: [0, 1],
        height: 0,
        theta: [Math.PI / 3, Math.PI / 3],
        radius: 1,
        name: "b",
      },
    ],
    divide: { n: [0, 1, 0], h: 0 },
  }).scene;
  const j: HSphere = { c: [0.5, 3, 0], r: 1.3 };
  const finite = makeFinite(tetra, j);
  const anchor = tetraFiniteAnchor(j);
  return [
    {
      name: "tetra infinite (plane y=0)",
      error: (p) => Math.abs(p[1]),
      scene: tetra,
      preview: {
        de: (p) =>
          estimateSph(tetra, [...p], FUDGE, makeSphScratch(3, tetra.foldCap)),
        boundingRadius: 4,
        boundingCenter: [0, 0, 0],
        target: [0, 0, 0],
        eyeOffset: [0.8, 1.4, 0.9],
        zoom: 0.5,
        stepScale: 1,
        fog: false,
      },
    },
    {
      name: "tetra finite (analytic sphere)",
      error: (p) =>
        Math.abs(
          Math.hypot(
            p[0] - anchor.c[0],
            p[1] - anchor.c[1],
            p[2] - anchor.c[2],
          ) - anchor.r,
        ),
      scene: finite,
      preview: {
        de: (p) =>
          estimateSph(finite, [...p], FUDGE, makeSphScratch(3, finite.foldCap)),
        boundingRadius: anchor.r * 1.35,
        boundingCenter: [...anchor.c] as Vec3,
        target: [...anchor.c] as Vec3,
        eyeOffset: [0.9, 0.7, 1.1],
        zoom: 0.55,
        stepScale: 1,
        fog: false,
      },
    },
  ];
}

// ------------------------------------------------- (d) the orbit cross-check

function orbitSpheres(scene: SphScene, depth: number): HSphere[] {
  const out: HSphere[] = [...scene.seeds];
  let level: { b: HSphere; last: number }[] = scene.seeds.map((b) => ({
    b,
    last: -1,
  }));
  for (let d = 1; d <= depth; d++) {
    const next: { b: HSphere; last: number }[] = [];
    for (const { b, last } of level) {
      scene.foldFaces.forEach(({ face: f }, fi) => {
        if (fi === last) return;
        if (f.kind !== "sphere") return;
        const img = invertSphere(f.sphere, b);
        if (img.kind !== "sphere") return;
        next.push({ b: img.sphere, last: fi });
        out.push(img.sphere);
      });
    }
    level = next;
    if (level.length === 0) break;
  }
  return out;
}

function orbitSDF(spheres: HSphere[], p: Vec3): number {
  let best = Infinity;
  for (const b of spheres) {
    const d = Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]) - b.r;
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------- (e) the Points stance

/** Inverse-iteration clouds: a random walk over the face group vs a
 * depth-pruned DFS, scattered onto the limit set. Splat orthographically
 * into a PNG — these panels do not go through the DE marcher. */
function splatCloud(
  points: Float32Array,
  count: number,
  size: number,
  fileName: string,
): void {
  const rgb = new Uint8Array(size * size * 3);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    lo = Math.min(lo, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    hi = Math.max(hi, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  }
  const scale = (size * 0.42) / Math.max(1e-9, Math.abs(hi - lo) / 2 || 1);
  const cx = (lo + hi) / 2;
  const density = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    const x = Math.round((points[i * 3] - cx) * scale + size / 2);
    const y = Math.round((points[i * 3 + 2] - cx) * scale + size / 2);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    density[y * size + x] += 1;
  }
  let max = 0;
  for (const v of density) max = Math.max(max, v);
  for (let i = 0; i < size * size; i++) {
    const v = density[i] / max;
    const g = Math.pow(v, 0.35);
    rgb[i * 3] = Math.round(255 * g);
    rgb[i * 3 + 1] = Math.round(255 * g * 0.92);
    rgb[i * 3 + 2] = Math.round(255 * g * 0.75);
  }
  const out = `scripts/out/${fileName}`;
  writeFileSync(out, encodePng(size, size, rgb));
  console.log(`    wrote ${out}`);
}

function randomWalkCloud(
  scene: SphScene,
  n: number,
  steps: number,
): Float32Array {
  const rng = mulberry32(0x5eed_e5ca);
  const out = new Float32Array(n * 3);
  const scratch = makeSphScratch(scene.dim, 1);
  const p = [0.2, 0.2, 0.2];
  let written = 0;
  for (let i = 0; i < n * 4 && written < n; i++) {
    // One inverse-iteration step: invert in a random face sphere.
    const spheres = scene.foldFaces.filter(
      ({ face }) => face.kind === "sphere",
    );
    const f = spheres[Math.floor(rng() * spheres.length)].face as {
      kind: "sphere";
      sphere: HSphere;
    };
    const q = invertPoint(f.sphere, p);
    p[0] = q[0];
    p[1] = q[1];
    p[2] = q[2];
    if (i < 100) continue;
    // Keep points near the limit set: the fold from here must be deep.
    foldQuery(scene, p, scratch);
    if (scratch.moves < steps) continue;
    out[written * 3] = p[0];
    out[written * 3 + 1] = p[1];
    out[written * 3 + 2] = p[2];
    written++;
  }
  return out.subarray(0, written * 3);
}

// =============================================================== the tests

describe("sphairahedron look study", () => {
  it("renders the finite quasi-sphere sheet", async () => {
    await renderRows(
      "(a) finite quasi-spheres",
      BEAUTY_ROWS,
      SIZE,
      "sphairahedron-finite.png",
      4,
    );
  }, 900_000);

  it("renders the terrain sheet", async () => {
    await renderRows(
      "(b) prism type 2 terrains",
      TERRAIN_ROWS,
      SIZE,
      "sphairahedron-terrain.png",
      3,
    );
  }, 900_000);

  it("renders the anchor sheet and measures anchor exactness", async () => {
    await renderRows(
      "(c) analytic anchors",
      ANCHOR_ROWS,
      SIZE,
      "sphairahedron-anchor.png",
      3,
    );
    // The anchors' exactness: march rays, then BISECT the DE's sign
    // crossing so the marching bias (fudge x pixel-eps) is refined away;
    // the surviving error is the estimator's zero set itself.
    const checks = buildAnchors();
    for (const check of checks) {
      const size = 140;
      const stats = renderPreview({ ...check.preview, collect: true }, size);
      const scene = check.scene;
      const scratch = makeSphScratch(3, scene.foldCap);
      const de = (p: Vec3) => estimateSph(scene, [...p], FUDGE, scratch);
      const eye: Vec3 = check.preview.eye
        ? [...check.preview.eye]
        : [
            (check.preview.target ?? [0, 0, 0])[0] +
              (check.preview.eyeOffset ?? [1.55, 1.1, 1.8])[0] *
                (check.preview.boundingRadius ?? 1),
            (check.preview.target ?? [0, 0, 0])[1] +
              (check.preview.eyeOffset ?? [1.55, 1.1, 1.8])[1] *
                (check.preview.boundingRadius ?? 1),
            (check.preview.target ?? [0, 0, 0])[2] +
              (check.preview.eyeOffset ?? [1.55, 1.1, 1.8])[2] *
                (check.preview.boundingRadius ?? 1),
          ];
      const tgt = [...(check.preview.target ?? [0, 0, 0])] as Vec3;
      let n = 0;
      let maxErr = 0;
      let sumSq = 0;
      for (let py = 2; py < size; py += 2) {
        for (let px = 2; px < size; px += 2) {
          if (stats.status![py * size + px] !== 1) continue;
          // Recreate the ray (de-preview's convention).
          const u = ((px + 0.5) / size) * 2 - 1;
          const v = 1 - ((py + 0.5) / size) * 2;
          const zoom = check.preview.zoom ?? 0.55;
          const fwd = norm3(sub3(tgt, eye));
          const right = norm3(cross3(fwd, [0, 1, 0]));
          const up = cross3(right, fwd);
          const dir = norm3([
            fwd[0] + zoom * (u * right[0] + v * up[0]),
            fwd[1] + zoom * (u * right[1] + v * up[1]),
            fwd[2] + zoom * (u * right[2] + v * up[2]),
          ]);
          // Bracket the DE's sign change around the coarse hit: the hit
          // may have fired with d still positive (the fudge-scaled value
          // under the pixel epsilon), so walk to a real sign change.
          const hitP: Vec3 = [
            stats.hitPos![py * size * 3 + px * 3],
            stats.hitPos![py * size * 3 + px * 3 + 1],
            stats.hitPos![py * size * 3 + px * 3 + 2],
          ];
          let tHi =
            (hitP[0] - eye[0]) * dir[0] +
            (hitP[1] - eye[1]) * dir[1] +
            (hitP[2] - eye[2]) * dir[2];
          const at = (t: number): Vec3 => [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          let step = 1e-3;
          if (de(at(tHi)) > 0) {
            let t = tHi;
            for (let k = 0; k < 60 && de(at(t)) > 0; k++)
              t += step * (k + 1) * 2;
            tHi = t;
            step = 1e-3;
          }
          let tLo = tHi;
          for (let k = 0; k < 60 && de(at(tLo)) <= 0; k++) {
            tLo -= step;
            step *= 1.6;
          }
          if (!(de(at(tLo)) > 0 && de(at(tHi)) <= 0)) continue;
          for (let k = 0; k < 48; k++) {
            const tm = (tLo + tHi) / 2;
            if (de(at(tm)) > 0) tLo = tm;
            else tHi = tm;
          }
          const pm: Vec3 = [
            eye[0] + dir[0] * ((tLo + tHi) / 2),
            eye[1] + dir[1] * ((tLo + tHi) / 2),
            eye[2] + dir[2] * ((tLo + tHi) / 2),
          ];
          const e = check.error(pm);
          if (Number.isFinite(e)) {
            n++;
            maxErr = Math.max(maxErr, e);
            sumSq += e * e;
          }
        }
      }
      console.log(
        `    ANCHOR ${check.name}: rays ${n} rms ${n ? Math.sqrt(sumSq / n).toExponential(2) : "-"} max ${maxErr.toExponential(2)}`,
      );
    }
  }, 900_000);

  it("cross-checks the fold DE against the seed-ball orbit", () => {
    // The factory's own J and framing — the cross-check must judge the
    // same object the beauty panels show.
    const { scene: finite, preview: foldPreview } = buildSceneFull({
      kind: "cube1",
      zb: 0.5,
      zc: 1.0,
      inversion: { mode: "reference" },
      depthColor: true,
      fog: false,
    });
    const size = Math.min(SIZE, 200);
    const stats = renderPreview({ ...foldPreview, collect: true }, size);
    const hits: Vec3[] = [];
    for (let i = 0; i < stats.status!.length; i++) {
      if (stats.status![i] !== 1) continue;
      hits.push([
        stats.hitPos![i * 3],
        stats.hitPos![i * 3 + 1],
        stats.hitPos![i * 3 + 2],
      ]);
    }
    console.log(`    fold-DE hit points: ${hits.length}`);
    let prevMean = Infinity;
    for (const depth of [2, 3, 4]) {
      const spheres = orbitSpheres(finite, depth);
      let sum = 0;
      let maxAbs = 0;
      for (const p of hits) {
        const e = orbitSDF(spheres, p);
        sum += e;
        maxAbs = Math.max(maxAbs, Math.abs(e));
      }
      const mean = sum / hits.length;
      console.log(
        `    depth ${depth}: ${spheres.length} spheres, mean orbit-dist ${mean.toExponential(2)}, max ${maxAbs.toExponential(2)}`,
      );
      if (depth >= 3) {
        if (!(mean < prevMean))
          throw new Error(
            `orbit distance did not converge downward: depth ${depth - 1} mean ${prevMean.toExponential(2)} vs depth ${depth} ${mean.toExponential(2)}`,
          );
      }
      prevMean = mean;
    }
    // The rendered comparison sheet at depth 3.
    const spheres3 = orbitSpheres(finite, 3);
    const orbitPreview: PreviewScene = {
      ...foldPreview,
      de: (p) => orbitSDF(spheres3, p) - 0.004,
    };
    const orbitStats = renderPreview(orbitPreview, size);
    const file = writeLabeledContactSheet(
      [
        {
          stats: orbitStats,
          lines: ["SEED-BALL ORBIT D3", `${spheres3.length} spheres`],
        },
        { stats, lines: ["FOLD DE (FUDGE 0.2)", "same pose"] },
      ],
      2,
      "sphairahedron-orbit.png",
    );
    console.log(`    wrote ${file}`);
  }, 900_000);

  it("measures the fold: termination, cost, and the cap", () => {
    const built = buildSceneFull({
      kind: "cube1",
      zb: 0.5,
      zc: 1.0,
      inversion: { mode: "reference" },
      fog: false,
    });
    const finite = built.scene;
    const rng = mulberry32(0xabcd_1234);
    const scratch = makeSphScratch(3, finite.foldCap);
    // Sample the framing ball; bucket the fold depth of each query.
    const buckets = new Array<number>(finite.foldCap + 2).fill(0);
    let capped = 0;
    let checks = 0;
    const R = finite.bound.radius;
    const C = finite.bound.center;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const p = [
        C[0] + (rng() * 2 - 1) * R,
        C[1] + (rng() * 2 - 1) * R,
        C[2] + (rng() * 2 - 1) * R,
      ];
      foldQuery(finite, p, scratch);
      checks += scratch.checks;
      if (scratch.capped) capped++;
      buckets[Math.min(scratch.moves, finite.foldCap + 1)]++;
    }
    console.log(
      `    FOLD DEPTH HISTOGRAM (moves per query, ${N} samples in the framing ball):`,
    );
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] === 0) continue;
      const tag = i > finite.foldCap ? " (capped)" : "";
      console.log(
        `      ${String(i).padStart(3)}${tag}: ${buckets[i]} (${((100 * buckets[i]) / N).toFixed(2)}%)`,
      );
    }
    console.log(
      `    capped ${((100 * capped) / N).toFixed(2)}%; ${(checks / N).toFixed(1)} face-checks/query`,
    );
    // Fold depths AT THE SURFACE: hit points from a rendered panel, where
    // the marching actually spends its time.
    const stats = renderPreview({ ...built.preview, collect: true }, 160);
    const surface = new Array<number>(finite.foldCap + 2).fill(0);
    let surfaceN = 0;
    for (let i = 0; i < stats.status!.length; i++) {
      if (stats.status![i] !== 1) continue;
      const p: Vec3 = [
        stats.hitPos![i * 3],
        stats.hitPos![i * 3 + 1],
        stats.hitPos![i * 3 + 2],
      ];
      foldQuery(finite, [...p], scratch);
      surface[Math.min(scratch.moves, finite.foldCap + 1)]++;
      surfaceN++;
    }
    console.log(
      `    SURFACE FOLD DEPTHS (${surfaceN} hit points): ` +
        Array.from({ length: finite.foldCap + 2 }, (_, i) =>
          surface[i] > 0
            ? `${i > finite.foldCap ? "cap" : i}: ${((100 * surface[i]) / surfaceN).toFixed(1)}%`
            : null,
        )
          .filter(Boolean)
          .join(", "),
    );
    // DE cost: an eval = fold + tile SDF, at surface points.
    const deScratch = makeSphScratch(3, finite.foldCap);
    const hitIdx: number[] = [];
    for (let i = 0; i < stats.status!.length; i++)
      if (stats.status![i] === 1) hitIdx.push(i);
    const t1 = performance.now();
    let acc = 0;
    const reps = 40;
    for (let r = 0; r < reps; r++) {
      for (const i of hitIdx) {
        const p: Vec3 = [
          stats.hitPos![i * 3],
          stats.hitPos![i * 3 + 1],
          stats.hitPos![i * 3 + 2],
        ];
        acc += estimateSph(finite, p, FUDGE, deScratch);
      }
    }
    const usPerEval =
      ((performance.now() - t1) / (reps * hitIdx.length)) * 1000;
    console.log(
      `    DE eval at surface points: ${usPerEval.toFixed(1)}us (fold+tileSDF); a 256px frame at 200 steps/ray marches ~${((256 * 256 * 200 * usPerEval) / 1e6).toFixed(0)}s serial`,
    );
    void acc;
    // The fudge/step-scale sweep on the analytic anchor: cost vs bias.
    const { scene: tetraInf } = buildSceneFull({
      kind: "tetra333",
      fog: false,
    });
    console.log(
      "    FUDGE SWEEP (tetra anchor, 140px; hit% X exhausted% steps/ray):",
    );
    for (const fudge of [0.05, 0.1, 0.2, 0.4, 0.8]) {
      const preview: PreviewScene = {
        de: (p) =>
          estimateSph(
            tetraInf,
            [...p],
            fudge,
            makeSphScratch(3, tetraInf.foldCap),
          ),
        boundingRadius: 4,
        boundingCenter: [0, 0, 0],
        target: [0, 0, 0],
        eyeOffset: [0.8, 1.4, 0.9],
        zoom: 0.5,
        stepScale: 1,
        fog: false,
      };
      const st = renderPreview(preview, 140);
      console.log(
        `      fudge ${fudge.toFixed(2)}: H${pct(st.hits, 140)}% X${pct(st.exhausted, 140)}% S${(st.steps / (140 * 140)).toFixed(1)}`,
      );
    }
  }, 900_000);

  it("renders the Points-stance clouds", () => {
    const built = buildSphairahedron({
      dim: 3,
      kind: "cube1",
      params: "(0.5, 1.0)",
      ws: wallSystem333(0.5),
      balls: [
        {
          corner: [0, 1],
          height: 0,
          theta: [Math.PI / 3, Math.PI / 3],
          name: "b2",
        },
        {
          corner: [0, 2],
          height: 0.5,
          theta: [Math.PI / 3, Math.PI / 3],
          name: "b4",
        },
        {
          corner: [1, 2],
          height: 1.0,
          theta: [Math.PI / 3, Math.PI / 3],
          name: "b6",
        },
      ],
    });
    const scene = makeFinite(built.scene, {
      c: [1 / 6, -1, -Math.sqrt(3) / 6],
      r: 2 / 3,
    });
    const walk = randomWalkCloud(scene, 120000, 24);
    // Sanity: cloud points must sit ON the limit set — the fold DE's
    // value there must be ~0.
    const scratch = makeSphScratch(3, scene.foldCap);
    let maxAbs = 0;
    let sum = 0;
    const probeN = 2000;
    for (let i = 0; i < probeN; i++) {
      const k = Math.floor((i * walk.length) / 3 / probeN) * 3;
      const p: Vec3 = [walk[k], walk[k + 1], walk[k + 2]];
      const v = estimateSph(scene, p, FUDGE, scratch);
      maxAbs = Math.max(maxAbs, Math.abs(v));
      sum += Math.abs(v);
    }
    console.log(
      `    CLOUD ON-SET CHECK: mean |de| ${(sum / probeN).toExponential(2)}, max ${maxAbs.toExponential(2)} over ${probeN} points`,
    );
    splatCloud(
      walk,
      walk.length / 3,
      Math.min(SIZE, 240),
      "sphairahedron-points.png",
    );
    void sphContains;
    void tileSDF;
  }, 900_000);

  it("renders the 4D stance panel (the tetra lift, sliced)", async () => {
    await renderRows(
      "(f) 4D tetra lift through the dimension-agnostic loop",
      [
        {
          label: "TETRA4 FINITE w0=0",
          sub: "slice of the analytic 3-sphere",
          spec: {
            kind: "tetra4",
            inversion: { mode: "explicit", c: [0.5, 3, 0], r: 1.3 },
            depthColor: true,
            fog: false,
            eyeOffset: [0.8, 1.4, 0.9],
            zoom: 0.5,
          },
        },
        {
          label: "TETRA4 FINITE w0=0.15",
          sub: "off-plane slice",
          spec: {
            kind: "tetra4",
            inversion: { mode: "explicit", c: [0.5, 3, 0], r: 1.3 },
            w0: 0.15,
            depthColor: true,
            fog: false,
            eyeOffset: [0.8, 1.4, 0.9],
            zoom: 0.5,
          },
        },
      ],
      SIZE,
      "sphairahedron-4d.png",
      2,
    );
    // The 4D anchor: the slice's zero set is the analytic 2-sphere (the
    // 3-sphere's section), measured with the same bisection as 3D.
    const built4 = buildSceneFull({
      kind: "tetra4",
      inversion: { mode: "explicit", c: [0.5, 3, 0], r: 1.3 },
      fog: false,
    });
    const finite4 = built4.scene;
    const d4 = 3;
    const k4 = (1.3 * 1.3) / (2 * d4);
    const c4: number[] = [0.5, 3 - k4, 0, 0];
    const r4 = Math.abs(k4);
    for (const w0 of [0, 0.15]) {
      const scratch = makeSphScratch(4, finite4.foldCap);
      const de = (p: Vec3) =>
        estimateSph(finite4, [p[0], p[1], p[2], w0], FUDGE, scratch);
      const size = 140;
      const stats = renderPreview({ ...built4.preview, collect: true }, size);
      const eye = [...(built4.preview.eye ?? [0, 0, 0])] as Vec3;
      const tgt = [...(built4.preview.target ?? [0, 0, 0])] as Vec3;
      const zoom = built4.preview.zoom ?? 0.55;
      let n = 0;
      let maxErr = 0;
      let sumSq = 0;
      for (let py = 2; py < size; py += 2) {
        for (let px = 2; px < size; px += 2) {
          if (stats.status![py * size + px] !== 1) continue;
          const u = ((px + 0.5) / size) * 2 - 1;
          const v = 1 - ((py + 0.5) / size) * 2;
          const fwd = norm3(sub3(tgt, eye));
          const right = norm3(cross3(fwd, [0, 1, 0]));
          const up = cross3(right, fwd);
          const dir = norm3([
            fwd[0] + zoom * (u * right[0] + v * up[0]),
            fwd[1] + zoom * (u * right[1] + v * up[1]),
            fwd[2] + zoom * (u * right[2] + v * up[2]),
          ]);
          const hitP: Vec3 = [
            stats.hitPos![py * size * 3 + px * 3],
            stats.hitPos![py * size * 3 + px * 3 + 1],
            stats.hitPos![py * size * 3 + px * 3 + 2],
          ];
          let tHi =
            (hitP[0] - eye[0]) * dir[0] +
            (hitP[1] - eye[1]) * dir[1] +
            (hitP[2] - eye[2]) * dir[2];
          const at = (t: number): Vec3 => [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          let step = 1e-3;
          if (de(at(tHi)) > 0) {
            let t = tHi;
            for (let k = 0; k < 60 && de(at(t)) > 0; k++)
              t += step * (k + 1) * 2;
            tHi = t;
          }
          let tLo = tHi;
          step = 1e-3;
          for (let k = 0; k < 60 && de(at(tLo)) <= 0; k++) {
            tLo -= step;
            step *= 1.6;
          }
          if (!(de(at(tLo)) > 0 && de(at(tHi)) <= 0)) continue;
          for (let k = 0; k < 48; k++) {
            const tm = (tLo + tHi) / 2;
            if (de(at(tm)) > 0) tLo = tm;
            else tHi = tm;
          }
          const pm: Vec3 = [
            eye[0] + dir[0] * ((tLo + tHi) / 2),
            eye[1] + dir[1] * ((tLo + tHi) / 2),
            eye[2] + dir[2] * ((tLo + tHi) / 2),
          ];
          const e = Math.abs(
            Math.hypot(
              pm[0] - c4[0],
              pm[1] - c4[1],
              pm[2] - c4[2],
              w0 - c4[3],
            ) - r4,
          );
          n++;
          maxErr = Math.max(maxErr, e);
          sumSq += e * e;
        }
      }
      console.log(
        `    4D ANCHOR w0=${w0}: rays ${n} rms ${n ? Math.sqrt(sumSq / n).toExponential(2) : "-"} max ${maxErr.toExponential(2)}`,
      );
    }
  }, 900_000);
});
