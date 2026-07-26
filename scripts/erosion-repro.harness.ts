/**
 * fr-z70m measurement harness: view-dependent erosion in the 3D surface
 * render (sierpinski tetra + menger sponge screenshots: geometry on one
 * side of the frame dissolved into dropout speckle while the rest stayed
 * crisp). Mirrors the GLSL march loop (`surface-material.ts` main():
 * sphere gate, cone eps, empty-space grid skip, budgets, stepScale) on
 * the CPU against the tested oracles.
 *
 * MEASURED VERDICT (drove the shipped fix). The DE, the fr-55r5/fr-zkt2
 * exits and the grid floors are all sound — (A) found 0 violations of the
 * true distance in 14k+ cell samples (the 65/12 sub-floor FULL-DESCENT
 * values are DE looseness at off-center points, exactly the conservatism
 * the validity chain allows), and (B) found 0 cutoff-contract mismatches.
 * The erosion is pure MARCH-BUDGET EXHAUSTION: rays that thread gaps in
 * near geometry or graze a face need many small steps, and fr-55r5's skip
 * loop charged every cheap grid skip (small by construction: the floor is
 * the cell-center DE minus the cell half-diagonal) against the same
 * 96-step budget as full descents, shrinking exactly those rays' reach —
 * (C)/(D) localize the loss to view-dependent bands and poses, matching
 * the screenshots. (E) sized the shipped budgets: separate whole-ray skip
 * cap 256 (worst measured ray: 189 skips; 512 changed nothing) + full-tier
 * march budget 96 -> 160 took the worst-pose loss from 44/5508 true hits
 * (0.80%) to 0 on sierpinski and 65/24418 (0.27%) to 5 (0.02%) on menger,
 * with the march unchanged until the old loop's exhaustion point.
 *
 *  (A) GRID VALIDITY: stored floors vs the full-descent DE at random
 *      in-cell points, and every sub-floor DE value re-checked against a
 *      200k-point chaos cloud's nearest distance (a true violation must
 *      beat the cloud too, since the cloud only overstates distance).
 *  (B) CUTOFF CONTRACT: hit verdicts of `estimateDistanceRefined(p, eps)`
 *      vs the full `estimateDistanceRefined(p, 0)` must agree.
 *  (C) MARCH MASKS: hit masks at four azimuths x (gridless/grid x budget)
 *      vs unbounded truth, losses bucketed by screen column.
 *  (D) POSE SEARCH: sweep theta/phi/radius for the worst budget-starved
 *      pose per system; prints CameraPose JSON for browser repro (feed to
 *      scripts/erosion-browser.mjs).
 *  (E) BUDGET TABLE: old shared-budget loop vs the split-budget fix
 *      across step/skip-cap combinations at the worst poses.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts scripts/erosion-repro.harness.ts
 */
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import { buildSurfaceGrid } from "../src/fractal/surface-grid";
import type { SurfaceGrid } from "../src/fractal/surface-grid";
import { runChaosGame } from "../src/fractal/chaos-game";
import { mengerSponge, sierpinskiTetrahedron } from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import type { Vec3 } from "../src/fractal/types";

const FULL_HIT_FLOOR = 1.0e-5; // SURFACE_FULL_HIT_FLOOR
const FULL_MARCH_STEPS = 96; // SURFACE_FULL_MARCH_STEPS

interface MarchResult {
  hit: boolean;
  t: number;
  steps: number;
  gridSkips: number;
  budgetExhausted: boolean;
}

/** NEAREST + clamp-to-edge sample of the grid, mirroring the GLSL
 * `texture(uGridTex, p * uGridInvSpan + 0.5)` with NearestFilter. */
function sampleGrid(grid: SurfaceGrid, p: Vec3): number {
  const res = grid.resolution;
  const inv = 1 / (2 * grid.halfExtent);
  let xi = Math.floor((p[0] * inv + 0.5) * res);
  let yi = Math.floor((p[1] * inv + 0.5) * res);
  let zi = Math.floor((p[2] * inv + 0.5) * res);
  xi = xi < 0 ? 0 : xi >= res ? res - 1 : xi;
  yi = yi < 0 ? 0 : yi >= res ? res - 1 : yi;
  zi = zi < 0 ? 0 : zi >= res ? res - 1 : zi;
  return grid.values[xi + res * (yi + res * zi)];
}

