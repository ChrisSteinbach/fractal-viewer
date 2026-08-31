import {
  chooseLatticeTerminal,
  clampLatticeRayInterval,
  intersectLatticePresentation3,
  intersectLatticePresentation4,
  latticeCameraCarrierRadius3,
  latticeCameraCarrierRadius4,
  latticeFogCoordinate,
  latticePresentationContains3,
  latticePresentationContains4,
  marchLatticeInterval,
} from "./lattice-march";
import { rotationMatrix4 } from "./affine4";
import { mirrorLatticeCoordinate } from "./tiling";
import type { Vec3 } from "./types";

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

function inverseYw(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, 0, s, 0, 0, 1, 0, 0, -s, 0, c];
}

describe("mirrored lattice presentation intervals", () => {
  const presentation = { contentRadius: 1, outerRadius: 5 };

  it("keeps a tangent sphere contact as a zero-length valid interval", () => {
    expect(
      intersectLatticePresentation3([5, 0, -2], [0, 0, 2], presentation),
    ).toEqual({ tEnter: 1, tFar: 1 });
  });

  it("starts at zero when the camera is already inside", () => {
    expect(
      intersectLatticePresentation3([0, 0, 0], [1, 0, 0], presentation),
    ).toEqual({ tEnter: 0, tFar: 5 });
  });

  it("handles a slab-parallel ray inside and rejects one outside", () => {
    expect(
      intersectLatticePresentation3([-10, 0.5, 0], [1, 0, 0], presentation),
    ).toEqual({ tEnter: 5.0250628144669, tFar: 14.9749371855331 });
    expect(
      intersectLatticePresentation3([-10, 1.01, 0], [1, 0, 0], presentation),
    ).toBeNull();
  });

  it("rejects a sphere wholly behind the ray and respects non-unit direction", () => {
    expect(
      intersectLatticePresentation3([10, 0, 0], [1, 0, 0], presentation),
    ).toBeNull();
    expect(
      intersectLatticePresentation3([-10, 0, 0], [2, 0, 0], presentation),
    ).toEqual({ tEnter: 2.5, tFar: 7.5 });
  });

  it("intersects the attractor-y slab after an arbitrary 4D rotor/slice lift", () => {
    const angle = 0.63;
    const inverseRotor = inverseYw(angle);
    const w0 = 0.37;
    const interval = intersectLatticePresentation4(
      [0, -4, 0],
      [0, 1, 0],
      w0,
      inverseRotor,
      { contentRadius: 0.8, outerRadius: 6 },
    );
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const y0 = c * -4 + s * w0;
    const yDir = c;
    expect(interval).not.toBeNull();
    expect(interval!.tEnter).toBeCloseTo((-0.8 - y0) / yDir, 12);
    expect(interval!.tFar).toBeCloseTo((0.8 - y0) / yDir, 12);
  });

  it("uses every spatial component of a compound SO(4) rotor's y row", () => {
    const inverseRotor = rotationMatrix4({
      xy: 0.31,
      yz: -0.47,
      xw: 0.19,
      yw: 0.63,
      zw: -0.22,
    });
    const row = inverseRotor.slice(4, 8);
    expect(row.every((coefficient) => Math.abs(coefficient) > 1e-3)).toBe(true);

    const w0 = 0.37;
    const spatialNorm2 = row[0] ** 2 + row[1] ** 2 + row[2] ** 2;
    const ro: Vec3 = [-10 * row[0], -10 * row[1], -10 * row[2]];
    const rd: Vec3 = [row[0], row[1], row[2]];
    const slabOrigin = -10 * spatialNorm2 + row[3] * w0;
    const slabDirection = spatialNorm2;
    const contentRadius = 0.5;
    const interval = intersectLatticePresentation4(ro, rd, w0, inverseRotor, {
      contentRadius,
      outerRadius: 50,
    });
    expect(interval).not.toBeNull();
    expect(interval!.tEnter).toBeCloseTo(
      (-contentRadius - slabOrigin) / slabDirection,
      12,
    );
    expect(interval!.tFar).toBeCloseTo(
      (contentRadius - slabOrigin) / slabDirection,
      12,
    );

    const middleT = -slabOrigin / slabDirection;
    const middle: Vec3 = [
      ro[0] + rd[0] * middleT,
      ro[1] + rd[1] * middleT,
      ro[2] + rd[2] * middleT,
    ];
    expect(
      latticePresentationContains4(middle, w0, inverseRotor, {
        contentRadius,
        outerRadius: 50,
      }),
    ).toBe(true);
    const outside: Vec3 = [
      ro[0] + rd[0] * (interval!.tFar + 1),
      ro[1] + rd[1] * (interval!.tFar + 1),
      ro[2] + rd[2] * (interval!.tFar + 1),
    ];
    expect(
      latticePresentationContains4(outside, w0, inverseRotor, {
        contentRadius,
        outerRadius: 50,
      }),
    ).toBe(false);
  });

  it("stays stable for near-parallel rotated 4D slabs", () => {
    const inverseRotor = inverseYw(Math.PI / 2 - 1e-8);
    const inside = intersectLatticePresentation4(
      [0, 0, 0],
      [0, 1, 0],
      0.49,
      inverseRotor,
      { contentRadius: 0.5, outerRadius: 100 },
    );
    expect(inside).not.toBeNull();
    expect(inside!.tEnter).toBe(0);
    expect(inside!.tFar).toBeCloseTo(100, 7);

    const outside = intersectLatticePresentation4(
      [0, 0, 0],
      [0, -1, 0],
      0.51,
      inverseRotor,
      { contentRadius: 0.5, outerRadius: 100 },
    );
    expect(outside).toBeNull();
  });

  it("requires an explicit valid outer window without choosing a ratio", () => {
    for (const bad of [0, -1, Infinity, NaN]) {
      expect(() =>
        intersectLatticePresentation3([0, 0, 0], [1, 0, 0], {
          contentRadius: 1,
          outerRadius: bad,
        }),
      ).toThrow(/outerRadius/);
    }
    expect(() =>
      intersectLatticePresentation3([0, 0, 0], [1, 0, 0], {
        contentRadius: 2,
        outerRadius: 1,
      }),
    ).toThrow(/outerRadius/);
  });
});

