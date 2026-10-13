/**
 * The pentagrid floor's ONE vocabulary: a generative Penrose-rhombus floor
 * pattern for the presentation floor (Solid's floor and Surface's ground
 * plane), authored as pure parameters — no seeds — so every floor is
 * controlled, reproducible, and shareable like the rest of the document.
 *
 * THE CONSTRUCTION. Five families of parallel lines (the de Bruijn
 * pentagrid) over the floor plane: family i has unit normal n_i (rotated
 * by the authored rotation, spaced 72° apart) and lines n_i·p = (k + s_i)·
 * scale for integer k and the authored phason shift s_i ∈ [0, 1). Every
 * crossing of two lines contributes ONE rhombus: the parallelogram spanned
 * by the projected site vectors of the four floor cells surrounding it —
 * site m⁰ = (k_i − 1, k_j − 1, floor(f_l(c)) for the other three), drawn at
 * π(m⁰) = Σ m⁰_l·scale·n_l with side vectors v_l = scale·n_l. The FULL
 * enumeration of these parallelograms tiles the plane: measured here and in
 * the design sheet, ~100.0% coverage, 0 overlapping pixels, and a fat-rhombus
 * area share of 72.5% against the theoretical 72.4% (φ²·sin72° over
 * sin36° + φ²·sin72°) — the exact de Bruijn dual, no selection rule needed.
 * Fat/thin classes follow the family distance: |i − j| ≡ ±1 (mod 5) is a fat
 * rhombus (72° acute angle), |i − j| ≡ ±2 a thin one (36°).
 *
 * THE PER-PIXEL ALGORITHM (what the shaders run — the polygon pipeline
 * above is only an oracle). Inverting the site formula
 * π(m⁰) = (5/2)·c − scale·Σ s_l n_l − bounded terms seeds the containing
 * crossing at c* = (2/5)·(p + S), where S = scale·Σ s_l n_l is computed
 * host-side. For each pair (i, j) the levels k ∈ {floor(f_l(c*)) ± 2} (5×5)
 * are solved EXACTLY (2×2), the site is rebuilt from floor(f_l(c)) — the
 * consistency the construction demands — and the containment test
 * t ∈ [0, 1)² decides. Exactly one of the 250 candidates contains p:
 * CERTIFIED against the polygon pipeline at 102,400 sample points across
 * four parameter sets (both phason vectors, the 36° rotation, the small
 * phason nudge) with ZERO misses and ZERO face mismatches, and the polygon
 * audit independently measures 0 overlap, so first-containment-wins is
 * sound. The ±2 level jitter covers the seed's bounded error: the c* slop —
 * (2/5)·(scale·Σ frac_l n_l + the t-combination) — reaches ~1.0·scale
 * (measured: ±1 missed ~0.1% of samples), so the seed need not be exact but
 * the jitter must span it.
 *
 * THE LOOK. Authored: five phason shifts (the unforeseeable knob — a nudge
 * re-tiles the whole floor), rotation in [0°, 72°) (the grid's symmetry),
 * a coloring rule, one of four authored cosine palettes (`palette.ts`'s iq
 * family), and a grout width. All Penrose tilings are locally isomorphic —
 * every phason shows the same fat:thin statistics — so arrangement alone is
 * structurally capped; the coloring rule is the diversity budget (measured:
 * grey two-tone panels differ by 8–33/255 mean channel units across phasons
 * while color-rule panels differ by 72–92). Rules: "grey" is the classic
 * two-tone (fat light, thin mid, ±10% site-parity alternation, the
 * design-sheet look); "orientation"/"height"/"pair" paint the rhombus's
 * orientation class, site-height mod 5 (the g₁-invariant — large-scale
 * 5-fold color bands), or all ten pair classes through the palette, thin
 * rhombi deepened. Edges (grout) blend toward a fixed dark grey albedo.
 *
 * WIRE AND PARITY. The body is emitted from ONE template in both shader
 * dialects (the surface-finish.ts discipline) and mirrored in TS here; the
 * five normals, the scale, the seed offset S, and the palette are computed
 * HOST-SIDE per frame (`pentagridDerived`), so no shader computes cos/sin
 * and both dialects agree by construction. The floor reads world xz after
 * the 4D slice, so the body is dimension-free and the 4D arms take it
 * verbatim. Tone is an sRGB albedo replacing the floor's own: the grey rule
 * multiplies the neutral albedo exactly like the checker, the colored rules
 * replace it with the palette color (the shading/lighting/fog pipeline is
 * untouched). A per-pixel texture prepass was REFUSED: a 0.5R tile is ~25
 * texels wide at 1024², blurry exactly where the camera looks.
 */
