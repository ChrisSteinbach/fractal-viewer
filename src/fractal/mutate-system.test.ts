import { systemIsFlat } from "./affine4";
import { mutateSystem } from "./mutate-system";
import type { MorphSystem } from "./morph";
import { doubleRotation, sierpinskiTetrahedron, swirlFlame } from "./presets";
import { MIN_OCCUPIED_CELLS, scoreSystem } from "./random-system";
import { mulberry32 } from "./rng";
import { VARIATION_TYPES } from "./types";
import type { Transform } from "./types";

function system(overrides: Partial<MorphSystem> = {}): MorphSystem {
  return {
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    ...overrides,
  };
}

/** Angular distance between two angles, shortest way around the circle
 * (mirrors `morph.ts`'s `nearestAngle` reasoning) — used to check a mutated
 * rotation component against its base value without caring which side of a
 * `±π` wrap either landed on. */
function angularDiff(a: number, b: number): number {
  const raw = Math.abs(a - b) % (2 * Math.PI);
  return raw > Math.PI ? 2 * Math.PI - raw : raw;
}

describe("mutateSystem determinism and purity", () => {
  it("is deterministic for a given seed, including the quality gate's probes", () => {
    const base = system();
    const a = mutateSystem(base, mulberry32(42));
    const b = mutateSystem(base, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("never mutates the base system", () => {
    const base = system({ transforms: swirlFlame() });
    const before = JSON.parse(JSON.stringify(base)) as MorphSystem;
    mutateSystem(base, mulberry32(7));
    expect(base).toEqual(before);
  });
});

describe("mutateSystem structure preservation", () => {
  it("keeps the same number of maps and preserves each map's id", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystem(base, mulberry32(3));
    expect(mutant.transforms).toHaveLength(base.transforms.length);
    expect(mutant.transforms.map((t) => t.id)).toEqual(
      base.transforms.map((t) => t.id),
    );
  });

  it("preserves each map's variation types and order for a non-wildcard mutation", () => {
    const base = system({ transforms: swirlFlame() });
    const mutant = mutateSystem(base, mulberry32(11));
    for (let i = 0; i < base.transforms.length; i++) {
      const baseTypes = (base.transforms[i].variations ?? []).map(
        (v) => v.type,
      );
      const mutantTypes = (mutant.transforms[i].variations ?? []).map(
        (v) => v.type,
      );
      expect(mutantTypes).toEqual(baseTypes);
    }
  });

  it("passes symmetry through value-equal, untouched", () => {
    const base = system({ symmetry: { order: 4, axis: "y" } });
    const mutant = mutateSystem(base, mulberry32(5));
    expect(mutant.symmetry).toEqual({ order: 4, axis: "y" });
  });

  it("keeps a null finalTransform null", () => {
    const base = system({ finalTransform: null });
    const mutant = mutateSystem(base, mulberry32(9));
    expect(mutant.finalTransform).toBeNull();
  });

  it("keeps a present finalTransform present, jittering only its variation weights", () => {
    const finalTransform: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "spherical", weight: 0.8 }],
    };
    const base = system({
      transforms: sierpinskiTetrahedron(),
      finalTransform,
    });
    const mutant = mutateSystem(base, mulberry32(13));
    expect(mutant.finalTransform).not.toBeNull();
    expect(mutant.finalTransform?.position).toEqual(finalTransform.position);
    expect(mutant.finalTransform?.rotation).toEqual(finalTransform.rotation);
    expect(mutant.finalTransform?.scale).toEqual(finalTransform.scale);
    expect(mutant.finalTransform?.variations).toHaveLength(1);
    expect(mutant.finalTransform?.variations?.[0].type).toBe("spherical");
  });

  it("leaves shear, variations, and w absent when the base map carries none of them", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystem(base, mulberry32(21));
    for (const t of mutant.transforms) {
      expect("shear" in t).toBe(false);
      expect("variations" in t).toBe(false);
      expect("w" in t).toBe(false);
    }
  });
});

describe("mutateSystem perturbation", () => {
  it("actually perturbs some rotation or position component", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystem(base, mulberry32(2));
    let changed = false;
    for (let i = 0; i < base.transforms.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        if (
          base.transforms[i].rotation[axis] !==
          mutant.transforms[i].rotation[axis]
        ) {
          changed = true;
        }
        if (
          base.transforms[i].position[axis] !==
          mutant.transforms[i].position[axis]
        ) {
          changed = true;
        }
      }
    }
    expect(changed).toBe(true);
  });

  it("keeps every rotation component within 0.12 rad of the base (mod wrap) for a non-wildcard mutation", () => {
    for (let seed = 0; seed < 20; seed++) {
      const base = system({ transforms: sierpinskiTetrahedron() });
      const mutant = mutateSystem(base, mulberry32(seed));
      for (let i = 0; i < base.transforms.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const diff = angularDiff(
            mutant.transforms[i].rotation[axis],
            base.transforms[i].rotation[axis],
          );
          expect(diff).toBeLessThanOrEqual(0.12 + 1e-9);
        }
      }
    }
  });

  it("keeps every position component within 0.08 of the base for a non-wildcard mutation", () => {
    for (let seed = 0; seed < 20; seed++) {
      const base = system({ transforms: sierpinskiTetrahedron() });
      const mutant = mutateSystem(base, mulberry32(seed));
      for (let i = 0; i < base.transforms.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const diff = Math.abs(
            mutant.transforms[i].position[axis] -
              base.transforms[i].position[axis],
          );
          expect(diff).toBeLessThanOrEqual(0.08 + 1e-9);
        }
      }
    }
  });
});

