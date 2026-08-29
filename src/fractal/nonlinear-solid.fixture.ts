import type { Transform } from "./types";

/** Seed shared by the deterministic unit fixture and production-browser
 * qualification. Keeping it beside the authored document prevents those two
 * paths from quietly exercising different stochastic itineraries. */
export const NONLINEAR_SOLID_FIXTURE_SEED = 0x51d0cafe;

/**
 * The canonical two-map linear + swirl document used to qualify sampled
 * Solid. A fresh object is returned so callers may hand it to reducers or
 * persistence code without mutating the standing fixture.
 */
export function canonicalTwoMapSolidSystem(): Transform[] {
  return [
    {
      id: 0,
      position: [-0.34, 0.08, -0.06],
      rotation: [0.11, -0.17, 0.07],
      scale: [0.48, 0.44, 0.42],
      variations: [
        { type: "linear", weight: 0.72 },
        { type: "swirl", weight: 0.28 },
      ],
    },
    {
      id: 1,
      position: [0.36, -0.1, 0.09],
      rotation: [-0.09, 0.19, -0.05],
      scale: [0.45, 0.49, 0.41],
      variations: [
        { type: "linear", weight: 0.78 },
        { type: "swirl", weight: 0.22 },
      ],
    },
  ];
}

/** Julia final-transform lens used for the canonical fixture's separately
 * seeded stochastic qualification leg. */
export function stochasticJuliaSolidLens(): Transform {
  return {
    id: 2,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "julia", weight: 1 }],
  };
}
