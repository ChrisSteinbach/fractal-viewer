import { describe, expect, it } from "vitest";
import {
  finiteEnvelopeEvidenceFailures,
  type FiniteEnvelopeEvidence,
} from "./surface-transport-envelope";

const expected = {
  previewWidth: 256,
  previewHeight: 144,
  settleWidth: 512,
  settleHeight: 288,
  settleSamples: 4,
};

function completeEvidence(): FiniteEnvelopeEvidence {
  const frame = (width: number, height: number, samples: number) => {
    const sample = {
      counts: {
        hit: 1,
        miss: width * height - 1,
        plane: 0,
        active: 0,
        exhausted: 0,
      },
      transport: {
        resolved: 1,
        unresolved: 0,
        invalid: 0,
        passes: 1,
        batchMs: [0],
        continuationChunks: 2,
      },
      maxBatchMs: 0,
    };
    return {
      ...structuredClone(sample),
      width,
      height,
      wallMs: 0,
      gpuMs: 0,
      truncated: false,
      sampleEvidence: Array.from({ length: samples }, (_, index) => ({
        ...structuredClone(sample),
        index,
      })),
    };
  };
  return {
    preview: frame(256, 144, 1),
    previewRepeat: {
      wallMs: 0,
      byteIdentical: true,
      sampleEvidence: frame(256, 144, 1).sampleEvidence,
    },
    settle: { ...frame(512, 288, 4), samples: 4 },
    cancelProbe: {
      attempts: 1,
      delayMs: 0,
      latencyMs: 0,
      cancelledToNull: true,
    },
    retainedBytes: 0,
  };
}

describe("finite renderer envelope evidence", () => {
  it("accepts complete partitions, including legitimate zero counts and timings", () => {
    expect(
      finiteEnvelopeEvidenceFailures(completeEvidence(), expected),
    ).toEqual([]);
  });

  it.each([NaN, Infinity, -1])(
    "rejects malformed timing/storage metrics: %s",
    (bad) => {
      const setters: ((row: FiniteEnvelopeEvidence) => void)[] = [
        (row) => {
          row.preview.wallMs = bad;
        },
        (row) => {
          row.settle.gpuMs = bad;
        },
        (row) => {
          row.preview.maxBatchMs = bad;
        },
        (row) => {
          row.previewRepeat.wallMs = bad;
        },
        (row) => {
          row.previewRepeat.sampleEvidence[0].maxBatchMs = bad;
        },
        (row) => {
          row.settle.sampleEvidence[0].transport.batchMs[0] = bad;
        },
        (row) => {
          row.cancelProbe.latencyMs = bad;
        },
        (row) => {
          row.cancelProbe.delayMs = bad;
        },
        (row) => {
          row.retainedBytes = bad;
        },
      ];
      for (const mutate of setters) {
        const row = completeEvidence();
        mutate(row);
        expect(
          finiteEnvelopeEvidenceFailures(row, expected).length,
        ).toBeGreaterThan(0);
      }
    },
  );

  it("rejects partial, fractional, absent, duplicated and vacuous sample evidence", () => {
    const setters: ((row: FiniteEnvelopeEvidence) => void)[] = [
      (row) => {
        row.preview.sampleEvidence[0].counts.miss = 0;
      },
      (row) => {
        row.settle.sampleEvidence[0].counts.plane = 0.5;
        row.settle.sampleEvidence[0].counts.miss -= 0.5;
      },
      (row) => {
        row.settle.sampleEvidence.pop();
      },
      (row) => {
        row.settle.sampleEvidence[1].index = 0;
      },
      (row) => {
        row.previewRepeat.sampleEvidence[0].transport.passes = 0;
      },
      (row) => {
        row.previewRepeat.sampleEvidence[0].transport.batchMs = [];
      },
      (row) => {
        row.settle.samples = 0;
        row.settle.sampleEvidence = [];
      },
      (row) => {
        row.preview.width = 1;
      },
      (row) => {
        row.previewRepeat.byteIdentical = null;
      },
      (row) => {
        row.cancelProbe.attempts = 0;
      },
      (row) => {
        const sample = row.settle.sampleEvidence[0];
        sample.counts.miss += sample.counts.hit;
        sample.counts.hit = sample.transport.resolved = 0;
      },
    ];
    for (const mutate of setters) {
      const row = completeEvidence();
      mutate(row);
      expect(
        finiteEnvelopeEvidenceFailures(row, expected).length,
      ).toBeGreaterThan(0);
    }
  });

  it("rejects an earlier 700 ms submission hidden by final-sample timing", () => {
    const row = completeEvidence();
    row.settle.sampleEvidence[0].transport.batchMs = [700];
    expect(finiteEnvelopeEvidenceFailures(row, expected)).toContain(
      "settle sample 0: maxBatchMs hides an observed submission",
    );
    row.settle.sampleEvidence[0].maxBatchMs = 700;
    expect(finiteEnvelopeEvidenceFailures(row, expected)).toContain(
      "settle: maxBatchMs hides an earlier sample",
    );
  });

  it("requires the production-quantum resumption to pause in preview and settle", () => {
    // The finite4 quota-2048 witness lives here: the real production
    // frames must report actual pauses (chain-length counts, not timing).
    const row = completeEvidence();
    row.preview.transport.continuationChunks = 0;
    expect(finiteEnvelopeEvidenceFailures(row, expected)).toContain(
      "preview: production-quantum resumption never paused (continuationChunks 0)",
    );
    const row2 = completeEvidence();
    row2.settle.transport.continuationChunks = 0;
    expect(finiteEnvelopeEvidenceFailures(row2, expected)).toContain(
      "settle: production-quantum resumption never paused (continuationChunks 0)",
    );
    // An absent field reads as never-paused.
    const row3 = completeEvidence();
    delete row3.preview.transport.continuationChunks;
    expect(
      finiteEnvelopeEvidenceFailures(row3, expected).some((failure) =>
        failure.startsWith("preview: production-quantum resumption"),
      ),
    ).toBe(true);
  });
});
