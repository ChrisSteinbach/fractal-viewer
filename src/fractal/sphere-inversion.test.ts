import {
  SPHERE_INVERSION_ARRANGEMENTS,
  SPHERE_INVERSION_MAX_DEPTH,
  analyzeSphereInversionSystem,
  buildSphereInversionTables,
  resolveSphereInversion,
} from "./sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "./sphere-inversion";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o as object).forEach((v: unknown) => {
      deepFreeze(v);
    });
    Object.freeze(o);
  }
  return o;
}

function resolved(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(`refused: ${r.reasons.join("; ")}`);
  return r;
}

function refusal(authored: SphereInversionAuthored): string {
  const r = resolveSphereInversion(authored);
  if (r.ok) throw new Error("expected a refusal");
  return r.reasons.join("; ");
}

describe("sphere-inversion arrangements", () => {
  it("puts every centre at distance 1 with the documented dimension and count", () => {
    const expected: Record<string, [number, number]> = {
      oct6: [3, 6],
      cube8: [3, 8],
      ico12: [3, 12],
      cell24: [4, 24],
      tess16: [4, 16],
      cross8: [4, 8],
      cell600: [4, 120],
    };
    for (const [id, [dim, count]] of Object.entries(expected)) {
      const arr = SPHERE_INVERSION_ARRANGEMENTS[id];
      expect(arr.dim).toBe(dim);
      expect(arr.centers).toHaveLength(count);
      for (const c of arr.centers) {
        expect(c).toHaveLength(dim);
        expect(Math.hypot(...c)).toBeCloseTo(1, 14);
      }
    }
  });

  it("derives the kissing radii the pre-gate sheets used", () => {
    const t = (id: string) => SPHERE_INVERSION_ARRANGEMENTS[id].tangentRadius;
    expect(t("oct6")).toBeCloseTo(Math.SQRT1_2, 14);
    expect(t("cube8")).toBeCloseTo(1 / Math.sqrt(3), 14);
    expect(t("ico12")).toBeCloseTo(0.5257311121, 9);
    expect(t("cross8")).toBeCloseTo(Math.SQRT1_2, 14);
    expect(t("cell24")).toBeCloseTo(0.5, 14);
    expect(t("tess16")).toBeCloseTo(0.5, 14);
    expect(t("cell600")).toBeCloseTo(1 / (1 + Math.sqrt(5)), 14);
  });

  it("builds the 600-cell as 120 distinct unit vertices, each with exactly 12 nearest neighbours at the edge 1/phi", () => {
    const centers = SPHERE_INVERSION_ARRANGEMENTS.cell600.centers;
    const edge = 2 / (1 + Math.sqrt(5));
    let minDistance = Infinity;
    for (let i = 0; i < centers.length; i++) {
      let neighbours = 0;
      for (let j = 0; j < centers.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(...centers[i].map((x, a) => x - centers[j][a]));
        minDistance = Math.min(minDistance, d);
        if (Math.abs(d - edge) < 1e-12) neighbours++;
      }
      expect(neighbours).toBe(12);
    }
    expect(minDistance).toBeCloseTo(edge, 14);
  });
});

