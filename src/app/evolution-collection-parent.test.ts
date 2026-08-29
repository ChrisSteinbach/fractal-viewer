import { describe, expect, it, vi } from "vitest";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import { ownEvolutionSceneSnapshot } from "./evolution-candidate";
import {
  acquireEvolutionCollectionParent,
  type EvolutionCollectionParentDeps,
} from "./evolution-collection-parent";
import { evolutionSceneContentDigest } from "./evolution-crossover";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { initialState } from "./state";

const MESH_A: CustomMeshAssetId = `mesh-sha256-${"a".repeat(64)}`;
const MESH_B: CustomMeshAssetId = `mesh-sha256-${"b".repeat(64)}`;

function snapshot(): SceneSnapshot {
  return toSnapshot(initialState(true));
}

function dependencies(
  overrides: Partial<EvolutionCollectionParentDeps> = {},
): EvolutionCollectionParentDeps {
  return {
    decode: vi.fn(() => snapshot()),
    own: ownEvolutionSceneSnapshot,
    digest: (scene) => evolutionSceneContentDigest(scene),
    assertBudget: vi.fn(),
    resourceIds: vi.fn(() => [MESH_B, MESH_A, MESH_B]),
    pin: vi.fn(() => vi.fn()),
    hydrate: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("acquireEvolutionCollectionParent", () => {
  it("decodes once, owns the exact snapshot, and stages one sorted dependency set", async () => {
    const decoded = snapshot();
    decoded.transforms[0].position[0] = 0.125;
    const order: string[] = [];
    const release = vi.fn();
    const deps = dependencies({
      decode: vi.fn(() => {
        order.push("decode");
        return decoded;
      }),
      own: (scene) => {
        order.push("own");
        return ownEvolutionSceneSnapshot(scene);
      },
      digest: (scene) => {
        order.push("digest");
        return evolutionSceneContentDigest(scene);
      },
      assertBudget: () => order.push("budget"),
      resourceIds: () => {
        order.push("resources");
        return [MESH_B, MESH_A, MESH_B];
      },
      pin: (ids) => {
        order.push(`pin:${ids.join(",")}`);
        return release;
      },
      hydrate: async (ids) => {
        order.push(`hydrate:${ids.join(",")}`);
      },
    });

    const pending = acquireEvolutionCollectionParent(
      { encoded: "v1=collection" },
      { authorityId: "collection-1", label: "Collection keeper" },
      deps,
    );
    decoded.transforms[0].position[0] = 9;
    const result = await pending;

    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(deps.decode).toHaveBeenCalledOnce();
    expect(result.parent.endpoint.snapshot.transforms[0].position[0]).toBe(
      0.125,
    );
    expect(Object.isFrozen(result.parent.endpoint.snapshot)).toBe(true);
    expect(result.parent.resourceIds).toEqual([MESH_A, MESH_B]);
    expect(result.parent.endpoint.contentDigest).toBe(
      evolutionSceneContentDigest(
        result.parent.endpoint.snapshot as SceneSnapshot,
      ),
    );
    expect(result.parent.endpoint).not.toHaveProperty("topology");
    expect(order).toEqual([
      "decode",
      "own",
      "digest",
      "budget",
      "resources",
      `pin:${MESH_A},${MESH_B}`,
      `hydrate:${MESH_A},${MESH_B}`,
    ]);
    expect(release).not.toHaveBeenCalled();
  });

  it("refuses corrupt Collection bytes before ownership or asset effects", async () => {
    const own = vi.fn(ownEvolutionSceneSnapshot);
    const pin = vi.fn(() => vi.fn());
    const hydrate = vi.fn(async () => undefined);
    const result = await acquireEvolutionCollectionParent(
      { encoded: "corrupt" },
      { authorityId: "corrupt-1", label: "Corrupt" },
      dependencies({ decode: vi.fn(() => null), own, pin, hydrate }),
    );

    expect(result).toEqual({
      acquired: false,
      code: "decode-failed",
      detail: "Collection scene could not be decoded",
    });
    expect(own).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("refuses scene-budget failure before pinning", async () => {
    const pin = vi.fn(() => vi.fn());
    const hydrate = vi.fn(async () => undefined);
    const result = await acquireEvolutionCollectionParent(
      { encoded: "v1=too-many" },
      { authorityId: "large-1", label: "Too many meshes" },
      dependencies({
        assertBudget: () => {
          throw new RangeError("four-mesh scene budget exceeded");
        },
        pin,
        hydrate,
      }),
    );

    expect(result).toMatchObject({
      acquired: false,
      code: "invalid-scene",
      detail: "four-mesh scene budget exceeded",
    });
    expect(pin).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("reports pin refusal without claiming ownership", async () => {
    const hydrate = vi.fn(async () => undefined);
    const result = await acquireEvolutionCollectionParent(
      { encoded: "v1=busy" },
      { authorityId: "busy-1", label: "Busy" },
      dependencies({
        pin: () => {
          throw new RangeError("too many concurrent custom mesh working sets");
        },
        hydrate,
      }),
    );

    expect(result).toMatchObject({
      acquired: false,
      code: "asset-failed",
      detail: "too many concurrent custom mesh working sets",
    });
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("releases exactly once when hydration fails", async () => {
    const release = vi.fn();
    const result = await acquireEvolutionCollectionParent(
      { encoded: "v1=missing-mesh" },
      { authorityId: "missing-1", label: "Missing mesh" },
      dependencies({
        pin: () => release,
        hydrate: async () => {
          throw new Error("mesh source is missing");
        },
      }),
    );

    expect(result).toMatchObject({
      acquired: false,
      code: "asset-failed",
      detail: "mesh source is missing",
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("hands successful stale cleanup to the caller through an idempotent release", async () => {
    const release = vi.fn();
    const result = await acquireEvolutionCollectionParent(
      { encoded: "v1=stale-later" },
      { authorityId: "stale-1", label: "Stale later" },
      dependencies({ pin: () => release }),
    );
    if (!result.acquired) throw new Error("expected acquisition");

    expect(release).not.toHaveBeenCalled();
    // The integration discovered that a newer per-slot ticket won.
    result.parent.release();
    result.parent.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects invalid lifecycle identity before decoding", async () => {
    const decode = vi.fn(() => snapshot());
    const result = await acquireEvolutionCollectionParent(
      { encoded: "v1=valid" },
      { authorityId: "", label: "" },
      dependencies({ decode }),
    );

    expect(result).toMatchObject({
      acquired: false,
      code: "invalid-authority",
    });
    expect(decode).not.toHaveBeenCalled();
  });
});
