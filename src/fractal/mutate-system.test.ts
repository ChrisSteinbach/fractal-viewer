import { systemIsFlat, systemPartsAreNonFlat } from "./affine4";
import {
  MUTATION_DOMAINS,
  SEEDED_MUTATION_ALGORITHM_VERSION,
  mutateSystem,
  mutateSystemSeeded,
} from "./mutate-system";
import type { MutationDomain } from "./mutate-system";
import type { MorphSystem } from "./morph";
import { doubleRotation, sierpinskiTetrahedron, swirlFlame } from "./presets";
import { MIN_OCCUPIED_CELLS, scoreSystem } from "./random-system";
import { mulberry32 } from "./rng";
import { SURFACE_FINISH_SHININESS_FLOOR } from "./surface-finish";
import { VARIATION_TYPES } from "./types";
import type { Transform } from "./types";

function system(overrides: Partial<MorphSystem> = {}): MorphSystem {
  return {
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
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

/**
 * `mutateSystem(base, mulberry32(seed))` — the plain, non-wildcard
 * mutation of the Sierpinski-tetrahedron base below — is a pure function of
 * `seed` (proved by the determinism test below, and `mutateSystem` never
 * mutates its `base` argument — see "never mutates the base system" below).
 * Five tests spread across three describe blocks each used to independently
 * re-roll their own 20-30 seed copy of exactly this batch just to inspect a
 * different field; this corpus pays that cost once and every one of them
 * reads it read-only (nothing here, including `scoreSystem`, mutates what it
 * reads).
 *
 * Sized to the largest consumer (the quality-gate test's 30 seeds) so the
 * four 20-seed tests can share the same corpus by reading its first 20
 * entries, rather than rolling a second, separately-sized batch of the
 * identical (base, seed) pairs.
 */
const SIERPINSKI_MUTATION_BASE = system({
  transforms: sierpinskiTetrahedron(),
});
const SIERPINSKI_MUTATION_CORPUS_SIZE = 30;
const SIERPINSKI_MUTATION_CORPUS: MorphSystem[] = Array.from(
  { length: SIERPINSKI_MUTATION_CORPUS_SIZE },
  (_, seed) => mutateSystem(SIERPINSKI_MUTATION_BASE, mulberry32(seed)),
);

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
    const base = system({ symmetry: { order: 4, plane: "xz" } });
    const mutant = mutateSystem(base, mulberry32(5));
    expect(mutant.symmetry).toEqual({ order: 4, plane: "xz" });
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
      const mutant = SIERPINSKI_MUTATION_CORPUS[seed];
      for (let i = 0; i < SIERPINSKI_MUTATION_BASE.transforms.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const diff = angularDiff(
            mutant.transforms[i].rotation[axis],
            SIERPINSKI_MUTATION_BASE.transforms[i].rotation[axis],
          );
          expect(diff, `seed ${seed}`).toBeLessThanOrEqual(0.12 + 1e-9);
        }
      }
    }
  });

  it("keeps every position component within 0.08 of the base for a non-wildcard mutation", () => {
    for (let seed = 0; seed < 20; seed++) {
      const mutant = SIERPINSKI_MUTATION_CORPUS[seed];
      for (let i = 0; i < SIERPINSKI_MUTATION_BASE.transforms.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const diff = Math.abs(
            mutant.transforms[i].position[axis] -
              SIERPINSKI_MUTATION_BASE.transforms[i].position[axis],
          );
          expect(diff, `seed ${seed}`).toBeLessThanOrEqual(0.08 + 1e-9);
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
      symmetry: { order: 1, plane: "xz" },
    });
    expect(systemIsFlat(base.transforms)).toBe(false);
    const mutant = mutateSystem(base, mulberry32(17));
    expect(systemIsFlat(mutant.transforms)).toBe(false);
  });
});

