// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import {
  initialState,
  setSchedule,
  setShapeTrap,
  setSphereInversion,
} from "./state";
import type { AppState } from "./state";
import {
  defaultTransforms,
  fernSpongeIsolated,
  foldChain,
  gearworks,
  hybridChainCube,
  mandelboxKifs,
  swirlPentatopeLens,
} from "../fractal/presets";
import { GEAR_SHAPE } from "../fractal/shapes";
import { resolveTiling } from "../fractal/tiling";
import type { Transform } from "../fractal/types";
import { deriveSurfaceEligibility } from "./surface-eligibility";
import indexHtml from "./index.html?raw";

/**
 * The panel copy budget (docs/panel-ia.md's Contract section): visible
 * operational copy is one short sentence, and a help disclosure's whole body
 * stays under its own cap. The sweep measures LENGTH, not vocabulary — the
 * owner's complaint is prose filling the control space, and a banned-words
 * list would punish the wrong edits.
 *
 * The budget covers text the panel can actually show: `.hidden` elements and
 * their subtrees are skipped, and every closed section is opened first so a
 * hint is judged whether or not its section happens to ship open. Generated
 * rows (transform editor, shape part editor, finish/pattern notes) are walked
 * through representative document states, flat and 4D, because that is where
 * the last cleanup's regressions landed.
 *
 * An exception belongs in HINT_ALLOWLIST with a reason, so raising the budget
 * for one string shows up in review as a deliberate act rather than a silent
 * loosening of the rule.
 *
 * The class picks the budget: a `.flame-hint` timing line is one short
 * operational sentence, while a `.flame-note` warning or `.flame-note-info`
 * refusal may run a few words longer because it also names the condition and
 * the action that resolves it.
 */
const HINT_WORD_BUDGET = 16;
const NOTE_WORD_BUDGET = 24;
const DISCLOSURE_WORD_BUDGET = 60;

const HINT_ALLOWLIST: Record<string, { budget: number; reason: string }> = {
  pointsLayoutNote: {
    budget: 32,
    reason:
      "One multi-fact view contract: axis-lock, per-pane transform editing, " +
      "Current-only camera/effects, and saved-image scope. Trimming drops a " +
      "disclosure, and splitting duplicates labels.",
  },
};

const parsed = new DOMParser().parseFromString(indexHtml, "text/html");

