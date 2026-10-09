/**
 * The sphairahedron panel controls' pure half — `sphere-inversion-controls.ts`
 * 's template one subject block over: the public ranges, the write rules,
 * and the per-row disclosures, tested without jsdom. `control-spec.ts` reads
 * and writes through these functions; `ui.ts` only paints what they return.
 *
 * PLACEMENT (docs/panel-ia.md's four-property record). Home: **Scene /
 * Look** — the block is the scene's authored SUBJECT (the third, after
 * Sphere inversion and the Menger carve), replacing the transform system.
 * Consumers: Points (the inverse-iteration walk of the limit set) and
 * Surface (the `sphairahedron` / `sphairahedron4` session kinds), in 3D
 * and native 4D (tetra4); Flame and Solid refuse the family. Lifetime:
 * document. Edit behavior: Points follows Auto-update; a live Surface
 * session RESTARTS on release (the construction is fixed at create — the
 * kernel tables pack from it once) without refitting the camera; Flame/
 * Solid refused with the adjacent reason.
 *
 * THE MODULI RANGES ARE THE FAMILY'S VALID REGION, SCOPED DYNAMICALLY:
 * a refusal firing mid-drag is poor authoring, so each cube modulus
 * slider's span is the exact interval the resolver's region admits GIVEN
 * the other modulus's current value (the disjoint family's
 * derive-the-radius-from-centres gesture). The region is a conic
 * intersection per family — in either modulus, with the other fixed, each
 * region curve is a quadratic or linear inequality whose admitted side is
 * an interval, so the intersection is an interval and closed forms apply;
 * `sphairahedron-controls.test.ts` pins the spans against the resolver
 * over a grid (the resolver stays the oracle — these are the fast path,
 * and the region's own definition never lives here). When the fixed
 * modulus already sits outside the region the interval can come back
 * empty; the span then falls back to the interval at the family's default
 * modulus and the resolver's refusal discloses beside the row. An authored
 * value outside a span widens that slider to itself and is disclosed
 * beside it (the sphere-inversion discipline: the control narrows, the
 * document never clamps).
 *
 * THE INVERSION SPHERE IS AUTHORED EXPLICITLY (the vocabulary's own rule —
 * no silent default): the finite checkbox and the Pick button both author
 * it through the picker (`sphairahedron-authoring.ts`), whose first
 * candidate is `defaultSphairahedronInversion`'s reflected reference. The
 * slider rows edit an authored sphere; they never invent one.
 */
import {
  SPHAIRAHEDRON_FAMILIES,
  resolveSphairahedron,
  type SphairahedronAuthored,
  type SphairahedronFamilyId,
} from "../fractal/sphairahedron";
import { authoredPickerInversion } from "./sphairahedron-authoring";

/** The numeric fields the panel exposes. */
export type SphairahedronNumericField =
  | "za"
  | "zb"
  | "z2"
  | "inversion.cx"
  | "inversion.cy"
  | "inversion.cz"
  | "inversion.cw"
  | "inversion.r";

/** Every row that can carry a disclosure. */
export type SphairahedronNoteRow =
  SphairahedronNumericField | "family" | "finite" | "pick" | "block";

export interface SphairahedronFieldRange {
  min: number;
  max: number;
  step: number;
  precision: number;
}

/** The value a select shows when the document names a family this version
 * does not offer. */
export const SPHAIRAHEDRON_AUTHORED_OPTION = "__authored";

/** Why the section is unavailable in Flame and Solid while no block is
 * present (with one present, those modes are already refused at the mode
 * switch and the app leaves them). */
export const SPHAIRAHEDRON_CONTROLS_MODE_REASON =
  "Flame and Solid cannot draw a sphairahedron scene. Use Points or Surface.";

/** The ONE canonical reason every sphairahedron dormancy row carries. */
export const SPHAIRAHEDRON_DORMANT_REASON = "Turn off Sphairahedron to edit.";

