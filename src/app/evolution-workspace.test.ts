import { describe, expect, it } from "vitest";
import { EvolutionLineage, type LineageNodeInput } from "./evolution-lineage";
import { EvolutionWorkspaceSelection } from "./evolution-workspace";
import { initialState } from "./state";
import { toSnapshot } from "./persist";

function input(scene: string): LineageNodeInput {
  return {
    encodedScene: scene,
    snapshot: toSnapshot(initialState(true)),
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

    const result = workspace.reconcile("second");

    expect(result).toMatchObject({ attached: true, node: { id: secondId } });
    expect(lineage.currentId).toBe(secondId);
    expect(workspace.detached).toBe(false);
  });

  it("reconciliation does not rewrite lineage back/forward history", () => {
    const { lineage, workspace, rootId, firstId } = branch();
    lineage.visitBranch(firstId);
    expect(lineage.back()?.id).toBe(rootId);

    workspace.reconcile("second");

    expect(lineage.forward()?.id).toBe(firstId);
  });

  it("visibly detaches on an unknown outside edit without lying about selection", async () => {
    const { lineage, workspace, firstId } = branch();
    await workspace.select(firstId, async () => true);

    expect(workspace.reconcile("outside-edit")).toEqual({ attached: false });
    expect(workspace.detached).toBe(true);
    expect(lineage.currentId).toBe(firstId);
  });

  it("reattaches after a new root reset", () => {
    const { lineage, workspace } = branch();
    workspace.reconcile("outside-edit");
    const root = lineage.reset(input("new-root"));

    workspace.noteReset();

    expect(workspace.detached).toBe(false);
    expect(lineage.currentId).toBe(root.id);
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
