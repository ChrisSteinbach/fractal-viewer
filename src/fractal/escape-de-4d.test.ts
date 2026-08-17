import {
  analyzeEscapeSystem4,
  buildEscapeDE4,
  escapeSetContains4,
  estimateEscapeDistance4,
  foldQueryIntoSector4,
  probeEscapeFill4,
} from "./escape-de-4d";
import type { EscapeDE4, EscapeLink4 } from "./escape-de-4d";
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_LINK_BOXFOLD,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  foldQueryIntoSector,
} from "./escape-de";
import { toTransform4 } from "./affine4";
import { effectiveSymmetryOrder } from "./chaos-game";
import { mulberry32 } from "./rng";
import { transformSigmas4 } from "./surface-de-4d";
import { SYMMETRY_PLANES } from "./types";
import type {
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
  VariationType,
} from "./types";

/** The canonical single-map Mandelbox shape — `escape-de.test.ts`'s own
 * fixture, duplicated rather than imported (test files stay DAMP-isolated in
 * this codebase; `surface-de-4d.test.ts` keeps its own `map4` for the same
 * reason). Non-contracting at the classic weight, so it is this render
 * mode's on every gate it reaches. */
function canonicalMandelbox(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    ...overrides,
  };
}

/** One pure-fold link, at the origin with no rotation unless asked. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  overrides: Partial<Transform> = {},
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
    ...overrides,
  };
}

/** One POWER-map link (bulb or qsquare) — `foldMap`'s twin for the two
 * cross-family maps. */
function powerMap(
  id: number,
  type: "bulb" | "qsquare",
  weight = 1,
  overrides: Partial<Transform> = {},
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
    ...overrides,
  };
}

/** A 3D query point lifted to 4D at a chosen `w` — most of this suite's
 * queries live at `w = 0` (the anchor slice). */
function toVec4(p: Vec3, w: number): Vec4 {
  return [p[0], p[1], p[2], w];
}

describe("analyzeEscapeSystem4 lifts the whole render mode (fr-vag4)", () => {
  it("admits a non-flat pure-fold chain the 3D gate refuses for extending into 4D", () => {
    // The headline of the module: two mandelbox maps, the second carrying a
    // w-mixing rotation the 3D estimator has no fourth coordinate for.
    const chain = [
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, w: { rotation: { xw: 0.3 } } }),
    ];
    expect(analyzeEscapeSystem(chain)).toEqual({
      status: "ineligible",
      reasons: ["map 2 extends into 4D"],
    });
    expect(analyzeEscapeSystem4(chain)).toEqual({
      status: "eligible",
      reasons: [],
    });
  });

  it("admits a w-plane kaleidoscope the 3D gate refuses for rotating into 4D", () => {
    const chain = [canonicalMandelbox()];
    const symmetry: SymmetryParams = { order: 5, plane: "xw" };
    expect(analyzeEscapeSystem(chain, null, symmetry).reasons).toEqual([
      "the kaleidoscope rotates into 4D",
    ]);
    expect(analyzeEscapeSystem4(chain, null, symmetry)).toEqual({
      status: "eligible",
      reasons: [],
    });
  });

  it("refuses a nonzero twist -- a double rotation has no wedge -- but ignores it at order 1", () => {
    const chain = [canonicalMandelbox()];
    expect(
      analyzeEscapeSystem4(chain, null, { order: 4, plane: "xz", twist: 1 })
        .reasons,
    ).toEqual(["the kaleidoscope twists (a double rotation has no wedge)"]);
    // Order 1 is the identity regardless of plane or twist (affine4.ts's
    // symmetryIsNonFlat carries the same rule): nothing is turning, so a
    // remembered twist cannot force a refusal.
    expect(
      analyzeEscapeSystem4(chain, null, { order: 1, plane: "xz", twist: 1 })
        .status,
    ).toBe("eligible");
  });

  it("refuses a bulb link BY NAME, chained or lone, flat or not", () => {
    const flat = [foldMap(0, "mandelbox", 2), powerMap(1, "bulb")];
    expect(analyzeEscapeSystem4(flat).reasons).toEqual([
      "map 2 is a triplex power, which has no fourth component " +
        "(the 3D escape-time render owns it)",
    ]);
    // The refusal is per-KIND, not per-flatness -- the gate never calls
    // isFlatTransform at all (module doc's WHAT LIFTS section), so a bulb
    // carrying its own w block is refused identically.
    const nonFlat = [
      foldMap(0, "mandelbox", 2),
      powerMap(1, "bulb", 1, { w: { position: 0.4 } }),
    ];
    expect(analyzeEscapeSystem4(nonFlat).reasons).toEqual([
      "map 2 is a triplex power, which has no fourth component " +
        "(the 3D escape-time render owns it)",
    ]);
  });

  it("admits a qsquare link chained with a fold and refuses it alone", () => {
    expect(
      analyzeEscapeSystem4([
        foldMap(0, "mandelbox", 2),
        powerMap(1, "qsquare"),
      ]),
    ).toEqual({ status: "eligible", reasons: [] });
    expect(analyzeEscapeSystem4([powerMap(0, "qsquare")]).reasons).toEqual([
      "map 1 is a lone quaternion square (chain it with another map)",
    ]);
  });

  it("refuses a final transform, an empty chain, and an all-contracting system", () => {
    expect(
      analyzeEscapeSystem4(
        [canonicalMandelbox()],
        canonicalMandelbox({ id: 9 }),
      ).reasons,
    ).toEqual(["final transform (unsupported in escape-time mode)"]);
    expect(analyzeEscapeSystem4([]).reasons).toEqual(["no active maps"]);
    expect(
      analyzeEscapeSystem4([canonicalMandelbox({ weight: 0 })]).reasons,
    ).toEqual(["no active maps"]);
    expect(
      analyzeEscapeSystem4([
        canonicalMandelbox({
          scale: [0.1, 0.1, 0.1],
          variations: [{ type: "mandelbox", weight: 1 }],
        }),
      ]).reasons,
    ).toEqual(["every map contracts (the attractor surface render owns it)"]);
  });

  it("names a link that carries neither a fold nor a power variation", () => {
    expect(
      analyzeEscapeSystem4([canonicalMandelbox(), foldMap(1, "swirl", 2)])
        .reasons,
    ).toEqual(["map 2 is not a pure fold or power map"]);
  });
});