describe("resolveSphereInversion", () => {
  it("fills every absent field from the defaults", () => {
    const r = resolved({ arrangement: "oct6" });
    expect(r.construction.dim).toBe(3);
    expect(r.construction.depth).toBe(8);
    expect(r.construction.generators).toHaveLength(6);
    expect(r.construction.generators[0].radius).toBeCloseTo(
      0.99 * Math.SQRT1_2,
      14,
    );
    expect(r.construction.seed).toEqual([
      { center: [0, 0, 0], radius: 0.28, complement: false },
    ]);
    expect(r.eligibility.status).toBe("eligible");
  });

  it("resolves a 4D arrangement to 4-vector centres and a 4-ball seed", () => {
    const r = resolved({ arrangement: "tess16", seed: { size: 0.3 } });
    expect(r.construction.dim).toBe(4);
    expect(r.construction.seed[0].center).toEqual([0, 0, 0, 0]);
    for (const g of r.construction.generators) expect(g.center).toHaveLength(4);
  });

  it("expands a shell into an outer ball and an inner complement", () => {
    const r = resolved({
      arrangement: "cube8",
      seed: { kind: "shell", size: 1, thickness: 0.03 },
    });
    expect(r.construction.seed).toEqual([
      { center: [0, 0, 0], radius: 1.03, complement: false },
      { center: [0, 0, 0], radius: 0.97, complement: true },
    ]);
  });

  it("expands a cut shell with a complement ball whose surface crosses the cut direction at the offset", () => {
    const r = resolved({
      arrangement: "oct6",
      seed: {
        kind: "cutShell",
        cutDirection: [0, 2, 0],
        cutOffset: 0.25,
        cutRadius: 10,
      },
    });
    const cut = r.construction.seed[2];
    expect(cut.complement).toBe(true);
    expect(cut.center[1] - cut.radius).toBeCloseTo(0.25, 14);
    expect(cut.center[0]).toBe(0);
  });

  it("carries a 4D cut direction's w into the cut ball's centre", () => {
    const r = resolved({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "cutShell", cutDirection: [0, 0, 0], cutDirectionW: 1 },
    });
    expect(r.construction.seed[2].center).toEqual([0, 0, 0, 10.25]);
  });

  it("resolves the 600-cell pearl-window vault and medallion sphere subjects as eligible 4D constructions", () => {
    const vault = resolved({
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    });
    const medallion = resolved({
      arrangement: "cell600",
      seed: { kind: "shell", size: 1.1, thickness: 0.03 },
      depth: 5,
    });
    for (const r of [vault, medallion]) {
      expect(r.construction.dim).toBe(4);
      expect(r.construction.generators).toHaveLength(120);
      expect(r.eligibility.status).toBe("eligible");
    }
    expect(vault.construction.seed[2].center[3]).toBe(0);
  });

  it("reports exact kissing as degraded, not refused", () => {
    const r = resolved({ arrangement: "cube8", radiusFraction: 1 });
    expect(r.eligibility.status).toBe("degraded");
    expect(r.eligibility.degradations.join()).toMatch(/tangent/);
  });

  it("refuses an unknown arrangement id and names the known ones", () => {
    expect(refusal({ arrangement: "dodeca20" })).toMatch(
      /unknown arrangement "dodeca20".*oct6/,
    );
  });

  it("refuses a missing arrangement", () => {
    expect(refusal({})).toMatch(/no arrangement/);
  });

  it("refuses a radius fraction above tangency instead of clamping it", () => {
    expect(refusal({ arrangement: "oct6", radiusFraction: 1.01 })).toMatch(
      /fraction 1.01 is outside \(0, 1\]/,
    );
  });

  it("refuses a zero or non-finite radius fraction", () => {
    expect(refusal({ arrangement: "oct6", radiusFraction: 0 })).toMatch(
      /fraction/,
    );
    expect(refusal({ arrangement: "oct6", radiusFraction: NaN })).toMatch(
      /fraction/,
    );
  });

  it("refuses a fractional, negative or over-cap depth", () => {
    expect(refusal({ arrangement: "oct6", depth: 2.5 })).toMatch(/depth 2.5/);
    expect(refusal({ arrangement: "oct6", depth: -1 })).toMatch(/depth -1/);
    expect(
      refusal({ arrangement: "oct6", depth: SPHERE_INVERSION_MAX_DEPTH + 1 }),
    ).toMatch(/depth 33/);
  });

  it("admits depth 0, the bare seed", () => {
    expect(resolved({ arrangement: "oct6", depth: 0 }).construction.depth).toBe(
      0,
    );
  });

  it("refuses an unknown seed kind", () => {
    expect(refusal({ arrangement: "oct6", seed: { kind: "torus" } })).toMatch(
      /unknown seed kind "torus"/,
    );
  });

  it("admits a ball seed that crosses the generators: the seed is its intersection with the fundamental domain", () => {
    const r = resolved({
      arrangement: "oct6",
      radiusFraction: 0.93,
      seed: { size: 1.15 },
    });
    expect(r.construction.seed).toEqual([
      { center: [0, 0, 0], radius: 1.15, complement: false },
    ]);
    expect(r.eligibility.status).toBe("eligible");
  });

  it("refuses the retired cap spelling as an unknown seed kind rather than aliasing it to a ball", () => {
    expect(refusal({ arrangement: "oct6", seed: { kind: "cap" } })).toMatch(
      /unknown seed kind "cap" \(known: ball, shell, cutShell\)/,
    );
  });

  it("refuses a shell as thick as its radius", () => {
    expect(
      refusal({
        arrangement: "oct6",
        seed: { kind: "shell", size: 1, thickness: 1 },
      }),
    ).toMatch(/thickness 1 must lie in \(0, size 1\)/);
  });

  it("refuses a cut offset outside the shell", () => {
    expect(
      refusal({
        arrangement: "oct6",
        seed: { kind: "cutShell", cutOffset: 1.2 },
      }),
    ).toMatch(/cut offset 1.2/);
  });

  it("refuses a nonzero cut direction w on a 3D arrangement", () => {
    expect(
      refusal({
        arrangement: "oct6",
        seed: { kind: "cutShell", cutDirectionW: 0.5 },
      }),
    ).toMatch(/w applies only to a 4D arrangement/);
  });

  it("refuses a zero cut direction", () => {
    expect(
      refusal({
        arrangement: "cube8",
        seed: { kind: "cutShell", cutDirection: [0, 0, 0] },
      }),
    ).toMatch(/cut direction is zero/);
  });

  it("refuses a seed sphere through a generator centre (a plane image)", () => {
    expect(
      refusal({
        arrangement: "oct6",
        seed: { kind: "shell", size: 1.02, thickness: 0.02 },
      }),
    ).toMatch(/passes through generator \d+'s centre/);
  });

  it("collects every reason rather than stopping at the first", () => {
    const reasons = refusal({
      arrangement: "nope",
      radiusFraction: 2,
      depth: -3,
    });
    expect(reasons).toMatch(/unknown arrangement/);
    expect(reasons).toMatch(/fraction/);
    expect(reasons).toMatch(/depth/);
  });

  it("leaves the authored block untouched, so a caller can preserve it verbatim", () => {
    const authored = deepFreeze({
      arrangement: "ico12",
      radiusFraction: 0.97,
      seed: { kind: "cutShell", cutDirection: [1, 2, 3], extra: "kept" },
      depth: 5,
    } as SphereInversionAuthored);
    const before = JSON.stringify(authored);
    resolveSphereInversion(authored);
    expect(JSON.stringify(authored)).toBe(before);
  });
});

