// @vitest-environment jsdom
/**
 * The flame-render fidelity differential, over Electric Sheep genomes: how
 * much of "our flame renders look worse than reference flam3 output" survives
 * once a genome uses ONLY what we implement? Three legs, one runnable sheet.
 *
 * LEG A — corpus filter + variation frequency (needs only the corpus). A
 *   seeded sample of genomes goes through `decodeFlameFile` — the production
 *   import trust boundary — and CLEAN means exactly "imported with an empty
 *   warning set": only variations and xform features we implement, no
 *   dropped post, nothing else approximated. The filter cannot drift from
 *   the importer because it IS the importer. (decodeFlameFile's warning and
 *   ignored-attribute sets are FILE-SCOPED — one bad genome poisons a
 *   multi-genome file — so the sheet keeps the corpus one-genome-per-file: it
 *   extracts the single `<flame>` element out of each `<pick>` wrapper and
 *   feeds that alone.) The frequency table of ignored attributes — the
 *   unimplemented variations and their parameter attributes — is the
 *   headline deliverable for the variation-shortlist decision. The
 *   per-genome attribute scan is sheet-side (a restated copy of the
 *   importer's known-attribute list, which can only mislabel the TABLE, never
 *   admit a genome) and is CROSS-CHECKED against the importer's own
 *   aggregated warning: every name it lists must be classified unimplemented
 *   by the scan; the mismatch count is reported.
 *
 * LEG B — paired renders (needs flam3-render). Up to 12 clean genomes, both
 *   sides 320x180 at equalized quality (flam3 sample_density 10 = 10
 *   samples/px; ours 10*320*180 = 576,000 iterations). The cohort is the
 *   sample's clean genomes, then — because this corpus's measured clean
 *   fraction is far under one percent, a plain 200-sample yields about ONE
 *   pair — a deterministic TOP-UP pass continues the SAME seeded shuffle past
 *   the sample until MAX_PAIRS exist, capped (TOPUP_CAP, FLAME_DIFF_TOPUP
 *   env override; 0 disables) and disclosed per genome with a `[topup]` tag.
 *   Leg A's frequency tables stay a pure sample statistic; top-ups feed the
 *   cohort and the clean-fraction denominator only. flam3 renders the
 *   ORIGINAL genome through
 *
 *     LD_LIBRARY_PATH=<libdir> flam3_palettes=<palettes.xml> \
 *       in=<genome> prefix=<p> format=png quality=10 ss=1 seed=1 \
 *       isaac_seed=abc <flam3-render>
 *
 *   (flam3 3.x takes NO CLI flags — everything is environment variables and
 *   the genome path, run with cwd = where the PNG lands, writing
 *   `<prefix>00000.png`) with the temp copy's `size` rewritten to "320 180",
 *   its `scale` attribute rescaled by the same width ratio (pixels-per-unit
 *   is ABSOLUTE, so rescaling preserves the genome's own composition), and
 *   `quality` rewritten IN THE GENOME — measured: a quality=160 genome under
 *   a quality=2 env var still spent the q160 cost, so the env var does not
 *   override the attribute and the rewrite is the authoritative control. The
 *   corpus PNGs decode through the sheet's own minimal 8-bit decoder. Ours
 *   renders the imported scene through the production CPU path:
 *   prepareChaosGame -> accumulateFlame -> adaptiveDownsampleFlame at the
 *   imported estimator params -> tonemapFlame at the imported
 *   exposure/gamma/vibrancy, with gammaThreshold pinned to
 *   DEFAULT_GAMMA_THRESHOLD (the app never imports flam3's gamma_threshold).
 *   Diff = mean |RGB-8bit| over all pixels, plus each side's lit fraction;
 *   the contact sheet lays ours | flam3 | |diff|x4.
 *
 *   DISCLOSED RESIDUALS — the parts the numbers cannot remove, stated
 *   plainly: (1) FRAMING. flam3 renders the genome's own center/scale; our
 *   side re-fits a chaos-game probe's trimmed bounds to ~80% of the frame's
 *   short side (flame-file.ts does not import center/scale — the app re-fits
 *   every imported flame — so the probe fit IS our production framing, and
 *   the framing difference is INSIDE the MAD by construction). (2) TONE
 *   PIPELINE — flam3's spatial filter and density estimation are its own;
 *   ours are ours. (3) RNG — seeds are pinned per side but never
 *   point-comparable; every number here is image-statistical.
 *
 * LEG C — noise-floor ladder (corpus only; flam3 adds a second curve). One
 *   fixed clean genome at budgets {0.25x, 1x, 4x, 16x} of the base iteration
 *   count, each MAD'd against the SAME side's 64x reference. All runs share
 *   ONE seed per side, so lower budgets are sample-prefixes of higher ones:
 *   the ladder reads as convergence-to-own-reference, identically defined on
 *   both sides and never compared across them. The flam3 side rewrites the
 *   genome's quality per rung for the reason measured above.
 *
 * PROVISIONING (both EPHEMERAL under /tmp/opencode, which may be wiped
 *   between sessions — the sheet detects absence and SKIPS the affected legs
 *   with a note, never fails):
 *
 *   flam3:  cd /tmp/opencode/flam3-deb && apt-get download flam3-utils \
 *             libflam3-0 flam3-palette && \
 *           for f in *.deb; do dpkg-deb -x "$f" root; done
 *   corpus: git clone --depth 1 \
 *             https://github.com/Yuiry-IV/flam3_xml_output \
 *             /tmp/opencode/flam3_xml_output
 *
 *   Env overrides: FLAME_DIFF_CORPUS, FLAME_DIFF_SAMPLE, FLAME_DIFF_OUT,
 *   FLAME_DIFF_TOPUP, FLAME_DIFF_FLAM3_BIN, FLAME_DIFF_FLAM3_LIBDIR,
 *   FLAME_DIFF_FLAM3_PALETTES.
 *
 * flam3 PNG output facts (verified on this corpus, flam3 3.1.1): 8-bit,
 *   non-interlaced, RGBA (color type 6), black background at alpha 255, and
 *   MANY IDAT chunks (~8 KiB each) that must be concatenated before inflate;
 *   the sheet carries the minimal PNG unfilter (filter types 0-4) needed to
 *   read them. No dependency was added.
 *
 * VERDICT (2026-09-03, seed 860158, 200-genome sample + 3,697-file top-up,
 *   flam3 3.1.1 at /tmp/opencode/flam3-deb, 320x180 @ quality 10): the
 *   complaint is FIDELITY-FIRST, not patience. (1) Only 12 of 3,879 scanned
 *   genomes (0.3%) import CLEAN — the corpus is wall-to-wall variations we
 *   do not implement (pie 27 genomes, bent2 24, ex/popcorn/rings 24/24/23,
 *   wedge_julia 22, juliascope 21, super_shape 21, pdj 20, curl 19 — top-20
 *   table in the run; parametric-variation support is the whole gate). The
 *   clean fraction DENOMINATOR counts the top-up pass by design (it is a
 *   cohort hunt, not an estimate; the estimate is 1/200 = 0.5%). (2) On the
 *   12 clean paired renders ours reads consistently SOFTER than flam3 at the
 *   same budget: lit fraction lower on 9/12 (47.2% vs 15.2%, 59.4% vs
 *   34.0%, 77.9% vs 53.5%), higher on 3, with
 *   MAD |RGB| spread 10.4-38.4 (median ~24.2). The two extreme rows are
 *   framing blowups of the disclosed re-fit residual (row 3: ours fills the
 *   frame at 59.2% lit where flam3 renders a small centred object at 3.1%;
 *   row 10: ours 21.1% vs flam3 0.3%) — flung-outlier bounds that flam3's
 *   authored center/scale would have kept tight. (3) The noise ladder (one
 *   fixed clean genome, MAD to each side's own 64x reference, one seed so
 *   budgets are sample-prefixes) reads ours 2.095 / 1.638 / 1.157 / 0.655
 *   and flam3 3.270 / 2.216 / 1.323 / 0.707 at 0.25x/1x/4x/16x: flam3 is
 *   NOISIER at every rung here, and both curves fall by ~3x across the
 *   ladder — so at equal patience the complaint is not Monte-Carlo noise;
 *   ours converges at least as fast and the gap is in the tone/sharpening
 *   pipeline and the framing re-fit, not in missing samples.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/flame-differential.harness.ts
 * Writes: scripts/out/flame-differential-<date>/ (paired-renders.png,
 *   manifest.json, and each flam3 run's temp genome + PNG)
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  WARMUP_ITERATIONS,
  plotPoint,
  prepareChaosGame,
  stepOrbit,
} from "../src/fractal/chaos-game";
import type { PreparedChaosGame } from "../src/fractal/chaos-game";
import { transformColors } from "../src/fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  adaptiveDownsampleFlame,
  tonemapFlame,
} from "../src/fractal/flame";
import type { FlameHistogram, Mat4 } from "../src/fractal/flame";
import { buildPaletteLUT, resolvePalette } from "../src/fractal/palette";
import { mulberry32 } from "../src/fractal/rng";
import { VARIATION_TYPES } from "../src/fractal/types";
import type { Vec3 } from "../src/fractal/types";
import { decodeFlameFile } from "../src/app/flame-file";
import { decodeScene } from "../src/app/persist";
import type { SceneSnapshot } from "../src/app/persist";
import { encodePng } from "./de-preview";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Paired-render size (both sides). */
const WIDTH = 320;
const HEIGHT = 180;
/** flam3 sample_density = samples per pixel; ours = QUALITY * WIDTH * HEIGHT. */
const QUALITY = 10;
const BASE_ITERATIONS = QUALITY * WIDTH * HEIGHT;
/** Leg B's paired cohort cap. */
const MAX_PAIRS = 12;
/** Leg C's budgets as multiples of the base iteration count. */
const LADDER_MULTIPLES = [0.25, 1, 4, 16] as const;
/** Leg C's converged reference, in the same multiples. */
const LADDER_REFERENCE = 64;
/** Probe-fit framing: fraction of the frame's SHORT side the attractor fills. */
const FRAME_FILL = 0.8;
/** Gain on the |diff| contact-sheet column, disclosed in the sheet header. */
const DIFF_GAIN = 4;

