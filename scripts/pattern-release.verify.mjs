#!/usr/bin/env node
/**
 * Production-browser release evidence for patterned Surface materials.
 *
 * `--phase=preflight` measures the deliberately untrusted hero calibration
 * candidates and emits a ready-calibration file only when every 1x/64x,
 * compute/WebGL, and 4D-slice cell has enough real object interior and zero
 * exhausted rays. `--phase=machine` consumes that file, renders the complete
 * 128-cell hero matrix plus compatibility routes, evaluates effect maps and
 * engine parity, and emits blinded review decks only after the numeric gate
 * passes. Human responses are never synthesized; score them separately with
 * `pattern-release-review-score.ts`.
 */

import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  analyzePatternEffect,
  comparePatternEffectEngines,
  erodePatternEffectMask,
  measurePatternEffectVarianceRetention,
  PATTERN_EFFECT_THRESHOLDS,
  patternEffectEligibilityMask,
  patternEffectObjectMask,
} from "../src/fractal/pattern-effect-metrics.ts";
import {
  buildCompatibilityFixtures,
  buildHeroCalibrationPreflight,
  buildReleaseHeroMatrix,
  decodeSceneHash,
  HERO_CALIBRATION_CANDIDATES,
  runFixtureSelfCheck,
  withCameraPose,
  withFourDSlice,
  withGroundPlaneDisabled,
  withPatternFamily,
} from "./pattern-release-fixtures.mjs";
import {
  createRunDirectory,
  decodePng,
  encodeMetricPngs,
  makeLabeledSheet,
  readRunArtifact,
  sha256,
  writeRunArtifact,
} from "./lib/pattern-release-artifacts.mjs";
import {
  assertSurfaceRefusal,
  captureSettledSurface,
  launchSurfaceBrowser,
  mintPersistedSurfacePose,
  RELEASE_DEVICE_SCALE_FACTOR,
  RELEASE_SETTLE_STAGE,
  RELEASE_VIEWPORT,
  SurfaceBrowserCheckingError,
} from "./lib/surface-browser-runner.mjs";

const execFile = promisify(execFileCallback);
const DEFAULT_OUT_ROOT = path.resolve("scripts/out");
const COMPATIBILITY_FAMILIES = Object.freeze({
  lens3: "wood",
  escape3: "strata",
  bulb3: "marble",
  kaleido4: "wood",
  fold4: "strata",
  escape4: "marble",
  balloon3: "wood",
  lut3: "marble",
  byTransform3: "strata",
});

function parseArgs(argv) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "Z");
  const args = {
    phase: "preflight",
    mode: "x11::0",
    url: "",
    outRoot: DEFAULT_OUT_ROOT,
    runId: `pattern-release-${timestamp}`,
    calibrations: "",
    onlyHero: "",
    timeout: 600_000,
  };
  for (const raw of argv) {
    const match = /^--([A-Za-z][A-Za-z0-9-]*)=(.*)$/.exec(raw);
    if (!match) throw new Error(`unknown argument ${raw}`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    if (!(key in args)) throw new Error(`unknown argument --${match[1]}`);
    args[key] = key === "timeout" ? Number(match[2]) : match[2];
  }
  if (!new Set(["preflight", "machine", "self-check"]).has(args.phase)) {
    throw new Error("--phase must be preflight, machine, or self-check");
  }
  if (args.mode !== "sw" && !/^x11:.+/.test(args.mode)) {
    throw new Error("--mode must be sw or x11:<display>");
  }
  if (!Number.isFinite(args.timeout) || args.timeout < 30_000) {
    throw new Error("--timeout must be at least 30000ms");
  }
  if (args.phase === "machine" && !args.calibrations) {
    throw new Error(
      "--phase=machine requires --calibrations=<preflight calibrations.json>",
    );
  }
  if (
    args.onlyHero &&
    (args.phase !== "preflight" ||
      !Object.hasOwn(HERO_CALIBRATION_CANDIDATES, args.onlyHero))
  ) {
    throw new Error(
      "--only-hero is a preflight diagnostic and must name affine3, fold3, or affine4",
    );
  }
  args.outRoot = path.resolve(args.outRoot);
  args.release = args.mode.startsWith("x11:");
  return args;
}

