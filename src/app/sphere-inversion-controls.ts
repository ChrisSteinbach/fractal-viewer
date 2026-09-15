/**
 * The sphere-inversion panel controls' pure half: the PUBLIC ranges, the
 * absent-means-default write rule, and the per-row disclosures, tested
 * without jsdom the way `control-spec.ts` is. `control-spec.ts` reads and
 * writes through these functions; `ui.ts` only paints what they return.
 *
 * PLACEMENT (docs/panel-ia.md's four-property record). Home: **Scene /
 * Look** — the block is the scene's authored SUBJECT, replacing the
 * transform system, so it sits beside Transforms rather than in the Surface
 * inspector even though only Points and Surface draw it. Consumers: Points
 * (the exact boundary sampler) and Surface (the `sphereInversion` /
 * `sphereInversion4` session kinds), in 3D and native 4D; Flame and Sampled
 * Solid refuse the family. Lifetime: document. Edit behavior: Points follows
 * Auto-update; a live Surface session RESTARTS (a slider on release) without
 * refitting the camera; Flame/Solid refused with the adjacent reason.
 *
 * THE RANGES are the measured public ranges recorded in
 * `docs/sphere-inversion-family.md` ("Public ranges"). They narrow the
 * CONTROL only: the resolver's document domain is wider (depth to 32, radius
 * fraction to 1, any positive length), a document may carry any of it, and
 * nothing here clamps. A value outside a slider's span widens that slider to
 * itself and is disclosed beside it; a value the resolver refuses is kept
 * verbatim and disclosed with the resolver's own reason.
 *
 * ABSENT MEANS DEFAULT, byte-identically — the fold-length rows' rule: a
 * field is written only once its control moves, and moving it onto the
 * resolver's default for the current seed kind REMOVES it again (an emptied
 * seed object goes with it).
 */
import {
  SPHERE_INVERSION_ARRANGEMENTS,
  SPHERE_INVERSION_DEFAULTS,
  SPHERE_INVERSION_SEED_KINDS,
  resolveSphereInversion,
  sphereInversionAuthoredDimension,
} from "../fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionSeedKind,
} from "../fractal/sphere-inversion";
import { PRESET_SPHERE_INVERSIONS } from "../fractal/presets";

/** The numeric fields the panel exposes. The cut DIRECTION stays
 * document-only: no public range was measured for it. */
export type SphereInversionNumericField =
  "radiusFraction" | "depth" | "size" | "thickness" | "cutRadius" | "cutOffset";

/** Every row that can carry a disclosure: the numeric fields, the two
 * selects, the seed as a whole (refusals that name no single length, such
 * as a shell sphere through a generator centre), and the block itself
 * (unknown fields, a non-object block). */
export type SphereInversionNoteRow =
  SphereInversionNumericField | "arrangement" | "kind" | "seed" | "block";

export interface SphereInversionFieldRange {
  min: number;
  max: number;
  step: number;
  precision: number;
}

/** The value a select shows when the document names something this version
 * does not offer (an unknown arrangement id or seed kind). */
export const SPHERE_INVERSION_AUTHORED_OPTION = "__authored";

/** Why the section is unavailable in Flame and Sampled Solid while no block
 * is present (with one present, those modes are already refused beside the
 * mode switch and the app leaves them). */
export const SPHERE_INVERSION_CONTROLS_MODE_REASON =
  "Flame and Sampled Solid cannot draw a sphere-inversion scene. Switch to Points or Surface to add or edit one.";

