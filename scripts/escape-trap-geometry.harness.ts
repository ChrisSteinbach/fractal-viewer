/**
 * Shape-trap geometry decision harness.
 *
 * The production estimator deliberately ships one object composition:
 * `min(escapeSet, trap)`. This harness keeps the rejected trap-only arm local
 * and draws all three alternatives through `de-preview.ts`'s one marcher:
 *
 *   base | min(set, trap) | trap only
 *
 * Rows cross the canonical Mandelbox and the two-link fold chain with the
 * peace sign and gear, each over the full orbit and one finite inclusive
 * level band. The numeric leg then compares local shape damping at 1.0, the
 * production 0.9, and a stronger 0.7 twice: for min-union context, and for
 * the ISOLATED trap-only distance against trap-only finite-budget membership.
 * Each check probes ten fixed directions at the predicted radius/step. A hit
 * is a concrete overshoot witness; a miss is comparative evidence only, NOT
 * a bound proof (the finite direction set cannot certify the whole sphere).
 *
 * VERDICT (2026-08-25). Ship `min(set, trap)`. On the rendered 168px sheet,
 * the eight repeated base panels total 78,988 hits, min-union totals 84,386,
 * and trap-only totals 38,494; base and union both exhaust zero rays. The
 * picture explains the counts: union preserves each familiar escape object
 * and grows legible trapped structure from it, while trap-only throws the
 * anchor away and the finite level-0 rows become sparse orbit fragments.
 * The damping verdict is based on the isolated trap-only sweep below, so an
 * existing escape-set estimate cannot be blamed for a witness. Across 3,832
 * exterior probes, full-radius witnesses read 92 / 74 / 75 and globally
 * damped step witnesses read 44 / 44 / 33 at local 1.0 / 0.9 / 0.7. Thus 0.9
 * improves the undamped full-radius comparison without worsening the shipped
 * 0.35 step comparison. The stronger arm lowers step witnesses, but not
 * radius witnesses versus 0.9; this finite-direction comparison does not
 * justify inventing a second safety constant instead of the shared 0.9.
 *
 * Writes `scripts/out/escape-trap-geometry.png`.
 */
import {
  buildEscapeDE,
  ESCAPE_LINK_BOXFOLD,
  ESCAPE_LINK_MANDELBOX,
  ESCAPE_LINK_SPHEREFOLD,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  foldQueryIntoSector,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import { resolveShapeTrap, shapeTrapPosedSdf } from "../src/fractal/shape-trap";
import type { ResolvedShapeTrap } from "../src/fractal/shape-trap";
import { foldChain, mandelboxClassic } from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  GEAR_SHAPE,
  PEACE_SIGN_SHAPE,
  SHAPE_MARCH_SAFETY,
} from "../src/fractal/shapes";
import type { Vec3 } from "../src/fractal/types";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats } from "./de-preview";

const SIZE = 168;
const FINITE_LEVEL_MIN = 0;
const FINITE_LEVEL_MAX = 0;
const OVERSHOOT_POINTS = 480;
const OVERSHOOT_DIRECTIONS = 10;
const STRONGER_SHAPE_SAFETY = 0.7;

interface Fixture {
  name: string;
  de: EscapeDE;
}

interface TrapFixture {
  name: string;
  trap: ResolvedShapeTrap;
}

interface TrapOrbitResult {
  distance: number;
  member: boolean;
}

const FIXTURES: Fixture[] = [
  { name: "MANDELBOX", de: buildEscapeDE(mandelboxClassic()) },
  { name: "FOLD CHAIN", de: buildEscapeDE(foldChain()) },
];

const TRAPS: TrapFixture[] = [
  {
    name: "PEACE",
    trap: resolveShapeTrap({
      shape: PEACE_SIGN_SHAPE,
      position: [0.15, -0.1, 0.2],
      rotation: [0.35, -0.2, 0.25],
      scale: 0.78,
      geometry: true,
    }),
  },
  {
    name: "GEAR",
    trap: resolveShapeTrap({
      shape: GEAR_SHAPE,
      position: [0.15, -0.1, 0.2],
      rotation: [0.55, 0.2, -0.15],
      scale: 0.72,
      geometry: true,
    }),
  },
];

function banded(
  trap: ResolvedShapeTrap,
  min: number,
  max: number,
): ResolvedShapeTrap {
  return { ...trap, geometryLevelMin: min, geometryLevelMax: max };
}

