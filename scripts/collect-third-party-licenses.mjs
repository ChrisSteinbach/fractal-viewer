#!/usr/bin/env node
/**
 * fr-a2l: collect the license notices of every third-party package that ships
 * in the production build, into one THIRD-PARTY-LICENSES.txt.
 *
 * Why: the bundled dependencies are MIT-licensed, and MIT requires their
 * copyright + permission notice be included "in all copies or substantial
 * portions of the Software" — but Vite's esbuild minify strips the banner
 * comments from the bundles. This script emits the notices as a standalone
 * file instead, written into src/app/public/ (gitignored) so Vite copies it
 * verbatim into dist/app/ and the service worker precaches it — the offline
 * copy keeps its notices too. Runs before `vite build` (see the `build`
 * script in package.json).
 *
 * What it covers: the transitive runtime-dependency closure of
 *   - every entry in package.json `dependencies` (bundled into the app), and
 *   - the SW_BUNDLED_SEEDS below (devDependencies that vite-plugin-pwa
 *     bundles into the service worker build of src/app/sw/sw.ts).
 *
 * Fails loudly if a package in the closure is missing from node_modules or
 * ships no license file, so a new dependency can't silently ship unattributed.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * devDependencies whose code is nevertheless bundled into shipped output.
 * Keep in sync with the imports of src/app/sw/sw.ts (the service worker is
 * built and bundled separately by vite-plugin-pwa's injectManifest).
 */
const SW_BUNDLED_SEEDS = ["workbox-precaching"];

const root = fileURLToPath(new URL("..", import.meta.url));
const outFile = join(root, "src/app/public/THIRD-PARTY-LICENSES.txt");

/** Read and parse a package's package.json, or null if it isn't installed. */
function readPackageJson(name) {
  try {
    // Flat node_modules resolution is enough for this repo (no workspaces,
    // no conflicting-version nesting among the shipped deps).
    return JSON.parse(
      readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Find the license file shipped inside an installed package. */
function readLicenseText(name) {
  const dir = join(root, "node_modules", name);
  const file = readdirSync(dir).find((entry) => /^licen[cs]e/i.test(entry));
  return file ? readFileSync(join(dir, file), "utf8").trim() : null;
}

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const seeds = [...Object.keys(rootPkg.dependencies ?? {}), ...SW_BUNDLED_SEEDS];

// Walk the transitive runtime-dependency closure of the seeds.
const closure = new Map();
const queue = [...seeds];
const problems = [];
while (queue.length > 0) {
  const name = queue.shift();
  if (closure.has(name)) continue;
  const pkg = readPackageJson(name);
  if (pkg === null) {
    problems.push(`${name}: not installed — run npm install`);
    continue;
  }
  closure.set(name, pkg);
  queue.push(...Object.keys(pkg.dependencies ?? {}));
}

const blocks = [...closure.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((pkg) => {
    const licenseText = readLicenseText(pkg.name);
    if (licenseText === null) {
      problems.push(`${pkg.name}: no license file found in node_modules`);
      return "";
    }
    const homepage =
      pkg.homepage ??
      (typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository?.url);
    return [
      "=".repeat(72),
      `${pkg.name} v${pkg.version} — ${pkg.license}`,
      ...(homepage ? [homepage] : []),
      "=".repeat(72),
      "",
      licenseText,
    ].join("\n");
  });

if (problems.length > 0) {
  console.error("collect-third-party-licenses: cannot attribute all packages:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const header = [
  "Third-party software notices for Fractal Viewer",
  "",
  "This build bundles the open-source packages below. Their license",
  "notices are reproduced in full, as their licenses require.",
  "",
  "Generated at build time by scripts/collect-third-party-licenses.mjs.",
  "",
].join("\n");

writeFileSync(outFile, `${header}\n${blocks.join("\n\n")}\n`);
console.log(
  `collect-third-party-licenses: wrote ${closure.size} notices ` +
    `(${[...closure.keys()].sort().join(", ")})`,
);
