/**
 * Actual world-ray comparison for a bounded virtual-slab lateral mapping.
 * The mapping is an artistic zero-thickness interface, not bulk refraction.
 * Every downstream sample and terminal floor query uses the displaced origin.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *   scripts/transmission-bend.harness.ts --disableConsoleIntercept
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import {
  renderBentTransmission,
  virtualSlabLateralDelta,
} from "./transmission-bend-study";
import type {
  BendFixture,
  BendMaterial,
  BendOptions,
  BendPanel,
} from "./transmission-bend-study";
import { fixtures } from "./transmission-study";

const OUT = "scripts/out";
const CONTROL_SIZE = Number(process.env.TRANSMISSION_BEND_CONTROL_SIZE ?? 33);
const MENGER_SIZE = Number(process.env.TRANSMISSION_BEND_MENGER_SIZE ?? 32);
const NATIVE4_SIZE = Number(process.env.TRANSMISSION_BEND_4D_SIZE ?? 48);
const MOTION3_SIZE = Number(process.env.TRANSMISSION_BEND_MOTION3_SIZE ?? 20);
const MOTION4_SIZE = Number(process.env.TRANSMISSION_BEND_MOTION4_SIZE ?? 24);
const BASE: BendOptions = {
  transmit: 0.9,
  ior: 1.45,
  slabFraction: 0.08,
  maxOffsetFraction: 0.08,
  opticalNormalFraction: 0.04,
  maxLayers: 128,
  chunkSteps: 1200,
  maxSamples: 4096,
  residualTolerance: 0,
};

interface Surface {
  label: string;
  color: Vec3;
  distance: (p: Vec3) => number;
  opaque?: boolean;
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
const normalized = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length) as Vec3;
};
const sphere = (center: Vec3, radius: number) => (p: Vec3) =>
  Math.abs(Math.hypot(...p.map((v, i) => v - center[i])) - radius);

function fromSurfaces(
  name: string,
  surfaces: Surface[],
  radius = 1.25,
): BendFixture {
  const nearest = (p: Vec3): [Surface, number] => {
    let selected = surfaces[0];
    let distance = selected.distance(p);
    for (const candidate of surfaces.slice(1)) {
      const d = candidate.distance(p);
      if (d < distance) [selected, distance] = [candidate, d];
    }
    return [selected, distance];
  };
  return {
    name,
    scene: {
      de: (p) => nearest(p)[1],
      boundingRadius: radius,
      stepScale: 1,
      eye: [0, 0, 3],
      target: [0, 0, 0],
      zoom: 0.3,
    },
    material(p): BendMaterial {
      const selected = nearest(p)[0];
      return {
        label: selected.label,
        color: selected.color,
        opaque: selected.opaque,
      };
    },
  };
}

function analyticFixture(rear: boolean): BendFixture {
  const surfaces: Surface[] = [
    {
      label: "front",
      color: [0.1, 0.78, 0.96],
      distance: sphere([-0.08, 0, 0.42], 0.48),
    },
  ];
  if (rear)
    surfaces.push({
      label: "rear",
      color: [1, 0.12, 0.035],
      distance: sphere([0.26, 0, -0.42], 0.17),
      opaque: true,
    });
  return fromSurfaces(`ANALYTIC REAR ${rear}`, surfaces);
}

function native4HypersphereFixture(rear: boolean): BendFixture {
  const angle = 0.37;
  const w0 = 0.23;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sliceNormal = [-s, 0, 0, c] as const;
  const q4 = (p: Vec3): [number, number, number, number] => [
    c * p[0] - s * w0,
    p[1],
    p[2],
    s * p[0] + c * w0,
  ];
  const hypersphere = (center3: Vec3, radius3: number, offset4: number) => {
    const displayedCenter = q4(center3);
    const center4 = displayedCenter.map(
      (value, axis) => value + offset4 * sliceNormal[axis],
    );
    const radius4 = Math.hypot(radius3, offset4);
    return (p: Vec3) =>
      Math.abs(
        Math.hypot(...q4(p).map((value, axis) => value - center4[axis])) -
          radius4,
      );
  };
  const surfaces: Surface[] = [
    {
      label: "front",
      color: [0.1, 0.78, 0.96],
      distance: hypersphere([-0.08, 0, 0.42], 0.48, 0.2),
    },
  ];
  if (rear)
    surfaces.push({
      label: "rear",
      color: [1, 0.12, 0.035],
      distance: hypersphere([0.26, 0, -0.42], 0.17, 0.05),
      opaque: true,
    });
  return fromSurfaces(`POSED 4D HYPERSPHERE REAR ${rear}`, surfaces);
}

/** A .005R downstream guard lies inside the virtual .08R slab thickness. */
function closeGuardFixture(
  native4 = false,
  parallelGuard = false,
  opaqueOracle = true,
): BendFixture {
  const R = 1;
  const frontZ = 0.4;
  const guardZ = frontZ - 0.005 * R;
  const angle = 0.37;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const w0 = 0.23;
  const n4 = normalized([0.34, -0.11, 0.934]);
  const q4 = (p: Vec3): [number, number, number, number] => [
    c * p[0] - s * w0,
    p[1],
    p[2],
    s * p[0] + c * w0,
  ];
  const plane4 = (z: number) => {
    const at = q4([0, 0, z]);
    const n: [number, number, number, number] = [n4[0], n4[1], n4[2], 0.27];
    const constant = dot(n, at);
    const scale = Math.hypot(n[0] * c + n[3] * s, n[1], n[2]);
    return (p: Vec3) => Math.abs(dot(n, q4(p)) - constant) / scale;
  };
  const plane3 = (z: number) => {
    const constant = dot(n4, [0, 0, z]);
    return (p: Vec3) => Math.abs(dot(n4, p) - constant);
  };
  const surfaces: Surface[] = [
    {
      label: "front",
      color: [0.1, 0.78, 0.96],
      distance: native4 ? plane4(frontZ) : plane3(frontZ),
    },
    {
      label: "guard",
      color: [0.95, 0.82, 0.12],
      // The required skip oracle is perpendicular to the known centre ray:
      // a tangent displacement for the tilted front can move backward or
      // sideways, but cannot leap across this downstream z plane. The optional
      // parallel form records that finite-difference normals can cross a close
      // tilted surface even though no forward jump occurred.
      distance: parallelGuard
        ? native4
          ? plane4(guardZ)
          : plane3(guardZ)
        : (p) => Math.abs(p[2] - guardZ),
      opaque: true,
    },
  ];
  const fixture = fromSurfaces(
    `${native4 ? "POSED 4D SLICE" : "TILTED 3D"} CLOSE ${parallelGuard ? "PARALLEL " : ""}GUARD`,
    surfaces,
    R,
  );
  if (!parallelGuard && opaqueOracle)
    fixture.opaqueStop = (p) =>
      Math.abs(p[2] - guardZ) <= 0.00055 * R
        ? { label: "guard", color: [0.95, 0.82, 0.12], opaque: true }
        : null;
  return fixture;
}

