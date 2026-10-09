/**
 * The scratch tool's SCENE half (`npm run gpu:scratch`): a preset name or a
 * `#v1=` document decoded into the Surface-relevant document fields, plus the
 * route/target derivation the page-side GPU code consumes. Pure and DOM-free
 * so the scene wiring is unit-tested the way `surface-eligibility.ts` is —
 * the page's GPU work (device, pipelines, dispatch) stays in
 * `gpu-bench/main.ts`'s `?scratch=1` branch.
 *
 * SCOPE, stated as refusals rather than silently dropped fields: the scratch
 * renders the transform system (the seven descent/forward cores' full
 * vocabulary — transforms, final lens, kaleidoscope, hybrid schedule,
 * condensation band) plus a sphere-inversion or shaped finite-solid block's
 * plain frame. What it REFUSES, each with a named reason in `refusals`:
 * Space tiling (the session's clip-pose fit is app machinery — rendering the
 * unposed block would trim nothing and misrepresent the document), the shape
 * trap (a live pose block the scratch does not carry), a general word-tree
 * finite solid (its media/composite routing is the app's), and the balloon
 * echo (a session toggle).
 *
 * The routing itself is NOT re-derived here: `deriveSurfaceEligibility` is
 * the one gate, called with `computeAvailable: true` because the scratch has
 * no fragment fallback — a compute-only family refusing without compute is
 * exactly what the renderer's own create failure would say.
 */

import { systemPartsAreNonFlat } from "../../fractal/affine4";
import {
  buildSurfaceDE,
  deHasFolds,
  type SurfaceDE,
} from "../../fractal/surface-de";
import {
  buildSurfaceDE4,
  deHasFolds4,
  type SurfaceDE4,
} from "../../fractal/surface-de-4d";
import type { EscapeDE } from "../../fractal/escape-de";
import type { TwistAuthored } from "../../fractal/twist";
import type { EscapeDE4 } from "../../fractal/escape-de-4d";
import type { BulbDE } from "../../fractal/bulb-de";
import type { SphereInversionDE } from "../../fractal/sphere-inversion";
import type { MengerDE } from "../../fractal/menger-de";
import type { MengerDE4 } from "../../fractal/menger-de-4d";
import { resolveMengerTwist } from "../../fractal/menger-twist";
import {
  PRESET_FINALS,
  PRESET_FINITE_SOLIDS,
  PRESET_MENGER_TWISTS,
  PRESET_NAMES,
  PRESET_SCHEDULES,
  PRESET_SPHERE_INVERSIONS,
  PRESET_SYMMETRIES,
  PRESET_TRAPS,
  PRESET_TILINGS,
  PRESET_VIEWS,
  presetTransforms,
  type Preset,
} from "../../fractal/presets";
import { resolveSphereInversion } from "../../fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "../../fractal/sphere-inversion";
import type { FiniteSolidAuthored } from "../../fractal/finite-solid";
import type { MengerTwistAuthored } from "../../fractal/menger-twist";
import { buildMengerDE } from "../../fractal/menger-de";
import { buildMengerDE4 } from "../../fractal/menger-de-4d";
import type { CondensationDepthBand } from "../../fractal/condensation-de";
import type {
  HybridSchedule,
  ShapeTrap,
  SymmetryParams,
  Transform,
} from "../../fractal/types";
import { buildEscapeDE4 } from "../../fractal/escape-de-4d";
import { buildEscapeDE } from "../../fractal/escape-de";
import { buildBulbDE } from "../../fractal/bulb-de";
import { buildSphereInversionDE } from "../../fractal/sphere-inversion-de";
import { buildSphereInversionDE4 } from "../../fractal/sphere-inversion-de-4d";
import type { SurfaceGpu4View } from "../../fractal/surface-de-gpu";
import { resolveFiniteSolid } from "../../fractal/finite-solid";
import { rotorMatrix } from "../rotor4";
import { presetRotorPair } from "../preset-view";
import { DEFAULT_SYMMETRY_ORDER, DEFAULT_SYMMETRY_PLANE } from "../state";
import { decodeScene } from "../persist";
import {
  deriveSurfaceEligibility,
  type SurfaceRouteKind,
} from "../surface-eligibility";

/** The kernel core a scratch run renders — the seven descent/forward cores
 * plus the two extra compute families' cores (frame leg only). The CLI's
 * `--core` vocabulary. */
