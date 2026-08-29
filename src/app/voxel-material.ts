import * as THREE from "three";
import {
  BACKGROUND_SHAPE_GLSL,
  backgroundShapeSource,
} from "../fractal/background-shape";
import { BALLOON_FAR_CAP_RHO } from "../fractal/balloon-de";
import type { Vec3 } from "../fractal/types";
export { sampleVoxelAlpha } from "../fractal/voxel-raymarch";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";

/**
 * The solid render's GPU raymarcher: a full-screen-quad
 * ShaderMaterial that marches camera rays through the chaos game's packed
 * density volume (`voxelTextureData` → `Data3DTexture`) and shades the
 * log-density isosurface like a raytraced solid — gradient normals, one hard
 * shadow ray per hit toward a directional light, density-sampled ambient
 * occlusion, Lambert diffuse + Blinn-Phong specular. Rays that miss paint
 * the same dark gradient backdrop as the explorer, so the mode reads as the
 * same scene, solidified.
 *
 * Kept in its own module so `scene.ts` stays the wiring layer: everything
 * GLSL lives here, everything camera/texture lives there. GLSL3 because
 * `sampler3D` requires it; Three injects the built-in vertex attributes and
 * matrix uniforms for GLSL3 ShaderMaterials automatically.
 *
 * DELIBERATELY NOT ENVIRONMENT-LIT (the environment-lit shading work scoped
 * it out): the surface tracers (`surface-material.ts` / `-4d.ts`) and their
 * WGSL mirror (`fractal/surface-de-gpu.ts`) tint the WHOLE lit term toward
 * the backdrop sampled along the shading normal, so those renders sit IN
 * their background; this raymarcher's `uAmbient` blend below stays a plain
 * scalar. That leaves the solid render as the one mode still floating in
 * front of its backdrop — a known, accepted gap, not an oversight a future
 * reader should "fix" by copying the tint in without a bead behind it.
 *
 * The miss-pixel gradient shares its shape with every other tracer:
 * `backgroundShapeT`, spliced in from `../fractal/background-shape.ts`, is
 * the one place that shape is defined — this module only supplies the two
 * stops and the pixel's full-image UV. The flame backdrop is the one
 * non-gradient source: `uBgImageOn` switches the same full-image UV to the
 * scene's immutable, blurred flame texture. Keeping that branch here is
 * necessary because Solid shades directly to the canvas rather than going
 * through Surface's retained-background compositor.
 */

/** Screen-space gradient the raymarcher paints on a miss — the same authored
 * sRGB stops as `scene.ts`'s `darkBackground` (both read `DARK_BACKDROP`), so
 * entering the mode doesn't visibly swap backdrops. Parsed with the pure
 * helper, not `new THREE.Color(hex)`: this module evaluates before scene.ts
 * disables ColorManagement, and the string constructor would linearize. */
const BG_TOP = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.top));
const BG_BOTTOM = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.bottom));

