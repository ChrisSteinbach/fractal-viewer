#!/usr/bin/env node
/**
 * MEASUREMENT PROBE — what does a sphere-inversion Surface session cost, and
 * where does it exhaust, across the candidate authored domain?
 *
 * The public control ranges (arrangement, radius fraction, seed, depth) are
 * derived from this probe's rows (`docs/sphere-inversion-family.md`, "Cost and
 * exhaustion (measured)"). It is an instrument, not a gate: exit 0 unless
 * the run itself broke.
 *
 * ONE CELL = one fresh browser context on a minted `#v1=` document (a plain
 * 3D transform system plus the `sphereInversion` block, and a `fourD` rotor
 * pose for 4D rows), Surface entered with a TRUSTED click on the mode button,
 * then:
 *
 *   1. SETTLE — wall time from the click to `scripts/lib/surface-browser-
 *      runner.mjs`'s settled predicate over the `?surfacestate` latch (a
 *      completed full-quality frame for the current view, all antialiasing
 *      passes included — the app's default 8). The settled census gives the
 *      exhausted-ray fraction.
 *   2. DRAG — a trusted ~3 s orbit drag over the canvas. Every preview frame
 *      the session traces is read off the renderer's own console line
 *      (compute: `Surface compute preview WxH ... exhausted N`; WebGL:
 *      `?surfperf`'s `preview armed WxH`), so the governor RUNG is the
 *      preview raster width over the settle raster width, and the coarsest
 *      preview's exhausted fraction is read directly (compute only — the
 *      WebGL strip arm publishes a census for settles alone).
 *
 * SHADE COST AND WATCHDOG PROXIMITY come from `?surfacetrace`'s per-dispatch
 * lines (`march END ms= work=`, `shade END ms= work=`, `fence ... src=`):
 * every dispatch is its own submission, and a submission is the watchdog's
 * unit, so the per-dispatch maximum is the number to hold against a job cut.
 * An init script consumes those lines IN THE PAGE and keeps running
 * aggregates, so thousands of trace lines never cross the DevTools protocol;
 * the trace's own string building is the one observer cost, disclosed here.
 *
 * 4D SLICES ARE AUTHORED IN WORLD w. The slice slider is normalized
 * rotated-w (`scene.ts`'s `setSurface4View`: `w0 = sliceCenter * wSupport(
 * rotor, cloud half-extents)`), so the probe reads the Points cloud's
 * half-extents off the cloud worker's own result message, computes the
 * support for the cell's rotor, and sets the slider to `w0 / support` before
 * entering Surface. The slider's step quantizes that; the row records the
 * world w0 actually selected.
 *
 * CONDITIONS. `--display=:0` must be a real driver (see AGENTS.md's
 * XAUTHORITY note; the row carries the adapter label and the software flag
 * the session itself reports). The machine-quiet baseline is taken before
 * the browser launches AND before every cell, attributed per process with
 * this probe's own process tree ignored; a cell whose pre-cell sample is not
 * `quiet=YES` is marked uncertified and rerun (bounded) at the end.
 *
 * SHARED-TREE PROTOCOL. While the browser runs the probe holds `--lock`
 * (another agent's gates wait on it), releases it between batches of
 * `--batch-min` minutes for `--pause-s` seconds, and before (re)taking it
 * waits until no vitest/Chromium/Playwright process outside this probe is
 * alive. Idle Playwright MCP servers are not browsers and are ignored.
 *
 * Usage (production build served first):
 *   npm run build && npm run preview &
 *   node scripts/sphere-inversion-cost.probe.mjs [url] --display=:0
 *     [--plans=3d-depth,3d-rf,4d-depth,4d-rf,4d-pose,gl,supp,supp-raster,seed,gencount]
 *     [--viewport=1920x1080]
 *     [--timeout-s=90] [--prune-s=60] [--out=scripts/out/sphere-inversion-cost.json]
 *     [--only=<substring of a cell key>] [--lock=/tmp/claude-1000/si-bench.lock]
 *
 * RESUMABLE: rows already in `--out` are skipped (uncertified rows are
 * retried), so an interrupted sweep continues where it stopped.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import {
  formatQuietLine,
  measureGpuContention,
  pidTree,
} from "./lib/machine-quiet.mjs";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
} from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = (
  args.find((a) => !a.startsWith("--")) ?? "https://localhost:4173"
).replace(/\/+$/, "");
const DISPLAY = flag("display", ":0");
const PLANS = flag("plans", "3d-depth,3d-rf,4d-depth,4d-rf,4d-pose,gl").split(
  ",",
);
const [VW, VH] = flag("viewport", "1920x1080").split("x").map(Number);
const TIMEOUT_MS = Number(flag("timeout-s", "90")) * 1000;
const GL_TIMEOUT_MS = Number(flag("gl-timeout-s", "150")) * 1000;
const PRUNE_MS = Number(flag("prune-s", "60")) * 1000;
const OUT = path.resolve(
  flag("out", path.join(HERE, "out", "sphere-inversion-cost.json")),
);
const ONLY = flag("only", "");
const LOCK = flag("lock", "/tmp/claude-1000/si-bench.lock");
const BATCH_MS = Number(flag("batch-min", "18")) * 60_000;
const PAUSE_MS = Number(flag("pause-s", "180")) * 1000;
const MAX_UNCERTIFIED_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

// ------------------------------------------------------------ the documents

/** A plain three-map 3D system (the `plain4` fixture of
 * `scripts/slice-cliff.probe.mjs` with its w lift removed). The block
 * REPLACES it as the Surface subject; it only has to be a valid document. */
