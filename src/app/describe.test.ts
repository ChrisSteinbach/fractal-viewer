import { describeScene } from "./describe";
import { displayedIsNonFlat, initialState } from "./state";
import type { AppState, RenderMode } from "./state";
import type { LegendPaletteControl } from "./legend-spec";
import { mulberry32 } from "../fractal/rng";
import {
  PRESET_FINITE_SOLIDS,
  PRESET_FINALS,
  PRESET_MENGER_TWISTS,
  PRESET_NAMES,
  PRESET_SCHEDULES,
  PRESET_SPHAIRAHEDRONS,
  PRESET_SPHERE_INVERSIONS,
  PRESET_SYMMETRIES,
  PRESET_TILINGS,
  PRESET_TRAPS,
  presetTransforms,
} from "../fractal/presets";
import type { Preset } from "../fractal/presets";
import type { TilingSpec } from "../fractal/tiling";
import type { Transform, VariationType } from "../fractal/types";

/** A palette-name stub: the ids the tests use are not index.html options,
 * so the lookup always answers with a fixed phrase — the one input the
 * derivation takes that a document cannot answer. */
function paletteName(_control: LegendPaletteControl, _id: string): string {
  return "Test gradient";
}

function describeOf(
  state0: AppState,
  mode: RenderMode = "points",
  seed = 1,
): string {
  // The caller's live state carries the active render mode — state.ts's
  // own convention (renderMode is session state on the document object,
  // just never persisted) — and displayedIsNonFlat reads it to decide the
  // displayed dimension per mode, so the helper syncs it the same way.
  const state: AppState = { ...state0, renderMode: mode };
  return describeScene({
    state,
    nonFlat: displayedIsNonFlat(state),
    renderMode: mode,
    paletteName,
    rng: mulberry32(seed),
  });
}

function doc(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState(false), ...overrides };
}

function linearMap(id: number, scale = 0.5): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [scale, scale, scale],
  };
}

/** A preset document with every side table applied — the sweep's builder. */
function presetDoc(name: Preset): AppState {
  const state: AppState = {
    ...initialState(false),
    transforms: presetTransforms(name),
  };
  const fin = PRESET_FINALS[name];
  if (fin) state.finalTransform = fin();
  const sym = PRESET_SYMMETRIES[name];
  if (sym) state.symmetry = sym;
  const sch = PRESET_SCHEDULES[name];
  if (sch) state.schedule = sch();
  const til = PRESET_TILINGS[name];
  if (til) state.tiling = til;
  const trap = PRESET_TRAPS[name];
  if (trap) state.shapeTrap = trap();
  const inv = PRESET_SPHERE_INVERSIONS[name];
  if (inv) state.sphereInversion = inv();
  const men = PRESET_MENGER_TWISTS[name];
  if (men) state.mengerTwist = men();
  const sph = PRESET_SPHAIRAHEDRONS[name];
  if (sph) state.sphairahedron = sph();
  const glass = PRESET_FINITE_SOLIDS[name];
  if (glass) state.finiteSolid = glass;
  return state;
}

