/**
 * Byte-identity tests for `de-preview-parallel.ts` — the worker-scheduled
 * renderer over `de-preview.ts`'s serial marcher.
 *
 * The contract being pinned: a `renderPreviewParallel` call is byte-identical
 * to the serial `renderPreview` of the same scene — rgb, PNG bytes, the
 * per-pixel collect arrays and the integer counters — whether it rendered
 * in-thread (below the threshold), tiled across workers, or through a scene
 * closure the factory rebuilt inside the worker. `ms` is a timing, not a
 * byte, and is deliberately never compared. The scenes live in
 * `de-preview-parallel-scenes.ts`, the factory module the workers bundle;
 * every helper here is inline (DAMP).
 */

import type { ParallelTestSceneSpec } from "./de-preview-parallel-scenes";
import { parallelTestScene } from "./de-preview-parallel-scenes";
import {
  PARALLEL_MIN_PIXELS,
  disposePreviewWorkers,
  planParallelPreview,
  renderPreviewParallel,
} from "./de-preview-parallel";
import { encodePng, renderPreview } from "./de-preview";

const factory = {
  module: "./de-preview-parallel-scenes",
  factory: "parallelTestScene",
} as const;

afterAll(async () => {
  await disposePreviewWorkers();
});

describe("parallel preview parity", () => {
  it.each([
    { scene: "sphere" },
    { scene: "mandelbox" },
  ] satisfies ParallelTestSceneSpec[])(
    "renders a full $scene panel byte-identically across workers",
    async ({ scene }) => {
      const size = 96;
      const serial = renderPreview(parallelTestScene({ scene }), size);
      const parallel = await renderPreviewParallel(
        { ...factory, args: [{ scene }] },
        size,
        undefined,
        { minPixels: 0 },
      );
      expect(parallel.rgb).toEqual(serial.rgb);
      // The acceptance is PNG bytes, not eyeballing.
      expect(encodePng(size, size, parallel.rgb)).toEqual(
        encodePng(size, size, serial.rgb),
      );
      if (scene === "mandelbox") {
        expect(parallel.status).toEqual(serial.status);
        expect(parallel.hitPos).toEqual(serial.hitPos);
        expect(parallel.stepCount).toEqual(serial.stepCount);
        expect(parallel.hits).toBe(serial.hits);
        expect(parallel.evals).toBe(serial.evals);
        expect(parallel.steps).toBe(serial.steps);
        expect(parallel.exhausted).toBe(serial.exhausted);
      }
    },
  );

  it("renders a rebuilt closure's ray hook byte-identically across workers", async () => {
    const size = 64;
    const serial = renderPreview(parallelTestScene({ scene: "ray" }), size);
    const parallel = await renderPreviewParallel(
      { ...factory, args: [{ scene: "ray" }] },
      size,
      undefined,
      { minPixels: 0 },
    );
    expect(parallel.rgb).toEqual(serial.rgb);
    expect(encodePng(size, size, parallel.rgb)).toEqual(
      encodePng(size, size, serial.rgb),
    );
  });

  it("stitches a capture region byte-identically across workers", async () => {
    const size = 96;
    const region = { x: 16, y: 24, width: 64, height: 48 };
    const serial = renderPreview(
      parallelTestScene({ scene: "mandelbox" }),
      size,
      region,
    );
    const parallel = await renderPreviewParallel(
      { ...factory, args: [{ scene: "mandelbox" }] },
      size,
      region,
      { minPixels: 0 },
    );
    expect(parallel.rgb).toEqual(serial.rgb);
    expect(parallel.status).toEqual(serial.status);
  });

  it("renders two concurrent factory specs byte-identically through one pool", async () => {
    const size = 96;
    const sphereSerial = renderPreview(
      parallelTestScene({ scene: "sphere" }),
      size,
    );
    const mandelboxSerial = renderPreview(
      parallelTestScene({ scene: "mandelbox" }),
      size,
    );
    const [sphere, mandelbox] = await Promise.all([
      renderPreviewParallel(
        { ...factory, args: [{ scene: "sphere" }] },
        size,
        undefined,
        { minPixels: 0 },
      ),
      renderPreviewParallel(
        { ...factory, args: [{ scene: "mandelbox" }] },
        size,
        undefined,
        { minPixels: 0 },
      ),
    ]);
    expect(sphere.rgb).toEqual(sphereSerial.rgb);
    expect(mandelbox.rgb).toEqual(mandelboxSerial.rgb);
  });
});

describe("parallel preview planning", () => {
  it("plans by pixel count against the threshold", () => {
    expect(planParallelPreview(PARALLEL_MIN_PIXELS)).toBe("parallel");
    expect(planParallelPreview(PARALLEL_MIN_PIXELS - 1)).toBe("serial");
    expect(planParallelPreview(1, { minPixels: 0 })).toBe("parallel");
    expect(
      planParallelPreview(PARALLEL_MIN_PIXELS, { minPixels: 1 << 20 }),
    ).toBe("serial");
  });

  it("DE_PREVIEW_PARALLEL=off forces the serial plan above the threshold", () => {
    process.env.DE_PREVIEW_PARALLEL = "off";
    try {
      expect(planParallelPreview(PARALLEL_MIN_PIXELS)).toBe("serial");
    } finally {
      delete process.env.DE_PREVIEW_PARALLEL;
    }
  });
});

describe("parallel preview refusals", () => {
  it("propagates a factory build failure from the worker", async () => {
    await expect(
      renderPreviewParallel(
        { ...factory, args: [{ scene: "throwing" }] },
        64,
        undefined,
        { minPixels: 0 },
      ),
    ).rejects.toThrow("factory boom");
  });

  it("refuses non-cloneable factory args before any work is dispatched", async () => {
    await expect(
      renderPreviewParallel(
        { ...factory, args: [{ scene: "sphere" }, () => 1] },
        64,
      ),
    ).rejects.toThrow();
  });

  it("refuses an out-of-bounds region up front", async () => {
    await expect(
      renderPreviewParallel({ ...factory, args: [{ scene: "sphere" }] }, 64, {
        x: -1,
        y: 0,
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow("Preview region must lie inside the full image");
  });
});

describe("parallel preview fallback", () => {
  it("renders below the threshold in-thread through the same factory", async () => {
    const size = 48;
    const serial = renderPreview(parallelTestScene({ scene: "sphere" }), size);
    const fallback = await renderPreviewParallel(
      { ...factory, args: [{ scene: "sphere" }] },
      size,
    );
    expect(fallback.rgb).toEqual(serial.rgb);
  });
});
