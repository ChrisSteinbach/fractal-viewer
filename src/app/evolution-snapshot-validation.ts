/**
 * Exact, rejecting runtime validator for crossover-v1 SceneSnapshot inputs.
 *
 * This is intentionally not the portable codec: it never repairs, clamps,
 * rounds, migrates, or drops a field. Every versioned object boundary has an
 * exhaustive key whitelist tied to its TypeScript interface, so a newly-added
 * document field fails compilation until crossover-v1 assigns a policy.
 */
import { MAX_SCHEDULE_DEPTH, MAX_TRANSFORMS } from "../fractal/chaos-game";
import {
  COLOR_MODES,
  FOUR_D_COLOR_MODES,
  SHAPE_TRAP_MODES,
  SYMMETRY_PLANES,
  VARIATION_TYPES,
  type HybridSchedule,
  type ShapeTrap,
  type SurfaceFinish,
  type SymmetryParams,
  type Transform,
  type Variation,
  type WExtension,
} from "../fractal/types";
import {
  MAX_SHAPE_PARTS,
  type ShapePart,
  type ShapePose,
  type ShapePrimitive,
  type ShapeSpec,
} from "../fractal/shapes";
import { isMeshAssetId } from "../fractal/mesh-shapes";
import {
  SURFACE_PATTERN_AXES,
  SURFACE_PATTERN_KINDS,
  type SurfacePattern,
} from "../fractal/surface-pattern";
import type { CondensationDepthBand } from "../fractal/condensation-de";
import { SHAPE_TRAP_GEOMETRY_LEVEL_MAX } from "../fractal/shape-trap";
import {
  CUSTOM_PALETTE_ID,
  FLAME_PALETTE_IDS,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  hexToRgb,
  type CustomPalette,
  type PaletteSelection,
} from "../fractal/palette";
import type { PositionAxisColors } from "../fractal/color";
import {
  BACKGROUND_MODES,
  type BackgroundGradient,
  type BackgroundParams,
} from "./background";
import { BACKGROUND_SHAPES } from "../fractal/background-shape";
import {
  BALLOON_PALETTE_IDS,
  PARAM,
  RENDER_STYLES,
  SURFACE_COLOR_SOURCES,
  SURFACE_FLOOR_PATTERNS,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_W_ANGLE,
  MIN_W_POSITION,
  MIN_W_SCALE,
  MIN_W_SHEAR,
  type FlameParams,
  type SolidParams,
  type SurfaceParams,
} from "./state";
import { SURFACE_ANTIALIAS_DETENTS } from "./surface-sampling";
import {
  MAX_PHI,
  MAX_RADIUS,
  MIN_PHI,
  MIN_RADIUS,
  type CameraPose,
} from "./orbit";
import type { FourDPose } from "./four-d-view";
import type { RotorPair } from "./rotor4";
import {
  CAMERA_TARGET_LIMIT,
  MAX_VARIATION_WEIGHT,
  type SceneSnapshot,
} from "./persist";
import { assertSceneCustomMeshBudget } from "./scene-mesh-assets";

type Fields<T> = Readonly<Record<keyof T, true>>;

