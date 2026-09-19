import { PRESET_NAMES } from "../fractal/presets";
import { resolveBackground } from "./background";
import { SceneHistory } from "./history";
import { decodeScene, encodeScene, toSnapshot } from "./persist";
import { applyPresetBackground } from "./preset-background";
import { initialState } from "./state";
import { createSurfaceTransmissionStarter } from "./surface-transmission-starters";

describe("preset backgrounds", () => {
  it.each(["glassMenger", "glassMenger4"] as const)(
    "%s replaces an inherited Flame/radial backdrop with the glass studio",
    (preset) => {
      const state = initialState(true);
      state.background = {
        mode: "flame",
        shape: "radial",
        flamePaletteId: "sunset",
      };

      const loaded = applyPresetBackground(state, preset);

      expect(loaded.background).toEqual({
        ...createSurfaceTransmissionStarter("glass-garden").background,
        flamePaletteId: "sunset",
      });
      expect(loaded.background.mode).toBe("custom");
      expect(loaded.background.shape).toBe("linear");
      const stops = resolveBackground(loaded.background);
      expect(Math.min(...stops.top)).toBeGreaterThan(0.8);
      expect(Math.min(...stops.bottom)).toBeGreaterThan(0.55);
      expect(state.background.mode).toBe("flame");
      expect(state.background.shape).toBe("radial");
    },
  );

  it("preserves the user's backdrop on every unrelated preset load", () => {
    const state = initialState(true);
    state.background = {
      mode: "custom",
      shape: "radial",
      custom: { top: [0.2, 0.4, 0.6], bottom: [1, 0, 0] },
    };
    for (const preset of PRESET_NAMES) {
      if (preset === "glassMenger" || preset === "glassMenger4") continue;
      expect(applyPresetBackground(state, preset)).toBe(state);
    }
  });

  it.each(["glassMenger", "glassMenger4"] as const)(
    "%s keeps identical gradient colors across a share-link reload",
    (preset) => {
      const loaded = applyPresetBackground(initialState(true), preset);
      const encoded = encodeScene(toSnapshot(loaded));
      const restored = decodeScene(encoded)!;

      expect(resolveBackground(restored.background)).toEqual(
        resolveBackground(loaded.background),
      );
      expect(restored.background.shape ?? "linear").toBe("linear");
      expect(encodeScene(restored)).toBe(encoded);
    },
  );

  it("restores the prior background on undo and the studio on redo", () => {
    const state = initialState(true);
    state.background = {
      mode: "custom",
      shape: "radial",
      custom: { top: [0.2, 0.4, 0.6], bottom: [1, 0, 0] },
    };
    const history = new SceneHistory();
    const before = encodeScene(toSnapshot(state));
    history.checkpoint(before, true);
    const loaded = applyPresetBackground(state, "glassMenger4");
    const after = encodeScene(toSnapshot(loaded));

    const undo = history.undo(after)!;
    expect(decodeScene(undo.snapshot)!.background).toEqual(state.background);
    const redo = history.redo(undo.snapshot)!;
    expect(resolveBackground(decodeScene(redo.snapshot)!.background)).toEqual(
      resolveBackground(loaded.background),
    );
  });

  it("a custom-color edit cannot alter another glass preset load", () => {
    const edited = applyPresetBackground(initialState(true), "glassMenger");
    edited.background.custom!.top = [0, 0, 0];

    const reloaded = applyPresetBackground(edited, "glassMenger4");
    expect(reloaded.background.custom!.top[0]).toBe(205 / 255);
    expect(edited.background.custom!.top[0]).toBe(0);
  });
});
