import type * as THREE from "three";
import { Data3DTexture, Texture } from "three";
import {
  buildSurfaceFragment,
  createSurfaceBlitMaterial,
  createSurfaceMaterial,
  packSurfaceBalloonTint,
  setBulbSystem,
  setEscapeSystem,
  setSurfaceBalloon,
  setSurfaceGrid,
  setSurfaceGridEnabled,
  setSurfaceFinishes,
  setSurfaceGroundPlane,
  setSurfaceSystem,
  surfaceFragmentFor,
  surfaceFragmentResolvedFor,
  SURFACE_GLSL_STRIP_BYTES,
  SURFACE_MAX_MAPS,
  SURFACE_SHADE_DE_WIDTH,
} from "./surface-material";
import {
  CLASSIC_SURFACE_FINISH,
  resolveSurfaceFinish,
  surfaceFinishLanes,
} from "../fractal/surface-finish";
import {
  buildBulbDE,
  BULB_ITERATIONS,
  BULB_STEP_SCALE,
} from "../fractal/bulb-de";
import { buildEscapeDE } from "../fractal/escape-de";
import type {
  SurfaceBalloonSpec,
  SurfaceGroundPlaneSpec,
} from "./surface-material";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  buildBalloon,
} from "../fractal/balloon-de";
import {
  buildSurfaceDE,
  surfaceFoldRadii,
  CLASSIC_SURFACE_FOLD_RADII,
  SURFACE_FOLD_BEAM_WIDTH,
} from "../fractal/surface-de";
import type { SurfaceDE, SurfaceDEMap } from "../fractal/surface-de";
import { defaultTransforms, sierpinskiTetrahedron } from "../fractal/presets";
import type { Transform, Vec3 } from "../fractal/types";

/**
 * The tracer itself is verified by running the app, but its kaleidoscope
 * PACKER is pinned here. The descent sweeps symmetry sectors instead of
 * expanding them into map slots, so the whole kaleidoscope crosses into
 * GLSL as three scalars — an order, a PLANE CODE, and one (cos, sin)
 * step. A plane mapped to the wrong int, or a step of the wrong sign,
 * rotates the estimator's sectors away from the plotted attractor and is
 * invisible until someone loads a kaleidoscope in a browser. These are
 * pure uniform reads: no GL context involved.
 */

/** A minimal contracting inverse-map slot, merged with each test's
 * overrides (identity inverse unless a test cares about the matrix). */
function map3(overrides: Partial<SurfaceDEMap> = {}): SurfaceDEMap {
  return {
    invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    invT: [0, 0, 0],
    sigmaMin: 0.5,
    foldKind: 0,
    foldInvW: 1,
    foldSigma: 0.5,
    foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    baseIndex: 0,
    invMSigmaMin: 1,
    invTNorm: 0,
    bnbDir: [0, 0, 0],
    ...overrides,
  };
}

/** The smallest DE the packer accepts, wrapped around the given slots. */
function de3(
  maps: SurfaceDEMap[],
  symmetry: SurfaceDE["symmetry"] = {
    order: 1,
    plane: "xz",
    stepCos: 1,
    stepSin: 0,
  },
): SurfaceDE {
  return {
    maps,
    symmetry,
    boundingRadius: 1,
    boundCenter: [0, 0, 0],
    visibleBoundingRadius: 1,
    escapeRadius: 2,
    maxDepth: 8,
    slowestSigma: 0.5,
    beamWidth: 4,
    stepScale: 1,
    final: null,
    foldFinal: null,
  };
}

const black: Vec3 = [0, 0, 0];

describe("setSurfaceSystem kaleidoscope packing", () => {
  it("passes a symmetry-free system a single sector with no rotation", () => {
    const material = createSurfaceMaterial();
    setSurfaceSystem(material, de3([map3()]), [black]);
    const u = material.uniforms;
    expect(u.uSymOrder.value).toBe(1);
    expect((u.uSymStep.value as THREE.Vector2).x).toBe(1);
    expect((u.uSymStep.value as THREE.Vector2).y).toBe(0);
  });

  it("passes the bounding ball's center through", () => {
    const material = createSurfaceMaterial();
    const de = de3([map3()]);
    setSurfaceSystem(material, { ...de, boundCenter: [0.5, -1.25, 2] }, [
      black,
    ]);
    const center = material.uniforms.uBoundCenter.value as THREE.Vector3;
    expect(center.x).toBe(0.5);
    expect(center.y).toBe(-1.25);
    expect(center.z).toBe(2);
    // The next system must not inherit it.
    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);
    expect(center.z).toBe(0);
  });

  it("codes the yz plane as 0, xz as 1 and xy as 2 — the frozen pre-4D axis codes", () => {
    const material = createSurfaceMaterial();
    for (const [plane, code] of [
      ["yz", 0],
      ["xz", 1],
      ["xy", 2],
    ] as const) {
      setSurfaceSystem(
        material,
        de3([map3()], { order: 5, plane, stepCos: 1, stepSin: 0 }),
        [black],
      );
      expect(material.uniforms.uSymPlane.value).toBe(code);
    }
  });

  it("hands the shader the sector count and its one step, not an expansion", () => {
    const material = createSurfaceMaterial();
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 6,
      plane: "xy",
    });
    setSurfaceSystem(material, de, [black, black, black, black]);
    const u = material.uniforms;
    // 4 base maps at order 6 would have been 24 expanded slots.
    expect(u.uMapCount.value).toBe(4);
    expect(u.uSymOrder.value).toBe(6);
    expect((u.uSymStep.value as THREE.Vector2).x).toBeCloseTo(
      Math.cos((2 * Math.PI) / 6),
      6,
    );
    expect((u.uSymStep.value as THREE.Vector2).y).toBeCloseTo(
      Math.sin((2 * Math.PI) / 6),
      6,
    );
  });

  it("accepts an order that would have overflowed the expanded slot budget", () => {
    const material = createSurfaceMaterial();
    // 4 base maps x order 9 = 36 copies: refused outright before the
    // sector sweep.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 9,
      plane: "xz",
    });
    expect(() =>
      setSurfaceSystem(material, de, [black, black, black, black]),
    ).not.toThrow();
    expect(material.uniforms.uSymOrder.value).toBe(9);
  });

  it("still refuses more BASE maps than the uniform arrays carry", () => {
    const material = createSurfaceMaterial();
    const tooMany = Array.from({ length: SURFACE_MAX_MAPS + 1 }, () => map3());
    expect(() =>
      setSurfaceSystem(
        material,
        de3(tooMany),
        tooMany.map(() => black),
      ),
    ).toThrow(RangeError);
  });
});