/** Harness-local trap-only orbit. It is intentionally limited to the three
 * fold kinds used by this sheet: production owns no object-mode toggle and
 * no second forward loop. The local runner is pinned against the production
 * min-union estimator below before any picture or overshoot number is used. */
function trapOrbit(
  de: EscapeDE,
  trap: ResolvedShapeTrap,
  p: Vec3,
  localSafety: number,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): TrapOrbitResult {
  const folded: Vec3 = [0, 0, 0];
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector(p, de.symmetryOrder, de.symmetryPlane, folded)
      : p;
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  let distance = Infinity;
  let member = false;
  const links = de.links;
  const maxSteps = maxIterations * links.length;
  for (let step = 0; step < maxSteps && r <= ESCAPE_TIME_RADIUS; step++) {
    const link = links[step % links.length];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    if (link.kind === ESCAPE_LINK_BOXFOLD) {
      fx = foldAxis(yx, link.boxLimit);
      fy = foldAxis(yy, link.boxLimit);
      fz = foldAxis(yz, link.boxLimit);
      localL = 1;
    } else if (link.kind === ESCAPE_LINK_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f =
        link.fixedRadius2 /
        Math.max(link.minRadius2, Math.min(link.fixedRadius2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else if (link.kind === ESCAPE_LINK_MANDELBOX) {
      const bx = foldAxis(yx, link.boxLimit);
      const by = foldAxis(yy, link.boxLimit);
      const bz = foldAxis(yz, link.boxLimit);
      const r2 = bx * bx + by * by + bz * bz;
      const f =
        link.fixedRadius2 /
        Math.max(link.minRadius2, Math.min(link.fixedRadius2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    } else {
      throw new Error("trap geometry harness accepts fold-only chains");
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    dr = link.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (step >= trap.geometryLevelMin && step <= trap.geometryLevelMax) {
      const posed = shapeTrapPosedSdf(trap, vx, vy, vz);
      distance = Math.min(distance, (localSafety * posed) / dr);
      if (posed <= 0) member = true;
    }
  }
  return { distance, member };
}

function foldAxis(t: number, wall: number): number {
  return 2 * Math.max(-wall, Math.min(wall, t)) - t;
}

function trapOnly(
  de: EscapeDE,
  trap: ResolvedShapeTrap,
  localSafety = SHAPE_MARCH_SAFETY,
): DistanceEstimator {
  return (p) => trapOrbit(de, trap, p, localSafety).distance;
}

function unionWithSafety(
  de: EscapeDE,
  trap: ResolvedShapeTrap,
  localSafety: number,
): DistanceEstimator {
  return (p) =>
    Math.min(
      estimateEscapeDistance(de, p),
      trapOrbit(de, trap, p, localSafety).distance,
    );
}

function unionContains(
  de: EscapeDE,
  trap: ResolvedShapeTrap,
  p: Vec3,
): boolean {
  return escapeSetContains(de, p) || trapOrbit(de, trap, p, 1).member;
}

function trapContains(de: EscapeDE, trap: ResolvedShapeTrap, p: Vec3): boolean {
  return trapOrbit(de, trap, p, 1).member;
}

function panel(de: DistanceEstimator): PanelStats {
  return renderPreview(
    {
      de,
      boundingRadius: ESCAPE_TIME_RADIUS,
      stepScale: ESCAPE_STEP_SCALE,
      zoom: 0.5,
      maxSteps: 600,
      collect: true,
      ao: false,
      shadow: false,
      fog: false,
    },
    SIZE,
  );
}

function pct(value: number, total: number): string {
  return `${((100 * value) / total).toFixed(2)}%`;
}

function sampleBall(count: number, seed: number): Vec3[] {
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const radius = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const z = 2 * rng() - 1;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = 2 * Math.PI * rng();
    out.push([
      radius * planar * Math.cos(phi),
      radius * planar * Math.sin(phi),
      radius * z,
    ]);
  }
  return out;
}

function probeDirections(count: number): Vec3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / count;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = golden * i;
    return [planar * Math.cos(phi), planar * Math.sin(phi), z];
  });
}

interface DirectionWitnessReport {
  probed: number;
  radius: number;
  step: number;
}

type WitnessObject = "min-union" | "trap-only";

/** Finite-direction comparison, not a proof: membership at one of the ten
 * sampled points is a real witness, while no witness says nothing about the
 * unprobed continuum of directions. `trap-only` is the attribution arm: both
 * distance and membership exclude the existing escape set. */
function directionWitnesses(
  de: EscapeDE,
  trap: ResolvedShapeTrap,
  localSafety: number,
  seed: number,
  object: WitnessObject,
): DirectionWitnessReport {
  const estimate =
    object === "min-union"
      ? unionWithSafety(de, trap, localSafety)
      : trapOnly(de, trap, localSafety);
  const member =
    object === "min-union"
      ? (p: Vec3) => unionContains(de, trap, p)
      : (p: Vec3) => trapContains(de, trap, p);
  const directions = probeDirections(OVERSHOOT_DIRECTIONS);
  let probed = 0;
  let radius = 0;
  let step = 0;
  for (const p of sampleBall(OVERSHOOT_POINTS, seed)) {
    if (member(p)) continue;
    const d = estimate(p);
    if (!(d > 0) || !Number.isFinite(d)) continue;
    probed++;
    let hitBound = false;
    let hitStep = false;
    for (const u of directions) {
      if (
        !hitBound &&
        member([p[0] + d * u[0], p[1] + d * u[1], p[2] + d * u[2]])
      ) {
        hitBound = true;
      }
      if (
        !hitStep &&
        member([
          p[0] + ESCAPE_STEP_SCALE * d * u[0],
          p[1] + ESCAPE_STEP_SCALE * d * u[1],
          p[2] + ESCAPE_STEP_SCALE * d * u[2],
        ])
      ) {
        hitStep = true;
      }
      if (hitBound && hitStep) break;
    }
    if (hitBound) radius++;
    if (hitStep) step++;
  }
  return { probed, radius, step };
}

describe("escape shape-trap geometry decision", () => {
  it("pins the harness-local trap-only arm to production min-union", () => {
    const points = sampleBall(96, 0x51a9);
    for (const fixture of FIXTURES) {
      for (const shape of TRAPS) {
        for (const trap of [
          shape.trap,
          banded(shape.trap, FINITE_LEVEL_MIN, FINITE_LEVEL_MAX),
        ]) {
          for (const p of points) {
            const expected = Math.min(
              estimateEscapeDistance(fixture.de, p),
              trapOrbit(fixture.de, trap, p, SHAPE_MARCH_SAFETY).distance,
            );
            expect(
              estimateEscapeDistance(
                fixture.de,
                p,
                ESCAPE_TIME_ITERATIONS,
                trap,
              ),
            ).toBeCloseTo(expected, 14);
          }
        }
      }
    }
  });

  it("renders base, production min-union, and trap-only for every required row", () => {
    const rendered: {
      stats: PanelStats;
      lines: readonly [string, string];
    }[] = [];
    let baseExhausted = 0;
    let unionExhausted = 0;
    let baseHits = 0;
    let unionHits = 0;
    let trapHits = 0;
    for (const fixture of FIXTURES) {
      for (const shape of TRAPS) {
        for (const [bandName, trap] of [
          ["FULL", shape.trap],
          [
            `${FINITE_LEVEL_MIN}-${FINITE_LEVEL_MAX}`,
            banded(shape.trap, FINITE_LEVEL_MIN, FINITE_LEVEL_MAX),
          ],
        ] as const) {
          const arms: readonly [string, DistanceEstimator][] = [
            ["BASE", (p) => estimateEscapeDistance(fixture.de, p)],
            [
              "MIN UNION",
              (p) =>
                estimateEscapeDistance(
                  fixture.de,
                  p,
                  ESCAPE_TIME_ITERATIONS,
                  trap,
                ),
            ],
            ["TRAP ONLY", trapOnly(fixture.de, trap)],
          ];
          const stats = arms.map(([arm, estimator]) => {
            const result = panel(estimator);
            console.log(
              `${fixture.name.padEnd(10)} ${shape.name.padEnd(5)} ${bandName.padEnd(4)} ` +
                `${arm.padEnd(10)} hits=${pct(result.hits, SIZE * SIZE)} ` +
                `steps/ray=${(result.steps / (SIZE * SIZE)).toFixed(1)} ` +
                `exhausted=${pct(result.exhausted, SIZE * SIZE)} ${result.ms}ms`,
            );
            rendered.push({
              stats: result,
              lines: [
                `${fixture.name} ${shape.name} ${bandName}`,
                `${arm} H${pct(result.hits, SIZE * SIZE)} E${pct(result.exhausted, SIZE * SIZE)}`,
              ],
            });
            return result;
          });
          baseHits += stats[0].hits;
          unionHits += stats[1].hits;
          trapHits += stats[2].hits;
          baseExhausted += stats[0].exhausted;
          unionExhausted += stats[1].exhausted;
          expect(stats[1].hits).toBeGreaterThan(0.005 * SIZE * SIZE);
          expect(stats[2].hits).toBeGreaterThan(0.005 * SIZE * SIZE);
        }
      }
    }
    const path = writeLabeledContactSheet(
      rendered,
      3,
      "escape-trap-geometry.png",
    );
    console.log(`wrote ${path}`);
    console.log(
      `aggregate hits base=${baseHits} union=${unionHits} trap-only=${trapHits}; ` +
        `exhausted base=${baseExhausted} union=${unionExhausted}`,
    );
    expect(unionHits).toBeGreaterThan(baseHits);
    expect(trapHits).toBeGreaterThan(0);
    // "No regression" here means no new budget exhaustion at all across the
    // eight matched panels, stronger than a percentage tolerance.
    expect(unionExhausted).toBeLessThanOrEqual(baseExhausted);
  });

  it("compares damping witnesses in min-union context and isolated trap-only attribution", () => {
    const run = (object: WitnessObject) => {
      let noDampingRadius = 0;
      let shippedRadius = 0;
      let strongerRadius = 0;
      let noDampingStep = 0;
      let shippedStep = 0;
      let strongerStep = 0;
      let totalProbed = 0;
      let row = 0;
      console.log(`-- ${object} finite-direction witnesses (NOT a proof) --`);
      for (const fixture of FIXTURES) {
        for (const shape of TRAPS) {
          for (const [bandName, trap] of [
            ["FULL", shape.trap],
            [
              `${FINITE_LEVEL_MIN}-${FINITE_LEVEL_MAX}`,
              banded(shape.trap, FINITE_LEVEL_MIN, FINITE_LEVEL_MAX),
            ],
          ] as const) {
            const arms = [
              ["1.0", 1],
              ["0.9", SHAPE_MARCH_SAFETY],
              ["0.7", STRONGER_SHAPE_SAFETY],
            ] as const;
            const reports = arms.map(([name, safety]) => {
              const report = directionWitnesses(
                fixture.de,
                trap,
                safety,
                0x7000 + row,
                object,
              );
              console.log(
                `${fixture.name.padEnd(10)} ${shape.name.padEnd(5)} ${bandName.padEnd(4)} ` +
                  `local=${name} probed=${report.probed} ` +
                  `radiusWitness=${pct(report.radius, report.probed)} ` +
                  `stepWitness@${ESCAPE_STEP_SCALE}=${pct(report.step, report.probed)}`,
              );
              return report;
            });
            noDampingRadius += reports[0].radius;
            shippedRadius += reports[1].radius;
            strongerRadius += reports[2].radius;
            noDampingStep += reports[0].step;
            shippedStep += reports[1].step;
            strongerStep += reports[2].step;
            totalProbed += reports[1].probed;
            row++;
          }
        }
      }
      console.log(
        `${object} aggregate witnesses / ${totalProbed}: ` +
          `radius[1.0=${noDampingRadius},0.9=${shippedRadius},0.7=${strongerRadius}] ` +
          `step[1.0=${noDampingStep},0.9=${shippedStep},0.7=${strongerStep}]`,
      );
      return {
        noDampingRadius,
        shippedRadius,
        strongerRadius,
        noDampingStep,
        shippedStep,
        strongerStep,
        totalProbed,
      };
    };

    // Context only: these witnesses may be attributable to either minimum.
    run("min-union");
    // Decision evidence: distance and membership are both trap-only here.
    const isolated = run("trap-only");
    expect(isolated.shippedRadius).toBeLessThan(isolated.noDampingRadius);
    expect(isolated.shippedStep).toBeLessThanOrEqual(
      isolated.noDampingStep + 1,
    );
    expect(isolated.strongerStep).toBeLessThanOrEqual(isolated.shippedStep + 1);
  });
});
