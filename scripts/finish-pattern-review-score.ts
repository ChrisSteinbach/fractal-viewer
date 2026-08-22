/**
 * Pure validator and reporter for the finish-pattern blinded owner gate.
 *
 * The renderer emits one shuffled nine-card deck. This module deliberately
 * accepts parsed JSON as `unknown`: a pending template, malformed response, or
 * missing owner verdict must be refused before it can approve material names.
 */

export const FINISH_PATTERN_OWNER_REVIEWS = 1;
export const FINISH_PATTERN_CARDS_PER_OWNER = 9;

export const FINISH_PATTERN_REVIEW_CHOICES = [
  "Wood",
  "Marble",
  "Strata",
  "Noise-corrosion",
  "Plain-other",
] as const;

export const FINISH_PATTERN_OWNER_VERDICTS = [
  "approve",
  "request-changes",
  "downgrade-name",
] as const;

export type FinishPatternReviewChoice =
  (typeof FINISH_PATTERN_REVIEW_CHOICES)[number];
export type FinishPatternOwnerVerdict =
  (typeof FINISH_PATTERN_OWNER_VERDICTS)[number];
export type FinishPatternHeroKind = "wood" | "marble" | "strata";

export interface FinishPatternHeroScore {
  system: string;
  kind: FinishPatternHeroKind;
  expected: Extract<FinishPatternReviewChoice, "Wood" | "Marble" | "Strata">;
  choice: FinishPatternReviewChoice;
  confidence: number;
  recognized: boolean;
}

export interface FinishPatternSystemScore {
  system: string;
  correct: number;
  total: number;
  fraction: number;
}

export interface FinishPatternNameDowngrade {
  family: FinishPatternHeroScore["expected"];
  replacement: string;
}

