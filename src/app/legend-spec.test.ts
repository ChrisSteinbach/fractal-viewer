import { deriveLegend } from "./legend-spec";
import type { LegendInputs, LegendSpec, LegendSwatchItem } from "./legend-spec";
import { initialState, MAX_COLOR_GAMMA } from "./state";
import type { AppState } from "./state";
import { surfaceColorLUT } from "./control-spec";
import { buildColorModeLUT } from "../fractal/color";
import { buildPaletteLUT } from "../fractal/palette";
import { defaultTransforms, mandelboxClassic } from "../fractal/presets";
import { PEACE_SIGN_SHAPE } from "../fractal/shapes";
import { to255 } from "../fractal/vec";

/**
 * `deriveLegend` over `state` with the panel's three non-state inputs at
 * their ordinary values — the showcase disarmed, the system flat, and a
 * palette-name lookup handing back the raw id. The real lookup reads
 * index.html's `<option>` labels, which is `ui.test.ts`'s to cover; here a
 * caption reading "sunset palette" says the derivation asked for the right
 * palette. Each test overrides exactly the input its behavior turns on.
 */
function legendOf(
  state: AppState,
  over: Partial<LegendInputs> = {},
): LegendSpec {
  return deriveLegend({
    state,
    nonFlat: false,
    replayShowcase: false,
    paletteName: (_control, id) => id,
    ...over,
  });
}

/** The spec as a gradient bar — a wrong family names itself here rather than
 * failing later on an undefined label. */
function bar(spec: LegendSpec) {
  if (spec.kind !== "bar") {
    throw new Error(`expected a gradient bar, got "${spec.kind}"`);
  }
  return spec;
}

/** The spec's swatch-strip items, same diagnosis-first contract as {@link bar}. */
function items(spec: LegendSpec): readonly LegendSwatchItem[] {
  if (spec.kind !== "swatches") {
    throw new Error(`expected a swatch strip, got "${spec.kind}"`);
  }
  return spec.items;
}

/** The CSS `rgb()` string for LUT entry `index` (0-255) — the same
 * byte-conversion the legend itself uses (color management is disabled, so
 * these bytes match the rendered cloud exactly). */
function lutRgb(lut: Float32Array, index: number): string {
  const o = index * 3;
  return `rgb(${to255(lut[o])}, ${to255(lut[o + 1])}, ${to255(lut[o + 2])})`;
}

