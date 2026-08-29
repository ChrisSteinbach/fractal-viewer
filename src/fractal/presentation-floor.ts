import type { Vec3 } from "./types";

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

export type PresentationFloorPattern = "solid" | "checker";

/** A renderer-neutral enclosing ball that gives the floor its scale. */
export interface PresentationFloorBall {
  center: Vec3;
  radius: number;
}

/** Authored floor appearance, independent of the geometry it sits under. */
export interface PresentationFloorLook {
  pattern: PresentationFloorPattern;
  /** Checker cell width as a fraction of the presentation-ball radius. */
  tileScale: number;
  /** Emitted radiance in linear light. */
  emission: number;
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
  /** sRGB albedo; renderers decode it before lighting. */
  albedo: Vec3;
  pattern: 0 | 1;
  tileScale: number;
  emission: number;
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
  return {
    y: ball.center[1] - ball.radius * PRESENTATION_FLOOR_DROP,
    fadeStart: ball.radius * PRESENTATION_FLOOR_FADE_START,
    fadeEnd: ball.radius * PRESENTATION_FLOOR_FADE_END,
    ballCenter: [...ball.center],
    ballRadius: ball.radius,
    albedo: [...PRESENTATION_FLOOR_ALBEDO],
    pattern: look.pattern === "checker" ? 1 : 0,
    tileScale: look.tileScale,
    emission: look.emission,
  };
}
