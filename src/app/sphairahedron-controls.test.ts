import {
  resolveSphairahedron,
  SPHAIRAHEDRON_FAMILIES,
  type SphairahedronAuthored,
} from "../fractal/sphairahedron";
import {
  defaultSphairahedronBlock,
  sphairahedronControlNotes,
  sphairahedronFamilyValue,
  sphairahedronFieldRange,
  sphairahedronIsFinite,
  sphairahedronVisibleRows,
  withSphairahedronFamily,
  withSphairahedronField,
  withSphairahedronFinite,
  SPHAIRAHEDRON_AUTHORED_OPTION,
} from "./sphairahedron-controls";
import { pickSphairahedronInversion } from "./sphairahedron-authoring";

describe("sphairahedron-controls: the region-scoped moduli spans", () => {
  const CUBE_ZB = [0.1, 0.3, 0.5, 0.8, 1.0, 1.2];
  const CUBE_ZA = [0.05, 0.2, 0.4, 0.6, 0.75];

  // The resolver stays the oracle: every lattice point strictly inside the
  // slider's span must resolve. Fixed moduli past the region admit nothing
  // (the span is the fallback's) and are skipped — the span's fallback is
  // an authoring aid there, not a promise.
  for (const family of ["cube1", "cube4", "cube9"] as const) {
    it(`${family}: the za span's interior is the resolver's region (grid-pinned)`, () => {
      for (const zb of CUBE_ZB) {
        const block: SphairahedronAuthored = { family, zb };
        if (!resolveSphairahedron({ family, za: 0.01, zb }).ok) continue;
        const range = sphairahedronFieldRange(block, "za");
        if (!Number.isFinite(range.max)) continue;
        for (
          let za = range.min;
          za <= range.max;
          za += (range.max - range.min) / 12
        ) {
          const resolution = resolveSphairahedron({ family, za, zb });
          expect(
            resolution.ok,
            `${family} za=${za.toFixed(3)} zb=${zb.toFixed(2)}`,
          ).toBe(true);
        }
      }
    });

    it(`${family}: the zb span's interior is the resolver's region (grid-pinned)`, () => {
      for (const za of CUBE_ZA) {
        const block: SphairahedronAuthored = { family, za };
        if (!resolveSphairahedron({ family, za, zb: 0.01 }).ok) continue;
        const range = sphairahedronFieldRange(block, "zb");
        if (!Number.isFinite(range.max)) continue;
        for (
          let zb = range.min;
          zb <= range.max;
          zb += (range.max - range.min) / 12
        ) {
          const resolution = resolveSphairahedron({ family, za, zb });
          expect(
            resolution.ok,
            `${family} za=${za.toFixed(2)} zb=${zb.toFixed(3)}`,
          ).toBe(true);
        }
      }
    });
  }

  it("scopes the span tighter than the quadrant (the region, not the box)", () => {
    // cube1 at zb = 1.0 admits za only up to ~0.75, not 2.
    const range = sphairahedronFieldRange({ family: "cube1", zb: 1.0 }, "za");
    expect(range.min).toBeCloseTo(0.25, 2);
    expect(range.max).toBeCloseTo(0.75, 2);
  });

  it("falls back to the default's interval when the fixed modulus admits nothing", () => {
    // zb = 1.3 is past cube1's region for every za: the za span falls
    // back to the interval at the family default (zb = 1.0).
    const range = sphairahedronFieldRange({ family: "cube1", zb: 1.3 }, "za");
    expect(range.min).toBeLessThan(range.max);
  });

  it("gives the prism's z2 the open region's span and the tetra rows nothing", () => {
    const z2 = sphairahedronFieldRange({ family: "prism2" }, "z2");
    expect(z2.min).toBeCloseTo(-Math.sqrt(6), 3);
    expect(z2.max).toBeCloseTo(Math.sqrt(6), 3);
  });
});

