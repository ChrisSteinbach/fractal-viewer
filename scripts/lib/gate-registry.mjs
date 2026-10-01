/**
 * THE WARM-RUNNER GATE REGISTRY — which verify gates `npm run verify` can
 * drive, and what each one wants to be told.
 *
 * The orchestrator (scripts/verify.mjs) runs gates it can name here; any
 * other `scripts/*.mjs` path still runs through it, just with NO forwarded
 * flags (the gate's own defaults apply — correct only when the preview
 * server holds the default URL). Entries are keyed by the bare gate name
 * (the script filename minus `.verify.mjs`).
 *
 * THE UPDATE RULE IS THE PRESET SIDE TABLES' RULE: adding a gate means
 * adding its entry in the SAME change. An unlisted gate still runs (by
 * explicit path) but silently forgoes flag forwarding, so a gate author who
 * skips this table is quietly opting their gate out of warm runs — the
 * registry is cheap, fill it in.
 *
 * FIELDS
 *   script     filename under `scripts/`.
 *   modeFlag   how the gate selects its browser mode:
 *                "--mode"    — append `--mode=<mode>`; the gate accepts
 *                              `sw` and `x11:<display>` directly.
 *                "--display" — append `--display=<display>` for an
 *                              `x11:<display>` mode and NOTHING for `sw`
 *                              (omitting the flag IS the gate's
 *                              SwiftShader default).
 *                null        — the gate pins its browser mode in source
 *                              (`pinnedMode`); the orchestrator skips it
 *                              under a contradicting `--mode` rather
 *                              than running it in a mode its author never
 *                              intended.
 *   urlFlag    how the gate learns the preview URL:
 *                "--url"      — append `--url=<previewUrl>`.
 *                "positional" — append `<previewUrl>` as a bare argument.
 *                "none"       — the gate never loads from the preview
 *                               server (self-contained pages); correct at
 *                               any preview URL.
 *                null         — the gate hardcodes the default URL; the
 *                               orchestrator only routes it when the
 *                               preview server IS that default.
 *
 * Whether a gate SHARES the orchestrator's warm browser is NOT decided
 * here: every gate gets the shared-session environment, and the runner's
 * browser-signature comparison (surface-browser-runner.mjs) is the single
 * gatekeeper — a gate with private launch options or a pinned mode that
 * differs from the orchestrator's simply launches its own browser.
 */

export const DEFAULT_PREVIEW_URL = "https://localhost:4173";

/**
 * @typedef {object} GateSpec
 * @property {string} script filename under `scripts/`.
 * @property {"--mode"|"--display"|null} modeFlag how the gate selects its
 *   browser mode (see the module doc's field table).
 * @property {"--url"|"positional"|"none"|null} urlFlag how the gate learns
 *   the preview URL.
 * @property {string} [pinnedMode] the gate's own mode when modeFlag is null.
 */

/** @type {Record<string, GateSpec>} */
export const GATES = {
  // --mode + --url gates ---------------------------------------------------
  "surface-chaos": {
    script: "surface-chaos.verify.mjs",
    modeFlag: "--mode",
    urlFlag: "--url",
  },
  "surface-schedule": {
    script: "surface-schedule.verify.mjs",
    modeFlag: "--mode",
    urlFlag: "--url",
  },
  "surface-emitter-only": {
    script: "surface-emitter-only.verify.mjs",
    modeFlag: "--mode",
    urlFlag: "--url",
  },
  "curved-solid-glass": {
    script: "curved-solid-glass.verify.mjs",
    modeFlag: "--mode",
    urlFlag: "--url",
  },

  // --mode gates that hardcode the default preview URL ----------------------
  "sphere-inversion-family": {
    script: "sphere-inversion-family.verify.mjs",
    modeFlag: "--mode",
    urlFlag: null,
  },
  "sphere-inversion-glass": {
    script: "sphere-inversion-glass.verify.mjs",
    modeFlag: "--mode",
    urlFlag: null,
  },
  "sphere-inversion-presets": {
    script: "sphere-inversion-presets.verify.mjs",
    modeFlag: "--mode",
    urlFlag: null,
  },

  // --display gates (omit the flag for SwiftShader) + --url -----------------
  "tiling-symmetry": {
    script: "tiling-symmetry.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "tiling-balloon": {
    script: "tiling-balloon.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "surface-swirl": {
    script: "surface-swirl.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "final-swirl-radius": {
    script: "final-swirl-radius.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "surface-lighting-ui": {
    script: "surface-lighting-ui.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "cinematic-lighting": {
    script: "cinematic-lighting.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },
  "surface-swirl-stride-control": {
    script: "surface-swirl-stride-control.verify.mjs",
    modeFlag: "--display",
    urlFlag: "--url",
  },

  // self-contained or pinned gates ------------------------------------------
  "surface-light-guides": {
    script: "surface-light-guides.verify.mjs",
    modeFlag: null,
    pinnedMode: "sw",
    urlFlag: "positional",
  },
  "swirl-glsl": {
    script: "swirl-glsl.verify.mjs",
    modeFlag: "--display",
    urlFlag: "none",
  },
};

/** PURE. Build one gate's CLI args for an orchestrator mode and preview
 * URL, or `{ args, skipped: null }` / `{ args: [], skipped: <reason> }`.
 * The skip reasons are user-facing: they name the registry field that
 * contradicts the requested run. */
export function gatePlanStep(spec, mode, previewUrl) {
  const args = [];
  if (spec.modeFlag === "--mode") {
    args.push(`--mode=${mode}`);
  } else if (spec.modeFlag === "--display") {
    if (mode !== "sw") {
      if (!/^x11:.+/.test(mode)) {
        return { args, skipped: `unsupported mode ${mode}` };
      }
      args.push(`--display=${mode.slice(4)}`);
    }
  } else if (spec.modeFlag === null) {
    if (spec.pinnedMode !== mode) {
      return {
        args,
        skipped: `pins its own mode (${spec.pinnedMode}); not run under --mode=${mode}`,
      };
    }
  }
  if (spec.urlFlag === "--url") {
    args.push(`--url=${previewUrl}`);
  } else if (spec.urlFlag === "positional") {
    args.push(previewUrl);
  } else if (spec.urlFlag === null && previewUrl !== DEFAULT_PREVIEW_URL) {
    return {
      args,
      skipped: `loads its hardcoded default URL; the preview server is ${previewUrl}`,
    };
  }
  return { args, skipped: null };
}