describe("analyzeSphereInversionSystem", () => {
  const unitOct = (radius: number): SphereInversionConstruction => ({
    dim: 3,
    generators: SPHERE_INVERSION_ARRANGEMENTS.oct6.centers.map((c) => ({
      center: c,
      radius,
    })),
    seed: [{ center: [0, 0, 0], radius: 0.2, complement: false }],
    depth: 4,
  });

  it("marks disjoint generators eligible", () => {
    expect(analyzeSphereInversionSystem(unitOct(0.6)).status).toBe("eligible");
  });

  it("refuses overlapping generators at build", () => {
    const e = analyzeSphereInversionSystem(unitOct(0.72));
    expect(e.status).toBe("ineligible");
    expect(e.reasons.join()).toMatch(/generators 1 and 3 overlap/);
  });

  it("marks tangent generators degraded", () => {
    const e = analyzeSphereInversionSystem(unitOct(Math.SQRT1_2));
    expect(e.status).toBe("degraded");
    expect(e.reasons).toEqual([]);
  });

  it("refuses a seed sphere through a generator centre at build", () => {
    const c = unitOct(0.6);
    const e = analyzeSphereInversionSystem({
      ...c,
      seed: [{ center: [0, 0, 0], radius: 1, complement: false }],
    });
    expect(e.status).toBe("ineligible");
    expect(e.reasons.join()).toMatch(/image is a plane/);
  });

  it("refuses a seed that lies inside one generator ball as empty", () => {
    const c = unitOct(0.6);
    const e = analyzeSphereInversionSystem({
      ...c,
      seed: [{ center: [1, 0, 0], radius: 0.1, complement: false }],
    });
    expect(e.reasons.join()).toMatch(/inside generator 1: the orbit is empty/);
  });

  it("refuses a seed with only complement members as unbounded", () => {
    const c = unitOct(0.6);
    const e = analyzeSphereInversionSystem({
      ...c,
      seed: [{ center: [0, 0, 0], radius: 0.1, complement: true }],
    });
    expect(e.reasons.join()).toMatch(/no bounded/);
  });

  it("refuses a centre whose length disagrees with the dimension", () => {
    const e = analyzeSphereInversionSystem({
      ...unitOct(0.6),
      dim: 4,
    });
    expect(e.reasons.join()).toMatch(/not a finite 4-vector/);
  });
});

describe("buildSphereInversionTables", () => {
  it("throws the analyzer's reasons for an ineligible construction", () => {
    expect(() =>
      buildSphereInversionTables({
        dim: 3,
        generators: [
          { center: [0, 0, 0], radius: 1 },
          { center: [0.5, 0, 0], radius: 1 },
        ],
        seed: [{ center: [3, 0, 0], radius: 0.1, complement: false }],
        depth: 2,
      }),
    ).toThrow(/overlap/);
  });

  it("lays out each copy as seed images, the parent ball, then the other generators' complements", () => {
    const r = resolved({
      arrangement: "cube8",
      seed: { kind: "shell" },
    });
    const t = buildSphereInversionTables(r.construction);
    expect(t.domainSeed.count).toBe(2 + 8);
    expect(t.copies[3].count).toBe(2 + 1 + 7);
    expect(t.copies[3].sign[2]).toBe(1);
    expect(t.copies[3].radius[2]).toBe(r.construction.generators[3].radius);
    expect(t.gaps[3].count).toBe(7);
  });

  it("encloses the generators and the bounded seed in its bounding radius", () => {
    const r = resolved({ arrangement: "oct6", seed: { size: 1.15 } });
    const t = buildSphereInversionTables(r.construction);
    expect(t.boundingRadius).toBeCloseTo(
      Math.max(1.15, 1 + 0.99 * Math.SQRT1_2),
      14,
    );
  });
});
