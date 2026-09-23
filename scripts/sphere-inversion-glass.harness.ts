/**
 * THE LOOK GATE: what curved glass on the sphere-inversion family actually
 * looks like, rendered before a line of production code exists.
 *
 * The finite-solid glass direction reached its ceiling in the GEOMETRY, not
 * in the transport: the admitted optical solid is either the condensation
 * union at the ROOT (curved, but not a fractal) or a level-N cell
 * construction (a fractal, but flat-faced — boxes, and simplices after the
 * replacement). Raising the level buys smaller facets at every N and never a
 * curved silhouette. This sheet asks the one question that decides whether a
 * CURVED closed solid is worth building: does dielectric glass on the
 * sphere-inversion family's depth-D seed orbit read like glass.
 *
 * WHY THIS FAMILY IS THE CHEAP INSTANCE. `docs/surface-dielectric-transport.md`
 * records the scope wall that forced the pivot — the estimator march "can
 * find a boundary only from OUTSIDE, so a refracted child — which is what
 * glass IS — either misses the domain without a crossing or crawls its
 * anchor suppression into the step cap". Glass needs a SIGN. This family
 * nearly has one already: `sphere-inversion-de.ts` decides membership
 * exactly ("a return `<= 0` is a MEMBER SIGNAL in folded coordinates (the
 * folded seed SDF, untransported)"), and the folded seed is an intersection
 * of generalized balls whose member SDFs are exact, so the interior
 * clearance in FOLDED coordinates is the closed form `-sdfIntersection` with
 * nothing to derive.
 *
 * THE ONE PIECE THAT LOOKED NEW IS NOT. Carrying that folded clearance back
 * out through the fold's `k` inversions needs the FULL-ball law where
 * `transportSphereInversionBound` carries the EMPTY-ball one. Writing the
 * image ball out with `inversion.ts`'s identity (inversion takes `B(c, r)`
 * to `B(scale·c, scale·r)` with `scale = R²/(|c|² − r²)`): for a folded
 * clearance `rho` at distance `s` from the inversion centre, the clearance
 * at the unfolded point `p` (at `r = R²/s`) is
 *
 *     R²·rho / (s·(s + rho))  =  r²·rho / (R² + r·rho),
 *
 * which is `inversionDistanceLowerBound`'s expression term for term. The two
 * laws are the SAME MAP, so this prototype transports the interior clearance
 * with the shipped exterior function and no new arithmetic — and the
 * production child inherits that, not a second derivation. The soundness
 * probe below checks it numerically against the explicit orbit rather than
 * trusting the algebra.
 *
 * WHAT THIS SHEET IS. The look evidence for the SHIPPED signed field —
 * `sphereInversionSignedDistance`/`...4` — driven through
 * `surface-dielectric.ts`, the ONE transport oracle, over the closed-solid
 * boundary query's f64 twin. No new optical model; no displacement. Both
 * dimensions in the same sheet.
 *
 * It was written the other way round: the gate ran first, against a
 * prototype field assembled here from public calls alone, so that no
 * production module existed before the look was seen. The field then landed
 * in `sphere-inversion-de.ts` unchanged, and the sheet now CALLS it rather
 * than keeping a second copy — so these panels are evidence about the code
 * that ships, not about a lookalike. The swap was checked the only way that
 * settles it: re-rendered through the shipped entry, the 3D panel is
 * BYTE-IDENTICAL to the prototype's (same PNG hash, same resolved/residual/
 * unresolved counts, same paths and phantoms per trace).
 *
 * WHAT IT IS NOT. Not a certification of the field (the production form owes
 * its own module, tests and f32 argument), not a performance claim (a CPU
 * sheet at 160px prices nothing a renderer will pay), and not an admission
 * of any composition the family refuses today.
 *
 * ---------------------------------------------------------------- FINDINGS
 *
 * 1. THE FIELD IS SOUND, IN ALL THREE SENSES THE MARCH NEEDS, and the
 *    interior half cost no new arithmetic. The gate measured that here
 *    first — zero membership disagreements, zero clearance overshoot
 *    against the explicit orbit, zero oversteps — and the claims now live
 *    where they belong, as per-fixture pins in
 *    `sphere-inversion-de.test.ts` and its 4D twin, against
 *    `explicitOrbitClearance`. This sheet keeps the LOOK.
 *
 * 2. THE LOOK IS REAL, AND IT IS A CURVED-GLASS LOOK. The opaque controls
 *    and the glass panels share a pose and a studio, so the panels differ
 *    only in the material: the glass refracts the checker floor through
 *    curved pearls, with Fresnel rims and Beer tint. This is the thing the
 *    box/simplicial solid cannot produce at any level.
 *
 * 3. DEPTH IS THE KNOB, AND IT CUTS BOTH WAYS. The depth sweep is the
 *    sheet's headline: depth 1-3 render as clean, convincing glass;
 *    by depth 4 the panels speckle and by 6-8 they are lace. The
 *    mechanism is not the estimator — it is FEATURE SIZE against the
 *    DECLARED OPTICAL RESOLUTION.
 *
 * 4. THE RESOLUTION IS THE REMEDY, MEASURED. `DIELECTRIC_CROSSING_EPS_REL`
 *    (R/512) is the production optical resolution, and a depth-6 seed orbit
 *    carries most of its structure below it. Refining it collapses the
 *    dominant failure — `inside-miss` 3671 -> 2162 -> 475 -> 10 at
 *    R/512 -> R/2048 -> R/8192 -> R/32768 — at 2.3x the CPU cost, and what
 *    remains is the PATH BUDGET rather than a defect. At R/8192 with a
 *    2048-path budget the depth-6 subjects resolve 92-93% of pixels.
 *
 * 5. THE FAILURE MODE, NAMED. Below the declared resolution the crossing
 *    band fires where the certified LOWER BOUND is merely loose (a
 *    near-kissing arrangement puts a near-cusp at every tangency, where the
 *    bound reaches ~0 with no surface there), and the caller-carried medium
 *    then drifts: a path marked inside sits in empty space, marches out of
 *    the domain and fails the whole trace `inside-miss`. Two fixes were
 *    measured. The MEMBERSHIP GATE (below) works and is kept — it takes
 *    65-98% unresolved down to 23-36% by itself. Re-deriving the medium
 *    from exact membership at every query (the `measured` rule) does NOT:
 *    it trades `state-mismatch` refusals for slightly more `inside-miss`,
 *    because the flip has to be judged along the CHILD's direction, not the
 *    incident one. That negative result is kept as a row.
 *
 * 6. BOTH DIMENSIONS RENDER, AND THE 4D HALF NEEDED NO NEW GEOMETRY. The
 *    posed-slice arm reads the 4D field through the app's own `lift4` at
 *    zero slab thickness and resolves 85-88% of pixels at the matched
 *    settings, on the 4D module's own argument that a 4D bound is a valid
 *    in-slice bound. Its fixtures are the sheet's own because `cell600`
 *    (both shipped 4D presets) costs about 20x per evaluation and no glass
 *    panel of one finished on the CPU.
 *
 * 7. WHAT THE PRODUCTION CHILDREN INHERIT. The field's two halves are one
 *    function each. The optical resolution is a per-subject choice, not the
 *    finite family's constant, and the boundary query needs a membership
 *    gate this family can afford and the closed-solid backend cannot. The
 *    depth at which the look is best is LOW — which is also the cheap end,
 *    and the opposite of where the estimator's cost concentrates.
 *
 * 8. THE EXACT MÖBIUS NORMAL READS AS THE SAME GLASS, AND IS STILL NOT
 *    TAKEN. The last test renders the shipped starters with every normal
 *    from `sphereInversionSignedNormal` (one fold) in place of the
 *    tetrahedron taps (four): at 160px, 7.8% (3D) and 13.8% (4D) of pixels
 *    move by more than 8/255, scattered refraction detail rather than a
 *    changed shape, and the field evaluations fall 34.2M -> 11.5M in 3D.
 *    THIS SHEET'S OWN QUERY WRAPPER resolves slightly MORE with it (3D
 *    unresolved 4.7% -> 3.2%) — but the kernel's schedule resolves FEWER
 *    (the cost sheet's twin, 1,566 -> 1,259 of 2,137 hits; the GPU census
 *    90.2% -> 86.6%), so these panels are the look half of the A/B and not a
 *    prediction of the kernel's census. The record and the GPU rows:
 *    `docs/sphere-inversion-family.md`, "The exact normal".
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion-glass.harness.ts
 * Writes: `scripts/out/sphere-inversion-glass*.png`
 */