export type ScratchCore =
  | "affine"
  | "fold"
  | "escape"
  | "bulb"
  | "affine4"
  | "fold4"
  | "escape4"
  | "sphereInv"
  | "sphereInv4"
  | "finite"
  | "finite4"
  | "menger"
  | "menger4";

export const SCRATCH_CORES: readonly ScratchCore[] = [
  "affine",
  "fold",
  "escape",
  "bulb",
  "affine4",
  "fold4",
  "escape4",
  "sphereInv",
  "sphereInv4",
  "finite",
  "finite4",
  "menger",
  "menger4",
];

/** The cores with an eval-probe leg. The two extra compute families have no
 * bench-style eval dispatch in the scratch (their agreement machinery lives
 * in the dedicated legs); a scene routing there renders the frame only. */
const PROBE_CORES: ReadonlySet<ScratchCore> = new Set([
  "affine",
  "fold",
  "escape",
  "bulb",
  "affine4",
  "fold4",
  "escape4",
  "menger",
  "menger4",
]);

/** The scene the scratch renders: the Surface-relevant projection of a
 * preset load or a decoded document, in `deriveSurfaceEligibility`'s own
 * vocabulary. */
export interface ScratchScene {
  /** `preset:<name>` or `doc` — provenance in the printed row. */
  source: string;
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  schedule: HybridSchedule | null;
  condensationDepthBand?: CondensationDepthBand;
  sphereInversion: SphereInversionAuthored | null;
  finiteSolid: FiniteSolidAuthored | null;
  /** The chain twist's authored block, as decoded — the escape/escape4
   * builders' fourth argument. */
  chainTwist: TwistAuthored | null;
  /** The Menger-carve block's authored form, as decoded — the route's
   * subject block when present. */
  mengerTwist: MengerTwistAuthored | null;
  /** The scene's own 4D view pose when it carries one — the preset's
   * authored rotor + world `w0`, or the decoded document's `FourDPose`
   * (world `sliceW` preferred, the persisted convention). Null → identity
   * rotor, w0 0. */
  view4: { rotor: number[]; w0: number } | null;
  /** Named refusals — document features the scratch does not render. The
   * scene still routes when the refused feature is compositional (the gate
   * decides marchability); the page prints these beside the verdict. */
  refusals: string[];
}

const NO_TWIST_SYMMETRY: SymmetryParams = {
  order: DEFAULT_SYMMETRY_ORDER,
  plane: DEFAULT_SYMMETRY_PLANE,
};

/** Refusal notes for the compositional blocks the scratch does not render —
 * shared by both scene builders so the wording cannot drift. */
function scratchRefusals(doc: {
  tiling?: unknown;
  shapeTrap?: ShapeTrap | null;
  balloonEcho?: boolean;
  finiteSolid?: FiniteSolidAuthored | null;
}): string[] {
  const refusals: string[] = [];
  if (doc.tiling) {
    refusals.push(
      "Space tiling is not part of the scratch render (the session poses an unposed clip on the chamber content); render this scene in the app.",
    );
  }
  if (doc.shapeTrap) {
    refusals.push(
      "the shape-trap channel is not part of the scratch render (the trap's live pose block is session state)",
    );
  }
  if (doc.balloonEcho) {
    refusals.push(
      "the balloon echo is a session toggle and the scratch renders plain",
    );
  }
  if (doc.finiteSolid && resolveFiniteSolid(doc.finiteSolid).ok) {
    const resolved = resolveFiniteSolid(doc.finiteSolid);
    if (resolved.ok && resolved.value.kind === "general") {
      refusals.push(
        "the general word-tree solid needs the app's media/composite routing; the scratch renders only a shaped construction block",
      );
    }
  }
  return refusals;
}

/** A preset load's scene: `presetTransforms` plus the preset side tables
 * main.ts's preset handler consumes, in the same both-directions shape
 * (absent means clear). Unknown preset → null, which the CLI reports as a
 * bad value — refusing, never clamping. */