const SAMPLE_SEED = 0xd1ffe;
const PROBE_POINTS = 4096;
const PROBE_TRIM = 0.02;
const PROBE_SEED = 0x5eed;

const FLAM3_SEED = "1";
const FLAM3_ISAAC_SEED = "abc";
const FLAM3_TIMEOUT_MS = 300_000;

const envStr = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
};

const CORPUS_DIR = envStr(
  "FLAME_DIFF_CORPUS",
  "/tmp/opencode/flam3_xml_output/seq",
);
const FLAM3_BIN = envStr(
  "FLAME_DIFF_FLAM3_BIN",
  "/tmp/opencode/flam3-deb/root/usr/bin/flam3-render",
);
const FLAM3_LIBDIR = envStr(
  "FLAME_DIFF_FLAM3_LIBDIR",
  "/tmp/opencode/flam3-deb/root/usr/lib/x86_64-linux-gnu",
);
const FLAM3_PALETTES = envStr(
  "FLAME_DIFF_FLAM3_PALETTES",
  "/tmp/opencode/flam3-deb/root/usr/share/flam3/flam3-palettes.xml",
);
const OUT_DIR = envStr(
  "FLAME_DIFF_OUT",
  join(
    dirname(fileURLToPath(import.meta.url)),
    "out",
    `flame-differential-${new Date().toISOString().slice(0, 10)}`,
  ),
);
const SAMPLE_SIZE = (() => {
  const parsed = Number.parseInt(envStr("FLAME_DIFF_SAMPLE", "200"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
})();
/**
 * How many files past the seeded sample the top-up pass may scan while
 * hunting leg B's MAX_PAIRS clean genomes (0 disables the pass entirely).
 */
const TOPUP_CAP = (() => {
  const parsed = Number.parseInt(envStr("FLAME_DIFF_TOPUP", "10000"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
})();

// ---------------------------------------------------------------------------
// Small types
// ---------------------------------------------------------------------------

/** One decoded 8-bit RGB image. */
interface RgbImage {
  width: number;
  height: number;
  /** Row-major, 3 bytes per pixel. */
  rgb: Uint8Array;
}

/** One sampled corpus file, kept whole for the flam3 side. */
interface SampledGenome {
  file: string;
  /** The full file text, `<pick>` wrapper included (flam3 parses it fine). */
  raw: string;
  /** The single extracted `<flame>` element fed to decodeFlameFile. */
  xml: string;
}

/** Leg A's per-genome filter record. */
interface GenomeFilter {
  genome: SampledGenome;
  /** Where the genome entered the cohort (see the top-up note in the sheet). */
  source: "sample" | "topup";
  /** Empty warning set AND exactly one scene: the paired-render cohort. */
  clean: boolean;
  warningCount: number;
  /** Unimplemented attribute names from the sheet-side scan (sorted). */
  ignored: string[];
  /** Names parsed out of the importer's own aggregated warning. */
  importerIgnored: string[];
  hasUnsupportedVariations: boolean;
  hasPostNonlinear: boolean;
}

// ---------------------------------------------------------------------------
// Helpers: corpus + importer
// ---------------------------------------------------------------------------

const IMPLEMENTED_VARIATIONS = new Set<string>(VARIATION_TYPES);

/**
 * flame-file.ts's KNOWN_XFORM_ATTRS restated for the FREQUENCY SCAN only —
 * the filter still rides decodeFlameFile's own empty-warning answer, so a
 * drift between this copy and the module's set can only mislabel a table
 * row, never admit a genome the importer refuses. The cross-check below
 * (importer-listed names must scan as unimplemented) is what would catch it.
 */
const KNOWN_XFORM_ATTRS_SCAN = new Set([
  "weight",
  "color",
  "symmetry",
  "color_speed",
  "coefs",
  "post",
  "opacity",
  "animate",
  "name",
  "plotmode",
  "chaos",
  "var_color",
  "motion_frequency",
  "motion_offset",
]);

/**
 * Pull the single `<flame>` element out of a corpus file (root `<pick>`
 * wrapper in this corpus), counting `<flame>` start tags along the way so a
 * multi-genome file is visible rather than silently truncated.
 */
function extractFlame(text: string): { xml: string; flameCount: number } {
  const opens = text.match(/<flame[\s>]/g);
  const flameCount = opens === null ? 0 : opens.length;
  const start = text.search(/<flame[\s>]/);
  if (start < 0) return { xml: "", flameCount };
  const end = text.indexOf("</flame>", start);
  if (end < 0) return { xml: "", flameCount };
  return { xml: text.slice(start, end + "</flame>".length), flameCount };
}

/**
 * Sheet-side per-genome scan of every xform attribute name, split into
 * variations we implement and everything the importer would ignore.
 * Occurrence counts are per genome.
 */
function scanVariationAttrs(text: string): {
  implemented: Map<string, number>;
  unimplemented: Map<string, number>;
} {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const implemented = new Map<string, number>();
  const unimplemented = new Map<string, number>();
  const els = [
    ...doc.getElementsByTagName("xform"),
    ...doc.getElementsByTagName("finalxform"),
  ];
  for (const el of els) {
    for (const name of el.getAttributeNames()) {
      const map = IMPLEMENTED_VARIATIONS.has(name)
        ? implemented
        : KNOWN_XFORM_ATTRS_SCAN.has(name)
          ? null
          : unimplemented;
      if (map !== null) map.set(name, (map.get(name) ?? 0) + 1);
    }
  }
  return { implemented, unimplemented };
}

const UNSUPPORTED_PREFIX = "Unsupported flame features ignored: ";

/**
 * The ignored-attribute names the importer itself named — the aggregated
 * warning truncates at 8 names (a "+N more" tail is dropped here), which is
 * why the full frequency table comes from the sheet-side scan and this parse
 * only CROSS-CHECKS it.
 */
function parseIgnoredWarning(warnings: string[]): string[] {
  const line = warnings.find((w) => w.startsWith(UNSUPPORTED_PREFIX));
  if (line === undefined) return [];
  return line
    .slice(UNSUPPORTED_PREFIX.length)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\+\d+ more$/.test(s));
}

/** Decode a genome into the scene + prepared chaos game both legs render. */
function loadCleanGenome(
  genomeXml: string,
): { snapshot: SceneSnapshot; prepared: PreparedChaosGame } | null {
  const result = decodeFlameFile(genomeXml);
  if (result === null || result.scenes.length !== 1) return null;
  const snapshot = decodeScene(result.scenes[0].encoded);
  if (snapshot === null) return null;
  const prepared = prepareChaosGame(
    snapshot.transforms,
    snapshot.finalTransform ?? null,
    snapshot.symmetry,
  );
  return { snapshot, prepared };
}

// ---------------------------------------------------------------------------
// Helpers: the flam3 side
// ---------------------------------------------------------------------------

function flam3Available(): boolean {
  return (
    existsSync(FLAM3_BIN) &&
    existsSync(FLAM3_LIBDIR) &&
    existsSync(FLAM3_PALETTES)
  );
}

/**
 * Rewrite a genome for the paired/ladder render: size to the target, scale
 * rescaled by the width ratio (pixels-per-unit is absolute — see the header),
 * quality written in the genome because flam3's env var does NOT override it
 * (measured; see the header). DOM round-trip rather than regex so attribute
 * quoting stays parser-owned.
 */
function rewriteGenome(
  raw: string,
  width: number,
  height: number,
  quality: number,
): string {
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  const flame = doc.getElementsByTagName("flame")[0];
  if (!flame) throw new Error("genome has no <flame> element");
  const oldSize = (flame.getAttribute("size") ?? `${width} ${height}`)
    .trim()
    .split(/\s+/)
    .map(Number.parseFloat);
  const ratio = oldSize.length > 0 && oldSize[0] > 0 ? width / oldSize[0] : 1;
  flame.setAttribute("size", `${width} ${height}`);
  const oldScale = Number.parseFloat(flame.getAttribute("scale") ?? "240");
  if (Number.isFinite(oldScale) && oldScale > 0) {
    flame.setAttribute("scale", String(oldScale * ratio));
  }
  flame.setAttribute("quality", String(quality));
  return new XMLSerializer().serializeToString(doc);
}

/**
 * One flam3-render invocation. Environment variables ARE the CLI (flam3 3.x
 * takes no flags); the genome rides an `in=` path and the PNG lands at
 * `<cwd>/<prefix>00000.png`. Prefixes may carry digits/underscores (verified:
 * `b00_` writes `b00_00000.png`), so unique per-genome prefixes are safe.
 */
function runFlam3(
  genomeText: string,
  cwd: string,
  prefix: string,
  quality: number,
): { ok: true; file: string } | { ok: false; log: string } {
  const genomeName = `${prefix}.flam3`;
  writeFileSync(join(cwd, genomeName), genomeText);
  const res = spawnSync(FLAM3_BIN, [], {
    cwd,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: FLAM3_LIBDIR,
      flam3_palettes: FLAM3_PALETTES,
      in: genomeName,
      prefix,
      format: "png",
      quality: String(quality),
      ss: "1",
      seed: FLAM3_SEED,
      isaac_seed: FLAM3_ISAAC_SEED,
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: FLAM3_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const file = join(cwd, `${prefix}00000.png`);
  if (res.error !== undefined || res.status !== 0 || !existsSync(file)) {
    const why =
      res.error !== undefined
        ? String(res.error)
        : res.status === null
          ? "killed (timeout)"
          : `exit ${res.status}`;
    const tail = (res.stderr ?? "").split("\n").slice(-3).join(" | ");
    return { ok: false, log: `${why}: ${tail}` };
  }
  return { ok: true, file };
}

/**
 * Minimal PNG decoder for flam3's own output, verified on this corpus:
 * 8-bit, non-interlaced, color type 6 (RGBA) or 2 (RGB), MANY IDAT chunks
 * that must be concatenated before inflating, per-scanline filters 0-4.
 * Throws on anything else — the caller marks that pair skipped rather than
 * faking a number.
 */
function decodeFlam3Png(path: string): RgbImage {
  const buf = readFileSync(path);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG (bad signature)");
  }
  let off = 8;
  const idats: Buffer[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idats.push(Buffer.from(data));
    }
    off += 12 + len;
    if (type === "IEND") break;
  }
  if (
    bitDepth !== 8 ||
    (colorType !== 6 && colorType !== 2) ||
    interlace !== 0
  ) {
    throw new Error(
      `unsupported IHDR (bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace})`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idats));
  if (raw.length < height * (stride + 1)) {
    throw new Error(
      `inflated IDAT stream too short (${raw.length} < ${height * (stride + 1)})`,
    );
  }
  const pixels = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p];
    p += 1;
    const rowStart = y * stride;
    const cur = pixels.subarray(rowStart, rowStart + stride);
    cur.set(raw.subarray(p, p + stride));
    p += stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0;
      const v = cur[x];
      if (filter === 1) {
        cur[x] = (v + a) & 0xff;
      } else if (filter === 2) {
        cur[x] = (v + b) & 0xff;
      } else if (filter === 3) {
        cur[x] = (v + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        cur[x] = (v + pred) & 0xff;
      }
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = pixels[i * channels];
    rgb[i * 3 + 1] = pixels[i * channels + 1];
    rgb[i * 3 + 2] = pixels[i * channels + 2];
  }
  return { width, height, rgb };
}

// ---------------------------------------------------------------------------
// Helpers: our renderer
// ---------------------------------------------------------------------------

/**
 * The planar framing projection. The corpus genomes are z-free, so flam3's
 * frame IS ours up to scale: a diagonal matrix mapping world (x, y) through
 * a uniform pixels-per-unit to NDC, per-axis NDC scales because the canvas
 * is 16:9 while flam3's scale is uniform px/unit on BOTH axes. Framing is
 * re-fit per genome to ~FRAME_FILL of the short side off a trimmed chaos
 * probe (flame-file.ts's probeFraming recipe: 4096 points, 2% trim) — see
 * the header's disclosed-residual note for why that is production-faithful
 * and still a residual.
 */
function probePlanarProjection(
  prepared: PreparedChaosGame,
  width: number,
  height: number,
): { matrix: Mat4; pixelsPerUnit: number } {
  const rng = mulberry32(PROBE_SEED);
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
  }
  const xs = new Float64Array(PROBE_POINTS);
  const ys = new Float64Array(PROBE_POINTS);
  for (let i = 0; i < PROBE_POINTS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
    const p = plotPoint(prepared, x, y, z, rng);
    xs[i] = p[0];
    ys[i] = p[1];
  }
  xs.sort();
  ys.sort();
  const lo = Math.floor(PROBE_POINTS * PROBE_TRIM);
  const hi = Math.min(
    PROBE_POINTS - 1,
    Math.ceil(PROBE_POINTS * (1 - PROBE_TRIM)),
  );
  const spanX = xs[hi] - xs[lo];
  const spanY = ys[hi] - ys[lo];
  const centerX = (xs[lo] + xs[hi]) / 2;
  const centerY = (ys[lo] + ys[hi]) / 2;
  const pixelsPerUnit =
    Number.isFinite(spanX) &&
    spanX > 1e-9 &&
    Number.isFinite(spanY) &&
    spanY > 1e-9
      ? FRAME_FILL * Math.min(width / spanX, height / spanY)
      : 240; // flam3's classic fallback scale, as flame-file.ts's probe does
  const sx = (2 * pixelsPerUnit) / width;
  const sy = (2 * pixelsPerUnit) / height;
  return {
    matrix: [
      sx,
      0,
      0,
      -sx * centerX,
      0,
      sy,
      0,
      -sy * centerY,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
    ],
    pixelsPerUnit,
  };
}

function rgbaToRgb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): RgbImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return { width, height, rgb };
}

