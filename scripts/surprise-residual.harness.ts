/**
 * fr-b5x measurement harness for the "Surprise Me" quality-gate residual.
 *
 * `randomSystem` (src/fractal/random-system.ts) only returns a candidate
 * once it clears a quality gate probed on the SAME rng stream that rolled
 * it. That gate is a finite-sample estimate: a FLAT system that just barely
 * cleared `MIN_OCCUPIED_CELLS` on its generation-time probe can legitimately
 * re-probe BELOW that floor on a fresh, independently-seeded stream. This
 * harness measures how often that residual actually bites, and for which
 * kind of system, so tuning changes to the gate can be A/B'd against real
 * numbers instead of intuition.
 *
 * Methodology mirrors the fr-d61 validation: `SEEDS` seeded `randomSystem`
 * rolls, and every returned FLAT system (non-flat systems are out of scope
 * here -- see `systemIsFlat`) is re-probed via `runChaosGame` on `STREAMS`
 * independent fresh rng streams at `PROBE` points each -- the same
 * fresh-stream re-probe shape as random-system.test.ts's own re-probe
 * tests. Each stream's occupancy (`occupiedCellCount`) is compared against
 * `MIN_OCCUPIED_CELLS`, and the sweep reports how often, and for which kind
 * of system, the residual shows up.
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts
 *
 * Env knobs (all optional; defaults shown):
 *   SEEDS=2000 PROBE=4000 STREAMS=3
 *
 * Like scripts/gpu-flame-bench.mjs, this file is a dev tool that lives
 * outside the `tsc --noEmit` program (tsconfig.json's `include` is just
 * `src`), so it is transpiled by vitest, not type-checked by `npm run lint`.
 * It also lives outside vitest.config.ts's `include` (src/**\/*.test.ts
 * only), so `npm test` never picks it up -- it only runs via the dedicated
 * config above.
 */
import { systemIsFlat } from "../src/fractal/affine4";
import { runChaosGame } from "../src/fractal/chaos-game";
import {
  MIN_OCCUPIED_CELLS,
  occupiedCellCount,
  randomSystem,
} from "../src/fractal/random-system";
import { mulberry32 } from "../src/fractal/rng";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SEEDS = envInt("SEEDS", 2000);
const PROBE = envInt("PROBE", 4000);
const STREAMS = envInt("STREAMS", 3);

/** Fresh, independent probe stream for seed `seed`'s k-th re-probe (k is
 * 1-based). Convention copied verbatim from random-system.test.ts's own
 * re-probe tests, so results here are directly comparable to those. */
function freshStreamRng(seed: number, k: number) {
  return mulberry32(seed * 7919 + k);
}

/** Nearest-rank percentile over an ascending-sorted array (`p` in [0, 1]).
 * No interpolation, no dependencies -- good enough for a rough sweep
 * report. Returns NaN for an empty input rather than throwing. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(p * sortedAsc.length)),
  );
  return sortedAsc[idx];
}

interface FlatSystemRecord {
  seed: number;
  /** One entry per fresh stream, in stream order (stream 1 first). */
  occupancies: number[];
  belowFloorCount: number;
  mapCount: number;
  hasVariations: boolean;
  symmetryOrder: number;
}