const VOXEL_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOXEL_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsSize;
  /** One voxel, in texture space (1 / gridSize). */
  uniform float uTexel;
  /** Isosurface level on the log-normalized density in [0, 1]. */
  uniform float uThreshold;
  /** Unit vector pointing from surfaces TOWARD the light. */
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform vec3 uCamPos;
  uniform mat4 uInvProjView;
  uniform vec3 uBgTop;
  uniform vec3 uBgBottom;
  /** Backdrop gradient SHAPE: mirrors the surface tracers'
   * uBgShape/uBgCenter/uBgScale — see surface-material.ts. */
  uniform int uBgShape;
  uniform vec2 uBgCenter;
  uniform vec2 uBgScale;
  /** Per-pixel flame backdrop. uBgImageOn == 0 is the shipped gradient
   * path byte-for-expression; the sampler is then bound but never read. */
  uniform sampler2D uBgImage;
  uniform int uBgImageOn;
  /** Primary march step count, scaled with the bound grid so the stride
   * stays ~1.16 voxels (see marchStepsForGrid). */
  uniform int uMarchSteps;
  /** Depth-fog density multiplier: scales the fog distance unit,
   * mirroring the surface tracers' uFogDensity — 1 is the neutral default,
   * 0 disables depth fog. */
  uniform float uFogDensity;
  /** Fog tint: what the depth fog blends toward is
   * mix(background, uFogTint, uFogTintStrength), mirroring the surface
   * tracers' uFogTint — strength 0 (the default) is a bit-exact
   * identity, the pre-tint fog toward the pixel's own backdrop color.
   * scene.setFogTint keeps both current. */
  uniform vec3 uFogTint;
  uniform float uFogTintStrength;

  in vec2 vUv;
  out vec4 outColor;

  const int REFINE_STEPS = 5;
  const int SHADOW_STEPS = 48;

  float densityAt(vec3 p) {
    return texture(uVolume, (p - uBoundsMin) / uBoundsSize).a;
  }

  vec3 colorAt(vec3 p) {
    return texture(uVolume, (p - uBoundsMin) / uBoundsSize).rgb;
  }

  /** Slab-method ray/AABB intersection; x = near t, y = far t (miss: x > y). */
  vec2 boxIntersect(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uBoundsMin - ro) * inv;
    vec3 t1 = (uBoundsMin + uBoundsSize - ro) * inv;
    vec3 tMin = min(t0, t1);
    vec3 tMax = max(t0, t1);
    return vec2(
      max(max(tMin.x, tMin.y), tMin.z),
      min(min(tMax.x, tMax.y), tMax.z)
    );
  }

  /** Per-pixel dither so the fixed march stride doesn't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /** Density gradient by central differences, one voxel apart — points
   * toward higher density (the inside), so the surface normal is its
   * negation. */
  vec3 densityGradient(vec3 p, vec3 eps) {
    return vec3(
      densityAt(p + vec3(eps.x, 0.0, 0.0)) - densityAt(p - vec3(eps.x, 0.0, 0.0)),
      densityAt(p + vec3(0.0, eps.y, 0.0)) - densityAt(p - vec3(0.0, eps.y, 0.0)),
      densityAt(p + vec3(0.0, 0.0, eps.z)) - densityAt(p - vec3(0.0, 0.0, eps.z))
    );
  }

  ${backgroundShapeSource(BACKGROUND_SHAPE_GLSL)}
  void main() {
    // Shared shape at full-image coordinates; see surface-material.ts.
    vec3 background = uBgImageOn == 1
      ? texture(uBgImage, vUv).rgb
      : mix(uBgBottom, uBgTop, backgroundShapeT(vUv));

    // Reconstruct the camera ray by unprojecting this pixel on the near and
    // far clip planes.
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 nearP = uInvProjView * vec4(ndc, -1.0, 1.0);
    vec4 farP = uInvProjView * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    vec3 ro = uCamPos;

    vec2 tRange = boxIntersect(ro, rd);
    float tFar = tRange.y;
    float t = max(tRange.x, 0.0);
    if (tRange.x > tRange.y || tFar <= 0.0) {
      outColor = vec4(background, 1.0);
      return;
    }

    float dt = (tFar - t) / float(uMarchSteps);
    t += dt * hash(gl_FragCoord.xy);

    // --- primary march: first sample past the isosurface -------------------
    float tPrev = t;
    bool hit = false;
    for (int i = 0; i < uMarchSteps; i++) {
      if (densityAt(ro + rd * t) > uThreshold) {
        hit = true;
        break;
      }
      tPrev = t;
      t += dt;
    }
    if (!hit) {
      outColor = vec4(background, 1.0);
      return;
    }

    // --- refine: bisect between the last outside and first inside samples --
    float lo = tPrev;
    float hi = t;
    for (int i = 0; i < REFINE_STEPS; i++) {
      float mid = (lo + hi) * 0.5;
      if (densityAt(ro + rd * mid) > uThreshold) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    vec3 pos = ro + rd * hi;

    // --- shade --------------------------------------------------------------
    vec3 eps = uBoundsSize * uTexel;
    vec3 grad = densityGradient(pos, eps);
    // A hit with a vanishing gradient (flat interior plateau) still needs
    // SOME normal; face the camera rather than dividing by ~zero.
    vec3 n = dot(grad, grad) > 1e-12 ? normalize(-grad) : -rd;

    // Sample color slightly inside the surface: the running-mean color of
    // empty neighbor voxels is black, and trilinear filtering right at the
    // isosurface blends toward it — one voxel inward reads the structure's
    // true color instead of a darkened rim.
    float inset = (eps.x + eps.y + eps.z) / 3.0;
    vec3 base = colorAt(pos - n * inset);

    // Hard shadow ray: march from just off the surface toward the light; any
    // above-threshold sample occludes.
    float shadow = 1.0;
    vec3 sp = pos + n * inset * 1.5;
    float shadowStep = inset * 1.5;
    for (int i = 0; i < SHADOW_STEPS; i++) {
      sp += uLightDir * shadowStep;
      vec3 uvw = (sp - uBoundsMin) / uBoundsSize;
      if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
        break; // left the volume: reached the light.
      }
      if (texture(uVolume, uvw).a > uThreshold) {
        shadow = 0.0;
        break;
      }
    }

    // Ambient occlusion: nearby density along the normal darkens crevices.
    float occlusion = 0.0;
    for (int k = 1; k <= 4; k++) {
      occlusion += densityAt(pos + n * inset * float(k) * 1.5);
    }
    float ao = clamp(1.0 - occlusion * 0.35, 0.0, 1.0);

    float diffuse = max(dot(n, uLightDir), 0.0);
    vec3 halfVec = normalize(uLightDir - rd);
    float specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;

    // Plain scalar ambient, deliberately NOT environment-tinted (the
    // solid render was scoped out — see the module doc).
    float lit = uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow;
    // Light in linear space: base is sRGB-authored (color.ts), so
    // decode with gamma 2.2, apply the light/specular product there, and
    // re-encode for the pass-through canvas (ColorManagement is off). A fully
    // lit, specular-free surface round-trips to base verbatim — the authored-
    // color invariant the rest of the app keeps — while midtones and shadows
    // are no longer crushed ~2x by scaling the gamma encoding itself.
    vec3 linBase = pow(base, vec3(2.2));
    vec3 col = pow(linBase * lit + vec3(specular * shadow), vec3(1.0 / 2.2));

    // Depth fog toward the backdrop: squared-exponential in the
    // distance traveled inside the volume box, mirroring the surface
    // tracers' fog term (surface-material.ts) — same -0.12 constant, with
    // the box's half-diagonal standing in for the bounding sphere's
    // visible radius and the box entry for the sphere-entry fog origin —
    // so one Fog slider value reads the same across solid and surface.
    float fogR = 0.5 * length(uBoundsSize);
    float fog = 1.0 -
      exp(-0.12 * pow((hi - max(tRange.x, 0.0)) * uFogDensity / max(fogR, 1.0e-6), 2.0));
    col = mix(col, mix(background, uFogTint, uFogTintStrength), clamp(fog, 0.0, 1.0));

    outColor = vec4(col, 1.0);
  }
