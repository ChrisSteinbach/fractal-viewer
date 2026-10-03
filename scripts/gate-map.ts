/**
 * `npm run gate:affected`'s module-to-gate side table (the seventh
 * gate-velocity child): WHICH gates and harness sheets a changed file
 * EXERCISES, beyond what the import graph can see.
 *
 * WHY A HAND TABLE AT ALL: the verify gates drive the BUILT APP end-to-end —
 * a browser gate imports none of `src/`, so its import closure sees only its
 * own script-side helpers, while its verdict lives or dies on modules the
 * app loads at runtime. The import closure (computed per entry by the tool
 * over both trees) carries the scripts-side half automatically; this table
 * carries the app-side half, one entry per gate/sheet.
 *
 * THE UPDATE RULE — the preset side tables' discipline: **adding a gate or
 * sheet means adding its entry in the SAME change.** An unlisted script is
 * not silently skipped — the tool reports every unlisted gate/sheet it finds
 * on disk as an `unmapped` warning and, because unmapped could mean
 * anything, treats every changed `src/` module as affecting it
 * (conservative by construction; see `affectedForChanged`). Editing what a
 * gate exercises — wiring it to a new subsystem, moving its scenario —
 * updates the entry's `modules` in the same commit. The cost class moves
 * with the gate: a gate wired to the frame cache or given a fast tier
 * graduates to `cache-eligible` in the wiring commit.
 *
 * THE COVERAGE SEMANTICS, stated so an entry can be judged: `modules` maps
 * what the gate's VERDICT exercises — the subsystems whose change can flip
 * the gate's answer (its drives, its asserts, the renderers its scenarios
 * run) — NOT everything the app happens to load. It errs INCLUSIVE within
 * that: when a gate's verdict could plausibly move, the module belongs here.
 * Boot-spine modules (`APP_SPINE_MODULES` — the app's entry, scene, state,
 * persistence, the SW bootstrap) sit OUTSIDE the per-entry lists: they are
 * every browser gate's substrate, and one change there marks every gate,
 * which a per-entry `src/app/` prefix would otherwise state sixty-five
 * times. What the roster does NOT claim: because the frame cache keys on
 * bundle bytes, every `src/` edit re-renders every gate's frames — that is
 * the cache's invalidation cadence, not this roster's question. The roster
 * answers "whose VERDICT can my tree flip", the cache answers "what will
 * re-render", and the two are different questions on purpose.
 *
 * Pure and DOM-free (`legend-spec.ts`'s pattern), so matching is tested
 * without spawning anything; the closures are the tool's job.
 */

export interface GateMapEntry {
  /** The script's roster name: `scripts/<name>.verify.mjs` for gates,
   * `scripts/<name>.harness.ts` for sheets. */
  name: string;
  kind: "gate" | "sheet";
  /** The cost class the runner conventions consume: `cache-eligible` —
   * wired to the frame cache and/or a `--tier=fast` mode, the class a
   * background pre-warm could legally take (CPU/SwiftShader-class work
   * only); `full-render` — renders fully, never cached today; `lifecycle` —
   * measures the SESSION (timings, teardown, trusted interaction, a live
   * deployment): never cached, never backgrounded, the machine-quiet rule's
   * own class. */
  cost: "cache-eligible" | "full-render" | "lifecycle";
  /** Repo paths (exact) or prefixes ending in `/` or `*` whose change can
   * flip this entry's verdict. The entry's own import closure rides beside
   * this — list only what the closure cannot see. */
  modules: string[];
}

/** Every browser gate's substrate: the app boots through these, so a change
 * to one marks every gate. Sheets (CPU harnesses) are immune — they import
 * what they run, and their closures say so. */
export const APP_SPINE_MODULES: readonly string[] = [
  "src/app/main.ts",
  "src/app/scene.ts",
  "src/app/state.ts",
  "src/app/persist.ts",
  "src/app/register-sw.ts",
  "src/app/render-backend.ts",
  "src/app/constants.ts",
  "src/app/render-session.ts",
  "src/app/interactions.ts",
  "src/app/sw/sw.ts",
  "src/app/index.html",
  "src/app/style.css",
];

