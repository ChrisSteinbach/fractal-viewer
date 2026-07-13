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

/**
 * A per-iteration random stream (fr-2wfw): {@link begin} rewinds it to a
 * deterministic origin for iteration `i`, and {@link draw} then yields that
 * iteration's own reproducible sequence — a counter-based view of
 * {@link mulberry32}, whose per-draw avalanche is what makes seeding by a
 * plain counter sound.
 *
 * Why it exists: the chaos game's ITERATION-LOCAL randomness (a stochastic
 * variation's coin flips, the escape-reseed coordinates) must not ride the
 * same stream as the transform picks. On a shared stream, any difference in
 * how many local draws two ε-different runs make — one escapes where the
 * other doesn't, a weight-boundary pick flip selects a julia-carrying map in
 * one run only — shifts every subsequent pick, re-rolling the entire
 * remaining cloud. Deriving each iteration's local draws from the iteration
 * NUMBER instead makes the pick stream's consumption rigid (exactly one draw
 * per pick) and every local dice roll stable across runs, which is what
 * keeps a morph's pinned-seed point correspondence intact (morph-tween.ts).
 *
 * One object, mutated by `begin` — not a fresh closure per iteration — so
 * the chaos game's hot loop stays allocation-free.
 */
export interface IterationRng {
  /** Rewind the stream to iteration `iteration`'s deterministic origin. */
  begin(iteration: number): void;
  /** Draw the current iteration's next value — a plain {@link Rng}. */
  draw: Rng;
}

/**
 * Create an {@link IterationRng} over `seed`: iteration `i`'s stream is
 * mulberry32 started at `seed + i · φ32` (the golden-ratio odd constant
 * spreads consecutive iterations across the state space; mulberry32's
 * avalanche decorrelates the rest).
 */
export function iterationRng(seed: number): IterationRng {
  const base = seed >>> 0;
  let state = base;
  return {
    begin(iteration: number): void {
      state = (base + Math.imul(iteration | 0, 0x9e3779b9)) | 0;
    },
    draw(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