`;

/**
 * The solid echo's measured density multiplier. Unlike the additive Points
 * echo, a lit isosurface does not need a brightness reduction: lowering this
 * value changes which density contour is geometry rather than merely dimming
 * it. The production preset sweep recorded in docs/architecture.md therefore
 * keeps the source field's exact threshold at weight 1.
 */
export const SOLID_BALLOON_ECHO_WEIGHT = 1;

/** Hard safety ceiling for a very distant camera. The ordinary balloon pose
 * stays far below it; without a ceiling an extreme zoom-out could turn one
 * synchronous full-screen draw into an effectively unbounded shader loop. */
const SOLID_BALLOON_MAX_MARCH_STEPS = 8192;

/** Replace one exact fragment-source seam, failing at module evaluation if a
 * future shader edit silently removes or duplicates the seam. The off program
 * remains the literal {@link VOXEL_FRAGMENT}; only the on variant is spliced. */
function spliceVoxelBalloon(
  source: string,
  seam: string,
  replacement: string,
): string {
  const at = source.indexOf(seam);
  if (at < 0 || source.indexOf(seam, at + seam.length) >= 0) {
    throw new Error("Voxel balloon shader seam is missing or ambiguous");
  }
  return source.slice(0, at) + replacement + source.slice(at + seam.length);
}

/**
 * Build the query-space balloon arm over the unchanged density texture.
 *
 * Deliberately a program variant, not an always-live uniform branch: when the
 * echo is absent/off, `voxelFragmentFor(false)` returns the exact shader source
 * that shipped before this feature. The on arm samples the SAME finite volume
 * at p and I(p); growing or duplicating the grid would spend its resolution on
 * the inversion's mostly-empty far field and is specifically not this design.
 */
function buildVoxelBalloonFragment(): string {
  let source = VOXEL_FRAGMENT;
  source = spliceVoxelBalloon(
    source,
    "  uniform float uFogTintStrength;\n",
    `  uniform float uFogTintStrength;
  // Query-space balloon: one fixed volume, sampled at p and I(p). These
  // uniforms exist only in this resolved program; the off source is exact.
  uniform vec3 uBalloonCenter;
  uniform float uBalloonRawRadius;
  uniform float uBalloonR;
  uniform float uBalloonRho;
  uniform float uBalloonFar;
  uniform vec3 uBalloonTint;
  uniform float uBalloonTintStrength;
  uniform sampler2D uBalloonColorLUT;
  uniform float uBalloonPaletteEnabled;