function nearBoundaryFixture(): BendFixture {
  const n = normalized([0.7, 0.08, 0.71]);
  const z = 0.995;
  const constant = dot(n, [0, 0, z]);
  return fromSurfaces(
    "NEAR-BOUNDARY TILTED FRONT",
    [
      {
        label: "front",
        color: [0.1, 0.78, 0.96],
        distance: (p) => Math.abs(dot(n, p) - constant),
      },
    ],
    1,
  );
}

function proceduralFloor(R: number) {
  const floorY = -1.05 * R;
  return (origin: Vec3, rd: Vec3): Vec3 => {
    if (rd[1] < -1e-8) {
      const t = (floorY - origin[1]) / rd[1];
      if (t > 0) {
        const x = origin[0] + rd[0] * t;
        const z = origin[2] + rd[2] * t;
        const checker =
          (Math.floor(x / (0.18 * R)) + Math.floor(z / (0.18 * R))) & 1;
        return checker ? [0.7, 0.17, 0.05] : [0.035, 0.32, 0.7];
      }
    }
    return [0.025, 0.035, 0.055];
  };
}

function run(
  fixture: BendFixture,
  size: number,
  bendOnset: "none" | "weighted" | "hard",
  options: BendOptions = {},
): BendPanel {
  return renderBentTransmission(fixture, size, {
    ...BASE,
    terminalRadiance: proceduralFloor(fixture.scene.boundingRadius),
    ...options,
    bendOnset,
  });
}

