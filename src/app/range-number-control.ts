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
  /** Require committed values to land on `min + n * step`. Most continuous
   * model parameters deliberately leave this false: `step` remains the
   * keyboard increment while direct entry may use finer exact precision. */
  enforceStep?: boolean;
  /** Maximum fractional precision accepted and used for synchronized display.
   * Defaults to the decimal precision of `step`. */
  precision?: number;
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
  setValue(value: number, options?: { force?: boolean }): void;
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

function decimalPlaces(value: number): number {
  const [coefficient, exponentText] = Math.abs(value)
    .toString()
    .toLowerCase()
    .split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  const exponent = Number(exponentText ?? 0);
  return Math.max(0, fraction - exponent);
}

function checkedPrecision(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError("precision must be an integer from 0 to 100");
  }
  return value;
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

/** A wrapping label may contain only the one labelable control it labels. A
 * range+number pair therefore turns that static row into the same styled
 * container with an explicit caption label for the retained range. IDs,
 * hidden state, titles and gating classes stay on the container, so existing
 * panel applicability code keeps addressing the same row. */
export function normalizeRangeWrappingLabel(range: HTMLInputElement): void {
  const wrapper = range.parentElement;
  if (!(wrapper instanceof HTMLLabelElement)) return;
  const doc = range.ownerDocument;
  if (!range.id) {
    range.id = uniqueId(doc, `range-input-${String(++generatedId)}`);
  }
  const container = doc.createElement("div");
  for (const attribute of Array.from(wrapper.attributes)) {
    if (attribute.name !== "for") {
      container.setAttribute(attribute.name, attribute.value);
    }
  }
  const caption = doc.createElement("label");
  caption.className = "range-number-caption";
  caption.htmlFor = range.id;
  for (const child of Array.from(wrapper.childNodes)) {
    if (child !== range) caption.appendChild(child);
  }
  wrapper.replaceWith(container);
  if (caption.textContent?.trim() || caption.children.length > 0) {
    container.appendChild(caption);
  }
  container.appendChild(range);
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
  normalizeRangeWrappingLabel(range);
  const adapter = options.adapter ?? IDENTITY_ADAPTER;
  let bounds = checkedBounds(options);
  let precision = checkedPrecision(
    options.precision ?? decimalPlaces(bounds.step),
  );
  const formatValue =
    options.formatValue ?? ((value: number) => value.toFixed(precision));
  let allowedValues = normalizedAllowed(options.allowedValues);
  let lastAccepted = adapter.rangeToNumber(Number(range.value));
  let draftDirty = false;
  let arrowCommitPending = false;
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
    numberInput.step =
      options.enforceStep === true ? String(bounds.step) : "any";
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

    if (options.enforceStep === true) {
      const steps = (value - bounds.min) / bounds.step;
      if (!approximatelyEqual(steps, Math.round(steps))) {
        return {
          error: `Use increments of ${String(bounds.step)} from ${String(bounds.min)}.`,
        };
      }
    }
    const precisionValue = Number(value.toFixed(precision));
    if (!approximatelyEqual(value, precisionValue)) {
      return {
        error:
          precision === 0
            ? "Enter a whole number."
            : `Use at most ${String(precision)} decimal places.`,
      };
    }
    return { value };
  };

  /**
   * The nearest value inside this control's OWN accepted domain: within
   * bounds, on the step grid where the control enforces one, and at the
   * declared precision. Arrow stepping starts from whatever the field
   * currently shows, which may be a draft {@link validateDraft} has just
   * REFUSED, and it commits without re-validating — so without this a
   * refused draft steps into a value the same control rejects when typed,
   * writes it to the document, and then displays it ROUNDED, leaving the
   * panel and the document disagreeing about what the number is. Measured
   * on a real build before this existed: Position X (step 0.01), draft
   * "0.375" refused for precision, then ArrowUp wrote 0.385 to the document
   * and showed 0.39 in the field, the slider and the readout.
   *
   * THE ORDER IS THE LOAD-BEARING PART: grid, then precision, then bounds.
   * Clamping first and rounding after would round the bound itself away —
   * an off-precision bound is reachable in practice, since a synchronized
   * value outside the declared span widens the bounds to itself (see
   * {@link setBounds}'s callers) rather than being clamped off — and the
   * step at the top of the range would then land back where it started.
   */
  const quantize = (value: number): number => {
    const gridded =
      options.enforceStep === true
        ? bounds.min +
          Math.round((value - bounds.min) / bounds.step) * bounds.step
        : value;
    return Math.min(
      bounds.max,
      Math.max(bounds.min, Number(gridded.toFixed(precision))),
    );
  };

  const setValue = (
    value: number,
    syncOptions: { force?: boolean } = {},
  ): void => {
    finite(value, "value");
    if (value < bounds.min || value > bounds.max) {
      throw new RangeError("value is outside the semantic bounds");
    }
    const raw = adapter.numberToRange(value);
    finite(raw, "mapped range value");
    lastAccepted = value;
    range.value = String(raw);
    if (draftDirty && syncOptions.force !== true) return;
    draftDirty = false;
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
    draftDirty = false;
    numberInput.value = formatted(value);
    clearError();
    options.onInput(value, "range");
  });

  const applyNumberValue = (value: number, commit: boolean): boolean => {
    const raw = adapter.numberToRange(value);
    if (!Number.isFinite(raw)) {
      showError("Enter a supported value.");
      return false;
    }
    draftDirty = false;
    lastAccepted = value;
    range.value = String(raw);
    numberInput.value = formatted(value);
    clearError();
    options.onInput(value, "number");
    if (commit) options.onCommit?.(value);
    return true;
  };

  numberInput.addEventListener("change", (event) => {
    arrowCommitPending = false;
    draftDirty = true;
    const result = validateDraft();
    if ("error" in result) {
      showError(result.error);
      // Dynamic editor containers use delegated bubbling `change` as their
      // settlement seam. An invalid draft did not mutate anything and must
      // not look like a settled edit to that ancestor.
      event.stopPropagation();
      return;
    }
    if (!applyNumberValue(result.value, true)) event.stopPropagation();
  });

  // Once validation has been shown, clear it as soon as the draft is valid;
  // typing alone never edits the semantic value or fires a callback.
  numberInput.addEventListener("input", () => {
    arrowCommitPending = false;
    draftDirty = true;
    if (numberInput.getAttribute("aria-invalid") !== "true") return;
    const result = validateDraft();
    if ("error" in result) showError(result.error);
    else clearError();
  });

  numberInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      arrowCommitPending = false;
      draftDirty = false;
      numberInput.value = formatted(lastAccepted);
      clearError();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    // Native number stepping cannot express non-linear detents (1,2,4,8,16),
    // and assigning `.value` fires no event. Own every semantic Arrow step so
    // the displayed value, retained range, and live app state move together.
    // A matching keyup settles once after any key-repeat sequence.
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    const parsed = Number(numberInput.value);
    const current = Number.isFinite(parsed) ? parsed : lastAccepted;
    let next: number;
    if (allowedValues !== undefined && allowedValues.length > 0) {
      let candidate: number | undefined;
      if (direction > 0) {
        candidate = allowedValues.find(
          (value) => value > current && !approximatelyEqual(value, current),
        );
      } else {
        for (let index = allowedValues.length - 1; index >= 0; index -= 1) {
          const value = allowedValues[index];
          if (value < current && !approximatelyEqual(value, current)) {
            candidate = value;
            break;
          }
        }
      }
      next =
        candidate ??
        allowedValues[direction > 0 ? allowedValues.length - 1 : 0];
    } else {
      // Both the base and the result go through the domain, not just the
      // result: stepping from an unquantized base lands a step away from a
      // value the field never showed.
      next = quantize(quantize(current) + direction * bounds.step);
    }
    arrowCommitPending = applyNumberValue(next, false);
  });

  numberInput.addEventListener("keyup", (event) => {
    if (
      !arrowCommitPending ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }
    arrowCommitPending = false;
    options.onCommit?.(lastAccepted);
  });

  return {
    range,
    pair,
    numberInput,
    error,
    setValue,
    setBounds(next): void {
      bounds = checkedBounds(next);
      if (options.precision === undefined) {
        precision = checkedPrecision(decimalPlaces(bounds.step));
      }
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
