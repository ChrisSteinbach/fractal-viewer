import { EditSession } from "./edit-session";
import type { FourDPose } from "./four-d-view";
import type { ViewPose } from "./history";

/**
 * Models the app's moving scene-document state as a plain string and records
 * every effect EditSession invokes through its injected deps, so a test can
 * drive the burst/save/undo choreography deterministically — no persist.ts,
 * no DOM, no real clock. `fireSave` fires whatever debounce is currently
 * armed (the 300 ms save timer in the app); `current`/`setScene` stand in for
 * reading and mutating the app's live `state`; `currentPose`/`setPose` stand
 * in for the live view pose — since fr-gq99 the whole view framing, the orbit
 * camera (fr-uf3) plus, for a non-flat system, the 4D rotor/slice half, not
 * just the camera. `restore` mirrors main.ts: only a cross-replace step moves
 * the camera, so only then does the modelled live pose follow the restored
 * entry.
 */
function harness(): {
  session: EditSession;
  persisted: string[];
  restored: { snapshot: string; replaced: boolean; pose?: ViewPose }[];
  undoRedo: [boolean, boolean][];
  setScene: (next: string) => void;
  setPose: (next: ViewPose) => void;
  current: () => string;
  fireSave: () => void;
  savePending: () => boolean;
} {
  let current = "s0";
  let currentPose: ViewPose = {
    camera: { target: [0, 0, 0], radius: 8, theta: 0, phi: 1 },
  };
  const persisted: string[] = [];
  const restored: {
    snapshot: string;
    replaced: boolean;
    pose?: ViewPose;
  }[] = [];
  const undoRedo: [boolean, boolean][] = [];
  let pending: (() => void) | null = null;
  const session = new EditSession({
    snapshot: () => current,
    persist: () => persisted.push(current),
    restore: (snapshot, replaced, pose) => {
      restored.push({ snapshot, replaced, pose });
      current = snapshot;
      // Mirror main.ts's restoreSnapshot: only a cross-replace step moves the
      // camera, so only then does the live pose follow the restored entry.
      if (replaced && pose) currentPose = pose;
    },
    syncUi: (canUndo, canRedo) => undoRedo.push([canUndo, canRedo]),
    pose: () => currentPose,
    schedule: (fn) => {
      pending = fn;
      return () => {
        if (pending === fn) pending = null;
      };
    },
  });
  return {
    session,
    persisted,
    restored,
    undoRedo,
    setScene: (next: string) => {
      current = next;
    },
    setPose: (next: ViewPose) => {
      currentPose = next;
    },
    current: () => current,
    fireSave: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    savePending: () => pending !== null,
  };
}

describe("EditSession burst coalescing", () => {
  it("a slider-drag burst coalesces to one undo step", () => {
    const h = harness();
    h.session.beginEdit();
    h.setScene("s1");
    h.session.beginEdit();
    h.setScene("s2");
    h.session.beginEdit();
    h.setScene("s3");
    h.fireSave();

    h.session.undo();

    // Three edits in one burst produced exactly one checkpoint ("s0"), so a
    // single undo lands all the way back at the pre-burst state and leaves
    // nothing further to undo.
    expect(h.current()).toBe("s0");
    expect(h.session.canUndo).toBe(false);
  });

  it("undo mid-burst settles the burst first", () => {
    const h = harness();
    h.session.beginEdit();
    h.setScene("s1");
    expect(h.savePending()).toBe(true);

    h.session.undo();

    // The open burst was flushed to its own persisted step rather than lost,
    // and the undo still lands behind the checkpoint the burst opened with.
    expect(h.persisted).toContain("s1");
    expect(h.current()).toBe("s0");

    h.session.redo();
    expect(h.current()).toBe("s1");
  });
});

describe("EditSession replace", () => {
  it("'replace' cuts a checkpoint even mid-burst", () => {
    const h = harness();
    h.session.beginEdit(); // checkpoints "s0"
    h.setScene("s1");
    h.session.beginEdit("replace"); // checkpoints "s1", tagged replaced
    h.setScene("s2");
    h.fireSave();

    h.session.undo();
    expect(h.current()).toBe("s1");
    expect(h.restored[h.restored.length - 1].replaced).toBe(true);

    // A second undo proves the replace cut its OWN step on top of the
    // burst's leading-edge checkpoint, rather than reusing/replacing it.
    h.session.undo();
    expect(h.current()).toBe("s0");
  });
});

