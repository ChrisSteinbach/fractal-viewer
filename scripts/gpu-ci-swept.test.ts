import {
  fullSweepVerdict,
  latestCheckByName,
  parseCheckRuns,
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
