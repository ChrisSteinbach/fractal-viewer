// @vitest-environment jsdom
import { Ui } from "./ui";
import { initialState, setSphereInversion } from "./state";
import type { AppState } from "./state";
import type { SphereInversionAuthored } from "../fractal/sphere-inversion";
import { PRESET_SPHERE_INVERSIONS } from "../fractal/presets";
import { pentatope } from "../fractal/presets";
import indexHtml from "./index.html?raw";

const parsed = new DOMParser().parseFromString(indexHtml, "text/html");

beforeEach(() => {
  document.body.replaceChildren();
  for (const node of Array.from(parsed.body.children)) {
    if (node.tagName === "SCRIPT") continue;
    document.body.appendChild(document.importNode(node, true));
  }
});

// One macrotask per test drains jsdom's queued <details> toggle tasks
// (docs/test-suite-memory.md); without it every panel tree stays pinned.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

function hidden(id: string): boolean {
  return el(id).classList.contains("hidden");
}

function withBlock(
  block: SphereInversionAuthored,
  patch: Partial<AppState> = {},
): AppState {
  return setSphereInversion({ ...initialState(true), ...patch }, block);
}

describe("Sphere inversion section", () => {
  it("offers only the enable checkbox while no block is present", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));

    expect(el<HTMLInputElement>("sphereInversionEnabledCheckbox").checked).toBe(
      false,
    );
    expect(
      el<HTMLInputElement>("sphereInversionEnabledCheckbox").disabled,
    ).toBe(false);
    expect(hidden("sphereInversionControls")).toBe(true);
    expect(el("sphereInversionNote").textContent).toBe("");
  });

  it("shows the ball's rows for Kissing Pearls in 3D", () => {
    const ui = new Ui(document);
    const block = PRESET_SPHERE_INVERSIONS.inversionPearls!();

    ui.updateLabels(withBlock(block));

    expect(hidden("sphereInversionControls")).toBe(false);
    expect(el<HTMLSelectElement>("sphereInversionArrangement").value).toBe(
      "oct6",
    );
    expect(el<HTMLSelectElement>("sphereInversionSeedKind").value).toBe("ball");
    expect(el("sphereInversionSizeCaption").textContent).toBe("Ball radius");
    expect(el<HTMLInputElement>("sphereInversionSizeSliderNumber").value).toBe(
      "0.280",
    );
    expect(hidden("sphereInversionThicknessRow")).toBe(true);
    expect(hidden("sphereInversionCutRadiusRow")).toBe(true);
    expect(hidden("sphereInversionCutOffsetRow")).toBe(true);
  });

  it("shows the cut shell's rows with the 4D cut-offset span", () => {
    const ui = new Ui(document);
    const block = PRESET_SPHERE_INVERSIONS.inversionVault4!();

    ui.updateLabels(withBlock(block));

    expect(el<HTMLSelectElement>("sphereInversionArrangement").value).toBe(
      "cell600",
    );
    expect(el("sphereInversionSizeCaption").textContent).toBe("Shell radius");
    expect(hidden("sphereInversionThicknessRow")).toBe(false);
    expect(hidden("sphereInversionCutRadiusRow")).toBe(false);
    expect(hidden("sphereInversionCutOffsetRow")).toBe(false);
    const offset = el<HTMLInputElement>("sphereInversionCutOffsetSlider");
    expect(offset.min).toBe("-0.4");
    expect(offset.max).toBe("0.8");
  });

  it("widens a slider to an out-of-range document value and says it was kept", () => {
    const ui = new Ui(document);
    const state = withBlock({ arrangement: "oct6", depth: 20 });

    ui.updateLabels(state);

    const depth = el<HTMLInputElement>("sphereInversionDepthSlider");
    expect(depth.max).toBe("20");
    expect(depth.value).toBe("20");
    expect(el<HTMLInputElement>("sphereInversionDepthSliderNumber").value).toBe(
      "20",
    );
    expect(state.sphereInversion?.depth).toBe(20);
    expect(hidden("sphereInversionDepthNote")).toBe(false);
    expect(el("sphereInversionDepthNote").textContent).toMatch(
      /outside this slider's range 0 to 12; kept as authored/,
    );
    expect(depth.getAttribute("aria-describedby")).toContain(
      "sphereInversionDepthNote",
    );
  });

  it("keeps a refused value and discloses the resolver's reason beside its row", () => {
    const ui = new Ui(document);
    const block = { arrangement: "oct6", depth: 40 };

    ui.updateLabels(withBlock(block));

    expect(el<HTMLInputElement>("sphereInversionDepthSliderNumber").value).toBe(
      "40",
    );
    expect(el("sphereInversionDepthNote").textContent).toMatch(
      /^Refused: depth 40 is not an integer in \[0, 32\]/,
    );
  });

  it("names an unknown arrangement in the select's authored option", () => {
    const ui = new Ui(document);

    ui.updateLabels(withBlock({ arrangement: "dodeca20" }));

    const select = el<HTMLSelectElement>("sphereInversionArrangement");
    expect(select.value).toBe("__authored");
    expect(select.selectedOptions[0]?.textContent).toBe('Authored: "dodeca20"');
    expect(el("sphereInversionArrangementNote").textContent).toMatch(
      /^Refused: unknown arrangement "dodeca20"/,
    );
  });

  it("puts a plane-image refusal below the seed lengths in 4D", () => {
    const ui = new Ui(document);

    ui.updateLabels(
      withBlock({
        arrangement: "cell24",
        seed: { kind: "shell", size: 1.1, thickness: 0.1 },
      }),
    );

    expect(hidden("sphereInversionSeedNote")).toBe(false);
    expect(el("sphereInversionSeedNote").textContent).toMatch(
      /its image is a plane/,
    );
  });

  it("disables every control in Flame and Solid with the reason beside them", () => {
    const ui = new Ui(document);

    for (const renderMode of ["flame", "solid"] as const) {
      ui.updateLabels({ ...initialState(true), renderMode });

      expect(
        el<HTMLInputElement>("sphereInversionEnabledCheckbox").disabled,
      ).toBe(true);
      expect(
        el<HTMLInputElement>("sphereInversionDepthSliderNumber").disabled,
      ).toBe(true);
      expect(el("sphereInversionNote").textContent).toMatch(
        /Switch to Points or Surface/,
      );
    }
    ui.updateLabels(initialState(true));
    expect(
      el<HTMLInputElement>("sphereInversionEnabledCheckbox").disabled,
    ).toBe(false);
  });

  it("discloses each renderer's edit timing", () => {
    const ui = new Ui(document);
    const block = PRESET_SPHERE_INVERSIONS.inversionPearls!();

    ui.updateLabels(withBlock(block));
    expect(el("sphereInversionTimingHint").textContent).toMatch(
      /regenerate Points/,
    );
    ui.updateLabels(withBlock(block, { renderMode: "surface" }));
    expect(el("sphereInversionTimingHint").textContent).toMatch(
      /restart Surface.*on release/,
    );
  });
});

