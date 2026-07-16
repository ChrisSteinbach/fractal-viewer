// @vitest-environment jsdom
import { composeAffine } from "../fractal/affine";
import { decodeFlameFile, encodeFlameFile } from "./flame-file";
import { decodeScene, toSnapshot } from "./persist";
import type { SceneSnapshot } from "./persist";
import { initialState } from "./state";
import type { Transform } from "../fractal/types";

/** Load one decoded flame's first scene as a SceneSnapshot, asserting the
 * chain the module promises: flame XML → encoded string → decodeScene. */
function loadFirstScene(xml: string): SceneSnapshot {
  const file = decodeFlameFile(xml);
  expect(file).not.toBeNull();
  expect(file!.scenes.length).toBeGreaterThan(0);
  const snap = decodeScene(file!.scenes[0].encoded);
  expect(snap).not.toBeNull();
  return snap!;
}

/** The 2D reading of a composed transform, in flam3 coefs order
 * [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
function coefsOf(t: Transform): number[] {
  const { m, t: tr } = composeAffine(t);
  return [m[0], m[3], m[1], m[4], tr[0], tr[1]];
}

function snapshotWith(overrides: Partial<SceneSnapshot>): SceneSnapshot {
  return { ...toSnapshot(initialState(false)), ...overrides };
}

describe("decodeFlameFile", () => {
  it("reconstructs an arbitrary sheared coefs matrix exactly (QR import)", () => {
    // A matrix with rotation + shear + non-uniform scale + negative
    // determinant — beyond what rotation/scale alone can express.
    const coefs = [0.62, -0.41, 0.55, -0.73, 0.25, -1.1];
    const xml = `<flame name="qr"><xform weight="0.5" coefs="${coefs.join(" ")}"/><xform weight="0.5" coefs="0.5 0 0 0.5 0 0"/></flame>`;

    const snap = loadFirstScene(xml);
    expect(snap.transforms).toHaveLength(2);
    const got = coefsOf(snap.transforms[0]);
    for (let i = 0; i < 6; i++) {
      // persist.ts rounds fields to 4 decimals, so exactness means ~1e-3.
      expect(got[i]).toBeCloseTo(coefs[i], 3);
    }
    // The orbit is pinned to the z = 0 plane.
    expect(snap.transforms[0].scale[2]).toBe(0);
    expect(snap.transforms[0].position[2]).toBe(0);
  });

  it("maps variation attributes onto our variation list by name", () => {
    const xml = `<flame><xform weight="1" spherical="0.7" swirl="-0.3" coefs="0.5 0 0 0.5 0.1 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].variations).toEqual([
      { type: "spherical", weight: 0.7 },
      { type: "swirl", weight: -0.3 },
    ]);
  });

  it("folds a pure linear blend into the affine coefficients", () => {
    const xml = `<flame><xform weight="1" linear="2" coefs="0.3 0 0 0.4 0.1 -0.2"/></flame>`;
    const snap = loadFirstScene(xml);
    const t = snap.transforms[0];
    expect(t.variations).toBeUndefined();
    const got = coefsOf(t);
    expect(got[0]).toBeCloseTo(0.6, 3);
    expect(got[3]).toBeCloseTo(0.8, 3);
    expect(got[4]).toBeCloseTo(0.2, 3);
    expect(got[5]).toBeCloseTo(-0.4, 3);
  });

  it("composes a post matrix into a purely affine xform exactly", () => {
    // post ∘ affine: p' = P·(A·p + o) + o_p. Check the composed transform
    // reproduces that on the linear block and translation.
    const xml = `<flame><xform weight="1" linear="1" coefs="0.5 0.1 -0.2 0.4 0.3 0.6" post="0 -1 1 0 0.5 0"/></flame>`;
    const snap = loadFirstScene(xml);
    const [a, b, c, d, e, f] = coefsOf(snap.transforms[0]);
    // P = rot90-ish: x' = 0·x + 1·y + 0.5, y' = -1·x + 0·y + 0.
    // A columns: (0.5, 0.1), (-0.2, 0.4), o = (0.3, 0.6).
    expect(a).toBeCloseTo(0.1, 3); // P(col x): x' = y-component = 0.1
    expect(b).toBeCloseTo(-0.5, 3);
    expect(c).toBeCloseTo(0.4, 3);
    expect(d).toBeCloseTo(0.2, 3);
    expect(e).toBeCloseTo(0.6 + 0.5, 3); // P·o + o_p, x: o.y + 0.5
    expect(f).toBeCloseTo(-0.3, 3);
  });

  it("returns null for non-flame text", () => {
    expect(decodeFlameFile("just some text")).toBeNull();
    expect(decodeFlameFile(`{"app":"fractal-viewer"}`)).toBeNull();
    expect(decodeFlameFile("<svg><rect/></svg>")).toBeNull();
  });
});

describe("encodeFlameFile → decodeFlameFile round trip", () => {
  it("reproduces a nonlinear system's maps, weights, and variations", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.4, -0.2, 0],
        rotation: [0, 0, 0.7],
        scale: [0.6, 0.45, 0],
        shear: [0.3, 0, 0],
        weight: 2,
        variations: [{ type: "spherical", weight: 0.8 }],
      },
      {
        id: 1,
        position: [-0.5, 0.1, 0],
        rotation: [0, 0, -0.4],
        scale: [0.5, 0.5, 0],
        weight: 1,
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml, warnings } = encodeFlameFile(source, "round-trip");
    expect(warnings).toEqual([]); // z-flat system: nothing to lose.

    const back = loadFirstScene(xml);
    expect(back.transforms).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const want = coefsOf(transforms[i]);
      const got = coefsOf(back.transforms[i]);
      for (let j = 0; j < 6; j++) expect(got[j]).toBeCloseTo(want[j], 3);
    }
    expect(back.transforms[0].variations).toEqual([
      { type: "spherical", weight: 0.8 },
    ]);
    expect(back.transforms[0].weight).toBe(2);
    // persist.ts canonicalizes weight 1 to absent — same meaning.
    expect(back.transforms[1].weight ?? 1).toBe(1);
  });
});
