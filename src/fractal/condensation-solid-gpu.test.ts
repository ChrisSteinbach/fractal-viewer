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
      emitters: [{ shape: SPHERE, shadeIndex: 4, sigmaMin: 1 }],
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
    // The 3D wire carries no canonical restriction (it IS one).
    expect(wire.canonical3).toBeNull();
    expect(wire4().dim).toBe(4);
    expect(wire4().edges[0].invM).toHaveLength(16);
    // The 4D wire projects the restriction's own ball and ratios: a w
    // scale off the emitter's xyz range lowers the 4D emitter ratio
    // (σ_max picks the larger) while the restriction's is 1.0 — the fast
    // body bakes the latter.
    const mismatch = condensationSolidWire(
      buildCondensationSolid4(
        buildSurfaceDE4(
          [
            ...sierpinskiTetrahedron().map((t) => ({
              ...t,
              w: { scale: 0.5 },
            })),
            {
              id: 4,
              position: [0.05, 0.1, -0.05],
              rotation: [0.3, 0.2, 0.1],
              scale: [0.5, 0.5, 0.5],
              weight: 1.4,
              emitter: SPHERE,
              w: { scale: 0.25 },
            },
          ],
          null,
          undefined,
          band,
        ),
      ),
    );
    expect(mismatch.emitterRatio).toBeLessThan(
      mismatch.canonical3!.emitterRatio,
    );
    expect(mismatch.canonical3!.emitterRatio).toBeCloseTo(1, 12);
    expect(mismatch.canonical3!.sigmas).toHaveLength(mismatch.edges.length);
    expect(mismatch.canonical3!.center).toEqual(mismatch.center.slice(0, 3));
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

  it("stays byte-identical without the canonicalFast option", () => {
    const w4 = wire4();
    expect(condensationSolidWgslSource(w4)).toBe(
      condensationSolidWgslSource(w4, {}),
    );
    expect(condensationSolidWgslSource(w4)).toBe(
      condensationSolidWgslSource(w4, { canonicalFast: false }),
    );
  });

  it("emits the canonical-pose fast body beside the 4D search", () => {
    const src = condensationSolidWgslSource(wire4(), { canonicalFast: true });
    // The fast search: the 3D restriction's shape, its own identifier set.
    expect(src).toContain("struct CsChildFast {\n  q: vec3f,");
    expect(src).toContain("fn csChildFast(e: u32, q: vec3f)");
    expect(src).toContain("fn transportSolidFieldFast(p: vec3f) -> f32 {");
    expect(src).toContain("var stackQ: array<vec3f, 7>;");
    // The fast emitter term: no w row, no |local w| penalty.
    expect(src).toContain("fn csTermFast(q: vec3f) -> f32 {");
    expect(src).toContain("dot(m.r0.xyz, q)");
    expect(src).toContain("let d = m.p0.x * sd;\n");
    // The fast cases are the 4x4 edges' 3x3 blocks and translations.
    const edge = wire4().edges[0];
    const l = (x: number): string => {
      const s = String(Math.fround(x));
      return /[.e]/.test(s) ? s : `${s}.0`;
    };
    expect(src).toContain(
      `${l(edge.invM[0])} * q.x + ${l(edge.invM[1])} * q.y + ${l(edge.invM[2])} * q.z + ${l(edge.invT[0])}`,
    );
    // The gate dispatches on the transport word's reserved slot.
    expect(src).toContain("if (shade.transport.z != 0.0) {");
    expect(src).toContain("return transportSolidFieldFast(p);");
    // The fast body rides the same 4D ball radius (prunes less, never more).
    expect(src).toContain(
      `- ${String(Math.fround(wire4().radius * (1 + CONDENSATION_SOLID_GPU_BALL_PAD)))};`,
    );
  });

  it("leaves the 3D source byte-identical under the option (it is its own fast body)", () => {
    expect(condensationSolidWgslSource(wire3(), { canonicalFast: true })).toBe(
      condensationSolidWgslSource(wire3()),
    );
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

  it("hands the primary interface to the query instead of splitting at the march's hit", () => {
    // A silhouette ray the display march accepts beside a bead it never
    // enters was split there: its chord started outside the sphere, met
    // the wall past the critical angle and circled by total internal
    // reflection until the path capped. The signed query now owns the
    // entry (a near-miss misses: background), in both dimensions.
    for (const opts of [
      solidOpts({ condensationSolid: wire3() }),
      solidOpts({ core: "affine4", condensationSolid: wire4() }),
    ]) {
      const shade = surfaceDeKernelWgsl(opts);
      expect(shade).toContain("primary.anchorPresent = 0u;");
      expect(shade).not.toContain("the primary split (the march's own hit");
    }
    const c0 = surfaceDeKernelWgsl(
      solidOpts({
        condensation: {
          mapCount: 0,
          emitters: [{ shape: SPHERE, shadeIndex: 0, sigmaMin: 1 }],
        },
      }),
    );
    // The signed backends share the owned-primary emission (the
    // sphere-inversion and emitter-only closed solid ride it with the
    // curved solid now): C0's sign is exact, so its query owns the
    // entry the same way.
    expect(c0).toContain("primary.anchorPresent = 0u;");
    expect(c0).not.toContain("the primary split (the march's own hit");
  });

  it("gates band crossings on a real sign flip of the curved solid's field", () => {
    // The union's sub-eps gaps fire the band with no surface there; taken
    // as crossings they flipped the medium (inside-miss, state-mismatch).
    const shade = surfaceDeKernelWgsl(
      solidOpts({ condensationSolid: wire3() }),
    );
    expect(shade).toContain(
      "if (transportSolidContains(hitP + dir * (2.0 * eps)) == (inside == 1u)) {",
    );
    expect(shade).toContain("return transportSolidField(p) <= 0.0;");
  });

  it("leaves the emitter-only closed-solid emission byte-identical when absent", () => {
    const opts = solidOpts({
      condensation: {
        mapCount: 0,
        emitters: [{ shape: SPHERE, shadeIndex: 0, sigmaMin: 1 }],
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
    // The fast body's guard: it needs the 4D wire (the 3D source IS its
    // own fast body and takes no option).
    expect(() =>
      surfaceDeKernelWgsl(
        solidOpts({ condensationSolid: wire3(), condensationSolidFast: true }),
      ),
    ).toThrow(/condensationSolidFast needs a 4D condensationSolid wire/);
    expect(() =>
      surfaceDeKernelWgsl(solidOpts({ condensationSolidFast: true })),
    ).toThrow(/condensationSolidFast needs a 4D condensationSolid wire/);
    // And the 4D shade kernel with the option compiles the fast body in.
    const kernel = surfaceDeKernelWgsl(
      solidOpts({
        core: "affine4",
        condensationSolid: wire4(),
        condensationSolidFast: true,
      }),
    );
    expect(kernel).toContain("fn transportSolidFieldFast(p: vec3f)");
    expect(kernel).toContain("if (shade.transport.z != 0.0) {");
    // Absent, the fast body stays out of the kernel entirely.
    const plain = surfaceDeKernelWgsl(
      solidOpts({ core: "affine4", condensationSolid: wire4() }),
    );
    expect(plain).not.toContain("transportSolidFieldFast");
    expect(plain).not.toContain("shade.transport.z");
  });
});
