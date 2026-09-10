import {
  createCinematicLighting,
  traceLightSegment,
  type CinematicDiskLight,
} from "./cinematic-lighting";
import {
  renderPreview,
  type PreviewLinearHit,
  type PreviewScene,
} from "./de-preview";

const hit: PreviewLinearHit = {
  px: 3,
  py: 5,
  imageWidth: 40,
  imageHeight: 40,
  epsilon: 0.001,
  p: [0, 0, 0],
  n: [0, 1, 0],
  rd: [0, -1, 0],
  t: 2,
  light: [0, 1, 0],
  shadow: 1,
  ao: 1,
  steps: 1,
  bg: [0, 0, 0],
};

describe("finite DE light visibility", () => {
  const options = { epsilon: 1e-4, maxSteps: 256, stepScale: 1 };

  it("ignores an obstacle beyond the emitter", () => {
    const result = traceLightSegment(
      (p) => Math.hypot(p[0], p[1], p[2] - 3) - 0.2,
      [0, 0, 0],
      [0, 0, 2],
      options,
    );
    expect(result.status).toBe("visible");
  });

  it("opens visibility through a geometric aperture in the same wall", () => {
    const wall = (p: [number, number, number]) => Math.abs(p[2] - 1) - 0.05;
    const closed = traceLightSegment(wall, [0, 0, 0], [0, 0, 2], options);
    const open = traceLightSegment(
      (p) => Math.max(wall(p), 0.3 - Math.hypot(p[0], p[1])),
      [0, 0, 0],
      [0, 0, 2],
      options,
    );
    expect(closed.status).toBe("occluded");
    expect(open.status).toBe("visible");
  });

  it("does not invent visibility when its work budget runs out", () => {
    const result = traceLightSegment(() => 0.002, [0, 0, 0], [0, 0, 2], {
      ...options,
      maxSteps: 2,
    });
    expect(result.status).toBe("exhausted");
    expect(result.evaluations).toBe(2);
  });

  it("distinguishes an invalid distance query from visible space", () => {
    const result = traceLightSegment(() => NaN, [0, 0, 0], [0, 0, 2], options);
    expect(result.status).toBe("invalid");
  });
});

describe("the complete reference lighting model", () => {
  const light: CinematicDiskLight = {
    position: [0, 2, 0],
    normal: [0, -1, 0],
    radius: 0.8,
    color: [1, 1, 1],
    intensity: 6,
  };
  it("converges to the analytic disk irradiance without scaling brightness by sample count", () => {
    for (const radius of [0.2, 0.8]) {
      const expected = 6 / (Math.PI * Math.PI * (4 + radius * radius));
      for (const samples of [64, 512]) {
        const lighting = createCinematicLighting({
          de: () => 10,
          stepScale: 1,
          lights: [{ ...light, radius }],
          surfaceSamples: samples,
          material: { albedo: [1, 1, 1], ambient: [0, 0, 0], specular: 0 },
        });
        const actual = lighting.shadeLinear(hit);
        expect(Math.abs(actual[0] / expected - 1)).toBeLessThan(0.01);
        expect(actual[1]).toBe(actual[0]);
        expect(actual[2]).toBe(actual[0]);
      }
    }
  });

  it("changes surface illumination when a light moves behind an occluder", () => {
    const poses: CinematicDiskLight[] = [
      { ...light, radius: 0.05 },
      { ...light, position: [2, 0.2, 0], normal: [-2, -0.2, 0], radius: 0.05 },
    ];
    const surfaces = poses.map((moved) =>
      createCinematicLighting({
        de: (p) => Math.abs(p[1] - 1) - 0.05,
        stepScale: 1,
        lights: [moved],
        material: { ambient: [0, 0, 0], specular: 0 },
      }).shadeLinear(hit),
    );
    expect(surfaces[0]).toEqual([0, 0, 0]);
    expect(surfaces[1][0]).toBeGreaterThan(0.001);
  });

  it("opens surface illumination through a geometric gap in the occluder", () => {
    const wall = (p: [number, number, number]) => Math.abs(p[1] - 1) - 0.05;
    const aperture = (p: [number, number, number]) =>
      Math.max(wall(p), 0.3 - Math.hypot(p[0], p[2]));
    const colors = [wall, aperture].map((de) => {
      const lighting = createCinematicLighting({
        de,
        stepScale: 1,
        lights: [{ ...light, radius: 0.05 }],
        material: { ambient: [0, 0, 0], specular: 0 },
      });
      return { surface: lighting.shadeLinear(hit), stats: lighting.stats };
    });
    expect(colors[0].surface).toEqual([0, 0, 0]);
    expect(colors[1].surface[0]).toBeGreaterThan(0.01);
    expect(colors[1].stats.surfaceVisibility.exhausted).toBe(0);
  });

  it("reassembles independently rendered bands byte for byte", () => {
    const makeScene = (): PreviewScene => {
      const de = (p: [number, number, number]) => Math.hypot(...p) - 0.65;
      const lighting = createCinematicLighting({
        de,
        stepScale: 1,
        lights: [light],
        surfaceSamples: 4,
      });
      return {
        de,
        boundingRadius: 1,
        stepScale: 1,
        fog: false,
        ao: false,
        shadow: false,
        ...lighting,
      };
    };
    const size = 24;
    const full = renderPreview(makeScene(), size);
    const assembled = new Uint8Array(full.rgb.length);
    for (const [y, height] of [
      [0, 5],
      [5, 11],
      [16, 8],
    ]) {
      const band = renderPreview(makeScene(), size, {
        x: 0,
        y,
        width: size,
        height,
      });
      assembled.set(band.rgb, y * size * 3);
    }
    expect(assembled).toEqual(full.rgb);
  });
});
