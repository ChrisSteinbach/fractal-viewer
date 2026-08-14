# Julia sets for fractal-4d: from "IFS Julia" labels to realistic 3D DE rendering

> **Status: historical.** This is the brief the fr-7u8t epic was written from, kept for its background and
> its references. It is NOT current guidance, and four of its claims were answered — two of them
> refuted — by the work it started. Read this box before acting on anything below.
>
> | The brief says                                                                                                                                            | What was measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
> | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | "the DE Surface mode runs in seconds on a phone but minutes on an Ubuntu laptop, suggesting the laptop browser has fallen back to software rasterization" | **Refuted** (fr-7u8t.2). Both real browsers get a Vulkan-backed adapter and the app selects WebGPU compute on each. The mechanism is real but was not active here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
> | **Option A (recommended): quaternion Julia sets**                                                                                                         | **Demoted** (fr-7u8t.5's notes, from `scripts/qjulia-beauty.harness.ts`'s sheets). The oracle shipped and is exact, certified and the cheapest estimator in the codebase — but the object is SMOOTH: twenty panels across rotations, rotor-posed slices, non-zero `w0` and several constants are shells and whorls without fractal detail, and three levels of zoom on four systems reveal nothing new. Surface mode's promise is that zoom keeps resolving. The renderer beads (fr-7u8t.5, fr-7u8t.6) are CLOSED won't-do — the rotor-posed slice this option's 4D lift rested on was tested among those panels and is smooth too. The oracle stays, and fr-j231 uses its exact derivative for cross-family chains. |
> | **Option B: Juliabulb** ("Later" in the task list)                                                                                                        | **Shipped** (fr-7u8t.7, fr-7u8t.9, fr-tdin) — as the Mandelbulb rather than the Juliabulb, since fr-7u8t.8 established the Mandelbrot form for this family. Measured 3.5x CHEAPER per eval than the fold mode that already shipped, refuting the bead's own prediction.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
> | **Option C: Julia-mode hybrids**                                                                                                                          | **Half-shipped** (fr-za0n, fr-s04t): the transform list is a formula chain and fold links compose. Cross-family links — a fold chained with a triplex power or a quaternion square — are fr-j231, blocked on fr-17qu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
> | Task 5, "optional, flame mode: support a `juliaN`-type variation"                                                                                         | **Already existed** (fr-7u8t.1). `variations.ts`'s `julia` has been flam3's `juliaN(power=2, dist=1)` all along. See `docs/julia-sets.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
>
> One correction to the background itself: the brief describes the app as having two modes, flame and
> "solid (DE/Surface ray marching)". There are four — explorer, flame, solid (voxel) and surface (DE) —
> and solid and surface are different renderers, not one.

**Purpose of this document.** Summary of a design conversation (2026-08-13) about adding Julia sets to
fractal-4d.com. Part 1 is mathematical background explaining how Julia sets relate to IFS (relevant to the
existing flame mode). Part 2 plus the task list is the actionable part: how to get realistic 3D Julia
renders out of the existing DE/Surface pipeline, and why a quaternion Julia mode is likely the easiest
high-impact addition.

**Project context.** fractal-4d.com (repo: `github.com/ChrisSteinbach/fractal-viewer`) renders IFS
fractals in two modes: _flame_ (plotted-point / chaos-game) and _solid_ (DE/Surface ray marching with fold
transforms). Known issues: fold-based DE rendering is very slow in the browser and can hang it on
interesting scenes; the DE Surface mode runs in seconds on a phone but minutes on an Ubuntu laptop,
suggesting the laptop browser has fallen back to software rasterization.

---

## Part 1 — Why "IFS Julia" is (half) legitimate, and "IFS Mandelbrot" mostly isn't

### Julia sets are attractors of a nonlinear IFS

The Julia set of f(z) = z² + c is completely invariant, so J = f⁻¹(J). Writing the two inverse branches
as w±(z) = ±√(z − c), this becomes J = w₊(J) ∪ w₋(J) — exactly Hutchinson's fixed-point equation for a
two-map IFS, just with non-affine maps. Because J is a repeller for f, it is an attractor for the inverse
system: running the chaos game on the branches (choose ± at random each step) is the classical **Inverse
Iteration Method (IIM)** for plotting Julia sets.

For c outside the Mandelbrot set this is a textbook conformal IFS: both branches map a suitable disk
containing J into itself with disjoint images, and the attractor is the Cantor-dust Julia set. For
connected J the branches are only locally defined (monodromy around the critical value) and contract only
near J, so "IFS" holds in a generalized conformal sense.

**Sampling caveat.** The equal-weights chaos game equidistributes to the balanced measure (Brolin 1965),
which for polynomials is harmonic measure seen from infinity — exponentially thin in fjords and spirals.
Naive IIM therefore draws tips well and starves recessed regions. The fix is **MIIM**: breadth-first
preimage trees pruned by local derivative or cell occupancy (see Peitgen–Saupe, _The Science of Fractal
Images_; Fractint shipped this as its inverse-Julia mode).

### The Mandelbrot set is not an IFS attractor

M lives in parameter space: no dynamics act on it and no Hutchinson equation for it is known. Its
self-similarity is weaker than IFS self-similarity — asymptotic at Misiurewicz points (Tan Lei 1990:
rescaled M converges to the correspondingly rescaled Julia set) and quasiconformal for the baby copies
(Douady–Hubbard renormalization), never affine.

There _is_ a legitimately named "Mandelbrot set for IFS": the connectedness locus of the linear pair
{λz − 1, λz + 1} over complex λ (Barnsley–Harrington 1985; Bandt 2002). Structurally it plays the same
role for that family that M plays for z² + c (M is the connectedness locus of the quadratic family), with
the attractors A_λ as the Julia-side analogues. Some images tagged "IFS Mandelbrot" are this object.

### Flame-culture origin of the labels — directly usable in flame mode

The `julia` / `juliaN` / `juliascope` variations in `.flame` packs are precisely the inverse branches of
zⁿ. `juliaN` with power 2, dist 1 computes r^½ at angle (θ + 2πk)/2 with random k — the ± square-root
pick. Consequence for fractal-4d's flame mode:

> A flame containing a **single xform**: pre-affine translation by −c, then `juliaN(power=2, dist=1)` —
> nothing else — performs exact IIM and renders the genuine Julia set of z² + c. Expect harmonic-measure
> coverage bias (thin fjords) per the MIIM caveat above.

Typical online "IFS julia" images are this plus extra xforms mixed in: Julia-_like_, but not the Julia set
of any single polynomial. ("Kaleidoscopic IFS" naming for fold-based DE fractals blurs the terminology
from the other direction.)

---

## Part 2 — Realistic 3D renders of Julia sets via the DE/Surface pipeline

**Key fact:** in Mandelbulber / Mandelbulb3D, "Julia mode" is a standard toggle — iterate z → f(z) + c
with **c fixed** instead of taken from the sample point. Many showcase 3D fractal landscapes are Julia-mode
renders; fixed-c sets tend to be spatially coherent, which is why artists favor them for fly-throughs. So
realistic 3D Julia renders are not just possible — they are a large share of the reference images.

The flame/IIM point cloud does **not** extrude into a lit surface. The route to the realistic look is
escape-time iteration in 3D/4D with a distance estimator — i.e., the existing DE/Surface pipeline.

### Option A (recommended): quaternion Julia sets — on-brand for "fractal-4d"

Iterate q → q² + c in the quaternions ℍ and ray-march a 3D slice of the 4D set. This is the original 3D
fractal DE result (Hart–Sandin–Kauffman, SIGGRAPH 1989), proven real-time in browsers (Keenan Crane's 2005
GPU renderer; Tom Beddard's subblue WebGL quaternion ray tracer; Inigo Quilez's ShaderToy versions).

Why it should be _fast_ here, unlike the fold stacks:

- Per-iteration cost is a handful of multiplies (one quaternion square, one add).
- The running derivative gives a **near-exact DE**, so marching can use full step length (no fudge
  factor): track dz with dz → 2·q·dz, seeded dz₀ = 1. Julia mode has no "+1" term (that term belongs to
  Mandelbrot-mode derivatives).
- Distance estimate: `d ≈ 0.5 · |q| · ln|q| / |dz|`.

By contrast, folds and scales break conformality, so hybrid DE is only approximate and must be marched at
0.5–0.8× step scale — a major cause of the current slowness and surface holes.

The 4D structure is a product feature: expose the slice hyperplane (offset + rotation in 4D) and the
quaternion constant c as interactive controls. Given the site name, an interactive 4D slice through a
genuine 4D Julia set is close to obligatory.

### Option B: Juliabulb

Triplex (Mandelbulb-style) power-8 iteration with fixed c — the iconic bulby-canyon look. Scalar running
derivative: dr → n·r^(n−1)·dr. More per-iteration cost than quaternions (trig or trig-free triplex
formulas).

### Option C: Julia-mode hybrids

Keep the existing fold stack and interleave a power/quaternion step plus a constant c offset — this is
what many of the most spectacular online landscapes are. Composes with existing code (folds leave the
scalar derivative unchanged; scale steps multiply it by |s|; power steps by n·r^(n−1)) but inherits the
approximate-DE fudge-factor cost above.

### What actually makes renders look "realistic"

Roughly 20% formula, 80% shading and patience:

- Normals from the DE gradient (e.g., tetrahedron technique).
- Ambient occlusion: cheap iteration-count AO, or a few extra DE taps along the normal.
- Soft shadows via DE cone-tracing (Quilez's technique).
- Fog / aerial perspective; proper tone mapping (sRGB out).
- Reference images are frequently minutes-to-hours of offline CPU rendering (Mandelbulb3D / Mandelbulber)
  plus post-processing. Browser strategy to close the gap: **progressive accumulation** — noisy
  interactive preview that refines over ~10 s when the camera stops.

### Reference pseudocode — quaternion Julia DE (GLSL-ish)

```glsl
// Quaternions as vec4 (w = real part in .x here; pick one convention and stick to it).
vec4 qmul(vec4 a, vec4 b) {
    return vec4(a.x*b.x - dot(a.yzw, b.yzw),
                a.x*b.yzw + b.x*a.yzw + cross(a.yzw, b.yzw));
}

