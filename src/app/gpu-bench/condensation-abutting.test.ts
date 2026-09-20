import { describe, expect, it } from "vitest";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { buildSurfaceDE4 } from "../../fractal/surface-de-4d";
import {
  condensationDistance3,
  condensationSignedDistance4,
} from "../../fractal/condensation-de";
import { SHAPE_MARCH_SAFETY } from "../../fractal/shapes";
import type { Transform, Vec3 } from "../../fractal/types";
import { type DielectricMaterial } from "../../fractal/surface-dielectric";
import {
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  type TransportFixtureSystem,
} from "./surface-transport-fixture";

/**
 * The closed-solid backend's FACE-ABUTTING MEMBER control — the one
 * arrangement the separated-primitive fixtures could not reach. Two
 * half-extent-0.5 boxes posed at x = ∓0.5 share the plane x = 0, where the
 * min-union field reads exactly ZERO while the point is INTERIOR to the
 * optical solid (each box's own signed distance vanishes on its face). The
 * control is the ONE-SPANNING box of the same combined solid, whose field
 * has no internal structure.
 *
 * MEASURED VERDICT (2026-09-20, the CPU twin, both dimensions, identical
 * figures): every ray completes in both systems with the same status and
 * no unresolved/refusal work; per-ray radiance agrees with the spanning
 * control to ≤ 2.1e-5 on a uniform backdrop (relative ~4e-5). The shared
 * plane is NOT invisible to the boundary query — the abutting traces
 * record 18 boundary events where the control records 4 (the interior
 * zero's crossing band fires; the tap gradient there is dominated by the
 * deep member, so the event reads as a glass→air interface whose
 * reflected child recirculates and escapes through another face) — but
 * the recirculated energy is direction-independent against a uniform
 * backdrop, so the optical result carries no seam at the 1e-5 level. The
 * kernel marches the same field under the same rules, and its agreement
 * is pinned separately by the transport legs' abutting arm.
 *
 * The pinned contract is therefore: abutting members transport like the
 * spanning solid — complete accounting, no phantom unresolved work,
 * radiance parity within the field's own convergence noise.
 */

const abuttingTransforms: Transform[] = [
  {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    emitter: {
      parts: ([-0.5, 0.5] as const).map((x) => ({
        primitive: { kind: "box", half: [0.5, 0.5, 0.5] } as const,
        combine: "union" as const,
        pose: { offset: [x, 0, 0] as Vec3 },
      })),
    },
  },
];

const spanningTransforms: Transform[] = [
  {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    emitter: {
      parts: [
        { primitive: { kind: "box", half: [1, 0.5, 0.5] }, combine: "union" },
      ],
    },
  },
];

function solidSystem(transforms: Transform[]): TransportFixtureSystem {
  const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xy" }, {});
  if (de.maps.length !== 0 || !de.condensation) {
    throw new Error("fixture did not build its emitter-only union");
  }
  const condensation = de.condensation;
  return {
    estimate: (p: Vec3): number =>
      SHAPE_MARCH_SAFETY *
      condensationDistance3(condensation, p[0], p[1], p[2]),
    stepScale: de.stepScale,
    visibleRadius: de.visibleBoundingRadius,
  };
}

function solidSystem4(transforms: Transform[]): TransportFixtureSystem {
  const de = buildSurfaceDE4(transforms, null, { order: 1, plane: "xy" }, {});
  if (de.maps.length !== 0 || !de.condensation) {
    throw new Error("fixture did not build its emitter-only union");
  }
  const condensation = de.condensation;
  return {
    estimate: (p: Vec3): number =>
      SHAPE_MARCH_SAFETY *
      condensationSignedDistance4(condensation, p[0], p[1], p[2], 0),
    stepScale: de.stepScale,
    visibleRadius: de.visibleBoundingRadius,
  };
}

const MATERIAL: DielectricMaterial = {
  ior: 1.45,
  absorption: [0.17, 0.055, 0.025],
  radius: 1,
};
const BACKGROUND: Vec3 = [0.125, 0.25, 0.5];

/** Primaries start ON the entry face — the shade entry's contract (the
 * display march hands a surface hit point, whose medium claim the anchored
 * restart's cross-check then verifies). A camera-side origin would be the
 * state-mismatch refusal, not a transport sample. */
const RAYS: Array<[Vec3, Vec3]> = [
  [
    [-1, 0, 0],
    [1, 0, 0],
  ],
  [
    [-1, 0.1, 0.05],
    [1, 0, 0],
  ],
  [
    [-1, -0.15, -0.2],
    [1, 0, 0],
  ],
  [
    [-1, 0.3, 0.1],
    [1, -0.02, 0.01],
  ],
  [
    [-1, -0.3, 0.2],
    [1, 0.01, -0.02],
  ],
  [
    [-1, 0, 0.4],
    [1, 0, -0.05],
  ],
  [
    [-1, 0.45, 0],
    [1, -0.05, 0.02],
  ],
];

function trace(system: TransportFixtureSystem, origin: Vec3, dir: Vec3) {
  return transportTraceCPU(
    system,
    origin,
    dir,
    1e-4,
    MATERIAL,
    BACKGROUND,
    undefined,
    (
      o: Vec3,
      d: Vec3,
      anchorPresent: boolean,
      anchorPoint: Vec3,
      inside: boolean,
      eps: number,
    ) =>
      transportSolidBoundaryQueryCPU(
        system,
        o,
        d,
        anchorPresent,
        anchorPoint,
        inside,
        eps,
      ),
  );
}

describe.each([
  ["3D", solidSystem],
  ["4D (canonical identity pose)", solidSystem4],
])("closed-solid abutting members — %s", (_label, systemOf) => {
  it("keeps the fields' contract: outside agreement, interior signs, on-plane zero", () => {
    const abutting = systemOf(abuttingTransforms);
    const spanning = systemOf(spanningTransforms);
    for (const p of [
      [-1.4, 0.1, -0.2],
      [-0.1, 0.8, 0],
      [1.3, 0, 0.3],
      [0, 1.1, 0],
    ] as Vec3[]) {
      const a = abutting.estimate(p);
      const s = spanning.estimate(p);
      expect(a).toBeGreaterThan(0);
      expect(Math.abs(a - s)).toBeLessThan(1e-9);
    }
    for (const p of [
      [-0.5, 0.1, 0],
      [0.5, 0.1, 0],
      [-0.13, -0.2, 0.2],
    ] as Vec3[]) {
      expect(abutting.estimate(p)).toBeLessThan(0);
      expect(spanning.estimate(p)).toBeLessThan(0);
    }
    expect(abutting.estimate([0, 0.1, 0])).toBe(0);
  });

  it("transports like the one-spanning control: same status, radiance parity, no unresolved work", () => {
    const abutting = systemOf(abuttingTransforms);
    const spanning = systemOf(spanningTransforms);
    for (const [origin, dir] of RAYS) {
      const a = trace(abutting, origin, dir);
      const s = trace(spanning, origin, dir);
      expect(a.status).toBe(s.status);
      expect(a.status).toBe("residual");
      expect(a.failure).toBe(0);
      expect(s.failure).toBe(0);
      const dr = Math.hypot(
        a.radiance[0] - s.radiance[0],
        a.radiance[1] - s.radiance[1],
        a.radiance[2] - s.radiance[2],
      );
      expect(dr).toBeLessThan(1e-4);
    }
  });
});
