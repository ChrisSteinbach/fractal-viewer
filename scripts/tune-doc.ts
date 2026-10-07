/**
 * Experiment-doc builder for the twistedSponge lens work: builds an AppState
 * from explicit transforms + final lens (the fields the scratch consumes),
 * encodes it, and prints the `#v1=` payload for
 * `npm run gpu:scratch -- --doc=...`.
 *
 * Run: npx tsx scripts/tune-doc.ts -- <mode> [args...]
 * Modes:
 *   lens     — the shipped twistedSponge lens over plain mengerSponge
 *   twist+lens — every sponge map carrying one shared Ry twist + the lens
 *   twist    — the shared twist alone (control)
 *   lens4    — the shipped 4D preset (hyper-Menger + the 4D lens)
 *   twist4+lens — the 4D hyper-Menger with the shared twist + the 4D lens
 * Flags: --angle=rad (twist about Y), --pos=x,y,z --rot=a,b,c --scale=s
 *   --mR=r --fR=r --wall=w --weight=w (lens overrides)
 */
import { initialState } from "../src/app/state";
import { encodeScene, toSnapshot } from "../src/app/persist";
import {
  PRESET_FINALS,
  hyperMengerSpongeTransforms,
  mengerSponge,
  presetTransforms,
  twistedSponge4Lens,
  twistedSpongeLens,
} from "../src/fractal/presets";
import type { Transform } from "../src/fractal/types";

function arg(name: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? undefined : raw.slice(name.length + 3);
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mode = positional[0] ?? "lens";

const num = (name: string): number | undefined => {
  const v = arg(name);
  return v === undefined ? undefined : Number(v);
};
const triple = (name: string): [number, number, number] | undefined => {
  const v = arg(name)?.split(",").map(Number);
  return v && v.length === 3 ? [v[0], v[1], v[2]] : undefined;
};

let transforms = mengerSponge();
let finalTransform: Transform | null = twistedSpongeLens();

const twistAngle = num("angle") ?? 0.9273;

if (mode === "twist" || mode === "twist+lens") {
  transforms = mengerSponge().map((t) => ({
    ...t,
    rotation: [0, twistAngle, 0] as [number, number, number],
  }));
}
if (mode === "twist") finalTransform = null;
if (mode === "landed3d") {
  transforms = presetTransforms("twistedSponge");
  finalTransform = PRESET_FINALS.twistedSponge!();
}
if (mode === "landed4d") {
  transforms = presetTransforms("twistedSponge4");
  finalTransform = PRESET_FINALS.twistedSponge4!();
}
if (mode === "lens4") {
  transforms = hyperMengerSpongeTransforms();
  finalTransform = twistedSponge4Lens();
}
if (mode === "twist4+lens") {
  transforms = hyperMengerSpongeTransforms().map((t) => ({
    ...t,
    rotation: [0, twistAngle, 0] as [number, number, number],
  }));
  finalTransform = twistedSponge4Lens();
}

if (finalTransform) {
  const pos = triple("pos");
  const rot = triple("rot");
  const scale = num("scale");
  const mR = num("mR");
  const fR = num("fR");
  const wall = num("wall");
  const weight = num("weight");
  finalTransform = {
    ...finalTransform,
    ...(pos ? { position: pos } : {}),
    ...(rot ? { rotation: rot } : {}),
    ...(scale !== undefined
      ? { scale: [scale, scale, scale] as [number, number, number] }
      : {}),
    ...(mR !== undefined ||
    fR !== undefined ||
    wall !== undefined ||
    weight !== undefined
      ? {
          variations: (finalTransform.variations ?? []).map((v) => ({
            ...v,
            ...(mR !== undefined ? { minRadius: mR } : {}),
            ...(fR !== undefined ? { fixedRadius: fR } : {}),
            ...(wall !== undefined ? { boxLimit: wall } : {}),
            ...(weight !== undefined ? { weight } : {}),
          })),
        }
      : {}),
  };
}

const state = initialState(false);
const points = num("points");
const snapshot = toSnapshot({
  ...state,
  transforms,
  ...(finalTransform ? { finalTransform } : {}),
  ...(points !== undefined ? { numPoints: points } : {}),
});
process.stdout.write(encodeScene(snapshot));
