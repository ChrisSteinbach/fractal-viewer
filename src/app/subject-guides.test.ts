import {
  DIVIDE_COLOR,
  deriveSphairaGuides,
  specToScaffold,
  SUBJECT_GUIDE_CIRCLE_SEGMENTS,
} from "./subject-guides";
import { resolveSphairahedron } from "../fractal/sphairahedron";
import { transformColors } from "../fractal/color";
import type { SphairahedronAuthored } from "../fractal/sphairahedron";

describe("subject-guides: the sphaira block's guide spec", () => {
  it("is null without a block and for a refused one", () => {
    expect(deriveSphairaGuides(null)).toBeNull();
    expect(deriveSphairaGuides(undefined)).toBeNull();
    // The past-cusp pair is the harness-only refusal.
    expect(
      deriveSphairaGuides({ family: "cube1", za: 0.65, zb: 1.3 }),
    ).toBeNull();
    expect(deriveSphairaGuides({ family: "cube99" })).toBeNull();
  });

  it("draws the infinite tetra's machinery: one ball, three walls, the divide as the limit-set plane, no J", () => {
    const spec = deriveSphairaGuides({ family: "tetra333" });
    if (!spec) throw new Error("expected a spec");
    expect(spec.dim).toBe(3);
    // One ball × 3 great circles × 48 segments, plus 4 border loops of 4
    // segments each (the three walls and the divide).
    const ballSegments = 3 * SUBJECT_GUIDE_CIRCLE_SEGMENTS;
    expect(spec.pairCount).toBe(ballSegments + 4 * 4);
    // No white J endpoints: an infinite construction carries no inversion
    // sphere (the finite test below pins the white count there).
    for (let p = 0; p < spec.pairCount; p++) {
      const o = p * 6;
      expect(spec.colors[o]).not.toBe(1);
    }
    // The divide sheet is exactly the plane y = 0 — the tetra's limit set.
    expect(spec.sheets.length).toBe(4);
    const divide = spec.sheets[spec.sheets.length - 1];
    const corners = Array.from(divide.corners);
    for (let i = 0; i < corners.length; i += 3) {
      expect(corners[i + 1]).toBeCloseTo(0, 6);
    }
    expect(divide.color).toEqual([0x93 / 255, 0xa4 / 255, 0xc8 / 255]);
  });

  it("wears the fold faces' own hues — the cloud's and the legend's face slots", () => {
    const block: SphairahedronAuthored = { family: "cube1", za: 0.5, zb: 1.0 };
    const resolution = resolveSphairahedron(block);
    if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
    const faces = resolution.construction.foldFaces;
    const spec = deriveSphairaGuides(block);
    if (!spec) throw new Error("expected a spec");
    const palette = transformColors(faces.length);
    // The finite cube's construction: one sheet per PLANE fold face plus the
    // divide sheet.
    expect(spec.sheets.length).toBe(
      faces.filter((f) => f.face.kind === "plane").length + 1,
    );
    // Every endpoint's color is one of the palette slots, the divide's
    // scaffold blue, or J's white — closeTo, because the spec stores
    // Float32 and the palette is f64.
    let sawFaceColor = false;
    const isDivide = (
      c: [number, number, number],
      r: number,
      g: number,
      b: number,
    ) =>
      Math.abs(c[0] - r) < 1e-5 &&
      Math.abs(c[1] - g) < 1e-5 &&
      Math.abs(c[2] - b) < 1e-5;
    for (let p = 0; p < spec.pairCount; p++) {
      const o = p * 6;
      const r = spec.colors[o];
      const g = spec.colors[o + 1];
      const b = spec.colors[o + 2];
      const isWhite = r === 1 && g === 1 && b === 1;
      if (!isWhite && !isDivide(DIVIDE_COLOR, r, g, b)) {
        expect(
          palette.some(([pr, pg, pb]) => isDivide([pr, pg, pb], r, g, b)),
        ).toBe(true);
        sawFaceColor = true;
      }
    }
    expect(sawFaceColor).toBe(true);
  });

  it("draws the authored J on a finite construction, and nothing on an infinite one", () => {
    const finite = deriveSphairaGuides({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      inversion: { cx: 0.1, cy: 0, cz: 0, r: 1 },
    });
    const infinite = deriveSphairaGuides({ family: "cube1", za: 0.5, zb: 1.0 });
    if (!finite || !infinite) throw new Error("expected specs");
    // J adds 3 circles × 48 segments of white endpoints.
    const whitePairs = (
      spec: NonNullable<ReturnType<typeof deriveSphairaGuides>>,
    ) => {
      let n = 0;
      for (let p = 0; p < spec.pairCount; p++) {
        const o = p * 6;
        if (
          spec.colors[o] === 1 &&
          spec.colors[o + 1] === 1 &&
          spec.colors[o + 2] === 1
        )
          n++;
      }
      return n;
    };
    expect(whitePairs(finite)).toBe(3 * SUBJECT_GUIDE_CIRCLE_SEGMENTS);
    expect(whitePairs(infinite)).toBe(0);
  });

  it("puts every ball-circle endpoint on its sphere", () => {
    const spec = deriveSphairaGuides({ family: "tetra333" });
    if (!spec) throw new Error("expected a spec");
    const resolution = resolveSphairahedron({ family: "tetra333" });
    if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
    const ball = resolution.construction.foldFaces.find(
      (f) => f.face.kind === "sphere",
    );
    if (!ball || ball.face.kind !== "sphere") throw new Error("no ball face");
    const { c, r } = ball.face.sphere;
    let checked = 0;
    for (let p = 0; p < spec.pairCount; p++) {
      const o = p * 6;
      const d =
        Math.hypot(
          spec.positions[o] - c[0],
          spec.positions[o + 1] - c[1],
          spec.positions[o + 2] - c[2],
        ) - r;
      // Wall border loops sit on their PLANES, not on the ball — skip
      // endpoints that are not near the sphere by more than a segment's
      // chord; every circle endpoint must be within one chord of r.
      const chord = 2 * r * Math.sin(Math.PI / SUBJECT_GUIDE_CIRCLE_SEGMENTS);
      if (Math.abs(d) <= chord * 1.01) {
        expect(Math.abs(d)).toBeLessThanOrEqual(chord * 1.01);
        checked++;
      }
    }
    // The three circles' worth of SEGMENTS (both endpoints each) all passed
    // the on-sphere test — the wall and divide border loops sit on their
    // planes, far from the sphere, and are the pairs the test skipped.
    expect(checked).toBe(3 * SUBJECT_GUIDE_CIRCLE_SEGMENTS);
  });

  it("is deterministic", () => {
    const a = deriveSphairaGuides({ family: "tetra333" });
    const b = deriveSphairaGuides({ family: "tetra333" });
    expect(a).toEqual(b);
  });
});

describe("subject-guides: the 4D scaffold form", () => {
  it("samples tetra4's faces into Vec4 edge pairs the scaffold can re-pose", () => {
    const spec = deriveSphairaGuides({ family: "tetra4" });
    if (!spec) throw new Error("expected a spec");
    expect(spec.dim).toBe(4);
    // One ball × 6 great circles (the w-carrying planes included) + 3 wall
    // borders + the divide's 4.
    expect(spec.pairCount).toBe(6 * SUBJECT_GUIDE_CIRCLE_SEGMENTS + 4 * 4);
    const scaffold = specToScaffold(spec);
    expect(scaffold.edges.length).toBe(spec.pairCount);
    expect(scaffold.colors.length).toBe(spec.pairCount * 6);
    for (const [a, b] of scaffold.edges) {
      expect(a.length).toBe(4);
      expect(b.length).toBe(4);
    }
  });

  it("gives the 3D spec no scaffold form", () => {
    const spec = deriveSphairaGuides({ family: "tetra333" });
    if (!spec) throw new Error("expected a spec");
    const scaffold = specToScaffold(spec);
    expect(scaffold.edges).toEqual([]);
    expect(scaffold.colors.length).toBe(0);
  });
});
