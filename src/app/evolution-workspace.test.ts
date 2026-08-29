import { describe, expect, it } from "vitest";
import { EvolutionLineage, type LineageNodeInput } from "./evolution-lineage";
import {
  EvolutionWorkspaceSelection,
  promoteEvolutionSelection,
} from "./evolution-workspace";
import { evolutionSceneContentDigest } from "./evolution-crossover";
import { initialState } from "./state";
import { encodeScene, toSnapshot } from "./persist";

function input(scene: string): LineageNodeInput {
  const snapshot = toSnapshot(initialState(true));
  snapshot.transforms[0].position[0] =
    [...scene].reduce((sum, character) => sum + character.charCodeAt(0), 0) /
    10_000;
  return {
    encodedScene: scene,
    snapshot,
    thumbnail: new Uint8ClampedArray([1, 2, 3, 255]),
    seed: 7,
    profile: { algorithm: "test" },
  };
}

function branch(): {
  lineage: EvolutionLineage;
  workspace: EvolutionWorkspaceSelection;
  rootId: string;
  firstId: string;
  secondId: string;
} {
  const lineage = new EvolutionLineage(input("root"));
  const rootId = lineage.rootId!;
  const first = lineage.addMutation(rootId, input("first"));
  const second = lineage.addMutation(rootId, input("second"));
  if (!first.added || !second.added) throw new Error("test graph refused");
  return {
    lineage,
    workspace: new EvolutionWorkspaceSelection(lineage),
    rootId,
    firstId: first.node.id,
    secondId: second.node.id,
  };
}

