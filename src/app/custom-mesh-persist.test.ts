// @vitest-environment jsdom
import { decodeScene, encodeScene, saveScene, toSnapshot } from "./persist";
import { initialState } from "./state";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import type { ShapeTrap } from "../fractal/types";

const ID: CustomMeshAssetId = `mesh-sha256-${"a".repeat(64)}`;

describe("local custom mesh persistence", () => {
  it("round-trips the content reference without embedding geometry", () => {
    const snapshot = toSnapshot(initialState(false));
    const shapeTrap: ShapeTrap = {
      shape: {
        parts: [{ primitive: { kind: "mesh", meshId: ID }, combine: "union" }],
      },
    };
    snapshot.shapeTrap = shapeTrap;
    const encoded = encodeScene(snapshot);
    expect(encoded).not.toContain("Float64Array");
    expect(decodeScene(encoded)?.shapeTrap?.shape).toEqual(shapeTrap.shape);
  });

  it("keeps the scene in local storage while clearing the non-portable hash", () => {
    const snapshot = toSnapshot(initialState(false));
    snapshot.transforms[0] = {
      ...snapshot.transforms[0],
      emitter: {
        parts: [{ primitive: { kind: "mesh", meshId: ID }, combine: "union" }],
      },
    };
    const stored = new Map<string, string>();
    const urls: string[] = [];
    saveScene(snapshot, {
      location: { hash: "#old", pathname: "/viewer", search: "?quality=high" },
      history: {
        replaceState: (_data, _unused, url) => {
          urls.push(String(url));
        },
      },
      storage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => {
          stored.set(key, value);
        },
      },
    });
    expect(urls).toEqual(["/viewer?quality=high"]);
    expect([...stored.values()]).toEqual([encodeScene(snapshot)]);
  });
});