describe("buildEscapeDE4 (fr-vag4)", () => {
  it("throws on an ineligible system, with the reasons joined into the message", () => {
    expect(() =>
      buildEscapeDE4([
        canonicalMandelbox({
          scale: [0.1, 0.1, 0.1],
          variations: [{ type: "mandelbox", weight: 1 }],
        }),
      ]),
    ).toThrow(
      "system has no 4D escape-time estimator: every map contracts " +
        "(the attractor surface render owns it)",
    );
  });

  it("treats a weight-0 map as inert -- it contributes no link", () => {
    const de = buildEscapeDE4([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, weight: 0 }),
      foldMap(2, "boxfold", 1.6),
    ]);
    expect(de.links).toHaveLength(2);
  });

  it("exposes the head link's fields flat -- the same references as links[0]", () => {
    const de = buildEscapeDE4([
      foldMap(0, "boxfold", 1.6, { position: [0.1, 0.2, 0.3] }),
      canonicalMandelbox({ id: 1 }),
    ]);
    const head = de.links[0];
    expect(de.m).toBe(head.m);
    expect(de.t).toBe(head.t);
    expect(de.kind).toBe(head.kind);
    expect(de.w).toBe(head.w);
    expect(de.derivGrowth).toBe(head.derivGrowth);
    expect(de.boxLimit).toBe(head.boxLimit);
    expect(de.minRadius2).toBe(head.minRadius2);
    expect(de.fixedRadius2).toBe(head.fixedRadius2);
  });

  it("sets logEstimate false for a fold-only chain and true with a qsquare link present", () => {
    expect(buildEscapeDE4([canonicalMandelbox()]).logEstimate).toBe(false);
    expect(
      buildEscapeDE4([canonicalMandelbox(), foldMap(1, "boxfold", 1.6)])
        .logEstimate,
    ).toBe(false);
    expect(
      buildEscapeDE4([foldMap(0, "mandelbox", 2), powerMap(1, "qsquare")])
        .logEstimate,
    ).toBe(true);
    // Resolved once per chain -- a power link anywhere in the list sets it.
    expect(
      buildEscapeDE4([
        foldMap(0, "mandelbox", 2),
        foldMap(1, "boxfold", 1.6),
        powerMap(2, "qsquare"),
      ]).logEstimate,
    ).toBe(true);
  });

  it("carries the symmetry order through effectiveSymmetryOrder's clamp, and the plane -- w-planes included", () => {
    const de = buildEscapeDE4([canonicalMandelbox()], null, {
      order: 6,
      plane: "yw",
    });
    expect(de.symmetryOrder).toBe(effectiveSymmetryOrder(6, 1));
    expect(de.symmetryPlane).toBe("yw");
    // Order 1 is off, whatever plane the document remembers.
    expect(buildEscapeDE4([canonicalMandelbox()]).symmetryOrder).toBe(1);
    // The clamp genuinely fires on a short document asking for a huge order
    // -- chaos-game.ts's own MAX_TRANSFORMS ceiling, not a made-up number.
    const clamped = buildEscapeDE4([canonicalMandelbox()], null, {
      order: 500,
      plane: "xz",
    });
    expect(clamped.symmetryOrder).toBe(effectiveSymmetryOrder(500, 1));
    expect(clamped.symmetryOrder).toBeLessThan(500);
  });

  it("resolves each link's fold lengths through resolveFoldRadii -- authored and classic", () => {
    const authored = buildEscapeDE4([
      canonicalMandelbox({
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.3,
            fixedRadius: 1.4,
            boxLimit: 1.6,
          },
        ],
      }),
    ]).links[0];
    expect(authored.boxLimit).toBe(1.6);
    expect(authored.minRadius2).toBe(0.3 * 0.3);
    expect(authored.fixedRadius2).toBe(1.4 * 1.4);

    const classic = buildEscapeDE4([canonicalMandelbox()]).links[0];
    expect(classic.boxLimit).toBe(1);
    expect(classic.minRadius2).toBe(0.25);
    expect(classic.fixedRadius2).toBe(1);
  });

  it("prices derivGrowth as |weight| * transformSigmas4(toTransform4(map)).max", () => {
    const map = canonicalMandelbox({
      scale: [2, 0.5, 1],
      variations: [{ type: "mandelbox", weight: -1.5 }],
    });
    const de = buildEscapeDE4([map]);
    const want = Math.abs(-1.5) * transformSigmas4(toTransform4(map)).max;
    expect(de.links[0].derivGrowth).toBe(want);
  });
});

