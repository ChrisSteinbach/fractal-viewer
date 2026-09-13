/** Scalar controls for the exact finite dielectric-cell boundary oracle. */
import { mkdirSync, writeFileSync } from "node:fs";
import { mengerSponge } from "../src/fractal/presets";
import type { Vec3 } from "./de-preview";
import { boxUnionIntervals, type OpticalInterval } from "./transmission-proxy";
import {
  DIELECTRIC_HYPER_ROTATION,
  DIELECTRIC_GEOMETRY_CONTROL_RAYS,
  DIELECTRIC_SOLID_FIXTURES,
  DIELECTRIC_TRANSPORT_CONTROL_INPUTS,
  dielectricBeerThroughput,
  dielectricContains,
  dielectricDisplayedRootYBounds,
  dielectricIntrinsicDirection,
  dielectricIntrinsicPoint,
  dielectricNextBoundary,
  dielectricNextBoundaryFromAnchor,
  dielectricRaySideOccupancy,
  dielectricRefract,
  dielectricTerminalCells,
  packDielectricSolidFixture,
  type DielectricBoundaryAnchor,
  type DielectricFace,
  type DielectricSolidFixture,
} from "./transmission-dielectric-solid";

interface RayIntervals {
  intervals: OpticalInterval[];
  visits: number;
  boundaries: number;
}

function ddaIntervals(
  fixture: DielectricSolidFixture,
  origin: Vec3,
  direction: Vec3,
  initiallyInside = false,
): RayIntervals {
  let tMin = 0;
  let travelBase = 0;
  let inside = initiallyInside;
  let previousFace: DielectricFace | undefined;
  let anchor: DielectricBoundaryAnchor | undefined;
  let pendingEnter = initiallyInside ? 0 : null;
  let visits = 0;
  let boundaries = 0;
  const intervals: OpticalInterval[] = [];
  for (let event = 0; event < 128; event++) {
    const result = anchor
      ? dielectricNextBoundaryFromAnchor(fixture, direction, { inside, anchor })
      : dielectricNextBoundary(fixture, origin, direction, {
          inside,
          tMin,
          previousFace,
        });
    visits += result.visits;
    if (result.kind === "refused")
      throw new Error(
        `DDA refused ${result.reason} after ${boundaries} boundaries: ${JSON.stringify({ tMin, inside, previousFace, origin, direction })}`,
      );
    if (result.kind === "miss") {
      expect(inside).toBe(false);
      return { intervals, visits, boundaries };
    }
    boundaries++;
    const absoluteT = travelBase + result.t;
    if (result.entering) {
      expect(inside).toBe(false);
      pendingEnter = absoluteT;
    } else {
      expect(inside).toBe(true);
      expect(pendingEnter).not.toBeNull();
      intervals.push({ enter: pendingEnter!, exit: absoluteT });
      pendingEnter = null;
    }
    inside = result.entering;
    travelBase = absoluteT;
    tMin = 0;
    previousFace = result.face;
    anchor = result.anchor;
  }
  throw new Error("DDA boundary event cap reached");
}

function exhaustiveIntervals(
  fixture: DielectricSolidFixture,
  origin: Vec3,
  direction: Vec3,
) {
  const cells = dielectricTerminalCells(fixture);
  return boxUnionIntervals(
    cells.map((cell) => ({ center: cell.center, half: cell.half })),
    dielectricIntrinsicPoint(fixture, origin),
    dielectricIntrinsicDirection(fixture, direction),
  );
}

/**
 * `boxUnionIntervals` reconstructs a shared ternary plane independently as
 * center +/- half for each box. Non-binary thirds can differ by one f64 ulp
 * and create a false gap. Normalize only that exhaustive reference here; the
 * integer-topology DDA itself has no gap tolerance.
 */
function coalesceBoxRoundoff(intervals: readonly OpticalInterval[]) {
  const merged: OpticalInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    const scale = Math.max(
      1,
      Math.abs(interval.enter),
      Math.abs(previous?.exit ?? 0),
    );
    if (
      previous &&
      interval.enter - previous.exit <= 8 * Number.EPSILON * scale
    )
      previous.exit = Math.max(previous.exit, interval.exit);
    else merged.push({ ...interval });
  }
  return merged;
}

