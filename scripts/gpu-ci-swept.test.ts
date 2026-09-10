import {
  MAX_TREE_CANDIDATES,
  candidateShas,
  fullSweepVerdict,
  latestCheckByName,
  parseCheckRuns,
  treeSweptVerdict,
  waitDecision,
  waitForFullSweep,
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

// The wait exists because tree reuse depends on a human merging AFTER a
// ~33-minute sweep that no rule makes them wait for: the four REQUIRED checks
// go green in ~6 minutes and `gpu-agreement` is not one of them. Observed on
// the first real merge after tree keying landed — the twin's sweep was still
// running, so nothing was reused.
describe("waiting for a twin's in-flight sweep", () => {
  const RUNNING = "in_progress";
  // The run doing the waiting: gpu-agreement.yml's own push run on the target.
  const OWN_RUN = 34524486055;
  const TWIN_RUN = 34503482517;
  const BUDGET = 45 * 60 * 1000;

  const swept = {
    swept: true,
    reason: "gpu-agreement and backend-smoke green",
  };
  const unswept = {
    swept: false,
    reason: "no gpu-agreement check run on this commit",
  };
  const matched = (sha: string, extra: Record<string, unknown> = {}) => ({
    sha,
    treeMatched: true,
    verdict: unswept,
    ...extra,
  });

  it("reuses a twin that is already swept instead of waiting for anything", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(TIP, { runs: [{ id: OWN_RUN, status: RUNNING }] }),
        matched(HEAD, { verdict: swept }),
      ],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("reuse");
    expect(decision.sha).toBe(HEAD);
  });

  // THE SELF-DEADLOCK. candidateShas puts the target commit FIRST, and the
  // gpu-agreement run in flight on the target commit is the run asking the
  // question. Waiting for it waits for itself to the budget and then sweeps.
  it("never waits for an in-flight run on the target commit itself", () => {
    const decision = waitDecision({
      targetSha: TIP,
      // No run id known at all, so only the SHA rule can save this.
      currentRunId: undefined,
      twins: [matched(TIP, { runs: [{ id: OWN_RUN, status: RUNNING }] })],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });

  // ...and the second exclusion, tested where the SHA rule cannot fire: a
  // DIFFERENT commit whose in-flight run is this one. Cheap insurance if the
  // candidate ordering ever changes.
  it("never waits for its own run id, whatever commit it is listed under", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [matched(HEAD, { runs: [{ id: OWN_RUN, status: RUNNING }] })],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });

  it("waits for an eligible twin's in-flight sweep, naming it and the time spent", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(TIP, { runs: [{ id: OWN_RUN, status: RUNNING }] }),
        matched(HEAD, { runs: [{ id: TWIN_RUN, status: RUNNING }] }),
      ],
      elapsedMs: 90_000,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("wait");
    expect(decision.until).toEqual([
      { sha: HEAD, runId: TWIN_RUN, status: RUNNING },
    ]);
    expect(decision.reason).toContain(String(TWIN_RUN));
    expect(decision.reason).toContain("90s");
  });

  it("waits for a run that is still queued, not only one in progress", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [matched(HEAD, { runs: [{ id: TWIN_RUN, status: "queued" }] })],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("wait");
  });

  it("reuses the twin once its sweep finishes green", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(TIP),
        {
          sha: HEAD,
          treeMatched: true,
          verdict: swept,
          runs: [{ id: TWIN_RUN, status: "completed", conclusion: "success" }],
        },
      ],
      elapsedMs: 120_000,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("reuse");
    expect(decision.sha).toBe(HEAD);
  });

  // `gh pr merge --delete-branch` deletes the PR branch, and deleting a branch
  // cancels its queued and in-progress runs. Stopping on ANY completed status
  // is what keeps the budget from being spent on a run that will never finish.
  it("stops waiting when the twin's run ends cancelled", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(HEAD, {
          runs: [
            { id: TWIN_RUN, status: "completed", conclusion: "cancelled" },
          ],
        }),
      ],
      elapsedMs: 120_000,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });

  it("stops waiting when the twin's run ends red", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(HEAD, {
          runs: [{ id: TWIN_RUN, status: "completed", conclusion: "failure" }],
        }),
      ],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });

  // A run whose backend-smoke was SKIPPED proved independence (or reused a
  // sweep itself). It can never satisfy fullSweepVerdict, so waiting for it is
  // pure loss.
  it("never waits for a run whose backend-smoke was skipped", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(HEAD, {
          runs: [{ id: TWIN_RUN, status: RUNNING, smokeSkipped: true }],
        }),
      ],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });

  it("sweeps once the budget is spent, however much is still in flight", () => {
    const twins = [
      matched(HEAD, { runs: [{ id: TWIN_RUN, status: RUNNING }] }),
    ];
    expect(
      waitDecision({
        targetSha: TIP,
        currentRunId: OWN_RUN,
        twins,
        elapsedMs: BUDGET - 1,
        budgetMs: BUDGET,
      }).action,
    ).toBe("wait");
    const expired = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins,
      elapsedMs: BUDGET,
      budgetMs: BUDGET,
    });
    expect(expired.action).toBe("sweep");
    expect(expired.reason).toMatch(/wait budget/);
  });

  // A rebase onto a MOVED main: the association API still PROPOSES the PR
  // head, tree equality DECIDES against it — and a sweep running on content
  // that is not ours is not worth a second of the budget.
  it("never waits for an in-flight run on a commit whose tree differs", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [
        matched(TIP),
        {
          sha: HEAD,
          treeMatched: false,
          note: "tree ebb08c3 differs from 3c191a9",
          runs: [{ id: TWIN_RUN, status: RUNNING }],
        },
      ],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
    expect(decision.reason).toContain("differs");
  });

  it("sweeps when there is nothing to reuse and nothing to wait for", () => {
    const decision = waitDecision({
      targetSha: TIP,
      currentRunId: OWN_RUN,
      twins: [matched(TIP, { runs: [] })],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
    expect(decision.reason).toMatch(/carries or is running/);
  });

  it("tolerates an abbreviated target sha when excluding the target's own runs", () => {
    const decision = waitDecision({
      targetSha: TIP.slice(0, 7),
      twins: [matched(TIP, { runs: [{ id: OWN_RUN, status: RUNNING }] })],
      elapsedMs: 0,
      budgetMs: BUDGET,
    });
    expect(decision.action).toBe("sweep");
  });
});

