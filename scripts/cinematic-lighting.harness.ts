/**
 * Owner-review reference sheet: one camera and geometry, two light models.
 *
 * Columns are the shipped Surface finish/shadow/AO/fog model and two local
 * colored disk lights. A third column rendered those lights through bounded
 * shadowed mist until the medium was removed on its measured cost.
 * The primary marcher and normals remain the shared CPU preview, so this is
 * a design reference, not a production-browser equivalence or speed claim.
 * In particular, the legacy Balloon shadow model receives shadows from the
 * original attractor only; the new local rig sees both union terms.
 *
 * The PNGs do not award their own aesthetic pass. Geometry coverage, clear
 * cameras, non-flat 4D provenance, deterministic metadata and work counts
 * make the comparison inspectable; the owner judges depth and legibility.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/cinematic-lighting.harness.ts
 *
 * Useful draft controls: CINEMATIC_SIZE=96, CINEMATIC_SCENES=cathedral,cavern,
 * CINEMATIC_COLUMNS=legacy,lights, CINEMATIC_SURFACE_SAMPLES=4.
 * CINEMATIC_RUN names a fresh output directory under ignored scripts/out/.
 * Each panel, a labeled contact sheet, and its complete JSON manifest land
 * together. A named directory refuses overwrite to preserve review evidence.
 * The default owner render uses 256px and 8 surface samples. Independent row jobs can be
 * joined without re-rendering: CINEMATIC_COMBINE=run-a,run-b,run-c. Raw RGB
 * companions preserve exact panel bytes for the shared contact-sheet writer.
 * A separate real-geometry intervention uses
 * CINEMATIC_SCENES=portalClosed,portalOpen,portalMoved and
 * CINEMATIC_COLUMNS=lights; it never changes the default rows.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIC_SURFACE_FINISH,
  finishShadeTs,
} from "../src/fractal/surface-finish";
import {
  DEFAULT_FOG_DENSITY,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SURFACE_ENV_LIGHT,
} from "../src/app/state";
import { lightDirection } from "../src/app/voxel-material";
import { createCinematicLighting } from "./cinematic-lighting";
import {
  CINEMATIC_INTERVENTION_BUILDERS,
  CINEMATIC_SCENE_BUILDERS,
} from "./cinematic-lighting-scenes";
import type { CinematicScene } from "./cinematic-lighting-scenes";
import {
  PREVIEW_HIT,
  encodePng,
  renderPreview,
  writeLabeledContactSheet,
} from "./de-preview";
import type { PanelStats, PreviewHit, PreviewScene, Vec3 } from "./de-preview";

const SIZE = Number(process.env.CINEMATIC_SIZE ?? 256);
const SURFACE_SAMPLES = Number(process.env.CINEMATIC_SURFACE_SAMPLES ?? 8);
const VISIBILITY_STEPS = process.env.CINEMATIC_VISIBILITY_STEPS
  ? Number(process.env.CINEMATIC_VISIBILITY_STEPS)
  : undefined;
const SEED = 0x5c3e91a7;
const RUN =
  process.env.CINEMATIC_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "out",
  "cinematic-lighting",
  RUN,
);
const ALL_COLUMNS = ["legacy", "lights"] as const;
const BUILDERS = {
  ...CINEMATIC_SCENE_BUILDERS,
  ...CINEMATIC_INTERVENTION_BUILDERS,
};
type Column = (typeof ALL_COLUMNS)[number];
const columns = (process.env.CINEMATIC_COLUMNS?.split(",") ?? [
  ...ALL_COLUMNS,
]) as Column[];
const rowKeys = (process.env.CINEMATIC_SCENES?.split(",") ??
  Object.keys(CINEMATIC_SCENE_BUILDERS)) as (keyof typeof BUILDERS)[];
const names: Record<Column, string> = {
  legacy: "LEGACY LIGHT + FOG",
  lights: "COLORED LIGHTS",
};

const clamp = (n: number, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, n));
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const encoded = (c: Vec3): Vec3 => c.map((v) => Math.pow(v, 1 / 2.2)) as Vec3;

/** The settled Surface model in surface-material.ts: five DE normal probes,
 * 32 penumbra probes, finishShadeTs, then encoded-space squared-exponential
 * fog measured from visible-sphere entry. Its primary tolerance and normal
 * footprint remain the common preview's, which is disclosed in the manifest. */
