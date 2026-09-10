import {
  MAX_TREE_CANDIDATES,
  candidateShas,
  fullSweepVerdict,
  latestCheckByName,
  parseCheckRuns,
  treeSweptVerdict,
} from "./gpu-ci-swept.mjs";

type Run = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
};

const check = (
  id: number,
  name: string,
  status: string,
  conclusion: string | null,
): Run => ({ id, name, status, conclusion });
const green = (id: number, name: string) =>
  check(id, name, "completed", "success");

describe("full-sweep reuse predicate", () => {
  it("reuses a commit whose aggregate and backend smoke are both green", () => {
    const verdict = fullSweepVerdict([
      green(10, "gpu-agreement"),
      green(11, "backend-smoke"),
    ]);
    expect(verdict.swept).toBe(true);
    expect(verdict.reason).toMatch(/full sweep/i);
  });

  it("refuses a green aggregate whose backend smoke was skipped by selection", () => {
    const verdict = fullSweepVerdict([
      green(10, "gpu-agreement"),
      check(11, "backend-smoke", "completed", "skipped"),
    ]);
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/backend-smoke/);
  });

  it("refuses a green aggregate with no backend smoke check at all", () => {
    const verdict = fullSweepVerdict([green(10, "gpu-agreement")]);
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/backend-smoke/);
  });

  it("refuses a commit carrying no gpu-agreement check", () => {
    const verdict = fullSweepVerdict([green(3, "lint"), green(4, "build")]);
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/no gpu-agreement/);
  });

  it.each([
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["completed", "timed_out"],
    ["in_progress", null],
    ["queued", null],
  ])("refuses a gpu-agreement that is %s/%s", (status, conclusion) => {
    const verdict = fullSweepVerdict([
      check(10, "gpu-agreement", status, conclusion),
      green(11, "backend-smoke"),
    ]);
    expect(verdict.swept).toBe(false);
  });

  it("accepts the reusable call's prefixed job names as evidence", () => {
    const verdict = fullSweepVerdict([
      green(20, "gpu-full / gpu-agreement"),
      green(21, "gpu-full / backend-smoke"),
    ]);
    expect(verdict.swept).toBe(true);
  });

  it("refuses when the newest aggregate is red behind an older green pair", () => {
    const verdict = fullSweepVerdict([
      green(10, "gpu-agreement"),
      green(11, "backend-smoke"),
      check(30, "gpu-agreement", "completed", "failure"),
    ]);
    expect(verdict.swept).toBe(false);
  });

  it("reuses when the newest pair is green behind an older red one", () => {
    const verdict = fullSweepVerdict([
      check(10, "gpu-agreement", "completed", "failure"),
      check(11, "backend-smoke", "completed", "failure"),
      green(30, "gpu-agreement"),
      green(31, "backend-smoke"),
    ]);
    expect(verdict.swept).toBe(true);
  });

  it("does not read a shard's own check as the stable aggregate", () => {
    const verdict = fullSweepVerdict([
      green(10, "gpu-agreement (shard 3)"),
      green(11, "backend-smoke"),
    ]);
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/no gpu-agreement/);
  });

  it("treats an empty or missing run list as unswept", () => {
    expect(fullSweepVerdict([]).swept).toBe(false);
    expect(fullSweepVerdict(undefined).swept).toBe(false);
  });
});

