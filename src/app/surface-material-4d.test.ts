import type * as THREE from "three";
import {
  createSurfaceMaterial4,
  setSurface4Balloon,
  setSurface4GroundPlane,
  setSurfaceSystem4,
  setSurfaceView4,
  surface4FragmentFor,
  SURFACE4_MAX_MAPS,
} from "./surface-material-4d";
import { SURFACE_GLSL_STRIP_BYTES } from "./surface-material";
import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import type { SurfaceDE4, SurfaceDE4Map } from "../fractal/surface-de-4d";
import { radiusBandInvRange } from "../fractal/surface-de-4d";
import { CLASSIC_SURFACE_FOLD_RADII } from "../fractal/surface-de";
import { twentyFourCellFlake } from "../fractal/presets";

/**
 * The 4D tracer's per-map data rides a std140 uniform BLOCK rather than
 * default-block uniform arrays (fr-dqlq — that block is what let the cap
 * match 3D's 24 maps), and a std140 lane written one float off is invisible
 * until someone loads a 4D system in a browser. So while the rest of this
 * material is verified by running the app, its PACKER is pinned here: the
 * block's backing floats are pure data, no GL context involved.
 */

/** A minimal contracting inverse-map slot, merged with each test's overrides
 * (identity inverse unless a test cares about the matrix). */
function map4(overrides: Partial<SurfaceDE4Map> = {}): SurfaceDE4Map {
  return {
    invM: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    invT: [0, 0, 0, 0],
    sigmaMin: 0.5,
    baseIndex: 0,
    // Inert affine-slot defaults for the fr-rsp6 fold fields — this
    // packer predates fold-4D and packs none of them.
    foldKind: 0,
    foldInvW: 1,
    foldSigma: 0.5,
    foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    invMSigmaMin: 0.5,
    invTNorm: 0,
    bnbDir: [0, 0, 0, 0],
    ...overrides,
  };
}

/** Row-major 4x4 identity — the no-kaleidoscope backward step. */
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The smallest DE the packer accepts, wrapped around the given slots. */
function de4(
  maps: SurfaceDE4Map[],
  symmetry: SurfaceDE4["symmetry"] = { order: 1, stepBack: IDENTITY4 },
): SurfaceDE4 {
  return {
    maps,
    symmetry,
    boundingRadius: 1,
    visibleBoundingRadius: 1,
    radiusBand: { center: [0, 0, 0, 0], minD: 0, maxD: 1 },
    escapeRadius: 2,
    maxDepth: 8,
    beamWidth: 4,
    stepScale: 1,
    final: null,
    foldFinal: null,
  };
}

/** The four Float32Arrays behind the material's `SurfaceMaps4` block, in the
 * order the fragment shader declares its members — the bytes the GPU reads.
 * Reached through the uniforms group because block members deliberately do
 * NOT appear in `material.uniforms`. */
function mapBlock(material: THREE.ShaderMaterial): {
  invM: Float32Array;
  invT: Float32Array;
  colorSigma: Float32Array;
  trap: Float32Array;
} {
  const group = material.uniformsGroups[0];
  const uniforms = group.uniforms as THREE.Uniform<Float32Array>[];
  return {
    invM: uniforms[0].value,
    invT: uniforms[1].value,
    colorSigma: uniforms[2].value,
    trap: uniforms[3].value,
  };
}

/** THREE.Matrix4 stores column-major; this reads one back out in the
 * row-major order rotorMatrix (rotor4.ts) and setSurfaceView4's own doc
 * comment both use, so an independently-computed expected matrix lines up
 * index for index against what the packer wrote. */
function rowMajorOf(m: THREE.Matrix4): number[] {
  const e = m.elements;
  return [
    e[0],
    e[4],
    e[8],
    e[12],
    e[1],
    e[5],
    e[9],
    e[13],
    e[2],
    e[6],
    e[10],
    e[14],
    e[3],
    e[7],
    e[11],
    e[15],
  ];
}

