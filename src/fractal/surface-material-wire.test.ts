import {
  CLASSIC_SURFACE_MATERIAL,
  SURFACE_PATTERN_WIRE_AXIS_RADIX,
  SURFACE_PATTERN_WIRE_KIND_RADIX,
  SURFACE_PATTERN_WIRE_STRENGTH_STEPS,
  decodeSurfacePatternConfig,
  encodeSurfacePatternConfig,
  resolveSurfaceMaterial,
  surfaceMaterialLanes,
  surfaceMaterialUsesFinish,
  surfaceMaterialUsesPattern,
} from "./surface-material-wire";
import { SURFACE_PATTERN_AXES, SURFACE_PATTERN_KINDS } from "./surface-pattern";

describe("unified surface material wire", () => {
  it("resolves finish and pattern siblings together with independent gates", () => {
    const classic = resolveSurfaceMaterial(undefined, undefined);
    expect(classic).toEqual(CLASSIC_SURFACE_MATERIAL);
    expect(surfaceMaterialUsesFinish(classic)).toBe(false);
    expect(surfaceMaterialUsesPattern(classic)).toBe(false);

    const patterned = resolveSurfaceMaterial(undefined, {
      kind: "wood",
      axis: "z",
      scale: 4,
    });
    expect(surfaceMaterialUsesFinish(patterned)).toBe(false);
    expect(surfaceMaterialUsesPattern(patterned)).toBe(true);

    const finished = resolveSurfaceMaterial({ metalness: 1 }, undefined);
    expect(surfaceMaterialUsesFinish(finished)).toBe(true);
    expect(surfaceMaterialUsesPattern(finished)).toBe(false);
  });

  it("is the sole A/B authority and composes finish with directly inspectable pattern scale", () => {
    const material = resolveSurfaceMaterial(
      {
        specular: 0.7,
        shininess: 96,
        metalness: 1,
        reflect: 0.6,
        transmit: 0.25,
        reflectionTint: 0.5,
      },
      { kind: "marble", axis: "z", scale: 3.1256, strength: 0.625 },
    );
    const lanes = surfaceMaterialLanes(material);
    expect(lanes.a).toEqual([0.7, 96, 1, 0.6]);
    expect(lanes.b.slice(0, 2)).toEqual([0.25, 0.5]);
    expect(lanes.b[3]).toBe(3.1256);
    expect(decodeSurfacePatternConfig(lanes.b[2], lanes.b[3])).toEqual(
      material.pattern,
    );
  });

  it("keeps classic and finish-only B.zw at literal zero", () => {
    expect(surfaceMaterialLanes(CLASSIC_SURFACE_MATERIAL).b).toEqual([
      0, 1, 0, 0,
    ]);
    expect(
      surfaceMaterialLanes(resolveSurfaceMaterial({ reflect: 1 }, undefined)).b,
    ).toEqual([0, 1, 0, 0]);
  });

  it("round-trips every family, axis and canonical strength quantum through exact float32 arithmetic", () => {
    const f32 = (x: number): number => Math.fround(x);
    let cases = 0;
    const failures: string[] = [];
    for (const kind of SURFACE_PATTERN_KINDS) {
      for (const axis of SURFACE_PATTERN_AXES) {
        for (let q = 0; q <= SURFACE_PATTERN_WIRE_STRENGTH_STEPS; q++) {
          const strength = q / SURFACE_PATTERN_WIRE_STRENGTH_STEPS;
          const config = new Float32Array([
            encodeSurfacePatternConfig({ kind, axis, scale: 7.25, strength }),
          ])[0];
          // Shader-equivalent highp f32 decode: the radix divisions are exact
          // powers of two; the final division by 10000.0 is correctly rounded.
          const kindId = Math.floor(
            f32(config / SURFACE_PATTERN_WIRE_KIND_RADIX),
          );
          const kindBase = f32(kindId * SURFACE_PATTERN_WIRE_KIND_RADIX);
          const axisId = Math.floor(
            f32(f32(config - kindBase) / SURFACE_PATTERN_WIRE_AXIS_RADIX),
          );
          const strengthQ = f32(
            f32(config - kindBase) -
              f32(axisId * SURFACE_PATTERN_WIRE_AXIS_RADIX),
          );
          const shaderStrength = f32(
            strengthQ / SURFACE_PATTERN_WIRE_STRENGTH_STEPS,
          );
          const decoded = decodeSurfacePatternConfig(config, 7.25);
          if (
            !Number.isInteger(config) ||
            config >= 2 ** 24 ||
            shaderStrength !== f32(strength) ||
            decoded.kind !== kind ||
            decoded.axis !== axis ||
            decoded.scale !== 7.25 ||
            decoded.strength !== strength
          ) {
            failures.push(`${kind}/${axis}/${q}: ${config}`);
          }
          cases++;
        }
      }
    }
    expect(cases).toBe(90_009);
    expect(failures).toEqual([]);
  });

  it("includes endpoints and every conventional 0.01 UI quantum in the exact 1e-4 domain", () => {
    for (const kind of SURFACE_PATTERN_KINDS) {
      for (const axis of SURFACE_PATTERN_AXES) {
        for (let percent = 0; percent <= 100; percent++) {
          const strength = percent / 100;
          const config = encodeSurfacePatternConfig({
            kind,
            axis,
            scale: 0.5,
            strength,
          });
          expect(decodeSurfacePatternConfig(config, 0.5).strength).toBe(
            strength,
          );
        }
      }
    }
  });

  it("rounds non-canonical live strengths to the declared wire quantum", () => {
    const config = encodeSurfacePatternConfig({
      kind: "strata",
      axis: "x",
      scale: 32,
      strength: 0.123456789,
    });
    expect(decodeSurfacePatternConfig(config, 32)).toEqual({
      kind: "strata",
      axis: "x",
      scale: 32,
      strength: 0.1235,
    });
  });

  it("decodes zero and malformed/reserved words to total pattern none", () => {
    for (const config of [
      0,
      NaN,
      Infinity,
      -1,
      0.5,
      4 * 65_536,
      65_536 + 10_001,
    ]) {
      expect(decodeSurfacePatternConfig(config, 99)).toEqual(
        CLASSIC_SURFACE_MATERIAL.pattern,
      );
    }
  });
});
