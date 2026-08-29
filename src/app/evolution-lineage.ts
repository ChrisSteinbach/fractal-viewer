/**
 * Session-local Evolution Lab lineage.
 *
 * The graph deliberately owns no storage and knows nothing about the DOM or
 * scene decoder. An encoded full scene document (including its saved view) is
 * opaque authority here. Mutation adds one-parent nodes; the two-parent API is
 * reserved for crossover, making the model DAG-ready without changing the
 * ordinary tree workflow.
 *
 * Every authority-bearing input is copied on admission. Read methods return a
 * fresh thumbnail copy, while profiles and resource-id lists are recursively
 * frozen. A refused admission takes ownership of nothing. Prune, reset, and
 * dispose notify the optional release hook exactly once for every removed
 * node, allowing an integration layer to retire thumbnail/object-URL or
 * custom-mesh leases without this pure model importing those systems.
 */
import type { SceneSnapshot } from "./persist";

export const LINEAGE_NODE_CAP = 64;
export const LINEAGE_THUMBNAIL_BYTE_CAP = 12 * 1024 * 1024;
export const LINEAGE_RESOURCE_REFERENCE_CAP = LINEAGE_NODE_CAP * 4;

export type LineageNodeId = string;

export type LineageProfileValue =
  | null
  | boolean
  | number
  | string
  | readonly LineageProfileValue[]
  | { readonly [key: string]: LineageProfileValue };

/** Plain JSON-shaped algorithm metadata, copied and deeply frozen on entry. */
export type LineageProfile = Readonly<Record<string, LineageProfileValue>>;

export type ImmutableLineageSceneSnapshot<T = SceneSnapshot> = T extends (
  ...args: never[]
) => unknown
  ? T
  : T extends readonly (infer Entry)[]
    ? readonly ImmutableLineageSceneSnapshot<Entry>[]
    : T extends object
      ? { readonly [Key in keyof T]: ImmutableLineageSceneSnapshot<T[Key]> }
      : T;

export interface LineageNodeInput {
  /** `encodeScene` output used as the canonical reconciliation key. */
  readonly encodedScene: string;
  /** Exact full authored scene and saved view. Unlike the encoded key this is
   * not rounded by the portable codec. */
  readonly snapshot: SceneSnapshot;
  /** Opaque thumbnail bytes. Evolution currently supplies RGBA pixels. */
  readonly thumbnail: Uint8ClampedArray;
  /** Mutation/crossover seed, retained as unsigned 32-bit provenance. */
  readonly seed: number;
  /** Versioned mutation/crossover profile. */
  readonly profile: LineageProfile;
  /** Optional external resource references needed by this exact scene. */
  readonly resourceIds?: readonly string[];
}

export type LineageNodeKind = "root" | "mutation" | "crossover";

/**
 * A defensive node snapshot. The thumbnail is a fresh copy on every read;
 * mutating it cannot reach back into the graph.
 */
export interface LineageNode {
  readonly id: LineageNodeId;
  readonly kind: LineageNodeKind;
  readonly encodedScene: string;
  readonly snapshot: ImmutableLineageSceneSnapshot;
  readonly thumbnail: Uint8ClampedArray;
  readonly thumbnailBytes: number;
  readonly seed: number;
  readonly profile: LineageProfile;
  readonly resourceIds: readonly string[];
  readonly parentIds: readonly LineageNodeId[];
  readonly childIds: readonly LineageNodeId[];
}

export interface ReleasedLineageNode {
  readonly id: LineageNodeId;
  readonly thumbnailBytes: number;
  readonly resourceIds: readonly string[];
}

export interface EvolutionLineageOptions {
  readonly nodeCap?: number;
  /** Aggregate thumbnail bytes retained by the graph, not a per-node cap. */
  readonly thumbnailByteCap?: number;
  /** Aggregate node-to-resource references, after per-node de-duplication. */
  readonly resourceReferenceCap?: number;
  readonly onRelease?: (node: ReleasedLineageNode) => void;
}

