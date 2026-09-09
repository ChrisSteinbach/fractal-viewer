import {
  createCinematicLighting,
  henyeyGreenstein,
  homogeneousTransmittance,
  traceLightSegment,
  type CinematicDiskLight,
  type CinematicMedium,
} from "./cinematic-lighting";
import {
  PREVIEW_HIT,
  PREVIEW_MISS,
  renderPreview,
  type PreviewLinearHit,
  type PreviewRay,
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

const ray: PreviewRay = {
  px: 3,
  py: 5,
  imageWidth: 40,
  imageHeight: 40,
  origin: [0, 0, 3],
  rd: [0, 0, -1],
  distance: Infinity,
  status: PREVIEW_MISS,
  linear: [0, 0, 0],
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

describe("homogeneous single-scattering transport", () => {
  it("preserves Beer attenuation when the same path is split into intervals", () => {
    expect(homogeneousTransmittance(0, 3)).toBe(1);
    expect(homogeneousTransmittance(0.7, 0)).toBe(1);
    expect(homogeneousTransmittance(0.7, 1.7)).toBeCloseTo(
      Math.exp(-0.7 * 1.7),
      14,
    );
    expect(
      homogeneousTransmittance(0.7, 0.5) * homogeneousTransmittance(0.7, 1.2),
    ).toBeCloseTo(homogeneousTransmittance(0.7, 1.7), 14);
  });

  it("normalizes the phase function over the sphere and points forward for positive g", () => {
    const samples = 8192;
    for (const g of [-0.65, 0, 0.65]) {
      let integral = 0;
      for (let i = 0; i < samples; i++) {
        const cosine = -1 + (2 * (i + 0.5)) / samples;
        integral += henyeyGreenstein(cosine, g) * ((4 * Math.PI) / samples);
      }
      expect(integral).toBeCloseTo(1, 5);
    }
    expect(henyeyGreenstein(1, 0.65)).toBeGreaterThan(
      henyeyGreenstein(-1, 0.65),
    );
    expect(henyeyGreenstein(0.3, 0)).toBeCloseTo(1 / (4 * Math.PI), 14);
  });

  it("keeps a narrow forward or backward phase peak finite", () => {
    for (const g of [1 - 1e-9, -1 + 1e-9]) {
      const peak = henyeyGreenstein(Math.sign(g), g);
      expect(Number.isFinite(peak)).toBe(true);
      expect(peak).toBeGreaterThan(0);
    }
  });

  it.each([0, 0.5])(
    "matches the analytic axial scattering integral at g=%s",
    (g) => {
      // A nearly point-sized disk behind a spherical medium. Camera and light
      // attenuation sum to the same diameter at every point along this ray.
      // Integrating 1/(z+3)^2 from z=-1 to 1 gives 1/4, independently of the
      // reference renderer's stratified sampling and exponential cell weights.
      const density = 0.4;
      const flux = 3;
      const lighting = createCinematicLighting({
        de: () => 10,
        stepScale: 1,
        lights: [
          {
            position: [0, 0, -3],
            normal: [0, 0, 1],
            radius: 1e-6,
            color: [1, 0.5, 0.25],
            intensity: flux,
          },
        ],
        medium: {
          center: [0, 0, 0],
          radius: 1,
          density,
          tint: [1, 1, 1],
          anisotropy: g,
        },
        mediumSamples: 512,
      });
      const phaseRatio = (1 - g * g) / Math.pow(1 - g, 3);
      const expected =
        (density * Math.exp(-2 * density) * flux * phaseRatio) /
        (16 * Math.PI * Math.PI);
      const color = lighting.rayLinear(ray);
      expect(color[0]).toBeCloseTo(expected, 5);
      expect(color[1]).toBeCloseTo(expected * 0.5, 5);
      expect(color[2]).toBeCloseTo(expected * 0.25, 5);
      expect(lighting.stats.mediumVisibility.visible).toBe(512);
    },
  );
});

describe("the complete reference lighting model", () => {
  const light: CinematicDiskLight = {
    position: [0, 2, 0],
    normal: [0, -1, 0],
    radius: 0.8,
    color: [1, 1, 1],
    intensity: 6,
  };
  const medium: CinematicMedium = {
    center: [0, 0, 0],
    radius: 1,
    density: 0.3,
    tint: [0.8, 0.9, 1],
    anisotropy: 0.3,
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

  it("removes only the medium at zero density, preserving direct lighting exactly", () => {
    const common = { de: () => 10, stepScale: 1, lights: [light] };
    const absent = createCinematicLighting(common);
    const zero = createCinematicLighting({
      ...common,
      medium: { ...medium, density: 0 },
    });
    expect(zero.shadeLinear(hit)).toEqual(absent.shadeLinear(hit));
    const coloredRay: PreviewRay = { ...ray, linear: [0.12, 0.25, 0.4] };
    expect(zero.rayLinear(coloredRay)).toBe(coloredRay.linear);
    expect(zero.stats.mediumSamples).toBe(0);
    expect(zero.stats.mediumVisibility.rays).toBe(0);
  });

  it("attenuates both the light-to-surface and surface-to-camera segments", () => {
    for (const samples of [1, 16]) {
      const common = {
        de: () => 10,
        stepScale: 1,
        lights: [{ ...light, radius: 1e-6 }],
        surfaceSamples: samples,
        material: { ambient: [0, 0, 0] as [number, number, number] },
      };
      const vacuum = createCinematicLighting(common);
      const absorbing = createCinematicLighting({
        ...common,
        medium: { ...medium, tint: [0, 0, 0] },
      });
      const surface = absorbing.shadeLinear(hit);
      const transmitted = absorbing.rayLinear({
        ...ray,
        origin: [0, 2, 0],
        rd: [0, -1, 0],
        distance: 2,
        status: PREVIEW_HIT,
        linear: surface,
      });
      const unattenuated = vacuum.shadeLinear(hit);
      for (let c = 0; c < 3; c++) {
        expect(transmitted[c] / unattenuated[c]).toBeCloseTo(
          Math.exp(-2 * medium.density * medium.radius),
          10,
        );
      }
    }
  });

  it("changes surface illumination and mist when a light moves behind an occluder", () => {
    const poses: CinematicDiskLight[] = [
      { ...light, radius: 0.05 },
      { ...light, position: [2, 0.2, 0], normal: [-2, -0.2, 0], radius: 0.05 },
    ];
    const colors = poses.map((moved) => {
      const lighting = createCinematicLighting({
        de: (p) => Math.abs(p[1] - 1) - 0.05,
        stepScale: 1,
        lights: [moved],
        material: { ambient: [0, 0, 0], specular: 0 },
        medium: { ...medium, center: [0, 0.2, 0], radius: 0.2 },
      });
      return {
        surface: lighting.shadeLinear(hit),
        mist: lighting.rayLinear({ ...ray, origin: [0, 0.2, 1] }),
      };
    });
    expect(colors[0].surface).toEqual([0, 0, 0]);
    expect(colors[0].mist).toEqual([0, 0, 0]);
    expect(colors[1].surface[0]).toBeGreaterThan(0.001);
    expect(colors[1].mist[0]).toBeGreaterThan(0.0001);
  });

  it("opens surface illumination and mist together through the same geometric gap", () => {
    const wall = (p: [number, number, number]) => Math.abs(p[1] - 1) - 0.05;
    const aperture = (p: [number, number, number]) =>
      Math.max(wall(p), 0.3 - Math.hypot(p[0], p[2]));
    const colors = [wall, aperture].map((de) => {
      const lighting = createCinematicLighting({
        de,
        stepScale: 1,
        lights: [{ ...light, radius: 0.05 }],
        material: { ambient: [0, 0, 0], specular: 0 },
        medium: { ...medium, center: [0, 0.2, 0], radius: 0.2 },
        mediumSamples: 32,
      });
      return {
        surface: lighting.shadeLinear(hit),
        mist: lighting.rayLinear({ ...ray, origin: [0, 0.2, 1] }),
        stats: lighting.stats,
      };
    });
    expect(colors[0].surface).toEqual([0, 0, 0]);
    expect(colors[0].mist).toEqual([0, 0, 0]);
    expect(colors[1].surface[0]).toBeGreaterThan(0.01);
    expect(colors[1].mist[0]).toBeGreaterThan(0.0001);
    expect(colors[1].stats.surfaceVisibility.exhausted).toBe(0);
    expect(colors[1].stats.mediumVisibility.exhausted).toBe(0);
  });

  it("reassembles independently rendered atmosphere bands byte for byte", () => {
    const makeScene = (): PreviewScene => {
      const de = (p: [number, number, number]) => Math.hypot(...p) - 0.65;
      const lighting = createCinematicLighting({
        de,
        stepScale: 1,
        lights: [light],
        medium,
        surfaceSamples: 4,
        mediumSamples: 8,
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
