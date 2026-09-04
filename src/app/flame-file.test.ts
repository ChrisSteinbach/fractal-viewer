// @vitest-environment jsdom
import { composeAffine } from "../fractal/affine";
import { DEFAULT_COLOR_SPEED, MAX_TRANSFORMS } from "../fractal/chaos-game";
import { COLLECTION_CAP } from "./collection";
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
    // `rings2`/`rings2_colors` are still unimplemented warps (the drop-list
    // shrank by exactly the parametric julia family and curl; rings2 is
    // what took julian's place in this fixture — it was the example here
    // before julian was implemented).
    const xml = `<flame><xform weight="1" rings2="1" rings2_colors="2" coefs="0.5 0 0 0.5 0.1 0.2"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms[0].variations).toBeUndefined();

    const unsupported = file!.warnings.filter((w) =>
      /Unsupported flame features/i.test(w),
    );
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toContain("rings2");
    expect(unsupported[0]).toContain("rings2_colors");
  });

  it("imports a parametric julian with its params, cleanly — the genome needs no unsupported-features warning at all", () => {
    const xml = `<flame><xform weight="1" julian="0.5" julian_power="3" julian_dist="1" coefs="0.5 0 0 0.5 0.1 0.2"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(
      file!.warnings.some((w) => /Unsupported flame features/i.test(w)),
    ).toBe(false);

    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms[0].variations).toEqual([
      { type: "julian", weight: 0.5, julianPower: 3, julianDist: 1 },
    ]);
  });

  it("imports curl and juliascope params by their own attribute names, whatever the attribute order", () => {
    const xml = `<flame><xform weight="1" curl_c2="0.75" curl="2" curl_c1="0.25" juliascope="1" juliascope_power="4" juliascope_dist="0.8" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(
      file!.warnings.some((w) => /Unsupported flame features/i.test(w)),
    ).toBe(false);
    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap!.transforms[0].variations).toEqual([
      { type: "curl", weight: 2, curlC1: 0.25, curlC2: 0.75 },
      {
        type: "juliascope",
        weight: 1,
        juliascopePower: 4,
        juliascopeDist: 0.8,
      },
    ]);
  });

  it("leaves a parametric variation's params absent when the file writes only the weight", () => {
    const xml = `<flame><xform weight="1" julian="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const file = decodeFlameFile(xml);
    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap!.transforms[0].variations).toEqual([
      { type: "julian", weight: 1 },
    ]);
  });

  it("round-trips parametric parameters through export and re-import", () => {
    const scene: SceneSnapshot = {
      ...toSnapshot(initialState(false)),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0],
          variations: [
            { type: "julian", weight: 1, julianPower: 3, julianDist: 1.5 },
          ],
        },
        {
          id: 1,
          position: [0.2, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0],
          variations: [{ type: "curl", weight: 1, curlC1: 0.5, curlC2: -1 }],
        },
      ],
    };
    const exported = encodeFlameFile(scene, "params round-trip");
    expect(
      exported.warnings.some((w) => /parametric|julian|curl/i.test(w)),
    ).toBe(false);
    const reimported = decodeFlameFile(exported.xml);
    expect(reimported).not.toBeNull();
    const snap = decodeScene(reimported!.scenes[0].encoded);
    expect(snap!.transforms[0].variations).toEqual([
      { type: "julian", weight: 1, julianPower: 3, julianDist: 1.5 },
    ]);
    expect(snap!.transforms[1].variations).toEqual([
      { type: "curl", weight: 1, curlC1: 0.5, curlC2: -1 },
    ]);
  });

  it("exports a classic-parameterized entry as the bare weight — flam3's absent-means-default convention", () => {
    const scene: SceneSnapshot = {
      ...toSnapshot(initialState(false)),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0],
          // julian_power="1" julian_dist="1" is what the resolver would
          // hand back anyway: writing them would be noise.
          variations: [{ type: "julian", weight: 2, julianPower: 1 }],
        },
      ],
    };
    const exported = encodeFlameFile(scene, "classic params");
    expect(exported.xml).toContain('julian="2"');
    expect(exported.xml).not.toContain("julian_power");
    expect(exported.xml).not.toContain("julian_dist");
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

  it("imports a chaos row without any warning, truncating a column past the base transform count", () => {
    // A single-xform system: base transform count is 1, so entry 1 (toward
    // a second base map that doesn't exist) is truncated away per flam3's
    // parser rule, leaving only entry 0 — which is 1, i.e. trivial — so the
    // row is left off the transform entirely.
    const xml = `<flame><xform weight="1" chaos="1 0" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    expect(file!.warnings.some((w) => /xaos/i.test(w))).toBe(false);
    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(1);
    expect(snap!.transforms[0].chaos).toBeUndefined();
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

  it("imports an Apophysis-style <palette> hex block as a full-resolution ramp", () => {
    const hex = Array.from({ length: 256 }, (_, i) => {
      if (i === 0) return "ff0000";
      if (i === 255) return "0000ff";
      return "808080";
    }).join("");
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><palette count="256" format="RGB">${hex}</palette></flame>`;

    const snap = loadFirstScene(xml);
    expect(snap.customPalette).toBeDefined();
    const palette = snap.customPalette!;
    if (!("kind" in palette)) throw new Error("expected a ramp palette");
    expect(palette.entries).toHaveLength(256);
    expect(palette.entries[0]).toEqual([1, 0, 0]);
    expect(palette.entries[255]).toEqual([0, 0, 1]);
    // An interior entry keeps its own color — the 8-stop point-sample this
    // module used to take never let one survive to the scene.
    expect(palette.entries[128]).toEqual([0x80 / 255, 0x80 / 255, 0x80 / 255]);
    expect(snap.flame.paletteId).toBe("custom");
    expect(snap.rampPaletteId).toBe("custom");
  });

  it("imports flam3-style <color> entries as a ramp with every entry", () => {
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><color index="0" rgb="255 0 0"/><color index="1" rgb="0 255 0"/><color index="2" rgb="0 0 255"/><color index="3" rgb="255 255 0"/></flame>`;

    const snap = loadFirstScene(xml);
    expect(snap.customPalette).toBeDefined();
    const palette = snap.customPalette!;
    if (!("kind" in palette)) throw new Error("expected a ramp palette");
    expect(palette.entries).toHaveLength(4);
    expect(palette.entries[0]).toEqual([1, 0, 0]);
    expect(palette.entries[3]).toEqual([1, 1, 0]);
  });

  it("preserves a banded palette's bright band and hard hue jump end to end", () => {
    // The import-path twin of palette.test.ts's banded-ramp acceptance
    // test: a one-entry bright band amid black and an adjacent-entry
    // red→blue jump — the features an 8-stop point sample flattened — must
    // survive the whole import → encode → decodeScene chain (which also
    // exercises the ramp wire form's validator against a real import).
    const hex = Array.from({ length: 256 }, (_, i) => {
      if (i === 100) return "ffffff";
      if (i === 200) return "ff0000";
      if (i === 201) return "0000ff";
      return "000000";
    }).join("");
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><palette count="256" format="RGB">${hex}</palette></flame>`;

    const snap = loadFirstScene(xml);
    const palette = snap.customPalette!;
    if (!("kind" in palette)) throw new Error("expected a ramp palette");
    expect(palette.entries[100]).toEqual([1, 1, 1]);
    expect(palette.entries[200]).toEqual([1, 0, 0]);
    expect(palette.entries[201]).toEqual([0, 0, 1]);
    expect(palette.entries[99]).toEqual([0, 0, 0]);
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

  it("caps the flames read from one file at the collection size and warns", () => {
    const flames = Array.from(
      { length: COLLECTION_CAP + 1 },
      (_, i) =>
        `<flame name="f${i}"><xform weight="1" coefs="0.5 0 0 0.5 0 0"/></flame>`,
    ).join("");
    const file = decodeFlameFile(`<flames>${flames}</flames>`);
    expect(file).not.toBeNull();
    expect(file!.scenes).toHaveLength(COLLECTION_CAP);
    // File order is kept: the dropped flame is the LAST one, not an arbitrary one.
    expect(file!.scenes[0].name).toBe("f0");
    expect(file!.scenes[COLLECTION_CAP - 1].name).toBe(
      `f${COLLECTION_CAP - 1}`,
    );
    expect(
      file!.warnings.some((w) => w.includes(`first ${COLLECTION_CAP} flames`)),
    ).toBe(true);
  });

  it("clamps an oversized variation weight to the maximum", () => {
    const xml = `<flame><xform weight="1" spherical="500" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].variations).toEqual([
      { type: "spherical", weight: 100 },
    ]);
  });

  it("reads an xform's `color` attribute as its palette index", () => {
    const xml = `<flame><xform weight="1" color="0.25" coefs="0.5 0 0 0.5 0 0"/><xform weight="1" color="0.8" coefs="0.5 0 0 0.5 0.2 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorIndex).toBe(0.25);
    expect(snap.transforms[1].colorIndex).toBe(0.8);
  });

  it("converts the legacy `symmetry` attribute to a color speed", () => {
    // speed = (1 - symmetry) / 2: flam3's default 0 is the halfway blend,
    // 1 is a color-pinning "symmetry xform", -1 snaps straight to the slot.
    const xml = `<flame>
      <xform weight="1" symmetry="0" coefs="0.5 0 0 0.5 0 0"/>
      <xform weight="1" symmetry="1" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" symmetry="-1" coefs="0.5 0 0 0.5 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    // persist.ts canonicalizes the default speed to absent — same meaning.
    expect(snap.transforms[0].colorSpeed ?? DEFAULT_COLOR_SPEED).toBe(0.5);
    expect(snap.transforms[1].colorSpeed).toBe(0);
    expect(snap.transforms[2].colorSpeed).toBe(1);
  });

  it("reads the modern `color_speed` attribute directly", () => {
    const xml = `<flame><xform weight="1" color_speed="0.3" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorSpeed).toBe(0.3);
  });

  it("prefers `color_speed` over the legacy `symmetry` when both are present", () => {
    // symmetry="0" would be speed 0.5; the modern attribute wins in either
    // attribute order, so a hand-edited file can't flip the reading.
    const xml = `<flame>
      <xform weight="1" symmetry="0" color_speed="0.9" coefs="0.5 0 0 0.5 0 0"/>
      <xform weight="1" color_speed="0.9" symmetry="0" coefs="0.5 0 0 0.5 0.2 0"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorSpeed).toBe(0.9);
    expect(snap.transforms[1].colorSpeed).toBe(0.9);
  });

  it("clamps out-of-range color attributes into [0, 1]", () => {
    const xml = `<flame>
      <xform weight="1" color="1.7" color_speed="4" coefs="0.5 0 0 0.5 0 0"/>
      <xform weight="1" color="-0.3" symmetry="-9" coefs="0.5 0 0 0.5 0.2 0"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorIndex).toBe(1);
    expect(snap.transforms[0].colorSpeed).toBe(1);
    expect(snap.transforms[1].colorIndex).toBe(0);
    expect(snap.transforms[1].colorSpeed).toBe(1); // (1 + 9) / 2, clamped
  });

  it("leaves the color keys absent for unparseable color attributes", () => {
    const xml = `<flame><xform weight="1" color="wat" color_speed="" symmetry="NaN" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorIndex).toBeUndefined();
    expect(snap.transforms[0].colorSpeed).toBeUndefined();
  });

  it("falls back to `symmetry` when `color_speed` is unparseable", () => {
    const xml = `<flame><xform weight="1" color_speed="wat" symmetry="1" coefs="0.5 0 0 0.5 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorSpeed).toBe(0);
  });

  it("imports an xform with no color attributes with both keys absent", () => {
    // Absent ⇒ the derived slot and DEFAULT_COLOR_SPEED apply at render time;
    // storing a value here would freeze what should stay derived.
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><xform weight="1" coefs="0.5 0 0 0.5 0.2 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].colorIndex).toBeUndefined();
    expect(snap.transforms[0].colorSpeed).toBeUndefined();
    expect(snap.transforms[1].colorIndex).toBeUndefined();
    expect(snap.transforms[1].colorSpeed).toBeUndefined();
  });

  it("imports a finalxform's color attributes onto the final transform", () => {
    const xml = `<flame><xform weight="1" coefs="0.5 0 0 0.5 0 0"/><finalxform color="0.4" color_speed="0" coefs="1 0 0 1 0 0"/></flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.finalTransform?.colorIndex).toBe(0.4);
    expect(snap.finalTransform?.colorSpeed).toBe(0);
  });
});

describe("decodeFlameFile chaos rows", () => {
  it("imports a chaos row onto Transform.chaos", () => {
    const xml = `<flame>
      <xform weight="1" chaos="2 1 0.5" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" chaos="0 1 1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].chaos).toEqual([2, 1, 0.5]);
    expect(snap.transforms[1].chaos).toBeUndefined();
    expect(snap.transforms[2].chaos).toEqual([0, 1, 1]);
  });

  it("sanitizes a chaos row's entries: non-finite reads as 1, negative clamps to 0", () => {
    const xml = `<flame>
      <xform weight="1" chaos="abc -3 2" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].chaos).toEqual([1, 0, 2]);
  });

  it("pads a short chaos row with 1s and truncates a long one to the base transform count", () => {
    const xml = `<flame>
      <xform weight="1" chaos="0.5" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" chaos="0.25 2 3 4 5" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    // One entry pads with 1s out to the 3-map base count.
    expect(snap.transforms[0].chaos).toEqual([0.5, 1, 1]);
    // Five entries truncate down to the 3-map base count.
    expect(snap.transforms[1].chaos).toEqual([0.25, 2, 3]);
  });

  it("omits an explicit all-1s chaos row — trivial reads as absent", () => {
    const xml = `<flame>
      <xform weight="1" chaos="1 1 1" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms[0].chaos).toBeUndefined();
  });

  it("reindexes chaos rows and columns around an xform the import drops between two chi-carrying ones", () => {
    // Raw xform 1 (weight 0) is dropped; raw xforms 0 and 2 survive and
    // become the imported system's indices 0 and 1. Each raw row is keyed
    // to RAW columns [0, 1, 2] — dropping column 1 (the dead xform) must
    // close the gap so the survivors' columns realign to their NEW indices
    // [0, 1].
    const xml = `<flame>
      <xform weight="1" chaos="1 0.5 2" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="0" coefs="0.5 0 0 0.5 0 0"/>
      <xform weight="1" chaos="2 1 0.5" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const file = decodeFlameFile(xml);
    expect(file).not.toBeNull();
    const snap = decodeScene(file!.scenes[0].encoded);
    expect(snap).not.toBeNull();
    expect(snap!.transforms).toHaveLength(2);
    // Raw row [1, 0.5, 2] loses column 1 (the dropped xform) -> [1, 2].
    expect(snap!.transforms[0].chaos).toEqual([1, 2]);
    // Raw row [2, 1, 0.5] loses column 1 -> [2, 0.5].
    expect(snap!.transforms[1].chaos).toEqual([2, 0.5]);
  });

  it("excludes the final transform from chi entirely: no row in, no column toward it", () => {
    const xml = `<flame>
      <xform weight="1" chaos="1 0.5" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <finalxform chaos="1 1" coefs="0.5 0 0 0.5 0 0"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    // The base row only ever spans the 2 standard xforms — a finalxform
    // attribute (even on a hand-edited file) contributes no column, and the
    // final transform itself carries no row.
    expect(snap.transforms[0].chaos).toEqual([1, 0.5]);
    expect(snap.finalTransform?.chaos).toBeUndefined();
  });

  it("imports a hand-authored flam3-style xaos flame's rows (golden fixture)", () => {
    // A hand-authored fixture in flam3's own documented xaos form: three
    // standard xforms, two chi-carrying and one plain. This is the standing
    // assertion in place of the one-time manual pixel-diff against a
    // reference renderer (flam3/Fractorium) — that check isn't reachable in
    // this environment (no such binary/browser plugin here), so it is
    // deliberately skipped, and these imported ROWS stand in for it.
    const xml = `<flame name="golden-xaos" version="flam3 3.1.1">
      <xform weight="1" chaos="1 0.5 0" color="0" linear="1" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" chaos="0 1 2" color="0.5" linear="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" color="1" linear="1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const snap = loadFirstScene(xml);
    expect(snap.transforms).toHaveLength(3);
    expect(snap.transforms[0].chaos).toEqual([1, 0.5, 0]);
    expect(snap.transforms[1].chaos).toEqual([0, 1, 2]);
    expect(snap.transforms[2].chaos).toBeUndefined();
  });

  it("round-trips chaos rows through import → export → import byte-for-byte", () => {
    const xml = `<flame>
      <xform weight="1" chaos="1 0.5 2" coefs="0.5 0 0 0.5 0.2 0"/>
      <xform weight="1" coefs="0.5 0 0 0.5 -0.2 0"/>
      <xform weight="1" chaos="0 1 1" coefs="0.4 0 0 0.4 0 0.2"/>
    </flame>`;
    const first = loadFirstScene(xml);
    expect(first.transforms[0].chaos).toEqual([1, 0.5, 2]);
    expect(first.transforms[1].chaos).toBeUndefined();
    expect(first.transforms[2].chaos).toEqual([0, 1, 1]);

    const { xml: exported } = encodeFlameFile(first, "chi-round-trip");
    const second = loadFirstScene(exported);
    expect(second.transforms[0].chaos).toEqual(first.transforms[0].chaos);
    expect(second.transforms[1].chaos).toEqual(first.transforms[1].chaos);
    expect(second.transforms[2].chaos).toEqual(first.transforms[2].chaos);
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

  it("warns that a shape emitter exports as a plain map, and stays quiet without one", () => {
    const emitter = {
      parts: [
        {
          combine: "union" as const,
          primitive: { kind: "sphere" as const, radius: 0.5 },
        },
      ],
    };
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.2, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
      {
        id: 1,
        position: [-0.2, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        emitter,
      },
    ];
    const withEmitter = encodeFlameFile(snapshotWith({ transforms }), "e");
    expect(
      withEmitter.warnings.some((w) => /shape emitter.*plain map/i.test(w)),
    ).toBe(true);
    // The xform itself still exports (plain affine — nothing else changes).
    expect(withEmitter.xml.match(/<xform /g)).toHaveLength(2);

    const plain = transforms.map(({ emitter: _e, ...rest }) => rest);
    const without = encodeFlameFile(snapshotWith({ transforms: plain }), "e");
    expect(without.warnings.some((w) => /emitter/i.test(w))).toBe(false);
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
      symmetry: { order: 3, plane: "xy" },
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
      symmetry: { order: 2, plane: "xy" },
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
    // The export writes the scene's resolved 256-entry LUT as the `<palette>`
    // block, and the import now preserves that block whole — so the payload
    // comes back as a full-resolution ramp whose endpoints land on the
    // authored stops.
    const palette = back.customPalette!;
    if (!("kind" in palette)) throw new Error("expected a ramp palette");
    expect(palette.entries).toHaveLength(256);
    const first = palette.entries[0];
    expect(first[0]).toBeCloseTo(1, 3);
    expect(first[1]).toBeCloseTo(0, 3);
    expect(first[2]).toBeCloseTo(0, 3);
    const last = palette.entries[palette.entries.length - 1];
    expect(last[0]).toBeCloseTo(0, 3);
    expect(last[1]).toBeCloseTo(0, 3);
    expect(last[2]).toBeCloseTo(1, 3);
  });

  it("round-trips authored per-transform color index and speed", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        colorIndex: 0.15,
        colorSpeed: 0.9,
      },
      {
        id: 1,
        position: [-0.2, -0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
        colorIndex: 0.75,
        colorSpeed: 0,
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "authored-color");
    const back = loadFirstScene(xml);
    expect(back.transforms[0].colorIndex).toBe(0.15);
    expect(back.transforms[0].colorSpeed).toBe(0.9);
    expect(back.transforms[1].colorIndex).toBe(0.75);
    expect(back.transforms[1].colorSpeed).toBe(0);
  });

  it("writes both spellings of color speed, consistently", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        colorSpeed: 0.25,
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "both-spellings");
    // symmetry = 1 - 2·speed, so a reader that prefers either attribute
    // reconstructs the same 0.25.
    expect(xml).toContain('color_speed="0.25" symmetry="0.5"');
  });

  it("writes the derived color slot and default speed explicitly when a system authors none", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
      {
        id: 1,
        position: [0, -0.2, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
      },
      {
        id: 2,
        position: [-0.3, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.45, 0.45, 0],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "derived-color");
    // The even spread i/(n-1) over three maps, at the 0.5 halfway blend —
    // exactly what the render resolves for an unauthored system.
    expect(xml).toContain('color="0" color_speed="0.5" symmetry="0"');
    expect(xml).toContain('color="0.5" color_speed="0.5" symmetry="0"');
    expect(xml).toContain('color="1" color_speed="0.5" symmetry="0"');

    // …and it re-imports as those same values, now explicit: same rendered
    // colors, one round trip later.
    const back = loadFirstScene(xml);
    expect(back.transforms.map((t) => t.colorIndex)).toEqual([0, 0.5, 1]);
    // The speed round-trips through persist.ts's canonicalization, which
    // drops a stored DEFAULT_COLOR_SPEED as the default it is.
    expect(
      back.transforms.map((t) => t.colorSpeed ?? DEFAULT_COLOR_SPEED),
    ).toEqual([0.5, 0.5, 0.5]);
  });

  it("writes a lone map's derived middle slot", () => {
    // derivedColorIndex(0, 1) is 0.5, not 0: there is no spread to speak of,
    // and 0.5 is the slot the render actually uses.
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "lone-map");
    expect(xml).toContain('color="0.5"');
  });

  it("gives every baked kaleidoscope copy its base map's color", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        colorIndex: 0.1,
      },
      {
        id: 1,
        position: [-0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
        colorIndex: 0.9,
      },
    ];
    const source = snapshotWith({
      transforms,
      symmetry: { order: 3, plane: "xy" },
    });

    const { xml } = encodeFlameFile(source, "kaleido-color");
    // Six xforms, k-major: each copy colors as the map it copies — flame.ts's
    // `idx % baseTransformCount` invariant in flam3's vocabulary.
    const colors = [...xml.matchAll(/<xform [^>]*\bcolor="([^"]*)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(colors).toEqual([0.1, 0.9, 0.1, 0.9, 0.1, 0.9]);
  });

  it("pins the exported finalxform's color speed to 0 (our lens never recolors)", () => {
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
      position: [0, 0, 0],
      rotation: [0, 0, 0.3],
      scale: [0.8, 0.8, 0],
      colorIndex: 0.4,
    };
    const source = snapshotWith({ transforms, finalTransform });

    const { xml } = encodeFlameFile(source, "final-color");
    // flam3 blends through its final xform at color_speed (default 0.5),
    // which would shift every plotted point's color; ours does not.
    expect(xml).toContain(
      '<finalxform color="0.4" color_speed="0" symmetry="1"',
    );
  });

  it("round-trips chi rows through export → import", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        chaos: [2, 1, 0.5],
      },
      {
        id: 1,
        position: [-0.2, -0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
      },
      {
        id: 2,
        position: [0, -0.3, 0],
        rotation: [0, 0, 0],
        scale: [0.35, 0.35, 0],
        chaos: [0, 1, 1],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "chi-round-trip");
    const back = loadFirstScene(xml);
    expect(back.transforms[0].chaos).toEqual([2, 1, 0.5]);
    expect(back.transforms[1].chaos).toBeUndefined();
    expect(back.transforms[2].chaos).toEqual([0, 1, 1]);
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

  it("warns when a kaleidoscope outside the XY plane exports as its flat shadow", () => {
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
      symmetry: { order: 2, plane: "yz" },
    });
    const { warnings } = encodeFlameFile(source, "yz-kaleido");
    expect(warnings.some((w) => /outside the XY plane/i.test(w))).toBe(true);
  });

  it("drops a 4D kaleidoscope with a warning instead of refusing the export", () => {
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
      symmetry: { order: 3, plane: "zw" },
    });
    const { xml, warnings } = encodeFlameFile(source, "zw-kaleido");
    expect(warnings.some((w) => /4D kaleidoscope/i.test(w))).toBe(true);
    // One xform, not three copies: the kaleidoscope dropped rather than
    // emitting rotations the XY projection cannot express.
    expect(xml.match(/<xform /g)).toHaveLength(1);
  });

  it("keeps a twisted w-free kaleidoscope's copies but warns that the twist was dropped", () => {
    // Plane "xy" projects faithfully, so without the twist this export would
    // carry no kaleidoscope warning at all — but the twist's second rotation
    // turns the copies through zw, which no 2D xform can express.
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
      symmetry: { order: 3, plane: "xy", twist: 1 },
    });
    const { xml, warnings } = encodeFlameFile(source, "twisted-kaleido");
    expect(warnings.some((w) => /twist/i.test(w))).toBe(true);
    // The in-plane copies still export: three xforms, only the second
    // rotation lost.
    expect(xml.match(/<xform /g)).toHaveLength(3);
  });

  it("warns only about the whole dropped kaleidoscope when a w-plane one also carries a twist", () => {
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
      symmetry: { order: 3, plane: "zw", twist: 2 },
    });
    const { warnings } = encodeFlameFile(source, "twisted-zw-kaleido");
    // The twist rides the kaleidoscope drop — a second twist warning about a
    // kaleidoscope that is not in the file would just be noise.
    expect(warnings.some((w) => /4D kaleidoscope/i.test(w))).toBe(true);
    expect(warnings.some((w) => /twist/i.test(w))).toBe(false);
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

