/**
 * WHICH GENERATOR SETS BEYOND THE SEVEN REGISTRY ARRANGEMENTS ARE WORTH
 * AUTHORING?
 *
 * The sphere-inversion family's AUTHORED form names an arrangement by id from
 * a closed registry — oct6/cube8/ico12 in 3D, cross8/tess16/cell24/cell600 in
 * 4D — while the RESOLVED form underneath has always taken an arbitrary
 * `{center, radius}` list. Widening what the DOCUMENT may say is cheap in
 * code and unanswered in looks, so this sheet is the look evidence, and it is
 * allowed to come back empty: "registry ids only" closes the question.
 *
 * WHAT IS ALREADY MEASURED AND IS CITED RATHER THAN RE-DERIVED. The native 4D
 * beauty search (`sphere-inversion-4d-search.harness.ts`,
 * `docs/sphere-inversion-family.md`) read 20 random S³ centres as "genuine by
 * every column and visually the dullest", the dual 24-cell at mixed radii
 * .6/.4, Hopf-linked necklaces and both Clifford-torus duoprisms as sparse
 * pearls and dust, and the snub 24-cell (96 centres) as the 600-cell with
 * less. So plausible 4D REGISTRY growth is surveyed and came back weaker than
 * cell600; nothing here re-renders it.
 *
 * WHAT THIS SHEET ASKS INSTEAD:
 *
 *   - `r3d`: 3D arrangements beyond the shipped three, including DERIVED sets
 *     (vertices ∪ face centres, edge midpoints) which are the cheapest way to
 *     reach denser 3D arrangements.
 *   - `par`: PARAMETRIC families that are neither polytope vertices nor
 *     random — rings, bipyramids, prisms and antiprisms with an authored
 *     aspect, and two concentric shells.
 *   - `jit3` / `jit4`: THE JITTER SWEEP, the real form of the aesthetic
 *     question. Regular-versus-random is the two ENDPOINTS of this sweep; the
 *     interesting answer is the middle, and it is the one measurement that
 *     can justify or close the explicit-centre tier on evidence.
 *
 * THE TWO RADIUS RULES, measured side by side wherever they differ, because
 * the vocabulary's validity-by-construction rule has to pick one. SHARED is
 * what the registry does today: one radius `f · d_min/2` off the smallest
 * centre-to-centre distance in the whole set. OWN gives generator `i` the
 * radius `f · d_i/2` off ITS OWN nearest-neighbour distance, which is sound
 * for the same reason (`r_i + r_j = f(d_i + d_j)/2 <= f |c_i − c_j|`, since
 * both `d_i` and `d_j` are at most that distance) and keeps large spheres
 * where an irregular set has room, at the cost of the kernels' uniform-unit
 * fast path. The two coincide exactly on every vertex-transitive set, so the
 * rows that carry both are the derived, parametric and jittered ones.
 *
 * INSTRUMENTS, all shared: `de-preview.ts` for every panel, `set-extent.ts`
 * for fill and reach against the fold's MEMBERSHIP oracle (never `de < eps`),
 * `sphere-inversion-orbit.ts` for the construction, and
 * `sphere-inversion-slice.ts` for the fold-word columns — including `deepPx`,
 * the share of hit pixels whose word is at least TWO inversions long, which
 * is what NESTING means at the pixel level and the one column that can say a
 * loosened set has stopped nesting while still drawing first-generation
 * copies. Every panel reports its exhausted share, as the 4D rounds did.
 *
 * Run: SIA_ROUND=r3d npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion-authored-sets.harness.ts
 * Rounds: r3d | par | jit3 | jit4 (unset runs r3d and par).
 * Env: SIA_SIZE (panel px, default 256), SIA_ONLY (comma-separated labels),
 * SIA_FIELD (re-draws the jitter displacement field, to check a breakpoint).
 * Writes `scripts/out/sphere-inversion-authored-{r3d,par,jit3,jit4}.png`.
 */
import { mulberry32 } from "../src/fractal/rng";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";
import {
  ballSeed,
  buildInversionScene,
  estimateInversionDistance,
  inversionOrbitContains,
  lift4,
  makeFoldScratch,
  shellSeed,
} from "./sphere-inversion-orbit";
import type {
  Dim,
  GBall,
  Generator,
  InversionSceneSpec,
  RotorPlane,
} from "./sphere-inversion-orbit";
import {
  foldWordColumns,
  offSliceFlags,
  sliceSubArrangement,
} from "./sphere-inversion-slice";

