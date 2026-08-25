import {
  DEFAULT_SHAPE_TRAP_THRESHOLD,
  SHAPE_TRAP_GEOMETRY_LEVEL_MAX,
  SHAPE_TRAP_NO_CROSSING,
  resolveShapeTrap,
  shapeTrapCandidate,
  shapeTrapInvNorm,
  shapeTrapPosedSdf,
  shapeTrapValue,
} from "./shape-trap";
import type { ShapeTrap } from "./types";

describe("the shape trap (resolveShapeTrap + the ONE value formula)", () => {
  const sphereTrap = (
    overrides: Partial<Omit<ShapeTrap, "shape">> = {},
    radius = 1,
  ): ShapeTrap => ({
    shape: {
      parts: [{ primitive: { kind: "sphere", radius }, combine: "union" }],
    },
    ...overrides,
  });

  it("resolves absent fields to the classics: identity pose, min mode, the default threshold, zero fade, geometry off", () => {
    const rt = resolveShapeTrap(sphereTrap());
    expect(rt.invRot).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rt.position).toEqual([0, 0, 0]);
    expect(rt.invScale).toBe(1);
    expect(rt.mode).toBe(0);
    expect(rt.threshold).toBe(DEFAULT_SHAPE_TRAP_THRESHOLD);
    expect(rt.fade).toBe(0);
    expect(rt.geometry).toBe(false);
    expect(rt.geometryLevelMin).toBe(0);
    expect(rt.geometryLevelMax).toBe(SHAPE_TRAP_GEOMETRY_LEVEL_MAX);
    // The normalizer is the shape's own bounding radius, shared with the
    // codegen through shapeTrapInvNorm.
    expect(rt.invNorm).toBeCloseTo(1, 12);
    expect(rt.invNorm).toBe(shapeTrapInvNorm(sphereTrap().shape));
  });

  it("resolves geometry's inclusive level band to sorted nonnegative integers", () => {
    const reversed = resolveShapeTrap(
      sphereTrap({
        geometry: true,
        geometryLevelMin: 8.9,
        geometryLevelMax: 2.2,
      }),
    );
    expect(reversed.geometry).toBe(true);
    expect(reversed.geometryLevelMin).toBe(2);
    expect(reversed.geometryLevelMax).toBe(8);

    const floored = resolveShapeTrap(
      sphereTrap({
        geometryLevelMin: -4,
        geometryLevelMax: Number.POSITIVE_INFINITY,
      }),
    );
    expect(floored.geometry).toBe(false);
    expect(floored.geometryLevelMin).toBe(0);
    expect(floored.geometryLevelMax).toBe(SHAPE_TRAP_GEOMETRY_LEVEL_MAX);
  });

  it("resolves out-of-domain numbers instead of throwing: non-positive scale to 1, threshold floored, fade floored at 0", () => {
    const rt = resolveShapeTrap(
      sphereTrap({ scale: -2, threshold: -1, fade: -3, mode: "threshold" }),
    );
    expect(rt.invScale).toBe(1);
    expect(rt.threshold).toBe(1e-4);
    expect(rt.fade).toBe(0);
    expect(rt.mode).toBe(1);
  });

  it("inverts the pose rotation as the transpose, so the candidate reads the shape in its own frame", () => {
    // A unit-radius sphere moved to (2, 0, 0) and the query at the pose
    // center: the local point is the origin, so the candidate is the
    // sphere's own -radius, normalized by the bounding radius (= radius).
    const rt = resolveShapeTrap(
      sphereTrap({ position: [2, 0, 0], rotation: [0.3, 0.7, -0.2] }),
    );
    expect(shapeTrapCandidate(rt, 2, 0, 0, 0)).toBeCloseTo(-1, 12);
    // One bounding radius out along any axis reads 1 (rotation is an
    // isometry, so which axis cannot matter).
    expect(shapeTrapCandidate(rt, 2, 2, 0, 0)).toBeCloseTo(1, 12);
  });

  it("measures scale-relatively: doubling the trap scale halves nothing — the same RELATIVE offset reads the same candidate", () => {
    const at1 = resolveShapeTrap(sphereTrap());
    const at2 = resolveShapeTrap(sphereTrap({ scale: 2 }));
    // 2 world units from a scale-1 unit sphere == 4 world units from the
    // scale-2 one: both are one bounding-radius past the surface.
    expect(shapeTrapCandidate(at1, 2, 0, 0, 0)).toBeCloseTo(
      shapeTrapCandidate(at2, 4, 0, 0, 0),
      12,
    );
  });

  it("conjugates an asymmetric posed geometry SDF by rotation and uniform scale", () => {
    const rt = resolveShapeTrap({
      shape: {
        parts: [
          {
            primitive: { kind: "box", half: [1, 0.25, 0.25] },
            combine: "union",
          },
        ],
      },
      position: [2, 0, 0],
      rotation: [0, 0, Math.PI / 2],
      scale: 2,
    });
    // local (0.5, 0, 0) maps through scale then +90° rotation to world
    // (2, 1, 0). Its local box distance is -0.25, hence posed -0.5.
    // Omitting/inverting the rotation reads +0.5 instead, so this pins the
    // direction as well as the scale factor.
    expect(shapeTrapPosedSdf(rt, 2, 1, 0)).toBeCloseTo(-0.5, 12);
  });

  it("weights candidates by 1 + fade*step before the rule", () => {
    const rt = resolveShapeTrap(sphereTrap({ fade: 0.5 }));
    const base = shapeTrapCandidate(rt, 3, 0, 0, 0);
    expect(shapeTrapCandidate(rt, 3, 0, 0, 4)).toBeCloseTo(base * 3, 12);
  });

  it("finalizes min mode as the clamped best and threshold mode as the first crossing over its bar, 1 when nothing crossed", () => {
    const min = resolveShapeTrap(sphereTrap());
    expect(shapeTrapValue(min, 0.4, SHAPE_TRAP_NO_CROSSING)).toBe(0.4);
    expect(shapeTrapValue(min, -0.5, SHAPE_TRAP_NO_CROSSING)).toBe(0);
    expect(shapeTrapValue(min, 7, SHAPE_TRAP_NO_CROSSING)).toBe(1);
    const th = resolveShapeTrap(
      sphereTrap({ mode: "threshold", threshold: 0.5 }),
    );
    expect(shapeTrapValue(th, 0.1, SHAPE_TRAP_NO_CROSSING)).toBe(1);
    expect(shapeTrapValue(th, 0.1, 0.25)).toBeCloseTo(0.5, 12);
    expect(shapeTrapValue(th, -1, -0.2)).toBe(0);
  });
});