describe("mutateSystem clamps", () => {
  it("keeps every scale magnitude within [0.05, 2] across many seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const mutant = SIERPINSKI_MUTATION_CORPUS[seed];
      for (const t of mutant.transforms) {
        for (const v of t.scale) {
          expect(Math.abs(v), `seed ${seed}`).toBeGreaterThanOrEqual(
            0.05 - 1e-9,
          );
          expect(Math.abs(v), `seed ${seed}`).toBeLessThanOrEqual(2 + 1e-9);
        }
      }
    }
  });

  it("keeps every weight strictly positive across many seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const mutant = SIERPINSKI_MUTATION_CORPUS[seed];
      for (const t of mutant.transforms) {
        expect(t.weight, `seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it(
    "preserves a negative variation weight's sign, clamping its magnitude into [0.05, 2], across many seeds",
    // This base (negative variation weights) is unique to this test --
    // nothing else in the file rolls it -- so there is no batch to
    // share it with, and its own 200-seed sweep (mutateSystem's internal
    // quality gate included) sits close enough to vitest's 5s default
    // under full-suite CPU contention to warrant the same generous ceiling
    // random-system.test.ts's 200-seed sweeps use.
    { timeout: 30_000 },
    () => {
      const variedMap: Transform = {
        id: 0,
        position: [0, 0.8, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        variations: [
          { type: "mandelbox", weight: -1.5 },
          { type: "swirl", weight: -0.04 },
          { type: "spherical", weight: -6 },
        ],
      };
      const finalTransform: Transform = {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: -0.8 }],
      };
      const base = system({
        transforms: [variedMap, ...sierpinskiTetrahedron().slice(1)],
        finalTransform,
      });

      for (let seed = 0; seed < 200; seed++) {
        const mutant = mutateSystem(base, mulberry32(seed));
        expect(mutant.transforms[0].variations, `seed ${seed}`).toHaveLength(3);
        expect(mutant.finalTransform?.variations, `seed ${seed}`).toHaveLength(
          1,
        );
        const weights = [
          ...mutant.transforms[0].variations!.map((v) => v.weight),
          ...mutant.finalTransform!.variations!.map((v) => v.weight),
        ];
        for (const weight of weights) {
          expect(weight, `seed ${seed}`).toBeLessThan(0);
          expect(Math.abs(weight), `seed ${seed}`).toBeGreaterThanOrEqual(
            0.05 - 1e-9,
          );
          expect(Math.abs(weight), `seed ${seed}`).toBeLessThanOrEqual(
            2 + 1e-9,
          );
        }
      }
    },
  );

  it(
    "keeps a positive variation weight positive with magnitude in [0.05, 2] across many seeds",
    // Mirrors the negative-weight test above (its own unique base,
    // same 200-seed shape, same reason for the generous timeout).
    { timeout: 30_000 },
    () => {
      const variedMap: Transform = {
        id: 0,
        position: [0, 0.8, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        variations: [
          { type: "mandelbox", weight: 1.5 },
          { type: "swirl", weight: 0.04 },
          { type: "spherical", weight: 6 },
        ],
      };
      const finalTransform: Transform = {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: 0.8 }],
      };
      const base = system({
        transforms: [variedMap, ...sierpinskiTetrahedron().slice(1)],
        finalTransform,
      });

      for (let seed = 0; seed < 200; seed++) {
        const mutant = mutateSystem(base, mulberry32(seed));
        expect(mutant.transforms[0].variations, `seed ${seed}`).toHaveLength(3);
        expect(mutant.finalTransform?.variations, `seed ${seed}`).toHaveLength(
          1,
        );
        const weights = [
          ...mutant.transforms[0].variations!.map((v) => v.weight),
          ...mutant.finalTransform!.variations!.map((v) => v.weight),
        ];
        for (const weight of weights) {
          expect(weight, `seed ${seed}`).toBeGreaterThan(0);
          expect(Math.abs(weight), `seed ${seed}`).toBeGreaterThanOrEqual(
            0.05 - 1e-9,
          );
          expect(Math.abs(weight), `seed ${seed}`).toBeLessThanOrEqual(
            2 + 1e-9,
          );
        }
      }
    },
  );
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
      symmetry: { order: 1, plane: "xz" },
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

  it("swaps into a warp the map does not already carry, never merging two entries of one type", () => {
    // Two nonlinear warps per map, so the swap has a same-map type it could
    // land on. It must not: two `swirl` entries are just swirl at the summed
    // weight, so such a "structural kick" changes nothing structural — and
    // one entry per type is the lane budget `flame-gpu.ts`'s Slot assumes.
    const twoWarps = (
      id: number,
      position: Transform["position"],
    ): Transform => ({
      id,
      position,
      rotation: [0, 0, 0.4],
      scale: [0.6, 0.6, 0.6],
      variations: [
        { type: "spherical", weight: 0.5 },
        { type: "swirl", weight: 0.4 },
        { type: "linear", weight: 0.6 },
      ],
    });
    const base = system({
      transforms: [twoWarps(0, [0.3, 0.2, 0]), twoWarps(1, [-0.3, -0.2, 0])],
    });

    for (let seed = 0; seed < 100; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed), { wildcard: true });
      for (const t of mutant.transforms) {
        const types = (t.variations ?? []).map((v) => v.type);
        expect(new Set(types).size, `seed ${seed}`).toBe(types.length);
      }
    }
  });
});

describe("mutateSystem quality gate", () => {
  it("lands a mutant that clears a fresh scoreSystem probe for the large majority of seeds mutating Sierpinski", () => {
    // Same base + seed range as SIERPINSKI_MUTATION_CORPUS above (its full
    // 30 entries, not a slice) -- shared rather than re-rolled.
    const SEED_COUNT = SIERPINSKI_MUTATION_CORPUS_SIZE;
    let passes = 0;
    const failingSeeds: number[] = [];
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const mutant = SIERPINSKI_MUTATION_CORPUS[seed];
      // A fresh, independent rng stream -- not a replay of mutateSystem's own
      // generation-time probes -- so this genuinely re-verifies the mutant
      // rather than trivially repeating the check that already accepted it
      // (same pattern as random-system.test.ts's re-probe tests).
      const score = scoreSystem(mutant, mulberry32(seed * 7919 + 1));
      if (score >= MIN_OCCUPIED_CELLS) {
        passes++;
      } else {
        failingSeeds.push(seed);
      }
    }
    // Measured (scripts-side sweep, not run here): 300/300 seeds clear a
    // fresh probe for this base -- every one of this test's 30 included.
    // Asserting well below that observed 100% so a future jitter-range
    // retune has room to cost a seed or two without breaking this test.
    expect(
      passes,
      `failing seeds: ${failingSeeds.join(", ") || "none"}`,
    ).toBeGreaterThanOrEqual(28);
  });
});

describe("mutateSystem symmetry routing", () => {
  it("does not throw when the base's transforms are flat but its symmetry turns in a w-plane", () => {
    // mutateSystem copies symmetry through verbatim, so a base carrying a
    // w-plane kaleidoscope on an otherwise-flat system reaches scoreSystem's
    // quality gate with exactly that combination on every attempt. Before
    // the routing fix, scoreSystem's flat/4D branch looked at the transforms
    // alone, so this candidate reached the 3D chaos game and its
    // symmetryRotation threw on the w-plane.
    const base = system({
      transforms: sierpinskiTetrahedron(),
      symmetry: { order: 4, plane: "xw" },
    });
    const mutant = mutateSystem(base, mulberry32(6));
    expect(mutant.transforms.length).toBe(base.transforms.length);
  });
});

describe("mutateSystem colorIndex/colorSpeed", () => {
  it("leaves colorIndex and colorSpeed absent when the base carries neither", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystem(base, mulberry32(4));
    for (const t of mutant.transforms) {
      expect("colorIndex" in t).toBe(false);
      expect("colorSpeed" in t).toBe(false);
    }
  });

  it("nudges both fields, staying within [0, 1], when the base carries both", () => {
    const transforms: Transform[] = sierpinskiTetrahedron().map((t, i) => ({
      ...t,
      colorIndex: i / 3,
      colorSpeed: 0.5,
    }));
    const base = system({ transforms });
    for (let seed = 0; seed < 20; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      for (const t of mutant.transforms) {
        expect(t.colorIndex, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(t.colorIndex, `seed ${seed}`).toBeLessThanOrEqual(1);
        expect(t.colorSpeed, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(t.colorSpeed, `seed ${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps a fixed-seed mutant of a color-less base RNG-identical to before these fields existed", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystem(base, mulberry32(42));
    // Captured from this exact base/seed before colorIndex/colorSpeed
    // jitter existed. jitterTransform's new jitters are gated on
    // base.colorIndex/base.colorSpeed being present -- neither is, here --
    // so they draw ZERO additional rng() calls, meaning every downstream
    // draw (the remaining maps' jitter, the quality gate's scoreSystem
    // probes) stays bit-identical and this snapshot is unchanged by the
    // edit. A future change that shifted the RNG stream for a color-less
    // base -- e.g. drawing before checking presence, or reordering jitters
    // ahead of the `w` block -- would fail this test.
    expect(mutant).toEqual({
      transforms: [
        {
          id: 0,
          position: [
            0.027157446630299092, 0.747970223799348, 0.00425480674952268,
          ],
          rotation: [
            0.02426490046083926, -0.012410265840590004, 0.08459179043769835,
          ],
          scale: [0.4818582395464182, 0.5099795723147691, 0.5292379718646407],
          weight: 0.9861585275502875,
        },
        {
          id: 1,
          position: [
            0.7191202421486378, -0.44843938592821364, 0.00011671803891659394,
          ],
          rotation: [
            -0.060018303785473105, 0.09169412003830074, 0.05897701559588314,
          ],
          scale: [0.5149289614334702, 0.5088496718741954, 0.46030743615701797],
          weight: 0.9853909618686885,
        },
        {
          id: 2,
          position: [
            -0.4499539270997047, -0.43728704210370783, 0.5798850227892399,
          ],
          rotation: [
            0.08096098221838474, -0.10770977608859539, 0.022157757729291905,
          ],
          scale: [0.47485512057319285, 0.5226837834529579, 0.5024268485046923],
          weight: 0.7635618046624586,
        },
        {
          id: 3,
          position: [
            -0.3255563225969672, -0.4288861206918955, -0.658016683422029,
          ],
          rotation: [
            -0.07847874373197555, 0.08224515007808805, -0.002942419834434981,
          ],
          scale: [0.4629951370880008, 0.464111418761313, 0.5045279823429882],
          weight: 1.0483647563960403,
        },
      ],
      finalTransform: null,
      symmetry: { order: 1, plane: "xz" },
    });
  });
});