`,
  );
  source = spliceVoxelBalloon(
    source,
    `  float densityAt(vec3 p) {
    return texture(uVolume, (p - uBoundsMin) / uBoundsSize).a;
  }

  vec3 colorAt(vec3 p) {
    return texture(uVolume, (p - uBoundsMin) / uBoundsSize).rgb;
  }
`,
    `  // ClampToEdge is correct sampler state for the ordinary box march, but
  // WRONG for an inverted query: outside the finite source volume means zero,
  // not a boundary voxel smeared across the shell. Check before every read.
  vec4 boundedVolumeSample(vec3 p) {
    vec3 uvw = (p - uBoundsMin) / uBoundsSize;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
      return vec4(0.0);
    }
    return texture(uVolume, uvw);
  }

  vec3 balloonInvert(vec3 p) {
    vec3 d = p - uBalloonCenter;
    float floorRadius = 1.0e-6 * uBalloonRho;
    float r2 = max(dot(d, d), floorRadius * floorRadius);
    return uBalloonCenter + (uBalloonR * uBalloonR / r2) * d;
  }

  float densityAtFractal(vec3 p) {
    return boundedVolumeSample(p).a;
  }

  float densityAtEcho(vec3 p) {
    return ${SOLID_BALLOON_ECHO_WEIGHT.toFixed(1)} *
      boundedVolumeSample(balloonInvert(p)).a;
  }

  float densityAt(vec3 p) {
    float primary = densityAtFractal(p);
    float echo = densityAtEcho(p);
    return max(primary, echo);
  }

  vec3 colorAt(vec3 p) {
    vec4 primary = boundedVolumeSample(p);
    vec3 source = balloonInvert(p);
    vec4 echo = boundedVolumeSample(source);
    // Same attribution as balloon-de.ts: a strict win selects the shell;
    // ties stay on the primary fractal term.
    if (${SOLID_BALLOON_ECHO_WEIGHT.toFixed(1)} * echo.a > primary.a) {
      vec3 base = echo.rgb;
      if (uBalloonPaletteEnabled > 0.5) {
        float paletteT = clamp(
          length(source - uBalloonCenter) / uBalloonRho,
          0.0,
          1.0
        );
        float paletteIndex = min(floor(paletteT * 256.0), 255.0);
        float paletteU = (paletteIndex + 0.5) / 256.0;
        base = texture(uBalloonColorLUT, vec2(paletteU, 0.5)).rgb;
      }
      return mix(base, uBalloonTint, uBalloonTintStrength);
    }
    return primary.rgb;
  }
