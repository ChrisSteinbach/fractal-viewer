/** Conservative module-level impact analysis. Policy and measurements:
 * docs/gpu-agreement-ci.md. Both dimensional halves share one agreement group. */
import ts from "typescript";
import { posix } from "node:path";

export interface SourceTree {
  files: Set<string>;
  read: (file: string) => string;
}

export const GPU_ROOTS = [
  "src/app/gpu-bench/main.ts",
  "scripts/gpu-flame-bench.mjs",
];

const moduleFile = /\.(?:[cm]?[jt]sx?)$/;
const inert = (file: string): boolean =>
  file.startsWith("docs/") ||
  file.endsWith(".md") ||
  file.startsWith(".beads/");

/** Type imports and re-exports count too. Unknown loaders never prove safety. */
export function imports(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const checked = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  if (
    checked.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)
  ) {
    throw new Error(`cannot parse ${file}`);
  }
  const found = new Set<string>();
  const add = (node: ts.Node | undefined): void => {
    if (!node || !ts.isStringLiteralLike(node))
      throw new Error(`unknown import in ${file}`);
    found.add(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add(node.argument.literal);
    } else if (ts.isImportEqualsDeclaration(node)) {
      throw new Error(`unsupported import assignment in ${file}`);
    } else if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(parsed);
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        expression === "require"
      ) {
        add(node.arguments[0]);
      } else if (
        /import\.meta\.(glob|resolve)|\brequire\b|(?:^|\.)(?:fetch|readFile|readFileSync)$|^eval$/.test(
          expression,
        )
      ) {
        throw new Error(`unknown loader in ${file}`);
      }
    } else if (
      ts.isNewExpression(node) &&
      node.expression.getText(parsed) === "URL" &&
      (node.arguments?.length ?? 0) > 1
    ) {
      // TWO arguments or it is not a module reference. The form this branch
      // exists for is the bundler idiom `new URL("./worker.js",
      // import.meta.url)`, where the second argument is the base. A
      // ONE-argument `new URL(x)` cannot be a module reference at all: a
      // relative specifier with no base is a runtime TypeError, so x is
      // always an absolute runtime address -- and treating one as an import
      // made a single runtime URL in scripts/gpu-flame-bench.mjs (a template
      // literal, so not isStringLiteralLike) throw "unknown import" and fall
      // the WHOLE selector back to a full sweep on every run, for every
      // change, however independent. A dynamic first argument beside a base
      // still throws: that one genuinely cannot be resolved.
      add(node.arguments?.[0]);
    } else if (
      ts.isNewExpression(node) &&
      ["Worker", "SharedWorker", "Function"].includes(
        node.expression.getText(parsed),
      )
    ) {
      throw new Error(`unsupported runtime loader in ${file}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...found].sort();
}

function resolveLocal(tree: SourceTree, from: string, spec: string): string {
  const base = posix.normalize(
    posix.join(posix.dirname(from), spec.split(/[?#]/)[0]),
  );
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.js"].map(
      (s) => base + s,
    ),
  ];
  // TypeScript's extension substitution for source imports written as .js.
  if (base.endsWith(".js")) candidates.unshift(base.slice(0, -3) + ".ts");
  const resolved = [...new Set(candidates)].filter((candidate) =>
    tree.files.has(candidate),
  );
  if (resolved.length !== 1)
    throw new Error(`unresolved/ambiguous ${from} -> ${spec}`);
  return resolved[0];
}

export function dependencyClosure(
  tree: SourceTree,
  roots = GPU_ROOTS,
): Set<string> {
  const packageJson = JSON.parse(tree.read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const packages = new Set(
    Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }),
  );
  const closure = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const file = pending.pop()!;
    if (closure.has(file)) continue;
    if (!tree.files.has(file))
      throw new Error(`missing root/dependency ${file}`);
    closure.add(file);
    if (!moduleFile.test(file)) continue;
    for (const spec of imports(file, tree.read(file))) {
      if (spec.startsWith(".")) pending.push(resolveLocal(tree, file, spec));
      else if (!spec.startsWith("node:")) {
        const packageName = spec.startsWith("@")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
        if (!packages.has(packageName))
          throw new Error(`unknown package/alias ${file} -> ${spec}`);
      }
    }
  }
  return closure;
}

export interface Impact {
  full: boolean;
  groups: string[];
  reasons: string[];
}

export function selectImpact(
  base: SourceTree,
  head: SourceTree,
  changed: string[],
  roots = GPU_ROOTS,
): Impact {
  const reasons: string[] = [];
  try {
    const closure = new Set([
      ...dependencyClosure(base, roots),
      ...dependencyClosure(head, roots),
    ]);
    for (const file of changed) {
      if (closure.has(file)) reasons.push(`agreement dependency: ${file}`);
      else if (inert(file)) continue;
      else if (!base.files.has(file) || !head.files.has(file))
        reasons.push(`new/deleted/renamed file: ${file}`);
      else if (
        !file.startsWith("src/") ||
        !moduleFile.test(file) ||
        file.endsWith(".d.ts")
      )
        reasons.push(`unclassified configuration/asset: ${file}`);
      else {
        // A dependency added to even a currently unrelated consumer is unknown
        // work until the next baseline; never silently inherit a skip decision.
        const before = imports(file, base.read(file));
        const after = imports(file, head.read(file));
        if (JSON.stringify(before) !== JSON.stringify(after))
          reasons.push(`changed import edges: ${file}`);
      }
    }
  } catch (error) {
    reasons.push(`analysis uncertainty: ${String(error)}`);
  }
  return {
    full: reasons.length > 0,
    groups: reasons.length ? ["flame-3d", "flame-4d"] : [],
    reasons,
  };
}

/** Read the actual page roster, without importing its DOM or duplicating names.
 * A computed/spread roster requires an explicit new extraction contract. */
export function scenarioRoster(
  source: string,
): { name: string; kind: string }[] {
  const file = ts.createSourceFile(
    "main.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let list: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "SCENARIOS" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      list = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!list) throw new Error("Cannot find literal SCENARIOS roster");
  const roster = list.elements.map((element) => {
    if (
      !ts.isObjectLiteralExpression(element) ||
      element.properties.some(
        (p) => p.name && ts.isComputedPropertyName(p.name),
      )
    )
      throw new Error("Nonliteral scenario");
    const field = (name: string): string => {
      const index = element.properties
        .map((p) => p.name?.getText(file))
        .lastIndexOf(name);
      const prop = element.properties[index];
      if (
        !prop ||
        element.properties.slice(index + 1).some(ts.isSpreadAssignment) ||
        !ts.isPropertyAssignment(prop) ||
        !ts.isStringLiteral(prop.initializer)
      )
        throw new Error(`Nonliteral scenario ${name}`);
      return prop.initializer.text;
    };
    return { name: field("name"), kind: field("kind") };
  });
  if (
    !roster.length ||
    new Set(roster.map((s) => s.name)).size !== roster.length ||
    !roster.some((s) => s.kind === "3d") ||
    !roster.some((s) => s.kind === "4d") ||
    roster.some((s) => !["3d", "4d"].includes(s.kind))
  )
    throw new Error("Invalid scenario roster or dimensional gap");
  return roster;
}

// Give each scenario its own job. A fixed shard count silently re-pairs heavy
// scenarios when the roster grows or changes order, risking the unchanged
// 20-minute whole-shard cap. The browser's round-robin partition at this count
// selects exactly the scenario named in each row.
export function fullMatrix(
  roster: { name: string }[],
): { shard: number; total: number; scenarios: string[] }[] {
  const total = roster.length;
  return roster.map((scenario, i) => ({
    shard: i + 1,
    total,
    scenarios: [scenario.name],
  }));
}
