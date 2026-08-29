/**
 * Async document-selection policy for the session-local Evolution Lab.
 *
 * The graph is deliberately synchronous, while a real scene visit may have
 * to hydrate custom meshes before it can enter the existing undoable load
 * path. This adapter keeps those two clocks honest: only the newest request
 * may commit graph selection, and only after its injected loader reports that
 * the exact document was applied. It also owns the visible attached/detached
 * reconciliation state used after undo, redo, Collection loads, and editor
 * changes.
 */
import type {
  EvolutionLineage,
  LineageNode,
  LineageNodeId,
} from "./evolution-lineage";

export type EvolutionSelectionResult =
  | { readonly selected: true; readonly node: LineageNode }
  | {
      readonly selected: false;
      readonly reason: "not-found" | "load-failed" | "superseded";
    };

export type EvolutionReconciliation =
  | { readonly attached: true; readonly node: LineageNode }
  | { readonly attached: false };

export class EvolutionWorkspaceSelection {
  private requestTicket = 0;
  private detachedValue = false;

  constructor(readonly lineage: EvolutionLineage) {}

  get detached(): boolean {
    return this.detachedValue;
  }

  /** Supersede an in-flight visit without changing graph selection. */
  cancelPending(): void {
    this.requestTicket += 1;
  }

  /**
   * Load and then select one retained node. Direct-child visits use the
   * graph's branch API so Forward remembers the chosen branch. The loader is
   * expected to be latest-wins too (the app's exact `loadSceneSnapshot` is), but the
   * local ticket independently prevents stale async completion from moving
   * graph selection.
   */
  async select(
    nodeId: LineageNodeId,
    load: (node: LineageNode) => Promise<boolean>,
  ): Promise<EvolutionSelectionResult> {
    const target = this.lineage.node(nodeId);
    if (!target) return { selected: false, reason: "not-found" };
    const sourceId = this.lineage.currentId;
    const ticket = ++this.requestTicket;
    const loaded = await load(target);
    if (ticket !== this.requestTicket) {
      return { selected: false, reason: "superseded" };
    }
    if (!loaded) return { selected: false, reason: "load-failed" };
    const retained = this.lineage.node(nodeId);
    if (!retained) {
      this.detachedValue = true;
      return { selected: false, reason: "not-found" };
    }
    const source = sourceId === null ? null : this.lineage.node(sourceId);
    const selected =
      sourceId === this.lineage.currentId && source?.childIds.includes(nodeId)
        ? this.lineage.visitBranch(nodeId)
        : this.lineage.visit(nodeId);
    if (!selected) {
      this.detachedValue = true;
      return { selected: false, reason: "not-found" };
    }
    this.detachedValue = false;
    return { selected: true, node: this.lineage.node(nodeId)! };
  }

  /**
   * Reconcile the displayed canonical document with retained authority.
   * Exact matches move selection to that node; an unknown document leaves
   * the previous graph selection intact and visibly detaches the workspace.
   */
  reconcile(encodedScene: string): EvolutionReconciliation {
    this.cancelPending();
    const match = this.lineage.findByEncodedScene(encodedScene);
    if (!match) {
      this.detachedValue = true;
      return { attached: false };
    }
    this.lineage.reconcileVisit(match.id);
    this.detachedValue = false;
    return { attached: true, node: this.lineage.node(match.id)! };
  }

  /** A successful reset attaches the controller to the graph's new root. */
  noteReset(): void {
    this.cancelPending();
    this.detachedValue = false;
  }
}
