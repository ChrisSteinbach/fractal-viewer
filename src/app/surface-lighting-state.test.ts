import {
  cloneSurfaceLighting,
  DEFAULT_SURFACE_LIGHTING,
} from "../fractal/surface-lighting";
import { SceneCollection } from "./collection";
import {
  CROSSOVER_ALGORITHM_VERSION,
  createEvolutionCrossoverAttempt,
  prepareEvolutionCrossover,
} from "./evolution-crossover";
import { assertValidEvolutionSceneSnapshot } from "./evolution-snapshot-validation";
import { SceneHistory } from "./history";
import { decodeScene, encodeScene, fromSnapshot, toSnapshot } from "./persist";
import { initialState, setSurfaceLighting } from "./state";
import { createSurfaceLightingStarter } from "./surface-lighting-starters";
import { TimelineStore } from "./timeline";

function payload(encoded: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(encoded.slice(3), "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

function withLighting(raw: unknown): string {
  const value = payload(encodeScene(toSnapshot(initialState(false))));
  (value.surface as Record<string, unknown>).lighting = raw;
  return (
    "v1=" + Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
  );
}

describe("authored Surface lighting state", () => {
  it("leaves legacy documents without a materialized rig", () => {
    const state = initialState(false);
    const encoded = encodeScene(toSnapshot(state));
    expect(payload(encoded).surface).not.toHaveProperty("lighting");
    expect(decodeScene(encoded)?.surface).not.toHaveProperty("lighting");
    const removed = setSurfaceLighting(
      setSurfaceLighting(state, DEFAULT_SURFACE_LIGHTING),
      undefined,
    );
    expect(encodeScene(toSnapshot(removed))).toBe(encoded);
  });

  it("owns every nested vector at installation and snapshot boundaries", () => {
    const authored =
      createSurfaceLightingStarter("cathedral").surface.lighting!;
    const state = setSurfaceLighting(initialState(false), authored);
    const snapshot = toSnapshot(state);
    const restored = fromSnapshot(snapshot, initialState(false));
    authored.lights[0].position[0] = 12;
    authored.lights[0].normal[1] = 12;
    authored.lights[0].color[2] = 12;
    authored.ambient[0] = 12;
    expect(state.surface.lighting).toEqual(snapshot.surface.lighting);
    restored.surface.lighting!.lights[0].position[0] = 30;
    restored.surface.lighting!.lights[0].color[0] = 0;
    expect(snapshot.surface.lighting!.lights[0].position[0]).toBe(0);
    expect(snapshot.surface.lighting!.lights[0].color[0]).toBe(1);
    snapshot.surface.lighting!.ambient[2] = 50;
    expect(state.surface.lighting!.ambient[2]).toBe(0.05);
  });

  it("restoring a legacy snapshot clears a dormant base rig", () => {
    const base = setSurfaceLighting(
      initialState(false),
      DEFAULT_SURFACE_LIGHTING,
    );
    const restored = fromSnapshot(toSnapshot(initialState(false)), base);
    expect(restored.surface).not.toHaveProperty("lighting");
  });

  it("round-trips full finite precision without resolving authored domains", () => {
    const rig = createSurfaceLightingStarter("cathedral").surface.lighting!;
    rig.lights[0].position = [0.123456789012345, -20, 1e10];
    rig.lights[0].normal = [0, 3.141592653589793, 0];
    rig.lights[0].radius = -0.125;
    rig.lights[0].color[0] = 12.123456789;
    rig.roughness = 1.987654321;
    const decoded = decodeScene(withLighting(rig));
    expect(decoded?.surface.lighting).toEqual(rig);
    expect(decodeScene(encodeScene(decoded!))?.surface.lighting).toEqual(rig);
    expect(() => assertValidEvolutionSceneSnapshot(decoded)).not.toThrow();
  });

  it("keeps identical lighting state on a non-flat 4D document", () => {
    const state = setSurfaceLighting(
      initialState(false),
      DEFAULT_SURFACE_LIGHTING,
    );
    state.transforms[0].w = { position: 0.2, rotation: { xw: 0.3 } };
    const decoded = decodeScene(encodeScene(toSnapshot(state)))!;
    expect(decoded.transforms[0].w).toEqual(state.transforms[0].w);
    expect(decoded.surface.lighting).toEqual(state.surface.lighting);
  });

  it("opens a document written with a medium, keeping its lights and dropping the mist", () => {
    // The participating medium was removed on its measured cost, so a link
    // or saved scene from before that must still open — with its rig
    // intact and no medium, which is what the renderer would draw anyway.
    const rig = createSurfaceLightingStarter("cathedral").surface.lighting!;
    const legacy = {
      ...rig,
      medium: {
        center: [0, 0, 0],
        radius: 1.35,
        density: 0.42,
        tint: [0.95, 0.92, 0.85],
        anisotropy: 0.45,
      },
    };
    const decoded = decodeScene(withLighting(legacy))?.surface.lighting;
    expect(decoded).toEqual(rig);
    expect(decoded).not.toHaveProperty("medium");
  });

  it.each([
    null,
    {},
    {
      ...DEFAULT_SURFACE_LIGHTING,
      lights: [
        DEFAULT_SURFACE_LIGHTING.lights[0],
        DEFAULT_SURFACE_LIGHTING.lights[0],
        DEFAULT_SURFACE_LIGHTING.lights[0],
      ],
    },
    { ...DEFAULT_SURFACE_LIGHTING, ambient: [1, 2] },
    { ...DEFAULT_SURFACE_LIGHTING, specular: "0.5" },
    {
      ...DEFAULT_SURFACE_LIGHTING,
      lights: [{ ...DEFAULT_SURFACE_LIGHTING.lights[0], normal: [0, null, 1] }],
    },
  ])("rejects malformed rig structure %#", (bad) => {
    expect(decodeScene(withLighting(bad))).toBeNull();
  });

  it("round-trips the same owned document through undo, Collection and Timeline", () => {
    const snapshot = createSurfaceLightingStarter("balloon-cavern");
    const encoded = encodeScene(snapshot);
    const expected = cloneSurfaceLighting(snapshot.surface.lighting!);
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const history = new SceneHistory();
    history.checkpoint(encoded, false);
    new SceneCollection({ storage }).add(encoded, "", "surface");
    new TimelineStore({ storage }).add(encoded, "", "surface");
    snapshot.surface.lighting!.lights[0].intensity = 0;
    snapshot.surface.lighting!.ambient[0] = 0;
    const restored = [
      history.undo(encodeScene(snapshot))!.snapshot,
      new SceneCollection({ storage }).all()[0].encoded,
      new TimelineStore({ storage }).all()[0].encoded,
    ];
    for (const saved of restored) {
      expect(decodeScene(saved)?.surface.lighting).toEqual(expected);
      expect(decodeScene(saved)?.camera?.fov).toBeCloseTo(66.0477351116, 8);
      expect(decodeScene(saved)?.camera?.infiniteZoom).toBeUndefined();
    }
  });

  it("Evolution inherits the primary rig without aliases and rejects unknown nested fields", () => {
    const primary = createSurfaceLightingStarter("cathedral");
    const secondary = createSurfaceLightingStarter("balloon-cavern");
    const prepared = prepareEvolutionCrossover(
      { snapshot: primary },
      { snapshot: secondary },
    );
    expect(prepared.accepted).toBe(true);
    if (!prepared.accepted) throw new Error(prepared.refusal.detail);
    const result = createEvolutionCrossoverAttempt(prepared.prepared, {
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      nodeSeed: 12,
      childOrdinal: 1,
      attempt: 0,
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.refusal.detail);
    expect(result.attempt.snapshot.surface.lighting).toEqual(
      primary.surface.lighting,
    );
    primary.surface.lighting!.lights[0].intensity = 90;
    expect(result.attempt.snapshot.surface.lighting!.lights[0].intensity).toBe(
      7,
    );
    const bad = createSurfaceLightingStarter("cathedral");
    Object.assign(bad.surface.lighting!.lights[0], { unsupported: 1 });
    expect(() => assertValidEvolutionSceneSnapshot(bad)).toThrow(/unsupported/);
  });
});