const BASE_DOC = {
  transforms: [
    { position: [0.5, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    { position: [-0.25, 0.43, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    {
      position: [-0.25, -0.43, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ],
  numPoints: 100000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: true,
  symmetry: { order: 1, plane: "xz" },
};

// Rotor pair composition, `src/app/rotor4.ts`'s rotateInPlane verbatim
// (scalar-first quaternions; delta applied after, renormalized).
const PLANE_DELTA = {
  xw: { unit: 1, signP: -1, signQ: 1 },
  yw: { unit: 2, signP: -1, signQ: 1 },
  zw: { unit: 3, signP: -1, signQ: 1 },
};
const quatMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qnorm = (q) => {
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
};
function rotorFor(planes) {
  let p = [1, 0, 0, 0];
  let q = [1, 0, 0, 0];
  for (const [plane, angle] of planes) {
    const { unit, signP, signQ } = PLANE_DELTA[plane];
    const dp = [Math.cos(angle / 2), 0, 0, 0];
    dp[unit] = Math.sin((signP * angle) / 2);
    const dq = [Math.cos(angle / 2), 0, 0, 0];
    dq[unit] = Math.sin((signQ * angle) / 2);
    p = qnorm(quatMul(dp, p));
    q = qnorm(quatMul(dq, q));
  }
  return { p, q };
}
/** The w row of `rotorMatrix(pair)`: the scalar part of p·e_c·q̄. */
function rotorWRow({ p, q }) {
  const qc = [q[0], -q[1], -q[2], -q[3]];
  const row = [];
  for (let c = 0; c < 4; c++) {
    const e = [0, 0, 0, 0];
    e[c === 3 ? 0 : c + 1] = 1; // x→i, y→j, z→k, w→scalar
    row.push(quatMul(quatMul(p, e), qc)[0]);
  }
  return row;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const POSES = {
  id: { planes: [], w0: 0 },
  "xw.3w.1": { planes: [["xw", 0.3]], w0: 0.1 },
  medallion: {
    planes: [
      ["xw", 0.4],
      ["yw", 0.3],
      ["zw", 0.2],
    ],
    w0: 1 / (4 * PHI),
  },
};

const SEEDS3 = {
  ball: { kind: "ball", size: 0.28 },
  shell: { kind: "shell", size: 1, thickness: 0.03 },
  cutShell: { kind: "cutShell", size: 1, thickness: 0.06 },
};
/** Seed-geometry variants for the `seed` plan: one length moved at a time
 * off the representative seed above. */
const SEED_VARIANTS3 = {
  "ball.15": { kind: "ball", size: 0.15 },
  "ball.5": { kind: "ball", size: 0.5 },
  "ball.8": { kind: "ball", size: 0.8 },
  "shell.7": { kind: "shell", size: 0.7, thickness: 0.03 },
  "shell1.3": { kind: "shell", size: 1.3, thickness: 0.03 },
  "shellT.01": { kind: "shell", size: 1, thickness: 0.01 },
  "shellT.1": { kind: "shell", size: 1, thickness: 0.1 },
  cutR2: { kind: "cutShell", size: 1, thickness: 0.06, cutRadius: 2 },
  cutR50: { kind: "cutShell", size: 1, thickness: 0.06, cutRadius: 50 },
  "cutO-.5": { kind: "cutShell", size: 1, thickness: 0.06, cutOffset: -0.5 },
  "cutO.8": { kind: "cutShell", size: 1, thickness: 0.06, cutOffset: 0.8 },
};
const SEEDS4 = {
  ball: { kind: "ball", size: 0.28 },
  shell: { kind: "shell", size: 1.1, thickness: 0.03 },
  cutShell: { kind: "cutShell", size: 0.9, thickness: 0.04 },
};
const SEED_VARIANTS4 = {
  "ball.15": { kind: "ball", size: 0.15 },
  "ball.5": { kind: "ball", size: 0.5 },
  "ball.8": { kind: "ball", size: 0.8 },
  "shellT.01": { kind: "shell", size: 1.1, thickness: 0.01 },
  "shellT.1": { kind: "shell", size: 1.1, thickness: 0.1 },
  cutR2: { kind: "cutShell", size: 0.9, thickness: 0.04, cutRadius: 2 },
  cutR50: { kind: "cutShell", size: 0.9, thickness: 0.04, cutRadius: 50 },
  "cutO-.4": { kind: "cutShell", size: 0.9, thickness: 0.04, cutOffset: -0.4 },
  "cutO.8": { kind: "cutShell", size: 0.9, thickness: 0.04, cutOffset: 0.8 },
};
const ARR3 = ["oct6", "cube8", "ico12"];
/** Every 3D registry id in generator-count order, for the `gencount` plan:
 * the look study's four land in the 12-to-30 band no earlier row measured. */
const ARR3_BY_COUNT = [
  "tetra4",
  "oct6",
  "cube8",
  "ico12",
  "dodec20",
  "rhombicuboct24",
  "icosidodec30",
];
/** The fragment arm's generator ceiling (`SPHERE_INVERSION_GLSL_MAX_GENERATORS`,
 * pinned in its own tests): the WebGL cells stop below it. */
const GLSL_MAX_GENERATORS = 29;
const GENERATOR_COUNT = {
  tetra4: 4,
  oct6: 6,
  cube8: 8,
  ico12: 12,
  dodec20: 20,
  rhombicuboct24: 24,
  icosidodec30: 30,
};
const ARR4 = ["tess16", "cross8", "cell24", "cell600"];

/** Rows: a row is one (engine, arrangement, fraction, seed, pose) walked in
 * increasing depth, pruned once a depth times out or settles past PRUNE_MS. */
function plannedRows() {
  const rows = [];
  const row = (plan, engine, dim, arrangement, rf, seed, pose, depths) =>
    rows.push({ plan, engine, dim, arrangement, rf, seed, pose, depths });
  for (const plan of PLANS) {
    if (plan === "3d-depth")
      for (const a of ARR3)
        for (const s of Object.keys(SEEDS3))
          row(plan, "compute", 3, a, 0.99, s, "id", [3, 5, 8, 12, 20, 32]);
    if (plan === "3d-rf")
      for (const rf of [0.6, 0.8, 0.9])
        for (const a of ARR3)
          for (const s of Object.keys(SEEDS3))
            row(plan, "compute", 3, a, rf, s, "id", [8]);
    if (plan === "4d-depth")
      for (const a of ARR4)
        for (const s of Object.keys(SEEDS4))
          row(plan, "compute", 4, a, 0.99, s, "id", [3, 5, 8, 12]);
    if (plan === "4d-rf")
      for (const rf of [0.8])
        for (const a of ARR4)
          for (const s of Object.keys(SEEDS4))
            row(plan, "compute", 4, a, rf, s, "id", [5]);
    if (plan === "4d-pose")
      for (const pose of ["xw.3w.1", "medallion"])
        for (const a of ARR4)
          for (const s of Object.keys(SEEDS4))
            row(plan, "compute", 4, a, 0.99, s, pose, [5]);
    if (plan === "gl")
      for (const a of ["oct6", "ico12"])
        for (const s of ["ball", "cutShell"])
          row(plan, "webgl", 3, a, 0.99, s, "id", [5, 8, 12]);
    // The supplement to the first sweep: the rows its prune rule skipped
    // (the 600-cell vault at identity), 4D depth past 12, and the 4D
    // radius-fraction step between .8 and .99 where preview exhaustion moves.
    if (plan === "supp") {
      row(plan, "compute", 4, "cell600", 0.99, "cutShell", "id", [5, 8]);
      row(plan, "compute", 4, "cell600", 0.99, "ball", "id", [8]);
      for (const a of ["tess16", "cell600"])
        row(plan, "compute", 4, a, 0.99, "shell", "id", [20, 32]);
      for (const a of ARR4)
        for (const s of Object.keys(SEEDS4))
          row(plan, "compute", 4, a, 0.9, s, "id", [5]);
    }
    // Ray scaling on the costliest arrangement; run with its own --out and
    // --viewport, since a cell key does not name the raster.
    if (plan === "seed") {
      for (const a of ["oct6", "ico12"])
        for (const v of Object.keys(SEED_VARIANTS3))
          row(plan, "compute", 3, a, 0.99, v, "id", [8]);
      for (const a of ["cell24", "cell600"])
        for (const v of Object.keys(SEED_VARIANTS4))
          row(plan, "compute", 4, a, 0.99, v, "id", [5]);
    }
    // COST AGAINST GENERATOR COUNT: every arrangement at the family's
    // representative seeds, one depth per dimension (settle is flat in depth,
    // the 3d-depth/4d-depth verdict), both engines in 3D up to the fragment
    // arm's ceiling, so one table reads across 4..120 generators.
    if (plan === "gencount") {
      for (const a of ARR3_BY_COUNT)
        for (const s of Object.keys(SEEDS3)) {
          row(plan, "compute", 3, a, 0.99, s, "id", [8]);
          if (GENERATOR_COUNT[a] <= GLSL_MAX_GENERATORS)
            row(plan, "webgl", 3, a, 0.99, s, "id", [8]);
        }
      for (const a of ARR4)
        for (const s of Object.keys(SEEDS4))
          row(plan, "compute", 4, a, 0.99, s, "id", [5]);
    }
    if (plan === "supp-raster")
      for (const s of Object.keys(SEEDS4))
        row(plan, "compute", 4, "cell600", 0.99, s, "id", [5]);
  }
  return rows;
}

const cellKey = (r, depth) =>
  `${r.engine}|${r.arrangement}|rf${r.rf}|${r.seed}|D${depth}|${r.pose}`;

function mintHash(r, depth) {
  const doc = structuredClone(BASE_DOC);
  doc.sphereInversion = {
    arrangement: r.arrangement,
    radiusFraction: r.rf,
    seed:
      r.dim === 3
        ? (SEEDS3[r.seed] ?? SEED_VARIANTS3[r.seed])
        : (SEEDS4[r.seed] ?? SEED_VARIANTS4[r.seed]),
    depth,
  };
  if (r.dim === 4) {
    const pair = rotorFor(POSES[r.pose].planes);
    doc.fourD = {
      ...pair,
      sliceOn: false,
      sliceCenter: 0,
      sliceThickness: 0,
      sliceRelColor: false,
    };
  }
  return `v1=${Buffer.from(JSON.stringify(doc), "utf8").toString("base64url")}`;
}

// ------------------------------------------------------- in-page aggregator

/** Runs before the app. Consumes the renderer's own diagnostic lines into
 * per-phase aggregates and reads the cloud worker's half-extents. */
const INIT_SCRIPT = () => {
  const phases = {};
  let phase = "entry";
  const P = () =>
    (phases[phase] ??= {
      march: { n: 0, maxWork: 0, maxWall: 0, sumWork: 0 },
      shade: { n: 0, maxWork: 0, maxWall: 0, sumWork: 0, hitLen: 0 },
      src: {},
      shadeModel: null,
      previews: [],
      settles: [],
      glPreviewArms: [],
      glSettles: [],
      heavyStrips: [],
      truncations: 0,
    });
  const num = (s, key) => {
    const m = new RegExp(`${key}=([-\\d.]+)`).exec(s);
    return m ? Number(m[1]) : null;
  };
  const handle = (line) => {
    if (line.startsWith("[surfacetrace]")) {
      const a = P();
      if (line.includes(" march END ")) {
        const work = num(line, "work");
        const wall = num(line, "ms");
        a.march.n++;
        a.march.sumWork += work;
        a.march.maxWork = Math.max(a.march.maxWork, work);
        a.march.maxWall = Math.max(a.march.maxWall, wall);
      } else if (line.includes(" shade END ")) {
        const work = num(line, "work");
        const wall = num(line, "ms");
        a.shade.n++;
        a.shade.sumWork += work;
        a.shade.maxWork = Math.max(a.shade.maxWork, work);
        a.shade.maxWall = Math.max(a.shade.maxWall, wall);
        if (line.includes("isFree=false")) a.shade.hitLen += num(line, "len");
      } else if (line.includes(" fence ")) {
        const m = / src=(\w+)/.exec(line);
        if (m) a.src[m[1]] = (a.src[m[1]] ?? 0) + 1;
      } else if (line.includes(" shade cost→")) {
        a.shadeModel = line.slice(line.indexOf("shade cost→") + 11);
      } else if (line.includes("budget truncated")) {
        a.truncations++;
      }
      return true;
    }
    const pv =
      /^Surface compute (preview|settle) (\d+)x(\d+): (\d+)ms wall, (\d+) passes([^,]*), hit (\d+) \/ miss (\d+) \/ exhausted (\d+)(?: \/ active (\d+))?/.exec(
        line,
      );
    if (pv) {
      const rec = {
        t: performance.now(),
        w: Number(pv[2]),
        h: Number(pv[3]),
        wallMs: Number(pv[4]),
        passes: Number(pv[5]),
        note: pv[6].trim(),
        hit: Number(pv[7]),
        miss: Number(pv[8]),
        exhausted: Number(pv[9]),
        active: pv[10] === undefined ? 0 : Number(pv[10]),
      };
      (pv[1] === "preview" ? P().previews : P().settles).push(rec);
      return false;
    }
    if (line.startsWith("[surfperf] preview armed ")) {
      const m = /armed (\d+)x(\d+)/.exec(line);
      P().glPreviewArms.push({ t: performance.now(), w: +m[1], h: +m[2] });
      return true;
    }
    if (line.startsWith("[surfperf] settle complete ")) {
      const m =
        /complete (\d+)x(\d+) spentMs=([\d.]+) wall=(\d+) strips=(\d+)/.exec(
          line,
        );
      if (m)
        P().glSettles.push({
          w: +m[1],
          h: +m[2],
          spentMs: +m[3],
          wall: +m[4],
          strips: +m[5],
        });
      return true;
    }
    if (line.startsWith("[surfperf] heavy strip ")) {
      P().heavyStrips.push({ px: num(line, "px"), ms: num(line, "ms") });
      return true;
    }
    return line.startsWith("[surfperf]");
  };
  for (const method of ["debug", "log"]) {
    const orig = console[method].bind(console);
    console[method] = (...a) => {
      if (typeof a[0] === "string") {
        try {
          if (handle(a[0])) return;
        } catch {
          /* an unparsed line still reaches the console */
        }
      }
      orig(...a);
    };
  }
  // The app's own half-extents (main.ts's fourDRenderSnapshot) are the
  // cloud result's `bounds` halved; the async density upgrade after boot is
  // the first result that crosses the worker boundary.
  const findHalfExtents = (v, depth) => {
    if (!v || typeof v !== "object" || depth > 3) return null;
    const b = v.bounds;
    if (b && typeof b.maxW === "number" && typeof b.minW === "number")
      return [
        (b.maxX - b.minX) / 2,
        (b.maxY - b.minY) / 2,
        (b.maxZ - b.minZ) / 2,
        (b.maxW - b.minW) / 2,
      ];
    for (const k of Object.keys(v)) {
      const inner = v[k];
      if (inner && typeof inner === "object" && !ArrayBuffer.isView(inner)) {
        const hit = findHalfExtents(inner, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", (e) => {
        try {
          const h = findHalfExtents(e.data, 0);
          if (h) window.__probeHalfExtents = h;
        } catch {
          /* observation only */
        }
      });
    }
  };
  window.__probe = {
    setPhase(p) {
      phase = p;
      P();
    },
    read: () => phases,
  };
};

// ---------------------------------------------------------------- one cell

async function runCell(browser, r, depth) {
  const out = {
    key: cellKey(r, depth),
    plan: r.plan,
    engineWanted: r.engine,
    dim: r.dim,
    arrangement: r.arrangement,
    radiusFraction: r.rf,
    seed: r.seed,
    depth,
    pose: r.pose,
    status: "error",
    note: "",
  };
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const errors = [];
  try {
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    page.on("console", (m) => {
      if (
        m.type() === "error" ||
        /device lost|validation error|uncaptured error/i.test(m.text())
      )
        errors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push(`pageerror ${String(e)}`));
    const query =
      r.engine === "webgl"
        ? "?surfacestate&surfacetrace&surfperf&surfacegl"
        : "?surfacestate&surfacetrace&surfacecompute";
    await page.goto(`${BASE}/${query}#${mintHash(r, depth)}`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    // A REFUSED block draws an empty Points cloud, so the count never rises;
    // the Surface button's own reason is the row's verdict then, not a timeout.
    const booted = await page
      .waitForFunction(
        () => {
          const el = document.getElementById("pointCount");
          if (Number((el?.textContent || "").replace(/[^\d]/g, "")) > 0)
            return "points";
          const b = document.getElementById("modeSurfaceBtn");
          return b?.disabled && b.title && performance.now() > 8000
            ? "refused"
            : false;
        },
        undefined,
        { timeout: 60_000, polling: 100 },
      )
      .then((h) => h.jsonValue());
    if (booted === "refused") {
      out.status = "refused-document";
      out.note = String(
        await page.evaluate(
          () => document.getElementById("modeSurfaceBtn")?.title,
        ),
      ).slice(0, 300);
      return out;
    }
    if (r.dim === 4) {
      const w0 = POSES[r.pose].w0;
      await page.waitForFunction(() => !!window.__probeHalfExtents, undefined, {
        timeout: 30_000,
        polling: 100,
      });
      const half = await page.evaluate(() => window.__probeHalfExtents);
      const wRow = rotorWRow(rotorFor(POSES[r.pose].planes));
      const support = wRow.reduce((s, m, i) => s + Math.abs(m) * half[i], 0);
      out.halfExtents = half;
      out.wSupport = support;
      if (w0 !== 0) {
        const picked = await page.evaluate((x) => {
          const el = document.querySelector("#fourDSliceSlider");
          if (!(el instanceof HTMLInputElement)) return null;
          el.value = String(x);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return Number(el.value);
        }, w0 / support);
        if (picked === null) throw new Error("no #fourDSliceSlider");
        out.sliceNormalized = picked;
        out.w0World = picked * support;
        await sleep(400);
      } else {
        out.sliceNormalized = 0;
        out.w0World = 0;
      }
    }
    const button = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return { present: !!b, disabled: b?.disabled ?? true, title: b?.title };
    });
    if (!button.present || button.disabled) {
      out.status = "refused-document";
      out.note = String(button.title ?? "").slice(0, 300);
      return out;
    }
    const canvas = await page
      .locator("#container canvas")
      .first()
      .boundingBox();
    const t0 = Date.now();
    await page.click("#modeSurfaceBtn");
    const timeout = r.engine === "webgl" ? GL_TIMEOUT_MS : TIMEOUT_MS;
    let last = null;
    for (;;) {
      const st = await pollSurfaceState(page);
      last = st.probe;
      if (st.probe.firstFrame && out.firstFrameMs === undefined)
        out.firstFrameMs = Date.now() - t0;
      if (st.settled) {
        out.settleMs = Date.now() - t0;
        break;
      }
      if (Date.now() - t0 > timeout) {
        out.status = "timeout";
        out.note = `no settle in ${timeout / 1000}s (row text: ${st.rowText.slice(0, 80)})`;
        break;
      }
      await sleep(150);
    }
    out.engine = last?.engine ?? null;
    out.backend = last?.backend ?? null;
    if (last?.census) {
      const { rays, covered, miss, exhausted } = last.census;
      out.census = { rays, covered, miss, exhausted };
      out.settleExhaustedFrac = exhausted / rays;
      out.coveredFrac = covered / rays;
    }
    if (out.status !== "timeout") {
      // The orbit drag: previews at whatever rung the governor holds.
      await page.evaluate(() => window.__probe.setPhase("drag"));
      const x0 = canvas.x + canvas.width * 0.3;
      const y0 = canvas.y + canvas.height * 0.5;
      const tDrag = Date.now();
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(x0 + i * 10, y0 + i * 1.5);
        await sleep(75);
      }
      await page.mouse.up();
      await sleep(1500);
      out.dragMs = Date.now() - tDrag;
      out.status = "settled";
    }
    const phases = await page.evaluate(() => window.__probe.read());
    out.phases = phases;
    summarize(out);
  } catch (err) {
    out.status = "error";
    out.note = `${out.note} ${String(err).slice(0, 240)}`.trim();
  } finally {
    out.errors = errors.slice(0, 5);
    await context.close().catch(() => {});
  }
  return out;
}

/** Condense the phase aggregates into the row's reported figures. */
function summarize(out) {
  const entry = out.phases?.entry;
  const drag = out.phases?.drag;
  const settleRaster = entry?.settles?.at(-1) ?? entry?.glSettles?.at(-1);
  if (settleRaster) out.raster = `${settleRaster.w}x${settleRaster.h}`;
  const fullW = settleRaster?.w ?? null;
  if (entry) {
    out.entryPreviews = entry.previews.length || entry.glPreviewArms.length;
    out.settlePasses = entry.settles.length;
    out.settleGpu = {
      marchWorkMs: Math.round(entry.march.sumWork),
      shadeWorkMs: Math.round(entry.shade.sumWork),
      shadeShare:
        entry.march.sumWork + entry.shade.sumWork > 0
          ? entry.shade.sumWork / (entry.march.sumWork + entry.shade.sumWork)
          : null,
      shadeUsPerHit:
        entry.shade.hitLen > 0
          ? (entry.shade.sumWork * 1000) / entry.shade.hitLen
          : null,
      maxMarchDispatchMs: entry.march.maxWork,
      maxShadeDispatchMs: entry.shade.maxWork,
      maxDispatchWallMs: Math.max(entry.march.maxWall, entry.shade.maxWall),
      dispatches: entry.march.n + entry.shade.n,
      currency: entry.src,
      shadeModel: entry.shadeModel,
      truncations: entry.truncations,
    };
    if (entry.glSettles.length > 0) {
      out.glSettle = {
        samples: entry.glSettles.length,
        spentMs: Math.round(entry.glSettles.reduce((s, g) => s + g.spentMs, 0)),
        strips: entry.glSettles.reduce((s, g) => s + g.strips, 0),
        heavyStrips: entry.heavyStrips.length,
        maxHeavyStripMs: Math.max(0, ...entry.heavyStrips.map((h) => h.ms)),
      };
    }
  }
  const allPreviews = [...(entry?.previews ?? []), ...(drag?.previews ?? [])];
  if (drag && fullW) {
    const pv = drag.previews;
    const arms = drag.glPreviewArms;
    const widths = pv.length > 0 ? pv.map((p) => p.w) : arms.map((a) => a.w);
    out.dragPreviews = widths.length;
    if (widths.length > 0) {
      out.dragRungMin = Math.min(...widths) / fullW;
      out.dragRungMax = Math.max(...widths) / fullW;
    }
    if (pv.length > 0) {
      const coarsest = pv.reduce((a, b) => (b.w < a.w ? b : a));
      out.coarsestPreviewExhaustedFrac =
        coarsest.exhausted / (coarsest.w * coarsest.h);
      out.dragPreviewMaxWallMs = Math.max(...pv.map((p) => p.wallMs));
      out.dragTruncatedPreviews = pv.filter((p) =>
        p.note.includes("trunc"),
      ).length;
      out.dragMaxDispatchMs = Math.max(drag.march.maxWork, drag.shade.maxWork);
    }
  }
  if (allPreviews.length > 0) {
    out.maxPreviewExhaustedFrac = Math.max(
      ...allPreviews.map((p) => p.exhausted / (p.w * p.h)),
    );
  }
}

// ------------------------------------------------------ lock and conditions

function foreignGpuProcesses(ownPids) {
  let text = "";
  try {
    text = execFileSync(
      "pgrep",
      ["-fa", "vitest|chromium|chrome-headless|playwright|vite build"],
      {
        encoding: "utf8",
      },
    );
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .filter((l) => !/playwright-mcp|@playwright\/mcp|pgrep/.test(l))
    .filter((l) => !ownPids.has(Number(l.split(" ")[0])));
}

async function acquireLock() {
  for (;;) {
    const own = await pidTree(process.pid);
    const foreign = foreignGpuProcesses(own);
    if (foreign.length === 0) break;
    log(
      `waiting for ${foreign.length} foreign process(es): ${foreign[0].slice(0, 100)}`,
    );
    await sleep(10_000);
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, `sphere-inversion-cost probe pid ${process.pid}\n`);
  log(`lock taken ${LOCK}`);
}
function releaseLock() {
  try {
    fs.rmSync(LOCK, { force: true });
  } catch {
    /* best effort */
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    releaseLock();
    process.exit(130);
  });
}
process.on("exit", releaseLock);

function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return { runs: [], cells: {} };
  }
}
function saveResults(results) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(`${OUT}.tmp`, JSON.stringify(results, null, 1));
  fs.renameSync(`${OUT}.tmp`, OUT);
}

function line(c) {
  const f = (v, d = 1) =>
    v === undefined || v === null ? "-" : Number(v).toFixed(d);
  const pct = (v) =>
    v === undefined || v === null ? "-" : `${(v * 100).toFixed(2)}%`;
  return (
    `${c.key.padEnd(44)} ${c.status.padEnd(16)} eng=${String(c.engine ?? "-").padEnd(7)}` +
    ` settle=${f(c.settleMs / 1000)}s exhS=${pct(c.settleExhaustedFrac)}` +
    ` rung=${f(c.dragRungMin, 2)} exhP=${pct(c.coarsestPreviewExhaustedFrac)}` +
    ` maxDisp=${f(c.settleGpu?.maxMarchDispatchMs)}/${f(c.settleGpu?.maxShadeDispatchMs)}ms` +
    ` shade=${pct(c.settleGpu?.shadeShare)} q=${c.quiet ?? "?"} ${c.note}`
  );
}

// -------------------------------------------------------------------- main

await guardFreshDist({ url: BASE });
let renderer = "unknown";
try {
  renderer = execFileSync("glxinfo", ["-B"], {
    encoding: "utf8",
    env: { ...process.env, DISPLAY },
  })
    .split("\n")
    .find((l) => l.includes("OpenGL renderer"))
    ?.trim();
} catch {
  /* recorded as unknown */
}
log(`renderer: ${renderer}`);
if (/swiftshader|llvmpipe|softpipe/i.test(renderer)) {
  console.error("REFUSED: the display is not a real hardware driver.");
  process.exit(2);
}

const results = loadResults();
results.runs.push({
  startedAt: new Date().toISOString(),
  renderer,
  viewport: `${VW}x${VH}`,
  plans: PLANS,
  timeoutMs: TIMEOUT_MS,
  pruneMs: PRUNE_MS,
});
saveResults(results);

let browser = null;
let batchStart = 0;
async function ensureBrowser() {
  if (browser && Date.now() - batchStart > BATCH_MS) {
    await browser.close().catch(() => {});
    browser = null;
    releaseLock();
    log(`batch done; lock released for ${PAUSE_MS / 1000}s`);
    await sleep(PAUSE_MS);
  }
  if (!browser) {
    await acquireLock();
    browser = await launchSurfaceBrowser(`x11:${DISPLAY}`);
    batchStart = Date.now();
  }
}

async function measureRows(rows) {
  for (const r of rows) {
    let pruned = null;
    for (const depth of r.depths) {
      const key = cellKey(r, depth);
      if (ONLY && !key.includes(ONLY)) continue;
      const prev = results.cells[key];
      if (pruned) {
        if (!prev || prev.status !== "pruned")
          results.cells[key] = { key, status: "pruned", note: pruned };
        continue;
      }
      const certifiedDone =
        prev && prev.status !== "error" && prev.quiet === "YES";
      const retriesSpent =
        (prev?.uncertifiedRuns ?? 0) >= MAX_UNCERTIFIED_RETRIES;
      if (!(
        certifiedDone ||
        (prev && prev.status !== "error" && retriesSpent)
      )) {
        await ensureBrowser();
        const own = await pidTree(process.pid);
        const quiet = await measureGpuContention({ ignorePids: [...own] });
        const cell = await runCell(browser, r, depth);
        cell.quiet =
          quiet.contended === false
            ? "YES"
            : quiet.contended
              ? "NO"
              : "UNKNOWN";
        cell.quietLine = formatQuietLine(quiet);
        cell.measuredAt = new Date().toISOString();
        if (cell.quiet !== "YES")
          cell.uncertifiedRuns = (prev?.uncertifiedRuns ?? 0) + 1;
        results.cells[key] = cell;
        saveResults(results);
        log(line(cell));
      }
      const c = results.cells[key];
      if (c.status === "timeout" || (c.settleMs ?? 0) > PRUNE_MS) {
        pruned = `pruned after D${depth} (${c.status === "timeout" ? "timeout" : `settle ${(c.settleMs / 1000).toFixed(1)}s`})`;
      }
    }
    saveResults(results);
  }
}

try {
  const rows = plannedRows();
  log(
    `${rows.length} rows, ${rows.reduce((s, r) => s + r.depths.length, 0)} cells max`,
  );
  await measureRows(rows);
  // One bounded retry pass for anything left uncertified by a busy desktop.
  await measureRows(rows);
} finally {
  if (browser) await browser.close().catch(() => {});
  releaseLock();
}
const cells = Object.values(results.cells);
log(
  `done: ${cells.length} cells; certified ${cells.filter((c) => c.quiet === "YES").length}; ` +
    `uncertified ${cells.filter((c) => c.quiet && c.quiet !== "YES").length}`,
);