/** The GLSL main() march, minus shading: sphere gate, cone-eps hit test,
 * optional grid skip, budget, stepScale. Dither omitted (sub-epsilon).
 * `separateSkipBudget` mirrors the fr-z70m fix (skips drain their own
 * whole-ray cap instead of uMarchSteps); false replays the shipped
 * fr-55r5 loop where every skip consumed an analytic march step. */
function march(
  de: SurfaceDE,
  grid: SurfaceGrid | null,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
  separateSkipBudget = false,
  skipCap = 256,
): MarchResult {
  const radius = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  const out: MarchResult = {
    hit: false,
    t: 0,
    steps: 0,
    gridSkips: 0,
    budgetExhausted: false,
  };
  if (disc < 0) return out;
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return out;
  let t = Math.max(-b - sq, 0);
  const p: Vec3 = [0, 0, 0];
  let skipsLeft = skipCap;
  let i = 0;
  outer: for (; i < maxSteps; i++) {
    if (t > tFar) break;
    let eps = Math.max(pixelEps * t, de.boundingRadius * FULL_HIT_FLOOR);
    p[0] = ro[0] + rd[0] * t;
    p[1] = ro[1] + rd[1] * t;
    p[2] = ro[2] + rd[2] * t;
    if (grid) {
      if (separateSkipBudget) {
        // fr-z70m loop: drain consecutive skips against skipsLeft.
        for (; skipsLeft > 0; skipsLeft--) {
          const g = sampleGrid(grid, p);
          if (g <= eps) break;
          out.gridSkips++;
          t += g * de.stepScale;
          if (t > tFar) break outer;
          eps = Math.max(pixelEps * t, de.boundingRadius * FULL_HIT_FLOOR);
          p[0] = ro[0] + rd[0] * t;
          p[1] = ro[1] + rd[1] * t;
          p[2] = ro[2] + rd[2] * t;
        }
      } else {
        // Shipped fr-55r5 loop: one skip consumes this march step.
        const g = sampleGrid(grid, p);
        if (g > eps) {
          t += g * de.stepScale;
          out.gridSkips++;
          continue;
        }
      }
    }
    const d = estimateDistanceRefined(de, p, eps);
    if (d < eps) {
      out.hit = true;
      out.t = t;
      out.steps = i + 1;
      return out;
    }
    t += d * de.stepScale;
  }
  out.steps = i;
  out.budgetExhausted = i >= maxSteps && t <= tFar;
  return out;
}

/** The app's real pixel footprint: fov 60, ~1050px-tall drawing buffer —
 * DECOUPLED from the harness's coarse ray raster, which only decides how
 * many rays we probe, not how fine the hit test is. */
const APP_PIXEL_EPS = (2 * Math.tan((60 * Math.PI) / 360)) / 1050;

/** Camera at azimuth deg (0 = +Z looking at origin), elevation ~15deg,
 * distance 2.4 * visibleR — approximately the app's framed orbit view. */
