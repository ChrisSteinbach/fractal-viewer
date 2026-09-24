import { describe, expect, it } from "vitest";
import { analyzeSurfaceSystem } from "../fractal/surface-de";
import { buildSurfaceDE } from "../fractal/surface-de";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import { analyzeSurfaceSystem4 } from "../fractal/surface-de-4d";
import { decodeScene, encodeScene } from "./persist";
import { rotorMatrix } from "./rotor4";
import { systemIsNonFlat } from "./state";
import { initialState } from "./state";
import {
  createSurfaceTransmissionStarter,
  SURFACE_TRANSMISSION_STARTERS,
  surfaceTransmissionStarterFromValue,
  surfaceTransmissionStarterValue,
} from "./surface-transmission-starters";
import {
  surfaceClosedSolidAdmitted,
  surfaceCondensationSolidAdmitted,
  surfaceOpticsOutlook,
} from "./surface-optics-backend";

/**
 * The transmission starters' contract: each is an emitter-only C0 system
 * (the closed-solid backend's qualified shape) whose every transform
 * authors the dielectric optics, each is SURFACE-eligible as built, the 4D
 * one is genuinely non-flat with its saved slice carrying every member's
 * flat, and each survives the document round trip byte-identically — a
 * starter is an ordinary scene document, not a renderer override.
 */

