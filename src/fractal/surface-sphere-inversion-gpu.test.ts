import { mulberry32 } from "./rng";
import { inversionDistanceShaderSource } from "./inversion";
import {
  analyzeSphereInversionSystem,
  resolveSphereInversion,
  SPHERE_INVERSION_ARRANGEMENTS,
} from "./sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "./sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
  sphereInversionContains,
  sphereInversionHitInfo,
  sphereInversionSignedDistance,
} from "./sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionContains4,
  sphereInversionHitInfo4,
  sphereInversionSignedDistance4,
} from "./sphere-inversion-de-4d";
import {
  packSphereInversionGpuTables,
  SPHERE_INVERSION_GPU_SLACK,
  SPHERE_INVERSION_GLSL_BLOCK_BYTES,
  SPHERE_INVERSION_GLSL_COLOR_SLOTS,
  SPHERE_INVERSION_GLSL_MAX_GENERATORS,
  SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
  SPHERE_INVERSION_GLSL_TABLE_ENTRIES,
  sphereInversionF32,
  sphereInversionFragmentArmLimit,
  sphereInversionGlslBlockBytes,
  sphereInversionGlslGeneratorCeiling,
  sphereInversionSignedF32,
  sphereInversionTableEntries,
  sphereInversionWgslSource,
} from "./surface-sphere-inversion-gpu";
import type { Vec3, Vec4 } from "./types";

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

/** Uniform queries in the axis-aligned cube around the bounding ball. */
function sampleQueries(
  dim: 3 | 4,
  radius: number,
  count: number,
  seed: number,
) {
  const rng = mulberry32(seed);
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    out.push(Array.from({ length: dim }, () => (2 * rng() - 1) * radius));
  }
  return out;
}

describe("the 3D fragment arm's block capacity", () => {
  it("sizes the shipped block from the one table-entry arithmetic", () => {
    // The packer allocates from `sphereInversionTableEntries` and the arm
    // sizes `uSiTable` from it, so a construction the packer can fill is a
    // construction the block can hold — the property the caps rest on.
    expect(SPHERE_INVERSION_GLSL_TABLE_ENTRIES).toBe(931);
    expect(SPHERE_INVERSION_GLSL_COLOR_SLOTS).toBe(35);
    expect(
      sphereInversionGlslBlockBytes(
        SPHERE_INVERSION_GLSL_MAX_GENERATORS,
        SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
      ),
    ).toBe(15456);
    expect(
      sphereInversionGlslBlockBytes(
        SPHERE_INVERSION_GLSL_MAX_GENERATORS,
        SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
      ),
    ).toBeLessThanOrEqual(SPHERE_INVERSION_GLSL_BLOCK_BYTES);
  });

  it("caps generators at the block's ceiling, not at the registry's largest", () => {
    // The distinction the per-construction routing rests on: the cap is a
    // property of WebGL2's guaranteed block, so a 3D arrangement past it is
    // an ordinary compute-only construction rather than an impossibility.
    expect(SPHERE_INVERSION_GLSL_MAX_GENERATORS).toBe(
      sphereInversionGlslGeneratorCeiling(
        SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
      ),
    );
    const largest3D = Math.max(
      ...Object.values(SPHERE_INVERSION_ARRANGEMENTS)
        .filter((a) => a.dim === 3)
        .map((a) => a.centers.length),
    );
    // icosidodec30 is the registry's largest 3D arrangement and sits one
    // generator past the ceiling: the coincidence the old cap of 12 hid is
    // now a real compute-only construction, and nothing else crosses it.
    expect(largest3D).toBe(30);
    expect(SPHERE_INVERSION_GLSL_MAX_GENERATORS).toBe(29);
    const past = Object.entries(SPHERE_INVERSION_ARRANGEMENTS)
      .filter(
        ([, a]) =>
          a.dim === 3 &&
          a.centers.length > SPHERE_INVERSION_GLSL_MAX_GENERATORS,
      )
      .map(([id]) => id);
    expect(past).toEqual(["icosidodec30"]);
  });

  it("is monotone in both counts, so one check at the caps covers everything beneath", () => {
    for (let n = 1; n <= 40; n++) {
      for (let s = 1; s <= 5; s++) {
        expect(sphereInversionTableEntries(n + 1, s)).toBeGreaterThan(
          sphereInversionTableEntries(n, s),
        );
        expect(sphereInversionTableEntries(n, s + 1)).toBeGreaterThan(
          sphereInversionTableEntries(n, s),
        );
      }
    }
  });

  it("records where WebGL2's guaranteed block runs out: 29 generators at the three-member seed", () => {
    // The number a cap raise is a decision ABOUT, kept executable so the
    // next session measures rather than re-derives it. The table is
    // quadratic in n, so the ceiling moves little with the seed count.
    expect(sphereInversionGlslGeneratorCeiling(3)).toBe(29);
    expect(sphereInversionGlslBlockBytes(29, 3)).toBe(15456);
    expect(sphereInversionGlslBlockBytes(30, 3)).toBe(16448);
    expect(sphereInversionGlslGeneratorCeiling(1)).toBe(30);
    expect(sphereInversionGlslGeneratorCeiling(4)).toBe(29);
    // A dodecahedron's 20 vertices and a rhombicuboctahedron's 24 would fit
    // the arm; an icosidodecahedron's 30 would not, whatever the cap is
    // raised to.
    expect(sphereInversionGlslBlockBytes(20, 3)).toBe(7968);
    expect(sphereInversionGlslBlockBytes(24, 3)).toBe(10976);
    expect(sphereInversionGlslBlockBytes(30, 3)).toBeGreaterThan(
      SPHERE_INVERSION_GLSL_BLOCK_BYTES,
    );
  });

  it("names which limit a construction exceeds, and holds for every shipped arrangement", () => {
    for (const [id, arr] of Object.entries(SPHERE_INVERSION_ARRANGEMENTS)) {
      const tables = {
        dim: arr.dim,
        generatorCount: arr.centers.length,
        seedCount: SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
      };
      expect(sphereInversionFragmentArmLimit(tables), id).toBe(
        arr.dim === 4
          ? "dimension"
          : id === "icosidodec30"
            ? "generators"
            : null,
      );
    }
    expect(
      sphereInversionFragmentArmLimit({
        dim: 3,
        generatorCount: SPHERE_INVERSION_GLSL_MAX_GENERATORS + 1,
        seedCount: 1,
      }),
    ).toBe("generators");
    expect(
      sphereInversionFragmentArmLimit({
        dim: 3,
        generatorCount: 1,
        seedCount: SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS + 1,
      }),
    ).toBe("seedMembers");
    // 4D wins over a capacity reason: there is no arm to have capacity in.
    expect(
      sphereInversionFragmentArmLimit({
        dim: 4,
        generatorCount: 120,
        seedCount: 3,
      }),
    ).toBe("dimension");
  });
});

