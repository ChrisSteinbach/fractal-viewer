import {
  COLLECTION_CAP,
  COLLECTION_STORAGE_KEY,
  SceneCollection,
} from "./collection";

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

describe("SceneCollection construction", () => {
  it("starts empty when storage has no saved collection", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    expect(collection.size).toBe(0);
    expect(collection.all()).toEqual([]);
  });
});

describe("SceneCollection add", () => {
  it("returns a SavedScene carrying the given encoded, thumbnail, and injected createdAt", () => {
    const collection = new SceneCollection({
      storage: fakeStorage(),
      now: () => 12345,
    });
    const scene = collection.add("v1=scene-a", "data:image/png;base64,aaa");
    expect(scene.encoded).toBe("v1=scene-a");
    expect(scene.thumbnail).toBe("data:image/png;base64,aaa");
    expect(scene.createdAt).toBe(12345);
  });

  it("unshifts new saves to the front, newest-first", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    collection.add("v1=a", "");
    collection.add("v1=b", "");
    expect(collection.all()[0].encoded).toBe("v1=b");
  });

  it("bumps a re-saved encoded scene to the front instead of piling up a duplicate", () => {
    let now = 100;
    const collection = new SceneCollection({
      storage: fakeStorage(),
      now: () => now,
    });
    collection.add("v1=dup", "thumb-1");
    now = 200;
    const second = collection.add("v1=dup", "thumb-2");

    expect(collection.size).toBe(1);
    expect(collection.all()[0].id).toBe(second.id);
    expect(collection.all()[0].thumbnail).toBe("thumb-2");
    expect(collection.all()[0].createdAt).toBe(200);
  });

  it("evicts the oldest entry once saves exceed COLLECTION_CAP", () => {
    const storage = fakeStorage();
    let t = 0;
    const collection = new SceneCollection({ storage, now: () => t++ });
    for (let i = 0; i < COLLECTION_CAP + 1; i++) {
      collection.add(`v1=scene-${i}`, "");
    }
    expect(collection.size).toBe(COLLECTION_CAP);
    expect(collection.all().some((s) => s.encoded === "v1=scene-0")).toBe(
      false,
    );
  });
});

describe("SceneCollection setThumbnail", () => {
  it("replaces the entry's thumbnail and persists it", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    const scene = collection.add("v1=a", "points-picture");

    expect(collection.setThumbnail(scene.id, "flame-picture")).toBe(true);

    const reloaded = new SceneCollection({ storage });
    expect(reloaded.all()[0].thumbnail).toBe("flame-picture");
  });

  it("leaves the entry's id, encoded, createdAt and mode alone", () => {
    const collection = new SceneCollection({
      storage: fakeStorage(),
      now: () => 4242,
    });
    const scene = collection.add("v1=a", "points-picture", "flame");

    collection.setThumbnail(scene.id, "flame-picture");

    expect(collection.all()[0]).toEqual({
      id: scene.id,
      encoded: "v1=a",
      thumbnail: "flame-picture",
      createdAt: 4242,
      mode: "flame",
    });
  });

  it("does not reorder the collection: a corrected entry keeps its place", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    const older = collection.add("v1=a", "");
    collection.add("v1=b", "");

    collection.setThumbnail(older.id, "corrected");

    // Newest-first: the later save stays in front, unlike a re-`add` of the
    // same document, which would bump the corrected entry to the top.
    expect(collection.all().map((s) => s.encoded)).toEqual(["v1=b", "v1=a"]);
  });

  it("reports false and writes nothing when the id is unknown", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    collection.add("v1=a", "points-picture");
    const persisted = storage.store[COLLECTION_STORAGE_KEY];

    expect(collection.setThumbnail("does-not-exist", "flame-picture")).toBe(
      false,
    );
    expect(collection.all()[0].thumbnail).toBe("points-picture");
    expect(storage.store[COLLECTION_STORAGE_KEY]).toBe(persisted);
  });
});

describe("SceneCollection remove", () => {
  it("deletes the entry with the given id and persists the removal", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    const scene = collection.add("v1=a", "");

    collection.remove(scene.id);
    expect(collection.size).toBe(0);

    const reloaded = new SceneCollection({ storage });
    expect(reloaded.size).toBe(0);
  });

  it("is a no-op when the id is not present", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    collection.add("v1=a", "");
    expect(() => collection.remove("does-not-exist")).not.toThrow();
    expect(collection.size).toBe(1);
  });
});

