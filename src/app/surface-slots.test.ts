import { derivedColorIndex } from "../fractal/chaos-game";
import { transformColors } from "../fractal/color";
import type { Transform } from "../fractal/types";
import { CLASSIC_SURFACE_FINISH } from "../fractal/surface-finish";
import { CLASSIC_SURFACE_MATERIAL } from "../fractal/surface-material-wire";
import {
  surfaceSlotColors,
  surfaceForwardSlot,
  surfaceSlotMaterials,
  surfaceTrapIndices,
} from "./surface-slots";
import type { SurfaceSlot } from "./surface-slots";

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

const calibration = {
  ringsLow: 0.1,
  ringsInvSpan: 2,
  sheetsLow: 0.2,
  sheetsInvSpan: 3,
};

describe("surfaceTrapIndices", () => {
  it("takes an authored colorIndex as the slot's coordinate over the derived ramp spread", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1, colorIndex: 0.9 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [
      { baseIndex: 0 },
      { baseIndex: 1 },
      { baseIndex: 2 },
    ];
    // Middle map authored 0.9; its neighbours keep the even ramp spread.
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0, 0.9, 1]);
  });

  it("with no colorIndex authored anywhere, spreads slots evenly over the ramp by baseIndex", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [
      { baseIndex: 0 },
      { baseIndex: 1 },
      { baseIndex: 2 },
    ];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0, 0.5, 1]);
  });

  it("honors an authored 0 as the slot's coordinate instead of silently falling back to the spread (?? not ||)", () => {
    // The middle map authors exactly 0 — falsy, so a `||`-based fallback
    // would read out the derived spread (0.5) instead of the authored
    // value. `??` only defers to the spread on null/undefined, so the
    // authored 0 has to win here.
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1, colorIndex: 0 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [
      { baseIndex: 0 },
      { baseIndex: 1 },
      { baseIndex: 2 },
    ];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0, 0, 1]);
  });

  it("parks a lone unauthored map at the ramp start, NOT the flame's mid-ramp derivedColorIndex(0, 1) slot", () => {
    // Deliberate divergence from chaos-game.ts: the flame parks a lone map
    // mid-ramp (0.5, there being no spread to speak of), but adopting that
    // here would repaint every existing single-map surface scene, so the
    // surface parks it at the ramp start instead. Assert both sides so a
    // future reader cannot "unify" the two without a red test explaining why
    // not.
    const transforms = [transform({ id: 0 })];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0]);
    expect(derivedColorIndex(0, 1)).toBe(0.5);
  });

  it("lets an authored colorIndex move a lone map off the ramp start", () => {
    const transforms = [transform({ id: 0, colorIndex: 0.7 })];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0.7]);
  });

  it("spreads slots over the document's transform count, not the slot list's count, when slots are sparse", () => {
    // 4 transforms in the document but only 2 slots (say the other two sit
    // at weight 0, as a real DE's slot list would simply omit them).
    // Correct: denom = transforms.length - 1 = 3, giving [0, 2/3]. A
    // maps-keyed denominator (maps.length - 1 = 1) would give a different
    // answer, so this case actually distinguishes the two rather than
    // agreeing with the buggy reading by accident.
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1 }),
      transform({ id: 2 }),
      transform({ id: 3 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 2 }];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0, 2 / 3]);
  });

  it("gives every sector of a repeated baseIndex the same coordinate as the base map they sweep around", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1, colorIndex: 0.4 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [
      { baseIndex: 1 },
      { baseIndex: 1 },
      { baseIndex: 1 },
    ];
    expect(surfaceTrapIndices(transforms, slots)).toEqual([0.4, 0.4, 0.4]);
  });
});

describe("surfaceForwardSlot", () => {
  it("shares the first positive-weight head selection for forward color and material wires", () => {
    const transforms = [
      transform({ id: 0, weight: 0 }),
      transform({ id: 1, weight: 0 }),
      transform({ id: 2, weight: 0.5 }),
    ];
    expect(surfaceForwardSlot(transforms)).toEqual({ baseIndex: 2 });
  });

  it("falls back to slot zero for all-zero or empty hostile input", () => {
    expect(surfaceForwardSlot([transform({ weight: 0 })])).toEqual({
      baseIndex: 0,
    });
    expect(surfaceForwardSlot([])).toEqual({ baseIndex: 0 });
  });
});