describe("packSphereInversionGpuTables", () => {
  it("packs the plan's sizes: oct6 ball 43 vec4, ico12 cut shell 183 vec4, the 600-cell cut shell 472,416 B", () => {
    const oct6 = packSphereInversionGpuTables(
      buildSphereInversionDE(construction({ arrangement: "oct6" })),
    );
    expect(oct6.data.byteLength).toBe(43 * 16);
    const ico = packSphereInversionGpuTables(
      buildSphereInversionDE(
        construction({ arrangement: "ico12", seed: { kind: "cutShell" } }),
      ),
    );
    expect(ico.data.byteLength).toBe(183 * 16);
    const vault = packSphereInversionGpuTables(
      buildSphereInversionDE4(
        construction({
          arrangement: "cell600",
          seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
          depth: 5,
        }),
      ),
    );
    expect(vault.data.byteLength).toBe(472_416);
    expect(vault.termStride).toBe(3 + 119);
  });

  it("lays out generators, signed seed members, seed images and gap balls at the documented entries (3D)", () => {
    const de = buildSphereInversionDE(
      construction({ arrangement: "cube8", seed: { kind: "shell" }, depth: 3 }),
    );
    const gpu = packSphereInversionGpuTables(de);
    const n = 8;
    const s = 2;
    const at = (entry: number) =>
      Array.from(gpu.data.slice(entry * 4, entry * 4 + 4));
    expect(at(5)).toEqual(
      [...de.generatorCenter.slice(15, 18), de.generatorRadius[5]].map(
        Math.fround,
      ),
    );
    // The shell's inner member is a complement: negative radius lane.
    expect(at(n + 1)[3]).toBe(Math.fround(-de.domainSeed.radius[1]));
    const j = 6;
    const base = n + s + j * (s + n - 1);
    expect(at(base + 1)).toEqual(
      [
        ...de.copies[j].center.slice(3, 6),
        de.copies[j].sign[1] * de.copies[j].radius[1],
      ].map(Math.fround),
    );
    expect(at(base + s + 4)).toEqual(
      [...de.gaps[j].center.slice(12, 15), de.gaps[j].radius[4]].map(
        Math.fround,
      ),
    );
  });

  it("lays out a 4D entry as two vec4s: the centre, then (±r, 0, 0, 0)", () => {
    const de = buildSphereInversionDE4(
      construction({ arrangement: "cell24", seed: { kind: "shell" } }),
    );
    const gpu = packSphereInversionGpuTables(de);
    const e = 24 + 1;
    expect(Array.from(gpu.data.slice(e * 8, e * 8 + 8))).toEqual(
      [0, 0, 0, 0, -de.domainSeed.radius[1], 0, 0, 0].map(Math.fround),
    );
  });

  it("marks every registry arrangement a unit arrangement, and an explicit off-unit construction not", () => {
    for (const id of Object.keys(SPHERE_INVERSION_ARRANGEMENTS)) {
      const c = construction({
        arrangement: id,
        depth: 1,
        seed: { kind: "shell", size: 1.02 },
      });
      const de =
        c.dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
      expect(packSphereInversionGpuTables(de).uniformUnit, id).toBe(true);
    }
    const base = construction({ arrangement: "oct6", depth: 2 });
    const scaled: SphereInversionConstruction = {
      ...base,
      generators: base.generators.map((g) => ({
        center: g.center.map((x) => x * 1.5),
        radius: g.radius,
      })),
    };
    expect(analyzeSphereInversionSystem(scaled).status).not.toBe("ineligible");
    const gpu = packSphereInversionGpuTables(buildSphereInversionDE(scaled));
    expect(gpu.uniformUnit).toBe(false);
    expect(gpu.uniformRadius).toBe(0);
  });
});

