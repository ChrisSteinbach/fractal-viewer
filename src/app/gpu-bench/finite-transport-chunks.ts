import type { SurfaceComputeFrame } from "../surface-compute";
import { DIELECTRIC_ERROR_BUDGET } from "../../fractal/surface-dielectric";
import { FINITE_TRANSPORT_CHUNK_PATHS } from "../../fractal/finite-transport-work";
import { SOFTWARE_RENDERER_RE } from "../render-backend";

export interface FiniteTransportChunkSample {
  index: number;
  width: number;
  height: number;
  truncated: boolean;
  counts: SurfaceComputeFrame["counts"];
  transport: SurfaceComputeFrame["transport"];
  /** JSON-safe copies; retain the actual words, not only a digest. */
  transportState: number[];
  pixels: number[];
}

export interface FiniteTransportChunkArm {
  quota: number;
  maxPaths: number | null;
  cacheCrossings: boolean;
  adapterLabel: string | undefined;
  software: boolean;
  width: number;
  height: number;
  truncated: boolean;
  pixels: number[];
  samples: FiniteTransportChunkSample[];
}

export interface FiniteTransportChunkRow {
  core: "finite" | "finite4";
  preset: "glassMenger" | "glassMenger4";
  width: number;
  height: number;
  samples: number;
  adapterLabel: string | undefined;
  expectedSoftware: boolean;
  controls: FiniteTransportChunkArm[];
  /** Original uncached DDA, compared against the cached quota-zero arm. */
  uncachedControls: FiniteTransportChunkArm[];
  processedLimitControls: FiniteTransportChunkArm[];
}

function sameWords(a: number[], b: number[]): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((word, i) => word === b[i])
  );
}

/** Scheduling must preserve every f32 bit and terminal identity, including
 * intentional processed-limit refusals. A matching empty image is no proof.
 * Terminal status values below independently decode the frozen eight-word
 * transport record; RUNNING (6) may never escape into a completed sample. */
