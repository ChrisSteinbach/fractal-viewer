/**
 * Unit tests for the warm gate runner's pure layer: orchestrator argument
 * parsing (scripts/lib/verify-plan.mjs), the gate registry's per-gate CLI
 * conventions (scripts/lib/gate-registry.mjs), and the browser signature
 * the shared-session handoff compares (surface-browser-runner.mjs —
 * imported for its pure function only; nothing here launches a browser).
 *
 * The executable side — build, server, browser, watch loop — is verified
 * by running gates through `npm run verify`; the measured accounting is in
 * docs/gate-velocity.md.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PREVIEW_URL, GATES } from "./lib/gate-registry.mjs";
import {
  formatGateResult,
  formatUsageError,
  gateInvocation,
  lineMarksBuildCompletion,
  parseVerifyArgs,
} from "./lib/verify-plan.mjs";
import { browserSignature } from "./lib/surface-browser-runner.mjs";

describe("parseVerifyArgs", () => {
  it("defaults to the x11::0 mode, port 4173, no watch, no fresh", () => {
    const args = parseVerifyArgs(["surface-chaos"]);
    expect(args.mode).toBe("x11::0");
    expect(args.previewPort).toBe(4173);
    expect(args.watch).toBe(false);
    expect(args.fresh).toBe(false);
    expect(args.targets).toEqual(["surface-chaos"]);
  });

  it("accepts flags in any position and keeps targets in order", () => {
    const args = parseVerifyArgs([
      "--watch",
      "surface-chaos",
      "--mode=sw",
      "tiling-symmetry",
    ]);
    expect(args.mode).toBe("sw");
    expect(args.watch).toBe(true);
    expect(args.targets).toEqual(["surface-chaos", "tiling-symmetry"]);
  });

  it("refuses a malformed mode", () => {
    expect(() => parseVerifyArgs(["--mode=x11", "surface-chaos"])).toThrow(
      /--mode/,
    );
    expect(() => parseVerifyArgs(["--mode", "surface-chaos"])).toThrow(
      /--mode/,
    );
  });

  it("refuses a non-port --preview-port", () => {
    expect(() =>
      parseVerifyArgs(["--preview-port=0", "surface-chaos"]),
    ).toThrow(/--preview-port/);
    expect(() =>
      parseVerifyArgs(["--preview-port=big", "surface-chaos"]),
    ).toThrow(/--preview-port/);
  });

  it("refuses unknown orchestrator flags", () => {
    expect(() => parseVerifyArgs(["--tier=fast"])).toThrow(/--tier/);
  });

  it("refuses a flag-looking bare target", () => {
    expect(() => parseVerifyArgs(["--verbose"])).toThrow(/--verbose/);
  });
});

describe("gateInvocation", () => {
  it("passes --mode verbatim to a --mode gate", () => {
    const step = gateInvocation("surface-chaos", "x11::0", DEFAULT_PREVIEW_URL);
    expect(step.skipped).toBeNull();
    expect(step.script).toBe("scripts/surface-chaos.verify.mjs");
    expect(step.args).toContain("--mode=x11::0");
    expect(step.args).toContain(`--url=${DEFAULT_PREVIEW_URL}`);
  });

  it("maps sw onto NO flag for a --display gate (omit = SwiftShader default)", () => {
    const step = gateInvocation("tiling-symmetry", "sw", DEFAULT_PREVIEW_URL);
    expect(step.args.some((a) => a.startsWith("--display"))).toBe(false);
    expect(step.args).toContain(`--url=${DEFAULT_PREVIEW_URL}`);
  });

  it("splits x11:<display> onto --display for a --display gate", () => {
    const step = gateInvocation(
      "tiling-symmetry",
      "x11:1",
      DEFAULT_PREVIEW_URL,
    );
    expect(step.args).toContain("--display=1");
    expect(step.args.some((a) => a.startsWith("--mode"))).toBe(false);
  });

  it("skips a pinned-mode gate under a contradicting --mode", () => {
    const step = gateInvocation(
      "surface-light-guides",
      "x11::0",
      DEFAULT_PREVIEW_URL,
    );
    expect(step.skipped).toMatch(/pins its own mode \(sw\)/);
    const sw = gateInvocation(
      "surface-light-guides",
      "sw",
      DEFAULT_PREVIEW_URL,
    );
    expect(sw.skipped).toBeNull();
    expect(sw.args).toEqual([DEFAULT_PREVIEW_URL]); // positional URL
  });

  it("skips a hardcoded-URL gate when the preview server is elsewhere", () => {
    const step = gateInvocation(
      "sphere-inversion-family",
      "sw",
      "https://localhost:5000",
    );
    expect(step.skipped).toMatch(/hardcoded default URL/);
    const atDefault = gateInvocation(
      "sphere-inversion-family",
      "sw",
      DEFAULT_PREVIEW_URL,
    );
    expect(atDefault.skipped).toBeNull();
    expect(atDefault.args).toEqual(["--mode=sw"]);
  });

  it("a self-contained page gate runs at any preview URL", () => {
    const step = gateInvocation(
      "swirl-glsl",
      "x11::0",
      "https://localhost:5000",
    );
    expect(step.skipped).toBeNull();
    expect(step.args).toEqual(["--display=:0"]);
  });

  it("explicit script paths run with no forwarded flags", () => {
    const step = gateInvocation(
      "scripts/surface-repro.verify.mjs",
      "sw",
      DEFAULT_PREVIEW_URL,
    );
    expect(step.skipped).toBeNull();
    expect(step.args).toEqual([]);
    expect(step.script).toBe("scripts/surface-repro.verify.mjs");
  });

  it("a bare non-registry name is an error naming the registry", () => {
    expect(() =>
      gateInvocation("no-such-gate", "sw", DEFAULT_PREVIEW_URL),
    ).toThrow(/unknown gate "no-such-gate"/);
  });
});

describe("formatGateResult", () => {
  it("leads with the verdict word", () => {
    expect(
      formatGateResult({ target: "g", exit: 0, wallMs: 1234, skipped: null }),
    ).toMatch(/^PASS/);
    expect(
      formatGateResult({ target: "g", exit: 1, wallMs: 1234, skipped: null }),
    ).toMatch(/^FAIL \(exit 1\)/);
    expect(
      formatGateResult({ target: "g", skipped: "pins its own mode" }),
    ).toMatch(/^SKIP/);
  });
});

describe("lineMarksBuildCompletion", () => {
  it("matches a finished vite build line", () => {
    expect(lineMarksBuildCompletion("✓ built in 12.34s")).toBe(true);
    expect(lineMarksBuildCompletion("built in 3.2s")).toBe(true);
  });
  it("does not match an in-progress line or ordinary output", () => {
    expect(lineMarksBuildCompletion("building for production...")).toBe(false);
    expect(lineMarksBuildCompletion("watching for file changes...")).toBe(
      false,
    );
    expect(lineMarksBuildCompletion("transforming (412) index.html")).toBe(
      false,
    );
  });
});

describe("browserSignature", () => {
  it("separates the modes from each other", () => {
    const sw = browserSignature("sw");
    const x11 = browserSignature("x11::0");
    const x11other = browserSignature("x11:1");
    expect(new Set([sw, x11, x11other]).size).toBe(3);
  });

  it("is stable across calls for the same mode", () => {
    expect(browserSignature("sw")).toBe(browserSignature("sw"));
  });
});

describe("registry hygiene", () => {
  it("every entry names a script that exists", () => {
    for (const [name, spec] of Object.entries(GATES)) {
      expect(spec.script, name).toMatch(/\.verify\.mjs$/);
    }
  });

  it("a modeFlag entry carries no pinnedMode and vice versa", () => {
    for (const [name, spec] of Object.entries(GATES)) {
      if (spec.modeFlag === null) {
        expect(spec.pinnedMode, name).toBeTruthy();
      } else {
        expect(spec.pinnedMode, name).toBeUndefined();
      }
    }
  });
});

describe("formatUsageError", () => {
  it("carries the message and the usage text", () => {
    const text = formatUsageError("bad thing");
    expect(text).toMatch(/^bad thing\n\nusage:/);
  });
});
