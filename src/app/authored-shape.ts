import type { ShapePrimitive, ShapeSpec } from "../fractal/shapes";
import type { Vec3 } from "../fractal/types";

/** Analytic primitive kinds exposed by the single-part shape editor. */
export const AUTHORED_SHAPE_KINDS = [
  "sphere",
  "box",
  "torus",
  "capsule",
  "gear",
] as const;

export type AuthoredShapeKind = (typeof AUTHORED_SHAPE_KINDS)[number];

export type AuthoredShapePrimitive = Extract<
  ShapePrimitive,
  { kind: AuthoredShapeKind }
>;

/** The editor's total form value: an analytic primitive and its part pose. */
export interface AuthoredShapeDraft {
  primitive: AuthoredShapePrimitive;
  offset: Vec3;
  rotate: Vec3;
  scale: number;
}

const ZERO: Vec3 = [0, 0, 0];
// UI-domain floors are deliberately well above f64 underflow and mirror the
// editor sliders. Merely checking `> 0` would admit a shape whose analytic
// measure (or posed measure after scale^3) becomes zero in the sampler.
const MIN_LENGTH = 0.01;
const MIN_GEAR_RADIUS = 0.05;
const MIN_GEAR_TANGENTIAL = 0.001;
const MIN_PART_SCALE = 0.1;

function defaultPrimitive(kind: AuthoredShapeKind): AuthoredShapePrimitive {
  switch (kind) {
    case "sphere":
      return { kind, radius: 1 };
    case "box":
      return { kind, half: [0.75, 0.75, 0.75] };
    case "torus":
      // Deliberately not the bundled Orbit Ring: choosing Custom must keep
      // the parameter editor open after the document refresh classifies it.
      return { kind, major: 0.75, minor: 0.24 };
    case "capsule":
      return { kind, a: [0, -0.75, 0], b: [0, 0.75, 0], radius: 0.25 };
    case "gear":
      return {
        kind,
        // Deliberately not the bundled Cog for the same editor-identity rule
        // as the torus default above.
        teeth: 10,
        radius: 0.9,
        tooth: [0.18, 0.12],
        hole: 0.28,
        halfHeight: 0.3,
      };
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  );
}

function isAuthoredShapeKind(value: unknown): value is AuthoredShapeKind {
  return (
    typeof value === "string" &&
    (AUTHORED_SHAPE_KINDS as readonly string[]).includes(value)
  );
}

function cloneVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

function clonePrimitive(
  primitive: AuthoredShapePrimitive,
): AuthoredShapePrimitive {
  switch (primitive.kind) {
    case "sphere":
      return { kind: "sphere", radius: primitive.radius };
    case "box":
      return { kind: "box", half: cloneVec3(primitive.half) };
    case "torus":
      return {
        kind: "torus",
        major: primitive.major,
        minor: primitive.minor,
      };
    case "capsule":
      return {
        kind: "capsule",
        a: cloneVec3(primitive.a),
        b: cloneVec3(primitive.b),
        radius: primitive.radius,
      };
    case "gear":
      return {
        kind: "gear",
        teeth: primitive.teeth,
        radius: primitive.radius,
        tooth: [primitive.tooth[0], primitive.tooth[1]],
        hole: primitive.hole,
        halfHeight: primitive.halfHeight,
      };
  }
}

