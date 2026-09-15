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
  sphereInversionHitInfo,
} from "./sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionHitInfo4,
} from "./sphere-inversion-de-4d";
import {
  packSphereInversionGpuTables,
  SPHERE_INVERSION_GPU_SLACK,
  sphereInversionF32,
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
