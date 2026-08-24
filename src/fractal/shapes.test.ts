import {
  GEAR_SHAPE,
  MAX_SHAPE_PARTS,
  PEACE_SIGN_SHAPE,
  SHAPE_MARCH_SAFETY,
  prepareShapeSampler,
  shapeBoundingRadius,
  shapeSdf,
  shapeSdfSource,
} from "./shapes";
import type { ShapePart, ShapePose, ShapePrimitive, ShapeSpec } from "./shapes";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";

// ----------------------------------------------------- seeded spec makers

function randomPrimitive(rng: Rng): ShapePrimitive {
  const k = Math.floor(rng() * 5);
  switch (k) {
    case 0:
      return { kind: "sphere", radius: 0.3 + rng() };
    case 1:
      return {
        kind: "box",
        half: [0.2 + 0.8 * rng(), 0.2 + 0.8 * rng(), 0.2 + 0.8 * rng()],
      };
    case 2: {
      const major = 0.5 + rng();
      return { kind: "torus", major, minor: (0.1 + 0.3 * rng()) * major };
    }
    case 3:
      return {
        kind: "capsule",
        a: [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1],
        b: [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1],
        radius: 0.15 + 0.3 * rng(),
      };
    default:
      return {
        kind: "gear",
        teeth: 3 + Math.floor(rng() * 10),
        radius: 0.5 + rng(),
        tooth: [0.1 + 0.2 * rng(), 0.06 + 0.1 * rng()],
        hole: rng() < 0.5 ? 0 : 0.15 + 0.2 * rng(),
        halfHeight: 0.1 + 0.3 * rng(),
      };
  }
}

function randomPose(rng: Rng): ShapePose | undefined {
  if (rng() < 0.25) return undefined;
  const pose: ShapePose = {};
  if (rng() < 0.8) {
    pose.offset = [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1];
  }
  if (rng() < 0.8) {
    pose.rotate = [
      (2 * rng() - 1) * Math.PI,
      (2 * rng() - 1) * Math.PI,
      (2 * rng() - 1) * Math.PI,
    ];
  }
  if (rng() < 0.8) pose.scale = 0.4 + 1.6 * rng();
  return pose;
}

function randomSpec(rng: Rng, unionOnly: boolean): ShapeSpec {
  const count = 1 + Math.floor(rng() * 4);
  const parts: ShapePart[] = [];
  for (let i = 0; i < count; i++) {
    const part: ShapePart = {
      primitive: randomPrimitive(rng),
      combine: i > 0 && !unionOnly && rng() < 0.3 ? "intersect" : "union",
    };
    const pose = randomPose(rng);
    if (pose) part.pose = pose;
    parts.push(part);
  }
  return { parts };
}

// --------------------------------------------------------- (g) validation

describe("shape spec validation", () => {
  it("throws RangeError on an empty part list", () => {
    expect(() => shapeSdf({ parts: [] }, 0, 0, 0)).toThrow(RangeError);
  });

  it(`throws RangeError past ${MAX_SHAPE_PARTS} parts`, () => {
    const part: ShapePart = {
      primitive: { kind: "sphere", radius: 1 },
      combine: "union",
    };
    const parts = Array.from({ length: MAX_SHAPE_PARTS + 1 }, () => part);
    expect(() => shapeSdf({ parts }, 0, 0, 0)).toThrow(RangeError);
  });

  it(`accepts exactly ${MAX_SHAPE_PARTS} parts`, () => {
    const part: ShapePart = {
      primitive: { kind: "sphere", radius: 1 },
      combine: "union",
    };
    const parts = Array.from({ length: MAX_SHAPE_PARTS }, () => part);
    expect(shapeSdf({ parts }, 0, 0, 0)).toBe(-1);
  });

  it("throws RangeError when part 0 combines as intersect", () => {
    const spec: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 1 }, combine: "intersect" },
      ],
    };
    expect(() => shapeSdf(spec, 0, 0, 0)).toThrow(RangeError);
    expect(() => shapeBoundingRadius(spec)).toThrow(RangeError);
  });

  it("refuses to build a sampler over any intersect part, naming the reason", () => {
    const spec: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
        {
          primitive: { kind: "box", half: [1, 1, 1] },
          combine: "intersect",
        },
      ],
    };
    expect(() => prepareShapeSampler(spec)).toThrow(/SDF-only/);
  });

  it("refuses a sampler over a spec with no measure", () => {
    const spec: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 0 }, combine: "union" }],
    };
    expect(() => prepareShapeSampler(spec)).toThrow(/no measure/);
  });

  it("refuses codegen for a name that is not a plain identifier", () => {
    expect(() => shapeSdfSource(GEAR_SHAPE, "glsl", "bad name")).toThrow(
      /identifier/,
    );
  });
});

