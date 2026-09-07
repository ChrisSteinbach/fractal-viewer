import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

describe("GPU planner against real git history", () => {
  const script = fileURLToPath(new URL("./gpu-ci-plan.mjs", import.meta.url));
  let dir: string;
  let base: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text: string) =>
    writeFileSync(join(dir, file), text);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gpu-impact-"));
    mkdirSync(join(dir, "src/app/gpu-bench"), { recursive: true });
    mkdirSync(join(dir, "scripts"));
    write("package.json", "{}");
    write("scripts/gpu-flame-bench.mjs", "");
    write(
      "src/app/gpu-bench/main.ts",
      'const SCENARIOS = [{name:"a",kind:"3d"},{name:"b",kind:"4d"}];',
    );
    write("src/app/panel.ts", 'export const title = "First title";');
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("config", "core.hooksPath", "/dev/null");
    git("add", ".");
    git("commit", "-qm", "base");
    base = git("rev-parse", "HEAD");
    write("src/app/panel.ts", 'export const title = "Updated title";');
    git("commit", "-qam", "panel edit");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  function plan(args: string[] = [], eventName = "", event = {}) {
    write("event.json", JSON.stringify(event));
    execFileSync(process.execPath, [script, ...args], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: join(dir, "event.json"),
        GITHUB_OUTPUT: "",
        GITHUB_STEP_SUMMARY: "",
      },
      stdio: "pipe",
    });
    return JSON.parse(
      readFileSync(join(dir, "gpu-ci-plan.json"), "utf8"),
    ) as Record<string, any>;
  }
  it("skips a UI edit using the complete PR baseline", () => {
    expect(
      plan([], "pull_request", { pull_request: { base: { sha: base } } }).full,
    ).toBe(false);
  });
  it("does not forget sensitive work when a later push edits only UI", () => {
    write(
      "src/app/gpu-bench/main.ts",
      'const SCENARIOS = [{name:"new-a",kind:"3d"},{name:"b",kind:"4d"}];',
    );
    git("commit", "-qam", "sensitive edit");
    write("src/app/panel.ts", 'export const title = "Third title";');
    git("commit", "-qam", "later UI edit");
    expect(
      plan([], "pull_request", { pull_request: { base: { sha: base } } }).full,
    ).toBe(true);
  });
  it("uses push.before, covering all commits in the push", () => {
    expect(plan([], "push", { before: base }).full).toBe(false);
  });
  it.each(["schedule", "workflow_dispatch"])(
    "forces the full union on %s even with an independent diff",
    (event) => {
      expect(plan([`--base=${base}`], event).matrix.include).toHaveLength(2);
    },
  );
  it("fails closed on a missing or zero baseline", () => {
    expect(plan(["--base=0000000000000000000000000000000000000000"]).full).toBe(
      true,
    );
    expect(plan().full).toBe(true);
  });
});
