import {
  DEFAULT_FLOOR_PENTAGRID,
  PENTAGRID_EDGE_ALBEDO,
  PENTAGRID_FLOOR_GLSL,
  PENTAGRID_FLOOR_WGSL,
  PENTAGRID_UNIFORM_FLOATS,
  pentagridDerived,
  pentagridFaceAt,
  pentagridFaces,
  pentagridFloorAlbedoSource,
  pentagridFloorTone,
  packFloorPentagridUniforms,
  resolveFloorPentagrid,
  iqPaletteColor,
} from "./pentagrid-floor";

/** The four parameter sets the design sheet certified: base phason, the
 * other shift vector, the small phason nudge, and the 36° rotation. */
const CERT_SPECS: readonly {
  name: string;
  shifts: [number, number, number, number, number];
  rotationDeg: number;
}[] = [
  { name: "base", shifts: [0.13, 0.62, 0.35, 0.81, 0.47], rotationDeg: 0 },
  { name: "phason B", shifts: [0.55, 0.08, 0.77, 0.3, 0.91], rotationDeg: 0 },
  { name: "nudge", shifts: [0.13, 0.62, 0.52, 0.81, 0.47], rotationDeg: 0 },
  { name: "rot 36", shifts: [0.13, 0.62, 0.35, 0.81, 0.47], rotationDeg: 36 },
];

const EXTENT = 3.4;
const SAMPLES = 160;