/**
 * The production CPU flame path, end to end: accumulate at the target size,
 * the finished-frame adaptive downsample at the imported estimator params
 * (exactly what `flame-worker-core.ts`'s `rebuildDisplay(adaptive: true)`
 * runs on a finished frame), then the imported tone map.
 */
function renderOurs(
  snapshot: SceneSnapshot,
  prepared: PreparedChaosGame,
  matrix: Mat4,
  iterations: number,
  seed: number,
): { image: RgbImage; histogram: FlameHistogram } {
  const lut = buildPaletteLUT(
    resolvePalette(snapshot.flame.paletteId, snapshot.customPalette),
  );
  const palette: Vec3[] =
    lut === null
      ? transformColors(
          snapshot.transforms.length,
          snapshot.transforms.map((t) => t.colorIndex),
        )
      : [];
  const hist = accumulateFlame(
    prepared,
    matrix,
    WIDTH,
    HEIGHT,
    iterations,
    mulberry32(seed),
    palette,
    undefined,
    lut ?? undefined,
  );
  const display = adaptiveDownsampleFlame(hist, WIDTH, HEIGHT, {
    estimatorRadius: snapshot.flame.estimatorRadius,
    estimatorMinimumRadius: snapshot.flame.estimatorMinimumRadius,
    estimatorCurve: snapshot.flame.estimatorCurve,
  });
  const image = tonemapFlame(display, {
    exposure: snapshot.flame.exposure,
    gamma: snapshot.flame.gamma,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
    vibrancy: snapshot.flame.vibrancy,
  });
  return { image: rgbaToRgb(image, WIDTH, HEIGHT), histogram: display };
}

