/**
 * Bidirectional conversion between a range input's raw position and the
 * user-facing numeric value it controls. The identity adapter covers ordinary
 * linear sliders; logarithmic and detent-indexed sliders provide their own.
 */
export interface RangeNumberAdapter {
  rangeToNumber(raw: number): number;
  numberToRange(value: number): number;
}

export interface RangeNumberBounds {
  min: number;
  max: number;
  step: number;
}

export interface RangeNumberControlOptions extends RangeNumberBounds {
  /** Optional semantic values accepted by a discrete control. */
  allowedValues?: readonly number[];
  adapter?: RangeNumberAdapter;
  /** Explicit accessible name for the numeric field. */
  ariaLabel?: string;
  /** Numeric-string formatter; units belong outside the input value. */
  formatValue?: (value: number) => string;
  /** Live semantic edit. `source` lets table-driven callers keep the range's
   * existing presentation-domain pipeline while routing only exact commits
   * through the numeric path; dynamic controls generally treat both alike. */
  onInput(value: number, source: "range" | "number"): void;
  /** Optional settlement callback, fired only after a valid number commit. */
  onCommit?: (value: number) => void;
}

export interface RangeNumberControl {
  readonly range: HTMLInputElement;
  readonly pair: HTMLElement;
  readonly numberInput: HTMLInputElement;
  readonly error: HTMLElement;
  /** Synchronize an accepted external semantic value without firing callbacks. */
  setValue(value: number): void;
  /** Update semantic bounds without inferring anything from the range element. */
  setBounds(bounds: RangeNumberBounds): void;
  /** Replace or clear the optional discrete semantic domain. */
  setAllowedValues(values?: readonly number[]): void;
  /** Explicit app-owned disabled synchronization for both controls. */
  setDisabled(disabled: boolean): void;
}

const IDENTITY_ADAPTER: RangeNumberAdapter = {
  rangeToNumber: (raw) => raw,
  numberToRange: (value) => value,
};

let generatedId = 0;

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function checkedBounds(bounds: RangeNumberBounds): RangeNumberBounds {
  finite(bounds.min, "min");
  finite(bounds.max, "max");
  finite(bounds.step, "step");
  if (bounds.max < bounds.min) throw new RangeError("max must be at least min");
  if (!(bounds.step > 0)) throw new RangeError("step must be positive");
  return { ...bounds };
}

function approximatelyEqual(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Number.EPSILON * scale * 16;
}

function normalizedAllowed(values?: readonly number[]): number[] | undefined {
  if (values === undefined) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  for (const value of sorted) finite(value, "allowed value");
  return sorted.filter(
    (value, index) =>
      index === 0 || !approximatelyEqual(value, sorted[index - 1]),
  );
}

function describedByWithError(
  original: string | null,
  errorId: string,
): string {
  const ids = original?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!ids.includes(errorId)) ids.push(errorId);
  return ids.join(" ");
}

function uniqueId(doc: Document, preferred: string): string {
  if (doc.getElementById(preferred) === null) return preferred;
  let id: string;
  do {
    generatedId += 1;
    id = `${preferred}-${String(generatedId)}`;
  } while (doc.getElementById(id) !== null);
  return id;
}

/**
 * Wrap a live `<input type="range">` with its editable numeric companion.
 * Existing range listeners and descriptions survive because the same element
 * is moved, not cloned. The control never observes `range.disabled`: callers
 * explicitly synchronize app-owned availability through `setDisabled`, so a
 * touch guard's temporary disabled flip cannot leak onto the number field.
 */