function legacyShade(scene: CinematicScene, size: number) {
  const spec = scene.metadata;
  const stats = { shadowQueries: 0, aoQueries: 0, shadowBudgetExits: 0 };
  const direction = lightDirection(
    DEFAULT_SOLID_LIGHT_AZIMUTH,
    DEFAULT_SOLID_LIGHT_ELEVATION,
  ).toArray();
  const bgTop = encoded(spec.background.top);
  const bgBottom = encoded(spec.background.bottom);
  const R = spec.geometry.boundingRadius;
  const visible = spec.geometry.visibleRadius;
  const shade = (hit: PreviewHit): Vec3 => {
    const h = (1.1 / size) * spec.camera.zoom * Math.max(hit.t, 1);
    let shadow = 1;
    let ts = h * 2;
    let shadowEnded = false;
    for (let i = 0; i < 32; i++) {
      const sp = hit.p.map(
        (v, axis) => v + hit.n[axis] * h * 2 + direction[axis] * ts,
      ) as Vec3;
      const d = scene.legacyShadowDe(sp);
      stats.shadowQueries++;
      shadow = Math.min(shadow, (8 * d) / ts);
      ts += clamp(d, R * 2e-4, visible * 0.1);
      if (shadow < 0.02 || Math.hypot(...sp) > visible * 1.05) {
        shadowEnded = true;
        break;
      }
    }
    if (!shadowEnded) stats.shadowBudgetExits++;
    let occ = 0;
    let weight = 1;
    let norm = 0;
    for (let i = 1; i <= 5; i++) {
      const hh = R * 0.02 * i;
      const p = hit.p.map((v, axis) => v + hit.n[axis] * hh) as Vec3;
      occ += weight * clamp((hh - scene.de(p)) / hh);
      stats.aoQueries++;
      norm += weight;
      weight *= 0.6;
    }
    const ao = clamp(1 - (0.85 * occ) / norm);
    const col = finishShadeTs(
      spec.palette.baseSrgb,
      hit.n,
      hit.rd,
      clamp(shadow),
      ao,
      hit.bg,
      CLASSIC_SURFACE_FINISH,
      {
        lightDir: direction,
        ambient: DEFAULT_SOLID_AMBIENT,
        envStrength: DEFAULT_SURFACE_ENV_LIGHT,
        bgTop,
        bgBottom,
      },
      hit.p,
    );
    const eye = spec.camera.eye;
    const b = dot(eye, hit.rd);
    const discriminant = b * b - dot(eye, eye) + Math.pow(visible * 1.02, 2);
    const enter = Math.min(
      hit.t,
      Math.max(0, -b - (discriminant >= 0 ? Math.sqrt(discriminant) : 0)),
    );
    const fog =
      1 -
      Math.exp(
        -0.12 * Math.pow(((hit.t - enter) * DEFAULT_FOG_DENSITY) / visible, 2),
      );
    return col.map((v, axis) => v * (1 - fog) + hit.bg[axis] * fog) as Vec3;
  };
  return { shade, stats };
}

function imageStats(panel: PanelStats) {
  let sum = 0;
  let squared = 0;
  let dark = 0;
  let clipped = 0;
  for (let p = 0; p < panel.width * panel.height; p++) {
    const i = p * 3;
    const luma =
      0.2126 * panel.rgb[i] +
      0.7152 * panel.rgb[i + 1] +
      0.0722 * panel.rgb[i + 2];
    sum += luma;
    squared += luma * luma;
    if (luma < 12) dark++;
    if (Math.max(panel.rgb[i], panel.rgb[i + 1], panel.rgb[i + 2]) >= 254)
      clipped++;
  }
  const count = panel.width * panel.height;
  return {
    meanLuminanceByte: sum / count,
    luminanceStdByte: Math.sqrt(squared / count - Math.pow(sum / count, 2)),
    darkShare: dark / count,
    clippedShare: clipped / count,
    sha256: createHash("sha256").update(panel.rgb).digest("hex"),
  };
}

