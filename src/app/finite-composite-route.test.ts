import { analyzeFiniteSolidGeneral } from "../fractal/finite-solid";
import {
  hyperMengerSpongeTransforms,
  mengerSponge,
  pentatope,
} from "../fractal/presets";
import type { Transform } from "../fractal/types";
import {
  FINITE_COMPOSITE_MAP_CAP_REASON,
  decideFiniteComposite,
} from "./finite-composite-route";

const FLAT = { order: 1, plane: "xz" } as const;

function construct(transforms: Transform[], dim: 3 | 4) {
  const analysis = analyzeFiniteSolidGeneral(transforms, null, FLAT, 1, dim);
  if (!analysis.construction) throw new Error(analysis.reasons.join("; "));
  return analysis.construction;
}

describe("decideFiniteComposite", () => {
  it("keeps the cells when no map is glass", () => {
    const transforms = mengerSponge();
    const decision = decideFiniteComposite(
      construct(transforms, 3),
      transforms.map(() => 0),
      transforms,
      null,
      FLAT,
    );
    expect(decision.kind).toBe("cells");
  });

  it("keeps the cells when every map is glass", () => {
    const transforms = mengerSponge();
    const decision = decideFiniteComposite(
      construct(transforms, 3),
      transforms.map(() => 1),
      transforms,
      null,
      FLAT,
    );
    expect(decision.kind).toBe("cells");
  });

  it("routes the opaque maps of a mixed 3D block to the attractor", () => {
    const transforms = mengerSponge();
    const media = transforms.map((_, a) => (a === 0 || a === 19 ? 1 : 0));
    const decision = decideFiniteComposite(
      construct(transforms, 3),
      media,
      transforms,
      null,
      FLAT,
    );
    if (decision.kind !== "composite") throw new Error(decision.kind);
    expect(decision.route.dimension).toBe(3);
    expect(decision.route.de.maps).toHaveLength(20);
    expect(decision.route.branches.map((b) => b.index)).toEqual(
      transforms.map((_, a) => a).filter((a) => a !== 0 && a !== 19),
    );
  });

  it("routes a mixed native 4D block with a 4D estimator", () => {
    const transforms = pentatope();
    const media = transforms.map((_, a) => (a === 0 ? 1 : 0));
    const decision = decideFiniteComposite(
      construct(transforms, 4),
      media,
      transforms,
      null,
      FLAT,
    );
    if (decision.kind !== "composite") throw new Error(decision.kind);
    expect(decision.route.dimension).toBe(4);
    expect(decision.route.branches.map((b) => b.index)).toEqual([1, 2, 3, 4]);
  });

  it("refuses, with a reason, a block past the attractor's map cap", () => {
    const transforms = hyperMengerSpongeTransforms();
    const media = transforms.map((_, a) => (a === 0 ? 1 : 0));
    const decision = decideFiniteComposite(
      construct(transforms, 4),
      media,
      transforms,
      null,
      FLAT,
    );
    expect(decision).toEqual({
      kind: "refused",
      reason: FINITE_COMPOSITE_MAP_CAP_REASON,
    });
  });
});
