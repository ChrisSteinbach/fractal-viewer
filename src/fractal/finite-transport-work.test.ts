import {
  finiteTransportWorkBytes,
  resolveFiniteTransportChunkPaths,
} from "./finite-transport-work";

describe("finite transport scheduling storage", () => {
  it("allocates one reusable batch rather than one stack per image sample", () => {
    expect(finiteTransportWorkBytes(1)).toBe(2768);
    expect(finiteTransportWorkBytes(4096)).toBe(11_206_688);
  });

  it("rejects capacities that cannot address complete, exactly sized slots", () => {
    for (const capacity of [
      0,
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(() => finiteTransportWorkBytes(capacity)).toThrow(RangeError);
    }
  });

  it("keeps diagnostic uninterrupted execution distinct from the default quantum", () => {
    expect(resolveFiniteTransportChunkPaths()).toBe(2048);
    expect(resolveFiniteTransportChunkPaths(0)).toBe(0);
    expect(resolveFiniteTransportChunkPaths(1)).toBe(1);
    expect(resolveFiniteTransportChunkPaths(0xffffffff)).toBe(0xffffffff);
    for (const quantum of [-1, 0.5, NaN, Infinity, 0x100000000]) {
      expect(() => resolveFiniteTransportChunkPaths(quantum)).toThrow(
        RangeError,
      );
    }
  });
});
