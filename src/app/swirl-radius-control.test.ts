import { pentatope, sierpinskiTetrahedron } from "../fractal/presets";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import { analyzeSwirlLensRadius } from "../fractal/swirl-lens-edit";
import { pureSwirlFinal, SWIRL_LENS_MAX_RADIUS } from "../fractal/swirl-lens";
import type { Transform } from "../fractal/types";
import {
  analyzeFinalSwirlRadiusControl,
  prepareFinalSwirlRadiusEdit,
} from "./swirl-radius-control";
import { MAX_VARIATION_WEIGHT } from "./persist";
import { MAX_W_POSITION, MAX_W_SCALE, MIN_W_SCALE } from "./state";

const tetra = sierpinskiTetrahedron();
const penta = pentatope();

function finalLens(fourD = false): Transform {
  return {
    id: 99,
    position: [0.8, -0.2, 0.3],
    rotation: [0.23, -0.31, 0.47],
    scale: [-0.4, 0.45, 0.35],
    shear: [0.1, -0.05, 0.15],
    variations: [{ type: "swirl", weight: -2 }],
    ...(fourD
      ? { w: { scale: -0.4, position: 0.05, rotation: { xw: 0.2 } } }
      : {}),
  };
}

/** Exact unit pre-radius with an explicit signed W scale. */
function unitFinal(wScale = 0.1): Transform {
  return {
    id: 99,
    position: [1 - 0.1 * buildSurfaceDE4(penta).boundingRadius, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.1, 0.1, 0.1],
    w: { scale: wScale },
    variations: [{ type: "swirl", weight: 1 }],
  };
}

function currentRadius(transforms: Transform[], final: Transform): number {
  const result = analyzeSwirlLensRadius(transforms, final);
  if (!result.available) throw new Error(result.reason);
  return result.radius;
}

