/**
 * GPU raymarching renderer (fr-yor): the Three.js half of the distance-estimator
 * render mode. A full-screen quad runs a fragment shader that sphere-traces a
 * Mandelbulb distance field per pixel and shades the surface with real lighting
 * (Lambert diffuse + a key directional light, soft shadows, DE-based ambient
 * occlusion, a specular highlight, and distance fog) — giving the fractal an
 * actual lit surface rather than the explorer's point cloud.
 *
 * This is deliberately the ONLY new home for Three.js in this feature (Three.js
 * otherwise lives in `scene.ts` / `interactions.ts`); `scene.ts` owns an
 * instance and drives it, exactly as it owns the flame quad. The GLSL
 * `mandelbulbDE` mirrors the CPU reference in `src/fractal/raymarch.ts` — keep
 * the two in sync; the reference is unit-tested so the shader has a pinned
 * target.
 *
 * Loops use a constant upper bound with a dynamic `break` against the uniform
 * budget (`uMaxSteps` / `uIterations`) — the portable idiom every WebGL
 * raymarcher uses, so the fixed loop counts (`MAX_MARCH_STEPS` /
 * `MAX_DE_ITERATIONS`) must stay ≥ the corresponding `MAX_RAYMARCH_*` clamps in
 * `state.ts`.
 */
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import type { RaymarchParams } from "./state";

