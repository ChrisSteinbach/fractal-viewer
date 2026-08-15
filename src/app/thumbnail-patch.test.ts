import {
  dropStaleThumbnailPatches,
  PENDING_THUMBNAIL_PATCH_CAP,
  recordThumbnailPatch,
  resolveThumbnailPatches,
} from "./thumbnail-patch";
import type { PendingThumbnailPatch } from "./thumbnail-patch";

/** One correction waiting on the flame session, over document "v1=a". */
function flamePatch(
  over: Partial<PendingThumbnailPatch> = {},
): PendingThumbnailPatch {
  return {
    store: "collection",
    id: "entry-1",
    mode: "flame",
    encoded: "v1=a",
    ...over,
  };
}

describe("recordThumbnailPatch", () => {
  it("appends the new patch to the end of the list", () => {
    const first = flamePatch({ id: "entry-1" });
    const second = flamePatch({ id: "entry-2" });

    const pending = recordThumbnailPatch([first], second);

    expect(pending.map((p) => p.id)).toEqual(["entry-1", "entry-2"]);
  });

  it("does not mutate the list it was given", () => {
    const pending: PendingThumbnailPatch[] = [flamePatch()];

    recordThumbnailPatch(pending, flamePatch({ id: "entry-2" }));

    expect(pending).toHaveLength(1);
  });

  it("drops the oldest once the list is at its cap", () => {
    let pending: PendingThumbnailPatch[] = [];
    for (let i = 0; i <= PENDING_THUMBNAIL_PATCH_CAP; i++) {
      pending = recordThumbnailPatch(pending, flamePatch({ id: `entry-${i}` }));
    }

    expect(pending).toHaveLength(PENDING_THUMBNAIL_PATCH_CAP);
    // entry-0 is the one that fell off the front; the newest survives.
    expect(pending[0].id).toBe("entry-1");
    expect(pending[pending.length - 1].id).toBe(
      `entry-${PENDING_THUMBNAIL_PATCH_CAP}`,
    );
  });
});

describe("dropStaleThumbnailPatches", () => {
  it("keeps the patches tagged with the live render mode", () => {
    const pending = [flamePatch()];

    expect(dropStaleThumbnailPatches(pending, "flame")).toEqual(pending);
  });

  it("drops every patch once the app is back in the points explorer", () => {
    const pending = [flamePatch(), flamePatch({ id: "entry-2" })];

    expect(dropStaleThumbnailPatches(pending, null)).toEqual([]);
  });

  it("drops a patch whose mode is no longer the live one", () => {
    const pending = [
      flamePatch(),
      flamePatch({ id: "entry-2", mode: "solid" }),
    ];

    expect(
      dropStaleThumbnailPatches(pending, "solid").map((p) => p.id),
    ).toEqual(["entry-2"]);
  });
});

describe("resolveThumbnailPatches", () => {
  it("applies a patch whose mode and document are both unchanged", () => {
    const patch = flamePatch();

    const { apply, keep } = resolveThumbnailPatches([patch], {
      frameMode: "flame",
      mode: "flame",
      encoded: "v1=a",
    });

    expect(apply).toEqual([patch]);
    expect(keep).toEqual([]);
  });

  it("drops a patch whose document has moved on — an edit, or a camera move", () => {
    const { apply, keep } = resolveThumbnailPatches([flamePatch()], {
      frameMode: "flame",
      mode: "flame",
      encoded: "v1=edited",
    });

    // Neither applied nor kept: re-capturing now would file a picture of a
    // document the saved entry does not hold.
    expect(apply).toEqual([]);
    expect(keep).toEqual([]);
  });

  it("drops a patch once the app has left the render mode it was tagged with", () => {
    const { apply, keep } = resolveThumbnailPatches([flamePatch()], {
      frameMode: "flame",
      mode: null,
      encoded: "v1=a",
    });

    expect(apply).toEqual([]);
    expect(keep).toEqual([]);
  });

  it("keeps a patch still waiting on a different mode's first frame", () => {
    const solid = flamePatch({ mode: "solid" });

    const { apply, keep } = resolveThumbnailPatches([solid], {
      frameMode: "flame",
      mode: "solid",
      encoded: "v1=a",
    });

    expect(apply).toEqual([]);
    expect(keep).toEqual([solid]);
  });

  it("applies every entry saved during one startup gap, across both stores", () => {
    const saved = flamePatch({ store: "collection", id: "scene-1" });
    const keyframe = flamePatch({ store: "timeline", id: "step-1" });

    const { apply } = resolveThumbnailPatches([saved, keyframe], {
      frameMode: "flame",
      mode: "flame",
      encoded: "v1=a",
    });

    expect(apply).toEqual([saved, keyframe]);
  });

  it("applies only the patches over the live document, dropping the rest", () => {
    const current = flamePatch({ id: "entry-current", encoded: "v1=a" });
    const stale = flamePatch({ id: "entry-stale", encoded: "v1=older" });

    const { apply } = resolveThumbnailPatches([stale, current], {
      frameMode: "flame",
      mode: "flame",
      encoded: "v1=a",
    });

    expect(apply.map((p) => p.id)).toEqual(["entry-current"]);
  });
});
