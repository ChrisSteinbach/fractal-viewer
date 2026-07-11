import { SceneHistory } from "./history";
import type { CameraPose } from "./orbit";

describe("SceneHistory undo", () => {
  it("returns null when nothing has been checkpointed", () => {
    const history = new SceneHistory();
    expect(history.undo("a")).toBeNull();
  });

  it("returns the checkpointed snapshot", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    expect(history.undo("b")?.snapshot).toBe("a");
  });

  it("pushes the current snapshot onto the redo stack", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.undo("b");
    expect(history.redo("a")?.snapshot).toBe("b");
  });

  it("skips a top entry that already equals current, undoing to the entry beneath it", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.checkpoint("b", false);
    // The live state is "b", the same as the top of the stack — a genuine
    // undo must land on "a", not hand back the state already on screen.
    expect(history.undo("b")?.snapshot).toBe("a");
  });
});

describe("SceneHistory redo", () => {
  it("returns null when there is nothing to redo", () => {
    const history = new SceneHistory();
    expect(history.redo("a")).toBeNull();
  });
});

describe("SceneHistory checkpoint", () => {
  it("clears the redo stack", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.undo("b");
    expect(history.canRedo).toBe(true);

    history.checkpoint("c", false);
    expect(history.canRedo).toBe(false);
  });

  it("dedupes a checkpoint matching the current top instead of pushing a new step", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.checkpoint("a", true);

    // Only ever one step: after a single undo, there is nothing left.
    const entry = history.undo("b");
    expect(entry?.snapshot).toBe("a");
    expect(history.canUndo).toBe(false);
  });

  it("updates the deduped entry's replaced flag rather than discarding it", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.checkpoint("a", true);
    expect(history.undo("b")?.replaced).toBe(true);
  });

  it("evicts the oldest entry once checkpoints exceed the cap", () => {
    const history = new SceneHistory(3);
    history.checkpoint("a", false);
    history.checkpoint("b", false);
    history.checkpoint("c", false);
    history.checkpoint("d", false);

    const steps: string[] = [];
    let current = "e";
    for (
      let entry = history.undo(current);
      entry;
      entry = history.undo(current)
    ) {
      steps.push(entry.snapshot);
      current = entry.snapshot;
    }
    // "a" fell off the front of the cap-3 stack, so only three steps remain.
    expect(steps).toEqual(["d", "c", "b"]);
  });
});

describe("SceneHistory replaced flag", () => {
  it("travels from checkpoint through undo", () => {
    const history = new SceneHistory();
    history.checkpoint("s0", true);
    expect(history.undo("s1")?.replaced).toBe(true);
  });

  it("travels from undo through redo", () => {
    const history = new SceneHistory();
    history.checkpoint("s0", true);
    history.undo("s1");
    expect(history.redo("s0")?.replaced).toBe(true);
  });
});

describe("SceneHistory canUndo / canRedo", () => {
  it("both start false", () => {
    const history = new SceneHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("canUndo becomes true after a checkpoint", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    expect(history.canUndo).toBe(true);
  });

  it("canUndo becomes false and canRedo true once the only step is undone", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.undo("b");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("canRedo becomes false and canUndo true again once redone", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false);
    history.undo("b");
    history.redo("a");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });
});

describe("SceneHistory camera pose (fr-uf3)", () => {
  const poseA: CameraPose = {
    target: [1, 0, 0],
    radius: 10,
    theta: 0,
    phi: 1,
  };
  const poseB: CameraPose = {
    target: [2, 0, 0],
    radius: 20,
    theta: 0.5,
    phi: 1,
  };
  const poseC: CameraPose = {
    target: [3, 0, 0],
    radius: 30,
    theta: 1,
    phi: 1,
  };

  it("a checkpoint's pose travels back through undo", () => {
    const history = new SceneHistory();
    history.checkpoint("a", true, poseA);
    // The popped entry carries the framing "a" was checkpointed with.
    expect(history.undo("b", poseB)?.pose).toBe(poseA);
  });

  it("undo parks the current pose so a later redo can restore it", () => {
    const history = new SceneHistory();
    history.checkpoint("a", true, poseA);
    history.undo("b", poseB); // parks "b" with poseB on the redo stack
    const redone = history.redo("a", poseA);
    expect(redone?.snapshot).toBe("b");
    expect(redone?.pose).toBe(poseB);
  });

  it("a pose survives a full undo -> redo -> undo cycle", () => {
    const history = new SceneHistory();
    history.checkpoint("a", true, poseA);
    history.undo("b", poseB);
    history.redo("a", poseA);
    expect(history.undo("b", poseB)?.pose).toBe(poseA);
  });

  it("a deduped checkpoint refreshes the top entry's pose as well as its flag", () => {
    const history = new SceneHistory();
    history.checkpoint("a", false, poseA);
    history.checkpoint("a", true, poseB); // same snapshot -> refresh in place
    const entry = history.undo("b", poseC);
    expect(entry?.replaced).toBe(true);
    expect(entry?.pose).toBe(poseB);
  });

  it("a pose-less checkpoint leaves the entry's pose undefined", () => {
    const history = new SceneHistory();
    history.checkpoint("a", true);
    expect(history.undo("b")?.pose).toBeUndefined();
  });
});