`,
  );
  source = spliceVoxelBalloon(
    source,
    `    vec2 tRange = boxIntersect(ro, rd);
    float tFar = tRange.y;
    float t = max(tRange.x, 0.0);
    if (tRange.x > tRange.y || tFar <= 0.0) {
      outColor = vec4(background, 1.0);
      return;
    }

    float dt = (tFar - t) / float(uMarchSteps);
    t += dt * hash(gl_FragCoord.xy);

    // --- primary march: first sample past the isosurface -------------------
    float tPrev = t;
    bool hit = false;
    for (int i = 0; i < uMarchSteps; i++) {
      if (densityAt(ro + rd * t) > uThreshold) {
        hit = true;
        break;
      }
      tPrev = t;
      t += dt;
    }
    if (!hit) {
      outColor = vec4(background, 1.0);
      return;
    }

    // --- refine: bisect between the last outside and first inside samples --
    float lo = tPrev;
    float hi = t;
    for (int i = 0; i < REFINE_STEPS; i++) {
      float mid = (lo + hi) * 0.5;
      if (densityAt(ro + rd * mid) > uThreshold) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    vec3 pos = ro + rd * hi;
`,
    `    float jitter = hash(gl_FragCoord.xy);

    // Keep the original primary AABB interval, step count, jitter phase, and
    // source sample: enabling a union must never erase a thin source hit by
    // stretching its phase over the much longer echo interval. The echo gets
    // its own march; the earlier refined hit is exactly the first hit of
    // max(primary, echo).
    vec2 tRange = boxIntersect(ro, rd);
    float primaryFar = tRange.y;
    float primaryT = max(tRange.x, 0.0);
    float primaryPrev = primaryT;
    float primaryHi = 1.0e30;
    bool primaryHit = false;
    if (tRange.x <= tRange.y && primaryFar > 0.0) {
      float primaryDt = (primaryFar - primaryT) / float(uMarchSteps);
      primaryT += primaryDt * jitter;
      primaryPrev = primaryT;
      for (int i = 0; i < uMarchSteps; i++) {
        if (densityAtFractal(ro + rd * primaryT) > uThreshold) {
          primaryHit = true;
          break;
        }
        primaryPrev = primaryT;
        primaryT += primaryDt;
      }
      if (primaryHit) {
        float primaryLo = primaryPrev;
        primaryHi = primaryT;
        for (int i = 0; i < REFINE_STEPS; i++) {
          float mid = (primaryLo + primaryHi) * 0.5;
          if (densityAtFractal(ro + rd * mid) > uThreshold) {
            primaryHi = mid;
          } else {
            primaryLo = mid;
          }
        }
      }
    }

    // The echo can sit outside the source AABB, so march from the camera to
    // the same BALLOON_FAR_CAP_RHO horizon as the Surface arm. Increasing the
    // echo-only step count preserves the grid's face-on world stride without
    // paying an inversion or second texture query in the legacy primary loop.
    float tFar = length(ro - uBalloonCenter) + uBalloonFar;
    float baseSpan = max(max(uBoundsSize.x, uBoundsSize.y), uBoundsSize.z);
    int marchSteps = min(
      ${String(SOLID_BALLOON_MAX_MARCH_STEPS)},
      max(uMarchSteps, int(ceil(tFar * float(uMarchSteps) / max(baseSpan, 1.0e-6))))
    );
    float dt = tFar / float(marchSteps);
    float t = dt * jitter;
    float tPrev = t;
    float echoHi = 1.0e30;
    bool echoHit = false;
    for (int i = 0; i < marchSteps; i++) {
      if (densityAtEcho(ro + rd * t) > uThreshold) {
        echoHit = true;
        break;
      }
      tPrev = t;
      t += dt;
    }
    if (echoHit) {
      float echoLo = tPrev;
      echoHi = t;
      for (int i = 0; i < REFINE_STEPS; i++) {
        float mid = (echoLo + echoHi) * 0.5;
        if (densityAtEcho(ro + rd * mid) > uThreshold) {
          echoHi = mid;
        } else {
          echoLo = mid;
        }
      }
    }
    if (!primaryHit && !echoHit) {
      outColor = vec4(background, 1.0);
      return;
    }
    float hi = min(primaryHi, echoHi);
    vec3 pos = ro + rd * hi;

    // Fog still begins at the source ball (or at closest approach on a ray
    // that misses it), continuous across its silhouette like Surface.
    vec3 ballRo = ro - uBalloonCenter;
    float ballB = dot(ballRo, rd);
    float ballC = dot(ballRo, ballRo) - uBalloonRawRadius * uBalloonRawRadius;
    float ballDisc = ballB * ballB - ballC;
    float tEnter = max(
      -ballB - (ballDisc >= 0.0 ? sqrt(ballDisc) : 0.0),
      0.0
    );
`,
  );
  source = spliceVoxelBalloon(
    source,
    `    // Hard shadow ray: march from just off the surface toward the light; any
    // above-threshold sample occludes.
    float shadow = 1.0;
    vec3 sp = pos + n * inset * 1.5;
    float shadowStep = inset * 1.5;
    for (int i = 0; i < SHADOW_STEPS; i++) {
      sp += uLightDir * shadowStep;
      vec3 uvw = (sp - uBoundsMin) / uBoundsSize;
      if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
        break; // left the volume: reached the light.
      }
      if (texture(uVolume, uvw).a > uThreshold) {
        shadow = 0.0;
        break;
      }
    }
