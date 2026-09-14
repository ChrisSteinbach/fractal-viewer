/**
 * THE NATIVE 4D BEAUTY SEARCH FOR SPHERE-INVERSION SEED ORBITS.
 *
 * The delegated visual gate passed the family on its 3D pearls and vaults
 * but held preset authoring until a NATIVE 4D subject reads as strongly: the
 * gate sheet's 4D fixtures (cell24 shell, tess16 kissing) change under the
 * rotor and the slice but read as sparse pearls, dust and rosette dice. This
 * sheet is that search. The construction is unchanged — disjoint (tangent
 * allowed) generator hyperspheres, generalized-ball seeds, the depth-D seed
 * orbit and its certified transported bound, all from
 * `scripts/sphere-inversion-orbit.ts` — only arrangements, seeds and poses
 * are searched. The argument for why slices dust, the candidates, the
 * winners and the failures are written out in
 * `docs/sphere-inversion-family.md` ("Native 4D beauty search").
 *
 * GENUINENESS INSTRUMENTS, per pose, over a fixed volume-uniform cloud in
 * the framing ball (MEMBERSHIP, never a distance threshold):
 *   - `off`: share of COPY members (fold spent >= 1 inversion) whose fold
 *     word uses a generator centred OFF the slice hyperplane. A word on
 *     in-plane centres never leaves the hyperplane, so `off = 0` means every
 *     visible copy is the in-plane sub-arrangement's own 3D copy.
 *   - `sub`: IoU of the slice against the EXPLICIT 3D sub-arrangement — the
 *     in-plane generators acting on the seed's own slice. 1.000 exactly when
 *     no off-plane generator meets the slice (the gate doc's passive case).
 *   - `I0`/`K0`: IoU and copy containment against the candidate's first pose
 *     (the gate sheet's columns). Containment near 1 is EROSION (the passive
 *     offset of a flat embedding); low containment is new arrangement.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion-4d-search.harness.ts
 * Env: SI4_SIZE (panel px), SI4_SHARD / SI4_SHARDS (split one round across
 * processes), SI4_ONLY (comma-separated candidate keys).
 */
import { mulberry32 } from "../src/fractal/rng";
import {
  PREVIEW_HIT,
  renderPreview,
  writeLabeledContactSheet,
} from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";
import {
  ballSeed,
  buildInversionScene,
  cell24,
  cross8,
  cube8,
  estimateInversionDistance,
  foldQuery,
  icosahedral12,
  inversionOrbitContains,
  lift4,
  makeFoldScratch,
  octahedral6,
  shellSeed,
  sliceBasis4,
  tesseract16,
} from "./sphere-inversion-orbit";
import type {
  GBall,
  Generator,
  InversionSceneSpec,
  RotorPlane,
} from "./sphere-inversion-orbit";

const SIZE = Number(process.env.SI4_SIZE ?? 128);
const SHARD = Number(process.env.SI4_SHARD ?? 0);
const SHARDS = Number(process.env.SI4_SHARDS ?? 1);
const ONLY = process.env.SI4_ONLY?.split(",").filter(Boolean);

const EYE_OFFSET: Vec3 = [1.1, 0.8, 1.3];
const ZOOM = 0.6;
const CLOUD_POINTS = 24000;
const FRAME_POINTS = 8192;

// ------------------------------------------------------------ arrangements

const PHI = (1 + Math.sqrt(5)) / 2;

/** Smallest pairwise centre distance — twice the uniform kissing radius. */
function minCentreDistance(cs: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      best = Math.min(best, Math.hypot(...cs[i].map((v, a) => v - cs[j][a])));
    }
  }
  return best;
}

/** Uniform radius `f` of the kissing radius over the given centres. */
function atKissing(cs: number[][], f: number): Generator[] {
  const r = (f * minCentreDistance(cs)) / 2;
  return cs.map((c) => ({ c, r }));
}

/** The 600-cell's 120 vertices at unit distance: the 8 axis units, the 16
 * `(±½)⁴`, and the 96 even permutations of `(±φ, ±1, ±1/φ, 0)/2`. Edge
 * `1/φ`, so the kissing radius is `1/(2φ) ≈ 0.309`. */
