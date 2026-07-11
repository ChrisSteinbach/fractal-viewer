import { loadViewerPrefs, saveViewerPrefs } from "./viewer-prefs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Plain in-memory Storage double — no real window/jsdom involved. Mirrors
 * collection.test.ts's fake of the same shape. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

// ---------------------------------------------------------------------------
// loadViewerPrefs — absence, malformed input, and strict validation
// ---------------------------------------------------------------------------

describe("loadViewerPrefs", () => {
  it("returns {} when the key is absent", () => {
    const storage = fakeStorage();
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("returns {} for malformed JSON stored under the key", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": "not json{" });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("returns {} when the stored JSON is a quoted string, not an object", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": '"hi"' });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("returns {} when the stored JSON is a bare number, not an object", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": "5" });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("returns {} when the stored JSON is null", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": "null" });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("returns {} when the stored JSON is an array", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": "[1,2]" });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });

  it("drops a non-boolean autoMotion (a string), leaving it undefined", () => {
    const storage = fakeStorage({
      "fractal-viewer:prefs": '{"autoMotion":"yes"}',
    });
    expect(loadViewerPrefs({ storage }).autoMotion).toBeUndefined();
  });

  it("drops a non-boolean autoMotion (a number), leaving it undefined", () => {
    const storage = fakeStorage({ "fractal-viewer:prefs": '{"autoMotion":1}' });
    expect(loadViewerPrefs({ storage }).autoMotion).toBeUndefined();
  });

  it("returns {} when getItem throws instead of propagating", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(loadViewerPrefs({ storage })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// saveViewerPrefs — key, encoding, and write-failure handling
// ---------------------------------------------------------------------------

describe("saveViewerPrefs", () => {
  it("writes to the fractal-viewer:prefs key with the prefs JSON-encoded", () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem };

    saveViewerPrefs({ autoMotion: true }, { storage });

    expect(setItem).toHaveBeenCalledWith(
      "fractal-viewer:prefs",
      JSON.stringify({ autoMotion: true }),
    );
  });

  it("swallows a throwing setItem instead of propagating", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() =>
      saveViewerPrefs({ autoMotion: true }, { storage }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip — save then load through one shared fake storage
// ---------------------------------------------------------------------------

describe("saveViewerPrefs / loadViewerPrefs round-trip", () => {
  it("round-trips { autoMotion: true }", () => {
    const storage = fakeStorage();
    saveViewerPrefs({ autoMotion: true }, { storage });
    expect(loadViewerPrefs({ storage })).toEqual({ autoMotion: true });
  });

  it("round-trips { autoMotion: false }, preserving false rather than treating it as absent", () => {
    const storage = fakeStorage();
    saveViewerPrefs({ autoMotion: false }, { storage });
    expect(loadViewerPrefs({ storage }).autoMotion).toBe(false);
  });

  it("round-trips an empty prefs object", () => {
    const storage = fakeStorage();
    saveViewerPrefs({}, { storage });
    expect(loadViewerPrefs({ storage })).toEqual({});
  });
});
