/**
 * THE LOOK GATE FOR THE GENERAL CURVED SOLID: dielectric glass on an
 * ordinary IFS of curved emitter shapes, the condensation set over a finite
 * depth band, rendered on the CPU before any kernel, wire or panel work.
 *
 * The sphere-inversion arm proved curved glass on one family's seed orbit,
 * and the owner chose that look. This sheet asks the same question of the
 * WIDER subject the epic names next: any IFS whose maps stamp recursively
 * smaller copies of a curved emitter shape (a sphere, a torus, the shipped
 * gear). The closed-solid backend admits only the root of such a set (C0),
 * because its field "describes only the root term". The field these panels
 * trace is the whole band's, `condensation-solid.ts`'s signed union over the
 * word tree, whose sign is exact and whose search is a branch-and-bound
 * against one invariant ball.
 *
 * WHAT THE PANELS ARE. `glass-preview.ts`'s renderer: the primary march on
 * the field, then every hit through `surface-dielectric.ts`'s
 * `dielectricTrace` (the ONE transport oracle) over the closed-solid
 * boundary query's f64 twin, membership-gated by the module's exact
 * `condensationSolidContains3`. Opaque controls share the pose and studio.
 *
 * THE 4D HALF is not rendered, by argument rather than by omission. A 4D
 * emitter is a 3D solid embedded at local `w = 0`. A 3D slice meets such a
 * flat piece in zero volume unless the flat lies in the slice, so the only
 * 4D pose that holds a glass solid is the canonical one (w-untouched maps,
 * every flat in the displayed hyperplane), and there the slice IS the 3D
 * solid of the document's restriction: these panels, exactly.
 *
 * WHAT IT IS NOT: not a performance claim (a CPU sheet prices nothing a
 * kernel will pay), not the kernel's census, and not an admission decision.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/condensation-glass.harness.ts
 * Writes: `scripts/out/condensation-glass*.png`
 */
import { writeLabeledContactSheet, type PanelStats } from "./de-preview";
import {
  glassPanel,
  report,
  type GlassOptions,
  type OpticalSolid,
  type PanelView,
} from "./glass-preview";
import {
  buildCondensationSolid3,
  condensationSolidContains3,
  condensationSolidSignedDistance3,
  type CondensationSolid3,
} from "../src/fractal/condensation-solid";
import { gearworks, sierpinskiTetrahedron } from "../src/fractal/presets";
import { ORBIT_RING_SHAPE, type ShapeSpec } from "../src/fractal/shapes";
import { buildSurfaceDE } from "../src/fractal/surface-de";
import type { Transform } from "../src/fractal/types";

const SIZE = Number(process.env.CGL_SIZE ?? 160);

const VIEW: PanelView = {
  eye: [1.9, 1.1, 2.5],
  target: [0, -0.05, 0],
  zoom: 0.42,
};

const BEAD: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
};

/** The Sierpinski tetrahedron's four corner maps stamping a centred shape:
 * the root bead fills the middle, each level fills the four sub-cells. */
function stamped(shape: ShapeSpec, scale: number): Transform[] {
  return [
    ...sierpinskiTetrahedron(),
    {
      id: 4,
      position: [0, 0, 0],
      rotation: [0.5, 0.3, 0.2],
      scale: [scale, scale, scale],
      weight: 1.4,
      emitter: shape,
    },
  ];
}

interface Subject {
  label: string;
  transforms: Transform[];
  maxDepth: number;
}

function solidOf(subject: Subject): CondensationSolid3 {
  return buildCondensationSolid3(
    buildSurfaceDE(subject.transforms, null, undefined, {
      condensationDepthBand: { maxDepth: subject.maxDepth },
    }),
    // The gear panel is the emitter rule's own evidence: a conservative
    // shape, built as an instrument the router refuses.
    { admitConservativeShapes: true },
  );
}

/** The module's field and membership as the renderer's solid, tallying the
 * word search's cost per field evaluation. */
function optical(
  solid: CondensationSolid3,
  tally: { evals: number; nodes: number; terms: number },
): OpticalSolid {
  return {
    field: (p) => {
      tally.evals++;
      return condensationSolidSignedDistance3(solid, p, tally);
    },
    contains: (p) => condensationSolidContains3(solid, p),
    normal: () => null,
  };
}

function render(
  subject: Subject,
  mode: "glass" | "opaque",
  options: GlassOptions = {},
): { stats: PanelStats; lines: [string, string] } {
  const solid = solidOf(subject);
  const tally = { evals: 0, nodes: 0, terms: 0 };
  const { stats, counters } = glassPanel(
    optical(solid, tally),
    solid.radius,
    VIEW,
    mode,
    SIZE,
    options,
  );
  report(`${subject.label} ${mode}`, stats, counters);
  console.log(
    `    word search: ${(tally.nodes / Math.max(1, tally.evals)).toFixed(1)} nodes, ${(tally.terms / Math.max(1, tally.evals)).toFixed(1)} terms per field evaluation (${tally.evals} evaluations; full tree ${fullTree(solid)} nodes)`,
  );
  const resolved =
    counters.traces > 0
      ? `${((100 * (counters.complete + counters.residual)) / counters.traces).toFixed(0)}% resolved`
      : "opaque";
  return { stats, lines: [`${subject.label} ${mode}`, resolved] };
}

function fullTree(solid: CondensationSolid3): number {
  let n = 0;
  for (let d = 0; d <= solid.band.maxDepth; d++) n += solid.maps.length ** d;
  return n;
}

describe("condensation glass (the general curved solid's look gate)", () => {
  it("renders glass beads, rings and gears beside their opaque controls", () => {
    const subjects: Subject[] = [
      { label: "beads D2", transforms: stamped(BEAD, 0.28), maxDepth: 2 },
      {
        label: "rings D2",
        transforms: stamped(ORBIT_RING_SHAPE, 0.36),
        maxDepth: 2,
      },
      { label: "gearworks D2", transforms: gearworks(), maxDepth: 2 },
    ];
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    console.log("\nSubjects (glass through the transport oracle):");
    for (const subject of subjects) {
      panels.push(render(subject, "opaque"), render(subject, "glass"));
    }
    console.log(
      `  wrote ${writeLabeledContactSheet(panels, 2, "condensation-glass.png")}`,
    );
  });

  it("sweeps the depth band's ceiling on the glass beads", () => {
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    console.log("\nDepth sweep (beads, glass):");
    for (const maxDepth of [0, 1, 2, 3]) {
      panels.push(
        render(
          {
            label: `beads D${maxDepth}`,
            transforms: stamped(BEAD, 0.28),
            maxDepth,
          },
          "glass",
        ),
      );
    }
    console.log(
      `  wrote ${writeLabeledContactSheet(panels, 2, "condensation-glass-depth.png")}`,
    );
  });
});