describe("the fold's authored lengths in the GLSL tracer", () => {
  it("packs each map's own three lengths into uFoldRadii, in resolveFoldRadii's raw (not squared) form", () => {
    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de3([
        map3({
          foldKind: 3,
          foldRadii: surfaceFoldRadii({
            type: "mandelbox",
            weight: 1,
            minRadius: 0.375,
            fixedRadius: 1.5,
            boxLimit: 0.75,
          }),
        }),
        map3({ baseIndex: 1 }),
      ]),
      [black, black],
    );
    const radii = material.uniforms.uFoldRadii.value as THREE.Vector4[];
    expect([radii[0].x, radii[0].y, radii[0].z]).toEqual([0.375, 1.5, 0.75]);
    // The unparameterized slot beside it keeps the classic set, which is
    // also this uniform's own default — so "absent means classic" holds
    // whether or not the packer reached the slot.
    expect([radii[1].x, radii[1].y, radii[1].z]).toEqual([0.5, 1, 1]);
  });

  it("packs the fold LENS's lengths, and resets them to the CLASSIC set — never zero — when a system arrives without one", () => {
    const material = createSurfaceMaterial();
    const lensed = de3([map3()]);
    lensed.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 0.7,
      foldKind: 2,
      invW: 1,
      absW: 1,
      foldRadii: surfaceFoldRadii({
        type: "spherefold",
        weight: 1,
        minRadius: 0.25,
        fixedRadius: 0.5,
        boxLimit: 2,
      }),
    };
    setSurfaceSystem(material, lensed, [black]);
    const lensRadii = material.uniforms.uLensRadii.value as THREE.Vector3;
    expect([lensRadii.x, lensRadii.y, lensRadii.z]).toEqual([0.25, 0.5, 2]);

    // A lens-free system reuses the same material: 0 would be a fold whose
    // arithmetic divides by zero, so the reset is to the classic lengths.
    setSurfaceSystem(material, de3([map3()]), [black]);
    expect([lensRadii.x, lensRadii.y, lensRadii.z]).toEqual([0.5, 1, 1]);
  });

  it("packs each escape LINK's lengths SQUARED, so a chain may carry a different apparatus per link", () => {
    const material = createSurfaceMaterial();
    const de = buildEscapeDE([
      {
        id: 0,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.375,
            fixedRadius: 0.5,
            boxLimit: 0.75,
          },
        ],
      },
      {
        id: 1,
        position: [-0.1, 0.2, 0],
        rotation: [0.2, 0, 0.1],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: 1.5, boxLimit: 3 }],
      },
    ]);
    setEscapeSystem(material, de, black);
    const escRadii = material.uniforms.uEscRadii.value as THREE.Vector4[];
    expect([escRadii[0].x, escRadii[0].y, escRadii[0].z]).toEqual([
      0.140625, 0.25, 0.75,
    ]);
    // The tail link leaves the sphere pair absent: the classic 0.5/1,
    // squared.
    expect([escRadii[1].x, escRadii[1].y, escRadii[1].z]).toEqual([0.25, 1, 3]);
  });

  it("leaves no classic fold length baked into the emitted GLSL — the divergence that used to render one object on the CPU and another on every GPU path", () => {
    for (const src of [surfaceFragmentFor(0, 0), surfaceFragmentFor(0, 1)]) {
      expect(src).toContain("FoldRadii foldRadiiOf(vec3 f)");
      expect(src).not.toContain("pre1 = 2.0 - u;");
      expect(src).not.toContain("v = 0.25 * u;");
      expect(src).not.toContain("sfSigma = 4.0;");
      expect(src).not.toContain("max(ru - 2.0, 0.0)");
    }
    const escape = surfaceFragmentFor(1, 0);
    expect(escape).not.toContain("clamp(dot(y, y), 0.25, 1.0)");
    expect(escape).not.toContain("clamp(y, -1.0, 1.0)");
  });

  it("the strip rule caps what the driver walks below the threshold, which is what puts the Mesa cliff out of reach", () => {
    // The emitted length is bounded BY CONSTRUCTION, not by any property
    // of a particular variant: a resolved source under 65536 B is emitted
    // whole, and one over it is stripped to roughly a third (measured:
    // 83022 B -> 29194 B for the affine/fold base). For an emitted source
    // to reach the 82.2KB that crashed Mesa outright, the resolved source
    // would have to pass ~190KB — and the whole UNRESOLVED template is
    // 142130 B, well short of that. So this assertion can only fail
    // if stripGlslSource stops shrinking; it is NOT a check that any
    // variant has stopped growing (that's surfaceFragmentResolvedFor's
    // job, pinned separately below).
    const variants: [string, string][] = [
      ["affine", surfaceFragmentFor(0, 0)],
      ["fold lens", surfaceFragmentFor(0, 1)],
      ["balloon", surfaceFragmentFor(0, 0, 1)],
      ["ground plane", surfaceFragmentFor(0, 0, 0, 1)],
      ["lens + balloon", surfaceFragmentFor(0, 1, 1)],
      ["lens + plane", surfaceFragmentFor(0, 1, 0, 1)],
      ["escape", surfaceFragmentFor(1, 0)],
      ["escape + balloon", surfaceFragmentFor(1, 0, 1)],
      ["escape + plane", surfaceFragmentFor(1, 0, 0, 1)],
      ["bulb", surfaceFragmentFor(0, 0, 0, 0, 1)],
      ["bulb + balloon", surfaceFragmentFor(0, 0, 1, 0, 1)],
      ["bulb + plane", surfaceFragmentFor(0, 0, 0, 1, 1)],
      // The same twelve with the finish arm on — it composes with all of
      // them, so all of them are programs the driver can be handed.
      ["affine + finish", surfaceFragmentFor(0, 0, 0, 0, 0, 1)],
      ["fold lens + finish", surfaceFragmentFor(0, 1, 0, 0, 0, 1)],
      ["balloon + finish", surfaceFragmentFor(0, 0, 1, 0, 0, 1)],
      ["ground plane + finish", surfaceFragmentFor(0, 0, 0, 1, 0, 1)],
      ["lens + balloon + finish", surfaceFragmentFor(0, 1, 1, 0, 0, 1)],
      ["lens + plane + finish", surfaceFragmentFor(0, 1, 0, 1, 0, 1)],
      ["escape + finish", surfaceFragmentFor(1, 0, 0, 0, 0, 1)],
      ["escape + balloon + finish", surfaceFragmentFor(1, 0, 1, 0, 0, 1)],
      ["escape + plane + finish", surfaceFragmentFor(1, 0, 0, 1, 0, 1)],
      ["bulb + finish", surfaceFragmentFor(0, 0, 0, 0, 1, 1)],
      ["bulb + balloon + finish", surfaceFragmentFor(0, 0, 1, 0, 1, 1)],
      ["bulb + plane + finish", surfaceFragmentFor(0, 0, 0, 1, 1, 1)],
    ];
    for (const [name, src] of variants) {
      expect(src.length, name).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
    }
  });

  it("keeps the two shipped forward arms under the strip threshold, so their commentary survives into a driver log", () => {
    // Crossing SURFACE_GLSL_STRIP_BYTES turns stripping ON, which drops
    // the emitted length to roughly a third — so an assertion on the
    // EMITTED length would keep passing at exactly the moment the
    // property it guards (comments surviving into what the driver
    // compiles) breaks. This has to read the RESOLVED length instead.
    // Today's headroom: escape 55845 B (9691 B under), bulb 39357 B
    // (26179 B under).
    //
    // Escape's headroom is worth watching at all because the power links
    // cost that arm two branches (twice, both bodies), the duplicated
    // bulbPow8 and two comment paragraphs — exactly the growth this gate
    // exists to catch. What it protects is READABILITY, not safety: the
    // 82.2KB that crashed Mesa is a long way above the threshold, and
    // stripping is what keeps it out of reach (see the test above).
    //
    // No escape+balloon assertion: at 64681 B it sits only 855 B under
    // the threshold, and crossing is BENIGN — stripped it comes down to
    // ~13KB, far under the cliff — so gating it would fail CI for a
    // non-hazard and teach whoever hits it to bump the number. It is
    // also a measurement-only pairing: balloon is IFS-only and escape is
    // forward, so no shipped session compiles it. With the FINISH arm on
    // it does cross (66714 B), and the SURFACE_FINISH suite below pins
    // that crossing as exactly the benign event this comment predicts.
    // docs/surface-glsl-tracers.md carries both figures.
    expect(surfaceFragmentResolvedFor(1, 0).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    expect(surfaceFragmentResolvedFor(0, 0, 0, 0, 1).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
  });
});

describe("the supersampling jitter uniform", () => {
  const variants: [string, string][] = [
    ["affine", surfaceFragmentFor(0, 0)],
    ["fold lens", surfaceFragmentFor(0, 1)],
    ["balloon", surfaceFragmentFor(0, 0, 1)],
    ["ground plane", surfaceFragmentFor(0, 0, 0, 1)],
    ["lens + plane", surfaceFragmentFor(0, 1, 0, 1)],
    ["escape", surfaceFragmentFor(1, 0)],
    ["bulb", surfaceFragmentFor(0, 0, 0, 0, 1)],
  ];

  it("defaults to the pixel CENTRE, which is what makes a single-pass trace the pre-supersampling one", () => {
    // The whole byte-identity argument rests here: at (0,0,0,0) the two
    // reads below add exactly 0.0, and IEEE addition of +0.0 is exact. A
    // preview, a thumbnail, an offline force frame and pass 0 of a
    // supersampled settle all trace with this value.
    const material = createSurfaceMaterial();
    const jitter = material.uniforms.uPixelJitter.value as THREE.Vector4;
    expect([jitter.x, jitter.y, jitter.z, jitter.w]).toEqual([0, 0, 0, 0]);
  });

  it("enters every variant in exactly two places — the ray and the dither, never the backdrop", () => {
    // The count is the contract, not a style rule. The background gradient
    // is a smooth ramp with nothing to alias AND has to agree with the
    // seed the untraced strips still show, so a third read appearing here
    // would be a bug the passes would average into a soft-edged backdrop.
    for (const [name, src] of variants) {
      expect(countOccurrences(src, "uniform vec4 uPixelJitter;"), name).toBe(1);
      expect(countOccurrences(src, "uPixelJitter"), name).toBe(3);
      expect(src, name).toContain("(vUv + uPixelJitter.xy) * 2.0 - 1.0");
      expect(src, name).toContain("hash(gl_FragCoord.xy + uPixelJitter.zw)");
    }
  });

  it("leaves the background gradient on the UNJITTERED pixel", () => {
    for (const [name, src] of variants) {
      expect(src, name).toContain(
        "mix(uBgBottom, uBgTop, backgroundShapeT(vUv))",
      );
      expect(src, name).toContain("float backgroundShapeT(vec2 p)");
    }
  });
});

describe("setSurfaceSystem fold final lens packing", () => {
  it("packs the lens uniforms, flips SURFACE_FOLD_LENS, and keeps the cores' uFinal* at identity", () => {
    const material = createSurfaceMaterial();
    const de = de3([map3()]);
    de.foldFinal = {
      invM: [1, 0, 0, 0, 2, 0, 0, 0, 4],
      invT: [0.1, -0.2, 0.3],
      sigmaMin: 0.7,
      foldKind: 1,
      invW: 1 / 1.4,
      absW: 1.4,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, de, [black]);
    const u = material.uniforms;
    expect(material.defines.SURFACE_FOLD_LENS).toBe(1);
    const params = u.uLensParams.value as THREE.Vector4;
    expect(params.x).toBe(1);
    expect(params.y).toBeCloseTo(1 / 1.4, 12);
    expect(params.z).toBeCloseTo(1.4, 12);
    expect(params.w).toBeCloseTo(0.7, 12);
    const lensT = u.uLensInvT.value as THREE.Vector3;
    expect([lensT.x, lensT.y, lensT.z]).toEqual([0.1, -0.2, 0.3]);
    // The cores must run their no-lens arithmetic: identity / zero / 1.
    const finalM = u.uFinalInvM.value as THREE.Matrix3;
    expect(Array.from(finalM.elements)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(u.uFinalSigmaMin.value).toBe(1);
  });

  it("keeps every variant's fragment source free of the other variants' text", () => {
    // The measured Mesa edge (the escape arm's own follow-up): the fold
    // variant's compiler crashed when the source merely GREW past ~80KB
    // with preprocessor-dead lens/escape arms — so the arms are resolved
    // JS-side and each variant's source carries only its own bodies.
    const material = createSurfaceMaterial();
    // Default: no lens wrapper, no escape loop, SURFACE_FOLDS still a
    // driver-side conditional.
    expect(material.fragmentShader).not.toContain("surfaceDECore");
    expect(material.fragmentShader).not.toContain("uEscParams.y * y");
    expect(material.fragmentShader).toContain("#if SURFACE_FOLDS");

    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.fragmentShader).toContain("surfaceDECore");
    expect(material.fragmentShader).not.toContain("uEscParams.y * y");
  });

  it("resets the lens uniforms and the define when the next system has no fold final", () => {
    const material = createSurfaceMaterial();
    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 3,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_FOLD_LENS).toBe(1);

    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(material.defines.SURFACE_FOLD_LENS).toBe(0);
    const params = material.uniforms.uLensParams.value as THREE.Vector4;
    expect([params.x, params.y, params.z, params.w]).toEqual([0, 1, 1, 1]);
  });
});

