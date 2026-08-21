/**
 * Pure validator and scorer for the finish-pattern blinded semantic gate.
 *
 * The renderer emits one independently shuffled key deck per reviewer. This
 * module deliberately accepts parsed JSON as `unknown`: malformed or partial
 * review data must be refused before it can accidentally approve a material.
 */

export const FINISH_PATTERN_REVIEWERS = 5;
export const FINISH_PATTERN_CARDS_PER_REVIEWER = 9;
export const FINISH_PATTERN_HERO_CORRECT_MIN = 4;
export const FINISH_PATTERN_HERO_MEDIAN_CONFIDENCE_MIN = 3;
export const FINISH_PATTERN_AGGREGATE_MIN = 0.8;

export const FINISH_PATTERN_REVIEW_CHOICES = [
  "Wood",
  "Marble",
  "Strata",
  "Noise-corrosion",
  "Plain-other",
] as const;

export type FinishPatternReviewChoice =
  (typeof FINISH_PATTERN_REVIEW_CHOICES)[number];
export type FinishPatternHeroKind = "wood" | "marble" | "strata";

export interface FinishPatternHeroScore {
  system: string;
  kind: FinishPatternHeroKind;
  expected: Extract<FinishPatternReviewChoice, "Wood" | "Marble" | "Strata">;
  correct: number;
  total: number;
  medianConfidence: number;
  pass: boolean;
}

export interface FinishPatternSystemScore {
  system: string;
  correct: number;
  total: number;
  fraction: number;
  pass: boolean;
}

export interface FinishPatternReviewScore {
  runId: string;
  pass: boolean;
  verdict: "pass" | "refused";
  aggregate: {
    correct: number;
    total: number;
    fraction: number;
    requiredCorrect: number;
    pass: boolean;
  };
  bySystem: FinishPatternSystemScore[];
  byHero: FinishPatternHeroScore[];
}

export class FinishPatternReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinishPatternReviewValidationError";
  }
}

interface KeyCard {
  card: string;
  expected: FinishPatternHeroKind;
  system: string;
}

interface KeyDeck {
  deckId: string;
  cards: KeyCard[];
}

interface ReviewResponse {
  card: string;
  choice: FinishPatternReviewChoice;
  confidence: number;
}

interface Reviewer {
  reviewerId: string;
  deckId: string;
  responses: ReviewResponse[];
}

const materialChoices: Readonly<
  Record<FinishPatternHeroKind, FinishPatternHeroScore["expected"]>
> = {
  wood: "Wood",
  marble: "Marble",
  strata: "Strata",
};

const choiceSet = new Set<string>(FINISH_PATTERN_REVIEW_CHOICES);
const heroKinds = new Set<string>(["wood", "marble", "strata"]);

function fail(path: string, message: string): never {
  throw new FinishPatternReviewValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

function nonemptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(path, "expected a non-empty string");
  }
  return value;
}

function supportedSchema(value: unknown, path: string): 1 | 2 {
  if (value !== 1 && value !== 2) return fail(path, "expected schema 1 or 2");
  return value;
}