function safeStem(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

function countMask(mask) {
  let count = 0;
  for (const value of mask) count += value ? 1 : 0;
  return count;
}

function unionExclusions(...groups) {
  const seen = new Set();
  const result = [];
  for (const exclusion of groups.flat()) {
    const normalized = {
      x: exclusion.x,
      y: exclusion.y,
      width: exclusion.width ?? exclusion.w,
      height: exclusion.height ?? exclusion.h,
    };
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function plainCoverage(image, exclusions) {
  const eligibleMask = patternEffectEligibilityMask(
    image.width,
    image.height,
    exclusions,
  );
  const objectMask = patternEffectObjectMask(image, eligibleMask);
  const interiorMask = erodePatternEffectMask(
    objectMask,
    eligibleMask,
    image.width,
    image.height,
  );
  const eligibleCount = countMask(eligibleMask);
  const objectCount = countMask(objectMask);
  const interiorCount = countMask(interiorMask);
  return {
    eligibleMask,
    objectMask,
    interiorMask,
    effectMask: new Uint8Array(image.width * image.height),
    effect: new Float64Array(image.width * image.height),
    width: image.width,
    height: image.height,
    eligibleCount,
    objectCount,
    interiorCount,
    rawObjectShare: eligibleCount > 0 ? objectCount / eligibleCount : 0,
    pass:
      eligibleCount > 0 &&
      objectCount / eligibleCount >=
        PATTERN_EFFECT_THRESHOLDS.coverage.minimumRawObjectShare &&
      interiorCount >= PATTERN_EFFECT_THRESHOLDS.coverage.minimumInteriorPixels,
  };
}

function captureSummary(cell, capture, artifact) {
  const document = decodeSceneHash(cell.documentHash);
  return {
    id: cell.id,
    heroId: cell.heroId ?? null,
    fixtureId: cell.fixtureId ?? null,
    family: cell.family,
    zoom: cell.zoom ?? 1,
    sliceCenter: cell.sliceCenter ?? null,
    documentHash: cell.documentHash,
    documentSha256: sha256(cell.documentHash),
    pose: {
      camera: document.camera ?? null,
      fourD: document.fourD ?? null,
    },
    stage: capture.stage,
    engine: capture.engine,
    backend: capture.backend,
    census: capture.census,
    elapsedMs: capture.elapsedMs,
    overlays: capture.geometry.overlays,
    artifact,
  };
}

function analysisSummary(analysis) {
  return {
    coverage: analysis.coverage,
    effectCount: analysis.effectCount,
    effectShare: analysis.effectShare,
    metrics: analysis.metrics,
    scalars: analysis.scalars,
    gates: analysis.gates,
  };
}

function jsonArtifact(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requestReady(url) {
  return new Promise((resolve) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false },
      (response) => {
        response.resume();
        resolve(response.statusCode !== undefined && response.statusCode < 500);
      },
    );
    request.on("error", () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function startOwnedPreview(explicitUrl) {
  if (explicitUrl) return { url: explicitUrl, process: null };
  const url = "https://localhost:4173";
  if (await requestReady(url)) return { url, process: null };
  const child = spawn(
    "npm",
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"],
    { stdio: ["ignore", "pipe", "pipe"], detached: false },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new SurfaceBrowserCheckingError(
        `owned preview exited ${String(child.exitCode)}: ${output.trim()}`,
      );
    }
    if (await requestReady(url)) return { url, process: child };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new SurfaceBrowserCheckingError("owned preview did not become ready");
}

async function stopOwnedPreview(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function gitSha() {
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"]);
  return stdout.trim();
}

async function makeAnalysisPage(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto("about:blank");
  return { context, page };
}

async function writeMetricArtifacts(page, runDirectory, stem, analysis) {
  const images = await encodeMetricPngs(page, analysis);
  const artifacts = {};
  for (const [kind, png] of Object.entries(images)) {
    const directory = kind === "effect" ? "effects" : "masks";
    artifacts[kind] = await writeRunArtifact(
      runDirectory,
      `${directory}/${stem}-${kind}.png`,
      png,
    );
  }
  return artifacts;
}

async function captureCell(browser, page, args, runDirectory, cell, category) {
  const logPrefix = `[pattern-release] ${cell.id}`;
  console.error(`${logPrefix}: ${cell.engine} settle`);
  const capture = await captureSettledSurface(browser, {
    url: args.url,
    hash: cell.documentHash,
    engine: cell.engine,
    timeoutMs: args.timeout,
    release: args.release,
    log: (line) => console.error(`${logPrefix}: ${line}`),
  });
  if (capture.census.exhausted !== 0) {
    throw new Error(
      `${cell.id}: ${String(capture.census.exhausted)} exhausted rays`,
    );
  }
  if (
    capture.census.rays !==
    RELEASE_VIEWPORT.width * RELEASE_VIEWPORT.height
  ) {
    throw new Error(`${cell.id}: census raster is not 960x540`);
  }
  const stem = safeStem(cell.id);
  const artifact = await writeRunArtifact(
    runDirectory,
    `raw/${category}-${stem}.png`,
    capture.png,
  );
  const image = await decodePng(page, capture.png);
  return {
    capture,
    image,
    artifact,
    summary: captureSummary(cell, capture, artifact),
  };
}

function readyCalibrationFromMint(candidate, baseHash, runId, captures) {
  return {
    status: "ready",
    baseHash,
    provenance: candidate.provenance,
    preflightRunId: runId,
    preflightCaptureIds: captures.map((capture) => capture.id),
  };
}

async function runPreflight(
  browser,
  analysisPage,
  args,
  runDirectory,
  baseManifest,
) {
  const fullSchedule = buildHeroCalibrationPreflight();
  const schedule = args.onlyHero
    ? fullSchedule.filter((cell) => cell.heroId === args.onlyHero)
    : fullSchedule;
  const minted = {};
  for (const candidate of Object.values(HERO_CALIBRATION_CANDIDATES)) {
    if (args.onlyHero && candidate.heroId !== args.onlyHero) continue;
    minted[candidate.heroId] = await mintPersistedSurfacePose(browser, {
      url: args.url,
      hash: candidate.baseHash,
    });
  }
  const results = [];
  const failures = [];
  for (const planned of schedule) {
    const baseHash = minted[planned.heroId];
    const base = decodeSceneHash(baseHash);
    let documentHash = withGroundPlaneDisabled(baseHash);
    documentHash = withCameraPose(documentHash, {
      ...base.camera,
      target: [...base.camera.target],
      radius: 96 / planned.zoom,
    });
    if (planned.sliceCenter !== null) {
      documentHash = withFourDSlice(documentHash, planned.sliceCenter);
    }
    const cell = { ...planned, documentHash };
    const result = await captureCell(
      browser,
      analysisPage,
      args,
      runDirectory,
      cell,
      "preflight",
    );
    const exclusions = unionExclusions(result.capture.geometry.overlays);
    const coverage = plainCoverage(result.image, exclusions);
    const masks = await writeMetricArtifacts(
      analysisPage,
      runDirectory,
      `preflight-${safeStem(cell.id)}`,
      coverage,
    );
    const pass = coverage.pass && result.capture.census.exhausted === 0;
    if (!pass) {
      failures.push(
        `${cell.id}: object ${(coverage.rawObjectShare * 100).toFixed(2)}%, interior ${String(coverage.interiorCount)}, exhausted ${String(result.capture.census.exhausted)}`,
      );
    }
    results.push({
      ...result.summary,
      coverage: {
        eligibleCount: coverage.eligibleCount,
        objectCount: coverage.objectCount,
        rawObjectShare: coverage.rawObjectShare,
        interiorCount: coverage.interiorCount,
        pass: coverage.pass,
      },
      masks,
      pass,
    });
  }
  const pass = failures.length === 0;
  const calibrations = {};
  if (pass && !args.onlyHero) {
    for (const candidate of Object.values(HERO_CALIBRATION_CANDIDATES)) {
      calibrations[candidate.heroId] = readyCalibrationFromMint(
        candidate,
        minted[candidate.heroId],
        args.runId,
        results.filter((result) => result.heroId === candidate.heroId),
      );
    }
  }
  const manifest = {
    ...baseManifest,
    phase: "preflight",
    status: pass ? (args.onlyHero ? "diagnostic-pass" : "pass") : "fail",
    diagnosticHero: args.onlyHero || null,
    thresholds: PATTERN_EFFECT_THRESHOLDS,
    candidates: HERO_CALIBRATION_CANDIDATES,
    captures: results,
    failures,
    calibrations: pass && !args.onlyHero ? calibrations : null,
  };
  await writeRunArtifact(runDirectory, "manifest.json", jsonArtifact(manifest));
  if (pass && !args.onlyHero) {
    const artifact = await writeRunArtifact(
      runDirectory,
      "calibrations.json",
      jsonArtifact({
        schema: 1,
        runId: args.runId,
        gitSha: baseManifest.gitSha,
        thresholdVersion: PATTERN_EFFECT_THRESHOLDS.version,
        calibrations,
      }),
    );
    console.error(`[pattern-release] PREFLIGHT PASS: ${artifact.file}`);
  } else if (!pass) {
    console.error("[pattern-release] PREFLIGHT FAIL");
    for (const failure of failures) console.error(`  ${failure}`);
  } else console.error(`[pattern-release] DIAGNOSTIC PASS: ${args.onlyHero}`);
  return pass;
}

function groupHeroCells(cells) {
  const groups = new Map();
  for (const cell of cells) {
    const key = JSON.stringify([cell.heroId, cell.sliceCenter, cell.zoom]);
    const group = groups.get(key) ?? [];
    group.push(cell);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function patternCell(group, engine, family) {
  const cell = group.find(
    (candidate) => candidate.engine === engine && candidate.family === family,
  );
  if (!cell) throw new Error(`hero group lacks ${engine}/${family}`);
  return cell;
}

async function renderPatternPair(
  browser,
  analysisPage,
  args,
  runDirectory,
  plain,
  cell,
  category,
) {
  const patterned = await captureCell(
    browser,
    analysisPage,
    args,
    runDirectory,
    cell,
    category,
  );
  const exclusions = unionExclusions(
    plain.capture.geometry.overlays,
    patterned.capture.geometry.overlays,
  );
  const analysis = analyzePatternEffect(
    plain.image,
    patterned.image,
    exclusions,
  );
  const metricArtifacts = await writeMetricArtifacts(
    analysisPage,
    runDirectory,
    `${category}-${safeStem(cell.id)}`,
    analysis,
  );
  return { patterned, analysis, metricArtifacts };
}

function heroSheetKey(cell, kind) {
  return JSON.stringify([
    kind,
    cell.heroId,
    cell.sliceCenter,
    cell.engine,
    cell.family,
  ]);
}

function addSheetCard(sheets, key, card) {
  const cards = sheets.get(key) ?? [];
  cards.push(card);
  sheets.set(key, cards);
}

async function writeHeroSheets(page, runDirectory, sheets) {
  const artifacts = [];
  for (const [key, cards] of sheets) {
    cards.sort((a, b) => a.zoom - b.zoom);
    const [kind, hero, slice, engine, family] = JSON.parse(key);
    const png = await makeLabeledSheet(
      page,
      cards.map((card) => ({
        png: card.png,
        lines: [
          `${hero} ${family} ${card.zoom}x`,
          `${engine} slice=${String(slice)}`,
        ],
      })),
      4,
    );
    artifacts.push(
      await writeRunArtifact(
        runDirectory,
        `sheets/${safeStem(`${kind}-${hero}-${slice}-${engine}-${family}`)}.png`,
        png,
      ),
    );
  }
  return artifacts;
}

async function renderHeroes(
  browser,
  analysisPage,
  args,
  runDirectory,
  cells,
  failures,
) {
  const captures = [];
  const effects = [];
  const parity = [];
  const ladders = new Map();
  const sheets = new Map();
  const reviewHeroes = [];
  for (const group of groupHeroCells(cells)) {
    const engines = [...new Set(group.map((cell) => cell.engine))];
    const plains = {};
    for (const engine of engines) {
      const cell = patternCell(group, engine, "none");
      plains[engine] = await captureCell(
        browser,
        analysisPage,
        args,
        runDirectory,
        cell,
        "hero",
      );
      captures.push(plains[engine].summary);
      addSheetCard(sheets, heroSheetKey(cell, "beauty"), {
        zoom: cell.zoom,
        png: plains[engine].capture.png,
      });
    }
    for (const family of ["wood", "marble", "strata"]) {
      const byEngine = {};
      for (const engine of engines) {
        const cell = patternCell(group, engine, family);
        const result = await renderPatternPair(
          browser,
          analysisPage,
          args,
          runDirectory,
          plains[engine],
          cell,
          "hero",
        );
        byEngine[engine] = result;
        captures.push(result.patterned.summary);
        effects.push({
          id: cell.id,
          engine,
          metrics: analysisSummary(result.analysis),
          artifacts: result.metricArtifacts,
        });
        if (!result.analysis.gates.pass) {
          failures.push(`${cell.id}: effect metric gate failed`);
        }
        const ladderKey = JSON.stringify([
          cell.heroId,
          cell.sliceCenter,
          engine,
          family,
        ]);
        const ladder = ladders.get(ladderKey) ?? [];
        ladder.push({
          zoom: cell.zoom,
          variance: result.analysis.metrics.residualVariance,
        });
        ladders.set(ladderKey, ladder);
        addSheetCard(sheets, heroSheetKey(cell, "beauty"), {
          zoom: cell.zoom,
          png: result.patterned.capture.png,
        });
        const effectPng = await readRunArtifact(
          runDirectory,
          result.metricArtifacts.effect.relative,
        );
        addSheetCard(sheets, heroSheetKey(cell, "effect"), {
          zoom: cell.zoom,
          png: effectPng,
        });
        if (
          engine === "compute" &&
          cell.zoom === 1 &&
          (cell.sliceCenter === null || cell.sliceCenter === 0)
        ) {
          reviewHeroes.push({
            system: cell.heroId,
            kind: family,
            png: result.patterned.capture.png,
          });
        }
      }
      if (byEngine.compute && byEngine.webgl) {
        const comparison = comparePatternEffectEngines(
          byEngine.compute.analysis,
          byEngine.webgl.analysis,
        );
        parity.push({
          heroId: group[0].heroId,
          sliceCenter: group[0].sliceCenter,
          zoom: group[0].zoom,
          family,
          ...comparison,
        });
        if (!comparison.gates.pass) {
          failures.push(
            `${group[0].heroId}/${family}/${String(group[0].zoom)}x/slice-${String(group[0].sliceCenter)}: engine parity failed`,
          );
        }
      }
    }
  }

  const retention = [];
  for (const [key, entries] of ladders) {
    entries.sort((a, b) => a.zoom - b.zoom);
    const measured = measurePatternEffectVarianceRetention(
      entries.map((entry) => entry.variance),
    );
    const [heroId, sliceCenter, engine, family] = JSON.parse(key);
    retention.push({
      heroId,
      sliceCenter,
      engine,
      family,
      entries,
      ...measured,
    });
    if (!measured.pass) {
      failures.push(
        `${heroId}/${engine}/${family}/slice-${String(sliceCenter)}: variance retention failed`,
      );
    }
  }
  const sheetArtifacts = await writeHeroSheets(
    analysisPage,
    runDirectory,
    sheets,
  );
  return { captures, effects, parity, retention, sheetArtifacts, reviewHeroes };
}

async function renderCompatibility(
  browser,
  analysisPage,
  args,
  runDirectory,
  failures,
) {
  const inventory = buildCompatibilityFixtures().filter((fixture) =>
    Object.hasOwn(COMPATIBILITY_FAMILIES, fixture.id),
  );
  const captures = [];
  const effects = [];
  const parity = [];
  const refusals = [];
  for (const fixture of inventory) {
    const family = COMPATIBILITY_FAMILIES[fixture.id];
    const pinnedBase = await mintPersistedSurfacePose(browser, {
      url: args.url,
      hash: fixture.documentHash,
    });
    const baseHash = withPatternFamily(
      withGroundPlaneDisabled(pinnedBase),
      "none",
    );
    const patternHash = withPatternFamily(baseHash, family);
    const byEngine = {};
    for (const arm of fixture.arms) {
      if (arm.expectation === "refusal") {
        const refusal = await assertSurfaceRefusal(browser, {
          url: args.url,
          hash: patternHash,
          engine: arm.engine,
        });
        refusals.push({
          fixtureId: fixture.id,
          engine: arm.engine,
          ...refusal,
        });
        continue;
      }
      const common = {
        fixtureId: fixture.id,
        heroId: null,
        routeId: fixture.routeId,
        engine: arm.engine,
        zoom: 1,
        sliceCenter: decodeSceneHash(baseHash).fourD?.sliceCenter ?? null,
      };
      const plain = await captureCell(
        browser,
        analysisPage,
        args,
        runDirectory,
        {
          ...common,
          id: `compat/${fixture.id}/${arm.engine}/none`,
          family: "none",
          documentHash: baseHash,
        },
        "compat",
      );
      const cell = {
        ...common,
        id: `compat/${fixture.id}/${arm.engine}/${family}`,
        family,
        documentHash: patternHash,
      };
      const result = await renderPatternPair(
        browser,
        analysisPage,
        args,
        runDirectory,
        plain,
        cell,
        "compat",
      );
      captures.push(plain.summary, result.patterned.summary);
      effects.push({
        fixtureId: fixture.id,
        engine: arm.engine,
        family,
        metrics: analysisSummary(result.analysis),
        artifacts: result.metricArtifacts,
      });
      if (
        !result.analysis.gates.rawObjectShare ||
        !result.analysis.gates.interiorCount ||
        result.analysis.effectCount === 0
      ) {
        failures.push(
          `${fixture.id}/${arm.engine}: compatibility visibility/coverage failed`,
        );
      }
      byEngine[arm.engine] = result.analysis;
    }
    if (byEngine.compute && byEngine.webgl) {
      const comparison = comparePatternEffectEngines(
        byEngine.compute,
        byEngine.webgl,
      );
      parity.push({ fixtureId: fixture.id, family, ...comparison });
      if (!comparison.gates.pass) {
        failures.push(`${fixture.id}: compatibility engine parity failed`);
      }
    }
  }
  return { captures, effects, parity, refusals };
}

function reviewOrder(runId, deckId, hero) {
  return sha256(`${runId}:${deckId}:${hero.system}:${hero.kind}`);
}

async function emitReviewDecks(page, runDirectory, runId, reviewHeroes) {
  if (reviewHeroes.length !== 9) {
    throw new Error(
      `review gate needs exactly nine heroes, got ${String(reviewHeroes.length)}`,
    );
  }
  const choices = [
    "Wood",
    "Marble",
    "Strata",
    "Noise-corrosion",
    "Plain-other",
  ];
  const unblinded = await makeLabeledSheet(
    page,
    [...reviewHeroes]
      .sort(
        (a, b) =>
          a.system.localeCompare(b.system) || a.kind.localeCompare(b.kind),
      )
      .map((hero) => ({ png: hero.png, lines: [hero.kind, hero.system] })),
    3,
  );
  const diagnostic = await writeRunArtifact(
    runDirectory,
    "review/review-heroes-unblinded.png",
    unblinded,
  );
  const keyDecks = [];
  const resultDecks = [];
  const decks = [];
  const signatures = new Set();
  for (let index = 1; index <= 5; index++) {
    const deckId = `reviewer-${String(index).padStart(2, "0")}`;
    const cards = [...reviewHeroes]
      .sort((a, b) =>
        reviewOrder(runId, deckId, a).localeCompare(
          reviewOrder(runId, deckId, b),
        ),
      )
      .map((hero, cardIndex) => ({
        ...hero,
        card: `CARD ${String(cardIndex + 1).padStart(2, "0")}`,
      }));
    const signature = cards
      .map((card) => `${card.system}:${card.kind}`)
      .join("|");
    if (signatures.has(signature))
      throw new Error("review deck permutations collided");
    signatures.add(signature);
    const png = await makeLabeledSheet(
      page,
      cards.map((card) => ({
        png: card.png,
        lines: [card.card, "CHOICE + CONFIDENCE 1-5"],
      })),
      3,
    );
    const artifact = await writeRunArtifact(
      runDirectory,
      `review/review-deck-${String(index).padStart(2, "0")}.png`,
      png,
    );
    decks.push({ deckId, artifact });
    keyDecks.push({
      deckId,
      cards: cards.map((card) => ({
        card: card.card,
        expected: card.kind,
        system: card.system,
      })),
    });
    resultDecks.push({
      reviewerId: deckId,
      deckId,
      responses: cards.map((card) => ({
        card: card.card,
        choice: null,
        confidence: null,
      })),
    });
  }
  const key = await writeRunArtifact(
    runDirectory,
    "review/review-key.json",
    jsonArtifact({ schema: 2, runId, decks: keyDecks }),
  );
  const template = await writeRunArtifact(
    runDirectory,
    "review/review-results.template.json",
    jsonArtifact({
      schema: 2,
      runId,
      status: "pending",
      instructions:
        "Judge surface material only. Choose exactly one listed choice and confidence 1..5.",
      choices,
      reviewers: resultDecks,
    }),
  );
  return {
    status: "pending external blinded review",
    reviewersRequired: 5,
    cardsPerReviewer: 9,
    heroRule: "at least 4/5 correct with median confidence >=3",
    aggregateRule: "at least 80% correct",
    diagnostic,
    decks,
    key,
    resultsTemplate: template,
  };
}

async function runMachine(
  browser,
  analysisPage,
  args,
  runDirectory,
  baseManifest,
) {
  const calibrationInput = JSON.parse(
    await readFile(args.calibrations, "utf8"),
  );
  if (calibrationInput.gitSha !== baseManifest.gitSha) {
    throw new SurfaceBrowserCheckingError(
      `calibration git SHA ${String(calibrationInput.gitSha)} does not match ${baseManifest.gitSha}`,
    );
  }
  if (calibrationInput.thresholdVersion !== PATTERN_EFFECT_THRESHOLDS.version) {
    throw new SurfaceBrowserCheckingError(
      "calibration threshold version is stale",
    );
  }
  const cells = buildReleaseHeroMatrix({
    calibrations: calibrationInput.calibrations,
  });
  const failures = [];
  const hero = await renderHeroes(
    browser,
    analysisPage,
    args,
    runDirectory,
    cells,
    failures,
  );
  const compatibility = await renderCompatibility(
    browser,
    analysisPage,
    args,
    runDirectory,
    failures,
  );
  const machinePass = failures.length === 0;
  const review =
    machinePass && args.release
      ? await emitReviewDecks(
          analysisPage,
          runDirectory,
          args.runId,
          hero.reviewHeroes,
        )
      : {
          status: machinePass
            ? "not emitted from a software diagnostic run"
            : "not emitted; machine gate failed",
        };
  const manifest = {
    ...baseManifest,
    phase: "machine",
    status: machinePass ? "pass" : "fail",
    releaseStatus: machinePass
      ? args.release
        ? "machine pass; external blinded review pending"
        : "diagnostic only; real-driver run required"
      : "refused",
    thresholds: PATTERN_EFFECT_THRESHOLDS,
    calibration: {
      file: path.resolve(args.calibrations),
      sha256: sha256(await readFile(args.calibrations)),
      runId: calibrationInput.runId,
    },
    hero: {
      captures: hero.captures,
      effects: hero.effects,
      parity: hero.parity,
      varianceRetention: hero.retention,
      sheets: hero.sheetArtifacts,
      attachment: {
        status: "evidence emitted; no invented numeric swim threshold",
        invariant:
          "hero variants change only persisted camera.radius, family, and declared slice center; target/theta/phi and rotor stay fixed",
        zoomSheets: hero.sheetArtifacts,
        thresholds: PATTERN_EFFECT_THRESHOLDS.attachmentMeasurements,
      },
    },
    compatibility,
    review,
    failures,
  };
  await writeRunArtifact(runDirectory, "manifest.json", jsonArtifact(manifest));
  if (!machinePass) {
    console.error("[pattern-release] MACHINE FAIL");
    for (const failure of failures) console.error(`  ${failure}`);
  } else if (args.release) {
    console.error(
      "[pattern-release] MACHINE PASS — five-reviewer blinded semantic gate remains pending",
    );
  } else {
    console.error(
      "[pattern-release] DIAGNOSTIC PASS — rerun on x11 real driver before review",
    );
  }
  return machinePass;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureCheck = runFixtureSelfCheck();
  if (args.phase === "self-check") {
    console.log(
      JSON.stringify(
        { fixtures: fixtureCheck, thresholds: PATTERN_EFFECT_THRESHOLDS },
        null,
        2,
      ),
    );
    return;
  }
  const preview = await startOwnedPreview(args.url);
  args.url = preview.url;
  let browser;
  let analysisContext;
  try {
    const runDirectory = await createRunDirectory(args.outRoot, args.runId);
    const sha = await gitSha();
    const baseManifest = {
      schema: 1,
      runId: args.runId,
      generatedAt: new Date().toISOString(),
      gitSha: sha,
      mode: args.mode,
      realDriverRequired: true,
      releaseEligible: args.release,
      url: args.url,
      capture: {
        ...RELEASE_VIEWPORT,
        deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
        stage: RELEASE_SETTLE_STAGE,
      },
      thresholdVersion: PATTERN_EFFECT_THRESHOLDS.version,
      fixtureSelfCheck: fixtureCheck,
    };
    browser = await launchSurfaceBrowser(args.mode);
    const analysis = await makeAnalysisPage(browser);
    analysisContext = analysis.context;
    const pass =
      args.phase === "preflight"
        ? await runPreflight(
            browser,
            analysis.page,
            args,
            runDirectory,
            baseManifest,
          )
        : await runMachine(
            browser,
            analysis.page,
            args,
            runDirectory,
            baseManifest,
          );
    if (!pass) process.exitCode = 1;
    if (pass && !args.release) process.exitCode = 2;
  } finally {
    await analysisContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await stopOwnedPreview(preview.process);
  }
}

main().catch((error) => {
  const prefix =
    error instanceof SurfaceBrowserCheckingError
      ? "CHECKING FAILURE"
      : "UNEXPECTED FAILURE";
  console.error(`[pattern-release] ${prefix}: ${error.stack ?? error.message}`);
  process.exitCode = error instanceof SurfaceBrowserCheckingError ? 2 : 1;
});
