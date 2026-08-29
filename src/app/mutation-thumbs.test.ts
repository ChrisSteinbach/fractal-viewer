import { mengerSponge, sierpinskiTetrahedron } from "../fractal/presets";
import { mulberry32 } from "../fractal/rng";
import type { HybridSchedule, Transform } from "../fractal/types";
import type { MorphSystem } from "../fractal/morph";
import {
  MUTATION_THUMBNAIL_PREVIEW_COVERAGE,
  renderSystemThumb,
} from "./mutation-thumbs";

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

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let o = 0; o < a.length; o += 4) {
    if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) {
      count++;
    }
  }
  return count;
}

function scheduledPostWord(): HybridSchedule {
  return {
    depth: 2,
    transforms: [
      {
        id: 100,
        position: [0.35, -0.1, 0.2],
        rotation: [0.1, -0.2, 0.15],
        scale: [0.72, 0.66, 0.7],
        weight: 2,
      },
      {
        id: 101,
        position: [-0.4, 0.25, -0.15],
        rotation: [-0.15, 0.25, -0.1],
        scale: [0.63, 0.7, 0.68],
      },
    ],
  };
}

describe("renderSystemThumb", () => {
  it("returns an opaque size*size RGBA buffer", () => {
    const size = 32;
    const system: MorphSystem = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
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
      symmetry: { order: 1, plane: "xz" },
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
      symmetry: { order: 1, plane: "xz" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(3));

    expect(countNonBackground(buffer, size)).toBeGreaterThan(100);
  });

  it("renders visibly different images for different systems", () => {
    const size = 48;
    const a: MorphSystem = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    };
    const b: MorphSystem = {
      transforms: mengerSponge(),
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    };

    const bufferA = renderSystemThumb(a, size, mulberry32(11));
    const bufferB = renderSystemThumb(b, size, mulberry32(11));

    expect(differingPixels(bufferA, bufferB)).toBeGreaterThan(200);
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
      symmetry: { order: 1, plane: "xz" },
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
      symmetry: { order: 1, plane: "xz" },
    };

    const buffer = renderSystemThumb(system, size, mulberry32(9));

    expect(buffer.length).toBe(size * size * 4);
    expect(countNonBackground(buffer, size)).toBeGreaterThan(0);
  });

  it("routes a flat base with only a non-flat final lens through the 4D preview", () => {
    const size = 48;
    const transforms = sierpinskiTetrahedron();
    const plain: MorphSystem = {
      transforms,
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    };
    // Its 3D affine is identity. Only the xw rotation and w translation can
    // change the image, so the old transforms-only routing produced the
    // exact plain thumbnail and this regression sees that wrong branch.
    const finalLens4D: MorphSystem = {
      ...plain,
      finalTransform: {
        id: 99,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        w: { position: 0.65, rotation: { xw: Math.PI / 2 } },
      },
    };

    const plainBuffer = renderSystemThumb(plain, size, mulberry32(29));
    const lensedBuffer = renderSystemThumb(finalLens4D, size, mulberry32(29));

    expect(countNonBackground(lensedBuffer, size)).toBeGreaterThan(0);
    expect(differingPixels(plainBuffer, lensedBuffer)).toBeGreaterThan(200);
  });

  it.each([
    {
      dimension: "3D",
      system: {
        transforms: sierpinskiTetrahedron(),
        finalTransform: null,
        symmetry: { order: 1, plane: "xz" },
      } satisfies MorphSystem,
    },
    {
      dimension: "4D",
      system: {
        transforms: sierpinskiTetrahedron().map((transform, index) =>
          index === 0
            ? {
                ...transform,
                w: { position: 0.35, rotation: { yw: 0.4 } },
              }
            : transform,
        ),
        finalTransform: null,
        symmetry: { order: 1, plane: "xz" },
      } satisfies MorphSystem,
    },
  ])(
    "renders a scheduled $dimension scene deterministically for a fixed seed",
    ({ system }) => {
      const size = 40;
      const schedule = scheduledPostWord();

      const first = renderSystemThumb(system, size, mulberry32(37), schedule);
      const second = renderSystemThumb(system, size, mulberry32(37), schedule);
      const unscheduled = renderSystemThumb(system, size, mulberry32(37));

      expect(Array.from(first)).toEqual(Array.from(second));
      expect(countNonBackground(first, size)).toBeGreaterThan(0);
      expect(differingPixels(first, unscheduled)).toBeGreaterThan(100);
    },
  );

  it("declares and preserves the scatter preview's renderer-scoped appearance limits", () => {
    expect(MUTATION_THUMBNAIL_PREVIEW_COVERAGE.notRepresented).toEqual([
      "transform.colorSpeed",
      "transform.finish",
      "transform.surfacePattern",
    ]);
    expect(MUTATION_THUMBNAIL_PREVIEW_COVERAGE.disclosure).toContain(
      "visible only after loading",
    );

    const size = 40;
    const transforms = sierpinskiTetrahedron();
    const plain: MorphSystem = {
      transforms,
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    };
    const rendererScopedAppearance: MorphSystem = {
      ...plain,
      transforms: transforms.map((transform, index) =>
        index === 0
          ? {
              ...transform,
              colorSpeed: 0.9,
              finish: { metalness: 0.8, reflect: 0.4 },
              surfacePattern: {
                kind: "wood",
                axis: "y",
                scale: 5,
                strength: 0.75,
              },
            }
          : transform,
      ),
    };

    const plainBuffer = renderSystemThumb(plain, size, mulberry32(41));
    const appearanceBuffer = renderSystemThumb(
      rendererScopedAppearance,
      size,
      mulberry32(41),
    );

    expect(Array.from(appearanceBuffer)).toEqual(Array.from(plainBuffer));
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
      symmetry: { order: 1, plane: "xz" },
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

  it("carries a w-plane kaleidoscope into the 4D thumbnail render: a flat system with symmetry { order: 4, plane: zw } — which routes to the 4D branch purely because of the symmetry — renders differently than the same system with symmetry off", () => {
    const size = 48;
    const transforms = sierpinskiTetrahedron();
    const plain: MorphSystem = {
      transforms,
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    };
    const kaleidoscope: MorphSystem = {
      transforms,
      finalTransform: null,
      symmetry: { order: 4, plane: "zw" },
    };

    const plainBuffer = renderSystemThumb(plain, size, mulberry32(23));
    const kaleidoscopeBuffer = renderSystemThumb(
      kaleidoscope,
      size,
      mulberry32(23),
    );

    expect(differingPixels(plainBuffer, kaleidoscopeBuffer)).toBeGreaterThan(
      200,
    );
  });

  it("returns the plain background for a system with no transforms", () => {
    const size = 16;
    const system: MorphSystem = {
      transforms: [],
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
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