export function finiteTransportChunkFailures(
  row: FiniteTransportChunkRow,
): string[] {
  const failures: string[] = [];
  const integer = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
  const fail = (label: string, condition: boolean, message: string): void => {
    if (!condition) failures.push(`${label}: ${message}`);
  };
  fail(
    "scene",
    (row.core === "finite" && row.preset === "glassMenger") ||
      (row.core === "finite4" && row.preset === "glassMenger4"),
    "missing canonical dimensional identity",
  );
  fail(
    "scene",
    row.width === 8 && row.height === 8 && row.samples === 4,
    "unexpected agreement raster or AA count",
  );
  const rays = 64;
  const pixelsValid = (pixels: number[]): boolean =>
    Array.isArray(pixels) &&
    pixels.length === rays * 4 &&
    pixels.every((value) => integer(value) && value <= 255);
  const sampleFailures = (
    label: string,
    sample: FiniteTransportChunkSample,
    refusal: boolean,
  ): void => {
    const { counts, transport } = sample;
    fail(
      label,
      sample.width === 8 && sample.height === 8 && sample.truncated === false,
      "incomplete sample raster",
    );
    fail(label, pixelsValid(sample.pixels), "missing or malformed RGBA");
    if (!counts || !transport) {
      failures.push(`${label}: missing sample census`);
      return;
    }
    fail(
      label,
      [
        counts.hit,
        counts.miss,
        counts.plane,
        counts.active,
        counts.exhausted,
        transport.resolved,
        transport.unresolved,
        transport.invalid,
        transport.passes,
        transport.continuationChunks ?? 0,
      ].every(integer) &&
        counts.hit > 0 &&
        counts.active === 0 &&
        counts.exhausted === 0 &&
        counts.hit + counts.miss + counts.plane === rays &&
        transport.resolved + transport.unresolved === counts.hit &&
        transport.invalid === 0 &&
        transport.passes > 0 &&
        transport.passes <= 6 &&
        (refusal ? transport.unresolved > 0 : transport.unresolved === 0),
      "incomplete optical/primary census or vacuous glass",
    );
    fail(
      label,
      Array.isArray(transport.batchMs) &&
        transport.batchMs.length > 0 &&
        transport.batchMs.every((ms) => Number.isFinite(ms) && ms >= 0),
      "missing submission evidence",
    );
    const words = sample.transportState;
    if (
      !Array.isArray(words) ||
      words.length !== rays * 8 ||
      !words.every((word) => integer(word) && word <= 0xffffffff)
    ) {
      failures.push(`${label}: missing or malformed raw transport state`);
      return;
    }
    const values = new Float32Array(Uint32Array.from(words).buffer);
    let resolved = 0;
    let unresolved = 0;
    let lit = 0;
    for (let ray = 0; ray < rays; ray++) {
      const p = ray * 8;
      const [r, g, b, residual, status, failure, reason, pass] =
        values.subarray(p, p + 8);
      const rayLabel = `${label} ray ${String(ray)}`;
      fail(
        rayLabel,
        [r, g, b, residual, status, failure, reason, pass].every(
          Number.isFinite,
        ),
        "nonfinite transport payload",
      );
      if (status === 0) {
        fail(
          rayLabel,
          words.slice(p, p + 8).every((word) => word === 0),
          "nonterminal pending work or dirty unowned record",
        );
        continue;
      }
      fail(
        rayLabel,
        [1, 2, 3].includes(status),
        "unexpected terminal status (including RUNNING)",
      );
      fail(
        rayLabel,
        r >= 0 &&
          g >= 0 &&
          b >= 0 &&
          residual >= 0 &&
          integer(pass) &&
          pass < 6 &&
          pass < transport.passes,
        "malformed radiance/residual/replay metadata",
      );
      if (status === 1 || status === 2) {
        resolved++;
        if (r > 0 || g > 0 || b > 0) lit++;
        fail(
          rayLabel,
          residual <= DIELECTRIC_ERROR_BUDGET && failure === 0 && reason === 0,
          "accepted sample exceeds residual budget",
        );
      } else if (status === 3) {
        unresolved++;
        fail(
          rayLabel,
          refusal && failure === 1 && reason === 0 && pass === 5,
          "refusal is not the intentional processed-path limit",
        );
      }
    }
    fail(
      label,
      resolved === transport.resolved &&
        unresolved === transport.unresolved &&
        resolved + unresolved === counts.hit,
      "raw terminal records disagree with the reported census",
    );
    if (!refusal) fail(label, lit > 0, "no positive glass radiance");
  };
  for (const [label, arms, quotas, maxPaths, cacheCrossings] of [
    ["complete", row.controls, [0, 1, 17, 128, 512, 1024, 2048], null, true],
    ["uncached", row.uncachedControls, [0], null, false],
    ["processed-limit", row.processedLimitControls, [0, 1], 2, true],
  ] as const) {
    if (!Array.isArray(arms)) {
      failures.push(`${label}: missing control rows`);
      continue;
    }
    fail(
      label,
      arms.length === quotas.length &&
        arms.every(
          (arm, i) =>
            arm.quota === quotas[i] &&
            arm.maxPaths === maxPaths &&
            arm.cacheCrossings === cacheCrossings,
        ),
      "missing, duplicated or unexpected quota/limit/cache control",
    );
    const baseline = (label === "uncached" ? row.controls : arms)?.find(
      (arm) => arm.quota === 0,
    );
    for (const arm of arms) {
      const armLabel = `${label} quota ${String(arm.quota)}`;
      fail(
        armLabel,
        typeof row.expectedSoftware === "boolean" &&
          arm.software === row.expectedSoftware &&
          (row.expectedSoftware ||
            (typeof arm.adapterLabel === "string" &&
              arm.adapterLabel.trim().length > 0 &&
              !SOFTWARE_RENDERER_RE.test(arm.adapterLabel))),
        "adapter evidence does not match the requested hardware/software class",
      );
      fail(
        armLabel,
        arm.width === 8 &&
          arm.height === 8 &&
          arm.truncated === false &&
          pixelsValid(arm.pixels),
        "incomplete final AA frame",
      );
      if (!Array.isArray(arm.samples)) {
        failures.push(`${armLabel}: missing AA sample evidence`);
        continue;
      }
      fail(
        armLabel,
        arm.samples.length === 4 &&
          arm.samples.every((sample, i) => sample.index === i),
        "missing or repeated AA sample index",
      );
      for (const sample of arm.samples) {
        sampleFailures(
          `${armLabel} sample ${String(sample.index)}`,
          sample,
          maxPaths !== null,
        );
        if (arm.quota === 0)
          fail(
            armLabel,
            (sample.transport?.continuationChunks ?? 0) === 0,
            "uninterrupted control reported a pause",
          );
      }
      // Every positive quota must prove an actual pause — except the
      // production quantum on finite4. The quantum is per-ray-chain (a
      // pause needs ONE chain to cross it inside a dispatch), and the
      // 8×8 diagnostic bank's 4D chains never reach 2048 paths: measured
      // 2026-09-20, quotas 1–1024 pause and match, 2048 reports zero
      // chunks in every sample, so there the control reduces to the
      // uninterrupted-equivalence comparison it already is (word-pinned
      // against quota 0 below). The production-quantum 4D witness lives
      // on the renderer-envelope legs' real frames, which pause at 2048
      // (required by finiteEnvelopeEvidenceFailures). 3D chains DO reach
      // 2048 in this bank (pauses [2,0,1,2] measured), so the 3D
      // requirement stays.
      const pauseRequired =
        arm.quota > 0 &&
        !(row.core === "finite4" && arm.quota === FINITE_TRANSPORT_CHUNK_PATHS);
      if (pauseRequired)
        fail(
          armLabel,
          arm.samples.some(
            (sample) => (sample.transport?.continuationChunks ?? 0) > 0,
          ),
          "positive quota never proved a continuation",
        );
      if (baseline && arm !== baseline) {
        fail(
          armLabel,
          sameWords(arm.pixels, baseline.pixels),
          "final AA RGBA differs from uninterrupted control",
        );
        for (const [index, sample] of arm.samples.entries()) {
          const reference = baseline.samples?.[index];
          if (!reference) continue;
          fail(
            armLabel,
            sameWords(sample.pixels, reference.pixels),
            `sample ${String(index)} RGBA differs from uninterrupted control`,
          );
          fail(
            armLabel,
            sameWords(sample.transportState, reference.transportState),
            `sample ${String(index)} raw transport words differ from uninterrupted control`,
          );
        }
      }
    }
  }
  return failures;
}