export function scratchPresetScene(name: string): ScratchScene | null {
  if (!PRESET_NAMES.includes(name as Preset)) {
    return null;
  }
  const preset = name as Preset;
  const view = PRESET_VIEWS[preset];
  const symmetryEntry = PRESET_SYMMETRIES[preset];
  const symmetry: SymmetryParams = symmetryEntry
    ? { ...symmetryEntry, twist: 0 }
    : NO_TWIST_SYMMETRY;
  return {
    source: `preset:${preset}`,
    transforms: presetTransforms(preset),
    finalTransform: PRESET_FINALS[preset]?.() ?? null,
    symmetry,
    schedule: PRESET_SCHEDULES[preset]?.() ?? null,
    sphereInversion: PRESET_SPHERE_INVERSIONS[preset]?.() ?? null,
    finiteSolid: PRESET_FINITE_SOLIDS[preset] ?? null,
    chainTwist: null,
    mengerTwist: PRESET_MENGER_TWISTS[preset]?.() ?? null,
    view4: view?.fourD
      ? { rotor: rotorMatrix(presetRotorPair(view.fourD)), w0: view.fourD.w0 }
      : null,
    refusals: scratchRefusals({
      tiling: PRESET_TILINGS[preset],
      shapeTrap: PRESET_TRAPS[preset]?.() ?? null,
      finiteSolid: PRESET_FINITE_SOLIDS[preset] ?? null,
    }),
  };
}

/** A decoded document's scene. The payload may carry the `#v1=` prefix or be
 * the bare `v1=` token — the forms a share link and the app's copy
 * affordances produce. Throws (never clamps) when the decoder refuses the
 * string. */
export function scratchDocScene(payload: string): ScratchScene {
  const raw = payload.startsWith("#") ? payload.slice(1) : payload;
  const snapshot = decodeScene(raw);
  if (!snapshot) {
    throw new Error(
      "the --scene/--doc payload did not decode as a scene document",
    );
  }
  const pose = snapshot.fourD;
  const refusals = scratchRefusals(snapshot);
  return {
    source: "doc",
    transforms: snapshot.transforms,
    finalTransform: snapshot.finalTransform ?? null,
    symmetry: snapshot.symmetry,
    schedule: snapshot.schedule ?? null,
    condensationDepthBand: snapshot.condensationDepthBand,
    sphereInversion: snapshot.sphereInversion ?? null,
    finiteSolid: snapshot.finiteSolid ?? null,
    chainTwist: snapshot.chainTwist ?? null,
    mengerTwist: snapshot.mengerTwist ?? null,
    view4: pose
      ? {
          rotor: rotorMatrix(pose.pair),
          w0: pose.sliceW ?? 0,
        }
      : null,
    refusals,
  };
}

/** The route the scratch renders: `deriveSurfaceEligibility`'s answer plus
 * the DE and kernel core each kind builds. `view4` is always materialized
 * (identity + w0 0 default) because every 4D frame spec requires it. */
export interface ScratchRoute {
  kind: SurfaceRouteKind;
  core: ScratchCore;
  de:
    | SurfaceDE
    | EscapeDE
    | BulbDE
    | SurfaceDE4
    | EscapeDE4
    | SphereInversionDE
    | MengerDE
    | MengerDE4
    | null;
  view4: SurfaceGpu4View;
  /** A shaped finite-solid block's construction + displayed level (the
   * `kind: "finite"` targets' whole wire). */
  finiteLevel?: number;
}

const IDENTITY_VIEW4: SurfaceGpu4View = {
  rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  w0: 0,
  sliceHalfW: 0,
};

/** Route + build. Throws with the gate's note when the document routes
 * nowhere, or with the builder's error when the DE build refuses. */
