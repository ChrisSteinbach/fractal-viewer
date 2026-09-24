/**
 * THE CURVED-SOLID GLASS STARTERS AT THE APP'S OWN CAMERA AND RASTER, through
 * the kernel's f64 transport twin — the instrument that split the in-app
 * resolved share's gap from the look sheet's figure into "the f32 kernel"
 * and "what the kernel's trace does differently from the oracle's".
 *
 * `scripts/curved-solid-glass.verify.mjs` measured the Glass beads/rings
 * fractal starters in the built app at ~90% resolved; the look sheet
 * (`condensation-glass.harness.ts`) measured 97.6-100%. This sheet
 * reproduces the app's side: the starter's own document and saved camera,
 * a 960x540 pane's per-pixel cone (`max(pixelEps·t, SURFACE_GPU_HIT_FLOOR·R)`,
 * the kernel's march), the refined descent as the primary estimator, and
 * the kernel's replay schedule (failure-is-final, residual <= budget)
 * through `transportTraceCPU` over the closed-solid boundary query on the
 * f64 condensation field — the bench legs' own twin. A pixel STRIDE traces
 * a regular subset of that raster (the footprint stays the full pane's).
 *
 * THE VERDICT (docs/surface-dielectric-transport.md, "The resolved-share
 * gap"): the f64 twin reproduced the app's ~90% and its failure mix, so
 * the f32 kernel was not the gap; neither was the raster, the pose or the
 * display-estimator hand-off. Two kernel rules were: the forced primary
 * split at a silhouette near-miss (a whispering-gallery TIR orbit that
 * caps), and band crossings taken without a membership flip (phantoms in
 * the union's sub-eps gaps: inside-miss, state-mismatch). Both are now the
 * kernel's (and this twin's) rule for the curved solid.
 *
 * Switches, each restoring one PRE-FIX rule for the record:
 *   CGT_SPLIT=1   the forced primary split at the march's hit;
 *   CGT_NOGATE=1  no membership gate on band crossings.
 * And the instruments:
 *   CGT_PRIMARY=solid  march the primary ray on the solid field instead;
 *   CGT_VIEW=sheet     trace from the look sheet's pose;
 *   CGT_DUMP=<code>    print the query log of the first trace failing so.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/condensation-glass-app-twin.harness.ts
 * Env: CGT_STRIDE (default 4), CGT_STARTERS (default glass-beads,glass-rings),
 *      CGT_WIDTH/CGT_HEIGHT (960/540).
 */
import {
  createSurfaceTransmissionStarter,
  type SurfaceTransmissionStarterId,
} from "../src/app/surface-transmission-starters";
import {
  transportOpticalNormal,
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  type TransportFixtureSystem,
} from "../src/app/gpu-bench/surface-transport-fixture";
import {
  buildCondensationSolid3,
  condensationSolidSignedDistance3,
} from "../src/fractal/condensation-solid";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_ERROR_BUDGET,
  DIELECTRIC_IOR,
  DIELECTRIC_REPLAY_PASSES,
  dielectricReplayTheta,
  type DielectricMaterial,
} from "../src/fractal/surface-dielectric";
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS,
} from "../src/fractal/surface-de-gpu";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { Vec3 } from "../src/fractal/types";

const STRIDE = Number(process.env.CGT_STRIDE ?? 4);
const WIDTH = Number(process.env.CGT_WIDTH ?? 960);
const HEIGHT = Number(process.env.CGT_HEIGHT ?? 540);
const PRIMARY = (process.env.CGT_PRIMARY ?? "display") as "display" | "solid";
const VIEW = process.env.CGT_VIEW ?? "starter";
const SPLIT = process.env.CGT_SPLIT === "1";
const NOGATE = process.env.CGT_NOGATE === "1";
const DUMP = Number(process.env.CGT_DUMP ?? 0);
const STARTERS = (process.env.CGT_STARTERS ?? "glass-beads,glass-rings").split(
  ",",
) as SurfaceTransmissionStarterId[];
/** The full-tier march budget. */
const MARCH_STEPS = 160;
/** The look sheet's pose (`condensation-glass.harness.ts`'s VIEW). */
const SHEET_VIEW = {
  eye: [1.9, 1.1, 2.5] as Vec3,
  target: [0, -0.05, 0] as Vec3,
  zoom: 0.42,
};

