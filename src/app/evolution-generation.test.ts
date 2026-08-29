import {
  decideEvolutionMutationAttempt,
  evolutionChildOrdinal,
  evolutionNextPassOrdinal,
  pruneEvolutionNodeBookkeeping,
  reserveEvolutionCrossoverOrdinal,
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

  it("exposes no candidate after strict quality or Surface exhaustion", () => {
    for (const rejection of ["quality", "surface"] as const) {
      let admitted = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const decision = decideEvolutionMutationAttempt(
          attempt,
          8,
          rejection === "quality" ? null : { id: "candidate" },
          rejection !== "surface",
        );
        if (decision.kind === "admit") admitted = true;
        if (attempt < 7) {
          expect(decision).toEqual({
            kind: "retry",
            nextAttempt: attempt + 1,
          });
        } else {
          expect(decision).toEqual({ kind: "exhausted" });
        }
      }
      expect(admitted).toBe(false);
    }
    expect(
      decideEvolutionMutationAttempt(0, 8, { id: "candidate" }, true),
    ).toEqual({ kind: "admit", candidate: { id: "candidate" } });
  });
});

describe("Evolution bounded session bookkeeping", () => {
  it("retires ordinal and branch entries for every swept node", () => {
    const ordinals = new Map<string, number>();
    const branches = new Map<string, string>();
    for (let index = 0; index < 10_000; index += 1) {
      const parent = `parent-${String(index)}`;
      const child = `child-${String(index)}`;
      ordinals.set(parent, index);
      ordinals.set(child, index);
      branches.set(parent, child);
      pruneEvolutionNodeBookkeeping([parent, child], ordinals, branches);
    }
    expect(ordinals.size).toBe(0);
    expect(branches.size).toBe(0);

    ordinals.set("root", 1);
    branches.set("root", "removed-child");
    pruneEvolutionNodeBookkeeping(["removed-child"], ordinals, branches);
    expect([...ordinals]).toEqual([["root", 1]]);
    expect(branches.size).toBe(0);
  });

  it("keeps recent crossover counters bounded without resetting on an A/B round trip", () => {
    const ordinals = new Map<string, number>();
    expect(reserveEvolutionCrossoverOrdinal(ordinals, "a", "b", 64)).toBe(0);
    expect(reserveEvolutionCrossoverOrdinal(ordinals, "c", "d", 64)).toBe(0);
    expect(reserveEvolutionCrossoverOrdinal(ordinals, "a", "b", 64)).toBe(1);

    for (let index = 0; index < 10_000; index += 1) {
      const first = `digest-a-${String(index)}`;
      const second = `digest-b-${String(index)}`;
      expect(
        reserveEvolutionCrossoverOrdinal(ordinals, first, second, 64),
      ).toBe(0);
      expect(ordinals.size).toBeLessThanOrEqual(64);
    }
    expect(reserveEvolutionCrossoverOrdinal(ordinals, "a", "b", 64, 6)).toBe(6);
  });
});
