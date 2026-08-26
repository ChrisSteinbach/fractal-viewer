/**
 * The Surface mode gate as a pure derivation: document in,
 * `{status, note, kind, recovery?}` out — `legend-spec.ts`'s pattern applied to the
 * app's most consequential branch, so the routing across five analyzers is
 * TESTABLE instead of living as an untestable closure inside `main()`.
 * `main.ts`'s `refreshSurfaceEligibility` is now one call into this plus one
 * `ui.setSurfaceEligibility(...)`, and every decision leaf — which gate wins,
 * which cap applies, which sentence the user reads — is pinned by
 * `surface-eligibility.test.ts` over the shipped presets.
 *
 * This is the first slice of unifying the gate with `surfaceSession.start`'s
 * OWN re-derivation of the same routing (which still infers the escape4 and
 * bulb arms by elimination rather than by gate); the `kind` field exists so
 * that second slice can consume the one shared answer instead of
 * re-classifying.
 */

import { systemPartsAreNonFlat, toTransform4 } from "../fractal/affine4";
import { analyzeBulbSystem } from "../fractal/bulb-de";
import { analyzeEscapeSystem, systemHasPowerLink } from "../fractal/escape-de";
import { analyzeEscapeSystem4 } from "../fractal/escape-de-4d";
import { systemHasActiveQSquare } from "../fractal/qjulia-de";
import { analyzeSurfaceSystem, transformSigmas } from "../fractal/surface-de";
import type { SurfaceEligibilityStatus } from "../fractal/surface-de";
import {
  analyzeSurfaceSystem4,
  systemFoldShaped4,
  transformSigmas4,
} from "../fractal/surface-de-4d";
import {
  buildScheduleTable,
  effectiveSymmetryOrder,
  resolveScheduleDepth,
  systemHasChaos,
  transformHasEmitter,
} from "../fractal/chaos-game";
import type {
  HybridSchedule,
  ShapeTrap,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { SURFACE_MAX_MAPS, SURFACE_MAX_RECORDS } from "./surface-material";
import { SURFACE4_MAX_MAPS } from "./surface-material-4d";

/**
 * The renderer family the document routes to if Surface is entered — the
 * vocabulary `surface-compute.ts`'s `SurfaceComputeTarget` uses, minus the
 * engine split (compute vs fragment is a machine question, not a document
 * one). `null` exactly when the status is `"ineligible"`: a refused document
 * routes nowhere.
 */
export type SurfaceRouteKind = "ifs" | "escape" | "bulb" | "ifs4" | "escape4";

/** A narrowly-scoped action the mode gate can offer to resolve the refusal
 * it is currently disclosing. This is structured analyzer output, never
 * inferred by matching user-facing prose. */
export type SurfaceEligibilityRecovery = "disableShapeTrapGeometry";

export interface SurfaceEligibilityResult {
  status: SurfaceEligibilityStatus;
  /** The user-facing sentence beside the gate — `null` for a clean pass. */
  note: string | null;
  kind: SurfaceRouteKind | null;
  recovery?: SurfaceEligibilityRecovery;
}

/**
 * qsquare's complement, the ONE copy: a quaternion square renders as a LINK
 * in an escape-time chain, so both the 3D and 4D refusal arms append this
 * clause to name the way out — and a copy-edit that reached only one of the
 * two was exactly the drift the old duplicated literals invited (they were
 * the only duplicated prose in all of main.ts).
 */
const QSQUARE_CHAIN_HINT =
  "a quaternion square renders only as a link in an escape-time chain — give it a map of its own beside a fold";

/** The tracers' slot unit: active maps, on the BARE count in both views
 * (both tracers sweep kaleidoscope sectors instead of expanding them into
 * slots, so order costs nothing). */
function activeMapCount(transforms: Transform[]): number {
  return transforms.filter((t) => (t.weight ?? 1) > 0).length;
}

/** Storage records used by a condensation descent: recursive maps occupy one
 * each, while every active samplable emitter occupies one inverse record per
 * effective symmetry copy. The shade/material side stays one slot per base
 * transform, but the shared GLSL/WGSL record ceiling must price the expanded
 * C0 union explicitly. */
function condensationRecordCount(
  transforms: Transform[],
  symmetry: SymmetryParams,
): number {
  let recursive = 0;
  let emitters = 0;
  transforms.forEach((transform) => {
    if ((transform.weight ?? 1) <= 0) return;
    if (transformHasEmitter(transform)) emitters++;
    else recursive++;
  });
  return (
    recursive +
    emitters * effectiveSymmetryOrder(symmetry.order, transforms.length)
  );
}

function hasActiveEmitter(transforms: Transform[]): boolean {
  return transforms.some(
    (transform) =>
      (transform.weight ?? 1) > 0 && transformHasEmitter(transform),
  );
}

/**
 * Number of B inverse records the scheduled descent must carry. This reads
 * the point engine's prepared-table convention rather than treating
 * `weight > 0` as a second selection definition: when B's weighted table is
 * disabled (unit weights, or the all-zero fallback) every entry is selected
 * uniformly; otherwise only a positive-width cumulative interval contributes
 * support geometry.
 */
function scheduleRecordCount(schedule: HybridSchedule | null): number {
  if (resolveScheduleDepth(schedule) === 0 || schedule === null) return 0;
  const table = buildScheduleTable(schedule.transforms);
  if (!table.weighted) return table.count;
  let count = 0;
  let previous = 0;
  for (const cumulative of table.cumulative) {
    if (cumulative > previous) count++;
    previous = cumulative;
  }
  return count;
}

/** Trap geometry's deliberately narrower admission inside an otherwise
 * marchable escape-time route. Color trapping is defined for every forward
 * orbit, but pulling a shape SDF back into distance geometry relies on the
 * fold-only chain's conformal derivative scale. Return the exact UI refusal,
 * or null when geometry is off / the active word satisfies that contract. */
export function surfaceTrapGeometryRestriction(
  transforms: Transform[],
  fourD: boolean,
): string | null {
  if (systemHasPowerLink(transforms)) {
    return (
      "Shape-trap geometry requires a fold-only conformal escape chain; " +
      "power maps are unsupported. Turn Geometry off to keep this trap as a color source."
    );
  }
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if ((transform.weight ?? 1) <= 0) continue;
    const sigmas = fourD
      ? transformSigmas4(toTransform4(transform))
      : transformSigmas(transform);
    const ratio = sigmas.min > 0 ? sigmas.max / sigmas.min : Infinity;
    // Geometry needs a scalar derivative scale, not the inverse-descent
    // gate's looser "conformal-enough" performance class. Rotation and
    // uniform scale resolve to exact equal singular values in both helpers;
    // a tiny numerical allowance covers the eigen solve used only by an
    // authored shear (which remains refused at any meaningful magnitude).
    if (ratio > 1 + 1e-9) {
      return (
        `Shape-trap geometry requires conformal fold links; map ${i + 1} ` +
        `is anisotropic (ratio ${ratio.toFixed(2)}). Turn Geometry off to ` +
        "keep this trap as a color source."
      );
    }
  }
  return null;
}