/** Return the first UI-domain error, or null when a draft is safe to author. */
export function authoredShapeValidation(
  draft: AuthoredShapeDraft,
): string | null {
  if (!draft || typeof draft !== "object") return "Shape draft is required.";
  if (!draft.primitive || typeof draft.primitive !== "object") {
    return "Primitive is required.";
  }
  if (!isFiniteVec3(draft.offset)) return "Offset must contain finite numbers.";
  if (!isFiniteVec3(draft.rotate))
    return "Rotation must contain finite numbers.";
  if (!isFiniteNumber(draft.scale) || draft.scale < MIN_PART_SCALE) {
    return `Scale must be at least ${MIN_PART_SCALE}.`;
  }

  const primitive = draft.primitive;
  if (!isAuthoredShapeKind(primitive.kind)) {
    return "Primitive must be an analytic authored shape.";
  }

  switch (primitive.kind) {
    case "sphere":
      if (!isFiniteNumber(primitive.radius) || primitive.radius < MIN_LENGTH) {
        return `Sphere radius must be at least ${MIN_LENGTH}.`;
      }
      return null;
    case "box":
      if (!isFiniteVec3(primitive.half)) {
        return "Box half extents must contain finite numbers.";
      }
      if (primitive.half.some((value) => value < MIN_LENGTH)) {
        return `Box half extents must be at least ${MIN_LENGTH}.`;
      }
      return null;
    case "torus":
      if (!isFiniteNumber(primitive.major) || primitive.major < MIN_LENGTH) {
        return `Torus major radius must be at least ${MIN_LENGTH}.`;
      }
      if (!isFiniteNumber(primitive.minor) || primitive.minor < MIN_LENGTH) {
        return `Torus minor radius must be at least ${MIN_LENGTH}.`;
      }
      if (primitive.minor > primitive.major) {
        return "Torus minor radius must not exceed its major radius.";
      }
      return null;
    case "capsule":
      if (!isFiniteVec3(primitive.a) || !isFiniteVec3(primitive.b)) {
        return "Capsule endpoints must contain finite numbers.";
      }
      if (!isFiniteNumber(primitive.radius) || primitive.radius < MIN_LENGTH) {
        return `Capsule radius must be at least ${MIN_LENGTH}.`;
      }
      return null;
    case "gear": {
      if (
        !isFiniteNumber(primitive.teeth) ||
        !Number.isInteger(primitive.teeth) ||
        primitive.teeth < 3 ||
        primitive.teeth > 64
      ) {
        return "Gear teeth must be an integer from 3 to 64.";
      }
      if (
        !isFiniteNumber(primitive.radius) ||
        primitive.radius < MIN_GEAR_RADIUS
      ) {
        return `Gear radius must be at least ${MIN_GEAR_RADIUS}.`;
      }
      if (
        !Array.isArray(primitive.tooth) ||
        primitive.tooth.length !== 2 ||
        !primitive.tooth.every(isFiniteNumber)
      ) {
        return "Gear tooth half sizes must contain finite numbers.";
      }
      if (
        primitive.tooth[0] < MIN_LENGTH ||
        primitive.tooth[1] < MIN_GEAR_TANGENTIAL
      ) {
        return `Gear tooth half sizes must be at least ${MIN_LENGTH} radial and ${MIN_GEAR_TANGENTIAL} tangential.`;
      }
      if (!isFiniteNumber(primitive.hole) || primitive.hole < 0) {
        return "Gear hole radius must be zero or greater.";
      }
      if (primitive.hole > primitive.radius - MIN_LENGTH) {
        return `Gear hole radius must leave at least ${MIN_LENGTH} of body.`;
      }
      if (
        !isFiniteNumber(primitive.halfHeight) ||
        primitive.halfHeight < MIN_LENGTH
      ) {
        return `Gear half height must be at least ${MIN_LENGTH}.`;
      }
      const tangentialLimit =
        primitive.radius * Math.sin(Math.PI / primitive.teeth);
      if (primitive.tooth[1] > tangentialLimit) {
        return "Gear tangential tooth half size must fit within one tooth sector.";
      }
      return null;
    }
  }
}

/** Build a valid one-part default in the document's ShapeSpec vocabulary. */
export function defaultAuthoredShape(
  kind: AuthoredShapeKind = "sphere",
): ShapeSpec {
  return authoredShapeFromDraft({
    primitive: defaultPrimitive(kind),
    offset: cloneVec3(ZERO),
    rotate: cloneVec3(ZERO),
    scale: 1,
  });
}

/**
 * Expand a document shape into the editor model. Only valid, one-part analytic
 * unions are editable; catalog meshes and authored compositions stay opaque.
 */
export function authoredShapeDraft(spec: ShapeSpec): AuthoredShapeDraft | null {
  if (!spec || !Array.isArray(spec.parts) || spec.parts.length !== 1)
    return null;
  const part = spec.parts[0];
  if (!part || part.combine !== "union") return null;
  if (!isAuthoredShapeKind(part.primitive?.kind)) return null;

  const source: AuthoredShapeDraft = {
    primitive: part.primitive,
    offset: part.pose?.offset ?? ZERO,
    rotate: part.pose?.rotate ?? ZERO,
    scale: part.pose?.scale ?? 1,
  };
  if (authoredShapeValidation(source) !== null) return null;
  return {
    primitive: clonePrimitive(source.primitive),
    offset: cloneVec3(source.offset),
    rotate: cloneVec3(source.rotate),
    scale: source.scale,
  };
}

/** Validate and compact an editor draft back into a one-part ShapeSpec. */
export function authoredShapeFromDraft(draft: AuthoredShapeDraft): ShapeSpec {
  const validation = authoredShapeValidation(draft);
  if (validation !== null) throw new RangeError(validation);

  const pose: NonNullable<ShapeSpec["parts"][number]["pose"]> = {};
  if (draft.offset.some((value) => value !== 0)) {
    pose.offset = cloneVec3(draft.offset);
  }
  if (draft.rotate.some((value) => value !== 0)) {
    pose.rotate = cloneVec3(draft.rotate);
  }
  if (draft.scale !== 1) pose.scale = draft.scale;

  const part: ShapeSpec["parts"][number] = {
    primitive: clonePrimitive(draft.primitive),
    combine: "union",
  };
  if (Object.keys(pose).length > 0) part.pose = pose;
  return { parts: [part] };
}