/**
 * Flat systems the 4D estimator must reproduce `escape-de.ts`'s on, at
 * `w = 0`, to the BIT (module doc's ANCHORED AT w = 0 claim).
 *
 * Every transform below keeps ROTATION at its default `[0, 0, 0]`.
 * `embedTransform3`'s own doc says the 4D lift's rotation matrix agrees with
 * `rotationMatrixXYZ` only to 12 digits, not to the bit (`affine4.test.ts`
 * pins that with `toBeCloseTo`, never `toBe`) -- a rotated fixture would
 * fail a bit-exact comparison on the AFFINE part alone, for a reason that
 * predates and has nothing to do with this module. Position, scale, weight
 * and the fold's own authored lengths are all free to vary; only the
 * rotation is pinned at identity so every matrix entry this suite touches is
 * an exact `0`/`1`/`scale` on both sides.
 */
const ANCHOR_SYSTEMS: [string, Transform[], SymmetryParams?][] = [
  [
    "single mandelbox at the origin",
    [canonicalMandelbox({ position: [0, 0, 0] })],
  ],
  [
    "boxfold -> spherefold chain",
    [
      foldMap(0, "boxfold", 1.6),
      foldMap(1, "spherefold", 1.2, { position: [0.1, -0.2, 0.05] }),
    ],
  ],
  [
    "3-chain with authored non-classic fold radii",
    [
      canonicalMandelbox({
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.3,
            fixedRadius: 1.4,
            boxLimit: 0.8,
          },
        ],
      }),
      foldMap(1, "boxfold", 1.6, { position: [0.15, -0.1, 0.05] }),
      foldMap(2, "spherefold", 1.2, { scale: [1.3, 1.3, 1.3] }),
    ],
  ],
  [
    "boxfold -> spherefold chain under a 3D kaleidoscope",
    [
      foldMap(0, "boxfold", 1.6),
      foldMap(1, "spherefold", 1.2, { position: [0.1, -0.2, 0.05] }),
    ],
    { order: 5, plane: "xz" },
  ],
];

/** ~20 points spread across and beyond the bailout ball, generated once so
 * every fixture in a sweep is compared at the identical queries. The first
 * two are load-bearing: `(0, 0, 0)` is an exact fixed point of the t = 0
 * origin fixture above (never escapes), and a point past the bailout radius
 * escapes trivially on every system (the orbit loop never runs) -- between
 * them they guarantee the sweep exercises both of `escapeSetContains`'
 * outcomes rather than leaving it to chance. */