function trapGeometryRefusal(
  transforms: Transform[],
  shapeTrap: ShapeTrap | null,
  fourD: boolean,
): string | null {
  return shapeTrap?.geometry === true
    ? surfaceTrapGeometryRestriction(transforms, fourD)
    : null;
}

function inverseDescentTrapGeometryRefusal(
  shapeTrap: ShapeTrap | null,
): string | null {
  return shapeTrap?.geometry === true
    ? "Shape-trap geometry is available only on conformal fold-only escape chains; this document routes to the inverse-descent attractor tracer. Turn Geometry off to keep the trap as authored color state."
    : null;
}

/**
 * Classify the document for the Surface gate: the pure marchability analyses
 * (cheap — no bounding probe) plus the tracers' uniform-array caps, routed on
 * the DOCUMENT's flatness — the same predicate `cloudParams` stamps on
 * generation requests, never an async-cached view flag, so the answer tracks
 * edits synchronously. `computeAvailable` is the one machine fact the
 * document cannot answer (no adapter, a latched device loss, or the
 * deliberate `?surfacegl` flag), injected so this stays pure and testable.
 */
export function deriveSurfaceEligibility(
  transforms: Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  opts: { computeAvailable: boolean },
  schedule: HybridSchedule | null = null,
  shapeTrap: ShapeTrap | null = null,
): SurfaceEligibilityResult {
  const scheduleRecords = scheduleRecordCount(schedule);
  const hasSchedule = scheduleRecords > 0;
  const hasChaos = systemHasChaos(transforms);
  // A 4D document routes to the 4D analysis — what used to be this gate's
  // blanket "extends into 4D" disqualifier is now the 4D tracer's
  // admission ticket.
  if (systemPartsAreNonFlat(transforms, finalTransform, symmetry)) {
    const analysis = analyzeSurfaceSystem4(
      transforms,
      finalTransform,
      schedule,
    );
    if (analysis.status === "ineligible") {
      // Schedules and graph-directed chi are defined only for inverse
      // descent. Falling through to a forward escape renderer here would
      // silently drop B or the transition graph and render a different
      // object, so inverse refusal is terminal whenever either is live.
      if (hasSchedule || hasChaos) {
        return {
          status: "ineligible",
          note: analysis.reasons.join("; "),
          kind: null,
        };
      }
      // The 4D IFS gate's FORWARD-ORBIT complement, the 3D arm's escape
      // clause one dimension up. Reported through the "degraded" channel
      // for the same reason: the note has to name the different object
      // about to be rendered.
      const escape4 = analyzeEscapeSystem4(
        transforms,
        finalTransform,
        symmetry,
      );
      if (escape4.status === "eligible") {
        // The chain's own cap is the 4D tracer's map cap — one `GpuMap4`
        // per LINK on the maps binding, and eligibility is one answer
        // whatever engine runs it (the 3D arm's reasoning, where the cap
        // comes from the fragment fallback's uniform array instead).
        const links = activeMapCount(transforms);
        if (links > SURFACE4_MAX_MAPS) {
          return {
            status: "ineligible",
            note: `${links} chain links (the escape-time tracer carries at most ${SURFACE4_MAX_MAPS})`,
            kind: null,
          };
        }
        const geometryRefusal = trapGeometryRefusal(
          transforms,
          shapeTrap,
          true,
        );
        if (geometryRefusal) {
          return {
            status: "ineligible",
            note: geometryRefusal,
            kind: null,
            recovery: "disableShapeTrapGeometry",
          };
        }
        // Compute-only, exactly as fold-shaped 4D systems are — an escape
        // chain IS fold-shaped, and the fragment 4D tracer carries no
        // forward-orbit GLSL.
        if (!opts.computeAvailable) {
          return {
            status: "ineligible",
            note: "4D escape-time chains render on WebGPU compute, which is unavailable here",
            kind: null,
          };
        }
        return {
          status: "degraded",
          note:
            links > 1
              ? `Escape-time render: these ${links} maps reach out of the w = 0 hyperplane and do not all contract, so Surface marches the w-slice of the escape-time set of the chain they form — one link per orbit step — rather than an IFS attractor.`
              : "Escape-time render: this 4D fold does not contract, so Surface marches the w-slice of its escape-time set rather than an IFS attractor.",
          kind: "escape4",
        };
      }
      // qsquare's complement, one dimension up — see the 3D arm below for
      // the full reasoning. A 4D quaternion square DOES render, as a link
      // in an escape chain, so this clause survives only for the shapes
      // that gate refuses (a LONE one, or one chained with a triplex
      // power).
      const reasons4 = analysis.reasons.slice();
      if (systemHasActiveQSquare(transforms, finalTransform)) {
        reasons4.push(QSQUARE_CHAIN_HINT);
      }
      return { status: "ineligible", note: reasons4.join("; "), kind: null };
    }
    // Fold-shaped 4D systems render ONLY on the WebGPU compute path — the
    // fragment 4D tracer carries no fold GLSL (the 3D fold GLSL already sits
    // at Mesa's link cliff; a 243-branch 4D body there would be
    // unshippable), so with compute unavailable the mode refuses with the
    // reason rather than letting a fold-blind tracer render the wrong
    // object.
    if (
      systemFoldShaped4(transforms, finalTransform) &&
      !opts.computeAvailable
    ) {
      return {
        status: "ineligible",
        note: "4D folds render on WebGPU compute, which is unavailable here",
        kind: null,
      };
    }
    const geometryRouteRefusal = inverseDescentTrapGeometryRefusal(shapeTrap);
    if (geometryRouteRefusal) {
      return {
        status: "ineligible",
        note: geometryRouteRefusal,
        kind: null,
        recovery: "disableShapeTrapGeometry",
      };
    }
    // The 4D tracer's uniform cap. No symmetry multiplier — the 4D descent
    // sweeps kaleidoscope sectors around the base maps, so slots are active
    // maps 1:1 at any order.
    const records4 =
      condensationRecordCount(transforms, symmetry) + scheduleRecords;
    if (records4 > SURFACE4_MAX_MAPS) {
      const countLabel = hasSchedule
        ? hasActiveEmitter(transforms)
          ? "map/emitter/schedule records"
          : "map/schedule records"
        : hasActiveEmitter(transforms)
          ? "map/emitter records"
          : "maps";
      return {
        status: "ineligible",
        note: `${records4} ${countLabel} (the 4D surface tracer carries at most ${SURFACE4_MAX_MAPS})`,
        kind: null,
      };
    }
    if (analysis.status === "degraded") {
      return {
        status: "degraded",
        note: `Anisotropic maps (ratio ${analysis.anisotropy.toFixed(2)}): marched conservatively.`,
        kind: "ifs4",
      };
    }
    return { status: "eligible", note: null, kind: "ifs4" };
  }

  const analysis = analyzeSurfaceSystem(transforms, finalTransform, schedule);
  if (analysis.status === "ineligible") {
    // As in 4D above, no forward renderer consumes a scheduled B word or
    // graph transition state. Keep inverse refusal terminal instead of
    // admitting an attractive but confidently wrong A-only escape object.
    if (hasSchedule || hasChaos) {
      return {
        status: "ineligible",
        note: analysis.reasons.join("; "),
        kind: null,
      };
    }
    // The escape-time complement: a single non-contracting pure-fold map —
    // the canonical Mandelbox parameterization — has no IFS attractor, but
    // Surface can march its escape-time set instead. Reported through the
    // "degraded" channel so the mode's note names the different object being
    // rendered.
    const escape = analyzeEscapeSystem(transforms, finalTransform, symmetry);
    if (escape.status === "eligible") {
      // The chain's own uniform cap: the WebGL fallback arm carries one
      // uEscM/uEscT/uEscParams slot per LINK, and eligibility is one answer
      // for both engines — so the fragment tracer's cap is the mode's cap
      // even though the compute arm's storage list has none.
      const links = activeMapCount(transforms);
      if (links > SURFACE_MAX_MAPS) {
        return {
          status: "ineligible",
          note: `${links} chain links (the escape-time tracer carries at most ${SURFACE_MAX_MAPS})`,
          kind: null,
        };
      }
      const geometryRefusal = trapGeometryRefusal(transforms, shapeTrap, false);
      if (geometryRefusal) {
        return {
          status: "ineligible",
          note: geometryRefusal,
          kind: null,
          recovery: "disableShapeTrapGeometry",
        };
      }
      return {
        status: "degraded",
        note:
          links > 1
            ? // The hybrid chain: the transform list IS the formula
              // sequence, so name the object as a chain rather than as
              // "the canonical Mandelbox". Cross-family power links split
              // the sentence again, because a chain may hold a POWER link
              // and "these N folds" is then simply false.
              systemHasPowerLink(transforms)
              ? `Escape-time render: these ${links} maps form a hybrid formula chain — folds and power maps in one sequence — so Surface marches its escape-time set, one link per orbit step, rather than an IFS attractor.`
              : `Escape-time render: these ${links} folds do not all contract, so Surface marches the escape-time set of the chain they form — one link per orbit step — rather than an IFS attractor.`
            : "Escape-time render: this fold does not contract, so Surface marches its escape-time set — the canonical Mandelbox object — rather than an IFS attractor.",
        kind: "escape",
      };
    }
    // The escape family's second complement: a single pure triplex-power
    // map. Same channel and same reason as the fold arm above — the note
    // names the different object being rendered, because a user who authored
    // a `bulb` map and pressed Surface has no other way to learn that what
    // they get is an escape-time set rather than an attractor.
    if (
      analyzeBulbSystem(transforms, finalTransform, symmetry).status ===
      "eligible"
    ) {
      if (shapeTrap?.geometry === true) {
        return {
          status: "ineligible",
          note:
            "Shape-trap geometry requires a fold-only conformal escape chain; " +
            "the Mandelbulb is a power map. Turn Geometry off to keep this trap as a color source.",
          kind: null,
          recovery: "disableShapeTrapGeometry",
        };
      }
      return {
        status: "degraded",
        note: "Mandelbulb render: Surface marches the escape-time set of this triplex power — the classic Mandelbulb — rather than an IFS attractor.",
        kind: "bulb",
      };
    }
    // qsquare's complement: unlike the fold and bulb arms above, there is
    // no third renderer to route to — a dedicated quaternion-Julia tracer
    // is a measured won't-do (`scripts/qjulia-beauty.harness.ts`: smooth at
    // every zoom level, no fractal detail), so the honest fix is the
    // refusal with the way out named. Appended rather than substituted — a
    // system can be ineligible for several reasons at once, and this clause
    // must stay true regardless of what else is wrong with the document.
    const reasons = analysis.reasons.slice();
    if (systemHasActiveQSquare(transforms, finalTransform)) {
      reasons.push(QSQUARE_CHAIN_HINT);
    }
    return { status: "ineligible", note: reasons.join("; "), kind: null };
  }
  const geometryRouteRefusal = inverseDescentTrapGeometryRefusal(shapeTrap);
  if (geometryRouteRefusal) {
    return {
      status: "ineligible",
      note: geometryRouteRefusal,
      kind: null,
      recovery: "disableShapeTrapGeometry",
    };
  }
  // The tracer's uniform cap, on the BARE active-map count: the descent
  // sweeps kaleidoscope sectors around the base maps, so order costs no
  // slots and every order is admissible.
  const records =
    condensationRecordCount(transforms, symmetry) + scheduleRecords;
  if (records > SURFACE_MAX_RECORDS) {
    const countLabel = hasSchedule
      ? hasActiveEmitter(transforms)
        ? "map/emitter/schedule records"
        : "map/schedule records"
      : hasActiveEmitter(transforms)
        ? "map/emitter records"
        : "maps";
    return {
      status: "ineligible",
      note: `${records} ${countLabel} (the surface tracer carries at most ${SURFACE_MAX_RECORDS})`,
      kind: null,
    };
  }
  if (analysis.status === "degraded") {
    return {
      status: "degraded",
      note: `Anisotropic maps (ratio ${analysis.anisotropy.toFixed(2)}): marched conservatively.`,
      kind: "ifs",
    };
  }
  return { status: "eligible", note: null, kind: "ifs" };
}
