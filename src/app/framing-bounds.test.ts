import {
  FRAMING_SAMPLE_TARGET,
  framingBounds,
  framingRadius4,
} from "./framing-bounds";
import { mulberry32 } from "../fractal/rng";
import type { Vec4 } from "../fractal/types";

describe("framingBounds", () => {
  it("stays within the raw extent and keeps ~90%+ of it for a compact, outlier-free cloud", () => {
    const rng = mulberry32(1234);
    const count = 2000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng() * 2 - 1;
      positions[i * 3 + 1] = rng() * 2 - 1;
      positions[i * 3 + 2] = rng() * 2 - 1;
    }
    let rawMinX = Infinity;
    let rawMaxX = -Infinity;
    let rawMinY = Infinity;
    let rawMaxY = -Infinity;
    let rawMinZ = Infinity;
    let rawMaxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      rawMinX = Math.min(rawMinX, positions[i * 3]);
      rawMaxX = Math.max(rawMaxX, positions[i * 3]);
      rawMinY = Math.min(rawMinY, positions[i * 3 + 1]);
      rawMaxY = Math.max(rawMaxY, positions[i * 3 + 1]);
      rawMinZ = Math.min(rawMinZ, positions[i * 3 + 2]);
      rawMaxZ = Math.max(rawMaxZ, positions[i * 3 + 2]);
    }

    const result = framingBounds(positions, count);

    // The trim only shaves sparse tails, so it can only shrink toward the
    // raw extent, never past it.
    expect(result.minX).toBeGreaterThanOrEqual(rawMinX);
    expect(result.maxX).toBeLessThanOrEqual(rawMaxX);
    expect(result.minY).toBeGreaterThanOrEqual(rawMinY);
    expect(result.maxY).toBeLessThanOrEqual(rawMaxY);
    expect(result.minZ).toBeGreaterThanOrEqual(rawMinZ);
    expect(result.maxZ).toBeLessThanOrEqual(rawMaxZ);

    expect(result.maxX - result.minX).toBeGreaterThanOrEqual(
      0.9 * (rawMaxX - rawMinX),
    );
    expect(result.maxY - result.minY).toBeGreaterThanOrEqual(
      0.9 * (rawMaxY - rawMinY),
    );
    expect(result.maxZ - result.minZ).toBeGreaterThanOrEqual(
      0.9 * (rawMaxZ - rawMinZ),
    );
  });

  it("ignores sparse far outliers appended at the end of the buffer", () => {
    // count = 10_020 gives stride floor(10_020 / 4096) = 2: every SECOND
    // point is sampled (n = 5010, trimming the top/bottom 25 samples). The 20
    // outliers land at the very end (indices 10_000..10_019); only their
    // even-indexed half (10 of them) fall on a sampled index, comfortably
    // fewer than the 25-sample trim.
    const rng = mulberry32(99);
    const inliers = 10_000;
    const outliers = 20;
    const count = inliers + outliers;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < inliers; i++) {
      positions[i * 3] = rng() * 2 - 1;
      positions[i * 3 + 1] = rng() * 2 - 1;
      positions[i * 3 + 2] = rng() * 2 - 1;
    }
    for (let i = inliers; i < count; i++) {
      positions[i * 3] = 40;
      positions[i * 3 + 1] = 40;
      positions[i * 3 + 2] = 40;
    }

    const result = framingBounds(positions, count);

    // Raw max would be ~40 (raw maxR ~69.28, since sqrt(3 * 40^2) ≈ 69.28);
    // the trim must keep the fit on the actual [-1, 1] cluster instead.
    expect(result.maxX).toBeLessThan(2);
    expect(result.maxY).toBeLessThan(2);
    expect(result.maxZ).toBeLessThan(2);
    expect(result.maxR).toBeLessThan(3);
  });

  it("ignores interleaved outliers even when the stride sample must skip most points", () => {
    // count = 100_000 is far past FRAMING_SAMPLE_TARGET (4096), so
    // framingBounds strides through the buffer instead of reading every
    // point: stride = floor(100_000 / 4096) = 24, giving n = floor(99_999 /
    // 24) + 1 = 4167 samples, and trimming the top/bottom
    // floor(0.005 * 4167) = 20 of those. Scattering the 20 outliers every
    // 5000 points (rather than bunching them at the end, as the test above
    // does) means some outlier indices DO land exactly on a sampled index
    // (a multiple of 24): indices 0, 15_000, 30_000, 45_000, 60_000, 75_000,
    // and 90_000 — 7 of the 20 — by construction (5000 mod 24 = 8, and
    // 8k mod 24 = 0 exactly when k is a multiple of 3). 7 is still
    // comfortably fewer than the 20-sample trim, so the fit stays on the
    // compact cluster instead of chasing the ones that got sampled.
    const rng = mulberry32(7);
    const count = 100_000;
    expect(count).toBeGreaterThan(FRAMING_SAMPLE_TARGET * 2);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng() * 2 - 1;
      positions[i * 3 + 1] = rng() * 2 - 1;
      positions[i * 3 + 2] = rng() * 2 - 1;
    }
    for (let k = 0; k < 20; k++) {
      const i = k * 5000;
      positions[i * 3] = 40;
      positions[i * 3 + 1] = 40;
      positions[i * 3 + 2] = 40;
    }

    const result = framingBounds(positions, count);

    expect(result.maxX).toBeLessThan(2);
    expect(result.maxY).toBeLessThan(2);
    expect(result.maxZ).toBeLessThan(2);
    expect(result.maxR).toBeLessThan(3);
  });

  it("returns the all-zero Bounds for an empty cloud", () => {
    const result = framingBounds(new Float32Array(0), 0);

    expect(result).toEqual({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minR: 0,
      maxR: 0,
    });
  });

  it("collapses min/max to the single point for a count of 1", () => {
    const positions = new Float32Array([2, -3, 1]);

    const result = framingBounds(positions, 1);

    expect(result.minX).toBe(2);
    expect(result.maxX).toBe(2);
    expect(result.minY).toBe(-3);
    expect(result.maxY).toBe(-3);
    expect(result.minZ).toBe(1);
    expect(result.maxZ).toBe(1);
    expect(result.minR).toBeCloseTo(Math.sqrt(14), 12);
    expect(result.maxR).toBeCloseTo(Math.sqrt(14), 12);
  });
});

