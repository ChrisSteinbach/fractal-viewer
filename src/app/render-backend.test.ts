import {
  isSoftwareRendererLabel,
  webgpuAdapterStatus,
  unmaskedWebglRenderer,
  surfaceWebglDetail,
  softwareWarningText,
  type WebglContextLike,
} from "./render-backend";

describe("isSoftwareRendererLabel", () => {
  it("matches a plain SwiftShader vendor string", () => {
    expect(isSoftwareRendererLabel("Google SwiftShader")).toBe(true);
  });

  it("matches a full ANGLE SwiftShader renderer string", () => {
    expect(
      isSoftwareRendererLabel(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      ),
    ).toBe(true);
  });

  it("matches llvmpipe", () => {
    expect(isSoftwareRendererLabel("llvmpipe (LLVM 15.0.6, 256 bits)")).toBe(
      true,
    );
  });

  it("matches Microsoft's Basic Render Driver", () => {
    expect(isSoftwareRendererLabel("Microsoft Basic Render Driver")).toBe(true);
  });

  it("matches Apple's software renderer", () => {
    expect(isSoftwareRendererLabel("Apple Software Renderer")).toBe(true);
  });

  it("does not match a real Intel Mesa renderer string", () => {
    expect(
      isSoftwareRendererLabel(
        "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)",
      ),
    ).toBe(false);
  });

  it("does not match Apple M2", () => {
    expect(isSoftwareRendererLabel("Apple M2")).toBe(false);
  });

  it("does not match an NVIDIA GeForce renderer string", () => {
    expect(isSoftwareRendererLabel("NVIDIA GeForce RTX 3060/PCIe/SSE2")).toBe(
      false,
    );
  });
});

describe("webgpuAdapterStatus", () => {
  it("joins vendor and architecture into the label for a hardware adapter", () => {
    const result = webgpuAdapterStatus({
      vendor: "intel",
      architecture: "xe-lpg",
    });
    expect(result).toEqual({ label: "intel xe-lpg", software: false });
  });

  it("marks software and suffixes the label when info.isFallbackAdapter is true", () => {
    const result = webgpuAdapterStatus({
      vendor: "intel",
      architecture: "xe-lpg",
      isFallbackAdapter: true,
    });
    expect(result).toEqual({
      label: "intel xe-lpg (software)",
      software: true,
    });
  });

  it("marks software via the adapterFallback argument (the older adapter.isFallbackAdapter home)", () => {
    const result = webgpuAdapterStatus(
      { vendor: "intel", architecture: "xe-lpg" },
      true,
    );
    expect(result).toEqual({
      label: "intel xe-lpg (software)",
      software: true,
    });
  });

  it("marks software from a string tell in architecture even when isFallbackAdapter is absent (the field case)", () => {
    const result = webgpuAdapterStatus({
      vendor: "Google",
      architecture: "SwiftShader",
    });
    expect(result).toEqual({
      label: "Google SwiftShader (software)",
      software: true,
    });
  });

  it("yields an undefined label when vendor/architecture are blank-but-present on a hardware adapter (Firefox)", () => {
    const result = webgpuAdapterStatus({ vendor: "", architecture: "" });
    expect(result).toEqual({ label: undefined, software: false });
  });

  it("falls back to 'fallback adapter (software)' when a fallback adapter has no fields to show", () => {
    const result = webgpuAdapterStatus({
      vendor: "",
      architecture: "",
      isFallbackAdapter: true,
    });
    expect(result).toEqual({
      label: "fallback adapter (software)",
      software: true,
    });
  });

  it("marks software from a string tell in description alone", () => {
    const result = webgpuAdapterStatus({
      vendor: "Google",
      architecture: "",
      description: "SwiftShader",
    });
    expect(result).toEqual({ label: "Google (software)", software: true });
  });
});

describe("unmaskedWebglRenderer", () => {
  it("reads the unmasked renderer through the WEBGL_debug_renderer_info extension", () => {
    const UNMASKED_RENDERER_WEBGL = 37446;
    const gl: WebglContextLike = {
      RENDERER: 7936,
      getExtension: (name) =>
        name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_RENDERER_WEBGL }
          : null,
      getParameter: (pname) =>
        pname === UNMASKED_RENDERER_WEBGL
          ? "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)"
          : "WebGL",
    };
    expect(unmaskedWebglRenderer(gl)).toBe(
      "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)",
    );
  });

  it("falls back to the masked RENDERER parameter when the debug extension is unavailable", () => {
    const gl: WebglContextLike = {
      RENDERER: 7936,
      getExtension: () => null,
      getParameter: (pname) =>
        pname === 7936 ? "llvmpipe (LLVM 15.0.6, 256 bits)" : "unexpected",
    };
    expect(unmaskedWebglRenderer(gl)).toBe("llvmpipe (LLVM 15.0.6, 256 bits)");
  });

  it("returns null when the renderer parameter is an empty string", () => {
    const gl: WebglContextLike = {
      RENDERER: 7936,
      getExtension: () => null,
      getParameter: () => "",
    };
    expect(unmaskedWebglRenderer(gl)).toBeNull();
  });

  it("returns null when the renderer parameter isn't a string", () => {
    const gl: WebglContextLike = {
      RENDERER: 7936,
      getExtension: () => null,
      getParameter: () => 12345,
    };
    expect(unmaskedWebglRenderer(gl)).toBeNull();
  });
});

describe("surfaceWebglDetail", () => {
  it("returns null when the system isn't compute-shaped, regardless of support or block", () => {
    expect(
      surfaceWebglDetail({
        computeShaped: false,
        supported: false,
        block: "failed",
      }),
    ).toBeNull();
  });

  it("returns 'compute unavailable' when WebGPU isn't supported at all", () => {
    expect(
      surfaceWebglDetail({
        computeShaped: true,
        supported: false,
        block: null,
      }),
    ).toBe("compute unavailable");
  });

  it("returns 'compute unavailable' when the session's block is 'unavailable', even though supported is true", () => {
    expect(
      surfaceWebglDetail({
        computeShaped: true,
        supported: true,
        block: "unavailable",
      }),
    ).toBe("compute unavailable");
  });

  it("returns 'compute failed' when the session's block is 'failed'", () => {
    expect(
      surfaceWebglDetail({
        computeShaped: true,
        supported: true,
        block: "failed",
      }),
    ).toBe("compute failed");
  });

  it("returns null when block is 'flag' (the user's own ?surfacegl escape hatch)", () => {
    expect(
      surfaceWebglDetail({
        computeShaped: true,
        supported: true,
        block: "flag",
      }),
    ).toBeNull();
  });

  it("returns null when supported and there is no block to explain", () => {
    expect(
      surfaceWebglDetail({ computeShaped: true, supported: true, block: null }),
    ).toBeNull();
  });
});

describe("softwareWarningText", () => {
  it("pins the exact webgl warning string", () => {
    expect(softwareWarningText("webgl", "SwiftShader")).toBe(
      "Software WebGL renderer — SwiftShader. The browser is not using the GPU, so renders run 10–50× slower; check its GPU settings (e.g. chrome://gpu).",
    );
  });

  it("pins the exact webgpu warning string", () => {
    expect(softwareWarningText("webgpu", "google swiftshader (software)")).toBe(
      "Software WebGPU adapter — google swiftshader (software). Surface compute is rasterizing on the CPU instead of the GPU.",
    );
  });
});