const VARIATION_FIELDS = {
  type: true,
  weight: true,
  minRadius: true,
  fixedRadius: true,
  boxLimit: true,
} satisfies Fields<Variation>;
const FINISH_FIELDS = {
  specular: true,
  shininess: true,
  metalness: true,
  reflect: true,
  transmit: true,
  reflectionTint: true,
} satisfies Fields<SurfaceFinish>;
const PATTERN_FIELDS = {
  kind: true,
  axis: true,
  scale: true,
  strength: true,
} satisfies Fields<SurfacePattern>;
const W_FIELDS = {
  position: true,
  scale: true,
  rotation: true,
  shear: true,
} satisfies Fields<WExtension>;
const W_PLANE_FIELDS = {
  xw: true,
  yw: true,
  zw: true,
} satisfies Fields<NonNullable<WExtension["rotation"]>>;
const TRANSFORM_FIELDS = {
  id: true,
  position: true,
  rotation: true,
  scale: true,
  weight: true,
  colorIndex: true,
  colorSpeed: true,
  shear: true,
  variations: true,
  w: true,
  chaos: true,
  finish: true,
  surfacePattern: true,
  emitter: true,
} satisfies Fields<Transform>;
const SCHEDULE_FIELDS = {
  transforms: true,
  depth: true,
} satisfies Fields<HybridSchedule>;
const BAND_FIELDS = {
  minDepth: true,
  maxDepth: true,
} satisfies Fields<CondensationDepthBand>;
const TRAP_FIELDS = {
  shape: true,
  position: true,
  rotation: true,
  scale: true,
  mode: true,
  threshold: true,
  fade: true,
  geometry: true,
  geometryLevelMin: true,
  geometryLevelMax: true,
} satisfies Fields<ShapeTrap>;
const SYMMETRY_FIELDS = {
  order: true,
  plane: true,
  twist: true,
  blend: true,
} satisfies Fields<SymmetryParams>;
const SHAPE_FIELDS = { parts: true } satisfies Fields<ShapeSpec>;
const SHAPE_PART_FIELDS = {
  primitive: true,
  combine: true,
  pose: true,
} satisfies Fields<ShapePart>;
const SHAPE_POSE_FIELDS = {
  offset: true,
  rotate: true,
  scale: true,
} satisfies Fields<ShapePose>;
type SpherePrimitive = Extract<ShapePrimitive, { kind: "sphere" }>;
type BoxPrimitive = Extract<ShapePrimitive, { kind: "box" }>;
type TorusPrimitive = Extract<ShapePrimitive, { kind: "torus" }>;
type CapsulePrimitive = Extract<ShapePrimitive, { kind: "capsule" }>;
type MeshPrimitive = Extract<ShapePrimitive, { kind: "mesh" }>;
type GearPrimitive = Extract<ShapePrimitive, { kind: "gear" }>;
const SPHERE_FIELDS = {
  kind: true,
  radius: true,
} satisfies Fields<SpherePrimitive>;
const BOX_FIELDS = { kind: true, half: true } satisfies Fields<BoxPrimitive>;
const TORUS_FIELDS = {
  kind: true,
  major: true,
  minor: true,
} satisfies Fields<TorusPrimitive>;
const CAPSULE_FIELDS = {
  kind: true,
  a: true,
  b: true,
  radius: true,
} satisfies Fields<CapsulePrimitive>;
const MESH_FIELDS = {
  kind: true,
  meshId: true,
} satisfies Fields<MeshPrimitive>;
const GEAR_FIELDS = {
  kind: true,
  teeth: true,
  radius: true,
  tooth: true,
  hole: true,
  halfHeight: true,
} satisfies Fields<GearPrimitive>;
const CAMERA_FIELDS = {
  target: true,
  radius: true,
  theta: true,
  phi: true,
} satisfies Fields<CameraPose>;
const ROTOR_FIELDS = { p: true, q: true } satisfies Fields<RotorPair>;
const FOUR_D_FIELDS = {
  pair: true,
  sliceOn: true,
  sliceCenter: true,
  sliceThickness: true,
  sliceRelColor: true,
} satisfies Fields<FourDPose>;
const FLAME_FIELDS = {
  exposure: true,
  iterations: true,
  gamma: true,
  vibrancy: true,
  supersample: true,
  estimatorRadius: true,
  estimatorMinimumRadius: true,
  estimatorCurve: true,
  paletteId: true,
} satisfies Fields<FlameParams>;
const SOLID_FIELDS = {
  resolution: true,
  iterations: true,
  threshold: true,
  lightAzimuth: true,
  lightElevation: true,
  ambient: true,
  envLight: true,
  floorEnabled: true,
  floorPattern: true,
  floorTileScale: true,
  floorEmission: true,
  paletteId: true,
} satisfies Fields<SolidParams>;
const SURFACE_FIELDS = {
  antialiasSamples: true,
  depthOfField: true,
  lightAzimuth: true,
  lightElevation: true,
  ambient: true,
  colorSource: true,
  paletteId: true,
  colorSpeed: true,
  envLight: true,
  floorPattern: true,
  floorTileScale: true,
  floorEmission: true,
} satisfies Fields<SurfaceParams>;
const CUSTOM_PALETTE_FIELDS = { stops: true } satisfies Fields<CustomPalette>;
const AXIS_COLOR_FIELDS = {
  x: true,
  y: true,
  z: true,
} satisfies Fields<PositionAxisColors>;
const BACKGROUND_GRADIENT_FIELDS = {
  top: true,
  bottom: true,
} satisfies Fields<BackgroundGradient>;
const BACKGROUND_FIELDS = {
  mode: true,
  custom: true,
  shape: true,
  flamePaletteId: true,
} satisfies Fields<BackgroundParams>;
const SCENE_FIELDS = {
  transforms: true,
  finalTransform: true,
  schedule: true,
  condensationDepthBand: true,
  shapeTrap: true,
  numPoints: true,
  pointSize: true,
  colorMode: true,
  colorGamma: true,
  rampPaletteId: true,
  fourDColor: true,
  fourDDepthFade: true,
  renderStyle: true,
  showGuides: true,
  flame: true,
  solid: true,
  surface: true,
  symmetry: true,
  glowBrightness: true,
  background: true,
  customPalette: true,
  positionAxisColors: true,
  camera: true,
  fourD: true,
  balloonEcho: true,
  balloonRadius: true,
  balloonPaletteId: true,
  balloonCustomPalette: true,
  balloonTint: true,
  balloonTintStrength: true,
  fogDensity: true,
  fogTint: true,
  fogTintStrength: true,
  groundPlane: true,
} satisfies Fields<SceneSnapshot>;

