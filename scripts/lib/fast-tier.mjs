/**
 * THE FAST-TIER GATE HELPERS — the one wiring layer for the verify gates'
 * `--tier=fast` development-loop mode (docs/gate-velocity.md, the
 * gate-velocity epic's fast-tier child). The gates' full pass is the
 * record and stays byte-unchanged; fast is the loop a developer actually
 * runs, and it must never be mistakable for one.
 *
 * THE HONESTY RULE, enforced at the vocabulary level: a fast run's verdict
 * output discloses the tier of every assertion, because determinism does
 * not depend on resolution but READERS might assume a green line meant a
 * full-quality frame. Every helper here returns or labels with the tier so
 * a gate cannot print a tier-less verdict line by accident.
 *
 * WHAT FAST CHANGES — only knobs the app already exposes to a page, never
 * new app code:
 *   - the RASTER: `?surfacemaxrays=FAST_TIER_MAXRAYS`, the app's own
 *     device-ceiling stand-in. The live pane FITS under the cap
 *     (`fitSurfaceComputeRaster` — the preview tier's own mechanism) and
 *     blits up to the unchanged canvas, so the render raster shrinks while
 *     the page, the panel and every DOM interaction stay exactly the full
 *     tier's. A VIEWPORT shrink was measured and REJECTED: the app's
 *     MOBILE_BREAKPOINT (640px, `src/app/constants.ts`) collapses the
 *     panel behind the ☰ toggle at a half-size viewport, and the lift
 *     gate's `#modeSurfaceBtn` click timed out with "element is not
 *     visible" — the fast tier must not fork the gates' UI choreography.
 *   - the SUPER SAMPLES: `?surfacesamples=1` (the app's own page-load
 *     override, one antialiasing pass — the app spends the persisted
 *     detent, default 8, on both the settle and the Save-PNG, so the
 *     override governs both).
 *   - the EXPORT SCALE: 1 (an export at the pane's own size, banded under
 *     the same cap — the cheapest honest capture; the frame-pure content
 *     checks are scale-relative).
 *
 * WHAT FAST DOES NOT CHANGE: the viewport (the canvas geometry, the panel
 * layout and the gates' DOM choreography are identical across tiers, which
 * is also what makes the pilot compare meaningful), the settle latch
 * (still a completed settle, never "pixels stopped moving"), the
 * byte-exactness bars between two same-tier frames (both sides get the
 * same treatment, so `maxDelta === 0` means the same thing it meant at
 * full), and every relative bar (coverage shares, discrimination factors,
 * IoU) — those are ratios, tier-free by construction.
 *
 * THE PILOT. One named scenario per fast run renders at FULL tier (no tier
 * URL params at all) asserting the same frame-pure predicates its fast
 * pass asserted; {@link tierCorrespondence} compares the two verdicts.
 * This is the run's one full-resolution sample, reserved from the fast
 * raster by design: it re-anchors the fast-vs-full correspondence the
 * frame cache keys carry (the key's env field separates the tiers'
 * entries, so a fast entry can never replay into a full run) and turns a
 * fast tier that stopped tracking the full one into a FAIL with the
 * divergent predicates named. A fast run that skips its pilot is not
 * honest; a full run has no pilot (the whole run is the anchor).
 */

/** The tier a gate runs at: "full" (the record, the default) or "fast"
 * (the development loop).
 *
 * @typedef {"fast" | "full"} GateTier
 */

/**
 * The fast tier's per-frame ray cap, fed to the app's own
 * `?surfacemaxrays` device-ceiling stand-in. A quarter of the
 * lift/slab-class gate viewport's rays (1024x640 = 655360), whose fit
 * scale is therefore exactly 0.5 (512x320 under an unchanged 1024x640
 * canvas); on the larger 1600x900 shared viewport the same cap is a ~8.8x
 * ray cut (a ~0.34 fit scale). The export raster bands under the same
 * cap, so a fast export is cheap for the same reason.
 */
export const FAST_TIER_MAXRAYS = 163_840;

/**
 * Parse a gate's `--tier=` flag. Absent means "full" — the gates' recorded
 * behavior is the default, and every pre-existing invocation keeps its
 * meaning. Bare `--tier` or an unknown value is a CHECKING error (throw):
 * a typo'd tier silently running at full resolution would be the one way
 * this flag could lie.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {GateTier}
 */
export function parseTierArg(argv) {
  let tier = "full";
  for (const raw of argv) {
    if (!raw.startsWith("--tier")) continue;
    const value = raw.slice("--tier".length);
    if (value === "" || value === "=") {
      throw new Error("--tier needs a value: fast or full");
    }
    if (!value.startsWith("=")) {
      throw new Error(`unknown flag ${raw.slice(0, 8)}`);
    }
    const name = value.slice(1);
    if (name !== "fast" && name !== "full") {
      throw new Error(`unknown --tier=${name} (fast or full)`);
    }
    tier = name;
  }
  return tier;
}

/**
 * The URL params a tier adds to every page load. Full adds none — the
 * gate's own conventions apply, byte-unchanged. Fast pins one antialiasing
 * pass and the ray cap (the app's own page-load overrides, governing the
 * settle AND the Save-PNG alike). A gate that already pins
 * `surfacesamples=1` at full (the slab gate's convention) keeps that pin
 * at both tiers; merging the two is the caller's — this returns the
 * tier's contribution only, and the same map is what the frame cache's
 * `env` field carries (the tier's entries are separate by key).
 *
 * @param {GateTier} tier
 * @returns {Record<string, string>}
 */
export function tierUrlParams(tier) {
  return tier === "fast"
    ? { surfacesamples: "1", surfacemaxrays: String(FAST_TIER_MAXRAYS) }
    : {};
}

/**
 * The Save-PNG scale a tier uses. Full passes the gate's own `--scale`
 * through (the recorded export geometry); fast pins 1 — the export is the
 * pane's own size, banded under the same ray cap, and the export content
 * checks are relative.
 *
 * @param {GateTier} tier
 * @param {number} requested the gate's own scale argument
 * @returns {number}
 */
export function tierExportScale(tier, requested) {
  return tier === "fast" ? 1 : requested;
}

/**
 * The tier label a verdict line carries — the disclosure itself, so a gate
 * composes `tier=${tierLabel(tier)}` into every per-assertion line rather
 * than improvising a wording per gate.
 *
 * @param {GateTier} tier
 * @returns {"fast" | "full"}
 */
export function tierLabel(tier) {
  return tier;
}

/**
 * Compare one scenario's frame-pure predicates across the two tiers — the
 * pilot's verdict. Both maps are `{predicateName: boolean}` collected by
 * the SAME code path (the gate's per-scenario checks), so a key present on
 * one side only is a harness defect and is reported as a divergence, not
 * silently ignored.
 *
 * Agreement means every predicate held on both tiers. A divergence —
 * fast passed where full failed, or the reverse — FAILS the fast run: the
 * fast tier has stopped tracking the full one and its green lines are no
 * longer trustworthy for that contract.
 *
 * @param {Record<string, boolean>} fastPredicates
 * @param {Record<string, boolean>} fullPredicates
 * @returns {{ agree: boolean, diverged: string[] }}
 */
export function tierCorrespondence(fastPredicates, fullPredicates) {
  const names = new Set([
    ...Object.keys(fastPredicates),
    ...Object.keys(fullPredicates),
  ]);
  const diverged = [...names].filter(
    (name) => Boolean(fastPredicates[name]) !== Boolean(fullPredicates[name]),
  );
  return { agree: diverged.length === 0, diverged };
}