type Vec2 = [number, number];
type Vec3 = [number, number, number];

/** The rhombus coloring rules — see the module doc's THE LOOK. */
export const PENTAGRID_COLOR_RULES = [
  "grey",
  "orientation",
  "height",
  "pair",
] as const;
export type PentagridColorRule = (typeof PENTAGRID_COLOR_RULES)[number];

/** The authored cosine palettes (iq a/b/c/d per channel). */
export const PENTAGRID_PALETTES = ["sunset", "marine", "dusk", "moss"] as const;
export type PentagridPalette = (typeof PENTAGRID_PALETTES)[number];

/** Authored pentagrid floor state — absent fields resolve to the defaults. */
export interface FloorPentagrid {
  /** Phason shift per grid family, wrapped to [0, 1). */
  shifts: readonly [number, number, number, number, number];
  /** Grid rotation in degrees, wrapped to [0, 72) — the grid's symmetry. */
  rotationDeg: number;
  colorRule: PentagridColorRule;
  palette: PentagridPalette;
  /** Edge (grout) width in multiples of the default ~1.2 px footprint. */
  grout: number;
}

export const DEFAULT_FLOOR_PENTAGRID: Readonly<FloorPentagrid> = {
  shifts: [0.13, 0.62, 0.35, 0.81, 0.47],
  rotationDeg: 0,
  colorRule: "grey",
  palette: "sunset",
  grout: 1,
};

const PALETTE_COEFFS: Readonly<
  Record<PentagridPalette, readonly [Vec3, Vec3, Vec3, Vec3]>
> = {
  sunset: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 1, 1],
    [0.0, 0.1, 0.2],
  ],
  marine: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 1, 0.5],
    [0.8, 0.9, 0.3],
  ],
  dusk: [
    [0.58, 0.5, 0.55],
    [0.42, 0.42, 0.42],
    [1, 1, 1],
    [0.25, 0.1, 0.45],
  ],
  moss: [
    [0.45, 0.52, 0.4],
    [0.35, 0.4, 0.3],
    [1, 1, 0.5],
    [0.0, 0.3, 0.55],
  ],
};

/**
 * Resolve an authored block against the defaults. Unknown rule/palette ids
 * fall back to the default (the persistence decoder's total-function
 * convention); numeric fields clamp or wrap into their domains. The result
 * is a fresh object — the input is never retained or mutated.
 */
export function resolveFloorPentagrid(
  block: Partial<FloorPentagrid> | undefined,
): FloorPentagrid {
  // In-domain values return UNCHANGED — the wrap arithmetic's add-and-
  // subtract is not an identity in binary floating point (0.13 + 1 - 1 is
  // a ulp off), and the resolution chain re-resolves resolved blocks (the
  // presentation spec resolves the state's block, the force-frame key
  // resolves the spec's), so idempotence is what makes "resolved" a fixed
  // point instead of a rounding walk.
  const wrap01 = (v: number): number => {
    if (!Number.isFinite(v)) return 0;
    if (v >= 0 && v < 1) return v;
    return ((v % 1) + 1) % 1;
  };
  const rawShifts = block?.shifts;
  const shifts = DEFAULT_FLOOR_PENTAGRID.shifts.map((dflt, i) => {
    const v = rawShifts?.[i];
    return v === undefined ? dflt : wrap01(v);
  }) as [number, number, number, number, number];
  const blockDeg = block?.rotationDeg;
  const rotationDeg = Number.isFinite(blockDeg)
    ? (((blockDeg as number) % PENTAGRID_ROTATION_PERIOD_DEG) +
        PENTAGRID_ROTATION_PERIOD_DEG) %
      PENTAGRID_ROTATION_PERIOD_DEG
    : DEFAULT_FLOOR_PENTAGRID.rotationDeg;
  const colorRule =
    block?.colorRule !== undefined &&
    (PENTAGRID_COLOR_RULES as readonly string[]).includes(block.colorRule)
      ? block.colorRule
      : DEFAULT_FLOOR_PENTAGRID.colorRule;
  const palette =
    block?.palette !== undefined &&
    (PENTAGRID_PALETTES as readonly string[]).includes(block.palette)
      ? block.palette
      : DEFAULT_FLOOR_PENTAGRID.palette;
  const groutRaw = block?.grout;
  const grout = Number.isFinite(groutRaw)
    ? Math.min(GROUT_MAX, Math.max(GROUT_MIN, groutRaw as number))
    : DEFAULT_FLOOR_PENTAGRID.grout;
  return { shifts, rotationDeg, colorRule, palette, grout };
}