function anchorQueries(): Vec3[] {
  const rng = mulberry32(0x4462a4);
  const pts: Vec3[] = [
    [0, 0, 0],
    [9, -7, 5],
  ];
  for (let i = 0; i < 18; i++) {
    pts.push([10 * rng() - 5, 10 * rng() - 5, 10 * rng() - 5]);
  }
  return pts;
}

describe("the 4D orbit anchors bit-exactly to the 3D one at w = 0 (fr-vag4)", () => {
  it("estimateEscapeDistance4 at w = 0 is bit-identical to estimateEscapeDistance", () => {
    const queries = anchorQueries();
    for (const [label, transforms, symmetry] of ANCHOR_SYSTEMS) {
      const de3 = buildEscapeDE(transforms, null, symmetry);
      const de4 = buildEscapeDE4(transforms, null, symmetry);
      for (const p of queries) {
        expect(
          estimateEscapeDistance4(de4, toVec4(p, 0)),
          `${label} at ${p.join(", ")}`,
        ).toBe(estimateEscapeDistance(de3, p));
      }
    }
  });

  it("escapeSetContains4 at w = 0 is bit-identical to escapeSetContains", () => {
    const queries = anchorQueries();
    let sawMember = false;
    let sawEscaper = false;
    for (const [label, transforms, symmetry] of ANCHOR_SYSTEMS) {
      const de3 = buildEscapeDE(transforms, null, symmetry);
      const de4 = buildEscapeDE4(transforms, null, symmetry);
      for (const p of queries) {
        const want = escapeSetContains(de3, p);
        if (want) sawMember = true;
        else sawEscaper = true;
        expect(
          escapeSetContains4(de4, toVec4(p, 0)),
          `${label} at ${p.join(", ")}`,
        ).toBe(want);
      }
    }
    // Both branches of the orbit loop were genuinely exercised across the
    // sweep above, not merely one of them by accident.
    expect(sawMember).toBe(true);
    expect(sawEscaper).toBe(true);
  });

  it("a flat qsquare + fold chain anchors too -- the 3D qsquare is the 4D one's w = 0 restriction", () => {
    const chain = [foldMap(0, "mandelbox", 2), powerMap(1, "qsquare")];
    const de3 = buildEscapeDE(chain);
    const de4 = buildEscapeDE4(chain);
    for (const p of anchorQueries()) {
      expect(estimateEscapeDistance4(de4, toVec4(p, 0)), p.join(", ")).toBe(
        estimateEscapeDistance(de3, p),
      );
      expect(escapeSetContains4(de4, toVec4(p, 0)), p.join(", ")).toBe(
        escapeSetContains(de3, p),
      );
    }
  });
});