function object(
  value: unknown,
  path: string,
  fields: Readonly<Record<string, true>>,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(fields, key)) {
      throw new TypeError(`${path}.${String(key)} is not a crossover-v1 field`);
    }
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new TypeError(`${path}.${String(key)} is not an array index`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${path}[${index}] is missing`);
    }
  }
  return value;
}

function required(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown {
  if (!Object.hasOwn(record, key) || record[key] === undefined) {
    throw new TypeError(`${path}.${key} is required`);
  }
  return record[key];
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function finiteOptional(
  record: Record<string, unknown>,
  key: string,
  path: string,
): void {
  if (record[key] !== undefined) finite(record[key], `${path}.${key}`);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${path} must be a boolean`);
  return value;
}

function enumeration(
  value: unknown,
  vocabulary: readonly string[],
  path: string,
): string {
  if (typeof value !== "string" || !vocabulary.includes(value)) {
    throw new TypeError(`${path} has an invalid value`);
  }
  return value;
}

function tuple(
  value: unknown,
  length: number,
  path: string,
  bounds?: readonly [number, number],
): number[] {
  const entries = array(value, path);
  if (entries.length !== length)
    throw new TypeError(`${path} must have length ${length}`);
  return entries.map((entry, index) => {
    const number = finite(entry, `${path}[${index}]`);
    if (bounds && (number < bounds[0] || number > bounds[1])) {
      throw new RangeError(`${path}[${index}] is outside its authored domain`);
    }
    return number;
  });
}

function param(
  value: unknown,
  spec: (typeof PARAM)[keyof typeof PARAM],
  path: string,
): number {
  const number = finite(value, path);
  if (number < spec.min || number > spec.max) {
    throw new RangeError(`${path} is outside its authored domain`);
  }
  if (spec.round && !Number.isInteger(number)) {
    throw new RangeError(`${path} must be an integer`);
  }
  if (
    spec.snap !== undefined &&
    Math.abs(number / spec.snap - Math.round(number / spec.snap)) > 1e-12
  ) {
    throw new RangeError(`${path} must be on its authored step`);
  }
  return number;
}

function palette(
  value: unknown,
  path: string,
  hasCustom: boolean,
): asserts value is PaletteSelection {
  const selected = enumeration(
    value,
    [...FLAME_PALETTE_IDS, CUSTOM_PALETTE_ID],
    path,
  );
  if (selected === CUSTOM_PALETTE_ID && !hasCustom) {
    throw new TypeError(`${path} requires its Custom palette payload`);
  }
}

function rgb(value: unknown, path: string): void {
  tuple(value, 3, path, [0, 1]);
}

function variation(value: unknown, path: string): string {
  const entry = object(value, path, VARIATION_FIELDS);
  const type = enumeration(
    required(entry, "type", path),
    VARIATION_TYPES,
    `${path}.type`,
  );
  const weight = finite(required(entry, "weight", path), `${path}.weight`);
  if (weight < -MAX_VARIATION_WEIGHT || weight > MAX_VARIATION_WEIGHT) {
    throw new RangeError(`${path}.weight is outside its document domain`);
  }
  finiteOptional(entry, "minRadius", path);
  finiteOptional(entry, "fixedRadius", path);
  finiteOptional(entry, "boxLimit", path);
  return type;
}

function finish(value: unknown, path: string): void {
  const entry = object(value, path, FINISH_FIELDS);
  for (const key of Object.keys(FINISH_FIELDS))
    finiteOptional(entry, key, path);
}

function pattern(value: unknown, path: string): void {
  const entry = object(value, path, PATTERN_FIELDS);
  enumeration(
    required(entry, "kind", path),
    SURFACE_PATTERN_KINDS,
    `${path}.kind`,
  );
  enumeration(
    required(entry, "axis", path),
    SURFACE_PATTERN_AXES,
    `${path}.axis`,
  );
  finiteOptional(entry, "scale", path);
  finiteOptional(entry, "strength", path);
}

function wPlanes(value: unknown, path: string, min: number, max: number): void {
  const planes = object(value, path, W_PLANE_FIELDS);
  for (const key of Object.keys(W_PLANE_FIELDS)) {
    if (planes[key] === undefined) continue;
    const number = finite(planes[key], `${path}.${key}`);
    if (number < min || number > max) {
      throw new RangeError(`${path}.${key} is outside its authored domain`);
    }
  }
}