describe("sphereInversionWgslSource", () => {
  it("emits the shared transport verbatim and one estimator per dimension over the table binding", () => {
    for (const dim of [3, 4] as const) {
      const src = sphereInversionWgslSource(dim);
      expect(src).toContain(inversionDistanceShaderSource("wgsl"));
      const V = dim === 3 ? "vec3f" : "vec4f";
      expect(src).toContain(`fn siEstimate(q: ${V}) -> SiResult`);
      expect(src).toContain("fn siGeneration(res: SiResult) -> u32");
      expect(src).toContain("fn siSeedMember(res: SiResult) -> i32");
      expect(src).toContain("v = max(0.0, v - slack);");
    }
    expect(sphereInversionWgslSource(3)).toContain("return siTable[i].xyz;");
    expect(sphereInversionWgslSource(4)).toContain(
      "return siTable[2u * i + 1u].x;",
    );
  });

  it("emits the shipped body byte for byte unless the signed half is asked for", () => {
    for (const dim of [3, 4] as const) {
      const plain = sphereInversionWgslSource(dim);
      expect(sphereInversionWgslSource(dim, false)).toBe(plain);
      expect(plain).not.toContain("clear");
    }
  });

  it("the signed body adds only the clearance member and its one transport, leaving d unsigned", () => {
    for (const dim of [3, 4] as const) {
      const signed = sphereInversionWgslSource(dim, true);
      expect(signed).toContain("  clear: f32,");
      expect(signed).toContain(
        "var res = SiResult(0.0, x, k, status, parent, first, -1, -1, ring, -1.0);",
      );
      expect(signed).toContain("if (status == 0u && best <= 0.0) {");
      expect(signed).toContain("res.clear = max(0.0, c - slack);");
      // The exterior value is untouched text: the primary march and the
      // hit-info read the same d as an opaque session.
      expect(signed).toContain("v = max(0.0, v - slack);");
      expect(signed).toContain("  res.d = v;");
    }
  });
});

const FIXTURES_3D: [string, SphereInversionAuthored][] = [
  ["oct6 pearls D8", { arrangement: "oct6", depth: 8 }],
  ["oct6 kissing D12", { arrangement: "oct6", radiusFraction: 1, depth: 12 }],
  [
    "cube8 shell D7",
    { arrangement: "cube8", seed: { kind: "shell" }, depth: 7 },
  ],
  [
    "ico12 vault D5",
    { arrangement: "ico12", seed: { kind: "cutShell" }, depth: 5 },
  ],
];
const FIXTURES_4D: [string, SphereInversionAuthored][] = [
  [
    "cell24 shell D5",
    {
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 5,
    },
  ],
  [
    "600-cell vault D5",
    {
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    },
  ],
];

