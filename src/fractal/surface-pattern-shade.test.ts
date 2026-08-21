import { createHash } from "node:crypto";
import {
  PATTERN_SHADE_CONSTANTS,
  patternLaneFor,
  patternShadeTs,
  surfacePatternShadeSource,
  type PatternShadeQuery,
} from "./surface-pattern-shade";
import {
  decodeSurfacePatternConfig,
  encodeSurfacePatternConfig,
} from "./surface-material-wire";
import {
  PATTERN_DEFAULT_SCALE,
  evaluateSurfacePattern,
  type ResolvedSurfacePattern,
} from "./surface-pattern";
import type { Vec3 } from "./types";

/** A deterministic pseudo-random generator so the parity sweep is replayed
 * exactly on every run (no Math.random drift in tests). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const liveCalibration: [number, number, number, number] = [
  0.03,
  1 / 0.94,
  0.2,
  1 / 0.6,
];

const query = (over: Partial<PatternShadeQuery> = {}): PatternShadeQuery => ({
  objectP: [0.31, -0.27, 0.44],
  sheets: 0.63,
  calibration: liveCalibration,
  pixelFootprint: 0.003,
  ...over,
});

describe("shared pattern GLSL emission", () => {
  it("emits one patternShade body containing every accepted oracle constant", () => {
    const src = surfacePatternShadeSource();
    expect(src).toContain(
      "vec3 patternShade(vec3 base, vec3 objectP, vec4 fb, vec4 calibration, float sheets, float pixelFootprint) {",
    );
    // The exact wire decode: division by the radices, never a pre-rounded
    // 0.0001 literal.
    expect(src).toContain("float kindDiv = floor(word / 65536.0);");
    expect(src).toContain(
      "float axisDiv = floor((word - kindBase) / 16384.0);",
    );
    expect(src).toContain("float strength = strengthQ / 10000.0;");
    expect(src).not.toContain("0.0001");
    // The direct semantic scale read from B.w.
    expect(src).toContain("float scale = fb.w;");
    // The footprint gate is the pattern arm's own, over the tier-independent
    // acceptance footprint passed in by the call site.
    expect(src).toContain(
      "float gate = nativeEnabled ? patternDetailGate(pixelFootprint) : 0.0;",
    );
    // The three macro families' defining constants.
    expect(src).toContain("smoothstep(0.62, 0.78, t)");
    expect(src).toContain("smoothstep(0.018, 0.052, primaryDistance)");
    expect(src).toContain("smoothstep(0.06, 0.16, t)");
    // The dyadic octave selection is bounded by the oracle's max octave.
    expect(src).toContain(
      `clamp(floor(rawLevel), 0.0, ${PATTERN_SHADE_CONSTANTS.detailMaxOctave}.0);`,
    );
    expect(src).toContain("exp2(levelF)");
  });

  it("keeps the emitted text comment-light so the 4D plain arm's strip headroom is not spent on prose", () => {
    const src = surfacePatternShadeSource();
    const lines = src.split("\n");
    const commentLines = lines.filter((l) => l.trim().startsWith("//"));
    // One marker line only (the pointer to the TS mirror).
    expect(commentLines.length).toBeLessThanOrEqual(1);
  });
});

describe("patternShadeTs vs the accepted V3 oracle", () => {
  const base: Vec3 = [0.78, 0.61, 0.42];
  const kinds = ["wood", "marble", "strata"] as const;
  const axes = ["x", "y", "z"] as const;
  const strengths = [0, 0.0001, 0.01, 0.5, 0.9999, 1];
  const scales = [0.5, 1, 1.35, 3, 4, 32];
  const footprints = [0.001, 0.005, 0.009, 0.0105, 0.012, 0.02];

  const oracle = (
    kind: ResolvedSurfacePattern["kind"],
    axis: ResolvedSurfacePattern["axis"],
    scale: number,
    strength: number,
    q: PatternShadeQuery,
  ) =>
    evaluateSurfacePattern(
      base,
      { kind, axis, scale, strength },
      {
        objectP: q.objectP,
        rings: 0.45,
        sheets: q.sheets,
        ringsCalibration: {
          low: q.calibration[0],
          high:
            q.calibration[0] +
            (q.calibration[1] > 0 ? 1 / q.calibration[1] : 0),
          invSpan: q.calibration[1],
          enabled: q.calibration[1] !== 0,
          sampleCount: 256,
        },
        sheetsCalibration: {
          low: q.calibration[2],
          high:
            q.calibration[2] +
            (q.calibration[3] > 0 ? 1 / q.calibration[3] : 0),
          invSpan: q.calibration[3],
          enabled: q.calibration[3] !== 0,
          sampleCount: 256,
        },
        pixelFootprint: q.pixelFootprint,
      },
    ).albedo;

  it("is an exact albedo identity for a zero word, an invalid family, and strength 0", () => {
    for (const kind of kinds) {
      for (const axis of axes) {
        const lane = patternLaneFor({
          kind,
          axis,
          scale: 3,
          strength: 0,
        });
        expect(
          patternShadeTs(
            base,
            [0.3, -0.2, 0.4],
            lane,
            liveCalibration,
            0.6,
            0.003,
          ),
        ).toEqual(base);
      }
    }
    // A zero word (unpatterned slot): identity.
    expect(
      patternShadeTs(
        base,
        [0.3, -0.2, 0.4],
        [0, 1, 0, 0],
        liveCalibration,
        0.6,
        0.003,
      ),
    ).toEqual(base);
    // A malformed word resolves to none on the CPU side too.
    const malformed = decodeSurfacePatternConfig(99, 1);
    expect(malformed.kind).toBe("none");
  });

  it("reproduces the oracle over the full family/axis/strength/scale/footprint grid", () => {
    for (const kind of kinds) {
      for (const axis of axes) {
        for (const scale of scales) {
          for (const strength of strengths) {
            for (const footprint of footprints) {
              const lane = patternLaneFor({ kind, axis, scale, strength });
              const q = query({ pixelFootprint: footprint });
              const got = patternShadeTs(
                base,
                q.objectP,
                lane,
                q.calibration,
                q.sheets,
                footprint,
              );
              const want = oracle(kind, axis, scale, strength, q);
              for (let c = 0; c < 3; c++) {
                expect(
                  Math.abs(got[c] - want[c]),
                  `kind=${kind} axis=${axis} scale=${scale} strength=${strength} fp=${footprint} ch=${c} (got ${got[c].toFixed(6)}, want ${want[c].toFixed(6)})`,
                ).toBeLessThan(1.5e-3);
              }
            }
          }
        }
      }
    }
  });

  it("tracks the oracle on randomized inputs for every family and axis", () => {
    const rand = lcg(0xc0ffee);
    for (let i = 0; i < 400; i++) {
      const kind = kinds[Math.floor(rand() * 3)];
      const axis = axes[Math.floor(rand() * 3)];
      const scale = 0.5 + rand() * 31.5;
      const strength = Math.round(rand() * 10_000) / 10_000;
      const lane = patternLaneFor({ kind, axis, scale, strength });
      const q: PatternShadeQuery = {
        objectP: [-1 + rand() * 2, -1 + rand() * 2, -1 + rand() * 2],
        sheets: rand(),
        calibration: liveCalibration,
        pixelFootprint: 0.0005 + rand() * 0.02,
      };
      const got = patternShadeTs(
        base,
        q.objectP,
        lane,
        q.calibration,
        q.sheets,
        q.pixelFootprint,
      );
      const want = oracle(kind, axis, scale, strength, q);
      for (let c = 0; c < 3; c++) {
        expect(
          Math.abs(got[c] - want[c]),
          `i=${i} kind=${kind} axis=${axis} scale=${scale.toFixed(4)} strength=${strength} (got ${got[c].toFixed(6)}, want ${want[c].toFixed(6)})`,
        ).toBeLessThan(2e-3);
      }
    }
  });

  it("reproduces the oracle with the native carrier disabled and with extreme sheets", () => {
    const disabled: [number, number, number, number] = [0.5, 0, 0.5, 0];
    for (const kind of kinds) {
      const lane = patternLaneFor({ kind, axis: "y", scale: 3, strength: 1 });
      for (const sheets of [-100, 0, 1, 100]) {
        const q = { ...query(), sheets, calibration: disabled };
        const got = patternShadeTs(
          base,
          q.objectP,
          lane,
          q.calibration,
          sheets,
          q.pixelFootprint,
        );
        const want = oracle(kind, "y", 3, 1, q);
        for (let c = 0; c < 3; c++) {
          expect(
            Math.abs(got[c] - want[c]),
            `kind=${kind} sheets=${sheets}`,
          ).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("pins the config word round trip exactly on the canonical strength grid", () => {
    // The wire contract: encode -> f32 upload -> decode returns the same
    // resolved pattern the shader's decode arithmetic reconstructs.
    for (const kind of ["wood", "marble", "strata"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        for (const strength of [0, 0.0001, 0.25, 0.5, 0.9999, 1]) {
          const pattern: ResolvedSurfacePattern = {
            kind,
            axis,
            scale: 2.5,
            strength,
          };
          const word = encodeSurfacePatternConfig(pattern);
          const lane = patternLaneFor(pattern);
          expect(Math.fround(lane[2])).toBe(word);
          const decoded = decodeSurfacePatternConfig(word, 2.5);
          expect(decoded.kind).toBe(kind);
          expect(decoded.axis).toBe(axis);
          expect(decoded.strength).toBeCloseTo(strength, 6);
        }
      }
    }
  });

  it("keeps the emitted GLSL text stable (a drift guard, not a spec)", () => {
    // The emission is spliced into both tracers; this hash pins the shared
    // body so a change to the pattern math lands loudly in the PR diff
    // rather than silently in both tracers' emitted programs. Update the
    // literal when the pattern arithmetic deliberately changes.
    const hash = createHash("sha256")
      .update(surfacePatternShadeSource())
      .digest("hex");
    expect(hash).toBe(
      "aafaa9cacb703c7b57f27824172bcc05c0537f313acc64bfd9d542e9878ca993",
    );
  });

  it("documents the f32-vs-double gap on the exact integer decode", () => {
    // The one place the wire guarantees EXACT f32: the config word and the
    // recovered strength quantum are integers below 2^18, so the shader's
    // floor/division decode is exact; the strength error versus the authored
    // value is bounded by half the wire quantum (0.00005), and the pattern
    // albedo is a mix in strength, so the albedo error stays proportional.
    const authored: ResolvedSurfacePattern = {
      kind: "wood",
      axis: "z",
      scale: 4,
      strength: 0.75001,
    };
    const word = encodeSurfacePatternConfig(authored);
    const decoded = decodeSurfacePatternConfig(word, 4);
    expect(decoded.strength).toBe(0.75);
    expect(Math.abs(decoded.strength - authored.strength)).toBeLessThanOrEqual(
      0.00005,
    );
    expect(PATTERN_SHADE_CONSTANTS.strengthSteps).toBe(10_000);
    // The shader reads the same quantized value the host decode recovers.
    const lane = patternLaneFor(authored);
    expect(Math.fround(lane[2])).toBe(word);
  });
});

describe("patternLaneFor", () => {
  it("packs through the wire's own lane authority", () => {
    const lane = patternLaneFor({
      kind: "marble",
      axis: "x",
      scale: 7,
      strength: 0.5,
    });
    expect(lane[2]).not.toBe(0);
    expect(lane[3]).toBe(7);
    expect(decodeSurfacePatternConfig(lane[2], lane[3])).toEqual({
      kind: "marble",
      axis: "x",
      scale: 7,
      strength: 0.5,
    });
  });

  it("matches the oracle's default scales for an absent authored scale", () => {
    for (const kind of ["wood", "marble", "strata"] as const) {
      const lane = patternLaneFor({
        kind,
        axis: "y",
        scale: PATTERN_DEFAULT_SCALE[kind],
        strength: 1,
      });
      expect(decodeSurfacePatternConfig(lane[2], lane[3]).scale).toBe(
        PATTERN_DEFAULT_SCALE[kind],
      );
    }
  });
});