const SIZE = Number(process.env.SIA_SIZE ?? 256);
const ONLY = process.env.SIA_ONLY?.split(",").filter(Boolean);
const ROUND = process.env.SIA_ROUND;
/** Added to every jitter field's seed. A sweep reads one DRAW of a random
 * displacement, so the breakpoint it reports is only worth quoting if a
 * second draw puts it in the same place: `SIA_FIELD=1` is that check. */
const FIELD_OFFSET = Number(process.env.SIA_FIELD ?? 0);

/** The exterior orbit camera the 3D gate sheet and the 4D search share. */
const EYE_OFFSET: Vec3 = [1.1, 0.8, 1.3];
const ZOOM = 0.6;
/** Framing budget only; the doc's quoted fills are `set-extent.ts`'s full
 * budget. */
const FRAME_POINTS = 16384;
/** One depth for every panel of every round, so a row differs from its
 * neighbour by its ARRANGEMENT and by nothing else. */
const DEPTH = 6;
/** Generator radius as a fraction of the kissing radius: the authored
 * default. */
const KISS = 0.99;

// --------------------------------------------------------- centre sets

const PHI = (1 + Math.sqrt(5)) / 2;

function dist(a: readonly number[], b: readonly number[]): number {
  let d2 = 0;
  for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) ** 2;
  return Math.sqrt(d2);
}

/** Each centre's distance to its nearest other centre. */
function nearestNeighbourDistances(cs: readonly number[][]): number[] {
  return cs.map((c, i) => {
    let best = Infinity;
    cs.forEach((o, j) => {
      if (j !== i) best = Math.min(best, dist(c, o));
    });
    return best;
  });
}

/** Normalize every centre onto the unit sphere — the registry's convention,
 * which is what makes seed lengths absolute and comparable across
 * arrangements. */
function unitize(cs: number[][]): number[][] {
  return cs.map((c) => {
    const l = Math.hypot(...c);
    return c.map((v) => v / l);
  });
}

/** The SHARED rule: one radius off the smallest centre-to-centre distance. */
function sharedRadii(cs: readonly number[][], f: number): Generator[] {
  const r = (f * Math.min(...nearestNeighbourDistances(cs))) / 2;
  return cs.map((c) => ({ c: [...c], r }));
}

/** The OWN rule: each generator at a fraction of its own nearest-neighbour
 * half-distance. Disjoint by the module header's inequality. */
function ownRadii(cs: readonly number[][], f: number): Generator[] {
  const d = nearestNeighbourDistances(cs);
  return cs.map((c, i) => ({ c: [...c], r: (f * d[i]) / 2 }));
}

/** Does the set have more than one nearest-neighbour distance — i.e. do the
 * two radius rules differ at all? */
function radiiRulesDiffer(cs: readonly number[][]): boolean {
  const d = nearestNeighbourDistances(cs);
  return Math.max(...d) - Math.min(...d) > 1e-9;
}

const tetra4 = () =>
  unitize([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]);

const oct6 = () => [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const cube8 = () =>
  unitize([
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
  ]);

const ico12 = () => {
  const out: number[][] = [];
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      out.push([0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]);
    }
  }
  return unitize(out);
};

/** The dodecahedron's 20 vertices: the cube's, plus cyclic `(0, ±1/φ, ±φ)`. */
const dodec20 = () => {
  const out: number[][] = [];
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      out.push(
        [0, a / PHI, b * PHI],
        [a / PHI, b * PHI, 0],
        [b * PHI, 0, a / PHI],
      );
    }
  }
  return unitize([...cube8(), ...out]);
};

/** The rhombicuboctahedron's 24 vertices: permutations of
 * `(±1, ±1, ±(1+√2))`. */
const rhombicuboct24 = () => {
  const t = 1 + Math.SQRT2;
  const out: number[][] = [];
  for (const s of [1, -1]) {
    for (const u of [1, -1]) {
      for (const v of [1, -1]) {
        out.push([s * t, u, v], [u, s * t, v], [u, v, s * t]);
      }
    }
  }
  return unitize(out);
};

/**
 * The EDGE MIDPOINTS of a centre set: midpoints of the pairs at the set's
 * smallest centre distance, back on the unit sphere. The octahedron's give
 * the cuboctahedron's 12, the icosahedron's the icosidodecahedron's 30 — one
 * derivation rule, two arrangements, which is exactly the argument for a
 * derived tier over a longer registry.
 */
