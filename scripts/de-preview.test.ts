import { createHash } from "node:crypto";
import {
  PREVIEW_EXHAUSTED,
  PREVIEW_MISS,
  renderPreview,
  type PreviewScene,
} from "./de-preview";

// Frozen from the shared renderer before adding linear lighting and ray
// integration. Existing measurement sheets must retain their original images,
// including the encoded finish callback and exhausted/missed rays.
const sphere: PreviewScene["de"] = (p) => Math.hypot(...p) - 0.7;
const base: PreviewScene = {
  de: sphere,
  boundingRadius: 1,
  stepScale: 1,
  collect: true,
};

describe("shared preview legacy images", () => {
  it.each([
    {
      name: "fixed shading and fog",
      scene: base,
      hash: "c1596875a882a2be8c49223d637efe05a8e17ed1e7e9c1818b086cf5a8d4aeeb",
      hits: 360,
      exhausted: 0,
    },
    {
      name: "encoded finish callback and fog",
      scene: {
        ...base,
        shade: (h) => [
          0.35 + 0.2 * h.n[0],
          0.25 + 0.15 * h.n[1],
          0.2 + 0.1 * h.n[2],
        ],
      } satisfies PreviewScene,
      hash: "e51b5f073f873a1c271ded2115ba5167a540d8f45fc3dc865d00f772f69f7a60",
      hits: 360,
      exhausted: 0,
    },
    {
      name: "exhausted rays",
      scene: { ...base, de: () => 0.05, maxSteps: 2 },
      hash: "a55b2a4ed2133c7b82f1bee5fee615ce37ec2f6a63b708111686901ef1578114",
      hits: 0,
      exhausted: 716,
    },
    {
      name: "background rays",
      scene: { ...base, de: () => 5 },
      hash: "7eff1cfc632e1b1b081992a5af0c9ebdbdf61f79e421c813b6e5fedfa5b45da2",
      hits: 0,
      exhausted: 0,
    },
  ])("preserves $name", ({ scene, hash, hits, exhausted }) => {
    const panel = renderPreview(scene, 40);
    expect(
      createHash("sha256")
        .update(panel.rgb)
        .update(panel.status!)
        .digest("hex"),
    ).toBe(hash);
    expect(panel.hits).toBe(hits);
    expect(panel.exhausted).toBe(exhausted);
  });
});

describe("shared preview linear ray hooks", () => {
  it("integrates light on rays that miss the geometry's bounding sphere", () => {
    let backgroundRays = 0;
    const panel = renderPreview(
      {
        ...base,
        de: () => 5,
        rayLinear: (ray) => {
          expect(ray.status).toBe(PREVIEW_MISS);
          expect(ray.distance).toBe(Infinity);
          backgroundRays++;
          return [0.25, 0.0625, 0];
        },
      },
      20,
    );
    expect(backgroundRays).toBe(400);
    expect(panel.evals).toBeLessThan(backgroundRays);
    const color = [0.25, 0.0625, 0].map((v) =>
      Math.round(255 * Math.pow(v, 1 / 2.2)),
    );
    for (let i = 0; i < panel.rgb.length; i += 3) {
      expect(Array.from(panel.rgb.subarray(i, i + 3))).toEqual(color);
    }
  });

  it("exposes exhaustion at the traced distance without certifying the remainder", () => {
    let exhausted = 0;
    const panel = renderPreview(
      {
        ...base,
        de: () => 0.2,
        maxSteps: 2,
        rayLinear: (ray) => {
          if (ray.status === PREVIEW_EXHAUSTED) {
            exhausted++;
            expect(Number.isFinite(ray.distance)).toBe(true);
            expect(ray.distance).toBeGreaterThan(0);
            expect(ray.linear).toEqual([0, 0, 0]);
          }
          return ray.linear;
        },
      },
      20,
    );
    expect(exhausted).toBeGreaterThan(0);
    expect(exhausted).toBe(panel.exhausted);
  });

  it("retains an explicit geometric far cap on a true miss for medium integration", () => {
    let rays = 0;
    const panel = renderPreview(
      {
        ...base,
        de: () => 5,
        marchInterval: () => [0, 3],
        rayLinear: (ray) => {
          expect(ray.status).toBe(PREVIEW_MISS);
          expect(ray.distance).toBe(3);
          rays++;
          return ray.linear;
        },
      },
      20,
    );
    expect(rays).toBe(400);
    expect(panel.hits).toBe(0);
    expect(panel.exhausted).toBe(0);
  });

  it("refuses invalid primary geometry instead of illuminating it as a clear ray", () => {
    expect(() =>
      renderPreview(
        { ...base, de: () => NaN, rayLinear: (ray) => ray.linear },
        20,
      ),
    ).toThrow();
  });

  it("preserves full-image rays, shading and pixel seeds across capture bands", () => {
    const scene: PreviewScene = {
      ...base,
      fog: false,
      shadeLinear: (hit) => [Math.abs(hit.n[0]), 0.3, 0.15],
      rayLinear: (ray) => [
        ray.linear[0],
        ray.linear[1] * ((ray.px + 0.5) / ray.imageWidth),
        ray.linear[2] * ((ray.py + 0.5) / ray.imageHeight),
      ],
    };
    const full = renderPreview(scene, 40);
    const rgb = new Uint8Array(full.rgb.length);
    const status = new Uint8Array(full.status!.length);
    for (const [y, height] of [
      [0, 7],
      [7, 19],
      [26, 14],
    ]) {
      const band = renderPreview(scene, 40, { x: 0, y, width: 40, height });
      rgb.set(band.rgb, y * 40 * 3);
      status.set(band.status!, y * 40);
    }
    expect(rgb).toEqual(full.rgb);
    expect(status).toEqual(full.status);
  });
});
