import type { Vec3, Vec4 } from "./types";
import { rotationMatrix4 } from "./affine4";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_ENVIRONMENT_BOUND,
  DIELECTRIC_ERROR_BUDGET,
  DIELECTRIC_INITIAL_BRANCH_THETA,
  DIELECTRIC_IOR,
  DIELECTRIC_MAX_PROCESSED_PATHS,
  DIELECTRIC_MAX_STACK,
  DIELECTRIC_REPLAY_PASSES,
  dielectricBeerThroughput,
  dielectricBranchBound,
  dielectricFresnel,
  dielectricIntrinsicDirection,
  dielectricIntrinsicPoint,
  dielectricOpticsSource,
  dielectricRefract,
  dielectricReplayTheta,
  dielectricSampleAccepted,
  dielectricSliceNormal,
  dielectricTrace,
  dielectricTraceStart,
  dielectricTraceStep,
  dielectricWeakChildStackBound,
  type DielectricBoundaryEvent,
  type DielectricBoundaryQuery,
  type DielectricBoundaryResult,
  type DielectricMaterial,
  type DielectricScene,
} from "./surface-dielectric";

const GLASS: DielectricMaterial = {
  ior: DIELECTRIC_IOR,
  absorption: DIELECTRIC_ABSORPTION,
  radius: 0.75,
};

const CLEAR_GLASS: DielectricMaterial = { ...GLASS, absorption: [0, 0, 0] };

const REAR: Vec3 = [0.5, 0.6, 0.7];

function flatEnvironment(rear: Vec3 = REAR): DielectricScene {
  return {
    radianceBound: DIELECTRIC_ENVIRONMENT_BOUND,
    nextBoundary: () => ({ kind: "miss" }),
    rearRadiance: () => [...rear] as Vec3,
  };
}

type Recorded = DielectricBoundaryQuery & { result: DielectricBoundaryResult };

function recording(scene: DielectricScene): {
  scene: DielectricScene;
  log: Recorded[];
} {
  const log: Recorded[] = [];
  return {
    log,
    scene: {
      radianceBound: scene.radianceBound,
      rearRadiance: scene.rearRadiance,
      nextBoundary(query) {
        const result = scene.nextBoundary(query);
        log.push({ ...query, result });
        return result;
      },
    },
  };
}

function boundaryEvents(log: Recorded[]): DielectricBoundaryEvent[] {
  return log.flatMap((entry) =>
    entry.result.kind === "boundary" ? [entry.result] : [],
  );
}

function firstBoundary(log: Recorded[]): DielectricBoundaryEvent {
  const event = boundaryEvents(log)[0];
  if (!event) throw new Error("expected a boundary event");
  return event;
}

/** Outward normal of an interval endpoint: -x at a low end, +x at a high end. */
function intervalNormal(
  intervals: readonly (readonly [number, number])[],
  plane: number,
): Vec3 {
  const isHighEnd = intervals.some(([, hi]) => hi === plane);
  const isLowEnd = intervals.some(([lo]) => lo === plane);
  if (isHighEnd && !isLowEnd) return [1, 0, 0];
  return [-1, 0, 0];
}

/**
 * Axis-interval optical solid on the x axis: the union of closed intervals,
 * infinite in y and z. Exact endpoint crossings; medium state cross-checked
 * against closed membership (never a distance sign); anchors validated within
 * a roundoff envelope, their own face suppressed only exactly at the origin.
 */
function axisIntervalsScene(
  intervals: readonly (readonly [number, number])[],
  options: {
    slots?: readonly (number | undefined)[];
    rear?: Vec3;
    envelope?: number;
    radianceBound?: number;
  } = {},
): DielectricScene {
  const extent = Math.max(...intervals.flat(), 1);
  const envelope = options.envelope ?? 2 * 2 ** -23 * extent;
  const probe = 1e-12 * extent;
  const planes = intervals.flatMap(([lo, hi]) => [lo, hi]);
  const occupancy = (x: number) =>
    intervals.some(([lo, hi]) => lo <= x && x <= hi);
  const onPlane = (x: number) =>
    planes.some((plane) => Math.abs(x - plane) <= envelope);
  return {
    radianceBound: options.radianceBound ?? DIELECTRIC_ENVIRONMENT_BOUND,
    nextBoundary({ origin, direction, inside, anchor }) {
      const o = origin[0];
      const d = direction[0];
      let anchoredPlane: number | null = null;
      if (anchor) {
        const plane = (anchor as { plane?: unknown }).plane;
        if (
          typeof plane !== "number" ||
          !Number.isFinite(plane) ||
          Math.abs(o - plane) > envelope
        )
          return { kind: "refused", reason: "invalid-input" };
        anchoredPlane = plane;
      }
      // The anchored plane identity is authoritative: reconstruct the origin
      // coordinate from it (the qualified model's reconstruction allowance),
      // so the anchored face's own crossing lands exactly at t = 0.
      const oEff = anchoredPlane ?? o;
      if (occupancy(oEff) !== inside && !onPlane(oEff))
        return { kind: "refused", reason: "state-mismatch" };
      if (d === 0) return { kind: "miss" };
      const candidates = planes
        .map((plane) => ({ plane, t: (plane - oEff) / d }))
        .filter(({ plane, t }) => {
          if (t < 0) return false;
          if (t === 0 && anchoredPlane === plane) return false;
          return true;
        })
        .sort((a, b) => a.t - b.t);
      for (const { plane, t } of candidates) {
        // Sample membership just AHEAD of the crossing along the ray.
        const entering = occupancy(oEff + (t + probe) * d);
        if (entering === inside) continue;
        const slot = options.slots?.[planes.indexOf(plane)];
        return {
          kind: "boundary",
          t,
          entering,
          outwardNormal: intervalNormal(intervals, plane),
          anchor: { plane },
          ...(slot === undefined ? {} : { materialSlot: slot }),
        };
      }
      return { kind: "miss" };
    },
    rearRadiance: () => [...(options.rear ?? REAR)] as Vec3,
  };
}

