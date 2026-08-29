import { describe, expect, it } from "vitest";

import {
  comparePixelChannels,
  isKnownServiceWorkerSslNoise,
  median,
  medianSampleIndex,
  parseSolidHierarchyVerifyArgs,
  rendererIsSoftware,
} from "./solid-hierarchy-verify-helpers";

describe("Solid hierarchy production verifier helpers", () => {
  it("preserves the historical SwiftShader defaults", () => {
    expect(parseSolidHierarchyVerifyArgs([])).toMatchObject({
      url: "https://localhost:5173",
      captures: 5,
      warmups: 2,
      resolution: 192,
      driver: "swiftshader",
      fixtures: ["default"],
    });
  });

  it("parses hardware, output, timeout, and de-duplicated fixtures", () => {
    expect(
      parseSolidHierarchyVerifyArgs([
        "--driver=hardware",
        "--display=:8",
        "--chrome=/usr/bin/google-chrome",
        "--fixtures=nonlinear,stochastic",
        "--fixture=nonlinear",
        "--warmups=2",
        "--captures=7",
        "--resolution=128",
        "--timeout=90000",
        "--outdir=bench-results/solid",
      ]),
    ).toMatchObject({
      driver: "hardware",
      display: ":8",
      chrome: "/usr/bin/google-chrome",
      fixtures: ["nonlinear", "stochastic"],
      warmups: 2,
      captures: 7,
      resolution: 128,
      timeoutMs: 90_000,
      outdir: "bench-results/solid",
    });
  });

  it("rejects invalid driver and numeric values", () => {
    expect(() => parseSolidHierarchyVerifyArgs(["--driver=magic"])).toThrow(
      /driver/,
    );
    expect(() => parseSolidHierarchyVerifyArgs(["--captures=0"])).toThrow(
      /captures/,
    );
    expect(() => parseSolidHierarchyVerifyArgs(["--resolution=16"])).toThrow(
      /resolution/,
    );
  });

  it("computes medians, stable sample selection, and channel deltas", () => {
    expect(median([8, 2, 5, 4])).toBe(4.5);
    expect(medianSampleIndex([8, 2, 5, 4])).toBe(2);
    expect(comparePixelChannels([0, 10, 20, 255], [0, 11, 17, 255])).toEqual({
      changedChannels: 2,
      maxChannelDelta: 3,
      meanChannelDelta: 1,
    });
  });

  it("distinguishes hardware renderer labels from software adapters", () => {
    expect(rendererIsSoftware(null)).toBe(true);
    expect(rendererIsSoftware("ANGLE (Google, Vulkan 1.3 SwiftShader)")).toBe(
      true,
    );
    expect(rendererIsSoftware("llvmpipe (LLVM 19.1.7, 256 bits)")).toBe(true);
    expect(
      rendererIsSoftware(
        "ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2))",
      ),
    ).toBe(false);
  });

  it("filters only the known local service-worker certificate noise", () => {
    expect(
      isKnownServiceWorkerSslNoise(
        "An SSL certificate error occurred when fetching the script.",
      ),
    ).toBe(true);
    expect(
      isKnownServiceWorkerSslNoise(
        "Service worker registration failed: SecurityError: Failed to register a ServiceWorker with script (https://127.0.0.1:4173/sw.js): An SSL certificate error occurred",
      ),
    ).toBe(true);
    expect(
      isKnownServiceWorkerSslNoise("WebGL shader compilation failed"),
    ).toBe(false);
  });
});
