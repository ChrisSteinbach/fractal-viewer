import {
  consumeIsolationHandoff,
  saveIsolationHandoff,
} from "./isolation-handoff";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Plain in-memory Storage double — no real window/jsdom involved. Mirrors
 * viewer-prefs.test.ts's fake of the same shape, plus `removeItem` for the
 * read-and-clear contract `consumeIsolationHandoff` needs. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("saveIsolationHandoff / consumeIsolationHandoff round-trip", () => {
  it("round-trips a saved render mode through save then consume", () => {
    const storage = fakeStorage();
    saveIsolationHandoff({ renderMode: "flame" }, { storage });
    expect(consumeIsolationHandoff({ storage })).toEqual({
      renderMode: "flame",
    });
  });
});

// ---------------------------------------------------------------------------
// consumeIsolationHandoff — clearing, absence, and malformed input
// ---------------------------------------------------------------------------

describe("consumeIsolationHandoff", () => {
  it("clears the entry on consume, so a second consume returns null", () => {
    const storage = fakeStorage();
    saveIsolationHandoff({ renderMode: "solid" }, { storage });

    expect(consumeIsolationHandoff({ storage })).toEqual({
      renderMode: "solid",
    });
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });

  it("returns null when nothing was ever stored", () => {
    const storage = fakeStorage();
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });

  it("returns null and clears a malformed (non-JSON) entry, so it can't wedge later loads", () => {
    const storage = fakeStorage({
      "fractal-viewer:isolation-handoff": "not json{",
    });

    expect(consumeIsolationHandoff({ storage })).toBeNull();
    expect(storage.store["fractal-viewer:isolation-handoff"]).toBeUndefined();
  });

  it("rejects an unknown render-mode string", () => {
    const storage = fakeStorage({
      "fractal-viewer:isolation-handoff": '{"renderMode":"wireframe"}',
    });
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });

  it("rejects a non-object payload (an array)", () => {
    const storage = fakeStorage({
      "fractal-viewer:isolation-handoff": '["flame"]',
    });
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });

  it("rejects a non-object payload (a bare number)", () => {
    const storage = fakeStorage({
      "fractal-viewer:isolation-handoff": "5",
    });
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });

  it("returns null when getItem throws instead of propagating", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(consumeIsolationHandoff({ storage })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveIsolationHandoff — write-failure handling
// ---------------------------------------------------------------------------

describe("saveIsolationHandoff", () => {
  it("does not throw when setItem throws", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() =>
      saveIsolationHandoff({ renderMode: "flame" }, { storage }),
    ).not.toThrow();
  });
});