function wExtension(value: unknown, path: string): void {
  const w = object(value, path, W_FIELDS);
  if (w.position !== undefined) {
    const position = finite(w.position, `${path}.position`);
    if (position < MIN_W_POSITION || position > MAX_W_POSITION) {
      throw new RangeError(`${path}.position is outside its authored domain`);
    }
  }
  if (w.scale !== undefined) {
    const scale = finite(w.scale, `${path}.scale`);
    if (Math.abs(scale) < MIN_W_SCALE || Math.abs(scale) > MAX_W_SCALE) {
      throw new RangeError(`${path}.scale is outside its authored domain`);
    }
  }
  if (w.rotation !== undefined) {
    wPlanes(w.rotation, `${path}.rotation`, MIN_W_ANGLE, MAX_W_ANGLE);
  }
  if (w.shear !== undefined) {
    wPlanes(w.shear, `${path}.shear`, MIN_W_SHEAR, MAX_W_SHEAR);
  }
}

function shapePose(value: unknown, path: string): void {
  const pose = object(value, path, SHAPE_POSE_FIELDS);
  if (pose.offset !== undefined) tuple(pose.offset, 3, `${path}.offset`);
  if (pose.rotate !== undefined) tuple(pose.rotate, 3, `${path}.rotate`);
  finiteOptional(pose, "scale", path);
}

function primitive(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const kind = (value as Record<string, unknown>).kind;
  switch (kind) {
    case "sphere": {
      const entry = object(value, path, SPHERE_FIELDS);
      finite(required(entry, "radius", path), `${path}.radius`);
      return;
    }
    case "box": {
      const entry = object(value, path, BOX_FIELDS);
      tuple(required(entry, "half", path), 3, `${path}.half`);
      return;
    }
    case "torus": {
      const entry = object(value, path, TORUS_FIELDS);
      finite(required(entry, "major", path), `${path}.major`);
      finite(required(entry, "minor", path), `${path}.minor`);
      return;
    }
    case "capsule": {
      const entry = object(value, path, CAPSULE_FIELDS);
      tuple(required(entry, "a", path), 3, `${path}.a`);
      tuple(required(entry, "b", path), 3, `${path}.b`);
      finite(required(entry, "radius", path), `${path}.radius`);
      return;
    }
    case "gear": {
      const entry = object(value, path, GEAR_FIELDS);
      finite(required(entry, "teeth", path), `${path}.teeth`);
      finite(required(entry, "radius", path), `${path}.radius`);
      tuple(required(entry, "tooth", path), 2, `${path}.tooth`);
      finite(required(entry, "hole", path), `${path}.hole`);
      finite(required(entry, "halfHeight", path), `${path}.halfHeight`);
      return;
    }
    case "mesh": {
      const entry = object(value, path, MESH_FIELDS);
      const meshId = required(entry, "meshId", path);
      if (typeof meshId !== "string" || !isMeshAssetId(meshId)) {
        throw new TypeError(`${path}.meshId is invalid`);
      }
      return;
    }
    default:
      throw new TypeError(`${path}.kind has an invalid value`);
  }
}

function shape(value: unknown, path: string): void {
  const spec = object(value, path, SHAPE_FIELDS);
  const parts = array(required(spec, "parts", path), `${path}.parts`);
  if (parts.length < 1 || parts.length > MAX_SHAPE_PARTS) {
    throw new RangeError(`${path}.parts exceeds the shape-part cap`);
  }
  parts.forEach((value, index) => {
    const partPath = `${path}.parts[${index}]`;
    const part = object(value, partPath, SHAPE_PART_FIELDS);
    primitive(required(part, "primitive", partPath), `${partPath}.primitive`);
    const combine = enumeration(
      required(part, "combine", partPath),
      ["union", "intersect"],
      `${partPath}.combine`,
    );
    if (index === 0 && combine !== "union") {
      throw new RangeError(`${partPath}.combine must be union`);
    }
    if (part.pose !== undefined) shapePose(part.pose, `${partPath}.pose`);
  });
}