describe("sphereInversionF32 (the kernel's f32 twin) against the f64 estimator", () => {
  for (const [name, authored] of [...FIXTURES_3D, ...FIXTURES_4D]) {
    it(`${name}: never above the f64 bound on positive queries, within 4 slacks everywhere, with identical attribution`, () => {
      const c = construction(authored);
      const de =
        c.dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
      const gpu = packSphereInversionGpuTables(de);
      const qs = sampleQueries(
        c.dim,
        de.boundingRadius,
        c.dim === 3 ? 1500 : 300,
        0x51f32,
      );
      let positive = 0;
      let copyOrGap = 0;
      for (const q of qs) {
        const cpu =
          c.dim === 3
            ? estimateSphereInversionDistance(de, q as Vec3)
            : estimateSphereInversionDistance4(de, q as Vec4);
        const hit =
          c.dim === 3
            ? sphereInversionHitInfo(de, q as Vec3)
            : sphereInversionHitInfo4(de, q as Vec4);
        const twin = sphereInversionF32(gpu, q);
        expect(Math.abs(twin.d - cpu)).toBeLessThanOrEqual(
          4 * SPHERE_INVERSION_GPU_SLACK,
        );
        if (cpu > 0) {
          positive++;
          expect(twin.d).toBeLessThanOrEqual(cpu);
        }
        expect([twin.generation, twin.seedMember]).toEqual([
          hit.depth,
          hit.seedMember,
        ]);
        if (twin.termJ >= 0) copyOrGap++;
      }
      expect(positive).toBeGreaterThan(qs.length / 2);
      expect(copyOrGap).toBeGreaterThan(0);
    });
  }

  it("the unit-arrangement search is value-identical to the CPU's linear containing-ball test", () => {
    for (const [, authored] of [...FIXTURES_3D, ...FIXTURES_4D.slice(0, 1)]) {
      const c = construction(authored);
      const de =
        c.dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
      const gpu = packSphereInversionGpuTables(de);
      for (const q of sampleQueries(c.dim, de.boundingRadius, 400, 0x11ea)) {
        expect(sphereInversionF32(gpu, q)).toEqual(
          sphereInversionF32(gpu, q, true),
        );
      }
    }
  });

  it("a flat 4D embedding of oct6 reproduces the 3D twin to within the slack", () => {
    const c3 = construction({ arrangement: "oct6", depth: 8 });
    const c4: SphereInversionConstruction = {
      dim: 4,
      generators: c3.generators.map((g) => ({
        center: [...g.center, 0],
        radius: g.radius,
      })),
      seed: c3.seed.map((m) => ({ ...m, center: [...m.center, 0] })),
      depth: 8,
    };
    const g3 = packSphereInversionGpuTables(buildSphereInversionDE(c3));
    const g4 = packSphereInversionGpuTables(buildSphereInversionDE4(c4));
    for (const q of sampleQueries(3, g3.boundingRadius, 600, 0xf1a7)) {
      const a = sphereInversionF32(g3, q);
      const b = sphereInversionF32(g4, [...q, 0]);
      expect(Math.abs(a.d - b.d)).toBeLessThanOrEqual(
        SPHERE_INVERSION_GPU_SLACK,
      );
      expect(b.generation).toBe(a.generation);
    }
  });

  it("returns 0 with pole status within 2^-20 r of a generator centre, and the fold ring shrinks toward it", () => {
    const de = buildSphereInversionDE(
      construction({ arrangement: "oct6", depth: 8 }),
    );
    const gpu = packSphereInversionGpuTables(de);
    const r = de.generatorRadius[0];
    const pole = sphereInversionF32(gpu, [1 + r * 2 ** -22, 0, 0]);
    expect(pole.d).toBe(0);
    expect(pole.status).toBe(2);
    const near = sphereInversionF32(gpu, [1 + r * 0.05, 0, 0]);
    expect(near.status).not.toBe(2);
    expect(near.ring).toBeLessThan(0.06);
  });
});

/** Random queries in the bounding ball, plus points pushed toward the set's
 * boundary from both sides by bisecting between a member and a non-member —
 * the band where f32 and f64 may honestly disagree, and where an f32
 * overshoot would matter. */
