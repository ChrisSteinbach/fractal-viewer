// @vitest-environment jsdom
import { Ui } from "./ui";
import { initialState, setFiniteSolid } from "./state";
import type { AppState } from "./state";
import { defaultTransforms, mengerSponge } from "../fractal/presets";
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

function glassState(
  block: Parameters<typeof setFiniteSolid>[1],
  transforms = defaultTransforms(),
): AppState {
  return setFiniteSolid({ ...initialState(true), transforms }, block);
}

describe("Glass solid section", () => {
  it("offers only the checkbox while no block is present", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));

    expect(el<HTMLInputElement>("glassSolidEnabledCheckbox").checked).toBe(
      false,
    );
    expect(hidden("glassSolidDepthRow")).toBe(true);
    expect(el("glassSolidNote").textContent).toBe("");
  });

  it("shows the depth row and the admission note for a general block", () => {
    const ui = new Ui(document);

    ui.updateLabels(glassState({ level: 1 }));

    expect(el<HTMLInputElement>("glassSolidEnabledCheckbox").checked).toBe(
      true,
    );
    expect(el<HTMLInputElement>("glassSolidEnabledCheckbox").disabled).toBe(
      false,
    );
    expect(hidden("glassSolidDepthRow")).toBe(false);
    expect(el<HTMLSelectElement>("glassSolidDepthSelect").value).toBe("1");
    expect(el("glassSolidNote").textContent).toContain("contract");
  });

  it("discloses the enumeration cap on a dense depth-2 document", () => {
    const ui = new Ui(document);

    // The default 4-map system at depth 2: 16 cells, within the cap.
    ui.updateLabels(glassState({ level: 2 }));
    expect(el("glassSolidDepthNote").textContent).toContain("within the");
    expect(hidden("glassSolidDepthNote")).toBe(false);

    // The 20-map Menger system at depth 2: 400 cells — the cap discloses
    // its refusal shape instead.
    ui.updateLabels(glassState({ level: 2 }, mengerSponge()));
    expect(el("glassSolidDepthNote").textContent).toContain("400");
    expect(el("glassSolidDepthNote").textContent).toContain("refuse");
  });

  it("reads a shaped block as a checked, disabled, disclosed construction", () => {
    const ui = new Ui(document);

    ui.updateLabels(glassState({ shape: "menger", level: 2 }));

    expect(el<HTMLInputElement>("glassSolidEnabledCheckbox").checked).toBe(
      true,
    );
    expect(el<HTMLInputElement>("glassSolidEnabledCheckbox").disabled).toBe(
      true,
    );
    expect(el<HTMLSelectElement>("glassSolidDepthSelect").disabled).toBe(true);
    expect(el<HTMLSelectElement>("glassSolidDepthSelect").value).toBe("2");
    expect(el("glassSolidNote").textContent).toContain("read-only");
  });

  it("shows no depth selection for a refused out-of-band level", () => {
    const ui = new Ui(document);

    ui.updateLabels(glassState({ level: 5 }));

    expect(el<HTMLSelectElement>("glassSolidDepthSelect").value).toBe("");
    expect(hidden("glassSolidDepthRow")).toBe(false);
  });
});