export type LineageCapReason =
  "node-cap" | "thumbnail-byte-cap" | "resource-reference-cap";

export type AddLineageNodeResult =
  | { readonly added: true; readonly node: LineageNode }
  | {
      readonly added: false;
      readonly reason: LineageCapReason;
      readonly limit: number;
      readonly requested: number;
    };

export type PruneLineageResult =
  | {
      readonly pruned: true;
      /** Deterministic insertion order. Empty when another parent retained it. */
      readonly removedIds: readonly LineageNodeId[];
    }
  | {
      readonly pruned: false;
      readonly reason:
        "not-found" | "root-protected" | "ambiguous-parent" | "not-a-parent";
    };

interface StoredNode {
  readonly id: LineageNodeId;
  readonly kind: LineageNodeKind;
  readonly encodedScene: string;
  readonly snapshot: ImmutableLineageSceneSnapshot;
  readonly thumbnail: Uint8ClampedArray;
  readonly seed: number;
  readonly profile: LineageProfile;
  readonly resourceIds: readonly string[];
  parentIds: LineageNodeId[];
  childIds: LineageNodeId[];
}

interface OwnedInput {
  readonly encodedScene: string;
  readonly snapshot: ImmutableLineageSceneSnapshot;
  readonly thumbnail: Uint8ClampedArray;
  readonly seed: number;
  readonly profile: LineageProfile;
  readonly resourceIds: readonly string[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function cloneProfileValue(
  value: LineageProfileValue,
  ancestors: Set<object>,
): LineageProfileValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Lineage profiles contain only finite numbers");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Lineage profiles must be plain JSON-shaped data");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Lineage profiles cannot contain cycles");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const entries = value as readonly LineageProfileValue[];
    const copy = entries.map((entry) => cloneProfileValue(entry, ancestors));
    ancestors.delete(value);
    return Object.freeze(copy);
  }
  const objectValue = value as Readonly<Record<string, LineageProfileValue>>;
  const proto: unknown = Object.getPrototypeOf(objectValue);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("Lineage profiles must contain only plain objects");
  }
  const copy: Record<string, LineageProfileValue> = {};
  for (const [key, entry] of Object.entries(objectValue)) {
    copy[key] = cloneProfileValue(entry, ancestors);
  }
  ancestors.delete(value);
  return Object.freeze(copy);
}

function freezeRecursively(value: unknown, seen: Set<object>): void {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeRecursively((value as Record<PropertyKey, unknown>)[key], seen);
  }
  Object.freeze(value);
}

function ownSnapshot(snapshot: SceneSnapshot): ImmutableLineageSceneSnapshot {
  const owned = structuredClone(snapshot);
  freezeRecursively(owned, new Set());
  return owned;
}

function ownInput(input: LineageNodeInput): OwnedInput {
  if (
    typeof input.encodedScene !== "string" ||
    input.encodedScene.length === 0
  ) {
    throw new TypeError("Lineage encodedScene must be a non-empty string");
  }
  if (
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 0xffff_ffff
  ) {
    throw new RangeError("Lineage seed must be an unsigned 32-bit integer");
  }
  if (
    typeof input.profile !== "object" ||
    input.profile === null ||
    Array.isArray(input.profile)
  ) {
    throw new TypeError("Lineage profile must be a plain object");
  }
  const resourceIds: string[] = [];
  const seenIds = new Set<string>();
  for (const id of input.resourceIds ?? []) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("Lineage resource ids must be non-empty strings");
    }
    if (!seenIds.has(id)) {
      seenIds.add(id);
      resourceIds.push(id);
    }
  }
  return {
    encodedScene: input.encodedScene,
    snapshot: ownSnapshot(input.snapshot),
    thumbnail: new Uint8ClampedArray(input.thumbnail),
    seed: input.seed,
    profile: cloneProfileValue(input.profile, new Set()) as LineageProfile,
    resourceIds: Object.freeze(resourceIds),
  };
}