function signedQueries(
  dim: 3 | 4,
  radius: number,
  contains: (q: number[]) => boolean,
  count: number,
  seed: number,
): number[][] {
  const rng = mulberry32(seed);
  const ball = () => {
    for (;;) {
      const q = Array.from({ length: dim }, () => (2 * rng() - 1) * radius);
      if (Math.hypot(...q) <= radius) return q;
    }
  };
  const members: number[][] = [];
  const out: number[][] = [];
  for (let i = 0; i < 200000 && members.length < count; i++) {
    const q = ball();
    if (contains(q)) members.push(q);
    else if (out.length < count) out.push(q);
  }
  out.push(...members);
  for (const m of members) {
    const o = out[Math.floor(rng() * Math.min(out.length, count))];
    let a = m;
    let b = o;
    const steps = 8 + Math.floor(rng() * 30);
    for (let it = 0; it < steps; it++) {
      const mid = a.map((x, i) => 0.5 * (x + b[i]));
      if (contains(mid)) a = mid;
      else b = mid;
    }
    out.push(a, b);
  }
  return out;
}

const SIGNED_FIXTURES: [string, SphereInversionAuthored][] = [
  [
    "oct6 ball .28, depth 3",
    { arrangement: "oct6", seed: { size: 0.28 }, depth: 3 },
  ],
  [
    "oct6 KISSING, depth 6",
    { arrangement: "oct6", radiusFraction: 1, depth: 6 },
  ],
  [
    "ico12 near-kissing ball .47, depth 4",
    {
      arrangement: "ico12",
      radiusFraction: 0.99,
      seed: { size: 0.47 },
      depth: 4,
    },
  ],
  [
    "oct6 generator-crossing ball 1.15 (the clearance ball swallows a centre), depth 2",
    {
      arrangement: "oct6",
      radiusFraction: 0.93,
      seed: { size: 1.15 },
      depth: 2,
    },
  ],
  [
    "cell24 ball .3, depth 3 (4D)",
    { arrangement: "cell24", seed: { size: 0.3 }, depth: 3 },
  ],
  [
    "cell24 near-kissing ball .5, depth 4 (4D)",
    {
      arrangement: "cell24",
      radiusFraction: 0.99,
      seed: { size: 0.5 },
      depth: 4,
    },
  ],
];

describe("sphereInversionSignedF32 (the signed kernel's f32 twin) against the f64 signed field", () => {
  for (const [name, authored] of SIGNED_FIXTURES) {
    it(`${name}: the exterior is the unsigned twin, membership agrees outside the slack band, and the interior never claims more clearance than f64`, () => {
      const c = construction(authored);
      const de =
        c.dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
      const gpu = packSphereInversionGpuTables(de);
      const signed64 = (q: number[]) =>
        c.dim === 3
          ? sphereInversionSignedDistance(de, q as Vec3)
          : sphereInversionSignedDistance4(de, q as Vec4);
      const contains64 = (q: number[]) =>
        c.dim === 3
          ? sphereInversionContains(de, q as Vec3)
          : sphereInversionContains4(de, q as Vec4);
      const qs = signedQueries(
        c.dim,
        de.boundingRadius,
        contains64,
        c.dim === 3 ? 400 : 150,
        0x5167,
      );
      const band = 4 * SPHERE_INVERSION_GPU_SLACK;
      let interior = 0;
      let banded = 0;
      for (const q of qs) {
        const twin = sphereInversionSignedF32(gpu, q);
        const f64 = signed64(q);
        expect(Number.isFinite(twin.field)).toBe(true);
        if (!twin.member) {
          // Outside, the signed field IS the shipped unsigned twin.
          expect(Object.is(twin.field, sphereInversionF32(gpu, q).d)).toBe(
            true,
          );
          expect(twin.clear).toBe(-1);
        }
        if (Math.abs(f64) <= band) {
          banded++;
        } else {
          expect(twin.member).toBe(contains64(q));
        }
        if (twin.member && f64 < 0) {
          interior++;
          // Conservative: never more clearance than the f64 authority,
          // which is itself certified against the explicit orbit.
          expect(twin.clear).toBeLessThanOrEqual(-f64);
          // And not vacuous: within the slack's own reach of it.
          expect(twin.clear).toBeGreaterThanOrEqual(-f64 - band);
          expect(twin.field).toBe(twin.clear === 0 ? 0 : -twin.clear);
        }
      }
      expect(interior).toBeGreaterThan(c.dim === 3 ? 150 : 50);
      expect(banded).toBeGreaterThan(0);
    });
  }

  it("a pole is a non-member at field 0, the family's defined outcome, not an interior", () => {
    const de = buildSphereInversionDE(
      construction({ arrangement: "oct6", depth: 8 }),
    );
    const gpu = packSphereInversionGpuTables(de);
    const r = de.generatorRadius[0];
    const pole = sphereInversionSignedF32(gpu, [1 + r * 2 ** -22, 0, 0]);
    expect(pole).toEqual({ field: 0, member: false, clear: -1 });
  });
});
