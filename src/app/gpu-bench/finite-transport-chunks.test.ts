import { describe, expect, it } from "vitest";
import {
  finiteTransportChunkFailures,
  type FiniteTransportChunkArm,
  type FiniteTransportChunkRow,
} from "./finite-transport-chunks";

function evidence(
  core: "finite" | "finite4" = "finite",
): FiniteTransportChunkRow {
  const arm = (
    quota: number,
    maxPaths: number | null,
    cacheCrossings = true,
  ): FiniteTransportChunkArm => {
    const samples = [0, 1, 2, 3].map((index) => {
      const values = new Float32Array(64 * 8);
      for (let ray = 0; ray < 2; ray++)
        values.set(
          maxPaths === null
            ? [0.2 + index / 10, 0.4, 0.6, 1 / 2048, ray + 1, 0, 0, 4]
            : [0.1, 0.2, 0.3, 0.8, 3, 1, 0, 5],
          ray * 8,
        );
      return {
        index,
        width: 8,
        height: 8,
        truncated: false,
        counts: { hit: 2, miss: 62, plane: 0, active: 0, exhausted: 0 },
        transport: {
          resolved: maxPaths === null ? 2 : 0,
          unresolved: maxPaths === null ? 0 : 2,
          invalid: 0,
          passes: 6,
          batchMs: [1],
          continuationChunks: quota === 0 ? 0 : 2,
        },
        transportState: Array.from(new Uint32Array(values.buffer)),
        pixels: Array.from({ length: 64 * 4 }, (_, i) => (i + index) % 256),
      };
    });
    return {
      quota,
      maxPaths,
      cacheCrossings,
      adapterLabel: "test device",
      software: false,
      width: 8,
      height: 8,
      truncated: false,
      pixels: [...samples[0].pixels],
      samples,
    };
  };
  return {
    core,
    preset: core === "finite" ? "glassMenger" : "glassMenger4",
    width: 8,
    height: 8,
    samples: 4,
    adapterLabel: "test device",
    expectedSoftware: false,
    controls: [0, 1, 17, 128, 512, 1024, 2048].map((quota) => arm(quota, null)),
    uncachedControls: [arm(0, null, false)],
    processedLimitControls: [0, 1].map((quota) => arm(quota, 2)),
  };
}

function writeFloat(words: number[], index: number, value: number): void {
  words[index] = new Uint32Array(Float32Array.of(value).buffer)[0];
}