// --------------------------------------------- (e) fold and pose exactness

describe("shape fold and pose", () => {
  it("folds parts left-to-right as min for union and max for intersect", () => {
    const rng = mulberry32(0xf01d);
    for (let trial = 0; trial < 30; trial++) {
      const spec = randomSpec(rng, false);
      for (let j = 0; j < 10; j++) {
        const p: [number, number, number] = [
          4 * rng() - 2,
          4 * rng() - 2,
          4 * rng() - 2,
        ];
        // Reference: each part evaluated alone (as its own one-part spec),
        // folded by hand — pins the fold independent of primitive math.
        let want = 0;
        spec.parts.forEach((part, i) => {
          const alone = shapeSdf(
            { parts: [{ ...part, combine: "union" }] },
            p[0],
            p[1],
            p[2],
          );
          if (i === 0) want = alone;
          else if (part.combine === "intersect") want = Math.max(want, alone);
          else want = Math.min(want, alone);
        });
        expect(shapeSdf(spec, p[0], p[1], p[2])).toBe(want);
      }
    }
  });

  it("poses a sphere exactly: d(p) = |p - offset| - scale * radius under any rotation", () => {
    const rng = mulberry32(0x9053);
    for (let trial = 0; trial < 50; trial++) {
      const offset: [number, number, number] = [
        2 * rng() - 1,
        2 * rng() - 1,
        2 * rng() - 1,
      ];
      const scale = 0.4 + 1.6 * rng();
      const radius = 0.3 + rng();
      const spec: ShapeSpec = {
        parts: [
          {
            primitive: { kind: "sphere", radius },
            combine: "union",
            pose: {
              offset,
              rotate: [
                (2 * rng() - 1) * Math.PI,
                (2 * rng() - 1) * Math.PI,
                (2 * rng() - 1) * Math.PI,
              ],
              scale,
            },
          },
        ],
      };
      const p: [number, number, number] = [
        4 * rng() - 2,
        4 * rng() - 2,
        4 * rng() - 2,
      ];
      const want =
        Math.hypot(p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]) -
        scale * radius;
      expect(shapeSdf(spec, p[0], p[1], p[2])).toBeCloseTo(want, 9);
    }
  });

  it("is scale-equivariant: d(s·p) under pose scale s equals s · d(p) unposed", () => {
    const rng = mulberry32(0x5ca1e);
    for (let trial = 0; trial < 30; trial++) {
      const prim = randomPrimitive(rng);
      const s = 0.3 + 2 * rng();
      const posed: ShapeSpec = {
        parts: [{ primitive: prim, combine: "union", pose: { scale: s } }],
      };
      const plain: ShapeSpec = {
        parts: [{ primitive: prim, combine: "union" }],
      };
      const p: [number, number, number] = [
        4 * rng() - 2,
        4 * rng() - 2,
        4 * rng() - 2,
      ];
      expect(shapeSdf(posed, s * p[0], s * p[1], s * p[2])).toBeCloseTo(
        s * shapeSdf(plain, p[0], p[1], p[2]),
        9,
      );
    }
  });

  it("agrees in sign with a from-scratch gear membership oracle", () => {
    // Independent oracle: no sector fold — walk every tooth explicitly.
    const prim = GEAR_SHAPE.parts[0].primitive as Extract<
      ShapePrimitive,
      { kind: "gear" }
    >;
    const inGear = (x: number, y: number, z: number): boolean => {
      if (Math.abs(z) > prim.halfHeight) return false;
      const lp = Math.hypot(x, y);
      if (lp < prim.hole) return false;
      if (lp <= prim.radius) return true;
      const seg = (2 * Math.PI) / prim.teeth;
      for (let k = 0; k < prim.teeth; k++) {
        const c = Math.cos(k * seg);
        const s = Math.sin(k * seg);
        const tx = c * x + s * y;
        const ty = -s * x + c * y;
        if (
          Math.abs(tx - prim.radius) <= prim.tooth[0] &&
          Math.abs(ty) <= prim.tooth[1]
        ) {
          return true;
        }
      }
      return false;
    };
    const rng = mulberry32(0x6ea8);
    let members = 0;
    for (let i = 0; i < 4000; i++) {
      const x = 2.8 * rng() - 1.4;
      const y = 2.8 * rng() - 1.4;
      const z = 0.7 * rng() - 0.35;
      const d = shapeSdf(GEAR_SHAPE, x, y, z);
      // Skip the numeric skin of the boundary — sign comparisons there
      // test float rounding, not the construction.
      if (Math.abs(d) < 1e-9) continue;
      expect(d <= 0).toBe(inGear(x, y, z));
      if (d <= 0) members++;
    }
    expect(members).toBeGreaterThan(200);
  });

  it("treats gear hole 0 as no hole: the axis is deep interior, not boundary", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: {
            kind: "gear",
            teeth: 8,
            radius: 1,
            tooth: [0.22, 0.16],
            hole: 0,
            halfHeight: 0.25,
          },
          combine: "union",
        },
      ],
    };
    // The literal max(d, 0 - |p|) would read 0 here; the omitted term
    // reads the true interior depth (the top/bottom face at 0.25).
    expect(shapeSdf(spec, 0, 0, 0)).toBeCloseTo(-0.25, 12);
  });
});

