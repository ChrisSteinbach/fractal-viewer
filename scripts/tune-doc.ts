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
 *   perfold  — every sponge map carrying its own small spherefold
 *   perfold+lens — that plus the tuned final lens
 *   lens4 / twist4+lens — the 4D variants
 *   carve    — the exact carve construction (mengerTwist block)
 *   landed3d / landed4d — the presets as shipped after the tune commit
 * Flags: --angle=rad (twist about Y), --pos=x,y,z --rot=a,b,c --scale=s
 *   --mR=r --fR=r --wall=w --weight=w (lens overrides)
 *   --pmR=r --pfR=r --pw=w --pwall=w --ptype=t (per-map fold)
 *   --levels=n --crot=a,b,c --coff=x,y,z (carve block)
 */
import { initialState } from "../src/app/state";
import { encodeScene, toSnapshot } from "../src/app/persist";
import {
  PRESET_FINALS,
  hyperMengerSpongeTransforms,
  mengerSponge,
  presetTransforms,
  sierpinskiTetrahedron,
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
if (mode === "carve") {
  // The carve family's placeholder system + the authored block.
  transforms = sierpinskiTetrahedron();
  finalTransform = null;
}
if (mode === "perfold" || mode === "perfold+lens") {
  // Every sponge map carries its OWN small spherefold: the variation
  // applies after each map's affine at every descent level — a bend at
  // every scale (the reference's per-level twist analog). Weight < 1
  // blends the bend gently instead of compounding it into noise.
  const pmR = num("pmR") ?? 2;
  const pfR = num("pfR") ?? 2.2;
  const pw = num("pw") ?? 1;
  const ptype = (arg("ptype") ?? "spherefold") as
    "spherefold" | "mandelbox" | "boxfold";
  transforms = mengerSponge().map((t) => ({
    ...t,
    variations: [
      {
        type: ptype,
        weight: pw,
        minRadius: pmR,
        fixedRadius: pfR,
        ...(ptype === "boxfold" || ptype === "mandelbox"
          ? { boxLimit: num("pwall") ?? 1 }
          : {}),
      },
    ],
  }));
  if (mode === "perfold") finalTransform = null;
}
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
const carveArgs = {
  levels: num("levels"),
  rot: triple("crot"),
  off: triple("coff"),
};
// Camera pose (world radius + radians) for framing experiments — the
// reference image's camera is unknown, so framings ride the document.
const camR = num("camR");
const camTheta = num("camTheta");
const camPhi = num("camPhi");
const camTarget = triple("camT");
const camera =
  camR !== undefined
    ? {
        target: camTarget ?? [0, 0, 0],
        radius: camR,
        theta: camTheta ?? 0.36,
        phi: camPhi ?? 1.14,
      }
    : undefined;
const raw = toSnapshot({
  ...state,
  transforms,
  ...(finalTransform ? { finalTransform } : {}),
  ...(points !== undefined ? { numPoints: points } : {}),
  // The carve family's block (mode carve): the authored Menger twist.
  ...(mode === "carve"
    ? {
        mengerTwist: {
          levels: carveArgs.levels ?? 4,
          rotation: carveArgs.rot ?? [0, -0.9272952180016122, 0],
          offset: carveArgs.off ?? [0, 0, 0],
        },
      }
    : {}),
});
// The camera pose rides OUT OF BAND of toSnapshot (main.ts attaches it only
// when persisting/sharing), so attach it to the snapshot object here.
const snapshot = { ...raw, ...(camera ? { camera } : {}) };
process.stdout.write(encodeScene(snapshot));