describe("deriveLegend color-mode ramps", () => {
  it("keys height mode as a gradient bar labeled low/high", () => {
    const spec = legendOf({ ...initialState(true), colorMode: "height" });

    expect(spec.kind).toBe("bar");
    expect(bar(spec).low).toBe("low");
    expect(bar(spec).mid).toBe("");
    expect(bar(spec).high).toBe("high");
  });

  it("draws the height bar blue at the low end and red at the high end", () => {
    const spec = legendOf({ ...initialState(true), colorMode: "height" });

    // Endpoints derived from the shared ramp (color.ts's writeHeightColor via
    // buildColorModeLUT) rather than hardcoded, so a ramp tweak can't leave
    // this assertion silently checking the wrong colors.
    const lut = buildColorModeLUT("height", 1);
    const { gradient } = bar(spec);
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(gradient).toContain(lowRgb);
    expect(gradient).toContain(highRgb);
    // Not just present — in this order. A flipped (high→low) gradient would
    // still contain both colors, so containment alone can't catch that.
    expect(gradient.indexOf(lowRgb)).toBeLessThan(gradient.indexOf(highRgb));
  });

  it("keys radius mode as a gradient bar labeled center/edge", () => {
    const spec = legendOf({ ...initialState(true), colorMode: "radius" });

    expect(bar(spec).low).toBe("center");
    expect(bar(spec).high).toBe("edge");
  });

  it("draws the radius bar warm at the center and cool at the edge", () => {
    const spec = legendOf({ ...initialState(true), colorMode: "radius" });

    const lut = buildColorModeLUT("radius", 1);
    const { gradient } = bar(spec);
    const centerRgb = lutRgb(lut, 0);
    const edgeRgb = lutRgb(lut, 255);
    expect(gradient).toContain(centerRgb);
    expect(gradient).toContain(edgeRgb);
    // Not just present — in this order. A flipped (edge→center) gradient
    // would still contain both colors, so containment alone can't catch that.
    expect(gradient.indexOf(centerRgb)).toBeLessThan(gradient.indexOf(edgeRgb));
  });

  it("reshapes a mid gradient stop under a non-1 colorGamma while the endpoints stay fixed", () => {
    const neutral = bar(
      legendOf({ ...initialState(true), colorMode: "height", colorGamma: 1 }),
    ).gradient;
    const gamma = bar(
      legendOf({ ...initialState(true), colorMode: "height", colorGamma: 3 }),
    ).gradient;

    // The bar as a whole looks different under the reshaped ramp…
    expect(gamma).not.toBe(neutral);
    // …but applyColorGamma always fixes t=0 and t=1, so the two endpoint
    // colors are identical regardless of gamma — only the interior moves.
    const lut = buildColorModeLUT("height", 1);
    expect(gamma).toContain(lutRgb(lut, 0));
    expect(gamma).toContain(lutRgb(lut, 255));
  });

  it("shows the ramp palette's own colors in the height bar when rampPaletteId is a gradient", () => {
    const legacy = bar(
      legendOf({
        ...initialState(true),
        colorMode: "height",
        rampPaletteId: "legacy",
      }),
    ).gradient;

    // "ember" (not "spectrum"): its non-integer c coefficients on two
    // channels (palette.ts) are what give the flame palette legend test
    // below a genuine endpoint order too — same reason it applies here.
    const spec = bar(
      legendOf({
        ...initialState(true),
        colorMode: "height",
        rampPaletteId: "ember",
      }),
    );

    // Endpoints derived from the same rampPalette-aware LUT the height mode
    // now samples (buildColorModeLUT's third argument), in left-to-right order
    // — the legend's can't-drift bar, extended to the gradient ramps.
    expect(spec.gradient).not.toBe(legacy);
    const lut = buildColorModeLUT("height", 1, "ember");
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(spec.gradient).toContain(lowRgb);
    expect(spec.gradient).toContain(highRgb);
    expect(spec.gradient.indexOf(lowRgb)).toBeLessThan(
      spec.gradient.indexOf(highRgb),
    );
  });

  it("keeps the height bar's low/high labels under a gradient ramp palette", () => {
    const spec = legendOf({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "ember",
    });

    expect(bar(spec).low).toBe("low");
    expect(bar(spec).high).toBe("high");
  });

  it("hides the legend entirely for uniform coloring", () => {
    expect(legendOf({ ...initialState(true), colorMode: "uniform" }).kind).toBe(
      "hidden",
    );
  });
});

