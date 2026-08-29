/**
 * Solid max-alpha hierarchy construction measurement.
 *
 * This harness builds deterministic sparse and dense packed RGBA8 volumes at
 * 64³, 128³, and the production 192³ resolution, then times the real
 * `buildVoxelMaxHierarchy` implementation twice per case. The source fixture
 * is created before the clock starts, so the reported wall time is hierarchy
 * construction only. The duplicate build is both a second timing sample and
 * an exact determinism check.
 *
 * Payload byte counts, layout accounting, source/root maxima, and byte-exact
 * repeatability are assertions. Wall-clock results are printed evidence, not
 * flaky performance assertions: this harness is an on-demand measurement
 * record and is excluded from the normal Vitest suite.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/voxel-max-hierarchy.harness.ts
 */
import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  buildVoxelMaxHierarchy,
  voxelMaxHierarchyByteLength,
} from "../src/fractal/voxel-max-hierarchy";

const SIZES = [64, 128, 192] as const;

/** Golden layout totals from the documented ceil-edged level series. */
const EXPECTED_HIERARCHY_BYTES = new Map<number, number>([
  [64, 41_740],
  [128, 316_365],
  [192, 1_048_560],
]);

type Profile = "sparse" | "dense";

interface PackedFixture {
  data: Uint8Array;
  nonzeroAlpha: number;
  maxAlpha: number;
}

interface MeasurementRow {
  profile: Profile;
  size: string;
  sourceMiB: string;
  nonzero: string;
  levels: string;
  hierarchyBytes: number;
  hierarchyMiB: string;
  bytesPerVoxel: string;
  pctOfRgba: string;
  rootMax: number;
  run1Ms: string;
  run2Ms: string;
  bestMs: string;
  fingerprint: string;
}

/** Fast deterministic avalanche over a flat x-fastest texel index. */
function mix32(index: number): number {
  let value = (index + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

/**
 * Make a complete packed volume, not an alpha-only surrogate. Sparse uses a
 * deterministic ~1/64 occupancy mask (representative of a thin attractor in
 * a large cube); dense gives every texel nonzero alpha. The center texel is
 * forced to 255 so the independently tracked source maximum has an obvious
 * expected root witness at every size.
 */
function packedFixture(size: number, profile: Profile): PackedFixture {
  const texels = size ** 3;
  const data = new Uint8Array(texels * 4);
  const forcedMaxIndex = Math.floor(texels / 2);
  let nonzeroAlpha = 0;
  let maxAlpha = 0;
  for (let index = 0; index < texels; index++) {
    const mixed = mix32(index);
    const offset = index * 4;
    data[offset] = mixed & 0xff;
    data[offset + 1] = (mixed >>> 8) & 0xff;
    data[offset + 2] = (mixed >>> 16) & 0xff;

    const occupied = profile === "dense" || (mixed & 0x3f) === 0;
    let alpha = occupied ? 1 + ((mixed >>> 24) % 255) : 0;
    if (index === forcedMaxIndex) alpha = 255;
    data[offset + 3] = alpha;
    if (alpha > 0) nonzeroAlpha++;
    if (alpha > maxAlpha) maxAlpha = alpha;
  }
  return { data, nonzeroAlpha, maxAlpha };
}

function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function environmentLine(): string {
  const cpu = os.cpus()[0]?.model.trim() ?? "unknown CPU";
  return [
    `Node ${process.version}`,
    `${os.platform()} ${os.release()} ${os.arch()}`,
    `${cpu}`,
    `${os.cpus().length} logical CPUs`,
    `${(os.totalmem() / 2 ** 30).toFixed(1)} GiB RAM`,
  ].join(" | ");
}

function measure(size: number, profile: Profile): MeasurementRow {
  const fixture = packedFixture(size, profile);
  const expectedBytes = EXPECTED_HIERARCHY_BYTES.get(size);
  if (expectedBytes === undefined) throw new Error(`missing size ${size}`);

  const start1 = performance.now();
  const first = buildVoxelMaxHierarchy(fixture.data, size);
  const run1Ms = performance.now() - start1;
  const start2 = performance.now();
  const second = buildVoxelMaxHierarchy(fixture.data, size);
  const run2Ms = performance.now() - start2;

  const root = first.levels.at(-1);
  const root2 = second.levels.at(-1);
  expect(root).toBeDefined();
  expect(root2).toBeDefined();
  expect(root!.length).toBe(1);
  expect(root2!.length).toBe(1);
  expect(first.data[root!.offset]).toBe(fixture.maxAlpha);
  expect(second.data[root2!.offset]).toBe(fixture.maxAlpha);
  expect(first.data).toEqual(second.data);
  expect(first.byteLength).toBe(expectedBytes);
  expect(second.byteLength).toBe(expectedBytes);
  expect(voxelMaxHierarchyByteLength(size)).toBe(expectedBytes);
  expect(first.levels.reduce((bytes, level) => bytes + level.length, 0)).toBe(
    expectedBytes,
  );

  const sourceBytes = fixture.data.byteLength;
  const texels = size ** 3;
  return {
    profile,
    size: `${size}³`,
    sourceMiB: (sourceBytes / 2 ** 20).toFixed(2),
    nonzero: `${((fixture.nonzeroAlpha / texels) * 100).toFixed(2)}%`,
    levels: first.levels.map((level) => level.size).join("→"),
    hierarchyBytes: first.byteLength,
    hierarchyMiB: (first.byteLength / 2 ** 20).toFixed(3),
    bytesPerVoxel: (first.byteLength / texels).toFixed(4),
    pctOfRgba: ((first.byteLength / sourceBytes) * 100).toFixed(2),
    rootMax: first.data[root!.offset],
    run1Ms: run1Ms.toFixed(2),
    run2Ms: run2Ms.toFixed(2),
    bestMs: Math.min(run1Ms, run2Ms).toFixed(2),
    fingerprint: fingerprint(first.data),
  };
}

describe("Solid voxel max-alpha hierarchy construction", () => {
  it("measures deterministic sparse and dense production-sized payloads", () => {
    // Small unreported warm-up keeps first-row module/JIT setup out of the
    // useful measurements without pretending runtime noise disappears.
    buildVoxelMaxHierarchy(packedFixture(16, "dense").data, 16);

    const rows: MeasurementRow[] = [];
    for (const size of SIZES) {
      rows.push(measure(size, "sparse"));
      rows.push(measure(size, "dense"));
    }

    console.log(`\nEnvironment: ${environmentLine()}`);
    console.log(
      "Hierarchy construction only; run1/run2 are repeated byte-identical builds, best is descriptive (not a gate).",
    );
    console.table(rows);
    expect(rows).toHaveLength(SIZES.length * 2);
  });
});