function expectIntervalsEqual(
  actual: readonly OpticalInterval[],
  expected: readonly OpticalInterval[],
) {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index].enter).toBeCloseTo(expected[index].enter, 11);
    expect(actual[index].exit).toBeCloseTo(expected[index].exit, 11);
  }
}

function presetMengerCells(depth: number) {
  let cells = [{ center: [0, 0, 0], half: 0.75 }];
  for (let level = 0; level < depth; level++)
    cells = mengerSponge().flatMap((map) =>
      cells.map((cell) => ({
        center: cell.center.map(
          (value, axis) => value / 3 + map.position[axis],
        ),
        half: cell.half / 3,
      })),
    );
  return cells;
}

function sortedCellKeys(
  cells: readonly { center: readonly number[]; half: number }[],
) {
  return cells
    .map(
      (cell) =>
        `${cell.center.map((value) => value.toFixed(12)).join(",")}|${cell.half.toFixed(12)}`,
    )
    .sort();
}

function adjacentF32(value: number, upward: boolean) {
  const buffer = new ArrayBuffer(4);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32[0] = Math.fround(value);
  if (f32[0] === 0) {
    u32[0] = upward ? 1 : 0x80000001;
    return f32[0];
  }
  u32[0] += f32[0] > 0 === upward ? 1 : -1;
  return f32[0];
}

