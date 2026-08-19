import {
  BACKGROUND_SHAPES,
  BACKGROUND_SHAPE_GLSL,
  BACKGROUND_SHAPE_WGSL,
  backgroundColorAt,
  backgroundImageUv,
  backgroundMeanColor,
  backgroundShapeCode,
  backgroundShapeSource,
  backgroundShapeT,
} from "./background-shape";
import type { BackgroundStops } from "./background-shape";

describe("backgroundImageUv", () => {
  it("reproduces (py + 0.5) / h exactly at zero offset for a spread of rows", () => {
    const h = 480;
    const w = 640;
    for (const py of [0, 1, 100, 239, 240, 479]) {
      const [, v] = backgroundImageUv(0, py, [0, 0], [w, h]);
      expect(v).toBe((py + 0.5) / h);
    }
  });

  it("reproduces (px + 0.5) / w exactly at zero offset for a spread of columns", () => {
    const w = 800;
    const h = 600;
    for (const px of [0, 1, 300, 799]) {
      const [u] = backgroundImageUv(px, 0, [0, 0], [w, h]);
      expect(u).toBe((px + 0.5) / w);
    }
  });
});

describe("backgroundImageUv band identity", () => {
  it("agrees bit-for-bit between a band trace and the equivalent full-image row", () => {
    const fullHeight = 1024;
    const fullWidth = 512;
    const bands = [
      { bandBottom: 0, rows: [0, 1, 50] },
      { bandBottom: 300, rows: [0, 1, 100, 199] },
      { bandBottom: 1000, rows: [0, 23] },
    ];
    for (const { bandBottom, rows } of bands) {
      for (const py of rows) {
        const banded = backgroundImageUv(
          7,
          py,
          [0, bandBottom],
          [fullWidth, fullHeight],
        );
        const fullImage = backgroundImageUv(
          7,
          bandBottom + py,
          [0, 0],
          [fullWidth, fullHeight],
        );
        expect(banded[1]).toBe(fullImage[1]);
        expect(banded[0]).toBe(fullImage[0]);
      }
    }
  });
});

describe("backgroundShapeT", () => {
  it("returns v unchanged for linear when v is inside [0, 1]", () => {
    expect(backgroundShapeT(0.3, 0.0, { kind: "linear" })).toBe(0);
    expect(backgroundShapeT(0.3, 0.5, { kind: "linear" })).toBe(0.5);
    expect(backgroundShapeT(0.3, 1.0, { kind: "linear" })).toBe(1);
  });

  it("clamps v below 0 to 0 for linear", () => {
    expect(backgroundShapeT(0.1, -0.4, { kind: "linear" })).toBe(0);
  });

  it("clamps v above 1 to 1 for linear", () => {
    expect(backgroundShapeT(0.1, 1.7, { kind: "linear" })).toBe(1);
  });

  it("ignores u entirely for linear", () => {
    const a = backgroundShapeT(-500, 0.25, { kind: "linear" });
    const b = backgroundShapeT(500, 0.25, { kind: "linear" });
    expect(a).toBe(b);
  });
});

describe("backgroundColorAt", () => {
  it("reproduces bottom + (top - bottom) * t per channel, pinned against hand computation", () => {
    const stops: BackgroundStops = {
      top: [0.8, 0.4, 0.2],
      bottom: [0.1, 0.3, 0.9],
    };
    const [r, g, b] = backgroundColorAt(0, 0.25, stops, { kind: "linear" });
    expect(r).toBe(0.1 + (0.8 - 0.1) * 0.25);
    expect(g).toBe(0.3 + (0.4 - 0.3) * 0.25);
    expect(b).toBe(0.9 + (0.2 - 0.9) * 0.25);
  });

  it("returns exactly the bottom stop at v = 0", () => {
    const stops: BackgroundStops = {
      top: [1, 1, 1],
      bottom: [0.05, 0.1, 0.15],
    };
    expect(backgroundColorAt(0, 0, stops, { kind: "linear" })).toEqual(
      stops.bottom,
    );
  });

  it("returns exactly the top stop at v = 1", () => {
    const stops: BackgroundStops = {
      top: [0.6, 0.7, 0.8],
      bottom: [0, 0, 0],
    };
    expect(backgroundColorAt(0, 1, stops, { kind: "linear" })).toEqual(
      stops.top,
    );
  });
});

describe("backgroundMeanColor", () => {
  it("equals (top + bottom) / 2 per channel for linear, matching backdropMidpoint", () => {
    const stops: BackgroundStops = {
      top: [0.9, 0.4, 0.1],
      bottom: [0.1, 0.6, 0.3],
    };
    const [r, g, b] = backgroundMeanColor(stops, { kind: "linear" });
    expect(r).toBe((0.9 + 0.1) / 2);
    expect(g).toBe((0.4 + 0.6) / 2);
    expect(b).toBe((0.1 + 0.3) / 2);
  });
});

describe("backgroundShapeSource", () => {
  it("declares the GLSL signature float backgroundShapeT(vec2 p)", () => {
    const source = backgroundShapeSource(BACKGROUND_SHAPE_GLSL);
    expect(source).toContain("float backgroundShapeT(vec2 p)");
  });

  it("declares the WGSL signature fn backgroundShapeT(p: vec2f) -> f32", () => {
    const source = backgroundShapeSource(BACKGROUND_SHAPE_WGSL);
    expect(source).toContain("fn backgroundShapeT(p: vec2f) -> f32");
  });

  it("emits character-for-character identical function bodies in both dialects", () => {
    const bodyOf = (source: string): string => {
      const start = source.indexOf("{");
      const end = source.lastIndexOf("}");
      return source.slice(start + 1, end);
    };
    const glslBody = bodyOf(backgroundShapeSource(BACKGROUND_SHAPE_GLSL));
    const wgslBody = bodyOf(backgroundShapeSource(BACKGROUND_SHAPE_WGSL));
    expect(glslBody).toBe(wgslBody);
    expect(glslBody.length).toBeGreaterThan(0);
  });
});

describe("BACKGROUND_SHAPES / backgroundShapeCode", () => {
  it("round-trips every shape through its numeric code as the list index", () => {
    BACKGROUND_SHAPES.forEach((shape, index) => {
      expect(backgroundShapeCode(shape)).toBe(index);
    });
  });

  it("assigns linear code 0", () => {
    expect(backgroundShapeCode("linear")).toBe(0);
  });
});
