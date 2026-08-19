import { inversionBallScale } from "./inversion";
import { mulberry32 } from "./rng";

/**
 * The Möbius ball-image identity, pinned against brute force
 * rather than against itself. Every test below inverts SAMPLED POINTS with
 * the raw definition `u -> R² u / |u|²` and asks whether the ball the
 * helper predicts actually holds them — which is the only question a
 * distance certificate cares about, and the one a re-derivation of the
 * algebra could get wrong without failing an algebraic identity.
 */

/** The raw inversion, written out here so no test checks the helper
 * against an expression the helper also produced. */
function invert(u: number[], sphereR2: number): number[] {
  const r2 = u.reduce((acc, x) => acc + x * x, 0);
  return u.map((x) => (sphereR2 * x) / r2);
}

function norm(u: number[]): number {
  return Math.sqrt(u.reduce((acc, x) => acc + x * x, 0));
}

/** A uniform point in the ball `B(c, r)`, in as many dimensions as `c`
 * has — the identity is dimension-free and the tests exercise 3 and 4. */
function ballPoint(rng: () => number, c: number[], r: number): number[] {
  for (;;) {
    const v = c.map(() => 2 * rng() - 1);
    const n = norm(v);
    if (n > 0 && n <= 1)
      return c.map((x, i) => x + (v[i] / n) * r * Math.cbrt(rng()));
  }
}

describe("inversionBallScale", () => {
  it("predicts a ball that CONTAINS the image of every point of the source ball, in 3D and in 4D", () => {
    const rng = mulberry32(0x11ce);
    for (const dim of [3, 4]) {
      for (let trial = 0; trial < 60; trial++) {
        const sphereR2 = 0.25 + 3 * rng();
        const c = Array.from({ length: dim }, () => 4 * rng() - 2);
        const dist = norm(c);
        // Strictly inside the "ball misses the centre" regime the identity
        // is stated for; the degenerate case has its own test below.
        const r = dist * (0.05 + 0.8 * rng());
        const scale = inversionBallScale(dist, r, sphereR2);
        expect(scale).toBeGreaterThan(0);
        const imgC = c.map((x) => x * scale);
        const imgR = r * scale;
        for (let k = 0; k < 40; k++) {
          const p = ballPoint(rng, c, r);
          const q = invert(p, sphereR2);
          // A hair of slack for f64 rounding through the two divisions.
          expect(norm(q.map((x, i) => x - imgC[i]))).toBeLessThanOrEqual(
            imgR * (1 + 1e-9) + 1e-12,
          );
        }
      }
    }
  });

  it("is TIGHT — the two points where the source ball meets the line through the centre land on the image ball's own boundary", () => {
    // Looseness here would be safe but would cost the caller bound quality
    // at every crossing, so the identity's exactness is worth pinning
    // rather than only its soundness.
    const sphereR2 = 1;
    const c = [2, 0, 0];
    const r = 0.5;
    const scale = inversionBallScale(norm(c), r, sphereR2);
    const imgC = c.map((x) => x * scale);
    const imgR = r * scale;
    for (const near of [
      [2 - r, 0, 0],
      [2 + r, 0, 0],
    ]) {
      const q = invert(near, sphereR2);
      expect(norm(q.map((x, i) => x - imgC[i]))).toBeCloseTo(imgR, 12);
    }
  });

  it("returns 0 when the ball reaches the inversion centre — the image is unbounded and 0 is the conservative reading", () => {
    // Touching counts: at |c| = r the ball's boundary passes through the
    // centre, the image is a half-space, and no finite ball holds it.
    expect(inversionBallScale(1, 1, 1)).toBe(0);
    expect(inversionBallScale(1, 1.5, 1)).toBe(0);
    expect(inversionBallScale(0, 0.25, 1)).toBe(0);
    // ...and never a negative scale, which a caller could otherwise apply
    // and get a "ball" on the wrong side of the centre.
    expect(inversionBallScale(0.5, 2, 4)).toBe(0);
  });

  it("reduces to the point inversion as the radius goes to zero", () => {
    const sphereR2 = 2.25;
    const c = [0.7, -1.1, 0.4];
    const scale = inversionBallScale(norm(c), 0, sphereR2);
    const imgC = c.map((x) => x * scale);
    const direct = invert(c, sphereR2);
    for (let i = 0; i < 3; i++) expect(imgC[i]).toBeCloseTo(direct[i], 12);
  });

  it("is an involution on balls that stay clear of the centre", () => {
    // Inverting twice through the same sphere returns the identity, so the
    // helper applied twice must return the source ball — a property no
    // single application can check.
    const sphereR2 = 1.44;
    const c = [1.8, 0.5, -0.3, 0.9];
    const r = 0.4;
    const s1 = inversionBallScale(norm(c), r, sphereR2);
    const c1 = c.map((x) => x * s1);
    const r1 = r * s1;
    const s2 = inversionBallScale(norm(c1), r1, sphereR2);
    const c2 = c1.map((x) => x * s2);
    const r2 = r1 * s2;
    for (let i = 0; i < c.length; i++) expect(c2[i]).toBeCloseTo(c[i], 10);
    expect(r2).toBeCloseTo(r, 10);
  });
});