/**
 * A bounded, in-memory lineage graph. No method reads or writes browser
 * persistence; constructing a new instance starts a new lineage session.
 */
export class EvolutionLineage {
  readonly nodeCap: number;
  readonly thumbnailByteCap: number;
  readonly resourceReferenceCap: number;

  private nodesById = new Map<LineageNodeId, StoredNode>();
  private rootIdValue: LineageNodeId | null = null;
  private currentIdValue: LineageNodeId | null = null;
  private nextId = 0;
  private thumbnailBytesValue = 0;
  private resourceReferenceCountValue = 0;
  private backHistory: LineageNodeId[] = [];
  private forwardHistory: LineageNodeId[] = [];
  private readonly branchChoice = new Map<LineageNodeId, LineageNodeId>();
  private disposed = false;
  private readonly onRelease?: (node: ReleasedLineageNode) => void;

  constructor(root: LineageNodeInput, options: EvolutionLineageOptions = {}) {
    this.nodeCap = positiveInteger(
      options.nodeCap ?? LINEAGE_NODE_CAP,
      "Lineage node cap",
    );
    this.thumbnailByteCap = nonnegativeInteger(
      options.thumbnailByteCap ?? LINEAGE_THUMBNAIL_BYTE_CAP,
      "Lineage thumbnail byte cap",
    );
    this.resourceReferenceCap = nonnegativeInteger(
      options.resourceReferenceCap ?? LINEAGE_RESOURCE_REFERENCE_CAP,
      "Lineage resource reference cap",
    );
    this.onRelease = options.onRelease;

    const owned = ownInput(root);
    this.assertRootFits(owned);
    const node = this.installNode("root", [], owned);
    this.rootIdValue = node.id;
    this.currentIdValue = node.id;
  }

  get size(): number {
    return this.nodesById.size;
  }

  get rootId(): LineageNodeId | null {
    return this.rootIdValue;
  }

  get currentId(): LineageNodeId | null {
    return this.currentIdValue;
  }

  get thumbnailBytes(): number {
    return this.thumbnailBytesValue;
  }