describe("surface transmission starters", () => {
  it("exposes the three compositions under glass: values", () => {
    expect(SURFACE_TRANSMISSION_STARTERS.map((s) => s.id)).toEqual([
      "glass-garden",
      "glass-corner-cells",
      "glass-cells",
      "glass-beads",
      "glass-rings",
      "glass-beads-4d",
    ]);
    expect(surfaceTransmissionStarterValue("glass-garden")).toBe(
      "glass:glass-garden",
    );
    expect(surfaceTransmissionStarterFromValue("glass:glass-cells")).toBe(
      "glass-cells",
    );
    expect(surfaceTransmissionStarterFromValue("glass-garden")).toBeUndefined();
  });

  it("builds 3D emitter-only unions that are eligible and closed-solid admitted", () => {
    for (const id of ["glass-garden", "glass-corner-cells"] as const) {
      const snap = createSurfaceTransmissionStarter(id);
      const eligibility = analyzeSurfaceSystem(
        snap.transforms,
        snap.finalTransform ?? null,
        null,
        { order: 1, plane: "xy" },
      );
      expect(eligibility.status).toBe("eligible");
      const de = buildSurfaceDE(
        snap.transforms,
        snap.finalTransform ?? null,
        { order: 1, plane: "xy" },
        {},
      );
      expect(de.maps.length).toBe(0);
      expect(de.condensation?.emitters.length).toBeGreaterThan(0);
      expect(surfaceClosedSolidAdmitted(de, {})).toBe(true);
      // Every transform authors the dielectric model with the distortion
      // study's working value — the Glass bundle's own selector.
      for (const t of snap.transforms) {
        expect(t.optics).toEqual({ model: "dielectric", distortion: 0.08 });
      }
    }
    // The corner cells' one emitter is the eight-box posed union — the
    // intricate tier's multi-face traversal, one solid to the field, and
    // NOT the recursive Menger (that is the "Glass Menger" preset's
    // finite-cell route).
    const cornerCells = createSurfaceTransmissionStarter("glass-corner-cells");
    expect(cornerCells.transforms).toHaveLength(1);
    expect(cornerCells.transforms[0].emitter?.parts).toHaveLength(8);
  });

  it("builds a native 4D composition whose saved slice carries every flat", () => {
    const snap = createSurfaceTransmissionStarter("glass-cells");
    expect(snap.fourD).toBeDefined();
    // Genuinely non-flat: the members' w translation lifts them out of
    // w = 0 (this is what makes the starter native 4D at all).
    const state = { ...initialState(true), transforms: snap.transforms };
    expect(systemIsNonFlat(state)).toBe(true);
    const eligibility = analyzeSurfaceSystem4(
      snap.transforms,
      snap.finalTransform ?? null,
      null,
      { order: 1, plane: "xy" },
    );
    expect(eligibility.status).toBe("eligible");
    const de = buildSurfaceDE4(
      snap.transforms,
      snap.finalTransform ?? null,
      { order: 1, plane: "xy" },
      {},
    );
    expect(de.maps.length).toBe(0);
    const pose = snap.fourD!;
    expect(pose.sliceW).toBe(0);
    expect(
      surfaceClosedSolidAdmitted(
        de,
        {},
        {
          rotor: rotorMatrix(pose.pair),
          w0: 0,
          sliceHalfW: 0,
        },
      ),
    ).toBe(true);
    // The same members off their carried flat refuse — the honest
    // degradation the panel note discloses.
    expect(
      surfaceClosedSolidAdmitted(
        de,
        {},
        { rotor: rotorMatrix(pose.pair), w0: 0.25, sliceHalfW: 0 },
      ),
    ).toBe(false);
  });

  it("builds the curved-solid fractals: maps beside one glass emitter, admitted by the general solid and not by C0", () => {
    for (const id of ["glass-beads", "glass-rings"] as const) {
      const snap = createSurfaceTransmissionStarter(id);
      const options = { condensationDepthBand: snap.condensationDepthBand };
      const noSym = { order: 1, plane: "xy" as const };
      expect(
        analyzeSurfaceSystem(
          snap.transforms,
          null,
          null,
          noSym,
          snap.condensationDepthBand,
        ).status,
      ).toBe("eligible");
      const de = buildSurfaceDE(snap.transforms, null, noSym, options);
      expect(de.maps.length).toBe(4);
      expect(surfaceClosedSolidAdmitted(de, {})).toBe(false);
      expect(surfaceCondensationSolidAdmitted(de, {})).toBe(true);
      // Every transform authors glass: a hit's material follows the
      // descent's attribution, which can name a map on the emitter's images.
      for (const t of snap.transforms) {
        expect(t.optics).toEqual({ model: "dielectric", distortion: 0.08 });
      }
      // The panel's document mirror agrees with the session predicate.
      expect(
        surfaceOpticsOutlook("ifs", {
          transforms: snap.transforms,
          finalTransform: null,
          schedulePresent: false,
          tilingPresent: false,
          balloonOn: false,
          condensationDepthBand: snap.condensationDepthBand,
          symmetry: noSym,
        }),
      ).toEqual({ resolves: "closed-solid", sliceCoupled: false });
    }
  });

  it("builds the 4D fractal twin at the canonical pose the general solid admits", () => {
    const snap = createSurfaceTransmissionStarter("glass-beads-4d");
    const state = { ...initialState(true), transforms: snap.transforms };
    expect(systemIsNonFlat(state)).toBe(true);
    const noSym = { order: 1, plane: "xy" as const };
    const de = buildSurfaceDE4(snap.transforms, null, noSym, {
      condensationDepthBand: snap.condensationDepthBand,
    });
    const pose = snap.fourD!;
    const rotor = rotorMatrix(pose.pair);
    expect(
      surfaceCondensationSolidAdmitted(de, {}, { rotor, w0: 0, sliceHalfW: 0 }),
    ).toBe(true);
    expect(
      surfaceCondensationSolidAdmitted(
        de,
        {},
        { rotor, w0: 0.25, sliceHalfW: 0 },
      ),
    ).toBe(false);
    expect(
      surfaceOpticsOutlook("ifs4", {
        transforms: snap.transforms,
        finalTransform: null,
        schedulePresent: false,
        tilingPresent: false,
        balloonOn: false,
        condensationDepthBand: snap.condensationDepthBand,
        symmetry: noSym,
      }),
    ).toEqual({ resolves: "closed-solid", sliceCoupled: true });
  });

  it("round-trips every document through the share-link encode/decode", () => {
    for (const entry of SURFACE_TRANSMISSION_STARTERS) {
      const snap = createSurfaceTransmissionStarter(entry.id);
      const decoded = decodeScene(encodeScene(snap));
      expect(decoded).not.toBeNull();
      const restored = decoded!;
      expect(restored.transforms).toHaveLength(snap.transforms.length);
      for (let i = 0; i < snap.transforms.length; i++) {
        expect(restored.transforms[i].optics).toEqual(
          snap.transforms[i].optics,
        );
        expect(restored.transforms[i].emitter).toEqual(
          snap.transforms[i].emitter,
        );
        expect(restored.transforms[i].w).toEqual(snap.transforms[i].w);
      }
      expect(restored.groundPlane).toBe(true);
      expect(restored.camera).toEqual(snap.camera);
      expect(restored.fourD).toEqual(snap.fourD);
      expect(restored.condensationDepthBand).toEqual(
        snap.condensationDepthBand,
      );
    }
  });
});