describe("SceneCollection restore", () => {
  it("puts a removed entry back into its newest-first position by createdAt", () => {
    const storage = fakeStorage();
    let t = 0;
    const collection = new SceneCollection({ storage, now: () => t++ });
    collection.add("v1=a", ""); // createdAt 0, oldest
    const middle = collection.add("v1=b", ""); // createdAt 1
    collection.add("v1=c", ""); // createdAt 2, newest

    collection.remove(middle.id);
    expect(collection.all().map((s) => s.encoded)).toEqual(["v1=c", "v1=a"]);

    collection.restore(middle);

    expect(collection.all().map((s) => s.encoded)).toEqual([
      "v1=c",
      "v1=b",
      "v1=a",
    ]);
  });

  it("persists the restored entry: a second collection over the same storage sees it too", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    const scene = collection.add("v1=a", "");
    collection.remove(scene.id);

    collection.restore(scene);

    const reloaded = new SceneCollection({ storage });
    expect(reloaded.all().map((s) => s.encoded)).toEqual(["v1=a"]);
  });

  it("is a no-op when an entry with the same id is already present", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    const scene = collection.add("v1=a", "");

    collection.restore(scene);

    expect(collection.size).toBe(1);
    expect(collection.all()).toEqual([scene]);
  });

  it("evicts the current oldest entry once a restore pushes the collection past COLLECTION_CAP", () => {
    const storage = fakeStorage();
    let t = 0;
    const collection = new SceneCollection({ storage, now: () => t++ });
    const scenes = Array.from({ length: COLLECTION_CAP }, (_, i) =>
      collection.add(`v1=scene-${i}`, ""),
    );
    // The newest of the fill — removing and restoring THIS one (rather than
    // the oldest) proves the eviction drops the collection's current
    // oldest entry, not just the one that was restored.
    const removed = scenes[COLLECTION_CAP - 1];

    collection.remove(removed.id);
    collection.add("v1=extra", ""); // backfills the gap while it was gone
    expect(collection.size).toBe(COLLECTION_CAP);

    collection.restore(removed);

    expect(collection.size).toBe(COLLECTION_CAP);
    expect(
      collection
        .all()
        .some((s) => s.encoded === `v1=scene-${COLLECTION_CAP - 1}`),
    ).toBe(true);
    expect(collection.all().some((s) => s.encoded === "v1=scene-0")).toBe(
      false,
    );
  });
});

describe("SceneCollection persistence", () => {
  it("round-trips through storage: a second collection over the same storage loads the saved scenes newest-first", () => {
    const storage = fakeStorage();
    const first = new SceneCollection({ storage });
    first.add("v1=a", "");
    first.add("v1=b", "");

    const second = new SceneCollection({ storage });
    expect(second.all().map((s) => s.encoded)).toEqual(["v1=b", "v1=a"]);
  });

  it("drops malformed entries while keeping the valid one", () => {
    const storage = fakeStorage({
      [COLLECTION_STORAGE_KEY]: JSON.stringify([
        { id: "1", encoded: "v1=good", thumbnail: "", createdAt: 100 },
        { id: "2", encoded: "v1=bad-missing-fields" },
        { encoded: "v1=bad-missing-id", thumbnail: "", createdAt: 100 },
        {
          id: "3",
          encoded: "v1=bad-created-at",
          thumbnail: "",
          createdAt: "oops",
        },
        "not-an-object",
        null,
      ]),
    });

    const collection = new SceneCollection({ storage });
    expect(collection.size).toBe(1);
    expect(collection.all()[0].encoded).toBe("v1=good");
  });

  it("never throws on garbage JSON and starts empty", () => {
    const storage = fakeStorage({ [COLLECTION_STORAGE_KEY]: "not json{" });
    const collection = new SceneCollection({ storage });
    expect(collection.size).toBe(0);
  });

  it("does not throw when storage.setItem throws (e.g. a full quota), keeping the entry in memory", () => {
    const store: Record<string, string> = {};
    let threw = false;
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (!threw) {
          threw = true;
          const err = new Error("quota exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
        store[k] = v;
      },
    };

    const collection = new SceneCollection({ storage });
    expect(() => collection.add("v1=a", "")).not.toThrow();
    expect(collection.size).toBe(1);
  });
});