/** Counts non-overlapping occurrences of a literal substring. */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("buildSurfaceFragment shade probe", () => {
  it("keeps every variant free of the probe when built at the beam width (A/A)", () => {
    const source = buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH);
    expect(surfaceFragmentFor(0, 0, 0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(0, 1, 0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(1, 0, 0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
  });

  it("compiles exactly one width-1 probe, routed as the shading taps' value form", () => {
    const resolved = surfaceFragmentFor(
      0,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(1),
    );
    expect(
      countOccurrences(resolved, "float surfaceDEProbe(vec3 p, float cutoff)"),
    ).toBe(1);
    expect(resolved).toContain("return surfaceDEProbe(p, 0.0);");
  });

  it("strips the probe body's comments and indentation, unlike the public descent body", () => {
    const resolved = surfaceFragmentFor(
      0,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(1),
    );
    expect(resolved).toContain("\nvec3 fcQ[1];");
    expect(resolved).toContain("vec3 fcQ[FOLD_W];");
  });

  it("never changes the escape variant's source across probe widths", () => {
    const atWidth1 = surfaceFragmentFor(
      1,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(1),
    );
    const atBeamWidth = surfaceFragmentFor(
      1,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(atWidth1).toBe(atBeamWidth);
  });

  it("carries no probe under the fold lens, which keeps its surfaceDECore rename", () => {
    const resolved = surfaceFragmentFor(
      0,
      1,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(1),
    );
    expect(resolved).not.toContain("surfaceDEProbe");
    expect(resolved).toContain("surfaceDECore");
  });

  it("adds the probe as a new name rather than another surfaceDE overload", () => {
    const needle = "float surfaceDE(vec3 p, float cutoff) {";
    const atWidth1 = surfaceFragmentFor(
      0,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(1),
    );
    const atBeamWidth = surfaceFragmentFor(
      0,
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(countOccurrences(atWidth1, needle)).toBe(
      countOccurrences(atBeamWidth, needle),
    );
  });

  it("ships width 1 by default, so the module's own fragment source carries the probe", () => {
    expect(SURFACE_SHADE_DE_WIDTH).toBe(1);
    const material = createSurfaceMaterial();
    expect(material.fragmentShader).toContain("surfaceDEProbe");
  });
});

describe("SURFACE_BALLOON variant", () => {
  /** The spec scene.ts builds — fractal/balloon-de.ts's buildBalloon
   * convention (margined rho, world-unit R) plus the oracle's far cap. */
  function specFor(de: SurfaceDE, rMult: number): SurfaceBalloonSpec {
    const ball = balloonBall(de);
    return {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: rMult * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
  }

  it("strips every balloon token from every variant while the flag is off — the byte-identity mechanism", () => {
    // With balloon 0 the resolved source must be byte-identical to the
    // pre-balloon build: every added line lives in a resolver-owned
    // SURFACE_BALLOON arm, so no "Balloon"/"uBalloon" token may survive
    // (the shipped shader's own lowercase "balloon ghost" commentary
    // predates the feature and stays).
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 0);
      expect(resolved).not.toContain("Balloon");
      expect(resolved).not.toContain("uBalloon");
    }
  });

  it("compiles the wrapper over every variant with the flag on, leaving no unresolved variant conditionals", () => {
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 1);
      // The wrapper and its rename are in.
      expect(resolved).toContain("#define surfaceDE surfaceDEFractal");
      expect(resolved).toContain("vec3 balloonInvert(vec3 p, out float scale)");
      expect(resolved).toContain("surfaceDEBalloonHitInfo");
      // All three JS-resolved names are gone; only the driver-side
      // SURFACE_FOLDS conditionals may remain.
      expect(resolved).not.toContain("#if SURFACE_BALLOON");
      expect(resolved).not.toContain("#if SURFACE_ESCAPE");
      expect(resolved).not.toContain("#if SURFACE_FOLD_LENS");
    }
    // The affine/folds split stays a driver-side conditional under the
    // balloon, exactly as without it.
    expect(surfaceFragmentFor(0, 0, 1)).toContain("#if SURFACE_FOLDS");
  });

  it("balances the rename chain per variant: one #undef plain/escape, three under the lens", () => {
    // Under balloon+lens the surfaceDEFractal rename is #undef'd before
    // the core rename (a bare re-#define would be a redefinition error),
    // re-established at the lens wrapper head, and #undef'd once more
    // where the balloon wrapper takes the public name.
    expect(
      countOccurrences(surfaceFragmentFor(0, 0, 1), "#undef surfaceDE"),
    ).toBe(1);
    expect(
      countOccurrences(surfaceFragmentFor(1, 0, 1), "#undef surfaceDE"),
    ).toBe(1);
    expect(
      countOccurrences(surfaceFragmentFor(0, 1, 1), "#undef surfaceDE"),
    ).toBe(3);
    // Without the balloon the lens keeps its single shipped #undef.
    expect(
      countOccurrences(surfaceFragmentFor(0, 1, 0), "#undef surfaceDE"),
    ).toBe(1);
    // The core rename survives the balloon exactly once.
    expect(
      countOccurrences(
        surfaceFragmentFor(0, 1, 1),
        "#define surfaceDE surfaceDECore",
      ),
    ).toBe(1);
  });

  it("packs uniforms matching buildBalloon's numbers for a real DE, margined rho and far cap included", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const ball = balloonBall(de);
    const oracle = buildBalloon(de, 1.6);
    const spec = specFor(de, 1.6);
    // The spec-building convention IS the oracle's: same center, same
    // margined divisor, same world-unit R.
    expect(spec.center).toEqual(oracle.center);
    expect(spec.rho).toBe(oracle.rho);
    expect(spec.R).toBe(oracle.R);
    expect(spec.far).toBe(BALLOON_FAR_CAP_RHO * ball.radius);

    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    setSurfaceBalloon(material, spec);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
    const u = material.uniforms;
    const center = u.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([...oracle.center]);
    expect(u.uBalloonRho.value).toBe(oracle.rho);
    expect(u.uBalloonR.value).toBe(oracle.R);
    expect(u.uBalloonFar.value).toBe(BALLOON_FAR_CAP_RHO * ball.radius);
  });

  it("rewrites uniforms without touching the shader on an R-only change", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    const spec = specFor(de, 1.6);
    setSurfaceBalloon(material, spec);
    const shader = material.fragmentShader;

    setSurfaceBalloon(material, { ...spec, R: spec.R * 0.5 });

    // Same string identity — the radius slider's per-drag-tick guarantee.
    expect(material.fragmentShader).toBe(shader);
    expect(material.uniforms.uBalloonR.value).toBe(spec.R * 0.5);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
  });

  it("survives a system swap: the define-comparison blocks preserve the current balloon flag", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    setSurfaceBalloon(material, specFor(de, 1.6));

    // A lens system forces a variant rebuild — the balloon must ride it.
    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
    expect(material.fragmentShader).toContain("surfaceDECore");

    // And null clears it back to the byte-identical pre-balloon source.
    setSurfaceBalloon(material, null);
    expect(material.defines.SURFACE_BALLOON).toBe(0);
    expect(material.fragmentShader).not.toContain("uBalloon");
  });

  it("packs the echo tint's uniforms and the shell-gated base-albedo mix into every variant the balloon composes with", () => {
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 1);
      expect(resolved).toContain("uniform vec3 uBalloonTint;");
      expect(resolved).toContain("uniform float uBalloonTintStrength;");
      // Gated on shell, and on the BASE ALBEDO — before the linear-light
      // lit/specular product a few lines below reads it.
      expect(resolved).toContain(
        "base = mix(base, uBalloonTint, uBalloonTintStrength * shell);",
      );
    }
  });

  it("pays nothing for the echo tint while the balloon is off", () => {
    // uBalloonTint/uBalloonTintStrength both carry the uBalloon prefix the
    // byte-identity test above already nets, but pinning the tint's own
    // tokens independently means a future narrowing of that wider check
    // cannot silently stop covering this one.
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 0);
      expect(resolved).not.toContain("uBalloonTint");
      expect(resolved).not.toContain("uBalloonTintStrength");
      expect(resolved).not.toContain("* shell");
    }
  });

  it("surfaceDEBalloonHitInfo reports shell 1.0 on the inverted term and 0.0 on the fractal term/tie, right after colorPos", () => {
    // escape+balloon stays under the strip threshold (module doc: "the
    // pairing to watch"), so this resolved source keeps its indentation —
    // the one combo in this describe block worth an exact multi-line pin.
    const resolved = surfaceFragmentFor(1, 0, 1);
    expect(resolved).toContain(
      "    vec3 p,\n    out vec3 colorPos,\n    out float shell,\n    out int firstChoice,",
    );
    expect(resolved).toContain(
      "    if (dS < dF) {\n      colorPos = q;\n      shell = 1.0;\n      return scale * surfaceDEFractal(q, firstChoice, trap, rings, sheets);\n    }\n    colorPos = p;\n    shell = 0.0;\n    return surfaceDEFractal(p, firstChoice, trap, rings, sheets);",
    );
  });

  it("packSurfaceBalloonTint writes the tint's three components and the strength onto a material's uniforms", () => {
    const material = createSurfaceMaterial();
    packSurfaceBalloonTint(material, [0.2, 0.4, 0.6], 0.75);
    const tint = material.uniforms.uBalloonTint.value as THREE.Vector3;
    expect([tint.x, tint.y, tint.z]).toEqual([0.2, 0.4, 0.6]);
    expect(material.uniforms.uBalloonTintStrength.value).toBe(0.75);
  });

  it("packSurfaceBalloonTint never touches the shader — a value-only path like the radius slider's", () => {
    const material = createSurfaceMaterial();
    setSurfaceBalloon(material, specFor(de3([map3()]), 1.6));
    const shader = material.fragmentShader;
    const version = material.version;

    packSurfaceBalloonTint(material, [1, 0, 0], 0.5);

    expect(material.fragmentShader).toBe(shader);
    expect(material.version).toBe(version);
  });
});