uniform vec4  uC;       // Julia constant c (4D)
uniform float uSliceW;  // offset of the 3D slice along the 4th axis
                        // (generalize later to a rotated 4D hyperplane)

float juliaDE(vec3 p) {
    vec4 q  = vec4(p, uSliceW);            // embed sample point in 4D
    vec4 dq = vec4(1.0, 0.0, 0.0, 0.0);    // running derivative, seed 1
    float r = length(q);
    for (int i = 0; i < MAX_ITER; i++) {
        if (r > ESCAPE_R) break;           // ESCAPE_R ~ 4.0–16.0
        dq = 2.0 * qmul(q, dq);            // Julia mode: no +1 term
        q  = qmul(q, q) + uC;
        r  = length(q);
    }
    if (r < ESCAPE_R) return 0.0;          // treated as inside (clamp/guard log)
    return 0.5 * r * log(r) / length(dq);
}
```

Near-exact DE ⇒ ray-march with step scale ≈ 1.0; adapt the surface epsilon to pixel cone size.

---

## Suggested tasks (in order)

1. **GPU diagnostic first.** On the Ubuntu laptop, check `chrome://gpu` (or `about:support` in Firefox)
   for software WebGL fallback (llvmpipe / SwiftShader). This alone may explain phone-beats-laptop and
   should be ruled out before drawing conclusions about any algorithm.