/**
 * Spherical-shell optical solid: the closed annulus `rInner <= |p| <= rOuter`.
 * Exact quadratic crossings; membership from exact radii, never a sign test.
 */
function shellScene(
  rInner: number,
  rOuter: number,
  options: { rear?: Vec3 } = {},
): DielectricScene {
  const envelope = 2 * 2 ** -23 * rOuter;
  return {
    radianceBound: DIELECTRIC_ENVIRONMENT_BOUND,
    nextBoundary({ origin, direction, inside, anchor }) {
      const radius = Math.hypot(...origin);
      let anchored: string | null = null;
      if (anchor) {
        const sphere = (anchor as { sphere?: unknown }).sphere;
        if (sphere !== "inner" && sphere !== "outer")
          return { kind: "refused", reason: "invalid-input" };
        anchored = sphere;
        const anchoredRadius = sphere === "inner" ? rInner : rOuter;
        if (Math.abs(radius - anchoredRadius) > envelope)
          return { kind: "refused", reason: "invalid-input" };
      }
      const onBoundary =
        Math.abs(radius - rInner) <= envelope ||
        Math.abs(radius - rOuter) <= envelope;
      const member = rInner <= radius && radius <= rOuter;
      if (member !== inside && !onBoundary)
        return { kind: "refused", reason: "state-mismatch" };
      const b =
        origin[0] * direction[0] +
        origin[1] * direction[1] +
        origin[2] * direction[2];
      const c0 = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2;
      const crossings: {
        t: number;
        sphere: "inner" | "outer";
        entering: boolean;
      }[] = [];
      for (const sphere of ["inner", "outer"] as const) {
        const R = sphere === "inner" ? rInner : rOuter;
        const disc = b * b - (c0 - R * R);
        if (disc < 0) continue;
        const root = Math.sqrt(disc);
        for (const t of [-b - root, -b + root]) {
          if (t < 0) continue;
          if (t === 0 && anchored === sphere) continue;
          const hit = [
            origin[0] + t * direction[0],
            origin[1] + t * direction[1],
            origin[2] + t * direction[2],
          ] as Vec3;
          const outward =
            hit[0] * direction[0] +
              hit[1] * direction[1] +
              hit[2] * direction[2] >
            0;
          const entering = sphere === "outer" ? !outward : outward;
          crossings.push({ t, sphere, entering });
        }
      }
      crossings.sort((a, b) => a.t - b.t);
      for (const { t, sphere, entering } of crossings) {
        if (entering === inside) continue;
        const hit = [
          origin[0] + t * direction[0],
          origin[1] + t * direction[1],
          origin[2] + t * direction[2],
        ] as Vec3;
        const norm = Math.hypot(...hit);
        const sign = sphere === "outer" ? 1 : -1;
        return {
          kind: "boundary",
          t,
          entering,
          outwardNormal: [
            (sign * hit[0]) / norm + 0,
            (sign * hit[1]) / norm + 0,
            (sign * hit[2]) / norm + 0,
          ] as Vec3,
          anchor: { sphere },
        };
      }
      return { kind: "miss" };
    },
    rearRadiance: () => [...(options.rear ?? REAR)] as Vec3,
  };
}

/**
 * Posed native-4D optical solid: the closed intrinsic box `[-h, h]^4`, queried
 * through the displayed slice — the displayed ray embeds by the row-major
 * world→intrinsic rows and the displayed normal comes from the face's matrix
 * row. Exact plane inequalities; no sign test.
 */
