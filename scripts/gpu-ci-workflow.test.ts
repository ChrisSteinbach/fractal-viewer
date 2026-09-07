import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";

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
    expect(deploy.jobs.deploy.needs).toBe("gpu-full");
    expect(deploy.jobs["gpu-full"].uses).toBe(
      "./.github/workflows/gpu-agreement.yml",
    );
    expect(deploy.jobs["gpu-full"].needs).toBe("preflight");
    expect(deploy.jobs.preflight.steps[0].name).toBe(
      "Require green CI for this commit",
    );
    expect(deploy.jobs.preflight.if).toBeUndefined();
    expect(deploy.jobs["gpu-full"].if).toBeUndefined();
    expect(deploy.jobs["gpu-full"].with).toBeUndefined();
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