describe("deriveLegend transform + position keys", () => {
  it("shows one swatch per transform, tracking transforms.length after add/remove", () => {
    const strip = (count: number) =>
      items(
        legendOf({
          ...initialState(true),
          colorMode: "transform",
          transforms: Array.from(
            { length: count },
            () => defaultTransforms()[0],
          ),
        }),
      );

    expect(strip(3)).toHaveLength(3);
    expect(strip(5)).toHaveLength(5);
    expect(strip(2)).toHaveLength(2);
  });

  it("caps transform swatches at 12 and folds the rest into a '+N' indicator", () => {
    const thirteen = Array.from({ length: 13 }, () => defaultTransforms()[0]);

    const strip = items(
      legendOf({
        ...initialState(true),
        colorMode: "transform",
        transforms: thirteen,
      }),
    );

    expect(strip.filter((item) => item.kind === "swatch")).toHaveLength(12);
    expect(strip.at(-1)).toEqual({ kind: "label", text: "+1" });
  });

  it("shows X/Y/Z-labeled axis swatches for position mode", () => {
    const spec = legendOf({ ...initialState(true), colorMode: "position" });

    expect(items(spec)).toEqual([
      { kind: "label", text: "X" },
      { kind: "swatch", color: "rgb(255, 0, 0)" },
      { kind: "label", text: "Y" },
      { kind: "swatch", color: "rgb(0, 255, 0)" },
      { kind: "label", text: "Z" },
      { kind: "swatch", color: "rgb(0, 0, 255)" },
    ]);
  });

  it("the axis swatches follow custom axis colors", () => {
    const spec = legendOf({
      ...initialState(true),
      colorMode: "position",
      positionAxisColors: {
        x: [1, 0.5, 0],
        y: [0, 0.5, 1],
        z: [0.2, 0.4, 0.6],
      },
    });

    expect(
      items(spec)
        .filter((item) => item.kind === "swatch")
        .map((item) => (item.kind === "swatch" ? item.color : "")),
    ).toEqual(["rgb(255, 128, 0)", "rgb(0, 128, 255)", "rgb(51, 102, 153)"]);
  });
});

describe("deriveLegend surface render", () => {
  it("keys the legend on the SURFACE colorSource while the surface render is active", () => {
    // The legend must narrate the tracer's own coloring, not the explorer
    // colorMode the panel left behind.
    const base = initialState(true);

    const spec = legendOf({
      ...base,
      colorMode: "height",
      renderMode: "surface",
      surface: { ...base.surface, colorSource: "transform" },
    });

    expect(spec.kind).toBe("swatches");
  });

  it("keys the legend on the surface colorSource for a 4D DOCUMENT too", () => {
    // The old order tested document 4D-ness before the render mode, so a
    // 4D surface session rendered by-transform colors under the explorer's
    // −w/+w ramp — a legend describing nothing on screen (the user-reported
    // shape: pentatope in Surface mode, By Transform source, w-ramp bar).
    const base = initialState(true);

    const spec = legendOf(
      {
        ...base,
        renderMode: "surface",
        surface: { ...base.surface, colorSource: "transform" },
      },
      { nonFlat: true },
    );

    expect(spec.kind).toBe("swatches");
  });

  it("keeps the points view's 4D w-ramp legend when the explorer IS the active render", () => {
    const spec = legendOf(initialState(true), { nonFlat: true });

    expect(bar(spec).mid).toBe("in our 3-space");
  });

  it("shows the surface palette's own gradient and name for the orbit-trap source", () => {
    const base = initialState(true);
    const state = {
      ...base,
      renderMode: "surface" as const,
      surface: {
        ...base.surface,
        colorSource: "palette" as const,
        paletteId: "sunset" as const,
      },
    };

    const spec = bar(legendOf(state));

    expect(spec.mid).toBe("sunset palette");
    // Endpoints derived from the EXACT LUT the tracer samples
    // (surfaceColorLUT), so the key can never drift from the render.
    const lut = surfaceColorLUT(state);
    expect(lut).not.toBeNull();
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 0));
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 255));
  });

  it('renders the same named-gradient bar as "palette" for the "rings" source', () => {
    // rings rides the same descent hit-info as palette, just reading a
    // different coordinate off it — same named-gradient legend, not the
    // swatch strip or a ramp.
    const base = initialState(true);
    const state = {
      ...base,
      renderMode: "surface" as const,
      surface: {
        ...base.surface,
        colorSource: "rings" as const,
        paletteId: "sunset" as const,
      },
    };

    const spec = bar(legendOf(state));

    expect(spec.mid).toBe("sunset palette");
    const lut = surfaceColorLUT(state);
    expect(lut).not.toBeNull();
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 0));
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 255));
  });

  it('renders the same named-gradient bar as "palette" for the "sheets" source', () => {
    const base = initialState(true);
    const state = {
      ...base,
      renderMode: "surface" as const,
      surface: {
        ...base.surface,
        colorSource: "sheets" as const,
        paletteId: "sunset" as const,
      },
    };

    const spec = bar(legendOf(state));

    expect(spec.mid).toBe("sunset palette");
    const lut = surfaceColorLUT(state);
    expect(lut).not.toBeNull();
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 0));
    expect(spec.gradient).toContain(lutRgb(lut as Float32Array, 255));
  });

  it("labels the surface height ramp low/high like the explorer's height mode", () => {
    const base = initialState(true);

    const spec = legendOf({
      ...base,
      renderMode: "surface",
      surface: { ...base.surface, colorSource: "height" },
    });

    expect(bar(spec).low).toBe("low");
    expect(bar(spec).high).toBe("high");
  });

  it("reflects the user-authored custom gradient in the surface palette key", () => {
    const base = initialState(true);

    const spec = bar(
      legendOf({
        ...base,
        renderMode: "surface",
        surface: {
          ...base.surface,
          colorSource: "palette",
          paletteId: "custom",
        },
        customPalette: {
          stops: [
            [1, 0, 0],
            [0, 0, 1],
          ],
        },
      }),
    );

    expect(spec.gradient).toContain("rgb(255, 0, 0)");
    expect(spec.gradient).toContain("rgb(0, 0, 255)");
  });

  it("names the surface palette from the surface render's own select", () => {
    const base = initialState(true);

    const spec = legendOf(
      {
        ...base,
        renderMode: "surface",
        surface: { ...base.surface, colorSource: "palette" },
      },
      { paletteName: (control) => control },
    );

    expect(bar(spec).mid).toBe("surfacePalette palette");
  });
});

