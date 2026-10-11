// @vitest-environment jsdom
import { Ui, type UiHandlers } from "./ui";
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

/** Handlers whose every member is an unused vi.fn() — the bind() calls
 * here care about one optional member each, and the interface's breadth
 * makes a literal listing noise (ui.test.ts keeps the spelled-out copy). */
function noopHandlers(): UiHandlers {
  return new Proxy({}, { get: () => vi.fn() }) as unknown as UiHandlers;
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

describe("Sphairahedron per-face finish rows", () => {
  it("labels the faces by kind in scan order and hides the rows past the face count", () => {
    const ui = new Ui(document);

    // Infinite cube: balls then walls — Ball 1..3, Wall 1..3, six rows.
    ui.updateLabels(withBlock({ family: "cube1", za: 0.5, zb: 1.0 }));
    for (let face = 0; face < 6; face++) {
      expect(hidden(`sphairahedronFaceFinishRow${face}`)).toBe(false);
    }
    expect(el("sphairahedronFaceFinishLabel0").textContent).toBe("Ball 1");
    expect(el("sphairahedronFaceFinishLabel2").textContent).toBe("Ball 3");
    expect(el("sphairahedronFaceFinishLabel3").textContent).toBe("Wall 1");
    expect(el("sphairahedronFaceFinishLabel5").textContent).toBe("Wall 3");

    // Tetra: four faces, rows 5 and 6 hide.
    ui.updateLabels(withBlock({ family: "tetra333" }));
    for (let face = 0; face < 4; face++) {
      expect(hidden(`sphairahedronFaceFinishRow${face}`)).toBe(false);
    }
    expect(hidden("sphairahedronFaceFinishRow4")).toBe(true);
    expect(hidden("sphairahedronFaceFinishRow5")).toBe(true);
  });

  it("reflects the document: classic absent, a bundle by name, non-bundle values Custom", () => {
    const ui = new Ui(document);
    // The metal bundle's full six values (a bundle names ALL of them; a
    // partial finish is Custom even when one field happens to match).
    const metal = {
      specular: 0.8,
      shininess: 24,
      metalness: 1,
      reflect: 0.45,
      transmit: 0,
      reflectionTint: 1,
    };
    const finishes = [null, metal, { specular: 0.2 }, null, null, null];
    ui.updateLabels(withBlock({ family: "cube1", za: 0.5, zb: 1.0, finishes }));
    const value = (face: number) =>
      (
        document.getElementById(
          `sphairahedronFaceFinish${face}`,
        ) as HTMLSelectElement
      ).value;
    expect(value(0)).toBe("classic");
    expect(value(1)).toBe("metal");
    // A partial finish that is nobody's bundle reads Custom (disabled, but
    // shown — the transform group's pattern).
    expect(value(2)).toBe("custom");
    expect(value(3)).toBe("classic");
  });

  it("names the picked bundle's values and Classic clears, through the one handler", () => {
    const picked: Array<[number, unknown]> = [];
    const ui = new Ui(document);
    ui.bind({
      ...noopHandlers(),
      onSphairahedronFaceFinish: (face, finish) => {
        picked.push([face, finish]);
      },
    });
    ui.updateLabels(withBlock({ family: "cube1", za: 0.5, zb: 1.0 }));
    const select = document.getElementById(
      "sphairahedronFaceFinish1",
    ) as HTMLSelectElement;
    select.value = "matte";
    select.dispatchEvent(new Event("change"));
    expect(picked).toEqual([
      [
        1,
        {
          specular: 0,
          shininess: 32,
          metalness: 0,
          reflect: 0,
          transmit: 0,
          reflectionTint: 1,
        },
      ],
    ]);
    select.value = "classic";
    select.dispatchEvent(new Event("change"));
    expect(picked[1]).toEqual([1, null]);
  });

  it("discloses the finite-flip re-mapping only while a finish is authored", () => {
    const ui = new Ui(document);
    ui.updateLabels(withBlock({ family: "cube1", za: 0.5, zb: 1.0 }));
    expect(hidden("sphairahedronFaceFinishNote")).toBe(true);
    ui.updateLabels(
      withBlock({
        family: "cube1",
        za: 0.5,
        zb: 1.0,
        finishes: [{ metalness: 1 }],
      }),
    );
    expect(hidden("sphairahedronFaceFinishNote")).toBe(false);
    expect(el("sphairahedronFaceFinishNote").textContent).toMatch(
      /Flipping Finite reorders the faces/,
    );
  });

  it("disables the finish selects in Flame and Solid beside the mode reason", () => {
    const ui = new Ui(document);
    const state = withBlock({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      finishes: [{ metalness: 1 }],
    });
    ui.updateLabels(withBlock(state.sphairahedron!, { renderMode: "flame" }));
    for (let face = 0; face < 6; face++) {
      expect(
        (
          document.getElementById(
            `sphairahedronFaceFinish${face}`,
          ) as HTMLSelectElement
        ).disabled,
      ).toBe(true);
    }
    // And back in Points they re-enable.
    ui.updateLabels(state);
    expect(
      (document.getElementById("sphairahedronFaceFinish0") as HTMLSelectElement)
        .disabled,
    ).toBe(false);
  });

  it("routes a refused finishes list onto the group's note with the off/on repair", () => {
    const ui = new Ui(document);
    ui.updateLabels(
      withBlock({
        family: "cube1",
        za: 0.5,
        zb: 1.0,
        // An optics key is REFUSED (typed SurfaceFinish has no such field —
        // the refusal exists for the runtime wire, so the test authors it
        // past the type).
        finishes: [
          { optics: { model: "dielectric" as const } },
        ] as unknown as Exclude<
          Parameters<typeof setSphairahedron>[1],
          null
        >["finishes"],
      }),
    );
    expect(el("sphairahedronFaceFinishNote").textContent).toMatch(
      /^Refused: sphairahedron faces do not render optics/,
    );
    expect(el("sphairahedronFaceFinishNote").textContent).toMatch(
      /turn Sphairahedron off and on/,
    );
  });
});