describe("SceneCollection persist error handling", () => {
  it("a) recovers from a quota error by evicting the oldest entry, keeps newer entries plus the new save in both memory and storage, and reports the eviction via onEvicted", () => {
    const store: Record<string, string> = {};
    let throwNext = false;
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (throwNext) {
          throwNext = false;
          throw new DOMException("quota exceeded", "QuotaExceededError");
        }
        store[k] = v;
      },
    };
    const onEvicted = vi.fn();
    let t = 0;
    const collection = new SceneCollection({
      storage,
      now: () => t++,
      onEvicted,
    });
    collection.add("v1=oldest", "");
    collection.add("v1=middle", "");

    throwNext = true; // the write this next add triggers fails once, on quota
    collection.add("v1=newest", "");

    expect(onEvicted).toHaveBeenCalledTimes(1);
    expect(onEvicted).toHaveBeenCalledWith(1);
    expect(collection.all().map((s) => s.encoded)).toEqual([
      "v1=newest",
      "v1=middle",
    ]);

    const reloaded = new SceneCollection({ storage });
    expect(reloaded.all().map((s) => s.encoded)).toEqual([
      "v1=newest",
      "v1=middle",
    ]);
  });

  it("b) on a persistent non-quota error, the failed save's entry stays in memory but unpersisted, and storage keeps its last good write rather than being truncated to match memory", () => {
    // Chosen contract (the entry a caller's `add` already returned is not
    // silently undone, but storage is never left worse than its last good
    // write): matches timeline.ts's own persist-failure stance — swallow
    // the failure, keep memory correct, don't shorten anything to "fix" it.
    const store: Record<string, string> = {};
    let disabled = false;
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (disabled)
          throw new DOMException("storage disabled", "SecurityError");
        store[k] = v;
      },
    };
    const collection = new SceneCollection({ storage });
    collection.add("v1=a", "");
    collection.add("v1=b", "");
    const persistedBefore = store[COLLECTION_STORAGE_KEY];

    disabled = true;
    expect(() => collection.add("v1=c", "")).not.toThrow();

    expect(collection.all().map((s) => s.encoded)).toEqual([
      "v1=c",
      "v1=b",
      "v1=a",
    ]);
    expect(store[COLLECTION_STORAGE_KEY]).toBe(persistedBefore);
  });

  it("c) does not call onEvicted on an ordinary successful persist", () => {
    const onEvicted = vi.fn();
    const collection = new SceneCollection({
      storage: fakeStorage(),
      onEvicted,
    });

    const scene = collection.add("v1=a", "");
    collection.remove(scene.id);

    expect(onEvicted).not.toHaveBeenCalled();
  });

  it("d) a later successful persist after a non-quota failure period writes the full list, not the truncated one (the overwrite-with-truncation bug is dead)", () => {
    const store: Record<string, string> = {};
    let disabled = false;
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (disabled)
          throw new DOMException("storage disabled", "SecurityError");
        store[k] = v;
      },
    };
    const collection = new SceneCollection({ storage });
    collection.add("v1=a", "");
    collection.add("v1=b", "");
    const third = collection.add("v1=c", "");

    disabled = true;
    // Several unrelated ops fail to persist while storage is "disabled".
    // Under the old code each failure would evict the in-memory list
    // toward one entry; under the fix a non-quota failure never touches
    // memory, so nothing here shrinks the list.
    collection.setThumbnail(third.id, "corrected-thumb");
    collection.remove("does-not-exist");
    expect(collection.size).toBe(3);

    disabled = false;
    collection.add("v1=d", "");

    const reloaded = new SceneCollection({ storage });
    expect(reloaded.all().map((s) => s.encoded)).toEqual([
      "v1=d",
      "v1=c",
      "v1=b",
      "v1=a",
    ]);
  });

  it("treats a legacy DOMException carrying only the numeric code 22 (no QuotaExceededError name) as a quota error too", () => {
    const store: Record<string, string> = {};
    let throwNext = false;
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (throwNext) {
          throwNext = false;
          const err = new DOMException("disk full", "UnknownError");
          Object.defineProperty(err, "code", { value: 22 });
          throw err;
        }
        store[k] = v;
      },
    };
    const collection = new SceneCollection({ storage });
    collection.add("v1=a", "");
    collection.add("v1=b", "");

    throwNext = true;
    collection.add("v1=c", "");

    // Recovered by evicting the oldest, exactly like the named-error case —
    // proves the `code === 22` arm of `isQuotaError` is load-bearing and
    // not dead beside the `name` check.
    expect(collection.all().map((s) => s.encoded)).toEqual(["v1=c", "v1=b"]);
  });
});

