/**
 * Pure, versioned selective-breeding kernel for Evolution Lab.
 *
 * Parent order is semantic: the primary owns document-level presentation and
 * child slot order, while independently-derived named streams choose whole
 * genetic blocks from the paired transforms. Nothing in this module consults
 * runtime capability, mutates an input, pins an asset, or adds a lineage node.
 */
import { systemPartsAreNonFlat } from "../fractal/affine4";
import { mulberry32 } from "../fractal/rng";
import {
  type HybridSchedule,
  type SymmetryParams,
  type Transform,
} from "../fractal/types";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
} from "./scene-mesh-assets";
import {
  ownEvolutionSceneSnapshot,
  type ImmutableSceneSnapshot,
} from "./evolution-candidate";
import type { SceneSnapshot } from "./persist";
import { assertValidEvolutionSceneSnapshot } from "./evolution-snapshot-validation";

export const CROSSOVER_ALGORITHM_VERSION = "crossover-v1" as const;

/** Exact semantic SHA-256 identity. Canonicalization is synchronous and the
 * digest implementation is dependency-free, so the prepared-parent boundary
 * behaves identically in browsers and tests without leaking async into the
 * pure kernel. */
export type SceneContentDigest = `scene-sha256-${string}`;

export interface EvolutionTopologyV1 {
  readonly version: 1;
  readonly token: string;
  readonly slotKeys: readonly string[];
}

export interface EvolutionCrossoverParentInput {
  readonly snapshot: SceneSnapshot | ImmutableSceneSnapshot;
  /** Absent for an unrelated Collection authority. */
  readonly topology?: EvolutionTopologyV1;
}

export type EvolutionCrossoverPairingKind =
  "related-slot-v1" | "unrelated-role-order-v1";

export interface EvolutionCrossoverPairing {
  readonly kind: EvolutionCrossoverPairingKind;
  /** For child/primary slot i, the corresponding secondary document index. */
  readonly secondaryIndexByChildSlot: readonly number[];
}

export interface PreparedEvolutionCrossoverParent {
  readonly snapshot: ImmutableSceneSnapshot;
  readonly contentDigest: SceneContentDigest;
  readonly topology?: EvolutionTopologyV1;
  readonly resourceIds: readonly CustomMeshAssetId[];
}

export interface PreparedEvolutionCrossover {
  readonly algorithmVersion: typeof CROSSOVER_ALGORITHM_VERSION;
  readonly primary: PreparedEvolutionCrossoverParent;
  readonly secondary: PreparedEvolutionCrossoverParent;
  readonly pairing: EvolutionCrossoverPairing;
}

export type EvolutionCrossoverRefusalCode =
  | "invalid-primary"
  | "invalid-secondary"
  | "invalid-coordinates"
  | "invalid-related-topology"
  | "transform-count-mismatch"
  | "emitter-count-mismatch"
  | "emitter-role-mismatch"
  | "missing-resource"
  | "invalid-chaos-permutation"
  | "invalid-chaos-value"
  | "child-resource-budget-exceeded"
  | "invalid-child";

export interface EvolutionCrossoverRefusal {
  readonly code: EvolutionCrossoverRefusalCode;
  readonly detail: string;
  readonly resourceId?: CustomMeshAssetId;
}

export type PrepareEvolutionCrossoverResult =
  | { readonly accepted: true; readonly prepared: PreparedEvolutionCrossover }
  | { readonly accepted: false; readonly refusal: EvolutionCrossoverRefusal };

export interface EvolutionCrossoverCoordinates {
  readonly algorithmVersion: typeof CROSSOVER_ALGORITHM_VERSION;
  readonly nodeSeed: number;
  readonly childOrdinal: number;
  readonly attempt: number;
}

export interface EvolutionCrossoverAttempt {
  readonly snapshot: ImmutableSceneSnapshot;
  readonly topology: EvolutionTopologyV1;
  readonly pairing: EvolutionCrossoverPairing;
  readonly resourceIds: readonly CustomMeshAssetId[];
  readonly primaryContentDigest: SceneContentDigest;
  readonly secondaryContentDigest: SceneContentDigest;
  readonly coordinates: Readonly<EvolutionCrossoverCoordinates>;
}

export type EvolutionCrossoverAttemptResult =
  | { readonly accepted: true; readonly attempt: EvolutionCrossoverAttempt }
  | { readonly accepted: false; readonly refusal: EvolutionCrossoverRefusal };