import { writeContactSheet, type PanelStats, type Vec3 } from "./de-preview";
import {
  glassPanel,
  report,
  type GlassOptions,
  type OpticalSolid,
  type PanelView,
} from "./glass-preview";
import { lift4, type RotorPlane } from "./sphere-inversion-orbit";
import {
  resolveSphereInversion,
  type SphereInversionAuthored,
  type SphereInversionConstruction,
  type SphereInversionDE,
} from "../src/fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  sphereInversionContains,
  sphereInversionSignedDistance,
  sphereInversionSignedNormal,
} from "../src/fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  sphereInversionContains4,
  sphereInversionSignedDistance4,
  sphereInversionSignedNormal4,
} from "../src/fractal/sphere-inversion-de-4d";

import { PRESET_SPHERE_INVERSIONS, PRESET_VIEWS } from "../src/fractal/presets";

const SIZE = Number(process.env.SIG_SIZE ?? 160);
/** The 4D panels' own raster: the 600-cell's fold scans 120 generators per
 * step, about 20x the octahedral arrangements' cost per evaluation. */
const SIZE_4D = Number(process.env.SIG_SIZE_4D ?? 96);

/** One panel at this sheet's raster (`glass-preview.ts`'s renderer). */
function panel(
  solid: OpticalSolid,
  radius: number,
  view: PanelView,
  mode: "glass" | "opaque",
  options: GlassOptions = {},
) {
  return glassPanel(solid, radius, view, mode, SIZE, options);
}