function posedBoxScene(
  rows: readonly number[],
  slice: number,
  h: number,
  options: { rear?: Vec3 } = {},
): DielectricScene {
  const envelope = 4 * 2 ** -23 * h;
  return {
    radianceBound: DIELECTRIC_ENVIRONMENT_BOUND,
    nextBoundary(query): DielectricBoundaryResult {
      const { origin, direction, inside, anchor } = query;
      const q0 = dielectricIntrinsicPoint(rows, slice, origin);
      const qd = dielectricIntrinsicDirection(rows, direction);
      let anchoredAxis: number | null = null;
      let anchoredPlane: number | null = null;
      if (anchor) {
        const axis = (anchor as { axis?: unknown }).axis;
        const plane = (anchor as { plane?: unknown }).plane;
        if (
          typeof axis !== "number" ||
          !Number.isInteger(axis) ||
          axis < 0 ||
          axis > 3 ||
          typeof plane !== "number" ||
          !Number.isFinite(plane)
        )
          return { kind: "refused", reason: "invalid-input" };
        anchoredAxis = axis;
        anchoredPlane = plane;
        if (Math.abs(q0[axis] - plane) > envelope)
          return { kind: "refused", reason: "invalid-input" };
        // The anchored plane identity is authoritative: reconstruct the
        // masked coordinate from it (the qualified model's reconstruction
        // allowance), so the anchored face's own crossing lands exactly at
        // t = 0.
        q0[axis] = plane;
      }
      const onPlane = [0, 1, 2, 3].some((axis) =>
        [-h, h].some((plane) => Math.abs(q0[axis] - plane) <= envelope),
      );
      const member = [0, 1, 2, 3].every(
        (axis) => -h <= q0[axis] && q0[axis] <= h,
      );
      if (member !== inside && !onPlane)
        return { kind: "refused", reason: "state-mismatch" };
      let tEnter = Number.NEGATIVE_INFINITY;
      let tExit = Number.POSITIVE_INFINITY;
      let enterAxis = -1;
      let exitAxis = -1;
      let valid = true;
      for (let axis = 0; axis < 4; axis++) {
        const q = q0[axis];
        const qdd = qd[axis];
        if (Math.abs(qdd) < 1e-15) {
          if (q < -h || q > h) valid = false;
          continue;
        }
        let near = (-h - q) / qdd;
        let far = (h - q) / qdd;
        if (near > far) [near, far] = [far, near];
        if (near > tEnter) {
          tEnter = near;
          enterAxis = axis;
        }
        if (far < tExit) {
          tExit = far;
          exitAxis = axis;
        }
      }
      if (!valid || tExit < tEnter) return { kind: "miss" };
      const event = (t: number, axis: number, entering: boolean) => {
        if (t === 0 && anchoredAxis === axis) {
          const plane = q0[axis] <= 0 ? -h : h;
          if (anchoredPlane === plane) return { kind: "miss" } as const;
        }
        const moving = qd[axis] > 0 ? 1 : -1;
        const faceSign: 1 | -1 = entering
          ? moving === 1
            ? -1
            : 1
          : moving === 1
            ? 1
            : -1;
        const row = rows.slice(4 * axis, 4 * axis + 4) as Vec4;
        const outwardNormal = dielectricSliceNormal(row, faceSign);
        if (!outwardNormal)
          return { kind: "refused", reason: "degenerate-normal" } as const;
        return {
          kind: "boundary",
          t,
          entering,
          outwardNormal,
          anchor: { axis, plane: q0[axis] + t * qd[axis] },
        } as const;
      };
      if (inside) {
        if (tExit < 0)
          return onPlane
            ? { kind: "miss" }
            : { kind: "refused", reason: "state-mismatch" };
        return event(tExit, exitAxis, false);
      }
      if (tEnter < 0)
        return tExit > 0
          ? { kind: "refused", reason: "state-mismatch" }
          : { kind: "miss" };
      return event(tEnter, enterAxis, true);
    },
    rearRadiance: () => [...(options.rear ?? REAR)] as Vec3,
  };
}

describe("dielectric optics (f64 oracle)", () => {
  it("pins normal-incidence Fresnel to its exact rational value", () => {
    expect(dielectricFresnel(1, 1, DIELECTRIC_IOR)).toBeCloseTo(
      (9 / 49) ** 2,
      15,
    );
  });

  it("reflects fully at and beyond the critical angle", () => {
    const sin50 = Math.sin((50 * Math.PI) / 180);
    const cos50 = Math.cos((50 * Math.PI) / 180);
    expect(dielectricFresnel(cos50, DIELECTRIC_IOR, 1)).toBe(1);
    const bend = dielectricRefract(
      [cos50, sin50, 0],
      [1, 0, 0],
      DIELECTRIC_IOR,
      1,
    );
    expect(bend.tir).toBe(true);
    expect(bend.direction[0]).toBeCloseTo(-cos50, 15);
    expect(bend.direction[1]).toBeCloseTo(sin50, 15);
  });

  it("keeps the direction under matched IORs", () => {
    const incident: Vec3 = [0.3, 0.4, 0.5];
    const bend = dielectricRefract(incident, [-1, 0, 0], 1, 1);
    expect(bend.tir).toBe(false);
    const length = Math.hypot(...incident);
    expect(bend.direction).toEqual(incident.map((v) => v / length));
  });

  it("applies Beer per channel and refuses invalid inputs", () => {
    expect(dielectricBeerThroughput(0.17, 0.5, 0.75)).toBe(
      Math.exp((-0.17 * 0.5) / 0.75),
    );
    expect(dielectricBeerThroughput(0, 2, 1)).toBe(1);
    expect(() => dielectricBeerThroughput(-1, 0.5, 0.75)).toThrow();
    expect(() => dielectricBeerThroughput(0.17, 0.5, 0)).toThrow();
  });

  it("refuses broken refraction inputs", () => {
    expect(() => dielectricRefract([1, 0, 0], [0, 0, 0], 1, 1.45)).toThrow();
    expect(() => dielectricRefract([1, 0, 0], [1, 0, 0], -1, 1.45)).toThrow();
    expect(() =>
      dielectricRefract([Number.NaN, 0, 0], [1, 0, 0], 1, 1.45),
    ).toThrow();
  });

  it("derives the weak-child stack requirement exactly", () => {
    expect(dielectricWeakChildStackBound(4, 2 ** -21)).toEqual({
      descents: 22,
      liveEntries: 23,
    });
    expect(dielectricWeakChildStackBound(4, 2 ** -20)).toEqual({
      descents: 21,
      liveEntries: 22,
    });
    expect(DIELECTRIC_MAX_STACK).toBeGreaterThanOrEqual(
      dielectricWeakChildStackBound(
        DIELECTRIC_ENVIRONMENT_BOUND,
        dielectricReplayTheta(DIELECTRIC_REPLAY_PASSES - 1),
      ).liveEntries,
    );
  });

  it("halves theta per replay pass", () => {
    expect(dielectricReplayTheta(0)).toBe(DIELECTRIC_INITIAL_BRANCH_THETA);
    expect(dielectricReplayTheta(1)).toBe(DIELECTRIC_INITIAL_BRANCH_THETA / 2);
    expect(dielectricReplayTheta(3)).toBe(DIELECTRIC_INITIAL_BRANCH_THETA / 8);
    expect(() => dielectricReplayTheta(-1)).toThrow();
  });

  it("pins the qualified constants", () => {
    expect(DIELECTRIC_IOR).toBe(1.45);
    expect(DIELECTRIC_ABSORPTION).toEqual([0.17, 0.055, 0.025]);
    expect(DIELECTRIC_ENVIRONMENT_BOUND).toBe(4);
    expect(DIELECTRIC_ERROR_BUDGET).toBe(1 / 1024);
    expect(DIELECTRIC_INITIAL_BRANCH_THETA).toBe(1 / (1024 * 64));
    expect(DIELECTRIC_REPLAY_PASSES).toBe(6);
    expect(DIELECTRIC_MAX_PROCESSED_PATHS).toBe(16384);
  });
});

