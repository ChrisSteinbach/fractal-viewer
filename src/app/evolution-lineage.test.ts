import {
  EvolutionLineage,
  type LineageCrossoverParentInput,
  type LineageNodeInput,
  type ReleasedLineageNode,
} from "./evolution-lineage";
import { evolutionSceneContentDigest } from "./evolution-crossover";
import { initialState } from "./state";
import { toSnapshot } from "./persist";

function input(
  label: string,
  overrides: Partial<LineageNodeInput> = {},
): LineageNodeInput {
  return {
    encodedScene: `v1=${label}`,
    snapshot: toSnapshot(initialState(true)),
    thumbnail: new Uint8ClampedArray([1, 2, 3, 255]),
    seed: label.length,
    profile: { algorithm: "mutation-v1", label },
    ...overrides,
  };
}

function added(result: ReturnType<EvolutionLineage["addMutation"]>) {
  expect(result.added).toBe(true);
  if (!result.added) throw new Error("expected a node to be added");
  return result.node;
}

const external = (hex: string): LineageCrossoverParentInput => ({
  kind: "external",
  contentDigest: `scene-sha256-${hex.repeat(64)}`,
});

const retained = (nodeId: string): LineageCrossoverParentInput => ({
  kind: "lineage",
  nodeId,
});

describe("EvolutionLineage ownership and ordering", () => {
  it("mints deterministic monotonic ids and retains ordered ancestors and siblings", () => {
    const lineage = new EvolutionLineage(input("root"));
    const rootId = lineage.rootId!;
    const first = added(lineage.addMutation(rootId, input("first")));
    const second = added(lineage.addMutation(rootId, input("second")));
    const grandchild = added(
      lineage.addMutation(first.id, input("grandchild")),
    );

    expect(rootId).toBe("lineage-0");
    expect([first.id, second.id, grandchild.id]).toEqual([
      "lineage-1",
      "lineage-2",
      "lineage-3",
    ]);
    expect(lineage.node(rootId)?.childIds).toEqual([first.id, second.id]);
    expect(lineage.node(first.id)?.parentIds).toEqual([rootId]);
    expect(lineage.node(first.id)?.geneticParents).toEqual([
      {
        kind: "lineage",
        nodeId: rootId,
        contentDigest: lineage.node(rootId)?.contentDigest,
      },
    ]);
    expect(lineage.node(first.id)?.childIds).toEqual([grandchild.id]);
    expect(lineage.node(second.id)?.childIds).toEqual([]);
    expect(lineage.all().map((node) => node.id)).toEqual([
      rootId,
      first.id,
      second.id,
      grandchild.id,
    ]);
  });

  it("owns thumbnail, profile, and resource inputs and returns defensive snapshots", () => {
    const thumbnail = new Uint8ClampedArray([9, 8, 7, 6]);
    const nested = { locks: ["geometry"] };
    const profile = { algorithm: "mutation-v2", nested };
    const resourceIds = ["mesh-a", "mesh-a", "mesh-b"];
    const snapshot = toSnapshot(initialState(true));
    snapshot.transforms[0].position[0] = 0.123456789;
    const lineage = new EvolutionLineage(
      input("root", { snapshot, thumbnail, profile, resourceIds }),
    );
    const rootId = lineage.rootId!;

    thumbnail[0] = 0;
    nested.locks.push("appearance");
    resourceIds.push("mesh-c");
    snapshot.transforms[0].position[0] = 9;
    const firstRead = lineage.node(rootId)!;
    firstRead.thumbnail[1] = 0;

    const secondRead = lineage.node(rootId)!;
    expect(Array.from(secondRead.thumbnail)).toEqual([9, 8, 7, 6]);
    expect(secondRead.profile).toEqual({
      algorithm: "mutation-v2",
      nested: { locks: ["geometry"] },
    });
    expect(secondRead.resourceIds).toEqual(["mesh-a", "mesh-b"]);
    expect(secondRead.snapshot.transforms[0].position[0]).toBe(0.123456789);
    expect(Object.isFrozen(secondRead.snapshot)).toBe(true);
    expect(Object.isFrozen(secondRead.snapshot.transforms)).toBe(true);
    expect(Object.isFrozen(secondRead.snapshot.transforms[0].position)).toBe(
      true,
    );
    expect(Object.isFrozen(secondRead.profile)).toBe(true);
    expect(
      Object.isFrozen(
        (secondRead.profile.nested as { locks: readonly string[] }).locks,
      ),
    ).toBe(true);
    expect(Object.isFrozen(secondRead.parentIds)).toBe(true);
    expect(Object.isFrozen(secondRead.geneticParents)).toBe(true);
    expect(Object.isFrozen(secondRead.childIds)).toBe(true);
    expect(secondRead.contentDigest).toBe(
      evolutionSceneContentDigest(secondRead.snapshot),
    );
  });

  it("verifies supplied content digests without trusting valid-looking lies", () => {
    const snapshot = toSnapshot(initialState(true));
    const exact = evolutionSceneContentDigest(snapshot);
    expect(
      new EvolutionLineage(
        input("exact", { snapshot, contentDigest: exact }),
      ).current()?.contentDigest,
    ).toBe(exact);

    expect(
      () =>
        new EvolutionLineage(
          input("malformed", {
            snapshot,
            contentDigest: "scene-sha256-nope",
          }),
        ),
    ).toThrow("lowercase SHA-256 scene digest");
    expect(
      () =>
        new EvolutionLineage(
          input("mismatch", {
            snapshot,
            contentDigest: `scene-sha256-${"f".repeat(64)}`,
          }),
        ),
    ).toThrow("does not match its snapshot");
  });

  it("rejects non-JSON or cyclic profiles without changing the graph", () => {
    const lineage = new EvolutionLineage(input("root"));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() =>
      lineage.addMutation(
        lineage.rootId!,
        input("bad", {
          profile: cyclic as LineageNodeInput["profile"],
        }),
      ),
    ).toThrow("cannot contain cycles");
    expect(lineage.size).toBe(1);
    expect(lineage.node(lineage.rootId!)?.childIds).toEqual([]);
  });
});

