/** A pseudo-random number generator returning floats in `[0, 1)`. */
export type Rng = () => number;

/**
 * Deterministic mulberry32 PRNG. Given the same seed it always yields the same
 * sequence, which keeps fractal generation reproducible in tests. The runtime
 * app passes `Math.random` instead for variety between runs.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