export interface FinishPatternReviewScore {
  runId: string;
  pass: boolean;
  verdict: FinishPatternOwnerVerdict;
  downgrade: FinishPatternNameDowngrade | null;
  recognition: {
    correct: number;
    total: number;
    fraction: number;
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

interface OwnerReview {
  ownerId: string;
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
const verdictSet = new Set<string>(FINISH_PATTERN_OWNER_VERDICTS);
const materialChoiceSet = new Set<string>(Object.values(materialChoices));
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

function schema(value: unknown, path: string): 3 {
  if (value !== 3) return fail(path, "expected schema 3");
  return value;
}

function completeStatus(value: unknown, path: string): "complete" {
  if (value !== "complete") return fail(path, 'expected "complete"');
  return value;
}

function unique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      fail(path, `duplicate identifier ${JSON.stringify(value)}`);
    }
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

function ownerVerdict(value: unknown, path: string): FinishPatternOwnerVerdict {
  if (typeof value !== "string" || !verdictSet.has(value)) {
    return fail(
      path,
      `expected one of ${FINISH_PATTERN_OWNER_VERDICTS.join(", ")}`,
    );
  }
  return value as FinishPatternOwnerVerdict;
}

function materialChoice(
  value: unknown,
  path: string,
): FinishPatternNameDowngrade["family"] {
  if (typeof value !== "string" || !materialChoiceSet.has(value)) {
    return fail(path, "expected Wood, Marble, or Strata");
  }
  return value as FinishPatternNameDowngrade["family"];
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

function parseKey(input: unknown): { runId: string; deck: KeyDeck } {
  const root = record(input, "key");
  schema(root.schema, "key.schema");
  const runId = nonemptyString(root.runId, "key.runId");
  const rawDecks = array(root.decks, "key.decks");
  if (rawDecks.length !== FINISH_PATTERN_OWNER_REVIEWS) {
    fail(
      "key.decks",
      `expected exactly ${FINISH_PATTERN_OWNER_REVIEWS} owner deck`,
    );
  }

  const rawDeck = record(rawDecks[0], "key.decks[0]");
  const deckId = nonemptyString(rawDeck.deckId, "key.decks[0].deckId");
  const rawCards = array(rawDeck.cards, "key.decks[0].cards");
  if (rawCards.length !== FINISH_PATTERN_CARDS_PER_OWNER) {
    fail(
      "key.decks[0].cards",
      `expected exactly ${FINISH_PATTERN_CARDS_PER_OWNER} cards`,
    );
  }
  const cards = rawCards.map((rawCard, cardIndex): KeyCard => {
    const cardPath = `key.decks[0].cards[${cardIndex}]`;
    const card = record(rawCard, cardPath);
    return {
      card: nonemptyString(card.card, `${cardPath}.card`),
      expected: heroKind(card.expected, `${cardPath}.expected`),
      system: nonemptyString(card.system, `${cardPath}.system`),
    };
  });
  unique(
    cards.map((card) => card.card),
    "key.decks[0].cards",
  );
  unique(
    cards.map((card) => heroId(card.system, card.expected)),
    "key.decks[0].cards heroes",
  );

  const kindsBySystem = new Map<string, Set<FinishPatternHeroKind>>();
  for (const card of cards) {
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
  return { runId, deck: { deckId, cards } };
}

function parseResponse(input: unknown, path: string): ReviewResponse {
  const response = record(input, path);
  return {
    card: nonemptyString(response.card, `${path}.card`),
    choice: reviewChoice(response.choice, `${path}.choice`),
    confidence: confidence(response.confidence, `${path}.confidence`),
  };
}

function validateDeclaredChoices(value: unknown): void {
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

function parseDowngrade(
  value: unknown,
  verdict: FinishPatternOwnerVerdict,
): FinishPatternNameDowngrade | null {
  if (verdict !== "downgrade-name") {
    if (value !== null) {
      fail(
        "results.downgrade",
        "must be null unless verdict is downgrade-name",
      );
    }
    return null;
  }
  const downgrade = record(value, "results.downgrade");
  const family = materialChoice(downgrade.family, "results.downgrade.family");
  const replacement = nonemptyString(
    downgrade.replacement,
    "results.downgrade.replacement",
  ).trim();
  if (family.toLowerCase() === replacement.toLowerCase()) {
    fail("results.downgrade.replacement", "must differ from the current name");
  }
  return { family, replacement };
}

function parseResults(input: unknown): {
  runId: string;
  verdict: FinishPatternOwnerVerdict;
  downgrade: FinishPatternNameDowngrade | null;
  owner: OwnerReview;
} {
  const root = record(input, "results");
  schema(root.schema, "results.schema");
  const runId = nonemptyString(root.runId, "results.runId");
  completeStatus(root.status, "results.status");
  validateDeclaredChoices(root.choices);
  const verdict = ownerVerdict(root.verdict, "results.verdict");
  const downgrade = parseDowngrade(root.downgrade, verdict);
  const rawOwner = record(root.owner, "results.owner");
  const rawResponses = array(rawOwner.responses, "results.owner.responses");
  if (rawResponses.length !== FINISH_PATTERN_CARDS_PER_OWNER) {
    fail(
      "results.owner.responses",
      `expected exactly ${FINISH_PATTERN_CARDS_PER_OWNER} responses`,
    );
  }
  const responses = rawResponses.map((response, responseIndex) =>
    parseResponse(response, `results.owner.responses[${responseIndex}]`),
  );
  unique(
    responses.map((response) => response.card),
    "results.owner.responses",
  );
  return {
    runId,
    verdict,
    downgrade,
    owner: {
      ownerId: nonemptyString(rawOwner.ownerId, "results.owner.ownerId"),
      deckId: nonemptyString(rawOwner.deckId, "results.owner.deckId"),
      responses,
    },
  };
}

/** Validate and report one completed, blinded owner review. */
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
  if (key.deck.deckId !== results.owner.deckId) {
    fail(
      "results.owner.deckId",
      `does not match owner deck ${JSON.stringify(key.deck.deckId)}`,
    );
  }

  const cardsById = new Map(key.deck.cards.map((card) => [card.card, card]));
  const byHero = results.owner.responses
    .map((response): FinishPatternHeroScore => {
      const card = cardsById.get(response.card);
      if (!card) {
        return fail(
          "results.owner.responses",
          `unknown card ${JSON.stringify(response.card)} for deck ${JSON.stringify(key.deck.deckId)}`,
        );
      }
      return {
        system: card.system,
        kind: card.expected,
        expected: materialChoices[card.expected],
        choice: response.choice,
        confidence: response.confidence,
        recognized: response.choice === materialChoices[card.expected],
      };
    })
    .sort(
      (a, b) =>
        a.system.localeCompare(b.system) || a.kind.localeCompare(b.kind),
    );

  const bySystem = [...new Set(byHero.map((hero) => hero.system))]
    .sort((a, b) => a.localeCompare(b))
    .map((system): FinishPatternSystemScore => {
      const heroes = byHero.filter((hero) => hero.system === system);
      const correct = heroes.filter((hero) => hero.recognized).length;
      return {
        system,
        correct,
        total: heroes.length,
        fraction: correct / heroes.length,
      };
    });
  const correct = byHero.filter((hero) => hero.recognized).length;
  return {
    runId: key.runId,
    pass: results.verdict === "approve",
    verdict: results.verdict,
    downgrade: results.downgrade,
    recognition: {
      correct,
      total: byHero.length,
      fraction: correct / byHero.length,
    },
    bySystem,
    byHero,
  };
}