describe("encodeFlameFile fold radii", () => {
  it("warns when a fold variation's lengths differ from the classic Mandelbox radii", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        variations: [{ type: "mandelbox", weight: 1, minRadius: 0.3 }],
      },
    ];
    const source = snapshotWith({ transforms });
    const { warnings } = encodeFlameFile(source, "custom-fold-radii");
    expect(warnings.some((w) => /classic Mandelbox lengths/i.test(w))).toBe(
      true,
    );
  });

  it("adds no warning and unchanged XML for a fold variation at the (absent) classic lengths", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        variations: [{ type: "mandelbox", weight: 1 }],
      },
    ];
    const source = snapshotWith({ transforms });
    const { xml, warnings } = encodeFlameFile(source, "default-fold-radii");
    expect(warnings).toEqual([]);
    // No radius attribute exists to write -- the xform is exactly the bare
    // type="weight" attribute it would have been before minRadius/
    // fixedRadius/boxLimit existed.
    expect(xml).toContain('mandelbox="1"');
    expect(xml).not.toMatch(/minRadius|fixedRadius|boxLimit/);
  });

  it("adds no warning for a fold variation whose lengths are present but exactly the classic values", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        variations: [
          {
            type: "mandelbox",
            weight: 1,
            minRadius: 0.5,
            fixedRadius: 1,
            boxLimit: 1,
          },
        ],
      },
    ];
    const source = snapshotWith({ transforms });
    const { warnings } = encodeFlameFile(source, "explicit-classic-fold-radii");
    expect(warnings).toEqual([]);
  });
});