describe("transport oracle", () => {
  it("returns the environment unchanged for a true miss", () => {
    const state = dielectricTrace(
      flatEnvironment(),
      [0, 0, 5],
      [0, 0, -1],
      GLASS,
    );
    expect(state.status).toBe("complete");
    expect(state.radiance).toEqual(REAR);
    expect(state.residual).toBe(0);
    expect(state.processedPaths).toBe(1);
    expect(state.failure).toBeNull();
  });

  it("weights the first reflection by Fresnel and attenuates the rest away", () => {
    // Absorption so high that nothing survives the slab interior: the only
    // radiance is the Fresnel-weighted entry reflection.
    const scene = axisIntervalsScene([[-0.5, 0.5]]);
    const material: DielectricMaterial = {
      ...GLASS,
      absorption: [200, 200, 200],
    };
    const state = dielectricTrace(scene, [-2, 0, 0], [1, 0, 0], material);
    expect(state.status).toBe("residual");
    const f = (0.45 / 2.45) ** 2;
    expect(state.radiance[0]).toBeCloseTo(f * REAR[0], 15);
    expect(state.radiance[1]).toBeCloseTo(f * REAR[1], 15);
    expect(state.radiance[2]).toBeCloseTo(f * REAR[2], 15);
  });

  it("conserves energy within the residual bound (no absorption)", () => {
    const scene = axisIntervalsScene([[-0.5, 0.5]], {
      radianceBound: 1,
      rear: [1, 1, 1],
    });
    const state = dielectricTrace(scene, [-2, 0, 0], [1, 0, 0], CLEAR_GLASS);
    expect(state.status).toBe("residual");
    for (const channel of state.radiance)
      expect(channel).toBeLessThanOrEqual(1 + 1e-12);
    // The closed-form total is exactly 1 at normal incidence; the truncated
    // trace plus the summed cut bounds must bracket it.
    expect(state.radiance[0] + state.residual).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it("composes two clear interfaces to the closed-form slab transmission", () => {
    const scene = axisIntervalsScene([[-0.5, 0.5]]);
    const state = dielectricTrace(scene, [-2, 0, 0], [1, 0, 0], CLEAR_GLASS, {
      theta: 0.4,
    });
    const f = dielectricFresnel(1, 1, DIELECTRIC_IOR);
    // With the large cutoff exactly the transmitted chain survives: the
    // radiance is (1-f)^2 L and the residual sums the two cut children.
    expect(state.radiance[0]).toBeCloseTo((1 - f) ** 2 * REAR[0], 14);
    expect(state.residual).toBeCloseTo(4 * (f + f * (1 - f)), 14);
    expect(state.processedPaths).toBe(3);
  });

  it("carries medium state and per-face material attribution through the run", () => {
    const scene = axisIntervalsScene([[-1, 1]], { slots: [0, 1] });
    const { scene: watched, log } = recording(scene);
    const state = dielectricTrace(watched, [-2, 0, 0], [1, 0, 0], CLEAR_GLASS, {
      theta: 0.4,
    });
    expect(state.status).toBe("residual");
    expect(log.length).toBe(3);
    expect(log[0].inside).toBe(false);
    expect(log[0].result).toMatchObject({
      kind: "boundary",
      t: 1,
      entering: true,
      materialSlot: 0,
    });
    expect(firstBoundary(log).outwardNormal).toEqual([-1, 0, 0]);
    expect(log[1].inside).toBe(true);
    expect(log[1].anchor).toEqual({ plane: -1 });
    expect(log[1].result).toMatchObject({
      kind: "boundary",
      t: 2,
      entering: false,
      materialSlot: 1,
    });
    expect(log[2].inside).toBe(false);
    expect(log[2].anchor).toEqual({ plane: 1 });
    expect(log[2].result.kind).toBe("miss");
  });

  it("attenuates interior segments and never merges the thin gap", () => {
    const gap = 1e-9;
    const scene = axisIntervalsScene([
      [0, 1],
      [1 + gap, 2],
    ]);
    const { scene: watched, log } = recording(scene);
    const state = dielectricTrace(watched, [-1, 0, 0], [1, 0, 0], GLASS, {
      theta: 0.4,
    });
    const events = boundaryEvents(log);
    expect(events.length).toBe(4);
    // Per-query distances: each continuation query restarts at its boundary.
    const expectedTimes = [1, 1, gap, 1 - gap];
    events.forEach((event, index) =>
      expect(event.t).toBeCloseTo(expectedTimes[index], 12),
    );
    expect(log.map((entry) => entry.inside)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    const beer1 = dielectricBeerThroughput(
      GLASS.absorption[0],
      1,
      GLASS.radius,
    );
    const beerGap = dielectricBeerThroughput(
      GLASS.absorption[0],
      1 - gap,
      GLASS.radius,
    );
    const f = dielectricFresnel(1, 1, DIELECTRIC_IOR);
    // Both interior segments attenuate; the gap does not.
    expect(state.radiance[0]).toBeCloseTo(
      (1 - f) ** 4 * beer1 * beerGap * REAR[0],
      14,
    );
  });

  it("starts inside a band and attenuates from the origin", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const beer1 = dielectricBeerThroughput(
      GLASS.absorption[0],
      1,
      GLASS.radius,
    );
    const beer2 = dielectricBeerThroughput(
      GLASS.absorption[0],
      2,
      GLASS.radius,
    );
    const f = dielectricFresnel(1, 1, DIELECTRIC_IOR);
    const fromCentre = dielectricTrace(scene, [0, 0, 0], [1, 0, 0], GLASS, {
      initialMedium: true,
      theta: 0.4,
    });
    expect(fromCentre.radiance[0]).toBeCloseTo(beer1 * (1 - f) * REAR[0], 14);
    const fromFace = dielectricTrace(scene, [-1, 0, 0], [1, 0, 0], GLASS, {
      initialMedium: true,
      theta: 0.4,
    });
    expect(fromFace.radiance[0]).toBeCloseTo(beer2 * (1 - f) * REAR[0], 14);
  });

  it("refuses when the caller's medium contradicts membership (no sign test)", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const state = dielectricTrace(scene, [0, 0, 0], [1, 0, 0], GLASS, {
      initialMedium: false,
    });
    expect(state.status).toBe("unresolved");
    expect(state.failure).toEqual({
      kind: "traversal",
      reason: "state-mismatch",
    });
  });

  it("reports an inside miss instead of a background hit", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const state = dielectricTrace(scene, [0, 0, 0], [0, 1, 0], GLASS, {
      initialMedium: true,
    });
    expect(state.status).toBe("unresolved");
    expect(state.failure).toEqual({ kind: "inside-miss" });
  });

  it("keeps total internal reflection inside until the interface guard", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const sin50 = Math.sin((50 * Math.PI) / 180);
    const cos50 = Math.cos((50 * Math.PI) / 180);
    const state = dielectricTrace(
      scene,
      [0, 0, 0],
      [cos50, sin50, 0],
      CLEAR_GLASS,
      { initialMedium: true, limits: { maxInterfaces: 4 } },
    );
    expect(state.status).toBe("unresolved");
    expect(state.failure).toEqual({ kind: "interfaces" });
    expect(state.processedPaths).toBe(4);
    expect(state.residual).toBeGreaterThan(0);
  });

  it("keeps TIR energy intact through the Beer segment", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const sin50 = Math.sin((50 * Math.PI) / 180);
    const cos50 = Math.cos((50 * Math.PI) / 180);
    const state = dielectricTraceStart(
      scene,
      [0, 0, 0],
      [cos50, sin50, 0],
      GLASS,
      { initialMedium: true },
    );
    dielectricTraceStep(state, scene, GLASS, 1);
    expect(state.stack.length).toBe(1);
    const child = state.stack[0];
    expect(child.inside).toBe(true);
    const beer = (channel: number) =>
      dielectricBeerThroughput(
        GLASS.absorption[channel],
        1 / cos50,
        GLASS.radius,
      );
    expect(child.throughput[0]).toBeCloseTo(beer(0), 15);
    expect(child.throughput[1]).toBeCloseTo(beer(1), 15);
    expect(child.throughput[2]).toBeCloseTo(beer(2), 15);
  });

  it("distinguishes exhaustion from a miss", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const state = dielectricTrace(scene, [-2, 0, 0], [1, 0, 0], CLEAR_GLASS, {
      limits: { maxProcessedPaths: 1 },
    });
    expect(state.status).toBe("unresolved");
    expect(state.failure).toEqual({ kind: "processed-paths" });
    expect(state.processedPaths).toBe(1);
    expect(state.residual).toBeGreaterThan(0);
  });

  it("marks non-finite rear radiance invalid, never background", () => {
    const scene = flatEnvironment([Number.NaN, 0.6, 0.7]);
    const state = dielectricTrace(scene, [0, 0, 5], [0, 0, -1], GLASS);
    expect(state.status).toBe("invalid");
    expect(
      dielectricSampleAccepted(state.status, state.radiance, state.residual),
    ).toBe(false);
  });

  it("rejects structurally broken traces up front", () => {
    const scene = flatEnvironment();
    expect(() => dielectricTrace(scene, [0, 0, 0], [0, 0, 0], GLASS)).toThrow();
    expect(() =>
      dielectricTrace(scene, [Number.NaN, 0, 0], [0, 0, 1], GLASS),
    ).toThrow();
    expect(() =>
      dielectricTrace(scene, [0, 0, 5], [0, 0, -1], { ...GLASS, ior: 0 }),
    ).toThrow();
    expect(() =>
      dielectricTrace(scene, [0, 0, 5], [0, 0, -1], {
        ...GLASS,
        absorption: [-0.1, 0, 0],
      }),
    ).toThrow();
    expect(() =>
      dielectricTrace(scene, [0, 0, 5], [0, 0, -1], GLASS, { theta: -1 }),
    ).toThrow();
    expect(() =>
      dielectricTrace(
        { ...scene, radianceBound: 0 },
        [0, 0, 5],
        [0, 0, -1],
        GLASS,
      ),
    ).toThrow();
  });
});