describe("mutateSystem fold radii", () => {
  it("perturbs a present fold length and keeps it within its clamped, ordered range", () => {
    const foldMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      variations: [
        {
          type: "spherefold",
          weight: 1,
          minRadius: 0.6,
          fixedRadius: 1.2,
          boxLimit: 0.9,
        },
      ],
    };
    const base = system({
      transforms: [foldMap, ...sierpinskiTetrahedron().slice(1)],
    });

    let sawChange = false;
    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      const v = mutant.transforms[0].variations![0];
      expect(v.minRadius, `seed ${seed}`).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(v.minRadius, `seed ${seed}`).toBeLessThanOrEqual(2 + 1e-9);
      expect(v.fixedRadius, `seed ${seed}`).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(v.fixedRadius, `seed ${seed}`).toBeLessThanOrEqual(2 + 1e-9);
      expect(v.minRadius!, `seed ${seed}`).toBeLessThanOrEqual(
        v.fixedRadius! + 1e-9,
      );
      expect(v.boxLimit, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-9);
      expect(v.boxLimit, `seed ${seed}`).toBeLessThanOrEqual(2 + 1e-9);
      if (v.minRadius !== 0.6 || v.fixedRadius !== 1.2 || v.boxLimit !== 0.9) {
        sawChange = true;
      }
    }
    expect(sawChange).toBe(true);
  });

  it("leaves an absent fold length absent for a non-wildcard mutation", () => {
    const foldMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "mandelbox", weight: 1 }],
    };
    const base = system({
      transforms: [foldMap, ...sierpinskiTetrahedron().slice(1)],
    });

    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      const v = mutant.transforms[0].variations![0];
      expect("minRadius" in v, `seed ${seed}`).toBe(false);
      expect("fixedRadius" in v, `seed ${seed}`).toBe(false);
      expect("boxLimit" in v, `seed ${seed}`).toBe(false);
    }
  });

  it("still does not introduce an absent fold length under wildcard", () => {
    // A mutation grid stays a grid of the system you brought it, so a
    // mutation -- wildcard included -- may perturb a fold length the author
    // already carries but must never invent one the base system never had.
    // Whether this particular seed's structural kick lands on this very map
    // and swaps its type away is irrelevant here: neither the plain jitter
    // path nor the swap ever materializes one.
    const foldMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "mandelbox", weight: 1 }],
    };
    const base = system({
      transforms: [foldMap, ...sierpinskiTetrahedron().slice(1)],
    });

    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed), { wildcard: true });
      const v = mutant.transforms[0].variations![0];
      expect("minRadius" in v, `seed ${seed}`).toBe(false);
      expect("fixedRadius" in v, `seed ${seed}`).toBe(false);
      expect("boxLimit" in v, `seed ${seed}`).toBe(false);
    }
  });

  it("carries a field it has no rule for through untouched, rather than rebuilding the entry without it", () => {
    // `jitterVariationEntry` COPIES the entry. A hand-authored fold length on
    // a NON-fold type is inert — nothing resolves it — but an explicit
    // rebuild would drop it silently, and it is the same rebuild that would
    // drop the next field `Variation` grows. `persist.ts` and `morph.ts` both
    // carry unknown fields through; this pins that mutation does too.
    const base = system({
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "swirl", weight: 1, minRadius: 0.3 }],
        },
      ],
    });
    const mutant = mutateSystem(base, mulberry32(11));
    expect(mutant.transforms[0].variations![0].minRadius).toBe(0.3);
  });

  it("never gains fold lengths on a non-fold variation, even under wildcard", () => {
    const base = system({ transforms: swirlFlame() });
    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed), { wildcard: true });
      for (const t of mutant.transforms) {
        for (const v of t.variations ?? []) {
          if (
            v.type === "boxfold" ||
            v.type === "spherefold" ||
            v.type === "mandelbox"
          ) {
            continue;
          }
          expect("minRadius" in v, `seed ${seed}`).toBe(false);
          expect("fixedRadius" in v, `seed ${seed}`).toBe(false);
          expect("boxLimit" in v, `seed ${seed}`).toBe(false);
        }
      }
    }
  });
});

