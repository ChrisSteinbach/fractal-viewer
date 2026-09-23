import { resolveSphereInversion } from "../fractal/sphere-inversion";
import type { SphereInversionAuthored } from "../fractal/sphere-inversion";
import { PRESET_SPHERE_INVERSIONS } from "../fractal/presets";
import {
  SPHERE_INVERSION_AUTHORED_OPTION,
  defaultSphereInversionBlock,
  sphereInversionArrangementValue,
  sphereInversionControlNotes,
  sphereInversionFieldRange,
  sphereInversionFieldValue,
  sphereInversionMaterialNote,
  sphereInversionMaterialValue,
  sphereInversionSeedKindValue,
  sphereInversionVisibleRows,
  withSphereInversionArrangement,
  withSphereInversionField,
  withSphereInversionMaterial,
  withSphereInversionSeedKind,
} from "./sphere-inversion-controls";

describe("sphere-inversion control ranges", () => {
  it("offers the delegated public spans in 3D", () => {
    const ball: SphereInversionAuthored = { arrangement: "oct6" };
    const cut: SphereInversionAuthored = {
      arrangement: "oct6",
      seed: { kind: "cutShell" },
    };

    expect(sphereInversionFieldRange(ball, "depth")).toMatchObject({
      min: 0,
      max: 12,
    });
    expect(sphereInversionFieldRange(ball, "radiusFraction")).toMatchObject({
      min: 0.6,
      max: 0.99,
    });
    expect(sphereInversionFieldRange(ball, "size")).toMatchObject({
      min: 0.15,
      max: 0.8,
    });
    expect(sphereInversionFieldRange(cut, "size")).toMatchObject({
      min: 0.7,
      max: 1.3,
    });
    expect(sphereInversionFieldRange(cut, "thickness")).toMatchObject({
      min: 0.01,
      max: 0.1,
    });
    expect(sphereInversionFieldRange(cut, "cutRadius")).toMatchObject({
      min: 2,
      max: 50,
    });
    expect(sphereInversionFieldRange(cut, "cutOffset")).toMatchObject({
      min: -0.5,
      max: 0.8,
    });
  });

  it("narrows the cut offset's lower end in 4D", () => {
    const block: SphereInversionAuthored = {
      arrangement: "cell24",
      seed: { kind: "cutShell" },
    };

    expect(sphereInversionFieldRange(block, "cutOffset")).toMatchObject({
      min: -0.4,
      max: 0.8,
    });
  });
});

describe("sphere-inversion field writes", () => {
  it("writes a moved field and leaves every other key absent", () => {
    const block: SphereInversionAuthored = { arrangement: "oct6" };

    const next = withSphereInversionField(block, "depth", 5);

    expect(next).toEqual({ arrangement: "oct6", depth: 5 });
    expect(block).toEqual({ arrangement: "oct6" });
  });

  it("removes a field moved back onto the resolver's default", () => {
    const block: SphereInversionAuthored = {
      arrangement: "oct6",
      depth: 5,
      seed: { size: 0.4 },
    };

    const next = withSphereInversionField(
      withSphereInversionField(block, "depth", 8),
      "size",
      0.28,
    );

    expect(next).toEqual({ arrangement: "oct6" });
  });

  it("reads the default for the seed's own kind when deciding removal", () => {
    const shell: SphereInversionAuthored = {
      arrangement: "oct6",
      seed: { kind: "cutShell", thickness: 0.03 },
    };

    // .03 is the plain shell's default, not the cut shell's (.06).
    expect(withSphereInversionField(shell, "thickness", 0.03)).toEqual(shell);
    expect(withSphereInversionField(shell, "thickness", 0.06)).toEqual({
      arrangement: "oct6",
      seed: { kind: "cutShell" },
    });
  });

  it("shows an out-of-range value unclamped and a non-number as the default", () => {
    const block = {
      arrangement: "oct6",
      depth: 20,
      radiusFraction: "wide",
    } as unknown as SphereInversionAuthored;

    expect(sphereInversionFieldValue(block, "depth")).toBe(20);
    expect(sphereInversionFieldValue(block, "radiusFraction")).toBe(0.99);
  });
});