describe("layered and posed geometry", () => {
  it("walks all four shell interfaces of a spherical annulus", () => {
    const scene = shellScene(0.5, 1);
    const { scene: watched, log } = recording(scene);
    const state = dielectricTrace(watched, [-2, 0, 0], [1, 0, 0], GLASS, {
      theta: 0.4,
    });
    expect(state.status).toBe("residual");
    const events = boundaryEvents(log);
    // Per-query distances: entry from x=-2, then each continuation restarts
    // at its own boundary (1.5 -> 0.5 -> 1 -> 0.5 cumulative 1/1.5/2.5/3).
    expect(events.map((event) => event.t)).toEqual([1, 0.5, 1, 0.5]);
    expect(events.map((event) => event.outwardNormal)).toEqual([
      [-1, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [1, 0, 0],
    ]);
    expect(log.map((entry) => entry.inside)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("reproduces the 3D slab exactly with identity 4D rows and slice zero", () => {
    const posed = posedBoxScene(rotationMatrix4({}), 0, 1);
    const flat = axisIntervalsScene([[-1, 1]]);
    const ray = {
      origin: [-2, 0.1, 0.05] as Vec3,
      direction: [1, 0, 0] as Vec3,
    };
    const posedState = dielectricTrace(
      posed,
      ray.origin,
      ray.direction,
      CLEAR_GLASS,
      {
        theta: 0.4,
      },
    );
    const flatState = dielectricTrace(
      flat,
      ray.origin,
      ray.direction,
      CLEAR_GLASS,
      {
        theta: 0.4,
      },
    );
    expect(posedState.radiance).toEqual(flatState.radiance);
    expect(posedState.residual).toBe(flatState.residual);
  });

  it("queries the posed slice through inverse rotation, matching exact membership", () => {
    const rows = rotationMatrix4({ xw: 0.57, yw: -0.31 }).map(Math.fround);
    const slice = 0.18;
    const h = 0.75;
    const { scene: watched, log } = recording(posedBoxScene(rows, slice, h));
    const origin: Vec3 = [-2, 0.1, 0.05];
    const rawDirection: Vec3 = [1, 0.02, -0.01];
    const length = Math.hypot(...rawDirection);
    const direction = rawDirection.map((v) => v / length) as Vec3;
    const state = dielectricTrace(watched, origin, direction, CLEAR_GLASS, {
      theta: 0.4,
    });
    expect(state.status).toBe("residual");
    // Independent oracle: bisect the exact displayed membership flip.
    const member = (t: number) => {
      const q = dielectricIntrinsicPoint(rows, slice, [
        origin[0] + t * direction[0],
        origin[1] + t * direction[1],
        origin[2] + t * direction[2],
      ]);
      return [0, 1, 2, 3].every((axis) => -h <= q[axis] && q[axis] <= h);
    };
    expect(member(0)).toBe(false);
    expect(member(2)).toBe(true);
    let lo = 0;
    let hi = 2;
    while (hi - lo > 1e-12) {
      const mid = (lo + hi) / 2;
      if (member(mid)) hi = mid;
      else lo = mid;
    }
    const first = firstBoundary(log);
    expect(first.t).toBeCloseTo(hi, 9);
    // The displayed normal is the slice normal of the crossed face's row.
    const hit = [
      origin[0] + first.t * direction[0],
      origin[1] + first.t * direction[1],
      origin[2] + first.t * direction[2],
    ] as Vec3;
    const q = dielectricIntrinsicPoint(rows, slice, hit);
    const axis = [0, 1, 2, 3].find((a) => Math.abs(Math.abs(q[a]) - h) < 1e-9);
    expect(axis).toBeDefined();
    if (axis === undefined) return;
    const expected = dielectricSliceNormal(
      rows.slice(4 * axis, 4 * axis + 4) as Vec4,
      q[axis] < 0 ? -1 : 1,
    );
    expect(expected).not.toBeNull();
    expect(first.outwardNormal[0]).toBeCloseTo((expected as Vec3)[0], 12);
    expect(first.outwardNormal[1]).toBeCloseTo((expected as Vec3)[1], 12);
    expect(first.outwardNormal[2]).toBeCloseTo((expected as Vec3)[2], 12);
    expect(Math.hypot(...first.outwardNormal)).toBeCloseTo(1, 15);
  });

  it("moves the displayed object with the slice", () => {
    const rows = rotationMatrix4({ xw: 0.57, yw: -0.31 }).map(Math.fround);
    const origin: Vec3 = [-2, 0.1, 0.05];
    const direction: Vec3 = [1, 0, 0];
    const { scene: watchedA, log: logA } = recording(
      posedBoxScene(rows, 0, 0.75),
    );
    const { scene: watchedB, log: logB } = recording(
      posedBoxScene(rows, 0.18, 0.75),
    );
    dielectricTrace(watchedA, origin, direction, CLEAR_GLASS, { theta: 0.4 });
    dielectricTrace(watchedB, origin, direction, CLEAR_GLASS, { theta: 0.4 });
    const centred = firstBoundary(logA).t;
    const offCentred = firstBoundary(logB).t;
    expect(centred).not.toBe(offCentred);
  });

  it("refuses broken or inconsistent posed anchors", () => {
    const rows = rotationMatrix4({ xw: 0.57, yw: -0.31 }).map(Math.fround);
    const scene = posedBoxScene(rows, 0.18, 0.75);
    const origin: Vec3 = [-2, 0.1, 0.05];
    const direction: Vec3 = [1, 0, 0];
    expect(
      scene.nextBoundary({
        origin,
        direction,
        inside: false,
        anchor: { axis: 9, plane: 0 },
      }),
    ).toMatchObject({ kind: "refused", reason: "invalid-input" });
    expect(
      scene.nextBoundary({
        origin,
        direction,
        inside: false,
        anchor: { axis: 0, plane: 99 },
      }),
    ).toMatchObject({ kind: "refused", reason: "invalid-input" });
  });
});

describe("chunked resumption", () => {
  const cases = () => [
    {
      scene: axisIntervalsScene([[-1, 1]]),
      origin: [-2, 0, 0] as Vec3,
      direction: [1, 0, 0] as Vec3,
    },
    {
      scene: axisIntervalsScene([
        [0, 1],
        [1 + 1e-9, 2],
      ]),
      origin: [-1, 0, 0] as Vec3,
      direction: [1, 0, 0] as Vec3,
    },
    {
      scene: shellScene(0.5, 1),
      origin: [-2, 0, 0] as Vec3,
      direction: [1, 0, 0] as Vec3,
    },
    {
      scene: posedBoxScene(
        rotationMatrix4({ xw: 0.57, yw: -0.31 }).map(Math.fround),
        0.18,
        0.75,
      ),
      origin: [-2, 0.1, 0.05] as Vec3,
      direction: [1, 0.02, -0.01] as Vec3,
    },
  ];

  for (const chunk of [1, 2, 3, 7, 503]) {
    it(`reproduces the uninterrupted oracle bit-for-bit at chunk size ${chunk}`, () => {
      for (const { scene, origin, direction } of cases()) {
        const whole = dielectricTrace(scene, origin, direction, GLASS);
        const stepped = dielectricTraceStart(scene, origin, direction, GLASS);
        while (stepped.status === "running")
          dielectricTraceStep(stepped, scene, GLASS, chunk);
        expect(stepped.status).toBe(whole.status);
        expect(stepped.radiance).toEqual(whole.radiance);
        expect(stepped.residual).toBe(whole.residual);
        expect(stepped.processedPaths).toBe(whole.processedPaths);
        expect(stepped.failure).toEqual(whole.failure);
      }
    });
  }
});

describe("replay schedule", () => {
  it("accepts a default-trace sample within the per-sample budget", () => {
    const scene = axisIntervalsScene([[-1, 1]]);
    const state = dielectricTrace(scene, [-2, 0, 0], [1, 0, 0], GLASS);
    expect(state.status === "complete" || state.status === "residual").toBe(
      true,
    );
    expect(state.residual).toBeLessThanOrEqual(DIELECTRIC_ERROR_BUDGET);
    expect(
      dielectricSampleAccepted(state.status, state.radiance, state.residual),
    ).toBe(true);
  });

  it("monotonically trades cutoff for traced work across passes", () => {
    const targets: DielectricScene[] = [
      axisIntervalsScene([[-1, 1]]),
      shellScene(0.5, 1),
    ];
    for (const target of targets) {
      let previousRadiance: Vec3 | null = null;
      let previousResidual: number | null = null;
      for (let pass = 0; pass < DIELECTRIC_REPLAY_PASSES; pass++) {
        const state = dielectricTrace(target, [-2, 0, 0], [1, 0, 0], GLASS, {
          theta: dielectricReplayTheta(pass, DIELECTRIC_ERROR_BUDGET),
        });
        expect(state.status === "complete" || state.status === "residual").toBe(
          true,
        );
        if (previousResidual !== null)
          expect(state.residual).toBeLessThanOrEqual(previousResidual + 1e-12);
        if (previousRadiance !== null)
          for (let channel = 0; channel < 3; channel++)
            expect(state.radiance[channel]).toBeGreaterThanOrEqual(
              previousRadiance[channel] - 1e-12,
            );
        previousRadiance = state.radiance;
        previousResidual = state.residual;
      }
    }
  });

  it("gates acceptance on status, finiteness and the budget", () => {
    expect(dielectricSampleAccepted("complete", [1, 1, 1], 0)).toBe(true);
    expect(
      dielectricSampleAccepted("residual", [1, 1, 1], DIELECTRIC_ERROR_BUDGET),
    ).toBe(true);
    expect(
      dielectricSampleAccepted(
        "residual",
        [1, 1, 1],
        DIELECTRIC_ERROR_BUDGET + 2 ** -53,
      ),
    ).toBe(false);
    expect(dielectricSampleAccepted("unresolved", [1, 1, 1], 0)).toBe(false);
    expect(dielectricSampleAccepted("complete", [Number.NaN, 1, 1], 0)).toBe(
      false,
    );
    expect(
      dielectricSampleAccepted("complete", [1, 1, 1], Number.POSITIVE_INFINITY),
    ).toBe(false);
  });
});

describe("emitted optics source", () => {
  const sources = {
    glsl: dielectricOpticsSource("glsl"),
    wgsl: dielectricOpticsSource("wgsl"),
    js: dielectricOpticsSource("js"),
  };

  function emittedFunction(source: string, name: string): string {
    const match = source.match(
      new RegExp(
        `(?:fn |float |vec4 |vec4f |function )${name}\\(([\\s\\S]*?)\\n\\}`,
      ),
    );
    if (!match) throw new Error(`function ${name} not emitted`);
    return match[0];
  }

  function body(source: string, name: string): string {
    const text = emittedFunction(source, name);
    return text.slice(text.indexOf("{"));
  }

  it("executes bit-identically to the f64 oracle", () => {
    // The point of the js dialect is to EXECUTE the emitted text; the string
    // comes from this repo's own codegen, not input.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fresnel = new Function(
      `${sources.js}\nreturn dielectricFresnel;`,
    )() as (cosI: number, fromIor: number, toIor: number) => number;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const refract = new Function(
      `${sources.js}\nreturn dielectricRefract;`,
    )() as (
      ix: number,
      iy: number,
      iz: number,
      nx: number,
      ny: number,
      nz: number,
      fromIor: number,
      toIor: number,
    ) => { x: number; y: number; z: number; w: number };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const beer = new Function(
      `${sources.js}\nreturn dielectricBeerThroughput;`,
    )() as (absorption: number, distance: number, radius: number) => number;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const theta = new Function(
      `${sources.js}\nreturn dielectricReplayTheta;`,
    )() as (pass: number, initialTheta: number) => number;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const bound = new Function(
      `${sources.js}\nreturn dielectricBranchBound;`,
    )() as (r: number, g: number, b: number, radianceBound: number) => number;
    const iorPairs: [number, number][] = [
      [1, DIELECTRIC_IOR],
      [DIELECTRIC_IOR, 1],
      [1, 1],
      [1.5, 1.33],
    ];
    const sin50 = Math.sin((50 * Math.PI) / 180);
    const cos50 = Math.cos((50 * Math.PI) / 180);
    for (const [fromIor, toIor] of iorPairs)
      for (const cosI of [0, 0.1, 0.5, cos50, 0.9, 1])
        expect(fresnel(cosI, fromIor, toIor)).toBe(
          dielectricFresnel(cosI, fromIor, toIor),
        );
    const rays: [Vec3, Vec3][] = [
      [
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [
        [sin50, cos50, 0],
        [1, 0, 0],
      ],
      [
        [0.3, -0.9, 0.2],
        [0, 1, 0],
      ],
      [
        [0, 1, 0],
        [1, 0, 0],
      ],
      [
        [0.577, 0.577, 0.577],
        [-1, 0, 0],
      ],
    ];
    for (const [incident, normal] of rays)
      for (const [fromIor, toIor] of iorPairs) {
        const expected = dielectricRefract(incident, normal, fromIor, toIor);
        const actual = refract(
          incident[0],
          incident[1],
          incident[2],
          normal[0],
          normal[1],
          normal[2],
          fromIor,
          toIor,
        );
        expect(actual.x).toBe(expected.direction[0]);
        expect(actual.y).toBe(expected.direction[1]);
        expect(actual.z).toBe(expected.direction[2]);
        expect(actual.w).toBe(expected.tir ? 1 : 0);
      }
    for (const absorption of [0, 0.17, 0.5])
      for (const distance of [0, 0.5, 2])
        for (const radius of [0.75, 1])
          expect(beer(absorption, distance, radius)).toBe(
            dielectricBeerThroughput(absorption, distance, radius),
          );
    for (const pass of [0, 1, 2, 5])
      for (const initialTheta of [DIELECTRIC_INITIAL_BRANCH_THETA, 0.5])
        expect(theta(pass, initialTheta)).toBe(
          dielectricReplayTheta(pass, initialTheta),
        );
    for (const radianceBound of [1, 4])
      for (const throughput of [
        [1, 1, 1],
        [0.3, 0.9, 0.5],
        [0.001, 0.002, 0.0015],
      ] as Vec3[])
        expect(
          bound(throughput[0], throughput[1], throughput[2], radianceBound),
        ).toBe(dielectricBranchBound(throughput, radianceBound));
  });

  it("emits one shared body for GLSL and WGSL", () => {
    for (const name of [
      "dielectricFresnel",
      "dielectricRefract",
      "dielectricBeerThroughput",
      "dielectricReplayTheta",
      "dielectricBranchBound",
    ]) {
      const normalize = (text: string) =>
        text
          .replace(/\b(?:float|let|const) /g, "")
          .replace(/\bvec4\(/g, "vec4f(")
          .replace(/\s+/g, " ");
      expect(normalize(body(sources.glsl, name))).toBe(
        normalize(body(sources.wgsl, name)),
      );
    }
  });

  it("emits exact per-dialect signatures", () => {
    expect(sources.glsl).toContain(
      "vec4 dielectricRefract(float ix, float iy, float iz, float nx, float ny, float nz, float fromIor, float toIor)",
    );
    expect(sources.glsl).toContain(
      "float dielectricFresnel(float cosI, float fromIor, float toIor)",
    );
    expect(sources.wgsl).toContain(
      "fn dielectricFresnel(cosI: f32, fromIor: f32, toIor: f32) -> f32",
    );
    expect(sources.wgsl).toContain(
      "fn dielectricRefract(ix: f32, iy: f32, iz: f32, nx: f32, ny: f32, nz: f32, fromIor: f32, toIor: f32) -> vec4f",
    );
    expect(sources.js).toContain(
      "function dielectricRefract(ix, iy, iz, nx, ny, nz, fromIor, toIor)",
    );
  });

  it("keeps dialect-exclusive syntax out of the wrong dialect", () => {
    expect(sources.glsl).not.toContain("Math.");
    expect(sources.wgsl).not.toContain("Math.");
    expect(sources.wgsl).not.toContain("?");
    expect(sources.js).not.toContain("mix(");
    expect(sources.js).not.toContain("vec4f(");
  });
});