// ------------------------------------------- (a) sampler-to-SDF agreement

describe("shape sampler agreement", () => {
  it("samples only members: sdf <= 1e-7 at every solid draw, |p| within the bound", () => {
    const rng = mulberry32(0x5a3d1e);
    const specs = [
      PEACE_SIGN_SHAPE,
      GEAR_SHAPE,
      randomSpec(mulberry32(0xabc1), true),
      randomSpec(mulberry32(0xabc2), true),
    ];
    for (const spec of specs) {
      const draw = prepareShapeSampler(spec);
      const bound = shapeBoundingRadius(spec);
      for (let i = 0; i < 2000; i++) {
        const [x, y, z] = draw(rng);
        expect(shapeSdf(spec, x, y, z)).toBeLessThanOrEqual(1e-7);
        expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(bound + 1e-9);
      }
    }
  });

  it("samples the gear outline onto the profile boundary: |sdf| tiny at every draw", () => {
    const rng = mulberry32(0x0071e);
    const draw = prepareShapeSampler(GEAR_SHAPE, { gearOutline: true });
    for (let i = 0; i < 2000; i++) {
      const [x, y, z] = draw(rng);
      expect(Math.abs(shapeSdf(GEAR_SHAPE, x, y, z))).toBeLessThanOrEqual(1e-8);
      expect(Math.abs(z)).toBeLessThanOrEqual(0.25);
    }
  });
});

// ------------------------------------------------- (f) sampler uniformity

describe("shape sampler uniformity", () => {
  it("fills a sphere uniformly: half the draws inside the half-volume radius, even octants", () => {
    const spec: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
    };
    const draw = prepareShapeSampler(spec);
    const rng = mulberry32(0x0f111);
    const n = 40000;
    let inner = 0;
    const octants = new Array<number>(8).fill(0);
    const halfVolumeRadius = Math.cbrt(0.5);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = draw(rng);
      if (Math.hypot(x, y, z) <= halfVolumeRadius) inner++;
      octants[(x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0) + (z >= 0 ? 4 : 0)]++;
    }
    expect(inner / n).toBeGreaterThan(0.485);
    expect(inner / n).toBeLessThan(0.515);
    for (const count of octants) {
      expect(count / n).toBeGreaterThan(0.11);
      expect(count / n).toBeLessThan(0.14);
    }
  });

  it("does not double-weight a union overlap: min-index acceptance matches the analytic lens fraction", () => {
    // Two unit spheres 0.8 apart: lens volume π(4r + d)(2r - d)² / 12.
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 1 },
          combine: "union",
          pose: { offset: [-0.4, 0, 0] },
        },
        {
          primitive: { kind: "sphere", radius: 1 },
          combine: "union",
          pose: { offset: [0.4, 0, 0] },
        },
      ],
    };
    const lens = (Math.PI * (4 + 0.8) * (2 - 0.8) ** 2) / 12;
    const union = 2 * ((4 / 3) * Math.PI) - lens;
    const want = lens / union; // ≈ 0.2755; double-weighting would read ≈ 0.432
    const draw = prepareShapeSampler(spec);
    const rng = mulberry32(0x1e45);
    const n = 50000;
    let overlap = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = draw(rng);
      const inA = Math.hypot(x + 0.4, y, z) <= 1;
      const inB = Math.hypot(x - 0.4, y, z) <= 1;
      expect(inA || inB).toBe(true);
      if (inA && inB) overlap++;
    }
    expect(overlap / n).toBeGreaterThan(want - 0.015);
    expect(overlap / n).toBeLessThan(want + 0.015);
  });
});

