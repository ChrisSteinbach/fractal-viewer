import { applyAffine, composeAffine } from "./affine";
import { applyAffine4, composeAffine4, toTransform4 } from "./affine4";
import {
  buildBalloon,
  buildBalloon4,
  estimateBalloonDistance,
  estimateBalloonDistance4,
  estimateBalloonDistanceSample,
  estimateBalloonDistance4Sample,
  invertBalloon,
} from "./balloon-de";
import { pentatope, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import {
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceSample,
  estimateDistanceRefined,
  estimateDistanceRefinedSample,
  transformSeparatedSigmas,
} from "./surface-de";
import type { SurfaceDistanceSample } from "./surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Sample,
  estimateDistance4Refined,
  estimateDistance4RefinedSample,
  transformSeparatedSigmas4,
} from "./surface-de-4d";
import {
  inverseSwirlInto,
  swirlGlobalInverseLipschitz,
  swirlMarchInverseLipschitz,
} from "./swirl-lens";
import type { Transform, Vec3, Vec4 } from "./types";
import { composeVariations } from "./variations";
import { composeVariations4 } from "./variations4";

const zeroRng = () => 0;
const xyz = (q: Vec4): Vec3 => [q[0], q[1], q[2]];
const xyzw = (q: Vec3): Vec4 => [q[0], q[1], q[2], 0];

/** Independent forward maps give exact singleton distances, never the
 * candidate certificate's inverse as the expected geometry. */
