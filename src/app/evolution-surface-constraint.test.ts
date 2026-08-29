import { presetTransforms } from "../fractal/presets";
import {
  deriveSurfaceDocumentEligibility,
  type SurfaceEligibilityDocument,
} from "./surface-eligibility";
import { evaluateEvolutionSurfaceAdmission } from "./evolution-surface-constraint";

const NO_SYMMETRY = { order: 1, plane: "xy" } as const;

function presetDocument(
  preset: Parameters<typeof presetTransforms>[0],
): SurfaceEligibilityDocument {
  return {
    transforms: presetTransforms(preset),
    symmetry: NO_SYMMETRY,
  };
}

const INELIGIBLE_DOCUMENT: SurfaceEligibilityDocument = {
  transforms: [
    {
      id: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "qsquare", weight: 1 }],
    },
  ],
  symmetry: NO_SYMMETRY,
};

describe("Evolution Surface admission", () => {
  it("admits eligible and degraded routes and rejects only ineligible documents", () => {
    expect(
      evaluateEvolutionSurfaceAdmission(presetDocument("default"), true),
    ).toMatchObject({ admitted: true, eligibility: { status: "eligible" } });
    expect(
      evaluateEvolutionSurfaceAdmission(
        presetDocument("mandelboxClassic"),
        true,
      ),
    ).toMatchObject({ admitted: true, eligibility: { status: "degraded" } });

    const rejected = evaluateEvolutionSurfaceAdmission(
      INELIGIBLE_DOCUMENT,
      true,
    );
    expect(rejected).toMatchObject({
      admitted: false,
      reason: "surface-incompatible",
      eligibility: { status: "ineligible", kind: null },
    });
    if (rejected.admitted) return;
    expect(rejected.eligibility.note).not.toBeNull();
    expect(rejected.eligibility).toEqual(
      deriveSurfaceDocumentEligibility(INELIGIBLE_DOCUMENT),
    );
  });

  it("admits a compute-only 4D route without taking machine capabilities", () => {
    expect(
      evaluateEvolutionSurfaceAdmission(presetDocument("mandelboxBrick"), true),
    ).toMatchObject({
      admitted: true,
      eligibility: { status: "degraded", kind: "escape4" },
    });
  });

  it("bypasses classification while the constraint is off", () => {
    expect(
      evaluateEvolutionSurfaceAdmission(INELIGIBLE_DOCUMENT, false),
    ).toEqual({ admitted: true, eligibility: null });
  });
});
