import { describe, expect, it } from "vitest";
import { EvolutionComparisonSession } from "./evolution-comparison";
import { EvolutionLineage, type LineageNodeInput } from "./evolution-lineage";
import { initialState } from "./state";
import { toSnapshot, type SceneSnapshot } from "./persist";

function input(key: string, snapshot?: SceneSnapshot): LineageNodeInput {
  return {
    encodedScene: key,
    snapshot: snapshot ?? toSnapshot(initialState(true)),
    thumbnail: new Uint8ClampedArray([1, 2, 3, 255]),
    seed: 7,
    profile: { algorithm: "comparison-test" },
  };
}

function branch() {
  const lineage = new EvolutionLineage(input("root"));
  const rootId = lineage.rootId!;
  const first = lineage.addMutation(rootId, input("first"));
  const second = lineage.addMutation(rootId, input("second"));
  if (!first.added || !second.added) throw new Error("test graph refused");
  return {
    lineage,
    comparison: new EvolutionComparisonSession(lineage),
    rootId,
    firstId: first.node.id,
    secondId: second.node.id,
  };
}

describe("EvolutionComparisonSession", () => {
  it("pins, replaces, clears, and visibly resolves a pruned endpoint", () => {
    const { lineage, comparison, rootId, firstId, secondId } = branch();

    expect(comparison.resolve("A")).toEqual({ state: "empty" });
    expect(comparison.pin("A", firstId)).toBe(true);
    expect(comparison.resolve("A")).toMatchObject({
      state: "available",
      nodeId: firstId,
    });
    expect(comparison.pin("A", secondId)).toBe(true);
    lineage.prune(secondId, rootId);
    expect(comparison.resolve("A")).toEqual({
      state: "missing",
      nodeId: secondId,
    });
    comparison.clear("A");
    expect(comparison.resolve("A")).toEqual({ state: "empty" });
  });

  it("shows the exact owned snapshot without moving lineage selection or history", async () => {
    const { lineage, comparison, rootId, firstId } = branch();
    const target = lineage.node(firstId)!;
    comparison.pin("A", firstId);

    await expect(
      comparison.show("A", async (node) => {
        expect(node.snapshot).toEqual(target.snapshot);
        return true;
      }),
    ).resolves.toMatchObject({ displayed: true, slot: "A" });

    expect(lineage.currentId).toBe(rootId);
    expect(lineage.back()).toBeNull();
    expect(comparison.activeSlot).toBe("A");
    expect(lineage.size).toBe(3);
  });

  it("allows only the latest rapid endpoint request to declare the display override", async () => {
    const { lineage, comparison, firstId, secondId } = branch();
    comparison.pin("A", firstId);
    comparison.pin("B", secondId);
    const finishes = new Map<string, (loaded: boolean) => void>();
    const load = (node: { encodedScene: string }) =>
      new Promise<boolean>((resolve) =>
        finishes.set(node.encodedScene, resolve),
      );

    const first = comparison.show("A", load);
    const second = comparison.show("B", load);
    finishes.get("second")!(true);
    await expect(second).resolves.toMatchObject({ displayed: true, slot: "B" });
    finishes.get("first")!(true);
    await expect(first).resolves.toEqual({
      displayed: false,
      reason: "superseded",
    });
    expect(comparison.activeSlot).toBe("B");
    expect(lineage.currentId).toBe(lineage.rootId);
  });

  it("can supersede a pending first display before it becomes an override", async () => {
    const { comparison, firstId } = branch();
    comparison.pin("A", firstId);
    let finish!: (loaded: boolean) => void;
    const pending = comparison.show(
      "A",
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );

    comparison.cancelPending();
    finish(true);

    await expect(pending).resolves.toEqual({
      displayed: false,
      reason: "superseded",
    });
    expect(comparison.activeSlot).toBeNull();
  });

  it("keeps the current override on endpoint load failure", async () => {
    const { comparison, firstId, secondId } = branch();
    comparison.pin("A", firstId);
    comparison.pin("B", secondId);
    await comparison.show("A", async () => true);

    await expect(comparison.show("B", async () => false)).resolves.toEqual({
      displayed: false,
      reason: "load-failed",
    });
    expect(comparison.activeSlot).toBe("A");
  });

  it("never keeps an override naming a replaced or cleared active pin", async () => {
    const { comparison, firstId, secondId } = branch();
    comparison.pin("A", firstId);
    await comparison.show("A", async () => true);

    comparison.pin("A", secondId);
    expect(comparison.activeSlot).toBeNull();
    expect(comparison.resolve("A")).toMatchObject({ nodeId: secondId });

    await comparison.show("A", async () => true);
    comparison.clear("A");
    expect(comparison.activeSlot).toBeNull();
    expect(comparison.resolve("A")).toEqual({ state: "empty" });
  });

  it("reports a pin pruned after its load separately from an already-missing pin", async () => {
    const { lineage, comparison, rootId, firstId } = branch();
    comparison.pin("A", firstId);

    await expect(
      comparison.show("A", async () => {
        lineage.prune(firstId, rootId);
        return true;
      }),
    ).resolves.toEqual({
      displayed: false,
      reason: "pruned-after-load",
    });
    expect(comparison.activeSlot).toBeNull();

    await expect(comparison.show("A", async () => true)).resolves.toEqual({
      displayed: false,
      reason: "missing",
    });
  });

  it("restores the selected node on exit and clears the override even when restoration fails", async () => {
    const { lineage, comparison, firstId } = branch();
    comparison.pin("A", firstId);
    await comparison.show("A", async () => true);
    const selected = lineage.current()!;

    await expect(
      comparison.restore(selected, async () => true),
    ).resolves.toEqual({
      restored: true,
      node: selected,
    });
    expect(comparison.activeSlot).toBeNull();

    await comparison.show("A", async () => true);
    await expect(
      comparison.restore(selected, async () => false),
    ).resolves.toEqual({
      restored: false,
      reason: "load-failed",
    });
    expect(comparison.activeSlot).toBeNull();
    expect(lineage.currentId).toBe(selected.id);
  });

  it("hands 3D→3D, 3D→4D, and 4D→4D endpoints intact to the shared load path", async () => {
    const flat = toSnapshot(initialState(true));
    const fourA = structuredClone(flat);
    fourA.transforms[0].w = { position: 0.125 };
    const fourB = structuredClone(flat);
    fourB.transforms[0].w = { rotation: { xw: 0.375 } };
    const lineage = new EvolutionLineage(input("flat-a", flat));
    const flatB = lineage.addMutation(lineage.rootId!, input("flat-b", flat));
    const nonflatA = lineage.addMutation(lineage.rootId!, input("4d-a", fourA));
    const nonflatB = lineage.addMutation(lineage.rootId!, input("4d-b", fourB));
    if (!flatB.added || !nonflatA.added || !nonflatB.added) {
      throw new Error("test graph refused");
    }
    const comparison = new EvolutionComparisonSession(lineage);
    const seen: string[] = [];
    const load = async (node: { encodedScene: string }) => {
      seen.push(node.encodedScene);
      return true;
    };

    comparison.pin("A", lineage.rootId!);
    comparison.pin("B", flatB.node.id);
    await comparison.show("A", load);
    await comparison.show("B", load);
    comparison.pin("B", nonflatA.node.id);
    await comparison.show("B", load);
    comparison.pin("A", nonflatB.node.id);
    await comparison.show("A", load);

    expect(seen).toEqual(["flat-a", "flat-b", "4d-a", "4d-b"]);
    expect(lineage.node(nonflatA.node.id)?.snapshot.transforms[0].w).toEqual({
      position: 0.125,
    });
    expect(lineage.node(nonflatB.node.id)?.snapshot.transforms[0].w).toEqual({
      rotation: { xw: 0.375 },
    });
  });

  it("treats a mesh-budget refusal as a failed display with no graph effects", async () => {
    const { lineage, comparison, rootId, firstId } = branch();
    comparison.pin("A", firstId);

    await expect(comparison.show("A", async () => false)).resolves.toEqual({
      displayed: false,
      reason: "load-failed",
    });
    expect(comparison.activeSlot).toBeNull();
    expect(lineage.currentId).toBe(rootId);
    expect(lineage.size).toBe(3);
  });
});