describe("SceneCollection after (the drift show's loop cursor)", () => {
  it("returns null on an empty collection", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    expect(collection.after(null)).toBeNull();
    expect(collection.after("anything")).toBeNull();
  });

  it("null id yields the front (newest) entry — a fresh show's first departure", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    collection.add("v1=older", "");
    const newest = collection.add("v1=newest", "");

    expect(collection.after(null)?.id).toBe(newest.id);
  });

  it("steps through gallery order, newest to oldest", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    const oldest = collection.add("v1=a", "");
    const middle = collection.add("v1=b", "");
    const newest = collection.add("v1=c", "");

    expect(collection.after(newest.id)?.id).toBe(middle.id);
    expect(collection.after(middle.id)?.id).toBe(oldest.id);
  });

  it("wraps past the oldest entry back to the front", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    const oldest = collection.add("v1=a", "");
    const newest = collection.add("v1=b", "");

    expect(collection.after(oldest.id)?.id).toBe(newest.id);
  });

  it("an id deleted mid-show restarts the loop from the front", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    collection.add("v1=a", "");
    const playing = collection.add("v1=b", "");
    const newest = collection.add("v1=c", "");

    collection.remove(playing.id);

    expect(collection.after(playing.id)?.id).toBe(newest.id);
  });

  it("a single-entry collection loops onto itself", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    const only = collection.add("v1=solo", "");

    expect(collection.after(only.id)?.id).toBe(only.id);
  });
});

describe("SceneCollection saved-from mode", () => {
  it("round-trips a flame/solid mode tag through storage", () => {
    const storage = fakeStorage();
    new SceneCollection({ storage }).add("v1=a", "", "flame");

    const reloaded = new SceneCollection({ storage });

    expect(reloaded.all()[0].mode).toBe("flame");
  });

  it("a points save carries no mode, and stores none", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    collection.add("v1=a", "");

    expect(collection.all()[0].mode).toBeUndefined();
    expect(storage.store[COLLECTION_STORAGE_KEY]).not.toContain("mode");
  });

  it("a re-save from a different renderer re-tags the bumped entry", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });
    collection.add("v1=dup", "", "solid");

    collection.add("v1=dup", "");

    expect(collection.size).toBe(1);
    expect(collection.all()[0].mode).toBeUndefined();
  });

  it("a garbage mode from storage drops to undefined without losing the entry", () => {
    const entry = {
      id: "1-0",
      encoded: "v1=a",
      thumbnail: "",
      createdAt: 1,
      mode: "hologram",
    };
    const storage = fakeStorage({
      [COLLECTION_STORAGE_KEY]: JSON.stringify([entry]),
    });

    const collection = new SceneCollection({ storage });

    expect(collection.size).toBe(1);
    expect(collection.all()[0].mode).toBeUndefined();
  });
});