function meanDelta(a: PanelStats, b: PanelStats): number {
  return (
    a.rgb.reduce((sum, value, i) => sum + Math.abs(value - b.rgb[i]), 0) /
    a.rgb.length
  );
}

function disoccluded(bent: BendPanel, straight: BendPanel): number {
  return bent.rearMask.reduce(
    (count, value, i) =>
      count + Number(value > 0 && straight.rearMask[i] === 0),
    0,
  );
}

function summary(label: string, result: BendPanel) {
  return {
    label,
    size: result.stats.width,
    hits: result.stats.hits,
    calls: result.calls,
    unresolved: result.unresolved,
    rearHits: result.rearHits,
    frontThenGuard: result.frontThenGuard,
    work: result.work,
    termination: result.termination,
    bending: result.bending,
    sampling: result.sampling,
    totalVariation: result.variation.reduce((sum, value) => sum + value, 0),
    totalEvents: result.eventCounts.reduce((sum, value) => sum + value, 0),
  };
}

function exactTrace(result: BendPanel) {
  return {
    rgb: [...result.stats.rgb],
    rear: [...result.rearMask],
    guard: [...result.frontThenGuardMask],
    events: [...result.eventCounts],
    variation: [...result.variation],
    throughput: [...result.throughput],
    samples: [...result.sampleCounts],
    attribution: result.attributionCounts,
    termination: result.termination,
  };
}

function fractalFixture(
  name: "MENGER 3D" | "MANDELBOX 4D",
  pose: Parameters<typeof fixtures>[0],
): BendFixture {
  const source = fixtures(pose).find((fixture) => fixture.name === name)!;
  return {
    name,
    scene: source.scene,
    material: (p) => ({ label: "fractal", color: source.color(p) }),
  };
}