// ------------------------------------------------------------- the field

/**
 * The prototype SIGNED field, 3D. Positive is the shipped certified
 * exterior bound, untouched. Negative is the folded interior clearance
 * (`-hit.d`, exact for an intersection of generalized balls) carried back
 * through the fold with the module's own transport — the header's identity.
 * A POLE returns 0: it is not a member, and the family's own contract
 * already says a ray aimed at one creeps.
 */

/** The 4D field read through the app's own posed lift. */
function signedField4(
  de: SphereInversionDE,
  planes: [RotorPlane, number][],
  w0: number,
): (p: Vec3) => number {
  const lift = lift4(planes, w0);
  return (p) => {
    const q = lift(p);
    return sphereInversionSignedDistance4(de, [q[0], q[1], q[2], q[3]]);
  };
}

function solid3(de: SphereInversionDE): OpticalSolid {
  return {
    field: (p) => sphereInversionSignedDistance(de, p),
    contains: (p) => sphereInversionContains(de, p),
    normal: (p) => sphereInversionSignedNormal(de, p),
  };
}

function solid4(
  de: SphereInversionDE,
  planes: [RotorPlane, number][],
  w0: number,
): OpticalSolid {
  const lift = lift4(planes, w0);
  return {
    field: signedField4(de, planes, w0),
    contains: (p) => {
      const q = lift(p);
      return sphereInversionContains4(de, [q[0], q[1], q[2], q[3]]);
    },
    // The slice's normal is the 4D gradient pulled back through the lift's
    // linear part: component j is g4 · (lift(e_j) − lift(0)).
    normal: (p) => {
      const q = lift(p);
      const g4 = sphereInversionSignedNormal4(de, [q[0], q[1], q[2], q[3]]);
      if (!g4) return null;
      const o = Array.from(lift([0, 0, 0]));
      const g: Vec3 = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        const e: Vec3 = [0, 0, 0];
        e[j] = 1;
        const c = lift(e);
        for (let i = 0; i < 4; i++) g[j] += g4[i] * (c[i] - o[i]);
      }
      const m = Math.hypot(g[0], g[1], g[2]);
      return m > 1e-12 ? [g[0] / m, g[1] / m, g[2] / m] : null;
    },
  };
}

