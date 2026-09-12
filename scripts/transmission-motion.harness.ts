/**
 * Short isolated-motion study for the sampled world-band transmission model.
 *
 * Run after the GPU timing window:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/transmission-motion.harness.ts --disableConsoleIntercept
 *
 * Each sequence changes exactly one of camera, XW rotor angle, or slice w0.
 * Optics, raster and work budgets stay fixed within and across each sequence.
 * Outputs under scripts/out/transmission-motion/ are regenerable evidence.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng } from "./de-preview";
import type { Vec3 } from "./de-preview";
import {
  delta,
  fixtures,
  renderTransmission,
  WORLD_BAND_DEFAULTS,
} from "./transmission-study";
import type { Fixture, FixturePoseOverrides } from "./transmission-study";

const OUT = "scripts/out/transmission-motion";
const MENGER_SIZE = Number(process.env.TRANSMISSION_MOTION_3D_SIZE ?? 48);
const ESCAPE4_SIZE = Number(process.env.TRANSMISSION_MOTION_4D_SIZE ?? 64);
const TRANSMIT = 0.9;
const MAX_LAYERS = 64;
const MAX_STEPS = 1200;

interface FrameSpec {
  value: number | Vec3;
  pose: Partial<FixturePoseOverrides>;
}

interface SequenceSpec {
  name: string;
  fixture: string;
  variable: "camera" | "rotor" | "slice";
  size: number;
  frames: FrameSpec[];
}

const camera: Vec3[] = [
  [0.93, 0.59, 2.28],
  [0.99, 0.62, 2.24],
  [1.05, 0.65, 2.2],
  [1.11, 0.68, 2.16],
  [1.17, 0.71, 2.12],
];
const BASE_4D = {
  angle: 0.35,
  w0: 0.3,
  eyeOffset: [0.55, 0.35, 2.2] as Vec3,
  zoom: 0.22,
};
const sequences: SequenceSpec[] = [
  {
    name: "menger-camera",
    fixture: "MENGER 3D",
    variable: "camera",
    size: MENGER_SIZE,
    frames: camera.map((eyeOffset) => ({
      value: eyeOffset,
      pose: { eyeOffset },
    })),
  },
  {
    name: "mandelbox4-rotor",
    fixture: "MANDELBOX 4D",
    variable: "rotor",
    size: ESCAPE4_SIZE,
    frames: [0.27, 0.31, 0.35, 0.39, 0.43].map((angle) => ({
      value: angle,
      pose: { ...BASE_4D, angle },
    })),
  },
  {
    name: "mandelbox4-slice",
    fixture: "MANDELBOX 4D",
    variable: "slice",
    size: ESCAPE4_SIZE,
    frames: [0.18, 0.24, 0.3, 0.36, 0.42].map((w0) => ({
      value: w0,
      pose: { ...BASE_4D, w0 },
    })),
  },
];

function namedFixture(
  name: string,
  pose: Partial<FixturePoseOverrides>,
): Fixture {
  const fixture = fixtures(pose).find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Missing transmission fixture ${name}`);
  return fixture;
}

function changedPixels(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 3)
    if (
      Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      ) > 2
    )
      changed++;
  return changed;
}

describe("Surface transmission isolated motion", () => {
  it("writes straight/warped camera, rotor and slice sequences", () => {
    mkdirSync(OUT, { recursive: true });
    const report = sequences.map((sequence) => {
      let previousStraight:
        ReturnType<typeof renderTransmission>["stats"] | undefined;
      let previousWarped:
        ReturnType<typeof renderTransmission>["warped"] | undefined;
      const frames = sequence.frames.map((spec, index) => {
        const fixture = namedFixture(sequence.fixture, spec.pose);
        const result = renderTransmission(
          fixture,
          TRANSMIT,
          true,
          sequence.size,
          MAX_LAYERS,
          0.5,
          MAX_STEPS,
          { strategy: "world", worldBand: { ...WORLD_BAND_DEFAULTS } },
        );
        const stem = `${sequence.name}-${String(index).padStart(2, "0")}`;
        const straightFile = `${stem}-straight.png`;
        const warpedFile = `${stem}-warped.png`;
        writeFileSync(
          `${OUT}/${straightFile}`,
          encodePng(result.stats.width, result.stats.height, result.stats.rgb),
        );
        writeFileSync(
          `${OUT}/${warpedFile}`,
          encodePng(
            result.warped.width,
            result.warped.height,
            result.warped.rgb,
          ),
        );
        const row = {
          index,
          value: spec.value,
          pose: spec.pose,
          straightFile,
          warpedFile,
          coverage: result.stats.hits / (sequence.size * sequence.size),
          unresolved: result.unresolved,
          warpFallbacks: result.warpFallbacks,
          warpFallbackFraction:
            result.stats.hits > 0
              ? result.warpFallbacks / result.stats.hits
              : 0,
          straightWarpDelta: delta(result.stats, result.warped),
          previousStraightDelta: previousStraight
            ? delta(previousStraight, result.stats)
            : 0,
          previousWarpedDelta: previousWarped
            ? delta(previousWarped, result.warped)
            : 0,
          previousStraightChangedPixels: previousStraight
            ? changedPixels(previousStraight.rgb, result.stats.rgb)
            : 0,
          previousWarpedChangedPixels: previousWarped
            ? changedPixels(previousWarped.rgb, result.warped.rgb)
            : 0,
          maxLayers: result.maxLayers,
          termination: result.termination,
          work: result.work,
        };
        previousStraight = result.stats;
        previousWarped = result.warped;
        console.log(JSON.stringify({ sequence: sequence.name, ...row }));
        return row;
      });
      return { ...sequence, frames };
    });
    const envelope = {
      model: "fixed world-space hysteretic clearance bands",
      worldBand: WORLD_BAND_DEFAULTS,
      transmit: TRANSMIT,
      warp: {
        kind: "image-space virtual parallel slab",
        ior: 1.45,
        slabRadiusFraction: 0.08,
        maxImageOffsetFraction: 0.04,
      },
      maxLayers: MAX_LAYERS,
      maxSteps: MAX_STEPS,
      base4d: BASE_4D,
      sequences: report,
    };
    writeFileSync(`${OUT}/report.json`, JSON.stringify(envelope, null, 2));
    const data = JSON.stringify(envelope).replaceAll("<", "\\u003c");
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><title>Transmission motion</title><style>body{margin:20px;background:#111;color:#ddd;font:14px system-ui}header{display:flex;gap:12px;align-items:center}.views{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:min(42vw,640px);image-rendering:auto}pre{white-space:pre-wrap}</style><header><select id="series"></select><input id="frame" type="range" min="0" max="4" value="0"><button id="play">Play</button><span id="label"></span></header><div class="views"><figure><img id="straight"><figcaption>Straight layers</figcaption></figure><figure><img id="warped"><figcaption>Optional slab warp</figcaption></figure></div><p>Scrub for grid boiling, warp fallback discontinuities, and missing disocclusions.</p><pre id="metrics"></pre><script>const data=${data};const s=document.querySelector('#series'),r=document.querySelector('#frame'),a=document.querySelector('#straight'),b=document.querySelector('#warped'),l=document.querySelector('#label'),m=document.querySelector('#metrics'),p=document.querySelector('#play');data.sequences.forEach((q,i)=>s.add(new Option(q.name,i)));let timer;function draw(){const q=data.sequences[+s.value],f=q.frames[+r.value];a.src=f.straightFile;b.src=f.warpedFile;l.textContent=q.variable+' '+JSON.stringify(f.value);m.textContent=JSON.stringify({fixed:{worldBand:data.worldBand,transmit:data.transmit,maxLayers:data.maxLayers,maxSteps:data.maxSteps},frame:f},null,2)}s.onchange=()=>{r.value=0;draw()};r.oninput=draw;p.onclick=()=>{if(timer){clearInterval(timer);timer=0;p.textContent='Play'}else{timer=setInterval(()=>{r.value=(+r.value+1)%5;draw()},450);p.textContent='Pause'}};draw()</script>`,
    );
  });
});
