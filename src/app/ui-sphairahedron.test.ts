// @vitest-environment jsdom
import { Ui } from "./ui";
import { initialState, setSphairahedron } from "./state";
import type { AppState } from "./state";
import { defaultSphairahedronBlock } from "./sphairahedron-controls";
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
  block: Parameters<typeof setSphairahedron>[1],
  patch: Partial<AppState> = {},
): AppState {
  return setSphairahedron({ ...initialState(true), ...patch }, block);
}

describe("Sphairahedron section", () => {
  it("offers only the enable checkbox while no block is present", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));

    expect(el<HTMLInputElement>("sphairahedronEnabledCheckbox").checked).toBe(
      false,
    );
    expect(el<HTMLInputElement>("sphairahedronEnabledCheckbox").disabled).toBe(
      false,
    );
    expect(hidden("sphairahedronControls")).toBe(true);
    expect(el("sphairahedronNote").textContent).toBe("");
  });

  it("shows the cube family's moduli rows for the enable gesture's finite block", () => {
    const ui = new Ui(document);
    const state = withBlock(defaultSphairahedronBlock());

    ui.updateLabels(state);

    expect(hidden("sphairahedronControls")).toBe(false);
    expect(el<HTMLSelectElement>("sphairahedronFamily").value).toBe("cube1");
    expect(hidden("sphairahedronZaRow")).toBe(false);
    expect(hidden("sphairahedronZbRow")).toBe(false);
    expect(hidden("sphairahedronZ2Row")).toBe(true);
    expect(hidden("sphairahedronCwRow")).toBe(true);
    // The enable gesture's block is FINITE — the sphere rows show, the
    // picker button with them.
    expect(hidden("sphairahedronInversionRows")).toBe(false);
    expect(el<HTMLButtonElement>("sphairahedronPickButton").disabled).toBe(
      false,
    );
  }, 60_000);

  it("shows the prism's z2 row and hides the cube moduli for a prism block", () => {
    const ui = new Ui(document);

    ui.updateLabels(withBlock({ family: "prism2", z2: 1.5 }));

    expect(el<HTMLSelectElement>("sphairahedronFamily").value).toBe("prism2");
    expect(hidden("sphairahedronZaRow")).toBe(true);
    expect(hidden("sphairahedronZbRow")).toBe(true);
    expect(hidden("sphairahedronZ2Row")).toBe(false);
    // Infinite: no sphere rows.
    expect(hidden("sphairahedronInversionRows")).toBe(true);
  });

  it("disables the section beside the mode reason in Flame and Solid", () => {
    const ui = new Ui(document);
    const state = withBlock({ family: "cube1" });

    ui.updateLabels(withBlock(state.sphairahedron!, { renderMode: "flame" }));

    expect(el<HTMLInputElement>("sphairahedronEnabledCheckbox").disabled).toBe(
      true,
    );
    expect(el("sphairahedronNote").textContent).toMatch(
      /Flame and Solid cannot draw a sphairahedron scene/,
    );
    expect(el<HTMLInputElement>("sphairahedronZaSlider").disabled).toBe(true);
    // The refusal rides the mode buttons through the COMPOSITE: main.ts's
    // syncSubjectModeButtons pushes subjectRenderModeRefusal (refreshUi),
    // and setSubjectModeRefusal is its whole DOM contract — the one writer
    // for the shared buttons (the per-family setters used to fight over
    // them; the si gate's toast phase caught the clobber).
    ui.setSubjectModeRefusal(
      "Flame and Solid are unavailable for a sphairahedron scene. Use Points or Surface.",
    );
    expect(el<HTMLButtonElement>("modeFlameBtn").disabled).toBe(true);
    expect(el<HTMLButtonElement>("modeFlameBtn").title).toMatch(
      /Flame and Solid are unavailable/,
    );
    expect(el<HTMLButtonElement>("modeSolidBtn").disabled).toBe(true);
    expect(el<HTMLButtonElement>("modeSurfaceBtn").disabled).toBe(false);
    // And the composite's null restores the default affordance — which a
    // LATER family's sync must not turn into a clobber of an earlier
    // family's disable (refreshUi writes the composite once, after both
    // families' presence syncs).
    ui.setSubjectModeRefusal(null);
    expect(el<HTMLButtonElement>("modeFlameBtn").disabled).toBe(false);
    expect(el<HTMLButtonElement>("modeSolidBtn").disabled).toBe(false);
  });

  it("keeps the SI family's refusal on the shared buttons through a sphaira presence sync", () => {
    // The regression the composite closed: the sphaira setter's null note
    // used to re-enable the buttons an SI refusal had just disabled. In the
    // fixed wiring the buttons are written ONCE per refresh from the
    // composite, so the SI family's disable survives the sphaira sync —
    // pinned here in the exact sequence refreshUi runs.
    const ui = new Ui(document);
    ui.setSphereInversionScenePresent(true);
    ui.setSubjectModeRefusal(
      "Flame and Solid are unavailable for a sphere-inversion scene. Use Points or Surface.",
    );
    expect(el<HTMLButtonElement>("modeFlameBtn").disabled).toBe(true);
    ui.setSphairahedronScenePresent(false);
    // The recomputed composite still sees the SI block: the disable holds.
    ui.setSubjectModeRefusal(
      "Flame and Solid are unavailable for a sphere-inversion scene. Use Points or Surface.",
    );
    expect(el<HTMLButtonElement>("modeFlameBtn").disabled).toBe(true);
    expect(el<HTMLButtonElement>("modeFlameBtn").title).toMatch(
      /sphere-inversion scene/,
    );
    expect(el<HTMLButtonElement>("modeSolidBtn").disabled).toBe(true);
  });

  it("disables the replaced transform sections beside the dormancy reason", () => {
    const ui = new Ui(document);

    ui.updateLabels(withBlock({ family: "tetra333" }));

    const note = el("transformsDormantNote");
    expect(note.textContent).toMatch(/Turn off Sphairahedron to edit/);
    expect(hidden("transformsDormantNote")).toBe(false);
    // The dormant section's controls are disabled and describe the note.
    const firstControl = el("transformsSection").querySelector(
      "input, select, button",
    );
    expect(firstControl?.hasAttribute("disabled") ?? false).toBe(true);
    expect(firstControl?.getAttribute("aria-describedby") ?? "").toContain(
      "transformsDormantNote",
    );
  });

  it("keeps a refused block and discloses the resolver's reason on the block note", () => {
    const ui = new Ui(document);

    ui.updateLabels(withBlock({ family: "cube1", za: 0.9, zb: 1.2 }));

    // The refused block stays verbatim (never clamped away).
    expect(el<HTMLInputElement>("sphairahedronZaSlider").value).toBe("0.9");
    expect(el("sphairahedronZaNote").textContent).toMatch(/^Refused: ball /);
  });
});