function unique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value))
      fail(path, `duplicate identifier ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function heroKind(value: unknown, path: string): FinishPatternHeroKind {
  if (typeof value !== "string") return fail(path, "expected a material name");
  const normalized = value.toLowerCase();
  if (!heroKinds.has(normalized)) {
    return fail(path, "expected Wood, Marble, or Strata");
  }
  return normalized as FinishPatternHeroKind;
}

function reviewChoice(value: unknown, path: string): FinishPatternReviewChoice {
  if (typeof value !== "string" || !choiceSet.has(value)) {
    return fail(
      path,
      `expected one of ${FINISH_PATTERN_REVIEW_CHOICES.join(", ")}`,
    );
  }
  return value as FinishPatternReviewChoice;
}

function confidence(value: unknown, path: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 5
  ) {
    return fail(path, "expected an integer from 1 through 5");
  }
  return value as number;
}

function heroId(system: string, kind: FinishPatternHeroKind): string {
  return JSON.stringify([system, kind]);
}

function parseKey(input: unknown): { runId: string; decks: KeyDeck[] } {
  const root = record(input, "key");
  supportedSchema(root.schema, "key.schema");
  const runId = nonemptyString(root.runId, "key.runId");
  const rawDecks = array(root.decks, "key.decks");
  if (rawDecks.length !== FINISH_PATTERN_REVIEWERS) {
    fail("key.decks", `expected exactly ${FINISH_PATTERN_REVIEWERS} decks`);
  }

  const decks = rawDecks.map((rawDeck, deckIndex): KeyDeck => {
    const deckPath = `key.decks[${deckIndex}]`;
    const deck = record(rawDeck, deckPath);
    const deckId = nonemptyString(deck.deckId, `${deckPath}.deckId`);
    const rawCards = array(deck.cards, `${deckPath}.cards`);
    if (rawCards.length !== FINISH_PATTERN_CARDS_PER_REVIEWER) {
      fail(
        `${deckPath}.cards`,
        `expected exactly ${FINISH_PATTERN_CARDS_PER_REVIEWER} cards`,
      );
    }
    const cards = rawCards.map((rawCard, cardIndex): KeyCard => {
      const cardPath = `${deckPath}.cards[${cardIndex}]`;
      const card = record(rawCard, cardPath);
      return {
        card: nonemptyString(card.card, `${cardPath}.card`),
        expected: heroKind(card.expected, `${cardPath}.expected`),
        system: nonemptyString(card.system, `${cardPath}.system`),
      };
    });
    unique(
      cards.map((card) => card.card),
      `${deckPath}.cards`,
    );
    unique(
      cards.map((card) => heroId(card.system, card.expected)),
      `${deckPath}.cards heroes`,
    );
    return { deckId, cards };
  });
  unique(
    decks.map((deck) => deck.deckId),
    "key.decks",
  );

  const canonicalHeroes = new Set(
    decks[0].cards.map((card) => heroId(card.system, card.expected)),
  );
  for (let i = 1; i < decks.length; i++) {
    const deckHeroes = new Set(
      decks[i].cards.map((card) => heroId(card.system, card.expected)),
    );
    for (const expected of canonicalHeroes) {
      if (!deckHeroes.has(expected)) {
        fail(`key.decks[${i}].cards`, "does not contain the same nine heroes");
      }
    }
  }

  const kindsBySystem = new Map<string, Set<FinishPatternHeroKind>>();
  for (const card of decks[0].cards) {
    const kinds = kindsBySystem.get(card.system) ?? new Set();
    kinds.add(card.expected);
    kindsBySystem.set(card.system, kinds);
  }
  if (kindsBySystem.size !== 3) {
    fail("key.decks[0].cards", "expected exactly three systems");
  }
  for (const [system, kinds] of kindsBySystem) {
    if (kinds.size !== 3) {
      fail(
        "key.decks[0].cards",
        `system ${JSON.stringify(system)} must contain Wood, Marble, and Strata`,
      );
    }
  }
  return { runId, decks };
}

function parseResponse(input: unknown, path: string): ReviewResponse {
  if (Array.isArray(input)) {
    if (input.length !== 3) return fail(path, "expected a three-item response");
    return {
      card: nonemptyString(input[0], `${path}[0]`),
      choice: reviewChoice(input[1], `${path}[1]`),
      confidence: confidence(input[2], `${path}[2]`),
    };
  }
  const response = record(input, path);
  return {
    card: nonemptyString(response.card, `${path}.card`),
    choice: reviewChoice(response.choice, `${path}.choice`),
    confidence: confidence(response.confidence, `${path}.confidence`),
  };
}

function validateDeclaredChoices(value: unknown): void {
  if (value === undefined) return;
  const choices = array(value, "results.choices").map((choice, index) =>
    reviewChoice(choice, `results.choices[${index}]`),
  );
  if (choices.length !== FINISH_PATTERN_REVIEW_CHOICES.length) {
    fail("results.choices", "must list every allowed choice exactly once");
  }
  unique(choices, "results.choices");
  for (const choice of FINISH_PATTERN_REVIEW_CHOICES) {
    if (!choices.includes(choice)) {
      fail("results.choices", `missing ${choice}`);
    }
  }
}

function parseResults(input: unknown): {
  runId: string;
  reviewers: Reviewer[];
} {
  const root = record(input, "results");
  supportedSchema(root.schema, "results.schema");
  const runId = nonemptyString(root.runId, "results.runId");
  validateDeclaredChoices(root.choices);
  const rawReviewers = array(root.reviewers, "results.reviewers");
  if (rawReviewers.length !== FINISH_PATTERN_REVIEWERS) {
    fail(
      "results.reviewers",
      `expected exactly ${FINISH_PATTERN_REVIEWERS} reviewers`,
    );
  }
  const reviewers = rawReviewers.map((rawReviewer, reviewerIndex): Reviewer => {
    const reviewerPath = `results.reviewers[${reviewerIndex}]`;
    const reviewer = record(rawReviewer, reviewerPath);
    const rawResponses = array(reviewer.responses, `${reviewerPath}.responses`);
    if (rawResponses.length !== FINISH_PATTERN_CARDS_PER_REVIEWER) {
      fail(
        `${reviewerPath}.responses`,
        `expected exactly ${FINISH_PATTERN_CARDS_PER_REVIEWER} responses`,
      );
    }
    const responses = rawResponses.map((response, responseIndex) =>
      parseResponse(response, `${reviewerPath}.responses[${responseIndex}]`),
    );
    unique(
      responses.map((response) => response.card),
      `${reviewerPath}.responses`,
    );
    return {
      reviewerId: nonemptyString(
        reviewer.reviewerId,
        `${reviewerPath}.reviewerId`,
      ),
      deckId: nonemptyString(reviewer.deckId, `${reviewerPath}.deckId`),
      responses,
    };
  });
  unique(
    reviewers.map((reviewer) => reviewer.reviewerId),
    "results.reviewers reviewerId",
  );
  unique(
    reviewers.map((reviewer) => reviewer.deckId),
    "results.reviewers deckId",
  );
  return { runId, reviewers };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Validate and score completed, independently shuffled review decks. */
export function scoreFinishPatternReview(
  keyInput: unknown,
  resultsInput: unknown,
): FinishPatternReviewScore {
  const key = parseKey(keyInput);
  const results = parseResults(resultsInput);
  if (key.runId !== results.runId) {
    fail(
      "results.runId",
      `does not match key run ${JSON.stringify(key.runId)}`,
    );
  }

  const keyByDeck = new Map(key.decks.map((deck) => [deck.deckId, deck]));
  const resultDecks = new Set(
    results.reviewers.map((reviewer) => reviewer.deckId),
  );
  for (const deck of key.decks) {
    if (!resultDecks.has(deck.deckId)) {
      fail("results.reviewers", `missing deck ${JSON.stringify(deck.deckId)}`);
    }
  }

  const canonicalCards = [...key.decks[0].cards].sort(
    (a, b) =>
      a.system.localeCompare(b.system) || a.expected.localeCompare(b.expected),
  );
  const heroAccumulators = new Map(
    canonicalCards.map((card) => [
      heroId(card.system, card.expected),
      { card, correct: 0, confidences: [] as number[] },
    ]),
  );
  const systemAccumulators = new Map<
    string,
    { correct: number; total: number }
  >();

  for (const reviewer of results.reviewers) {
    const deck = keyByDeck.get(reviewer.deckId);
    if (!deck) {
      fail(
        "results.reviewers",
        `unknown deck ${JSON.stringify(reviewer.deckId)}`,
      );
    }
    const cardsById = new Map(deck.cards.map((card) => [card.card, card]));
    for (const response of reviewer.responses) {
      const card = cardsById.get(response.card);
      if (!card) {
        fail(
          `results reviewer ${JSON.stringify(reviewer.reviewerId)}`,
          `unknown card ${JSON.stringify(response.card)} for deck ${JSON.stringify(deck.deckId)}`,
        );
      }
      const correct = response.choice === materialChoices[card.expected];
      const hero = heroAccumulators.get(heroId(card.system, card.expected));
      if (!hero) return fail("key.decks", "contains inconsistent heroes");
      if (correct) hero.correct++;
      hero.confidences.push(response.confidence);
      const system = systemAccumulators.get(card.system) ?? {
        correct: 0,
        total: 0,
      };
      if (correct) system.correct++;
      system.total++;
      systemAccumulators.set(card.system, system);
    }
  }

  const byHero = [...heroAccumulators.values()].map(
    ({ card, correct, confidences }): FinishPatternHeroScore => {
      if (confidences.length !== FINISH_PATTERN_REVIEWERS) {
        return fail(
          "results.reviewers",
          `hero ${card.system}/${card.expected} does not have five responses`,
        );
      }
      const medianConfidence = median(confidences);
      return {
        system: card.system,
        kind: card.expected,
        expected: materialChoices[card.expected],
        correct,
        total: confidences.length,
        medianConfidence,
        pass:
          correct >= FINISH_PATTERN_HERO_CORRECT_MIN &&
          medianConfidence >= FINISH_PATTERN_HERO_MEDIAN_CONFIDENCE_MIN,
      };
    },
  );
  const bySystem = [...systemAccumulators]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([system, score]): FinishPatternSystemScore => ({
      system,
      correct: score.correct,
      total: score.total,
      fraction: score.correct / score.total,
      pass: byHero
        .filter((hero) => hero.system === system)
        .every((hero) => hero.pass),
    }));
  const correct = bySystem.reduce((sum, system) => sum + system.correct, 0);
  const total = bySystem.reduce((sum, system) => sum + system.total, 0);
  const requiredCorrect = Math.ceil(total * FINISH_PATTERN_AGGREGATE_MIN);
  const aggregatePass = correct >= requiredCorrect;
  const pass = aggregatePass && byHero.every((hero) => hero.pass);
  return {
    runId: key.runId,
    pass,
    verdict: pass ? "pass" : "refused",
    aggregate: {
      correct,
      total,
      fraction: correct / total,
      requiredCorrect,
      pass: aggregatePass,
    },
    bySystem,
    byHero,
  };
}
