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