// ---------------------------------------------------------------------------
// Helpers: image statistics + contact sheet
// ---------------------------------------------------------------------------

function meanAbsDiff(a: RgbImage, b: RgbImage): number {
  let sum = 0;
  for (let i = 0; i < a.rgb.length; i++) sum += Math.abs(a.rgb[i] - b.rgb[i]);
  return sum / a.rgb.length;
}

/** Fraction of pixels with luminance above a 2/255 floor. */
function litFraction(img: RgbImage): number {
  let lit = 0;
  for (let i = 0; i < img.rgb.length; i += 3) {
    const lum =
      0.2126 * img.rgb[i] + 0.7152 * img.rgb[i + 1] + 0.0722 * img.rgb[i + 2];
    if (luminanceAbove(lum)) lit++;
  }
  return lit / (img.rgb.length / 3);
}

const LIT_FLOOR = 2;

function luminanceAbove(lum: number): boolean {
  return lum > LIT_FLOOR;
}

function diffImage(a: RgbImage, b: RgbImage): RgbImage {
  const rgb = new Uint8Array(a.rgb.length);
  for (let i = 0; i < a.rgb.length; i++) {
    rgb[i] = Math.min(255, Math.abs(a.rgb[i] - b.rgb[i]) * DIFF_GAIN);
  }
  return { width: a.width, height: a.height, rgb };
}