function cameraRays(
  de: SurfaceDE,
  azimuthDeg: number,
  width: number,
  height: number,
  distFactor = 2.4,
): { ro: Vec3; rays: Vec3[]; pixelEps: number } {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (15 * Math.PI) / 180;
  const dist = distFactor * de.visibleBoundingRadius;
  const ro: Vec3 = [
    dist * Math.cos(el) * Math.sin(az),
    dist * Math.sin(el),
    dist * Math.cos(el) * Math.cos(az),
  ];
  // Look-at basis (target origin, up +Y).
  const fwd = normalize([-ro[0], -ro[1], -ro[2]]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const fov = (60 * Math.PI) / 180;
  const tanHalf = Math.tan(fov / 2);
  const aspect = width / height;
  const rays: Vec3[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const ndcY = 1 - ((y + 0.5) / height) * 2;
      const dx = ndcX * tanHalf * aspect;
      const dy = ndcY * tanHalf;
      rays.push(
        normalize([
          fwd[0] + right[0] * dx + up[0] * dy,
          fwd[1] + right[1] * dx + up[1] * dy,
          fwd[2] + right[2] * dx + up[2] * dy,
        ]),
      );
    }
  }
  return { ro, rays, pixelEps: APP_PIXEL_EPS };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

interface MaskStats {
  hits: number;
  lostVsTruth: number;
  gainedVsTruth: number;
  exhausted: number;
  colLost: number[]; // lost hits bucketed into 12 columns
}

function compareMasks(
  truth: MarchResult[],
  probe: MarchResult[],
  width: number,
  height: number,
): MaskStats {
  const buckets = 12;
  const colLost = new Array<number>(buckets).fill(0);
  let hits = 0;
  let lost = 0;
  let gained = 0;
  let exhausted = 0;
  for (let i = 0; i < probe.length; i++) {
    if (probe[i].hit) hits++;
    if (probe[i].budgetExhausted) exhausted++;
    if (truth[i].hit && !probe[i].hit) {
      lost++;
      const x = i % width;
      colLost[Math.min(buckets - 1, Math.floor((x / width) * buckets))]++;
    } else if (!truth[i].hit && probe[i].hit) {
      gained++;
    }
  }
  void height;
  return { hits, lostVsTruth: lost, gainedVsTruth: gained, exhausted, colLost };
}

function asciiLossMap(
  truth: MarchResult[],
  probe: MarchResult[],
  width: number,
  height: number,
): string {
  // Downsample to 80 x 40: '#' = truth-hit kept, 'x' = truth-hit LOST,
  // '+' = gained (probe hit where truth missed), '.' = empty.
  const ow = 80;
  const oh = 40;
  const lines: string[] = [];
  for (let oy = 0; oy < oh; oy++) {
    let line = "";
    for (let ox = 0; ox < ow; ox++) {
      let kept = 0;
      let lost = 0;
      let gained = 0;
      const x0 = Math.floor((ox / ow) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) / ow) * width));
      const y0 = Math.floor((oy / oh) * height);
      const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) / oh) * height));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          if (truth[i].hit && probe[i].hit) kept++;
          else if (truth[i].hit) lost++;
          else if (probe[i].hit) gained++;
        }
      }
      line +=
        lost > 0 && lost >= kept
          ? "x"
          : lost > 0
            ? "o"
            : gained > 0
              ? "+"
              : kept > 0
                ? "#"
                : ".";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Camera from an explicit orbit pose (target/radius/theta/phi), matching
 * orbit.ts's sphericalToCartesian convention. */
