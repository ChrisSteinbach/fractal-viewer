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
import { surfaceClosedSolidAdmitted } from "./surface-optics-backend";

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
      "glass-menger",
      "glass-cells",
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
    for (const id of ["glass-garden", "glass-menger"] as const) {
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
    // The Menger's one emitter is the eight-cell posed-box union — the
    // intricate tier's multi-face traversal, one solid to the field.
    const menger = createSurfaceTransmissionStarter("glass-menger");
    expect(menger.transforms).toHaveLength(1);
    expect(menger.transforms[0].emitter?.parts).toHaveLength(8);
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
        expect(restored.transforms[i].emitter).toBeDefined();
        expect(restored.transforms[i].w).toEqual(snap.transforms[i].w);
      }
      expect(restored.groundPlane).toBe(true);
      expect(restored.camera).toEqual(snap.camera);
      expect(restored.fourD).toEqual(snap.fourD);
    }
  });
});
