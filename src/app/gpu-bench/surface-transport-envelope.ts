import type { SurfaceComputeFrame } from "../surface-compute";

interface SampleEvidence {
  index: number;
  counts: SurfaceComputeFrame["counts"];
  transport: NonNullable<SurfaceComputeFrame["transport"]>;
  maxBatchMs: number;
}

interface FrameEvidence extends Omit<SampleEvidence, "index"> {
  width: number;
  height: number;
  wallMs: number;
  gpuMs: number;
  truncated: boolean;
  sampleEvidence: SampleEvidence[];
}

export interface FiniteEnvelopeEvidence {
  preview: FrameEvidence;
  previewRepeat: {
    wallMs: number;
    byteIdentical: boolean | null;
    sampleEvidence: SampleEvidence[];
  };
  settle: FrameEvidence & { samples: number };
  cancelProbe: {
    attempts: number;
    delayMs: number;
    latencyMs: number;
    cancelledToNull: boolean;
  };
  retainedBytes: number;
}

/** Validate the evidence before the benchmark compares its timing limits.
 * NaN must not bypass a `> limit` check, and a one-pixel census must not
 * masquerade as a completed canonical image. These finite arms all contain
 * glass: every sample must have positive optical work. This is deliberately
 * separate from the older estimator arms' disclosed vacuous optics. */
export function finiteEnvelopeEvidenceFailures(
  row: FiniteEnvelopeEvidence,
  expected: {
    previewWidth: number;
    previewHeight: number;
    settleWidth: number;
    settleHeight: number;
    settleSamples: number;
  },
): string[] {
  const failures: string[] = [];
  const metric = (label: string, value: number): void => {
    if (!Number.isFinite(value) || value < 0)
      failures.push(`${label}: invalid nonnegative metric ${String(value)}`);
  };
  const integer = (value: number): boolean =>
    Number.isSafeInteger(value) && value >= 0;
  const census = (
    label: string,
    sample: Omit<SampleEvidence, "index">,
    pixels: number,
  ): void => {
    const { counts, transport } = sample;
    if (
      ![
        counts.hit,
        counts.miss,
        counts.plane,
        counts.active,
        counts.exhausted,
        transport.resolved,
        transport.unresolved,
        transport.invalid,
        transport.passes,
      ].every(integer) ||
      counts.active !== 0 ||
      counts.exhausted !== 0 ||
      counts.hit + counts.miss + counts.plane !== pixels ||
      counts.hit <= 0 ||
      transport.resolved !== counts.hit ||
      transport.unresolved !== 0 ||
      transport.invalid !== 0 ||
      transport.passes <= 0
    )
      failures.push(`${label}: incomplete optical/march accounting`);
    metric(`${label} maxBatchMs`, sample.maxBatchMs);
    if (transport.batchMs.length === 0)
      failures.push(`${label}: missing transport submissions`);
    transport.batchMs.forEach((ms, index) =>
      metric(`${label} batch ${String(index)}`, ms),
    );
    if (sample.maxBatchMs < Math.max(0, ...transport.batchMs))
      failures.push(`${label}: maxBatchMs hides an observed submission`);
  };
  for (const [label, frame, width, height] of [
    ["preview", row.preview, expected.previewWidth, expected.previewHeight],
    ["settle", row.settle, expected.settleWidth, expected.settleHeight],
  ] as const) {
    if (frame.width !== width || frame.height !== height)
      failures.push(`${label}: unexpected qualification raster`);
    if (frame.truncated !== false)
      failures.push(`${label}: frame did not complete`);
    metric(`${label} wallMs`, frame.wallMs);
    metric(`${label} gpuMs`, frame.gpuMs);
    census(label, frame, width * height);
    if (
      frame.maxBatchMs <
      Math.max(0, ...frame.sampleEvidence.map((sample) => sample.maxBatchMs))
    )
      failures.push(`${label}: maxBatchMs hides an earlier sample`);
  }
  metric("preview-repeat wallMs", row.previewRepeat.wallMs);
  metric("cancel delayMs", row.cancelProbe.delayMs);
  metric("cancel latencyMs", row.cancelProbe.latencyMs);
  metric("retainedBytes", row.retainedBytes);
  if (!integer(row.cancelProbe.attempts) || row.cancelProbe.attempts <= 0)
    failures.push("cancel: missing valid attempt count");
  if (row.cancelProbe.cancelledToNull !== true)
    failures.push("cancel: no acknowledged mid-frame cancellation");
  if (row.previewRepeat.byteIdentical !== true)
    failures.push("preview repeat not proven byte-identical");
  if (row.settle.samples !== expected.settleSamples)
    failures.push("settle: unexpected qualification sample count");
  for (const [label, evidence, count, pixels] of [
    [
      "preview",
      row.preview.sampleEvidence,
      1,
      expected.previewWidth * expected.previewHeight,
    ],
    [
      "preview-repeat",
      row.previewRepeat.sampleEvidence,
      1,
      expected.previewWidth * expected.previewHeight,
    ],
    [
      "settle",
      row.settle.sampleEvidence,
      expected.settleSamples,
      expected.settleWidth * expected.settleHeight,
    ],
  ] as const) {
    if (evidence.length !== count)
      failures.push(
        `${label}: ${String(evidence.length)}/${String(count)} completed samples`,
      );
    evidence.forEach((sample, index) => {
      const sampleLabel = `${label} sample ${String(index)}`;
      if (sample.index !== index)
        failures.push(`${sampleLabel}: missing or repeated sample index`);
      census(sampleLabel, sample, pixels);
    });
  }
  return failures;
}
