import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
};

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
