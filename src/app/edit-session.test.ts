import { EditSession } from "./edit-session";

/**
 * Models the app's moving scene-document state as a plain string and records
 * every effect EditSession invokes through its injected deps, so a test can
 * drive the burst/save/undo choreography deterministically — no persist.ts,
 * no DOM, no real clock. `fireSave` fires whatever debounce is currently
 * armed (the 300 ms save timer in the app); `current`/`setScene` stand in for
 * reading and mutating the app's live `state`.
 */
function harness(): {
  session: EditSession;
  persisted: string[];
  restored: { snapshot: string; replaced: boolean }[];
  undoRedo: [boolean, boolean][];
  setScene: (next: string) => void;
  current: () => string;
  fireSave: () => void;
  savePending: () => boolean;
} {
  let current = "s0";
  const persisted: string[] = [];
  const restored: { snapshot: string; replaced: boolean }[] = [];
  const undoRedo: [boolean, boolean][] = [];
  let pending: (() => void) | null = null;
  const session = new EditSession({
    snapshot: () => current,
    persist: () => persisted.push(current),
    restore: (snapshot, replaced) => {
      restored.push({ snapshot, replaced });
      current = snapshot;
    },
    syncUi: (canUndo, canRedo) => undoRedo.push([canUndo, canRedo]),
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