describe("mutateSystem finish", () => {
  it("perturbs a present finish's fields and keeps them within their clamped domains", () => {
    const finishedMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      finish: {
        specular: 0.4,
        shininess: 32,
        metalness: 0.5,
        reflect: 0.5,
        transmit: 0.5,
      },
    };
    const base = system({
      transforms: [finishedMap, ...sierpinskiTetrahedron().slice(1)],
    });

    let sawChange = false;
    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      const f = mutant.transforms[0].finish!;
      expect(f.specular, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(f.specular, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(f.shininess, `seed ${seed}`).toBeGreaterThanOrEqual(
        SURFACE_FINISH_SHININESS_FLOOR,
      );
      expect(f.shininess, `seed ${seed}`).toBeLessThanOrEqual(256);
      expect(f.metalness, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(f.metalness, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(f.reflect, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(f.reflect, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(f.transmit, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(f.transmit, `seed ${seed}`).toBeLessThanOrEqual(1);
      if (
        f.specular !== 0.4 ||
        f.shininess !== 32 ||
        f.metalness !== 0.5 ||
        f.reflect !== 0.5 ||
        f.transmit !== 0.5
      ) {
        sawChange = true;
      }
    }
    expect(sawChange).toBe(true);
  });

  it("leaves an absent finish absent for a non-wildcard mutation", () => {
    const plainMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };
    const base = system({
      transforms: [plainMap, ...sierpinskiTetrahedron().slice(1)],
    });

    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed));
      expect("finish" in mutant.transforms[0], `seed ${seed}`).toBe(false);
    }
  });

  it("still does not introduce an absent finish under wildcard", () => {
    const plainMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };
    const base = system({
      transforms: [plainMap, ...sierpinskiTetrahedron().slice(1)],
    });

    for (let seed = 0; seed < 30; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed), { wildcard: true });
      expect("finish" in mutant.transforms[0], `seed ${seed}`).toBe(false);
    }
  });

  it("leaves an absent field of a present finish absent across mutation, wildcard included", () => {
    const partialMap: Transform = {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      finish: { metalness: 0.5 },
    };
    const base = system({
      transforms: [partialMap, ...sierpinskiTetrahedron().slice(1)],
    });

    let sawMetalnessChange = false;
    for (let seed = 0; seed < 30; seed++) {
      for (const wildcard of [false, true]) {
        const mutant = mutateSystem(base, mulberry32(seed), { wildcard });
        const f = mutant.transforms[0].finish!;
        expect("specular" in f, `seed ${seed} wildcard=${wildcard}`).toBe(
          false,
        );
        expect("shininess" in f, `seed ${seed} wildcard=${wildcard}`).toBe(
          false,
        );
        expect("reflect" in f, `seed ${seed} wildcard=${wildcard}`).toBe(false);
        expect("transmit" in f, `seed ${seed} wildcard=${wildcard}`).toBe(
          false,
        );
        expect(f.metalness, `seed ${seed} wildcard=${wildcard}`).toBeDefined();
        if (f.metalness !== 0.5) sawMetalnessChange = true;
      }
    }
    expect(sawMetalnessChange).toBe(true);
  });
});