/** The map's own machinery and the runner's: a change here can move every
 * answer at once, so it marks everything (the CI selector's
 * SELECTION_MACHINERY precedent — a commit that edits what may be skipped
 * should not also be the commit that skips). */
export const GATE_MAP_MACHINERY: readonly string[] = [
  "scripts/gate-map.ts",
  "scripts/gate-affected.mjs",
  "scripts/verify.mjs",
  "scripts/lib/verify-plan.mjs",
  "scripts/lib/gate-registry.mjs",
];

/** The table. Grouped by family; the per-entry comment carries the one-line
 * WHY for any non-obvious module list. */
export const GATE_MAP: GateMapEntry[] = [
  // ---- The frame cache's wired gates (the third child) --------------------
  {
    name: "surface-repro",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/surface-grid.ts",
      "src/app/resolution-governor.ts",
    ],
  },
  {
    name: "finish",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/fractal/surface-finish.ts",
      "src/fractal/surface-pattern.ts",
      "src/app/surface-slots.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "sphere-inversion-family",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/sphere-inversion.ts",
      "src/fractal/sphere-inversion-de.ts",
      "src/fractal/sphere-inversion-de-4d.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/sphere-inversion-controls.ts",
      "src/app/ui.ts",
    ],
  },
  {
    name: "surface-4d-lift",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de-4d.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/four-d-view.ts",
    ],
  },
  {
    name: "surface-slab-4d",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de-4d.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/four-d-view.ts",
    ],
  },
  // ---- The fast tier's other gates ----------------------------------------
  {
    name: "surface-4d",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de-4d.ts",
      "src/fractal/surface-material-4d.ts",
      "src/app/surface-compute.ts",
      "src/app/four-d-view.ts",
    ],
  },
  // ---- Surface descent family (3D) ----------------------------------------
  {
    name: "surface-fold",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-swirl",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/swirl-lens.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-swirl-stride-control",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/swirl-lens.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "final-swirl-radius",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/swirl-lens.ts",
      "src/app/ui.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-chaos",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/chaos-game.ts",
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-schedule",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/chaos-game.ts",
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-emitter-only",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/chaos-game.ts",
      "src/fractal/shapes.ts",
      "src/fractal/surface-de.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-balloon-tint",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/balloon-de.ts",
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-dof",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/ui.ts",
    ],
  },
  {
    name: "surface-export-tile",
    kind: "gate",
    cost: "cache-eligible",
    modules: [
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/capture-cost.ts",
      "src/app/export-progress.ts",
    ],
  },
  {
    name: "surface-preview-completion",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/app/render-tier.ts",
      "src/app/strip-planner.ts",
      "src/app/surface-compute.ts",
      "src/app/viewer-prefs.ts",
    ],
  },
  {
    name: "surface-tier",
    kind: "gate",
    cost: "lifecycle",
    modules: [
      "src/app/render-tier.ts",
      "src/app/strip-planner.ts",
      "src/app/viewer-prefs.ts",
    ],
  },
  {
    name: "surface-fallback",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/app/surface-material.ts",
      "src/app/surface-compute.ts",
      "src/app/ui.ts",
    ],
  },
  {
    name: "surface-post",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/app/surface-material.ts",
      "src/fractal/surface-de-gpu.ts",
    ],
  },
  {
    name: "surface-optics-glsl",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-dielectric.ts",
      "src/fractal/surface-optics.ts",
      "src/app/surface-material.ts",
      "src/fractal/surface-de-gpu.ts",
    ],
  },
  {
    name: "surface-light-guides",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-lighting.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-lighting-ui",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-lighting.ts",
      "src/app/ui.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "cinematic-lighting",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-lighting.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-transport-invalidation",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de-gpu.ts",
      "src/fractal/finite-transport-work.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-transport-resolve",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de-gpu.ts",
      "src/fractal/surface-optics.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "swirl-glsl",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de.ts",
      "src/fractal/swirl-lens.ts",
      "src/app/surface-material.ts",
    ],
  },
  {
    name: "ground-plane",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-material.ts",
      "src/app/surface-compute.ts",
      "src/app/ui.ts",
    ],
  },
  {
    name: "surface-lattice",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/fractal/tiling-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "surface-tiled-slab",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-de-4d.ts",
      "src/fractal/tiling.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  // ---- Escape-time / bulb family ------------------------------------------
  {
    name: "escape-family",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/escape-de.ts",
      "src/fractal/escape-de-4d.ts",
      "src/fractal/bulb-de.ts",
      "src/fractal/qjulia-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
      "src/app/ui.ts",
    ],
  },
  // ---- Tiling family -------------------------------------------------------
  {
    name: "tiling-symmetry",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/fractal/tiling-de.ts",
      "src/fractal/chaos-game.ts",
    ],
  },
  {
    name: "tiling-ui",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/app/ui.ts",
      "src/app/control-spec.ts",
    ],
  },
  {
    name: "tiling-balloon",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/fractal/balloon-de.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "lattice-presentation",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/fractal/lattice-march.ts",
      "src/app/surface-compute.ts",
    ],
  },
  // ---- Sphere-inversion extras ---------------------------------------------
  {
    name: "sphere-inversion-glass",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/sphere-inversion.ts",
      "src/fractal/surface-optics.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "sphere-inversion-presets",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/sphere-inversion.ts",
      "src/fractal/sphere-inversion-de.ts",
      "src/fractal/sphere-inversion-de-4d.ts",
      "src/fractal/presets.ts",
      "src/app/ui.ts",
    ],
  },
  // ---- Flame family ----------------------------------------------------------
  {
    name: "flame-adaptive",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/flame.ts",
      "src/app/flame-worker-core.ts",
      "src/app/flame-gpu-backend.ts",
    ],
  },
  {
    name: "flame-tiling-symmetry-noise",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/chaos-game.ts",
      "src/fractal/flame.ts",
      "src/fractal/point-tiling.ts",
      "src/app/flame-worker-core.ts",
    ],
  },
  {
    name: "flame-export",
    kind: "gate",
    cost: "lifecycle",
    modules: [
      "src/app/capture-cost.ts",
      "src/app/export-progress.ts",
      "src/app/flame-worker-core.ts",
      "src/app/main.ts",
    ],
  },
  {
    name: "flame-teardown",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/flame-gpu-backend.ts", "src/app/flame-worker-core.ts"],
  },
  // ---- Solid / glass family --------------------------------------------------
  {
    name: "solid-hierarchy",
    kind: "gate",
    cost: "full-render",
    modules: ["src/fractal/voxel.ts", "src/app/voxel-worker-core.ts"],
  },
  {
    name: "finite-glass",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/finite-solid.ts",
      "src/fractal/surface-optics.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "glass-solid-panel",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/finite-solid.ts",
      "src/app/ui.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "curved-solid-glass",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/finite-solid.ts",
      "src/fractal/surface-optics.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  // ---- Balloon explorer family -------------------------------------------------
  {
    name: "balloon-engine-ab",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/balloon-de.ts",
      "src/app/surface-compute.ts",
      "src/app/surface-material.ts",
    ],
  },
  {
    name: "balloon-real-driver",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/fractal/balloon-de.ts", "src/app/surface-compute.ts"],
  },
  {
    name: "explorer-balloon-4d",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/balloon-de.ts",
      "src/fractal/project4.ts",
      "src/app/four-d-view.ts",
    ],
  },
  // ---- Panel / UI family --------------------------------------------------------
  {
    name: "panel-contrast",
    kind: "gate",
    cost: "full-render",
    modules: ["src/app/ui.ts", "src/app/control-spec.ts", "src/app/style.css"],
  },
  {
    name: "panel-numeric-control",
    kind: "gate",
    cost: "lifecycle",
    modules: [
      "src/app/ui.ts",
      "src/app/control-spec.ts",
      "src/app/range-number-control.ts",
      "src/app/slider-scroll-guard.ts",
    ],
  },
  {
    name: "panel-touch-scroll",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/slider-scroll-guard.ts", "src/app/ui.ts"],
  },
  {
    name: "pattern",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-pattern.ts",
      "src/app/surface-material.ts",
      "src/app/surface-slots.ts",
    ],
  },
  {
    name: "pattern.compute",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-pattern.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  {
    name: "pattern-ui",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/surface-pattern.ts",
      "src/app/ui.ts",
      "src/app/surface-slots.ts",
    ],
  },
  {
    name: "pattern-release",
    kind: "gate",
    cost: "lifecycle",
    modules: [
      "src/fractal/surface-pattern.ts",
      "src/app/surface-compute.ts",
      "src/app/ui.ts",
    ],
  },
  // ---- Capture / lifecycle / measurement -----------------------------------------
  {
    name: "capture-drain",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/strip-planner.ts", "src/app/capture-cost.ts"],
  },
  {
    name: "capture-export",
    kind: "gate",
    cost: "lifecycle",
    modules: [
      "src/app/strip-planner.ts",
      "src/app/capture-cost.ts",
      "src/app/export-progress.ts",
    ],
  },
  {
    name: "isolation-reload",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/register-sw.ts", "src/app/isolation-handoff.ts"],
  },
  {
    name: "gpu-bench-diagnostics",
    kind: "gate",
    cost: "lifecycle",
    modules: ["scripts/gpu-bench-diagnostics.ts"],
  },
  {
    name: "native-gl-trace",
    kind: "gate",
    cost: "lifecycle",
    modules: ["scripts/native-gl-trace.build.mjs"],
  },
  {
    name: "native-gl-trace.analyze",
    kind: "gate",
    cost: "lifecycle",
    modules: ["scripts/native-gl-trace.analyze.mjs"],
  },
  {
    name: "live-site",
    kind: "gate",
    cost: "lifecycle",
    // Its subject is the DEPLOYED origin, not this tree: no local module
    // flips its verdict (a deploy rebuilds everything it drives). Listed so
    // the roster never calls it unmapped; it simply never matches a local
    // edit.
    modules: [],
  },
  {
    name: "surface-tiling",
    kind: "gate",
    cost: "full-render",
    modules: [
      "src/fractal/tiling.ts",
      "src/fractal/tiling-de.ts",
      "src/fractal/surface-de.ts",
      "src/fractal/surface-de-gpu.ts",
      "src/app/surface-compute.ts",
    ],
  },
  // ---- Lifecycle: the renderer's own session, never the frame -------------
  {
    name: "surface-teardown",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/surface-compute.ts", "src/fractal/surface-de-gpu.ts"],
  },
  {
    name: "surface-fence-cost",
    kind: "gate",
    cost: "lifecycle",
    modules: ["src/app/surface-compute.ts"],
  },
  // ---- Harness sheets (75) ---------------------------------------------------------
  // The sheets' exercised modules ride their OWN import closures (every sheet
  // imports the shared de-preview/set-extent machinery, which imports
  // src/fractal/*), so their entries carry only app-side extras — and the
  // table's maintenance cost stays at the gates. A sheet that starts driving
  // the app gains an entry here in the same change.
  ...(
    [
      "aff4-order-cpu",
      "balloon-inversion",
      "bulb-preview",
      "chain-speckle",
      "cinematic-lighting",
      "condensation-glass-app-twin",
      "condensation-glass",
      "condensation-surface",
      "erosion-repro",
      "escape-4d",
      "escape-chain",
      "escape-estimate-form",
      "escape-family-preview",
      "escape-form-sweep",
      "escape-trap-geometry",
      "finish-pattern",
      "finish-pattern-model",
      "finish-pattern-review-score",
      "finish-reflection",
      "finish-transmission",
      "finite-solid",
      "finite-transport-f5-replay",
      "flame-balloon",
      "flame-density-estimate",
      "flame-differential",
      "flame-estimate-progress",
      "flame-tiling-4d",
      "fold-cost-split",
      "fold-phantom",
      "fold-radii-seam",
      "hybrid-chain",
      "julia-flame",
      "lattice-tiling",
      "lens-branch-cost",
      "point-tiling",
      "preset-4d-showcase",
      "qjulia-beauty",
      "qjulia-preview",
      "shapes",
      "slab-adaptive",
      "slab-ball-slack",
      "slice-cost",
      "solid-balloon",
      "solid-hierarchy-verify-helpers",
      "solid-tiling-4d",
      "spherefold-radius-sweep",
      "sphere-inversion-4d-search",
      "sphere-inversion-authored-sets",
      "sphere-inversion-gencount",
      "sphere-inversion-glass-cost",
      "sphere-inversion-glass",
      "sphere-inversion",
      "sphere-inversion-oracle",
      "sphere-inversion-sample",
      "surface-beam",
      "surface-grid-cost",
      "surface-lighting-agreement",
      "surprise-residual",
      "swirl-lens",
      "tiling",
      "tiling-symmetry",
      "transmission-bend",
      "transmission-bend-tiles",
      "transmission-dielectric-solid",
      "transmission-dielectric-tree",
      "transmission-gap",
      "transmission-gpu-contract",
      "transmission-invariant",
      "transmission-layer-field",
      "transmission-motion",
      "transmission-prominence-field",
      "transmission-proxy",
      "transmission-proxy-visual",
      "voxel-hierarchy-traversal",
      "voxel-max-hierarchy",
    ] as const
  ).map((name): GateMapEntry => ({
    name,
    kind: "sheet",
    cost: "full-render",
    modules: [],
  })),
];

