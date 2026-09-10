import { describe, expect, it } from "vitest";
import { DEFAULT_SURFACE_LIGHTING } from "../fractal/surface-lighting";
import type { ShapeSpec } from "../fractal/shapes";
import { resolveTiling, type ResolvedTiling } from "../fractal/tiling";
import {
  SURFACE_GLSL_STRIP_BYTES,
  createSurfaceMaterial,
  setSurfaceBalloon,
  setSurfaceGroundPlane,
  setSurfaceLighting,
  surfaceFragmentFor,
  surfaceFragmentResolvedFor,
} from "./surface-material";
import {
  createSurfaceMaterial4,
  setSurface4Balloon,
  setSurface4GroundPlane,
  setSurface4Lighting,
  surface4FragmentFor,
  surface4FragmentResolvedFor,
} from "./surface-material-4d";

for (const [name, create, lighting, balloon, plane] of [
  [
    "3D",
    createSurfaceMaterial,
    setSurfaceLighting,
    setSurfaceBalloon,
    setSurfaceGroundPlane,
  ],
  [
    "4D",
    createSurfaceMaterial4,
    setSurface4Lighting,
    setSurface4Balloon,
    setSurface4GroundPlane,
  ],
] as const) {
  describe(`${name} authored lighting material`, () => {
    it("restores the exact legacy program when the authored rig is removed", () => {
      const material = create();
      const legacy = material.fragmentShader;
      lighting(material, DEFAULT_SURFACE_LIGHTING);
      expect(material.fragmentShader).toContain("cinematicSurface");
      expect(material.fragmentShader).not.toBe(legacy);
      lighting(material, undefined);
      expect(material.fragmentShader).toBe(legacy);
      material.dispose();
    });

    it("keeps an exhausted ray dark rather than painting it with the backdrop", () => {
      // Alpha 0.5 is the EXHAUSTED status (a miss writes 0.0). Linear
      // transport must not treat unknown geometry as clear sky, which is
      // the compute kernel's `if (st.y == EXHAUSTED) terminal = 0` — and
      // dropping it drifts a lit Balloon frame past the browser gate's bar.
      const material = create();
      expect(material.fragmentShader).toContain(
        "outColor = vec4(background, 0.5);",
      );
      lighting(material, DEFAULT_SURFACE_LIGHTING);
      expect(material.fragmentShader).toContain(
        "outColor = vec4(vec3(0.0), 0.5);",
      );
      expect(material.fragmentShader).not.toContain(
        "outColor = vec4(background, 0.5);",
      );
      material.dispose();
    });

    it("keeps lighting through Balloon and floor geometry recomposition", () => {
      const material = create();
      lighting(material, DEFAULT_SURFACE_LIGHTING);
      balloon(material, { center: [0, 0, 0], rho: 1, R: 1.5, far: 12 });
      expect(material.fragmentShader).toContain("cinematicSurface");
      expect(material.fragmentShader).toContain("surfaceDEBalloonHitInfo");
      balloon(material, null);
      plane(material, {
        y: -1.1,
        fadeStart: 4,
        fadeEnd: 10,
        ballCenter: [0, 0, 0],
        ballRadius: 1,
        albedo: [0.5, 0.5, 0.5],
      });
      expect(material.fragmentShader).toContain("cinematicFloorBase");
      expect(material.fragmentShader).toContain("cinematicPlaneBlocked");
      material.dispose();
    });
  });
}

const sphere: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 0.4 }, combine: "union" }],
};

/** These are the widest legal compositions, plus each distinct DE wrapper.
 * The historical 64KiB threshold decides whether to strip comments; the
 * driver cliff concerns the emitted program and stays below 80KiB. */