export function enhanceRangeWithNumber(
  range: HTMLInputElement,
  options: RangeNumberControlOptions,
): RangeNumberControl {
  if (range.type !== "range") {
    throw new TypeError("enhanceRangeWithNumber requires input[type=range]");
  }
  if (range.parentNode === null) {
    throw new Error("range input must be connected to a parent node");
  }
  if (range.parentElement?.classList.contains("range-number-pair")) {
    throw new Error("range input already has a numeric companion");
  }

  const doc = range.ownerDocument;
  const adapter = options.adapter ?? IDENTITY_ADAPTER;
  const formatValue = options.formatValue ?? String;
  let bounds = checkedBounds(options);
  let allowedValues = normalizedAllowed(options.allowedValues);
  let lastAccepted = adapter.rangeToNumber(Number(range.value));
  finite(lastAccepted, "initial semantic value");

  const originalDescribedBy = range.getAttribute("aria-describedby");
  const preferredId = range.id
    ? `${range.id}-number-error`
    : `range-number-error-${String(++generatedId)}`;
  const errorId = uniqueId(doc, preferredId);

  const pair = doc.createElement("span");
  pair.className = "range-number-pair";
  range.parentNode.insertBefore(pair, range);
  pair.appendChild(range);

  const numberInput = doc.createElement("input");
  numberInput.type = "number";
  numberInput.className = "range-number-input";
  numberInput.id = uniqueId(
    doc,
    range.id
      ? `${range.id}Number`
      : `range-number-input-${String(++generatedId)}`,
  );
  numberInput.setAttribute(
    "aria-label",
    options.ariaLabel ??
      (range.getAttribute("aria-label")
        ? `${range.getAttribute("aria-label")!} exact value`
        : "Exact value"),
  );
  pair.appendChild(numberInput);

  const error = doc.createElement("span");
  error.id = errorId;
  error.className = "range-number-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  pair.appendChild(error);

  const description = describedByWithError(originalDescribedBy, errorId);
  range.setAttribute("aria-describedby", description);
  numberInput.setAttribute("aria-describedby", description);

  const clearError = (): void => {
    numberInput.removeAttribute("aria-invalid");
    numberInput.setCustomValidity("");
    error.textContent = "";
    error.hidden = true;
  };

  const showError = (message: string): void => {
    numberInput.setAttribute("aria-invalid", "true");
    numberInput.setCustomValidity(message);
    error.textContent = message;
    error.hidden = false;
  };

  const formatted = (value: number): string => {
    const text = formatValue(value);
    if (text.trim() === "" || !Number.isFinite(Number(text))) {
      throw new TypeError("formatValue must return a numeric string");
    }
    return text;
  };

  const syncAttributes = (): void => {
    numberInput.min = String(bounds.min);
    numberInput.max = String(bounds.max);
    numberInput.step = String(bounds.step);
  };

  type Validation = { value: number } | { error: string };
  const validateDraft = (): Validation => {
    const draft = numberInput.value.trim();
    if (draft === "") return { error: "Enter a number." };
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return { error: "Enter a finite number." };
    if (parsed < bounds.min || parsed > bounds.max) {
      return {
        error: `Enter a value from ${String(bounds.min)} to ${String(bounds.max)}.`,
      };
    }

    let value = parsed;
    if (allowedValues !== undefined) {
      const allowed = allowedValues.find((candidate) =>
        approximatelyEqual(candidate, parsed),
      );
      if (allowed === undefined) {
        return {
          error:
            allowedValues.length === 0
              ? "No values are currently available."
              : `Choose one of: ${allowedValues.map(String).join(", ")}.`,
        };
      }
      value = allowed;
    }

    const steps = (value - bounds.min) / bounds.step;
    if (!approximatelyEqual(steps, Math.round(steps))) {
      return {
        error: `Use increments of ${String(bounds.step)} from ${String(bounds.min)}.`,
      };
    }
    return { value };
  };

  const setValue = (value: number): void => {
    finite(value, "value");
    if (value < bounds.min || value > bounds.max) {
      throw new RangeError("value is outside the semantic bounds");
    }
    const raw = adapter.numberToRange(value);
    finite(raw, "mapped range value");
    lastAccepted = value;
    range.value = String(raw);
    numberInput.value = formatted(value);
    clearError();
  };

  syncAttributes();
  numberInput.disabled = range.disabled;
  setValue(lastAccepted);

  range.addEventListener("input", () => {
    const value = adapter.rangeToNumber(Number(range.value));
    finite(value, "mapped semantic value");
    lastAccepted = value;
    numberInput.value = formatted(value);
    clearError();
    options.onInput(value, "range");
  });

  numberInput.addEventListener("change", () => {
    const result = validateDraft();
    if ("error" in result) {
      showError(result.error);
      return;
    }
    const raw = adapter.numberToRange(result.value);
    if (!Number.isFinite(raw)) {
      showError("Enter a supported value.");
      return;
    }
    lastAccepted = result.value;
    range.value = String(raw);
    numberInput.value = formatted(result.value);
    clearError();
    options.onInput(result.value, "number");
    options.onCommit?.(result.value);
  });

  // Once validation has been shown, clear it as soon as the draft is valid;
  // typing alone never edits the semantic value or fires a callback.
  numberInput.addEventListener("input", () => {
    if (numberInput.getAttribute("aria-invalid") !== "true") return;
    const result = validateDraft();
    if ("error" in result) showError(result.error);
    else clearError();
  });

  numberInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    numberInput.value = formatted(lastAccepted);
    clearError();
  });

  return {
    range,
    pair,
    numberInput,
    error,
    setValue,
    setBounds(next): void {
      bounds = checkedBounds(next);
      syncAttributes();
      if (numberInput.getAttribute("aria-invalid") === "true") {
        const result = validateDraft();
        if ("error" in result) showError(result.error);
        else clearError();
      }
    },
    setAllowedValues(values): void {
      allowedValues = normalizedAllowed(values);
      if (numberInput.getAttribute("aria-invalid") === "true") {
        const result = validateDraft();
        if ("error" in result) showError(result.error);
        else clearError();
      }
    },
    setDisabled(disabled): void {
      range.disabled = disabled;
      numberInput.disabled = disabled;
    },
  };
}