/**
 * Structural copy of a sparse authored block: the block itself and its
 * shifts tuple are fresh, so a setter or spec owner never aliases the
 * caller's still-mutable data (the shifts tuple is the hazard — the other
 * fields are primitives). Like {@link resolveFloorPentagrid}, the input is
 * never retained.
 */
export function cloneFloorPentagridBlock(
  block: Partial<FloorPentagrid>,
): Partial<FloorPentagrid> {
  return {
    ...block,
    ...(block.shifts !== undefined
      ? { shifts: [...block.shifts] as FloorPentagrid["shifts"] }
      : {}),
  };
}

/** Stable rule ids the wire packs (`uniform` int / params word). */
export const PENTAGRID_RULE_WIRE_ID: Readonly<
  Record<PentagridColorRule, 0 | 1 | 2 | 3>
> = { grey: 0, orientation: 1, height: 2, pair: 3 };

export const PENTAGRID_ROTATION_PERIOD_DEG = 72;
const GROUT_MIN = 0.25;
const GROUT_MAX = 8;

/**
 * Host-side derived quantities, computed once per frame and pushed as
 * uniforms — no shader computes cos/sin, and the TS reference and both
 * dialects agree by construction. `tileScale` is the floor's existing
 * cell-width fraction of the ball radius (the checker's own knob).
 */
export interface PentagridDerived {
  /** Rhombus edge metric: ballRadius · tileScale, floored at 1e-4. */
  scale: number;
  /** Unit family normals n_i at the authored rotation. */
  normals: readonly [Vec2, Vec2, Vec2, Vec2, Vec2];
  /** The resolved phason shifts (uniform words 13..17). */
  shifts: readonly [number, number, number, number, number];
  /** Seed offset S = scale · Σ s_l·n_l — the c* = (2/5)(p + S) seed. */
  seedOffset: Vec2;
  /** The packed palette coefficients (a, b, c, d — three channels each). */
  paletteCoeffs: readonly [Vec3, Vec3, Vec3, Vec3];
}

export function pentagridDerived(
  block: FloorPentagrid,
  ballRadius: number,
  tileScale: number,
): PentagridDerived {
  const scale = Math.max(ballRadius * tileScale, 1e-4);
  const rad = (block.rotationDeg * Math.PI) / 180;
  const normals: [Vec2, Vec2, Vec2, Vec2, Vec2] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const seedOffset: Vec2 = [0, 0];
  for (let i = 0; i < 5; i++) {
    const a = rad + (i * 2 * Math.PI) / 5;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    normals[i] = [nx, ny];
    seedOffset[0] += block.shifts[i] * nx;
    seedOffset[1] += block.shifts[i] * ny;
  }
  seedOffset[0] *= scale;
  seedOffset[1] *= scale;
  return {
    scale,
    normals,
    shifts: [...block.shifts] as [number, number, number, number, number],
    seedOffset,
    paletteCoeffs: PALETTE_COEFFS[block.palette],
  };
}

/** The iq cosine palette, sRGB out — the shader body's own formula. */
export function iqPaletteColor(
  coeffs: readonly [Vec3, Vec3, Vec3, Vec3],
  t: number,
): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = Math.min(
      1,
      Math.max(
        0,
        coeffs[0][k] +
          coeffs[1][k] *
            Math.cos(2 * Math.PI * (coeffs[2][k] * t + coeffs[3][k])),
      ),
    );
  }
  return out;
}

/** The face the per-pixel algorithm found: families (i, j), the site, and
 * the containment parameters — everything the tone needs. */
export interface PentagridFace {
  i: number;
  j: number;
  m0: readonly [number, number, number, number, number];
  tI: number;
  tJ: number;
}

/**
 * The per-pixel face search — the TS mirror of the shader body's geometry.
 * `rel` is the world point relative to the floor's ball center. Returns the
 * unique containing face, or null off the construction's measure-zero
 * degeneracies — the tiling covers the whole plane, so any ordinary point
 * finds one. The pair/level scan order is part of the contract: it makes
 * the representative site deterministic (first containing candidate wins),
 * matching the polygon oracle's enumeration order.
 */