  get resourceReferenceCount(): number {
    return this.resourceReferenceCountValue;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  node(id: LineageNodeId): LineageNode | null {
    const node = this.nodesById.get(id);
    return node ? this.publicNode(node) : null;
  }

  current(): LineageNode | null {
    return this.currentIdValue === null ? null : this.node(this.currentIdValue);
  }

  /**
   * Find an exact retained document without exposing the graph's owned
   * storage. Evolution Lab uses the canonical `encodeScene` string as its
   * reconciliation key after undo, redo, or an edit outside the workspace.
   * Keeping the scan here avoids copying every retained thumbnail merely to
   * compare opaque document strings.
   */
  findByEncodedScene(encodedScene: string): LineageNode | null {
    for (const node of this.nodesById.values()) {
      if (node.encodedScene === encodedScene) return this.publicNode(node);
    }
    return null;
  }

  /** All nodes in deterministic insertion/id order. */
  all(): LineageNode[] {
    return [...this.nodesById.values()].map((node) => this.publicNode(node));
  }

  addMutation(
    parentId: LineageNodeId,
    input: LineageNodeInput,
  ): AddLineageNodeResult {
    this.ensureActive();
    this.requireNode(parentId);
    return this.addNode("mutation", [parentId], input);
  }

  addCrossover(
    firstParentId: LineageNodeId,
    secondParentId: LineageNodeId,
    input: LineageNodeInput,
  ): AddLineageNodeResult {
    this.ensureActive();
    this.requireNode(firstParentId);
    this.requireNode(secondParentId);
    if (firstParentId === secondParentId) {
      throw new RangeError("A crossover node requires two distinct parents");
    }
    return this.addNode("crossover", [firstParentId, secondParentId], input);
  }

  /**
   * Visit any retained node. Direct child visits also remember that branch as
   * the parent's preferred forward choice. A new visit clears redo history.
   */
  visit(id: LineageNodeId): boolean {
    this.ensureActive();
    if (!this.nodesById.has(id)) return false;
    const current = this.currentIdValue;
    if (current === id) return true;
    if (
      current !== null &&
      this.nodesById.get(current)?.childIds.includes(id)
    ) {
      this.branchChoice.set(current, id);
    }
    if (current !== null) this.backHistory.push(current);
    this.currentIdValue = id;
    this.forwardHistory = [];
    return true;
  }

  /**
   * Align selection to externally displayed retained authority without
   * manufacturing a lineage-navigation history entry or changing a parent's
   * remembered branch. Used only for undo/redo/outside-load reconciliation.
   */
  reconcileVisit(id: LineageNodeId): boolean {
    this.ensureActive();
    if (!this.nodesById.has(id)) return false;
    this.currentIdValue = id;
    return true;
  }

  /** Select and visit one direct child, explicitly changing branch-forward. */
  visitBranch(childId: LineageNodeId): boolean {
    this.ensureActive();
    const current = this.currentIdValue;
    if (
      current === null ||
      !this.nodesById.get(current)?.childIds.includes(childId)
    ) {
      return false;
    }
    this.branchChoice.set(current, childId);
    return this.visit(childId);
  }

  /** Browser-style back over visits, skipping any nodes later pruned. */
  back(): LineageNode | null {
    this.ensureActive();
    const current = this.currentIdValue;
    if (current === null) return null;
    const target = this.popRetained(this.backHistory, current);
    if (target === null) return null;
    this.forwardHistory.push(current);
    if (this.nodesById.get(target)?.childIds.includes(current)) {
      this.branchChoice.set(target, current);
    }
    this.currentIdValue = target;
    return this.node(target);
  }

  /**
   * Redo a backed-out visit. With no redo entry, follow the current node's
   * remembered branch choice, if it still names a direct retained child.
   */
  forward(): LineageNode | null {
    this.ensureActive();
    const current = this.currentIdValue;
    if (current === null) return null;
    let target = this.popRetained(this.forwardHistory, current);
    if (target === null) {
      const preferred = this.branchChoice.get(current);
      if (
        preferred === undefined ||
        !this.nodesById.get(current)?.childIds.includes(preferred)
      ) {
        return null;
      }
      target = preferred;
    }
    this.backHistory.push(current);
    if (this.nodesById.get(current)?.childIds.includes(target)) {
      this.branchChoice.set(current, target);
    }
    this.currentIdValue = target;
    return this.node(target);
  }

  preferredChildId(
    id: LineageNodeId = this.currentIdValue ?? "",
  ): LineageNodeId | null {
    const preferred = this.branchChoice.get(id);
    return preferred !== undefined &&
      this.nodesById.get(id)?.childIds.includes(preferred)
      ? preferred
      : null;
  }

  /**
   * Remove one parent -> child branch edge, then release every node no longer
   * reachable from the protected root. For a two-parent node the parent must
   * be named; pruning one edge retains the node and its descendants while the
   * other parent still reaches them.
   */
  prune(
    nodeId: LineageNodeId,
    fromParentId?: LineageNodeId,
  ): PruneLineageResult {
    this.ensureActive();
    const node = this.nodesById.get(nodeId);
    if (!node) return { pruned: false, reason: "not-found" };
    if (nodeId === this.rootIdValue) {
      return { pruned: false, reason: "root-protected" };
    }
    if (fromParentId === undefined && node.parentIds.length !== 1) {
      return { pruned: false, reason: "ambiguous-parent" };
    }
    const parentId = fromParentId ?? node.parentIds[0];
    if (!node.parentIds.includes(parentId)) {
      return { pruned: false, reason: "not-a-parent" };
    }
    const parent = this.nodesById.get(parentId);
    if (!parent) return { pruned: false, reason: "not-a-parent" };

    parent.childIds = parent.childIds.filter((id) => id !== nodeId);
    node.parentIds = node.parentIds.filter((id) => id !== parentId);
    if (this.branchChoice.get(parentId) === nodeId) {
      this.branchChoice.delete(parentId);
    }
    const removed = this.sweepUnreachable(parentId);
    return Object.freeze({
      pruned: true as const,
      removedIds: Object.freeze(removed.map((entry) => entry.id)),
    });
  }

  /**
   * Replace the entire session graph with a new root. The root is validated
   * and copied before any current node is released, so invalid input leaves
   * the existing session untouched. Node ids remain monotonic to keep stale
   * external ids from ever naming a new node after reset.
   */
  reset(root: LineageNodeInput): LineageNode {
    this.ensureActive();
    const owned = ownInput(root);
    this.assertRootFits(owned);
    const released = [...this.nodesById.values()];
    this.nodesById = new Map();
    this.thumbnailBytesValue = 0;
    this.resourceReferenceCountValue = 0;
    this.backHistory = [];
    this.forwardHistory = [];
    this.branchChoice.clear();
    const node = this.installNode("root", [], owned);
    this.rootIdValue = node.id;
    this.currentIdValue = node.id;
    this.release(released);
    return this.publicNode(node);
  }

  /** End this session and release every retained node. Terminal/idempotent. */
  dispose(): void {
    if (this.disposed) return;
    const released = [...this.nodesById.values()];
    this.nodesById.clear();
    this.rootIdValue = null;
    this.currentIdValue = null;
    this.thumbnailBytesValue = 0;
    this.resourceReferenceCountValue = 0;
    this.backHistory = [];
    this.forwardHistory = [];
    this.branchChoice.clear();
    this.disposed = true;
    this.release(released);
  }

  private addNode(
    kind: Exclude<LineageNodeKind, "root">,
    parentIds: LineageNodeId[],
    input: LineageNodeInput,
  ): AddLineageNodeResult {
    const resourceIds = [...new Set(input.resourceIds ?? [])];
    const cap = this.capRefusal(input.thumbnail.byteLength, resourceIds.length);
    if (cap) return cap;
    const owned = ownInput(input);
    const node = this.installNode(kind, parentIds, owned);
    return { added: true, node: this.publicNode(node) };
  }

  private capRefusal(
    thumbnailBytes: number,
    resourceReferences: number,
  ): Exclude<AddLineageNodeResult, { readonly added: true }> | null {
    if (this.size + 1 > this.nodeCap) {
      return {
        added: false,
        reason: "node-cap",
        limit: this.nodeCap,
        requested: this.size + 1,
      };
    }
    const requestedBytes = this.thumbnailBytesValue + thumbnailBytes;
    if (requestedBytes > this.thumbnailByteCap) {
      return {
        added: false,
        reason: "thumbnail-byte-cap",
        limit: this.thumbnailByteCap,
        requested: requestedBytes,
      };
    }
    const requestedReferences =
      this.resourceReferenceCountValue + resourceReferences;
    if (requestedReferences > this.resourceReferenceCap) {
      return {
        added: false,
        reason: "resource-reference-cap",
        limit: this.resourceReferenceCap,
        requested: requestedReferences,
      };
    }
    return null;
  }

  private assertRootFits(root: OwnedInput): void {
    if (root.thumbnail.byteLength > this.thumbnailByteCap) {
      throw new RangeError("Lineage root exceeds the thumbnail byte cap");
    }
    if (root.resourceIds.length > this.resourceReferenceCap) {
      throw new RangeError("Lineage root exceeds the resource reference cap");
    }
  }

  private installNode(
    kind: LineageNodeKind,
    parentIds: LineageNodeId[],
    input: OwnedInput,
  ): StoredNode {
    const id = `lineage-${this.nextId++}`;
    const node: StoredNode = {
      id,
      kind,
      encodedScene: input.encodedScene,
      snapshot: input.snapshot,
      thumbnail: input.thumbnail,
      seed: input.seed,
      profile: input.profile,
      resourceIds: input.resourceIds,
      parentIds: [...parentIds],
      childIds: [],
    };
    this.nodesById.set(id, node);
    for (const parentId of parentIds) {
      this.requireNode(parentId).childIds.push(id);
    }
    this.thumbnailBytesValue += node.thumbnail.byteLength;
    this.resourceReferenceCountValue += node.resourceIds.length;
    return node;
  }

  private sweepUnreachable(fallbackId: LineageNodeId): StoredNode[] {
    const reachable = new Set<LineageNodeId>();
    const pending = this.rootIdValue === null ? [] : [this.rootIdValue];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      const node = this.nodesById.get(id);
      if (!node) continue;
      reachable.add(id);
      for (let index = node.childIds.length - 1; index >= 0; index--) {
        pending.push(node.childIds[index]);
      }
    }

    const removed = [...this.nodesById.values()].filter(
      (node) => !reachable.has(node.id),
    );
    if (removed.length === 0) return removed;
    const removedIds = new Set(removed.map((node) => node.id));
    for (const node of this.nodesById.values()) {
      if (removedIds.has(node.id)) continue;
      node.parentIds = node.parentIds.filter((id) => !removedIds.has(id));
      node.childIds = node.childIds.filter((id) => !removedIds.has(id));
    }
    for (const node of removed) {
      this.nodesById.delete(node.id);
      this.thumbnailBytesValue -= node.thumbnail.byteLength;
      this.resourceReferenceCountValue -= node.resourceIds.length;
    }
    this.backHistory = this.backHistory.filter((id) => reachable.has(id));
    this.forwardHistory = this.forwardHistory.filter((id) => reachable.has(id));
    for (const [parentId, childId] of this.branchChoice) {
      if (
        !reachable.has(parentId) ||
        !reachable.has(childId) ||
        !this.nodesById.get(parentId)?.childIds.includes(childId)
      ) {
        this.branchChoice.delete(parentId);
      }
    }
    if (this.currentIdValue !== null && removedIds.has(this.currentIdValue)) {
      this.currentIdValue = reachable.has(fallbackId)
        ? fallbackId
        : this.rootIdValue;
      this.backHistory = this.backHistory.filter(
        (id) => id !== this.currentIdValue,
      );
      this.forwardHistory = this.forwardHistory.filter(
        (id) => id !== this.currentIdValue,
      );
    }
    this.release(removed);
    return removed;
  }

