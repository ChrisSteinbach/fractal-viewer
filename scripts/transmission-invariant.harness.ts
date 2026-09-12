/**
 * Small invariants for the world-space transmission event model.
 *
 * This sheet deliberately scores no image. It pins the two properties that
 * a tiny beauty panel cannot establish: scheduling must not alter completed
 * events or optical throughput, and a homothetic scene must keep the same
 * normalized event stream. The public Menger, native affine 4D, and native
 * escape 4D fixtures all go through the shared study instrument.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/transmission-invariant.harness.ts
 */
import { fixtures, renderTransmission } from "./transmission-study";
import type { Fixture } from "./transmission-study";
import type { PreviewScene, Vec3 } from "./de-preview";

const CHUNKS = [1, 37, 1200] as const;
const SIZES = [5, 7] as const;
const EPSILON = 1e-12;

const worldOptions = (chunkSteps: number) => ({
  strategy: "world" as const,
  warp: false,
  worldBand: {
    chunkSteps,
    maxChunks: 4096,
  },
});

function selectedFixtures(): Fixture[] {
  const wanted = new Set([
    "MENGER 3D",
    "PENTATOPE 4D",
    "TESSERACT 4D",
    "16-CELL FLAKE 4D",
    "MANDELBOX 4D",
  ]);
  return fixtures().filter((fixture) => wanted.has(fixture.name));
}

function scaleFixture(fixture: Fixture, factor: number): Fixture {
  const scalePoint = (p: Vec3): Vec3 =>
    p.map((value) => value * factor) as Vec3;
  const unscalePoint = (p: Vec3): Vec3 =>
    p.map((value) => value / factor) as Vec3;
  const source = fixture.scene;
  const scene: PreviewScene = {
    ...source,
    de: (p) => factor * source.de(unscalePoint(p)),
    boundingRadius: source.boundingRadius * factor,
    target: source.target ? scalePoint(source.target) : undefined,
    boundingCenter: source.boundingCenter
      ? scalePoint(source.boundingCenter)
      : undefined,
    eye: source.eye ? scalePoint(source.eye) : undefined,
  };
  return {
    ...fixture,
    name: `${fixture.name} x${factor}`,
    scene,
    color: (p) => fixture.color(unscalePoint(p)),
    opaque: fixture.opaque
      ? (p) => fixture.opaque!(unscalePoint(p))
      : undefined,
  };
}

function assertThroughputEqual(
  actual: Float64Array,
  expected: Float64Array,
  label: string,
): void {
  expect(actual.length, label).toBe(expected.length);
  let maximum = 0;
  for (let i = 0; i < actual.length; i++)
    maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
  expect(maximum, `${label}: max throughput delta`).toBeLessThanOrEqual(
    EPSILON,
  );
}

function assertCompletedInvariant(
  actual: ReturnType<typeof renderTransmission>,
  expected: ReturnType<typeof renderTransmission>,
  label: string,
): void {
  expect(actual.unresolved, `${label}: actual unresolved`).toBe(0);
  expect(expected.unresolved, `${label}: expected unresolved`).toBe(0);
  expect(Array.from(actual.eventCounts), `${label}: event counts`).toEqual(
    Array.from(expected.eventCounts),
  );
  assertThroughputEqual(
    actual.finalThroughput,
    expected.finalThroughput,
    label,
  );
}

describe("world transmission invariants", () => {
  it("keeps completed native 3D/4D event streams across work chunks", () => {
    for (const size of SIZES) {
      for (const fixture of selectedFixtures()) {
        const reference = renderTransmission(
          fixture,
          0.9,
          true,
          size,
          64,
          0.5,
          1200,
          worldOptions(1200),
        );
        for (const chunkSteps of CHUNKS.slice(0, -1)) {
          const actual = renderTransmission(
            fixture,
            0.9,
            true,
            size,
            64,
            0.5,
            1200,
            worldOptions(chunkSteps),
          );
          assertCompletedInvariant(
            actual,
            reference,
            `${fixture.name} ${size}px chunk ${chunkSteps}`,
          );
        }
      }
    }
  });

  it("keeps normalized events and throughput under power-of-two scaling", () => {
    for (const fixture of selectedFixtures()) {
      const reference = renderTransmission(
        fixture,
        0.9,
        true,
        5,
        64,
        0.5,
        1200,
        worldOptions(1200),
      );
      const scaled = renderTransmission(
        scaleFixture(fixture, 2),
        0.9,
        true,
        5,
        64,
        0.5,
        1200,
        worldOptions(1200),
      );
      assertCompletedInvariant(
        scaled,
        reference,
        `${fixture.name} homothetic scale 2`,
      );
    }
  });
});