function cell600Centres(): number[][] {
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

/** The `N×M` duoprism's vertices on the Clifford torus `|xy| = a`,
 * `|zw| = √(1−a²)`, ring B phase-shifted by `twist·i` per ring-A step. */
function duoprismCentres(
  n: number,
  m: number,
  a: number,
  twist = 0,
): number[][] {
  const b = Math.sqrt(1 - a * a);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    for (let j = 0; j < m; j++) {
      const p = (2 * Math.PI * j) / m + twist * i;
      out.push([
        a * Math.cos(t),
        a * Math.sin(t),
        b * Math.cos(p),
        b * Math.sin(p),
      ]);
    }
  }
  return out;
}

/** Two Hopf-linked great-circle necklaces: `n` centres on the xy circle and
 * `m` on the zw circle, both at unit distance. */
function hopfRingCentres(n: number, m: number, phase = 0): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push([Math.cos(t), Math.sin(t), 0, 0]);
  }
  for (let j = 0; j < m; j++) {
    const t = (2 * Math.PI * j) / m + phase;
    out.push([0, 0, Math.cos(t), Math.sin(t)]);
  }
  return out;
}

/** Seeded random points on the unit 3-sphere with a greedy minimum
 * separation — an arrangement with no symmetry for a slice to align with. */
function randomS3Centres(count: number, minSep: number, seed: number) {
  const rng = mulberry32(seed);
  const out: number[][] = [];
  let tries = 0;
  while (out.length < count && tries++ < 200000) {
    const g = [0, 0, 0, 0].map(() => {
      const u = Math.max(1e-12, rng());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    });
    const l = Math.hypot(...g);
    const c = g.map((v) => v / l);
    if (out.every((o) => Math.hypot(...o.map((v, a) => v - c[a])) >= minSep)) {
      out.push(c);
    }
  }
  return out;
}

function ballAt(c: number[], r: number): GBall[] {
  return [{ c, r, sign: 1 }];
}

// ------------------------------------------------------------------ poses

interface Pose4 {
  name: string;
  planes: [RotorPlane, number][];
  w0: number;
}

const POSES_R1: Pose4[] = [
  { name: "ID", planes: [], w0: 0 },
  { name: "W.15", planes: [], w0: 0.15 },
  { name: "W.30", planes: [], w0: 0.3 },
  { name: "XW.3", planes: [["xw", 0.3]], w0: 0 },
  { name: "XW.5", planes: [["xw", 0.5]], w0: 0 },
  {
    name: "XW.4YW.3ZW.2",
    planes: [
      ["xw", 0.4],
      ["yw", 0.3],
      ["zw", 0.2],
    ],
    w0: 0,
  },
  {
    name: "XW.35YW.25W.2",
    planes: [
      ["xw", 0.35],
      ["yw", 0.25],
    ],
    w0: 0.2,
  },
];

/** An interior camera: absolute eye and target, the marching ball on the
 * origin at the scene's bound radius, as the 3D gate sheet's vaults. */
interface InteriorView {
  eye: Vec3;
  target: Vec3;
  zoom: number;
}

interface Candidate {
  key: string;
  spec: InversionSceneSpec;
  poses: Pose4[];
  view?: InteriorView;
  /** Exterior camera overrides. */
  eyeOffset?: Vec3;
  zoom?: number;
}

/** A 3-sphere shell cut open by the complement of a large ball whose sphere
 * passes `dist − cut` from the origin along `dir` (a 4D direction in the
 * xyz hyperplane) — still an intersection of generalized balls. */
function cutShellSeed4(
  rho: number,
  tau: number,
  dir: Vec3,
  dist: number,
  cut: number,
): GBall[] {
  const l = Math.hypot(...dir);
  return [
    ...shellSeed(rho, tau, 4),
    { c: [...dir.map((v) => (v / l) * dist), 0], r: cut, sign: -1 },
  ];
}

const VAULT_DIR: Vec3 = [0.35, 1, 0.55];
const VAULT_VIEW: InteriorView = {
  eye: [0.15, 0.3, 0.1],
  target: [-0.6, -1, 0.1],
  zoom: 0.85,
};

const cell600 = cell600Centres();