describe("shared lattice march/probe contract", () => {
  const h = 1;
  const radius = 1;
  const presentation = { contentRadius: radius, outerRadius: 3 };
  const center: Vec3 = [0.34, 0.06, 0.21];
  const sphereRadius = 0.3;
  const estimate = (p: Vec3): number => {
    const q: Vec3 = [
      mirrorLatticeCoordinate(p[0], h),
      p[1],
      mirrorLatticeCoordinate(p[2], h),
    ];
    return Math.max(
      Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]) -
        sphereRadius,
      Math.hypot(q[0], q[1], q[2]) - radius,
    );
  };

  it("crosses a cell wall and reaches repeated content without a seam stall", () => {
    const ro: Vec3 = [0.95, center[1], center[2]];
    const rd: Vec3 = [1, 0, 0];
    const interval = intersectLatticePresentation3(ro, rd, presentation)!;
    expect(estimate([h, center[1], center[2]])).toBeGreaterThan(0.3);
    const hit = marchLatticeInterval({
      ro,
      rd,
      interval,
      estimate,
      epsilon: () => 1e-5,
      stepScale: 0.9,
      maxSteps: 128,
    });
    expect(hit.status).toBe("hit");
    expect(hit.point[0]).toBeGreaterThan(h);
    expect(hit.steps).toBeLessThan(128);
  });

  it("terminates bounded work explicitly as exhausted", () => {
    const result = marchLatticeInterval({
      ro: [0, 0, 0],
      rd: [1, 0, 0],
      interval: { tEnter: 0, tFar: 10 },
      estimate: () => 0.1,
      epsilon: () => 0.01,
      stepScale: 1,
      maxSteps: 1,
    });
    expect(result).toMatchObject({ status: "exhausted", steps: 1, t: 0.1 });
  });

  it("reports non-finite and non-progressing estimates as stalled", () => {
    const nonFinite = marchLatticeInterval({
      ro: [0, 0, 0],
      rd: [1, 0, 0],
      interval: { tEnter: 0, tFar: 10 },
      estimate: () => NaN,
      epsilon: () => 0.01,
      stepScale: 1,
      maxSteps: 8,
    });
    expect(nonFinite).toMatchObject({ status: "stalled", steps: 1, t: 0 });

    const huge = 1e20;
    const noProgress = marchLatticeInterval({
      ro: [0, 0, 0],
      rd: [1, 0, 0],
      interval: { tEnter: huge, tFar: huge },
      estimate: () => 1,
      epsilon: () => 0.01,
      stepScale: 1,
      maxSteps: 8,
    });
    expect(noProgress).toMatchObject({
      status: "stalled",
      steps: 1,
      t: huge,
    });
  });

  it("treats normal/AO probes outside either carrier as open space", () => {
    expect(latticePresentationContains3([0.2, 0.9, 0.3], presentation)).toBe(
      true,
    );
    expect(latticePresentationContains3([0.2, 1.1, 0.3], presentation)).toBe(
      false,
    );
    expect(latticePresentationContains3([3.1, 0, 0], presentation)).toBe(false);

    const inverseRotor = inverseYw(0.63);
    expect(
      latticePresentationContains4([0, 0, 0], 0, inverseRotor, presentation),
    ).toBe(true);
    expect(
      latticePresentationContains4([0, 0, 0], 2, inverseRotor, presentation),
    ).toBe(false);
  });

  it("clips shadow reach to the same carrier and becomes open after tFar", () => {
    expect(clampLatticeRayInterval({ tEnter: 2, tFar: 8 }, 5)).toEqual({
      tEnter: 2,
      tFar: 5,
    });
    expect(clampLatticeRayInterval({ tEnter: 2, tFar: 8 }, 1)).toBeNull();
    expect(clampLatticeRayInterval(null, 5)).toBeNull();
  });

  it("measures fog from carrier entry and uses certified R as its scale", () => {
    const interval = { tEnter: 3, tFar: 11 };
    expect(latticeFogCoordinate(2, interval, 2)).toBe(0);
    expect(latticeFogCoordinate(7, interval, 2)).toBe(2);
  });

  it("pins canonical camera carriers without a presentation-window default", () => {
    expect(latticeCameraCarrierRadius3(2, 3)).toBe(Math.sqrt(17));
    expect(latticeCameraCarrierRadius4(2, 3)).toBe(Math.sqrt(21));
  });

  it("keeps the ground plane unfolded and resolves content/ground ties deterministically", () => {
    expect(chooseLatticeTerminal(null, null)).toBeNull();
    expect(chooseLatticeTerminal(null, 4)).toEqual({ kind: "ground", t: 4 });
    expect(chooseLatticeTerminal(3, null)).toEqual({ kind: "content", t: 3 });
    expect(chooseLatticeTerminal(3, 4)).toEqual({ kind: "content", t: 3 });
    expect(chooseLatticeTerminal(4, 3)).toEqual({ kind: "ground", t: 3 });
    expect(chooseLatticeTerminal(3, 3)).toEqual({ kind: "content", t: 3 });
  });

  it("keeps identity-rotor 4D carrier semantics equal to 3D y", () => {
    const ro: Vec3 = [-4, 0.2, 0];
    const rd: Vec3 = [1, 0, 0];
    expect(
      intersectLatticePresentation4(ro, rd, 0.37, IDENTITY4, presentation),
    ).toEqual(intersectLatticePresentation3(ro, rd, presentation));
  });
});