describe("dormant sections under a sphere-inversion block", () => {
  it("discloses the replaced system beside Transforms, Xaos, Symmetry and the schedule in both dimensions", () => {
    const ui = new Ui(document);

    for (const block of [
      PRESET_SPHERE_INVERSIONS.inversionPearls!(),
      PRESET_SPHERE_INVERSIONS.inversionMedallions4!(),
    ]) {
      ui.updateLabels(withBlock(block, { transforms: pentatope() }));

      for (const id of [
        "transformTimingHint",
        "xaosEditHint",
        "symmetryEditHint",
        "scheduleEditHint",
      ]) {
        expect(el(id).textContent, id).toMatch(
          /not drawn while Sphere inversion is the subject/,
        );
      }
    }
  });

  it("restores the ordinary hints once the block is removed", () => {
    const ui = new Ui(document);

    ui.updateLabels(withBlock({ arrangement: "oct6" }));
    ui.updateLabels(initialState(true));

    expect(el("transformTimingHint").textContent).toBe(
      "Geometry follows Auto-update; color changes apply immediately.",
    );
  });

  it("notes a dormant final lens beside its toggle only while one is authored", () => {
    const ui = new Ui(document);
    const base = initialState(true);
    const lens = { ...base.transforms[0], id: 99 };

    ui.updateLabels(withBlock({ arrangement: "oct6" }));
    expect(hidden("finalLensNote")).toBe(true);

    ui.updateLabels(
      withBlock({ arrangement: "oct6" }, { finalTransform: lens }),
    );
    expect(hidden("finalLensNote")).toBe(false);
    expect(el("finalLensNote").textContent).toMatch(
      /^Dormant while Sphere inversion is the subject: the final transform lens/,
    );
    expect(
      el("finalTransformToggle").getAttribute("aria-describedby"),
    ).toContain("finalLensNote");
  });

  it("discloses the flame backdrop's gradient fallback beside Background", () => {
    const ui = new Ui(document);
    const flameBackdrop = {
      ...initialState(true).background,
      mode: "flame" as const,
    };

    ui.updateLabels({ ...initialState(true), background: flameBackdrop });
    expect(hidden("backgroundNote")).toBe(true);

    for (const arrangement of ["oct6", "cell600"]) {
      ui.updateLabels(
        withBlock({ arrangement }, { background: flameBackdrop }),
      );
      expect(hidden("backgroundNote"), arrangement).toBe(false);
      expect(el("backgroundNote").textContent).toMatch(
        /Sphere inversion replaces.*plain gradient/,
      );
    }
    expect(el("background").getAttribute("aria-describedby")).toBe(
      "backgroundNote",
    );
  });
});