function transform(
  value: unknown,
  path: string,
  scheduleTransform = false,
): Transform {
  const entry = object(value, path, TRANSFORM_FIELDS);
  const id = finite(required(entry, "id", path), `${path}.id`);
  if (!Number.isSafeInteger(id))
    throw new TypeError(`${path}.id must be a safe integer`);
  tuple(required(entry, "position", path), 3, `${path}.position`);
  tuple(required(entry, "rotation", path), 3, `${path}.rotation`);
  tuple(required(entry, "scale", path), 3, `${path}.scale`);
  if (entry.shear !== undefined) tuple(entry.shear, 3, `${path}.shear`);
  if (entry.weight !== undefined) {
    const weight = finite(entry.weight, `${path}.weight`);
    if (weight < 0.0001 || weight > 10000) {
      throw new RangeError(`${path}.weight is outside its authored domain`);
    }
  }
  if (scheduleTransform) {
    for (const key of Object.keys(entry)) {
      if (
        !["id", "position", "rotation", "scale", "shear", "weight"].includes(
          key,
        )
      ) {
        throw new TypeError(`${path}.${key} is not allowed in schedule B`);
      }
    }
    return value as Transform;
  }
  for (const key of ["colorIndex", "colorSpeed"] as const) {
    if (entry[key] === undefined) continue;
    const number = finite(entry[key], `${path}.${key}`);
    if (number < 0 || number > 1) {
      throw new RangeError(`${path}.${key} is outside its authored domain`);
    }
  }
  if (entry.variations !== undefined) {
    const variations = array(entry.variations, `${path}.variations`);
    if (variations.length > VARIATION_TYPES.length) {
      throw new RangeError(`${path}.variations exceeds the variation cap`);
    }
    variations.forEach((item, index) =>
      variation(item, `${path}.variations[${index}]`),
    );
  }
  if (entry.w !== undefined) wExtension(entry.w, `${path}.w`);
  if (entry.chaos !== undefined) {
    const chaos = array(entry.chaos, `${path}.chaos`);
    if (chaos.length > MAX_TRANSFORMS) {
      throw new RangeError(`${path}.chaos exceeds the document cap`);
    }
    chaos.forEach((item, index) => {
      finite(item, `${path}.chaos[${index}]`);
    });
  }
  if (entry.finish !== undefined) finish(entry.finish, `${path}.finish`);
  if (entry.surfacePattern !== undefined)
    pattern(entry.surfacePattern, `${path}.surfacePattern`);
  if (entry.emitter !== undefined) shape(entry.emitter, `${path}.emitter`);
  return value as Transform;
}

function schedule(value: unknown, path: string): void {
  const block = object(value, path, SCHEDULE_FIELDS);
  const depth = finite(required(block, "depth", path), `${path}.depth`);
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SCHEDULE_DEPTH) {
    throw new RangeError(`${path}.depth is outside the schedule cap`);
  }
  const transforms = array(
    required(block, "transforms", path),
    `${path}.transforms`,
  );
  if (transforms.length < 1 || transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(`${path}.transforms has an invalid count`);
  }
  const ids = transforms.map(
    (item, index) => transform(item, `${path}.transforms[${index}]`, true).id,
  );
  if (new Set(ids).size !== ids.length)
    throw new TypeError(`${path}.transforms has duplicate ids`);
}

function band(value: unknown, path: string): void {
  const entry = object(value, path, BAND_FIELDS);
  const values: number[] = [];
  for (const key of ["minDepth", "maxDepth"] as const) {
    if (entry[key] === undefined) continue;
    const number = finite(entry[key], `${path}.${key}`);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new RangeError(`${path}.${key} must be a nonnegative safe integer`);
    }
    values.push(number);
  }
  if (values.length === 2 && values[0] > values[1]) {
    throw new RangeError(`${path} endpoints must be ordered`);
  }
}

function trap(value: unknown, path: string): void {
  const entry = object(value, path, TRAP_FIELDS);
  shape(required(entry, "shape", path), `${path}.shape`);
  if (entry.position !== undefined)
    tuple(entry.position, 3, `${path}.position`);
  if (entry.rotation !== undefined)
    tuple(entry.rotation, 3, `${path}.rotation`);
  for (const key of ["scale", "threshold", "fade"] as const) {
    finiteOptional(entry, key, path);
  }
  if (entry.mode !== undefined)
    enumeration(entry.mode, SHAPE_TRAP_MODES, `${path}.mode`);
  if (entry.geometry !== undefined) boolean(entry.geometry, `${path}.geometry`);
  const levels: number[] = [];
  for (const key of ["geometryLevelMin", "geometryLevelMax"] as const) {
    if (entry[key] === undefined) continue;
    const level = finite(entry[key], `${path}.${key}`);
    if (
      !Number.isInteger(level) ||
      level < 0 ||
      level > SHAPE_TRAP_GEOMETRY_LEVEL_MAX
    ) {
      throw new RangeError(`${path}.${key} is outside its authored domain`);
    }
    levels.push(level);
  }
  if (levels.length === 2 && levels[0] > levels[1]) {
    throw new RangeError(`${path} geometry levels must be ordered`);
  }
}

function symmetry(value: unknown, path: string): void {
  const entry = object(value, path, SYMMETRY_FIELDS);
  const order = param(
    required(entry, "order", path),
    PARAM.symmetryOrder,
    `${path}.order`,
  );
  enumeration(required(entry, "plane", path), SYMMETRY_PLANES, `${path}.plane`);
  if (Object.hasOwn(entry, "blend"))
    throw new TypeError(`${path}.blend is morph-only`);
  if (entry.twist !== undefined) {
    const twist = finite(entry.twist, `${path}.twist`);
    if (!Number.isInteger(twist) || twist < 0 || twist >= order) {
      throw new RangeError(`${path}.twist must be an integer below order`);
    }
  }
}