describe("sphairahedron-controls: the write rules", () => {
  it("writes one field verbatim; the moduli never clamp to the span", () => {
    const block: SphairahedronAuthored = { family: "cube1", za: 0.5 };
    const out = withSphairahedronField(block, "za", 0.9);
    expect(out.za).toBe(0.9);
    // An inversion component authors the sphere object on the first move.
    const sphere = withSphairahedronField(block, "inversion.cx", 0.25);
    expect(sphere.inversion).toEqual({ cx: 0.25 });
    const finished = withSphairahedronField(sphere, "inversion.r", 0.8);
    expect(finished.inversion).toEqual({ cx: 0.25, r: 0.8 });
  });

  it("keeps unread moduli across a family switch and drops a 4D-only w on the way back", () => {
    const block: SphairahedronAuthored = {
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      z2: 1.5,
      inversion: { cx: 0.1, cy: 0, cz: 0, cw: 0.3, r: 1 },
    };
    const to4 = withSphairahedronFamily(block, "tetra4");
    expect(to4.family).toBe("tetra4");
    expect(to4.za).toBe(0.5);
    expect(to4.inversion?.cw).toBe(0.3);
    const back3 = withSphairahedronFamily(to4, "cube1");
    expect(back3.inversion?.cw).toBeUndefined();
    expect(back3.inversion?.cx).toBe(0.1);
    // An unknown id and the current family are no-ops.
    expect(withSphairahedronFamily(block, "cube99")).toBe(block);
    expect(withSphairahedronFamily(block, "cube1")).toBe(block);
  });

  it("authors the inversion sphere through the picker and removes it for infinite", () => {
    const block: SphairahedronAuthored = { family: "cube1", za: 0.5, zb: 1.0 };
    const finite = withSphairahedronFinite(block, true);
    expect(sphairahedronIsFinite(finite)).toBe(true);
    expect(typeof finite.inversion?.r).toBe("number");
    const infinite = withSphairahedronFinite(finite, false);
    expect(infinite).toEqual(block);
  });

  it("seeds the enable gesture with a FINITE canonical cube (the picker's sphere authored)", () => {
    const block = defaultSphairahedronBlock();
    expect(block.family).toBe("cube1");
    expect(sphairahedronIsFinite(block)).toBe(true);
    const resolution = resolveSphairahedron(block);
    expect(resolution.ok).toBe(true);
  });
});

describe("sphairahedron-controls: rows and notes", () => {
  it("shows the family's own modulus rows and the 4D family's w row", () => {
    expect(sphairahedronVisibleRows({ family: "cube1" })).toEqual({
      za: true,
      zb: true,
      z2: false,
      cw: false,
    });
    expect(sphairahedronVisibleRows({ family: "prism2" })).toEqual({
      za: false,
      zb: false,
      z2: true,
      cw: false,
    });
    expect(sphairahedronVisibleRows({ family: "tetra4" })).toEqual({
      za: false,
      zb: false,
      z2: false,
      cw: true,
    });
  });

  it("shows the authored-option select value for an unknown family and maps refusals to rows", () => {
    expect(sphairahedronFamilyValue({ family: "cube9" })).toBe("cube9");
    expect(sphairahedronFamilyValue({ family: "cube99" })).toBe(
      SPHAIRAHEDRON_AUTHORED_OPTION,
    );
    const notes = sphairahedronControlNotes({ family: "cube99" });
    expect(notes.family).toMatch(/^Refused: unknown family/);
    expect(notes.family).toMatch(/Choose a family/);
  });

  it("maps the region refusal to the modulus row and a finite sphere's absence to the finite row", () => {
    const region = sphairahedronControlNotes({
      family: "cube1",
      za: 0.9,
      zb: 1.2,
    });
    expect(region.za).toMatch(/^Refused: ball /);
    const finite = sphairahedronControlNotes({
      family: "cube1",
      inversion: {},
    });
    expect(finite.finite).toMatch(/^Refused: a finite construction needs/);
  });

  it("discloses an authored value outside its slider's span as kept", () => {
    const notes = sphairahedronControlNotes({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      inversion: { cx: 0.1, cy: 0, cz: 0, r: 9 },
    });
    expect(notes["inversion.r"]).toMatch(/outside this slider's range/);
    expect(notes["inversion.r"]).toMatch(/kept as authored/);
  });

  it("offers every shipped family id to the select", () => {
    // The panel's <option> list is index.html's; this pins that every
    // shipped id is selectable vocabulary (the resolver's own union).
    expect(SPHAIRAHEDRON_FAMILIES).toContain("tetra4");
    expect(SPHAIRAHEDRON_FAMILIES).toContain("prism2");
  });
});

describe("sphairahedron-authoring: the deterministic picker", () => {
  it("is deterministic and its sphere resolves into a finite construction", () => {
    const block: SphairahedronAuthored = { family: "cube1", za: 0.5, zb: 1.0 };
    const resolution = resolveSphairahedron(block);
    if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
    const a = pickSphairahedronInversion(resolution.construction);
    const b = pickSphairahedronInversion(resolution.construction);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    const finite = resolveSphairahedron({
      ...block,
      inversion: {
        cx: a!.c[0],
        cy: a!.c[1],
        cz: a!.c[2],
        r: a!.r,
      },
    });
    expect(finite.ok).toBe(true);
  });

  it("rescues cube9 at (0.3, 0.2), whose reflected reference collapses the image construction", () => {
    const block: SphairahedronAuthored = { family: "cube9", za: 0.3, zb: 0.2 };
    const resolution = resolveSphairahedron(block);
    if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
    const picked = pickSphairahedronInversion(resolution.construction);
    expect(picked).not.toBeNull();
    const finite = resolveSphairahedron({
      ...block,
      inversion: {
        cx: picked!.c[0],
        cy: picked!.c[1],
        cz: picked!.c[2],
        r: picked!.r,
      },
    });
    expect(finite.ok).toBe(true);
  });
});