describe("Surprise Me residual sweep (fr-b5x)", () => {
  it("sweeps seeded rolls and reports the flat-system occupancy residual", () => {
    const startMs = performance.now();

    let flat = 0;
    let nonFlat = 0;
    const flatRecords: FlatSystemRecord[] = [];

    for (let seed = 0; seed < SEEDS; seed++) {
      const sys = randomSystem(mulberry32(seed));
      if (!systemIsFlat(sys.transforms)) {
        nonFlat++;
        continue;
      }
      flat++;

      const occupancies: number[] = [];
      for (let k = 1; k <= STREAMS; k++) {
        const result = runChaosGame(
          sys.transforms,
          PROBE,
          freshStreamRng(seed, k),
          sys.finalTransform,
          sys.symmetry ?? undefined,
        );
        occupancies.push(
          occupiedCellCount(result.positions, result.count, result.bounds),
        );
      }

      flatRecords.push({
        seed,
        occupancies,
        belowFloorCount: occupancies.filter((o) => o < MIN_OCCUPIED_CELLS)
          .length,
        mapCount: sys.transforms.length,
        hasVariations: sys.transforms.some(
          (t) => t.variations && t.variations.length > 0,
        ),
        symmetryOrder: sys.symmetry?.order ?? 1,
      });
    }

    const elapsedSeconds = (performance.now() - startMs) / 1000;

    // ---- Occupancy distribution: stream 1 across every flat system ----
    const stream1Occupancies = flatRecords
      .map((r) => r.occupancies[0])
      .sort((a, b) => a - b);
    const sum = stream1Occupancies.reduce((acc, v) => acc + v, 0);
    const mean =
      stream1Occupancies.length > 0 ? sum / stream1Occupancies.length : NaN;

    // ---- Residual counts ----
    const belowAny = flatRecords.filter((r) => r.belowFloorCount >= 1);
    const belowStream1 = flatRecords.filter(
      (r) => r.occupancies[0] < MIN_OCCUPIED_CELLS,
    );
    const belowAll = flatRecords.filter((r) => r.belowFloorCount === STREAMS);
    const belowAnyPct = flat > 0 ? (belowAny.length / flat) * 100 : NaN;

    // ---- Split of the >=1-stream failures ----
    const failuresWithVariations = belowAny.filter((r) => r.hasVariations);
    const failuresPureAffine = belowAny.filter((r) => !r.hasVariations);

    // ---- Report ----
    const lines: string[] = [];
    lines.push("");
    lines.push("=== Surprise Me residual sweep (fr-b5x) ===");
    lines.push(`Config: SEEDS=${SEEDS} PROBE=${PROBE} STREAMS=${STREAMS}`);
    lines.push("");
    lines.push("-- Totals --");
    lines.push(`Seeds rolled:       ${SEEDS}`);
    lines.push(`Flat systems:       ${flat}`);
    lines.push(`Non-flat systems:   ${nonFlat}`);
    lines.push("");
    lines.push(
      `-- Stream-1 occupancy distribution (flat systems, n=${stream1Occupancies.length}) --`,
    );
    lines.push(
      `min=${stream1Occupancies[0] ?? NaN}  ` +
        `p10=${percentile(stream1Occupancies, 0.1)}  ` +
        `p50=${percentile(stream1Occupancies, 0.5)}  ` +
        `mean=${mean.toFixed(1)}  ` +
        `max=${stream1Occupancies[stream1Occupancies.length - 1] ?? NaN}`,
    );
    lines.push("");
    lines.push("-- Residual counts (flat systems) --");
    lines.push(
      `Below floor on >=1 stream:  ${belowAny.length} (${belowAnyPct.toFixed(2)}% of flat)`,
    );
    lines.push(`Below floor on stream 1:    ${belowStream1.length}`);
    lines.push(`Below floor on ALL streams: ${belowAll.length}`);
    lines.push("");
    lines.push(
      `-- >=1-stream failures by kind: ${failuresWithVariations.length} with variations, ${failuresPureAffine.length} pure-affine --`,
    );
    lines.push("");
    lines.push("-- Per-system detail (>=1-stream failures) --");
    lines.push(
      "seed".padEnd(8) +
        "occupancies".padEnd(26) +
        "maps".padEnd(6) +
        "kind".padEnd(8) +
        "sym".padEnd(5) +
        "flag",
    );
    for (const r of belowAny) {
      lines.push(
        String(r.seed).padEnd(8) +
          r.occupancies.join("/").padEnd(26) +
          String(r.mapCount).padEnd(6) +
          (r.hasVariations ? "vars" : "affine").padEnd(8) +
          String(r.symmetryOrder).padEnd(5) +
          (r.belowFloorCount === STREAMS ? "ALL" : ""),
      );
    }
    lines.push("");
    lines.push(
      `Seeds failing on ALL streams: ${
        belowAll.length > 0 ? belowAll.map((r) => r.seed).join(", ") : "(none)"
      }`,
    );
    lines.push("");
    lines.push(`Sweep wall time: ${elapsedSeconds.toFixed(2)}s`);
    lines.push("");

    console.log(lines.join("\n"));

    // Measurement harness, not a gate: never fail on residual counts.
    expect(flat).toBeGreaterThan(0);
  });
});
