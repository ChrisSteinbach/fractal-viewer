/**
 * Sphere-inversion seed orbits — first-panel smoke (grows into the sheet).
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion.harness.ts
 */
import { mulberry32 } from "../src/fractal/rng";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import {
  ballSeed,
  buildInversionScene,
  enumerateSphereOrbit,
  estimateInversionDistance,
  estimateInversionDistancePaper,
  explicitOrbitDistance,
  makeFoldScratch,
  octahedral6,
} from "./sphere-inversion-orbit";
import type { InversionScene } from "./sphere-inversion-orbit";

const SIZE = Number(process.env.SPHERE_INV_SIZE ?? 160);

function pct(n: number, size: number): string {
  return ((100 * n) / (size * size)).toFixed(1);
}

function render3(scene: InversionScene, size: number): PanelStats {
  const scratch = makeFoldScratch(scene);
  return renderPreview(
    {
      de: (p) => estimateInversionDistance(scene, p, scratch),
      boundingRadius: scene.boundRadius,
      stepScale: 1,
      eyeOffset: [1.1, 0.8, 1.3],
      zoom: 0.6,
    },
    size,
  );
}

describe("sphere-inversion seed orbit", () => {
  it("renders the octahedral pearls", () => {
    const scene = buildInversionScene({
      dim: 3,
      gens: octahedral6(1, 0.62),
      seed: ballSeed(0.3, 3),
      depth: 6,
    });
    const panel = render3(scene, SIZE);
    console.log(
      `hits ${pct(panel.hits, SIZE)}% exhausted ${pct(panel.exhausted, SIZE)}% ` +
        `steps/ray ${(panel.steps / SIZE / SIZE).toFixed(1)} ${panel.ms}ms`,
    );
    writeLabeledContactSheet(
      [{ stats: panel, lines: ["OCT6 R 0.62 SEED 0.3 D6", ""] }],
      1,
      "sphere-inversion-smoke.png",
    );
    expect(panel.hits).toBeGreaterThan(0);
  });

  it("never exceeds the explicit orbit distance", () => {
    const scene = buildInversionScene({
      dim: 3,
      gens: octahedral6(1, 0.62),
      seed: ballSeed(0.3, 3),
      depth: 4,
    });
    const orbit = enumerateSphereOrbit(scene);
    const rng = mulberry32(7);
    const scratch = makeFoldScratch(scene);
    let viol = 0;
    let paperViol = 0;
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Vec3 = [0, 0, 0].map(
        () => (2 * rng() - 1) * scene.boundRadius,
      ) as Vec3;
      const ref = explicitOrbitDistance(3, orbit, p);
      if (ref <= 0) continue;
      n++;
      const est = estimateInversionDistance(scene, p, scratch);
      if (est > ref * (1 + 1e-12) + 1e-15) viol++;
      if (estimateInversionDistancePaper(scene, p, 1, scratch) > ref) {
        paperViol++;
      }
    }
    console.log(
      `orbit ${orbit.count} copies; n ${n} viol ${viol} paper ${paperViol}`,
    );
    expect(viol).toBe(0);
  });
});
