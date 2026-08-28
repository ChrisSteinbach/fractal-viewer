import {
  MAX_SHAPE_PARTS,
  shapeSdfSource,
  type ShapePrimitive,
  type ShapeSpec,
} from "../fractal/shapes";
import { emitterSamplerCapability } from "../fractal/chaos-game";
import type { Vec3 } from "../fractal/types";

/** Analytic primitive kinds exposed by each part of the shape composer. */
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

/** Which existing ShapeSpec consumer is authoring a composition. */
export type ShapeComposerRole = "emitter" | "trap";

/** One total-form part in the flat composer working copy. */
export interface AuthoredShapePartDraft extends AuthoredShapeDraft {
  combine: "union" | "intersect";
}

/** The flat (deliberately non-recursive) ShapeSpec composer working copy. */
export interface AuthoredShapeComposerDraft {
  parts: AuthoredShapePartDraft[];
}

/**
 * Maximum generated SDF source admitted for either production shader dialect.
 *
 * A representative full-precision, fully posed eight-part gear draft fits
 * just below this per-spec cap. Keeping the limit here, at the authoring
 * boundary, also prevents pathological numeric literals or a future template
 * expansion from turning a small document value into oversized shader text.
 */
export const MAX_AUTHORED_SHAPE_SOURCE_BYTES = 8 * 1024;

/** Longest production identifiers a composed emitter can receive. The
 * source generator repeats the identifier in helper names and call sites,
 * so pricing a one-character test name understates the real shader bytes. */
const AUTHORED_SHAPE_BUDGET_GLSL_NAME = "condensation4Sdf23";
const AUTHORED_SHAPE_BUDGET_WGSL_NAME = "condensationShape23";

export interface AuthoredShapeModeCapability {
  eligible: boolean;
  reason: string | null;
}

export type AuthoredShapeCapabilityReason =
  "invalid" | "mesh" | "intersection" | "source-budget";

/** Renderer eligibility and composer disclosure for an existing ShapeSpec. */
export interface AuthoredShapeCapabilities {
  /** Analytic specs are editable; valid mesh/catalog specs stay opaque. */
  status: "editable" | "opaque";
  reason: AuthoredShapeCapabilityReason | null;
  message: string;
  /** UTF-8 bytes emitted by shapeSdfSource with one fixed short name. */
  glslBytes: number;
  /** UTF-8 bytes emitted by shapeSdfSource with one fixed short name. */
  wgslBytes: number;
  /** The larger of glslBytes and wgslBytes. */
  generatedSourceBytes: number;
  sourceBudgetOk: boolean;
  /** Whether the existing exact part sampler admits the spec. */
  sampleable: boolean;
  hasIntersection: boolean;
  modes: {
    emitter: AuthoredShapeModeCapability;
    trap: AuthoredShapeModeCapability;
  };
}

export type AuthoredShapeComposerStatus =
  | {
      status: "editable";
      reason: null;
      message: string;
      draft: AuthoredShapeComposerDraft;
      capabilities: AuthoredShapeCapabilities;
    }
  | {
      status: "opaque";
      reason: AuthoredShapeCapabilityReason;
      message: string;
      draft: null;
      capabilities: AuthoredShapeCapabilities;
    };

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

function cloneDraft(draft: AuthoredShapeDraft): AuthoredShapeDraft {
  return {
    primitive: clonePrimitive(draft.primitive),
    offset: cloneVec3(draft.offset),
    rotate: cloneVec3(draft.rotate),
    scale: draft.scale,
  };
}

function clonePartDraft(draft: AuthoredShapePartDraft): AuthoredShapePartDraft {
  return { ...cloneDraft(draft), combine: draft.combine };
}