// ------------------------------------------------ (c) Lipschitz disclosure

interface LipschitzProbe {
  worst: number;
  at: [number, number, number];
}

function probeLipschitz(
  spec: ShapeSpec,
  seed: number,
  extraPoints: Array<[number, number, number]>,
): LipschitzProbe {
  const bound = shapeBoundingRadius(spec);
  const rng = mulberry32(seed);
  const h = bound * 1e-5;
  const probe: LipschitzProbe = { worst: 0, at: [0, 0, 0] };
  const f = (x: number, y: number, z: number): number =>
    shapeSdf(spec, x, y, z);
  const consider = (x: number, y: number, z: number): void => {
    const gx = (f(x + h, y, z) - f(x - h, y, z)) / (2 * h);
    const gy = (f(x, y + h, z) - f(x, y - h, z)) / (2 * h);
    const gz = (f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
    const g = Math.hypot(gx, gy, gz);
    if (g > probe.worst) {
      probe.worst = g;
      probe.at = [x, y, z];
    }
    // A secant is the honest Lipschitz probe; the gradient norm alone
    // misses a value jump the central difference happens to straddle.
    const step = bound * 1e-3;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const qx = x + step * st * Math.cos(ph);
    const qy = y + step * st * Math.sin(ph);
    const qz = z + step * ct;
    const s =
      Math.abs(f(x, y, z) - f(qx, qy, qz)) / Math.hypot(qx - x, qy - y, qz - z);
    if (s > probe.worst) {
      probe.worst = s;
      probe.at = [x, y, z];
    }
  };
  for (let i = 0; i < 4000; i++) {
    const r = 1.25 * bound * Math.cbrt(rng());
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    consider(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct);
  }
  for (const [x, y, z] of extraPoints) consider(x, y, z);
  return probe;
}

describe("shape Lipschitz discipline", () => {
  it("keeps the peace sign within the marching safety factor, and discloses the worst constant", () => {
    const probe = probeLipschitz(PEACE_SIGN_SHAPE, 0x11b5, []);
    console.log(
      `peace sign worst measured Lipschitz ${probe.worst.toFixed(6)} at [${probe.at
        .map((v) => v.toFixed(4))
        .join(", ")}]`,
    );
    expect(probe.worst * SHAPE_MARCH_SAFETY).toBeLessThanOrEqual(1);
  });

  it("keeps the gear within the marching safety factor with seam-clustered probes, and discloses", () => {
    // Deliberately hostile points: the sector-fold seams (halfway between
    // teeth) and the atan2 branch cut at ±π, where the fold is only
    // piecewise smooth.
    const prim = GEAR_SHAPE.parts[0].primitive as Extract<
      ShapePrimitive,
      { kind: "gear" }
    >;
    const seg = (2 * Math.PI) / prim.teeth;
    const outer = prim.radius + prim.tooth[0];
    const rng = mulberry32(0x5ea6);
    const extra: Array<[number, number, number]> = [];
    for (let k = 0; k < prim.teeth; k++) {
      for (let j = 0; j < 30; j++) {
        const angle = (k + 0.5) * seg + (rng() - 0.5) * 1e-4;
        const r = (0.2 + 1.15 * rng()) * outer;
        extra.push([
          r * Math.cos(angle),
          r * Math.sin(angle),
          (2 * rng() - 1) * 0.4,
        ]);
      }
    }
    for (let j = 0; j < 60; j++) {
      const angle = Math.PI + (rng() - 0.5) * 1e-6;
      const r = (0.2 + 1.15 * rng()) * outer;
      extra.push([
        r * Math.cos(angle),
        r * Math.sin(angle),
        (2 * rng() - 1) * 0.4,
      ]);
    }
    const probe = probeLipschitz(GEAR_SHAPE, 0x6ea9, extra);
    console.log(
      `gear worst measured Lipschitz ${probe.worst.toFixed(6)} at [${probe.at
        .map((v) => v.toFixed(4))
        .join(", ")}]`,
    );
    expect(probe.worst * SHAPE_MARCH_SAFETY).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------- (d) emission pinned

describe("shape SDF emission", () => {
  it("executes the shared template: the js dialect agrees with shapeSdf over random specs, poses and points", () => {
    const rng = mulberry32(0xe141);
    for (let trial = 0; trial < 40; trial++) {
      const spec = randomSpec(rng, false);
      const src = shapeSdfSource(spec, "js", "shapeFn");
      // The point of the js dialect is to EXECUTE the emitted template
      // text; the string comes from this repo's own codegen, not input.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(`${src}\nreturn shapeFn;`)() as (
        x: number,
        y: number,
        z: number,
      ) => number;
      const reach = shapeBoundingRadius(spec) + 1;
      for (let j = 0; j < 25; j++) {
        const x = (2 * rng() - 1) * 2 * reach;
        const y = (2 * rng() - 1) * 2 * reach;
        const z = (2 * rng() - 1) * 2 * reach;
        const want = shapeSdf(spec, x, y, z);
        const got = fn(x, y, z);
        expect(Math.abs(got - want)).toBeLessThanOrEqual(
          1e-9 * Math.max(1, Math.abs(want)),
        );
      }
    }
  });

  it("emits one template: glsl, wgsl and js sources are identical once dialect tokens are normalized away", () => {
    // The per-dialect tokens (module doc's sharp-edge table): signature
    // grammar, the p.x/p.y/p.z unpack the js signature does not need,
    // Math.-prefixed intrinsics, atan vs atan2, float-vs-let declarations.
    const normalize = (src: string): string =>
      src
        .split("\n")
        .filter((line) => !/^\s*(?:float|let) p[xyz] = p\.[xyz];$/.test(line))
        .map((line) =>
          line
            .replace(
              /^(?:float|fn|function)\s+\w+\(.*\)(?:\s*->\s*f32)?\s*\{$/,
              "SIG {",
            )
            .replaceAll("Math.", "")
            .replaceAll("atan2(", "atan(")
            .replace(/\b(?:float|let)\s+/g, ""),
        )
        .join("\n");
    const rng = mulberry32(0x704e);
    const specs = [PEACE_SIGN_SHAPE, GEAR_SHAPE, randomSpec(rng, false)];
    for (const spec of specs) {
      const glsl = normalize(shapeSdfSource(spec, "glsl", "shapeFn"));
      const wgsl = normalize(shapeSdfSource(spec, "wgsl", "shapeFn"));
      const js = normalize(shapeSdfSource(spec, "js", "shapeFn"));
      expect(glsl.length).toBeGreaterThan(0);
      expect(wgsl).toBe(glsl);
      expect(js).toBe(glsl);
    }
  });

  it("spells the two-argument arctangent per dialect: GLSL atan(y, x), WGSL atan2(y, x)", () => {
    const glsl = shapeSdfSource(GEAR_SHAPE, "glsl", "gearFn");
    const wgsl = shapeSdfSource(GEAR_SHAPE, "wgsl", "gearFn");
    expect(glsl).toContain("atan(py, px)");
    expect(glsl).not.toContain("atan2");
    expect(wgsl).toContain("atan2(py, px)");
  });

  it("emits the sector fold as an explicit floor-mod, never the % operator", () => {
    for (const dialect of ["glsl", "wgsl"] as const) {
      const src = shapeSdfSource(GEAR_SHAPE, dialect, "gearFn");
      expect(src).toContain("floor(a0 / seg)");
      expect(src).not.toContain("%");
    }
  });

  it("formats every baked number as a float literal valid in both shader dialects", () => {
    const rng = mulberry32(0xf10a7);
    for (let trial = 0; trial < 10; trial++) {
      const spec = randomSpec(rng, false);
      for (const dialect of ["glsl", "wgsl"] as const) {
        const src = shapeSdfSource(spec, dialect, "shapeFn");
        // A digit run not attached to an identifier, a fraction, or an
        // exponent (signed exponents included) would parse as an int in
        // WGSL and poison f32 math.
        expect(src).not.toMatch(/(?<![\w.])(?<![eE][+-])\d+(?![\w.eE])/);
      }
    }
  });

  it("declares WGSL locals with let, never a C-style type prefix", () => {
    const src = shapeSdfSource(PEACE_SIGN_SHAPE, "wgsl", "peaceFn");
    expect(src).toContain("let d0 =");
    expect(src).not.toMatch(/\bf32\s+\w+\s*=/);
    expect(src).not.toMatch(/\bfloat\b/);
  });

  it("prefixes helpers with the caller's name so two emitted shapes cannot collide", () => {
    const src = shapeSdfSource(GEAR_SHAPE, "glsl", "trapShape");
    expect(src).toContain("trapShape_gear2(");
    expect(src).toContain("trapShape_box2(");
    expect(src).not.toMatch(/\bsdBox2\b/);
  });

  it("emits each helper at most once per source", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: {
            kind: "gear",
            teeth: 6,
            radius: 1,
            tooth: [0.2, 0.12],
            hole: 0.3,
            halfHeight: 0.2,
          },
          combine: "union",
        },
        {
          primitive: {
            kind: "gear",
            teeth: 12,
            radius: 0.6,
            tooth: [0.1, 0.06],
            hole: 0,
            halfHeight: 0.3,
          },
          combine: "union",
          pose: { offset: [1.4, 0, 0] },
        },
      ],
    };
    const src = shapeSdfSource(spec, "wgsl", "twoGears");
    expect(src.match(/fn twoGears_gear2\(/g)).toHaveLength(1);
    expect(src.match(/fn twoGears_box2\(/g)).toHaveLength(1);
  });

  it("omits the hole term entirely for a hole-0 gear", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: {
            kind: "gear",
            teeth: 8,
            radius: 1,
            tooth: [0.2, 0.12],
            hole: 0,
            halfHeight: 0.2,
          },
          combine: "union",
        },
      ],
    };
    const withHole = shapeSdfSource(GEAR_SHAPE, "glsl", "g");
    const noHole = shapeSdfSource(spec, "glsl", "g");
    expect(withHole).toContain("gh0");
    expect(noHole).not.toContain("gh0");
  });

  it("throws rather than bake a non-finite constant", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: Number.NaN },
          combine: "union",
        },
      ],
    };
    expect(() => shapeSdfSource(spec, "glsl", "shapeFn")).toThrow(/non-finite/);
  });
});

// --------------------------------------------------------- bounding radius

describe("shapeBoundingRadius", () => {
  it("is attained by the reference shapes' own farthest features", () => {
    // Peace sign: the ring's outer edge, major + minor.
    expect(shapeBoundingRadius(PEACE_SIGN_SHAPE)).toBeCloseTo(1.12, 12);
    // Gear: the tooth-box corner, hypot(radius + t0, t1, halfHeight).
    expect(shapeBoundingRadius(GEAR_SHAPE)).toBeCloseTo(
      Math.hypot(1.22, 0.16, 0.25),
      12,
    );
  });

  it("never underestimates: random exterior points at the bound have positive sdf", () => {
    const rng = mulberry32(0xb0dd);
    for (let trial = 0; trial < 20; trial++) {
      const spec = randomSpec(rng, false);
      const bound = shapeBoundingRadius(spec);
      for (let j = 0; j < 50; j++) {
        const r = bound * (1 + 1e-6 + rng());
        const ct = 2 * rng() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rng();
        expect(
          shapeSdf(spec, r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct),
        ).toBeGreaterThan(0);
      }
    }
  });
});