describe("pentagrid floor", () => {
  describe("resolveFloorPentagrid", () => {
    it("fills absent fields with the defaults", () => {
      expect(resolveFloorPentagrid(undefined)).toEqual({
        shifts: DEFAULT_FLOOR_PENTAGRID.shifts,
        rotationDeg: 0,
        colorRule: "grey",
        palette: "sunset",
        grout: 1,
      });
      expect(resolveFloorPentagrid({})).toEqual(
        resolveFloorPentagrid(undefined),
      );
    });

    it("wraps shifts and rotation into their cyclic domains", () => {
      const r = resolveFloorPentagrid({
        shifts: [1.25, -0.3, 0, 2, -1],
        rotationDeg: 80,
      });
      expect(r.shifts).toEqual([0.25, 0.7, 0, 0, 0]);
      expect(r.rotationDeg).toBe(8);
    });

    it("resolves a resolved block to itself — the resolution chain re-resolves", () => {
      // An in-domain value returns UNCHANGED: the wrap's add-and-subtract
      // is not a floating-point identity, and the spec/key chain re-resolves
      // resolved blocks, so idempotence is what keeps "resolved" a fixed
      // point.
      const once = resolveFloorPentagrid(undefined);
      expect(resolveFloorPentagrid(once)).toEqual(once);
      const authored = resolveFloorPentagrid({
        shifts: [0.13, 0.62, 0.35, 0.81, 0.47],
        rotationDeg: 36.5,
        grout: 2,
      });
      expect(resolveFloorPentagrid(authored)).toEqual(authored);
    });

    it("falls back on unknown rule or palette ids and clamps grout", () => {
      const r = resolveFloorPentagrid({
        colorRule: "plaid" as never,
        palette: "camo" as never,
        grout: 99,
      });
      expect(r.colorRule).toBe("grey");
      expect(r.palette).toBe("sunset");
      expect(r.grout).toBe(8);
    });

    it("does not mutate or retain the input", () => {
      const input = { grout: 3 } as const;
      const r = resolveFloorPentagrid(input);
      // Mutating the result's own (fresh) shifts must not touch the input —
      // the resolver rebuilds every array rather than aliasing it.
      (r.shifts as unknown as number[])[0] = 0.5;
      expect(input).toEqual({ grout: 3 });
      expect(r.shifts[0]).toBe(0.5);
    });
  });

  describe("pentagridDerived", () => {
    it("scales with ball radius times tile scale, floored at 1e-4", () => {
      expect(pentagridDerived(DEFAULT_FLOOR_PENTAGRID, 2, 0.5).scale).toBe(1);
      expect(pentagridDerived(DEFAULT_FLOOR_PENTAGRID, 1, 0).scale).toBe(1e-4);
    });

    it("seeds the offset at scale times the shift-weighted normals", () => {
      const d = pentagridDerived(DEFAULT_FLOOR_PENTAGRID, 1, 1);
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < 5; i++) {
        sx += d.shifts[i] * d.normals[i][0];
        sy += d.shifts[i] * d.normals[i][1];
      }
      expect(d.seedOffset[0]).toBeCloseTo(sx, 12);
      expect(d.seedOffset[1]).toBeCloseTo(sy, 12);
    });

    it("rotates the normals with the authored rotation", () => {
      const d = pentagridDerived(
        { ...DEFAULT_FLOOR_PENTAGRID, rotationDeg: 36 },
        1,
        1,
      );
      expect(d.normals[0][0]).toBeCloseTo(Math.cos(Math.PI / 5), 12);
      expect(d.normals[0][1]).toBeCloseTo(Math.sin(Math.PI / 5), 12);
    });
  });

  describe("CERTIFICATION: per-pixel search vs the polygon oracle", () => {
    it.each(CERT_SPECS.map((s) => [s.name, s] as const))(
      "%s: every sampled point's face matches the polygon pipeline exactly",
      (_name, spec) => {
        const block = {
          ...DEFAULT_FLOOR_PENTAGRID,
          shifts: spec.shifts,
          rotationDeg: spec.rotationDeg,
        };
        const d = pentagridDerived(block, 1, 1);
        // Margin 3.0 matches the certified sheet: corner faces sit up to
        // ~2·scale past the view edge, and a tight cull would drop them.
        const faces = pentagridFaces(d, EXTENT, 3.0);
        expect(faces.length).toBeGreaterThan(50);
        let mismatch = 0;
        let miss = 0;
        for (let py = 0; py < SAMPLES; py++) {
          for (let px = 0; px < SAMPLES; px++) {
            const x = ((px + 0.5) / SAMPLES) * 2 * EXTENT - EXTENT;
            const z = EXTENT - ((py + 0.5) / SAMPLES) * 2 * EXTENT;
            const found = pentagridFaceAt(d, x, z);
            let oracle: (typeof faces)[number] | null = null;
            for (const f of faces) {
              const pts: [number, number][] = [
                [f.px, f.py],
                [
                  f.px + d.normals[f.i][0] * d.scale,
                  f.py + d.normals[f.i][1] * d.scale,
                ],
                [
                  f.px + (d.normals[f.i][0] + d.normals[f.j][0]) * d.scale,
                  f.py + (d.normals[f.i][1] + d.normals[f.j][1]) * d.scale,
                ],
                [
                  f.px + d.normals[f.j][0] * d.scale,
                  f.py + d.normals[f.j][1] * d.scale,
                ],
              ];
              let sign = 0;
              let inside = true;
              for (let k = 0; k < 4; k++) {
                const a = pts[k];
                const b = pts[(k + 1) % 4];
                const cr =
                  (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
                if (cr !== 0) {
                  const sg = cr > 0 ? 1 : -1;
                  if (sign === 0) sign = sg;
                  else if (sg !== sign) {
                    inside = false;
                    break;
                  }
                }
              }
              if (inside) {
                oracle = f;
                break;
              }
            }
            if (!oracle) {
              // A sample point the oracle misses must be a per-pixel miss too
              // (and vice versa) — neither may invent a face.
              if (found) {
                console.log(
                  `DBG ${spec.name} ORACLE-NULL at ${x.toFixed(4)},${z.toFixed(4)}`,
                );
                miss++;
              }
              continue;
            }
            if (!found) {
              if (miss < 3) {
                console.log(
                  `DBG ${spec.name} PIXEL-NULL at ${x.toFixed(4)},${z.toFixed(4)} oracle i=${oracle.i} j=${oracle.j} m0=${oracle.m0.join(",")}`,
                );
              }
              miss++;
              continue;
            }
            const same =
              found.i === oracle.i &&
              found.j === oracle.j &&
              found.m0.every((v, l) => v === oracle.m0[l]);
            if (!same && mismatch < 3) {
              console.log(
                `DBG ${spec.name} MISMATCH at ${x.toFixed(4)},${z.toFixed(4)}` +
                  ` pixel i=${found.i} j=${found.j} m0=${found.m0.join(",")}` +
                  ` | oracle i=${oracle.i} j=${oracle.j} m0=${oracle.m0.join(",")}`,
              );
            }
            if (!same) mismatch++;
          }
        }
        expect(miss).toBe(0);
        expect(mismatch).toBe(0);
      },
    );
  });

  describe("pentagridFloorTone", () => {
    const d = pentagridDerived(DEFAULT_FLOOR_PENTAGRID, 1, 1);

    it("grey rule returns the neutral albedo scaled by the class tone", () => {
      // Find a fat face and probe its interior.
      const f = pentagridFaceAt(d, 0.21, 0.13);
      expect(f).not.toBeNull();
      const tone = pentagridFloorTone(d, "grey", 1, 0.21, 0.13, 0.01);
      const sum = f!.m0.reduce((a, b) => a + b, 0);
      const dist = (f!.j - f!.i + 5) % 5;
      const fat = dist === 1 || dist === 4;
      const alt = ((sum % 2) + 2) % 2 === 0 ? 1 : 0.9;
      const expectTone = (fat ? 1 : 0.45) * alt;
      // Well inside the tile (grout is ~0.012 wide at 0.01 footprint with
      // height ~0.95, so an interior point's edge coverage is 0).
      const interior = pentagridFaceAt(d, 0.21, 0.13)!;
      const height =
        Math.abs(
          d.normals[interior.i][0] * d.normals[interior.j][1] -
            d.normals[interior.i][1] * d.normals[interior.j][0],
        ) * d.scale;
      const edgeDist =
        Math.min(interior.tI, 1 - interior.tI, interior.tJ, 1 - interior.tJ) *
        height;
      if (edgeDist > 0.05) {
        expect(tone[0]).toBeCloseTo(0.62 * expectTone, 5);
      }
    });

    it("colored rules replace the albedo with the palette color", () => {
      const block = {
        ...DEFAULT_FLOOR_PENTAGRID,
        colorRule: "height" as const,
        palette: "marine" as const,
      };
      const dd = pentagridDerived(block, 1, 1);
      const f = pentagridFaceAt(dd, 0.21, 0.13)!;
      const height =
        Math.abs(
          dd.normals[f.i][0] * dd.normals[f.j][1] -
            dd.normals[f.i][1] * dd.normals[f.j][0],
        ) * dd.scale;
      const edgeDist = Math.min(f.tI, 1 - f.tI, f.tJ, 1 - f.tJ) * height;
      if (edgeDist < 0.05) return; // probe point near a grout line; skip
      const sum = f.m0.reduce((a, b) => a + b, 0);
      const hclass = ((sum % 5) + 5) % 5;
      const dist = (f.j - f.i + 5) % 5;
      const fat = dist === 1 || dist === 4;
      const c = iqPaletteColor(dd.paletteCoeffs, hclass / 5);
      const k = fat ? 1 : 0.7;
      const tone = pentagridFloorTone(dd, "height", 1, 0.21, 0.13, 0.01);
      expect(tone[0]).toBeCloseTo(c[0] * k, 5);
      expect(tone[1]).toBeCloseTo(c[1] * k, 5);
      expect(tone[2]).toBeCloseTo(c[2] * k, 5);
    });

    it("darkens toward the fixed edge albedo near a tile boundary", () => {
      // Walk from a tile interior toward its tI=0 edge and watch the tone
      // drop toward PENTAGRID_EDGE_ALBEDO.
      const f = pentagridFaceAt(d, 0.21, 0.13)!;
      const height =
        Math.abs(
          d.normals[f.i][0] * d.normals[f.j][1] -
            d.normals[f.i][1] * d.normals[f.j][0],
        ) * d.scale;
      const vix = d.normals[f.i][0] * d.scale;
      const viy = d.normals[f.i][1] * d.scale;
      const vjx = d.normals[f.j][0] * d.scale;
      const vjy = d.normals[f.j][1] * d.scale;
      let px = 0;
      let py = 0;
      for (let l = 0; l < 5; l++) {
        px += f.m0[l] * d.normals[l][0] * d.scale;
        py += f.m0[l] * d.normals[l][1] * d.scale;
      }
      // Interior point at (tI, tJ) = (0.5, 0.5): p = pi + 0.5vi + 0.5vj
      const midX = px + 0.5 * vix + 0.5 * vjx;
      const midZ = py + 0.5 * viy + 0.5 * vjy;
      const nearEdgeX = px + 0.002 * vix + 0.5 * vjx;
      const nearEdgeZ = py + 0.002 * viy + 0.5 * vjy;
      const mid = pentagridFloorTone(d, "grey", 1, midX, midZ, 0.01);
      const near = pentagridFloorTone(d, "grey", 1, nearEdgeX, nearEdgeZ, 0.01);
      expect(near[0]).toBeLessThan(mid[0]);
      const edgeDist = 0.002 * height;
      const aa = 0.01 * 1.2;
      const t = (0.3 * aa + aa - edgeDist) / (2 * aa);
      const c = Math.min(1, Math.max(0, t));
      const cov = c * c * (3 - 2 * c);
      expect(near[0]).toBeCloseTo(
        PENTAGRID_EDGE_ALBEDO + (mid[0] - PENTAGRID_EDGE_ALBEDO) * (1 - cov),
        3,
      );
    });

    it("keeps tiling — and valid albedo — far outside the fade band", () => {
      // The tiling covers the whole plane: a far point still finds a face
      // and returns a finite in-range albedo (the caller fades it out).
      const tone = pentagridFloorTone(d, "grey", 1, 1e4, -1e4, 0.01);
      for (const ch of tone) {
        expect(Number.isFinite(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(0.62);
      }
    });
  });

  /** Normalize one dialect's emitted body onto the shared character stream:
   * declaration spellings collapse (names kept), casts and dialect accessors
   * unify, the helper definitions are dropped (dialect boilerplate), and the
   * per-dialect signature line is dropped. */
  function canon(src: string): string {
    const body = src.slice(src.indexOf("floorPentagridAlbedo("));
    return (
      body
        .split("\n")
        .slice(1) // the signature line
        .join("\n")
        .replace(/float (\w+) = /g, "let $1: f32 = ")
        .replace(/vec2 (\w+) = /g, "let $1: vec2f = ")
        .replace(/vec3 (\w+) = /g, "let $1: vec3f = ")
        // The WGSL dialect's MUTABLE scalar spellings normalize to `let` too.
        .replace(/var (\w+): f32 = /g, "let $1: f32 = ")
        .replace(/float (\w+)\[(\d+)\];/g, "var $1: ARR[$2];")
        .replace(/var (\w+): array<f32, (\d+)>;/g, "var $1: ARR[$2];")
        .replace(/for \(int (\w+) = 0/g, "for (var $1: IDX = 0")
        .replace(/for \(var (\w+): i32 = 0/g, "for (var $1: IDX = 0")
        .replace(/float\(/g, "F(")
        .replace(/f32\(/g, "F(")
        .replace(/vec2\(/g, "V2(")
        .replace(/vec2f\(/g, "V2(")
        .replace(/vec3\(/g, "V3(")
        .replace(/vec3f\(/g, "V3(")
        .replace(/uPentagridData\[/g, "PF[")
        // The WGSL tail's vec4-row form (word k = member[k/4][k%4], the
        // uniform address space's 16-byte stride rule) normalizes to the
        // scalar read.
        .replace(
          /shade\.floorPentagrid\[\((.*?)\) \/ 4\]\[\(\1\) % 4\]/g,
          "PF[$1]",
        )
        .replace(/uGroundAlbedo/g, "GA")
        .replace(/params\.groundAlbedo/g, "GA")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  describe("pentagridFloorAlbedoSource", () => {
    it("emits the ONE body in both dialects — equal once dialect tokens are normalized", () => {
      const glsl = pentagridFloorAlbedoSource(PENTAGRID_FLOOR_GLSL);
      const wgsl = pentagridFloorAlbedoSource(PENTAGRID_FLOOR_WGSL);
      expect(glsl).toContain("floorPentagridAlbedo(vec2 rel, float px)");
      expect(wgsl).toContain(
        "fn floorPentagridAlbedo(rel: vec2f, px: f32) -> vec3f",
      );
      // WGSL has no ternary: its text must spell every pick as select().
      const wgslBody = wgsl.slice(wgsl.indexOf("{"));
      expect(wgslBody).not.toContain(" ? ");
      expect(wgslBody).toContain("select(");
      expect(canon(glsl)).toBe(canon(wgsl));
    });

    it("mirrors the TS reference term for term on the geometry it can share", () => {
      // Spot-pin the emitted constants against the reference module's own.
      const glsl = pentagridFloorAlbedoSource(PENTAGRID_FLOOR_GLSL);
      expect(glsl).toContain(`${PENTAGRID_EDGE_ALBEDO}`);
      expect(glsl).toContain("* 0.4"); // the c* seed
      expect(glsl).toContain("px * 1.2 *"); // the grout width
    });
  });

  describe("packFloorPentagridUniforms", () => {
    it("packs the documented 32-float layout (f32 words)", () => {
      const block = { ...DEFAULT_FLOOR_PENTAGRID, colorRule: "pair" as const };
      const d = pentagridDerived(block, 2, 0.5);
      const u = packFloorPentagridUniforms(d, block);
      expect(u).toHaveLength(PENTAGRID_UNIFORM_FLOATS);
      // The wire is f32: compare against fround of the f64 derived values.
      expect(u[0]).toBe(Math.fround(d.seedOffset[0]));
      expect(u[1]).toBe(Math.fround(d.seedOffset[1]));
      expect(u[2]).toBe(Math.fround(d.scale));
      for (let i = 0; i < 5; i++) {
        expect(u[3 + i * 2]).toBe(Math.fround(d.normals[i][0]));
        expect(u[4 + i * 2]).toBe(Math.fround(d.normals[i][1]));
      }
      for (let i = 0; i < 5; i++)
        expect(u[13 + i]).toBe(Math.fround(block.shifts[i]));
      expect(u[18]).toBe(3); // pair
      for (let k = 0; k < 4; k++) {
        for (let ch = 0; ch < 3; ch++) {
          expect(u[19 + k * 3 + ch]).toBe(Math.fround(d.paletteCoeffs[k][ch]));
        }
      }
      expect(u[31]).toBe(Math.fround(block.grout));
    });
  });
});