function customPalette(value: unknown, path: string): void {
  const entry = object(value, path, CUSTOM_PALETTE_FIELDS);
  const stops = array(required(entry, "stops", path), `${path}.stops`);
  if (
    stops.length < MIN_CUSTOM_PALETTE_STOPS ||
    stops.length > MAX_CUSTOM_PALETTE_STOPS
  ) {
    throw new RangeError(`${path}.stops exceeds the palette cap`);
  }
  stops.forEach((stop, index) => rgb(stop, `${path}.stops[${index}]`));
}

function axisColors(value: unknown, path: string): void {
  const entry = object(value, path, AXIS_COLOR_FIELDS);
  for (const key of Object.keys(AXIS_COLOR_FIELDS)) {
    rgb(required(entry, key, path), `${path}.${key}`);
  }
}

function background(
  value: unknown,
  path: string,
  hasCustomPalette: boolean,
): void {
  const entry = object(value, path, BACKGROUND_FIELDS);
  const mode = enumeration(
    required(entry, "mode", path),
    BACKGROUND_MODES,
    `${path}.mode`,
  );
  if (entry.custom !== undefined) {
    const gradient = object(
      entry.custom,
      `${path}.custom`,
      BACKGROUND_GRADIENT_FIELDS,
    );
    rgb(required(gradient, "top", `${path}.custom`), `${path}.custom.top`);
    rgb(
      required(gradient, "bottom", `${path}.custom`),
      `${path}.custom.bottom`,
    );
  }
  if (mode === "custom" && entry.custom === undefined) {
    throw new TypeError(`${path}.mode custom requires its gradient`);
  }
  if (entry.shape !== undefined)
    enumeration(entry.shape, BACKGROUND_SHAPES, `${path}.shape`);
  if (entry.flamePaletteId !== undefined) {
    palette(entry.flamePaletteId, `${path}.flamePaletteId`, hasCustomPalette);
  }
}

function flame(value: unknown, path: string, hasCustomPalette: boolean): void {
  const entry = object(value, path, FLAME_FIELDS);
  param(
    required(entry, "exposure", path),
    PARAM.flameExposure,
    `${path}.exposure`,
  );
  param(
    required(entry, "iterations", path),
    PARAM.flameIterations,
    `${path}.iterations`,
  );
  param(required(entry, "gamma", path), PARAM.flameGamma, `${path}.gamma`);
  param(
    required(entry, "vibrancy", path),
    PARAM.flameVibrancy,
    `${path}.vibrancy`,
  );
  param(
    required(entry, "supersample", path),
    PARAM.flameSupersample,
    `${path}.supersample`,
  );
  param(
    required(entry, "estimatorRadius", path),
    PARAM.estimatorRadius,
    `${path}.estimatorRadius`,
  );
  param(
    required(entry, "estimatorMinimumRadius", path),
    PARAM.estimatorMinimumRadius,
    `${path}.estimatorMinimumRadius`,
  );
  param(
    required(entry, "estimatorCurve", path),
    PARAM.estimatorCurve,
    `${path}.estimatorCurve`,
  );
  palette(
    required(entry, "paletteId", path),
    `${path}.paletteId`,
    hasCustomPalette,
  );
}

function solid(value: unknown, path: string, hasCustomPalette: boolean): void {
  const entry = object(value, path, SOLID_FIELDS);
  param(
    required(entry, "resolution", path),
    PARAM.solidResolution,
    `${path}.resolution`,
  );
  param(
    required(entry, "iterations", path),
    PARAM.solidIterations,
    `${path}.iterations`,
  );
  param(
    required(entry, "threshold", path),
    PARAM.solidThreshold,
    `${path}.threshold`,
  );
  param(
    required(entry, "lightAzimuth", path),
    PARAM.solidLightAzimuth,
    `${path}.lightAzimuth`,
  );
  param(
    required(entry, "lightElevation", path),
    PARAM.solidLightElevation,
    `${path}.lightElevation`,
  );
  param(
    required(entry, "ambient", path),
    PARAM.solidAmbient,
    `${path}.ambient`,
  );
  param(
    required(entry, "envLight", path),
    PARAM.solidEnvLight,
    `${path}.envLight`,
  );
  boolean(required(entry, "floorEnabled", path), `${path}.floorEnabled`);
  enumeration(
    required(entry, "floorPattern", path),
    SURFACE_FLOOR_PATTERNS,
    `${path}.floorPattern`,
  );
  param(
    required(entry, "floorTileScale", path),
    PARAM.solidFloorTileScale,
    `${path}.floorTileScale`,
  );
  param(
    required(entry, "floorEmission", path),
    PARAM.solidFloorEmission,
    `${path}.floorEmission`,
  );
  palette(
    required(entry, "paletteId", path),
    `${path}.paletteId`,
    hasCustomPalette,
  );
}

