/**
 * The factory module `de-preview-parallel.test.ts` addresses the worker
 * through. Closures cannot cross `worker_threads`, so the test's scenes live
 * here as data plus one deterministic factory: each worker rebuilds the scene
 * from the spec's structured-cloneable args before rendering its tiles, and
 * the host-side serial comparison rebuilds it again through a plain import.
 * Byte identity between the two is the point the "ray" scene is built to
 * prove — its `rayLinear` hook is a closure defined HERE, so the only way the
 * worker can have it is to rebuild this module itself.
 *
 * Deterministic by the parallel path's per-call-site obligation (see
 * `de-preview-parallel.ts`'s header): no `Math.random`, no clock, no
 * import-time state that could differ between a main-thread import and a
 * worker-bundled one. Three scenes are pure functions of their spec; the
 * fourth refuses to build at all, which is the error-propagation pin.
 */
import {
  ESCAPE_STEP_SCALE,
  buildEscapeDE,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import type { DistanceEstimator, PreviewScene } from "./de-preview";
import type { Transform } from "../src/fractal/types";

export interface ParallelTestSceneSpec {
  scene: "sphere" | "mandelbox" | "ray" | "throwing";
}

/** A smooth sphere one seventh short of the origin — the estimator both
 * plain scenes march. */
const sphereDe: DistanceEstimator = (p) => Math.hypot(p[0], p[1], p[2]) - 0.7;

export function parallelTestScene(spec: ParallelTestSceneSpec): PreviewScene {
  switch (spec.scene) {
    case "sphere":
      // No `collect` — the plain default-shading path.
      return {
        de: sphereDe,
        boundingRadius: 1,
        stepScale: 1,
      };
    case "mandelbox": {
      // `chain-speckle-scenes.ts`'s CONTROL row as an inline literal: a
      // single mandelbox map, the system `analyzeEscapeSystem` admits.
      const transform: Transform = {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      };
      const de = buildEscapeDE([transform]);
      const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
      return {
        de: est,
        boundingRadius: 2.5,
        stepScale: ESCAPE_STEP_SCALE,
        // Collect exercises the per-pixel status/hitPos/stepCount stitching.
        collect: true,
      };
    }
    case "ray":
      // The sphere scene plus two hooks, both defined in this module: a
      // per-pixel `rayLinear` composition (a rebuilt closure must render
      // byte-identically) and an explicit march interval.
      return {
        de: sphereDe,
        boundingRadius: 1,
        stepScale: 1,
        rayLinear: (ray) => [
          ray.linear[0] * ((ray.px + 0.5) / ray.imageWidth),
          ray.linear[1],
          ray.linear[2],
        ],
        marchInterval: () => [0, 3],
      };
    case "throwing":
      throw new Error("factory boom");
  }
}