describe("EvolutionLineage navigation", () => {
  it("supports visit, back, redo-forward, and remembered branch-forward", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const left = added(lineage.addMutation(root, input("left")));
    const right = added(lineage.addMutation(root, input("right")));

    expect(lineage.visitBranch(left.id)).toBe(true);
    expect(lineage.currentId).toBe(left.id);
    expect(lineage.preferredChildId(root)).toBe(left.id);
    expect(lineage.back()?.id).toBe(root);
    expect(lineage.forward()?.id).toBe(left.id);

    expect(lineage.back()?.id).toBe(root);
    expect(lineage.visitBranch(right.id)).toBe(true);
    expect(lineage.preferredChildId(root)).toBe(right.id);
    expect(lineage.back()?.id).toBe(root);
    expect(lineage.forward()?.id).toBe(right.id);

    // A fresh direct visit clears redo, but the remembered child still gives
    // forward() a deterministic branch from the root.
    expect(lineage.visit(root)).toBe(true);
    expect(lineage.forward()?.id).toBe(right.id);
  });

  it("refuses stale visits and non-child branch choices without moving", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const child = added(lineage.addMutation(root, input("child")));
    const grandchild = added(
      lineage.addMutation(child.id, input("grandchild")),
    );

    expect(lineage.visit("missing")).toBe(false);
    expect(lineage.visitBranch(grandchild.id)).toBe(false);
    expect(lineage.currentId).toBe(root);
    expect(lineage.back()).toBeNull();
  });
});

