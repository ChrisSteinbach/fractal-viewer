import { runChaosGame4 } from "./chaos-game-4d";
import {
  doubleRotationSpiral,
  pentatopeGasket,
  pentatopeWireframe,
} from "./presets4";
import { mulberry32 } from "./rng";
import type { Vec4 } from "./types";

function dot4(a: Vec4, b: Vec4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

describe("pentatopeGasket", () => {
  it("has five maps, each a half-scale contraction", () => {
    const maps = pentatopeGasket();
    expect(maps).toHaveLength(5);
    for (const m of maps) expect(m.scale).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("places its fixed points on a unit regular 4-simplex (|v| = 1, pairwise dot −1/4)", () => {
    // Each map's fixed point is v = 2·position (scale ½ ⇒ x* = 2·position).
    const vertices = pentatopeGasket().map((m): Vec4 => [
      m.position[0] * 2,
      m.position[1] * 2,
      m.position[2] * 2,
      m.position[3] * 2,
    ]);
    for (const v of vertices) {
      expect(Math.sqrt(dot4(v, v))).toBeCloseTo(1, 12);
    }
    for (let i = 0; i < vertices.length; i++) {
      for (let j = i + 1; j < vertices.length; j++) {
        expect(dot4(vertices[i], vertices[j])).toBeCloseTo(-0.25, 12);
      }
    }
  });
});

describe("pentatopeWireframe", () => {
  it("has the 5-cell's ten edges, all of the regular simplex's edge length", () => {
    const edges = pentatopeWireframe();
    expect(edges).toHaveLength(10);
    // Unit-circumradius regular 4-simplex edge: |a − b|² = 2 − 2·(a·b) = 2.5.
    for (const [a, b] of edges) {
      const d: Vec4 = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
      expect(Math.sqrt(dot4(d, d))).toBeCloseTo(Math.sqrt(2.5), 12);
    }
  });

  it("uses the same vertices the gasket's maps contract toward", () => {
    const fixed = pentatopeGasket().map((m) =>
      m.position.map((p) => p * 2).join(),
    );
    for (const [a, b] of pentatopeWireframe()) {
      expect(fixed).toContain(a.join());
      expect(fixed).toContain(b.join());
    }
  });
});

describe("doubleRotationSpiral", () => {
  it("has two contractive maps (every scale magnitude < 1)", () => {
    const maps = doubleRotationSpiral();
    expect(maps).toHaveLength(2);
    for (const m of maps) {
      for (const s of m.scale) expect(Math.abs(s)).toBeLessThan(1);
    }
  });

  it("fills all four dimensions, stays bounded, and carries visible w structure", () => {
    const result = runChaosGame4(doubleRotationSpiral(), 30000, mulberry32(4));
    const { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW } = result.bounds;
    // Genuinely 4D: every coordinate opens up, not collapsed to a lower flat.
    expect(maxX - minX).toBeGreaterThan(0.2);
    expect(maxY - minY).toBeGreaterThan(0.2);
    expect(maxZ - minZ).toBeGreaterThan(0.2);
    expect(maxW - minW).toBeGreaterThan(0.2);
    // Bounded (contractive maps never let it run away).
    expect(result.radius).toBeLessThan(3);
    // The double-rotation signature: the zw-plane spin pushes points well off
    // the w = 0 slice a 3D system could never leave.
    let farW = 0;
    for (const w of result.w) farW = Math.max(farW, Math.abs(w));
    expect(farW).toBeGreaterThan(0.15);
  });
});