describe("finite continuation evidence", () => {
  it.each(["finite", "finite4"] as const)(
    "accepts complete wordwise controls and explicit final-pass refusals: %s",
    (core) => expect(finiteTransportChunkFailures(evidence(core))).toEqual([]),
  );

  it("catches a one-bit f32 difference even when both displayed images match", () => {
    const row = evidence();
    row.controls[1].samples[0].transportState[0]++;
    expect(finiteTransportChunkFailures(row)).toContain(
      "complete quota 1: sample 0 raw transport words differ from uninterrupted control",
    );
  });

  it("checks each AA sample before averaging and the final AA image", () => {
    const row = evidence();
    row.controls[2].samples[0].pixels[0]++;
    row.controls[2].samples[1].pixels[0]--;
    row.controls[3].pixels[3]--;
    const failures = finiteTransportChunkFailures(row);
    expect(failures).toContain(
      "complete quota 17: sample 0 RGBA differs from uninterrupted control",
    );
    expect(failures).toContain(
      "complete quota 17: sample 1 RGBA differs from uninterrupted control",
    );
    expect(failures).toContain(
      "complete quota 128: final AA RGBA differs from uninterrupted control",
    );
  });

  it("refuses missing controls, duplicate samples, partial frames and absent raw state", () => {
    const mutations: ((row: FiniteTransportChunkRow) => void)[] = [
      (row) => {
        row.controls.pop();
      },
      (row) => {
        row.processedLimitControls = [];
      },
      (row) => {
        row.controls[1].quota = 17;
      },
      (row) => {
        row.controls[0].samples.pop();
      },
      (row) => {
        row.controls[2].samples[1].index = 0;
      },
      (row) => {
        row.controls[1].truncated = true;
      },
      (row) => {
        row.controls[0].samples[0].truncated = true;
      },
      (row) => {
        row.controls[1].samples[0].transportState = [];
      },
      (row) => {
        row.controls[1].samples[0].transport = undefined;
      },
      (row) => {
        row.width = 1;
      },
      (row) => {
        row.preset = "glassMenger4";
      },
    ];
    for (const mutate of mutations) {
      const row = evidence();
      mutate(row);
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });

  it("refuses identically bad raw state: RUNNING, NaN, excess residual and wrong refusal", () => {
    for (const [group, word, value] of [
      ["controls", 4, 6],
      ["controls", 0, NaN],
      ["controls", 3, 0.01],
      ["controls", 4, 0],
      ["processedLimitControls", 5, 2],
      ["processedLimitControls", 7, 4],
    ] as const) {
      const row = evidence();
      for (const arm of row[group])
        writeFloat(arm.samples[0].transportState, word, value);
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });

  it("refuses matching all-miss frames and mismatched census or continuation claims", () => {
    const mutations: ((row: FiniteTransportChunkRow) => void)[] = [
      (row) => {
        for (const arm of row.controls) {
          const sample = arm.samples[0];
          sample.counts.hit = sample.transport!.resolved = 0;
          sample.counts.miss = 64;
          sample.transportState.fill(0);
        }
      },
      (row) => {
        row.controls[0].samples[0].counts.hit++;
      },
      (row) => {
        row.controls[0].samples[0].transport!.resolved--;
      },
      (row) => {
        row.controls[0].samples[0].counts.exhausted++;
      },
      (row) => {
        for (const sample of row.controls[1].samples)
          sample.transport!.continuationChunks = 0;
      },
      (row) => {
        for (const sample of row.processedLimitControls[1].samples)
          sample.transport!.continuationChunks = 0;
      },
      (row) => {
        row.controls[0].samples[0].transport!.continuationChunks = 1;
      },
      (row) => {
        row.controls[0].samples[0].transport!.batchMs = [NaN];
      },
    ];
    for (const mutate of mutations) {
      const row = evidence();
      mutate(row);
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });

  it("requires every positive quota to pause, with evidence from any AA sample", () => {
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const row = evidence();
      for (const sample of row.controls[index].samples.slice(0, 3))
        sample.transport!.continuationChunks = 0;
      expect(finiteTransportChunkFailures(row)).toEqual([]);
      row.controls[index].samples[3].transport!.continuationChunks = 0;
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });

  it("records every adapter and retains software correctness without hardware claims", () => {
    const software = evidence();
    software.expectedSoftware = true;
    for (const arm of [
      ...software.controls,
      ...software.uncachedControls,
      ...software.processedLimitControls,
    ]) {
      arm.adapterLabel = "SwiftShader";
      arm.software = true;
    }
    expect(finiteTransportChunkFailures(software)).toEqual([]);
    const mutations: ((row: FiniteTransportChunkRow) => void)[] = [
      (row) => {
        row.controls[3].software = true;
      },
      (row) => {
        row.processedLimitControls[1].adapterLabel = undefined;
      },
      (row) => {
        row.controls[2].adapterLabel = "SwiftShader";
      },
      (row) => {
        row.controls[1].samples[0].transport!.passes = 7;
      },
      (row) => {
        row.processedLimitControls[1].samples[0].transport!.passes = 5;
      },
    ];
    for (const mutate of mutations) {
      const row = evidence();
      mutate(row);
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });

  it("requires the uncached shader and compares every sample against the cached baseline", () => {
    const mutations: ((row: FiniteTransportChunkRow) => void)[] = [
      (row) => {
        row.uncachedControls = [];
      },
      (row) => {
        row.uncachedControls[0].cacheCrossings = true;
      },
      (row) => {
        row.controls[0].cacheCrossings = false;
      },
      (row) => {
        row.uncachedControls[0].quota = 1;
      },
      (row) => {
        row.uncachedControls[0].samples[3].transportState[0]++;
      },
      (row) => {
        row.uncachedControls[0].samples[2].pixels[0]++;
      },
      (row) => {
        row.uncachedControls[0].pixels[0]++;
      },
      (row) => {
        row.samples = 2;
      },
      (row) => {
        row.uncachedControls[0].samples.splice(2);
      },
    ];
    for (const mutate of mutations) {
      const row = evidence();
      mutate(row);
      expect(finiteTransportChunkFailures(row).length).toBeGreaterThan(0);
    }
  });
});