describe("framingRadius4", () => {
  it("top-trims sparse far outliers, keeping the fit near the compact cluster", () => {
    const center: Vec4 = [1, 2, -1, 0.5];
    const rng = mulberry32(11);
    const inliers = 5000;
    const outliers = 10;
    const count = inliers + outliers;
    const positions = new Float32Array(count * 3);
    const w = new Float32Array(count);
    for (let i = 0; i < inliers; i++) {
      // Each coordinate offset by at most ±0.5, so the worst-case 4D
      // distance from `center` is sqrt(4 * 0.5^2) = 1.
      positions[i * 3] = center[0] + (rng() - 0.5);
      positions[i * 3 + 1] = center[1] + (rng() - 0.5);
      positions[i * 3 + 2] = center[2] + (rng() - 0.5);
      w[i] = center[3] + (rng() - 0.5);
    }
    for (let i = inliers; i < count; i++) {
      // Distance exactly 25 from center, along x alone.
      positions[i * 3] = center[0] + 25;
      positions[i * 3 + 1] = center[1];
      positions[i * 3 + 2] = center[2];
      w[i] = center[3];
    }

    const result = framingRadius4(positions, w, count, center);

    expect(result).toBeLessThan(1.5);
  });

  it("returns exactly the true distance when every point sits at the same radius", () => {
    const center: Vec4 = [2, -1, 3, 0.5];
    const count = 1000;
    const positions = new Float32Array(count * 3);
    const w = new Float32Array(count);
    // Eight axis-aligned offsets, each at Euclidean distance exactly 3 from
    // the origin; distributing points across all eight means every sample —
    // and thus every quantile of them — is exactly 3, regardless of trim.
    const offsets: Vec4[] = [
      [3, 0, 0, 0],
      [-3, 0, 0, 0],
      [0, 3, 0, 0],
      [0, -3, 0, 0],
      [0, 0, 3, 0],
      [0, 0, -3, 0],
      [0, 0, 0, 3],
      [0, 0, 0, -3],
    ];
    for (let i = 0; i < count; i++) {
      const [ox, oy, oz, ow] = offsets[i % offsets.length];
      positions[i * 3] = center[0] + ox;
      positions[i * 3 + 1] = center[1] + oy;
      positions[i * 3 + 2] = center[2] + oz;
      w[i] = center[3] + ow;
    }

    const result = framingRadius4(positions, w, count, center);

    expect(result).toBe(3);
  });

  it("includes the w coordinate in the distance, not just xyz", () => {
    const center: Vec4 = [1, 1, 1, 0];
    const count = 100;
    const positions = new Float32Array(count * 3);
    const w = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // xyz exactly at the center — any bug that dropped w from the
      // distance would report a radius of 0 instead of 3.
      positions[i * 3] = center[0];
      positions[i * 3 + 1] = center[1];
      positions[i * 3 + 2] = center[2];
      w[i] = center[3] + (i % 2 === 0 ? 3 : -3);
    }

    const result = framingRadius4(positions, w, count, center);

    expect(result).toBe(3);
  });

  it("returns 0 for an empty cloud", () => {
    const result = framingRadius4(
      new Float32Array(0),
      new Float32Array(0),
      0,
      [0, 0, 0, 0],
    );

    expect(result).toBe(0);
  });
});
