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