describe("SURFACE_GROUND_PLANE variant", () => {
  it("strips every ground-plane token from every variant while the flag is off — the byte-identity mechanism", () => {
    for (const [escape, lens, balloon] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
    ] as const) {
      const withPlaneOff = surfaceFragmentFor(escape, lens, balloon, 0);
      expect(withPlaneOff).not.toContain("uGround");
      expect(withPlaneOff).not.toContain("shadeGroundPlane");
      expect(withPlaneOff).not.toContain("SURFACE_GROUND_PLANE");
      // The plane arg omitted must resolve to the same explicit-0 source.
      expect(surfaceFragmentFor(escape, lens, balloon)).toBe(withPlaneOff);
    }
  });

  it("compiles the floor arm with the flag on — comment-stripped whole-source, and far under the fold source's Mesa-cliff budget", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 1);
    expect(resolved).toContain("vec3 shadeGroundPlane(");
    expect(resolved).toContain("uniform float uGroundY;");
    // The driver-side SURFACE_FOLDS conditional survives the strip.
    expect(resolved).toContain("#if SURFACE_FOLDS");
    // Plane programs are comment-stripped whole-source — raw size is what
    // Mesa prices — so no comment marker of either style survives.
    expect(resolved).not.toContain("//");
    expect(resolved).not.toContain("/*");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("composes under the lens and escape variants, both staying far under the Mesa-cliff budget", () => {
    const lensed = surfaceFragmentFor(0, 1, 0, 1);
    expect(lensed).toContain("surfaceDECore");
    expect(lensed).toContain("shadeGroundPlane");
    expect(lensed.length).toBeLessThan(40 * 1024);

    const escaped = surfaceFragmentFor(1, 0, 0, 1);
    expect(escaped).toContain("shadeGroundPlane");
  });

  it("refuses to compile into the balloon variant — no horizon inside the shell", () => {
    expect(() => surfaceFragmentFor(0, 0, 1, 1)).toThrow(RangeError);
  });

  it("setSurfaceGroundPlane packs the spec into uniforms and flips the define; null resets both to the inert byte-identical off state", () => {
    const material = createSurfaceMaterial();
    const spec: SurfaceGroundPlaneSpec = {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
      pattern: 1,
      tileScale: 0.64,
      emission: 1.4,
    };
    setSurfaceGroundPlane(material, spec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(-1.2);
    expect(u.uGroundFadeStart.value).toBe(4);
    expect(u.uGroundFadeEnd.value).toBe(10);
    expect(u.uGroundBallR.value).toBe(1);
    const ballC = u.uGroundBallC.value as THREE.Vector3;
    expect([ballC.x, ballC.y, ballC.z]).toEqual([0, 0, 0]);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([0.62, 0.62, 0.62]);
    expect(u.uGroundPattern.value).toBe(1);
    expect(u.uGroundTileScale.value).toBe(0.64);
    expect(u.uGroundEmission.value).toBe(1.4);
    expect(material.fragmentShader).toContain("shadeGroundPlane");

    setSurfaceGroundPlane(material, null);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(0);
    expect(u.uGroundY.value).toBe(0);
    expect(u.uGroundFadeStart.value).toBe(0);
    expect(u.uGroundFadeEnd.value).toBe(0);
    expect(u.uGroundBallR.value).toBe(1);
    expect([ballC.x, ballC.y, ballC.z]).toEqual([0, 0, 0]);
    expect([albedo.x, albedo.y, albedo.z]).toEqual([1, 1, 1]);
    expect(u.uGroundPattern.value).toBe(0);
    expect(u.uGroundTileScale.value).toBe(0.64);
    expect(u.uGroundEmission.value).toBe(0);
    expect(material.fragmentShader).not.toContain("uGround");
  });

  it("survives a system swap into the lens variant: the define-comparison block preserves the current ground-plane flag", () => {
    const material = createSurfaceMaterial();
    setSurfaceGroundPlane(material, {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    });
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);

    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("surfaceDECore");
    expect(material.fragmentShader).toContain("shadeGroundPlane");
  });

  it("yields seniority to the balloon: enabling the balloon drops the ground plane, and re-enabling the plane over the balloon throws", () => {
    const material = createSurfaceMaterial();
    const spec: SurfaceGroundPlaneSpec = {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    };
    setSurfaceGroundPlane(material, spec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);

    // The spec-building convention IS the SURFACE_BALLOON describe's
    // specFor helper, inlined: buildBalloon's margined rho, world-unit R.
    const de = de3([map3()]);
    const ball = balloonBall(de);
    const balloonSpec: SurfaceBalloonSpec = {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: 1.6 * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
    setSurfaceBalloon(material, balloonSpec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).toContain("uBalloon");
    expect(material.fragmentShader).not.toContain("shadeGroundPlane");

    // The balloon is senior: the plane cannot compile back in over it.
    expect(() => setSurfaceGroundPlane(material, spec)).toThrow(RangeError);
  });
});

describe("SURFACE_ESCAPE orbit trap", () => {
  it("normalizes the escape count by the PASS budget, so a chain reaches the same ramp a single map does", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // uMaxDepth, never uMaxDepth * uMapCount: escapedAt counts single-link
    // steps and an orbit escapes after a handful of them however long the
    // chain is, so a step-budget denominator shrank the reachable slice of
    // the palette with every link added.
    expect(resolved).toContain(
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);",
    );
    expect(resolved).not.toContain("escFrac) / float(steps)");
  });

  it("keeps the step BUDGET as the loop bound and the escaped test, which are per-link quantities", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // Only the trap's denominator moved: the orbit still runs uMaxDepth
    // passes of the whole chain, and "did it escape" still compares
    // against that same step count. (The power links split the growth
    // guard out into the two interpolant arms below it; the escape test
    // itself is unmoved.)
    expect(resolved).toContain("int steps = uMaxDepth * n;");
    expect(resolved).toContain("if (escapedAt < steps) {");
    expect(resolved).toContain("} else if (growth > 1.0) {");
  });

  it("normalizes the same way the bulb arm always has — one convention across both forward-orbit variants", () => {
    const escape = surfaceFragmentFor(1, 0);
    const bulb = surfaceFragmentFor(0, 0, 0, 0, 1);
    const line =
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);";
    expect(escape).toContain(line);
    expect(bulb).toContain(line);
  });
});

