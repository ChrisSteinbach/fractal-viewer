import { mengerSponge, sierpinskiTetrahedron } from "../fractal/presets";
import { mulberry32 } from "../fractal/rng";
import type { Transform } from "../fractal/types";
import type { MorphSystem } from "../fractal/morph";
import { renderSystemThumb } from "./mutation-thumbs";

/** The module's near-black empty-cell background — mirrored here rather than
 * imported, since only `renderSystemThumb` is public. */
const BG: readonly [number, number, number] = [10, 10, 14];

function isBackground(buffer: Uint8ClampedArray, pixel: number): boolean {
  const o = pixel * 4;
  return (
    buffer[o] === BG[0] && buffer[o + 1] === BG[1] && buffer[o + 2] === BG[2]
  );
}

function countNonBackground(buffer: Uint8ClampedArray, size: number): number {
  let count = 0;
  for (let p = 0; p < size * size; p++) {
    if (!isBackground(buffer, p)) count++;
  }
  return count;
}

describe("renderSystemThumb", () => {
  it("returns an opaque size*size RGBA buffer", () => {
    const size = 32;
    const system: MorphSystem = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(1));

    expect(buffer.length).toBe(size * size * 4);
    for (let p = 0; p < size * size; p++) {
      expect(buffer[p * 4 + 3]).toBe(255);
    }
  });

  it("is deterministic: the same system and seed produce byte-identical buffers", () => {
    const size = 40;
    const system: MorphSystem = {
      transforms: mengerSponge(),
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const first = renderSystemThumb(system, size, mulberry32(7));
    const second = renderSystemThumb(system, size, mulberry32(7));

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("draws a nontrivial number of pixels that differ from the background", () => {
    const size = 48;
    const system: MorphSystem = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(3));

    expect(countNonBackground(buffer, size)).toBeGreaterThan(100);
  });

  it("renders visibly different images for different systems", () => {
    const size = 48;
    const a: MorphSystem = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };
    const b: MorphSystem = {
      transforms: mengerSponge(),
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const bufferA = renderSystemThumb(a, size, mulberry32(11));
    const bufferB = renderSystemThumb(b, size, mulberry32(11));

    let differingPixels = 0;
    for (let p = 0; p < size * size; p++) {
      const o = p * 4;
      if (
        bufferA[o] !== bufferB[o] ||
        bufferA[o + 1] !== bufferB[o + 1] ||
        bufferA[o + 2] !== bufferB[o + 2]
      ) {
        differingPixels++;
      }
    }

    expect(differingPixels).toBeGreaterThan(200);
  });

  it("colors a single-transform system's points with that transform's hue (red-dominant, per transformColors(1)[0])", () => {
    const size = 64;
    const system: MorphSystem = {
      transforms: [
        {
          id: 0,
          position: [0.3, -0.2, 0.1],
          rotation: [0.4, 0.1, -0.2],
          scale: [0.5, 0.5, 0.5],
        },
      ],
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(5));

    let checked = 0;
    for (let p = 0; p < size * size; p++) {
      if (isBackground(buffer, p)) continue;
      checked++;
      const o = p * 4;
      // transformColors(1)[0] is hue 0 (red-dominant, G === B): every hit
      // pixel's red channel must be at least as large as green/blue,
      // whether or not the pixel has saturated to white under heavy
      // overlap (>= rather than > covers that clipped case too).
      expect(buffer[o]).toBeGreaterThanOrEqual(buffer[o + 1]);
      expect(buffer[o]).toBeGreaterThanOrEqual(buffer[o + 2]);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("renders a 4D system (a map with a w extension) without throwing, and draws something", () => {
    const size = 48;
    const base = sierpinskiTetrahedron();
    const transforms: Transform[] = base.map((t, i) =>
      i === 0 ? { ...t, w: { position: 0.4 } } : t,
    );
    const system: MorphSystem = {
      transforms,
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(9));

    expect(buffer.length).toBe(size * size * 4);
    expect(countNonBackground(buffer, size)).toBeGreaterThan(0);
  });

  it("stays finite for a system whose map collapses to a single point", () => {
    const size = 32;
    const system: MorphSystem = {
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.01, 0.01, 0.01],
        },
      ],
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(13));

    expect(buffer.length).toBe(size * size * 4);
    for (let i = 0; i < buffer.length; i++) {
      expect(Number.isFinite(buffer[i])).toBe(true);
    }
    for (let p = 0; p < size * size; p++) {
      expect(buffer[p * 4 + 3]).toBe(255);
    }
  });

  it("returns the plain background for a system with no transforms", () => {
    const size = 16;
    const system: MorphSystem = {
      transforms: [],
      finalTransform: null,
      symmetry: { order: 1, axis: "y" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(2));

    for (let p = 0; p < size * size; p++) {
      const o = p * 4;
      expect([buffer[o], buffer[o + 1], buffer[o + 2], buffer[o + 3]]).toEqual([
        ...BG,
        255,
      ]);
    }
  });
});