export function pentagridFaceAt(
  d: PentagridDerived,
  relX: number,
  relZ: number,
): PentagridFace | null {
  const scale = d.scale;
  const seedX = (relX + d.seedOffset[0]) * 0.4;
  const seedZ = (relZ + d.seedOffset[1]) * 0.4;
  const fh: number[] = [];
  for (let l = 0; l < 5; l++) {
    fh.push(
      (d.normals[l][0] * seedX + d.normals[l][1] * seedZ) / scale - d.shifts[l],
    );
  }
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const det =
        d.normals[i][0] * d.normals[j][1] - d.normals[i][1] * d.normals[j][0];
      const detV = det * scale * scale;
      const fi = Math.floor(fh[i]);
      const fj = Math.floor(fh[j]);
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          const ki = fi + di;
          const kj = fj + dj;
          const ci = (ki + d.shifts[i]) * scale;
          const cj = (kj + d.shifts[j]) * scale;
          const cx = (ci * d.normals[j][1] - d.normals[i][1] * cj) / det;
          const cy = (d.normals[i][0] * cj - ci * d.normals[j][0]) / det;
          const m0: [number, number, number, number, number] = [0, 0, 0, 0, 0];
          for (let l = 0; l < 5; l++) {
            m0[l] =
              l === i
                ? ki - 1
                : l === j
                  ? kj - 1
                  : Math.floor(
                      (d.normals[l][0] * cx + d.normals[l][1] * cy) / scale -
                        d.shifts[l],
                    );
          }
          let px = 0;
          let py = 0;
          for (let l = 0; l < 5; l++) {
            px += m0[l] * d.normals[l][0] * scale;
            py += m0[l] * d.normals[l][1] * scale;
          }
          const rx = relX - px;
          const rz = relZ - py;
          const vix = d.normals[i][0] * scale;
          const viy = d.normals[i][1] * scale;
          const vjx = d.normals[j][0] * scale;
          const vjy = d.normals[j][1] * scale;
          const tI = (rx * vjy - rz * vjx) / detV;
          const tJ = (vix * rz - viy * rx) / detV;
          if (tI >= 0 && tI < 1 && tJ >= 0 && tJ < 1) {
            return { i, j, m0, tI, tJ };
          }
        }
      }
    }
  }
  return null;
}

/**
 * The polygon-oracle face enumerator — the certification instrument. Every
 * crossing of two families in the extended range contributes its
 * parallelogram; the enumeration order matches {@link pentagridFaceAt}'s
 * scan so the representative sites agree.
 */
