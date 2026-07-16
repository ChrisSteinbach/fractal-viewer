// @vitest-environment jsdom
import { composeAffine } from "../fractal/affine";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";
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

  it("returns null for unterminated XML", () => {
    expect(decodeFlameFile("<flame><xform coefs='1 0 0 1 0 0'")).toBeNull();
  });

  it("returns null for a flame-shaped document with no flame element", () => {
    expect(decodeFlameFile("<flames></flames>")).toBeNull();
  });

  it("imports every <flame> in a multi-flame file with positional name fallback", () => {
    const xml = `<flames>
      <flame name="alpha"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>
      <flame><xform weight="1" coefs="0.4 0 0 0.4 0.1 0.1"/></flame>
    </flames>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.scenes).toHaveLength(2);
    expect(file!.scenes[0].name).toBe("alpha");
    expect(file!.scenes[1].name).toBe("Flame 2");
    expect(decodeScene(file!.scenes[0].encoded)).not.toBeNull();
    expect(decodeScene(file!.scenes[1].encoded)).not.toBeNull();
  });

  it("skips xforms with non-positive weight but keeps a valid sibling", () => {
    const xml = `<flame><xform weight="0" coefs="1 0 0 1 0 0"/><xform weight="-1" coefs="1 0 0 1 0 0"/><xform weight="1" coefs="0.5 0 0 0.5 0.2 0.3"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.warnings.some((w) => /non-positive weight/i.test(w))).toBe(
      true,
    );

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(1);
    const got = coefsOf(snap!.transforms[0]);
    const want = [0.5, 0, 0, 0.5, 0.2, 0.3];
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("drops a flame whose only xform has zero weight", () => {
    const xml = `<flame name="deadweight"><xform weight="0" coefs="1 0 0 1 0 0"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.scenes).toEqual([]);
    expect(file!.warnings.some((w) => /no usable transforms/i.test(w))).toBe(
      true,
    );
  });

  it("aggregates unknown variation attributes into one warning naming them", () => {
    const xml = `<flame><xform weight="1" julian="1" julian_power="2" coefs="0.5 0 0 0.5 0.1 0.2"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms[0].variations).toBeUndefined();

    const unsupported = file!.warnings.filter((w) =>
      /Unsupported flame features/i.test(w),
    );
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toContain("julian");
    expect(unsupported[0]).toContain("julian_power");
  });

  it("drops a post transform on a nonlinear map with a warning, leaving coefs untouched", () => {
    const xml = `<flame><xform weight="1" spherical="1" coefs="0.5 0 0 0.5 0.1 0.2" post="0 1 -1 0 0.3 0.4"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.warnings.some((w) => /post transform/i.test(w))).toBe(true);

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms[0].variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
    const got = coefsOf(snap!.transforms[0]);
    const want = [0.5, 0, 0, 0.5, 0.1, 0.2];
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("imports an xaos xform with a warning, ignoring the chaos weights", () => {
    const xml = `<flame><xform weight="1" chaos="1 0" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.warnings.some((w) => /xaos/i.test(w))).toBe(true);
    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(1);
  });

  it("warns on a hidden (opacity 0) transform but not on an opaque one", () => {
    const xml = `<flame><xform weight="1" opacity="0" coefs="0.5 0 0 0.5 0 0"/><xform weight="1" opacity="1" coefs="0.4 0 0 0.4 0.2 0.2"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    const opacityWarnings = file!.warnings.filter((w) => /opacity/i.test(w));
    expect(opacityWarnings).toHaveLength(1);

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(2);
  });

  it("downsamples an Apophysis-style <palette> hex block onto an 8-stop custom palette", () => {
    const hex = Array.from({ length: 256 }, (_, i) => {
      if (i === 0) return "ff0000";
      if (i === 255) return "0000ff";
      return "808080";
    }).join("");
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><palette count="256" format="RGB">${hex}</palette></flame>`;

    const snap = loadFirstScene(xml);
    expect(snap.customPalette).toBeDefined();
    const stops = snap.customPalette!.stops;
    expect(stops).toHaveLength(8);
    expect(stops[0][0]).toBeCloseTo(1, 3);
    expect(stops[0][1]).toBeCloseTo(0, 3);
    expect(stops[0][2]).toBeCloseTo(0, 3);
    expect(stops[7][0]).toBeCloseTo(0, 3);
    expect(stops[7][1]).toBeCloseTo(0, 3);
    expect(stops[7][2]).toBeCloseTo(1, 3);
    expect(snap.flame.paletteId).toBe("custom");
    expect(snap.rampPaletteId).toBe("custom");
  });

  it("downsamples flam3-style <color> entries onto a custom palette", () => {
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><color index="0" rgb="255 0 0"/><color index="1" rgb="0 255 0"/><color index="2" rgb="0 0 255"/><color index="3" rgb="255 255 0"/></flame>`;

    const snap = loadFirstScene(xml);
    expect(snap.customPalette).toBeDefined();
    const stops = snap.customPalette!.stops;
    expect(stops[0][0]).toBeCloseTo(1, 3);
    expect(stops[0][1]).toBeCloseTo(0, 3);
    expect(stops[0][2]).toBeCloseTo(0, 3);
    const last = stops[stops.length - 1];
    expect(last[0]).toBeCloseTo(1, 3);
    expect(last[1]).toBeCloseTo(1, 3);
    expect(last[2]).toBeCloseTo(0, 3);
  });

  it("leaves the palette at its default when the flame carries none", () => {
    const defaultPaletteId = toSnapshot(initialState(false)).flame.paletteId;
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.customPalette).toBeUndefined();
    expect(snap.flame.paletteId).toBe(defaultPaletteId);
  });

  it("maps brightness/gamma/vibrancy header attributes", () => {
    const xml = `<flame brightness="8" gamma="3" vibrancy="0.5"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.flame.exposure).toBeCloseTo(2, 3);
    expect(snap.flame.gamma).toBeCloseTo(3, 3);
    expect(snap.flame.vibrancy).toBeCloseTo(0.5, 3);
  });

  it("clamps brightness/gamma header attributes to our range", () => {
    const xml = `<flame brightness="100" gamma="0.1"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.flame.exposure).toBeCloseTo(4, 3);
    expect(snap.flame.gamma).toBeCloseTo(1, 3);
  });

  it("reads supersample from either `supersample` or the `oversample` alias", () => {
    const snapA = loadFirstScene(
      `<flame supersample="2"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`,
    );
    expect(snapA.flame.supersample).toBe(2);

    const snapB = loadFirstScene(
      `<flame oversample="2"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`,
    );
    expect(snapB.flame.supersample).toBe(2);
  });

  it("maps estimator_radius", () => {
    const xml = `<flame estimator_radius="5"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.flame.estimatorRadius).toBe(5);
  });

  it("defaults to the identity affine when coefs is absent", () => {
    const xml = `<flame><xform weight="1"/></flame>`;
    const snap = loadFirstScene(xml);
    const got = coefsOf(snap.transforms[0]);
    const want = [1, 0, 0, 1, 0, 0];
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("drops a flame whose only xform has too few coefs numbers", () => {
    const xml = `<flame name="bad"><xform weight="1" coefs="1 2 3"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.scenes).toEqual([]);
    expect(file!.warnings.some((w) => /malformed coefficient/i.test(w))).toBe(
      true,
    );
    expect(file!.warnings.some((w) => /no usable transforms/i.test(w))).toBe(
      true,
    );
  });

  it("drops a flame whose only xform has non-numeric coefs", () => {
    const xml = `<flame name="bad2"><xform weight="1" coefs="a b c d e f"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.scenes).toEqual([]);
    expect(file!.warnings.some((w) => /malformed coefficient/i.test(w))).toBe(
      true,
    );
  });

  it("imports a finalxform with a nonlinear variation", () => {
    const xml = `<flame><xform weight="1" coefs="1 0 0 1 0 0"/><finalxform spherical="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.finalTransform).toBeDefined();
    expect(snap.finalTransform!.variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
    const got = coefsOf(snap.finalTransform!);
    const want = [0.5, 0, 0, 0.5, 0, 0];
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("truncates a flame's transforms at MAX_TRANSFORMS and warns", () => {
    const xforms = Array.from(
      { length: 300 },
      () => `<xform weight="1" coefs="0.5 0 0 0.5 0 0"/>`,
    ).join("");
    const xml = `<flame name="huge">${xforms}</flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(
      file!.warnings.some((w) => w.includes(`first ${MAX_TRANSFORMS}`)),
    ).toBe(true);

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(MAX_TRANSFORMS);
  });

  it("clamps an oversized variation weight to the maximum", () => {
    const xml = `<flame><xform weight="1" spherical="500" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].variations).toEqual([
      { type: "spherical", weight: 100 },
    ]);
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

  it("composes a z-axis kaleidoscope copy's rotation into an affine map's coefs", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, -0.1, 0],
        rotation: [0, 0, 0.2],
        scale: [0.5, 0.4, 0],
      },
      {
        id: 1,
        position: [-0.2, 0.15, 0],
        rotation: [0, 0, -0.3],
        scale: [0.45, 0.5, 0],
      },
    ];
    const source = snapshotWith({
      transforms,
      symmetry: { order: 3, axis: "z" },
    });

    const { xml, warnings } = encodeFlameFile(source, "kaleido-affine");
    expect(warnings).toEqual([]);

    const back = loadFirstScene(xml);
    expect(back.transforms).toHaveLength(6);

    // Index 2 is copy k=1 of base transform 0 (loop order is k-major,
    // i-minor — see encodeFlameFile): its composed block should be
    // R(2π/3) · (base 0's block), rotation and translation alike.
    const theta = (2 * Math.PI) / 3;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const [a0, b0, c0, d0, e0, f0] = coefsOf(transforms[0]);
    const want = [
      cosT * a0 - sinT * b0,
      sinT * a0 + cosT * b0,
      cosT * c0 - sinT * d0,
      sinT * c0 + cosT * d0,
      cosT * e0 - sinT * f0,
      sinT * e0 + cosT * f0,
    ];
    const got = coefsOf(back.transforms[2]);
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("bakes a nonlinear kaleidoscope copy's rotation into `post`, not `coefs`", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.2, -0.1, 0],
        rotation: [0, 0, 0.1],
        scale: [0.5, 0.5, 0],
        variations: [{ type: "spherical", weight: 1 }],
      },
    ];
    const source = snapshotWith({
      transforms,
      symmetry: { order: 2, axis: "z" },
    });

    const { xml } = encodeFlameFile(source, "kaleido-nonlinear");
    // Only the rotated copy (k=1) carries a post — the unrotated original
    // (k=0) does not.
    expect((xml.match(/post="/g) ?? []).length).toBe(1);

    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.warnings.some((w) => /post transform/i.test(w))).toBe(true);

    const back = decodeScene(file!.scenes[0].encoded);
    expect(back).not.toBeNull();
    expect(back!.transforms).toHaveLength(2);
    expect(back!.transforms[0].variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
    expect(back!.transforms[1].variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
  });

  it("round-trips a finalTransform through export/import", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const finalTransform: Transform = {
      id: 0,
      position: [0.05, -0.05, 0],
      rotation: [0, 0, 0.3],
      scale: [0.8, 0.6, 0],
    };
    const source = snapshotWith({ transforms, finalTransform });

    const { xml } = encodeFlameFile(source, "final");
    expect(xml).toContain("<finalxform");

    const back = loadFirstScene(xml);
    expect(back.finalTransform).toBeDefined();
    const want = coefsOf(finalTransform);
    const got = coefsOf(back.finalTransform!);
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 3);
  });

  it("escapes special characters in the scene name and reimports it verbatim", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const source = snapshotWith({ transforms });
    const name = `a<b&"c"`;

    const { xml } = encodeFlameFile(source, name);
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.scenes[0].name).toBe(name);
  });

  it("merges duplicate variation types on export", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        variations: [
          { type: "spherical", weight: 0.3 },
          { type: "spherical", weight: 0.2 },
        ],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "merge");
    const back = loadFirstScene(xml);
    expect(back.transforms[0].variations).toHaveLength(1);
    expect(back.transforms[0].variations![0].type).toBe("spherical");
    expect(back.transforms[0].variations![0].weight).toBeCloseTo(0.5, 3);
  });

  it("round-trips a custom palette through export/import", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const source = snapshotWith({
      transforms,
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
      flame: { ...toSnapshot(initialState(false)).flame, paletteId: "custom" },
    });

    const { xml } = encodeFlameFile(source, "custom-palette");
    const back = loadFirstScene(xml);
    expect(back.customPalette).toBeDefined();
    const stops = back.customPalette!.stops;
    expect(stops[0][0]).toBeCloseTo(1, 3);
    expect(stops[0][1]).toBeCloseTo(0, 3);
    expect(stops[0][2]).toBeCloseTo(0, 3);
    const last = stops[stops.length - 1];
    expect(last[0]).toBeCloseTo(0, 3);
    expect(last[1]).toBeCloseTo(0, 3);
    expect(last[2]).toBeCloseTo(1, 3);
  });
});

describe("encodeFlameFile warnings", () => {
  it("warns when 3D structure is flattened onto the XY plane", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    const source = snapshotWith({ transforms });
    const { warnings } = encodeFlameFile(source, "three-d");
    expect(warnings.some((w) => /3D structure/i.test(w))).toBe(true);
  });

  it("warns when 4D structure is flattened onto the XY plane", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        w: { position: 0.5 },
      },
    ];
    const source = snapshotWith({ transforms });
    const { warnings } = encodeFlameFile(source, "four-d");
    expect(warnings.some((w) => /4D structure/i.test(w))).toBe(true);
  });

  it("warns when a non-z-axis kaleidoscope exports as its flat shadow", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.2, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const source = snapshotWith({
      transforms,
      symmetry: { order: 2, axis: "x" },
    });
    const { warnings } = encodeFlameFile(source, "x-kaleido");
    expect(warnings.some((w) => /x\/y/i.test(w))).toBe(true);
  });

  it("has no warnings for a z-flat system with default symmetry", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0.2, 0],
        rotation: [0, 0, 0.4],
        scale: [0.5, 0.5, 0],
      },
      {
        id: 1,
        position: [-0.2, -0.3, 0],
        rotation: [0, 0, -0.5],
        scale: [0.4, 0.45, 0],
      },
    ];
    const source = snapshotWith({ transforms });
    const { warnings } = encodeFlameFile(source, "flat");
    expect(warnings).toEqual([]);
  });

  it("writes the default exposure as brightness 4", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const source = snapshotWith({ transforms });
    const { xml } = encodeFlameFile(source, "default-header");
    expect(xml).toContain('brightness="4"');
  });
});
