import type { Vec3 } from "./types";
import {
  packFloorPentagridUniforms,
  pentagridDerived,
  resolveFloorPentagrid,
  type FloorPentagrid,
} from "./pentagrid-floor";

/**
 * Shared floor geometry, in multiples of the presentation ball's radius.
 *
 * The 1.02R drop is also the certificate used by Surface's analytic shadow
 * corridor: keeping the value here prevents a sampled renderer and an
 * analytic renderer from quietly growing different horizons.
 */
export const PRESENTATION_FLOOR_DROP = 1.02;
export const PRESENTATION_FLOOR_FADE_START = 4;
export const PRESENTATION_FLOOR_FADE_END = 10;

/** Neutral studio-grey sRGB albedo shared by presentation renderers. */
export const PRESENTATION_FLOOR_ALBEDO: Readonly<Vec3> = [0.62, 0.62, 0.62];

export type PresentationFloorPattern = "solid" | "checker" | "pentagrid";

/** A renderer-neutral enclosing ball that gives the floor its scale. */
export interface PresentationFloorBall {
  center: Vec3;
  radius: number;
}

/** Authored floor appearance, independent of the geometry it sits under. */
export interface PresentationFloorLook {
  pattern: PresentationFloorPattern;
  /** Checker cell width as a fraction of the presentation-ball radius.
   * The pentagrid reads the same knob as its rhombus edge metric. */
  tileScale: number;
  /** Emitted radiance in linear light. */
  emission: number;
  /** The pentagrid's sparse authored block — absent fields resolve to the
   * defaults (`resolveFloorPentagrid`), matching the fold-radii persistence
   * rule: a field is written only once its own control moves. */
  pentagrid?: Partial<FloorPentagrid>;
  /** The scene-palette tie: the albedo the scene's palette-linked backdrop
   * derives for the floor (`background.ts`'s `autoFloorAlbedo`, pushed by
   * main.ts). Absent = the neutral {@link PRESENTATION_FLOOR_ALBEDO},
   * byte-identical to every caller and every document that does not tie —
   * the absence-means-classic rule the finish and fold-length fields keep.
   * The grey rule and the checker multiply this albedo exactly as before;
   * the pentagrid's colored rules replace it, and the grout edge stays its
   * own fixed dark grey (a shader-body literal), so the tie is a host-side
   * value only — no shader change, no wire change. */
  albedo?: Vec3;
}

/**
 * World-space floor payload consumed structurally by Surface and Solid.
 * `pattern` is numeric because it crosses both GLSL-uniform and GPU-wire
 * boundaries; the authored string is resolved once by the pure factory.
 */
export interface PresentationFloorSpec {
  y: number;
  fadeStart: number;
  fadeEnd: number;
  ballCenter: Vec3;
  ballRadius: number;
  /** sRGB albedo; renderers decode it before lighting. The neutral studio
   * grey unless the scene-palette tie is engaged (an authored `"auto"` or
   * delivered-flame backdrop), in which case `autoFloorAlbedo`'s derived
   * tint — every mirror (uGroundAlbedo, the WGSL `params.groundAlbedo`,
   * the 32-float wire's own rules) reads it from here. */
  albedo: Vec3;
  /** Numeric because it crosses both GLSL-uniform and GPU-wire boundaries:
   * 0 solid, 1 checker, 2 pentagrid (the uGroundPattern dispatch). */
  pattern: 0 | 1 | 2;
  tileScale: number;
  emission: number;
  /** The pentagrid block RESOLVED against the defaults — present for every
   * pattern, read only by the pentagrid branch. One resolution site keeps
   * the look's sparse form out of the renderers. */
  pentagrid: FloorPentagrid;
  /** The 32-float uniform wire for {@link pentagrid} — packed ONCE per
   * spec build (`pentagridDerived` ∘ `packFloorPentagridUniforms`) so every
   * renderer (the GLSL uniforms, the WGSL shade tail, voxel, cinematic)
   * copies the same bytes instead of re-deriving them. */
  pentagridWire: Float32Array;
}

/**
 * Derive the complete presentation-floor payload without retaining or
 * mutating either input. A missing ball has no meaningful world-space floor.
 */
export function presentationFloorSpec(
  ball: PresentationFloorBall | null,
  look: PresentationFloorLook,
): PresentationFloorSpec | null {
  if (!ball) return null;
  const pentagrid = resolveFloorPentagrid(look.pentagrid);
  return {
    y: ball.center[1] - ball.radius * PRESENTATION_FLOOR_DROP,
    fadeStart: ball.radius * PRESENTATION_FLOOR_FADE_START,
    fadeEnd: ball.radius * PRESENTATION_FLOOR_FADE_END,
    ballCenter: [...ball.center],
    ballRadius: ball.radius,
    albedo:
      look.albedo !== undefined
        ? [...look.albedo]
        : [...PRESENTATION_FLOOR_ALBEDO],
    pattern:
      look.pattern === "checker" ? 1 : look.pattern === "pentagrid" ? 2 : 0,
    tileScale: look.tileScale,
    emission: look.emission,
    pentagrid,
    pentagridWire: packFloorPentagridUniforms(
      pentagridDerived(pentagrid, ball.radius, look.tileScale),
      pentagrid,
    ),
  };
}