function surface(
  value: unknown,
  path: string,
  hasCustomPalette: boolean,
): void {
  const entry = object(value, path, SURFACE_FIELDS);
  const samples = finite(
    required(entry, "antialiasSamples", path),
    `${path}.antialiasSamples`,
  );
  if (!(SURFACE_ANTIALIAS_DETENTS as readonly number[]).includes(samples)) {
    throw new RangeError(`${path}.antialiasSamples is not an authored detent`);
  }
  boolean(required(entry, "depthOfField", path), `${path}.depthOfField`);
  param(
    required(entry, "lightAzimuth", path),
    PARAM.surfaceLightAzimuth,
    `${path}.lightAzimuth`,
  );
  param(
    required(entry, "lightElevation", path),
    PARAM.surfaceLightElevation,
    `${path}.lightElevation`,
  );
  param(
    required(entry, "ambient", path),
    PARAM.surfaceAmbient,
    `${path}.ambient`,
  );
  enumeration(
    required(entry, "colorSource", path),
    SURFACE_COLOR_SOURCES,
    `${path}.colorSource`,
  );
  palette(
    required(entry, "paletteId", path),
    `${path}.paletteId`,
    hasCustomPalette,
  );
  param(
    required(entry, "colorSpeed", path),
    PARAM.surfaceColorSpeed,
    `${path}.colorSpeed`,
  );
  param(
    required(entry, "envLight", path),
    PARAM.surfaceEnvLight,
    `${path}.envLight`,
  );
  enumeration(
    required(entry, "floorPattern", path),
    SURFACE_FLOOR_PATTERNS,
    `${path}.floorPattern`,
  );
  param(
    required(entry, "floorTileScale", path),
    PARAM.surfaceFloorTileScale,
    `${path}.floorTileScale`,
  );
  param(
    required(entry, "floorEmission", path),
    PARAM.surfaceFloorEmission,
    `${path}.floorEmission`,
  );
}

function camera(value: unknown, path: string): void {
  const entry = object(value, path, CAMERA_FIELDS);
  const target = tuple(required(entry, "target", path), 3, `${path}.target`);
  if (target.some((component) => Math.abs(component) > CAMERA_TARGET_LIMIT)) {
    throw new RangeError(`${path}.target is outside its document domain`);
  }
  const radius = finite(required(entry, "radius", path), `${path}.radius`);
  if (radius < MIN_RADIUS || radius > MAX_RADIUS) {
    throw new RangeError(`${path}.radius is outside its authored domain`);
  }
  finite(required(entry, "theta", path), `${path}.theta`);
  const phi = finite(required(entry, "phi", path), `${path}.phi`);
  if (phi < MIN_PHI || phi > MAX_PHI) {
    throw new RangeError(`${path}.phi is outside its authored domain`);
  }
}

function fourD(value: unknown, path: string): void {
  const entry = object(value, path, FOUR_D_FIELDS);
  const pair = object(
    required(entry, "pair", path),
    `${path}.pair`,
    ROTOR_FIELDS,
  );
  for (const key of Object.keys(ROTOR_FIELDS)) {
    const half = tuple(
      required(pair, key, `${path}.pair`),
      4,
      `${path}.pair.${key}`,
    );
    const norm = Math.hypot(...half);
    if (norm < 1e-6 || Math.abs(norm - 1) > 1e-6) {
      throw new RangeError(
        `${path}.pair.${key} must be a normalized quaternion`,
      );
    }
  }
  boolean(required(entry, "sliceOn", path), `${path}.sliceOn`);
  const center = finite(
    required(entry, "sliceCenter", path),
    `${path}.sliceCenter`,
  );
  if (center < -1 || center > 1)
    throw new RangeError(`${path}.sliceCenter is outside its authored domain`);
  const thickness = finite(
    required(entry, "sliceThickness", path),
    `${path}.sliceThickness`,
  );
  if (thickness < 0 || thickness > 0.5) {
    throw new RangeError(
      `${path}.sliceThickness is outside its authored domain`,
    );
  }
  boolean(required(entry, "sliceRelColor", path), `${path}.sliceRelColor`);
}

function hex(value: unknown, path: string): void {
  if (typeof value !== "string" || hexToRgb(value) === null) {
    throw new TypeError(`${path} must be a #rrggbb color`);
  }
}

