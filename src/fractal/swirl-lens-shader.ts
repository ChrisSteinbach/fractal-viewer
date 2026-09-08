import { SWIRL_MARCH_LIPSCHITZ_MARGIN } from "./swirl-lens";

/** Shader mirrors of the exact inverse and its query-to-set certificate.
 * The global denominator stays on the acceptance path; the bounded query
 * certificate controls only strides. Both dialects share the arithmetic. */
export function swirlLensShaderSource(
  dialect: "glsl" | "wgsl",
  dimension: 3 | 4,
): string {
  const wgsl = dialect === "wgsl";
  const vector = wgsl ? `vec${dimension}f` : `vec${dimension}`;
  const scalar = wgsl ? "f32" : "float";
  const declare = (name: string, value: string): string =>
    `${wgsl ? "let" : scalar} ${name} = ${value};`;
  const inverseSignature = wgsl
    ? `fn swirlLensInverse(u: ${vector}) -> ${vector}`
    : `${vector} swirlLensInverse(${vector} u)`;
  const marchSignature = wgsl
    ? `fn swirlMarchInverseLipschitz(queryRadius: f32, rho: f32, globalLipschitz: f32) -> f32`
    : `float swirlMarchInverseLipschitz(float queryRadius, float rho, float globalLipschitz)`;
  return `${inverseSignature} {
  ${declare("r2", "dot(u, u)")}
  ${declare("s", "sin(r2)")}
  ${declare("c", "cos(r2)")}
  return ${vector}(u.x * s + u.y * c, -u.x * c + u.y * s, u.${dimension === 4 ? "zw" : "z"});
}
${marchSignature} {
  if (rho == 0.0) { return 1.0; }
  if (!(queryRadius >= 0.0 && queryRadius <= 3.402823e38)) { return globalLipschitz; }
  ${declare("radiusSquared", "max(queryRadius * queryRadius, rho * rho)")}
  ${declare("derivative", "sqrt(1.0 + radiusSquared * radiusSquared) + radiusSquared")}
  ${declare("chord", "1.0 + rho * (queryRadius + rho)")}
  ${wgsl ? "var" : "float"} bound = min(derivative, chord);
  if (queryRadius > rho) {
    bound = min(bound, 1.0 + 2.0 * rho / (queryRadius - rho));
  }
  return min(globalLipschitz, bound * ${SWIRL_MARCH_LIPSCHITZ_MARGIN});
}`;
}