describe("world-space virtual-slab continuation", () => {
  it("keeps the slab mapping tangent and smoothly bounded at all incidences", () => {
    const n: Vec3 = normalized([0.31, -0.17, 0.935]);
    const grazing = normalized([n[1], -n[0], 0]);
    const nearGrazing = normalized(
      grazing.map((value, axis) => value - 1e-12 * n[axis]) as Vec3,
    );
    const cases: Vec3[] = [normalized([0.1, 0.05, -1]), nearGrazing, grazing];
    for (const rd of cases) {
      for (const fraction of [0.04, 0.08, 0.12]) {
        const result = virtualSlabLateralDelta(rd, n, 1.45, 0.08, fraction);
        expect(Math.abs(dot(result.delta, n))).toBeLessThan(1e-12);
        expect(dot(result.delta, rd)).toBeLessThanOrEqual(1e-12);
        expect(Math.hypot(...result.delta)).toBeLessThanOrEqual(
          fraction + 1e-15,
        );
      }
    }
    expect(virtualSlabLateralDelta([0, 0, -1], n, 1, 0.08, 0.08).delta).toEqual(
      [0, 0, 0],
    );
    expect(
      virtualSlabLateralDelta([0, 0, -1], [0, 0, 0], 1.45, 0.08, 0.08).delta,
    ).toEqual([0, 0, 0]);
  });

  it("queries disoccluded geometry, preserves a close guard, and resumes exactly", () => {
    const absent = run(analyticFixture(false), CONTROL_SIZE, "weighted");
    const fixture = analyticFixture(true);
    const straight = run(fixture, CONTROL_SIZE, "none");
    const weighted = run(fixture, CONTROL_SIZE, "weighted");
    const hard = run(fixture, CONTROL_SIZE, "hard");
    const offsetRange = [
      [
        0.04,
        run(fixture, CONTROL_SIZE, "weighted", { maxOffsetFraction: 0.04 }),
      ],
      [0.08, weighted],
      [
        0.12,
        run(fixture, CONTROL_SIZE, "weighted", { maxOffsetFraction: 0.12 }),
      ],
    ] as const;
    const zeroSlab = run(fixture, CONTROL_SIZE, "weighted", {
      slabFraction: 0,
    });
    const opaque = run(fixture, CONTROL_SIZE, "weighted", {
      transmit: 0,
      terminalRadiance: () => [0, 0, 0],
    });
    const opaqueBrightTerminal = run(fixture, CONTROL_SIZE, "weighted", {
      transmit: 0,
      terminalRadiance: () => [1, 0, 1],
    });
    const guard3 = run(closeGuardFixture(false), 1, "hard");
    const guard4 = run(closeGuardFixture(true), 1, "hard");
    const ordinaryPerpendicularGuard = run(
      closeGuardFixture(false, false, false),
      1,
      "hard",
    );
    const parallelGuard = run(closeGuardFixture(false, true), 1, "hard");
    const nearBoundary = run(nearBoundaryFixture(), 1, "hard");
    const chunks = [1, 37, 1200].map((chunkSteps) =>
      run(closeGuardFixture(false), 1, "weighted", {
        chunkSteps,
        maxChunks: 5000,
      }),
    );
    expect(weighted.rearHits).toBeGreaterThan(0);
    expect(disoccluded(weighted, straight)).toBeGreaterThan(0);
    expect(meanDelta(weighted.stats, absent.stats)).toBeGreaterThan(0);
    expect(zeroSlab.stats.rgb).toEqual(straight.stats.rgb);
    expect(opaque.attributionCounts.rear ?? 0).toBe(0);
    expect([...opaque.eventCounts].some((events) => events > 0)).toBe(true);
    for (let pixel = 0; pixel < opaque.eventCounts.length; pixel++) {
      if (opaque.eventCounts[pixel] === 0) continue;
      for (let channel = 0; channel < 3; channel++)
        expect(opaque.stats.rgb[pixel * 3 + channel]).toBe(
          opaqueBrightTerminal.stats.rgb[pixel * 3 + channel],
        );
    }
    expect([...opaque.bendStrength].every((strength) => strength === 0)).toBe(
      true,
    );
    for (const guard of [guard3, guard4]) {
      expect(guard.frontThenGuardMask[0]).toBe(1);
      expect(guard.termination.opaque).toBe(1);
      expect(guard.unresolved).toBe(0);
    }
    expect(nearBoundary.work.outsideDomainGrid).toBeGreaterThan(0);
    expect(nearBoundary.unresolved).toBe(0);
    expect(ordinaryPerpendicularGuard.unresolved).toBe(0);
    expect(exactTrace(chunks[1])).toEqual(exactTrace(chunks[0]));
    expect(exactTrace(chunks[2])).toEqual(exactTrace(chunks[0]));
    for (const result of [
      absent,
      straight,
      weighted,
      hard,
      zeroSlab,
      opaque,
      opaqueBrightTerminal,
      ...offsetRange.map(([, result]) => result),
      ...chunks,
    ])
      expect(result.unresolved).toBe(0);
    const panels = [
      [absent, "REAR ABSENT"],
      [straight, "STRAIGHT / REAR"],
      [weighted, "WEIGHTED BEND"],
      [hard, "HARD-ONSET CONTROL"],
      [opaque, "OPAQUE LIMIT"],
    ] as const;
    writeLabeledContactSheet(
      panels.map(([result, label]) => ({
        stats: result.stats,
        lines: ["ANALYTIC 3D", label],
      })),
      5,
      "transmission-bend-control.png",
    );
    writeLabeledContactSheet(
      offsetRange.map(([fraction, result]) => ({
        stats: result.stats,
        lines: ["WEIGHTED OFFSET BOUND", `${fraction}R`],
      })),
      3,
      "transmission-bend-offset.png",
    );
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      `${OUT}/transmission-bend-control-report.json`,
      JSON.stringify(
        {
          model:
            "artistic zero-thickness lateral mapping derived from a virtual parallel slab",
          noForwardJump: true,
          closeGuardSeparationRadiusFraction: 0.005,
          options: BASE,
          offsetRange: offsetRange.map(([fraction, result]) => ({
            maxOffsetFraction: fraction,
            versusStraightDelta: meanDelta(straight.stats, result.stats),
            summary: summary(`${fraction}R`, result),
          })),
          disoccludedPixels: disoccluded(weighted, straight),
          straightWeightedDelta: meanDelta(straight.stats, weighted.stats),
          weightedHardDelta: meanDelta(weighted.stats, hard.stats),
          closeGuards: [summary("3D", guard3), summary("posed4D", guard4)],
          analyticOpaqueOverride: {
            scope:
              "one-pixel no-forward-jump oracle only; absent from fractal stills and motion",
            predicate:
              "fixed-grid sample lies within 0.00055R of the z-plane guard .005R downstream",
            invocationCounts: {
              guard3: guard3.work.opaqueControl,
              guard4: guard4.work.opaqueControl,
            },
            genericMixedMaterialQualified: false,
          },
          ordinaryPerpendicularControl: summary(
            "3D perpendicular, no override",
            ordinaryPerpendicularGuard,
          ),
          ordinaryPerpendicularOpaqueOwnership:
            (ordinaryPerpendicularGuard.attributionCounts.guard ?? 0) > 0,
          tiltedParallelNegativeControl: summary("3D parallel", parallelGuard),
          nearBoundaryShiftedDomain: summary("near boundary", nearBoundary),
          chunkInvariant: [1, 37, 1200].map((chunkSteps, i) => ({
            chunkSteps,
            exact:
              JSON.stringify(exactTrace(chunks[i])) ===
              JSON.stringify(exactTrace(chunks[0])),
            summary: summary(`chunk${chunkSteps}`, chunks[i]),
          })),
          rows: panels.map(([result, label]) => summary(label, result)),
        },
        null,
        2,
      ),
    );
  });

  it("renders paired Menger 3D and posed native 4D pilot views", () => {
    mkdirSync(OUT, { recursive: true });
    const poses = {
      menger: { angle: 0.2, eyeOffset: [1.4, 0.9, 1.7] as Vec3, zoom: 0.43 },
      native4: {
        angle: 0.35,
        w0: 0.3,
        eyeOffset: [0.55, 0.35, 2.2] as Vec3,
        zoom: 0.22,
      },
    };
    const specs = [
      [fractalFixture("MENGER 3D", poses.menger), MENGER_SIZE, "menger3"],
      [fractalFixture("MANDELBOX 4D", poses.native4), NATIVE4_SIZE, "native4"],
    ] as const;
    const reportRows: unknown[] = [];
    for (const [fixture, size, stem] of specs) {
      const modes = (["none", "weighted", "hard"] as const).map(
        (onset) => [onset, run(fixture, size, onset)] as const,
      );
      for (const [onset, result] of modes) {
        expect(result.unresolved).toBe(0);
        writeFileSync(
          `${OUT}/transmission-bend-${stem}-${onset}.png`,
          encodePng(size, size, result.stats.rgb),
        );
      }
      writeLabeledContactSheet(
        modes.map(([onset, result]) => ({
          stats: result.stats,
          lines: [fixture.name, onset.toUpperCase()],
        })),
        3,
        `transmission-bend-${stem}.png`,
      );
      expect(modes[1][1].bending.bentPixels).toBeGreaterThan(0);
      expect(meanDelta(modes[0][1].stats, modes[1][1].stats)).toBeGreaterThan(
        0,
      );
      reportRows.push({
        fixture: fixture.name,
        size,
        straightWeightedDelta: meanDelta(modes[0][1].stats, modes[1][1].stats),
        weightedHardDelta: meanDelta(modes[1][1].stats, modes[2][1].stats),
        rows: modes.map(([onset, result]) => summary(onset, result)),
      });
    }
    writeFileSync(
      `${OUT}/transmission-bend-pilot-report.json`,
      JSON.stringify({ options: BASE, poses, rows: reportRows }, null, 2),
    );
  });

  it("queries newly disoccluded rear geometry in an off-centre native 4D slice", () => {
    const absent = run(
      native4HypersphereFixture(false),
      CONTROL_SIZE,
      "weighted",
    );
    const fixture = native4HypersphereFixture(true);
    const straight = run(fixture, CONTROL_SIZE, "none");
    const weighted = run(fixture, CONTROL_SIZE, "weighted");
    const opaque = run(fixture, CONTROL_SIZE, "weighted", { transmit: 0 });
    const zeroSlab = run(fixture, CONTROL_SIZE, "weighted", {
      slabFraction: 0,
    });
    expect(disoccluded(weighted, straight)).toBeGreaterThan(0);
    expect(weighted.rearHits).toBeGreaterThan(straight.rearHits);
    expect(meanDelta(weighted.stats, absent.stats)).toBeGreaterThan(0);
    expect(opaque.attributionCounts.rear ?? 0).toBe(0);
    expect(zeroSlab.stats.rgb).toEqual(straight.stats.rgb);
    for (const result of [absent, straight, weighted, opaque, zeroSlab])
      expect(result.unresolved).toBe(0);
    const panels = [
      [absent, "REAR ABSENT"],
      [straight, "STRAIGHT / REAR"],
      [weighted, "WEIGHTED BEND"],
      [opaque, "OPAQUE LIMIT"],
      [zeroSlab, "ZERO SLAB"],
    ] as const;
    writeLabeledContactSheet(
      panels.map(([result, label]) => ({
        stats: result.stats,
        lines: ["POSED 4D HYPERSPHERES", label],
      })),
      5,
      "transmission-bend-native4-analytic-control.png",
    );
    writeFileSync(
      `${OUT}/transmission-bend-native4-analytic-control-report.json`,
      JSON.stringify(
        {
          fixture:
            "true 4D hyperspheres restricted to a posed off-centre slice",
          pose: { xwAngle: 0.37, w0: 0.23 },
          geometry: {
            sliceNormal: [-Math.sin(0.37), 0, 0, Math.cos(0.37)],
            construction:
              "center4=q4(center3)+offset4*sliceNormal; radius4=hypot(radius3,offset4)",
            front: { center3: [-0.08, 0, 0.42], radius3: 0.48, offset4: 0.2 },
            rear: { center3: [0.26, 0, -0.42], radius3: 0.17, offset4: 0.05 },
            fullBoundingRadius: 1.25,
          },
          options: BASE,
          disoccludedPixels: disoccluded(weighted, straight),
          rows: panels.map(([result, label]) => summary(label, result)),
        },
        null,
        2,
      ),
    );
  });

  it("isolates short camera, rotor, and slice changes with fixed optics", () => {
    mkdirSync(OUT, { recursive: true });
    const groups = [
      {
        key: "menger-camera",
        size: MOTION3_SIZE,
        fixture: "MENGER 3D" as const,
        poses: [
          { eyeOffset: [1.32, 0.9, 1.7] as Vec3, zoom: 0.43 },
          { eyeOffset: [1.4, 0.9, 1.7] as Vec3, zoom: 0.43 },
          { eyeOffset: [1.48, 0.9, 1.7] as Vec3, zoom: 0.43 },
        ],
        isolated: "camera x",
      },
      {
        key: "native4-rotor",
        size: MOTION4_SIZE,
        fixture: "MANDELBOX 4D" as const,
        poses: [0.31, 0.35, 0.39].map((angle) => ({
          angle,
          w0: 0.3,
          eyeOffset: [0.55, 0.35, 2.2] as Vec3,
          zoom: 0.22,
        })),
        isolated: "XW rotor angle",
      },
      {
        key: "native4-slice",
        size: MOTION4_SIZE,
        fixture: "MANDELBOX 4D" as const,
        poses: [0.26, 0.3, 0.34].map((w0) => ({
          angle: 0.35,
          w0,
          eyeOffset: [0.55, 0.35, 2.2] as Vec3,
          zoom: 0.22,
        })),
        isolated: "slice w0",
      },
    ];
    const reportGroups = groups.map((group) => {
      const frames = group.poses.map((pose, frame) => {
        const fixture = fractalFixture(group.fixture, pose);
        const straight = run(fixture, group.size, "none");
        const weighted = run(fixture, group.size, "weighted");
        for (const [onset, result] of [
          ["none", straight],
          ["weighted", weighted],
        ] as const) {
          expect(result.unresolved).toBe(0);
          writeFileSync(
            `${OUT}/transmission-bend-motion-${group.key}-${frame}-${onset}.png`,
            encodePng(group.size, group.size, result.stats.rgb),
          );
        }
        return {
          frame,
          pose,
          straightWeightedDelta: meanDelta(straight.stats, weighted.stats),
          straight: summary("none", straight),
          weighted: summary("weighted", weighted),
        };
      });
      return {
        key: group.key,
        fixture: group.fixture,
        size: group.size,
        isolated: group.isolated,
        constantOptics: BASE,
        frames,
      };
    });
    writeFileSync(
      `${OUT}/transmission-bend-motion-report.json`,
      JSON.stringify(
        {
          model: "actual displaced world-ray continuation",
          groups: reportGroups,
        },
        null,
        2,
      ),
    );
    const options = reportGroups
      .map((group, index) => `<option value="${index}">${group.key}</option>`)
      .join("");
    writeFileSync(
      `${OUT}/transmission-bend-motion.html`,
      `<!doctype html><meta charset="utf-8"><title>Transmission bend motion</title>
<style>body{font:16px system-ui;background:#151820;color:#eee;margin:2rem}main{display:flex;gap:1rem}img{width:min(42vw,512px);image-rendering:pixelated;background:#000}label{display:block;margin:1rem 0}code{color:#9dd}</style>
<h1>World-ray bend motion — UNREVIEWED</h1><p>Artistic zero-thickness lateral interface mapping. Fixed optics; each group changes only the named pose coordinate.</p>
<label>Group <select id="group">${options}</select></label><label>Frame <input id="frame" type="range" min="0" max="2" value="0"> <output id="value">0</output></label>
<p id="params"></p><main><figure><img id="straight"><figcaption>Straight world ray</figcaption></figure><figure><img id="weighted"><figcaption>Weighted lateral bend</figcaption></figure></main>
<script>const groups=${JSON.stringify(reportGroups.map((group) => ({ key: group.key, isolated: group.isolated, frames: group.frames.map((frame) => frame.pose) })))};const g=document.querySelector('#group'),f=document.querySelector('#frame'),v=document.querySelector('#value'),p=document.querySelector('#params'),a=document.querySelector('#straight'),b=document.querySelector('#weighted');function draw(){const x=groups[+g.value],i=+f.value;v.value=i;p.innerHTML='<code>'+x.isolated+': '+JSON.stringify(x.frames[i])+'</code>';a.src='transmission-bend-motion-'+x.key+'-'+i+'-none.png';b.src='transmission-bend-motion-'+x.key+'-'+i+'-weighted.png'}g.oninput=draw;f.oninput=draw;draw()</script>`,
    );
  });
});