beforeEach(() => {
  resetPanelDom();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function resetPanelDom(): void {
  document.body.replaceChildren();
  for (const node of Array.from(parsed.body.children)) {
    if (node.tagName === "SCRIPT") continue;
    document.body.appendChild(document.importNode(node, true));
  }
}

function noopHandlers(): UiHandlers {
  return new Proxy({} as UiHandlers, { get: () => vi.fn() });
}

function wordCount(text: string): number {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  // Punctuation standing alone (an em dash in the panel's prose) is not a
  // word; counting it would penalize punctuation, not verbosity.
  return words.filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** The first transform carries a `w` block, which is what makes a system
 * non-flat (`affine4.ts`'s isFlatTransform) and routes the panel to its 4D
 * rows. */
function nonFlat(transforms: Transform[] = defaultTransforms()): Transform[] {
  const [first, ...rest] = transforms;
  return [{ ...first, w: { position: 0.5 } }, ...rest];
}

function stateWith(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState(true), selectedTransform: 0, ...overrides };
}

interface WalkCase {
  label: string;
  state: AppState;
  setup?: (ui: Ui) => void;
}

function walkCases(): WalkCase[] {
  const modes = ["points", "flame", "solid", "surface"] as const;
  const base: WalkCase[] = modes.flatMap((renderMode) => [
    {
      label: `${renderMode} flat`,
      state: stateWith({ renderMode }),
      setup:
        renderMode === "surface"
          ? (ui: Ui) => ui.setSurfaceSessionKind("ifs")
          : undefined,
    },
    {
      label: `${renderMode} 4D`,
      state: stateWith({ renderMode, transforms: nonFlat() }),
      setup:
        renderMode === "surface"
          ? (ui: Ui) => ui.setSurfaceSessionKind("ifs")
          : undefined,
    },
  ]);
  const rich: WalkCase[] = [
    {
      label: "folds (points)",
      state: stateWith({ transforms: mandelboxKifs() }),
    },
    {
      label: "folds (surface)",
      state: stateWith({ renderMode: "surface", transforms: mandelboxKifs() }),
      setup: (ui) => ui.setSurfaceSessionKind("ifs"),
    },
    {
      label: "swirl final lens",
      state: stateWith({
        selectedTransform: "final",
        transforms: foldChain(),
        finalTransform: swirlPentatopeLens(),
      }),
    },
    { label: "emitter shapes", state: stateWith({ transforms: gearworks() }) },
    {
      label: "xaos blocks",
      state: stateWith({ transforms: fernSpongeIsolated() }),
    },
    {
      label: "hybrid schedule",
      state: setSchedule(stateWith({ transforms: hybridChainCube() }), {
        transforms: hybridChainCube(),
        depth: 1,
      }),
    },
    { label: "finite tiling", state: stateWith({ tiling: { group: "b3" } }) },
    {
      label: "lattice tiling",
      state: stateWith({ tiling: { kind: "lattice", cellScale: 1.6 } }),
    },
    {
      label: "sphere inversion",
      state: setSphereInversion(stateWith(), {
        arrangement: "oct6",
        radiusFraction: 0.99,
        seed: { kind: "ball", size: 0.28 },
        depth: 8,
      }),
    },
    {
      label: "shape trap (surface escape)",
      state: setShapeTrap(stateWith({ renderMode: "surface" }), {
        shape: GEAR_SHAPE,
      }),
      setup: (ui) => ui.setSurfaceSessionKind("escape"),
    },
    {
      label: "surface escape non-head finish",
      state: stateWith({
        renderMode: "surface",
        selectedTransform: 1,
        transforms: hybridChainCube(),
      }),
      setup: (ui) => ui.setSurfaceSessionKind("escape"),
    },
    { label: "balloon on", state: stateWith({ balloonEcho: true }) },
    {
      label: "4D balloon fog",
      state: stateWith({ transforms: nonFlat(), balloonEcho: true }),
    },
    {
      label: "sphere inversion with kaleidoscope",
      state: setSphereInversion(
        stateWith({ symmetry: { order: 4, plane: "xy" } }),
        {
          arrangement: "oct6",
          radiusFraction: 0.99,
          seed: { kind: "ball", size: 0.28 },
          depth: 8,
        },
      ),
    },
    {
      label: "solid tiling worker-baked",
      state: stateWith({
        renderMode: "solid",
        transforms: nonFlat(),
        tiling: { group: "a4" },
      }),
      setup: (ui) =>
        ui.setSolidTilingStatus({
          status: "active",
          application: "worker-baked",
          resolved: resolveTiling({ group: "a4" })!,
          originVisibleRadius: 1,
          note: null,
        }),
    },
  ];
  return [...base, ...rich];
}

function isHiddenInPanel(el: Element, panel: Element): boolean {
  let node: Element | null = el;
  while (node && node !== panel.parentElement) {
    if (node instanceof HTMLElement) {
      if (node.classList.contains("hidden")) return true;
      if (node.hidden) return true;
      if (node.style.display === "none") return true;
    }
    node = node.parentElement;
  }
  return false;
}

function openEveryDisclosure(panel: Element): void {
  for (const details of panel.querySelectorAll("details")) {
    details.open = true;
  }
}

/** Mint the transform editor for the selected map (or the final lens):
 * `updateLabels` alone does not — main.ts calls this once per selection, and
 * the Color/Finish/Pattern hints and the 4D Scale note only exist inside it. */
function renderEditor(ui: Ui, state: AppState): void {
  const selected = state.selectedTransform;
  if (typeof selected === "number") {
    ui.renderTransformEditor(
      state.transforms[selected] ?? null,
      selected,
      state.transforms.length,
    );
  } else if (selected === "final" && state.finalTransform) {
    ui.renderTransformEditor(
      state.finalTransform,
      "final",
      state.transforms.length,
    );
  }
}

function renderPanel(entry: WalkCase): void {
  const ui = new Ui(document);
  ui.bind(noopHandlers());
  entry.setup?.(ui);
  ui.updateLabels(entry.state);
  // main.ts's refresh order, minus the parts that need a live renderer: the
  // Surface gate verdict, the transform list, then the selected editor.
  const eligibility = deriveSurfaceEligibility(
    entry.state.transforms,
    entry.state.finalTransform ?? null,
    entry.state.symmetry,
    { computeAvailable: true },
    entry.state.schedule ?? null,
    entry.state.shapeTrap ?? null,
    entry.state.tiling ?? null,
    entry.state.condensationDepthBand,
    entry.state.sphereInversion ?? null,
  );
  ui.setSurfaceEligibility(
    eligibility.status,
    eligibility.note,
    eligibility.kind,
  );
  ui.renderTransformList(
    entry.state.transforms,
    entry.state.selectedTransform ?? null,
    entry.state.finalTransform ?? null,
  );
  renderEditor(ui, entry.state);
}

function hintViolations(
  panel: Element,
  allowlist: Record<string, { budget: number; reason: string }>,
): string[] {
  const violations: string[] = [];
  const hints = panel.querySelectorAll<HTMLElement>(
    ".flame-hint, .flame-note, .flame-note-info",
  );
  for (const el of hints) {
    if (isHiddenInPanel(el, panel)) continue;
    if (el.closest(".panel-explainer")) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const id = el.id || `(no id) "${text.slice(0, 40)}"`;
    const classBudget = el.classList.contains("flame-hint")
      ? HINT_WORD_BUDGET
      : NOTE_WORD_BUDGET;
    const budget = allowlist[id]?.budget ?? classBudget;
    const words = wordCount(text);
    if (words > budget) {
      violations.push(`${id}: ${words} words — "${text}" (budget ${budget})`);
    }
  }
  return violations;
}

function disclosureViolations(panel: Element): string[] {
  const violations: string[] = [];
  for (const details of panel.querySelectorAll("details.panel-explainer")) {
    const summary =
      details.querySelector("summary")?.textContent?.trim() ?? "?";
    const body = Array.from(details.querySelectorAll("p"))
      .map((p) => p.textContent ?? "")
      .join(" ");
    const text = body.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const words = wordCount(text);
    if (words > DISCLOSURE_WORD_BUDGET) {
      violations.push(
        `"${summary}": ${words} words — "${text}" ` +
          `(budget ${DISCLOSURE_WORD_BUDGET})`,
      );
    }
  }
  return violations;
}

describe("panel copy budget", () => {
  it.each(walkCases().map((entry) => [entry.label, entry] as const))(
    "%s: visible hints fit the word budget",
    (_label, entry) => {
      renderPanel(entry);

      const panel = document.getElementById("panel")!;
      openEveryDisclosure(panel);
      const violations = hintViolations(panel, HINT_ALLOWLIST);

      expect(
        violations,
        `Hints over budget in "${entry.label}":\n${violations.join("\n")}`,
      ).toHaveLength(0);
    },
  );

  it.each(walkCases().map((entry) => [entry.label, entry] as const))(
    "%s: help disclosures fit the word budget",
    (_label, entry) => {
      renderPanel(entry);

      const panel = document.getElementById("panel")!;
      const violations = disclosureViolations(panel);

      expect(
        violations,
        `Disclosures over budget in "${entry.label}":\n${violations.join("\n")}`,
      ).toHaveLength(0);
    },
  );

  // The one test that walks every case; ~7s under the full suite, so it
  // carries its own budget rather than the 5s default.
  it(
    "reaches the generated rows, so the walk is not vacuous",
    { timeout: 30_000 },
    () => {
      const seen = new Set<string>();
      let hintTotal = 0;
      let disclosureTotal = 0;
      for (const entry of walkCases()) {
        resetPanelDom();
        renderPanel(entry);
        const panel = document.getElementById("panel")!;
        openEveryDisclosure(panel);
        for (const el of panel.querySelectorAll<HTMLElement>(
          ".flame-hint, .flame-note, .flame-note-info",
        )) {
          if (isHiddenInPanel(el, panel)) continue;
          if (el.id) seen.add(el.id);
          hintTotal += 1;
        }
        disclosureTotal += panel.querySelectorAll(
          "details.panel-explainer",
        ).length;
      }

      // The static markup alone has 47 hints and 12 disclosures; a walk that
      // found fewer never rendered the panel it claims to judge.
      expect(hintTotal).toBeGreaterThan(47);
      expect(disclosureTotal).toBeGreaterThan(12);
      // Generated rows, not just index.html's static copy.
      expect(seen).toContain("transformColorTimingHint");
      expect(seen).toContain("transformFinishTimingHint");
      expect(seen).toContain("transformPatternTimingHint");
      expect(seen).toContain("transformScaleWNote");
      expect(seen).toContain("finalSwirlRadiusNote");
    },
  );
});