const CUBE_FAMILIES: readonly SphairahedronFamilyId[] = [
  "cube1",
  "cube4",
  "cube9",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inversionOf(
  block: SphairahedronAuthored,
): Record<string, unknown> | null {
  const raw: unknown = (block as Record<string, unknown>).inversion;
  return isPlainObject(raw) ? raw : null;
}

/** The family id the resolver reads, or `null` when the document names
 * something this version does not know. */
export function sphairahedronFamily(
  block: SphairahedronAuthored,
): SphairahedronFamilyId | null {
  const id: unknown = (block as Record<string, unknown>).family;
  return (SPHAIRAHEDRON_FAMILIES as readonly unknown[]).includes(id)
    ? (id as SphairahedronFamilyId)
    : null;
}

/** Whether the block authors a finite construction (an inversion sphere —
 * present, whether or not complete: incompleteness is the notes' job). */
export function sphairahedronIsFinite(block: SphairahedronAuthored): boolean {
  return inversionOf(block) !== null;
}

// --------------------------------------------------------- the region math

/** The cube families' region curves, as quadratics in the FREE modulus
 * with the FIXED one's coefficients absorbed — one constraint list per
 * (family, view). `side: "below"` admits `q <= 0`, `"above"` admits
 * `q >= 0`. Derived once in `docs/sphairahedron-family.md` ("The valid
 * region, derived per family") and pinned against the resolver in
 * `sphairahedron-controls.test.ts`; the resolver stays the oracle. */
interface RegionConic {
  a: number;
  b: number;
  c: number;
  side: "below" | "above";
}

const RT3 = Math.sqrt(3);
const RT2 = Math.SQRT2;
/** The appendix's curve constants (the family doc's derivations). */
const CUBE4_CONSTANTS = [36 * RT3 - 60, 72 * RT3 - 120, 120 - 72 * RT3];
const CUBE9_CONSTANTS = [1, 2, 6 * RT2 - 8];

function cube1Za(zb: number): RegionConic[] {
  return [
    { a: 0, b: zb, c: -0.75, side: "below" },
    { a: 1, b: -zb, c: -0.75, side: "below" },
    { a: 0, b: -zb, c: zb * zb - 0.75, side: "below" },
  ];
}
function cube1Zb(za: number): RegionConic[] {
  return [
    { a: 0, b: za, c: -0.75, side: "below" },
    { a: 0, b: -za, c: za * za - 0.75, side: "below" },
    { a: 1, b: -za, c: -0.75, side: "below" },
  ];
}
function cube4Za(zb: number): RegionConic[] {
  return [
    { a: 3, b: 6 * zb, c: zb * zb - CUBE4_CONSTANTS[0], side: "below" },
    { a: 15, b: -6 * zb, c: -zb * zb - CUBE4_CONSTANTS[1], side: "below" },
    { a: 3, b: 6 * zb, c: -5 * zb * zb - CUBE4_CONSTANTS[2], side: "above" },
  ];
}
function cube4Zb(za: number): RegionConic[] {
  return [
    { a: 1, b: 6 * za, c: 3 * za * za - CUBE4_CONSTANTS[0], side: "below" },
    { a: -1, b: -6 * za, c: 15 * za * za - CUBE4_CONSTANTS[1], side: "below" },
    { a: -5, b: 6 * za, c: 3 * za * za - CUBE4_CONSTANTS[2], side: "above" },
  ];
}
function cube9Za(zb: number): RegionConic[] {
  return [
    { a: 0, b: 2 * zb, c: zb * zb - CUBE9_CONSTANTS[0], side: "below" },
    { a: 3, b: -2 * zb, c: -zb * zb - CUBE9_CONSTANTS[1], side: "below" },
    { a: 0, b: -zb, c: zb * zb - CUBE9_CONSTANTS[2], side: "below" },
  ];
}
function cube9Zb(za: number): RegionConic[] {
  return [
    { a: 1, b: 2 * za, c: -CUBE9_CONSTANTS[0], side: "below" },
    { a: -1, b: -2 * za, c: 3 * za * za - CUBE9_CONSTANTS[1], side: "below" },
    { a: 1, b: -za, c: -CUBE9_CONSTANTS[2], side: "below" },
  ];
}

/** The interval of the free modulus one conic admits within `[lo, hi]`,
 * or `null` when it admits nothing there. Degenerate (linear) conics
 * become half-lines clamped to the window. */
function conicInterval(
  q: RegionConic,
  lo: number,
  hi: number,
): [number, number] | null {
  const { a, b, c, side } = q;
  const wantBelow = side === "below";
  if (a === 0) {
    if (b === 0) {
      // q = c: admits everything or nothing.
      return c <= 0 === wantBelow ? [lo, hi] : null;
    }
    // Linear: q = b·x + c, zero at x = -c/b.
    const root = -c / b;
    const belowIsLeft = b > 0;
    const pick =
      wantBelow === belowIsLeft
        ? [lo, Math.min(hi, root)]
        : [Math.max(lo, root), hi];
    return pick[0] <= pick[1] ? (pick as [number, number]) : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    // No real roots: single-signed. It admits everything when the
    // quadratic's sign agrees with the admitted side, nothing otherwise.
    const opensUp = a > 0;
    return opensUp === !wantBelow ? [lo, hi] : null;
  }
  const s = Math.sqrt(disc);
  const r1 = (-b - s) / (2 * a);
  const r2 = (-b + s) / (2 * a);
  const loRoot = Math.min(r1, r2);
  const hiRoot = Math.max(r1, r2);
  const between: [number, number] = [
    Math.max(lo, loRoot),
    Math.min(hi, hiRoot),
  ];
  const outsideLeft: [number, number] = [lo, Math.min(hi, loRoot)];
  const outsideRight: [number, number] = [Math.max(lo, hiRoot), hi];
  const admittedBetween = a > 0 === wantBelow;
  if (admittedBetween) {
    return between[0] <= between[1] ? between : null;
  }
  if (outsideRight[0] <= outsideRight[1]) return outsideRight;
  if (outsideLeft[0] <= outsideLeft[1]) return outsideLeft;
  return null;
}

/** The valid region interval of `field` given the family's OTHER modulus —
 * `null` means no valid position exists at the fixed value (and a family
 * that reads no moduli answers null outright — its spans never display). */
function cubeModulusInterval(
  field: "za" | "zb",
  family: SphairahedronFamilyId,
  fixed: number,
): [number, number] | null {
  const conics =
    family === "cube1"
      ? field === "za"
        ? cube1Za(fixed)
        : cube1Zb(fixed)
      : family === "cube4"
        ? field === "za"
          ? cube4Za(fixed)
          : cube4Zb(fixed)
        : family === "cube9"
          ? field === "za"
            ? cube9Za(fixed)
            : cube9Zb(fixed)
          : null;
  if (!conics) return null;
  let span: [number, number] = [0, Number.POSITIVE_INFINITY];
  for (const conic of conics) {
    const next = conicInterval(conic, span[0], span[1]);
    if (!next) return null;
    span = next;
  }
  return span[0] <= span[1] ? span : null;
}

// ------------------------------------------------------------- the ranges

/** The family defaults' own moduli (the resolver's filled values for a
 * bare block) — the spans' fallback anchor, the shipped constructions the
 * owner approved. */
const FAMILY_MODULUS_DEFAULTS: Record<
  SphairahedronFamilyId,
  { za: number; zb: number }
> = {
  tetra333: { za: 0, zb: 0 },
  tetra4: { za: 0, zb: 0 },
  prism2: { za: 0, zb: 0 },
  cube1: { za: 0.5, zb: 1.0 },
  cube4: { za: 0.4, zb: 0.3 },
  cube9: { za: 0.3, zb: 0.2 },
};

/** The prism's region: the open interval (−√6, √6). */
const PRISM_Z2_RANGE: SphairahedronFieldRange = {
  min: -Math.sqrt(6),
  max: Math.sqrt(6),
  step: 0.01,
  precision: 3,
};

/** The public range of one control. The cube moduli read the family and
 * the other modulus (the region-scoped spans, module doc); the prism's z2
 * is the region interval; the inversion sphere's rows are fixed spans
 * around the construction's own scale. */
export function sphairahedronFieldRange(
  block: SphairahedronAuthored,
  field: SphairahedronNumericField,
): SphairahedronFieldRange {
  if (field === "z2") return PRISM_Z2_RANGE;
  if (field.startsWith("inversion.")) {
    switch (field) {
      case "inversion.cx":
      case "inversion.cy":
      case "inversion.cz":
        return { min: -2, max: 2, step: 0.01, precision: 3 };
      case "inversion.cw":
        return { min: -1, max: 1, step: 0.01, precision: 3 };
      case "inversion.r":
        return { min: 0.2, max: 3, step: 0.01, precision: 3 };
    }
  }
  const family = sphairahedronFamily(block);
  const defaults = FAMILY_MODULUS_DEFAULTS[family ?? "cube1"];
  if (field !== "za" && field !== "zb") {
    // Not a cube modulus (z2 and the inversion rows returned above).
    return { min: 0, max: 2, step: 0.005, precision: 3 };
  }
  const fixed =
    (field === "za" ? block.zb : block.za) ??
    (field === "za" ? defaults.zb : defaults.za);
  const interval =
    family && CUBE_FAMILIES.includes(family)
      ? cubeModulusInterval(field, family, fixed)
      : null;
  if (!interval) {
    // The fixed modulus admits nothing: span the interval at the family's
    // default instead (the row's note carries the refusal).
    const fallback = cubeModulusInterval(
      field,
      family ?? "cube1",
      field === "za" ? defaults.zb : defaults.za,
    );
    const span = fallback ?? [0, 2];
    return { min: span[0], max: span[1], step: 0.005, precision: 3 };
  }
  return { min: interval[0], max: interval[1], step: 0.005, precision: 3 };
}

/** The family's default for one modulus (the resolver's absent-field
 * value); 1.5 for the prism's z2 (the mid terrain relief). */
export function sphairahedronModulusDefault(
  family: SphairahedronFamilyId | null,
  field: "za" | "zb" | "z2",
): number {
  if (field === "z2") return 1.5;
  const defaults = FAMILY_MODULUS_DEFAULTS[family ?? "cube1"];
  return field === "za" ? defaults.za : defaults.zb;
}

/** The raw authored value of `field` (`undefined` when absent), whatever
 * its JSON type — an imported document is untrusted. */
export function sphairahedronFieldAuthored(
  block: SphairahedronAuthored,
  field: SphairahedronNumericField,
): unknown {
  if (field.startsWith("inversion.")) {
    return inversionOf(block)?.[field.slice("inversion.".length)];
  }
  return (block as Record<string, unknown>)[field];
}

/** The number a control SHOWS: the authored value when it is a finite
 * number (in range or not — never clamped), otherwise the default. */
export function sphairahedronFieldValue(
  block: SphairahedronAuthored,
  field: SphairahedronNumericField,
): number {
  const raw = sphairahedronFieldAuthored(block, field);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const family = sphairahedronFamily(block);
  if (field === "za" || field === "zb" || field === "z2") {
    return sphairahedronModulusDefault(family, field);
  }
  if (field === "inversion.r") return 1;
  return 0;
}

// ------------------------------------------------------------- the writes

/** Write one numeric field. The moduli write verbatim (the region is the
 * slider's span, not a clamp); an inversion component authors the sphere
 * object on the first move. Never mutates `block`. */
export function withSphairahedronField(
  block: SphairahedronAuthored,
  field: SphairahedronNumericField,
  value: number,
): SphairahedronAuthored {
  if (!Number.isFinite(value)) return block;
  if (!field.startsWith("inversion.")) {
    return { ...block, [field]: value };
  }
  const leaf = field.slice("inversion.".length);
  const inv: Record<string, unknown> = { ...inversionOf(block) };
  inv[leaf] = value;
  return { ...block, inversion: inv };
}

/** Switch the family. Fields the new family does not read are KEPT (the
 * resolver ignores them, so switching back restores every modulus); a
 * present inversion sphere's `cw` is dropped when the new family is 3D —
 * the resolver refuses a nonzero w there and the 3D panel offers no row
 * to clear it, so keeping it would strand the scene on a refusal the user
 * cannot repair here. */
export function withSphairahedronFamily(
  block: SphairahedronAuthored,
  id: string,
): SphairahedronAuthored {
  if (
    !(SPHAIRAHEDRON_FAMILIES as readonly unknown[]).includes(id) ||
    block.family === id
  ) {
    return block;
  }
  const next: SphairahedronAuthored = { ...block, family: id };
  const raw = inversionOf(block);
  if (id !== "tetra4" && raw && raw.cw !== undefined) {
    const { cw: _dropped, ...inv } = raw;
    void _dropped;
    next.inversion = Object.keys(inv).length > 0 ? inv : undefined;
  }
  return next;
}

/** Write the finite stance: checked authors the inversion sphere (the
 * picker's first accepted candidate — the sphere is a free parameter and
 * never silently defaulted; a picker refusal returns the block unchanged
 * and the finite row's note discloses), unchecked removes it (the
 * infinite construction). */
export function withSphairahedronFinite(
  block: SphairahedronAuthored,
  finite: boolean,
): SphairahedronAuthored {
  if (finite === sphairahedronIsFinite(block)) return block;
  if (!finite) {
    const { inversion: _dropped, ...rest } = block;
    void _dropped;
    return rest;
  }
  const inversion = authoredPickerInversion(block);
  if (!inversion) return block;
  return { ...block, inversion };
}

// ---------------------------------------------------------- select + notes

/** The select value for the family: a shipped id, or
 * {@link SPHAIRAHEDRON_AUTHORED_OPTION}. */
export function sphairahedronFamilyValue(block: SphairahedronAuthored): string {
  return sphairahedronFamily(block) ?? SPHAIRAHEDRON_AUTHORED_OPTION;
}

/**
 * The block the enable gesture seeds, as a fresh object: the canonical
 * cube type 1 at (0.5, 1.0) made FINITE by the picker (the study's beauty
 * presentation, Points-drawable and Surface-marchable — an infinite block
 * is the terrains' stance and would draw an empty Points cloud,
 * `sphairahedron-sample.ts`'s scope note). The picker runs here so the
 * sphere is AUTHORED, never defaulted; a picker refusal authors the
 * infinite block and the finite row's note says why.
 */
export function defaultSphairahedronBlock(): SphairahedronAuthored {
  const base: SphairahedronAuthored = { family: "cube1", za: 0.5, zb: 1.0 };
  const inversion = authoredPickerInversion(base);
  return inversion ? { ...base, inversion } : base;
}

/** Which rows the block's family reads (the finite rows always show while
 * a block is present). */
export function sphairahedronVisibleRows(
  block: SphairahedronAuthored,
): Record<"za" | "zb" | "z2" | "cw", boolean> {
  const family = sphairahedronFamily(block);
  return {
    za: family !== null && CUBE_FAMILIES.includes(family),
    zb: family !== null && CUBE_FAMILIES.includes(family),
    z2: family === "prism2",
    cw: family === "tetra4",
  };
}

const REASON_ROWS: readonly [RegExp, SphairahedronNoteRow][] = [
  [/^(unknown family|no family)/, "family"],
  [/^unknown inversion field/, "inversion.cx"],
  [/^(inversion centre cx|cx, cy, cz)/, "inversion.cx"],
  [/^inversion centre w/, "inversion.cw"],
  [/^inversion radius r/, "inversion.r"],
  [/^inversion is not an object/, "finite"],
  [/^a finite construction needs/, "finite"],
  [/^modulus (za|zb) /, "za"],
  [/^modulus z2 /, "z2"],
  [/^ball /, "za"],
];

function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(Math.max(precision, 3))));
}