export interface EvolutionCrossoverPreflightOptions {
  /** If supplied, every custom mesh referenced by either parent must exist. */
  readonly availableResourceIds?: ReadonlySet<CustomMeshAssetId>;
}

const TRANSFORM_FIELDS = {
  id: "fresh-id",
  position: "geometry",
  rotation: "geometry",
  scale: "geometry",
  weight: "selectionWeight",
  colorIndex: "appearance",
  colorSpeed: "appearance",
  shear: "geometry",
  variations: "variations",
  post: "geometry",
  w: "w",
  chaos: "chaosMatrix",
  finish: "appearance",
  surfacePattern: "appearance",
  emitter: "emitter",
} satisfies Record<keyof Transform, string>;

const SCENE_FIELDS = {
  transforms: "base-blocks",
  finalTransform: "finalTransform",
  schedule: "schedule",
  condensationDepthBand: "condensationDepthBand",
  shapeTrap: "shapeTrap",
  tiling: "tiling",
  numPoints: "primary",
  pointSize: "primary",
  colorMode: "primary",
  colorGamma: "primary",
  rampPaletteId: "primary",
  fourDColor: "primary",
  fourDDepthFade: "primary",
  renderStyle: "primary",
  showGuides: "primary",
  flame: "primary",
  solid: "primary",
  surface: "primary",
  symmetry: "symmetry",
  glowBrightness: "primary",
  background: "primary",
  customPalette: "primary",
  positionAxisColors: "primary",
  camera: "primary",
  fourD: "derived-dimensionality",
  balloonEcho: "primary",
  balloonRadius: "primary",
  balloonPaletteId: "primary",
  balloonCustomPalette: "primary",
  balloonTint: "primary",
  balloonTintStrength: "primary",
  fogDensity: "primary",
  fogTint: "primary",
  fogTintStrength: "primary",
  groundPlane: "primary",
} satisfies Record<keyof SceneSnapshot, string>;

// These values are compile-time tripwires: a newly-added document field must
// be deliberately assigned to a crossover block before TypeScript will pass.
void TRANSFORM_FIELDS;
void SCENE_FIELDS;