describe("encodeFlameFile and the scheduled-hybrid block", () => {
  it("drops the schedule with a warning — system A alone reaches the file", () => {
    const s: SceneSnapshot = {
      ...snapshotWith({}),
      schedule: {
        transforms: [
          {
            id: 0,
            position: [0.5, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.5, 0.5, 0.5],
          },
        ],
        depth: 2,
      },
    };
    const out = encodeFlameFile(s, "scheduled");
    expect(out.warnings.some((w) => w.includes("hybrid schedule"))).toBe(true);
    // The file itself carries only system A's xforms (no extra maps).
    const xformCount = (out.xml.match(/<xform /g) ?? []).length;
    expect(xformCount).toBe(s.transforms.length);
  });

  it("a dead block (depth 0) warns exactly as it renders: not at all", () => {
    const s: SceneSnapshot = {
      ...snapshotWith({}),
      schedule: {
        transforms: [
          {
            id: 0,
            position: [0.5, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.5, 0.5, 0.5],
          },
        ],
        depth: 0,
      },
    };
    const out = encodeFlameFile(s, "dead");
    expect(out.warnings.some((w) => w.includes("hybrid schedule"))).toBe(false);
  });
});

describe("encodeFlameFile chaos rows", () => {
  it("writes chaos attributes on every xform once the system carries any non-trivial row", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        chaos: [2, 1, 0.5],
      },
      {
        id: 1,
        position: [-0.2, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
        // No row of its own — the system-level gate still writes an
        // explicit "1 1 1" here (flam3_check_unity_chaos parity: once ANY
        // row is non-trivial the file states every row explicitly).
      },
      {
        id: 2,
        position: [0.1, -0.2, 0],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0],
        chaos: [0, 1, 1],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "chaos-export");
    const rows = [...xml.matchAll(/<xform [^>]*\bchaos="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(rows).toEqual(["2 1 0.5", "1 1 1", "0 1 1"]);
  });

  it("writes no chaos attributes when every row is absent or explicitly all-1s", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        chaos: [1, 1],
      },
      {
        id: 1,
        position: [-0.2, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
      },
    ];
    const source = snapshotWith({ transforms });

    const { xml } = encodeFlameFile(source, "no-chaos-export");
    expect(xml).not.toContain("chaos=");
  });

  it("expands each kaleidoscope copy's chaos row from its base map", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0],
        chaos: [2, 1],
      },
      {
        id: 1,
        position: [-0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0],
      },
    ];
    const source = snapshotWith({
      transforms,
      symmetry: { order: 2, plane: "xy" },
    });

    const { xml } = encodeFlameFile(source, "kaleido-chaos");
    const rows = [...xml.matchAll(/<xform [^>]*\bchaos="([^"]*)"/g)].map(
      (m) => m[1],
    );
    // k-major, i-minor, matching the color test's own enumeration: copy0 of
    // base0, copy0 of base1, copy1 of base0, copy1 of base1. Both copies of
    // base0 carry the identical 4-entry row (base0's row [2, 1] broadcast to
    // every copy of each base), and likewise for base1's absent (all-1s) row.
    expect(rows).toEqual(["2 1 2 1", "1 1 1 1", "2 1 2 1", "1 1 1 1"]);
  });
});
