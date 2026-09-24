import { buildCondensationSolid3 } from "./condensation-solid";
import { buildCondensationSolid4 } from "./condensation-solid-4d";
import {
  CONDENSATION_SOLID_GPU_BALL_PAD,
  CONDENSATION_SOLID_GPU_MAX_EDGES,
  condensationSolidWgslSource,
  condensationSolidWire,
} from "./condensation-solid-gpu";
import { sierpinskiTetrahedron } from "./presets";
import type { ShapeSpec } from "./shapes";
import { buildSurfaceDE } from "./surface-de";
import { buildSurfaceDE4 } from "./surface-de-4d";
import {
  surfaceDeKernelWgsl,
  type SurfaceGpuKernelOptions,
} from "./surface-de-gpu";
import type { Transform } from "./types";

const SPHERE: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 0.9 }, combine: "union" }],
};

function beads(): Transform[] {
  return [
    ...sierpinskiTetrahedron(),
    {
      id: 4,
      position: [0.05, 0.1, -0.05],
      rotation: [0.3, 0.2, 0.1],
      scale: [0.5, 0.5, 0.5],
      weight: 1.4,
      emitter: SPHERE,
    },
  ];
}

const band = { condensationDepthBand: { maxDepth: 2 } };

function wire3() {
  return condensationSolidWire(
    buildCondensationSolid3(buildSurfaceDE(beads(), null, undefined, band)),
  );
}

function wire4() {
  return condensationSolidWire(
    buildCondensationSolid4(buildSurfaceDE4(beads(), null, undefined, band)),
  );
}

function solidOpts(
  overrides: Partial<SurfaceGpuKernelOptions> = {},
): SurfaceGpuKernelOptions {
  return {
    mode: "shade",
    core: "affine",
    width: 4,
    workgroupSize: 32,
    sharedFrontier: false,
    bnbStage2: false,
    optics: true,
    opticsBackend: "closedSolid",
    condensation: {
      mapCount: 4,
      emitters: [{ shape: SPHERE, shadeIndex: 4 }],
    },
    ...overrides,
  };
}

describe("condensationSolidWire", () => {
  it("carries the oracle's edges, ball and ratios verbatim, per dimension", () => {
    const de = buildSurfaceDE(beads(), null, undefined, band);
    const solid = buildCondensationSolid3(de);
    const wire = condensationSolidWire(solid);
    expect(wire.dim).toBe(3);
    expect(wire.edges).toEqual(
      solid.maps.map((m) => ({
        invM: m.invM,
        invT: m.invT,
        sigmaMin: m.sigmaMin,
      })),
    );
    expect(wire.center).toEqual(solid.center);
    expect(wire.radius).toBe(solid.radius);
    expect(wire4().dim).toBe(4);
    expect(wire4().edges[0].invM).toHaveLength(16);
  });
});

describe("condensationSolidWgslSource", () => {
  it("bakes one switch case per edge and the padded invariant radius", () => {
    const wire = wire3();
    const src = condensationSolidWgslSource(wire);
    for (let i = 0; i < wire.edges.length; i++)
      expect(src).toContain(`    case ${i}u: {`);
    expect(src).not.toContain(`    case ${wire.edges.length}u: {`);
    const padded = Math.fround(
      wire.radius * (1 + CONDENSATION_SOLID_GPU_BALL_PAD),
    );
    expect(src).toContain(`- ${String(padded)};`);
    expect(src).toContain("fn transportSolidField(p: vec3f) -> f32 {");
    expect(src).toContain("fn transportSolidContains(p: vec3f) -> bool {");
  });

  it("lifts the 4D query through the live rotor and scores the penalty term", () => {
    const src = condensationSolidWgslSource(wire4());
    expect(src).toContain("let root = rotorInvApply4(vec4f(p, params.w0));");
    expect(src).toContain("let d = m.p0.x * sd + abs(local.w);");
    expect(src).toContain("var stackQ: array<vec4f, 7>;");
  });

  it("refuses an empty or oversized edge list", () => {
    expect(() =>
      condensationSolidWgslSource({ ...wire3(), edges: [] }),
    ).toThrow(/at least one map edge/);
    const edge = wire3().edges[0];
    expect(() =>
      condensationSolidWgslSource({
        ...wire3(),
        edges: Array.from(
          { length: CONDENSATION_SOLID_GPU_MAX_EDGES + 1 },
          () => edge,
        ),
      }),
    ).toThrow(/edge kernel ceiling/);
  });
});

describe("the closed-solid kernel's condensationSolid option", () => {
  it("swaps the root field for the word search in both dimensions", () => {
    const shade3 = surfaceDeKernelWgsl(
      solidOpts({ condensationSolid: wire3() }),
    );
    expect(shade3).toContain("fn csChild(e: u32, q: vec3f) -> CsChild {");
    expect(shade3).not.toContain("return condensationTerm(p, 1.0, 0u);");
    const shade4 = surfaceDeKernelWgsl(
      solidOpts({ core: "affine4", condensationSolid: wire4() }),
    );
    expect(shade4).toContain("fn csChild(e: u32, q: vec4f) -> CsChild {");
  });

  it("splits the primary hit on the solid's own normal, not the display estimator's", () => {
    // The display estimator is the IFS descent, not the band solid, and in
    // 4D it reads zero inside the solid: its taps bent the primary child
    // straight through (the 4D beads leg's measured divergence).
    const shade = surfaceDeKernelWgsl(
      solidOpts({ core: "affine4", condensationSolid: wire4() }),
    );
    expect(shade).toContain("let n0 = transportSolidNormal(origin, dir, eps);");
    const c0 = surfaceDeKernelWgsl(
      solidOpts({
        condensation: {
          mapCount: 0,
          emitters: [{ shape: SPHERE, shadeIndex: 0 }],
        },
      }),
    );
    expect(c0).toContain(
      "let n0 = transportOpticalNormal(origin, dir, eps, li);",
    );
  });

  it("leaves the emitter-only closed-solid emission byte-identical when absent", () => {
    const opts = solidOpts({
      condensation: {
        mapCount: 0,
        emitters: [{ shape: SPHERE, shadeIndex: 0 }],
      },
    });
    expect(surfaceDeKernelWgsl({ ...opts, condensationSolid: null })).toBe(
      surfaceDeKernelWgsl(opts),
    );
  });

  it("refuses another backend, a fold core and a dimension mismatch", () => {
    expect(() =>
      surfaceDeKernelWgsl(
        solidOpts({ opticsBackend: "estimator", condensationSolid: wire3() }),
      ),
    ).toThrow(/rides opticsBackend "closedSolid"/);
    expect(() =>
      surfaceDeKernelWgsl(
        solidOpts({ core: "fold", condensationSolid: wire3() }),
      ),
    ).toThrow(/plain affine cores/);
    expect(() =>
      surfaceDeKernelWgsl(solidOpts({ condensationSolid: wire4() })),
    ).toThrow(/dimension must match/);
  });
});