/** The kernel's failure codes, named for the report. */
const FAILURE_NAMES: Record<number, string> = {
  1: "processed-cap",
  2: "interface-cap",
  3: "stack",
  4: "traversal",
  5: "inside-miss",
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const fmt = (v: readonly number[]) => v.map((x) => x.toFixed(5)).join(",");

function run(id: SurfaceTransmissionStarterId) {
  const snap = createSurfaceTransmissionStarter(id);
  const de = buildSurfaceDE(snap.transforms, null, undefined, {
    condensationDepthBand: snap.condensationDepthBand,
  });
  const solid = buildCondensationSolid3(de);
  const field = (p: Vec3) => condensationSolidSignedDistance3(solid, p);
  const R = de.visibleBoundingRadius;
  const eps = DIELECTRIC_CROSSING_EPS_REL * R;
  // The kernel's closed-solid rules for the curved solid: membership is
  // the field's sign (exact), and the query owns the primary interface.
  const system: TransportFixtureSystem = {
    estimate: field,
    stepScale: de.stepScale,
    visibleRadius: R,
    ...(NOGATE ? {} : { contains: (p: Vec3) => field(p) <= 0 }),
    ...(SPLIT ? {} : { ownsPrimary: true }),
  };
  const material: DielectricMaterial = {
    ior: DIELECTRIC_IOR,
    absorption: DIELECTRIC_ABSORPTION,
    radius: R,
  };
  let log: string[] | null = null;
  let dumped = false;
  const query = (
    o: Vec3,
    d: Vec3,
    ap: boolean,
    apt: Vec3,
    inside: boolean,
    e: number,
  ) => {
    const r = transportSolidBoundaryQueryCPU(system, o, d, ap, apt, inside, e);
    if (log && log.length < 4000)
      log.push(
        `o=(${fmt(o)}) d=(${fmt(d)}) in=${inside ? 1 : 0} anc=${ap ? 1 : 0} -> ${r.kind}${r.kind === "refused" ? `:${r.reason}` : ""} t=${r.t.toExponential(3)} f(o)=${field(o).toExponential(2)}`,
      );
    return r;
  };

  // The camera: the starter's saved pose (orbit.ts's spherical convention,
  // phi from +y) or the look sheet's.
  const cam = snap.camera!;
  const sheet = VIEW === "sheet";
  const s = Math.sin(cam.phi);
  const eye: Vec3 = sheet
    ? SHEET_VIEW.eye
    : [
        cam.target[0] + cam.radius * s * Math.sin(cam.theta),
        cam.target[1] + cam.radius * Math.cos(cam.phi),
        cam.target[2] + cam.radius * s * Math.cos(cam.theta),
      ];
  const target: Vec3 = sheet ? SHEET_VIEW.target : cam.target;
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const tanHalf = sheet
    ? SHEET_VIEW.zoom
    : Math.tan(((cam.fov ?? 60) * Math.PI) / 360);
  const aspect = WIDTH / HEIGHT;
  const pixelEps = (2 * tanHalf) / HEIGHT;
  const hitFloor = SURFACE_GPU_HIT_FLOOR * R;
  const march = (p: Vec3, e: number) =>
    PRIMARY === "solid" ? field(p) : estimateDistanceRefined(de, p, e);

  let rays = 0;
  let hits = 0;
  let resolved = 0;
  let unresolved = 0;
  let invalid = 0;
  let startOutside = 0;
  let worstStartDepth = 0;
  const failures = new Map<string, number>();
  const t0 = Date.now();
  for (let py = STRIDE >> 1; py < HEIGHT; py += STRIDE) {
    for (let px = STRIDE >> 1; px < WIDTH; px += STRIDE) {
      rays++;
      const nx = ((px + 0.5) / WIDTH) * 2 - 1;
      const ny = 1 - ((py + 0.5) / HEIGHT) * 2;
      const rd = norm([
        fwd[0] + right[0] * nx * tanHalf * aspect + up[0] * ny * tanHalf,
        fwd[1] + right[1] * nx * tanHalf * aspect + up[1] * ny * tanHalf,
        fwd[2] + right[2] * nx * tanHalf * aspect + up[2] * ny * tanHalf,
      ]);
      // The kernel's sphere gate: 1.02 × the origin-centred visible ball.
      const Rg = R * 1.02;
      const b = eye[0] * rd[0] + eye[1] * rd[1] + eye[2] * rd[2];
      const c = eye[0] ** 2 + eye[1] ** 2 + eye[2] ** 2 - Rg * Rg;
      const disc = b * b - c;
      if (disc <= 0) continue;
      let t = Math.max(-b - Math.sqrt(disc), 0);
      const tFar = -b + Math.sqrt(disc);
      let hit = false;
      for (let step = 0; step < MARCH_STEPS && t <= tFar; step++) {
        const e = Math.max(pixelEps * t, hitFloor);
        const d = march(
          [eye[0] + rd[0] * t, eye[1] + rd[1] * t, eye[2] + rd[2] * t],
          e,
        );
        if (d < e) {
          hit = true;
          break;
        }
        t += d * de.stepScale;
      }
      if (!hit) continue;
      hits++;
      const pos: Vec3 = [
        eye[0] + rd[0] * t,
        eye[1] + rd[1] * t,
        eye[2] + rd[2] * t,
      ];
      const depth = field(pos);
      if (depth > 0) startOutside++;
      worstStartDepth = Math.max(worstStartDepth, depth / eps);
      for (let pass = 0; pass < DIELECTRIC_REPLAY_PASSES; pass++) {
        log = DUMP && !dumped ? [] : null;
        const r = transportTraceCPU(
          system,
          pos,
          rd,
          dielectricReplayTheta(pass),
          material,
          [0.1, 0.1, 0.1],
          {
            maxProcessedPaths: SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS,
            maxInterfaces: SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS,
          },
          query,
        );
        if (log && r.status === "unresolved" && r.failure === DUMP) {
          dumped = true;
          const n0 = transportOpticalNormal(system, pos, rd, eps);
          console.log(
            `    DUMP px=${px} py=${py}: ${log.length} queries; pos=(${fmt(pos)}) f=${depth.toExponential(2)} rd=(${fmt(rd)}) cosI=${Math.abs(rd[0] * n0[0] + rd[1] * n0[1] + rd[2] * n0[2]).toFixed(5)}`,
          );
          for (const line of log.slice(0, 40)) console.log(`      ${line}`);
        }
        log = null;
        const accepted =
          (r.status === "complete" || r.status === "residual") &&
          r.residual <= DIELECTRIC_ERROR_BUDGET;
        if (accepted) {
          resolved++;
          break;
        }
        if (r.status === "invalid") {
          invalid++;
          break;
        }
        if (r.status === "unresolved" || pass + 1 >= DIELECTRIC_REPLAY_PASSES) {
          unresolved++;
          const key =
            r.status === "unresolved"
              ? `${FAILURE_NAMES[r.failure] ?? `f${r.failure}`}/r${r.reason}`
              : "replay-exhausted";
          failures.set(key, (failures.get(key) ?? 0) + 1);
          break;
        }
      }
    }
  }
  const pct = (n: number) => ((100 * n) / Math.max(1, hits)).toFixed(2);
  console.log(
    `  ${id} [primary=${PRIMARY} view=${VIEW}${SPLIT ? " SPLIT" : ""}${NOGATE ? " NOGATE" : ""}] ${WIDTH}x${HEIGHT}/${STRIDE}: ` +
      `glass hits ${hits} of ${rays} rays, resolved ${resolved} (${pct(resolved)}%), ` +
      `unresolved ${unresolved}, invalid ${invalid}; ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(
    `    failures ${JSON.stringify(Object.fromEntries([...failures].sort((a, b) => b[1] - a[1])))}; ` +
      `primary hits outside the solid ${pct(startOutside)}%, deepest ${worstStartDepth.toFixed(2)} crossing eps`,
  );
}

describe("curved-solid glass at the app's camera and raster (f64 twin)", () => {
  it("tallies the starters' transport outcomes", () => {
    console.log("");
    for (const id of STARTERS) run(id);
  });
});
