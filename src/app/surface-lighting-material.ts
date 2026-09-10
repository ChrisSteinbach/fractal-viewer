import type * as THREE from "three";
import { LATTICE_PRESENTATION_FADE_START_MULT } from "../fractal/lattice-march";
import {
  SURFACE_LIGHTING_LANE_COUNT,
  surfaceLightingLanes,
  surfaceLightingRuntime,
  type SurfaceLighting,
  type SurfaceLightingRuntime,
} from "../fractal/surface-lighting";
import { surfaceLightingShaderSource } from "../fractal/surface-lighting-shader";

/** Identical uniform lanes for both displayed-space fragment tracers. */
export function surfaceLightingUniforms(): Record<string, THREE.IUniform> {
  return {
    uCinematic: { value: new Float32Array(SURFACE_LIGHTING_LANE_COUNT * 4) },
    uCinematicBackground: { value: null },
    uCinematicBackgroundOn: { value: 0 },
  };
}

export function installSurfaceLightingUniforms(
  material: THREE.ShaderMaterial,
  lighting: SurfaceLighting | undefined,
  runtime?: SurfaceLightingRuntime,
): void {
  if (!lighting) return;
  const lanes = surfaceLightingLanes(
    lighting,
    runtime ??
      surfaceLightingRuntime({
        dimension: 3,
        boundingRadius: 1,
      }),
  );
  (material.uniforms.uCinematic.value as Float32Array).set(lanes);
}

interface LightingVariant {
  finish: boolean;
  plane: boolean;
  balloon: boolean;
  condensation: boolean;
  lattice: boolean;
  fourD: boolean;
}

/**
 * Add the shared transport to a fully resolved geometry program. All queries
 * use its public displayed DE, including the posed slice and Balloon union.
 * The old source is untouched when the authored rig is absent.
 *
 * Encoded RGB may exceed one: the active renderer uses a float color target,
 * decodes each sample into the linear accumulator, and clips only the mean.
 * Coverage/CoC keep their existing sidecar layout. Background replacement is
 * a retrace while this arm is active; its encoded-color beta is always zero.
 */
