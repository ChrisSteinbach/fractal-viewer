import { mulberry32 } from "./rng";
import { resolveSphereInversion } from "./sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "./sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
  sphereInversionContains,
} from "./sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionContains4,
} from "./sphere-inversion-de-4d";
import {
  enumerateSeedOrbit,
  explicitOrbitDistance,
  nearestPointOnPiece,
} from "./sphere-inversion-oracle";
import {
  applySphereInversionWord,
  prepareSphereInversionSampler,
  sampleSphereInversionCloud,
  sampleSphereInversionPoint,
} from "./sphere-inversion-sample";
import type {
  SphereInversionSampleDetail,
  SphereInversionSampler,
} from "./sphere-inversion-sample";
import type { Vec3, Vec4 } from "./types";

/**
 * The sampler is pinned against the OBJECT: the independent explicit-orbit
 * oracle (true distance, attained nearest points) and the estimators'
 * membership, never against its own patch bookkeeping.
 */

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

interface Sample {
  point: number[];
  generation: number;
  detail: SphereInversionSampleDetail;
}

function samples(
  sampler: SphereInversionSampler,
  count: number,
  seed: number,
): Sample[] {
  const rng = mulberry32(seed);
  const out: Sample[] = [];
  const point = new Float64Array(sampler.dim);
  for (let i = 0; i < count; i++) {
    const detail: SphereInversionSampleDetail = {
      patch: -1,
      seedPoint: [],
      seedNormal: [],
      word: [],
    };
    const generation = sampleSphereInversionPoint(sampler, rng, point, detail);
    if (generation < 0) throw new Error("sample budget exhausted");
    out.push({ point: Array.from(point), generation, detail });
  }
  return out;
}

function contains(c: SphereInversionConstruction) {
  if (c.dim === 3) {
    const de = buildSphereInversionDE(c);
    return (p: number[]) => sphereInversionContains(de, p as Vec3);
  }
  const de = buildSphereInversionDE4(c);
  return (p: number[]) => sphereInversionContains4(de, p as Vec4);
}

/** Distance from a seed point to the nearest sphere of `K ∩ F` other than
 * its own patch's: the membrane check skips points this close to an edge,
 * where an offset along the normal can cross a second constraint. */
function edgeClearance(
  c: SphereInversionConstruction,
  sampler: SphereInversionSampler,
  s: Sample,
): number {
  const patch = sampler.patches[s.detail.patch];
  const spheres = [
    ...c.seed.map((m, i) => ({ kind: "seed", i, m })),
    ...c.generators.map((m, i) => ({ kind: "wall", i, m })),
  ];
  let best = Infinity;
  for (const { kind, i, m } of spheres) {
    if (kind === patch.kind && i === patch.member) continue;
    const d = Math.hypot(...s.detail.seedPoint.map((v, a) => v - m.center[a]));
    best = Math.min(best, Math.abs(d - m.radius));
  }
  return best;
}

const MEMBRANE_OFFSET = 1e-6;
const MEMBRANE_EDGE = 1e-4;

/** The two points a hair either side of a sample's patch, carried through
 * the sample's own word. */
function sides(sampler: SphereInversionSampler, s: Sample): number[][] {
  return [1, -1].map((sign) =>
    applySphereInversionWord(
      sampler,
      s.detail.word,
      s.detail.seedPoint.map(
        (v, a) => v + sign * MEMBRANE_OFFSET * s.detail.seedNormal[a],
      ),
    ),
  );
}

const ORACLE_FIXTURES: [string, SphereInversionAuthored, number][] = [
  ["oct6 pearls ball, depth 2 (3D)", { arrangement: "oct6", depth: 2 }, 300],
  [
    "cube8 lace shell, depth 2 (3D)",
    { arrangement: "cube8", seed: { kind: "shell" }, depth: 2 },
    300,
  ],
  [
    "ico12 cut-shell vault, depth 2 (3D)",
    {
      arrangement: "ico12",
      radiusFraction: 0.95,
      seed: { kind: "cutShell" },
      depth: 2,
    },
    300,
  ],
  [
    "tess16 kissing ball .5, depth 2 (4D)",
    { arrangement: "tess16", radiusFraction: 1, seed: { size: 0.5 }, depth: 2 },
    120,
  ],
  [
    "cell24 perforated shell, depth 1 (4D)",
    {
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 1,
    },
    120,
  ],
  [
    "cell600 pearl-window vault, depth 1 (4D)",
    {
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 1,
    },
    60,
  ],
];