describe("latest check selection", () => {
  it("returns the greatest id among exact and prefixed matches", () => {
    const runs = [
      green(5, "backend-smoke"),
      green(9, "gpu-full / backend-smoke"),
      green(7, "backend-smoke"),
    ];
    expect(latestCheckByName(runs, "backend-smoke").id).toBe(9);
  });

  it("returns undefined when nothing carries the name", () => {
    expect(latestCheckByName([green(5, "lint")], "backend-smoke")).toBe(
      undefined,
    );
  });

  it("does not match a name that merely contains the target", () => {
    const runs = [
      green(5, "gpu-agreement (shard 1)"),
      green(6, "pre-gpu-agreement"),
    ];
    expect(latestCheckByName(runs, "gpu-agreement")).toBe(undefined);
  });

  // The fetch emits one JSON object per line across every page rather than a
  // single document, so that `gh api --paginate` needs no `--slurp` (gh 2.51+)
  // and the concatenation of pages stays parseable on any gh.
  it("parses the paginated one-object-per-line stream", () => {
    const stdout =
      '{"id":1,"name":"gpu-agreement","status":"completed","conclusion":"success"}\n' +
      '{"id":2,"name":"backend-smoke","status":"completed","conclusion":"success"}\n';
    expect(fullSweepVerdict(parseCheckRuns(stdout)).swept).toBe(true);
  });

  it("tolerates blank lines and a stream with no runs at all", () => {
    expect(parseCheckRuns("\n\n")).toEqual([]);
    expect(fullSweepVerdict(parseCheckRuns("")).swept).toBe(false);
  });
});

// The rebase-merge case these two describe, measured on the 2026-09-10
// staging-ceiling merge: every commit kept a byte-identical tree across
// `gh pr merge --rebase`, only parent and committer date moved.
const HEAD = "d721cc766028735ab7cd28f85646327d755b5ba3";
const TIP = "616e4f3000000000000000000000000000000000";
const SHARED_TREE = "3c191a94f50e5504296bdcdeeaf651d21f7a72c0";
const OTHER_TREE = "ebb08c3a25780737c9c141b5e3d35dbaf301ae57";

describe("tree-identity candidate selection", () => {
  it("puts the target commit itself first, so the exact-SHA question is free", () => {
    expect(
      candidateShas({
        sha: TIP,
        pulls: [{ number: 391, head: { sha: HEAD } }],
      }),
    ).toEqual([TIP, HEAD]);
  });

  it("adds the push event's before commit after the pull heads", () => {
    const before = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(
      candidateShas({
        sha: TIP,
        pulls: [{ number: 391, head: { sha: HEAD } }],
        pushBefore: before,
      }),
    ).toEqual([TIP, HEAD, before]);
  });

  it("deduplicates a pull head that is the target commit", () => {
    expect(
      candidateShas({
        sha: HEAD,
        pulls: [{ number: 391, head: { sha: HEAD } }],
      }),
    ).toEqual([HEAD]);
  });

  it("drops the all-zero null sha a first push reports as before", () => {
    expect(candidateShas({ sha: TIP, pushBefore: "0".repeat(40) })).toEqual([
      TIP,
    ]);
  });

  it("drops anything that is not a hex sha", () => {
    expect(
      candidateShas({
        sha: TIP,
        pulls: [
          { head: { sha: "../../etc/passwd" } },
          { head: { sha: "" } },
          {},
        ],
      }),
    ).toEqual([TIP]);
  });

  it("bounds the walk so a pathological association list cannot slow the job", () => {
    const pulls = Array.from({ length: 40 }, (_unused, index) => ({
      head: { sha: String(index).padStart(40, "b") },
    }));
    const shas = candidateShas({ sha: TIP, pulls });
    expect(shas).toHaveLength(MAX_TREE_CANDIDATES);
    expect(shas[0]).toBe(TIP);
    expect(candidateShas({ sha: TIP, pulls, limit: 2 })).toHaveLength(2);
  });

  it("handles a commit with no associations at all", () => {
    expect(candidateShas({ sha: TIP })).toEqual([TIP]);
    expect(candidateShas()).toEqual([]);
  });
});