describe("sphere-inversion seed kind and arrangement", () => {
  it("clears a ball's size when switching to a shell, keeping thickness", () => {
    const block: SphereInversionAuthored = {
      arrangement: "oct6",
      seed: { kind: "ball", size: 0.28, thickness: 0.05 },
    };

    expect(withSphereInversionSeedKind(block, "shell")).toEqual({
      arrangement: "oct6",
      seed: { kind: "shell", thickness: 0.05 },
    });
  });

  it("keeps every length between shell and cut shell", () => {
    const block: SphereInversionAuthored = {
      arrangement: "oct6",
      seed: { kind: "shell", size: 1.1, cutRadius: 4 },
    };

    expect(withSphereInversionSeedKind(block, "cutShell")).toEqual({
      arrangement: "oct6",
      seed: { kind: "cutShell", size: 1.1, cutRadius: 4 },
    });
  });

  it("removes the kind key when choosing the default ball", () => {
    const block: SphereInversionAuthored = {
      arrangement: "oct6",
      seed: { kind: "shell" },
    };

    expect(withSphereInversionSeedKind(block, "ball")).toEqual({
      arrangement: "oct6",
    });
  });

  it("drops a 4D cut direction's w when moving to a 3D arrangement", () => {
    const block: SphereInversionAuthored = {
      arrangement: "cell600",
      seed: { kind: "cutShell", cutDirectionW: 0.5 },
    };

    const next = withSphereInversionArrangement(block, "ico12");

    expect(next).toEqual({
      arrangement: "ico12",
      seed: { kind: "cutShell" },
    });
    expect(resolveSphereInversion(next).ok).toBe(true);
  });

  it("ignores an arrangement id the registry does not have", () => {
    const block: SphereInversionAuthored = { arrangement: "oct6" };

    expect(withSphereInversionArrangement(block, "dodeca20")).toBe(block);
  });

  it("maps unknown ids to the authored select option", () => {
    const block = {
      arrangement: "dodeca20",
      seed: { kind: "torus" },
    } as SphereInversionAuthored;

    expect(sphereInversionArrangementValue(block)).toBe(
      SPHERE_INVERSION_AUTHORED_OPTION,
    );
    expect(sphereInversionSeedKindValue(block)).toBe(
      SPHERE_INVERSION_AUTHORED_OPTION,
    );
  });

  it("shows only the rows the seed kind reads", () => {
    expect(sphereInversionVisibleRows({ arrangement: "oct6" })).toEqual({
      size: true,
      thickness: false,
      cutRadius: false,
      cutOffset: false,
    });
    expect(
      sphereInversionVisibleRows({
        arrangement: "oct6",
        seed: { kind: "cutShell" },
      }),
    ).toEqual({
      size: true,
      thickness: true,
      cutRadius: true,
      cutOffset: true,
    });
  });
});

describe("sphere-inversion enable gesture", () => {
  it("seeds Kissing Pearls in a flat scene and the Medallions in a 4D one", () => {
    expect(defaultSphereInversionBlock(false)).toEqual(
      PRESET_SPHERE_INVERSIONS.inversionPearls?.(),
    );
    expect(defaultSphereInversionBlock(true)).toEqual(
      PRESET_SPHERE_INVERSIONS.inversionMedallions4?.(),
    );
  });

  it("seeds a block the resolver admits inside every public range", () => {
    for (const nonFlat of [false, true]) {
      const block = defaultSphereInversionBlock(nonFlat);

      expect(resolveSphereInversion(block).ok).toBe(true);
      expect(Object.values(sphereInversionControlNotes(block))).toEqual(
        Array(11).fill(""),
      );
    }
  });

  it("returns a fresh object each time", () => {
    expect(defaultSphereInversionBlock(false)).not.toBe(
      defaultSphereInversionBlock(false),
    );
  });
});