describe("sampleSphereInversionPoint against the explicit orbit", () => {
  for (const [label, authored, count] of ORACLE_FIXTURES) {
    it(`${label}: every sample lies on the depth-matched orbit`, () => {
      const c = construction(authored);
      const sampler = prepareSphereInversionSampler(c);
      const pieces = enumerateSeedOrbit(c);
      for (const s of samples(sampler, count, 0x5a3 + c.generators.length)) {
        expect(
          explicitOrbitDistance(pieces, s.point),
          `at ${s.point.join(",")} word ${s.detail.word.join(",")}`,
        ).toBeLessThanOrEqual(1e-9);
      }
    });
  }
});

const PRODUCTION_FIXTURES: [string, SphereInversionAuthored][] = [
  ["oct6 pearls, depth 8 (3D)", { arrangement: "oct6", depth: 8 }],
  [
    "ico12 lace shell, depth 6 (3D)",
    { arrangement: "ico12", seed: { kind: "shell" }, depth: 6 },
  ],
  [
    "cell24 perforated shell, depth 5 (4D)",
    {
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 5,
    },
  ],
  [
    "cell600 pearl-window vault, depth 5 (4D)",
    {
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    },
  ],
  [
    "cell600 medallion sphere, depth 5 (4D)",
    {
      arrangement: "cell600",
      seed: { kind: "shell", size: 1.1, thickness: 0.03 },
      depth: 5,
    },
  ],
];

