import type { SurfaceEligibilityDocument } from "./surface-eligibility";
import {
  deriveSurfaceDocumentEligibility,
  surfaceEligibilityHasRoute,
  type SurfaceEligibilityResult,
} from "./surface-eligibility";

/**
 * Source-neutral admission result for an Evolution document. Mutation and
 * future crossover both hand this policy the exact snapshot they would add
 * to the lineage; only the caller owns graph/resource side effects.
 */
export type EvolutionSurfaceAdmission =
  | {
      readonly admitted: true;
      /** Null when the session constraint is switched off. */
      readonly eligibility: SurfaceEligibilityResult | null;
    }
  | {
      readonly admitted: false;
      readonly reason: "surface-incompatible";
      readonly eligibility: SurfaceEligibilityResult;
    };

/**
 * Apply Evolution Lab's optional Surface constraint without consulting the
 * current machine. Eligible and degraded routes pass; only a document-level
 * refusal is rejected.
 */
export function evaluateEvolutionSurfaceAdmission(
  document: SurfaceEligibilityDocument,
  required: boolean,
): EvolutionSurfaceAdmission {
  if (!required) return { admitted: true, eligibility: null };
  const eligibility = deriveSurfaceDocumentEligibility(document);
  return surfaceEligibilityHasRoute(eligibility)
    ? { admitted: true, eligibility }
    : { admitted: false, reason: "surface-incompatible", eligibility };
}
