/** Shader mirror of swirl-lens.ts's exact inverse. The globally certified
 * Lipschitz denominator is built once on the CPU and carried on the lens
 * wire. Both dimensions and dialects share this inverse arithmetic. */
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
  return `${inverseSignature} {
  ${declare("r2", "dot(u, u)")}
  ${declare("s", "sin(r2)")}
  ${declare("c", "cos(r2)")}
  return ${vector}(u.x * s + u.y * c, -u.x * c + u.y * s, u.${dimension === 4 ? "zw" : "z"});
}`;
}
