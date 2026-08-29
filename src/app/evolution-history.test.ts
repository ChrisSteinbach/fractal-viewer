import { EditSession } from "./edit-session";
import {
  evolutionHistoryAuthority,
  evolutionSnapshotForHistoryAuthority,
} from "./evolution-history";
import { evolutionSceneContentDigest } from "./evolution-crossover";
import {
  EvolutionComparisonSession,
  type EvolutionComparisonEndpoint,
} from "./evolution-comparison";
import { EvolutionLineage, type LineageNodeInput } from "./evolution-lineage";
import { EvolutionWorkspaceSelection } from "./evolution-workspace";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { initialState } from "./state";

function exactInput(
  label: string,
  x: number,
  cameraRadius: number,
  sliceCenter: number,
): LineageNodeInput {
  const snapshot = toSnapshot(initialState(true));
  snapshot.transforms[0].position[0] = x;
  snapshot.camera = {
    target: [x, 0, 0],
    radius: cameraRadius,
    theta: x,
    phi: 1,
  };
  snapshot.fourD = {
    pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
    sliceOn: true,
    sliceCenter,
    sliceThickness: 0.25,
    sliceRelColor: false,
  };
  return {
    encodedScene: "same-rounded-wire",
    snapshot,
    thumbnail: new Uint8ClampedArray([1, 2, 3, 255]),
    seed: label.length,
    profile: { algorithm: "test", label },
  };
}