function edgeMidpoints(cs: readonly number[][]): number[][] {
  const edge = Math.min(...nearestNeighbourDistances(cs));
  const out: number[][] = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if (dist(cs[i], cs[j]) > edge * (1 + 1e-9)) continue;
      out.push(cs[i].map((v, a) => (v + cs[j][a]) / 2));
    }
  }
  return unitize(out);
}

// ----------------------------------------------------- parametric families

/** `n` centres on the xy great circle. */
function ring(n: number, phase = 0): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n + phase;
    return [Math.cos(t), Math.sin(t), 0];
  });
}

/** A ring of `n` plus the two poles — the bipyramid's vertices. `oct6` is
 * the `n = 4` member, which is what makes this family the registry's own
 * natural parameter. */
function bipyramid(n: number): number[][] {
  return [...ring(n), [0, 0, 1], [0, 0, -1]];
}

/** Two rings of `n` at heights `±h` (so still unit centres), the upper one
 * turned by `twist`. `twist = π/n` is the antiprism, 0 the prism. */
function prism(n: number, h: number, twist: number): number[][] {
  const rad = Math.sqrt(Math.max(0, 1 - h * h));
  const out: number[][] = [];
  for (const [sign, ph] of [
    [1, twist],
    [-1, 0],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n + ph;
      out.push([rad * Math.cos(t), rad * Math.sin(t), sign * h]);
    }
  }
  return out;
}

/** Two concentric shells: `inner` at distance 1, `outer` scaled to `d`. The
 * one family here whose centres are NOT all at unit distance. */
function twoShell(inner: number[][], outer: number[][], d: number): number[][] {
  return [...inner, ...outer.map((c) => c.map((v) => v * d))];
}

// ------------------------------------------------------------- jitter

/**
 * One displacement field per base set, drawn once and SCALED by the sweep's
 * amplitude, so consecutive rows of a sweep are the same perturbation seen
 * harder rather than two unrelated draws. Directions are uniform on the
 * sphere and lengths uniform in `[0, 1]` — a cloud, not a shell, so a small
 * amplitude really does leave most centres nearly in place.
 */
function displacementField(count: number, dim: Dim, seed: number): number[][] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const g = Array.from({ length: dim }, () => {
      const u = Math.max(1e-12, rng());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    });
    const l = Math.hypot(...g) || 1;
    const s = rng();
    return g.map((v) => (v / l) * s);
  });
}

/** `cs` perturbed by `amp` times the set's own EDGE (its smallest centre
 * distance), along the fixed field. Centres are left where the perturbation
 * puts them — off the unit sphere — because that is what an authored
 * explicit-centre set would be. */
function jitter(
  cs: readonly number[][],
  field: readonly number[][],
  amp: number,
): number[][] {
  const edge = Math.min(...nearestNeighbourDistances(cs));
  return cs.map((c, i) => c.map((v, a) => v + field[i][a] * amp * edge));
}

// --------------------------------------------------------------- panels

type RadiusRule = "shared" | "own";

interface Pose4 {
  name: string;
  planes: [RotorPlane, number][];
  w0: number;
}

const ID_POSE: Pose4 = { name: "ID", planes: [], w0: 0 };

interface Candidate {
  label: string;
  centers: number[][];
  dim: Dim;
  rule: RadiusRule;
  /** `ball` seeds the pearls, `shell` the lace. */
  seed: "ball" | "shell";
  /** Absent = the 3D panel's single implicit identity pose. */
  poses?: Pose4[];
  eyeOffset?: Vec3;
  zoom?: number;
  /** Jitter amplitude, printed so a sweep row names itself. */
  amp?: number;
}

interface Row {
  label: string;
  stats: PanelStats;
  gens: number;
  rMin: number;
  rMax: number;
  void_: number;
  seedSize: number;
  fill: number;
  reach: number;
  copyPx: number;
  deepPx: number;
  meanWord: number;
  offPx: number;
  wordMatch: number;
  vs3D: number;
}

/**
 * The seed sizes, derived from the arrangement rather than authored per
 * panel, so two rows differ by their generators alone. The pearls ball is
 * 93% of the central VOID (the distance from the origin to the nearest
 * generator SPHERE), which reproduces the shipped panels' hand-picked sizes
 * to within a few hundredths at every shipped arrangement. The lace shell is
 * the fixed unit shell those panels used, which crosses the generators at
 * every arrangement by construction.
 */
