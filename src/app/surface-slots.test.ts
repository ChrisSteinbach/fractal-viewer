import { derivedColorIndex } from "../fractal/chaos-game";
import { transformColors } from "../fractal/color";
import type { Transform } from "../fractal/types";
import { CLASSIC_SURFACE_FINISH } from "../fractal/surface-finish";
import {
  CLASSIC_SURFACE_MATERIAL,
  surfaceMaterialOpticsLanes,
} from "../fractal/surface-material-wire";
import { FINITE_SOLID_HALF_EXTENT } from "../fractal/finite-solid";
import { presetTransforms } from "../fractal/presets";
import { dielectricBeerThroughput } from "../fractal/surface-dielectric";
import {
  sphereInversionShadeSlots,
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
      optics: false,
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

  it("returns the optics-only wire when just the model selector is authored, with both shader gates off", () => {
    const transforms = [
      transform({ id: 0, optics: { model: "dielectric", scale: 2 } }),
      transform({ id: 1 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 1 }];
    const wire = surfaceSlotMaterials(transforms, slots, calibration, 4);
    expect(wire).toEqual({
      finish: false,
      pattern: false,
      optics: true,
      slots: [
        {
          finish: CLASSIC_SURFACE_FINISH,
          pattern: CLASSIC_SURFACE_MATERIAL.pattern,
          optics: {
            ior: 1.45,
            absorption: [0.17, 0.055, 0.025],
            radius: 8,
            distortion: 0,
          },
        },
        {
          finish: CLASSIC_SURFACE_FINISH,
          pattern: CLASSIC_SURFACE_MATERIAL.pattern,
        },
      ],
    });
  });

  it.each(["glassMenger", "glassMenger4"] as const)(
    "%s retains its authored slab and the selected study's Beer normalization",
    (preset) => {
      const transforms = presetTransforms(preset);
      const wire = surfaceSlotMaterials(
        transforms,
        [surfaceForwardSlot(transforms)],
        undefined,
        FINITE_SOLID_HALF_EXTENT,
        true,
      );
      expect(wire?.optics).toBe(true);
      const material = wire!.slots[0];
      expect(surfaceMaterialOpticsLanes(material)).toEqual([
        [1.45, 0.75, 0.17, 0.055],
        [0.025, 0.08, 0, 0],
      ]);
      // Independently recorded Beer control from the selected GPU study:
      // a .5-world-unit interior segment, normalized by H=.75 in BOTH
      // dimensions. An enclosing-sphere normalization gives another tint.
      const expected = [
        0.8928529928432785, 0.9639974142710154, 0.9834714538216175,
      ];
      material.optics!.absorption.forEach((absorption, channel) => {
        expect(
          dielectricBeerThroughput(absorption, 0.5, material.optics!.radius),
        ).toBeCloseTo(expected[channel], 12);
      });
    },
  );

  it("admitOptics:false strips the gate for the unadmitted forward arms — an optics-only session derives the classic null wire, no radius required", () => {
    const transforms = [
      transform({ id: 0, optics: { model: "dielectric", scale: 2 } }),
      transform({ id: 1 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }, { baseIndex: 1 }];
    // No opticsRadius: the unadmitted arm never needs it, and must not
    // throw for its absence. With the optics gate stripped, every slot
    // resolves classic — the whole wire is the classic+none route, so the
    // resolver returns null and the session compiles literally today's
    // programs. That IS the unadmitted forward family's disclosure-free
    // classic render.
    const wire = surfaceSlotMaterials(
      transforms,
      slots,
      calibration,
      undefined,
      false,
    );
    expect(wire).toBeNull();
    // The admitted arm on the same document still derives the optics wire.
    const admitted = surfaceSlotMaterials(transforms, slots, calibration, 4);
    expect(admitted && admitted.optics).toBe(true);
  });

  it("composes optics with finish and pattern gates on one slot and reports all three", () => {
    const transforms = [
      transform({
        id: 0,
        finish: { metalness: 1 },
        surfacePattern: { kind: "wood", axis: "y" },
        optics: { model: "dielectric" },
      }),
    ];
    const wire = surfaceSlotMaterials(
      transforms,
      [{ baseIndex: 0 }],
      calibration,
      2,
    );
    expect(wire).toMatchObject({
      finish: true,
      pattern: true,
      optics: true,
    });
  });

  it("requires the derived optical radius the moment a slotted transform authors an admitted model", () => {
    const transforms = [transform({ id: 0, optics: { model: "dielectric" } })];
    expect(() => surfaceSlotMaterials(transforms, [{ baseIndex: 0 }])).toThrow(
      TypeError,
    );
    // The same session without optics needs no radius at all.
    expect(
      surfaceSlotMaterials([transform({ id: 0 })], [{ baseIndex: 0 }]),
    ).toBeNull();
  });

  it("ignores optics on transforms that contribute no slot, like finish and pattern", () => {
    const transforms = [
      transform({ id: 0 }),
      transform({
        id: 1,
        weight: 0,
        optics: { model: "dielectric" },
      }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 0 }];
    expect(surfaceSlotMaterials(transforms, slots, undefined, 2)).toBeNull();
  });

  it("keeps the optics-only wire off the forward head slot when the head transform authors nothing", () => {
    const transforms = [
      transform({ id: 0, weight: 0 }),
      transform({ id: 1, optics: { model: "dielectric" } }),
      transform({ id: 2 }),
    ];
    const slots: SurfaceSlot[] = [{ baseIndex: 1 }, { baseIndex: 2 }];
    const wire = surfaceSlotMaterials(transforms, slots, undefined, 2);
    expect(wire).toMatchObject({ finish: false, pattern: false, optics: true });
  });
});

describe("sphereInversionShadeSlots", () => {
  it("packs one slot per generation with the Points sample's hue spread", () => {
    const slots = sphereInversionShadeSlots(11);
    expect(slots.colors).toEqual(transformColors(11));
    expect(slots.trapIndices).toHaveLength(11);
    expect(slots.trapIndices[0]).toBe(0);
    expect(slots.trapIndices[10]).toBe(1);
  });

  it("stays on the classic kernels when no finish is authored", () => {
    expect(sphereInversionShadeSlots(11).materials).toBeNull();
  });

  it("replicates one authored finish into every generation slot", () => {
    const slots = sphereInversionShadeSlots(5, {
      arrangement: "oct6",
      materials: [{ finish: { metalness: 1 } }],
    });
    expect(slots.materials?.finish).toBe(true);
    expect(slots.materials?.slots).toHaveLength(5);
    const first = slots.materials!.slots[0];
    for (const slot of slots.materials!.slots) expect(slot).toEqual(first);
    expect(first.finish.metalness).toBe(1);
  });

  it("keys materials on generation, the last entry covering every deeper one", () => {
    const slots = sphereInversionShadeSlots(5, {
      arrangement: "oct6",
      materials: [
        { finish: { metalness: 0.25 } },
        { finish: { metalness: 1 } },
      ],
    });
    expect(slots.materials!.slots.map((m) => m.finish.metalness)).toEqual([
      0.25, 1, 1, 1, 1,
    ]);
  });

  it("drops authored glass unless the routing admits it", () => {
    const authored = {
      arrangement: "oct6",
      materials: [{ optics: { model: "dielectric" as const } }],
    };
    expect(sphereInversionShadeSlots(5, authored, 1.7).materials).toBeNull();
    const admitted = sphereInversionShadeSlots(5, authored, 1.7, true);
    expect(admitted.materials).toMatchObject({ finish: false, optics: true });
    expect(admitted.materials!.slots).toHaveLength(5);
    for (const slot of admitted.materials!.slots) {
      expect(slot.optics?.radius).toBeCloseTo(1.7);
    }
  });
});