describe("the paired swirl march certificate", () => {
  it("certifies near and remote queries against every source point in 3D and 4D", () => {
    const rng = mulberry32(0xc3a71f1);
    const forward3 = composeVariations([{ type: "swirl", weight: 1 }])!;
    const forward4 = composeVariations4([{ type: "swirl", weight: 1 }])!;
    let improvements = 0;
    for (const dimension of [3, 4]) {
      for (const rho of [0, 0.05, 0.25, 0.5]) {
        const G = swirlGlobalInverseLipschitz(rho);
        for (let i = 0; i < 1200; i++) {
          const source = Array.from({ length: dimension }, () => rng() - 0.5);
          const sourceScale =
            (rho * rng() ** (1 / dimension)) / Math.hypot(...source);
          source.forEach((x, axis) => (source[axis] = x * sourceScale));
          const point =
            dimension === 3
              ? forward3(...(source as Vec3), zeroRng)
              : forward4(...(source as Vec4), zeroRng);
          const query = point.map(
            (x) => x + (rng() - 0.5) * 10 ** (-7 + (i % 12)),
          );
          const inverse = [...query];
          inverseSwirlInto(query, inverse);
          const r = Math.hypot(...query);
          const L = swirlMarchInverseLipschitz(r, rho, G);
          const lower =
            Math.hypot(...inverse.map((x, axis) => x - source[axis])) / L;
          const exact = Math.hypot(...query.map((x, axis) => x - point[axis]));
          expect(L).toBeGreaterThanOrEqual(1);
          expect(L).toBeLessThanOrEqual(G);
          expect(lower).toBeLessThanOrEqual(exact * (1 + 1e-8) + 1e-14);
          if (L < G * 0.8) improvements++;
          if (dimension === 3) {
            expect(
              swirlMarchInverseLipschitz(Math.hypot(...query, 0), rho, G),
            ).toBe(L);
          }
        }
      }
    }
    expect(improvements).toBeGreaterThan(1000);
    const G = swirlGlobalInverseLipschitz(0.5);
    expect(swirlMarchInverseLipschitz(Infinity, 0.5, G)).toBe(G);
    expect(swirlMarchInverseLipschitz(NaN, 0.5, G)).toBe(G);
    expect(swirlMarchInverseLipschitz(-1, 0.5, G)).toBe(G);
    expect(swirlMarchInverseLipschitz(1e6, 0.5, G)).toBeLessThan(1.00001);
    expect(swirlMarchInverseLipschitz(0.5, 0.5, G)).toBeLessThan(1.281);
  });

  for (const fourD of [false, true]) {
    for (const folded of [false, true]) {
      it(`${fourD ? 4 : 3}D ${folded ? "fold" : "affine"} keeps acceptance/cutoff/floors and un-post/un-weight order`, () => {
        const rng = mulberry32(0xdecaf + Number(fourD) + 2 * Number(folded));
        let transforms = fourD ? pentatope() : sierpinskiTetrahedron();
        if (folded)
          transforms = transforms.map((t) => ({
            ...t,
            scale: [0.15, 0.15, 0.15],
            ...(fourD ? { w: { ...t.w, scale: 0.15 } } : {}),
            variations: [{ type: "boxfold", weight: 0.8 }],
          }));
        for (const weight of [-2, 0.7]) {
          const final: Transform = {
            id: 99,
            position: [0.02, -0.01, 0.01],
            rotation: [0.2, -0.3, 0.1],
            scale: [-0.2, 0.2, 0.2],
            variations: [{ type: "swirl", weight }],
            ...(fourD
              ? { w: { scale: 0.2, position: 0.03, rotation: { xw: 0.25 } } }
              : {}),
            post: {
              m: [0.6, 0.04, 0, 0, 0.7, 0.02, 0, 0, 0.8],
              t: [0.04, -0.01, 0.02],
            },
          };
          const raw3 = fourD ? null : buildSurfaceDE(transforms);
          const de3 = fourD ? null : buildSurfaceDE(transforms, final);
          const raw4 = fourD ? buildSurfaceDE4(transforms) : null;
          const de4 = fourD ? buildSurfaceDE4(transforms, final) : null;
          const de = de3 ?? de4!;
          const lens = de.foldFinal!;
          const G = lens.swirlLipschitz!;
          const factor =
            Math.abs(weight) *
            (fourD
              ? transformSeparatedSigmas4(toTransform4(final)).min
              : transformSeparatedSigmas(final).min);
          const affine3 = composeAffine(final);
          const lifted = toTransform4(final);
          const affine4 = composeAffine4(lifted);
          const variation3 = composeVariations(final.variations)!;
          const variation4 = composeVariations4(final.variations)!;
          for (const refined of [false, true]) {
            const raw = (q: Vec4): number =>
              de3
                ? (refined ? estimateDistanceRefined : estimateDistance)(
                    raw3!,
                    xyz(q),
                  )
                : (refined ? estimateDistance4Refined : estimateDistance4)(
                    raw4!,
                    q,
                  );
            const scalar = (p: Vec4, cutoff = 0): number =>
              de3
                ? (refined ? estimateDistanceRefined : estimateDistance)(
                    de3,
                    xyz(p),
                    cutoff,
                  )
                : refined
                  ? estimateDistance4Refined(de4!, p, cutoff)
                  : estimateDistance4(de4!, p);
            const sample = (p: Vec4, cutoff = 0): SurfaceDistanceSample =>
              de3
                ? (refined
                    ? estimateDistanceRefinedSample
                    : estimateDistanceSample)(de3, xyz(p), cutoff)
                : refined
                  ? estimateDistance4RefinedSample(de4!, p, cutoff)
                  : estimateDistance4Sample(de4!, p);
            let improved = 0;
            for (let i = 0; i < 128; i++) {
              const q: Vec4 = [
                rng() - 0.5,
                rng() - 0.5,
                rng() - 0.5,
                fourD ? rng() - 0.5 : 0,
              ];
              const scale =
                (i % 3 === 0 ? 5 : 1.8) * (raw3 ?? raw4!).boundingRadius;
              for (let axis = 0; axis < 4; axis++) q[axis] *= scale;
              const pre = fourD
                ? applyAffine4(affine4, ...q)
                : xyzw(applyAffine(affine3, ...xyz(q)));
              const p = fourD
                ? applyAffine4(lifted.post4!, ...variation4(...pre, zeroRng))
                : xyzw(
                    applyAffine(
                      final.post!,
                      ...variation3(...xyz(pre), zeroRng),
                    ),
                  );
              const visibleFloor = Math.hypot(...p) - de.visibleBoundingRadius;
              const rawDistance = factor * raw(q);
              const full = sample(p);
              expect(full.d).toBe(scalar(p));
              const L = swirlMarchInverseLipschitz(
                Math.hypot(...pre),
                lens.swirlRadius!,
                G,
              );
              expect(full.stride).toBeCloseTo(
                Math.max(visibleFloor, rawDistance / L),
                10,
              );
              if (full.d > 0 && full.stride > full.d * 1.01) improved++;
              // Numeric floor and pixel part both remain divided by G.
              for (const ordinaryEps of [
                Math.max(0, de.visibleBoundingRadius * 1e-6),
                Math.max(0.003, de.visibleBoundingRadius * 1e-6),
                0.08 * de.visibleBoundingRadius,
              ]) {
                const cutoff = ordinaryEps / G;
                const actual = sample(p, cutoff);
                const activeCutoff = !fourD || refined;
                if (activeCutoff) {
                  expect(actual.d < cutoff).toBe(full.d < cutoff);
                  if (actual.d >= cutoff) {
                    expect(actual.d).toBe(full.d);
                    expect(actual.stride).toBe(full.stride);
                  } else expect(actual.stride).toBe(actual.d);
                }
                for (const clipFloor of [
                  -1,
                  ordinaryEps * 0.4,
                  ordinaryEps * 1.1,
                ]) {
                  const accepted = Math.max(actual.d, clipFloor) < cutoff;
                  const rawAccepted =
                    Math.max(rawDistance, visibleFloor, clipFloor) <
                    ordinaryEps;
                  if (accepted) expect(rawAccepted).toBe(true);
                  if (visibleFloor <= 0 && clipFloor <= 0)
                    expect(accepted).toBe(rawAccepted);
                  // An accepted early result cannot leak an unsafe large
                  // stride past a rejecting outer floor.
                  if (
                    activeCutoff &&
                    actual.d < cutoff &&
                    clipFloor >= cutoff
                  ) {
                    expect(Math.max(actual.stride, clipFloor)).toBe(clipFloor);
                  }
                }
              }
            }
            expect(improved).toBeGreaterThan(0);
          }
          if (de4) {
            expect(() =>
              estimateDistance4Sample(de4, [0, 0, 0, 0], [0, 0, 0, 0.01]),
            ).toThrow(/nonlinear final lens/);
            expect(() =>
              estimateDistance4RefinedSample(
                de4,
                [0, 0, 0, 0],
                0.01,
                [0.01, 0, 0, 0],
              ),
            ).toThrow(/nonlinear final lens/);
          }
        }
      });
    }

    it(`${fourD ? 4 : 3}D Balloon takes independent minima at fixed balls/cameras and preserves the union predicate`, () => {
      const rng = mulberry32(0xba11 + Number(fourD));
      const final: Transform = {
        id: 90,
        position: [0.02, -0.01, 0.01],
        rotation: [0.2, -0.3, 0.1],
        scale: [-0.2, 0.2, 0.2],
        variations: [{ type: "swirl", weight: -2 }],
        ...(fourD
          ? { w: { scale: 0.2, position: 0.03, rotation: { xw: 0.25 } } }
          : {}),
        post: {
          m: [0.6, 0.04, 0, 0, 0.7, 0.02, 0, 0, 0.8],
          t: [0.04, -0.01, 0.02],
        },
      };
      const de3 = fourD ? null : buildSurfaceDE(sierpinskiTetrahedron(), final);
      const de4 = fourD ? buildSurfaceDE4(pentatope(), final) : null;
      const de = de3 ?? de4!;
      const G = de.foldFinal!.swirlLipschitz!;
      const source3 = de3
        ? { ...de3, foldFinal: { ...de3.foldFinal!, swirlLipschitz: 1 } }
        : null;
      const source4 = de4
        ? { ...de4, foldFinal: { ...de4.foldFinal!, swirlLipschitz: 1 } }
        : null;
      const w0 = fourD ? 0.05 * de.visibleBoundingRadius : 0;
      let hits = 0;
      let misses = 0;
      let shellWins = 0;
      let distinctWinners = 0;
      let transitionSamples = 0;
      for (const rMult of [0.35, 1.6]) {
        const b = de3 ? buildBalloon(de3, rMult) : buildBalloon4(de4!, rMult);
        const scalar = (p: Vec3, cutoff = 0, reference = false) =>
          de3
            ? estimateBalloonDistance(
                estimateDistanceRefined,
                reference ? source3! : de3,
                b,
                p,
                cutoff,
              )
            : estimateBalloonDistance4(
                estimateDistance4Refined,
                reference ? source4! : de4!,
                b,
                p,
                w0,
                cutoff,
              );
        const sample = (p: Vec3, cutoff = 0) =>
          de3
            ? estimateBalloonDistanceSample(
                estimateDistanceRefinedSample,
                de3,
                b,
                p,
                cutoff,
              )
            : estimateBalloonDistance4Sample(
                estimateDistance4RefinedSample,
                de4!,
                b,
                p,
                w0,
                cutoff,
              );
        const term = (p: Vec3) =>
          de3
            ? estimateDistanceRefinedSample(de3, p)
            : estimateDistance4RefinedSample(de4!, [...p, w0]);
        for (let i = 0; i < 300; i++) {
          const p: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
          const r = de.visibleBoundingRadius * 10 ** (-2 + 3 * rng());
          const scale = r / Math.hypot(...p);
          for (let axis = 0; axis < 3; axis++) p[axis] *= scale;
          const full = sample(p);
          expect({ d: full.d, shell: full.shell }).toEqual(scalar(p));
          const fractal = term(p);
          const inverted = invertBalloon(b, p);
          expect(full.stride).toBeGreaterThanOrEqual(full.d);
          expect(full.stride).toBeLessThanOrEqual(fractal.d);
          if (full.shell) shellWins++;
          if (full.shell !== full.stride < fractal.d) distinctWinners++;
          if (
            full.shell &&
            full.d > 0 &&
            full.stride < fractal.d &&
            full.stride > full.d
          ) {
            // A miss just outside the unchanged acceptance boundary must
            // reduce extra travel continuously, while retaining progress.
            const transition = sample(p, full.d / 1.125);
            expect(transition.d).toBe(full.d);
            expect(transition.stride).toBeGreaterThan(full.d);
            expect(transition.stride).toBeLessThan(full.stride);
            transitionSamples++;
          }
          const ordinaryEps = Math.max(
            0.015 * de.visibleBoundingRadius,
            de.visibleBoundingRadius * 1e-6,
          );
          const cutoff = ordinaryEps / G;
          const cut = sample(p, cutoff);
          const accepted = full.d < cutoff;
          if (accepted) hits++;
          else misses++;
          expect(cut.d < cutoff).toBe(accepted);
          if (!accepted) {
            expect(cut.d).toBe(full.d);
            expect(cut.shell).toBe(full.shell);
            expect(cut.stride).toBeGreaterThanOrEqual(cut.d);
            expect(cut.stride).toBeLessThanOrEqual(full.stride);
          }
          const referenceAccepted = scalar(p, 0, true).d < ordinaryEps;
          if (accepted) expect(referenceAccepted).toBe(true);
          if (
            Math.hypot(...p, w0) <= de.visibleBoundingRadius &&
            Math.hypot(...inverted, w0) <= de.visibleBoundingRadius
          ) {
            expect(accepted).toBe(referenceAccepted);
          }
        }
      }
      expect(hits).toBeGreaterThan(0);
      expect(misses).toBeGreaterThan(0);
      expect(shellWins).toBeGreaterThan(0);
      expect(distinctWinners).toBeGreaterThan(0);
      expect(transitionSamples).toBeGreaterThan(0);
    });
  }
});