describe("setSurfaceSystem4 slot cap", () => {
  it("has room for the 24 maps twentyFourCellFlake brings", () => {
    expect(twentyFourCellFlake()).toHaveLength(24);
    expect(twentyFourCellFlake().length).toBeLessThanOrEqual(SURFACE4_MAX_MAPS);
  });

  it("packs a full 24-map system, last slot included", () => {
    const material = createSurfaceMaterial4();
    const maps = Array.from({ length: 24 }, (_, j) =>
      map4({ sigmaMin: 0.3, baseIndex: j }),
    );
    setSurfaceSystem4(
      material,
      de4(maps),
      maps.map(() => [0.5, 0.5, 0.5]),
      maps.map((_, j) => j / 100),
    );
    expect(material.uniforms.uMapCount.value).toBe(24);
    // Slot 23 is the one the old 16-slot block had no room for.
    expect(mapBlock(material).trap[23 * 4]).toBeCloseTo(0.23, 6);
  });

  it("refuses a 25-map system rather than dropping the surplus silently", () => {
    const material = createSurfaceMaterial4();
    const maps = Array.from({ length: 25 }, () => map4());
    expect(() =>
      setSurfaceSystem4(
        material,
        de4(maps),
        maps.map(() => [0.5, 0.5, 0.5]),
      ),
    ).toThrow(RangeError);
  });
});

describe("setSurfaceSystem4 std140 packing", () => {
  it("transposes each row-major inverse map into its column-major mat4 slot", () => {
    const material = createSurfaceMaterial4();
    const rowMajor = Array.from({ length: 16 }, (_, k) => k);
    setSurfaceSystem4(material, de4([map4({ invM: rowMajor })]), [[0, 0, 0]]);
    expect(Array.from(mapBlock(material).invM.subarray(0, 16))).toEqual([
      0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15,
    ]);
  });

  it("gives each map's inverse translation its own vec4 slot", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([
        map4({ invT: [0.1, 0.2, 0.3, 0.4] }),
        map4({ invT: [-0.5, -0.6, -0.7, -0.8] }),
      ]),
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const { invT } = mapBlock(material);
    expect(
      Array.from(invT.subarray(0, 8)).map((v) => Number(v.toFixed(4))),
    ).toEqual([0.1, 0.2, 0.3, 0.4, -0.5, -0.6, -0.7, -0.8]);
  });

  it("folds each map's contraction factor into its slot's w lane", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([
        map4({ sigmaMin: 0.11 }),
        map4({ sigmaMin: 0.22 }),
        map4({ sigmaMin: 0.33 }),
      ]),
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const { colorSigma } = mapBlock(material);
    expect(colorSigma[3]).toBeCloseTo(0.11, 6);
    expect(colorSigma[7]).toBeCloseTo(0.22, 6);
    expect(colorSigma[11]).toBeCloseTo(0.33, 6);
  });

  it("puts each map's color in the xyz lanes of its own slot", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, de4([map4(), map4()]), [
      [1, 0, 0],
      [0, 0.5, 1],
    ]);
    const { colorSigma } = mapBlock(material);
    expect(Array.from(colorSigma.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(colorSigma.subarray(4, 7))).toEqual([0, 0.5, 1]);
  });

  it("resets a previous system's trap coordinate when the new call omits it", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]], [0.75]);
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(mapBlock(material).trap[0]).toBe(0);
  });
});

describe("setSurfaceSystem4 kaleidoscope sweep uniforms (fr-u91x)", () => {
  it("defaults to a single sector and an identity backward step before any system arrives", () => {
    const material = createSurfaceMaterial4();
    expect(material.uniforms.uSymOrder.value).toBe(1);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual(IDENTITY4);
  });

  it("packs the DE's order and its row-major backward step column-major, the uFinalInvM convention", () => {
    const material = createSurfaceMaterial4();
    const rowMajor = Array.from({ length: 16 }, (_, k) => k);
    setSurfaceSystem4(
      material,
      de4([map4()], { order: 5, stepBack: rowMajor }),
      [[0, 0, 0]],
    );
    expect(material.uniforms.uSymOrder.value).toBe(5);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual([
      0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15,
    ]);
  });

  it("resets a previous system's sectors when the next system has no kaleidoscope", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([map4()], {
        order: 3,
        stepBack: Array.from({ length: 16 }, (_, k) => k),
      }),
      [[0, 0, 0]],
    );
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(material.uniforms.uSymOrder.value).toBe(1);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual(IDENTITY4);
  });
});