// --------------------------------------------------------- the soundness probe

interface SceneSpec {
  name: string;
  construction: SphereInversionConstruction;
  radius: number;
}

function build(preset: keyof typeof PRESET_SPHERE_INVERSIONS): SceneSpec {
  const authored = PRESET_SPHERE_INVERSIONS[preset]!();
  const resolved = resolveSphereInversion(authored);
  if (!resolved.ok)
    throw new Error(`${String(preset)}: ${resolved.reasons.join("; ")}`);
  const de =
    resolved.construction.dim === 4
      ? buildSphereInversionDE4(resolved.construction)
      : buildSphereInversionDE(resolved.construction);
  return {
    name: String(preset),
    construction: resolved.construction,
    radius: de.boundingRadius,
  };
}

function atDepth(
  construction: SphereInversionConstruction,
  depth: number,
): SphereInversionConstruction {
  return { ...construction, depth };
}

/** A preset's authored camera as the preview's own framing. `zoom` is the
 * tangent of the half vertical FOV, which is what `renderPreview` scales its
 * ray offsets by. */
function presetView(name: string): PanelView {
  const view = PRESET_VIEWS[name as keyof typeof PRESET_VIEWS];
  if (!view) throw new Error(`no authored view for ${name}`);
  return {
    eye: [...view.camera.eye] as Vec3,
    target: [...view.camera.target] as Vec3,
    zoom: Math.tan((view.camera.fov * Math.PI) / 360),
  };
}