describe("sampleSphereInversionCloud at production depth", () => {
  for (const [label, authored] of PRODUCTION_FIXTURES) {
    it(`${label}: the certified estimator reads every sample as on the set`, () => {
      const c = construction(authored);
      const sampler = prepareSphereInversionSampler(c);
      const cloud = sampleSphereInversionCloud(sampler, 400, mulberry32(0xd5));
      expect(cloud.count).toBe(400);
      const estimate =
        c.dim === 3
          ? (p: number[]) =>
              estimateSphereInversionDistance(
                buildSphereInversionDE(c),
                p as Vec3,
              )
          : (() => {
              const de = buildSphereInversionDE4(c);
              return (p: number[]) =>
                estimateSphereInversionDistance4(de, p as Vec4);
            })();
      for (let i = 0; i < cloud.count; i++) {
        const p = [0, 1, 2].map((a) => cloud.positions[i * 3 + a]);
        if (cloud.w) p.push(cloud.w[i]);
        // The cloud is f32: the bound is checked at the rounding scale.
        expect(estimate(p), `at ${p.join(",")}`).toBeLessThanOrEqual(1e-6);
      }
    });
  }

  it("oct6 pearls depth 8 in f64: the estimator reads every sample within 1e-9", () => {
    const c = construction({ arrangement: "oct6", depth: 8 });
    const de = buildSphereInversionDE(c);
    for (const s of samples(prepareSphereInversionSampler(c), 400, 0xe8)) {
      expect(
        estimateSphereInversionDistance(de, s.point as Vec3),
      ).toBeLessThanOrEqual(1e-9);
    }
  });

  it("cell600 vault depth 5 in f64: the estimator reads every sample within 1e-9", () => {
    const c = construction({
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    });
    const de = buildSphereInversionDE4(c);
    for (const s of samples(prepareSphereInversionSampler(c), 400, 0xe9)) {
      expect(
        estimateSphereInversionDistance4(de, s.point as Vec4),
      ).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe("sampled points are boundary, not internal membranes", () => {
  const MEMBRANE_FIXTURES: [string, SphereInversionAuthored][] = [
    [
      "cube8 lace shell, depth 3 (3D)",
      { arrangement: "cube8", seed: { kind: "shell" }, depth: 3 },
    ],
    [
      "ico12 cut-shell vault, depth 4 (3D)",
      {
        arrangement: "ico12",
        radiusFraction: 0.95,
        seed: { kind: "cutShell" },
        depth: 4,
      },
    ],
    [
      "cell24 perforated shell, depth 3 (4D)",
      {
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 3,
      },
    ],
    [
      "cell600 medallion sphere, depth 3 (4D)",
      {
        arrangement: "cell600",
        seed: { kind: "shell", size: 1.1, thickness: 0.03 },
        depth: 3,
      },
    ],
  ];

  for (const [label, authored] of MEMBRANE_FIXTURES) {
    it(`${label}: exactly one side of every sample is a member`, () => {
      const c = construction(authored);
      const sampler = prepareSphereInversionSampler(c);
      const member = contains(c);
      let checked = 0;
      let walls = 0;
      for (const s of samples(sampler, 600, 0x3e3 + c.generators.length)) {
        if (edgeClearance(c, sampler, s) < MEMBRANE_EDGE) continue;
        checked++;
        if (sampler.patches[s.detail.patch].kind === "wall") walls++;
        const [out, inn] = sides(sampler, s).map(member);
        expect(
          out !== inn,
          `word ${s.detail.word.join(",")} patch ${s.detail.patch}`,
        ).toBe(true);
      }
      expect(checked).toBeGreaterThan(500);
      expect(walls).toBeGreaterThan(0);
    });
  }

  it("negative control: a depth-0 wall sample is an internal membrane of the depth-1 orbit", () => {
    const shell: SphereInversionAuthored = {
      arrangement: "cube8",
      seed: { kind: "shell" },
      depth: 0,
    };
    const c0 = construction(shell);
    const sampler = prepareSphereInversionSampler(c0);
    const depth1Member = contains(construction({ ...shell, depth: 1 }));
    let walls = 0;
    for (const s of samples(sampler, 400, 0xc0)) {
      if (sampler.patches[s.detail.patch].kind !== "wall") continue;
      if (edgeClearance(c0, sampler, s) < MEMBRANE_EDGE) continue;
      walls++;
      const [out, inn] = sides(sampler, s).map(depth1Member);
      expect(out && inn).toBe(true);
    }
    expect(walls).toBeGreaterThan(20);
  });

  it("the same depth-0 wall samples pass the check against the depth-0 orbit", () => {
    const c0 = construction({
      arrangement: "cube8",
      seed: { kind: "shell" },
      depth: 0,
    });
    const sampler = prepareSphereInversionSampler(c0);
    const member = contains(c0);
    let walls = 0;
    for (const s of samples(sampler, 400, 0xc0)) {
      if (sampler.patches[s.detail.patch].kind !== "wall") continue;
      if (edgeClearance(c0, sampler, s) < MEMBRANE_EDGE) continue;
      walls++;
      const [out, inn] = sides(sampler, s).map(member);
      expect(out !== inn).toBe(true);
    }
    expect(walls).toBeGreaterThan(20);
  });
});

describe("sampled clouds cover the depth-1 boundary", () => {
  const COVERAGE_FIXTURES: [string, SphereInversionAuthored, number, number][] =
    [
      ["oct6 pearls (3D)", { arrangement: "oct6", depth: 1 }, 20000, 0.05],
      [
        "cube8 lace shell (3D)",
        { arrangement: "cube8", seed: { kind: "shell" }, depth: 1 },
        20000,
        0.05,
      ],
      [
        "tess16 kissing ball .5 (4D)",
        {
          arrangement: "tess16",
          radiusFraction: 1,
          seed: { size: 0.5 },
          depth: 1,
        },
        40000,
        0.12,
      ],
    ];

  for (const [label, authored, count, reach] of COVERAGE_FIXTURES) {
    it(`${label}: every nearest boundary point has a sample within ${reach}`, () => {
      const c = construction(authored);
      const pieces = enumerateSeedOrbit(c);
      const cloud = sampleSphereInversionCloud(
        prepareSphereInversionSampler(c),
        count,
        mulberry32(0xc07),
      );
      const rng = mulberry32(0x9e7);
      let queried = 0;
      while (queried < 80) {
        const p = Array.from({ length: c.dim }, () => 2.4 * rng() - 1.2);
        let best: { distance: number; point: number[] | null } = {
          distance: Infinity,
          point: null,
        };
        for (const piece of pieces) {
          const r = nearestPointOnPiece(piece, p, best.distance);
          if (r.distance < best.distance) best = r;
        }
        if (!best.point || best.distance === 0) continue;
        queried++;
        const q = best.point;
        let nearest = Infinity;
        for (let i = 0; i < cloud.count; i++) {
          let d2 = 0;
          for (let a = 0; a < 3; a++) {
            d2 += (cloud.positions[i * 3 + a] - q[a]) ** 2;
          }
          if (cloud.w) d2 += (cloud.w[i] - q[3]) ** 2;
          nearest = Math.min(nearest, d2);
        }
        expect(Math.sqrt(nearest), `near ${q.join(",")}`).toBeLessThan(reach);
      }
    });
  }
});

describe("sampled generations", () => {
  it("a sample's generation is its word's length, within the depth", () => {
    const c = construction({ arrangement: "oct6", depth: 3 });
    for (const s of samples(prepareSphereInversionSampler(c), 400, 0x6e)) {
      expect(s.generation).toBe(s.detail.word.length);
      expect(s.generation).toBeLessThanOrEqual(3);
    }
  });

  it("every generation from 0 to the depth is drawn", () => {
    const c = construction({ arrangement: "oct6", depth: 3 });
    const cloud = sampleSphereInversionCloud(
      prepareSphereInversionSampler(c),
      4000,
      mulberry32(0x6f),
    );
    expect(new Set(cloud.generations)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("native 4D samples", () => {
  it("cell600 vault: samples spread across w rather than sitting on one hyperplane", () => {
    const c = construction({
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    });
    const cloud = sampleSphereInversionCloud(
      prepareSphereInversionSampler(c),
      2000,
      mulberry32(0x4d),
    );
    const w = Array.from(cloud.w ?? []);
    expect(w).toHaveLength(cloud.count);
    expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(1);
    expect(w.filter((v) => Math.abs(v) > 0.3).length).toBeGreaterThan(200);
  });

  it("a 3D cloud carries no w", () => {
    const c = construction({ arrangement: "oct6", depth: 2 });
    const cloud = sampleSphereInversionCloud(
      prepareSphereInversionSampler(c),
      10,
      mulberry32(1),
    );
    expect(cloud.w).toBeNull();
  });
});

describe("sampler determinism", () => {
  it("the same caller seed reproduces the cloud exactly", () => {
    const c = construction({
      arrangement: "ico12",
      seed: { kind: "cutShell" },
      depth: 4,
    });
    const a = sampleSphereInversionCloud(
      prepareSphereInversionSampler(c),
      500,
      mulberry32(77),
    );
    const b = sampleSphereInversionCloud(
      prepareSphereInversionSampler(c),
      500,
      mulberry32(77),
    );
    expect(b.positions).toEqual(a.positions);
    expect(b.generations).toEqual(a.generations);
  });

  it("the patch weights do not depend on anything but the construction", () => {
    const c = construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 3,
    });
    const first = prepareSphereInversionSampler(c);
    sampleSphereInversionCloud(first, 200, mulberry32(3));
    const second = prepareSphereInversionSampler(c);
    expect(second.patches.map((p) => p.weight)).toEqual(
      first.patches.map((p) => p.weight),
    );
  });

  it("a different caller seed draws a different cloud", () => {
    const c = construction({ arrangement: "oct6", depth: 3 });
    const sampler = prepareSphereInversionSampler(c);
    const a = sampleSphereInversionCloud(sampler, 50, mulberry32(1));
    const b = sampleSphereInversionCloud(sampler, 50, mulberry32(2));
    expect(b.positions).not.toEqual(a.positions);
  });
});