describe("deriveLegend palette-driven renders", () => {
  it("hides the legend while a flame render uses the legacy palette", () => {
    const base = initialState(true);

    const spec = legendOf({
      ...base,
      colorMode: "height",
      renderMode: "flame",
      flame: { ...base.flame, paletteId: "legacy" },
    });

    // Legacy flame color is per-producing-transform along the orbit — not a
    // 1D ramp — so there is no strip the legend could truthfully draw.
    expect(spec.kind).toBe("hidden");
  });

  it("shows the active palette strip while a flame render uses a gradient palette", () => {
    const base = initialState(true);

    const spec = bar(
      legendOf({
        ...base,
        // uniform would hide the colorMode legend — proving the palette strip
        // doesn't come from colorMode at all.
        colorMode: "uniform",
        renderMode: "flame",
        // Not "spectrum": its c coefficients (palette.ts) are all integers, so
        // the cosine ramp is exactly periodic and t=0/t=1 land on the identical
        // color — useless for the endpoint-ordering assertion below. "ember"
        // has a non-integer c on two channels, so its ends genuinely differ.
        flame: { ...base.flame, paletteId: "ember" },
      }),
    );

    expect(spec.low).toBe("");
    expect(spec.mid).toBe("ember palette");
    expect(spec.high).toBe("");
    // Endpoints derived from the very LUT the flame render indexes
    // (buildPaletteLUT), in left-to-right order — the can't-drift bar.
    const lut = buildPaletteLUT("ember");
    if (lut === null) throw new Error("ember must have a LUT");
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(spec.gradient).toContain(lowRgb);
    expect(spec.gradient).toContain(highRgb);
    expect(spec.gradient.indexOf(lowRgb)).toBeLessThan(
      spec.gradient.indexOf(highRgb),
    );
  });

  it("shows the active palette strip while the solid render uses a gradient palette", () => {
    const base = initialState(true);

    // voxel.ts's accumulateVoxels colors from the palette's LUT instead of
    // colorMode once a non-"legacy" palette is picked — so the legend shows
    // that palette's strip, named, rather than the colorMode ramp.
    const spec = bar(
      legendOf({
        ...base,
        colorMode: "height",
        renderMode: "solid",
        solid: { ...base.solid, paletteId: "aurora" },
      }),
    );

    expect(spec.mid).toBe("aurora palette");
    expect(spec.low).toBe("");
    expect(spec.high).toBe("");
  });

  it("keeps the colorMode ramp while the solid render is active with the legacy palette", () => {
    const base = initialState(true);

    // The "legacy" solid palette follows colorMode/colorGamma exactly, so
    // the legend (and its gradient bar) stays accurate here.
    const spec = legendOf({
      ...base,
      colorMode: "height",
      renderMode: "solid",
      solid: { ...base.solid, paletteId: "legacy" },
    });

    expect(bar(spec).low).toBe("low");
  });

  it("swaps the colorMode ramp for the palette strip when the solid palette leaves legacy", () => {
    const base = initialState(true);

    const spec = bar(
      legendOf({
        ...base,
        colorMode: "height",
        renderMode: "solid",
        solid: { ...base.solid, paletteId: "spectrum" },
      }),
    );

    expect(spec.mid).toBe("spectrum palette");
    expect(spec.low).toBe("");
  });

  it("names each render's palette from that render's own select", () => {
    const base = initialState(true);
    const control = { paletteName: (c: string) => c };

    const flame = legendOf(
      {
        ...base,
        renderMode: "flame",
        flame: { ...base.flame, paletteId: "ember" },
      },
      control,
    );
    const solid = legendOf(
      {
        ...base,
        renderMode: "solid",
        solid: { ...base.solid, paletteId: "ember" },
      },
      control,
    );

    expect(bar(flame).mid).toBe("flamePalette palette");
    expect(bar(solid).mid).toBe("solidPalette palette");
  });
});