describe("sphere-inversion glass (the look gate)", () => {
  it("renders the 3D subjects as glass beside their opaque controls", () => {
    const panels: PanelStats[] = [];
    console.log("\n3D subjects (glass through the transport oracle):");
    for (const name of [
      "inversionPearls",
      "inversionCubePearls",
      "inversionLace",
    ] as const) {
      const spec = build(name);
      const de = buildSphereInversionDE(spec.construction);
      const shape = solid3(de);
      const view = presetView(name);
      const opaque = panel(shape, spec.radius, view, "opaque");
      const glass = panel(shape, spec.radius, view, "glass");
      report(`${name} opaque`, opaque.stats, opaque.counters);
      report(`${name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-3d.png")}`,
    );
  });

  it("sweeps DEPTH, the parameter that decides whether the look survives", () => {
    const panels: PanelStats[] = [];
    console.log(
      "\nDepth sweep (inversionPearls, glass; the optical resolution is R/512):",
    );
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    for (const depth of [1, 2, 3, 4, 6, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const glass = panel(shape, de.boundingRadius, view, "glass");
      report(`depth ${depth}`, glass.stats, glass.counters);
      panels.push(glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "sphere-inversion-glass-depth.png")}`,
    );
  });

  it("A/Bs the carried medium against the family's exact membership", () => {
    const panels: PanelStats[] = [];
    console.log("\nMedium rule A/B (inversionPearls, glass):");
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    for (const depth of [4, 8]) {
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      for (const medium of ["carried", "measured"] as const) {
        const glass = panel(shape, de.boundingRadius, view, "glass", {
          medium,
        });
        report(`depth ${depth} ${medium}`, glass.stats, glass.counters);
        panels.push(glass.stats);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-medium.png")}`,
    );
  });

  it("sweeps the declared optical resolution against the object's features", () => {
    const panels: PanelStats[] = [];
    console.log("\nOptical resolution sweep (inversionPearls depth 6, glass):");
    const spec = build("inversionPearls");
    const view = presetView("inversionPearls");
    const de = buildSphereInversionDE(atDepth(spec.construction, 6));
    const shape = solid3(de);
    for (const [label, epsRel] of [
      ["R/512 (shipped)", 1 / 512],
      ["R/2048", 1 / 2048],
      ["R/8192", 1 / 8192],
      ["R/32768", 1 / 32768],
    ] as const) {
      const glass = panel(shape, de.boundingRadius, view, "glass", {
        epsRel,
      });
      report(label, glass.stats, glass.counters);
      panels.push(glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-eps.png")}`,
    );
  });

  it("renders at settings matched to the object (the sheet's verdict panels)", () => {
    const panels: PanelStats[] = [];
    console.log(
      "\nMatched settings (optical resolution R/8192, 2048-path budget):",
    );
    const options: GlassOptions = { epsRel: 1 / 8192, maxPaths: 2048 };
    for (const [name, depth] of [
      ["inversionPearls", 6],
      ["inversionCubePearls", 6],
    ] as const) {
      const spec = build(name);
      const de = buildSphereInversionDE(atDepth(spec.construction, depth));
      const shape = solid3(de);
      const view = presetView(name);
      const opaque = panel(shape, de.boundingRadius, view, "opaque");
      const glass = panel(shape, de.boundingRadius, view, "glass", options);
      report(`${name} opaque`, opaque.stats, opaque.counters);
      report(`${name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-matched.png")}`,
    );
  });

  it("renders the native posed 4D slices as glass beside their controls", () => {
    // THE 4D ARM'S FIXTURES ARE THIS SHEET'S OWN, and the reason is cost,
    // not parity: both shipped 4D presets use `cell600`, whose fold scans
    // 120 generators at every march step — about 20x an octahedral
    // arrangement's per-evaluation cost — and a single 48px glass panel of
    // one did not finish in two minutes of CPU. The 4D arm therefore uses
    // the cheap 4D arrangements at the depth the sweep says the look lives
    // at. The GEOMETRY QUESTION is unchanged: a posed slice, zero slab
    // thickness, the 4D field read through the app's own `lift4`, and the
    // 4D module's own reason that a 4D bound is a valid in-slice bound.
    const panels: PanelStats[] = [];
    console.log("\n4D subjects (posed slice, zero slab thickness):");
    const options: GlassOptions = {
      epsRel: 1 / 8192,
      maxPaths: 512,
      size: SIZE_4D,
    };
    const pose: { planes: [RotorPlane, number][]; w0: number } = {
      planes: [["xw", 0.3]],
      w0: 0.1,
    };
    const view: PanelView = {
      eye: [1.32, 0.96, 1.56],
      target: [0, 0, 0],
      zoom: Math.tan((62 * Math.PI) / 360),
    };
    const fixtures: { name: string; authored: SphereInversionAuthored }[] = [
      {
        name: "cross8 ball d3",
        authored: {
          arrangement: "cross8",
          radiusFraction: 0.99,
          seed: { kind: "ball", size: 0.42 },
          depth: 3,
        },
      },
      {
        name: "tess16 shell d2",
        authored: {
          arrangement: "tess16",
          radiusFraction: 0.99,
          seed: { kind: "shell", size: 1, thickness: 0.06 },
          depth: 2,
        },
      },
    ];
    for (const fixture of fixtures) {
      const resolved = resolveSphereInversion(fixture.authored);
      if (!resolved.ok)
        throw new Error(`${fixture.name}: ${resolved.reasons.join("; ")}`);
      const de = buildSphereInversionDE4(resolved.construction);
      const shape = solid4(de, pose.planes, pose.w0);
      const opaque = panel(shape, de.boundingRadius, view, "opaque", {
        size: options.size,
      });
      const glass = panel(shape, de.boundingRadius, view, "glass", options);
      report(`${fixture.name} opaque`, opaque.stats, opaque.counters);
      report(`${fixture.name} glass`, glass.stats, glass.counters);
      panels.push(opaque.stats, glass.stats);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "sphere-inversion-glass-4d.png")}`,
    );
  });
  it("A/Bs the exact Möbius normal against the tetrahedron taps on the shipped starters", () => {
    // THE NORMAL A/B (the transport-cost record's fourth lever). The kernel
    // normals every landing, every reported boundary and every shadow
    // crossing from four field taps eps apart; the exact normal is one fold.
    // Same construction, pose, studio, optical resolution (the shipped
    // R/512) and path budget (the kernel's 2,048) — the panels differ only
    // in where the normal comes from. Field evaluations are counted at the
    // call (the twin re-taps per gradient component, so the tap arm's count
    // is the kernel's times three for normals; the saving column is
    // therefore quoted from the cost sheet, not from here).
    const panels: PanelStats[] = [];
    console.log(
      "\nExact Möbius normal vs tetrahedron taps (shipped starters):",
    );
    const options: GlassOptions = { maxPaths: 2048 };
    for (const name of ["glassPearls", "glassPearls4"] as const) {
      const authored = PRESET_SPHERE_INVERSIONS[name]!();
      const resolved = resolveSphereInversion(authored);
      if (!resolved.ok)
        throw new Error(`${name}: ${resolved.reasons.join("; ")}`);
      const saved = PRESET_VIEWS[name]!;
      const view = presetView(name);
      let shape: OpticalSolid;
      let radius: number;
      if (resolved.construction.dim === 4) {
        const de = buildSphereInversionDE4(resolved.construction);
        const pose = saved.fourD!;
        shape = solid4(
          de,
          pose.rotation.map(([pl, a]) => [pl, a] as [RotorPlane, number]),
          pose.w0,
        );
        radius = de.boundingRadius;
      } else {
        const de = buildSphereInversionDE(resolved.construction);
        shape = solid3(de);
        radius = de.boundingRadius;
      }
      let evals = 0;
      let normals = 0;
      const counted: OpticalSolid = {
        field: (p) => {
          evals++;
          return shape.field(p);
        },
        contains: (p) => shape.contains(p),
        normal: (p) => {
          normals++;
          return shape.normal(p);
        },
      };
      const taps = panel(counted, radius, view, "glass", options);
      const tapEvals = evals;
      evals = 0;
      const exact = panel(counted, radius, view, "glass", {
        ...options,
        exactNormal: true,
      });
      report(`${name} taps`, taps.stats, taps.counters);
      report(`${name} exact`, exact.stats, exact.counters);
      const a = taps.stats.rgb;
      const b = exact.stats.rgb;
      const diff = new Uint8Array(a.length);
      let sum = 0;
      let over8 = 0;
      let max = 0;
      for (let i = 0; i < a.length; i += 3) {
        const d = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        );
        sum += d;
        if (d > 8) over8++;
        max = Math.max(max, d);
        const v = Math.min(255, d * 4);
        diff[i] = v;
        diff[i + 1] = v;
        diff[i + 2] = v;
      }
      const px = a.length / 3;
      console.log(
        `  ${name}: field evaluations taps ${tapEvals} -> exact ${evals} (+${normals} exact normals); ` +
          `pixel max-channel diff mean ${(sum / px).toFixed(2)}/255, ${((100 * over8) / px).toFixed(1)}% of pixels > 8/255, max ${max}`,
      );
      panels.push(taps.stats, exact.stats, { ...exact.stats, rgb: diff });
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "sphere-inversion-glass-normal.png")}`,
    );
  });
});