/** Does one changed repo path match one entry pattern? Exact, or a prefix
 * (patterns end in `/`), or a suffix wildcard (patterns end in `*`). */
export function gateMapMatches(file: string, pattern: string): boolean {
  if (file === pattern) return true;
  if (pattern.endsWith("*")) return file.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith("/")) return file.startsWith(pattern);
  return false;
}

/** Files whose change is not code: the roster never matches them (the CI
 * selector's inert() set, stated here for the local tool). */
export function isInertPath(file: string): boolean {
  return (
    file.startsWith("docs/") ||
    file.endsWith(".md") ||
    file.startsWith(".beads/")
  );
}

/** One entry's affected answer: the changed files it sees (through the table
 * or its own import closure), or null. `closure === null` means the closure
 * could not be computed and the table ALONE decides — an unparseable helper
 * must never read as "no script-side dependency". */
export interface AffectedEntry {
  name: string;
  kind: GateMapEntry["kind"];
  cost: GateMapEntry["cost"];
  /** The matched files, capped — a reason list, not a dump. */
  reasons: string[];
}

export function affectedForEntry(
  entry: GateMapEntry,
  changed: ReadonlySet<string>,
  closure: ReadonlySet<string> | null,
  opts: { maxReasons?: number } = {},
): AffectedEntry | null {
  const maxReasons = opts.maxReasons ?? 4;
  const reasons: string[] = [];
  for (const file of [...changed].sort()) {
    if (
      entry.modules.some((pattern) => gateMapMatches(file, pattern)) ||
      closure?.has(file)
    ) {
      reasons.push(file);
      if (reasons.length >= maxReasons) break;
    }
  }
  if (reasons.length === 0) return null;
  return { name: entry.name, kind: entry.kind, cost: entry.cost, reasons };
}