describe("setSurfaceSystem4 radius-band uniforms (fr-skhv)", () => {
  it("packs the DE's radiusBand into uRadiusCenter4/uRadiusMinD/uRadiusInvRange", () => {
    const material = createSurfaceMaterial4();
    // Every field a different number, like balloonSpec's fixture below —
    // de4()'s own default band (all-zero center, degenerate [0,1] range)
    // would let a packer that crossed two axes, or crossed minD with
    // invRange, pass silently.
    const radiusBand = {
      center: [1.5, -2.25, 3.75, -0.5] as [number, number, number, number],
      minD: 0.2,
      maxD: 4.2,
    };
    setSurfaceSystem4(material, { ...de4([map4()]), radiusBand }, [[0, 0, 0]]);
    const u = material.uniforms;
    const center = u.uRadiusCenter4.value as THREE.Vector4;
    expect([center.x, center.y, center.z, center.w]).toEqual(radiusBand.center);
    expect(u.uRadiusMinD.value).toBe(radiusBand.minD);
    // radiusBandInvRange is the ONE inverse-range definition this packer
    // and the WGSL packer (surface-de-gpu.ts) both read off
    // surface-de-4d.ts — pinning uRadiusInvRange against a direct call to
    // it checks that the derived number was ROUTED to the right uniform
    // (not swapped with minD, not dropped), the same division of labor as
    // surface-de-gpu.test.ts's "round-trips SurfaceDE4.radiusBand" leg;
    // radiusBandInvRange's own arithmetic is pinned independently by
    // surface-de-4d.test.ts's "radiusBandInvRange" describe.
    expect(u.uRadiusInvRange.value).toBe(radiusBandInvRange(radiusBand));
  });
});

describe("slab-hit radius color (fr-9c9e)", () => {
  // The tracer itself is verified by running the app; what is pinned here
  // is the MIRRORING contract with surface-de-gpu.ts's affine4 core: both
  // shading descents report sStar — the deepest level winner's segment
  // parameter — and both radius colors lift through w0 + sStar * halfW,
  // so neither side can drift to the slab's centre plane alone. At
  // uSliceHalfW = 0 segmentS's guard pins sStar to 0 and the lift is the
  // slice plane bit for bit.
  it("lifts the radius color through the descent's sStar — the slab hit's own w", () => {
    const glsl = createSurfaceMaterial4().fragmentShader;
    expect(glsl).toContain("float segmentS(vec4 q, vec4 e)");
    expect(glsl).toContain("sStar = segmentS(c1Q, c1Ext);");
    expect(glsl).toContain(
      "vec4 q4 = uInvRotor * vec4(pos, uW0 + sStar * uSliceHalfW);",
    );
  });
});

describe("the supersampling jitter uniform (fr-jf9y)", () => {
  // The 4D tracer is the PRIMARY arm for kaleidoscope-4D sessions and the
  // fallback for plain-4D ones, so it takes the 3D tracer's jitter line
  // for line — same uniform, same two reads, same untouched backdrop. The
  // scene writes one uniform per armed job and both materials answer to it.
  it("defaults to the pixel CENTRE, so a single-pass 4D trace is the pre-fr-jf9y one", () => {
    const material = createSurfaceMaterial4();
    const jitter = material.uniforms.uPixelJitter.value as THREE.Vector4;
    expect([jitter.x, jitter.y, jitter.z, jitter.w]).toEqual([0, 0, 0, 0]);
  });

  it("enters the ray and the dither, and leaves the backdrop gradient alone", () => {
    const glsl = createSurfaceMaterial4().fragmentShader;
    expect(glsl).toContain("uniform vec4 uPixelJitter;");
    expect(glsl).toContain("(vUv + uPixelJitter.xy) * 2.0 - 1.0");
    expect(glsl).toContain("hash(gl_FragCoord.xy + uPixelJitter.zw)");
    expect(glsl).toContain("mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))");
  });
});

/** A balloon payload whose fields are all different numbers, so a packer
 * that crossed two of them fails loudly. */