function poseRays(
  de: SurfaceDE,
  target: Vec3,
  radius: number,
  theta: number,
  phi: number,
  width: number,
  height: number,
): { ro: Vec3; rays: Vec3[]; pixelEps: number } {
  void de;
  const ro: Vec3 = [
    target[0] + radius * Math.sin(phi) * Math.sin(theta),
    target[1] + radius * Math.cos(phi),
    target[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
  const fwd = normalize([
    target[0] - ro[0],
    target[1] - ro[1],
    target[2] - ro[2],
  ]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const fov = (60 * Math.PI) / 180;
  const tanHalf = Math.tan(fov / 2);
  const aspect = width / height;
  const rays: Vec3[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const ndcY = 1 - ((y + 0.5) / height) * 2;
      const dx = ndcX * tanHalf * aspect;
      const dy = ndcY * tanHalf;
      rays.push(
        normalize([
          fwd[0] + right[0] * dx + up[0] * dy,
          fwd[1] + right[1] * dx + up[1] * dy,
          fwd[2] + right[2] * dx + up[2] * dy,
        ]),
      );
    }
  }
  return { ro, rays, pixelEps: APP_PIXEL_EPS };
}

describe("fr-z70m erosion repro", () => {
  const systems = [
    { label: "sierpinski", transforms: sierpinskiTetrahedron() },
    { label: "menger", transforms: mengerSponge() },
  ];

  it("A: grid floors vs the full-descent DE AND vs true distance", () => {
    for (const sys of systems) {
      const de = buildSurfaceDE(sys.transforms);
      const grid = buildSurfaceGrid(de, 48);
      const res = grid.resolution;
      const cell = (2 * grid.halfExtent) / res;
      // Ground-truth-ish: nearest sampled attractor point. The cloud is a
      // SUBSET of the attractor, so nearestCloud >= dist_true — a floor
      // above nearestCloud is definitely NOT above dist_true... the other
      // way: stored > nearestCloud(p) PROVES stored > dist_true(p) is
      // possible only if nearestCloud ~ dist_true; a large cloud makes the
      // gap small. stored > nearestCloud + slack = a TRUE violation
      // (nearestCloud only overstates the true distance).
      const cloudN = 200_000;
      const cloud = runChaosGame(sys.transforms, cloudN, mulberry32(4242));
      const pts = cloud.positions;
      const nearest = (p: Vec3): number => {
        let best = Infinity;
        for (let i = 0; i < pts.length; i += 3) {
          const dx = pts[i] - p[0];
          const dy = pts[i + 1] - p[1];
          const dz = pts[i + 2] - p[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) best = d2;
        }
        return Math.sqrt(best);
      };
      const rng = mulberry32(0xabc123);
      let checked = 0;
      let deLoose = 0;
      let trueViolations = 0;
      let worstDe = 0;
      let worstTrue = 0;
      for (let n = 0; n < 4000; n++) {
        const xi = Math.floor(rng() * res);
        const yi = Math.floor(rng() * res);
        const zi = Math.floor(rng() * res);
        const stored = grid.values[xi + res * (yi + res * zi)];
        if (stored <= 0) continue;
        for (let s = 0; s < 4; s++) {
          const p: Vec3 = [
            -grid.halfExtent + (xi + rng()) * cell,
            -grid.halfExtent + (yi + rng()) * cell,
            -grid.halfExtent + (zi + rng()) * cell,
          ];
          const d = estimateDistanceRefined(de, p, 0);
          checked++;
          if (d < stored - 1e-9) {
            deLoose++;
            worstDe = Math.max(worstDe, stored - d);
            const dTrue = nearest(p);
            if (dTrue < stored - 1e-9) {
              trueViolations++;
              worstTrue = Math.max(worstTrue, stored - dTrue);
            }
          }
        }
      }
      console.log(
        `A ${sys.label}: checked=${checked} deLoose=${deLoose} ` +
          `worstDeGap=${worstDe.toExponential(3)} TRUEviolations=${trueViolations} ` +
          `worstTrueGap=${worstTrue.toExponential(3)} (R=${de.boundingRadius.toFixed(3)})`,
      );
    }
    expect(true).toBe(true);
  }, 600_000);

  it("B: cutoff hit verdicts match the full descent", () => {
    for (const sys of systems) {
      const de = buildSurfaceDE(sys.transforms);
      const rng = mulberry32(0x77aa11);
      let mismatches = 0;
      let checked = 0;
      for (let n = 0; n < 3000; n++) {
        const p: Vec3 = [
          (rng() * 2 - 1) * de.visibleBoundingRadius * 1.05,
          (rng() * 2 - 1) * de.visibleBoundingRadius * 1.05,
          (rng() * 2 - 1) * de.visibleBoundingRadius * 1.05,
        ];
        const eps = de.boundingRadius * (1e-4 + rng() * 5e-3);
        const full = estimateDistanceRefined(de, p, 0);
        const cut = estimateDistanceRefined(de, p, eps);
        checked++;
        if (full < eps !== cut < eps) mismatches++;
        // Contract: value at/above cutoff equals the full value.
        if (cut >= eps && cut !== full) mismatches++;
      }
      console.log(
        `B ${sys.label}: checked=${checked} mismatches=${mismatches}`,
      );
    }
    expect(true).toBe(true);
  }, 600_000);

  it("D: pose search — worst budget-exhaustion pose per system", () => {
    const W = 128;
    const H = 88;
    for (const sys of systems) {
      const de = buildSurfaceDE(sys.transforms);
      const grid = buildSurfaceGrid(de, 64);
      let worst = { lost: -1, theta: 0, phi: 0, radius: 0 };
      for (let ti = 0; ti < 16; ti++) {
        const theta = (ti / 16) * 2 * Math.PI;
        for (const phi of [1.35, 1.55, 1.75]) {
          for (const rf of [1.2, 1.4]) {
            const radius = rf * de.visibleBoundingRadius;
            const { ro, rays, pixelEps } = poseRays(
              de,
              [0, 0.2, 0],
              radius,
              theta,
              phi,
              W,
              H,
            );
            let lost = 0;
            let exhausted = 0;
            let fixedLost = 0;
            let maxSkips = 0;
            for (const rd of rays) {
              const withGrid = march(de, grid, ro, rd, pixelEps, 96);
              if (withGrid.budgetExhausted) exhausted++;
              const fixed = march(de, grid, ro, rd, pixelEps, 96, true);
              maxSkips = Math.max(maxSkips, fixed.gridSkips);
              if (!withGrid.hit || !fixed.hit) {
                const truth = march(de, grid, ro, rd, pixelEps, 4096);
                if (truth.hit && !withGrid.hit) lost++;
                if (truth.hit && !fixed.hit) fixedLost++;
              }
            }
            if (lost > worst.lost) worst = { lost, theta, phi, radius };
            if (lost > 0 || exhausted > W * H * 0.01) {
              console.log(
                `D ${sys.label} theta=${theta.toFixed(2)} phi=${phi} r=${radius.toFixed(2)}: ` +
                  `lost=${lost} exhausted=${exhausted} fixedLost=${fixedLost} ` +
                  `maxSkips=${maxSkips} of ${W * H}`,
              );
            }
          }
        }
      }
      console.log(
        `D ${sys.label} WORST: lost=${worst.lost} camera={"target":[0,0.2,0],` +
          `"radius":${worst.radius.toFixed(4)},"theta":${worst.theta.toFixed(4)},"phi":${worst.phi}}`,
      );
    }
    expect(true).toBe(true);
  }, 900_000);

  it("E: budget table at the worst poses", () => {
    const W = 200;
    const H = 140;
    const poses: Record<
      string,
      { radius: number; theta: number; phi: number }
    > = {
      sierpinski: { radius: 2.4831, theta: 3.927, phi: 1.75 },
      menger: { radius: 1.6101, theta: 5.8905, phi: 1.55 },
    };
    for (const sys of systems) {
      const de = buildSurfaceDE(sys.transforms);
      const grid = buildSurfaceGrid(de, 64);
      const pose = poses[sys.label];
      const { ro, rays, pixelEps } = poseRays(
        de,
        [0, 0.2, 0],
        pose.radius,
        pose.theta,
        pose.phi,
        W,
        H,
      );
      const truth = rays.map((rd) =>
        march(de, grid, ro, rd, pixelEps, 8192, true, 1 << 20),
      );
      const truthHits = truth.filter((r) => r.hit).length;
      console.log(`E ${sys.label} truthHits=${truthHits}/${W * H}`);
      const table: [string, number, boolean, number][] = [
        ["OLD    b96", 96, false, 256],
        ["fix b96/s256 ", 96, true, 256],
        ["fix b96/s512 ", 96, true, 512],
        ["fix b128/s512", 128, true, 512],
        ["fix b160/s512", 160, true, 512],
        ["gridless b96", 96, false, 0],
      ];
      for (const [label, steps, sep, cap] of table) {
        let lost = 0;
        let maxSkips = 0;
        rays.forEach((rd, i) => {
          const r = march(
            de,
            cap === 0 ? null : grid,
            ro,
            rd,
            pixelEps,
            steps,
            sep,
            cap,
          );
          maxSkips = Math.max(maxSkips, r.gridSkips);
          if (truth[i].hit && !r.hit) lost++;
        });
        console.log(
          `E ${sys.label} ${label}: lost=${lost} (${((100 * lost) / truthHits).toFixed(2)}%) maxSkips=${maxSkips}`,
        );
      }
    }
    expect(true).toBe(true);
  }, 900_000);

  it("C: march masks — grid/budget vs gridless truth at 4 azimuths", () => {
    const W = 220;
    const H = 150;
    for (const sys of systems) {
      const de = buildSurfaceDE(sys.transforms);
      const grid = buildSurfaceGrid(de, 64);
      console.log(
        `\n== ${sys.label}: R=${de.boundingRadius.toFixed(3)} visR=${de.visibleBoundingRadius.toFixed(3)} ` +
          `maxDepth=${de.maxDepth} stepScale=${de.stepScale} gridHalf=${grid.halfExtent.toFixed(3)}`,
      );
      for (const az of [0, 25, 90, 180, 270]) {
        const { ro, rays, pixelEps } = cameraRays(de, az, W, H, 1.25);
        const truth = rays.map((rd) => march(de, null, ro, rd, pixelEps, 4096));
        const configs: [string, SurfaceGrid | null, number][] = [
          ["gridless b96 ", null, FULL_MARCH_STEPS],
          ["grid     b96 ", grid, FULL_MARCH_STEPS],
          ["grid     b4k ", grid, 4096],
        ];
        const truthHits = truth.filter((r) => r.hit).length;
        console.log(`-- az=${az} truthHits=${truthHits}/${W * H}`);
        for (const [label, g, budget] of configs) {
          const probe = rays.map((rd) =>
            march(de, g, ro, rd, pixelEps, budget),
          );
          const stats = compareMasks(truth, probe, W, H);
          console.log(
            `   ${label}: hits=${stats.hits} lost=${stats.lostVsTruth} ` +
              `gained=${stats.gainedVsTruth} exhausted=${stats.exhausted} ` +
              `colLost=[${stats.colLost.join(",")}]`,
          );
          if (stats.lostVsTruth > truthHits * 0.002) {
            console.log(asciiLossMap(truth, probe, W, H));
          }
        }
      }
    }
    expect(true).toBe(true);
  }, 600_000);
});
