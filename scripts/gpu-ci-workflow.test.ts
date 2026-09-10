import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { DEFAULT_WAIT_BUDGET_MS } from "./gpu-ci-swept.mjs";

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
};

// These spawn the REAL planner against this checkout, which walks the whole
// dependency closure: ~4.6s locally, against vitest's 5s default. It is the
// analysis actually happening that costs it -- the run it replaced bailed in
// 0.5s on an unresolvable import and selected a full sweep every time.
const PLANNER_TIMEOUT_MS = 60_000;

function workflow(name: string) {
  return parse(
    readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, any>;
}

describe("GPU workflow gates", () => {
  const gpu = workflow("gpu-agreement");
  const gate = gpu.jobs["gpu-agreement"].steps[0].run;
  it.each([
    ["success", "false", "skipped", "skipped", true],
    ["success", "true", "success", "success", true],
    ["failure", "false", "skipped", "skipped", false],
    ["cancelled", "true", "success", "success", false],
    ["success", "true", "skipped", "skipped", false],
    ["success", "true", "failure", "skipped", false],
    ["success", "true", "success", "failure", false],
    ["success", "true", "success", "cancelled", false],
    ["success", "", "skipped", "skipped", false],
    ["success", "false", "success", "success", false],
  ])(
    "aggregate select=%s full=%s smoke=%s agreement=%s passes=%s",
    (SELECT, FULL, SMOKE, AGREEMENT, pass) => {
      const run = () =>
        execFileSync("bash", ["-e", "-c", gate], {
          env: {
            SELECT: String(SELECT),
            FULL: String(FULL),
            SMOKE: String(SMOKE),
            AGREEMENT: String(AGREEMENT),
          },
          stdio: "pipe",
        });
      if (pass) expect(run).not.toThrow();
      else expect(run).toThrow();
    },
  );
  it("always reports the aggregate, including failed or skipped dependencies", () => {
    expect(gpu.jobs["gpu-agreement"].if).toBe("always()");
    expect(gpu.jobs["gpu-agreement"].needs).toEqual([
      "select",
      "backend-smoke",
      "agreement",
    ]);
    expect(gpu.on.pull_request).toBeNull();
    expect(gpu.on.push["paths-ignore"]).toBeUndefined();
  });
  it("retains manual, nightly and reusable full sweeps", () => {
    expect(gpu.on).toHaveProperty("workflow_dispatch");
    expect(gpu.on).toHaveProperty("workflow_call");
    expect(gpu.on.schedule).toEqual([{ cron: "17 3 * * *" }]);
  });
  it("makes deployment depend on the same full agreement workflow", () => {
    const deploy = workflow("deploy");
    expect(deploy.on).toEqual({ workflow_dispatch: null });
    expect(deploy.jobs.deploy.needs).toEqual(["preflight", "gpu-full"]);
    expect(deploy.jobs["gpu-full"].uses).toBe(
      "./.github/workflows/gpu-agreement.yml",
    );
    expect(deploy.jobs["gpu-full"].needs).toBe("preflight");
    const steps = deploy.jobs.preflight.steps as Step[];
    expect(steps.map((step) => step.name)).toContain(
      "Require green CI for this commit",
    );
    expect(deploy.jobs.preflight.if).toBeUndefined();
    expect(deploy.jobs["gpu-full"].with).toBeUndefined();
    expect(deploy.jobs["verify-live"].needs).toBe("deploy");
  });
  it("asks the TREE question in the deploy preflight, not the exact-SHA one", () => {
    // The chain that collapses three sweeps into one: the PR head sweeps, the
    // push-to-main run skips because the rebased tip shares its tree, and
    // deploy skips for the same reason. The exact-SHA question would break the
    // last link — main's tip then carries a green aggregate with a SKIPPED
    // backend-smoke, which reads (correctly) as "not swept".
    const swept = (workflow("deploy").jobs.preflight.steps as Step[]).find(
      (step) => step.id === "swept",
    );
    expect(swept?.run).toContain("--tree");
    // The lint/build/test/smoke gate stays exact-commit: cheap, and its
    // early post-rebase refusal is deliberate.
    const ci = (workflow("deploy").jobs.preflight.steps as Step[]).find(
      (step) => step.name === "Require green CI for this commit",
    );
    expect(ci?.run).not.toContain("--tree");
  });

  it("lets a push to main reuse a sweep already green on the same tree", () => {
    const select = gpu.jobs.select;
    const steps = select.steps as Step[];
    const swept = steps.find((step) => step.id === "swept");
    expect(swept?.run).toContain("scripts/gpu-ci-swept.mjs");
    expect(swept?.run).toContain("--tree");
    // Push only. A PR's own sweep is the result being established; schedule
    // and workflow_dispatch force full on purpose and carry the environment
    // liveness signal; a workflow_call reports the CALLER's event name, so
    // deploy's reusable call is excluded by the same condition.
    expect((swept as Record<string, unknown>).if).toBe(
      "github.event_name == 'push'",
    );
    expect(swept?.env?.GH_TOKEN).toBe("${{ github.token }}");
    // Ordering: the plan step must be able to read the swept step's outputs.
    expect(steps.indexOf(swept!)).toBeLessThan(
      steps.findIndex((step) => step.id === "plan"),
    );
  });

  it("waits for a twin's in-flight sweep instead of duplicating it", () => {
    // Reuse otherwise depends on a human merging AFTER a ~33-minute sweep
    // that no rule makes them wait for — gpu-agreement is not a required
    // check — which is why the first real merge after tree keying reused
    // nothing. The push run now waits for an eligible in-flight twin: one
    // idle runner against 36 shard jobs of ~8 minutes each.
    const swept = (gpu.jobs.select.steps as Step[]).find(
      (step) => step.id === "swept",
    );
    expect(swept?.run).toContain("--wait");
    // The job must outlive the wait budget, or expiry becomes a killed job
    // reddening the aggregate rather than the script's own reported sweep.
    expect(gpu.jobs.select["timeout-minutes"] * 60_000).toBeGreaterThan(
      DEFAULT_WAIT_BUDGET_MS,
    );
  });

  it("refuses the wait in deploy's preflight, which holds the pages group", () => {
    // A dispatch is manual and re-dispatchable, its preflight is
    // timeout-minutes: 2, and a deploy parked for half an hour holds the
    // `pages` concurrency group that cancel-in-progress: false already makes
    // precious — the rollback flow would queue behind it.
    const preflight = workflow("deploy").jobs.preflight;
    const swept = (preflight.steps as Step[]).find(
      (step) => step.id === "swept",
    );
    expect(swept?.run).toContain("--tree");
    expect(swept?.run).not.toContain("--wait");
    expect(preflight["timeout-minutes"]).toBe(2);
  });

  it("routes the reuse through the plan so full=false stays the one signal", () => {
    // The GPU jobs and the stable aggregate both key off `full`; a second
    // skip condition beside it would let them disagree. The plan also records
    // the reuse in gpu-ci-plan.json's reasons, which is still uploaded.
    const plan = (gpu.jobs.select.steps as Step[]).find(
      (step) => step.id === "plan",
    );
    expect(plan?.run).toContain("--swept=$SWEPT_SHA");
    expect(plan?.env?.SWEPT).toBe("${{ steps.swept.outputs.swept }}");
    expect(plan?.env?.SWEPT_SHA).toBe("${{ steps.swept.outputs.swept_sha }}");
    // Built in shell from env, never interpolated into the command line.
    expect(plan?.run).not.toContain("${{ steps.swept.outputs.swept_sha }}\n");
    expect(gpu.jobs["backend-smoke"].if).toBe(
      "needs.select.outputs.full == 'true'",
    );
    expect(gpu.jobs.agreement.if).toBe("needs.select.outputs.full == 'true'");
    const artifact = (gpu.jobs.select.steps as Step[]).at(-1);
    expect(artifact?.uses).toContain("actions/upload-artifact@");
  });

  it(
    "records the reuse in the plan's reasons and skips both GPU jobs",
    () => {
      // Run the real planner with the real flag against this checkout, so the
      // artifact's shape is asserted rather than described.
      const twin = "d721cc766028735ab7cd28f85646327d755b5ba3";
      const out = execFileSync(
        "node",
        [
          "scripts/gpu-ci-plan.mjs",
          "--base=HEAD~1",
          "--head=HEAD",
          `--swept=${twin}`,
        ],
        { cwd: new URL("..", import.meta.url), encoding: "utf8" },
      );
      const plan = JSON.parse(out);
      expect(plan.full).toBe(false);
      expect(plan.matrix.include).toEqual([]);
      expect(plan.reasons[0]).toContain(twin);
      expect(plan.reasons[0]).toMatch(/tree is identical/);
      // Structural too, so a reader need not parse a sentence to ask "reuse?".
      expect(plan.swept).toBe(twin);
    },
    PLANNER_TIMEOUT_MS,
  );

  it(
    "headlines a reuse as a reuse, never as proved independence",
    () => {
      // Both outcomes end in no GPU jobs, and they are NOT the same claim: a
      // reuse says this content already passed, independence says it was never
      // touched. Borrowing independence's headline would misreport the one
      // distinction this whole gate turns on.
      const summary = new URL(
        "../gpu-ci-plan-summary.test.md",
        import.meta.url,
      );
      const headline = (args: string[]) => {
        rmSync(summary, { force: true });
        execFileSync("node", ["scripts/gpu-ci-plan.mjs", ...args], {
          cwd: new URL("..", import.meta.url),
          encoding: "utf8",
          env: { ...process.env, GITHUB_STEP_SUMMARY: fileURLToPath(summary) },
        });
        const first = readFileSync(summary, "utf8").split("\n")[0];
        rmSync(summary, { force: true });
        return first;
      };
      expect(
        headline(["--base=HEAD~1", "--head=HEAD", "--swept=" + "a".repeat(40)]),
      ).toMatch(/full sweep reused from a{40}; no GPU jobs/);
      expect(headline(["--full"])).toMatch(/full 3D \+ 4D agreement/);
    },
    PLANNER_TIMEOUT_MS,
  );

  it(
    "keeps the planner offline and unchanged for a local base/head run",
    () => {
      const out = execFileSync(
        "node",
        ["scripts/gpu-ci-plan.mjs", "--base=HEAD~1", "--head=HEAD"],
        { cwd: new URL("..", import.meta.url), encoding: "utf8" },
      );
      const plan = JSON.parse(out);
      expect(plan.reasons.join(" ")).not.toMatch(/tree is identical/);
      expect(plan.base).toBe("HEAD~1");
    },
    PLANNER_TIMEOUT_MS,
  );

  it("skips the deploy sweep only when this commit is already fully swept", () => {
    const deploy = workflow("deploy");
    // != 'true' and never == 'false': a missing/empty output must sweep.
    expect(deploy.jobs["gpu-full"].if).toBe(
      "needs.preflight.outputs.swept != 'true'",
    );
    expect(deploy.jobs.preflight.outputs).toEqual({
      swept: "${{ steps.swept.outputs.swept }}",
    });
    const steps = deploy.jobs.preflight.steps as Step[];
    const swept = steps.find((step) => step.id === "swept");
    expect(swept?.run).toContain("scripts/gpu-ci-swept.mjs");
    expect(swept?.env?.GH_TOKEN).toBe("${{ github.token }}");
    // The script needs to be on disk, and this job has no npm install: the
    // checkout must come first and the step must stay dependency-free.
    expect(steps[0].uses).toContain("actions/checkout@");
    expect(
      steps.some((step) =>
        /setup-node|npm ci/.test(`${step.uses ?? ""}${step.run ?? ""}`),
      ),
    ).toBe(false);
  });
  it("lets a skipped sweep through to deploy without admitting a failed one", () => {
    // The condition's admitted-result set is data, so read it back rather than
    // re-implementing GitHub's expression evaluator: `skipped` must be in it
    // (a bare `needs: gpu-full` would skip deploy the moment the sweep is
    // reused), and nothing weaker than success may join it.
    const condition = String(workflow("deploy").jobs.deploy.if);
    const admitted = condition.match(
      /contains\(fromJSON\('(\[[^']*\])'\),\s*needs\.gpu-full\.result\)/,
    );
    expect(admitted).not.toBeNull();
    expect(JSON.parse(admitted![1])).toEqual(["success", "skipped"]);
    // ...and the rest of the guard: never on cancellation, never past a
    // failed preflight, and no alternative branch around either.
    expect(condition).toContain("!cancelled()");
    expect(condition).toContain("needs.preflight.result == 'success'");
    expect(condition).not.toContain("||");
    expect(condition.split("&&")).toHaveLength(3);
  });
  it("preserves the four existing required checks on every PR and main push", () => {
    const ci = workflow("ci");
    expect(Object.keys(ci.jobs).sort()).toEqual([
      "build",
      "lint",
      "smoke",
      "test",
    ]);
    expect(ci.on.pull_request).toBeNull();
    expect(ci.on.push).toEqual({ branches: ["main"] });
  });
});
