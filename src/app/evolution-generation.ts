/**
 * Reserve a fixed ordinal lane for every visible child slot. Rejections move
 * only within that slot's lane, so quality or policy changes cannot shift the
 * seeded streams assigned to later siblings.
 */
export function evolutionChildOrdinal(
  baseOrdinal: number,
  cell: number,
  attempt: number,
  attemptsPerCell: number,
): number {
  return baseOrdinal + cell * attemptsPerCell + attempt;
}

/** The first unreserved ordinal after one complete generation pass. */
export function evolutionNextPassOrdinal(
  baseOrdinal: number,
  cells: number,
  attemptsPerCell: number,
): number {
  return baseOrdinal + cells * attemptsPerCell;
}

export type EvolutionMutationAttemptDecision<T> =
  | { readonly kind: "admit"; readonly candidate: T }
  | { readonly kind: "retry"; readonly nextAttempt: number }
  | { readonly kind: "exhausted" };

/** One mutation cell's side-effect boundary. A candidate crosses into lineage
 * ownership only after both strict quality and optional Surface policy admit
 * it; every other attempt either advances within the fixed lane or exhausts
 * without exposing a candidate to lease/node creation. */
export function decideEvolutionMutationAttempt<T>(
  attempt: number,
  attemptsPerCell: number,
  candidate: T | null,
  surfaceAdmitted: boolean,
): EvolutionMutationAttemptDecision<T> {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isSafeInteger(attemptsPerCell) ||
    attemptsPerCell < 1 ||
    attempt >= attemptsPerCell
  ) {
    throw new RangeError("Evolution mutation attempt is outside its cell lane");
  }
  if (candidate !== null && surfaceAdmitted) {
    return { kind: "admit", candidate };
  }
  return attempt + 1 < attemptsPerCell
    ? { kind: "retry", nextAttempt: attempt + 1 }
    : { kind: "exhausted" };
}

/** Retire per-node UI/generation metadata when graph pruning releases nodes.
 * Branch selections whose parent survives but whose chosen child was swept
 * are stale too. Keeping this policy beside ordinal allocation makes the
 * session's auxiliary memory obey the same graph cap as the lineage itself. */
export function pruneEvolutionNodeBookkeeping(
  removedIds: readonly string[],
  nextOrdinals: Map<string, number>,
  chosenBranches: Map<string, string>,
): void {
  const removed = new Set(removedIds);
  for (const id of removed) {
    nextOrdinals.delete(id);
    chosenBranches.delete(id);
  }
  for (const [parentId, childId] of chosenBranches) {
    if (removed.has(childId)) chosenBranches.delete(parentId);
  }
}

/** Stable key for one ordered crossover pair. */
function evolutionCrossoverPairKey(
  primaryDigest: string,
  secondaryDigest: string,
): string {
  return `${primaryDigest}\0${secondaryDigest}`;
}

/** Reserve the next child ordinal for an ordered crossover pair. The map is a
 * bounded LRU cache: switching A/B away and immediately back preserves its
 * stream, while old pairs cannot grow session metadata without limit. A
 * caller-supplied floor reconstructed from retained lineage provenance keeps
 * an evicted successful pair from reusing an admitted child's ordinal. */
export function reserveEvolutionCrossoverOrdinal(
  ordinals: Map<string, number>,
  primaryDigest: string,
  secondaryDigest: string,
  cap: number,
  retainedFloor = 0,
): number {
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new RangeError("Evolution crossover ordinal cache cap is invalid");
  }
  if (
    !Number.isSafeInteger(retainedFloor) ||
    retainedFloor < 0 ||
    Object.is(retainedFloor, -0)
  ) {
    throw new RangeError("Evolution crossover ordinal floor is invalid");
  }
  const key = evolutionCrossoverPairKey(primaryDigest, secondaryDigest);
  const ordinal = Math.max(ordinals.get(key) ?? 0, retainedFloor);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RangeError("Evolution crossover child ordinal is exhausted");
  }
  const next = ordinal + 1;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError("Evolution crossover child ordinal is exhausted");
  }
  // Reinsert to make this the most-recently-used key.
  ordinals.delete(key);
  ordinals.set(key, next);
  while (ordinals.size > cap) {
    const oldest = ordinals.keys().next().value;
    if (oldest === undefined) break;
    ordinals.delete(oldest);
  }
  return ordinal;
}
