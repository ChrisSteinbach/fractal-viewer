import {
  mandelboxCube,
  mandelbulbClassic,
  pentatope,
  sierpinskiTetrahedron,
} from "./presets";
import { resolvePointTilingSession } from "./point-tiling-session";
import type { TilingSpec } from "./tiling";
import type { SymmetryParams, Transform } from "./types";

const TETRA = sierpinskiTetrahedron();
const PENTATOPE = pentatope();
const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

function resolve(
  transforms: Transform[],
  tiling: TilingSpec | null,
  options: {
    balloonEcho?: boolean;
    fourD?: boolean;
    symmetry?: SymmetryParams;
  } = {},
) {
  return resolvePointTilingSession(
    transforms,
    null,
    options.symmetry ?? NO_SYMMETRY,
    null,
    tiling,
    options.balloonEcho ?? false,
    options.fourD ?? false,
  );
}

describe("resolvePointTilingSession", () => {
  it("returns the allocation-free off state before inspecting the system", () => {
    expect(resolve([], null)).toEqual({
      status: "off",
      plan: null,
      resolved: null,
      note: null,
    });
  });

  it("builds and poses a complete 3D finite plan from the inverse estimator", () => {
    const result = resolve(TETRA, {
      group: "a3",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.5 },
            combine: "union",
          },
        ],
      },
    });
    expect(result.status).toBe("active");
    if (result.status !== "active") return;
    expect(result.plan.kind).toBe("finite");
    expect(result.plan.dimension).toBe(3);
    expect(result.originVisibleRadius).toBeGreaterThan(0);
    expect(result.resolved.clip?.parts[0].pose?.scale).toBeGreaterThan(0);
    expect(result.plan.tiling).toBe(result.resolved);
  });

  it("builds the genuine 4D finite twin from the 4D inverse estimator", () => {
    const result = resolve(PENTATOPE, { group: "f4" }, { fourD: true });
    expect(result.status).toBe("active");
    if (result.status !== "active") return;
    expect(result.plan.kind).toBe("finite");
    expect(result.plan.dimension).toBe(4);
    expect(result.originVisibleRadius).toBeGreaterThan(0);
    expect("info" in result.resolved && result.resolved.info.id).toBe("f4");
  });

  it("resolves lattice world scale from the certified visible radius", () => {
    const result = resolve(TETRA, { kind: "lattice", cellScale: 1.5 });
    expect(result.status).toBe("active");
    if (result.status !== "active" || result.plan.kind !== "lattice") return;
    expect(result.resolved).toMatchObject({
      kind: "lattice",
      cellScale: 1.5,
      radius: result.originVisibleRadius,
    });
    expect(result.plan.tiling).toBe(result.resolved);
    expect(result.plan.tiling.h).toBeCloseTo(result.originVisibleRadius * 1.5);
  });

  it.each([
    [{ group: "a3" }, false, { order: 3, plane: "xz" }],
    [{ kind: "lattice", cellScale: 1.5 }, false, { order: 3, plane: "xz" }],
    [{ group: "a4" }, true, { order: 3, plane: "xw", twist: 1 }],
    [
      { kind: "lattice", cellScale: 1.5 },
      true,
      { order: 3, plane: "xw", twist: 1 },
    ],
  ] satisfies Array<[TilingSpec, boolean, SymmetryParams]>)(
    "tiles the symmetrized attractor in its own dimension %#",
    (tiling, fourD, symmetry) => {
      // The w-plane alone lifts the flat source into 4D; no preset w block
      // is needed to make the 4D symmetry and tiling path meaningful.
      const result = resolve(TETRA, tiling, { fourD, symmetry });
      expect(result.status).toBe("active");
      if (result.status !== "active") return;
      expect(result.plan.dimension).toBe(fourD ? 4 : 3);
      expect(result.originVisibleRadius).toBeGreaterThan(0);
    },
  );

  it("refuses Balloon and mesh clips before analysis", () => {
    const balloon = resolve([], { group: "a3" }, { balloonEcho: true });
    expect(balloon.status).toBe("refused");
    expect(balloon.note).toMatch(/Balloon/);

    const mesh = resolve([], {
      group: "a3",
      clip: {
        parts: [
          {
            primitive: { kind: "mesh", meshId: "star-prism-v1" },
            combine: "union",
          },
        ],
      },
    });
    expect(mesh.status).toBe("refused");
    expect(mesh.note).toMatch(/analytic shapes/);
  });

  it.each([
    [{ group: "a4" } as const, false, /A4 point tiling is 4D/],
    [{ group: "a3" } as const, true, /A3 point tiling is 3D/],
  ])("refuses a finite group in the wrong dimension", (tiling, fourD, note) => {
    const result = resolve(fourD ? PENTATOPE : TETRA, tiling, { fourD });
    expect(result.status).toBe("refused");
    expect(result.note).toMatch(note);
  });

  it.each([
    [mandelboxCube(), /does not contract/],
    [mandelbulbClassic(), /uses variations/],
  ])("refuses forward-orbit point debris", (transforms, reason) => {
    const result = resolve(transforms, { group: "a3" });
    expect(result.status).toBe("refused");
    expect(result.note).toMatch(/inverse-IFS attractor/);
    expect(result.note).toMatch(reason);
    expect(result.note).toMatch(/reset debris/);
  });

  it("turns ordinary document incompatibility into a refusal note", () => {
    const result = resolve([], { group: "a3" });
    expect(result.status).toBe("refused");
    expect(result.note).toMatch(/no transforms/);
  });

  it("leaves malformed programming invariants loud", () => {
    expect(() =>
      resolve(TETRA, { kind: "lattice", cellScale: Number.NaN }),
    ).toThrow(/cellScale/);
  });
});
