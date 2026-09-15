/**
 * THE SEVEN SHIPPED CORES' GENERATED WGSL, PINNED BY DIGEST.
 *
 * `surfaceDeKernelWgsl` is one generator whose every emitted text is a
 * function of `opts.core` through ternary chains and derived predicates.
 * Adding a core adds an arm to each chain, and the claim that the seven
 * existing values still emit the same text is exactly the kind of claim an
 * argument gets wrong by one missed site. So it is PINNED against the
 * module as it stood BEFORE the sphere-inversion cores existed: the
 * fixture beside this file records a SHA-256 digest of the generated source
 * (or of the thrown message, so a refusal is pinned too) for each of the
 * seven cores × three modes × the option sweep below, and this test
 * recomputes every one.
 *
 * A failure here means an existing kernel's text moved. That is never an
 * incidental change: fix the generator, or — for a deliberate change to a
 * shipped kernel — re-record with `SURFACE_GPU_DIGEST_RECORD=1 npx vitest run
 * src/fractal/surface-de-gpu-digest.test.ts` IN ITS OWN COMMIT, saying why.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { surfaceDeKernelWgsl } from "./surface-de-gpu";
import type { SurfaceGpuKernelOptions } from "./surface-de-gpu";

const FIXTURE = fileURLToPath(
  new URL("./surface-de-gpu-digest.json", import.meta.url),
);

const CORES = [
  "fold",
  "affine",
  "escape",
  "bulb",
  "affine4",
  "fold4",
  "escape4",
] as const;
const MODES = ["eval", "march", "shade"] as const;

/** The boolean/scalar option sweep: every option a core might read or
 * refuse, alone and in the pairs the app and the bench actually build.
 * Structured options (tiling, shape trap, condensation, schedule, chaos)
 * keep their own byte-identity tests; this fixture's job is the core
 * dispatch, which these flags exercise at every branch. */
const SWEEP: Record<string, Partial<SurfaceGpuKernelOptions>> = {
  base: {},
  width12: { width: 12 },
  sharedFrontier: { sharedFrontier: true, width: 12 },
  bnbStage2: { bnbStage2: true, width: 12 },
  shadeDeWidth1: { shadeDeWidth: 1, width: 12 },
  groundPlane: { groundPlane: true },
  finish: { finish: true },
  lighting: { lighting: true },
  pattern: { pattern: true },
  optics: { optics: true },
  statusOut: { statusOut: true },
  unproject: { rays: "unproject" },
  evalStride: { evalStride: true },
  lens: { lens: true },
  lensPost: { lens: true, lensPost: true },
  balloon: { balloon: true },
  balloonLens: { balloon: true, lens: true },
  planeLens: { groundPlane: true, lens: true },
  planeFinish: { groundPlane: true, finish: true },
  finishLighting: { finish: true, lighting: true },
  slabExtOff: { slabExt: false },
  slabCover: { slabCover: true },
  slabCoverLens: { slabCover: true, lens: true },
  mapsUniform: { mapsUniform: true },
  appMarch: {
    rays: "unproject",
    statusOut: true,
    groundPlane: true,
    width: 12,
  },
  appShade: { shadeDeWidth: 1, width: 12, groundPlane: true, finish: true },
};

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sweepDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const core of CORES) {
    for (const mode of MODES) {
      for (const [label, overrides] of Object.entries(SWEEP)) {
        const opts: SurfaceGpuKernelOptions = {
          mode,
          width: 4,
          workgroupSize: 16,
          sharedFrontier: false,
          bnbStage2: false,
          core,
          ...overrides,
        };
        let digest: string;
        try {
          digest = sha(surfaceDeKernelWgsl(opts));
        } catch (err) {
          digest = `throw:${sha(String((err as Error).message))}`;
        }
        out[`${core}|${mode}|${label}`] = digest;
      }
    }
  }
  return out;
}

describe("surfaceDeKernelWgsl seven-core digest pin", () => {
  const current = sweepDigests();

  if (process.env.SURFACE_GPU_DIGEST_RECORD === "1") {
    it("records the fixture", () => {
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
      expect(Object.keys(current).length).toBe(
        CORES.length * MODES.length * Object.keys(SWEEP).length,
      );
    });
    return;
  }

  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
    string,
    string
  >;

  it("sweeps exactly the recorded configurations", () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(recorded).sort());
  });

  it("covers both generated sources and refusals", () => {
    const values = Object.values(recorded);
    expect(values.some((v) => v.startsWith("throw:"))).toBe(true);
    expect(
      values.filter((v) => !v.startsWith("throw:")).length,
    ).toBeGreaterThan(300);
  });

  for (const core of CORES) {
    it(`core "${core}" generates byte-identical source (or the identical refusal) across every mode and swept option`, () => {
      const moved = Object.keys(recorded).filter(
        (key) => key.startsWith(`${core}|`) && current[key] !== recorded[key],
      );
      expect(moved).toEqual([]);
    });
  }
});