`,
    `    // The shell receives shadows but never casts them: intersect its
    // light ray with the ORIGINAL volume and sample only the fractal density.
    // Starting an exterior shell hit with the old "leave box => lit" loop
    // would never reach the attractor and could not paint its shadow.
    float shadow = 1.0;
    vec3 sp = pos + n * inset * 1.5;
    vec2 shadowRange = boxIntersect(sp, uLightDir);
    float shadowNear = max(shadowRange.x, 0.0);
    if (shadowNear <= shadowRange.y && shadowRange.y > 0.0) {
      float shadowStep = (shadowRange.y - shadowNear) / float(SHADOW_STEPS);
      float shadowT = shadowNear + shadowStep * 0.5;
      for (int i = 0; i < SHADOW_STEPS; i++) {
        if (densityAtFractal(sp + uLightDir * shadowT) > uThreshold) {
          shadow = 0.0;
          break;
        }
        shadowT += shadowStep;
      }
    }
`,
  );
  source = spliceVoxelBalloon(
    source,
    `    // Depth fog toward the backdrop: squared-exponential in the
    // distance traveled inside the volume box, mirroring the surface
    // tracers' fog term (surface-material.ts) — same -0.12 constant, with
    // the box's half-diagonal standing in for the bounding sphere's
    // visible radius and the box entry for the sphere-entry fog origin —
    // so one Fog slider value reads the same across solid and surface.
    float fogR = 0.5 * length(uBoundsSize);
    float fog = 1.0 -
      exp(-0.12 * pow((hi - max(tRange.x, 0.0)) * uFogDensity / max(fogR, 1.0e-6), 2.0));
`,
    `    // Balloon hits can precede the source-ball fog origin; clamp them to
    // a zero fog distance, and use the existing box half-diagonal as Solid's
    // distance unit so the Fog control retains its established scale.
    tEnter = min(tEnter, hi);
    float fogR = 0.5 * length(uBoundsSize);
    float fog = 1.0 -
      exp(-0.12 * pow((hi - tEnter) * uFogDensity / max(fogR, 1.0e-6), 2.0));
