import {
  formatLag,
  formatMissingReport,
  formatStaleReport,
  isLocalPreviewUrl,
  staleSources,
} from "./lib/dist-freshness.mjs";

/**
 * The guard's whole job is a comparison of mtimes, so the comparison is what
 * is pinned here — no filesystem, no clock. `staleSources` is pure over
 * already-stat'd inputs for exactly this reason.
 */
describe("staleSources", () => {
  it("reports a source modified after the build as stale", () => {
    const stale = staleSources({
      builtMs: 1_000,
      sources: [{ path: "src/app/main.ts", mtimeMs: 2_000 }],
    });
    expect(stale).toEqual([{ path: "src/app/main.ts", mtimeMs: 2_000 }]);
  });

  it("reports a source modified before the build as fresh", () => {
    const stale = staleSources({
      builtMs: 2_000,
      sources: [{ path: "src/app/main.ts", mtimeMs: 1_000 }],
    });
    expect(stale).toEqual([]);
  });

  it("treats an mtime equal to the build as fresh", () => {
    // A build reads its sources and writes afterwards, so same-millisecond is
    // the ordinary outcome of a build that just ran — never an edit it missed.
    const stale = staleSources({
      builtMs: 1_500,
      sources: [{ path: "vite.config.ts", mtimeMs: 1_500 }],
    });
    expect(stale).toEqual([]);
  });

  it("orders the newest offender first", () => {
    const stale = staleSources({
      builtMs: 1_000,
      sources: [
        { path: "src/fractal/affine.ts", mtimeMs: 1_100 },
        { path: "src/app/main.ts", mtimeMs: 9_000 },
        { path: "package.json", mtimeMs: 3_000 },
      ],
    });
    expect(stale.map((s: { path: string }) => s.path)).toEqual([
      "src/app/main.ts",
      "package.json",
      "src/fractal/affine.ts",
    ]);
  });

  it("returns nothing for an empty source list", () => {
    expect(staleSources({ builtMs: 1_000, sources: [] })).toEqual([]);
  });
});

describe("formatStaleReport", () => {
  it("names the newest offending file with its lag", () => {
    const builtMs = Date.parse("2026-09-11T14:02:11");
    const message = formatStaleReport({
      builtPath: "dist/app/index.html",
      builtMs,
      stale: [
        { path: "src/app/main.ts", mtimeMs: builtMs + 17 * 60_000 + 36_000 },
      ],
    });
    expect(message).toContain("src/app/main.ts");
    expect(message).toContain("+17m36s");
  });

  it("summarises the remaining offenders as a count", () => {
    const builtMs = Date.parse("2026-09-11T14:02:11");
    const message = formatStaleReport({
      builtPath: "dist/app/index.html",
      builtMs,
      stale: [
        { path: "src/app/main.ts", mtimeMs: builtMs + 4_000 },
        { path: "src/app/ui.ts", mtimeMs: builtMs + 3_000 },
        { path: "src/fractal/affine.ts", mtimeMs: builtMs + 2_000 },
        { path: "package.json", mtimeMs: builtMs + 1_000 },
      ],
    });
    expect(message).toContain(
      "...and 3 more source files newer than the build.",
    );
  });

  it("omits the count line when the newest offender is the only one", () => {
    const builtMs = Date.parse("2026-09-11T14:02:11");
    const message = formatStaleReport({
      builtPath: "dist/app/index.html",
      builtMs,
      stale: [{ path: "src/app/main.ts", mtimeMs: builtMs + 1_000 }],
    });
    expect(message).not.toContain("...and");
  });

  it("ends with the instruction that fixes it", () => {
    const builtMs = Date.parse("2026-09-11T14:02:11");
    const message = formatStaleReport({
      builtPath: "dist/app/index.html",
      builtMs,
      stale: [{ path: "src/app/main.ts", mtimeMs: builtMs + 1_000 }],
    });
    expect(message).toContain(
      "Run `npm run build` and restart `npm run preview`.",
    );
  });
});

describe("formatMissingReport", () => {
  it("says nothing has been built rather than reporting staleness", () => {
    const message = formatMissingReport({ builtPath: "dist/app/index.html" });
    expect(message).toContain("nothing has been built");
    expect(message).toContain("Run `npm run build`");
  });
});

describe("formatLag", () => {
  it("renders a sub-minute lag in seconds", () => {
    expect(formatLag(36_000)).toBe("+36s");
  });

  it("renders a sub-hour lag in minutes and seconds", () => {
    expect(formatLag(17 * 60_000 + 36_000)).toBe("+17m36s");
  });

  it("renders a multi-hour lag with an hours field", () => {
    expect(formatLag(2 * 3_600_000 + 5 * 60_000 + 4_000)).toBe("+2h5m4s");
  });
});

describe("isLocalPreviewUrl", () => {
  it("treats the preview origin as local", () => {
    expect(isLocalPreviewUrl("https://localhost:4173")).toBe(true);
  });

  it("treats a deployed origin as remote so the guard does not apply", () => {
    expect(isLocalPreviewUrl("https://fractal-4d.com")).toBe(false);
  });

  it("treats an absent url as local, so a gate without one is still guarded", () => {
    expect(isLocalPreviewUrl(undefined)).toBe(true);
  });
});
