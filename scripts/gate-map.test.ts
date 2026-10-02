import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_SPINE_MODULES,
  GATE_MAP,
  affectedForEntry,
  affectedRoster,
  gateMapMatches,
  isInertPath,
  type GateMapEntry,
} from "./gate-map.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("gate-map matching", () => {
  it("exact paths match exactly", () => {
    expect(
      gateMapMatches("src/fractal/surface-de.ts", "src/fractal/surface-de.ts"),
    ).toBe(true);
    expect(
      gateMapMatches(
        "src/fractal/surface-de-4d.ts",
        "src/fractal/surface-de.ts",
      ),
    ).toBe(false);
  });

  it("directory prefixes match everything under them", () => {
    expect(gateMapMatches("src/fractal/tiling-de.ts", "src/fractal/")).toBe(
      true,
    );
    expect(gateMapMatches("src/app/tiling.ts", "src/fractal/")).toBe(false);
  });

  it("suffix wildcards match by prefix", () => {
    expect(
      gateMapMatches("src/fractal/surface-de-4d.ts", "src/fractal/surface-de*"),
    ).toBe(true);
    expect(
      gateMapMatches("src/fractal/surface-de.ts", "src/fractal/surface-de*"),
    ).toBe(true);
    expect(
      gateMapMatches("src/fractal/escape-de.ts", "src/fractal/surface-de*"),
    ).toBe(false);
  });

  it("inert paths are docs, markdown and beads", () => {
    expect(isInertPath("docs/gate-velocity.md")).toBe(true);
    expect(isInertPath("README.md")).toBe(true);
    expect(isInertPath(".beads/x.jsonl")).toBe(true);
    expect(isInertPath("src/fractal/surface-de.ts")).toBe(false);
  });
});

describe("affectedForEntry", () => {
  const entry: GateMapEntry = {
    name: "sample",
    kind: "gate",
    cost: "full-render",
    modules: ["src/fractal/surface-de.ts", "src/fractal/fold*"],
  };

  it("matches table modules, listing them as reasons", () => {
    const hit = affectedForEntry(
      entry,
      new Set(["src/fractal/foldZoo.ts"]),
      null,
    );
    expect(hit?.reasons).toEqual(["src/fractal/foldZoo.ts"]);
  });

  it("matches closure members too", () => {
    const hit = affectedForEntry(
      entry,
      new Set(["scripts/lib/frame-cache-gate.mjs"]),
      new Set([
        "scripts/lib/frame-cache-gate.mjs",
        "scripts/finish.verify.mjs",
      ]),
    );
    expect(hit?.reasons).toEqual(["scripts/lib/frame-cache-gate.mjs"]);
  });

  it("an unavailable closure does not suppress table matches", () => {
    const hit = affectedForEntry(
      entry,
      new Set(["src/fractal/surface-de.ts"]),
      null,
    );
    expect(hit).not.toBeNull();
  });

  it("no match is null", () => {
    expect(
      affectedForEntry(entry, new Set(["src/app/voxel.ts"]), null),
    ).toBeNull();
  });

  it("reasons cap at maxReasons", () => {
    const hit = affectedForEntry(
      entry,
      new Set([
        "src/fractal/surface-de.ts",
        "src/fractal/foldA.ts",
        "src/fractal/foldB.ts",
      ]),
      null,
      { maxReasons: 2 },
    );
    expect(hit?.reasons).toHaveLength(2);
  });
});