const balloonSpec = () => ({
  center: [1, 2, 3] as [number, number, number],
  rho: 4,
  R: 5,
  far: 6,
});

/** The same, for the floor. */
const groundSpec = () => ({
  y: -1.5,
  fadeStart: 3,
  fadeEnd: 9,
  ballCenter: [0.1, 0.2, 0.3] as [number, number, number],
  ballRadius: 1.25,
  albedo: [0.4, 0.5, 0.6] as [number, number, number],
});

describe("the 4D tracer's variant arms (fr-qxxw, fr-h0c3)", () => {
  // The arms are resolved JS-side (surface4FragmentFor, which reuses the
  // 3D file's resolver), which is what makes OFF byte-identical to the
  // shipped tracer AND keeps every variant the driver sees far under the
  // Mesa source cliff. MEASURED raw resolved / what the driver gets:
  // off 61751 B (60.3KB) / 61751 B — under the 64KB threshold, so NOT
  // stripped, i.e. the shipped bytes exactly; balloon 67123 B (65.5KB) /
  // 16664 B (16.3KB); plane 69497 B (67.9KB) / 17705 B (17.3KB). The
  // assertions below pin the CONTRACT (under threshold, arms present or
  // absent) rather than those figures, which any shader edit moves.
  it("resolves the shipped source verbatim when both arms are off", () => {
    const glsl = surface4FragmentFor();
    expect(glsl).toBe(createSurfaceMaterial4().fragmentShader);
    // Un-stripped: indentation and block comments survive, which is the
    // observable half of "a plain 4D session hands the driver the bytes it
    // always did".
    expect(glsl).toContain("\n  precision highp float;");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
    for (const token of [
      "uBalloonCenter",
      "uBalloonRho",
      "balloonInvert",
      "surfaceDEBalloonHitInfo",
      "surfaceDEFractal",
      "uGroundY",
      "uGroundBallR",
      "shadeGroundPlane",
    ]) {
      expect(glsl).not.toContain(token);
    }
  });

  it("compiles the balloon wrapper over the descent when the balloon is on", () => {
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain("uniform vec3 uBalloonCenter;");
    expect(glsl).toContain("uniform float uBalloonRho;");
    // The rename that lets the wrapper own the public names.
    expect(glsl).toContain("#define surfaceDE surfaceDEFractal");
    expect(glsl).toContain("#undef surfaceDE");
    expect(glsl).toContain("vec3 balloonInvert(vec3 p, out float scale) {");
    // fractal/balloon-de.ts's invertBalloon, with the f32 centre floor.
    expect(glsl).toContain("float fl = 1.0e-6 * uBalloonRho;");
    expect(glsl).toContain("scale = r / uBalloonRho;");
    // The union and its cutoff scaling (the fr-55r5 contract through the
    // shell term's value factor).
    expect(glsl).toContain(
      "scale * surfaceDEFractal(q, cutoff > 0.0 ? cutoff / scale : 0.0);",
    );
    // The march-entry semantics: no visible-sphere gate, far cap past the
    // balloon centre, every ray from the camera.
    expect(glsl).toContain(
      "float tFar = length(uCamPos - uBalloonCenter) + uBalloonFar;",
    );
    expect(glsl).not.toContain("shadeGroundPlane");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("keeps the 4D hit-info's sStar through the balloon's argmin routing", () => {
    // Six outputs, one more than the 3D wrapper carries: sStar is the slab
    // hit's own place along the query segment (fr-9c9e), so a SHELL hit's
    // radius colour has to lift through the shell descent's parameter, not
    // the fractal's. Ties go to the fractal (the oracle's attribution
    // convention) — hence the strict dS < dF.
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain(
      "surfaceDEFractal(q, firstChoice, trap, rings, sheets, sStar);",
    );
    expect(glsl).toContain(
      "return surfaceDEFractal(p, firstChoice, trap, rings, sheets, sStar);",
    );
    expect(glsl).toContain("if (dS < dF) {\ncolorPos = q;");
    // Both position-driven colour sources read the winning term's SOURCE
    // point, the radius one still through the fr-9c9e slab lift.
    expect(glsl).toContain(
      "u = clamp(cpos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);",
    );
    expect(glsl).toContain(
      "vec4 q4 = uInvRotor * vec4(cpos, uW0 + sStar * uSliceHalfW);",
    );
  });

  it("shadows the balloon from the fractal alone — the shell never casts", () => {
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain(
      "vec3 sp = pos + n * h * 2.0 + uLightDir * ts;\nfloat d = surfaceDEFractal(sp);",
    );
  });

  it("compiles the floor and its two analytic ball certificates when the plane is on", () => {
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain("uniform float uGroundY;");
    expect(glsl).toContain("uniform vec3 uGroundAlbedo;");
    expect(glsl).toContain(
      "vec3 shadeGroundPlane(vec3 ro, vec3 rd, vec3 background, out float cov) {",
    );
    // One-sided, radially faded, and the two gates that make an infinite
    // floor affordable (shadow corridor, AO reach).
    expect(glsl).toContain("if (ro.y <= uGroundY || rd.y >= -1.0e-6) {");
    expect(glsl).toContain(
      "1.0 - smoothstep(uGroundFadeStart, uGroundFadeEnd, length(rel));",
    );
    expect(glsl).toContain(
      "float corridor = uGroundBallR * 1.05 + 0.3 * along;",
    );
    expect(glsl).toContain(
      "float reach = uGroundBallR * (1.02 + 0.04 * float(uAoTaps));",
    );
    // The taps run the 4D value overload — there is no probe descent here.
    expect(glsl).toContain(
      "clamp((hh - surfaceDE(hp + vec3(0.0, hh, 0.0))) / hh, 0.0, 1.0);",
    );
    expect(glsl).not.toContain("balloonInvert");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("planes a sphere-exit miss and never an exhausted ray", () => {
    // The 4D main() had no such split before fr-h0c3 — with no floor, both
    // outcomes painted the same backdrop. A budget-exhausted ray resolved
    // no geometry, so planing it would paint floor straight through the
    // object it ran out of steps inside.
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain(
      [
        "if (!hit) {",
        "if (t > tFar) {",
        "float planeCovMiss;",
        "outColor = vec4(",
        "shadeGroundPlane(ro, rd, background, planeCovMiss),",
        "planeCovMiss",
        ");",
        "return;",
        "}",
        "outColor = vec4(background, 0.0);",
      ].join("\n"),
    );
  });

  it("lands the two pre-march misses on the floor too", () => {
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain(
      "if (disc < 0.0) {\nfloat planeCov;\noutColor = vec4(shadeGroundPlane(ro, rd, background, planeCov), planeCov);",
    );
    expect(glsl).toContain("if (tFar <= 0.0) {\nfloat planeCovExit;");
  });

  it("refuses a floor inside the shell — there is no horizon in there", () => {
    expect(() => surface4FragmentFor(1, 1)).toThrow(RangeError);
  });
});

describe("setSurfaceView4 (fr-33yb, fr-wa6o)", () => {
  it("sets uInvRotor to the inverse of a non-identity world rotor — pinned against rotor4.ts's own math, not the packer's transpose", () => {
    const material = createSurfaceMaterial4();
    // A single-plane SO(4) rotation's inverse is the SAME plane rotated
    // by the NEGATIVE angle — group closure (R(angle) . R(-angle) =
    // R(0) = identity) makes rotorMatrix(R(-angle)) the exact matrix
    // inverse of rotorMatrix(R(angle)), and since both are orthogonal
    // that inverse is also the transpose setSurfaceView4 is documented to
    // compute. So this is an independent route to the expected matrix —
    // it never transposes anything — rather than checking the packer's
    // own column-reordered transpose against itself. Non-identity so a
    // wrong row/column swap can't hide behind identity's symmetry, the
    // uInvRotor counterpart of the per-map "transposes each row-major
    // inverse map…" test above.
    const angle = Math.PI / 6;
    const rotor = rotorMatrix(rotateInPlane(identityRotorPair(), "xw", angle));
    const expectedInv = rotorMatrix(
      rotateInPlane(identityRotorPair(), "xw", -angle),
    );
    setSurfaceView4(material, rotor, 0, 0);
    const invRotor = material.uniforms.uInvRotor.value as THREE.Matrix4;
    rowMajorOf(invRotor).forEach((v, i) =>
      expect(v).toBeCloseTo(expectedInv[i], 9),
    );
  });

  it("uploads w0 and sliceHalfW verbatim — the normalized-slider-to-world wSupport conversion is scene.ts's setSurface4View, upstream of this packer", () => {
    const material = createSurfaceMaterial4();
    setSurfaceView4(material, IDENTITY4, 0.62, 0.17);
    expect(material.uniforms.uW0.value).toBe(0.62);
    expect(material.uniforms.uSliceHalfW.value).toBe(0.17);
  });
});

describe("setSurface4Balloon (fr-qxxw)", () => {
  it("packs the spec and compiles the arm in", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const center = material.uniforms.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([1, 2, 3]);
    expect(material.uniforms.uBalloonR.value).toBe(5);
    expect(material.uniforms.uBalloonRho.value).toBe(4);
    expect(material.uniforms.uBalloonFar.value).toBe(6);
    expect(material.defines.SURFACE4_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
  });

  it("resets to the inert off state on null, rho included", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    setSurface4Balloon(material, null);
    const center = material.uniforms.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([0, 0, 0]);
    expect(material.uniforms.uBalloonR.value).toBe(0);
    // 1, not 0: a stray enabled read must never divide by zero.
    expect(material.uniforms.uBalloonRho.value).toBe(1);
    expect(material.uniforms.uBalloonFar.value).toBe(0);
    expect(material.defines.SURFACE4_BALLOON).toBe(0);
    expect(material.fragmentShader).not.toContain("uBalloonCenter");
  });

  it("rebuilds the program only when the arm moves, never on a radius drag", () => {
    // The radius slider writes uniforms per tick; a program rebuild per
    // tick would be a recompile per tick.
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const version = material.version;
    setSurface4Balloon(material, { ...balloonSpec(), R: 9 });
    expect(material.uniforms.uBalloonR.value).toBe(9);
    expect(material.version).toBe(version);
    setSurface4Balloon(material, null);
    expect(material.version).toBeGreaterThan(version);
  });
});

describe("setSurface4GroundPlane (fr-h0c3)", () => {
  it("packs the spec and compiles the arm in", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(-1.5);
    expect(u.uGroundFadeStart.value).toBe(3);
    expect(u.uGroundFadeEnd.value).toBe(9);
    expect(u.uGroundBallR.value).toBe(1.25);
    const ball = u.uGroundBallC.value as THREE.Vector3;
    expect([ball.x, ball.y, ball.z]).toEqual([0.1, 0.2, 0.3]);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([0.4, 0.5, 0.6]);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("shadeGroundPlane");
  });

  it("resets to the inert off state on null, ball radius and albedo included", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    setSurface4GroundPlane(material, null);
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(0);
    expect(u.uGroundFadeStart.value).toBe(0);
    expect(u.uGroundFadeEnd.value).toBe(0);
    // 1 and white, not zeros: a stray enabled read must never divide by
    // zero or paint a black band.
    expect(u.uGroundBallR.value).toBe(1);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([1, 1, 1]);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).not.toContain("uGroundY");
  });

  it("rebuilds the program only when the arm moves", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    const version = material.version;
    setSurface4GroundPlane(material, { ...groundSpec(), y: -4 });
    expect(material.uniforms.uGroundY.value).toBe(-4);
    expect(material.version).toBe(version);
  });
});

describe("balloon seniority over the floor", () => {
  it("drops a live floor when the balloon comes on", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(1);
    setSurface4Balloon(material, balloonSpec());
    expect(material.defines.SURFACE4_BALLOON).toBe(1);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).not.toContain("shadeGroundPlane");
  });

  it("refuses a floor over a live balloon without moving any state", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const version = material.version;
    expect(() => setSurface4GroundPlane(material, groundSpec())).toThrow(
      RangeError,
    );
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.uniforms.uGroundBallR.value).toBe(1);
    expect(material.version).toBe(version);
    expect(material.fragmentShader).toContain("balloonInvert");
  });
});