const SEED_FIELDS: readonly SphereInversionNumericField[] = [
  "size",
  "thickness",
  "cutRadius",
  "cutOffset",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function seedOf(block: SphereInversionAuthored): Record<string, unknown> {
  const seed: unknown = (block as Record<string, unknown>).seed;
  return isPlainObject(seed) ? seed : {};
}

/** The seed kind the resolver reads (absent means `ball`), or `null` when
 * the document names a kind this version does not know. */
export function sphereInversionSeedKind(
  block: SphereInversionAuthored,
): SphereInversionSeedKind | null {
  const kind = seedOf(block).kind ?? SPHERE_INVERSION_DEFAULTS.seedKind;
  return (SPHERE_INVERSION_SEED_KINDS as readonly unknown[]).includes(kind)
    ? (kind as SphereInversionSeedKind)
    : null;
}

/** The public range of one control. Size reads the kind (a ball radius and
 * a shell's mid radius are different lengths); cut offset reads the
 * dimension. The 4D shell size uses the 3D span: 4D was measured at .9 and
 * 1.1 only, and seed lengths moved 4D cost by at most 40%. */
export function sphereInversionFieldRange(
  block: SphereInversionAuthored,
  field: SphereInversionNumericField,
): SphereInversionFieldRange {
  switch (field) {
    case "radiusFraction":
      return { min: 0.6, max: 0.99, step: 0.01, precision: 3 };
    case "depth":
      return { min: 0, max: 12, step: 1, precision: 0 };
    case "size":
      return sphereInversionSeedKind(block) === "ball" ||
        sphereInversionSeedKind(block) === null
        ? { min: 0.15, max: 0.8, step: 0.01, precision: 3 }
        : { min: 0.7, max: 1.3, step: 0.01, precision: 3 };
    case "thickness":
      return { min: 0.01, max: 0.1, step: 0.005, precision: 3 };
    case "cutRadius":
      return { min: 2, max: 50, step: 0.5, precision: 2 };
    case "cutOffset":
      return sphereInversionAuthoredDimension(block) === 4
        ? { min: -0.4, max: 0.8, step: 0.01, precision: 3 }
        : { min: -0.5, max: 0.8, step: 0.01, precision: 3 };
  }
}

/** The resolver's absent-field value for `field` under the block's CURRENT
 * seed kind (`SPHERE_INVERSION_DEFAULTS`, read the resolver's way). */
export function sphereInversionFieldDefault(
  block: SphereInversionAuthored,
  field: SphereInversionNumericField,
): number {
  const D = SPHERE_INVERSION_DEFAULTS;
  const kind = sphereInversionSeedKind(block);
  switch (field) {
    case "radiusFraction":
      return D.radiusFraction;
    case "depth":
      return D.depth;
    case "size":
      return kind === "shell" || kind === "cutShell" ? D.shellSize : D.ballSize;
    case "thickness":
      return kind === "cutShell" ? D.cutShellThickness : D.shellThickness;
    case "cutRadius":
      return D.cutRadius;
    case "cutOffset":
      return D.cutOffset;
  }
}

/** The raw authored value of `field` (`undefined` when absent), whatever its
 * JSON type — an imported document is untrusted. */
export function sphereInversionFieldAuthored(
  block: SphereInversionAuthored,
  field: SphereInversionNumericField,
): unknown {
  return SEED_FIELDS.includes(field)
    ? seedOf(block)[field]
    : (block as Record<string, unknown>)[field];
}

/** The number a control SHOWS: the authored value when it is a finite
 * number (in range or not — never clamped), otherwise the default, with
 * {@link sphereInversionControlNotes} disclosing what the document holds. */
export function sphereInversionFieldValue(
  block: SphereInversionAuthored,
  field: SphereInversionNumericField,
): number {
  const raw = sphereInversionFieldAuthored(block, field);
  return typeof raw === "number" && Number.isFinite(raw)
    ? raw
    : sphereInversionFieldDefault(block, field);
}

/** Write one numeric field: the value, or — on the resolver's default for
 * the current kind — no key at all. Never mutates `block`. */
export function withSphereInversionField(
  block: SphereInversionAuthored,
  field: SphereInversionNumericField,
  value: number,
): SphereInversionAuthored {
  const isDefault = value === sphereInversionFieldDefault(block, field);
  if (!SEED_FIELDS.includes(field)) {
    const next: Record<string, unknown> = { ...block };
    if (isDefault) delete next[field];
    else next[field] = value;
    return next;
  }
  const seed: Record<string, unknown> = { ...seedOf(block) };
  if (isDefault) delete seed[field];
  else seed[field] = value;
  return withSeed(block, seed);
}

function withSeed(
  block: SphereInversionAuthored,
  seed: Record<string, unknown>,
): SphereInversionAuthored {
  const next: Record<string, unknown> = { ...block };
  if (Object.keys(seed).length === 0) delete next.seed;
  else next.seed = seed;
  return next;
}

/**
 * Switch the seed kind. `ball` is the absent value, so choosing it removes
 * the key. Crossing between the ball and the shell kinds also removes a
 * present `size`: it is a ball RADIUS on one side and a shell's MID radius
 * on the other, the defaults differ (.28 against 1), and carrying a ball's
 * .28 into a shell would draw a tiny shell inside the central void instead
 * of the shell the kind names. Thickness and the cut fields stay (a kind
 * that does not read them ignores them, the resolver's own rule), so
 * shell <-> cut shell keeps every length.
 */
export function withSphereInversionSeedKind(
  block: SphereInversionAuthored,
  kind: SphereInversionSeedKind,
): SphereInversionAuthored {
  const current = sphereInversionSeedKind(block);
  if (current === kind) return block;
  const seed: Record<string, unknown> = { ...seedOf(block) };
  const shellFamily = (k: SphereInversionSeedKind | null) =>
    k === "shell" || k === "cutShell";
  if (shellFamily(current) !== shellFamily(kind)) delete seed.size;
  if (kind === SPHERE_INVERSION_DEFAULTS.seedKind) delete seed.kind;
  else seed.kind = kind;
  return withSeed(block, seed);
}

/**
 * Switch the arrangement, which decides the scene's dimension. Leaving 4D
 * drops a present `cutDirectionW`: the resolver refuses a nonzero w on a 3D
 * arrangement, and the panel offers no control to clear it, so keeping it
 * would strand the scene on a refusal the user cannot repair here.
 */
export function withSphereInversionArrangement(
  block: SphereInversionAuthored,
  id: string,
): SphereInversionAuthored {
  if (!Object.prototype.hasOwnProperty.call(SPHERE_INVERSION_ARRANGEMENTS, id))
    return block;
  if ((block as Record<string, unknown>).arrangement === id) return block;
  const next = { ...block, arrangement: id };
  if (
    SPHERE_INVERSION_ARRANGEMENTS[id].dim === 3 &&
    seedOf(block).cutDirectionW !== undefined
  ) {
    const seed = { ...seedOf(block) };
    delete seed.cutDirectionW;
    return withSeed(next, seed);
  }
  return next;
}

/** The select value for the arrangement: a registry id, or
 * {@link SPHERE_INVERSION_AUTHORED_OPTION}. */
export function sphereInversionArrangementValue(
  block: SphereInversionAuthored,
): string {
  const id: unknown = (block as Record<string, unknown>).arrangement;
  return typeof id === "string" &&
    Object.prototype.hasOwnProperty.call(SPHERE_INVERSION_ARRANGEMENTS, id)
    ? id
    : SPHERE_INVERSION_AUTHORED_OPTION;
}

/** The select value for the seed kind. */
export function sphereInversionSeedKindValue(
  block: SphereInversionAuthored,
): string {
  return sphereInversionSeedKind(block) ?? SPHERE_INVERSION_AUTHORED_OPTION;
}

/**
 * The block the enable gesture seeds, as a fresh object: a shipped showcase's
 * own form, so what appears is a subject already measured inside the public
 * ranges. A flat scene gets Kissing Pearls (oct6, D8, ~10 s settle); a 4D
 * scene gets 600-Cell Medallions (cell600 shell, D5, ~23 s) so adding the
 * block does not silently turn a 4D scene 3D.
 */
export function defaultSphereInversionBlock(
  nonFlat: boolean,
): SphereInversionAuthored {
  const factory = nonFlat
    ? PRESET_SPHERE_INVERSIONS.inversionMedallions4
    : PRESET_SPHERE_INVERSIONS.inversionPearls;
  if (!factory) throw new Error("sphere-inversion showcase preset missing");
  return factory();
}

/** Which rows the block's seed kind reads (the arrangement, radius, kind and
 * depth rows always show while a block is present). */
export function sphereInversionVisibleRows(
  block: SphereInversionAuthored,
): Record<"size" | "thickness" | "cutRadius" | "cutOffset", boolean> {
  const kind = sphereInversionSeedKind(block);
  return {
    size: kind !== null,
    thickness: kind === "shell" || kind === "cutShell",
    cutRadius: kind === "cutShell",
    cutOffset: kind === "cutShell",
  };
}

const REASON_ROWS: readonly [RegExp, SphereInversionNoteRow][] = [
  [/^(unknown arrangement|no arrangement)/, "arrangement"],
  [
    /^(generator radius fraction|generators \d+ and \d+ overlap)/,
    "radiusFraction",
  ],
  [/^depth /, "depth"],
  [/^(unknown seed kind|seed is not an object)/, "kind"],
  [/^seed size/, "size"],
  [/^shell thickness/, "thickness"],
  [/^cut radius/, "cutRadius"],
  [/^cut offset/, "cutOffset"],
  [/^(cut direction|seed member|the seed has)/, "seed"],
];

function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(Math.max(precision, 3))));
}

