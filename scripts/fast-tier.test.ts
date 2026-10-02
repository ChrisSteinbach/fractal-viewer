/**
 * Unit tests for the fast-tier gate helpers (scripts/lib/fast-tier.mjs):
 * the flag's default-and-refuse contract, the raster/samples/scale knobs,
 * and the pilot's fast-vs-full correspondence compare. The gates' own
 * wiring (viewport objects, URL strings, verdict lines) is browser code
 * exercised by the gates themselves; what a tier MEANS lives here.
 */
import { describe, expect, it } from "vitest";
import {
  FAST_TIER_MAXRAYS,
  parseTierArg,
  tierCorrespondence,
  tierExportScale,
  tierLabel,
  tierUrlParams,
} from "./lib/fast-tier.mjs";

describe("parseTierArg", () => {
  it("defaults to full — every pre-existing invocation keeps its meaning", () => {
    expect(parseTierArg([])).toBe("full");
    expect(parseTierArg(["--display=:0", "--settle=1000"])).toBe("full");
  });

  it("accepts --tier=fast and --tier=full", () => {
    expect(parseTierArg(["--tier=fast"])).toBe("fast");
    expect(parseTierArg(["--tier=full"])).toBe("full");
    expect(parseTierArg(["--tier=fast", "--url=https://localhost:4173"])).toBe(
      "fast",
    );
  });

  it("refuses a bare --tier — a typo'd flag must not silently run full", () => {
    expect(() => parseTierArg(["--tier"])).toThrow(/needs a value/);
    expect(() => parseTierArg(["--tier="])).toThrow(/needs a value/);
  });

  it("refuses an unknown tier by name", () => {
    expect(() => parseTierArg(["--tier=quick"])).toThrow(
      /unknown --tier=quick/,
    );
    expect(() => parseTierArg(["--tier=FAST"])).toThrow(/unknown --tier=FAST/);
  });

  it("refuses a flag that merely starts with --tier", () => {
    expect(() => parseTierArg(["--tierfoo"])).toThrow(/unknown flag/);
  });
});

describe("tierUrlParams", () => {
  it("full adds nothing — the gate's own conventions apply byte-unchanged", () => {
    expect(tierUrlParams("full")).toEqual({});
  });

  it("fast pins one antialiasing pass and the ray cap — the app's own overrides", () => {
    expect(tierUrlParams("fast")).toEqual({
      surfacesamples: "1",
      surfacemaxrays: String(FAST_TIER_MAXRAYS),
    });
  });

  it("the cap is a quarter of the lift-class viewport's rays, so the fit scale is exactly 0.5 there", () => {
    expect(FAST_TIER_MAXRAYS).toBe((1024 * 640) / 4);
  });
});

describe("tierExportScale", () => {
  it("full passes the gate's own scale through", () => {
    expect(tierExportScale("full", 2)).toBe(2);
    expect(tierExportScale("full", 1)).toBe(1);
  });

  it("fast pins 1 — the export is the pane's own size", () => {
    expect(tierExportScale("fast", 2)).toBe(1);
    expect(tierExportScale("fast", 4)).toBe(1);
  });
});

describe("tierLabel", () => {
  it("is the disclosure itself", () => {
    expect(tierLabel("fast")).toBe("fast");
    expect(tierLabel("full")).toBe("full");
  });
});

describe("tierCorrespondence", () => {
  it("agrees when every predicate held on both tiers", () => {
    expect(
      tierCorrespondence(
        { entered: true, settled: true, drew: true },
        { entered: true, settled: true, drew: true },
      ),
    ).toEqual({ agree: true, diverged: [] });
  });

  it("agrees on all-false too — the compare is symmetric", () => {
    expect(tierCorrespondence({ drew: false }, { drew: false })).toEqual({
      agree: true,
      diverged: [],
    });
  });

  it("names the predicates that diverge, in either direction", () => {
    const fastOnly = tierCorrespondence(
      { drew: true, settled: true },
      { drew: false, settled: true },
    );
    expect(fastOnly.agree).toBe(false);
    expect(fastOnly.diverged).toEqual(["drew"]);

    const fullOnly = tierCorrespondence({ drew: false }, { drew: true });
    expect(fullOnly.agree).toBe(false);
    expect(fullOnly.diverged).toEqual(["drew"]);
  });

  it("treats a predicate present on one side only as a divergence", () => {
    const result = tierCorrespondence({ a: true }, { a: true, b: true });
    expect(result.agree).toBe(false);
    expect(result.diverged).toEqual(["b"]);
  });

  it("is key-order-insensitive", () => {
    expect(
      tierCorrespondence({ a: true, b: false }, { b: false, a: true }),
    ).toEqual({ agree: true, diverged: [] });
  });
});
