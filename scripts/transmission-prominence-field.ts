/**
 * A separately named, sampled appearance candidate for conditioning positive
 * variation of the smooth clearance signal. It does not define membership,
 * alter the public distance estimator, or permit samples to be skipped.
 */

export interface ProminenceFieldSettings {
  /** Dimensionless prominence in clearance-signal space. */
  prominence: number;
}

export const PROMINENCE_FIELD_DEFAULTS: Readonly<ProminenceFieldSettings> =
  Object.freeze({ prominence: 0.2 });

export type ProminencePhase = "crest" | "valley";

/** Persist this complete state across work chunks. */
export interface ProminenceFieldState {
  phase: ProminencePhase;
  peak: number;
  trough: number;
}

export interface ProminenceFieldStep {
  increment: number;
  state: ProminenceFieldState;
}

export function initialProminenceFieldState(): ProminenceFieldState {
  return { phase: "crest", peak: 0, trough: 0 };
}

function validateSignal(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be finite and in [0, 1]`);
}

/**
 * Credit record rises in a basin. A fall of at least the prominence arms a
 * new basin; its first rise is credited at that current sample. Consequently
 * an opaque/material predicate can own emitted weight only where it is
 * sampled. A sub-prominence rear approach can emit no weight at all.
 */
export function prominenceFieldStep(
  previous: Readonly<ProminenceFieldState>,
  signal: number,
  settings: Readonly<ProminenceFieldSettings> = PROMINENCE_FIELD_DEFAULTS,
): ProminenceFieldStep {
  validateSignal(signal, "Clearance signal");
  validateSignal(previous.peak, "Prominence peak");
  validateSignal(previous.trough, "Prominence trough");
  if (previous.phase !== "crest" && previous.phase !== "valley")
    throw new Error("Prominence phase must be crest or valley");
  const prominence = settings.prominence;
  if (!Number.isFinite(prominence) || prominence <= 0 || prominence > 1)
    throw new Error("Prominence must be finite and in (0, 1]");

  if (previous.phase === "crest") {
    if (signal > previous.peak)
      return {
        increment: signal - previous.peak,
        state: { phase: "crest", peak: signal, trough: previous.trough },
      };
    if (previous.peak - signal >= prominence)
      return {
        increment: 0,
        state: { phase: "valley", peak: previous.peak, trough: signal },
      };
    return { increment: 0, state: { ...previous } };
  }

  if (signal <= previous.trough)
    return {
      increment: 0,
      state: { phase: "valley", peak: previous.peak, trough: signal },
    };
  return {
    increment: signal - previous.trough,
    state: { phase: "crest", peak: signal, trough: previous.trough },
  };
}