describe("mutateSystem flatness", () => {
  it("keeps a flat base system flat", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    expect(systemIsFlat(base.transforms)).toBe(true);
    const mutant = mutateSystem(base, mulberry32(15));
    expect(systemIsFlat(mutant.transforms)).toBe(true);
  });

  it("keeps a non-flat (4D) base system non-flat", () => {
    const base = system({
      transforms: doubleRotation(),
      symmetry: { order: 1, axis: "y" },
    });
    expect(systemIsFlat(base.transforms)).toBe(false);
    const mutant = mutateSystem(base, mulberry32(17));
    expect(systemIsFlat(mutant.transforms)).toBe(false);
  });
});

describe("mutateSystem clamps", () => {
  it("keeps every scale magnitude within [0.05, 2] across many seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const base = system({ transforms: sierpinskiTetrahedron() });
      const mutant = mutateSystem(base, mulberry32(seed));
      for (const t of mutant.transforms) {
        for (const v of t.scale) {
          expect(Math.abs(v)).toBeGreaterThanOrEqual(0.05 - 1e-9);
          expect(Math.abs(v)).toBeLessThanOrEqual(2 + 1e-9);
        }
      }
    }
  });

  it("keeps every weight strictly positive across many seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const base = system({ transforms: sierpinskiTetrahedron() });
      const mutant = mutateSystem(base, mulberry32(seed));
      for (const t of mutant.transforms) {
        expect(t.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("mutateSystem wildcard structural kick", () => {
  it("swaps exactly one map's exactly one variation type when every map carries a nonlinear variation", () => {
    const base = system({ transforms: swirlFlame() });
    const mutant = mutateSystem(base, mulberry32(1), { wildcard: true });

    let mapsWithTypeChange = 0;
    for (let i = 0; i < base.transforms.length; i++) {
      const baseTypes = (base.transforms[i].variations ?? []).map(
        (v) => v.type,
      );
      const mutantTypes = (mutant.transforms[i].variations ?? []).map(
        (v) => v.type,
      );
      expect(mutantTypes).toHaveLength(baseTypes.length);
      const diffIndices = baseTypes
        .map((t, j) => (t !== mutantTypes[j] ? j : -1))
        .filter((j) => j >= 0);
      expect(diffIndices.length).toBeLessThanOrEqual(1);
      if (diffIndices.length === 1) {
        mapsWithTypeChange++;
        const changed = mutantTypes[diffIndices[0]];
        expect(changed).not.toBe("linear");
        expect(changed).not.toBe(baseTypes[diffIndices[0]]);
        expect(VARIATION_TYPES).toContain(changed);
      }
    }
    expect(mapsWithTypeChange).toBe(1);
  });

  it("rerolls exactly one map's rotation entirely when no map carries a variation to swap", () => {
    // doubleRotation's two maps carry no `variations` at all, so the
    // wildcard kick's only available branch is the full rotation reroll,
    // regardless of which map the seed picks.
    const base = system({
      transforms: doubleRotation(),
      symmetry: { order: 1, axis: "y" },
    });
    const mutant = mutateSystem(base, mulberry32(2), { wildcard: true });

    // A widened-but-not-rerolled map still moves by at most
    // ROTATION_JITTER * WILDCARD_SPREAD = 0.12 * 2.5 = 0.3 rad per axis; a
    // rerolled map draws a fresh uniform angle in (-π, π) independently of
    // its base value, which clears that bound on at least one axis for this
    // seed (verified empirically, astronomically likely in general).
    let mapsWithBigJump = 0;
    for (let i = 0; i < base.transforms.length; i++) {
      const bigJump = [0, 1, 2].some(
        (axis) =>
          angularDiff(
            mutant.transforms[i].rotation[axis],
            base.transforms[i].rotation[axis],
          ) >
          0.3 + 1e-9,
      );
      if (bigJump) mapsWithBigJump++;
    }
    expect(mapsWithBigJump).toBe(1);
  });
});

describe("mutateSystem quality gate", () => {
  it("lands a mutant that clears a fresh scoreSystem probe for the large majority of seeds mutating Sierpinski", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const SEED_COUNT = 30;
    let passes = 0;
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      // A fresh, independent rng stream -- not a replay of mutateSystem's own
      // generation-time probes -- so this genuinely re-verifies the mutant
      // rather than trivially repeating the check that already accepted it
      // (same pattern as random-system.test.ts's re-probe tests).
      const score = scoreSystem(mutant, mulberry32(seed * 7919 + 1));
      if (score >= MIN_OCCUPIED_CELLS) passes++;
    }
    // Measured (scripts-side sweep, not run here): 300/300 seeds clear a
    // fresh probe for this base -- every one of this test's 30 included.
    // Asserting well below that observed 100% so a future jitter-range
    // retune has room to cost a seed or two without breaking this test.
    expect(passes).toBeGreaterThanOrEqual(28);
  });
});
