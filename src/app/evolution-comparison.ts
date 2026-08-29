/**
 * Session-local A/B comparison policy for Evolution Lab.
 *
 * Pins are references to retained lineage nodes, not copies. That makes a
 * pruned/reset endpoint resolve as visibly missing instead of quietly keeping
 * an orphaned scene alive. Showing an endpoint is deliberately independent
 * from graph selection: the injected loader may replace the displayed
 * document, but this controller never calls a lineage visit method.
 */
import type {
  EvolutionLineage,
  LineageNode,
  LineageNodeId,
} from "./evolution-lineage";

export type EvolutionComparisonSlot = "A" | "B";

export type EvolutionComparisonPin =
  | { readonly state: "empty" }
  | {
      readonly state: "available";
      readonly nodeId: LineageNodeId;
      readonly node: LineageNode;
    }
  | { readonly state: "missing"; readonly nodeId: LineageNodeId };

export type EvolutionComparisonLoadResult =
  | {
      readonly displayed: true;
      readonly slot: EvolutionComparisonSlot;
      readonly node: LineageNode;
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

export class EvolutionComparisonSession {
  private readonly pins: Record<EvolutionComparisonSlot, LineageNodeId | null> =
    { A: null, B: null };
  private activeSlotValue: EvolutionComparisonSlot | null = null;
  private requestTicket = 0;

  constructor(readonly lineage: EvolutionLineage) {}

  get activeSlot(): EvolutionComparisonSlot | null {
    return this.activeSlotValue;
  }

  /** Supersede an endpoint load without changing the current override. */
  cancelPending(): void {
    this.requestTicket += 1;
  }

  pin(slot: EvolutionComparisonSlot, nodeId: LineageNodeId): boolean {
    if (!this.lineage.node(nodeId)) return false;
    // Never keep claiming that the canvas shows A/B after that slot starts
    // naming a different endpoint. The integration restores selection (or
    // detaches visibly) before offering pin replacement while active.
    if (this.activeSlotValue === slot) this.invalidateDisplay();
    this.pins[slot] = nodeId;
    return true;
  }

  clear(slot: EvolutionComparisonSlot): void {
    if (this.activeSlotValue === slot) this.invalidateDisplay();
    this.pins[slot] = null;
  }

  resolve(slot: EvolutionComparisonSlot): EvolutionComparisonPin {
    const nodeId = this.pins[slot];
    if (nodeId === null) return { state: "empty" };
    const node = this.lineage.node(nodeId);
    return node
      ? { state: "available", nodeId, node }
      : { state: "missing", nodeId };
  }

  active():
    | {
        readonly slot: EvolutionComparisonSlot;
        readonly pin: EvolutionComparisonPin;
      }
    | undefined {
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
    load: (node: LineageNode) => Promise<boolean>,
  ): Promise<EvolutionComparisonLoadResult> {
    const pin = this.resolve(slot);
    if (pin.state === "empty") {
      return { displayed: false, reason: "empty" };
    }
    if (pin.state === "missing") {
      return { displayed: false, reason: "missing" };
    }
    const ticket = ++this.requestTicket;
    const loaded = await load(pin.node);
    if (ticket !== this.requestTicket) {
      return { displayed: false, reason: "superseded" };
    }
    if (!loaded) return { displayed: false, reason: "load-failed" };
    const retained = this.resolve(slot);
    if (retained.state !== "available" || retained.nodeId !== pin.nodeId) {
      return { displayed: false, reason: "pruned-after-load" };
    }
    this.activeSlotValue = slot;
    return { displayed: true, slot, node: retained.node };
  }

  /** Restore the graph-selected node without moving graph selection. */
  async restore(
    selected: LineageNode,
    load: (node: LineageNode) => Promise<boolean>,
  ): Promise<EvolutionComparisonRestoreResult> {
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
    this.cancelPending();
    this.activeSlotValue = null;
  }
}