/** The full roster answer — the rules the CLI prints. Everything here is
 * conservative in the direction of MORE affected, never less:
 *
 * - machinery: a change to the map's or runner's own machinery marks every
 *   entry (SELECTION_MACHINERY's precedent);
 * - spine: a change to `APP_SPINE_MODULES` marks every GATE (sheets are
 *   immune — they import what they run);
 * - unmapped: an on-disk script without a table entry is reported, and —
 *   because unmapped could mean anything — counts as affected whenever any
 *   module-shaped file changed. It is a WARNING the update rule fixes, not
 *   a silent skip.
 * - inert (docs/, *.md, .beads/) never matches anything.
 */
export function affectedRoster(params: {
  entries: readonly GateMapEntry[];
  /** Roster names found on disk, with their kinds. */
  onDisk: ReadonlyMap<string, "gate" | "sheet">;
  /** Changed repo paths — base diff plus untracked, INERT FILES REMOVED. */
  changed: ReadonlySet<string>;
  /** Per-entry import closure over the tree the diff names (worktree for a
   * dirty tree, the head commit for --base/--head); null = unavailable. */
  closures: ReadonlyMap<string, ReadonlySet<string> | null>;
  maxReasons?: number;
}): {
  affected: AffectedEntry[];
  unmapped: string[];
  spineFiles: string[];
  machineryFiles: string[];
} {
  const { entries, onDisk, changed, closures } = params;
  const spineFiles = [...changed].filter((f) => APP_SPINE_MODULES.includes(f));
  const machineryFiles = [...changed].filter((f) =>
    GATE_MAP_MACHINERY.includes(f),
  );
  const spine = spineFiles.length > 0;
  const machinery = machineryFiles.length > 0;
  // Module-shaped = could execute or be executed: a change outside this set
  // (an inert path never gets here; images/fonts/config the walker cannot
  // classify) still counts for UNMAPPED conservatism but not for a table
  // match, which is exactly the table's own semantics.
  const codeChanged = [...changed].filter(
    (f) => /\.(?:[cm]?[jt]sx?)$/.test(f) || f.startsWith("scripts/"),
  );
  const byKindName = new Map(entries.map((e) => [`${e.kind}:${e.name}`, e]));
  const unmapped = [...onDisk]
    .filter(([name, kind]) => !byKindName.has(`${kind}:${name}`))
    .map(([name]) => name)
    .sort();
  const affected: AffectedEntry[] = [];
  for (const entry of entries) {
    if (machinery) {
      affected.push({
        ...entry,
        reasons: [...machineryFiles].slice(0, params.maxReasons ?? 4),
      });
      continue;
    }
    const closure = closures.get(entry.name) ?? null;
    const direct = affectedForEntry(entry, changed, closure, {
      maxReasons: params.maxReasons,
    });
    if (direct) {
      affected.push(
        spine
          ? {
              ...entry,
              reasons: [
                ...direct.reasons,
                ...spineFiles.slice(0, params.maxReasons ?? 4),
              ].slice(0, params.maxReasons ?? 4),
            }
          : direct,
      );
      continue;
    }
    // Spine-only: the gate boots the app, the spine moved, the table did
    // not match this entry on its own.
    if (spine && entry.kind === "gate") {
      affected.push({
        ...entry,
        reasons: [...spineFiles].slice(0, params.maxReasons ?? 4),
      });
    }
  }
  // Unmapped on-disk scripts: conservative affected when any code changed.
  if (codeChanged.length > 0) {
    for (const name of unmapped) {
      affected.push({
        name,
        kind: onDisk.get(name) ?? "gate",
        cost: "full-render",
        reasons: ["unmapped entry — add it to GATE_MAP in the same change"],
      });
    }
  }
  const order: Record<GateMapEntry["cost"], number> = {
    "cache-eligible": 0,
    "full-render": 1,
    lifecycle: 2,
  };
  affected.sort(
    (a, b) => order[a.cost] - order[b.cost] || a.name.localeCompare(b.name),
  );
  return { affected, unmapped, spineFiles, machineryFiles };
}