describe("SURFACE_ESCAPE variant packing, one uniform slot per chain link", () => {
  /** A three-link chain whose links genuinely differ — fold kind, weight,
   * matrix and translation all vary — plus one inactive (weight 0) map, so
   * uMapCount can be shown to count LINKS rather than document transforms.
   * The chain mirror's own lesson: identical links make every packing
   * mutation pass vacuously, so no two links here share a fold kind, a
   * weight or a
   * matrix. */
  function chain(): Transform[] {
    return [
      {
        id: 0,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      },
      {
        id: 1,
        position: [-0.1, 0.5, 0.2],
        rotation: [0.3, 0.7, -0.2],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: 1.6 }],
      },
      {
        id: 2,
        position: [0, 0.2, -0.3],
        rotation: [0, 0, 0],
        scale: [2, 2, 2],
        variations: [{ type: "spherefold", weight: 1.2 }],
      },
      {
        // Inactive: a document transform that must NOT reach the chain.
        id: 3,
        position: [9, 9, 9],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
        weight: 0,
      },
    ];
  }

  it("setEscapeSystem packs each link's own matrix, translation, fold kind, weight and derivGrowth into its slot, with uMapCount the LINK count", () => {
    const material = createSurfaceMaterial();
    const de = buildEscapeDE(chain());
    expect(de.links).toHaveLength(3); // 4 document transforms, one inactive.
    // The fixture's own guarantee: no two links share a matrix, or the
    // per-slot assertions below would still pass with every link written
    // into slot 0.
    expect(de.links[0].m).not.toEqual(de.links[1].m);
    expect(de.links[1].m).not.toEqual(de.links[2].m);

    setEscapeSystem(material, de, black);

    const u = material.uniforms;
    const escM = u.uEscM.value as THREE.Matrix3[];
    const escT = u.uEscT.value as THREE.Vector3[];
    const escParams = u.uEscParams.value as THREE.Vector4[];
    de.links.forEach((link, i) => {
      const m = link.m;
      // Row-major m packed column-major — the uFinalInvM/uSymStepBack
      // transpose convention (surface-material-4d.test.ts's own pin).
      expect(Array.from(escM[i].elements)).toEqual([
        m[0],
        m[3],
        m[6],
        m[1],
        m[4],
        m[7],
        m[2],
        m[5],
        m[8],
      ]);
      expect([escT[i].x, escT[i].y, escT[i].z]).toEqual(link.t);
      expect(escParams[i].x).toBe(link.kind);
      expect(escParams[i].y).toBe(link.w);
      expect(escParams[i].z).toBe(link.derivGrowth);
    });
    expect(u.uMapCount.value).toBe(3);
  });

  it("packs the kaleidoscope's own order and plane, and leaves uSymStep inert — never the descent's precomputed sector step", () => {
    const material = createSurfaceMaterial();
    const de = buildEscapeDE(chain(), null, { order: 5, plane: "xy" });
    setEscapeSystem(material, de, black);
    const u = material.uniforms;
    expect(u.uSymOrder.value).toBe(5);
    // yz=0, xz=1, xy=2 — the frozen SYM_PLANE_CODE convention pinned above
    // for setSurfaceSystem; setEscapeSystem reads the same table.
    expect(u.uSymPlane.value).toBe(2);
    expect((u.uSymStep.value as THREE.Vector2).x).toBe(1);
    expect((u.uSymStep.value as THREE.Vector2).y).toBe(0);
  });

  it("reaches foldQuerySector in the emitted GLSL, applied ONCE before the orbit and never inside the step loop", () => {
    const resolved = surfaceFragmentFor(1, 0);
    expect(resolved).toContain("vec3 foldQuerySector(vec3 p) {");
    expect(resolved).toContain("float a = uSymPlane == 0 ? p.y : p.x;");
    expect(resolved).toContain(
      "float sector = 6.283185307179586 / float(uSymOrder);",
    );

    // Both orbit-running overloads (the cutoff form and the hit-info form)
    // seed from exactly one call ahead of their own loop — the escape set
    // of v <- F(v) + p only inherits a rotation the SEED carries, never
    // one reapplied mid-orbit (the module's own foldQuerySector comment).
    const callSite = "vec3 q = foldQuerySector(p);";
    const loopHead = "for (int i = 0; i < steps; i++) {";
    expect(countOccurrences(resolved, callSite)).toBe(2);
    expect(countOccurrences(resolved, loopHead)).toBe(2);

    let from = 0;
    for (let i = 0; i < 2; i++) {
      const callIdx = resolved.indexOf(callSite, from);
      const loopIdx = resolved.indexOf(loopHead, from);
      // Both bodies end on the estimate-form switch, which is the last
      // statement either one runs.
      const bodyEnd = resolved.indexOf("return uEscLogForm == 0", loopIdx);
      expect(bodyEnd).toBeGreaterThan(loopIdx);
      expect(loopIdx).toBeGreaterThan(callIdx);
      expect(resolved.slice(loopIdx, bodyEnd)).not.toContain("foldQuerySector");
      from = bodyEnd;
    }
  });

  it("strips every escape token from every other variant while the flag is off — the byte-identity mechanism", () => {
    // escape has no default (unlike balloon/plane/bulb), so every caller in
    // this file passes it explicitly — there is no "omitted" form to check,
    // unlike the other three arms' byte-identity tests.
    for (const [lens, balloon, plane, bulb] of [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ] as const) {
      const resolved = surfaceFragmentFor(0, lens, balloon, plane, bulb);
      expect(resolved).not.toContain("uEscM");
      expect(resolved).not.toContain("uEscT");
      expect(resolved).not.toContain("uEscParams");
      expect(resolved).not.toContain("foldQuerySector");
      expect(resolved).not.toContain("#if SURFACE_ESCAPE");
    }
  });

  it("packs slot 0 from the DE's own head-link ballast fields — EscapeDE still extends EscapeLink, and this redundancy is what surface-de-gpu.test.ts's params-block pin checks on the WGSL side", () => {
    const material = createSurfaceMaterial();
    const de = buildEscapeDE(chain());
    setEscapeSystem(material, de, black);
    const u = material.uniforms;
    const m0 = (u.uEscM.value as THREE.Matrix3[])[0];
    expect(Array.from(m0.elements)).toEqual([
      de.m[0],
      de.m[3],
      de.m[6],
      de.m[1],
      de.m[4],
      de.m[7],
      de.m[2],
      de.m[5],
      de.m[8],
    ]);
    const t0 = (u.uEscT.value as THREE.Vector3[])[0];
    expect([t0.x, t0.y, t0.z]).toEqual(de.t);
    const p0 = (u.uEscParams.value as THREE.Vector4[])[0];
    expect(p0.x).toBe(de.kind);
    expect(p0.y).toBe(de.w);
    expect(p0.z).toBe(de.derivGrowth);
  });
});

describe("SURFACE_ESCAPE cross-family links", () => {
  /** A fold-only chain: the shape that predates the power links, which
   * must keep the linear
   * estimate form to the bit. */
  function foldChain(): Transform[] {
    return [
      {
        id: 0,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      },
      {
        id: 1,
        position: [-0.1, 0.5, 0.2],
        rotation: [0.3, 0.7, -0.2],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: 1.6 }],
      },
    ];
  }

  /** The same chain with its tail link swapped for the triplex power —
   * the cross-family shape the power link exists for. A LONE power map is
   * refused by the gate (the Mandelbulb render owns it), so the fold link
   * ahead of it is load-bearing, not decoration. */
  function powerChain(): Transform[] {
    const maps = foldChain();
    maps[1].variations = [{ type: "bulb", weight: 1 }];
    return maps;
  }

  it("packs uEscLogForm 0 for a fold-only chain and 1 for one carrying a power link", () => {
    const material = createSurfaceMaterial();

    // The default is the linear form, so a material that never sees an
    // escape system reads the fold-only behaviour.
    expect(material.uniforms.uEscLogForm.value).toBe(0);

    const folds = buildEscapeDE(foldChain());
    expect(folds.logEstimate).toBe(false);
    setEscapeSystem(material, folds, black);
    expect(material.uniforms.uEscLogForm.value).toBe(0);

    const powers = buildEscapeDE(powerChain());
    expect(powers.logEstimate).toBe(true);
    setEscapeSystem(material, powers, black);
    expect(material.uniforms.uEscLogForm.value).toBe(1);

    // And BACK: a later fold-only chain must clear the flag, or it would
    // read the Boettcher form off a linear orbit — the stale-uniform bug
    // this packer's every other field is written to avoid.
    setEscapeSystem(material, buildEscapeDE(foldChain()), black);
    expect(material.uniforms.uEscLogForm.value).toBe(0);
  });

  it("reads the terminal radius through the flag in BOTH bodies, never through the link that terminated", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // The value form and the hit-info form both end on the same switch:
    // 0.5*r*ln r is continuous in r, so the flag moves no seam across the
    // surface, where a per-link choice would put a step wherever a chain
    // changed which kind escaped.
    expect(countOccurrences(resolved, "return uEscLogForm == 0")).toBe(2);
    expect(
      countOccurrences(resolved, "r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr"),
    ).toBe(2);
    expect(countOccurrences(resolved, "uniform int uEscLogForm;")).toBe(1);
  });

  it("guards the fold dispatch behind kind < 4, so a power kind cannot fall through both negative tests", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // The whole hazard in one assertion: kind 4 satisfies BOTH != 2 and
    // != 1, so without the guard a bulb link would run the box fold and
    // the sphere fold and then the power on top of them.
    expect(countOccurrences(resolved, "if (kind < 4) {")).toBe(2);
    expect(countOccurrences(resolved, "} else if (kind == 4) {")).toBe(2);
    // Both power branches compute their local factor BEFORE overwriting
    // y — the oracle's own order, and the one way to get this wrong that
    // still renders something.
    expect(
      countOccurrences(
        resolved,
        "localL = 8.0 * (r2y * r2y * r2y * sqrt(r2y));\n        y = bulbPow8(y, r2y);",
      ),
    ).toBe(2);
    expect(
      countOccurrences(
        resolved,
        "localL = 2.0 * length(y);\n        y = vec3(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);",
      ),
    ).toBe(2);
  });

  it("interpolates a power-terminated orbit's escape count the POWER map's way, off the DEGREE of the link that produced the radius", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // A pre-scaled power link routinely has growth = |w|*sigma_max below
    // 1, so the constant-factor guard fires and escFrac falls to 0 — the
    // raw integer step function, the palette confetti, through the back
    // door. The degree is tracked per step beside growth.
    expect(resolved).toContain(
      "lastPower = kind == 4 ? 8.0 : (kind == 5 ? 2.0 : 0.0);",
    );
    expect(resolved).toContain(
      "escFrac = clamp(log(log(r) / log(uBoundingRadius)) / log(lastPower), 0.0, 1.0);",
    );
    // ...and the fold arm survives underneath it, unchanged.
    expect(resolved).toContain(
      "escFrac = clamp(log(r / uBoundingRadius) / log(growth), 0.0, 1.0);",
    );
    // The power arm is the SURFACE_BULB arm's own expression with the
    // link's degree in place of its literal 8.
    expect(surfaceFragmentFor(0, 0, 0, 0, 1)).toContain(
      "escFrac = clamp(log(log(r) / log(bail)) / log(8.0), 0.0, 1.0);",
    );
  });

  it("emits the bulb arm's bulbPow8 character for character, which is what keeps the duplicate from drifting", () => {
    // The two forward-orbit arms are ALTERNATIVES — surfaceFragmentFor
    // refuses the pair — so a chain link of kind 4 cannot call the bulb
    // arm's definition and the escape arm carries its own copy. Both
    // mirror variations.ts's triplexPow8; this is the pin that makes a
    // one-sided edit to either fail here rather than in a browser.
    const body = (src: string): string => {
      const start = src.indexOf("  vec3 bulbPow8(vec3 y, float r2) {");
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf("\n  }\n", start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end + 4);
    };
    const escape = body(surfaceFragmentFor(1, 0));
    const bulb = body(surfaceFragmentFor(0, 0, 0, 0, 1));
    expect(escape).toBe(bulb);
    // The extracted text is the whole function, not a prefix that would
    // match on any two shaders declaring it.
    expect(escape).toContain("return vec3(rho * s * u8, rho * s * v8, vz);");
    expect(countOccurrences(surfaceFragmentFor(1, 0), "vec3 bulbPow8(")).toBe(
      1,
    );
  });
});