  private publicNode(node: StoredNode): LineageNode {
    return Object.freeze({
      id: node.id,
      kind: node.kind,
      encodedScene: node.encodedScene,
      snapshot: node.snapshot,
      thumbnail: new Uint8ClampedArray(node.thumbnail),
      thumbnailBytes: node.thumbnail.byteLength,
      seed: node.seed,
      profile: node.profile,
      resourceIds: node.resourceIds,
      parentIds: Object.freeze([...node.parentIds]),
      childIds: Object.freeze([...node.childIds]),
    });
  }

  private popRetained(
    stack: LineageNodeId[],
    current: LineageNodeId,
  ): LineageNodeId | null {
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id !== current && this.nodesById.has(id)) return id;
    }
    return null;
  }

  private requireNode(id: LineageNodeId): StoredNode {
    const node = this.nodesById.get(id);
    if (!node) throw new RangeError(`Unknown lineage node: ${id}`);
    return node;
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("This lineage session is disposed");
  }

  private release(nodes: readonly StoredNode[]): void {
    if (!this.onRelease) return;
    for (const node of nodes) {
      this.onRelease(
        Object.freeze({
          id: node.id,
          thumbnailBytes: node.thumbnail.byteLength,
          resourceIds: node.resourceIds,
        }),
      );
    }
  }
}