2. **Prototype a quaternion Julia render mode** using the DE function above, reusing the existing
   DE/Surface shading path (normals, lighting). Target: interactive preview on a real GPU.
3. **4D controls:** slice offset (then hyperplane rotation) and a c-picker; presets for a few known-good
   c values.
4. **Progressive accumulation** for refined stills after camera rest.
5. **Optional, flame mode:** support a `juliaN`-type variation so a single-xform flame (pre-affine −c +
   juliaN power 2) renders true 2D Julia sets; document the harmonic-measure coverage bias (MIIM as a
   possible later enhancement).
6. **Later:** Juliabulb formula; Julia-mode (fixed-c) toggle for the existing fold hybrids, with the
   approximate-DE step-scale caveat.

## References

- J. C. Hart, D. J. Sandin, L. H. Kauffman, "Ray Tracing Deterministic 3-D Fractals", SIGGRAPH 1989
  (quaternion Julia distance estimation).
- A. Norton, "Generation and Display of Geometric Fractals in 3-D", SIGGRAPH 1982 (first 3D/quaternion
  Julia imagery).
- K. Crane, "Ray Tracing Quaternion Julia Sets on the GPU", 2005 (code + writeup).
- I. Quilez, articles and ShaderToys on distance estimation for fractals, DE normals, AO, and soft shadows.
- T. Beddard (subblue), WebGL 4D quaternion Julia set ray tracer (browser feasibility reference).
- H.-O. Peitgen, D. Saupe (eds.), _The Science of Fractal Images_, 1988 (IIM and MIIM).
- H. Brolin, "Invariant sets under iteration of rational functions", 1965 (equidistribution to harmonic
  measure).
- Tan Lei, "Similarity between the Mandelbrot set and Julia sets", 1990.
- M. Barnsley, A. Harrington, "A Mandelbrot Set for Pairs of Linear Maps", 1985; C. Bandt, "On the
  Mandelbrot set for pairs of linear maps", 2002.