const RAYMARCH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// NOTE: MAX_MARCH_STEPS / MAX_DE_ITERATIONS are the GLSL loops' constant
// ceilings; they must be ≥ MAX_RAYMARCH_MAX_STEPS / MAX_RAYMARCH_ITERATIONS in
// state.ts, since the runtime budgets only ever break *out* early.
const RAYMARCH_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uCameraPos;
  uniform mat4 uInvViewProj;
  uniform float uPower;
  uniform int uIterations;
  uniform int uMaxSteps;
  uniform float uMaxDistance;

  varying vec2 vUv;

  const int MAX_MARCH_STEPS = 256;
  const int MAX_DE_ITERATIONS = 20;
  const float BOUNDING_RADIUS = 1.35; // the power-8 bulb fits well inside this
  const float SURFACE_EPS = 0.0006;   // hit threshold, scaled by ray distance

  // Distance estimate for the Mandelbulb of exponent uPower. GLSL mirror of
  // src/fractal/raymarch.ts's mandelbulbDistance — keep in sync.
  float mandelbulbDE(vec3 pos) {
    vec3 z = pos;
    float dr = 1.0;
    float r = 0.0;
    for (int i = 0; i < MAX_DE_ITERATIONS; i++) {
      if (i >= uIterations) break;
      r = length(z);
      if (r > 2.0) break;         // escaped ⇒ outside the set
      if (r < 1e-7) break;        // centre has no spherical angle; treat as inside
      float theta = acos(z.z / r);
      float phi = atan(z.y, z.x);
      float zr = pow(r, uPower);
      dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
      float st = sin(theta * uPower);
      z = zr * vec3(
        st * cos(phi * uPower),
        st * sin(phi * uPower),
        cos(theta * uPower)
      ) + pos;
    }
    if (r <= 2.0) return 0.0;     // never escaped ⇒ inside the set
    return 0.5 * log(r) * r / dr;
  }

  // Surface normal from the DE gradient (Quilez's tetrahedron sampling).
  vec3 calcNormal(vec3 p) {
    const vec2 k = vec2(1.0, -1.0);
    const float h = 0.0007;
    return normalize(
      k.xyy * mandelbulbDE(p + k.xyy * h) +
      k.yyx * mandelbulbDE(p + k.yyx * h) +
      k.yxy * mandelbulbDE(p + k.yxy * h) +
      k.xxx * mandelbulbDE(p + k.xxx * h));
  }

  // Soft shadow via a secondary DE march toward the light (penumbra from how
  // closely the ray grazes the surface).
  float softShadow(vec3 ro, vec3 rd, float mint, float maxt) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 40; i++) {
      if (t > maxt) break;
      float h = mandelbulbDE(ro + rd * t);
      if (h < 0.0002) return 0.0;
      res = min(res, 10.0 * h / t);
      t += clamp(h, 0.005, 0.08);
    }
    return clamp(res, 0.0, 1.0);
  }

  // Ambient occlusion from the distance field: sample the DE along the normal
  // and measure how much nearby geometry crowds the point.
  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float hr = 0.01 + 0.12 * float(i) / 4.0;
      float dd = mandelbulbDE(p + n * hr);
      occ += (hr - dd) * sca;
      sca *= 0.9;
    }
    return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
  }

  // Camera-independent sky gradient, matching scene.ts's dark backdrop
  // (#0d0d18 → #1f2039). Authored sRGB, output verbatim (ColorManagement off).
  vec3 background(vec3 rd) {
    float h = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
    vec3 top = vec3(0.051, 0.051, 0.094);
    vec3 bottom = vec3(0.122, 0.126, 0.224);
    return mix(bottom, top, h);
  }

  // Ray/sphere entry+exit (sphere at origin). Returns (-1, -1) on a miss.
  vec2 sphereIntersect(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  void main() {
    // Reconstruct the world-space primary ray by unprojecting this pixel's NDC
    // through the inverse view-projection matrix (the frozen explorer camera).
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 nearH = uInvViewProj * vec4(ndc, -1.0, 1.0);
    vec4 farH = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 pNear = nearH.xyz / nearH.w;
    vec3 pFar = farH.xyz / farH.w;
    vec3 ro = uCameraPos;
    vec3 rd = normalize(pFar - pNear);

    vec3 bg = background(rd);

    // Skip empty space: start marching at the bounding sphere so the DE is only
    // ever evaluated where it is well-behaved (a far point can otherwise
    // over-estimate and overshoot the surface).
    vec2 span = sphereIntersect(ro, rd, BOUNDING_RADIUS);
    if (span.y < 0.0) {
      gl_FragColor = vec4(bg, 1.0);
      return;
    }
    float t = max(span.x, 0.0);
    float tEnd = min(uMaxDistance, span.y);

    float hitT = -1.0;
    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
      if (i >= uMaxSteps) break;
      vec3 p = ro + rd * t;
      float d = mandelbulbDE(p);
      if (d < SURFACE_EPS * t) {
        hitT = t;
        break;
      }
      t += d;
      if (t > tEnd) break;
    }

    if (hitT < 0.0) {
      gl_FragColor = vec4(bg, 1.0);
      return;
    }

    vec3 p = ro + rd * hitT;
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(0.6, 0.75, 0.45)); // key directional light
    vec3 viewDir = -rd;
    vec3 halfVec = normalize(lightDir + viewDir);

    float diffuse = clamp(dot(n, lightDir), 0.0, 1.0);
    float specular = pow(clamp(dot(n, halfVec), 0.0, 1.0), 28.0);
    float ao = calcAO(p, n);
    float shadow = softShadow(p + n * 0.0025, lightDir, 0.02, 3.0);

    // Surface colour: a warm/cool split by facing, given a subtle iridescent
    // shimmer along the radius so the structure reads as a material.
    vec3 baseCol = mix(vec3(0.85, 0.55, 0.30), vec3(0.30, 0.52, 0.90),
                       0.5 + 0.5 * n.y);
    baseCol *= 0.75 + 0.25 * cos(6.2831 * (length(p) * 1.8 +
                                           vec3(0.0, 0.25, 0.5)));

    vec3 ambient = vec3(0.20, 0.22, 0.30); // cool sky fill
    vec3 keyColor = vec3(1.0, 0.96, 0.88); // warm key light

    vec3 col = baseCol * ambient * ao;
    col += baseCol * keyColor * diffuse * shadow;
    col += keyColor * specular * shadow * 0.6;

    // Distance fog toward the sky so far surfaces melt into the backdrop.
    float fog = 1.0 - exp(-0.10 * hitT);
    col = mix(col, bg, clamp(fog * 0.6, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Owns the raymarch ShaderMaterial and its full-screen quad. `scene.ts` holds
 * one, feeds it the (frozen) camera and the current {@link RaymarchParams}, and
 * renders it in place of the point cloud while a raymarch render is active.
 */
export class RaymarchQuad {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly viewProj = new THREE.Matrix4();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uInvViewProj: { value: new THREE.Matrix4() },
        uPower: { value: 8 },
        uIterations: { value: 8 },
        uMaxSteps: { value: 96 },
        uMaxDistance: { value: 12 },
      },
      vertexShader: RAYMARCH_VERTEX,
      fragmentShader: RAYMARCH_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Push the current DE/marching parameters into the shader uniforms. */
  setParams(params: RaymarchParams): void {
    const u = this.material.uniforms;
    u.uPower.value = params.power;
    u.uIterations.value = params.iterations;
    u.uMaxSteps.value = params.maxSteps;
    u.uMaxDistance.value = params.maxDistance;
  }

  /**
   * Snapshot the camera into the ray-reconstruction uniforms: world position
   * plus the inverse of `projection * view`, so the fragment shader can
   * unproject each pixel into a world-space ray matching the explorer's view.
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const u = this.material.uniforms;
    (u.uInvViewProj.value as THREE.Matrix4).copy(this.viewProj).invert();
    camera.getWorldPosition(u.uCameraPos.value as THREE.Vector3);
  }

  /** Draw the raymarch quad to the currently bound framebuffer (the canvas). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.quad.dispose();
    this.material.dispose();
  }
}
