import type { Transform4, Vec4 } from "./types";

/**
 * 4D preset systems for the spike (fr-cbg). Two systems: one that is the direct
 * 4D successor of a familiar 3D fractal ({@link pentatopeGasket}), and one with
 * no 3D counterpart at all ({@link doubleRotationSpiral}) — together they show
 * both that the 4D path renders the "expected" thing and that it reaches shapes
 * the 3D path cannot.
 */

/** Circumradius-1 vertices of a regular 4-simplex (5-cell / pentatope). */
function pentatopeVertices(): Vec4[] {
  // The first four are an alternated-cube tetrahedron sitting in the w = −1/4
  // hyperplane; the fifth is the apex on the +w axis. With s = √5/4 each vertex
  // is a unit vector and every pair meets at the regular-simplex angle
  // arccos(−1/4) (verified in presets4.test.ts).
  const s = Math.sqrt(5) / 4;
  return [
    [s, s, s, -1 / 4],
    [s, -s, -s, -1 / 4],
    [-s, s, -s, -1 / 4],
    [-s, -s, s, -1 / 4],
    [0, 0, 0, 1],
  ];
}

/**
 * The pentatope (5-cell) gasket — the true 4D successor of the Sierpinski
 * tetrahedron. Five maps, each contracting all of 4-space by ½ toward one vertex
 * of a regular 4-simplex (circumradius 1, centered at the origin). Its attractor
 * has Hausdorff dimension `log 5 / log 2 ≈ 2.32` (five ½-scale copies), just as
 * the Sierpinski tetrahedron's is `log 4 / log 2 = 2`.
 *
 * Each map fixes its vertex `v`: with scale ½, the fixed point of
 * `x ↦ ½·x + position` is `2·position`, so `position = v/2` — the same
 * `position = v·(1 − ratio)` construction as `presets.ts`'s `flake` helper, here
 * with `ratio = ½`.
 */
export function pentatopeGasket(): Transform4[] {
  return pentatopeVertices().map((v): Transform4 => ({
    position: [v[0] / 2, v[1] / 2, v[2] / 2, v[3] / 2],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

/**
 * The 5-cell's wireframe scaffold: all C(5,2) = 10 edges of the regular
 * 4-simplex whose vertices anchor {@link pentatopeGasket}'s maps. Rendered as a
 * projected, tumbling wireframe it is the legibility cue for the 4D view — a
 * rigid 4D rotation bends the PROJECTED edge lengths and angles through changes
 * no rigid 3D motion could produce, which is exactly what makes classic
 * rotating-tesseract renders read as 4D.
 */
export function pentatopeWireframe(): [Vec4, Vec4][] {
  const v = pentatopeVertices();
  const edges: [Vec4, Vec4][] = [];
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      edges.push([v[i], v[j]]);
    }
  }
  return edges;
}

/**
 * A double-rotation spiral — a structure with NO 3D counterpart. The dominant
 * "swirl" map contracts while rotating simultaneously in two ORTHOGONAL planes
 * (`xy` and `zw`) at incommensurate angles; a true 4D double rotation has no
 * fixed axis (unlike every 3D rotation), so the orbit winds through all four
 * dimensions at once instead of spiralling about a line. A small, heavily
 * out-weighted seed map keeps injecting points off-center in both the `xy` and
 * `zw` planes for the swirl to draw into filaments.
 *
 * The constants are tuned so the attractor is genuinely 4D (all four coordinate
 * extents open up) yet bounded, and carries visible `w` structure — see the
 * acceptance test in presets4.test.ts. Both maps stay contractive (every scale
 * magnitude < 1).
 */
export function doubleRotationSpiral(): Transform4[] {
  return [
    {
      // Double rotation: xy and zw turned together, incommensurate angles.
      scale: [0.93, 0.93, 0.93, 0.93],
      rotation: { xy: 0.55, zw: 0.34 },
      position: [0, 0, 0, 0],
      weight: 6,
    },
    {
      // Seed: a small copy offset in both the xy (via x) and zw (via w)
      // planes. The size of the w offset is an aesthetic choice — it sets how
      // far the filaments reach along w, not legibility: the renderer
      // normalizes w-color by the cloud's rotation-covariant w-amplitude
      // (fr-9bk), so even a sliver of w-spread spans the full diverging ramp.
      scale: [0.22, 0.22, 0.22, 0.22],
      rotation: {},
      position: [0.85, 0, 0, 0.75],
      weight: 1,
    },
  ];
}
