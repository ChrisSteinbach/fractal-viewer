import { describe, expect, it } from "vitest";
import {
  defaultTransforms,
  mandelbulbClassic,
  sierpinskiTetrahedron,
} from "./presets";
import { STAR_PRISM_SHAPE } from "./shapes";
import { resolveSolidTilingSession } from "./solid-tiling-session";
import type { TilingSpec } from "./tiling";
import type { HybridSchedule, SymmetryParams } from "./types";

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

function resolve(
  tiling: TilingSpec | undefined,
  balloonEcho = false,
  nonFlat = false,
  symmetry: SymmetryParams = NO_SYMMETRY,
  transforms = defaultTransforms(),
  finalTransform = null,
  schedule: HybridSchedule | null = null,
) {
  return resolveSolidTilingSession(
    transforms,
    finalTransform,
    symmetry,
    schedule,
    tiling ?? null,
    balloonEcho,
    nonFlat,
  );
}

describe("resolveSolidTilingSession", () => {
  it("is off with no tiling block", () => {
    expect(resolve(undefined)).toMatchObject({
      status: "off",
      application: "material-live",
    });
    expect(resolve(undefined, false, true)).toMatchObject({
      status: "off",
      application: "worker-baked",
    });
  });

  it("resolves a 3D finite group to active with the certified radius and posed clip", () => {
    const result = resolve({ group: "a3" });
    expect(result.status).toBe("active");
    if (result.status !== "active") return;
    expect(result.application).toBe("material-live");
    expect(result.resolved).toMatchObject({ group: "a3" });
    expect(result.originVisibleRadius).toBeGreaterThan(0);
  });

  it("poses an unposed clip onto the measured chamber content", () => {
    const result = resolve({
      group: "b3",
      clip: {
        parts: [
          { primitive: { kind: "sphere", radius: 0.4 }, combine: "union" },
        ],
      },
    });
    expect(result.status).toBe("active");
    if (result.status !== "active") return;
    const pose = result.resolved.clip?.parts[0].pose;
    expect(pose?.offset).toBeDefined();
    expect(pose?.scale).toBeGreaterThan(0);
  });

  it("resolves a 3D lattice against the certified radius", () => {
    const result = resolve({ kind: "lattice", cellScale: 1.5 });
    expect(result.status).toBe("active");
    if (result.status !== "active") return;
    expect(result.resolved).toMatchObject({
      kind: "lattice",
      h: 1.5 * result.originVisibleRadius,
    });
  });

  it("refuses Balloon, symmetry above order 1, and mesh clips", () => {
    expect(resolve({ group: "a3" }, true).status).toBe("refused");
    expect(
      resolve({ group: "a3" }, false, false, { order: 2, plane: "xz" }).status,
    ).toBe("refused");
    expect(resolve({ group: "a3", clip: STAR_PRISM_SHAPE }).status).toBe(
      "refused",
    );
  });

  it("refuses a dimension mismatch on a 3D render", () => {
    const result = resolve({ group: "a4" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.note).toMatch(/4D group/);
  });

  it("routes matching finite and lattice tiling to the 4D worker-baked arm", () => {
    const tilings: TilingSpec[] = [
      { group: "a4" },
      { group: "b4" },
      { group: "f4" },
      { kind: "lattice", cellScale: 1.5 },
    ];
    for (const tiling of tilings) {
      const result = resolve(tiling, false, true);
      expect(result.status).toBe("active");
      if (result.status !== "active") return;
      expect(result.application).toBe("worker-baked");
      expect(result.originVisibleRadius).toBeGreaterThan(0);
    }
  });

  it("refuses a 3D finite group on a non-flat (4D) render", () => {
    const result = resolve({ group: "a3" }, false, true);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.note).toMatch(/3D group.*4D/i);
  });

  it("refuses forward escape-time documents as reset debris", () => {
    const result = resolve(
      { group: "a3" },
      false,
      false,
      NO_SYMMETRY,
      mandelbulbClassic(),
    );
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.note).toMatch(/reset debris/);
  });

  it("accepts a lattice on a kaleidoscopic system only at order 1", () => {
    const result = resolve(
      { kind: "lattice", cellScale: 1.5 },
      false,
      false,
      NO_SYMMETRY,
      sierpinskiTetrahedron(),
    );
    expect(result.status).toBe("active");
  });
});
