import { LruMap } from "./lru-map";

describe("LruMap", () => {
  it("evicts the least-recently-used entry at its hard capacity", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1).set("b", 2).set("c", 3);

    expect([...cache.keys()]).toEqual(["b", "c"]);
    expect(cache.size).toBe(2);
  });

  it("refreshes recency on get and touch", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1).set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect([...cache.keys()]).toEqual(["a", "c"]);

    expect(cache.touch("a")).toBe(true);
    cache.set("d", 4);
    expect([...cache.keys()]).toEqual(["a", "d"]);
    expect(cache.touch("missing")).toBe(false);
  });
});