describe("mutateSystem surface pattern", () => {
  const patternedMap: Transform = {
    id: 0,
    position: [0, 0.8, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    surfacePattern: {
      kind: "wood",
      axis: "z",
      scale: 3,
      strength: 0.6,
    },
  };

  it("keeps kind/axis discrete and jitters only present numeric leaves", () => {
    const base = system({
      transforms: [patternedMap, ...sierpinskiTetrahedron().slice(1)],
    });
    let sawChange = false;
    for (let seed = 0; seed < 10; seed++) {
      const pattern = mutateSystem(base, mulberry32(seed)).transforms[0]
        .surfacePattern!;
      expect(pattern.kind).toBe("wood");
      expect(pattern.axis).toBe("z");
      expect(pattern.scale).toBeGreaterThanOrEqual(0.5);
      expect(pattern.scale).toBeLessThanOrEqual(32);
      expect(pattern.strength).toBeGreaterThanOrEqual(0);
      expect(pattern.strength).toBeLessThanOrEqual(1);
      if (pattern.scale !== 3 || pattern.strength !== 0.6) sawChange = true;
    }
    expect(sawChange).toBe(true);
  });

  it("preserves absent blocks and leaves under ordinary and wildcard mutation", () => {
    const plain = system();
    const sparse = system({
      transforms: [
        { ...patternedMap, surfacePattern: { kind: "strata", axis: "y" } },
        ...sierpinskiTetrahedron().slice(1),
      ],
    });
    for (const wildcard of [false, true]) {
      const plainMutant = mutateSystem(plain, mulberry32(4), { wildcard });
      for (const transform of plainMutant.transforms) {
        expect("surfacePattern" in transform).toBe(false);
      }
      const pattern = mutateSystem(sparse, mulberry32(4), { wildcard })
        .transforms[0].surfacePattern!;
      expect(pattern).toEqual({ kind: "strata", axis: "y" });
      expect("scale" in pattern).toBe(false);
      expect("strength" in pattern).toBe(false);
    }
  });

  it("clones base and final pattern objects without aliasing", () => {
    const finalPattern = {
      kind: "marble" as const,
      axis: "x" as const,
      scale: 1.35,
    };
    const base = system({
      transforms: [patternedMap, ...sierpinskiTetrahedron().slice(1)],
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        surfacePattern: finalPattern,
      },
    });
    const mutant = mutateSystem(base, mulberry32(8));
    expect(mutant.transforms[0].surfacePattern).not.toBe(
      patternedMap.surfacePattern,
    );
    expect(mutant.finalTransform!.surfacePattern).toEqual(finalPattern);
    expect(mutant.finalTransform!.surfacePattern).not.toBe(finalPattern);
  });
});