describe("the app swirl radius domain", () => {
  it("prepares ordinary .5 edits in both dimensions and preserves an exact over-cap readout", () => {
    for (const fourD of [false, true]) {
      const transforms = fourD ? penta : tetra;
      const final = finalLens(fourD);
      const before = structuredClone(final);
      const control = analyzeFinalSwirlRadiusControl(transforms, final);
      expect(control.available).toBe(true);
      if (!control.available) continue;
      expect(control.radius).toBe(currentRadius(transforms, final));
      expect(control.radius).toBeGreaterThan(SWIRL_LENS_MAX_RADIUS);
      expect(control.fitAvailable).toBe(true);
      expect(control.min * 1000).toBeCloseTo(Math.round(control.min * 1000), 9);
      expect(control.max * 1000).toBeCloseTo(Math.round(control.max * 1000), 9);
      expect(control.min).toBeLessThanOrEqual(control.radius);
      expect(control.max).toBeGreaterThanOrEqual(control.radius);
      const edit = prepareFinalSwirlRadiusEdit(
        transforms,
        final,
        SWIRL_LENS_MAX_RADIUS,
      );
      expect(edit.ok).toBe(true);
      if (!edit.ok) continue;
      expect(currentRadius(transforms, edit.transform)).toBeLessThanOrEqual(
        SWIRL_LENS_MAX_RADIUS,
      );
      expect(currentRadius(transforms, edit.transform)).toBeCloseTo(
        SWIRL_LENS_MAX_RADIUS,
        8,
      );
      expect(final).toEqual(before);
      const larger = prepareFinalSwirlRadiusEdit(
        transforms,
        edit.transform,
        0.75,
      );
      expect(larger.ok).toBe(true);
    }
  });

  it("keeps ordinary advertised endpoints inside the copied weight and explicit W domains", () => {
    for (const fourD of [false, true]) {
      const transforms = fourD ? penta : tetra;
      const final = finalLens(fourD);
      const control = analyzeFinalSwirlRadiusControl(transforms, final);
      expect(control.available).toBe(true);
      if (!control.available) continue;
      for (const target of [control.min, control.max]) {
        const edit = prepareFinalSwirlRadiusEdit(transforms, final, target);
        expect(edit.ok).toBe(true);
        if (!edit.ok) continue;
        expect(currentRadius(transforms, edit.transform)).toBeCloseTo(
          target,
          8,
        );
        expect(
          Math.abs(pureSwirlFinal(edit.transform)!.weight),
        ).toBeLessThanOrEqual(MAX_VARIATION_WEIGHT);
        if (fourD) {
          expect(Math.abs(edit.transform.w!.scale!)).toBeGreaterThanOrEqual(
            MIN_W_SCALE,
          );
          expect(Math.abs(edit.transform.w!.scale!)).toBeLessThanOrEqual(
            MAX_W_SCALE,
          );
          expect(Math.abs(edit.transform.w!.position!)).toBeLessThanOrEqual(
            MAX_W_POSITION,
          );
        }
      }
    }
  });

  it("refuses the cap margin crossing the weight limit and removes .5 from the advertised lower endpoint", () => {
    const final = unitFinal();
    delete final.w;
    const current = currentRadius(tetra, final);
    final.variations![0].weight = (MAX_VARIATION_WEIGHT * 0.5) / current;
    const control = analyzeFinalSwirlRadiusControl(tetra, final);
    expect(control).toMatchObject({
      available: true,
      fitAvailable: false,
      min: 0.501,
    });
    expect(prepareFinalSwirlRadiusEdit(tetra, final, 0.5)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/weight outside/),
    });
    const next = prepareFinalSwirlRadiusEdit(tetra, final, 0.501);
    expect(next.ok).toBe(true);
    if (next.ok)
      expect(
        Math.abs(pureSwirlFinal(next.transform)!.weight),
      ).toBeLessThanOrEqual(MAX_VARIATION_WEIGHT);
  });

  it("refuses both signs crossing the lower W-scale limit at .5, without losing the authored readout", () => {
    for (const sign of [-1, 1]) {
      const final = unitFinal(sign * 0.1);
      expect(currentRadius(penta, final)).toBe(1);
      const control = analyzeFinalSwirlRadiusControl(penta, final);
      expect(control).toMatchObject({
        available: true,
        radius: 1,
        min: 0.501,
        fitAvailable: false,
      });
      expect(prepareFinalSwirlRadiusEdit(penta, final, 0.5)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/W scale outside/),
      });
      const edit = prepareFinalSwirlRadiusEdit(penta, final, 0.501);
      expect(edit.ok).toBe(true);
      if (edit.ok) {
        expect(Math.sign(edit.transform.w!.scale!)).toBe(sign);
        expect(Math.abs(edit.transform.w!.scale!)).toBeGreaterThanOrEqual(
          MIN_W_SCALE,
        );
      }
    }
  });

  it("guards signed W-scale upper limits on actual candidates", () => {
    for (const sign of [-1, 1]) {
      const final = unitFinal(sign * 0.1);
      const within = prepareFinalSwirlRadiusEdit(penta, final, 14.9);
      expect(within.ok).toBe(true);
      if (within.ok) {
        expect(Math.sign(within.transform.w!.scale!)).toBe(sign);
        expect(Math.abs(within.transform.w!.scale!)).toBeLessThan(MAX_W_SCALE);
      }
      expect(prepareFinalSwirlRadiusEdit(penta, final, 15.1)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/W scale outside/),
      });
    }
  });

  it("guards both W-position limits while leaving inherited W scale absent", () => {
    for (const sign of [-1, 1]) {
      const final = { ...unitFinal(), w: { position: sign * 0.1 } };
      const current = currentRadius(penta, final);
      const within = prepareFinalSwirlRadiusEdit(penta, final, current * 14.9);
      expect(within.ok).toBe(true);
      if (within.ok) {
        expect(Math.sign(within.transform.w!.position!)).toBe(sign);
        expect(Math.abs(within.transform.w!.position!)).toBeLessThan(
          MAX_W_POSITION,
        );
        expect(Object.hasOwn(within.transform.w!, "scale")).toBe(false);
      }
      expect(
        prepareFinalSwirlRadiusEdit(penta, final, current * 15.1),
      ).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/W position outside/),
      });
    }
  });

  it("retains off-grid values but does not treat a narrow display interval as authorization to exceed the codec", () => {
    const final = finalLens();
    final.variations![0].weight = MAX_VARIATION_WEIGHT;
    const current = currentRadius(tetra, final);
    const control = analyzeFinalSwirlRadiusControl(tetra, final);
    expect(control.available).toBe(true);
    if (!control.available) return;
    expect(control.radius).toBe(current);
    expect(control.min).toBeLessThanOrEqual(current);
    expect(control.max).toBeGreaterThanOrEqual(current);
    expect(control.min * 1000).toBeCloseTo(Math.round(control.min * 1000), 9);
    expect(
      prepareFinalSwirlRadiusEdit(tetra, final, control.min),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/weight outside/),
    });
    expect(
      prepareFinalSwirlRadiusEdit(
        tetra,
        final,
        Math.ceil(current * 1000) / 1000,
      ).ok,
    ).toBe(true);
  });

  it("reports unavailable raw bounds and invalid numeric requests without mutating geometry", () => {
    const final = finalLens();
    const before = structuredClone(final);
    expect(analyzeFinalSwirlRadiusControl([], final)).toMatchObject({
      available: false,
    });
    expect(prepareFinalSwirlRadiusEdit([], final, 0.5)).toMatchObject({
      ok: false,
    });
    expect(analyzeFinalSwirlRadiusControl(tetra, null)).toMatchObject({
      available: false,
    });
    for (const target of [0, -1, NaN, Infinity]) {
      expect(prepareFinalSwirlRadiusEdit(tetra, final, target)).toMatchObject({
        ok: false,
      });
    }
    expect(final).toEqual(before);
  });
});