function shellHits(scene: CinematicScene, panel: PanelStats): number | null {
  if (!scene.shellAt || !panel.status || !panel.hitPos) return null;
  let count = 0;
  for (let p = 0; p < panel.status.length; p++) {
    if (panel.status[p] !== PREVIEW_HIT) continue;
    const i = p * 3;
    if (
      scene.shellAt([panel.hitPos[i], panel.hitPos[i + 1], panel.hitPos[i + 2]])
    )
      count++;
  }
  return count;
}

it("renders a matched, reviewable reference sheet without awarding aesthetic approval", () => {
  expect(Number.isInteger(SIZE) && SIZE >= 32 && SIZE <= 1024).toBe(true);
  expect(columns.every((c) => ALL_COLUMNS.includes(c))).toBe(true);
  expect(rowKeys.every((r) => r in BUILDERS)).toBe(true);
  if (existsSync(OUT))
    throw new Error(`refusing to overwrite review output: ${OUT}`);
  mkdirSync(OUT, { recursive: true });
  if (process.env.CINEMATIC_COMBINE) {
    combineRuns(process.env.CINEMATIC_COMBINE.split(","));
    return;
  }
  const cards: { stats: PanelStats; lines: [string, string] }[] = [];
  const rows = [];
  for (const key of rowKeys) {
    const scene = BUILDERS[key]();
    const meta = scene.metadata;
    const visibilitySteps =
      VISIBILITY_STEPS ?? (meta.dimension === 4 ? 256 : 128);
    const eyeClearance = scene.de(meta.camera.eye);
    const lightCenterClearances = meta.lights.map((light) =>
      scene.de(light.position),
    );
    expect(
      eyeClearance,
      `${meta.id}: the camera must be in DE clearance`,
    ).toBeGreaterThan(0.01);
    if (meta.dimension === 4) expect(meta.geometry.nonFlat).toBe(true);
    const panels = [];
    let reference: PanelStats | undefined;
    let shellCount: number | null = null;
    for (const column of columns) {
      const before = Date.now();
      console.log(`render ${meta.id}/${column} ${SIZE}px`);
      const legacy = column === "legacy" ? legacyShade(scene, SIZE) : undefined;
      const lighting =
        column !== "legacy"
          ? createCinematicLighting({
              de: scene.de,
              stepScale: meta.geometry.stepScale,
              lights: meta.lights,
              material: { albedo: meta.palette.baseLinear, ...meta.material },
              surfaceSamples: SURFACE_SAMPLES,
              visibility: {
                epsilon: meta.geometry.boundingRadius * 2e-4,
                maxSteps: visibilitySteps,
              },
              seed: SEED,
            })
          : undefined;
      const preview: PreviewScene = { ...scene.preview };
      if (legacy) preview.shade = legacy.shade;
      if (lighting) {
        preview.shadeLinear = lighting.shadeLinear;
        preview.rayLinear = lighting.rayLinear;
      }
      const panel = renderPreview(preview, SIZE);
      if (!reference) {
        reference = panel;
        shellCount = shellHits(scene, panel);
      } else {
        expect(panel.hits).toBe(reference.hits);
        expect(panel.exhausted).toBe(reference.exhausted);
        expect(panel.status).toEqual(reference.status);
      }
      const name = `${meta.id}-${column}.png`;
      writeFileSync(join(OUT, name), encodePng(SIZE, SIZE, panel.rgb));
      const rawName = `${meta.id}-${column}.rgb`;
      writeFileSync(join(OUT, rawName), panel.rgb);
      const metrics = {
        file: name,
        rawRgb: rawName,
        column,
        width: SIZE,
        height: SIZE,
        hits: panel.hits,
        hitShare: panel.hits / (SIZE * SIZE),
        primaryQueries: panel.evals,
        primarySteps: panel.steps,
        primaryExhausted: panel.exhausted,
        primaryExhaustedShare: panel.exhausted / (SIZE * SIZE),
        renderMs: panel.ms,
        wallMs: Date.now() - before,
        sampling: {
          surfaceSamples: column === "legacy" ? 0 : SURFACE_SAMPLES,
          visibilityMaxSteps: column === "legacy" ? 32 : visibilitySteps,
        },
        image: imageStats(panel),
        lighting: lighting?.stats ?? legacy?.stats,
      };
      panels.push(metrics);
      cards.push({
        stats: panel,
        lines: [
          names[column],
          key === "slice4"
            ? "ROTOR 4D SLICE"
            : key === "cavern"
              ? "BALLOON CAVERN"
              : key === "cathedral"
                ? "MENGER CATHEDRAL"
                : meta.title,
        ],
      });
      console.log(JSON.stringify({ scene: meta.id, ...metrics }));
      writeFileSync(
        join(OUT, "progress.json"),
        JSON.stringify({ rows, current: { fixture: meta, panels } }, null, 2),
      );
    }
    if (shellCount !== null)
      expect(
        shellCount,
        "the cavern must actually draw inverted echo walls",
      ).toBeGreaterThan(0);
    rows.push({
      fixture: meta,
      eyeClearance,
      lightCenterClearances,
      shellHits: shellCount,
      shellHitShare:
        shellCount === null || !reference?.hits
          ? null
          : shellCount / reference.hits,
      panels,
    });
  }
  const relativeSheet = join("cinematic-lighting", RUN, "contact-sheet.png");
  writeLabeledContactSheet(cards, columns.length, relativeSheet);
  const manifest = {
    schema: 1,
    run: RUN,
    reviewStatus:
      "awaiting owner judgement; this harness cannot approve appearance",
    renderer:
      "shared scripts/de-preview.ts CPU primary marcher and tetrahedral normals",
    legacy: {
      shade:
        "finishShadeTs with CLASSIC_SURFACE_FINISH and application defaults",
      shadow:
        "settled Surface 32-probe penumbra; Balloon tests original attractor only",
      ao: "settled Surface five normal probes",
      fog: "application squared-exponential visible-sphere-entry fog into per-pixel backdrop",
      limitation:
        "CPU reference primary acceptance/normal footprint differ from production; this sheet is not a browser parity gate",
    },
    sampling: {
      size: SIZE,
      seed: SEED,
      surfaceSamples: SURFACE_SAMPLES,
      visibilityMaxSteps: VISIBILITY_STEPS ?? "128 for 3D / 256 for 4D",
    },
    columns,
    contactSheet: "contact-sheet.png",
    rows,
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeReviewHtml(manifest);
  console.log(`Owner reference: ${join(OUT, "contact-sheet.png")}`);
}, 3_600_000);

/** Joining separately rendered rows cannot quietly change their sampling or
 * replace a panel. Pixel hashes verify the raw companions before stitching. */
function combineRuns(runs: string[]): void {
  const sources = runs.map((run) => {
    const directory = join(dirname(OUT), run);
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as {
      run: string;
      sampling: unknown;
      columns: Column[];
      rows: {
        fixture: { id: string; title: string };
        panels: {
          file: string;
          rawRgb: string;
          column: Column;
          width: number;
          height: number;
          hits: number;
          primaryQueries: number;
          primarySteps: number;
          primaryExhausted: number;
          renderMs: number;
          image: { sha256: string };
        }[];
      }[];
    };
    return { directory, manifest };
  });
  const first = sources[0].manifest;
  const cards: { stats: PanelStats; lines: [string, string] }[] = [];
  for (const { directory, manifest } of sources) {
    expect(manifest.columns).toEqual(first.columns);
    expect(manifest.sampling).toEqual(first.sampling);
    for (const row of manifest.rows) {
      for (const panel of row.panels) {
        const rgb = new Uint8Array(readFileSync(join(directory, panel.rawRgb)));
        expect(rgb.length).toBe(panel.width * panel.height * 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(
          panel.image.sha256,
        );
        writeFileSync(
          join(OUT, panel.file),
          readFileSync(join(directory, panel.file)),
        );
        writeFileSync(join(OUT, panel.rawRgb), rgb);
        cards.push({
          stats: {
            rgb,
            width: panel.width,
            height: panel.height,
            hits: panel.hits,
            evals: panel.primaryQueries,
            steps: panel.primarySteps,
            exhausted: panel.primaryExhausted,
            ms: panel.renderMs,
          },
          lines: [names[panel.column], row.fixture.title],
        });
      }
    }
  }
  writeLabeledContactSheet(
    cards,
    first.columns.length,
    join("cinematic-lighting", RUN, "contact-sheet.png"),
  );
  const manifest = {
    ...first,
    run: RUN,
    sourceRuns: runs,
    rows: sources.flatMap((source) => source.manifest.rows),
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeReviewHtml(manifest);
  console.log(`Combined owner reference: ${join(OUT, "contact-sheet.png")}`);
}

interface ReviewManifest {
  rows: {
    fixture: { id: string; title: string; description?: string };
    panels: {
      file: string;
      column: Column;
      width: number;
      height: number;
      hits: number;
      primaryExhausted: number;
      renderMs: number;
    }[];
  }[];
}

/** A local, self-contained index keeps the picture and its comparison labels
 * together after the console transcript has gone. Images stay lossless PNG. */
function writeReviewHtml(manifest: ReviewManifest): void {
  const escape = (s: string): string =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c] ?? c,
    );
  const headings: Record<Column, string> = {
    legacy: "Shipped lighting + fog",
    lights: "Colored key + rim",
  };
  const rows = manifest.rows
    .map(
      (row) => `<section>
    <h2>${escape(row.fixture.title)}</h2>
    <p>${escape(row.fixture.description ?? "")}</p>
    <div class="panels">${row.panels
      .map(
        (panel) => `<figure>
      <figcaption>${headings[panel.column]}</figcaption>
      <a href="${escape(panel.file)}"><img src="${escape(panel.file)}" width="${panel.width}" height="${panel.height}" alt="${escape(row.fixture.title)}: ${headings[panel.column]}"></a>
      <p class="stats">${((100 * panel.hits) / (panel.width * panel.height)).toFixed(1)}% geometry · ${panel.primaryExhausted} exhausted primary rays<br>${(panel.renderMs / 1000).toFixed(1)} s CPU reference</p>
    </figure>`,
      )
      .join("")}</div>
  </section>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cinematic Surface lighting — owner reference</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #10151b; color: #ecf0f4; }
  body { max-width: 1040px; margin: 32px auto; padding: 0 24px 48px; line-height: 1.5; }
  h1 { font-size: 26px; margin-bottom: 6px; } h2 { font-size: 19px; margin-bottom: 4px; }
  p { max-width: 900px; color: #b6c1cb; } a { color: #a4d4ff; }
  section { margin-top: 36px; border-top: 1px solid #303b45; padding-top: 12px; }
  .panels { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; flex: 0 1 320px; } figcaption { font-weight: 650; margin-bottom: 8px; }
  img { display: block; width: 100%; height: auto; border: 1px solid #36414b; }
  .stats { font-size: 12px; margin-top: 7px; } .note { padding: 14px 18px; background: #19232d; border-radius: 6px; }
</style>
<h1>Cinematic Surface lighting</h1>
<p>Matched cameras, palettes and real DE geometry. Review depth, surface legibility and visual impact; an aesthetic verdict has not been recorded.</p>
<p><a href="contact-sheet.png">Labeled contact sheet</a> · <a href="manifest.json">Saved fixtures and complete measurements</a></p>
<p class="note">The baseline uses the app’s classic finish, light, five-tap ambient occlusion, shadow and depth-fog formulas through the shared CPU marcher. Primary acceptance and normals follow that reference marcher. Production browser, GPU cost and capture qualification remain separate work. CPU times are descriptive and may include concurrent rendering; the manifest records bounded visibility work and unresolved rays.</p>
${rows}
</html>`;
  writeFileSync(join(OUT, "review.html"), html);
}
