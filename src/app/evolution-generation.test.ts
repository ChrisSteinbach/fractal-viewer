import {
  evolutionChildOrdinal,
  evolutionNextPassOrdinal,
} from "./evolution-generation";

describe("Evolution fixed child-ordinal lanes", () => {
  it("keeps later cells and passes stable when one cell retries", () => {
    const trace = [
      evolutionChildOrdinal(0, 0, 0, 8),
      evolutionChildOrdinal(0, 0, 1, 8),
      evolutionChildOrdinal(0, 0, 2, 8),
      evolutionChildOrdinal(0, 1, 0, 8),
    ];

    expect(trace).toEqual([0, 1, 2, 8]);
    const nextCellAfterRetries = trace.at(-1);
    const nextCellAfterImmediateAdmission = evolutionChildOrdinal(0, 1, 0, 8);
    expect(nextCellAfterRetries).toBe(nextCellAfterImmediateAdmission);
    expect(evolutionNextPassOrdinal(0, 8, 8)).toBe(64);
    expect(evolutionChildOrdinal(64, 0, 0, 8)).toBe(64);
  });

  it("exhausts a cell without entering the next cell's lane", () => {
    expect(
      Array.from({ length: 8 }, (_, attempt) =>
        evolutionChildOrdinal(0, 0, attempt, 8),
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(evolutionChildOrdinal(0, 1, 0, 8)).toBe(8);
  });
});
