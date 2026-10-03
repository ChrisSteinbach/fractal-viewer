import { describe, expect, it } from "vitest";
import { parseSurfaceGridOverride } from "./surface-grid-pin";

describe("parseSurfaceGridOverride", () => {
  it("defaults to no override on an empty or unrelated search", () => {
    expect(parseSurfaceGridOverride("")).toEqual({
      refuse: false,
      resolution: null,
    });
    expect(parseSurfaceGridOverride("?surfacestate")).toEqual({
      refuse: false,
      resolution: null,
    });
  });

  it("refuses the grid only for the exact 0 value", () => {
    expect(parseSurfaceGridOverride("?surfacegrid=0").refuse).toBe(true);
    expect(parseSurfaceGridOverride("?surfacegrid=1").refuse).toBe(false);
    expect(parseSurfaceGridOverride("?surfacegrid").refuse).toBe(false);
  });

  it("pins a resolution inside 4..64 and rejects everything else", () => {
    expect(parseSurfaceGridOverride("?surfacegridres=48").resolution).toBe(48);
    expect(parseSurfaceGridOverride("?surfacegridres=4").resolution).toBe(4);
    expect(parseSurfaceGridOverride("?surfacegridres=64").resolution).toBe(64);
    expect(parseSurfaceGridOverride("?surfacegridres=3").resolution).toBeNull();
    expect(
      parseSurfaceGridOverride("?surfacegridres=65").resolution,
    ).toBeNull();
    expect(
      parseSurfaceGridOverride("?surfacegridres=abc").resolution,
    ).toBeNull();
    expect(
      parseSurfaceGridOverride("?surfacegridres=4.5").resolution,
    ).toBeNull();
  });

  it("reads both levers at once", () => {
    expect(
      parseSurfaceGridOverride("?surfacegrid=0&surfacegridres=32"),
    ).toEqual({ refuse: true, resolution: 32 });
  });
});
