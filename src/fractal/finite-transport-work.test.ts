import {
  FINITE_TRANSPORT_QUANTUM_OFFSET,
  SPHERE_INVERSION_JOINT_STRIDE_OFFSET,
  finiteTransportWorkBytes,
  resolveFiniteTransportChunkPaths,
  sphereInversionJointStride,
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

describe("the joint pool's arena stride", () => {
  it("rounds a raster up to whole 64-ray blocks, so every 4-byte sub-range starts on a 256-byte binding offset", () => {
    expect(sphereInversionJointStride(147_456)).toBe(147_456);
    expect(sphereInversionJointStride(36_864)).toBe(36_864);
    expect(sphereInversionJointStride(1)).toBe(64);
    expect(sphereInversionJointStride(65)).toBe(128);
    expect((sphereInversionJointStride(1920 * 1057) * 4) % 256).toBe(0);
  });

  it("refuses a raster with no rays", () => {
    for (const rays of [0, -64, 0.5, NaN, Infinity]) {
      expect(() => sphereInversionJointStride(rays)).toThrow(RangeError);
    }
  });

  it("rides the header word after the quantum, which the host already rewrites per chunk", () => {
    expect(SPHERE_INVERSION_JOINT_STRIDE_OFFSET).toBe(
      FINITE_TRANSPORT_QUANTUM_OFFSET + 4,
    );
  });
});
