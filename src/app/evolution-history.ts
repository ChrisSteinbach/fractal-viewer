/**
 * Bridge between rounded ordinary undo history and Evolution's retained exact
 * document authority. History owns only this small opaque token; the lineage
 * continues to own the snapshot and its custom-mesh leases.
 */
import {
  evolutionSceneContentDigest,
  type SceneContentDigest,
} from "./evolution-crossover";
import type { ImmutableSceneSnapshot } from "./evolution-candidate";
import type { EvolutionComparisonEndpoint } from "./evolution-comparison";
import type { EvolutionLineage } from "./evolution-lineage";
import type { EvolutionWorkspaceSelection } from "./evolution-workspace";
import type { SceneSnapshot } from "./persist";

const AUTHORITY_PREFIX = "evolution-scene\0";

/** Return a token only when the selected retained node is the exact document
 * displayed now. This digest check prevents a sub-precision outside edit from
 * borrowing the selected node's identity before reconciliation runs. */
export function evolutionHistoryAuthority(
  lineage: EvolutionLineage | null,
  workspace: EvolutionWorkspaceSelection | null,
  displayed: SceneSnapshot | ImmutableSceneSnapshot,
  displayedComparison: EvolutionComparisonEndpoint | null = null,
): string | undefined {
  const retained =
    displayedComparison === null
      ? lineage?.current()?.snapshot
      : comparisonSnapshot(displayedComparison);
  if (!lineage || !workspace || !retained) return undefined;
  let displayedDigest: SceneContentDigest;
  let retainedDigest: SceneContentDigest;
  try {
    displayedDigest = historySceneDigest(displayed);
    retainedDigest = historySceneDigest(retained);
  } catch {
    return undefined;
  }
  return displayedDigest === retainedDigest
    ? `${AUTHORITY_PREFIX}${retainedDigest}`
    : undefined;
}

function comparisonSnapshot(
  endpoint: EvolutionComparisonEndpoint,
): ImmutableSceneSnapshot {
  return endpoint.kind === "lineage"
    ? endpoint.node.snapshot
    : endpoint.snapshot;
}

/** History stores camera/FourDPose out of band. Compare the exact authored
 * scene independently so ordinary orbit/tumble after the Lab closes does not
 * discard a node token; redo can then restore the unrounded scene plus the
 * separately parked live pose. */
function historySceneDigest(
  snapshot: SceneSnapshot | ImmutableSceneSnapshot,
): SceneContentDigest {
  const { camera: _camera, fourD: _fourD, ...scene } = snapshot;
  return evolutionSceneContentDigest(scene);
}

/** Resolve a token only while its exact retained node still exists and still
 * owns the recorded digest. Pruned/reset entries intentionally return null so
 * history falls back to the portable wire and reconciliation detaches. */
export function evolutionSnapshotForHistoryAuthority(
  lineage: EvolutionLineage | null,
  comparisonEndpoints: readonly EvolutionComparisonEndpoint[],
  authority: string | undefined,
): ImmutableSceneSnapshot | null {
  if (!authority?.startsWith(AUTHORITY_PREFIX)) return null;
  const digest = authority.slice(AUTHORITY_PREFIX.length);
  if (!digest.startsWith("scene-sha256-")) return null;
  const nodes = lineage?.all() ?? [];
  const currentId = lineage?.currentId;
  nodes.sort((first, second) =>
    first.id === currentId ? -1 : second.id === currentId ? 1 : 0,
  );
  for (const node of nodes) {
    if (historySceneDigest(node.snapshot) === digest) return node.snapshot;
  }
  for (const endpoint of comparisonEndpoints) {
    const snapshot = comparisonSnapshot(endpoint);
    if (historySceneDigest(snapshot) === digest) return snapshot;
  }
  return null;
}