export function withSurfaceLightingGlsl(
  source: string,
  variant: LightingVariant,
): string {
  let result = source;
  const replace = (from: string, to: string): void => {
    if (!result.includes(from)) {
      throw new Error(
        `Surface lighting shader splice missing: ${from.slice(0, 80)}`,
      );
    }
    result = result.replace(from, to);
  };
  const header = `
uniform vec4 uCinematic[9];
uniform sampler2D uCinematicBackground;
uniform int uCinematicBackgroundOn;
bool cinematicComplete = false;
vec3 cinematicEncode(vec3 color) {
  vec3 finite = vec3(
    color.r >= 0.0 ? min(color.r, 1.0e20) : 0.0,
    color.g >= 0.0 ? min(color.g, 1.0e20) : 0.0,
    color.b >= 0.0 ? min(color.b, 1.0e20) : 0.0);
  return pow(finite, vec3(1.0 / 2.2));
}
vec3 cinematicBackdrop(vec2 uv, vec3 gradient) {
  return uCinematicBackgroundOn == 1
    ? texture(uCinematicBackground, uv).rgb : gradient;
}
vec2 cinematicVisibilityInterval(vec3 from, vec3 to) {
  float end = length(to - from);
  ${
    variant.lattice
      ? `
  if (end <= 0.0) return vec2(0.0);
  LatticeCarrierInterval interval = latticePresentationInterval(from, (to - from) / end,
    ${variant.fourD ? "uW0, vec4(uInvRotor[0][1], uInvRotor[1][1], uInvRotor[2][1], uInvRotor[3][1]), " : ""}uVisibleRadius, uTilingPresentationR);
  if (!interval.ok) return vec2(0.0);
  return vec2(max(0.0, interval.tEnter), min(end, interval.tFar));`
      : "return vec2(0.0, end);"
  }
}
float cinematicStepScale() { return uStepScale; }
float cinematicDE(vec3 p, int workIndex) {
  return surfaceDE(p, 0.0);
}
bool cinematicPlaneBlocked(vec3 from, vec3 to) {
  ${
    variant.plane
      ? `
  float da = from.y - uGroundY;
  float db = to.y - uGroundY;
  if (da * db >= 0.0) return false;
  vec3 p = mix(from, to, da / (da - db));
  vec2 rel = p.xz - uGroundBallC.xz;
  return dot(rel, rel) < uGroundFadeEnd * uGroundFadeEnd;`
      : "return false;"
  }
}
vec3 cinematicEnvironment(vec3 pos, vec3 n, vec3 rd, vec3 baseEncoded, vec4 fa, vec4 fb) {
  ${variant.finish ? "return pow(max(finishShade(baseEncoded, pos, n, rd, 0.0, 0.0, vec3(0.0), fa, vec4(0.0, fb.y, 0.0, 0.0)), vec3(0.0)), vec3(2.2));" : "return vec3(0.0);"}
}
${surfaceLightingShaderSource({ language: "glsl", field: (lane) => `uCinematic[${lane}]` })}
`;
  const main = "  void main() {";
  const insertion = variant.plane ? "  vec3 shadeGroundPlane(" : main;
  replace(insertion, `${header}\n${insertion}`);
  // Only the fragment main remains in this source (the vertex is separate).
  replace(main, "  void cinematicTraceMain() {");
  replace(
    "vec3 background = mix(uBgBottom, uBgTop, backgroundShapeT(vUv));",
    "vec3 background = cinematicBackdrop(vUv, mix(uBgBottom, uBgTop, backgroundShapeT(vUv)));",
  );
  const shadowStart = variant.fourD
    ? "    // Soft shadow:"
    : "    // Soft shadow: classic DE penumbra";
  const shadeStart = result.indexOf(
    shadowStart,
    result.indexOf("void cinematicTraceMain()"),
  );
  if (shadeStart < 0)
    throw new Error("Surface lighting shading boundary missing");
  const slots = variant.condensation ? "uShadeCount" : "uMapCount";
  const finish = variant.finish
    ? `int cinematicSlot = clamp(firstChoice, 0, ${slots} - 1);
    vec4 cinematicFa = uMapFinishA[cinematicSlot];
    vec4 cinematicFb = uMapFinishB[cinematicSlot];`
    : "vec4 cinematicFa = vec4(0.4, 32.0, 0.0, 0.0);\n    vec4 cinematicFb = vec4(0.0, 1.0, 0.0, 0.0);";
  const covered = variant.lattice
    ? `latticePresentationVisibility(pos, uVisibleRadius * ${LATTICE_PRESENTATION_FADE_START_MULT.toFixed(1)}, uTilingPresentationR)`
    : "1.0";
  const shade = `
    ${finish}
    vec2 cinematicPixel = floor(gl_FragCoord.xy);
    vec3 cinematicLinear = cinematicSurface(pos, n, rd, base, cinematicFa, cinematicFb,
      pow(max(background, vec3(0.0)), vec3(2.2)), cinematicPixel, 0);
    float cinematicCoverage = ${covered};
    ${
      variant.lattice
        ? `cinematicLinear = mix(pow(max(background, vec3(0.0)), vec3(2.2)),
      cinematicLinear, cinematicCoverage);`
        : ""
    }
    outColor = vec4(cinematicEncode(cinematicLinear), 1.0);
    outTraceLayer = traceLayer(cinematicCoverage, 0.0, dot(pos - ro, uFocusPlane.xyz));
    outTraceLayer.b = 0.0;
    cinematicComplete = true;
    return;
`;
  result = result.slice(0, shadeStart) + shade + result.slice(shadeStart);
  // UNRESOLVED RAYS STAY DARK. Alpha 0.5 is the EXHAUSTED status, not a
  // miss (that exit writes alpha 0.0): a ray whose march ran out cannot be
  // painted with the backdrop, because linear transport must not treat
  // unknown geometry as clear sky. This mirrors the compute kernel's
  // `if (st.y == EXHAUSTED) { terminal = vec3f(0.0); }`, and dropping it
  // drifts a Balloon frame past cinematic-lighting.verify.mjs's bar.
  replace(
    "      outColor = vec4(background, 0.5);",
    "      outColor = vec4(vec3(0.0), 0.5);",
  );
  if (variant.plane) {
    const planeStart = result.indexOf("  vec3 shadeGroundPlane(");
    const planeBody = result.indexOf("    // Penumbra shadow", planeStart);
    if (planeBody < 0)
      throw new Error("Surface lighting floor boundary missing");
    const planeShade = `
    vec3 cinematicFloorBase = uGroundAlbedo;
    if (uGroundPattern == 1) {
      float cell = max(uGroundBallR * uGroundTileScale, 1.0e-4);
      vec2 tile = floor((hp.xz - uGroundBallC.xz) / cell);
      cinematicFloorBase *= mix(0.035, 1.0, mod(tile.x + tile.y, 2.0));
    }
    vec2 cinematicPixel = floor(gl_FragCoord.xy);
    vec3 cinematicBackgroundLinear = pow(max(background, vec3(0.0)), vec3(2.2));
    vec3 cinematicFloor = cinematicSurface(hp, vec3(0.0, 1.0, 0.0), rd, cinematicFloorBase,
      vec4(0.0, 32.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), cinematicBackgroundLinear,
      cinematicPixel, 0) + pow(cinematicFloorBase, vec3(2.2)) * uGroundEmission;
    cinematicComplete = true;
    return cinematicEncode(mix(cinematicBackgroundLinear, cinematicFloor, fade));
`;
    result = result.slice(0, planeBody) + planeShade + result.slice(planeBody);
  }
  // A ray that reached no shade site keeps the encoded backdrop the trace
  // itself wrote: with no participating medium there is nothing to light
  // along it, so the miss path needs no second pass at all.
  return `${result}
void main() {
  cinematicTraceMain();
  outTraceLayer.b = 0.0;
}
`;
}