describe("SURFACE_BULB variant", () => {
  /** The classic Mandelbulb shape `analyzeBulbSystem` admits, with a
   * NON-UNIT uniform scale so `sigmaMax` is a value distinguishable from
   * 1 — dropping either of the estimator's two `sigma_max(M)` terms is a
   * bit-exact no-op on an identity or rotation map. */
  function scaledBulb(): Transform {
    return {
      id: 0,
      position: [0.05, -0.1, 0.02],
      rotation: [0, 0, 0],
      scale: [1.3, 1.3, 1.3],
      variations: [{ type: "bulb", weight: 1 }],
    };
  }

  it("strips every bulb token from every other variant while the flag is off — the byte-identity mechanism", () => {
    for (const [escape, lens, balloon] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, balloon, 0, 0);
      expect(resolved).not.toContain("uBulb");
      // bulbPow8 is the ONE exception, and only for the escape arm: a
      // chain link of kind 4 applies the triplex power, and the two
      // forward-orbit arms are alternatives, so the escape arm carries
      // its own copy of the function rather than reading this one. The
      // descent variants still see neither.
      if (escape === 0) {
        expect(resolved).not.toContain("bulbPow8");
      }
      // The arm is resolved away entirely — only the shipped shader's own
      // "closes SURFACE_BULB's #else arm" commentary names it.
      expect(resolved).not.toContain("#if SURFACE_BULB");
      // The bulb arg omitted must resolve to the same explicit-0 source.
      expect(surfaceFragmentFor(escape, lens, balloon, 0)).toBe(resolved);
    }
  });

  it("replaces the descent bodies wholesale with the forward power orbit, leaving no unresolved variant conditional and a source far under the Mesa cliff", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    expect(resolved).toContain("vec3 bulbPow8(vec3 y, float r2)");
    expect(resolved).toContain("uniform vec4 uBulbParams;");
    // Three overloads (cutoff form, no-arg form, hit form) and none of
    // the inverse-descent machinery.
    expect(countOccurrences(resolved, "float surfaceDE(")).toBe(3);
    expect(resolved).not.toContain("fcQ");
    expect(resolved).not.toContain("surfaceDECore");
    // The escape variant's own forward loop is gone too — the uEsc*
    // uniforms are declared unconditionally, its BODY is not.
    expect(resolved).not.toContain("uEscParams.z * localL * dr");
    expect(resolved).not.toContain("#if SURFACE_BULB");
    expect(resolved).not.toContain("#if SURFACE_ESCAPE");
    expect(resolved).not.toContain("#if SURFACE_FOLD_LENS");
    // The affine/folds split stays a driver-side conditional.
    expect(resolved).toContain("#if SURFACE_FOLDS");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("carries the three terms an identity-map fixture cannot see: the sigma seed, the sigma floor, and the ln|y| clamp", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    // dr seeds at sigma_max(M), not 1 — dy0/dp IS M.
    expect(resolved).toContain("float dr = sigma;");
    // ...and the recurrence's trailing + sigma is escape-de.ts's + 1
    // carried through M, which also floors dr.
    expect(resolved).toContain(
      "dr = 8.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;",
    );
    // A converging orbit reaches |y| < 1, where ln|y| is negative and a
    // negative estimate marches the tracer backwards.
    expect(
      countOccurrences(resolved, "r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr"),
    ).toBe(2);
  });

  it("interpolates the escape count the POWER map's way, never the fold arm's constant-factor way", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    // r -> r^n each step, so the smooth iteration count's fraction is
    // log(log r / log R)/log n — the fold arm's log(r/R)/log(growth)
    // models a constant expansion factor and is wrong here.
    expect(resolved).toContain(
      "escFrac = clamp(log(log(r) / log(bail)) / log(8.0), 0.0, 1.0);",
    );
    expect(resolved).not.toContain("log(r / uBoundingRadius)");
    expect(resolved).toContain(
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);",
    );
  });

  it("refuses to compile alongside the escape variant — each replaces the descent bodies wholesale", () => {
    expect(() => surfaceFragmentFor(1, 0, 0, 0, 1)).toThrow(RangeError);
  });

  it("composes with the ground plane, the classic floor an escape-family object sits on", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 1, 1);
    expect(resolved).toContain("shadeGroundPlane");
    expect(resolved).toContain("uBulbParams");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("setBulbSystem packs the DE onto the bulb uniforms and flips the variant, with the ORBIT bailout kept off the marching radius", () => {
    const material = createSurfaceMaterial();
    const de = buildBulbDE([scaledBulb()]);
    setBulbSystem(material, de, [0.2, 0.4, 0.6]);

    expect(material.defines.SURFACE_BULB).toBe(1);
    expect(material.defines.SURFACE_ESCAPE).toBe(0);
    expect(material.defines.SURFACE_FOLDS).toBe(0);
    expect(material.fragmentShader).toContain("bulbPow8");

    const u = material.uniforms;
    const params = u.uBulbParams.value as THREE.Vector4;
    expect(params.x).toBeCloseTo(de.sigmaMax, 12);
    expect(params.y).toBeCloseTo(de.bailout, 12);
    // A uniformly scaled map has sigmaMax = the scale, so the fixture
    // actually exercises the terms the identity map hides.
    expect(de.sigmaMax).toBeCloseTo(1.3, 12);
    // The marching ball is the QUERY-space radius, NOT the orbit's
    // bailout — the one place this wire differs from the escape mode's,
    // where the two were the same number.
    expect(u.uBoundingRadius.value).toBeCloseTo(de.boundingRadius, 12);
    expect(u.uVisibleRadius.value).toBeCloseTo(de.boundingRadius, 12);
    expect(de.bailout).toBeGreaterThan(de.boundingRadius * 2);
    expect(u.uMaxDepth.value).toBe(BULB_ITERATIONS);
    expect(u.uStepScale.value).toBe(BULB_STEP_SCALE);
    expect(u.uMapCount.value).toBe(1);
    expect(u.uSymOrder.value).toBe(1);
  });

  it("hands the descent bodies back when a later system installs over it", () => {
    const material = createSurfaceMaterial();
    setBulbSystem(material, buildBulbDE([scaledBulb()]), [0, 0, 0]);
    expect(material.defines.SURFACE_BULB).toBe(1);

    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(material.defines.SURFACE_BULB).toBe(0);
    expect(material.fragmentShader).not.toContain("bulbPow8");
  });
});

describe("the present blit strips coverage alpha", () => {
  // The tracers write the COVERAGE flag into alpha (miss = 0), a private
  // side-channel of the trace targets. three r163+ creates the canvas
  // WebGL context alpha:true regardless of the renderer's `alpha` param,
  // so a coverage-0 pixel that reaches the canvas makes the
  // premultiplied compositor ADD the page background to the pane —
  // measured as exactly +#0f1018 on every miss pixel of a WebGL surface
  // settle, the whole of the two 4D arms' IoU 0.24/0.35 divergence. The
  // blit is every surface present's last hop (settle, preview, compute
  // DataTexture, capture's present-then-toBlob), so alpha must die here.
  it("forces alpha to 1 so the coverage flag never reaches the always-alpha:true canvas", () => {
    const material = createSurfaceBlitMaterial(new Texture());
    expect(material.fragmentShader).toContain(
      "outColor = vec4(texture(uSrc, vUv).rgb, 1.0);",
    );
    expect(material.fragmentShader).not.toContain(
      "outColor = texture(uSrc, vUv);",
    );
  });
});

/** Every BOX-BRANCH DECODE the assembled fragment source carries, in
 * emission order — the GLSL twin of `surface-de-gpu.ts`'s WGSL block and
 * the same correctness core: the lines that turn a fold branch index `b`
 * into its per-axis preimage selectors `selX`/`selY`/`selZ` and from them
 * the `pre` preimage and the `dd` distance fan the branch floor is built
 * out of. GLSL has no way to share a fragment of a loop body either, so
 * each descent in this file carries its own copy.
 *
 * Anchored `int bb = kind == 1 ? b : b % 27;` (the decode's first line)
 * through `float boxRd = length(dd);` (its last) — both appear exactly
 * once per copy and nowhere else — then dedented by the block's own
 * common indent, since the copies sit at three different nesting depths
 * and are otherwise the same text.
 *
 * Read against `buildSurfaceFragment` rather than a `surfaceFragmentFor`
 * variant on purpose: `resolveVariantArms` only ever DELETES arms, so the
 * assembled source is the superset every variant is cut from and a copy
 * cannot hide in an arm this test did not resolve. */