describe("describeScene", () => {
  it("describes the default scene in one composition sentence and one look sentence", () => {
    const text = describeOf(doc());
    expect(text).toBe(
      "A point cloud of 100,000 samples — four maps, iterated at random. " +
        "Each map tinted its own color, against a dark backdrop.",
    );
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("keeps a twenty-map system to one count clause, never an inventory", () => {
    const state = doc({
      transforms: Array.from({ length: 20 }, (_, id) => linearMap(id)),
    });
    const text = describeOf(state);
    expect(text).toContain("twenty maps");
    expect(text).not.toMatch(/map \d+/);
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("is deterministic for a seed and varies across rerolls", () => {
    const state = doc({
      symmetry: { order: 6, plane: "xy" },
      transforms: presetTransforms("menger"),
    });
    expect(describeOf(state, "points", 7)).toBe(describeOf(state, "points", 7));
    const wordings = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      wordings.add(describeOf(state, "points", seed));
    }
    expect(wordings.size).toBeGreaterThan(2);
    for (const text of wordings) expect(text.length).toBeLessThanOrEqual(300);
  });

  it("names the kaleidoscope and the schedule when authored", () => {
    const state = doc({
      symmetry: { order: 5, plane: "xz" },
      schedule: { transforms: [linearMap(0)], depth: 2 },
    });
    const text = describeOf(state);
    expect(text).toMatch(
      /kaleidoscoped five-fold|five-fold kaleidoscope symmetry/,
    );
    expect(text).toMatch(
      /woven through two picks from a second system|re-bent by a second, simpler system/,
    );
  });

  it("caps the mechanism clauses at two, most distinctive first", () => {
    const state = doc({
      symmetry: { order: 4, plane: "xy" },
      schedule: { transforms: [linearMap(0)], depth: 1 },
      tiling: { group: "a3" } satisfies TilingSpec,
      balloonEcho: true,
      finalTransform: linearMap(9),
    });
    const text = describeOf(state);
    expect(text).toMatch(/second system|re-bent/);
    expect(text).toMatch(
      /kaleidoscoped four-fold|four-fold kaleidoscope symmetry/,
    );
    expect(text).not.toContain("tiled");
    expect(text).not.toContain("echo");
    expect(text).not.toContain("final map");
  });

  it("describes the sphere-inversion block as the subject in points, and the maps in flame", () => {
    const state = doc({
      transforms: presetTransforms("inversionPearls"),
      sphereInversion: PRESET_SPHERE_INVERSIONS.inversionPearls!(),
    });
    const points = describeOf(state, "points");
    expect(points).toMatch(/inverted spheres/);
    const flame = describeOf(state, "flame");
    expect(flame).not.toContain("inverted spheres");
    expect(flame).toContain("maps");
  });

  it("describes the Menger carve only in surface mode", () => {
    const state = doc({
      transforms: presetTransforms("mengerCarve"),
      mengerTwist: PRESET_MENGER_TWISTS.mengerCarve!(),
    });
    const surface = describeOf(state, "surface");
    expect(surface).toContain("Menger sponge");
    expect(surface).toContain("four levels deep");
    const points = describeOf(state, "points");
    expect(points).not.toContain("Menger");
  });

  it("describes an escape chain and a lone Mandelbulb from the routing analyzers", () => {
    const expandingFold: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [3, 3, 3],
      variations: [{ type: "boxfold", weight: 1 }],
    };
    const contractingFold: Transform = {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      variations: [{ type: "boxfold", weight: 1 }],
    };
    expect(
      describeOf(doc({ transforms: [expandingFold, contractingFold] })),
    ).toContain("chain of two folding steps");

    const bulb: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "bulb", weight: 1 }],
    };
    expect(describeOf(doc({ transforms: [bulb] }))).toContain(
      "a single triplex-power formula",
    );
  });

  it("phrases the fourth dimension per mode", () => {
    const state = doc({ transforms: presetTransforms("pentatope") });
    expect(displayedIsNonFlat(state)).toBe(true);
    expect(describeOf(state, "points")).toContain(
      "projected from four dimensions",
    );
    expect(describeOf(state, "surface")).toContain(
      "sliced out of four dimensions",
    );
    // A non-flat system renders 4D natively in Flame too (flame-4d), so the
    // clause follows the transforms' dimension there.
    expect(describeOf(state, "flame")).toContain("four dimensions");
  });

  it("keeps the 4D clause off a 4D block's dormant flame rendering", () => {
    // A 4D sphere-inversion block replaces the subject in Points and
    // Surface, but Flame and Solid draw the transforms — which are FLAT
    // placeholders — so the dimension the panel displays there is flat.
    const state = doc({
      transforms: presetTransforms("inversionPearls"),
      sphereInversion: {
        arrangement: "cell24",
        radiusFraction: 0.99,
        seed: { kind: "ball", size: 0.3 },
        depth: 8,
      },
    });
    expect(displayedIsNonFlat(state)).toBe(true);
    expect(describeOf(state, "points")).toMatch(/dimension/);
    expect(describeOf(state, "flame")).not.toMatch(/dimension/);
  });

  it("groups authored finishes into one impression and defers to refracting glass", () => {
    // The look sentence capitalizes its first fragment, so match loosely.
    const lowered = (text: string) => text.toLowerCase();
    const metal: Transform = {
      ...linearMap(0),
      finish: { metalness: 1, specular: 0.9, shininess: 120 },
    };
    const classic: Transform = linearMap(1);
    expect(
      lowered(describeOf(doc({ transforms: [metal, classic] }), "surface")),
    ).toContain("polished to metal");
    const matte: Transform = { ...linearMap(1), finish: { specular: 0.1 } };
    expect(
      lowered(describeOf(doc({ transforms: [metal, matte] }), "surface")),
    ).toContain("a mix of finishes");
    const glass: Transform = {
      ...linearMap(2),
      optics: { model: "dielectric" },
    };
    expect(
      lowered(describeOf(doc({ transforms: [metal, glass] }), "surface")),
    ).toContain("with refracting glass");
    // Classic finishes say nothing — the authored-only rule.
    expect(describeOf(doc(), "surface")).not.toContain("polished");
  });

  it("narrates the active render's coloring", () => {
    const lowered = (text: string) => text.toLowerCase();
    expect(lowered(describeOf(doc({ colorMode: "height" })))).toContain(
      "colored by height",
    );
    expect(lowered(describeOf(doc({ colorMode: "radius" })))).toContain(
      "distance",
    );
    const flameLegacy = describeOf(
      doc({ flame: { ...initialState(false).flame, paletteId: "legacy" } }),
      "flame",
    );
    expect(flameLegacy).toContain("colored along the orbit");
    expect(flameLegacy).toContain("million light iterations");
    const flamePalette = describeOf(
      doc({ flame: { ...initialState(false).flame, paletteId: "spectrum" } }),
      "flame",
    );
    expect(flamePalette).toContain("in Test gradient palette colors");
    const wMode = doc({
      transforms: presetTransforms("pentatope"),
      fourDColor: "wBlueOrange",
    });
    expect(describeOf(wMode, "points")).toContain("fourth dimension");
  });

  it("speaks the background, including the radial vignette", () => {
    expect(describeOf(doc({ background: { mode: "haze" } }))).toContain(
      "in a soft haze",
    );
    const radial = describeOf(
      doc({ background: { mode: "dark", shape: "radial" } }),
    );
    expect(radial).toContain("with a soft vignette");
  });

  it("never leaks raw vocabulary for an unknown variation type", () => {
    const unknown: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      variations: [{ type: "notARealType" as VariationType, weight: 1 }],
    };
    const text = describeOf(doc({ transforms: [unknown] }));
    expect(text).not.toContain("notARealType");
    expect(text).toContain("a single map");
  });

  it("describes every shipped preset coherently in every render mode", () => {
    for (const name of PRESET_NAMES) {
      const state = presetDoc(name);
      for (const mode of ["points", "flame", "solid", "surface"] as const) {
        for (const seed of [1, 2, 3]) {
          const text = describeOf(state, mode, seed);
          // No leaked internals — unknown vocabulary reads neutral, never
          // as a raw identifier, and no count ever reads "undefined".
          expect(text, `${name}/${mode}/seed${seed}`).not.toMatch(
            /undefined|NaN|\[object/,
          );
          // A reroll of the same seed is the same text — the determinism
          // contract across every document shape.
          expect(
            describeOf(state, mode, seed),
            `${name}/${mode}/seed${seed}`,
          ).toBe(text);
          // Every description stays post-sized, even for the richest
          // documents the side tables can assemble.
          expect(
            text.length,
            `${name}/${mode}/seed${seed}`,
          ).toBeLessThanOrEqual(300);
        }
      }
    }
  });

  it("keeps the no-symmetry, no-block document free of mechanism clauses", () => {
    const text = describeOf(doc());
    expect(text).not.toContain("kaleidoscop");
    expect(text).not.toContain("tiled");
    expect(text).not.toContain("echo");
    expect(text).not.toContain("lens");
  });
});