describe("SceneCollection importScenes", () => {
  it("merges new entries into createdAt order among existing entries", () => {
    const storage = fakeStorage();
    let t = 100;
    const collection = new SceneCollection({ storage, now: () => t });
    collection.add("v1=oldest", ""); // createdAt 100
    t = 300;
    collection.add("v1=newest", ""); // createdAt 300

    const imported = collection.importScenes([
      { encoded: "v1=middle", thumbnail: "", createdAt: 200 },
    ]);

    expect(imported).toBe(1);
    expect(collection.all().map((s) => s.encoded)).toEqual([
      "v1=newest",
      "v1=middle",
      "v1=oldest",
    ]);
  });

  it("skips an entry whose encoded already exists, without touching storage", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    collection.add("v1=dup", "original-thumb");
    const setItemSpy = vi.fn(storage.setItem);
    storage.setItem = setItemSpy;

    const imported = collection.importScenes([
      { encoded: "v1=dup", thumbnail: "imported-thumb", createdAt: 999 },
    ]);

    expect(imported).toBe(0);
    expect(collection.size).toBe(1);
    expect(collection.all()[0].thumbnail).toBe("original-thumb");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("skips a duplicate within the batch, keeping only the first", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });

    const imported = collection.importScenes([
      { encoded: "v1=same", thumbnail: "first", createdAt: 100 },
      { encoded: "v1=same", thumbnail: "second", createdAt: 200 },
    ]);

    expect(imported).toBe(1);
    expect(collection.size).toBe(1);
    expect(collection.all()[0].thumbnail).toBe("first");
  });

  it("preserves createdAt, mode, and thumbnail on the imported entry", () => {
    const collection = new SceneCollection({ storage: fakeStorage() });

    collection.importScenes([
      {
        encoded: "v1=solid-scene",
        thumbnail: "data:image/png;base64,xyz",
        createdAt: 4242,
        mode: "solid",
      },
    ]);

    const imported = collection.all()[0];
    expect(imported.createdAt).toBe(4242);
    expect(imported.mode).toBe("solid");
    expect(imported.thumbnail).toBe("data:image/png;base64,xyz");
  });

  it("mints unique ids even when createdAt collides or a fresh instance's counter restarts", () => {
    // Two entries sharing a createdAt in one batch still get distinct ids —
    // the shared per-instance counter disambiguates them.
    const batchCollection = new SceneCollection({ storage: fakeStorage() });
    batchCollection.importScenes([
      { encoded: "v1=same-time-a", thumbnail: "", createdAt: 500 },
      { encoded: "v1=same-time-b", thumbnail: "", createdAt: 500 },
    ]);
    const batchIds = batchCollection.all().map((s) => s.id);
    expect(new Set(batchIds).size).toBe(2);

    // A fresh instance's counter restarts at 0, so its first minted id
    // (`${T}-0`) can collide with an entry already in storage that was
    // minted by a different instance sharing the same createdAt T.
    const storage = fakeStorage();
    const T = 700;
    new SceneCollection({ storage, now: () => T }).add("v1=existing", "");

    const collection = new SceneCollection({ storage });
    const imported = collection.importScenes([
      { encoded: "v1=imported", thumbnail: "", createdAt: T },
    ]);

    expect(imported).toBe(1);
    const ids = collection.all().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("evicts past COLLECTION_CAP and returns only the surviving count", () => {
    const storage = fakeStorage();
    let t = 0;
    const collection = new SceneCollection({ storage, now: () => t });
    for (let i = 0; i < COLLECTION_CAP; i++) {
      t = i + 1; // createdAt 1..COLLECTION_CAP, strictly increasing
      collection.add(`v1=fill-${i}`, "");
    }
    expect(collection.size).toBe(COLLECTION_CAP);

    const staleImported = collection.importScenes([
      { encoded: "v1=too-old", thumbnail: "", createdAt: 0 },
    ]);
    expect(staleImported).toBe(0);
    expect(collection.size).toBe(COLLECTION_CAP);
    expect(collection.all().some((s) => s.encoded === "v1=too-old")).toBe(
      false,
    );

    const freshImported = collection.importScenes([
      { encoded: "v1=newer-1", thumbnail: "", createdAt: 9999 },
      { encoded: "v1=newer-2", thumbnail: "", createdAt: 10000 },
    ]);
    expect(freshImported).toBe(2);
    expect(collection.size).toBe(COLLECTION_CAP);
    expect(collection.all().some((s) => s.encoded === "v1=newer-1")).toBe(true);
    expect(collection.all().some((s) => s.encoded === "v1=newer-2")).toBe(true);
  });

  it("persists the merged list once on success", () => {
    const storage = fakeStorage();
    const collection = new SceneCollection({ storage });
    const setItemSpy = vi.fn(storage.setItem);
    storage.setItem = setItemSpy;

    collection.importScenes([
      { encoded: "v1=one", thumbnail: "", createdAt: 10 },
      { encoded: "v1=two", thumbnail: "", createdAt: 20 },
    ]);

    expect(setItemSpy).toHaveBeenCalledTimes(1);

    const reloaded = new SceneCollection({ storage });
    expect(
      reloaded
        .all()
        .map((s) => s.encoded)
        .sort(),
    ).toEqual(["v1=one", "v1=two"]);
  });
});