describe("chaos row mutation", () => {
  const chiBase = system({
    transforms: sierpinskiTetrahedron().map((t, i) => ({
      ...t,
      // Map 0 carries a block-ish row with real zeros; the rest are rowless.
      ...(i === 0 ? { chaos: [1, 0, 2, 0.5] } : {}),
    })),
  });

  it("perturbs a present row entrywise, keeping exact zeros exactly zero", () => {
    for (let seed = 0; seed < 20; seed++) {
      const mutated = mutateSystem(chiBase, mulberry32(seed));
      const row = mutated.transforms[0].chaos;
      expect(row).toBeDefined();
      expect(row).toHaveLength(4);
      for (const entry of row!) {
        expect(entry).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(entry)).toBe(true);
      }
      // The multiplicative jitter's whole point: a block boundary (exact 0)
      // survives every mutation, so isolation never leaks by accident.
      expect(row![1]).toBe(0);
      // Non-zero entries genuinely move (multiplicative, never to zero).
      expect(row![2]).toBeGreaterThan(0);
      expect(row![3]).toBeGreaterThan(0);
    }
  });

  it("never materializes an absent row — wildcard included", () => {
    for (let seed = 0; seed < 20; seed++) {
      const plain = mutateSystem(chiBase, mulberry32(seed));
      const wild = mutateSystem(chiBase, mulberry32(seed), { wildcard: true });
      for (const result of [plain, wild]) {
        expect(result.transforms[1].chaos).toBeUndefined();
        expect(result.transforms[2].chaos).toBeUndefined();
        expect(result.transforms[3].chaos).toBeUndefined();
      }
    }
  });
});

