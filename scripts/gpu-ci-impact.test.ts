import { readFileSync } from "node:fs";
import {
  dependencyClosure,
  fullMatrix,
  scenarioRoster,
  selectImpact,
} from "./gpu-ci-impact";
import type { SourceTree } from "./gpu-ci-impact";
import { applyScenarioShard } from "../src/app/gpu-bench/shard";

const roots = ["src/bench.ts"];
function tree(changes: Record<string, string | null> = {}): SourceTree {
  const files: Record<string, string> = {
    "package.json": '{"dependencies":{"three":"1"}}',
    "src/bench.ts": 'import "./gpu"; import "./gpu4";',
    "src/gpu.ts": 'export * from "./math";',
    "src/gpu4.ts": 'import type { Params } from "./wire";',
    "src/math.ts": 'import "./wire";',
    "src/wire.ts": "export interface Params { x: number }",
    "src/panel.ts": "export const label = 'hello';",
    "docs/guide.md": "Guide",
    "src/texture.json": "[]",
  };
  for (const [file, source] of Object.entries(changes)) {
    if (source === null) delete files[file];
    else files[file] = source;
  }
  return {
    files: new Set(Object.keys(files)),
    read: (file) => {
      if (!(file in files)) throw new Error(`Missing ${file}`);
      return files[file];
    },
  };
}

describe("GPU impact policy", () => {
  it("allows an existing independent panel edit without GPU work", () => {
    expect(
      selectImpact(
        tree(),
        tree({ "src/panel.ts": "export const label = 'world';" }),
        ["src/panel.ts"],
        roots,
      ).full,
    ).toBe(false);
  });
  it.each(["src/gpu.ts", "src/gpu4.ts", "src/math.ts", "src/wire.ts"])(
    "covers both halves for %s, including transitive type dependencies",
    (file) => {
      expect(selectImpact(tree(), tree(), [file], roots).groups).toEqual([
        "flame-3d",
        "flame-4d",
      ]);
    },
  );
  it("retains dependencies removed in the head graph", () => {
    expect(
      selectImpact(
        tree(),
        tree({ "src/math.ts": "", "src/gpu4.ts": "" }),
        ["src/wire.ts"],
        roots,
      ).full,
    ).toBe(true);
  });
  it("refuses ambiguous JavaScript/TypeScript resolution instead of dropping a possible dependency", () => {
    const graph = tree({ "src/gpu.js": 'export * from "./wire";' });
    expect(selectImpact(graph, graph, ["src/panel.ts"], roots).full).toBe(true);
  });
  it("follows literal dynamic imports, re-exports and URL assets", () => {
    const graph = tree({
      "src/bench.ts":
        'export * from "./gpu"; void import("./gpu4"); new URL("./texture.json", import.meta.url);',
    });
    expect(dependencyClosure(graph, roots)).toContain("src/texture.json");
    expect(dependencyClosure(graph, roots)).toContain("src/wire.ts");
  });
  it.each<Record<string, string | null>>([
    { "src/new.ts": "export const x = 1;" },
    { "src/panel.ts": null },
    { "package.json": '{"dependencies":{"three":"2"}}' },
    { "vite.config.ts": "export default {};" },
    { "src/texture.json": "[1]" },
  ])("fails closed for new/deleted/unclassified files: %j", (changes) => {
    expect(
      selectImpact(tree(), tree(changes), Object.keys(changes), roots).full,
    ).toBe(true);
  });
  it("fails closed for a new dependency from an independent file", () => {
    expect(
      selectImpact(
        tree(),
        tree({ "src/panel.ts": 'import "./wire";' }),
        ["src/panel.ts"],
        roots,
      ).full,
    ).toBe(true);
  });
  it.each([
    "import(name)",
    'import.meta.glob("./*.ts")',
    'fetch("./wire.ts")',
    'readFileSync("./wire.ts")',
    'new Worker("./wire.ts")',
    'new Function("return import(path)")',
    'import "./missing"',
    'import "unregistered-package"',
    "export const = ;",
  ])("fails closed when a dependency cannot be established: %s", (source) => {
    expect(
      selectImpact(
        tree(),
        tree({ "src/gpu.ts": source }),
        ["src/panel.ts"],
        roots,
      ).full,
    ).toBe(true);
  });
  it("skips ordinary documentation but follows imported documentation", () => {
    expect(selectImpact(tree(), tree(), ["docs/guide.md"], roots).full).toBe(
      false,
    );
    const imported = tree({ "src/bench.ts": 'import "../docs/guide.md?raw";' });
    expect(
      selectImpact(imported, imported, ["docs/guide.md"], roots).full,
    ).toBe(true);
  });
  it("rejects a missing root even for an otherwise inert change", () => {
    expect(
      selectImpact(
        tree(),
        tree({ "src/bench.ts": null }),
        ["docs/guide.md"],
        roots,
      ).full,
    ).toBe(true);
  });
});

describe("full scenario union", () => {
  const source = readFileSync(
    new URL("../src/app/gpu-bench/main.ts", import.meta.url),
    "utf8",
  );
  function expectIsolatedBrowserPartition(roster: { name: string }[]) {
    const matrix = fullMatrix(roster);
    expect(matrix).toHaveLength(roster.length);
    expect(matrix.flatMap((row) => row.scenarios).sort()).toEqual(
      roster.map((s) => s.name).sort(),
    );
    for (const row of matrix) {
      expect(row.scenarios).toHaveLength(1);
      expect(row.scenarios).toEqual(
        applyScenarioShard(roster, `${row.shard}/${row.total}`).map(
          (s) => s.name,
        ),
      );
    }
  }
  it("isolates the actual page roster exactly as the browser does", () => {
    expectIsolatedBrowserPartition(scenarioRoster(source));
  });
  it.each([0, 14, 28])(
    "keeps scenarios isolated beyond 27 after inserting at index %i",
    (index) => {
      const roster = Array.from({ length: 28 }, (_, i) => ({
        name: `scenario-${String(i)}`,
        kind: i % 2 === 0 ? "3d" : "4d",
      }));
      expectIsolatedBrowserPartition(roster);
      roster.splice(index, 0, { name: "future-4d", kind: "4d" });
      expectIsolatedBrowserPartition(roster);
    },
  );
  it.each([
    "const SCENARIOS = makeScenarios();",
    'const SCENARIOS = [{name:"only",kind:"3d"}];',
    'const SCENARIOS = [{name:"same",kind:"3d"},{name:"same",kind:"4d"}];',
    "const SCENARIOS = [...additionalScenarios];",
    'const SCENARIOS = [{name:"a",kind:"3d",[key]: value},{name:"b",kind:"4d"}];',
  ])("refuses an uncheckable roster: %s", (roster) => {
    expect(() => scenarioRoster(roster)).toThrow();
  });
});