function boxBranchDecodes(glsl: string): string[] {
  const START = "int bb = kind == 1 ? b : b % 27;";
  const END = "float boxRd = length(dd);";
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const hit = glsl.indexOf(START, at);
    if (hit === -1) return out;
    const from = glsl.lastIndexOf("\n", hit) + 1;
    const endHit = glsl.indexOf(END, hit);
    if (endHit === -1) {
      throw new Error(`box-branch decode at ${String(hit)} has no "${END}"`);
    }
    const to = glsl.indexOf("\n", endHit);
    const lines = glsl.slice(from, to).split("\n");
    const indent = Math.min(
      ...lines
        .filter((line) => line.trim().length > 0)
        .map((line) => line.length - line.trimStart().length),
    );
    out.push(lines.map((line) => line.slice(indent)).join("\n"));
    at = to;
  }
}

describe("box-branch decode duplication", () => {
  it("emits the box-branch decode character for character in all four descents that carry one, so a branch fix landing in the beam descent and not the lens wrappers cannot ship", () => {
    // At the beam width the probe instance is not emitted (foldDescentGlsl's
    // own contract), which leaves the four hand-written copies: the fold
    // beam descent, the fold hit-info descent, and the SURFACE_FOLD_LENS
    // wrapper's value and hit-info sweeps.
    const copies = boxBranchDecodes(
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(copies).toHaveLength(4);
    for (const [i, copy] of copies.entries()) {
      expect(copy, `copy ${String(i)}`).toBe(copies[0]);
    }
    // The extracted text is the whole decode, not a prefix any two blocks
    // opening with the same `int bb` line would match.
    expect(copies[0]).toContain("int selZ = bb / 9;");
    expect(copies[0]).toContain(
      "selX == 0 ? pre0.x : (selX == 1 ? pre1.x : pre2.x),",
    );
    expect(copies[0]).toContain(
      "selZ == 0 ? max(dUp.z, dDn.z) : (selZ == 1 ? dUp.z : dDn.z)",
    );
    expect(copies[0].split("\n")).toHaveLength(15);
  });

  it("gives the shipped build's narrow shading probe the same decode, token for token — its indentation is gone because foldProbeGlsl strips the instance, its code is not", () => {
    // SURFACE_SHADE_DE_WIDTH is 1, so the shipped source carries a FIFTH
    // copy: foldDescentGlsl instantiated as surfaceDEProbe. That one goes
    // out through stripGlslComments, which trims every line, so the shared
    // dedent above cannot line it up with the others — comparing per-line
    // TRIMMED text is what is left, and it still catches any token drift.
    const trimmed = (block: string): string =>
      block
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
    const copies = boxBranchDecodes(
      buildSurfaceFragment(SURFACE_SHADE_DE_WIDTH),
    ).map(trimmed);
    expect(copies).toHaveLength(5);
    for (const [i, copy] of copies.entries()) {
      expect(copy, `copy ${String(i)}`).toBe(copies[0]);
    }
  });

  it("leaves the decode out of every arm that has no fold branch enumeration, so a copy appearing in one would move a count here", () => {
    // The census the identity tests are read against. The escape and bulb
    // arms replace the descent bodies wholesale with a forward orbit,
    // which enumerates nothing; the affine ladder folds nothing either, so
    // its copies come from the lens wrapper alone.
    expect(boxBranchDecodes(surfaceFragmentFor(1, 0))).toHaveLength(0);
    expect(boxBranchDecodes(surfaceFragmentFor(0, 0, 0, 0, 1))).toHaveLength(0);
    // Both fold arms of the resolved variants, at the shipped probe width:
    // three without the lens (beam descent, its probe, hit-info) and four
    // with it (no probe under the lens, plus the two lens sweeps).
    expect(boxBranchDecodes(surfaceFragmentFor(0, 0))).toHaveLength(3);
    expect(boxBranchDecodes(surfaceFragmentFor(0, 1))).toHaveLength(4);
  });
});

describe("the balloon's empty-space-grid gate", () => {
  it("keeps the out-of-box refusal inside the balloon arm, so every other variant's source is untouched", () => {
    // The guard exists because a balloon ray marches from the camera to
    // the far cap and leaves the grid cube, where an edge-clamped read
    // returns a border cell's fractal-only floor. Non-balloon marches are
    // confined to the traced sphere inside the cube and never meet it —
    // so the text lives in a resolver-owned SURFACE_BALLOON arm and the
    // shipped fold/affine/escape programs are byte-identical to their
    // pre-gate selves.
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      expect(surfaceFragmentFor(escape, lens, 0)).not.toContain("gridUv");
    }
    expect(surfaceFragmentFor(0, 0, 1)).toContain("gridUv");
  });

  it("refuses the skip outside the cube rather than clamping to a border cell's floor", () => {
    // The texture coordinate is p * uGridInvSpan + 0.5, so [0,1]^3 IS the
    // cube: outside it the loop breaks and the sample pays the analytic
    // union DE instead of stepping by a floor that bounds only the
    // fractal.
    const balloon = surfaceFragmentFor(0, 0, 1);
    expect(balloon).toContain("any(lessThan(gridUv, vec3(0.0)))");
    expect(balloon).toContain("any(greaterThan(gridUv, vec3(1.0)))");
    // Still one grid fetch per skip iteration, gated ahead of it.
    expect(countOccurrences(balloon, "texture(uGridTex")).toBe(1);
  });

  it("setSurfaceGridEnabled flips the march's reads without disturbing the installed grid", () => {
    // The radius slider's path: the predicate is re-answered per frame
    // while the cube, its floors and its span stay exactly as built.
    const material = createSurfaceMaterial();
    const texture = new Data3DTexture(new Float32Array(8), 2, 2, 2);
    setSurfaceGrid(material, texture, 4);
    expect(material.uniforms.uGridEnabled.value).toBe(1);

    setSurfaceGridEnabled(material, false);
    expect(material.uniforms.uGridEnabled.value).toBe(0);
    expect(material.uniforms.uGridTex.value).toBe(texture);
    expect(material.uniforms.uGridInvSpan.value).toBe(1 / 8);

    setSurfaceGridEnabled(material, true);
    expect(material.uniforms.uGridEnabled.value).toBe(1);
    expect(material.uniforms.uGridTex.value).toBe(texture);
    expect(material.uniforms.uGridInvSpan.value).toBe(1 / 8);
  });
});

