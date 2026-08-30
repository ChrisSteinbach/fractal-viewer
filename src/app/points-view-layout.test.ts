import { fourPointsViewports, pointsViewportAt } from "./points-view-layout";

describe("fourPointsViewports", () => {
  it("tiles the panel-uncovered workspace and assigns the movable camera last", () => {
    expect(fourPointsViewports(1001, 701, 301)).toEqual([
      {
        kind: "x",
        left: 0,
        top: 0,
        width: 350,
        height: 350,
        adjustable: false,
      },
      {
        kind: "y",
        left: 350,
        top: 0,
        width: 350,
        height: 350,
        adjustable: false,
      },
      {
        kind: "z",
        left: 0,
        top: 350,
        width: 350,
        height: 351,
        adjustable: false,
      },
      {
        kind: "current",
        left: 350,
        top: 350,
        width: 350,
        height: 351,
        adjustable: true,
      },
    ]);
  });

  it("keeps an odd uncovered pixel instead of leaving a seam", () => {
    const views = fourPointsViewports(1000, 701, 299);
    expect(views[0].width + views[1].width).toBe(701);
    expect(views[0].height + views[2].height).toBe(701);
  });

  it("clamps an oversized inset without producing negative panes", () => {
    expect(
      fourPointsViewports(320, 200, 999).every((view) => view.width >= 0),
    ).toBe(true);
  });
});

describe("pointsViewportAt", () => {
  const views = fourPointsViewports(800, 600, 0);

  it.each([
    [0, 0, "x"],
    [399, 299, "x"],
    [400, 299, "y"],
    [399, 300, "z"],
    [400, 300, "current"],
    [799, 599, "current"],
  ] as const)("maps (%s, %s) to %s", (x, y, kind) => {
    expect(pointsViewportAt(views, x, y)?.kind).toBe(kind);
  });

  it("rejects coordinates outside the rendered workspace", () => {
    expect(pointsViewportAt(views, 800, 300)).toBeNull();
    expect(pointsViewportAt(views, -1, 0)).toBeNull();
  });
});
