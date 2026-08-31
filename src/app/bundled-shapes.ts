import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  GEAR_SHAPE,
  HEART_PRISM_SHAPE,
  ORBIT_RING_SHAPE,
  PEACE_SIGN_SHAPE,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
  type ShapeSpec,
} from "../fractal/shapes";

/**
 * A shape shipped with the app and the authoring surfaces on which it is
 * offered. The ShapeSpec is the canonical document value: pickers install it
 * directly, while imported specs are recognized by exact structural equality
 * (including the codec's canonical four-decimal representation) so an unknown
 * authored shape is never rewritten accidentally.
 */
export interface BundledShapeDefinition {
  readonly kind: string;
  readonly label: string;
  readonly icon: string;
  readonly shape: ShapeSpec;
  readonly emitter: boolean;
  readonly trap: boolean;
}

/**
 * The single bundled-shape catalog. Order is user-facing picker order; kind
 * strings are stable UI identifiers, not a persistence schema (the document
 * continues to carry only the ShapeSpec).
 */
export const BUNDLED_SHAPES = [
  {
    kind: "gear",
    label: "Cog",
    icon: "⚙",
    shape: GEAR_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "star",
    label: "Star",
    icon: "★",
    shape: STAR_PRISM_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "orbit-ring",
    label: "Orbit Ring",
    icon: "◎",
    shape: ORBIT_RING_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "faceted-crystal",
    label: "Faceted Crystal",
    icon: "◆",
    shape: FACETED_CRYSTAL_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "heart-prism",
    label: "Heart Prism",
    icon: "♥",
    shape: HEART_PRISM_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "trefoil-knot",
    label: "Trefoil Knot",
    icon: "⌘",
    shape: TREFOIL_KNOT_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "crescent-moon",
    label: "Crescent Moon",
    icon: "☾",
    shape: CRESCENT_MOON_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "snowflake-prism",
    label: "Snowflake Prism",
    icon: "❄",
    shape: SNOWFLAKE_PRISM_SHAPE,
    emitter: true,
    trap: true,
  },
  {
    kind: "peace",
    label: "Peace sign",
    icon: "☮",
    shape: PEACE_SIGN_SHAPE,
    emitter: true,
    trap: true,
  },
] as const satisfies readonly BundledShapeDefinition[];

export type BundledShape = (typeof BUNDLED_SHAPES)[number];
export type BundledShapeKind = BundledShape["kind"];
export type BundledEmitterShape = Extract<BundledShape, { emitter: true }>;
export type BundledEmitterKind = BundledEmitterShape["kind"];
export type BundledTrapShape = Extract<BundledShape, { trap: true }>;
export type BundledTrapKind = BundledTrapShape["kind"];

export const BUNDLED_EMITTER_SHAPES: readonly BundledEmitterShape[] =
  BUNDLED_SHAPES.filter((entry): entry is BundledEmitterShape => entry.emitter);

export const BUNDLED_TRAP_SHAPES: readonly BundledTrapShape[] =
  BUNDLED_SHAPES.filter((entry): entry is BundledTrapShape => entry.trap);

/** The label used in a picker option, keeping icon/name formatting central. */
export function bundledShapeOptionLabel(
  entry: Pick<BundledShapeDefinition, "icon" | "label">,
): string {
  return entry.icon ? `${entry.icon} ${entry.label}` : entry.label;
}

/** Resolve any string at the untyped DOM boundary to a registered entry. */
export function bundledShapeEntry(kind: string): BundledShape | undefined {
  return BUNDLED_SHAPES.find((entry) => entry.kind === kind);
}

/** Resolve a typed bundled kind to its canonical document ShapeSpec. */
export function bundledShapeSpec(kind: BundledShapeKind): ShapeSpec {
  const entry = bundledShapeEntry(kind);
  if (!entry) throw new Error(`Unknown bundled shape: ${kind}`);
  return entry.shape;
}

/** Resolve an emitter-eligible kind to its canonical document ShapeSpec. */
export function bundledEmitterShape(kind: BundledEmitterKind): ShapeSpec {
  const entry = bundledShapeEntry(kind);
  if (!entry?.emitter) throw new Error(`Unknown bundled emitter: ${kind}`);
  return entry.shape;
}

function shapeKey(shape: ShapeSpec): string {
  return JSON.stringify(shape);
}

/** The existing v1 emitter codec's numeric representation. This is lookup
 * metadata only: kinds still never ride the wire. It lets Peace's SQRT1_2
 * capsule endpoints return from a saved/shared scene as Peace rather than the
 * Authored sentinel, without changing PEACE_SIGN_SHAPE or its wire bytes. */
function wireShapeKey(shape: ShapeSpec): string {
  return JSON.stringify(shape, (_key, value: unknown) =>
    typeof value === "number" ? Math.round(value * 10_000) / 10_000 : value,
  );
}

/** Match any canonical bundled shape, independent of authoring role.
 * Finite tiling uses this to display its optional narrowing clip without
 * pretending the clip is either an emitter or an orbit trap. */
export function bundledShapeForShape(
  shape: ShapeSpec,
): BundledShape | undefined {
  const key = shapeKey(shape);
  return BUNDLED_SHAPES.find(
    (entry) =>
      shapeKey(entry.shape) === key || wireShapeKey(entry.shape) === key,
  );
}

/** Match an emitter-eligible canonical spec, or leave it authored/custom. */
export function bundledEmitterForShape(
  shape: ShapeSpec,
): BundledEmitterShape | undefined {
  const entry = bundledShapeForShape(shape);
  return entry?.emitter ? entry : undefined;
}

/** Match a trap-eligible canonical spec, or leave it authored/custom. */
export function bundledTrapForShape(
  shape: ShapeSpec,
): BundledTrapShape | undefined {
  const entry = bundledShapeForShape(shape);
  return entry?.trap ? entry : undefined;
}