describe("EvolutionLineage DAG pruning", () => {
  it("stores ordered genetic provenance separately from navigation edges", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const a = added(lineage.addMutation(root, input("a")));
    const b = added(lineage.addMutation(root, input("b")));
    const result = lineage.addCrossover(
      [retained(a.id), retained(b.id)],
      input("cross"),
    );
    expect(result.added).toBe(true);
    if (!result.added) return;

    expect(result.node.kind).toBe("crossover");
    expect(result.node.parentIds).toEqual([a.id, b.id]);
    expect(result.node.geneticParents).toEqual([
      { kind: "lineage", nodeId: a.id, contentDigest: a.contentDigest },
      { kind: "lineage", nodeId: b.id, contentDigest: b.contentDigest },
    ]);
    expect(Object.isFrozen(result.node.geneticParents)).toBe(true);
    expect(Object.isFrozen(result.node.geneticParents[0])).toBe(true);
    expect(lineage.node(a.id)?.childIds).toEqual([result.node.id]);
    expect(lineage.node(b.id)?.childIds).toEqual([result.node.id]);
    expect(() =>
      lineage.addCrossover([retained(a.id), retained(a.id)], input("bad")),
    ).toThrow("two distinct retained lineage parents");
  });

  it("keeps mixed external provenance out of graph reachability in either order", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const parent = added(lineage.addMutation(root, input("parent")));
    const first = lineage.addCrossover(
      [retained(parent.id), external("a")],
      input("lineage-primary"),
    );
    const second = lineage.addCrossover(
      [external("b"), retained(parent.id)],
      input("collection-primary"),
    );
    if (!first.added || !second.added) throw new Error("expected crossover");

    expect(first.node.parentIds).toEqual([parent.id]);
    expect(first.node.geneticParents).toEqual([
      {
        kind: "lineage",
        nodeId: parent.id,
        contentDigest: parent.contentDigest,
      },
      external("a"),
    ]);
    expect(second.node.parentIds).toEqual([parent.id]);
    expect(second.node.geneticParents).toEqual([
      external("b"),
      {
        kind: "lineage",
        nodeId: parent.id,
        contentDigest: parent.contentDigest,
      },
    ]);
    expect(lineage.size).toBe(4);
    expect(lineage.node(parent.id)?.childIds).toEqual([
      first.node.id,
      second.node.id,
    ]);
  });

  it("requires the current retained node as the non-genetic all-external anchor", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const other = added(lineage.addMutation(root, input("other")));

    expect(() =>
      lineage.addCrossover([external("a"), external("b")], input("missing")),
    ).toThrow("require a current-node navigation anchor");
    expect(() =>
      lineage.addCrossover(
        [external("a"), external("b")],
        input("not-current"),
        { navigationAnchorId: other.id },
      ),
    ).toThrow("must be the current retained node");
    expect(() =>
      lineage.addCrossover(
        [retained(other.id), external("a")],
        input("illegal-anchor"),
        { navigationAnchorId: root },
      ),
    ).toThrow("allowed only for two external parents");

    const result = lineage.addCrossover(
      [external("a"), external("b")],
      input("anchored", { resourceIds: ["child-only"] }),
      { navigationAnchorId: root },
    );
    if (!result.added) throw new Error("expected crossover");
    expect(result.node.parentIds).toEqual([root]);
    expect(result.node.geneticParents).toEqual([external("a"), external("b")]);
    expect(result.node.geneticParents).not.toContainEqual({
      kind: "lineage",
      nodeId: root,
      contentDigest: lineage.node(root)?.contentDigest,
    });
    expect(lineage.resourceReferenceCount).toBe(1);
    expect(lineage.size).toBe(3);
  });

  it("validates external digest shape before changing edges or consuming capacity", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    expect(() =>
      lineage.addCrossover(
        [
          retained(root),
          {
            kind: "external",
            contentDigest: "scene-sha256-UPPER",
          },
        ],
        input("bad"),
      ),
    ).toThrow("External parent digest");
    expect(lineage.size).toBe(1);
    expect(lineage.node(root)?.childIds).toEqual([]);
  });

  it("prunes an ordinary subtree, preserves its sibling, and releases owned resources", () => {
    const released: ReleasedLineageNode[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      onRelease: (node) => released.push(node),
    });
    const root = lineage.rootId!;
    const doomed = added(
      lineage.addMutation(root, input("doomed", { resourceIds: ["mesh-a"] })),
    );
    const keeper = added(lineage.addMutation(root, input("keeper")));
    const descendant = added(
      lineage.addMutation(
        doomed.id,
        input("descendant", { resourceIds: ["mesh-b"] }),
      ),
    );
    expect(lineage.visit(descendant.id)).toBe(true);

    const result = lineage.prune(doomed.id);
    expect(result).toEqual({
      pruned: true,
      removedIds: [doomed.id, descendant.id],
    });
    expect(lineage.currentId).toBe(root);
    expect(lineage.node(root)?.childIds).toEqual([keeper.id]);
    expect(lineage.node(keeper.id)).not.toBeNull();
    expect(lineage.node(doomed.id)).toBeNull();
    expect(released.map((node) => node.id)).toEqual([doomed.id, descendant.id]);
    expect(released.map((node) => node.resourceIds)).toEqual([
      ["mesh-a"],
      ["mesh-b"],
    ]);
    expect(released.map((node) => node.thumbnailBytes)).toEqual([4, 4]);
  });

  it("uses root reachability so pruning one parent never drops a shared child or descendant", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      onRelease: (node) => released.push(node.id),
    });
    const root = lineage.rootId!;
    const a = added(lineage.addMutation(root, input("a")));
    const b = added(lineage.addMutation(root, input("b")));
    const crossedResult = lineage.addCrossover(
      [retained(a.id), retained(b.id)],
      input("cross"),
    );
    if (!crossedResult.added) throw new Error("expected crossover");
    const crossed = crossedResult.node;
    const descendant = added(
      lineage.addMutation(crossed.id, input("descendant")),
    );

    expect(lineage.prune(crossed.id)).toEqual({
      pruned: false,
      reason: "ambiguous-parent",
    });
    expect(lineage.prune(crossed.id, a.id)).toEqual({
      pruned: true,
      removedIds: [],
    });
    expect(lineage.node(crossed.id)?.parentIds).toEqual([b.id]);
    expect(lineage.node(crossed.id)?.geneticParents).toEqual([
      { kind: "lineage", nodeId: a.id, contentDigest: a.contentDigest },
      { kind: "lineage", nodeId: b.id, contentDigest: b.contentDigest },
    ]);
    expect(lineage.node(a.id)?.childIds).toEqual([]);
    expect(lineage.node(b.id)?.childIds).toEqual([crossed.id]);
    expect(lineage.node(descendant.id)).not.toBeNull();
    expect(released).toEqual([]);

    expect(lineage.prune(crossed.id, b.id)).toEqual({
      pruned: true,
      removedIds: [crossed.id, descendant.id],
    });
    expect(released).toEqual([crossed.id, descendant.id]);
    expect(lineage.all().flatMap((node) => node.parentIds)).not.toContain(
      crossed.id,
    );
    expect(lineage.all().flatMap((node) => node.childIds)).not.toContain(
      crossed.id,
    );
  });

  it("sweeps mixed and all-external children through navigation only and releases once", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      onRelease: (node) => released.push(node.id),
    });
    const root = lineage.rootId!;
    const retainedParent = added(
      lineage.addMutation(root, input("retained-parent")),
    );
    const mixed = lineage.addCrossover(
      [external("a"), retained(retainedParent.id)],
      input("mixed"),
    );
    if (!mixed.added) throw new Error("expected mixed crossover");
    expect(lineage.prune(mixed.node.id, retainedParent.id)).toEqual({
      pruned: true,
      removedIds: [mixed.node.id],
    });

    const externalOnly = lineage.addCrossover(
      [external("b"), external("c")],
      input("external-only"),
      { navigationAnchorId: root },
    );
    if (!externalOnly.added) throw new Error("expected external crossover");
    const descendant = added(
      lineage.addMutation(externalOnly.node.id, input("descendant")),
    );
    expect(lineage.prune(externalOnly.node.id, root)).toEqual({
      pruned: true,
      removedIds: [externalOnly.node.id, descendant.id],
    });
    expect(released).toEqual([
      mixed.node.id,
      externalOnly.node.id,
      descendant.id,
    ]);
  });

  it("sweeps an anchored external lineage when its workspace anchor is pruned upstream", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const anchor = added(lineage.addMutation(root, input("anchor")));
    lineage.visit(anchor.id);
    const crossed = lineage.addCrossover(
      [external("a"), external("b")],
      input("crossed"),
      { navigationAnchorId: anchor.id },
    );
    if (!crossed.added) throw new Error("expected crossover");

    expect(lineage.prune(anchor.id, root)).toEqual({
      pruned: true,
      removedIds: [anchor.id, crossed.node.id],
    });
    expect(lineage.currentId).toBe(root);
  });

  it("protects the root and refuses an unrelated parent", () => {
    const lineage = new EvolutionLineage(input("root"));
    const root = lineage.rootId!;
    const a = added(lineage.addMutation(root, input("a")));
    const b = added(lineage.addMutation(root, input("b")));

    expect(lineage.prune(root)).toEqual({
      pruned: false,
      reason: "root-protected",
    });
    expect(lineage.prune(a.id, b.id)).toEqual({
      pruned: false,
      reason: "not-a-parent",
    });
    expect(lineage.size).toBe(3);
  });
});