describe("deriveLegend 4D projection", () => {
  it("shows the diverging w ramp with signed end labels for a 4D system", () => {
    const spec = bar(legendOf(initialState(true), { nonFlat: true }));

    expect(spec.low).toBe("−w");
    expect(spec.mid).toBe("in our 3-space");
    expect(spec.high).toBe("+w");
  });

  it("draws the wBlueOrange ramp blue → gray notch → orange", () => {
    const spec = bar(legendOf(initialState(true), { nonFlat: true }));

    // Hardcoded on purpose: the side COLORS are shared DATA
    // (color.ts's W_SIDE_PALETTES.wBlueOrange, fed to both the shader's
    // uSideNeg/uSidePos uniforms and this legend) so they can't drift from
    // each other — but the ramp's SHAPE is still hand-mirrored from
    // FOUR_D_VERTEX's GLSL (scene.ts), which a TS test cannot import: the
    // 0.38 gray baseline, the 0.6 magnitude exponent, and the 0.30 + 0.70
    // brightness scale. At s = −1 the shader yields the pure blue side
    // (0.30, 0.60, 1.00), at s = +1 the pure orange side (1.00, 0.50, 0.18),
    // and at s = 0 the dim gray notch 0.38 * 0.30 = 0.114 per channel. If
    // either the shared palette or the GLSL ramp shape changes, this test
    // must change with it — that is the keep-in-sync contract.
    const blue = "rgb(77, 153, 255)";
    const gray = "rgb(29, 29, 29)";
    const orange = "rgb(255, 128, 46)";
    expect(spec.gradient).toContain(blue);
    expect(spec.gradient).toContain(gray);
    expect(spec.gradient).toContain(orange);
    expect(spec.gradient.indexOf(blue)).toBeLessThan(
      spec.gradient.indexOf(gray),
    );
    expect(spec.gradient.indexOf(gray)).toBeLessThan(
      spec.gradient.indexOf(orange),
    );
  });

  it("shows the 4D legend even in uniform color mode", () => {
    // The 4D view colors by the rotated w in-shader; colorMode — including
    // uniform's "nothing to key" — simply doesn't apply.
    const spec = legendOf(
      { ...initialState(true), colorMode: "uniform" },
      { nonFlat: true },
    );

    expect(bar(spec).mid).toBe("in our 3-space");
  });

  it("keeps the 4D w ramp fixed as color contrast changes", () => {
    const neutral = bar(
      legendOf({ ...initialState(true), colorGamma: 1 }, { nonFlat: true }),
    ).gradient;
    const contrasted = bar(
      legendOf(
        { ...initialState(true), colorGamma: MAX_COLOR_GAMMA },
        { nonFlat: true },
      ),
    ).gradient;

    // Unlike the height/radius ramps, the shader never applies
    // colorGamma to the w palette — the legend must not pretend it does.
    expect(contrasted).toBe(neutral);
  });

  it("draws the wPurpleGreen ramp purple → gray notch → green", () => {
    const spec = bar(
      legendOf(
        { ...initialState(true), fourDColor: "wPurpleGreen" },
        { nonFlat: true },
      ),
    );

    expect(spec.low).toBe("−w");
    expect(spec.high).toBe("+w");
    // Hardcoded on purpose, exactly like the wBlueOrange test above: these
    // pin color.ts's W_SIDE_PALETTES.wPurpleGreen data AND the ramp's
    // mirrored GLSL shape constants (0.38 gray, ^0.6, 0.30 + 0.70).
    const purple = "rgb(158, 97, 255)";
    const gray = "rgb(29, 29, 29)";
    const green = "rgb(102, 242, 89)";
    expect(spec.gradient).toContain(purple);
    expect(spec.gradient).toContain(gray);
    expect(spec.gradient).toContain(green);
    expect(spec.gradient.indexOf(purple)).toBeLessThan(
      spec.gradient.indexOf(gray),
    );
    expect(spec.gradient.indexOf(gray)).toBeLessThan(
      spec.gradient.indexOf(green),
    );
  });

  it("draws the wCyanMagenta ramp cyan → gray notch → magenta", () => {
    const spec = bar(
      legendOf(
        { ...initialState(true), fourDColor: "wCyanMagenta" },
        { nonFlat: true },
      ),
    );

    expect(spec.low).toBe("−w");
    expect(spec.high).toBe("+w");
    // Hardcoded on purpose, same rationale as the other two w-depth ramps.
    const cyan = "rgb(51, 217, 242)";
    const gray = "rgb(29, 29, 29)";
    const magenta = "rgb(255, 77, 191)";
    expect(spec.gradient).toContain(cyan);
    expect(spec.gradient).toContain(gray);
    expect(spec.gradient).toContain(magenta);
    expect(spec.gradient.indexOf(cyan)).toBeLessThan(
      spec.gradient.indexOf(gray),
    );
    expect(spec.gradient.indexOf(gray)).toBeLessThan(
      spec.gradient.indexOf(magenta),
    );
  });

  it("shows a swatch strip, one per transform, for the 4D transform color mode", () => {
    const state = { ...initialState(true), fourDColor: "transform" as const };

    const spec = legendOf(state, { nonFlat: true });

    expect(items(spec)).toHaveLength(state.transforms.length);
  });

  it("shows the radius gradient bar for the 4D radius color mode", () => {
    const spec = legendOf(
      { ...initialState(true), fourDColor: "radius" },
      { nonFlat: true },
    );

    expect(bar(spec).low).toBe("center");
    expect(bar(spec).high).toBe("edge");
  });

  it("keeps the 4D radius ramp fixed as color contrast changes", () => {
    const neutral = bar(
      legendOf(
        { ...initialState(true), fourDColor: "radius", colorGamma: 1 },
        { nonFlat: true },
      ),
    ).gradient;
    const contrasted = bar(
      legendOf(
        {
          ...initialState(true),
          fourDColor: "radius",
          colorGamma: MAX_COLOR_GAMMA,
        },
        { nonFlat: true },
      ),
    ).gradient;

    // Gamma-neutral contract: the 4D view never applies colorGamma, so the
    // baked radius ramp must not react to it either — mirrors the w-ramp's
    // own "keeps the 4D w ramp fixed as color contrast changes" test above.
    expect(contrasted).toBe(neutral);
  });

  it("shows the ramp palette's own colors in the 4D radius legend when rampPaletteId is a gradient", () => {
    const legacy = bar(
      legendOf(
        {
          ...initialState(true),
          fourDColor: "radius",
          rampPaletteId: "legacy",
        },
        { nonFlat: true },
      ),
    ).gradient;

    // "ember" again for a genuine endpoint order — same reason as the flat
    // height legend test above (its non-integer c coefficients on two
    // channels give distinct low/high colors).
    const spec = bar(
      legendOf(
        { ...initialState(true), fourDColor: "radius", rampPaletteId: "ember" },
        { nonFlat: true },
      ),
    );

    expect(spec.low).toBe("center");
    expect(spec.high).toBe("edge");
    expect(spec.gradient).not.toBe(legacy);
    // Endpoints derived from the same rampPalette-aware LUT the 4D radius
    // bake now samples (buildColorModeLUT's third argument), gamma pinned to
    // 1 — the 4D view never applies colorGamma.
    const lut = buildColorModeLUT("radius", 1, "ember");
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(spec.gradient).toContain(lowRgb);
    expect(spec.gradient).toContain(highRgb);
    expect(spec.gradient.indexOf(lowRgb)).toBeLessThan(
      spec.gradient.indexOf(highRgb),
    );
  });
});

