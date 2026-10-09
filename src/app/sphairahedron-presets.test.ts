/**
 * The sphairahedron preset batch's paste-honesty pins (`presets.ts`'s
 * PRESET_SPHAIRAHEDRONS). Each preset's inversion sphere was authored ONCE
 * by running the DE-sampling picker (`sphairahedron-authoring.ts`) and
 * pasting the numbers — a preset factory must be pure and instant, never
 * an 8000-sample census — so the paste is kept honest by asserting the
 * authored J EQUALS what the picker returns for the same block, and that
 * the block still resolves (the moduli inside the family's valid region).
 *
 * The 4D twin's equality is the same pin, reading the picker's own
 * passthrough: its census makes no 3D pocket reading (the vocabulary's
 * rule — the tetra lift's finite limit set is an analytic 3-sphere), so
 * the picker deterministically returns its first ladder candidate, and the
 * preset pins THAT.
 */
import {
  PRESET_SPHAIRAHEDRONS,
  PRESET_RENDER_HINTS,
  PRESET_VIEWS,
  PRESET_NAMES,
} from "../fractal/presets";
import { resolveSphairahedron } from "../fractal/sphairahedron";
import { authoredPickerInversion } from "./sphairahedron-authoring";

const SPHAIRA_PRESETS = PRESET_NAMES.filter(
  (preset) => PRESET_SPHAIRAHEDRONS[preset] !== undefined,
);

describe("the sphairahedron preset batch", () => {
  it("ships every family the panel offers, both dimensions", () => {
    const families = SPHAIRA_PRESETS.map(
      (preset) => PRESET_SPHAIRAHEDRONS[preset]!().family,
    );
    expect(new Set(families).size).toBe(families.length);
    expect(families).toContain("cube1");
    expect(families).toContain("cube4");
    expect(families).toContain("cube9");
    expect(families).toContain("tetra333");
    expect(families).toContain("prism2");
    expect(families).toContain("tetra4");
  });

  it("hints Surface for every one, and lands a saved view", () => {
    for (const preset of SPHAIRA_PRESETS) {
      expect(PRESET_RENDER_HINTS[preset], preset).toBe("surface");
      expect(PRESET_VIEWS[preset], preset).toBeDefined();
    }
    // The 4D twin is the batch's only 4D entry and carries the rotor pose.
    expect(PRESET_VIEWS.sphairaOrb4?.fourD).toBeDefined();
  });

  for (const preset of SPHAIRA_PRESETS) {
    it(`${preset}: resolves, and its J is the picker's`, () => {
      const block = PRESET_SPHAIRAHEDRONS[preset]!();
      const resolution = resolveSphairahedron(block);
      expect(
        resolution.ok,
        `${preset} refused: ${resolution.ok ? "" : resolution.reasons.join("; ")}`,
      ).toBe(true);
      // The paste's provenance is the picker run on the block's INFINITE
      // form (family + moduli) — the same call the finite checkbox's
      // authoring makes. Running it on the finite block would seed the
      // candidate ladder from the finite construction's own ball images
      // and re-pick from there, which is the app's re-pick gesture, not
      // the authoring.
      const { inversion: _stripped, ...infinite } = block;
      void _stripped;
      const picked = authoredPickerInversion(infinite);
      expect(picked, preset).toBeDefined();
      expect(block.inversion, preset).toEqual(picked);
    });
  }
});
