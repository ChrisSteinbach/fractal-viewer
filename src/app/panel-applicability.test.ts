import { RENDER_MODES } from "./state";
import {
  BALLOON_CENTRE_REFUSAL_REASON,
  matchesPanelConsumers,
  resolvePanelApplicability,
  type PanelContext,
  type PanelDimension,
  type SurfaceSessionKind,
} from "./panel-applicability";

const context = (
  renderMode: PanelContext["renderMode"],
  surfaceKind: SurfaceSessionKind | null,
  dimension: PanelDimension = "flat",
): PanelContext => ({ renderMode, dimension, surfaceKind });

describe("panel consumer matching", () => {
  it("ORs clauses and ANDs fields within a clause", () => {
    const consumers = [
      { renderModes: ["points"], dimensions: ["flat"] },
      { renderModes: ["surface"], surfaceKinds: ["escape"] },
    ] as const;

    expect(matchesPanelConsumers(context("points", null), consumers)).toBe(
      true,
    );
    expect(
      matchesPanelConsumers(context("points", null, "nonFlat"), consumers),
    ).toBe(false);
    expect(matchesPanelConsumers(context("surface", "escape"), consumers)).toBe(
      true,
    );
    expect(matchesPanelConsumers(context("surface", "ifs"), consumers)).toBe(
      false,
    );
  });

  it("treats omitted axes as wildcards", () => {
    const consumers = [{ renderModes: ["surface"] }] as const;
    for (const dimension of ["flat", "nonFlat"] as const) {
      for (const kind of [null, "ifs", "escape", "bulb"] as const) {
        expect(
          matchesPanelConsumers(context("surface", kind, dimension), consumers),
        ).toBe(true);
      }
    }
  });

  it("treats explicit null as pre-routing, not a wildcard", () => {
    const consumers = [{ surfaceKinds: [null] }] as const;
    expect(matchesPanelConsumers(context("surface", null), consumers)).toBe(
      true,
    );
    expect(matchesPanelConsumers(context("surface", "ifs"), consumers)).toBe(
      false,
    );
  });

  it("matches the dimension axis independently", () => {
    const consumers = [{ dimensions: ["nonFlat"] }] as const;
    expect(
      matchesPanelConsumers(context("points", null, "nonFlat"), consumers),
    ).toBe(true);
    expect(matchesPanelConsumers(context("points", null), consumers)).toBe(
      false,
    );
  });
});

describe("panel applicability registry", () => {
  it.each(["flat", "nonFlat"] as const)(
    "enables the Surface inspector only in Surface for %s systems",
    (dimension) => {
      for (const kind of [null, "ifs", "escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability(
            "surfaceInspector",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: "enabled" });
      }
      expect(
        resolvePanelApplicability(
          "surfaceInspector",
          context("points", null, dimension),
        ),
      ).toEqual({ kind: "hidden" });
    },
  );

  it("keeps Balloon enabled outside Surface regardless of stale session state", () => {
    for (const renderMode of RENDER_MODES.filter(
      (mode) => mode !== "surface",
    )) {
      for (const kind of [null, "ifs", "escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability("balloon", context(renderMode, kind)),
        ).toEqual({ kind: "enabled" });
      }
    }
  });

  it.each(["flat", "nonFlat"] as const)(
    "enables Balloon before routing and for IFS, then refuses both forward-orbit kinds in %s",
    (dimension) => {
      for (const kind of [null, "ifs"] as const) {
        expect(
          resolvePanelApplicability(
            "balloon",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: "enabled" });
      }
      for (const kind of ["escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability(
            "balloon",
            context("surface", kind, dimension),
          ),
        ).toEqual({
          kind: "disabled",
          reason: BALLOON_CENTRE_REFUSAL_REASON,
        });
      }
    },
  );

  it.each(["flat", "nonFlat"] as const)(
    "enables traps for Surface forward-orbit sessions in %s",
    (dimension) => {
      for (const kind of ["escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability(
            "surfaceTrap",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: "enabled" });
      }
      for (const kind of [null, "ifs"] as const) {
        expect(
          resolvePanelApplicability(
            "surfaceTrap",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: "hidden" });
      }
      expect(
        resolvePanelApplicability(
          "surfaceTrap",
          context("points", "escape", dimension),
        ),
      ).toEqual({ kind: "hidden" });
    },
  );

  it.each(["flat", "nonFlat"] as const)(
    "enables condensation only for Surface IFS in %s",
    (dimension) => {
      expect(
        resolvePanelApplicability(
          "surfaceCondensation",
          context("surface", "ifs", dimension),
        ),
      ).toEqual({ kind: "enabled" });
      for (const kind of [null, "escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability(
            "surfaceCondensation",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: "hidden" });
      }
    },
  );

  it.each(["flat", "nonFlat"] as const)(
    "enables trap geometry only for Surface escape in %s",
    (dimension) => {
      for (const kind of [null, "ifs", "escape", "bulb"] as const) {
        expect(
          resolvePanelApplicability(
            "surfaceTrapGeometry",
            context("surface", kind, dimension),
          ),
        ).toEqual({ kind: kind === "escape" ? "enabled" : "hidden" });
      }
    },
  );
});