function refusal(
  code: EvolutionCrossoverRefusalCode,
  detail: string,
  resourceId?: CustomMeshAssetId,
): EvolutionCrossoverRefusal {
  return Object.freeze({ code, detail, ...(resourceId ? { resourceId } : {}) });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticTransform(transform: Transform): Record<string, unknown> {
  const { id: _id, ...semantic } = transform;
  return semantic;
}

function semanticScene(snapshot: SceneSnapshot): Record<string, unknown> {
  const semantic = structuredClone(snapshot);
  const projected = semantic as unknown as Record<string, unknown>;
  projected.transforms = semantic.transforms.map(semanticTransform);
  if (semantic.finalTransform !== undefined) {
    projected.finalTransform = semanticTransform(semantic.finalTransform);
  }
  if (semantic.schedule !== undefined) {
    projected.schedule = {
      ...semantic.schedule,
      transforms: semantic.schedule.transforms.map(semanticTransform),
    };
  }
  return projected;
}

function canonical(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "l";
  if (typeof value === "boolean") return value ? "b1" : "b0";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("digest numbers must be finite");
    return `n${Object.is(value, -0) ? "-0" : String(value)};`;
  }
  if (typeof value === "string") {
    let codeUnits = "";
    for (let index = 0; index < value.length; index += 1) {
      codeUnits += value.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return `s${value.length}:${codeUnits}`;
  }
  if (Array.isArray(value)) {
    return `a${value.length}:[${value.map(canonical).join("")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `o${keys.length}:{${keys
      .map((key) => `${canonical(key)}${canonical(value[key])}`)
      .join("")}}`;
  }
  throw new TypeError(`unsupported digest value: ${typeof value}`);
}

function avalanche32(hash: number): number {
  let mixed = hash ^ (hash >>> 16);
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function fnvArm(value: string, initial: number): number {
  let hash = initial >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return avalanche32(hash);
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Small synchronous SHA-256 used only on bounded scene documents. */
function sha256Hex(text: string): string {
  const source = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 =
        rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 =
        rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          bigSigma1 +
          choose +
          SHA256_ROUND_CONSTANTS[index] +
          words[index]) >>>
        0;
      const bigSigma0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** Exact semantic digest of a validated document. Transform ids are omitted;
 * every other field and sparse property presence remains an input. */
export function evolutionSceneContentDigest(
  snapshot: SceneSnapshot | ImmutableSceneSnapshot,
): SceneContentDigest {
  assertValidEvolutionSceneSnapshot(snapshot);
  return `scene-sha256-${sha256Hex(canonical(semanticScene(snapshot)))}`;
}

/** Stable length-framed 32-bit derivation used by each independent stream. */
export function deriveCrossoverSeed32(
  parts: readonly (number | string)[],
): number {
  let framed = "";
  for (const part of parts) {
    const value = String(part);
    framed += `${value.length}:${value}`;
  }
  return fnvArm(framed, 0x811c9dc5);
}

function ownTopology(
  topology: EvolutionTopologyV1 | undefined,
  transformCount: number,
): EvolutionTopologyV1 | undefined {
  if (topology === undefined) return undefined;
  if (
    topology.version !== 1 ||
    typeof topology.token !== "string" ||
    topology.token.length === 0 ||
    topology.slotKeys.length !== transformCount ||
    topology.slotKeys.some(
      (key) => typeof key !== "string" || key.length === 0,
    ) ||
    new Set(topology.slotKeys).size !== transformCount
  ) {
    throw new TypeError("topology certificate is malformed");
  }
  return Object.freeze({
    version: 1,
    token: topology.token,
    slotKeys: Object.freeze([...topology.slotKeys]),
  });
}

function prepareParent(
  input: EvolutionCrossoverParentInput,
): PreparedEvolutionCrossoverParent {
  assertValidEvolutionSceneSnapshot(input.snapshot);
  const snapshot = ownEvolutionSceneSnapshot(input.snapshot);
  const topology = ownTopology(input.topology, snapshot.transforms.length);
  const resourceIds = Object.freeze(
    sceneCustomMeshIds(snapshot as unknown as SceneSnapshot),
  );
  return Object.freeze({
    snapshot,
    contentDigest: evolutionSceneContentDigest(snapshot),
    ...(topology ? { topology } : {}),
    resourceIds,
  });
}

function role(transform: Transform): "emitter" | "ordinary" {
  return transform.emitter === undefined ? "ordinary" : "emitter";
}

function relatedPairing(
  primary: PreparedEvolutionCrossoverParent,
  secondary: PreparedEvolutionCrossoverParent,
): EvolutionCrossoverPairing | EvolutionCrossoverRefusal | null {
  if (!primary.topology || !secondary.topology) return null;
  if (primary.topology.token !== secondary.topology.token) return null;
  if (
    primary.snapshot.transforms.length !==
      secondary.snapshot.transforms.length ||
    primary.topology.slotKeys.length !== secondary.topology.slotKeys.length
  ) {
    return refusal(
      "invalid-related-topology",
      "related parents must carry equal transform counts and slot-key sets",
    );
  }
  const primaryKeys = new Set(primary.topology.slotKeys);
  const secondaryKeys = new Set(secondary.topology.slotKeys);
  if (
    primaryKeys.size !== secondaryKeys.size ||
    primary.topology.slotKeys.some((key) => !secondaryKeys.has(key)) ||
    secondary.topology.slotKeys.some((key) => !primaryKeys.has(key))
  ) {
    return refusal(
      "invalid-related-topology",
      "related parents do not carry the same slot-key set",
    );
  }
  const secondaryByKey = new Map<string, number>();
  secondary.topology.slotKeys.forEach((key, index) =>
    secondaryByKey.set(key, index),
  );
  const permutation: number[] = [];
  for (let index = 0; index < primary.topology.slotKeys.length; index += 1) {
    const key = primary.topology.slotKeys[index];
    const secondaryIndex = secondaryByKey.get(key);
    if (secondaryIndex === undefined) {
      return refusal(
        "invalid-related-topology",
        "related parents do not carry the same slot-key set",
      );
    }
    if (
      role(primary.snapshot.transforms[index] as Transform) !==
      role(secondary.snapshot.transforms[secondaryIndex] as Transform)
    ) {
      return refusal(
        "emitter-role-mismatch",
        `related slot ${key} changes emitter role`,
      );
    }
    permutation.push(secondaryIndex);
  }
  return Object.freeze({
    kind: "related-slot-v1",
    secondaryIndexByChildSlot: Object.freeze(permutation),
  });
}

function unrelatedPairing(
  primary: PreparedEvolutionCrossoverParent,
  secondary: PreparedEvolutionCrossoverParent,
): EvolutionCrossoverPairing | EvolutionCrossoverRefusal {
  const count = primary.snapshot.transforms.length;
  if (count !== secondary.snapshot.transforms.length) {
    return refusal(
      "transform-count-mismatch",
      `primary has ${count} transforms; secondary has ${secondary.snapshot.transforms.length}`,
    );
  }
  const secondaryByRole = {
    ordinary: [] as number[],
    emitter: [] as number[],
  };
  secondary.snapshot.transforms.forEach((transform, index) =>
    secondaryByRole[role(transform as Transform)].push(index),
  );
  const primaryCounts = { ordinary: 0, emitter: 0 };
  primary.snapshot.transforms.forEach((transform) => {
    primaryCounts[role(transform as Transform)] += 1;
  });
  if (
    primaryCounts.ordinary !== secondaryByRole.ordinary.length ||
    primaryCounts.emitter !== secondaryByRole.emitter.length
  ) {
    return refusal(
      "emitter-count-mismatch",
      `emitter roles differ (${primaryCounts.emitter} vs ${secondaryByRole.emitter.length})`,
    );
  }
  const cursors = { ordinary: 0, emitter: 0 };
  const permutation = primary.snapshot.transforms.map((transform) => {
    const transformRole = role(transform as Transform);
    return secondaryByRole[transformRole][cursors[transformRole]++];
  });
  return Object.freeze({
    kind: "unrelated-role-order-v1",
    secondaryIndexByChildSlot: Object.freeze(permutation),
  });
}

export function prepareEvolutionCrossover(
  primaryInput: EvolutionCrossoverParentInput,
  secondaryInput: EvolutionCrossoverParentInput,
  options: EvolutionCrossoverPreflightOptions = {},
): PrepareEvolutionCrossoverResult {
  let primary: PreparedEvolutionCrossoverParent;
  let secondary: PreparedEvolutionCrossoverParent;
  try {
    primary = prepareParent(primaryInput);
  } catch (error) {
    return Object.freeze({
      accepted: false,
      refusal: refusal("invalid-primary", errorDetail(error)),
    });
  }
  try {
    secondary = prepareParent(secondaryInput);
  } catch (error) {
    return Object.freeze({
      accepted: false,
      refusal: refusal("invalid-secondary", errorDetail(error)),
    });
  }
  if (options.availableResourceIds) {
    for (const resourceId of [
      ...primary.resourceIds,
      ...secondary.resourceIds,
    ]) {
      if (!options.availableResourceIds.has(resourceId)) {
        return Object.freeze({
          accepted: false,
          refusal: refusal(
            "missing-resource",
            `required custom mesh ${resourceId} is unavailable`,
            resourceId,
          ),
        });
      }
    }
  }
  let pairing = relatedPairing(primary, secondary);
  if (pairing === null) pairing = unrelatedPairing(primary, secondary);
  if ("code" in pairing) {
    return Object.freeze({ accepted: false, refusal: pairing });
  }
  return Object.freeze({
    accepted: true,
    prepared: Object.freeze({
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      primary,
      secondary,
      pairing,
    }),
  });
}

function validateCoordinates(
  coordinates: EvolutionCrossoverCoordinates,
): EvolutionCrossoverRefusal | null {
  if (coordinates.algorithmVersion !== CROSSOVER_ALGORITHM_VERSION) {
    return refusal(
      "invalid-coordinates",
      "unsupported crossover algorithm version",
    );
  }
  if (
    !Number.isInteger(coordinates.nodeSeed) ||
    coordinates.nodeSeed < 0 ||
    coordinates.nodeSeed > 0xffff_ffff
  ) {
    return refusal("invalid-coordinates", "nodeSeed must be a uint32");
  }
  if (
    !Number.isSafeInteger(coordinates.childOrdinal) ||
    coordinates.childOrdinal < 0 ||
    Object.is(coordinates.childOrdinal, -0) ||
    !Number.isSafeInteger(coordinates.attempt) ||
    coordinates.attempt < 0 ||
    Object.is(coordinates.attempt, -0)
  ) {
    return refusal(
      "invalid-coordinates",
      "childOrdinal and attempt must be canonical non-negative safe integers",
    );
  }
  return null;
}

function streamParts(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  block: string,
  slot: string,
): readonly (number | string)[] {
  return [
    CROSSOVER_ALGORITHM_VERSION,
    prepared.primary.contentDigest,
    prepared.secondary.contentDigest,
    coordinates.nodeSeed >>> 0,
    coordinates.childOrdinal,
    coordinates.attempt,
    block,
    slot,
  ];
}

/** Exported for the quality wrapper and golden stream tests. */
export function evolutionCrossoverStreamSeed(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  block: string,
  slot = "global",
): number {
  return deriveCrossoverSeed32(streamParts(prepared, coordinates, block, slot));
}

function secondaryWins(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  block: string,
  slot = "global",
): boolean {
  return (
    mulberry32(
      evolutionCrossoverStreamSeed(prepared, coordinates, block, slot),
    )() < 0.5
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function childSlotKey(
  prepared: PreparedEvolutionCrossover,
  index: number,
): string {
  return prepared.pairing.kind === "related-slot-v1"
    ? prepared.primary.topology!.slotKeys[index]
    : `slot:${index}`;
}

function pairedTransforms(
  prepared: PreparedEvolutionCrossover,
  index: number,
): readonly [Transform, Transform] {
  return [
    prepared.primary.snapshot.transforms[index] as Transform,
    prepared.secondary.snapshot.transforms[
      prepared.pairing.secondaryIndexByChildSlot[index]
    ] as Transform,
  ];
}

function donor(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  block: string,
  index?: number,
): Transform {
  if (index === undefined) throw new TypeError("transform donor needs a slot");
  const pair = pairedTransforms(prepared, index);
  return pair[
    secondaryWins(prepared, coordinates, block, childSlotKey(prepared, index))
      ? 1
      : 0
  ];
}

function copyOptionalTransformField<K extends keyof Transform>(
  target: Transform,
  source: Transform,
  key: K,
): void {
  if (Object.hasOwn(source, key)) {
    (target as unknown as Record<PropertyKey, unknown>)[key] = clone(
      source[key],
    );
  }
}

function buildBaseTransform(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  index: number,
): Transform {
  const geometry = donor(prepared, coordinates, "geometry", index);
  const result: Transform = {
    id: index,
    position: clone(geometry.position),
    rotation: clone(geometry.rotation),
    scale: clone(geometry.scale),
  };
  copyOptionalTransformField(result, geometry, "shear");
  const variations = donor(prepared, coordinates, "variations", index);
  copyOptionalTransformField(result, variations, "variations");
  const w = donor(prepared, coordinates, "w", index);
  copyOptionalTransformField(result, w, "w");
  const selectionWeight = donor(
    prepared,
    coordinates,
    "selectionWeight",
    index,
  );
  copyOptionalTransformField(result, selectionWeight, "weight");
  const appearance = donor(prepared, coordinates, "appearance", index);
  copyOptionalTransformField(result, appearance, "colorIndex");
  copyOptionalTransformField(result, appearance, "colorSpeed");
  copyOptionalTransformField(result, appearance, "finish");
  copyOptionalTransformField(result, appearance, "surfacePattern");
  const emitter = donor(prepared, coordinates, "emitter", index);
  copyOptionalTransformField(result, emitter, "emitter");
  return result;
}

/** Densify, permute both axes, then restore the document's sparse row form. */
export function rebuildCrossoverChaos(
  donorTransforms: readonly Transform[],
  childToDonorIndex: readonly number[],
): readonly (readonly number[] | undefined)[] {
  const count = donorTransforms.length;
  if (
    childToDonorIndex.length !== count ||
    new Set(childToDonorIndex).size !== count ||
    childToDonorIndex.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= count,
    )
  ) {
    throw new RangeError(
      "chaos permutation must contain every donor index once",
    );
  }
  const dense = donorTransforms.map((transform, row) =>
    Array.from({ length: count }, (_, column) => {
      const entry = transform.chaos?.[column] ?? 1;
      if (!Number.isFinite(entry)) {
        throw new TypeError(`chaos[${row}][${column}] must be finite`);
      }
      return entry;
    }),
  );
  const remapped = childToDonorIndex.map((donorRow) =>
    childToDonorIndex.map((donorColumn) => dense[donorRow][donorColumn]),
  );
  if (remapped.every((row) => row.every((entry) => entry === 1))) {
    return Object.freeze(remapped.map(() => undefined));
  }
  return Object.freeze(
    remapped.map((row) =>
      row.every((entry) => entry === 1) ? undefined : Object.freeze(row),
    ),
  );
}

function applyChaos(
  transforms: Transform[],
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): void {
  const useSecondary = secondaryWins(prepared, coordinates, "chaosMatrix");
  const donorTransforms = useSecondary
    ? (prepared.secondary.snapshot.transforms as readonly Transform[])
    : (prepared.primary.snapshot.transforms as readonly Transform[]);
  const permutation = useSecondary
    ? prepared.pairing.secondaryIndexByChildSlot
    : transforms.map((_, index) => index);
  const chaos = rebuildCrossoverChaos(donorTransforms, permutation);
  transforms.forEach((transform, index) => {
    const row = chaos[index];
    if (row !== undefined) transform.chaos = [...row];
  });
}

function chosenParent(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
  block: string,
): PreparedEvolutionCrossoverParent {
  return secondaryWins(prepared, coordinates, block)
    ? prepared.secondary
    : prepared.primary;
}

function cloneFinalTransform(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): Transform | undefined {
  const selected = chosenParent(prepared, coordinates, "finalTransform")
    .snapshot.finalTransform;
  if (selected === undefined) return undefined;
  const result = clone(selected) as Transform;
  result.id = 0;
  return result;
}

function cloneSchedule(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): HybridSchedule | undefined {
  const selected = chosenParent(prepared, coordinates, "schedule").snapshot
    .schedule;
  if (selected === undefined) return undefined;
  const result = clone(selected) as HybridSchedule;
  result.transforms.forEach((transform, index) => {
    transform.id = index;
  });
  return result;
}

function cloneSymmetry(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): SymmetryParams {
  const selected = chosenParent(prepared, coordinates, "symmetry").snapshot
    .symmetry;
  const result: SymmetryParams = {
    order: selected.order,
    plane: selected.plane,
  };
  if (Object.hasOwn(selected, "twist")) result.twist = selected.twist;
  return result;
}

function copyOptionalSceneField<K extends keyof SceneSnapshot>(
  target: SceneSnapshot,
  source: ImmutableSceneSnapshot,
  key: K,
): void {
  if (Object.hasOwn(source, key)) {
    (target as unknown as Record<PropertyKey, unknown>)[key] = clone(
      source[key],
    );
  }
}

function childTopology(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): EvolutionTopologyV1 {
  if (prepared.pairing.kind === "related-slot-v1") {
    return prepared.primary.topology!;
  }
  const tokenDigest = sha256Hex(
    canonical([
      CROSSOVER_ALGORITHM_VERSION,
      prepared.primary.contentDigest,
      prepared.secondary.contentDigest,
      coordinates.nodeSeed >>> 0,
      coordinates.childOrdinal,
      coordinates.attempt,
      "topology",
    ]),
  );
  const token = `topology-crossover-v1-${tokenDigest}`;
  return Object.freeze({
    version: 1,
    token,
    slotKeys: Object.freeze(
      prepared.primary.snapshot.transforms.map(
        (_, index) => `${token}:slot:${index}`,
      ),
    ),
  });
}

function buildSnapshot(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): SceneSnapshot {
  const primary = prepared.primary.snapshot;
  const transforms = primary.transforms.map((_, index) =>
    buildBaseTransform(prepared, coordinates, index),
  );
  applyChaos(transforms, prepared, coordinates);
  const finalParent = chosenParent(prepared, coordinates, "finalTransform");
  const finalTransform = cloneFinalTransform(prepared, coordinates);
  const scheduleParent = chosenParent(prepared, coordinates, "schedule");
  const schedule = cloneSchedule(prepared, coordinates);
  const symmetry = cloneSymmetry(prepared, coordinates);
  const snapshot: SceneSnapshot = {
    transforms,
    numPoints: primary.numPoints,
    pointSize: primary.pointSize,
    colorMode: primary.colorMode,
    colorGamma: primary.colorGamma,
    rampPaletteId: primary.rampPaletteId,
    fourDColor: primary.fourDColor,
    fourDDepthFade: primary.fourDDepthFade,
    renderStyle: primary.renderStyle,
    showGuides: primary.showGuides,
    flame: clone(primary.flame),
    solid: clone(primary.solid),
    surface: clone(primary.surface),
    symmetry,
    glowBrightness: primary.glowBrightness,
    background: clone(primary.background) as SceneSnapshot["background"],
  };
  if (Object.hasOwn(finalParent.snapshot, "finalTransform")) {
    snapshot.finalTransform = finalTransform;
  }
  if (Object.hasOwn(scheduleParent.snapshot, "schedule")) {
    snapshot.schedule = schedule;
  }

  const bandParent = chosenParent(
    prepared,
    coordinates,
    "condensationDepthBand",
  ).snapshot;
  copyOptionalSceneField(snapshot, bandParent, "condensationDepthBand");
  const trapParent = chosenParent(prepared, coordinates, "shapeTrap").snapshot;
  copyOptionalSceneField(snapshot, trapParent, "shapeTrap");
  const tilingParent = chosenParent(prepared, coordinates, "tiling").snapshot;
  copyOptionalSceneField(snapshot, tilingParent, "tiling");

  copyOptionalSceneField(snapshot, primary, "customPalette");
  copyOptionalSceneField(snapshot, primary, "positionAxisColors");
  copyOptionalSceneField(snapshot, primary, "camera");
  copyOptionalSceneField(snapshot, primary, "balloonEcho");
  copyOptionalSceneField(snapshot, primary, "balloonRadius");
  copyOptionalSceneField(snapshot, primary, "balloonPaletteId");
  copyOptionalSceneField(snapshot, primary, "balloonCustomPalette");
  copyOptionalSceneField(snapshot, primary, "balloonTint");
  copyOptionalSceneField(snapshot, primary, "balloonTintStrength");
  copyOptionalSceneField(snapshot, primary, "fogDensity");
  copyOptionalSceneField(snapshot, primary, "fogTint");
  copyOptionalSceneField(snapshot, primary, "fogTintStrength");
  copyOptionalSceneField(snapshot, primary, "groundPlane");

  if (systemPartsAreNonFlat(transforms, finalTransform ?? null, symmetry)) {
    if (primary.fourD !== undefined) {
      snapshot.fourD = clone(primary.fourD) as SceneSnapshot["fourD"];
    } else if (prepared.secondary.snapshot.fourD !== undefined) {
      snapshot.fourD = clone(
        prepared.secondary.snapshot.fourD,
      ) as SceneSnapshot["fourD"];
    }
  }
  return snapshot;
}

export function createEvolutionCrossoverAttempt(
  prepared: PreparedEvolutionCrossover,
  coordinates: EvolutionCrossoverCoordinates,
): EvolutionCrossoverAttemptResult {
  const coordinateRefusal = validateCoordinates(coordinates);
  if (coordinateRefusal) {
    return Object.freeze({ accepted: false, refusal: coordinateRefusal });
  }
  let snapshot: SceneSnapshot;
  try {
    snapshot = buildSnapshot(prepared, coordinates);
  } catch (error) {
    const detail = errorDetail(error);
    const code = detail.includes("chaos permutation")
      ? "invalid-chaos-permutation"
      : detail.includes("chaos")
        ? "invalid-chaos-value"
        : "invalid-child";
    return Object.freeze({ accepted: false, refusal: refusal(code, detail) });
  }
  try {
    assertSceneCustomMeshBudget(snapshot);
  } catch (error) {
    return Object.freeze({
      accepted: false,
      refusal: refusal("child-resource-budget-exceeded", errorDetail(error)),
    });
  }
  try {
    assertValidEvolutionSceneSnapshot(snapshot);
  } catch (error) {
    return Object.freeze({
      accepted: false,
      refusal: refusal("invalid-child", errorDetail(error)),
    });
  }
  const ownedSnapshot = ownEvolutionSceneSnapshot(snapshot);
  const topology = childTopology(prepared, coordinates);
  const resourceIds = Object.freeze(sceneCustomMeshIds(snapshot));
  return Object.freeze({
    accepted: true,
    attempt: Object.freeze({
      snapshot: ownedSnapshot,
      topology,
      pairing: prepared.pairing,
      resourceIds,
      primaryContentDigest: prepared.primary.contentDigest,
      secondaryContentDigest: prepared.secondary.contentDigest,
      coordinates: Object.freeze({ ...coordinates }),
    }),
  });
}
