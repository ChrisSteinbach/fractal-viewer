import { toSnapshot } from "./persist";
import { initialState } from "./state";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
  sceneHasCustomMeshes,
  sceneMeshIds,
} from "./scene-mesh-assets";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import type { ShapeSpec } from "../fractal/shapes";

const custom = (digit: string): CustomMeshAssetId =>
  `mesh-sha256-${digit.repeat(64)}`;

const mesh = (id: CustomMeshAssetId | "star-prism-v1"): ShapeSpec => ({
  parts: [{ primitive: { kind: "mesh", meshId: id }, combine: "union" }],
});

describe("scene mesh dependencies", () => {
  it("collects emitter, schedule and trap references once in stable order", () => {
    const snapshot = toSnapshot(initialState(false));
    snapshot.transforms[0] = {
      ...snapshot.transforms[0],
      emitter: mesh(custom("b")),
    };
    snapshot.schedule = {
      depth: 1,
      transforms: [
        { ...snapshot.transforms[0], emitter: mesh("star-prism-v1") },
      ],
    };
    snapshot.shapeTrap = { shape: mesh(custom("a")) };
    expect(sceneMeshIds(snapshot)).toEqual([
      custom("a"),
      custom("b"),
      "star-prism-v1",
    ]);
    expect(sceneCustomMeshIds(snapshot)).toEqual([custom("a"), custom("b")]);
    expect(sceneHasCustomMeshes(snapshot)).toBe(true);
  });

  it("enforces the aggregate custom-mesh limit", () => {
    const snapshot = toSnapshot(initialState(false));
    snapshot.transforms = ["a", "b", "c", "d", "e"].map((digit, id) => ({
      ...snapshot.transforms[0],
      id,
      emitter: mesh(custom(digit)),
    }));
    expect(() => assertSceneCustomMeshBudget(snapshot)).toThrow(/active limit/);
  });
});