`,
  );
  return source;
}

const VOXEL_BALLOON_FRAGMENT = buildVoxelBalloonFragment();

/** Resolved shader source. `false` is the pre-feature source byte for byte. */
export function voxelFragmentFor(balloon: boolean): string {
  return balloon ? VOXEL_BALLOON_FRAGMENT : VOXEL_FRAGMENT;
}

/** The live uniform block for the Solid query-space balloon. */
export interface VoxelBalloonSpec {
  center: Vec3;
  /** Raw, unmargined enclosing-ball radius. */
  radius: number;
  /** Margined source radius used by the palette coordinate/f32 floor. */
  rho: number;
  /** Authored inversion radius in world units. */
  R: number;
}

/** A 1x1x1 fully-transparent placeholder volume, so the material is complete
 * (and compiled) before the worker's first real grid arrives. */
export function emptyVoxelTexture(): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  configureVoxelTexture(texture);
  return texture;
}

/** The sampler state every uploaded volume needs: trilinear filtering (the
 * raymarcher's refinement and gradients rely on smooth interpolation) and
 * edge clamping (ordinary in-box taps must not wrap to the far side). The
 * balloon arm explicitly returns zero BEFORE sampling an out-of-box query;
 * ClampToEdge by itself would smear boundary voxels across the echo. */
export function configureVoxelTexture(texture: THREE.Data3DTexture): void {
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
}

/** Unit vector toward a light at the given horizontal angle and height above
 * the horizon (both degrees) — the app-facing parametrization of uLightDir. */
export function lightDirection(
  azimuthDeg: number,
  elevationDeg: number,
): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  ).normalize();
}

/**
 * Primary march step count for a `gridSize`³ density volume. 220 steps was
 * tuned for 256³ (≈1.16 voxels per stride on a face-on ray, 256/220);
 * scaling with the grid keeps that stride at larger grids (512³ → 440 steps
 * ≈ 1.16 voxels/stride) so shells thinner than a stride aren't skipped
 * between refine hits. The 220 floor means grids at or below 256³ render
 * exactly as before — never coarser than the tuned baseline. The cost is
 * deliberate: per-pixel march work scales with resolution exactly on the
 * machines that opted into big grids.
 */
export function marchStepsForGrid(gridSize: number): number {
  return Math.max(220, Math.ceil((gridSize * 220) / 256));
}

/** True exactly while the inverted density at infinity stays below the live
 * isosurface. Equality is safe because the shader's hit test is strict `>`. */
export function solidBalloonCenterIsEmpty(
  centerAlpha: number,
  threshold: number,
): boolean {
  return SOLID_BALLOON_ECHO_WEIGHT * centerAlpha <= threshold;
}

/** Install/clear the query-space variant. Only an on/off transition rebuilds
 * the program; radius animation is uniform-only. */
export function setVoxelBalloon(
  material: THREE.ShaderMaterial,
  spec: VoxelBalloonSpec | null,
): void {
  const u = material.uniforms;
  const center = u.uBalloonCenter.value as THREE.Vector3;
  if (spec) {
    center.set(...spec.center);
    u.uBalloonRawRadius.value = spec.radius;
    u.uBalloonR.value = spec.R;
    u.uBalloonRho.value = spec.rho;
    u.uBalloonFar.value = BALLOON_FAR_CAP_RHO * spec.rho;
  } else {
    center.set(0, 0, 0);
    u.uBalloonRawRadius.value = 1;
    u.uBalloonR.value = 0;
    u.uBalloonRho.value = 1;
    u.uBalloonFar.value = 0;
  }
  const next = voxelFragmentFor(spec !== null);
  if (material.fragmentShader !== next) {
    material.fragmentShader = next;
    material.needsUpdate = true;
  }
}

/** Uniform-only shell tint; strength 0 is the authored-color identity. */
export function packVoxelBalloonTint(
  material: THREE.ShaderMaterial,
  tint: Vec3,
  strength: number,
): void {
  (material.uniforms.uBalloonTint.value as THREE.Vector3).set(...tint);
  material.uniforms.uBalloonTintStrength.value = strength;
}

/** Uniform-only independent balloon gradient. Null means inherit the sampled
 * source voxel's RGB exactly. */
export function packVoxelBalloonPalette(
  material: THREE.ShaderMaterial,
  texture: THREE.DataTexture | null,
): void {
  if (texture) material.uniforms.uBalloonColorLUT.value = texture;
  material.uniforms.uBalloonPaletteEnabled.value = texture ? 1 : 0;
}

export function createVoxelMaterial(
  volume: THREE.Data3DTexture,
  backgroundImage?: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uVolume: { value: volume },
      uBoundsMin: { value: new THREE.Vector3(-1, -1, -1) },
      uBoundsSize: { value: new THREE.Vector3(2, 2, 2) },
      uTexel: { value: 1 },
      uThreshold: { value: 0.3 },
      uLightDir: { value: lightDirection(135, 50) },
      uAmbient: { value: 0.25 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      uBgTop: { value: BG_TOP.clone() },
      uBgBottom: { value: BG_BOTTOM.clone() },
      // Linear defaults, matching the surface tracers.
      uBgShape: { value: 0 },
      uBgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uBgScale: { value: new THREE.Vector2(1, 1) },
      // Bound from construction so switching sources is one integer write;
      // scene.ts owns and repaints the CanvasTexture without replacing it.
      uBgImage: { value: backgroundImage ?? new THREE.Texture() },
      uBgImageOn: { value: 0 },
      // Matches the placeholder 1³ texture era; a real value arrives with
      // the first uploaded volume (setVoxelGrid → marchStepsForGrid).
      uMarchSteps: { value: 220 },
      uFogDensity: { value: 1 }, // scene.setFogDensity keeps it current.
      uFogTint: { value: new THREE.Vector3(1, 1, 1) },
      uFogTintStrength: { value: 0 }, // scene.setFogTint keeps both current.
      // Balloon uniforms are inert while the exact off source is installed.
      uBalloonCenter: { value: new THREE.Vector3() },
      uBalloonRawRadius: { value: 1 },
      uBalloonR: { value: 0 },
      uBalloonRho: { value: 1 },
      uBalloonFar: { value: 0 },
      uBalloonTint: { value: new THREE.Vector3() },
      uBalloonTintStrength: { value: 0 },
      uBalloonColorLUT: { value: new THREE.Texture() },
      uBalloonPaletteEnabled: { value: 0 },
    },
    vertexShader: VOXEL_VERTEX,
    fragmentShader: voxelFragmentFor(false),
    depthTest: false,
    depthWrite: false,
  });
}