export function pentagridFaces(
  d: PentagridDerived,
  extent: number,
  margin: number,
): {
  i: number;
  j: number;
  m0: readonly [number, number, number, number, number];
  px: number;
  py: number;
}[] {
  const scale = d.scale;
  const shifts = d.shifts;
  const R = extent + margin;
  const out: {
    i: number;
    j: number;
    m0: readonly [number, number, number, number, number];
    px: number;
    py: number;
  }[] = [];
  const seen = new Set<string>();
  const fval = (l: number, x: number, y: number): number =>
    (d.normals[l][0] * x + d.normals[l][1] * y) / scale - shifts[l];
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const det =
        d.normals[i][0] * d.normals[j][1] - d.normals[i][1] * d.normals[j][0];
      const klo = Math.ceil(-R / scale - shifts[i] - 1);
      const khi = Math.floor(R / scale - shifts[i] + 1);
      for (let ki = klo; ki <= khi; ki++) {
        const kjlo = Math.ceil(-R / scale - shifts[j] - 1);
        const kjhi = Math.floor(R / scale - shifts[j] + 1);
        for (let kj = kjlo; kj <= kjhi; kj++) {
          const ci = (ki + shifts[i]) * scale;
          const cj = (kj + shifts[j]) * scale;
          const cx = (ci * d.normals[j][1] - d.normals[i][1] * cj) / det;
          const cy = (d.normals[i][0] * cj - ci * d.normals[j][0]) / det;
          if (Math.abs(cx) > R || Math.abs(cy) > R) continue;
          const m0: [number, number, number, number, number] = [0, 0, 0, 0, 0];
          for (let l = 0; l < 5; l++) m0[l] = Math.floor(fval(l, cx, cy));
          m0[i] = ki - 1;
          m0[j] = kj - 1;
          let px = 0;
          let py = 0;
          for (let l = 0; l < 5; l++) {
            px += m0[l] * d.normals[l][0] * scale;
            py += m0[l] * d.normals[l][1] * scale;
          }
          if (Math.abs(px) > extent + 1.5 || Math.abs(py) > extent + 1.5) {
            continue;
          }
          const key = `${i}:${j}:${px.toFixed(6)}:${py.toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ i, j, m0, px, py });
        }
      }
    }
  }
  return out;
}

/** The grey rule's fixed edge albedo (sRGB): pow(0.62 · 0.045, 1/2.2). */
export const PENTAGRID_EDGE_ALBEDO = Math.pow(0.62 * 0.045, 1 / 2.2);

/**
 * The TS mirror of the shader body — full tone for one floor point. `rel`
 * is world-relative-to-ball-center xz; `pxFootprint` is the world size of
 * one pixel. Returns the sRGB albedo the caller writes in place of the
 * floor's own.
 */
export function pentagridFloorTone(
  d: PentagridDerived,
  colorRule: PentagridColorRule,
  grout: number,
  relX: number,
  relZ: number,
  pxFootprint: number,
): Vec3 {
  const face = pentagridFaceAt(d, relX, relZ);
  const neutral: Vec3 = [0.62, 0.62, 0.62];
  if (!face) return [...neutral] as Vec3;
  const { i, j, m0, tI, tJ } = face;
  const dist = (j - i + 5) % 5;
  const fat = dist === 1 || dist === 4;
  const sum = m0[0] + m0[1] + m0[2] + m0[3] + m0[4];
  const hclass = ((sum % 5) + 5) % 5;
  const oclass = fat ? (dist === 1 ? i : j) : dist === 2 ? i : j;
  const cross = Math.abs(
    d.normals[i][0] * d.normals[j][1] - d.normals[i][1] * d.normals[j][0],
  );
  const edgeDist = Math.min(tI, 1 - tI, tJ, 1 - tJ) * cross * d.scale;
  const edgeW = pxFootprint * 1.2 * grout;
  const edgeCov = strokeCoverage(edgeDist, edgeW * 0.3, edgeW);
  let albedo: Vec3;
  if (colorRule === "grey") {
    const alt = ((sum % 2) + 2) % 2 === 0 ? 1.0 : 0.9;
    const tone = (fat ? 1.0 : 0.45) * alt;
    albedo = [neutral[0] * tone, neutral[1] * tone, neutral[2] * tone];
  } else {
    const t =
      colorRule === "orientation"
        ? oclass / 5
        : colorRule === "height"
          ? hclass / 5
          : (oclass + (fat ? 0 : 5)) / 10;
    const c = iqPaletteColor(d.paletteCoeffs, t);
    const k =
      colorRule === "orientation"
        ? fat
          ? 1.0
          : 0.5
        : colorRule === "height"
          ? fat
            ? 1.0
            : 0.7
          : 1.0;
    albedo = [c[0] * k, c[1] * k, c[2] * k];
  }
  const edge: Vec3 = [
    PENTAGRID_EDGE_ALBEDO,
    PENTAGRID_EDGE_ALBEDO,
    PENTAGRID_EDGE_ALBEDO,
  ];
  return [
    edge[0] + (albedo[0] - edge[0]) * (1 - edgeCov),
    edge[1] + (albedo[1] - edge[1]) * (1 - edgeCov),
    edge[2] + (albedo[2] - edge[2]) * (1 - edgeCov),
  ];
}

/** 1 inside (d < halfW), 0 outside, smoothed over aa — the shared stroke
 * helper, identical to the sheet's and the WGSL shade entry's. */
function strokeCoverage(d: number, halfW: number, aa: number): number {
  const t = (halfW + aa - d) / (2 * aa);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * The uniform wire: 32 floats, packed by {@link packFloorPentagridUniforms}.
 *   0..1   seedOffset S (x, y)
 *   2      scale
 *   3..12  normals n0..n4 (x, y)
 *   13..17 shifts s0..s4
 *   18     color rule id (PENTAGRID_RULE_WIRE_ID)
 *   19..21 palette a
 *   22..24 palette b
 *   25..27 palette c
 *   28..30 palette d
 *   31     grout
 * GLSL reads it as `uniform float uPentagridData[32]`; WGSL reads the same
 * words as the compute shade struct's gated `floorPentagrid` tail; Solid
 * and the cinematic material read the identical array. ONE layout, ONE
 * packer.
 */
export const PENTAGRID_UNIFORM_FLOATS = 32;

export function packFloorPentagridUniforms(
  d: PentagridDerived,
  block: FloorPentagrid,
): Float32Array {
  const out = new Float32Array(PENTAGRID_UNIFORM_FLOATS);
  out[0] = d.seedOffset[0];
  out[1] = d.seedOffset[1];
  out[2] = d.scale;
  for (let i = 0; i < 5; i++) {
    out[3 + i * 2] = d.normals[i][0];
    out[4 + i * 2] = d.normals[i][1];
  }
  for (let i = 0; i < 5; i++) out[13 + i] = block.shifts[i];
  out[18] = PENTAGRID_RULE_WIRE_ID[block.colorRule];
  for (let k = 0; k < 4; k++) {
    for (let ch = 0; ch < 3; ch++)
      out[19 + k * 3 + ch] = d.paletteCoeffs[k][ch];
  }
  out[31] = block.grout;
  return out;
}

/**
 * The per-dialect spellings the ONE body template interpolates — the
 * surface-finish.ts / surface-pattern-shade.ts discipline: everything is
 * the same characters in both dialects once the dialect's tokens are
 * normalized away, and a test pins the two emitted bodies equal under that
 * canonicalization so the tracers and the compute kernel cannot drift on
 * the arithmetic. The body reads the 32-float wire through {@link pf} and
 * the floor's neutral albedo through {@link groundAlbedo}; everything else
 * is parameters.
 */
export interface PentagridFloorDialect {
  readonly language: "glsl" | "wgsl";
  /** `vec2` / `vec2f`. */
  readonly vec2: string;
  /** `vec3` / `vec3f`. */
  readonly vec3: string;
  /** `float(x)` / `f32(x)`. */
  readonly cf: (e: string) => string;
  /** Scalar read of the 32-float wire at index expression `i`. */
  readonly pf: (i: string) => string;
  /** The floor's neutral albedo (vec3). */
  readonly groundAlbedo: string;
  /** Pick two floats on a bool — `pgSelF(a, b, cond)`, the SAME call text
   * in both dialects (the ternary-vs-select difference lives in the helper
   * definitions, which are dialect boilerplate beside the shared body). */
  readonly sel: (a: string, b: string, cond: string) => string;
  /** The vec3 sibling of {@link sel}. */
  readonly selV: (a: string, b: string, cond: string) => string;
  /** The pgSelF/pgSelV definitions, spelled per dialect. */
  readonly helpers: () => string;
  /** Immutable scalar / vec2 / vec3 locals. */
  readonly f: (name: string, init: string) => string;
  readonly v2: (name: string, init: string) => string;
  readonly v3: (name: string, init: string) => string;
  /** A MUTABLE scalar local — the accumulator declarations the body's
   * site-rebuild loop reassigns (mKSum/mX/mZ). GLSL spells it like every
   * other local (function locals are mutable); WGSL needs `var` — a `let`
   * binding there is immutable and the reassignment would not compile. */
  readonly mf: (name: string, init: string) => string;
  /** Mutable f32 array declaration (element-assigned by the fill loop). */
  readonly fArr: (name: string, size: number) => string;
  /** The `for` header over `name = 0 .. limit-1`. */
  readonly forRange: (name: string, limit: number) => string;
}

export const PENTAGRID_FLOOR_GLSL: PentagridFloorDialect = {
  language: "glsl",
  vec2: "vec2",
  vec3: "vec3",
  cf: (e) => `float(${e})`,
  pf: (i) => `uPentagridData[${i}]`,
  groundAlbedo: "uGroundAlbedo",
  sel: (a, b, cond) => `pgSelF(${a}, ${b}, ${cond})`,
  selV: (a, b, cond) => `pgSelV(${a}, ${b}, ${cond})`,
  helpers: () => `float pgSelF(float a, float b, bool c) { return c ? a : b; }
vec3 pgSelV(vec3 a, vec3 b, bool c) { return c ? a : b; }
`,
  f: (name, init) => `float ${name} = ${init};`,
  v2: (name, init) => `vec2 ${name} = ${init};`,
  v3: (name, init) => `vec3 ${name} = ${init};`,
  mf: (name, init) => `float ${name} = ${init};`,
  fArr: (name, size) => `float ${name}[${size}];`,
  forRange: (name, limit) =>
    `for (int ${name} = 0; ${name} < ${limit}; ${name}++)`,
};

export const PENTAGRID_FLOOR_WGSL: PentagridFloorDialect = {
  language: "wgsl",
  vec2: "vec2f",
  vec3: "vec3f",
  cf: (e) => `f32(${e})`,
  // The compute kernel's floor wire rides the SHADE struct's gated tail
  // (shade.floorPentagrid — the balloonTint precedent: the pattern is a
  // look, never geometry params), while groundAlbedo stays on the geometry
  // params block every ground-plane kernel declares. The tail is an
  // array<vec4f, 8> — WGSL's uniform address space requires 16-byte array
  // strides, so a scalar float array is invalid there — and the scalar
  // float at word k is member[k / 4][k % 4].
  pf: (i) => `shade.floorPentagrid[(${i}) / 4][(${i}) % 4]`,
  groundAlbedo: "params.groundAlbedo",
  sel: (a, b, cond) => `pgSelF(${a}, ${b}, ${cond})`,
  selV: (a, b, cond) => `pgSelV(${a}, ${b}, ${cond})`,
  helpers:
    () => `fn pgSelF(a: f32, b: f32, c: bool) -> f32 { return select(b, a, c); }
fn pgSelV(a: vec3f, b: vec3f, c: bool) -> vec3f { return select(b, a, c); }
`,
  f: (name, init) => `let ${name}: f32 = ${init};`,
  v2: (name, init) => `let ${name}: vec2f = ${init};`,
  v3: (name, init) => `let ${name}: vec3f = ${init};`,
  mf: (name, init) => `var ${name}: f32 = ${init};`,
  fArr: (name, size) => `var ${name}: array<f32, ${size}>;`,
  forRange: (name, limit) =>
    `for (var ${name}: i32 = 0; ${name} < ${limit}; ${name}++)`,
};

/** The positive-mod helper both dialects share: x − n·floor(x/n). */
const PMOD = (x: string, n: string): string =>
  `${x} - ${n} * floor(${x} / ${n})`;

/**
 * Emit `floorPentagridAlbedo` as source text in one dialect — the TS mirror
 * {@link pentagridFloorTone}, term for term: the seeded crossing search,
 * the site rebuild, the containment test, the class tone, and the grout
 * blend. `rel` is the world point relative to the floor's ball center; `px`
 * is one pixel's world footprint. Returns the sRGB albedo replacing the
 * floor's own. Callers splice this beside the existing checker branch and
 * dispatch on the pattern id; the checker text is untouched. The site's
 * exclusion tests use |l − i| < 0.5 — float equality done safely, never
 * `i*l` tricks — and the edge albedo is {@link PENTAGRID_EDGE_ALBEDO}'s
 * own literal so the reference and the shaders read one number.
 */
export function pentagridFloorAlbedoSource(
  dialect: PentagridFloorDialect,
): string {
  const D = dialect;
  const v2 = (x: string, y: string) => `${D.vec2}(${x}, ${y})`;
  const v3 = (x: string, y: string, z: string) => `${D.vec3}(${x}, ${y}, ${z})`;
  const pf = D.pf;
  const sig =
    D.language === "glsl"
      ? `${D.vec3} floorPentagridAlbedo(${D.vec2} rel, float px)`
      : `fn floorPentagridAlbedo(rel: ${D.vec2}, px: f32) -> ${D.vec3}`;
  return `${D.helpers()}${sig} {
  ${D.fArr("sH", 5)}
  ${D.fArr("nX", 5)}
  ${D.fArr("nZ", 5)}
  ${D.forRange("i0", 5)} {
    sH[i0] = ${pf("13 + i0")};
    nX[i0] = ${pf("3 + i0 * 2")};
    nZ[i0] = ${pf("4 + i0 * 2")};
  }
  ${D.f("scale", pf("2"))}
  ${D.v2("seedC", `(rel + ${v2(pf("0"), pf("1"))}) * 0.4`)}
  ${D.fArr("fh", 5)}
  ${D.forRange("i1", 5)} {
    fh[i1] = (nX[i1] * seedC.x + nZ[i1] * seedC.y) / scale - sH[i1];
  }
  ${D.forRange("i", 5)} {
    ${D.forRange("j", 5)} {
      if (j <= i) { continue; }
      ${D.f("det", "nX[i] * nZ[j] - nZ[i] * nX[j]")}
      ${D.f("detV", "det * scale * scale")}
      ${D.f("fi", "floor(fh[i])")}
      ${D.f("fj", "floor(fh[j])")}
      ${D.forRange("di", 5)} {
        ${D.forRange("dj", 5)} {
          ${D.f("ki", `${D.cf(`${D.cf("di")} + fi`)} - 2.0`)}
          ${D.f("kj", `${D.cf(`${D.cf("dj")} + fj`)} - 2.0`)}
          ${D.f("ci", "(ki + sH[i]) * scale")}
          ${D.f("cj", "(kj + sH[j]) * scale")}
          ${D.f("cx", "(ci * nZ[j] - nZ[i] * cj) / det")}
          ${D.f("cz", "(nX[i] * cj - ci * nX[j]) / det")}
          ${D.f("mI", "ki - 1.0")}
          ${D.f("mJ", "kj - 1.0")}
          ${D.mf("mKSum", "0.0")}
          ${D.mf("mX", "mI * nX[i] * scale + mJ * nX[j] * scale")}
          ${D.mf("mZ", "mI * nZ[i] * scale + mJ * nZ[j] * scale")}
          ${D.forRange("l", 5)} {
            if (abs(${D.cf("l")} - ${D.cf("i")}) < 0.5) { continue; }
            if (abs(${D.cf("l")} - ${D.cf("j")}) < 0.5) { continue; }
            ${D.f("mK", "floor((nX[l] * cx + nZ[l] * cz) / scale - sH[l])")}
            mKSum = mKSum + mK;
            mX = mX + mK * nX[l] * scale;
            mZ = mZ + mK * nZ[l] * scale;
          }
          ${D.f("rx", "rel.x - mX")}
          ${D.f("rz", "rel.y - mZ")}
          ${D.f("tI", "(rx * nZ[j] - rz * nX[j]) * scale / detV")}
          ${D.f("tJ", "(nX[i] * rz - nZ[i] * rx) * scale / detV")}
          if (tI >= 0.0 && tI < 1.0 && tJ >= 0.0 && tJ < 1.0) {
            ${D.f("dist", `${D.cf("j")} - ${D.cf("i")}`)}
            ${D.f("fat", D.sel("1.0", "0.0", "dist < 1.5 || dist > 3.5"))}
            ${D.f("sum", "mI + mJ + mKSum")}
            ${D.f("alt", D.sel("1.0", "0.9", `${PMOD("sum", "2.0")} < 0.5`))}
            ${D.f("hclass", PMOD("sum", "5.0"))}
            ${D.f(
              "oclass",
              D.sel(
                D.sel(D.cf("i"), D.cf("j"), "dist < 1.5"),
                D.sel(D.cf("i"), D.cf("j"), "dist < 2.5"),
                "fat > 0.5",
              ),
            )}
            ${D.f("edgeDist", "min(tI, min(1.0 - tI, min(tJ, 1.0 - tJ))) * abs(det) * scale")}
            ${D.f("edgeW", `px * 1.2 * ${pf("31")}`)}
            ${D.f("tc", "clamp((edgeW * 0.3 + edgeW - edgeDist) / (2.0 * edgeW), 0.0, 1.0)")}
            ${D.f("edgeCov", "tc * tc * (3.0 - 2.0 * tc)")}
            ${D.f("rule", pf("18"))}
            ${D.f(
              "tClass",
              D.sel(
                "oclass / 5.0",
                D.sel(
                  "hclass / 5.0",
                  `(oclass + ${D.sel("0.0", "5.0", "fat > 0.5")}) / 10.0`,
                  "rule < 2.5",
                ),
                "rule < 1.5",
              ),
            )}
            ${D.v3("pa", v3(pf("19"), pf("20"), pf("21")))}
            ${D.v3("pb", v3(pf("22"), pf("23"), pf("24")))}
            ${D.v3("pc", v3(pf("25"), pf("26"), pf("27")))}
            ${D.v3("pd", v3(pf("28"), pf("29"), pf("30")))}
            ${D.f("cR", "pa.r + pb.r * cos(6.283185307179586 * (pc.r * tClass + pd.r))")}
            ${D.f("cG", "pa.g + pb.g * cos(6.283185307179586 * (pc.g * tClass + pd.g))")}
            ${D.f("cB", "pa.b + pb.b * cos(6.283185307179586 * (pc.b * tClass + pd.b))")}
            ${D.f(
              "kCol",
              D.sel(
                D.sel("1.0", "0.5", "fat > 0.5"),
                D.sel(D.sel("1.0", "0.7", "fat > 0.5"), "1.0", "rule < 2.5"),
                "rule < 1.5",
              ),
            )}
            ${D.f("tone", `${D.sel("1.0", "0.45", "fat > 0.5")} * alt`)}
            ${D.v3(
              "albedoSel",
              D.selV(
                `${D.groundAlbedo} * tone`,
                `clamp(${v3("cR", "cG", "cB")}, ${v3("0.0", "0.0", "0.0")}, ${v3("1.0", "1.0", "1.0")}) * kCol`,
                "rule < 0.5",
              ),
            )}
            ${D.v3("albedo", "albedoSel")}
            ${D.f("eAlb", `${PENTAGRID_EDGE_ALBEDO}`)}
            ${D.v3(
              "outA",
              v3(
                "eAlb + (albedo.r - eAlb) * (1.0 - edgeCov)",
                "eAlb + (albedo.g - eAlb) * (1.0 - edgeCov)",
                "eAlb + (albedo.b - eAlb) * (1.0 - edgeCov)",
              ),
            )}
            return outA;
          }
        }
      }
    }
  }
  return ${D.groundAlbedo};
}
`;
}