describe("foldQueryIntoSector4 (fr-vag4)", () => {
  it("copies p through untouched at order <= 1", () => {
    const out: Vec4 = [0, 0, 0, 0];
    const p: Vec4 = [-0.3, 1.7, 0.02, -2.1];
    expect(foldQueryIntoSector4(p, 1, "xz", out)).toEqual(p);
    expect(foldQueryIntoSector4(p, 0, "xw", out)).toEqual(p);
  });

  it("reproduces foldQueryIntoSector entry for entry on the three w-free planes, leaving w alone", () => {
    const out3: Vec3 = [0, 0, 0];
    const out4: Vec4 = [0, 0, 0, 0];
    const rng = mulberry32(0x9a4f);
    for (const plane of ["xy", "xz", "yz"] as const) {
      for (let i = 0; i < 200; i++) {
        const p: Vec4 = [
          8 * rng() - 4,
          8 * rng() - 4,
          8 * rng() - 4,
          8 * rng() - 4,
        ];
        foldQueryIntoSector([p[0], p[1], p[2]], 5, plane, out3);
        foldQueryIntoSector4(p, 5, plane, out4);
        expect(out4[0], `${plane} x`).toBe(out3[0]);
        expect(out4[1], `${plane} y`).toBe(out3[1]);
        expect(out4[2], `${plane} z`).toBe(out3[2]);
        expect(out4[3], `${plane} w`).toBe(p[3]);
      }
    }
  });

  it("is an ISOMETRY on each of the six planes", () => {
    const out: Vec4 = [0, 0, 0, 0];
    const rng = mulberry32(0x15071);
    for (const plane of SYMMETRY_PLANES) {
      for (const order of [2, 3, 5, 8]) {
        for (let i = 0; i < 100; i++) {
          const p: Vec4 = [
            8 * rng() - 4,
            8 * rng() - 4,
            8 * rng() - 4,
            8 * rng() - 4,
          ];
          foldQueryIntoSector4(p, order, plane, out);
          expect(
            Math.hypot(out[0], out[1], out[2], out[3]),
            `${plane} order ${order}`,
          ).toBeCloseTo(Math.hypot(p[0], p[1], p[2], p[3]), 12);
        }
      }
    }
  });

  it("is idempotent -- the wedge is already folded", () => {
    const once: Vec4 = [0, 0, 0, 0];
    const twice: Vec4 = [0, 0, 0, 0];
    const rng = mulberry32(0x1d3a4);
    for (const plane of SYMMETRY_PLANES) {
      for (let i = 0; i < 50; i++) {
        const p: Vec4 = [
          6 * rng() - 3,
          6 * rng() - 3,
          6 * rng() - 3,
          6 * rng() - 3,
        ];
        foldQueryIntoSector4(p, 6, plane, once);
        foldQueryIntoSector4(
          [once[0], once[1], once[2], once[3]],
          6,
          plane,
          twice,
        );
        for (let k = 0; k < 4; k++) {
          expect(twice[k], `${plane} axis ${k}`).toBeCloseTo(once[k], 12);
        }
      }
    }
  });

  it("a w-plane fold actually moves w, leaving the two off-plane coordinates untouched", () => {
    const out: Vec4 = [0, 0, 0, 0];
    const rng = mulberry32(0x77aa);
    // xw turns x and w; y and z (indices 1, 2) sit outside that plane.
    const p: Vec4 = [
      6 * rng() - 3,
      6 * rng() - 3,
      6 * rng() - 3,
      6 * rng() - 3,
    ];
    foldQueryIntoSector4(p, 4, "xw", out);
    expect(out[1]).toBe(p[1]);
    expect(out[2]).toBe(p[2]);
    expect(out[3]).not.toBeCloseTo(p[3], 6);
  });

  it("may alias its input", () => {
    const p: Vec4 = [1.1, -0.4, 0.9, -1.6];
    const aliased: Vec4 = [...p];
    const fresh: Vec4 = [0, 0, 0, 0];
    foldQueryIntoSector4(p, 5, "yw", fresh);
    foldQueryIntoSector4(aliased, 5, "yw", aliased); // out === p
    expect(aliased).toEqual(fresh);
  });
});

describe("the 4D orbit renders what no 3D approximation can (fr-vag4)", () => {
  it("a w-rotated fold chain renders a different object at w = 0 than its flattened twin", () => {
    const rotated: Transform[] = [
      canonicalMandelbox({ w: { rotation: { xw: 0.3 } } }),
      foldMap(1, "boxfold", 1.6),
    ];
    const flat: Transform[] = [
      canonicalMandelbox(),
      foldMap(1, "boxfold", 1.6),
    ];
    const de4 = buildEscapeDE4(rotated);
    const de3 = buildEscapeDE(flat);
    const rng = mulberry32(0xfeed4);
    let anyDiffer = false;
    for (let i = 0; i < 40 && !anyDiffer; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      if (
        estimateEscapeDistance4(de4, toVec4(p, 0)) !==
        estimateEscapeDistance(de3, p)
      ) {
        anyDiffer = true;
      }
    }
    expect(anyDiffer).toBe(true);
  });

  it("a qsquare link's w translation changes set membership -- fr-wuuu's k component", () => {
    const shifted: Transform[] = [
      foldMap(0, "mandelbox", 2),
      powerMap(1, "qsquare", 1, { w: { position: 0.4 } }),
    ];
    const flat: Transform[] = [
      foldMap(0, "mandelbox", 2),
      powerMap(1, "qsquare"),
    ];
    const de4 = buildEscapeDE4(shifted);
    const de3 = buildEscapeDE(flat);

    // escape/non-escape is a THIN boundary -- escape-de.ts's own doc warns a
    // distance threshold cannot stand in for escapeSetContains, and uniform
    // sampling cannot reliably land on the boundary either (measured: 2000
    // random queries in [-5, 5]^3 found zero disagreements, even though the
    // orbits provably diverge from the very first qsquare step). So find the
    // boundary deliberately: both links sit at t = 0, so the origin is an
    // exact fixed point of the 3D orbit; bisect outward along a handful of
    // fixed directions to the radius where escapeSetContains flips, then
    // read escapeSetContains4 at (and either side of) that exact radius,
    // where a real difference is most likely to tip the boolean verdict.
    const directions: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [1, -1, 0.5],
    ];
    let anyDiffer = false;
    for (const raw of directions) {
      const len = Math.hypot(raw[0], raw[1], raw[2]);
      const unit: Vec3 = [raw[0] / len, raw[1] / len, raw[2] / len];
      let lo = 0;
      let hi = ESCAPE_TIME_RADIUS * 1.2;
      const along = (r: number): Vec3 => [
        unit[0] * r,
        unit[1] * r,
        unit[2] * r,
      ];
      if (escapeSetContains(de3, along(hi))) continue; // no crossing on this ray
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (escapeSetContains(de3, along(mid))) lo = mid;
        else hi = mid;
      }
      for (const eps of [0, 1e-3, -1e-3, 3e-3, -3e-3]) {
        const p = along(lo + eps);
        if (
          escapeSetContains4(de4, toVec4(p, 0)) !== escapeSetContains(de3, p)
        ) {
          anyDiffer = true;
        }
      }
    }
    expect(anyDiffer).toBe(true);
  });
});