describe("deriveLegend build-replay showcase", () => {
  it("narrates the showcase's by-transform recoloring, whatever the document says", () => {
    // The showcase recolors the DISPLAY by transform without touching the
    // document, so a uniform colorMode — which would otherwise hide the
    // legend outright — must still show the swatch strip.
    const three = Array.from({ length: 3 }, () => defaultTransforms()[0]);

    const spec = legendOf(
      { ...initialState(true), colorMode: "uniform", transforms: three },
      { replayShowcase: true },
    );

    expect(items(spec)).toHaveLength(3);
  });

  it("outranks an active render's own palette key", () => {
    const base = initialState(true);

    const spec = legendOf(
      {
        ...base,
        renderMode: "flame",
        flame: { ...base.flame, paletteId: "ember" },
      },
      { replayShowcase: true },
    );

    expect(spec.kind).toBe("swatches");
  });
});

describe("the surface shapeTrap color source", () => {
  it("shows the palette bar when the trap is LIVE — an escape-family document with a trap block", () => {
    const base = initialState(false);
    const state: AppState = {
      ...base,
      transforms: mandelboxClassic(),
      renderMode: "surface",
      shapeTrap: { shape: PEACE_SIGN_SHAPE },
      surface: { ...base.surface, colorSource: "shapeTrap" },
    };
    const spec = bar(legendOf(state));
    expect(spec.mid).toBe(`${state.surface.paletteId} palette`);
  });

  it("narrates the pinned fallback — by-transform swatches — when the source is selected without a live trap", () => {
    const base = initialState(false);
    // No trap block on an escape-family document…
    const noBlock: AppState = {
      ...base,
      transforms: mandelboxClassic(),
      renderMode: "surface",
      surface: { ...base.surface, colorSource: "shapeTrap" },
    };
    expect(legendOf(noBlock).kind).toBe("swatches");
    // …and a trap block on a DESCENT document (an ordinary contracting
    // IFS), whose session carries no trap channel at all.
    const wrongFamily: AppState = {
      ...base,
      renderMode: "surface",
      shapeTrap: { shape: PEACE_SIGN_SHAPE },
      surface: { ...base.surface, colorSource: "shapeTrap" },
    };
    expect(legendOf(wrongFamily).kind).toBe("swatches");
  });
});