describe("tree-identity sweep reuse", () => {
  // The whole point: main's rebased tip carries a green aggregate whose smoke
  // was SKIPPED (its own push run reused the twin), and the PR head that
  // shares its tree carries the real full sweep.
  const rebaseMerge = {
    tree: (sha: string) =>
      sha === TIP || sha === HEAD ? SHARED_TREE : OTHER_TREE,
    checkRuns: (sha: string) =>
      sha === HEAD
        ? [green(10, "gpu-agreement"), green(11, "backend-smoke")]
        : [
            green(20, "gpu-agreement"),
            check(21, "backend-smoke", "completed", "skipped"),
          ],
  };

  it("reuses a twin commit whose tree matches, naming which commit supplied it", () => {
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, HEAD],
      ...rebaseMerge,
    });
    expect(verdict.swept).toBe(true);
    expect(verdict.sha).toBe(HEAD);
    expect(verdict.reason).toContain(HEAD);
  });

  it("still answers the exact-SHA question from the target itself", () => {
    const verdict = treeSweptVerdict({
      sha: HEAD,
      candidates: [HEAD],
      ...rebaseMerge,
    });
    expect(verdict.swept).toBe(true);
    expect(verdict.sha).toBe(HEAD);
    expect(verdict.reason).toMatch(/this commit/);
  });

  // A rebase onto a MOVED main replays the patches onto a different base, so
  // the tree is content no run has ever seen. The association API still
  // PROPOSES the green PR head; tree equality DECIDES against it.
  it("refuses a green twin whose tree differs", () => {
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, HEAD],
      // The tip's patches replayed onto a moved base, so its tree is new.
      tree: (sha: string) => (sha === HEAD ? SHARED_TREE : OTHER_TREE),
      checkRuns: (sha: string) =>
        sha === HEAD
          ? [green(10, "gpu-agreement"), green(11, "backend-smoke")]
          : [],
    });
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toContain("differs");
  });

  it("refuses a matching tree whose backend smoke was skipped", () => {
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, HEAD],
      tree: () => SHARED_TREE,
      checkRuns: () => [
        green(10, "gpu-agreement"),
        check(11, "backend-smoke", "completed", "skipped"),
      ],
    });
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/backend-smoke/);
  });

  it("refuses when there are no candidates at all", () => {
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [],
      tree: () => SHARED_TREE,
      checkRuns: () => [],
    });
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/no candidate commits/);
  });

  it("refuses when the target's own tree cannot be read", () => {
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP],
      tree: () => {
        throw new Error("gh: HTTP 404\nUsage: gh api ...");
      },
      checkRuns: () => [green(10, "gpu-agreement"), green(11, "backend-smoke")],
    });
    expect(verdict.swept).toBe(false);
    // First line only: a failed gh api prints its whole usage banner.
    expect(verdict.reason).not.toContain("Usage:");
  });

  it("skips a candidate whose own tree or checks are unreadable and keeps walking", () => {
    const broken = "cccccccccccccccccccccccccccccccccccccccc";
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, broken, HEAD],
      tree: (sha: string) => {
        if (sha === broken) throw new Error("gh: HTTP 404");
        return SHARED_TREE;
      },
      checkRuns: (sha: string) => {
        if (sha === TIP) throw new Error("gh: HTTP 502");
        return [green(10, "gpu-agreement"), green(11, "backend-smoke")];
      },
    });
    expect(verdict.swept).toBe(true);
    expect(verdict.sha).toBe(HEAD);
  });

  it("reads each commit's tree once however often it is asked for", () => {
    const asked: string[] = [];
    treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, HEAD],
      tree: (sha: string) => {
        asked.push(sha);
        return sha === TIP ? SHARED_TREE : OTHER_TREE;
      },
      checkRuns: () => [],
    });
    expect(asked).toEqual([TIP, HEAD]);
  });

  it("stops at the first swept candidate rather than examining the rest", () => {
    const later = "dddddddddddddddddddddddddddddddddddddddd";
    const asked: string[] = [];
    const verdict = treeSweptVerdict({
      sha: TIP,
      candidates: [TIP, HEAD, later],
      tree: () => SHARED_TREE,
      checkRuns: (sha: string) => {
        asked.push(sha);
        return sha === TIP
          ? [
              green(10, "gpu-agreement"),
              check(11, "backend-smoke", "completed", "skipped"),
            ]
          : [green(10, "gpu-agreement"), green(11, "backend-smoke")];
      },
    });
    expect(verdict.sha).toBe(HEAD);
    expect(asked).toEqual([TIP, HEAD]);
  });
});