describe("the poll loop around the decision", () => {
  const TWIN_RUN = 34503482517;
  const inFlight = [{ id: TWIN_RUN, status: "in_progress", conclusion: null }];

  // A fake clock and a fake sleep, so the loop's own behaviour is asserted
  // without a network or a wall clock.
  const harness = (checkRunsFor: (sha: string, poll: number) => Run[]) => {
    let polls = 0;
    let clock = 0;
    const slept: number[] = [];
    const logged: string[] = [];
    const treeReads: string[] = [];
    return {
      slept,
      logged,
      treeReads,
      run: (overrides: Record<string, unknown> = {}) =>
        waitForFullSweep({
          sha: TIP,
          candidates: [TIP, HEAD],
          currentRunId: 1,
          tree: (sha: string) => {
            treeReads.push(sha);
            return SHARED_TREE;
          },
          checkRuns: (sha: string) => checkRunsFor(sha, polls),
          workflowRuns: () => inFlight,
          runSmokeSkipped: () => false,
          budgetMs: 10 * 60 * 1000,
          pollMs: 30_000,
          now: () => clock,
          sleep: (ms: number) => {
            slept.push(ms);
            polls += 1;
            clock += ms;
            return Promise.resolve();
          },
          log: (line: string) => logged.push(line),
          ...overrides,
        }),
    };
  };

  it("polls until the twin's sweep completes green, then reuses it", async () => {
    const h = harness((sha, poll) =>
      sha === HEAD && poll >= 2
        ? [green(10, "gpu-agreement"), green(11, "backend-smoke")]
        : [],
    );
    const verdict = await h.run();
    expect(verdict).toMatchObject({ swept: true, sha: HEAD });
    expect(h.slept).toEqual([30_000, 30_000]);
    // One log line per poll, saying what it waits for and how long it has.
    expect(h.logged).toHaveLength(2);
    expect(h.logged[0]).toContain(String(TWIN_RUN));
    expect(h.logged[1]).toContain("30s");
  });

  it("gives up at the budget and sweeps", async () => {
    const h = harness(() => []);
    const verdict = await h.run({ budgetMs: 60_000 });
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).toMatch(/wait budget/);
    expect(h.slept).toEqual([30_000, 30_000]);
  });

  it("reads each commit's tree once for the whole wait, not once per poll", async () => {
    const h = harness(() => []);
    await h.run({ budgetMs: 60_000 });
    expect(h.treeReads).toEqual([TIP, HEAD]);
  });

  it("never asks for the target commit's own workflow runs", async () => {
    const asked: string[] = [];
    const verdict = await waitForFullSweep({
      sha: TIP,
      candidates: [TIP],
      tree: () => SHARED_TREE,
      checkRuns: () => [],
      workflowRuns: (sha: string) => {
        asked.push(sha);
        return [];
      },
      runSmokeSkipped: () => false,
      budgetMs: 60_000,
      pollMs: 1,
      now: () => 0,
      sleep: () => Promise.resolve(),
      log: () => {},
    });
    expect(asked).toEqual([]);
    expect(verdict.swept).toBe(false);
  });

  it("sweeps rather than waits when a twin's runs cannot be read", async () => {
    let slept = 0;
    const verdict = await waitForFullSweep({
      sha: TIP,
      candidates: [TIP, HEAD],
      tree: () => SHARED_TREE,
      checkRuns: () => [],
      workflowRuns: () => {
        throw new Error("gh: HTTP 502\nUsage: gh api ...");
      },
      runSmokeSkipped: () => false,
      budgetMs: 10 * 60 * 1000,
      pollMs: 30_000,
      now: () => 0,
      sleep: () => {
        slept += 1;
        return Promise.resolve();
      },
      log: () => {},
    });
    expect(verdict.swept).toBe(false);
    expect(slept).toBe(0);
  });

  it("drops an in-flight run whose jobs cannot be classified rather than waiting on it", async () => {
    let slept = 0;
    const verdict = await waitForFullSweep({
      sha: TIP,
      candidates: [TIP, HEAD],
      tree: () => SHARED_TREE,
      checkRuns: () => [],
      workflowRuns: () => inFlight,
      runSmokeSkipped: () => {
        throw new Error("gh: HTTP 404");
      },
      budgetMs: 10 * 60 * 1000,
      pollMs: 30_000,
      now: () => 0,
      sleep: () => {
        slept += 1;
        return Promise.resolve();
      },
      log: () => {},
    });
    expect(verdict.swept).toBe(false);
    expect(slept).toBe(0);
  });

  it("refuses without waiting when the target's own tree cannot be read", async () => {
    const verdict = await waitForFullSweep({
      sha: TIP,
      candidates: [TIP],
      tree: () => {
        throw new Error("gh: HTTP 404\nUsage: gh api ...");
      },
      checkRuns: () => [],
      workflowRuns: () => [],
      runSmokeSkipped: () => false,
      now: () => 0,
      sleep: () => Promise.resolve(),
      log: () => {},
    });
    expect(verdict.swept).toBe(false);
    expect(verdict.reason).not.toContain("Usage:");
  });
});