describe("EvolutionWorkspaceSelection", () => {
  it("moves selection only after a successful exact-document load", async () => {
    const { lineage, workspace, rootId, firstId } = branch();
    let finish!: (loaded: boolean) => void;
    const pending = workspace.select(
      firstId,
      (node) =>
        new Promise<boolean>((resolve) => {
          expect(node.snapshot.transforms.length).toBeGreaterThan(0);
          finish = resolve;
        }),
    );

    expect(lineage.currentId).toBe(rootId);
    finish(true);
    await expect(pending).resolves.toMatchObject({ selected: true });
    expect(lineage.currentId).toBe(firstId);
    expect(lineage.preferredChildId(rootId)).toBe(firstId);
  });

  it("hands the loader the owned unrounded snapshot, not the encoded key", async () => {
    const lineage = new EvolutionLineage(input("root"));
    const exact = toSnapshot(initialState(true));
    exact.transforms[0].position[0] = 0.123456789;
    const added = lineage.addMutation(lineage.rootId!, {
      ...input("rounded-wire"),
      snapshot: exact,
    });
    if (!added.added) throw new Error("test graph refused");
    exact.transforms[0].position[0] = 9;
    const workspace = new EvolutionWorkspaceSelection(lineage);

    await workspace.select(added.node.id, async (node) => {
      expect(node.encodedScene).toBe("rounded-wire");
      expect(node.snapshot.transforms[0].position[0]).toBe(0.123456789);
      return true;
    });
  });

  it("leaves selection unchanged when loading fails", async () => {
    const { lineage, workspace, rootId, firstId } = branch();

    await expect(workspace.select(firstId, async () => false)).resolves.toEqual(
      { selected: false, reason: "load-failed" },
    );
    expect(lineage.currentId).toBe(rootId);
  });

  it("lets only the latest rapid request commit selection", async () => {
    const { lineage, workspace, firstId, secondId } = branch();
    const finishes = new Map<string, (loaded: boolean) => void>();
    const load = (node: { encodedScene: string }) =>
      new Promise<boolean>((resolve) =>
        finishes.set(node.encodedScene, resolve),
      );

    const first = workspace.select(firstId, load);
    const second = workspace.select(secondId, load);
    finishes.get("second")!(true);
    await expect(second).resolves.toMatchObject({ selected: true });
    finishes.get("first")!(true);
    await expect(first).resolves.toEqual({
      selected: false,
      reason: "superseded",
    });
    expect(lineage.currentId).toBe(secondId);
  });

  it("reconciles undo/redo to an exact retained document", async () => {
    const { lineage, workspace, firstId, secondId } = branch();
    await workspace.select(firstId, async () => true);

    const result = workspace.reconcile(lineage.node(secondId)!.contentDigest);

    expect(result).toMatchObject({ attached: true, node: { id: secondId } });
    expect(lineage.currentId).toBe(secondId);
    expect(workspace.detached).toBe(false);
  });

  it("reconciliation does not rewrite lineage back/forward history", () => {
    const { lineage, workspace, rootId, firstId, secondId } = branch();
    lineage.visitBranch(firstId);
    expect(lineage.back()?.id).toBe(rootId);

    workspace.reconcile(lineage.node(secondId)!.contentDigest);

    expect(lineage.forward()?.id).toBe(firstId);
  });

  it("visibly detaches on an unknown outside edit without lying about selection", async () => {
    const { lineage, workspace, firstId } = branch();
    await workspace.select(firstId, async () => true);
    const outside = toSnapshot(initialState(true));
    outside.transforms[0].position[0] = 9;

    expect(workspace.reconcile(evolutionSceneContentDigest(outside))).toEqual({
      attached: false,
    });
    expect(workspace.detached).toBe(true);
    expect(lineage.currentId).toBe(firstId);
  });

  it("reattaches after a new root reset", () => {
    const { lineage, workspace } = branch();
    const outside = toSnapshot(initialState(true));
    outside.transforms[0].position[0] = 9;
    workspace.reconcile(evolutionSceneContentDigest(outside));
    const root = lineage.reset(input("new-root"));

    workspace.noteReset();

    expect(workspace.detached).toBe(false);
    expect(lineage.currentId).toBe(root.id);
  });

  it("promotes only the selected scene and leaves lineage untouched", async () => {
    const { lineage, workspace, firstId } = branch();
    await workspace.select(firstId, async () => true);
    const before = lineage.all().map((node) => node.id);
    const saved: string[] = [];

    expect(
      promoteEvolutionSelection(lineage, workspace, (encoded) =>
        saved.push(encoded),
      ),
    ).toBe(true);
    expect(saved).toEqual([lineage.node(firstId)!.encodedScene]);
    expect(lineage.all().map((node) => node.id)).toEqual(before);
    expect(lineage.currentId).toBe(firstId);

    workspace.noteOutsideEdit();
    expect(
      promoteEvolutionSelection(lineage, workspace, (encoded) =>
        saved.push(encoded),
      ),
    ).toBe(false);
    expect(saved).toHaveLength(1);
  });

  it("distinguishes exact documents that collide on the rounded portable wire", async () => {
    const rootSnapshot = toSnapshot(initialState(true));
    rootSnapshot.transforms[0].position[0] = 0.123456789;
    const childSnapshot = toSnapshot(initialState(true));
    childSnapshot.transforms[0].position[0] = 0.12345679;
    expect(encodeScene(rootSnapshot)).toBe(encodeScene(childSnapshot));

    const lineage = new EvolutionLineage({
      ...input("root"),
      encodedScene: encodeScene(rootSnapshot),
      snapshot: rootSnapshot,
    });
    const child = lineage.addMutation(lineage.rootId!, {
      ...input("child"),
      encodedScene: encodeScene(childSnapshot),
      snapshot: childSnapshot,
    });
    if (!child.added) throw new Error("test graph refused");
    const workspace = new EvolutionWorkspaceSelection(lineage);

    expect(
      workspace.reconcile(evolutionSceneContentDigest(childSnapshot)),
    ).toMatchObject({ attached: true, node: { id: child.node.id } });

    const outsideEdit = structuredClone(childSnapshot);
    outsideEdit.transforms[0].position[0] = 0.123456791;
    expect(encodeScene(outsideEdit)).toBe(child.node.encodedScene);
    expect(
      workspace.reconcile(evolutionSceneContentDigest(outsideEdit)),
    ).toEqual({ attached: false });
    expect(lineage.currentId).toBe(child.node.id);
  });

  it("can attach or detach display state without moving graph selection", () => {
    const { lineage, workspace, rootId } = branch();

    workspace.noteOutsideEdit();
    expect(workspace.detached).toBe(true);
    expect(lineage.currentId).toBe(rootId);

    workspace.noteSelectionDisplayed();
    expect(workspace.detached).toBe(false);
    expect(lineage.currentId).toBe(rootId);
  });
});