/**
 * Hand-derived orbit steps at a genuinely NON-FLAT query (fr-vtaz).
 *
 * `runEscapeOrbit4` reimplements the fold and `qsquare` step arithmetic over
 * four coordinates under the twin-file convention, and neither strategy above
 * can see a wrong-but-nonzero `w` term: the anchor sweep compares the two
 * dimensions strictly at `w = 0`, where every `w` term evaluates to `0`, and
 * the two "renders differently" tests assert only that SOMETHING moved — a
 * corrupted value is still a difference. So a one-character axis typo
 * (`foldAxis(yz)` where `foldAxis(yw)` belongs) passes the whole suite.
 *
 * These three pin the numbers instead. Each derives one or two FULL orbit
 * steps from the DOCUMENTED rules — `affine4.ts`'s rotation convention,
 * `variations4.ts`'s four-coordinate warps, and `escape-de.ts`'s chain rules
 * (step `i` applies link `i mod n`, with `+ p` and the bailout test after
 * EACH link, and `dr` floored by `+ 1`) — at a query and a map whose `w`
 * genuinely participates. Worth the arithmetic because this module is the CPU
 * oracle behind the shipped `core: "escape4"` kernel: a silent `w`-term bug
 * ships straight into a real WebGPU render path.
 */
describe("the 4D orbit's w terms, hand-derived at nonzero w (fr-vtaz)", () => {
  it("folds the w axis an xw rotation mixed into -- one boxfold link, one step", () => {
    // One boxfold link at weight 2, turned by theta = 0.7 in the xw PLANE, so
    // x and w mix into each other: the one thing no w = 0 fixture can see.
    // Query p = (1.5, 0.4, -1.2, 0.9), and |p| = 2.159 sits inside the bailout
    // ball, so the single step (one pass x one link) runs.
    //
    //   y = R_xw(0.7)*p, affine4.ts's documented convention
    //   (a' = a*cos - b*sin, b' = a*sin + b*cos), y and z riding through:
    //     yx = 1.5c - 0.9s =  0.567467
    //     yy =  0.4
    //     yz = -1.2
    //     yw = 1.5s + 0.9c =  1.654684
    //   box fold, wall = 1 (the classic boxLimit): fold(t) = 2*clamp(t) - t,
    //   so an axis inside the box folds to itself and one outside reflects --
    //   here x and y are inside, z is below the wall and W IS ABOVE IT:
    //     f  = (0.567467, 0.4, 2(-1) + 1.2, 2(1) - 1.654684)
    //        = (0.567467, 0.4, -0.8, 0.345316)
    //   v  = 2*f + p  = (2.634935, 1.2, -2.8, 1.590631)
    //   dr = derivGrowth * L * dr + 1 = 2*1*1 + 1 = 3
    //        (derivGrowth = |2| * sigma_max(R) = 2; a box fold's L is 1)
    //   DE = |v| / dr = 4.330472 / 3 = 1.443491
    //
    // Point the w fold at z -- foldAxis(yz) where foldAxis(yw) belongs, the
    // typo the anchor sweep cannot see -- and vw reads 2(-0.8) + 0.9 = -0.7
    // for a DE of 1.362713.
    const theta = 0.7;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const p: Vec4 = [1.5, 0.4, -1.2, 0.9];
    const yx = p[0] * c - p[3] * s;
    const yw = p[0] * s + p[3] * c;
    const v: Vec4 = [
      2 * yx + p[0], // inside the box, so the fold is the identity
      2 * p[1] + p[1], // inside too
      2 * (2 * -1 - p[2]) + p[2], // reflected off the -1 wall
      2 * (2 * 1 - yw) + p[3], // reflected off the +1 wall -- the w term
    ];
    const de = buildEscapeDE4([
      foldMap(0, "boxfold", 2, { w: { rotation: { xw: theta } } }),
    ]);
    expect(estimateEscapeDistance4(de, p, 1)).toBeCloseTo(
      Math.hypot(v[0], v[1], v[2], v[3]) / 3,
      12,
    );
  });

  it("puts w in the sphere fold's FULL 4-radius and scales it -- one link, one step", () => {
    // One spherefold link at weight 2 and classic radii (mR^2 = 0.25,
    // fR^2 = 1), whose own translation (0.2, 0, 0, 0) carries the query to
    //   y = p + t = (0.4, 0.2, -0.1, 0.8).
    // The SPATIAL radius alone is r3^2 = 0.16 + 0.04 + 0.01 = 0.21, inside the
    // inner ball, where the fold would be a flat x4 magnification. w adds
    // 0.8^2 = 0.64 for r4^2 = 0.85, which lands in the inversion band
    // [0.25, 1], so every coordinate divides by 0.85 instead -- variations4's
    // "spherefold uses the full 4D radius", inside the orbit:
    //   f  = 1/0.85 = 1.176471,  and the local Lipschitz factor IS that f
    //   v  = 2*(y*f) + p = (1.141176, 0.670588, -0.335294, 2.682353)
    //   dr = 2*f*1 + 1 = 3.352941
    //   DE = |v| / dr = 3.009886 / 3.352941 = 0.897685
    //
    // Drop the `+ yw*yw` from the radius and the clamp floors at 0.25 for
    // f = 4, reading 0.912533; scale w by the wrong axis and it reads 0.440686.
    //
    // THE LINK'S TRANSLATION IS LOAD-BEARING, not decoration: at t = 0 a
    // sphere fold's output is parallel to the query (v = (2f + 1)p) and the
    // factor cancels EXACTLY against dr = 2f + 1, so the estimate reads |p|
    // whatever f is -- a fixture that pins nothing about the radius at all.
    const p: Vec4 = [0.2, 0.2, -0.1, 0.8];
    const y: Vec4 = [0.4, 0.2, -0.1, 0.8];
    const f = 1 / 0.85;
    const v: Vec4 = [
      2 * (y[0] * f) + p[0],
      2 * (y[1] * f) + p[1],
      2 * (y[2] * f) + p[2],
      2 * (y[3] * f) + p[3],
    ];
    const de = buildEscapeDE4([
      foldMap(0, "spherefold", 2, { position: [0.2, 0, 0] }),
    ]);
    expect(estimateEscapeDistance4(de, p, 1)).toBeCloseTo(
      Math.hypot(v[0], v[1], v[2], v[3]) / (2 * f + 1),
      12,
    );
  });

  it("squares the FULL quaternion -- a boxfold -> qsquare pass at nonzero w", () => {
    // Two links, so ONE pass is TWO steps. Both LINEAR parts are the identity;
    // link 1 carries a w TRANSLATION of 0.5, so the k component is in play
    // from the map as well as from the query p = (1.5, 0.5, -0.25, 0.1).
    //
    //   step 0, boxfold (weight 1, wall 1): only x leaves the box.
    //     f  = (2 - 1.5, 0.5, -0.25, 0.1) = (0.5, 0.5, -0.25, 0.1)
    //     v  = f + p = (2, 1, -0.5, 0.2);  |v| = 2.3, still inside the ball,
    //          so the bailout test after this link passes and step 1 runs
    //     dr = 1*1*1 + 1 = 2
    //   step 1, qsquare (weight 1, t_w = 0.5):
    //     y   = v + t = (2, 1, -0.5, 0.7)
    //     q^2 = (x^2 - y^2 - z^2 - w^2, 2xy, 2xz, 2xw)
    //         = (4 - 1 - 0.25 - 0.49, 4, -2, 2.8) = (2.26, 4, -2, 2.8)
    //     v   = q^2 + p = (3.76, 4.5, -2.25, 2.9);  |v| = 6.918099
    //     L   = 2|y| = 2*sqrt(5.74) = 4.791659, EXACT for a quaternion square
    //     dr  = 1*4.791659*2 + 1 = 10.583319
    //   A power link makes the chain super-exponential, so the estimate is the
    //   Boettcher form rather than the folds' linear r/dr:
    //     DE = 0.5 * 6.918099 * ln(6.918099) / 10.583319 = 0.632154
    //
    // Drop the -w^2 from the real part and it reads 0.670963; point the k
    // term at z (2*yx*yz where 2*yx*yw belongs) and it reads 0.583235.
    const p: Vec4 = [1.5, 0.5, -0.25, 0.1];
    const fold0: Vec4 = [2 * 1 - p[0], p[1], p[2], p[3]];
    const v0: Vec4 = [
      fold0[0] + p[0],
      fold0[1] + p[1],
      fold0[2] + p[2],
      fold0[3] + p[3],
    ];
    const y1: Vec4 = [v0[0], v0[1], v0[2], v0[3] + 0.5];
    const v1: Vec4 = [
      y1[0] * y1[0] - y1[1] * y1[1] - y1[2] * y1[2] - y1[3] * y1[3] + p[0],
      2 * y1[0] * y1[1] + p[1],
      2 * y1[0] * y1[2] + p[2],
      2 * y1[0] * y1[3] + p[3],
    ];
    const r = Math.hypot(v1[0], v1[1], v1[2], v1[3]);
    const dr = 2 * Math.hypot(y1[0], y1[1], y1[2], y1[3]) * 2 + 1;
    const de = buildEscapeDE4([
      foldMap(0, "boxfold", 1),
      powerMap(1, "qsquare", 1, { w: { position: 0.5 } }),
    ]);
    expect(estimateEscapeDistance4(de, p, 1)).toBeCloseTo(
      (0.5 * r * Math.log(r)) / dr,
      12,
    );
  });
});