function partDraftFromUnknown(part: unknown): AuthoredShapePartDraft | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as ShapeSpec["parts"][number];
  if (
    (candidate.combine !== "union" && candidate.combine !== "intersect") ||
    !candidate.primitive ||
    !isAuthoredShapeKind(candidate.primitive.kind)
  ) {
    return null;
  }
  const draft: AuthoredShapePartDraft = {
    primitive: candidate.primitive as AuthoredShapePrimitive,
    combine: candidate.combine,
    offset: candidate.pose?.offset ?? ZERO,
    rotate: candidate.pose?.rotate ?? ZERO,
    scale: candidate.pose?.scale ?? 1,
  };
  if (authoredShapeValidation(draft) !== null) return null;
  return clonePartDraft(draft);
}

function compactPartDraft(
  draft: AuthoredShapePartDraft,
): ShapeSpec["parts"][number] {
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
    combine: draft.combine,
  };
  if (Object.keys(pose).length > 0) part.pose = pose;
  return part;
}

function composerSpecUnchecked(draft: AuthoredShapeComposerDraft): ShapeSpec {
  return { parts: draft.parts.map(compactPartDraft) };
}

function utf8Bytes(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

function modeCapability(
  eligible: boolean,
  reason: string | null,
): AuthoredShapeModeCapability {
  return { eligible, reason: eligible ? null : reason };
}

interface CachedAuthoredShapeCapabilities {
  fingerprint: string;
  capabilities: AuthoredShapeCapabilities;
}

const authoredShapeCapabilitiesCache = new WeakMap<
  ShapeSpec,
  CachedAuthoredShapeCapabilities
>();

function shapeFingerprint(spec: ShapeSpec): string | null {
  try {
    return JSON.stringify(spec);
  } catch {
    return null;
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

/** Build one independent default part for composer add/replace operations. */
export function defaultAuthoredShapePart(
  kind: AuthoredShapeKind = "sphere",
): AuthoredShapePartDraft {
  return {
    primitive: defaultPrimitive(kind),
    combine: "union",
    offset: cloneVec3(ZERO),
    rotate: cloneVec3(ZERO),
    scale: 1,
  };
}

function authoredPartsValidForRendering(spec: ShapeSpec): boolean {
  if (!spec || !Array.isArray(spec.parts)) return false;
  for (const part of spec.parts) {
    if (!part || typeof part !== "object" || !part.primitive) return false;
    if (part.primitive.kind === "mesh") continue;
    if (!isAuthoredShapeKind(part.primitive.kind)) return false;
    const draft: AuthoredShapeDraft = {
      primitive: part.primitive,
      offset: part.pose?.offset ?? ZERO,
      rotate: part.pose?.rotate ?? ZERO,
      scale: part.pose?.scale ?? 1,
    };
    if (authoredShapeValidation(draft) !== null) return false;
  }
  return true;
}

/**
 * Prove that an all-analytic authored spec has finite positive sampler
 * measure without preparing its sampler. The gear sampler's exact measure is
 * a fixed 65,536-point probe, so composer keystrokes use its enclosing
 * cylinder as a cheap finite upper bound. UI-domain validation supplies the
 * corresponding positive lower bound for every primitive.
 */
function authoredAnalyticMeasuresAreFinite(spec: ShapeSpec): boolean {
  let totalUpperBound = 0;
  for (const part of spec.parts) {
    const primitive = part.primitive;
    if (!isAuthoredShapeKind(primitive.kind)) return false;
    let measureUpperBound: number;
    switch (primitive.kind) {
      case "sphere":
        measureUpperBound = (4 / 3) * Math.PI * primitive.radius ** 3;
        break;
      case "box":
        measureUpperBound =
          8 * primitive.half[0] * primitive.half[1] * primitive.half[2];
        break;
      case "torus":
        measureUpperBound =
          2 * Math.PI * Math.PI * primitive.major * primitive.minor ** 2;
        break;
      case "capsule": {
        const length = Math.hypot(
          primitive.b[0] - primitive.a[0],
          primitive.b[1] - primitive.a[1],
          primitive.b[2] - primitive.a[2],
        );
        measureUpperBound =
          Math.PI * primitive.radius ** 2 * length +
          (4 / 3) * Math.PI * primitive.radius ** 3;
        break;
      }
      case "gear": {
        const outer = Math.hypot(
          primitive.radius + primitive.tooth[0],
          primitive.tooth[1],
        );
        measureUpperBound = Math.PI * outer ** 2 * (2 * primitive.halfHeight);
        break;
      }
    }
    const scale = part.pose?.scale ?? 1;
    totalUpperBound += measureUpperBound * scale ** 3;
    if (!Number.isFinite(totalUpperBound)) return false;
  }
  return totalUpperBound > 0;
}

/**
 * Inspect one document spec without throwing. Rendering capability is kept
 * separate from composer editability: valid mesh/catalog specs may remain
 * eligible in both consumers while the analytic composer preserves them as
 * opaque values.
 */
export function analyzeAuthoredShapeCapabilities(
  spec: ShapeSpec,
): AuthoredShapeCapabilities {
  const fingerprint = shapeFingerprint(spec);
  const cached = authoredShapeCapabilitiesCache.get(spec);
  if (fingerprint !== null && cached?.fingerprint === fingerprint) {
    return cached.capabilities;
  }
  const parts = spec && Array.isArray(spec.parts) ? spec.parts : [];
  const hasIntersection = parts.some(
    (part) => part && part.combine === "intersect",
  );
  const hasMesh = parts.some((part) => part && part.primitive?.kind === "mesh");
  let glslBytes = 0;
  let wgslBytes = 0;
  let sourceValid = false;
  try {
    glslBytes = utf8Bytes(
      shapeSdfSource(spec, "glsl", AUTHORED_SHAPE_BUDGET_GLSL_NAME, {
        meshIndex: () => 23,
      }),
    );
    wgslBytes = utf8Bytes(
      shapeSdfSource(spec, "wgsl", AUTHORED_SHAPE_BUDGET_WGSL_NAME, {
        meshIndex: () => 23,
      }),
    );
    sourceValid = true;
  } catch {
    // Imported/future malformed values are deliberately a total opaque
    // status here. The document decoder/renderer retains responsibility for
    // deciding whether such a value can enter state at all.
  }
  const generatedSourceBytes = Math.max(glslBytes, wgslBytes);
  const sourceBudgetOk =
    sourceValid &&
    glslBytes <= MAX_AUTHORED_SHAPE_SOURCE_BYTES &&
    wgslBytes <= MAX_AUTHORED_SHAPE_SOURCE_BYTES;
  const numericDomainsValid = authoredPartsValidForRendering(spec);
  // A structurally valid all-union analytic spec in the UI-safe numeric
  // domain has positive measure by construction. Derive that answer instead
  // of running the gear sampler's 65,536-point measure probe on every
  // temporary composer validation. Opaque/imported values still ask the one
  // typed renderer capability so their actual fallback is disclosed.
  const safelySampleableAnalytic =
    sourceValid &&
    !hasMesh &&
    !hasIntersection &&
    numericDomainsValid &&
    authoredAnalyticMeasuresAreFinite(spec);
  const sampler = safelySampleableAnalytic
    ? null
    : emitterSamplerCapability(spec);
  const sampleable =
    safelySampleableAnalytic || sampler?.status === "sampleable";
  const emitterReason = sampleable
    ? null
    : sampler?.status === "unsupported"
      ? sampler.reason === "intersection"
        ? "Intersections are distance-field only and cannot be sampled by an emitter."
        : `This shape has no emitter sampler: ${sampler.detail}`
      : "This shape has no parts to emit.";
  const trapReason = !sourceValid
    ? "This shape is invalid and cannot generate a Surface distance field."
    : !sourceBudgetOk
      ? `Generated shape source exceeds the ${MAX_AUTHORED_SHAPE_SOURCE_BYTES}-byte per-dialect budget.`
      : null;

  let reason: AuthoredShapeCapabilityReason | null = null;
  let message = "Editable analytic shape; emitter and surface-trap eligible.";
  if (!sourceValid) {
    reason = "invalid";
    message = "This imported shape is invalid and is preserved as opaque.";
  } else if (hasMesh) {
    reason = "mesh";
    message =
      "Mesh/catalog shapes are preserved exactly but are not editable in the analytic composer.";
  } else if (!sourceBudgetOk) {
    reason = "source-budget";
    message = `Generated shape source is ${generatedSourceBytes} bytes; the per-dialect limit is ${MAX_AUTHORED_SHAPE_SOURCE_BYTES} bytes.`;
  } else if (hasIntersection) {
    reason = "intersection";
    message =
      "Surface-trap eligible; intersections are not eligible for emitter sampling.";
  } else if (!numericDomainsValid) {
    reason = "invalid";
    message =
      "This imported shape is outside the analytic composer's safe parameter ranges and is preserved as opaque.";
  }

  const capabilities: AuthoredShapeCapabilities = {
    status:
      !hasMesh && numericDomainsValid && sourceBudgetOk ? "editable" : "opaque",
    reason,
    message,
    glslBytes,
    wgslBytes,
    generatedSourceBytes,
    sourceBudgetOk,
    sampleable,
    hasIntersection,
    modes: {
      emitter: modeCapability(sampleable, emitterReason),
      trap: modeCapability(sourceValid && sourceBudgetOk, trapReason),
    },
  };
  if (fingerprint !== null) {
    authoredShapeCapabilitiesCache.set(spec, { fingerprint, capabilities });
  }
  return capabilities;
}

/** Return the first role-aware composer error, or null when safe to author. */
export function authoredShapeComposerValidation(
  draft: AuthoredShapeComposerDraft,
  role: ShapeComposerRole,
): string | null {
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.parts)) {
    return "Shape composition is required.";
  }
  if (draft.parts.length < 1 || draft.parts.length > MAX_SHAPE_PARTS) {
    return `Shape composition must contain 1 to ${MAX_SHAPE_PARTS} parts.`;
  }
  if (role !== "emitter" && role !== "trap") {
    return "Shape composer role must be emitter or trap.";
  }
  for (let index = 0; index < draft.parts.length; index += 1) {
    const part = draft.parts[index];
    if (!part || typeof part !== "object") {
      return `Part ${index + 1} is required.`;
    }
    if (part.combine !== "union" && part.combine !== "intersect") {
      return `Part ${index + 1} must use union or intersect.`;
    }
    if (index === 0 && part.combine !== "union") {
      return "The first shape part must use union.";
    }
    if (role === "emitter" && part.combine !== "union") {
      return "Emitter parts must all use union; intersections cannot be sampled.";
    }
    const validation = authoredShapeValidation(part);
    if (validation !== null) return `Part ${index + 1}: ${validation}`;
  }

  const capabilities = analyzeAuthoredShapeCapabilities(
    composerSpecUnchecked(draft),
  );
  if (!capabilities.sourceBudgetOk) {
    return capabilities.reason === "source-budget"
      ? capabilities.message
      : "Shape composition could not generate valid shader source.";
  }
  if (role === "emitter" && !capabilities.modes.emitter.eligible) {
    return (
      capabilities.modes.emitter.reason ??
      "Shape composition has no emitter sampler."
    );
  }
  return null;
}

/**
 * Expand an analytic document composition into the total-form editor model.
 * Emitter drafts admit unions only; trap drafts may intersect after part 0.
 * Meshes and malformed/future specs remain opaque (null).
 */
export function authoredShapeComposerDraft(
  spec: ShapeSpec,
  role: ShapeComposerRole,
): AuthoredShapeComposerDraft | null {
  if (!spec || !Array.isArray(spec.parts)) return null;
  if (spec.parts.length < 1 || spec.parts.length > MAX_SHAPE_PARTS) return null;
  const parts: AuthoredShapePartDraft[] = [];
  for (const source of spec.parts) {
    const part = partDraftFromUnknown(source);
    if (!part) return null;
    parts.push(part);
  }
  const draft = { parts };
  return authoredShapeComposerValidation(draft, role) === null ? draft : null;
}

/** Validate and compact a composer draft back into ShapeSpec vocabulary. */
export function authoredShapeComposerFromDraft(
  draft: AuthoredShapeComposerDraft,
  role: ShapeComposerRole,
): ShapeSpec {
  const validation = authoredShapeComposerValidation(draft, role);
  if (validation !== null) throw new RangeError(validation);
  return composerSpecUnchecked(draft);
}

/** Total editability result for UI disclosure; never throws on imports. */
export function authoredShapeComposerStatus(
  spec: ShapeSpec,
  role: ShapeComposerRole,
): AuthoredShapeComposerStatus {
  const capabilities = analyzeAuthoredShapeCapabilities(spec);
  const draft = authoredShapeComposerDraft(spec, role);
  if (draft) {
    return {
      status: "editable",
      reason: null,
      message: capabilities.message,
      draft,
      capabilities,
    };
  }
  let reason = capabilities.reason ?? "invalid";
  let message = capabilities.message;
  if (role === "emitter" && capabilities.reason === "intersection") {
    reason = "intersection";
    message =
      capabilities.modes.emitter.reason ??
      "Intersections cannot be sampled by an emitter.";
  }
  return {
    status: "opaque",
    reason,
    message,
    draft: null,
    capabilities,
  };
}

/** Immutably append a union part, enforcing the fixed GPU part capacity. */
export function addAuthoredShapePart(
  draft: AuthoredShapeComposerDraft,
  kind: AuthoredShapeKind = "sphere",
): AuthoredShapeComposerDraft {
  if (!draft || !Array.isArray(draft.parts)) {
    throw new RangeError("Shape composition is required.");
  }
  if (draft.parts.length >= MAX_SHAPE_PARTS) {
    throw new RangeError(
      `Shape composition cannot exceed ${MAX_SHAPE_PARTS} parts.`,
    );
  }
  return {
    parts: [...draft.parts.map(clonePartDraft), defaultAuthoredShapePart(kind)],
  };
}

/** Immutably remove one part while preserving the one-part minimum. */
export function removeAuthoredShapePart(
  draft: AuthoredShapeComposerDraft,
  index: number,
): AuthoredShapeComposerDraft {
  if (!draft || !Array.isArray(draft.parts) || draft.parts.length <= 1) {
    throw new RangeError("Shape composition must keep at least one part.");
  }
  if (!Number.isInteger(index) || index < 0 || index >= draft.parts.length) {
    throw new RangeError(`Shape part index ${index} is out of range.`);
  }
  const parts = draft.parts
    .filter((_part, partIndex) => partIndex !== index)
    .map(clonePartDraft);
  // The fold has no left operand at index zero.
  parts[0].combine = "union";
  return { parts };
}

/** Immutably move a part and restore the fold's mandatory first union. */
export function reorderAuthoredShapePart(
  draft: AuthoredShapeComposerDraft,
  fromIndex: number,
  toIndex: number,
): AuthoredShapeComposerDraft {
  if (!draft || !Array.isArray(draft.parts)) {
    throw new RangeError("Shape composition is required.");
  }
  for (const index of [fromIndex, toIndex]) {
    if (!Number.isInteger(index) || index < 0 || index >= draft.parts.length) {
      throw new RangeError(`Shape part index ${index} is out of range.`);
    }
  }
  const parts = draft.parts.map(clonePartDraft);
  const [moved] = parts.splice(fromIndex, 1);
  parts.splice(toIndex, 0, moved);
  parts[0].combine = "union";
  return { parts };
}

/** Build a valid one-part default in the document's ShapeSpec vocabulary. */
export function defaultAuthoredShape(
  kind: AuthoredShapeKind = "sphere",
): ShapeSpec {
  return authoredShapeComposerFromDraft(
    { parts: [defaultAuthoredShapePart(kind)] },
    "emitter",
  );
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