/** Reject any non-exact or out-of-domain crossover-v1 authority in place. */
export function assertValidEvolutionSceneSnapshot(
  value: unknown,
): asserts value is SceneSnapshot {
  const scene = object(value, "snapshot", SCENE_FIELDS);
  const transforms = array(
    required(scene, "transforms", "snapshot"),
    "snapshot.transforms",
  );
  if (transforms.length < 1 || transforms.length > MAX_TRANSFORMS) {
    throw new RangeError("snapshot.transforms has an invalid count");
  }
  const ids = transforms.map(
    (item, index) => transform(item, `snapshot.transforms[${index}]`).id,
  );
  if (new Set(ids).size !== ids.length)
    throw new TypeError("snapshot.transforms has duplicate ids");
  if (scene.finalTransform !== undefined) {
    transform(scene.finalTransform, "snapshot.finalTransform");
  }
  if (scene.schedule !== undefined)
    schedule(scene.schedule, "snapshot.schedule");
  if (scene.condensationDepthBand !== undefined) {
    band(scene.condensationDepthBand, "snapshot.condensationDepthBand");
  }
  if (scene.shapeTrap !== undefined)
    trap(scene.shapeTrap, "snapshot.shapeTrap");

  param(
    required(scene, "numPoints", "snapshot"),
    PARAM.numPoints,
    "snapshot.numPoints",
  );
  param(
    required(scene, "pointSize", "snapshot"),
    PARAM.pointSize,
    "snapshot.pointSize",
  );
  enumeration(
    required(scene, "colorMode", "snapshot"),
    COLOR_MODES,
    "snapshot.colorMode",
  );
  param(
    required(scene, "colorGamma", "snapshot"),
    PARAM.colorGamma,
    "snapshot.colorGamma",
  );

  const hasCustomPalette = scene.customPalette !== undefined;
  if (hasCustomPalette)
    customPalette(scene.customPalette, "snapshot.customPalette");
  palette(
    required(scene, "rampPaletteId", "snapshot"),
    "snapshot.rampPaletteId",
    hasCustomPalette,
  );
  enumeration(
    required(scene, "fourDColor", "snapshot"),
    FOUR_D_COLOR_MODES,
    "snapshot.fourDColor",
  );
  boolean(
    required(scene, "fourDDepthFade", "snapshot"),
    "snapshot.fourDDepthFade",
  );
  enumeration(
    required(scene, "renderStyle", "snapshot"),
    RENDER_STYLES,
    "snapshot.renderStyle",
  );
  boolean(required(scene, "showGuides", "snapshot"), "snapshot.showGuides");
  flame(
    required(scene, "flame", "snapshot"),
    "snapshot.flame",
    hasCustomPalette,
  );
  solid(
    required(scene, "solid", "snapshot"),
    "snapshot.solid",
    hasCustomPalette,
  );
  surface(
    required(scene, "surface", "snapshot"),
    "snapshot.surface",
    hasCustomPalette,
  );
  symmetry(required(scene, "symmetry", "snapshot"), "snapshot.symmetry");
  param(
    required(scene, "glowBrightness", "snapshot"),
    PARAM.glowBrightness,
    "snapshot.glowBrightness",
  );
  background(
    required(scene, "background", "snapshot"),
    "snapshot.background",
    hasCustomPalette,
  );

  if (scene.positionAxisColors !== undefined) {
    axisColors(scene.positionAxisColors, "snapshot.positionAxisColors");
  }
  if (scene.camera !== undefined) camera(scene.camera, "snapshot.camera");
  if (scene.fourD !== undefined) fourD(scene.fourD, "snapshot.fourD");
  if (scene.balloonEcho !== undefined)
    boolean(scene.balloonEcho, "snapshot.balloonEcho");
  if (scene.balloonRadius !== undefined) {
    param(scene.balloonRadius, PARAM.balloonRadius, "snapshot.balloonRadius");
  }
  const hasBalloonCustomPalette = scene.balloonCustomPalette !== undefined;
  if (hasBalloonCustomPalette) {
    customPalette(scene.balloonCustomPalette, "snapshot.balloonCustomPalette");
  }
  if (scene.balloonPaletteId !== undefined) {
    const selected = enumeration(
      scene.balloonPaletteId,
      BALLOON_PALETTE_IDS,
      "snapshot.balloonPaletteId",
    );
    if (selected === CUSTOM_PALETTE_ID && !hasBalloonCustomPalette) {
      throw new TypeError(
        "snapshot.balloonPaletteId requires its Custom palette payload",
      );
    }
  }
  if (scene.balloonTint !== undefined)
    hex(scene.balloonTint, "snapshot.balloonTint");
  if (scene.balloonTintStrength !== undefined) {
    param(
      scene.balloonTintStrength,
      PARAM.balloonTintStrength,
      "snapshot.balloonTintStrength",
    );
  }
  if (scene.fogDensity !== undefined)
    param(scene.fogDensity, PARAM.fogDensity, "snapshot.fogDensity");
  if (scene.fogTint !== undefined) hex(scene.fogTint, "snapshot.fogTint");
  if (scene.fogTintStrength !== undefined) {
    param(
      scene.fogTintStrength,
      PARAM.fogTintStrength,
      "snapshot.fogTintStrength",
    );
  }
  if (scene.groundPlane !== undefined)
    boolean(scene.groundPlane, "snapshot.groundPlane");
  assertSceneCustomMeshBudget(value as SceneSnapshot);
}
