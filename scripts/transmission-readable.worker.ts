/** Worker half of the tiled readable-transmission still and motion renderer. */
import { parentPort } from "node:worker_threads";
import { renderBentTransmission } from "./transmission-bend-study";
import {
  BEND_REFERENCE_OPTIONS,
  type BendVisualPose,
  createBendVisualFixture,
  proceduralFloor,
} from "./transmission-bend-fixtures";
import type { PreviewRegion } from "./de-preview";

type RenderTask = {
  id: number;
  key: "menger3" | "native4" | "analytic3" | "analytic4";
  pose?: unknown;
  rear: boolean;
  size: number;
  region: PreviewRegion;
  options: {
    bendOnset: "none" | "weighted" | "hard";
    transmit?: number;
  };
};

if (!parentPort)
  throw new Error("transmission readable worker needs parentPort");

function sum(values: Record<string, number>) {
  return Object.fromEntries(Object.entries(values));
}

parentPort.on("message", (task: RenderTask) => {
  try {
    const fixture = createBendVisualFixture(
      task.key,
      task.pose as BendVisualPose | undefined,
      task.rear,
    );
    const panel = renderBentTransmission(
      fixture,
      task.size,
      {
        ...BEND_REFERENCE_OPTIONS,
        ...task.options,
        maxLayers: 4096,
        maxSamples: 4096,
        residualTolerance: 0,
        terminalRadiance: proceduralFloor(fixture.scene.boundingRadius),
      },
      task.region,
    );
    const rgb = panel.stats.rgb;
    const transferredRgb = new ArrayBuffer(rgb.byteLength);
    new Uint8Array(transferredRgb).set(rgb);
    const sampleMaximum = Math.max(0, ...panel.sampleCounts);
    parentPort!.postMessage(
      {
        id: task.id,
        region: task.region,
        rgb: transferredRgb,
        summary: {
          stats: {
            hits: panel.stats.hits,
            evals: panel.stats.evals,
            steps: panel.stats.steps,
            exhausted: panel.stats.exhausted,
            rendererMs: panel.stats.ms,
          },
          calls: panel.calls,
          unresolved: panel.unresolved,
          rearHits: panel.rearHits,
          frontThenGuard: panel.frontThenGuard,
          attributionCounts: sum(panel.attributionCounts),
          work: sum(panel.work),
          termination: sum(panel.termination),
          bending: {
            bentPixels: panel.bending.bentPixels,
            reversalStops: panel.bending.reversalStops,
            offsetLimitedPixels: panel.bending.offsetLimitedPixels,
            maximumLateralFraction: panel.bending.maximumLateralFraction,
            meanStrength: panel.bending.meanStrength,
            pixels: task.region.width * task.region.height,
          },
          sampleMaximum,
        },
      },
      [transferredRgb],
    );
  } catch (error) {
    parentPort!.postMessage({
      id: task.id,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
});
