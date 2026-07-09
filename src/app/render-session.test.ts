import { RenderSession } from "./render-session";

/**
 * Models a render session's injected deps as fakes that record the order of
 * every effect RenderSession invokes into a `log` array, so a test can drive
 * the enter/exit/terminate choreography deterministically — no worker, no
 * Three.js. `start` fabricates a fake handle (spied `post` / `terminate`)
 * and keeps it in `handles` so a test can assert on the exact handle a given
 * `enter()` produced; the handle's `terminate` also pushes "terminate" onto
 * the same `log`, so termination ordering is observable alongside the other
 * deps.
 */
function harness(): {
  session: RenderSession<string>;
  log: string[];
  handles: {
    post: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }[];
} {
  const log: string[] = [];
  const handles: {
    post: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }[] = [];
  const session = new RenderSession<string>({
    start: () => {
      const handle = {
        post: vi.fn(),
        terminate: vi.fn(() => log.push("terminate")),
      };
      handles.push(handle);
      log.push("start");
      return handle;
    },
    clearNotes: () => log.push("clearNotes"),
    resetProgress: () => log.push("resetProgress"),
    activate: () => log.push("activate"),
    deactivate: () => log.push("deactivate"),
  });
  return { session, log, handles };
}

describe("RenderSession enter", () => {
  it("enter runs clearNotes → resetProgress → start → activate in order", () => {
    const h = harness();
    h.session.enter();
    expect(h.log).toEqual(["clearNotes", "resetProgress", "start", "activate"]);
  });

  it("a fresh session has no first frame until one is marked", () => {
    const h = harness();
    h.session.enter();
    expect(h.session.hasFirstFrame).toBe(false);

    h.session.markFirstFrame();
    expect(h.session.hasFirstFrame).toBe(true);
  });

  it("re-entering terminates the previous session before starting a new one", () => {
    const h = harness();
    h.session.enter();
    h.session.enter();

    expect(h.handles).toHaveLength(2);
    // The stale first session is torn down defensively...
    expect(h.handles[0].terminate).toHaveBeenCalledTimes(1);
    // ...while the second, being the session now current, is left running.
    expect(h.handles[1].terminate).not.toHaveBeenCalled();
  });

  it("the first enter does not terminate anything", () => {
    const h = harness();
    h.session.enter();

    // There is no PREVIOUS session on the very first enter, so the
    // defensive terminate has nothing to do.
    expect(h.handles[0].terminate).not.toHaveBeenCalled();
    expect(h.log).not.toContain("terminate");
  });

  it("re-entering resets the first-frame gate", () => {
    const h = harness();
    h.session.enter();
    h.session.markFirstFrame();

    h.session.enter();
    expect(h.session.hasFirstFrame).toBe(false);
  });
});

describe("RenderSession post", () => {
  it("post forwards a command to the running session", () => {
    const h = harness();
    h.session.enter();

    h.session.post("cmd");
    expect(h.handles[0].post).toHaveBeenCalledWith("cmd");
  });

  it("post before any enter is a no-op", () => {
    const h = harness();
    // No handle exists yet, so post must tolerate the missing session
    // rather than throw.
    expect(() => h.session.post("x")).not.toThrow();
    expect(h.handles).toHaveLength(0);
  });
});

describe("RenderSession exit", () => {
  it("exit terminates the session, then clears notes and deactivates, in order", () => {
    const h = harness();
    h.session.enter();
    h.log.length = 0; // isolate the exit sequence from enter's own log entries

    h.session.exit();
    expect(h.log).toEqual(["terminate", "clearNotes", "deactivate"]);
  });

  it("exit resets the first-frame gate", () => {
    const h = harness();
    h.session.enter();
    h.session.markFirstFrame();

    h.session.exit();
    expect(h.session.hasFirstFrame).toBe(false);
  });

  it("post after exit is a no-op", () => {
    const h = harness();
    h.session.enter();
    h.session.exit();

    h.session.post("x");
    expect(h.handles[0].post).not.toHaveBeenCalled();
  });

  it("exit with nothing running still clears notes and deactivates, terminating nothing", () => {
    const h = harness();
    h.session.exit();
    // No "terminate" in the log — there was no handle to tear down, and
    // exit must still be safe to call unconditionally (main.ts's undo/redo
    // relies on this).
    expect(h.log).toEqual(["clearNotes", "deactivate"]);
  });
});