/**
 * Tile the paired renders into rows of [ours | flam3 | diff]. Deliberately
 * not de-preview.ts's labeled sheets: those require square `PanelStats`
 * panels and a flame pair is 320x180 with none of those quantities —
 * julia-flame.harness.ts's hand-roll reasoning, one column longer.
 */
function writeDifferentialSheet(
  images: RgbImage[],
  cols: number,
  fileName: string,
): string {
  const w = images[0].width;
  const h = images[0].height;
  const gutter = 2;
  const rows = Math.ceil(images.length / cols);
  const sheetW = cols * w + (cols - 1) * gutter;
  const sheetH = rows * h + (rows - 1) * gutter;
  const sheet = new Uint8Array(sheetW * sheetH * 3);
  images.forEach((img, i) => {
    const x0 = (i % cols) * (w + gutter);
    const y0 = Math.floor(i / cols) * (h + gutter);
    for (let y = 0; y < h; y++) {
      sheet.set(
        img.rgb.subarray(y * w * 3, (y + 1) * w * 3),
        ((y0 + y) * sheetW + x0) * 3,
      );
    }
  });
  const file = join(OUT_DIR, fileName);
  writeFileSync(file, encodePng(sheetW, sheetH, sheet));
  return file;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

describe("flame differential: ours vs flam3 over Electric Sheep genomes", () => {
  afterEach(async () => {
    // jsdom event-loop drain (docs/test-suite-memory.md): one real macrotask
    // per test so nothing the parser queued pins a tree across tests.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("filters the corpus, renders the clean cohort against flam3, and ladders the noise floor", () => {
    if (!existsSync(CORPUS_DIR)) {
      console.info(
        `CORPUS MISSING at ${CORPUS_DIR} — all legs SKIPPED. Provision via:\n` +
          `  git clone --depth 1 https://github.com/Yuiry-IV/flam3_xml_output ${CORPUS_DIR}`,
      );
      return;
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const flam3 = flam3Available();
    if (!flam3) {
      console.info(
        `flam3-render NOT FOUND (${FLAM3_BIN} with libs at ${FLAM3_LIBDIR} and ` +
          `palettes at ${FLAM3_PALETTES}) — leg B and the flam3 side of leg C ` +
          `will SKIP. Provision via:\n` +
          `  cd /tmp/opencode/flam3-deb && apt-get download flam3-utils libflam3-0 ` +
          `flam3-palette && for f in *.deb; do dpkg-deb -x "$f" root; done`,
      );
    }

    // ---- LEG A: corpus filter + variation frequency ------------------------
    const files = readdirSync(CORPUS_DIR)
      .filter((f) => f.endsWith(".flam3"))
      .sort();
    const shuffled = [...files];
    const sampleRng = mulberry32(SAMPLE_SEED);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(sampleRng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    const sampleCount = Math.min(SAMPLE_SIZE, shuffled.length);
    const frequency = new Map<
      string,
      { genomes: number; occurrences: number; implemented: boolean }
    >();
    const cohort: GenomeFilter[] = [];
    let unparseable = 0;
    let multiFlame = 0;
    let crossCheckNames = 0;
    let crossCheckMismatches = 0;
    let topupScanned = 0;
    let topupClean = 0;

    /**
     * Filter one genome into the cohort. `source` is "sample" for the seeded
     * sample (whose frequency table IS leg A's statistic) or "topup" for the
     * continuation pass leg B uses below — a top-up genome is filtered but
     * deliberately NOT added to the frequency table, so leg A's numbers stay
     * a pure sample statistic.
     */
    const filterGenome = (
      file: string,
      source: "sample" | "topup",
    ): boolean => {
      const raw = readFileSync(join(CORPUS_DIR, file), "utf8");
      const extracted = extractFlame(raw);
      if (extracted.xml === "") {
        unparseable++;
        return false;
      }
      if (extracted.flameCount !== 1) multiFlame++;
      const result = decodeFlameFile(extracted.xml);
      const scan = scanVariationAttrs(extracted.xml);
      if (source === "sample") {
        for (const [name, n] of scan.implemented) {
          const cell = frequency.get(name) ?? {
            genomes: 0,
            occurrences: 0,
            implemented: true,
          };
          cell.genomes++;
          cell.occurrences += n;
          frequency.set(name, cell);
        }
        for (const [name, n] of scan.unimplemented) {
          const cell = frequency.get(name) ?? {
            genomes: 0,
            occurrences: 0,
            implemented: false,
          };
          cell.genomes++;
          cell.occurrences += n;
          frequency.set(name, cell);
        }
      }
      const importerIgnored =
        result === null ? [] : parseIgnoredWarning(result.warnings);
      // Cross-check: every name the importer's own warning lists must be
      // classified unimplemented by the sheet-side scan. A mismatch means the
      // restated known-attribute set drifted from the importer's — reported,
      // never silently absorbed.
      for (const name of importerIgnored) {
        crossCheckNames++;
        if (!scan.unimplemented.has(name)) crossCheckMismatches++;
      }
      const warnings = result === null ? ["not a flame file"] : result.warnings;
      const clean =
        result !== null &&
        result.warnings.length === 0 &&
        result.scenes.length === 1;
      cohort.push({
        genome: { file, raw, xml: extracted.xml },
        source,
        clean,
        warningCount: result === null ? 0 : result.warnings.length,
        ignored: [...scan.unimplemented.keys()].sort(),
        importerIgnored,
        hasUnsupportedVariations: warnings.some((w) =>
          w.startsWith("Unsupported flame features ignored"),
        ),
        hasPostNonlinear: warnings.some((w) =>
          w.startsWith("Ignored a post transform on a nonlinear map"),
        ),
      });
      console.info(
        `${String(cohort.length).padStart(3, "0")} ${source === "topup" ? "[topup] " : ""}${file} ` +
          `${clean ? "CLEAN" : `warnings=${result === null ? "null" : result.warnings.length}`}` +
          (cohort[cohort.length - 1].ignored.length > 0
            ? ` ignored=[${cohort[cohort.length - 1].ignored.join(", ")}]`
            : ""),
      );
      return clean;
    };

    for (const file of shuffled.slice(0, sampleCount)) {
      filterGenome(file, "sample");
    }

    // Top-up: the corpus's measured clean rate is well under one percent, so
    // a 200-sample yields a ONE-genome paired cohort. Continue the SAME
    // seeded shuffle past the sample — deterministic, capped, disclosed —
    // until MAX_PAIRS clean genomes exist for leg B (or the cap/exhaustion
    // stops it). Leg A's tables above stay sample-only.
    if (TOPUP_CAP > 0 && sampleCount < shuffled.length) {
      const cleanSoFar = () => cohort.filter((g) => g.clean).length;
      for (
        let i = sampleCount;
        i < shuffled.length &&
        cleanSoFar() < MAX_PAIRS &&
        topupScanned < TOPUP_CAP;
        i++
      ) {
        topupScanned++;
        if (filterGenome(shuffled[i], "topup")) topupClean++;
      }
    }

    const clean = cohort.filter((g) => g.clean);
    console.info(
      `LEG A: ${cohort.filter((g) => g.source === "sample").length} genomes sampled (seed ${SAMPLE_SEED}), ` +
        `${unparseable} unparseable, ${multiFlame} multi-flame; ` +
        `CLEAN ${clean.length} ` +
        `(${((clean.length / Math.max(cohort.length, 1)) * 100).toFixed(1)}% of all scanned) ` +
        `— the paired-render cohort` +
        (topupScanned > 0
          ? `; top-up pass scanned ${topupScanned} further files for ${topupClean} more clean (cap ${TOPUP_CAP})`
          : "") +
        `; unsupported-variations ` +
        `${cohort.filter((g) => g.hasUnsupportedVariations).length}, ` +
        `post-on-nonlinear ${cohort.filter((g) => g.hasPostNonlinear).length}; ` +
        `importer/scan cross-check ${crossCheckMismatches}/${crossCheckNames} mismatches`,
    );
    const sampledCount = cohort.filter((g) => g.source === "sample").length;
    const topUnimplemented = [...frequency.entries()]
      .filter(([, v]) => !v.implemented && v.genomes > 0)
      .sort((a, b) => b[1].genomes - a[1].genomes)
      .slice(0, 20)
      .map(([name, v]) => ({
        unimplemented: name,
        genomes: v.genomes,
        occurrences: v.occurrences,
        shareOfSample: (v.genomes / Math.max(sampledCount, 1)).toFixed(3),
      }));
    console.table(topUnimplemented);
    const implementedUsed = [...frequency.entries()]
      .filter(([, v]) => v.implemented && v.genomes > 0)
      .sort((a, b) => b[1].genomes - a[1].genomes)
      .map(([name, v]) => `${name}:${v.genomes}`)
      .join(", ");
    console.info(
      `implemented variation presence: ${implementedUsed || "none"}`,
    );

    // ---- LEG B: paired renders ---------------------------------------------
    const pairRows: Record<string, string | number>[] = [];
    const pairImages: RgbImage[] = [];
    if (!flam3) {
      console.info(
        "LEG B: SKIPPED (flam3-render missing — see provisioning note above)",
      );
    } else if (clean.length === 0) {
      console.info(
        "LEG B: SKIPPED (no clean genomes in the sample — cohort empty)",
      );
    } else {
      const pairs = clean.slice(0, MAX_PAIRS);
      for (const [i, g] of pairs.entries()) {
        const prefix = `b${String(i).padStart(2, "0")}_`;
        const row: Record<string, string | number> = { genome: g.genome.file };
        let genomeXml: string;
        try {
          genomeXml = rewriteGenome(g.genome.raw, WIDTH, HEIGHT, QUALITY);
        } catch (error) {
          row.status = `skipped: genome rewrite (${(error as Error).message})`;
          pairRows.push(row);
          continue;
        }
        const run = runFlam3(genomeXml, OUT_DIR, prefix, QUALITY);
        if (!run.ok) {
          row.status = `skipped: flam3 failed (${run.log})`;
          pairRows.push(row);
          continue;
        }
        let flam3Image: RgbImage;
        try {
          flam3Image = decodeFlam3Png(run.file);
        } catch (error) {
          row.status = `skipped: png decode (${(error as Error).message})`;
          pairRows.push(row);
          continue;
        }
        const loaded = loadCleanGenome(g.genome.xml);
        if (loaded === null) {
          row.status = "skipped: scene decode";
          pairRows.push(row);
          continue;
        }
        const framing = probePlanarProjection(loaded.prepared, WIDTH, HEIGHT);
        const ours = renderOurs(
          loaded.snapshot,
          loaded.prepared,
          framing.matrix,
          BASE_ITERATIONS,
          SAMPLE_SEED,
        ).image;
        pairImages.push(ours, flam3Image, diffImage(ours, flam3Image));
        row.oursLit = `${(litFraction(ours) * 100).toFixed(1)}%`;
        row.flam3Lit = `${(litFraction(flam3Image) * 100).toFixed(1)}%`;
        row.mad = meanAbsDiff(ours, flam3Image).toFixed(2);
        row.status = "ok";
        pairRows.push(row);
      }
      console.table(pairRows);
      if (pairImages.length > 0) {
        const sheetPath = writeDifferentialSheet(
          pairImages,
          3,
          "paired-renders.png",
        );
        console.info(
          `wrote ${sheetPath} (columns: ours | flam3 | |diff|x${DIFF_GAIN}; ` +
            `rows: ${pairRows.filter((r) => r.status === "ok").length} genomes in sample order)`,
        );
      }
    }

    // ---- LEG C: noise-floor ladder -----------------------------------------
    const ladderRows: Record<string, string | number>[] = [];
    if (clean.length === 0) {
      console.info("LEG C: SKIPPED (no clean genome to fix the ladder on)");
    } else {
      const loaded = loadCleanGenome(clean[0].genome.xml);
      if (loaded === null) {
        console.info("LEG C: SKIPPED (the fixed clean genome failed to load)");
      } else {
        const fixed = clean[0].genome.file;
        const framing = probePlanarProjection(loaded.prepared, WIDTH, HEIGHT);
        const reference = renderOurs(
          loaded.snapshot,
          loaded.prepared,
          framing.matrix,
          LADDER_REFERENCE * BASE_ITERATIONS,
          SAMPLE_SEED,
        ).image;
        ladderRows.push({
          genome: fixed,
          budget: `${LADDER_REFERENCE}x`,
          iterations: LADDER_REFERENCE * BASE_ITERATIONS,
          oursMadToRef: "0 (reference)",
        });
        for (const multiple of LADDER_MULTIPLES) {
          const run = renderOurs(
            loaded.snapshot,
            loaded.prepared,
            framing.matrix,
            Math.round(multiple * BASE_ITERATIONS),
            SAMPLE_SEED,
          ).image;
          ladderRows.push({
            genome: fixed,
            budget: `${multiple}x`,
            iterations: Math.round(multiple * BASE_ITERATIONS),
            oursMadToRef: meanAbsDiff(run, reference).toFixed(3),
          });
        }
        if (flam3) {
          const refQuality = LADDER_REFERENCE * QUALITY;
          const refRun = runFlam3(
            rewriteGenome(clean[0].genome.raw, WIDTH, HEIGHT, refQuality),
            OUT_DIR,
            "lref_",
            refQuality,
          );
          if (!refRun.ok) {
            console.info(`LEG C flam3 reference failed: ${refRun.log}`);
          } else {
            let flam3Reference: RgbImage;
            try {
              flam3Reference = decodeFlam3Png(refRun.file);
            } catch (error) {
              flam3Reference = null as unknown as RgbImage;
              console.info(
                `LEG C flam3 reference PNG undecodable, flam3 ladder column SKIPPED: ` +
                  `${(error as Error).message}`,
              );
            }
            if (flam3Reference !== null) {
              ladderRows[0].flam3MadToRef = "0 (reference)";
              for (const multiple of LADDER_MULTIPLES) {
                const quality = multiple * QUALITY;
                const run = runFlam3(
                  rewriteGenome(clean[0].genome.raw, WIDTH, HEIGHT, quality),
                  OUT_DIR,
                  `l${String(multiple).replace(".", "")}_`,
                  quality,
                );
                const cell = ladderRows.find(
                  (row) => row.budget === `${multiple}x`,
                );
                if (!run.ok) {
                  if (cell) cell.flam3MadToRef = `skipped (${run.log})`;
                  continue;
                }
                try {
                  const img = decodeFlam3Png(run.file);
                  if (cell)
                    cell.flam3MadToRef = meanAbsDiff(
                      img,
                      flam3Reference,
                    ).toFixed(3);
                } catch (error) {
                  if (cell)
                    cell.flam3MadToRef = `skipped (${(error as Error).message})`;
                }
              }
            }
          }
        }
        console.table(ladderRows);
      }
    }

    // ---- manifest -----------------------------------------------------------
    const manifest = {
      date: new Date().toISOString(),
      corpus: CORPUS_DIR,
      corpusFiles: files.length,
      sampleSeed: SAMPLE_SEED,
      sampleSize: SAMPLE_SIZE,
      topupCap: TOPUP_CAP,
      topupScanned,
      topupClean,
      quality: QUALITY,
      width: WIDTH,
      height: HEIGHT,
      baseIterations: BASE_ITERATIONS,
      flam3Bin: FLAM3_BIN,
      flam3Present: flam3,
      cohort: {
        sampled: sampledCount,
        scanned: cohort.length,
        unparseable,
        multiFlame,
        clean: clean.length,
        cleanFraction: (clean.length / Math.max(cohort.length, 1)).toFixed(4),
        unsupportedVariations: cohort.filter((g) => g.hasUnsupportedVariations)
          .length,
        postNonlinear: cohort.filter((g) => g.hasPostNonlinear).length,
        crossCheckMismatches,
        crossCheckNames,
        files: cohort.map((g) => ({
          file: g.genome.file,
          source: g.source,
          clean: g.clean,
          warnings: g.warningCount,
          ignored: g.ignored,
        })),
      },
      frequency: [...frequency.entries()]
        .sort((a, b) => b[1].genomes - a[1].genomes)
        .map(([name, v]) => ({
          name,
          implemented: v.implemented,
          genomes: v.genomes,
          occurrences: v.occurrences,
        })),
      pairs: pairRows,
      ladder: ladderRows,
    };
    const manifestPath = join(OUT_DIR, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.info(`wrote ${manifestPath}`);

    expect(sampledCount).toBeGreaterThan(0);
    expect(cohort.length + unparseable).toBe(sampledCount + topupScanned);
  });
});
