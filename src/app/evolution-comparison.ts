/**
 * Session-local A/B comparison policy for Evolution Lab.
 *
 * Retained pins are graph references and therefore resolve visibly missing
 * after prune/reset. External pins instead own one exact decoded authority;
 * they never become lineage nodes or graph roots and survive lineage reset
 * until explicitly replaced, cleared, or disposed. Showing either endpoint
 * is deliberately independent from graph selection.
 */
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import {
  ownEvolutionSceneSnapshot,
  type ImmutableSceneSnapshot,
} from "./evolution-candidate";
import {
  evolutionSceneContentDigest,
  type SceneContentDigest,
} from "./evolution-crossover";
import type {
  EvolutionLineage,
  LineageNode,
  LineageNodeId,
} from "./evolution-lineage";
import type { SceneSnapshot } from "./persist";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
} from "./scene-mesh-assets";

export type EvolutionComparisonSlot = "A" | "B";

export interface EvolutionExternalComparisonEndpointInput {
  /** Unique lifecycle identity for this acquisition, never a genetic input. */
  readonly authorityId: string;
  readonly label: string;
  readonly encodedScene: string;
  readonly snapshot: SceneSnapshot | ImmutableSceneSnapshot;
  readonly contentDigest: SceneContentDigest;
}

export interface EvolutionExternalComparisonEndpoint {
  readonly kind: "external";
  readonly authorityId: string;
  readonly label: string;
  readonly encodedScene: string;
  readonly snapshot: ImmutableSceneSnapshot;
  readonly contentDigest: SceneContentDigest;
  readonly resourceIds: readonly CustomMeshAssetId[];
}

export interface EvolutionLineageComparisonEndpoint {
  readonly kind: "lineage";
  readonly nodeId: LineageNodeId;
  readonly node: LineageNode;
}

export type EvolutionComparisonEndpoint =
  EvolutionLineageComparisonEndpoint | EvolutionExternalComparisonEndpoint;

export type EvolutionComparisonPin =
  | { readonly state: "empty" }
  | {
      readonly state: "available";
      readonly endpoint: EvolutionComparisonEndpoint;
    }
  | { readonly state: "missing"; readonly nodeId: LineageNodeId };

export type EvolutionComparisonLoadResult =
  | {
      readonly displayed: true;
      readonly slot: EvolutionComparisonSlot;
      readonly endpoint: EvolutionComparisonEndpoint;
    }
  | {
      readonly displayed: false;
      readonly reason:
        | "empty"
        | "missing"
        | "pruned-after-load"
        | "load-failed"
        | "superseded";
    };

export type EvolutionComparisonRestoreResult =
  | { readonly restored: true; readonly node: LineageNode }
  | {
      readonly restored: false;
      readonly reason: "load-failed" | "superseded";
    };

export interface EvolutionComparisonSessionOptions {
  /** Releases the resource lease owned by an admitted external authority. */
  readonly onExternalRelease?: (
    endpoint: EvolutionExternalComparisonEndpoint,
  ) => void;
}

type StoredEvolutionComparisonPin =
  | { readonly kind: "lineage"; readonly nodeId: LineageNodeId }
  | EvolutionExternalComparisonEndpoint;

function ownExternalEndpoint(
  input: EvolutionExternalComparisonEndpointInput,
): EvolutionExternalComparisonEndpoint {
  if (typeof input.authorityId !== "string" || input.authorityId.length === 0) {
    throw new TypeError("External comparison authorityId must be non-empty");
  }
  if (typeof input.label !== "string" || input.label.length === 0) {
    throw new TypeError("External comparison label must be non-empty");
  }
  if (
    typeof input.encodedScene !== "string" ||
    input.encodedScene.length === 0
  ) {
    throw new TypeError("External comparison encoded scene must be non-empty");
  }
  const snapshot = ownEvolutionSceneSnapshot(input.snapshot as SceneSnapshot);
  const contentDigest = evolutionSceneContentDigest(snapshot);
  if (input.contentDigest !== contentDigest) {
    throw new TypeError(
      "External comparison content digest does not match its snapshot",
    );
  }
  assertSceneCustomMeshBudget(snapshot as unknown as SceneSnapshot);
  return Object.freeze({
    kind: "external" as const,
    authorityId: input.authorityId,
    label: input.label,
    encodedScene: input.encodedScene,
    snapshot,
    contentDigest,
    resourceIds: Object.freeze(
      sceneCustomMeshIds(snapshot as unknown as SceneSnapshot),
    ),
  });
}

function sameEndpoint(
  first: EvolutionComparisonEndpoint,
  second: EvolutionComparisonEndpoint,
): boolean {
  if (first.kind !== second.kind) return false;
  return first.kind === "lineage" && second.kind === "lineage"
    ? first.nodeId === second.nodeId
    : first.kind === "external" && second.kind === "external"
      ? first.authorityId === second.authorityId
      : false;
}

export class EvolutionComparisonSession {
  private readonly pins: Record<
    EvolutionComparisonSlot,
    StoredEvolutionComparisonPin | null
  > = { A: null, B: null };
  private readonly usedExternalAuthorityIds = new Set<string>();
  private readonly onExternalRelease?: (
    endpoint: EvolutionExternalComparisonEndpoint,
  ) => void;
  private activeSlotValue: EvolutionComparisonSlot | null = null;
  private requestTicket = 0;
  private disposed = false;

  constructor(
    readonly lineage: EvolutionLineage,
    options: EvolutionComparisonSessionOptions = {},
  ) {
    this.onExternalRelease = options.onExternalRelease;
  }