const SEED_VOID_FRACTION = 0.93;
const SHELL_THICKNESS = 0.03;

function centralVoid(gens: readonly Generator[]): number {
  return Math.min(...gens.map((g) => Math.hypot(...g.c) - g.r));
}

function buildSpec(cand: Candidate): {
  spec: InversionSceneSpec;
  gens: Generator[];
  seedSize: number;
} {
  const gens =
    cand.rule === "shared"
      ? sharedRadii(cand.centers, KISS)
      : ownRadii(cand.centers, KISS);
  const seedSize =
    cand.seed === "ball" ? SEED_VOID_FRACTION * centralVoid(gens) : 1;
  const seed: GBall[] =
    cand.seed === "ball"
      ? ballSeed(seedSize, cand.dim)
      : shellSeed(1, SHELL_THICKNESS, cand.dim);
  return {
    spec: { dim: cand.dim, gens, seed, depth: DEPTH },
    gens,
    seedSize,
  };
}

function renderCandidate(cand: Candidate, size: number): Row[] {
  const { spec, gens, seedSize } = buildSpec(cand);
  const scene = buildInversionScene(spec);
  const scratch = makeFoldScratch(scene);
  const poses = cand.poses ?? [ID_POSE];
  const lifts = poses.map((p) =>
    cand.dim === 4 ? lift4(p.planes, p.w0) : (q: Vec3) => q,
  );
  const reaches = poses.map((_, i) =>
    sampleSetExtent(
      (p) => inversionOrbitContains(scene, lifts[i](p), scratch),
      {
        fillRadius: scene.boundRadius,
        points: FRAME_POINTS,
      },
    ),
  );
  const R = Math.max(0.2, Math.max(...reaches.map((e) => e.reachAbs)) * 1.06);
  const radii = gens.map((g) => g.r);
  return poses.map((pose, i) => {
    const preview: PreviewScene = {
      de: (p) => estimateInversionDistance(scene, lifts[i](p), scratch),
      boundingRadius: R,
      stepScale: 1,
      eyeOffset: cand.eyeOffset ?? EYE_OFFSET,
      zoom: cand.zoom ?? ZOOM,
      collect: true,
    };
    const stats = renderPreview(preview, size);
    // `word0` compares against POSES[0], so the first pose's own column is
    // 1.00 by construction and says nothing; read it on the later poses.
    const words = foldWordColumns(scene, stats, size, {
      lift: cand.dim === 4 ? lifts[i] : undefined,
      liftRef: cand.dim === 4 ? lifts[0] : undefined,
      offPlane: cand.dim === 4 ? offSliceFlags(spec.gens, poses[i]) : undefined,
    });
    let vs3D = NaN;
    if (cand.dim === 4) {
      const subSpec = sliceSubArrangement(spec, pose);
      if (subSpec && subSpec.gens.length > 0) {
        const sub = buildInversionScene(subSpec);
        const subScratch = makeFoldScratch(sub);
        const twin = renderPreview(
          {
            ...preview,
            de: (p) => estimateInversionDistance(sub, p, subScratch),
            collect: false,
          },
          size,
        );
        let differ = 0;
        for (let px = 0; px < size * size; px++) {
          for (let c = 0; c < 3; c++) {
            if (Math.abs(twin.rgb[px * 3 + c] - stats.rgb[px * 3 + c]) > 24) {
              differ++;
              break;
            }
          }
        }
        vs3D = (100 * differ) / (size * size);
      }
    }
    return {
      label: poses.length > 1 ? `${cand.label} ${pose.name}` : cand.label,
      stats,
      gens: scene.n,
      rMin: Math.min(...radii),
      rMax: Math.max(...radii),
      void_: centralVoid(gens),
      seedSize,
      fill: reaches[i].fillPct,
      reach: reaches[i].reachAbs,
      ...words,
      vs3D,
    };
  });
}

function pct(n: number, size: number): string {
  return ((100 * n) / (size * size)).toFixed(1);
}