describe("mutateSystem shape emitters", () => {
  const EMITTER = {
    parts: [
      {
        primitive: {
          kind: "gear" as const,
          teeth: 8,
          radius: 1,
          tooth: [0.2, 0.15] as [number, number],
          hole: 0.3,
          halfHeight: 0.25,
        },
        combine: "union" as const,
      },
    ],
  };

  it("preserves a present emitter EXACTLY (same reference) and never invents an absent one", () => {
    const transforms: Transform[] = sierpinskiTetrahedron().map((t, i) =>
      i === 1 ? { ...t, emitter: EMITTER } : t,
    );
    const base = system({ transforms });
    for (let seed = 0; seed < 10; seed++) {
      const mutant = mutateSystem(base, mulberry32(seed), { wildcard: true });
      // The spec rides through untouched, by reference — the mutation moves
      // the transform's own TRS (the pose), never the shape's internals.
      expect(mutant.transforms[1].emitter).toBe(EMITTER);
      for (const [i, t] of mutant.transforms.entries()) {
        if (i === 1) continue;
        expect("emitter" in t, `seed ${seed} map ${i}`).toBe(false);
      }
    }
  });

  it("consumes no extra draws for the field: an emitter-free base mutates byte-identically with or without the code path", () => {
    // Fixed seed, same base, two calls — determinism already pinned above;
    // this adds that adding an emitter to ONE map leaves every OTHER map's
    // jitter untouched (the field draws nothing).
    const plain = system({ transforms: sierpinskiTetrahedron() });
    const withEmitter = system({
      transforms: sierpinskiTetrahedron().map((t, i) =>
        i === 3 ? { ...t, emitter: EMITTER } : t,
      ),
    });
    const a = mutateSystem(plain, mulberry32(9));
    const b = mutateSystem(withEmitter, mulberry32(9));
    for (let i = 0; i < 3; i++) {
      expect(b.transforms[i]).toEqual(a.transforms[i]);
    }
    expect(b.transforms[3].position).toEqual(a.transforms[3].position);
    expect(b.transforms[3].emitter).toBe(EMITTER);
  });
});

function richSeededMutationBase(): MorphSystem {
  return system({
    transforms: sierpinskiTetrahedron().map((transform, index) => ({
      ...transform,
      shear: [0.02, -0.03, 0.04],
      variations: [
        { type: "swirl", weight: 0.12 + index * 0.01 },
        {
          type: "mandelbox",
          weight: 0.08,
          minRadius: 0.4,
          fixedRadius: 0.9,
          boxLimit: 0.8,
        },
      ],
      w: {
        position: 0.02 * (index + 1),
        rotation: { xw: 0.03, yw: -0.02, zw: 0.01 },
        scale: 0.52,
        shear: { xw: 0.01, yw: -0.01, zw: 0.02 },
      },
      weight: 1 + index * 0.1,
      chaos: [1, index === 0 ? 0 : 0.8, 1.1, 0.9],
      colorIndex: 0.15 + index * 0.15,
      colorSpeed: 0.45,
      finish: {
        specular: 0.5,
        shininess: 40,
        metalness: 0.2,
        reflect: 0.1,
        transmit: 0.05,
        reflectionTint: 0.8,
      },
      surfacePattern: {
        kind: "strata" as const,
        axis: "y" as const,
        scale: 1.2,
        strength: 0.35,
      },
    })),
    finalTransform: {
      id: 99,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [
        {
          type: "boxfold",
          weight: 0.1,
          boxLimit: 0.75,
        },
      ],
    },
  });
}

function mutationDomainProjection(
  value: MorphSystem,
  domain: MutationDomain,
): unknown {
  switch (domain) {
    case "spatialGeometry":
      return value.transforms.map(({ position, rotation, scale, shear }) => ({
        position,
        rotation,
        scale,
        shear,
      }));
    case "nonlinearVariations":
      return value.transforms.map(({ variations }) => variations);
    case "finalLens":
      return value.finalTransform?.variations ?? null;
    case "fourDExtension":
      return value.transforms.map(({ w }) => w);
    case "mapSelectionXaos":
      return value.transforms.map(({ weight, chaos }) => ({ weight, chaos }));
    case "appearance":
      return value.transforms.map(
        ({ colorIndex, colorSpeed, finish, surfacePattern }) => ({
          colorIndex,
          colorSpeed,
          finish,
          surfacePattern,
        }),
      );
  }
}

/** Compact golden over the complete serialized v1 result. Property order is
 * part of the profile boundary too: lineage metadata names an algorithm
 * version precisely so any output-affecting rewrite must opt into v2. */