describe("EvolutionLineage caps and lifetime", () => {
  it("refuses an anchored external crossover at caps without installing an edge or releasing authority", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      nodeCap: 1,
      onRelease: (node) => released.push(node.id),
    });
    const root = lineage.rootId!;

    expect(
      lineage.addCrossover(
        [external("a"), external("b")],
        input("refused", { resourceIds: ["external-child-resource"] }),
        { navigationAnchorId: root },
      ),
    ).toEqual({
      added: false,
      reason: "node-cap",
      limit: 1,
      requested: 2,
    });
    expect(lineage.size).toBe(1);
    expect(lineage.resourceReferenceCount).toBe(0);
    expect(lineage.node(root)?.childIds).toEqual([]);
    expect(released).toEqual([]);
  });

  it("refuses at the node cap without eviction, then admits after prune", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      nodeCap: 2,
      onRelease: (node) => released.push(node.id),
    });
    const root = lineage.rootId!;
    const first = added(lineage.addMutation(root, input("first")));

    expect(lineage.addMutation(root, input("refused"))).toEqual({
      added: false,
      reason: "node-cap",
      limit: 2,
      requested: 3,
    });
    expect(lineage.size).toBe(2);
    expect(lineage.node(first.id)).not.toBeNull();
    expect(released).toEqual([]);

    expect(lineage.prune(first.id).pruned).toBe(true);
    const replacement = added(lineage.addMutation(root, input("replacement")));
    // Refusal consumes no id; successful removals never recycle stale ids.
    expect(replacement.id).toBe("lineage-2");
  });

  it("enforces aggregate thumbnail bytes and returns capacity after prune", () => {
    const lineage = new EvolutionLineage(
      input("root", { thumbnail: new Uint8ClampedArray(3) }),
      { thumbnailByteCap: 7 },
    );
    const root = lineage.rootId!;
    const first = added(
      lineage.addMutation(
        root,
        input("first", { thumbnail: new Uint8ClampedArray(4) }),
      ),
    );
    expect(lineage.thumbnailBytes).toBe(7);
    expect(
      lineage.addMutation(
        root,
        input("too-big", { thumbnail: new Uint8ClampedArray(1) }),
      ),
    ).toEqual({
      added: false,
      reason: "thumbnail-byte-cap",
      limit: 7,
      requested: 8,
    });

    lineage.prune(first.id);
    expect(lineage.thumbnailBytes).toBe(3);
    expect(
      lineage.addMutation(
        root,
        input("now-fits", { thumbnail: new Uint8ClampedArray(4) }),
      ).added,
    ).toBe(true);
  });

  it("bounds de-duplicated external resource references", () => {
    const lineage = new EvolutionLineage(
      input("root", { resourceIds: ["a", "a"] }),
      { resourceReferenceCap: 2 },
    );
    const root = lineage.rootId!;
    const first = added(
      lineage.addMutation(root, input("first", { resourceIds: ["b"] })),
    );
    expect(lineage.resourceReferenceCount).toBe(2);
    expect(
      lineage.addMutation(root, input("refused", { resourceIds: ["c"] })),
    ).toEqual({
      added: false,
      reason: "resource-reference-cap",
      limit: 2,
      requested: 3,
    });

    lineage.prune(first.id);
    expect(lineage.resourceReferenceCount).toBe(1);
    expect(
      lineage.addMutation(root, input("accepted", { resourceIds: ["c"] }))
        .added,
    ).toBe(true);
  });

  it("reset releases the old graph, clears navigation, and installs an owned new root", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      onRelease: (node) => released.push(node.id),
    });
    const oldRoot = lineage.rootId!;
    const child = added(lineage.addMutation(oldRoot, input("child")));
    lineage.visit(child.id);

    const replacementThumb = new Uint8ClampedArray([7, 7]);
    const replacement = lineage.reset(
      input("new-root", { thumbnail: replacementThumb }),
    );
    replacementThumb[0] = 0;

    expect(replacement.id).toBe("lineage-2");
    expect(lineage.rootId).toBe(replacement.id);
    expect(lineage.currentId).toBe(replacement.id);
    expect(lineage.size).toBe(1);
    expect(lineage.thumbnailBytes).toBe(2);
    expect(Array.from(lineage.current()!.thumbnail)).toEqual([7, 7]);
    expect(lineage.back()).toBeNull();
    expect(lineage.forward()).toBeNull();
    expect(released).toEqual([oldRoot, child.id]);
  });

  it("validates a replacement root before releasing the live graph", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      thumbnailByteCap: 4,
      onRelease: (node) => released.push(node.id),
    });
    const oldRoot = lineage.rootId!;

    expect(() =>
      lineage.reset(
        input("too-large", { thumbnail: new Uint8ClampedArray(5) }),
      ),
    ).toThrow("root exceeds the thumbnail byte cap");
    expect(lineage.rootId).toBe(oldRoot);
    expect(lineage.size).toBe(1);
    expect(released).toEqual([]);
  });

  it("dispose makes session lifetime explicit and releases exactly once", () => {
    const released: string[] = [];
    const lineage = new EvolutionLineage(input("root"), {
      onRelease: (node) => released.push(node.id),
    });
    const child = added(lineage.addMutation(lineage.rootId!, input("child")));

    lineage.dispose();
    lineage.dispose();
    expect(lineage.isDisposed).toBe(true);
    expect(lineage.rootId).toBeNull();
    expect(lineage.currentId).toBeNull();
    expect(lineage.size).toBe(0);
    expect(lineage.thumbnailBytes).toBe(0);
    expect(released).toEqual(["lineage-0", child.id]);
    expect(() => lineage.reset(input("new"))).toThrow("session is disposed");

    // A new instance is an independent session; nothing reloads the disposed
    // graph, and its deterministic id sequence begins from its own root.
    const nextSession = new EvolutionLineage(input("fresh"));
    expect(nextSession.rootId).toBe("lineage-0");
    expect(nextSession.size).toBe(1);
  });
});