/**
 * The disclosure beside each row, `""` where there is none. A resolver
 * refusal lands on the row whose field it names (the whole seed, or the
 * block, when it names no one field) and says how to repair it; a value the
 * resolver accepts but the slider's span does not include is disclosed as
 * kept. Neither ever rewrites the document.
 */
export function sphereInversionControlNotes(
  block: SphereInversionAuthored,
): Record<SphereInversionNoteRow, string> {
  const refused = new Map<SphereInversionNoteRow, string[]>();
  const resolution = resolveSphereInversion(block);
  if (!resolution.ok) {
    for (const reason of resolution.reasons) {
      const row =
        REASON_ROWS.find(([pattern]) => pattern.test(reason))?.[1] ?? "block";
      refused.set(row, [...(refused.get(row) ?? []), reason]);
    }
  }
  const notes: Record<SphereInversionNoteRow, string> = {
    radiusFraction: "",
    depth: "",
    size: "",
    thickness: "",
    cutRadius: "",
    cutOffset: "",
    arrangement: "",
    kind: "",
    seed: "",
    block: "",
  };
  const repair: Record<SphereInversionNoteRow, string> = {
    radiusFraction: "Move the slider to replace it.",
    depth: "Move the slider to replace it.",
    size: "Move the slider to replace it.",
    thickness: "Move the slider to replace it.",
    cutRadius: "Move the slider to replace it.",
    cutOffset: "Move the slider to replace it.",
    arrangement: "Choose an arrangement to replace it.",
    kind: "Choose a seed kind to replace it.",
    seed: "Change the seed lengths to repair it.",
    block:
      "This version cannot read it; turn Sphere inversion off and on to start from a valid scene.",
  };
  for (const [row, reasons] of refused) {
    notes[row] = `Refused: ${reasons.join("; ")}. ${repair[row]}`;
  }
  const numericFields: SphereInversionNumericField[] = [
    "radiusFraction",
    "depth",
    ...SEED_FIELDS,
  ];
  for (const field of numericFields) {
    if (notes[field] !== "") continue;
    const raw = sphereInversionFieldAuthored(block, field);
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const range = sphereInversionFieldRange(block, field);
    if (raw >= range.min && raw <= range.max) continue;
    notes[field] =
      `${formatNumber(raw, range.precision)} is outside this slider's range ` +
      `${String(range.min)} to ${String(range.max)}; kept as authored.`;
  }
  return notes;
}