export function deriveScratchRoute(scene: ScratchScene): ScratchRoute {
  const eligibility = deriveSurfaceEligibility(
    scene.transforms,
    scene.finalTransform,
    scene.symmetry,
    { computeAvailable: true },
    scene.schedule,
    null,
    null,
    scene.condensationDepthBand,
    scene.sphereInversion,
    scene.finiteSolid,
    scene.chainTwist,
    scene.mengerTwist,
  );
  if (eligibility.status === "ineligible" || eligibility.kind === null) {
    throw new Error(
      eligibility.note ?? "the scene routes to no Surface renderer",
    );
  }
  const kind = eligibility.kind;
  const view4: SurfaceGpu4View = scene.view4
    ? { rotor: scene.view4.rotor, w0: scene.view4.w0, sliceHalfW: 0 }
    : IDENTITY_VIEW4;
  switch (kind) {
    case "sphairahedron":
    case "sphairahedron4":
      // The gate routes the block; the scratch scene's sphairahedron leg
      // lands with the family's compute cores.
      throw new Error(
        "the sphairahedron route is not wired into the scratch scene yet",
      );
    case "ifs":
    case "ifs4": {
      const fourD = systemPartsAreNonFlat(
        scene.transforms,
        scene.finalTransform,
        scene.symmetry,
      );
      if (fourD) {
        const de = buildSurfaceDE4(
          scene.transforms,
          scene.finalTransform,
          scene.symmetry,
          {
            schedule: scene.schedule ?? undefined,
            condensationDepthBand: scene.condensationDepthBand,
          },
        );
        return {
          kind: "ifs4",
          core: deHasFolds4(de) ? "fold4" : "affine4",
          de,
          view4,
        };
      }
      const de = buildSurfaceDE(
        scene.transforms,
        scene.finalTransform,
        scene.symmetry,
        {
          schedule: scene.schedule ?? undefined,
          condensationDepthBand: scene.condensationDepthBand,
        },
      );
      return {
        kind: "ifs",
        core: deHasFolds(de) ? "fold" : "affine",
        de,
        view4,
      };
    }
    case "escape":
      return {
        kind,
        core: "escape",
        de: buildEscapeDE(
          scene.transforms,
          scene.finalTransform,
          scene.symmetry,
          scene.chainTwist,
        ),
        view4,
      };
    case "bulb":
      return {
        kind,
        core: "bulb",
        de: buildBulbDE(
          scene.transforms,
          scene.finalTransform,
          scene.symmetry,
          scene.chainTwist,
        ),
        view4,
      };
    case "escape4":
      return {
        kind,
        core: "escape4",
        de: buildEscapeDE4(
          scene.transforms,
          scene.finalTransform,
          scene.symmetry,
          scene.chainTwist,
        ),
        view4,
      };
    case "menger":
    case "menger4": {
      const block = scene.mengerTwist;
      if (!block) {
        throw new Error("menger-carve route without the block");
      }
      const resolution = resolveMengerTwist(block);
      if (!resolution.ok) {
        throw new Error(resolution.reasons.join("; "));
      }
      const construction = resolution.construction;
      return {
        kind,
        core: construction.dim === 4 ? "menger4" : "menger",
        de:
          construction.dim === 4
            ? buildMengerDE4(construction)
            : buildMengerDE(construction),
        view4,
      };
    }
    case "sphereInversion":
    case "sphereInversion4": {
      const block = scene.sphereInversion;
      if (!block) {
        throw new Error("sphere-inversion route without the block");
      }
      const resolution = resolveSphereInversion(block);
      if (!resolution.ok) {
        throw new Error(resolution.reasons.join("; "));
      }
      const construction: SphereInversionConstruction = resolution.construction;
      return {
        kind,
        core: construction.dim === 4 ? "sphereInv4" : "sphereInv",
        de:
          construction.dim === 4
            ? buildSphereInversionDE4(construction)
            : buildSphereInversionDE(construction),
        view4,
      };
    }
    case "finiteSolid":
    case "finiteSolid4": {
      const block = scene.finiteSolid;
      if (!block) {
        throw new Error("finite-solid route without the block");
      }
      const resolved = resolveFiniteSolid(block);
      if (!resolved.ok) {
        throw new Error(resolved.reasons.join("; "));
      }
      if (resolved.value.kind === "general") {
        throw new Error(
          "the general word-tree solid needs the app's media/composite routing; the scratch renders only a shaped construction block",
        );
      }
      return {
        kind,
        core: kind === "finiteSolid4" ? "finite4" : "finite",
        de: null,
        view4,
        finiteLevel: resolved.value.level,
      };
    }
  }
}

/** The `--core` gate: absent means the derived core; present must name the
 * core the scene actually routes to — a mismatch is refused with both names,
 * because rendering a different core than the scene routes to would answer a
 * different question than the one asked. Unknown ids refuse the same way. */
export function resolveScratchCore(
  requested: string | null,
  derived: ScratchCore,
): ScratchCore {
  if (requested === null || requested === "") return derived;
  if (!(SCRATCH_CORES as readonly string[]).includes(requested)) {
    throw new Error(
      `unknown --core "${requested}" (the scratch cores: ${SCRATCH_CORES.join(", ")})`,
    );
  }
  if (requested !== derived) {
    throw new Error(
      `--core ${requested} does not match the scene's route (${derived}); drop the flag or pick a scene that routes there`,
    );
  }
  return requested;
}

/** Whether the routed core gets the eval-probe leg. */
export function scratchCoreProbes(core: ScratchCore): boolean {
  return PROBE_CORES.has(core);
}