describe("connected finite dielectric solids", () => {
  it("matches the actual Menger preset and fixes the selected 3D/4D construction", () => {
    const countRows = [
      [DIELECTRIC_SOLID_FIXTURES.mengerD0, 1],
      [DIELECTRIC_SOLID_FIXTURES.mengerD2, 20 ** 2],
      [DIELECTRIC_SOLID_FIXTURES.mengerD3, 20 ** 3],
      [DIELECTRIC_SOLID_FIXTURES.hyperMengerD0, 1],
      [DIELECTRIC_SOLID_FIXTURES.hyperMengerD2, 48 ** 2],
      [DIELECTRIC_SOLID_FIXTURES.hyperMengerD3, 48 ** 3],
    ] as const;
    for (const [fixture, expected] of countRows)
      expect(dielectricTerminalCells(fixture)).toHaveLength(expected);

    for (const depth of [0, 2, 3] as const) {
      const fixture =
        depth === 0
          ? DIELECTRIC_SOLID_FIXTURES.mengerD0
          : depth === 2
            ? DIELECTRIC_SOLID_FIXTURES.mengerD2
            : DIELECTRIC_SOLID_FIXTURES.mengerD3;
      expect(sortedCellKeys(dielectricTerminalCells(fixture))).toEqual(
        sortedCellKeys(presetMengerCells(depth)),
      );
    }

    const fixture4 = DIELECTRIC_SOLID_FIXTURES.hyperMengerD3;
    expect(DIELECTRIC_HYPER_ROTATION.xw).not.toBe(0);
    expect(DIELECTRIC_HYPER_ROTATION.yw).not.toBe(0);
    expect(fixture4.slice).not.toBe(0);
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 4; column++) {
        const dot = fixture4.rotorRows[row].reduce(
          (sum, value, axis) => sum + value * fixture4.rotorRows[column][axis],
          0,
        );
        expect(dot).toBeCloseTo(row === column ? 1 : 0, 6);
      }
    const packed = packDielectricSolidFixture(fixture4);
    expect(packed.byteLength).toBe(96);
    expect([...new Uint32Array(packed).slice(0, 4)]).toEqual([4, 3, 27, 105]);
  });

  it("agrees with exhaustive D2 box unions in both dimensions", () => {
    const rayRows: object[] = [];
    const rays3: [Vec3, Vec3][] = [
      [
        [2, 0.6, 0.6],
        [-1, 0, 0],
      ],
      [
        [2, 0, 0.6],
        [-1, 0, 0],
      ],
      [
        [0.37, -0.29, 2],
        [0.07, 0.03, -1],
      ],
    ];
    for (const [origin, direction] of rays3) {
      const fixture = DIELECTRIC_SOLID_FIXTURES.mengerD2;
      const rawExact = exhaustiveIntervals(fixture, origin, direction);
      const exact = coalesceBoxRoundoff(rawExact);
      const dda = ddaIntervals(fixture, origin, direction);
      expectIntervalsEqual(dda.intervals, exact);
      rayRows.push({
        fixture: fixture.name,
        origin,
        direction,
        rawExact,
        normalizedExact: exact,
        ...dda,
      });
    }

    const fixture4 = DIELECTRIC_SOLID_FIXTURES.hyperMengerD2;
    for (const x of [-0.54, -0.18, 0.18, 0.54])
      for (const y of [-0.42, 0, 0.42]) {
        const origin: Vec3 = [x, y, 2];
        const direction: Vec3 = [0.04, -0.025, -1];
        const rawExact = exhaustiveIntervals(fixture4, origin, direction);
        const exact = coalesceBoxRoundoff(rawExact);
        const dda = ddaIntervals(fixture4, origin, direction);
        expectIntervalsEqual(dda.intervals, exact);
        rayRows.push({
          fixture: fixture4.name,
          origin,
          direction,
          rawExact,
          normalizedExact: exact,
          ...dda,
        });
      }

    expect(
      rayRows.some(
        (row) => (row as { intervals: unknown[] }).intervals.length > 1,
      ),
    ).toBe(true);
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-dielectric-solid-rays.json",
      JSON.stringify(rayRows, null, 2),
    );
  });

  it("keeps touching cells internal, positive gaps open, and ray sides explicit", () => {
    const fixture = DIELECTRIC_SOLID_FIXTURES.mengerD2;
    const rawSolidLine = exhaustiveIntervals(
      fixture,
      [2, 0.6, 0.6],
      [-1, 0, 0],
    );
    const solidLine = coalesceBoxRoundoff(rawSolidLine);
    expect(rawSolidLine.length).toBeGreaterThan(1);
    expect(solidLine).toHaveLength(1);
    expect(solidLine[0].exit - solidLine[0].enter).toBeCloseTo(1.5, 12);
    const ddaSolid = ddaIntervals(fixture, [2, 0.6, 0.6], [-1, 0, 0]);
    expect(ddaSolid.boundaries).toBe(2);

    const gapLine = coalesceBoxRoundoff(
      exhaustiveIntervals(fixture, [2, 0, 0.6], [-1, 0, 0]),
    );
    expect(gapLine).toHaveLength(4);
    for (let index = 1; index < gapLine.length; index++)
      expect(gapLine[index].enter - gapLine[index - 1].exit).toBeGreaterThan(0);
    expectIntervalsEqual(
      ddaIntervals(fixture, [2, 0, 0.6], [-1, 0, 0]).intervals,
      gapLine,
    );

    const sharedBoundary: Vec3 = [-0.25, 0, 0.6];
    expect(dielectricContains(fixture, sharedBoundary)).toBe(true);
    expect(dielectricRaySideOccupancy(fixture, sharedBoundary, [1, 0, 0])).toBe(
      false,
    );
    expect(
      dielectricRaySideOccupancy(fixture, sharedBoundary, [-1, 0, 0]),
    ).toBe(true);
  });

  it("handles inside rays, projected 4D normals, exact corner ties, and refusal", () => {
    const fixture = DIELECTRIC_SOLID_FIXTURES.mengerD2;
    const inside = ddaIntervals(fixture, [0, 0.6, 0.6], [1, 0, 0], true);
    expect(inside.intervals).toEqual([{ enter: 0, exit: 0.75 }]);

    const corner = dielectricNextBoundary(
      DIELECTRIC_SOLID_FIXTURES.mengerD0,
      [-2, -2, 0],
      [1, 1, 0],
      { inside: false },
    );
    expect(corner.kind).toBe("boundary");
    if (corner.kind === "boundary") {
      expect(corner.intrinsicAxis).toBe(0);
      expect(corner.face.planeIndex).toBe(0);
      expect(corner.outwardNormal[0]).toBe(-1);
      expect(Math.abs(corner.outwardNormal[1])).toBe(0);
      expect(Math.abs(corner.outwardNormal[2])).toBe(0);
    }

    const fixture4 = DIELECTRIC_SOLID_FIXTURES.hyperMengerD0;
    const event4 = dielectricNextBoundary(
      fixture4,
      [3, 0.11, -0.07],
      [-1, 0, 0],
      {
        inside: false,
      },
    );
    expect(event4.kind).toBe("boundary");
    if (event4.kind === "boundary") {
      expect(Math.hypot(...event4.outwardNormal)).toBeCloseTo(1, 12);
      const row = fixture4.rotorRows[event4.intrinsicAxis];
      const projected = row.slice(0, 3);
      const alignment = Math.abs(
        event4.outwardNormal.reduce(
          (sum, value, axis) => sum + value * projected[axis],
          0,
        ),
      );
      expect(alignment).toBeCloseTo(Math.hypot(...projected), 12);
    }

    const refusedFixture: DielectricSolidFixture = { ...fixture, visitCap: 1 };
    const refused = dielectricNextBoundary(
      refusedFixture,
      [2, 0, 0],
      [-1, 0, 0],
      {
        inside: false,
      },
    );
    expect(refused).toMatchObject({ kind: "refused", reason: "visit-cap" });
  });

  it("uses canonical anchors across f32 world-hit perturbations", () => {
    const rows = [
      {
        fixture: DIELECTRIC_SOLID_FIXTURES.mengerD0,
        origin: [0.17, 0.11, 2] as Vec3,
      },
      {
        fixture: DIELECTRIC_SOLID_FIXTURES.hyperMengerD0,
        origin: [0.12, -0.08, 2] as Vec3,
      },
    ];
    for (const { fixture, origin } of rows) {
      const direction: Vec3 = [0, 0, -1];
      const entry = dielectricNextBoundary(fixture, origin, direction, {
        inside: false,
      });
      expect(entry.kind).toBe("boundary");
      if (entry.kind !== "boundary") continue;
      expect(entry.entering).toBe(true);
      const roundedHit = origin.map((value, axis) =>
        Math.fround(value + entry.t * direction[axis]),
      ) as Vec3;
      const perturbedHits = [roundedHit];
      for (let axis = 0; axis < 3; axis++)
        for (const upward of [false, true]) {
          const point = [...roundedHit] as Vec3;
          point[axis] = adjacentF32(point[axis], upward);
          perturbedHits.push(point);
        }
      let referenceExit: number | undefined;
      for (const ignoredWorldHit of perturbedHits) {
        // No world point is accepted by the anchored API; the loop makes the
        // +/-1-ULP alternatives explicit and verifies they cannot affect it.
        expect(ignoredWorldHit.every(Number.isFinite)).toBe(true);
        const exit = dielectricNextBoundaryFromAnchor(fixture, direction, {
          inside: true,
          anchor: entry.anchor,
        });
        expect(exit.kind).toBe("boundary");
        if (exit.kind !== "boundary") continue;
        expect(exit.entering).toBe(false);
        referenceExit ??= exit.t;
        expect(exit.t).toBe(referenceExit);
        expect(
          dielectricNextBoundaryFromAnchor(fixture, direction, {
            inside: false,
            anchor: exit.anchor,
          }),
        ).toMatchObject({ kind: "miss" });
      }
    }

    const entry = dielectricNextBoundary(
      DIELECTRIC_SOLID_FIXTURES.mengerD0,
      [0, 0, 2],
      [0, 0, -1],
      { inside: false },
    );
    expect(entry.kind).toBe("boundary");
    if (entry.kind === "boundary") {
      expect(
        dielectricNextBoundaryFromAnchor(
          DIELECTRIC_SOLID_FIXTURES.mengerD0,
          [0, 0, -1],
          { inside: false, anchor: entry.anchor },
        ),
      ).toMatchObject({ kind: "refused", reason: "state-mismatch" });
      expect(
        dielectricNextBoundaryFromAnchor(
          DIELECTRIC_SOLID_FIXTURES.mengerD0,
          [1, 0, 0],
          { inside: true, anchor: entry.anchor },
        ),
      ).toMatchObject({ kind: "refused", reason: "ambiguous-anchor" });
      const stale = {
        ...entry.anchor,
        planeMask: 0,
      };
      expect(
        dielectricNextBoundaryFromAnchor(
          DIELECTRIC_SOLID_FIXTURES.mengerD0,
          [0, 0, -1],
          { inside: true, anchor: stale },
        ),
      ).toMatchObject({ kind: "refused", reason: "invalid-input" });
      const outOfRange = {
        ...entry.anchor,
        planeIndices: [...entry.anchor.planeIndices] as [
          number,
          number,
          number,
          number,
        ],
      };
      outOfRange.planeIndices[entry.intrinsicAxis] = 28;
      expect(
        dielectricNextBoundaryFromAnchor(
          DIELECTRIC_SOLID_FIXTURES.mengerD0,
          [0, 0, -1],
          { inside: true, anchor: outOfRange },
        ),
      ).toMatchObject({ kind: "refused", reason: "invalid-input" });

      const notZero = dielectricNextBoundary(
        DIELECTRIC_SOLID_FIXTURES.mengerD0,
        [0, 0, 2],
        [0, 0, -1],
        {
          inside: false,
          tMin: entry.t - 1e-6,
          previousFace: entry.face,
        },
      );
      expect(notZero).toMatchObject({
        kind: "boundary",
        entering: true,
        t: entry.t,
      });
    }
  });

  it("retains unmasked cell topology and exact declared root endpoints", () => {
    const fixture = DIELECTRIC_SOLID_FIXTURES.mengerD2;
    const gridSize = 3 ** fixture.depth;
    const width = (2 * fixture.halfExtent) / gridSize;
    const anchor: DielectricBoundaryAnchor = {
      intrinsicPoint: [
        -fixture.halfExtent + 8 * width,
        0.455658555,
        fixture.halfExtent,
        0,
      ],
      planeMask: 1 << 2,
      planeIndices: [-1, -1, gridSize, -1],
      // x-cell 8 is the incident traversal's topology even though the
      // reconstructed x coordinate is exactly its lower plane.
      cellIndices: [8, 7, gridSize, -1],
    };
    const continuation = dielectricNextBoundaryFromAnchor(
      fixture,
      [-0.4127580225, -0.7735493183, -0.4808869064],
      { inside: true, anchor },
    );
    expect(continuation).toMatchObject({
      kind: "boundary",
      entering: false,
      intrinsicAxis: 0,
    });
    if (continuation.kind === "boundary") {
      expect(Math.abs(continuation.t)).toBe(0);
      expect(continuation.anchor.intrinsicPoint[0]).toBe(
        -fixture.halfExtent + 8 * width,
      );
      expect(continuation.anchor.cellIndices).toEqual([7, 7, 8, -1]);
    }

    const rootEntry = dielectricNextBoundary(
      fixture,
      [0.6, 0.6, 2],
      [0, 0, -1],
      { inside: false },
    );
    expect(rootEntry.kind).toBe("boundary");
    if (rootEntry.kind === "boundary") {
      expect(rootEntry.anchor.intrinsicPoint[2]).toBe(fixture.halfExtent);
      expect(rootEntry.anchor.planeIndices[2]).toBe(gridSize);
    }
  });

  it("pins independent Snell, TIR, identity, and Beer controls", () => {
    const angle30 = Math.PI / 6;
    const incidentAir: Vec3 = [Math.sin(angle30), 0, -Math.cos(angle30)];
    const normal: Vec3 = [0, 0, 1];
    const identity = dielectricRefract(incidentAir, normal, 1, 1);
    expect(identity.tir).toBe(false);
    expect(identity.direction).toEqual(incidentAir);

    const entry = dielectricRefract(incidentAir, normal, 1, 1.5);
    expect(entry.tir).toBe(false);
    expect(entry.direction[0]).toBeCloseTo(1 / 3, 12);
    const exit = dielectricRefract(
      [Math.sin(angle30), 0, Math.cos(angle30)],
      normal,
      1.5,
      1,
    );
    expect(exit.tir).toBe(false);
    expect(exit.direction[0]).toBeCloseTo(0.75, 12);

    const angle50 = (50 * Math.PI) / 180;
    const tir = dielectricRefract(
      [Math.sin(angle50), 0, Math.cos(angle50)],
      normal,
      1.5,
      1,
    );
    expect(tir.tir).toBe(true);
    expect(tir.direction[2]).toBeCloseTo(-Math.cos(angle50), 12);
    expect(dielectricBeerThroughput(0.8, 0.5, 1.5)).toBeCloseTo(
      Math.exp((-0.8 * 0.5) / 1.5),
      14,
    );

    const bounds = dielectricDisplayedRootYBounds(
      DIELECTRIC_SOLID_FIXTURES.hyperMengerD3,
    );
    expect(bounds.minimum).toBeCloseTo(-0.8451981338033744, 12);
    expect(bounds.minimum).toBeGreaterThan(-0.95);
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-dielectric-solid-report.json",
      JSON.stringify(
        {
          status: "SCALAR ORACLE QUALIFIED; IMAGE UNREVIEWED",
          geometry: {
            menger3d: {
              rule: "at most one middle ternary digit per level",
              halfExtent: 0.75,
              mainDepth: 3,
              terminalCells: 20 ** 3,
              visitCap: DIELECTRIC_SOLID_FIXTURES.mengerD3.visitCap,
              actualPresetParityDepths: [0, 2, 3],
            },
            hyperMenger4d: {
              rule: "at most one middle ternary digit per level",
              newGeometry: true,
              halfExtent: 0.75,
              mainDepth: 3,
              terminalCells: 48 ** 3,
              visitCap: DIELECTRIC_SOLID_FIXTURES.hyperMengerD3.visitCap,
              rotorRows: DIELECTRIC_SOLID_FIXTURES.hyperMengerD3.rotorRows,
              slice: DIELECTRIC_SOLID_FIXTURES.hyperMengerD3.slice,
              displayedRootYBounds: bounds,
              floorY: -0.95,
              floorClearance: bounds.minimum - -0.95,
            },
          },
          boundaryPolicy: {
            occupancy: "integer terminal-cell digits",
            ties: "exact numeric crossing equality; advance all tied axes",
            cornerNormal:
              "largest absolute intrinsic ray component, then lowest axis",
            continuation:
              "canonical intrinsic anchor with crossed-axis mask and integer planes",
            tangentAnchor: "explicit ambiguous-anchor refusal",
            visitCap: "explicit visit-cap refusal",
            closedMembership:
              "either adjacent retained cell owns an exact grid-plane point",
            rayMembership: "direction-selected half-open cell",
          },
          precisionLimit:
            "CPU f64 and GPU f32 can order near-corner crossings differently; no proximity tie or gap merge is used. The exhaustive box oracle needs report-only ULP coalescing because center +/- half reconstructs non-binary shared planes independently.",
          controls: {
            geometryRays: DIELECTRIC_GEOMETRY_CONTROL_RAYS,
            transportInputs: DIELECTRIC_TRANSPORT_CONTROL_INPUTS,
            exhaustiveDepth: 2,
            anchoredWorldHitPerturbations: "f32 and +/-1 ULP in xyz",
            snellEntrySin: entry.direction[0],
            snellExitSin: exit.direction[0],
            tir50Degrees: tir.tir,
            beer: dielectricBeerThroughput(0.8, 0.5, 1.5),
          },
        },
        null,
        2,
      ),
    );
  });
});