const ROUND1: Candidate[] = [
  {
    key: "C24K B.45 D6",
    spec: { dim: 4, gens: cell24(1, 0.5), seed: ballSeed(0.45, 4), depth: 6 },
    poses: POSES_R1,
  },
  {
    key: "C24D K B.45 D6",
    spec: {
      dim: 4,
      gens: [...cross8(1, 0.5), ...tesseract16(1, 0.5)],
      seed: ballSeed(0.45, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "C24D X.6T.4 B.38",
    spec: {
      dim: 4,
      gens: [...cross8(1, 0.6), ...tesseract16(1, 0.4)],
      seed: ballSeed(0.38, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "C600K B.60 D4",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: ballSeed(0.6, 4),
      depth: 4,
    },
    poses: POSES_R1,
  },
  {
    key: "C600 SH1T.04 D4",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.97),
      seed: shellSeed(1, 0.04, 4),
      depth: 4,
    },
    poses: POSES_R1,
  },
  {
    key: "HOPF66 B.45 D6",
    spec: {
      dim: 4,
      gens: atKissing(hopfRingCentres(6, 6), 0.99),
      seed: ballSeed(0.45, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "DUO66 B.60 D6",
    spec: {
      dim: 4,
      gens: atKissing(duoprismCentres(6, 6, Math.SQRT1_2), 0.99),
      seed: ballSeed(0.6, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "DUO55 B.55 D6",
    spec: {
      dim: 4,
      gens: atKissing(duoprismCentres(5, 5, Math.SQRT1_2), 0.99),
      seed: ballSeed(0.55, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "STACK O6K+8CUT D8",
    spec: {
      dim: 4,
      gens: [
        ...octahedral6(1, Math.SQRT1_2 * 0.995, 4),
        ...cube8(0.75 * Math.sqrt(3), 0.42).map((g) => ({
          c: [
            ...g.c,
            (g.c[0] > 0 ? 1 : -1) *
              (g.c[1] > 0 ? 1 : -1) *
              (g.c[2] > 0 ? 1 : -1) *
              0.3,
          ],
          r: g.r,
        })),
      ],
      seed: ballSeed(0.28, 4),
      depth: 8,
    },
    poses: POSES_R1,
  },
  {
    key: "RAND20 B.55 D6",
    spec: {
      dim: 4,
      gens: atKissing(randomS3Centres(20, 0.8, 0x4d20), 0.98),
      seed: ballSeed(0.55, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "C24K BW.25 D6",
    spec: {
      dim: 4,
      gens: cell24(1, 0.5),
      seed: ballAt([0, 0, 0, 0.25], 0.45),
      depth: 6,
    },
    poses: POSES_R1,
  },
  {
    key: "ICO12xW TESS",
    spec: {
      dim: 4,
      gens: atKissing(
        [
          ...icosahedral12(1, 0.5).map((g) => [...g.c, 0]),
          ...tesseract16(1, 0.5).map((g) => g.c),
        ],
        0.99,
      ),
      seed: ballSeed(0.5, 4),
      depth: 6,
    },
    poses: POSES_R1,
  },
];

/** The 600-cell's kiss slice: its equatorial icosidodecahedron (30 centres
 * at `w = 0`) kisses the twelve centres at `w = 1/(2φ)` at height `1/(4φ)`,
 * where both layers' caps are equal and touch inside the slice. */
const W_KISS_600 = 1 / (4 * PHI);

const POSES_R2: Pose4[] = [
  { name: "ID", planes: [], w0: 0 },
  { name: "W.08", planes: [], w0: 0.08 },
  { name: "WKISS", planes: [], w0: W_KISS_600 },
  { name: "W.25", planes: [], w0: 0.25 },
  { name: "XW.2", planes: [["xw", 0.2]], w0: 0 },
  {
    name: "XW.4YW.3ZW.2",
    planes: [
      ["xw", 0.4],
      ["yw", 0.3],
      ["zw", 0.2],
    ],
    w0: 0,
  },
  { name: "XW.3W.1", planes: [["xw", 0.3]], w0: 0.1 },
];

/** The snub 24-cell: the 600-cell minus the 24-cell (axis units and
 * `(±½)⁴`), 96 centres with 24 icosahedral holes. */
const snub24 = cell600.slice(24);

const ROUND2: Candidate[] = [
  {
    key: "C600K B.45 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: ballSeed(0.45, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
  {
    key: "C600K B.30 D6",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: ballSeed(0.3, 4),
      depth: 6,
    },
    poses: POSES_R2,
  },
  {
    key: "C600 SH1T.03 K.99 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: shellSeed(1, 0.03, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
  {
    key: "C600 SH.9T.03 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: shellSeed(0.9, 0.03, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
  {
    key: "C600 SH1.1T.03 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: shellSeed(1.1, 0.03, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
  {
    key: "VAULT C600 SH1T.04 D4",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.97),
      seed: cutShellSeed4(1, 0.04, VAULT_DIR, 10.25, 10),
      depth: 4,
    },
    poses: POSES_R2,
    view: VAULT_VIEW,
  },
  {
    key: "VAULT C600K SH1T.04 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.995),
      seed: cutShellSeed4(1, 0.04, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    poses: POSES_R2,
    view: VAULT_VIEW,
  },
  {
    key: "VAULT C24 SH1T.05 D5",
    spec: {
      dim: 4,
      gens: cell24(1, 0.49),
      seed: cutShellSeed4(1, 0.05, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    poses: POSES_R1,
    view: VAULT_VIEW,
  },
  {
    key: "SNUB24 B.45 D5",
    spec: {
      dim: 4,
      gens: atKissing(snub24, 0.99),
      seed: ballSeed(0.45, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
  {
    key: "SNUB24 SH1T.03 D5",
    spec: {
      dim: 4,
      gens: atKissing(snub24, 0.99),
      seed: shellSeed(1, 0.03, 4),
      depth: 5,
    },
    poses: POSES_R2,
  },
];

/** Near-identity poses: the 600-cell's equatorial slice is a passive
 * icosidodecahedral lace cage, and its nearest off-slice layer is TANGENT to
 * it, so the first genuinely 4D copies appear at the smallest offsets. */
const POSES_LACE: Pose4[] = [
  { name: "ID", planes: [], w0: 0 },
  { name: "W.03", planes: [], w0: 0.03 },
  { name: "W.06", planes: [], w0: 0.06 },
  { name: "W.10", planes: [], w0: 0.1 },
  { name: "XW.08", planes: [["xw", 0.08]], w0: 0 },
  { name: "XW.15", planes: [["xw", 0.15]], w0: 0 },
  {
    name: "XW.1YW.07ZW.05",
    planes: [
      ["xw", 0.1],
      ["yw", 0.07],
      ["zw", 0.05],
    ],
    w0: 0,
  },
  { name: "XW.1W.04", planes: [["xw", 0.1]], w0: 0.04 },
];

const POSES_SHELL: Pose4[] = [
  { name: "ID", planes: [], w0: 0 },
  { name: "W.08", planes: [], w0: 0.08 },
  { name: "WKISS", planes: [], w0: W_KISS_600 },
  { name: "XW.2", planes: [["xw", 0.2]], w0: 0 },
  {
    name: "XW.4YW.3ZW.2",
    planes: [
      ["xw", 0.4],
      ["yw", 0.3],
      ["zw", 0.2],
    ],
    w0: 0,
  },
  { name: "XW.3W.1", planes: [["xw", 0.3]], w0: 0.1 },
];

/** Interior views lit at a grazing angle. The gate's vault target faced the
 * light head-on (inward normal · light ≈ 0.9) and washed the 600-cell's
 * small windows out; these look at wall points whose inward normal meets the
 * fixed light at ~0.5 (A, from near the centre) and ~0.7 (B, close to the
 * wall), away from the cut. */
const VAULT_A: InteriorView = {
  eye: [0.35, -0.05, 0.06],
  target: [-0.99, 0.15, -0.18],
  zoom: 0.8,
};
const VAULT_B: InteriorView = {
  eye: [-0.21, -0.41, 0.19],
  target: [-0.42, -0.82, 0.38],
  zoom: 0.85,
};

const ROUND3: Candidate[] = [
  {
    key: "LACE600 B.20 D7",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.995),
      seed: ballSeed(0.2, 4),
      depth: 7,
    },
    poses: POSES_LACE,
  },
  {
    key: "LACE600 B.30 D6",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.995),
      seed: ballSeed(0.3, 4),
      depth: 6,
    },
    poses: POSES_LACE,
  },
  {
    key: "SHIN600 SH.9T.03 D6",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: shellSeed(0.9, 0.03, 4),
      depth: 6,
    },
    poses: POSES_SHELL,
    eyeOffset: [0.8, 0.6, 0.95],
  },
  {
    key: "SHOUT600 SH1.1T.03 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: shellSeed(1.1, 0.03, 4),
      depth: 5,
    },
    poses: POSES_SHELL,
    eyeOffset: [0.8, 0.6, 0.95],
  },
  {
    key: "VA600 SH1T.04 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: cutShellSeed4(1, 0.04, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    poses: POSES_SHELL,
    view: VAULT_A,
  },
  {
    key: "VB600 SH1T.04 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: cutShellSeed4(1, 0.04, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    poses: POSES_SHELL,
    view: VAULT_B,
  },
  {
    key: "VB600 SH.9T.04 D5",
    spec: {
      dim: 4,
      gens: atKissing(cell600, 0.99),
      seed: cutShellSeed4(0.9, 0.04, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    poses: POSES_SHELL,
    view: VAULT_B,
  },
];

// ------------------------------------------------------------ measurement

interface PoseResult {
  pose: Pose4;
  stats: PanelStats;
  fill: number;
  copyShare: number;
  off: number;
  sub: number;
  iou0: number;
  contain0: number;
  /** Share of HIT pixels whose surface point folds through >= 1 inversion.
   * The cloud columns are volume-weighted and read ~0 for lace, which is
   * all surface and no volume; these are the image-weighted twins. */
  copyPx: number;
  /** Of those copy pixels, the share whose fold word uses an off-slice
   * centre — the pixels no 3D sub-arrangement can have drawn. */
  offPx: number;
  /** Percent of pixels whose colour differs (any channel > 24/255) from the
   * explicit 3D sub-arrangement rendered through the same camera. */
  subDiff: number;
}

function cloud3(R: number): Float64Array {
  const rng = mulberry32(0x5eed_4d51);
  const pts = new Float64Array(CLOUD_POINTS * 3);
  for (let i = 0; i < CLOUD_POINTS; i++) {
    const u = Math.cbrt(rng()) * R;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts[i * 3] = u * st * Math.cos(ph);
    pts[i * 3 + 1] = u * st * Math.sin(ph);
    pts[i * 3 + 2] = u * ct;
  }
  return pts;
}

const dot4 = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/**
 * The slice's EXPLICIT 3D sub-arrangement: generators centred in the slice
 * hyperplane, acting on the seed's own slice. Null when the seed misses the
 * slice entirely (every member is then a non-member of both).
 */
function subArrangement(
  spec: InversionSceneSpec,
  pose: Pose4,
): InversionSceneSpec | null {
  const basis = sliceBasis4(pose.planes);
  const toSlice = (c: number[]) => [0, 1, 2].map((a) => dot4(basis[a], c));
  const gens: Generator[] = [];
  for (const g of spec.gens) {
    if (Math.abs(dot4(basis[3], g.c) - pose.w0) < 1e-9) {
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

function measureCandidate(cand: Candidate, size: number) {
  const scene = buildInversionScene(cand.spec);
  const scratch = makeFoldScratch(scene);
  const lifts = cand.poses.map((p) => lift4(p.planes, p.w0));
  const reaches = cand.poses.map((_, i) =>
    cand.view
      ? 0
      : sampleSetExtent(
          (p) => inversionOrbitContains(scene, lifts[i](p), scratch),
          { fillRadius: scene.boundRadius, points: FRAME_POINTS },
        ).reachAbs,
  );
  const R = cand.view
    ? scene.boundRadius
    : Math.max(0.2, Math.max(...reaches) * 1.06);
  const cloud = cloud3(R);
  const masks: Uint8Array[] = [];
  const copyMasks: Uint8Array[] = [];
  const results: PoseResult[] = cand.poses.map((pose, i) => {
    const basis = sliceBasis4(pose.planes);
    const offPlane = cand.spec.gens.map(
      (g) => Math.abs(dot4(basis[3], g.c) - pose.w0) >= 1e-9,
    );
    const mask = new Uint8Array(CLOUD_POINTS);
    const copyMask = new Uint8Array(CLOUD_POINTS);
    let members = 0;
    let copies = 0;
    let offCopies = 0;
    const p3: Vec3 = [0, 0, 0];
    for (let k = 0; k < CLOUD_POINTS; k++) {
      p3[0] = cloud[k * 3];
      p3[1] = cloud[k * 3 + 1];
      p3[2] = cloud[k * 3 + 2];
      if (!inversionOrbitContains(scene, lifts[i](p3), scratch)) continue;
      mask[k] = 1;
      members++;
      const f = foldQuery(scene, lifts[i](p3), scratch);
      if (f.k === 0) continue;
      copyMask[k] = 1;
      copies++;
      for (let s = 0; s < f.k; s++) {
        if (offPlane[f.word[s]]) {
          offCopies++;
          break;
        }
      }
    }
    masks.push(mask);
    copyMasks.push(copyMask);
    let sub = NaN;
    const subSpec = subArrangement(cand.spec, pose);
    try {
      let inter = 0;
      let union = 0;
      const s3 = subSpec ? buildInversionScene(subSpec) : null;
      const sc3 = s3 ? makeFoldScratch(s3) : null;
      for (let k = 0; k < CLOUD_POINTS; k++) {
        p3[0] = cloud[k * 3];
        p3[1] = cloud[k * 3 + 1];
        p3[2] = cloud[k * 3 + 2];
        const m3 = s3 ? inversionOrbitContains(s3, p3, sc3!) : false;
        if (m3 && mask[k]) inter++;
        if (m3 || mask[k]) union++;
      }
      sub = union > 0 ? inter / union : 1;
    } catch {
      // A sliced seed through an in-plane centre: no 3D twin to compare.
    }
    const camera = (
      de: (p: Vec3) => number,
      collect: boolean,
    ): PreviewScene => {
      const preview: PreviewScene = {
        de,
        boundingRadius: R,
        stepScale: 1,
        eyeOffset: cand.eyeOffset ?? EYE_OFFSET,
        zoom: cand.zoom ?? ZOOM,
        collect,
      };
      if (cand.view) {
        preview.eye = cand.view.eye;
        preview.target = cand.view.target;
        preview.boundingCenter = [0, 0, 0];
        preview.zoom = cand.view.zoom;
        preview.shadow = false;
        preview.fog = false;
      }
      return preview;
    };
    const stats = renderPreview(
      camera(
        (p) => estimateInversionDistance(scene, lifts[i](p), scratch),
        true,
      ),
      size,
    );
    let hitPx = 0;
    let copyPx = 0;
    let offPx = 0;
    for (let px = 0; px < size * size; px++) {
      if (stats.status![px] !== PREVIEW_HIT) continue;
      hitPx++;
      p3[0] = stats.hitPos![px * 3];
      p3[1] = stats.hitPos![px * 3 + 1];
      p3[2] = stats.hitPos![px * 3 + 2];
      const f = foldQuery(scene, lifts[i](p3), scratch);
      if (f.k === 0) continue;
      copyPx++;
      for (let t = 0; t < f.k; t++) {
        if (offPlane[f.word[t]]) {
          offPx++;
          break;
        }
      }
    }
    let subDiff = NaN;
    try {
      if (subSpec) {
        const s3 = buildInversionScene(subSpec);
        const sc3 = makeFoldScratch(s3);
        const twin = renderPreview(
          camera((p) => estimateInversionDistance(s3, p, sc3), false),
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
        subDiff = (100 * differ) / (size * size);
      }
    } catch {
      // No 3D twin (sliced seed through an in-plane centre).
    }
    return {
      pose,
      stats,
      copyPx: hitPx > 0 ? copyPx / hitPx : 0,
      offPx: copyPx > 0 ? offPx / copyPx : 0,
      subDiff,
      fill: (100 * members) / CLOUD_POINTS,
      copyShare: members > 0 ? copies / members : 0,
      off: copies > 0 ? offCopies / copies : 0,
      sub,
      iou0: 0,
      contain0: 0,
    };
  });
  results.forEach((r, i) => {
    let inter = 0;
    let union = 0;
    let inRef = 0;
    let count = 0;
    for (let k = 0; k < CLOUD_POINTS; k++) {
      if (masks[i][k] && masks[0][k]) inter++;
      if (masks[i][k] || masks[0][k]) union++;
      if (copyMasks[i][k]) {
        count++;
        if (masks[0][k]) inRef++;
      }
    }
    r.iou0 = union > 0 ? inter / union : 1;
    r.contain0 = count > 0 ? inRef / count : 1;
  });
  return { R, results, boundRadius: scene.boundRadius, gens: scene.n };
}

function pct(n: number, size: number): string {
  return ((100 * n) / (size * size)).toFixed(0);
}

function blankPanel(size: number): PanelStats {
  return {
    rgb: new Uint8Array(size * size * 3).fill(18),
    width: size,
    height: size,
    hits: 0,
    evals: 0,
    steps: 0,
    ms: 0,
    exhausted: 0,
  };
}

function runRound(round: string, candidates: Candidate[]): void {
  const mine = candidates.filter((c, i) =>
    ONLY ? ONLY.includes(c.key) : i % SHARDS === SHARD,
  );
  if (mine.length === 0) return;
  const cols = Math.max(...mine.map((c) => c.poses.length));
  const panels: { stats: PanelStats; lines: [string, string] }[] = [];
  for (const cand of mine) {
    const started = Date.now();
    const m = measureCandidate(cand, SIZE);
    console.log(
      `\n  [${round}] ${cand.key} — ${m.gens} gens, bound ${m.boundRadius.toFixed(3)}, ` +
        `framed R ${m.R.toFixed(3)}, ${((Date.now() - started) / 1000).toFixed(1)}s total`,
    );
    for (const r of m.results) {
      const px = SIZE * SIZE;
      console.log(
        `    ${r.pose.name.padEnd(16)} H${pct(r.stats.hits, SIZE).padStart(3)} ` +
          `X${((100 * r.stats.exhausted) / px).toFixed(2)} ` +
          `S${(r.stats.steps / px).toFixed(1)} ${r.stats.ms}ms  ` +
          `fill ${r.fill.toFixed(2)}% copies ${r.copyShare.toFixed(2)} ` +
          `off ${r.off.toFixed(2)} sub ${r.sub.toFixed(3)} ` +
          `I0 ${r.iou0.toFixed(2)} K0 ${r.contain0.toFixed(2)}  ` +
          `px: copies ${r.copyPx.toFixed(2)} off ${r.offPx.toFixed(2)} ` +
          `vs3D ${r.subDiff.toFixed(1)}%`,
      );
      panels.push({
        stats: r.stats,
        lines: [
          `${cand.key.split(" ")[0]} ${r.pose.name}`,
          `H${pct(r.stats.hits, SIZE)} O${r.offPx.toFixed(2).replace(/^0/, "")} ` +
            `D${Number.isNaN(r.subDiff) ? "-" : r.subDiff.toFixed(0)} ` +
            `K${r.contain0.toFixed(2).replace(/^0/, "")}`,
        ],
      });
    }
    for (let i = m.results.length; i < cols; i++) {
      panels.push({ stats: blankPanel(SIZE), lines: ["", ""] });
    }
  }
  const tag = ONLY ? "only" : `s${SHARD}`;
  console.log(
    `  wrote ${writeLabeledContactSheet(
      panels,
      cols,
      `sphere-inversion-4d-search-${round}-${tag}.png`,
    )}`,
  );
}

const ROUND = process.env.SI4_ROUND;

describe("native 4D sphere-inversion beauty search", () => {
  it.runIf(!ROUND || ROUND === "r1")(
    "round 1: arrangement families under one pose sequence",
    () => {
      runRound("r1", ROUND1);
    },
  );
  it.runIf(!ROUND || ROUND === "r2")(
    "round 2: the 600-cell's seeds, kiss slices and interior vaults",
    () => {
      runRound("r2", ROUND2);
    },
  );
  it.runIf(!ROUND || ROUND === "r3")(
    "round 3: 600-cell lace near the equatorial slice, close shells, lit vaults",
    () => {
      runRound("r3", ROUND3);
    },
  );
});