  get activeSlot(): EvolutionComparisonSlot | null {
    return this.activeSlotValue;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Supersede an endpoint load without changing the current override. */
  cancelPending(): void {
    this.requestTicket += 1;
  }

  /** Pin a retained graph authority. Unknown ids leave the previous pin. */
  pin(slot: EvolutionComparisonSlot, nodeId: LineageNodeId): boolean {
    this.ensureActive();
    if (!this.lineage.node(nodeId)) return false;
    this.replace(slot, { kind: "lineage", nodeId });
    return true;
  }

  /** Admit an independently owned external authority. The lifecycle id may
   * never be reused, preventing replacement from releasing a newer lease. */
  pinExternal(
    slot: EvolutionComparisonSlot,
    input: EvolutionExternalComparisonEndpointInput,
  ): EvolutionExternalComparisonEndpoint {
    this.ensureActive();
    const endpoint = ownExternalEndpoint(input);
    if (this.usedExternalAuthorityIds.has(endpoint.authorityId)) {
      throw new RangeError(
        `External comparison authorityId was already used: ${endpoint.authorityId}`,
      );
    }
    this.usedExternalAuthorityIds.add(endpoint.authorityId);
    this.replace(slot, endpoint);
    return endpoint;
  }

  clear(slot: EvolutionComparisonSlot): void {
    this.ensureActive();
    this.cancelPending();
    if (this.activeSlotValue === slot) this.activeSlotValue = null;
    const previous = this.pins[slot];
    this.pins[slot] = null;
    this.releaseExternal(previous);
  }

  resolve(slot: EvolutionComparisonSlot): EvolutionComparisonPin {
    this.ensureActive();
    const stored = this.pins[slot];
    if (stored === null) return { state: "empty" };
    if (stored.kind === "external") {
      return Object.freeze({ state: "available" as const, endpoint: stored });
    }
    const node = this.lineage.node(stored.nodeId);
    return node
      ? Object.freeze({
          state: "available" as const,
          endpoint: Object.freeze({
            kind: "lineage" as const,
            nodeId: stored.nodeId,
            node,
          }),
        })
      : Object.freeze({ state: "missing" as const, nodeId: stored.nodeId });
  }

  active():
    | {
        readonly slot: EvolutionComparisonSlot;
        readonly pin: EvolutionComparisonPin;
      }
    | undefined {
    this.ensureActive();
    return this.activeSlotValue === null
      ? undefined
      : {
          slot: this.activeSlotValue,
          pin: this.resolve(this.activeSlotValue),
        };
  }

  /**
   * Replace the displayed document with one pinned endpoint. Only the newest
   * request may become the declared display override. The lineage's selected
   * node and navigation history are never touched.
   */
  async show(
    slot: EvolutionComparisonSlot,
    load: (endpoint: EvolutionComparisonEndpoint) => Promise<boolean>,
  ): Promise<EvolutionComparisonLoadResult> {
    this.ensureActive();
    const pin = this.resolve(slot);
    if (pin.state === "empty") {
      return { displayed: false, reason: "empty" };
    }
    if (pin.state === "missing") {
      return { displayed: false, reason: "missing" };
    }
    const ticket = ++this.requestTicket;
    const loaded = await load(pin.endpoint);
    if (ticket !== this.requestTicket) {
      return { displayed: false, reason: "superseded" };
    }
    if (!loaded) return { displayed: false, reason: "load-failed" };
    const retained = this.resolve(slot);
    if (
      retained.state !== "available" ||
      !sameEndpoint(retained.endpoint, pin.endpoint)
    ) {
      return { displayed: false, reason: "pruned-after-load" };
    }
    this.activeSlotValue = slot;
    return {
      displayed: true,
      slot,
      endpoint: retained.endpoint,
    };
  }

  /** Restore the graph-selected node without moving graph selection. */
  async restore(
    selected: LineageNode,
    load: (node: LineageNode) => Promise<boolean>,
  ): Promise<EvolutionComparisonRestoreResult> {
    this.ensureActive();
    const ticket = ++this.requestTicket;
    const loaded = await load(selected);
    if (ticket !== this.requestTicket) {
      return { restored: false, reason: "superseded" };
    }
    this.activeSlotValue = null;
    return loaded
      ? { restored: true, node: selected }
      : { restored: false, reason: "load-failed" };
  }

  /** An outside edit invalidates the display override immediately. */
  invalidateDisplay(): void {
    this.ensureActive();
    this.cancelPending();
    this.activeSlotValue = null;
  }

  /** End external authority ownership. Terminal and idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.cancelPending();
    this.activeSlotValue = null;
    const endpoints = [this.pins.A, this.pins.B];
    this.pins.A = null;
    this.pins.B = null;
    this.disposed = true;
    endpoints.forEach((endpoint) => this.releaseExternal(endpoint));
  }

  private replace(
    slot: EvolutionComparisonSlot,
    endpoint: StoredEvolutionComparisonPin,
  ): void {
    this.cancelPending();
    if (this.activeSlotValue === slot) this.activeSlotValue = null;
    const previous = this.pins[slot];
    this.pins[slot] = endpoint;
    this.releaseExternal(previous);
  }

  private releaseExternal(endpoint: StoredEvolutionComparisonPin | null): void {
    if (endpoint?.kind === "external") this.onExternalRelease?.(endpoint);
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error("This comparison session is disposed");
    }
  }
}