describe("EditSession view pose across a replace (fr-uf3, fr-gq99)", () => {
  const poseS0: ViewPose = {
    camera: { target: [0, 0, 0], radius: 10, theta: 0, phi: 1 },
  };
  const poseS1: ViewPose = {
    camera: { target: [1, 1, 1], radius: 20, theta: 0.5, phi: 1.2 },
  };
  const fourD: FourDPose = {
    pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
    sliceOn: true,
    sliceCenter: 0.25,
    sliceRelColor: false,
  };
  // Same camera halves as poseS0/poseS1, but pose4D also carries a 4D half
  // (viewing a non-flat system) while poseFlat has none (the replace landed flat).
  const pose4D: ViewPose = { camera: poseS0.camera, fourD };
  const poseFlat: ViewPose = { camera: poseS1.camera };

  it("undo across a replace restores the checkpoint's captured pose, not the current framing", () => {
    const h = harness();
    h.setPose(poseS0); // viewing s0 with poseS0
    h.session.beginEdit("replace"); // checkpoints s0 tagged replaced, captures poseS0
    h.setScene("s1");
    h.setPose(poseS1); // user reframes while viewing s1
    h.fireSave();

    h.session.undo();
    const last = h.restored[h.restored.length - 1];
    expect(last.snapshot).toBe("s0");
    expect(last.replaced).toBe(true);
    // The exact pre-replace framing comes back — NOT poseS1, the framing left behind.
    expect(last.pose).toBe(poseS0);
  });

  it("redo restores the framing the replaced state was parked with at undo time", () => {
    const h = harness();
    h.setPose(poseS0);
    h.session.beginEdit("replace");
    h.setScene("s1");
    h.setPose(poseS1);
    h.fireSave();

    h.session.undo(); // parks s1 with poseS1 on the redo stack
    h.session.redo();
    const last = h.restored[h.restored.length - 1];
    expect(last.snapshot).toBe("s1");
    expect(last.pose).toBe(poseS1);
  });

  it("a full undo/redo/undo cycle keeps returning to each state's captured pose", () => {
    const h = harness();
    h.setPose(poseS0);
    h.session.beginEdit("replace");
    h.setScene("s1");
    h.setPose(poseS1);
    h.fireSave();

    h.session.undo(); // s0 / poseS0
    h.session.redo(); // s1 / poseS1
    h.session.undo(); // s0 / poseS0 again
    const last = h.restored[h.restored.length - 1];
    expect(last.snapshot).toBe("s0");
    expect(last.pose).toBe(poseS0);
  });

  it("a tweak undo carries replaced=false, so the app leaves the camera alone", () => {
    const h = harness();
    h.setPose(poseS0);
    h.session.beginEdit(); // a tweak, not a replace
    h.setScene("s1");
    h.setPose(poseS1);
    h.fireSave();

    h.session.undo();
    const last = h.restored[h.restored.length - 1];
    expect(last.snapshot).toBe("s0");
    // replaced=false is the signal main.ts's restoreSnapshot uses to leave the
    // live camera untouched for an ordinary parameter edit.
    expect(last.replaced).toBe(false);
  });

  it("undo across a replace restores the checkpoint's captured 4D pose, not the current one (fr-gq99)", () => {
    const h = harness();
    h.setPose(pose4D); // viewing a non-flat system
    h.session.beginEdit("replace"); // checkpoints s0 tagged replaced, captures pose4D
    h.setScene("s1");
    h.setPose(poseFlat); // the replace landed flat
    h.fireSave();

    h.session.undo();
    const last = h.restored[h.restored.length - 1];
    expect(last.replaced).toBe(true);
    expect(last.pose).toBe(pose4D);
    // The pre-replace 4D rotor/slice comes back too, not just the camera.
    expect(last.pose?.fourD).toBe(fourD);
  });

  it("redo hands back the parked pose's missing 4D half as absent (fr-gq99)", () => {
    const h = harness();
    h.setPose(pose4D);
    h.session.beginEdit("replace");
    h.setScene("s1");
    h.setPose(poseFlat);
    h.fireSave();

    h.session.undo(); // parks s1 with poseFlat (no 4D half) on the redo stack
    h.session.redo();
    const last = h.restored[h.restored.length - 1];
    expect(last.snapshot).toBe("s1");
    // The flat state was parked with no 4D half, so redo hands back exactly that.
    expect(last.pose?.fourD).toBeUndefined();
  });
});

describe("EditSession restore", () => {
  it("restore never checkpoints", () => {
    const h = harness();
    h.session.beginEdit();
    h.setScene("s1");
    h.fireSave();

    h.session.undo();
    // Restoring "s0" must not have pushed a phantom checkpoint of its own.
    expect(h.session.canUndo).toBe(false);

    // The bare debounced save the restore armed is still live.
    h.fireSave();
    expect(h.persisted[h.persisted.length - 1]).toBe("s0");
  });

  it("redo after an undo restores the redone state", () => {
    const h = harness();
    h.session.beginEdit();
    h.setScene("s1");
    h.fireSave();

    h.session.undo();
    expect(h.current()).toBe("s0");

    h.session.redo();
    expect(h.current()).toBe("s1");
  });
});

describe("EditSession flush", () => {
  it("flush persists the current document and closes the burst", () => {
    const h = harness();
    h.session.beginEdit();
    h.setScene("s1");

    h.session.flush();

    expect(h.persisted[h.persisted.length - 1]).toBe("s1");
    expect(h.savePending()).toBe(false);

    // The burst is closed, so the next beginEdit() cuts a NEW checkpoint at
    // the flush-time state rather than folding into the old (now-closed)
    // burst — proven by undoing back to it.
    h.session.beginEdit();
    h.setScene("s2");
    h.fireSave();
    h.session.undo();
    expect(h.current()).toBe("s1");
  });
});

describe("EditSession syncUi", () => {
  it("syncUi reports availability", () => {
    const h = harness();
    h.session.syncUi();
    expect(h.undoRedo[h.undoRedo.length - 1]).toEqual([false, false]);

    h.session.beginEdit();
    h.setScene("s1");
    h.fireSave();

    expect(h.session.canUndo).toBe(true);
  });
});