describe("affectedRoster rules", () => {
  const entries: GateMapEntry[] = [
    {
      name: "cached-gate",
      kind: "gate",
      cost: "cache-eligible",
      modules: ["src/fractal/surface-de.ts"],
    },
    {
      name: "plain-gate",
      kind: "gate",
      cost: "full-render",
      modules: ["src/app/voxel.ts"],
    },
    {
      name: "plain-sheet",
      kind: "sheet",
      cost: "full-render",
      modules: [],
    },
  ];
  const onDisk = new Map([
    ["cached-gate", "gate"],
    ["plain-gate", "gate"],
    ["plain-sheet", "sheet"],
    ["stray-gate", "gate"],
  ] as const);
  const closures = new Map<string, ReadonlySet<string> | null>([
    ["cached-gate", new Set(["scripts/surface-repro.verify.mjs"])],
    ["plain-gate", new Set(["scripts/plain-gate.verify.mjs"])],
    ["plain-sheet", new Set(["scripts/de-preview.ts", "src/fractal/voxel.ts"])],
    ["stray-gate", null],
  ]);

  it("docs-only changes affect nothing", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["docs/gate-velocity.md"]),
      closures,
    });
    expect(answer.affected).toEqual([]);
    expect(answer.unmapped).toEqual(["stray-gate"]);
  });

  it("a table module marks exactly its entries, sorted by cost then name", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["src/fractal/surface-de.ts"]),
      closures,
    });
    // stray-gate rides along: code changed, and an unmapped script is
    // conservatively affected — the roster never silently skips it.
    expect(answer.affected.map((e) => e.name).sort()).toEqual([
      "cached-gate",
      "stray-gate",
    ]);
    expect(answer.affected[0].name).toBe("cached-gate");
    expect(answer.affected[0].reasons).toEqual(["src/fractal/surface-de.ts"]);
  });

  it("a closure member marks its own entry even without a table match", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["scripts/surface-repro.verify.mjs"]),
      closures,
    });
    // surface-repro.verify.mjs is in cached-gate's closure; the stray's
    // conservatism rides the code-changed rule beside it.
    expect(answer.affected.map((e) => e.name).sort()).toEqual([
      "cached-gate",
      "stray-gate",
    ]);
    expect(answer.affected[0].reasons).toEqual([
      "scripts/surface-repro.verify.mjs",
    ]);
  });

  it("a spine change marks every gate but no sheet", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set([...APP_SPINE_MODULES].slice(0, 1)),
      closures,
    });
    const names = answer.affected.map((e) => e.name);
    expect(names).toContain("cached-gate");
    expect(names).toContain("plain-gate");
    expect(names).not.toContain("plain-sheet");
    expect(answer.spineFiles).toHaveLength(1);
  });

  it("a machinery change marks everything, sheets included", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["scripts/gate-map.ts"]),
      closures,
    });
    expect(answer.affected).toHaveLength(4); // 3 entries + stray
    expect(answer.machineryFiles).toEqual(["scripts/gate-map.ts"]);
  });

  it("unmapped on-disk scripts count as affected when any code changed", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["src/fractal/surface-de.ts"]),
      closures,
    });
    const stray = answer.affected.find((e) => e.name === "stray-gate");
    expect(stray).toBeDefined();
    expect(stray?.reasons[0]).toMatch(/unmapped entry/);
  });

  it("unmapped scripts stay unaffected on a docs-only change", () => {
    const answer = affectedRoster({
      entries,
      onDisk,
      changed: new Set(["package.json"]),
      closures,
    });
    // package.json is not module-shaped by the roster's rule, so the
    // conservative unmapped trigger does not fire.
    expect(
      answer.affected.find((e) => e.name === "stray-gate"),
    ).toBeUndefined();
  });
});

describe("the table itself", () => {
  it("every entry names a real gate or sheet on disk, with the right kind", () => {
    for (const entry of GATE_MAP) {
      const file =
        entry.kind === "gate"
          ? path.join(here, `${entry.name}.verify.mjs`)
          : path.join(here, `${entry.name}.harness.ts`);
      expect(readdirSync(here).includes(path.basename(file))).toBe(true);
    }
  });

  it("every entry carries one of the three cost classes; names unique per kind", () => {
    const costs = new Set(["cache-eligible", "full-render", "lifecycle"]);
    const seen = new Set<string>();
    for (const entry of GATE_MAP) {
      expect(costs.has(entry.cost)).toBe(true);
      const key = `${entry.kind}:${entry.name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("module patterns are repo paths (exact, /- or *-prefixed forms)", () => {
    for (const entry of GATE_MAP) {
      for (const pattern of entry.modules) {
        expect(
          pattern.startsWith("src/") || pattern.startsWith("scripts/"),
        ).toBe(true);
      }
    }
  });

  it("the table covers every on-disk verify gate and harness sheet", () => {
    // THE UPDATE RULE, enforced by test rather than by review: adding a gate
    // or sheet without its entry fails here, naming the script. Names are a
    // (kind, name) namespace — a name may be both a gate and a sheet.
    const disk = readdirSync(here);
    const seen = new Set(GATE_MAP.map((e) => `${e.kind}:${e.name}`));
    const missing: string[] = [];
    for (const file of disk) {
      if (file.endsWith(".verify.mjs")) {
        const name = file.slice(0, -".verify.mjs".length);
        if (!seen.has(`gate:${name}`)) missing.push(`gate ${name}`);
      } else if (file.endsWith(".harness.ts")) {
        const name = file.slice(0, -".harness.ts".length);
        if (!seen.has(`sheet:${name}`)) missing.push(`sheet ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the map reads the repo's own spine list consistently", () => {
    for (const spineFile of APP_SPINE_MODULES) {
      // Spine files are real paths in the tree (or were, when this failed).
      if (
        spineFile.endsWith(".ts") ||
        spineFile.endsWith(".css") ||
        spineFile.endsWith(".html")
      ) {
        expect(() =>
          readFileSync(path.join(here, "..", spineFile), "utf8"),
        ).not.toThrow();
      }
    }
  });
});