function printRow(r: Row, size: number): void {
  const px = size * size;
  console.log(
    `    ${r.label.padEnd(30)} n${String(r.gens).padStart(3)} ` +
      `r ${r.rMin.toFixed(3)}${r.rMin === r.rMax ? "      " : `-${r.rMax.toFixed(3)}`} ` +
      `void ${r.void_.toFixed(3)} seed ${r.seedSize.toFixed(3)}  ` +
      `H${pct(r.stats.hits, size).padStart(5)} X${pct(r.stats.exhausted, size)} ` +
      `S${(r.stats.steps / px).toFixed(1).padStart(5)} ${(r.stats.ms / 1000).toFixed(1)}S  ` +
      `fill ${r.fill.toFixed(2)}% reach ${r.reach.toFixed(2)}  ` +
      `copy ${r.copyPx.toFixed(2)} deep ${r.deepPx.toFixed(2)} ` +
      `word ${r.meanWord.toFixed(2)}` +
      (Number.isNaN(r.offPx)
        ? ""
        : `  off ${r.offPx.toFixed(2)} word0 ${r.wordMatch.toFixed(2)} ` +
          `vs3D ${Number.isNaN(r.vs3D) ? "-" : `${r.vs3D.toFixed(1)}%`}`),
  );
}

function runRound(round: string, candidates: Candidate[], cols: number): void {
  const mine = candidates.filter((c) => !ONLY || ONLY.includes(c.label));
  if (mine.length === 0) return;
  console.log(
    `\n  [${round}] ${SIZE}px, depth ${DEPTH}, radius ${KISS}x kissing` +
      ` (H hit%, X exhausted%, S steps/ray; deep = word >= 2)`,
  );
  const panels: { stats: PanelStats; lines: [string, string] }[] = [];
  for (const cand of mine) {
    for (const r of renderCandidate(cand, SIZE)) {
      printRow(r, SIZE);
      panels.push({
        stats: r.stats,
        lines: [
          r.label,
          `H${pct(r.stats.hits, SIZE)} C${r.copyPx.toFixed(2).replace(/^0/, "")} ` +
            `D${r.deepPx.toFixed(2).replace(/^0/, "")} W${r.meanWord.toFixed(1)}`,
        ],
      });
    }
  }
  console.log(
    `  wrote ${writeLabeledContactSheet(
      panels,
      cols,
      `sphere-inversion-authored-${round}.png`,
    )}`,
  );
}

// ------------------------------------------------------------- candidates

/** The 3D arrangements: the three shipped ids as the bar, five polytope
 * vertex sets, and three DERIVED sets. */
const SETS_3D: [string, number[][]][] = [
  ["TETRA4", tetra4()],
  ["OCT6", oct6()],
  ["CUBE8", cube8()],
  ["CUBOCT12", edgeMidpoints(oct6())],
  ["ICO12", ico12()],
  ["RHOMBDODEC14", unitize([...oct6(), ...cube8()])],
  ["DODEC20", dodec20()],
  ["RHOMBICUBOCT24", rhombicuboct24()],
  ["DISDYAK26", unitize([...oct6(), ...cube8(), ...edgeMidpoints(oct6())])],
  ["ICOSIDODEC30", edgeMidpoints(ico12())],
  ["RHOMBTRIA32", unitize([...ico12(), ...dodec20()])],
];

const ROUND_3D: Candidate[] = SETS_3D.flatMap(([name, centers]) => {
  const out: Candidate[] = [
    { label: `${name} BALL`, centers, dim: 3, rule: "shared", seed: "ball" },
    { label: `${name} SHELL`, centers, dim: 3, rule: "shared", seed: "shell" },
  ];
  if (radiiRulesDiffer(centers)) {
    out.push(
      { label: `${name} BALL OWN`, centers, dim: 3, rule: "own", seed: "ball" },
      {
        label: `${name} SHELL OWN`,
        centers,
        dim: 3,
        rule: "own",
        seed: "shell",
      },
    );
  }
  return out;
});

/** The parametric families. Each is a SCHEMA plus one or two parameter
 * values, which is what the vocabulary would author. */
const SETS_PAR: [string, number[][]][] = [
  ["RING5", ring(5)],
  ["RING8", ring(8)],
  ["BIPYR6", bipyramid(6)],
  ["BIPYR8", bipyramid(8)],
  ["PRISM6 H.5", prism(6, 0.5, 0)],
  ["ANTIPRISM6 H.5", prism(6, 0.5, Math.PI / 6)],
  ["ANTIPRISM8 H.35", prism(8, 0.35, Math.PI / 8)],
  ["SHELL2 O6+C8 D1.9", twoShell(oct6(), cube8(), 1.9)],
  ["SHELL2 O6+C8 D2.6", twoShell(oct6(), cube8(), 2.6)],
];