/**
 * The disclosure beside each row, `""` where there is none — the
 * sphere-inversion notes' shape: a resolver refusal lands on the row whose
 * field it names (the block when it names no one field) and says how to
 * repair it; a value the resolver accepts but the slider's span does not
 * include is disclosed as kept. Neither ever rewrites the document.
 */
export function sphairahedronControlNotes(
  block: SphairahedronAuthored,
): Record<SphairahedronNoteRow, string> {
  const refused = new Map<SphairahedronNoteRow, string[]>();
  const resolution = resolveSphairahedron(block);
  if (!resolution.ok) {
    for (const reason of resolution.reasons) {
      const row =
        REASON_ROWS.find(([pattern]) => pattern.test(reason))?.[1] ?? "block";
      refused.set(row, [...(refused.get(row) ?? []), reason]);
    }
  }
  const notes: Record<SphairahedronNoteRow, string> = {
    za: "",
    zb: "",
    z2: "",
    "inversion.cx": "",
    "inversion.cy": "",
    "inversion.cz": "",
    "inversion.cw": "",
    "inversion.r": "",
    family: "",
    finite: "",
    pick: "",
    block: "",
  };
  const repair: Record<SphairahedronNoteRow, string> = {
    za: "Move the slider to replace it.",
    zb: "Move the slider to replace it.",
    z2: "Move the slider to replace it.",
    "inversion.cx": "Move the slider to replace it.",
    "inversion.cy": "Move the slider to replace it.",
    "inversion.cz": "Move the slider to replace it.",
    "inversion.cw": "Move the slider to replace it.",
    "inversion.r": "Move the slider to replace it.",
    family: "Choose a family to replace it.",
    finite: "Pick an inversion sphere to repair it.",
    pick: "Pick an inversion sphere to repair it.",
    block:
      "This version cannot read it; turn Sphairahedron off and on to start from a valid scene.",
  };
  for (const [row, reasons] of refused) {
    notes[row] = `Refused: ${reasons.join("; ")}. ${repair[row]}`;
  }
  const numericFields: SphairahedronNumericField[] = [
    "za",
    "zb",
    "z2",
    "inversion.cx",
    "inversion.cy",
    "inversion.cz",
    "inversion.cw",
    "inversion.r",
  ];
  const family = sphairahedronFamily(block);
  const finite = sphairahedronIsFinite(block);
  for (const field of numericFields) {
    if (notes[field] !== "") continue;
    // A field the family does not read (za/zb on the tetra/prism, z2 on
    // the cubes) has no span and no row — its authored value is ignored,
    // never "kept outside a range".
    if (field === "za" || field === "zb") {
      if (family === null || !CUBE_FAMILIES.includes(family)) continue;
    } else if (field === "z2") {
      if (family !== "prism2") continue;
    } else if (!finite) {
      // The sphere rows hide while the construction is infinite.
      continue;
    }
    const raw = sphairahedronFieldAuthored(block, field);
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const range = sphairahedronFieldRange(block, field);
    if (raw >= range.min && raw <= range.max) continue;
    notes[field] =
      `${formatNumber(raw, range.precision)} is outside this slider's range ` +
      `${String(range.min)} to ${String(range.max)}; kept as authored.`;
  }
  return notes;
}