describe("sphere-inversion control notes", () => {
  it("attributes a resolver refusal to the row whose field it names", () => {
    const notes = sphereInversionControlNotes({
      arrangement: "oct6",
      depth: 40,
    });

    expect(notes.depth).toMatch(/^Refused: depth 40 .*Move the slider/);
    expect(notes.block).toBe("");
  });

  it("puts a plane-image refusal on the seed as a whole", () => {
    // A 4D shell whose inner sphere passes through the generator centres.
    const notes = sphereInversionControlNotes({
      arrangement: "cell600",
      seed: { kind: "shell", size: 1.1, thickness: 0.1 },
    });

    expect(notes.seed).toMatch(/^Refused: .*its image is a plane/);
    expect(notes.size).toBe("");
    expect(notes.thickness).toBe("");
  });

  it("discloses an admitted value outside the slider span as kept", () => {
    const notes = sphereInversionControlNotes({
      arrangement: "oct6",
      depth: 20,
      radiusFraction: 1,
    });

    expect(notes.depth).toBe(
      "20 is outside this slider's range 0 to 12; kept as authored.",
    );
    expect(notes.radiusFraction).toMatch(/^1 is outside .* kept as authored/);
  });

  it("sends an unknown field to the block note", () => {
    const notes = sphereInversionControlNotes({
      arrangement: "oct6",
      spin: 2,
    } as SphereInversionAuthored);

    expect(notes.block).toMatch(/^Refused: unknown field "spin"/);
  });

  it("refuses an unknown arrangement beside its select", () => {
    const notes = sphereInversionControlNotes({ arrangement: "dodeca20" });

    expect(notes.arrangement).toMatch(
      /^Refused: unknown arrangement "dodeca20".*Choose an arrangement/,
    );
  });
});

describe("the Material row", () => {
  const pearls = { arrangement: "oct6", seed: { size: 0.28 }, depth: 8 };

  it("reads Classic when absent, Glass for the one block Glass writes, and Authored otherwise", () => {
    expect(sphereInversionMaterialValue(pearls)).toBe("classic");
    expect(
      sphereInversionMaterialValue(
        withSphereInversionMaterial(pearls, "glass"),
      ),
    ).toBe("glass");
    expect(
      sphereInversionMaterialValue({
        ...pearls,
        materials: [{ finish: { metalness: 1 } }],
      }),
    ).toBe(SPHERE_INVERSION_AUTHORED_OPTION);
  });

  it("Classic removes the field, so the block is byte-identical to one that never carried it", () => {
    const glass = withSphereInversionMaterial(pearls, "glass");
    expect(glass).not.toBe(pearls);
    expect(JSON.stringify(withSphereInversionMaterial(glass, "classic"))).toBe(
      JSON.stringify(pearls),
    );
    expect(withSphereInversionMaterial(pearls, "classic")).toBe(pearls);
    expect(withSphereInversionMaterial(pearls, "chrome")).toBe(pearls);
  });

  it("discloses what glass does where it resolves and why it renders opaque where it does not", () => {
    expect(sphereInversionMaterialNote(pearls)).toBe("");
    expect(
      sphereInversionMaterialNote(withSphereInversionMaterial(pearls, "glass")),
    ).toBe(
      "Surface refracts light through the set, on WebGPU compute only. Points draws it opaque.",
    );
    const vault = withSphereInversionMaterial(
      { arrangement: "oct6", seed: { kind: "cutShell" } },
      "glass",
    );
    expect(sphereInversionControlNotes(vault).material).toBe(
      "Surface renders it opaque: glass is available for ball and shell seeds.",
    );
  });

  it("routes a refused materials field to the Material row with its repair", () => {
    const notes = sphereInversionControlNotes({
      ...pearls,
      materials: [{ optics: { model: "metal" } }],
    } as unknown as SphereInversionAuthored);
    expect(notes.material).toBe(
      'Refused: material 0 optics model "metal" is not one of: dielectric. Choose a material to replace it.',
    );
    expect(notes.block).toBe("");
  });
});
