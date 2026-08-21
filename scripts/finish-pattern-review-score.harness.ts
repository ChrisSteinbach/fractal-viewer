import {
  FINISH_PATTERN_REVIEW_CHOICES,
  FinishPatternReviewValidationError,
  scoreFinishPatternReview,
  type FinishPatternHeroKind,
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

function makeKey(schema: 1 | 2 = 2) {
  return {
    schema,
    runId: "v3-test",
    decks: Array.from({ length: 5 }, (_, deckIndex) => ({
      deckId: `reviewer-${deckIndex + 1}`,
      cards: HEROES.map((_, cardIndex) => {
        const hero = HEROES[(cardIndex + deckIndex * 2) % HEROES.length];
        return {
          card: `CARD ${String(cardIndex + 1).padStart(2, "0")}`,
          expected: hero.expected,
          system: hero.system,
        };
      }),
    })),
  };
}

function wrongChoice(kind: FinishPatternHeroKind): FinishPatternReviewChoice {
  return kind === "wood" ? "Marble" : "Wood";
}

function makeResults(
  key: ReturnType<typeof makeKey>,
  choiceFor: (
    reviewerIndex: number,
    system: string,
    kind: FinishPatternHeroKind,
  ) => FinishPatternReviewChoice = (_, _system, kind) => expectedChoice[kind],
  confidenceFor: (
    reviewerIndex: number,
    system: string,
    kind: FinishPatternHeroKind,
  ) => number = () => 4,
) {
  return {
    schema: key.schema,
    runId: key.runId,
    status: "complete",
    choices: [...FINISH_PATTERN_REVIEW_CHOICES],
    reviewers: key.decks.map((deck, reviewerIndex) => ({
      reviewerId: `human-${reviewerIndex + 1}`,
      deckId: deck.deckId,
      responses: deck.cards.map((card) => ({
        card: card.card,
        choice: choiceFor(reviewerIndex, card.system, card.expected),
        confidence: confidenceFor(reviewerIndex, card.system, card.expected),
      })),
    })),
  };
}

describe("finish pattern blinded review scorer", () => {
  it("passes exactly at four correct per hero and 80 percent aggregate", () => {
    const key = makeKey();
    const results = makeResults(key, (reviewerIndex, system, kind) => {
      const heroIndex = HEROES.findIndex(
        (hero) => hero.system === system && hero.expected === kind,
      );
      return reviewerIndex === heroIndex % 5
        ? wrongChoice(kind)
        : expectedChoice[kind];
    });

    const score = scoreFinishPatternReview(key, results);

    expect(score.pass).toBe(true);
    expect(score.verdict).toBe("pass");
    expect(score.aggregate).toEqual({
      correct: 36,
      total: 45,
      fraction: 0.8,
      requiredCorrect: 36,
      pass: true,
    });
    expect(score.byHero).toHaveLength(9);
    expect(score.byHero.every((hero) => hero.correct === 4)).toBe(true);
    expect(score.byHero.every((hero) => hero.medianConfidence === 4)).toBe(
      true,
    );
    expect(score.bySystem).toEqual([
      {
        system: "mandelbox-pair",
        correct: 12,
        total: 15,
        fraction: 0.8,
        pass: true,
      },
      {
        system: "menger",
        correct: 12,
        total: 15,
        fraction: 0.8,
        pass: true,
      },
      {
        system: "menger-lens",
        correct: 12,
        total: 15,
        fraction: 0.8,
        pass: true,
      },
    ]);
  });

  it("refuses a hero whose five-response median confidence is below three", () => {
    const key = makeKey();
    const low = [1, 1, 2, 5, 5];
    const results = makeResults(
      key,
      undefined,
      (reviewerIndex, system, kind) =>
        system === "menger" && kind === "marble" ? low[reviewerIndex] : 4,
    );

    const score = scoreFinishPatternReview(key, results);
    const marble = score.byHero.find(
      (hero) => hero.system === "menger" && hero.kind === "marble",
    );

    expect(score.aggregate.correct).toBe(45);
    expect(score.aggregate.pass).toBe(true);
    expect(marble).toMatchObject({
      correct: 5,
      medianConfidence: 2,
      pass: false,
    });
    expect(score.pass).toBe(false);
    expect(score.verdict).toBe("refused");
  });

  it("refuses one under-recognized hero despite a passing aggregate", () => {
    const key = makeKey();
    const results = makeResults(key, (reviewerIndex, system, kind) =>
      system === "menger-lens" && kind === "strata" && reviewerIndex < 2
        ? wrongChoice(kind)
        : expectedChoice[kind],
    );

    const score = scoreFinishPatternReview(key, results);
    const strata = score.byHero.find(
      (hero) => hero.system === "menger-lens" && hero.kind === "strata",
    );

    expect(score.aggregate).toMatchObject({ correct: 43, pass: true });
    expect(strata).toMatchObject({ correct: 3, pass: false });
    expect(score.pass).toBe(false);
  });

  it("rejects a duplicate response before scoring", () => {
    const key = makeKey();
    const results = makeResults(key);
    results.reviewers[0].responses[1].card =
      results.reviewers[0].responses[0].card;

    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      FinishPatternReviewValidationError,
    );
    expect(() => scoreFinishPatternReview(key, results)).toThrowError(
      /duplicate identifier "CARD 01"/,
    );
  });

  it.each([
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
      "unknown card",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.reviewers[0].responses[0].card = "CARD 99";
      },
      /unknown card "CARD 99"/,
    ],
    [
      "non-integer confidence",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.reviewers[0].responses[0].confidence = 2.5;
      },
      /integer from 1 through 5/,
    ],
    [
      "disallowed choice",
      (
        _key: ReturnType<typeof makeKey>,
        results: ReturnType<typeof makeResults>,
      ) => {
        results.reviewers[0].responses[0].choice =
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

  it("accepts the retained schema-1 tuple response shape", () => {
    const key = makeKey(1);
    const objectResults = makeResults(key);
    const tupleResults = {
      ...objectResults,
      reviewers: objectResults.reviewers.map((reviewer) => ({
        ...reviewer,
        responses: reviewer.responses.map(
          (response) =>
            [response.card, response.choice, response.confidence] as const,
        ),
      })),
    };

    expect(scoreFinishPatternReview(key, tupleResults).aggregate.correct).toBe(
      45,
    );
  });
});
