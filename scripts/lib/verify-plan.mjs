/**
 * THE WARM RUNNER'S PURE PLAN — argument parsing, per-gate CLI construction
 * and run-summary formatting, all side-effect free so they unit-test
 * without a browser (scripts/gate-verify.test.ts). The executable side —
 * build, preview server, browser session, child processes — is
 * scripts/verify.mjs.
 *
 * Terminology: the "shared session" is the orchestrator's ONE preview
 * server + ONE Chromium, reachable over CDP by the gates it spawns. It is
 * deliberately NOT a resident daemon process (see docs/gate-velocity.md):
 * `npm run verify` owns build → serve → boot → gates in one process, and
 * everything the bead's daemon would have kept alive across invocations is
 * re-created in ~2-4s on the next one — against a ~40s full build or a
 * minutes-long settle, a resident daemon buys nothing its complexity costs.
 */

import { DEFAULT_PREVIEW_URL, GATES, gatePlanStep } from "./gate-registry.mjs";

export const USAGE = `usage: npm run verify -- [--mode=x11::0|sw] [--preview-port=N] [--fresh] [--watch] gate [gate ...]

Runs the named verify gates back-to-back against ONE build, ONE preview
server and ONE warm Chromium: gates connect over CDP instead of each
launching a private browser, and GPU work stays serial.

  --mode=x11::0  browser mode for the shared session (default x11::0; the
                 gate flags follow the registry's per-gate convention).
  --preview-port 4173  port for the preview server; adopts a verified-ours
                 vite preview already on the port, refuses anything else.
  --fresh        force a full build even when dist/ is already fresh.
  --watch        keep a vite build --watch running and re-run the gates on
                 every rebuild — the edit loop: edit, seconds-scale rebuild,
                 warm re-verdict.

Gates are bare registry names (surface-chaos, tiling-symmetry, ...) or
explicit scripts/*.mjs paths, which run with no forwarded flags. Standalone
gate invocations keep working exactly as before.`;

export function formatUsageError(message) {
  return `${message}\n\n${USAGE}`;
}

/** PURE. Parse the orchestrator's own arguments. Positional targets are
 * kept verbatim; flags may appear anywhere. Throws with the usage text on
 * anything unexpected. */
export function parseVerifyArgs(argv) {
  const parsed = {
    mode: "x11::0",
    previewPort: 4173,
    fresh: false,
    watch: false,
    targets: [],
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw : raw.slice(0, eq);
    const value = eq === -1 ? undefined : raw.slice(eq + 1);
    switch (key) {
      case "--mode":
        if (value === undefined || !/^(sw|x11:.+)$/.test(value)) {
          throw new Error(
            `--mode must be sw or x11:<display> (got ${value ?? "nothing"})`,
          );
        }
        parsed.mode = value;
        break;
      case "--preview-port": {
        const port = Number(value);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`--preview-port must be a TCP port (got ${value})`);
        }
        parsed.previewPort = port;
        break;
      }
      case "--fresh":
        if (value !== undefined) throw new Error("--fresh takes no value");
        parsed.fresh = true;
        break;
      case "--watch":
        if (value !== undefined) throw new Error("--watch takes no value");
        parsed.watch = true;
        break;
      default:
        if (key.startsWith("--") || value !== undefined) {
          throw new Error(`unknown orchestrator flag ${key}`);
        }
        parsed.targets.push(raw);
        break;
    }
  }
  return parsed;
}

/** PURE. The CLI args one gate is spawned with, or a skip reason. Registry
 * name → per-gate convention; explicit path → no flags (its own defaults
 * apply, which is only correct at the default preview URL). */
export function gateInvocation(target, mode, previewUrl) {
  if (target.includes("/") || target.endsWith(".mjs")) {
    const warn =
      previewUrl === DEFAULT_PREVIEW_URL
        ? null
        : `explicit path runs with its own default URL, which is not this preview server (${previewUrl})`;
    return {
      target,
      script: target.startsWith("scripts/") ? target : `scripts/${target}`,
      args: [],
      skipped: null,
      note: warn,
    };
  }
  const spec = GATES[target];
  if (!spec) {
    throw new Error(
      `unknown gate "${target}" — registry has: ${Object.keys(GATES).join(", ")}; ` +
        `or pass a script path directly (scripts/<name>.verify.mjs)`,
    );
  }
  const { args, skipped } = gatePlanStep(spec, mode, previewUrl);
  return {
    target,
    script: `scripts/${spec.script}`,
    args,
    skipped,
    note: null,
  };
}

/** PURE. One summary line per gate: verdict word first, then the numbers.
 * Whether a leg actually JOINED the shared browser is the runner's own log
 * (it prints one line when it declines); the orchestrator cannot see it
 * and does not invent it. */
export function formatGateResult(result) {
  if (result.skipped !== null) {
    return `SKIP  ${result.target} — ${result.skipped}`;
  }
  const wall = `${(result.wallMs / 1000).toFixed(1)}s`;
  const verdict = result.exit === 0 ? "PASS" : `FAIL (exit ${result.exit})`;
  return `${verdict}  ${result.target}  ${wall}`;
}

/** PURE. Does a vite build/watch output line say a production build has
 * FINISHED? Watch mode re-runs the gates on this signal, so it must match
 * only completed builds — "building for production..." must not. */
export function lineMarksBuildCompletion(line) {
  return /✓ built in /.test(line) || /^built in /.test(line.trim());
}