describe("surfaceSlotColors", () => {
  it("colors each slot from its base map's By Transform hue, keyed on the full transform count when slots are sparse", () => {
    // 4 transforms in the document but only 2 slots (baseIndex 0 and 3), so
    // this distinguishes "keyed on transforms.length" from "keyed on
    // maps.length": transformColors(2) wouldn't even have an index 3.
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1 }),
      transform({ id: 2 }),
      transform({ id: 3 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 3 }];
    const palette = transformColors(4);
    expect(surfaceSlotColors(transforms, slots)).toEqual([
      palette[0],
      palette[3],
    ]);
  });

  it("honors an authored colorIndex as the slot's hue, matching transformColors directly", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({ id: 1, colorIndex: 0.9 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [
      { baseIndex: 0 },
      { baseIndex: 1 },
      { baseIndex: 2 },
    ];
    const palette = transformColors(3, [undefined, 0.9, undefined]);
    expect(surfaceSlotColors(transforms, slots)).toEqual([
      palette[0],
      palette[1],
      palette[2],
    ]);
  });
});

describe("surfaceSlotMaterials", () => {
  it("resolves finish and pattern together for each base-map slot, sparse baseIndex included", () => {
    const transforms = [
      transform({
        id: 0,
        finish: { metalness: 1, reflect: 0.5 },
        surfacePattern: {
          kind: "wood",
          axis: "z",
          scale: 4,
          strength: 0.75,
        },
      }),
      transform({ id: 1, weight: 0 }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 2 }];
    expect(surfaceSlotMaterials(transforms, slots, calibration)).toEqual({
      finish: true,
      pattern: true,
      patternCalibration: calibration,
      slots: [
        {
          finish: {
            ...CLASSIC_SURFACE_FINISH,
            metalness: 1,
            reflect: 0.5,
          },
          pattern: {
            kind: "wood",
            axis: "z",
            scale: 4,
            strength: 0.75,
          },
        },
        CLASSIC_SURFACE_MATERIAL,
      ],
    });
  });

  it("returns null for the exact classic+none route, including explicitly classic finish values", () => {
    const transforms = [transform({ id: 0 })];
    expect(surfaceSlotMaterials(transforms, [{ baseIndex: 0 }])).toBeNull();
    expect(
      surfaceSlotMaterials(
        [
          transform({
            id: 0,
            finish: { specular: 0.4, shininess: 32, metalness: 0 },
          }),
        ],
        [{ baseIndex: 0 }],
      ),
    ).toBeNull();
  });

  it("keeps finish and pattern gates independent for pattern-only and finish-only wires", () => {
    const transforms = [
      transform({
        id: 0,
        surfacePattern: { kind: "marble", axis: "y", strength: 0 },
      }),
    ];
    expect(
      surfaceSlotMaterials(transforms, [{ baseIndex: 0 }], calibration),
    ).toMatchObject({ finish: false, pattern: true });
    expect(
      surfaceSlotMaterials(
        [transform({ id: 0, finish: { transmit: 0.7 } })],
        [{ baseIndex: 0 }],
      ),
    ).toMatchObject({ finish: true, pattern: false });
  });

  it("refuses a pattern gate without the built DE's one calibration quartet", () => {
    expect(() =>
      surfaceSlotMaterials(
        [
          transform({
            surfacePattern: { kind: "wood", axis: "y" },
          }),
        ],
        [{ baseIndex: 0 }],
      ),
    ).toThrow(TypeError);
  });

  it("ignores finish and pattern on transforms that contribute no slot", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({
        id: 1,
        weight: 0,
        finish: { metalness: 1 },
        surfacePattern: { kind: "strata", axis: "x" },
      }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 2 }];
    expect(surfaceSlotMaterials(transforms, slots)).toBeNull();
  });
});
