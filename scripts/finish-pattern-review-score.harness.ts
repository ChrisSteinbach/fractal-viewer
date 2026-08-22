import {
  FINISH_PATTERN_REVIEW_CHOICES,
  FinishPatternReviewValidationError,
  scoreFinishPatternReview,
  type FinishPatternHeroKind,
  type FinishPatternOwnerVerdict,
  type FinishPatternReviewChoice,
} from "./finish-pattern-review-score";

const SYSTEMS = ["menger", "mandelbox-pair", "menger-lens"] as const;
const KINDS = ["wood", "marble", "strata"] as const;
const HEROES = SYSTEMS.flatMap((system) =>
  KINDS.map((expected) => ({ system, expected })),
);

const expectedChoice: Readonly<
  Record<
    FinishPatternHeroKind,
    Extract<FinishPatternReviewChoice, "Wood" | "Marble" | "Strata">
  >
> = {
  wood: "Wood",
  marble: "Marble",
  strata: "Strata",
};

function makeKey() {
  return {
    schema: 3 as const,
    runId: "owner-test",
    decks: [
      {
        deckId: "owner-01",
        cards: HEROES.map((_, cardIndex) => {
          const hero = HEROES[(cardIndex * 2) % HEROES.length];
          return {
            card: `CARD ${String(cardIndex + 1).padStart(2, "0")}`,
            expected: hero.expected,
            system: hero.system,
          };
        }),
      },
    ],
  };
}

function makeResults(
  key: ReturnType<typeof makeKey>,
  verdict: FinishPatternOwnerVerdict = "approve",
  choiceFor: (
    system: string,
    kind: FinishPatternHeroKind,
  ) => FinishPatternReviewChoice = (_system, kind) => expectedChoice[kind],
  confidenceFor: (system: string, kind: FinishPatternHeroKind) => number = () =>
    4,
) {
  return {
    schema: 3 as const,
    runId: key.runId,
    status: "complete",
    choices: [...FINISH_PATTERN_REVIEW_CHOICES],
    verdict,
    downgrade:
      verdict === "downgrade-name"
        ? { family: "Marble", replacement: "Veined stone" }
        : null,
    owner: {
      ownerId: "project-owner",
      deckId: key.decks[0].deckId,
      responses: key.decks[0].cards.map((card) => ({
        card: card.card,
        choice: choiceFor(card.system, card.expected),
        confidence: confidenceFor(card.system, card.expected),
      })),
    },
  };
}

describe("finish pattern blinded owner review", () => {
  it("accepts an explicit owner approval and reports recognition as evidence", () => {
    const key = makeKey();
    const results = makeResults(
      key,
      "approve",
      (system, kind) =>
        system === "menger" && kind === "marble"
          ? "Noise-corrosion"
          : expectedChoice[kind],
      (system, kind) => (system === "menger" && kind === "marble" ? 1 : 4),
    );

    const score = scoreFinishPatternReview(key, results);

    expect(score.pass).toBe(true);
    expect(score.verdict).toBe("approve");
    expect(score.downgrade).toBeNull();
    expect(score.recognition).toEqual({
      correct: 8,
      total: 9,
      fraction: 8 / 9,
    });
    expect(score.byHero).toContainEqual({
      system: "menger",
      kind: "marble",
      expected: "Marble",
      choice: "Noise-corrosion",
      confidence: 1,
      recognized: false,
    });
  });

  it.each(["request-changes", "downgrade-name"] as const)(
    "refuses release for an explicit %s verdict",
    (verdict) => {
      const key = makeKey();
      const score = scoreFinishPatternReview(key, makeResults(key, verdict));

      expect(score.pass).toBe(false);
      expect(score.verdict).toBe(verdict);
      expect(score.recognition.correct).toBe(9);
      expect(score.downgrade).toEqual(
        verdict === "downgrade-name"
          ? { family: "Marble", replacement: "Veined stone" }
          : null,
      );
    },
  );

  it("rejects a pending template without a frozen verdict", () => {
    const key = makeKey();
    const results = makeResults(key);
    results.status = "pending";
    results.verdict = null as unknown as FinishPatternOwnerVerdict;

    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /results.status: expected "complete"/,
    );
  });

  it("requires a named family and distinct replacement for a downgrade", () => {
    const key = makeKey();
    const results = makeResults(key, "downgrade-name");
    results.downgrade = { family: "Marble", replacement: "marble" };

    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /replacement: must differ from the current name/,
    );

    results.downgrade = null;
    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /results.downgrade: expected an object/,
    );
  });

  it("rejects downgrade metadata on an approval", () => {
    const key = makeKey();
    const results = makeResults(key);
    results.downgrade = { family: "Wood", replacement: "Timber-like" };

    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /must be null unless verdict is downgrade-name/,
    );
  });

  it("rejects a duplicate response before reporting", () => {
    const key = makeKey();
    const results = makeResults(key);
    results.owner.responses[1].card = results.owner.responses[0].card;

    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      FinishPatternReviewValidationError,
    );
    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /duplicate identifier "CARD 01"/,
    );
  });

  it.each([
    [
      "legacy schema",
      (
        key: ReturnType<typeof makeKey>,
        _results: ReturnType<typeof makeResults>,
      ) => {
        key.schema = 2 as 3;
      },
      /key.schema: expected schema 3/,
    ],
    [
      "multiple decks",
      (
        key: ReturnType<typeof makeKey>,
        _results: ReturnType<typeof makeResults>,
      ) => {
        key.decks.push(structuredClone(key.decks[0]));
      },
      /expected exactly 1 owner deck/,
    ],
    [
      "mismatched run",
      (
        key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.runId = `${key.runId}-wrong`;
      },
      /does not match key run/,
    ],
    [
      "mismatched deck",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.owner.deckId = "owner-99";
      },
      /does not match owner deck/,
    ],
    [
      "unknown card",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.owner.responses[0].card = "CARD 99";
      },
      /unknown card "CARD 99"/,
    ],
    [
      "non-integer confidence",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.owner.responses[0].confidence = 2.5;
      },
      /integer from 1 through 5/,
    ],
    [
      "disallowed choice",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.owner.responses[0].choice =
          "Deliberate banding" as FinishPatternReviewChoice;
      },
      /expected one of Wood, Marble, Strata, Noise-corrosion, Plain-other/,
    ],
  ])("rejects %s", (_name, mutate, expected) => {
    const key = makeKey();
    const results = makeResults(key);
    mutate(key, results);
    expect(() => scoreFinishPatternReview(key, results)).toThrowError(expected);
  });
});