const ROUND_PAR: Candidate[] = SETS_PAR.flatMap(([name, centers]) => {
  const out: Candidate[] = [
    { label: `${name} BALL`, centers, dim: 3, rule: "shared", seed: "ball" },
    { label: `${name} SHELL`, centers, dim: 3, rule: "shared", seed: "shell" },
  ];
  if (radiiRulesDiffer(centers)) {
    out.push({
      label: `${name} BALL OWN`,
      centers,
      dim: 3,
      rule: "own",
      seed: "ball",
    });
  }
  return out;
});

/** The sweep's amplitudes, as a fraction of the base set's own edge. */
const AMPS = [0, 0.05, 0.1, 0.2, 0.35, 0.5];

function jitterRow(
  name: string,
  base: number[][],
  dim: Dim,
  seed: "ball" | "shell",
  fieldSeed: number,
  poses?: Pose4[],
): Candidate[] {
  const field = displacementField(base.length, dim, fieldSeed + FIELD_OFFSET);
  return AMPS.flatMap((amp) =>
    (["shared", "own"] as RadiusRule[]).map((rule) => ({
      label: `${name} J${amp.toFixed(2).slice(1)} ${rule === "own" ? "OWN" : "SHR"}`,
      centers: jitter(base, field, amp),
      dim,
      rule,
      seed,
      poses,
      amp,
    })),
  );
}

const ROUND_JIT3: Candidate[] = [
  ...jitterRow("O6 PEARLS", oct6(), 3, "ball", 0x0c76),
  ...jitterRow("I12 LACE", ico12(), 3, "shell", 0x1c12),
];

/** The 600-cell's 120 vertices at unit distance — the native 4D subjects'
 * arrangement, and the only 4D set the prior search left worth perturbing. */
function cell600(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0, 0];
      c[a] = s;
      out.push(c);
    }
  }
  for (let m = 0; m < 16; m++) {
    out.push([0, 1, 2, 3].map((a) => ((m >> a) & 1 ? 0.5 : -0.5)));
  }
  const evenPerms = [
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 0, 3, 2],
    [1, 2, 0, 3],
    [1, 3, 2, 0],
    [2, 0, 1, 3],
    [2, 1, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 2, 1],
    [3, 1, 0, 2],
    [3, 2, 1, 0],
  ];
  const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
  for (const perm of evenPerms) {
    for (let m = 0; m < 8; m++) {
      const v = base.map((b, i) => (i < 3 && (m >> i) & 1 ? -b : b));
      const c = [0, 0, 0, 0];
      perm.forEach((dst, src) => (c[dst] = v[src]));
      out.push(c);
    }
  }
  return out;
}

/** The identity (the search's PASSIVE equatorial slice) and one genuine
 * off-slice pose, which is where a 4D arrangement is judged. */
const POSES_4D: Pose4[] = [ID_POSE, { name: "W.15", planes: [], w0: 0.15 }];

/** The exterior camera every other round uses, NOT the 4D search's close
 * shell camera: this sweep asks whether the whole object still reads, and a
 * close-up of a shell that fills the frame cannot answer that. */
const ROUND_JIT4: Candidate[] = jitterRow(
  "C600 SHELL",
  cell600(),
  4,
  "shell",
  0x6004,
  POSES_4D,
);

describe("authored sphere-inversion generator sets: the look study", () => {
  it.runIf(!ROUND || ROUND === "r3d")(
    "3D arrangements beyond the registry, including derived sets",
    () => {
      runRound("r3d", ROUND_3D, 6);
    },
  );
  it.runIf(!ROUND || ROUND === "par")(
    "parametric families: rings, bipyramids, prisms, antiprisms, two shells",
    () => {
      runRound("par", ROUND_PAR, 6);
    },
  );
  it.runIf(ROUND === "jit3")(
    "the 3D jitter sweep: how far a regular set perturbs before it stops nesting",
    () => {
      runRound("jit3", ROUND_JIT3, 4);
    },
  );
  it.runIf(ROUND === "jit4")(
    "the 4D jitter sweep on the 600-cell, passive and genuine slices",
    () => {
      runRound("jit4", ROUND_JIT4, 4);
    },
  );
});
