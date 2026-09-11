/** One transport body for the two GLSL tracers and all WGSL Surface cores.
 * The caller supplies cinematicDE(p, workIndex), cinematicPlaneBlocked(a,b),
 * cinematicVisibilityInterval(a,b), cinematicStepScale(),
 * and cinematicEnvironment(pos,n,rd,baseEncoded,fa,fb). DE queries must see
 * the public displayed-space object, including its posed 4D slice/Balloon.
 * The environment callback returns linear reflection only: existing finish
 * shading with shadow/AO/transmission zero, decoded without clamping.
 *
 * Every output is linear HDR. Finite-segment visibility is conservative on
 * exhaustion/nonfinite DE, and counts those refusals per invocation. Compute
 * schedules individual medium cells/lights; GLSL calls the bounded full loop.
 * A geometry stride never skips participating medium.
 */
import {
  SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES,
  SURFACE_LIGHTING_MAX_SHADOW_STEPS,
  SURFACE_LIGHTING_MAX_SURFACE_SAMPLES,
} from "./surface-lighting";

export interface SurfaceLightingShaderDialect {
  language: "glsl" | "wgsl";
  /** One of the twelve frozen vec4 lanes; expressions may index a light. */
  field: (index: number | string) => string;
}

export function surfaceLightingShaderSource(
  dialect: SurfaceLightingShaderDialect,
): string {
  const wg = dialect.language === "wgsl";
  const v2 = wg ? "vec2f" : "vec2";
  const v3 = wg ? "vec3f" : "vec3";
  const v4 = wg ? "vec4f" : "vec4";
  const it = wg ? "i32" : "int";
  const ut = wg ? "u32" : "uint";
  const ft = wg ? "f32" : "float";
  const f = wg ? "let" : "float";
  const mv = wg ? "var" : "float";
  const mi = wg ? "var" : "int";
  const u = wg ? "let" : "uint";
  const mu = wg ? "var" : "uint";
  const c2 = wg ? "let" : v2;
  const c3 = wg ? "let" : v3;
  const m3 = wg ? "var" : v3;
  const c4 = wg ? "let" : v4;
  const b = wg ? "let" : "bool";
  const lane = dialect.field;
  const fn = (
    name: string,
    args: [string, string][],
    result: string,
    body: string,
  ): string =>
    (wg
      ? `fn ${name}(${args.map(([n, t]) => `${n}: ${t}`).join(", ")}) -> ${result}`
      : `${result} ${name}(${args.map(([n, t]) => `${t} ${n}`).join(", ")})`) +
    ` {\n${body}\n}\n`;
  const choose = (no: string, yes: string, test: string): string =>
    wg ? `select(${no}, ${yes}, ${test})` : `(${test} ? ${yes} : ${no})`;
  const def = wg
    ? "var<private> cinematicVisibilityExhausted: f32 = 0.0;\nvar<private> cinematicVisibilityInvalid: f32 = 0.0;\n"
    : "float cinematicVisibilityExhausted = 0.0;\nfloat cinematicVisibilityInvalid = 0.0;\n";
  const hash = fn(
    "cinematicHash",
    [["value", ut]],
    ut,
    `
  ${mu} x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);`,
  );
  const random = fn(
    "cinematicRandom",
    [["seed", ut]],
    ft,
    `
  return ${ft}(cinematicHash(seed) >> 8u) * (1.0 / 16777216.0);`,
  );
  const seed = fn(
    "cinematicPixelSeed",
    [["pixel", v2]],
    ut,
    `
  return cinematicHash(${ut}(pixel.x) ^ (${ut}(pixel.y) * 0x9e3779b1u) ^
    (${ut}(${lane(10)}.w) * 0x85ebca6bu));`,
  );
  const phase = fn(
    "cinematicPhase",
    [
      ["cosine", ft],
      ["g", ft],
    ],
    ft,
    `
  ${f} magnitude = abs(g);
  ${f} aligned = ${choose("cosine", "-cosine", "g < 0.0")};
  ${f} denominator = (1.0 - magnitude) * (1.0 - magnitude) +
    2.0 * magnitude * (1.0 - clamp(aligned, -1.0, 1.0));
  return ((1.0 - magnitude) * (1.0 + magnitude)) /
    (12.566370614359172 * pow(denominator, 1.5));`,
  );
  const interval = fn(
    "cinematicInterval",
    [
      ["ro", v3],
      ["rd", v3],
      ["far", ft],
    ],
    v2,
    `
  ${c4} medium = ${lane(7)};
  ${c3} offset = ro - medium.xyz;
  ${f} along = dot(offset, rd);
  ${f} disc = along * along - dot(offset, offset) + medium.w * medium.w;
  if (!(disc > 0.0) || !(medium.w > 0.0) || !(far >= 0.0)) { return ${v2}(0.0); }
  ${f} root = sqrt(disc);
  ${f} start = max(0.0, -along - root);
  return ${v2}(start, max(start, min(far, -along + root)));`,
  );
  const lightTransmission = fn(
    "cinematicLightTransmission",
    [
      ["startP", v3],
      ["endP", v3],
    ],
    ft,
    `
  ${f} density = ${lane(8)}.w;
  if (density == 0.0) { return 1.0; }
  ${c3} delta = endP - startP;
  ${f} distance = length(delta);
  if (distance == 0.0) { return 1.0; }
  ${c2} segment = cinematicInterval(startP, delta / distance, distance);
  return exp(-density * (segment.y - segment.x));`,
  );
  const cameraTransmission = fn(
    "cinematicTransmission",
    [
      ["ro", v3],
      ["rd", v3],
      ["far", ft],
    ],
    ft,
    `
  ${f} density = ${lane(8)}.w;
  if (density == 0.0) { return 1.0; }
  ${c2} segment = cinematicInterval(ro, rd, far);
  return exp(-density * (segment.y - segment.x));`,
  );
  const visibility = fn(
    "cinematicVisibility",
    [
      ["startP", v3],
      ["endP", v3],
      ["workIndex", it],
    ],
    ft,
    `
  if (cinematicPlaneBlocked(startP, endP)) { return 0.0; }
  ${c3} delta = endP - startP;
  ${f} distance = length(delta);
  if (distance == 0.0) { return 1.0; }
  ${c3} direction = delta / distance;
  ${c2} interval = cinematicVisibilityInterval(startP, endP);
  ${f} end = min(distance, interval.y);
  ${mv} t = max(0.0, interval.x);
  if (t >= end) { return 1.0; }
  for (${mi} step = 0; step < ${SURFACE_LIGHTING_MAX_SHADOW_STEPS}; step++) {
    if (step >= ${it}(${lane(10)}.z)) { break; }
    ${f} d = cinematicDE(startP + direction * t, workIndex);
    if (!(d >= 0.0) || d > 1.0e30) {
      if (!(d < 0.0)) { cinematicVisibilityInvalid += 1.0; }
      return 0.0;
    }
    ${f} stride = d * cinematicStepScale();
    if (stride >= end - t) { return 1.0; }
    if (d <= ${lane(9)}.w) { return 0.0; }
    if (!(t + stride > t)) { cinematicVisibilityInvalid += 1.0; return 0.0; }
    t += stride;
  }
  cinematicVisibilityExhausted += 1.0;
  return 0.0;`,
  );
  const disk = fn(
    "cinematicDisk",
    [
      ["light", it],
      ["index", it],
      ["seed", ut],
    ],
    v3,
    `
  ${c4} position = ${lane("light * 3")};
  ${c3} normal = ${lane("light * 3 + 1")}.xyz;
  ${c3} axis = ${choose(`${v3}(1.0, 0.0, 0.0)`, `${v3}(0.0, 1.0, 0.0)`, "abs(normal.y) < 0.9")};
  ${c3} tangent = normalize(cross(normal, axis));
  ${c3} bitangent = cross(normal, tangent);
  ${u} salt = seed ^ cinematicHash(${ut}(index + 1));
  ${f} radius = position.w * sqrt(cinematicRandom(salt));
  ${f} angle = 6.283185307179586 * cinematicRandom(salt ^ 0x63d83595u);
  return position.xyz + radius * (cos(angle) * tangent + sin(angle) * bitangent);`,
  );
  const surface = fn(
    "cinematicSurface",
    [
      ["pos", v3],
      ["n", v3],
      ["rd", v3],
      ["baseEncoded", v3],
      ["fa", v4],
      ["fb", v4],
      ["backgroundLinear", v3],
      ["pixel", v2],
      ["workIndex", it],
    ],
    v3,
    `
  ${c3} base = pow(max(baseEncoded, ${v3}(0.0)), ${v3}(2.2));
  ${b} classic = fa.x == 0.4 && fa.y == 32.0 && fa.z == 0.0 &&
    fa.w == 0.0 && fb.x == 0.0 && fb.y == 1.0;
  ${f} specular = ${choose("fa.x", `${lane(6)}.w`, "classic")};
  ${f} exponent = ${choose("fa.y", `2.0 / (${lane(9)}.y * ${lane(9)}.y) - 2.0`, "classic")};
  ${f} diffuseWeight = ${choose("1.0", "1.0 - specular", "classic")};
  ${c3} metalTint = mix(${v3}(1.0), base, fa.z * fb.y);
  ${m3} color = base * ${lane(6)}.xyz * (1.0 - fa.z);
  ${c3} origin = pos + n * (${lane(9)}.w * 4.0);
  ${u} seed = cinematicPixelSeed(pixel);
  for (${mi} light = 0; light < 2; light++) {
    if (light >= ${it}(${lane(9)}.z)) { break; }
    ${c4} emitter = ${lane("light * 3 + 1")};
    if (emitter.w == 0.0) { continue; }
    for (${mi} smp = 0; smp < ${SURFACE_LIGHTING_MAX_SURFACE_SAMPLES}; smp++) {
      if (smp >= ${it}(${lane(10)}.x)) { break; }
      ${c3} source = cinematicDisk(light, smp, seed ^ cinematicHash(${ut}(light + 1)));
      ${c3} delta = source - pos;
      ${f} distance2 = dot(delta, delta);
      if (distance2 <= 1.0e-20) { continue; }
      ${c3} wi = delta / sqrt(distance2);
      ${f} cosine = max(0.0, dot(n, wi));
      ${f} emitterCosine = max(0.0, -dot(emitter.xyz, wi));
      if (cosine == 0.0 || emitterCosine == 0.0) { continue; }
      ${f} visible = cinematicVisibility(origin, source, workIndex);
      if (visible == 0.0) { continue; }
      ${f} highlight = specular * (exponent + 2.0) *
        pow(max(0.0, -dot(reflect(-wi, n), rd)), exponent) / 6.283185307179586;
      ${f} weight = emitter.w * emitterCosine * cosine * visible *
        cinematicLightTransmission(pos, source) /
        (3.141592653589793 * distance2 * ${lane(10)}.x);
      color += ${lane("light * 3 + 2")}.xyz * weight *
        (base * (diffuseWeight * (1.0 - fa.z) / 3.141592653589793) + metalTint * highlight);
    }
  }
  color += cinematicEnvironment(pos, n, rd, baseEncoded, fa, fb);
  ${f} f0 = mix(0.04, 1.0, fa.z);
  ${f} fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
  return mix(color, backgroundLinear, fb.x * (1.0 - fresnel));`,
  );
  // Shader builtins lack expm1/log1p. Short series avoid cancellation at
  // tiny optical depths; this is an approximation to the CPU reference's
  // exact functions, bounded tightly at the 0.01 switch.
  const mass = fn(
    "cinematicCellMass",
    [["x", ft]],
    ft,
    `
  if (x < 0.01) { return x * (1.0 - x * (0.5 - x * (1.0 / 6.0 - x / 24.0))); }
  return 1.0 - exp(-x);`,
  );
  const log = fn(
    "cinematicNegLogOneMinus",
    [["x", ft]],
    ft,
    `
  if (x < 0.01) { return x * (1.0 + x * (0.5 + x * (1.0 / 3.0 + x * 0.25))); }
  return -log(1.0 - x);`,
  );
  const mediumCell = fn(
    "cinematicMediumCell",
    [
      ["ro", v3],
      ["rd", v3],
      ["far", ft],
      ["pixel", v2],
      ["cell", it],
      ["workIndex", it],
    ],
    v3,
    `
  ${f} density = ${lane(8)}.w;
  ${f} cells = ${lane(10)}.y;
  if (density == 0.0 || cells < 1.0 || cell >= ${it}(cells)) { return ${v3}(0.0); }
  ${c2} segment = cinematicInterval(ro, rd, far);
  ${f} width = (segment.y - segment.x) / cells;
  if (width <= 0.0) { return ${v3}(0.0); }
  ${f} mass = cinematicCellMass(density * width);
  ${u} seed = cinematicPixelSeed(pixel);
  ${f} random = cinematicRandom(seed ^ cinematicHash(${ut}(cell) + 0xb5297a4du));
  ${f} start = segment.x + ${ft}(cell) * width;
  ${f} t = start + cinematicNegLogOneMinus(random * mass) / density;
  ${c3} p = ro + rd * t;
  ${f} cameraWeight = exp(-density * (start - segment.x)) * mass;
  ${m3} color = ${v3}(0.0);
  for (${mi} light = 0; light < 2; light++) {
    if (light >= ${it}(${lane(9)}.z)) { break; }
    if (${lane(11)}.w >= 0.0 && light != ${it}(${lane(11)}.w)) { continue; }
    ${c4} emitter = ${lane("light * 3 + 1")};
    if (emitter.w == 0.0) { continue; }
    ${c3} source = cinematicDisk(light, cell,
      seed ^ cinematicHash(${ut}(light + 1)) ^ 0x10000u);
    ${c3} delta = source - p;
    ${f} distance2 = dot(delta, delta);
    if (distance2 <= 1.0e-20) { continue; }
    ${c3} wi = delta / sqrt(distance2);
    ${f} emitterCosine = max(0.0, -dot(emitter.xyz, wi));
    if (emitterCosine == 0.0) { continue; }
    ${f} visible = cinematicVisibility(p, source, workIndex);
    if (visible == 0.0) { continue; }
    ${f} weight = cameraWeight * emitter.w * emitterCosine * visible *
      cinematicLightTransmission(p, source) * cinematicPhase(dot(wi, rd), ${lane(9)}.x) /
      (3.141592653589793 * distance2);
    color += ${lane("light * 3 + 2")}.xyz * ${lane(8)}.xyz * weight;
  }
  return color;`,
  );
  const medium = fn(
    "cinematicMedium",
    [
      ["ro", v3],
      ["rd", v3],
      ["far", ft],
      ["terminalLinear", v3],
      ["pixel", v2],
      ["workIndex", it],
    ],
    v3,
    `
  if (${lane(8)}.w == 0.0) { return terminalLinear; }
  ${m3} color = terminalLinear * cinematicTransmission(ro, rd, far);
  for (${mi} cell = 0; cell < ${SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES}; cell++) {
    if (cell >= ${it}(${lane(10)}.y)) { break; }
    color += cinematicMediumCell(ro, rd, far, pixel, cell, workIndex);
  }
  return color;`,
  );
  // Every math body above is shared; only declarations, casts and field
  // access differ between the two emitted shader dialects.
  return (
    def +
    hash +
    random +
    seed +
    phase +
    interval +
    lightTransmission +
    cameraTransmission +
    visibility +
    disk +
    surface +
    mass +
    log +
    mediumCell +
    medium
  );
}
