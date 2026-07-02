import * as THREE from "three";

/**
 * The solid render's GPU raymarcher (fr-v4f): a full-screen-quad
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
 */

/** Screen-space gradient the raymarcher paints on a miss — the same authored
 * sRGB stops as `scene.ts`'s `darkBackground` ("#0d0d18" top, "#1f2039"
 * bottom), so entering the mode doesn't visibly swap backdrops. */
const BG_TOP = new THREE.Vector3(0x0d / 255, 0x0d / 255, 0x18 / 255);
const BG_BOTTOM = new THREE.Vector3(0x1f / 255, 0x20 / 255, 0x39 / 255);

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

  in vec2 vUv;
  out vec4 outColor;

  const int MARCH_STEPS = 220;
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

  void main() {
    vec3 background = mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0));

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

    float dt = (tFar - t) / float(MARCH_STEPS);
    t += dt * hash(gl_FragCoord.xy);

    // --- primary march: first sample past the isosurface -------------------
    float tPrev = t;
    bool hit = false;
    for (int i = 0; i < MARCH_STEPS; i++) {
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

    float lit = uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow;
    vec3 col = base * lit + specular * shadow * vec3(1.0);

    outColor = vec4(col, 1.0);
  }
`;

/** A 1x1x1 fully-transparent placeholder volume, so the material is complete
 * (and compiled) before the worker's first real grid arrives. */
export function emptyVoxelTexture(): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  configureVoxelTexture(texture);
  return texture;
}

/** The sampler state every uploaded volume needs: trilinear filtering (the
 * raymarcher's refinement and gradients rely on smooth interpolation) and
 * edge clamping (samples just outside the grid must read as empty edge
 * voxels, not wrap to the far side of the attractor). */
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

export function createVoxelMaterial(
  volume: THREE.Data3DTexture,
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
    },
    vertexShader: VOXEL_VERTEX,
    fragmentShader: VOXEL_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}