describe("Evolution exact history authority", () => {
  it("restores unrounded scene and saved 4D view through undo and redo", async () => {
    const rootInput = exactInput("root", 0.123456789, 7.123456789, 0.111111111);
    const childInput = exactInput(
      "child",
      0.12345679,
      9.987654321,
      -0.222222222,
    );
    const lineage = new EvolutionLineage(rootInput);
    const child = lineage.addMutation(lineage.rootId!, childInput);
    if (!child.added) throw new Error("test graph refused");
    const workspace = new EvolutionWorkspaceSelection(lineage);
    let live = structuredClone(rootInput.snapshot);
    const persisted: SceneSnapshot[] = [];

    const session = new EditSession({
      // The collision is deliberate: ordinary history cannot distinguish the
      // two exact documents without the authority token.
      snapshot: () => "same-rounded-wire",
      authority: () => evolutionHistoryAuthority(lineage, workspace, live),
      persist: () => persisted.push(structuredClone(live)),
      restore: (_wire, _replaced, pose, authority) => {
        const exact = evolutionSnapshotForHistoryAuthority(
          lineage,
          [],
          authority,
        );
        if (!exact) throw new Error("expected retained exact authority");
        live = structuredClone(exact) as SceneSnapshot;
        if (pose) {
          live.camera = structuredClone(pose.camera);
          live.fourD = pose.fourD && structuredClone(pose.fourD);
        }
        workspace.reconcile(evolutionSceneContentDigest(live));
      },
      pose: () => ({ camera: live.camera!, fourD: live.fourD }),
      syncUi: () => {},
      schedule: () => () => {},
    });

    session.beginEdit("replace");
    await workspace.select(child.node.id, async (node) => {
      live = structuredClone(node.snapshot) as SceneSnapshot;
      return true;
    });
    session.undo();
    expect(evolutionSceneContentDigest(live)).toBe(
      lineage.node(lineage.rootId!)!.contentDigest,
    );
    expect(live.transforms[0].position[0]).toBe(0.123456789);
    expect(live.camera?.radius).toBe(7.123456789);
    expect(live.fourD?.sliceCenter).toBe(0.111111111);

    session.redo();
    expect(evolutionSceneContentDigest(live)).toBe(child.node.contentDigest);
    expect(live.transforms[0].position[0]).toBe(0.12345679);
    expect(live.camera?.radius).toBe(9.987654321);
    expect(live.fourD?.sliceCenter).toBe(-0.222222222);
    expect(persisted).toHaveLength(1);
  });

  it("restores an exact pinned Collection comparison after undo and redo", async () => {
    const rootInput = exactInput("root", 0.123456789, 7, 0.1);
    const externalInput = exactInput("external", 0.12345679, 11, -0.4);
    const lineage = new EvolutionLineage(rootInput);
    const workspace = new EvolutionWorkspaceSelection(lineage);
    const comparison = new EvolutionComparisonSession(lineage);
    comparison.pinExternal("A", {
      authorityId: "collection-exact",
      label: "Collection keeper",
      encodedScene: "same-rounded-wire",
      snapshot: externalInput.snapshot,
      contentDigest: evolutionSceneContentDigest(externalInput.snapshot),
    });
    let live = structuredClone(rootInput.snapshot);
    const availableEndpoints = (): EvolutionComparisonEndpoint[] => {
      const pin = comparison.resolve("A");
      return pin.state === "available" ? [pin.endpoint] : [];
    };
    const activeEndpoint = (): EvolutionComparisonEndpoint | null => {
      const active = comparison.active();
      return active?.pin.state === "available" ? active.pin.endpoint : null;
    };

    const session = new EditSession({
      snapshot: () => "same-rounded-wire",
      authority: () =>
        evolutionHistoryAuthority(lineage, workspace, live, activeEndpoint()),
      persist: () => {},
      restore: (_wire, _replaced, pose, authority) => {
        const exact = evolutionSnapshotForHistoryAuthority(
          lineage,
          availableEndpoints(),
          authority,
        );
        if (!exact) throw new Error("expected exact comparison authority");
        live = structuredClone(exact) as SceneSnapshot;
        if (pose) {
          live.camera = structuredClone(pose.camera);
          live.fourD = pose.fourD && structuredClone(pose.fourD);
        }
        if (comparison.active()) comparison.invalidateDisplay();
        workspace.reconcile(evolutionSceneContentDigest(live));
      },
      pose: () => ({ camera: live.camera!, fourD: live.fourD }),
      syncUi: () => {},
      schedule: () => () => {},
    });

    session.beginEdit("replace");
    await comparison.show("A", async (endpoint) => {
      if (endpoint.kind !== "external") throw new Error("expected external");
      live = structuredClone(endpoint.snapshot) as SceneSnapshot;
      return true;
    });
    session.undo();
    expect(live.transforms[0].position[0]).toBe(0.123456789);
    session.redo();
    expect(live.transforms[0].position[0]).toBe(0.12345679);
    expect(live.camera?.radius).toBe(11);
    expect(live.fourD?.sliceCenter).toBe(-0.4);
  });

  it("does not resolve a pruned or reset authority token", () => {
    const rootInput = exactInput("root", 0.1, 7, 0.1);
    const lineage = new EvolutionLineage(rootInput);
    const child = lineage.addMutation(
      lineage.rootId!,
      exactInput("child", 0.2, 8, 0.2),
    );
    if (!child.added) throw new Error("test graph refused");
    const workspace = new EvolutionWorkspaceSelection(lineage);
    lineage.visit(child.node.id);
    const token = evolutionHistoryAuthority(
      lineage,
      workspace,
      child.node.snapshot,
    );
    expect(token).toBeDefined();

    lineage.reset(exactInput("replacement", 0.3, 9, 0.3));
    expect(evolutionSnapshotForHistoryAuthority(lineage, [], token)).toBeNull();
  });

  it("keeps exact scene authority when only the out-of-band live view moved", () => {
    const rootInput = exactInput("root", 0.1, 7, 0.1);
    const lineage = new EvolutionLineage(rootInput);
    const workspace = new EvolutionWorkspaceSelection(lineage);
    const movedView = structuredClone(rootInput.snapshot);
    movedView.camera!.radius = 99;
    movedView.fourD!.sliceCenter = 0.75;

    expect(
      evolutionHistoryAuthority(lineage, workspace, movedView),
    ).toBeDefined();
    movedView.transforms[0].position[0] += 0.000000001;
    expect(
      evolutionHistoryAuthority(lineage, workspace, movedView),
    ).toBeUndefined();
  });
});