describe("probeEscapeFill4 (fr-vag4)", () => {
  it("samples the SAME 512 points every call — the default seed, by value", () => {
    // The 3D twin's rule: the default seed is a CONSTANT, so 512 samples of
    // this chain have ONE answer, and the answer is written down. Calling
    // the same pure function twice and comparing would hold for a
    // Math.random() seed too — which is the whole of what "deterministic"
    // is claiming here. 512 samples, so the fill is an exact k/512.
    const de = buildEscapeDE4([
      canonicalMandelbox(),
      foldMap(1, "boxfold", 1.6),
    ]);
    const fill = probeEscapeFill4(de, 512);
    expect(fill).toBe(0.00390625);
    // The same number as a count — 2 of the 512 samples were members, which
    // is what a THIN 4D set looks like through a volume probe (the module
    // doc's own warning against reading fill as "will it render").
    expect(fill * 512).toBe(2);
  });

  it("returns 0 for points <= 0", () => {
    const de = buildEscapeDE4([canonicalMandelbox()]);
    expect(probeEscapeFill4(de, 0)).toBe(0);
    expect(probeEscapeFill4(de, -10)).toBe(0);
  });

  it("lies in [0, 1] and is > 0 for a system known to have volume", () => {
    // A classic mandelbox lifted with a small w rotation -- the module doc's
    // own example of a system that genuinely reaches out of w = 0.
    const de = buildEscapeDE4([
      canonicalMandelbox({ w: { rotation: { xw: 0.3 } } }),
    ]);
    const fill = probeEscapeFill4(de, 2048);
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThanOrEqual(1);
  });

  it("never samples past the bailout radius -- a stub-free check on the sampler itself", () => {
    // A single link at weight 0 leaves v = q at every step (0 * anything
    // finite is exactly 0), so the orbit's radius never moves: any point
    // with |q| <= ESCAPE_TIME_RADIUS is a member BY CONSTRUCTION, for every
    // one of the 30 passes. If the sampler ever drew a point past the
    // bailout radius, escapeSetContains4 would read it as a non-member on
    // the spot (the loop's own entry guard, r <= ESCAPE_TIME_RADIUS), so a
    // fill of EXACTLY 1 is a direct, stub-free readout of "the sampler drew
    // in the 4-ball" straight through the shipped code path -- sampleS3
    // itself stays unexported and untouched.
    const link: EscapeLink4 = {
      // prettier-ignore
      m: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      t: [0, 0, 0, 0],
      kind: ESCAPE_LINK_BOXFOLD,
      w: 0,
      derivGrowth: 0,
      boxLimit: 1,
      minRadius2: 0.25,
      fixedRadius2: 1,
    };
    const inert: EscapeDE4 = {
      ...link,
      links: [link],
      logEstimate: false,
      symmetryOrder: 1,
      symmetryPlane: "xz",
      boundingRadius: ESCAPE_TIME_RADIUS,
    };
    expect(probeEscapeFill4(inert, 4096)).toBe(1);
  });
});