function jsonFnv1a(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

describe("mutateSystemSeeded versioned domain streams", () => {
  const request = {
    algorithmVersion: SEEDED_MUTATION_ALGORITHM_VERSION,
    nodeSeed: 0x1234abcd,
    childOrdinal: 5,
    profile: { wildcard: true },
  } as const;

  it("publishes the complete v1 field-domain vocabulary", () => {
    expect(MUTATION_DOMAINS).toEqual([
      "spatialGeometry",
      "nonlinearVariations",
      "finalLens",
      "fourDExtension",
      "mapSelectionXaos",
      "appearance",
    ]);
  });

  it("reproduces a child from version, node seed, ordinal, and profile", () => {
    const base = richSeededMutationBase();
    expect(mutateSystemSeeded(base, request)).toEqual(
      mutateSystemSeeded(base, request),
    );
    expect(
      mutateSystemSeeded(base, { ...request, childOrdinal: 6 }),
    ).not.toEqual(mutateSystemSeeded(base, request));
  });

  it("pins the complete v1 output behind the algorithm version", () => {
    expect(
      jsonFnv1a(mutateSystemSeeded(richSeededMutationBase(), request)),
    ).toBe("3fba2659");
  });

  it("keeps every unrelated domain byte-identical when any one domain is locked", () => {
    const base = richSeededMutationBase();
    const unlocked = mutateSystemSeeded(base, request);
    for (const lockedDomain of MUTATION_DOMAINS) {
      const locked = mutateSystemSeeded(base, {
        ...request,
        profile: { wildcard: true, lockedDomains: [lockedDomain] },
      });
      expect(
        mutationDomainProjection(locked, lockedDomain),
        `${lockedDomain} should be copied from the parent`,
      ).toEqual(mutationDomainProjection(base, lockedDomain));
      for (const unrelatedDomain of MUTATION_DOMAINS) {
        if (unrelatedDomain === lockedDomain) continue;
        expect(
          mutationDomainProjection(locked, unrelatedDomain),
          `${lockedDomain} changed ${unrelatedDomain}`,
        ).toEqual(mutationDomainProjection(unlocked, unrelatedDomain));
      }
    }
  });

  it("preserves sparse optional absence, including an absent authored weight", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    const mutant = mutateSystemSeeded(base, {
      algorithmVersion: SEEDED_MUTATION_ALGORITHM_VERSION,
      nodeSeed: 91,
      childOrdinal: 2,
      profile: { wildcard: true },
    });
    for (const transform of mutant.transforms) {
      for (const key of [
        "weight",
        "shear",
        "variations",
        "w",
        "chaos",
        "colorIndex",
        "colorSpeed",
        "finish",
        "surfacePattern",
        "emitter",
      ] as const) {
        expect(key in transform, key).toBe(false);
      }
    }
  });

  it("does not mutate its input and copies mutable nested authored fields", () => {
    const base = richSeededMutationBase();
    const before = structuredClone(base);
    const mutant = mutateSystemSeeded(base, request);
    expect(base).toEqual(before);
    expect(mutant.transforms[0]).not.toBe(base.transforms[0]);
    expect(mutant.transforms[0].w).not.toBe(base.transforms[0].w);
    expect(mutant.transforms[0].finish).not.toBe(base.transforms[0].finish);
    expect(mutant.finalTransform).not.toBe(base.finalTransform);
  });

  it("keeps a 3D parent 3D and a 4D parent routed through all system parts", () => {
    const flatBase = system({ transforms: sierpinskiTetrahedron() });
    const flatMutant = mutateSystemSeeded(flatBase, request);
    expect(
      systemPartsAreNonFlat(
        flatMutant.transforms,
        flatMutant.finalTransform,
        flatMutant.symmetry,
      ),
    ).toBe(false);

    const fourDBase = system({ transforms: doubleRotation() });
    const fourDMutant = mutateSystemSeeded(fourDBase, request);
    expect(
      systemPartsAreNonFlat(
        fourDMutant.transforms,
        fourDMutant.finalTransform,
        fourDMutant.symmetry,
      ),
    ).toBe(true);

    const finalOnlyBase = system({
      finalTransform: {
        id: 100,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        w: { rotation: { xw: 0.2 } },
        variations: [{ type: "swirl", weight: 0.2 }],
      },
    });
    const finalOnlyMutant = mutateSystemSeeded(finalOnlyBase, request);
    expect(finalOnlyMutant.finalTransform?.w).toEqual(
      finalOnlyBase.finalTransform?.w,
    );
    expect(
      systemPartsAreNonFlat(
        finalOnlyMutant.transforms,
        finalOnlyMutant.finalTransform,
        finalOnlyMutant.symmetry,
      ),
    ).toBe(true);
  });

  it("keeps legacy injected-RNG behavior behind an explicit version boundary", () => {
    const base = system({ transforms: sierpinskiTetrahedron() });
    expect(mutateSystemSeeded(base, request)).not.toEqual(
      mutateSystem(base, mulberry32(request.nodeSeed), {
        wildcard: request.profile.wildcard,
      }),
    );
    expect(() =>
      mutateSystemSeeded(base, {
        ...request,
        algorithmVersion: 2 as typeof SEEDED_MUTATION_ALGORITHM_VERSION,
      }),
    ).toThrow("Unsupported seeded mutation algorithm version: 2");
  });
});