describe("authored lighting emitted source boundary", () => {
  it("keeps 3D inverse, forward, Balloon, floor and lattice programs below the driver cliff", () => {
    const finite = resolveTiling({ group: "h3", clip: sphere });
    const lattice = resolveTiling(
      { kind: "lattice", cellScale: 1.5, clip: sphere },
      1,
    );
    const variants: {
      name: string;
      lens?: number;
      balloon?: number;
      plane?: number;
      family?: "escape" | "bulb";
      compound?: boolean;
      tiling?: ResolvedTiling | null;
    }[] = [
      { name: "plain" },
      { name: "lens", lens: 1 },
      { name: "floor", plane: 1 },
      { name: "Balloon", balloon: 1 },
      { name: "escape", family: "escape" },
      { name: "bulb", family: "bulb" },
      { name: "compound lens/floor", lens: 1, plane: 1, compound: true },
      {
        name: "compound finite/lens/Balloon",
        lens: 1,
        balloon: 1,
        compound: true,
        tiling: finite,
      },
      {
        name: "compound lattice/lens/floor",
        lens: 1,
        plane: 1,
        compound: true,
        tiling: lattice,
      },
      {
        name: "escape/trap/floor/finite",
        family: "escape",
        plane: 1,
        compound: true,
        tiling: finite,
      },
      {
        name: "bulb/trap/floor/lattice",
        family: "bulb",
        plane: 1,
        compound: true,
        tiling: lattice,
      },
    ];
    let crossesStripThreshold = false;
    for (const row of variants) {
      const args: Parameters<typeof surfaceFragmentFor> = [
        row.family === "escape" ? 1 : 0,
        row.lens ?? 0,
        row.balloon ?? 0,
        row.plane ?? 0,
        row.family === "bulb" ? 1 : 0,
        1,
        1,
        undefined,
        row.family && row.compound ? sphere : null,
        !row.family && row.compound ? [sphere] : null,
        false,
        row.family === "escape" && row.compound ? 1 : 0,
        !row.family && row.compound ? 1 : 0,
        !row.family && row.compound ? 1 : 0,
        row.tiling ?? null,
        !row.family && row.compound ? 1 : 0,
        1,
      ];
      const resolved = surfaceFragmentResolvedFor(...args);
      const emitted = surfaceFragmentFor(...args);
      expect(emitted.length, row.name).toBeLessThan(80 * 1024);
      expect(emitted, row.name).toContain("cinematicSurface");
      expect(emitted, row.name).toContain("return surfaceDE(p, 0.0)");
      const strips = !!row.plane || resolved.length > SURFACE_GLSL_STRIP_BYTES;
      expect(emitted === resolved, row.name).toBe(!strips);
      if (strips) expect(emitted, row.name).not.toContain("//");
      crossesStripThreshold ||= resolved.length > SURFACE_GLSL_STRIP_BYTES;
    }
    expect(crossesStripThreshold).toBe(true);
  });

  it("keeps posed 4D inverse, swirl, Balloon, floor and lattice programs below the same driver cliff", () => {
    const finite = resolveTiling({ group: "f4", clip: sphere });
    const lattice = resolveTiling(
      { kind: "lattice", cellScale: 1.5, clip: sphere },
      1,
    );
    const variants = [
      { name: "plain" },
      { name: "swirl", swirl: 1 },
      { name: "floor", plane: 1 },
      { name: "Balloon", balloon: 1 },
      { name: "compound swirl/floor", swirl: 1, plane: 1, compound: true },
      {
        name: "compound finite/swirl/Balloon",
        swirl: 1,
        balloon: 1,
        compound: true,
        tiling: finite,
      },
      {
        name: "compound lattice/swirl/floor",
        swirl: 1,
        plane: 1,
        compound: true,
        tiling: lattice,
      },
    ];
    let crossesStripThreshold = false;
    for (const row of variants) {
      const args: Parameters<typeof surface4FragmentFor> = [
        row.balloon ?? 0,
        row.plane ?? 0,
        1,
        1,
        row.compound ? [sphere] : null,
        row.compound ? 1 : 0,
        row.compound ? 1 : 0,
        row.tiling ?? null,
        row.swirl ?? 0,
        1,
      ];
      const resolved = surface4FragmentResolvedFor(...args);
      const emitted = surface4FragmentFor(...args);
      expect(emitted.length, row.name).toBeLessThan(80 * 1024);
      expect(emitted, row.name).toContain("cinematicSurface");
      expect(emitted, row.name).toContain("return surfaceDE(p, 0.0)");
      const strips = !!row.plane || resolved.length > SURFACE_GLSL_STRIP_BYTES;
      expect(emitted === resolved, row.name).toBe(!strips);
      if (strips) expect(emitted, row.name).not.toContain("//");
      crossesStripThreshold ||= resolved.length > SURFACE_GLSL_STRIP_BYTES;
    }
    expect(crossesStripThreshold).toBe(true);
  });
});