describe("SURFACE_FINISH variant", () => {
  /** Every legal variant pairing — the twelve the strip-rule test above
   * enumerates — as (escape, lens, balloon, plane, bulb) tuples, so the
   * finish arm is checked against ALL of them rather than a sample. */
  const pairings: [string, [number, number, number, number, number]][] = [
    ["affine", [0, 0, 0, 0, 0]],
    ["fold lens", [0, 1, 0, 0, 0]],
    ["balloon", [0, 0, 1, 0, 0]],
    ["ground plane", [0, 0, 0, 1, 0]],
    ["lens + balloon", [0, 1, 1, 0, 0]],
    ["lens + plane", [0, 1, 0, 1, 0]],
    ["escape", [1, 0, 0, 0, 0]],
    ["escape + balloon", [1, 0, 1, 0, 0]],
    ["escape + plane", [1, 0, 0, 1, 0]],
    ["bulb", [0, 0, 0, 0, 1]],
    ["bulb + balloon", [0, 0, 1, 0, 1]],
    ["bulb + plane", [0, 0, 0, 1, 1]],
  ];

  const fetchLine =
    "vec3 col = finishShade(base, pos, n, rd, shadow, ao, background, uMapFinishA[fSlot], uMapFinishB[fSlot]);";

  /** A finish with every field away from classic and every field a
   * different number, so a lane landing one component off is visible. */
  const authored = resolveSurfaceFinish({
    specular: 0.9,
    shininess: 64,
    metalness: 0.3,
    reflect: 0.5,
    transmit: 0.2,
  });

  it("strips every finish token from every variant while the flag is off — the byte-identity mechanism", () => {
    // With finish 0 the resolved source must be byte-identical to the
    // pre-finish build: every added line lives in a resolver-owned
    // SURFACE_FINISH arm, so no finishShade/uMapFinish token may survive,
    // and the omitted argument must mean exactly the explicit 0.
    for (const [name, [escape, lens, balloon, plane, bulb]] of pairings) {
      const explicit = surfaceFragmentResolvedFor(
        escape,
        lens,
        balloon,
        plane,
        bulb,
        0,
      );
      expect(explicit, name).not.toContain("finishShade");
      expect(explicit, name).not.toContain("uMapFinish");
      expect(explicit, name).not.toContain("SURFACE_FINISH");
      expect(
        surfaceFragmentResolvedFor(escape, lens, balloon, plane, bulb),
        name,
      ).toBe(explicit);
      expect(surfaceFragmentFor(escape, lens, balloon, plane, bulb), name).toBe(
        surfaceFragmentFor(escape, lens, balloon, plane, bulb, 0),
      );
    }
  });

  it("compiles exactly one finishShade and the per-map fetch into EVERY variant with the flag on — the forward arms included, with no refusal of its own", () => {
    for (const [name, [escape, lens, balloon, plane, bulb]] of pairings) {
      const resolved = surfaceFragmentResolvedFor(
        escape,
        lens,
        balloon,
        plane,
        bulb,
        1,
      );
      // The arrays are declared in the SHARED uniform section, so the
      // escape and bulb arms — which replace the descent bodies
      // wholesale — read them exactly as the descents do.
      expect(resolved, name).toContain("uniform vec4 uMapFinishA[MAX_MAPS];");
      expect(resolved, name).toContain("uniform vec4 uMapFinishB[MAX_MAPS];");
      expect(
        countOccurrences(
          resolved,
          "vec3 finishShade(vec3 base, vec3 pos, vec3 n, vec3 rd, float shadow, float ao, vec3 bg, vec4 fa, vec4 fb) {",
        ),
        name,
      ).toBe(1);
      expect(resolved, name).toContain(
        "int fSlot = clamp(firstChoice, 0, uMapCount - 1);",
      );
      expect(countOccurrences(resolved, fetchLine), name).toBe(1);
      // The JS-resolved directive is gone; only SURFACE_FOLDS may remain.
      expect(resolved, name).not.toContain("#if SURFACE_FINISH");
      // The #else branch — today's fixed formula — was resolved away: its
      // literal highlight is the one line no other arm shares.
      expect(resolved, name).not.toContain("32.0) * 0.4;");
      expect(resolved, name).not.toContain(
        "vec3 col = pow(linBase * lit + vec3(specular * shadow), vec3(1.0 / 2.2));",
      );
    }
    // The two existing refusals hold with the finish on; the finish adds
    // none.
    expect(() => surfaceFragmentFor(0, 0, 1, 1, 0, 1)).toThrow(RangeError);
    expect(() => surfaceFragmentFor(1, 0, 0, 0, 1, 1)).toThrow(RangeError);
  });

  it("leaves the fixed formula in place with the flag off, so the unfinished program is today's program", () => {
    for (const [name, [escape, lens, balloon, plane, bulb]] of pairings) {
      const resolved = surfaceFragmentResolvedFor(
        escape,
        lens,
        balloon,
        plane,
        bulb,
        0,
      );
      expect(resolved, name).toContain(
        "float specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;",
      );
    }
  });

  it("tips the escape+balloon pairing over the strip threshold — benignly: the emitted program is the stripped token stream, a fifth of the size", () => {
    // Measured at the finish arm's landing: 64681 B -> 66714 B resolved,
    // the one pairing whose strip status the arm flips. It is a
    // measurement-only pairing (balloon is IFS-only, escape is forward),
    // and crossing costs it nothing but its commentary in a driver log.
    // Pinned as the CONTRACT — over the threshold, therefore stripped —
    // rather than as the figures.
    const resolved = surfaceFragmentResolvedFor(1, 0, 1, 0, 0, 1);
    expect(resolved.length).toBeGreaterThan(SURFACE_GLSL_STRIP_BYTES);
    const emitted = surfaceFragmentFor(1, 0, 1, 0, 0, 1);
    expect(emitted).not.toContain("//");
    expect(emitted).not.toContain("/*");
    expect(emitted.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES / 4);
    // Off, the same pairing is still emitted whole (the pre-finish
    // record's "pairing to watch", unmoved by an arm that is off).
    expect(surfaceFragmentResolvedFor(1, 0, 1, 0, 0, 0).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
  });

  it("keeps the two shipped forward arms under the strip threshold with the finish on, so a finished escape or bulb session still reads as source in a driver log", () => {
    // The same readability property the flag-off test above gates, one
    // arm over: measured 57878 B (escape) and 41390 B (bulb) at landing.
    expect(surfaceFragmentResolvedFor(1, 0, 0, 0, 0, 1).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    expect(surfaceFragmentResolvedFor(0, 0, 0, 0, 1, 1).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
  });

  it("defaults every finish slot to the CLASSIC lanes, never zero, so a stray enabled read renders the fixed highlight rather than matte black", () => {
    const material = createSurfaceMaterial();
    expect(material.defines.SURFACE_FINISH).toBe(0);
    const laneA = material.uniforms.uMapFinishA.value as THREE.Vector4[];
    const laneB = material.uniforms.uMapFinishB.value as THREE.Vector4[];
    expect(laneA).toHaveLength(SURFACE_MAX_MAPS);
    expect(laneB).toHaveLength(SURFACE_MAX_MAPS);
    const classic = surfaceFinishLanes(CLASSIC_SURFACE_FINISH);
    expect(classic.a).toEqual([0.4, 32, 0, 0]);
    for (let j = 0; j < SURFACE_MAX_MAPS; j++) {
      expect(laneA[j].toArray()).toEqual(classic.a);
      expect(laneB[j].toArray()).toEqual(classic.b);
    }
  });

  it("setSurfaceFinishes packs each slot's lanes in surfaceFinishLanes' order, resets the rest to classic, flips the define and recompiles", () => {
    const material = createSurfaceMaterial();
    const versionBefore = material.version;
    const second = resolveSurfaceFinish({ specular: 0.1, shininess: 8 });
    setSurfaceFinishes(material, [authored, second]);

    const laneA = material.uniforms.uMapFinishA.value as THREE.Vector4[];
    const laneB = material.uniforms.uMapFinishB.value as THREE.Vector4[];
    expect(laneA[0].toArray()).toEqual([0.9, 64, 0.3, 0.5]);
    expect(laneB[0].toArray()).toEqual([0.2, 1, 0, 0]);
    expect(laneA[1].toArray()).toEqual([0.1, 8, 0, 0]);
    expect(laneB[1].toArray()).toEqual([0, 1, 0, 0]);
    // Slot 2 onward: the classic lanes, not a leftover and not zero.
    expect(laneA[2].toArray()).toEqual([0.4, 32, 0, 0]);
    expect(laneA[SURFACE_MAX_MAPS - 1].toArray()).toEqual([0.4, 32, 0, 0]);

    expect(material.defines.SURFACE_FINISH).toBe(1);
    expect(material.fragmentShader).toContain("vec3 finishShade(");
    expect(material.fragmentShader).toContain(
      "uniform vec4 uMapFinishA[MAX_MAPS];",
    );
    expect(material.fragmentShader).not.toContain("32.0) * 0.4;");
    expect(material.version).toBeGreaterThan(versionBefore);
  });

  it("rewrites the lanes without touching the shader on a value-only change, and null hands the fixed formula back with every slot classic", () => {
    const material = createSurfaceMaterial();
    setSurfaceFinishes(material, [authored]);
    const version = material.version;
    const shader = material.fragmentShader;

    // A finish slider's per-drag tick: lanes move, the program does not.
    setSurfaceFinishes(material, [{ ...authored, reflect: 1 }]);
    const laneA = material.uniforms.uMapFinishA.value as THREE.Vector4[];
    expect(laneA[0].toArray()).toEqual([0.9, 64, 0.3, 1]);
    expect(material.version).toBe(version);
    expect(material.fragmentShader).toBe(shader);

    // null: the caller's gate says the document is classic.
    setSurfaceFinishes(material, null);
    expect(material.defines.SURFACE_FINISH).toBe(0);
    expect(laneA[0].toArray()).toEqual([0.4, 32, 0, 0]);
    expect(material.fragmentShader).not.toContain("finishShade");
    expect(material.fragmentShader).toContain("32.0) * 0.4;");
    expect(material.fragmentShader).toBe(surfaceFragmentFor(0, 0));
    expect(material.version).toBeGreaterThan(version);
    // A second null is a no-op on the program.
    const settled = material.version;
    setSurfaceFinishes(material, null);
    expect(material.version).toBe(settled);
  });

  it("survives every recompose site: a system swap, the lens, the forward arms, the balloon and the floor all preserve the finish define and its text", () => {
    const material = createSurfaceMaterial();
    setSurfaceFinishes(material, [authored]);
    const finished = (what: string) => {
      expect(material.defines.SURFACE_FINISH, what).toBe(1);
      expect(material.fragmentShader, what).toContain(fetchLine);
      expect(material.fragmentShader, what).not.toContain("32.0) * 0.4;");
    };

    // setSurfaceSystem, affine then lens (a variant rebuild).
    setSurfaceSystem(material, de3([map3()]), [black]);
    finished("affine system");
    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.fragmentShader).toContain("surfaceDECore");
    finished("lens system");

    // The forward arms: escape, then bulb (each replaces the descent
    // bodies wholesale, so each is a full rebuild).
    setEscapeSystem(
      material,
      buildEscapeDE([
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
      ]),
      black,
    );
    expect(material.defines.SURFACE_ESCAPE).toBe(1);
    finished("escape system");
    setBulbSystem(
      material,
      buildBulbDE([
        {
          id: 0,
          position: [0.05, -0.1, 0.02],
          rotation: [0, 0, 0],
          scale: [1.3, 1.3, 1.3],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ]),
      black,
    );
    expect(material.defines.SURFACE_BULB).toBe(1);
    finished("bulb system");

    // Back to a descent, then the two scene arms on and off.
    const de = de3([map3()]);
    setSurfaceSystem(material, de, [black]);
    const ball = balloonBall(de);
    setSurfaceBalloon(material, {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: 1.6 * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    });
    expect(material.defines.SURFACE_BALLOON).toBe(1);
    finished("balloon on");
    setSurfaceBalloon(material, null);
    finished("balloon off");
    setSurfaceGroundPlane(material, {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    });
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    finished("plane on");
    setSurfaceGroundPlane(material, null);
    finished("plane off");

    // And the finish setter reads the CURRENT arms back: clearing it over
    // a live floor keeps the floor.
    setSurfaceGroundPlane(material, {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    });
    setSurfaceFinishes(material, null);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("shadeGroundPlane");
    expect(material.fragmentShader).not.toContain("finishShade");
  });

  it("refuses more finish slots than the per-map arrays carry", () => {
    const material = createSurfaceMaterial();
    expect(() =>
      setSurfaceFinishes(
        material,
        Array.from({ length: SURFACE_MAX_MAPS + 1 }, () => authored),
      ),
    ).toThrow(RangeError);
    expect(() =>
      setSurfaceFinishes(
        material,
        Array.from({ length: SURFACE_MAX_MAPS }, () => authored),
      ),
    ).not.toThrow();
  });
});
